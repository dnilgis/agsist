#!/usr/bin/env python3
"""
send_cot_weekly.py -- "Funds this week", one short email after each CFTC
Commitments of Traders release (Sig, Oct 21 2026).

WHO GETS IT. The readers on the worker's `cot` list (subs worker v5.44,
POST /notice topic cot, from the boxes on /cot and the futures and cattle
pages), read from GET /notice-list?topic=cot. Its own list: being on AGSIST
Daily does not put anyone on it, and its unsubscribe link stops this email
only (/notice-unsubscribe ... &topic=cot). The link carries the worker's
link id (k=, subs worker v5.46, scripts/email_links.py), never the address;
a reader the worker gave no link id this run is not mailed.

WHAT IT SAYS. For corn, soybeans, Chicago wheat, live cattle, feeder cattle
and lean hogs, from the site's own COT files, the same numbers /cot shows:
  * managed money's net position (CFTC Disaggregated, futures only: long
    minus short), data/cot.json `net`;
  * the change from the report before, data/cot.json `prev`, said as "from
    the week before" only when data/cot-history.json shows that report seven
    days earlier, else "since <its date>";
  * where the net sits in its range over the last 52 weekly reports
    (data/cot-history.json) and, when data/cot-deep.json reaches this report,
    over the last three years of weekly reports: 0% the most short, 100% the
    most long in that span. A range the files cannot show for this report is
    left out, never filled in.
Plus the date the positions are as of (a Tuesday), the day and time CFTC
released them (scripts/cot_calendar.py, 3:30 PM ET) and a link to /cot.
Nothing is forecast and nothing is advice.

WHEN IT SENDS. cot-release-watch.yml runs it right after it commits a new
report. It sends only when:
  * data/cot.json, data/cot-history.json and the as-of date agree;
  * the report is fresh: released within the last 3 days (a Friday report
    still goes on Monday; a forced rerun weeks later sends nothing);
  * never twice: one /flag marker per report (cot:<as-of date>), checked
    before and set after, through the subs worker. The flag service
    unreachable means no send (fails closed, as send_report_day.py).

Transport and env are send_daily.py's: SMTP_*, FROM_ADDR, FROM_NAME (default
"AGSIST"), REPLY_TO, LIST_URL, LIST_TOKEN, UNSUB_SECRET, DRY_RUN. No address
is ever printed: counts only, masked in the failure annotation.

    python3 scripts/send_cot_weekly.py              send this week's, if not sent
    DRY_RUN=1 python3 scripts/send_cot_weekly.py    render, send nothing
    python3 scripts/send_cot_weekly.py --selftest   fixtures, no network
    python3 scripts/send_cot_weekly.py --render out.html   the sample email, from the fixtures
"""
import json
import os
import re
import smtplib
import ssl
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import subscribers        # noqa: E402
import log_safe           # noqa: E402  (no address in the public log)
import cot_calendar       # noqa: E402  (the release day CFTC keeps)
import email_links        # noqa: E402  (k=<link id> links; never an address in one)
import list_source  # noqa: E402  (the worker, or the private copy of its list)

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except Exception:          # pragma: no cover
    ET = None

REPO = Path(__file__).resolve().parent.parent
COT = REPO / "data" / "cot.json"
HIST = REPO / "data" / "cot-history.json"
DEEP = REPO / "data" / "cot-deep.json"
TAG = "utm_source=cot_email&utm_medium=email"
PAGE = "https://agsist.com/cot?" + TAG
FORWARD_URL = "https://agsist.com/cot?ref=email-forward&" + TAG
UA = {"User-Agent": "AGSIST-automation/1.0 (+https://agsist.com; sig@farmers1st.com)"}
TOPIC = "cot"
# (key in the COT files, the name in the email)
MARKETS = (("corn", "Corn"), ("beans", "Soybeans"), ("wheat", "Chicago wheat"),
           ("livecattle", "Live cattle"), ("feedercattle", "Feeder cattle"), ("leanhogs", "Lean hogs"))
# what a contract is called in the sentence
NOUN = {"corn": "corn", "beans": "soybean", "wheat": "Chicago wheat", "livecattle": "live cattle",
        "feedercattle": "feeder cattle", "leanhogs": "lean hog"}
