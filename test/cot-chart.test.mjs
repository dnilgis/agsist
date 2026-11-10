/* The 52-week funds chart on /cot (2026-11-05). components/cot-chart.js.
 *   - one chart near the top (Nov 5): the crowded
 *     verdict when it fits one line, the chips, one brief line for the market picked, the chart; every market
 *     in a table behind one "All markets" tap under it, then the email ask; on a 390 px phone the chart's
 *     line is on the first screen; no sentence repeats per market (no phrase over 4 words repeats across rows);
 *   - one market at a time, corn by default, the pick in the link (?m=soybeans); a table row picks it too;
 *   - the last point is cot.json's net for that market; the title is cot-glance.js brief;
 *   - the price strip only when every week has a close (none for lean hogs or Minneapolis wheat, and none when a
 *     week is missing), never a second scale on the net;
 *   - Share this chart calls the phone's share sheet with the market's link, or copies it; Save image is a
 *     1200x675 PNG carrying agsist.com/cot and the report date;
 *   - the home card's lines open /cot on their market.
 * Frozen inputs: test/fixtures/funds (cot.json, cot-analysis.json and cot-history.json for the Oct 27, 2026 report).
 * The browser parts route every outside host to a stub or abort and block service workers (build rule 58).
 *
 *   node --test test/cot-chart.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import os from "node:os";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);
const G = require(path.join(ROOT, "components/cot-glance.js"));
const C = require(path.join(ROOT, "components/cot-chart.js"));
const K = require(path.join(ROOT, "components/cot-kit.js"));
const FIX = {
  cot: path.join(ROOT, "test/fixtures/funds/cot-2026-10-27.json"),
  cx: path.join(ROOT, "test/fixtures/funds/cot-analysis-2026-10-27.json"),
  hist: path.join(ROOT, "test/fixtures/funds/cot-history-2026-10-27.json"),
};
const COT = JSON.parse(fs.readFileSync(FIX.cot, "utf8"));
const CX = JSON.parse(fs.readFileSync(FIX.cx, "utf8"));
const HIST = JSON.parse(fs.readFileSync(FIX.hist, "utf8"));
const DASH = /[–—]|&mdash;|&ndash;/;
/* the page the browser tests load is baked from the SAME frozen fixtures the routes serve (Nov 6: the live
   cot.html is re-baked every Friday from the new week, so a baked answer from one week beside a live answer from
   the fixture week differed by a line and the chart box moved; that mismatch never happens on the site) */
const BAKED = (() => {
  const out = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "cotbake-")), "cot.html");
  const py = `import sys; sys.path.insert(0, "scripts"); import prerender_wpi_scorecard as p
p.COT_JSON, p.COT_CX_JSON = sys.argv[1], sys.argv[2]
o, n, f = p.bake_cot(); open(sys.argv[3], "w", encoding="utf-8").write(n)`;
  try { execFileSync("python3", ["-c", py, FIX.cot, FIX.cx, out], { cwd: ROOT, stdio: "pipe" }); return out; } catch (e) { return null; }
})();
const clone = (o) => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------------------ the model
test("the last point is cot.json's net, and the title is that market's brief line", () => {
  for (const k of G.ORDER) {
    const m = C.model(k, HIST, COT, CX);
    assert.ok(m, k);
    assert.equal(m.rows.length, 52, k + ": 52 weekly reports");
    assert.equal(m.last.net, COT[k].net, k + ": the latest point equals cot.json");
    assert.equal(m.last.date, "2026-10-27");
    assert.equal(m.headline, G.brief(k, COT, CX).text, k);
    assert.ok(/^[A-Z][A-Za-z ]+ funds (cut|added|sold|bought|held)/.test(m.headline), m.headline);
    assert.equal(m.hi.net, Math.max(...m.rows.map((r) => r.net)), k + " high");
    assert.equal(m.lo.net, Math.min(...m.rows.map((r) => r.net)), k + " low");
    assert.equal(m.hi.net, COT[k].max52, k + ": the high agrees with the card's 52-wk range");
    assert.equal(m.lo.net, COT[k].min52, k + ": the low agrees with the card's 52-wk range");
    assert.ok(m.src.startsWith("CFTC Commitments of Traders, managed money, futures only, week to Tue, Oct 27, 2026, released Fri, Oct 30, 2026."), m.src);
    assert.equal(m.asOf, "Week to Tue, Oct 27, 2026. Released Fri, Oct 30, 2026.");
    assert.ok(!DASH.test(m.src + m.headline + m.priceWhy), "no dashes");
  }
  // kit v2: what changed first, then where funds stand; buys, sells, flips and shorts each in their own words
  assert.equal(C.model("corn", HIST, COT, CX).headline, "Corn funds cut their net long by 83,310 contracts. Still net long: 81,113.");
  assert.equal(C.model("beans", HIST, COT, CX).headline, "Soybean funds cut their net long by 27,544 contracts. Still net long: 193,781.");
  assert.equal(C.model("wheat", HIST, COT, CX).headline, "Chicago wheat funds added 22,601 contracts to their net short. Still net short: 74,606.");
  assert.equal(C.model("milk", HIST, COT, CX).headline, "Class III milk funds cut their net short by 1,174 contracts. Still net short: 6,856.");
  assert.equal(C.model("livecattle", HIST, COT, CX).headline, "Live cattle funds added 5,471 contracts to their net long. Still net long: 56,573.");
  assert.equal(C.model("mplswheat", HIST, COT, CX).headline, "Minneapolis wheat funds sold 7,906 contracts and flipped to net short. Now net short: 3,713.");
  assert.equal(C.model("kcwheat", HIST, COT, CX).headline, "KC wheat funds sold 8,007 contracts and flipped to net short. About even: net short 517.");
  assert.equal(C.model("corn", HIST, COT, CX).headlineHtml, "<b>Corn funds cut their net long by 83,310 contracts.</b> Still net long: 81,113.");
  // a flip to long, a hold, a measured record (never "crowded" or a weight word)
  const up = clone(COT); up.corn.prev = -1000; const fl = G.brief("corn", up, null);
  assert.equal(fl.text, "Corn funds bought 82,113 contracts and flipped to net long. Now net long: 81,113.");
  const hold = clone(COT); hold.corn.prev = hold.corn.net;
  assert.equal(G.brief("corn", hold, null).text, "Corn funds held their position. Still net long: 81,113.");
  assert.equal(G.brief("leanhogs", COT, CX).record, "Largest net short in contracts since 2010");
  for (const k of G.ORDER) assert.doesNotMatch(G.brief(k, COT, CX).text + G.answer(k, COT, CX).text, /moderate|heavy|light|crowded|this week|today/i, k);
});

