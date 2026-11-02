/* Home page first screen = three jobs (Sig, Nov 2, 2026; the Oct 29 "beat AGSIST"
 * defense plan, item 5): "Today near me" (the reader's ZIP: best bids nearby,
 * weather and rain chance, the Daily), "Sell grain" (cash bids, basis, store or
 * sell) and "My field" (Field Scout, Fast Facts for the county). No ZIP: the ZIP
 * box is in the first card. The baked futures stay in the hero, under the jobs;
 * the signup band and the Rain Print card rule (right under the prices until
 * Dec 9, Oct 23) stay; every menu destination is still on the page, under More.
 * The browser cases need Playwright and Chromium (skipped without).
 *   node --test test/home-jobs.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, mkdtempSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { tmpdir } from "node:os";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const HTML = read("index.html");
const band = HTML.slice(HTML.indexOf('id="hero-band"'), HTML.indexOf("</section>", HTML.indexOf('id="hero-band"')));
const mainHtml = HTML.slice(HTML.indexOf('<main id="main"'), HTML.indexOf("<!-- Static footer"));

test("the hero opens with the three jobs, in order, each with its destinations", () => {
  const near = band.indexOf('id="job-near-h">Today near me<'), sell = band.indexOf('id="job-sell-h">Sell grain<'), field = band.indexOf('id="job-field-h">My field<');
  assert.ok(near > 0 && near < sell && sell < field, "Today near me, Sell grain, My field");
  const nearCard = band.slice(near, sell), sellCard = band.slice(sell, field), fieldCard = band.slice(field, band.indexOf("</nav>", field));
  for (const id of ["hb-place", "hb-zip-form", "hb-zip", "hb-corn", "hb-soy", "hb-wx", "job-daily-t"]) assert.ok(nearCard.includes(`id="${id}"`), `Today near me holds #${id}`);
  for (const h of ["/cash-bids", "/basis", "/store-or-sell"]) assert.ok(sellCard.includes(`href="${h}"`), `Sell grain links ${h}`);
  for (const h of ["/field-scout", "/fast-facts"]) assert.ok(fieldCard.includes(`href="${h}"`), `My field links ${h}`);
  assert.ok(nearCard.includes('href="#daily-hero"'), "the Daily line goes to the briefing on this page");
});

test("the futures stay baked in the hero, under the jobs; signup band and Rain Print rule kept", () => {
  const jobsEnd = band.indexOf('<h3 class="hb-futh">Futures</h3>');
  assert.ok(jobsEnd > band.indexOf('id="job-field-h"'), "the futures come after the three jobs");
  for (const t of ["fc", "fs"]) {
    const at = band.indexOf(`id="hb-${t}"`);
    assert.ok(at > jobsEnd, `#hb-${t} sits under the jobs`);
    assert.match(band, new RegExp(`id="hb-${t}-v"><!--SEED:hp:${t}-->`), `#hb-${t} is still baked`);
  }
  assert.match(band, /id="hb-ask" data-signup-ask=/, "the hero email ask stays");
  for (const id of ["signup-compact", "signup-full"]) assert.ok(HTML.includes(`id="${id}"`), `#${id} stays`);
  const prices = HTML.indexOf('id="f-prices"'), early = HTML.indexOf("<div data-rp-card-early hidden></div>");
  const next = HTML.indexOf('id="s7-month"');
  assert.ok(prices > 0 && early > prices && early < next, "the Rain Print card's early slot is right under the prices, before the next section");
  assert.ok(!/—/.test(band), "no em dash in the hero");
});

test("More holds every page in the site menu (housekeeping links stay in the footer)", () => {
  const hdr = HTML.slice(HTML.indexOf("<!-- Static header"), HTML.indexOf('<main id="main"'));
  const ftr = HTML.slice(HTML.indexOf("<!-- Static footer"));
  const hrefs = (t) => [...t.matchAll(/<a [^>]*href="(\/[^"#]*)(?:#[^"]*)?"/g)].map((m) => m[1]);
  const keepOut = new Set(["/", "/contact", "/rain-print-business", "/prf-sponsor", "/list-your-elevator", "/developer",
    "/editorial-standards", "/accessibility", "/terms", "/privacy", "/about", "/advertise", "/sponsor", "/changelog", "/data-sources"]);
  const inMain = new Set(hrefs(mainHtml));
  const missing = [...new Set([...hrefs(hdr), ...hrefs(ftr)])].filter((h) => !keepOut.has(h) && !inMain.has(h));
  assert.deepEqual(missing, [], "every menu page is linked from the home page body");
  assert.match(HTML, /<h3 class="land-more-h" id="land-more-h">More<\/h3>/);
});

test("bake_homepage.py writes the Daily's date and headline into the first card", () => {
  const dir = mkdtempSync(join(tmpdir(), "homejobs-"));
  mkdirSync(join(dir, "data"));
  copyFileSync(join(ROOT, "index.html"), join(dir, "index.html"));
  const daily = JSON.parse(read("test/fixtures/daily/2026-10-21-top-stories.json"));
  daily.headline = "Corn <up> & beans flat";
  writeFileSync(join(dir, "data/daily.json"), JSON.stringify(daily));
  writeFileSync(join(dir, "data/price-stats.json"), "{}");
  execFileSync("python3", ["-c", `
import sys,pathlib;sys.path.insert(0,'scripts')
import bake_homepage as b
d=pathlib.Path(sys.argv[1]);b.INDEX=d/'index.html';b.DAILY=d/'data/daily.json';b.STATS=d/'data/price-stats.json'
b.main()`, dir], { cwd: ROOT, encoding: "utf8" });
  const out = readFileSync(join(dir, "index.html"), "utf8");
  assert.match(out, /<span class="job-daily-k" id="job-daily-k">The Daily &middot; Oct 21<\/span>/);
  assert.match(out, /<span class="job-daily-t" id="job-daily-t">Corn &lt;up&gt; &amp; beans flat<\/span>/);
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

test("browser: the three jobs are the first screen at 390 and 1280, with and without a ZIP", { skip, timeout: 180000 }, async () => {
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
      const r = await pg.evaluate(() => {
        const box = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top + scrollY, bottom: b.bottom + scrollY, h: b.height }; };
        return { near: box("#job-near-h"), sell: box("#job-sell-h"), field: box("#job-field-h"), zip: box("#hb-zip"),
          jobs: box("#hb-jobs"), fc: box("#hb-fc"), vh: innerHeight, ff: document.getElementById("job-ff").textContent,
          zipIn: !!document.querySelector(".job-near #hb-zip"), hs: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      for (const k of ["near", "sell", "field"]) assert.ok(r[k] && r[k].h > 0 && r[k].bottom <= r.vh, `${tag}: the ${k} job heading is on the first screen (${r[k] && r[k].bottom} of ${r.vh})`);
      if (!zip) assert.ok(r.zip && r.zip.h > 0 && r.zip.bottom <= r.vh && r.zipIn, `${tag}: the ZIP box shows in Today near me on the first screen`);
      assert.ok(r.fc.top >= r.jobs.bottom, `${tag}: the futures sit under the jobs`);
      assert.equal(r.ff, zip ? "Fast Facts for Barron County" : "Fast Facts for your county", `${tag}: Fast Facts names the saved county`);
      assert.ok(r.hs <= 0, `${tag}: no sideways scroll (${r.hs}px)`);
      assert.deepEqual(errs, [], `${tag}: no page errors`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
