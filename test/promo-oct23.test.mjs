/* Sig, Oct 23 2026: more organic email signups and quieter, steadier promotion of Rain Print,
 * the rain gauge waitlist and the Daily, without nagging. The rules these hold:
 *   - one cross-promo a page, after the answer; no popups, timers or exit-intent;
 *   - no sponsor on Rain Print, gift or gauge pages;
 *   - every ask has a real sender; no box starts ticked; every notice signup gets "One more?";
 *   - the Daily is "every morning", never a clock time.
 * What was built: Fast Facts buy link and its one Daily ask (no bar there), "See this morning's
 * email" under the Daily page asks, the rent land line, the Paid view's Daily ask and gauge line,
 * the gauge in "One more?" after a rain-year notice or a hail alert, the waitlist's own "One more?",
 * the see lines (conditions, spray, ARC/PLC counties, cash-bid towns), the gauge line on
 * /rain-radar, the homepage card's early place, the Daily email's forward line and order-by date.
 * The browser parts need Playwright and Chromium and skip where they are missing.
 *
 *   node --test test/promo-oct23.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const DASH = /[–—]|&mdash;|&ndash;/;
const inMain = (h) => h.slice(h.indexOf("<main"), h.indexOf("</main>"));
const promos = (h) => (h.match(/data-rain-print-promo/g) || []).length + (h.match(/class="rp-promo"(?![^>]*data-rain-print-promo)/g) || []).length;

test("one cross-promo a page, after the answer, with its script", () => {
  const pages = {
    "conditions.html": ['data-rain-print-promo="see"', 'class="cd-panel cd-faq-panel"'],
    "spray.html": ['data-rain-print-promo="see"', 'id="section-faq"'],
    "rain-radar.html": ['data-rain-print-promo="gauge"', 'class="rr-faq"'],
  };
  for (const [f, [slot, after]] of Object.entries(pages)) {
    const h = read(f), m = inMain(h);
    assert.equal(promos(m), 1, f + ": exactly one promo");
    assert.ok(m.includes(`<p class="rp-promo" ${slot} hidden></p>`), f + ": the slot, hidden until filled");
    assert.ok(m.indexOf(slot) > m.indexOf(after), f + ": after the answer and the questions");
    assert.match(h, /rain-print-promo\.js\?v=5" defer/, f);
  }
  // /hail-map keeps its one Rain Print line (Oct 19 rule): the gauge waits on Sig's swap after Dec 10
  const hm = inMain(read("hail-map.html"));
  assert.equal((hm.match(/class="rp-promo"/g) || []).length, 1);
  assert.ok(!/href="\/rain-gauge"/.test(hm));
  // Fast Facts: no promo slot; its Rain Print is the place's own print with a buy link
  assert.equal(promos(read("fast-facts.html")), 0);
  // the homepage: one card, one early marker (the card moves, it is never doubled)
  const ix = read("index.html");
  assert.equal((ix.match(/data-rain-print-promo/g) || []).length, 1);
  assert.equal((ix.match(/data-rp-card-early/g) || []).length, 1);
  assert.ok(ix.indexOf("data-rp-card-early") > ix.indexOf('id="f-prices"') && ix.indexOf("data-rp-card-early") < ix.indexOf('id="s7-month"'), "right under the prices");
});

test("rent pages: the notice ask right under the county table, one land line after the FAQ", () => {
  const dir = path.join(ROOT, "rent");
  const states = fs.readdirSync(dir).filter((f) => f.endsWith(".html") && f !== "index.html");
  assert.equal(states.length, 47);
  for (const f of states) {
    const h = read("rent/" + f), at = h.indexOf('data-topic="rent:');
    assert.ok(at > 0, f);
    assert.ok(at - h.lastIndexOf("</table>", at) < 900, f + ": under the county table");
    assert.ok(!/data-daily="on"|checked/.test(h.slice(h.lastIndexOf("<div", at), h.indexOf("</div>", at))), f + ": nothing ticked");
    assert.equal(promos(inMain(h)), 1, f);
    assert.ok(h.indexOf('data-rain-print-promo="land"') > h.lastIndexOf('class="rs-faq"'), f + ": after the FAQ");
    assert.match(h, /rain-print-promo\.js\?v=5" defer/, f);
  }
  assert.equal(promos(inMain(read("rent/index.html"))), 0, "the hub carries none");
});

test("the land line runs through the framed order-by date only, from the data", () => {
  const P = createRequire(import.meta.url)(path.join(ROOT, "components/rain-print-promo.js"));
  const cfg = JSON.parse(read("data/rain-print.json"));
  const on = P.lineFor(cfg, "land", "2026-10-23");
  assert.match(on, /landlord or the tenant: a year of rain on the home farm or the rented ground/);
  assert.ok(on.endsWith("Order framed by Dec 9.") && !DASH.test(on));
  assert.equal(P.lineFor(cfg, "land", cfg.promote_until), on);
  assert.equal(P.lineFor(cfg, "land", "2026-12-10"), "");
  assert.equal(P.lineFor(Object.assign({}, cfg, { promote: false }), "land", "2026-10-23"), "");
  // the card's early place: Christmas wording only (through the framed cutoff), then its old place
  assert.equal(P.cardFor(cfg, cfg.framed_christmas_cutoff).angle, "christmas");
  assert.notEqual(P.cardFor(cfg, "2026-12-10").angle, "christmas");
  const src = read("components/rain-print-promo.js");
  assert.match(src, /if \(c\.angle === 'christmas'\) \{\s+var early = doc\.querySelector\('\[data-rp-card-early\]'\);/);
});

test("see lines: ARC/PLC county and cash-bid town generators carry one tiny slot", () => {
  const ap = read("scripts/build_arc_plc.py");
  assert.match(ap, /RP_SEE = '<p class="rp-promo ap-noprint" data-rain-print-promo="see" hidden><\/p>'/);
  assert.match(ap, /\{f'<div class="ap-faq ap-noprint">[^\n]+\n  \{RP_SEE\}\n/);
  assert.match(ap, /tail\(ftr, calc=True, math=official, promo=True\)/);
  const cb = read("scripts/build_cash_bid_pages.py");
  assert.match(cb, /return RP_SEE_SLOT\n    return RP_GIFT_SLOT/);
  assert.equal(execFileSync("python3", ["-c", "import sys,datetime as d;sys.path.insert(0,'scripts');import build_cash_bid_pages as B;print(B.rain_print_line(d.datetime(2026,10,23,12)));print(B.rain_print_line(d.datetime(2026,11,2,12)))"], { cwd: ROOT, encoding: "utf8" }).trim(),
    '<p class="rp-promo" data-rain-print-promo="see" hidden></p>\n<p class="rp-promo" data-rain-print-promo hidden></p>');
});

test("signup asks: the sample link under Daily page asks only; no ticked box; no bar on Fast Facts", () => {
  const sa = read("components/signup-ask.js");
  assert.match(sa, /\(!topic && variant === 'page' \? '<p class="sa-n sa-see"><a href="\/daily" data-sa-sample>See this morning\\u2019s email<\/a><\/p>' : ''\)/);
  assert.ok(!/type="checkbox"[^>]*checked/.test(sa), "no box starts ticked");
  assert.match(sa, /\^\\\/\(daily\|field-scout\|fast-facts\|rain-print\|/);
  // the gauge offer: after a rain-year notice or a hail alert, never on the gauge's own signup, never twice
  assert.match(sa, /var wantGauge = \(gave === 'hail' \|\| \(gave === 'notice' && \/\^rainyear:\/\.test\(topic\)\)\) && had\.indexOf\('gauge'\) < 0 && !noticeDone\('rain-gauge'\);/);
  assert.match(sa, /topic: 'rain-gauge', daily: false, askId: 'onemore'/);
  assert.match(sa, /c\.gauge_hook/, "its words come from data/rain-print.json gauge_hook when set");
  // the waitlist's own One more?: found by its form, so rain-gauge.html is not touched
  assert.match(sa, /f\.matches\('form\.rg-form'\)/);
  // Fast Facts: one ask, a Daily ask, after the first card
  const ff = read("fast-facts.html");
  const asks = ff.match(/<div[^>]*data-signup-ask[^>]*><\/div>/g) || [];
  assert.equal(asks.length, 1);
  assert.ok(!/data-topic/.test(asks[0]) && /data-zip-input="h-q"/.test(asks[0]) && /every morning/.test(asks[0]) && !DASH.test(asks[0]));
  const cards = [...ff.matchAll(/<section class="fx-card">/g)].map((m) => m.index), at = ff.indexOf(asks[0]);
  assert.ok(at > cards[0] && at < cards[1], "after the first card");
  assert.match(read("components/here.js"), /Make this one with your name &rarr;/);
});

test("no sponsor on the gift guide; the Daily is every morning", () => {
  const g = read("gifts-for-farmers.html");
  assert.ok(g.includes('#site-footer a[href^="/sponsor"],#site-footer a[href^="/sponsor"]+.footer-sep,#site-footer #footer-adspace{display:none!important}'));
  assert.ok(!/ag-sponsor-ribbon|data-slot=|Sponsor this page/.test(g));
  const d = read("daily.html");
  assert.ok(!/before the market open/.test(d), "no clock promise on /daily");
  assert.ok(d.includes("lands in your inbox every morning:") && d.includes("It posts every morning."));
});

test("Paid view: a Daily ask with an empty box, and the gauge line, under the thank-you", () => {
  const rp = read("components/rain-print.js");
  const fn = rp.slice(rp.indexOf("  function paidMore(box) {"), rp.indexOf("  function showPaid("));
  assert.match(fn, /data-signup-ask="AGSIST Daily: the markets and your top local bid, free, every morning" data-source="page:rain-print-paid"/);
  assert.ok(!/checked|data-daily/.test(fn));
  assert.match(fn, /<a href="\/rain-gauge" data-placement="rain-print-paid">Get on the list<\/a>/);
  assert.match(rp, /var GAUGE_LINE = 'Also in the works: a better rain gauge\.';/);
  assert.ok(!DASH.test(fn));
});

test("Daily email: forward line right under Today; the Christmas order-by date in Print of the day", () => {
  const code = `
import json, sys
from datetime import date
sys.path.insert(0, "scripts")
import daily_v2 as V
pod = {"image_url": "https://agsist.com/daily/img/x.png", "why": "Why this place.", "make_url": "/rain-print?place=Ames%2C+IA&year=2026"}
daily = json.load(open("data/daily-archive/2026-10-21.json"))
out = []
for t in (date(2026, 10, 23), date(2026, 12, 10)):
    b = V.build(daily, "https://agsist.com/daily/2026-10-21.html", forward_url="https://agsist.com/?ref=email-forward", pod=pod, fact=None, today=t)
    out.append({"html": b["html"], "text": b["text"]})
print(json.dumps(out))`;
  const [on, off] = JSON.parse(execFileSync("python3", ["-c", code], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").pop());
  for (const [k, today, fwd, pod] of [["html", ">Today<", "Forward to a neighbor.", "Print of the day"], ["text", "TODAY", "Forward to a neighbor.", "PRINT OF THE DAY"]]) {
    const s = on[k];
    assert.equal(s.split(fwd).length, 2, k + ": one forward line");
    assert.ok(s.indexOf(today) < s.indexOf(fwd) && s.indexOf(fwd) < s.indexOf(pod), k + ": forward under Today, above the print");
    assert.ok(s.includes("For Christmas delivery, order a framed print by Dec 9, a print by Dec 10."), k + ": order-by date");
    assert.ok(s.indexOf("For Christmas delivery") > s.indexOf(pod), k + ": in the print block");
    assert.ok(!off[k].includes("For Christmas delivery"), k + ": gone after Dec 9");
  }
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = path.normalize(path.join(ROOT, p));
    if (!fs.existsSync(f) && fs.existsSync(f + ".html")) f += ".html";
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
const EMAIL = "reader@example.com";
async function newPage(browser, port, posts, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: o.width || 390, height: 844 } });
  if (o.init) await ctx.addInitScript(o.init);
  const pg = await ctx.newPage();
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    // the place lookup Fast Facts asks for a ZIP, answered here (the sandbox has no network)
    if (u.startsWith("https://geocoding-api.open-meteo.com/")) return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ results: [{ name: "Ames", latitude: 42.0347, longitude: -93.62, admin1: "Iowa", admin2: "Story", postcodes: ["50010"], country_code: "US" }] }) });
    if (u.startsWith("https://agsist-api.dnilgis.workers.dev/") && r.request().method() === "POST") {
      posts.push({ path: new URL(u).pathname, body: JSON.parse(r.request().postData() || "{}") });
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ ok: true }) });
    }
    return r.abort();
  });
  return pg;
}
const go = (pg, port, url) => pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
const noEmailIn = async (pg) => {
  const dl = await pg.evaluate(() => JSON.stringify(Array.from(window.dataLayer || [], (x) => Array.from(x && x.length !== undefined ? x : [x]))));
  assert.ok(!dl.includes(EMAIL), "no address in dataLayer");
};

test("in a browser: the gauge waitlist gets One more? with the Daily, unticked; no gauge row on its own signup", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port, posts = [];
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await newPage(browser, port, posts);
    await go(pg, port, "/rain-gauge.html");
    await pg.waitForFunction(() => window.AgsistSignup && window.AgsistSignup.oneMore);
    await pg.fill("#rg-email-1", EMAIL);
    await pg.click("#rg-go-1");
    const more = pg.locator("#rg-form-1 + [data-sa-more]");
    await more.locator(".sa-mh").waitFor();
    const keys = await more.locator("[data-k]").evaluateAll((a) => a.map((x) => x.getAttribute("data-k")));
    assert.equal(keys[0], "daily");
    assert.ok(!keys.includes("gauge"));
    for (const c of await more.locator('input[type="checkbox"]').all()) assert.equal(await c.isChecked(), false);
    assert.equal(posts.filter((p) => p.path === "/notice").length, 1, "the waitlist signup only, until they tick");
    await noEmailIn(pg);
    await pg.context().close();
  } finally { await browser.close(); srv.close(); }
});

test("in a browser: after the county rain-year notice, One more? offers the gauge, unticked, and adds it only when ticked", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port, posts = [];
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await newPage(browser, port, posts);
    await go(pg, port, "/rain/iowa/adams-county.html");
    const ask = pg.locator('[data-topic^="rainyear:"]').first();
    await ask.locator(".sa-in").waitFor();
    assert.equal(await ask.locator(".sa-d input").isChecked(), false, "the Daily box starts empty");
    await ask.locator(".sa-in").fill(EMAIL);
    await ask.locator(".sa-b").click();
    const more = pg.locator("[data-sa-more]");
    await more.locator(".sa-mh").waitFor();
    const keys = await more.locator("[data-k]").evaluateAll((a) => a.map((x) => x.getAttribute("data-k")));
    assert.ok(keys.includes("gauge") && keys[0] === "daily" && keys.length <= 3, keys.join(","));
    for (const c of await more.locator('input[type="checkbox"]').all()) assert.equal(await c.isChecked(), false);
    assert.match(await more.locator('[data-k="gauge"]').textContent(), /rain gauge/i);
    await more.locator('[data-k="gauge"] input').check();
    await more.locator(".sa-b").click();
    await more.locator(".sa-ok").waitFor();
    const g = posts.filter((p) => p.path === "/notice" && p.body.topic === "rain-gauge");
    assert.equal(g.length, 1);
    assert.equal(g[0].body.daily, false);
    assert.equal(posts.filter((p) => p.path === "/subscribe").length, 0, "the Daily was not ticked, so not sent");
    await noEmailIn(pg);
    await pg.context().close();
  } finally { await browser.close(); srv.close(); }
});

test("in a browser: Daily page asks carry the sample link, notice asks do not; the rent land line shows in season", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await newPage(browser, port, [], { init: () => { localStorage.setItem("agsist_user_zip", "54728"); } });
    await go(pg, port, "/fast-facts.html");
    await pg.waitForFunction(() => document.querySelector(".fx-ask[data-sa-ready]"));
    const ff = pg.locator(".fx-ask");
    assert.equal(await ff.locator("a[data-sa-sample]").getAttribute("href"), "/daily");
    assert.equal(await ff.locator(".sa-zin").inputValue(), "54728", "the ZIP filled in");
    assert.equal(await ff.locator('input[type="checkbox"]').count(), 0);
    await pg.context().close();
    const pr = await newPage(browser, port, []);
    await go(pr, port, "/rent/iowa.html");
    const na = pr.locator('main [data-topic="rent:ia"]');
    await na.locator(".sa-in").waitFor();
    assert.equal(await na.locator("a[data-sa-sample]").count(), 0, "no sample link on a notice ask");
    assert.equal(await na.locator(".sa-d input").isChecked(), false);
    const today = await pr.evaluate(() => window.AgsistRainPromo && window.AgsistRainPromo.chicagoToday());
    const cfg = JSON.parse(read("data/rain-print.json"));
    if (today >= cfg.promote_from && today <= cfg.promote_until) {
      await pr.locator('[data-rain-print-promo="land"]:not([hidden]) a').waitFor();
      assert.equal(await pr.locator('[data-rain-print-promo="land"] a').getAttribute("href"), "/rain-print");
    }
    await pr.context().close();
  } finally { await browser.close(); srv.close(); }
});

test("in a browser: the gift guide shows no Advertise or sponsor link, header or footer", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const pg = await newPage(browser, port, [], { width });
      await go(pg, port, "/gifts-for-farmers.html");
      await pg.waitForSelector("footer.footer", { timeout: 15000 });
      await pg.waitForSelector("#topnav", { timeout: 15000 });
      await pg.waitForTimeout(400);
      const vis = await pg.evaluate(() => [...document.querySelectorAll('#topnav a[href^="/sponsor"], #drawer a[href^="/sponsor"], footer.footer a[href^="/sponsor"], footer.footer a[href^="/prf-sponsor"]')]
        .filter((a) => a.getClientRects().length && getComputedStyle(a).visibility !== "hidden").map((a) => a.textContent));
      assert.deepEqual(vis, [], width + ": " + vis.join(", "));
      await pg.context().close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("in a browser: Fast Facts draws the county Rain Print with a buy link built as the county rain page builds its own", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await newPage(browser, port, []);
    await go(pg, port, "/fast-facts.html?zip=50010");
    await pg.waitForSelector("#h-place:not([hidden])", { timeout: 30000 });
    await pg.evaluate(() => { document.getElementById("h-more").open = true; });
    const a = pg.locator("#h-rp-box .h-rp-buy a");
    await a.waitFor({ timeout: 30000 });
    assert.equal(await a.textContent(), "Make this one with your name \u2192");
    const county = /href="(\/rain-print\?place=[^"]*year=2026[^"]*)"/.exec(read("rain/iowa/story-county.html"))[1].replace(/&amp;/g, "&");
    assert.equal(await a.getAttribute("href"), county, "the same place, year, station and spot as the county page");
    await pg.context().close();
  } finally { await browser.close(); srv.close(); }
});
