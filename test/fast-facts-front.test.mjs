/* Fast Facts v1 (Oct 21, 2026): the front door for a place, built from /here.
 *
 *   node --test test/fast-facts-front.test.mjs
 *
 * Five tabs, each with its own #hash, picked before first paint; every panel in order without
 * JavaScript. The ZIP is asked once (a saved ZIP opens the place, location only on a tap). No
 * buyer, seller, elevator or co-op name anywhere on the page, which is indexed. Every row an
 * anchor. /here and the H/ short link forward with their query. Every reference-table id the
 * page carried on Oct 21 (159) is still there, inside Reference tables. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const J = (p) => JSON.parse(read(p));
const P = createRequire(import.meta.url)(ROOT + "components/place.js");
const page = read("fast-facts.html"), HJS = read("components/here.js");
const tables = page.slice(page.indexOf('<div class="fx-panel" id="tables"'), page.indexOf("<!-- /tables -->"));

// the ids inside <main> of fast-facts.html on origin/main 63d75b3c9e (Oct 21), before the tabs
const OLD_IDS = ["main", "ff-ans", "ff-ans-t", "ans-rate", "ans-range", "ans-cost", "ans-line", "ans-soil", "ans-prev", "nc-fert", "nc-custom-wrap", "nc-custom-pct", "nc-fertprice", "ans-state", "nc-corn", "nc-nlb", "nc-ratio", "nc-col", "ans-src", "ans-note", "ans-fall", "ag-sponsor", "ff-strip", "fft-corn", "fft-beans", "fft-wheat", "ff-week", "ffw-num", "ffw-txt", "tab-btn-nitrogen", "tab-btn-economics", "tab-btn-pk", "tab-btn-removal", "tab-btn-manure", "tab-btn-soilhealth", "tab-btn-stages", "tab-btn-pest", "tab-btn-reference", "tab-btn-statestats", "tab-nitrogen", "fert-banner", "fert-date", "fert-pills", "n-table", "nc-table", "nth-05", "nth-10", "nth-15", "nth-20", "tab-economics", "eco-live-badge", "eco-corn-price", "eco-bean-price", "eco-wheat-price", "eco-urea-price", "eco-dap-price", "eco-mop-price", "eco-n-source-label", "eco-n-rate", "eco-n-pplb", "eco-n-cost", "eco-p-rate", "eco-p-pplb", "eco-p-cost", "eco-k-rate", "eco-k-pplb", "eco-k-cost", "eco-price-note", "eco-seed", "eco-seed-echo", "eco-chem", "eco-chem-echo", "eco-rent", "eco-rent-echo", "eco-other", "eco-other-echo", "eco-total", "tab-pk", "st-crop", "st-yield-unit", "st-yield", "st-soil", "st-rot", "st-p", "st-k", "st-res", "st-pcat", "st-kcat", "st-prec", "st-krec", "pk-cost-out", "pk-p-cost", "pk-k-cost", "pk-total-cost", "st-note", "pk-cats", "tab-removal", "rem-crop", "rem-yield", "rem-acres", "rem-res", "rem-p-ac", "rem-k-ac", "rem-p-tot", "rem-k-tot", "corn-lbs", "corn-moist", "corn-acres", "corn-res", "corn-bu", "corn-buac", "tab-manure", "manure-calc", "man-loads", "man-size", "man-units", "man-acres", "man-res", "man-total", "man-rate", "tab-soilhealth", "lime-wph", "lime-buf", "lime-target", "lime-ni", "lime-ni-wrap", "lime-ni-custom", "lime-depth", "lime-soil", "lime-price", "lime-res", "lime-base", "lime-ag", "lime-note", "lime-cost", "tab-stages", "corn-sv-wrap", "corn-sv-marks", "corn-sv-detail", "bean-sv-wrap", "bean-sv-marks", "bean-sv-detail", "gdu-max", "gdu-min", "gdu-acc", "gdu-res", "gdu-day", "gdu-new", "gdu-corn-stage", "gdu-bean-stage", "tab-pest", "pest-sources", "tab-reference", "tab-statestats", "ff-state-select", "state-content", "agf-t", "ff-sources", "ff-sources-t"];
const PLACE_ROWS = ["f-corn-bid", "f-soy-bid", "f-corn-basis", "f-soy-basis", "f-corn-fut", "f-soy-fut", "f-rain", "f-drought", "f-hail", "f-progress",
  "f-rent", "f-land", "f-sales", "f-loss", "f-arcplc", "f-usda", "f-fert", "f-daily"];

test("reference anchors unchanged: all 159 ids kept, inside Reference tables; one h1", () => {
  assert.equal(OLD_IDS.length, 159);
  for (const id of OLD_IDS) {
    if (id === "main") { assert.match(page, /<main id="main"/); continue; }
    assert.ok(tables.includes(' id="' + id + '"'), id + " is not inside Reference tables");
  }
  // every tab button the old page had, so #nitrogen, #pk ... still open their table
  for (const t of ["nitrogen", "economics", "pk", "removal", "manure", "soilhealth", "stages", "pest", "reference", "statestats"]) assert.ok(tables.includes('id="tab-btn-' + t + '"'), t);
  const ids = [...page.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((x, i) => ids.indexOf(x) !== i), [], "no id twice");
  assert.equal((page.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(tables, /<h2 class="ff-h">Fast Facts: farm reference tables<\/h2>/, "the old hero h1 is an h2");
});

test("five tabs with their own hashes; the head script picks one before first paint", () => {
  const tabs = [...page.matchAll(/<a class="fx-tab" role="tab" href="#([a-z]+)" data-t="\1"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(tabs, [["place", "My place"], ["state", "State"], ["us", "United States"], ["tables", "Reference tables"], ["print", "Print"]]);
  for (const [k] of tabs) assert.match(page, new RegExp('class="fx-panel[^"]*" id="' + k + '" role="tabpanel"'), k);
  const head = page.slice(0, page.indexOf("</head>"));
  assert.match(head, /Fast Facts tabs: the open tab is set before first paint/);
  // inline in <head>, so it runs before the body is parsed or painted
  assert.match(head, /<script>\/\* Fast Facts tabs[\s\S]*?\(document,location\);<\/script>/);
  const css = read("components/here.css");
  assert.match(css, /html\[data-fx\] \.fx-panel\{display:none\}/, "panels hide only once the script has run");
  for (const id of PLACE_ROWS) assert.match(page, new RegExp('<div class="fx-row" id="' + id + '">'), id + " is an anchor in the page");
});

test("no names on the page: no co-op, elevator, buyer or seller name in the markup or the row builders", () => {
  for (const c of J("scripts/coop_fert_sources.json").coops) assert.ok(!page.includes(c.name), "fast-facts.html names " + c.name);
  // the rows say miles and delivery; the name fields are never read into a row
  const facts = read("components/place.js").split("/* ── Fast Facts rows")[1].split("\n  return {\n")[0];
  assert.ok(facts.length > 3000, "the row builders moved");
  // (a fertilizer row's .name is the product, "Anhydrous ammonia")
  assert.doesNotMatch(facts, /\.facility|\.operator|\.company|\.town\b|elevName|grantor|grantee/);
  assert.doesNotMatch(HJS, /esc\(r\.name\)|esc\(o\.best\.facility\)|elevMath|r\.town \?/, "here.js draws an elevator by name");
  // a single co-op is "one Kansas co-op", in the reference tables too (fast-facts.js, manure-value.js)
  assert.equal(P.fertSrc({ src: "coop", n: 1, region: "Kansas", as_of: "2026-09-24", src_label: "Farmers Coop, Kansas, posted Sep 24, 2026", short_label: "Farmers Coop, Sep 24" }, true), "one Kansas co-op, Sep 24");
  assert.equal(P.fertSrc({ src: "coop", n: 1, region: "Kansas", as_of: "2026-09-24", src_label: "Farmers Coop, Kansas, posted Sep 24, 2026" }, false), "one Kansas co-op, posted Sep 24, 2026");
  assert.equal(P.fertSrc({ src: "coop", n: 4, src_label: "Kansas co-ops, middle of 4, posted Sep 24 to Oct 6, 2026", short_label: "Kansas co-ops, Sep 24 to Oct 6" }, true), "Kansas co-ops, Sep 24 to Oct 6");
  assert.match(read("components/fast-facts.js"), /AgPlace\.fertSrc\(p,true\)/);
  assert.match(read("components/manure-value.js"), /P\.fertSrc\(p, false\)/);
  assert.ok(page.indexOf("/components/place.js") < page.indexOf("/components/fast-facts.js") && page.indexOf("/components/place.js") < page.indexOf("/components/manure-value.js"), "place.js loads before the scripts that word a co-op");
});

test("the bid row: price, miles from the ZIP, delivery, how many; who pays it is one link away", () => {
  const snap = { bids: [
    { facility: "Some Elevator Co", crop: "corn", cashPrice: 3.95, basis: -0.5, lat: 45.4, lon: -91.4, deliveryStart: "2026-10-01", delivery: "10/01/2026" },
    { facility: "Other Grain LLC", crop: "corn", cashPrice: 3.9, basis: -0.55, lat: 45.0, lon: -91.9, deliveryStart: "2026-11-01" }] };
  const f = P.factBid(P.bestBids(snap, 45.31413, -91.651, 50).corn, "corn", "ZIP 54728", "2026-10-21T12:00:00Z", "/cash-bids?zip=54728");
  assert.equal(f.value + f.join + f.ctx, "$3.95, 14 mi from ZIP 54728, October delivery. Best of 2 within 50 mi.");
  assert.deepEqual(f.src, ["Who pays it", "/cash-bids?zip=54728"]);
  assert.doesNotMatch(JSON.stringify(f), /Elevator Co|Grain LLC/);
  const none = P.factBid(undefined, "soybeans", "ZIP 54728", "", "/cash-bids?zip=54728");
  assert.equal(none.value, null);
  assert.match(none.why, /no posted soybeans bid within 50 mi of ZIP 54728/);
});

test("one number, one builder: the place, State and US tabs call the same row builders", () => {
  for (const fn of ["factFutures", "factBasis", "factProgress", "factUsda", "factFert", "factDaily"]) assert.equal((HJS.match(new RegExp("P\\." + fn + "\\(", "g")) || []).length, 1, fn + " is called from one place");
  assert.match(HJS, /futures\('f-'\)/); assert.match(HJS, /futures\('u-'\)/);
  assert.match(HJS, /basis\('f-', st\)/); assert.match(HJS, /basis\('s-', st\)/);
});

test("every state link exists on disk, for all 50 states", () => {
  const basis = J("data/basis-states.json");
  let n = 0;
  for (const st of Object.keys(P.STATES)) {
    const links = P.stateLinks(st, basis);
    assert.ok(links.length >= 2, st);
    for (const l of links) {
      const h = l.href.replace(/^\//, "").replace(/#.*$/, "");
      const ok = [h + ".html", h + "/index.html", h.replace(/\/$/, "") + "/index.html", h.replace(/\/$/, "") + ".html"].some((f) => existsSync(path.join(ROOT, f)));
      assert.ok(ok, st + ": " + l.href + " has no page");
      n++;
    }
  }
  assert.equal(Object.keys(P.STATES).length, 50);
  assert.ok(n >= 250, "links checked: " + n);
});

test("undershare: no method write-ups or self-promotion in the place tabs, no em dashes", () => {
  const front = page.slice(page.indexOf('<div class="fx-top">'), page.indexOf('<div class="fx-panel" id="tables"')) + page.slice(page.indexOf("<!-- /tables -->"), page.indexOf("</main>"));
  for (const t of [front, HJS]) {
    assert.doesNotMatch(t, /how this page works|where the numbers come from|under the hood|powered by|transparent methodology|every number accounted|The rule, set before|Show the math/i);
    assert.doesNotMatch(t, /—|&mdash;/);
  }
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const GEO = { "54728": [{ name: "Chetek", latitude: 45.31413, longitude: -91.651, admin1: "Wisconsin", admin2: "Barron", postcodes: ["54728"] }] };
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".ics": "text/calendar" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/here" || p === "/fast-facts") p += ".html";
    if (p === "/data/site-notice.json") { res.writeHead(404); res.end(); return; }
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { "content-type": "text/html" }); res.end(fs.readFileSync(path.join(ROOT, "404.html"))); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function openPage(browser, port, url, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: o.width || 390, height: 900 }, javaScriptEnabled: o.js !== false });
  await ctx.addInitScript((st) => {
    for (const [k, v] of Object.entries(st || {})) localStorage.setItem(k, v);
    window.__geo = 0;
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition = function (ok) { window.__geo++; ok({ coords: { latitude: 45.31413, longitude: -91.651 } }); };
  }, o.storage || {});
  const pg = await ctx.newPage(), errs = [], geo = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    if (u.includes("geocoding-api.open-meteo.com")) { geo.push(u); return r.fulfill({ contentType: "application/json", body: JSON.stringify({ results: GEO[new URL(u).searchParams.get("name")] || [] }) }); }
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
  return { pg, ctx, errs, geo };
}
const fx = (pg) => pg.evaluate(() => document.documentElement.getAttribute("data-fx"));
const shown = (pg, sel) => pg.$eval(sel, (e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 0);

test("tabs and hashes in Chromium: each hash opens its tab, old anchors open Reference tables, a tap keeps the hash", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [hash, want] of [["", "place"], ["#state", "state"], ["#us", "us"], ["#tables", "tables"], ["#print", "print"], ["#nitrogen", "tables"], ["#pk", "tables"],
      ["#ff-sources", "tables"], ["#n-table", "tables"], ["#f-corn-bid", "place"], ["#s-corn-basis", "state"], ["#u-daily", "us"], ["#h-pr-go", "print"]]) {
      const { pg, ctx, errs } = await openPage(browser, port, "/fast-facts" + hash);
      assert.equal(await fx(pg), want, hash);
      assert.equal(await pg.$eval("#fx-t-" + want, (a) => a.getAttribute("aria-selected")), "true", hash);
      for (const k of ["place", "state", "us", "tables", "print"]) assert.equal(await shown(pg, "#" + k), k === want, hash + " " + k);
      if (hash === "#pk") assert.equal(await pg.$eval("#tab-btn-pk", (b) => b.getAttribute("aria-selected")), "true", "the old inner tab still opens");
      if (hash === "#ff-sources") assert.ok(await shown(pg, "#ff-sources"));
      assert.deepEqual(errs, [], hash);
      await ctx.close();
    }
    // tapping a tab: the hash follows, nothing else on the page moves
    const { pg, ctx, errs } = await openPage(browser, port, "/fast-facts", { width: 1280 });
    await pg.click("#fx-t-us");
    assert.equal(await fx(pg), "us");
    assert.match(pg.url(), /\/fast-facts#us$/);
    await pg.waitForFunction(() => !document.querySelector("#u-corn-fut .fx-wait") && document.querySelector("#u-corn-fut .fx-w").textContent.length > 5);
    await pg.focus("#fx-t-us");
    await pg.keyboard.press("ArrowRight");
    assert.equal(await fx(pg), "tables");
    await pg.goto(`http://127.0.0.1:${port}/fast-facts#tables`);
    await pg.evaluate(() => { location.hash = "#state"; });
    await pg.waitForFunction(() => document.documentElement.getAttribute("data-fx") === "state");
    assert.deepEqual(errs, []);
    await ctx.close();
    // without JavaScript every panel shows, in order
    const nj = await openPage(browser, port, "/fast-facts#state", { js: false });
    const tops = [];
    for (const k of ["place", "state", "us", "tables", "print"]) { assert.ok(await shown(nj.pg, "#" + k), "no JS: " + k); tops.push(await nj.pg.$eval("#" + k, (e) => e.getBoundingClientRect().top)); }
    assert.deepEqual(tops, [...tops].sort((a, b) => a - b));
    await nj.ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("the ZIP once: a saved ZIP opens the place with no question; location only on a tap; the box folds", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    // each key loader.js reads opens the place
    for (const storage of [{ "agsist-wx-loc": JSON.stringify({ zip: "54728", state: "WI", label: "Chetek, WI" }) }, { agsist_user_zip: "54728" }, { agsist_zip: "54728" }]) {
      const { pg, ctx, errs } = await openPage(browser, port, "/fast-facts", { storage });
      await pg.waitForFunction(() => !document.getElementById("h-place").hidden, null, { timeout: 30000 });
      assert.equal(await pg.textContent("#h-title"), "Barron County, Wisconsin", JSON.stringify(storage));
      assert.equal(await shown(pg, "#h-find"), false, "the box folds once a place is open");
      assert.match(await pg.textContent("#h-change"), /Change place ZIP 54728/);
      assert.equal(await pg.evaluate(() => window.__geo), 0, "no location asked on load");
      assert.deepEqual(errs, []);
      await ctx.close();
    }
    // no ZIP saved: one box, nothing looked up, no location asked
    const a = await openPage(browser, port, "/fast-facts");
    await a.pg.waitForTimeout(800);
    assert.ok(await shown(a.pg, "#h-form"));
    assert.equal(await a.pg.$eval("#h-place", (e) => e.hidden), true);
    assert.deepEqual(a.geo, []);
    assert.equal(await a.pg.evaluate(() => window.__geo), 0);
    // the reference tables cost nothing: a saved ZIP is not looked up there
    const t = await openPage(browser, port, "/fast-facts#nitrogen", { storage: { agsist_zip: "54728" } });
    await t.pg.waitForTimeout(800);
    assert.deepEqual(t.geo, [], "no place lookup on the Reference tables tab");
    await t.ctx.close();
    // Use my location: asked once, on the tap
    await a.pg.click("#h-locate");
    await a.pg.waitForFunction(() => !document.getElementById("h-place").hidden, null, { timeout: 30000 });
    assert.equal(await a.pg.evaluate(() => window.__geo), 1);
    assert.equal(await a.pg.textContent("#h-title"), "Barron County, Wisconsin");
    // typed once, saved for next time
    await a.pg.click("#h-change");
    await a.pg.fill("#h-q", "54728");
    await a.pg.click("#h-form button[type=submit]");
    await a.pg.waitForFunction(() => /zip=54728/.test(location.search), null, { timeout: 20000 });
    assert.equal(await a.pg.evaluate(() => localStorage.getItem("agsist_user_zip")), "54728");
    assert.deepEqual(a.errs, []);
    await a.ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("in Chromium: every row answers with a date and a source or says why; no name anywhere; row anchors open", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, ctx, errs } = await openPage(browser, port, "/fast-facts?zip=54728#f-rain", { width: 1280 });
    assert.equal(await fx(pg), "place");
    await pg.waitForFunction((ids) => ids.every((id) => { const w = document.querySelector("#" + id + " .fx-w"); return w && w.firstChild && !w.querySelector(".fx-wait"); }), PLACE_ROWS, { timeout: 40000 });
    for (const id of PLACE_ROWS) {
      const t = await pg.textContent("#" + id + " .fx-w");
      if (/^Not available/.test(t)) assert.match(t, /^Not available\. [A-Z].{8,}\./, id + ": " + t);
      else assert.ok(await pg.$("#" + id + " .fx-s"), id + " has its date and source line");
    }
    const bid = await pg.textContent("#f-corn-bid .fx-w");
    assert.match(bid, /^\$\d+\.\d{2}, \d+ mi from ZIP 54728, ([A-Z][a-z]+ )?delivery\. (Best of \d+|The only one) within 50 mi\./, bid);
    assert.equal(await pg.$eval("#f-corn-bid .fx-s a", (a) => [a.textContent, a.getAttribute("href")].join(" ")), "Who pays it /cash-bids?zip=54728");
    // no elevator in the bid file within 50 miles is named anywhere on the page
    const near = J("data/bids.json").bids.filter((b) => b.lat != null && P.miles(45.31413, -91.651, b.lat, b.lon) <= 60).map((b) => b.facility).filter((n) => n && n.length > 3);
    assert.ok(near.length >= 3, "bids near Chetek in data/bids.json: " + near.length);
    await pg.click("#h-more summary");
    await pg.waitForFunction(() => !document.querySelector("#h-elev-b .wk-wait"), null, { timeout: 30000 });
    await pg.click("#fx-t-tables");
    const body = await pg.evaluate(() => document.body.innerText + " " + document.title);
    for (const n of new Set(near)) assert.ok(!new RegExp("\\b" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(body), "names " + n);
    for (const c of J("scripts/coop_fert_sources.json").coops) assert.ok(!body.includes(c.name), "names " + c.name);
    // the row the link pointed at is the target
    await pg.click("#fx-t-place");
    assert.equal(await pg.evaluate(() => document.querySelector(":target") && document.querySelector(":target").id), "f-rain");
    // State: the same builders for the place's state
    await pg.click("#fx-t-state");
    await pg.waitForFunction(() => document.querySelectorAll("#s-links a").length >= 3 && !document.querySelector("#s-corn-basis .fx-wait"), null, { timeout: 20000 });
    assert.equal(await pg.textContent("#s-name"), "Wisconsin");
    assert.equal(await pg.textContent("#s-corn-basis .fx-w"), await pg.textContent("#f-corn-basis .fx-w"), "one number, one builder: State and My place agree");
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("/here and the H/ short link forward to Fast Facts with the query and hash", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    let { pg, ctx, errs } = await openPage(browser, port, "/here?zip=54728&print=week#print");
    await pg.waitForURL((u) => u.pathname === "/fast-facts", { timeout: 10000 });
    assert.equal(await pg.evaluate(() => location.hash), "#print");
    assert.equal(await fx(pg), "print");
    await pg.waitForFunction(() => !document.getElementById("h-place").hidden, null, { timeout: 30000 });
    assert.match(pg.url(), /fips=55005&zip=54728&print=week#print$/, "the query came through: " + pg.url());
    assert.deepEqual(errs, []);
    await ctx.close();
    ({ pg, ctx, errs } = await openPage(browser, port, "/H/55005/54728"));
    await pg.waitForURL((u) => u.pathname === "/fast-facts", { timeout: 10000 });
    await pg.waitForFunction(() => !document.getElementById("h-place").hidden, null, { timeout: 30000 });
    assert.equal(await pg.textContent("#h-title"), "Barron County, Wisconsin");
    assert.match(pg.url(), /\/fast-facts\?fips=55005&zip=54728/);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
