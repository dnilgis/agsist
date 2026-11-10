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
  const src = read("components/home-yield.js");
  // the badge calls stampAt (a last trade stamped from its close_time), a one-line helper beside it in the same file
  const body = src.match(/function stampAt\(cq,F\)\{[^\n]*\}/)[0] + "\n" + src.match(/var _st=(\(function\(iso\)\{[\s\S]*?\}\)\(data\.fetched\));/)[1];
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
  assert.equal(badge(live, "2026-10-20T01:40:00Z").t, "Delayed 10 to 25 min");
  // and the day session too
  const day = { fetched: "2026-10-20T15:00:00Z", quotes: { "corn-nearby": { close: 466, close_kind: "last", close_date: "2026-10-20" } } };
  assert.equal(badge(day, "2026-10-20T15:10:00Z").t, "Delayed 10 to 25 min");
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

// Every file the page reads for this case is a frozen copy from Nov 3, 2026 (test/fixtures/pricefix/: the Iowa rows,
// RMA's index and our harvest-prices.json, the October windows closed), and the clock is that copy's day.
test("1: Nov 3, Iowa corn and soybeans closed Oct 31, not released: no 'if it closed today'", { skip, timeout: 90000 }, async () => {
  const FX = read("test/fixtures/pricefix/IA-closed-unreleased.json");
  const HPF = read("test/fixtures/pricefix/harvest-prices-nov3.json");
  const NOW = JSON.parse(HPF).updated + "T18:00:00Z";
  // Iowa is the page's reference state: its rows also ride in index.json (ref_rows)
  const IDX = JSON.parse(read("test/fixtures/pricefix/rma-index-nov3.json"));
  assert.equal(IDX.ref_state, "IA", "fixture: Iowa is the reference state");
  IDX.ref_rows = JSON.parse(FX).rows;
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
      const pg = await ctx.newPage();
      await pg.clock.setFixedTime(new Date(NOW));
      const errors = [];
      pg.on("pageerror", (e) => errors.push(String(e)));
      await pg.route("**/*", (r) => {
        const u = r.request().url();
        if (!u.startsWith(`http://127.0.0.1:${port}`)) return r.abort();
        if (u.includes("/data/rma-prices/index.json")) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(IDX) });
        if (u.includes("/data/rma-prices/IA.json")) return r.fulfill({ status: 200, contentType: "application/json", body: FX });
        if (u.includes("/data/harvest-prices.json")) return r.fulfill({ status: 200, contentType: "application/json", body: HPF });
        if (new URL(u).pathname.startsWith("/data/rma-prices/")) return r.abort(); // only Iowa is picked
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
      assert.match(your, /Window closed Oct 31\. RMA has not posted the final price yet\. If the final matches the last posted average, your revenue guarantee revises up 6\.3%: figured at the \$4\.91 \/bu last posted harvest price\./); // pin-ok: frozen fixture
      // soybeans, down: 10.80 against 11.09
      assert.match(your, /Window closed Oct 31\. RMA has not posted the final price yet\. A last posted average below the projected price does not cut your guarantee: it stays figured at the \$11\.09 \/bu projected price\./); // pin-ok: frozen fixture
      assert.match(your, /Last posted average against the projected price/i);
      assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth), width);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

/* ---- a product decision Oct 20 (v37 item 2): the window bar uses our running average where we have the settles ----
 * Reads a frozen copy of the harvest data (test/fixtures/harvest-tracker/, the copy test/harvest-tracker-oct19
 * reads: Oct 25, 2026, Iowa corn's window running), routed in the browser, on a clock taken from that copy. On live
 * data/ it returned early once the October window closed (Nov 2), so nothing was checked (build rule 50). */
const HFIX = "test/fixtures/harvest-tracker";
test("bar: Iowa corn reads our running average, the calculator's number, with RMA's figure in one line", { skip, timeout: 90000 }, async () => {
  const HP = JSON.parse(read(HFIX + "/harvest-prices.json"));
  const corn = HP.commodities.find((c) => c.label === "Corn");
  const ser = (corn.harvest && corn.harvest.series) || [];
  // the frozen copy has the window running, so every check below fires
  assert.equal(corn.harvest.status, "running", "fixture: corn window running");
  assert.ok(ser.length > 0, "fixture: settles on file");
  const avg = Math.round(ser.reduce((t, x) => t + +x.s, 0) / ser.length * 100 + 1e-7) / 100;
  const last = ser[ser.length - 1].d;
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 900 } });
    const pg = await ctx.newPage();
    await pg.clock.setFixedTime(new Date(last + "T23:00:00Z"));
    await pg.route("**/*", (r) => {
      const u = r.request().url();
      if (!u.startsWith(`http://127.0.0.1:${port}`)) return r.abort();
      // the harvest data comes from the frozen copy, never live data/
      const path = new URL(u).pathname;
      if (path === "/data/harvest-prices.json" || path.startsWith("/data/rma-prices/")) {
        const f = join(ROOT, HFIX, path.slice("/data/".length));
        if (!existsSync(f)) return r.abort();
        return r.fulfill({ status: 200, contentType: "application/json", body: readFileSync(f) });
      }
      return r.continue();
    });
    await pg.goto(`http://127.0.0.1:${port}/harvest-price-tracker.html`);
    await pg.waitForFunction(() => document.querySelector("#pd-state option[value=IA]"));
    await pg.selectOption("#pd-state", "IA");
    await pg.waitForFunction(() => !document.getElementById("pd-crop").disabled && !/Loading/.test(document.getElementById("pd-your").textContent));
    const bars = await pg.$$eval("#pd-your .pd-crop", (cs) => cs.map((c) => c.innerText.replace(/\s+/g, " ")));
    const cb = bars.find((t) => /^Corn /.test(t) && !/High Amylose/.test(t));
    const rows = JSON.parse(read(HFIX + "/rma-prices/IA.json")).rows;
    const r = rows.find((x) => x.crop === "Corn" && /^All/.test(x.type) && x.practice === "Conventional");
    // the 3% guard keeps RMA's figure; in the frozen copy ours is within it, so our average is the one shown
    assert.ok(Math.abs(avg - r.h_price) / r.h_price <= 0.03, `fixture: ours ${avg} within 3% of RMA's ${r.h_price}`);
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
    assert.ok(ha, "fixture: Iowa has a High Amylose corn row");
    assert.doesNotMatch(ha, /our average|latest posted figure/);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

