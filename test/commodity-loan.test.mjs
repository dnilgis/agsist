/* Commodity loan (components/commodity-loan.js, commodity-loan-ui.js) and the
 * /commodity-loan page.
 *
 * The national 2026 rates are from FSA's Apr 8, 2026 release. Every worked
 * example is arithmetic written out beside it. The interest rates used in
 * the examples (5%, 4.5%) are examples, not FSA's rate. Browser checks need
 * Playwright and Chromium and skip without them.
 *
 *   node --test test/commodity-loan.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = {};
vm.runInNewContext(readFileSync(ROOT + "components/commodity-loan.js", "utf8"), ctx);
const C = ctx.AgCccLoan;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const page = readFileSync(ROOT + "commodity-loan.html", "utf8");
const ui = readFileSync(ROOT + "components/commodity-loan-ui.js", "utf8");
const math = readFileSync(ROOT + "components/commodity-loan.js", "utf8");
const fetcher = readFileSync(ROOT + "scripts/fetch_ccc_loan.py", "utf8");
const wf = readFileSync(ROOT + ".github/workflows/ccc-loan.yml", "utf8");

/* ---------------- math ---------------- */

test("national 2026 rates: corn $2.42, soybeans $6.82 (FSA Apr 8, 2026)", () => {
  assert.equal(C.NATIONAL.corn, 2.42);
  assert.equal(C.NATIONAL.soybeans, 6.82);
  assert.equal(C.NATIONAL.crop_year, 2026);
  assert.equal(C.NATIONAL.available_through, "2027-05-31");
  assert.match(fetcher, /NATIONAL = \{"corn": 2\.42, "soybeans": 6\.82\}/, "fetcher checks counties against the same rates");
});

test("interest a bushel a month = loan rate x rate / 12", () => {
  // 2.42 x 0.05 / 12 = 0.0100833; 6.82 x 0.05 / 12 = 0.0284167
  near(C.perBuMonth(2.42, 5), 0.0100833, 1e-6, "corn 5%");
  near(C.perBuMonth(6.82, 5), 0.0284167, 1e-6, "soy 5%");
  // FAQ: about 1 cent a month, 9.1 cents for nine months; soybeans about 2.8 cents
  assert.equal((C.perBuMonth(2.42, 5) * 100).toFixed(0), "1");
  assert.equal((C.perBuMonth(2.42, 5) * 9 * 100).toFixed(1), "9.1");
  assert.equal((C.perBuMonth(6.82, 5) * 100).toFixed(1), "2.8");
  assert.match(page, /2\.42 x 0\.05 \/ 12 = 1\.01 cents/);
  assert.match(page, /6\.82 x 0\.05 \/ 12 = 2\.84 cents/);
  for (const p of [3, 4, 5, 6, 7]) {
    const c = (C.perBuMonth(2.42, p) * 100).toFixed(2), s = (C.perBuMonth(6.82, p) * 100).toFixed(2);
    assert.match(page, new RegExp(`<tr><th scope="row">${p}%</th><td>${c.replace(".", "\\.")}&cent;</td><td>${s.replace(".", "\\.")}&cent;</td></tr>`), p + "% row");
  }
});

test("10,000 bu corn at $2.42, 4.5% for 6 months, 20 cent carry, 8% operating line", () => {
  // loan 24,200. a month 2.42 x .045 / 12 = 0.009075; 6 mo = 0.05445/bu; $544.50
  // carry 0.20 - 0.05445 = 0.14555/bu, $1,455.50; covers 3.67x
  // bank 2.42 x .08 / 12 x 6 = 0.0968/bu, $968; saved $423.50
  const o = C.loan({ bu: 10000, loanRate: 2.42, pct: 4.5, months: 6, carry: 0.2, bankPct: 8 });
  near(o.principal, 24200, 1e-9, "loan");
  near(o.perBuMonth, 0.009075, 1e-12, "a month");
  near(o.perBu, 0.05445, 1e-12, "6 months");
  near(o.interest, 544.5, 1e-9, "interest");
  near(o.net, 0.14555, 1e-12, "carry less interest");
  near(o.covers, 0.2 / 0.05445, 1e-12, "covers");
  near(o.bankInterest, 968, 1e-9, "bank");
  near(o.saved, 423.5, 1e-9, "saved");
});

