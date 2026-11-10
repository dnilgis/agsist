// Sponsor portal fixes, Nov 4, 2026, on the frozen Root Lot report and reader file of that
// morning (test/fixtures/sponsoraudit/), changed only where a case needs it. Every outside host blocked (build rule 58),
// the report served through the worker route the page asks (GET /sponsor-report, v5.65).
// - A click rate under 100 views is noise: "-" and "Too few views to judge yet", everywhere a rate shows.
// - The reader-lag line sits by the "Readers in your states" tile too.
// - Equal 7, 30 and 90 day sums (a new ad) are one row "since <live date>"; chart dates read "Oct 28";
//   "live since Oct 28; counted through Nov 3" (no en dash); "Your area's readers" opens on 7 days.
// - A slim header and footer, not the site menu.
// - The plan card: the sponsor's own state price, no "opens soon" for its own states, "Free through <date>, then
//   month to month" only with a free period, and a paid State Sponsor with no trial_months billed from its first day.
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
const R = "rootlot-0000000000000000";
const clone = (x) => JSON.parse(JSON.stringify(x));

test("the fixture is the thin-sample case: 71 views, equal 7, 30 and 90 day sums", () => {
  assert.deepEqual(ROOTLOT.windows.map((w) => [w.days, w.viewable, w.clicks]), [[7, 71, 0], [30, 71, 0], [90, 71, 0]]);
  assert.equal(ROOTLOT.liveSince, "2026-10-28");
  assert.deepEqual(ROOTLOT.billing, { tier: "state", free_test: true });
});

test("no rate is printed from a raw toFixed: every rate goes through rateOf and its 100-view floor", () => {
  const js = PAGE.slice(PAGE.indexOf("<script>\n/* THE CAMPAIGN PORTAL."));
  assert.match(js, /var MIN_VIEWS = 100, THIN_RATE = 'Too few views to judge yet';/);
  const fixed = js.match(/ctr\.toFixed\(2\)|\.ctr\.toFixed|ctr \* 100/g) || [];
  assert.deepEqual(fixed, [], "a click rate printed without the floor");
});

test("the slim header and footer replace the site menu", () => {
  assert.doesNotMatch(PAGE, /id="site-header"|id="site-footer"|static-nav:header|static-nav:footer/);
  assert.match(PAGE, /<header class="cp-top">/);
  assert.match(PAGE, /<footer class="cp-bottom">/);
  assert.doesNotMatch(PAGE, /href="\/cash-bids"|href="\/rain-radar"/, "no site menu links");
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

async function portal(browser, port, d, { w = 390, status = 200 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, serviceWorkers: "block" });
  await ctx.clock.install({ time: new Date(Date.parse(d.generated || ROOTLOT.generated) + 3600e3) });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", (e) => errs.push(String(e)));
  await pg.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); });
  const outside = [];
  await pg.route((u) => u.hostname !== "127.0.0.1", (x) => { outside.push(new URL(x.request().url()).host); x.abort(); });
  await pg.route("https://agsist-api.dnilgis.workers.dev/sponsor-report?r=" + R, (x) => status === 200
    ? x.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, report: d }) })
    : x.fulfill({ status, contentType: "application/json", body: JSON.stringify(status === 410 ? { ok: false, changed: true } : { ok: false }) }));
  await pg.route("**/data/audience.json*", (x) => x.fulfill({ contentType: "application/json", body: JSON.stringify(AUD) }));
  await pg.goto(`http://127.0.0.1:${port}/sponsor-report.html?r=${R}`, { waitUntil: "load" });
  if (status !== 200) { await pg.waitForSelector(".cp-err-msg", { timeout: 8000 }); const t = await pg.textContent(".cp-err-msg"); await ctx.close(); return { err: t }; }
  await pg.waitForSelector("#results .cp-kpi", { timeout: 8000 });
  await pg.evaluate(() => document.querySelectorAll("details").forEach((x) => { x.open = true; }));
  const out = await pg.evaluate(() => {
    const T = (s) => { const e = document.querySelector(s); return e ? e.innerText : ""; };
    const k = [...document.querySelectorAll("#results .cp-kpi")].map((e) => ({ n: (e.querySelector(".cp-kpi-n") || {}).textContent || "", m: (e.querySelector(".cp-kpi-m") || {}).textContent || "" }));
    return { k, kpiLag: T("#cp-kpi-lag"), audLag: T("#cp-aud-lag"), trend: T("#trend"), win: [...document.querySelectorAll("#trend .cp-win > div")].map((e) => e.innerText),
      axis: [...document.querySelectorAll("#trend svg > text")].map((e) => e.textContent), where: T("#where"), area: T("#area"),
      areaPressed: (document.querySelector("#area [aria-pressed=true]") || {}).textContent || "", billing: T("#billing"),
      top: T(".cp-top"), bottom: T(".cp-bottom"), siteMenu: !!document.querySelector("#site-header, #site-footer, nav.snav"), cls: window.__cls,
      side: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  await ctx.close();
  assert.deepEqual(errs, []);
  assert.deepEqual([...new Set(outside)].filter((h) => h !== "agsist-api.dnilgis.workers.dev"), [], "no outside host asked");
  return out;
}

test("browser: thin samples, the lag line by the tile, one trend row, dates, the 7-day area, slim chrome", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const w of [390, 1280]) {
      const o = await portal(browser, port, clone(ROOTLOT), { w });
      // 71 views: no rate anywhere, and why
      assert.equal(o.k[2].n.trim(), "-", w + ": the KPI rate");
      assert.equal(o.k[2].m.trim(), "Too few views to judge yet", w);
      assert.doesNotMatch(o.trend, /0\.00%|\d\.\d\d%/, w + ": no rate in the trend");
      assert.match(o.trend, /click rate - \(too few views to judge yet\)/, w);
      // the reader-lag line, the same words by the tile and under Who reads AGSIST
      assert.ok(o.audLag.length > 20, "the audience lag line is there");
      assert.equal(o.kpiLag, "Readers in your states: " + o.audLag, w + ": the same line by the tile");
      // one row since the live date, not three equal ones
      assert.equal(o.win.length, 1, w + ": one row");
      assert.match(o.win[0], /^71\s*times seen, since Oct 28 · 0 clicks/, w);
      // chart dates and the ad-by-state line
      assert.deepEqual(o.axis.slice(-2), ["Oct 28", "Nov 3"], w + ": axis dates");
      assert.match(o.where, /live since Oct 28; counted through Nov 3/);
      assert.doesNotMatch(o.where, /–/, "no en dash in where it ran");
      assert.equal(o.areaPressed.trim(), "7 days", w + ": your area's readers opens on 7 days");
      // slim chrome, nothing moves, nothing sideways
      assert.match(o.top, /AGSIST/); assert.match(o.top, /Help: sig@agsist\.com/);
      assert.match(o.bottom, /Contact/); assert.equal(o.siteMenu, false);
      assert.ok(o.cls < 0.001, w + ": CLS " + o.cls);
      assert.ok(o.side <= 0, w + ": sideways " + o.side);
    }
    // 100 views and up: the rate shows, in the KPI and every trend row
    const big = clone(ROOTLOT);
    big.windows = [{ days: 7, viewable: 400, clicks: 3, ctr: 0.75 }, { days: 30, viewable: 900, clicks: 5, ctr: 0.5556 }, { days: 90, viewable: 900, clicks: 5, ctr: 0.5556 }];
    big.totals = Object.assign({}, big.totals, { viewable: 900, clicks: 5, ctr: 0.5556 });
    const b = await portal(browser, port, big);
    assert.equal(b.k[2].n.trim(), "0.75%");
    assert.equal(b.win.length, 3, "different sums keep their rows");
    assert.match(b.win[0], /last 7 days · 3 clicks · click rate 0\.75%/);
    assert.match(b.win[1], /click rate 0\.56%/);
    // 99 views on one window only: that row alone says too few
    const mix = clone(big); mix.windows[0] = { days: 7, viewable: 99, clicks: 2, ctr: 2.0202 };
    const m = await portal(browser, port, mix);
    assert.equal(m.k[2].n.trim(), "-"); assert.equal(m.k[2].m.trim(), "Too few views to judge yet");
    assert.match(m.win[0], /click rate - \(too few views to judge yet\)/); assert.match(m.win[1], /click rate 0\.56%/);
    // the old and unknown links
    assert.equal((await portal(browser, port, clone(ROOTLOT), { status: 410 })).err, "This link has changed. Ask AGSIST for your new link.");
    assert.match((await portal(browser, port, clone(ROOTLOT), { status: 404 })).err, /not recognised/);
  } finally { await browser.close(); srv.close(); }
});

