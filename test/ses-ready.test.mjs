/* Moving email from Gmail to Amazon SES is a change of secrets, not of code
 * (Oct 21, 2026). With SES, SMTP_HOST is email-smtp.<region>.amazonaws.com,
 * SMTP_PORT 587, SMTP_USER an access key id (NOT an address) and FROM_ADDR an
 * @agsist.com address. That holds only while:
 *   - every workflow step that hands a sender SMTP_PASS also hands it
 *     SMTP_HOST, SMTP_PORT and FROM_ADDR (daily.yml's send and critic steps
 *     and audit.yml's alert had no FROM_ADDR, and two had no SMTP_HOST);
 *   - no live script hardcodes smtp.gmail.com except as the SMTP_HOST default
 *     (notify_critic_status.py used SMTP_SSL("smtp.gmail.com", 465));
 *   - no sender builds From straight from SMTP_USER: with SES that is a key id
 *     in the From line. log_safe.sender_addr() keeps the Gmail fallback and
 *     stops with "FROM_ADDR is required when SMTP_USER is not an address".
 *
 *   node --test test/ses-ready.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const WF = ".github/workflows";
const workflows = fs.readdirSync(path.join(ROOT, WF)).filter((f) => /\.ya?ml$/.test(f)).map((f) => WF + "/" + f);

// Scripts no workflow runs. A dead script may keep its old Gmail-only code; the
// test below fails the day a workflow starts running one again.
const DEAD = new Set(["scripts/send_morning_brief.py"]);

/* Every `env:` block in a workflow, as { file, line, keys }. A block's keys are
 * the lines indented deeper than `env:` until the indent drops back. */
function envBlocks(file) {
  const lines = read(file).split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)env:\s*(#.*)?$/);
    if (!m) continue;
    const ind = m[1].length;
    const keys = new Set();
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim() || /^\s*#/.test(l)) continue;
      const li = l.match(/^(\s*)/)[1].length;
      if (li <= ind) break;
      const k = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/);
      if (k) keys.add(k[1]);
    }
    out.push({ file, line: i + 1, keys });
  }
  return out;
}

function pyFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === "__pycache__" || e.name === "node_modules") continue;
    const p = dir + "/" + e.name;
    if (e.isDirectory()) out.push(...pyFiles(p));
    else if (e.name.endsWith(".py")) out.push(p);
  }
  return out;
}

test("every workflow env with SMTP_PASS also has SMTP_HOST, SMTP_PORT and FROM_ADDR", () => {
  const blocks = workflows.flatMap(envBlocks).filter((b) => b.keys.has("SMTP_PASS"));
  assert.ok(blocks.length >= 20, "mail-sending env blocks found: " + blocks.length);
  const bad = [];
  for (const b of blocks) {
    const miss = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "FROM_ADDR"].filter((k) => !b.keys.has(k));
    if (miss.length) bad.push(`${b.file}:${b.line} lacks ${miss.join(", ")}`);
  }
  assert.deepEqual(bad, []);
});

test("daily.yml's send and critic steps and audit.yml's alert carry the SES secrets", () => {
  const d = read(WF + "/daily.yml");
  for (const step of ["Send daily email", "Notify critic status"]) {
    const s = d.slice(d.indexOf("- name: " + step), d.indexOf("- name: " + step) + 1500);
    assert.ok(s.startsWith("- name: " + step), step + " step found");
    for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "FROM_ADDR"]) assert.match(s, new RegExp("\\b" + k + ":\\s+\\$\\{\\{ secrets\\." + k + "\\b"), step + ": " + k);
  }
  assert.doesNotMatch(d, /GMAIL_APP_PASS:\s*\$\{\{/, "no step reads the Gmail-only secret names alone");
  const a = read(WF + "/audit.yml");
  assert.match(a, /FROM_ADDR:\s+\$\{\{ secrets\.FROM_ADDR \}\}/);
  assert.match(a, /os\.environ\.get\("FROM_ADDR"\)/, "the audit alert's From prefers FROM_ADDR");
  assert.doesNotMatch(a, /print\("emailed %s" % to\)/, "the audit alert does not print its recipient");
});

