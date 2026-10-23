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
ANA = REPO / "data" / "cot-analysis.json"
# Sig, Oct 22: every list email replies to news@ (sig@ is his own mail).
REPLY_DEFAULT = "news@agsist.com"
TAG = "utm_source=cot_email&utm_medium=email"
PAGE = "https://agsist.com/cot?" + TAG
FORWARD_URL = "https://agsist.com/cot?ref=email-forward&" + TAG
UA = {"User-Agent": "AGSIST-automation/1.0 (+https://agsist.com; sig@agsist.com)"}
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
def rows_for(cot, hist, deep, as_of, ana=None, gaps=None):
    """[{key, name, net, chg, chg_since, y1, y3, rank, rank_why}] for each
    market the files carry for this report. y1 / y3 = {lo, hi, pct, n} or
    None. rank is the /cot page's own percentile (rank_of) or None, with
    rank_why saying why. A market left out goes into `gaps` as (name, why),
    so the email says it is missing instead of hiding it."""
    out = []
    gaps = [] if gaps is None else gaps
    H = (hist or {}).get("history") or {}
    D = (deep or {}).get("commodities") or {}
    iso = as_of.isoformat()
    for key, name in MARKETS:
        c = (cot or {}).get(key) or {}
        if not n0(c.get("net")):
            print("%s: no net position in data/cot.json; left out" % name)
            gaps.append((name, "no position in this week's file"))
            continue
        h = [r for r in (H.get(key) or []) if isinstance(r, dict) and n0(r.get("net")) and r.get("date")]
        if not h or h[-1]["date"] != iso or h[-1]["net"] != c["net"]:
            print("%s: data/cot-history.json does not end on this report (%s); left out" % (name, iso))
            gaps.append((name, "the weekly files do not agree on this report yet"))
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
        row["rank"], row["rank_why"] = rank_of(key, c["net"], iso, ana, deep)
        out.append(row)
    return out


def recount(deep, key, iso):
    """The full-record percentile recomputed from data/cot-deep.json, the
    way scripts/cot_analysis.py percentile_rank() counts it: managed-money net
    as a share of open interest (3 decimals), the share of weeks at or below
    this one, ties counted below, 1 decimal. None when the file does not
    reach this report."""
    d = ((deep or {}).get("commodities") or {}).get(key) or {}
    ds, L, S, OI = d.get("dates") or [], d.get("mm_long") or [], d.get("mm_short") or [], d.get("oi") or []
    if not ds or ds[-1] != iso or not (len(ds) == len(L) == len(S) == len(OI)):
        return None
    xs = [round(100.0 * (L[i] - S[i]) / OI[i], 3) for i in range(len(ds)) if n0(L[i]) and n0(S[i]) and OI[i]]
    if not xs or not OI[-1]:
        return None
    v = round(100.0 * (L[-1] - S[-1]) / OI[-1], 3)
    return round(100.0 * sum(1 for x in xs if x <= v) / len(xs), 1)


def rank_of(key, net, iso, ana, deep=None):
    """(rank, why). The ONE ranking /cot prints on its cards
    (scripts/cot_analysis.py crowd_summary: net as a share of open interest,
    against every week since the record starts), read from
    data/cot-analysis.json, never worked out a second way here. Withheld,
    with the reason, when that file is not on this report or does not match
    data/cot.json's net; and when data/cot-deep.json reaches this report and
    a recount from it does not agree."""
    a = ((ana or {}).get("commodities") or {}).get(key) or {}
    cr = a.get("crowd") or {}
    p = (a.get("pctl") or {}).get("net_oi_all")
    if a.get("date") != iso:
        return None, "the ranking is not up to this report yet"
    if a.get("net") != net:
        return None, "the ranking file and this week's position do not match"
    if not isinstance(p, (int, float)) or not isinstance(cr.get("shown"), int) or not n0(cr.get("weeks")):
        return None, "no long-run ranking for this market"
    rc = recount(deep, key, iso)
    if rc is not None and abs(rc - p) > 0.11:
        print("%s: ranking %.1f does not check against the weekly record (%.1f); withheld" % (key, p, rc))
        return None, "the ranking did not check out against the weekly record"
    return {"pctl": float(p), "shown": cr["shown"], "word": cr.get("word") or "", "crowded": cr.get("crowded"),
            "since": cr.get("since") or str(a.get("first_week") or "")[:4], "weeks": cr["weeks"],
            "record_high": bool(a.get("is_record_high")), "record_low": bool(a.get("is_record_low")),
            "held": bool(cr.get("held")), "tested": cr.get("tested") or "",
            # the page's livestock noun says "on the buy side"; the email keeps
            # to plain words with no buy or sell in them (selftest)
            "noun": (a.get("exposure_noun") or "unpriced production").replace("if you are on the buy side", "if you are a buyer")}, None


def ordinal(n):
    n = int(n)
    return "%d%s" % (n, "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th"))


def change(r):
    """The week's move in the position on its own side, or None.
    "down 3,725" under a net short that had just GROWN read as the opposite
    (the COT card's rule, cot-page.js); more / fewer is the same on both sides."""
    if r["chg"] is None:
        return None
    net, prev = r["net"], r["net"] - r["chg"]
    then = "the week before" if r["chg_since"] is None else "on " + md(r["chg_since"])
    if r["chg"] == 0:
        return "unchanged from " + then
    if net and prev and (net > 0) != (prev > 0):
        return "flipped from %s %s" % (side(prev), then)
    return "%s %s than %s" % (comma(r["chg"]), "more" if abs(net) > abs(prev) else "fewer", then)


