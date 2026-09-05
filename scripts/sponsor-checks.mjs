/* SPONSOR MEASUREMENT — the guards, run against the real files.
 *
 * Every check here exists because of a specific way this could report a number
 * that is not the sponsor's. The rule in this project is rule 1: do not invent
 * a number. An advertising report is where that rule is easiest to break and
 * hardest for anyone to catch, because the person reading the report has no
 * way to check it.
 *
 *     node scripts/sponsor-checks.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const R = (p) => readFileSync(fileURLToPath(new URL("../" + p, import.meta.url)), "utf8");
let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n         " + e.message); }
}

/* COMMENTS ARE NOT COVERAGE. Every one of these files EXPLAINS at length what
 * it does and does not count, and a guard matching prose passes on a file that
 * does none of it. This has bitten this project repeatedly, so every check
 * below runs against the source with comments removed. */
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "")
                          .replace(/^\s*\/\/.*$/gm, "")
                          .replace(/<!--[\s\S]*?-->/g, "");
const py = (s) => s.replace(/^\s*#.*$/gm, "").replace(/"""[\s\S]*?"""/g, "");

const METRICS = decomment(R("components/sponsor-metrics.js"));
const LOADER  = decomment(R("components/loader.js"));
const INDEX   = decomment(R("index.html"));
const HAIL    = decomment(R("hail-map.html"));
const BUILDER = py(R("scripts/build_sponsor_report.py"));
const REPORT  = decomment(R("sponsor-report.html"));
const CONF    = JSON.parse(R("data/sponsors.json"));

console.log("\nTHE RULE IT MEASURES");
check("the MRC threshold is half the pixels", () =>
  assert.match(METRICS, /MIN_RATIO\s*=\s*0?\.5\b/));
check("the dwell is one full continuous second", () =>
  assert.match(METRICS, /MIN_MS\s*=\s*1000\b/));
check("scrolling out before the second resets the clock", () => {
  const el = METRICS.match(/\}\s*else\s*\{[\s\S]{0,200}?clearTimeout\(timer\)/);
  assert.ok(el, "no clearTimeout on the below-threshold branch — a flick past would count");
});
check("a backgrounded tab stops the clock", () =>
  assert.match(METRICS, /visibilitychange[\s\S]{0,160}clearTimeout/));
check("it fires once per element, then stops observing", () =>
  assert.match(METRICS, /fired\s*=\s*true[\s\S]{0,200}io\.disconnect\(\)/));
check("no cookie, no identifier, no storage", () => {
  for (const bad of ["localStorage", "sessionStorage", "document.cookie", "indexedDB"])
    assert.ok(!METRICS.includes(bad), "sponsor-metrics touches " + bad);
});

console.log("\nTHE WIRING — a tracker nobody loads is a draft");
check("loader.js actually loads sponsor-metrics.js", () =>
  assert.match(LOADER, /sponsor-metrics\.js/));
check("and loads it on DOMContentLoaded, not only on a page that opts in", () =>
  assert.match(LOADER, /DOMContentLoaded[\s\S]{0,400}loadSponsorMetrics\(\)/));
check("sponsor-metrics.js exists at the path the loader asks for", () =>
  assert.ok(existsSync(fileURLToPath(new URL("../components/sponsor-metrics.js", import.meta.url)))));
check("the cache version was bumped, or browsers keep the old loader", () =>
  assert.ok(Number((R("components/loader.js").match(/var CV = '(\d+)'/) || [])[1]) >= 20,
    "CV is still 19 — every returning visitor runs the loader without the tracker"));

console.log("\nWHAT MAY BE COUNTED — the house slot is not a sponsor");
check("the homepage slot attribute is on the FILLED element only", () => {
  assert.match(INDEX, /id="dsp-filled"[^>]*data-sponsor-slot=/,
    "the filled block does not carry the slot attribute");
  assert.ok(!/id="daily-sponsor"[^>]*data-sponsor-slot=/.test(INDEX),
    "the slot attribute is on #daily-sponsor, which shows the house pitch when unsold");
  assert.ok(!/id="dsp-empty"[^>]*data-sponsor-slot=/.test(INDEX),
    "the EMPTY state is being counted as a sponsor impression");
});
check("the old homepage sponsor_impression observer is gone", () =>
  assert.ok(!INDEX.includes("sponsor_impression"),
    "index.html still fires sponsor_impression — the house billboard counts as an ad"));
check("the hail map's house ribbon no longer fires a 'sponsor view'", () =>
  assert.ok(!HAIL.includes("hm_sponsor_view"),
    "hail-map.html still fires hm_sponsor_view on copy that reads 'Sponsor this map'"));
check("the footer's FILLED card is measured, and only the filled one", () => {
  assert.match(LOADER, /data-sponsor-slot['"]?,\s*['"]footer-strip/);
  assert.ok(!/ad-slot--open[\s\S]{0,300}data-sponsor-slot/.test(LOADER),
    "the OPEN slot is being measured — that is us advertising our own empty slot");
});

console.log("\nNOTHING IS COUNTED TWICE");
check("the footer's old supporter_click listener was deleted, not left beside it", () =>
  assert.ok(!LOADER.includes("'supporter_click'") && !LOADER.includes('"supporter_click"'),
    "loader.js still fires supporter_click AND sets data-sponsor-click — every click doubles"));
check("only one file fires sponsor_viewable", () => {
  let n = 0;
  for (const [f, src] of [["metrics", METRICS], ["loader", LOADER], ["index", INDEX], ["hail", HAIL]])
    if (src.includes("sponsor_viewable")) n++;
  assert.equal(n, 1, "sponsor_viewable is fired from " + n + " files");
});

console.log("\nTHE REPORT — what it adds up, and what it refuses to");
check("sponsorship ENQUIRIES are not in any sponsor's click total", () =>
  assert.ok(!BUILDER.includes("sponsor_cta_click"),
    "sponsor_cta_click is counted as a click — that event fires on 'become a sponsor' links"));
check("house-slot impressions are not in any sponsor's totals", () => {
  for (const bad of ["sponsor_impression", "hm_sponsor_view"])
    assert.ok(!BUILDER.includes(bad), bad + " is counted — it only ever fired on a house slot");
});
check("an empty event list asks GA4 nothing", () =>
  assert.match(BUILDER, /if not events:\s*\n\s*return \[\]/,
    "LEGACY_VIEW_EVENTS is empty and an empty inListFilter can match EVERY event"));
check("it refuses two sponsors while the slot dimension is unregistered", () =>
  assert.match(BUILDER, /len\(sponsors\) > 1 and not SLOT_DIMENSION[\s\S]{0,200}fail\(/,
    "two sponsors would each be shown the site-wide total as their own"));
check("no start date means no numbers, not a default 90-day window", () => {
  assert.ok(!/start = s\.get\("start"\) or \(end - timedelta/.test(BUILDER),
    "a sponsor with no start date is handed 90 days of traffic that was never theirs");
  assert.match(BUILDER, /"pending": True/, "there is no pending report for a sponsor who has not started");
});
check("the report ends at yesterday, never at today", () =>
  assert.match(BUILDER, /end = today - timedelta\(days=1\)/));
check("the page renders the pending state instead of zeroes", () => {
  /* Measured by position, not by a distance-bounded regex: the branch is long
     and a {0,N} span silently stops matching the day somebody adds a line. */
  const at = REPORT.indexOf("if (d.pending)");
  assert.ok(at > 0, "sponsor-report.html has no pending branch");
  const tiles = REPORT.indexOf("sr-tiles", at);
  assert.ok(tiles > at, "the tiles are not rendered after the pending branch");
  const ret = REPORT.indexOf("return;", at);
  assert.ok(ret > at && ret < tiles,
    "the pending branch does not return before the number tiles — a sponsor " +
    "who has not started would be shown a row of zeroes");
});
check("the report page is noindex", () =>
  assert.match(R("sponsor-report.html"), /name="robots"[^>]*noindex/i));

console.log("\nTHE CONFIG");
check("exactly one sponsor is active", () => {
  const on = (CONF.sponsors || []).filter((s) => s.active !== false);
  assert.equal(on.length, 1, on.length + " active sponsors; the builder will refuse");
});
check("no active sponsor carries a start date nobody has confirmed", () => {
  for (const s of (CONF.sponsors || []).filter((x) => x.active !== false))
    assert.ok(s.start === null || /^\d{4}-\d{2}-\d{2}$/.test(s.start),
      s.slug + " has a malformed start date");
});
check("every sponsor has a token long enough to be unguessable", () => {
  for (const s of CONF.sponsors || [])
    assert.ok((s.token || "").length >= 16, s.slug + "'s token is too short to be the key to the page");
});

console.log("\n  " + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
