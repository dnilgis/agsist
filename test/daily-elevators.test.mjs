/* A Daily reader's own elevators in AGSIST Daily (Sig, Oct 20, 2026).
 *
 *   - the worker routes, v5.42 (scripts/test_daily_elev_worker.mjs);
 *   - the email block and its rules, made-up readers and boards
 *     (scripts/test_daily_elevators.py);
 *   - the page: components/cb-myelev.js keeps the #dk= key, drops the
 *     fragment before anything reads the address, sends the saved list as
 *     ids the Python side makes the same way, and sends nothing without a key.
 *
 *   node --test test/daily-elevators.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

test("the worker routes (scripts/test_daily_elev_worker.mjs)", () => {
  const out = execFileSync(process.execPath, [ROOT + "scripts/test_daily_elev_worker.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(out, /daily-elev worker checks: \d+ passed/);
});

test("the email block (scripts/test_daily_elevators.py)", () => {
  const out = execFileSync("python3", [ROOT + "scripts/test_daily_elevators.py"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(out, /daily elevators: \d+ passed/);
});

function page(hash, stored) {
  const ls = new Map(Object.entries(stored || {}));
  const posts = [], replaced = [];
  const ctx = {
    console, setTimeout, clearTimeout, Promise, JSON, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    URLSearchParams,
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
    location: { hash, pathname: "/cash-bids", search: "?zip=54728" },
    history: { replaceState: (a, b, u) => { replaced.push(u); ctx.location.hash = ""; } },
    document: { readyState: "complete", addEventListener() {}, querySelectorAll: () => [], dispatchEvent() {}, querySelector: () => null },
    fetch: (url, o) => { posts.push({ url, body: o && o.body ? JSON.parse(o.body) : null }); return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, n: 1, ids: [] }) }); },
    addEventListener() {},
  };
  ctx.window = ctx;
  vm.runInNewContext(read("components/cb-myelev.js"), ctx);
  return { ctx, ls, posts, replaced, M: ctx.CBMyElev };
}

test("the page keeps the key, drops the fragment and sends the saved list as ids", async () => {
  const saved = JSON.stringify({ v: 1, items: [{ key: "Test Home Grain||Chetek|WI", name: "Test Home Grain", town: "Chetek", state: "WI" }] });
  const P = page("#dk=abcdefghjkmnpqrstvwxyz01", { "agsist-my-elevators": saved });
  assert.equal(P.ls.get("agsist-daily-key"), "abcdefghjkmnpqrstvwxyz01");
  assert.deepEqual(P.replaced, ["/cash-bids?zip=54728"], "the fragment is gone, the query kept");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(P.posts.length, 1);
  assert.equal(P.posts[0].url, "https://agsist-api.dnilgis.workers.dev/daily-elev/set");
  // the same id scripts/daily_elevators.py place_id() makes
  const py = execFileSync("python3", ["-c", "import sys; sys.path.insert(0, 'scripts'); import daily_elevators as d; print(d.place_id('Test Home Grain||Chetek|WI'))"],
    { cwd: ROOT, encoding: "utf8" }).trim();
  assert.deepEqual(P.posts[0].body, { k: "abcdefghjkmnpqrstvwxyz01", ids: [py] });
  assert.equal(P.M.placeId("Test Home Grain||Chetek|WI"), py);
  assert.ok(!JSON.stringify(P.posts).includes("@"), "never an address");
});

test("no key: nothing leaves the phone", async () => {
  const P = page("", { "agsist-my-elevators": JSON.stringify({ v: 1, items: [{ key: "A||B|WI", name: "A" }] }) });
  P.M.toggle({ facility: "Test Second", city: "Cameron", state: "WI" }, "54728");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(P.posts.length, 0);
  assert.equal(P.M.dailyState(), "off");
});

test("with a key, a save sends the whole list; an empty phone only asks what is there", async () => {
  const P = page("", { "agsist-daily-key": "abcdefghjkmnpqrstvwxyz01" });
  P.M.toggle({ facility: "Test Second", city: "Cameron", state: "WI" }, "54728");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(P.posts.length, 1);
  assert.equal(P.posts[0].body.ids.length, 1);
  const Q = page("#dk=abcdefghjkmnpqrstvwxyz01", {});
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(Q.posts.length, 1);
  assert.match(Q.posts[0].url, /\/daily-elev\/me$/, "an empty list never wipes what the email already has");
});

test("the footer words and the rules live in one place each", () => {
  const de = read("scripts/daily_elevators.py");
  for (const k of ["BASIS_MOVE_C = 10", "PAYS_MORE_C = 20", "MAX_NEAR = 2", "MAX_LINES = 6", "WORDS = {"]) assert.ok(de.includes(k), k);
  assert.ok(!/\u2014/.test(de + read("scripts/test_daily_elevators.py")), "no em dash characters");
  assert.ok(read("scripts/brief_email.py").includes('ELEVATOR_ADD_WORDS = "Put the elevators you saved on agsist.com in this email"'));
});