test("months clamp to 1..9; no rate means principal only; bad input is null", () => {
  assert.equal(C.loan({ bu: 100, loanRate: 2.42, pct: 5, months: 14 }).months, 9);
  assert.equal(C.loan({ bu: 100, loanRate: 2.42, pct: 5, months: 0 }).months, 1);
  const o = C.loan({ bu: 100, loanRate: 2.42, pct: null, months: 3 });
  near(o.principal, 242, 1e-9, "principal");
  assert.equal(o.interest, null);
  assert.equal(C.loan({ bu: 0, loanRate: 2.42 }), null);
  assert.equal(C.loan({ bu: 10, loanRate: null }), null);
});

test("current rate: this month's or last month's only, never older or future", () => {
  const feed = { interest: { pct: 5.25, month: "2026-10", read_utc: "2026-10-02T14:23:00Z" } };
  assert.equal(C.currentRate(feed, new Date("2026-10-16T12:00:00Z")).pct, 5.25);
  assert.equal(C.currentRate(feed, new Date("2026-10-16T12:00:00Z")).stale, false);
  assert.equal(C.currentRate(feed, new Date("2026-11-03T12:00:00Z")).stale, true, "last month's is labeled");
  assert.equal(C.currentRate(feed, new Date("2026-12-03T12:00:00Z")), null, "two months old is not shown");
  assert.equal(C.currentRate(feed, new Date("2026-09-20T12:00:00Z")), null, "a future month is not shown");
  assert.equal(C.currentRate({ interest: { pct: 5, month: "Oct" } }), null);
  assert.equal(C.currentRate(null), null);
});

test("county rate from a state file", () => {
  const f = { counties: [{ county: "Adair", corn: 2.31, soybeans: 6.71 }, { county: "Story", corn: 2.35 }] };
  assert.equal(C.countyRate(f, "Adair", "soybeans"), 6.71);
  assert.equal(C.countyRate(f, "Story", "soybeans"), null);
  assert.equal(C.countyRate(null, "Story", "corn"), null);
});

/* ---------------- page and data plumbing ---------------- */

