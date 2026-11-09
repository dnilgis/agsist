/* A green run is not a delivered email (BUILD-RULES 55 and 56, Nov 3 2026). rp-design-email and
 * rp-buyer-email ran green and dry for two weeks with the live variable at 1, and the subs worker had
 * never started either job. scripts/delivery_check.py reads the DELIVERY line every reader email
 * sender prints (scripts/delivery_line.py) and cron_health.py turns its findings into rows.
 *
 * This file holds:
 *   - the classifier, on fixtures only (delivery_check.py --selftest: no network, no date from today);
 *   - the inventory: every workflow with mail secrets is a reader sender or listed as Sig only; every
 *     sender script it lists is run by that workflow and prints the line under its name; every script
 *     run in a reader workflow's mail step is a listed sender or listed as Sig only; every script that
 *     prints the line is listed; cron-health passes every live switch. So a new sender cannot be missed.
 *
 *   node --test test/delivery-check.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const WF = path.join(ROOT, ".github/workflows");
const SCRIPTS = path.join(ROOT, "scripts");
const readWf = (f) => fs.readFileSync(path.join(WF, f), "utf8");
const py = (...a) => execFileSync("python3", a, { cwd: ROOT, encoding: "utf8", env: { ...process.env, DELIVERY_LINE_OFF: "1" } });
const INV = JSON.parse(py("scripts/delivery_check.py", "--inventory"));
const MAIL = /SMTP_PASS|GMAIL_APP_PASS|smtplib/;
const workflows = fs.readdirSync(WF).filter((f) => /\.ya?ml$/.test(f));

// The steps of a workflow, as text: split at each list item that starts a step.
function steps(text) {
  return text.split(/\n(?= {6}- (?:name|uses|run|id|if|env|with|shell|working-directory|timeout-minutes|continue-on-error):)/);
}
// scripts/<name>.py that a step runs for real (a --selftest line is a test, not a send)
function scriptsRun(stepText) {
  const out = new Set();
  for (const line of stepText.split("\n")) {
    if (/^\s*#/.test(line) || /--selftest/.test(line)) continue;
    for (const m of line.matchAll(/scripts\/([a-z0-9_]+\.py)\b/g)) out.add(m[1]);
  }
  return out;
}

test("the classifier passes its fixtures (no network, no clock)", () => {
  const out = py("scripts/delivery_check.py", "--selftest");
  assert.match(out, /delivery_check selftest: 0 failed/);
  assert.doesNotMatch(out, /^FAIL /m);
  assert.match(py("scripts/delivery_line.py", "--selftest"), /delivery_line selftest: 0 failed/);
});

test("Nov 4 real case: the Daily's one send in 81 runs is found, and a send step with no line is red", () => {
  // cron-health read the newest 2 and 3 longest of 81 Daily runs, found no DELIVERY line and said ok,
  // while run 41823633959 had sent at 11:48 UTC. The fixture: 81 runs, the send in the 79th, the newest 5 gate-only.
  const out = py("scripts/delivery_check.py", "--selftest");
  for (const name of [
    "Nov 4 Daily, the old view: the newest 5 runs say ok with no line (the blind spot)",
    "Nov 4 Daily: the send in run 79 of 81 is found and its line read",
    "Nov 4 Daily: only runs long enough to send are opened (5 of 81), one log",
    "Daily: a send step that ran with no DELIVERY line is late (d)",
    "Daily: sent_readers=0 with readers waiting, not dry, is late (f)",
    "Daily: no run reached the send step by 07:15 Central is late (e)",
    "Daily: only gate ticks all morning is late (e), not ok",
    "tick: the served run stopped before the send step is late (e)",
    "tick: no tick in 24 h is nothing due, ok",
    "Daily: a live 0 sent, 0 waiting with no already_sent is not a send (e)",
    "Daily: a 200 s send (under the 240 s floor) is found by the window",
    "Daily: a send run still in progress is unknown, not (e)",
    "Daily: the jobs API failing is unknown, not ok and not late",
    "a spent call budget is raised, not read as no send",
    "county-rain: the step outside January with no line is ok",
    "county-rain: the step in January with no line is late (d)",
    "run: the row says it is a sample",
  ]) assert.ok(out.split("\n").includes("ok   " + name), `delivery_check.py --selftest no longer passes: ${name}`);
});

test("the Daily's exits before the send print no 'sent' signal; only the day flag path does", () => {
  // Nov 4 checker: a live 0 sent, 0 waiting line was read as sent, and every early exit prints exactly that
  const out = execFileSync("python3", ["scripts/test_daily_delivery_line.py"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /test_daily_delivery_line: \d+ passed, 0 failed/);
  assert.match(fs.readFileSync(path.join(SCRIPTS, "send_daily.py"), "utf8"), /tally\.extra\["already_sent"\] = 1/);
});

test("a month-gated send step is gated in its workflow to those months, Central time", () => {
  for (const e of INV.senders) {
    for (const [key, months] of Object.entries(e.month_gate || {})) {
      const s = steps(readWf(e.workflow)).find((x) => stepName(x) === key);
      assert.ok(s, `${e.workflow}: month_gate names "${key}", which is not a step`);
      assert.match(s, /TZ=America\/Chicago date \+%m/, `${e.workflow}: "${key}" must test the Central month`);
      for (const m of months) assert.ok(s.includes(`"${String(m).padStart(2, "0")}"`), `${e.workflow}: "${key}" is not gated to month ${m}`);
    }
  }
});

// A step's name as the jobs API shows it: the text before any ${{ }} (and its open bracket)
const stepName = (s) => {
  const m = s.match(/^ {6}- name: *(.+)$/m);
  return m ? m[1].replace(/^["']|["']$/g, "").split("${{")[0].replace(/\s*\($/, "").trim() : null;
};

test("each sender's send steps are steps of its workflow that run its scripts", () => {
  for (const e of INV.senders) {
    assert.ok(e.steps && Object.keys(e.steps).length, `${e.workflow}: name its send steps (SENDERS "steps")`);
    const all = steps(readWf(e.workflow));
    const names = new Set(Object.values(e.senders));
    const byName = new Map(Object.entries(e.senders).map(([script, name]) => [name, script]));
    const covered = new Set();
    for (const [key, senders] of Object.entries(e.steps)) {
      const hits = all.filter((s) => stepName(s) === key);
      assert.equal(hits.length, 1, `${e.workflow}: one step must be named "${key}" (found ${hits.length})`);
      const run = scriptsRun(hits[0]);
      for (const n of senders) {
        assert.ok(names.has(n), `${e.workflow}: step "${key}" names ${n}, which is not one of its senders`);
        assert.ok(run.has(byName.get(n)), `${e.workflow}: step "${key}" does not run scripts/${byName.get(n)}`);
        covered.add(n);
      }
    }
    assert.deepEqual([...names].filter((n) => !covered.has(n)), [], `${e.workflow}: every sender has a send step`);
  }
});

test("each sender says when a send is due, and a tick sender has the gate that sets its ticks", () => {
  for (const e of INV.senders) {
    const kind = (e.due || [])[0];
    assert.ok(["daily", "tick", "run"].includes(kind), `${e.workflow}: due must be daily, tick or run`);
    if (kind === "tick") {
      // the same reader delivery_check.py uses for the ticks (cron_health.gate_crons)
      const crons = JSON.parse(py("-c", `import sys, json; sys.path.insert(0, "scripts"); import cron_health; print(json.dumps(cron_health.gate_crons(${JSON.stringify(e.workflow)})))`));
      assert.ok(crons.length, `${e.workflow}: a tick sender needs a cron_gate.py tick step with --cron`);
    }
    if (kind === "daily") assert.match(e.due[1], /^\d\d:\d\d$/);
    // a step with its own if: may skip on a due run; the sender must say so, or a skip reads as a missed send
    for (const key of Object.keys(e.steps)) {
      const s = steps(readWf(e.workflow)).find((x) => stepName(x) === key);
      if (/^ {8}if:/m.test(s) && kind !== "run") assert.ok(e.may_skip || e.own_if || kind === "daily",
        `${e.workflow}: step "${key}" has its own if:, so a due run may skip it; set may_skip (or own_if: why it never skips a due run)`);
    }
  }
});

test("every workflow with mail secrets is a listed reader sender or listed as Sig only", () => {
  const senders = new Set(INV.senders.map((e) => e.workflow));
  const sig = new Set(Object.keys(INV.sig_only));
  for (const w of [...senders, ...sig]) assert.ok(workflows.includes(w), `${w} is listed but has no workflow file`);
  const missing = workflows.filter((w) => MAIL.test(readWf(w)) && !senders.has(w) && !sig.has(w));
  assert.deepEqual(missing, [], "these workflows can send mail but are in neither scripts/delivery_check.py SENDERS nor "
    + "SIG_ONLY: add each sender with its live switch, and make its script print the DELIVERY line");
  for (const w of sig) assert.ok(MAIL.test(readWf(w)), `${w} is listed as Sig only but has no mail secret: drop it from SIG_ONLY`);
});

test("the brief's senders are all in the list", () => {
  const senders = new Set(INV.senders.map((e) => e.workflow));
  for (const w of ["daily.yml", "land-alert.yml", "rain-monthly.yml", "dairy.yml", "funds-weekly.yml", "rp-design-email.yml",
    "rp-buyer-email.yml", "elevator-watch.yml", "price-watch.yml", "arcplc-reminder.yml", "cash-rent.yml", "alert-check.yml",
    "form-digest.yml"]) assert.ok(senders.has(w), `${w} must be checked for delivery`);
});

test("each listed sender script is run by its workflow and prints the DELIVERY line under its name", () => {
  for (const e of INV.senders) {
    const text = readWf(e.workflow);
    const run = new Set(steps(text).flatMap((s) => [...scriptsRun(s)]));
    for (const [script, name] of Object.entries(e.senders)) {
      assert.ok(run.has(script), `${e.workflow} does not run scripts/${script} (outside a --selftest line)`);
      const src = fs.readFileSync(path.join(SCRIPTS, script), "utf8");
      assert.ok(src.includes(`delivery_line.start("${name}"`) || src.includes(`delivery_line.Tally("${name}")`),
        `scripts/${script} does not start the DELIVERY line as "${name}"`);
      assert.ok(src.includes(`delivery_line.start("${name}"`), `scripts/${script} never arms the line for "${name}" (delivery_line.start)`);
    }
  }
});

test("every script a reader workflow runs in a mail step is a listed sender or listed as Sig only", () => {
  for (const e of INV.senders) {
    const known = new Set([...Object.keys(e.senders), ...(e.sig_scripts || [])]);
    for (const s of e.sig_scripts || []) assert.ok(readWf(e.workflow).includes(`scripts/${s}`), `${e.workflow}: sig_scripts names ${s}, which it no longer runs`);
    for (const s of steps(readWf(e.workflow))) {
      if (!/SMTP_PASS|GMAIL_APP_PASS/.test(s)) continue;
      for (const script of scriptsRun(s)) {
        const src = fs.readFileSync(path.join(SCRIPTS, script), "utf8");
        if (!/smtplib|smtp_connect|send_message/.test(src)) continue;   // the step's other scripts do not mail
        assert.ok(known.has(script), `${e.workflow} runs scripts/${script} in a mail step: list it as a sender (with the `
          + `DELIVERY line) or in that entry's sig_scripts`);
      }
    }
  }
});

test("every script that arms the DELIVERY line is in the list, and each name is one sender", () => {
  const listed = new Map();
  for (const e of INV.senders) for (const [script, name] of Object.entries(e.senders)) {
    assert.ok(!listed.has(script) || listed.get(script) === name, `scripts/${script} has two names`);
    listed.set(script, name);
  }
  const owner = new Map();
  for (const [script, name] of listed) {
    assert.ok(!owner.has(name) || owner.get(name) === script, `the name ${name} is used by two scripts`);
    owner.set(name, script);
  }
  for (const f of fs.readdirSync(SCRIPTS).filter((f) => f.endsWith(".py") && f !== "delivery_line.py")) {
    const src = fs.readFileSync(path.join(SCRIPTS, f), "utf8");
    if (src.includes("delivery_line.start(")) assert.ok(listed.has(f), `scripts/${f} prints a DELIVERY line but no SENDERS entry reads it`);
  }
});

test("a sender's own selftest prints no DELIVERY line (a made-up count would land in its log)", () => {
  const env = { ...process.env };
  delete env.DELIVERY_LINE_OFF;
  for (const script of new Set(INV.senders.flatMap((e) => Object.keys(e.senders)))) {
    const src = fs.readFileSync(path.join(SCRIPTS, script), "utf8");
    if (!src.includes("--selftest")) continue;
    let out;
    try {
      out = execFileSync("python3", [`scripts/${script}`, "--selftest"], { cwd: ROOT, encoding: "utf8", env, timeout: 300000, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      out = String(err.stdout || "") + String(err.stderr || "");
    }
    assert.doesNotMatch(out, /DELIVERY sender=/, `scripts/${script} --selftest printed a DELIVERY line`);
  }
});

test("cron-health passes every live switch to the check, and can read the logs", () => {
  const ch = readWf("cron-health.yml");
  for (const v of INV.switch_vars) assert.match(ch, new RegExp(`\\n\\s+${v}: \\$\\{\\{ vars\\.${v} \\}\\}`), `cron-health.yml must pass vars.${v}`);
  assert.match(ch, /actions: read/);
  assert.match(ch, /python3 scripts\/delivery_check\.py --selftest/);
});

test("a worker-started job reads its asks or orders from a sender that prints them", () => {
  for (const e of INV.senders.filter((x) => x.worker_started)) {
    const [src, key] = e.evidence;
    const from = INV.senders.find((x) => x.workflow === src);
    assert.ok(from, `${e.workflow}: its evidence workflow ${src} is not a listed sender`);
    const script = Object.keys(from.senders)[0];
    assert.match(fs.readFileSync(path.join(SCRIPTS, script), "utf8"), new RegExp(`extra\\["${key}"\\]`),
      `scripts/${script} must count ${key}= on its DELIVERY line`);
  }
});

test("the daily send count is information only (Brevo Starter, Nov 9): send-volume row, SEND-CAP refusal marker and preflight", () => {
  // Brevo free had 300 emails a day (Nov 4: 211 used, the Daily's 209 + 2). Starter (Nov 9) has no daily cap: the count is
  // shown, never warned on; a real refusal from the mail server is still red; brevo-month judges the monthly allowance.
  const out = py("scripts/send_cap.py", "--selftest");
  assert.match(out, /send_cap selftest: 0 failed/);
  assert.doesNotMatch(out, /^FAIL /m);
  for (const name of [
    "Nov 4: 209 + 2 against 300 is ok",
    "245 in a day is information, not a warning (no daily cap)",
    "285 in a day is not red either",
    "a quota refusal is red, whatever the count",
    "a preflight marker (an old log line) no longer judges",
    "a report day (209 + 200 later) prints the count as information: no warning, no marker",
    "the marker prints once per run",
  ]) assert.match(out, new RegExp(`^ok   ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), name);
  const dc = py("scripts/delivery_check.py", "--selftest");
  assert.match(dc, /^ok   send-volume: a SEND-CAP refusal in a log read is red$/m);
  // the cap is a repository variable, so an upgrade changes no code
  for (const wf of ["cron-health.yml", "daily.yml", "report-day.yml"])
    assert.match(readWf(wf), /\n\s+SEND_DAILY_CAP: \$\{\{ vars\.SEND_DAILY_CAP \}\}/, `${wf} must pass vars.SEND_DAILY_CAP`);
  // every sender arms the SMTP count through the start() of delivery_line.py, and the Daily runs its preflight
  assert.match(fs.readFileSync(path.join(SCRIPTS, "delivery_line.py"), "utf8"), /send_cap\.install\(t\)/);
  assert.match(fs.readFileSync(path.join(SCRIPTS, "send_daily.py"), "utf8"), /send_cap\.preflight\(tally/);
});

test("no daily-limit upgrade reminder (Brevo Starter has no daily cap); the monthly row judges", () => {
  const ch = readWf("cron-health.yml");
  assert.doesNotMatch(ch, /send_cap\.py --remind/, "the daily-limit reminder step is gone");
  const src = fs.readFileSync(path.join(SCRIPTS, "send_cap.py"), "utf8");
  assert.doesNotMatch(src, /def remind|Time to upgrade Brevo/);
  // the monthly allowance and renewal day are repository variables, so a plan change changes no code
  assert.match(ch, /BREVO_MONTHLY: \$\{\{ vars\.BREVO_MONTHLY \}\}/);
  assert.match(ch, /BREVO_RENEW_DAY: \$\{\{ vars\.BREVO_RENEW_DAY \}\}/);
  assert.match(py("scripts/mail_budget.py", "--selftest"), /mail_budget selftest: 0 failed/);
});

test("a sender run as the program really wraps smtplib: counts, the cap marker, no address (runtime, not a grep)", async () => {
  // A tiny sender: delivery_line.start() as __main__, then real smtplib against a local server that takes
  // two messages and answers the third and fourth with a daily-limit refusal.
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sendcap-"));
  const script = path.join(dir, "tiny_sender.py");
  fs.writeFileSync(script, `
import socketserver, threading, smtplib, sys
sys.path.insert(0, sys.argv[1])
import delivery_line
N = {"data": 0}
class H(socketserver.StreamRequestHandler):
    def handle(self):
        w = lambda s: (self.wfile.write((s + "\\r\\n").encode()), self.wfile.flush())
        w("220 fake")
        data = False
        while True:
            l = self.rfile.readline()
            if not l: return
            l = l.decode().rstrip("\\r\\n")
            if data:
                if l == ".":
                    data = False; N["data"] += 1
                    w("250 ok" if N["data"] <= 2 else "550 5.7.1 You have exceeded your daily sending limit")
                continue
            u = l.upper()
            if u.startswith(("EHLO", "HELO")): w("250 fake")
            elif u.startswith("DATA"): data = True; w("354 go")
            elif u.startswith("QUIT"): w("221 bye"); return
            else: w("250 ok")
srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H); srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
t = delivery_line.start("daily")
print("wrapped=%s" % bool(smtplib.SMTP.__dict__.get("_send_cap_wrapped")))
t.waiting = 4
c = smtplib.SMTP("127.0.0.1", srv.server_address[1], timeout=5)
for i in range(4):
    try:
        c.sendmail("from@example.invalid", ["reader%d@example.invalid" % i], "Subject: x\\r\\n\\r\\nhi")
        t.sent += 1
    except smtplib.SMTPException as ex:
        print("refused " + type(ex).__name__)
c.quit()
`);
  const env = { ...process.env };
  delete env.DELIVERY_LINE_OFF;
  let out;
  try {
    out = execFileSync("python3", [script, SCRIPTS], { cwd: dir, encoding: "utf8", env, timeout: 60000 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.match(out, /^wrapped=True$/m, "delivery_line.start() as __main__ wraps smtplib.SMTP");
  assert.equal((out.match(/^SEND-CAP sender=daily kind=refused code=550 sent=2$/gm) || []).length, 1, out);
  assert.match(out, /^DELIVERY sender=daily sent_readers=2 waiting=4 dry=0 cap_refused=2 smtp=2$/m, out);
  assert.doesNotMatch(out, /@/, "no address in the output");
});

test("checker, PR 331: never slow a send, no false reds, never raise, stale markers ignored", () => {
  const out = py("scripts/send_cap.py", "--selftest");
  for (const name of [
    "a dead remote adds under 6 s, says unknown, and the send proceeds",
    "no saved count: said as unknown, never a warning",
    "mailbox over quota is not the cap",
    "a message size limit is not the cap",
    "the cap text on DATA is the cap",
    "every recipient refused, even for a limit, is a mailbox reply, never the cap",
    "one 421 is a note, no marker",
    "a second 421 in one run is the cap",
    "a tally whose extra is None: the wrapper raises nothing of its own",
    "note_refusal never raises",
    "a stale preflight marker is ignored before and after a rejudge",
    "a refusal stays red for the window, even with a raised cap",
    "the report-day projection adds the report-only list, each reader once",
  ]) assert.match(out, new RegExp(`^ok   ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), name);
  // the preflight runs only in the Daily, before it connects; the wrapper reads nothing over the network
  const daily = fs.readFileSync(path.join(SCRIPTS, "send_daily.py"), "utf8");
  assert.ok(daily.indexOf("send_cap.preflight(tally") < daily.indexOf("conn = connect()"), "the Daily's preflight runs before connecting");
  const cap = fs.readFileSync(path.join(SCRIPTS, "send_cap.py"), "utf8");
  const wrapper = cap.slice(cap.indexOf("def install("), cap.indexOf("# ───────────────────────────── 2. preflight"));
  assert.doesNotMatch(wrapper, /preflight\(|urlopen|list_source/, "the SMTP wrapper never runs the preflight or a network read");
});
