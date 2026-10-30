/* The Christmas Rain Print line (components/rp-xmas.js, Sig Oct 30, 2026).
 *
 * One slim line in Sig's voice near the top of the field and weather pages,
 * Nov 1 through the print Christmas cutoff, with his phone number for people
 * who would rather he made the print. It must:
 *   - be on exactly these pages: /rain and every county rain page, /rain-radar,
 *     /hail-map, /drought-monitor, /spray, /gdu-calculator, /field-scout and the
 *     Farmland Atlas county pages; never the home page or the Daily;
 *   - end on data/rain-print.json print_christmas_cutoff, start Nov 1;
 *   - be written before the first paint (a plain script tag inside <main>), so
 *     nothing moves: in the browser no layout shift ever names the line;
 *   - never push a page's first-screen promise down: on /hail-map it sits under
 *     the map and its 5-year controls, on county rain pages under the print
 *     and its sell block (test/hail-map-now and test/rain-print-top run in and
 *     out of the dates through window.AGSIST_TODAY);
 *   - fit at 390 with no sideways scroll, cover nothing, hide for 30 days on x,
 *     and keep the page to one Rain Print line (the after-content one hides).
 *
 *   node --test test/rp-xmas.test.mjs      RPX_SHOTS=<dir> saves screenshots at 390 and 1280
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, readdirSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const require = createRequire(import.meta.url);
const X = require(ROOT + "components/rp-xmas.js");
const TAG = /<script src="\/components\/rp-xmas\.js\?v=(\d+)"><\/script>/g;
const SHOTS = process.env.RPX_SHOTS || "";
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const STATIC = ["rain-radar.html", "hail-map.html", "drought-monitor.html", "spray.html", "gdu-calculator.html", "field-scout.html"];
const NEVER = ["index.html", "daily.html", "rain-print.html", "cash-bids.html", "markets.html"];
const states = (dir) => readdirSync(ROOT + dir).filter((d) => statSync(ROOT + dir + "/" + d).isDirectory() && /^[a-z-]+$/.test(d));

test("the dates: Nov 1 through the print Christmas cutoff in data/rain-print.json", () => {
  const cfg = JSON.parse(read("data/rain-print.json"));
  assert.equal(X.FROM, "2026-11-01");
  assert.equal(X.UNTIL, cfg.print_christmas_cutoff, "UNTIL follows print_christmas_cutoff");
  assert.equal(X.inWindow("2026-10-31"), false);
  assert.equal(X.inWindow("2026-11-01"), true);
  assert.equal(X.inWindow(cfg.print_christmas_cutoff), true);
  assert.equal(X.inWindow("2026-12-11"), false);
  assert.equal(X.inWindow(""), false);
  assert.equal(X.inWindow("junk"), false);
  assert.equal(X.chicagoToday(new Date("2026-11-01T04:30:00Z")), "2026-10-31", "Chicago time, not UTC");
});

test("the x hides it for 30 days, and only a real time counts", () => {
  const now = Date.parse("2026-11-20T12:00:00Z"), day = 864e5;
  assert.equal(X.dismissed(String(now - day), now), true);
  assert.equal(X.dismissed(String(now - 29.9 * day), now), true);
  assert.equal(X.dismissed(String(now - 30 * day), now), false);
  assert.equal(X.dismissed(null, now), false);
  assert.equal(X.dismissed("yes", now), false);
  assert.equal(X.dismissed(String(now + day), now), false, "a time in the future does not hide it");
});

test("the words: plain, first person, the phone link the site uses, no dash, no countdown", () => {
  const h = X.html(), t = h.replace(/<[^>]+>/g, "");
  assert.match(h, /href="\/rain-print"/);
  assert.match(h, /href="tel:\+17157972428"/);
  assert.match(t, /call me and I.ll make it for you: \(715\) 797-2428\./);
  assert.doesNotMatch(t, /[–—]/);
  assert.doesNotMatch(t, /\b(only|hurry|left|days?|hours?|last chance|sale|off)\b/i);
  assert.match(h, /aria-label="Hide this for 30 days"/);
});

test("on exactly the field and weather pages, once, inside <main>, one ?v= everywhere", () => {
  const pages = [...STATIC, "rain.html"];
  for (const st of states("rain")) for (const f of readdirSync(ROOT + "rain/" + st)) if (f.endsWith(".html")) pages.push("rain/" + st + "/" + f);
  for (const st of states("farmland-atlas")) for (const f of readdirSync(ROOT + "farmland-atlas/" + st)) if (f.endsWith(".html") && f !== "index.html") pages.push("farmland-atlas/" + st + "/" + f);
  assert.ok(pages.length > 5000, "rain and Atlas county pages found: " + pages.length);
  const vs = new Set();
  for (const p of pages) {
    const s = read(p);
    if (s.includes('name="agsist-pointer"')) continue;   // a moved page: a one-line pointer, no page to put it on
    const m = [...s.matchAll(TAG)];
    assert.equal(m.length, 1, p + ": one plain rp-xmas.js tag");
    vs.add(m[0][1]);
    const at = m[0].index, main = s.search(/<main[\s>]/);
    assert.ok(main >= 0 && main < at && s.indexOf("</main>", main) > at, p + ": the tag sits inside <main>");
  }
  assert.deepEqual([...vs], ["1"], "one version of rp-xmas.js everywhere it loads");
  for (const p of NEVER) assert.ok(!/rp-xmas\.js/.test(read(p)), p + ": not here");
  for (const st of states("rain")) assert.ok(!/rp-xmas\.js/.test(read("rain/" + st + ".html")), "rain/" + st + ".html: state pages are not in Sig's list");
  for (const st of states("farmland-atlas")) if (existsSync(ROOT + "farmland-atlas/" + st + "/index.html")) assert.ok(!/rp-xmas\.js/.test(read("farmland-atlas/" + st + "/index.html")), st + ": Atlas state pages not in the list");
  // the builders write it, so a rebuild keeps it
  assert.match(read("scripts/build_county_rain.py"), /XMAS_JS = '<script src="\/components\/rp-xmas\.js\?v=1"><\/script>'/);
  assert.match(read("scripts/build_atlas_pages.py"), /XMAS_JS = '<script src="\/components\/rp-xmas\.js\?v=1"><\/script>'/);
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".xml": "application/xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

const rainCounty = "/rain/iowa/" + readdirSync(ROOT + "rain/iowa").filter((f) => /-county\.html$/.test(f)).sort()[0].replace(/\.html$/, "");
const atlasCounty = "/farmland-atlas/iowa/" + readdirSync(ROOT + "farmland-atlas/iowa").filter((f) => /-county\.html$/.test(f)).sort()[0].replace(/\.html$/, "");
const BROWSER_PAGES = ["/rain", rainCounty, "/rain-radar", "/hail-map", "/drought-monitor", "/spray", "/gdu-calculator", "/field-scout", atlasCounty];

async function open(browser, port, path, width, time, storage) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: width < 600 ? 844 : 900 },
    isMobile: width < 600, hasTouch: width < 600, timezoneId: "America/Chicago" });
  const pg = await ctx.newPage();
  await pg.clock.install({ time: new Date(time) });
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.addInitScript((st) => {
    try { if (st) localStorage.setItem("agsist-rp-xmas-hide", st); } catch (e) {}
    window.__rpx = { shifts: [], atDcl: null };
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          if (e.hadRecentInput) continue;
          for (const s of e.sources || []) if (s.node && s.node.nodeType === 1 && s.node.closest && s.node.closest(".rpx")) window.__rpx.shifts.push(e.value);
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch (e) {}
    document.addEventListener("DOMContentLoaded", () => {
      const b = document.querySelector(".rpx");
      window.__rpx.atDcl = b ? b.getBoundingClientRect().top - document.documentElement.getBoundingClientRect().top : null;
      window.__rpx.firstInMain = b ? !!b.closest("main") : null;
    });
  }, storage || "");
  await pg.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
  await pg.clock.runFor(2500);
  await pg.waitForTimeout(300);
  return { ctx, pg };
}

test("browser: shown Nov 15 at 390 and 1280, written before paint, never moves, fits, covers nothing, hides on x", { skip, timeout: 600000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  try {
    for (const path of BROWSER_PAGES) {
      for (const width of [390, 1280]) {
        const at = `${path} at ${width}`;
        const { ctx, pg } = await open(browser, port, path, width, "2026-11-15T15:00:00Z");
        if (await pg.locator(".rpx").count()) await pg.locator(".rpx").scrollIntoViewIfNeeded();
        const r = await pg.evaluate(() => {
          const b = document.querySelector(".rpx");
          if (!b) return null;
          const rb = b.getBoundingClientRect(), x = b.querySelector(".rpx-x").getBoundingClientRect();
          const mid = document.elementFromPoint(rb.left + rb.width / 2, rb.top + Math.min(rb.height / 2, 10));
          const others = [...document.querySelectorAll("[data-rain-print-promo]")].filter((e) => e.getAttribute("data-rain-print-promo") !== "gauge" && getComputedStyle(e).display !== "none" && !e.hidden);
          return { n: document.querySelectorAll(".rpx").length, top: rb.top - document.documentElement.getBoundingClientRect().top, left: rb.left, right: rb.right, h: rb.height,
            vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, onTop: !!(mid && mid.closest(".rpx")),
            xw: x.width, xh: x.height, others: others.length, ...window.__rpx };
        });
        assert.ok(r, at + ": the line shows");
        assert.equal(r.n, 1, at + ": once");
        assert.ok(r.firstInMain, at + ": inside <main>");
        assert.ok(r.atDcl !== null, `${at}: it was there when the page was read`);
        // on the first screen it never moves; lower down (/hail-map, under the map) the page's own boxes above it may still fill
        if (r.atDcl < (width < 600 ? 844 : 900)) assert.ok(Math.abs(r.atDcl - r.top) < 1, `${at}: on the first screen at ${r.atDcl} and has not moved since (${r.top})`);
        assert.deepEqual(r.shifts, [], at + ": no layout shift names the line");
        assert.ok(r.sw <= r.vw, `${at}: no sideways scroll (${r.sw} > ${r.vw})`);
        assert.ok(r.left >= 8 && r.right <= r.vw - 8, `${at}: inside the page's margins (${r.left}, ${r.right} of ${r.vw})`);
        assert.ok(r.top > 40, `${at}: below the header (${r.top})`);
        assert.ok(r.onTop, at + ": nothing sits on top of it, and it sits on nothing");
        assert.ok(r.h < (width < 600 ? 110 : 60), `${at}: slim (${r.h}px)`);
        assert.ok(r.xw >= 24 && r.xh >= 24, at + ": the x is a real target");
        assert.equal(r.others, 0, at + ": one Rain Print line a page");
        if (SHOTS) { await pg.evaluate(() => window.scrollTo(0, 0)); await pg.screenshot({ path: join(SHOTS, path.replace(/\W+/g, "_").replace(/^_/, "") + "-" + width + ".png"), clip: { x: 0, y: 0, width, height: Math.max(500, Math.min(1100, r.top + r.h + 260)) } }); }
        // the x hides it, and it stays hidden on the next visit
        await pg.click(".rpx-x");
        assert.equal(await pg.locator(".rpx").count(), 0, at + ": the x hides it");
        const kept = await pg.evaluate(() => localStorage.getItem("agsist-rp-xmas-hide"));
        assert.match(String(kept), /^\d{13}$/, at + ": the time is kept");
        await pg.reload({ waitUntil: "load" });
        assert.equal(await pg.locator(".rpx").count(), 0, at + ": still hidden after a reload");
        await ctx.close();
      }
    }
    // outside the dates, and 31 days after the x: nothing, no space
    for (const [time, st, why] of [["2026-10-31T15:00:00Z", "", "Oct 31"], ["2026-12-11T15:00:00Z", "", "Dec 11"],
      ["2026-12-05T15:00:00Z", String(Date.parse("2026-11-04T15:00:00Z")), "31 days after the x, shows again"]]) {
      const { ctx, pg } = await open(browser, port, rainCounty, 390, time, st);
      const n = await pg.locator(".rpx").count();
      assert.equal(n, why.startsWith("31") ? 1 : 0, rainCounty + " on " + why);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