def sentence(r):
    """What the funds hold and what they did, in one sentence."""
    ch = change(r)
    return "Managed money is %s %s contracts%s." % (side(r["net"]), NOUN[r["key"]], (", " + ch) if ch else "")


def short_line(r):
    """The phone line under a market's name (which already shows the net):
    the change, then where it ranks with its sample."""
    ch = change(r)
    k = r.get("rank")
    if not k:
        rk = rank_line(r)
    elif (k["record_high"] and r["net"] > 0) or (k["record_low"] and r["net"] < 0):
        rk = "The biggest net %s, as a share of open interest, in %s weeks since %s." % (
            "long" if r["net"] > 0 else "short", format(k["weeks"], ","), k["since"])
    else:
        rk = "%s percentile of %s weeks since %s (%s)." % (ordinal(k["shown"]), format(k["weeks"], ","), k["since"],
                                                         k["word"] + (", crowded " + k["crowded"] if k["crowded"] else ""))
    return ((ch[0].upper() + ch[1:] + ". ") if ch else "") + rk


def rank_line(r):
    """Where that sits in its own record, with the sample, or why not."""
    k = r.get("rank")
    if not k:
        return "No percentile this week: %s." % (r.get("rank_why") or "no long-run ranking")
    span = "%s weekly reports since %s" % (format(k["weeks"], ","), k["since"])
    if k["record_high"] and r["net"] > 0:
        return "That is the biggest net long, as a share of open interest, in %s." % span
    if k["record_low"] and r["net"] < 0:
        return "That is the biggest net short, as a share of open interest, in %s." % span
    tag = k["word"] + (", crowded " + k["crowded"] if k["crowded"] else "")
    return "That is the %s percentile of %s (%s)." % (ordinal(k["shown"]), span, tag)


def note(r):
    """The marketing line, only where /cot prints one (high or low side), in
    its words: how much fund business sits between here and flat, and what
    that is a reason to look at. Never a call on price."""
    k = r.get("rank")
    if not k or (25 < k["pctl"] < 75) or r["net"] == 0:
        return None
    flow = "selling" if r["net"] > 0 else "buying"
    return ("If funds head for the exit, %s contracts of %s sit between here and flat. "
            "Worth a look this week at %s. Not a call on price." % (comma(r["net"]), flow, k["noun"]))


def range_line(r):
    if not r["y1"]:
        return ""
    return "%d-week range: %s to %s." % (r["y1"]["n"], side(r["y1"]["lo"]), side(r["y1"]["hi"]))


def verdict(rows):
    """The one plain sentence on what positioning can mean, from the COT
    page's own tests (cot_analysis.py crowd_summary `tested`): the line most
    ranked markets carry, printed once at the top. A market whose own line
    differs (a reading that held up) carries it under its numbers."""
    t = [r["rank"]["tested"] for r in rows if r.get("rank") and r["rank"]["tested"]]
    return max(sorted(set(t)), key=t.count) if t else None


def own_tested(r, v):
    k = r.get("rank")
    return k["tested"] if (k and k["tested"] and k["tested"] != v) else None


def compose(as_of, released, rows, gaps=(), preview=False):
    """(subject, text, html), the same for every reader but the footer."""
    subject = ("[Preview] " if preview else "") + "Funds this week: positions as of %s" % md(as_of)
    when = "Positions as of Tuesday, %s %d. CFTC released them %s at %s." % (
        as_of.strftime("%B"), as_of.day, long_day(released), RELEASE_TIME) if released else \
        "Positions as of Tuesday, %s %d." % (as_of.strftime("%B"), as_of.day)
    if as_of.weekday() != 1:
        when = when.replace("as of Tuesday, ", "as of %s, " % as_of.strftime("%A"))
    v = verdict(rows)
    intro = ("\"Managed money\" is CFTC's name for hedge funds and commodity trading advisers. Percentiles rank their net, "
             "as a share of open interest, against every weekly report on record, as the COT page does: 0 is the most "
             "short, 100 the most long.")
    src = ("Source: CFTC Commitments of Traders, Disaggregated, futures only, report as of %s%s. Percentiles and "
           "ranges are figured by AGSIST from those weekly reports. This is where the funds stood, not where prices go next."
           % (md(as_of), (", released " + md(released)) if released else ""))
    L = ["AGSIST · FUNDS THIS WEEK", when] + ([v] if v else []) + [intro]
    for r in rows:
        L += ["", r["name"].upper(), sentence(r) + " " + rank_line(r)]
        L += [x for x in (note(r), own_tested(r, v), range_line(r)) if x]
    for name, why in gaps:
        L += ["", name.upper(), "No reading this week: %s." % why]
    L += ["", src, "Every market, the history and how it is figured: " + PAGE]
    text = "\n".join(L)

    def esc(s):
        return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    P = '<p style="margin:%s;font:%s;color:%s">%s</p>'
    parts = ['<p style="margin:0 0 2px;font:700 11px/1.4 monospace;letter-spacing:.12em;color:#6b6b6b">AGSIST · FUNDS THIS WEEK</p>',
             P % ("0 0 6px", "700 20px/1.3 Georgia,serif", "#14100a", "Where the funds sit, as of " + esc(md(as_of))),
             P % ("0 0 6px", "14px/1.5 sans-serif", "#14100a", esc(when))]
    if v:
        parts.append(P % ("0 0 6px", "700 14px/1.5 sans-serif", "#14100a", esc(v)))
    parts.append(P % ("0 0 4px", "12px/1.5 sans-serif", "#6b6b6b", esc(intro)))
    for r in rows:
        k = r.get("rank")
        parts.append('<div style="margin:8px 0 0;padding:8px 0 0;border-top:1px solid #e6e1d6">')
        parts.append(P % ("0 0 1px", "700 12px/1.4 monospace", "#6b6b6b", esc(r["name"].upper()) + ' <span style="letter-spacing:0;font-weight:700;color:#14100a">'
                          + esc(side(r["net"]).replace("net ", "").upper()) + "</span>"))
        parts.append(P % ("0 0 3px", "15px/1.45 sans-serif", "#14100a", esc(short_line(r))))
        if k:
            parts.append(bar(k["shown"]))
        n_ = note(r)
        if n_:
            parts.append(P % ("3px 0 0", "13px/1.4 sans-serif", "#14100a", esc(n_)))
        if own_tested(r, v):
            parts.append(P % ("4px 0 0", "13px/1.45 sans-serif", "#14100a", esc(own_tested(r, v))))
        rl = range_line(r)
        if rl:
            parts.append(P % ("2px 0 0", "12px/1.4 sans-serif", "#6b6b6b", esc(rl)))
        parts.append("</div>")
    for name, why in gaps:
        parts.append('<div style="margin:10px 0 0;padding:10px 0 0;border-top:1px solid #e6e1d6">'
                     + P % ("0", "13px/1.45 sans-serif", "#6b6b6b", "<b>" + esc(name.upper()) + "</b> No reading this week: " + esc(why) + ".")
                     + "</div>")
    parts.append(P % ("14px 0 0", "12px/1.5 sans-serif", "#6b6b6b", esc(src)))
    parts.append('<p style="margin:10px 0 0;font:15px/1.5 sans-serif"><a href="%s" style="color:#8a6b1f;font-weight:700">'
                 'Every market on the COT tool</a></p>' % PAGE.replace("&", "&amp;"))
    html = ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="color-scheme" content="light dark"></head><body style="margin:0;padding:12px;background:#f6f3ec">'
            '<div style="max-width:600px;margin:0 auto;background:#fff;padding:18px 16px">%s{{FOOT}}</div></body></html>' % "".join(parts))
    return subject, text, html


