/* Farmland sales, not missable (Nov 4 2026; "there is dead space on the home page").
 *   - the builder's rule (scripts/build_land_sales.py lead_pick, LEAD_RULE): its selftest cases ran;
 *   - components/home-land.js in node: the reader's state first, else the newest covered sale labeled with its state,
 *     "Not yet in <state>" for an uncovered saved state, withheld on a missing or malformed file, and never a name
 *     even when the file carries one;
 *   - the menu: "Farmland sales" first under Money & Land > Land (Nov 4), in the live menu (desktop panel and
 *     phone drawer), the no-script header, the menu table and the header baked into the home page;
 *   - site search: the words people type land on /land-sales/;
 *   - in Chromium: at 1280 px the block is on the first screen, in the room under Sell grain and My field; at 390 px
 *     it sits right under My field with no gap, before the futures (the three jobs keep the phone's first screen,
 * The owner Nov 2, test/home-jobs.test.mjs); it shows the fixture's sale, never a name, and moves nothing; with no
 *     data file the plain words and the link stay.
 *     Every outside host is aborted and service workers are blocked (build rule 58).
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
// the page clock for every case below (build rule 50: no test reads today's date)
const NOW = new Date(2026, 10, 4, 9, 0);
const FIX = {
  states: ["IL", "WI", "IN", "VT", "NJ"], published: "2026-11-03",
  lead: {
    WI: lead("WI"),
    // a sale that passes today's rule (Nov 4 build: Madison County, both farm-ground tests)
    IL: lead("IL", { county: "Madison", acres: 120, ppa: 21000, when: "2026-10-30", med: 11584, n24: 48, pct: 81, window: ["2026-10-01", "2026-10-30"],
      url: "/land-sales/illinois/madison-county#s-0a1b2c3d4e", src: "Illinois Department of Revenue" }),
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
  const il = H.pick(FIX, "IL", NOW);
  assert.equal(il.st, "IL"); assert.equal(il.covered, true);
  const w = H.words(FIX, il);
  assert.equal(w.v, "$21,000 an acre");
  assert.equal(w.k, "Top bare-land price in Illinois, 30 days to Oct 30");  // pin-ok: inline fixture (FIX or lead()) read on the fixed clock NOW, not data/ or today
  assert.equal(w.s, "120 acres, Madison County, recorded Oct 30, 2026. 81% above the county\u2019s middle, $11,584 (48 sales in 24 months). Illinois Department of Revenue records.");  // pin-ok: inline fixture (FIX or lead()) read on the fixed clock NOW, not data/ or today
  assert.equal(w.href, "/land-sales/illinois/madison-county#s-0a1b2c3d4e");
  assert.equal(w.all, "Farmland sales by county in IL, IN, NJ, VT, WI");
  // no saved state: the newest lead of any covered state, labeled with its state
  const any = H.pick(FIX, "", NOW);
  assert.equal(any.st, "IL");
  assert.match(H.words(FIX, any).k, /^Top bare-land price in Illinois, 30 days to Oct 30$/);  // pin-ok: inline fixture (FIX or lead()) read on the fixed clock NOW, not data/ or today
  // an uncovered saved state: said plainly, then the newest covered sale
  const ia = H.pick(FIX, "IA", NOW);
  assert.equal(ia.st, "IL"); assert.equal(ia.covered, false);
  assert.match(H.words(FIX, ia).k, /^Not yet in Iowa\. Top bare-land price in Illinois/);
  // a covered state with no lead this month (Indiana): the newest covered sale, not an empty box
  assert.equal(H.pick(FIX, "IN", NOW).st, "IL");
  assert.equal(H.pick(FIX, "VT", NOW).st, "VT");
  // under the county middle reads "under"; sale date for Indiana-style records
  const low = { states: ["WI"], lead: { WI: lead("WI", { pct: -12, basis: "sale date" }) } };
  assert.match(H.words(low, H.pick(low, "WI", NOW)).s, /, sold Sep 4, 2026\. 12% under the county\u2019s middle/);  // pin-ok: inline fixture (FIX or lead()) read on the fixed clock NOW, not data/ or today
  for (const p of [il, any, ia]) assert.ok(!JSON.stringify(H.words(FIX, p)).includes(NAME), "no name in any line");
  // withheld: no file, no leads, a malformed lead, a link that is not a land sales page
  assert.equal(H.pick(null, "IL", NOW), null);
  assert.equal(H.pick({ states: ["IL"], lead: {} }, "IL", NOW), null);
  assert.equal(H.pick({ states: ["IL"], lead: { IL: lead("IL", { ppa: "lots" }) } }, "IL", NOW), null);
  assert.equal(H.pick({ states: ["IL"], lead: { IL: lead("IL", { url: "https://example.com/" }) } }, "IL", NOW), null);
  assert.ok(!/\u2014/.test(read("components/home-land.js")), "no em dash");
});

test("home-land.js: a state's sale more than 60 days past its window is withheld, by the page clock", () => {
  const nj = { states: ["NJ"], lead: { NJ: lead("NJ", { county: "Hunterdon", when: "2026-06-04", window: ["2026-06-01", "2026-06-30"], url: "/land-sales/new-jersey/hunterdon-county#s-0123456789" }) } };
  assert.equal(H.pick(nj, "NJ", NOW), null, "June's window, read on Nov 4: withheld");
  assert.equal(H.pick(nj, "NJ", new Date(2026, 7, 29)).st, "NJ", "60 days after Jun 30 (Aug 29): still shown");
  assert.equal(H.pick(nj, "NJ", new Date(2026, 7, 30)), null, "61 days after: withheld");
  // a New Jersey reader with a stale New Jersey sale sees the newest fresh covered sale instead, labeled
  const both = { states: ["NJ", "IL"], lead: { NJ: nj.lead.NJ, IL: FIX.lead.IL } };
  assert.equal(H.pick(both, "NJ", NOW).st, "IL");
  // the default clock is the page's own (new Date()), never a date written into the code
  assert.doesNotMatch(read("components/home-land.js"), /new Date\(\s*\d|Date\.UTC\(20\d\d/);
  assert.match(read("components/home-land.js"), /pick\(L, mineState\(\), new Date\(\)\)/);
});

test("the menu: Farmland sales first under Money & Land > Land, in the live menu (desktop and phone), the no-script header, the menu table and the home page's baked header", () => {
  const header = read("components/header.html");
  const desk = header.slice(header.indexOf('<div class="nav-menu">'), header.indexOf('<div class="nav-actions">'));
  const drawer = header.slice(header.indexOf('<div class="drawer" id="drawer"'));
  assert.match(desk, /<div class="nav-q">Land<\/div>\s*<a href="\/land-sales\/"><svg[^>]*><use href="#i-land-plot"\/><\/svg>Farmland sales<\/a>/);
  assert.match(drawer, /<h3 class="draw-sub">Land<\/h3>\s*<div class="draw-links">\s*<a href="\/land-sales\/" class="draw-item"><svg[^>]*><use href="#i-land-plot"\/><\/svg>Farmland sales<\/a>/);
  assert.doesNotMatch(header, />Land sales<\/a>/, "the old label is gone");
  assert.match(read("components/header-fallback.html"), /Land: <a href="\/land-sales\/">Farmland sales<\/a> · <a href="\/rent\/">Cash rent<\/a>/);
  assert.match(read("scripts/dev/nav/gen_nav.py"), /\("Land", \[\("\/land-sales\/", "Farmland sales", "i-land-plot"\)/);
  const home = read("index.html");
  assert.match(home.slice(home.indexOf("<!-- static-nav:header -->"), home.indexOf("<!-- /static-nav:header -->")), /Land: <a href="\/land-sales\/">Farmland sales<\/a>/);
});

test("the home page: the block, its script and the hub's email anchor", () => {
  const home = read("index.html");
  const jobs = home.slice(home.indexOf('<div class="jobs" id="hb-jobs">'), home.indexOf('<h3 class="hb-futh">'));
  assert.match(jobs, /id="job-field-h">My field<[^]*<\/nav>\s*<!--[^]*?-->\s*<div class="job job-land" id="job-land" role="group" aria-labelledby="job-land-h">\s*<h3 class="job-h" id="job-land-h">Farmland sales<\/h3>/, "right after My field");
  assert.match(jobs, /href="\/land-sales\/"[^>]*><span class="job-l" id="hl-all-l">Farmland sales by county in IL, IN, NJ, VT, WI<\/span>/);
  assert.match(jobs, /href="\/land-sales\/#email"/);
  assert.match(home, /<script src="\/components\/home-land\.js\?v=2" defer><\/script>/);
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
/* split: the home page is sent in two parts, the second PAUSE ms later, so the browser can paint between them the way a
   loaded runner's parser yields between chunks (Nov 7: the 3.9e-7 and 5.37e-6 shifts were the block's chevrons jumping
   when its second half arrived after such a paint). */
