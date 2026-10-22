/* The GA gate (2026-10-20b). Sig, Oct 20: keep readers anywhere in Google
 * Analytics, keep data center traffic out. The inline agsist-ga-guard loads
 * components/ga-gate.js on the reader's first scroll, tap or key press; the
 * gate asks the subs worker, GET /ga-ok (v5.33), whether the visit comes from
 * a cloud or hosting network and loads gtag.js only on {"ok":true}.
 *
 *   node --test test/ga-gate.test.mjs
 *
 * Part 1 runs the gate in a bare vm with a fake fetch, timer and storage.
 * Part 2 runs the worker's own fetch handler with Cloudflare's request.cf.
 * Part 3 (Playwright, skipped where it is missing) opens a real page with the
 * worker answer mocked, at 390 and 1280 px. Screenshots go to GA_GATE_SHOTS.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const GATE = read("components/ga-gate.js");
const API = "https://agsist-api.dnilgis.workers.dev/ga-ok";
const GA_SRC = "https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H";

// ---------------------------------------------------------------- 1. the gate
function gate({ answer, session = {}, sessionThrows = false, off = false, gaOff, noFetch = false } = {}) {
  const appended = [], asked = [], timers = [];
  const store = new Map(Object.entries(session));
  let abortFn = null;
  const win = {
    agsistGaOff: gaOff,
    localStorage: { getItem: (k) => (k === "agsist-ga-off" && off ? "1" : null) },
    sessionStorage: {
      getItem: (k) => { if (sessionThrows) throw new Error("blocked"); return store.has(k) ? store.get(k) : null; },
      setItem: (k, v) => { if (sessionThrows) throw new Error("blocked"); store.set(k, String(v)); },
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].live = false; },
    AbortController: function () { this.signal = { s: 1 }; this.abort = () => { if (abortFn) abortFn(); }; },
  };
  if (!noFetch) {
    win.fetch = (u, o) => {
      asked.push([u, o]);
      if (answer === "hang") return new Promise((ok, no) => { abortFn = () => no(new Error("aborted")); });
      if (answer === "error") return Promise.reject(new Error("offline"));
      if (answer === 404) return Promise.resolve({ ok: false, status: 404, json: async () => ({ ok: false, error: "not found" }) });
      if (answer === "html") return Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError("not json"); } });
      return Promise.resolve({ ok: true, status: 200, json: async () => answer });
    };
  }
  const doc = { head: { appendChild: (s) => appended.push(s) }, createElement: () => ({}) };
  vm.runInNewContext(GATE, { window: win, document: doc });
  return { win, appended, asked, timers, store };
}
const settle = () => new Promise((r) => setTimeout(r, 10));

test("the gate loads gtag.js only when the worker says ok", async () => {
  const yes = gate({ answer: { ok: true } });
  await settle();
  assert.equal(yes.asked.length, 1);
  assert.equal(yes.asked[0][0], API);
  assert.equal(yes.asked[0][1].credentials, "omit", "no cookies to the worker");
  assert.equal(yes.appended.length, 1);
  assert.equal(yes.appended[0].src, GA_SRC);
  assert.equal(yes.appended[0].async, true);
  assert.equal(yes.store.get("agsist-ga-ok"), "1");
  assert.equal(yes.timers[0].ms, 3000);
  assert.equal(yes.timers[0].live, false, "the 3 s timer is cleared on an answer");

  const no = gate({ answer: { ok: false } });
  await settle();
  assert.equal(no.appended.length, 0, "a cloud network loaded GA");
  assert.equal(no.store.get("agsist-ga-ok"), "0");
});

test("a failed, odd or late answer loads GA anyway and is not kept (Sig, Oct 21)", async () => {
  // Oct 21: Cloudflare blocked the worker for a day and GA counted nobody.
  // Only a clear {"ok":false} keeps GA off; a worker outage must never blank the readers.
  for (const answer of ["error", 404, "html", null, {}, { ok: "true" }, { ok: 1 }]) {
    const r = gate({ answer });
    await settle();
    assert.equal(r.appended.length, 1, `GA stayed off on ${JSON.stringify(answer)}`);
    assert.equal(r.appended[0].src, GA_SRC);
    assert.equal(r.store.has("agsist-ga-ok"), false, `${JSON.stringify(answer)} was kept`);
  }
  // no answer in 3 s: the timer aborts the request and loads GA, once
  const slow = gate({ answer: "hang" });
  await settle();
  assert.equal(slow.appended.length, 0, "GA loaded before the time-out");
  assert.equal(slow.timers[0].ms, 3000);
  slow.timers[0].fn();
  await settle();
  assert.equal(slow.appended.length, 1, "GA did not load after the time-out, or loaded twice");
  assert.equal(slow.store.has("agsist-ga-ok"), false);
  // no fetch at all: load
  const old = gate({ answer: { ok: true }, noFetch: true });
  await settle();
  assert.equal(old.appended.length, 1);
  // a clear no still keeps GA off
  const no = gate({ answer: { ok: false } });
  await settle();
  assert.equal(no.appended.length, 0);
});

test("the tab's kept answer is used without asking again", async () => {
  const one = gate({ answer: { ok: false }, session: { "agsist-ga-ok": "1" } });
  await settle();
  assert.equal(one.asked.length, 0);
  assert.equal(one.appended.length, 1);
  const zero = gate({ answer: { ok: true }, session: { "agsist-ga-ok": "0" } });
  await settle();
  assert.equal(zero.asked.length, 0);
  assert.equal(zero.appended.length, 0);
  // blocked session storage: ask every time, still follow the answer
  const blocked = gate({ answer: { ok: true }, sessionThrows: true });
  await settle();
  assert.equal(blocked.asked.length, 1);
  assert.equal(blocked.appended.length, 1);
});

test("the gate obeys the guard and the /privacy switch set after the page loaded", async () => {
  for (const o of [{ gaOff: true }, { off: true }]) {
    const r = gate({ answer: { ok: true }, ...o });
    await settle();
    assert.equal(r.asked.length, 0, JSON.stringify(o));
    assert.equal(r.appended.length, 0, JSON.stringify(o));
  }
  assert.doesNotMatch(GATE, /[–—]/, "no dashes");
});

// ---------------------------------------------------------------- 2. the worker
const tmp = path.join(os.tmpdir(), "ga-gate-test-" + process.pid + ".mjs");
fs.copyFileSync(path.join(ROOT, "workers/subs-worker.js"), tmp);
const W = (await import(pathToFileURL(tmp).href)).default;
fs.unlinkSync(tmp);
const ENV = { UNSUB_SECRET: "s", SUBS: { async get() { return null; }, async put() { throw new Error("the gate must store nothing"); }, async list() { return { keys: [], list_complete: true }; } } };
async function ask(cf, origin = "https://agsist.com", method = "GET") {
  const req = new Request("https://agsist-api.dnilgis.workers.dev/ga-ok", { method, headers: origin ? { Origin: origin } : {} });
  if (cf !== undefined) Object.defineProperty(req, "cf", { value: cf });
  const r = await W.fetch(req, ENV);
  return { r, j: r.status === 200 ? await r.json() : null };
}

test("worker /ga-ok: readers' networks are ok", async () => {
  const readers = [
    [7922, "Comcast Cable Communications, LLC"], [7018, "AT&T Enterprises, LLC"], [22394, "Cellco Partnership DBA Verizon Wireless"],
    [21928, "T-Mobile USA, Inc."], [14593, "Space Exploration Technologies Corporation"], [30036, "Mediacom Communications Corp"],
    [11492, "CABLE ONE, INC."], [812, "Rogers Communications Canada Inc."], [3320, "Deutsche Telekom AG"], [4134, "Chinanet"],
    [9299, "Philippine Long Distance Telephone Company"], [27699, "TELEFONICA BRASIL S.A"], [17072, "TOTAL PLAY TELECOMUNICACIONES SA DE CV"],
    [393269, "Colorado Central Telecom"], [13335, "Cloudflare, Inc."], [36183, "Akamai Technologies, Inc."], [54113, "Fastly, Inc."],
  ];
  for (const [asn, org] of readers) {
    const { r, j } = await ask({ asn, asOrganization: org, country: "US" });
    assert.equal(r.status, 200);
    assert.deepEqual(j, { ok: true }, `${asn} ${org}`);
  }
});

test("worker /ga-ok: cloud, hosting and data center networks are not", async () => {
  const clouds = [16509, 14618, 8987, 15169, 396982, 19527, 8075, 45102, 37963, 132203, 45090, 136907, 31898, 36351, 14061,
    63949, 20473, 24940, 16276, 51167, 12876, 60781, 16265, 30633, 59253, 9009, 47583];
  for (const asn of clouds) {
    const { j } = await ask({ asn, asOrganization: "Some Company" });
    assert.deepEqual(j, { ok: false }, `ASN ${asn}`);
  }
  // the list in the worker is this list, and the relay exits are not in it
  const w = read("workers/subs-worker.js");
  const listed = [...w.slice(w.indexOf("const CLOUD_ASNS = new Set(["), w.indexOf("]);", w.indexOf("const CLOUD_ASNS"))).matchAll(/\b(\d{3,6})\b/g)].map((m) => +m[1]);
  assert.deepEqual(listed.slice().sort((a, b) => a - b), clouds.slice().sort((a, b) => a - b));
  for (const [asn, org] of [[64500, "Example Hosting LLC"], [64501, "Acme Cloud Services"], [64502, "Big Data Center Inc"],
    [64503, "Nordic Datacentre AB"], [64504, "ServerMania Inc."], [64505, "Servers.com, Inc."], [64506, "Midwest Colocation LLC"],
    [64507, "Cheap VPS Ltd"], [64508, "Colo Partners"]]) {
    const { j } = await ask({ asn, asOrganization: org });
    assert.deepEqual(j, { ok: false }, org);
  }
  // no network data at all: not vouched for
  for (const cf of [undefined, {}, { asn: 0 }, { asn: "x" }]) {
    const { j } = await ask(cf);
    assert.deepEqual(j, { ok: false }, JSON.stringify(cf));
  }
});

test("worker /ga-ok: private cache for an hour, agsist.com only, nothing kept", async () => {
  const { r } = await ask({ asn: 7922, asOrganization: "Comcast" });
  assert.equal(r.headers.get("Cache-Control"), "private, max-age=3600");
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://agsist.com");
  assert.equal(r.headers.get("Content-Type"), "application/json");
  const www = await ask({ asn: 7922 }, "https://www.agsist.com");
  assert.equal(www.r.headers.get("Access-Control-Allow-Origin"), "https://www.agsist.com");
  const other = await ask({ asn: 7922 }, "https://evil.example");
  assert.equal(other.r.headers.get("Access-Control-Allow-Origin"), "https://agsist.com", "another site cannot read the answer");
  const post = await ask({ asn: 7922 }, "https://agsist.com", "POST");
  assert.equal(post.r.status, 404, "GET only");
  // the route reads the network, never the address, and logs nothing
  const w = read("workers/subs-worker.js");
  const route = w.slice(w.indexOf('if (path === "/ga-ok"'), w.indexOf("// v5.13: origin and content type"));
  const fn = w.slice(w.indexOf("function gaOk(cf)"), w.indexOf("const EMAIL_RE"));
  for (const part of [route, fn]) {
    assert.doesNotMatch(part, /CF-Connecting-IP|X-Forwarded-For|console\.|SUBS\.put|clientIp/i);
  }
  assert.ok(w.includes(" * v5.33 (2026-10-20): GA GATE."), "the worker header names the change");
});

// ---------------------------------------------------------------- 3. in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const SHOTS = process.env.GA_GATE_SHOTS || "";

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index";
    if (!path.extname(p)) p += ".html";
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

// answer: the worker's JSON, "fail" (500), or "hang" (never answers)
async function visit(browser, port, page, width, answer, act) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
  const pg = await ctx.newPage();
  const seen = { gate: 0, worker: 0, gtag: 0 };
  await pg.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith("http://127.0.0.1:" + port)) { if (u.includes("/components/ga-gate.js")) seen.gate++; return route.continue(); }
    if (u.startsWith(API)) {
      seen.worker++;
      if (answer === "hang") return;   // never answers
      if (answer === "fail") return route.fulfill({ status: 500, body: "x" });
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:" + port }, body: JSON.stringify(answer) });
    }
    if (u.includes("googletagmanager.com/gtag/js")) { seen.gtag++; return route.fulfill({ status: 200, contentType: "text/javascript", body: "window.__gtagLoaded=1;" }); }
    return route.abort();
  });
  // the guard drops automated browsers; this test is about the gate, so look like a reader
  await pg.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => false }); });
  await pg.goto(`http://127.0.0.1:${port}${page}`, { waitUntil: "load" });
  await pg.waitForTimeout(300);
  const before = { ...seen };
  if (act) {
    if (act === "scroll") await pg.mouse.wheel(0, 400);
    else await pg.mouse.click(5, 300);
    await pg.waitForTimeout(answer === "hang" ? 3400 : 600);
  }
  const loaded = await pg.evaluate(() => window.__gtagLoaded === 1);
  const kept = await pg.evaluate(() => { try { return sessionStorage.getItem("agsist-ga-ok"); } catch (e) { return "x"; } });
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, `${page.replace(/\W+/g, "_")}-${width}-${act || "idle"}-${typeof answer === "object" ? "ok" + answer.ok : answer}.png`) }); }
  await ctx.close();
  return { before, seen, loaded, kept };
}

test("in a browser: no GA before the reader acts; after an act, GA unless the worker says no", { skip, timeout: 120000 }, async () => {
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--user-agent=" + UA] });
  const srv = await serve();
  const port = srv.address().port;
  try {
    for (const page of ["/grain-emc", "/privacy", "/arc-plc/iowa"]) {
      for (const width of [390, 1280]) {
        const idle = await visit(browser, port, page, width, { ok: true }, "");
        assert.deepEqual(idle.seen, { gate: 0, worker: 0, gtag: 0 }, `${page} ${width}: something loaded with no act`);
        const ok = await visit(browser, port, page, width, { ok: true }, width === 390 ? "tap" : "scroll");
        assert.deepEqual(ok.before, { gate: 0, worker: 0, gtag: 0 }, `${page} ${width}: loaded before the act`);
        assert.equal(ok.seen.gate, 1, `${page} ${width}: gate`);
        assert.equal(ok.seen.worker, 1, `${page} ${width}: worker asked`);
        assert.equal(ok.seen.gtag, 1, `${page} ${width}: gtag.js`);
        assert.ok(ok.loaded);
        assert.equal(ok.kept, "1");
      }
    }
    for (const answer of [{ ok: false }, "fail", "hang"]) {
      const r = await visit(browser, port, "/grain-emc", 1280, answer, "tap");
      assert.equal(r.seen.worker, 1, JSON.stringify(answer));
      // Oct 21: only a clear no keeps GA off; a failed or hung worker loads it
      assert.equal(r.seen.gtag, answer === "fail" || answer === "hang" ? 1 : 0, `GA on ${JSON.stringify(answer)}`);
      assert.equal(r.kept, answer === "fail" || answer === "hang" ? null : "0");
    }
  } finally {
    await browser.close();
    srv.close();
  }
});
