/* Price display fixes, Oct 20 2026 (helper pricefix; adversary notes v37 and v40).
 *   1 harvest tracker: a window that closed but RMA has not released says so, never "if it closed today"
 *   2 homepage badge: an evening file of the day's last trades names their day, not the file's read time
 *   3 homepage strip: a row on another date than corn says it (milk Oct 16 among Oct 19 grain)
 *   4 /markets lead: cards on different settle dates show the range (page and seed twin agree)
 *   5 cattle: a zero change with no netChange is unch; a zero COT week change is not green
 *
 *   node --test test/pricefix-oct20.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

/* ---- 2: the badge function from components/home-yield.js, run with a fixed clock ---- */
function badge(data, nowIso) {
  const body = read("components/home-yield.js").match(/var _st=(\(function\(iso\)\{[\s\S]*?\}\)\(data\.fetched\));/)[1];
  const RD = Date;
  const D = class extends RD { constructor(...a) { super(...(a.length ? a : [nowIso])); } static now() { return new RD(nowIso).getTime(); } };
  D.UTC = RD.UTC; D.parse = RD.parse;
  return vm.runInNewContext(body, { data, Date: D, Intl });
}

test("2: Monday 7:18 PM CT file of the day's last trades says As of Oct 19, Last trades", () => {
  // the real Oct 20 00:18Z file: corn close 466.75 is the 1:20 PM last trade, settled:true
  const d = { fetched: "2026-10-20T00:18:00Z", quotes: { "corn-nearby": { close: 466.75, last: 465.75, close_kind: "last", close_date: "2026-10-19", settled: true } } };
  const b = badge(d, "2026-10-20T00:30:00Z");
  assert.equal(b.t, "As of Oct 19");
  assert.doesNotMatch(b.t, /PM/);
  assert.match(b.title, /^Last trades\. The day session closed at 1:20 PM CT/);
  assert.equal(b.live, false);
  // 3:00 AM CT Tuesday, same file: still the Oct 19 last trades
  assert.equal(badge(d, "2026-10-20T08:00:00Z").t, "As of Oct 19");
  // a live overnight quote read in session is still Delayed
  const live = { fetched: "2026-10-20T01:30:00Z", quotes: { "corn-nearby": { close: 466, close_kind: "last", close_date: "2026-10-20" } } };
  assert.equal(badge(live, "2026-10-20T01:40:00Z").t, "Delayed 15 min");
  // and the day session too
  const day = { fetched: "2026-10-20T15:00:00Z", quotes: { "corn-nearby": { close: 466, close_kind: "last", close_date: "2026-10-20" } } };
  assert.equal(badge(day, "2026-10-20T15:10:00Z").t, "Delayed 15 min");
  // a settle file is unchanged
  const st = { fetched: "2026-10-20T05:00:00Z", quotes: { "corn-nearby": { close: 466, close_kind: "settle", close_date: "2026-10-19", settled: true } } };
  assert.equal(badge(st, "2026-10-20T05:10:00Z").t, "Settle Oct 19");
});

/* ---- 3: the row date note in components/home.js, on the real Oct 20 case ---- */
test("3: milk's Oct 16 settle beside corn's Oct 19 last trade carries its date", () => {
  const fn = read("components/home.js").match(/var MN3=[\s\S]*?\nfunction dtNote\(k,q\)\{[\s\S]*?\n\}/)[0];
  const D = { quotes: {
    "corn-nearby": { close: 466.75, close_kind: "last", close_date: "2026-10-19", settled: true },
    milk: { close: 15.27, close_kind: "settle", close_date: "2026-10-16", settled: true, settle_pending: "2026-10-19" },
    beans: { close: 1253, close_kind: "last", close_date: "2026-10-19", settled: true },
  } };
  const ctx = { D };
  vm.runInNewContext(fn + "\nthis.f=dtNote;", ctx);
  assert.equal(ctx.f("milk", D.quotes.milk), "Oct 16 settle");
  assert.equal(ctx.f("beans", D.quotes.beans), "");
});

