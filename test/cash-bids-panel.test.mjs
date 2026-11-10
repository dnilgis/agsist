/* /cash-bids, review of 2026-11-09 (notes/panels/cash-bids-2026-11-09):
 *   #1  the signup box is one line (heading, email, button); the price alert and crop select are behind a closed
 *       "More options"; the ZIP is carried (shown only when none is known); same worker route and source tag
 *   #2  the no-ZIP table shows the reader's own state first when it is known
 *   #3  the no-ZIP email ask sits right under that table (test/cash-bids-signup-place.test.mjs)
 *   #4  the sticky bar is back on this page once results show, tagged bar-cash-bids
 *   #5  the table's numbers say "est." in the table itself
 *   #9  a row the feed flags basisOdd never becomes a Best price card
 *   #10 no stale "Working out the best bid", no archive z-prefix on a saved elevator's name
 *
 *   node --test test/cash-bids-panel.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(ROOT + p, "utf8");
const PX = require(ROOT + "components/price-local.js");
const CBS = require(ROOT + "components/cb-sample.js");
const JS = read("components/cash-bids.js");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const BS = JSON.parse(read("test/fixtures/cash-bids-speed/basis-states.json"));
const PRICES = JSON.parse(read("test/fixtures/alert-asks/prices.json"));
const NOW = Math.max(Date.parse(BS.generated), Date.parse(PRICES.fetched)) + 3600e3;
const rowsOf = (h) => [...h.matchAll(/<th scope="row"><a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);

/* ---- #2 and #5: the no-ZIP table ---- */
test("sample: a reader whose state is known sees it first, then the top states; unknown or thin state changes nothing", () => {
  const plain = rowsOf(CBS.render(BS, PRICES, PX.cell, NOW));
  assert.deepEqual(plain.slice(0, 3), ["Iowa", "Nebraska", "Kansas"], "no state known: the five biggest, as before");
  assert.ok(!plain.includes("Wisconsin"));
  const wi = rowsOf(CBS.render(BS, PRICES, PX.cell, NOW, "WI"));
  assert.equal(wi[0], "Wisconsin", "a Chetek WI reader sees Wisconsin");
  assert.equal(wi.length, CBS.TOP, "still five rows, so the reserved height holds");
  assert.deepEqual(wi.slice(1), plain.slice(0, CBS.TOP - 1), "then the top states in elevator order");
  assert.deepEqual(rowsOf(CBS.render(BS, PRICES, PX.cell, NOW, "ia")).slice(0, 5), plain, "a state already in the top five stays in place");
  assert.deepEqual(rowsOf(CBS.render(BS, PRICES, PX.cell, NOW, "ZZ")), plain, "a state with no table row is ignored");
  assert.match(CBS.render(BS, PRICES, PX.cell, NOW, "WI"), /Your state first/);
});

test("sample: ownState reads the live place, the saved place or the picked state, and only a two-letter code", () => {
  const w = (o) => ({ localStorage: { getItem: (k) => (k in (o.ls || {}) ? o.ls[k] : null) }, AGSIST_STATE: o.st });
  assert.equal(CBS.ownState(w({})), "");
  assert.equal(CBS.ownState(w({ st: { state: "wi" } })), "WI");
  assert.equal(CBS.ownState(w({ st: { weather: { state: "MN" } } })), "MN");
  assert.equal(CBS.ownState(w({ ls: { "agsist-wx-loc": JSON.stringify({ zip: "54728", state: "WI" }) } })), "WI");
  assert.equal(CBS.ownState(w({ ls: { agsist_state: "KS" } })), "KS");
  assert.equal(CBS.ownState(w({ st: { state: "Wisconsin" } })), "", "a name is not a code");
  assert.equal(CBS.ownState({ get localStorage() { throw new Error("blocked"); } }), "");
});

test("sample: the table says est. in its own headers and in its first line, not only in the footnote", () => {
  const h = CBS.render(BS, PRICES, PX.cell, NOW);
  assert.match(h, /<th scope="col">Corn <span class="cbs-est">est\.<\/span><\/th><th scope="col">Soybeans <span class="cbs-est">est\.<\/span><\/th>/);
  assert.match(h, /<p class="cbs-f">Estimates, not posted bids\./);
  assert.ok(!/—/.test(h));
});