test("page: head, canonical, byline, JSON-LD FAQ matches visible FAQ, not an eligibility check", () => {
  assert.match(page, /<title>CCC commodity loan calculator: marketing loan interest per bushel \| AGSIST<\/title>/);
  assert.match(page, /<link rel="canonical"\s+href="https:\/\/agsist\.com\/commodity-loan">/);
  assert.match(page, /<p class="by">Sigurd Lindquist, Certified Crop Adviser \(CCA\)/);
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const faq = ld["@graph"].find((x) => x["@type"] === "FAQPage").mainEntity;
  const seen = [...page.matchAll(/<details><summary>([^<]+)<\/summary><p>([^<]+)<\/p><\/details>/g)]
    .map((m) => [m[1], m[2]].map((s) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")));
  assert.ok(faq.length >= 5);
  assert.deepEqual(faq.map((q) => [q.name, q.acceptedAnswer.text]), seen);
  assert.match(page, /Not an eligibility check\./);
  assert.match(page, /county FSA office/);
  assert.match(page, /href="\/store-or-sell"/, "links the carry page");
  assert.doesNotMatch(ui, /storesell|store-or-sell\.js/, "links /store-or-sell, does not copy its code");
  assert.match(page, /04-08-2026\/usda-announces-2026-marketing-assistance-loan-rates/);
  assert.match(page, /it is not the current CCC rate/, "the 5% example is labeled as an example");
});

test("honest empty state: no baked interest rate; data files load on demand", () => {
  assert.doesNotMatch(page, /<input id="lo-pct"[^>]*value=/, "no baked CCC rate");
  assert.match(ui, /The CCC rate loads after the first FSA read/);
  assert.match(ui, /County loan rates load after the first FSA read/);
  assert.match(ui, /'\/data\/ccc-loan\/' \+ encodeURIComponent\(code\) \+ '\.json'/, "one state file at a time");
});

test("fetch workflow: selftest, probe input, retrying commit", () => {
  assert.match(wf, /python scripts\/fetch_ccc_loan\.py --selftest/);
  assert.match(wf, /probe:/);
  assert.match(wf, /python scripts\/fetch_ccc_loan\.py --probe/);
  assert.match(wf, /for i in 1 2 3 4 5/);
  assert.match(fetcher, /RATE_RANGE = \(0\.5, 15\.0\)/);
});

test("copy: no em or en dashes, nothing AI-sounding, no store names", () => {
  for (const [name, s] of [["page", page], ["ui", ui], ["math", math], ["fetcher", fetcher], ["workflow", wf]]) {
    assert.doesNotMatch(s, /[–—]|&mdash;|&ndash;/, name + " has a long dash");
    assert.doesNotMatch(s, /\b(delve|leverage|seamless|unlock|empower|game-changer)\b/i, name);
    assert.doesNotMatch(s, /\b(Amazon|Walmart|Tractor Supply|Fleet Farm|Etsy)\b/, name);
  }
});

/* ---------------- in the browser ---------------- */

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, data) {
  const bctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const pg = await bctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", async (r) => {
    const u = r.request().url();
    for (const [k, v] of Object.entries(data || {})) if (u.includes(k)) return r.fulfill({ contentType: "application/json", body: JSON.stringify(v) });
    if (u.includes("/data/ccc-loan")) return r.fulfill({ status: 404, body: "" });
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}/commodity-loan`);
  return { pg, bctx, errors };
}

test("browser: no data yet: national rate, empty interest, typed rate gives the answer", { skip }, async () => {
  const srv = await serve(), browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors, bctx } = await open(browser, srv.address().port, null);
    await pg.waitForFunction(() => /County loan rates load after the first FSA read/.test(document.getElementById("lo-cempty").textContent));
    assert.equal(await pg.inputValue("#lo-rate"), "2.42");
    assert.equal(await pg.inputValue("#lo-pct"), "");
    assert.match(await pg.textContent("#lo-iempty"), /The CCC rate loads after the first FSA read/);
    assert.match(await pg.textContent("#lo-verdict"), /^\$24,200 now on 10,000 bu at \$2\.42\.$/);
    await pg.fill("#lo-pct", "4.5");
    await pg.fill("#lo-carry", "20");
    // 6 months at 4.5%: 0.907 cents a month, 5.45 cents, $545 (544.50 rounds up)
    await pg.waitForFunction(() => /Interest: 0\.91¢ a bushel a month, 5\.45¢ for 6 months\./.test(document.getElementById("lo-verdict").textContent));
    assert.match(await pg.textContent("#lo-kv"), /14\.56¢.*\$1,456/s, "carry less interest");
    await pg.click('[data-crop="soybeans"]');
    assert.equal(await pg.inputValue("#lo-rate"), "6.82");
    assert.deepEqual(errors, []);
    await bctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("browser: with FSA data: this month's rate and a county rate", { skip }, async () => {
  const srv = await serve(), browser = await chromium.launch({ executablePath: CHROME });
  const now = new Date(), ym = now.toISOString().slice(0, 7);
  const data = {
    "/data/ccc-loan.json": { interest: { pct: 5.25, month: ym, read_utc: now.toISOString() }, counties: { crop_year: 2026, states: { IA: { name: "Iowa", n: 2 } } } },
    "/data/ccc-loan/IA.json": { state: "IA", name: "Iowa", read_utc: now.toISOString(), counties: [{ county: "Adair", corn: 2.31, soybeans: 6.71 }, { county: "Story", corn: 2.35, soybeans: 6.75 }] }
  };
  try {
    const { pg, errors, bctx } = await open(browser, srv.address().port, data);
    await pg.waitForFunction(() => document.getElementById("lo-pct").value === "5.25");
    assert.match(await pg.textContent("#lo-pctsrc"), /CCC commodity loan rate for \w+ \d{4}, from FSA/);
    assert.equal(await pg.textContent("#lo-iempty"), "");
    await pg.selectOption("#lo-state", "IA");
    await pg.waitForFunction(() => !document.getElementById("lo-county").disabled);
    await pg.selectOption("#lo-county", "Story");
    await pg.waitForFunction(() => document.getElementById("lo-rate").value === "2.35");
    assert.match(await pg.textContent("#lo-ratesrc"), /2026 county loan rate for corn, Story County, Iowa/);
    // 10,000 x 2.35 = 23,500; 2.35 x .0525 / 12 = 1.03 cents a month
    assert.match(await pg.textContent("#lo-verdict"), /\$23,500 now on 10,000 bu at \$2\.35\. Interest: 1\.03¢ a bushel a month/);
    assert.deepEqual(errors, []);
    await bctx.close();
  } finally { await browser.close(); srv.close(); }
});
