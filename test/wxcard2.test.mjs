/* The home Local conditions card, Nov 5, 2026 (Sig: "The fall nitrogen doesn't belong in the homepage weather card,
 * same as the spray conditions").
 *
 *   - no Fall nitrogen block (or its link) and no one-line "Today: ... spray" read in the card, in markup, script or CSS
 *   - the pages that keep them still carry them: /fall-nitrogen (its soil answer, rendered), /planting-date (soil at
 *     4 in and the fall anhydrous link), /spray and Field Scout (their spray reads). Later on Nov 5 (Sig) soil
 *     temperature, the hero band spray read and the strip's fall N cell left home too (test/homeseasonal.test.mjs)
 *   - on the page in November (a fall N month, fixed clock): neither block shows, the card is shorter than the 908 px it
 *     was with both (measured Nov 5 with these fixtures at 390 and 1280), taps 44 px, text 12 px, nothing moves
 *
 *   node --test test/wxcard2.test.mjs
 * Fixtures: test/fixtures/wxcard (frozen) and a made-up soil feed below. Browser runs block every outside host and
 * service workers (BUILD-RULES 58). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { nwsAnswer } from "./fixtures/nws-mock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const HTML = read("index.html");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
function card() {
  const a = HTML.indexOf('<div class="card wx-card'), b = HTML.indexOf('<details class="m-fold m-fold--radar"', a);
  assert.ok(a > 0 && b > a, "the Local conditions card is in index.html");
  return HTML.slice(a, b);
}

test("the card carries no fall nitrogen block and no Today spray line", () => {
  const c = card();
  for (const x of ["s7-falln", "wx-falln", "Fall nitrogen", 'href="/fall-nitrogen"', "anhydrous", "wx-today-summary", "wx-today"]) assert.ok(!c.includes(x), x);
  assert.ok(!/spray/i.test(c), "no spray copy left in the card");
  const hs = strip(read("components/home-season.js"));
  assert.ok(!/s7-falln|wx-today-summary|wx-today-text/.test(hs), "home-season.js paints neither block");
  const css = strip(read("css/home.css"));
  assert.ok(!/\.wx-falln|\.wx-today|#wx-today-summary/.test(css), "home.css has no rule for either block");
  assert.ok(!/\.wx-today/.test(strip(read("components/styles.css"))), "styles.css has no rule for the old Today line");
  // Nov 5 (Sig): the card's soil reading left too, so home loads no soil reader (test/homeseasonal.test.mjs)
  assert.ok(!/id="s7-wx-soil"/.test(c), "no soil cell in the card");
  assert.equal((HTML.match(/components\/soil-near\.js\?v=\d+/g) || []).length, 0);
});

test("the pages that keep them still carry them", () => {
  // Nov 5 (Sig): the This month strip has no fall N cell either; the pages below keep it
  const hs = read("components/home-season.js");
  assert.ok(!/'fallN'/.test(hs), "no fall N cell in any month's strip");
  // /fall-nitrogen: the soil view; /planting-date: measured soil at 4 in and the fall anhydrous link
  assert.match(read("fall-nitrogen.html"), /\/\*falln:start\*\/[\s\S]*\/\*falln:end\*\//);
  const pd = read("planting-date.html");
  assert.match(pd, /components\/soil-near\.js\?v=\d+/);
  assert.match(pd, /<a href="\/fall-nitrogen">Fall anhydrous soil temp<\/a>/);
  // /spray and Field Scout keep their spray reads
  assert.match(read("spray.html"), /components\/spray-windows\.js|spray-wind\.js/);
  assert.match(read("field-scout-read.js"), /Too windy to spray right now/);
  // Nov 5 (Sig): the hero band's spray read left too
  assert.ok(!/agsist:spray/.test(hs), "no spray read handed to the hero band");
});

/* ---------- in the browser ---------- */
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
// Measured Nov 5, 2026 with these fixtures, a fixed November clock and a ZIP in Ames: 908 px at 390 and 1280 with both
// blocks, 737 px at both without. The two blocks were about 170 px; ask for at least 120 px back.
const BEFORE = { 390: 908, 1280: 908 };
const CLOCK = "2026-11-05T15:00:00";
const pad = (a) => [...Array(10 - a.length).fill(null), ...a];
// a made-up soil feed: one station 7 miles from Ames whose last day is the day before the clock, so fall N would paint
const SOIL = {
  max_miles: 50, max_age_days: 3, updated_utc: "2026-11-05T13:30:00Z",
  state_names: { IA: "Iowa" }, net_labels: { ISUSM: "Iowa State Soil Moisture Network", USCRN: "NOAA Climate Reference Network" },
  stations: [
    { id: "ISUSM:AEEI4", net: "ISUSM", name: "Ames, IA", st: "IA", lat: 42.02, lon: -93.77, depth: "4 in", stat: "daily mean", last: "2026-11-04", t: pad([52, 51, 50, 49, 48, 47, 46]) },
    { id: "USCRN:54902", net: "USCRN", name: "Des Moines 17 E, IA", st: "IA", lat: 41.556, lon: -93.285, depth: "10 cm (3.9 in)", stat: "daily mean", last: "2026-11-04", t: pad([49, 48, 47, 47, 46, 45, 44]) },
  ],
  counties: { 19169: ["Story", "IA", 42.04, -93.47, 0, 7], 19153: ["Polk", "IA", 41.69, -93.57, 1, 16] },
};

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const fix = { "/data/rain/ia.json": "test/fixtures/wxcard/rain-ia.json", "/data/rain/wx/ia.json": "test/fixtures/wxcard/wx-ia.json" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/data/fall-nitrogen.json") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(SOIL)); return; }
    if (p === "/") p = "/index.html"; else if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, fix[p] || p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
// BUILD-RULES 58: our own copy only; the forecast from the stand-in; every other outside host aborted
const guard = (port) => (r) => {
  const u = r.request().url();
  if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
  if (/^https:\/\/api\.weather\.gov\//.test(u)) { const a = nwsAnswer(u, { now: +new Date(CLOCK) }); return r.fulfill({ status: a.status, contentType: "application/geo+json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(a.body) }); }
  if (u.includes("/bids/data/zips/")) return r.fulfill({ headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: JSON.stringify({ 50010: [42.03, -93.62] }) });
  return r.abort();
};

test("on the page in November: neither block, a shorter card, 44px taps, 12px text, nothing moves; /fall-nitrogen still answers", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
      await ctx.addInitScript(() => {
        try { localStorage.setItem("agsist-wx-loc", JSON.stringify({ zip: "50010", lat: 42.03, lon: -93.62, label: "Ames, IA", city: "Ames, IA", state: "IA" })); } catch (e) {}
        window.__shifts = [];
        try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__shifts.push({ v: e.value, s: (e.sources || []).map((x) => x.node && x.node.closest && x.node.closest(".wx-card") ? "card" : "page") }); }).observe({ type: "layout-shift", buffered: true }); } catch (e) {}
      });
      const pg = await ctx.newPage(), errors = [];
      pg.on("pageerror", (e) => errors.push(String(e)));
      await pg.clock.setFixedTime(new Date(CLOCK));
      await pg.route("**/*", guard(port));
      await pg.goto(`http://127.0.0.1:${port}/`);
      await pg.waitForFunction(() => document.querySelector('#wx-season .wxs-t[data-k="gdd30"] .wxs-v'), null, { timeout: 20000 });
      await pg.waitForFunction(() => { const t = document.getElementById("wx-temp"); return t && /\d/.test(t.textContent); }, null, { timeout: 20000 });
      // the forecast has painted the card (Overnight low), so a fall N block would have painted by now
      await pg.waitForFunction(() => /\d/.test((document.getElementById("s7-wx-low") || {}).textContent || ""), null, { timeout: 20000 });
      await pg.waitForTimeout(1000);
      const got = await pg.evaluate(() => {
        const c = document.querySelector(".wx-card"), small = [], taps = [];
        for (const el of c.querySelectorAll("*")) {
          const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
          if (!r.width || !r.height || cs.visibility === "hidden") continue;
          if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(cs.fontSize) < 12) small.push(el.className + ":" + cs.fontSize);
          if (el.matches("button,summary,a[href]") && !el.matches(".gl-term") && r.height < 44) taps.push((el.id || el.className || el.tagName) + ":" + Math.round(r.height));
        }
        return { h: Math.round(c.getBoundingClientRect().height), text: c.innerText, small, taps,
          falln: !!document.getElementById("s7-falln") || !!c.querySelector('a[href="/fall-nitrogen"]'), today: !!document.getElementById("wx-today-summary"),
          strip: (document.getElementById("s7-grid") || {}).textContent || "" };
      });
      assert.ok(!got.falln, "no fall nitrogen block in the card");
      assert.ok(!got.today, "no Today spray line in the card");
      assert.ok(!/fall nitrogen|anhydrous|spray/i.test(got.text), "no fall N or spray words in the card:\n" + got.text);
      assert.match(got.text, /Season so far, against normal/);
      assert.ok(got.h <= BEFORE[width] - 120, `card ${got.h}px at ${width}, ${BEFORE[width]}px with both blocks`);
      assert.deepEqual(got.small, [], "text 12px or more");
      assert.deepEqual(got.taps, [], "taps 44px or more");
      const shifts = await pg.evaluate(() => window.__shifts.filter((x) => x.s.includes("card")));
      assert.deepEqual(shifts, [], "nothing in the card moves the page");
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    // /fall-nitrogen still answers for a county from the same soil feed
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage(), errors = [];
    pg.on("pageerror", (e) => errors.push(String(e)));
    await pg.clock.setFixedTime(new Date(CLOCK));
    await pg.route("**/*", guard(port));
    await pg.goto(`http://127.0.0.1:${port}/fall-nitrogen?county=19153`);
    await pg.waitForSelector("#fn-answer");
    const a = await pg.textContent("#fn-answer");
    assert.match(a, /Polk County, IA/);
    assert.match(a, /44°F/);
    assert.match(a, /Iowa State: wait until soil at 4 in is below 50°F/);
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
