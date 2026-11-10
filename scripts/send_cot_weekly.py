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
  * the /cot page's one rank, in words: managed-money net as a share of open
    interest against every week since 2010 (data/cot-analysis.json
    crowd.words / crowd.record, the fields the page's answer line prints),
    and the 52-week range (data/cot-history.json), labelled a range;
  * a news subject, a hidden preview line and a "This week" lead, computed
    from the same files: a record, a run of selling or buying counted from
    data/cot-history.json, the biggest move as a share of open interest.
Plus the date the positions are as of (a Tuesday), the day and time CFTC
released them and the next report (scripts/cot_calendar.py, 3:30 PM ET) and a link to /cot.
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
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
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
import delivery_line      # noqa: E402  (the DELIVERY count line cron_health reads)
TALLY = None  # set in __main__ only (never by a selftest): delivery_line's per-run counts
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
# One tag convention for every COT kit asset (kit v2 part 2): utm_source share|print|email, utm_medium
# picture|sheet|qr|forward|email, utm_campaign cot. The forward line says forward, so a neighbor's visit is told
# apart from the reader's own.
SRC_TAG = "utm_source=email&utm_medium="
TAG = SRC_TAG + "email&utm_campaign=cot"
PAGE = "https://agsist.com/cot?" + TAG
FORWARD_URL = "https://agsist.com/cot?ref=email-forward&" + SRC_TAG + "forward&utm_campaign=cot#cot-signup"   # lands on the signup box (Sig, Nov 6)
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
    """[{key, name, net, chg, chg_since, y1, side, oi, streak, rank, rank_why}] for each
    market the files carry for this report. y1 = {lo, hi, pct, n} or
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
            gaps.append((name, "no position in this report's file"))
            continue
        h = [r for r in (H.get(key) or []) if isinstance(r, dict) and n0(r.get("net")) and r.get("date")]
        if not h or h[-1]["date"] != iso or h[-1]["net"] != c["net"]:
            print("%s: data/cot-history.json does not end on this report (%s); left out" % (name, iso))
            gaps.append((name, "the weekly files do not agree on this report yet"))
            continue
        row = {"key": key, "name": name, "net": c["net"], "chg": None, "chg_since": None, "y1": None,
               "side": c.get("side") if c.get("side") in ("long", "short", "flat") else None,
               "oi": h[-1].get("oi") if n0(h[-1].get("oi")) and h[-1]["oi"] > 0 else None}
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
        # the run of same-way weekly changes ending this week, from consecutive weekly reports
        run, j = 0, len(h) - 1
        while j >= 1 and row["chg"]:
            try:
                gap = (date.fromisoformat(h[j]["date"]) - date.fromisoformat(h[j - 1]["date"])).days
            except ValueError:
                break
            dj = h[j]["net"] - h[j - 1]["net"]
            if gap != 7 or not dj or (dj > 0) != (row["chg"] > 0):
                break
            run, j = run + 1, j - 1
        row["streak"], row["streak_open"] = run, (run > 0 and j == 0)
        row["rank"], row["rank_why"] = rank_of(key, c["net"], iso, ana, deep)
        row["how"], row["how_why"] = how_of(key, iso, ana, h)
        out.append(row)
    return out


def how_of(key, iso, ana, h):
    """(line, why). How the net changed, split into longs and shorts: the line
    scripts/cot_analysis.py how_changed() wrote into data/cot-analysis.json
    (commodities.<key>.card.how), the field /cot prints, never worked out a
    second way here. Withheld, with the reason, when that file is not on this
    report, when either week in data/cot-history.json lacks a long or a short
    count, or when the two files disagree on either side's change."""
    a = ((ana or {}).get("commodities") or {}).get(key) or {}
    hw = (a.get("card") or {}).get("how") or {}
    if a.get("date") != iso:
        return None, "the long and short split is not up to this report yet"
    if not hw.get("line"):
        return None, hw.get("withheld") or "no long and short split for this report"
    if len(h) < 2 or not all(n0(r.get(x)) for r in h[-2:] for x in ("long", "short")):
        return None, "a week without both long and short counts"
    if (h[-1]["long"] - h[-2]["long"] != hw.get("long_change") or h[-1]["short"] - h[-2]["short"] != hw.get("short_change")
            or a.get("mm_long") != h[-1]["long"] or a.get("mm_short") != h[-1]["short"]):
        print("%s: the long and short split does not match data/cot-history.json; withheld" % key)
        return None, "the weekly files disagree on the long and short split"
    return hw["line"], None


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


def _rank_words(p, net, crowded, since):
    import cot_analysis    # the function the page's crowd.words comes from
    return cot_analysis.rank_words(p, net, crowded, since)


def _record_words(a):
    import cot_analysis
    return cot_analysis.record_words(a)


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
        return None, "the ranking file and this report's position do not match"
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
            # the page's own words (cot_analysis.rank_words / record_words), the answer line's fields
            "words": cr.get("words") or _rank_words(p, net, cr.get("crowded"), cr.get("since") or str(a.get("first_week") or "")[:4]),
            "record": cr.get("record") if "record" in cr else _record_words(a)}, None


def change(r):
    """The week's move in the position on its own side, or None. Kept for
    daily_more.py (sentence() below), which writes the Saturday and Monday
    Daily's fund lines; the email itself says what funds did (did_words)."""
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
    """What the funds hold and what they did, in one sentence (daily_more.py)."""
    ch = change(r)
    return "Managed money is %s %s contracts%s." % (side(r["net"]), NOUN[r["key"]], (", " + ch) if ch else "")