FRESH_DAYS = 3
RELEASE_TIME = "3:30 PM ET"


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if isinstance(v, str):
        v = v.strip()
    if required and not v:
        print("FATAL: missing env " + name)
        sys.exit(1)
    return v


def today_et(now=None):
    n = now or datetime.now(timezone.utc)
    return n.astimezone(ET).date() if ET else n.date()


def load(p):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def as_of_date(cot):
    """data/cot.json writes "October 13, 2026"."""
    try:
        return datetime.strptime(str((cot or {}).get("report_date") or ""), "%B %d, %Y").date()
    except ValueError:
        return None


def n0(v):
    return isinstance(v, int) and not isinstance(v, bool)


def comma(n):
    return format(abs(int(n)), ",")


def side(n):
    if n > 0:
        return "net long %s" % comma(n)
    if n < 0:
        return "net short %s" % comma(n)
    return "flat (as many long as short)"


def pct_in(v, lo, hi):
    """0 at the most short in the span, 100 at the most long; None for no span."""
    if hi <= lo:
        return None
    return int(round(100.0 * (v - lo) / (hi - lo)))


def md(d):
    return d.strftime("%b ") + str(d.day)


def long_day(d):
    return d.strftime("%A, %B ") + str(d.day)


# ── what the files say ────────────────────────────────────────────────────
def rows_for(cot, hist, deep, as_of):
    """[{key, name, net, chg, chg_since, y1, y3}] for each market the files
    carry for this report. y1 / y3 = {lo, hi, pct, n} or None."""
    out = []
    H = (hist or {}).get("history") or {}
    D = (deep or {}).get("commodities") or {}
    iso = as_of.isoformat()
    for key, name in MARKETS:
        c = (cot or {}).get(key) or {}
        if not n0(c.get("net")):
            print("%s: no net position in data/cot.json; left out" % name)
            continue
        h = [r for r in (H.get(key) or []) if isinstance(r, dict) and n0(r.get("net")) and r.get("date")]
        if not h or h[-1]["date"] != iso or h[-1]["net"] != c["net"]:
            print("%s: data/cot-history.json does not end on this report (%s); left out" % (name, iso))
            continue
        row = {"key": key, "name": name, "net": c["net"], "chg": None, "chg_since": None, "y1": None, "y3": None}
        if n0(c.get("prev")) and len(h) >= 2 and h[-2]["net"] == c["prev"]:
            row["chg"] = c["net"] - c["prev"]
            try:
                pd = date.fromisoformat(h[-2]["date"])
                row["chg_since"] = None if (as_of - pd).days == 7 else pd
            except ValueError:
                row["chg"] = None
        span = [r for r in h if r["date"] > (as_of - timedelta(days=365)).isoformat()]
        if len(span) >= 45:
            nets = [r["net"] for r in span]
            lo, hi = min(nets), max(nets)
            p = pct_in(c["net"], lo, hi)
            if p is not None:
                row["y1"] = {"lo": lo, "hi": hi, "pct": p, "n": len(span)}
        d = D.get(key) or {}
        ds, L, S = d.get("dates") or [], d.get("mm_long") or [], d.get("mm_short") or []
        if ds and ds[-1] == iso and len(ds) == len(L) == len(S):
            start = (as_of - timedelta(days=3 * 365)).isoformat()
            nets = [L[i] - S[i] for i in range(len(ds)) if ds[i] > start and n0(L[i]) and n0(S[i])]
            # the files must agree on this week, and the span must really be three years of reports
            if nets and nets[-1] == c["net"] and len(nets) >= 140 and ds[0] <= start:
                lo, hi = min(nets), max(nets)
                p = pct_in(c["net"], lo, hi)
                if p is not None:
                    row["y3"] = {"lo": lo, "hi": hi, "pct": p, "n": len(nets)}
        out.append(row)
    return out


def where(p):
    if p >= 95:
        return "at or near the top of"
    if p <= 5:
        return "at or near the bottom of"
    return "%d%% of the way up" % p


def sentence(r):
    """One plain sentence a market."""
    s = "Managed money is %s %s contracts" % (side(r["net"]), NOUN[r["key"]])
    if r["chg"] is not None:
        ch = "unchanged" if r["chg"] == 0 else ("up %s" % comma(r["chg"]) if r["chg"] > 0 else "down %s" % comma(r["chg"]))
        s += ", %s %s" % (ch, "from the week before" if r["chg_since"] is None else "since " + md(r["chg_since"]))
    if r["y1"]:
        s += ", %s its 1-year range" % where(r["y1"]["pct"])
        if r["y3"]:
            s += " and %s its 3-year range" % where(r["y3"]["pct"])
    return s + "."


