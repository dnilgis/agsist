#!/usr/bin/env python3
"""
"Email me this design" on /rain-print (2026-10-20). A reader
who drew a print and did not buy can ask for it by email: the link to their
own design now, and ONE reminder the next day if no paid order matches it.
Then nothing.

  Which asks    the subs worker's GET /rp-remind/list (worker v5.43, Bearer
                LIST_TOKEN): {key, email, code, ref, ts, sent, reminded, done,
                stop_t}, kept 7 days.
  The link      https://agsist.com/rain-print?d=<code>: the design code the
                page made, which opens with their print first, as they left it.
  Now           a row not yet sent gets "Your Rain Print design: <town>,
                <year>", marked sent (POST /rp-remind/mark) BEFORE the send,
                so a rerun can never send it twice.
                An ask still unanswered after NOW_MAX_H hours is marked done, not
                mailed: a link days late reads wrong (Nov 3, 2026).
  Next day      from REMIND_AFTER_H hours after the ask, one reminder, marked
                reminded first, unless a paid order matches the design, in
                which case the row is marked done and nothing goes. A paid
                order matches when its ref (GIFT- left off) is the design's
                code or its RPS ref, or it is for the same town and year and
                was pressed after the ask (less a day), or Stripe's buyer
                address for it (GET /rp-order/buyer) is the reader's. If the
                order records cannot be read, no reminder goes this run.
                Past GIVE_UP_H hours with no reminder sent, the row is marked
                done: a reminder a week late is not the next day.
  Words         plain, the owner's voice. The reminder carries the Christmas
                order-by dates from data/rain-print.json for a past year
                while they hold (October 1 to the cutoff), never a countdown,
                and the owner's guarantee. Every email has a stop link
                (/rp-remind/stop) and says it is the only reminder.
  Log           counts only: never an address, a town or a design.
  The owner only      DRY_RUN=1 sends each new ask's emails to the owner (SIG_TO) and
                marks nothing; it skips asks older than DRY_FRESH_H hours, so
                a dry run does not resend old asks every time.

It runs hourly (rp-design-email.yml, cron_gate) and when the worker starts it
on a new ask (GH_DISPATCH_TOKEN), which also sends any reminder already due.

  Paid, unmailed  (Nov 9 2026; no new schedule) the same run reads the
                order records and finds paid orders still waiting STUCK_MIN
                minutes after payment: the buyer's email not sent (only when
                the buyer email is live, RP_BUYER_EMAIL_LIVE = "1"), or the owner's
                own order alert not sent. It starts rp-buyer-email.yml, the
                same dispatch the subs worker makes (GH_TOKEN, the run's own
                Actions token), at most once a run, for orders under ACT_MAX_H
                hours. Once per order: the run marks each order guarded on its
                record (rp-order/guarded) before the start and never acts on a
                guarded order again, so cron jitter or a run by hand gives one
                start or alert, not zero or two. This script never emails a
                buyer: the buyer job marks each order mailed before its send
                and skips a mailed order. When the start fails (no token,
                "HTTP 401", a network error), the owner gets one plain email about
                the orders just marked. A dry run (DRY_RUN=1, which the
                workflow sets unless RP_DESIGN_EMAIL_LIVE is 1 or a by-hand run
                says live) only counts: no mark, no start, no email to the owner.
                The DELIVERY line carries
                unmailed_late (orders waiting over LATE_MIN minutes), which
                scripts/delivery_check.py reads for its "paid, unmailed over 2
                hours" row. Counts only in the log.

    python3 scripts/rp_design_email.py              send what is due
    DRY_RUN=1 python3 scripts/rp_design_email.py    to the owner only, nothing marked
    python3 scripts/rp_design_email.py --selftest   fixtures, no network, no mail

Env: LIST_URL, LIST_TOKEN, SMTP_USER, SMTP_PASS. Optional: SMTP_HOST,
SMTP_PORT, FROM_ADDR, RP_FROM_NAME (default FROM_NAME below), SIG_TO, GH_TOKEN
and GITHUB_REPOSITORY (start the buyer job), RP_BUYER_EMAIL_LIVE.
Run by .github/workflows/rp-design-email.yml.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import base64
import datetime as dt
import html as H
import json
import os
import re
import smtplib
import ssl
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import email_links  # noqa: E402  (links go to the agsist.com front door; the worker host is never in an email)
from rp_buyer_email import URL_RE  # noqa: E402  (the buyer job's own test of a design link, so both agree on which orders it mails)
import urllib.error
import urllib.request
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import log_safe  # noqa: E402  sender_addr: the From line, SES-safe
import delivery_line  # noqa: E402  (the DELIVERY count line cron_health reads)

try:
    from zoneinfo import ZoneInfo
    CHICAGO = ZoneInfo("America/Chicago")
except Exception:                                          # noqa: BLE001
    CHICAGO = dt.timezone(dt.timedelta(hours=-6))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPLY_TO = "sig@agsist.com"
ADDRESS = "AGSIST, PO Box 243, Chetek, WI 54728"
FROM_NAME = "Sig at AGSIST"
SITE = "https://agsist.com/rain-print"
EMAIL_RE = re.compile(r"^[^\s@<>\"]+@[^\s@<>\"]+\.[^\s@<>\"]{2,}$")
CODE_RE = re.compile(r"^[A-Za-z0-9_-]{8,400}$")
REF_RE = re.compile(r"^RPS-[0-9A-HJKMNP-TV-Z]{5,8}$")
REMIND_AFTER_H = 20
GIVE_UP_H = 72
NOW_MAX_H = 24   # Nov 3: an ask never answered within a day is closed, not mailed late (the first live run met a week of dry-run asks)
DRY_FRESH_H = 2
STUCK_MIN = 60      # Nov 9: a paid order unmailed this long after payment: start the buyer job, or tell the owner
ACT_MAX_H = 24      # an order first found past a day is not started or alerted; delivery_check shows it
LATE_MIN = 120      # delivery_check's "paid, unmailed over 2 hours" row reads this count (unmailed_late)
BUYER_JOB = "rp-buyer-email.yml"
GH_API = "https://api.github.com"
GUARANTEE = "If it\u2019s not right, I\u2019ll redo it or refund it."
STORY = "Made by a crop adviser in Chetek, Wisconsin, from NOAA\u2019s own records."
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def env(name, default=None):
    v = os.environ.get(name)
    return v if v not in (None, "") else default


def one_line(v, cap):
    return " ".join(str(v or "").split())[:cap]


def design_of(code):
    """(place, year) from a design code (components/rain-print.js encodeCode: base64url of 2|place|station|year|...)."""
    try:
        b = code.replace("-", "+").replace("_", "/")
        f = base64.b64decode(b + "=" * (-len(b) % 4)).decode("utf-8").split("|")
        if f[0] not in ("1", "2") or len(f) < 6:
            return None
        y = int(f[3])
        place = one_line(f[1], 80)
        return (place, y) if place and 1850 <= y <= 2100 else None
    except Exception:                                      # noqa: BLE001
        return None


def link_of(code):
    return SITE + "?d=" + code


def short_date(iso):
    m = re.match(r"^\d{4}-(\d{2})-(\d{2})$", str(iso or ""))
    return "%s %d" % (MON[int(m.group(1)) - 1], int(m.group(2))) if m else ""


def xmas_line(prices, today, year):
    """The Christmas order-by dates for a past year, October 1 through each cutoff (the page's buyLine); else ''."""
    if not isinstance(prices, dict) or year >= int(today[:4]):
        return ""
    out = []
    for key, word in (("framed_christmas_cutoff", "framed"), ("print_christmas_cutoff", "as a print")):
        c = str(prices.get(key) or "")
        if re.match(r"^\d{4}-\d{2}-\d{2}$", c) and c[:4] + "-10-01" <= today <= c:
            out.append("%s by %s" % (word, short_date(c)))
    if not out:
        return ""
    return "Order it " + ", or ".join(out) + " for Christmas delivery."


# ───────────────────────────── sources ─────────────────────────────

class Sources:
    """Every outside call goes through here, so the selftest can hand in fixtures."""

    def __init__(self, list_url="", list_token=""):
        u = urllib.parse.urlsplit((list_url or "").strip())
        self.base = "%s://%s" % (u.scheme, u.netloc) if u.scheme and u.netloc else ""
        self.token = (list_token or "").strip()

    def worker(self, path, body=None, **q):
        if not (self.base and self.token):
            raise LookupError("no LIST_URL / LIST_TOKEN")
        url = "%s/%s%s" % (self.base, path, ("?" + urllib.parse.urlencode(q)) if q else "")
        data = json.dumps(body).encode() if body is not None else None
        h = {"User-Agent": "agsist-rp-design-email", "Authorization": "Bearer %s" % self.token}
        if data is not None:
            h["Content-Type"] = "application/json"
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h), timeout=30) as r:
            return json.loads(r.read().decode())

    def buyer(self, key):
        """Stripe's address for one paid order, read by the worker now; '' when it cannot be read."""
        try:
            d = self.worker("rp-order/buyer", key=key)
            return str(d.get("email") or "").strip().lower() if d.get("ok") else ""
        except Exception:                                  # noqa: BLE001
            return ""

    def prices(self):
        with open(os.path.join(ROOT, "data", "rain-print.json"), encoding="utf-8") as f:
            return json.load(f)

    def start_buyer_job(self, live):
        """Starts rp-buyer-email.yml exactly as the subs worker does (rpoDispatch): ref main, dry_run
        "false" only when the buyer email is live. -> "started", "no token", "HTTP <code>" or "failed"."""
        tok = env("GH_TOKEN", "")
        if not tok:
            return "no token"
        repo = env("GITHUB_REPOSITORY", "dnilgis/agsist")
        url = "%s/repos/%s/actions/workflows/%s/dispatches" % (GH_API, repo, BUYER_JOB)
        body = json.dumps({"ref": "main", "inputs": {"dry_run": "false" if live else "true"}}).encode()
        h = {"Authorization": "Bearer %s" % tok, "Accept": "application/vnd.github+json",
             "User-Agent": "agsist-rp-design-email", "Content-Type": "application/json"}
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=h, method="POST"), timeout=30) as r:
                return "started" if r.status == 204 else "HTTP %d" % r.status
        except urllib.error.HTTPError as e:
            return "HTTP %d" % e.code
        except Exception:                                  # noqa: BLE001
            return "failed"


