/* Homepage layout shift on a fresh visit, Oct 28-29, 2026 (fx/geocls).
 *
 * CI's "the homepage on a fresh visit stays under 0.1" (test/cls-oct19.test.mjs)
 * failed on two unrelated PRs with the same numbers:
 *   '/ fresh 1280: CLS 0.1678 ["0.1449 DIV#.hb-top y206>262, DIV#.hb-grid y254>346", ...]'
 * and passed on others. Suspected first: the Root Lot state sponsor (live since
 * Oct 28 for CA, NV and TX). It was not that: the CLS test refuses every
 * off-site request, so the worker's /where never answers there and the ad never
 * draws; forced to CA it draws below the fold and moves nothing. Two real causes,
 * both timing:
 *   1. The no-ZIP state of the hero band (.hb-nozip: the h1, the plain line and
 *      the ZIP box shown) was set by a script after the band. When the browser
 *      painted before reaching it (the parser yields when it likes; slower CPU,
 *      more often), the band drew in its saved-ZIP shape and then grew 56px:
 *      the 0.1449 above. Now set at the top of the band, before any of it parses.
 *   2. After the evening settle the live price draw adds a third line under each
 *      futures price ("Overnight $4.51 1/4 (unch), 7:01 pm CT") that the baked
 *      seed does not have; the band grew 17px after paint (0.005 alone, 0.17 when
 *      it landed in the same frame as the ticker's redraw). The cells now hold
 *      three lines from the first paint.
 * Tests 1 and 2 force each timing instead of waiting for it, so they fail on
 * the code before the fix every time. Test 3 forces the /where answer to a
 * sponsor state and to another state, on the homepage and on state pages, and
 * requires the ad to draw below the fold and move nothing on screen.
 *
 *   node --test test/cls-geocls.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const SIZES = [[390, 844], [1280, 800]];
const OVN = join(ROOT, "test/fixtures/futures-overnight/");

/* Static server for the committed site. opts.split: send index.html up to the
   end of the hero band, wait that many ms, then the rest (the browser paints
   what it has). opts.geo: the object served as /data/geo-sponsors.json.
   opts.prices: a file served as /data/prices.json, opts.hold ms
   before it answers. */
function serve(opts = {}) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".xml": "application/xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    if (!extname(p)) p = p.endsWith("/") ? p + "index.html" : p + ".html";
    if (p === "/data/geo-sponsors.json" && opts.geo) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(opts.geo)); return; }
    let f = normalize(join(ROOT, p));
    if (p === "/data/prices.json" && opts.prices) f = opts.prices;
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    const body = readFileSync(f), type = types[extname(f)] || "application/octet-stream";
    if (p === "/index.html" && opts.split) {
      const s = body.toString("utf8"), band = s.indexOf('id="hero-band"'), end = s.indexOf("</section>", band) + "</section>".length;
      res.writeHead(200, { "content-type": type });
      res.write(s.slice(0, end));
      setTimeout(() => res.end(s.slice(end)), opts.split);
      return;
    }
    const send = () => { res.writeHead(200, { "content-type": type }); res.end(body); };
    if (p === "/data/prices.json" && opts.hold) setTimeout(send, opts.hold); else send();
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

/* Opens a page with every off-site request refused, except the worker's /where
   when `where` is given (a US visit in that state). Shifts are recorded with
   their time and whether a moved node sits in <main>. */
async function open(browser, port, path, width, height, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600, timezoneId: "America/Chicago" });
  const pg = await ctx.newPage();
  if (o.now) await pg.clock.setFixedTime(new Date(o.now));
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    if (o.where && /^https:\/\/agsist-api\.dnilgis\.workers\.dev\/where(\?|$)/.test(u))
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ ok: true, country: "US", region_code: o.where }) });
    return r.abort();
  });
  await pg.addInitScript(() => {
    window.__shifts = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue;
        const src = (e.sources || []).map((s) => s.node && s.node.nodeType === 1 ? s.node : (s.node && s.node.parentElement) || null);
        window.__shifts.push({ t: e.startTime, v: e.value,
          band: src.some((n) => n && n.closest && n.closest("#hero-band")),
          main: src.some((n) => n && n.closest && n.closest("main")),
          what: (e.sources || []).map((s) => (s.node ? s.node.nodeName + "." + (typeof s.node.className === "string" ? s.node.className : "") : "?") + " y" + Math.round(s.previousRect.y) + ">" + Math.round(s.currentRect.y)).join(", ") });
      }
    }).observe({ type: "layout-shift", buffered: true });
    /* when the state sponsor box lands, and where */
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains("geo-spon") && !window.__geo)
        window.__geo = { t: performance.now(), top: n.getBoundingClientRect().top, vh: innerHeight };
    }).observe(document, { childList: true, subtree: true });
  });
  await pg.goto(`http://127.0.0.1:${port}${path}`);
  await pg.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await pg.waitForTimeout(o.wait || 2500);
  const r = await pg.evaluate(() => ({
    shifts: window.__shifts, geo: window.__geo || null,
    boxes: document.querySelectorAll(".geo-spon").length,
    nozip: !!document.querySelector("#hero-band.hb-nozip"),
    ovn: [...document.querySelectorAll("#hb-fc-s .hb-ovn, #hb-fs-s .hb-ovn")].map((e) => e.textContent),
  }));
  await ctx.close();
  return r;
}
const sum = (l) => l.reduce((a, e) => a + e.v, 0);
const show = (l) => JSON.stringify(l.map((e) => Math.round(e.t) + "ms " + e.v.toFixed(4) + " " + e.what));

