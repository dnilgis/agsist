/* The homepage USDA strip (index.html buildUSDACalendar) and /usda-calendar
 * must name the same day for a weekly release in a federal-holiday week.
 *
 * 2026-10-11: the strip kept Crop Progress on Monday Oct 12 (Columbus Day)
 * with "Holiday: date may shift" while /usda-calendar said Tuesday Oct 13.
 * The rule is scripts/usda_dates.py's (its --selftest checks the calendar's
 * holiday list); this runs the strip's own shipped code, with the clock set
 * and no network, and holds it to that list.
 *
 *   node --test test/usda-holidays.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
/* The homepage page script lives in components/home.js since 2026-10-12. */
const INDEX = readFileSync(ROOT + "index.html", "utf8") + "\n" + readFileSync(ROOT + "components/home.js", "utf8");
const CAL = readFileSync(ROOT + "usda-calendar.html", "utf8");

const fnSrc = (() => {
  const a = INDEX.indexOf("function buildUSDACalendar(){");
  const b = INDEX.indexOf("\n  buildUSDACalendar();", a);
  assert.ok(a > 0 && b > a, "buildUSDACalendar found in index.html or components/home.js");
  return INDEX.slice(a, b);
})();

/* Run the strip as of `nowIso` (a UTC instant). Returns the card texts. */
function strip(nowIso) {
  const fixed = new Date(nowIso).getTime();
  class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(fixed); else super(...a); }
    static now() { return fixed; }
  }
  const cards = [];
  const el = (tag) => ({ tag, className: "", innerHTML: "", textContent: "", setAttribute() {} });
  const stripEl = el("div");
  stripEl.appendChild = (c) => cards.push(c);
  stripEl.parentNode = { parentNode: { insertBefore() {} } };
  Object.defineProperty(stripEl, "innerHTML", { set() { cards.length = 0; }, get() { return ""; } });
  const ctx = {
    Date: FakeDate, Object, Math, String, Number, Array, JSON, RegExp, Error, Promise,
    document: { getElementById: (id) => (id === "usda-cal-strip" ? stripEl : null), createElement: el },
    fetch: () => new Promise(() => {}),   /* the .ics never arrives: weekly rows only */
  };
  vm.runInNewContext(fnSrc + "\nbuildUSDACalendar();", ctx);
  return cards.map((c) => c.innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

test("Sunday Oct 11, 2026: Crop Progress is Tuesday Oct 13, moved from Columbus Day", () => {
  const cards = strip("2026-10-11T15:00:00Z");
  const cp = cards.filter((c) => /Crop Progress/.test(c));
  assert.ok(cp.length >= 1, cards.join(" | "));
  assert.match(cp[0], /^Oct 13 Crop Progress 4:00 PM ET · moved from Mon Oct 12, holiday$/);
  assert.ok(!cards.some((c) => /Oct 12 Crop Progress/.test(c)), "no Monday Oct 12 Crop Progress card");
  assert.ok(!cards.some((c) => /date may shift/i.test(c)), "no open-ended holiday card");
});

test("an ordinary week stays on Monday", () => {
  const cards = strip("2026-10-14T15:00:00Z");
  assert.ok(cards.some((c) => /^Oct 19 Crop Progress 4:00 PM ET$/.test(c)), cards.join(" | "));
});

test("Tuesday Oct 13 before the release, the moved card is today's", () => {
  const cards = strip("2026-10-13T14:00:00Z");
  assert.ok(cards.some((c) => /Today Crop Progress 4:00 PM ET · moved from Mon Oct 12, holiday · Oct 13/.test(c)), cards.join(" | "));
});

// NASS's 2026 calendar lists the last Crop Progress on Mon Nov 30, the Monday
// after Thanksgiving (2026-10-16 head to head). Until then this test held the
// strip to the Monday of Thanksgiving week, a week short.
test("Crop Progress runs to Mon Nov 30, NASS's last listed Monday, and no later", () => {
  const before = strip("2026-11-24T15:00:00Z");
  assert.ok(before.some((c) => /^Nov 30 Crop Progress 4:00 PM ET$/.test(c)), before.join(" | "));
  const after = strip("2026-12-01T15:00:00Z");
  assert.ok(!after.some((c) => /Crop Progress/.test(c)), after.join(" | "));
});

test("the strip's holiday rule gives the dates /usda-calendar lists", () => {
  const m = /FED_HOLIDAYS=new Set\(\[([^\]]*)\]\)/.exec(CAL);
  assert.ok(m, "FED_HOLIDAYS in usda-calendar.html");
  const page = [...m[1].matchAll(/'(\d{4}-\d{2}-\d{2})'/g)].map((x) => x[1]).sort();
  const src = ["nth", "lastMon", "iso", "observed", "holidays"].map((n) => {
    const line = fnSrc.split("\n").find((l) => l.trim().startsWith("function " + n + "("));
    assert.ok(line, n + " in the strip");
    return line;
  }).join("\n");
  const ctx = {};
  vm.runInNewContext(src + "\nthis.out=[2025,2026].flatMap(holidays).sort();", ctx);
  assert.deepEqual([...ctx.out], page);
});

/* Oct 19: Export Sales in a week with a federal holiday Mon to Wed says Thursday or Friday, the same
   words the Daily uses (Columbus Day 2026: the report came out Fri Oct 16). */
test("Columbus Day week: the Export Sales card says Thu or Fri", () => {
  const cards = strip("2026-10-13T15:00:00Z");
  assert.ok(cards.some((c) => /^Oct 15 Export Sales 8:30 AM ET · Thu or Fri, holiday week$/.test(c)), cards.join(" | "));
});
test("Veterans Day on a Wednesday (Nov 11, 2026): Export Sales says Thu or Fri", () => {
  const cards = strip("2026-11-09T15:00:00Z");
  assert.ok(cards.some((c) => /^Nov 12 Export Sales 8:30 AM ET · Thu or Fri, holiday week$/.test(c)), cards.join(" | "));
});
test("an ordinary week: Export Sales is plain Thursday", () => {
  const cards = strip("2026-10-19T15:00:00Z");
  assert.ok(cards.some((c) => /^Oct 22 Export Sales 8:30 AM ET$/.test(c)), cards.join(" | "));
});
test("the calendar page says Thursday or Friday in a holiday week", () => {
  assert.match(CAL, /Thursday or Friday\. FAS often releases it a day late in a holiday week\./);
});
