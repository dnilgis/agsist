/* /usda-quick-stats and /rain-radar, the Nov 9 2026 panel (skeptic fix list, plus Sig's calls the same day).
 *
 * Quick stats: the yield shows on phones (390 px read "Iowa 2026 est. 2,803", no unit, no yield); the
 * sparkline labels follow the years drawn (wheat said '10 to '25 over a line to 2026) and stop at the
 * cards' year, with the 2026 wheat final as one labelled line; the source line under the top states
 * is per crop (the wheat tab said "33 of 42 states are the October forecast" over ten 2026 finals);
 * the query builder, the About NASS cards and the API question are cut (Sig, Nov 9), and nothing on
 * the page opens or names a NASS address (Oct 29: no data-source links; the builder window.open()ed
 * one, and the anchor-only guard could not see it); a state picker goes to /yield/<state>; the corn
 * rows are baked for readers without JavaScript (bake_seo.py state-top10, built on main).
 * Rain radar: with a spot already known the answer pushed the page down (CLS 0.40 at 390 px, 3 of 3
 * runs, ?lat=43.0&lon=-93.5); one line sends the reader to our own spray forecast for the spot.
 *
 *   node --test test/quickstats-radar-nov9.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { scan, scanScripts } from "../scripts/source_links.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const QS = read("usda-quick-stats.html");
const PW = process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("quick stats: no NASS opener, no dead labels, no address, the cut sections gone", () => {
  assert.doesNotMatch(QS, /Run Query|quickstats\.nass|Search all of NASS|window\.open|openNASS|copyURL|This dataset is being built|isn't live yet/);
  assert.doesNotMatch(QS, /Build your own|qb-commodity|class="qb-|About <span>NASS|about-card|Does USDA NASS have a free API/);
  assert.doesNotMatch(QS, /"distribution"/, "no CSV distribution claimed: the CSV is built in the browser");
  assert.deepEqual(scan(QS), []);
  assert.deepEqual(scanScripts(QS), []);
  // the Ready-made cards say where the numbers are, in plain text, and no card promises a click
  assert.equal((QS.match(/<p class="pq-where">/g) || []).length, 9);
  assert.doesNotMatch(QS, /One click into/);
  // the visible FAQ and its structured data agree
  execFileSync("python3", ["scripts/render_faq_html.py", "--check"], { cwd: ROOT, stdio: "pipe" });
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(QS)[1]);
  const faq = ld["@graph"].find((x) => x["@type"] === "FAQPage").mainEntity.map((q) => q.name);
  const shown = [...QS.matchAll(/<details><summary>(.*?)<\/summary>/g)].map((m) => m[1]);
  assert.deepEqual(faq, shown);
});

test("source_links reads script URLs: the old quick stats opener is caught, the fixed pages are clean, the rest may not grow", () => {
  const old = "<script>qbURL = 'https://quickstats.nass.usda.gov/results/?' + p.toString(); window.open(qbURL,'_blank','noopener');</script>";
  assert.deepEqual(scan(old), [], "the anchor scan alone missed it");
  assert.deepEqual(scanScripts(old), ["https://quickstats.nass.usda.gov/results/?"]);
  for (const p of ["usda-quick-stats", "rain", "corn-futures-prices",   // the radar lookup is a tab of /rain since Nov 11, 2026
     "soybean-futures-prices", "wheat-futures-prices"]) {
    const h = read(p + ".html");
    assert.deepEqual(scan(h).concat(scanScripts(h)), [], p);
  }
  // pages that still carry a script URL to a data source on Nov 9 2026 (not this branch's pages): a ratchet
  const KNOWN = { "usda-calendar.html": 2 };   // spray and cash-lease cleared in #505
  const got = {};
  for (const f of readdirSync(ROOT).filter((n) => n.endsWith(".html"))) {
    const n = scanScripts(read(f)).length;
    if (n) got[f] = n;
  }
  for (const [f, n] of Object.entries(got)) assert.ok(n <= (KNOWN[f] || 0), `${f}: ${n} script URL(s) to a data source`);
});

test("futures pages: the TradingView lines the Oct 29 unlink left behind are gone", () => {
  for (const c of ["corn", "soybean", "wheat"]) {
    const h = read(`${c}-futures-prices.html`);
    assert.doesNotMatch(h, /on TradingView (↗|&#8599;)|chart on TradingView →|use the TradingView link/, c);
    assert.match(h, /<span class="cp-src">\w+ CFD tracking CBOT<\/span>/, c);
  }
});

test("quick stats: the state picker goes to every /yield page it names, and the sections stay small", () => {
  const sel = /<select id="yield-pick"[^>]*>([\s\S]*?)<\/select>/.exec(QS);
  assert.ok(sel && /location\.href='\/yield\/'\+this\.value/.test(sel[0]));
  const opts = [...sel[1].matchAll(/<option value="([a-z-]+)">/g)].map((m) => m[1]);
  assert.ok(opts.length >= 40, `${opts.length} states`);
  for (const o of opts) assert.ok(existsSync(ROOT + "yield/" + o + ".html"), o);
  // measured without the state-top10 bake, which the data run fills in (about 3 KB of rows)
  const qsBare = QS.replace(/<!--BAKE:state-top10-->[\s\S]*?<!--\/BAKE-->/, "<!--BAKE:state-top10--><!--/BAKE-->");
  assert.ok(Buffer.byteLength(qsBare) < 75000, `the cuts shrink the page (${Buffer.byteLength(qsBare)} bytes without the bake)`);
});

/* ---------------------------------------------------------------- browser */