def range_line(r):
    bits = []
    for k, label in (("y1", "1-year"), ("y3", "3-year")):
        if r[k]:
            bits.append("%s range: %s to %s" % (label, side(r[k]["lo"]), side(r[k]["hi"])))
    return "; ".join(bits) + ("." if bits else "")


def compose(as_of, released, rows):
    """(subject, text, html), the same for every reader but the footer."""
    subject = "Funds this week: positions as of %s" % md(as_of)
    when = "Positions as of Tuesday, %s %d. CFTC released them %s at %s." % (
        as_of.strftime("%B"), as_of.day, long_day(released), RELEASE_TIME) if released else \
        "Positions as of Tuesday, %s %d." % (as_of.strftime("%B"), as_of.day)
    if as_of.weekday() != 1:
        when = when.replace("as of Tuesday, ", "as of %s, " % as_of.strftime("%A"))
    L = ["AGSIST · FUNDS THIS WEEK", when,
         "\"Managed money\" is CFTC's name for hedge funds and commodity trading advisers. A range runs from the "
         "most short (0%) to the most long (100%) they were in that span of weekly reports."]
    for r in rows:
        L += ["", r["name"].upper(), sentence(r)]
        rl = range_line(r)
        if rl:
            L.append(rl)
    L += ["", "Source: CFTC Commitments of Traders, Disaggregated, futures only. This is where the funds stood, not where prices go next.",
          "Every market, the history and how it is figured: " + PAGE]
    text = "\n".join(L)

    def esc(s):
        return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    P = '<p style="margin:%s;font:%s;color:%s">%s</p>'
    parts = ['<p style="margin:0 0 2px;font:700 11px/1.4 monospace;letter-spacing:.12em;color:#6b6b6b">AGSIST · FUNDS THIS WEEK</p>',
             P % ("0 0 6px", "700 20px/1.3 Georgia,serif", "#14100a", "Where the funds sit, as of " + esc(md(as_of))),
             P % ("0 0 4px", "14px/1.5 sans-serif", "#14100a", esc(when)),
             P % ("0 0 8px", "13px/1.5 sans-serif", "#6b6b6b", esc(L[2]))]
    for r in rows:
        parts.append('<div style="margin:14px 0 0;padding:12px 0 0;border-top:1px solid #e6e1d6">')
        parts.append(P % ("0 0 4px", "700 12px/1.4 monospace", "#6b6b6b", esc(r["name"].upper()) + ' <span style="letter-spacing:0;font-weight:700;color:#14100a">'
                          + esc(side(r["net"]).replace("net ", "").upper()) + "</span>"))
        parts.append(P % ("0 0 6px", "15px/1.55 sans-serif", "#14100a", esc(sentence(r))))
        for k, label in (("y1", "1 yr"), ("y3", "3 yr")):
            if r[k]:
                parts.append(bar(r[k]["pct"], label))
        rl = range_line(r)
        if rl:
            parts.append(P % ("4px 0 0", "12px/1.45 sans-serif", "#6b6b6b", esc(rl)))
        parts.append("</div>")
    parts.append(P % ("16px 0 0", "13px/1.5 sans-serif", "#6b6b6b", esc(L[-2])))
    parts.append('<p style="margin:12px 0 0;font:15px/1.5 sans-serif"><a href="%s" style="color:#8a6b1f;font-weight:700">'
                 'Every market on the COT tool</a></p>' % PAGE.replace("&", "&amp;"))
    html = ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="color-scheme" content="light dark"></head><body style="margin:0;padding:12px;background:#f6f3ec">'
            '<div style="max-width:600px;margin:0 auto;background:#fff;padding:18px 16px">%s{{FOOT}}</div></body></html>' % "".join(parts))
    return subject, text, html


