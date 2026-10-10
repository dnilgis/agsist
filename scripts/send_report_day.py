#!/usr/bin/env python3
"""
send_report_day.py -- "USDA vs the trade", the afternoon a big report lands.

WHAT IT SENDS. A short email to AGSIST Daily readers who did not opt out of
report-day mail (`reports !== false` on the v5.4 list; an older worker's
plain list means everyone, the v5.4 default). For each report released today:
what USDA printed against the trade average and range, as the site's own
data/whats-priced-in.json already records them (built by
scripts/build_whats_priced_in.py from the typed-in pre-report survey and
fetch_wasde.py's NASS and WASDE PDF read), the one-line reaction when the file
carries one, USDA's ending stocks and farm price against last month for each
crop when the WASDE PDF was read (data/wasde.json `wasde_pdf`), and the
futures move since the release from data/prices.json, labelled with the times
of both prices.

WHEN IT SENDS, AND WHEN IT DOES NOT.
  * Only rows dated TODAY (Central time) with a USDA figure filled in. No such
    row: nothing is sent. The calendar alone never sends anything.
  * Never before noon ET on the release day, whatever the file says.
  * Never twice: one /flag day-marker per report (report:<date>:<slug>,
    14-day TTL) through the subs worker, checked before and set after. The
    flag service unreachable means no send (fails closed, as send_daily.py).
    A report typed in later the same day (Grain Stocks by hand after the
    WASDE graded itself) gets its own email; one already sent does not.
  * A report type with no data in the repo is named and skipped. Crop
    Production has no file of its own: its corn and soybean yields arrive as
    the WASDE rows, and the email says WASDE.

THE PRICE MOVE. The last data/prices.json committed before the release is
read from git history (the workflow checks out with history) and compared
with the current file. If no file before the release is on record, the move
shown is the day's change against the previous settle, and labelled that way.
Nothing is estimated.

Transport and env are send_daily.py's: SMTP_*, FROM_ADDR, FROM_NAME (default
"AGSIST"), REPLY_TO, LIST_URL, LIST_TOKEN, UNSUB_SECRET, DRY_RUN. Every email
carries the signed one-click unsubscribe (it stops AGSIST Daily too -- the
worker has one list) and the forward-to-a-neighbor link.

    python3 scripts/send_report_day.py              send if today has a report
    DRY_RUN=1 python3 scripts/send_report_day.py    render, send nothing
    python3 scripts/send_report_day.py --date 2026-09-30 --selftest
"""
import hashlib
import hmac
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
from datetime import date, datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import subscribers        # noqa: E402
import gmail_limit        # noqa: E402
from local_bid import q_cash_text, q_cents   # noqa: E402  (the site's quarter-cent text)
from report_bands import surprise as band_surprise, range_context   # noqa: E402  (the one grading rule)

try:
    from zoneinfo import ZoneInfo
    CT, ET = ZoneInfo("America/Chicago"), ZoneInfo("America/New_York")
except Exception:          # pragma: no cover
    CT = ET = None

REPO = Path(__file__).resolve().parent.parent
WPI = REPO / "data" / "whats-priced-in.json"
WASDE = REPO / "data" / "wasde.json"
PRICES_REL = "data/prices.json"
PAGE = "https://agsist.com/whats-priced-in?utm_source=report_email&utm_medium=email"
FORWARD_URL = "https://agsist.com/?ref=email-forward"
UA = {"User-Agent": "AGSIST-automation/1.0 (+https://agsist.com; sig@farmers1st.com)"}
TYPES = ("WASDE", "Crop Production", "Grain Stocks")
# corn, soybeans, wheat: the nearby contract data/prices.json names in `nearby`
MOVE_CROPS = (("corn", "corn"), ("beans", "soybeans"), ("wheat", "wheat"))


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if isinstance(v, str):
        v = v.strip()
    if required and not v:
        print("FATAL: missing env " + name)
        sys.exit(1)
    return v


def today_ct(now=None):
    n = (now or datetime.now(timezone.utc))
    return n.astimezone(CT).date() if CT else n.date()


