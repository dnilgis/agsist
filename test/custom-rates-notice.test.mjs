/* "Email me when my state's new custom rate survey is out" (Nov 3, custom rates panel).
 * The ask on /custom-rates posts topic customrates:<st> to the subscriptions worker's /notice;
 * scripts/send_custom_rates_notice.py mails each notice once, when a survey edition newer than
 * the ask is on the page, and marks it. Fake worker store, fake SMTP; no network.
 *
 *   node --test test/custom-rates-notice.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

async function worker() {
  const tmp = path.join(os.tmpdir(), "subs-worker-cr-" + process.pid + "-" + Math.random().toString(36).slice(2) + ".mjs");
  fs.copyFileSync(path.join(ROOT, "workers/subs-worker.js"), tmp);
  const w = (await import(pathToFileURL(tmp).href)).default;
  fs.unlinkSync(tmp);
  const store = new Map();
  const env = { UNSUB_SECRET: "sec", LIST_TOKEN: "tok", SUBS: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; } } };
  let ip = 0;
  const notice = (body) => w.fetch(new Request("https://x.dev/notice", { method: "POST",
    headers: { "Origin": "https://agsist.com", "Content-Type": "application/json", "CF-Connecting-IP": "10.0.1." + (++ip) },
    body: JSON.stringify(body) }), env);
  const list = async (q) => (await (await w.fetch(new Request("https://x.dev/notice-list?token=tok&unsent=1&topic=" + q), env)).json());
  const mark = (email, topic) => w.fetch(new Request("https://x.dev/notice-mark?token=tok", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, topic }) }), env);
  return { store, notice, list, mark };
}

test("worker: /notice takes customrates:<state>, the sender's list reads it, a mark keeps it from a second email, a new ask starts over", async () => {
  const { notice, list, mark } = await worker();
  let r = await notice({ email: "a@farm.com", topic: "customrates:ne", source: "page:custom-rates", daily: false });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).topic, "customrates:ne");
  r = await notice({ email: "b@farm.com", topic: "CUSTOMRATES:MN", source: "page:custom-rates" });
  assert.equal((await r.json()).topic, "customrates:mn", "a state with no survey yet can be waited for");
  for (const bad of ["customrates:zz", "customrates:", "customrates:nebraska", "customrates:ne:1"]) {
    r = await notice({ email: "c@farm.com", topic: bad, source: "page:custom-rates" });
    assert.equal(r.status, 400, bad);
  }
  assert.deepEqual((await list("customrates:")).map((x) => [x.email, x.topic]).sort(), [["a@farm.com", "customrates:ne"], ["b@farm.com", "customrates:mn"]]);
  assert.equal((await (await mark("a@farm.com", "customrates:ne")).json()).ok, true);
  assert.deepEqual((await list("customrates:")).map((x) => x.email), ["b@farm.com"], "sent once: the marked notice leaves the unsent list");
  await notice({ email: "a@farm.com", topic: "customrates:ne", source: "page:custom-rates" });
  assert.deepEqual((await list("customrates:")).map((x) => x.email).sort(), ["a@farm.com", "b@farm.com"], "asking again after the email waits for the next survey");
});

test("sender: mails a notice once, only for a survey edition newer than the ask (selftest with a throwaway git history)", () => {
  const out = execFileSync("python3", ["scripts/send_custom_rates_notice.py", "--selftest"], { cwd: ROOT }).toString();
  assert.match(out, /ok {3}sent once: the second run mails nobody/);
  assert.match(out, /ok {3}mails the notice made before the new edition, not the one made after it/);
  assert.match(out, /OK: 0 failure\(s\)/);
});

test("the ask: posts customrates:<st> to the worker's /notice, says one email, rides an existing workflow", () => {
  const js = read("components/custom-rates.js");
  assert.match(js, /'customrates:' \+ st\.toLowerCase\(\)/);
  assert.match(js, /agsist-api\.dnilgis\.workers\.dev\/notice/);
  assert.match(js, /One email, when it is on this page/);
  const wf = read(".github/workflows/cash-rent.yml");
  assert.match(wf, /python3 scripts\/send_custom_rates_notice\.py --send/);
  assert.match(js, /we will add you by hand/);
  assert.doesNotMatch(js, /I will add you by hand/);
  assert.doesNotMatch(read("scripts/send_custom_rates_notice.py"), /—/);
});

test("live gate: the step sends only when Sig turns CUSTOMRATES_NOTICE_LIVE on, and a manual run only when asked", () => {
  const wf = read(".github/workflows/cash-rent.yml");
  const at = wf.indexOf("- name: Custom rates new-survey emails");
  assert.ok(at > 0);
  const step = wf.slice(at, wf.indexOf("\n      - name:", at + 10) > 0 ? wf.indexOf("\n      - name:", at + 10) : undefined);
  assert.match(step, /if: vars\.CUSTOMRATES_NOTICE_LIVE == '1' && \(github\.event_name != 'workflow_dispatch' \|\| inputs\.customrates_send == 'yes'\)/);
  assert.match(step, /CUSTOMRATES_NOTICE_LIVE: \$\{\{ vars\.CUSTOMRATES_NOTICE_LIVE \}\}/);
  assert.match(wf, /customrates_send:\n\s+description:[^\n]*\n\s+required: false\n\s+default: "no"/);
  // the script refuses on its own too: without the variable, --send sends and marks nothing
  const src = read("scripts/send_custom_rates_notice.py");
  assert.match(src, /if send and SN\.env\("CUSTOMRATES_NOTICE_LIVE", ""\) != "1":/);
  const out = execFileSync("python3", ["scripts/send_custom_rates_notice.py", "--selftest"], { cwd: ROOT }).toString();
  assert.match(out, /ok {3}live gate: --send without CUSTOMRATES_NOTICE_LIVE=1 sends and marks nothing, exit 1/);
  assert.match(out, /ok {3}a title typo fix is the same edition/);
});
