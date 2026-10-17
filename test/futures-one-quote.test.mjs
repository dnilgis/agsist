/* Futures pages and the markets board, the 2026-10-16 head-to-head fixes:
 *   F1  the wheat crop card showed "Spring wheat 51% good/excellent, report
 *       2026-08-23" on Oct 16: seven weeks old and the wrong crop for October.
 *   F2  one contract, two quotes: the corn page's wheat card read ZW=F
 *       (-10 1/2) while the wheat page read ZWZ26 (-11 1/4) at the same refresh.
 *   F3  the KC card ($7.02 1/4, KE=F) did not match the spread beside it
 *       (+43 1/2, figured from KEZ26 $7.01 1/2).
 *   F4  soybean RP card: "148 1/4 cents below today's board" ($1.48 1/4).
 *   F5  markets livestock and milk cards named no contract month.
 *   Top change: one dated, sourced line per crop of what USDA last printed
 *   and the board that day (scripts/moved_line.py).
 *
 * The first tests run the page's own functions in a sandbox; the browser
 * tests need Playwright and Chromium and are skipped where they are missing.
 *
 *   node --test test/futures-one-quote.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import os from "node:os";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), "utf8");

/* util.js (AG.px) and futures.js in one sandbox, no crop set: futures.js
   stops after publishing its pure helpers. */
function pure() {
  const win = {};
  const ctx = { window: win, document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, readyState: "complete", documentElement: {} },
    navigator: {}, location: { pathname: "/" }, console, setTimeout, clearTimeout };
  win.document = ctx.document;
  vm.createContext(ctx);
  ctx.self = win;
  vm.runInContext("var self=window;" + read("components/util.js"), ctx);
  if (!win.AG && ctx.AG) win.AG = ctx.AG;
  ctx.AG = win.AG;
  vm.runInContext(read("components/futures.js"), ctx);
  return { F: win.AgsistFuturesPure, AG: win.AG };
}

/* The Oct 16 16:01 UTC refresh the benchmark caught. */
const Q = (ticker, close, net, extra = {}) => ({ ticker, close, netChange: net, pctChange: (net / (close - net)) * 100, close_date: "2026-10-16", ...extra });
function board() {
  return {
    "wheat": Q("ZW=F", 658.75, -10.5), "wheat-dec26": Q("ZWZ26.CBT", 658, -11.25),
    "wheat-nearby": Q("ZWZ26.CBT", 658, -11.25, { contract: "Dec '26" }), "wheat-mar27": Q("ZWH27.CBT", 673, -10.75),
    "kcwheat": Q("KE=F", 702.25, -10), "kcwheat-dec26": Q("KEZ26.CBT", 701.5, -10.75), "kcwheat-mar27": Q("KEH27.CBT", 714.25, -9.75),
    "corn": Q("ZC=F", 474, -4.25), "corn-dec": Q("ZCZ26.CBT", 474, -4.25), "corn-dec26": Q("ZCZ26.CBT", 474, -4.25),
    "corn-nearby": Q("ZCZ26.CBT", 474, -4.25, { contract: "Dec '26" }), "corn-dec27": Q("ZCZ27.CBT", 505.25, -4.75),
    "beans": Q("ZS=F", 1257.5, -6.5), "beans-nov": Q("ZSX26.CBT", 1257.25, -6.75), "beans-nov26": Q("ZSX26.CBT", 1257.25, -6.75),
    "beans-nearby": Q("ZSX26.CBT", 1257.25, -6.75, { contract: "Nov '26" }), "beans-nov27": Q("ZSX27.CBT", 1237.75, -3.25),
    "meal": Q("ZM=F", 356.6, -3.2), "meal-dec26": Q("ZMZ26.CBT", 356.5, -3.3),
    "soyoil": Q("ZL=F", 67.14, -0.04), "soyoil-dec26": Q("ZLZ26.CBT", 67.12, -0.06),
    "oats": Q("ZO=F", 399, 3.5), "oats-dec26": Q("ZOZ26.CBT", 399, 3.5),
    "cattle": Q("LE=F", 227.35, 1.4), "cattle-oct26": Q("LEV26.CME", 227.35, 1.4), "cattle-nearby": Q("LEV26.CME", 227.35, 1.4, { contract: "Oct '26" }),
    "feeders": Q("GF=F", 343.7, 0.325), "feeders-oct26": Q("GFV26.CME", 343.7, 0.325),
    "hogs": Q("HE=F", 75.55, 0, { stale: true }), "hogs-oct26": Q("HEV26.CME", 75.55, 0.1),
    "milk": Q("DC=F", 15.32, 0.12), "milk-oct26": Q("DCV26.CME", 15.32, 0.12),
    "crude": Q("CL=F", 97.07, -0.9), "dollar": Q("DX-Y.NYB", 101.85, -0.15),
  };
}
function pricesJson(fetched) {
  return {
    fetched, quotes: board(),
    nearby: { corn: { key: "corn-dec26", label: "Dec '26" }, beans: { key: "beans-nov26", label: "Nov '26" },
              wheat: { key: "wheat-dec26", label: "Dec '26" }, cattle: { key: "cattle-oct26", label: "Oct '26" } },
    spreads: { kcwheat: { cents: 43.5, basis: "same-month", month: "Dec '26", class_key: "kcwheat-dec26", chicago_key: "wheat-dec26", class_close: 701.5, chicago_close: 658 },
               mplswheat: { cents: null, reason: "no current MGEX HRS quote on file" } },
  };
}

