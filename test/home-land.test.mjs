/* Farmland sales, not missable (Sig, Nov 4 2026: "my buddy didn't know that farm land sales were on agsist, we need
 * to fix that and make sure it is not missable"; "there is dead space on the home page").
 *   - the builder's rule (scripts/build_land_sales.py lead_pick, LEAD_RULE): its selftest cases ran;
 *   - components/home-land.js in node: the reader's state first, else the newest covered sale labeled with its state,
 *     "Not yet in <state>" for an uncovered saved state, withheld on a missing or malformed file, and never a name
 *     even when the file carries one;
 *   - the menu: /land-sales/ in the live menu (desktop panel and phone drawer), the no-script header and the header
 *     baked into the home page;
 *   - site search: the words people type land on /land-sales/;
 *   - in Chromium at 390 and 1280 px: the block is on the first screen, shows the fixture's sale, never a name, and
 *     moves nothing (no layout shift from the block); with no data file the plain words and the link stay.
 *     Every outside host is aborted and service workers are blocked (BUILD-RULES 58).
 *
 *   node --test test/home-land.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PLACES_ROUTE } from "./fixtures/places-mock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const NAME = "ZEBEDIAH QUIMBLEFARM";       // a made-up buyer that must never reach the page

function lead(st, o) {
  return Object.assign({ st, id: "0123456789", county: "Testa", acres: 152.48, ppa: 18823, when: "2026-09-04", basis: "recorded",
    med: 12969, n24: 42, pct: 45, of: 53, window: ["2026-09-01", "2026-09-30"], url: "/land-sales/wisconsin/testa-county#s-0123456789",
    rule: "The highest price per acre among bare farmland sales (40 acres or more) recorded in Wisconsin in the 30 days to Sep 30, 2026.",
    src: "Wisconsin Department of Revenue", buyer: NAME, grantee: NAME }, o || {});
}
const FIX = {
  states: ["IL", "WI", "IN", "VT", "NJ"], published: "2026-11-03",
  lead: {
    WI: lead("WI"),
    IL: lead("IL", { county: "Will", acres: 96.36, ppa: 24125, when: "2026-10-09", med: 14500, n24: 49, pct: 66, window: ["2026-10-01", "2026-10-30"],
      url: "/land-sales/illinois/will-county#s-b2b2aaab92", src: "Illinois Department of Revenue" }),
    IN: null, NJ: null,
    VT: lead("VT", { county: "Windham", ppa: 5959, when: "2026-10-15", window: ["2026-09-16", "2026-10-15"], url: "/land-sales/vermont/windham-county#s-3167bd3a27" }),
  },
};

test("the builder's rule: the highest $/acre inside its county's usual range, withheld when thin, no names", () => {
  const s = execFileSync("python3", ["scripts/build_land_sales.py", "--selftest"], { cwd: ROOT, encoding: "utf8", timeout: 300000 });
  for (const name of ["lead.json: Wisconsin's lead is the top in-range sale (DS5, $11,429), not the far-above one",
    "lead.json: its county middle, sample and window", "lead.json names no one", "lead: withheld under 3 sales in the window",
    "lead: withheld when the county has under 5 comparable sales",
    "every page carries the GA config, not only the guard (Nov 4: no land page view reached GA)"]) {
    assert.ok(s.includes("ok   " + name), "build_land_sales selftest ran: " + name);
  }
  assert.match(s, /build_land_sales selftest: ok/);
});

const ctx = { module: { exports: {} } };
vm.runInNewContext(read("components/home-land.js"), ctx);
const H = ctx.module.exports;

test("home-land.js: whose sale, what it says, and never a name", () => {
  const il = H.pick(FIX, "IL");
  assert.equal(il.st, "IL"); assert.equal(il.covered, true);
  const w = H.words(FIX, il);
  assert.equal(w.v, "$24,125 an acre");
  assert.equal(w.k, "Top bare-land price in Illinois, 30 days to Oct 30");
  assert.equal(w.s, "96.4 acres, Will County, recorded Oct 9, 2026. 66% above the county’s middle, $14,500 (49 sales in 24 months). Illinois Department of Revenue records.");
  assert.equal(w.href, "/land-sales/illinois/will-county#s-b2b2aaab92");
  assert.equal(w.all, "Farmland sales by county in IL, IN, NJ, VT, WI");
  // no saved state: the newest lead of any covered state, labeled with its state
  const any = H.pick(FIX, "");
  assert.equal(any.st, "VT");
  assert.match(H.words(FIX, any).k, /^Top bare-land price in Vermont, 30 days to Oct 15$/);
  // an uncovered saved state: said plainly, then the newest covered sale
  const ia = H.pick(FIX, "IA");
  assert.equal(ia.st, "VT"); assert.equal(ia.covered, false);
  assert.match(H.words(FIX, ia).k, /^Not yet in Iowa\. Top bare-land price in Vermont/);
  // a covered state with no lead this month (Indiana): the newest covered sale, not an empty box
  assert.equal(H.pick(FIX, "IN").st, "VT");
  // under the county middle reads "under"; sale date for Indiana-style records
  const low = { states: ["WI"], lead: { WI: lead("WI", { pct: -12, basis: "sale date" }) } };
  assert.match(H.words(low, H.pick(low, "WI")).s, /, sold Sep 4, 2026\. 12% under the county\u2019s middle/);
  for (const p of [il, any, ia]) assert.ok(!JSON.stringify(H.words(FIX, p)).includes(NAME), "no name in any line");
  // withheld: no file, no leads, a malformed lead, a link that is not a land sales page
  assert.equal(H.pick(null, "IL"), null);
  assert.equal(H.pick({ states: ["IL"], lead: {} }, "IL"), null);
  assert.equal(H.pick({ states: ["IL"], lead: { IL: lead("IL", { ppa: "lots" }) } }, "IL"), null);
  assert.equal(H.pick({ states: ["IL"], lead: { IL: lead("IL", { url: "https://example.com/" }) } }, "IL"), null);
  assert.ok(!/—/.test(read("components/home-land.js")), "no em dash");
});

test("the menu: Land sales in the live menu (desktop and phone), the no-script header and the home page's baked header", () => {
  const header = read("components/header.html");
  const desk = header.slice(header.indexOf('<div class="nav-menu">'), header.indexOf('<div class="nav-actions">'));
  const drawer = header.slice(header.indexOf('<div class="drawer" id="drawer"'));
  assert.match(desk, /<a href="\/land-sales\/">[^]*?Land sales<\/a>/);
  assert.match(drawer, /<a href="\/land-sales\/" class="draw-item">[^]*?Land sales<\/a>/);
  assert.match(read("components/header-fallback.html"), /<a href="\/land-sales\/">Land sales<\/a>/);
  const home = read("index.html");
  assert.match(home.slice(home.indexOf("<!-- static-nav:header -->"), home.indexOf("<!-- /static-nav:header -->")), /<a href="\/land-sales\/">Land sales<\/a>/);
});

test("the home page: the block, its script and the hub's email anchor", () => {
  const home = read("index.html");
  const jobs = home.slice(home.indexOf('<div class="jobs" id="hb-jobs">'), home.indexOf('<h3 class="hb-futh">'));
  assert.match(jobs, /<section class="job job-land" id="job-land"[^]*<h3 class="job-h" id="job-land-h">Farmland sales<\/h3>/);
  assert.match(jobs, /href="\/land-sales\/"[^>]*><span class="job-l" id="hl-all-l">Farmland sales by county in IL, IN, NJ, VT, WI<\/span>/);
  assert.match(jobs, /href="\/land-sales\/#email"/);
  assert.match(home, /<script src="\/components\/home-land\.js\?v=1" defer><\/script>/);
  assert.match(read("scripts/build_land_sales.py"), /<div class="ls-ask" id="email"><div data-land-alert data-source="page:land-sales">/);
});

test("site search: the words people type land on /land-sales/", () => {
  const c = { window: {} };
  vm.runInNewContext(read("components/search.js"), c);
  const S = c.window.AgsistSearch;
  const items = S._prep(JSON.parse(read("data/search-index.json")).items);
  for (const q of ["land sales", "farmland sales", "land auction", "land prices", "farm for sale", "what did land sell for", "farm land sales"]) {
    assert.equal(S._search(items, q, "")[0]?.e.url, "/land-sales/", q);
  }
  assert.match(S._search(items, "illinois land sales", "")[0]?.e.url, /^\/land-sales\/#illinois$/);
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".xml": "application/xml" };
function serve(leadBody) {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      let u = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (u === "/data/land-sales/lead.json") {
        if (leadBody == null) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "content-type": "application/json" }); res.end(leadBody); return;
      }
      if (u.endsWith("/")) u += "index.html";
      let f = path.normalize(path.join(ROOT, u));
      if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      if (!fs.existsSync(f) && fs.existsSync(f + ".html")) f += ".html";
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

async function look(browser, port, width, place) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 800 }, serviceWorkers: "block" });
  await ctx.route(PLACES_ROUTE, (r) => r.abort());
  if (place) await ctx.addInitScript((s) => { try { localStorage.setItem("agsist-wx-loc", s); } catch (e) {} }, JSON.stringify(place));
  await ctx.addInitScript(() => {
    window.__shift = 0;
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) {
        /* a line of the block that changed size: the block's own shift (a block pushed down whole by the bids
           above it answering late is the near column's business, test/home-front) */
        if (!e.hadRecentInput && e.sources.some((s) => s.node && s.node.closest && s.node.closest("#job-land")
          && (Math.abs(s.previousRect.height - s.currentRect.height) > 0.5 || Math.abs(s.previousRect.width - s.currentRect.width) > 0.5))) window.__shift += e.value;
      } }).observe({ type: "layout-shift", buffered: true });
    } catch (e) {}
  });
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await p.waitForFunction(() => document.getElementById("hl-v") && (/an acre/.test(document.getElementById("hl-v").textContent) || window.__hlDone), null, { timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(600);
  const r = await p.evaluate(() => {
    const b = document.getElementById("job-land"), v = document.getElementById("hl-v"), all = document.getElementById("hl-all");
    const box = (e) => { const x = e.getBoundingClientRect(); return { top: x.top, bottom: x.bottom, h: x.height }; };
    return { block: box(b), v: v.textContent, k: document.getElementById("hl-k").textContent, s: document.getElementById("hl-s").textContent,
      href: document.getElementById("hl-sale").getAttribute("href"), all: all.textContent.trim(), allHref: all.getAttribute("href"),
      text: b.textContent, shift: window.__shift, vh: innerHeight, why: getComputedStyle(document.getElementById("hl-why")).visibility };
  });
  await ctx.close();
  return r;
}

test("in Chromium: on the first screen at 390 and 1280, the fixture's sale, no name, no shift; no data keeps the words", { skip, timeout: 180000 }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const withData = await serve(JSON.stringify(FIX)), without = await serve(null);
  try {
    for (const width of [390, 1280]) {
      const il = await look(browser, withData.address().port, width, { zip: "61761", state: "IL", county: "McLean", label: "Normal, IL", lat: 40.51, lon: -88.99 });
      assert.ok(il.block.top < il.vh, `${width}: the Farmland sales block starts on the first screen (top ${il.block.top})`);
      assert.equal(il.v, "$24,125 an acre", `${width}: the Illinois reader sees the Illinois sale`);
      assert.equal(il.href, "/land-sales/illinois/will-county#s-b2b2aaab92");
      assert.equal(il.why, "visible", `${width}: how the sale was picked`);
      assert.ok(!il.text.includes(NAME), `${width}: no name in the block`);
      assert.equal(il.shift, 0, `${width}: the block moves nothing`);
      const none = await look(browser, withData.address().port, width, null);
      assert.ok(none.block.top < none.vh, `${width}: no saved place, still on the first screen`);
      assert.match(none.k, /Vermont/);
      const gone = await look(browser, without.address().port, width, null);
      assert.equal(gone.v, "What farmland sold for near you", `${width}: no data, the plain words stay`);
      assert.equal(gone.href, "/land-sales/");
      assert.equal(gone.allHref, "/land-sales/");
      assert.equal(gone.all, "Farmland sales by county in IL, IN, NJ, VT, WI");
      assert.equal(gone.why, "hidden", `${width}: no rule shown without a sale`);
      assert.equal(gone.shift, 0);
      assert.ok(Math.abs(gone.block.h - il.block.h) < 1, `${width}: the same height with and without data (${gone.block.h} vs ${il.block.h})`);
    }
  } finally {
    await browser.close(); withData.close(); without.close();
  }
});