def bar(p):
    """A small bar for the percentile, most short at the left, most long at
    the right: a table, so every mail app draws it the same."""
    p = max(0, min(100, int(p)))
    left = '<td style="width:%d%%;height:8px;background:#e6dcc6;font-size:0;line-height:0">&nbsp;</td>' % p if p > 0 else ""
    right = '<td style="height:8px;background:#efe9dd;font-size:0;line-height:0">&nbsp;</td>' if p < 100 else ""
    mark = '<td style="width:4px;height:12px;background:#14100a;font-size:0;line-height:0">&nbsp;</td>'
    return ('<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0;border-collapse:collapse">'
            '<tr><td style="width:34px;font:11px/1 sans-serif;color:#6b6b6b;padding-right:6px">short</td><td>'
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>%s%s%s</tr></table>'
            '</td><td style="width:28px;font:11px/1 sans-serif;color:#6b6b6b;text-align:right;padding-left:6px">long</td></tr></table>'
            % (left, mark, right))


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


def prepare(now=None, cot=None, hist=None, deep=None, ana=None, gaps=None, stale_ok=False):
    """(as_of, released, rows) or (None, None, why). stale_ok (the preview to
    Sig only) lets an older report through; a send to the list never."""
    cot = load(COT) if cot is None else cot
    hist = load(HIST) if hist is None else hist
    deep = load(DEEP) if deep is None else deep
    ana = load(ANA) if ana is None else ana
    as_of = as_of_date(cot)
    if not as_of:
        return None, None, "data/cot.json has no report date it can read"
    rel = released_on(as_of)
    today = today_et(now)
    last = rel or as_of
    if (today - last).days > FRESH_DAYS or (today - as_of).days > 14:
        if not stale_ok:
            return None, None, "the newest report is as of %s; too old to send as this week's" % as_of.isoformat()
        print("preview of an older report (as of %s): a send to the list would refuse it" % as_of.isoformat())
    if rel and today < rel:
        return None, None, "the report for %s is not due out until %s" % (as_of.isoformat(), rel.isoformat())
    rows = rows_for(cot, hist, deep, as_of, ana, gaps)
    if len(rows) < 3:
        return None, None, "only %d market(s) agree across the COT files for %s" % (len(rows), as_of.isoformat())
    return as_of, rel, rows


def mode_of(argv):
    """'dry' (the default), 'preview' (Sig only) or 'send' (the list).
    DRY_RUN=1 wins over everything; nothing reaches the list unless SEND=1
    (or --send) says so in so many words."""
    if env("DRY_RUN", "") == "1" or "--dry-run" in argv:
        return "dry"
    if env("PREVIEW", "") == "1" or "--preview" in argv:
        return "preview"
    if env("SEND", "") == "1" or "--send" in argv:
        return "send"
    return "dry"


def preview_to():
    """SIG_TEST_EMAILS (comma list), else SIG_TO: the only addresses a
    preview goes to. Never printed."""
    return [x.strip() for x in (env("SIG_TEST_EMAILS", "") or env("SIG_TO", "") or "").split(",") if "@" in x]


