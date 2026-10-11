#!/usr/bin/env python3
"""
Site forms digest (2026-10-11): emails Sig what came in through the three
forms that used to go to Formspree.

  elevators.html      claim your board               kind claim
  sponsor-report.html approval and requests box      kind sponsor-feedback
  farmland-atlas.html Parcel Report waitlist         kind atlas-feedback

The pages post to the subs worker (POST /form, workers/subs-worker.js v5.8),
which stores each post in KV under form:<kind>:<ms>:<rand>. This job reads the
ones not yet mailed (GET /form-list?new=1), sends Sig ONE email listing them,
then marks them mailed (POST /form-mark). Mark after send: a failed send leaves
them unmarked and the next run tries again. Nothing is written to the repo.

The Actions log gets counts only, never a name, address or phone.

    python3 scripts/form_digest.py              (needs LIST_URL, LIST_TOKEN, SMTP_USER, SMTP_PASS)
    python3 scripts/form_digest.py --selftest   offline checks, no network, no mail
    DRY_RUN=1 ...                                print the counts, send and mark nothing

Optional: SMTP_HOST, SMTP_PORT, FROM_ADDR, FROM_NAME, FORMS_TO (else
SPONSOR_TO, else sig@farmers1st.com).
"""
import html as H
import json
import os
import re
import smtplib
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

try:
    from zoneinfo import ZoneInfo
    CT = ZoneInfo("America/Chicago")
except Exception:                                          # noqa: BLE001
    CT = None

ADDRESS = "AGSIST, PO Box 243, Chetek, WI 54728"
KINDS = ("claim", "sponsor-feedback", "atlas-feedback")
KIND_NAME = {"claim": "Elevator claim", "sponsor-feedback": "Sponsor request", "atlas-feedback": "Parcel Report waitlist"}
# The order and labels each kind prints in. Anything else stored is ignored.
FIELDS = {
    "claim": [("elevator", "Elevator or co-op"), ("town", "Town"), ("state", "State"), ("contact_name", "Contact"),
              ("role", "Role"), ("email", "Work email"), ("phone", "Phone"), ("bid_page_url", "Bid page"),
              ("hosted_board", "Tell me about a hosted bid board")],
    "sponsor-feedback": [("request", "Request"), ("sponsor", "Sponsor"), ("proof", "Proof code"), ("email", "Reply to"),
                         ("message", "Message")],
    "atlas-feedback": [("email", "Email"), ("source", "Source")],
}


def env(name, default=None):
    v = os.environ.get(name)
    return v if v not in (None, "") else default


def when(ts):
    try:
        d = datetime.fromtimestamp(ts / 1000, timezone.utc)
    except Exception:                                      # noqa: BLE001
        return ""
    d = d.astimezone(CT) if CT else d
    return d.strftime("%b ") + str(d.day) + d.strftime(", %-I:%M %p ") + ("CT" if CT else "UTC")


def counts(posts):
    c = {k: 0 for k in KINDS}
    for p in posts:
        if p.get("kind") in c:
            c[p["kind"]] += 1
    return c


def count_line(c):
    return ", ".join("%s %d" % (k, c[k]) for k in KINDS)


def usable(posts):
    return [p for p in posts if isinstance(p, dict) and p.get("kind") in FIELDS and isinstance(p.get("key"), str)]


def subject(posts):
    c = counts(posts)
    parts = ["%d %s" % (c[k], KIND_NAME[k].lower() + ("s" if c[k] != 1 and k != "atlas-feedback" else "")) for k in KINDS if c[k]]
    if len(posts) == 1:
        p = posts[0]
        if p["kind"] == "claim":
            return "Claim your board: %s, %s %s" % (p.get("elevator", ""), p.get("town", ""), p.get("state", ""))
        if p["kind"] == "sponsor-feedback":
            return p.get("subject") or "AGSIST portal: %s (%s)" % (p.get("request", ""), p.get("sponsor", ""))
        return "Parcel Report interest"
    return "AGSIST forms: %s" % ", ".join(parts)


