/* The "What the numbers would pick" panel (components/prf-optimize-ui.js)
 * rendered in a real browser, fed the way components/prf.js will feed it,
 * from test/fixtures/prf/opt-grid-30454.json and the shipped data/prf/opt.json.
 *
 * Checks: the disclaimer and the verdict come first; the pick on screen obeys
 * the county's rules; both scores and the ENSO choice redraw; "Use this setup"
 * hands the calculator a legal split, and is not offered when this grid's own
 * walk-forward test says the pick would not have beaten an even spread (the
 * card then leads with that); nothing scrolls sideways at phone width; no em
 * dash; no console error; light and dark both render.
 *
 * Needs Playwright and Chromium. Where they are missing (CI without a
 * browser), the test is skipped and says so.
 *
 *   node --test test/prf-optimize-ui.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const SHOTS = process.env.PRF_OPT_SHOTS || null;
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const FX = JSON.parse(readFileSync(ROOT + "test/fixtures/prf/opt-grid-30454.json", "utf8"));
/* a second grid, where the local test does not put the pick behind an even spread */
const FX2 = JSON.parse(readFileSync(ROOT + "test/fixtures/prf/opt-grid-16014.json", "utf8"));
const ctxVm = { window: {}, Buffer };
vm.runInNewContext(readFileSync(ROOT + "components/prf-math.js", "utf8"), ctxVm);
const M = ctxVm.window.AgPrfMath;
vm.runInNewContext(readFileSync(ROOT + "components/prf-optimize.js", "utf8"), ctxVm);
const O = ctxVm.window.AgPrfOptimize;
/* this grid's own walk-forward verdict, worked out here the way the panel asks for it */
function localVerdict(objective, fx = FX) {
  const lim = fx.lim;
  const res = O.recommend({ index: fx.index, rates: fx.rates[90], coverage: 90, subsidy: fx.subsidy["90"], min: lim.map((p) => (p ? p[0] : null)),
                            max: lim.map((p) => (p ? p[1] : null)), valid: lim.map(Boolean), avgMm: fx.avgMm, lastComplete: fx.last_complete, grid: fx.grid },
                          { objective, steadier: !!(OPT.risk && OPT.risk.held) });
  return res.backtest ? res.backtest.verdict.key : null;
}
const OPT = JSON.parse(readFileSync(ROOT + "data/prf/opt.json", "utf8"));

/* the outlook another script will publish; the shape prf-optimize.js reads */
const OUTLOOK = { issued: "2026-10-15", source: "fixture", enso: { phase: "La Nina", oni: -0.6, season: "ASO", year: 2026 },
                  intervals: { "625": { below: 0.45, near: 0.33, above: 0.22 }, "635": { below: 0.42, near: 0.33, above: 0.25 }, "630": { below: 0.3, near: 0.33, above: 0.37 } } };

const PAGE = `<!doctype html><html lang="en" data-theme="THEME"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/components/styles.css"><link rel="stylesheet" href="/components/prf.css"></head>
<body style="background:var(--bg)"><main class="prf" style="max-width:1100px;margin:0 auto;padding:0 16px">
<section id="prf-optimize" class="prf-block" aria-labelledby="prf-opt-h">
  <h2 id="prf-opt-h">What the numbers would pick</h2>
  <p class="po-note">This is what the history and current outlook point to, not advice. RMA rates already price most of this in.</p>
  <div data-opt-body></div>
</section></main>
<script src="/components/prf-math.js"></script><script src="/components/prf-optimize.js"></script><script src="/components/prf-optimize-ui.js"></script>
<script>
  window.__applied = [];
  fetch('/__fixture' + location.search).then(function (r) { return r.json(); }).then(function (fx) {
    var lim = fx.lim;
    window.__ctx = { grid: fx.grid, county: 'Barron County, WI', index: fx.index, rates: fx.rates, avgMm: fx.avgMm,
      limits: { min: lim.map(function (p) { return p ? p[0] : null; }), max: lim.map(function (p) { return p ? p[1] : null; }), valid: lim.map(function (p) { return !!p; }) },
      cov: 90, pf: 100, acres: 1000, share: 100, cbv: fx.cbv_grazing, subsidy: fx.subsidy, lastComplete: fx.last_complete, src: '/data/prf/',
      apply: function (sp) { window.__applied.push(sp); } };
    AgPrfOptUI.update(window.__ctx);
  });
</script></body></html>`;

