/* Home page first screen = three jobs (Nov 2, 2026; the Oct 29 "beat AGSIST"
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
const SB = "(?:<!--\\n-->)?";   // a seed may sit on its own line (seed_static SEED_BREAK, build rule 67)

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

test("the hero answers first (Nov 11): the ZIP card, then futures, then the links Sell grain and My field, each with its destinations", () => {
  const near = band.indexOf('id="job-near-h">Your cash bids<'), sell = band.indexOf('id="job-sell-h">Sell grain<'), field = band.indexOf('id="job-field-h">My field<');
  assert.ok(near > 0 && near < band.indexOf('id="hb-fc"') && band.indexOf('id="hb-fc"') < sell && sell < field, "the ZIP card, the futures, Sell grain, My field");
  const nearCard = band.slice(near, band.indexOf('<h3 class="hb-futh">')), sellCard = band.slice(sell, field), fieldCard = band.slice(field, band.indexOf("</nav>", field));
  for (const id of ["hb-place", "hb-zip-form", "hb-zip", "hb-corn", "hb-soy"]) assert.ok(nearCard.includes(`id="${id}"`), `the ZIP card holds #${id}`);
  for (const id of ["job-daily-t", "hb-wx"]) assert.ok(band.indexOf(`id="${id}"`) > band.indexOf('id="hap"') && band.indexOf(`id="${id}"`) < sell, `#${id} follows Today and this week, before the links`);
  for (const h of ["/cash-bids", "/basis", "/store-or-sell"]) assert.ok(sellCard.includes(`href="${h}"`), `Sell grain links ${h}`);
  for (const h of ["/field-scout", "/fast-facts"]) assert.ok(fieldCard.includes(`href="${h}"`), `My field links ${h}`);
  assert.ok(band.includes('href="#daily-hero"'), "the Daily line goes to the briefing on this page");
});

test("the futures stay baked in the hero, right under the ZIP card; signup band and Rain Print rule kept", () => {
  const futEnd = band.indexOf('<h3 class="hb-futh">Futures</h3>');
  assert.ok(futEnd > band.indexOf('id="job-near-h"') && futEnd < band.indexOf('id="job-sell-h"'), "the futures come after the ZIP card and before the links");
  for (const t of ["fc", "fs"]) {
    const at = band.indexOf(`id="hb-${t}"`);
    assert.ok(at > futEnd, `#hb-${t} sits under the Futures heading`);
    assert.match(band, new RegExp(`id="hb-${t}-v">${SB}<!--SEED:hp:${t}-->`), `#hb-${t} is still baked`);
  }
  assert.match(HTML, /id="hb-ask" data-signup-ask=/, "the hero email ask stays");
  for (const id of ["signup-compact", "signup-full"]) assert.ok(HTML.includes(`id="${id}"`), `#${id} stays`);
  // round 3 (Nov 2): the Rain Print card moved up from under the prices into "Worth a look", under the jobs
  const strip = HTML.indexOf('<section class="wl" id="wl"'), early = HTML.indexOf("<div data-rp-card-early hidden></div>");
  assert.ok(strip > HTML.indexOf('id="hero-band"') && early > strip && early < HTML.indexOf('id="daily-hero"'), "the Rain Print card's early slot is in Worth a look, before the Daily");
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

test("browser: the ZIP card and the futures are the first screen at 390 and 1280, with and without a ZIP; the links follow", { skip, timeout: 180000 }, async () => {
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
          jobs: box("#hb-jobs"), fc: box("#hb-fc"), fs: box("#hb-fs"), vh: innerHeight, ff: document.getElementById("job-ff").textContent,
          zipIn: !!document.querySelector(".job-near #hb-zip"), hs: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      assert.ok(r.near && r.near.h > 0 && r.near.bottom <= r.vh, `${tag}: the ZIP card's heading is on the first screen (${r.near && r.near.bottom} of ${r.vh})`);
      if (!zip) assert.ok(r.zip && r.zip.h > 0 && r.zip.bottom <= r.vh && r.zipIn, `${tag}: the ZIP box shows in the first card on the first screen`);
      assert.ok(r.fc.top >= r.near.bottom && r.fc.top < r.vh && r.fs.top < r.vh, `${tag}: both futures prices sit right under the ZIP card, on the first screen (${r.fc.top} of ${r.vh})`);
      assert.ok(r.sell.top > r.fc.bottom && r.field.top > r.sell.top, `${tag}: Sell grain and My field come after the answers`);
      assert.equal(r.ff, zip ? "Fast Facts for Barron County" : "Fast Facts for your county", `${tag}: Fast Facts names the saved county`);
      assert.ok(r.hs <= 0, `${tag}: no sideways scroll (${r.hs}px)`);
      assert.deepEqual(errs, [], `${tag}: no page errors`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

/* ---- Round 2 (Nov 2): "the weather today should be a snapshot of the actual day's forecast"; tight on
   phones, no card inside a card; the More list folded shut and grouped like the menu. ---- */