# ── the email's words (Nov 6, Sig: "make sure the COT email is very very good") ──
# One rank, the /cot page's: managed-money net as a share of open interest, ranked
# against every week since the record starts, in words (data/cot-analysis.json
# crowd.words, the field the page's answer line prints). No ordinals, no second
# span, no advice: what the funds did and where that leaves them.
SHORT = {"corn": "corn", "beans": "soybeans", "wheat": "Chicago wheat", "livecattle": "live cattle",
         "feedercattle": "feeder cattle", "leanhogs": "lean hogs"}


def held_words(r):
    """'net long 81,113', or 'about even (net short 517)' inside the flat band."""
    if r.get("side") == "flat" and r["net"]:
        return "about even (%s)" % side(r["net"])
    return side(r["net"])


def did(r):
    """'sold' / 'bought' / 'held' for the week, from the change."""
    if r["chg"] is None:
        return None
    return "held" if r["chg"] == 0 else ("bought" if r["chg"] > 0 else "sold")


def rank_words(r):
    """'higher than 48% of weeks since 2010 (share of open interest)', or None."""
    k = r.get("rank")
    return (k["words"] + " (share of open interest)") if k and k.get("words") else None


def market_line(r):
    """One plain sentence per market, the /cot answer line's shape: what funds did,
    where that leaves them, a record with its measure, the rank in words."""
    s = did_line(r)
    k = r.get("rank")
    if k and k.get("record"):
        s += ", " + k["record"]
    rw = rank_words(r)
    if rw:
        return s + ": " + rw + "."
    return s + ". No rank for this report: %s." % (r.get("rank_why") or "no long-run rank")


def did_line(r):
    """What funds did and where that leaves them, no period (market_line's start; the
    lead story's evidence under the headline)."""
    noun, held = NOUN[r["key"]], held_words(r)
    since = "" if r["chg_since"] is None else " since the %s report" % md(r["chg_since"])
    d = did(r)
    if d is None:
        s = "Funds are %s %s contracts" % (held, noun)
    elif d == "held":
        s = "Funds held steady%s at %s %s contracts" % (since, held, noun)
    else:
        prev = r["net"] - r["chg"]
        flip = r["net"] and prev and (r["net"] > 0) != (prev > 0) and r.get("side") != "flat"
        s = "Funds %s a net %s %s contracts%s, %s them %s" % (
            d, comma(r["chg"]), noun, since, "flipping" if flip else "leaving", held)
    return s


def streak_line(r):
    """'Funds have sold 6 weeks in a row.' from data/cot-history.json, 3 weeks or more."""
    n = r.get("streak") or 0
    if n < 3 or not r["chg"]:
        return ""
    return "Funds have %s %s%d weeks in a row." % ("bought" if r["chg"] > 0 else "sold",
                                                 "at least " if r.get("streak_open") else "", n)


def range_line(r):
    if not r["y1"]:
        return ""
    return "%d-week range: %s to %s." % (r["y1"]["n"], side(r["y1"]["lo"]), side(r["y1"]["hi"]))


def _join(xs):
    xs = list(xs)
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1]


def moved(rows):
    """The week's biggest move as a share of open interest, or None."""
    m = [r for r in rows if r["chg"] and r.get("oi")]
    return max(m, key=lambda r: abs(r["chg"]) / r["oi"]) if m else None


def stories(rows):
    """[(subject, sentence, row)] newest news first: a record (with its measure and
    start year), then the longest run of selling or buying (3 weeks or more),
    then the biggest move as a share of open interest, with that share shown
    (kit v2: the measure is never named without its number). Computed, never typed in."""
    out = []
    for r in rows:
        k = r.get("rank") or {}
        if k.get("record"):
            rec = k["record"][4:] if k["record"].startswith("the ") else k["record"]
            out.append(("%s: %s" % (r["name"], rec), "%s: %s." % (r["name"], k["record"]), r))
    runs = sorted((r for r in rows if streak_line(r)), key=lambda r: (-r["streak"], -abs(r["chg"]) / (r.get("oi") or 1)))
    for r in runs[:2]:
        v = "sold" if r["chg"] < 0 else "bought"
        n = ("%d+" if r.get("streak_open") else "%d") % r["streak"]
        out.append(("Funds %s %s %s weeks in a row" % (v, SHORT[r["key"]], n),
                    "Funds %s %s %s weeks in a row, %s contracts in the latest report." % (v, SHORT[r["key"]], n, comma(r["chg"])), r))
    b = moved(rows)
    if b and b not in runs[:2]:
        v = "sold" if b["chg"] < 0 else "bought"
        out.append(("Funds %s %s %s contracts" % (v, comma(b["chg"]), NOUN[b["key"]]),
                    "Funds %s %s %s contracts, %s%% of open interest, the biggest move by that measure."
                    % (v, comma(b["chg"]), NOUN[b["key"]], ("%.1f" % (abs(b["chg"]) * 100.0 / b["oi"]))), b))
    return out


def subject_of(as_of, rows, preview=False):
    """The news in under 60 characters when it fits, else the first story alone."""
    st = stories(rows)
    if not st:
        s = "Funds: week to %s, %d" % (md(as_of), as_of.year)
    else:
        s = st[0][0]
        if len(st) > 1 and len(s) + 2 + len(st[1][0]) <= 60:
            s += "; " + st[1][0][0].lower() + st[1][0][1:] if st[1][0].startswith("Funds") else "; " + st[1][0]
    return ("[Preview] " if preview else "") + s


