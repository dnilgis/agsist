/* /usda-calendar, 2026-10-16 head to head: the .ics and the homepage strip
 * come from the page's own report list, livestock and dairy included; the
 * Nov 30 Crop Progress and Dec 10 Crop Production are on it (NASS 2026
 * Agricultural Statistics Board calendar, saved on the references branch). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { readPage, buildIcs } from "../scripts/build_usda_ics.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CAL = readFileSync(ROOT + "usda-calendar.html", "utf8");
const ICS = readFileSync(ROOT + "usda-calendar.ics", "utf8");
const HOME = readFileSync(ROOT + "components/home.js", "utf8");

test("usda-calendar.ics is built from the page's list and is current", () => {
  const out = execFileSync("node", ["scripts/build_usda_ics.mjs", "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /matches/);
  assert.equal(ICS, buildIcs(readPage(CAL)));
});

test("every livestock and dairy row is in the .ics at 3:00 PM Eastern", () => {
  const { reports } = readPage(CAL);
  const live = reports.filter((r) => r.type === "livestock");
  assert.ok(live.length >= 10);
  const flat = ICS.replace(/\r\n /g, "");
  for (const r of live) {
    // 3 PM ET is 19:00Z under daylight time (to Nov 1, 2026), 20:00Z after
    const z = r.date < "2026-11-01" ? "190000Z" : "200000Z";
    assert.ok(flat.includes("DTSTART:" + r.date.replace(/-/g, "") + "T" + z + "\r\nDTEND"), r.name + " " + r.date);
  }
  assert.match(flat, /SUMMARY:Cattle on Feed/);
  assert.match(flat, /SUMMARY:Milk Production/);
  assert.ok(!/—/.test(flat), "no em dash");
});

test("NASS 2026 calendar: Crop Production Thu Dec 10 at noon ET, Crop Progress through Mon Nov 30", () => {
  const { reports } = readPage(CAL);
  assert.ok(reports.some((r) => r.date === "2026-12-10" && r.name === "Crop Production" && r.time === "12:00 PM ET"));
  assert.match(ICS, /DTSTART:20261210T170000Z\r\nDTEND:20261210T180000Z\r\nSUMMARY:Crop Production/);
  assert.match(CAL, /\{start:'2026-04-06',end:'2026-11-30'\}/);
  assert.equal(new Date("2026-11-30T12:00:00Z").getUTCDay(), 1, "Nov 30, 2026 is a Monday");
  assert.equal(new Date("2026-12-10T12:00:00Z").getUTCDay(), 4, "Dec 10, 2026 is a Thursday");
  assert.match(HOME, /var CP_LAST=\{2026:'2026-11-30'\};/);
});

/* the homepage strip, run as of a moment, with the .ics delivered */
async function strip(nowIso) {
  const a = HOME.indexOf("function buildUSDACalendar(){"), b = HOME.indexOf("\n  buildUSDACalendar();", a);
  const fixed = new Date(nowIso).getTime();
  class FakeDate extends Date {
    constructor(...x) { if (x.length === 0) super(fixed); else super(...x); }
    static now() { return fixed; }
  }
  const cards = [];
  const el = (tag) => ({ tag, className: "", innerHTML: "", textContent: "", setAttribute() {} });
  const s = el("div");
  s.appendChild = (c) => cards.push(c);
  s.parentNode = { parentNode: { insertBefore() {} } };
  Object.defineProperty(s, "innerHTML", { set() { cards.length = 0; }, get() { return ""; } });
  const ctx = {
    Date: FakeDate, Object, Math, String, Number, Array, JSON, RegExp, Error, Promise,
    document: { getElementById: (id) => (id === "usda-cal-strip" ? s : null), createElement: el },
    fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve(ICS) }),
  };
  vm.runInNewContext(HOME.slice(a, b) + "\nbuildUSDACalendar();", ctx);
  await new Promise((r) => setTimeout(r, 20));
  return cards.map((c) => c.innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

test("homepage strip on Fri Oct 16, 2026 shows Milk Production Oct 22 and Cattle on Feed Oct 23", async () => {
  const cards = await strip("2026-10-16T15:00:00Z");
  assert.ok(cards.some((c) => /^Oct 22 Milk Production 3:00 PM ET$/.test(c)), cards.join(" | "));
  assert.ok(cards.some((c) => /^Oct 23 Cattle on Feed 3:00 PM ET$/.test(c)), cards.join(" | "));
  assert.ok(cards.some((c) => /WASDE/.test(c)), "the next WASDE stays on the strip");
});
