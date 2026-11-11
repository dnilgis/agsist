/* Layout shift sweep, the rest of items 5 and 6 (2026-11-09). Each page is loaded at 390 and 1280 px with scripts and
 * styles held 800 ms, data 1500 ms and outside hosts held then aborted, and its layout shift must stay under 0.005.
 *
 *   /drought-monitor  the headline (#dm-answer) is replaced when the summary file arrives, 3 to 9 lines by width, and the
 *                     page below dropped by 47 to 92 px; its room is now held per width. The updated line grew when the
 *                     map date arrived and slid the next-update badge right; the line now holds its width.
 *   /hail-map         the now card (#hm-now) and the view buttons (#hm-controls) are written by the map code, so the map
 *                     dropped by 100 px and more (0.07 to 0.1). The card's room is held before paint on a plain
 *                     /hail-map (class hm-hold) and the buttons keep one row (two between 641 and 1060 px). The card
 *                     is one headline clamped at two lines and one row of buttons, its notes in a closed box under it,
 *                     so its height does not depend on the data (a long state list or every feed failing, below).
 *   /milk-prices      Inter is font-display:optional, but a slow file swapped in anyway (headless Chrome, and any browser
 *                     that finishes the file before the page is done) and rewrapped the Dairy Margin Coverage lines
 *                     (0.05 at 1280). The page now keeps the stand-in when Inter is not ready in 100 ms.
 *   /desk, /tar-spot  held to the same bar; they were already under it in this harness (the desk token row has its own
 *                     split-stream test below). /field-scout is in test/field-scout-cmd-width.test.mjs.
 *
 *   node --test test/cls-rest.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const rd = (f) => readFileSync(ROOT + f, "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("static guards: the rooms are held in the files", () => {
  // /drought-monitor is the drought tab of /rain since Nov 11, 2026: its style is components/fold/drought.css, scoped to the tab
  const dm = rd("components/fold/drought.css");
  assert.match(dm, /#p-drought \.dm-answer\s*\{\s*min-height: 12\.8em;\s*\}/);
  assert.match(dm, /@media \(min-width: 642px\)\s*\{\s*#p-drought \.dm-answer\s*\{\s*min-height: 6\.5em;\s*\}\s*\}/);
  assert.match(dm, /#p-drought \.dm-updated\s*\{[^}]*min-width: min\(100%, 84ch\)/);
  assert.match(rd("rain.html"), /data-css="\/components\/fold\/drought\.css\?v=1"/);
  const hm = rd("hail-map.html");
  assert.match(hm, /\.hm-now\{box-sizing:border-box;min-height:calc\(2px \+ 1\.3rem \+ 3em \+ \.55rem \+ 44px\)\}/);
  assert.match(hm, /-webkit-line-clamp:2;line-clamp:2;overflow:hidden;height:3em/);
  assert.match(hm, /\.hm-now-acts\{display:flex;flex-wrap:nowrap;height:44px/);
  assert.match(hm, /\.hm-hold \.hm-now-more\[hidden\]\{display:block!important;visibility:hidden\}/);
  assert.match(hm, /\.hm-hold \.hm-now\[hidden\]\{display:block!important;visibility:hidden\}/);
  assert.match(hm, /classList\.add\('hm-hold'\)/);
  assert.match(hm, /\.hm-mapstack \.hm-controls\{min-height:44px\}/);
  assert.match(hm, /\.hm-mapstack \.hm-controls\{min-height:97px\}/);
  const milk = rd("milk-prices.html");
  assert.match(rd("desk.html"), /\.tok-row\{display:grid;grid-template-columns:minmax\(0,1fr\) 9\.5em 4\.45em/);
  assert.match(milk, /agsist-inter-gate/);
  assert.match(milk, /html\.inter-late\{--font-body:'Inter Fallback'/);
});

const PAGES = ["/desk", "/tar-spot", "/rain#drought", "/hail-map", "/milk-prices"];
const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

async function measure(page, w, h, mobile, slowFont, opt = {}) {
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = normalize(join(ROOT, p));
    if (!p.endsWith("/") && existsSync(f + ".html")) f += ".html";
    else if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    const slow = p.endsWith(".woff2") ? (slowFont ? 2500 : 0) : p.startsWith("/data/") ? 1500 : 800;
    const o = opt.override && opt.override(p);
    if (o) { setTimeout(() => { res.writeHead(o.status, { "content-type": "application/json" }); res.end(o.body || ""); }, slow); return; }
    setTimeout(() => { res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f)); }, slow);
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: h }, isMobile: mobile });
    await ctx.route("**/*", async (r) => {
      if (r.request().url().startsWith(`http://127.0.0.1:${port}`)) return r.continue();
      await new Promise((ok) => setTimeout(ok, 1500));
      return r.abort();
    });
    const pg = await ctx.newPage();
    await pg.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); });
    await pg.goto(`http://127.0.0.1:${port}${page}`, { waitUntil: "load" });
    await pg.waitForTimeout(5500);
    if (opt.until) { await pg.waitForFunction(opt.until, null, { timeout: 30000 }); await pg.waitForTimeout(1000); }
    const cls = await pg.evaluate(() => window.__cls);
    return opt.probe ? { cls, probe: await pg.evaluate(opt.probe) } : cls;
  } finally { await browser.close(); srv.close(); }
}

