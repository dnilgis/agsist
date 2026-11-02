// list_hygiene.py step 3 (Nov 2, 2026): Gmail's Unsubscribe button mails
// news@agsist.com "unsubscribe"; nothing read those mails, so a reader who
// pressed it stayed on the list. The selftest runs the fixtures in
// test/list-hygiene-unsub/ (one-click, forged From, STOP reply, unrelated,
// second request) through the parser, the trust check, the plan and a fake
// IMAP server. Here CI runs it, and the log and the repo are checked for
// addresses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("list_hygiene selftest passes, unsubscribe-by-email cases included", () => {
  const r = spawnSync("python3", ["scripts/list_hygiene.py", "--selftest"], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, UNSUB_LOOKBACK_DAYS: "", AUTHSERV_ID: "" },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const want of ["forged From is not verified", "STOP' reply is a request", "already-removed address does nothing",
                      "not read again", "never acted on; it is listed", "price watch is reported"]) {
    assert.match(r.stdout, new RegExp(want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "selftest case missing: " + want);
  }
  assert.doesNotMatch(r.stdout, /^FAIL/m);
});

test("unsubscribe fixtures use documentation domains only", () => {
  const dir = path.join(ROOT, "test", "list-hygiene-unsub");
  const files = readdirSync(dir);
  assert.ok(files.filter((f) => f.endsWith(".eml")).length >= 5, "fixtures: " + files.join(", "));
  for (const f of files) {
    const txt = readFileSync(path.join(dir, f), "utf8");
    for (const m of txt.matchAll(/[\w.+=-]+@([\w-]+(?:\.[\w-]+)+)/g)) {
      assert.match(m[1].toLowerCase(), /(^|\.)(example\.(com|org|net)|agsist\.com)$/, f + " names a real-looking domain");
    }
  }
});

test("the unsubscribe step logs counts only, never an address", () => {
  const src = readFileSync(path.join(ROOT, "scripts", "list_hygiene.py"), "utf8");
  const main = src.slice(src.indexOf("def main():"));
  for (const m of main.matchAll(/print\((f?"[^\n]*)\)/g)) {
    assert.doesNotMatch(m[1], /\{(e|frm|who|r\[["']from["']\]|a\[["']email["']\])\}/, "a log line prints an address: " + m[1]);
  }
});
