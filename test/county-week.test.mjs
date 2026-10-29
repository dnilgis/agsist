/* Your county this week (Sig, Oct 27 2026: inside the existing Daily slots; no new list, sender
 * or cron). Thursdays, for readers who tick it in the Daily ask and saved a place, mirrored as
 * "This week here" on the Farmland Atlas county home.
 *
 *   node --test test/county-week.test.mjs
 *
 * One line code (components/change-lines.js) for the Fast Facts map, the Daily and the county home,
 * checked on the real rows frozen in test/fixtures/changemap: Shelby IL (drought D0 to D1: a block),
 * Barron WI (everything held: no block), Hartford CT (nothing we can back: no block). Every
 * withhold case, the no-change case, the worker's cw field, the tick (never pre-ticked), the
 * tagged link, and in a browser the tick and the county home at 390 and 1280. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const L = require(ROOT + "components/change-lines.js");
const C = require(ROOT + "components/changemap.js");
const { run, place } = await import(pathToFileURL(ROOT + "scripts/county_week.mjs").href);
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const FX = (p) => JSON.parse(read("test/fixtures/changemap/" + p));
const clone = (o) => JSON.parse(JSON.stringify(o));
const IDX = FX("index.json"), PREV = FX("bids-prev.json"), DR = FX("drought.json"), BS = FX("basis-states.json"), PX = FX("prices.json");
const WI = FX("land-sales-wi.json"), IL = FX("land-sales-il.json");
const THU = "2026-10-29";
const CHETEK = [45.31413, -91.651], SHELBY = [39.391, -88.806], HARTFORD = [41.804, -72.732];
const NAMES = [...new Set(IDX.places.map((p) => String(p.operator || "").trim()).filter((n) => n.length > 3))];
const DASH = /[–—]|&mdash;|&ndash;/;
const FILES = { drought: DR, index: IDX, prev: PREV, states: BS, prices: PX };
const ctx = (fips, st, stName, name, ll, today = THU) => ({ fips, st, stName, name, lat: ll[0], lng: ll[1], today });
/* the driver's reader on the frozen files; outlines and county names are the repo's own static files */
const MAP = { "data/drought/county-week.json": DR, "data/basis-states.json": BS, "data/prices.json": PX, "data/land-sales/wi.json": WI, "data/land-sales/il.json": IL };
function frozen(rel) {
  const m = /^data\/bids-prev\/([A-Z]{2})\.json$/.exec(rel);
  if (m) return PREV[m[1]] || null;
  if (rel in MAP) return clone(MAP[rel]);
  try { return JSON.parse(read(rel)); } catch (e) { return null; }
}

test("one set of lines: changemap.js draws from change-lines.js and keeps no copy of its own", () => {
  for (const k of ["droughtChange", "droughtLine", "topBid", "bidLine", "countyBasis", "basisLine", "newSales", "salesLine", "summary", "linesHtml"]) {
    assert.equal(C[k], L[k], k + " is the shared function");
  }
  const cm = read("components/changemap.js");
  for (const f of ["droughtChange", "topBid", "countyBasis", "newSales", "basisLine", "salesLine"]) assert.doesNotMatch(cm, new RegExp("function " + f + "\\b"), f + " lives in change-lines.js only");
  for (const f of ["components/change-lines.js", "components/changemap.js", "components/county-home.js", "scripts/county_week.mjs"]) assert.doesNotMatch(read(f), DASH, f);
  // the Fast Facts map keeps its 50 mi; the weekly lines use 30
  assert.equal(L.RING_MI, 50); assert.equal(L.WEEK_MI, 30);
});

