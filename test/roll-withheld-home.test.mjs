/* A withheld day change prints as no change, on every page that shows the quote.
 *
 * fetch_prices.energy_roll_guard (#255) marks a natural gas or crude quote whose
 * day change crosses contracts near expiry with move_withheld (the reason) and
 * roll: true. Oct 27 2026: NG=F read $3.019 against Oct 26's $2.602 Nov close,
 * "+16.0%", a Dec trade over a Nov settle. The futures and markets pages already
 * printed "contract roll"; the home page ledger row (home.js) and the cards and
 * ticker geo.js writes still printed the move. The price stays; the change, the
 * arrow, the color and the percent go.
 *
 * The quote is the real Oct 27 row from test/fixtures/daily-audit/ng-roll-2026-10.json
 * run through the shipped guard (scripts/fetch_prices.py), placed in today's
 * data/prices.json. Needs Playwright and Chromium; 390 and 1280.
 *   node --test test/roll-withheld-home.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const SHOTS = process.env.SHOT_DIR || "";

/* The Oct 27 natgas quote after the shipped guard (fetch_prices imports
   yfinance at the top; a stub keeps this offline, as scripts/test_mark_rolls.py does). */
const GUARDED = JSON.parse(execFileSync("python3", ["-c", `
import copy, json, sys, types
sys.modules.setdefault("yfinance", types.ModuleType("yfinance"))
sys.path.insert(0, sys.argv[1] + "scripts")
from fetch_prices import energy_roll_guard
fx = json.load(open(sys.argv[1] + "test/fixtures/daily-audit/ng-roll-2026-10.json"))
row = [r for r in fx["rows"] if r["fetched"].startswith("2026-10-27")][0]
qs = copy.deepcopy(row["quotes"])
energy_roll_guard(qs)
print(json.dumps(qs["natgas"]))
`, ROOT]).toString());

function prices() {
  const d = JSON.parse(readFileSync(join(ROOT, "data/prices.json"), "utf8"));
  d.quotes.natgas = GUARDED;
  return JSON.stringify(d);
}
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".ics": "text/calendar" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    let f = normalize(join(ROOT, p));
    if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, w, page) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: 900 } });
  const pg = await ctx.newPage(), errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.route((u) => !u.href.startsWith(`http://127.0.0.1:${port}`), (r) => r.abort());
  const body = prices();
  await pg.route((u) => u.pathname === "/data/prices.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body }));
  await pg.goto(`http://127.0.0.1:${port}/${page}`, { waitUntil: "load" });
  return { ctx, pg, errs };
}
const MOVE = /[▲▼%]|\+|−|16\.0|0\.41/;

test("the guard withholds the real Oct 27 natural gas move and keeps the price", () => {
  assert.equal(GUARDED.close, 3.019);
  assert.equal(GUARDED.roll, true);
  assert.match(String(GUARDED.move_withheld), /expiry window/);
});

test("home: the natural gas row shows $3.02 and no change; crude keeps its change", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const w of [390, 1280]) {
      const { ctx, pg, errs } = await open(browser, port, w, "index.html");
      const row = '.r7-row[data-r7k="natgas"]';
      await pg.waitForFunction((s) => {
        const r = document.querySelector(s);
        return r && /\$3\.02/.test(r.querySelector(".pc-price").textContent) && r.querySelector(".r7-chg").textContent.length > 0;
      }, row, { timeout: 20000 });
      const got = await pg.$eval(row, (r) => ({
        price: r.querySelector(".pc-price").textContent, chg: r.querySelector(".r7-chg").textContent,
        chgCls: r.querySelector(".r7-chg").className, pct: r.querySelector(".r7-pct").textContent,
        pctCls: r.querySelector(".r7-pct").className, text: r.textContent }));
      assert.equal(got.price, "$3.02");
      assert.equal(got.chg, "contract roll");
      assert.equal(got.pct, "");
      assert.doesNotMatch(got.chgCls + " " + got.pctCls, /\b(up|dn)\b/, "no color");
      assert.doesNotMatch(got.chg + got.pct, MOVE, "no arrow, sign or percent");
      /* control: a quote the guard did not touch still prints its move */
      const crude = await pg.$eval('.r7-row[data-r7k="crude"] .r7-pct', (e) => e.textContent);
      assert.match(crude, /%/, "crude keeps its percent");
      /* geo.js applyPriceResult, the writer of the price cards and every ticker
         item: a ticker item for the quote prints the price and no change, and a
         card's previous close (another contract's) is not printed beside it. */
      const tick = await pg.evaluate((q) => {
        const it = document.createElement("div");
        it.setAttribute("data-sym", "natgas");
        it.innerHTML = '<span class="t-price"></span><span class="t-chg up">x</span>';
        document.body.appendChild(it);
        window.applyPriceResult("natgas", q, q.close, q.open, q.netChange, q.pctChange);
        const out = { p: it.querySelector(".t-price").textContent, c: it.querySelector(".t-chg").textContent, cls: it.querySelector(".t-chg").className };
        it.remove();
        return out;
      }, GUARDED);
      assert.equal(tick.p, "$3.02");
      assert.equal(tick.c, "contract roll");
      assert.equal(tick.cls, "t-chg nc");
      if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await pg.$eval(row, (r) => r.scrollIntoView({ block: "center" })); await pg.screenshot({ path: join(SHOTS, `home-natgas-${w}.png`) }); }
      const hs = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(hs <= 0, "no sideways scroll at " + w);
      assert.deepEqual(errs, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("markets: the natural gas card shows the price and no change", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const w of [390, 1280]) {
      const { ctx, pg, errs } = await open(browser, port, w, "markets.html");
      await pg.waitForFunction(() => /3\.02/.test((document.getElementById("pcp-natgas") || {}).textContent || ""), null, { timeout: 20000 });
      const c = await pg.$eval("#pcc-natgas", (e) => ({ t: e.textContent, cls: e.className }));
      assert.match(c.t, /^contract roll/);
      assert.doesNotMatch(c.t, MOVE);
      assert.doesNotMatch(c.cls, /\b(up|dn)\b/);
      if (SHOTS) { await pg.$eval("#pcc-natgas", (e) => e.scrollIntoView({ block: "center" })); await pg.screenshot({ path: join(SHOTS, `markets-natgas-${w}.png`) }); }
      assert.deepEqual(errs, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