test("More is folded shut by default and grouped like the site menu", () => {
  const nav = HTML.slice(HTML.indexOf('<nav class="land-more"'), HTML.indexOf("</nav>", HTML.indexOf('<nav class="land-more"')));
  const det = /<details class="([^"]*)"([^>]*)>/.exec(nav);
  assert.ok(det && /land-fold/.test(det[1]), "the More list is a <details>");
  assert.ok(!/\bopen\b/.test(det[2]), "folded shut by default");
  const groups = [...nav.matchAll(/<h4 class="land-grp">([^<]+)<\/h4>/g)].map((m) => m[1]);
  assert.deepEqual(groups, ["Prices", "Livestock", "Field", "Money and land", "Daily"], "the menu's sections, in the menu's order");
});

const CT_OFF = 6 * 3600e3; // America/Chicago is UTC-6 in November
/* a grid whose numbers are known by local hour: high 62 at 3 PM today, low 41 at 5 AM tomorrow, rain chance
   40% at 1 PM, wind 5 to 12 mph from the south over the day, sky 55% (partly) */
function gridOpts(now) {
  const t0 = Math.floor(now / 3600e3) * 3600e3 - 6 * 3600e3;
  const lh = (h) => new Date(t0 + h * 3600e3 - CT_OFF).getUTCHours();
  const day = (h) => Math.floor((t0 + h * 3600e3 - CT_OFF) / 864e5) - Math.floor((now - CT_OFF) / 864e5);
  return {
    now,
    tempF: (h) => (day(h) === 0 && lh(h) === 15 ? 62 : day(h) === 1 && lh(h) === 5 ? 41 : 50),
    pop: (h) => (day(h) === 0 && lh(h) === 13 ? 40 : 10),
    windMph: (h) => (day(h) === 0 && lh(h) >= 10 && lh(h) <= 17 ? 5 + (lh(h) - 10) : day(h) === 0 && lh(h) > 17 ? 4 : 9),
    dir: 180, sky: 55, updated: new Date(now - 3600e3).toISOString().replace(".000Z", "+00:00"),
  };
}
const BIDS = (t) => ({ status: "ok", radiusMi: 50, place: "Chetek, WI",
  corn: { cash: 3.9275, basis: -0.55, ref: "Dec", name: "Test Elevator A", town: "Barron, WI", mi: 12, month: "Nov", posted: t, stale: false },
  soybeans: { cash: 10.6125, basis: -1.0, ref: "Jan", name: "Test Elevator B", town: "Cameron, WI", mi: 18, month: "Nov", posted: t, stale: false } });

