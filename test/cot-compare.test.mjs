/* Compare mode on the /cot 52-week chart (2026-11-05, Sig: "Is there a way to select multiple commodities in the COT chart?").
 *   - a Compare toggle next to the chips; in it the chips pick up to three markets, a fourth is refused with a short note;
 *   - one 0 to 100 axis (the weekly file carries no open interest, so each week is placed among that market's own 52 weeks);
 *   - the link carries ?m=corn,soybeans,chicago-wheat and opens on those picks; single mode and its links are unchanged;
 *   - hover shows the date and every market's value; Share and Save image work; text 12 px or more, taps 44 px or more.
 * Browser parts route every outside host to a stub or abort and block service workers (BUILD-RULES 58).
 *
 *   node --test test/cot-compare.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const G = require(path.join(ROOT, "components/cot-glance.js"));
const C = require(path.join(ROOT, "components/cot-chart.js"));
const FIX = {
  cot: path.join(ROOT, "test/fixtures/funds/cot-2026-10-27.json"),
  cx: path.join(ROOT, "test/fixtures/funds/cot-analysis-2026-10-27.json"),
  hist: path.join(ROOT, "test/fixtures/funds/cot-history-2026-10-27.json"),
};
const COT = JSON.parse(fs.readFileSync(FIX.cot, "utf8"));
const CX = JSON.parse(fs.readFileSync(FIX.cx, "utf8"));
const HIST = JSON.parse(fs.readFileSync(FIX.hist, "utf8"));
const DASH = /[–—]|&mdash;|&ndash;/;

test("the model: two and three markets, one value per week, equal to the week's place among that market's 52 weeks", () => {
  for (const keys of [["corn", "beans"], ["corn", "beans", "wheat"]]) {
    const m = C.cmpModel(keys, HIST, COT, CX);
    assert.equal(m.series.length, keys.length);
    assert.equal(m.dates.length, 52);
    for (const s of m.series) {
      const rows = HIST.history[s.key].slice(-52);
      assert.equal(s.vals.length, 52);
      // recount from the file: share of the other weeks below this one (ties half), on a 0 to 100 scale
      for (const i of [0, 17, 51]) {
        const v = rows[i].net;
        const below = rows.filter((r) => r.net < v).length, eq = rows.filter((r) => r.net === v).length;
        assert.ok(Math.abs(s.vals[i] - ((below + (eq - 1) / 2) / 51) * 100) < 1e-9, s.key + " week " + i);
        assert.equal(s.by[rows[i].date], v);
      }
      assert.equal(Math.max(...s.vals), 100, s.key + " highest week is 100");
      assert.equal(Math.min(...s.vals), 0, s.key + " lowest week is 0");
    }
  }
});

test("the headline names the markets; no dash; labels at the line ends and 12 px text", () => {
  const m = C.cmpModel(["corn", "beans", "wheat"], HIST, COT, CX);
  assert.equal(m.headline, "Funds in corn, soybeans and Chicago wheat, ranked against each market’s own 52 weeks");
  assert.equal(C.cmpModel(["corn", "beans"], HIST, COT, CX).headline.split(",")[0], "Funds in corn and soybeans");
  assert.ok(!DASH.test(m.headline + m.axis + m.src));
  const g = C.layout(m, 340, 300, { fs: 12 });
  const texts = g.items.filter((i) => i.t === "text");
  assert.ok(texts.every((t) => t.size >= 12), "text 12 px or more");
  for (const s of m.series) {
    const end = Math.round(s.vals[51]);
    assert.ok(texts.some((t) => t.s === s.name + " " + end), "a direct label at the end of " + s.name);
  }
  const ys = texts.filter((t) => /^(Corn|Soybeans|Chicago wheat) \d+$/.test(t.s)).map((t) => t.y).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 12, "end labels do not sit on each other");
  assert.ok(g.items.some((i) => i.t === "line" && i.ink === "zero"), "the middle is marked");
});

test("single mode is unchanged: model, layout and the link still work as before", () => {
  const m = C.model("beans", HIST, COT, CX);
  assert.equal(m.headline, "Soybeans: funds long, fairly heavy (75th since 2010), sold 27,544 this week");
  assert.ok(!m.cmp);
});

// ------------------------------------------------------------------ the page
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    if (!path.extname(p)) p += ".html";
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, url, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true, viewport: { width: o.width || 390, height: o.width > 900 ? 900 : 844 } });
  const pg = await ctx.newPage();
  const own = { "/data/cot.json": fs.readFileSync(FIX.cot), "/data/cot-analysis.json": fs.readFileSync(FIX.cx), "/data/cot-history.json": fs.readFileSync(FIX.hist) };
  await pg.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.origin === `http://127.0.0.1:${port}`) {
      if (own[u.pathname]) return r.fulfill({ status: 200, contentType: "application/json", body: own[u.pathname] });
      return r.continue();
    }
    if (u.origin === "https://agsist-api.dnilgis.workers.dev")
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ ok: true }) });
    return r.abort();
  });
  await pg.clock.setFixedTime(new Date("2026-11-04T15:46:20Z"));
  await pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
  await pg.waitForFunction(() => { const b = document.getElementById("cot-chart-box"); return b && b.dataset.latest; });
  if (o.shot) await pg.screenshot({ path: o.shot });
  return pg;
}
const boxH = (pg) => pg.$eval("#cot-chart-box", (b) => b.getBoundingClientRect().height);

test("compare on the page: 2 and 3 picks, a 4th refused, the link round-trips, no layout shift, taps 44 px", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const shot = process.env.COT_SHOTS ? `${process.env.COT_SHOTS}/compare-${width}.png` : null;
      const pg = await open(browser, port, "/cot?m=corn", { width });
      const h0 = await boxH(pg), sw0 = await pg.evaluate(() => document.documentElement.scrollWidth);
      const tap = await pg.$eval("#cc-cmp", (b) => b.getBoundingClientRect().height);
      assert.ok(tap >= 44, "Compare tap target " + tap);
      assert.equal(await pg.getAttribute("#cc-cmp", "aria-pressed"), "false");
      await pg.click("#cc-cmp");
      assert.equal(await pg.getAttribute("#cc-cmp", "aria-pressed"), "true");
      assert.equal(await pg.$eval("#cot-chart-box", (b) => b.dataset.mode), "compare");
      await pg.click('.cc-chip[data-k="beans"]');
      assert.equal(new URL(pg.url()).searchParams.get("m"), "corn,soybeans");
      assert.match(pg.url(), /\?m=corn,soybeans$/, "a plain comma in the link");
      assert.equal((await pg.textContent("#cc-head")).trim(), "Funds in corn and soybeans, ranked against each market’s own 52 weeks");
      await pg.click('.cc-chip[data-k="wheat"]');
      assert.match(pg.url(), /\?m=corn,soybeans,chicago-wheat$/);
      assert.equal((await pg.textContent("#cc-head")).trim(), "Funds in corn, soybeans and Chicago wheat, ranked against each market’s own 52 weeks");
      if (shot) await (await pg.$("#cot-chart-box")).screenshot({ path: shot });
      // the fourth is refused with a short note
      await pg.click('.cc-chip[data-k="kcwheat"]');
      assert.match(await pg.textContent("#cc-toast"), /^Pick up to 3 markets/);
      assert.match(pg.url(), /\?m=corn,soybeans,chicago-wheat$/, "link unchanged");
      assert.equal(await pg.$$eval('.cc-chip[aria-pressed="true"]', (a) => a.length), 3);
      // end labels in the picture, and no sideways scroll or shift
      const labels = await pg.$$eval("#cc-svg text", (a) => a.map((t) => t.textContent));
      for (const [k, name] of [["corn", "Corn"], ["beans", "Soybeans"], ["wheat", "Chicago wheat"]]) {
        const v = C.cmpModel(["corn", "beans", "wheat"], HIST, COT, CX).series.find((s) => s.key === k).vals[51];
        assert.ok(labels.includes(name + " " + Math.round(v)), "label " + name + ": " + labels.join("|"));
      }
      const fs12 = await pg.$$eval("#cc-svg text", (a) => Math.min(...a.map((t) => +t.getAttribute("font-size"))));
      assert.ok(fs12 >= 12, "svg text " + fs12);
      assert.ok(Math.abs((await boxH(pg)) - h0) < 1, `no layout shift entering compare (${h0} then ${await boxH(pg)}) at ${width}`);
      assert.ok((await pg.evaluate(() => document.documentElement.scrollWidth)) <= Math.max(sw0, width), "no sideways scroll");
      const small = await pg.$$eval(".cc-chip, .cc-cmp, .cc-btn", (a) => a.filter((b) => b.getBoundingClientRect().height < 44).length);
      assert.equal(small, 0, "all taps 44 px or more");
      // hover: date and each market's value
      const plot = await pg.$("#cc-plot");
      await plot.scrollIntoViewIfNeeded();
      const bb = await plot.boundingBox();
      await pg.mouse.move(bb.x + bb.width - 14, bb.y + bb.height / 2);
      await pg.waitForSelector("#cc-tip:not([hidden])");
      const tip = await pg.textContent("#cc-tip");
      assert.match(tip, /^Oct 27, 2026/);
      assert.ok(/Corn \d+ \(81,113 long\)/.test(tip) && /Soybeans \d+ \(193,781 long\)/.test(tip) && /Chicago wheat \d+/.test(tip), tip);
      // take one off: the link follows; leave compare: single again on the first pick
      await pg.click('.cc-chip[data-k="beans"]');
      assert.match(pg.url(), /\?m=corn,chicago-wheat$/);
      await pg.click("#cc-cmp");
      assert.equal(await pg.$eval("#cot-chart-box", (b) => b.dataset.mode || ""), "");
      assert.equal(new URL(pg.url()).searchParams.get("m"), "corn");
      assert.equal(await pg.$eval("#cot-chart-box", (b) => b.dataset.market), "corn");
      assert.match((await pg.textContent("#cc-head")).trim(), /^Corn: funds /);
      await pg.context().close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("a shared link opens in compare; a single link still opens one market", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    let pg = await open(browser, port, "/cot?m=corn,soybeans,chicago-wheat", { width: 390 });
    assert.equal(await pg.$eval("#cot-chart-box", (b) => b.dataset.market), "corn,beans,wheat");
    assert.deepEqual(await pg.$$eval('.cc-chip[aria-pressed="true"]', (a) => a.map((b) => b.textContent)), ["Corn", "Soybeans", "Chicago wheat"]);
    assert.equal(await pg.getAttribute("#cc-cmp", "aria-pressed"), "true");
    assert.equal(await pg.evaluate(() => window.AgCotChart.shareUrl()), "https://agsist.com/cot?m=corn,soybeans,chicago-wheat");
    await pg.context().close();
    // four in a link: the first three; an odd one is dropped
    pg = await open(browser, port, "/cot?m=corn,bitcoin,beans,wheat,milk", { width: 390 });
    assert.equal(await pg.$eval("#cot-chart-box", (b) => b.dataset.market), "corn,beans,wheat");
    await pg.context().close();
    pg = await open(browser, port, "/cot?m=soybeans", { width: 390 });
    assert.equal(await pg.$eval("#cot-chart-box", (b) => b.dataset.market), "beans");
    assert.equal(await pg.$eval("#cot-chart-box", (b) => b.dataset.mode || ""), "");
    assert.equal(await pg.getAttribute("#cc-cmp", "aria-pressed"), "false");
    await pg.context().close();
  } finally { await browser.close(); srv.close(); }
});

test("compare: Share copies the compare link; Save image carries the headline, the date and each end label", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await open(browser, port, "/cot?m=corn,soybeans,chicago-wheat", { width: 1280 });
    await pg.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: `http://127.0.0.1:${port}` }).catch(() => {});
    await pg.click("#cc-share");
    await pg.waitForFunction(() => /Link copied|Copy this link/.test(document.getElementById("cc-note").textContent));
    const [dl] = await Promise.all([pg.waitForEvent("download"), pg.click("#cc-save")]);
    assert.equal(dl.suggestedFilename(), "agsist-cot-corn-soybeans-chicago-wheat-2026-10-27.png");
    const buf = fs.readFileSync(await dl.path());
    assert.deepEqual([buf.readUInt32BE(16), buf.readUInt32BE(20)], [1200, 675], "1200x675");
    const im = await pg.evaluate(() => window.AgCotChart.lastImage);
    assert.ok(im.texts.includes("Funds in corn, soybeans and Chicago wheat, ranked against each market’s own 52 weeks") || im.texts.some((t) => t.startsWith("Funds in corn, soybeans")), "headline: " + im.texts.join("|"));
    assert.ok(im.texts.includes("agsist.com/cot"));
    assert.ok(im.texts.includes("Positions as of Oct 27, 2026, released Oct 30"));
    assert.ok(im.texts.some((t) => /^Corn \d+$/.test(t)) && im.texts.some((t) => /^Soybeans \d+$/.test(t)) && im.texts.some((t) => /^Chicago wheat \d+$/.test(t)));
    assert.ok(!im.texts.some((t) => DASH.test(t)), "no dashes");
    await pg.context().close();
  } finally { await browser.close(); srv.close(); }
});
