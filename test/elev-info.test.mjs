/* An elevator's own listing (agsist.com/post) on /cash-bids cards and town pages.
 *
 * Where the facts come from: dnilgis/bids publishes, for an elevator that posts
 * through the portal,
 *   data/merged/<place>.json   shard header `info` = { listingId, name,
 *                              contactName, hours, harvestHours, note,
 *                              closedUntil, infoUpdatedAt }  (read by
 *                              components/cash-bids.js via data/merged-index.json)
 *   data/index.json            the source row's `portal`, same fields (read by
 *                              scripts/build_cash_bid_pages.py)
 * Every other shard and source row has neither key. The fixtures in
 * test/fixtures/elev-info are shaped on those files: a Bunge Ladoga shard and
 * index row as the bids side writes them, and a real ADM Attica shard.
 *
 * The page's functions are lifted out of components/cash-bids.js (brace-counted,
 * as test/cb-rank.test.mjs does), so a green run is about the shipped copy.
 *
 *   node --test test/elev-info.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FIX = ROOT + "test/fixtures/elev-info/";
const JS = readFileSync(ROOT + "components/cash-bids.js", "utf8");
const fx = (f) => JSON.parse(readFileSync(FIX + f, "utf8"));

function liftFn(name) {
  const i = JS.indexOf("function " + name + "(");
  assert.ok(i >= 0, `components/cash-bids.js no longer defines ${name}()`);
  let d = 0, j = JS.indexOf("{", i);
  for (; j < JS.length; j++) {
    const c = JS[j];
    if (c === "{") d++;
    else if (c === "}" && --d === 0) break;
  }
  return JS.slice(i, j + 1);
}
function liftVar(name) {
  const m = new RegExp("var " + name + "=[\\s\\S]*?;\\n").exec(JS);
  assert.ok(m, `components/cash-bids.js no longer defines var ${name}`);
  return m[0];
}

const FNS = ["escH", "truncName", "hasPhone", "classify", "usScope", "netContract", "netLog", "netRowsFrom", "readTimeOnly",
  "ppu", "basisUnit", "basisCents", "basisUnusual", "basisUnclear", "groupElevators",
  "portalInfo", "portalClosedLabel", "portalBadge", "portalLines"];
const VARS = ["US_STATES_OK", "PPU_BAND", "BASIS_SANE"];

function load() {
  const ctx = { console, Intl, Date, Math, JSON, isFinite, parseFloat, String, Array, Object };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext("var NET_DEBUG=false;\n" + VARS.map(liftVar).join("\n") + "\n" + FNS.map(liftFn).join("\n"), ctx);
  return ctx;
}
const P = load();

const NOW = Date.parse("2026-10-13T18:00:00Z");          /* 1 pm Central, Tuesday */
const END_OF_TODAY = "2026-10-14T04:59:59.999Z";         /* 11:59:59 pm Central */
const HOSTILE = '<img src=x onerror="alert(1)"><script>alert(2)</script> & "sharp"';

function ladoga(info) {
  const s = fx("shard-bunge-ladoga.json");
  if (info !== undefined) s.info = info === null ? undefined : { ...s.info, ...info };
  return s;
}
function card(shard, now = NOW) {
  const rows = P.netRowsFrom(JSON.parse(JSON.stringify(shard)), 12);
  const els = P.groupElevators(rows);
  assert.equal(els.length, 1);
  const e = els[0];
  return { e, html: P.portalBadge(e.portal, now) + P.portalLines(e.portal, !!e.phone) };
}

test("a portal shard's info travels from the shard to its card", () => {
  const { e, html } = card(ladoga());
  assert.equal(e.portal.contactName, "Wyatt");
  assert.equal(e.portal.hours, "Mon-Fri 7-5, Sat 7-12");
  assert.match(html, /<span class="elev-pk">Hours<\/span> Mon-Fri 7-5, Sat 7-12/);
  assert.match(html, /<span class="elev-pk">Harvest<\/span> 7am-9pm through Nov 15/);
  assert.match(html, /<div class="elev-pnote">Dump closes at 8:30pm sharp during harvest\.<\/div>/);
  /* the card has a phone, so the name goes on the Call button, not in the lines */
  assert.doesNotMatch(html, /Ask for/);
  assert.doesNotMatch(html, /Closed/, "closedUntil null: no badge");
});

