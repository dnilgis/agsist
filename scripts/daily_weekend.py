"""daily_weekend.py -- the code-built blocks of the Saturday and Sunday Dailies (Sig, Nov 6 and 7 2026:
"Saturday Daily = wrap-up of the week. Sunday Daily = the week ahead"; plan in the private notes,
plans/weekend-daily-plan.md). No weekend number comes from the writer: these blocks print what the data
files say, and the writer is told they exist and may not restate them differently.

SATURDAY, "The week in review"
  week_review()  Friday vs last Friday for corn, soybeans, Chicago wheat, live cattle, feeder cattle and
                 lean hogs. The SAME dated contract both Fridays (corn-dec26, cattle-dec26: the contract the
                 board shows that week, from data/prices.json "nearby"), never the front month across a roll.
                 This Friday: the settle when data/prices.json carries one for that day, else that day's last
                 trade, and the block says which. Last Friday: the stored Saturday issue in data/daily-archive
                 (the store price_windows already trusts in scripts/daily_adds.py): its week_review.closes
                 (dated keys, written by this module from Nov 14 2026 on), else its locked prices with the
                 contract label each locked change carries. A missing price, a different contract or an
                 issue that does not hold that Friday drops the row; nothing is guessed. A close at the
                 contract's 52-week high or low (wk52_hi / wk52_lo in data/prices.json) says so.
  The reader's own elevator bid for the week needs a week-old bid per reader; the bid files keep 4 days
  (data/bids-prev, KEEP_DAYS) and the private bid ledger is not built yet, so that line prints nothing.

SUNDAY, "The week ahead"
  week_ahead()   Reports this week, Monday to Saturday: Crop Progress and Export Sales (with their holiday
                 moves), WASDE and the other 11:00 AM CT reports, federal holidays by name (scripts/usda_dates.py)
                 and the COT release (scripts/cot_calendar.py); a COT release a holiday pushes is said plainly.

BOTH
  infographic()  The Infographic of the Week slot: nothing until data/infographics/ exists.

Pure functions over the data handed in; tests hand in fixtures. This module must not import a reader of
data/cot-deep.json (test/raw-readers.test.mjs): only usda_dates, cot_calendar and pricefmt.
"""
import json
import os
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

import cot_calendar
import pricefmt
import usda_dates

try:
    from zoneinfo import ZoneInfo
    CT = ZoneInfo("America/Chicago")
except Exception:  # pragma: no cover
    CT = timezone(timedelta(hours=-6))

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
ARCHIVE = os.path.join(REPO, "data", "daily-archive")
INFOGRAPHICS = os.path.join(REPO, "data", "infographics")

ROWS = (("corn", "Corn"), ("beans", "Soybeans"), ("wheat", "Chicago wheat"),
        ("cattle", "Live cattle"), ("feeders", "Feeder cattle"), ("hogs", "Lean hogs"))
GRAIN = {"corn", "beans", "wheat"}   # quoted in cents in data/prices.json, dollars in the stored issue
REVIEW_TITLE, REVIEW_HEAD = "The week in review", "Friday vs last Friday"
AHEAD_TITLE, AHEAD_HEAD = "The week ahead", "Reports this week"
COT_TIME_CT = "2:30 PM CT"          # CFTC publishes at 3:30 PM ET
REPORT_TIME_CT = "11:00 AM CT"      # WASDE, Crop Production and the other major reports
MINUS = "−"
MON3 = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v > 0


def _d(s):
    try:
        return date.fromisoformat(str(s)[:10])
    except Exception:
        return None


def _md(d):
    return "%s %d" % (MON3[d.month - 1], d.day)


def _day(d):
    return "%s %s" % (d.strftime("%a"), _md(d))


def _clock(stamp):
    try:
        t = datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).astimezone(CT)
    except Exception:
        return ""
    return "%d:%02d %s CT" % (t.hour % 12 or 12, t.minute, "AM" if t.hour < 12 else "PM")


def _round(v, n=2):
    """Half up on the number as written (214.175 -> 214.18), not on its binary value."""
    return Decimal(repr(round(float(v), 6))).quantize(Decimal(1).scaleb(-n), rounding=ROUND_HALF_UP)


