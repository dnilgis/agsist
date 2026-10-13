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


WYATT = """Hey Wyatt,

Thanks for reaching out. Happy to get Ladoga's bids up on agsist.com, and I want it to be as easy on you as possible. I can do it whichever way you prefer:

1. Automatic, if I can swing it. I looked for a way to pull your bids without you doing anything. Bunge shows live bids on some of its own location pages (Decatur, IN for one), but the Haw Creek page doesn't have any posted. I also went on the Bunge website and asked for an account so I can see your bids, but I haven't heard back from anyone yet. If you know who to nudge, or if your web folks can turn on cash bids for the Haw Creek page like Decatur's, agsist.com picks them up every 15 minutes on its own and you'd never have to think about it.

2. Add me to your bid sheet. If you send out a daily bid sheet by email or text, just add me to the list and I'll take it from there.

3. Your own admin page. I built a page just for you to post and change your own info on agsist.com:

{link}

Punch in your basis and it figures the cash price off futures. If nothing changed that day, tap "No change today" and you're done. You can also post your hours, harvest hours and a quick note like "dump open till 9 tonight". Save it to your phone's home screen and it's one tap. Keep the link to yourself; it's your key to the listing.

Once it's up, your bids show on the cash bids page, the Ladoga-area town pages, the price alerts farmers set for your area, and the morning AGSIST Daily, listed as {name}. Let me know if you'd rather have a different name on it, and whether you want wheat on there with corn and beans.

Any questions, just call or text me.

Thanks,
Sig

Sigurd Lindquist
agsist.com
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
    m["From"] = formataddr((env("FROM_NAME", "AGSIST"), env("FROM_ADDR") or env("SMTP_USER")))
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
