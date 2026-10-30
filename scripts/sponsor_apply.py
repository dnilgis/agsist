#!/usr/bin/env python3
"""
Self-serve sponsors: the job behind sponsor-apply.html (2026-10-07).

Runs every 30 minutes in Actions (.github/workflows/sponsor-apply.yml). The
applications live in the subs worker (KV prefix sapp:, workers/subs-worker.js
v5.5). This job is the only thing that emails anyone about them and the only
thing that changes the site:

  pending, never mailed      -> the applicant gets a confirmation link
  pending, older than 14 days-> dropped (expired), as the privacy page says
  confirmed, Sig not told     -> Sig gets the ad, the contact, the price, and
                                 APPROVE / DECLINE links (only his email has them)
  approved (State Sponsor or  -> the ad is written into the site and pushed:
   Cash Bids Sponsor)            data/page-sponsors.json (a State Sponsor takes
                                 every ribbon of its state: the cash bids page
                                 and its town pages, and the cash rent page),
                                 the logo to img/sponsors/. Then marked live with
                                 its start date, and both sides are told.
  approved (anything else)    -> Sig is told it needs setting up by hand: the
                                 Daily Sponsor card has its own approval flow, a
                                 Featured elevator box is built with them, a
                                 state that opens soon waits, and a retired tier
                                 (Own a page, Supporter) is no longer sold.
  declined                    -> one polite note to the applicant.
  live                        -> 3 days before the free month ends, the sponsor
                                 is asked yes or no (no reply: the ad comes down
                                 and nothing is owed); on each monthly date
                                 from then on, Sig gets "send the invoice", with
                                 an END link for the day someone stops paying.
  ending (Sig clicked END)    -> the ad comes down, the slot is open again.

Billing is a handshake, on purpose: no card, an invoice a month, and a slot
that goes back on the market if it is not paid. This job never charges anyone;
it reminds Sig, who invoices the way he already does.

Order of operations: files are written and PUSHED before the worker is marked,
so a failed push leaves the application approved and the next run tries again.
Every write checks first, so a rerun never doubles an entry or an email.

    python3 scripts/sponsor_apply.py              (needs LIST_URL, LIST_TOKEN, UNSUB_SECRET, SMTP_*)
    python3 scripts/sponsor_apply.py --selftest   offline checks, no network
    DRY_RUN=1 ...                                  report what would happen, change nothing
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import base64
import calendar
import hashlib
import hmac
import html as H
import json
import os
import re
import smtplib
import ssl
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import log_safe  # noqa: E402  (no address in the public log)
import email_links  # noqa: E402  (links go to the agsist.com front door; the worker host is never in an email)

try:
    from zoneinfo import ZoneInfo
    CT = ZoneInfo("America/Chicago")
except Exception:                                          # noqa: BLE001
    CT = None

REPO = Path(__file__).resolve().parent.parent
SITE = "https://agsist.com"
ADDRESS = "AGSIST, PO Box 243, Chetek, WI 54728"
PEND_TTL_MS = 14 * 864e5
# THE RATE CARD OF OCT 29, 2026 (data/rate-card.json). The subs worker stores an
# application under tier page|supporter|daily (workers/subs-worker.js); the form
# sends the new tiers as tier "page" with a slot that says which one:
#   slot "cash-bids"                      Cash Bids Sponsor
#   slot "cash-bids-<state>" / "rent-xx"  State Sponsor (a state ribbon in data/sponsor-slots.json)
#   slot "fe-<st>-<town>"                 Featured elevator on /cash-bids/<state>/<town>
# card_tier() reads it back. Any other page slot, and every Supporter, is a retired tier.
TIER_NAME = {"daily": "Daily Sponsor", "state": "State Sponsor", "cashbids": "Cash Bids Sponsor",
             "elevator": "Featured elevator", "page": "Own a page (no longer sold)", "supporter": "Supporter (no longer sold)"}
# Only these two ever go live on their own. Any other tier (the Daily Sponsor, a
# Featured elevator, a state that opens soon, or a retired tier) is handed to Sig,
# never written into the site (Oct 19: the Daily tier id became "daily").
SELF_SERVE = ("state", "cashbids")
FE_SLOT = re.compile(r"fe-([a-z]{2})-([a-z0-9][a-z0-9-]{0,50})")
STATE_SLOT = re.compile(r"cash-bids-[a-z]+(?:-[a-z]+)*|rent-[a-z]{2}")


def env(name, default=None):
    v = os.environ.get(name)
    return v if v not in (None, "") else default


def token(secret, s):
    """The worker's hmac16: HMAC-SHA256 of the lowercased string, first 16 hex."""
    return hmac.new(secret.encode(), s.lower().encode(), hashlib.sha256).hexdigest()[:16]


def today_ct(now=None):
    now = now or datetime.now(timezone.utc)
    return (now.astimezone(CT) if CT else now).date()


def add_months(d, n):
    y, m = divmod(d.month - 1 + n, 12)
    y += d.year
    m += 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")
    return (s or "sponsor")[:40].strip("-")


def card_tier(a):
    """The rate-card tier an application is for, or None for a retired one."""
    t, slot = a.get("tier"), a.get("slot") or ""
    if t == "daily":
        return "daily"
    if t != "page":
        return None
    if slot == "cash-bids":
        return "cashbids"
    if FE_SLOT.fullmatch(slot):
        return "elevator"
    if STATE_SLOT.fullmatch(slot):
        return "state"
    return None


def state_slots(slot, slots):
    """Every ribbon one State Sponsor takes: the slots of the same state in data/sponsor-slots.json."""
    st = next((e.get("state") for e in slots if e.get("id") == slot), None)
    got = [e["id"] for e in slots if st and e.get("tier") == "state" and e.get("state") == st]
    return st, (got or [slot])


def rate(card, tier, state=None):
    t = next((x for x in (card or {}).get("tiers", []) if x.get("id") == tier), None)
    if not t:
        return None
    return ((t.get("price_by_state") or {}).get(state) if state else None) or t.get("price_month")