/* ---- 1: harvest tracker, a closed window RMA has not released (every Oct 31 window from Nov 1) ---- */
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    const f = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("1: Nov 3, Iowa corn and soybeans closed Oct 31, not released: no 'if it closed today'", { skip, timeout: 90000 }, async () => {
  const FX = read("test/fixtures/pricefix/IA-closed-unreleased.json");
  // Iowa is the page's reference state: its rows also ride in index.json (ref_rows)
  const IDX = JSON.parse(read("data/rma-prices/index.json"));
  if (IDX.ref_state === "IA") IDX.ref_rows = JSON.parse(FX).rows;
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
      const pg = await ctx.newPage();
      await pg.clock.setFixedTime(new Date("2026-11-03T18:00:00Z"));
      const errors = [];
      pg.on("pageerror", (e) => errors.push(String(e)));
      await pg.route("**/*", (r) => {
        const u = r.request().url();
        if (!u.startsWith(`http://127.0.0.1:${port}`)) return r.abort();
        if (u.includes("/data/rma-prices/index.json")) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(IDX) });
        if (u.includes("/data/rma-prices/IA.json")) return r.fulfill({ status: 200, contentType: "application/json", body: FX });
        return r.continue();
      });
      await pg.goto(`http://127.0.0.1:${port}/harvest-price-tracker.html`);
      await pg.waitForFunction(() => document.querySelector("#pd-state option[value=IA]"));
      await pg.selectOption("#pd-state", "IA");
      await pg.waitForFunction(() => !document.getElementById("pd-crop").disabled && !/Loading/.test(document.getElementById("pd-your").textContent));
      const your = await pg.$eval("#pd-your", (x) => x.innerText.replace(/\s+/g, " "));
      assert.doesNotMatch(your, /If the window closed today/);
      assert.doesNotMatch(your, /Your revenue guarantee revised up/, "not released: never the past tense of a final");
      // corn, up: 4.91 against 4.62 is +6.3%
      assert.match(your, /Window closed Oct 31\. RMA has not posted the final price yet\. If the final matches the last posted average, your revenue guarantee revises up 6\.3%: figured at the \$4\.91 \/bu last posted harvest price\./);
      // soybeans, down: 10.80 against 11.09
      assert.match(your, /Window closed Oct 31\. RMA has not posted the final price yet\. A last posted average below the projected price does not cut your guarantee: it stays figured at the \$11\.09 \/bu projected price\./);
      assert.match(your, /Last posted average against the projected price/i);
      assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth), width);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

/* ---- Sig's call Oct 20 (v37 item 2): the window bar uses our running average where we have the settles ---- */
test("bar: Iowa corn reads our running average, the calculator's number, with RMA's figure in one line", { skip, timeout: 90000 }, async () => {
  const HP = JSON.parse(read("data/harvest-prices.json"));
  const corn = HP.commodities.find((c) => c.label === "Corn");
  const ser = (corn.harvest && corn.harvest.series) || [];
  if (corn.harvest.status !== "running" || !ser.length) return; // only while the window runs
  const avg = Math.round(ser.reduce((t, x) => t + +x.s, 0) / ser.length * 100 + 1e-7) / 100;
  const last = ser[ser.length - 1].d;
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 900 } });
    const pg = await ctx.newPage();
    await pg.clock.setFixedTime(new Date(last + "T23:00:00Z"));
    await pg.route("**/*", (r) => r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort());
    await pg.goto(`http://127.0.0.1:${port}/harvest-price-tracker.html`);
    await pg.waitForFunction(() => document.querySelector("#pd-state option[value=IA]"));
    await pg.selectOption("#pd-state", "IA");
    await pg.waitForFunction(() => !document.getElementById("pd-crop").disabled && !/Loading/.test(document.getElementById("pd-your").textContent));
    const bars = await pg.$$eval("#pd-your .pd-crop", (cs) => cs.map((c) => c.innerText.replace(/\s+/g, " ")));
    const cb = bars.find((t) => /^Corn /.test(t) && !/High Amylose/.test(t));
    const rows = JSON.parse(read("data/rma-prices/IA.json")).rows;
    const r = rows.find((x) => x.crop === "Corn" && /^All/.test(x.type) && x.practice === "Conventional");
    if (Math.abs(avg - r.h_price) / r.h_price > 0.03) return; // the 3% guard keeps RMA's figure
    const d = new Date(last + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const pct = ((avg - r.p_price) / r.p_price * 100).toFixed(1);
    assert.match(cb, /Our running average of the daily settles against the projected price/i);
    assert.ok(cb.includes(`$${avg.toFixed(2)} our average, through ${d}`), cb.slice(0, 400));
    assert.ok(cb.includes(`+${pct}%`), "the bar's percent is ours");
    assert.ok(cb.includes(`would revise up ${pct}%: figured at the $${avg.toFixed(2)} /bu running harvest price.`), cb.slice(0, 600));
    assert.match(cb, new RegExp(`RMA’s latest posted figure: \\$${r.h_price.toFixed(2)}( \\(through [A-Z][a-z]{2} \\d+\\))?`));
    assert.doesNotMatch(cb, /RMA, through/);
    assert.doesNotMatch(cb, /\b(better|official)\b/i, "ours is never called better or official");
    // the calculator prints the same percent
    await pg.selectOption("#pd-crop", await pg.$eval("#pd-crop", (s) => [...s.options].find((o) => o.textContent === "Corn").value));
    await pg.fill("#pd-aph", "180"); await pg.dispatchEvent("#pd-aph", "input");
    const calc = await pg.$eval("#pd-gout2", (x) => x.textContent);
    assert.ok(calc.includes(`$${avg.toFixed(2)}`) && calc.includes(`+${pct}%`), calc);
    // High Amylose has no settles of its own: RMA's figure, no RMA line
    const ha = bars.find((t) => /High Amylose/.test(t));
    if (ha) { assert.doesNotMatch(ha, /our average|latest posted figure/); }
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
