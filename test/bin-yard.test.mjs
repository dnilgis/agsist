/* Bin Print, the bin yard tool on /grain-bin-calculator (components/bin-yard.js, Nov 6, 2026).
 *
 * The node half runs the shipped files in a bare context: grain-bin.js (the one copy of the math), grain-shrink.js,
 * qr.js and bin-yard.js, and checks that every bushel Bin Print shows is grain-bin.js's own number, the bushels per
 * foot formula, the share link round trip (names and notes included) and the QR code that opens the exact yard
 * (decoded with jsQR when JSQR_PATH points at it). The browser half (Playwright and Chromium) checks the page:
 * 390 and 1280 renders, the keyboard path, no layout shift, both printed sheets on one page (Letter and A4), the
 * crew sheet's big type, the 1080 x 1350 pictures, the read-only crew view and that GA never gets typed text.
 *   node --test test/bin-yard.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ["grain-bin.js", "grain-shrink.js", "qr.js", "share-kit.js", "bin-yard.js"]) vm.runInContext(read("components/" + f), ctx);
const G = ctx.window.AgGrainBin, Y = ctx.window.AgBinYard, Q = ctx.window.AgQR;
const PAGE = read("grain-bin-calculator.html"), JS = read("components/bin-yard.js"), CSS = read("components/bin-yard.css");
const near = (a, b, msg, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const plain = (x) => JSON.parse(JSON.stringify(x));

const EAVES = [16, 20, 24, 28, 32];
const SIZE_DIAMS = JSON.parse(/var SIZE_DIAMS = (\[[\d, ]+\])/.exec(read("components/grain-bin.js"))[1]);   // grain-bin.js's own list

/* a busy yard: 12 bins, every one named, with a note and a status, notes for drivers, markers */
const NOTES = ["Full, do not fill", "Filling now, dump here", "Empty, swept", "Seed beans, do not use", "Wet corn, aerate", "Auger on east side"];
function bigYard() {
  const items = [];
  for (let i = 0; i < 12; i++) items.push(Y.normalize({ t: i % 4 === 3 ? "hopper" : "round", x: 22 + (i % 4) * 46, y: 22 + Math.floor(i / 4) * 40, d: [30, 36, 27, 18][i % 4], eave: 24,
    crop: i % 3 ? "corn" : "soybeans", fm: "height", fv: 10 + i, name: "Bin " + (i + 1), note: NOTES[i % 6], st: ["full", "filling", "empty", "dnu"][i % 4] }));
  items.push(Y.normalize({ t: "unload", x: 190, y: 62 }), Y.normalize({ t: "drive", x: 100, y: 132, L: 180, W: 12 }), Y.normalize({ t: "entry", x: 194, y: 132 }));
  return { name: "Home place", crew: "Dump at the north auger. Scale at the shop. Call before 6 pm.", crewBu: false, items };
}

test("grain-bin.js is the one copy: no bushel constant or bin formula in bin-yard.js", () => {
  assert.ok(SIZE_DIAMS.length >= 10 && SIZE_DIAMS.includes(30), "SIZE_DIAMS read from grain-bin.js");
  const code = JS.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /0\.8036|1\.2445\s*\)|Math\.PI\s*\*\s*r\s*\*\s*r|BU_PER_CUFT\s*=/, "no second copy of the math");
  assert.doesNotMatch(code, /tan\(/, "no cone of its own");
  for (const f of ["roomLeft", "roundBin", "bushels", "marketBu", "depthFromBelow", "RINGS_IN"]) assert.ok(JS.includes("G." + f), "uses AgGrainBin." + f);
  assert.ok(JS.includes("A.totalShrink"), "shrink from grain-shrink.js");
});