def opens_soon(card, state):
    t = next((x for x in (card or {}).get("tiers", []) if x.get("id") == "state"), None) or {}
    return bool(state) and state in (t.get("opens_soon") or [])


def app_rate(card, a, slots=()):
    ct = card_tier(a)
    st = state_slots(a.get("slot"), slots)[0] if ct == "state" else None
    return rate(card, ct, st) if ct else None


def money(n):
    return "$%d" % n if isinstance(n, int) else "the rate on the card"


def fmt(d):
    return d.strftime("%b ") + str(d.day) + d.strftime(", %Y")


# ───────────────────────────── planning ─────────────────────────────

def plan(apps, now_ms, today, sold_pages, supporters, card=None, slots=()):
    """Pure: which step each application needs today. Returns a list of
    (action, app). Never touches the network or the disk."""
    out = []
    for a in apps:
        st, aid = a.get("status"), a.get("id")
        if not (isinstance(aid, str) and re.fullmatch(r"[0-9a-f]{12}", aid)):
            continue
        if st == "pending":
            if now_ms - (a.get("ts") or 0) > PEND_TTL_MS:
                out.append(("expire", a))
            elif not a.get("m"):
                out.append(("confirm", a))
        elif st == "confirmed" and not a.get("notified"):
            out.append(("notify", a))
        elif st == "approved":
            ct = card_tier(a)
            state, want = state_slots(a.get("slot"), slots) if ct == "state" else (None, [a.get("slot")])
            if ct == "state" and opens_soon(card, state):
                # HELD (Oct 29, 2026, Sig option A): California, Nevada and Texas are not sold
                # while the Root Lot test runs there. Refused here, told to Sig, nothing written.
                if (a.get("notified") or 0) < 2:
                    out.append(("held", a))
            elif ct not in SELF_SERVE or (ct == "state" and not state):
                if (a.get("notified") or 0) < 2:
                    out.append(("daily", a))
            elif any(slot_owner(sold_pages, x) not in (None, aid) for x in want):
                if (a.get("notified") or 0) < 2:
                    out.append(("clash", a))          # someone else holds the page: tell Sig, change nothing
            else:
                out.append(("golive", a))
        elif st == "declined" and (a.get("m") or 0) < 2:
            out.append(("declined", a))
        elif st == "ending":
            out.append(("takedown", a))
        elif st == "live" and a.get("start"):
            start = date.fromisoformat(a["start"])
            free_end = add_months(start, 1) - timedelta(days=1)
            if not a.get("reminded") and today >= free_end - timedelta(days=3):
                out.append(("freeending", a))
            k = (a.get("invoiced") or 0) + 1                 # the next invoice: month k starts start + k months
            if today >= add_months(start, k):
                out.append(("invoice", a))
    return out


def slot_owner(sold_pages, slot):
    e = (sold_pages.get("slots") or {}).get(slot or "")
    return e.get("app") if e and e.get("active") is not False else None


# ─────────────────────────── site changes ───────────────────────────

def write_logo(a, logo, slug, root=REPO):
    m = re.fullmatch(r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)", logo or "")
    if not m:
        return ""
    ext = {"png": "png", "jpeg": "jpg", "webp": "webp"}[m.group(1)]
    raw = base64.b64decode(m.group(2))
    if len(raw) > 250 * 1024:
        return ""
    rel = "img/sponsors/%s.%s" % (slug, ext)
    (root / rel).parent.mkdir(parents=True, exist_ok=True)
    (root / rel).write_bytes(raw)
    return "/" + rel


def go_live(a, logo, card, start, root=REPO, slots=None):
    """Write the ad into the site: a Cash Bids Sponsor on the /cash-bids ribbon, a State
    Sponsor on every ribbon of its state. Returns (slug, files changed). Idempotent: an entry
    already carrying this application id is left as it is. Only a SELF_SERVE tier comes here."""
    slug = slugify(a.get("company"))
    ct = card_tier(a)
    if ct not in SELF_SERVE:
        raise ValueError("%s is not a tier that goes live on its own" % ct)
    if slots is None:
        slots = json.loads((root / "data" / "sponsor-slots.json").read_text()).get("slots", [])
    state, want = state_slots(a["slot"], slots) if ct == "state" else (None, [a["slot"]])
    if ct == "state" and opens_soon(card, state):
        raise ValueError("%s is held (opens soon); nothing is written" % state)
    price = rate(card, ct, state)
    p = root / "data" / "page-sponsors.json"
    d = json.loads(p.read_text())
    sold = d.setdefault("slots", {})
    todo = [x for x in want if not (sold.get(x) and sold[x].get("app") == a["id"])]
    if not todo:
        return (sold.get(want[0]) or {}).get("slug", slug), []
    path = write_logo(a, logo, slug + "-" + a["slot"], root)
    for x in todo:
        sold[x] = {"company": a["company"], "headline": a.get("headline") or "", "body": a.get("body") or "",
                   "url": a["url"], "logo": path, "start": start.isoformat(), "active": True,
                   "slug": slug, "app": a["id"], "tier": ct, "price_month": price}
        if state:
            sold[x]["state"] = state
    # No contact name or email here: this file is public. The job reads
    # those from the worker when it needs them (invoice reminders).
    p.write_text(json.dumps(d, indent=1, ensure_ascii=False) + "\n")
    files = ["data/page-sponsors.json"] + ([path.lstrip("/")] if path else [])
    if report_entry(a, ct, state, want, start, root):
        files.append("data/sponsors.json")
    return slug, files