def blocks(posts):
    """-> [(heading, [(label, value)])] in arrival order."""
    out = []
    for p in sorted(posts, key=lambda x: x.get("ts") or 0):
        rows = [(lab, str(p[f])) for f, lab in FIELDS[p["kind"]] if p.get(f) not in (None, "")]
        out.append(("%s, %s" % (KIND_NAME[p["kind"]], when(p.get("ts") or 0)), rows))
    return out


def build(posts, to, fn="AGSIST", fa=""):
    m = EmailMessage()
    m["Subject"] = subject(posts)
    m["From"] = formataddr((fn, fa))
    m["To"] = to
    m["Message-ID"] = make_msgid(domain=(fa.split("@", 1)[1] if "@" in fa else "agsist.com"))
    # One post with an address: Reply goes straight to that person, the way
    # Formspree's emails did. With several, Sig picks from the links.
    if len(posts) == 1 and re.fullmatch(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", str(posts[0].get("email") or "")):
        m["Reply-To"] = posts[0]["email"]
    bl = blocks(posts)
    text = []
    for head, rows in bl:
        text.append(head)
        text.extend("%s: %s" % (lab, val) for lab, val in rows)
        text.append("")
    text.append("Sent from the forms on agsist.com. Nothing on the site changes until you act on it.")
    m.set_content("\n".join(text) + "\n\n-- \n" + ADDRESS + "\n")
    e = H.escape
    hb = []
    for head, rows in bl:
        hb.append('<h3 style="font-size:15px;margin:18px 0 6px">%s</h3>' % e(head))
        hb.append('<table style="font-size:14px;line-height:1.5;border-collapse:collapse">')
        for lab, val in rows:
            v = e(val).replace("\n", "<br>")
            if lab in ("Work email", "Email", "Reply to"):
                v = '<a href="mailto:%s">%s</a>' % (e(val, quote=True), e(val))
            hb.append('<tr><td style="color:#6b6b6b;padding:2px 12px 2px 0;vertical-align:top">%s</td><td>%s</td></tr>' % (e(lab), v))
        hb.append("</table>")
    m.add_alternative('<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:20px 16px;color:#1a1a1a;background:#fff">'
                      '%s<p style="font-size:13px;color:#6b6b6b;margin-top:20px">Sent from the forms on agsist.com. '
                      'Nothing on the site changes until you act on it.<br>%s</p></div>' % ("".join(hb), e(ADDRESS)), subtype="html")
    return m


def worker(base, path, tok, body=None, **q):
    url = "%s/%s?%s" % (base, path, urllib.parse.urlencode(dict(q, token=tok)))
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET",
                                 headers={"Content-Type": "application/json", "User-Agent": "agsist-form-digest"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def run(base, tok, to, dry, send, fetch=worker):
    """Returns (exit code, log lines). Log lines carry counts only."""
    log = []
    try:
        posts = fetch(base, "form-list", tok, new="1")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            log.append("worker has no /form-list yet (deploy workers/subs-worker.js v5.8); nothing to do")
            return 0, log
        log.append("form-list failed: HTTP %d" % e.code)
        return 1, log
    except Exception as e:                                 # noqa: BLE001
        log.append("form-list failed: %s" % type(e).__name__)
        return 1, log
    if not isinstance(posts, list):
        log.append("form-list answered something other than a list")
        return 1, log
    posts = usable(posts)
    log.append("new form posts: %s" % count_line(counts(posts)))
    if not posts or dry:
        return 0, log
    try:
        send(build(posts, to))
    except Exception as e:                                 # noqa: BLE001
        log.append("send failed (%s); left unmarked for the next run" % type(e).__name__)
        return 1, log
    try:
        r = fetch(base, "form-mark", tok, {"keys": [p["key"] for p in posts]})
        log.append("mailed %d; marked %s" % (len(posts), r.get("marked") if isinstance(r, dict) else "?"))
    except Exception as e:                                 # noqa: BLE001
        log.append("mailed %d; mark failed (%s), the next run may repeat them" % (len(posts), type(e).__name__))
        return 1, log
    return 0, log


def main():
    if "--selftest" in sys.argv:
        return selftest()
    base = (env("LIST_URL") or "").strip()
    u = urllib.parse.urlsplit(base)
    base = "%s://%s" % (u.scheme, u.netloc) if u.scheme and u.netloc else ""
    tok = (env("LIST_TOKEN") or "").strip()
    if not (base and tok):
        print("LIST_URL and LIST_TOKEN are required")
        return 1
    dry = env("DRY_RUN") == "1"
    to = env("FORMS_TO") or env("SPONSOR_TO") or "sig@farmers1st.com"
    fn, fa = env("FROM_NAME", "AGSIST"), env("FROM_ADDR") or env("SMTP_USER") or ""

    def send(m):
        del m["From"]
        m["From"] = formataddr((fn, fa))
        conn = smtplib.SMTP(env("SMTP_HOST", "smtp.gmail.com"), int(env("SMTP_PORT", "587")), timeout=30)
        try:
            conn.starttls(context=ssl.create_default_context())
            conn.login(env("SMTP_USER"), env("SMTP_PASS"))
            conn.send_message(m)
        finally:
            try:
                conn.quit()
            except Exception:                              # noqa: BLE001
                pass

    code, log = run(base, tok, to, dry, send)
    for line in log:
        print(line)
    return code


# ───────────────────────────── selftest ─────────────────────────────

def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else "  -- %s" % (detail,)))
        if not ok:
            fails.append(name)

    ts = int(datetime(2026, 10, 11, 15, 5, tzinfo=timezone.utc).timestamp() * 1000)
    claim = {"key": "form:claim:%d:0a1b2c3d" % ts, "kind": "claim", "ts": ts, "n": 0, "elevator": "Chetek Co-op",
             "town": "Chetek", "state": "WI", "contact_name": "Al Smith", "role": "Manager", "email": "al@chetek.coop",
             "phone": "715-555-0100", "bid_page_url": "https://chetek.coop/bids", "hosted_board": "yes"}
    fb = {"key": "form:sponsor-feedback:%d:0a1b2c3e" % (ts + 1), "kind": "sponsor-feedback", "ts": ts + 1, "n": 0,
          "request": "Approval", "sponsor": "Apex <b>Ag</b>", "proof": "AB12", "subject": "Approved: Apex ad, proof AB12",
          "message": "I approve.\nHeadline: Seed"}
    atlas = {"key": "form:atlas-feedback:%d:0a1b2c3f" % (ts + 2), "kind": "atlas-feedback", "ts": ts + 2, "n": 0,
             "email": "farmer@x.com", "source": "farmland-atlas"}

    print("subjects")
    ck("one claim: the subject the claim form always had", subject([claim]) == "Claim your board: Chetek Co-op, Chetek WI", subject([claim]))
    ck("one approval: the page's own subject", subject([fb]) == "Approved: Apex ad, proof AB12")
    ck("one waitlist: the old Formspree subject", subject([atlas]) == "Parcel Report interest")
    ck("several: counted by kind", subject([claim, fb, atlas]) ==
       "AGSIST forms: 1 elevator claim, 1 sponsor request, 1 parcel report waitlist", subject([claim, fb, atlas]))
    ck("plural", "2 elevator claims" in subject([claim, dict(claim, key="form:claim:1:00000000")]))

    print("\nthe email")
    m = build([claim], "sig@x.com", fa="me@agsist.com")
    t = m.get_body(("plain",)).get_content()
    ck("every claim field, hosted board included", all(s in t for s in (
        "Elevator or co-op: Chetek Co-op", "Work email: al@chetek.coop", "Phone: 715-555-0100",
        "Bid page: https://chetek.coop/bids", "Tell me about a hosted bid board: yes")), t)
    ck("one post: Reply-To is the sender", m["Reply-To"] == "al@chetek.coop")
    ck("goes to Sig", m["To"] == "sig@x.com")
    ck("an odd address is not put in a header", build([dict(atlas, email="a,b@x.com")], "s")["Reply-To"] is None)
    m = build([claim, fb, atlas], "sig@x.com")
    ck("several: no Reply-To", m["Reply-To"] is None)
    h = m.get_body(("html",)).get_content()
    ck("html escapes what people typed", "<b>Ag</b>" not in h and "&lt;b&gt;Ag&lt;/b&gt;" in h)
    ck("message line breaks kept", "I approve.<br>Headline: Seed" in h)
    t = m.get_body(("plain",)).get_content()
    ck("arrival order", t.index("Elevator claim") < t.index("Sponsor request") < t.index("Parcel Report waitlist"))
    ck("internal fields not printed", "form:claim" not in t and "n: 0" not in t)

    print("\nthe run (fake worker, fake mail)")
    calls, sent = [], []

    def fake(posts, mark_ok=True):
        def f(base, path, tok, body=None, **q):
            calls.append((path, body, q))
            if path == "form-list":
                return posts
            if not mark_ok:
                raise OSError("down")
            return {"ok": True, "marked": len(body["keys"])}
        return f
    code, log = run("https://w.dev", "t", "sig@x.com", False, sent.append, fake([claim, fb, atlas, {"kind": "x"}]))
    ck("sends one digest", code == 0 and len(sent) == 1, log)
    ck("asks only for new posts", calls[0][0] == "form-list" and calls[0][2] == {"new": "1"})
    ck("marks exactly what it sent", calls[-1][0] == "form-mark" and calls[-1][1]["keys"] == [claim["key"], fb["key"], atlas["key"]])
    ck("log has counts only, no addresses or names",
       not any("@" in x or "Chetek" in x or "Apex" in x or "715" in x for x in log) and
       "new form posts: claim 1, sponsor-feedback 1, atlas-feedback 1" in log, log)
    calls.clear(); sent.clear()
    code, log = run("https://w.dev", "t", "s", False, sent.append, fake([]))
    ck("nothing new: no mail, no mark", code == 0 and not sent and [c[0] for c in calls] == ["form-list"])
    calls.clear()
    code, log = run("https://w.dev", "t", "s", True, sent.append, fake([claim]))
    ck("dry run: no mail, no mark", code == 0 and not sent and [c[0] for c in calls] == ["form-list"])
    calls.clear()

    def boom(m):
        raise smtplib.SMTPException("x")
    code, log = run("https://w.dev", "t", "s", False, boom, fake([claim]))
    ck("send fails: nothing marked, exit 1", code == 1 and [c[0] for c in calls] == ["form-list"])

    def nf(base, path, tok, body=None, **q):
        raise urllib.error.HTTPError("u", 404, "nf", {}, None)
    code, log = run("https://w.dev", "t", "s", False, sent.append, nf)
    ck("worker not deployed yet: quiet success", code == 0 and "v5.8" in log[0])

    def bad(base, path, tok, body=None, **q):
        raise urllib.error.HTTPError("https://w.dev/form-list?token=SECRET", 403, "no", {}, None)
    code, log = run("https://w.dev", "t", "s", False, sent.append, bad)
    ck("bad token: exit 1, the token URL is not printed", code == 1 and "SECRET" not in " ".join(log), log)

    seen = []

    class FakeResp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b'[]'
    real = urllib.request.urlopen
    urllib.request.urlopen = lambda req, timeout=0: (seen.append(req.full_url), FakeResp())[1]
    try:
        worker("https://w.dev", "form-list", "t k", new="1")
    finally:
        urllib.request.urlopen = real
    ck("query string is built, not glued", seen == ["https://w.dev/form-list?new=1&token=t+k"], seen)

    print()
    if fails:
        print("%d FAILED: %s" % (len(fails), "; ".join(fails)))
        return 1
    print("form_digest: all checks pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
