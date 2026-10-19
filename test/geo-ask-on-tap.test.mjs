/* Location is asked only on a tap (Sig, Oct 19, 2026).
 *
 * "Never ask for the reader's location on page load; only when they tap
 * 'Use my location'. A saved ZIP still works at once."
 *
 * Before this, a fresh visit to the homepage asked three ways: geo.js boot
 * (requestGeo, on every page that loads geo.js: /, /cash-bids, the corn,
 * soybean, wheat and cattle futures pages, /fertilizer, /spray), geo.js's
 * background "did you move?" fix on every visit with a saved place, and
 * home-planting.js's own fallback 3.5 s in. /spray and /urea asked from their
 * own inline scripts too. A ZIP saved more than 30 minutes ago counted as
 * stale and asked again.
 *
 * Each page here opens on a fresh profile with navigator.geolocation counted,
 * waits past every old timer, and must not have called it. Where the page has
 * a "Use my location" button, one tap must call it once. The homepage also
 * checks the cash bid card offers the button at once, worded as an offer, and
 * that "Your location did not come through." follows only a failed tap.
 *
 * Browser parts need Playwright and Chromium; they skip where missing.
 *   node --test test/geo-ask-on-tap.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const read = (p) => readFileSync(join(ROOT, p), "utf8");

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    else if (p.endsWith("/")) p += "index.html";
    else if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

/* Counts every geolocation call; answers each one "denied", as a reader who
   says no would. */
const COUNT = () => {
  window.__geo = 0;
  const deny = (ok, err) => { window.__geo++; setTimeout(() => err && err({ code: 1, message: "denied" }), 20); };
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: deny, watchPosition: (a, b) => { deny(a, b); return 1; }, clearWatch() {} },
  });
};

async function open(browser, port, path, { saved = null } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(COUNT);
  if (saved) await ctx.addInitScript((s) => { try { localStorage.setItem("agsist-wx-loc", s); } catch (e) {} }, JSON.stringify(saved));
  const pg = await ctx.newPage();
  const errors = [], seen = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    seen.push(u);
    return u.startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}${path}`);
  return { pg, ctx, errors, seen };
}

/* Every page that asked on load before Oct 19, and its button (null: none). */
const PAGES = [
  ["/", "#btn-allow-loc"],
  ["/cash-bids", "#cb-use-location-btn"],
  ["/corn-futures-prices", null],
  ["/soybean-futures-prices", null],
  ["/wheat-futures-prices", null],
  ["/cattle-futures-prices", null],
  ["/fertilizer", null],
  ["/spray", "#btn-geo"],
  ["/urea", "#btn-geo"],
];

test("no geolocation call in any load path the pages ship", () => {
  const geo = read("components/geo.js");
  const boot = geo.slice(geo.indexOf("(function boot()"));
  assert.ok(!/requestGeo\(|getCurrentPosition|_wxRefreshIfMoved/.test(boot), "geo.js boot asks nothing");
  assert.ok(!/_wxRefreshIfMoved|WX_CACHE_TTL_MS\s*=/.test(geo.replace(/\/\*[\s\S]*?\*\//g, "")), "the on-load 'did you move?' fix and the 30-minute expiry are gone");
  assert.ok(!/geolocation/.test(read("components/home-planting.js").replace(/\/\/.*$/gm, "")), "home-planting.js has no fallback ask");
  assert.ok(!/\}requestGeo\(\);\}/.test(read("spray.html")), "spray autoLoad does not ask");
  assert.ok(!/\n\s*requestGeo\(\);\n\},600\)/.test(read("urea.html")), "urea load does not ask");
});

for (const [path, btn] of PAGES) {
  test(`${path}: fresh visit asks nothing on load${btn ? "; a tap on Use my location asks" : ""}`, { skip }, async () => {
    const srv = await serve(), port = srv.address().port;
    const browser = await chromium.launch({ executablePath: CHROME });
    try {
      const { pg } = await open(browser, port, path);
      await pg.waitForTimeout(4500); // past geo.js boot (400 ms) and the old home-planting fallback (3.5 s)
      assert.equal(await pg.evaluate(() => window.__geo), 0, "no geolocation call before a tap");
      if (btn) {
        await pg.click(btn);
        await pg.waitForTimeout(300);
        assert.equal(await pg.evaluate(() => window.__geo), 1, "one tap, one question");
      }
    } finally { await browser.close(); srv.close(); }
  });
}

test("/: the bid card offers Use my location at once; 'did not come through' only after a failed tap", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, "/");
    await pg.waitForSelector("#bids-noloc", { timeout: 2000 });
    assert.equal(await pg.textContent("#bids-noloc .hn-h"), "See the bids near you.");
    assert.ok(!/did not come through/.test(await pg.textContent("#bids-list-area")), "not on a fresh visit");
    assert.equal(await pg.textContent("#bids-noloc .hn-loc"), "Use my location");
    assert.equal(await pg.$eval("#bids-geo-bar", (e) => getComputedStyle(e).display), "none", "no 'Detecting your location' line");
    await pg.waitForTimeout(1000);
    assert.equal(await pg.evaluate(() => window.__geo), 0);
    await pg.click("#bids-noloc .hn-loc");
    await pg.waitForFunction(() => /did not come through/.test(document.querySelector("#bids-noloc .hn-h").textContent), null, { timeout: 3000 });
    assert.equal(await pg.evaluate(() => window.__geo), 1);
    assert.equal(await pg.$eval("#bids-zip-row", (e) => e.style.display), "none", "one ZIP box: the hero band's");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("a ZIP saved hours ago works at once and asks nothing", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const saved = { lat: 41.59, lon: -93.62, label: "Des Moines, IA", zip: "50309", state: "IA", ts: Date.now() - 6 * 3600e3 };
  try {
    for (const path of ["/", "/spray", "/urea"]) {
      const { pg, seen, ctx } = await open(browser, port, path, { saved });
      await pg.waitForTimeout(4500);
      assert.equal(await pg.evaluate(() => window.__geo), 0, `${path}: no geolocation call with a saved ZIP`);
      assert.ok(seen.some((u) => /open-meteo\.com/.test(u) && /latitude=41\.59/.test(u)), `${path}: weather asked for the saved place`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