const PAUSE = 400;
function serve(leadBody, split) {
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
      if (split && u === "/index.html") {
        const buf = fs.readFileSync(f); res.write(buf.subarray(0, split));
        setTimeout(() => res.end(buf.subarray(split)), PAUSE); return;
      }
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
    window.__shift = 0; window.__moved = [];
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) {
        /* any shift with a source in the block, whatever its size: Chrome 141 (CI) and 153 attribute a pseudo-element's
           shift differently, so the parse-split test below counts every one */
        if (!e.hadRecentInput && e.sources.some((s) => s.node && s.node.closest && s.node.closest("#job-land")))
          window.__moved.push(e.value + " " + e.sources.map((s) => s.node && (s.node.id || s.node.nodeName)).join(","));
        /* a line of the block that changed size: the block's own shift (a block pushed down whole by the bids
           above it answering late is the near column's business, test/home-front) */
        if (!e.hadRecentInput && e.sources.some((s) => s.node && s.node.closest && s.node.closest("#job-land")
          && (Math.abs(s.previousRect.height - s.currentRect.height) > 0.5 || Math.abs(s.previousRect.width - s.currentRect.width) > 0.5))) window.__shift += e.value;
      } }).observe({ type: "layout-shift", buffered: true });
    } catch (e) {}
  });
  const p = await ctx.newPage();
  await p.clock.setFixedTime(new Date(2026, 10, 4, 9, 0));   // the page clock the fixtures are dated against
  await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await p.waitForFunction(() => document.getElementById("hl-v") && (/an acre/.test(document.getElementById("hl-v").textContent) || window.__hlDone), null, { timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(600);
  const r = await p.evaluate(() => {
    const b = document.getElementById("job-land"), v = document.getElementById("hl-v"), all = document.getElementById("hl-all");
    const box = (e) => { const x = e.getBoundingClientRect(); return { top: x.top, bottom: x.bottom, h: x.height }; };
    const field = document.querySelector(".job-field").getBoundingClientRect(), fut = document.querySelector(".hb-futh").getBoundingClientRect();
    return { field: { top: field.top, bottom: field.bottom }, futTop: fut.top, block: box(b), v: v.textContent, k: document.getElementById("hl-k").textContent, s: document.getElementById("hl-s").textContent,
      href: document.getElementById("hl-sale").getAttribute("href"), all: all.textContent.trim(), allHref: all.getAttribute("href"),
      text: b.textContent, shift: window.__shift, moved: window.__moved, vh: innerHeight, why: !!document.getElementById("hl-why"), terms: (document.getElementById("terms-method") || {}).textContent || "",
      cut: ["hl-k", "hl-v", "hl-s"].filter((id) => { const e = document.getElementById(id); return e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1; }) };
  });
  await ctx.close();
  return r;
}

test("in Chromium: first screen at 1280, right under My field at 390; the fixture's sale, no name, no shift; no data keeps the words", { skip, timeout: 180000 }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const withData = await serve(JSON.stringify(FIX)), without = await serve(null);
  try {
    for (const width of [390, 1280]) {
      const il = await look(browser, withData.address().port, width, { zip: "61761", state: "IL", county: "McLean", label: "Normal, IL", lat: 40.51, lon: -88.99 });
      if (width >= 1000) {
        assert.ok(il.block.bottom < il.vh, `${width}: the whole Farmland sales block is on the first screen (bottom ${il.block.bottom})`);
        assert.ok(il.block.top >= il.field.bottom - 1 && il.block.top - il.field.bottom < 24, `${width}: under Sell grain and My field`);
      } else {
        assert.ok(il.block.top >= il.field.bottom - 1 && il.block.top - il.field.bottom < 24, `${width}: right under My field, no gap (${il.field.bottom} to ${il.block.top})`);
      }
      assert.ok(il.block.bottom <= il.futTop, `${width}: before the futures`);
      assert.equal(il.v, "$21,000 an acre", `${width}: the Illinois reader sees the Illinois sale`);
      assert.equal(il.href, "/land-sales/illinois/madison-county#s-0a1b2c3d4e");
      // Nov 8: the rule is not at the top; one plain sentence in the closed Sources and terms fold
      assert.equal(il.why, false, `${width}: no method fold in the block`);
      assert.match(il.terms, /Farmland sale at the top: the highest price per acre/);
      assert.ok(!il.text.includes(NAME), `${width}: no name in the block`);
      assert.equal(il.shift, 0, `${width}: the block moves nothing`);
      const none = await look(browser, withData.address().port, width, null);
      if (width >= 1000) assert.ok(none.block.bottom < none.vh, `${width}: no saved place, still on the first screen`);
      assert.match(none.k, /Illinois/);
      const gone = await look(browser, without.address().port, width, null);
      assert.equal(gone.v, "What farmland sold for near you", `${width}: no data, the plain words stay`);
      assert.equal(gone.href, "/land-sales/");
      assert.equal(gone.allHref, "/land-sales/");
      assert.equal(gone.all, "Farmland sales by county in IL, IN, NJ, VT, WI");
      assert.equal(gone.why, false);
      assert.equal(gone.shift, 0);
      assert.ok(Math.abs(gone.block.h - il.block.h) < 1, `${width}: the same height with and without data (${gone.block.h} vs ${il.block.h})`);
    }
  } finally {
    await browser.close(); withData.close(); without.close();
  }
});

