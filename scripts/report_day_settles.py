#!/usr/bin/env python3
"""
report_day_settles.py -- the morning after a USDA report day, the writer gets that
day's settles as their own labelled block, built by code from prices.json.

WHY. Wednesday Nov 11 2026, the morning after the Nov 10 WASDE, every Daily
try was blocked. The writer had today's overnight table and a timing block,
but the news was Tuesday's report-day move, so it stated that move from
memory or from a last trade: "Soybeans settled Tuesday up 43 1/2 cents at
$12.25 3/4" (a last trade against Monday's settle), "Soybeans and wheat barely
moved on the report" (Jan beans settled up 39 3/4, wheat up 4 3/4), "Friday's
(Nov 6) report-day gain". This block hands it the day, by weekday and date,
and each contract's settle and its change from the session before, from the
settles on file only. A settle that is not on file yet says so and carries no
move; a last trade is never used.

(scripts/report_day.py is the report day ITSELF: its watch line and lede.)
One definition, three readers: the generator puts text() in the writer's
message (the fact check reads that message), and briefing_gate accepts a
cents or percent figure that matches a row here when the sentence names the
report day (matches()).

  build(prices, today, wasde_release=None) -> dict or None
  text(block) -> the prompt block ("" for None)
  matches(sentence, key, value, block, kind) -> bool

    python3 scripts/report_day_settles.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import os
import re
import sys
from datetime import date, datetime, timedelta

# (prices.json key, commodity group the gate binds to). Deduplicated by ticker,
# so a nearby alias and its contract are one line.
ROWS = (("corn-nearby", "corn"), ("corn-dec", "corn"),
        ("beans-nov", "beans"), ("beans-nearby", "beans"),
        ("wheat-nearby", "wheat"), ("wheat", "wheat"))
NAMES = {"corn": "Corn", "beans": "Soybeans", "wheat": "Wheat"}
MONTH_CODE = {"F": "Jan", "G": "Feb", "H": "Mar", "J": "Apr", "K": "May", "M": "Jun",
              "N": "Jul", "Q": "Aug", "U": "Sep", "V": "Oct", "X": "Nov", "Z": "Dec"}
TICKER = re.compile(r"^Z[CSW]([FGHJKMNQUVXZ])(\d{2})\b")


def _contract(ticker):
    m = TICKER.match(str(ticker or ""))
    return "%s '%s" % (MONTH_CODE[m.group(1)], m.group(2)) if m else None


def _frac(cents):
    """449.0 -> '$4.49', 1224.5 -> '$12.24½' (the pit's quarter cents)."""
    c = round(float(cents) * 4) / 4
    w = int(c + 1e-9)
    f = round((c - w) * 4)
    if f == 4:
        w, f = w + 1, 0
    return "$%.2f" % (w / 100.0) + ("", "¼", "½", "¾")[f]


def _cents(net):
    a = round(abs(float(net)) * 4) / 4
    w = int(a + 1e-9)
    f = round((a - w) * 4)
    s = (str(w) if w or not f else "") + ("", "¼", "½", "¾")[f]
    return (s or "0") + "¢"


def _words(d):
    return "%s, %s %d" % (d.strftime("%A"), d.strftime("%b"), d.day)


def last_session(today):
    """The weekday before `today` (Monday's is Friday)."""
    d = today - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def reports_on(day, wasde_release=None):
    """Major USDA reports released on `day`: the static table, plus wasde.json's date."""
    out = []
    try:
        import usda_dates
        out = list(usda_dates.major_reports(day))
    except Exception:  # noqa: BLE001
        out = []
    if wasde_release == day and "WASDE" not in out:
        out.insert(0, "WASDE")
    return out


def load_wasde_release(path=None):
    path = path or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "wasde.json")
    try:
        with open(path, encoding="utf-8") as f:
            return date.fromisoformat(str((json.load(f) or {}).get("release") or "")[:10])
    except Exception:  # noqa: BLE001
        return None