function serve(withOutlook) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html" };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/__page") { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE.replace("THEME", u.searchParams.get("theme") || "light")); return; }
    if (u.pathname === "/__fixture") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(u.searchParams.get("fx") === "2" ? FX2 : FX)); return; }
    if (u.pathname === "/data/prf/outlook.json") {
      if (!withOutlook) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(OUTLOOK)); return;
    }
    const p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function open(browser, port, theme, width, fx) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/__page?theme=${theme}${fx ? "&fx=" + fx : ""}`);
  await page.waitForSelector("#prf-optimize .po-split", { timeout: 15000 });
  return { page, errors };
}
function splitOnScreen(page) {
  return page.$$eval("#prf-optimize .po-iv", (ds) => ds.map((d) => [d.querySelector("span").textContent, parseInt(d.querySelector("b").textContent, 10)]))
    .then((pairs) => { const sp = new Array(11).fill(0); for (const [l, v] of pairs) sp[M.LABELS.indexOf(l)] = v; return sp; });
}
function buttonSplit(page) {
  return page.$eval("#prf-optimize .po-use", (b) => b.getAttribute("data-opt-use").split(".").map(Number));
}
function legal(split, fx = FX) {
  const min = fx.lim.map((p) => (p ? p[0] : null)), max = fx.lim.map((p) => (p ? p[1] : null));
  const chk = M.checkSplit(split, min, max, fx.lim.map(Boolean));
  return chk.ok && chk.used >= 2;
}

test("the panel, with no outlook file: verdict first, legal pick, both scores, the button, phone width", { skip }, async () => {
  const srv = await serve(false), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { page, errors } = await open(browser, port, "light", 390);
    const text = await page.$eval("#prf-optimize", (s) => s.innerText);
    assert.ok(text.indexOf("not advice") < text.indexOf("The pick"), "the disclaimer comes before the pick");
    const verdict = await page.$eval("#prf-optimize .po-verdict", (p) => p.textContent);
    const r = OPT.results["90_net"];
    const behind = localVerdict("net") === "behind";
    assert.ok(behind, "the fixture grid is the case the card used to contradict; if it changes, pick a grid where the local test is behind");
    assert.ok(verdict.startsWith("Picking months this way would not have beaten an even spread on grid " + FX.grid + "."), "the card leads with the local verdict: " + verdict);
    assert.ok(text.indexOf(verdict.slice(0, 40)) < text.indexOf("The pick"), "the local verdict comes before the pick");
    assert.ok(text.includes(r.grids.toLocaleString("en-US") + " grids"), "the national line is still shown");
    assert.ok(text.includes(`${r.yearsAheadOfEven} of ${r.years.n} years`), "the national line is still shown");
    assert.equal(await page.$$eval("#prf-optimize .po-use", (bs) => bs.length), 0, "no button to copy a pick the local test says would not have beaten an even spread");
    assert.ok(text.includes("That is why winter and fall months look good on a payback table."), "a pick mostly in winter carries the page's own warning");
    assert.ok(text.includes("Would it have worked here?"), "the grid's own out-of-sample record is shown");
    assert.ok(/not loaded/.test(text), "says the outlook is not loaded");
    assert.ok(text.includes("What we tested"), "the list of what was tried is offered");
    const testedText = await page.$eval("#prf-optimize", (s) => s.textContent);
    for (const p of Object.values(OPT.predictors)) assert.ok(testedText.includes(p.line), `missing line: ${p.line}`);
    assert.ok(!text.includes("—"), "no em dash");
    assert.ok(!/NaN|undefined|\bnull\b/.test(text), "no broken number");

    const a0 = await splitOnScreen(page);
    assert.ok(legal(a0), `pick on screen breaks a rule: ${a0}`);
    const chips = await page.$$eval("#prf-optimize .po-iv b", (bs) => bs.map((b) => parseInt(b.textContent, 10)));
    assert.equal(chips.reduce((x, y) => x + y, 0), 100);

    await page.click('[data-opt-obj="dry"]');
    assert.equal(await page.getAttribute('[data-opt-obj="dry"]', "aria-pressed"), "true");
    const dryText = await page.$eval("#prf-optimize", (s) => s.innerText);
    assert.ok(dryText.includes("driest fifth of years"), "says which score is shown");
    assert.notEqual(localVerdict("dry"), "behind", "the fixture's dry score is not behind, so its button shows");
    assert.ok(!(await page.$eval("#prf-optimize .po-verdict", (p) => p.textContent)).startsWith("Picking months this way would not"), "no local lead when the local test is not behind");
    const a = await splitOnScreen(page);
    assert.ok(legal(a));
    assert.deepEqual(await buttonSplit(page), a, "the button carries the split on screen");
    await page.click("#prf-optimize .po-use");
    const applied = await page.evaluate(() => window.__applied);
    assert.equal(applied.length, 1);
    assert.deepEqual(applied[0], a, "the button hands the calculator the split on screen");

    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, `page scrolls sideways at 390px: ${sw}`);
    if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: SHOTS + "/opt-390-light.png", fullPage: true }); }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("the panel with NOAA's outlook and ENSO: the tilt is shown as untested, and the reader can change ENSO", { skip }, async () => {
  const srv = await serve(true), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { page, errors } = await open(browser, port, "dark", 1100);
    let text = await page.$eval("#prf-optimize", (s) => s.innerText);
    assert.ok(text.includes("This fall reads La Niña"), "the ENSO reading from the file is used");
    assert.ok(text.includes("issued 2026-10-15"));
    assert.ok(/could not be, because past outlooks are not in the data/.test(text), "says the monthly outlook is untested");
    assert.ok(/The outlook (moved \d+% of the policy|did not change the pick)/.test(text));
    assert.ok(text.includes("With the outlook"), "the table shows the outlook pick beside the record alone");
    assert.ok(legal(await splitOnScreen(page)));
    await page.selectOption("#prf-opt-enso", "el-nino");
    text = await page.$eval("#prf-optimize", (s) => s.innerText);
    assert.ok(text.includes("This fall reads El Niño"));
    assert.ok(legal(await splitOnScreen(page)));
    await page.selectOption("#prf-opt-enso", "none");
    text = await page.$eval("#prf-optimize", (s) => s.innerText);
    assert.ok(!text.includes("This fall reads"), "left out means left out");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const fg = await page.$eval("#prf-optimize .po-verdict", (p) => getComputedStyle(p).color);
    assert.notEqual(bg, fg);
    if (SHOTS) await page.screenshot({ path: SHOTS + "/opt-1100-dark.png", fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("the steadier option: shown only when the published test held, labeled, legal, and its button hands over its own split", { skip }, async () => {
  const srv = await serve(false), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const held = !!(OPT.risk && OPT.risk.held);
    /* grid 30454: the local test is behind, so the line shows and no button does */
    let { page, errors } = await open(browser, port, "light", 390);
    assert.equal(localVerdict("net"), "behind");
    assert.equal((await page.$eval("#prf-optimize", (s) => s.textContent)).includes("Steadier option:"), held, "the labeled line follows opt.json's verdict");
    assert.equal(await page.$$eval("#prf-optimize .po-use", (bs) => bs.length), 0, "no copy buttons while the local test is behind");
    assert.deepEqual(errors, []);
    await page.close();
    /* grid 16014: not behind, so both buttons */
    ({ page, errors } = await open(browser, port, "light", 390, 2));
    assert.notEqual(localVerdict("net", FX2), "behind");
    const text = await page.$eval("#prf-optimize", (s) => s.textContent);
    assert.ok(!text.includes("Picking months this way would not have beaten an even spread on grid"), "no local lead when the local test is not behind");
    assert.equal(text.includes("Steadier option:"), held, "the labeled line follows opt.json's verdict");
    if (OPT.risk) assert.ok(text.includes(OPT.risk.line), "the risk test is listed under what we tested");
    if (OPT.productivity) assert.ok(text.includes(OPT.productivity));
    const btns = await page.$$eval("#prf-optimize .po-use", (bs) => bs.map((b) => b.getAttribute("data-opt-use").split(".").map(Number)));
    assert.deepEqual(btns[0], await splitOnScreen(page), "the first button carries the pick on screen");
    assert.ok(legal(btns[0], FX2));
    if (held) {
      assert.equal(btns.length, 2);
      assert.ok(legal(btns[1], FX2), `steadier split breaks a rule: ${btns[1]}`);
      assert.notDeepEqual(btns[1], btns[0]);
      await page.click("#prf-optimize .po-use >> nth=1");
      assert.deepEqual((await page.evaluate(() => window.__applied))[0], btns[1]);
      const r = OPT.risk.byCoverage["90"];
      assert.ok(text.includes(`from ${r.noPaymentPct.plain}% to ${r.noPaymentPct.steadier}%`), "the across-grid figures are the 90% ones");
    } else assert.equal(btns.length, 1);
    assert.ok(!/NaN|undefined|\bnull\b/.test(text) && !text.includes("—"));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