def bar(p, label):
    """A small range bar: a table, so every mail app draws it the same."""
    p = max(0, min(100, int(p)))
    left = '<td style="width:%d%%;height:8px;background:#e6dcc6;font-size:0;line-height:0">&nbsp;</td>' % p if p > 0 else ""
    right = '<td style="height:8px;background:#efe9dd;font-size:0;line-height:0">&nbsp;</td>' if p < 100 else ""
    mark = '<td style="width:4px;height:12px;background:#14100a;font-size:0;line-height:0">&nbsp;</td>'
    return ('<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0;border-collapse:collapse">'
            '<tr><td style="width:40px;font:11px/1 sans-serif;color:#6b6b6b;padding-right:6px">%s</td><td>'
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>%s%s%s</tr></table>'
            '</td><td style="width:36px;font:11px/1 sans-serif;color:#6b6b6b;text-align:right;padding-left:6px">%d%%</td></tr></table>'
            % (label, left, mark, right, p))


# ── the message ───────────────────────────────────────────────────────────
# Address -> link id (subs worker v5.46), filled by main() from the list.
# The stop link carries k=<id>, never the address; no id, no mail.
LINK_IDS = {}


def unsub_url(email):
    base, secret = (os.environ.get("LIST_URL") or "").strip(), (os.environ.get("UNSUB_SECRET") or "").strip()
    lid = LINK_IDS.get(str(email).strip().lower())
    if not (base and secret and lid):
        return None
    return email_links.signed(base, "notice-unsubscribe", lid, secret, end="&topic=" + TOPIC)


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
    foot_t = ["", "Forward to a neighbor who trades: " + FORWARD_URL, "",
              "You get this because you asked for Funds this week on agsist.com.",
              ("Stop Funds this week (nothing else changes): " + uurl) if uurl else "To stop it, reply with subject line: unsubscribe",
              "PO Box 243, Chetek, WI 54728"]
    msg.set_content(text + "\n" + "\n".join(foot_t) + "\n")
    foot_h = ('<p style="margin:16px 0 0;font:14px/1.5 sans-serif;color:#6b6b6b">Forward to a neighbor who trades: '
              '<a href="%s" style="color:#8a6b1f">agsist.com/cot</a></p>'
              '<p style="margin:12px 0 0;font:13px/1.6 sans-serif;color:#6b6b6b">You get this because you asked for Funds this week '
              'on agsist.com.<br>%s<br>PO Box 243, Chetek, WI 54728</p>'
              % (FORWARD_URL.replace("&", "&amp;"), ('<a href="%s" style="color:#6b6b6b">Stop Funds this week</a> (nothing else changes)'
                                                     % uurl.replace("&", "&amp;")) if uurl else "To stop it, reply with subject line: unsubscribe"))
    msg.add_alternative(html.replace("{{FOOT}}", foot_h), subtype="html")
    # v5.46: refuses (raises) if any link carries an address; the send loop counts it failed
    return email_links.check_message(msg)


# ── dedupe ────────────────────────────────────────────────────────────────
PENDING_KEYS = []


def flag_key(as_of):
    return "cot:" + as_of.isoformat()


def flag_get(key):
    """True / False, or None when the worker cannot be asked."""
    base, token = (os.environ.get("LIST_URL") or "").strip(), (os.environ.get("LIST_TOKEN") or "").strip()
    if not (base and token):
        return None
    # 2026-10-22: the worker AND the private repo (scripts/list_source.py); either set = sent
    try:
        return bool(list_source.flag_is_set(key))
    except Exception as ex:
        print("flag unreachable (%s: %s)" % (type(ex).__name__, str(ex)[:100]))
        return None


def flag(day, set_it=False):
    """Called by the send loop once anything went out."""
    if not set_it:
        return False
    base, token = (os.environ.get("LIST_URL") or "").strip(), (os.environ.get("LIST_TOKEN") or "").strip()
    for key in PENDING_KEYS:
        try:
            if not list_source.flag_set(key):
                raise RuntimeError("not saved")
        except Exception as ex:
            print("::error::could not set %s (%s) -- a rerun could send this week again" % (key, type(ex).__name__))
    return True


def released_on(as_of):
    """CFTC's release day for this report, or None while a shutdown makes it unknown."""
    if cot_calendar.release_unknown(as_of):
        return None
    return cot_calendar.release_date(as_of)