def release_utc(day):
    """Noon Eastern on `day`, in UTC: every report this sends is a noon-ET release."""
    return datetime(day.year, day.month, day.day, 12, 0, tzinfo=ET).astimezone(timezone.utc)


def kind_of(name):
    n = str(name or "")
    for t in TYPES:
        if t.lower() in n.lower():
            return t
    return None


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")[:40]


def num(v):
    if isinstance(v, bool) or v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def fnum(v):
    """A figure as the file wrote it: 178.5, 2.095, 765."""
    f = num(v)
    if f is None:
        return ""
    return str(int(f)) if f.is_integer() else repr(f)


# ── what today's data says ────────────────────────────────────────────────
def todays_reports(day, wpi=None, wasde=None):
    """{report name: [rows]} for rows dated `day` with a USDA figure."""
    if wpi is None:
        try:
            wpi = json.load(open(WPI))
        except Exception:
            wpi = {}
    if wasde is None:
        try:
            wasde = json.load(open(WASDE))
        except Exception:
            wasde = {}
    iso = day.isoformat()
    out = {}
    for h in (wpi.get("history") or []):
        if str(h.get("date")) == iso and num(h.get("actual")) is not None and h.get("report"):
            out.setdefault(str(h["report"]), []).append(h)
    # wasde.json is written first (fetch_wasde.py) and whats-priced-in.json is
    # rebuilt from it in the same run. If only the first landed, use it: USDA's
    # figure and the trade average, no range.
    if not any(kind_of(r) == "WASDE" for r in out) and str(wasde.get("release")) == iso:
        rows = []
        for m in (wasde.get("metrics") or []):
            if num(m.get("value")) is None:
                continue
            # graded with the same rule the page uses; no range is on this
            # file, so there is no range context to print
            rows.append({"date": iso, "report": day.strftime("%B") + " WASDE", "metric": m.get("label"),
                         "actual": m.get("value"), "expected": m.get("consensus"), "low": None, "high": None,
                         "unit": m.get("unit"),
                         "surprise": band_surprise(num(m.get("consensus")), num(m.get("value")), m.get("label") or ""),
                         "reaction": ""})
        if rows:
            out[rows[0]["report"]] = rows
    return out


def row_line(h):
    unit = (" " + str(h["unit"])) if h.get("unit") else ""
    s = "%s: USDA %s%s." % (h.get("metric") or "", fnum(h.get("actual")), unit)
    exp, lo, hi, act = num(h.get("expected")), num(h.get("low")), num(h.get("high")), num(h.get("actual"))
    if exp is not None:
        s += " Trade average %s" % fnum(exp)
        if lo is not None and hi is not None:
            s += ", range %s to %s" % (fnum(lo), fnum(hi))
        s += "."
        # The grade is the page's (report_bands, carried on the row); the
        # range is context, worded by the same function the page uses.
        ctx = h.get("context") or range_context(act, lo, hi)
        if h.get("surprise"):
            s += " Graded " + str(h["surprise"]) + (", " + ctx if ctx else "") + "."
        elif ctx:
            s += " " + ctx[0].upper() + ctx[1:] + "."
    else:
        s += " No trade estimate was on file for this one."
    return s


# ── USDA's own month-over-month changes, off the WASDE PDF ───────────────
MONTH_NAME = {"Jan": "January", "Feb": "February", "Mar": "March", "Apr": "April", "May": "May",
              "Jun": "June", "Jul": "July", "Aug": "August", "Sep": "September", "Oct": "October",
              "Nov": "November", "Dec": "December"}
CROP_NAME = (("corn", "Corn"), ("soybeans", "Soybeans"), ("wheat", "Wheat"))