test("no title is claimed when the chart's last week is not the report on the page, or the nets differ", () => {
  const next = { ...clone(COT), report_date: "November 3, 2026" };
  assert.equal(C.model("corn", HIST, next, CX).headline, null, "a different week: no title");
  const moved = clone(COT); moved.corn.net += 1;
  assert.equal(C.model("corn", HIST, moved, CX).headline, null, "a different net: no title");
  const m = C.model("corn", HIST, COT, null);
  assert.equal(m.headline, "Corn funds cut their net long by 83,310 contracts. Still net long: 81,113.", "without the analysis: the same facts from cot.json");
  assert.equal(m.src, "CFTC Commitments of Traders, managed money, futures only, week to Tue, Oct 27, 2026. Price: front-month futures close each report Tuesday (Yahoo Finance), adjusted for contract rolls.", "no release day without the analysis");
});

test("the price strip is drawn only when every week has a close, and says why when it is not", () => {
  for (const k of ["corn", "beans", "wheat", "kcwheat", "soymeal", "soyoil", "livecattle", "feedercattle", "milk"]) {
    const m = C.model(k, HIST, COT, CX);
    assert.equal(m.price, true, k);
    assert.equal(m.rows.at(-1).price, m.last.raw, k + ": the adjusted line ends on the last close");
    assert.ok(m.src.includes("Yahoo Finance"), "the price source is named where the price shows");
  }
  const hogs = C.model("leanhogs", HIST, COT, CX), mpls = C.model("mplswheat", HIST, COT, CX);
  assert.equal(hogs.price, false);
  assert.match(hogs.priceWhy, /rolls/);
  assert.equal(mpls.price, false);
  assert.equal(mpls.priceWhy, "No price line: our futures feed does not carry this contract.");
  assert.ok(!hogs.src.includes("Price:") && !mpls.src.includes("Price:"), "no price credit without a price");
  // one week without a close: no half-drawn line
  const gap = clone(HIST); delete gap.history.corn[20].price;
  const m = C.model("corn", gap, COT, CX);
  assert.equal(m.price, false);
  assert.match(m.priceWhy, /some weeks have no futures close/);
  const g = C.layout(m, 340, 300, { fs: 12 });
  assert.equal(g.items.filter((i) => i.ink === "price").length, 0, "nothing drawn in price ink");
  // a market the analysis withholds is not drawn even with closes on file
  const cx = clone(CX); cx.commodities.corn.price_withheld_reason = "withheld, not missing: rolls not repaired";
  assert.equal(C.model("corn", HIST, COT, cx).price, false);
});

