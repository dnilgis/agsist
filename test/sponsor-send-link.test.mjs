/* The sponsor report link email (Sig, Nov 5, 2026: email the link straight to the sponsor and copy me).
 * scripts/sponsor_send_link.py run as the program, with real smtplib against a local fake mail server
 * (STARTTLS and login stubbed in the harness only), on a made-up private folder:
 *   - To is the record's address, Cc is Sig, the signed link is in the message;
 *   - a missing address fails with a plain message and sends nothing;
 *   - a second run skips; resend sends again;
 *   - nothing printed holds an @ address or the link; the DELIVERY line counts the send (send_cap smtp=).
 * And the workflow: by hand only, inputs sponsor and resend, the private pull before the send.
 *
 *   node --test test/sponsor-send-link.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT = path.join(ROOT, "scripts/sponsor_send_link.py");
const TOK = "1".repeat(16);
const LINK = `https://agsist.com/sponsor-report?r=barnco-${TOK}&k=${"2".repeat(16)}`;
const TO = "pat@barnco.example";
const SIG = "owner@agsist.example";

const HARNESS = `
import json, os, runpy, smtplib, socketserver, sys, threading
OUT = sys.argv[2]
class H(socketserver.StreamRequestHandler):
    def handle(self):
        w = lambda s: (self.wfile.write((s + "\\r\\n").encode()), self.wfile.flush())
        w("220 fake")
        data, buf, rcpt = False, [], []
        while True:
            l = self.rfile.readline()
            if not l: return
            l = l.decode().rstrip("\\r\\n")
            if data:
                if l == ".":
                    data = False
                    with open(OUT, "a") as f: f.write(json.dumps({"rcpt": rcpt, "data": "\\n".join(buf)}) + "\\n")
                    buf, rcpt = [], []
                    w("250 ok")
                else: buf.append(l[1:] if l.startswith("..") else l)
                continue
            u = l.upper()
            if u.startswith(("EHLO", "HELO")): w("250 fake")
            elif u.startswith("RCPT"): rcpt.append(l.split(":", 1)[1].strip().strip("<>")); w("250 ok")
            elif u.startswith("DATA"): data = True; w("354 go")
            elif u.startswith("QUIT"): w("221 bye"); return
            else: w("250 ok")
srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H); srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ["SMTP_HOST"], os.environ["SMTP_PORT"] = "127.0.0.1", str(srv.server_address[1])
smtplib.SMTP.starttls = lambda self, *a, **k: (220, b"ok")    # the fake server speaks no TLS
smtplib.SMTP.login = lambda self, *a, **k: (235, b"ok")
sys.argv = [sys.argv[1]]
runpy.run_path(sys.argv[0], run_name="__main__")
`;

function setup({ contact = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sponsorlink-"));
  const priv = path.join(dir, "private", "sponsors");
  fs.mkdirSync(path.join(priv, "tokens"), { recursive: true });
  fs.writeFileSync(path.join(priv, "tokens", "barnco.json"), JSON.stringify({ slug: "barnco", token: TOK, retired: [] }));
  fs.writeFileSync(path.join(priv, "links.json"), JSON.stringify({ signed: true, links: { barnco: LINK } }));
  fs.writeFileSync(path.join(priv, "contacts.json"), JSON.stringify(contact ? { barnco: { to: TO } } : {}));
  fs.writeFileSync(path.join(dir, "harness.py"), HARNESS);
  return { dir, priv, mail: path.join(dir, "mail.jsonl") };
}

function run(s, extra = {}) {
  const env = { ...process.env, SPONSOR_PRIVATE_DIR: s.priv, SPONSOR_ID: "barnco", SPONSOR_TO: SIG,
    SMTP_USER: "login@agsist.example", SMTP_PASS: "x", FROM_ADDR: "news@agsist.example", FROM_NAME: "AGSIST", ...extra };
  delete env.DELIVERY_LINE_OFF;
  delete env.GITHUB_ACTIONS;
  for (const k of ["RESEND", "DRY_RUN"]) if (!(k in extra)) delete env[k];
  const r = spawnSync("python3", [path.join(s.dir, "harness.py"), SCRIPT, s.mail], { cwd: ROOT, env, encoding: "utf8", timeout: 60000 });
  const mail = fs.existsSync(s.mail) ? fs.readFileSync(s.mail, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), mail };
}

const header = (data, name) => (data.match(new RegExp(`^${name}: (.*)$`, "mi")) || [])[1];

test("the link goes to the record's address with Sig copied, once; resend sends again; nothing printed names anyone", () => {
  const s = setup();
  try {
    const a = run(s);
    assert.equal(a.code, 0, a.out);
    assert.equal(a.mail.length, 1, a.out);
    const m = a.mail[0];
    assert.deepEqual(m.rcpt.sort(), [SIG, TO].sort(), "the server is handed the sponsor and Sig");
    assert.equal(header(m.data, "To"), TO);
    assert.equal(header(m.data, "Cc"), SIG);
    assert.equal(header(m.data, "Reply-To"), SIG);
    assert.equal(header(m.data, "Subject"), "Your AGSIST ad report");
    const flat = m.data.replace(/=\n/g, "").replace(/=3D/g, "=");
    assert.ok(flat.includes(LINK), "the signed link is in the message");
    assert.match(flat, /Bookmark it; it keeps working\./);
    assert.match(flat, /updated daily through yesterday/);
    assert.doesNotMatch(m.data, /—|=E2=80=94/, "no em dash");
    assert.ok(fs.existsSync(path.join(s.priv, "sent", "barnco.json")), "the sent marker is written");
    assert.match(a.out, /^DELIVERY sender=sponsor-link sent_readers=1 waiting=1 dry=0 smtp=2$/m, a.out);
    assert.doesNotMatch(a.out, /@/, "no address in the output");
    assert.ok(!a.out.includes(TOK), "the token is never printed");

    fs.rmSync(s.mail);
    const b = run(s);
    assert.equal(b.code, 0, b.out);
    assert.equal(b.mail.length, 0, "a second run sends nothing");
    assert.match(b.out, /already sent/);
    assert.match(b.out, /^DELIVERY sender=sponsor-link sent_readers=0 waiting=0 dry=0$/m, b.out);
    assert.doesNotMatch(b.out, /@/);

    const c = run(s, { RESEND: "1" });
    assert.equal(c.code, 0, c.out);
    assert.equal(c.mail.length, 1, "resend sends again");
    assert.doesNotMatch(c.out, /@/);
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test("no address on file: a plain failure, nothing sent, no marker, no address guessed", () => {
  const s = setup({ contact: false });
  try {
    const r = run(s);
    assert.equal(r.code, 1, r.out);
    assert.equal(r.mail.length, 0);
    assert.match(r.out, /not sent: no contact address for barnco: add barnco\.to to private\/sponsors\/contacts\.json/);
    assert.match(r.out, /^DELIVERY sender=sponsor-link sent_readers=0 waiting=1 dry=0$/m, "a reader waiting, none mailed: the delivery check sees red");
    assert.ok(!fs.existsSync(path.join(s.priv, "sent", "barnco.json")));
    assert.doesNotMatch(r.out, /@/);
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test("a dry run reads everything, sends nothing and writes no marker", () => {
  const s = setup();
  try {
    const r = run(s, { DRY_RUN: "1" });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.mail.length, 0);
    assert.match(r.out, /dry run: barnco would get the link/);
    assert.ok(!fs.existsSync(path.join(s.priv, "sent")));
    assert.doesNotMatch(r.out, /@/);
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test("checker, PR 336: a send that succeeds and a marker write that fails says SENT, exits non-zero, and tells the workflow", () => {
  const s = setup();
  try {
    const ghout = path.join(s.dir, "gh_output");
    const code = `
import sys
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "scripts"))})
import delivery_line, sponsor_send_link as s
from pathlib import Path
sent = []
def broken(mk, rec):
    raise OSError("disk full")
t = delivery_line.Tally("sponsor-link")
rc = s.run("barnco", Path(${JSON.stringify(s.priv)}), "owner@agsist.example", send=sent.append, tally=t, mark=broken)
print("rc=%d sent=%d counted=%d" % (rc, len(sent), t.sent))
`;
    const env = { ...process.env, GITHUB_OUTPUT: ghout, DELIVERY_LINE_OFF: "1" };
    delete env.GITHUB_ACTIONS;
    const r = spawnSync("python3", ["-c", code], { cwd: ROOT, env, encoding: "utf8", timeout: 60000 });
    const out = (r.stdout || "") + (r.stderr || "");
    assert.match(out, /^barnco: SENT, marker not written: do not rerun without resend \(OSError\)$/m, out);
    assert.match(out, /^rc=2 sent=1 counted=1$/m, out);
    assert.doesNotMatch(out, /not sent/, "never says not sent after a send");
    assert.doesNotMatch(out, /@/);
    assert.equal(fs.readFileSync(ghout, "utf8"), "sent=1\n", "the workflow learns a send happened");
    assert.ok(!fs.existsSync(path.join(s.priv, "sent")));
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test("the workflow: by hand only, sponsor and resend inputs, private pull before the send, hard marker save", () => {
  const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/sponsor-send-link.yml"), "utf8");
  const on = wf.slice(wf.indexOf("\non:"), wf.indexOf("\nconcurrency:"));
  assert.doesNotMatch(on, /schedule:|workflow_run:|push:|pull_request/, "no trigger but workflow_dispatch");
  assert.match(on, /workflow_dispatch:/);
  assert.match(on, /\n {6}sponsor:\n[\s\S]*?required: true/);
  assert.match(on, /\n {6}resend:\n[\s\S]*?type: boolean\n\s+default: false/);
  // inputs reach the script through env, never pasted into a shell line
  assert.doesNotMatch(wf, /run: [^\n]*\$\{\{ *inputs\./);
  const pull = wf.indexOf("bash scripts/pull_raw.sh private/sponsors");
  const send = wf.indexOf("run: python3 scripts/sponsor_send_link.py\n");
  const save = wf.indexOf('bash scripts/push_raw.sh "sponsor link sent" private/sponsors/sent');
  assert.ok(pull > 0 && send > pull && save > send, "pull, then send, then save the marker");
  assert.match(wf, /SPONSOR_TO: \$\{\{ secrets\.SPONSOR_TO \}\}/, "Sig's copy comes from the secret sponsor-apply uses");
  const saveStep = wf.slice(wf.indexOf("- name: Save the sent marker"));
  assert.doesNotMatch(saveStep, /RAW_SOFT/, "the marker save is hard");
  assert.match(wf, /- name: Send the link\n\s+id: send\n/);
  assert.match(saveStep, /\n\s+if: steps\.send\.outputs\.sent == '1'\n/, "the marker is saved only after a send");
  assert.match(saveStep, /::error::SENT, marker not saved: the email already went out\. Do not rerun without resend\.[^\n]*\n\s+exit 1/,
    "a failed save after a send says the email went out and fails the run");
});

// Nov 5: the first dispatch failed its own selftest because in Actions the token's ::add-mask:: line is printed
// and the selftest read it as a leak. The selftest must pass both inside and outside Actions.
test("the script's selftest passes inside and outside Actions", () => {
  for (const gha of [undefined, "true"]) {
    const env = { ...process.env };
    if (gha) env.GITHUB_ACTIONS = gha; else delete env.GITHUB_ACTIONS;
    const r = spawnSync("python3", ["scripts/sponsor_send_link.py", "--selftest"], { env, cwd: ROOT, encoding: "utf8" });
    assert.equal(r.status, 0, `GITHUB_ACTIONS=${gha || "unset"}: ${(r.stdout || "").split("\n").filter(l => l.includes("FAIL")).join(" | ")}`);
    assert.match(r.stdout, /selftest: 0 failed/);
  }
});