test("capacity parity with grain-bin.js: every SIZE_DIAMS diameter x common eaves, plain and dealer, round and hopper", () => {
  let n = 0;
  for (const d of SIZE_DIAMS) for (const eave of EAVES) {
    const r = Y.calc(Y.normalize({ t: "round", d, eave }));
    near(r.capacity, G.bushels(G.roundBin({ d, grainH: eave, surface: "peaked", peakDeg: G.PLAIN.peakDeg }).total, 0), `round ${d}x${eave}`);
    const dl = Y.calc(Y.normalize({ t: "round", d, eave, peak: "dealer" }));
    near(dl.capacity, G.bushels(G.roundBin({ d, grainH: eave, surface: "peaked", peakDeg: G.DEALER.peakDeg }).total, G.DEALER.packPct), `dealer ${d}x${eave}`);
    const h = Y.calc(Y.normalize({ t: "hopper", d, eave, hop: 45 }));
    near(h.capacity, G.bushels(G.hopperBin({ d, grainH: eave, hopperDeg: 45, surface: "peaked", peakDeg: 25 }).total, 0), `hopper ${d}x${eave}`);
    /* grain in it: a height at the wall, and a tape from the eave (depthFromBelow) */
    const f = Y.calc(Y.normalize({ t: "round", d, eave, fm: "height", fv: eave / 2 }));
    near(f.now, G.bushels(G.roundBin({ d, grainH: eave / 2, surface: "level" }).total, 0), `now ${d}x${eave}`);
    near(f.market, G.marketBu(f.now, 56, 56), "market at standard test weight");
    const b = Y.calc(Y.normalize({ t: "round", d, eave, fm: "below", fv: 5, sf: "peaked" }));
    near(b.now, G.roomLeft({ shape: "round", d, maxH: eave, grainH: G.depthFromBelow(eave, 5), surface: "peaked", peakDeg: 25, packPct: 0 }).now, `below ${d}x${eave}`);
    near(b.open, b.capacity - b.now, "open space");
    n++;
  }
  assert.equal(n, SIZE_DIAMS.length * EAVES.length);
  /* the page's own example: 30 x 24 level full is about 13,600 bu, peaked 14,950 */
  assert.equal(Math.round(Y.calc(Y.normalize({ t: "round", d: 30, eave: 24 })).capacity / 50) * 50, 14950);
  /* rings x ring height (grain-bin.js's 32 and 44 in) */
  for (const ringIn of G.RINGS_IN) {
    const r = Y.normalize({ t: "round", d: 36, hMode: "rings", rings: 9, ringIn });
    near(Y.heightFt(r), 9 * ringIn / 12, "eave from rings");
  }
  assert.equal(Y.normalize({ t: "round", hMode: "rings", ringIn: 40 }).ringIn, 32, "only grain-bin.js ring heights");
  /* market bushels at a light test weight */
  const lt = Y.calc(Y.normalize({ t: "round", d: 30, eave: 24, fm: "height", fv: 24, tw: 52 }));
  near(lt.market, lt.now * 52 / 56, "52 lb corn");
});

test("bushels per foot = pi r^2 x 1 ft x 0.8036 (x 1.06 dealer); the page's worked numbers match", () => {
  for (const d of SIZE_DIAMS) {
    near(Y.calc(Y.normalize({ t: "round", d, eave: 24 })).perFt, Math.PI * (d / 2) ** 2 * 1 * 0.8036, `plain ${d}`, 1e-9);
    near(Y.calc(Y.normalize({ t: "round", d, eave: 24, peak: "dealer" })).perFt, Math.PI * (d / 2) ** 2 * 0.8036 * 1.06, `dealer ${d}`, 1e-9);
    near(Y.calc(Y.normalize({ t: "hopper", d, eave: 24 })).perFt, Math.PI * (d / 2) ** 2 * 0.8036, `hopper ${d}`, 1e-9);
  }
  near(Y.calc(Y.normalize({ t: "flat", L: 100, W: 40, H: 12 })).perFt, 4000 * 0.8036, "flat", 1e-9);
  const q = Y.quick(Y.normalize({ t: "round", d: 30, eave: 24 }));
  near(q[0].bu * 12, q[2].bu, "1 in x 12 = 1 ft"); near(q[3].bu, q[2].bu * 5, "5 ft");
  const sec = PAGE.slice(PAGE.indexOf('id="bushels-per-foot"'), PAGE.indexOf('id="bin-inventory"'));
  const pf = (d) => Math.round(Math.PI * (d / 2) ** 2 * 0.8036);
  assert.ok(sec.includes("about " + pf(30) + " bu per foot") && sec.includes("about 47 bu") && sec.includes(pf(36) + " bu per foot") && sec.includes(pf(48).toLocaleString("en-US")), "worked numbers");
});