test("one quote per contract: a card reads the dated nearby, never the continuous series beside it", () => {
  const { F } = pure();
  const q = board();
  const w = F.nearbyOf(q, "wheat");
  assert.equal(w.d.netChange, -11.25, "the corn page's wheat card is ZWZ26 (-11 1/4), not ZW=F (-10 1/2)");
  assert.equal(w.label, "Dec '26");
  const kc = F.nearbyOf(q, "kcwheat");
  assert.equal(kc.d.close, 701.5, "no kcwheat-nearby alias yet: the nearest dated month, KEZ26, not KE=F 702.25");
  assert.equal(kc.label, "Dec '26");
  assert.equal(F.nearbyOf(q, "meal").d.close, 356.5, "the meal card is the Dec '26 meal the crush uses");
  assert.equal(F.nearbyOf(q, "hogs").d.stale, undefined, "hogs read the live Oct '26, not the stale continuous");
  const only = F.nearbyOf({ crude: Q("CL=F", 97, 1) }, "crude");
  assert.equal(only.label, null, "continuous only: label null, the card says most-active");
  assert.equal(F.nearbyOf({}, "wheat"), null);
});

test("a gap of a dollar or more prints in dollars, under a dollar in cents", () => {
  const { F } = pure();
  assert.equal(F.amt(148.25), "$1.48¼", "the soybean RP gap: 12.5725 - 11.09 = $1.4825");
  assert.equal(F.amt(-148.25), "$1.48¼", "unsigned by default");
  assert.equal(F.amt(-148.25, { sign: true }), "−$1.48¼");
  assert.equal(F.amt(43.5, { sign: true }), "+43½¢", "KC over Chicago: 701.5 - 658 = 43.5");
  assert.equal(F.amt(99.75), "99¾¢");
  assert.equal(F.amt(100), "$1.00");
  const js = read("components/futures.js");
  assert.doesNotMatch(js, /AG\.px\.move\(Math\.abs\(_gap\)\*100\)/, "the RP factor no longer prints cents over a dollar");
  assert.match(js, /amt\(_gap\*100\)\+' '\+\(_gap>0\?'above':'below'\)/);
});

