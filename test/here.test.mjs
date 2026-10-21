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
  assert.match(read("scripts/inject_static_nav.py"), /"\/fastfacts", "\/here"\)/, "/here on the nav check's retired list");
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
  // the print panel: one checkbox per part, all ticked, More detail unticked, a Print button
  const parts = [...page.matchAll(/<input type="checkbox" name="part" value="([a-z]+)" checked>/g)].map((m) => m[1]);
  assert.deepEqual(parts, ["sentence", "week", "fingerprint", "unusual", "long", "sources"]);
  assert.match(page, /<input type="checkbox" id="h-pr-more">/);
  assert.match(page, /id="h-pr-go">Print</);
  assert.match(page, /\/components\/qr\.js\?v=\d+/);
  const css = read("components/here.css");
  assert.match(css, /@page\{size:letter/);
  assert.match(css, /counter\(page\) " of " counter\(pages\)/);
  assert.match(css, /@bottom-left\{content:"agsist\.com\/fast-facts"/);
  // nothing under 9pt in print
  const pr = css.slice(css.indexOf("@media print{"));
  for (const m of pr.matchAll(/font-size:([\d.]+)pt/g)) assert.ok(+m[1] >= 9, "print font " + m[0]);
  for (const m of pr.matchAll(/font:[^;]*?([\d.]+)pt/g)) assert.ok(+m[1] >= 9, "print font " + m[0]);
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
    const deep = await pg.$$eval("#h-links a", (a) => a.map((x) => [x.dataset.k, x.getAttribute("href")]));
    const k = Object.fromEntries(deep);
    assert.match(k.scout, /^\/field-scout\?at=45\.\d{4},-91\.\d{4}&fips=55005$/);
    assert.equal(k.bids, "/cash-bids?zip=54728");
    assert.match(k.hail, /^\/hail-map\?lat=/);
    assert.equal(k.sheet, "/farmland-atlas/sheet#55005");
    assert.equal(k.data, "/developer");
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

test("print report: the panel drops parts from the printed sheet, More detail prints the tables, the link carries it, Letter PDF", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, ctx, errs } = await openPage(browser, port, "/fast-facts?zip=54728", 1280);
    await settled(pg);
    await pg.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
    await pg.click("#fx-t-print");
    const shown = (sel) => pg.$eval(sel, (e) => { const s = getComputedStyle(e); return s.display !== "none" && e.getBoundingClientRect().height > 0; });
    // on screen the printed cover stays hidden; the Print tab shows the panel for the open place
    assert.equal(await shown("#h-pr-cover"), false);
    assert.ok(await shown("#h-pr-box"));
    assert.equal(await pg.textContent("#h-pr-name"), "Barron County, Wisconsin");
    assert.match(pg.url(), /#print$/);
    assert.equal(await pg.$eval("#h-pr-box input[name=part]:checked", () => true), true);
    assert.equal(await pg.$$eval("#h-pr-box input[name=part]:checked", (i) => i.length), 6);
    // print media with everything ticked: cover, the cards, unusual, long, sources; the full tables stay out
    await pg.evaluate(() => window.AgHere.loadDepth());
    await pg.evaluate(() => window.AgHere.beforePrint());
    await pg.emulateMedia({ media: "print" });
    for (const s of ["#h-pr-cover", ".pc-sent", ".pc-tiles", ".pd", ".pc-qr svg", "#h-sec-week", "#h-sec-unusual", "#h-sec-long", "#h-part-sources"]) assert.ok(await shown(s), s);
    for (const s of ["#h-pr-box", ".h-deep", "#h-form", "#h-sec-fingerprint", "#h-part-sentence", ".fx-tabs", "#tables", "#state"]) assert.equal(await shown(s), false, s);
    assert.equal(await pg.$$eval(".pd-r:not(.pd-ax)", (r) => r.length), 17);
    assert.equal(await pg.$$eval(".pc-t", (t) => t.length), 6);
    for (const t of await pg.$$eval(".pc-t .pc-s", (x) => x.map((e) => e.textContent))) assert.ok(t.length > 8, "source and years under each headline figure: " + t);
    assert.equal(await pg.$$eval(".pc-qr svg rect, .pc-qr svg path", (n) => n.length > 0), true);
    assert.equal(await pg.textContent("#h-pr-qr"), "This report, live and up to date: agsist.com/H/55005/54728");
    await pg.emulateMedia({ media: "screen" });
    // untick This week and the long view, tick More detail
    await pg.uncheck('#h-pr-box input[value="week"]');
    await pg.uncheck('#h-pr-box input[value="long"]');
    await pg.check("#h-pr-more");
    assert.match(pg.url(), /print=sentence,fingerprint,unusual,sources,more/);
    await pg.evaluate(() => window.AgHere.afterPrint());
    await pg.click("#h-pr-go");
    await pg.waitForFunction(() => window.__printed === 1, null, { timeout: 15000 });
    await pg.emulateMedia({ media: "print" });
    assert.equal(await shown("#h-sec-week"), false);
    assert.equal(await shown("#h-sec-long"), false);
    assert.ok(await shown("#h-sec-fingerprint"));
    assert.ok(await shown("#h-fp-t"), "More detail prints the figure table");
    assert.ok(await shown("#h-sec-unusual"));
    const pdf = await pg.pdf({ format: "Letter", printBackground: true, preferCSSPageSize: true });
    assert.ok(pdf.length > 20000);
    const box = /\/MediaBox\s*\[\s*0 0 612 792\s*\]/.test(pdf.toString("latin1"));
    assert.ok(box, "Letter pages");
    await pg.evaluate(() => window.AgHere.afterPrint());
    await pg.emulateMedia({ media: "screen" });
    assert.equal(await pg.$eval("#h-fp-t", (t) => t.closest("details").open), false, "the screen table closes again after printing");
    // a shared link prints the same choices
    const shared = pg.url().replace(/^https?:\/\/[^/]+/, "");
    const b2 = await openPage(browser, port, shared, 1280);
    await settled(b2.pg);
    assert.equal(await b2.pg.evaluate(() => document.documentElement.getAttribute("data-fx")), "print", "the shared link opens on the Print tab");
    assert.equal(await b2.pg.$eval('#h-pr-box input[value="week"]', (i) => i.checked), false);
    assert.equal(await b2.pg.$eval("#h-pr-more", (i) => i.checked), true);
    await b2.pg.evaluate(() => window.AgHere.beforePrint());
    await b2.pg.emulateMedia({ media: "print" });
    assert.equal(await b2.pg.$eval("#h-sec-week", (e) => getComputedStyle(e).display), "none");
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
    const { pg, ctx, errs } = await openPage(browser, port, "/fast-facts", 1280);
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