async function openHome(browser, port, { w = 390, h = 844, now, nws, bids = true, zip = true } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: h } });
  const pg = await ctx.newPage(), errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  if (now) await pg.clock.setFixedTime(new Date(now));
  const { routeNws } = await import("./fixtures/nws-mock.mjs");
  if (nws === "hang") await pg.route(/^https:\/\/api\.weather\.gov\//, () => {});
  else if (nws) await routeNws(pg, nws);
  await pg.route((u) => !u.href.startsWith(`http://127.0.0.1:${port}`) && !/^https:\/\/api\.weather\.gov\//.test(u.href), (r) => r.abort());
  if (zip) await pg.addInitScript((l) => { try { localStorage.setItem("agsist-wx-loc", l); } catch (e) {} }, LOC);
  await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  if (bids) await pg.evaluate((d) => { window.dispatchEvent(new CustomEvent("agsist:bids-top", { detail: d })); }, BIDS(new Date((now || Date.now()) - 3000e3).toISOString()));
  return { ctx, pg, errs };
}

test("browser: Weather today is a snapshot of today's NWS forecast, and tonight's after 6 PM", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const morning = Date.parse("2026-11-03T16:00:00Z"); // 10 AM CT
    let { ctx, pg, errs } = await openHome(browser, port, { now: morning, nws: gridOpts(morning) });
    await pg.waitForFunction(() => document.getElementById("hb-wx").dataset.state === "ok", null, { timeout: 15000 });
    let t = await pg.evaluate(() => ({ k: document.getElementById("hb-wx-k").textContent, v: document.getElementById("hb-wx-v").textContent, s: document.getElementById("hb-wx-s").innerText, g: !!document.querySelector("#hb-wx-v svg.hb-wxg use") }));
    assert.match(t.k, /^Today · NWS forecast, 9:00 AM$/, "labeled a forecast, with its issue time");
    assert.match(t.v, /High today 62°/, "today's high");
    assert.match(t.v, /41° low tonight/, "tonight's low");
    assert.match(t.s, /Partly sunny/, "the sky in words");
    assert.match(t.s, /Rain 40%/, "the day's highest rain chance");
    assert.match(t.s, /Wind S 5-12 mph/, "wind direction and the range left today");
    assert.ok(t.g, "a line icon from the site's sprite");
    assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(t.v + t.s), "no emoji");
    assert.deepEqual(errs, []);
    await ctx.close();
    const evening = Date.parse("2026-11-04T02:00:00Z"); // 8 PM CT on Nov 3
    ({ ctx, pg, errs } = await openHome(browser, port, { now: evening, nws: { ...gridOpts(evening), tempF: 47 } }));
    await pg.waitForFunction(() => document.getElementById("hb-wx").dataset.state === "ok", null, { timeout: 15000 });
    t = await pg.evaluate(() => ({ k: document.getElementById("hb-wx-k").textContent, v: document.getElementById("hb-wx-v").textContent }));
    assert.match(t.k, /^Tonight · NWS forecast/, "after 6 PM it is tonight's forecast");
    assert.match(t.v, /Low tonight 47°.*47° high tomorrow/, "tonight's low, then tomorrow's high");
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("browser: the forecast cell holds its height while loading and says so in one line when the NWS is down", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const now = Date.parse("2026-11-03T16:00:00Z");
    const hts = {};
    for (const [tag, nws] of [["loading", "hang"], ["ok", gridOpts(now)], ["down", { down: true }]]) {
      const { ctx, pg } = await openHome(browser, port, { now, nws });
      if (tag === "ok") await pg.waitForFunction(() => document.getElementById("hb-wx").dataset.state === "ok", null, { timeout: 15000 });
      if (tag === "down") await pg.waitForFunction(() => document.getElementById("hb-wx").dataset.state === "failed", null, { timeout: 20000 });
      if (tag === "loading") await pg.waitForTimeout(1500);
      hts[tag] = await pg.evaluate(() => ({ h: document.getElementById("hb-wx").getBoundingClientRect().height, s: document.getElementById("hb-wx-s").textContent.trim(), skel: !!document.querySelector("#hb-wx-v .hb-skel") }));
      await ctx.close();
    }
    assert.ok(hts.loading.skel, "a placeholder while the forecast loads");
    assert.ok(Math.abs(hts.ok.h - hts.loading.h) <= 2, `no shift when the forecast lands (${hts.loading.h} -> ${hts.ok.h})`);
    assert.equal(hts.down.s, "The weather service did not answer. Try again in a few minutes.", "one plain line when the NWS does not answer; the card below has failed too (Nov 10 audit)");
    assert.ok(hts.down.h <= hts.loading.h + 2, "the failure line does not grow the cell");
  } finally { await browser.close(); srv.close(); }
});

