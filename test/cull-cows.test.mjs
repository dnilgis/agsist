/* Cull cow prices: scripts/fetch_cull_cows.py, data/cull-cows.json, components/cull-cows.js,
 * the "Cull cows this week" sections on /cattle-auction-prices and /milk-prices.
 *
 *   node --test test/cull-cows.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { extname, join, normalize } from "node:path";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const js = readFileSync(ROOT + "components/cull-cows.js", "utf8");
const ctx = {};
vm.runInNewContext(js, ctx);
const C = ctx.AgCullCows;
const cattle = readFileSync(ROOT + "cattle-auction-prices.html", "utf8");
const milk = readFileSync(ROOT + "milk-prices.html", "utf8");
const wf = readFileSync(ROOT + ".github/workflows/cattle-auction.yml", "utf8");
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("the reader's selftest passes on the real USDA fixtures (hand-checked rows, refusals, regional middle)", () => {
  const out = execFileSync("python3", [ROOT + "scripts/fetch_cull_cows.py", "--selftest"], { encoding: "utf8" });
  assert.match(out, /all cull cow checks pass/);
  assert.doesNotMatch(out, /FAIL/);
  assert.ok((out.match(/^ {2}ok {3}/gm) || []).length >= 55, "the selftest shrank");
  for (const f of ["ams_1797-real.txt", "ams_2528-real.txt", "ams_1825-real.txt", "ams_2190-2026-10-26.txt", "ams_2207-real.txt", "ams_1970-real.txt"])
    assert.ok(existsSync(ROOT + "test/fixtures/cattle-auction/" + f), f);
});

test("one fetch, one parser family: the cull reader reuses the feeder reader's fetch, titles and page-break handling", () => {
  const py = readFileSync(ROOT + "scripts/fetch_cull_cows.py", "utf8");
  assert.match(py, /import fetch_cattle_auction as CA/);
  assert.match(py, /CA\.table_block\(/);
  assert.match(py, /CA\.PAGEBREAK_RE/);
  assert.match(py, /getter or CA\.fetch/);
  assert.doesNotMatch(py, /urllib|AMS\.get\(/, "no HTTP code of its own");
  const ca = readFileSync(ROOT + "scripts/fetch_cattle_auction.py", "utf8");
  assert.match(ca, /def table_block\(/);
  assert.match(ca, /CC\.run\(ROOT, getter=cached\)/, "the feeder run hands its fetched reports to the cull reader");
});

test("the cattle auction workflow runs the cull selftest and commits the file, no new schedule", () => {
  assert.match(wf, /python scripts\/fetch_cull_cows\.py --selftest/);
  assert.match(wf, /FILES="[^"]*data\/cull-cows\.json[^"]*"/);
  assert.equal((wf.match(/- cron:/g) || []).length, 2);
  const srcs = JSON.parse(readFileSync(ROOT + "scripts/cattle_auction_sources.json", "utf8"));
  assert.equal(srcs.slaughter_reports.length, 16);
  const ids = new Set(srcs.barns.map((b) => b.id).concat(srcs.own_reports.map((b) => b.id)));
  for (const r of srcs.slaughter_reports) {
    assert.ok(ids.has(r.barn), r.number + " barn");
    const b = srcs.barns.find((x) => x.id === r.barn);
    assert.ok(r.match || (b && b.match), r.number + " has no title pattern");
    assert.match(r.title, new RegExp(r.match || b.match, "i"), r.number + " title check would refuse its own report");
  }
});

/* a small file in the shape the pipeline writes */
const sale = (date, boner, extra = {}) => ({ date, report: "1797", url: "https://mymarketnews.ams.usda.gov/viewReport/1797",
  classes: { boner: [{ dressing: "Average", head: 84, avg_wt: 1233, cwt: boner, per_head: Math.round(boner * 1233) / 100, lo: 115, hi: 138, rows: 1 }] },
  refused: [], ...extra });
