/* The WASDE summary and Funds this week asks (Sig, Oct 21 2026).
 *   - one ask a page: each page's Daily ask was replaced, not stacked;
 *   - each box sends its own source tag (report:wasde:<page>, cot-weekly:<page>)
 *     and topic; the subs worker (v5.44) keeps it; GET /count lists shows it
 *     by source; the morning report's Signups table has a row for each list
 *     and names the pages in its breakdown;
 *   - in a browser at 390 px with the worker mocked: the ask draws, never
 *     ticks the Daily, posts its list, fires GA4 ask_shown and notice_signup
 *     like every other ask, then One more? offers the Daily unticked.
 * Browser parts need Playwright and Chromium and skip where they are missing.
 * REPORT_ASK_SHOTS=<dir> saves screenshots.
 *
 *   node --test test/report-asks.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const DASH = /[–—]|&mdash;|&ndash;/;
const asksIn = (h) => h.match(/<div data-signup-ask[^>]*><\/div>/g) || [];
const attr = (a, n) => ((new RegExp(` ${n}="([^"]*)"`)).exec(a) || [])[1];

const WASDE_PAGES = ["usda-calendar", "whats-priced-in", "usda-quick-stats", "crop-tour"];
const COT_PAGES = ["cot", "corn-futures-prices", "soybean-futures-prices", "wheat-futures-prices", "cattle-futures-prices", "cattle-auction-prices"];
const PAGES = [...WASDE_PAGES.map((p) => [p, "reports", "report:wasde:" + p]), ...COT_PAGES.map((p) => [p, "cot", "cot-weekly:" + p])];

test("one ask a page: the list's ask replaced the Daily ask, with its topic and source tag", () => {
  for (const [p, topic, src] of PAGES) {
    const h = read(p + ".html");
    const asks = asksIn(h);
    assert.equal((h.match(/data-signup-ask/g) || []).length, 1, p + ": one ask a page");
    const a = asks[0];
    assert.equal(attr(a, "data-topic"), topic, p);
    assert.equal(attr(a, "data-source"), src, p + ": its own source tag");
    assert.equal(attr(a, "data-signup-ask"), topic === "reports" ? "Email me the WASDE summary when it drops" : "Email me Funds this week, after each COT report", p);
    assert.ok(attr(a, "data-note").endsWith("Free, its own list."), p + ": says it is not the Daily");
    assert.ok(!/data-daily|checked/.test(a), p + ": nothing ticks the Daily");
    assert.ok(!DASH.test(a), p + ": no dashes");
    assert.ok(src.length <= 60, p + ": the worker keeps 60 characters of source");
    assert.ok(h.indexOf("<main") < h.indexOf("data-signup-ask") && h.indexOf("data-signup-ask") < h.indexOf("</main>"), p + ": in the page body");
    assert.ok(!h.includes("Comes with AGSIST Daily, the free morning markets email."), p + ": the old Daily note is gone");
    assert.ok(/\/components\/loader\.js\?v=\d+/.test(h), p + ": loader.js brings signup-ask.js");
  }
});

// ------------------------------------------------- the source reaches /count and the morning report
async function worker() {
  const tmp = path.join(os.tmpdir(), "subs-worker-asks-" + process.pid + ".mjs");
  fs.copyFileSync(path.join(ROOT, "workers/subs-worker.js"), tmp);
  const w = (await import(pathToFileURL(tmp).href)).default;
  fs.unlinkSync(tmp);
  const store = new Map();
  const env = { UNSUB_SECRET: "sec", LIST_TOKEN: "tok", SUBS: {
    async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; } } };
  return { w, env, store };
}

test("every box's source reaches /count lists and the morning report's Signups rows", async () => {
  const { w, env } = await worker();
  let i = 0;
  for (const [p] of PAGES) {
    // the body the page's ask posts (signup-ask.js notice()), read from the page itself
    const a = asksIn(read(p + ".html"))[0];
    const body = { email: `r${++i}@farm.com`, source: attr(a, "data-source"), topic: attr(a, "data-topic"), daily: false };
    const r = await w.fetch(new Request("https://x.dev/notice", { method: "POST",
      headers: { Origin: "https://agsist.com", "Content-Type": "application/json", "CF-Connecting-IP": "10.1.0." + i }, body: JSON.stringify(body) }), env);
    assert.equal(r.status, 200, p);
  }
  const count = await (await w.fetch(new Request("https://x.dev/count?token=tok"), env)).json();
  assert.equal(count.lists.reports.n, WASDE_PAGES.length);
  assert.equal(count.lists.cot.n, COT_PAGES.length);
  for (const [p, topic, src] of PAGES) assert.equal(count.lists[topic].by_source[src], 1, p + ": counted under its own source");
  assert.equal(count.daily, 0, "nobody was put on the Daily");
  // the morning report reads that /count: a row per list, and the sources kept by name
  const py = `
import json, sys
sys.path.insert(0, "scripts")
import morning_report as M
from datetime import datetime
c = json.load(sys.stdin)
now = datetime(2026, 10, 21, 11, 45, tzinfo=M.UTC)
week = {"s:bar": 0, "l:reports": 0, "l:cot": 0}   # a morning that kept the table
snap = {"2026-10-20": dict(week), "2026-10-14": dict(week)}
src = M.Fake({}, {"count": c, "list": []}, {}, {})
rep = M.Report()
M.sec_signups(src, now, rep, snap)
M.sec_signup_sources(src, now, rep, snap)
t = rep.tables["Signups"]
print(json.dumps({"rows": t["rows"], "after": t["after"], "day": snap["2026-10-21"]}))
`;
  const out = spawnSync("python3", ["-c", py], { cwd: ROOT, input: JSON.stringify(count), encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  const m = JSON.parse(out.stdout.trim().split("\n").pop());
  const rows = Object.fromEntries(m.rows.map((r) => [r[0], r.slice(1)]));
  assert.deepEqual(rows["WASDE summary"], [String(WASDE_PAGES.length), "+" + WASDE_PAGES.length, "+" + WASDE_PAGES.length]);
  assert.deepEqual(rows["Funds this week"], [String(COT_PAGES.length), "+" + COT_PAGES.length, "+" + COT_PAGES.length]);
  for (const [p, topic, src] of PAGES) assert.equal(m.day[`ls:${topic}:${src}`], 1, p + ": kept by source for tomorrow's change");
  const top = m.after.find((x) => x.startsWith("Top pages by new signups this week:"));
  assert.ok(top && /\/(cot|[a-z-]+) \((WASDE summary|Funds this week)\) \+1/.test(top), "the pages show in the breakdown: " + top);
  assert.ok(!JSON.stringify(m).includes("@"), "counts only");
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const SHOTS = process.env.REPORT_ASK_SHOTS || "";

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png" };
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
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  if (o.init) await ctx.addInitScript(o.init);
  const pg = await ctx.newPage();
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    if (u.startsWith("https://agsist-subs.dnilgis.workers.dev/") && r.request().method() === "POST") {
      const p = new URL(u).pathname;
      const b = JSON.parse(r.request().postData() || "{}");
      posts.push({ path: p, body: b });
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(p === "/notice" ? { ok: true, topic: b.topic, daily: !!b.daily } : { ok: true }) });
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
async function shot(pg, el, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  await pg.screenshot({ path: path.join(SHOTS, name), clip: { x: 0, y: Math.max(0, b.y - 24), width: 390, height: Math.min(900, b.height + 48) } });
}

for (const [p, topic, src, wantMore] of [
  ["usda-calendar", "reports", "report:wasde:usda-calendar", ["daily", "price"]],
  ["corn-futures-prices", "cot", "cot-weekly:corn-futures-prices", ["daily", "price", "wasde"]],
  ["cot", "cot", "cot-weekly:cot", ["daily", "wasde", "price"]],
]) {
  test(`${p} at 390 px: the ${topic} ask posts its list and source, GA4 events, One more? after`, { skip, timeout: 120000 }, async () => {
    const srv = await serve(), port = srv.address().port, posts = [];
    const browser = await chromium.launch({ executablePath: CHROME });
    try {
      const pg = await newPage(browser, port, posts, { init: () => { localStorage.setItem("agsist_visits", "3"); } });
      await go(pg, port, "/" + p + ".html");
      const ask = pg.locator(`main [data-source="${src}"]`);
      await ask.locator(".sa-in").waitFor();
      assert.equal(await pg.locator("main .sa-ask").count(), 1, "one ask drawn");
      const box = ask.locator(".sa-d input");
      assert.equal(await box.isChecked(), false, "the morning briefing box starts empty");
      const w = await pg.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(w <= 390, "no sideways scroll at 390 px: " + w);
      const fb = await ask.locator(".sa-b").boundingBox(), ib = await ask.locator(".sa-in").boundingBox();
      assert.ok(fb.height >= 44 && ib.height >= 44 && fb.x + fb.width <= 390, "a full-size field and button on a phone");
      await ask.scrollIntoViewIfNeeded();
      const id = src + "|" + topic;
      await pg.waitForFunction((i) => Array.from(window.dataLayer).some((x) => x[0] === "event" && x[1] === "ask_shown" && x[2].ask_id === i), id);
      await pg.waitForTimeout(500);
      assert.equal(await pg.locator("#sa-bar").count(), 0, "the page's own ask keeps the bar away");
      await shot(pg, ask, `${p}-ask-390.png`);
      await ask.locator(".sa-in").fill(EMAIL);
      await ask.locator(".sa-b").click();
      await ask.locator(".sa-ok").waitFor();
      const n = posts.filter((x) => x.path === "/notice");
      assert.deepEqual(n.map((x) => x.body), [{ email: EMAIL, source: src, topic, daily: false }]);
      assert.equal(posts.filter((x) => x.path === "/subscribe").length, 0, "not the Daily");
      assert.deepEqual(await events(pg, "notice_signup"), [{ topic, source: src, ask_id: id }], "GA4 like every notice ask");
      assert.equal((await events(pg, "email_signup")).length, 0, "no Daily signup event");
      const more = ask.locator("[data-sa-more]");
      await more.locator(".sa-mh").waitFor();
      const keys = await more.locator("[data-k]").evaluateAll((a) => a.map((x) => x.getAttribute("data-k")));
      assert.deepEqual(keys, wantMore, "One more? offers: " + keys);
      for (const c of await more.locator('input[type="checkbox"]').all()) assert.equal(await c.isChecked(), false, "nothing ticked");
      await shot(pg, ask, `${p}-after-390.png`);
      if (keys.includes("wasde") || keys.includes("cot")) {
        const k = keys.includes("wasde") ? "wasde" : "cot";
        await more.locator(`[data-k="${k}"] input`).check();
        await more.locator(".sa-b").click();
        await more.locator(".sa-ok").waitFor();
        const last = posts.filter((x) => x.path === "/notice").pop().body;
        assert.deepEqual(last, { email: EMAIL, source: "onemore:notice", topic: k === "wasde" ? "reports" : "cot", daily: false }, "the extra list, tagged onemore:notice");
      }
      // the ask is remembered: a reload does not ask again
      await go(pg, port, "/" + p + ".html");
      await pg.waitForFunction((s) => (document.querySelector(`main [data-source="${s}"]`) || {}).getAttribute && document.querySelector(`main [data-source="${s}"]`).getAttribute("data-sa-ready"), src);
      assert.equal(await pg.locator(`main [data-source="${src}"]`).isHidden(), true, "asked once in this browser");
      await noEmailIn(pg);
    } finally { await browser.close(); srv.close(); }
  });
}

test("a Daily reader still sees the list ask, without the morning briefing box", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port, posts = [];
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await newPage(browser, port, posts, { init: () => { document.cookie = "agsist_subscribed=1;path=/"; localStorage.setItem("agsist_subscribed", "1"); localStorage.setItem("agsist_subscribed_at", String(Date.now())); } });
    await go(pg, port, "/wheat-futures-prices.html");
    const ask = pg.locator('main [data-source="cot-weekly:wheat-futures-prices"]');
    await ask.locator(".sa-in").waitFor();
    assert.equal(await ask.locator(".sa-d").count(), 0, "no Daily box for a Daily reader");
    await ask.locator(".sa-in").fill(EMAIL);
    await ask.locator(".sa-b").click();
    await ask.locator(".sa-ok").waitFor();
    assert.deepEqual(posts.map((x) => x.body), [{ email: EMAIL, source: "cot-weekly:wheat-futures-prices", topic: "cot", daily: false }]);
  } finally { await browser.close(); srv.close(); }
});
