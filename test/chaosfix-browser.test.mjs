/* The chaos audit's faults, reproduced the way the audit found them (needs
 * Playwright and Chromium; skipped where they are missing): Playwright routes
 * serve an old, empty, missing or never-answering data file, and
 * page.clock.setFixedTime moves the date. Every case runs at 390 and 1280.
 * The price cases read test/fixtures/chaosfix/prices-2026-10-17.json (the
 * Oct 17, 2026 file), so they do not change as data/prices.json does.
 *   node --test test/chaosfix-browser.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const BIDS = process.env.BIDS_PATH || "/home/user/bids/";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const skipBids = skip || (!existsSync(BIDS + "data/merged-index.json") ? "no local dnilgis/bids clone" : false);
const WIDTHS = [390, 1280];
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const FIX = read("test/fixtures/chaosfix/prices-2026-10-17.json");

/* every ISO date (and epoch field) moved back `days`, as the audit did */
function shift(txt, days) {
  const ms = days * 864e5;
  txt = txt.replace(/\b(20\d\d)-(\d\d)-(\d\d)(T[\d:.]+(Z|[+-]\d\d:?\d\d)?)?/g, (m, y, mo, d, t) => new Date(Date.UTC(+y, +mo - 1, +d) - ms).toISOString().slice(0, 10) + (t || ""));
  return txt.replace(/("(?:ts|t|time|updated|asof|read|posted)"\s*:\s*)(1[6-9]\d{8})(\d{3})?\b/g, (m, k, s, x) => (x ? k + (+(s + x) - ms) : k + (+s - days * 86400)));
}
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".ics": "text/calendar" };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = normalize(join(ROOT, p));
    if (f.endsWith("/")) f += "index.html";
    if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
const J = (body) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });
/* o: {clock, install, routes: {path: (raw) => fulfil | null (hang)}, bids: (path, raw) => fulfil} */
async function open(browser, port, path, width, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
  const pg = await ctx.newPage(), errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.route((u) => !u.href.startsWith(`http://127.0.0.1:${port}`) && !u.href.startsWith("https://dnilgis.github.io/bids/"), (r) => r.abort());
  await pg.route((u) => u.href.startsWith("https://dnilgis.github.io/bids/"), async (r) => {
    const p = new URL(r.request().url()).pathname.replace("/bids/", ""), f = BIDS + p;
    if (!o.bids || !existsSync(f)) return r.fulfill({ status: 404, body: "x" });
    const out = o.bids(p, readFileSync(f, "utf8"));
    return out ? r.fulfill(out) : undefined;
  });
  for (const [p, fn] of Object.entries(o.routes || {})) {
    await pg.route((u) => u.pathname === p, async (r) => { const out = fn(existsSync(join(ROOT, p)) ? read(p) : ""); if (out) await r.fulfill(out); });
  }
  if (o.install) await pg.clock.install({ time: new Date(o.install) });
  else if (o.clock) await pg.clock.setFixedTime(new Date(o.clock));
  await pg.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
  return { ctx, pg, errs };
}
async function noSideScroll(pg, w) {
  const hs = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(hs <= 0, `no sideways scroll at ${w} (${hs}px)`);
}
async function each(fn) {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try { for (const w of WIDTHS) await fn(browser, port, w); } finally { await browser.close(); srv.close(); }
}
const PX = (days) => ({ "/data/prices.json": () => J(days ? shift(FIX, days) : FIX) });