# ───────────────────────────── matching ─────────────────────────────

def paid_match(row, orders, buyer_of):
    """True when a paid order is for this design (see the top of this file)."""
    want = {row.get("code") or ""} | ({row["ref"]} if row.get("ref") else set())
    d = design_of(row.get("code") or "")
    for o in orders:
        if o.get("status") != "paid" and not o.get("paid"):
            continue
        ref = re.sub(r"^GIFT-", "", str(o.get("ref") or ""))
        if ref and ref in want:
            return True
        if d and one_line(o.get("place"), 80).lower() == d[0].lower() and o.get("year") == d[1] and (o.get("ts") or 0) >= (row.get("ts") or 0) - 864e5:
            return True
        if (o.get("ts") or 0) >= (row.get("ts") or 0) - 864e5 and o.get("key") and buyer_of(o["key"]) == str(row.get("email") or "").lower():
            return True
    return False


# ───────────────────────────── the emails ─────────────────────────────

def stop_url(base, row):
    """The reminder's stop link: the agsist.com front door (Oct 22), which asks
    the worker's /rp-remind/stop from the reader's browser. base only has to be set."""
    return email_links.front("rp-remind/stop", [("k", row["key"]), ("t", str(row.get("stop_t") or ""))])


def words(row, stage, prices, today):
    """(subject, [paragraphs], link) for 'now' or 'reminder'."""
    place, year = design_of(row["code"]) or ("your town", 0)
    what = "%s, %d" % (place, year) if year else place
    link = link_of(row["code"])
    if stage == "now":
        return ("Your Rain Print design: %s" % what, [
            "Here\u2019s the Rain Print you made: %s. It opens with your print just as you left it. Change anything you like there, or order it when you\u2019re ready." % what,
            "I\u2019ll send one reminder tomorrow unless you order it. Then nothing more about it.",
        ], link)
    xm = xmas_line(prices, today, year) if year else ""
    if year and year >= int(today[:4]):
        xm = "A %d print ships in January %d, once the full year is in." % (year, year + 1)
    return ("Your Rain Print of %s is still here" % what, [p for p in [
        "You made a Rain Print of %s yesterday. Here it is again, as you left it." % what,
        xm,
        GUARANTEE,
        "This is the only reminder. I won\u2019t write about it again.",
    ] if p], link)


