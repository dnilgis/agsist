/* Subs worker v5.41: unsubscribes are counted for Sig's morning email, with
 * no address in the count, split into readers and the list cleanup job.
 *
 *   node --test test/unsub-count.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("worker v5.41: /count carries unsubscribes for 24 h and 7 days, readers and cleanup apart, no address", async () => {
  const tmp = path.join(os.tmpdir(), "subs-worker-unsx-" + process.pid + ".mjs");
  fs.copyFileSync(path.join(ROOT, "workers/subs-worker.js"), tmp);
  const w = (await import(pathToFileURL(tmp).href)).default;
  fs.unlinkSync(tmp);
  const store = new Map();
  const env = { UNSUB_SECRET: "sec", LIST_TOKEN: "tok", SUBS: {
    async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; } } };
  const tok = (e) => crypto.createHmac("sha256", "sec").update(e).digest("hex").slice(0, 16);
  const unsub = (p, e, ua) => w.fetch(new Request(`https://x.dev${p}?e=${encodeURIComponent(e)}&t=${tok(e)}`, { method: "POST", headers: ua ? { "User-Agent": ua } : {} }), env);
  const count = async () => (await (await w.fetch(new Request("https://x.dev/count?token=tok"), env)).json());
  store.set("sub:a@farm.com", JSON.stringify({ ts: 1, src: "bar" }));
  store.set("sub:b@farm.com", JSON.stringify({ ts: 1, src: "bar" }));
  store.set("alert:c@farm.com", JSON.stringify({ lat: 45 }));
  assert.equal((await unsub("/unsubscribe", "a@farm.com")).status, 200);
  assert.equal(store.has("sub:a@farm.com"), false, "unsubscribed");
  await unsub("/unsubscribe", "a@farm.com");               // again: nothing left to remove, not counted twice
  await unsub("/unsubscribe", "b@farm.com", "agsist-list-hygiene");
  await unsub("/alert-unsubscribe", "c@farm.com");
  await unsub("/unsubscribe", "nobody@farm.com");          // never on the list: not counted
  // an old one, 3 days back, counts for 7 days only
  store.set("unsx:daily:reader:" + (Date.now() - 3 * 864e5) + ":abcd1234", "");
  const c = await count();
  assert.deepEqual(c.unsubs, {
    daily: { h24: 1, d7: 2, cleanup_h24: 1, cleanup_d7: 1 },
    alerts: { h24: 1, d7: 1, cleanup_h24: 0, cleanup_d7: 0 },
  });
  assert.equal(c.daily, 0);
  const keys = [...store.keys()].filter((k) => k.startsWith("unsx:"));
  assert.ok(keys.length === 4 && keys.every((k) => !k.includes("@") && !k.includes("farm")), "no address in a count key: " + keys);
  // a bad token removes nothing and counts nothing
  store.set("sub:d@farm.com", JSON.stringify({ ts: 1 }));
  await w.fetch(new Request("https://x.dev/unsubscribe?e=d%40farm.com&t=0000000000000000", { method: "POST" }), env);
  assert.ok(store.has("sub:d@farm.com"));
  assert.equal((await count()).unsubs.daily.h24, 1);
  const src = fs.readFileSync(path.join(ROOT, "workers/subs-worker.js"), "utf8");
  assert.ok(src.includes(" * v5.41 (2026-10-20): UNSUBSCRIBE COUNTS"));
});
