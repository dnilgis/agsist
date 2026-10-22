/* No signup is lost when the subs worker is blocked (Oct 22, 2026).
 * Oct 21: Cloudflare answered agsist-subs.dnilgis.workers.dev with its
 * phishing page and no CORS, so the browser refused every signup answer.
 * components/loader.js wraps fetch for the signup routes only:
 *   1. the browser refuses the answer (no CORS) -> the signup goes to the
 *      backup form (Formspree) with its list, ZIP and source; the page gets
 *      {ok:true, queued:true, message:"Got it. You'll be added within a day."}
 *   2. a 403 HTML block page -> the same
 *   3. the worker's own JSON refusal (a bad address) reaches the page as it is
 *   4. other requests (GETs, other hosts, other routes) are never touched
 *   5. the backup form failing too -> the page sees the original failure
 *   6. signup-ask.js shows the queued line in place of its own "check your
 *      email" text; no address in any URL
 *
 *   node --test test/signup-fallback.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const LOADER = read("components/loader.js");
const W = "https://agsist-subs.dnilgis.workers.dev";
const FS = "https://formspree.io/f/xnjbwepn";

function wrapper() {
  const i = LOADER.indexOf("  (function signupFallback() {");
  const j = LOADER.indexOf("  })();", i);
  assert.ok(i > 0 && j > i, "the signup fallback is in loader.js");
  return LOADER.slice(i, j + "  })();".length);
}

function page(worker, formspree = () => new Response(JSON.stringify({ ok: true }), { status: 200 })) {
  const calls = [], events = [], body = { kids: [], appendChild(el) { this.kids.push(el); } };
  const realFetch = (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith(FS)) return Promise.resolve(formspree(init));
    if (String(url).startsWith(W)) return worker(url, init);
    return Promise.resolve(new Response("ok", { status: 200 }));
  };
  const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {}, parentNode: null });
  const win = {
    fetch: realFetch, location: { href: "https://agsist.com/cash-bids", pathname: "/cash-bids" },
    dispatchEvent: (e) => events.push(e.type), CustomEvent: class { constructor(t, d) { this.type = t; this.detail = d && d.detail; } },
  };
  const ctx = {
    window: win, location: win.location, URL, URLSearchParams, FormData, Response, JSON, String, Object, setTimeout: () => 0,
    CustomEvent: win.CustomEvent,
    document: { getElementById: () => null, createElement: el, body },
  };
  vm.createContext(ctx);
  vm.runInContext(wrapper(), ctx);
  return { fetch: (...a) => win.fetch(...a), calls, events, body, win };
}

const signup = (f, route = "/subscribe", body = { email: "a@farm.com", zip: "54728", source: "footer" }) =>
  f(W + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("no CORS answer: kept on the backup form with its list and ZIP, the page told plainly", async () => {
  const p = page(() => Promise.reject(new TypeError("Failed to fetch")));
  const r = await signup(p.fetch);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(j, { ok: true, queued: true, message: "Got it. You'll be added within a day." });
  const fs_ = p.calls.find((c) => c.url === FS);
  assert.ok(fs_, "posted to the backup form");
  const fd = fs_.init.body;
  assert.equal(fd.get("email"), "a@farm.com");
  assert.equal(fd.get("zip"), "54728");
  assert.equal(fd.get("list"), "AGSIST Daily");
  assert.match(fd.get("_subject"), /^AGSIST signup \(worker down\): AGSIST Daily$/);
  assert.match(fd.get("note"), /mail nothing/);
  assert.ok(p.calls.every((c) => !/%40|@/.test(c.url)), "no address in any URL");
  assert.ok(p.events.includes("agsist:signup-queued"));
  assert.ok(p.body.kids.length === 1, "the queued line is shown");
});

test("the 403 block page: kept, with the alert's own fields and topic", async () => {
  const p = page(() => Promise.resolve(new Response("<!DOCTYPE html><title>Suspected phishing</title>", { status: 403 })));
  const r = await signup(p.fetch, "/notice", { email: "b@farm.com", topic: "rent:ia", source: "rent", daily: false });
  assert.equal((await r.json()).queued, true);
  const fd = p.calls.find((c) => c.url === FS).init.body;
  assert.equal(fd.get("list"), "notice (rent:ia)");
  assert.equal(fd.get("details"), JSON.stringify({ daily: false }));
  const p2 = page(() => Promise.resolve(new Response("<html>blocked</html>", { status: 403 })));
  const r2 = await signup(p2.fetch, "/elevator-watch-subscribe", { email: "c@farm.com", zip: "54728", wid: "1fa85c8e" });
  assert.equal((await r2.json()).queued, true);
  assert.equal(p2.calls.find((c) => c.url === FS).init.body.get("list"), "elevator alert");
});

test("the worker's own JSON refusal reaches the page unchanged", async () => {
  const p = page(() => Promise.resolve(new Response(JSON.stringify({ ok: false, error: "bad email" }), { status: 400 })));
  const r = await signup(p.fetch);
  assert.equal(r.status, 400);
  assert.ok(!p.calls.some((c) => c.url === FS));
  const p2 = page(() => Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 403 })));
  assert.equal((await signup(p2.fetch)).status, 403);
  assert.ok(!p2.calls.some((c) => c.url === FS), "a JSON 403 is the worker itself, not the block page");
  const p3 = page(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
  assert.deepEqual(await (await signup(p3.fetch)).json(), { ok: true });
});

test("nothing else is touched", async () => {
  const p = page(() => Promise.reject(new TypeError("Failed to fetch")));
  await assert.rejects(p.fetch(W + "/subscribe"), TypeError, "a GET is not a signup");
  await assert.rejects(p.fetch(W + "/form", { method: "POST", body: "{}" }), TypeError, "forms keep form-post.js's own fallback");
  await p.fetch("https://agsist.com/data/x.json");
  assert.ok(!p.calls.some((c) => c.url === FS));
});

test("the backup form failing too: the page sees the original failure", async () => {
  const p = page(() => Promise.reject(new TypeError("Failed to fetch")), () => new Response("no", { status: 500 }));
  await assert.rejects(signup(p.fetch), TypeError);
  const p2 = page(() => Promise.resolve(new Response("<html></html>", { status: 403 })), () => new Response("{}", { status: 422 }));
  assert.equal((await signup(p2.fetch)).status, 403);
});

test("signup-ask.js shows the queued line in place of its own text, cache versions bumped", () => {
  const sa = read("components/signup-ask.js");
  assert.ok(sa.includes("esc(queued(res) || OK"), "the ask shows the queued line");
  assert.ok(sa.includes("res.data.queued === true"));
  assert.ok(LOADER.includes("s.src = '/components/signup-ask.js?v=13';"));
  assert.ok(/var CACHE_VERSION = (\d+);/.exec(read("sw.js"))[1] >= 220);
  assert.ok(!/—/.test(wrapper()), "no em dash");
});
