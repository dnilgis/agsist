/* The worker-only actions with the subs worker blocked (Oct 22 2026), on the
 * real pages in Chromium, served as https://agsist.com: no error, the plain
 * line, the request kept; then the worker back, the page opened again, and
 * the request sent exactly once (two tabs at once included).
 *
 *   Email me this design   rain-print.html        Formspree, never the outbox
 *   business quote         rain-print-business    kept in the browser, never Formspree
 *   gift card              rain-print.html?gift=  the card can still be used (the order: test/outbox.test.mjs)
 *   hay board post         haymow.html            kept; the edit link shows after it goes
 *   elevator bids          post.html?k=           opens from this phone's last copy; a save is kept
 *   alert confirm          e.html                 "Confirm when it is back"
 *
 * Every name, address and code here is made up. DEFERRED_SHOTS=<dir> saves
 * screenshots at 390 and 1280.
 *
 *   node --test test/deferred-pages.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const W = "https://agsist-subs.dnilgis.workers.dev";
const SHOTS = process.env.DEFERRED_SHOTS || "";
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const BLOCK = "<!DOCTYPE html><html><head><title>Suspected phishing site | Cloudflare</title></head><body><h1>Warning: Suspected Phishing</h1></body></html>";
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon" };
const LINE = "Saved. It will go through when our system is back and you next open agsist.com on this device; nothing else to do.";

const REC = { id: "e1", name: "Test Grain Co", town: "Testville", state: "WI",
  bids: [{ crop: "corn", period: "Nov", start: "2026-11-01", end: "2026-11-30", futures: "ZCZ26", basis: -0.45 }],
  hours: { text: "Mon-Fri 7-5", harvest: "" }, contact: { name: "Lee", phone: "715-555-0100" }, note: "", bids_updated_at: "2026-10-22T12:00:00Z", info_updated_at: "2026-10-22T12:00:00Z" };
const KEY = "abcdefghijklmnopqrstuvwx";

/* state.mode: 'blocked' (Cloudflare's page, no CORS: the browser's fetch fails), 'down', or 'up'.
   log.worker: every worker call while up ("POST /form" and its body); log.formspree: every backup form post. */
async function withSite(fn, { width = 1280, height = 900 } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME });
  const state = { mode: "blocked" }, log = { worker: [], tried: [], formspree: [] };
  try {
    const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
    await ctx.clock.setFixedTime(new Date("2026-10-22T14:00:00Z"));
    await ctx.addInitScript(() => { window.gaEvent = () => {}; });
    await ctx.route(/^https?:\/\//, async (r) => {
      const q = r.request(), u = new URL(q.url());
      if (u.host === "agsist.com") {
        let p = path.normalize(path.join(ROOT, decodeURIComponent(u.pathname)));
        if (u.pathname === "/") p = path.join(ROOT, "index.html");
        if (!path.extname(p) && fs.existsSync(p + ".html")) p += ".html";
        if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return r.fulfill({ status: 404, body: "" });
        return r.fulfill({ status: 200, contentType: TYPES[path.extname(p)] || "application/octet-stream", body: fs.readFileSync(p) });
      }
      if (u.host === "formspree.io") { log.formspree.push(q.postData() || ""); return r.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: { ok: true } }); }
      if (u.host === "agsist-subs.dnilgis.workers.dev") {
        if (q.method() !== "OPTIONS") log.tried.push(q.method() + " " + u.pathname);
        if (state.mode === "blocked") return r.fulfill({ status: 403, contentType: "text/html; charset=UTF-8", body: BLOCK });
        if (state.mode === "down") return r.abort("connectionrefused");
        const h = { "Access-Control-Allow-Origin": "https://agsist.com", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
        if (q.method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
        let body = null; try { body = JSON.parse(q.postData() || "null"); } catch (e) { body = q.postData(); }
        log.worker.push({ call: q.method() + " " + u.pathname, body, search: u.search });
        const P = u.pathname;
        if (P === "/hay/feed") return r.fulfill({ headers: h, json: { ok: true, listings: [] } });
        if (P === "/hay/post") return r.fulfill({ headers: h, json: { ok: true, id: "h7", key: "k7k7k7k7", status: "live" } });
        if (P === "/elev/me") return r.fulfill({ headers: h, json: { ok: true, record: REC } });
        if (P === "/elev/save") return r.fulfill({ headers: h, json: { ok: true, record: Object.assign({}, REC, { note: body.note || "", bids_updated_at: "2026-10-22T14:00:00Z" }) } });
        if (P === "/fd/watch-confirm") return r.fulfill({ headers: h, json: q.method() === "GET" ? { title: "Confirm your alert", button: "Confirm" } : { ok: true, title: "Your alert is on" } });
        if (P === "/form" || P === "/rp-remind") return r.fulfill({ headers: h, json: { ok: true } });
        return r.fulfill({ status: 404, headers: h, json: { ok: false, error: "not found" } });
      }
      return r.abort();
    });
    const errors = [];
    const open = async () => { const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(String(e))); return p; };
    await fn({ ctx, open, state, log, errors });
  } finally { await browser.close(); }
}
const outbox = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("agsist-outbox") || "[]"));
const calls = (log, c) => log.worker.filter((x) => x.call === c);
async function shot(page, name, sel) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const was = page.viewportSize();
  for (const w of [390, 1280]) {
    await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
    await page.waitForTimeout(300);
    if (sel) await page.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, name + "-" + w + ".png") });
  }
  await page.setViewportSize(was);
}
// the page opened again with the worker back: the outbox goes 1.5 s after load
async function drains(page, url, log, call) {
  await page.goto(url);
  await page.waitForFunction(() => !localStorage.getItem("agsist-outbox"), null, { timeout: 10000 });
  await page.waitForTimeout(300);
  return calls(log, call).length;
}