def balance_lines(day, wasde=None):
    """One line per crop: ending stocks and the season-average farm price, each
    against last month, as the WASDE PDF printed them (data/wasde.json's
    `wasde_pdf`, written by fetch_wasde.py). [] when the file is not today's
    or carries no PDF read. Nothing here is computed but the difference of two
    printed figures."""
    if wasde is None:
        try:
            wasde = json.load(open(WASDE))
        except Exception:
            wasde = {}
    pdf = wasde.get("wasde_pdf") or {}
    if str(wasde.get("release")) != day.isoformat() or str(pdf.get("date")) != day.isoformat():
        return []
    out = []
    for key, word in CROP_NAME:
        t = (pdf.get("crops") or {}).get(key) or {}
        prev_m = MONTH_NAME.get(t.get("prev_month") or "", "")
        bits = []
        st = t.get("ending_stocks") or {}
        v, p = num(st.get("value")), num(st.get("prev"))
        if v is not None:
            b = "ending stocks %s million bushels" % format(int(round(v)), ",")
            if p is not None and prev_m:
                d = int(round(v - p))
                b += (", unchanged from " + prev_m) if d == 0 else (
                    ", %s %s million from %s" % ("up" if d > 0 else "down", format(abs(d), ","), prev_m))
            bits.append(b)
        pr = t.get("price") or {}
        v, p = num(pr.get("value")), num(pr.get("prev"))
        if v is not None:
            b = "average farm price $%.2f a bushel" % v
            if p is not None and prev_m:
                c = int(round((v - p) * 100))
                b += ", unchanged" if c == 0 else (", %s %d cents" % ("up" if c > 0 else "down", abs(c)))
            bits.append(b)
        if bits:
            out.append("%s %s: %s." % (t.get("marketing_year") or "", word, "; ".join(bits)))
    return out


# ── the price move ────────────────────────────────────────────────────────
def _git(*args):
    return subprocess.run(["git", "-C", str(REPO)] + list(args), capture_output=True, text=True, timeout=60)


def prices_before(rel_utc):
    """The last data/prices.json committed before the release, or None."""
    try:
        r = _git("log", "-n", "6", "--format=%H", "--before=" + rel_utc.strftime("%Y-%m-%dT%H:%M:%SZ"), "--", PRICES_REL)
        for h in r.stdout.split():
            s = _git("show", h + ":" + PRICES_REL)
            if s.returncode != 0:
                continue
            j = json.loads(s.stdout)
            f = parse_utc(j.get("fetched"))
            if f and f <= rel_utc and (rel_utc - f).total_seconds() <= 6 * 3600:
                return j
    except Exception as ex:
        print("price before the release unavailable (%s)" % type(ex).__name__)
    return None


