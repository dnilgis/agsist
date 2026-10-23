/* components/price-local.js and the phone layout of the futures pages, /markets,
 * /cash-bid-index and the Field Scout land card (2026-10-17, re-score 7).
 *
 * Stamps: a settle says "Oct 16 settle", a last trade "Last trade as of <time> CT".
 * State line: only for a saved state, from data/basis-states.json, hand-worked:
 *   Illinois corn, Oct 17 file: median basis -0.31 on ZCZ26, 186 elevators.
 *   Dec '26 corn settled 474.25 on Oct 16. 474.25 - 31 = 443.25 cents -> "about $4.43".
 *   Wisconsin corn: -0.565 -> "56½¢ under"; 474.25 - 56.5 = 417.75 -> "$4.18".
 *   Kansas wheat: HRW (226 elevators) beats SRW (10), KC Dec '26 KEZ26.
 * Phone: secondary sections behind labeled <details> folds, FAQ text kept in the HTML,
 * the key table above the folds, no bids file without a location.
 *   node --test test/price-local.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const P = require(join(ROOT, "components/price-local.js"));
const read = (f) => readFileSync(join(ROOT, f), "utf8");

const NOW = Date.parse("2026-10-17T12:00:00Z");   // Sat Oct 17, 7 am CT
const BS = {
  generated: "2026-10-17T06:36:48Z", min_n: 3,
  states: {
    IL: { name: "Illinois", elevators: 210, crops: { corn: { contract: "ZCZ26", label: "Dec '26", n: 186, median: -0.31 }, soybeans: { contract: "ZSX26", label: "Nov '26", n: 126, median: -0.4 } } },
    WI: { name: "Wisconsin", elevators: 83, crops: { corn: { contract: "ZCZ26", label: "Dec '26", n: 48, median: -0.565 } } },
    KS: { name: "Kansas", elevators: 251, crops: { wheat_hrw: { contract: "KEZ26", label: "Dec '26", n: 226, median: -0.675 }, wheat_srw: { contract: "ZWZ26", label: "Dec '26", n: 10, median: -1.07 } } },
    AL: { name: "Alabama", elevators: 1, crops: { soybeans: { contract: "ZSX26", label: "Nov '26", n: 1, median: null } } },
  },
};
const PR = {
  fetched: "2026-10-17T06:46:21Z",
  quotes: {
    "corn-nearby": { ticker: "ZCZ26.CBT", close: 474.25, close_kind: "settle", settle_date: "2026-10-16", close_date: "2026-10-16" },
    "beans-nearby": { ticker: "ZSX26.CBT", close: 1261.25, close_kind: "settle", settle_date: "2026-10-16", close_date: "2026-10-16" },
    "kc-dec": { ticker: "KEZ26.CBT", close: 705, close_kind: "last", close_date: "2026-10-16", close_time: "2026-10-16T18:20:00Z" },
    crude: { ticker: "CL=F", close: 101.41, close_kind: "last", close_date: "2026-10-16", close_time: "2026-10-16T21:00:00Z" },
    dollar: { ticker: "DX-Y.NYB", close: 101.84, close_kind: null, close_date: "2026-10-16" },
  },
};

test("stamps: settle, last trade with Central time, no kind", () => {
  assert.equal(P.stamp(PR.quotes["corn-nearby"], PR.fetched, NOW), "Oct 16 settle");
  assert.equal(P.stamp(PR.quotes.crude, PR.fetched, NOW), "Last trade as of Oct 16, 4:00 pm CT");
  // same Central day: the time alone, still named CT
  assert.equal(P.stamp({ close: 1, close_kind: "last", close_time: "2026-10-16T14:15:00Z" }, PR.fetched, Date.parse("2026-10-16T20:00:00Z")), "Last trade as of 9:15 am CT");
  // a last trade with no close_time falls back to when the file was read
  assert.equal(P.stamp({ close: 1, close_kind: "last" }, PR.fetched, NOW), "Last trade as of 1:46 am CT");
  assert.equal(P.stamp(PR.quotes.dollar, PR.fetched, NOW), "Updated 1:46 am CT");
  assert.equal(P.stamp(null, "", NOW), "");
  const h = P.html(PR.quotes["corn-nearby"], PR.fetched, NOW);
  assert.match(h, /^<time class="px-stamp" datetime="2026-10-16"/);
  assert.doesNotMatch(h, /data-asof/, "asof.js must not rewrite these words");
});

test("board line and its baked twin (seed_static.py mk_board) agree", () => {
  const keys = ["corn", "corn-dec", "beans", "beans-nov", "wheat", "oats", "cattle", "feeders", "hogs", "milk", "crude", "natgas", "gold", "silver", "dollar", "sp500", "btc", "xrp", "kas"];
  const q = JSON.parse(read("data/prices.json"));
  const qq = { ...q.quotes };
  for (const c of ["corn", "beans", "wheat"]) if (qq[c + "-nearby"] && qq[c + "-nearby"].close != null) qq[c] = qq[c + "-nearby"];
  const py = execFileSync("python3", ["-c", [
    "import json,sys", `sys.path.insert(0, ${JSON.stringify(join(ROOT, "scripts"))})`, "import seed_static as s",
    `p=json.load(open(${JSON.stringify(join(ROOT, "data/prices.json"))}))`, "q=dict(p['quotes'])",
    "for c in ('corn','beans','wheat'):\n    if (q.get(c+'-nearby') or {}).get('close') is not None: q[c]=q[c+'-nearby']",
    "print(json.dumps([k for _,_,_,k,_ in s.MK_MAP])); print(s.mk_board(q, p['fetched']))"].join("\n")], { encoding: "utf8" }).trim().split("\n");
  const mk = JSON.parse(py[0]);
  // the page's map and the build's map name the same cards
  const page = read("markets.html");
  for (const k of mk) assert.ok(page.includes(`{key:'${k}'`), "markets map has " + k);
  const later = Date.parse(q.fetched) + 3 * 864e5;   // the baked copy always carries the read date
  assert.equal(P.board(qq, mk, q.fetched, later), py[1]);
  assert.equal(P.board({ a: { close: 1, close_kind: "settle", settle_date: "2026-10-16" } }, null, "2026-10-17T06:46:21Z", NOW), "Oct 16 settle. Read 1:46 am CT");
  assert.equal(P.board({ a: { close: 1, close_kind: "last" } }, null, "2026-10-17T06:46:21Z", NOW), "Latest delayed trades. Read 1:46 am CT");
});

test("state line: hand-worked numbers, one wheat class, nothing when thin or stale", () => {
  const il = P.build(BS, PR, "IL", ["corn"], NOW);
  assert.match(il, /<b>Illinois corn:<\/b> median basis <b>31¢ under<\/b> Dec '26 futures, about <b>\$4\.43<\/b> cash on the Oct 16 settle\./);
  assert.match(il, /186 elevators, Oct 17\./);
  assert.match(il, /<a href="\/cash-bids">/);
  assert.match(P.build(BS, PR, "WI", ["corn"], NOW), /56½¢ under<\/b> Dec '26 futures, about <b>\$4\.18<\/b>/);
  const ks = P.lines(BS, PR, "KS", ["wheat"], NOW);
  assert.equal(ks.length, 1, "one wheat line");
  assert.match(ks[0], /Kansas HRW wheat:<\/b> median basis <b>67½¢ under<\/b> KC Dec '26 futures, about <b>\$6\.38<\/b> cash on the latest delayed trade/);
  assert.equal(P.build(BS, PR, "AL", ["soybeans"], NOW), "", "a crop with no median prints nothing");
  assert.equal(P.build(BS, PR, "TX", ["corn"], NOW), "", "a state not in the file prints nothing");
  assert.equal(P.build(BS, PR, "IL", ["corn"], Date.parse("2026-10-28T12:00:00Z")), "", "a basis file over 10 days old prints nothing");
  // no quote for the contract: basis only, no cash figure
  assert.doesNotMatch(P.build(BS, { quotes: {} }, "IL", ["corn"], NOW), /cash on/);
  // a quote older than 5 days: no cash figure
  assert.doesNotMatch(P.build(BS, { quotes: { x: { ...PR.quotes["corn-nearby"], close_date: "2026-10-09" } } }, "IL", ["corn"], NOW), /cash on/);
});

test("state comes only from the reader's saved place, never a guess", () => {
  const ls = (o) => ({ getItem: (k) => (k in o ? o[k] : null) });
  assert.equal(P.readState(ls({ "agsist-wx-loc": JSON.stringify({ state: "IL", zip: "61761" }) })), "IL");
  assert.equal(P.readState(ls({ "agsist-wx-loc": JSON.stringify({ zip: "54728" }) })), "WI");
  assert.equal(P.readState(ls({ agsist_zip: "68508" })), "NE");
  assert.equal(P.readState(ls({})), "");
  assert.equal(P.readState(ls({ "agsist-wx-loc": "not json" })), "");
  const src = read("components/price-local.js");
  const urls = [...src.matchAll(/(?:get|fetch)\('([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(urls.sort(), ["/data/basis-states.json", "/data/prices.json"].sort(), "fetches only the site's own data files");
  assert.doesNotMatch(src, /ipapi|ipinfo|geoip|ip-api/i);
  // the basis file is asked for only after a state is found
  const boot = src.slice(src.indexOf("function boot()"));
  assert.ok(boot.indexOf("if (!st)") < boot.indexOf("basis-states.json"), "no state, no basis file");
});

test("nearest-bid line from the futures basis card", () => {
  assert.equal(P.nearLine(null), "");
  const h = P.nearLine({ key: "corn", crop: "corn", price: 4.42, basis: -0.32, contract: "ZCZ26", place: "Chetek Co-op (Chetek, WI · your area)", when: "Posted Oct 16" });
  assert.match(h, /<b>Nearest corn bid:<\/b> <b>\$4\.42<\/b> at Chetek Co-op \(Chetek, WI · your area\), basis 32¢ under ZCZ26\./);
  const fj = read("components/futures.js");
  assert.match(fj, /if\(match\.distance!==null&&bidPrice!=null&&locEl\)\{/, "only a local bid, never the sample fallback");
});

const GRAIN = [["corn", "corn"], ["soybean", "soybeans"], ["wheat", "wheat"]];
test("grain futures pages: key table up, labeled folds, FAQ kept, scripts in order", () => {
  for (const [page, crop] of GRAIN) {
    const h = read(`${page}-futures-prices.html`);
    assert.match(h, new RegExp(`<p class="pl-line" data-state-bid="${crop}" hidden></p>`), page);
    const ph = h.indexOf('<div class="ph">'), pl = h.indexOf('class="pl-line"'), cg = h.indexOf('<div class="cg">'), f1 = h.indexOf('<details class="fold"');
    assert.ok(ph < pl && pl < cg && cg < f1, page + ": price, state line, key table, then the folds");
    assert.ok(h.indexOf('<div class="snap-card">') < f1, page + ": market read above the folds");
    for (const id of ["fold-sc", "fold-ratio", "fold-crop", "fold-cot", "fold-fwd", "fold-chart", "fold-seas", "fold-specs", "fold-edu"]) {
      const m = new RegExp(`<details class="fold" id="${id}"[^>]*>\\s*<summary class="fold-sum"><span class="fold-t">[^<]{6,}</span><span class="fold-d">[^<]{10,}</span></summary>`).exec(h);
      assert.ok(m, `${page}: ${id} has a labeled summary`);
    }
    // every FAQ question in the structured data is still in the page text
    const ld = JSON.parse(/<script type="application\/ld\+json">(\{"@context": "https:\/\/schema.org", "@graph".*?)<\/script>/.exec(h)[1]);
    const faq = ld["@graph"].find((x) => x["@type"] === "FAQPage");
    for (const q of faq.mainEntity) assert.ok(h.includes(q.name.replace(/&/g, "&amp;")) || h.includes(q.name), page + " FAQ: " + q.name);
    assert.ok(h.indexOf("components/price-local.js?v=7") > 0 && h.indexOf("components/price-local.js?v=7") < h.indexOf("components/futures.js?v=27"), page + ": stamp helper before futures.js");
    assert.ok(!h.includes("futures.js?v=13") && !h.includes("futures.js?v=14") && !h.includes("futures.js?v=15") && !h.includes("futures.js?v=16") && !h.includes("futures.js?v=17") && !h.includes("futures.js?v=18") && !h.includes("futures.js?v=19") && !h.includes("futures.js?v=20") && !h.includes("futures.js?v=21") && !h.includes("futures.js?v=22") && !h.includes("futures.js?v=23") && !h.includes("futures.js?v=24") && !h.includes("futures.js?v=25") && !h.includes("futures.js?v=26") && !h.includes("price-local.js?v=6") && !h.includes("price-local.js?v=2"));
    assert.match(h, /matchMedia\('\(min-width:900px\)'\)\.matches\)document\.querySelectorAll\('details\.fold\[data-wide-open\]'\)/);
  }
});

test("futures.js: no bids file without a place, stamps from close_kind, curve redrawn on open", () => {
  const fj = read("components/futures.js");
  assert.match(fj, /if\(!loc&&!savedPlace\(\)\)\{ renderBasisCard\(\{bids:\[\],zip_grid:\[\]\}\); return; \}/);
  assert.match(fj, /var __pxs=pxStampHtml\(front,data\);/);
  assert.match(fj, /e\.detail==='fold-fwd'/);
  assert.doesNotMatch(fj, /Ranks today’s quote \("\+m\(live\)/);
});

test("cattle and markets: settle stamps, folds, wording", () => {
  const c = read("cattle-futures-prices.html");
  for (const id of ["fold-fwd", "fold-cot", "fold-seas", "fold-cog"]) assert.match(c, new RegExp(`<details class="fold" id="${id}"`));
  assert.match(c, /AgPxStamp\.html\(le,d\.fetched\)/);
  assert.doesNotMatch(c, /delayed quotes, not official CME settlements/);
  const m = read("markets.html");
  assert.match(m, /<p class="pl-line" data-state-bid="corn soybeans" hidden><\/p>/);
  assert.match(m, /AgPxStamp\.board\(bq,null,data\.fetched\)/);
  assert.match(m, /<!--SEED:mk:status--><time class="px-stamp"|<!--SEED:mk:status-->(Quotes unavailable|<time class="asof")/);
});

test("no em dashes in the new code and copy", () => {
  for (const f of ["components/price-local.js", "test/price-local.test.mjs"]) assert.ok(!read(f).includes("\u2014"), f);
  for (const [page] of GRAIN) {
    const h = read(`${page}-futures-prices.html`);
    for (const m of h.matchAll(/<summary class="fold-sum">(.*?)<\/summary>/g)) assert.ok(!m[1].includes("\u2014"), page);
  }
});

test("wide tables carry their column names for the phone cards", () => {
  const cbi = read("cash-bid-index.html");
  for (const l of ["Elevators", "Avg cash", "Median", "Avg basis", "Bids raised / cut", "Basis firmer / weaker"]) assert.ok(cbi.includes(`data-l="${l}"`), l);
  assert.match(cbi, /<input type="checkbox" class="cbi-mt" id="cbi-mt-[\d-]+-corn" aria-label="Show all states \(\d+ more\)">/);
  assert.match(cbi, /\.cbi-mt:checked~\.cbi-tw tr\.cbi-more\{display:grid\}/);
  const L = require(join(ROOT, "field-scout-land.js"));
  const t = L.compsTable([{ date: "2026-09-04", ppa: 10000, acres: 40, price: 400000, mi: 0.3, muniName: "Gridley township", cls: "" }]);
  for (const l of ["Date", "$/ac", "Acres", "Price", "Miles", "Town, class"]) assert.ok(t.includes(`data-l="${l}"`), l);
  assert.match(read("field-scout-read.js"), /field-scout-land\.js\?v=7/);
});

/* ---- in a browser: 390 and 1280, light and dark ---- */
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = normalize(join(ROOT, p));
    if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
    if (!f.startsWith(ROOT) || !existsSync(f) || f.endsWith("/")) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("phone and desktop: no sideways scroll, no script errors, short phone pages, state line only with a state", { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  // phone heights at 390 before this change: corn 11,544, soybean 12,091, wheat 12,961, cattle 7,383
  const MAXH = { "/corn-futures-prices": 7500, "/soybean-futures-prices": 7500, "/wheat-futures-prices": 8000, "/cattle-futures-prices": 6000 };
  try {
    for (const path of ["/corn-futures-prices", "/soybean-futures-prices", "/wheat-futures-prices", "/cattle-futures-prices", "/markets", "/cash-bid-index"]) {
      for (const [w, scheme, loc] of [[390, "light", ""], [390, "dark", '{"zip":"61761","state":"IL"}'], [1280, "dark", ""], [1280, "light", '{"zip":"61761","state":"IL"}']]) {
        const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: w < 500 ? 844 : 900 }, colorScheme: scheme });
        await ctx.addInitScript(([s, l]) => { try { localStorage.setItem("agsist-theme", s); if (l) localStorage.setItem("agsist-wx-loc", l); } catch (e) {} }, [scheme, loc]);
        const pg = await ctx.newPage();
        const errs = [], got = [];
        pg.on("pageerror", (e) => errs.push(e.message));
        pg.on("request", (r) => { const u = r.url(); if (u.startsWith(`http://127.0.0.1:${port}`)) got.push(new URL(u).pathname); });
        await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
        await pg.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
        await pg.waitForTimeout(2500);
        const tag = `${path} ${w} ${scheme}${loc ? " state" : ""}`;
        assert.deepEqual(errs, [], tag + ": script errors");
        const r = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h: document.documentElement.scrollHeight,
          line: [...document.querySelectorAll(".pl-line")].map((e) => (e.hidden ? "" : e.textContent)).join("|") }));
        assert.ok(r.sw <= r.cw, `${tag}: sideways scroll (${r.sw} > ${r.cw})`);
        if (w === 390 && MAXH[path]) assert.ok(r.h <= MAXH[path], `${tag}: ${r.h} px tall`);
        if (path !== "/cash-bid-index" && path !== "/cattle-futures-prices") {
          if (loc) assert.match(r.line, /Illinois (corn|soybeans|SRW wheat):/, tag + ": state line");
          else assert.equal(r.line, "", tag + ": nothing without a state");
          assert.equal(got.includes("/data/basis-states.json"), !!loc, tag + ": basis file only with a state");
        }
        if (/grain|corn|soybean|wheat/.test(path) && !loc) assert.ok(!got.includes("/data/bids.json"), tag + ": no bids file without a place");
        await ctx.close();
      }
    }
  } finally { await browser.close(); srv.close(); }
});
