/* Baked prices for crawlers (Sig, Oct 19, 2026).
 *
 * "Homepage hero prices and the fertilizer page body are baked with the same
 * dated settle the page already shows, so crawlers see prices; live prices
 * replace them on load."
 *
 *   1. Homepage hero futures tiles (Dec corn, Nov beans) shipped as gray
 *      loading bars. scripts/seed_static.py hero_futures_seeds now bakes the
 *      quote with the card's own formatter (AG.px slash, hb-frac), the same
 *      change markup as index.html paintFut, and quote_when's words ("Settle
 *      Oct 16", "Last trade Oct 19, 9:15 a.m. CT"), the words the corn and
 *      soybean cards lower down are seeded with. Fixtures are the real
 *      Oct 19 price file rows (test/fixtures/locprice/prices-2026-10-19.json)
 *      and the same rows marked as the Oct 16 settle (prices-settled.json).
 *   2. /fertilizer said "Loading co-op prices..." to anything without script.
 *      scripts/bake_seo.py body_fertilizer bakes the description's sentence
 *      (same numbers, same dates, same "$616/ton" writing). Fixture: the real
 *      data/fertilizer-prices.json rows of Oct 19.
 *
 *   node --test test/locprice-seeds.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FX = join(ROOT, "test/fixtures/locprice");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const py = (code) => JSON.parse(execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'scripts')\n" + code], { cwd: ROOT, encoding: "utf8" }));
const heroSeeds = (file) => py(`import seed_static as S\nd = json.load(open(${JSON.stringify(join(FX, file))}))\nprint(json.dumps(S.hero_futures_seeds(d["quotes"], d["fetched"])))`);

/* components/util.js AG.px, the formatter paintFut uses */
function agpx() {
  const ctx = { window: {}, document: { addEventListener() {}, querySelectorAll: () => [], documentElement: {} } };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext("var window=this.window;" + readFileSync(join(ROOT, "components/util.js"), "utf8"), ctx);
  return ctx.window.AG.px;
}

test("hero seeds: same price and change markup paintFut writes, real Oct 19 rows", () => {
  const s = heroSeeds("prices-2026-10-19.json"), px = agpx();
  const q = JSON.parse(readFileSync(join(FX, "prices-2026-10-19.json"), "utf8")).quotes;
  assert.equal(s["hp:fc-k"], "Dec ’26 corn futures");
  assert.equal(s["hp:fs-k"], "Nov ’26 bean futures");
  assert.equal(s["hp:fc"], '<span class="hb-n">' + px.priceDollars(q["corn-dec"].close / 100, { style: "slash", fracClass: "hb-frac" }) + "</span>");
  assert.equal(s["hp:fc"], '<span class="hb-n">$4.68<span class="hb-frac"> 1/4</span></span>');
  assert.equal(s["hp:fs"], '<span class="hb-n">$12.53<span class="hb-frac"> 3/4</span></span>');
  assert.ok(s["hp:fs-s"].includes(">" + px.move(-7.5, { style: "slash", sign: true }) + "</span>"), s["hp:fs-s"]);
  assert.match(s["hp:fc-s"], /hb-chg dn"><span aria-hidden="true">▼ <\/span><span class="visually-hidden">down <\/span>−6¢/);
  assert.match(s["hp:fc-s"], /<span class="hb-l hb-age">Last trade Oct 19, 9:15 a\.m\. CT<\/span>$/);
});

test("hero seeds: a settle reads 'Settle Oct 16', the lower cards' words", () => {
  const s = heroSeeds("prices-settled.json");
  assert.match(s["hp:fc-s"], /<span class="hb-l hb-age">Settle Oct 16<\/span>$/);
  assert.match(s["hp:fs-s"], /<span class="hb-l hb-age">Settle Oct 16<\/span>$/);
});

test("hero seeds: no quote leaves the loading bar, never a number", () => {
  const s = py(`import seed_static as S\nprint(json.dumps(S.hero_futures_seeds({}, "")))`);
  assert.equal(s["hp:fc"], '<span class="hb-skel" aria-hidden="true"></span>');
  assert.equal(s["hp:fc-s"], "");
  assert.equal(s["hp:fc-k"], "Dec corn futures");
});

test("index.html: hero tiles carry their seed markers, and the 15-row ticker is not seeded", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  for (const t of ["fc", "fs"]) {
    assert.match(html, new RegExp(`id="hb-${t}-k"><!--SEED:hp:${t}-k-->`));
    assert.match(html, new RegExp(`id="hb-${t}-v"><!--SEED:hp:${t}-->`));
    assert.match(html, new RegExp(`id="hb-${t}-s"><!--SEED:hp:${t}-s-->`));
  }
  assert.ok(!/ticker[^>]*><!--SEED:/.test(html), "ticker rows stay JS-only (per-row dates)");
});