test("browser: the plan card prices the sponsor's own states and bills a deal with no free period from day one", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    // Root Lot, the free test: its own prices (TX $49, CA and NV $29), never "opens soon" for its own states
    const rl = await portal(browser, port, clone(ROOTLOT));
    assert.match(rl.billing, /\$29 to \$49/);
    assert.match(rl.billing, /Texas \$49 a month; California and Nevada \$29 a month\./);
    assert.doesNotMatch(rl.billing, /open soon|opens soon/);
    assert.doesNotMatch(rl.billing, /Free through/, "a free test has no free period to end");
    // A paid State Sponsor in Texas, typed with no trial_months (audit item 6): $49, billed from its first day
    const paid = clone(ROOTLOT);
    delete paid.freeTest; paid.billing = { tier: "state", state: "TX" }; paid.start = "2026-10-28"; paid.regions = ["TX"];
    const p = await portal(browser, port, paid);
    assert.match(p.billing, /State Sponsor · \$49 a month/);
    assert.doesNotMatch(p.billing, /\$29/);
    assert.doesNotMatch(p.billing, /Free through|free, then|Last free day|after the free period/i);
    assert.match(p.billing, /Month to month\. No minimum/);
    assert.match(p.billing, /Oct 28, 2026\s*Your ad goes live[\s\S]*Oct 28, 2026\s*First billed month\s*\$49 a month from your first day, month to month\./);
    // the same deal with its free month: "Free through <date>, then month to month", billed the day after
    const trial = clone(paid); trial.billing.trial_months = 1;
    const t = await portal(browser, port, trial);
    assert.match(t.billing, /Free through Nov 27, 2026, then month to month/);
    assert.match(t.billing, /Nov 28, 2026\s*First billed month\s*\$49 a month from here/);
    assert.doesNotMatch(t.billing, /Month to month after that/);
    // no start yet and no free period: "the day your ad goes live", never "the day after the free period ends"
    const nostart = clone(paid); nostart.start = null; delete nostart.liveSince; nostart.creative.live = false;
    const n = await portal(browser, port, nostart);
    assert.match(n.billing, /First billed month\s*The day your ad goes live, at \$49 a month\./);
    // a State Sponsor with no state on record: the general note, with the states still held
    const any = clone(paid); delete any.billing.state; any.regions = []; any.geo = null;
    const a = await portal(browser, port, any);
    assert.match(a.billing, /\$49 a month in IL, MN, WI, TX; CA, NV, TX open soon/);
  } finally { await browser.close(); srv.close(); }
});