test("Shelby IL: drought worse leads, the basis level beside it, held lines in one row, all dated and sourced", () => {
  const lines = L.weekLines(ctx("17173", "IL", "Illinois", "Shelby County", SHELBY), { ...FILES, sales: IL });
  assert.deepEqual(lines.map((l) => [l.label, l.status]), [["Drought", "changed"], ["Top corn bid", "held"], ["Corn basis", "level"], ["Land sales", "held"]]);
  const b = L.weekBlock(lines);
  assert.equal(b.lead, "Drought worse (D0 to D1).");
  assert.deepEqual(b.rows.map((r) => r.kind), ["changed", "level", "held"]);
  assert.equal(b.rows[0].date, "maps of Oct 13 and Oct 20");
  assert.equal(b.rows[0].src, "U.S. Drought Monitor");
  assert.match(b.rows[1].text, /^Posted against Dec: Shelby County middle 30 under \(8 locations, 4 companies\), Illinois middle 25 under \(\d+ locations(, \d+ companies)?\): 5 cents weaker than the state middle\.$/);
  assert.match(b.rows[2].text, /^The top posted corn bid within 30 mi \(Oct delivery\) is at the same place as on Oct 22, \$4\.32, down 9 cents; no new recorded farm sales this week \(the state record was last read Oct 18\)\.$/);
  assert.equal(b.rows[2].date, "Top corn bid: Oct 22 and Oct 27; Land sales: records through Sep 30, read Oct 18");
  for (const r of b.rows) assert.ok(r.date && r.src, r.label);
  assert.deepEqual(b.off, []);
  const all = JSON.stringify(b);
  for (const n of NAMES) assert.ok(!all.includes(n), "names " + n);
});

test("nothing changed: no block (Barron WI); nothing we can back: no block (Hartford CT)", () => {
  const barron = L.weekLines(ctx("55005", "WI", "Wisconsin", "Barron County", CHETEK), { ...FILES, sales: WI });
  assert.deepEqual(barron.map((l) => l.status), ["held", "held", "level", "held"]);
  assert.equal(L.weekBlock(barron), null);
  const ct = L.weekLines(ctx("09003", "CT", "Connecticut", "Hartford County", HARTFORD), { ...FILES, sales: null });
  assert.deepEqual(ct.map((l) => l.status), ["withheld", "withheld", "withheld", "withheld"]);
  assert.equal(L.weekBlock(ct), null);
  assert.equal(L.weekBlock([]), null);
});

test("withheld lines never print a number; they go to off with their reason", () => {
  // the earlier bids did not load: the bid line is withheld, the drought change still makes a block
  const noPrev = L.weekLines(ctx("17173", "IL", "Illinois", "Shelby County", SHELBY), { ...FILES, prev: {}, sales: IL });
  assert.equal(noPrev[1].status, "withheld");
  // with no bids-prev for the state at all, topBid says the earlier prices did not load
  assert.match(noPrev[1].why, /earlier posted prices did not load/);
  const b = L.weekBlock(noPrev);
  assert.ok(!b.rows.some((r) => /corn bid/i.test(r.label)), "no bid row");
  assert.deepEqual(b.off.map((o) => o.label), ["Top corn bid"]);
  // no network, no drought file, no prices
  const none = L.weekLines(ctx("17173", "IL", "Illinois", "Shelby County", SHELBY), { sales: IL });
  assert.deepEqual(none.map((l) => l.status), ["withheld", "withheld", "withheld", "held"]);
  assert.equal(L.weekBlock(none), null, "a held sales line alone is not a change");
  // a sales file that does not say when it was read: withheld, not counted
  const undated = clone(IL); delete undated.fetched;
  assert.match(L.newSales(undated, "17173", "IL", "2026-10-22").why, /does not say when it was read/);
  // a state with no sales record
  assert.match(L.newSales(null, "09003", "CT", "2026-10-22").why, /Illinois, Indiana, Wisconsin and Vermont only/);
});

