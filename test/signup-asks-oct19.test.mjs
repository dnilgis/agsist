/* Signup asks, Oct 19 audit (signups.md, adversary pass). From the real pages:
 *   - cattle-futures-prices: its hand-made form (errors swallowed, no source,
 *     no ZIP, no signed-up flag) is now the standard data-signup-ask;
 *   - cot and tariffs: the custom Daily card above the page ask is gone, one
 *     ask a page;
 *   - farmland-atlas watch.js: a 429 says which of the worker's three 429s it
 *     was (5-county limit, the day's cap for everyone, the rate limit);
 *   - usda-quick-stats and crop-tour: one report-day ask each (the Daily with
 *     report-day mail, scripts/send_report_day.py).
 * Not given an ask: gdu-calculator, grain-emc and fertilizer (the Daily does
 * not cover GDUs, grain drying or fertilizer prices, and no notice topic with a
 * sender fits), and lrp (the page says it asks for no contact details).
 * The browser parts need Playwright and Chromium and skip where they are missing.
 *
 *   node --test test/signup-asks-oct19.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const DASH = /[–—]|&mdash;|&ndash;/;
const asksIn = (h) => h.match(/<div data-signup-ask[^>]*><\/div>/g) || [];
const REPORT_NOTE = 'data-note="Comes with AGSIST Daily, the free morning markets email."';

const ONE_ASK = {
  "cattle-futures-prices.html": "page:cattle-futures-prices",
  "cot.html": "page:cot",
  "tariffs.html": "page:tariffs",
  "usda-quick-stats.html": "page:usda-quick-stats",
  "crop-tour.html": "page:crop-tour",
};

test("each page has one ask, the standard one, and no hand-made signup form", () => {
  for (const [p, src] of Object.entries(ONE_ASK)) {
    const h = read(p);
    const asks = asksIn(h);
    assert.equal((h.match(/data-signup-ask/g) || []).length, 1, p + ": one ask a page");
    assert.equal(asks.length, 1, p);
    assert.ok(asks[0].includes(`data-source="${src}"`), p + ": its own source");
    assert.ok(!/id="signup-(card|form|email|btn)"/.test(h), p + ": no custom signup card left");
    assert.ok(!h.includes("agsist-subs.dnilgis.workers.dev/subscribe"), p + ": no page-local POST to /subscribe");
    assert.ok(!DASH.test(asks[0]), p + ": no dashes in the ask");
    assert.ok(/\/components\/loader\.js\?v=\d+/.test(h), p + ": loader.js brings signup-ask.js");
  }
});

test("cattle futures keeps its own reason line", () => {
  const [a] = asksIn(read("cattle-futures-prices.html"));
  assert.equal(a, '<div data-signup-ask="Email me the morning market read with the numbers and the USDA calendar." data-source="page:cattle-futures-prices" data-note="Free. No affiliate links. I read every reply."></div>');
  assert.ok(!read("cattle-futures-prices.html").includes(".catch(function(){});\n  });"), "the swallowed-error handler is gone");
});

test("usda-quick-stats and crop-tour ask for the report-day email, which send_report_day.py sends", () => {
  const [q] = asksIn(read("usda-quick-stats.html"));
  const [cal] = asksIn(read("usda-calendar.html"));
  assert.equal(q, cal.replace('data-source="page:usda-calendar"', 'data-source="page:usda-quick-stats"'), "the usda-calendar ask word for word");
  const [c] = asksIn(read("crop-tour.html"));
  assert.ok(c.includes('data-signup-ask="Email me the afternoon of each WASDE: the corn and soybean yields USDA printed against what the trade expected."'));
  for (const a of [q, c]) {
    assert.ok(a.includes(REPORT_NOTE), "says it is the Daily");
    assert.ok(!a.includes('data-reports="0"') && !a.includes("data-topic"), "a Daily signup with report-day mail on");
  }
  const s = read("scripts/send_report_day.py");
  assert.match(s, /TYPES = \("WASDE", "Crop Production", "Grain Stocks"\)/);
  assert.ok(s.includes("its corn and soybean yields arrive as\n    the WASDE rows"), "the WASDE email carries the yields");
  const h = read("crop-tour.html");
  assert.ok(h.indexOf("data-signup-ask") < h.indexOf("<!--FAQ:START-->"), "outside the FAQ block");
  assert.ok(h.lastIndexOf("<!-- /CT:") < h.indexOf("data-signup-ask"), "after every baked region");
});

test("pages left without an ask, and why", () => {
  for (const p of ["gdu-calculator.html", "grain-emc.html", "fertilizer.html"]) assert.equal(asksIn(read(p)).length, 0, p + ": the Daily does not cover it");
  const lrp = read("lrp.html");
  assert.equal(asksIn(lrp).length, 0);
  assert.ok(lrp.includes("asks for no contact details"), "lrp promises no contact capture");
});

test("watch.js names each 429 the worker returns; the shipped file is the builder's", () => {
  const w = read("workers/subs-worker.js");
  for (const e of ['error: "limit" }, 429', 'error: "busy today" }, 429', 'error: "too many requests; try again later" }, 429'])
    assert.ok(w.includes(e), "worker answers " + e);
  const b = read("scripts/build_atlas_pages.py");
  const js = /WATCH_JS = """([\s\S]*?)"""/.exec(b)[1];
  assert.equal(read("farmland-atlas/watch.js"), js, "farmland-atlas/watch.js is WATCH_JS");
  assert.ok(js.includes("e==='limit'?'One address can watch up to 5 counties. Nothing was saved.'"));
  assert.ok(js.includes("e==='busy today'?'County watch sign-ups are full for today across the site. Nothing was saved. Try again tomorrow.'"));
  assert.ok(js.includes(":'Too many tries from this connection. Nothing was saved. Try again later.'"));
  assert.ok(!DASH.test(js));
  const v = crypto.createHash("sha1").update(js).digest("hex").slice(0, 8);
  assert.ok(read("farmland-atlas/iowa/story-county.html").includes(`/farmland-atlas/watch.js?v=${v}"`), "county pages load this version");
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
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
/* answer(path) -> {status, body}: what the worker says */
async function open(browser, port, url, posts, answer) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    if (u.startsWith("https://agsist-subs.dnilgis.workers.dev/") && r.request().method() === "POST") {
      const p = new URL(u).pathname;
      posts.push({ path: p, body: JSON.parse(r.request().postData() || "{}") });
      const a = answer(p);
      return r.fulfill({ status: a.status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(a.body) });
    }
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
  return pg;
}
const EMAIL = "reader@example.com";
const noEmailIn = async (pg) => {
  const dl = await pg.evaluate(() => JSON.stringify(Array.from(window.dataLayer || [], (x) => Array.from(x && x.length !== undefined ? x : [x]))));
  assert.ok(!dl.includes(EMAIL) && !dl.includes("@example"), "no address in dataLayer");
};