def contract_key(root, label):
    """'cattle', "Dec '26" -> 'cattle-dec26'; None when the label is not a month and year."""
    m = re.match(r"^([A-Z][a-z]{2}) '(\d{2})$", str(label or "").strip())
    return "%s-%s%s" % (root, m.group(1).lower(), m.group(2)) if m and m.group(1) in MON3 else None


def _month(label):
    m = re.match(r"^([A-Z][a-z]{2}) '\d{2}$", str(label or "").strip())
    return m.group(1) if m else ""


# ── Saturday: Friday vs last Friday ─────────────────────────────────────
def friday_closes(prices, fri_iso):
    """{dated key: close} for this Friday from a data/prices.json dict. A close is
    {root, name, contract, px (prices.json units), kind 'settle'|'last', at, date, wk52_hi, wk52_lo}."""
    quotes = (prices or {}).get("quotes") or {}
    nearby = (prices or {}).get("nearby") or {}
    out = {}
    for root, name in ROWS:
        nb = nearby.get(root) or {}
        key, label = nb.get("key"), nb.get("label")
        q = quotes.get(key) if key else None
        if not isinstance(q, dict) or contract_key(root, label) != key:
            continue
        rec = {"root": root, "name": name, "contract": label, "date": fri_iso}
        s = (q.get("settles") or {}).get(fri_iso)
        dl = (q.get("day_last") or {}).get(fri_iso) or {}
        if _num(s):
            rec.update(px=round(float(s), 4), kind="settle")
        elif _num(dl.get("px")):
            rec.update(px=round(float(dl["px"]), 4), kind="last", at=dl.get("at"))
        else:
            continue
        if q.get("close_date") == fri_iso:     # the 52-week range is the one fetched with that close
            for k in ("wk52_hi", "wk52_lo"):
                if _num(q.get(k)):
                    rec[k] = float(q[k])
        out[key] = rec
    return out


def stored_closes(issue, fri_iso):
    """{dated key: close} for `fri_iso` from a stored issue (data/daily-archive/<date>.json):
    its week_review.closes, else its locked prices whose locked change names the contract
    and is dated that Friday. {} when the issue does not hold that Friday."""
    if not isinstance(issue, dict):
        return {}
    wr = issue.get("week_review") or {}
    if wr.get("friday") == fri_iso and isinstance(wr.get("closes"), dict):
        return {k: v for k, v in wr["closes"].items()
                if isinstance(v, dict) and v.get("date") == fri_iso and _num(v.get("px"))}
    lp, lc = issue.get("locked_prices") or {}, issue.get("locked_changes") or {}
    out = {}
    for root, name in ROWS:
        v, ch = lp.get(root), lc.get(root) or {}
        key = contract_key(root, ch.get("contract"))
        if not key or not _num(v) or ch.get("date") != fri_iso or ch.get("kind") not in ("settle", "last"):
            continue
        rec = {"root": root, "name": name, "contract": ch["contract"], "date": fri_iso, "kind": ch["kind"],
               "px": round(float(v) * (100 if root in GRAIN else 1), 4)}
        if ch.get("at"):
            rec["at"] = ch["at"]
        out[key] = rec
    return out


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def prior_closes(fri, archive_dir=None):
    """Last Friday's closes from the stored Saturday issue (or the Sunday one: both hold Friday's close)."""
    adir = archive_dir or ARCHIVE
    pf = (fri - timedelta(days=7)).isoformat()
    for d in (fri - timedelta(days=6), fri - timedelta(days=5)):     # last Saturday, then last Sunday
        got = stored_closes(_load(os.path.join(adir, d.isoformat() + ".json")), pf)
        if got:
            return got
    return {}


def _basis(rec):
    if rec.get("kind") == "settle":
        return "settle"
    t = _clock(rec.get("at"))
    return "last trade " + t if t else "last trade"


def _price(root, px):
    return pricefmt.price(px, style="slash") if root in GRAIN else "$%s" % _round(px)


def _change(root, now, prev):
    d = now - prev
    if root in GRAIN:
        q = pricefmt.quarters(d)
        if q == 0:
            return "unchanged"
        return "%s %s cents" % ("up" if q > 0 else "down", pricefmt.move(abs(d), style="slash", cent=False))
    r = _round(abs(d))
    if r == 0:
        return "unchanged"
    return "%s $%s" % ("up" if d > 0 else "down", r)