def parse_utc(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def ct_clock(d):
    d = d.astimezone(CT) if CT else d
    return d.strftime("%I:%M %p").lstrip("0") + " CT"


def price_moves(now_j, before_j, rel_utc):
    """Lines for corn, soybeans, wheat, or [] with the reason printed."""
    now_f = parse_utc((now_j or {}).get("fetched"))
    if not now_f or now_f <= rel_utc:
        print("price move: no price file read after the release yet")
        return []
    if (now_f - rel_utc).total_seconds() > 12 * 3600:
        # a replay of an old report (--date) must not print today's prices as its move
        print("price move: the price file is from %s, not the release afternoon; left out" % now_f.isoformat())
        return []
    lines = []
    for nb_key, word in MOVE_CROPS:
        nb = ((now_j.get("nearby") or {}).get(nb_key) or {})
        k, lab = nb.get("key"), nb.get("label") or ""
        q = (now_j.get("quotes") or {}).get(k) if k else None
        if not q or num(q.get("close")) is None:
            continue
        price = num(q["close"]) / 100
        head = "%s %s %s at %s" % (lab, word, q_cash_text(price), ct_clock(now_f))
        bq = ((before_j or {}).get("quotes") or {}).get(k) if before_j else None
        bf = parse_utc((before_j or {}).get("fetched"))
        if bq and num(bq.get("close")) is not None and bf:
            ch = num(q["close"]) - num(bq["close"])
            lines.append("%s, %s since %s (the last price on file before the release)."
                         % (head, _move(ch), ct_clock(bf)))
        elif num(q.get("netChange")) is not None and q.get("prev_date"):
            lines.append("%s, %s on the day against the %s settle (no price on file from just before the release)."
                         % (head, _move(num(q["netChange"])), q["prev_date"]))
        else:
            lines.append(head + ".")
    return lines


def _move(cents):
    t = q_cents(cents)
    if t == "even":
        return "unchanged"
    return ("up " if cents > 0 else "down ") + t.lstrip("+−")


# ── the message ───────────────────────────────────────────────────────────
def unsub_url(email):
    base, secret = (os.environ.get("LIST_URL") or "").strip(), (os.environ.get("UNSUB_SECRET") or "").strip()
    if not (base and secret):
        return None
    t = hmac.new(secret.encode(), email.lower().encode(), hashlib.sha256).hexdigest()[:16]
    return base.rstrip("/") + "/unsubscribe?e=" + urllib.parse.quote(email.lower()) + "&t=" + t


def compose(day, reports, moves, balance=None):
    """(subject, text, html) for today's reports. Same for every reader but
    the unsubscribe link, which build_email adds. `balance` is balance_lines():
    USDA's stocks and price against last month, printed under the WASDE."""
    names = list(reports)
    subject = "USDA vs the trade: " + " + ".join(names)
    L = ["AGSIST · USDA VS THE TRADE", day.strftime("%A, %B ") + str(day.day) + day.strftime(", %Y")]
    for name, rows in reports.items():
        L += ["", name.upper() + " (released 11:00 AM CT)"]
        for h in rows:
            L.append(row_line(h))
        for h in rows:
            if h.get("reaction"):
                # No em dashes in the email, whatever the typed reaction carries.
                L.append(re.sub(r"\s*\u2014\s*", ", ", str(h["reaction"])).strip(", "))
        if balance and kind_of(name) == "WASDE":
            L += ["", "USDA'S STOCKS AND PRICE, AGAINST LAST MONTH"] + list(balance)
    if moves:
        L += ["", "THE PRICE MOVE"] + moves
    L += ["", "Trade estimates are the published pre-report survey, typed in from its source; nothing here is estimated by AGSIST.",
          "Every figure, its source and the history: " + PAGE]
    text = "\n".join(L)
    esc = lambda s: str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    parts = []
    for ln in L:
        if not ln:
            continue
        # A report's own heading ("SEPTEMBER GRAIN STOCKS (released 11:00 AM CT)")
        # is not all capitals, so it fell through to a body paragraph.
        if ln.isupper() or ln.startswith("AGSIST ·") or ln.split(" (released ")[0].isupper():
            parts.append('<p style="margin:16px 0 4px;font:700 11px/1.4 monospace;letter-spacing:.12em;color:#6b6b6b">%s</p>' % esc(ln))
        elif ln.startswith("Every figure"):
            parts.append('<p style="margin:12px 0 0;font:14px/1.5 sans-serif"><a href="%s" style="color:#8a6b1f">Every figure, its source and the history</a></p>' % PAGE.replace("&", "&amp;"))
        else:
            parts.append('<p style="margin:6px 0;font:15px/1.55 sans-serif;color:#14100a">%s</p>' % esc(ln))
    html = ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="color-scheme" content="light dark"></head><body style="margin:0;padding:16px;background:#f6f3ec">'
            '<div style="max-width:600px;margin:0 auto;background:#fff;padding:20px 18px">%s{{FOOT}}</div></body></html>' % "".join(parts))
    return subject, text, html