test("the layout marks zero, this week's number and the 52-week high and low, text 12 px or more", () => {
  for (const k of G.ORDER) {
    const m = C.model(k, HIST, COT, CX), g = C.layout(m, 340, 300, { fs: 12 });
    const texts = g.items.filter((i) => i.t === "text");
    const s = texts.map((i) => i.s);
    assert.ok(texts.every((i) => i.size >= 12), k + ": every label 12 px or more");
    assert.ok(s.includes("0"), k + ": zero labelled");
    assert.ok(s.includes("Net contracts"), k + ": the unit, once");
    assert.ok(!s.some((x) => /^(long|short) [↑↓]$/.test(x)), k + ": no gutter words beside the tick numbers");
    assert.ok(s.some((x) => x.startsWith(C.netWords(COT[k].net))), k + ": this week's number");
    assert.ok(s.includes("Oct 27, 2026"), k + ": the latest date in full, with its year");
    assert.ok(s.includes("2026") && s.includes("Oct 27"), k + ": the year on the axis, the latest point's date: " + s.join(" | "));
    const hiS = s.find((x) => /^52-wk high /.test(x)), loS = s.find((x) => /^52-wk low /.test(x));
    if (m.hi !== m.last) assert.match(hiS || "", /^52-wk high [\d.]+k? (long|short)$/, k + ": the high in words, with its side");
    if (m.lo !== m.last) assert.match(loS || "", /^52-wk low [\d.]+k? (long|short)$/, k + ": the low in words, never a minus");
    for (const r of [m.hi, m.lo]) if (r !== m.last) assert.ok(s.includes(K.md(r.date)), k + ": the high and low dated");
    const y0 = g.items.find((i) => i.t === "line" && i.ink === "zero");
    assert.ok(y0 && y0.width >= 1.5, "zero drawn plainly");
    // round ticks, 3 to 7 of them, the top one at most half a step past the highest week
    const ticks = texts.filter((i) => i.align === "right" && i.base === "middle" && /^[−]?[\d.]+k?$|^0$/.test(i.s)).map((i) => i.s);
    assert.ok(ticks.length >= 3 && ticks.length <= 7, k + ": " + ticks);
    // weeks placed by date: the x of each week grows with its date
    const xs = m.rows.map((r, i) => g.X(i));
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], k + ": by date");
  }
  // the run bracket: corn sold 6 weeks in a row to Oct 27 (the sheet's run, from the same rows)
  const cg = C.layout(C.model("corn", HIST, COT, CX), 340, 300, { fs: 12 }).items.filter((i) => i.t === "text").map((i) => i.s);
  assert.ok(cg.includes("Sold 6 weeks: 333,347"), cg.join(" | "));
  assert.equal(cg.filter((x) => /^(Sold|Bought) \d+ weeks/.test(x)).length, 1, "one event at most");
  // the price strip has its own scale (its high and low) and the latest close at the line's end
  const cm = C.model("corn", HIST, COT, CX), cl = C.layout(cm, 340, 300, { fs: 12 });
  const ps = cm.rows.map((r) => r.price);
  const end = cl.items.find((i) => i.t === "text" && i.s === C.px("corn", cm.last.raw));
  const dot = cl.items.filter((i) => i.t === "dot" && i.ink === "price").at(-1);
  assert.ok(end && dot && Math.abs(end.x - dot.x) < 10 && Math.abs(end.y - dot.y) < 20, "the price label sits at the line's end");
  assert.ok(cg.includes(C.px("corn", Math.max(...ps)).replace("/bu", "")) && cg.includes(C.px("corn", Math.min(...ps)).replace("/bu", "")), "the strip's high and low values");
  // release day: the newest week has a close but no repaired index; the line stops, the label is dated there
  const rel = clone(HIST); delete rel.history.corn.at(-1).px_adj;
  const rm = C.model("corn", rel, COT, CX), rl = C.layout(rm, 340, 300, { fs: 12 });
  const rs = rl.items.filter((i) => i.t === "text").map((i) => i.s);
  assert.equal(rm.price, true);
  const rd = rl.items.filter((i) => i.t === "dot" && i.ink === "price").at(-1), rt = rl.items.find((i) => i.t === "text" && /on Oct 20$/.test(i.s));
  assert.ok(rt && Math.abs(rt.x - rd.x) < 10 && Math.abs(rd.x - rl.X(rm.rows.length - 2)) < 0.5, "the label at the last priced week, dated: " + rs.join(" | "));
  // the record on the latest point (lean hogs, Oct 27: the largest net short in contracts since 2010)
  const hs = C.layout(C.model("leanhogs", HIST, COT, CX), 340, 300, { fs: 12 }).items.filter((i) => i.t === "text").map((i) => i.s).join(" ");
  assert.match(hs, /Largest net short in contracts since 2010/);
  // the print inks: a dashed price line, a lighter fill
  const pr = C.layout(cm, 560, 300, { fs: 15, print: true });
  assert.ok(pr.items.some((i) => i.ink === "price" && i.t === "line" && i.dash), "a dashed price line on paper");
  assert.equal(C.netWords(193781), "193,781 long");
  assert.equal(C.netWords(-74606), "74,606 short");
  assert.equal(C.px("beans", 1229.25), "$12.29¼/bu");
  assert.equal(C.px("livecattle", 230), "$230.00/cwt");
});

