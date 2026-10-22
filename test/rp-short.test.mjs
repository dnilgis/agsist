/* Rain Print short links (2026-10-12): the QR size they buy, the /R page, the
 * client (components/rp-short.js) and that the worker (v5.14, POST /rp-short)
 * takes every code the page makes.
 *
 * Runs the shipped files: components/qr.js, components/rain-print.js and
 * components/rp-short.js in a bare vm context, workers/subs-worker.js against
 * an in-memory KV.
 *
 *   node --test test/rp-short.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, copyFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctx.window = ctx;
vm.runInNewContext(read("components/qr.js"), ctx);
vm.runInNewContext(read("components/rain-print.js"), ctx);
const QR = ctx.AgQR, RP = ctx.RainPrint;

// Worst-case ids: the widest Crockford letters make no difference in byte mode,
// so any id of a given length gives the same version.
const link = (n) => "HTTPS://AGSIST.COM/R?" + "W".repeat(n);

test("a 5-letter short link is QR version 2: 25 x 25 modules", () => {
  assert.equal(link(5).length, 26);
  assert.equal(QR.matrix(link(5)).length, 25);
});

test("module counts by id length (6, 7 and 8 come only after a collision)", () => {
  const counts = Object.fromEntries([5, 6, 7, 8].map((n) => [n, QR.matrix(link(n)).length]));
  // 26 bytes is the most version 2 at level M holds; one more letter is version 3.
  assert.deepEqual(counts, { 5: 25, 6: 29, 7: 29, 8: 29 });
});

test("the short link is much smaller than the long link it replaces", () => {
  const FULL = {
    place: "Chetek, WI", station: "471667 2", year: 2025, layout: "staircase", palette: "night", size: "12x18",
    cmp: "normal", name: "The Olson Farm",
    markers: [{ date: "2025-05-12", label: "Planted" }, { date: "2025-07-04", label: "Wedding" }, { date: "2025-10-20", label: "Harvest done" }],
  };
  const long = QR.matrix(RP.shortUrl(FULL)).length;
  assert.ok(long >= 41, "long link " + long);
  assert.ok(QR.matrix(link(5)).length < long);
});

test("R.html and r.html are the same page, noindex, with no canonical", () => {
  const R = read("R.html"), r = read("r.html");
  assert.equal(R, r, "keep R.html and r.html byte-identical");
  assert.match(R, /<meta name="robots" content="noindex, nofollow">/);
  assert.doesNotMatch(R, /rel="canonical"/);
  assert.match(R, /agsist-api\.dnilgis\.workers\.dev\/rp-short\//);
  assert.match(R, /location\.replace\('\/rain-print\?d=' \+ code\)/);
  assert.match(R, /href="\/rain-print"/);
  assert.doesNotMatch(read("sitemap.xml"), /agsist\.com\/[Rr](<|\?)/);
});

// ---------- the client ----------
function client({ fetchImpl, storage } = {}) {
  const c = { setTimeout, clearTimeout, Promise, JSON };
  c.window = c;
  if (fetchImpl) c.fetch = fetchImpl;
  if (storage !== undefined) c.localStorage = storage;
  vm.runInNewContext(read("components/rp-short.js"), c);
  return c;
}
const memStore = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const CODE = "MXxDaGV0ZWsgV0l8MTIzfDIwMjV8c3AwYXw";

test("getShortLink: posts once, caches in memory and localStorage", async () => {
  const calls = [], st = memStore();
  const c = client({ storage: st, fetchImpl: async (u, o) => { calls.push([u, JSON.parse(o.body)]); return { ok: true, json: async () => ({ ok: true, id: "AB12C" }) }; } });
  assert.equal(c.AgRpShort.peek(CODE), null);
  assert.equal(await c.AgRpShort.getShortLink(CODE), "HTTPS://AGSIST.COM/R?AB12C");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "https://agsist-api.dnilgis.workers.dev/rp-short");
  assert.deepEqual(calls[0][1], { code: CODE });
  assert.equal(await c.AgRpShort.getShortLink(CODE), "HTTPS://AGSIST.COM/R?AB12C");
  assert.equal(calls.length, 1, "memory cache");
  assert.equal(st.m.get("agsist-rps:" + CODE), "AB12C");
  // a fresh page load reads localStorage and asks nothing
  const c2 = client({ storage: st, fetchImpl: async () => { throw new Error("should not fetch"); } });
  assert.equal(c2.AgRpShort.peek(CODE), "HTTPS://AGSIST.COM/R?AB12C");
  assert.equal(await c2.AgRpShort.getShortLink(CODE), "HTTPS://AGSIST.COM/R?AB12C");
});

test("getShortLink: null on every failure, so the caller keeps the long link", async () => {
  const bad = [
    async () => ({ ok: false, json: async () => ({}) }),
    async () => { throw new Error("offline"); },
    async () => ({ ok: true, json: async () => ({ ok: true, id: "IL0U1" }) }),
    async () => ({ ok: true, json: async () => { throw new Error("not json"); } }),
  ];
  for (const f of bad) assert.equal(await client({ storage: memStore(), fetchImpl: f }).AgRpShort.getShortLink(CODE), null);
  assert.equal(await client({ storage: memStore() }).AgRpShort.getShortLink(CODE), null, "no fetch at all");
  const c = client({ storage: memStore(), fetchImpl: async () => { throw new Error("no"); } });
  assert.equal(await c.AgRpShort.getShortLink(""), null);
  assert.equal(await c.AgRpShort.getShortLink("GIFT-" + CODE), null);
  assert.equal(await c.AgRpShort.getShortLink("has spaces in it"), null);
});

test("resolve: an id back to its design code, as /r does, for ?d=RPS-<id>", async () => {
  const calls = [], st = memStore();
  const c = client({ storage: st, fetchImpl: async (u) => { calls.push(u); return u.endsWith("/AB12C") ? { ok: true, status: 200, json: async () => ({ ok: true, code: CODE }) } : { ok: false, status: 404, json: async () => ({}) }; } });
  assert.deepEqual(JSON.parse(JSON.stringify(await c.AgRpShort.resolve("AB12C"))), { code: CODE });
  assert.equal(calls[0], "https://agsist-api.dnilgis.workers.dev/rp-short/AB12C");
  assert.equal(c.AgRpShort.peek(CODE), "HTTPS://AGSIST.COM/R?AB12C", "the pair is kept, so the QR uses the same id");
  assert.deepEqual(JSON.parse(JSON.stringify(await c.AgRpShort.resolve("ZZ9Q8"))), { code: null, missing: true }, "an id the worker doesn't know");
  assert.equal((await c.AgRpShort.resolve("bad id")).code, null);
  assert.equal(calls.length, 2, "a malformed id asks nothing");
  assert.equal((await client({ storage: memStore(), fetchImpl: async () => { throw new Error("offline"); } }).AgRpShort.resolve("AB12C")).code, null);
  assert.equal((await client({ storage: memStore() }).AgRpShort.resolve("AB12C")).code, null, "no fetch at all");
});

test("getShortLink: storage that throws is only a missed cache", async () => {
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  let n = 0;
  const c = client({ storage: throwing, fetchImpl: async () => { n++; return { ok: true, json: async () => ({ id: "ZZ9Q8" }) }; } });
  assert.equal(c.AgRpShort.peek(CODE), null);
  assert.equal(await c.AgRpShort.getShortLink(CODE), "HTTPS://AGSIST.COM/R?ZZ9Q8");
  assert.equal(c.AgRpShort.peek(CODE), "HTTPS://AGSIST.COM/R?ZZ9Q8", "memory still holds it");
  assert.equal(n, 1);
  // a getter on window.localStorage that throws (some privacy modes)
  const c2 = { setTimeout, clearTimeout, Promise, JSON, fetch: async () => ({ ok: true, json: async () => ({ id: "ZZ9Q8" }) }) };
  c2.window = c2;
  Object.defineProperty(c2, "localStorage", { get() { throw new Error("SecurityError"); } });
  vm.runInNewContext(read("components/rp-short.js"), c2);
  assert.equal(await c2.AgRpShort.getShortLink(CODE), "HTTPS://AGSIST.COM/R?ZZ9Q8");
});

test("getShortLink: a newer code while one waits replaces it (one request per pause)", async () => {
  const sent = [];
  const c = client({ storage: memStore(), fetchImpl: async (u, o) => { const code = JSON.parse(o.body).code; sent.push(code); return { ok: true, json: async () => ({ id: "AAAA" + sent.length }) }; } });
  const p1 = c.AgRpShort.getShortLink(CODE + "a"), p2 = c.AgRpShort.getShortLink(CODE + "b"), p3 = c.AgRpShort.getShortLink(CODE + "b");
  assert.equal(await p1, null);
  assert.equal(await p2, "HTTPS://AGSIST.COM/R?AAAA1");
  assert.equal(await p3, "HTTPS://AGSIST.COM/R?AAAA1");
  assert.deepEqual(sent, [CODE + "b"]);
});

// ---------- the worker takes what the page makes ----------
test("the worker accepts every code rain-print.js encodes, at the page's limits", async () => {
  const tmp = path.join(os.tmpdir(), "rp-short-test-" + process.pid + ".mjs");
  copyFileSync(ROOT + "workers/subs-worker.js", tmp);
  const w = (await import(pathToFileURL(tmp).href)).default;
  unlinkSync(tmp);
  const store = new Map();
  const env = { UNSUB_SECRET: "s", SUBS: { async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); } } };
  const L = RP.LIMITS;
  const designs = [
    { place: "Chetek, WI", year: 2025 },
    { place: "Lac qui Parle, MN", station: "214546 2", year: 2024, layout: "waveform", palette: "blueprint", cmp: "station", name: "Ø".repeat(L.name) },
    { place: "X".repeat(L.place), station: "999999 9", year: 1893, palette: "paper", name: "N".repeat(L.name),
      markers: [{ date: "1893-01-01", label: "L".repeat(L.label) }, { date: "1893-06-30", label: "é".repeat(L.label) }, { date: "1893-12-31", label: "Z".repeat(L.label) }] },
    // five marked days (2026-10-15), every box full
    { place: "Y".repeat(L.place), station: "999999 9", year: 2024, style: "r2", cmp: "station", normals: true, records: true, name: "N".repeat(L.name), dedication: "D".repeat(L.dedication),
      markers: ["01-01", "03-31", "06-30", "09-30", "12-31"].map((d) => ({ date: "2024-" + d, label: "L".repeat(L.label) })) },
  ];
  for (const d of designs) {
    const code = RP.encodeCode(d);
    assert.ok(code && RP.decodeCode(code), "page round-trips " + d.place);
    assert.equal(RP.decodeCode(code).markers.length, (d.markers || []).length, "every marked day rides along");
    const r = await w.fetch(new Request("https://x.dev/rp-short", { method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://agsist.com" }, body: JSON.stringify({ code }) }), env);
    const j = await r.json();
    assert.equal(r.status, 200, d.place + " " + JSON.stringify(j));
    assert.equal(QR.matrix("HTTPS://AGSIST.COM/R?" + j.id).length, 25);
    const g = await w.fetch(new Request("https://x.dev/rp-short/" + j.id), env);
    assert.equal((await g.json()).code, code);
  }
});

// ---------- the /R page's own script ----------
async function runR(search, fetchImpl) {
  const html = read("R.html");
  const js = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const els = { msg: { textContent: "" }, sub: { textContent: "" }, box: { className: "" } };
  const out = { replaced: null, asked: [], els };
  const c = {
    location: { search, replace(u) { out.replaced = u; } },
    document: { getElementById: (k) => els[k] },
    setTimeout, clearTimeout,
  };
  if (fetchImpl) c.fetch = async (u) => { out.asked.push(u); return fetchImpl(u); };
  vm.runInNewContext(js, c);
  await new Promise((r) => setTimeout(r, 20));
  return out;
}
const API = "https://agsist-api.dnilgis.workers.dev/rp-short/";
const okCode = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, code: CODE }) });

test("/R: every way the id can arrive opens the design", async () => {
  for (const s of ["?K7Q2M", "?k7q2m", "?id=K7Q2M", "?K7Q2M&fbclid=abc", "?utm_source=x&id=k7q2m", "?K7Q2M%20"]) {
    const o = await runR(s, okCode);
    assert.deepEqual(o.asked, [API + "K7Q2M"], s);
    assert.equal(o.replaced, "/rain-print?d=" + CODE, s);
    assert.equal(o.els.box.className, "", "no message shown " + s);
  }
  const o = await runR("?K7QLO", okCode);
  assert.deepEqual(o.asked, [API + "K7Q10"], "look-alike letters read as digits");
});

test("/R: an unknown, malformed or unreachable link says so and stays put", async () => {
  for (const s of ["", "?", "?ABCD", "?ABCDEFGHJ", "?K7Q2U", "?x=1"]) {
    const o = await runR(s, okCode);
    assert.deepEqual(o.asked, [], "no request for " + JSON.stringify(s));
    assert.equal(o.replaced, null);
    assert.equal(o.els.box.className, "now");
    assert.match(o.els.sub.textContent, /isn’t one the site knows/);
  }
  const cases = [
    [async () => ({ ok: false, status: 404, json: async () => ({}) }), /isn’t one the site knows/],
    [async () => ({ ok: false, status: 503, json: async () => ({}) }), /connection dropped/],
    [async () => ({ ok: false, status: 429, json: async () => ({}) }), /connection dropped/],
    [async () => { throw new Error("offline"); }, /connection dropped/],
    [async () => ({ ok: true, status: 200, json: async () => ({ ok: true, code: "javascript:alert(1)" }) }), /connection dropped/],
  ];
  for (const [f, re] of cases) {
    const o = await runR("?K7Q2M", f);
    assert.equal(o.replaced, null);
    assert.equal(o.els.box.className, "now");
    assert.match(o.els.sub.textContent, re);
  }
  const o = await runR("?K7Q2M");
  assert.equal(o.replaced, null, "no fetch at all");
  assert.match(o.els.sub.textContent, /connection dropped/);
});

test("panel 3 (2026-10-14): r.html offers Try again when the link service is busy; the client waits 3 s before making an id", () => {
  for (const f of ["r.html", "R.html"]) {
    const R = read(f);
    assert.match(R, /<a id="again" href="" hidden>Try again<\/a> <a href="\/rain-print">Go to Rain Print<\/a>/);
    assert.match(R, /if \(again && !unknown\) again\.hidden = false;/);
  }
  assert.equal(client().AgRpShort.WAIT_MS, 3000);
});