def _pct(now, prev):
    p = (now - prev) / prev * 100
    t = _round(abs(p), 1)
    if t == 0:
        return "0.0%"
    return ("+" if p > 0 else MINUS) + "%s%%" % t


def week_review(today, prices, archive_dir=None):
    """The Saturday block, or None (not a Saturday, or no row both Fridays)."""
    if not isinstance(today, date) or today.weekday() != 5:
        return None
    fri = today - timedelta(days=1)
    now = friday_closes(prices, fri.isoformat())
    prev = prior_closes(fri, archive_dir)
    rows = []
    for key, a in now.items():
        b = prev.get(key)
        if not b or b.get("contract") != a.get("contract") or not _num(b.get("px")):
            continue        # a roll, a missing week or a different contract: no row, never a guess
        root = a["root"]
        row = {"key": key, "name": "%s (%s)" % (a["name"], _month(a["contract"])), "now": a["px"], "prev": b["px"],
               "now_basis": _basis(a), "prev_basis": _basis(b),
               "price": _price(root, a["px"]), "change": _change(root, a["px"], b["px"]), "pct": _pct(a["px"], b["px"])}
        if "wk52_lo" in a and a["px"] <= a["wk52_lo"] + 1e-9:
            row["extreme"] = "a 52-week low"
        elif "wk52_hi" in a and a["px"] >= a["wk52_hi"] - 1e-9:
            row["extreme"] = "a 52-week high"
        rows.append(row)
    if not rows:
        return None
    pf = fri - timedelta(days=7)
    kinds = {(r["now_basis"] == "settle", r["prev_basis"] == "settle") for r in rows}
    if kinds == {(True, True)}:
        stamp = "settle each Friday"
    elif kinds == {(False, False)}:
        stamp = "last trade each Friday, not the settle"
    else:
        stamp = "settle or last trade, as marked"
    lines = []
    for r in rows:
        s = "%s %s, %s (%s)" % (r["name"], r["price"], r["change"], r["pct"])
        if r.get("extreme"):
            s += ", " + r["extreme"]
        if stamp.startswith("last trade") and r["now_basis"] != "last trade":
            s += "; %s %s" % (_md(fri), r["now_basis"])
        elif stamp.startswith("settle or"):
            s += "; %s %s, %s %s" % (_md(fri), r["now_basis"], _md(pf), r["prev_basis"])
        r["line"] = s
        lines.append(s)
    return {"title": REVIEW_TITLE, "head": REVIEW_HEAD, "stamp": stamp, "friday": fri.isoformat(),
            "prior": pf.isoformat(), "rows": rows, "lines": lines, "notes": [],
            "source": "CME futures via Yahoo Finance, delayed", "closes": now}


# ── Sunday: reports this week ──────────────────────────────────────────
def _cot_releases(mon):
    """[(release date, as-of date, holiday name or None)] for the as-of Tuesdays whose release can
    land Monday to Saturday of the week starting `mon`, or be pushed out of it."""
    out = []
    for as_of in (mon - timedelta(days=6), mon + timedelta(days=1)):
        if cot_calendar.release_unknown(as_of):
            continue
        rel = cot_calendar.release_date(as_of)
        a_mon = as_of - timedelta(days=as_of.weekday())
        hol = next((usda_dates.federal_holiday_name(a_mon + timedelta(days=i)) for i in (2, 3, 4)
                    if usda_dates.federal_holiday_name(a_mon + timedelta(days=i))), None)
        out.append((rel, as_of, hol if rel != a_mon + timedelta(days=4) else None))
    return out


