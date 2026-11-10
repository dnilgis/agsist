/* CLS sweep, Nov 10 2026 (notes/audits/cls-sweep-2026-11-10.md, rows 8 and 15-17): with a saved ZIP
 * (Chetek WI 54728) /markets shifted 0.122 at 390 and the corn, soybean and wheat futures pages about
 * 0.07, because the state bid line (p.pl-line[data-state-bid]) was written hidden and shown 3 to 5 s
 * later with no space held. The homepage holds it with AgPxStamp.reserve (price-local.js placeholder,
 * class pl-wait); these four pages now do the same, right after the line, with price-local.js in the head.
 *
 * Method as the sweep: JS and CSS held 800 ms, /data/ held 1500 ms, outside hosts aborted, service
 * workers blocked, 390x844 (touch) and 1280x900, load, network idle, then 2.5 s.
 *
 *   node --test test/state-line-cls.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const PAGES = { "markets.html": "corn soybeans", "corn-futures-prices.html": "corn", "soybean-futures-prices.html": "soybeans", "wheat-futures-prices.html": "wheat" };

test("each page reserves the state line the homepage way, with price-local.js loaded before it", () => {
  for (const [p, crops] of Object.entries(PAGES)) {
    const h = read(p);
    const line = `<p class="pl-line" data-state-bid="${crops}" hidden></p>`;
    const i = h.indexOf(line);
    assert.ok(i > 0, p + " has the line");
    assert.match(h.slice(i + line.length, i + line.length + 400), /^<script>[^<]*AgPxStamp\.reserve\(document\.currentScript\.previousElementSibling\)/, p + " reserves it right after");
    const pl = h.search(/<script src="\/components\/price-local\.js\?v=\d+"><\/script>/);
    assert.ok(pl > 0 && pl < h.indexOf("</head>"), p + ": price-local.js is in the head, not deferred");
  }
  assert.match(read("components/price-local.js"), /\.pl-line\.pl-wait\{visibility:hidden\}/, "the held box is invisible until it fills");
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".ics": "text/calendar" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    const ext = extname(f), wait = p.startsWith("/data/") ? 1500 : ext === ".js" || ext === ".css" ? 800 : 0;
    setTimeout(() => { res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" }); res.end(readFileSync(f)); }, wait);
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function measure(browser, port, path, w, h) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, timezoneId: "America/Chicago" });
  const pg = await ctx.newPage();
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.addInitScript(() => {
    try {
      const loc = { lat: 45.3125, lon: -91.6513, name: "Chetek", state: "WI", county: "Barron", zip: "54728", zipTyped: true };
      localStorage.setItem("agsist-wx-loc", JSON.stringify(loc));
      localStorage.setItem("agsist_zip", "54728");
      localStorage.setItem("agsist_user_zip", "54728");
    } catch (e) { }
    window.__cls = 0; window.__src = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__src.push(e.value.toFixed(3) + " " + (e.sources || []).map((s) => (s.node ? (s.node.id || s.node.className || s.node.nodeName) : "?") + " y" + Math.round(s.previousRect.y) + ">" + Math.round(s.currentRect.y)).join(", ")); } }).observe({ type: "layout-shift", buffered: true });
  });
  await pg.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
  await pg.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  await pg.waitForTimeout(2500);
  const r = await pg.evaluate(() => {
    const l = document.querySelector("p.pl-line[data-state-bid]");
    return { cls: window.__cls, src: window.__src, shown: !!l && !l.hidden, waiting: !!l && l.classList.contains("pl-wait"), text: l ? l.textContent.trim().slice(0, 80) : "" };
  });
  await ctx.close();
  return r;
}

test("browser: with a saved ZIP the state line lands with no layout shift, 390 and 1280", { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    let shown = 0;
    for (const p of Object.keys(PAGES)) for (const [w, h] of [[390, 844], [1280, 900]]) {
      const r = await measure(browser, port, "/" + p.replace(/\.html$/, ""), w, h);
      assert.ok(r.cls < 0.01, `${p} at ${w}: CLS ${r.cls.toFixed(3)} ${JSON.stringify(r.src)}`);
      assert.equal(r.waiting, false, `${p} at ${w}: the placeholder settled (${r.text})`);
      if (r.shown) shown++;
    }
    assert.ok(shown >= 4, `the state line showed on only ${shown} of 8 loads, so the test measured nothing`);
  } finally {
    await browser.close();
    srv.close();
  }
});