def build(prices, today, wasde_release=None):
    """The report-day block for an issue dated `today`, or None when the last
    session was not a report day. Every price is a settle from the quote's
    settles by date; the change is against the latest settle before it."""
    day = last_session(today)
    reports = reports_on(day, wasde_release)
    if not reports:
        return None
    quotes = (prices or {}).get("quotes") or {}
    rows, seen = [], set()
    for key, group in ROWS:
        q = quotes.get(key)
        if not isinstance(q, dict):
            continue
        tk = str(q.get("ticker") or "")
        contract = q.get("contract") or _contract(tk)
        if not contract or tk in seen:
            continue                          # a row with no contract month is never printed
        seen.add(tk)
        settles = q.get("settles") if isinstance(q.get("settles"), dict) else {}
        px = settles.get(day.isoformat())
        before = sorted(d for d, v in settles.items() if d < day.isoformat() and isinstance(v, (int, float)))
        row = {"key": key, "group": group, "contract": contract, "label": "%s %s" % (NAMES[group], contract)}
        if isinstance(px, (int, float)) and before:
            prev = float(settles[before[-1]])
            row.update(settle=float(px), prev=prev, prev_date=before[-1], net=round(float(px) - prev, 4),
                       pct=round((float(px) - prev) / prev * 100.0, 2) if prev else None)
        else:
            row["missing"] = True
        rows.append(row)
    if not rows:
        return None
    return {"date": day.isoformat(), "words": _words(day), "weekday": day.strftime("%A"),
            "reports": reports, "rows": rows}


def text(block):
    if not block:
        return ""
    day = date.fromisoformat(block["date"])
    lines = []
    for r in block["rows"]:
        if r.get("missing"):
            lines.append("  %s: settle not in yet; state no move for it" % r["label"])
            continue
        pd = date.fromisoformat(r["prev_date"])
        word = "up" if r["net"] > 0 else ("down" if r["net"] < 0 else "unchanged")
        mv = "" if word == "unchanged" else " %s %s" % (word, _cents(r["net"]))
        pct = "" if r.get("pct") is None or word == "unchanged" else " (%+.1f%%)" % r["pct"]
        lines.append("  %s: settled %s%s%s from %s's %s" % (r["label"], _frac(r["settle"]), mv, pct,
                                                          pd.strftime("%A"), _frac(r["prev"])))
    return ("YESTERDAY WAS REPORT DAY (HARD RULE): %s, %d, %s. Exchange settles on %s against "
            "the session before. Use ONLY these lines for %s's moves, each with its contract "
            "month and the day written out (\"%s\"). They are settles, so 'settled' is right for "
            "them. The change column in the LOCKED PRICE TABLE is today's move, a different number: "
            "never give one for the other, and never call a report-day move small without "
            "checking it here.\n" % (block["words"], day.year, " and ".join(block["reports"]),
                                    block["words"], block["weekday"], block["words"])
            + "\n".join(lines))


def names_day(sentence, block):
    """Does the sentence name the report day (its weekday or its date)?"""
    if not block:
        return False
    day = date.fromisoformat(block["date"])
    s = sentence or ""
    return bool(re.search(r"\b%s\b" % block["weekday"], s)
                or re.search(r"\b%s\.?\s+%d\b" % (day.strftime("%b"), day.day), s)
                or re.search(r"\b(report day|report-day)\b", s, re.I))


def matches(sentence, key, value, block, kind="cents", tol=None):
    """True when the sentence names the report day and `value` (cents, or a
    percent) is a report-day settle change of an instrument in group `key`."""
    if not block or not names_day(sentence, block):
        return False
    for r in block["rows"]:
        if r["group"] != key or r.get("missing"):
            continue
        ref = abs(r["net"]) if kind == "cents" else abs(r["pct"] if r.get("pct") is not None else 1e9)
        # Tight on purpose: this is an extra way to pass, so it takes the
        # block's number rounded to the cent (or the tenth of a percent), not
        # the board check's wider band. 43 1/2 for a 42 1/4 settle move fails.
        t = tol if tol is not None else (0.5 if kind == "cents" else 0.1)
        if abs(abs(value) - ref) <= t:
            return True
    return False


