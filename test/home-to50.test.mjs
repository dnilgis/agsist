/* Homepage, Oct 16 push toward a 50/50 benchmark score.
 *
 *   1. No location: a reader who neither allows nor blocks the browser's
 *      location question used to sit on "Detecting your location..." and gray
 *      rows forever. After 6 s the cash bid card says so, offers the ZIP box
 *      and a state pick that prints that state's median basis from
 *      data/basis-states.json. Numbers checked by hand below.
 *   2. Byline on the first screen.
 *   3. "Also today" line in the briefing strip, hidden when the briefing is
 *      not today's.
 *   4. cot-analysis.json (about 100 KB) loads only when the COT card is near
 *      the screen; on a phone the card sits in a closed fold.
 *   5. The install banner and its modals are built by home.js on a phone that
 *      passes the gates, not shipped in index.html.
 *
 * Browser parts need Playwright and Chromium; they skip where missing.
 *   node --test test/home-to50.test.mjs
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
let chromium = null, devices = null;
try { if (existsSync(PW)) ({ chromium, devices } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const HTML = readFileSync(join(ROOT, "index.html"), "utf8");
const JS = readFileSync(join(ROOT, "components/home.js"), "utf8");
const CSS = readFileSync(join(ROOT, "css/home.css"), "utf8");

/* Hand-worked cases. Iowa corn: median -0.375 $/bu is 37.5 cents under,
 * printed "−37½¢"; the week's median change +0.5 cents from 5 elevators
 * (min_n 3) prints "+½¢ on the week". Iowa soybeans: 2 elevators, no median,
 * so it is counted as too thin, never priced. Kansas wheat_hrw has a median
 * but wheat is not corn or beans, so only its row prints. Utah: no crop with
 * a median, so no rows. */