test("share link round trip: names, notes, statuses and notes for drivers survive; hostile input is clamped", () => {
  const yards = [{ name: "", crew: "", crewBu: false, items: Y.sample() }, bigYard(),
    { name: "North *place* / 100% & more", crew: "Line one\nLine two: scale at the shop; call #1", crewBu: true,
      items: [Y.normalize({ t: "flat", x: 50, y: 50, L: 60, W: 30, H: 10, crop: "wheat", tw: 58.5, fm: "below", fv: 2.5, name: "Shed + quonset", note: "50/50 split * check", st: "dnu" }),
        Y.normalize({ t: "hopper", x: 150, y: 40, d: 21, hMode: "rings", rings: 6, ringIn: 44, hop: 60, peak: "dealer", crop: "oats", name: "Ünïcode bin", note: "naïve café", st: "filling", fm: "height", fv: 7, sf: "draw" }),
        Y.normalize({ t: "dryer", x: 20, y: 120, name: "Tower dryer" })] }];
  for (const y of yards) {
    const want = plain(Y.normYard(y)), url = Y.shareUrl(y), hash = url.slice(url.indexOf("#"));
    assert.deepEqual(plain(Y.decode(hash)), want, "decodes to the same yard");
    assert.doesNotMatch(hash, /[\s<>"]/, "no raw spaces or markup in the link");
  }
  /* a sent link carries no more than the typed text and sizes: nothing else */
  const y = bigYard(), h = Y.encode(y);
  assert.ok(h.includes("Home+place") && h.includes("Seed+beans"), "names and notes travel in the link");
  /* hostile or broken links never throw and never escape the limits */
  for (const bad of ["", "2/R*1*1", "1/Z*1*2", "1/R*-50*9999*0*999", "1/R*%E0%A4%A*1", "1/" + "R*10*10*30*24/".repeat(80), "1/R*1*1*30*24*****" + "%3Cscript%3E"]) {
    const d = Y.decode(bad);
    if (!d) continue;
    assert.ok(d.items.length <= 40);
    for (const it of d.items) { assert.ok(it.x >= 0 && it.x <= Y.YARD_W && it.y >= 0 && it.y <= Y.YARD_H); if (it.d) assert.ok(it.d >= 6 && it.d <= 160); assert.doesNotMatch(it.name + (it.note || ""), /[<>]/); }
  }
});

function jsqr() {
  for (const p of [process.env.JSQR_PATH, "jsqr"].filter(Boolean)) { try { return createRequire(import.meta.url)(p); } catch (e) { /* next */ } }
  return null;
}
function readQr(jsQR, m, s = 4) {
  const n = (m.length + 8) * s, px = new Uint8ClampedArray(n * n * 4).fill(255);
  m.forEach((row, y) => row.forEach((v, x) => {
    if (!v) return;
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) { const o = (((y + 4) * s + dy) * n + (x + 4) * s + dx) * 4; px[o] = px[o + 1] = px[o + 2] = 0; }
  }));
  const r = jsQR(px, n, n);
  return r && r.data;
}

test("QR code opens this exact yard: a 12-bin yard with notes fits the printed size and reads back to the same yard", (t) => {
  const y = bigYard(), plan = Y.qrPlan(y, Q);
  assert.equal(plan.level, "full", "names and notes all fit");
  assert.ok((plan.matrix.length - 17) / 4 <= Y.QR_MAX_VER, "version " + (plan.matrix.length - 17) / 4);
  assert.equal(plan.caption, "Scan for this yard on your phone");
  assert.deepEqual(plain(Y.decode(plan.url.slice(plan.url.indexOf("#")))), plain(Y.normYard(y)));
  /* past the printed size it drops notes, then names, then points at the tool with a yard code */
  const huge = { name: "x".repeat(40), crew: "y ".repeat(150), items: [] };
  for (let i = 0; i < 40; i++) huge.items.push(Y.normalize({ t: "round", x: (i % 8) * 25 + 10, y: Math.floor(i / 8) * 28 + 10, d: 18, name: "Long bin name number " + i, note: "A long note that fills sixty characters for the test " + i }));
  const hp = Y.qrPlan(huge, Q);
  assert.notEqual(hp.level, "full");
  assert.ok((hp.matrix.length - 17) / 4 <= Y.QR_MAX_VER || hp.level === "tool");
  if (hp.code) assert.equal(Y.decode(hp.code).items.length, 40, "the yard code opens the sizes");
  const jsQR = jsqr();
  if (!jsQR) return t.skip("jsqr is not installed (npm i jsqr@1.4.0, or set JSQR_PATH)");
  const got = readQr(jsQR, plan.matrix);
  assert.equal(got, plan.url, "jsQR reads the link");
  assert.deepEqual(plain(Y.decode(got.slice(got.indexOf("#")))), plain(Y.normYard(y)), "and it is the same yard");
  assert.equal(readQr(jsQR, hp.matrix), hp.url, "the fallback reads too");
});

test("the page: Bin Print near the top, one ask under its totals, sheets and tips sourced, no em dashes", () => {
  const sec = PAGE.indexOf('id="bin-print"'), grid = PAGE.indexOf('class="grid-2"');
  assert.ok(sec > 0 && sec < grid, "answer first, above the calculator");
  assert.match(PAGE, /<title>Grain Bin Calculator, Free: Bushels &amp; Size Chart \| AGSIST<\/title>/);
  assert.match(PAGE, /<h1>Grain bin calculator<\/h1>/);
  assert.match(PAGE, /Bin Print: map your bin yard/);
  assert.equal((PAGE.match(/data-signup-ask=/g) || []).length, 1, "one signup path");
  assert.ok(PAGE.indexOf("<script src=\"/components/share-kit.js?v=1\"></script>\n    <script src=\"/components/bin-yard.js?v=2\"></script>") > sec, "bin-yard.js runs right after the section (blocking, so it draws before paint)");
  assert.ok(PAGE.indexOf('src="/components/grain-bin.js?v=') < PAGE.indexOf('src="/components/bin-yard.js?v='));
  assert.equal((PAGE.match(/src="\/components\/grain-bin\.js/g) || []).length, 1, "loaded once");
  assert.match(PAGE, /<link rel="stylesheet" href="\/components\/share-kit\.css\?v=1">\n<link rel="stylesheet" href="\/components\/bin-yard\.css\?v=2">/);
  assert.match(PAGE, /<script src="\/components\/qr\.js\?v=\d+" defer><\/script>/);
  for (const s of ["Print my Bin Print", "Save Bin Print picture", "Copy Bin Print link", "Print crew sheet", "Send to crew", "Edit a copy", "Names and notes travel inside the link to whoever gets it"]) assert.ok(JS.includes(s), s);
  for (const u of ["crops.extension.iastate.edu/encyclopedia/core-each-grain-bin-fall", "crops.extension.iastate.edu/post/2021-stored-grain-management",
    "extension.umn.edu/agriculture/crop-production/small-grains/storing-wheat-and-barley", "extension.okstate.edu/fact-sheets/aeration-and-cooling-of-stored-grain",
    "osha.gov/laws-regs/regulations/standardnumber/1910/1910.272", "archive.cdc.gov/www_cdc_gov/niosh/updates/93-116.html"]) assert.ok(JS.includes(u), "tip source " + u);
  assert.match(JS, /not automatically every farm bin/);
  assert.doesNotMatch(JS, /Behlen/, "no Behlen ring height");
  const added = PAGE.slice(sec, PAGE.indexOf("</section>", sec)) + PAGE.slice(PAGE.indexOf('id="bushels-per-foot"') - 8, PAGE.indexOf("Why a dealer chart reads higher"));
  for (const [n, s] of [["bin-yard.js", JS], ["bin-yard.css", CSS], ["page additions", added]]) assert.doesNotMatch(s, /\u2014|&mdash;/, "no em dash in " + n);
  /* no field asks for an address or a phone number */
  assert.doesNotMatch(JS, /type="(tel|email)"/);
  assert.doesNotMatch(JS, /placeholder="[^"]*(street|address|phone)/i);
  /* FAQ JSON-LD stays the real questions: the eight, plus the worked 15 ft 3 in example (Nov 10) */
  const ld = PAGE.match(/"@type":"FAQPage","mainEntity":\[([\s\S]*?)\]\}/);
  assert.equal((ld[1].match(/"@type": "Question"/g) || []).length, 9);
});

/* ------------------------------------------------------------------ the browser half */
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function withPage(fn, o = {}) {
  const srv = await serve(), port = srv.address().port, browser = await chromium.launch({ executablePath: CHROME });
  try {
    const open = async (opts = {}) => {
      const c = await browser.newContext({ serviceWorkers: "block", viewport: { width: opts.width || 1280, height: opts.height || 900 }, colorScheme: opts.theme || "light", acceptDownloads: true });
      const pg = await c.newPage();
      const errs = []; pg.on("pageerror", (e) => errs.push(String(e)));
      await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
      await pg.addInitScript(() => {
        window.print = () => { window.__printed = (window.__printed || 0) + 1; };
        /* what was on paper: registered before bin-yard.js's afterprint, so it sees the sheet still switched on */
        window.__paper = []; addEventListener("afterprint", () => { const el = document.getElementById("byp"); window.__paper.push(document.documentElement.classList.contains("byp-on") && el ? el.getAttribute("data-kind") : "page"); });
      });
      if (opts.init) await pg.addInitScript(opts.init.fn, opts.init.arg);
      await pg.goto(`http://127.0.0.1:${port}/grain-bin-calculator.html${opts.hash || ""}`, { waitUntil: "load" });
      pg.errs = errs;
      return { c, pg };
    };
    await fn(open, port);
  } finally { await browser.close(); srv.close(); }
}
const pdfPages = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;

test("390 and 1280: the tool draws at once, fits the width, 44 px targets, no layout shift", { skip, timeout: 120000 }, async () => {
  await withPage(async (open) => {
    for (const width of [390, 1280]) {
      const { c, pg } = await open({ width, init: { fn: () => {
        window.__cls = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__cls.push({ v: e.value, ids: e.sources.map((s) => s.node && s.node.closest && s.node.closest("#bin-print") ? "yard" : (s.node && (s.node.id || s.node.className)) || "?") }); }).observe({ type: "layout-shift", buffered: true });
      } } });
      await pg.waitForTimeout(1500);
      const r = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, bins: document.querySelectorAll("#by-map .by-it").length, rows: document.querySelectorAll("#by-tbody tr").length,
        cls: window.__cls, small: [...document.querySelectorAll("#by-root button, #by-root select, #by-root input:not([type=checkbox]):not([type=file])")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.id || e.textContent),
        ask: (() => { const e = document.querySelector("#bin-print .gb-ask"); return [e.firstElementChild ? e.firstElementChild.offsetHeight : 0, parseFloat(getComputedStyle(e).minHeight)]; })(),
        hit: Math.min(...[...document.querySelectorAll("#by-map .by-hit")].map((e) => e.getBoundingClientRect().width)) }));
      assert.equal(r.sw, width, width + ": no sideways scroll");
      assert.ok(r.ask[0] > 0 && r.ask[0] <= r.ask[1], width + ": the Daily ask fits the space held for it " + r.ask);
      assert.equal(r.bins, 8, "the sample yard's bins and markers");
      assert.equal(r.rows, 3);
      assert.deepEqual(r.small, [], width + ": controls at least 44 px tall");
      assert.ok(r.hit >= 43.5, width + ": map targets " + r.hit);
      const yardShift = r.cls.filter((e) => e.ids.includes("yard")).reduce((a, e) => a + e.v, 0);
      assert.ok(yardShift < 0.001, width + ": Bin Print moved on load " + JSON.stringify(r.cls));
      assert.deepEqual(pg.errs, []);
      await c.close();
    }
  });
});

