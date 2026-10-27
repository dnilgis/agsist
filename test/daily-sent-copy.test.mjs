/* The Daily as emailed is kept apart from later page updates (2026-10-27).
 * The Oct 16 issue went out at 5:47 a.m. CT and its page and archive JSON were
 * redrawn at 5:27 p.m. with afternoon trades; the morning version was kept
 * nowhere. send_daily.py now writes data/daily-sent/<day>.json once, on the
 * first send of the day, and daily.yml commits it after the send.
 *   node --test test/daily-sent-copy.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), "utf8");

test("the first send of a day is kept, a later run leaves it alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "sent-"));
  try {
    const out = execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, "scripts")
import send_daily as sd
d = sys.argv[1]
a = sd.save_sent_copy("2026-10-16", {"headline": "morning", "lead": "Hogs at the morning price."}, "Corn and beans break lower", "v2", d)
b = sd.save_sent_copy("2026-10-16", {"headline": "afternoon"}, "later", "v2", d)
rec = json.load(open(d + "/2026-10-16.json"))
print(bool(a), b is None, rec["briefing"]["headline"], rec["subject"], sorted(rec))
`, dir], { cwd: ROOT, encoding: "utf8" });
    assert.match(out, /^True True morning Corn and beans break lower \['briefing', 'date', 'format', 'note', 'sent_at', 'subject'\]$/m, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("send_daily keeps the copy when the day is flagged sent, never for Sig's test copy", () => {
  const sd = read("scripts/send_daily.py");
  // the test copy branch replaces the flag; only the real branch hooks it
  assert.match(sd, /if test:\n[^\n]*\n\s+globals\(\)\["flag"\] = lambda \*a, \*\*k: False\n\s+elif not list_source\.claim\("briefed:" \+ day\):\n[^\n]*\n\s+return 1\n\s+else:\n(?:\s+#[^\n]*\n)+\s+keep_sent_copy\(day, b, from_name, from_addr, reply_to\)/);
  const dir = mkdtempSync(join(tmpdir(), "sent-"));
  try {
    const out = execFileSync("python3", ["-c", `
import json, os, sys
sys.path.insert(0, "scripts")
import send_daily as sd
sd.SENT = __import__("pathlib").Path(sys.argv[1])
calls = []
sd.flag = lambda d, set_it=False: calls.append((d, set_it)) or True
sd.build_email = lambda day, b, to, *a: {"Subject": "Hogs and the morning board"}
b = {"headline": "morning"}
sd.keep_sent_copy("2026-10-16", b, "n", "a", None)
sd.flag("2026-10-16")
print(os.path.exists(sys.argv[1] + "/2026-10-16.json"))
sd.flag("2026-10-16", set_it=True)
rec = json.load(open(sys.argv[1] + "/2026-10-16.json"))
print(calls, rec["subject"], rec["briefing"], "reader@example.com" in sd.LINK_IDS)
`, dir], { cwd: ROOT, encoding: "utf8" });
    assert.match(out, /^False$/m, out);
    assert.match(out, /^\[\('2026-10-16', False\), \('2026-10-16', True\)\] Hogs and the morning board \{'headline': 'morning'\} False$/m, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // the record holds the issue and its subject only: no reader's address, ZIP, count or link
  const fn = sd.slice(sd.indexOf("def save_sent_copy"), sd.indexOf("\ndef ", sd.indexOf("def save_sent_copy") + 10));
  assert.ok(!/\b(recipients|subs|LINK_IDS|to_addr|unsub_url|LOCAL_LINES|RAIN_LINES|ELEVATOR_LINES)\b/.test(fn), "sent copy touches reader data");
});

test("daily.yml commits the sent copy after the send and never fails the run on it", () => {
  const y = read(".github/workflows/daily.yml");
  const send = y.indexOf("run: python scripts/send_daily.py"), keep = y.indexOf("- name: Keep the sent copy");
  assert.ok(send > 0 && keep > send, "the keep step must follow the send");
  const step = y.slice(keep, y.indexOf("\n      - name:", keep + 10) > 0 ? y.indexOf("\n      - name:", keep + 10) : keep + 2000);
  assert.match(step, /continue-on-error: true/);
  assert.match(step, /git add data\/daily-sent\//);
  assert.match(step, /inputs\.test_to_sig != true/);
  // the main commit step must not pick it up before the send
  assert.ok(!/git add [^\n]*daily-sent/.test(y.slice(0, send)), "daily-sent committed before the send");
});