test("no live script hardcodes smtp.gmail.com except as the SMTP_HOST default", () => {
  const ALLOWED = [
    /\b(?:\w+\.)?env\("SMTP_HOST", "smtp\.gmail\.com"\)(?: or "smtp\.gmail\.com")?/g,
    /\b(?:\w+\.)?env\("SMTP_HOST"\) or "smtp\.gmail\.com"/g,
    /os\.environ\.get\("SMTP_HOST"\) or "smtp\.gmail\.com"/g,
    /\(os\.environ\.get\("SMTP_HOST"\) or ""\)\.strip\(\) or "smtp\.gmail\.com"/g,
    /is_gmail\("smtp\.gmail\.com"\)/g,   // gmail_limit's selftest input, not a host it connects to
  ];
  const files = pyFiles("scripts");
  assert.ok(files.length > 100, "python scripts found: " + files.length);
  const bad = [];
  let defaults = 0;
  for (const f of files) {
    if (DEAD.has(f)) continue;
    read(f).split("\n").forEach((l, i) => {
      let rest = l;
      for (const rx of ALLOWED) rest = rest.replace(rx, () => { defaults++; return "<default>"; });
      if (/["']smtp\.gmail\.com["']/.test(rest)) bad.push(`${f}:${i + 1} ${l.trim()}`);
      if (/SMTP_SSL\s*\(/.test(rest)) bad.push(`${f}:${i + 1} SMTP_SSL: ${l.trim()}`);
      if (/smtplib\.SMTP\(\s*["']/.test(rest)) bad.push(`${f}:${i + 1} literal host: ${l.trim()}`);
    });
  }
  assert.deepEqual(bad, []);
  assert.ok(defaults >= 15, "env defaults seen: " + defaults);
  for (const w of workflows) {
    const y = read(w);
    assert.doesNotMatch(y, /["']smtp\.gmail\.com["']/, w + " hardcodes smtp.gmail.com");
    for (const d of DEAD) assert.ok(!y.includes(path.basename(d)), `${w} runs ${d}, which still hardcodes Gmail`);
  }
});

test("no sender builds From from SMTP_USER directly; they all go through log_safe.sender_addr", () => {
  const RX = /FROM_ADDR["']\)\s*(?:or\s*""\s*\)?\s*(?:\.strip\(\)\s*)?)?or\s*(?:[\w.]*env\(["']SMTP_USER|os\.environ\.get\(["']SMTP_USER|user\b)/;
  const bad = [];
  for (const f of pyFiles("scripts")) {
    if (DEAD.has(f)) continue;
    read(f).split("\n").forEach((l, i) => { if (RX.test(l)) bad.push(`${f}:${i + 1} ${l.trim()}`); });
  }
  assert.deepEqual(bad, []);
});

const py = (code, env) => spawnSync("python3", ["-c", code], {
  cwd: ROOT, encoding: "utf8",
  env: { PATH: process.env.PATH, HOME: process.env.HOME || "", PYTHONDONTWRITEBYTECODE: "1", ...env },
});

// A fake smtplib.SMTP that records what the sender did with it.
const FAKE = `
import sys, json
sys.path.insert(0, 'scripts')
import smtplib
calls = []
class S:
    def __init__(self, host='', port=0, timeout=None):
        calls.append(['connect', host, port])
    def __enter__(self): return self
    def __exit__(self, *a): pass
    def starttls(self, context=None): calls.append(['starttls'])
    def login(self, u, p): calls.append(['login'])
    def send_message(self, m): calls.append(['send', m['From']])
    def quit(self): pass
def nossl(*a, **k): raise AssertionError('SMTP_SSL used')
smtplib.SMTP = S
smtplib.SMTP_SSL = nossl
`;

test("the critic alert uses SMTP_HOST and SMTP_PORT with STARTTLS, and FROM_ADDR as From", () => {
  const r = py(FAKE + "import notify_critic_status as n\nok = n.send('s', 'b')\nprint(json.dumps([ok, calls]))", {
    SMTP_HOST: "email-smtp.us-east-2.amazonaws.com", SMTP_PORT: "587",
    SMTP_USER: "AKIAEXAMPLEKEYID", SMTP_PASS: "x", FROM_ADDR: "news@agsist.com",
  });
  assert.equal(r.status, 0, r.stderr);
  const [ok, calls] = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(ok, true, r.stderr);
  assert.deepEqual(calls, [["connect", "email-smtp.us-east-2.amazonaws.com", 587], ["starttls"], ["login"], ["send", "news@agsist.com"]]);
});

test("the critic alert defaults to smtp.gmail.com:587 and still reads the legacy Gmail secret names", () => {
  const r = py(FAKE + "import notify_critic_status as n\nok = n.send('s', 'b')\nprint(json.dumps([ok, calls]))", {
    SMTP_HOST: "", SMTP_PORT: "", GMAIL_USER: "me@gmail.example", GMAIL_APP_PASS: "x",
  });
  assert.equal(r.status, 0, r.stderr);
  const [ok, calls] = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(ok, true, r.stderr);
  assert.deepEqual(calls, [["connect", "smtp.gmail.com", 587], ["starttls"], ["login"], ["send", "me@gmail.example"]]);
});

test("an SES login with no FROM_ADDR fails clearly and sends nothing, with no key in the log", () => {
  const r = py(FAKE + "import notify_critic_status as n\nok = n.send('s', 'b')\nprint(json.dumps([ok, calls]))", {
    SMTP_HOST: "email-smtp.us-east-2.amazonaws.com", SMTP_PORT: "587", SMTP_USER: "AKIAEXAMPLEKEYID", SMTP_PASS: "x", FROM_ADDR: "",
  });
  assert.equal(r.status, 0, r.stderr);
  const [ok, calls] = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(ok, false);
  assert.ok(!calls.some((c) => c[0] === "send"), "nothing sent");
  assert.match(r.stderr, /FROM_ADDR is required when SMTP_USER is not an address/);
  assert.doesNotMatch(r.stdout + r.stderr, /AKIAEXAMPLEKEYID/);
});

test("log_safe and gmail_limit selftests pass (sender_addr, and no Gmail warning on SES)", () => {
  for (const s of ["scripts/log_safe.py", "scripts/gmail_limit.py"]) {
    for (const host of ["", "email-smtp.us-east-2.amazonaws.com"]) {
      const r = spawnSync("python3", [s, "--selftest"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, SMTP_HOST: host, LIST_URL: "", LIST_TOKEN: "", GITHUB_STEP_SUMMARY: "" } });
      assert.equal(r.status, 0, `${s} SMTP_HOST=${host || "(empty)"}\n${r.stdout}\n${r.stderr}`);
    }
  }
});
