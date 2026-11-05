#!/usr/bin/env python3
"""Run a command and print only how it ended (Nov 5, 2026: the repository and its Actions logs are public).

    python3 scripts/dev/quiet.py NAME -- COMMAND [ARGS...]
    python3 scripts/dev/quiet.py --selftest

Prints "NAME: ok" or "NAME: failed (exit N), <last line>", plus any output line on the allow-list
(KEEP below: DELIVERY and SEND-CAP lines, workflow commands such as ::warning:: and ::error::, and
marker count lines like "RAIN-WX updated=1 stale=0"). Nothing else reaches the log. The full output
goes to QUIET_LOG_DIR (default $RUNNER_TEMP/quiet, outside the checkout, never uploaded) as NAME.log.
Exits with the command's own code. QUIET_OFF=1 passes every line through (a run by hand to debug).
"""
import os
import re
import signal
import subprocess
import sys
import tempfile

KEEP = [
    re.compile(r"^DELIVERY sender="),
    re.compile(r"^SEND-CAP sender="),
    re.compile(r"^::(?:warning|error|notice|add-mask)\b"),
    # a marker and key=value counts only, e.g. "RAIN-WX updated=1 stale=0" or "COUNTS pages=12"
    re.compile(r"^[A-Z][A-Z0-9-]{2,}(?: [a-z][a-z0-9_]*=[A-Za-z0-9_.:+-]*)+$"),
]
LAST_MAX = 200
# anything that looks like a token: a run of 16 or more hex characters, or a k= / t= value
TOKEN = re.compile(r"[0-9A-Fa-f]{16,}|\b[kt]=[^\s&\"']+")


def mask(text):
    return TOKEN.sub("***", text)


def keep(line):
    t = line.strip()
    return any(rx.search(t) for rx in KEEP)


def log_dir():
    d = os.environ.get("QUIET_LOG_DIR") or os.path.join(os.environ.get("RUNNER_TEMP") or tempfile.gettempdir(), "quiet")
    os.makedirs(d, exist_ok=True)
    return d


def run(name, cmd, out=sys.stdout):
    """Run cmd; write every line to the log file, print the kept ones; return the exit code."""
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", name)[:60] or "step"
    path = os.path.join(log_dir(), safe + ".log")
    passthru = os.environ.get("QUIET_OFF") == "1"
    env = dict(os.environ, PYTHONUNBUFFERED="1")
    last = ""
    try:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
    except OSError as e:
        print("%s: failed (exit 127), %s" % (name, mask(str(e))[:LAST_MAX]), file=out, flush=True)
        return 127

    def forward(sig, _frame):
        try:
            p.send_signal(sig)
        except OSError:
            pass
    old = {s: signal.signal(s, forward) for s in (signal.SIGTERM, signal.SIGINT)}
    try:
        with open(path, "a", encoding="utf-8", errors="replace") as log:
            for raw in iter(p.stdout.readline, b""):
                line = raw.decode("utf-8", "replace").rstrip("\r\n")
                log.write(line + "\n")
                if line.strip():
                    last = line.strip()
                if passthru or keep(line):
                    print(line, file=out, flush=True)
        code = p.wait()
    finally:
        for s, h in old.items():
            signal.signal(s, h)
    if code < 0:
        code = 128 - code
    if code == 0:
        print("%s: ok" % name, file=out, flush=True)
    else:
        print("%s: failed (exit %d), %s" % (name, code, mask(last)[:LAST_MAX] or "no output"), file=out, flush=True)
    return code


def selftest():
    import io
    fails = []

    def ck(cond, what):
        print(("ok   " if cond else "FAIL ") + what)
        if not cond:
            fails.append(what)

    with tempfile.TemporaryDirectory() as d:
        os.environ["QUIET_LOG_DIR"] = d
        os.environ.pop("QUIET_OFF", None)
        script = ("print('station A skipped: 0.00 for 8 days'); print('DELIVERY sender=daily sent_readers=3 waiting=0 dry=0');"
                  "print('::warning::slow source'); print('RAIN-WX updated=1 stale=0'); print('NE: 85 counties');"
                  "print('SEND-CAP sender=daily kind=refused code=550 sent=180'); import sys; sys.exit(%d)")
        buf = io.StringIO()
        code = run("t", [sys.executable, "-c", script % 0], out=buf)
        got = buf.getvalue().splitlines()
        ck(code == 0, "exit 0 is kept")
        ck(got == ["DELIVERY sender=daily sent_readers=3 waiting=0 dry=0", "::warning::slow source", "RAIN-WX updated=1 stale=0",
                   "SEND-CAP sender=daily kind=refused code=550 sent=180", "t: ok"], "only the allow-listed lines and ok: %r" % got)
        full = open(os.path.join(d, "t.log"), encoding="utf-8").read()
        ck("station A skipped" in full and "NE: 85 counties" in full, "the full output is in the log file")
        buf = io.StringIO()
        code = run("t2", [sys.executable, "-c", "import sys; print('rows'); print('ValueError: bad row', file=sys.stderr); sys.exit(3)"], out=buf)
        ck(code == 3 and buf.getvalue() == "t2: failed (exit 3), ValueError: bad row\n", "exit 3 is kept with the last line: %r" % buf.getvalue())
        buf = io.StringIO()
        code = run("t3", ["/nonexistent/cmd"], out=buf)
        ck(code == 127 and buf.getvalue().startswith("t3: failed (exit 127)"), "a missing command is exit 127")
        buf = io.StringIO()
        code = run("t4", [sys.executable, "-c", "import os, signal; os.kill(os.getpid(), signal.SIGTERM)"], out=buf)
        ck(code == 143 and "failed (exit 143)" in buf.getvalue(), "a command killed by a signal is 128 + the signal")
        buf = io.StringIO()
        run("t6", [sys.executable, "-c", "import sys; print('bad link /x?k=abc123def&t=zz9 id 0123456789abcdef0123 ok', file=sys.stderr); sys.exit(1)"], out=buf)
        ck(buf.getvalue() == "t6: failed (exit 1), bad link /x?***&*** id *** ok\n", "tokens are masked in the failure line: %r" % buf.getvalue())
        ck(mask("deadbeef12345678") == "***" and mask("deadbeef1234567") == "deadbeef1234567", "16 hex characters mask, 15 do not")
        for t in ("DELIVERYsender=x", "RAIN-WX skipping YAKUTAT AIRPORT", "Rain-wx updated=1", "ok   a test name", "  rows=3",
                  "COUNTS: a=1", "::group::x"):
            ck(not keep(t), "not kept: %r" % t)
        os.environ["QUIET_OFF"] = "1"
        buf = io.StringIO()
        run("t5", [sys.executable, "-c", "print('detail')"], out=buf)
        ck(buf.getvalue() == "detail\nt5: ok\n", "QUIET_OFF=1 passes every line")
        os.environ.pop("QUIET_OFF", None)
        os.environ.pop("QUIET_LOG_DIR", None)
    print("\n%d failed" % len(fails) if fails else "\nall quiet checks passed")
    return 1 if fails else 0


def main(argv):
    if argv[:1] in (["-h"], ["--help"]):
        print(__doc__.strip())
        return 0
    if argv[:1] == ["--selftest"]:
        return selftest()
    if len(argv) < 3 or argv[1] != "--" or argv[0].startswith("-"):
        print("usage: quiet.py NAME -- COMMAND [ARGS...]", file=sys.stderr)
        return 2
    return run(argv[0], argv[2:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