def week_ahead(today):
    """The Sunday block, or None (not a Sunday, or nothing on the calendar)."""
    if not isinstance(today, date) or today.weekday() != 6:
        return None
    mon = today + timedelta(days=1)
    items, notes = [], []
    for i in range(6):
        d = mon + timedelta(days=i)
        day = []   # (sort minutes, text)
        hol = usda_dates.federal_holiday_name(d)
        if hol and d.weekday() < 5:
            day.append((0, "%s: federal offices closed" % hol))
        for name, t, moved in usda_dates.weekly_releases(d):
            nm = name.replace("USDA ", "").replace("Weekly ", "")
            txt = "%s, %s" % (nm, t)
            if moved:
                txt += " (moved from %s by %s)" % (moved.strftime("%A"), usda_dates.federal_holiday_name(moved))
            day.append((_mins(t), txt))
        majors = usda_dates.major_reports(d)
        if majors:
            nm = majors[0] if len(majors) == 1 else ", ".join(majors[:-1]) + " and " + majors[-1]
            day.append((_mins(REPORT_TIME_CT), "%s, %s" % (nm, REPORT_TIME_CT)))
        for rel, as_of, hol_by in _cot_releases(mon):
            if rel == d:
                txt = "COT report, %s" % COT_TIME_CT
                if hol_by:
                    txt = "COT report for %s, %s (moved by %s)" % (_md(as_of), COT_TIME_CT, hol_by)
                day.append((_mins(COT_TIME_CT), txt))
        for _m, txt in sorted(day, key=lambda x: x[0]):
            items.append({"date": d.isoformat(), "day": _day(d), "text": txt})
    for rel, as_of, hol_by in _cot_releases(mon):
        if hol_by and rel > mon + timedelta(days=5):
            notes.append("The COT report for %s moves to %s, %s, because of %s." % (_md(as_of), _day(rel), COT_TIME_CT, hol_by))
    if not items and not notes:
        return None
    return {"title": AHEAD_TITLE, "head": AHEAD_HEAD, "monday": mon.isoformat(), "items": items,
            "lines": ["%s: %s" % (x["day"], x["text"]) for x in items], "notes": notes,
            "source": "USDA and CFTC release calendars"}


def _mins(t):
    m = re.match(r"(\d+):(\d+) (AM|PM)", t or "")
    if not m:
        return 0
    h = int(m.group(1)) % 12 + (12 if m.group(3) == "PM" else 0)
    return h * 60 + int(m.group(2))


# ── both days ──────────────────────────────────────────────────────────
def infographic(today, root=None):
    """The Infographic of the Week slot. Renders nothing until data/infographics/ exists and holds a
    latest.json with image_url, title and url (the Friday picture again, from Nov 13 2026)."""
    d = root or INFOGRAPHICS
    if not os.path.isdir(d):
        return None
    j = _load(os.path.join(d, "latest.json"))
    if not isinstance(j, dict) or not all(isinstance(j.get(k), str) and j.get(k) for k in ("image_url", "title", "url")):
        return None
    return {"image_url": j["image_url"], "title": j["title"], "url": j["url"]}


def for_issue(today, prices=None, archive_dir=None):
    """(field, block) for today's issue: ('week_review', ...) on Saturday, ('week_ahead', ...) on Sunday,
    else (None, None)."""
    if not isinstance(today, date):
        return None, None
    if today.weekday() == 5:
        if prices is None:
            prices = _load(os.path.join(REPO, "data", "prices.json")) or {}
        return "week_review", week_review(today, prices, archive_dir)
    if today.weekday() == 6:
        return "week_ahead", week_ahead(today)
    return None, None


def block_text(block):
    """Plain lines of a block: the head (with its stamp), the lines, the notes."""
    if not isinstance(block, dict) or not block.get("lines") and not block.get("notes"):
        return []
    head = block.get("head") or ""
    if block.get("stamp"):
        head += " (%s)" % block["stamp"]
    return [head] + list(block.get("lines") or []) + list(block.get("notes") or [])


def prompt_lines(field, block):
    """What the writer is told: the block exists, prints by code, and its numbers are the only ones."""
    t = block_text(block)
    if not t:
        return ""
    what = "WEEK IN REVIEW TABLE" if field == "week_review" else "WEEK AHEAD CALENDAR"
    return ("CODE-BUILT %s (printed in today's issue under your text by code, exactly as below). Do not repeat this "
            "list, and never state any of these numbers, days or times differently; if you mention one, copy it "
            "exactly as written here:\n  " % what + "\n  ".join(t))


if __name__ == "__main__":
    import sys
    t = _d(sys.argv[1]) if len(sys.argv) > 1 else datetime.now(CT).date()
    f, b = for_issue(t)
    print(f or "weekday: no weekend block")
    print("\n".join(block_text(b)))
