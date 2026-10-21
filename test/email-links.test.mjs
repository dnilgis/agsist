/* No emailed link carries the reader's address (Oct 21, 2026).
 *
 * A Daily link of the form .../daily-elev?e=<address>&t=<hmac> was scanned
 * and reported as phishing, and the subs worker's host was blocked. Since
 * subs worker v5.46 every signed link carries k=<link id> (scripts/email_links.py)
 * and old ?e= links keep working at the worker.
 *
 *   - every sender's own selftest, each of which builds its emails for a
 *     made-up reader and asserts no "@" inside any href;
 *   - the worker: link ids on the list routes, k= on every signed route,
 *     bad t is 403, old e= links still work (scripts/test_form_worker.mjs,
 *     scripts/subs-worker-checks.mjs);
 *   - by source text: no sender builds an ?e= link any more.
 *
 *   node --test test/email-links.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000 });

const SELFTESTS = [
  ["scripts/email_links.py", /email_links selftest ok/],
  ["scripts/brief_email.py", /brief_email selftest ok/],
  ["scripts/send_report_day.py", /send_report_day selftest ok/],
  ["scripts/check_alerts.py", /check_alerts selftest ok/],
  ["scripts/send_watch.py", /selftest ok/],
  ["scripts/send_elevator_watch.py", /selftest ok/],
  ["scripts/send_zip_alert.py", /zip alert selftest ok/],
  ["scripts/send_price_watch.py", /selftest ok/],
  ["scripts/send_notice.py", /OK: 0 failure\(s\)/],
  ["scripts/send_prf_notice.py", /OK: 0 failure\(s\)/],
  ["scripts/send_rain_year.py", /OK: 0 failure\(s\)/],
  ["scripts/send_rent_notice.py", /OK: 0 failure\(s\)/],
];
for (const [f, ok] of SELFTESTS) {
  test(f + " --selftest: no address in any link it emails", () => {
    assert.match(run("python3", [f, "--selftest"]), ok);
  });
}
for (const [f, ok] of [["scripts/test_send_daily_local.py", /send_daily local line: \d+ passed/],
                       ["scripts/test_zip_alert.py", /zip alert end-to-end ok \d+ checks/]]) {
  test(f, () => { assert.match(run("python3", [f]), ok); });
}
test("the worker: link ids, k= links, bad t 403, old e= links (scripts/subs-worker-checks.mjs)", () => {
  assert.match(run(process.execPath, ["scripts/subs-worker-checks.mjs"]), /subs-worker-checks: \d+ passed/);
});

test("the selftests above prove the no-@ rule (each one asserts it)", () => {
  let seen = 0;
  for (const [f] of SELFTESTS.slice(2)) {
    const s = readFileSync(ROOT + f, "utf8");
    assert.ok(/hrefs\(/.test(s) && /"@" in /.test(s), f + ": its selftest no longer checks for an @ inside an href");
    seen++;
  }
  assert.ok(seen >= 10, "only " + seen + " senders checked; the senders have moved");
});

test("no sender builds an ?e=<address> link any more", () => {
  // list_hygiene.py POSTs to the worker itself to remove bounced addresses; nothing it builds is emailed.
  const allowed = new Set(["list_hygiene.py", "email_links.py"]);
  const pat = /["'][^"'\n]*\?e=["']\s*(\+|%)|\?e=%s|["']e=["']\s*\+|\?e=\{/;
  let seen = 0;
  for (const f of readdirSync(ROOT + "scripts").filter((x) => x.endsWith(".py") && !x.startsWith("test_"))) {
    const src = readFileSync(ROOT + "scripts/" + f, "utf8");
    if (!/smtplib|EmailMessage|send_watch|send_notice|send_elevator_watch/.test(src)) continue;
    seen++;
    if (allowed.has(f)) continue;
    assert.ok(!pat.test(src), "scripts/" + f + " builds an ?e= link: emailed links carry k=<link id> (email_links.signed)");
  }
  assert.ok(seen >= 15, "only " + seen + " sender scripts looked at; they have moved");
});

test("the guard bites: an address in a link is refused", () => {
  const py = "import sys; sys.path.insert(0, 'scripts'); import email_links as L\n" +
    "try:\n    L.check_text('<a href=\"https://w.dev/unsubscribe?e=a%40b.com&amp;t=1\">x</a>'); print('let through')\n" +
    "except L.LinkError as ex:\n    print('refused', '@' in str(ex))\n";
  assert.equal(run("python3", ["-c", py]).trim(), "refused False");
});
