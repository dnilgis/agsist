/* Home page, answers first (Nov 11, 2026): the first screen answers in this order, one column: the sitewide sponsor
 * line, one ZIP box with "Use my location", futures (corn and soybeans, with a 20-week chart), Today and this week,
 * the Daily headline with no price, weather once a ZIP is set, the farmland sale (county median, below the weather),
 * then the links. One corn price per screen. No sentence before the first answer, no "I" on the page.
 * The browser cases need Playwright and Chromium (skipped without).
 *   node --test test/home-answers-first.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const HTML = read("index.html");
const band = HTML.slice(HTML.indexOf('id="hero-band"'), HTML.indexOf("</section>", HTML.indexOf('id="hero-band"')));
const require = createRequire(import.meta.url);

test("the hero lists its answers in order: sponsor line, ZIP box, futures, today, the Daily, weather, land, links", () => {
  const at = (s) => { const i = band.indexOf(s); assert.ok(i > 0, `${s} is in the hero`); return i; };
  const order = [at('id="sw-home"'), at('id="hb-zip-form"'), at('id="hb-fc"'), at('id="hap"'), at('id="job-daily-t"'), at('id="hb-wx"'), at('id="job-land"'), at('id="job-sell-h"'), at('id="job-field-h"')];
  assert.deepEqual([...order].sort((a, b) => a - b), order, "sponsor line, ZIP, futures, Today and this week, Daily, weather, land sale, links");
  assert.ok(at('id="hb-fs"') > at('id="hb-fc"') && at('id="hb-fs"') < at('id="hap"'), "soybeans follow corn, before Today and this week");
});

test("one ZIP box, with Use my location, and none of the other asks", () => {
  assert.equal((band.match(/<input[^>]*id="hb-zip"/g) || []).length, 1, "one ZIP input in the hero");
  assert.match(band, /id="btn-allow-loc"[^>]*>Use my location</, "the hero box carries Use my location");
  const rest = HTML.replace(band, "");
  assert.ok(!/id="btn-allow-loc"|id="btn-zip-instead"/.test(rest), "the weather card has no second Use my location or Enter ZIP");
  assert.ok(!/class="hn-zip"|class="hn-loc"/.test(read("components/home.js")), "the no-place bids box has no Enter ZIP or Use my location");
  assert.ok(!/wx-zip-ask-b/.test(HTML), "the weather card's Set ZIP button is gone");
  assert.ok(!/<div class="hb-grid hb-grid--wx af-wx">[\s\S]{0,400}Set ZIP/.test(HTML), "the weather cell does not ask");
});

test("nothing stands before the first answer; no I on the page; median, not middle; bushel spelled out", () => {
  assert.match(band, /<h1 class="hb-h1 visually-hidden">/, "the page title is for screen readers and search, not an intro line");
  const first = band.indexOf('id="sw-home"');
  assert.ok(!/<p\b/.test(band.slice(0, first)), "no paragraph before the sponsor line");
  const main = HTML.slice(HTML.indexOf('<main id="main"'), HTML.indexOf("<!-- Static footer"));
  assert.ok(!/\bI['’]m\b|\bI['’]ll\b|\bI['’]ve\b/.test(main.replace(/<script[\s\S]*?<\/script>/g, "")), "no I'm, I'll or I've in the page copy");
  assert.ok(!/county[’']s middle/i.test(HTML + read("components/home-land.js")), "the sale line says median");
  assert.ok(!/<span class="t-unit">per bu<\/span>/.test(HTML), "the ticker spells out bushel");
  assert.ok(/<span class="t-unit">per bushel<\/span>/.test(HTML), "the ticker says per bushel");
});

test("the Daily line on the first screen carries no price, baked and on the next bake", () => {
  const t = /id="job-daily-t">([^<]*)</.exec(band)[1];
  assert.ok(!/\$\d/.test(t), `no price in "${t}"`);
  const out = execFileSync("python3", ["-c", `
import sys,json;sys.path.insert(0,'scripts')
import bake_homepage as b
print(json.dumps([b.no_price(h) for h in json.loads(sys.argv[1])]))`, JSON.stringify([
    "Corn slips 2½ cents to $4.46½ after Tuesday's yield cut",
    "WASDE prints at 11 CT; Dec corn is at $4.41½ overnight",
    "Grains wait on USDA; hogs bounce, cattle gain",
    "Soybeans hold $12.26 3/4 as exports lag"])], { cwd: ROOT, encoding: "utf8" });
  assert.deepEqual(JSON.parse(out), ["Corn slips 2½ cents after Tuesday's yield cut", "WASDE prints at 11 CT", "Grains wait on USDA; hogs bounce, cattle gain", "Soybeans hold as exports lag"]);
});

test("the charts draw the last 20 weekly closes and withhold on a short, old or bad file", () => {
  const P = require("../components/home-pics.js");
  const hist = Array.from({ length: 30 }, (_, i) => 4 + i / 100);
  const stats = { corn: { hist, hist_to: "2026-11-09" }, soybean: { hist: hist.map((x) => x * 2.7), hist_to: "2026-11-09" } };
  const now = new Date("2026-11-11T12:00:00Z");
  const c = P.series(stats, "corn", now);
  assert.equal(c.v.length, 20);
  assert.equal(c.last, 4.29);
  assert.equal(c.lo, 4.1);
  assert.equal(c.hi, 4.29);
  assert.equal(c.from.toISOString().slice(0, 10), "2026-06-29", "19 weeks back from the file's last week");
  assert.equal(c.to.toISOString().slice(0, 10), "2026-11-09");
  assert.equal(P.caption(c), "Weekly closes of the nearby contract, Jun 29 to Nov 9. Yahoo Finance, delayed.");
  assert.equal(P.series(stats, "corn", new Date("2026-12-20T00:00:00Z")), null, "older than three weeks: withheld");
  assert.equal(P.series({ corn: { hist: hist.slice(0, 10), hist_to: "2026-11-09" } }, "corn", now), null, "short: withheld");
  assert.equal(P.series({ corn: { hist: hist.map((x, i) => (i === 25 ? null : x)), hist_to: "2026-11-09" } }, "corn", now), null, "a hole: withheld");
  assert.equal(P.series(null, "corn", now), null);
  const svg = P.futuresSvg(c, P.series(stats, "soybean", now), { ink: "#fff", dim: "#aaa", gold: "#d4a23f", rule: "#333", bar2: "#777" });
  assert.match(svg.corn, /<polyline points="(?:[\d.]+,[\d.]+ ){19}[\d.]+,[\d.]+"/, "20 points");
  const land = P.landSvg(21000, 11584, 300, { ink: "#fff", dim: "#aaa", gold: "#d4a23f", rule: "#333", bar2: "#777" });
  assert.match(land, /\$21,000/);
  assert.match(land, /\$11,584/);
  assert.ok(!/—/.test(P.card(c, P.series(stats, "soybean", now))), "no em dash on the saved card");
});

test("the sale line says median and keeps the picture's numbers out of the sentence once drawn", () => {
  const L = require("../components/home-land.js");
  const lead = JSON.parse(read("data/land-sales/lead.json"));
  const st = lead.states.find((s) => lead.lead[s]);
  const w = L.words(lead, { lead: lead.lead[st], st, covered: true, mine: st });
  assert.match(w.s, /the county median, \$[\d,]+ \(\d+ sales in 24 months\)/);
  assert.ok(!/middle/.test(w.s));
  assert.ok(!/median/.test(w.base), "the short line holds the sale's own facts");
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const srv = createServer((req, res) => {
    let f = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    if (f.endsWith("/")) f += "index.html";
    if ((!existsSync(f) || statSync(f).isDirectory()) && existsSync(f + ".html")) f += ".html";
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
const LOC = JSON.stringify({ zip: "54728", lat: 45.31, lon: -91.65, label: "Chetek, WI", state: "WI", county: "Barron", ts: Date.now() });

test("browser at 390: the blocks run in order, one corn price and one ZIP input above the fold, no sideways scroll", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const zip of [false, true]) for (const [w, h] of [[390, 844], [1280, 900]]) {
      const tag = `${w} ${zip ? "ZIP" : "no ZIP"}`;
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: h } });
      const pg = await ctx.newPage(), errs = [];
      pg.on("pageerror", (e) => errs.push(e.message));
      await pg.route((u) => !u.href.startsWith(`http://127.0.0.1:${port}`), (r) => r.abort());
      if (zip) await pg.addInitScript((l) => { try { localStorage.setItem("agsist-wx-loc", l); } catch (e) {} }, LOC);
      await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
      await pg.waitForTimeout(1500);
      const r = await pg.evaluate(() => {
        const vis = (e) => { const b = e.getBoundingClientRect(), cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
        const top = (s) => { const e = document.querySelector(s); if (!e || !vis(e)) return null; return e.getBoundingClientRect().top + scrollY; };
        const order = ["#sw-home", "#hb-zip-form", "#hb-fc", "#hap", "#job-daily-t", "#hb-wx", "#job-land", "#job-sell-h"].map(top);
        // a corn price is a dollar figure from $3.00 to $6.99 printed above the fold, outside the ticker strip and the menu
        const hits = [...document.querySelectorAll("#hero-band *")].filter((e) => vis(e) && /^\$[3-6]\.\d{2}(\s*\d\/\d)?$/.test(e.textContent.trim().replace(/\s+/g, " ")) && e.getBoundingClientRect().top < innerHeight && !e.closest("#hb-corn,#hb-soy,.hap"));
        const cornPx = hits.filter((e) => !hits.some((o) => o !== e && e.contains(o))).length;
        const zipInputs = [...document.querySelectorAll("input")].filter((i) => /zip/i.test((i.id || "") + (i.placeholder || "") + (i.getAttribute("aria-label") || "")) && vis(i)).length;
        const locAsks = [...document.querySelectorAll("button,a")].filter((e) => /use my location/i.test(e.textContent) && vis(e)).length;
        const ticker = document.querySelector(".prices-strip"), tt = ticker ? ticker.getBoundingClientRect().top + scrollY : null;
        return { order, cornPx, zipInputs, locAsks, tt, vh: innerHeight, hs: document.documentElement.scrollWidth - document.documentElement.clientWidth, txt: document.getElementById("hero-band").innerText };
      });
      const seen = r.order.filter((x) => x != null);
      assert.deepEqual([...seen].sort((a, b) => a - b), seen, `${tag}: blocks run top to bottom in the brief's order (${r.order.join(", ")})`);
      assert.ok(r.order[1] != null || zip, `${tag}: the ZIP box shows with no ZIP`);
      assert.ok(r.order[2] != null && r.order[3] != null && r.order[4] != null && r.order[6] != null, `${tag}: futures, Today and this week, the Daily and the land sale all show`);
      assert.equal(r.order[5] != null, zip, `${tag}: the weather block shows only once a ZIP is set`);
      assert.equal(r.cornPx, 1, `${tag}: exactly one corn price above the fold, the futures card's`);
      assert.ok(r.zipInputs <= 1, `${tag}: one ZIP input`);
      if (!zip) { assert.equal(r.zipInputs, 1, `${tag}: the ZIP box is on the page`); assert.equal(r.locAsks, 1, `${tag}: one Use my location`); }
      assert.ok(r.tt > r.vh * 0.9 || r.tt == null, `${tag}: the ticker (a second corn price) is not above the fold (${r.tt})`);
      assert.ok(!/\bI['’]m\b/.test(r.txt) && !/county[’']s middle/.test(r.txt), `${tag}: no I'm, no "county's middle"`);
      assert.ok(r.hs <= 0, `${tag}: no sideways scroll (${r.hs}px)`);
      assert.deepEqual(errs, [], `${tag}: no page errors`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