test("chaos-1: a 400-day-old settle names its year and age, and the hero greys", { skip, timeout: 120000 }, async () => {
  await each(async (browser, port, w) => {
    const { ctx, pg, errs } = await open(browser, port, "/corn-futures-prices.html", w, { clock: "2026-10-17T17:00:00Z", routes: PX(400) });
    await pg.waitForFunction(() => /settle/.test(document.getElementById("status").textContent), null, { timeout: 15000 });
    const st = await pg.textContent("#status");
    assert.match(st, /Sep 11, 2025 settle · 401 days old/, w + ": " + st);
    assert.ok(await pg.$(".ph.px-old"), w + ": hero greyed");
    assert.ok(await pg.$("#status .px-stamp.is-stale"));
    await noSideScroll(pg, w);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});

test("chaos-1: a 10-day-old file is not today's either", { skip, timeout: 120000 }, async () => {
  await each(async (browser, port, w) => {
    const { ctx, pg } = await open(browser, port, "/corn-futures-prices.html", w, { clock: "2026-10-17T17:00:00Z", routes: PX(10) });
    await pg.waitForFunction(() => /settle/.test(document.getElementById("status").textContent), null, { timeout: 15000 });
    assert.match(await pg.textContent("#status"), /Oct 6 settle · 11 days old/);
    assert.ok(await pg.$(".ph.px-old"));
    // the current file the same day is plain
    await ctx.close();
    const b = await open(browser, port, "/corn-futures-prices.html", w, { clock: "2026-10-17T17:00:00Z", routes: PX(0) });
    await b.pg.waitForFunction(() => /settle/.test(document.getElementById("status").textContent), null, { timeout: 15000 });
    assert.doesNotMatch(await b.pg.textContent("#status"), /days old/);
    assert.equal(await b.pg.$(".ph.px-old"), null);
    await b.ctx.close();
  });
});

test("chaos-1: /markets on Jan 2 2027 rolls off Dec '26 and says how old the file is", { skip, timeout: 120000 }, async () => {
  await each(async (browser, port, w) => {
    const { ctx, pg, errs } = await open(browser, port, "/markets.html", w, { clock: "2027-01-02T17:00:00Z", routes: PX(0) });
    await pg.waitForFunction(() => /days old/.test(document.getElementById("price-data-status").textContent), null, { timeout: 15000 });
    const st = await pg.textContent("#price-data-status");
    assert.match(st, /Oct 16, 2026 settle/); assert.match(st, /78 days old/);
    const deck = await pg.textContent("#pc-card-corn-dec .pc-contract");
    assert.equal(deck, "Dec '27", "the Dec card is the next live Dec");
    assert.match(await pg.textContent("#pcc-corn-dec"), /Oct 16, 2026/);
    assert.ok(await pg.$(".pc.px-old"), "cards greyed");
    assert.doesNotMatch(await pg.evaluate(() => document.body.innerText), /Dec '26/, "no expired contract named");
    await noSideScroll(pg, w);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});

test("chaos-10: Sep 1 2027, the new-crop tile is Dec '27, not Dec '28", { skip, timeout: 120000 }, async () => {
  await each(async (browser, port, w) => {
    const { ctx, pg } = await open(browser, port, "/corn-futures-prices.html", w, { clock: "2027-09-01T16:00:00Z", routes: PX(0) });
    await pg.waitForFunction(() => /new crop/.test(document.getElementById("lbl-corndec").textContent), null, { timeout: 15000 });
    assert.equal(await pg.textContent("#lbl-corndec"), "Dec '27 new crop");
    await ctx.close();
  });
});

test("chaos-11: 'Next report' rolls past a released WASDE", { skip, timeout: 120000 }, async () => {
  const wpi = (raw) => { const d = JSON.parse(raw); d.upcoming = { ...(d.upcoming || {}), report: "November WASDE", date: "2026-11-10" }; return J(JSON.stringify(d)); };
  await each(async (browser, port, w) => {
    const a = await open(browser, port, "/corn-futures-prices.html", w, { clock: "2026-11-12T16:00:00Z", routes: { ...PX(0), "/data/whats-priced-in.json": wpi } });
    await a.pg.waitForFunction(() => /WASDE/.test((document.getElementById("snap-wasde") || {}).textContent || ""), null, { timeout: 15000 });
    assert.equal(await a.pg.textContent("#snap-wasde"), "December WASDE · Dec 10 · in 28 days");
    await a.ctx.close();
    // Dec 20: Dec 10 is past too; the line names a later WASDE from the calendar, or hides, never "released"
    const b = await open(browser, port, "/corn-futures-prices.html", w, { clock: "2026-12-20T17:00:00Z", routes: { ...PX(0), "/data/whats-priced-in.json": wpi } });
    await b.pg.waitForTimeout(2500);
    const t = await b.pg.evaluate(() => { const x = document.getElementById("snap-wasde-wrap"); return x && x.style.display !== "none" ? x.textContent : ""; });
    assert.doesNotMatch(t, /released|Nov 10|Dec 10/);
    await b.ctx.close();
  });
});

test("chaos-4: /daily with a briefing request that never answers shows its error and retry", { skip, timeout: 120000 }, async () => {
  await each(async (browser, port, w) => {
    const { ctx, pg } = await open(browser, port, "/daily.html", w, { install: "2026-10-17T13:00:00Z", routes: { "/data/daily.json": () => null } });
    assert.ok(await pg.$(".dv3-sk .dv3-sk-slow"), "plain line under the skeleton");
    await pg.clock.runFor(16000);
    await pg.waitForFunction(() => /didn.t load/.test(document.body.innerText), null, { timeout: 5000 });
    assert.equal(await pg.$(".dv3-sk"), null, "skeleton gone");
    await noSideScroll(pg, w);
    await ctx.close();
  });
});

test("chaos-12: /basis with an empty transport file says it did not load, no TypeError", { skip, timeout: 120000 }, async () => {
  await each(async (browser, port, w) => {
    for (const p of ["/data/transport/basis.json", "/data/transport/journey.json"]) {
      const { ctx, pg, errs } = await open(browser, port, "/basis.html", w, { routes: { [p]: () => J("{}") } });
      await pg.waitForFunction(() => /didn.t load/.test(document.getElementById("bs-barge").textContent), null, { timeout: 15000 });
      assert.deepEqual(errs, [], p);
      await ctx.close();
    }
  });
});

test("chaos-3: the home strip in April names last season's report, never as this spring's", { skip, timeout: 120000 }, async () => {
  const cp = read("test/fixtures/crop-progress-2026-10-16.json");
  await each(async (browser, port, w) => {
    const { ctx, pg } = await open(browser, port, "/index.html", w, { clock: "2027-04-02T16:00:00Z", routes: { "/data/crop-progress.json": () => J(cp), ...PX(0) } });
    await pg.waitForFunction(() => /Last report/.test((document.getElementById("s7-month") || {}).textContent || ""), null, { timeout: 15000 });
    const t = await pg.evaluate(() => document.getElementById("s7-month").innerText);
    assert.match(t, /Last report: Oct 11, 2026/);
    assert.match(t, /2026 season\. The first 2027 Crop Progress comes out in early April\./);
    assert.doesNotMatch(t, /Corn 97%/, "last fall's planting is not shown as this spring's");
    await ctx.close();
  });
});

test("chaos-8: the home briefing teaser says 'latest issue' for an old issue", { skip, timeout: 120000 }, async () => {
  const daily = (raw) => { const d = JSON.parse(raw); d.date = "Saturday, October 17, 2026"; return J(JSON.stringify(d)); };
  await each(async (browser, port, w) => {
    const { ctx, pg } = await open(browser, port, "/index.html", w, { clock: "2027-01-02T17:00:00Z", routes: { "/data/daily.json": daily, ...PX(0) } });
    await pg.waitForFunction(() => /Latest issue/.test(document.getElementById("daily-teaser-date").textContent), null, { timeout: 15000 });
    assert.match(await pg.textContent("#daily-teaser-date"), /Latest issue: Oct 17, 2026/);
    assert.doesNotMatch(await pg.textContent("#daily-teaser"), /today/i);
    await noSideScroll(pg, w);
    await ctx.close();
  });
});

test("chaos-6: /rain-print-business on Dec 20 says orders arrive after Christmas", { skip, timeout: 120000 }, async () => {
  const ctxv = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob }; ctxv.window = ctxv;
  vm.runInNewContext(read("components/rain-print.js"), ctxv);
  const RJ = JSON.parse(read("data/rain-print.json"));
  await each(async (browser, port, w) => {
    const { ctx, pg } = await open(browser, port, "/rain-print-business.html", w, { clock: "2026-12-20T17:00:00Z" });
    await pg.waitForFunction(() => !/send it by/.test(document.getElementById("rbz-xmas").textContent), null, { timeout: 15000 });
    const t = await pg.textContent("#rbz-xmas");
    assert.equal(t, ctxv.RainPrint.bizChristmasLine("2026-12-20", RJ) + " This year’s print ships in January, once the full year’s numbers are in.");
    if (RJ.print_christmas_cutoff && RJ.print_christmas_cutoff.startsWith("2026")) assert.match(t, /^Orders placed now arrive after Christmas\./);
    assert.doesNotMatch(t, /ships before Christmas/);
    await ctx.close();
  });
});

/* Cash bids: the local dnilgis/bids clone stands in for dnilgis.github.io/bids,
   as in the audit; the clock is set to the morning after its index was built. */
function bidsClock() { return new Date(Date.parse(JSON.parse(readFileSync(BIDS + "data/merged-index.json", "utf8")).generated) + 16 * 36e5).toISOString(); }
test("chaos-2: a board frozen 30 days is never Best and its card says so", { skip: skipBids, timeout: 180000 }, async () => {
  const frozen = readdirSync(BIDS + "data/merged").find((f) => f.startsWith("mid-iowa-cooperative-state-center"));
  await each(async (browser, port, w) => {
    const { ctx, pg } = await open(browser, port, "/cash-bids.html?zip=50010", w, {
      clock: bidsClock(), routes: PX(0),
      bids: (p, raw) => J(frozen && p.endsWith(frozen) ? shift(raw, 30) : raw),
    });
    await pg.waitForFunction(() => (document.getElementById("best-bids-grid") || {}).children && document.getElementById("best-bids-grid").children.length > 0, null, { timeout: 30000 });
    await pg.waitForTimeout(1500);
    const best = await pg.textContent("#best-bids-grid");
    assert.match(best, /BEST CORN|Best corn/i);
    assert.doesNotMatch(best, /STATE CENTER/i, w + ": the frozen board is not Best");
    assert.doesNotMatch(best, /31 days old/);
    for (let i = 0; i < 4; i++) { const more = await pg.$("#cb-more-btn"); if (!more) break; await more.click(); await pg.waitForTimeout(500); }
    const all = await pg.evaluate(() => document.body.innerText);
    assert.match(all, /board not updated in over 3 trading days, call before you load/, w + ": the card stays, flagged");
    await ctx.close();
  });
});

test("chaos-7: elevator files that 404, come back cut off or empty show 'Unable to Load Bids', not 'no elevators'", { skip: skipBids, timeout: 240000 }, async () => {
  const faults = { "404": () => ({ status: 404, body: "x" }), trunc: (raw) => J(raw.slice(0, raw.length >> 1)), empty: () => J("{}") };
  await each(async (browser, port, w) => {
    for (const [name, f] of Object.entries(faults)) {
      const { ctx, pg } = await open(browser, port, "/cash-bids.html?zip=50010", w, {
        clock: bidsClock(), routes: PX(0),
        bids: (p, raw) => (p.startsWith("data/merged/") ? f(raw) : J(raw)),
      });
      // cash-bids.html ships a "Find elevators near you" .cb-empty as the no-ZIP placeholder, so
      // .cb-empty is there before any fetch; wait for the page to replace it with what the load came to
      // (Oct 22: on a slow runner the placeholder was read before the bids files had answered).
      await pg.waitForFunction(() => { const e = document.querySelector("#cb-results .cb-empty"); return e && !/Find elevators near you/.test(e.textContent); }, null, { timeout: 40000 });
      const t = await pg.textContent(".cb-empty");
      assert.match(t, /Unable to Load Bids/, `${w} ${name}: ${t}`);
      assert.doesNotMatch(t, /No current bids/);
      assert.ok(await pg.$("#cb-retry"), "Retry offered");
      await ctx.close();
    }
  });
});
