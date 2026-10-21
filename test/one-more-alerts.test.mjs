/* "One more?" after the alert signups, and the page's own extra after a
 * Daily signup (Sig, Oct 20):
 *   1. After a hail alert on /hail-map: the Daily, unticked, with an optional
 *      ZIP box filled from the ZIP nearest the spot (or blank); source
 *      onemore:hail-alert. Hidden for a browser already on the Daily.
 *   2. After an elevator ZIP alert on /cash-bids: the Daily, source
 *      onemore:elevator-watch; no second ZIP alert.
 *   3. After a Daily signup: the hail alert on hail pages, the futures price
 *      alert on futures and report pages, report-day emails only when the
 *      Daily was taken without them. Never a product with no sender.
 * The worker is mocked; nothing leaves the machine.
 *
 *   node --test test/one-more-alerts.test.mjs
 *   ONEMORE_SHOTS=<dir> node --test test/one-more-alerts.test.mjs   (also screenshots)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SA = read("components/signup-ask.js");
const DASH = /[–—]|&mdash;|&ndash;/;

test("every extra the panel offers has a sender; versions bumped where they load", () => {
  const block = SA.slice(SA.indexOf('/* ---------- "One more?"'), SA.indexOf("/* Signups drawn by other scripts."));
  const ids = [...block.matchAll(/\bO\.(\w+) = \{/g)].map((m) => m[1]).sort();
  assert.deepEqual(ids, ["cot", "daily", "hail", "price", "rainyear", "rent", "reports", "wasde", "zip"]);
  // cot and wasde (Oct 21): the two standing lists, each read by its sender
  assert.ok(/\btopic: 'cot', daily: false/.test(block) && read("scripts/send_cot_weekly.py").includes('TOPIC = "cot"'), "cot: send_cot_weekly.py reads it");
  assert.ok(/\btopic: 'reports', daily: false/.test(block) && read("scripts/send_report_day.py").includes('subscribers.fetch_topic(base, token, "reports")'), "wasde: send_report_day.py reads topic reports");
  assert.ok(read("workers/subs-worker.js").includes('const LIST_TOPICS = ["reports", "cot"];'), "the worker takes both");
  // hail: the nightly checker reads /alert-subscribe watches
  assert.ok(read("scripts/check_alerts.py").includes("/alert-subscribe"));
  assert.ok(/WORKER \+ '\/alert-subscribe'/.test(block));
  // price: the worker's and the sender's symbols are the four offered
  const sym = [...block.matchAll(/\['corn', 'beans', 'wheat', 'cattle'\]/g)].length;
  assert.equal(sym, 1);
  const w = read("workers/subs-worker.js");
  for (const s of ["corn", "beans", "wheat", "cattle"]) {
    assert.ok(new RegExp(`PWATCH_SYMBOLS = new Set\\(\\[[^\\]]*"${s}"`).test(w), s + " in the worker");
    assert.ok(new RegExp(`"${s}":\\s+"`).test(read("scripts/send_price_watch.py")), s + " in send_price_watch.py");
  }
  // paId is index.html's, byte for byte in what it computes
  const idx = read("index.html");
  const body = (src) => /function paId\(symbol,\s*direction,\s*targetCents\)\s*\{([\s\S]*?)\n\s*\}/.exec(src)[1].replace(/\s+/g, "");
  assert.equal(body(SA), body(idx), "paId same as index.html");
  // reports: send_report_day.py mails Daily readers whose reports flag is on
  assert.ok(read("scripts/send_report_day.py").includes("reports !== false"));
  assert.ok(!DASH.test(block) && !/type="checkbox"[^>]*checked/.test(block));
  assert.ok(read("components/loader.js").includes("s.src = '/components/signup-ask.js?v=12';"));
  assert.ok(read("components/loader.js").includes("var CV = '74';"));
  assert.ok(idx.includes('<script src="/components/signup-ask.js?v=12"></script>'));
  assert.ok(read("cash-bids.html").includes("/components/cb-alerts.js?v=4") && read("components/cb-myelev.js").includes("/components/cb-alerts.js?v=4"));
  assert.ok(read("hail-map.html").includes("S.oneMore(box,{gave:'hail'"));
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const SHOTS = process.env.ONEMORE_SHOTS || "";

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png" };
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
// Ames, Iowa: three real ZIP centers (the bids network's data/zips/50.json shape)
const ZIPS50 = { "50010": [42.0372, -93.5797], "50011": [42.0256, -93.6466], "50014": [42.0358, -93.6911] };
const AMES = { lat: 42.0347, lon: -93.62 };
const near = () => {
  const mi = (a, b, c, d) => { const R = 3958.8, p = Math.PI / 180, x = (c - a) * p, y = (d - b) * p;
    const s = Math.sin(x / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(y / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)); };
  return Object.entries(ZIPS50).sort((a, b) => mi(AMES.lat, AMES.lon, ...a[1]) - mi(AMES.lat, AMES.lon, ...b[1]))[0][0];
};

async function newPage(browser, port, posts, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: o.width || 390, height: o.height || 844 } });
  if (o.init) await ctx.addInitScript(o.init, o.arg);
  const pg = await ctx.newPage();
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    if (u.startsWith("https://dnilgis.github.io/bids/data/zips/")) {
      if (o.noZips) return r.abort();
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(/\/50\.json$/.test(u) ? ZIPS50 : {}) });
    }
    if (u.startsWith("https://agsist-subs.dnilgis.workers.dev/")) {
      const p = new URL(u).pathname;
      if (r.request().method() === "GET" && p === "/elevator-watch-options")
        return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ ok: true, kinds: ["cash", "move"] }) });
      if (r.request().method() === "POST") {
        posts.push({ path: p, body: JSON.parse(r.request().postData() || "{}") });
        return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ ok: true }) });
      }
    }
    return r.abort();
  });
  return pg;
}
const go = (pg, port, url) => pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
const events = (pg, name) => pg.evaluate((n) => Array.from(window.dataLayer || []).filter((x) => x && x[0] === "event" && x[1] === n).map((x) => x[2]), name);
const noEmailIn = async (pg) => {
  const dl = await pg.evaluate(() => JSON.stringify(Array.from(window.dataLayer || [], (x) => Array.from(x && x.length !== undefined ? x : [x]))));
  assert.ok(!dl.includes("@example"), "no address in dataLayer");
};
const keysOf = (more) => more.locator("[data-k]").evaluateAll((a) => a.map((x) => x.getAttribute("data-k")));
const HAIL_URL = `/hail-map.html?lat=${AMES.lat}&lon=${AMES.lon}&mi=10`;

async function hailSignup(pg, port) {
  await go(pg, port, HAIL_URL);
  await pg.waitForFunction(() => window.AGSIST_HAIL_SPOT && document.querySelectorAll("#hm-point-stats .hm-point-stat").length > 0 && !/checking/.test(document.getElementById("hm-point-stats").textContent), null, { timeout: 30000 });
  await pg.waitForTimeout(300);
  await pg.fill("#hm-alert-email", EMAIL);
  await pg.click("#hm-alert-btn");
  await pg.waitForFunction(() => /Watching this spot/.test(document.getElementById("hm-alert-status").textContent));
}

test("hail map, 390 px: after the hail alert, One more? offers the Daily with the ZIP nearest the spot, unticked", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port, posts = [];
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      posts.length = 0;
      const pg = await newPage(browser, port, posts, { width, height: width === 390 ? 844 : 900 });
      await hailSignup(pg, port);
      const a = posts.find((x) => x.path === "/alert-subscribe");
      assert.ok(a && a.body.lat === AMES.lat.toFixed(4), "the hail alert went first");
      const more = pg.locator("#hm-alerts [data-sa-more]");
      await more.locator(".sa-mh").waitFor();
      assert.ok(await pg.evaluate(() => document.getElementById("hm-alert-status").nextElementSibling.hasAttribute("data-sa-more") || !!document.querySelector("#hm-alerts > [data-sa-more]")));
      const keys = await keysOf(more);
      assert.equal(keys[0], "daily", "the Daily first: " + keys);
      assert.ok(!keys.includes("hail"), "no second hail alert");
      for (const c of await more.locator('input[type="checkbox"]').all()) assert.equal(await c.isChecked(), false, "unticked");
      const zbox = more.locator('[data-k="daily"] .sa-mz');
      assert.equal(await zbox.inputValue(), near(), "the ZIP nearest the spot");
      assert.match(await more.locator('[data-k="daily"]').textContent(), /ZIP, optional/);
      const noScroll = await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      assert.ok(noScroll, width + ": no sideways scroll");
      const box = await more.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width, width + ": the panel fits");
      if (SHOTS) {
        await more.scrollIntoViewIfNeeded();
        const hb = await pg.locator("#hm-alerts").boundingBox();
        await pg.screenshot({ path: path.join(SHOTS, `hail-onemore-${width}.png`), clip: { x: 0, y: Math.max(0, hb.y - 20), width, height: Math.min(900, hb.height + 40) } });
      }
      assert.deepEqual(await events(pg, "onemore_shown"), [{ from: "hail", topics: keys.join(",") }]);
      await more.locator('[data-k="daily"] input[type="checkbox"]').check();
      await more.locator(".sa-b").click();
      await more.locator(".sa-ok").waitFor();
      const s = posts.filter((x) => x.path === "/subscribe");
      assert.equal(s.length, 1);
      assert.deepEqual(s[0].body, { email: EMAIL, source: "onemore:hail-alert", reports: true, zip: near() });
      if (SHOTS && width === 390) {
        const hb = await pg.locator("#hm-alerts").boundingBox();
        await pg.screenshot({ path: path.join(SHOTS, "hail-onemore-added-390.png"), clip: { x: 0, y: Math.max(0, hb.y - 20), width, height: Math.min(900, hb.height + 40) } });
      }
      await noEmailIn(pg);
      await pg.context().close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("hail map: no ZIP lookup, the ZIP box stays blank and optional; a bad ZIP is caught; a Daily reader sees no Daily row", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port, posts = [];
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    let pg = await newPage(browser, port, posts, { noZips: true });
    await hailSignup(pg, port);
    const more = pg.locator("#hm-alerts [data-sa-more]");
    await more.locator(".sa-mh").waitFor();
    const z = more.locator('[data-k="daily"] .sa-mz');
    assert.equal(await z.inputValue(), "");
    await z.fill("5001");
    assert.equal(await more.locator('[data-k="daily"] input[type="checkbox"]').isChecked(), true, "typing a ZIP ticks the Daily");
    await more.locator(".sa-b").click();
    assert.equal(await more.locator(".sa-m").textContent(), "A ZIP is 5 digits. Fix it, or leave it blank.");
    await z.fill("");
    await more.locator(".sa-b").click();
    await more.locator(".sa-ok").waitFor();
    assert.deepEqual(posts.filter((x) => x.path === "/subscribe")[0].body, { email: EMAIL, source: "onemore:hail-alert", reports: true });
    await pg.context().close();
    // already on the Daily in this browser: nothing else fits on the hail map, so no panel
    pg = await newPage(browser, port, [], { init: () => { localStorage.setItem("agsist_subscribed", "1"); localStorage.setItem("agsist_subscribed_at", String(Date.now())); } });
    await hailSignup(pg, port);
    await pg.waitForTimeout(800);
    assert.equal(await pg.locator("#hm-alerts [data-sa-more] [data-k=daily]").count(), 0, "no Daily row for a Daily reader");
    await pg.context().close();
  } finally { await browser.close(); srv.close(); }
});

test("hail map: a Daily signup offers the hail alert for the spot on the map", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port, posts = [];
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await newPage(browser, port, posts);
    await go(pg, port, HAIL_URL);
    await pg.waitForFunction(() => !!window.AGSIST_HAIL_SPOT, null, { timeout: 30000 });
    const ask = pg.locator('main [data-source="page:hail-map"]');
    await ask.locator(".sa-in").fill(EMAIL);
    await ask.locator(".sa-b").click();
    const more = ask.locator("[data-sa-more]");
    await more.locator(".sa-mh").waitFor();
    const keys = await keysOf(more);
    assert.equal(keys[0], "hail", "the hail alert first: " + keys);
    assert.match(await more.locator('[data-k="hail"]').textContent(), /Hail alerts: an email the morning after radar-estimated hail touches within 10 mi of your spot on the map/);
    assert.ok(!keys.includes("price") && !keys.includes("reports"));
    await more.locator('[data-k="hail"] input').check();
    await more.locator(".sa-b").click();
    await more.locator(".sa-ok").waitFor();
    const h = posts.filter((x) => x.path === "/alert-subscribe");
    assert.equal(h.length, 1);
    assert.deepEqual(h[0].body, { email: EMAIL, lat: AMES.lat.toFixed(4), lon: AMES.lon.toFixed(4), place: "your spot on the map", radius_mi: 10 });
    await noEmailIn(pg);
  } finally { await browser.close(); srv.close(); }
});

test("futures and report pages: the futures alert after a Daily signup; report days only when the Daily came without them", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port, posts = [];
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    // Oct 21: the futures pages' own ask is Funds this week, so the Daily signup comes from the panel's caller
    let pg = await newPage(browser, port, posts);
    await go(pg, port, "/soybean-futures-prices.html");
    await pg.waitForFunction(() => window.AgsistSignup && window.AgsistSignup.oneMore);
    await pg.evaluate((e) => { const h = document.createElement("div"); h.id = "host"; document.querySelector("main").prepend(h); window.AgsistSignup.oneMore(h, { gave: "daily", email: e }); }, EMAIL);
    const more = pg.locator("#host [data-sa-more]");
    await more.locator(".sa-mh").waitFor();
    const keys = await keysOf(more);
    assert.equal(keys[0], "price", "the futures alert first: " + keys);
    assert.equal(keys[1], "cot", "then Funds this week: " + keys);
    assert.ok(!keys.includes("reports") && !keys.includes("wasde"), "the Daily signup already carries report days");
    assert.equal(await more.locator('[data-k="price"] [data-f="sym"]').inputValue(), "beans", "this page's crop");
    for (const c of await more.locator('input[type="checkbox"]').all()) assert.equal(await c.isChecked(), false);
    await more.locator('[data-k="price"] [data-f="usd"]').fill("11.5");
    assert.equal(await more.locator('[data-k="price"] input[type="checkbox"]').isChecked(), true, "typing a price ticks it");
    await more.locator('[data-k="price"] [data-f="dir"]').selectOption("below");
    await more.locator(".sa-b").click();
    await more.locator(".sa-ok").waitFor();
    const p = posts.filter((x) => x.path === "/price-watch-subscribe");
    assert.equal(p.length, 1);
    const pid = await pg.evaluate(() => { const s = "BEANS|BELOW|1150"; let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return ("00000000" + (h >>> 0).toString(16)).slice(-8); });
    assert.deepEqual(p[0].body, { email: EMAIL, pid, symbol: "beans", direction: "below", target_cents: 1150, label: "Soybeans below $11.50" });
    assert.match(await more.locator(".sa-ok").textContent(), /Check your email to confirm the futures alert/);
    await pg.context().close();

    // the menu's Daily ask sends reports:false; on a report page One more? then offers report days
    posts.length = 0;
    pg = await newPage(browser, port, posts, { width: 1280, height: 900 });
    await go(pg, port, "/usda-calendar.html");
    await pg.waitForFunction(() => window.AgsistSignup && window.AgsistSignup.oneMore);
    await pg.evaluate((e) => { const h = document.createElement("div"); h.id = "host"; document.querySelector("main").prepend(h); window.AgsistSignup.oneMore(h, { gave: "daily", reports: false, email: e }); }, EMAIL);
    const m2 = pg.locator("#host [data-sa-more]");
    await m2.locator(".sa-mh").waitFor();
    const k2 = await keysOf(m2);
    assert.deepEqual(k2.slice(0, 2), ["reports", "price"], "report days first on a report page: " + k2);
    await m2.locator('[data-k="reports"] input').check();
    await m2.locator(".sa-b").click();
    await m2.locator(".sa-ok").waitFor();
    assert.deepEqual(posts.filter((x) => x.path === "/subscribe").map((x) => x.body), [{ email: EMAIL, reports: true }], "no source: the worker keeps where they signed up");
    await pg.context().close();

    // a page that is neither: no futures alert, no report days
    pg = await newPage(browser, port, []);
    await go(pg, port, "/grain-emc.html");
    await pg.waitForFunction(() => window.AgsistSignup && window.AgsistSignup.oneMore);
    await pg.evaluate((e) => { const h = document.createElement("div"); h.id = "host"; document.body.prepend(h); localStorage.setItem("agsist_user_zip", "50010"); window.AgsistSignup.oneMore(h, { gave: "daily", reports: false, email: e }); }, EMAIL);
    await pg.locator("#host [data-sa-more] .sa-mh").waitFor();
    const k3 = await keysOf(pg.locator("#host [data-sa-more]"));
    assert.ok(!k3.includes("price") && !k3.includes("reports") && !k3.includes("hail"), String(k3));
    await pg.context().close();
  } finally { await browser.close(); srv.close(); }
});

test("cash bids ZIP alert: One more? offers the Daily, source onemore:elevator-watch, no second ZIP alert", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port, posts = [];
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await newPage(browser, port, posts);
    await go(pg, port, "/cash-bids.html");
    await pg.waitForFunction(() => window.CBAlerts && document.getElementById("cb-results"));
    await pg.evaluate(() => window.CBAlerts.zipPanel("50010", 25));
    const zp = pg.locator("#cba-zip");
    await zp.locator("summary").click();
    await zp.locator(".cba-price").fill("4.10");
    await zp.locator(".cba-email").fill(EMAIL);
    await pg.waitForFunction(() => !/Checking the boards/.test(document.querySelector("#cba-zip .cba-now").textContent));
    await zp.locator(".cba-go").click();
    const more = zp.locator("[data-sa-more]");
    await more.locator(".sa-mh").waitFor();
    const keys = await keysOf(more);
    assert.equal(keys[0], "daily");
    assert.ok(!keys.includes("zip"), "they just set a ZIP alert: " + keys);
    await more.locator('[data-k="daily"] input').check();
    await more.locator(".sa-b").click();
    await more.locator(".sa-ok").waitFor();
    const s = posts.filter((x) => x.path === "/subscribe");
    assert.deepEqual(s.map((x) => x.body), [{ email: EMAIL, source: "onemore:elevator-watch", reports: true, zip: "50010" }]);
    await noEmailIn(pg);
  } finally { await browser.close(); srv.close(); }
});