test("fertilizer body line: the description's numbers and dates, real Oct 19 rows", () => {
  const code = (fert) => `import bake_seo as B\nfrom datetime import date\nc = {"today": date(2026, 10, 19), "fertilizer": ${fert}}\nprint(json.dumps([B.body_fertilizer(c), B.seo_fertilizer(c)[1]]))`;
  const [body, desc] = py(code(`json.load(open(${JSON.stringify(join(FX, "fertilizer-prices.json"))}))`));
  assert.equal(body, "Kansas co-op cash prices posted Sep 24 to Oct 6, 2026: urea $616/ton (Kansas and Wisconsin), anhydrous $832, DAP $936, potash $470.");
  assert.equal(desc, body + " Cost per lb of N, P and K.", "one price shown one way: the body is the description's sentence");
  const [none] = py(code("None"));
  assert.equal(none, "Loading co-op prices&hellip;", "no file: no number");
  const html = readFileSync(join(ROOT, "fertilizer.html"), "utf8");
  // the marker is checked, not today's number: a stale file (over 30 days) bakes the loading words by design
  assert.match(html, /<div id="fert-coop-bar"><!--BAKE:fert-bar-->[^<]*<!--\/BAKE--><\/div>/, "the page carries the baked line");
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    else if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("homepage: live prices draw the same price markup over the seed; a failed price file keeps the baked quote", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const seeds = heroSeeds("prices-2026-10-19.json");
  const fx = readFileSync(join(FX, "prices-2026-10-19.json"), "utf8");
  try {
    for (const mode of ["live", "dead"]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
      const pg = await ctx.newPage();
      // The page's clock is the fixture's: the page greys a close older than the
      // last weekday ("Last close · Oct 19", no stamp), so on Oct 20 the real
      // clock turned this fixture old and the live wait below never matched.
      await pg.clock.install({ time: new Date(Date.parse(JSON.parse(fx).fetched) + 5 * 60e3) });
      await pg.route("**/*", (r) => {
        const u = r.request().url();
        if (u.includes("/data/prices.json")) return mode === "dead" ? r.abort() : r.fulfill({ contentType: "application/json", body: fx });
        return u.startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort();
      });
      await pg.goto(`http://127.0.0.1:${port}/`);
      if (mode === "live") {
        await pg.waitForFunction(() => /hb-n/.test(document.getElementById("hb-fs-v").innerHTML) && /hb-age|px-stamp/.test(document.getElementById("hb-fs-s").innerHTML), null, { timeout: 8000 });
        assert.equal(await pg.$eval("#hb-fc-v", (e) => e.innerHTML), seeds["hp:fc"], "one price, one way");
        assert.equal(await pg.$eval("#hb-fs-v", (e) => e.innerHTML), seeds["hp:fs"]);
        assert.equal(await pg.$eval("#hb-fc-k", (e) => e.textContent), seeds["hp:fc-k"]);
      } else {
        await pg.waitForTimeout(10800); // past the 10 s "Prices didn't load" timer
        assert.match(await pg.$eval("#hb-fc-v", (e) => e.textContent), /^\$\d+\.\d\d/, "baked quote stays");
        assert.ok(!/didn.t load/.test(await pg.$eval("#hb-fc-s", (e) => e.textContent)));
      }
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
