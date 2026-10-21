/* Subs worker v5.44: two standing lists on /notice (Sig, Oct 21).
 *   reports  the report-day email alone (the WASDE summary), no Daily needed;
 *   cot      "Funds this week", one email after each COT release.
 * Each keeps its source, shows in /notice-list for its sender, counts in
 * /count lists {n, by_source, unsubs}, and stops from its own unsubscribe
 * link without touching the Daily.
 *
 *   node --test test/report-lists.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

async function worker() {
  const tmp = path.join(os.tmpdir(), "subs-worker-lists-" + process.pid + "-" + Math.random().toString(36).slice(2) + ".mjs");
  fs.copyFileSync(path.join(ROOT, "workers/subs-worker.js"), tmp);
  const w = (await import(pathToFileURL(tmp).href)).default;
  fs.unlinkSync(tmp);
  const store = new Map();
  const env = { UNSUB_SECRET: "sec", LIST_TOKEN: "tok", SUBS: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; } } };
  const tok = (e) => crypto.createHmac("sha256", "sec").update(e).digest("hex").slice(0, 16);
  let ip = 0;
  const notice = (body) => w.fetch(new Request("https://x.dev/notice", { method: "POST",
    headers: { "Origin": "https://agsist.com", "Content-Type": "application/json", "CF-Connecting-IP": "10.0.0." + (++ip) },
    body: JSON.stringify(body) }), env);
  const count = async () => (await (await w.fetch(new Request("https://x.dev/count?token=tok"), env)).json());
  const list = async (q) => (await (await w.fetch(new Request("https://x.dev/notice-list?token=tok&topic=" + q), env)).json());
  return { w, env, store, tok, notice, count, list };
}

test("worker v5.44: reports and cot are their own lists, with sources, in /notice-list and /count", async () => {
  const { store, notice, count, list } = await worker();
  let r = await notice({ email: "A@farm.com", topic: "reports", source: "report:wasde:usda-calendar", daily: false });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, topic: "reports", daily: false });
  await notice({ email: "b@farm.com", topic: "reports", source: "report:wasde:whats-priced-in" });
  await notice({ email: "b@farm.com", topic: "cot", source: "cot-weekly:corn-futures-prices" });
  await notice({ email: "c@farm.com", topic: "cot", source: "cot-weekly:cot", daily: true });
  await notice({ email: "d@farm.com", topic: "COT", source: "cot-weekly:cot" });
  // asked again from another page: the first source stays (the notice rule)
  await notice({ email: "a@farm.com", topic: "reports", source: "report:wasde:crop-tour" });
  assert.equal(store.has("sub:a@farm.com"), false, "the WASDE summary alone puts nobody on the Daily");
  assert.equal(store.has("sub:b@farm.com"), false);
  assert.ok(store.has("sub:c@farm.com"), "the reader's own tick of 'Also send the morning briefing' does");
  assert.equal(JSON.parse(store.get("sub:c@farm.com")).src, "cot-weekly:cot", "and the Daily keeps where they signed up");
  const rl = await list("reports");
  assert.deepEqual(rl.map((x) => [x.email, x.topic, x.src, x.sent]).sort(),
    [["a@farm.com", "reports", "report:wasde:usda-calendar", null], ["b@farm.com", "reports", "report:wasde:whats-priced-in", null]]);
  assert.equal((await list("cot")).length, 3);
  const c = await count();
  assert.deepEqual(c.lists, {
    reports: { n: 2, by_source: { "report:wasde:usda-calendar": 1, "report:wasde:whats-priced-in": 1 }, unsubs: { h24: 0, d7: 0, cleanup_h24: 0, cleanup_d7: 0 } },
    cot: { n: 3, by_source: { "cot-weekly:corn-futures-prices": 1, "cot-weekly:cot": 2 }, unsubs: { h24: 0, d7: 0, cleanup_h24: 0, cleanup_d7: 0 } },
  });
  assert.equal(c.notices.reports, 2);
  assert.equal(c.notices.cot, 3);
  assert.equal(c.daily, 1);
  assert.equal(c.by_source["cot-weekly:cot"], 1, "a Daily signup from a COT box counts under its source");
  assert.ok(!JSON.stringify(c).includes("@"), "counts only");
  for (const t of ["report", "reports:x", "cot:corn", "wasde"]) {
    r = await notice({ email: "e@farm.com", topic: t, source: "x" });
    assert.equal(r.status, 400, t);
  }
});

test("worker v5.44: each list stops from its own link, says which, counts the unsubscribe, leaves the Daily alone", async () => {
  const { w, env, store, tok, notice, count } = await worker();
  await notice({ email: "a@farm.com", topic: "reports", source: "report:wasde:usda-calendar" });
  await notice({ email: "a@farm.com", topic: "cot", source: "cot-weekly:cot" });
  store.set("sub:a@farm.com", JSON.stringify({ ts: 1, src: "bar", reports: true }));
  const u = (topic, method, ua) => w.fetch(new Request(`https://x.dev/notice-unsubscribe?e=a%40farm.com&t=${tok("a@farm.com")}${topic ? "&topic=" + topic : ""}`,
    { method, headers: ua ? { "User-Agent": ua } : {} }), env);
  let page = await (await u("cot", "GET")).text();
  assert.ok(page.includes("Stop Funds this week for this address?"), "the GET names the list");
  assert.ok(page.includes("AGSIST Daily, if you get it, is not changed."));
  assert.ok(JSON.parse(store.get("note:a@farm.com")).t.cot, "a GET changes nothing");
  page = await (await u("cot", "POST")).text();
  assert.ok(page.includes("Stopped. No more Funds this week emails."));
  const left = JSON.parse(store.get("note:a@farm.com")).t;
  assert.deepEqual(Object.keys(left), ["reports"], "only that list");
  assert.ok(store.has("sub:a@farm.com"), "the Daily is not touched");
  await u("cot", "POST");                                   // again: nothing to remove, not counted twice
  page = await (await u("reports", "GET")).text();
  assert.ok(page.includes("Stop the WASDE and report-day emails for this address?"));
  page = await (await u("reports", "POST", "agsist-list-hygiene/1.0")).text();
  assert.ok(page.includes("Stopped. No more WASDE or report-day emails."));
  assert.equal(store.has("note:a@farm.com"), false);
  const c = await count();
  assert.deepEqual(c.lists.cot.unsubs, { h24: 1, d7: 1, cleanup_h24: 0, cleanup_d7: 0 });
  assert.deepEqual(c.lists.reports.unsubs, { h24: 0, d7: 0, cleanup_h24: 1, cleanup_d7: 1 }, "the list cleanup counts apart");
  assert.deepEqual(c.unsubs.daily, { h24: 0, d7: 0, cleanup_h24: 0, cleanup_d7: 0 }, "not a Daily unsubscribe");
  const keys = [...store.keys()].filter((k) => k.startsWith("unsx:"));
  assert.ok(keys.length === 2 && keys.every((k) => !k.includes("@") && !k.includes("farm")), "no address in a count key: " + keys);
  // stopping every notice at once counts each list it held
  await notice({ email: "b@farm.com", topic: "cot", source: "cot-weekly:cot" });
  await notice({ email: "b@farm.com", topic: "rent:ia", source: "page:rent/iowa" });
  await w.fetch(new Request(`https://x.dev/notice-unsubscribe?e=b%40farm.com&t=${tok("b@farm.com")}`, { method: "POST" }), env);
  assert.equal((await count()).lists.cot.unsubs.h24, 2);
  // a wrong token removes nothing
  await notice({ email: "c@farm.com", topic: "cot", source: "cot-weekly:cot" });
  await w.fetch(new Request("https://x.dev/notice-unsubscribe?e=c%40farm.com&t=0000000000000000&topic=cot", { method: "POST" }), env);
  assert.ok(JSON.parse(store.get("note:c@farm.com")).t.cot);
  const src = fs.readFileSync(path.join(ROOT, "workers/subs-worker.js"), "utf8");
  assert.ok(src.includes(" * v5.44 (2026-10-21): TWO STANDING LISTS ON /notice"), "the header names the change");
  assert.ok(src.indexOf(" * v5.44 ") < src.indexOf(" * v5.41 "), "newest note first");
});
