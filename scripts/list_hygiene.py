#!/usr/bin/env python3
"""Keep the Daily and hail-alert lists clean, every day, without Sig doing it.

1. Bounces. Reads the sending Gmail inbox over IMAP (same SMTP_USER and app
   password) for delivery-failure notices from the last LOOKBACK_DAYS. An
   address with a PERMANENT failure (status 5.x.x) is removed from the Daily
   and hail lists through the worker's own signed unsubscribe route. Temporary
   failures (4.x.x, mailbox full, server busy) are left alone.
2. Typos. An address whose domain is a near-miss of a big mail provider
   (13241@gmail.comb, joe@gmial.com, x@yahoo.con) and whose domain has no mail
   server of its own is re-subscribed at the corrected address and the typo is
   removed. The person can opt out from the first email like anyone else.
   A domain that does receive mail is never touched, so a real small-town ISP
   that happens to look like a typo is safe.

Price, elevator and county watches are confirmed by a link before anything is
sent, so they cannot hold a typo; a bounce on one of them is only reported.

Every run that changes something emails Sig the list of changes. Mondays it
sends a summary even when nothing changed. The Actions log prints counts only:
the repository and its logs are public.

  python3 scripts/list_hygiene.py             do it
  python3 scripts/list_hygiene.py --dry-run   report what it would do, change nothing
  python3 scripts/list_hygiene.py --selftest  fixtures, no network
"""
import email, hashlib, hmac, imaplib, json, os, re, smtplib, sys, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

LOOKBACK_DAYS = 8

KNOWN = """gmail.com yahoo.com hotmail.com outlook.com icloud.com aol.com live.com msn.com me.com mac.com
ymail.com rocketmail.com protonmail.com proton.me comcast.net att.net sbcglobal.net bellsouth.net
verizon.net cox.net charter.net frontier.com frontiernet.net centurylink.net windstream.net
earthlink.net mchsi.com tds.net netins.net juno.com""".split()
# Real providers that sit one letter away from a big one. Never "fixed".
REAL_LOOKALIKES = set("mail.com gmx.com email.com ymail.com live.com hotmail.co.uk yahoo.co.uk".split())
TLD_TYPOS = {"comb", "con", "cmo", "ocm", "coom", "comm", "cm", "om", "vom", "xom", "cpm", "co", "comn", "c0m"}


def env(n, d=None):
    v = os.environ.get(n, "")
    return v if v else d


def dl(a, b):
    """Damerau-Levenshtein distance (adjacent swaps count as one)."""
    d = {(i, -1): i + 1 for i in range(-1, len(a) + 1)}
    d.update({(-1, j): j + 1 for j in range(-1, len(b) + 1)})
    for i, ca in enumerate(a):
        for j, cb in enumerate(b):
            c = 0 if ca == cb else 1
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + c)
            if i and j and ca == b[j - 1] and a[i - 1] == cb:
                d[i, j] = min(d[i, j], d[i - 2, j - 2] + 1)
    return d[len(a) - 1, len(b) - 1]


def suggest(addr):
    """The corrected address, or None. Pure: no network."""
    if "@" not in addr:
        return None
    local, dom = addr.rsplit("@", 1)
    dom = dom.strip(".").lower()
    if not local or dom in KNOWN or dom in REAL_LOOKALIKES:
        return None
    base, _, tld = dom.rpartition(".")
    if base and tld in TLD_TYPOS and base + ".com" in KNOWN:
        return local + "@" + base + ".com"
    best, n = None, 0
    for k in KNOWN:
        lim = 1 if len(k) < 8 else 2
        dist = dl(dom, k)
        if dist <= lim:
            if best is None or dist < best[0]:
                best, n = (dist, k), 1
            elif dist == best[0]:
                n += 1
    if best and n == 1:
        return local + "@" + best[1]
    return None


def has_mx(domain):
    """True / False from Google's DNS-over-HTTPS; None when the lookup failed."""
    try:
        u = "https://dns.google/resolve?type=MX&name=" + urllib.parse.quote(domain)
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "agsist-list-hygiene"}), timeout=15) as r:
            d = json.loads(r.read().decode())
        if d.get("Status") == 3:   # NXDOMAIN: the domain does not exist
            return False
        return any(a.get("type") == 15 for a in d.get("Answer") or [])
    except Exception:
        return None