function serve(pages = {}) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".bin": "application/octet-stream" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    if (pages[p]) { res.writeHead(200, { "content-type": "text/html" }); res.end(pages[p]); return; }
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    const send = () => { res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f)); };
    if (p.startsWith("/data/")) setTimeout(send, 800); else send();   // a phone network: the data lands after first paint
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function open(browser, port, path, { width = 390, height = 844, js = true, saved = null } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", javaScriptEnabled: js, viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600, timezoneId: "America/Chicago" });
  const pg = await ctx.newPage();
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  if (saved) await pg.addInitScript((s) => { try { localStorage.setItem("agsist-wx-loc", JSON.stringify(s)); } catch (e) {} }, saved);
  await pg.addInitScript(() => {
    window.__cls = 0; window.__src = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__src.push(e.value.toFixed(3)); } })
      .observe({ type: "layout-shift", buffered: true });
  });
  await pg.goto(`http://127.0.0.1:${port}${path}`);
  await pg.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await pg.waitForTimeout(1500);
  return { ctx, pg };
}

const SS = JSON.parse(read("data/state-stats.json")).stateStats;
const WHEAT_US = JSON.parse(read("data/nass/wheat-yield-us.json")).values;

test("browser: quick stats at 390 px shows the yield, labels that follow the data, the per-crop source line", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { ctx, pg } = await open(browser, port, "/usda-quick-stats");
    // Iowa, the top corn state: its yield is on screen at phone width
    const ia = await pg.evaluate(() => {
      const row = [...document.querySelectorAll("#ts-list .ts-row")].find((r) => /Iowa/.test(r.textContent));
      const y = row && row.querySelector(".ts-y");
      return { text: row ? row.innerText : "", vis: y ? y.getBoundingClientRect().width > 0 && getComputedStyle(y).display !== "none" : false };
    });
    assert.ok(ia.vis && ia.text.includes(SS.IA.corn_yield.toFixed(0) + " bu/ac"), JSON.stringify(ia));
    assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= 390), "no sideways scroll");
    // sparkline labels from the years drawn, cut at the cards' 2025; the 2026 wheat final is one line
    const hero = await pg.evaluate(() => ({
      lbl: ["corn", "soy", "wheat"].map((k) => document.getElementById("sparklbl-" + k).textContent),
      pts: document.querySelector("#spark-wheat polyline").getAttribute("points").trim().split(/\s+/).length,
      row: document.getElementById("snap-new-wheat").innerText, hidden: document.getElementById("snap-new-wheat").hidden,
    }));
    assert.deepEqual(hero.lbl, ["Yield ’10–’25", "Yield ’10–’25", "Yield ’10–’25"]);
    assert.equal(hero.pts, Object.keys(WHEAT_US).filter((y) => +y <= 2025).length, "the wheat line stops at 2025");
    assert.equal(WHEAT_US["2026"], 48.1, "the file's 2026 all-wheat final");
    assert.ok(!hero.hidden && /2026 crop, USDA final yield\s*48\.1 bu\/ac/.test(hero.row), hero.row);
    // the source line follows the crop on screen
    const corn = await pg.textContent("#ts-src");
    const real = Object.entries(SS).filter(([k, v]) => v.corn_prod > 0 && !v.combined && !/^(ot|other|other states)$/i.test(v.name || k)).map((e) => e[1]);
    const nCorn = real.length, fcCorn = real.filter((v) => v.forecast).length;
    const fm = [...new Set(real.filter((v) => v.forecast).map((v) => v.forecast_month))];
    assert.equal(fm.length, 1, "one forecast month in the file");
    assert.ok(corn.includes(`${fcCorn} of ${nCorn} states are the USDA NASS ${fm[0]} forecast`), corn);
    await pg.click('.ts-btn[data-cmd="wheat"]');
    const wheat = await pg.textContent("#ts-src");
    assert.doesNotMatch(wheat, /of \d+ states are|forecast/, wheat);
    assert.match(wheat, /USDA NASS final, crop year (\d{4}\/)*2026\./, "finals, by the years the wheat rows carry");
    assert.equal(await pg.getAttribute('.ts-btn[data-cmd="wheat"]', "aria-pressed"), "true");
    assert.equal(await pg.getAttribute('.ts-btn[data-cmd="corn"]', "aria-pressed"), "false");
    // no opener or NASS address anywhere in the rendered page
    const html = await pg.content();
    assert.doesNotMatch(html, /Run Query|quickstats\.nass/);
    // the picker goes to the state's own page
    await pg.selectOption("#yield-pick", "iowa");
    await pg.waitForURL(/\/yield\/iowa$/, { timeout: 10000 });
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("browser: with no JavaScript the baked corn rows show the yields (bake_seo.py state-top10)", { skip, timeout: 120000 }, async () => {
  const body = execFileSync("python3", ["-c", "import sys,json;sys.path.insert(0,'scripts');import bake_seo as B;print(B.body_qs_top10({'state_stats':json.load(open('data/state-stats.json'))}))"], { cwd: ROOT, encoding: "utf8" }).trim();
  const baked = QS.replace(/<!--BAKE:state-top10-->[\s\S]*?<!--\/BAKE-->/, "<!--BAKE:state-top10-->" + body + "<!--/BAKE-->");
  // the bake is wired and current: the committed page holds what bake_seo.py writes from today's data
  // (a data run may already have baked it, so the page need not differ from a fresh bake)
  const committed = (QS.match(/<!--BAKE:state-top10-->([\s\S]*?)<!--\/BAKE-->/) || [])[1];
  assert.ok(committed != null, "usda-quick-stats.html has the state-top10 bake region");
  assert.equal(committed, body, "the committed state-top10 bake matches a fresh bake of data/state-stats.json");
  const srv = await serve({ "/usda-quick-stats.html": baked }), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  let srv2 = null;
  try {
    const { ctx, pg } = await open(browser, port, "/usda-quick-stats", { js: false });
    const r = await pg.evaluate(() => ({ shown: getComputedStyle(document.getElementById("topstates-wrap")).display !== "none", rows: [...document.querySelectorAll("#ts-list .ts-row")].map((x) => x.innerText.replace(/\s+/g, " ")) }));
    assert.ok(r.shown && r.rows.length === 10, JSON.stringify(r));
    assert.match(r.rows[0], new RegExp("Iowa.*" + SS.IA.corn_yield.toFixed(0) + " bu/ac"));
    await ctx.close();
    // and an unbaked page with no script hides the empty block instead of showing a bare heading
    // (the committed page may already be baked by the data run, so the bake is emptied here)
    const unbaked = QS.replace(/<!--BAKE:state-top10-->[\s\S]*?<!--\/BAKE-->/, "<!--BAKE:state-top10--><!--/BAKE-->");
    srv2 = await serve({ "/usda-quick-stats.html": unbaked });
    const o2 = await open(browser, srv2.address().port, "/usda-quick-stats", { js: false });
    assert.equal(await o2.pg.evaluate(() => getComputedStyle(document.getElementById("topstates-wrap")).display), "none");
    await o2.ctx.close();
  } finally { await browser.close(); srv.close(); if (srv2) srv2.close(); }
});