def preheader(rows):
    """The hidden preview line: the stories the subject did not carry."""
    st = stories(rows)
    return " ".join(x[1] for x in st[1:3]) if len(st) > 1 else ""


def lead(as_of, rows):
    """The one-sentence lead: what managed money did across the markets, in the week with its year."""
    sold = [SHORT[r["key"]] for r in rows if r["chg"] and r["chg"] < 0]
    bought = [SHORT[r["key"]] for r in rows if r["chg"] and r["chg"] > 0]
    held = [SHORT[r["key"]] for r in rows if r["chg"] == 0]
    parts = (["sold " + _join(sold)] if sold else []) + (["bought " + _join(bought)] if bought else []) + \
            (["held " + _join(held) + " steady"] if held else [])
    if not parts:
        return ""
    return "Funds %s in the week to %s, %s, %d." % (" and ".join(parts), as_of.strftime("%A"), md(as_of), as_of.year)


def next_report(as_of):
    """'Next report: Monday Nov 16, 3:30 PM ET (moved from Friday).' from
    scripts/cot_calendar.py, holiday-aware; '' when a shutdown leaves it unknown."""
    nxt = as_of + timedelta(days=7)
    if cot_calendar.release_unknown(nxt):
        return ""
    d = cot_calendar.release_date(nxt)
    return "Next report: %s %s %d, %s%s." % (d.strftime("%A"), d.strftime("%b"), d.day, RELEASE_TIME,
                                              " (moved from Friday)" if d.weekday() != 4 else "")


def compose(as_of, released, rows, gaps=(), preview=False):
    """(subject, text, html), the same for every reader but the footer."""
    subject = subject_of(as_of, rows, preview)
    pre = preheader(rows)
    full = lambda d: "%s, %s %d, %d" % (d.strftime("%a"), d.strftime("%b"), d.day, d.year)
    when = "Week to %s." % full(as_of) + (" Released %s, %s." % (full(released), RELEASE_TIME) if released else "")
    since = sorted({r["rank"]["since"] for r in rows if r.get("rank")})
    span = ("every week since " + since[0]) if len(since) == 1 else "every week on record"
    intro = ("\"Funds\" here is managed money, CFTC's name for hedge funds and commodity trading advisers. Each rank "
             "compares their net, as a share of open interest, with %s, as the COT page does." % span)
    src = ("Source: CFTC Commitments of Traders, Disaggregated, futures only, report as of %s%s. Ranks and "
           "ranges are figured by AGSIST from those weekly reports. This is where the funds stood, not where prices go next."
           % (full(as_of), (", released " + full(released)) if released else ""))
    nr = next_report(as_of)
    ld = lead(as_of, rows)
    kick = "AGSIST · FUNDS · WEEK TO %s %d, %d" % (as_of.strftime("%b").upper(), as_of.day, as_of.year)
    st = stories(rows)
    top = st[0][2] if st else None
    ev = [did_line(top) + "."] + [x for x in (streak_line(top),) if x] if top else []
    L = [kick, ""] + ev + ([""] if ev else []) + ([ld, ""] if ld else []) + [when, intro]
    for r in rows:
        L += ["", r["name"].upper(), market_line(r)]
        L += [x for x in (r.get("how"), streak_line(r), range_line(r)) if x]
    for name, why in gaps:
        L += ["", name.upper(), "No reading for this report: %s." % why]
    L += ["", src] + ([nr] if nr else []) + ["Every market, the history and how it is figured: " + PAGE]
    text = "\n".join(L)

    def esc(s):
        return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    INK, MUTED, LINE, GOLD, BG = "#161a18", "#55605b", "#e3e7e2", "#8a6b1f", "#f6f7f5"
    SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
    P = '<p style="margin:%s;font:%s;color:%s">%s</p>'
    head = subject[len("[Preview] "):] if preview else subject
    parts = []
    if pre:
        parts.append('<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;'
                     'color:%s;opacity:0">%s%s</div>' % (BG, esc(pre), "&#8199;&#847;" * 40))
    parts += [P % ("0 0 8px", "700 12px/1.4 ui-monospace,Menlo,Consolas,monospace", GOLD,
                   '<span style="letter-spacing:.12em">' + esc(kick) + '</span>'),
              P % ("0 0 10px", "700 24px/1.25 Georgia,'Times New Roman',serif", INK, esc(head))]
    # the lead story's evidence right under its headline (kit v2)
    for i, x in enumerate(ev):
        parts.append(P % ("0 0 %s" % ("10px" if i == len(ev) - 1 else "4px"), ("700 " if i else "") + "16px/1.5 " + SANS, INK,
                          ("<b>%s:</b> " % esc(top["name"]) if i == 0 else "") + esc(x)))
    if ld:
        parts.append(P % ("0 0 10px", "16px/1.5 " + SANS, INK, esc(ld)))
    parts.append(P % ("0 0 4px", "14px/1.5 " + SANS, MUTED, esc(when)))
    parts.append(P % ("0 0 6px", "13px/1.5 " + SANS, MUTED, esc(intro)))
    for r in rows:
        d = did(r)
        color = {"sold": "#a63f28", "bought": "#276b43"}.get(d, MUTED)
        chip = ""
        if d in ("sold", "bought"):
            chip = ('<span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:10px;'
                    'background:%s;color:#fff;font:700 13px/1.5 %s;vertical-align:middle">%s %s %s</span>'
                    % (color, SANS, "&#9660;" if d == "sold" else "&#9650;", d, comma(r["chg"])))
        parts.append('<div style="margin:16px 0 0;padding:14px 0 0;border-top:1px solid %s">' % LINE)
        parts.append(P % ("0 0 2px", "700 12px/1.4 " + SANS, MUTED, '<span style="letter-spacing:.08em">'
                          + esc(r["name"].upper()) + "</span>"))
        parts.append(P % ("0 0 6px", "800 26px/1.2 " + SANS, INK, esc(held_words(r)) + chip))
        parts.append(P % ("0 0 4px", "16px/1.5 " + SANS, INK, esc(market_line(r))))
        if r.get("how"):
            parts.append(P % ("0 0 4px", "15px/1.5 " + SANS, INK, esc(r["how"])))
        sl = streak_line(r)
        if sl:
            parts.append(P % ("0 0 4px", "700 15px/1.45 " + SANS, color, esc(sl)))
        if r["y1"]:
            parts.append(range_bar(r))
        parts.append("</div>")
    for name, why in gaps:
        parts.append('<div style="margin:16px 0 0;padding:14px 0 0;border-top:1px solid %s">' % LINE
                     + P % ("0", "15px/1.5 " + SANS, MUTED, "<b>" + esc(name.upper()) + "</b><br>No reading for this report: "
                            + esc(why) + ".") + "</div>")
    parts.append(P % ("20px 0 0", "13px/1.5 " + SANS, MUTED, esc(src)))
    if nr:
        parts.append(P % ("10px 0 0", "700 15px/1.5 " + SANS, INK, esc(nr)))
    parts.append('<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0"><tr>'
                 '<td style="background:#d4a23f;border-radius:6px"><a href="%s" style="display:inline-block;padding:12px 20px;'
                 'font:700 16px/1.2 %s;color:#161a18;text-decoration:none">Every market on agsist.com/cot</a></td></tr></table>'
                 % (PAGE.replace("&", "&amp;"), SANS))
    html = ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>%s</title></head>'
            '<body style="margin:0;padding:0;background:%s">'
            '<div style="max-width:600px;margin:0 auto;padding:12px 8px">'
            '<div style="background:#ffffff;border-radius:10px;padding:22px 18px">%s{{FOOT}}</div></div></body></html>'
            % (esc(subject), BG, "".join(parts)))
    return subject, text, html


