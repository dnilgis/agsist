/* Search Console fixes, Oct 17, 2026 (export: Jul 15 to Oct 14, 2026).
 *
 *   "soybean yield calculator"                 3,181 impressions, position 6.1, 190 clicks -> /yield-estimator
 *   "average soybean yield per acre by state"    406 impressions, position 8.7,   0 clicks -> /usda-quick-stats
 *
 * /yield-estimator opens on the Soybeans tab (pod count method); #corn opens corn.
 * /pod-counts (the research page) links the calculator near the top.
 * /usda-quick-stats: the description names the three largest soybean states from
 * data/state-stats.json, same vintage as Iowa's figure (scripts/bake_seo.py).
 *
 *   node --test test/seo10-snippets.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const meta = (h, n) => (h.match(new RegExp(`<meta (?:name|property)="${n}"\\s+content="([^"]*)"`)) || [])[1] || "";

test("yield estimator: title, H1 and the open tab all say soybean", () => {
  const h = read("yield-estimator.html");
  assert.match(h, /<title>Soybean Yield Calculator: Pod Count to Bu\/Acre, Free \| AGSIST<\/title>/);
  assert.match(h, /<h1>Soybean and corn<br>yield calculator<\/h1>/);
  assert.match(meta(h, "description"), /^Free soybean yield calculator:/);
  // the worked example in the snippet is the page's own formula: plants x pods x seeds / (seeds/lb x 60)
  assert.equal(132000 * 30 * 2.5 / (3000 * 60), 55);
  for (const n of ["description", "og:description", "twitter:description"]) assert.match(meta(h, n), /132,000 plants, 30 pods, 2\.5 seeds per pod and 3,000 seeds\/lb is 55 bu\/acre/, n);
  for (const n of ["og:description", "twitter:description"]) assert.match(meta(h, n), /^Soybean yield from pod counts/, n);
  // Soybeans is the first tab and the open one; corn waits behind it
  const tabs = h.slice(h.indexOf('class="ye-tabs"'), h.indexOf("</nav>", h.indexOf('class="ye-tabs"')));
  assert.ok(tabs.indexOf('id="ye-tab-bean"') < tabs.indexOf('id="ye-tab-corn"'), "Soybeans tab first");
  assert.match(tabs, /class="ye-tab active" id="ye-tab-bean"[^>]*aria-selected="true"/);
  assert.match(tabs, /class="ye-tab"\s+id="ye-tab-corn"[^>]*aria-selected="false"/);
  assert.match(h, /<div class="ye-panel active" id="ye-bean" role="tabpanel" aria-labelledby="ye-tab-bean" tabindex="0">/);
  assert.match(h, /<div class="ye-panel" id="ye-corn" role="tabpanel" aria-labelledby="ye-tab-corn" tabindex="0" aria-hidden="true">/);
  assert.match(h, /var activeCrop='bean';/);
  assert.match(h, /<p class="page-lede">Free soybean yield calculator: type plants per acre, pods per plant and seeds per pod for bushels per acre before harvest\. Corn works from ear counts\.<\/p>/);
  assert.ok(!h.slice(h.indexOf("2026-10-17: Soybeans opens first"), h.indexOf("2026-10-17: Soybeans opens first") + 400).includes("—"));
});

test("pod counts research (crop tour #pod-counts since Oct 22, 2026) links the soybean calculator at its top", () => {
  const h = read("crop-tour.html");
  const top = h.slice(h.indexOf('<section class="pc-wrap" id="pod-counts"'), h.indexOf('<h3 class="pc-h2"'));
  assert.match(top, /The <a href="\/yield-estimator">soybean yield calculator<\/a> works it from plants, pods per plant, seeds per pod and seed size\./);
  // and the calculator's soybean tab links back
  const bean = h && read("yield-estimator.html");
  assert.ok(bean.slice(bean.indexOf('id="ye-bean"')).includes('href="/crop-tour#pod-counts"'));
});

test("quick stats: the description names the three largest soybean states, from the data", () => {
  const h = read("usda-quick-stats.html");
  const d = meta(h, "description");
  const ss = JSON.parse(read("data/state-stats.json")).stateStats;
  const ia = ss.IA;
  const same = (v) => v.year === ia.year && !!v.forecast === !!ia.forecast && v.forecast_month === ia.forecast_month;
  const top = Object.values(ss).filter((v) => v && same(v) && v.bean_yield != null)
    .sort((a, b) => (b.bean_prod || 0) - (a.bean_prod || 0)).slice(0, 3);
  assert.equal(top.length, 3);
  const want = `; ${top[0].name} soybeans ${top[0].bean_yield}, ${top[1].name} ${top[1].bean_yield}, ${top[2].name} ${top[2].bean_yield}.`;
  assert.ok(d.includes(want), `${d} lacks ${want}`);
  assert.ok(d.length <= 160, `${d.length} chars`);
  // and the first screen has the soybean line too
  const yl = h.slice(h.indexOf("<!--BAKE:state-yields-->"), h.indexOf("<!--/BAKE-->", h.indexOf("<!--BAKE:state-yields-->")));
  assert.ok(yl.includes(`soybeans ${top[0].name} ${top[0].bean_yield}`), yl);
  assert.ok(h.indexOf("<!--BAKE:state-yields-->") < h.indexOf('<main id="main"'), "soybean line sits in the hero");
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("yield estimator in a browser: soybeans open with a yield, #corn opens corn", { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [hash, want] of [["", "bean"], ["#corn", "corn"]]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
      const pg = await ctx.newPage();
      const errs = [];
      pg.on("pageerror", (e) => errs.push(e.message));
      await pg.route("**/*", (r) => r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort());
      await pg.goto(`http://127.0.0.1:${port}/yield-estimator${hash}`, { waitUntil: "load" });
      const o = await pg.evaluate(() => ({
        open: [...document.querySelectorAll(".ye-panel.active")].map((p) => p.id),
        sel: document.querySelector(".ye-tab.active").dataset.tab,
        beanVis: getComputedStyle(document.getElementById("ye-bean")).display !== "none",
        cornVis: getComputedStyle(document.getElementById("ye-corn")).display !== "none",
        bean: document.getElementById("b-yield-val").textContent.trim(),
        sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      await ctx.close();
      assert.deepEqual(o.open, ["ye-" + want], hash);
      assert.equal(o.sel, want, hash);
      assert.equal(o.beanVis, want === "bean", hash);
      assert.equal(o.cornVis, want === "corn", hash);
      if (want === "bean") assert.match(o.bean, /^\d+$/, "the soybean example shows a yield on load");
      assert.ok(o.sw <= o.iw, `horizontal scroll ${o.sw} > ${o.iw}`);
      assert.deepEqual(errs, [], hash);
    }
  } finally { await browser.close(); srv.close(); }
});