test("browser: rain radar with a known spot shifts under 0.1 and links our spray forecast for it", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [w, h] of [[390, 844], [1280, 800]]) {
      for (const run of [{ path: "/rain?lat=43.0&lon=-93.5" }, { path: "/rain", saved: { lat: 43.0, lon: -93.5, label: "Saved field" } }]) {
        const { ctx, pg } = await open(browser, port, run.path, { width: w, height: h, saved: run.saved });
        const r = await pg.evaluate(() => ({ cls: window.__cls, src: window.__src, v: document.getElementById("rr-verdict").textContent,
          next: document.getElementById("rr-next"), href: (document.querySelector("#rr-next a") || {}).getAttribute?.("href") || null }));
        assert.ok(r.cls < 0.1, `${w} ${run.path}${run.saved ? " (saved)" : ""}: CLS ${r.cls.toFixed(3)} ${r.src}`);
        assert.match(r.v, /in of rain in the last/);
        assert.equal(r.href, "/spray?f=43.0000,-93.5000");
        assert.match(await pg.textContent("#rr-next"), /^Rain in the next hours: the spray forecast for this spot\.$/);
        await ctx.close();
      }
    }
    // a spot outside the radar lets go of the reserved height
    const { ctx, pg } = await open(browser, port, "/rain?lat=21.3&lon=-157.8");
    assert.equal(await pg.evaluate(() => document.getElementById("rr-answer").classList.contains("rr-known")), false);
    assert.match(await pg.textContent("#rr-status"), /lower 48/);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