def build(row, stage, to, base, prices, today):
    subject, paras, link = words(row, stage, prices, today)
    stop = stop_url(base, row) if base and row.get("stop_t") else ""
    foot = [STORY, ADDRESS + ". You got this because you asked for it on agsist.com/rain-print."]
    m = EmailMessage()
    m["Subject"] = subject
    m["To"] = to
    m["From"] = formataddr((FROM_NAME, ""))
    m["Reply-To"] = REPLY_TO
    m["Message-ID"] = make_msgid(domain="agsist.com")
    if stop and stage == "now":
        m["List-Unsubscribe"] = "<%s>" % stop
    text = "\n\n".join(paras[:1] + [link] + paras[1:]
                       + (["Don\u2019t want the reminder? " + stop] if stop and stage == "now" else [])
                       + ["Sig"] + foot) + "\n"
    m.set_content(text)
    p = "".join('<p style="margin:0 0 14px">%s</p>' % H.escape(x) for x in paras[1:])
    btn = ('<p style="margin:18px 0"><a href="%s" style="display:inline-block;padding:12px 20px;background:#D9A441;color:#1a1a1a;'
           'font-weight:700;text-decoration:none;border-radius:6px">See your print</a></p>' % H.escape(link))
    stop_h = ('<p style="margin:0 0 14px;color:#555">Don\u2019t want the reminder? <a href="%s" style="color:#555">Stop it</a>.</p>' % H.escape(stop)
              if stop and stage == "now" else "")
    m.add_alternative(
        '<!doctype html><html><body style="margin:0;padding:16px;font-family:Georgia,serif;font-size:16px;line-height:1.5;color:#1a1a1a;max-width:560px">'
        '<p style="margin:0 0 14px">%s</p>%s%s%s<p style="margin:0 0 18px">Sig</p>'
        '<p style="margin:0;font-size:13px;color:#666">%s<br>%s</p></body></html>'
        % (H.escape(paras[0]), btn, p, stop_h, H.escape(foot[0]), H.escape(foot[1])), subtype="html")
    return email_links.check_message(m)


# ───────────────────────────── paid, unmailed ─────────────────────────────