/* The longest real words never get cut (checker, Nov 4): each state's source name, the longest county sentence,
   and the uncovered-state opener, at 390, 768 and 1280; the block keeps the height it has with no data. */
const SRC = { IL: "Illinois Department of Revenue", IN: "Indiana Department of Local Government Finance",
  NJ: "New Jersey Division of Taxation", VT: "Vermont Department of Taxes", WI: "Wisconsin Department of Revenue" };
const SLUGS = { IL: "illinois", IN: "indiana", NJ: "new-jersey", VT: "vermont", WI: "wisconsin" };
test("in Chromium: the longest real words fit, nothing is cut, the height holds", { skip, timeout: 300000 }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const without = await serve(null);
  try {
    for (const st of Object.keys(SRC)) {
      const L = { states: ["IL", "WI", "IN", "VT", "NJ"], lead: { [st]: lead(st, { county: "Jo Daviess", acres: 1186.36, ppa: 123456, med: 112345,
        n24: 148, pct: 163, basis: st === "IN" ? "sale date" : "recorded", when: "2026-10-30", window: ["2026-10-01", "2026-10-30"],
        url: "/land-sales/" + SLUGS[st] + "/jo-daviess-county#s-0123456789", src: SRC[st] }) } };
      const srv = await serve(JSON.stringify(L));
      try {
        for (const width of [390, 768, 1280]) {
          const nc = await look(browser, srv.address().port, width, { zip: "27601", state: "NC", county: "Wake", label: "Raleigh, NC", lat: 35.78, lon: -78.64 });
          assert.match(nc.k, /^Not yet in North Carolina\. Top bare-land price in /, `${st} ${width}`);
          assert.ok(nc.s.endsWith(SRC[st] + " records."), `${st} ${width}: the source is in the line`);
          assert.match(nc.s, /Oct 30, 2026/, `${st} ${width}: the date is in the line`);  // pin-ok: inline fixture (FIX or lead()) read on the fixed clock NOW, not data/ or today
          assert.deepEqual(nc.cut, [], `${st} ${width}: no line cut (${nc.k} | ${nc.s})`);
          const gone = await look(browser, without.address().port, width, { zip: "27601", state: "NC", county: "Wake", label: "Raleigh, NC", lat: 35.78, lon: -78.64 });
          assert.ok(Math.abs(gone.block.h - nc.block.h) < 1, `${st} ${width}: the same height with and without the sale (${gone.block.h} vs ${nc.block.h})`);
          assert.equal(nc.shift, 0);
        }
      } finally { srv.close(); }
    }
  } finally { await browser.close(); without.close(); }
});