/* ---- #9: Best price never takes a basisOdd row ---- */
function liftFn(name) {
  const i = JS.indexOf("function " + name + "(");
  assert.ok(i >= 0, `cash-bids.js no longer defines ${name}()`);
  let d = 0, j = JS.indexOf("{", i);
  for (; j < JS.length; j++) { if (JS[j] === "{") d++; else if (JS[j] === "}" && --d === 0) break; }
  return JS.slice(i, j + 1);
}
function liftVar(name) {
  const m = new RegExp("var " + name + "=[^;]*;").exec(JS);
  assert.ok(m, `cash-bids.js no longer defines var ${name}`);
  return m[0];
}
function rankCtx() {
  const ctx = { Math, Number, isFinite, window: {} };
  vm.createContext(ctx);
  vm.runInContext(["PPU_BAND", "BASIS_SANE"].map(liftVar).join("\n") + "\n" +
    ["ppu", "basisUnit", "basisCents", "basisUnusual", "rankCands"].map(liftFn).join("\n") + `
    function rankable(){return true;} function rankOf(b){return {price:b.cashPrice};} function wheatCls(){return '';}
    function getNearestBid(elev,comm,keep){return (elev.commodities[comm]||[]).filter(function(b){return !keep||keep(b);})[0]||null;}`, ctx);
  return ctx;
}
const soy = (extra) => Object.assign({ category: "soybeans", cashPrice: 13.28, basis: 1.4 }, extra);
test("Best price: a row flagged basisOdd (Riceville IA soybeans +$1.40) is unusual and never a candidate, even alone", () => {
  const c = rankCtx();
  assert.equal(c.basisUnusual(soy({ basisOdd: true })), true);
  assert.equal(c.basisUnusual(soy({ basisOdd: false, cashPrice: 11.9, basis: -0.65 })), false, "an ordinary row is not touched");
  const rice = { facility: "Riceville Elevator", distance: 5, commodities: { soybeans: [soy({ basisOdd: true })] } };
  const near = { facility: "Neighbor Co-op", distance: 20, commodities: { soybeans: [soy({ cashPrice: 11.9, basis: -0.65 })] } };
  const alone = JSON.parse(JSON.stringify(c.rankCands([rice], "soybeans")));
  assert.deepEqual(alone, [], "the only elevator posting an odd row is not ranked either");
  const both = c.rankCands([rice, near], "soybeans");
  assert.equal(both.length, 1);
  assert.equal(both[0].elev.facility, "Neighbor Co-op", "the $13.28 row does not beat the $11.90 one");
});

test("Best price: the network row carries the feed's basisOdd flag through to the page's rules", () => {
  assert.match(JS, /basisOdd:b\.basisOdd===true,/);
  assert.match(JS, /if\(bid\._odd\|\|bid\.basisOdd===true\)return true;/);
});

/* ---- #10 ---- */
test("labels: an empty comparison writes a not-available line over 'Working out the best bid', and clears an old one", () => {
  const i = JS.indexOf("function renderEarnings(");
  const body = JS.slice(i, JS.indexOf("earningsHead.textContent=line;", i));
  assert.match(body, /if\(!line\)\{earningsHead\.textContent=EARN_NONE;earningsDetail\.innerHTML='';return;\}/);
  assert.ok(!/if\(!line\)return;/.test(body), "no silent return that leaves the placeholder");
  assert.match(JS, /var EARN_NONE='Best after the drive: not enough boards read today to compare here\.';/);
  assert.ok(!/—/.test(JS.match(/var EARN_NONE=[^\n]*/)[0]));
});