test("cattle futures: a failed signup says so, a good one posts source and ZIP", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port, posts = [];
  let fail = true;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await open(browser, port, "/cattle-futures-prices.html", posts, () => (fail ? { status: 500, body: { ok: false } } : { status: 200, body: { ok: true } }));
    const ask = pg.locator('main [data-signup-ask][data-source="page:cattle-futures-prices"]');
    await ask.locator(".sa-in").waitFor();
    assert.equal(await pg.locator("main .sa-ask").count(), 1, "one ask drawn in the page");
    assert.equal(await ask.locator(".sa-z").isVisible(), true, "ZIP box shown on a page ask");
    await ask.locator(".sa-in").fill(EMAIL);
    await ask.locator(".sa-zin").fill("68801");
    await ask.locator(".sa-b").click();
    await pg.waitForFunction(() => /Nothing was saved/.test((document.querySelector('[data-source="page:cattle-futures-prices"] .sa-m') || {}).textContent || ""));
    assert.equal(await ask.locator(".sa-ok").count(), 0, "no success shown on a 500");
    assert.equal(await pg.evaluate(() => document.cookie.includes("agsist_subscribed=")), false, "not marked signed up");
    fail = false;
    await ask.locator(".sa-b").click();
    await ask.locator(".sa-ok").waitFor();
    const subs = posts.filter((x) => x.path === "/subscribe");
    assert.equal(subs.length, 2);
    assert.deepEqual(subs[1].body, { email: EMAIL, source: "page:cattle-futures-prices", reports: true, zip: "68801" });
    await noEmailIn(pg);
  } finally { await browser.close(); srv.close(); }
});

test("cot, tariffs, usda-quick-stats, crop-tour: one ask drawn, and it posts its source", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [p, src] of Object.entries(ONE_ASK)) {
      if (p === "cattle-futures-prices.html") continue;
      const posts = [];
      const pg = await open(browser, port, "/" + p, posts, () => ({ status: 200, body: { ok: true } }));
      const ask = pg.locator(`main [data-source="${src}"]`);
      await ask.locator(".sa-in").waitFor();
      assert.equal(await pg.locator("main .sa-ask").count(), 1, p + ": one ask drawn in the page");
      await ask.locator(".sa-in").fill(EMAIL);
      await ask.locator(".sa-b").click();
      await ask.locator(".sa-ok").waitFor();
      const subs = posts.filter((x) => x.path === "/subscribe");
      assert.equal(subs.length, 1, p);
      assert.equal(subs[0].body.source, src, p);
      assert.equal(subs[0].body.reports, true, p);
      await noEmailIn(pg);
      await pg.context().close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("Atlas county watch: each 429 reads as what happened", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const cases = [
    [{ ok: false, error: "limit" }, "One address can watch up to 5 counties. Nothing was saved."],
    [{ ok: false, error: "busy today" }, "County watch sign-ups are full for today across the site. Nothing was saved. Try again tomorrow."],
    [{ ok: false, error: "too many requests; try again later" }, "Too many tries from this connection. Nothing was saved. Try again later."],
  ];
  try {
    for (const [body, want] of cases) {
      const posts = [];
      const pg = await open(browser, port, "/farmland-atlas/iowa/story-county.html", posts, () => ({ status: 429, body }));
      const f = pg.locator('form.watch[data-fips="19169"]');
      await f.locator('input[name="email"]').fill(EMAIL);
      await f.locator("button").click();
      await pg.waitForFunction((w) => (document.querySelector("form.watch .wm") || {}).textContent === w, want);
      assert.equal(posts.length, 1);
      assert.equal(posts[0].path, "/watch-subscribe");
      await noEmailIn(pg);
      await pg.context().close();
    }
  } finally { await browser.close(); srv.close(); }
});