test("homepage, fresh visit: a paint before the rest of the page arrives already has the no-ZIP band", { skip, timeout: 180000 }, async () => {
  const srv = await serve({ split: 1500 }), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [w, h] of SIZES) {
      const r = await open(browser, port, "/", w, h, { wait: 1500 });
      assert.ok(r.nozip, `${w}: no saved ZIP, the band is in its no-ZIP shape`);
      const band = r.shifts.filter((e) => e.band);
      assert.ok(sum(band) < 0.001, `${w}: the hero band moved after the first paint: ${show(band)}`);
    }
  } finally { await browser.close(); srv.close(); }
});

test("homepage: the evening overnight line under the futures lands in space held for it", { skip, timeout: 180000 }, async () => {
  // both shapes of the overnight file: after the settle (a trade under the day's
  // price) and in the night session (the trade is the price, the settle beside it)
  for (const [file, now] of [["prices-2026-10-20T0046Z.json", "2026-10-20T00:50:00Z"], ["prices-2026-10-20T0446Z.json", "2026-10-20T04:50:00Z"]]) {
    const srv = await serve({ prices: OVN + file, hold: 2000 }), port = srv.address().port;
    const browser = await chromium.launch({ executablePath: CHROME });
    try {
      for (const [w, h] of SIZES) {
        const r = await open(browser, port, "/", w, h, { now, wait: 3000 });
        assert.equal(r.ovn.length, 2, `${file} ${w}: both futures cells draw the overnight line (${JSON.stringify(r.ovn)})`);
        const band = r.shifts.filter((e) => e.band);
        assert.ok(sum(band) < 0.001, `${file} ${w}: the hero band moved when prices arrived: ${show(band)}`);
      }
    } finally { await browser.close(); srv.close(); }
  }
});

test("state sponsor: forced to a sponsor state it draws below the fold and moves nothing; another state draws nothing", { skip, timeout: 300000 }, async () => {
  const data = JSON.parse(readFileSync(join(ROOT, "data/geo-sponsors.json"), "utf8"));
  // the committed entry, switched on whatever its flag says today, so the slot is measured even between tests
  const e = Object.assign({}, (data.sponsors || []).find((s) => s.headline && s.body && Array.isArray(s.states) && s.states.length), { active: true, start: null, end: null });
  assert.ok(e.id, "data/geo-sponsors.json has an entry with copy to draw");
  const st = e.states[0], other = ["OH", "IA", "WI", "MN"].find((x) => e.states.indexOf(x) < 0);
  const SLUG = { CA: "california", NV: "nevada", TX: "texas", OR: "oregon" }[st];
  const srv = await serve({ geo: Object.assign({}, data, { sponsors: [e] }) }), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const cases = [["/", st, true], ["/", other, false]];
    if (SLUG) for (const p of [`/rain/${SLUG}`, `/prf/${SLUG}`, `/yield/${SLUG}`]) if (existsSync(join(ROOT, p.slice(1) + ".html"))) cases.push([p, other, true]);
    for (const [path, where, want] of cases) {
      for (const [w, h] of SIZES) {
        const r = await open(browser, port, path, w, h, { where, wait: 4000 });
        const tag = `${path} /where=${where} ${w}`;
        if (!want) { assert.equal(r.boxes, 0, `${tag}: no sponsor for this state`); continue; }
        assert.equal(r.boxes, 1, `${tag}: the ${e.id} box draws`);
        assert.ok(r.geo && r.geo.top >= r.geo.vh, `${tag}: drawn below the fold (${JSON.stringify(r.geo)})`);
        const after = r.shifts.filter((x) => x.main && x.t >= r.geo.t - 20);
        assert.ok(sum(after) < 0.001, `${tag}: something on screen moved when the box landed: ${show(after)}`);
      }
    }
  } finally { await browser.close(); srv.close(); }
});
