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
  approved (page/supporter)   -> the ad is written into the site and pushed:
                                 data/page-sponsors.json or data/supporters.json,
                                 the logo to img/sponsors/. Then marked live with
                                 its start date, and both sides are told.
  approved (founding)         -> Sig is told it needs setting up by hand (the
                                 sponsor card has its own approval flow).
  declined                    -> one polite note to the applicant.
  live                        -> 3 days before the free month ends, the sponsor
                                 hears what happens next; on each monthly date
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

try:
    from zoneinfo import ZoneInfo
    CT = ZoneInfo("America/Chicago")
except Exception:                                          # noqa: BLE001
    CT = None

REPO = Path(__file__).resolve().parent.parent
SITE = "https://agsist.com"
ADDRESS = "AGSIST, PO Box 243, Chetek, WI 54728"
PEND_TTL_MS = 14 * 864e5
TIER_NAME = {"page": "Own a page", "supporter": "Supporter", "founding": "Sponsor"}


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


def rate(card, tier):
    t = next((x for x in (card or {}).get("tiers", []) if x.get("id") == tier), None)
    return t.get("price_month") if t else None


def money(n):
    return "$%d" % n if isinstance(n, int) else "the rate on the card"


def fmt(d):
    return d.strftime("%b ") + str(d.day) + d.strftime(", %Y")


# ───────────────────────────── planning ─────────────────────────────

def plan(apps, now_ms, today, sold_pages, supporters):
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
            if a.get("tier") == "founding":
                if (a.get("notified") or 0) < 2:
                    out.append(("founding", a))
            elif a.get("tier") == "page" and slot_owner(sold_pages, a.get("slot")) not in (None, aid):
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


def go_live(a, logo, card, start, root=REPO):
    """Write the ad into the site. Returns (slug, files changed). Idempotent:
    an entry already carrying this application id is left as it is."""
    slug = slugify(a.get("company"))
    price = rate(card, a["tier"])
    if a["tier"] == "page":
        p = root / "data" / "page-sponsors.json"
        d = json.loads(p.read_text())
        slots = d.setdefault("slots", {})
        cur = slots.get(a["slot"])
        if cur and cur.get("app") == a["id"]:
            return cur.get("slug", slug), []
        path = write_logo(a, logo, slug + "-" + a["slot"], root)
        slots[a["slot"]] = {"company": a["company"], "headline": a.get("headline") or "", "body": a.get("body") or "",
                            "url": a["url"], "logo": path, "start": start.isoformat(), "active": True,
                            "slug": slug, "app": a["id"], "price_month": price}
        # No contact name or email here: this file is public. The job reads
        # those from the worker when it needs them (invoice reminders).
        p.write_text(json.dumps(d, indent=1, ensure_ascii=False) + "\n")
        return slug, ["data/page-sponsors.json"] + ([path.lstrip("/")] if path else [])
    p = root / "data" / "supporters.json"
    d = json.loads(p.read_text())
    lst = d.setdefault("supporters", [])
    if any(s.get("app") == a["id"] for s in lst):
        return slug, []
    path = write_logo(a, logo, slug, root)
    lst.append({"name": a["company"], "url": a["url"], "logo": path, "active": True,
                "start": start.isoformat(), "app": a["id"], "price_month": price})
    p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
    return slug, ["data/supporters.json"] + ([path.lstrip("/")] if path else [])


def take_down(a, root=REPO):
    """Free the slot. The entry is removed, not just hidden, so the page sells
    it again; the logo file goes with it."""
    changed = []
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
    m.set_content(text + "\n\n--\n" + ADDRESS + "\n")
    e = H.escape
    body = "".join('<p style="font-size:14px;line-height:1.6;margin:0 0 12px">%s</p>' % e(p) for p in paras)
    btn = ('<p style="margin:18px 0"><a href="%s" style="background:#e8743a;color:#0d1117;text-decoration:none;'
           'padding:11px 18px;font-weight:bold;border-radius:6px">%s</a></p>' % (e(button[1]), e(button[0]))) if button else ""
    more = "".join('<p style="margin:6px 0"><a href="%s">%s</a></p>' % (e(u), e(l)) for l, u in links or [])
    m.add_alternative('<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:24px 16px;color:#1a1a1a">'
                      '%s%s%s<p style="font-size:12px;color:#6b6b6b">%s</p></div>' % (body, btn, more, e(ADDRESS)), subtype="html")
    return m