/* ---- 4: /markets lead, cards on different settle dates ---- */
test("4: the markets lead shows the settle range, and the baked twin says the same", async () => {
  const { execFileSync } = await import("node:child_process");
  const P = (await import(join(ROOT, "components/price-local.js"))).default;
  const NOW = Date.parse("2026-10-20T08:00:00Z"); // Tue 3:00 AM CT
  const s = (d) => ({ close: 1, close_kind: "settle", close_date: d });
  // the v40 case: corn Oct 19, milk Oct 16
  const q = { corn: s("2026-10-19"), milk: s("2026-10-16") };
  const js = P.board(q, null, "2026-10-20T08:00:00Z", NOW);
  assert.match(js, /^Oct 16 to Oct 19 settles\. Read 3:00\sam CT$/);
  assert.equal(P.board({ corn: s("2026-10-19"), beans: s("2026-10-19") }, null, "2026-10-20T08:00:00Z", NOW).split(".")[0], "Oct 19 settle");
  assert.equal(P.board({ corn: s("2026-10-19"), milk: s("2026-10-16"), crude: { close: 1, close_kind: "last" } }, null, "", NOW),
    "Oct 16 to Oct 19 settles where posted, latest delayed trade otherwise");
  // seed_static.mk_board, same words before ". Read"
  const py = execFileSync("python3", ["-c", [
    "import sys", `sys.path.insert(0, ${JSON.stringify(join(ROOT, "scripts"))})`, "import seed_static as s",
    "keys=[k for _,_,_,k,_ in s.MK_MAP]",
    "q={keys[0]:{'close':1,'close_kind':'settle','close_date':'2026-10-19'}, 'milk':{'close':1,'close_kind':'settle','close_date':'2026-10-16'}}",
    "assert 'milk' in keys",
    "print(s.mk_board(q, '2026-10-20T08:00:00Z'))"].join("\n")], { encoding: "utf8" }).trim();
  assert.equal(py.split(". Read")[0], "Oct 16 to Oct 19 settles");
  assert.equal(js.split(". Read")[0], py.split(". Read")[0]);
});

/* ---- 5: cattle, zero changes ---- */
test("5: cattle change with no netChange and 0% is unch (page and seed agree); a zero COT week is not green", async () => {
  const { execFileSync } = await import("node:child_process");
  const h = read("cattle-futures-prices.html");
  const src = h.match(/function chgCwt\(q\)\{[\s\S]*?\n  \}/)[0];
  const ctx = { AG: { px: { cash: (v) => v.toFixed(2) } } };
  vm.runInNewContext("function cwtN(v){return AG.px.cash(Math.abs(v),{dollar:false});}\n" + src + "\nthis.f=chgCwt;", ctx);
  const py = (q) => JSON.parse(execFileSync("python3", ["-c", "import json,sys; sys.path.insert(0,'scripts'); import seed_static as s; print(json.dumps(s._cwt_chg(json.loads(sys.argv[1]))))", JSON.stringify(q)], { cwd: ROOT, encoding: "utf8" }));
  for (const q of [{ netChange: null, pctChange: 0 }, { netChange: null, pctChange: 0.004 }, { netChange: null, pctChange: -0.001 }]) {
    assert.deepEqual([...ctx.f(q)], ["unch", "nc"], JSON.stringify(q));
    assert.deepEqual(py(q), ["unch", "nc"], "seed " + JSON.stringify(q));
  }
  assert.equal(ctx.f({ netChange: null, pctChange: 0.3 })[1], "up");
  assert.equal(py({ netChange: null, pctChange: -0.3 })[1], "dn");
  // the COT week line: up only above zero, down only below
  assert.match(h, /'Week: <span class="d '\+\(dl>0\?'up':dl<0\?'dn':'nc'\)\+'">'/);
  assert.doesNotMatch(h, /dl>=0\?'up'/);
});