def _fixture():
    """prices.json as it read at 13:01 UTC Nov 11 2026 (the parts this reads)."""
    def q(tk, s9, s10, extra=None):
        d = {"ticker": tk, "settles": {"2026-11-06": 0.0, "2026-11-09": s9, "2026-11-10": s10}}
        d["settles"] = {k: v for k, v in d["settles"].items() if v}
        d.update(extra or {})
        return d
    return {"quotes": {
        "corn-dec": q("ZCZ26.CBT", 439.25, 449.0),
        "corn-nearby": q("ZCZ26.CBT", 439.25, 449.0, {"contract": "Dec '26"}),
        "beans-nov": q("ZSX26.CBT", 1182.25, 1224.5),
        "beans-nearby": q("ZSF27.CBT", 1188.25, 1228.0, {"contract": "Jan '27"}),
        "wheat-nearby": q("ZWZ26.CBT", 588.0, 592.75, {"contract": "Dec '26"}),
    }}


def selftest():
    bad = 0

    def ck(name, ok, got=None):
        nonlocal bad
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
        bad += 0 if ok else 1
    wed = date(2026, 11, 11)
    b = build(_fixture(), wed, None)
    ck("Nov 11: Tuesday Nov 10 is a report day by the USDA table", b and b["date"] == "2026-11-10"
       and "WASDE" in b["reports"], b)
    t = text(b)
    ck("weekday and date written out", "Tuesday, Nov 10, 2026" in t, t)
    ck("Dec corn settled $4.49, up 9 3/4 from Monday's $4.39 1/4",
       "Corn Dec '26: settled $4.49 up 9¾¢ (+2.2%) from Monday's $4.39¼" in t, t)
    ck("Nov soybeans settled $12.24 1/2, up 42 1/4 from $11.82 1/4",
       "Soybeans Nov '26: settled $12.24½ up 42¼¢ (+3.6%) from Monday's $11.82¼" in t, t)
    ck("Jan soybeans up 39 3/4", "Soybeans Jan '27: settled $12.28 up 39¾¢" in t, t)
    ck("wheat up 4 3/4", "Wheat Dec '26: settled $5.92¾ up 4¾¢" in t, t)
    ck("one line per contract (nearby alias folded)", t.count("Corn Dec '26") == 1, t)
    # the 12:01 UTC shape: Nov beans had no Nov 10 settle yet, only a last trade
    early = _fixture()
    early["quotes"]["beans-nov"]["settles"].pop("2026-11-10")
    early["quotes"]["beans-nov"].update(close=1225.75, close_kind="last", netChange=43.5)
    t2 = text(build(early, wed, None))
    ck("a missing settle says so, no move, no last trade",
       "Soybeans Nov '26: settle not in yet; state no move for it" in t2 and "12.25" not in t2 and "43" not in t2, t2)
    ck("no block when the last session was not a report day", build(_fixture(), date(2026, 11, 13), None) is None)
    ck("wasde.json's date makes a report day too",
       build(_fixture(), date(2026, 11, 13), date(2026, 11, 12))["reports"] == ["WASDE"])
    ck("Monday's issue looks at Friday", last_session(date(2026, 11, 16)) == date(2026, 11, 13))
    ck("gate match: 'up 9 3/4 cents Tuesday' for corn", matches("Dec corn settled Tuesday up 9¾ cents.", "corn", 9.75, b))
    ck("gate match: 42 1/4 and 39 3/4 both soybean rows", matches("Soybeans rose 42 cents on Tuesday.", "beans", 42.0, b)
       and matches("Jan soybeans settled up 39¾ cents Tuesday.", "beans", 39.75, b))
    ck("no match without the day named", not matches("Soybeans are up 42 cents.", "beans", 42.0, b))
    ck("no match for a number not on file", not matches("Soybeans rose 43½ cents Tuesday.", "beans", 46.5, b))
    ck("no match for a missing settle", not matches("Nov soybeans rose 42¼ cents Tuesday.", "beans", 42.25,
                                                    {**b, "rows": [r for r in build(early, wed)["rows"] if r["group"] == "beans"][:1]}))
    ck("percent match", matches("Corn gained 2.2% Tuesday.", "corn", 2.2, b, "pct"))
    ck("43 1/2 is not the 42 1/4 settle move", not matches("Soybeans rose 43\u00bd cents Tuesday.", "beans", 43.5, b))
    print("FAILS=%d" % bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else 0)