test("the wheat crop card shows only what is in season and fresh", () => {
  const { F } = pure();
  const cp = JSON.parse(read("test/fixtures/crop-progress-2026-10-16.json"));
  const oct16 = Date.UTC(2026, 9, 16, 16);
  const plain = (x) => JSON.parse(JSON.stringify(x)); // arrays from the sandbox realm
  const rows = plain(F.wheatProgressRows(cp, oct16));
  const lbls = rows.map((r) => r.lbl);
  assert.deepEqual(lbls, ["Winter wheat planted", "Winter wheat emerged"], "no Aug 23 spring wheat, no Jul 5 winter wheat harvest");
  assert.equal(rows[0].val, "51%");
  assert.equal(rows[0].avg5, 58);
  assert.equal(rows[1].val, "27%");
  assert.deepEqual(plain(F.wheatProgressRows(cp, Date.UTC(2026, 9, 22, 16))), [], "Oct 22: the Oct 11 week is 11 days old, the card hides");
  assert.equal(F.wheatProgressRows(cp, Date.UTC(2026, 9, 21, 16)).length, 2, "Oct 21: 10 days, still shown");
  const july = plain(F.wheatProgressRows(cp, Date.UTC(2026, 6, 8, 16)).map((r) => r.lbl));
  assert.deepEqual(july, ["Winter wheat condition", "Winter wheat harvested"], "Jul 8: the Jul 5 winter wheat rows were in season");
  const html = read("wheat-futures-prices.html");
  assert.doesNotMatch(html, /id="cp-spring"/);
  assert.match(html, /id="cp-avg-note"[^>]*>5-year average: AGSIST's arithmetic/);
});

test("the corn, soybean and wheat tiles read a root, not a continuous key", () => {
  const js = read("components/futures.js");
  const tiles = [...js.matchAll(/tiles:\[(.*?)\],\n/g)].map((m) => m[1]);
  assert.equal(tiles.length, 3);
  for (const t of tiles) {
    for (const k of ["corn", "beans", "wheat", "oats", "meal", "soyoil"]) {
      assert.doesNotMatch(t, new RegExp(`\\{key:'${k}'`), `no continuous ${k} tile`);
    }
  }
  assert.doesNotMatch(read("wheat-futures-prices.html"), /Most-active vs most-active/);
});

test("markets: the build names every card's month and reads the dated quote", () => {
  const dir = mkdtempSync(join(os.tmpdir(), "mk-"));
  copyFileSync(join(ROOT, "markets.html"), join(dir, "markets.html"));
  const py = `
import sys, json, os
sys.path.insert(0, ${JSON.stringify(join(ROOT, "scripts"))})
os.chdir(${JSON.stringify(dir)})
import seed_static as s
s.seed_markets(json.loads(sys.argv[1]), '2026-10-16')
`;
  execFileSync("python3", ["-c", py, JSON.stringify(pricesJson("2026-10-16T16:01:00Z"))], { stdio: "pipe" });
  const out = readFileSync(join(dir, "markets.html"), "utf8");
  const seed = (id) => new RegExp(`<!--SEED:mk:${id}-->([^<]*)<!--/SEED-->`).exec(out)[1];
  for (const id of ["pct-cattle", "pct-feeder", "pct-hogs", "pct-milk"]) {
    assert.equal(seed(id).replace(/&#x27;|&#39;/g, "'"), "Oct '26", id);
  }
  assert.equal(seed("pct-oats").replace(/&#x27;|&#39;/g, "'"), "Dec '26");
  assert.equal(seed("pct-meal").replace(/&#x27;|&#39;/g, "'"), "Dec '26");
  assert.equal(seed("pcp-meal"), "$356.50", "meal-dec26 356.5, not ZM=F 356.6");
  assert.match(seed("pcc-wheat"), /^▼ −11¼¢/, "markets wheat is the same -11 1/4 the wheat page shows");
  const page = read("markets.html");
  for (const id of ["pct-cattle", "pct-feeder", "pct-hogs", "pct-milk", "pct-oats", "pct-meal", "pct-oil"]) {
    assert.match(page, new RegExp(`id="${id}"`), `${id} chip on the page`);
  }
  assert.doesNotMatch(page, /<span class="pc-contract">ZO<\/span>/);
});

test("the dated USDA line: selftest, the pages carry it, no em dash", () => {
  const out = execFileSync("python3", ["scripts/moved_line.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /SELFTEST OK/);
  for (const p of ["corn", "soybean", "wheat"]) {
    const h = read(`${p}-futures-prices.html`);
    assert.match(h, /<!--SEED:moved--><p class="moved-line" id="moved-line"/, `${p} page has the seeded line`);
    const line = /<!--SEED:moved-->(.*?)<!--\/SEED-->/s.exec(h)[1];
    assert.doesNotMatch(line, /—/);
    assert.doesNotMatch(line, /because|due to|on fears|traders|expect/i, "facts only, no cause");
  }
});

/* ---------- in a real browser ---------- */
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function isoDaysAgo(n) { const d = new Date(Date.now() - n * 864e5); return d.toISOString().slice(0, 10); }
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const cp = JSON.parse(read("test/fixtures/crop-progress-2026-10-16.json"));
  for (const k of ["winter_wheat_planted", "winter_wheat_emerged"]) cp.progress[k].date = isoDaysAgo(5);
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p) && p !== "/") p += ".html";
    if (p === "/data/prices.json") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(pricesJson(new Date().toISOString()))); return; }
    if (p === "/data/crop-progress.json") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(cp)); return; }
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, path, ready) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  /* The board above is a mid-October 2026 file with October livestock months.
     The pages roll expired contracts off (price-local.js roll, 2026-10-17),
     so the browser runs on the board's own week: Oct 14, the last trading day
     of Oct '26 hogs, when every month on the board still trades. */
  await pg.clock.setFixedTime(new Date("2026-10-14T20:00:00Z"));
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.goto(`http://127.0.0.1:${port}${path}`);
  await pg.waitForFunction(ready, null, { timeout: 15000 });
  return { pg, ctx };
}
const txt = (pg, sel) => pg.$eval(sel, (e) => e.textContent.trim());

test("browser: the same Dec wheat on the corn page, the wheat page and markets; KC card minus Chicago card = the spread", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    let { pg, ctx } = await open(browser, port, "/corn-futures-prices", () => !document.getElementById("p-wheat").classList.contains("sk"));
    assert.equal(await txt(pg, "#p-wheat"), "$6.58");
    assert.match(await txt(pg, "#c-wheat"), /^▼ −11¼¢/);
    assert.equal(await pg.$eval("#p-wheat", (e) => e.parentNode.querySelector(".cc-lbl").textContent), "Wheat Dec '26 (ZW)");
    assert.equal(await pg.$eval("#p-beans", (e) => e.parentNode.querySelector(".cc-lbl").textContent), "Soybeans Nov '26 (ZS)");
    await ctx.close();

    ({ pg, ctx } = await open(browser, port, "/wheat-futures-prices", () => document.getElementById("cs-kezw").textContent !== "-"));
    assert.equal(await txt(pg, "#p-wheat"), "$6.58");
    assert.equal(await txt(pg, "#p-kcwheat"), "$7.01½", "KEZ26, not KE=F $7.02¼");
    assert.equal(await txt(pg, "#cs-kezw"), "+43½¢", "$7.01½ - $6.58 = 43½¢, the two cards subtract to the spread");
    assert.equal(await pg.$eval("#cc-kcwheat .cc-lbl", (e) => e.textContent), "KC HRW Dec '26 (KE)");
    assert.match(await txt(pg, "#cs-kezw-row .xl"), /Dec '26/);
    assert.match(await txt(pg, ".cls-spread-src"), /^Same delivery month for both classes \(Dec '26\)/);
    await pg.waitForFunction(() => document.querySelectorAll("#cp-rows .crop-row").length > 0);
    const rows = await pg.$$eval("#cp-rows .crop-row", (r) => r.map((x) => x.textContent));
    assert.deepEqual(rows, ["Winter wheat planted: 51% (5-yr avg 58%)", "Winter wheat emerged: 27% (5-yr avg 32%)"]);
    assert.doesNotMatch(await pg.$eval("#crop-card", (e) => e.textContent), /Spring wheat/);
    assert.equal(await pg.isVisible("#moved-line"), true);
    await ctx.close();

    ({ pg, ctx } = await open(browser, port, "/markets", () => document.getElementById("pcp-wheat").textContent.indexOf("6.58") >= 0));
    assert.match(await txt(pg, "#pcc-wheat"), /^▼ −11¼¢/);
    assert.equal(await txt(pg, "#pct-cattle"), "Oct '26");
    assert.equal(await txt(pg, "#pct-hogs"), "Oct '26");
    assert.equal(await txt(pg, "#pct-milk"), "Oct '26");
    assert.equal(await txt(pg, "#pct-feeder"), "Oct '26");
    assert.equal(await txt(pg, "#pct-oats"), "Dec '26");
    assert.equal(await txt(pg, "#pcp-meal"), "$356.50");
    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
});