test("new recorded land sales: counted only in the week the state record was read; counts, never names", () => {
  const fresh = clone(WI); fresh.fetched = "2026-10-27";
  const s = L.newSales(fresh, "55005", "WI", L.weekAgo(THU));
  assert.deepEqual([s.n, s.exact, s.stale], [3, true, undefined]);
  const lines = L.weekLines(ctx("55005", "WI", "Wisconsin", "Barron County", CHETEK), { ...FILES, sales: fresh });
  const b = L.weekBlock(lines);
  assert.equal(b.lead, "3 recorded farm sales dated in September.");
  assert.equal(b.rows[0].text, "3 recorded farm sales of 10 acres or more in Barron County dated in September. Counts only; the sales list is on the county land page.");
  const stale = L.newSales(WI, "55005", "WI", L.weekAgo(THU));
  assert.equal(stale.stale, true);
  assert.equal(L.salesLine(stale, "Barron County").status, "held");
  assert.equal(L.weekAgo("2026-10-29"), "2026-10-22");
  assert.equal(L.weekAgo("x"), null);
  // Fast Facts keeps its month view: no since, no stale
  assert.equal(L.newSales(WI, "55005", "WI").stale, undefined);
});

test("the place: a point finds its county in the state's own outlines", () => {
  const wi = JSON.parse(read("data/arc-plc/geo/WI.json")), il = JSON.parse(read("data/arc-plc/geo/IL.json"));
  assert.equal(L.countyAt(wi, ...CHETEK)[0], "55005");
  assert.equal(L.countyAt(il, ...SHELBY)[0], "17173");
  assert.equal(L.countyAt(wi, ...SHELBY), null, "a point outside the state");
  assert.equal(L.countyAt(null, ...CHETEK), null);
});

test("the Daily's driver: opaque keys in, county blocks out, counts only on stderr", () => {
  const input = { today: THU, index: IDX, places: [
    { k: "p0", lat: SHELBY[0], lng: SHELBY[1], st: "IL" }, { k: "p1", lat: CHETEK[0], lng: CHETEK[1], st: "WI" },
    { k: "p2", lat: HARTFORD[0], lng: HARTFORD[1], st: "CT" }, { k: "p3", lat: 0, lng: 0, st: "XX" }] };
  const { out, n } = run(input, frozen);
  assert.deepEqual(n, { places: 4, block: 1, nochange: 2, noplace: 1 });
  assert.deepEqual(Object.keys(out).sort(), ["p0", "p1", "p2"]);
  assert.equal(out.p0.url, "/farmland-atlas/illinois/shelby-county");
  assert.equal(out.p0.county, "Shelby County");
  assert.equal(out.p1.block, null);
  assert.equal(out.p2.block, null);
  assert.doesNotMatch(JSON.stringify(out), /39\.39|88\.80|45\.31|91\.65/, "no point in the answer");
  // the command line: stdin in, stdout out, and stderr holds counts only
  const err = execFileSync("bash", ["-c", "node scripts/county_week.mjs 2>&1 >/dev/null"], { cwd: ROOT, input: JSON.stringify(input), encoding: "utf8" });
  assert.match(err, /^county week: 4 place\(s\), \d+ with a change, \d+ with none, \d+ not placed\n$/);
  assert.equal(place({ st: "WI" }, THU, IDX, frozen).status, "noplace");
});

test("the sender and the email: Thursdays, ticked readers with a ZIP, the Only here slot, one tagged link", () => {
  const out = execFileSync("python3", ["scripts/test_county_week.py"], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
  assert.match(out, /county week: \d+ passed, 0 failed/);
  const sd = read("scripts/send_daily.py");
  // counts only in the public log: the print names no address, ZIP or county
  const pr = sd.slice(sd.indexOf('print("your county this week:'), sd.indexOf('print("your county this week skipped'));
  assert.doesNotMatch(pr, /email|\[\"zip\"\]|county\"\]/);
  assert.match(sd, /COUNTY_LINES\.get\(k\) or None/);
  assert.match(read("scripts/daily_v2.py"), /CW_CONTENT = "countyweek"/);
});

// ---------------------------------------------------------------- the worker's cw field
async function worker() {
  const tmp = path.join(os.tmpdir(), "subs-worker-cw-" + process.pid + "-" + Math.random().toString(36).slice(2) + ".mjs");
  fs.copyFileSync(path.join(ROOT, "workers/subs-worker.js"), tmp);
  const w = (await import(pathToFileURL(tmp).href)).default;
  fs.unlinkSync(tmp);
  const store = new Map(), meta = new Map();
  const env = { UNSUB_SECRET: "sec", LIST_TOKEN: "tok", SUBS: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v, o) { store.set(k, v); if (o && o.metadata) meta.set(k, o.metadata); },
    async delete(k) { store.delete(k); meta.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: meta.get(name) })), list_complete: true }; } } };
  let ip = 0;
  const post = (p, body, form) => w.fetch(new Request("https://x.dev" + p, { method: "POST",
    headers: Object.assign({ "Origin": "https://agsist.com", "CF-Connecting-IP": "10.0.1." + (++ip) }, form ? {} : { "Content-Type": "application/json" }),
    body: form || JSON.stringify(body) }), env);
  const get = async (p) => (await (await w.fetch(new Request("https://x.dev" + p), env)).json());
  return { store, post, get };
}

