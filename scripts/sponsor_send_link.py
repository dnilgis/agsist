#!/usr/bin/env python3
"""
One sponsor's report link, emailed to that sponsor with a copy to Nov 5, 2026.

Run by hand only:.github/workflows/sponsor-send-link.yml (workflow_dispatch, inputs sponsor and resend).

    SPONSOR_ID=rootlot python3 scripts/sponsor_send_link.py           send once
    SPONSOR_ID=rootlot RESEND=1 python3 scripts/sponsor_send_link.py  send again
    SPONSOR_ID=rootlot DRY_RUN=1 python3 scripts/sponsor_send_link.py check everything, send nothing
    python3 scripts/sponsor_send_link.py --selftest                   offline checks, no network

Where each part comes from (the private repo, branch private-data, unpacked by scripts/pull_raw.sh
private/sponsors before this runs; SPONSOR_PRIVATE_DIR overrides the folder):
  * the link: private/sponsors/links.json, written by scripts/sponsor_publish.py publish in
    sponsor-report.yml, the same file #332's code writes. It must be signed (carry the approval key k).
  * the address: private/sponsors/contacts.json, key <id>.to (a sponsor with no application record,
    like Root Lot, is added there by hand). An optional first_name (or name) gives the greeting.
    No address on file: the run fails and says so; nothing is guessed.
  * The owner's copy: the SPONSOR_TO secret, the address sponsor_apply.py already copies the owner at
    (log_safe.OWNER_DEFAULT when unset).

It sends through the same SMTP secrets, From and message builder as scripts/sponsor_apply.py, counts
the send through delivery_line.start (the DELIVERY line and the send_cap.py SMTP count), and writes
private/sponsors/sent/<id>.json after a send; the workflow saves that folder to private-data, so a
rerun skips unless RESEND=1.

Nothing printed names an address, a person or the link: ids, counts and masked text only.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass

import json
import os
import smtplib
import ssl
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import delivery_line  # noqa: E402  (the DELIVERY count line; arms the send_cap.py SMTP count)
import email_links  # noqa: E402  (every link in the email is an agsist.com link)
import log_safe  # noqa: E402  (no address in the public log)
import sponsor_apply as sa  # noqa: E402  (the same From, message builder and SMTP setup)
import sponsor_publish as sp  # noqa: E402  (the private folder, the token mask, the link shape)

SUBJECT = "Your AGSIST ad report"
BUTTON = "Open your ad report"
SENT_NO_MARKER = "SENT, marker not written: do not rerun without resend"


class Stop(Exception):
    """A plain reason the link was not sent. Never carries an address or the link."""


def env(name, default=None):
    return sa.env(name, default)


def read_json(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except ValueError:
        raise Stop("%s is not valid JSON" % Path(p).name)


def first_name(rec):
    n = str(rec.get("first_name") or "").strip() or str(rec.get("name") or "").strip().split(" ")[0]
    return n if n and "@" not in n and len(n) <= 40 else ""


def gather(sid, d):
    """(link, to, first name) for sponsor sid from the private folder d, or Stop with a plain reason."""
    if not sp.SLUG_RE.match(sid or ""):
        raise Stop("the sponsor id must be a slug like rootlot")
    links = read_json(d / "links.json")
    if not links:
        raise Stop("private/sponsors/links.json is missing; run sponsor-report.yml first (nothing sent)")
    if links.get("signed") is not True:
        raise Stop("links.json is not signed (no approval key); run sponsor-report.yml with UNSUB_SECRET set (nothing sent)")
    link = (links.get("links") or {}).get(sid)
    if not link:
        raise Stop("no link for %s in links.json (nothing sent)" % sid)
    if not (link.startswith("%s/sponsor-report?r=%s-" % (sp.SITE, sid)) and "&k=" in link):
        raise Stop("the link for %s is not a signed agsist.com report link (nothing sent)" % sid)
    contacts = read_json(d / "contacts.json") or {}
    rec = contacts.get(sid) if isinstance(contacts.get(sid), dict) else {}
    to = str(rec.get("to") or "").strip()
    if not log_safe.EMAIL_RX.fullmatch(to):
        raise Stop("no contact address for %s: add %s.to to private/sponsors/contacts.json on private-data "
                   "(nothing sent)" % (sid, sid))
    return link, to, first_name(rec)


def build(to, cc, link, name, fn="AGSIST", fa=""):
    paras = ["Hi %s," % name if name else "Hello,",
             "This link shows your ad's views and clicks on AGSIST, updated daily through yesterday."]
    after = ["Bookmark it; it keeps working.",
             "Questions or changes? Just reply to this email and it goes to Sig."]
    m = sa.msg(to, SUBJECT, paras, button=(BUTTON, link), fn=fn, fa=fa, rt=cc, after=after)
    m["Cc"] = cc
    email_links.check_hosts(m)    # every link an agsist.com link (raises LinkError)
    return m


def marker_path(d, sid):
    return d / "sent" / ("%s.json" % sid)


def write_marker(mk, rec):
    mk.parent.mkdir(parents=True, exist_ok=True)
    mk.write_text(json.dumps(rec, indent=1) + "\n", encoding="utf-8")


def run(sid, d, sig, resend=False, dry=False, send=None, now=None, out=print, tally=None, mark=write_marker):
    """Returns 0 (sent, skipped or a clean dry run), 1 (not sent) or 2 (sent, marker not written).
    send(msg) delivers one message; mark(path, record) writes the sent marker."""
    tally = tally or delivery_line.Tally("sponsor-link", dry=dry)
    sp.mask(sp.load_tokens(d))    # Actions only: every token is blanked from the log before anything else
    try:
        link, to, name = gather(sid, d)
    except Stop as e:
        tally.waiting += 1        # a sponsor due the link and not sent: the delivery check sees it
        out("not sent: %s" % e)
        return 1
    mk = marker_path(d, sid)
    prev = read_json(mk)
    if prev and not resend:
        out("%s: the link was already sent (%s); skipped. Run again with resend=true to send it again."
            % (sid, str(prev.get("sent_utc") or "date not recorded")[:20]))
        return 0
    tally.waiting += 1
    fn, fa = env("FROM_NAME", "AGSIST"), log_safe.sender_addr()
    m = build(to, sig, link, name, fn=fn, fa=fa)
    if dry:
        out("dry run: %s would get the link, Sig copied; greeting %s; nothing sent"
            % (sid, "by first name" if name else "Hello"))
        return 0
    send(m)
    tally.sent += 1
    step_output("sent", "1")      # the workflow saves the marker only after a send, and says the email went
    when = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        mark(mk, {"id": sid, "sent_utc": when, "resend": bool(resend), "run": env("GITHUB_RUN_ID", "")})
    except Exception as e:                                   # noqa: BLE001  the email already went out
        out("%s: %s (%s)" % (sid, SENT_NO_MARKER, type(e).__name__))
        return 2
    out("%s: the report link went to the sponsor (1) with a copy to Sig%s" % (sid, " (resend)" if resend else ""))
    return 0


def step_output(key, value):
    """In Actions, a step output (GITHUB_OUTPUT). Never raises: the send already happened."""
    p = os.environ.get("GITHUB_OUTPUT")
    if not p:
        return
    try:
        with open(p, "a", encoding="utf-8") as f:
            f.write("%s=%s\n" % (key, value))
    except Exception:                                        # noqa: BLE001
        pass


def smtp_send(m):
    conn = smtplib.SMTP(env("SMTP_HOST", "smtp.gmail.com"), int(env("SMTP_PORT", "587")), timeout=30)
    try:
        conn.starttls(context=ssl.create_default_context())
        conn.login(env("SMTP_USER"), env("SMTP_PASS"))
        conn.send_message(m)
    finally:
        try:
            conn.quit()
        except Exception:                                    # noqa: BLE001
            pass


def main():
    if "--selftest" in sys.argv:
        return selftest()
    dry = env("DRY_RUN") == "1"
    tally = delivery_line.start("sponsor-link", dry=dry)
    sid = (env("SPONSOR_ID") or "").strip().lower()
    sig = env("SPONSOR_TO") or log_safe.OWNER_DEFAULT
    if not dry and not (env("SMTP_USER") and env("SMTP_PASS")):
        tally.waiting += 1
        print("not sent: SMTP_USER and SMTP_PASS are required")
        return 1
    try:
        return run(sid, sp.private_dir(), sig, resend=env("RESEND") in ("1", "true"), dry=dry,
                   send=smtp_send, tally=tally)
    except Exception as e:                                   # noqa: BLE001
        # mask_text: an SMTPRecipientsRefused message carries the address
        print("not sent: %s" % log_safe.mask_text("%s: %s" % (type(e).__name__, e)))
        return 1


# ───────────────────────────── selftest ─────────────────────────────

def selftest():
    import contextlib
    import io
    import tempfile
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else "  -- %s" % (detail,)))
        if not ok:
            fails.append(name)

    tok = "1" * 16
    link = "%s/sponsor-report?r=barnco-%s&k=%s" % (sp.SITE, tok, "2" * 16)
    to, sig = "pat@barnco.example", "owner@agsist.example"

    def setup(d, links=True, signed=True, contact=True, first="Pat"):
        (d / "tokens").mkdir(parents=True, exist_ok=True)
        (d / "tokens" / "barnco.json").write_text(json.dumps({"slug": "barnco", "token": tok, "retired": []}))
        if links:
            (d / "links.json").write_text(json.dumps({"signed": signed, "links": {"barnco": link}}))
        c = {"barnco": {"to": to, "first_name": first}} if contact else {"other": {"to": "x@y.example"}}
        (d / "contacts.json").write_text(json.dumps(c))

    def go(d, **kw):
        sent, lines = [], []
        t = delivery_line.Tally("sponsor-link", dry=kw.get("dry", False))
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = run(kw.pop("sid", "barnco"), d, sig, send=sent.append, out=lines.append, tally=t,
                     now=datetime(2026, 11, 5, 15, 0, tzinfo=timezone.utc), **kw)
        return rc, sent, lines + buf.getvalue().splitlines(), t

    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp) / "a"
        setup(d)
        rc, sent, lines, t = go(d)
        m = sent[0] if sent else None
        ck("one message, exit 0", rc == 0 and len(sent) == 1, (rc, len(sent)))
        ck("To is the record's address, Cc is Sig, Reply-To is Sig",
           m is not None and m["To"] == to and m["Cc"] == sig and m["Reply-To"] == sig, m and (m["To"], m["Cc"]))
        body = m.get_body(("plain",)).get_content() if m else ""
        html = m.get_body(("html",)).get_content() if m else ""
        ck("subject", m is not None and m["Subject"] == SUBJECT)
        ck("the link is in both parts", link in body and link.replace("&", "&amp;") in html)
        ck("greets by first name", body.startswith("Hi Pat,"), body[:20])
        ck("bookmark line after the button", body.index("Bookmark it; it keeps working.") > body.index(link))
        ck("no em dash", "—" not in body + html + m["Subject"])
        ck("counted: 1 waiting, 1 sent", (t.waiting, t.sent) == (1, 1), (t.waiting, t.sent))
        ck("marker written", marker_path(d, "barnco").is_file())
        # In Actions the token's own ::add-mask:: line is printed (sponsor_publish.mask); no other
        # line may carry the token or an address.
        rest = [x for x in lines if not x.startswith("::add-mask::")]
        ck("nothing printed has an address or the link", not any("@" in x or tok in x for x in rest), lines)
        ck("a mask line is printed in Actions only",
           (os.environ.get("GITHUB_ACTIONS") == "true") == any(x.startswith("::add-mask::") for x in lines), lines)
        rc, sent, lines, t = go(d)
        ck("a second run skips", rc == 0 and not sent and (t.waiting, t.sent) == (0, 0) and "already sent" in lines[0], lines)
        rc, sent, lines, t = go(d, resend=True)
        ck("resend sends again", rc == 0 and len(sent) == 1)

        d2 = Path(tmp) / "b"
        setup(d2, contact=False)
        rc, sent, lines, t = go(d2)
        ck("no address: exit 1, nothing sent, said plainly", rc == 1 and not sent and "no contact address for barnco" in lines[0], lines)
        ck("no address: counted as a reader waiting", (t.waiting, t.sent) == (1, 0))
        ck("no address: no marker", not marker_path(d2, "barnco").exists())

        d3 = Path(tmp) / "c"
        setup(d3, signed=False)
        rc, sent, lines, t = go(d3)
        ck("an unsigned links.json is refused", rc == 1 and not sent and "not signed" in lines[0], lines)
        d4 = Path(tmp) / "d"
        setup(d4, links=False)
        rc, sent, lines, t = go(d4)
        ck("no links.json is refused", rc == 1 and not sent, lines)
        rc, sent, lines, t = go(d, sid="../x")
        ck("a bad id is refused", rc == 1 and not sent, lines)
        rc, sent, lines, t = go(d, sid="nobody")
        ck("an id with no link is refused", rc == 1 and not sent and "no link for nobody" in lines[0], lines)

        d5 = Path(tmp) / "e"
        setup(d5, first="")
        rc, sent, lines, t = go(d5, dry=True)
        ck("dry run: nothing sent, no marker, exit 0", rc == 0 and not sent and not marker_path(d5, "barnco").exists(), lines)
        ck("dry run: greeting falls back to Hello", "Hello" in lines[0], lines)
        rc, sent, lines, t = go(d5)
        ck("no first name: Hello,", sent and sent[0].get_body(("plain",)).get_content().startswith("Hello,"))

        d6 = Path(tmp) / "f"
        setup(d6)
        def broken(mk, rec):
            raise OSError("disk full")
        rc, sent, lines, t = go(d6, mark=broken)
        ck("marker write fails after a send: exit non-zero", rc != 0 and len(sent) == 1, (rc, len(sent)))
        ck("marker write fails: says SENT, never 'not sent'",
           any(SENT_NO_MARKER in x for x in lines) and not any("not sent" in x for x in lines), lines)
        ck("marker write fails: the send is still counted", (t.waiting, t.sent) == (1, 1))

    print("sponsor_send_link selftest: %d failed" % len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