/* every run of 5 words (lower case, numbers kept) in a list of texts -> the runs found in more than one text */
function repeats(texts) {
  const seen = new Map();
  texts.forEach((t, i) => {
    const w = t.toLowerCase().replace(/[^a-z0-9,.'+\u2212 -]/g, " ").split(/\s+/).filter(Boolean);
    for (let j = 0; j + 5 <= w.length; j++) {
      const k = w.slice(j, j + 5).join(" ");
      if (!seen.has(k)) seen.set(k, new Set());
      seen.get(k).add(i);
    }
  });
  return [...seen].filter(([, s]) => s.size > 1).map(([k]) => k);
}

test("no phrase over 4 words repeats across the market rows (Sig, Nov 5: 'extremely repetitive wording')", () => {
  // the /cot table, the home rows and the brief lines every chip shows, for the frozen report and a few made-up weeks
  const weeks = [COT];
  for (const shift of [1, -1]) { const c = clone(COT); for (const k of G.ORDER) c[k].prev = c[k].net - shift * 1000; weeks.push(c); }
  for (const c of weeks) for (const cx of [CX, null]) {
    const rows = G.rows(c, cx).map((r) => [r.name, r.pos, r.rank, r.chg].join(" "));
    assert.equal(rows.length, G.ORDER.length);
    assert.deepEqual(repeats(rows), [], "table rows");
    const home = G.rows(c, cx, ["corn", "beans", "wheat"]).map((r) => [r.name, r.pos, r.chg].join(" "));
    assert.deepEqual(repeats(home), [], "home rows");
    for (const r of G.rows(c, cx)) assert.ok(r.pos.split(" ").length <= 3, "a short cell: " + r.pos);
  }
  // the test itself catches the old sentence per market
  assert.ok(repeats(G.lines(COT, CX).map((l) => l.text)).length > 0, "the old lines repeat (the check works)");
  // one brief line shows at a time, and it is short
  for (const k of G.ORDER) assert.ok(G.brief(k, COT, CX).text.length <= 100, G.brief(k, COT, CX).text);
  // the verdict is the short form of the one crowded verdict
  assert.equal(G.verdict(COT, CX), "Crowded: soybean meal long; lean hogs, Class III milk short");
  assert.equal(G.verdict(COT, null), null);
  assert.equal(G.asOfShort(COT, CX), "As of Tue, Oct 27, released Fri, Oct 30");
  const cot = read("cot.html");
  assert.ok(!/Funds are [a-z ]+ (long|short) /.test(cot.replace(/<!-- PRERENDER:cot-summary -->[\s\S]*?<!-- \/PRERENDER:cot-summary -->/, "")), "no sentence per market in the page");
});

test("/cot carries one chart, under the verdict and above the market table and the ask, and loads the bumped scripts", () => {
  const cot = read("cot.html");
  const v = cot.indexOf('id="cg-verdict"'), box = cot.indexOf('id="cot-chart-box"'), table = cot.indexOf('id="cg-all"'), ask = cot.indexOf('data-topic="cot"'), all = cot.indexOf('id="cot-all"');
  assert.ok(v > 0 && v < box && box < table && table < ask && ask < all, "verdict, chart, table, ask, details");
  assert.ok(!cot.includes('id="cg-lines"'), "no sentence per market");
  // the chips are in the page from the first paint, one per market, named as cot-glance.js names them
  const chips = [...cot.matchAll(/<button type="button" class="cc-chip" data-k="([a-z]+)" aria-pressed="(true|false)">([^<]+)<\/button>/g)];
  assert.deepEqual(chips.map((m) => m[1]), G.ORDER);
  assert.deepEqual(chips.map((m) => m[3]), G.ORDER.map((k) => G.SHORT[k]));
  assert.ok(!/<canvas id="cot-chart"|id="chart-tabs"|cot-chart-tab/.test(cot), "the old chart lower down is gone");
  assert.ok(!/drawChart|setActiveTab|cot-chart-tab/.test(read("components/cot-page.js")), "and its code");
  const i = (s) => cot.indexOf(`<script src="/components/${s}"></script>`);
  assert.ok(i("cot-glance.js?v=6") > 0 && i("cot-glance.js?v=6") < i("cot-kit.js?v=3") && i("cot-kit.js?v=3") < i("cot-chart.js?v=13") && i("cot-chart.js?v=13") < i("cot-page.js?v=12"));
  assert.match(cot, /\.cc-plot\{[^}]*height:300px/, "the plot's height is held before it draws");
  assert.match(cot, /\.cc-chip\{[^}]*min-height:44px/);
  assert.match(cot, /\.cc-btn\{[^}]*min-height:44px/);
  const js = read("components/cot-chart.js");
  assert.ok(!DASH.test(js.replace(/\/\*[\s\S]*?\*\//g, "")), "no dashes in the chart's words");
  // no new library: inline SVG and a canvas drawn by our own file, nothing loaded from another host
  assert.deepEqual([...cot.matchAll(/<script[^>]+src="(https?:)?\/\/[^"]*"/g)].map((m) => m[0]).filter((x) => !/googletagmanager/.test(x)), [], "no outside script");
  assert.ok(Buffer.byteLength(js) < 50000, "the chart file stays small: " + Buffer.byteLength(js) + " bytes");
});

test("the home card's lines open /cot on their market", () => {
  assert.match(read("components/home.js"), /<a class="cot-gl-a" href="'\+G\.href\(r\.key\)\+'">/);
  assert.equal(G.href("beans"), "/cot?m=soybeans");
  for (const k of G.ORDER) assert.equal(G.keyOf(G.SLUG[k]), k);
  assert.equal(G.keyOf("nonsense"), null);
  const idx = read("index.html");
  for (const s of ["components/cot-glance.js?v=6", "css/home.css?v=41"]) assert.ok(idx.includes("/" + s + '"'), s);
  assert.match(idx, /\/components\/home\.js\?v=\d+"/); // test/one-more.test.mjs owns the exact version
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
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    if (!path.extname(p)) p += ".html";
    const f = p === "/cot.html" && BAKED ? BAKED : path.normalize(path.join(ROOT, p));
    if ((f !== BAKED && !f.startsWith(ROOT)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
// every outside host aborted (the worker answered with a stub); our data files from the frozen fixtures
async function open(browser, port, url, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true, hasTouch: !!o.touch, viewport: { width: o.width || 390, height: o.width > 900 ? 900 : 844 } });
  const pg = await ctx.newPage();
  if (o.init) await pg.addInitScript(o.init);
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
  await pg.waitForFunction(() => { const b = document.getElementById("cot-chart-box"); return b && b.dataset.latest && / funds /.test(document.getElementById("cc-head").textContent); });
  return pg;
}
/* records the chart box's height at first paint, and every layout shift */
const WATCH = () => {
  window.__cls = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls.push({ v: e.value, in: e.sources.some((s) => s.node && s.node.closest && s.node.closest("#cot-chart-box")) }); }).observe({ type: "layout-shift", buffered: true });
  document.addEventListener("DOMContentLoaded", () => { const b = document.getElementById("cot-chart-box"); window.__h0 = b ? b.getBoundingClientRect().height : -1; });
};

test("/cot: the chart sits on the first screen, corn by default, its box held from first paint, no layout shift", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const pg = await open(browser, port, "/cot", { width, init: WATCH });
      const r = await pg.evaluate(() => {
        const box = document.getElementById("cot-chart-box").getBoundingClientRect();
        return { verdict: document.getElementById("cg-verdict").getBoundingClientRect().bottom + scrollY, box: box.top + scrollY, h: box.height, h0: window.__h0,
          head: document.getElementById("cc-head").getBoundingClientRect().bottom + scrollY,
          ask: document.querySelector('#cot-glance [data-signup-ask]').getBoundingClientRect().top + scrollY,
          market: document.getElementById("cot-chart-box").dataset.market, latest: +document.getElementById("cot-chart-box").dataset.latest,
          pressed: document.querySelector('.cc-chip[aria-pressed="true"]').textContent, sw: document.documentElement.scrollWidth,
          cls: window.__cls.reduce((a, x) => a + x.v, 0) };
      });
      assert.ok(r.box > r.verdict && r.box < r.ask, `under the verdict and above the ask at ${width}: ${JSON.stringify(r)}`);
      assert.ok(r.head < 844, `the chips and the brief line are on the first screen (${r.head}px) at ${width}`);
      assert.equal(r.market, "corn");
      assert.equal(r.pressed, "Corn");
      assert.equal(r.latest, COT.corn.net, "the latest point is cot.json's corn net");
      assert.ok(Math.abs(r.h - r.h0) < 0.5, `the chart's box is held at first paint (${r.h0} then ${r.h}) at ${width}`);
      assert.equal(r.cls, 0, "no layout shift on the page while the verdict and the chart fill in at " + width);
      assert.ok(r.sw <= width, "no sideways scroll at " + width);
      // every market behind one tap; a row picks the chart's market
      await pg.click("#cg-all > summary");
      assert.equal(await pg.$$eval("#cg-rows tr", (a) => a.filter((e) => e.offsetParent).length), G.ORDER.length);
      const fit = await pg.$eval(".cg-table", (t) => ({ sw: t.scrollWidth, cw: t.parentElement.clientWidth, fs: Math.min(...[...t.querySelectorAll("td,th")].map((c) => parseFloat(getComputedStyle(c).fontSize))), h: Math.max(...[...t.querySelectorAll("tbody td")].map((c) => c.getBoundingClientRect().height)) }));
      assert.ok(fit.sw <= fit.cw && fit.fs >= 12, `four columns fit without a sideways scroll, text 12 px or more at ${width}: ${JSON.stringify(fit)}`);
      await pg.click('#cg-rows .cg-pick[data-k="milk"]');
      assert.equal(await pg.$eval("#cot-chart-box", (b) => b.dataset.market), "milk");
      assert.equal(new URL(pg.url()).searchParams.get("m"), "milk");
      await pg.context().close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("/cot?m=soybeans opens on soybeans; a chip changes the market and the link; hover and keys show the week", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await open(browser, port, "/cot?m=soybeans", { width: 1280 });
    assert.equal(await pg.$eval("#cot-chart-box", (b) => b.dataset.market), "beans");
    assert.equal(+(await pg.$eval("#cot-chart-box", (b) => b.dataset.latest)), COT.beans.net);
    assert.equal((await pg.textContent("#cc-head")).trim(), "Soybean funds cut their net long by 27,544 contracts. Still net long: 193,781.");
    assert.equal((await pg.textContent("#cc-src")).trim(), "CFTC Commitments of Traders, managed money, futures only, week to Tue, Oct 27, 2026, released Fri, Oct 30, 2026. Price: front-month futures close each report Tuesday (Yahoo Finance), adjusted for contract rolls.");
    assert.equal(await pg.$eval("#cot-chart-box", (b) => b.dataset.price), "1");
    // hover: the week's date and net
    const plot = await pg.$("#cc-plot");
    await plot.scrollIntoViewIfNeeded();
    const bb = await plot.boundingBox();
    await pg.mouse.move(bb.x + bb.width - 14, bb.y + bb.height / 2);
    await pg.waitForSelector("#cc-tip:not([hidden])");
    assert.match(await pg.textContent("#cc-tip"), /^Oct 27, 2026Net 193,781 longFutures close \$12\.29¼\/bu$/);
    await plot.focus();
    await pg.keyboard.press("ArrowLeft");
    assert.match(await pg.textContent("#cc-tip"), /^Oct 20, 2026Net 221,325 long/);
    // a chip: hogs, no price strip, the link follows
    await pg.click('.cc-chip[data-k="leanhogs"]');
    assert.equal(new URL(pg.url()).searchParams.get("m"), "lean-hogs");
    assert.equal(+(await pg.$eval("#cot-chart-box", (b) => b.dataset.latest)), COT.leanhogs.net);
    assert.equal(await pg.$eval("#cot-chart-box", (b) => b.dataset.price), "0");
    assert.match(await pg.textContent("#cc-svg"), /No price line/);
    // an unknown market falls back to corn
    await pg.goto(`http://127.0.0.1:${port}/cot?m=bitcoin`);
    await pg.waitForFunction(() => document.getElementById("cot-chart-box").dataset.latest);
    assert.equal(await pg.$eval("#cot-chart-box", (b) => b.dataset.market), "corn");
    await pg.context().close();
  } finally { await browser.close(); srv.close(); }
});

test("Share this chart: the phone's share sheet gets the market's link; a desktop copies it", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const stub = () => {
    window.__shared = []; window.__copied = [];
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/pointer:\s*coarse/.test(q) ? { matches: !!window.__coarse, media: q, addEventListener() {}, removeEventListener() {} } : mm(q));
    Object.defineProperty(navigator, "share", { configurable: true, value: (d) => { window.__shared.push(d); return Promise.resolve(); } });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } });
  };
  try {
    let pg = await open(browser, port, "/cot?m=soybeans", { init: () => { window.__coarse = true; }, touch: true });
    await pg.addInitScript(stub); await pg.reload(); await pg.waitForFunction(() => document.getElementById("cot-chart-box").dataset.latest && / funds /.test(document.getElementById("cc-head").textContent));
    await pg.evaluate(() => { window.__coarse = true; });
    await pg.click("#cc-share");
    const shared = await pg.evaluate(() => window.__shared);
    assert.equal(shared.length, 1);
    assert.equal(shared[0].url, "https://agsist.com/cot?m=soybeans&w=2026-10-27&utm_source=share&utm_medium=link&utm_campaign=cot-2026-10-27#soybeans", "the market, the week and the kit's tags");
    assert.equal(shared[0].text, "Soybean funds cut their net long by 27,544 contracts. Still net long: 193,781.");
    assert.match(shared[0].title, /soybeans/);
    await pg.context().close();

    pg = await open(browser, port, "/cot?m=chicago-wheat", { width: 1280 });
    await pg.addInitScript(stub); await pg.reload(); await pg.waitForFunction(() => document.getElementById("cot-chart-box").dataset.latest);
    await pg.click("#cc-share");
    await pg.waitForFunction(() => document.getElementById("cc-note").textContent === "Link copied");
    assert.deepEqual(await pg.evaluate(() => [window.__shared.length, window.__copied]), [0, ["https://agsist.com/cot?m=chicago-wheat&w=2026-10-27&utm_source=share&utm_medium=link&utm_campaign=cot-2026-10-27#chicago-wheat"]]);
    await pg.context().close();
  } finally { await browser.close(); srv.close(); }
});

test("Save picture: pick your market, then a 1200x675 PNG with that market's headline, agsist.com/cot and the report date", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await open(browser, port, "/cot", { width: 1280 });
    await pg.click("#cc-save");
    assert.ok(await pg.$eval("#cc-pick", (d) => d.open), "Save picture asks which market first");
    assert.deepEqual(await pg.$$eval("#cc-pick-mk > .cc-dlg-g .cc-pk", (b) => b.map((x) => x.textContent)), ["Corn", "Soybeans", "Wheat", "Cattle", "Hogs"]);
    assert.equal(await pg.$$eval("#cc-pick .cc-dlg-more .cc-pk", (b) => b.length), 6, "the rest under More markets");
    const [dl] = await Promise.all([pg.waitForEvent("download"), pg.click('#cc-pick .cc-pk[data-k="beans"]')]);
    assert.equal(dl.suggestedFilename(), "agsist-cot-soybeans-2026-10-27.png");
    const buf = fs.readFileSync(await dl.path());
    assert.equal(buf.subarray(1, 4).toString(), "PNG");
    assert.deepEqual([buf.readUInt32BE(16), buf.readUInt32BE(20)], [1200, 675], "1200x675");
    const im = await pg.evaluate(() => window.AgCotChart.lastImage);
    assert.ok(im.texts.includes("agsist.com/cot"), "carries agsist.com/cot");
    assert.ok(im.texts.includes("Week to Tue, Oct 27, 2026. Released Fri, Oct 30, 2026."), "carries the dates with the year: " + im.texts.join(" | "));
    assert.ok(im.texts.includes("Soybean funds cut their net long by 27,544 contracts.") && im.texts.includes("Still net long: 193,781."), "carries the headline: what changed, then where they stand");
    assert.ok(!im.texts.some((t) => /\bthis week\b|\btoday\b/i.test(t)), "no 'this week' or 'today' on a picture");
    assert.ok(im.texts.includes("193,781 long"), "this week's number");
    assert.ok(im.texts.includes("In bushels: about 140 million sold, about 970 million net long."), "the contracts in bushels: " + im.texts.filter((t) => /bushels/.test(t)));
    assert.ok(im.texts.some((t) => /exchange contract specifications/.test(t)), "and where the contract size comes from");
    assert.equal(await pg.$eval("#cc-pv-note", (e) => e.textContent), "Picture saved.");
    assert.ok(im.texts.some((t) => /^Source: CFTC Commitments of Traders/.test(t)), "and its source");
    assert.ok(!im.texts.some((t) => DASH.test(t)), "no dashes");
    await pg.context().close();
  } finally { await browser.close(); srv.close(); }
});