test("keyboard path: Tab reaches a bin, arrows move it, Enter edits, Delete removes, Ctrl+Z brings it back", { skip, timeout: 60000 }, async () => {
  await withPage(async (open) => {
    const { c, pg } = await open({ width: 390 });
    await pg.focus("#by-mark");
    await pg.keyboard.press("Tab");
    assert.equal(await pg.evaluate(() => document.activeElement.getAttribute("data-i")), "0", "Tab lands on the first bin");
    const x0 = await pg.evaluate(() => AgBinYard.state().items[0].x);
    await pg.keyboard.press("ArrowRight"); await pg.keyboard.press("ArrowRight"); await pg.keyboard.press("ArrowDown");
    const p = await pg.evaluate(() => [AgBinYard.state().items[0].x, AgBinYard.state().items[0].y, document.activeElement.getAttribute("data-i")]);
    assert.equal(p[0], x0 + 10, "two steps of the 5 ft grid"); assert.equal(p[2], "0", "focus stays on the bin");
    await pg.keyboard.press("Enter");
    assert.equal(await pg.evaluate(() => document.activeElement.id), "by-e-name", "Enter opens the editor on the name");
    await pg.keyboard.type("North bin");
    assert.equal(await pg.evaluate(() => AgBinYard.state().items[0].name), "North bin");
    await pg.click("#by-done");
    assert.equal(await pg.evaluate(() => document.activeElement.getAttribute("data-i")), "0", "Done returns to the bin");
    assert.match(await pg.textContent("#by-tbody"), /North bin/);
    const n = await pg.evaluate(() => AgBinYard.state().items.length);
    await pg.keyboard.press("Delete");
    assert.equal(await pg.evaluate(() => AgBinYard.state().items.length), n - 1, "Delete removes");
    await pg.keyboard.press("Control+z");
    const back = await pg.evaluate(() => AgBinYard.state().items[0]);
    assert.equal(back.name, "North bin"); assert.equal(back.x, x0 + 10, "Ctrl+Z restores it where it was");
    /* drag with a pointer snaps to the grid */
    await pg.evaluate(() => document.getElementById("by-map").scrollIntoView({ block: "center", behavior: "instant" }));
    const box = await pg.locator('#by-map [data-i="2"] .by-shape').boundingBox();
    const hitEl = await pg.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.closest(".by-it") ? e.closest(".by-it").getAttribute("data-i") : e && (e.id || e.className.baseVal || e.className); }, [box.x + box.width / 2, box.y + box.height / 2]);
    assert.equal(hitEl, "2", "the bin is under the pointer");
    await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await pg.mouse.down();
    await pg.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2 + 30, { steps: 6 }); await pg.mouse.up();
    const dragged = await pg.evaluate(() => AgBinYard.state().items[2]);
    assert.equal(dragged.x % 5, 0); assert.equal(dragged.y % 5, 0); assert.notEqual(dragged.x, 130);
    /* saved in this browser, reloaded the same */
    await pg.reload({ waitUntil: "load" });
    assert.equal(await pg.evaluate(() => AgBinYard.state().items[0].name), "North bin");
    assert.deepEqual(pg.errs, []);
    await c.close();
  });
});