def range_bar(r):
    """The 52-week range drawn: where this week's net sits between the most short
    and the most long of the span, the ends labelled. A range, not a rank."""
    y = r["y1"]
    p = max(0, min(100, y["pct"]))
    SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
    left = '<td style="width:%d%%;height:8px;background:#e9dfc6;font-size:0;line-height:0">&nbsp;</td>' % p if p > 0 else ""
    right = '<td style="height:8px;background:#eef0ed;font-size:0;line-height:0">&nbsp;</td>' if p < 100 else ""
    mark = '<td style="width:5px;height:14px;background:#161a18;font-size:0;line-height:0">&nbsp;</td>'
    return ('<p style="margin:6px 0 3px;font:12px/1.4 %s;color:#55605b">%d-week range</p>'
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">'
            '<tr>%s%s%s</tr></table>'
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:3px">'
            '<tr><td style="font:12px/1.4 %s;color:#55605b">%s</td><td style="font:12px/1.4 %s;color:#55605b;text-align:right">%s</td></tr></table>'
            % (SANS, y["n"], left, mark, right, SANS, side(y["lo"]), SANS, side(y["hi"])))


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
    foot_t = ["", "Share with a farmer or your grain buyer. They can sign up free at " + FORWARD_URL, "",
              "You get this because you asked for Funds this week on agsist.com.",
              ("Stop Funds this week (nothing else changes): " + uurl) if uurl else "To stop it, reply with subject line: unsubscribe",
              "PO Box 243, Chetek, WI 54728"]
    msg.set_content(text + "\n" + "\n".join(foot_t) + "\n")
    foot_h = ('<p style="margin:16px 0 0;font:14px/1.5 sans-serif;color:#6b6b6b">Share with a farmer or your grain buyer. They can sign up free at '
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


def deep_problem(path=None):
    """Why the twenty-year file cannot be used, or None. data/cot-deep.json is on the
    private raw branch since Nov 4, 2026: a job that did not unpack it has no file, and
    load() reads that as None, which drops the twenty-year lines without a word. A send to
    the list refuses instead (a dry run or a preview still renders, as before)."""
    path = Path(path or DEEP)
    if not path.is_file():
        return "%s is missing (unpack it: bash scripts/pull_raw.sh data/cot-deep.json)" % path.name
    d = load(path)
    if not isinstance(d, dict) or not isinstance(d.get("commodities"), dict) or not d["commodities"]:
        return "%s is unreadable or has no commodities" % path.name
    return None


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
    tally = TALLY or delivery_line.Tally("funds-weekly")   # an unregistered tally prints nothing
    tally.dry = mode != "send"
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
    print("list: Funds this week read")
    tally.waiting = len(recipients)
    if mode == "send":
        # Nov 4 (fx/datasplit): never mail the list without the twenty-year file. The
        # DELIVERY line then reads dry=0 with readers waiting and none sent, which the
        # delivery check marks red (delivery_check.py rule f).
        why = deep_problem()
        if why:
            print("::error::FATAL: %s; Funds this week not sent to the list" % why)
            return 1
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
        print("would send to the Funds this week list")
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
    tally.sent = 0 if tally.dry else sent   # the DELIVERY count (delivery_line.py); a test to Sig is dry
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
    # beans: bought 3 weeks in a row (-55,000, -50,000, -45,000, -40,000)
    beans = series(lambda i, back: {0: -40000, 1: -45000, 2: -50000, 3: -55000, 20: 100000, 30: -60000}.get(back, 0))
    hogs = series(lambda i, back: 10000 if back in (0, 1) else 30000 if back == 5 else 10000)
    # live cattle: 1,000 x (86 i mod 171), every value 0 to 170,000 once; this week (i = 170) 85,000, last week 170,000
    cattle = series(lambda i, back: 1000 * ((86 * i) % 171))
    deep = {"commodities": {}}
    hist = {"history": {}}
    cot = {"report_date": "October 13, 2026"}
    for key, s in (("corn", corn), ("beans", beans), ("livecattle", cattle), ("leanhogs", hogs)):
        deep["commodities"][key] = {"dates": dates, "mm_long": [max(v, 0) + 1000 for v in s],
                                    "mm_short": [max(-v, 0) + 1000 for v in s], "oi": [1000000] * len(dates)}
        hist["history"][key] = [{"date": d, "net": v, "long": max(v, 0) + 1000, "short": max(-v, 0) + 1000, "oi": 1000000}
                                for d, v in zip(dates[-52:], s[-52:])]
        cot[key] = {"net": s[-1], "prev": s[-2]}
    # wheat: in cot.json, but its history ends a week early -> no reading, said so
    cot["wheat"] = {"net": -5, "prev": -4}
    hist["history"]["wheat"] = [{"date": d, "net": -5} for d in dates[-53:-1]]
    # feeder cattle: not in cot.json at all -> no reading, said so

    def a(key, net, pctl, shown, word, crowded):
        import cot_analysis    # the card's long and short split, from the one function that figures it
        L, S = deep["commodities"][key]["mm_long"], deep["commodities"][key]["mm_short"]
        return {"date": as_of.isoformat(), "net": net, "first_week": dates[0], "weeks_of_history": 171,
                "mm_long": L[-1], "mm_short": S[-1], "card": {"how": cot_analysis.how_changed(L[-2], S[-2], L[-1], S[-1])},
                "is_record_high": False, "is_record_low": False, "pctl": {"net_oi_all": pctl},
                "crowd": {"pctl": pctl, "shown": shown, "word": word, "crowded": crowded, "since": dates[0][:4],
                          "weeks": 171, "held": False, "tested": TESTED,
                          "words": _rank_words(pctl, net, crowded, dates[0][:4]), "record": None}}
    ana = {"commodities": {
        # corn 200,000: 169 of 171 weeks at or below (all but 260,000 and 300,000) = 98.83 -> 98.8; crowded long; shown 99
        "corn": a("corn", 200000, 98.8, 99, "top 1%", "long"),
        # beans -40,000: 5 of 171 at or below (-40k, -45k, -50k, -55k, -60k) = 2.92 -> 2.9; crowded short; shown 3
        "beans": a("beans", -40000, 2.9, 3, "bottom 3%", "short"),
        # cattle 85,000: 86 of 171 (0 to 85,000) = 50.29 -> 50.3; middling; shown 50
        "livecattle": a("livecattle", 85000, 50.3, 50, "middling", None),
        # hogs 10,000: 170 of 171 (all but 30,000) = 99.42 -> 99.4; crowded long; shown 99
        "leanhogs": a("leanhogs", 10000, 99.4, 99, "top 1%", "long"),
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
    def esc_h(x):
        return str(x).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
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
    for key, want in (("corn", 98.8), ("beans", 2.9), ("livecattle", 50.3), ("leanhogs", 99.4)):
        ok(recount(deep, key, iso) == want == ana["commodities"][key]["pctl"]["net_oi_all"], "%s recount %r" % (key, recount(deep, key, iso)))
    buf = io.StringIO()
    gaps = []
    with contextlib.redirect_stdout(buf):
        a, rel, rows = prepare(now, cot, hist, deep, ana, gaps)
    ok(a == as_of and rel == date(2026, 10, 16), "as of Tue Oct 13, released Fri Oct 16: %r %r" % (a, rel))
    ok([r["key"] for r in rows] == ["corn", "beans", "livecattle", "leanhogs"], [r["key"] for r in rows] if isinstance(rows, list) else rows)
    ok("Chicago wheat: data/cot-history.json does not end on this report" in buf.getvalue(), "a market whose files disagree is named and left out")
    ok(gaps == [("Chicago wheat", "the weekly files do not agree on this report yet"), ("Feeder cattle", "no position in this report's file")], gaps)
    R = {r["key"]: r for r in rows} if isinstance(rows, list) else {}
    c = R.get("corn") or {}
    ok(c.get("net") == 200000 and c.get("chg") == -60000 and c.get("chg_since") is None, "corn: net and the week's change %r" % c)
    # 1 year: lo -100,000, hi 300,000 -> (200,000 + 100,000) / 400,000 = 75%
    ok(c.get("y1") == {"lo": -100000, "hi": 300000, "pct": 75, "n": 52}, "corn 1-year range %r" % c.get("y1"))
    ok("y3" not in c, "no three-year span: one rank, the page's")
    # the rank words are the page's own (data/cot-analysis.json crowd.words, cot_analysis.rank_words)
    ok(c["rank"]["words"] == "higher than 99% of weeks since 2023", c.get("rank"))
    ok(market_line(c) == "Funds sold a net 60,000 corn contracts, leaving them net long 200,000: "
       "higher than 99% of weeks since 2023 (share of open interest).", market_line(c))
    ok(range_line(c) == "52-week range: net short 100,000 to net long 300,000.", range_line(c))
    ok(c["streak"] == 1 and streak_line(c) == "", "corn: one week of selling is no run %r" % c.get("streak"))
    ok(sentence(c) == "Managed money is net long 200,000 corn contracts, 60,000 fewer than the week before.", "daily_more's line kept")
    bn = R.get("beans") or {}
    # beans 1 yr: lo -60,000, hi 100,000 -> 20,000 / 160,000 = 12.5% -> 12% (round half to even)
    ok(bn.get("chg") == 5000 and (bn.get("y1") or {}).get("pct") == 12, "beans %r" % bn)
    # beans: -55,000 -> -50,000 -> -45,000 -> -40,000, three weekly rises, counted from cot-history
    ok(bn.get("streak") == 3 and not bn.get("streak_open") and streak_line(bn) == "Funds have bought 3 weeks in a row.", bn.get("streak"))
    # a short counts from the other end: 2.9 at or below -> shown 3 -> bigger than 97%
    ok(market_line(bn) == "Funds bought a net 5,000 soybean contracts, leaving them net short 40,000: "
       "a bigger net short than 97% of weeks since 2023 (share of open interest).", market_line(bn))
    lc = R.get("livecattle") or {}
    ok(lc.get("net") == 85000 and lc.get("chg") == -85000 and lc.get("oi") == 1000000, "cattle: 85,000, down 85,000 %r" % lc)
    ok(market_line(lc).endswith("leaving them net long 85,000: higher than 50% of weeks since 2023 (share of open interest)."), market_line(lc))
    hg = R.get("leanhogs") or {}
    ok(hg.get("chg") == 0 and (hg.get("y1") or {}).get("pct") == 0 and streak_line(hg) == "", hg)
    ok(market_line(hg) == "Funds held steady at net long 10,000 lean hog contracts: higher than 99% of weeks since 2023 "
       "(share of open interest).", market_line(hg))
    # the news: biggest move as a share of open interest (cattle 85,000 / 1,000,000), the run of buying first
    ok(moved(rows) is lc, "biggest move: cattle")
    ok(subject_of(as_of, rows) == "Funds bought soybeans 3 weeks in a row", subject_of(as_of, rows))
    ok(preheader(rows) == "Funds sold 85,000 live cattle contracts, 8.5% of open interest, the biggest move by that measure.", preheader(rows))
    ok(lead(as_of, rows) == "Funds sold corn and live cattle and bought soybeans and held lean hogs steady in the week to "
       "Tuesday, Oct 13, 2026.", lead(as_of, rows))
    ok("biggest move" not in lead(as_of, rows), "the lead names no measure it does not show")
    # a record is said with its measure and start year, never "100th", and leads the subject
    a3 = json.loads(json.dumps(ana))
    a3["commodities"]["corn"]["is_record_high"] = True
    del a3["commodities"]["corn"]["crowd"]["record"]
    with contextlib.redirect_stdout(io.StringIO()):
        r6l = prepare(now, cot, hist, deep, a3)[2]
    r6 = {r["key"]: r for r in r6l}
    ok(market_line(r6["corn"]) == "Funds sold a net 60,000 corn contracts, leaving them net long 200,000, the largest net long "
       "as a share of open interest since 2023: higher than 99% of weeks since 2023 (share of open interest).", market_line(r6["corn"]))
    sj = subject_of(as_of, r6l)
    ok(sj == "Corn: largest net long as a share of open interest since 2023", sj)
    ok(preheader(r6l).startswith("Funds bought soybeans 3 weeks in a row, 5,000 contracts in the latest report."), preheader(r6l))
    # TWO FILES MUST NEVER DISAGREE IN FRONT OF A READER: the rank is withheld, with the reason
    for label, mut, why in (("an older ranking file", lambda x: x.update(date="2026-10-06"), "the ranking is not up to this report yet"),
                            ("a different net", lambda x: x.update(net=199999), "the ranking file and this report's position do not match"),
                            ("a ranking the record does not give", lambda x: x["pctl"].update(net_oi_all=97.0),
                             "the ranking did not check out against the weekly record")):
        a4 = json.loads(json.dumps(ana))
        mut(a4["commodities"]["corn"])
        with contextlib.redirect_stdout(io.StringIO()):
            r4 = {r["key"]: r for r in prepare(now, cot, hist, deep, a4)[2]}
        ok(r4["corn"]["rank"] is None and market_line(r4["corn"]).endswith("net long 200,000. No rank for this report: %s." % why),
           "%s: %r" % (label, market_line(r4["corn"])))
    # the change is "since the <date> report" when the report before is not a week back
    h2 = json.loads(json.dumps(hist))
    del h2["history"]["corn"][-2]
    c2 = json.loads(json.dumps(cot))
    c2["corn"]["prev"] = h2["history"]["corn"][-2]["net"]
    with contextlib.redirect_stdout(io.StringIO()):
        r2 = {r["key"]: r for r in prepare(now, c2, h2, deep, ana)[2]}
    ok(r2["corn"]["chg_since"] == date(2026, 9, 29) and market_line(r2["corn"]).startswith(
        "Funds bought a net 150,000 corn contracts since the Sep 29 report, leaving them net long 200,000"), market_line(r2["corn"]))
    ok(r2["corn"]["streak"] == 0, "a run never counts across a missing week")
    # a side that flipped, and a position inside the flat band
    ok(market_line(dict(bn, net=-5000, chg=-15000, chg_since=None)).startswith(
        "Funds sold a net 15,000 soybean contracts, flipping them net short 5,000:"), "flip")
    ok(market_line(dict(bn, net=-517, chg=-600, chg_since=None, side="flat")).startswith(
        "Funds sold a net 600 soybean contracts, leaving them about even (net short 517):"), "flat band")
    # a deep file that does not reach this report: the rank still from the analysis file, no recount to check
    d2 = json.loads(json.dumps(deep))
    for v in d2["commodities"].values():
        for f in ("dates", "mm_long", "mm_short", "oi"):
            v[f] = v[f][:-1]
    with contextlib.redirect_stdout(io.StringIO()):
        r3 = {r["key"]: r for r in prepare(now, cot, hist, d2, ana)[2]}
    ok(r3["corn"]["y1"] and r3["corn"]["rank"]["shown"] == 99, "rank without the deep file")
    # stale, early, unreadable
    with contextlib.redirect_stdout(io.StringIO()):
        ok(prepare(datetime(2026, 10, 30, 20, 0, tzinfo=timezone.utc), cot, hist, deep, ana)[0] is None, "two weeks on: too old to send")
        ok(prepare(datetime(2026, 10, 30, 20, 0, tzinfo=timezone.utc), cot, hist, deep, ana, stale_ok=True)[0] == as_of, "a preview may show it")
        ok(prepare(datetime(2026, 10, 15, 20, 0, tzinfo=timezone.utc), cot, hist, deep, ana)[0] is None, "before Friday: not out yet")
        ok(prepare(now, {"report_date": "soon"}, hist, deep, ana)[0] is None, "no date: nothing")
    # next report, holiday-aware (cot_calendar): Veterans Day (Wed Nov 11, 2026) moves Nov 10's report to Monday
    ok(next_report(as_of) == "Next report: Friday Oct 23, 3:30 PM ET.", next_report(as_of))
    ok(next_report(date(2026, 11, 3)) == "Next report: Monday Nov 16, 3:30 PM ET (moved from Friday).", next_report(date(2026, 11, 3)))
    # the email
    s, t, h = compose(as_of, rel, rows, gaps)
    ok(s == "Funds bought soybeans 3 weeks in a row" and len(s) <= 60, s)
    ok(compose(as_of, rel, rows, gaps, preview=True)[0] == "[Preview] " + s, "preview subject")
    tl = t.split("\n")
    ok(tl[0] == "AGSIST · FUNDS · WEEK TO OCT 13, 2026", tl[0])
    # the lead story (soybeans' run) has its evidence right under the headline, then the week's lead
    ok(tl[2] == "Funds bought a net 5,000 soybean contracts, leaving them net short 40,000." and tl[3] == "Funds have bought 3 weeks in a row."
       and tl[5] == lead(as_of, rows), tl[:7])
    ok(h.index(esc_h(s)) < h.index("<b>Soybeans:</b> Funds bought a net 5,000 soybean contracts") < h.index(esc_h(lead(as_of, rows))), "evidence under the headline in the html")
    ok(not re.search(r"\bthis week\b|\btoday\b", (t + h).lower().replace("funds this week", "")), "no 'this week' or 'today' on the email")
    ok(preheader(rows) in h and 'display:none' in h, "the preview line is in the html, hidden")
    ok("Week to Tue, Oct 13, 2026. Released Fri, Oct 16, 2026, 3:30 PM ET." in t, t[:300])
    ok("Source: CFTC Commitments of Traders, Disaggregated, futures only, report as of Tue, Oct 13, 2026, released Fri, Oct 16, 2026." in t, "source and dates")
    ok("Next report: Friday Oct 23, 3:30 PM ET." in t and "Next report: Friday Oct 23, 3:30 PM ET." in h, "next report in both")
    ok("CHICAGO WHEAT\nNo reading for this report: the weekly files do not agree on this report yet." in t
       and "FEEDER CATTLE\nNo reading for this report: no position in this report's file." in t, "a missing market is shown, with why")
    ok("—" not in t + h and "–" not in t + h and "&mdash;" not in h, "no em or en dash anywhere")
    ok(not re.search(r"\b(will|expect|likely|forecast|should|buy|sell)\b", t.lower().replace("not where prices go next", "")), "no prediction words")
    ok(not re.search(r"percentile|\d(st|nd|rd|th)\b|head for the exit|could be forced|between here and flat|not a call on price",
                     (t + h).lower()), "no ordinals, no percentile, no exposure lines")
    ok(not re.search(r"bootstrap|draws|fdr|false discovery|benjamini|\bblock\b", (t + re.sub(r"<[^>]+>", " ", h)).lower()), "no method words")
    ok(t.count("(share of open interest).") == 4 and h.count("(share of open interest).") == 4, "one rank a market, in both bodies")
    ok(t.count("weeks since 2023") == 4 + 0 and "every week since 2023" in t, "the span named once, beside each rank")
    ok(h.count("52-week range") == 4 and t.count("52-week range: ") == 4, "the range, labelled a range")
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
        ok(not email_links.SHARED_RE.search(_h + _t + str(m["List-Unsubscribe"])), "no shared host anywhere")
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
    ok(us and all(SRC_TAG in u and "utm_campaign=cot" in u for u in us), "every agsist.com link tagged email: %r" % [u for u in us if SRC_TAG not in u])
    ok("https://agsist.com/cot?" in allt, "links to the COT tool")
    # the forward line lands a neighbor on the signup box, tagged like every other link (Sig, Nov 6)
    fw = FORWARD_URL
    ok("utm_medium=forward" in fw, "the forward link says forward")
    ok(body.count(fw) == 1 and hb.replace("&amp;", "&").count('href="' + fw + '"') == 1, "forward link goes to /cot#cot-signup in text and HTML")
    ok("Share with a farmer or your grain buyer. They can sign up free at" in body and "Share with a farmer or your grain buyer." in hb, "forward line in both parts")

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
    ok(asked == ["cot"] and "would send to the Funds this week list" in log and "list: Funds this week read" in log
       and "2 reader(s)" not in log, log[-400:])
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
        ok(x["Subject"] == "Funds bought soybeans 3 weeks in a row", x["Subject"])
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
    # 11. no twenty-year file (Nov 4: it lives on raw; a job that did not unpack it): a send to the
    # list refuses, loudly, with readers counted as waiting so the DELIVERY line reads red; a dry
    # run and a preview still render without it, as the missing-file render case above does
    import tempfile
    nodeep = {k: v for k, v in files.items() if k != "DEEP"}
    keep_deep = DEEP
    try:
        globals()["DEEP"] = Path(tempfile.mkdtemp()) / "cot-deep.json"
        tl = delivery_line.Tally("funds-weekly")
        globals()["TALLY"] = tl
        rc, log, sent, calls = _run(nodeep, dict(W, SEND="1", **SM), now, fetch)
        ok(rc == 1 and not sent and not _FakeSMTP.made and "FATAL: cot-deep.json is missing" in log
           and ("set", "cot:2026-10-13") not in calls, "send without the deep file: refused, week not flagged %r" % log[-300:])
        ok(tl.sent == 0 and tl.waiting == 2 and not tl.dry
           and delivery_line.line("funds-weekly", tl.sent, tl.waiting, tl.dry) == "DELIVERY sender=funds-weekly sent_readers=0 waiting=2 dry=0",
           "the DELIVERY line reads readers waiting, none sent, live: %r" % tl.line())
        globals()["DEEP"].write_text("{not json")
        rc, log, sent, calls = _run(nodeep, dict(W, SEND="1", **SM), now, fetch)
        ok(rc == 1 and not sent and "unreadable" in log, "send with a broken deep file: refused")
        globals()["DEEP"].unlink()
        rc, log, sent, calls = _run(nodeep, dict(W, **SM), now, fetch)
        ok(rc == 0 and not sent and "dry run complete" in log, "a dry run still renders without it")
        rc, log, sent, calls = _run(nodeep, dict(W, PREVIEW="1", SIG_TO="sig@example.org", **SM), now, fetch)
        ok(rc == 0 and len(sent) == 1, "a preview still renders without it")
    finally:
        globals()["DEEP"], globals()["TALLY"] = keep_deep, None
    # how the net changed (Nov 7): the analysis file's card.how line, checked against cot-history, never refigured
    ok(c.get("how") == "Longs -60,000, shorts 0: mostly selling longs they held."
       == ana["commodities"]["corn"]["card"]["how"]["line"] and c.get("how_why") is None, "corn how %r" % c.get("how"))
    ok(bn.get("how") == "Longs 0, shorts -5,000: mostly buying back shorts.", "beans how %r" % bn.get("how"))
    _s, _t, _h = compose(as_of, date(2026, 10, 16), rows)
    for r in rows:
        ok(r.get("how") and r["how"] in _t and esc_h(r["how"]) in _h, "%s: the email prints the computed line as it is" % r["key"])
    import copy
    h2 = copy.deepcopy(hist)
    h2["history"]["corn"][-2]["long"] += 1
    ok(how_of("corn", iso, ana, h2["history"]["corn"]) == (None, "the weekly files disagree on the long and short split"),
       "files that disagree: withheld")
    h2 = copy.deepcopy(hist)
    del h2["history"]["corn"][-2]["short"]
    ok(how_of("corn", iso, ana, h2["history"]["corn"]) == (None, "a week without both long and short counts"),
       "a week without a short count: withheld")
    a2 = copy.deepcopy(ana)
    a2["commodities"]["corn"]["card"]["how"] = {"withheld": "a week without both long and short counts"}
    ok(how_of("corn", iso, a2, hist["history"]["corn"])[0] is None, "the analysis withheld it: withheld here too")
    a2["commodities"]["corn"]["date"] = "2026-10-06"
    ok(how_of("corn", iso, a2, hist["history"]["corn"])[0] is None, "an analysis for another week: withheld")
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
    TALLY = delivery_line.start("funds-weekly")
    sys.exit(list_source.guard(lambda: main(sys.argv[1:]), soft=False))
