/* COT at a glance and the Funds this week email (2026-11-04, Sig: "concise and to the point at
 * first glance, with an option to get the report by email"; the counts file showed no cot list).
 *   - /cot opens with one plain line per market (components/cot-glance.js), each percentile naming
 *     its period, the report and release days shown, then a "Get this every Friday by email" ask that
 *     posts topic cot, then the details behind one tap;
 *   - the home COT card shows the top three markets in the reader's order, the ask and the ranges
 *     behind taps;
 *   - the home card's "Since <report day>" price change compares the HEADLINE contract with itself
 *     (AgPxStamp.headline, #320): Jan '27 soybeans on Nov 4, Mar '27 corn after Nov 30, never the
 *     continuous front month;
 *   - the stats counts file keeps the standing lists, cot at zero included (scripts/stats_ingest.py),
 *     and the COT file keeps each dated contract's report-day close (scripts/enrich_cot_prices.py).
 * Frozen inputs: test/fixtures/funds (cot.json and cot-analysis.json for the Oct 27, 2026 report; the
 * px_by_contract closes in it are made up for the test) and test/fixtures/soyroll2/prices-2026-11-04.json.
 * The browser parts route every outside host to a stub or abort and block service workers (BUILD-RULES 58).
 *
 *   node --test test/funds-glance.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);
const G = require(path.join(ROOT, "components/cot-glance.js"));
const FIX = {
  cot: path.join(ROOT, "test/fixtures/funds/cot-2026-10-27.json"),
  cx: path.join(ROOT, "test/fixtures/funds/cot-analysis-2026-10-27.json"),
  prices: path.join(ROOT, "test/fixtures/soyroll2/prices-2026-11-04.json"),
};
const COT = JSON.parse(fs.readFileSync(FIX.cot, "utf8"));
const CX = JSON.parse(fs.readFileSync(FIX.cx, "utf8"));
const PRICES = JSON.parse(fs.readFileSync(FIX.prices, "utf8"));
const DASH = /[–—]|&mdash;|&ndash;/;
const MARKETS = G.ORDER.filter((k) => COT[k] && typeof COT[k].net === "number");

// ------------------------------------------------------------------ the words
test("one line per market: long or short, how heavy, the percentile with its period, the week's change", () => {
  const ls = G.lines(COT, CX);
  assert.equal(ls.length, MARKETS.length);
  for (const l of ls) {
    const c = CX.commodities[l.key];
    assert.ok(l.text.startsWith("Funds are "), l.text);
    assert.ok(l.text.includes(`percentile since ${c.crowd.since}`), "the percentile names its period: " + l.text);
    assert.ok(l.text.includes(`(${G.ord(c.crowd.shown)} percentile`), "the page's one printed percentile: " + l.text);
    const n = Math.abs(c.chg).toLocaleString("en-US");
    assert.ok(c.chg === 0 ? l.text.includes("held steady") : l.text.includes(`${c.chg > 0 ? "bought" : "sold"} a net ${n} contracts this week`), l.text);
    assert.ok(!DASH.test(l.html), "no dashes: " + l.text);
    assert.equal((l.html.match(/<b>/g) || []).length, 1, "the market named once, in bold");
  }
  const by = Object.fromEntries(ls.map((l) => [l.key, l.text]));
  // the Oct 27 report, frozen: the words follow the cut points in cot-glance.js
  assert.equal(by.beans, "Funds are fairly heavily long soybeans (75th percentile since 2010) and sold a net 27,544 contracts this week.");
  assert.equal(by.soymeal, "Funds are heavily long soybean meal (94th percentile since 2010, crowded) and sold a net 32,164 contracts this week.");
  assert.equal(by.kcwheat, "Funds are about even in KC wheat (37th percentile since 2010) and sold a net 8,007 contracts this week.");
  assert.equal(by.leanhogs, "Funds are heavily short lean hogs (1st percentile since 2010, crowded) and sold a net 4,833 contracts this week.");
  assert.equal(G.asOf(COT, CX), "Positions as of Tuesday, Oct 27, released Friday, Oct 30.");
});

test("without the analysis for the same report, no percentile and no 'how heavy' word is guessed", () => {
  const stale = { ...CX, report_date: "2026-10-20", commodities: Object.fromEntries(Object.entries(CX.commodities).map(([k, c]) => [k, { ...c, date: "2026-10-20" }])) };
  for (const cx of [null, stale]) {
    const ls = G.lines(COT, cx, ["corn", "beans", "wheat"]);
    assert.deepEqual(ls.map((l) => l.text), [
      "Funds are long corn and sold a net 83,310 contracts this week.",
      "Funds are long soybeans and sold a net 27,544 contracts this week.",
      "Funds are short Chicago wheat and sold a net 22,601 contracts this week.",
    ]);
    assert.equal(G.asOf(COT, cx), "Positions as of Tuesday, Oct 27.", "no release day without the analysis for this report");
  }
  assert.equal(G.degree("long", 95), "heavily");
  assert.equal(G.degree("short", 8), "heavily");
  assert.equal(G.degree("short", 80), "lightly");
  assert.equal(G.degree("long", 50), "moderately");
});

test("the counts file keeps the standing lists, Funds this week at zero included", () => {
  const r = spawnSync("python3", ["scripts/stats_ingest.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const py = `import json,sys; sys.path.insert(0,"scripts"); import stats_ingest as s
print(json.dumps(s.standing_lists({"ok":True,"lists":{"cot":{"n":0,"by_source":{},"unsubs":{"d7":0}},"reports":{"n":1,"unsubs":{"d7":0}}}})))`;
  const o = spawnSync("python3", ["-c", py], { cwd: ROOT, encoding: "utf8" });
  assert.equal(o.status, 0, o.stderr);
  assert.deepEqual(JSON.parse(o.stdout), { cot: { n: 0, unsubs_d7: 0 }, reports: { n: 1, unsubs_d7: 0 } });
});

test("the COT file keeps each dated contract's report-day close (enrich_cot_prices selftest)", () => {
  const r = spawnSync("python3", ["scripts/enrich_cot_prices.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /enrich_cot_prices selftest: ok/);
});

test("the pages load the shared lines and the bumped scripts", () => {
  const cot = read("cot.html"), idx = read("index.html");
  for (const h of [cot, idx]) assert.ok(h.includes('<script src="/components/cot-glance.js?v=1"></script>'));
  assert.ok(cot.includes('<script src="/components/cot-page.js?v=5"></script>'));
  assert.ok(cot.indexOf('<script src="/components/cot-glance.js') < cot.indexOf('<script src="/components/cot-page.js'));
  assert.ok(idx.indexOf('<script src="/components/cot-glance.js') < idx.indexOf('<script src="/components/home.js'));
  // one Funds this week ask on /cot, under the lines and above the details
  assert.equal((cot.match(/data-topic="cot"/g) || []).length, 1);
  const lines = cot.indexOf('id="cg-lines"'), ask = cot.indexOf('data-topic="cot"'), all = cot.indexOf('id="cot-all"');
  assert.ok(lines > 0 && lines < ask && ask < all, "lines, then the ask, then the details");
  assert.match(cot, /data-signup-ask="Get this every Friday by email" data-topic="cot" data-source="cot-weekly:cot"/);
  assert.match(idx, /data-topic="cot" data-source="cot-weekly:home"/);
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const f = path.normalize(path.join(ROOT, p === "/" ? "/index.html" : p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
// every outside host stubbed (the worker) or aborted; our data files from the frozen fixtures
async function open(browser, port, url, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: o.width || 390, height: o.width > 900 ? 900 : 844 } });
  const pg = await ctx.newPage();
  const posts = [];
  const own = { "/data/cot.json": o.cot || fs.readFileSync(FIX.cot), "/data/cot-analysis.json": fs.readFileSync(FIX.cx), "/data/prices.json": o.prices || fs.readFileSync(FIX.prices) };
  await pg.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.origin === `http://127.0.0.1:${port}`) {
      if (own[u.pathname]) return r.fulfill({ status: 200, contentType: "application/json", body: own[u.pathname] });
      return r.continue();
    }
    if (u.origin === "https://agsist-api.dnilgis.workers.dev") {
      posts.push({ path: u.pathname, body: JSON.parse(r.request().postData() || "{}") });
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ ok: true }) });
    }
    return r.abort();
  });
  await pg.clock.setFixedTime(new Date(o.clock || "2026-11-04T15:46:20Z"));
  await pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
  return { pg, posts };
}

test("/cot: the first screen is one line per market, the ask posts topic cot, the details wait behind a tap", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const { pg, posts } = await open(browser, port, "/cot.html", { width });
      await pg.waitForFunction(() => document.querySelectorAll("#cg-lines li").length > 0 && /percentile/.test(document.getElementById("cg-lines").textContent));
      const got = await pg.$$eval("#cg-lines li", (els) => els.map((e) => e.textContent));
      assert.deepEqual(got, G.lines(COT, CX).map((l) => l.text), "the page prints cot-glance.js's lines, one per market " + width);
      assert.equal((await pg.textContent("#cg-date")).trim(), "Positions as of Tuesday, Oct 27, released Friday, Oct 30.");
      const top = await pg.$eval("#cg-lines li", (e) => e.getBoundingClientRect().top);
      assert.ok(top < 844, `the first line is on the first screen (top ${top}px) at ${width}`);
      assert.equal(await pg.$eval("#cot-all", (d) => d.open), false, "details closed");
      assert.equal(await pg.isVisible("#cot-summary-grid"), false, "the cards wait behind the tap");
      assert.equal(await pg.isVisible("#cot-baked"), false, "the crawler summary gives way to the lines");
      // the email ask, right under the lines
      const ask = pg.locator('#cot-glance [data-sa-topic="cot"]');
      await ask.locator(".sa-in").waitFor();
      assert.equal((await ask.locator(".sa-l").textContent()).trim(), "Get this every Friday by email");
      await ask.locator(".sa-in").fill("reader@example.com");
      await ask.locator(".sa-b").click();
      await ask.locator(".sa-ok").waitFor();
      assert.deepEqual(posts.filter((x) => x.path === "/notice").map((x) => x.body),
        [{ email: "reader@example.com", source: "cot-weekly:cot", topic: "cot", daily: false }], "posts the cot list " + width);
      // one tap opens the details, and the chart draws at the width it now has
      await pg.click("#cot-all > summary");
      await pg.waitForTimeout(300);
      assert.equal(await pg.isVisible("#cot-summary-grid"), true);
      const cw = await pg.$eval("#cot-chart", (c) => c.width);
      assert.ok(cw > 200, "the chart drew after the tap: " + cw);
      await pg.context().close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("home card: the top three markets in plain lines, the ask and the ranges behind taps", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const { pg, posts } = await open(browser, port, "/index.html", { width });
      await pg.evaluate(() => { let d = document.getElementById("cot-widget"); while (d) { if (d.tagName === "DETAILS") d.open = true; d = d.parentElement; } document.getElementById("cot-widget").scrollIntoView(); });
      await pg.waitForFunction(() => /percentile/.test((document.getElementById("cot-glance") || {}).textContent || ""));
      const got = await pg.$$eval("#cot-glance li", (els) => els.map((e) => e.textContent));
      assert.deepEqual(got, G.lines(COT, CX, ["corn", "beans", "wheat"]).map((l) => l.text), "three lines, the reader's first three markets " + width);
      assert.equal((await pg.textContent("#cot-gl-asof")).trim(), "Positions as of Tuesday, Oct 27, released Friday, Oct 30.");
      assert.equal(await pg.$eval("#cot-detail", (d) => d.open), false);
      assert.equal(await pg.$eval("#cot-ask", (d) => d.open), false);
      await pg.click("#cot-ask > summary");
      const ask = pg.locator('#cot-ask [data-sa-topic="cot"]');
      await ask.locator(".sa-in").fill("reader@example.com");
      await ask.locator(".sa-b").click();
      await ask.locator(".sa-ok").waitFor();
      assert.deepEqual(posts.filter((x) => x.path === "/notice").map((x) => x.body),
        [{ email: "reader@example.com", source: "cot-weekly:home", topic: "cot", daily: false }], "home ask posts the cot list " + width);
      await pg.context().close();
    }
  } finally { await browser.close(); srv.close(); }
});

// the change the card prints, from the fixtures: headline close today minus that contract's report-day close
const cents = (d) => { const a = Math.abs(d), w = Math.floor(a + 1e-9), f = Math.round((a - w) * 4); return (w ? String(w) : "") + (f ? (w ? " " : "") + ["", "1/4", "1/2", "3/4"][f] : (w ? "" : "0")); };

test("home card: price since the report is on the headline contract (Jan '27 soybeans on Nov 4; Mar '27 corn after Nov 30)", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const pxLine = async (pg, id) => {
    await pg.evaluate(() => { const d = document.getElementById("cot-detail"); if (d) d.open = true; });
    await pg.waitForFunction((i) => !!document.querySelector("#cot-widget .cot-row-" + i + " .r7-cot-px"), id);
    return (await pg.textContent(`#cot-widget .cot-row-${id} .r7-cot-px`)).replace(/ /g, " ");
  };
  try {
    // Nov 4, 2026: soybeans rolled to Jan '27 at first notice; corn is still Dec '26
    let { pg } = await open(browser, port, "/index.html");
    const q = PRICES.quotes;
    assert.equal(q["beans-nearby"].ticker, "ZSF27.CBT");
    const beans = await pxLine(pg, "beans");
    const dBeans = q["beans-jan27"].close - COT.beans.px_by_contract["ZSF27.CBT"];
    assert.equal(beans, `Since Oct 27: ${dBeans < 0 ? "−" : "+"}${cents(dBeans)}¢ per bu, Jan '27 futures`);
    assert.ok(!/front month|Nov '26/.test(beans), "never the continuous front month: " + beans);
    const dCorn = q["corn-dec26"].close - COT.corn.px_by_contract["ZCZ26.CBT"];
    assert.equal(await pxLine(pg, "corn"), `Since Oct 27: ${dCorn < 0 ? "−" : "+"}${cents(dCorn)}¢ per bu, Dec '26 futures`);
    // a market whose report-day close for the headline contract is not on file prints nothing
    assert.equal(await pg.$("#cot-widget .cot-row-wheat .r7-cot-px"), null, "no close on file for wheat's headline: nothing printed");
    await pg.context().close();

    // Dec 1, 2026: corn's headline is Mar '27 (the price file's corn-nearby alias, rolled at first notice Nov 30)
    const dec = JSON.parse(JSON.stringify(PRICES));
    dec.quotes["corn-nearby"] = { ...dec.quotes["corn-mar27"], alias_of: "corn-mar27", contract: "Mar '27" };
    dec.nearby.corn = { key: "corn-mar27", label: "Mar '27" };
    ({ pg } = await open(browser, port, "/index.html", { prices: JSON.stringify(dec), clock: "2026-12-01T15:00:00Z" }));
    const dMar = dec.quotes["corn-mar27"].close - COT.corn.px_by_contract["ZCH27.CBT"];
    assert.equal(await pxLine(pg, "corn"), `Since Oct 27: ${dMar < 0 ? "−" : "+"}${cents(dMar)}¢ per bu, Mar '27 futures`);
    await pg.context().close();
  } finally { await browser.close(); srv.close(); }
});
