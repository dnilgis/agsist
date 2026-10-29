/* Consolidation round 2 (Sig, Oct 29, 2026: "1 yes, 2 yes, 3 yes").
 *   1. The menu goes from 63 lines to 57, plus Ag stocks: PRF, LRP and Rain Print once; no Cash Bid
 *      Index or Illinois sale index line; the two crop report lines in one; drought and manure under
 *      Field. Every copy: the live header (desktop panel and phone panel), the no-script header, the
 *      footer and its no-script copy, the menu table and the header baked into every page.
 *   2. /farmland-index is a section of /land-sales/ and 3. /data-sources a section of
 *      /editorial-standards (the stubs and links: test/merges-oct22.test.mjs).
 *   4. menu_click {group, label, menu} from the live menu, and readers per page (data/audience-pages.json).
 *
 *   node --test test/menutrim-oct29.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const header = read("components/header.html");
const desk = header.slice(header.indexOf('<div class="nav-menu">'), header.indexOf('<div class="nav-actions">'));
const drawer = header.slice(header.indexOf('<div class="drawer" id="drawer"'));
const count = (s, href) => (s.match(new RegExp(`href="${href.replace(/[/]/g, "\\/")}"`, "g")) || []).length;
const part = (s, from, to) => { const a = s.indexOf(from); assert.ok(a >= 0, from); const b = s.indexOf(to, a + from.length); return s.slice(a, b < 0 ? undefined : b); };

test("the live menu: PRF, LRP and Rain Print once, the dropped lines gone, Ag stocks under Futures", () => {
  for (const [name, s] of [["desktop", desk], ["phone", drawer]]) {
    for (const h of ["/prf", "/lrp", "/rain-print", "/drought-monitor", "/manure-value", "/conditions", "/ag-stocks"]) assert.equal(count(s, h), 1, `${name}: ${h} once`);
    for (const h of ["/cash-bid-index", "/farmland-index", "/usda-quick-stats"]) assert.equal(count(s, h), 0, `${name}: no ${h} line`);
    assert.match(s, /Crop progress, size and yield<\/a>/, `${name}: one crop report line`);
  }
  // drought and manure sit under Field, beside the hail map and nutrient removal
  assert.match(part(desk, 'id="dd-field"', '<div class="nav-dd"'), /href="\/hail-map"[^]*?Hail map<\/a>\s*<a href="\/drought-monitor"[^]*?href="\/nutrient-removal"[^]*?Nutrient removal<\/a>\s*<a href="\/manure-value"/);
  assert.match(part(drawer, 'id="dg-field"', "</section>"), /href="\/hail-map"[^]*?Hail map<\/a>\s*<a href="\/drought-monitor"[^]*?href="\/nutrient-removal"[^]*?Nutrient removal<\/a>\s*<a href="\/manure-value"/);
  assert.doesNotMatch(part(desk, 'id="dd-livestock"', '<div class="nav-dd"'), /drought-monitor|manure-value/);
  // PRF and LRP stay under Livestock; Money & Land keeps ARC or PLC and the farm bill
  assert.match(part(drawer, 'id="dg-livestock"', "</section>"), /href="\/lrp"[^]*href="\/prf"/);
  assert.doesNotMatch(part(drawer, 'id="dg-money"', "</section>"), /href="\/(prf|lrp)"/);
  // Ag stocks right after Wheat, in both
  assert.match(desk, /Wheat<\/a>\s*<a href="\/ag-stocks"><svg[^>]*><use href="#i-trending-up"\/><\/svg>Ag stocks<\/a>/);
  assert.match(drawer, /Wheat<\/a>\s*<a href="\/ag-stocks" class="draw-item"><svg[^>]*><use href="#i-trending-up"\/><\/svg>Ag stocks<\/a>/);
  // the phone panel keeps its Rain Print card; the plain Field line is the copy that went
  assert.match(drawer, /<a href="\/rain-print" class="draw-rp">/);
  assert.equal((drawer.match(/class="draw-item[^"]*"|class="draw-rp"/g) || []).length, 58, "63 lines to 57, plus Ag stocks");
  assert.ok(existsSync(join(ROOT, "ag-stocks.html")));
});

test("the no-script header, the footer, its no-script copy and the menu table say the same", () => {
  const fb = read("components/header-fallback.html");
  assert.match(fb, /<a href="\/wheat-futures-prices">Wheat<\/a> · <a href="\/ag-stocks">Ag stocks<\/a>/);
  assert.match(fb, /<a href="\/conditions">Crop progress, size and yield<\/a>/);
  assert.match(fb, /<a href="\/hail-map">Hail map<\/a> · <a href="\/drought-monitor">Drought monitor<\/a>/);
  assert.match(fb, /<a href="\/nutrient-removal">Nutrient removal<\/a> · <a href="\/manure-value">Manure value<\/a>/);
  for (const h of ["/cash-bid-index", "/farmland-index", "/usda-quick-stats"]) assert.equal(count(fb, h), 0, "header-fallback " + h);
  const f = read("components/footer.html"), ff = read("components/footer-fallback.html");
  for (const [n, s] of [["footer", f], ["footer-fallback", ff]]) {
    for (const h of ["/cash-bid-index", "/farmland-index", "/usda-quick-stats"]) assert.equal(count(s, h), 0, `${n}: ${h}`);
    for (const h of ["/prf", "/lrp", "/rain-print", "/drought-monitor", "/manure-value"]) assert.equal(count(s, h), 1, `${n}: ${h} once`);
    assert.match(s, /Crop progress, size and yield<\/a>/, n);
  }
  assert.match(f, /<p class="footer-band-rp"><a href="\/rain-print">/, "the footer's Rain Print line is the band");
  const g = read("scripts/dev/nav/gen_nav.py");
  assert.match(g, /\("\/ag-stocks", "Ag stocks", "i-trending-up"\)/);
  assert.match(g, /\("\/conditions", "Crop progress, size and yield", "i-sun"\)/);
  assert.doesNotMatch(g.slice(0, g.indexOf("SIGNUP = ")), /"\/cash-bid-index"|"\/farmland-index"|"\/usda-quick-stats"/, "the menu table");
  // a reader still reaches both pages that left the menu, from the page beside them
  assert.match(read("basis.html"), /<a href="\/cash-bid-index">AGSIST Cash Bid Index<\/a>/);
  assert.match(read("conditions.html"), /<a href="\/usda-quick-stats">yield by state<\/a>/);
  assert.match(execFileSync("python3", ["scripts/inject_static_nav.py", "--check"], { cwd: ROOT, encoding: "utf8" }), /^OK:/);
});

test("every page with a baked static header carries the new menu", () => {
  let n = 0;
  const bad = [];
  const walk = (d) => {
    for (const f of readdirSync(join(ROOT, d || "."))) {
      if (f.startsWith(".") || f === "node_modules" || f === "test") continue;
      const p = d ? d + "/" + f : f;
      if (statSync(join(ROOT, p)).isDirectory()) walk(p);
      else if (f.endsWith(".html")) {
        const t = read(p), i = t.indexOf("<!-- static-nav:header");
        if (i < 0) continue;
        const blk = t.slice(i, t.indexOf("<!-- /static-nav:header -->", i));
        if (!blk.includes('<a href="/ag-stocks">Ag stocks</a>') || /href="\/(cash-bid-index|farmland-index|usda-quick-stats)"/.test(blk)) bad.push(p);
        n++;
      }
    }
  };
  walk("");
  assert.deepEqual(bad.slice(0, 5), [], bad.length + " baked headers out of date");
  assert.ok(n > 4800, "baked headers: " + n);
});

test("the data sources section on the editorial standards keeps what readers need, in one short list", () => {
  const h = read("editorial-standards.html");
  const sec = part(h, '<h2 id="sources">', '<h2 id="independence">');
  assert.match(sec, /10-minute exchange delay/);
  assert.match(sec, /about 10 to 25 minutes old while markets trade/);
  for (const s of ["Yahoo Finance", "bid board", "National Weather Service", "PRISM", "Windy", "Drought Monitor", "MRMS", "Iowa Environmental Mesonet", "CFTC",
    "AgTransport", "NASS", "RMA", "FSA", "FAS", "NCEI", "Climate Prediction Center", "EIA", "Sentinel", "Polymarket", "OpenStreetMap", "Google Analytics"])
    assert.ok(sec.includes(s), s);
  // the old page's anchors land on their line (#open-meteo is the weather line; Oct 29, 2026 it names the
  // National Weather Service and PRISM, which replaced Open-Meteo in #188 to #193)
  for (const id of ["yahoo", "cash-bids", "open-meteo", "cftc", "nass", "polymarket"]) assert.ok(sec.includes(`id="${id}"`), "#" + id);
  assert.ok((sec.match(/<li/g) || []).length <= 16, "one short list, not the inner workings");
  assert.doesNotMatch(sec, /yfinance|Cloudflare Worker|Gamma API|cron|\.py\b|—|&mdash;/, "no recipe, no em dash");
});

test("readers per page: every page with traffic, 28 and 90 days, in its own file (selftest)", () => {
  // the selftest builds real GA4 request objects, so the PR test job installs the same GA4 client
  // as the sponsor-report job (it failed on #186 with no google package there)
  const pin = (read(".github/workflows/sponsor-report.yml").match(/google-analytics-data==[\d.]+ google-auth==[\d.]+/) || [])[0];
  assert.ok(pin, "sponsor-report pins the GA4 client");
  for (const job of ["node-tests:", "other-checks:"]) {
    const y = read(".github/workflows/pr-checks.yml"), s = y.slice(y.indexOf("\n  " + job));
    assert.ok(s.slice(0, s.indexOf("checks.sh")).includes(pin), job + " installs " + pin);
  }
  const out = execFileSync("python3", ["scripts/build_audience.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /selftest passed/);
  for (const s of ["90 days never under 28 days for the same page", "every page with a reader, users and views", "data/audience.json points at the file and stays small"])
    assert.ok(out.includes("ok    " + s), s);
  assert.match(read(".github/workflows/sponsor-report.yml"), /git add [^\n]*data\/audience-pages\.json/);
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index";
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("menu_click: a tap on a menu link sends its group and name, desktop and phone", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  // the page's own gtag() queues every call on window.dataLayer (GA itself stays off under a test
  // browser); keep the page where it is, so the test reads what a click sent
  const init = () => {
    document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest("a[href]"); if (a) e.preventDefault(); }, true);
  };
  try {
    for (const [w, h] of [[1280, 900], [390, 844]]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: h } });
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      await ctx.addInitScript(init);
      const pg = await ctx.newPage();
      await pg.goto(base + "/about");
      const got = async () => pg.evaluate(() => (window.dataLayer || []).map((x) => Array.from(x)).filter((x) => x[0] === "event" && x[1] === "menu_click").map((x) => x[2]));
      if (w === 1280) {
        await pg.waitForSelector("#dd-markets .nav-btn", { state: "visible", timeout: 15000 });
        await pg.click("#dd-markets .nav-btn");
        await pg.click('#dd-markets-panel a[href="/ag-stocks"]');
        await pg.click("#dd-livestock .nav-btn");
        await pg.click('#dd-livestock-panel a[href="/haymow"]');
        const ev = await got();
        assert.deepEqual(ev.map((e) => [e.menu, e.group, e.label]), [["desktop", "Prices", "Ag stocks"], ["desktop", "Livestock", "The Haymow"]]);
        assert.equal(ev[0].transport_type, "beacon");
        assert.deepEqual(Object.keys(ev[0]).sort(), ["group", "label", "menu", "transport_type"], "nothing else about the reader");
      } else {
        await pg.waitForSelector("#hamburger", { state: "visible", timeout: 15000 });
        await pg.click("#hamburger");
        await pg.waitForFunction(() => document.getElementById("drawer").classList.contains("open"));
        await pg.click('#drawer a.draw-item[href="/drought-monitor"]');
        await pg.click("#drawer a.draw-rp");
        await pg.click("#dp-bids");
        await pg.click('#drawer .draw-end a[href="/contact"]');
        const ev = await got();
        assert.deepEqual(ev.map((e) => [e.menu, e.group, e.label]), [["phone", "Field", "Drought monitor"], ["phone", "Rain Print card", "Rain Print"],
          ["phone", "My place", "Bids near me"], ["phone", "More", "Contact"]]);
        assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= 390), "no sideways scroll");
      }
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