test("browser: tight on a phone; at 390x844 the first screen holds the ZIP line, both bids and both futures prices, then the forecast and the Daily follow", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const now = Date.parse("2026-11-03T16:00:00Z");
    const { ctx, pg, errs } = await openHome(browser, port, { now, nws: gridOpts(now) });
    await pg.waitForFunction(() => document.getElementById("hb-wx").dataset.state === "ok", null, { timeout: 15000 });
    const r = await pg.evaluate(() => {
      const b = (s) => { const e = document.querySelector(s); const x = e.getBoundingClientRect(); return { top: x.top, bottom: x.bottom, left: x.left, right: x.right, h: x.height }; };
      const boxed = (e) => { const c = getComputedStyle(e); return (parseFloat(c.borderRadius) > 0) || (c.backgroundColor !== "rgba(0, 0, 0, 0)" && c.backgroundColor !== "transparent"); };
      const band = document.getElementById("hero-band");
      return { vh: innerHeight, vw: innerWidth, place: b("#hb-place"), corn: b("#hb-corn"), soy: b("#hb-soy"), fc: b("#hb-fc"), fs: b("#hb-fs"), wx: b("#hb-wx"), daily: b("#job-daily-t"), sell: b("#job-sell-h"),
        card: b(".job-near"), wxCard: b(".af-wx"), bandBoxed: boxed(band),
        nested: [...document.querySelectorAll("#hb-jobs > .job, #hb-jobs > .af-wx, #hb-jobs > .hb-grid--fut")].filter((c) => [...c.querySelectorAll("*")].some((e) => boxed(e) && !e.matches("input,button,.hb-skel,svg,svg *"))).map((e) => e.className),
        rows: [...document.querySelectorAll("#hero-band .job-links a, #hero-band .job-daily")].map((a) => ({ h: a.getBoundingClientRect().height, chev: getComputedStyle(a, "::after").content !== "none", u: getComputedStyle(a.querySelector("span")).textDecorationLine })) };
    });
    for (const k of ["place", "corn", "soy", "fc", "fs"]) assert.ok(r[k].h > 0 && r[k].bottom <= r.vh, `${k} is on the first screen (${Math.round(r[k].bottom)} of ${r.vh})`);
    assert.ok(r.fc.bottom <= r.wx.top && r.wx.top < r.daily.top + 400 && r.daily.bottom <= r.sell.top, "the forecast and the Daily come after the futures, before the links");
    assert.equal(r.bandBoxed, false, "the band itself is not a box; each answer is one card");
    assert.deepEqual(r.nested, [], "no box inside a card");
    assert.ok(r.card.left >= 11 && r.card.left <= 13 && r.vw - r.wxCard.right >= 11 && r.vw - r.wxCard.right <= 13, `one 12px gutter (${r.card.left}, ${r.vw - r.wxCard.right})`);
    assert.ok(r.rows.length >= 6 && r.rows.every((x) => x.h >= 44 && x.chev && x.u === "none"), "the links and the Daily are 44px rows with a chevron, not underlined");
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

/* ---- Round 3 (Nov 2): "Worth a look", right under the three jobs. Rain Print (the promo card, moved up
   so it is on the page once), the rain gauge waitlist in the gauge hook's words, and one new page from What's
   new that turns over by the Central date. ---- */
const require = (await import("node:module")).createRequire(import.meta.url);
const WORTH = require(join(ROOT, "components/home-worth.js"));
const RP = JSON.parse(read("data/rain-print.json"));
/* Frozen copies of data/rain-print.json and data/whats-new.json (Nov 3, 2026) for the browser cases that fake a
   date: the owner's Nov 3 rule, no test depends on today's date or on live data holding a value. */
const RPF = JSON.parse(read("test/fixtures/home-worth/rain-print.json"));
const WNF = JSON.parse(read("test/fixtures/home-worth/whats-new.json"));

test("Worth a look sits right under the jobs, before the Daily, with Rain Print once", () => {
  const bandEnd = HTML.indexOf("</section>", HTML.indexOf('id="hero-band"'));
  const wl = HTML.indexOf('<section class="wl" id="wl" aria-labelledby="wl-h">'), wlEnd = HTML.indexOf("</section>", wl);
  assert.ok(wl > bandEnd && wl < HTML.indexOf('<section class="daily-hero'), "after the hero band (jobs and futures), before the Daily");
  const strip = HTML.slice(wl, wlEnd);
  assert.match(strip, /<h2 class="wl-h" id="wl-h">Worth a look<\/h2>/);
  const cells = [...strip.matchAll(/class="wl-c ([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(cells, ["wl-rp", "wl-g", "wl-n"], "Rain Print, the rain gauge, then what is new");
  assert.match(strip, /<div class="wl-c wl-rp"><div data-rp-card-early hidden><\/div><aside data-rain-print-promo="card" aria-label="Rain Print" hidden><\/aside><\/div>/);
  assert.equal((HTML.match(/data-rain-print-promo/g) || []).length, 1, "one Rain Print promo on the page");
  assert.equal((HTML.match(/data-rp-card-early/g) || []).length, 1);
  assert.ok(!/class="rp-promo"/.test(HTML), "no second Rain Print line");
  // the gauge card says the hook, the same words as every other place that links the gauge (test/gauge-hook)
  const g = /<a class="wl-c wl-g" href="\/rain-gauge"[^>]*><span class="wl-t">([^<]+)<\/span><span class="wl-x">([^<]+)<\/span><span class="wl-a">([^<]+) &rarr;<\/span><\/a>/.exec(strip);
  assert.ok(g, "the rain gauge card: title, one line, one action");
  assert.equal(g[1], "A rain gauge that keeps its own log", "the /rain-gauge headline");
  assert.equal(g[2], "A rain gauge that keeps a log for each field.", "the hook's line without the I (Nov 11): no I on public pages");
  assert.ok(RP.gauge_hook.line.endsWith("a rain gauge that keeps a log for each field."), "still the same promise as the hook");
  assert.equal(g[3], RP.gauge_hook.link);
  assert.match(strip, /<a class="wl-c wl-n" id="wl-new" href="\/changelog"[^>]*><span class="wl-t">New on AGSIST<\/span><span class="wl-x" id="wl-new-x">[^<]+<\/span><span class="wl-a" id="wl-new-a">[^<]+<\/span><\/a>/, "baked: a plain What's new link until today's page lands");
  assert.match(HTML, /<script src="\/components\/home-worth\.js\?v=1" defer><\/script>/);
  const cssV = /<link rel="stylesheet" href="\/css\/home\.css\?v=(\d+)">/.exec(HTML);
  assert.ok(cssV && +cssV[1] >= 31, "home.css v31 (the strip's styles) or later");
  assert.ok(!/[—–]|&mdash;|&ndash;/.test(strip) && !/[\u{1F300}-\u{1FAFF}]/u.test(strip), "no dashes or emoji");
  assert.ok(!/href="https?:/.test(strip), "no outside links");
});

const WN = [
  { id: "2026-11-02-feederindex", date: "2026-11-02", title: "Our own feeder steer index", link: "/cattle-auction-prices#feeder-index" },
  { id: "2026-11-02-landnj", date: "2026-11-02", title: "New Jersey farm sales", link: "/land-sales/#new-jersey" },
  { id: "2026-11-02-dailyweblinks", date: "2026-11-02", title: "Daily top stories link to the full story", link: "/daily" },
  { id: "2026-11-02-homejobs", date: "2026-11-02", title: "The home page opens on three jobs", link: "/" },
  { id: "2026-11-01-dailyfacts", date: "2026-11-01", title: "A new fact in the Daily every morning", link: "/daily" },
  { id: "2026-10-30-rpxmas", date: "2026-10-30", title: "A Rain Print, made for you", link: "/rain-print" },
  { id: "2026-10-30-tapsize", date: "2026-10-30", title: "Easier to tap on a phone", link: "/hail-map" },
  { id: "2026-09-20-old", date: "2026-09-20", title: "Old news", link: "/spray" },
];

test("New on AGSIST: the newest three pages from What's new, one each, turning over by the date", () => {
  const ids = (d) => WORTH.pool(WN, d).map((e) => e.id);
  assert.deepEqual(ids("2026-11-02"), ["2026-11-02-feederindex", "2026-11-02-landnj", "2026-11-02-dailyweblinks"],
    "newest first; the home page itself and a second /daily entry are skipped");
  // deterministic: the same pick all day for everyone, the next one tomorrow, back round after three days
  const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map((d) => WORTH.pickNew(WN, d).id);
  assert.equal(new Set(days.slice(0, 3)).size, 3, "three days, three pages: " + days);
  assert.equal(days[3], days[0]);
  assert.deepEqual(WORTH.pickNew(WN, "2026-11-02"), WORTH.pickNew(WN.map((x) => ({ ...x })), "2026-11-02"));
  const p = WORTH.pickNew(WN, "2026-11-02");
  assert.match(p.line, /^[A-Z][^.]+\. Added Nov 2\.$/, "the entry's title, then the date it was added");
  assert.equal(p.cta, "Take a look");
  // Rain Print and the gauge have their own cards; nothing older than 30 days; no future-dated entry
  assert.ok(!ids("2026-11-20").includes("2026-10-30-rpxmas"));
  const aged = WN.filter((x) => /tapsize|old/.test(x.id)), aIds = (d) => WORTH.pool(aged, d).map((e) => e.id);
  assert.ok(aIds("2026-11-29").includes("2026-10-30-tapsize") && !aIds("2026-11-30").includes("2026-10-30-tapsize"), "30 days, then gone");
  assert.ok(aIds("2026-10-20").includes("2026-09-20-old") && !aIds("2026-10-21").includes("2026-09-20-old"));
  assert.ok(!ids("2026-11-01").some((i) => i.startsWith("2026-11-02")), "nothing dated after today");
  // fail soft: nothing recent, bad data or an outside link leaves the baked What's new link
  assert.equal(WORTH.pickNew(WN, "2027-03-01"), null);
  assert.equal(WORTH.pickNew(null, "2026-11-02"), null);
  assert.equal(WORTH.pickNew([{ date: "2026-11-02", title: "x", link: "https://example.com/" }, { date: "2026-11-02", title: "y", link: "//evil.example/" }], "2026-11-02"), null);
  // the live What's new file has today's three on Nov 2 (the brief's feeder index, New Jersey land, Daily stories)
  const live = JSON.parse(read("data/whats-new.json")).items;
  const want = ["/cattle-auction-prices", "/land-sales", "/daily"];
  if (WORTH.pool(live, "2026-11-02").length === 3) assert.deepEqual(WORTH.pool(live, "2026-11-02").map((e) => e.href.split("#")[0].replace(/\/$/, "")), want);
});

/* the page at one date: rain-print.json and whats-new.json held back for `hold` ms so the cards fill late */
async function openWorth(browser, port, { w, h = 844, day, cfg, wn, hold = 1200, zip = true }) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: h } });
  const pg = await ctx.newPage(), errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.clock.setFixedTime(new Date(day + "T16:00:00Z"));
  await pg.route((u) => !u.href.startsWith(`http://127.0.0.1:${port}`), (r) => r.abort());
  await pg.route(/\/data\/(rain-print|whats-new)\.json/, async (r) => {
    await new Promise((ok) => setTimeout(ok, hold));
    if (cfg && /rain-print/.test(r.request().url())) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cfg) });
    if (wn && /whats-new/.test(r.request().url())) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(wn) });
    return r.continue();
  });
  await pg.addInitScript(() => {
    // shifts the strip causes: nodes in it or after it moved, none in the hero band above it (the band's own
    // bids and forecast are held by the round 2 tests and test/cls-*.test.mjs)
    window.__shift = 0;
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) {
      const wl = document.getElementById("wl"), band = document.getElementById("hero-band"), ns = e.sources.map((x) => x.node).filter(Boolean);
      if (e.hadRecentInput || !wl || ns.some((n) => band && band.contains(n))) continue;
      if (ns.some((n) => wl.contains(n) || (wl.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING))) window.__shift += e.value;
    } }).observe({ type: "layout-shift", buffered: true }); } catch (e) {}
  });
  if (zip) await pg.addInitScript((l) => { try { localStorage.setItem("agsist-wx-loc", l); } catch (e) {} }, LOC);
  await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  return { ctx, pg, errs };
}
// heights of every element above the strip that has an id or class, so a failure names what grew
const aboveStrip = () => {
  const wl = document.getElementById("wl"), out = {};
  if (!wl) return out;
  for (const e of document.querySelectorAll("body *")) {
    if (!(wl.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_PRECEDING) || e.contains(wl)) continue;
    const k = e.id ? "#" + e.id : (typeof e.className === "string" && e.className.trim() ? e.tagName.toLowerCase() + "." + e.className.trim().split(/\s+/)[0] : null);
    if (!k || k in out) continue;
    out[k] = Math.round(e.getBoundingClientRect().height * 10) / 10;
  }
  return out;
};
const worthBoxes = () => {
  const b = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, h: r.height }; };
  return { wl: b("#wl"), rp: b(".wl-rp"), g: b(".wl-g"), n: b("#wl-new"), band: b("#hero-band"), jobs: b("#hb-jobs"), daily: b("#daily-hero") };
};

