/* The backup form (Formspree) only from the live site (Nov 9 2026, BUILD-RULES 58).
 *
 * On Oct 30 a local copy on 127.0.0.1 sent a made-up Rain Print order to the real backup form:
 * the worker refuses a local Origin with 403, and form-post.js treated that 403 like a missing
 * route and posted to Formspree. Now nothing goes there unless location.hostname is agsist.com
 * or www.agsist.com; anywhere else the post rejects ('not sent'), an outbox keeps the item and
 * the page says nothing was sent.
 *
 *   - form-post.js with a stubbed location: off the live host, no fetch to formspree.io from
 *     agsistFormPost, agsistFormPost.formspree or a slow worker; on it, the fallback still fires.
 *   - loader.js signup fallback: off the live host the worker's answer goes back to the page.
 *   - the guard: every served file that names formspree.io carries the live-host check.
 *
 *   node --test test/formspree-host-guard.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const W = "https://agsist-api.dnilgis.workers.dev";
const BLOCK = "<!DOCTYPE html><html><head><title>Suspected phishing site | Cloudflare</title></head><body></body></html>";
const isFs = (u) => /^https?:\/\/([^/]+\.)?formspree\.io\//i.test(String(u));

// form-post.js in a sandbox on `hostname`; the worker answers 403 like a refused Origin
function formPost(hostname, worker = async () => ({ status: 403, ok: false, json: async () => { throw new SyntaxError("<"); } }), extra = {}) {
  const calls = [];
  const ctx = {
    AbortController, FormData, JSON, Promise, Object, Error, setTimeout, clearTimeout,
    location: { hostname, href: "http://" + hostname + "/rain-print" },
    fetch(url, opts) {
      calls.push(String(url));
      if (isFs(url)) return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      return worker(url, opts);
    },
    ...extra,
  };
  ctx.window = ctx;
  vm.runInNewContext(read("components/form-post.js"), ctx);
  return { post: ctx.agsistFormPost, calls, ctx };
}

for (const host of ["127.0.0.1", "localhost", "agsist.github.io", "dnilgis.github.io", "agsist.com.example.net", "evil-agsist.com"]) {
  test(`form-post.js on ${host}: a 403 from the worker sends nothing to formspree.io and rejects as not sent`, async () => {
    const F = formPost(host);
    assert.equal(F.post.liveHost(), false);
    await assert.rejects(F.post("rain-print-order", { name: "Test" }, { _subject: "x" }), (e) => e.message === "not sent" && e.offsite === true);
    await assert.rejects(F.post.formspree({ _subject: "Rain Print order record" }), /not sent/);
    assert.deepEqual(F.calls, [W + "/form"], "the worker only, never formspree.io");
  });
}

test("form-post.js on 127.0.0.1: a silent worker (12 s) still sends nothing to formspree.io", async () => {
  const timers = [];
  const F = formPost("127.0.0.1", () => new Promise(() => {}), {
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
  });
  const p = F.post("elevator-claim", { a: 1 });
  await new Promise((r) => setImmediate(r));
  timers.find((x) => x.ms === 12000).fn();
  await assert.rejects(p, /not sent/);
  assert.ok(!F.calls.some(isFs), JSON.stringify(F.calls));
});

test("form-post.js on 127.0.0.1 with the outbox: a business list is kept, nothing to formspree.io", async () => {
  const kept = [];
  const F = formPost("127.0.0.1", undefined, { AgOutbox: { add: (x) => { kept.push(x); return "id1"; } } });
  const r = await F.post("rain-print-business", { towns: "Chetek" });
  assert.equal(r.via, "outbox");
  assert.equal(kept.length, 1);
  assert.ok(!F.calls.some(isFs));
});

for (const host of ["agsist.com", "www.agsist.com", "AGSIST.COM"]) {
  test(`form-post.js on ${host}: the Formspree fallback still fires after a 403`, async () => {
    const F = formPost(host);
    assert.equal(F.post.liveHost(), true);
    assert.deepEqual({ ...(await F.post("rain-print-order", { name: "Test" })) }, { ok: true, via: "formspree" });
    assert.deepEqual({ ...(await F.post.formspree({ _subject: "x" })) }, { ok: true, via: "formspree" });
    assert.equal(F.calls.filter(isFs).length, 2);
  });
}

// loader.js signup fallback, cut out as test/signup-fallback.test.mjs does
function signupPage(hostname) {
  const L = read("components/loader.js");
  const i = L.indexOf("  (function signupFallback() {"), j = L.indexOf("  })();", i);
  assert.ok(i > 0 && j > i, "the signup fallback is in loader.js");
  const calls = [];
  const win = {
    fetch: (url) => { calls.push(String(url)); return Promise.resolve(isFs(url) ? new Response('{"ok":true}', { status: 200 }) : new Response(BLOCK, { status: 403 })); },
    location: { href: "http://" + hostname + "/cash-bids", hostname, pathname: "/cash-bids" },
    dispatchEvent() {}, CustomEvent: class {},
  };
  const ctx = { window: win, location: win.location, URL, URLSearchParams, FormData, Response, JSON, String, Object, setTimeout: () => 0,
    CustomEvent: win.CustomEvent, localStorage: { getItem: () => null },
    document: { getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }), body: { appendChild() {} }, querySelector: () => null } };
  vm.createContext(ctx);
  vm.runInContext(L.slice(i, j + "  })();".length), ctx);
  return { fetch: (...a) => win.fetch(...a), calls };
}
const signup = (f) => f(W + "/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "a@example.com", zip: "54728" }) });

test("loader.js signup fallback on 127.0.0.1: the worker's 403 goes back to the page, nothing to formspree.io", async () => {
  const P = signupPage("127.0.0.1");
  const r = await signup(P.fetch);
  assert.equal(r.status, 403);
  assert.deepEqual(P.calls, [W + "/subscribe"]);
});

test("loader.js signup fallback on agsist.com: the 403 still goes on to the backup form", async () => {
  const P = signupPage("agsist.com");
  const r = await signup(P.fetch);
  assert.equal(r.status, 200);
  assert.equal(P.calls.filter(isFs).length, 1);
});

/* The guard: a served file that names formspree.io (a fetch, a form action, a URL built in code)
   must carry the live-host check, or post through components/form-post.js instead. Tests and the
   Python checks are not served. A new copy fails here until it is guarded. */