/* A paint between two parts of the page never moves the block (Nov 7, CI flake on loaded runners): the page is cut
   inside each of the block's lines and links and the rest sent 400 ms later. Before the fix the chevrons (centred over
   rows not yet parsed) jumped 3 to 50px when the rest came; index.html now holds the first paint (link rel=expect)
   until the element after the block has opened. */
test("in Chromium: a paint between two parts of the page moves nothing in the block", { skip, timeout: 240000 }, async () => {
  const home = read("index.html");
  assert.match(home.slice(0, home.indexOf("</head>")), /<link rel="expect" href="#hb-plain" blocking="render">/, "the first paint waits for the block");
  const land = home.indexOf('id="job-land"'), after = home.indexOf('id="hb-plain"');
  assert.ok(land > 0 && after > home.indexOf("</ul>", land), "the expected element comes after the whole block");
  const cuts = ['<span class="hl-k"', '<span class="hl-v"', '<span class="hl-s"', "</a>\n        <ul", 'id="hl-all-l">', 'id="hl-ask-l">', "</ul>"]
    .map((m) => { const i = home.indexOf(m, land); assert.ok(i > land && i < after, "cut point " + m); return Buffer.byteLength(home.slice(0, i + m.length)); });
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [1280, 390]) {
      for (const cut of cuts) {
        const srv = await serve(JSON.stringify(FIX), cut);
        try {
          const r = await look(browser, srv.address().port, width, { zip: "61761", state: "IL", county: "McLean", label: "Normal, IL", lat: 40.51, lon: -88.99 });
          assert.equal(r.v, "$21,000 an acre", `${width} cut ${cut}: the sale is drawn`);
          assert.deepEqual(r.moved, [], `${width} cut ${cut}: no layout shift with a source in the block`);
          assert.equal(r.shift, 0);
        } finally { srv.close(); }
      }
    }
  } finally { await browser.close(); }
});