def build_email(day, b, to_addr, from_name, from_addr, reply_to):
    """`b` is (subject, text, html) from compose(). Same signature as
    send_daily.build_email, so the send loop below is the same loop."""
    subject, text, html = b
    uurl = unsub_url(to_addr)
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((from_name, from_addr))
    msg["To"] = to_addr
    msg["Message-ID"] = make_msgid(domain=from_addr.split("@", 1)[1])
    if reply_to:
        msg["Reply-To"] = reply_to
    unsub = reply_to or from_addr
    if uurl:
        msg["List-Unsubscribe"] = "<" + uurl + ">, <mailto:" + unsub + "?subject=unsubscribe>"
        msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    else:
        msg["List-Unsubscribe"] = "<mailto:" + unsub + "?subject=unsubscribe>"
    foot_t = ["", "Forward to a neighbor. Or send them the free sign-up link: " + FORWARD_URL, "",
              "You get this because you signed up for AGSIST Daily and report-day emails.",
              ("Unsubscribe (stops AGSIST Daily too): " + uurl) if uurl else "To unsubscribe, reply with subject line: unsubscribe",
              "PO Box 243, Chetek, WI 54728"]
    msg.set_content(text + "\n" + "\n".join(foot_t) + "\n")
    foot_h = ('<p style="margin:16px 0 0;font:14px/1.5 sans-serif;color:#6b6b6b">Forward to a neighbor. Or send them the free '
              'sign-up link: <a href="%s" style="color:#8a6b1f">agsist.com/?ref=email-forward</a></p>'
              '<p style="margin:12px 0 0;font:14px/1.6 sans-serif;color:#6b6b6b">You get this because you signed up for AGSIST Daily '
              'and report-day emails.<br>%s<br>PO Box 243, Chetek, WI 54728</p>'
              % (FORWARD_URL, ('<a href="%s" style="color:#6b6b6b">Unsubscribe</a> (stops AGSIST Daily too)' % uurl.replace("&", "&amp;"))
                 if uurl else "To unsubscribe, reply with subject line: unsubscribe"))
    msg.add_alternative(html.replace("{{FOOT}}", foot_h), subtype="html")
    return msg


# ── dedupe ────────────────────────────────────────────────────────────────
PENDING_KEYS = []


def _flag_key(day, name):
    return "report:%s:%s" % (day.isoformat(), slug(name))


def flag_get(key):
    """True / False, or None when the worker cannot be asked."""
    base, token = (os.environ.get("LIST_URL") or "").strip(), (os.environ.get("LIST_TOKEN") or "").strip()
    if not (base and token):
        return None
    u = base.rstrip("/") + "/flag?k=" + urllib.parse.quote(key) + "&token=" + urllib.parse.quote(token)
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=20) as r:
            return bool(json.loads(r.read().decode()).get("set", False))
    except Exception as ex:
        print("flag unreachable (%s: %s)" % (type(ex).__name__, str(ex)[:100]))
        return None


def flag(day, set_it=False):
    """Called by the send loop once anything went out: marks every report in
    this email sent, so no reader gets it twice."""
    if not set_it:
        return False
    base, token = (os.environ.get("LIST_URL") or "").strip(), (os.environ.get("LIST_TOKEN") or "").strip()
    for key in PENDING_KEYS:
        try:
            u = base.rstrip("/") + "/flag?k=" + urllib.parse.quote(key) + "&token=" + urllib.parse.quote(token)
            urllib.request.urlopen(urllib.request.Request(u, method="POST", headers=UA), timeout=20).read()
        except Exception as ex:
            print("::error::could not set %s (%s) -- a rerun could send this report again" % (key, type(ex).__name__))
    return True


