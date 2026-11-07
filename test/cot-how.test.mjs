/* How the funds' net changed, split into longs and shorts (Nov 7, 2026; brief cot-how).
 * ONE function figures it: scripts/cot_analysis.py how_changed(), written into each market's analysis card as
 * card.how {long_change, short_change, label, line}. Every place that shows it prints that line as it stands:
 *   - /cot: under the chart headline (#cc-how; components/cot-glance.js how(), cot-chart.js howLine(), baked for corn
 *     by scripts/prerender_wpi_scorecard.py cot_how()) and on each market card (cot-page.js renderInsight);
 *   - the Funds this week email (scripts/send_cot_weekly.py how_of(), one line per market);
 *   - the Daily's fund block (scripts/daily_more.fund_facts, through send_cot_weekly.rows_for).
 * Positions only, never a motive; contracts, never a percent; withheld when either week lacks a long or a short
 * count, when the analysis is for another week, or when the files disagree.
 * Frozen inputs: test/fixtures/funds (cot.json, cot-analysis.json and cot-history.json for the Oct 27, 2026 report),
 * with card.how added in memory from how_changed() itself. The browser part routes every outside host to a stub or
 * abort and blocks service workers (BUILD-RULES 58).
 *
 *   node --test test/cot-how.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const G = require(path.join(ROOT, "components/cot-glance.js"));
const FIX = {
  cot: path.join(ROOT, "test/fixtures/funds/cot-2026-10-27.json"),
  cx: path.join(ROOT, "test/fixtures/funds/cot-analysis-2026-10-27.json"),
  hist: path.join(ROOT, "test/fixtures/funds/cot-history-2026-10-27.json"),
};
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "cothow-"));
const py = (code, ...args) => execFileSync("python3", ["-c", code, ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/* the fixture analysis with card.how written by how_changed() from the history's last two rows, as cot_analysis does */
const CXP = path.join(TMP, "cot-analysis.json");
py(`import sys, json; sys.path.insert(0, "scripts"); import cot_analysis as A
cx, h = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))["history"]
for k, c in cx["commodities"].items():
    r = h[k]
    c["card"]["how"] = A.how_changed(r[-2]["long"], r[-2]["short"], r[-1]["long"], r[-1]["short"])
    c["card"].pop("driver", None)
json.dump(cx, open(sys.argv[3], "w"))`, FIX.cx, FIX.hist, CXP);
const COT = JSON.parse(fs.readFileSync(FIX.cot, "utf8"));
const CX = JSON.parse(fs.readFileSync(CXP, "utf8"));
const LINE = (k) => CX.commodities[k].card.how.line;
const clone = (o) => JSON.parse(JSON.stringify(o));

test("the corn report of Nov 3, 2026 gives exactly the brief's line", () => {
  // pin-ok: fixture. Longs 249,351 -> 229,341, shorts 168,238 -> 220,546 (net 81,113 -> 8,795).
  const out = JSON.parse(py(`import sys, json; sys.path.insert(0, "scripts"); import cot_analysis as A
print(json.dumps(A.how_changed(249351, 168238, 229341, 220546)))`));
  assert.deepEqual(out, { long_change: -20010, short_change: 52308, label: "mostly new short selling",
    line: "Longs -20,010, shorts +52,308: mostly new short selling." });
});

test("each label, both sides the same way, and the withheld cases", () => {
  const cases = [[[100, 50, 60, 60], "mostly selling longs they held"], [[100, 50, 90, 80], "mostly new short selling"],
    [[100, 50, 140, 40], "mostly new buying"], [[100, 50, 105, 20], "mostly buying back shorts"],
    [[100, 50, 90, 40], "longs and shorts both cut"], [[100, 50, 130, 60], "longs and shorts both added"]];
  const got = JSON.parse(py(`import sys, json; sys.path.insert(0, "scripts"); import cot_analysis as A
print(json.dumps([A.how_changed(*a) for a in json.loads(sys.argv[1])]))`, JSON.stringify(cases.map((c) => c[0]).concat([[null, 50, 90, 40], [100, 50, 90, null]]))));
  cases.forEach(([, want], i) => assert.equal(got[i].label, want, JSON.stringify(got[i])));
  assert.ok(got[6].withheld && !got[6].line && got[7].withheld && !got[7].line, "a week without a long or a short: withheld");
  for (const g of got.slice(0, 6)) assert.doesNotMatch(g.line, /%|think|bearish|bullish|because|\u2014|\u2013/, g.line);
});

test("the page helper prints the analysis card's line as it stands, and withholds when the files disagree", () => {
  for (const k of G.ORDER) assert.equal(G.how(k, COT, CX), LINE(k), k);
  assert.equal(G.how("corn", COT, CX), "Longs -48,446, shorts +34,864: mostly selling longs they held."); // pin-ok: fixture (Oct 27 report)
  const off = clone(CX); off.commodities.corn.mm_long += 1;
  assert.equal(G.how("corn", COT, off), "", "analysis long count is not cot.json's: nothing");
  const wk = clone(CX); wk.commodities.corn.date = "2026-10-20";
  assert.equal(G.how("corn", COT, wk), "", "analysis for another week: nothing");
  const wh = clone(CX); wh.commodities.corn.card.how = { withheld: "a week without both long and short counts" };
  assert.equal(G.how("corn", COT, wh), "", "withheld upstream: nothing");
  assert.equal(G.how("corn", COT, null), "");
});

