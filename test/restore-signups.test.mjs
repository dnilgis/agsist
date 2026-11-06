/* scripts/restore_signups.py (the one-time backup-form restore). Nov 5: one old elevator-alert record
 * answered HTTP 200 and was never added, so every run showed failed. A definite refusal is settled and
 * logged by count and record number; a failure that may pass on a rerun stays red; an address never
 * reaches the log.
 *   node --test test/restore-signups.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MAIL = "someone.private@example.org";

function run(replies) {
  const py = `
import json, sys
sys.path.insert(0, "scripts")
import restore_signups as R
rows = [
 {"email": "${MAIL}", "list": "elevator alert", "details": {"wid": "ABC", "label": "x"}},
 {"email": "a2@example.org", "list": "AGSIST Daily"},
]
replies = ${JSON.stringify(replies)}
seq = iter(replies)
def post(url, body=None):
    return tuple(next(seq))
done, bad, settled, out = R.restore(rows, "https://w.example", "s", post=post)
print(json.dumps({"done": done, "bad": bad, "settled": settled, "out": out}))
`;
  return JSON.parse(execFileSync("python3", ["-I", "-c", py], { cwd: ROOT, encoding: "utf8" }));
}

test("a 200 refusal is settled, by record number, and the run is clean", () => {
  const r = run([[200, '{"ok":false,"error":"exists"}'], [200, '{"ok":true}']]);
  assert.equal(r.settled, 1);
  assert.equal(r.bad, 0);
  assert.equal(r.done.daily, 1);
  assert.match(r.out[0], /^settled: record 1 \(elevator alert\)/);
});

test("a confirm page that is not the watching page (200) is settled", () => {
  const r = run([[200, '{"ok":true}'], [200, "<p>Link already used</p>"], [200, '{"ok":true}']]);
  assert.equal(r.settled, 1);
  assert.equal(r.bad, 0);
});

test("a server error or a bad gateway stays a failure (may pass on a rerun)", () => {
  const r = run([[502, "bad gateway"], [200, '{"ok":true}']]);
  assert.equal(r.bad, 1);
  assert.equal(r.settled, 0);
  assert.match(r.out[0], /^not added: record 1 \(elevator alert\) \(HTTP 502\)/);
});

test("a rate limit (429) stays a failure", () => {
  const r = run([[429, '{"ok":false}'], [200, '{"ok":true}']]);
  assert.equal(r.bad, 1);
});

test("the log never holds the address", () => {
  const r = run([[200, '{"ok":false,"email":"' + MAIL + '"}'], [200, '{"ok":false}']]);
  assert.ok(!JSON.stringify(r).includes(MAIL));
  assert.ok(!JSON.stringify(r).includes("@"));
});