test("worker v5.56: cw is kept only when ticked, a re-signup without it leaves it, /list and /count carry it", async () => {
  const { store, post, get } = await worker();
  const rec = (e) => JSON.parse(store.get("sub:" + e));
  assert.equal((await post("/subscribe", { email: "a@farm.com", source: "page:x", zip: "62565" })).status, 200);
  assert.equal("cw" in rec("a@farm.com"), false, "not ticked: no field at all");
  await post("/subscribe", { email: "b@farm.com", source: "page:x", zip: "62565", cw: true });
  assert.equal(rec("b@farm.com").cw, true);
  await post("/subscribe", { email: "b@farm.com", source: "page:y" });
  assert.equal(rec("b@farm.com").cw, true, "a second signup without the box keeps it");
  await post("/subscribe", { email: "b@farm.com", source: "page:y", cw: false });
  assert.equal("cw" in rec("b@farm.com"), false, "cw false clears it");
  const fd = new FormData(); fd.append("email", "c@farm.com"); fd.append("zip", "54728"); fd.append("cw", "on");
  await post("/subscribe", null, fd);
  assert.equal(rec("c@farm.com").cw, true, "a form's on");
  await post("/notice", { email: "d@farm.com", topic: "reports", source: "report:wasde:x", daily: true, zip: "54728", cw: true });
  assert.equal(rec("d@farm.com").cw, true, "the notice ask's Daily box carries it");
  await post("/subscribe", { email: "e@farm.com", source: "page:x", cw: "maybe" });
  assert.equal("cw" in rec("e@farm.com"), false, "anything else is not a tick");
  const list = await get("/list?token=tok&format=json");
  const by = Object.fromEntries(list.map((r) => [r.email, r]));
  assert.equal(by["c@farm.com"].cw, true);
  assert.equal("cw" in by["a@farm.com"], false, "every other row is as it was");
  const c = await get("/count?token=tok");
  assert.equal(c.daily_county_week, 2);
});

test("the Python readers of the list keep cw only when true", () => {
  const out = execFileSync("python3", ["-c", `
import sys, json
sys.path.insert(0, "scripts")
import subscribers, list_source
a = subscribers.parse_json([{"email": "a@x.com", "zip": "62565", "cw": True}, {"email": "b@x.com", "cw": "yes"}, {"email": "c@x.com"}])
b = list_source._sub_record("d@x.com", {"ts": 1, "cw": True})
c = list_source._sub_record("e@x.com", {"ts": 1})
print(json.dumps([a[0].get("cw"), "cw" in a[1], "cw" in a[2], b.get("cw"), "cw" in c]))`], { cwd: ROOT, encoding: "utf8" });
  assert.deepEqual(JSON.parse(out), [true, false, false, true, false]);
  assert.match(read("scripts/restore_signups.py"), /if d\.get\("cw"\) is True:\n\s+body\["cw"\] = True/);
});

