/* /cash-bid-index: the AGSIST Cash Bid Index. Hand-worked math and the
 * refusal rules are in scripts/cash_bid_index.py --selftest; this runs it and
 * checks the shipped page, data and workflows. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const py = (args) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8" });

test("selftest: folding, averages, raised/cut, refusals, labels", () => {
  assert.match(py(["scripts/cash_bid_index.py", "--selftest"]), /cash_bid_index selftest ok/);
});

test("the page is what editions.json says", () => {
  assert.match(py(["scripts/cash_bid_index.py", "--check"]), /matches editions\.json/);
});

test("page: structure, Dataset JSON-LD, cite line, CSV, chart, method", () => {
  const h = read("cash-bid-index.html");
  const eds = JSON.parse(read("data/cash-index/editions.json")).editions;
  assert.ok(eds.length >= 1);
  const latest = eds[0];
  assert.match(h, /<title>AGSIST Cash Bid Index: cash corn and soybean bids by state \| AGSIST<\/title>/);
  assert.match(h, /<link rel="canonical" href="https:\/\/agsist\.com\/cash-bid-index">/);
  assert.equal((h.match(/<h1>/g) || []).length, 1);
  const ld = JSON.parse(h.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1].replace(/<\\\//g, "</"));
  const ds = ld["@graph"].find((x) => x["@type"] === "Dataset");
  assert.ok(ds && ds.distribution.length === eds.length && ds.distribution[0].encodingFormat === "text/csv");
  assert.equal(ds.author.jobTitle, "Certified Crop Adviser (CCA)");
  for (const e of eds) {
    assert.ok(existsSync(join(ROOT, `data/cash-index/${e.month}.csv`)), `${e.month}.csv`);
    assert.ok(h.includes(`AGSIST Cash Bid Index, ${e.label}, https://agsist.com/cash-bid-index#${e.month}`), "how to cite");
    assert.ok(e.findings.length >= 2 && e.findings.length <= 4, "2 to 4 findings");
    for (const f of e.findings) assert.ok(!/\b(record|ever|first time|all-time)\b/i.test(f), f);
    if (e.partial) assert.match(e.label, /partial month$/, "a partial month says so");
  }
  assert.match(h, /<svg class="cbi-chart"[^>]*role="img"/);
  assert.match(h, /<h2 id="method">Method<\/h2>/);
  // Oct 18: no name at the top of a page; it sits in one line at the end
  assert.match(h, /<p class="by-end"[^>]*>Made by <a href="\/about">Sigurd Lindquist, CCA<\/a>, Chetek, Wisconsin\.<\/p>/);
  assert.ok(!h.includes("—") && !read("scripts/cash_bid_index.py").includes("—"), "no em dashes");
  assert.ok(statSync(join(ROOT, "cash-bid-index.html")).size < 150 * 1024, "under the 150 KB page cap");
  // the latest edition's numbers in the CSV agree with the page
  const csv = read(`data/cash-index/${latest.month}.csv`).trim().split("\n");
  const all = csv.find((l) => l.startsWith(`${latest.month},corn,ALL,`));
  if (latest.crops.corn) assert.ok(all.includes(`,${latest.crops.corn.overall.n},`), "CSV overall corn count");
});

test("the data stays small: one entry a month, working files capped", () => {
  assert.ok(statSync(join(ROOT, "data/cash-index/editions.json")).size < 40 * 1024 * 12, "editions.json");
  const accs = readdirSync(join(ROOT, "data/cash-index")).filter((f) => /^acc-\d{4}-\d{2}\.json$/.test(f));
  assert.ok(accs.length <= 2, "at most two working months on the site");
  for (const a of accs) assert.ok(statSync(join(ROOT, "data/cash-index", a)).size < 1024 * 1024, a);
});

test("workflows: monthly build on the 1st plus dispatch; days folded with the bids", () => {
  const wf = read(".github/workflows/cash-bid-index.yml");
  assert.match(wf, /cron: '23 11 1 \* \*'/);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /python scripts\/cash_bid_index\.py --check/);
  const fb = read(".github/workflows/fetch_bids.yml");
  assert.ok(fb.indexOf("scripts/build_bids_prev.py\n") < fb.indexOf("scripts/cash_bid_index.py --fold"), "fold after bids-prev");
  assert.match(fb, /git add -A data\/cash-index/);
});

test("the Daily links the latest index", () => {
  assert.match(read("scripts/daily_edge.py"), /href="\/cash-bid-index"/);
  assert.match(read("components/daily-edge.js"), /href="\/cash-bid-index"/);
});

/* 2026-11-04 (site panel, skeptic rows 23 and 32): no "no one else has this set" claim,
 * and the state table fits its box at 1280 (it was 871px in 824px, the last column cut). */
test("no uniqueness claim on the page or in the builder", () => {
  for (const f of ["cash-bid-index.html", "scripts/cash_bid_index.py"])
    assert.doesNotMatch(readFileSync(join(ROOT, f), "utf8"), /no one else has/i, f);
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const noBrowser = !existsSync(PW) || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
test("the state tables fit their box at 1280 and 390 with no sideways scroll", { skip: noBrowser, timeout: 60000 }, async () => {
  const { chromium } = await import(PW);
  const { createServer } = await import("node:http");
  const srv = createServer((q, r) => {
    const p = decodeURIComponent(new URL(q.url, "http://x").pathname), f = join(ROOT, p === "/" ? "cash-bid-index.html" : p);
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { "content-type": f.endsWith(".html") ? "text/html" : f.endsWith(".css") ? "text/css" : f.endsWith(".js") ? "text/javascript" : "application/octet-stream" });
    r.end(readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = srv.address().port, b = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [1280, 390]) {
      const c = await b.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
      const pg = await c.newPage();
      await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      await pg.goto(`http://127.0.0.1:${port}/cash-bid-index.html`);
      const boxes = await pg.$$eval(".cbi-tw", (els) => els.map((e) => [e.scrollWidth, e.clientWidth]));
      assert.ok(boxes.length >= 2, "corn and soybean tables");
      for (const [sw, cw] of boxes) assert.ok(sw <= cw, `${width}px: table ${sw}px in a ${cw}px box`);
      assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: no page scroll`);
      await c.close();
    }
  } finally { await b.close(); srv.close(); }
});