def main(argv=(), now=None, fetch=None):
    argv = list(argv)
    mode = mode_of(argv)
    dry, preview = mode == "dry", mode == "preview"
    print("mode: " + {"dry": "dry run (the default; SEND=1 sends to the list, PREVIEW=1 to Sig only)",
                      "preview": "preview to Sig only (SIG_TEST_EMAILS, else SIG_TO); no flag read or set",
                      "send": "send to the Funds this week list"}[mode])
    gaps = []
    as_of, rel, rows = prepare(now, gaps=gaps, stale_ok=preview)
    if not as_of:
        print("nothing to send: %s. exit 0" % rows)
        return 0
    print("report as of %s, released %s: %d markets (%s)%s" % (
        as_of, rel or "date unknown", len(rows), ", ".join(r["key"] for r in rows),
        ("; no reading for " + ", ".join(g[0] for g in gaps)) if gaps else ""))
    base, token = env("LIST_URL"), env("LIST_TOKEN")
    if mode == "send":
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
    # a preview never marks the week: the list still gets it
    PENDING_KEYS[:] = [] if preview else [flag_key(as_of)]
    b = compose(as_of, rel, rows, gaps, preview=preview)
    day = as_of.isoformat()

    if fetch is None:
        fetch = subscribers.fetch_topic
    rows_ = []
    if base and token:
        try:
            rows_ = fetch(base, token, TOPIC)
        except Exception as ex:
            print(("::warning::" if preview else "FATAL: ") + "could not read the Funds this week list (%s)" % type(ex).__name__)
            if not preview:
                return 1
    # v5.46: only readers the worker gave a link id (counts only in the log)
    LINK_IDS.clear()
    LINK_IDS.update(email_links.link_ids(rows_))
    recipients = [r["email"] for r in rows_ if r["email"] in LINK_IDS]
    if rows_ and not recipients and not preview:
        print("::error::the subs worker gave no link ids (older than v5.46, or UNSUB_SECRET unset); nothing sent")
        return 1
    if len(recipients) < len(rows_):
        print("::warning::%d reader(s) had no link id this run and are not mailed" % (len(rows_) - len(recipients)))
    print("list: %d reader(s) on Funds this week" % len(recipients))
    if preview:
        recipients = preview_to()
        if not recipients:
            print("FATAL: a preview needs SIG_TEST_EMAILS or SIG_TO; nothing sent")
            return 1
        for a_ in recipients:
            LINK_IDS[a_.lower()] = list_source.lid_for(a_) or email_links.SAMPLE_LID
        recipients = [a_.lower() for a_ in recipients]
        print("preview: %d address(es), Sig's own; the list gets nothing" % len(recipients))
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
    reply_to = env("REPLY_TO") or REPLY_DEFAULT
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
TESTED = ("Nothing the COT page tested says which way price goes next. Positioning shows how much selling (or buying) "
          "could be forced if the market turns, not when.")   # scripts/cot_analysis.py TESTED_NONE
EXPOSURE_GRAIN = "unpriced bushels, or unbought needs if you are a buyer"
EXPOSURE_STOCK = "unpriced production, or unbought feeders if you are on the buy side"


def fixtures():
    """Four markets over 171 weekly reports, made so every figure below can be
    checked by hand. As of Tue 2026-10-13, out Fri 2026-10-16. Open interest
    is 1,000,000 every week, so net as a share of open interest is net / 10,000
    and the percentile is a plain count. Returns (as_of, cot, hist, deep, ana)."""
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
    # live cattle: 1,000 x (86 i mod 171), every value 0 to 170,000 once; this week (i = 170) 85,000, last week 170,000
    cattle = series(lambda i, back: 1000 * ((86 * i) % 171))
    deep = {"commodities": {}}
    hist = {"history": {}}
    cot = {"report_date": "October 13, 2026"}
    for key, s in (("corn", corn), ("beans", beans), ("livecattle", cattle), ("leanhogs", hogs)):
        deep["commodities"][key] = {"dates": dates, "mm_long": [max(v, 0) + 1000 for v in s],
                                    "mm_short": [max(-v, 0) + 1000 for v in s], "oi": [1000000] * len(dates)}
        hist["history"][key] = [{"date": d, "net": v} for d, v in zip(dates[-52:], s[-52:])]
        cot[key] = {"net": s[-1], "prev": s[-2]}
    # wheat: in cot.json, but its history ends a week early -> no reading, said so
    cot["wheat"] = {"net": -5, "prev": -4}
    hist["history"]["wheat"] = [{"date": d, "net": -5} for d in dates[-53:-1]]
    # feeder cattle: not in cot.json at all -> no reading, said so

    def a(key, net, pctl, shown, word, crowded, noun):
        return {"date": as_of.isoformat(), "net": net, "first_week": dates[0], "weeks_of_history": 171,
                "is_record_high": False, "is_record_low": False, "pctl": {"net_oi_all": pctl}, "exposure_noun": noun,
                "crowd": {"pctl": pctl, "shown": shown, "word": word, "crowded": crowded, "since": dates[0][:4],
                          "weeks": 171, "held": False, "tested": TESTED}}
    ana = {"commodities": {
        # corn 200,000: 169 of 171 weeks at or below (all but 260,000 and 300,000) = 98.83 -> 98.8; crowded long; shown 99
        "corn": a("corn", 200000, 98.8, 99, "top 1%", "long", EXPOSURE_GRAIN),
        # beans -40,000: 3 of 171 at or below (-40k, -45k, -60k) = 1.75 -> 1.8; crowded short; shown 2
        "beans": a("beans", -40000, 1.8, 2, "bottom 2%", "short", EXPOSURE_GRAIN),
        # cattle 85,000: 86 of 171 (0 to 85,000) = 50.29 -> 50.3; middling; shown 50
        "livecattle": a("livecattle", 85000, 50.3, 50, "middling", None, EXPOSURE_STOCK),
        # hogs 10,000: 170 of 171 (all but 30,000) = 99.42 -> 99.4; crowded long; shown 99
        "leanhogs": a("leanhogs", 10000, 99.4, 99, "top 1%", "long", EXPOSURE_STOCK),
    }}
    return as_of, cot, hist, deep, ana