test("the tick sits inside the Daily ask, never pre-ticked, and no notice ask carries it", () => {
  const sa = read("components/signup-ask.js");
  assert.match(sa, /if \(topic \|\| cbox \|\| !zrow\) return;/, "a notice ask never gets it");
  assert.match(sa, /lb\.innerHTML = '<input type="checkbox" id="' \+ cid \+ '"> ' \+ CW_LABEL;/);
  assert.doesNotMatch(sa, /sa-cw[^\n]*checked/);
  assert.match(sa, /if \(o\.cw === true\) body\.cw = true;/);
  assert.match(read("components/loader.js"), /signup-ask\.js\?v=20/);
  assert.match(read("index.html"), /signup-ask\.js\?v=20/);
});

test("the county home: one hidden mount on every county page, filled by county-home.js from change-lines.js", () => {
  const pg = read("farmland-atlas/illinois/shelby-county.html");
  assert.match(pg, /<section class="card cw" id="c-week" hidden aria-labelledby="c-week-h"><\/section>\n<div class="chg">/);
  assert.match(pg, /<div id="ch-live" hidden data-fips="17173" data-st="IL" data-name="Shelby County"/);
  const ch = read("components/county-home.js");
  assert.match(ch, /var CL_JS = '\/components\/change-lines\.js\?v=1';/);
  assert.match(ch, /L\.weekBlock\(L\.weekLines\(/);
  assert.match(read("components/here.js"), /var CL_JS = '\/components\/change-lines\.js\?v=2';/);   // v2: fx/landvt (Vermont sales); county-home.js stays v1 (its hash is on every Atlas page)
  const urls = [...ch.matchAll(/getJSON\(([^,)]+)/g)].map((m) => m[1]);
  for (const u of urls) assert.doesNotMatch(u, /lat|lng|zip/i, u);
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const FIXED = { "/data/drought/county-week.json": "drought.json", "/data/basis-states.json": "basis-states.json", "/data/prices.json": "prices.json",
  "/data/land-sales/wi.json": "land-sales-wi.json", "/data/land-sales/il.json": "land-sales-il.json" };
const ASK = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><main style="padding:0 16px"><div data-signup-ask="The markets, free, every morning in the AGSIST Daily" data-source="page:test"></div></main>
<script src="/components/signup-ask.js?v=20"></script></body></html>`;
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/ask-test") { res.writeHead(200, { "content-type": "text/html" }); res.end(ASK); return; }
    const bp = /^\/data\/bids-prev\/([A-Z]{2})\.json$/.exec(p);
    if (bp) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(PREV[bp[1]] || { rows: {} })); return; }
    if (FIXED[p]) { res.writeHead(200, { "content-type": "application/json" }); res.end(read("test/fixtures/changemap/" + FIXED[p])); return; }
    if (/^\/farmland-atlas\/[a-z-]+\/[a-z-]+$/.test(p)) p += ".html";
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("in a browser: the tick starts empty, sends cw only when ticked, needs a ZIP; 390 and 1280", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const w of [390, 1280]) {
      for (const tick of [false, true, "nozip"]) {
        const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: 844 } });
        const pg = await ctx.newPage(), bodies = [], errs = [];
        pg.on("pageerror", (e) => errs.push(String(e)));
        await pg.route("**/*", (r) => {
          const u = r.request().url();
          if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
          if (/\/subscribe$/.test(new URL(u).pathname)) { bodies.push(JSON.parse(r.request().postData() || "{}")); return r.fulfill({ contentType: "application/json", body: '{"ok":true}' }); }
          return r.abort();
        });
        await pg.goto(`http://127.0.0.1:${port}/ask-test`, { waitUntil: "load" });
        await pg.waitForSelector(".sa-in");
        assert.equal(await pg.locator('input[type="checkbox"]').count(), 0, "no box until the reader starts on the email");
        await pg.fill(".sa-in", "reader@example.com");
        const box = pg.locator(".sa-cw input");
        await box.waitFor();
        assert.equal(await box.isChecked(), false, "never pre-ticked");
        assert.match(await pg.textContent(".sa-cw"), /^ ?Thursdays, add what changed in my county: drought, nearby corn bids, land sales$/);
        const lb = await pg.locator(".sa-cw").boundingBox();
        assert.ok(lb.height >= 44, "a 44 px tap target: " + lb.height);
        await pg.fill(".sa-zin", tick === "nozip" ? "" : "62565");
        if (tick) await box.check();
        await pg.click(".sa-b");
        if (tick === "nozip") {
          await pg.waitForFunction(() => document.querySelector(".sa-m").textContent.length > 0);
          assert.equal(await pg.textContent(".sa-m"), "The county lines need your ZIP. Add it, or untick the box.");
          assert.equal(bodies.length, 0, "nothing sent");
        } else {
          await pg.waitForSelector(".sa-ok");
          assert.equal(bodies.length, 1);
          assert.equal(bodies[0].zip, "62565");
          assert.equal("cw" in bodies[0], tick === true, "cw only when ticked: " + JSON.stringify(Object.keys(bodies[0])));
        }
        assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no sideways scroll @" + w);
        assert.deepEqual(errs, []);
        await ctx.close();
      }
    }
  } finally { await browser.close(); srv.close(); }
});