test("browser: Worth a look holds its place while it fills, for each Rain Print wording, at 390 and 1280", { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    // Christmas (through the framed cutoff), "Still need a gift?" (to Dec 24), the year-round card
    for (const [day, angle] of [["2026-11-02", "christmas"], ["2026-12-15", "gift"], ["2027-01-15", "evergreen"]]) for (const w of [390, 1280]) {
      const tag = `${w} ${day}`;
      // The strip's own data is held 3 s. "before" is taken once everything above the strip has settled (its top
      // still for 3 checks in a row), so a slow runner filling the hero band late (Nov 2: CI moved the strip 18 px
      // at 400 ms) is not read as the strip moving; the band is held by the round 2 and cls tests.
      const { ctx, pg, errs } = await openWorth(browser, port, { w, day, h: w === 390 ? 844 : 900, hold: 3000, cfg: RPF, wn: WNF });
      // web fonts swap in when their files arrive; on a slow runner that can be after the page "settles"
      await pg.evaluate(() => document.fonts && document.fonts.ready);
      let last = null, still = 0;
      for (let i = 0; i < 25 && still < 3; i++) {
        await pg.waitForTimeout(100);
        const t = await pg.evaluate(() => document.getElementById("wl").getBoundingClientRect().top + scrollY);
        still = last !== null && Math.abs(t - last) < 0.5 ? still + 1 : 0;
        last = t;
      }
      assert.ok(still >= 3, `${tag}: the page above the strip settles before its data comes`);
      const filled = await pg.evaluate(() => document.getElementById("wl-new").getAttribute("href"));
      assert.equal(filled, "/changelog", `${tag}: "before" is read while the strip still holds its baked link`);
      const before = await pg.evaluate(worthBoxes);
      const aboveBefore = await pg.evaluate(aboveStrip);
      // The bids land after "before", as they did on CI on Nov 3: the label "Top soybean bid nearby" became "...
      // within 50 mi", a second line at 390, and the band grew 18px over the strip. The band holds it now.
      await pg.evaluate((d) => { window.dispatchEvent(new CustomEvent("agsist:bids-top", { detail: d })); }, BIDS(new Date(Date.parse(day + "T16:00:00Z") - 3000e3).toISOString()));
      // a date with nothing recent in What's new keeps the baked link (2027-01-15 here)
      const pick = WORTH.pickNew(WNF.items, day);
      await pg.waitForFunction((href) => !document.querySelector(".wl-rp aside").hidden && document.getElementById("wl-new").getAttribute("href") === href, pick ? pick.href : "/changelog", { timeout: 15000 });
      await pg.waitForTimeout(pick ? 300 : 1500);
      const after = await pg.evaluate(worthBoxes);
      const r = await pg.evaluate(() => ({ shift: window.__shift, cards: document.querySelectorAll(".rp-card").length, place: document.querySelector(".rp-card").getAttribute("data-placement"),
        inStrip: !!document.querySelector("#wl .rp-card"), hs: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      assert.equal(r.place, "home-card-" + angle, `${tag}: the ${angle} card`);
      assert.ok(r.cards === 1 && r.inStrip, `${tag}: one Rain Print card, in the strip`);
      const aboveAfter = await pg.evaluate(aboveStrip);
      const grew = Object.keys(aboveAfter).filter((k) => Math.abs(aboveAfter[k] - (aboveBefore[k] || 0)) > 1).map((k) => `${k} ${aboveBefore[k]}->${aboveAfter[k]}`);
      for (const k of ["wl", "rp", "g", "n", "daily"]) assert.ok(Math.abs(after[k].top - before[k].top) <= 1 && Math.abs(after[k].h - before[k].h) <= 1, `${tag}: ${k} did not move or grow (${before[k].top}/${before[k].h} -> ${after[k].top}/${after[k].h}); changed above the strip: ${grew.join(", ") || "none"}`);
      assert.ok(r.shift < 0.001, `${tag}: no layout shift (${r.shift})`);
      assert.ok(after.wl.top >= after.band.bottom && after.wl.top > after.jobs.bottom && after.wl.bottom <= after.daily.top, `${tag}: under the jobs and the futures, above the Daily`);
      if (w === 390) {
        assert.ok(after.wl.h <= 844 * 0.6, `${tag}: the strip adds well under one screen on a phone (${Math.round(after.wl.h)}px)`);
        assert.ok(after.g.top >= after.rp.bottom - 1 && after.n.top >= after.g.bottom - 1, `${tag}: one card under another`);
      } else {
        assert.ok(Math.abs(after.rp.top - after.g.top) <= 1 && Math.abs(after.g.top - after.n.top) <= 1, `${tag}: a row of three`);
      }
      assert.ok(r.hs <= 0, `${tag}: no sideways scroll`);
      assert.deepEqual(errs, [], `${tag}: no page errors`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("browser: the Christmas card's order-by date comes from data/rain-print.json, never a countdown", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [cut, want] of [[RPF.framed_christmas_cutoff, "Dec 9"], ["2026-12-07", "Dec 7"]]) {
      const cfg = { ...RPF, framed_christmas_cutoff: cut };
      const { ctx, pg, errs } = await openWorth(browser, port, { w: 390, day: "2026-11-02", cfg, hold: 50 });
      await pg.waitForFunction(() => !document.querySelector(".wl-rp aside").hidden, null, { timeout: 15000 });
      const t = await pg.evaluate(() => ({ title: document.querySelector(".wl .rp-card-t").textContent, text: document.querySelector(".wl .rp-card-x").textContent, a: document.querySelector(".wl .rp-card").getAttribute("href"), cta: document.querySelector(".wl .rp-card-p b").textContent }));
      assert.equal(t.title, "A Christmas gift for the farm");
      assert.ok(t.text.includes("Order framed by " + want + " for Christmas delivery."), `${cut}: ${t.text}`);
      assert.ok(!/\bdays? (left|to go)\b|countdown|\d+ days/i.test(t.text), "no countdown");
      assert.equal(t.a, "/gifts-for-farmers");
      assert.ok(/ →$/.test(t.cta), "one action");
      assert.deepEqual(errs, []);
      await ctx.close();
    }
    // Rain Print switched off: the empty cell folds away, the other two cards stay
    const { ctx, pg } = await openWorth(browser, port, { w: 1280, h: 900, day: "2026-11-02", cfg: { ...RPF, promote: false }, hold: 50 });
    await pg.waitForFunction(() => document.querySelector(".wl-rp").hidden, null, { timeout: 15000 });
    const vis = await pg.evaluate(() => [...document.querySelectorAll("#wl .wl-c")].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.className));
    assert.deepEqual(vis, ["wl-c wl-g", "wl-c wl-n"]);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("browser: New on AGSIST shows the same page all day and the next one tomorrow", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const live = JSON.parse(read("data/whats-new.json")).items;
    const day = live[0].date, next = new Date(Date.parse(day + "T12:00:00Z") + 864e5).toISOString().slice(0, 10);
    for (const d of [day, next]) {
      const want = WORTH.pickNew(live, d);
      const { ctx, pg, errs } = await openWorth(browser, port, { w: 390, day: d, hold: 50 });
      if (!want) { await pg.waitForTimeout(1500); assert.equal(await pg.getAttribute("#wl-new", "href"), "/changelog"); await ctx.close(); continue; }
      await pg.waitForFunction(() => document.getElementById("wl-new").getAttribute("href") !== "/changelog", null, { timeout: 15000 });
      const got = await pg.evaluate(() => ({ href: document.getElementById("wl-new").getAttribute("href"), x: document.getElementById("wl-new-x").textContent, a: document.getElementById("wl-new-a").textContent }));
      assert.deepEqual(got, { href: want.href, x: want.line, a: "Take a look →" }, d);
      assert.deepEqual(errs, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