const doc = {
  updated: "2026-10-28T20:00:00Z", as_of: "2026-10-28",
  regional: { class: "boner", dressing: "Average", window_days: 14, from: "2026-10-15", to: "2026-10-28", barns: 3, min_barns: 3,
    median_cwt: 131.38, low_cwt: 125.51, high_cwt: 135.1, median_per_head: 1619.92, median_wt: 1233, head: 150,
    states: ["KY", "MO", "OK"], first_sale: "2026-10-21", last_sale: "2026-10-28" },
  barns: [
    { id: "joplin-mo", name: "Joplin Regional Stockyards", town: "Carthage", state: "MO", sales: [sale("2026-10-21", 131.38)] },
    { id: "woodward-ok", name: "Woodward Livestock Auction", town: "Woodward", state: "OK",
      sales: [sale("2026-10-28", 135.1, { refused: [{ class: "breaker", why: "weight range 338-1410 outside (500, 3000): misprint" }] })] },
    { id: "stanford-ky", name: "Blue Grass South Stockyards", town: "Stanford", state: "KY", sales: [sale("2026-10-26", 125.51)] },
    { id: "old-ky", name: "Old Barn", town: "Paris", state: "KY", sales: [sale("2026-10-13", 99)] },
    { id: "none", name: "No Sale", town: "X", state: "IL", status: { ok: false } },
  ],
};

test("recent: the 14 days ending today, never a later date, sorted by state and town", () => {
  assert.deepEqual(C.recent(doc, "2026-10-28").map((b) => b.id), ["stanford-ky", "joplin-mo", "woodward-ok"]);
  // Oct 13 is 15 days before Oct 28; on Oct 26 the Oct 28 sale is in the future
  assert.deepEqual(C.recent(doc, "2026-10-26").map((b) => b.id), ["old-ky", "stanford-ky", "joplin-mo"]);
});

test("the regional sentence is the pipeline's numbers, withheld in words under the barn floor and when too old", () => {
  const r = C.regionalLine(doc, "2026-10-28");
  assert.equal(r.ok, true);
  assert.match(r.text, /middle price of \$131\.38 per cwt at 3 barns in Kentucky, Missouri and Oklahoma that sold Oct 21 to Oct 28/);
  assert.match(r.text, /lowest barn \$125\.51, highest \$135\.10\)\. Middle weight 1,233 lb, middle price a head \$1,620 before selling costs\./);
  const w = C.regionalLine({ ...doc, regional: { ...doc.regional, barns: 2, median_cwt: undefined } }, "2026-10-28");
  assert.equal(w.ok, false);
  assert.match(w.text, /Not enough barns .* \(2 barns; it takes 3\)\./);
  assert.doesNotMatch(w.text, /\$\d/);
  const old = C.regionalLine(doc, "2026-11-11");
  assert.equal(old.ok, false);
  assert.match(old.text, /too long ago/);
  assert.equal(C.lateNote(doc, "2026-10-31"), "");
  assert.match(C.lateNote(doc, "2026-11-01"), /Last read from USDA Oct 28; no newer read/);
});

test("a class line: sold, refused (named, no number), or none sold", () => {
  const s = doc.barns[1].sales[0];
  assert.equal(C.avgOf(s, "boner").row.cwt, 135.1);
  assert.match(C.avgOf(s, "breaker").refused, /misprint/);
  assert.deepEqual(Object.keys(C.avgOf(s, "lean")), []);
});