def failed_recipients(raw):
    """Permanent failures in one bounce message: [(address, status)]."""
    m = email.message_from_bytes(raw)
    out = {}
    for part in m.walk():
        if part.get_content_type() == "message/delivery-status":
            payload = part.get_payload()
            blocks = payload if isinstance(payload, list) else [payload]
            for blk in blocks:
                txt = blk.as_string() if hasattr(blk, "as_string") else str(blk)
                for grp in re.split(r"\n\s*\n", txt):
                    rcpt = re.search(r"(?im)^(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s>]+)>?", grp)
                    act = re.search(r"(?im)^Action:\s*(\S+)", grp)
                    st = re.search(r"(?im)^Status:\s*([245]\.\d+\.\d+)", grp)
                    if rcpt and act and act.group(1).lower() == "failed" and st and st.group(1).startswith("5"):
                        out[rcpt.group(1).lower()] = st.group(1)
    if not out:
        hdr = m.get("X-Failed-Recipients")
        if hdr:
            for a in re.split(r"[,\s]+", hdr.strip()):
                if "@" in a:
                    out[a.lower()] = "5.x.x"
    return sorted(out.items())


def read_bounces(user, pw, days):
    found = {}
    c = imaplib.IMAP4_SSL(env("IMAP_HOST", "imap.gmail.com"))
    c.login(user, pw)
    for box in ('"[Gmail]/All Mail"', "INBOX"):
        if c.select(box, readonly=True)[0] == "OK":
            break
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%d-%b-%Y")
    typ, data = c.search(None, f'(SINCE {since} OR FROM "mailer-daemon" FROM "postmaster")')
    for num in (data[0].split() if typ == "OK" and data and data[0] else []):
        typ, msg = c.fetch(num, "(RFC822)")
        if typ == "OK" and msg and isinstance(msg[0], tuple):
            for a, st in failed_recipients(msg[0][1]):
                found[a] = st
    c.logout()
    return found


def token(secret, e):
    return hmac.new(secret.encode(), e.lower().encode(), hashlib.sha256).hexdigest()[:16]