async function sheetPages(pg) {
  return [await pdfPages(await pg.pdf({ format: "Letter", printBackground: true })), await pdfPages(await pg.pdf({ format: "A4", printBackground: true }))];
}
test("both printed sheets are one page on Letter and A4, sample and 12-bin yards; crew labels 18 pt or more; QR caption", { skip, timeout: 120000 }, async () => {
  const big = bigYard(), hash = "#yard=" + Y.encode(big);
  await withPage(async (open) => {
    for (const [label, opts] of [["sample", {}], ["12 bins", { hash }]]) {
      const { c, pg } = await open(opts);
      if (opts.hash) await pg.click("#by-copy");
      for (const [btn, kind] of [["#by-print", "full"], ["#by-crewprint", "crew"]]) {
        await pg.click(btn);
        const s = await pg.evaluate(() => {
          const el = document.getElementById("byp"); el.classList.add("sk-measure");
          const svg = el.querySelector(".byp-map"), vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect(), k = Math.min(r.width / vb.width, r.height / vb.height);
          const fs = [...svg.querySelectorAll("text.by-l1, text.by-l2")].map((t) => parseFloat(t.getAttribute("font-size")) * k * 0.75);
          el.classList.remove("sk-measure");
          return { fit: el.getAttribute("data-fit"), kind: el.getAttribute("data-kind"), on: document.documentElement.classList.contains("byp-on"), minPt: Math.min(...fs), text: el.textContent, printed: window.__printed };
        });
        assert.equal(s.kind, kind); assert.ok(s.on, "print shows only the sheet"); assert.equal(s.fit, "1", `${label} ${kind}: fits without scaling`);
        assert.match(s.text, /Scan for this yard on your phone/);
        assert.match(s.text, new RegExp(Y.dateLine().replace(/ /g, " ")), "the date with the year");
        if (kind === "crew") {
          assert.ok(s.minPt >= 18, `${label}: crew labels ${s.minPt.toFixed(1)} pt`);
          assert.match(s.text, /Crew sheet: (My bin yard|Home place)/);
          if (opts.hash) { assert.match(s.text, /Dump at the north auger/); assert.match(s.text, /Do not use/); assert.doesNotMatch(s.text, /Holds/); }
        } else {
          assert.match(s.text, new RegExp("Bin Print: (My bin yard|Home place), " + Y.dateLine()));
          if (opts.hash) assert.match(s.text, /Seed beans, do not use/, "notes print on the sheet");
        }
        await pg.evaluate(() => { window.__paper = []; });
        const pages = await sheetPages(pg);
        assert.deepEqual(pages, [1, 1], `${label} ${kind}: one page on Letter and A4`);
        assert.deepEqual(await pg.evaluate(() => window.__paper), [kind, kind], "both PDFs are the sheet (the second through the beforeprint hook)");
        if (label === "12 bins") {
          const qr = await pg.evaluate(() => AgBinYard.lastPlan);
          assert.equal(qr.level, "full"); assert.deepEqual(plain(Y.decode(qr.url.slice(qr.url.indexOf("#")))), plain(Y.normYard(big)), "the sheet's QR opens this yard");
        }
        await pg.evaluate(() => document.documentElement.classList.remove("byp-on"));
      }
      await c.close();
    }
  });
});