def what(a):
    return "%s (%s)" % (TIER_NAME.get(a["tier"], a["tier"]), "/" + a["slot"] if a["tier"] == "page" and not a["slot"].startswith("rent-")
                        else ("rent page " + a["slot"][5:].upper() if a["tier"] == "page" else "footer" if a["tier"] == "supporter" else "briefing"))


def ad_lines(a):
    return ["Business: %s" % a["company"], "Headline: %s" % (a.get("headline") or "(none)"),
            "Copy: %s" % (a.get("body") or "(none)"), "Link: %s" % a["url"],
            "Logo: %s" % ("attached to the application" if a.get("logo_len") else "none, the name is shown as text")]


def emails_for(action, a, base, secret, card, today, sig):
    """-> [(to, EmailMessage-kwargs)] for one planned action. Pure."""
    price = money(rate(card, a["tier"]))
    dec = lambda d: "%s/sponsor-decide?i=%s&d=%s&t=%s" % (base, a["id"], d, token(secret, a["id"] + "|sd|" + d))
    if action == "confirm":
        go = "%s/sponsor-confirm?i=%s&t=%s" % (base, a["id"], token(secret, a["id"] + "|sc"))
        return [(a["email"], dict(subject="Confirm your AGSIST ad: %s" % a["company"], paras=[
            "Hi %s, thanks for putting %s on AGSIST: %s." % (a.get("contact") or "there", a["company"], what(a)),
            "Click below to confirm it was you. Then it goes to Sig, who reads every ad himself.",
            "The first month is free. After that it's %s a month, invoiced, and you can cancel any time by replying." % price,
            "Didn't ask for this? Ignore this email and nothing happens."], button=("CONFIRM MY AD", go)))]
    if action == "notify":
        lines = ["New AGSIST sponsor waiting for you: %s." % what(a)] + ad_lines(a) + [
            "Contact: %s, %s%s." % (a.get("contact") or "?", a["email"], (", " + a["phone"]) if a.get("phone") else ""),
            "Price: first month free, then %s a month." % price]
        if a["tier"] == "founding":
            lines.append("Sponsor slot: approving tells you to set it up by hand (the briefing card has its own proof and approval).")
        else:
            lines.append("Approve and it goes live within the hour; the free month starts that day.")
        return [(sig, dict(subject="New sponsor: %s, %s" % (a["company"], what(a)), paras=lines,
                           button=("APPROVE", dec("approve")), links=[("Decline", dec("decline"))]))]
    if action == "golive":
        start = date.fromisoformat(a["start"])
        free_end = add_months(start, 1) - timedelta(days=1)
        where = (SITE + "/" + a["_page"].lstrip("/")) if a.get("_page") else SITE
        return [(a["email"], dict(subject="You're live on AGSIST", paras=[
            "%s is now on AGSIST: %s. See it: %s" % (a["company"], what(a), where),
            "Your free month runs %s to %s. Sig will email an invoice for %s around %s, then one a month after that." % (
                fmt(start), fmt(free_end), price, fmt(free_end + timedelta(days=1))),
            "Want the copy changed, or to stop? Just reply to this email."])),
                (sig, dict(subject="Live: %s, %s" % (a["company"], what(a)), paras=[
                    "%s went live today. Free through %s; first invoice (%s) due %s." % (
                        a["company"], fmt(free_end), price, fmt(free_end + timedelta(days=1)))],
                    links=[("End it (frees the slot)", dec("end"))]))]
    if action == "founding":
        return [(sig, dict(subject="Sponsor approved: %s" % a["company"], paras=[
            "You approved %s for the sponsor slot. That one is set up by hand, like Apex:" % a["company"]] + ad_lines(a) + [
            "Contact: %s, %s%s." % (a.get("contact") or "?", a["email"], (", " + a["phone"]) if a.get("phone") else ""),
            "Nothing has gone live and the applicant has not been told anything yet."]))]
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
            "Staying on? Nothing to do. Sig will email an invoice for %s, once a month." % price,
            "Want to stop? Reply to this email and the slot comes down. No charge for the free month."]))]
    if action == "invoice":
        start = date.fromisoformat(a["start"])
        k = (a.get("invoiced") or 0) + 1
        p0, p1 = add_months(start, k), add_months(start, k + 1) - timedelta(days=1)
        return [(sig, dict(subject="Invoice due: %s, %s" % (a["company"], price), paras=[
            "Time to invoice %s for %s: %s, %s to %s (month %d after the free one)." % (
                a["company"], what(a), price, fmt(p0), fmt(p1), k),
            "Bill to: %s, %s%s." % (a.get("contact") or a["company"], a["email"], (", " + a["phone"]) if a.get("phone") else ""),
            "If they don't pay, end it and the slot goes back on the market."],
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
    sig = env("SPONSOR_TO", "sig@farmers1st.com")
    fn, fa, rt = env("FROM_NAME", "AGSIST"), env("FROM_ADDR") or env("SMTP_USER") or "", env("REPLY_TO") or sig
    card = json.loads((REPO / "data" / "rate-card.json").read_text())
    slots_by_id = {s["id"]: s for s in json.loads((REPO / "data" / "sponsor-slots.json").read_text()).get("slots", [])}
    try:
        apps = worker(base, "sponsor-apps", tok)
    except Exception as e:                                   # noqa: BLE001
        print("worker has no /sponsor-apps yet (deploy workers/subs-worker.js v5.5):", e)
        return 0
    today = today_ct()
    sold = json.loads((REPO / "data" / "page-sponsors.json").read_text())
    sup = json.loads((REPO / "data" / "supporters.json").read_text())
    todo = plan(apps, time.time() * 1000, today, sold, sup)
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
                slug, files = go_live(a, logo, card, start)
                if not push(files, "sponsor live: %s (%s)" % (a["company"], what(a))):
                    print("push failed; %s stays approved for the next run" % a["id"])
                    failed += 1
                    continue
                a = dict(a, start=start.isoformat(), _page=(slots_by_id.get(a.get("slot")) or {}).get("page"))
                mark(a, status="live", start=a["start"], slug=slug)
            if action == "takedown":
                if not push(take_down(a), "sponsor ended: %s" % a["company"]):
                    failed += 1
                    continue
                mark(a, status="ended")
            for to, kw in emails_for(action, a, base, secret, card, today, sig):
                send(to, kw)
            if action == "confirm":
                mark(a, m=1)
            elif action == "notify":
                mark(a, notified=1)
            elif action in ("founding", "clash"):
                mark(a, notified=2)
            elif action == "declined":
                mark(a, m=2)
            elif action == "freeending":
                mark(a, reminded=1)
            elif action == "invoice":
                mark(a, invoiced=(a.get("invoiced") or 0) + 1)
        except Exception as e:                               # noqa: BLE001
            failed += 1
            print("%s %s failed: %s" % (action, a.get("id"), e))
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
                          "tier": "page", "slot": "spray", "company": "Smith Seed & Supply", "contact": "Al",
                          "email": "al@smith.com", "phone": "", "headline": "Seed", "body": "", "url": "https://smith.com",
                          "logo_len": 0}, **k)
    empty_sold, empty_sup = {"slots": {}}, {"cap": 6, "supporters": []}
    P = lambda apps, sold=empty_sold: [x[0] for x in plan(apps, now_ms, today, sold, empty_sup)]

    print("planning")
    ck("a new application gets a confirmation", P([A()]) == ["confirm"])
    ck("a mailed one is left alone", P([A(m=1)]) == [])
    ck("15 days unconfirmed expires", P([A(ts=now_ms - 15 * 864e5)]) == ["expire"])
    ck("confirmed: Sig is told once", P([A(status="confirmed")]) == ["notify"] and P([A(status="confirmed", notified=1)]) == [])
    ck("approved page goes live", P([A(status="approved")]) == ["golive"])
    ck("approved founding is handed to Sig, never auto-live", P([A(status="approved", tier="founding")]) == ["founding"])
    taken = {"slots": {"spray": {"app": "ffffffffffff", "active": True}}}
    ck("a page someone else holds is a clash, not an overwrite", P([A(status="approved")], taken) == ["clash"])
    ck("declined: one note", P([A(status="declined")]) == ["declined"] and P([A(status="declined", m=2)]) == [])
    ck("ending is taken down", P([A(status="ending")]) == ["takedown"])
    ck("a bad id is ignored", P([A(id="../x")]) == [])

    print("\nthe money calendar (start Sep 10)")
    live = lambda **k: A(status="live", start="2026-09-10", **k)
    ck("free month: Sep 10 - Oct 9", add_months(date(2026, 9, 10), 1) - timedelta(days=1) == date(2026, 10, 9))
    ck("Oct 7 (2 days before the end): the sponsor is told", P([live()]) == ["freeending"])
    ck("told once", P([live(reminded=1)]) == [])
    on = lambda d, **k: [x[0] for x in plan([live(reminded=1, **k)], now_ms, d, empty_sold, empty_sup)]
    ck("Oct 10: first invoice reminder to Sig", on(date(2026, 10, 10)) == ["invoice"])
    ck("after it is sent, nothing until Nov 10", on(date(2026, 11, 9), invoiced=1) == [] and on(date(2026, 11, 10), invoiced=1) == ["invoice"])
    ck("Jan 31 start: month ends clamp (Feb 28)", add_months(date(2026, 1, 31), 1) == date(2026, 2, 28))

    print("\nsite writes")
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / "data").mkdir()
        (root / "data" / "page-sponsors.json").write_text(json.dumps(empty_sold))
        (root / "data" / "supporters.json").write_text(json.dumps(empty_sup))
        card = {"tiers": [{"id": "page", "price_month": 29}, {"id": "supporter", "price_month": 15}]}
        png = "data:image/png;base64," + base64.b64encode(b"\x89PNG fake").decode()
        slug, files = go_live(A(status="approved", logo_len=1), png, card, date(2026, 10, 7), root)
        e = json.loads((root / "data" / "page-sponsors.json").read_text())["slots"]["spray"]
        ck("page entry written", e["company"] == "Smith Seed & Supply" and e["start"] == "2026-10-07" and e["price_month"] == 29, e)
        ck("no email or contact name in the public file", "email" not in e and "contact" not in e and "al@smith.com" not in json.dumps(e))
        ck("logo written under img/sponsors", e["logo"] == "/img/sponsors/smith-seed-supply-spray.png" and (root / e["logo"][1:]).exists())
        ck("files reported for the commit", "data/page-sponsors.json" in files and "img/sponsors/smith-seed-supply-spray.png" in files)
        ck("a rerun changes nothing", go_live(A(status="approved"), png, card, date(2026, 10, 8), root)[1] == [])
        ck("an svg/bad logo is not written", write_logo(A(), "data:image/svg+xml;base64,PHN2Zz4=", "x", root) == "")
        s2, f2 = go_live(A(id="0123456789ab", tier="supporter", slot="footer", company="Barron Co-op"), "", card, date(2026, 10, 7), root)
        sp = json.loads((root / "data" / "supporters.json").read_text())["supporters"]
        ck("supporter appended, active, no logo", len(sp) == 1 and sp[0]["active"] is True and sp[0]["logo"] == "" and sp[0]["price_month"] == 15)
        ch = take_down(A(status="ending"), root)
        ck("take-down frees the page and removes the logo",
           json.loads((root / "data" / "page-sponsors.json").read_text())["slots"] == {} and not (root / e["logo"][1:]).exists() and ch)
        take_down(A(id="0123456789ab"), root)
        ck("and the supporter", json.loads((root / "data" / "supporters.json").read_text())["supporters"] == [])

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
    card = {"tiers": [{"id": "page", "price_month": 29}]}
    em = emails_for("confirm", A(), "https://w.dev", "sec", card, today, "sig@x.com")
    ck("confirm goes to the applicant with a signed link",
       em[0][0] == "al@smith.com" and ("t=" + token("sec", "a1b2c3d4e5f6|sc")) in em[0][1]["button"][1])
    em = emails_for("notify", A(status="confirmed"), "https://w.dev", "sec", card, today, "sig@x.com")
    ck("Sig's email carries approve and decline, signed for Sig",
       em[0][0] == "sig@x.com" and token("sec", "a1b2c3d4e5f6|sd|approve") in em[0][1]["button"][1]
       and "d=decline" in em[0][1]["links"][0][1])
    ck("the price comes from the card", any("$29 a month" in p for p in em[0][1]["paras"]))
    em = emails_for("invoice", A(status="live", start="2026-09-10", invoiced=0), "https://w.dev", "sec", card, today, "sig@x.com")
    ck("invoice reminder names the month", "Oct 10, 2026 to Nov 9, 2026" in em[0][1]["paras"][0], em[0][1]["paras"][0])
    m = msg("a@b.com", fa="x@agsist.com", **emails_for("confirm", A(company="<b>x</b>"), "https://w.dev", "sec", card, today, "s")[0][1])
    ck("html escapes what the applicant typed", "<b>x</b>" not in m.get_body(("html",)).get_content())

    print()
    if fails:
        print("%d FAILED: %s" % (len(fails), "; ".join(fails)))
        return 1
    print("sponsor_apply: all checks pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