test("the email, the Daily's rows and the baked page line carry the same text as the computed field", () => {
  const out = JSON.parse(py(`import sys, json, io, contextlib; sys.path.insert(0, "scripts")
import send_cot_weekly as W, prerender_wpi_scorecard as P
cot, cx, hist = (json.load(open(p)) for p in sys.argv[1:4])
a = W.as_of_date(cot)
with contextlib.redirect_stdout(io.StringIO()):
    rows = W.rows_for(cot, hist, None, a, cx)
    s, t, h = W.compose(a, None, rows)
print(json.dumps({"rows": {r["key"]: r["how"] for r in rows}, "text": t, "html": h, "baked": P.cot_how(cot, cx)}))`, FIX.cot, CXP, FIX.hist));
  assert.equal(Object.keys(out.rows).length, 6, "six email markets");
  for (const [k, v] of Object.entries(out.rows)) {
    assert.equal(v, LINE(k), k + ": rows_for carries the field");
    assert.ok(out.text.split("\n").includes(v), k + ": the email's text prints it as its own line");
    assert.ok(out.html.includes(">" + v + "</p>"), k + ": the email's html prints it");
    assert.equal(G.how(k, COT, CX), v, k + ": the page and the email say the same");
  }
  assert.equal(out.baked, LINE("corn"), "the baked corn line is the field");
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const BAKED = (() => {
  const out = path.join(TMP, "cot.html");
  try {
    py(`import sys; sys.path.insert(0, "scripts"); import prerender_wpi_scorecard as p
p.COT_JSON, p.COT_CX_JSON = sys.argv[1], sys.argv[2]
o, n, f = p.bake_cot(); open(sys.argv[3], "w", encoding="utf-8").write(n)`, FIX.cot, CXP, out);
    return out;
  } catch (e) { return null; }
})();

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    if (!path.extname(p)) p += ".html";
    const f = p === "/cot.html" ? BAKED : path.normalize(path.join(ROOT, p));
    if (!f || (f !== BAKED && !f.startsWith(ROOT)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("/cot: the line under the chart headline and on the market card is the field; no layout shift", { skip, timeout: 120000 }, async () => {
  assert.ok(BAKED, "cot.html baked from the fixtures");
  assert.ok(fs.readFileSync(BAKED, "utf8").includes('<p class="cc-how" id="cc-how"><!-- PRERENDER:cot-how -->' + LINE("corn") + "<!-- /PRERENDER:cot-how --></p>"), "baked for corn");
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 844 } });
      const pg = await ctx.newPage();
      await pg.addInitScript(() => { window.__cls = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls.push(e.value); }).observe({ type: "layout-shift", buffered: true }); });
      const own = { "/data/cot.json": fs.readFileSync(FIX.cot), "/data/cot-analysis.json": fs.readFileSync(CXP), "/data/cot-history.json": fs.readFileSync(FIX.hist) };
      await pg.route("**/*", (r) => {
        const u = new URL(r.request().url());
        if (u.origin === `http://127.0.0.1:${port}`) {
          if (own[u.pathname]) return r.fulfill({ status: 200, contentType: "application/json", body: own[u.pathname] });
          return r.continue();
        }
        if (u.origin === "https://agsist-api.dnilgis.workers.dev")
          return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ ok: true }) });
        return r.abort();
      });
      await pg.clock.setFixedTime(new Date("2026-11-04T15:46:20Z"));
      await pg.goto(`http://127.0.0.1:${port}/cot`, { waitUntil: "load" });
      await pg.waitForFunction(() => { const b = document.getElementById("cot-chart-box"); return b && b.dataset.latest && / funds /.test(document.getElementById("cc-head").textContent); });
      await pg.waitForFunction(() => /Longs/.test((document.getElementById("insight-corn") || {}).textContent || ""));
      const r = await pg.evaluate(() => ({ how: document.getElementById("cc-how").textContent, card: document.getElementById("insight-corn").textContent,
        beansCard: document.getElementById("insight-beans").textContent, cls: window.__cls.reduce((a, x) => a + x, 0), sw: document.documentElement.scrollWidth }));
      assert.equal(r.how, LINE("corn"), "under the corn headline at " + width);
      assert.ok(r.card.includes(LINE("corn")), "on the corn card: " + r.card);
      assert.ok(r.beansCard.includes(LINE("beans")), "on the soybean card: " + r.beansCard);
      assert.doesNotMatch(r.card, /driven by|liquidation|covering/, "one wording for how it changed: " + r.card);
      assert.equal(r.cls, 0, "no layout shift at " + width);
      assert.ok(r.sw <= width, "no sideways scroll at " + width);
      await pg.click('.cc-chip[data-k="beans"]');
      assert.equal(await pg.$eval("#cc-how", (e) => e.textContent), LINE("beans"), "picking soybeans shows its line");
      await pg.click("#cc-cmp");
      assert.equal(await pg.$eval("#cc-how", (e) => getComputedStyle(e).display), "none", "Compare carries no single market's line");
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("the old wording is gone: one function, one set of words", () => {
  const page = fs.readFileSync(path.join(ROOT, "components/cot-page.js"), "utf8");
  const ana = fs.readFileSync(path.join(ROOT, "scripts/cot_analysis.py"), "utf8");
  assert.doesNotMatch(page, /k\.driver/);
  assert.doesNotMatch(ana, /"new long buying"|"long liquidation" if|driven by \{/);
  for (const f of ["scripts/send_cot_weekly.py", "scripts/daily_more.py", "scripts/prerender_wpi_scorecard.py", "components/cot-glance.js", "components/cot-chart.js"])
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), "utf8").split("# ── fixtures and the selftest")[0], /mostly new short selling|mostly selling longs they held|mostly buying back shorts|mostly new buying/, f + " does not write the labels itself");
});