test("in a browser: the county home shows This week here for Shelby IL, nothing for Barron WI; 390 and 1280", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const w of [390, 1280]) for (const c of [
      { url: "/farmland-atlas/illinois/shelby-county", shown: true, pt: /39\.39|88\.80/ },
      { url: "/farmland-atlas/wisconsin/barron-county", shown: false, pt: /45\.42|91\.84/ }]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: w === 390 ? 844 : 800 } });
      const pg = await ctx.newPage(), errs = [], urls = [];
      pg.on("pageerror", (e) => errs.push(String(e)));
      await pg.route("**/*", (r) => {
        const u = r.request().url(); urls.push(u);
        if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
        if (u.includes("dnilgis.github.io/bids/data/merged-index.json")) return r.fulfill({ contentType: "application/json", body: JSON.stringify(IDX) });
        return r.abort();
      });
      await pg.goto(`http://127.0.0.1:${port}${c.url}`, { waitUntil: "load" });
      const at = c.url + " @" + w;
      // the mirror fills after the bids rows; wait for the drought row as the sign the live part ran
      await pg.waitForFunction(() => { const r = document.querySelector('.lv[data-k="drought"] .r'); return r && r.textContent.length > 0; }, null, { timeout: 30000 });
      if (c.shown) {
        await pg.waitForSelector("#c-week:not([hidden])", { timeout: 30000 });
        const txt = await pg.innerText("#c-week");
        assert.match(txt, /^This week here\s*BIDS WITHIN 30 MI\s*Drought worse \(D0 to D1\)\./i, at);
        assert.match(txt, /Drought\. Worse this week: D1 moderate drought, from D0 abnormally dry a week earlier\./, at);
        assert.match(txt, /maps of Oct 13 and Oct 20 · U\.S\. Drought Monitor/, at);
        assert.match(txt, /Held\. /, at);
        for (const n of NAMES) assert.ok(!txt.includes(n), at + " names " + n);
        const box = await pg.evaluate(() => { const b = document.querySelector("#c-week").getBoundingClientRect(); return { l: b.left, r: b.right, sw: document.documentElement.scrollWidth }; });
        assert.ok(box.sw <= w + 1 && box.l >= 8 && box.r <= w - 8, "fits with a side gutter " + at + " " + JSON.stringify(box));
        await pg.locator("#c-week").screenshot({ path: path.join(os.tmpdir(), "county-week-" + c.url.split("/").pop() + "-" + w + ".png") });
      } else {
        await pg.waitForTimeout(1500);
        assert.equal(await pg.$eval("#c-week", (e) => e.hidden), true, "no change, no block " + at);
      }
      for (const u of urls) assert.doesNotMatch(u, /[?&](lat|lng|lon|zip)=/i, "no point in a request " + u);
      assert.deepEqual(errs, [], at);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