test("the Call button carries the contact name, escaped, only when there is one", () => {
  const call = /if\(elev\.phone\)html\+='<a class="elev-call-btn"[^\n]*/.exec(JS);
  assert.ok(call, "the card's Call button moved");
  assert.match(call[0], /elev\.portal&&elev\.portal\.contactName\?' <span class="elev-who">'\+escH\(truncName\(elev\.portal\.contactName,14\)\)/);
  assert.match(call[0], /aria-label="Call '\+\(elev\.portal&&elev\.portal\.contactName\?escH\(elev\.portal\.contactName\)/);
  /* and the card draws the badge and the lines from elev.portal */
  assert.match(JS, /html\+=portalBadge\(elev\.portal,Date\.now\(\)\);/);
  assert.match(JS, /html\+=portalLines\(elev\.portal,!!elev\.phone\);/);
});

test("the note, hours and contact are text, never HTML", () => {
  const { html } = card(ladoga({ note: HOSTILE, hours: "<b>7-5</b>", harvestHours: "a\" onmouseover=\"x", contactName: "<i>W</i>" }));
  for (const bad of ["<img", "<script", "<b>7-5", "<i>W", '" onmouseover']) assert.ok(!html.includes(bad), bad);
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt; &amp; &quot;sharp&quot;"));
  assert.ok(html.includes("&lt;b&gt;7-5&lt;/b&gt;"));
  /* no phone: the contact name is listed, escaped */
  const s = ladoga({ contactName: "<i>W</i>" }); s.phone = null; s.bids.forEach((b) => delete b.phone);
  const { html: h2 } = card(s);
  assert.ok(h2.includes('<span class="elev-pk">Ask for</span> &lt;i&gt;W&lt;/i&gt;'));
  /* the note is cut to one line of at most 140 characters */
  const long = P.portalInfo({ note: "line one\nline two " + "x".repeat(400) });
  assert.equal(long.note.length, 140);
  assert.ok(!/[\n\r]/.test(long.note));
});

test("Closed today shows only while closedUntil is ahead", () => {
  const s = ladoga({ closedUntil: END_OF_TODAY });
  assert.match(card(s, NOW).html, /<div class="elev-closed" data-portal-until="\d+"[^>]*>Closed today<\/div>/);
  /* one minute after the end of the day it is gone */
  assert.doesNotMatch(card(s, Date.parse(END_OF_TODAY) + 60e3).html, /Closed/);
  /* exactly at closedUntil it is gone */
  assert.doesNotMatch(card(s, Date.parse(END_OF_TODAY)).html, /Closed/);
  /* a past closedUntil (yesterday's) never shows */
  assert.doesNotMatch(card(ladoga({ closedUntil: "2026-10-13T04:59:59.999Z" }), NOW).html, /Closed/);
  /* not a date: nothing */
  assert.doesNotMatch(card(ladoga({ closedUntil: "tomorrow" }), NOW).html, /Closed/);
  /* 11:30 pm Central the same day: still today */
  assert.match(card(s, Date.parse("2026-10-14T04:30:00Z")).html, />Closed today</);
  /* a later day says the date rather than "today" */
  assert.equal(P.portalClosedLabel(P.portalInfo({ closedUntil: "2026-10-16T04:59:59.999Z" }), NOW), "Closed until Thu, Oct 15");
  /* the page drops a badge whose time has passed without a reload */
  assert.match(liftFn("portalExpire"), /getAttribute\('data-portal-until'\)[\s\S]*removeChild/);
});

test("an elevator without a listing shows none of it", () => {
  const plain = fx("shard-plain.json");
  assert.equal(plain.info, undefined, "fixture: a real shard has no info");
  const { e, html } = card(plain);
  assert.equal(e.portal, null);
  assert.equal(html, "");
  /* a junk info object adds nothing either */
  for (const junk of [null, "x", [], {}, { note: "   " }, { listingId: "a", name: "b" }])
    assert.equal(P.portalInfo(junk), null, JSON.stringify(junk));
});

/* ── the town pages (scripts/build_cash_bid_pages.py) ─────────────────────── */
const PY = `
import json, os, sys, datetime as dt
sys.path.insert(0, os.path.join(sys.argv[1], "scripts"))
import build_cash_bid_pages as B
merged = json.load(open(sys.argv[2])); index = json.load(open(sys.argv[3]))
ZT = {"zips": {"47954": ["Ladoga", "IN"], "47918": ["Attica", "IN"]}}
B.build_all(merged, index, ZT, out_dir=sys.argv[4], root=sys.argv[4], min_towns=0,
            now=B.parse_ts(merged["generated"]) + dt.timedelta(hours=1))
`;
function town(portal) {
  const dir = mkdtempSync(join(tmpdir(), "elev-info-"));
  try {
    const idx = fx("index.json");
    const src = idx.sources.find((s) => s.id === "portal-bunge-ladoga-in");
    if (portal === null) delete src.portal; else src.portal = { ...src.portal, ...portal };
    writeFileSync(join(dir, "index.json"), JSON.stringify(idx));
    writeFileSync(join(dir, "py.py"), PY);
    execFileSync("python3", [join(dir, "py.py"), ROOT, FIX + "merged-all.json", join(dir, "index.json"), join(dir, "out")],
      { stdio: ["ignore", "ignore", "pipe"] });
    return { la: readFileSync(join(dir, "out", "indiana", "ladoga.html"), "utf8"),
             at: readFileSync(join(dir, "out", "indiana", "attica.html"), "utf8") };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("town page: the listing prints, escaped; the plain elevator's page has none of it", () => {
  const { la, at } = town({ note: HOSTILE, harvestHours: "<b>late</b>" });
  assert.ok(!la.includes("<img src=x") && !la.includes("<script>alert(2)") && !la.includes("<b>late</b>"));
  assert.ok(la.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt; &amp; &quot;sharp&quot;"));
  assert.ok(la.includes("<b>Hours</b> Mon-Fri 7-5, Sat 7-12<br><b>Harvest</b> &lt;b&gt;late&lt;/b&gt;"));
  assert.ok(la.includes("call Wyatt to confirm (765-555-0142)"));
  for (const x of ["cbt-closed", "Closed today", "<b>Hours</b>", "Wyatt", "Dump closes"]) assert.ok(!at.includes(x), x);
});

test("town page: Closed today is never baked in; shown by the reader's clock while closedUntil is ahead", () => {
  const { la } = town({ closedUntil: "2026-10-14T04:59:59.999Z" });
  const m = /<p class="cbt-closed" data-closed-until="([^"]+)" hidden[^>]*>Closed today<\/p><script>([^<]+)<\/script>/.exec(la);
  assert.ok(m, "a hidden line plus its script");
  assert.equal(m[1], "2026-10-14T04:59:59Z");
  /* run the page's own script against a stand-in element at three times */
  const run = (now) => {
    const el = { hidden: true, getAttribute: () => m[1] };
    const timers = [];
    vm.runInNewContext(m[2], { document: { currentScript: { previousElementSibling: el } },
      Date: { parse: Date.parse, now: () => now }, Math, setTimeout: (f, ms) => timers.push([f, ms]) });
    return { el, timers };
  };
  const before = run(Date.parse("2026-10-13T18:00:00Z"));
  assert.equal(before.el.hidden, false, "shown before closedUntil");
  assert.equal(before.timers.length, 1);
  before.timers[0][0]();
  assert.equal(before.el.hidden, true, "and hidden again when it passes");
  assert.equal(run(Date.parse("2026-10-14T06:00:00Z")).el.hidden, true, "next morning: hidden");
  /* closedUntil already past at the snapshot: not in the page at all */
  const { la: past } = town({ closedUntil: "2026-10-13T04:59:59.999Z" });
  assert.ok(!past.includes("cbt-closed") && !past.includes("Closed today"));
  /* no listing at all: the page reads as any other board */
  const { la: none } = town(null);
  assert.ok(!none.includes("<b>Hours</b>") && none.includes("call to confirm (765-555-0142)"));
});
