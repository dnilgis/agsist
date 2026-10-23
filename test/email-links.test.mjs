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
 * Oct 22, 2026, the front door (Sig; BUILD-RULES 11): no emailed link points at
 * the worker's workers.dev host. Every link goes to agsist.com/e (e.html; its
 * own test is test/frontdoor-page.test.mjs), which asks the worker's /fd/
 * routes from the reader's browser (scripts/test_frontdoor_worker.mjs).
 *   - every script that sends mail imports scripts/email_links.py, whose
 *     smtplib guard refuses any message naming the worker host, in every mode;
 *   - no sender script names a workers.dev host except the API bases it
 *     calls (never put in an email);
 *   - no em dash in a subject or headline template, and none from a label
 *     saved with one (send_elevator_watch selftest; email_links.tidy_subject).
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
  ["scripts/send_rain_month.py", /OK: 0 failure\(s\)/],
  ["scripts/send_land_alert.py", /OK: 0 failure\(s\)/],
  ["scripts/send_rent_notice.py", /OK: 0 failure\(s\)/],
  ["scripts/send_cot_weekly.py", /send_cot_weekly selftest ok/],
];
// Oct 22, 2026 (the front door): these mail links that used to go to the worker
// (the Rain Print reminder stop, the sponsor confirm and decide links, the
// digest's logo link); each selftest asserts the agsist.com front door.
const FRONT_SELFTESTS = [
  ["scripts/rp_design_email.py", /rp_design_email: all checks pass/],
  ["scripts/sponsor_apply.py", /sponsor_apply: all checks pass/],
  ["scripts/form_digest.py", /form_digest: all checks pass/],
];
for (const [f, ok] of FRONT_SELFTESTS) {
  test(f + " --selftest: its links go to the agsist.com front door", () => {
    assert.match(run("python3", [f, "--selftest"]), ok);
  });
}
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

test("the front door: the worker's /fd/ routes (scripts/test_frontdoor_worker.mjs)", () => {
  assert.match(run(process.execPath, ["scripts/test_frontdoor_worker.mjs"]), /test_frontdoor_worker: \d+ passed/);
});

const SENDS = (src) => /\.send_message\(|\.sendmail\(/.test(src);
test("every script that sends mail imports email_links (its smtplib guard refuses a worker-host link)", () => {
  let seen = 0;
  for (const f of readdirSync(ROOT + "scripts").filter((x) => x.endsWith(".py") && !x.startsWith("test_") && x !== "email_links.py")) {
    const src = readFileSync(ROOT + "scripts/" + f, "utf8");
    if (!/import smtplib/.test(src) || !SENDS(src)) continue;
    seen++;
    assert.match(src, /^import email_links\b/m, "scripts/" + f + " sends mail without importing email_links");
    assert.ok(!/\.sendmail\(/.test(src), "scripts/" + f + " calls sendmail(): use send_message so the guard sees the message");
  }
  assert.ok(seen >= 20, "only " + seen + " sending scripts found; they have moved");
  const audit = readFileSync(ROOT + ".github/workflows/audit.yml", "utf8");
  assert.ok(!/smtplib/.test(audit) || /import email_links/.test(audit), "the audit workflow mails without the guard");
});

test("no sender names a workers.dev host except the API it calls (never in an email)", () => {
  // file -> the lines allowed to name the host: a default API base or a fetch, and selftest fixtures
  const allowed = {
    "morning_report.py": [/^PASTE_STATUS = /],
    "subscriber_report.py": [/env\("LIST_URL", "https:\/\/agsist-api\.dnilgis\.workers\.dev"\)/],
    "list_hygiene.py": [/env\("LIST_URL", "https:\/\/agsist-api\.dnilgis\.workers\.dev"\)/],
    "send_daily.py": [/^\s+https:\/\/agsist-api\.dnilgis\.workers\.dev\) /],
    "brief_email.py": [/^\s+\("https:\/\/agsist-subs\.dnilgis\.workers\.dev\/unsubscribe\?k=0123456789abcdef&t=ab", "x",$/, /^\s+"https:\/\/agsist-subs\.dnilgis\.workers\.dev\/unsubscribe\?k=0123456789abcdef&t=ab"\),$/],
    "test_list_fallback.py": [/./], "test_sponsor_portal.py": [/./], "email_links.py": [/./], "sponsor_apply.py": [/selftest|agsist-api\.dnilgis\.workers\.dev", "sec"/],
  };
  let seen = 0;
  for (const f of readdirSync(ROOT + "scripts").filter((x) => x.endsWith(".py"))) {
    const src = readFileSync(ROOT + "scripts/" + f, "utf8");
    if (!/import email_links|import send_notice as SN|import send_elevator_watch as sew/.test(src)) continue;
    seen++;
    src.split("\n").forEach((line, i) => {
      if (!/workers\.dev/.test(line) || /^\s*#/.test(line) || /"workers\.dev" not in /.test(line)) return;   // a check that there is none
      assert.ok((allowed[f] || []).some((re) => re.test(line)), "scripts/" + f + ":" + (i + 1) + " names a workers.dev host: " + line.trim().slice(0, 120));
    });
  }
  assert.ok(seen >= 20, "only " + seen + " sender scripts looked at");
});

test("no em dash in a subject or headline template of any sender", () => {
  for (const f of readdirSync(ROOT + "scripts").filter((x) => x.endsWith(".py") && !x.startsWith("test_"))) {
    const src = readFileSync(ROOT + "scripts/" + f, "utf8");
    if (!/import email_links|import send_notice as SN|import send_elevator_watch as sew/.test(src)) continue;
    src.split("\n").forEach((line, i) => {
      if (!/subject|headline|html_wrap\(|<h1|<h2/i.test(line) || /^\s*#/.test(line)) return;
      if (/\bassert\b|\bck\(|\bok\(|\bcheck\(|not in /.test(line)) return;   // a check that there is none
      assert.ok(!/\u2014|\\u2014|&mdash;/.test(line), "scripts/" + f + ":" + (i + 1) + " has an em dash in a subject or headline: " + line.trim().slice(0, 120));
    });
  }
});

test("the guard bites on the worker host in every mode, and fixes a subject's em dash", () => {
  const py = "import sys; sys.path.insert(0, 'scripts'); import email_links as L, smtplib\n" +
    "from email.message import EmailMessage\n" +
    "for fb in (False, True):\n    L.FALLBACK = fb\n    m = EmailMessage(); m['Subject'] = 'Co-op \\u2014 corn'\n" +
    "    m.set_content('see https://agsist-subs.dnilgis.workers.dev/unsubscribe?k=0123456789abcdef&t=1')\n" +
    "    try:\n        L.check_message(m); print('let through')\n    except L.LinkError:\n        print('refused')\n" +
    "    print(L.tidy_subject(m)['Subject'])\n" +
    "print(L.signed('https://agsist-subs.dnilgis.workers.dev', 'unsubscribe', L.SAMPLE_LID, 's').split('&')[0])\n";
  assert.equal(run("python3", ["-c", py]).trim(), "refused\nCo-op, corn\nrefused\nCo-op, corn\nhttps://agsist.com/e?a=unsubscribe");
});