test("business quote: worker blocked, the list is kept here and never sent to Formspree; back, it goes once (two tabs open)", { skip }, async () => {
  await withSite(async ({ open, state, log, errors }) => {
    const page = await open();
    await page.goto("https://agsist.com/rain-print-business");
    await page.fill("#rb-business", "Made-Up Co-op");
    await page.fill("#rb-name", "Lee Example");
    await page.fill("#rb-email", "lee@example.com");
    await page.fill("#rb-qty", "6");
    await page.fill("#rb-towns", "Olson Farm, Chetek, WI, 2025\nPat Example, Barron, WI, 2025");
    await page.click("#rb-submit");
    await page.getByText("Saved on this device, not sent yet.").waitFor();
    const t = await page.textContent("#rb-out");
    assert.match(t, /go to me the next time you open agsist\.com on this device after it is back; nothing else to do\./);
    assert.match(t, /715-797-2428/);
    assert.ok(!/didn.t send|error|403/i.test(t), t);
    assert.equal(log.formspree.length, 0, "the list never goes to Formspree");
    const k = await outbox(page);
    assert.equal(k.length, 1); assert.equal(k[0].body.kind, "rain-print-business"); assert.match(k[0].body.towns, /Olson Farm/);
    await shot(page, "business-kept", "#rb-out");
    state.mode = "up";
    const a = await open(), b = await open();
    await Promise.all([a.goto("https://agsist.com/rain-print-business"), b.goto("https://agsist.com/haymow")]);
    await a.waitForFunction(() => !localStorage.getItem("agsist-outbox"), null, { timeout: 10000 });
    await a.waitForTimeout(2500);
    const sent = calls(log, "POST /form");
    assert.equal(sent.length, 1, "once, with two tabs open");
    assert.equal(sent[0].body.kind, "rain-print-business"); assert.match(sent[0].body.towns, /Pat Example/);
    const said = (p) => p.evaluate(() => (document.getElementById("outbox-said") || {}).textContent || "");
    assert.match((await said(a)) + (await said(b)), /Sent now that our system is back: your Rain Print business quote request\./);
    await a.reload(); await a.waitForTimeout(2500);
    assert.equal(calls(log, "POST /form").length, 1, "no repeat on a later visit");
    assert.deepEqual(errors, []);
  });
});