def _ms(iso):
    try:
        return int(dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:                                      # noqa: BLE001
        return None


def stuck_orders(orders, now_ms, buyer_live):
    """[(order, minutes since payment)] for paid orders still waiting STUCK_MIN minutes after payment:
    The owner's alert not sent, or (buyer email live) a design order whose buyer email is not sent. A mailed
    order only counts when the owner's alert is missing; the buyer job never mails it twice."""
    out = []
    for o in orders or []:
        if o.get("status") != "paid":
            continue
        paid = o.get("paid") or {}
        at = _ms(paid.get("at"))
        if not paid.get("session") or at is None:
            continue
        mins = (now_ms - at) / 60e3
        if mins < STUCK_MIN:
            continue
        unmailed = buyer_live and not o.get("mailed") and not o.get("no_press") and bool(URL_RE.match(str(o.get("design_url") or "")))
        if unmailed or not o.get("alerted"):
            out.append((o, mins))
    return out


def alert_sig(stuck, job, sig_to, now_ms):
    """the owner's email: the orders waiting and why the buyer job did not start. Never an address."""
    lines = ["A paid Rain Print order has had no email an hour after payment, and the buyer email job",
             "could not be started from the hourly run (%s)." % job, ""]
    for o, mins in stuck:
        what = {"digital": "Digital file", "print12x18": "Print", "framed12x18": "Framed"}.get(o.get("product"), "Rain Print")
        place = one_line(o.get("place"), 60)
        d = o.get("dispatch") or {}
        lines.append("- %s%s%s, paid %d min ago; buyer email %s; your alert %s; the worker's start: %s" % (
            what, (", " + place) if place else "", (" " + str(o["year"])) if o.get("year") else "", int(mins),
            "sent" if o.get("mailed") else "not sent", "sent" if o.get("alerted") else "not sent",
            one_line(d.get("job"), 40) or "not on record"))
    lines += ["",
              "Start it by hand: Actions, Rain Print buyer email, Run workflow. It never mails an order twice.",
              "\"HTTP 401\" on the worker's start means GH_DISPATCH_TOKEN on the subs worker has expired: renew it.",
              "", "Sent once per order, from the first hourly run that finds it " + str(STUCK_MIN) + " minutes past payment."]
    m = EmailMessage()
    m["Subject"] = "Rain Print: %d paid order%s with no email after an hour" % (len(stuck), "" if len(stuck) == 1 else "s")
    m["To"] = sig_to
    m["From"] = formataddr((FROM_NAME, ""))
    m["Message-ID"] = make_msgid(domain="agsist.com")
    m.set_content("\n".join(lines) + "\n")
    return m


def check_paid(src, orders, now_ms, send, sig_to, buyer_live, tally=None, dry=False):
    """The paid-but-unmailed guard (see the top of this file). -> (counts, failed).
    Once per order: each order acted on is marked guarded on its record (rp-order/guarded) before
    the start, and a guarded order is never acted on again, whichever run sees it first. A dry run
    (DRY_RUN=1) only counts: no mark, no start, no email to the owner."""
    c = {"paid, unmailed": 0, "would act": 0, "buyer job started": 0, "start failed": 0, "Sig told": 0, "mark failed": 0}
    if orders is None:
        return c, False
    stuck = stuck_orders(orders, now_ms, buyer_live)
    c["paid, unmailed"] = len(stuck)
    if tally:
        tally.extra["unmailed_late"] = sum(1 for _o, mins in stuck if mins >= LATE_MIN)
    act = [(o, m) for o, m in stuck if m < ACT_MAX_H * 60 and not o.get("guarded") and isinstance(o.get("key"), str)]
    if not act:
        return c, False
    if dry:
        c["would act"] = len(act)
        return c, False
    marked = []
    for o, m in act:
        try:
            r = src.worker("rp-order/guarded", body={"key": o["key"]})
        except Exception:                                  # noqa: BLE001
            r = None
        if r and r.get("ok") and not r.get("already"):
            marked.append((o, m))
        elif not (r and r.get("ok")):
            c["mark failed"] += 1                          # not marked: the next run tries again
    if not marked:
        return c, False
    job = src.start_buyer_job(buyer_live)
    if job == "started":
        c["buyer job started"] = 1
        return c, False
    c["start failed"] = 1
    try:
        send(alert_sig(marked, job, sig_to, now_ms))
        c["Sig told"] = len(marked)
        return c, False
    except Exception:                                      # noqa: BLE001
        return c, True


# ───────────────────────────── run ─────────────────────────────

def read_orders(src):
    try:
        od = src.worker("rp-order/list", days=10)
        return [o for o in od.get("orders") or [] if isinstance(o, dict)]
    except Exception:                                      # noqa: BLE001
        return None


def paid_log(pc):
    return "Paid orders: " + "; ".join("%s: %d" % (k, v) for k, v in pc.items()) + "."


def run(src, dry, send, sig_to, now_ms=None, today=None, tally=None, buyer_live=None):
    """-> (exit code, log lines). Counts only in the log."""
    now_ms = now_ms if now_ms is not None else int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)
    today = today or dt.datetime.now(CHICAGO).date().isoformat()
    buyer_live = (env("RP_BUYER_EMAIL_LIVE") == "1") if buyer_live is None else buyer_live
    try:
        d = src.worker("rp-remind/list")
    except Exception as e:                                 # noqa: BLE001
        pc, pfail = check_paid(src, read_orders(src), now_ms, send, sig_to, buyer_live, tally, dry)
        return (1 if pfail else 0), ["Design asks could not be read (%s); nothing sent." % type(e).__name__, paid_log(pc)]
    rows = [r for r in d.get("rows") or [] if isinstance(r, dict) and isinstance(r.get("key"), str)
            and CODE_RE.match(str(r.get("code") or "")) and EMAIL_RE.match(str(r.get("email") or ""))
            and (not r.get("ref") or REF_RE.match(str(r["ref"])))]
    try:
        prices = src.prices()
    except Exception:                                      # noqa: BLE001
        prices = {}
    orders = read_orders(src)
    if tally:
        # what the worker should have started jobs for (cron_health: a worker-started job never started)
        tally.extra["asks"] = len([r for r in rows if not r.get("done") and not r.get("reminded")])
        tally.extra["orders"] = sum(1 for o in orders or [] if o.get("status") == "paid")
    cache = {}

    def buyer_of(key):
        if key not in cache:
            cache[key] = src.buyer(key)
        return cache[key]

    handled = set()                                        # asks this run finished (live only): no longer waiting
    c = {"link sent": 0, "reminder sent": 0, "to Sig": 0, "paid, no reminder": 0, "too late, closed": 0,
         "waiting": 0, "reminder waits on orders": 0, "marked, send failed": 0}
    for row in rows:
        if row.get("done"):
            continue
        age_h = (now_ms - (row.get("ts") or now_ms)) / 3600e3
        stage = None
        if not row.get("sent"):
            if age_h > NOW_MAX_H:
                if not dry:
                    src.worker("rp-remind/mark", body={"key": row["key"], "stage": "done", "why": "late"})
                    handled.add(row["key"])
                c["too late, closed"] += 1
                continue
            stage = "now"
        elif not row.get("reminded"):
            if age_h < REMIND_AFTER_H:
                c["waiting"] += 1
                continue
            if orders is None:
                c["reminder waits on orders"] += 1
                continue
            if paid_match(row, orders, buyer_of):
                if not dry:
                    src.worker("rp-remind/mark", body={"key": row["key"], "stage": "done", "why": "paid"})
                    handled.add(row["key"])
                c["paid, no reminder"] += 1
                continue
            if age_h > GIVE_UP_H:
                if not dry:
                    src.worker("rp-remind/mark", body={"key": row["key"], "stage": "done", "why": "late"})
                    handled.add(row["key"])
                c["too late, closed"] += 1
                continue
            stage = "reminder"
        else:
            continue
        if tally:
            tally.waiting += 1
        if dry and age_h > DRY_FRESH_H:
            continue
        to = sig_to if dry else row["email"]
        m = build(row, stage, to, src.base, prices, today)
        if not dry:
            # marked first: never twice, even if the send or this job dies after it
            mk = src.worker("rp-remind/mark", body={"key": row["key"], "stage": "sent" if stage == "now" else "reminded"})
            if not mk.get("ok") or mk.get("already"):
                continue
        try:
            send(m)
        except Exception:                                  # noqa: BLE001
            c["marked, send failed"] += 1
            continue
        c["to Sig" if dry else ("link sent" if stage == "now" else "reminder sent")] += 1
        if tally and not dry:
            tally.sent += 1
            if stage == "reminder":
                handled.add(row["key"])
    if tally and "asks" in tally.extra:
        tally.extra["asks"] = max(0, tally.extra["asks"] - len(handled))
    pc, pfail = check_paid(src, orders, now_ms, send, sig_to, buyer_live, tally, dry)
    log = ["Design asks: %d." % len(rows), paid_log(pc), "; ".join("%s: %d" % (k, v) for k, v in c.items()) + "."]
    return (1 if c["marked, send failed"] or pfail else 0), log


def smtp_send(fa):
    def send(m):
        if not (env("SMTP_USER") and env("SMTP_PASS")):
            raise RuntimeError("no SMTP_USER / SMTP_PASS")
        del m["From"]
        m["From"] = formataddr((one_line(env("RP_FROM_NAME", FROM_NAME), 60) or FROM_NAME, fa))
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
    return send