test("both pages carry the section and the script once; the component credits USDA; no em dashes", () => {
  for (const [name, h, mode] of [["cattle", cattle, "cattle"], ["milk", milk, "dairy"]]) {
    assert.equal((h.match(/data-cull-cows="/g) || []).length, 1, name);
    assert.match(h, new RegExp(`data-cull-cows="${mode}"`), name);
    assert.equal((h.match(/<script src="\/components\/cull-cows\.js\?v=\d+" defer><\/script>/g) || []).length, 1, name);
    assert.match(h, /Cull cows this week<\/h2>/, name);
    const sec = h.slice(h.indexOf("data-cull-cows") - 600, h.indexOf("data-cull-cows") + 900);
    assert.doesNotMatch(sec, /—/, name + " em dash");
  }
  // the source is named, not linked (no direct links to data sources, Oct 29, 2026)
  assert.match(js, /USDA AMS Livestock, Poultry and Grain ' \+\s*'Market News auction reports, as reported by USDA, not the barns/);
  assert.doesNotMatch(js, /—/);
  assert.match(js, /<b>Breakers<\/b> \(75 to 80% lean\)/);
  assert.match(js, /<b>Boners<\/b> \(80 to 85%\)/);
  assert.match(js, /<b>Leans<\/b> \(85 to 90%\)/);
  assert.match(js, /try \{ pick = \(ls && ls\.getItem\(KEY\)\)/, "browser storage read is guarded");
});

test("a shipped data file holds only checked numbers, and its regional middle is the middle of its own barns", () => {
  const f = ROOT + "data/cull-cows.json";
  if (!existsSync(f)) return;
  const d = JSON.parse(readFileSync(f, "utf8"));
  let rows = 0;
  for (const b of d.barns) {
    for (const s of b.sales || []) {
      assert.match(s.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(s.url, /^https:\/\/mymarketnews\.ams\.usda\.gov\/viewReport\/\d{3,5}$/, b.id);
      for (const [cls, list] of Object.entries(s.classes)) {
        assert.ok(cls in d.classes, cls);
        for (const r of list) {
          rows++;
          assert.ok(r.head > 0 && r.cwt > 0 && r.lo <= r.cwt && r.cwt <= r.hi, `${b.id} ${cls} ${r.dressing}`);
          near(r.cwt * r.avg_wt / 100, r.per_head, Math.max(2, r.per_head * 0.003), `${b.id} ${cls} per head`);
        }
      }
    }
  }
  assert.ok(rows >= 1);
  const r = d.regional;
  if (r.median_cwt == null) { assert.ok(r.withheld && r.barns < r.min_barns); return; }
  const v = d.barns.filter((b) => b.sales && b.sales[0] && b.sales[0].date >= r.from && b.sales[0].date <= r.to)
    .map((b) => (b.sales[0].classes.boner || []).find((x) => x.dressing === "Average")).filter(Boolean).map((x) => x.cwt).sort((a, b) => a - b);
  assert.equal(v.length, r.barns);
  assert.ok(r.barns >= r.min_barns);
  const m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  near(m, r.median_cwt, 0.006, "regional middle");
  assert.equal(r.low_cwt, v[0]);
  assert.equal(r.high_cwt, v[v.length - 1]);
});

/* ---------------- browser ---------------- */
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
function serve(data) {
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/data/cull-cows.json") {
      if (!data) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(data)); return;
    }
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, srv, page, width) {
  const c = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  const p = await c.newPage();
  await p.clock.setFixedTime(new Date("2026-10-28T21:00:00Z"));
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await p.goto(`http://127.0.0.1:${srv.address().port}/${page}`, { waitUntil: "load" });
  return { p, errs };
}

test("browser: both pages show the regional line, a barn table on a tap, the credit, no sideways scroll at 390 and 1280", { skip }, async () => {
  const srv = await serve(doc), browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [page, sel] of [["cattle-auction-prices", "#cull-cows"], ["milk-prices", "#dp-cull-sec"]]) {
      for (const w of [390, 1280]) {
        const { p, errs } = await open(browser, srv, page, w);
        await p.waitForSelector(sel + " .cc-line");
        const t = await p.textContent(sel);
        assert.match(t, /middle price of \$131\.38 per cwt at 3 barns/, page);
        assert.match(t, /Source: USDA AMS Livestock, Poultry and Grain Market News auction reports/, page);
        await p.click(sel + " details.cc-all summary");
        const rows = await p.$$eval(sel + " .cc-t tbody tr", (x) => x.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
        assert.equal(rows.length, 3, page);
        assert.match(rows[0], /^Blue Grass South Stockyards Stanford, KY Sale of Oct 26 \$125\.51 84 hd, 1,233 lb \$1,548 a head/);
        assert.match(rows[2], /Woodward.*Sale of Oct 28 \$135\.10 .* not read/);
        await p.selectOption(sel + ' [data-cc="state"]', "MO");
        assert.equal(await p.$$eval(sel + " .cc-t tbody tr", (x) => x.length), 1);
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${page} ${w} sideways`);
        assert.deepEqual(errs, []);
      }
    }
  } finally { await browser.close(); srv.close(); }
});

test("browser: no data file, the section says the prices did not load and links USDA, nothing else breaks", { skip }, async () => {
  const srv = await serve(null), browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { p, errs } = await open(browser, srv, "cattle-auction-prices", 390);
    await p.waitForFunction(() => /did not load/.test(document.querySelector("#cull-cows").textContent));
    assert.equal(await p.$$eval("#cull-cows .cc-t", (x) => x.length), 0);
    assert.deepEqual(errs, []);
  } finally { await browser.close(); srv.close(); }
});
