/* What changed here this week, on Fast Facts My place (god's-eye panel build 4; Sig, Oct 27 2026).
 *
 *   node --test test/changemap.test.mjs
 *
 * The numbers come from components/changemap.js on real rows, frozen in test/fixtures/changemap:
 * the bids network's index read Oct 27 16:37 UTC (corn rows within 75 mi of Barron WI and Shelby IL),
 * data/bids-prev for the same keys, the Drought Monitor maps of Oct 13 and Oct 20 (WI, IL, CT, AK
 * rows), the state basis middles, corn futures and the WI and IL recorded sales of Oct 18.
 * Three real counties: Shelby IL (drought D0 to D1, the top bid moved by a quarter cent), Barron WI
 * (drought held at D2, the top bid at the same place), Hartford CT (nothing we can back: withheld).
 * Every withhold case is here, built from those same rows. In a browser (Playwright and Chromium):
 * the three counties at 390 and 1280, the map top on a phone, no sideways scroll, no name, and the
 * reader's point never in a request. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const C = require(ROOT + "components/changemap.js");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const FX = (p) => JSON.parse(read("test/fixtures/changemap/" + p));
const clone = (o) => JSON.parse(JSON.stringify(o));
const IDX = FX("index.json"), PREV = FX("bids-prev.json"), DR = FX("drought.json"), BS = FX("basis-states.json"), PX = FX("prices.json");
const TODAY = "2026-10-27";
const CHETEK = [45.31413, -91.651], SHELBY = [39.391, -88.806], HARTFORD = [41.804, -72.732];
const NAMES = [...new Set(IDX.places.map((p) => String(p.operator || "").trim()).filter((n) => n.length > 3))];

test("the Drought Monitor codes that are not one county match the shared crosswalk (data/ids/geo-crosswalk.json)", () => {
  const xw = JSON.parse(read("data/ids/geo-crosswalk.json"));
  const split = {}, reshape = new Set();
  for (const [code, c] of Object.entries(xw.codes)) {
    if (!c.agencies.includes("usdm")) continue;
    if (c.to && c.to.length) for (const t of c.to) (split[t] = split[t] || []).push(code);
    else { assert.equal(c.kind, "reshape", code); reshape.add(code.slice(0, 2)); }
  }
  for (const k of Object.keys(split)) split[k].sort();
  assert.deepEqual(C.USDM_SPLIT, split);
  assert.deepEqual(Object.keys(C.USDM_RESHAPE).sort(), [...reshape].sort());
});

test("drought: the category is the worst covering at least half the county, this week against last", () => {
  assert.equal(C.droughtCat([100, 49.9, 0, 0, 0]), 0);
  assert.equal(C.droughtCat([100, 100, 50, 0, 0]), 2);
  assert.equal(C.droughtCat([40, 0, 0, 0, 0]), -1);
  assert.equal(C.droughtCat(null), null);
  const shelby = C.droughtChange(DR, "17173");
  assert.deepEqual([shelby.status, shelby.was, shelby.now, shelby.dir, shelby.prev, shelby.valid], ["ok", 0, 1, "worse", "2026-10-13", "2026-10-20"]);
  const l = C.droughtLine(shelby);
  assert.equal(l.status, "changed");
  assert.equal(l.lead, "drought worse (D0 to D1)");
  assert.match(l.text, /^Worse this week: D1 moderate drought, from D0 abnormally dry a week earlier\./);
  assert.equal(l.date, "maps of Oct 13 and Oct 20");
  const barron = C.droughtChange(DR, "55005");
  assert.deepEqual([barron.now, barron.was, barron.dir], [2, 2, "held"]);
  assert.equal(C.droughtLine(barron).status, "held");
  // the state map: every Illinois county gets one fill; the file's own count for Oct 13 to 20
  const il = JSON.parse(read("data/arc-plc/geo/IL.json")).c.map((c) => c[0]);
  assert.equal(il.length, 102);
  const fl = C.droughtFills(DR, il);
  assert.deepEqual(fl.n, { worse: 20, better: 3, held: 79, none: 0 });
  // a county in the file's zero list held at none
  const z = DR.zero.find((f) => f.startsWith("02"));
  assert.equal(C.droughtChange(DR, z).dir, "held");
});

test("drought withheld: no file, no row, no map that week, a reshaped state, pieces that disagree", () => {
  assert.equal(C.droughtChange(null, "17173").status, "withheld");
  assert.match(C.droughtChange(DR, "17999").why, /no Drought Monitor row for this county/);
  const noWeek = clone(DR); noWeek.c["17173"][1] = null;
  assert.match(C.droughtChange(noWeek, "17173").why, /no Drought Monitor map for last week/);
  // Connecticut: the map is drawn by planning regions; Hartford County cannot be read from them
  const ct = C.droughtChange(DR, "09003");
  assert.equal(ct.status, "withheld");
  assert.match(ct.why, /Connecticut’s nine planning regions, which do not line up with this county/);
  // Valdez-Cordova is mapped as two pieces: printed only when both pieces are in one category
  const ak = C.droughtChange(DR, "02261");
  assert.equal(ak.status, "ok");
  const split = clone(DR); split.c["02063"] = [[100, 100, 0, 0, 0], [100, 100, 0, 0, 0], null]; split.zero = split.zero.filter((f) => f !== "02063");
  assert.match(C.droughtChange(split, "02261").why, /pieces that are in different categories/);
});

test("the top corn bid within 50 mi: one delivery period, against the oldest trading day on file", () => {
  // Shelby IL: the Oct 22 top was a quarter cent higher at another place 33 mi out; printed in eighths, never rounded away
  const s = C.topBid(IDX, PREV, SHELBY[0], SHELBY[1], TODAY);
  assert.deepEqual([s.status, s.same, s.period, s.day, s.n, s.nThen], ["ok", false, "2026-10", "2026-10-22", 42, 42]);
  assert.deepEqual([s.now.cash, s.then.cash], [4.55, 4.5525]);
  const l = C.bidLine(s);
  assert.equal(l.status, "changed");
  assert.equal(l.lead, "top corn bid within 50 mi now at a different place than Oct 22");
  assert.equal(l.text, "For Oct delivery: $4.55, 33 mi away, now; on Oct 22 the top was $4.55¼, 33 mi away. 42 of 42 places posted on both days.");
  // Barron WI (from ZIP 54728): the same place tops the list
  const b = C.topBid(IDX, PREV, CHETEK[0], CHETEK[1], TODAY);
  assert.deepEqual([b.status, b.same, b.now.cash, b.then.cash], ["ok", true, 3.86, 3.95]);
  assert.equal(C.bidLine(b).short, "the top posted corn bid within 50 mi (Oct delivery) is at the same place as on Oct 22, $3.86, down 9 cents");
  // one board filed under two towns at one pin is one place: a tie between them is not a move
  const twin = clone(IDX), top = twin.places.find((p) => p.now.corn.cash === 4.55 && Math.abs(p.lat - 39.854) < 0.001);
  const other = twin.places.find((p) => p.now.corn.cash === 4.505);
  other.lat = top.lat; other.lon = top.lon; other.operator = top.operator;
  assert.equal(C.topBid(twin, PREV, SHELBY[0], SHELBY[1], TODAY).same, true);
});

test("the top corn bid withheld: no network, nothing within 50 mi, no earlier record, the top place silent, too few places", () => {
  assert.match(C.topBid(null, PREV, ...SHELBY, TODAY).why, /the elevator network did not answer/);
  assert.match(C.topBid(IDX, PREV, ...HARTFORD, TODAY).why, /no posted corn bid within 50 mi/);
  assert.match(C.topBid(IDX, { WI: PREV.WI }, ...SHELBY, TODAY).why, /the earlier posted prices did not load/);
  assert.match(C.topBid(IDX, PREV, ...SHELBY, "2026-10-22").why, /no earlier trading day on record/);
  // the top place now has no price on the day compared against: unknown, so withheld
  const s = C.topBid(IDX, PREV, ...SHELBY, TODAY), best = IDX.places.find((p) => p.now.corn.cash === 4.55 && Math.abs(p.lat - 39.854) < 0.001);
  const gap = clone(PREV), key = C.fnv(best.place + "|corn|" + best.now.corn.period);
  gap[best.state].rows[key] = gap[best.state].rows[key].filter((e) => e[0] !== s.day);
  assert.match(C.topBid(IDX, gap, ...SHELBY, TODAY).why, /^the top place now posted no Oct delivery corn price on Oct 22$/);
  // only the top place posted that day
  const lone = clone(PREV);
  for (const st of Object.keys(lone)) for (const k of Object.keys(lone[st].rows)) if (k !== key) lone[st].rows[k] = lone[st].rows[k].filter((e) => e[0] !== s.day);
  assert.match(C.topBid(IDX, lone, ...SHELBY, TODAY).why, /fewer than two places posted Oct delivery corn on Oct 22/);
});

test("county basis against the state middle: only bids whose futures is the state's contract, at least 3, arithmetic", () => {
  const sh = C.countyBasis(IDX, "17173", BS, PX, "IL", "Illinois", "Shelby County");
  assert.deepEqual([sh.status, sh.n, sh.median, sh.state, sh.diff, sh.month], ["ok", 8, -0.3, -0.25, -5, "Dec"]);
  assert.equal(C.basisLine(sh, "Illinois", "Shelby County").text,
    "Posted against Dec: Shelby County middle 30 under (8 locations, 4 companies), Illinois middle 25 under (215 locations): 5 cents weaker than the state middle.");
  // a bid whose cash minus basis is the March price is posted against March, not December: left out
  const mar = clone(IDX), rows = mar.places.filter((p) => p.fips === "17173");
  const r = rows[0].now.corn; r.basis = +(r.cash - PX.quotes["corn-mar27"].close / 100).toFixed(4);
  assert.equal(C.countyBasis(mar, "17173", BS, PX, "IL", "Illinois", "Shelby County").n, 7);
  // withheld
  const wb = C.countyBasis(IDX, "09003", BS, PX, "CT", "Connecticut", "Hartford County");
  assert.match(wb.why, /^no Connecticut corn basis middle this week$/);
  assert.match(C.countyBasis(IDX, "55011", BS, PX, "WI", "Wisconsin", "Buffalo County").why, /^fewer than 3 corn bids in Buffalo County posted against Dec$/);
  assert.match(C.countyBasis(IDX, "17173", BS, { quotes: {} }, "IL", "Illinois", "Shelby County").why, /futures price for Dec '26 did not load/);
  assert.match(C.countyBasis(null, "17173", BS, PX, "IL", "Illinois", "Shelby County").why, /elevator network did not answer/);
});

test("new recorded farm sales: counts only, exact only when the list reaches back past the month", () => {
  const wi = FX("land-sales-wi.json");
  const b = C.newSales(wi, "55005", "WI");
  assert.deepEqual([b.n, b.exact, b.month], [3, true, "September"]);
  const bl = C.salesLine(b, "Barron County");
  assert.equal(bl.lead, "3 recorded farm sales dated in September");
  assert.equal(bl.date, "records through Sep 30, read Oct 18");
  // all six kept rows are September: there may be more, so "at least"
  const full = C.newSales(wi, "55007", "WI");
  assert.deepEqual([full.n, full.exact], [6, false]);
  assert.equal(C.salesLine(full, "Bayfield County").lead, "at least 6 recorded farm sales dated in September");
  const none = C.salesLine(C.newSales(wi, "55011", "WI"), "Buffalo County");
  assert.equal(none.status, "held");
  // withheld
  assert.match(C.newSales(null, "55005", "WI").why, /did not load/);
  assert.match(C.newSales(wi, "55999", "WI").why, /no recorded sales list for this county/);
  assert.match(C.newSales(null, "09003", "CT").why, /^recorded farm sales are on hand for Illinois, Indiana, Wisconsin, Vermont and New Jersey only$/);
});

test("the sentence: changed lines lead; nothing changed says so in one line; nothing known says that", () => {
  const sh = [C.droughtLine(C.droughtChange(DR, "17173")), C.bidLine(C.topBid(IDX, PREV, ...SHELBY, TODAY)), C.salesLine(C.newSales(FX("land-sales-il.json"), "17173", "IL"), "Shelby County")];
  assert.equal(C.summary(sh), "Drought worse (D0 to D1); top corn bid within 50 mi now at a different place than Oct 22; 2 recorded farm sales dated in September.");
  const held = [C.droughtLine(C.droughtChange(DR, "55005")), C.bidLine(C.topBid(IDX, PREV, ...CHETEK, TODAY))];
  assert.equal(C.summary(held), "Nothing changed here this week.");
  const ct = [C.droughtChange(DR, "09003"), C.topBid(IDX, PREV, ...HARTFORD, TODAY)].map((l, i) => Object.assign(l, { label: ["Drought", "Top corn bid"][i] }));
  assert.equal(C.summary(ct), "Not enough on file here to say what changed this week.");
  const html = C.linesHtml(held.concat(ct));
  assert.match(html, /<b>Held<\/b>Drought at D2; the top posted corn bid/);
  assert.match(html, /<b>Not shown<\/b>Drought: the Drought Monitor maps Connecticut/);
  for (const n of NAMES) assert.ok(!html.includes(n) && !C.summary(sh).includes(n), "names " + n);
});

test("the page: one mount, the map code loads only once a place is open, files by state, no reader point in a URL", () => {
  const page = read("fast-facts.html"), here = read("components/here.js"), cm = read("components/changemap.js");
  assert.match(page, /<p id="h-where" class="h-where"><\/p>\n<div id="h-cm" class="cm" hidden><\/div>/);
  assert.doesNotMatch(page, /changemap\.js/, "not a page script: loaded by here.js");
  assert.match(page, /\/components\/here\.js\?v=34"/);   // v34: change-lines.js v3 (fx/landnj, New Jersey sales)
  assert.match(here, /var CM_JS = '\/components\/changemap\.js\?v=\d+';/);
  assert.match(here, /loadCards\(fips\);\n\s+changeMap\(fips\);/);
  for (const f of [cm]) assert.doesNotMatch(f, /—/);
  const urls = [...cm.matchAll(/getJSON\(([^,)]+)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 6);
  for (const u of urls) assert.doesNotMatch(u, /lat|lng|lon|zip/i, u);
  assert.match(cm, /'\/data\/arc-plc\/geo\/' \+ ctx\.st \+ '\.json'/, "outlines from the file the ARC/PLC page already ships");
  assert.doesNotMatch(urls.join(" "), /counties\.geo|elevators|geo-crosswalk/, "no whole-US or build-only file in the browser");
  const gz = zlib.gzipSync(Buffer.from(cm), { level: 9 }).length;
  assert.ok(gz < 13000, "changemap.js stays small: " + gz + " B gzipped");
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const FIXED = {
  "/data/drought/county-week.json": "drought.json", "/data/basis-states.json": "basis-states.json", "/data/prices.json": "prices.json",
  "/data/land-sales/wi.json": "land-sales-wi.json", "/data/land-sales/il.json": "land-sales-il.json",
};
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".ics": "text/calendar" };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const bp = /^\/data\/bids-prev\/([A-Z]{2})\.json$/.exec(p);
    if (bp) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(PREV[bp[1]] || { rows: {} })); return; }
    if (FIXED[p]) { res.writeHead(200, { "content-type": "application/json" }); res.end(read("test/fixtures/changemap/" + FIXED[p])); return; }
    if (p === "/fast-facts") p += ".html";
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("in a browser: three counties at 390 and 1280; the sentence, the map, the withheld lines, no names, the point stays here", { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const cases = [
    { url: "/fast-facts?fips=17173", lead: /^Drought worse \(D0 to D1\); top corn bid within 50 mi now at a different place than Oct 22; 2 recorded farm sales dated in September\.$/, top: /^Shelby Co\., IL\s*corn\s*[A-Z][a-z]{2} \d+$/, worse: 20, pts: true },
    { saved: "54728", url: "/fast-facts", lead: /^3 recorded farm sales dated in September\.$/, top: /^Barron Co\., WI\s*corn/, held: /Held\s*Drought at D2; the top posted corn bid within 50 mi \(Oct delivery\) is at the same place as on Oct 22/, worse: 0, pts: true },
    { url: "/fast-facts?fips=09003", lead: /^Not enough on file here to say what changed this week\.$/, top: /^Hartford Co\., CT/, off: /Not shown\s*Drought: the Drought Monitor maps Connecticut.s nine planning regions[\s\S]*Top corn bid: no posted corn bid within 50 mi in our network; Corn basis: no Connecticut corn basis middle this week; Land sales: recorded farm sales are on hand for Illinois, Indiana, Wisconsin, Vermont and New Jersey only\./, worse: 0, pts: false },
  ];
  try {
    for (const c of cases) for (const w of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: w === 390 ? 844 : 800 } });
      if (c.saved) await ctx.addInitScript((z) => { try { localStorage.setItem("agsist_user_zip", z); localStorage.setItem("agsist_zip", z); } catch (e) {} }, c.saved);
      const pg = await ctx.newPage(), errs = [], urls = [];
      pg.on("pageerror", (e) => errs.push(String(e)));
      await pg.route("**/*", (r) => {
        const u = r.request().url(); urls.push(u);
        if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
        if (u.includes("dnilgis.github.io/bids/data/merged-index.json")) return r.fulfill({ contentType: "application/json", body: JSON.stringify(IDX) });
        return r.abort();
      });
      await pg.goto(`http://127.0.0.1:${port}${c.url}`, { waitUntil: "load" });
      await pg.waitForSelector("#h-cm .cm-svg", { timeout: 30000 });
      const at = c.url + " @" + w;
      assert.match((await pg.textContent("#cm-top")).trim(), c.top, at);
      assert.match((await pg.textContent("#h-cm .cm-lead")).trim(), c.lead, at);
      const side = await pg.innerText("#h-cm .cm-side");
      if (c.held) assert.match(side, c.held, at);
      if (c.off) assert.match(side, c.off, at);
      // every line names its source; the map counts what it fills
      if (!c.off) assert.match(side, /U\.S\. Drought Monitor|Posted elevator bids/, at);
      assert.equal(await pg.$$eval("#h-cm path.cm-worse", (l) => l.length), c.worse, at);
      assert.ok(c.pts ? (await pg.$$eval("#h-cm circle.cm-pt", (l) => l.length)) > 0 : (await pg.$$("#h-cm circle.cm-pt")).length === 0, at);
      assert.equal((await pg.$$("#h-cm path.cm-me")).length, 1, "the place's own county is outlined " + at);
      assert.equal((await pg.$$("#h-cm circle.cm-you")).length, 1, at);
      assert.match(await pg.textContent("#h-cm figcaption"), /U\.S\. Drought Monitor/);
      const box = await pg.evaluate(() => {
        const m = document.querySelector("#h-cm .cm-svg").getBoundingClientRect(), s = document.querySelector("#h-cm .cm-side").getBoundingClientRect();
        return { top: m.top + scrollY, mapRight: m.right, sideLeft: s.left, sw: document.documentElement.scrollWidth };
      });
      assert.ok(box.sw <= w + 1, "no sideways scroll " + at + ": " + box.sw);
      if (w === 390 && !c.saved) assert.ok(box.top < 560, "map top under 560 px on a phone " + at + ": " + box.top);
      if (w === 1280) assert.ok(box.mapRight <= box.sideLeft, "map left, lines right at 1280 " + at);
      // tap a county: its own change in words
      if (w === 1280) {
        await pg.click("#h-cm path.cm-me", { force: true });
        assert.match(await pg.textContent("#h-cm .cm-tap"), /^Shelby: worse, D1 moderate drought from D0 abnormally dry \(Oct 20 map\)\.$|^Barron: held at D2 severe drought \(Oct 20 map\)\.$|^Hartford: the Drought Monitor maps Connecticut/);
      }
      // sticky under the menu once scrolled
      await pg.evaluate(() => window.scrollTo({ top: document.querySelector("#h-cm .cm-side").getBoundingClientRect().top + scrollY, behavior: "instant" }));
      const pin = await pg.evaluate(() => { const t = document.querySelector("#cm-top").getBoundingClientRect(), n = document.querySelector(".nav"); return { t: t.top, n: n ? n.getBoundingClientRect().bottom : 0 }; });
      assert.ok(Math.abs(pin.t - pin.n) <= 2, "the county line stays under the menu " + at + ": " + JSON.stringify(pin));
      // never a name; the reader's point never leaves the page
      const txt = await pg.textContent("#h-cm");
      for (const n of NAMES) assert.ok(!txt.includes(n), at + " names " + n);
      for (const u of urls) {
        assert.doesNotMatch(u, /45\.31|91\.65|39\.39|88\.80|41\.80|72\.73/, "a request carries the point: " + u);
        // the typed-ZIP lookup reads our own data/places/zip/ file (2026-10-29), so no outside call carries a ZIP
        if (!u.startsWith(`http://127.0.0.1:${port}`)) assert.doesNotMatch(u, /54728/, "a ZIP left the page: " + u);
      }
      assert.deepEqual(errs, [], at);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