test("hay board post: worker blocked, kept with the plain line; back, posted once and the edit link shows", { skip }, async () => {
  await withSite(async ({ open, state, log, errors }) => {
    const page = await open();
    await page.goto("https://agsist.com/haymow");
    await page.check('input[name="pkind"][value="wanted"]');
    await page.selectOption("#hb-product", "alfalfa");
    await page.fill("#hb-zipp", "54728");
    await page.fill("#hb-phone", "715-555-0100");
    await page.click("#hb-send");
    await page.getByText(LINE).waitFor();
    assert.match(await page.textContent("#hb-out"), /your private edit link shows on this page/);
    const k = await outbox(page);
    assert.equal(k.length, 1); assert.equal(k[0].url, W + "/hay/post"); assert.equal(k[0].body.phone, "715-555-0100");
    await shot(page, "hay-kept", "#hb-out");
    state.mode = "up";
    assert.equal(await drains(page, "https://agsist.com/haymow", log, "POST /hay/post"), 1);
    const mine = await page.evaluate(() => JSON.parse(localStorage.getItem("agsist-hay-mine") || "[]"));
    assert.equal(mine[0].id, "h7");
    await page.locator("#hb-mine").waitFor({ state: "visible" });
    await page.reload(); await page.waitForTimeout(2500);
    assert.equal(calls(log, "POST /hay/post").length, 1);
    assert.deepEqual(errors, []);
  });
});

test("elevator bids: worker blocked, the page opens from this phone's last copy and a save is kept; back, saved once", { skip }, async () => {
  await withSite(async ({ open, state, log, errors }) => {
    const page = await open();
    state.mode = "up";
    await page.goto("https://agsist.com/post?k=" + KEY);
    await page.locator("#ep-save").waitFor();
    state.mode = "blocked";
    await page.reload();
    await page.locator("#ep-save").waitFor();
    assert.match(await page.textContent("#ep-state"), /Our system is down right now/);
    await page.fill("#ep-note", "Corn dump open till 9");
    await page.click("#ep-save");
    await page.waitForFunction(() => /^Kept on this phone\./.test(document.getElementById("ep-state").textContent));
    assert.equal(await page.textContent("#ep-state"), "Kept on this phone. Open this page again once our system is back (within 4 hours) and it posts.");
    const k = await outbox(page);
    assert.equal(k.length, 1); assert.equal(k[0].body.note, "Corn dump open till 9");
    assert.ok(k[0].expires > k[0].t && k[0].expires - k[0].t <= 4 * 3600000, "dropped unsent after 4 hours at most");
    await shot(page, "elevator-kept");
    state.mode = "up";
    page.on("dialog", (d) => d.accept());
    await page.reload();
    await page.waitForFunction(() => !localStorage.getItem("agsist-outbox"), null, { timeout: 10000 });
    await page.waitForTimeout(2500);
    const s = calls(log, "POST /elev/save");
    assert.equal(s.length, 1); assert.equal(s[0].body.k, KEY); assert.equal(s[0].body.note, "Corn dump open till 9");
    assert.deepEqual(errors, []);
  });
});

test("alert confirm on /e: worker down, 'Confirm when it is back' keeps it; back, confirmed once", { skip }, async () => {
  await withSite(async ({ open, state, log, errors }) => {
    const page = await open();
    state.mode = "down";
    const url = "https://agsist.com/e?a=watch-confirm&k=abcdefghjkmnpqrs&f=19169&t=0123456789abcdef";
    await page.goto(url);
    await page.getByText("This is not working right now").waitFor();
    assert.match(await page.locator("main").innerText(), /Try again later\. Nothing was changed\./);
    await page.getByRole("button", { name: "Confirm when it is back" }).click();
    await page.getByText(LINE).waitFor();
    const k = await outbox(page);
    assert.equal(k.length, 1); assert.equal(k[0].url, W + "/fd/watch-confirm?k=abcdefghjkmnpqrs&t=0123456789abcdef&f=19169");
    await shot(page, "confirm-kept");
    state.mode = "up";
    assert.equal(await drains(page, url, log, "POST /fd/watch-confirm"), 1);
    await page.reload(); await page.waitForTimeout(2500);
    assert.equal(calls(log, "POST /fd/watch-confirm").length, 1, "only the kept press posted; the page asks again with its button");
    // a stop link is never kept: it has the mailto stop instead
    state.mode = "down";
    await page.goto("https://agsist.com/e?a=unsubscribe&k=abcdefghjkmnpqrs&t=0123456789abcdef");
    await page.getByText("This is not working right now").waitFor();
    assert.equal(await page.getByRole("button", { name: "Confirm when it is back" }).isVisible(), false);
    assert.deepEqual(errors, []);
  });
});