const BASIS = {
  schema: "agsist-basis-states/1", generated: "2026-10-16T20:18:10Z", min_n: 3,
  states: {
    IA: { name: "Iowa", path: "/cash-bids/iowa/#basis", elevators: 14, crops: {
      corn: { contract: "ZCZ26", label: "Dec '26", n: 12, outliers: 0, median: -0.375, lo: -0.5, hi: -0.2, wow: 0.5, wow_n: 5 },
      soybeans: { contract: "ZSX26", label: "Nov '26", n: 2, outliers: 0 } } },
    KS: { name: "Kansas", path: "/cash-bids/kansas/#basis", elevators: 30, crops: {
      wheat_hrw: { contract: "KEZ26", label: "Dec '26", n: 24, outliers: 0, median: -0.675, wow: 0, wow_n: 20 } } },
    UT: { name: "Utah", path: "/cash-bids/utah/#basis", elevators: 1, crops: { corn: { n: 1, outliers: 0 } } },
  },
};

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
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
async function open(browser, port, { width = 390, init = null, routes = {}, ctxOpts = {} } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 }, ...ctxOpts });
  if (init) await ctx.addInitScript(init);
  const pg = await ctx.newPage();
  const errors = [], seen = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", async (r) => {
    const u = r.request().url();
    seen.push(u);
    for (const [frag, body] of Object.entries(routes)) {
      if (u.includes(frag)) return body === null ? r.abort() : r.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    }
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}/`);
  return { pg, errors, seen, ctx };
}

test("first screen has no byline line (Sig, Oct 17: removed from the hero band)", () => {
  assert.ok(!/class="hb-by"/.test(HTML), "no hb-by line in the hero band");
  assert.ok(!/Built and checked by/.test(HTML), "no byline sentence on the homepage first screen");
});

test("install banner markup lives in home.js, not in every page load", () => {
  assert.ok(!/id="pwa-modal-ios"/.test(HTML) && !/id="pwa-hint"/.test(HTML), "index.html no longer ships the PWA markup");
  assert.match(JS, /var PWA_HTML = ".*id=\\"pwa-modal-ios\\"/);
  assert.match(JS, /id=\\"pwa-modal-android\\"/);
});

test("new homepage copy has no em dashes", () => {
  const start = JS.indexOf("2026-10-16: no location after a few seconds");
  assert.ok(start > 0);
  const tail = JS.slice(start);
  const strings = tail.match(/'[^'\n]*'/g) || [];
  for (const s of strings) assert.ok(!s.includes("—"), s);
  assert.ok(CSS.includes("#bids-noloc"), "no-location styles present");
});

test("no location: the bid card offers the ZIP box and a state basis, numbers as worked by hand", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, { routes: { "/data/basis-states.json": BASIS } });
    // Headless Chromium leaves the location question unanswered, as a reader who ignores it does.
    await pg.waitForSelector("#bids-noloc", { timeout: 15000 });
    assert.match(await pg.textContent("#bids-noloc .hn-h"), /location did not come through/);
    assert.equal(await pg.$$eval("#bids-list-area .bids-skeleton", (x) => x.length), 0, "skeleton rows gone");
    const opts = await pg.$$eval("#bids-noloc .hn-sel option", (o) => o.map((x) => x.value));
    assert.deepEqual(opts, ["", "IA", "KS", "UT"], "states come from the file, sorted by name");

    await pg.selectOption("#bids-noloc .hn-sel", "IA");
    const rows = await pg.$$eval("#bids-noloc .hn-rows li", (ls) => ls.map((l) => l.textContent));
    assert.deepEqual(rows, ["Corn−37½¢Dec '2612 elevators, +½¢ on the week"]);
    const fine = await pg.textContent("#bids-noloc .hn-fine");
    assert.match(fine, /read Oct 16/);
    assert.match(fine, /Too few bids to print: Soybeans\./);
    assert.equal(await pg.getAttribute("#bids-noloc .hn-fine a", "href"), "/cash-bids/iowa/#basis");
    assert.equal(await pg.evaluate(() => localStorage.getItem("agsist-pd-state")), "IA");
    assert.equal(await pg.evaluate(() => localStorage.getItem("agsist-rma-state")), "Iowa");

    await pg.selectOption("#bids-noloc .hn-sel", "KS");
    assert.deepEqual(await pg.$$eval("#bids-noloc .hn-rows li", (ls) => ls.map((l) => l.textContent)),
      ["HRW wheat−67½¢Dec '2624 elevators, no change on the week"]);
    assert.ok(!/Too few/.test(await pg.textContent("#bids-noloc .hn-fine")), "thin wheat classes are not listed");

    await pg.selectOption("#bids-noloc .hn-sel", "UT");
    assert.equal(await pg.$$eval("#bids-noloc .hn-rows", (x) => x.length), 0, "no median, no price row");
    assert.match(await pg.textContent("#bids-noloc .hn-out"), /Not enough fresh Utah bids/);

    await pg.click("#bids-noloc .hn-zip");
    assert.equal(await pg.$eval("#hb-zip-form", (f) => f.classList.contains("is-open")), true, "Enter ZIP opens the one ZIP box");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("no location and the basis file fails: the card still says the ZIP works", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port, { routes: { "/data/basis-states.json": null } });
    await pg.waitForSelector("#bids-noloc", { timeout: 15000 });
    await pg.waitForFunction(() => /did not load/.test(document.querySelector("#bids-noloc .hn-out").textContent), null, { timeout: 5000 });
    assert.equal(await pg.$$eval("#bids-noloc .hn-sel", (x) => x.length), 0);
  } finally { await browser.close(); srv.close(); }
});

test("a saved ZIP never gets the no-location card", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const init = () => { try { localStorage.setItem("agsist-wx-loc", JSON.stringify({ zip: "50010", lat: 42.03, lon: -93.62, label: "Ames, IA", ts: Date.now() })); } catch (e) {} };
    const { pg } = await open(browser, port, { init });
    await pg.waitForTimeout(7500);
    assert.equal(await pg.$$eval("#bids-noloc", (x) => x.length), 0);
  } finally { await browser.close(); srv.close(); }
});

test("Also today lists the other briefing sections, and hides on a day-old briefing", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port, { width: 1280 });
    // the pure rule: titles already in the headline drop out, duplicates once, at most three
    const list = await pg.evaluate(() => window.__agsistAlsoToday(
      ["Corn and beans break lower", "Cattle firm, feeders hold", "cattle firm, feeders hold", "", "Crude holds near $99", "Fourth"],
      "Corn and beans break lower as harvest pressure builds"));
    assert.deepEqual(list, ["Cattle firm, feeders hold", "Crude holds near $99", "Fourth"]);
    // on the page: today's date on the briefing shows it, another date hides it
    const today = await pg.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date()));
    const bd = await pg.getAttribute("#daily-hero", "data-briefing-date");
    await pg.waitForTimeout(3000);
    const line = await pg.$("#teaser-also");
    if (bd === today) {
      assert.ok(line && await line.isVisible());
      assert.match(await line.textContent(), /^Also today: /);
    } else {
      assert.ok(!line || !(await line.isVisible()), "a briefing from another day shows no Also today line");
    }
  } finally { await browser.close(); srv.close(); }
});

test("phone: cot-analysis.json waits for the COT fold to open", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, seen } = await open(browser, port, { width: 390 });
    await pg.waitForTimeout(4000);
    assert.ok(seen.some((u) => u.includes("/data/cot.json")), "cot.json loads at once");
    assert.ok(!seen.some((u) => u.includes("/data/cot-analysis.json")), "cot-analysis.json not pulled with the fold closed");
    await pg.evaluate(() => { const d = document.querySelector("details.m-fold--cot"); d.open = true; document.getElementById("cot-widget").scrollIntoView(); });
    await pg.waitForFunction(() => performance.getEntriesByType("resource").some((e) => e.name.includes("/data/cot-analysis.json")), null, { timeout: 8000 });
  } finally { await browser.close(); srv.close(); }
});

test("install banner: none on desktop, built on a phone's third visit", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const desk = await open(browser, port, { width: 1280, init: () => localStorage.setItem("agsist_visits", "3") });
    await desk.pg.waitForTimeout(2500);
    assert.equal(await desk.pg.$$eval("#pwa-hint", (x) => x.length), 0);
    await desk.ctx.close();
    const ph = await open(browser, port, { init: () => localStorage.setItem("agsist_visits", "3"), ctxOpts: { ...devices["iPhone 13"] } });
    await ph.pg.waitForSelector("#pwa-hint", { state: "attached", timeout: 8000 });
    assert.equal(await ph.pg.$$eval("#pwa-modal-ios", (x) => x.length), 1);
    assert.deepEqual(ph.errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("briefing strip says Morning snapshot only for a morning stamp", () => {
  const src = readFileSync(join(ROOT, "components/home-season.js"), "utf8");
  assert.match(src, /\/\\bPM\\b\/\.test\(stamp\)\?'Snapshot, ':'Morning snapshot, '/);
});
