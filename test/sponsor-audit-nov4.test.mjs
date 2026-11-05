// Sponsor portal audit, Nov 4, 2026. Every case is the real Root Lot report and reader file of that morning
// (test/fixtures/sponsoraudit/, frozen: the live files change every day), changed only where a case needs it.
// - Sig saw the readers "stop on Nov 2" while the ad ran to Nov 3: the reader file ends two days back on purpose
//   (scripts/build_audience.py LAG), and the page now says why, worked out from the two files.
// - A state-targeted free test was told the morning email is "the briefing your ad runs in", that its schedule had a
//   "First billed month Oct 28, 2026" at $29, and "Exclusive: one sponsor per issue".
// - An ad switched off by hand with no end date read "Not started, waiting for your approval" above its own counts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const PAGE = read("sponsor-report.html");
const ROOTLOT = JSON.parse(read("test/fixtures/sponsoraudit/rootlot-2026-11-04.json"));
const AUD = JSON.parse(read("test/fixtures/sponsoraudit/audience-2026-11-04.json"));
const R = "rootlot-0000000000000000";   // any id: the report file is served from the fixture
const clone = (x) => JSON.parse(JSON.stringify(x));

test("the fixtures are the real Nov 4 case: ad results through Nov 3, readers through Nov 2, built Nov 4", () => {
  assert.equal(ROOTLOT.through, "2026-11-03");
  assert.ok(AUD.ranges.every((r) => r.end === "2026-11-02"));
  assert.equal(AUD.built.slice(0, 10), "2026-11-04");
  assert.ok(!ROOTLOT.placements.includes("daily_email"), "Root Lot's ad is not in the email");
});

test("the reader-lag line is worked out, never typed: no date or day count sits in the page", () => {
  const fn = PAGE.slice(PAGE.indexOf("function lagLine("), PAGE.indexOf("function rangeOf("));
  assert.ok(fn.length > 100, "lagLine is there");
  assert.doesNotMatch(fn, /20\d\d-\d\d-\d\d|Nov|Oct/);
  assert.match(fn, /a\.built/);
  assert.match(fn, /d\.through/);
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp" };
  const srv = createServer((req, res) => {
    let f = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

// One portal, on a clock an hour after the report was generated, with every outside host blocked (BUILD-RULES 58).
async function portal(browser, port, d, a) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await ctx.clock.install({ time: new Date(Date.parse(d.generated) + 3600e3) });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", (e) => errs.push(String(e)));
  await pg.route((u) => u.hostname !== "127.0.0.1", (x) => x.abort());
  // the report comes from the subs worker since Nov 4, 2026 (private, GET /sponsor-report)
  await pg.route("https://agsist-api.dnilgis.workers.dev/sponsor-report?r=" + R, (x) => x.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, report: d }) }));
  await pg.route("**/data/audience.json*", (x) => x.fulfill({ contentType: "application/json", body: JSON.stringify(a) }));
  await pg.goto(`http://127.0.0.1:${port}/sponsor-report.html?r=${R}`, { waitUntil: "load" });
  await pg.waitForSelector("#results .cp-kpi", { timeout: 8000 });
  await pg.evaluate(() => document.querySelectorAll("details").forEach((x) => { x.open = true; }));
  const out = await pg.evaluate(() => ({
    lag: (document.getElementById("cp-aud-lag") || {}).textContent || "",
    pill: document.querySelector(".cp-pillrow .cp-pill").textContent,
    line: document.querySelector(".cp-line").textContent,
    approve: !!document.querySelector(".cp-hero [data-mail]"),
    billing: document.getElementById("billing").innerText,
    audience: (document.getElementById("audience") || {}).innerText || "",
  }));
  await ctx.close();
  assert.deepEqual(errs, []);
  return out;
}

test("browser: the Root Lot portal of Nov 4, and each way it can go wrong", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    // The real case: Sig's line, word for word.
    let p = await portal(browser, port, clone(ROOTLOT), clone(AUD));
    assert.equal(p.lag, "Reader counts run a day behind the ad results: Google takes two days to finish counting a day.");
    assert.doesNotMatch(p.audience, /your ad runs in/i, "Root Lot's ad is not in the email");
    assert.match(p.audience, /Morning email subscribers/);
    assert.doesNotMatch(p.billing, /First billed month|Last free day|Rate lock|briefing/i, "a free test shows no billing date");
    assert.match(p.billing, /Your ad goes live/);
    assert.match(p.billing, /Exclusive: one business per state/);
    assert.doesNotMatch(p.billing, /per issue/);
    assert.equal(p.pill, "Live since Oct 28, 2026");

    // A stale reader file (built a day before the ad results): it says when it was updated, not that Google is slow.
    const old = clone(AUD); old.built = "2026-11-03T11:40:19+00:00";
    old.ranges.forEach((r) => { r.end = "2026-11-01"; });
    p = await portal(browser, port, clone(ROOTLOT), old);
    assert.equal(p.lag, "Reader counts run two days behind the ad results: the reader file was last updated Nov 3, 2026.");

    // A reader file that is current with the ad results, or ahead of them: no line.
    const even = clone(AUD); even.ranges.forEach((r) => { r.end = "2026-11-03"; });
    p = await portal(browser, port, clone(ROOTLOT), even);
    assert.equal(p.lag, "");

    // An ad that has not run has no results to be behind.
    const pend = clone(ROOTLOT);
    Object.assign(pend, { pending: true, start: null, liveSince: null, series: [], windows: [], byPage: [],
      totals: { viewable: 0, clicks: 0, ctr: null, legacyImpressions: 0 } });
    p = await portal(browser, port, pend, clone(AUD));
    assert.equal(p.lag, "");

    // Switched off by hand, no end date: paused, with no approve button over its own counts.
    const off = clone(ROOTLOT); off.creative.live = false;
    p = await portal(browser, port, off, clone(AUD));
    assert.equal(p.pill, "Paused");
    assert.equal(p.approve, false);
    assert.match(p.line, /off for now/);

    // Ended with a date still reads Ended.
    const ended = clone(ROOTLOT); ended.creative.live = false; ended.ended = "2026-11-01";
    p = await portal(browser, port, ended, clone(AUD));
    assert.equal(p.pill, "Ended Nov 1, 2026");

    // A malformed live-since date is never printed as a blank "Live since".
    const bad = clone(ROOTLOT); bad.liveSince = "2026-10-2"; bad.start = "2026-10-2";
    p = await portal(browser, port, bad, clone(AUD));
    assert.equal(p.pill, "Live");
    assert.doesNotMatch(p.line, /read 0/, "71 were counted; the line does not say the counts read 0");

    // A paid sponsor of the Daily keeps its email line and its dated schedule.
    const paid = clone(ROOTLOT);
    Object.assign(paid, { freeTest: false, geo: null, regions: null, regionAds: undefined, placements: ["homepage", "daily_page", "archive", "daily_email"],
      billing: { tier: "daily", trial_months: 1, rate_lock_months: 12 } });
    paid.creative.tier = "daily";
    p = await portal(browser, port, paid, clone(AUD));
    assert.match(p.audience, /the briefing your ad runs in/);
    assert.match(p.billing, /First billed month/);
    assert.match(p.billing, /The first briefing with your ad/);
    assert.match(p.billing, /Exclusive: one sponsor per issue/);
  } finally {
    await browser.close(); srv.close();
  }
});