test("labels: the archive z-prefix and Old tail never reach a saved elevator's name", () => {
  // cb-rank names through components/elev-names.js, which the page loads first
  const rank = vm.runInNewContext(read("components/elev-names.js") + ";" + read("components/cb-rank.js") + ";window.cbRank",
    { window: {}, module: undefined, console });
  const dn = rank.displayName;
  assert.equal(dn("zShawnee Feed Old"), "Shawnee Feed");
  assert.equal(dn("zWest-Con"), "West-Con");
  const my = read("components/cb-myelev.js");
  assert.match(my, /function dn\(n\)/);
  for (const raw of ["facility:p.operator", "facility:item.name", "facility:it.name"]) assert.ok(!my.includes(raw), raw + " is cleaned");
  assert.equal((my.match(/facility:dn\(/g) || []).length, 3);
});

/* ---- browser: #1 and #4 ---- */
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const FIX = { "/data/basis-states.json": read("test/fixtures/cash-bids-speed/basis-states.json"), "/data/prices.json": read("test/fixtures/alert-asks/prices.json") };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (FIX[p]) { res.writeHead(200, { "content-type": "application/json" }); return res.end(FIX[p]); }
    let f = normalize(join(ROOT, p));
    if (!p.endsWith("/") && existsSync(f + ".html")) f += ".html";
    else if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, w, init) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: 844 }, isMobile: w < 500 });
  await ctx.clock.setFixedTime(new Date(NOW));
  if (init) await ctx.addInitScript(init);
  const posts = [];
  await ctx.route("**/*", async (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    if (u.startsWith("https://agsist-api.dnilgis.workers.dev/") && r.request().method() === "POST") {
      posts.push({ path: new URL(u).pathname, body: JSON.parse(r.request().postData() || "{}") });
      return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    }
    return r.abort();
  });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.goto(`http://127.0.0.1:${port}/cash-bids`, { waitUntil: "load" });
  return { pg, posts, errors };
}

test("signup box: one line with the ZIP carried, price alert behind a closed More options, same route and tag", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, posts, errors } = await open(browser, port, 390);
    await pg.waitForSelector('[data-bid-alerts] .cbs-1', { timeout: 10000 });
    const s = await pg.evaluate(() => {
      const box = document.querySelector("[data-bid-alerts]"), q = (x) => box.querySelector(x);
      const vis = (el) => !!el && el.getClientRects().length > 0 && !el.closest("details:not([open])") ;
      return { h: q(".cbs-h").textContent, email: vis(q(".cbs-em")), go: q(".cbs-go").textContent, goVis: vis(q(".cbs-go")),
        zipVisible: vis(q(".cbs-zip")), more: q(".cbs-more > summary").textContent, open: q(".cbs-more").open,
        priceInMore: !!q(".cbs-more .cbs-price") && !!q(".cbs-more .cbs-crop"), priceVis: vis(q(".cbs-price")), cropVis: vis(q(".cbs-crop")),
        dailyChecked: q(".cbs-d").checked, boxH: box.getBoundingClientRect().height };
    });
    assert.equal(s.h, "Email me these every morning");
    assert.ok(s.email && s.goVis && s.go === "Email me");
    assert.ok(s.zipVisible, "no ZIP known yet: the ZIP field shows, because the morning email needs it");
    assert.equal(s.more, "More options");
    assert.ok(!s.open && s.priceInMore && !s.priceVis && !s.cropVis, "the price alert and crop select are folded away");
    assert.ok(s.dailyChecked);
    assert.equal(s.boxH, 260, "the box keeps the height its placeholder reserved");
    // the box's own ZIP field is what is sent; then the same box with a saved ZIP carries it and hides the field
    await pg.fill("[data-bid-alerts] .cbs-zip", "54728");
    await pg.fill("[data-bid-alerts] .cbs-em", "reader@example.test");
    await pg.click("[data-bid-alerts] .cbs-go");
    await pg.waitForFunction(() => /You are on AGSIST Daily/.test(document.querySelector("[data-bid-alerts]").textContent), null, { timeout: 8000 });
    const sub = posts.filter((p) => p.path === "/subscribe");
    assert.equal(sub.length, 1);
    assert.equal(sub[0].body.source, "page:cash-bids");
    assert.equal(sub[0].body.zip, "54728");
    assert.equal(sub[0].body.email, "reader@example.test");
    assert.equal(posts.filter((p) => p.path === "/elevator-watch-subscribe").length, 0, "no price alert unless asked");
    assert.deepEqual(errors.filter((e) => !/Failed to fetch|NetworkError|net::/.test(e)), []);
  } finally { await browser.close(); srv.close(); }
});