def main(argv=()):
    argv = list(argv)
    dry = env("DRY_RUN", "") == "1"
    day = date.fromisoformat(argv[argv.index("--date") + 1]) if "--date" in argv else today_ct()
    rel = release_utc(day)
    now = datetime.now(timezone.utc)
    reports = todays_reports(day)
    cal = gmail_limit.report_kinds(day)
    for t in TYPES:
        have = [n for n in reports if kind_of(n) == t]
        if have:
            continue
        if t == "Crop Production":
            print("Crop Production: no data file of its own in the repo; its yields come as the WASDE rows. Skipped.")
        elif t in cal:
            print("%s: on today's calendar, but data/whats-priced-in.json has no %s row for %s with a USDA figure. Skipped."
                  % (t, t, day.isoformat()))
        else:
            print("%s: no %s data dated %s in the repo. Skipped." % (t, t, day.isoformat()))
    if not reports:
        print("no report data dated %s -- nothing to send. exit 0" % day.isoformat())
        return 0
    if "--date" not in argv and now < rel:
        print("release is %s; refusing to send before it. exit 0" % rel.isoformat())
        return 0
    print("today's reports with data: " + ", ".join("%s (%d rows)" % (n, len(r)) for n, r in reports.items()))

    if not dry:
        base, token = env("LIST_URL"), env("LIST_TOKEN")
        if not (base and token):
            print("FATAL: LIST_URL and LIST_TOKEN are required to send: without the worker there is no dedupe flag")
            return 1
        for name in list(reports):
            seen = flag_get(_flag_key(day, name))
            if seen is None:
                print("FATAL: cannot reach the duplicate-send flag -- refusing to send rather than risk a second copy")
                return 1
            if seen:
                print("%s already sent today (%s) -- skipping it" % (name, _flag_key(day, name)))
                del reports[name]
        if not reports:
            print("every report with data today was already sent. exit 0")
            return 0
    PENDING_KEYS[:] = [_flag_key(day, n) for n in reports]

    now_j = json.load(open(REPO / PRICES_REL))
    moves = price_moves(now_j, prices_before(rel), rel)
    balance = balance_lines(day) if any(kind_of(n) == "WASDE" for n in reports) else []
    b = compose(day, reports, moves, balance)

    base, token = env("LIST_URL"), env("LIST_TOKEN")
    if base and token:
        subs, how = subscribers.fetch(base, token)
    else:
        subs, how = subscribers.parse_plain(env("RECIPIENTS", "")), "plain"
    recipients = [r["email"] for r in subs if r.get("reports") is not False]
    print("list: %d address(es), %d opted into report-day email (%s list)" % (len(subs), len(recipients), how))
    gmail_limit.check(len(subs), len(recipients), day, dry=dry)
    if not recipients:
        print("nobody to send to. exit 0")
        return 0

    from_addr = env("FROM_ADDR") or env("SMTP_USER", required=True)
    from_name = env("FROM_NAME") or "AGSIST"
    reply_to = env("REPLY_TO")
    if dry:
        m = build_email(day, b, recipients[0], from_name, from_addr, reply_to)
        print("SUBJECT: " + str(m["Subject"]))
        print("would send to %d reader(s)" % len(recipients))
        print("-" * 60)
        print(m.get_body(("plain",)).get_content())
        print("dry run complete -- nothing sent, no flag set")
        return 0

    host = env("SMTP_HOST", "smtp.gmail.com") or "smtp.gmail.com"
    port = int(env("SMTP_PORT", "587") or 587)
    user = env("SMTP_USER", required=True)
    pw = env("SMTP_PASS", required=True)

    # THE SAME LOOP AS send_daily.py, byte for byte between its delimiters, and
    # held to it by scripts/test_send_loops.py: a dropped socket costs one
    # email, never the tail of the list and never a second copy for everyone.
    sent, failed = 0, []
    ctx = ssl.create_default_context()

    def connect():
        """A fresh, logged-in connection. Called again if one dies mid-list."""
        c = smtplib.SMTP(host, port, timeout=30)
        c.starttls(context=ctx)
        c.login(user, pw)
        return c

    conn = connect()
    reconnects, MAX_RECONNECTS = 0, 3
    try:
        for i, r in enumerate(recipients):
            try:
                conn.send_message(build_email(day, b, r, from_name, from_addr, reply_to))
                sent += 1
            except Exception as ex:
                failed.append(r + " (" + type(ex).__name__ + ")")
                fatal = (isinstance(ex, (smtplib.SMTPServerDisconnected,
                                         smtplib.SMTPConnectError))
                         or (isinstance(ex, OSError)
                             and not isinstance(ex, smtplib.SMTPException)))
                if fatal and reconnects < MAX_RECONNECTS and i < len(recipients) - 1:
                    reconnects += 1
                    print("  connection lost after %d sent; reconnecting (%d/%d)"
                          % (sent, reconnects, MAX_RECONNECTS))
                    try:
                        conn.quit()
                    except Exception:
                        pass
                    try:
                        conn = connect()
                    except Exception as ex2:
                        print("::error::could not reconnect (%s) — %d of %d report emails sent"
                              % (type(ex2).__name__, sent, len(recipients)))
                        break
            if i < len(recipients) - 1:
                time.sleep(1.2)  # gentle throttle keeps Gmail happy
    finally:
        try:
            conn.quit()
        except Exception:
            pass
    print("sent " + str(sent) + "/" + str(len(recipients)))
    if sent > 0:
        flag(day, set_it=True)
    if failed:
        print("::error::failed (" + str(len(failed)) + " of " + str(len(recipients))
              + ") — the report is flagged, so a plain rerun will NOT resend to "
              "anyone. Resend to these addresses individually: " + ", ".join(failed))
    return 0 if sent > 0 else 1


