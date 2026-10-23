/* The site's form poster (components/form-post.js) and the service worker's
 * never-cache list (sw.js), 2026-10-14.
 *
 *   node --test test/rp-forms-sw.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

// form-post.js in a sandbox: fetch and setTimeout are ours, so a hung worker
// and the 12 second limit can be run without waiting.
function formPost(workerFetch) {
  const timers = [], calls = [];
  const ctx = {
    AbortController, FormData, JSON, Promise, Object, Error,
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cleared = true; },
    fetch(url, opts) {
      calls.push(url);
      if (url.includes("formspree")) return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      return workerFetch(opts);
    },
  };
  ctx.window = ctx;
  vm.runInNewContext(read("components/form-post.js"), ctx);
  return { post: ctx.agsistFormPost, timers, calls };
}
const hung = (opts) => new Promise((_, reject) => {
  if (opts && opts.signal) opts.signal.addEventListener("abort", () => reject(new Error("aborted")));
});
const within = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("still waiting after " + ms + " ms")), ms))]);

test("form-post.js: a worker that never answers gives up after 12 s and the post goes to Formspree", async () => {
  const F = formPost(hung);
  const p = F.post("rain-print-order", { name: "Kate" });
  await new Promise((r) => setImmediate(r));
  const t = F.timers.find((x) => x.ms === 12000);
  assert.ok(t, "a 12 second timer is set on the worker post");
  t.fn();
  const res = await within(p, 1000);
  assert.deepEqual({ ...res }, { ok: true, via: "formspree" });
  assert.equal(F.calls.length, 2);
  assert.match(F.calls[1], /formspree\.io/);
});

test("form-post.js: worker() alone answers 'fallback' when the worker hangs", async () => {
  const F = formPost(hung);
  const p = F.post.worker("elevator-claim", { a: 1 });
  await new Promise((r) => setImmediate(r));
  F.timers.find((x) => x.ms === 12000).fn();
  assert.equal(await within(p, 1000), "fallback");
});

test("form-post.js: a worker that answers in time clears the timer and is not sent again", async () => {
  const F = formPost(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
  const res = await within(F.post("rain-print-order", { name: "Kate" }), 1000);
  assert.deepEqual({ ...res }, { ok: true, via: "worker" });
  await new Promise((r) => setImmediate(r));
  assert.ok(F.timers.every((x) => x.cleared), "the 12 second timer is cleared");
  assert.equal(F.calls.length, 1);
});

test("form-post.js: a refusal the worker means still reaches the page", async () => {
  const F = formPost(async () => ({ ok: false, status: 429, json: async () => ({ error: "too many" }) }));
  await assert.rejects(within(F.post("rain-print-order", {}), 1000), /refused/);
  assert.equal(F.calls.length, 1, "no Formspree on a refusal");
});

test("form-post.js ?v is bumped together on every page that loads it", () => {
  const pages = ["list-your-elevator.html", "sponsor-report.html", "farmland-atlas.html", "prf-sponsor.html"];   // the claim form joined list-your-elevator (Oct 22, 2026)
  const vs = pages.map((p) => (read(p).match(/\/components\/form-post\.js\?v=(\d+)"/) || [])[1]);
  for (let i = 0; i < pages.length; i++) assert.ok(vs[i], pages[i] + " loads form-post.js with a ?v");
  assert.ok(vs.every((v) => Number(v) >= 3), "the 12 second timeout reaches readers past cached copies: " + vs.join(","));
});

// sw.js in a sandbox, to run its own fetch router.
function serviceWorker() {
  const seen = { fetch: [], cache: 0 };
  const ctx = {
    self: { addEventListener() {}, skipWaiting() {}, clients: { claim() {} } },
    caches: new Proxy({}, { get() { seen.cache++; return () => Promise.resolve(undefined); } }),
    fetch(req) { seen.fetch.push(req.url || req); return Promise.resolve({ ok: true, clone() { return this; } }); },
    Promise, URL, Response: function () {}, setTimeout, clearTimeout, console,
  };
  vm.runInNewContext(read("sw.js"), ctx);
  return { ctx, seen };
}

test("sw.js: NOAA daily data for Rain Print goes straight to the network, never into the cache", async () => {
  const { ctx, seen } = serviceWorker();
  const req = { url: "https://data.rcc-acis.org/StnData?sid=471667&sdate=por&edate=2025-12-31", method: "POST", headers: { get: () => "application/json" } };
  await ctx.handleFetch(req, { waitUntil() {} });
  assert.deepEqual(seen.fetch, [req.url]);
  assert.equal(seen.cache, 0, "Cache Storage is never opened for an ACIS call");
  assert.ok(vm.runInNewContext("NEVER_CACHE", ctx).includes("data.rcc-acis.org"));
});

test("sw.js: CACHE_VERSION carries a dated note for this change", () => {
  const s = read("sw.js");
  const m = s.match(/var CACHE_VERSION = (\d+);\s*\/\/ v(\d+) (\d{4}-\d{2}-\d{2}): ([^;]*)/);
  assert.ok(m, "CACHE_VERSION has a note");
  assert.equal(m[1], m[2], "the note starts with the version it describes");
  assert.ok(Number(m[1]) >= 64);
});

test("form-post.js (panel 3 F11): the Formspree copy after a slow worker says it may repeat, and a hung Formspree gives up after 15 s", async () => {
  const sent = [];
  const timers = [];
  const ctx = {
    AbortController, JSON, Promise, Object, Error,
    FormData: class { constructor() { this.f = []; } append(k, v) { this.f.push([k, v]); } },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cleared = true; },
    fetch(url, opts) {
      if (url.includes("formspree")) { sent.push(opts.body.f); return hung(opts); }
      return hung(opts);
    },
  };
  ctx.window = ctx;
  vm.runInNewContext(read("components/form-post.js"), ctx);
  const p = ctx.agsistFormPost("rain-print-order", { name: "Kate" }, { _subject: "Rain Print order", name: "Kate" });
  await new Promise((r) => setImmediate(r));
  timers.find((x) => x.ms === 12000).fn();
  await new Promise((r) => setImmediate(r));
  assert.ok(sent[0].some(([k, v]) => k === "_subject" && v === "Rain Print order (sent after the site form was slow; may repeat)"), JSON.stringify(sent[0]));
  const t = timers.find((x) => x.ms === 15000);
  assert.ok(t, "a 15 second timer on the Formspree post");
  t.fn();
  await assert.rejects(within(p, 1000), /not sent/);
});

// 2026-10-19 (Sig, monetization board seat C): a business quote carries the customer list, and the page says
// "your list stays with me". It goes to the AGSIST worker or nowhere: never to Formspree.
test("form-post.js: a business quote (customer list) never goes to Formspree on any worker failure", async () => {
  const failures = {
    "404": async () => ({ ok: false, status: 404, json: async () => ({}) }),
    "503": async () => ({ ok: false, status: 503, json: async () => ({}) }),
    "unknown form": async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: "unknown form" }) }),
    "200 without ok": async () => ({ ok: true, status: 200, json: async () => ({}) }),
    "network": async () => { throw new Error("offline"); },
  };
  for (const [why, f] of Object.entries(failures)) {
    const F = formPost(f);
    const err = await within(F.post("rain-print-business", { towns: "The Olson Farm, Chetek, WI 2025" }, { towns: "x" }), 1000).then(() => null, (e) => e);
    assert.ok(err, why + ": rejects");
    assert.equal(err.workerOnly, true, why);
    assert.equal(err.slow, false, why);
    assert.ok(!F.calls.some((u) => /formspree/.test(u)), why + ": nothing to Formspree");
  }
  // a silent worker: rejects after 12 s with slow set, still no Formspree
  const F = formPost(hung);
  const p = F.post("rain-print-business", { towns: "Chetek, WI 2025" }).then(() => null, (e) => e);
  await new Promise((r) => setImmediate(r));
  F.timers.find((x) => x.ms === 12000).fn();
  const err = await within(p, 1000);
  assert.equal(err && err.slow, true);
  assert.ok(!F.calls.some((u) => /formspree/.test(u)));
  // the worker taking it is still a send
  const ok = formPost(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
  assert.deepEqual({ ...(await ok.post("rain-print-business", { towns: "x" })) }, { ok: true, via: "worker" });
});

test("form-post.js: every other caller's kind keeps the Formspree fallback", async () => {
  const kinds = ["rain-print-order", "claim", "sponsor-feedback", "elevator-listing", "prf-sponsor", "atlas-feedback"];
  for (const k of kinds) {
    const F = formPost(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    assert.deepEqual({ ...(await within(F.post(k, { a: 1 }), 1000)) }, { ok: true, via: "formspree" }, k);
  }
  const only = Object.keys(formPost(async () => ({})).post.WORKER_ONLY);
  assert.deepEqual(only, ["rain-print-business"], "only the list-carrying kind is worker-only");
  // every kind a page posts through form-post.js: only rain-print-business carries a customer list
  const callers = ["components/prf-sponsor-page.js", "components/list-elevator.js", "components/rp-business.js", "components/rain-print.js", "components/elevator-claim.js", "sponsor-report.html"];
  const posted = new Set();
  for (const c of callers) for (const m of read(c).matchAll(/send\('([a-z-]+)'/g)) posted.add(m[1]);
  assert.ok(posted.has("rain-print-business") && posted.has("rain-print-order"), [...posted].join(","));
});

test("rp-business.js: a failed or silent send keeps the form filled and says to call or try again", () => {
  const js = read("components/rp-business.js");
  const fail = js.slice(js.indexOf("}).catch(function (err) {"), js.indexOf("}).then(function () { sending = false;"));
  assert.ok(fail.length > 100, "the failure branch");
  assert.match(fail, /That didn’t send\./);
  assert.match(fail, /' Call or text <a href="tel:\+17157972428">' \+ PHONE \+ '<\/a>, or try again\.<\/b>/);
  assert.match(js, /var PHONE = '715-797-2428';/);
  assert.doesNotMatch(fail, /reset\(\)/, "the list stays in the page");
  assert.doesNotMatch(js, /formspree\.io/i, "the business page never posts to Formspree itself");
  const html = read("rain-print-business.html");
  assert.match(html, /<b>Your list stays with me\.<\/b>/);
  assert.match(html, /\/components\/form-post\.js\?v=([5-9]|\d\d)"/, "the worker-only rule reaches readers past cached copies");
});