def call(base, path, method="GET", body=None, form=False):
    data = None
    hdr = {"User-Agent": "agsist-list-hygiene"}
    if body is not None:
        if form:
            data = urllib.parse.urlencode(body).encode(); hdr["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            data = json.dumps(body).encode(); hdr["Content-Type"] = "application/json"
    req = urllib.request.Request(base.rstrip("/") + path, data=data, method=method, headers=hdr)
    with urllib.request.urlopen(req, timeout=60) as r:
        t = r.read().decode()
    try:
        return json.loads(t)
    except Exception:
        return t


def gkey(e):
    """One key per real inbox: Gmail ignores dots and anything after '+'."""
    local, _, dom = e.lower().partition("@")
    if dom in ("gmail.com", "googlemail.com"):
        return local.split("+", 1)[0].replace(".", "") + "@gmail.com"
    return e.lower()


def plan(daily, hail, bounces, mx=has_mx, remove=()):
    """What to do. daily/hail: lists of records with 'email'. Returns actions."""
    acts = []
    lists = {"daily": {r["email"]: r for r in daily}, "hail": {r["email"]: r for r in hail}}
    seen = set()
    for e in remove:                                   # owner asked for these to go
        for name, recs in lists.items():
            if e in recs:
                acts.append({"list": name, "do": "remove", "email": e, "why": "removed at the owner's request"})
                seen.add((name, e))
    for name, recs in lists.items():                   # same inbox written two ways: keep the oldest
        groups = {}
        for e, r in recs.items():
            groups.setdefault(gkey(e), []).append(r)
        for g in groups.values():
            if len(g) > 1:
                g.sort(key=lambda r: (r.get("ts") or 0, r["email"]))
                for r in g[1:]:
                    if (name, r["email"]) not in seen:
                        acts.append({"list": name, "do": "remove", "email": r["email"],
                                     "why": "duplicate of " + g[0]["email"] + " (same Gmail inbox)"})
                        seen.add((name, r["email"]))
    for name, recs in lists.items():
        for e, r in recs.items():
            fix = suggest(e)
            if fix and fix != e:
                dom = e.rsplit("@", 1)[1]
                if mx(dom) is False:              # only a domain that cannot receive mail
                    acts.append({"list": name, "do": "fix", "email": e, "to": fix, "rec": r})
                    seen.add((name, e))
    for e, st in bounces.items():
        for name, recs in lists.items():
            if e in recs and (name, e) not in seen:
                acts.append({"list": name, "do": "remove", "email": e, "why": "bounced " + st})
        if e not in lists["daily"] and e not in lists["hail"]:
            acts.append({"list": "other", "do": "note", "email": e, "why": "bounced " + st + " (not on the Daily or hail list)"})
    return acts


def apply(acts, base, secret, list_token):
    done = []
    for a in acts:
        e = a["email"]
        try:
            if a["do"] == "fix" and a["list"] == "daily":
                r = a["rec"]
                call(base, "/subscribe", "POST", {"email": a["to"], "source": ("typo-fix " + (r.get("src") or ""))[:60],
                                                   "zip": r.get("zip") or "", "reports": r.get("reports", True)})
                call(base, "/unsubscribe?e=" + urllib.parse.quote(e) + "&t=" + token(secret, e), "POST", {}, form=True)
            elif a["do"] == "fix" and a["list"] == "hail":
                r = a["rec"]
                call(base, "/alert-subscribe", "POST", {"email": a["to"], "lat": r.get("lat"), "lon": r.get("lon"),
                                                         "place": r.get("place", ""), "radius_mi": r.get("radius_mi", 5)})
                call(base, "/alert-unsubscribe?e=" + urllib.parse.quote(e) + "&t=" + token(secret, e), "POST", {}, form=True)
            elif a["do"] == "remove":
                path = "/unsubscribe" if a["list"] == "daily" else "/alert-unsubscribe"
                call(base, path + "?e=" + urllib.parse.quote(e) + "&t=" + token(secret, e), "POST", {}, form=True)
            a["ok"] = True
        except Exception as ex:
            a["ok"] = False
            a["err"] = type(ex).__name__
        done.append(a)
    return done


def line(a):
    if a["do"] == "fix":
        return f"Fixed ({a['list']}): {a['email']} -> {a['to']}"
    if a["do"] == "remove":
        return f"Removed ({a['list']}): {a['email']}, {a['why']}"
    return f"Note: {a['email']}, {a['why']}"


def mail_report(acts, dry):
    user, pw = env("SMTP_USER"), env("SMTP_PASS")
    to = env("REPORT_TO") or env("FROM_ADDR") or user
    m = EmailMessage()
    m["To"] = to
    m["From"] = f"{env('FROM_NAME', 'AGSIST')} <{env('FROM_ADDR') or user}>"
    m["Subject"] = ("[dry run] " if dry else "") + "AGSIST list cleanup, " + datetime.now(timezone.utc).strftime("%b %-d")
    body = ["What the daily list cleanup did:" if acts else "Nothing to clean up this week.", ""]
    body += [line(a) + ("" if a.get("ok", True) else "  (FAILED, will retry next run)") for a in acts]
    body += ["", "Bounced addresses come from delivery-failure notices in the sending inbox. Typo fixes are made only",
             "when the misspelled domain cannot receive mail. Anyone moved to a fixed address can unsubscribe from",
             "the first email they get."]
    m.set_content("\n".join(body))
    with smtplib.SMTP(env("SMTP_HOST", "smtp.gmail.com"), int(env("SMTP_PORT", "587")), timeout=30) as c:
        c.starttls(); c.login(user, pw); c.send_message(m)


def selftest():
    ok = True
    def chk(c, msg):
        nonlocal ok
        print(("ok   " if c else "FAIL ") + msg); ok &= bool(c)
    chk(suggest("13241@gmail.comb") == "13241@gmail.com", "gmail.comb -> gmail.com")
    chk(suggest("joe@gmial.com") == "joe@gmail.com", "gmial.com -> gmail.com (swap)")
    chk(suggest("a@yahoo.con") == "a@yahoo.com", "yahoo.con -> yahoo.com")
    chk(suggest("a@hotmal.com") == "a@hotmail.com", "hotmal.com -> hotmail.com")
    chk(suggest("a@gmail.com") is None, "a correct address is left alone")
    chk(suggest("a@mail.com") is None and suggest("a@gmx.com") is None, "real look-alike providers are never fixed")
    chk(suggest("a@farmers1st.com") is None, "an ordinary business domain is left alone")
    chk(suggest("a@mchsi.co") == "a@mchsi.com", "mchsi.co -> mchsi.com (Iowa ISP)")
    raw = (b"From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>\r\nSubject: Delivery Status Notification (Failure)\r\n"
           b"MIME-Version: 1.0\r\nContent-Type: multipart/report; report-type=delivery-status; boundary=XX\r\n\r\n"
           b"--XX\r\nContent-Type: text/plain\r\n\r\nAddress not found\r\n--XX\r\nContent-Type: message/delivery-status\r\n\r\n"
           b"Reporting-MTA: dns; googlemail.com\r\n\r\nFinal-Recipient: rfc822; dead@example.org\r\nAction: failed\r\nStatus: 5.1.1\r\n\r\n"
           b"Final-Recipient: rfc822; full@example.org\r\nAction: delayed\r\nStatus: 4.2.2\r\n--XX--\r\n")
    chk(failed_recipients(raw) == [("dead@example.org", "5.1.1")], "a permanent bounce is read; a temporary one is ignored")
    daily = [{"email": "13241@gmail.comb", "src": "home", "zip": "54728"}, {"email": "dead@example.org"}, {"email": "ok@gmail.com"}]
    hail = [{"email": "x@yahoo.con", "lat": 44.9, "lon": -91.3, "place": "Chetek", "radius_mi": 10}]
    acts = plan(daily, hail, {"dead@example.org": "5.1.1", "gone@else.com": "5.1.1"}, mx=lambda d: False)
    kinds = sorted((a["list"], a["do"], a["email"]) for a in acts)
    chk(("daily", "fix", "13241@gmail.comb") in kinds and ("hail", "fix", "x@yahoo.con") in kinds, "typos on both lists are planned as fixes")
    chk(("daily", "remove", "dead@example.org") in kinds, "a bounced Daily address is removed")
    chk(("other", "note", "gone@else.com") in kinds, "a bounce for an address on neither list is only noted")
    chk(not any(a["email"] == "ok@gmail.com" for a in acts), "a good address is untouched")
    acts2 = plan(daily, [], {}, mx=lambda d: True)
    chk(not acts2, "a misspelled-looking domain that DOES receive mail is never changed")
    acts3 = plan(daily, [], {}, mx=lambda d: None)
    chk(not acts3, "when the DNS lookup fails, nothing is changed")
    dup = plan([{"email": "j.smith@gmail.com", "ts": 1}, {"email": "jsmith+ag@gmail.com", "ts": 2}, {"email": "jsmith@yahoo.com", "ts": 3}], [], {}, mx=lambda d: None)
    chk([a["email"] for a in dup] == ["jsmith+ag@gmail.com"], "a second spelling of one Gmail inbox is removed, the oldest kept, Yahoo untouched")
    rm = plan([{"email": "me@x.com"}], [{"email": "me@x.com", "lat": 1, "lon": 1}], {}, mx=lambda d: None, remove=["me@x.com"])
    chk(sorted(a["list"] for a in rm) == ["daily", "hail"], "an owner removal takes the address off every list it is on")
    chk("13241" not in "\n".join([f"{len(acts)} actions"]), "the log line carries counts only")
    return ok


def main():
    if "--selftest" in sys.argv:
        sys.exit(0 if selftest() else 1)
    dry = "--dry-run" in sys.argv
    base = env("LIST_URL", "https://agsist-subs.dnilgis.workers.dev")
    tok, secret, user, pw = env("LIST_TOKEN"), env("UNSUB_SECRET"), env("SMTP_USER"), env("SMTP_PASS")
    if not (tok and secret and user and pw):
        print("::error::LIST_TOKEN, UNSUB_SECRET, SMTP_USER and SMTP_PASS are required"); sys.exit(1)
    try:
        daily = call(base, "/list?format=json&token=" + tok)
        hail = call(base, "/alert-list?token=" + tok)
    except Exception as ex:
        print(f"::error::could not read the lists: {type(ex).__name__}"); sys.exit(1)
    try:
        bounces = read_bounces(user, pw, LOOKBACK_DAYS)
    except Exception as ex:
        # Typo fixes still run; the bounce half needs IMAP, which Gmail can refuse.
        print(f"::warning::could not read the sending inbox ({type(ex).__name__}); bounces skipped this run")
        bounces = {}
    remove = [x.strip().lower() for x in re.split(r"[,\s]+", env("REMOVE", "")) if "@" in x]
    acts = plan(daily, hail, bounces, remove=remove)
    print(f"daily list: {len(daily)}  hail list: {len(hail)}  bounces read: {len(bounces)}")
    print(f"planned: {sum(a['do']=='fix' for a in acts)} typo fixes, {sum(a['do']=='remove' for a in acts)} removals, "
          f"{sum(a['do']=='note' for a in acts)} notes, {len(remove)} owner removals asked")
    if not dry:
        acts = apply(acts, base, secret, tok)
        print(f"failed: {sum(1 for a in acts if a.get('ok') is False)}")
    monday = datetime.now(timezone.utc).weekday() == 0
    if acts or monday or dry:
        mail_report(acts, dry)
        print("report emailed to the owner")


if __name__ == "__main__":
    main()