test("pictures: 1080 x 1350, words 26 px or more but the 20 px source line, QR to the yard", { skip, timeout: 60000 }, async () => {
  await withPage(async (open) => {
    const { c, pg } = await open({ width: 390 });
    for (const [btn, crew] of [["#by-pic", false], ["#by-send", true]]) {
      await pg.evaluate(() => { delete AgBinYard.lastImage; });
      const dl = crew ? null : pg.waitForEvent("download");
      await pg.click(btn);
      await pg.waitForFunction(() => AgBinYard.lastImage);
      if (dl) await dl;
      const im = await pg.evaluate(() => AgBinYard.lastImage);
      assert.equal(im.w, 1080); assert.equal(im.h, 1350); assert.equal(im.crew, crew);
      im.sizes.forEach((s, i) => assert.ok(s >= 26 || (s === 20 && /scale ticket|cu ft|peak|pack/.test(im.texts[i])), `${im.texts[i]}: ${s}px`));
      if (!crew) assert.ok(im.sizes.includes(20), "the source line");
      assert.ok(im.texts.some((t) => /Scan for this yard on your phone/.test(t) || /Scan for this yard/.test(t)), "QR caption");
      assert.ok(im.url && im.url.includes("#yard=1/"), "the picture's QR is the yard link");
    }
    await c.close();
  });
});

