/* The home page without the seasonal reads, Nov 5, 2026.
 *
 *   - no soil temperature anywhere on home: no card cell, no This month cell, no soil reader loaded
 *   - no spray read in the hero band and no spray rule in home-season.js; no fall nitrogen cell in any month's strip
 *   - the pages that keep them still carry them: /spray, Field Scout, /fall-nitrogen, /planting-date
 *   - the COT How to read tip names one verdict; the hidden second badge is gone
 *   - on the page (a November clock and an April one, the spray and soil months): none of the three shows, the hero
 *     weather cell has only weather, and the card holds its height at 390 and 1280 (November)
 *
 *   node --test test/homeseasonal.test.mjs
 * Fixtures: test/fixtures/wxcard (frozen). Browser runs block every outside host and service workers (build rule 58). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { nwsAnswer } from "./fixtures/nws-mock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const HTML = read("index.html");
const HS = strip(read("components/home-season.js"));
const HP = strip(read("components/home-planting.js"));

test("home loads no soil reader and paints no soil temperature", () => {
  assert.ok(!/soil-near\.js/.test(HTML), "index.html loads no soil-near.js");
  assert.ok(!/s7-wx-soil|Soil, 2\.4 in|modeled/.test(HTML), "no soil cell (or its old label) in the card");
  assert.ok(!/soilPlant|Planting soil temperature|_soil|s7-wx-soil/.test(HS), "home-season.js paints no soil");
  assert.ok(!/AgSoilNear|_soil/.test(HP), "home-planting.js reads no soil");
  const feeds = JSON.parse(read("data/feeds.json"));
  const fn = (feeds.feeds || feeds).find ? (feeds.feeds || feeds).find((f) => f.path === "data/fall-nitrogen.json") : null;
  if (fn) assert.ok(!fn.pages.includes("index.html"), "the feed manifest no longer lists home as a soil reader");
});

test("no spray read in the hero band and no fall N cell in the strip", () => {
  assert.ok(!/hb-spray|agsist:spray|__agsistSprayToday/.test(strip(HTML)), "the hero band paints no spray read");
  assert.ok(!/function sprayRule|agsist:spray|S7\.spray|spray:function/.test(HS), "home-season.js has no spray rule");
  assert.ok(!/S7\.spray/.test(HP), "home-planting.js hands no forecast to a spray rule");
  assert.ok(!/'spray'|'fallN'|fallN:/.test(HS), "no spray or fall N cell in any month");
  assert.ok(!/\.hb-spray/.test(read("css/home.css")), "home.css has no spray badge rule");
});

test("the pages that keep them still carry them", () => {
  assert.match(read("spray.html"), /components\/spray-windows\.js|spray-wind\.js/);
  assert.match(read("field-scout-read.js"), /Too windy to spray right now/);
  assert.match(read("components/fold/fall-nitrogen.js"), /\/\*falln:start\*\/[\s\S]*\/\*falln:end\*\//);   // the fall anhydrous tab of /spray since Nov 11, 2026
  assert.match(read("spray.html"), /data-js="\/components\/fold\/fall-nitrogen\.js\?v=\d+"/);
  const pd = read("planting-date.html");
  assert.match(pd, /components\/soil-near\.js\?v=\d+/);
  assert.ok(existsSync(ROOT + "components/soil-near.js"));
});

test("the COT tip names one verdict and the second badge is gone", () => {
  assert.ok(!/id="cot-verdict-lv"/.test(HTML), "no hidden second badge");
  assert.ok(!/grains and live cattle separately|The badges name/.test(HTML), "no talk of two badges");
  // Nov 10: the crowding verdict was dropped Nov 6; the home COT card names no crowded tenth and the method
  // text sits in the closed Sources and terms fold at the bottom
  const cot = HTML.slice(HTML.indexOf('id="cot-widget"'), HTML.indexOf('id="nowcast-widget"'));
  assert.ok(cot.length > 500, "COT card found");
  assert.doesNotMatch(cot, /crowded|tenth/i);
  const fold = (HTML.match(/<details class="hp-terms"[\s\S]*?<\/details>/) || [""])[0];
  assert.ok(fold.length > 500, "Sources and terms fold found");
  // the moved method sentences, word for word, inside the fold
  assert.ok(fold.includes("Funds: the CFTC Commitments of Traders report, managed money (hedge funds and commodity trading advisers), net futures positions as of Tuesday, in contracts; not a headcount of who is long or short, and not a trading signal."), "COT method sentence");
  assert.ok(fold.includes("The &ldquo;Since&rdquo; price line compares the front-month price now with its close on the report&rsquo;s Tuesday, so a contract roll in between is inside the number."), "the Since price line explained");
  assert.ok(fold.includes("the 80% band means that in 8 of every 10 of <span id=\"nc-years\">12</span> past years, each estimated from earlier years only, the estimate at the same week missed USDA&rsquo;s final yield by no more than this. The band gets narrower as the season goes on."), "nowcast band facts");
  assert.ok(fold.includes("It is withheld once the ratings are two weeks old."), "nowcast withholding");
});

/* ---------- in the browser ---------- */
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
// Measured Nov 5, 2026 with these fixtures, a November clock and a ZIP in Ames: 737 px at 390 and 1280 with the soil
// cell, 700 px at both without it. Allow 8 px for font metrics.
const HEIGHT = { 390: 700, 1280: 700 };
const CLOCKS = ["2026-11-05T15:00:00", "2027-04-20T15:00:00"];
const SHOTS = process.env.HOMESEASONAL_SHOTS || "";

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const fix = { "/data/rain/ia.json": "test/fixtures/wxcard/rain-ia.json", "/data/rain/wx/ia.json": "test/fixtures/wxcard/wx-ia.json" };
  const hits = new Set();
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    hits.add(p);
    if (p === "/") p = "/index.html"; else if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, fix[p] || p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  srv.hits = hits;
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
// build rule 58: our own copy only; the forecast from the stand-in; every other outside host aborted
const guard = (port, now) => (r) => {
  const u = r.request().url();
  if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
  if (/^https:\/\/api\.weather\.gov\//.test(u)) { const a = nwsAnswer(u, { now }); return r.fulfill({ status: a.status, contentType: "application/geo+json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(a.body) }); }
  if (u.includes("/bids/data/zips/")) return r.fulfill({ headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: JSON.stringify({ 50010: [42.03, -93.62] }) });
  return r.abort();
};

test("on the page in November and April: no soil, spray or fall N read; the card holds its height", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const clock of CLOCKS) for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
      await ctx.addInitScript(() => {
        try { localStorage.setItem("agsist-wx-loc", JSON.stringify({ zip: "50010", lat: 42.03, lon: -93.62, label: "Ames, IA", city: "Ames, IA", state: "IA" })); } catch (e) {}
      });
      const pg = await ctx.newPage(), errors = [];
      pg.on("pageerror", (e) => errors.push(String(e)));
      await pg.clock.setFixedTime(new Date(clock));
      await pg.route("**/*", guard(port, Date.parse(clock)));
      await pg.goto(`http://127.0.0.1:${port}/`);
      const nov = clock === CLOCKS[0];
      // Season so far reads the frozen November rain files, so only the November run waits for it
      if (nov) await pg.waitForFunction(() => document.querySelector('#wx-season .wxs-t[data-k="gdd30"] .wxs-v'), null, { timeout: 20000 });
      await pg.waitForFunction(() => /\d/.test((document.getElementById("s7-wx-low") || {}).textContent || ""), null, { timeout: 20000 });
      await pg.waitForFunction(() => (document.getElementById("hb-wx") || {}).dataset && document.getElementById("hb-wx").dataset.state === "ok", null, { timeout: 20000 });
      await pg.waitForTimeout(1000);
      const got = await pg.evaluate(() => ({
        h: Math.round(document.querySelector(".wx-card").getBoundingClientRect().height),
        card: document.querySelector(".wx-card").innerText,
        hero: document.getElementById("hb-wx").innerText,
        strip: (document.getElementById("s7-grid") || {}).innerText || "",
        body: document.body.innerText,
        grid: [...document.querySelectorAll(".wx-card .wx-grid > .wstat")].map((e) => Math.round(e.getBoundingClientRect().width)),
      }));
      const tag = `${clock.slice(0, 7)} at ${width}`;
      assert.match(got.hero, /\d+°/, `the hero weather cell has the forecast (${tag})`);
      assert.ok(!/spray|hold off|use caution/i.test(got.hero), `no spray read in the hero band (${tag}):\n${got.hero}`);
      assert.ok(!/soil|fall nitrogen|spray/i.test(got.card), `no soil, fall N or spray in the card (${tag}):\n${got.card}`);
      assert.ok(!/soil|nitrogen|spray/i.test(got.strip), `no soil, fall N or spray cell in the strip (${tag}):\n${got.strip}`);
      assert.ok(!/OK to spray|Hold off spraying|Planting soil temperature|Fall nitrogen window|°F at 4 in/.test(got.body), `none of the three anywhere on home (${tag})`);
      assert.equal(got.grid.length, 5, "five weather cells");
      if (process.env.HOMESEASONAL_SHOTS) console.log(`card ${got.h}px (${tag})`);
      if (nov) assert.ok(got.h <= HEIGHT[width] + 8, `card ${got.h}px (${tag}), was ${HEIGHT[width]}px`);
      assert.deepEqual(errors, [], tag);
      if (SHOTS && nov) await pg.locator(".wx-card").screenshot({ path: `${SHOTS}/wx-card-${width}.png` });
      if (SHOTS && nov) { await pg.evaluate(() => window.scrollTo(0, 0)); await pg.waitForTimeout(300); }
      if (SHOTS && nov) await pg.screenshot({ path: `${SHOTS}/home-top-${width}.png` });
      await ctx.close();
    }
    assert.ok(![...srv.hits].some((p) => /soil-near|fall-nitrogen\.json/.test(p)), "home asks for no soil file");
  } finally { await browser.close(); srv.close(); }
});