class _FakeSMTP:
    """Stands in for smtplib.SMTP in the selftest: keeps what would be sent."""
    made, sent = [], []

    def __init__(self, host, port, timeout=None):
        _FakeSMTP.made.append((host, port))

    def starttls(self, context=None):
        pass

    def login(self, u, p):
        pass

    def send_message(self, m):
        email_links.check_hosts(m)
        _FakeSMTP.sent.append(m)

    def quit(self):
        pass


def _run(files, envs, now, fetch, argv=(), flags=None):
    """main() against fixture files with the network, the list and the mail
    server mocked. Returns (rc, log, sent messages, flag calls)."""
    import io
    import contextlib
    import shutil
    import tempfile
    tmp = Path(tempfile.mkdtemp())
    g = globals()
    keep = {k: g[k] for k in ("COT", "HIST", "DEEP", "ANA")}
    names = ("DRY_RUN", "SEND", "PREVIEW", "LIST_URL", "LIST_TOKEN", "UNSUB_SECRET", "SIG_TO", "SIG_TEST_EMAILS",
             "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "FROM_ADDR", "FROM_NAME", "REPLY_TO")
    saved = {k: os.environ.get(k) for k in names}
    ls_keep = {k: getattr(list_source, k) for k in ("flag_is_set", "flag_set", "claim", "lid_for")}
    smtp_keep, sleep_keep = smtplib.SMTP, time.sleep
    calls = []
    flags = {} if flags is None else flags

    def is_set(k):
        calls.append(("get", k))
        if flags.get("unreachable"):
            raise RuntimeError("no answer")
        return bool(flags.get(k))

    def do_set(k):
        calls.append(("set", k))
        flags[k] = True
        return True
    out = io.StringIO()
    try:
        for k, o in files.items():
            (tmp / (k + ".json")).write_text(json.dumps(o))
            g[k] = tmp / (k + ".json")
        for k in names:
            os.environ.pop(k, None)
        os.environ.update(envs)
        list_source.flag_is_set, list_source.flag_set = is_set, do_set
        list_source.claim, list_source.lid_for = (lambda k: True), (lambda e, secret=None: None)
        smtplib.SMTP, time.sleep = _FakeSMTP, (lambda s: None)
        _FakeSMTP.made, _FakeSMTP.sent = [], []
        with contextlib.redirect_stdout(out):
            rc = main(list(argv), now=now, fetch=fetch)
    finally:
        g.update(keep)
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        for k, v in ls_keep.items():
            setattr(list_source, k, v)
        smtplib.SMTP, time.sleep = smtp_keep, sleep_keep
        shutil.rmtree(tmp, ignore_errors=True)
    return rc, out.getvalue(), list(_FakeSMTP.sent), calls


def _selftest():
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
    import io
    import contextlib
    as_of, cot, hist, deep, ana = fixtures()
    iso = as_of.isoformat()
    now = datetime(2026, 10, 16, 20, 5, tzinfo=timezone.utc)          # 4:05 PM ET Friday
    # the percentiles in the fixture are the ones the weekly record gives, recounted here
    for key, want in (("corn", 98.8), ("beans", 1.8), ("livecattle", 50.3), ("leanhogs", 99.4)):
        ok(recount(deep, key, iso) == want == ana["commodities"][key]["pctl"]["net_oi_all"], "%s recount %r" % (key, recount(deep, key, iso)))
    buf = io.StringIO()
    gaps = []
    with contextlib.redirect_stdout(buf):
        a, rel, rows = prepare(now, cot, hist, deep, ana, gaps)
    ok(a == as_of and rel == date(2026, 10, 16), "as of Tue Oct 13, released Fri Oct 16: %r %r" % (a, rel))
    ok([r["key"] for r in rows] == ["corn", "beans", "livecattle", "leanhogs"], [r["key"] for r in rows] if isinstance(rows, list) else rows)
    ok("Chicago wheat: data/cot-history.json does not end on this report" in buf.getvalue(), "a market whose files disagree is named and left out")
    ok(gaps == [("Chicago wheat", "the weekly files do not agree on this report yet"), ("Feeder cattle", "no position in this week's file")], gaps)
    R = {r["key"]: r for r in rows} if isinstance(rows, list) else {}
    c = R.get("corn") or {}
    ok(c.get("net") == 200000 and c.get("chg") == -60000 and c.get("chg_since") is None, "corn: net and the week's change %r" % c)
    # 1 year: lo -100,000, hi 300,000 -> (200,000 + 100,000) / 400,000 = 75%
    ok(c.get("y1") == {"lo": -100000, "hi": 300000, "pct": 75, "n": 52}, "corn 1-year range %r" % c.get("y1"))
    # 3 years: lo -250,000, hi 300,000 -> 450,000 / 550,000 = 81.8% -> 82%
    ok((c.get("y3") or {}).get("pct") == 82 and c["y3"]["lo"] == -250000 and c["y3"]["hi"] == 300000, "corn 3-year range %r" % c.get("y3"))
    ok(sentence(c) == "Managed money is net long 200,000 corn contracts, 60,000 fewer than the week before.", sentence(c))
    ok(rank_line(c) == "That is the 99th percentile of 171 weekly reports since 2023 (top 1%, crowded long).", rank_line(c))
    ok(note(c) == "If funds head for the exit, 200,000 contracts of selling sit between here and flat. Worth a look this week "
       "at unpriced bushels, or unbought needs if you are a buyer. Not a call on price.", note(c))
    ok(range_line(c) == "52-week range: net short 100,000 to net long 300,000.", range_line(c))
    ok(short_line(c) == "60,000 fewer than the week before. 99th percentile of 171 weeks since 2023 (top 1%, crowded long).", short_line(c))
    bn = R.get("beans") or {}
    # beans 1 yr: lo -60,000, hi 100,000 -> 20,000 / 160,000 = 12.5% -> 12% (round half to even)
    ok(bn.get("chg") == 5000 and (bn.get("y1") or {}).get("pct") == 12, "beans %r" % bn)
    # beans: net short 45,000 -> 40,000, the short 5,000 smaller: "fewer", never "up" under a short
    ok(sentence(bn) == "Managed money is net short 40,000 soybean contracts, 5,000 fewer than the week before.", sentence(bn))
    ok(rank_line(bn) == "That is the 2nd percentile of 171 weekly reports since 2023 (bottom 2%, crowded short)." and
       "40,000 contracts of buying" in (note(bn) or ""), (rank_line(bn), note(bn)))
    lc = R.get("livecattle") or {}
    ok(lc.get("net") == 85000 and lc.get("chg") == -85000, "cattle: 85,000, down 85,000 %r" % lc)
    ok(rank_line(lc) == "That is the 50th percentile of 171 weekly reports since 2023 (middling)." and note(lc) is None,
       "a middling market gets no marketing line: %r %r" % (rank_line(lc), note(lc)))
    hg = R.get("leanhogs") or {}
    ok(hg.get("chg") == 0 and (hg.get("y1") or {}).get("pct") == 0 and "unchanged from the week before" in sentence(hg), sentence(hg))
    ok(sentence(hg).startswith("Managed money is net long 10,000 lean hog contracts"), sentence(hg))
    ok(verdict(rows) == TESTED and own_tested(c, TESTED) is None, "one tested line for all")
    # a market whose test held up carries its own line
    a2 = json.loads(json.dumps(ana))
    a2["commodities"]["beans"]["crowd"].update(held=True, tested="One positioning reading held up.")
    with contextlib.redirect_stdout(io.StringIO()):
        r5 = prepare(now, cot, hist, deep, a2)[2]
    ok(verdict(r5) == TESTED and own_tested({r["key"]: r for r in r5}["beans"], TESTED) == "One positioning reading held up.", "held line")
    # a record is said as a record, never "100th"
    a3 = json.loads(json.dumps(ana))
    a3["commodities"]["corn"]["is_record_high"] = True
    with contextlib.redirect_stdout(io.StringIO()):
        r6 = {r["key"]: r for r in prepare(now, cot, hist, deep, a3)[2]}
    ok(rank_line(r6["corn"]) == "That is the biggest net long, as a share of open interest, in 171 weekly reports since 2023.", rank_line(r6["corn"]))
    ok(short_line(r6["corn"]).endswith("The biggest net long, as a share of open interest, in 171 weeks since 2023."), short_line(r6["corn"]))
    # TWO FILES MUST NEVER DISAGREE IN FRONT OF A READER: the ranking is withheld, with the reason
    for label, mut, why in (("an older ranking file", lambda x: x.update(date="2026-10-06"), "the ranking is not up to this report yet"),
                            ("a different net", lambda x: x.update(net=199999), "the ranking file and this week's position do not match"),
                            ("a ranking the record does not give", lambda x: x["pctl"].update(net_oi_all=97.0),
                             "the ranking did not check out against the weekly record")):
        a4 = json.loads(json.dumps(ana))
        mut(a4["commodities"]["corn"])
        with contextlib.redirect_stdout(io.StringIO()):
            r4 = {r["key"]: r for r in prepare(now, cot, hist, deep, a4)[2]}
        ok(r4["corn"]["rank"] is None and rank_line(r4["corn"]) == "No percentile this week: %s." % why and note(r4["corn"]) is None,
           "%s: %r" % (label, rank_line(r4["corn"])))
    # the change is "since <date>" when the report before is not a week back
    h2 = json.loads(json.dumps(hist))
    del h2["history"]["corn"][-2]
    c2 = json.loads(json.dumps(cot))
    c2["corn"]["prev"] = h2["history"]["corn"][-2]["net"]
    with contextlib.redirect_stdout(io.StringIO()):
        r2 = {r["key"]: r for r in prepare(now, c2, h2, deep, ana)[2]}
    ok(r2["corn"]["chg_since"] == date(2026, 9, 29) and sentence(r2["corn"]).endswith("150,000 more than on Sep 29."), sentence(r2["corn"]))
    # a short that grew, and a side that flipped
    ok(sentence(dict(bn, net=-50000, chg=-10000, chg_since=None)).endswith("net short 50,000 soybean contracts, 10,000 more than the week before."), "short grew")
    ok(sentence(dict(bn, net=-5000, chg=-15000, chg_since=None)).endswith("net short 5,000 soybean contracts, flipped from net long 10,000 the week before."), "flip")
    # a deep file that does not reach this report: no 3-year range, the ranking still from the analysis file
    d2 = json.loads(json.dumps(deep))
    for v in d2["commodities"].values():
        for f in ("dates", "mm_long", "mm_short", "oi"):
            v[f] = v[f][:-1]
    with contextlib.redirect_stdout(io.StringIO()):
        r3 = {r["key"]: r for r in prepare(now, cot, hist, d2, ana)[2]}
    ok(r3["corn"]["y3"] is None and r3["corn"]["y1"] and r3["corn"]["rank"]["shown"] == 99, "no 3-year range without the deep file")
    # stale, early, unreadable
    with contextlib.redirect_stdout(io.StringIO()):
        ok(prepare(datetime(2026, 10, 30, 20, 0, tzinfo=timezone.utc), cot, hist, deep, ana)[0] is None, "two weeks on: too old to send")
        ok(prepare(datetime(2026, 10, 30, 20, 0, tzinfo=timezone.utc), cot, hist, deep, ana, stale_ok=True)[0] == as_of, "a preview may show it")
        ok(prepare(datetime(2026, 10, 15, 20, 0, tzinfo=timezone.utc), cot, hist, deep, ana)[0] is None, "before Friday: not out yet")
        ok(prepare(now, {"report_date": "soon"}, hist, deep, ana)[0] is None, "no date: nothing")
    # the email
    s, t, h = compose(as_of, rel, rows, gaps)
    ok(s == "Funds this week: positions as of Oct 13", s)
    ok(compose(as_of, rel, rows, gaps, preview=True)[0] == "[Preview] Funds this week: positions as of Oct 13", "preview subject")
    ok("Positions as of Tuesday, October 13. CFTC released them Friday, October 16 at 3:30 PM ET." in t, t[:300])
    ok(t.index(TESTED) < t.index("CORN"), "the plain verdict comes before the numbers")
    ok("Source: CFTC Commitments of Traders, Disaggregated, futures only, report as of Oct 13, released Oct 16." in t, "source and dates")
    ok("CHICAGO WHEAT\nNo reading this week: the weekly files do not agree on this report yet." in t
       and "FEEDER CATTLE\nNo reading this week: no position in this week's file." in t, "a missing market is shown, with why")
    ok("—" not in t + h and "–" not in t + h and "&mdash;" not in h, "no em or en dash anywhere")
    ok(not re.search(r"\b(will|expect|likely|forecast|should|buy|sell)\b", t.lower().replace("not where prices go next", "")), "no prediction words")
    ok(t.count("Managed money is ") == 4, "one sentence a market")
    ok(t.count("Not a call on price.") == 3 and h.count("Not a call on price.") == 3, "a marketing line for the 3 off-middle markets only")
    ok(h.count("percentile of 171 weeks since 2023") == 4 and t.count("percentile of 171 weekly reports since 2023") == 4,
       "the sample beside every percentile, in both bodies")
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
        want = "https://agsist.com/e?a=notice-unsubscribe&k=" + L0 + "&t=" + email_links.token("sec", L0) + "&topic=cot"
        ok(email_links.unsub_web(m) == want and m["List-Unsubscribe-Post"] is None, m["List-Unsubscribe"])
        ok(want in m.get_body(("plain",)).get_content(), "the stop link stops this list only")
        _h, _t = m.get_body(("html",)).get_content(), m.get_body(("plain",)).get_content()
        ok(not [u for u in email_links.hrefs(_h) if "@" in u or "%40" in u.lower()], "no @ inside any href")
        ok(not email_links.bad_links(_t) and "@" not in email_links.unsub_web(m), "no address in any text link or the header link")
        ok(not email_links.SHARED_RE.search(_h + _t + str(m["List-Unsubscribe"])), "no workers.dev host anywhere")
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

    # ── the modes, with the list, the flag and the mail server mocked ──
    files = {"COT": cot, "HIST": hist, "DEEP": deep, "ANA": ana}
    LIST = [{"email": "jane.doe@farm.com", "lid": "abcdefghjkmnpqrs"}, {"email": "bob@ranch.net", "lid": "bcdefghjkmnpqrst"},
            {"email": "no.id@farm.com", "lid": None}]
    asked = []

    def fetch(b_, t_, topic):
        asked.append(topic)
        return [dict(r) for r in LIST]
    W = {"LIST_URL": "https://w.dev", "LIST_TOKEN": "tok", "UNSUB_SECRET": "sec"}
    SM = {"SMTP_HOST": "smtp.example.com", "SMTP_PORT": "587", "SMTP_USER": "u@example.com", "SMTP_PASS": "pw",
          "FROM_ADDR": "sender@agsist.com"}

    def private(log):
        return "jane" not in log and "farm.com" not in log and "ranch" not in log and "sig@" not in log

    # 1. the default is a dry run: secrets all set, nothing sent, no flag touched
    rc, log, sent, calls = _run(files, dict(W, **SM), now, fetch)
    ok(rc == 0 and not sent and not _FakeSMTP.made and not calls and "dry run complete" in log, "dry by default: %r %r" % (rc, log[-300:]))
    ok(asked == ["cot"] and "would send to 2 reader(s)" in log and "list: 2 reader(s) on Funds this week" in log, log[-400:])
    ok("1 reader(s) had no link id this run and are not mailed" in log, "a reader without a link id is skipped, by count")
    ok(private(log) and "a=notice-unsubscribe&k=" + email_links.SAMPLE_LID in log and "%40" not in log, "the dry run log has no address")
    # 2. DRY_RUN=1 beats SEND=1
    rc, log, sent, calls = _run(files, dict(W, SEND="1", DRY_RUN="1", **SM), now, fetch)
    ok(rc == 0 and not sent and not calls and "dry run complete" in log, "DRY_RUN wins")
    # 3. SEND=1: the two readers with a link id, each with their own stop link; the week flagged once
    rc, log, sent, calls = _run(files, dict(W, SEND="1", **SM), now, fetch)
    ok(rc == 0 and sorted(x["To"] for x in sent) == ["bob@ranch.net", "jane.doe@farm.com"], "send: %r %r" % (rc, [x["To"] for x in sent]))
    ok(calls == [("get", "cot:2026-10-13"), ("set", "cot:2026-10-13")], "flag read before, set after: %r" % calls)
    ok(all(x["Reply-To"] == "news@agsist.com" for x in sent), "Reply-To news@ by default")
    for x in sent:
        lid = {"jane.doe@farm.com": "abcdefghjkmnpqrs", "bob@ranch.net": "bcdefghjkmnpqrst"}[x["To"]]
        u = "https://agsist.com/e?a=notice-unsubscribe&k=" + lid + "&t=" + email_links.token("sec", lid) + "&topic=cot"
        ok(email_links.unsub_web(x) == u and u in x.get_body(("plain",)).get_content(), "own stop link, front door")
        ok(x["Subject"] == "Funds this week: positions as of Oct 13", x["Subject"])
    ok(private(log) and "sent 2/2" in log, "send log: counts only %r" % log[-300:])
    # 4. the week already sent: nothing
    rc, log, sent, calls = _run(files, dict(W, SEND="1", **SM), now, fetch, flags={"cot:2026-10-13": True})
    ok(rc == 0 and not sent and "already sent" in log, "a second run sends nothing")
    # 5. the flag cannot be read: refuse
    rc, log, sent, calls = _run(files, dict(W, SEND="1", **SM), now, fetch, flags={"unreachable": True})
    ok(rc == 1 and not sent and not _FakeSMTP.made, "no flag, no send")
    # 6. no worker: no send
    rc, log, sent, calls = _run(files, dict(SEND="1", **SM), now, fetch)
    ok(rc == 1 and not sent, "no LIST_URL, no send")
    # 7. the week is too old: a send refuses it
    late = datetime(2026, 10, 30, 20, 0, tzinfo=timezone.utc)
    rc, log, sent, calls = _run(files, dict(W, SEND="1", **SM), late, fetch)
    ok(rc == 0 and not sent and "too old" in log, "a stale send sends nothing")
    # 8. PREVIEW=1: Sig only, even for an older report; the list and the flag untouched
    rc, log, sent, calls = _run(files, dict(W, PREVIEW="1", SIG_TO="sig@example.org", **SM), late, fetch)
    ok(rc == 0 and [x["To"] for x in sent] == ["sig@example.org"] and not calls, "preview: %r %r %r" % (rc, [x["To"] for x in sent], calls))
    ok(sent and sent[0]["Subject"].startswith("[Preview] ") and private(log) and "the list gets nothing" in log, "preview subject, log")
    rc, log, sent, calls = _run(files, dict(W, PREVIEW="1", SIG_TEST_EMAILS="a@example.org, b@example.org", SIG_TO="sig@example.org", **SM), now, fetch)
    ok([x["To"] for x in sent] == ["a@example.org", "b@example.org"] and not calls, "SIG_TEST_EMAILS before SIG_TO")
    # 9. a preview with nobody to send to: refuse, the list never stands in
    rc, log, sent, calls = _run(files, dict(W, PREVIEW="1", **SM), now, fetch)
    ok(rc == 1 and not sent, "preview needs SIG_TO")
    # 10. a list that cannot be read: a send stops, a preview goes on
    def broken(*a_):
        raise OSError("down")
    rc, log, sent, calls = _run(files, dict(W, SEND="1", **SM), now, broken)
    ok(rc == 1 and not sent, "send: no list, no mail")
    rc, log, sent, calls = _run(files, dict(W, PREVIEW="1", SIG_TO="sig@example.org", **SM), now, broken)
    ok(rc == 0 and len(sent) == 1, "preview: no list still previews")
    ok(re.match(r"^[\w:.-]{1,64}$", flag_key(as_of)) and flag_key(as_of) == "cot:2026-10-13", "flag key fits the worker's pattern")
    if fails:
        for f in fails:
            print("FAIL", f)
        return 1
    print("send_cot_weekly selftest ok")
    return 0


def render(path, live=False):
    """The email as html (and the plain text beside it, path + .txt), for a
    screenshot. From the fixtures, or with live, from the repo's own COT files
    as on their release day (nothing is sent, no list is read)."""
    import contextlib
    if live:
        cot, hist, deep, ana = load(COT), load(HIST), load(DEEP), load(ANA)
        a = as_of_date(cot)
        rel = released_on(a) or a
        now = datetime(rel.year, rel.month, rel.day, 21, 0, tzinfo=timezone.utc)
    else:
        _, cot, hist, deep, ana = fixtures()
        now = datetime(2026, 10, 16, 20, 5, tzinfo=timezone.utc)
    gaps = []
    with open(os.devnull, "w") as dn, contextlib.redirect_stdout(dn):
        a, rel, rows = prepare(now, cot, hist, deep, ana, gaps)
    if not a:
        print("nothing to render: " + str(rows))
        return 1
    m = build_email(a.isoformat(), compose(a, rel, rows, gaps), "reader@example.com", "AGSIST", "sender@example.com", REPLY_DEFAULT)
    Path(path).write_text(m.get_body(("html",)).get_content(), encoding="utf-8")
    Path(str(path) + ".txt").write_text("Subject: " + str(m["Subject"]) + "\n\n" + m.get_body(("plain",)).get_content(), encoding="utf-8")
    print("wrote " + str(path))
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    if "--render" in sys.argv:
        sys.exit(render(sys.argv[sys.argv.index("--render") + 1], live="--live" in sys.argv))
    sys.exit(list_source.guard(lambda: main(sys.argv[1:]), soft=False))
