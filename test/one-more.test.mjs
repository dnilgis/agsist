/* Email asks, Oct 20 (Sig, monetization board): from the real pages.
 *   1. "One more?" after any signup that went through: up to three more
 *      emails that fit, each an unticked box, one "Add these" button, only
 *      topics with a sender; GA4 onemore_shown / onemore_added, no address.
 *   2. The second-visit bar also on a first visit, after the reader used the
 *      page (phone: half the page or 40 s; desktop: 40 s); once a session.
 *   3. One Daily ask a page: a page with its own ask gets no bar. The PRF
 *      grid notice does not count (Sig, Oct 20: PRF pages keep the bar).
 *   4. A Daily ask on /hail-map and /gdu-calculator.
 *   5. The signed-up flag lasts 365 days; a rent notice is remembered per
 *      release year, and the worker takes a rent ask again once it was sent.
 *   7. ask_shown and ask_dismissed with the ask id.
 * The browser parts need Playwright and Chromium and skip where they are missing.
 *
 *   node --test test/one-more.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const DASH = /[–—]|&mdash;|&ndash;/;
const SA = read("components/signup-ask.js");
const fnSrc = (src, name) => {
  const i = src.indexOf("  function " + name + "(");
  assert.ok(i >= 0, name + " found");
  const line = src.slice(i, src.indexOf("\n", i) + 1);
  if (/\}\s*$/.test(line)) return line;   // a one-line function
  return src.slice(i, src.indexOf("\n  }\n", i) + 4);
};

test("the copies agree: ZIP prefix table, ZIP alert body, rent states, rain states", () => {
  const z3 = (s) => /var Z3 = '([^']+)'/.exec(s)[1];
  assert.equal(z3(SA), z3(read("components/price-local.js")), "Z3 same as price-local.js");
  assert.equal(z3(SA), z3(read("components/cb-vs-state.js")), "Z3 same as cb-vs-state.js");
  const cbs = read("components/cb-signup.js");
  for (const f of ["widFor", "money", "alertBody"]) assert.equal(fnSrc(SA, f), fnSrc(cbs, f), f + " byte for byte cb-signup.js");
  assert.ok(/var MILES = 25;/.test(SA) && /var MILES = 25;/.test(cbs));
  const rent = /var RENT_ST = '([^']+)'/.exec(SA)[1].split(" ");
  const files = fs.readdirSync(path.join(ROOT, "data/cash-rent")).filter((f) => /^[A-Z]{2}\.json$/.test(f)).map((f) => f.slice(0, 2)).sort();
  assert.deepEqual([...rent].sort(), files, "RENT_ST is data/cash-rent/<ST>.json");
  const names = {};
  /\('AL Alabama[^']+'\)/.exec(SA)[0].slice(2, -2).split("|").forEach((s) => { names[s.slice(0, 2)] = s.slice(3); });
  for (const st of rent) assert.ok(fs.existsSync(path.join(ROOT, "rent", names[st].toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".html")), st + " has a /rent page");
  const w = read("workers/subs-worker.js");
  const ws = /const RAIN_ST_FIPS = new Set\(\[([\d,\s]+)\]\)/.exec(w)[1].split(",").map((x) => +x.trim()).sort((a, b) => a - b);
  const cs = /var RAIN_FIPS = '([^']+)'/.exec(SA)[1].split(" ").map(Number);
  assert.deepEqual(cs, ws, "RAIN_FIPS is the worker's RAIN_ST_FIPS");
  const wr = /const RENT_STATES = new Set\(\("([a-z ]+)"\)/.exec(w)[1].split(" ");
  for (const st of rent) assert.ok(wr.includes(st.toLowerCase()), st + " is a worker rent state");
});

test("every topic the panel offers has a sender that reads it", () => {
  assert.ok(read("scripts/send_rent_notice.py").includes('TOPIC_RE = re.compile(r"rent:([a-z]{2})")'));
  assert.ok(read("scripts/send_rain_year.py").includes('TOPIC_RE = re.compile(r"rainyear:(\\d{4}):(\\d{5})")'));
  assert.ok(fs.existsSync(path.join(ROOT, "scripts/send_zip_alert.py")) && fs.existsSync(path.join(ROOT, "scripts/send_daily.py")));
  const block = SA.slice(SA.indexOf('/* ---------- "One more?"'), SA.indexOf("/* Signups drawn by other scripts."));
  const ids = [...block.matchAll(/\bO\.(\w+) = \{/g)].map((m) => m[1]).sort();
  // Oct 20: hail, price and reports added (test/one-more-alerts.test.mjs checks their senders)
  // Oct 21: cot and wasde, the two standing lists (test/one-more-alerts.test.mjs checks their senders)
  assert.deepEqual(ids, ["cot", "daily", "hail", "price", "rainyear", "rent", "reports", "wasde", "zip"], "only these");
  assert.ok(!DASH.test(block), "no dashes in the panel");
  assert.ok(!/type="checkbox"[^>]*checked/.test(block), "no box starts ticked");
  assert.ok(!/navigator\.geolocation/.test(SA), "never geolocation");
});

test("hail-map and gdu-calculator: one Daily ask each, honest about what the Daily carries", () => {
  for (const [p, src, faq] of [["hail-map.html", "page:hail-map", '<section class="hm-faq"'], ["gdu-calculator.html", "page:gdu-calculator", "<!--FAQ:START-->"]]) {
    const h = read(p);
    const asks = h.match(/<div data-signup-ask[^>]*><\/div>/g) || [];
    assert.equal(asks.length, 1, p);
    assert.ok(asks[0].includes(`data-source="${src}"`), p);
    assert.ok(!asks[0].includes("data-topic"), p + ": the Daily");
    assert.match(asks[0], /data-note="AGSIST Daily, free\. It carries no (hail reports|GDU counts)/, p + ": says what it does not carry");
    assert.ok(!DASH.test(asks[0]), p);
    assert.ok(h.indexOf("data-signup-ask") < h.indexOf(faq), p + ": before the FAQ");
    assert.ok(h.indexOf('<main') < h.indexOf("data-signup-ask"), p + ": in the page body");
  }
});

test("versions: signup-ask.js v12 where it loads (Oct 21), home.js v15", () => {
  assert.ok(read("components/loader.js").includes("s.src = '/components/signup-ask.js?v=15';"));
  const idx = read("index.html");
  assert.ok(idx.includes('<script src="/components/signup-ask.js?v=15"></script>'));
  assert.ok(idx.includes('<script src="/components/home.js?v=16"></script>'));
  assert.ok(read("privacy.html").includes("for one year, so the signup prompts stop until then."));
});

test("worker: a rent notice asked again after it was sent starts over; the sender's rows read the same", async () => {
  const tmp = path.join(os.tmpdir(), "subs-worker-one-more-" + process.pid + ".mjs");
  fs.copyFileSync(path.join(ROOT, "workers/subs-worker.js"), tmp);
  const w = (await import(pathToFileURL(tmp).href)).default;
  fs.unlinkSync(tmp);
  const store = new Map();
  const env = { UNSUB_SECRET: "sec", LIST_TOKEN: "tok", SUBS: {
    async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; } } };
  const post = (b) => w.fetch(new Request("https://x.dev/notice", { method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://agsist.com" }, body: JSON.stringify(b) }), env);
  const rec = () => JSON.parse(store.get("note:a@example.com")).t;
  assert.equal((await post({ email: "a@example.com", topic: "rent:ia", source: "page:rent/iowa" })).status, 200);
  const first = rec()["rent:ia"];
  // asked again before it was sent: nothing changes
  await post({ email: "a@example.com", topic: "rent:ia", source: "page:rent/iowa" });
  assert.deepEqual(rec()["rent:ia"], first);
  // the sender marks it sent; another topic is also sent
  const r = JSON.parse(store.get("note:a@example.com"));
  r.t["rent:ia"].sent = 1; r.t["rent:ia"].ts = 1000;
  r.t["rain-gauge"] = { ts: 5, src: "x", sent: 2 };
  store.set("note:a@example.com", JSON.stringify(r));
  await post({ email: "a@example.com", topic: "rent:ia", source: "onemore:daily" });
  const again = rec()["rent:ia"];
  assert.ok(!again.sent && again.ts > 1000 && again.src === "onemore:daily", "starts over");
  await post({ email: "a@example.com", topic: "rain-gauge", source: "y" });
  assert.equal(rec()["rain-gauge"].sent, 2, "a non-rent topic keeps its sent mark");
  const lr = await w.fetch(new Request("https://x.dev/notice-list?token=tok&topic=rent:&unsent=1"), env);
  const rows = await lr.json();
  const list = Array.isArray(rows) ? rows : rows.rows || rows.list || [];
  assert.ok(list.some((x) => x.topic === "rent:ia" && !x.sent), "listed unsent for send_rent_notice.py");
  assert.ok(read("workers/subs-worker.js").includes(" * v5.32 (2026-10-20): RENT NOTICE, EVERY YEAR."));
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
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: o.width || 390, height: o.height || 844 } });
  if (o.init) await ctx.addInitScript(o.init, o.arg);
  const pg = await ctx.newPage();
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    if (u.startsWith("https://agsist-api.dnilgis.workers.dev/") && r.request().method() === "POST") {
      const p = new URL(u).pathname;
      posts.push({ path: p, body: JSON.parse(r.request().postData() || "{}") });
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ ok: true }) });
    }
    return r.abort();
  });
  return pg;
}
const go = (pg, port, url) => pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
const events = (pg, name) => pg.evaluate((n) => Array.from(window.dataLayer || []).filter((x) => x && x[0] === "event" && x[1] === n).map((x) => x[2]), name);
const noEmailIn = async (pg) => {
  const dl = await pg.evaluate(() => JSON.stringify(Array.from(window.dataLayer || [], (x) => Array.from(x && x.length !== undefined ? x : [x]))));
  assert.ok(!dl.includes(EMAIL) && !dl.includes("@example"), "no address in dataLayer");
};
const boxes = (more) => more.locator('input[type="checkbox"]');
const SHOTS = process.env.ONEMORE_SHOTS || "";

test("rent page: after the rent notice, One more? offers the Daily and a ZIP alert, unticked; rent is remembered for its year", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port, posts = [];
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await newPage(browser, port, posts, { init: () => { localStorage.setItem("agsist_user_zip", "50010"); } });
    await go(pg, port, "/rent/iowa.html");
    const ask = pg.locator('main [data-topic="rent:ia"]');
    await ask.locator(".sa-in").waitFor();
    await ask.locator(".sa-in").fill(EMAIL);
    await ask.locator(".sa-b").click();
    const more = ask.locator("[data-sa-more]");
    await more.locator(".sa-mh").waitFor();
    assert.equal(await more.locator(".sa-mh").textContent(), "One more?");
    const keys = await more.locator("[data-k]").evaluateAll((a) => a.map((x) => x.getAttribute("data-k")));
    assert.deepEqual(keys, ["daily", "zip"], "the Daily first after a notice, then the ZIP alert; no second rent ask");
    for (const c of await boxes(more).all()) assert.equal(await c.isChecked(), false, "unticked");
    assert.equal(await more.locator(".sa-b").textContent(), "Add these");
    const shown = await events(pg, "onemore_shown");
    assert.deepEqual(shown, [{ from: "notice", topics: "daily,zip" }]);
    const notes = await pg.evaluate(() => JSON.parse(localStorage.getItem("agsist_notices")));
    assert.ok(notes["rent:ia:2027"], "remembered as the 2027 release: " + JSON.stringify(notes));
    // nothing ticked: says so, sends nothing
    await more.locator(".sa-b").click();
    assert.equal(await more.locator(".sa-m").textContent(), "Tick what you want, or leave it.");
    await more.locator('[data-k="daily"] input').check();
    await more.locator(".sa-b").click();
    await more.locator(".sa-ok").waitFor();
    const subs = posts.filter((x) => x.path === "/subscribe");
    assert.equal(subs.length, 1);
    assert.deepEqual(subs[0].body, { email: EMAIL, source: "onemore:notice", reports: true, zip: "50010" });
    assert.deepEqual(await events(pg, "onemore_added"), [{ from: "notice", topics: "daily" }]);
    const ids = (await events(pg, "notice_signup")).map((e) => e.ask_id);
    assert.deepEqual(ids, ["page:rent/iowa|rent"]);
    await noEmailIn(pg);
    if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, "rent-onemore-390.png"), fullPage: false });
    await pg.context().close();
    // a 2027 ask in an older (pre-year) memory still counts; a 2026 one does not
    const pg2 = await newPage(browser, port, [], { init: () => { localStorage.setItem("agsist_notices", JSON.stringify({ "rent:ia": Date.parse("2026-10-11T12:00:00Z") })); } });
    await go(pg2, port, "/rent/iowa.html");
    await pg2.waitForFunction(() => document.querySelector('main [data-topic="rent:ia"]').getAttribute("data-sa-ready"));
    assert.equal(await pg2.locator('main [data-topic="rent:ia"]').isHidden(), true, "asked Oct 2026: that is the 2027 release");
    await pg2.context().close();
    const pg3 = await newPage(browser, port, [], { init: () => { localStorage.setItem("agsist_notices", JSON.stringify({ "rent:ia": Date.parse("2025-10-11T12:00:00Z"), "rent:ia:2026": 1 })); } });
    await go(pg3, port, "/rent/iowa.html");
    await pg3.locator('main [data-topic="rent:ia"] .sa-in').waitFor();
    await pg3.context().close();
  } finally { await browser.close(); srv.close(); }
});

test("Atlas county watch: One more? offers the county's rain year, the state's rents and the Daily", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port, posts = [];
  const browser = await chromium.launch({ executablePath: CHROME });
  const year = JSON.parse(read("data/rain/ia.json")).year;
  try {
    const pg = await newPage(browser, port, posts, { width: 1280, height: 900 });
    await go(pg, port, "/farmland-atlas/iowa/story-county.html");
    const f = pg.locator('form.watch[data-fips="19169"]');
    await f.locator('input[name="email"]').fill(EMAIL);
    await f.locator("button").click();
    const more = pg.locator("[data-sa-more]");
    await more.locator(".sa-mh").waitFor();
    assert.ok(await pg.evaluate(() => document.querySelector("form.watch").nextElementSibling.hasAttribute("data-sa-more")), "right under the watch form");
    const keys = await more.locator("[data-k]").evaluateAll((a) => a.map((x) => x.getAttribute("data-k")));
    const cy = new Date().getUTCFullYear();
    if (year === cy) {
      assert.deepEqual(keys, ["daily", "rainyear", "rent"]);
      assert.match(await more.locator('[data-k="rainyear"]').textContent(), new RegExp(`Story County’s full ${cy} rain total, one email in January`));
    } else assert.deepEqual(keys, ["daily", "rent"]);
    for (const c of await boxes(more).all()) assert.equal(await c.isChecked(), false);
    await more.locator('[data-k="rent"] input').check();
    if (keys.includes("rainyear")) await more.locator('[data-k="rainyear"] input').check();
    await more.locator(".sa-b").click();
    await more.locator(".sa-ok").waitFor();
    const n = posts.filter((x) => x.path === "/notice").map((x) => x.body.topic).sort();
    assert.deepEqual(n, keys.includes("rainyear") ? [`rainyear:${cy}:19169`, "rent:ia"] : ["rent:ia"]);
    for (const p of posts.filter((x) => x.path === "/notice")) { assert.equal(p.body.daily, false); assert.equal(p.body.source, "onemore:county"); }
    if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, "atlas-onemore-1280.png"), clip: await more.boundingBox().then((b) => ({ x: 0, y: Math.max(0, b.y - 200), width: 1280, height: 420 })) });
    await noEmailIn(pg);
  } finally { await browser.close(); srv.close(); }
});

test("town cash bid box: after the Daily, One more? offers a ZIP alert for the town's ZIP and Iowa rents", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port, posts = [];
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await newPage(browser, port, posts);
    // A live Iowa town page, read from the repo: town pages come and go with the
    // elevator network (Afton turned into a pointer page on Oct 20), so the test
    // takes the first one that still has the box, with corn first.
    const town = fs.readdirSync(path.join(ROOT, "cash-bids/iowa")).filter((f) => f.endsWith(".html")).sort().map((f) => {
      const h = read("cash-bids/iowa/" + f);
      const m = !h.includes('name="agsist-pointer"') && /data-bid-alerts data-place="[^"]+" data-zip="(\d{5})"[^>]* data-crops="corn\b/.exec(h);
      return m ? { f, zip: m[1] } : null;
    }).find(Boolean);
    assert.ok(town, "an Iowa town page with the alert box");
    await go(pg, port, "/cash-bids/iowa/" + town.f);
    const box = pg.locator("[data-bid-alerts]");
    await box.locator(".cbs-em").waitFor();
    await box.locator(".cbs-em").fill(EMAIL);
    await box.locator(".cbs-go").click();
    const more = box.locator("[data-sa-more]");
    await more.locator(".sa-mh").waitFor();
    const keys = await more.locator("[data-k]").evaluateAll((a) => a.map((x) => x.getAttribute("data-k")));
    assert.deepEqual(keys, ["zip", "rent"]);
    assert.match(await more.locator('[data-k="zip"]').textContent(), new RegExp("within 25 mi of ZIP " + town.zip + " pays \\$"));
    await more.locator(".sa-mp").fill("4.25");
    assert.equal(await more.locator('[data-k="zip"] input[type="checkbox"]').isChecked(), true, "typing a price ticks it");
    await more.locator(".sa-b").click();
    await more.locator(".sa-ok").waitFor();
    const a = posts.filter((x) => x.path === "/elevator-watch-subscribe");
    assert.equal(a.length, 1);
    assert.equal(a[0].body.ewid, "ab" + town.zip + "025");
    assert.equal(a[0].body.target_cents, 425);
    assert.equal(a[0].body.crop, "corn");
    assert.match(await more.locator(".sa-ok").textContent(), /Check your email to confirm the price alert/);
    if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, "town-onemore-390.png"), clip: await box.boundingBox().then((b) => ({ x: 0, y: b.y, width: 390, height: Math.min(700, b.height) })) });
    await noEmailIn(pg);
  } finally { await browser.close(); srv.close(); }
});

test("PRF county page: the grid notice then One more? with the Daily; the bar still shows there", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port, posts = [];
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await newPage(browser, port, posts, { width: 1280, height: 900, init: () => { localStorage.setItem("agsist_visits", "3"); } });
    await go(pg, port, "/prf/iowa/adair-county.html");
    await pg.locator("#sa-bar").waitFor({ state: "attached" });
    const ask = pg.locator("[data-prf-notice] [data-signup-ask]");
    await ask.locator(".sa-in").waitFor();
    await ask.locator(".sa-in").fill(EMAIL);
    await ask.locator(".sa-b").click();
    const more = ask.locator("[data-sa-more]");
    await more.locator(".sa-mh").waitFor();
    const keys = await more.locator("[data-k]").evaluateAll((a) => a.map((x) => x.getAttribute("data-k")));
    assert.equal(keys[0], "daily");
    assert.ok(keys.includes("rent"), "Iowa rents: " + keys);
    for (const c of await boxes(more).all()) assert.equal(await c.isChecked(), false);
    assert.equal(await more.locator("input:not([type=checkbox]):not([type=number]), select:not(.sa-mc), textarea").count(), 0, "no phone, no farm details");
  } finally { await browser.close(); srv.close(); }
});

test("the bar: first visit after 40 s on a desktop, half the page on a phone; once a session; not where the page asks itself", { skip, timeout: 150000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    // desktop, first visit: nothing at once, the bar after 40 s
    let pg = await newPage(browser, port, [], { width: 1280, height: 900 });
    await pg.clock.install();
    await go(pg, port, "/grain-emc.html");
    await pg.clock.runFor(20000);
    assert.equal(await pg.locator("#sa-bar").count(), 0, "not at 20 s");
    await pg.clock.runFor(21000);
    await pg.locator("#sa-bar:not(.is-off)").waitFor();
    if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, "bar-first-visit-1280.png") });
    // the clock is faked, and a fake clock holds back the half-on-screen observer: let real time run, then wait for it
    await pg.clock.resume();
    await pg.waitForFunction(() => Array.from(window.dataLayer || []).some((x) => x && x[0] === "event" && x[1] === "ask_shown" && x[2] && x[2].ask_id === "bar"), null, { timeout: 5000 }).catch(() => {});
    assert.deepEqual((await events(pg, "ask_shown")).map((e) => e.ask_id).filter((x) => x === "bar"), ["bar"]);
    // once a session: the next page in the same session gets none
    await go(pg, port, "/fertilizer.html");
    await pg.clock.runFor(45000);
    assert.equal(await pg.locator("#sa-bar").count(), 0, "once a session");
    await pg.context().close();

    // phone, first visit: half the page down
    pg = await newPage(browser, port, [], { width: 390, height: 844 });
    await go(pg, port, "/grain-emc.html");
    await pg.waitForTimeout(400);
    assert.equal(await pg.locator("#sa-bar").count(), 0);
    await pg.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.55));
    await pg.locator("#sa-bar:not(.is-off)").waitFor();
    if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, "bar-first-visit-390.png") });
    await pg.locator("#sa-bar .sa-x").click();
    assert.deepEqual(await events(pg, "ask_dismissed"), [{ ask_id: "bar", how: "close" }]);
    await pg.context().close();

    // a later visit, pages that ask for themselves: no bar
    for (const p of ["/cattle-futures-prices.html", "/rent/iowa.html", "/rain/iowa/story-county.html", "/cash-bids/iowa/afton.html", "/hail-map.html", "/gdu-calculator.html"]) {
      pg = await newPage(browser, port, [], { width: 1280, height: 900, init: () => { localStorage.setItem("agsist_visits", "3"); } });
      await go(pg, port, p);
      await pg.waitForTimeout(600);
      assert.equal(await pg.locator("#sa-bar").count(), 0, p + ": its own ask, no bar");
      await pg.context().close();
    }
    // a later visit to a page with no ask: the bar as before
    pg = await newPage(browser, port, [], { width: 1280, height: 900, init: () => { localStorage.setItem("agsist_visits", "3"); } });
    await go(pg, port, "/grain-emc.html");
    await pg.locator("#sa-bar:not(.is-off)").waitFor();
    await pg.context().close();
  } finally { await browser.close(); srv.close(); }
});

test("signed-up flag: a year, then the asks come back; an undated flag starts its year", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const cases = [
    [366, false, "past a year: asks again, flag cleared"],
    [10, true, "ten days: still hidden"],
    [null, true, "undated: hidden, dated now"],
  ];
  try {
    for (const [days, hidden, why] of cases) {
      const pg = await newPage(browser, port, [], { width: 1280, height: 900, arg: days, init: (d) => {
        document.cookie = "agsist_subscribed=1;path=/";
        localStorage.setItem("agsist_subscribed", "1");
        if (d != null) localStorage.setItem("agsist_subscribed_at", String(Date.now() - d * 864e5));
      } });
      // Oct 21: cattle futures asks for Funds this week now; /markets keeps a Daily ask
      await go(pg, port, "/markets.html");
      const ask = pg.locator('main [data-source="page:markets"]');
      await pg.waitForFunction(() => document.querySelector('main [data-source="page:markets"]').getAttribute("data-sa-ready"));
      assert.equal(await ask.isHidden(), hidden, why);
      const st = await pg.evaluate(() => ({ ls: localStorage.getItem("agsist_subscribed"), at: localStorage.getItem("agsist_subscribed_at"), ck: document.cookie.includes("agsist_subscribed=1") }));
      if (!hidden) assert.deepEqual(st, { ls: null, at: null, ck: false }, why);
      else assert.ok(st.at && Date.now() - +st.at < 11 * 864e5, why);
      await pg.context().close();
    }
    // a new signup: the cookie for 365 days and the date
    const posts = [];
    const pg = await newPage(browser, port, posts, { width: 1280, height: 900 });
    await go(pg, port, "/gdu-calculator.html");
    const ask = pg.locator('main [data-source="page:gdu-calculator"]');
    await ask.locator(".sa-in").fill(EMAIL);
    await ask.locator(".sa-b").click();
    await ask.locator(".sa-ok").waitFor();
    const ck = (await pg.context().cookies()).find((c) => c.name === "agsist_subscribed");
    const daysLeft = (ck.expires * 1000 - Date.now()) / 864e5;
    assert.ok(daysLeft > 364 && daysLeft < 366, "cookie for a year: " + daysLeft);
    assert.equal(posts[0].body.source, "page:gdu-calculator");
    assert.deepEqual((await events(pg, "email_signup"))[0], { source: "page:gdu-calculator", ask_id: "page:gdu-calculator" });
    await pg.context().close();
  } finally { await browser.close(); srv.close(); }
});

test("ask_shown fires once an ask is on screen, with its id; hail-map's ask posts its source", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port, posts = [];
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await newPage(browser, port, posts, { width: 1280, height: 900 });
    await go(pg, port, "/hail-map.html");
    const ask = pg.locator('main [data-source="page:hail-map"]');
    await ask.locator(".sa-in").waitFor({ state: "attached" });
    assert.ok(!(await events(pg, "ask_shown")).some((e) => e.ask_id === "page:hail-map"), "not before it is on screen");
    await ask.scrollIntoViewIfNeeded();
    await pg.waitForFunction(() => Array.from(window.dataLayer).some((x) => x[0] === "event" && x[1] === "ask_shown" && x[2].ask_id === "page:hail-map"));
    if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, "hail-ask-1280.png"), clip: await ask.boundingBox().then((b) => ({ x: 0, y: Math.max(0, b.y - 80), width: 1280, height: b.height + 160 })) });
    await ask.locator(".sa-in").fill(EMAIL);
    await ask.locator(".sa-b").click();
    await ask.locator(".sa-ok").waitFor();
    assert.equal(posts.filter((x) => x.path === "/subscribe")[0].body.source, "page:hail-map");
    await noEmailIn(pg);
  } finally { await browser.close(); srv.close(); }
});