test("a sent link opens read-only in the crew view; Edit a copy never touches the reader's own yard", { skip, timeout: 60000 }, async () => {
  const big = bigYard(), mine = { v: 1, name: "Mine", items: [{ t: "round", x: 50, y: 50, d: 24, eave: 20 }] };
  await withPage(async (open) => {
    const { c, pg } = await open({ width: 390, hash: "#yard=" + Y.encode(big), init: { fn: (m) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("agsist_binprint_v1", JSON.stringify(m)); sessionStorage.setItem("seeded", "1"); } }, arg: mine } });
    const v = await pg.evaluate(() => ({ mode: AgBinYard.mode(), viewing: document.getElementById("by-root").classList.contains("by-viewing"),
      editable: document.querySelectorAll("#by-root .by-it[tabindex]").length, mapShown: !!document.querySelector("#by-view .by-vmap"),
      edit: document.querySelector(".by-main").offsetParent !== null, text: document.getElementById("by-view").textContent }));
    assert.equal(v.mode, "view"); assert.ok(v.viewing); assert.equal(v.editable, 0, "nothing to drag or key"); assert.ok(v.mapShown); assert.equal(v.edit, false, "the editor is not shown");
    assert.match(v.text, /Home place/); assert.match(v.text, /Dump at the north auger/); assert.match(v.text, /Do not use/); assert.match(v.text, /Seed beans, do not use/);
    const lab = await pg.evaluate(() => Math.min(...[...document.querySelectorAll("#by-view .by-l1")].map((t) => t.getBoundingClientRect().height)));
    assert.ok(lab >= 14, "big labels on the phone: " + lab);
    assert.equal(await pg.evaluate(() => localStorage.getItem("agsist_binprint_v1")), JSON.stringify(mine), "viewing changes nothing");
    await pg.click("#by-copy");
    assert.equal(await pg.evaluate(() => AgBinYard.mode()), "copy");
    assert.equal(await pg.evaluate(() => location.hash), "");
    await pg.locator('#by-map [data-i="0"]').focus(); await pg.keyboard.press("ArrowRight");
    const after = await pg.evaluate(() => ({ mine: localStorage.getItem("agsist_binprint_v1"), copy: JSON.parse(localStorage.getItem("agsist_binprint_copy_v1")) }));
    assert.equal(after.mine, JSON.stringify(mine), "the reader's own yard is untouched");
    assert.equal(after.copy.items.length, big.items.length); assert.equal(after.copy.name, "Home place");
    await pg.click("#by-back");
    assert.equal(await pg.evaluate(() => AgBinYard.state().name), "Mine", "back to the reader's own yard");
    assert.deepEqual(pg.errs, []);
    await c.close();
  });
});

