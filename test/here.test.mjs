/* The place page (Oct 18, 2026), on Fast Facts since Oct 21: /here is a redirect stub to
 * /fast-facts that keeps the query and the #part, and the box, the cards, the depth and the
 * printed report live on the My place and Print tabs.
 *
 *   node --test test/here.test.mjs
 *
 * In a browser (where Playwright and Chromium exist): a ZIP, a county and a Kansas ZIP open the
 * right county with a sourced sentence, every card row answered or saying why, 17 fingerprint
 * rows with a table once "More about this county" opens, one fixed order and one go deeper row
 * for everyone (an old &for= link still opens and drops the param), a print panel whose choices
 * change the printed sheet and live in the link, a Letter PDF, a neighbor link, and a county
 * picked on the map. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const stub = read("here.html"), page = read("fast-facts.html");

test("/here is the site's redirect stub to /fast-facts, keeping the query and the #part", () => {
  assert.ok(Buffer.byteLength(stub) < 1536, "stub under 1.5 KB: " + Buffer.byteLength(stub));
  assert.match(stub, /<meta name="robots" content="noindex,follow">/);
  assert.match(stub, /<link rel="canonical" href="https:\/\/agsist\.com\/fast-facts">/);
  assert.match(stub, /<meta http-equiv="refresh" content="0; url=\/fast-facts">/);
  assert.match(stub, /location\.replace\("\/fast-facts"\+location\.search\+location\.hash\)/);
  assert.match(page, /<link rel="canonical" href="https:\/\/agsist\.com\/fast-facts">/);
  assert.match(page, /<meta name="robots" content="index, follow/);
  assert.match(read("sitemap.xml"), /<loc>https:\/\/agsist\.com\/fast-facts<\/loc>/);
  assert.doesNotMatch(read("sitemap.xml"), /<loc>https:\/\/agsist\.com\/here<\/loc>/);
  assert.match(read("llms.txt"), /agsist\.com\/fast-facts/);
  assert.doesNotMatch(read("llms.txt"), /agsist\.com\/here\b/);
  assert.ok(existsSync(path.join(ROOT, "data/next/fast-facts.json")) && !existsSync(path.join(ROOT, "data/next/here.json")));
  assert.match(read("scripts/inject_static_nav.py"), /"\/fastfacts", "\/here"[,)]/, "/here on the nav check's retired list");
});

test("the place code on Fast Facts: no em dashes, name only at the end, scripts versioned", () => {
  for (const f of ["components/here.js", "components/place.js", "components/here.css"]) assert.doesNotMatch(read(f), /—/, f);
  for (const s of ["place.js", "here.js", "here.css", "layers.js"]) assert.match(page, new RegExp("/components/" + s.replace(".", "\\.") + "\\?v=\\d+"), s);
  assert.match(read("sw.js"), /v\d+ 2026-10-18: \/here place page/);
  assert.match(read("sw.js"), /v\d+ 2026-10-21: fx\/fastfacts/);
  assert.match(read("scripts/dev/checks.sh"), /build_place_pct\.py --check/);
  // Analytics gets the bare path: a place link carries a ZIP
  assert.match(page, /gtag\('config','G-6KXCTD5Z9H',\{page_location:location\.origin\+location\.pathname,/);
});

test("no role chips anywhere: markup, scripts, styles; the print panel", () => {
  for (const f of ["fast-facts.html", "components/here.js", "components/place.js", "components/here.css"]) {
    const t = read(f);
    assert.doesNotMatch(t, /h-roles|data-role|here_role|agsist-here-for|P\.ROLES|P\.order\(|P\.tool\(|role buttons|I am a\b/i, f);
    assert.doesNotMatch(t, /Lender or Appraiser|Elevator or Plant|Buyer or Seller/, f);
  }
  // the print options: one checkbox per part, all ticked; the rain drawing and More detail unticked; a Print button
  const parts = [...page.matchAll(/<input type="checkbox" name="part" value="([a-z]+)" checked>/g)].map((m) => m[1]);
  assert.deepEqual(parts, ["sentence", "week", "fingerprint", "unusual", "long", "sources"]);
  assert.match(page, /<input type="checkbox" id="h-pr-more">/);
  assert.match(page, /<input type="checkbox" id="h-pr-rain">/);
  assert.match(page, /id="h-pr-go" class="h-pr-go">[\s\S]{0,80}Print<\/button>/);
  assert.match(page, /\/components\/qr\.js\?v=\d+/);
  assert.match(page, /\/components\/print-sheet\.js\?v=\d+/);
  // the one printed format (components/print-sheet.js): Letter, the running title and "Page n of N" on every page
  const sheet = read("components/print-sheet.js"), css = read("components/print-sheet.css");
  assert.match(sheet, /@page\{size:letter/);
  assert.match(sheet, /counter\(page\) " of " counter\(pages\)/);
  assert.match(sheet, /@bottom-left\{content:"AGSIST/);
  // nothing under 9pt in print, on the sheet or the page
  for (const t of [read("components/here.css"), css]) {
    const pr = t.slice(t.indexOf("@media print{"));
    for (const m of pr.matchAll(/font-size:([\d.]+)pt/g)) assert.ok(+m[1] >= 9, "print font " + m[0]);
    for (const m of pr.matchAll(/font:[^;]*?([\d.]+)pt/g)) assert.ok(+m[1] >= 9, "print font " + m[0]);
  }
});

test("the page fetches only the state's file, the county's file and the shared files, never one file per place", () => {
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
  assert.match(js, /placeHit\('ZIP ' \+ zip, '\/fast-facts\?zip=' \+ zip\)/);
  assert.match(js, /'\/fast-facts\?q=' \+ encodeURIComponent/);
  assert.doesNotMatch(js, /'\/here\?/);
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
    if (p === "/here" || p === "/fast-facts") p = p + ".html";
    // data/site-notice.json is Sig's outage switch (components/loader.js siteNotice): its bar, fixed over the bottom of
    // the screen, comes and goes with the live file. These tests are about the page under it, so they see no notice
    // (no file is the documented off state) and pass or fail the same whichever way the switch is set.
    if (p === "/data/site-notice.json") { res.writeHead(404); res.end(); return; }
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
  // the place may open under another tab (a shared Print link), so wait on the attribute, not on visibility
  await pg.waitForFunction(() => !document.getElementById("h-place").hidden, null, { timeout: 30000 });
  await pg.waitForFunction(() => !document.querySelector("#h-sec-week .fx-wait") && [...document.querySelectorAll("#h-sec-week .fx-w")].every((w) => w.firstChild), null, { timeout: 30000 });
}
async function more(pg) {
  await pg.click("#h-more summary");
  await pg.waitForFunction(() => document.querySelectorAll("#h-fp-t tbody tr").length > 0, null, { timeout: 20000 });
}

test("three places: right county, sourced sentence, fingerprint table, every tile answered", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const cases = [
      ["/fast-facts?zip=54728", "55005", "Barron County, Wisconsin", /^Barron County, WI: /, /zip=54728/],
      ["/fast-facts?q=Champaign%20County%2C%20IL", "17019", "Champaign County, Illinois", /^Champaign County, IL: /, /fips=17019/],
      ["/fast-facts?zip=67530", "20009", "Barton County, Kansas", /^Barton County, KS: /, /zip=67530/],
    ];
    for (const [url, fips, h1, sent, link] of cases) {
      for (const w of [390, 1280]) {
        const { pg, ctx, errs } = await openPage(browser, port, url, w);
        await settled(pg);
        assert.equal(await pg.textContent("#h-title"), h1, url);
        assert.match(await pg.textContent("#h-sent"), sent);
        assert.match(pg.url(), new RegExp("fips=" + fips));
        assert.match(pg.url(), link);
        // every card row: a value, or Not available and why; and a date or a source
        const rows = await pg.$$eval("#h-sec-week .fx-row", (r) => r.map((x) => [x.id, x.querySelector(".fx-w").textContent]));
        assert.ok(rows.length >= 15, "rows: " + rows.length);
        for (const [id, t] of rows) {
          assert.ok(t.length > 12, id + ": " + t);
          if (/^Not available/.test(t)) assert.match(t, /^Not available\. [A-Z].{8,}/, id + " says why: " + t);
        }
        await more(pg);
        assert.equal(await pg.$$eval("#h-fp button", (b) => b.length), 17);
        assert.equal(await pg.$$eval("#h-fp-t tbody tr", (r) => r.length), 17);
        const cells = await pg.$$eval("#h-fp-t tbody tr", (rows) => rows.map((r) => [...r.cells].map((c) => c.textContent)));
        for (const c of cells) {
          assert.ok(c[3].length > 5, "source cell: " + c.join(" | "));
          if (/Not available/.test(c[1])) assert.ok(c[2].length > 5, "missing figure without its reason: " + c.join(" | "));
          else assert.match(c[2], /counties|too few/);
        }
        const scrollW = await pg.evaluate(() => document.documentElement.scrollWidth);
        assert.ok(scrollW <= w + 1, "no sideways scroll at " + w + ": " + scrollW);
        assert.deepEqual(errs, []);
        await ctx.close();
      }
    }
  } finally { await browser.close(); srv.close(); }
});

test("one order for everyone; an old &for= link opens normally and drops the param; go deeper row", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("agsist-here-for", "adjuster"); } catch (e) {} });
    // an old /here link: the stub forwards it with its query
    let { pg, errs } = await openPage(browser, port, "/here?zip=54728&for=landowner", 390, ctx);
    await pg.waitForURL((u) => u.pathname === "/fast-facts", { timeout: 10000 });
    await settled(pg);
    await more(pg);
    const order = () => pg.$$eval("#h-sec-week, #h-sections > section.h-sec:not(.h-elev)", (s) => s.map((x) => x.id.replace("h-sec-", "")));
    assert.equal(await pg.textContent("#h-title"), "Barron County, Wisconsin");
    assert.deepEqual(await order(), ["week", "fingerprint", "unusual", "long"]);
    assert.doesNotMatch(pg.url(), /for=/);
    assert.match(pg.url(), /\/fast-facts\?fips=55005&zip=54728/);
    assert.equal(await pg.$("#h-roles"), null);
    assert.equal(await pg.$("[data-role]"), null);
    assert.doesNotMatch(await pg.textContent("main"), /I am a|role/i);
    for (const id of ["week", "fingerprint", "unusual", "long"]) assert.ok(await pg.$eval("#h-sec-" + id, (e) => e.offsetHeight > 0), id);
    assert.ok(await pg.$eval("#h-sec-week", (w) => w.compareDocumentPosition(document.querySelector("#h-sections")) & 4), "the cards come before the depth");
    // the bids come first on a phone: the summary box sits under the four cards (farmer, Oct 21)
    assert.ok(await pg.$eval("#h-sec-week", (w) => w.compareDocumentPosition(document.querySelector("#h-part-sentence")) & 4), "the cards come before the summary");
    const deep = await pg.$$eval("#h-links a", (a) => a.map((x) => [x.dataset.k, x.getAttribute("href")]));
    const k = Object.fromEntries(deep);
    assert.match(k.scout, /^\/field-scout\?at=45\.\d{4},-91\.\d{4}&fips=55005$/);
    assert.equal(k.bids, "/cash-bids?zip=54728");
    assert.match(k.hail, /^\/hail-map\?lat=/);
    assert.equal(k.sheet, "/farmland-atlas/sheet#55005");
    assert.equal(k.data, undefined, "no Data downloads in a place's links (tone, Oct 21)");
    // Wisconsin has recorded sales on the site: the comparable sales report joins the row once its index answers
    await pg.waitForSelector('#h-links a[data-k="comps"]', { timeout: 15000 });
    // the device kept nothing: no role key written
    assert.equal(await pg.evaluate(() => localStorage.getItem("agsist-here-for")), "adjuster");
    await pg.close();
    // Kansas: no recorded sales file, so no comparable sales link
    ({ pg, errs } = await openPage(browser, port, "/fast-facts?zip=67530", 390, ctx));
    await settled(pg);
    await pg.waitForTimeout(800);
    assert.equal(await pg.$('#h-links a[data-k="comps"]'), null);
    // a neighbor link opens that county in place
    await pg.click("#h-nb a[data-fips]");
    await pg.waitForFunction(() => !/Barton/.test(document.getElementById("h-title").textContent), null, { timeout: 20000 });
    assert.match(await pg.textContent("#h-title"), /County, Kansas$/);
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("print: one button, the options drop parts from the shared sheet, the link carries them, two Letter pages", { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, ctx, errs } = await openPage(browser, port, "/fast-facts?zip=54728", 1280);
    await settled(pg);
    await pg.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
    const shown = (sel) => pg.$eval(sel, (e) => { const s = getComputedStyle(e); return s.display !== "none" && e.getBoundingClientRect().height > 0; });
    // Print is a button beside Change place; the options fold under it; every part ticked but the rain drawing and the years
    assert.ok(await shown("#h-pr-go"));
    assert.equal(await pg.$eval("#h-pr-box", (d) => d.open), false);
    await pg.click("#h-pr-box summary");
    assert.equal(await pg.$$eval("#h-pr-box input[name=part]:checked", (i) => i.length), 6);
    assert.equal(await pg.$eval("#h-pr-rain", (i) => i.checked), false);
    assert.equal(await pg.$eval("#h-pr-more", (i) => i.checked), false);
    await pg.click("#h-pr-go");
    await pg.waitForFunction(() => window.__printed === 1, null, { timeout: 15000 });
    await pg.emulateMedia({ media: "print" });
    // on paper: the sheet only; the page, its tabs and its buttons stay off
    assert.ok(await shown("#agps"));
    for (const sel of ["#place", ".fx-tabs", "#tables", ".fx-top"]) assert.equal(await shown(sel), false, sel);
    const heads = await pg.$$eval("#agps h2", (h) => h.map((x) => x.textContent));
    assert.deepEqual(heads, ["Price", "Field", "Land and programs", "Today", "How it ranks among Wisconsin counties", "Against its neighbors", "The long view", "Sources"]);
    assert.equal(await pg.textContent("#agps .agps-title"), "Barron County, Wisconsin");
    const text = await pg.textContent("#agps");
    // only rows that show, no link words, no fail-soft notes, no Daily (a morning letter) on paper (lender, Oct 21)
    for (const bad of [/See the bids near here/, /Read the Daily/, /Try again/, /not in right now/, /did not answer/, /Not available/, /This morning/]) assert.doesNotMatch(text, bad);
    assert.ok(!(await pg.$("#agps .agps-rain")), "no rain drawing unless chosen");
    // every printed row carries its date and source; the sources list has every source printed, each with its date
    const cells = await pg.$$eval("#agps .agps-cell", (c) => c.map((x) => x.textContent));
    assert.ok(cells.length >= 25, "rows: " + cells.length);
    const srcs = await pg.$$eval("#agps .agps-srcs li", (l) => l.map((x) => x.textContent));
    for (const name of ["Posted elevator bids", "CBOT futures, delayed", "U.S. Drought Monitor", "USDA NASS Crop Progress", "Co-op posted prices"]) assert.ok(srcs.some((t) => t.startsWith(name + ", ")), name + " in the sources with a date: " + srcs.join(" | "));
    assert.match(await pg.textContent("#agps .agps-url"), /^agsist\.com\/H\/55005\/54728$/);
    assert.ok(await pg.$("#agps .agps-qr svg path"));
    assert.match(await pg.textContent("#agps .agps-prep"), /^Prepared by AGSIST \(agsist\.com\), printed [A-Z][a-z]{2} \d+, 20\d\d$/);
    const pdf = await pg.pdf({ format: "Letter", printBackground: true, preferCSSPageSize: true });
    const raw = pdf.toString("latin1");
    assert.ok(/\/MediaBox\s*\[\s*0 0 612 792\s*\]/.test(raw), "Letter pages");
    assert.equal((raw.match(/\/Type\s*\/Page[^s]/g) || []).length, 2, "the default sheet is two pages");
    await pg.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await pg.emulateMedia({ media: "screen" });
    assert.equal(await pg.evaluate(() => document.documentElement.classList.contains("agps-on")), false, "the page is the page again");
    // untick the cards and the long view, tick More detail and the rain drawing: the link carries it, the sheet follows
    await pg.uncheck('#h-pr-box input[value="week"]');
    await pg.uncheck('#h-pr-box input[value="long"]');
    await pg.check("#h-pr-more");
    assert.match(pg.url(), /print=sentence,fingerprint,unusual,sources,more/);
    await pg.check("#h-pr-rain");
    assert.match(pg.url(), /print=sentence,fingerprint,unusual,sources,more,rain/);
    await pg.click("#h-pr-go");
    await pg.waitForFunction(() => window.__printed === 2, null, { timeout: 20000 });
    const heads2 = await pg.$$eval("#agps h2", (h) => h.map((x) => x.textContent));
    assert.ok(!heads2.includes("Price") && !heads2.includes("The long view"), heads2.join(", "));
    assert.ok(heads2.includes("How it ranks among Wisconsin counties"));
    if (await pg.evaluate(() => !!(window.AgHere.state.fig))) assert.ok(await pg.$("#agps .agps-rain svg"), "the rain drawing when chosen");
    await pg.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    // Ctrl+P prints the same sheet
    await pg.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    assert.equal(await pg.evaluate(() => document.documentElement.classList.contains("agps-on")), true);
    await pg.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    // a shared link opens My place with the same choices
    const shared = pg.url().replace(/^https?:\/\/[^/]+/, "");
    const b2 = await openPage(browser, port, shared, 1280);
    await settled(b2.pg);
    assert.equal(await b2.pg.evaluate(() => document.documentElement.getAttribute("data-fx")), "place");
    assert.equal(await b2.pg.$eval('#h-pr-box input[value="week"]', (i) => i.checked), false);
    assert.equal(await b2.pg.$eval("#h-pr-more", (i) => i.checked), true);
    assert.equal(await b2.pg.$eval("#h-pr-rain", (i) => i.checked), true);
    assert.deepEqual(b2.errs, []);
    await b2.ctx.close();
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("the box: two Springfields ask, a county typed opens, the map picks a county", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, ctx, errs } = await openPage(browser, port, "/fast-facts#place", 1280);
    assert.ok(await pg.$eval("#h-place", (e) => e.hidden));
    await pg.fill("#h-q", "Springfield");
    await pg.click("#h-form button[type=submit]");
    await pg.waitForSelector("#h-choices button");
    assert.equal(await pg.$$eval("#h-choices button", (b) => b.length), 2);
    await pg.click("#h-choices button:nth-child(2)");
    await settled(pg);
    assert.equal(await pg.textContent("#h-title"), "Greene County, Missouri");
    await pg.click("#h-change");
    await pg.fill("#h-q", "Nowhere County, IA");
    await pg.click("#h-form button[type=submit]");
    await pg.waitForFunction(() => /No county called/.test(document.getElementById("h-status").textContent));
    // a failed lookup leaves the box open, the place still showing under it
    assert.equal(await pg.$eval("#h-find", (e) => e.hidden), false);
    await pg.click("#h-map-box summary");
    await pg.waitForSelector('#h-map path[data-fips="29077"].cur', { timeout: 30000 });
    await pg.click('#h-map path[data-fips="29109"]', { force: true });
    await pg.waitForFunction(() => document.getElementById("h-title").textContent === "Lawrence County, Missouri", null, { timeout: 20000 });
    assert.match(pg.url(), /fips=29109/);
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