def _selftest():
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
    wpi = json.load(open(WPI))
    r = todays_reports(date(2026, 9, 30), wpi, {})
    ok(list(r) == ["September Grain Stocks"] and len(r["September Grain Stocks"]) == 3, "Sep 30 2026: Grain Stocks, 3 rows")
    line = row_line(r["September Grain Stocks"][0])
    ok(line.startswith("Corn stocks, all positions, Sept 1: USDA 2.095 B bu. Trade average 1.918, range 1.843 to 2.005. Graded bearish, outside the trade range."), line)
    soy = row_line(r["September Grain Stocks"][1])
    ok(soy.endswith("Graded bullish, inside the range, near the bottom."), soy)
    ok("No trade estimate was on file" in row_line(r["September Grain Stocks"][2]), "a row with no estimate says so")
    ok(todays_reports(date(2026, 10, 6), wpi, {}) == {}, "no report today: nothing")
    ok(list(todays_reports(date(2026, 9, 11), wpi, {})) == ["September WASDE"], "Sep 11: WASDE")
    w = {"release": "2026-10-09", "metrics": [{"label": "2026/27 corn yield", "value": 180.1, "unit": "bu/acre", "consensus": 179.0}]}
    rr = todays_reports(date(2026, 10, 9), {"history": []}, w)
    ok(list(rr) == ["October WASDE"] and "Trade average 179" in row_line(rr["October WASDE"][0]), "wasde.json alone fills WASDE")
    # 180.1 vs 179.0 is +0.61%, past the 0.5% yield band: graded by the same rule
    ok(row_line(rr["October WASDE"][0]).endswith("Graded bearish."), row_line(rr["October WASDE"][0]))
    ok(release_utc(date(2026, 10, 9)).hour == 16 and release_utc(date(2026, 12, 10)).hour == 17, "noon ET in UTC, DST aware")
    ok(len(_flag_key(date(2026, 9, 30), "September Grain Stocks")) <= 64
       and re.match(r"^[\w:.-]{1,64}$", _flag_key(date(2026, 9, 30), "September Grain Stocks")), "flag key fits the worker's pattern")
    rel = release_utc(date(2026, 10, 6))
    now_j = {"fetched": "2026-10-06T19:26:09Z", "nearby": {"corn": {"key": "corn-dec26", "label": "Dec '26"}},
             "quotes": {"corn-dec26": {"close": 508.5, "netChange": 11.25, "prev_date": "2026-10-05"}}}
    bef = {"fetched": "2026-10-06T15:50:00Z", "quotes": {"corn-dec26": {"close": 501.25}}}
    mv = price_moves(now_j, bef, rel)
    ok(mv == ["Dec '26 corn $5.08 1/2 at 2:26 PM CT, up 7 1/4¢ since 10:50 AM CT (the last price on file before the release)."], repr(mv))
    mv = price_moves(now_j, None, rel)
    ok("on the day against the 2026-10-05 settle" in mv[0], "no pre-release file: labelled as the day's change")
    ok(price_moves(dict(now_j, fetched="2026-10-06T15:00:00Z"), bef, rel) == [], "no price after the release: no move")
    ok(price_moves(now_j, bef, release_utc(date(2026, 9, 30))) == [], "a replay of Sep 30 does not print Oct 6 prices")
    s, t, h = compose(date(2026, 9, 30), r, mv)
    ok(s == "USDA vs the trade: September Grain Stocks", s)
    m = build_email(date(2026, 9, 30), (s, t, h), "a@farm.com", "AGSIST", "sender@example.com", None)
    body = m.get_body(("plain",)).get_content()
    ok(FORWARD_URL in body and "PO Box 243" in body, "forward link and postal address")
    ok("{{FOOT}}" not in m.get_body(("html",)).get_content(), "html footer filled")

    # OCTOBER 9 2026: STOCKS JOIN THE YIELDS UNDER THE SAME REPORT NAME.
    # The yields-only email went out that day (127/127) and set
    # report:2026-10-09:october-wasde. Re-grading added six rows dated the same
    # day; they must land under the same report name, so the same flag says
    # "already sent" and nobody gets a second October WASDE email.
    w10 = json.load(open(WASDE)) if WASDE.exists() else {}
    r10 = todays_reports(date(2026, 10, 9), wpi, w10)
    ok(list(r10) == ["October WASDE"], "Oct 9: every row under one report, %r" % list(r10))
    ok(_flag_key(date(2026, 10, 9), "October WASDE") == "report:2026-10-09:october-wasde",
       "the day-marker set by the 127-reader send is the one a rerun checks")
    labels = [h.get("metric") for h in r10.get("October WASDE", [])]
    ok("2026/27 corn ending stocks" in labels and "2026/27 corn yield" in labels,
       "a future send carries the stocks rows beside the yields: %r" % labels)
    sl = [row_line(h) for h in r10.get("October WASDE", []) if h.get("metric") == "2026/27 corn ending stocks"]
    ok(sl == ["2026/27 corn ending stocks: USDA 1.849 bil bu. Trade average 1.677, range 1.522 to 1.895. Graded bearish, inside the range, near the top."], repr(sl))
    pdf = {"release": "2026-10-09", "wasde_pdf": {"date": "2026-10-09", "crops": {
        "corn": {"marketing_year": "2026/27", "prev_month": "Sep",
                 "ending_stocks": {"value": 1849, "prev": 1567}, "price": {"value": 4.7, "prev": 4.8}},
        "soybeans": {"marketing_year": "2026/27", "prev_month": "Sep",
                     "ending_stocks": {"value": 315, "prev": 310}, "price": {"value": 12.0, "prev": 12.0}},
        "wheat": {"marketing_year": "2026/27", "prev_month": "Sep",
                  "ending_stocks": {"value": 740, "prev": 717}, "price": {"value": 6.3, "prev": 6.4}}}}}
    bl = balance_lines(date(2026, 10, 9), pdf)
    ok(bl == ["2026/27 Corn: ending stocks 1,849 million bushels, up 282 million from September; "
              "average farm price $4.70 a bushel, down 10 cents.",
              "2026/27 Soybeans: ending stocks 315 million bushels, up 5 million from September; "
              "average farm price $12.00 a bushel, unchanged.",
              "2026/27 Wheat: ending stocks 740 million bushels, up 23 million from September; "
              "average farm price $6.30 a bushel, down 10 cents."], repr(bl))
    ok(balance_lines(date(2026, 11, 10), pdf) == [], "October's PDF is not printed under November's report")
    ok(balance_lines(date(2026, 10, 9), {"release": "2026-10-09"}) == [], "no PDF read, no lines")
    s10, t10, h10 = compose(date(2026, 10, 9), r10, [], bl)
    ok("USDA'S STOCKS AND PRICE, AGAINST LAST MONTH" in t10 and "$4.70" in t10, "the email carries the lines")
    ok("\u2014" not in t10 and "\u2014" not in h10, "and no em dash anywhere in it")
    ok(">USDA&#x27;S STOCKS" in h10 or ">USDA'S STOCKS" in h10, "the heading is styled as a heading")
    s9, t9, _ = compose(date(2026, 9, 30), r, [], bl)
    ok("STOCKS AND PRICE" not in t9, "a Grain Stocks email does not carry WASDE lines")
    if fails:
        for f in fails:
            print("FAIL", f)
        return 1
    print("send_report_day selftest ok")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    sys.exit(main(sys.argv[1:]))