def prepare(now=None, cot=None, hist=None, deep=None):
    """(as_of, released, rows) or (None, None, why)."""
    cot = load(COT) if cot is None else cot
    hist = load(HIST) if hist is None else hist
    deep = load(DEEP) if deep is None else deep
    as_of = as_of_date(cot)
    if not as_of:
        return None, None, "data/cot.json has no report date it can read"
    rel = released_on(as_of)
    today = today_et(now)
    last = rel or as_of
    if (today - last).days > FRESH_DAYS or (today - as_of).days > 14:
        return None, None, "the newest report is as of %s; too old to send as this week's" % as_of.isoformat()
    if rel and today < rel:
        return None, None, "the report for %s is not due out until %s" % (as_of.isoformat(), rel.isoformat())
    rows = rows_for(cot, hist, deep, as_of)
    if len(rows) < 3:
        return None, None, "only %d market(s) agree across the COT files for %s" % (len(rows), as_of.isoformat())
    return as_of, rel, rows


def main(argv=(), now=None, fetch=None):
    argv = list(argv)
    dry = env("DRY_RUN", "") == "1"
    as_of, rel, rows = prepare(now)
    if not as_of:
        print("nothing to send: %s. exit 0" % rows)
        return 0
    print("report as of %s, released %s: %d markets (%s)" % (as_of, rel or "date unknown", len(rows),
                                                          ", ".join(r["key"] for r in rows)))
    base, token = env("LIST_URL"), env("LIST_TOKEN")
    if not dry:
        if not (base and token):
            print("FATAL: LIST_URL and LIST_TOKEN are required to send: without the worker there is no dedupe flag")
            return 1
        seen = flag_get(flag_key(as_of))
        if seen is None:
            print("FATAL: cannot reach the duplicate-send flag -- refusing to send rather than risk a second copy")
            return 1
        if seen:
            print("this week (%s) was already sent. exit 0" % flag_key(as_of))
            return 0
    PENDING_KEYS[:] = [flag_key(as_of)]
    b = compose(as_of, rel, rows)
    day = as_of.isoformat()

    if fetch is None:
        fetch = subscribers.fetch_topic
    rows_ = []
    if base and token:
        try:
            rows_ = fetch(base, token, TOPIC)
        except Exception as ex:
            print("FATAL: could not read the Funds this week list (%s)" % type(ex).__name__)
            return 1
    # v5.46: only readers the worker gave a link id (counts only in the log)
    LINK_IDS.clear()
    LINK_IDS.update(email_links.link_ids(rows_))
    recipients = [r["email"] for r in rows_ if r["email"] in LINK_IDS]
    if rows_ and not recipients:
        print("::error::the subs worker gave no link ids (older than v5.46, or UNSUB_SECRET unset); nothing sent")
        return 1
    if len(recipients) < len(rows_):
        print("::warning::%d reader(s) had no link id this run and are not mailed" % (len(rows_) - len(recipients)))
    print("list: %d reader(s) on Funds this week" % len(recipients))
    if not recipients and not dry:
        print("nobody to send to. exit 0")
        return 0

    try:
        from_addr = log_safe.sender_addr("sender@example.com" if dry else "")
    except RuntimeError as ex:      # SES login with no FROM_ADDR: never a key id in From
        print("FATAL: " + str(ex))
        return 1
    if not from_addr:
        print("FATAL: missing env FROM_ADDR or SMTP_USER")
        return 1
    from_name = env("FROM_NAME") or "AGSIST"
    reply_to = env("REPLY_TO")
    if dry:
        # A made-up address: the preview body carries the unsubscribe link,
        # and the Actions log is public.
        LINK_IDS["reader@example.com"] = email_links.SAMPLE_LID
        m = build_email(day, b, "reader@example.com", from_name, from_addr, reply_to)
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

    # THE SAME LOOP AS send_daily.py, between its delimiters, and held to it
    # by scripts/test_send_loops.py: a dropped socket costs one email, never
    # the tail of the list and never a second copy for everyone.
    # backup mode: this week's flag goes into the private repo before the first mail
    if not all(list_source.claim(k) for k in PENDING_KEYS):
        return 1
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
                        print("::error::could not reconnect (%s); %d of %d Funds this week emails sent"
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
        # Full addresses go to Sig by private mail; the public annotation gets
        # the count and masked addresses only.
        mailed = log_safe.owner_mail("AGSIST Funds this week %s: %d of %d did not send" % (day, len(failed), len(recipients)),
                                     ["Resend to these addresses individually (the week is flagged):", ""] + failed)
        print("::error::failed (" + str(len(failed)) + " of " + str(len(recipients))
              + "): the week is flagged, so a plain rerun will NOT resend to "
              "anyone. Resend to these addresses individually ("
              + ("full list mailed to Sig" if mailed else "full list NOT mailed")
              + "): " + ", ".join(log_safe.mask_text(f) for f in failed))
    return 0 if sent > 0 else 1


# ── fixtures and the selftest ─────────────────────────────────────────────
def fixtures():
    """Three markets over three years of weekly reports, made so every figure
    below can be checked by hand. As of Tue 2026-10-13, out Fri 2026-10-16."""
    as_of = date(2026, 10, 13)
    dates = [(as_of - timedelta(days=7 * k)).isoformat() for k in range(170, -1, -1)]   # 171 reports, oldest first

    def series(f):
        return [f(i, len(dates) - 1 - i) for i in range(len(dates))]
    # corn: 1-year low -100,000 (52 reports back is the oldest of the year), high 300,000; 3-year low -250,000
    corn = series(lambda i, back: 200000 if back == 0 else 260000 if back == 1 else -100000 if back == 51
                  else 300000 if back == 10 else -250000 if back == 120 else 50000)
    beans = series(lambda i, back: -40000 if back == 0 else -45000 if back == 1 else 100000 if back == 20
                   else -60000 if back == 30 else 0)
    hogs = series(lambda i, back: 10000 if back in (0, 1) else 30000 if back == 5 else 10000)
    deep = {"commodities": {}}
    hist = {"history": {}}
    cot = {"report_date": "October 13, 2026"}
    for key, s in (("corn", corn), ("beans", beans), ("leanhogs", hogs)):
        deep["commodities"][key] = {"dates": dates, "mm_long": [max(v, 0) + 1000 for v in s], "mm_short": [max(-v, 0) + 1000 for v in s]}
        hist["history"][key] = [{"date": d, "net": v} for d, v in zip(dates[-52:], s[-52:])]
        cot[key] = {"net": s[-1], "prev": s[-2]}
    # wheat: in cot.json, but its history ends a week early -> left out
    cot["wheat"] = {"net": -5, "prev": -4}
    hist["history"]["wheat"] = [{"date": d, "net": -5} for d in dates[-53:-1]]
    return as_of, cot, hist, deep


def _selftest():
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
    import io
    import contextlib
    as_of, cot, hist, deep = fixtures()
    now = datetime(2026, 10, 16, 20, 5, tzinfo=timezone.utc)          # 4:05 PM ET Friday
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        a, rel, rows = prepare(now, cot, hist, deep)
    ok(a == as_of and rel == date(2026, 10, 16), "as of Tue Oct 13, released Fri Oct 16: %r %r" % (a, rel))
    ok([r["key"] for r in rows] == ["corn", "beans", "leanhogs"], [r["key"] for r in rows] if isinstance(rows, list) else rows)
    ok("Chicago wheat: data/cot-history.json does not end on this report" in buf.getvalue(), "a market whose files disagree is named and left out")
    R = {r["key"]: r for r in rows} if isinstance(rows, list) else {}
    c = R.get("corn") or {}
    ok(c.get("net") == 200000 and c.get("chg") == -60000 and c.get("chg_since") is None, "corn: net and the week's change %r" % c)
    # 1 year: lo -100,000, hi 300,000 -> (200,000 + 100,000) / 400,000 = 75%
    ok(c.get("y1") == {"lo": -100000, "hi": 300000, "pct": 75, "n": 52}, "corn 1-year range %r" % c.get("y1"))
    # 3 years: lo -250,000, hi 300,000 -> 450,000 / 550,000 = 81.8% -> 82%
    ok((c.get("y3") or {}).get("pct") == 82 and c["y3"]["lo"] == -250000 and c["y3"]["hi"] == 300000, "corn 3-year range %r" % c.get("y3"))
    ok(sentence(c) == "Managed money is net long 200,000 corn contracts, down 60,000 from the week before, "
       "75% of the way up its 1-year range and 82% of the way up its 3-year range.", sentence(c))
    ok(range_line(c) == "1-year range: net short 100,000 to net long 300,000; 3-year range: net short 250,000 to net long 300,000.", range_line(c))
    bn = R.get("beans") or {}
    # beans 1 yr: lo -60,000, hi 100,000 -> 20,000 / 160,000 = 12.5% -> 12% (round half to even)
    ok(bn.get("chg") == 5000 and (bn.get("y1") or {}).get("pct") == 12, "beans %r" % bn)
    ok(sentence(bn).startswith("Managed money is net short 40,000 soybean contracts, up 5,000 from the week before"), sentence(bn))
    hg = R.get("leanhogs") or {}
    ok(hg.get("chg") == 0 and (hg.get("y1") or {}).get("pct") == 0 and "unchanged from the week before, at or near the bottom of its 1-year range" in sentence(hg), sentence(hg))
    ok(sentence(hg).startswith("Managed money is net long 10,000 lean hog contracts"), sentence(hg))
    # the change is "since <date>" when the report before is not a week back
    h2 = json.loads(json.dumps(hist))
    del h2["history"]["corn"][-2]
    c2 = json.loads(json.dumps(cot))
    c2["corn"]["prev"] = h2["history"]["corn"][-2]["net"]
    with contextlib.redirect_stdout(io.StringIO()):
        r2 = {r["key"]: r for r in prepare(now, c2, h2, deep)[2]}
    ok(r2["corn"]["chg_since"] == date(2026, 9, 29) and "since Sep 29" in sentence(r2["corn"]), sentence(r2["corn"]))
    # a deep file that does not reach this report: no 3-year range, nothing made up
    d2 = json.loads(json.dumps(deep))
    for v in d2["commodities"].values():
        v["dates"], v["mm_long"], v["mm_short"] = v["dates"][:-1], v["mm_long"][:-1], v["mm_short"][:-1]
    with contextlib.redirect_stdout(io.StringIO()):
        r3 = {r["key"]: r for r in prepare(now, cot, hist, d2)[2]}
    ok(r3["corn"]["y3"] is None and "3-year" not in sentence(r3["corn"]) and r3["corn"]["y1"], "no 3-year range without the deep file")
    # stale, early, unreadable
    with contextlib.redirect_stdout(io.StringIO()):
        ok(prepare(datetime(2026, 10, 30, 20, 0, tzinfo=timezone.utc), cot, hist, deep)[0] is None, "two weeks on: too old to send")
        ok(prepare(datetime(2026, 10, 15, 20, 0, tzinfo=timezone.utc), cot, hist, deep)[0] is None, "before Friday: not out yet")
        ok(prepare(now, {"report_date": "soon"}, hist, deep)[0] is None, "no date: nothing")
    # the email
    s, t, h = compose(as_of, rel, rows)
    ok(s == "Funds this week: positions as of Oct 13", s)
    ok("Positions as of Tuesday, October 13. CFTC released them Friday, October 16 at 3:30 PM ET." in t, t[:300])
    ok("—" not in t + h and "–" not in t + h and "&mdash;" not in h, "no em or en dash anywhere")
    ok(not re.search(r"\b(will|expect|likely|forecast|should|buy|sell)\b", t.lower().replace("not where prices go next", "")), "no prediction words")
    ok(t.count("Managed money is ") == 3, "one sentence a market")
    m = build_email(as_of.isoformat(), (s, t, h), "a@farm.com", "AGSIST", "sender@example.com", None)
    os.environ.setdefault("LIST_URL", "")
    body, hb = m.get_body(("plain",)).get_content(), m.get_body(("html",)).get_content()
    ok("{{FOOT}}" not in hb and "PO Box 243" in body and "To stop it, reply with subject line: unsubscribe" in body, "footer without a link secret")
    old = {k: os.environ.get(k) for k in ("LIST_URL", "UNSUB_SECRET")}
    os.environ["LIST_URL"], os.environ["UNSUB_SECRET"] = "https://w.dev", "sec"
    L0 = email_links.SAMPLE_LID
    LINK_IDS["a@farm.com"] = L0
    try:
        m = build_email(as_of.isoformat(), (s, t, h), "A@farm.com", "AGSIST", "sender@example.com", None)
        want = "https://w.dev/notice-unsubscribe?k=" + L0 + "&t=" + email_links.token("sec", L0) + "&topic=cot"
        ok(m["List-Unsubscribe"].startswith("<" + want + ">") and m["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click", m["List-Unsubscribe"])
        ok(want in m.get_body(("plain",)).get_content(), "the stop link stops this list only")
        _h, _t = m.get_body(("html",)).get_content(), m.get_body(("plain",)).get_content()
        ok(not [u for u in email_links.hrefs(_h) if "@" in u or "%40" in u.lower()], "no @ inside any href")
        ok(not email_links.bad_links(_t) and "@" not in str(m["List-Unsubscribe"]).split(">")[0], "no address in any text link or the header link")
        LINK_IDS.pop("a@farm.com")
        m = build_email(as_of.isoformat(), (s, t, h), "a@farm.com", "AGSIST", "sender@example.com", None)
        ok("notice-unsubscribe?" not in m.get_body(("plain",)).get_content(), "no link id: no signed link, never an address link")
    finally:
        LINK_IDS.clear()
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    allt = body + hb.replace("&amp;", "&")
    us = re.findall(r'https://agsist\.com/[^\s"<>]*', allt)
    ok(us and all(TAG in u for u in us), "every agsist.com link tagged cot_email: %r" % [u for u in us if TAG not in u])
    ok("https://agsist.com/cot?" in allt, "links to the COT tool")
    # a dry run with readers on the list: counts only in the log
    import shutil
    import tempfile
    tmp = Path(tempfile.mkdtemp())
    try:
        for p, o in ((COT, cot), (HIST, hist), (DEEP, deep)):
            (tmp / p.name).write_text(json.dumps(o))
        g = globals()
        keep = (g["COT"], g["HIST"], g["DEEP"])
        g["COT"], g["HIST"], g["DEEP"] = tmp / COT.name, tmp / HIST.name, tmp / DEEP.name
        saved = {k: os.environ.get(k) for k in ("DRY_RUN", "LIST_URL", "LIST_TOKEN", "UNSUB_SECRET")}
        os.environ.update({"DRY_RUN": "1", "LIST_URL": "https://w.dev", "LIST_TOKEN": "tok", "UNSUB_SECRET": "sec"})
        asked = []
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                rc = main([], now=now, fetch=lambda b_, t_, topic: asked.append(topic) or [
                    {"email": "jane.doe@farm.com", "lid": "abcdefghjkmnpqrs"}, {"email": "bob@ranch.net", "lid": "bcdefghjkmnpqrst"},
                    {"email": "no.id@farm.com", "lid": None}])
        finally:
            g["COT"], g["HIST"], g["DEEP"] = keep
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        log = out.getvalue()
        ok(rc == 0 and asked == ["cot"], "dry run reads the cot list: rc %r asked %r" % (rc, asked))
        ok("would send to 2 reader(s)" in log and "list: 2 reader(s) on Funds this week" in log, log[-400:])
        ok("1 reader(s) had no link id this run and are not mailed" in log, "a reader without a link id is skipped, by count")
        ok("jane" not in log and "farm.com" not in log and "ranch" not in log, "no reader address in the log")
        ok("notice-unsubscribe?k=" + email_links.SAMPLE_LID in log and "%40" not in log, "the preview uses a made-up link id, no address")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    ok(re.match(r"^[\w:.-]{1,64}$", flag_key(as_of)) and flag_key(as_of) == "cot:2026-10-13", "flag key fits the worker's pattern")
    if fails:
        for f in fails:
            print("FAIL", f)
        return 1
    print("send_cot_weekly selftest ok")
    return 0


def render(path):
    """The sample email from the fixtures, html, for a screenshot."""
    as_of, cot, hist, deep = fixtures()
    with open(os.devnull, "w") as dn, __import__("contextlib").redirect_stdout(dn):
        a, rel, rows = prepare(datetime(2026, 10, 16, 20, 5, tzinfo=timezone.utc), cot, hist, deep)
    m = build_email(a.isoformat(), compose(a, rel, rows), "reader@example.com", "AGSIST", "sender@example.com", None)
    Path(path).write_text(m.get_body(("html",)).get_content(), encoding="utf-8")
    print("wrote " + str(path))
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    if "--render" in sys.argv:
        sys.exit(render(sys.argv[sys.argv.index("--render") + 1]))
    sys.exit(list_source.guard(lambda: main(sys.argv[1:]), soft=False))