test("GA gets event names and counts, never typed text", { skip, timeout: 60000 }, async () => {
  const typed = ["Zedfarm Hollow", "Qwertybin", "Xyzzy note", "Plugh crew text"];
  await withPage(async (open) => {
    const { c, pg } = await open({ width: 1280 });
    await pg.fill("#by-name", typed[0]);
    await pg.click('#by-tbody [data-i="0"]');
    await pg.fill("#by-e-name", typed[1]); await pg.fill("#by-e-note", typed[2]); await pg.click("#by-done");
    await pg.fill("#by-crew", typed[3]);
    await pg.click('[data-add="round"]'); await pg.click("#by-done");
    await pg.click("#by-link"); await pg.click("#by-print"); await pg.click("#by-crewprint");
    const dl = pg.waitForEvent("download"); await pg.click("#by-export"); await dl;
    await pg.evaluate(() => { delete AgBinYard.lastImage; }); await pg.click("#by-send"); await pg.waitForFunction(() => AgBinYard.lastImage);
    const layer = await pg.evaluate(() => JSON.stringify((window.dataLayer || []).map((a) => Array.from(a))));
    for (const t of ["bin_print_add", "bin_print_link", "bin_print_print", "bin_print_crew_print", "bin_print_export", "bin_print_send"]) assert.ok(layer.includes(t), t + " sent");
    for (const t of typed) assert.ok(!layer.includes(t), "typed text in GA: " + t);
    assert.ok(!layer.includes("#yard="), "no link in GA");
    await c.close();
  });
});
