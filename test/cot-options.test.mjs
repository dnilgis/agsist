/* Options positions on /cot (2026-11-06, Sig: feature options open interest and single out unusual positions).
 * scripts/cot_options.py builds data/cot-options.json from CFTC data only; components/cot-options.js words it.
 *   - the builder's hand-worked selftest passes;
 *   - on real CFTC rows (test/fixtures/cot-options: corn, KC wheat and Minneapolis wheat, the Disaggregated
 *     Futures-Only and Futures-and-Options Combined and the Legacy Combined reports, as published through the
 *     Oct 27, 2026 report) every options figure and rank is re-derived here, independently, from the raw rows;
 *   - Minneapolis wheat, where options are a sliver of open interest, is not ranked;
 *   - the unusual list says market, group, number, rank and report date, and the count of readings scanned;
 *     no arrows, no direction words, no dashes;
 *   - in a browser at 390 and 1280 px: the section renders from the file, no sideways scroll, a market picked
 *     shows its table; a missing file says so. Every outside host is aborted, service workers blocked (BUILD-RULES 58).
 *
 *   node --test test/cot-options.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);
const O = require(path.join(ROOT, "components/cot-options.js"));
const FIXDIR = path.join(ROOT, "test/fixtures/cot-options");
const rows = (n) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FIXDIR, n + ".json.gz"))).toString());
const RAW = { fo: rows("fo"), comb: rows("comb"), legacy: rows("legacy") };
const DASH = /[–—]|&mdash;|&ndash;/;
const CALLS = /bullish|bearish|\bbuy\b|\bsell\b|will (rise|fall)|expect(ed)? to|[↑↓▲▼→←]/i;

function build() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cot-opt-"));
  const out = path.join(tmp, "out.json");
  const r = spawnSync("python3", ["scripts/cot_options.py", "--from", FIXDIR, "--out", out], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const d = JSON.parse(fs.readFileSync(out, "utf8"));
  fs.rmSync(tmp, { recursive: true, force: true });
  return d;
}
const D = build();

test("the builder's hand-worked selftest passes", () => {
  const r = spawnSync("python3", ["scripts/cot_options.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!/FAIL/.test(r.stdout), r.stdout);
});

// ------------------------------------------------- an independent re-derivation from the raw CFTC rows
const CODES = { corn: "002602", kcwheat: "001612", mplswheat: "001626" };
const G = { mm: ["m_money_positions_long_all", "m_money_positions_short_all"], pm: ["prod_merc_positions_long", "prod_merc_positions_short"],
  swap: ["swap_positions_long_all", "swap__positions_short_all"], or: ["other_rept_positions_long", "other_rept_positions_short"] };
function market(code) {
  const by = (set) => Object.fromEntries(RAW[set].filter((r) => r.cftc_contract_market_code === code).map((r) => [r.report_date_as_yyyy_mm_dd.slice(0, 10), r]));
  const fo = by("fo"), cb = by("comb"), lg = by("legacy");
  const dates = Object.keys(fo).filter((d) => cb[d] && lg[d]).sort();
  return dates.map((d) => {
    const net = {};
    for (const g in G) net[g] = (+cb[d][G[g][0]] - +cb[d][G[g][1]]) - (+fo[d][G[g][0]] - +fo[d][G[g][1]]);
    return { d, oi: +cb[d].open_interest_all, fut: +fo[d].open_interest_all, net, g4l: +lg[d].conc_gross_le_4_tdr_long };
  });
}
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
function pct(others, x) {
  const below = others.filter((v) => v < x).length, tie = others.filter((v) => v === x).length;
  return Math.floor((100 * (below + 0.5 * tie)) / others.length + 0.5);
}

test("real CFTC week: options open interest and every group's options net, change and 3-year rank re-derive from the rows", () => {
  const latest = [...new Set(RAW.comb.map((r) => r.report_date_as_yyyy_mm_dd.slice(0, 10)))].sort().at(-1);
  assert.equal(D.report_date, latest);
  assert.equal(D.released, "2026-10-30", "the Oct 27 report was released Friday Oct 30"); // pin-ok: built from the frozen CFTC fixture rows, not live data
  for (const k of ["corn", "kcwheat"]) {
    const s = market(CODES[k]), last = s.at(-1), prev = s.at(-2), m = D.markets[k];
    assert.equal(m.date, latest);
    assert.equal(m.opt_oi, last.oi - last.fut, k + " options OI");
    assert.equal(m.oi_all, last.oi);
    assert.equal(m.opt_share, Math.round((1000 * (last.oi - last.fut)) / last.oi) / 10, k + " share");
    const win = s.filter((r) => days(r.d, last.d) < D.window_days);
    const others = win.slice(0, -1);
    assert.equal(m.weeks, win.length, k + " weeks in the window");
    assert.ok(m.weeks >= 150 && m.weeks <= 158, "about three years of weekly reports: " + m.weeks);
    for (const g in G) {
      assert.equal(m.groups[g].net, last.net[g], k + " " + g + " net");
      assert.equal(m.groups[g].chg, last.net[g] - prev.net[g], k + " " + g + " change");
      assert.equal(m.groups[g].pct, pct(others.map((r) => r.net[g]), last.net[g]), k + " " + g + " rank");
      // every other week's change in the window, the first one taken from the week just before the window
      const ch = [];
      for (const r of others) {
        const j = s.indexOf(r), gap = j > 0 ? days(s[j - 1].d, s[j].d) : 0;
        if (j > 0 && gap >= 4 && gap <= 10) ch.push(Math.abs(s[j].net[g] - s[j - 1].net[g]));
      }
      assert.equal(m.groups[g].chg_pct, pct(ch, Math.abs(last.net[g] - prev.net[g])), k + " " + g + " change rank");
    }
    assert.equal(m.conc.g4l, last.g4l, k + " largest-4 longs");
  }
  // the one CFTC figure checked by hand against the published rows: corn managed money, Oct 27, 2026
  // combined 232,151 long, 176,208 short; futures only 249,351 long, 168,238 short
  assert.equal(D.markets.corn.groups.mm.net, (232151 - 176208) - (249351 - 168238));
  assert.equal(D.markets.corn.opt_oi, 2494153 - 1859085);
});

test("Minneapolis wheat: options are a sliver of open interest, so its positions are not ranked or listed", () => {
  const m = D.markets.mplswheat;
  assert.ok(m.opt_share < D.min_opt_share, String(m.opt_share));
  assert.equal(m.withheld, "small");
  for (const g in G) assert.equal(m.groups[g].pct, null);
  for (const g in G) assert.equal(typeof m.fut[g].pct, "number", "its futures side is still ranked");
  assert.ok(!D.unusual.some((u) => u.m === "mplswheat" && u.g), "no position line");
  assert.match(O.block(D, "mplswheat"), /Too few options here to rank/);
  assert.match(O.detail(D, "mplswheat", "opt", "mm"), /too few to rank/);
});

test("the futures side re-derives from the futures-only rows (and corn funds equal the page's own cot.json net)", () => {
  const cot = JSON.parse(read("test/fixtures/funds/cot-2026-10-27.json"));
  for (const k of ["corn", "kcwheat"]) {
    const s = market(CODES[k]);
    const fo = Object.fromEntries(RAW.fo.filter((r) => r.cftc_contract_market_code === CODES[k]).map((r) => [r.report_date_as_yyyy_mm_dd.slice(0, 10), r]));
    const net = (d, g) => +fo[d][G[g][0]] - +fo[d][G[g][1]];
    const win = s.filter((r) => days(r.d, s.at(-1).d) < D.window_days), others = win.slice(0, -1);
    for (const g in G) {
      assert.equal(D.markets[k].fut[g].net, net(s.at(-1).d, g), k + " " + g);
      assert.equal(D.markets[k].fut[g].chg, net(s.at(-1).d, g) - net(s.at(-2).d, g));
      assert.equal(D.markets[k].fut[g].pct, pct(others.map((r) => net(r.d, g)), net(s.at(-1).d, g)), k + " " + g + " rank");
    }
    assert.equal(D.markets[k].fut.mm.net, cot[k].net, k + ": the map's funds futures cell is the chart's number");
  }
  const sp = D.markets.corn.spark;
  assert.equal(sp.dates.at(-1), D.report_date, "the 3-year line ends on this week");
  assert.equal(sp.opt.mm.at(-1), D.markets.corn.groups.mm.net);
  assert.equal(sp.fut.mm.at(-1), D.markets.corn.fut.mm.net);
  assert.ok(sp.dates.length >= 38 && sp.dates.length <= 40, String(sp.dates.length));
});

test("the map: every market a row, four groups by futures and options, each cell its printed rank, extremes ringed by bin", () => {
  const html = O.map(D);
  assert.equal((html.match(/class="cm-b"/g) || []).length, 3 * 8);
  for (const k of ["corn", "kcwheat"]) for (const g in G) for (const side of ["fut", "opt"]) {
    const r = side === "opt" ? D.markets[k].groups[g] : D.markets[k].fut[g];
    const re = new RegExp('<td class="cm-x (\\w+)[^"]*"><button type="button" class="cm-b" data-k="' + k + '" data-s="' + side + '" data-g="' + g + '"[^>]*>([^<]*)</button>');
    const m = re.exec(html);
    assert.ok(m, k + g + side);
    assert.equal(m[2], String(r.pct));
    assert.equal(m[1], r.pct <= 5 ? "x0" : r.pct >= 95 ? "x4" : r.pct < 25 ? "b1" : r.pct <= 75 ? "b2" : "b3", k + g + side);
  }
  assert.match(html, /aria-label="MPLS wheat, funds, options: not ranked"/);
  assert.ok(!DASH.test(html) && !CALLS.test(html));
});

test("unusual cards: every reading at an edge; each card says market, group, number, rank and report date; the search is counted", () => {
  const edge = D.edge;
  for (const u of D.unusual) {
    assert.equal(u.date, D.report_date);
    if (u.kind === "level") assert.ok(u.pct <= edge || u.pct >= 100 - edge, JSON.stringify(u));
    else if (u.kind === "change") assert.ok(u.pct >= 100 - edge, JSON.stringify(u));
    else assert.ok(u.kind === "conc_hi" || u.kind === "conc_lo", u.kind);
  }
  assert.equal(D.flagged, D.unusual.length);
  // 2 ranked markets x 4 groups x (level + change) + 3 markets x 4 concentration readings
  assert.equal(D.scanned, 2 * 4 * 2 + 3 * 4);
  assert.ok(D.typical && D.typical.weeks === 52, "a typical earlier week is counted");
  const html = O.cards(D);
  const items = html.split("</li>").filter(Boolean);
  assert.equal(items.length, O.cardList(D).length);
  assert.ok(items.length >= 1 && items.length <= D.unusual.length);
  for (const li of items) {
    assert.match(li, /<span class="cu-n">(Corn|KC wheat|MPLS wheat) <span>/, li);
    assert.match(li, /class="cu-big">[+\u2212]?[\d,.]+%?</, li);
    assert.match(li, /(percentile of \d+ weeks|(Highest|Lowest|most|least) in \d+ weeks|weekly changes)/, li);
    assert.match(li, /<time class="cu-d" datetime="2026-10-27">Oct 27<\/time>/, li); // pin-ok: built from the frozen CFTC fixture rows, not live data
  }
  const count = O.countLine(D);
  assert.match(count, new RegExp("^" + D.flagged + " of " + D.scanned + " readings scanned"));
  assert.match(count, /A typical week in the past year had/);
  for (const s of [html, count, O.block(D, "corn"), O.block(D, "kcwheat"), O.sub(D, ""), O.detail(D, "corn", "opt", "mm"), O.detail(D, "kcwheat", "fut", "pm")]) {
    assert.ok(!DASH.test(s), "no dashes: " + s);
    assert.ok(!CALLS.test(s), "facts only: " + s);
  }
});

test("wording of ranks and the stale note", () => {
  assert.equal(O.where(0, 157), "lowest in 157 weeks");
  assert.equal(O.where(100, 157), "highest in 157 weeks");
  assert.equal(O.where(4, 157), "4th percentile of 157 weeks");
  assert.equal(O.where(null, 157), "not ranked");
  assert.equal(O.sub(D, D.report_date), "Held Tuesday, Oct 27, 2026, released Oct 30, 2026."); // pin-ok: built from the frozen CFTC fixture rows, not live data
  assert.match(O.sub(D, "2026-11-03"), /The week of Nov 3, 2026 is not in yet\./); // pin-ok: built from the frozen CFTC fixture rows, not live data
  const none = { ...D, unusual: [], flagged: 0 };
  assert.match(O.countLine(none), /^None of \d+ readings scanned is at a 3-year extreme this week\./);
  assert.match(O.detail(D, "corn", "opt", "mm"), /futures equivalent/);
  assert.ok(!/futures equivalent/.test(O.detail(D, "corn", "fut", "mm")));
});

test("the committed data file has the shape the page reads, is small, and every line matches its own week", () => {
  const d = JSON.parse(read("data/cot-options.json"));
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(d.report_date));
  assert.equal(d.flagged, d.unusual.length);
  assert.ok(d.scanned > 0);
  for (const u of d.unusual) assert.equal(u.date, d.report_date);
  for (const k of Object.keys(d.markets)) assert.ok(O.ORDER.includes(k), k);
  assert.ok(fs.statSync(path.join(ROOT, "data/cot-options.json")).size < 40000);
  assert.match(d.source, /CFTC Commitments of Traders/);
});

test("cot.html: the section, its plain-text source line, no link to a data source, and the script at ?v=2", () => {
  const h = read("cot.html");
  const sec = h.slice(h.indexOf('id="cot-opt"'), h.indexOf("</section>", h.indexOf('id="cot-opt"')));
  assert.ok(sec.length > 100);
  assert.match(sec, /Source: CFTC Commitments of Traders: Disaggregated Futures-and-Options Combined, Disaggregated Futures-Only and Legacy Futures-and-Options Combined reports\./);
  assert.match(sec, /futures equivalents/);
  assert.ok(!/href=/.test(sec), "no links in the section");
  assert.ok(!DASH.test(sec), "no dashes");
  assert.ok(h.includes('<script src="/components/cot-options.js?v=2"></script>'));
  assert.ok(h.indexOf('id="cot-opt"') > h.indexOf('id="cot-glance"') && h.indexOf('id="cot-opt"') < h.indexOf('id="cot-all"'), "right under Funds this week");
});

test("both COT workflows build the options file after the weekly fetch and commit it", () => {
  for (const f of [".github/workflows/cot.yml", ".github/workflows/cot-release-watch.yml"]) {
    const y = read(f);
    assert.ok(y.indexOf("python scripts/cot_options.py --selftest") > y.indexOf("python scripts/fetch_cot.py"), f);
    assert.match(y, /git add data\/cot-options\.json/, f);
  }
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const SHOTS = process.env.COT_OPTIONS_SHOTS || "";

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
async function open(browser, port, width, own, theme = "dark") {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: width > 900 ? 900 : 844 } });
  const pg = await ctx.newPage();
  await pg.addInitScript((t) => { try { localStorage.setItem("agsist-theme", t); } catch (e) {} }, theme);
  await pg.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.origin === `http://127.0.0.1:${port}`) {
      if (u.pathname in own) return own[u.pathname] === null ? r.fulfill({ status: 404, body: "" }) : r.fulfill({ status: 200, contentType: "application/json", body: own[u.pathname] });
      return r.continue();
    }
    if (u.origin === "https://agsist-api.dnilgis.workers.dev")
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ ok: true }) });
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}/cot`, { waitUntil: "load" });
  return pg;
}

test("/cot in a browser at 390 and 1280 px: map, detail, cards and the options block follow the chart's market; nothing scrolls sideways", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const own = { "/data/cot-options.json": JSON.stringify(D), "/data/cot.json": read("test/fixtures/funds/cot-2026-10-27.json"),
      "/data/cot-analysis.json": read("test/fixtures/funds/cot-analysis-2026-10-27.json"), "/data/cot-history.json": read("test/fixtures/funds/cot-history-2026-10-27.json") };
    for (const theme of ["dark", "light"]) for (const w of [390, 1280]) {
      const pg = await open(browser, port, w, own, theme);
      await pg.waitForFunction(() => document.querySelector("#cm-wrap table") && document.querySelector("#co-mkt h3"));
      const got = await pg.evaluate(() => ({
        sub: document.getElementById("co-sub").textContent,
        count: document.getElementById("co-count").textContent,
        cells: document.querySelectorAll("#cm-wrap .cm-b").length,
        cards: document.querySelectorAll("#co-cards .cu").length,
        shown: [...document.querySelectorAll("#co-cards .cu")].filter((e) => e.offsetParent).length,
        picked: document.querySelector("#cm-detail .cd-h").textContent,
        line: document.querySelectorAll("#cm-detail polyline").length,
        mkt: document.querySelector("#co-mkt h3").textContent,
        minFont: Math.min(...[...document.querySelectorAll("#cot-opt .cm-b, #cot-opt .cm-r, #cot-opt .cm-g, #cot-opt .cm-s, #co-mkt td")].map((e) => parseFloat(getComputedStyle(e).fontSize))),
        cellW: document.querySelector("#cm-wrap .cm-b").getBoundingClientRect().width,
        cellH: document.querySelector("#cm-wrap .cm-b").getBoundingClientRect().height,
        sw: document.documentElement.scrollWidth, iw: window.innerWidth,
        theme: document.documentElement.getAttribute("data-theme"),
      }));
      assert.equal(got.theme, theme);
      assert.equal(got.sub, O.sub(D, D.report_date));
      assert.equal(got.count, O.countLine(D));
      assert.equal(got.cells, 24);
      assert.equal(got.cards, O.cardList(D).length);
      assert.equal(got.shown, Math.min(got.cards, O.SHOW));
      const first = O.cardList(D).find((c) => !c.c);
      assert.equal(got.picked, O.NAMES[first.m] + ": " + { mm: "funds", pm: "producers", swap: "swap dealers", or: "other big traders" }[first.g] + ", options", "opens on the first unusual card");
      assert.equal(got.line, 1, "the 3-year line is drawn");
      assert.equal(got.mkt, "Options in corn", "the chart opens on corn");
      assert.ok(got.minFont >= 11.5, "no tiny text: " + got.minFont);
      // WCAG 2.5.8 target size: at least 24 px; the cells are 40 px tall
      assert.ok(got.cellW >= 24 && got.cellH >= 40, "cells big enough to tap: " + got.cellW + " x " + got.cellH);
      assert.ok(got.sw <= got.iw, `no sideways scroll at ${w} ${theme}: ${got.sw} > ${got.iw}`);
      // tap a cell: the detail follows
      await pg.click('#cm-wrap .cm-b[data-k="kcwheat"][data-s="fut"][data-g="pm"]');
      assert.equal(await pg.textContent("#cm-detail .cd-h"), "KC wheat: producers, futures");
      assert.equal(await pg.getAttribute('#cm-wrap .cm-b[data-k="kcwheat"][data-s="fut"][data-g="pm"]', "aria-pressed"), "true");
      // pick KC wheat on the chart: the options block follows
      await pg.click('#cc-chips .cc-chip[data-k="kcwheat"]');
      await pg.waitForFunction(() => document.querySelector("#co-mkt h3").textContent === "Options in KC wheat");
      const rows = await pg.evaluate(() => [...document.querySelectorAll("#co-mkt tbody tr")].map((r) => r.querySelector("th").textContent));
      assert.deepEqual(rows, ["Funds", "Producers", "Swap dealers", "Other big traders"]);
      assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "still no sideways scroll");
      // Nov 6 polish: the options block shows without opening any fold, the chart says futures and the block says options
      const place = await pg.evaluate(() => {
        const b = document.getElementById("co-mkt");
        return { inFold: !!b.closest("details"), visible: !!b.offsetParent, kind: document.querySelector("#cot-chart-box .cc-kind").textContent,
          col: document.querySelector("#co-mkt thead th:nth-child(2)").textContent, offsets: /offsets/.test(b.textContent),
          hatched: document.getElementById("cm-legend").textContent.includes("Hatched: not ranked (options under 5% of open interest)."),
          afterChart: !!(document.getElementById("cot-chart-box").compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) };
      });
      assert.deepEqual(place, { inFold: false, visible: true, kind: "Futures", col: "Net options", offsets: false, hatched: true, afterChart: true });
      // one tab stop on the map; arrows move; Enter opens
      const stops = await pg.evaluate(() => [...document.querySelectorAll("#cm-wrap .cm-b")].filter((b) => b.tabIndex >= 0).length);
      assert.equal(stops, 1, "one tab stop");
      await pg.focus('#cm-wrap .cm-b[tabindex="0"]');
      await pg.keyboard.press("Home");
      await pg.keyboard.press("ArrowDown");
      await pg.keyboard.press("ArrowRight");
      const foc = await pg.evaluate(() => { const a = document.activeElement; return [a.dataset.k, a.dataset.s, a.dataset.g, a.tabIndex, [...document.querySelectorAll("#cm-wrap .cm-b")].filter((b) => b.tabIndex >= 0).length]; });
      assert.deepEqual(foc, ["mplswheat", "opt", "mm", 0, 1], "KC wheat row, Home, down, right: MPLS wheat funds options");
      await pg.keyboard.press("Enter");
      assert.equal(await pg.textContent("#cm-detail .cd-h"), "MPLS wheat: funds, options");
      await pg.keyboard.press("ArrowLeft");
      await pg.keyboard.press(" ");
      assert.equal(await pg.textContent("#cm-detail .cd-h"), "MPLS wheat: funds, futures");
      // the detail sits beside the map on a wide screen, under it on a phone
      const lay = await pg.evaluate(() => { const m = document.getElementById("cm-wrap").getBoundingClientRect(), d = document.getElementById("cm-detail").getBoundingClientRect(); return { beside: d.left >= m.right - 1 && d.top < m.bottom, under: d.top >= m.bottom - 1 }; });
      assert.equal(w >= 1000 ? lay.beside : lay.under, true, JSON.stringify(lay));
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await pg.locator("#cot-opt").screenshot({ path: path.join(SHOTS, `test-map-${w}-${theme}.png`) });
      }
      await pg.context().close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("/cot in a browser: a missing options file says so and hides the empty parts", { skip, timeout: 60000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await open(browser, port, 390, { "/data/cot-options.json": null, "/data/cot.json": read("test/fixtures/funds/cot-2026-10-27.json") });
    await pg.waitForFunction(() => /not available right now/.test(document.getElementById("co-sub").textContent));
    assert.equal(await pg.evaluate(() => ["cm-wrap", "co-unusual", "cm-legend", "cm-detail"].every((id) => document.getElementById(id).hidden) && document.getElementById("co-mkt").hidden), true);
  } finally { await browser.close(); srv.close(); }
});