const CHECK = [/\bliveHost\(\)/, /\^\(www\\\.\)\?agsist\\\.com\$/];
test("every served file that posts to formspree.io checks for the live host first", () => {
  const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n")
    .filter((f) => f && !/^(test|notes)\//.test(f) && !/^scripts\/(test_|dev\/)/.test(f) && /\.(m?js|html?|py|json|txt|xml)$/.test(f));
  const named = [];
  for (const f of files) {
    let s = "";
    try { s = read(f); } catch (e) { continue; }
    if (!/formspree\s*\.\s*io|formspree\.io|xnjbwepn/i.test(s)) continue;
    named.push(f);
    assert.ok(CHECK.some((re) => re.test(s)), `${f} names formspree.io without the agsist.com host check (BUILD-RULES 58): post through components/form-post.js or guard it`);
  }
  // the copies counted on Nov 9 2026; a new one has to pass the check above
  assert.ok(named.includes("components/form-post.js") && named.includes("components/loader.js"), named.join(", "));
  // and the check in form-post.js sits in front of the one fetch to Formspree
  const fp = read("components/form-post.js");
  const at = fp.indexOf("function toFormspree("), guard = fp.indexOf("if (!liveHost())", at), send = fp.indexOf("fetch(FORMSPREE", at);
  assert.ok(at > 0 && guard > at && send > guard, "toFormspree checks the host before it fetches");
  assert.equal((fp.match(/fetch\(FORMSPREE/g) || []).length, 1, "one fetch to Formspree in form-post.js");
  const ld = read("components/loader.js");
  assert.equal((ld.match(/FORMSPREE,/g) || []).length, 1, "one fetch to Formspree in loader.js");
  assert.match(ld, /function routeOf\(u\) \{[^}]*\^\(www\\\.\)\?agsist\\\.com\$/, "loader.js only routes a signup to its fallback on the live host");
});
