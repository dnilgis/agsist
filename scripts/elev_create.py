#!/usr/bin/env python3
"""elev_create.py: add an elevator to the portal and email its private link to Sig.

Run by .github/workflows/elev-create.yml (Actions -> "Add elevator to portal").
The link is a password for that listing, and Actions logs are public, so it is
NEVER printed: it goes only by email to FORMS_TO (else sig@farmers1st.com).
Same secrets as form_digest.py: LIST_URL, LIST_TOKEN, SMTP_*.

Input comes as environment variables EL_ID, EL_NAME, EL_TOWN, EL_STATE, EL_ZIP,
EL_LAT, EL_LON, EL_CONTACT, EL_PHONE, EL_HOURS. The Worker validates every
field (POST /elev/admin/create); an id already taken is refused, and the run
says to use "New link" on agsist.com/elev-admin instead.

    python3 scripts/elev_create.py --selftest
"""
import json
import os
import smtplib
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage
from email.utils import formataddr

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import log_safe  # noqa: E402  sender_addr: the From line, SES-safe


def env(k, d=""):
    v = os.environ.get(k)
    return v if v not in (None, "") else d


def record_from_env(e=os.environ.get):
    g = lambda k: (e(k) or "").strip()
    rec = {"id": g("EL_ID"), "name": g("EL_NAME"), "town": g("EL_TOWN"), "state": g("EL_STATE").upper(),
           "zip": g("EL_ZIP"), "lat": g("EL_LAT"), "lon": g("EL_LON"),
           "contact": {"name": g("EL_CONTACT"), "phone": g("EL_PHONE")},
           "hours": {"text": g("EL_HOURS"), "harvest": None}}
    for k in ("lat", "lon"):
        try:
            rec[k] = float(rec[k])
        except ValueError:
            pass
    return rec


WYATT = """Wyatt,

Thanks for getting back to me. Happy to get your bids up, and I'll do it however is easiest for you.

I tried to find a way to grab them automatically so you wouldn't have to do anything. Bunge has bids up on some of its location pages, but not Haw Creek. I also signed up on the Bunge site to get access to your bids but haven't heard anything back yet. If you know who handles that, or if they can turn on bids for the Haw Creek page, I can pull them from there and you're done.

If you already send out a bid sheet by email or text, just add me to it and I'll take care of the rest.

Or here's a page I set up for you where you can put in your own basis, hours and notes:

{link}

Just type in your basis and it figures the cash price off futures. If nothing changes, hit "No change today." Save it on your phone and it's one tap.

Whatever works best for you. Let me know if you want it listed as something other than {name}, and if you want wheat on there too.

Thanks,
Sig
715-797-2428
"""


def message(to, rec, link):
    m = EmailMessage()
    m["To"] = to
    m["Subject"] = "Forward to Wyatt: Ladoga bids on agsist.com"
    m.set_content(
        "Sig: this is the finished email for %s, with the private link already in it. "
        "Forward it to him (delete this line first), or copy it into a new email.\n"
        "If the link is ever lost or shared: agsist.com/elev-admin -> New link.\n\n"
        "Subject: Ladoga bids on agsist.com\n\n" % rec["contact"]["name"] + WYATT.format(link=link, name=rec["name"]))
    return m


def create(base, tok, rec):
    req = urllib.request.Request(base + "/elev/admin/create", data=json.dumps(rec).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + tok,
                                          "User-Agent": "agsist-elev-create"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return json.load(e)
        except Exception:                                  # noqa: BLE001
            return {"ok": False, "error": "HTTP %d" % e.code}


def main():
    if "--selftest" in sys.argv:
        return selftest()
    u = urllib.parse.urlsplit(env("LIST_URL").strip())
    base = "%s://%s" % (u.scheme, u.netloc) if u.scheme and u.netloc else ""
    tok = env("LIST_TOKEN").strip()
    if not (base and tok):
        print("LIST_URL and LIST_TOKEN are required")
        return 1
    rec = record_from_env()
    r = create(base, tok, rec)
    if not r.get("ok"):
        err = r.get("error", "unknown error")
        print("not created: %s" % err)
        if "taken" in err:
            print('That id already exists. For a new link use "New link" on agsist.com/elev-admin.')
        return 1
    link = r.get("link", "")
    to = env("FORMS_TO") or "sig@farmers1st.com"
    m = message(to, rec, link)
    m["From"] = formataddr((env("FROM_NAME", "AGSIST"), log_safe.sender_addr()))
    conn = smtplib.SMTP(env("SMTP_HOST", "smtp.gmail.com"), int(env("SMTP_PORT", "587")), timeout=30)
    try:
        conn.starttls(context=ssl.create_default_context())
        conn.login(env("SMTP_USER"), env("SMTP_PASS"))
        conn.send_message(m)
    finally:
        try:
            conn.quit()
        except Exception:                                  # noqa: BLE001
            pass
    print("created %s; the link was emailed to Sig (it is never printed here)" % r.get("id"))
    return 0


def selftest():
    fails = []
    e = {"EL_ID": "bunge-ladoga-in", "EL_NAME": "Bunge Ladoga", "EL_TOWN": "Ladoga", "EL_STATE": "in", "EL_ZIP": "47954",
         "EL_LAT": "39.8726546", "EL_LON": "-86.8001052", "EL_CONTACT": "Wyatt", "EL_PHONE": "765-946-7000", "EL_HOURS": ""}
    rec = record_from_env(e.get)
    if rec["state"] != "IN" or rec["lat"] != 39.8726546 or rec["contact"]["name"] != "Wyatt":
        fails.append("record from env")
    m = message("x@example.com", rec, "https://agsist.com/post?k=SECRET")
    if "SECRET" not in m.get_content() or "SECRET" in m["Subject"]:
        fails.append("link in body only")
    src = open(__file__).read()
    bad = "print(" + "link"
    if 'print("created' not in src or bad in src:
        fails.append("link never printed")
    print("elev_create selftest:", "ok" if not fails else "FAIL " + ", ".join(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
