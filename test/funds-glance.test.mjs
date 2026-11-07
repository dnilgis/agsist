/* COT at a glance and the Funds this week email (2026-11-04, Sig: "concise and to the point at
 * first glance, with an option to get the report by email"; the counts file showed no cot list).
 *   - /cot opens with the crowded verdict when it fits one line (else the report's dates), then the
 *     52-week chart with one brief line for the market picked (Nov 5, Sig: "KISS"; test/cot-chart.test.mjs),
 *     every market as a table row behind one "All markets" tap, then a "Get this every Friday by email"
 *     ask that posts topic cot, then the details behind one tap; no sentence per market;
 *   - the home COT card shows the top three markets in the reader's order as short rows (market, long
 *     or short, change), the ask and the ranges behind taps;
 *   - the sentence form (line(), lines()) is kept in cot-glance.js and tested here;
 *   - the home card's "Since <report day>" price change compares the HEADLINE contract with itself
 *     (AgPxStamp.headline, #320): Jan '27 soybeans on Nov 4, Mar '27 corn after Nov 30, never the
 *     continuous front month;
 *   - the stats counts file keeps the standing lists, cot at zero included (scripts/stats_ingest.py),
 *     and the COT file keeps each dated contract's report-day close (scripts/enrich_cot_prices.py).
 * Frozen inputs: test/fixtures/funds (cot.json, cot-analysis.json and cot-history.json for the Oct 27, 2026 report; the
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
  hist: path.join(ROOT, "test/fixtures/funds/cot-history-2026-10-27.json"),
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
    assert.ok(l.text.includes(`of weeks since ${c.crowd.since}`), "the rank names its period: " + l.text);
    assert.ok(l.text.includes(`(${c.crowd.words}`), "the page's one printed rank, in words: " + l.text);
    assert.doesNotMatch(l.text, /\d(st|nd|rd|th)\b/, "no ordinals: " + l.text);
    const n = Math.abs(c.chg).toLocaleString("en-US");
    assert.ok(c.chg === 0 ? l.text.includes("held steady") : l.text.includes(`${c.chg > 0 ? "bought" : "sold"} a net ${n} contracts this week`), l.text);
    assert.ok(!DASH.test(l.html), "no dashes: " + l.text);
    assert.equal((l.html.match(/<b>/g) || []).length, 1, "the market named once, in bold");
  }
  const by = Object.fromEntries(ls.map((l) => [l.key, l.text]));
  // the Oct 27 report, frozen: the words follow the cut points in cot-glance.js
  assert.equal(by.beans, "Funds are fairly heavily long soybeans (higher than 75% of weeks since 2010) and sold a net 27,544 contracts this week.");
  assert.equal(by.soymeal, "Funds are heavily long soybean meal (higher than 94% of weeks since 2010, crowded) and sold a net 32,164 contracts this week.");
  assert.equal(by.kcwheat, "Funds are about even in KC wheat (a bigger net short than 63% of weeks since 2010) and sold a net 8,007 contracts this week.");
  assert.equal(by.leanhogs, "Funds are heavily short lean hogs (a bigger net short than 99% of weeks since 2010, crowded) and sold a net 4,833 contracts this week.");
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

test("the weight word follows the printed percentile: 74.6 and 75.2 both print 75 and get one word", () => {
  const base = CX.commodities.beans;
  const mk = (pctl) => ({ ...base, crowded: null, crowd: { ...base.crowd, pctl, shown: Math.round(pctl), crowded: null, words: undefined } });
  const a = G.line("beans", mk(74.6), true), b = G.line("beans", mk(75.2), true);
  assert.ok(a.text.includes("(higher than 75% of weeks since 2010)") && b.text.includes("(higher than 75% of weeks since 2010)"), a.text + " / " + b.text);
  assert.equal(a.text, b.text, "one printed number, one word");
  assert.match(a.text, /^Funds are fairly heavily long soybeans/);
  // the same on the short side: 25.4 and 24.6 both print 25
  const sh = (pctl) => ({ ...CX.commodities.wheat, crowded: null, crowd: { ...CX.commodities.wheat.crowd, pctl, shown: Math.round(pctl), crowded: null, words: undefined } });
  assert.equal(G.line("wheat", sh(25.4), true).text.replace(/\d+%/, "N"), G.line("wheat", sh(24.6), true).text.replace(/\d+%/, "N"));
  assert.ok(read("components/cot-glance.js").includes("Funds are fairly heavily long soybeans (higher than 75% of weeks since 2010)"), "the header example matches the words");
});

test("the crowded verdict reads every market: never 'No market crowded' while any market is crowded", () => {
  // the Oct 27 report: meal crowded long, hogs and milk crowded short, none of them among corn, soybeans, wheat
  const v = G.crowdedLine(COT, CX);
  assert.deepEqual(v, { state: "mixed", text: "Crowded: soybean meal (long), lean hogs and Class III milk (short)", markets: 11 });
  // each market crowded alone, either side: the verdict names it and never says none
  for (const k of G.ORDER) for (const side of ["long", "short"]) {
    const cx = { ...CX, commodities: Object.fromEntries(Object.entries(CX.commodities).map(([kk, c]) => [kk, { ...c, crowded: kk === k ? side : null }])) };
    const w = G.crowdedLine(COT, cx);
    assert.equal(w.state, side, k + " " + side);
    assert.equal(w.text, `Crowded: ${G.NAMES[k]} (${side})`);
  }
  const calm = { ...CX, commodities: Object.fromEntries(Object.entries(CX.commodities).map(([k, c]) => [k, { ...c, crowded: null }])) };
  assert.equal(G.crowdedLine(COT, calm).text, "No market crowded");
  assert.equal(G.crowdedLine(COT, null), null, "no analysis for this report: nothing claimed");
  const h = read("components/home.js");
  assert.ok(h.includes("G.crowdedLine(data,COT_CX)") && !/label\+': none crowded'/.test(h), "the home card uses the shared verdict, not the four-row badges");
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
  for (const h of [cot, idx]) assert.ok(h.includes('<script src="/components/cot-glance.js?v=6"></script>'));
  assert.ok(cot.includes('<script src="/components/cot-page.js?v=12"></script>'));
  assert.ok(cot.indexOf('<script src="/components/cot-glance.js') < cot.indexOf('<script src="/components/cot-page.js'));
  assert.ok(idx.indexOf('<script src="/components/cot-glance.js') < idx.indexOf('<script src="/components/home.js'));
  // one Funds this week ask on /cot, under the chart and the market table, above the details
  assert.equal((cot.match(/data-topic="cot"/g) || []).length, 1);
  const verdict = cot.indexOf('id="cg-verdict"'), chart = cot.indexOf('id="cot-chart-box"'), table = cot.indexOf('id="cg-all"'), ask = cot.indexOf('data-topic="cot"'), all = cot.indexOf('id="cot-all"');
  assert.ok(verdict > 0 && verdict < chart && chart < table && table < ask && ask < all, "verdict, chart, table, the ask, then the details");
  assert.ok(!cot.includes('id="cg-lines"'), "no sentence per market at the top");
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
  if (o.init) await pg.addInitScript(o.init);
  const posts = [];
  const own = { "/data/cot.json": o.cot || fs.readFileSync(FIX.cot), "/data/cot-analysis.json": fs.readFileSync(FIX.cx), "/data/cot-history.json": fs.readFileSync(FIX.hist), "/data/prices.json": o.prices || fs.readFileSync(FIX.prices), ...(o.own || {}) };
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

test("/cot: the first screen is the verdict and the chart, every market in a table behind a tap, the ask posts topic cot", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const { pg, posts } = await open(browser, port, "/cot.html", { width });
      await pg.waitForFunction(() => document.querySelectorAll("#cg-rows tr").length > 0 && /\d+%/.test(document.getElementById("cg-rows").textContent));
      // every market, one row each: market | long or short | rank | change
      const got = await pg.$$eval("#cg-rows tr", (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent)));
      assert.deepEqual(got, G.rows(COT, CX).map((r) => [r.name, r.pos, r.rank, r.chg]), "the table prints cot-glance.js's rows " + width);
      assert.equal(await pg.$eval("#cg-all", (d) => d.open), false, "the table waits behind one tap");
      // the verdict on one line when it fits, else the report's dates
      const v = await pg.$eval("#cg-verdict", (e) => ({ t: e.textContent, h: e.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(e).fontSize), sw: e.scrollWidth, cw: e.clientWidth }));
      assert.ok([G.verdict(COT, CX), G.asOfShort(COT, CX)].includes(v.t), v.t);
      assert.ok(v.h < v.fs * 2 && v.sw <= v.cw + 1, "one line: " + JSON.stringify(v));
      if (width === 1280) assert.equal(v.t, "Crowded: soybean meal long; lean hogs, Class III milk short");
      const top = await pg.$eval("#cc-head", (e) => e.getBoundingClientRect().bottom);
      assert.ok(top < 844, `the chart's line is on the first screen (bottom ${top}px) at ${width}`);
      assert.equal(await pg.$eval("#cot-all", (d) => d.open), false, "details closed");
      assert.equal(await pg.isVisible("#cot-summary-grid"), false, "the cards wait behind the tap");
      assert.equal(await pg.isVisible("#cot-baked"), false, "the crawler summary stays out of view");
      // the email ask, under the chart and the table
      const ask = pg.locator('#cot-glance [data-sa-topic="cot"]');
      await ask.locator(".sa-in").waitFor();
      assert.equal((await ask.locator(".sa-l").textContent()).trim(), "Get this every Friday by email");
      await ask.locator(".sa-in").fill("reader@example.com");
      await ask.locator(".sa-b").click();
      await ask.locator(".sa-ok").waitFor();
      assert.deepEqual(posts.filter((x) => x.path === "/notice").map((x) => x.body),
        [{ email: "reader@example.com", source: "cot-weekly:cot", topic: "cot", daily: false }], "posts the cot list " + width);
      // the 52-week chart (2026-11-05) is out in the open under the lines, drawn before any tap
      const cw = await pg.$eval("#cc-svg", (c) => c.getBoundingClientRect().width);
      assert.ok(cw > 200 && (await pg.$$("#cc-svg path")).length > 2, "the chart drew without a tap: " + cw);
      // one tap opens the details
      await pg.click("#cot-all > summary");
      await pg.waitForTimeout(300);
      assert.equal(await pg.isVisible("#cot-summary-grid"), true);
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
      await pg.waitForFunction(() => /moderate|heavy|light/.test((document.getElementById("cot-glance") || {}).textContent || ""));
      const got = await pg.$$eval("#cot-glance li", (els) => els.map((e) => e.textContent));
      assert.deepEqual(got, G.rows(COT, CX, ["corn", "beans", "wheat"]).map((r) => r.name + r.pos + r.chg), "three short rows, the reader's first three markets " + width);
      assert.equal((await pg.textContent("#cot-gl-asof")).trim(), "Positions as of Tuesday, Oct 27, released Friday, Oct 30.");
      assert.equal((await pg.textContent("#cot-verdict")).trim(), "Crowded: soybean meal (long), lean hogs and Class III milk (short)", "the verdict over all markets " + width);
      assert.equal(await pg.locator("#cot-verdict-lv").count(), 0, "one verdict, not a grains and a cattle badge");
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

test("after a Daily signup One more? keeps a Funds this week row even with ZIP, rain and rent on offer", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  // Story County, Iowa: a ZIP alert, the county's rain year and Iowa rents are all on offer
  const rain = JSON.stringify({ year: 2026, edate: "2026-11-03", counties: { "19169": { name: "Story County" } } });
  const run = async (init) => {
    const { pg, posts } = await open(browser, port, "/index.html", { width: 390, own: { "/data/rain/ia.json": rain }, init });
    await pg.waitForFunction(() => !!document.body);
    if (!(await pg.evaluate(() => !!(window.AgsistSignup && window.AgsistSignup.oneMore)))) await pg.addScriptTag({ url: "/components/signup-ask.js?v=21" });
    await pg.waitForFunction(() => window.AgsistSignup && window.AgsistSignup.oneMore);
    await pg.evaluate(() => { const h = document.createElement("div"); h.id = "t-host"; document.body.prepend(h);
      window.AgsistSignup.oneMore(h, { gave: "daily", email: "reader@example.com", zip: "50010", fips: "19169" }); });
    const more = pg.locator("#t-host [data-sa-more]");
    await more.locator(".sa-mh").waitFor();
    const keys = await more.locator("[data-k]").evaluateAll((a) => a.map((x) => x.getAttribute("data-k")));
    return { pg, posts, more, keys };
  };
  try {
    const a = await run();
    assert.deepEqual(a.keys, ["zip", "rainyear", "cot"], "three rows, Funds this week among them");
    await a.more.locator('[data-k="cot"] input').check();
    await a.more.locator(".sa-b").click();
    await a.more.locator(".sa-ok").waitFor();
    assert.deepEqual(a.posts.filter((x) => x.path === "/notice").map((x) => [x.body.topic, x.body.daily]), [["cot", false]], "posts the cot list");
    await a.pg.context().close();
    // a reader who already has it is not asked again
    const b = await run(() => { localStorage.setItem("agsist_notices", JSON.stringify({ cot: Date.parse("2026-10-30T12:00:00Z") })); });
    assert.deepEqual(b.keys, ["zip", "rainyear", "rent"]);
    await b.pg.context().close();
  } finally { await browser.close(); srv.close(); }
});