def main():
    if "--selftest" in sys.argv:
        return selftest()
    dry = env("DRY_RUN") == "1"
    tally = delivery_line.start("rp-design", dry=dry)
    src = Sources(env("LIST_URL", ""), env("LIST_TOKEN", ""))
    code, log = run(src, dry, smtp_send(log_safe.sender_addr()), env("SIG_TO", REPLY_TO), tally=tally)
    for line in log:
        print(line)
    return code


# ───────────────────────────── selftest ─────────────────────────────

def _code(place, year):
    raw = "|".join(["2", place, "471667 2", str(year), "sp0aa", "Gustum Farm"]).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


class Fake(Sources):
    def __init__(self, rows, orders, buyers=None, orders_fail=False):
        super().__init__("https://subs.example/x", "tok")
        self.rows, self.orders, self.buyers, self.orders_fail = rows, orders, buyers or {}, orders_fail
        self.marks, self.buyer_calls = [], 0
        self.starts, self.job, self.guard_fail = [], "started", False

    def worker(self, path, body=None, **q):
        if path == "rp-remind/list":
            return {"ok": True, "rows": [dict(r) for r in self.rows]}
        if path == "rp-order/list":
            if self.orders_fail:
                raise OSError("down")
            return {"ok": True, "orders": self.orders}
        if path == "rp-remind/mark":
            self.marks.append((body["key"], body["stage"], body.get("why")))
            for r in self.rows:
                if r["key"] == body["key"]:
                    st = body["stage"]
                    if r.get(st) or (st == "reminded" and r.get("done")):
                        return {"ok": True, "already": True}
                    r[st] = {"at": "now"}
                    return {"ok": True, "already": False}
            return {"ok": False}
        if path == "rp-order/guarded":
            self.marks.append((body["key"], "guarded", None))
            if self.guard_fail:
                raise OSError("down")
            for o in self.orders or []:
                if o.get("key") == body["key"]:
                    if o.get("guarded"):
                        return {"ok": True, "already": True}
                    o["guarded"] = {"at": "now"}
                    return {"ok": True, "already": False}
            return {"ok": False}
        raise AssertionError(path)

    def buyer(self, key):
        self.buyer_calls += 1
        return self.buyers.get(key, "")

    def start_buyer_job(self, live):
        self.starts.append(live)
        return self.job

    def prices(self):
        return {"framed_christmas_cutoff": "2026-12-09", "print_christmas_cutoff": "2026-12-10"}


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        if not ok:
            fails.append(name + (": " + detail if detail else ""))

    NOW = 1761000000000
    H_ = 3600e3
    code = _code("Chetek, WI", 2025)
    ck("design_of", design_of(code) == ("Chetek, WI", 2025), str(design_of(code)))
    ck("design_of junk", design_of("AAAAAAAAAAAA") is None)

    def row(key, **kw):
        r = {"key": "rpr:%016x:%016x" % (key, key), "email": "reader%d@farm.com" % key, "code": code, "ref": "", "ts": NOW, "stop_t": "abcdef0123456789",
             "sent": None, "reminded": None, "done": None}
        r.update(kw)
        return r

    sent = []

    def send(m):
        sent.append(m)

    # 1. a new ask: the link now, once; marked before the send
    f = Fake([row(1)], [])
    code_, log = run(f, False, send, "sig@agsist.com", now_ms=NOW + 60e3, today="2026-10-20")
    ck("now: one email", len(sent) == 1 and sent[0]["To"] == "reader1@farm.com", str([m["To"] for m in sent]))
    ck("now: marked sent first", f.marks == [(row(1)["key"], "sent", None)], str(f.marks))
    body = sent[0].get_body(("plain",)).get_content()
    ck("now: the link carries the design", (SITE + "?d=" + code) in body, body)
    ck("now: subject", sent[0]["Subject"] == "Your Rain Print design: Chetek, WI, 2025", sent[0]["Subject"])
    ck("now: says one reminder, then nothing", "one reminder tomorrow unless you order it. Then nothing more about it." in body)
    ck("now: stop link, the agsist.com front door", email_links.FRONT + "?a=rp-remind/stop&k=rpr:" in body
       and email_links.unsub_web(sent[0]).startswith(email_links.FRONT + "?a=rp-remind/stop&k=rpr:") and sent[0]["List-Unsubscribe-Post"] is None)
    ck("now: the worker host is nowhere in the email", "subs.example" not in sent[0].as_string() and "workers.dev" not in sent[0].as_string())
    ck("now: the story line, no em dash", STORY in body and "\u2014" not in body)
    ck("log: no address", not any("@" in x for x in log), str(log))
    # a second run: nothing (sent, not yet a day)
    sent.clear()
    run(f, False, send, "sig@agsist.com", now_ms=NOW + 2 * H_, today="2026-10-20")
    ck("now: never twice", not sent)

    # 2. the next day, nothing paid: one reminder, marked first, then never again
    sent.clear()
    f = Fake([row(2, sent={"at": "x"})], [{"key": "rpo:1:aa", "status": "paid", "ref": "OTHER", "place": "Ames, IA", "year": 2012, "ts": NOW + H_}])
    run(f, False, send, "sig@agsist.com", now_ms=NOW + 21 * H_, today="2026-10-21")
    ck("reminder: one", len(sent) == 1 and f.marks == [(row(2)["key"], "reminded", None)], str(f.marks))
    rb = sent[0].get_body(("plain",)).get_content() if sent else ""
    ck("reminder: Christmas dates while they hold", "Order it framed by Dec 9, or as a print by Dec 10 for Christmas delivery." in rb, rb)
    ck("reminder: guarantee", GUARANTEE in rb)
    ck("reminder: only one", "This is the only reminder." in rb)
    sent.clear()
    run(f, False, send, "sig@agsist.com", now_ms=NOW + 30 * H_, today="2026-10-21")
    ck("reminder: never a second", not sent)

    # 3. a paid order matching the design: no reminder, marked done, never after
    for name, o, buyers in [
        ("same code", {"key": "rpo:2:aa", "status": "paid", "ref": code, "ts": NOW + H_}, {}),
        ("a gift of it", {"key": "rpo:3:aa", "status": "paid", "ref": "GIFT-" + code, "ts": NOW + H_}, {}),
        ("same town and year", {"key": "rpo:4:aa", "status": "paid", "ref": "ZZZ", "place": "Chetek, WI", "year": 2025, "ts": NOW + 5 * H_}, {}),
        ("same buyer", {"key": "rpo:5:aa", "status": "paid", "ref": "ZZZ", "place": "Ames, IA", "year": 2012, "ts": NOW + 5 * H_}, {"rpo:5:aa": "reader3@farm.com"}),
    ]:
        sent.clear()
        f = Fake([row(3, sent={"at": "x"})], [o], buyers)
        run(f, False, send, "sig@agsist.com", now_ms=NOW + 22 * H_, today="2026-10-21")
        ck("paid (%s): no reminder" % name, not sent and f.marks == [(row(3)["key"], "done", "paid")], str(f.marks))
    # an RPS ref
    sent.clear()
    f = Fake([row(4, sent={"at": "x"}, ref="RPS-K7Q2M")], [{"key": "rpo:6:aa", "status": "paid", "ref": "GIFT-RPS-K7Q2M", "ts": NOW + H_}])
    run(f, False, send, "sig@agsist.com", now_ms=NOW + 22 * H_, today="2026-10-21")
    ck("paid (RPS ref): no reminder", not sent)
    # an unpaid press of the same design does not count
    sent.clear()
    f = Fake([row(5, sent={"at": "x"})], [{"key": "rpo:7:aa", "status": "pay pressed", "ref": code, "ts": NOW + H_}])
    run(f, False, send, "sig@agsist.com", now_ms=NOW + 22 * H_, today="2026-10-21")
    ck("unpaid press: the reminder still goes", len(sent) == 1)
    # done (stopped or paid) rows: nothing, ever
    sent.clear()
    f = Fake([row(6, done={"why": "stopped"}), row(7, sent={"at": "x"}, done={"why": "paid"})], [])
    run(f, False, send, "sig@agsist.com", now_ms=NOW + 22 * H_, today="2026-10-21")
    ck("done: nothing", not sent and not f.marks)
    # order records down: the reminder waits
    sent.clear()
    f = Fake([row(8, sent={"at": "x"})], [], orders_fail=True)
    code_, log = run(f, False, send, "sig@agsist.com", now_ms=NOW + 22 * H_, today="2026-10-21")
    ck("orders down: no reminder", not sent and "reminder waits on orders: 1" in log[-1], str(log))
    # too late: closed, nothing sent
    sent.clear()
    f = Fake([row(9, sent={"at": "x"})], [])
    run(f, False, send, "sig@agsist.com", now_ms=NOW + 80 * H_, today="2026-10-24")
    ck("too late: closed quietly", not sent and f.marks == [(row(9)["key"], "done", "late")])
    # never answered within a day (asks from the dry-run weeks): closed, no link sent days late
    sent.clear()
    f = Fake([row(14, ts=NOW - 30 * H_), row(15, ts=NOW - 2 * H_)], [])
    run(f, False, send, "sig@agsist.com", now_ms=NOW, today="2026-10-21")
    ck("unanswered past a day: closed, not mailed", len(sent) == 1 and f.marks[0] == (row(14)["key"], "done", "late")
       and (row(15)["key"], "sent") in [(k, st) for k, st, *_ in f.marks], str(f.marks))
    # after the cutoff: no Christmas line; this year's print: January
    s, paras, _ = words(row(10), "reminder", Fake([], []).prices(), "2026-12-11")
    ck("after the cutoff: no Christmas line", not any("Christmas" in p for p in paras), str(paras))
    s, paras, _ = words(row(10), "reminder", Fake([], []).prices(), "2026-12-10")
    ck("between the cutoffs: the print only", "Order it as a print by Dec 10 for Christmas delivery." in paras, str(paras))
    s, paras, _ = words(row(11, code=_code("Chetek, WI", 2026)), "reminder", Fake([], []).prices(), "2026-10-21")
    ck("this year: January", "A 2026 print ships in January 2027, once the full year is in." in paras and not any("Christmas" in p for p in paras), str(paras))
    # dry run: to the owner, nothing marked, only fresh asks
    sent.clear()
    f = Fake([row(12), row(13, ts=NOW - 10 * H_)], [])
    run(f, True, send, "sig@agsist.com", now_ms=NOW + 60e3, today="2026-10-20")
    ck("dry run: to Sig only, nothing marked", [m["To"] for m in sent] == ["sig@agsist.com"] and not f.marks, str([m["To"] for m in sent]))
    # a send that fails after the mark is counted, not retried
    f = Fake([row(14)], [])
    code_, log = run(f, False, lambda m: (_ for _ in ()).throw(OSError("smtp")), "sig@agsist.com", now_ms=NOW + 60e3, today="2026-10-20")
    ck("send failed: counted, exit 1", code_ == 1 and "marked, send failed: 1" in log[-1], str(log))
    # the asks count is the asks still waiting (cron_health rule c reads it): handled ones are not
    def asks_of(rows, dry=False, now=NOW + 22 * H_):
        t = delivery_line.Tally("rp-design", dry=dry)
        run(Fake(rows, []), dry, send, "sig@agsist.com", now_ms=now, today="2026-10-21", tally=t)
        return t.extra["asks"]
    ck("asks: the one ask already handled counts 0", asks_of([row(20, sent={"at": "x"}, reminded={"at": "x"})]) == 0
       and asks_of([row(21, sent={"at": "x"}, done={"why": "paid"})]) == 0)
    ck("asks: an ask closed too late this run counts 0", asks_of([row(22, sent={"at": "x"})], now=NOW + 80 * H_) == 0)
    ck("asks: the reminder just sent counts 0", asks_of([row(23, sent={"at": "x"})]) == 0)
    ck("asks: an ask still waiting counts 1", asks_of([row(24, sent={"at": "x"})], now=NOW + 2 * H_) == 1
       and asks_of([row(25)], now=NOW + 60e3) == 1)
    ck("asks: a dry run closes nothing, so still 1", asks_of([row(26, sent={"at": "x"})], dry=True, now=NOW + 80 * H_) == 1)
    # Nov 9: a paid order with no email. Paid at T, unmailed, the worker's start refused ("HTTP 401")
    T = NOW
    iso = lambda ms: dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    def porder(n, **kw):
        o = {"key": "rpo:%d:aa" % n, "status": "paid", "ref": "RPS-K7Q2M", "product": "framed12x18", "place": "Lennox, SD", "year": 1994,
             "design_url": "https://agsist.com/rain-print?d=x", "paid": {"amount": 89, "at": iso(T), "session": "cs_live_%d" % n, "via": "webhook"},
             "mailed": None, "alerted": None, "no_press": False, "dispatch": {"at": iso(T), "job": "HTTP 401"}}
        o.update(kw)
        return o
    def at(mins, orders, job="started", live=True, rows=None):
        sent.clear()
        f = Fake(rows or [], orders)
        f.job = job
        t = delivery_line.Tally("rp-design", dry=False)
        code_, log = run(f, False, send, "sig@agsist.com", now_ms=T + mins * 60e3, today="2026-11-09", tally=t, buyer_live=live)
        return f, code_, log, t
    f, code_, log, t = at(61, [porder(1)])
    ck("paid T, 401: at T+61 min the buyer job starts", f.starts == [True] and not sent and code_ == 0, str((f.starts, log)))
    ck("paid T+61: the log counts it, no address", "paid, unmailed: 1;" in log[1] and "buyer job started: 1" in log[1] and not any("@" in x for x in log), str(log))
    f, code_, log, t = at(59, [porder(1)])
    ck("paid T, 401: at T+59 min nothing yet", f.starts == [] and not sent, str((f.starts, log)))
    f, code_, log, t = at(61, [porder(1), porder(2)])
    ck("two waiting orders: one start", f.starts == [True], str(f.starts))
    # a mailed order is never restarted, never mailed, never alerted (its alert went too)
    f, code_, log, t = at(61, [porder(3, mailed={"at": "x"}, alerted={"at": "x"})])
    ck("mailed: no start, nothing sent", f.starts == [] and not sent and "paid, unmailed: 0" in log[1], str(log))
    f, code_, log, t = at(600, [porder(3, mailed={"at": "x"}, alerted={"at": "x"})], job="HTTP 401")
    ck("mailed, hours later, token dead: still nothing", f.starts == [] and not sent and t.extra.get("unmailed_late") == 0)
    # the script itself never emails a buyer and never marks an order: only the buyer job does
    ck("the guard never marks an order mailed", not [m for m in f.marks if m[0].startswith("rpo:") and m[1] != "guarded"])
    # an expired token: the start fails, the owner is told once, in the order's first hour
    f, code_, log, t = at(61, [porder(4)], job="HTTP 401")
    ck("expired token: Sig is told", len(sent) == 1 and sent[0]["To"] == "sig@agsist.com" and "HTTP 401" in sent[0].get_content()
       and "GH_DISPATCH_TOKEN" in sent[0].get_content() and "Lennox, SD 1994" in sent[0].get_content(), str([m["Subject"] for m in sent]))
    ck("expired token: subject", sent and sent[0]["Subject"] == "Rain Print: 1 paid order with no email after an hour", str([m["Subject"] for m in sent]))
    ck("expired token: no address, no em dash", sent and "@" not in sent[0].get_content() and "\u2014" not in sent[0].get_content())
    ck("expired token: counted", "start failed: 1; Sig told: 1" in log[1], str(log))
    o4 = [porder(4)]
    at(61, o4, job="HTTP 401")
    f, code_, log, t = at(121, o4, job="HTTP 401")
    ck("expired token: the next hour does not email Sig again", not sent and f.starts == [] and t.extra["unmailed_late"] == 1, str((log, t.extra)))
    # checker, Nov 9: alert once by a mark on the order, not by which run lands in a window
    for job in ("started", "HTTP 401"):
        o20, acts = [porder(20)], []
        for mins in (61, 130):
            f, code_, log, t = at(mins, o20, job=job)
            acts += f.starts + [m["Subject"] for m in sent]
        ck("once (%s): runs at 61 and 130 min give one start%s" % (job, "" if job == "started" else " and one alert"),
           len([a for a in acts if a is True]) == 1 and len([a for a in acts if isinstance(a, str)]) == (0 if job == "started" else 1)
           and o20[0].get("guarded"), str(acts))
        o21 = [porder(21)]
        f, code_, log, t = at(200, o21, job=job)
        ck("once (%s): a first run at 200 min still acts" % job, f.starts == [True] and len(sent) == (0 if job == "started" else 1), str(log))
        f, code_, log, t = at(201, o21, job=job)
        ck("once (%s): and a manual run a minute later does not" % job, f.starts == [] and not sent, str(log))
    o22 = [porder(22)]
    f = Fake([], o22); f.guard_fail = True; f.job = "HTTP 401"; sent.clear()
    run(f, False, send, "sig@agsist.com", now_ms=T + 61 * 60e3, today="2026-11-09", buyer_live=True)
    ck("mark fails: no start, no alert, the next run tries again", f.starts == [] and not sent and not o22[0].get("guarded"))
    f, code_, log, t = at(62, o22, job="HTTP 401")
    ck("mark fails: the next run acts once", f.starts == [True] and len(sent) == 1)
    f, code_, log, t = at(130, [porder(23, guarded={"at": "x"})], job="HTTP 401")
    ck("guarded on the record (an earlier run): nothing, still counted late", f.starts == [] and not sent and t.extra["unmailed_late"] == 1)
    # checker, Nov 9: a dry run never starts the buyer job or emails the owner, even with GH_TOKEN set
    import unittest.mock as um0
    net = []
    class DryFake(Fake):
        start_buyer_job = Sources.start_buyer_job          # the real start, so a call would reach urlopen
    def no_net(*a, **k):
        net.append(a)
        raise AssertionError("network")
    with um0.patch.dict(os.environ, {"GH_TOKEN": "t0k", "DRY_RUN": "1"}), um0.patch("urllib.request.urlopen", no_net):
        sent.clear()
        o24 = [porder(24), porder(25)]
        f = DryFake([], o24)
        t = delivery_line.Tally("rp-design", dry=True)
        code_, log = run(f, env("DRY_RUN") == "1", send, "sig@agsist.com", now_ms=T + 130 * 60e3, today="2026-11-09", tally=t, buyer_live=True)
    ck("dry: zero network calls, no mark, no email, counted", not net and not sent and not f.marks and code_ == 0
       and "would act: 2; buyer job started: 0" in log[1] and t.extra["unmailed_late"] == 2 and not o24[0].get("guarded"), str((net, log, f.marks)))
    # checker, Nov 9: the guard reads a design link exactly as the buyer job does (rp_buyer_email.URL_RE)
    import rp_buyer_email
    for u in ("https://agsist.com/rain-print?d=x", "https://www.agsist.com/rain-print?d=x", "https://agsist.com/other?d=x"):
        buyer_takes = bool(rp_buyer_email.URL_RE.match(u))
        mine = bool(stuck_orders([porder(26, design_url=u, alerted={"at": "x"})], T + 61 * 60e3, True))
        ck("design link %s: the guard and the buyer job agree (%s)" % (u.split("/")[2], buyer_takes), mine == buyer_takes, u)
    f, code_, log, t = at(61, [porder(5)], job="no token")
    ck("no token: Sig is told", len(sent) == 1 and "no token" in sent[0].get_content())
    f, code_, log, t = at(25 * 60, [porder(6)], job="HTTP 401")
    ck("past a day: no more starts, delivery row still sees it", f.starts == [] and not sent and t.extra["unmailed_late"] == 1)
    # The owner's alert email failing to send makes the run red
    sent.clear()
    f = Fake([], [porder(7)]); f.job = "HTTP 401"
    code_, log = run(f, False, lambda m: (_ for _ in ()).throw(OSError("smtp")), "sig@agsist.com", now_ms=T + 61 * 60e3, today="2026-11-09", buyer_live=True)
    ck("alert send failed: exit 1", code_ == 1, str(log))
    # buyer email not live: an alerted order is not waiting on anything; an unalerted one is (the owner's own alert)
    f, code_, log, t = at(61, [porder(8, alerted={"at": "x"})], live=False)
    ck("dry buyer email, alerted: no start", f.starts == [])
    f, code_, log, t = at(61, [porder(9)], live=False)
    ck("dry buyer email, Sig not alerted: started as a dry run", f.starts == [False])
    # a paid record with no design (bare payment link): only the owner's alert matters
    f, code_, log, t = at(61, [porder(10, no_press=True, design_url="", alerted={"at": "x"})])
    ck("no design, alerted: not waiting", f.starts == [])
    # an order not yet paid, or with no payment time, is never counted
    f, code_, log, t = at(600, [porder(11, status="pay pressed", paid=None), porder(12, paid={"amount": 45, "session": "cs_live_12"})])
    ck("unpaid or no payment time: nothing", f.starts == [] and t.extra["unmailed_late"] == 0)
    # orders down: nothing started, nothing claimed
    sent.clear()
    f = Fake([], [porder(13)], orders_fail=True)
    t = delivery_line.Tally("rp-design", dry=False)
    run(f, False, send, "sig@agsist.com", now_ms=T + 61 * 60e3, today="2026-11-09", tally=t, buyer_live=True)
    ck("orders down: no start, no count", f.starts == [] and "unmailed_late" not in t.extra)
    # the asks list down: the order guard still runs
    class NoAsks(Fake):
        def worker(self, path, body=None, **q):
            if path == "rp-remind/list":
                raise OSError("down")
            return Fake.worker(self, path, body, **q)
    f = NoAsks([], [porder(14)])
    run(f, False, send, "sig@agsist.com", now_ms=T + 61 * 60e3, today="2026-11-09", buyer_live=True)
    ck("asks down: the order guard still starts the job", f.starts == [True])
    # the start is the worker's own call: same workflow, ref main, dry_run from the live switch
    import unittest.mock as um
    seen = []
    class R:
        status = 204
        def __enter__(self): return self
        def __exit__(self, *a): return False
    def fake_open(req, timeout=0):
        seen.append((req.full_url, req.get_method(), json.loads(req.data.decode()), req.headers.get("Authorization")))
        return R()
    with um.patch.dict(os.environ, {"GH_TOKEN": "t0k", "GITHUB_REPOSITORY": "dnilgis/agsist"}), um.patch("urllib.request.urlopen", fake_open):
        j1 = Sources().start_buyer_job(True)
        j2 = Sources().start_buyer_job(False)
    ck("start: the worker's dispatch", j1 == "started" and seen[0][0] == GH_API + "/repos/dnilgis/agsist/actions/workflows/rp-buyer-email.yml/dispatches"
       and seen[0][1] == "POST" and seen[0][2] == {"ref": "main", "inputs": {"dry_run": "false"}} and seen[1][2]["inputs"]["dry_run"] == "true", str(seen))
    def e401(req, timeout=0):
        raise urllib.error.HTTPError(req.full_url, 401, "Bad credentials", {}, None)
    with um.patch.dict(os.environ, {"GH_TOKEN": "expired"}), um.patch("urllib.request.urlopen", e401):
        ck("start: an expired token reads HTTP 401", Sources().start_buyer_job(True) == "HTTP 401")
    with um.patch.dict(os.environ, {"GH_TOKEN": ""}):
        ck("start: no token, no call", Sources().start_buyer_job(True) == "no token")
    # words: no em dash anywhere
    for st in ("now", "reminder"):
        s, paras, _ = words(row(15), st, Fake([], []).prices(), "2026-10-21")
        ck("no em dash (%s)" % st, "\u2014" not in s + "".join(paras))
    if fails:
        for x in fails:
            print("FAIL", x)
        return 1
    print("rp_design_email: all checks pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