for (const page of PAGES) {
  for (const [w, h, mobile] of [[390, 844, true], [1280, 900, false]]) {
    test(`${page} at ${w}px, slow scripts and data, outside hosts held then aborted: layout shift under 0.005`, { skip: skip || !existsSync(ROOT + page.slice(1) + ".html") && "page not here", timeout: 120000 }, async () => {
      const cls = await measure(page, w, h, mobile, false);
      assert.ok(cls < 0.005, `layout shift ${cls.toExponential(2)}`);
    });
  }
}

/* The worst case for the hail now card: every live feed fails (the outside hosts are aborted, the 24-hour radar layer is
   missing) and the latest radar day names three of the longest state names. The card stays the height held for it and
   the notes go in the closed box under it. */
const sqr = (lo, la) => [[[lo, la], [lo + 0.5, la], [lo + 0.5, la + 0.5], [lo, la + 0.5], [lo, la]]];
const LONG_DAY = JSON.stringify({ type: "FeatureCollection", features: [[-79.5, 35.5], [-81, 33.8], [-100.5, 44.2]].map(([lo, la]) =>
  ({ type: "Feature", properties: { thresh_in: 1.0 }, geometry: { type: "MultiPolygon", coordinates: [sqr(lo, la)] } })) });
for (const [w, h, mobile] of [[390, 844, true], [1280, 900, false]]) {
  test(`/hail-map at ${w}px, every feed failing and a long state list: layout shift under 0.005, the card at its held height`, { skip, timeout: 120000 }, async () => {
    const r = await measure("/hail-map", w, h, mobile, false, {
      override: (p) => p === "/data/hail/mesh/today-partial.json" ? { status: 404 } : /^\/data\/hail\/mesh\/\d{4}-\d\d-\d\d\.json$/.test(p) ? { status: 200, body: LONG_DAY } : null,
      until: () => /Latest radar hail:/.test((document.getElementById("hm-now") || {}).textContent || "") && /Warnings are not shown/.test((document.getElementById("hm-now-notes") || {}).textContent || ""),
      probe: () => {
        const b = document.getElementById("hm-now"), head = b.querySelector(".hm-now-head"), more = document.getElementById("hm-now-more");
        const held = b.cloneNode(false); held.removeAttribute("id"); held.style.visibility = "hidden"; b.after(held);
        const out = { h: b.getBoundingClientRect().height, held: held.getBoundingClientRect().height, text: b.textContent, title: head.title,
          lines: Math.round(head.getBoundingClientRect().height / parseFloat(getComputedStyle(head).lineHeight)), open: more.open, notes: document.getElementById("hm-now-notes").textContent };
        held.remove(); return out;
      },
    });
    const p = r.probe;
    assert.ok(r.cls < 0.005, `layout shift ${r.cls.toExponential(2)}`);
    assert.match(p.title, /^(No .* in the last 24 hours\. )?Latest radar hail: .+, North Carolina, South Carolina and South Dakota\.$/, p.title);
    assert.ok(Math.abs(p.h - p.held) < 0.5, `card ${p.h}px, held ${p.held}px`);
    assert.equal(p.lines, 2, "the headline is held at two lines");
    assert.equal(p.open, false, "the notes box is closed");
    assert.match(p.notes, /Warnings are not shown right now\. Ground reports are not shown right now\. The 24-hour radar layer is not posted yet\./);
    assert.doesNotMatch(p.text + p.notes, /did not answer|did not load/);
  });
}

for (const [w, h, mobile] of [[390, 844, true], [1280, 900, false]]) {
  test(`/milk-prices at ${w}px with the Inter file 2.5 s late: layout shift under 0.005`, { skip, timeout: 120000 }, async () => {
    const cls = await measure("/milk-prices", w, h, mobile, true);
    assert.ok(cls < 0.005, `layout shift ${cls.toExponential(2)}`);
  });
}

/* the desk token row: cut right after the "Forget the token" button opens, its words and the Read button 500 ms later.
   Before, the button was drawn 34 px wide and slid 197 px when the rest came (1.1e-3 at 1280). */
test("/desk at 1280px, the token row cut before its first button's words: layout shift under 0.0005", { skip, timeout: 120000 }, async () => {
  const html = rd("desk.html"), mark = '<button type="button" class="quiet" id="tok-forget">';
  const cut = Buffer.byteLength(html.slice(0, html.indexOf(mark) + mark.length));
  const file = ROOT + "desk.html";
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = normalize(join(ROOT, p));
    if (!p.endsWith("/") && existsSync(f + ".html")) f += ".html";
    else if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    const buf = readFileSync(f);
    if (f === file) { res.write(buf.subarray(0, cut)); setTimeout(() => res.end(buf.subarray(cut)), 500); return; }
    res.end(buf);
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
    await ctx.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
    const pg = await ctx.newPage();
    await pg.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); });
    await pg.goto(`http://127.0.0.1:${port}/desk`, { waitUntil: "load" });
    await pg.waitForTimeout(1500);
    const cls = await pg.evaluate(() => window.__cls);
    assert.ok(cls < 0.0005, `layout shift ${cls.toExponential(2)}`);
  } finally { await browser.close(); srv.close(); }
});