test("Email me this design: worker blocked, it goes to Sig by the backup form with the plain line, not the outbox", { skip }, async () => {
  const { mocks } = await import("./fixtures/rp-site-mock.mjs");
  await withSite(async ({ ctx, open, log, errors }) => {
    // NOAA and the town lookup answered with made-up data (the same fixture the Rain Print tests use)
    const fx = { order: [], stripe: [] };
    await mocks(ctx, {}, fx);
    await ctx.route(/^https?:\/\/(agsist\.com|formspree\.io|agsist-subs\.dnilgis\.workers\.dev)\//, async (r) => {
      const q = r.request(), u = new URL(q.url());
      if (u.host === "formspree.io") { log.formspree.push(q.postData() || ""); return r.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: { ok: true } }); }
      if (u.host === "agsist-subs.dnilgis.workers.dev") { log.tried.push(q.method() + " " + u.pathname); return r.fulfill({ status: 403, contentType: "text/html", body: BLOCK }); }
      let p = path.normalize(path.join(ROOT, decodeURIComponent(u.pathname)));
      if (!path.extname(p) && fs.existsSync(p + ".html")) p += ".html";
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return r.fulfill({ status: 404, body: "" });
      return r.fulfill({ status: 200, contentType: TYPES[path.extname(p)] || "application/octet-stream", body: fs.readFileSync(p) });
    });
    const page = await open();
    await page.goto("https://agsist.com/rain-print?" + new URLSearchParams({ place: "Chetek, WI", year: "2012", station: "471667 2", style: "r1", name: "Olson Home Place" }));
    await page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-art").getAttribute("aria-busy"), null, { timeout: 30000 });
    await page.locator("#rp-mailme-open").waitFor({ state: "visible", timeout: 15000 });
    await page.click("#rp-mailme-open");
    await page.fill("#rp-mailme-email", "reader@example.com");
    await page.click("#rp-mailme-go");
    await page.waitForFunction(() => /^Saved\./.test(document.getElementById("rp-mailme-out").textContent), null, { timeout: 20000 });
    assert.equal(await page.textContent("#rp-mailme-out"), "Saved. It will go through when our system is back; nothing else to do.");
    assert.ok(log.tried.includes("POST /rp-remind"), "the worker was asked first");
    const f = log.formspree.filter((b) => /rain-print-remind/.test(b));
    assert.equal(f.length, 1);
    assert.match(f[0], /reader@example\.com/); assert.match(f[0], /agsist\.com\/rain-print\?d=/);
    assert.equal((await outbox(page)).length, 0, "not kept in the browser: Sig has it");
    await shot(page, "emailme-kept", "#rp-mailme-out");
    assert.deepEqual(errors.filter((e) => !/ResizeObserver/.test(e)), []);
  });
});

test("gift card: worker blocked, the card can still be used and the banner says so", { skip }, async () => {
  await withSite(async ({ open, errors }) => {
    const page = await open();
    await page.goto("https://agsist.com/rain-print?gift=RP-7K3M-Q9TW-H2F" + (() => {
      const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; let m = 0; for (const ch of "7K3MQ9TWH2F") m = (m * 32 + B32.indexOf(ch)) % 37; return B32[m];
    })());
    await page.locator("#rp-gift-banner").getByText("Our system is down, so your card can’t be checked right now. You can still use it.").waitFor({ timeout: 15000 });
    const t = await page.textContent("#rp-gift-banner");
    assert.match(t, /saved on this device and goes through when our system is back/);
    assert.ok(!/didn.t answer|That code didn/.test(t), t);
    await shot(page, "gift-banner");
    assert.deepEqual(errors.filter((e) => !/ResizeObserver/.test(e)), []);
  });
});

test("watch signups with the worker blocked are taken by the backup form (loader.js) for every watch route the pages post to", () => {
  const L = fs.readFileSync(ROOT + "components/loader.js", "utf8");
  const lists = /var LISTS = \{([\s\S]*?)\};/.exec(L)[1];
  for (const r of ["/watch-subscribe", "/elevator-watch-subscribe", "/price-watch-subscribe", "/alert-subscribe", "/subscribe", "/notice"]) assert.ok(lists.includes("'" + r + "'"), r);
  const used = new Set();
  for (const f of ["components/cb-alerts.js", "components/cb-signup.js", "components/signup-ask.js", "components/homepage-extras.js", "farmland-atlas/watch.js", "hail-map.html"]) {
    for (const m of fs.readFileSync(ROOT + f, "utf8").matchAll(/['"](\/(?:[a-z]+-)*(?:watch|alert)-subscribe)['"]/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 2);
  for (const r of used) assert.ok(lists.includes("'" + r + "'"), "the signup fallback covers " + r);
});