def report_entry(a, ct, state, want, start, root=REPO):
    """THE DAY-30 REPORT (rate card, Oct 29, 2026). A sponsor who goes live gets a
    portal like every other: an entry in data/sponsors.json with its own token and
    "page_slots", the ribbons it holds. scripts/build_sponsor_report.py reads GA4
    filtered to page:<id> for exactly those ribbons, so the report is this sponsor's
    events and nobody else's. No contact here: the file is public. Returns True when
    the file changed. A rerun finds the entry by the application id and leaves it."""
    import secrets
    p = root / "data" / "sponsors.json"
    d = json.loads(p.read_text(encoding="utf-8"))
    lst = d.setdefault("sponsors", [])
    if any(x.get("app") == a["id"] for x in lst):
        return False
    base = slugify(a.get("company"))[:30].strip("-") + "-" + (state.lower() if state else ct)
    slugs = {x.get("slug") for x in lst}
    slug = base if base not in slugs else base + "-" + a["id"][:4]
    e = {"slug": slug, "name": a["company"], "active": True, "start": start.isoformat(),
         "token": secrets.token_hex(8), "page_slots": list(want), "app": a["id"],
         "billing": {"tier": ct, "trial_months": 1}}
    if state:
        e["billing"]["state"] = state
        e["regions"] = [state]
    lst.append(e)
    p.write_text(json.dumps(d, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return True


def portal_link(app_id, root=REPO):
    """The private report page for a live application, or None. An opaque token, no personal data."""
    try:
        d = json.loads((root / "data" / "sponsors.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    e = next((x for x in d.get("sponsors") or [] if x.get("app") == app_id), None)
    return "%s/sponsor-report?r=%s-%s" % (SITE, e["slug"], e["token"]) if e and e.get("token") else None


def take_down(a, root=REPO, today=None):
    """Free the slot. The entry is removed, not just hidden, so the page sells
    it again; the logo file goes with it. Its report entry stays, ended, so the
    sponsor can still read the numbers."""
    changed = []
    p = root / "data" / "sponsors.json"
    if p.exists():
        d = json.loads(p.read_text(encoding="utf-8"))
        hit = False
        for x in d.get("sponsors") or []:
            if x.get("app") == a["id"] and x.get("active") is not False:
                x["active"] = False
                x["ended"] = (today or today_ct()).isoformat()
                hit = True
        if hit:
            p.write_text(json.dumps(d, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
            changed.append("data/sponsors.json")
    p = root / "data" / "page-sponsors.json"
    d = json.loads(p.read_text())
    for k, e in list((d.get("slots") or {}).items()):
        if e.get("app") == a["id"]:
            if e.get("logo"):
                f = root / e["logo"].lstrip("/")
                if f.exists():
                    f.unlink()
                    changed.append(e["logo"].lstrip("/"))
            del d["slots"][k]
            p.write_text(json.dumps(d, indent=1, ensure_ascii=False) + "\n")
            if "data/page-sponsors.json" not in changed:
                changed.append("data/page-sponsors.json")
    p = root / "data" / "supporters.json"
    d = json.loads(p.read_text())
    keep = []
    for s in d.get("supporters", []):
        if s.get("app") == a["id"]:
            if s.get("logo"):
                f = root / s["logo"].lstrip("/")
                if f.exists():
                    f.unlink()
                    changed.append(s["logo"].lstrip("/"))
            continue
        keep.append(s)
    if len(keep) != len(d.get("supporters", [])):
        d["supporters"] = keep
        p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
        changed.append("data/supporters.json")
    return changed


def push(files, message):
    if not files:
        return True
    run = lambda *c: subprocess.run(c, cwd=REPO, check=True, capture_output=True, text=True)
    run("git", "add", "-A", "--", *files)
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=REPO).returncode == 0:
        return True
    run("git", "commit", "-m", message)
    for i in range(4):
        try:
            run("git", "pull", "--rebase", "origin", "main")
            run("git", "push", "origin", "HEAD:main")
            return True
        except subprocess.CalledProcessError as e:
            print("push attempt %d failed: %s" % (i + 1, (e.stderr or "")[-300:]))
            time.sleep(2 ** (i + 1))
    return False


# ───────────────────────────── email ────────────────────────────────

def msg(to, subject, paras, button=None, fn="AGSIST", fa="", rt=None, links=None):
    m = EmailMessage()
    m["Subject"] = subject
    m["From"] = formataddr((fn, fa))
    m["To"] = to
    m["Message-ID"] = make_msgid(domain=(fa.split("@", 1)[1] if "@" in fa else "agsist.com"))
    if rt:
        m["Reply-To"] = rt
    text = "\n\n".join(paras)
    if button:
        text += "\n\n%s: %s" % button
    for label, url in links or []:
        text += "\n%s: %s" % (label, url)
    m.set_content(text + "\n\n-- \n" + ADDRESS + "\n")
    e = H.escape
    body = "".join('<p style="font-size:14px;line-height:1.6;margin:0 0 12px">%s</p>' % e(p) for p in paras)
    btn = ('<p style="margin:18px 0"><a href="%s" style="background:#e8743a;color:#0d1117;text-decoration:none;'
           'padding:11px 18px;font-weight:bold;border-radius:6px">%s</a></p>' % (e(button[1]), e(button[0]))) if button else ""
    more = "".join('<p style="margin:6px 0"><a href="%s">%s</a></p>' % (e(u), e(l)) for l, u in links or [])
    m.add_alternative('<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:24px 16px;color:#1a1a1a;background:#fff">'
                      '%s%s%s<p style="font-size:14px;color:#6b6b6b">%s</p></div>' % (body, btn, more, e(ADDRESS)), subtype="html")
    return m


def what(a):
    ct, slot = card_tier(a), a.get("slot") or ""
    if ct == "daily":
        return "%s (the Daily briefing and the homepage)" % TIER_NAME["daily"]
    if ct == "cashbids":
        return "%s (/cash-bids)" % TIER_NAME["cashbids"]
    if ct == "state":
        where = ("/cash-bids/%s/ and its town pages, and the state's cash rent page" % slot[len("cash-bids-"):]
                 if slot.startswith("cash-bids-") else "the %s cash rent page and the state's cash bids pages" % slot[5:].upper())
        return "%s (%s)" % (TIER_NAME["state"], where)
    if ct == "elevator":
        m = FE_SLOT.fullmatch(slot)
        return "%s (the %s town page %s)" % (TIER_NAME["elevator"], m.group(1).upper(), m.group(2))
    if a.get("tier") == "supporter":
        return "%s (footer)" % TIER_NAME["supporter"]
    return "%s (/%s)" % (TIER_NAME["page"], slot)


def quoted(s, n=60):
    """Visitor text in a mail to an address a stranger typed (a label, a
    place, a company): one line, at most n characters, inside quotation marks,
    so it reads as something someone typed and never as AGSIST's own words."""
    s = " ".join(re.sub(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]", " ", str(s or "")).split())
    if len(s) > n:
        s = s[:n - 1].rstrip() + "\u2026"
    return "\u201c" + s + "\u201d"


def ad_lines(a):
    return ["Business: %s" % a["company"], "Headline: %s" % (a.get("headline") or "(none)"),
            "Copy: %s" % (a.get("body") or "(none)"), "Link: %s" % a["url"],
            "Logo: %s" % ("attached to the application" if a.get("logo_len") else "none, the name is shown as text")]


def emails_for(action, a, base, secret, card, today, sig, slots=()):
    """-> [(to, EmailMessage-kwargs)] for one planned action. Pure."""
    price = money(app_rate(card, a, slots))
    # Oct 22: the agsist.com front door asks the worker's page from the browser; base only has to be set
    dec = lambda d: email_links.front("sponsor-decide", [("i", a["id"]), ("d", d), ("t", token(secret, a["id"] + "|sd|" + d))])
    if action == "confirm":
        go = email_links.front("sponsor-confirm", [("i", a["id"]), ("t", token(secret, a["id"] + "|sc"))])
        # The address is unconfirmed, so company and contact are a stranger's
        # words: kept out of the Subject, quoted and short in the body.
        return [(a["email"], dict(subject="Confirm your AGSIST ad", paras=[
            "Hi, thanks for putting %s on AGSIST: %s." % (quoted(a["company"]), what(a)),
            "Click below to confirm it was you. Then it goes to Sig, who reads every ad himself.",
            "The first month is free. After that it's %s a month, invoiced, and you can cancel any time by replying." % price,
            "Didn't ask for this? Ignore this email and nothing happens."], button=("CONFIRM MY AD", go)))]
    if action == "notify":
        lines = ["New AGSIST sponsor waiting for you: %s." % what(a)] + ad_lines(a) + [
            "Contact: %s, %s%s." % (a.get("contact") or "?", a["email"], (", " + a["phone"]) if a.get("phone") else ""),
            "Price: first month free, then %s a month." % price]
        ct = card_tier(a)
        if ct is None:
            lines.append("This slot is no longer sold (rate card of Oct 29, 2026). Decline it, or offer a State or Cash Bids slot.")
        elif ct == "elevator":
            lines.append("Featured elevator: approving tells you to set it up by hand (the town page box is built with them).")
        elif ct == "state" and opens_soon(card, state_slots(a.get("slot"), slots)[0]):
            lines.append("That state opens soon: approving tells you to set it up by hand when it opens.")
        elif ct not in SELF_SERVE:
            lines.append("Daily Sponsor: approving tells you to set it up by hand (the briefing card has its own proof and approval).")
        else:
            lines.append("Approve and it goes live within the hour; the free month starts that day.")
        return [(sig, dict(subject="New sponsor: %s, %s" % (a["company"], what(a)), paras=lines,
                           button=("APPROVE", dec("approve")), links=[("Decline", dec("decline"))]))]
    if action == "golive":
        start = date.fromisoformat(a["start"])
        free_end = add_months(start, 1) - timedelta(days=1)
        where = (SITE + "/" + a["_page"].lstrip("/")) if a.get("_page") else SITE
        return [(a["email"], dict(subject="You're live on AGSIST", paras=[
            "%s is now on AGSIST: %s. See it: %s" % (a["company"], what(a), where)] + (
            ["Your own report page, updated every morning, with the views and clicks on your ad. It is the day-30 report: %s" % a["_portal"]]
            if a.get("_portal") else []) + [
            "Your free month runs %s to %s. Then one email asks yes or no. Say yes and it is %s a month from %s, invoiced, month to month. No reply means the ad comes down and nothing is owed." % (
                fmt(start), fmt(free_end), price, fmt(free_end + timedelta(days=1))),
            "Want the copy changed, or to stop? Just reply to this email."])),
                (sig, dict(subject="Live: %s, %s" % (a["company"], what(a)), paras=[
                    "%s went live today. Free through %s; first invoice (%s) due %s, only after a yes." % (
                        a["company"], fmt(free_end), price, fmt(free_end + timedelta(days=1)))] + (
                    ["Their report page: %s" % a["_portal"]] if a.get("_portal") else []),
                    links=[("End it (frees the slot)", dec("end"))]))]
    if action == "daily":
        return [(sig, dict(subject="Sponsor approved: %s" % a["company"], paras=[
            "You approved %s for %s. That one is set up by hand:" % (a["company"], what(a))] + ad_lines(a) + [
            "Contact: %s, %s%s." % (a.get("contact") or "?", a["email"], (", " + a["phone"]) if a.get("phone") else ""),
            "Nothing has gone live and the applicant has not been told anything yet."]))]
    if action == "held":
        st = state_slots(a.get("slot"), slots)[0]
        return [(sig, dict(subject="Held: %s, %s is not sold yet" % (a["company"], st), paras=[
            "You approved %s for the State Sponsor in %s, but %s is held while the state-targeted test runs there. Nothing went live and the applicant has not been told anything." % (a["company"], st, st),
            "Decline it, or keep it for the day %s opens. Contact: %s." % (st, a["email"])],
            links=[("Decline", dec("decline"))]))]
    if action == "clash":
        return [(sig, dict(subject="Can't put %s live: %s is taken" % (a["company"], a["slot"]), paras=[
            "You approved %s for /%s, but another sponsor already holds that page. Nothing changed." % (a["company"], a["slot"]),
            "Decline this one, or end the current sponsor first. Contact: %s." % a["email"]],
            links=[("Decline", dec("decline"))]))]
    if action == "declined":
        return [(a["email"], dict(subject="About your AGSIST ad", paras=[
            "Hi %s, thanks for your interest in AGSIST. Sig isn't able to run this one." % (a.get("contact") or "there"),
            "If you'd like to talk it over, just reply to this email."]))]
    if action == "freeending":
        start = date.fromisoformat(a["start"])
        free_end = add_months(start, 1) - timedelta(days=1)
        return [(a["email"], dict(subject="Your free month on AGSIST ends %s" % fmt(free_end), paras=[
            "Hi %s, your free month for %s ends %s." % (a.get("contact") or "there", a["company"], fmt(free_end)),
            "Sig will send your day-30 report. Then one question: keep it, yes or no? Reply yes and it carries on month to month at %s a month, invoiced." % price,
            "No reply means the ad comes down and nothing is owed. No charge for the free month."]))]
    if action == "invoice":
        start = date.fromisoformat(a["start"])
        k = (a.get("invoiced") or 0) + 1
        p0, p1 = add_months(start, k), add_months(start, k + 1) - timedelta(days=1)
        return [(sig, dict(subject="Invoice due: %s, %s" % (a["company"], price), paras=[
            "Time to invoice %s for %s: %s, %s to %s (month %d after the free one)." % (
                a["company"], what(a), price, fmt(p0), fmt(p1), k),
            "Bill to: %s, %s%s." % (a.get("contact") or a["company"], a["email"], (", " + a["phone"]) if a.get("phone") else ""),
            ("Only if they said yes on day 30. No yes means end it: nothing is owed." if k == 1 else
             "If they don't pay, end it and the slot goes back on the market.")],
            links=[("End it (frees the slot)", dec("end"))]))]
    if action == "takedown":
        return [(sig, dict(subject="Ended: %s" % a["company"], paras=[
            "%s is off AGSIST and %s is open again." % (a["company"], what(a))]))]
    return []


# ─────────────────────────────── run ────────────────────────────────

def worker(base, path, tok, body=None, **q):
    url = "%s/%s?%s" % (base, path, urllib.parse.urlencode(dict(q, token=tok)))
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET",
                                 headers={"Content-Type": "application/json", "User-Agent": "agsist-sponsor-apply"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def main():
    if "--selftest" in sys.argv:
        return selftest()
    base = (env("LIST_URL") or "").rstrip("/")
    tok, secret = env("LIST_TOKEN"), env("UNSUB_SECRET")
    if not (base and tok and secret):
        print("LIST_URL, LIST_TOKEN and UNSUB_SECRET are required")
        return 1
    dry = env("DRY_RUN") == "1"
    sig = env("SPONSOR_TO", "sig@agsist.com")
    fn, fa, rt = env("FROM_NAME", "AGSIST"), log_safe.sender_addr(), env("REPLY_TO") or sig
    card = json.loads((REPO / "data" / "rate-card.json").read_text())
    slot_list = json.loads((REPO / "data" / "sponsor-slots.json").read_text()).get("slots", [])
    slots_by_id = {s["id"]: s for s in slot_list}
    try:
        apps = worker(base, "sponsor-apps", tok)
    except Exception as e:                                   # noqa: BLE001
        print("worker has no /sponsor-apps yet (deploy workers/subs-worker.js v5.5):", e)
        return 0
    today = today_ct()
    sold = json.loads((REPO / "data" / "page-sponsors.json").read_text())
    sup = json.loads((REPO / "data" / "supporters.json").read_text())
    todo = plan(apps, time.time() * 1000, today, sold, sup, card, slot_list)
    print("applications %d; actions %s" % (len(apps), [(x[0], x[1]["id"]) for x in todo]))
    if dry or not todo:
        return 0
    ctx = ssl.create_default_context()
    conn = None

    def send(to, kw):
        nonlocal conn
        if conn is None:
            conn = smtplib.SMTP(env("SMTP_HOST", "smtp.gmail.com"), int(env("SMTP_PORT", "587")), timeout=30)
            conn.starttls(context=ctx)
            conn.login(env("SMTP_USER"), env("SMTP_PASS"))
        conn.send_message(msg(to, fn=fn, fa=fa, rt=rt, **kw))

    def mark(a, **s):
        worker(base, "sponsor-mark", tok, {"id": a["id"], "set": s})

    failed = 0
    for action, a in todo:
        try:
            if action == "expire":
                mark(a, status="expired")
                continue
            if action == "golive":
                start = today
                logo = worker(base, "sponsor-logo", tok, i=a["id"]).get("logo", "") if a.get("logo_len") else ""
                slug, files = go_live(a, logo, card, start, slots=slot_list)
                if not push(files, "sponsor live: %s (%s)" % (a["company"], what(a))):
                    print("push failed; %s stays approved for the next run" % a["id"])
                    failed += 1
                    continue
                a = dict(a, start=start.isoformat(), _page=(slots_by_id.get(a.get("slot")) or {}).get("page"),
                         _portal=portal_link(a["id"]))
                mark(a, status="live", start=a["start"], slug=slug)
            if action == "takedown":
                if not push(take_down(a), "sponsor ended: %s" % a["company"]):
                    failed += 1
                    continue
                mark(a, status="ended")
            for to, kw in emails_for(action, a, base, secret, card, today, sig, slot_list):
                send(to, kw)
            if action == "confirm":
                mark(a, m=1)
            elif action == "notify":
                mark(a, notified=1)
            elif action in ("daily", "clash", "held"):
                mark(a, notified=2)
            elif action == "declined":
                mark(a, m=2)
            elif action == "freeending":
                mark(a, reminded=1)
            elif action == "invoice":
                mark(a, invoiced=(a.get("invoiced") or 0) + 1)
        except Exception as e:                               # noqa: BLE001
            failed += 1
            # mask_text: an SMTPRecipientsRefused message carries the address
            print("%s %s failed: %s" % (action, a.get("id"), log_safe.mask_text(e)))
    if conn:
        conn.quit()
    return 1 if failed else 0


# ───────────────────────────── selftest ─────────────────────────────

def selftest():
    import tempfile
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else "  -- %s" % (detail,)))
        if not ok:
            fails.append(name)

    now = datetime(2026, 10, 7, 15, 0, tzinfo=timezone.utc)
    now_ms = now.timestamp() * 1000
    today = today_ct(now)
    A = lambda **k: dict({"id": "a1b2c3d4e5f6", "ts": now_ms - 3600e3, "status": "pending", "m": 0, "notified": 0,
                          "tier": "page", "slot": "cash-bids", "company": "Smith Seed & Supply", "contact": "Al",
                          "email": "al@smith.com", "phone": "", "headline": "Seed", "body": "", "url": "https://smith.com",
                          "logo_len": 0}, **k)
    empty_sold, empty_sup = {"slots": {}}, {"cap": 6, "supporters": []}
    card = {"tiers": [{"id": "daily", "price_month": 149}, {"id": "cashbids", "price_month": 49},
                      {"id": "state", "price_month": 29, "price_by_state": {"WI": 49, "TX": 49}, "opens_soon": ["CA", "NV", "TX"]},
                      {"id": "elevator", "price_month": 19}]}
    slots = [{"id": "cash-bids", "tier": "cashbids"}, {"id": "spray", "tier": None},
             {"id": "cash-bids-wisconsin", "tier": "state", "state": "WI"}, {"id": "rent-wi", "tier": "state", "state": "WI"},
             {"id": "cash-bids-iowa", "tier": "state", "state": "IA"}, {"id": "rent-ia", "tier": "state", "state": "IA"},
             {"id": "cash-bids-texas", "tier": "state", "state": "TX"}, {"id": "rent-tx", "tier": "state", "state": "TX"},
             {"id": "rent-ca", "tier": "state", "state": "CA"}, {"id": "rent-nv", "tier": "state", "state": "NV"}]
    P = lambda apps, sold=empty_sold: [x[0] for x in plan(apps, now_ms, today, sold, empty_sup, card, slots)]

    print("planning")
    ck("a new application gets a confirmation", P([A()]) == ["confirm"])
    ck("a mailed one is left alone", P([A(m=1)]) == [])
    ck("15 days unconfirmed expires", P([A(ts=now_ms - 15 * 864e5)]) == ["expire"])
    ck("confirmed: Sig is told once", P([A(status="confirmed")]) == ["notify"] and P([A(status="confirmed", notified=1)]) == [])
    ck("the form's tiers read back from tier + slot",
       [card_tier(A(slot=x)) for x in ("cash-bids", "cash-bids-north-dakota", "rent-wi", "fe-wi-cadott", "spray", "rent-hub")]
       == ["cashbids", "state", "state", "elevator", None, None] and card_tier(A(tier="daily", slot="briefing")) == "daily"
       and card_tier(A(tier="supporter", slot="footer")) is None)
    ck("approved Cash Bids goes live", P([A(status="approved")]) == ["golive"])
    ck("approved State Sponsor goes live", P([A(status="approved", slot="cash-bids-wisconsin")]) == ["golive"])
    ck("California, Nevada and Texas are held: refused, told to Sig, never auto-live",
       [P([A(status="approved", slot=x)]) for x in ("rent-ca", "rent-nv", "rent-tx", "cash-bids-texas")] == [["held"]] * 4)
    ck("held is said once", P([A(status="approved", slot="rent-ca", notified=2)]) == [])
    ck("approved daily is handed to Sig, never auto-live", P([A(status="approved", tier="daily")]) == ["daily"])
    ck("a Featured elevator is handed to Sig, never auto-live", P([A(status="approved", slot="fe-wi-cadott")]) == ["daily"])
    ck("a retired page slot or Supporter is handed to Sig, never auto-live",
       P([A(status="approved", slot="spray")]) == ["daily"] and P([A(status="approved", tier="supporter", slot="footer")]) == ["daily"])
    ck("an approved row under an older tier id is handed to Sig too, never auto-live",
       P([A(status="approved", tier="old-id")]) == ["daily"])
    taken = {"slots": {"cash-bids": {"app": "ffffffffffff", "active": True}}}
    ck("a page someone else holds is a clash, not an overwrite", P([A(status="approved")], taken) == ["clash"])
    ck("a state is a clash when any one of its ribbons is held",
       P([A(status="approved", slot="cash-bids-wisconsin")], {"slots": {"rent-wi": {"app": "ffffffffffff"}}}) == ["clash"])
    ck("declined: one note", P([A(status="declined")]) == ["declined"] and P([A(status="declined", m=2)]) == [])
    ck("ending is taken down", P([A(status="ending")]) == ["takedown"])
    ck("a bad id is ignored", P([A(id="../x")]) == [])
    ck("plan still runs without a card (old callers)", [x[0] for x in plan([A(status="approved")], now_ms, today, empty_sold, empty_sup)] == ["golive"])

    print("\nthe money calendar (start Sep 10)")
    live = lambda **k: A(status="live", start="2026-09-10", **k)
    ck("free month: Sep 10 - Oct 9", add_months(date(2026, 9, 10), 1) - timedelta(days=1) == date(2026, 10, 9))
    ck("Oct 7 (2 days before the end): the sponsor is told", P([live()]) == ["freeending"])
    ck("told once", P([live(reminded=1)]) == [])
    on = lambda d, **k: [x[0] for x in plan([live(reminded=1, **k)], now_ms, d, empty_sold, empty_sup, card, slots)]
    ck("Oct 10: first invoice reminder to Sig", on(date(2026, 10, 10)) == ["invoice"])
    ck("after it is sent, nothing until Nov 10", on(date(2026, 11, 9), invoiced=1) == [] and on(date(2026, 11, 10), invoiced=1) == ["invoice"])
    ck("Jan 31 start: month ends clamp (Feb 28)", add_months(date(2026, 1, 31), 1) == date(2026, 2, 28))

    print("\nprices from the card")
    ck("State Sponsor in WI is $49, in IA $29", app_rate(card, A(slot="rent-wi"), slots) == 49 and app_rate(card, A(slot="cash-bids-iowa"), slots) == 29)
    ck("Cash Bids $49, Featured elevator $19, Daily $149",
       (app_rate(card, A(), slots), app_rate(card, A(slot="fe-wi-cadott"), slots), app_rate(card, A(tier="daily"), slots)) == (49, 19, 149))
    ck("a retired tier has no price", app_rate(card, A(slot="spray"), slots) is None)

    print("\nsite writes")
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / "data").mkdir()
        (root / "data" / "page-sponsors.json").write_text(json.dumps(empty_sold))
        (root / "data" / "supporters.json").write_text(json.dumps(empty_sup))
        (root / "data" / "sponsor-slots.json").write_text(json.dumps({"slots": slots}))
        (root / "data" / "sponsors.json").write_text(json.dumps({"sponsors": [{"slug": "rootlot", "geo": "rootlot", "active": True}]}))
        png = "data:image/png;base64," + base64.b64encode(b"\x89PNG fake").decode()
        slug, files = go_live(A(status="approved", logo_len=1), png, card, date(2026, 10, 7), root)
        e = json.loads((root / "data" / "page-sponsors.json").read_text())["slots"]["cash-bids"]
        ck("Cash Bids entry written", e["company"] == "Smith Seed & Supply" and e["start"] == "2026-10-07" and e["price_month"] == 49 and e["tier"] == "cashbids", e)
        ck("no email or contact name in the public file", "email" not in e and "contact" not in e and "al@smith.com" not in json.dumps(e))
        ck("logo written under img/sponsors", e["logo"] == "/img/sponsors/smith-seed-supply-cash-bids.png" and (root / e["logo"][1:]).exists())
        ck("files reported for the commit", "data/page-sponsors.json" in files and "img/sponsors/smith-seed-supply-cash-bids.png" in files)
        ck("a rerun changes nothing", go_live(A(status="approved"), png, card, date(2026, 10, 8), root)[1] == [])
        rep_ = [x for x in json.loads((root / "data" / "sponsors.json").read_text())["sponsors"] if x.get("app") == "a1b2c3d4e5f6"]
        ck("going live writes one report entry: its own token and its ribbon, no contact",
           len(rep_) == 1 and re.fullmatch(r"[0-9a-f]{16}", rep_[0]["token"]) and rep_[0]["page_slots"] == ["cash-bids"]
           and rep_[0]["billing"]["tier"] == "cashbids" and rep_[0]["start"] == "2026-10-07"
           and "al@smith.com" not in json.dumps(rep_) and "data/sponsors.json" in files, rep_)
        ck("the report link is the agsist.com portal with an opaque token",
           portal_link("a1b2c3d4e5f6", root) == "%s/sponsor-report?r=%s-%s" % (SITE, rep_[0]["slug"], rep_[0]["token"]))
        ck("an svg/bad logo is not written", write_logo(A(), "data:image/svg+xml;base64,PHN2Zz4=", "x", root) == "")
        W = A(id="0123456789ab", slot="cash-bids-wisconsin", company="Barron Co-op")
        go_live(W, "", card, date(2026, 10, 7), root)
        sold = json.loads((root / "data" / "page-sponsors.json").read_text())["slots"]
        ck("a State Sponsor takes every ribbon of its state, at its state's price",
           sold["cash-bids-wisconsin"]["app"] == sold["rent-wi"]["app"] == "0123456789ab"
           and sold["rent-wi"]["price_month"] == 49 and sold["rent-wi"]["state"] == "WI" and "rent-ia" not in sold, sold)
        ck("and the state rerun changes nothing", go_live(W, "", card, date(2026, 10, 8), root)[1] == [])
        we = [x for x in json.loads((root / "data" / "sponsors.json").read_text())["sponsors"] if x.get("app") == "0123456789ab"]
        ck("a State Sponsor's report entry holds every ribbon of its state, and its state",
           len(we) == 1 and we[0]["page_slots"] == ["cash-bids-wisconsin", "rent-wi"] and we[0]["billing"]["state"] == "WI"
           and we[0]["regions"] == ["WI"], we)
        for x in ("rent-ca", "rent-nv", "cash-bids-texas"):
            try:
                go_live(A(id="0000000000aa", slot=x), "", card, date(2026, 10, 7), root)
                ck("a held state is never written (%s)" % x, False)
            except ValueError:
                ck("a held state is never written (%s)" % x, x not in json.loads((root / "data" / "page-sponsors.json").read_text())["slots"]
                   and not any(e.get("app") == "0000000000aa" for e in json.loads((root / "data" / "sponsors.json").read_text())["sponsors"]))
        try:
            go_live(A(slot="spray"), "", card, date(2026, 10, 7), root)
            ck("a retired slot is never written", False)
        except ValueError:
            ck("a retired slot is never written", "spray" not in json.loads((root / "data" / "page-sponsors.json").read_text())["slots"])
        ch = take_down(A(status="ending"), root, date(2026, 11, 20))
        ended = [x for x in json.loads((root / "data" / "sponsors.json").read_text())["sponsors"] if x.get("app") == "a1b2c3d4e5f6"]
        ck("take-down ends the report entry, keeps it readable", ended[0]["active"] is False and ended[0]["ended"] == "2026-11-20"
           and "data/sponsors.json" in ch)
        ck("take-down frees the page and removes the logo",
           "cash-bids" not in json.loads((root / "data" / "page-sponsors.json").read_text())["slots"] and not (root / e["logo"][1:]).exists() and ch)
        take_down(W, root, date(2026, 11, 20))
        ck("a State Sponsor's take-down frees every ribbon of the state",
           json.loads((root / "data" / "page-sponsors.json").read_text())["slots"] == {})
        (root / "data" / "supporters.json").write_text(json.dumps({"cap": 6, "supporters": [{"name": "Old", "app": "0123456789ab", "active": True}]}))
        take_down(W, root, date(2026, 11, 20))
        ck("an old Supporter on file still comes down", json.loads((root / "data" / "supporters.json").read_text())["supporters"] == [])

    print("\nworker urls")
    seen = []

    class FakeResp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b'{"ok":true}'
    real = urllib.request.urlopen
    urllib.request.urlopen = lambda req, timeout=0: (seen.append(req.full_url), FakeResp())[1]
    try:
        worker("https://w.dev", "sponsor-logo", "t k", i="a1b2c3d4e5f6")
    finally:
        urllib.request.urlopen = real
    ck("query string is built, not glued", seen == ["https://w.dev/sponsor-logo?i=a1b2c3d4e5f6&token=t+k"], seen)

    print("\nemails")
    em = emails_for("confirm", A(), "https://w.dev", "sec", card, today, "sig@x.com")
    ck("confirm goes to the applicant with a signed link",
       em[0][0] == "al@smith.com" and ("t=" + token("sec", "a1b2c3d4e5f6|sc")) in em[0][1]["button"][1])
    em = emails_for("notify", A(status="confirmed"), "https://w.dev", "sec", card, today, "sig@x.com")
    ck("Sig's email carries approve and decline, signed for Sig",
       em[0][0] == "sig@x.com" and token("sec", "a1b2c3d4e5f6|sd|approve") in em[0][1]["button"][1]
       and "d=decline" in em[0][1]["links"][0][1])
    ck("the price comes from the card", any("$49 a month" in p for p in em[0][1]["paras"]))
    em = emails_for("notify", A(status="confirmed", slot="rent-wi"), "https://w.dev", "sec", card, today, "sig@x.com", slots)
    ck("a Wisconsin State Sponsor is quoted $49", any("$49 a month" in p for p in em[0][1]["paras"]) and "State Sponsor" in em[0][1]["subject"])
    em = emails_for("notify", A(status="confirmed", slot="spray"), "https://w.dev", "sec", card, today, "sig@x.com", slots)
    ck("Sig hears that a retired slot is no longer sold", any("no longer sold" in p for p in em[0][1]["paras"]))
    em = emails_for("held", A(status="approved", slot="rent-nv"), "https://w.dev", "sec", card, today, "sig@x.com", slots)
    ck("a held state's email goes to Sig only and says nothing went live",
       len(em) == 1 and em[0][0] == "sig@x.com" and "NV" in em[0][1]["subject"] and any("Nothing went live" in p for p in em[0][1]["paras"]))
    em = emails_for("freeending", A(status="live", start="2026-09-10"), "https://w.dev", "sec", card, today, "sig@x.com")
    ck("the day-30 email asks yes or no, and no reply owes nothing",
       any("yes or no" in p for p in em[0][1]["paras"]) and any("No reply means the ad comes down and nothing is owed" in p for p in em[0][1]["paras"]))
    em = emails_for("invoice", A(status="live", start="2026-09-10", invoiced=0), "https://w.dev", "sec", card, today, "sig@x.com")
    ck("the first invoice only after a yes", any("Only if they said yes" in p for p in em[0][1]["paras"]))
    link = SITE + "/sponsor-report?r=smith-cashbids-" + "0" * 16
    em = emails_for("golive", A(status="live", start="2026-10-07", _page="/cash-bids", _portal=link), "https://w.dev", "sec", card, today, "sig@x.com")
    ck("the go-live email gives the sponsor its own report page", any(link in p for p in em[0][1]["paras"]) and any(link in p for p in em[1][1]["paras"]))
    ck("and says no reply on day 30 owes nothing", any("No reply means the ad comes down and nothing is owed" in p for p in em[0][1]["paras"]))
    try:
        email_links.check_hosts(msg("al@smith.com", fa="x@agsist.com", **em[0][1]))
        ck("the report link passes the link host check", True)
    except email_links.LinkError:
        ck("the report link passes the link host check", False)
    em = emails_for("invoice", A(status="live", start="2026-09-10", invoiced=0), "https://w.dev", "sec", card, today, "sig@x.com")
    ck("invoice reminder names the month", "Oct 10, 2026 to Nov 9, 2026" in em[0][1]["paras"][0], em[0][1]["paras"][0])
    m = msg("a@b.com", fa="x@agsist.com", **emails_for("confirm", A(company="<b>x</b>"), "https://w.dev", "sec", card, today, "s")[0][1])
    ck("html escapes what the applicant typed", "<b>x</b>" not in m.get_body(("html",)).get_content())
    em = emails_for("confirm", A(), "https://agsist-api.dnilgis.workers.dev", "sec", card, today, "sig@x.com")
    ck("the confirm link is the agsist.com front door, never the worker (Oct 22)",
       em[0][1]["button"][1] == email_links.FRONT + "?a=sponsor-confirm&i=a1b2c3d4e5f6&t=" + token("sec", "a1b2c3d4e5f6|sc"))
    em = emails_for("notify", A(status="confirmed"), "https://agsist-api.dnilgis.workers.dev", "sec", card, today, "sig@x.com")
    us = [em[0][1]["button"][1]] + [x[1] for x in em[0][1].get("links") or []]
    ck("Sig's decide links are the front door too", us and all(u.startswith(email_links.FRONT + "?a=sponsor-decide&i=a1b2c3d4e5f6&d=") for u in us), us)
    m = msg("sig@x.com", fa="x@agsist.com", **em[0][1])
    try:
        email_links.check_hosts(m)
        ck("no worker host in the email", "workers.dev" not in m.as_string())
    except email_links.LinkError:
        ck("no worker host in the email", False)

    print()
    if fails:
        print("%d FAILED: %s" % (len(fails), "; ".join(fails)))
        return 1
    print("sponsor_apply: all checks pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