test("the share fallback: on a phone the picture is made at the pick and sent inside the tap; a refused share downloads it with a note", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const stub = () => {
    window.__shared = []; window.__ev = [];
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/pointer:\s*coarse/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q));
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: true, value: (d) => { window.__shared.push(d); return window.__refuse ? Promise.reject(new DOMException("no activation", "NotAllowedError")) : Promise.resolve(); } });
  };
  try {
    const pg = await open(browser, port, "/cot", { touch: true, init: stub });
    await pg.click("#cc-save");
    await pg.click('#cc-pick .cc-pk[data-k="leanhogs"]');
    await pg.waitForFunction(() => !document.getElementById("cc-pv-send").hidden);
    assert.equal(await pg.evaluate(() => window.__shared.length), 0, "nothing shared until the reader taps Send");
    assert.deepEqual(await pg.evaluate(() => [window.AgCotChart.lastImage.w, window.AgCotChart.lastImage.h]), [1080, 1350], "the phone picture");
    await pg.click("#cc-pv-send");
    await pg.waitForFunction(() => document.getElementById("cc-pv-note").textContent === "Sent.");
    const sh = await pg.evaluate(() => ({ n: window.__shared[0].files.length, name: window.__shared[0].files[0].name, text: window.__shared[0].text }));
    assert.equal(sh.n, 1); assert.equal(sh.name, "agsist-cot-lean-hogs-2026-10-27.png");
    assert.match(sh.text, /https:\/\/agsist\.com\/cot\?m=lean-hogs&w=2026-10-27&utm_source=share&utm_medium=picture&utm_campaign=cot-2026-10-27#lean-hogs$/);
    const ev = () => pg.evaluate(() => (window.dataLayer || []).filter((a) => a[0] === "event").map((a) => a[1] + ":" + JSON.stringify(a[2] || {})));
    assert.ok((await ev()).some((e) => /^share_done:.*"asset":"picture"/.test(e)), "share_done only after the share resolved");
    await pg.evaluate(() => { window.__refuse = true; });
    const [dl] = await Promise.all([pg.waitForEvent("download"), pg.click("#cc-pv-send")]);
    assert.equal(dl.suggestedFilename(), "agsist-cot-lean-hogs-2026-10-27.png", "refused: downloaded instead");
    assert.match(await pg.$eval("#cc-pv-note", (e) => e.textContent), /did not open sharing, so the picture was saved/);
    await pg.context().close();
  } finally { await browser.close(); srv.close(); }
});