test("signup box: a saved ZIP is carried and its field is not shown", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, posts } = await open(browser, port, 390, () => { try { localStorage.setItem("agsist_zip", "50010"); } catch (e) {} });
    await pg.waitForSelector("[data-bid-alerts] .cbs-1", { state: "attached" });
    await pg.waitForSelector(".cb-pre-open", { timeout: 15000 });   // no elevators reachable here: the old fold under the results area
    await pg.click(".cb-pre-open");
    assert.equal(await pg.evaluate(() => !!document.querySelector("[data-bid-alerts] .cbs-zip").getClientRects().length), false, "ZIP known: no extra control");
    await pg.fill("[data-bid-alerts] .cbs-em", "reader@example.test");
    await pg.click("[data-bid-alerts] .cbs-go");
    await pg.waitForFunction(() => /You are on AGSIST Daily/.test(document.querySelector("[data-bid-alerts]").textContent), null, { timeout: 8000 });
    const sub = posts.find((p) => p.path === "/subscribe");
    assert.equal(sub.body.zip, "50010");
    assert.equal(sub.body.source, "page:cash-bids");
  } finally { await browser.close(); srv.close(); }
});

test("signup box: opening More options and filling a price sends the price alert as before", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, posts } = await open(browser, port, 390);
    await pg.waitForSelector("[data-bid-alerts] .cbs-1");
    await pg.click("[data-bid-alerts] .cbs-more > summary");
    await pg.fill("[data-bid-alerts] .cbs-zip", "54728");
    await pg.fill("[data-bid-alerts] .cbs-price", "4.50");
    await pg.fill("[data-bid-alerts] .cbs-em", "reader@example.test");
    await pg.click("[data-bid-alerts] .cbs-go");
    await pg.waitForFunction(() => /confirm the price alert/.test(document.querySelector("[data-bid-alerts]").textContent), null, { timeout: 8000 });
    const al = posts.find((p) => p.path === "/elevator-watch-subscribe");
    assert.ok(al, "the price alert route is the existing one");
    assert.equal(al.body.ewid, "ab54728025");
    assert.equal(al.body.target_cents, 450);
    assert.ok(posts.some((p) => p.path === "/subscribe" && p.body.source === "page:cash-bids"));
  } finally { await browser.close(); srv.close(); }
});

test("sticky bar: not before results, then on, tagged bar-cash-bids; the box does not suppress it here", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port, 390, () => { try { localStorage.setItem("agsist_visits", "3"); } catch (e) {} });
    await pg.waitForFunction(() => window.AgsistSignup, null, { timeout: 15000 });
    await pg.waitForTimeout(1500);
    assert.equal(await pg.evaluate(() => !!document.getElementById("sa-bar")), false, "no bar while there are no results");
    await pg.evaluate(() => { document.getElementById("best-bids-section").style.display = "block"; });
    await pg.waitForSelector("#sa-bar", { state: "attached", timeout: 8000 });
    assert.equal(await pg.evaluate(() => document.querySelector("#sa-bar [data-signup-ask]").getAttribute("data-source")), "bar-cash-bids");
  } finally { await browser.close(); srv.close(); }
});

test("sticky bar: every other page keeps the source 'bar' and the town pages stay suppressed", () => {
  const js = read("components/signup-ask.js");
  assert.match(js, /data-source="' \+ \(cashBidsPage\(\) \? 'bar-cash-bids' : 'bar'\) \+ '"/);
  assert.match(js, /function cashBidsPage\(\) \{ return \/\^\\\/cash-bids\(\\\.html\)\?\\\/\?\$\/\.test\(location\.pathname\); \}/);
  assert.match(js, /if \(cashBidsPage\(\) && el\.hasAttribute\('data-bid-alerts'\)\) continue;/);
});
