/* Fast Facts v1 (Oct 21, 2026): the front door for a place, built from /here.
 *
 *   node --test test/fast-facts-front.test.mjs
 *
 * Two tabs (Sig, Oct 21 after the panel): My place and Reference tables, each with its own #hash,
 * picked before first paint; both panels in order without JavaScript. A saved place or a place link
 * opens My place; any other first visit (a search visitor) opens the tables. Old #state, #us and
 * #print links open My place; Print is a button. The ZIP is asked once (a saved ZIP opens the place, location only on a tap). No
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
const PLACE_ROWS = ["f-corn-bid", "f-soy-bid", "f-corn-basis", "f-soy-basis", "f-corn-fut", "f-soy-fut", "f-wheat-fut", "f-rain", "f-drought", "f-hail", "f-progress", "f-soy-progress",
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

test("two tabs with their own hashes; the head script picks one before first paint; Print is a button", () => {
  const tabs = [...page.matchAll(/<a class="fx-tab" role="tab" href="#([a-z]+)" data-t="\1"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(tabs, [["place", "My place"], ["tables", "Reference tables"]]);
  for (const k of ["state", "us", "print"]) assert.doesNotMatch(page, new RegExp('id="' + k + '" role="tabpanel"'), k + " is folded into My place");
  assert.match(page, /<button type="button" id="h-pr-go" class="h-pr-go">[\s\S]*?Print<\/button>/);
  for (const [k] of tabs) assert.match(page, new RegExp('class="fx-panel[^"]*" id="' + k + '" role="tabpanel"'), k);
  const head = page.slice(0, page.indexOf("</head>"));
  assert.match(head, /Fast Facts tabs \(My place, Reference tables\), set before first paint/);
  // inline in <head>, so it runs before the body is parsed or painted
  assert.match(head, /<script>\/\* Fast Facts tabs[\s\S]*?\(document,location\);<\/script>/);
  const css = read("components/here.css");
  assert.match(css, /html\[data-fx\] \.fx-panel\{display:none\}/, "panels hide only once the script has run");
  assert.match(css, /html:not\(\[data-fx\]\) #h-form/, "without JavaScript the place box is hidden, not dead");
  assert.match(page, /<noscript><style>\.ff-panel\{display:block!important\}<\/style><\/noscript>/, "without JavaScript every reference panel shows");
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
  // the best and, when it is a different elevator, the nearest beside it (farmer, Oct 21); never a name
  assert.equal(f.value + f.join + f.ctx, "$3.95, 14 mi from ZIP 54728, October delivery. Best of 2 within 50 mi.", "the nearest is the best here, so it is not said twice");
  assert.match(f.ctx, /^14 mi from ZIP 54728, October delivery\. Best of 2 within 50 mi\.( Nearest: \$\d\.\d\d at \d+ mi\.)?$/);
  assert.deepEqual(f.src, ["See the bids near here", "/cash-bids?zip=54728"]);
  const near = P.factBid({ n: 3, best: { price: 4.06, mi: 22, delivery: "HAR 26" }, nearest: { price: 3.95, mi: 7 } }, "corn", "ZIP 54728", "", "/cash-bids");
  assert.equal(near.ctx, "22 mi from ZIP 54728, harvest delivery. Best of 3 within 50 mi. Nearest: $3.95 at 7 mi.");
  assert.equal(P.deliveryWords({ delivery: "Oct 01, 2026" }), "October delivery");
  assert.doesNotMatch(JSON.stringify(f), /Elevator Co|Grain LLC/);
  const none = P.factBid(undefined, "soybeans", "ZIP 54728", "", "/cash-bids?zip=54728");
  assert.equal(none.value, null);
  assert.match(none.why, /no posted soybeans bid within 50 mi of ZIP 54728/);
});

test("one number, one builder: each row builder is called from one place; the State and US rows live in My place", () => {
  for (const fn of ["factFutures", "factBasis", "factProgress", "factUsda", "factFert", "factDaily"]) assert.equal((HJS.match(new RegExp("P\\." + fn + "\\(", "g")) || []).length, 1, fn + " is called from one place");
  assert.match(HJS, /futures\('f-'\)/);
  assert.match(HJS, /basis\('f-', st, bids, fromWords\(w\)\)/);
  assert.match(HJS, /progress\('f-progress', st, 'corn'\);\s*progress\('f-soy-progress', st, 'soybeans'\)/);
  assert.doesNotMatch(HJS, /drawState|drawUS|'s-corn|'u-corn/);
  // the harvest row carries the state and the US together, and says whose average it is
  const h = P.factProgress(J("data/crop-progress.json"), "WI", "corn");
  assert.match(h.value, /^\d+% WI, \d+% US$/);
  assert.match(h.ctx, /Week ending [A-Z][a-z]{2} \d+\. The 5-year average is our average of the NASS weeks\.$/);
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

test("tabs and hashes in Chromium: each hash opens its tab; old #state, #us, #print open My place; a search visit opens the tables", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const SAVED = { agsist_user_zip: "54728" };
  try {
    for (const [hash, want, storage] of [["", "tables"], ["", "place", SAVED], ["?zip=54728", "place"], ["#place", "place"], ["#tables", "tables", SAVED],
      ["#state", "place"], ["#us", "place"], ["#print", "place"], ["#nitrogen", "tables", SAVED], ["#pk", "tables"],
      ["#ff-sources", "tables"], ["#n-table", "tables"], ["#f-corn-bid", "place"], ["#h-pr-go", "place"]]) {
      const { pg, ctx, errs } = await openPage(browser, port, "/fast-facts" + hash, { storage: storage || {} });
      const k = hash + (storage ? " (saved place)" : "");
      assert.equal(await fx(pg), want, k);
      assert.equal(await pg.$eval("#fx-t-" + want, (a) => a.getAttribute("aria-selected")), "true", k);
      for (const t of ["place", "tables"]) assert.equal(await shown(pg, "#" + t), t === want, k + " " + t);
      if (hash === "#pk") assert.equal(await pg.$eval("#tab-btn-pk", (b) => b.getAttribute("aria-selected")), "true", "the old inner tab still opens");
      if (hash === "#ff-sources") assert.ok(await shown(pg, "#ff-sources"));
      assert.deepEqual(errs, [], k);
      await ctx.close();
    }
    // an old State or US row link lands on the row that now carries it
    const old = await openPage(browser, port, "/fast-facts?zip=54728#s-corn-basis");
    assert.equal(await old.pg.evaluate(() => location.hash), "#f-corn-basis");
    assert.equal(await fx(old.pg), "place");
    await old.ctx.close();
    // tapping a tab: the hash follows; arrows, Home, End and Space move between tabs
    const { pg, ctx, errs } = await openPage(browser, port, "/fast-facts", { width: 1280 });
    await pg.click("#fx-t-place");
    assert.equal(await fx(pg), "place");
    assert.match(pg.url(), /\/fast-facts#place$/);
    await pg.focus("#fx-t-place");
    await pg.keyboard.press("ArrowRight");
    assert.equal(await fx(pg), "tables");
    await pg.keyboard.press("Home");
    assert.equal(await fx(pg), "place");
    await pg.keyboard.press("End");
    assert.equal(await fx(pg), "tables");
    await pg.focus("#fx-t-place");
    const y0 = await pg.evaluate(() => scrollY);
    await pg.keyboard.press(" ");
    assert.equal(await fx(pg), "place", "Space selects the focused tab");
    assert.equal(await pg.evaluate(() => scrollY), y0, "and does not scroll the page");
    await pg.goto(`http://127.0.0.1:${port}/fast-facts#tables`);
    await pg.evaluate(() => { location.hash = "#place"; });
    await pg.waitForFunction(() => document.documentElement.getAttribute("data-fx") === "place");
    assert.deepEqual(errs, []);
    await ctx.close();
    // without JavaScript both panels show, in order; every reference panel shows; the place box is hidden
    const nj = await openPage(browser, port, "/fast-facts#place", { js: false });
    const tops = [];
    for (const t of ["place", "tables"]) { assert.ok(await shown(nj.pg, "#" + t), "no JS: " + t); tops.push(await nj.pg.$eval("#" + t, (e) => e.getBoundingClientRect().top)); }
    assert.deepEqual(tops, [...tops].sort((a, b) => a - b));
    for (const id of ["#tab-pk", "#tab-manure", "#tab-statestats"]) assert.ok(await shown(nj.pg, id), "no JS: " + id);
    for (const id of ["#h-form", "#h-locate"]) assert.equal(await shown(nj.pg, id), false, "no JS: " + id + " is hidden, not dead");
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
    // no ZIP saved: the tables open; My place shows one box, nothing looked up, no location asked
    const a = await openPage(browser, port, "/fast-facts#place");
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
    // Change place has a way back: Escape, or the Keep button, brings the open place back
    await a.pg.click("#h-change");
    assert.ok(await shown(a.pg, "#h-keep"));
    assert.match(await a.pg.textContent("#h-ask"), /Type the new ZIP/);
    await a.pg.keyboard.press("Escape");
    assert.equal(await shown(a.pg, "#h-find"), false);
    assert.ok(await shown(a.pg, "#h-change"));
    await a.pg.click("#h-change");
    await a.pg.click("#h-keep");
    assert.equal(await shown(a.pg, "#h-find"), false);
    // typed once, saved for next time; focus and the status line say where it landed; the header chip agrees
    await a.pg.click("#h-change");
    await a.pg.fill("#h-q", "54728");
    await a.pg.click("#h-form button[type=submit]");
    await a.pg.waitForFunction(() => /zip=54728/.test(location.search), null, { timeout: 20000 });
    await a.pg.waitForFunction(() => document.activeElement && document.activeElement.id === "h-title", null, { timeout: 20000 });
    assert.equal(await a.pg.textContent("#h-status"), "Showing Barron County, Wisconsin.");
    assert.equal(await a.pg.evaluate(() => localStorage.getItem("agsist_user_zip")), "54728");
    assert.equal(JSON.parse(await a.pg.evaluate(() => localStorage.getItem("agsist-wx-loc"))).zip, "54728");
    await a.pg.waitForFunction(() => /54728|Chetek/.test((document.getElementById("zip-chip-t") || { textContent: "54728" }).textContent), null, { timeout: 10000 });
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
    assert.match(bid, /^\$\d+\.\d{2}, \d+ mi from ZIP 54728, ([A-Za-z]+ )?delivery\. (Best of \d+|The only one) within 50 mi\.( Nearest: \$\d+\.\d\d at \d+ mi\.)?/, bid);
    assert.equal(await pg.$eval("#f-corn-bid .fx-s a", (a) => [a.textContent, a.getAttribute("href")].join(" ")), "See the bids near here /cash-bids?zip=54728");
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
    // what the State and US tabs carried is in My place now: wheat futures, both harvest rows with the state and the US
    assert.match(await pg.textContent("#f-wheat-fut .fx-w"), /^\$\d+\.\d/);
    assert.match(await pg.textContent("#f-soy-progress .fx-w"), /^\d+% WI, \d+% US|^Not available/);
    // the futures rows say how they moved; the Daily row carries no price of its own
    assert.match(await pg.textContent("#f-corn-fut .fx-w"), /(Up|Down) [\d¼½¾⅛⅜⅝⅞]+¢ from the [A-Z][a-z]{2} \d+ settle\.|Unchanged from the/);
    assert.doesNotMatch(await pg.textContent("#f-daily .fx-b"), /\$\d{1,2}\.\d{2}/, "no grain price in the Daily row");
    // tap targets: every source link is at least 44 px tall to the thumb
    const small = await pg.$$eval("#h-sec-week .fx-s a", (as) => as.filter((a) => { const r = a.getBoundingClientRect(); return r.height > 0 && r.height < 44; }).map((a) => a.textContent));
    assert.deepEqual(small, []);
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
    assert.equal(await fx(pg), "place", "an old #print link opens My place");
    await pg.waitForFunction(() => !document.getElementById("h-place").hidden, null, { timeout: 30000 });
    assert.match(pg.url(), /fips=55005&zip=54728&print=week#print$/, "the query came through: " + pg.url());
    assert.equal(await pg.$eval("#h-pr-box", (d) => d.open), true, "with the print options open");
    assert.equal(await pg.$eval('#h-pr-box input[value="long"]', (i) => i.checked), false, "and the link's choice in them");
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

test("/fastfacts forwards with its query and #anchor", () => {
  const stub = read("fastfacts.html");
  assert.match(stub, /location\.replace\("\/fast-facts"\+location\.search\+location\.hash\)/);
  assert.match(stub, /<meta name="robots" content="noindex, follow">/);
});