test("arrivals: a QR visit is counted once and the Funds this week box records where the reader came from", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await open(browser, port, "/cot?utm_source=print&utm_medium=qr&utm_campaign=cot-2026-10-27");
    assert.equal(await pg.$eval("#cot-signup", (e) => e.getAttribute("data-source")), "cot-weekly:cot|print-qr");
    assert.equal(await pg.evaluate(() => (window.dataLayer || []).filter((a) => a[0] === "event" && a[1] === "qr_visit").length), 1);
    await pg.context().close();
  } finally { await browser.close(); srv.close(); }
});

test("home card: each line opens /cot on its market", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const own = { "/data/cot.json": fs.readFileSync(FIX.cot), "/data/cot-analysis.json": fs.readFileSync(FIX.cx) };
    await pg.route("**/*", (r) => {
      const u = new URL(r.request().url());
      if (u.origin === `http://127.0.0.1:${port}`) return own[u.pathname] ? r.fulfill({ status: 200, contentType: "application/json", body: own[u.pathname] }) : r.continue();
      return r.abort();
    });
    await pg.clock.setFixedTime(new Date("2026-11-04T15:46:20Z"));
    await pg.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
    await pg.waitForFunction(() => document.querySelectorAll("#cot-glance a.cot-gl-a").length === 3);
    assert.deepEqual(await pg.$$eval("#cot-glance a.cot-gl-a", (a) => a.map((x) => x.getAttribute("href"))), ["/cot?m=corn", "/cot?m=soybeans", "/cot?m=chicago-wheat"]);
    await pg.evaluate(() => { let d = document.getElementById("cot-widget"); while (d) { if (d.tagName === "DETAILS") d.open = true; d = d.parentElement; } });
    const h = await pg.$$eval("#cot-glance a.cot-gl-a", (a) => a.map((x) => x.getBoundingClientRect().height));
    assert.ok(h.every((x) => x >= 44), "taps 44 px or more: " + h);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

/* The Funds this week ask (Nov 6: grow the list). The release bar's link, the print sheet's QR code, the email's
   forward line and the homepage all land on #cot-signup, the one ask: arriving there puts the email field in focus with
   the box in view, and the bar's link does the same and tells GA4 funds_ask {where}. */
test("arriving on /cot#cot-signup, or tapping the release bar's link, focuses the email field of the one Funds this week box", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const init = () => { window.__ga = []; window.gaEvent = function (n, p) { window.__ga.push([n, p]); }; };
  const focused = () => { const a = document.activeElement, b = document.getElementById("cot-signup"), r = b.getBoundingClientRect();
    return { inBox: !!(a && b.contains(a)), type: a && a.type, top: r.top, bottom: r.bottom, vh: innerHeight }; };
  try {
    for (const width of [390, 1280]) {
      let pg = await open(browser, port, "/cot#cot-signup", { width, init });
      await pg.waitForFunction(() => document.querySelector("#cot-signup .sa-in") && document.activeElement === document.querySelector("#cot-signup .sa-in"), null, { timeout: 15000 });
      await pg.waitForTimeout(1200);   // past any late jump by the browser itself
      const a = await pg.evaluate(focused);
      assert.ok(a.inBox && a.type === "email", `${width}: the email field has focus`);
      assert.ok(a.top >= 0 && a.bottom <= a.vh, `${width}: the box is in view (${a.top}..${a.bottom} of ${a.vh})`);
      assert.equal(await pg.$$eval("[data-topic='cot'][data-signup-ask]", (e) => e.length), 1, "one Funds this week ask on the page");
      await pg.context().close();
      pg = await open(browser, port, "/cot", { width, init });
      await pg.waitForSelector("#cot-signup .sa-in");
      assert.equal(await pg.getAttribute("#cot-rel-a", "href"), "#cot-signup");
      await pg.click("#cot-rel-a");
      await pg.waitForFunction(() => document.activeElement === document.querySelector("#cot-signup .sa-in"), null, { timeout: 5000 });
      await pg.waitForTimeout(1200);
      const b = await pg.evaluate(focused);
      assert.ok(b.inBox, `${width}: still in the box`);
      assert.ok(b.top >= 0 && b.bottom <= b.vh, `${width}: in view after the tap`);
      assert.deepEqual(await pg.evaluate(() => window.__ga.filter((x) => x[0] === "funds_ask")), [["funds_ask", { where: "cot_release_bar" }]]);
      await pg.context().close();
    }
  } finally { await browser.close(); srv.close(); }
});
