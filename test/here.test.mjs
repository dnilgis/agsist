/* /here: the one box and the place page (Oct 18, 2026).
 *
 *   node --test test/here.test.mjs
 *
 * The landing page is indexable with its FAQ; the page stays one shared file under the size cap;
 * and in a browser (where Playwright and Chromium exist): a ZIP, a county and a Kansas ZIP open the
 * right county with a sourced sentence, 17 fingerprint rows with a table, every This week tile filled
 * or saying why not, a role chip that reorders sections and lives in the link and on the device, a
 * neighbor link, and a county picked on the map. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const page = read("here.html");

test("landing page: indexable, canonical, title, FAQ in JSON-LD matches the visible questions", () => {
  assert.match(page, /<meta name="robots" content="index, follow/);
  assert.match(page, /<link rel="canonical"\s+href="https:\/\/agsist\.com\/here">/);
  assert.match(page, /<title>[^<]{20,70}<\/title>/);
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const faq = ld["@graph"].find((n) => n["@type"] === "FAQPage");
  const shown = [...page.matchAll(/<details><summary>([^<]+)<\/summary>/g)].map((m) => m[1]);
  assert.deepEqual(faq.mainEntity.map((q) => q.name), shown);
  assert.ok(shown.length >= 5);
  assert.match(read("sitemap.xml"), /<loc>https:\/\/agsist\.com\/here<\/loc>/);
  assert.match(read("llms.txt"), /agsist\.com\/here/);
  assert.ok(existsSync(path.join(ROOT, "data/next/here.json")));
});

test("one shared page: small, no em dashes, name only at the end, scripts versioned", () => {
  assert.ok(Buffer.byteLength(page) < 150 * 1024);
  for (const f of ["here.html", "components/here.js", "components/place.js", "components/here.css"]) assert.doesNotMatch(read(f), /—/, f);
  const top = page.replace(/<head[\s\S]*?<\/head>/, "").replace(/<p class="by-end"[\s\S]*?<\/p>/, "");
  assert.doesNotMatch(top, /Sigurd Lindquist/);
  assert.match(page, /<p class="by-end"[^>]*>Made by <a href="\/about">Sigurd Lindquist, CCA<\/a>, Chetek, Wisconsin\.<\/p>/);
  for (const s of ["place.js", "here.js", "here.css", "layers.js"]) assert.match(page, new RegExp("/components/" + s.replace(".", "\\.") + "\\?v=\\d+"), s);
  assert.match(read("sw.js"), /var CACHE_VERSION = \d+;\s*\/\/ v\d+ 2026-10-18: \/here place page/);
  assert.match(read("scripts/dev/checks.sh"), /build_place_pct\.py --check/);
});

test("the page fetches only the state's file, the county's file and the week's files, never one file per place", () => {
  const js = read("components/here.js");
  assert.match(js, /'\/data\/atlas\/pct\/' \+ st \+ '\.json'/);
  assert.match(js, /'\/data\/atlas\/counties\/' \+ fips \+ '\.json'/);
  assert.doesNotMatch(js, /data\/place\//);
  // the county map loads only on a map pick or a coordinate
  assert.equal((js.match(/getJSON\('\/data\/atlas\/counties\.geo\.json'/g) || []).length, 1);
  assert.match(js, /function geoFile\(\)/);
});

test("search offers the place page under a ZIP and under a town or county", () => {
  const js = read("components/search.js");
  assert.match(js, /placeHit\('ZIP ' \+ zip, '\/here\?zip=' \+ zip\)/);
  assert.match(js, /'\/here\?q=' \+ encodeURIComponent/);
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const GEO = {
  "54728": [{ name: "Chetek", latitude: 45.31413, longitude: -91.651, admin1: "Wisconsin", admin2: "Barron", postcodes: ["54728"] }],
  "67530": [{ name: "Great Bend", latitude: 38.36446, longitude: -98.76481, admin1: "Kansas", admin2: "Barton", postcodes: ["67530"] }],
  "Springfield": [{ name: "Springfield", latitude: 39.8, longitude: -89.64, admin1: "Illinois", admin2: "Sangamon" }, { name: "Springfield", latitude: 37.21, longitude: -93.29, admin1: "Missouri", admin2: "Greene" }],
};
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".ics": "text/calendar" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/here") p = "/here.html";
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function openPage(browser, port, url, width = 390, ctxIn = null) {
  const ctx = ctxIn || await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    if (u.includes("geocoding-api.open-meteo.com")) {
      const n = new URL(u).searchParams.get("name");
      return r.fulfill({ contentType: "application/json", body: JSON.stringify({ results: GEO[n] || [] }) });
    }
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
  return { pg, ctx, errs };
}
async function settled(pg) {
  await pg.waitForSelector("#h-place:not([hidden])", { timeout: 30000 });
  await pg.waitForFunction(() => !document.querySelector("#h-week .wk-wait"), null, { timeout: 30000 });
}

test("three places: right county, sourced sentence, fingerprint table, every tile answered", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const cases = [
      ["/here?zip=54728", "55005", "Barron County, Wisconsin", /^Barron County, WI: /, /zip=54728/],
      ["/here?q=Champaign%20County%2C%20IL", "17019", "Champaign County, Illinois", /^Champaign County, IL: /, /fips=17019/],
      ["/here?zip=67530", "20009", "Barton County, Kansas", /^Barton County, KS: /, /zip=67530/],
    ];
    for (const [url, fips, h1, sent, link] of cases) {
      for (const w of [390, 1280]) {
        const { pg, ctx, errs } = await openPage(browser, port, url, w);
        await settled(pg);
        assert.equal(await pg.textContent("#h-title"), h1, url);
        assert.match(await pg.textContent("#h-sent"), sent);
        assert.match(pg.url(), new RegExp("fips=" + fips));
        assert.match(pg.url(), link);
        assert.equal(await pg.$$eval("#h-fp button", (b) => b.length), 17);
        assert.equal(await pg.$$eval("#h-fp-t tbody tr", (r) => r.length), 17);
        const cells = await pg.$$eval("#h-fp-t tbody tr", (rows) => rows.map((r) => [...r.cells].map((c) => c.textContent)));
        for (const c of cells) {
          assert.ok(c[3].length > 5, "source cell: " + c.join(" | "));
          if (/Not available/.test(c[1])) assert.ok(c[2].length > 5, "missing figure without its reason: " + c.join(" | "));
          else assert.match(c[2], /counties|too few/);
        }
        const tiles = await pg.$$eval("#h-week .wk", (t) => t.map((x) => x.textContent));
        assert.equal(tiles.length, 6);
        for (const t of tiles) assert.ok(!/Reading/.test(t) && t.length > 30, t);
        const scrollW = await pg.evaluate(() => document.documentElement.scrollWidth);
        assert.ok(scrollW <= w + 1, "no sideways scroll at " + w + ": " + scrollW);
        assert.deepEqual(errs, []);
        await ctx.close();
      }
    }
  } finally { await browser.close(); srv.close(); }
});

test("role chips reorder the sections, add the tool, and stick in the link and on the device", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 900 } });
    let { pg, errs } = await openPage(browser, port, "/here?fips=55005", 390, ctx);
    await settled(pg);
    const order = () => pg.$$eval("#h-sections > section", (s) => s.map((x) => x.id.replace("h-sec-", "")));
    assert.deepEqual(await order(), ["week", "fingerprint", "unusual", "long"]);
    assert.ok(await pg.$eval("#h-tool", (e) => e.hidden));
    await pg.click('#h-roles button[data-role="landowner"]');
    assert.deepEqual(await order(), ["fingerprint", "unusual", "long", "week"]);
    assert.equal(await pg.getAttribute("#h-tool a", "href"), "/farmland-atlas/sheet#55005");
    assert.match(pg.url(), /for=landowner/);
    await pg.click('#h-roles button[data-role="adjuster"]');
    assert.match(await pg.getAttribute("#h-tool a", "href"), /^\/hail-map\?lat=/);
    await pg.close();
    // the device remembers the chip on a link without &for=
    ({ pg, errs } = await openPage(browser, port, "/here?fips=17019", 390, ctx));
    await settled(pg);
    assert.equal(await pg.getAttribute('#h-roles button[data-role="adjuster"]', "aria-pressed"), "true");
    assert.deepEqual(await order(), ["week", "long", "fingerprint", "unusual"]);
    // a neighbor link opens that county in place
    await pg.click("#h-nb a[data-fips]");
    await pg.waitForFunction(() => !/Champaign/.test(document.getElementById("h-title").textContent), null, { timeout: 20000 });
    assert.match(await pg.textContent("#h-title"), /County, (Illinois)$/);
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("the box: two Springfields ask, a county typed opens, the map picks a county", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, ctx, errs } = await openPage(browser, port, "/here", 1280);
    assert.ok(await pg.$eval("#h-place", (e) => e.hidden));
    await pg.fill("#h-q", "Springfield");
    await pg.click("#h-form button[type=submit]");
    await pg.waitForSelector("#h-choices button");
    assert.equal(await pg.$$eval("#h-choices button", (b) => b.length), 2);
    await pg.click("#h-choices button:nth-child(2)");
    await settled(pg);
    assert.equal(await pg.textContent("#h-title"), "Greene County, Missouri");
    await pg.fill("#h-q", "Nowhere County, IA");
    await pg.click("#h-form button[type=submit]");
    await pg.waitForFunction(() => /No county called/.test(document.getElementById("h-status").textContent));
    await pg.click("#h-map-box summary");
    await pg.waitForSelector('#h-map path[data-fips="29077"].cur', { timeout: 30000 });
    await pg.click('#h-map path[data-fips="29109"]', { force: true });
    await pg.waitForFunction(() => document.getElementById("h-title").textContent === "Lawrence County, Missouri", null, { timeout: 20000 });
    assert.match(pg.url(), /fips=29109/);
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
