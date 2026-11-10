/* Subscriber counts stay out of the public Actions logs, and the list token
 * travels in an Authorization header, never in an address.
 *
 *   node --test test/count-logs.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const fn = (src, name) => {
  const a = src.indexOf("\ndef " + name + "(");
  assert.ok(a >= 0, name + " exists");
  const b = src.indexOf("\ndef ", a + 5);
  return src.slice(a, b < 0 ? undefined : b);
};

test("no workflow puts a token in a URL", () => {
  for (const f of readdirSync(new URL(".github/workflows/", ROOT)).filter((x) => /\.ya?ml$/.test(x))) {
    assert.doesNotMatch(read(".github/workflows/" + f), /[?&]token=/, f);
  }
});

test("subscriber counts: saved to the private repo, not printed", () => {
  const w = read(".github/workflows/subs-count.yml");
  assert.match(w, /"Authorization": "Bearer " \+ os\.environ\["LIST_TOKEN"\]/);
  assert.doesNotMatch(w, /print\(json\.dumps/, "the counts are never printed");
  assert.match(w, /private\/data\/subs-count\.json/);
  assert.match(w, /RAW_BRANCH: private-data\n\s+run: bash scripts\/push_raw\.sh "subscriber counts" private\/data\/subs-count\.json/);
  assert.match(w, /uses: \.\/\.github\/actions\/engine/, "the job that runs code checks out the engine");
  const k = read(".github/workflows/import-kv.yml");
  assert.match(k, /-H "Authorization: Bearer \$LIST_TOKEN"/);
  assert.doesNotMatch(k, /echo "worker replied|list now holds/, "no reply or count in the log");
});

test("the report and count scripts print no count and send the token as a header", () => {
  const r = read("scripts/subscriber_report.py");
  assert.match(fn(r, "get"), /"Authorization": "Bearer " \+ token/);
  assert.doesNotMatch(fn(r, "get"), /token=/);
  assert.doesNotMatch(fn(r, "main"), /summary\(/, "the per-list totals go only in the email");
  const a = read("scripts/build_audience.py");
  assert.match(fn(a, "email_count"), /"Authorization": "Bearer " \+ token/);
  assert.doesNotMatch(fn(a, "email_count"), /token=/);
  assert.doesNotMatch(a, /log\([^)]*%d subscribers/, "no subscriber count in the log");
  const s = read("scripts/build_signups.py");
  assert.match(fn(s, "get_notices"), /Authorization="Bearer " \+ token/);
  assert.doesNotMatch(fn(s, "get_notices"), /token=/);
  const m = fn(s, "main");
  assert.doesNotMatch(m, /print\("::notice/, "no count annotations");
  assert.doesNotMatch(m, /print\([^\n]*%d/, "no number in a printed line");
});
