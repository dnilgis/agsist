#!/usr/bin/env python3
"""milk_miss.py: the published miss of "Read my check" (dairy board, Oct 28, 2026;
BUILD-RULES rule 1: an estimate gets its record printed beside it).

What the check reader shows for a month not yet announced is the Class III
futures settle for that month plus the reader's tests valued at the component
prices of recent months. At the standard tests (3.5 lb butterfat, 3.18 lb
protein, 5.79 lb other solids per cwt, the Class III basis) that adjustment is
zero, so the estimate is the settle itself. This file keeps, for each contract
month M:

  said      the settle of the last CME session before M began, the price the
            check reader showed as M started. Recorded only from a settle we
            actually held at the time (data/prices.json, dated settles, read
            through scripts/milk_settles.py rules: no weekend dates, no last
            trades). Never backfilled from later files; a month whose
            month-start settle we never held stays without one.
  actual    USDA's announced Class III price for M (data/dairy-data.json),
            once the announcement is read and passes its checks.
  miss      actual minus said, cents rounded.

data/dairy-miss.json is written by the dairy workflow and only grows. A run
never changes a "said" once written and never writes one for a session that is
not the last weekday session before the month (US holidays included: the
newest settle dated before the 1st counts only when it is the last weekday
before the 1st, or that day was a CME holiday, which we cannot see here, so the
row carries the session date and the page prints it).

    python3 scripts/milk_miss.py            # update data/dairy-miss.json
    python3 scripts/milk_miss.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import datetime
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import milk_settles  # noqa: E402

OUT = "data/dairy-miss.json"
PRICES = "data/prices.json"
DAIRY = "data/dairy-data.json"
MON3 = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
KEY_RE = re.compile(r"^milk-(%s)(\d{2})$" % "|".join(MON3))
STARTED = "2026-10-28"
# How far back the month-start session may sit and still be "the last session
# before the month": a Friday before a Monday the 1st is 3 days; a Thursday
# before a Friday holiday then a weekend is 4.
MAX_GAP_DAYS = 4


def contract_month(key):
    m = KEY_RE.match(key or "")
    return "20%s-%02d" % (m.group(2), MON3.index(m.group(1)) + 1) if m else None


def month_start(mk):
    y, m = int(mk[:4]), int(mk[5:7])
    return datetime.date(y, m, 1)


def settles_by_month(prices):
    """{contract month: {session date: settle}} from a prices.json body."""
    out = {}
    for k, q in ((prices or {}).get("quotes") or {}).items():
        mk = contract_month(k)
        if not mk or not isinstance(q, dict):
            continue
        ser = milk_settles.series([{"fetched": (prices or {}).get("fetched"), "quotes": {"milk": q}}])
        if ser:
            out.setdefault(mk, {}).update(ser)
    return out


def last_before(ser, mk):
    """(session, settle) of the newest session before month mk, or None when
    that session is not close enough to the 1st to be the month-start price."""
    first = month_start(mk)
    days = sorted(d for d in ser if datetime.date.fromisoformat(d) < first)
    if not days:
        return None
    d = days[-1]
    if (first - datetime.date.fromisoformat(d)).days > MAX_GAP_DAYS:
        return None
    return d, round(ser[d], 2)


def update(log, prices, dairy, now):
    """The new log (a copy). `now` is a datetime; nothing for a month that has
    not started is recorded as 'said' (the session must be in the past and the
    month must have begun)."""
    log = json.loads(json.dumps(log or {}))
    log.setdefault("started", STARTED)
    rows = log.setdefault("months", {})
    today = now.date()
    for mk, ser in settles_by_month(prices).items():
        r = rows.get(mk) or {}
        if "said" not in r and today >= month_start(mk):
            lb = last_before(ser, mk)
            if lb:
                r["said"] = lb[1]
                r["said_session"] = lb[0]
                r["recorded"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
        # the open months the page is showing now, so the log shows what is pending
        if r or today < month_start(mk):
            r.setdefault("contract", mk)
            rows[mk] = r
    k3, c3 = (dairy or {}).get("class_month_key"), (dairy or {}).get("class3")
    if k3 in rows and isinstance(c3, (int, float)) and c3 > 0 and "actual" not in rows[k3]:
        rows[k3]["actual"] = round(c3, 2)
        rows[k3]["announced"] = (dairy or {}).get("class_release") or ""
        if "said" in rows[k3]:
            rows[k3]["miss"] = round(rows[k3]["actual"] - rows[k3]["said"], 2)
    # a month that was announced without a said price, or never started, keeps only what we held
    log["months"] = dict(sorted(rows.items()))
    return log


def _read(p):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return None


def run(root=ROOT, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    p = Path(root) / OUT
    old = _read(p) or {}
    new = update(old, _read(Path(root) / PRICES), _read(Path(root) / DAIRY), now)
    if new != old:
        new["_note"] = ("What Read my check said for each Class III month at the standard tests (the futures settle of the "
                        "last session before the month), and USDA's announced price once it is out. Written by "
                        "scripts/milk_miss.py; only grows; never backfilled.")
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(new, indent=1, sort_keys=True) + "\n")
        os.replace(tmp, p)
        print("[milk-miss] updated %d months" % len(new["months"]))
    else:
        print("[milk-miss] no change")
    return new


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + (f"  ({detail})" if not ok and detail else ""))
        if not ok:
            fails.append(name)

    def q(settles):
        return {"close_kind": "settle", "settles": settles, "close": list(settles.values())[-1],
                "close_date": list(settles)[-1]}

    # the real Oct 28, 2026 file: settles for Oct to Jan from Oct 22, 23, 26
    oct28 = {"fetched": "2026-10-28T02:16:03Z", "quotes": {
        "milk": q({"2026-10-26": 15.25}),
        "milk-oct26": q({"2026-10-22": 15.289999961853027, "2026-10-23": 15.25, "2026-10-26": 15.25}),
        "milk-nov26": q({"2026-10-22": 17.68000030517578, "2026-10-23": 17.850000381469727, "2026-10-26": 17.940000534057617}),
        "milk-dec26": q({"2026-10-26": 16.610000610351562}),
        "milk-nearby": q({"2026-10-26": 15.25})}}
    now = datetime.datetime(2026, 10, 28, 3, tzinfo=datetime.timezone.utc)
    lg = update({}, oct28, {"class_month_key": "2026-09", "class3": 16.04}, now)
    ck("October has no month-start price: its first settle we held is Oct 22, after the month began",
       "said" not in lg["months"].get("2026-10", {}), lg["months"].get("2026-10"))
    ck("November and December are pending, nothing said yet", "said" not in lg["months"]["2026-11"] and "2026-12" in lg["months"])
    ck("the aliases (milk, milk-nearby) are not contract months", set(lg["months"]) <= {"2026-10", "2026-11", "2026-12"}, list(lg["months"]))
    ck("September, announced, never had a held price: no row invented", "2026-09" not in lg["months"])
    # Nov 2: the file now carries the Oct 30 (Friday) settle for November
    nov2 = {"fetched": "2026-11-02T15:00:00Z", "quotes": {
        "milk-nov26": q({"2026-10-28": 17.7, "2026-10-29": 17.81, "2026-10-30": 17.86})}}
    t2 = datetime.datetime(2026, 11, 2, 15, tzinfo=datetime.timezone.utc)
    lg2 = update(lg, nov2, {"class_month_key": "2026-10", "class3": 15.31}, t2)
    n = lg2["months"]["2026-11"]
    ck("Nov said = Fri Oct 30 settle 17.86", n.get("said") == 17.86 and n.get("said_session") == "2026-10-30", n)
    ck("October, announced, was never held at month start: no row, no miss", "2026-10" not in lg2["months"], lg2["months"].get("2026-10"))
    # a later file with a different Oct 30 value never moves the said
    late = {"fetched": "2026-11-05T15:00:00Z", "quotes": {"milk-nov26": q({"2026-10-30": 19.0, "2026-11-04": 18.0})}}
    lg3 = update(lg2, late, {}, datetime.datetime(2026, 11, 5, tzinfo=datetime.timezone.utc))
    ck("a written said never changes", lg3["months"]["2026-11"]["said"] == 17.86)
    # Dec 3: November announced
    lg4 = update(lg3, {}, {"class_month_key": "2026-11", "class3": 17.5, "class_release": "2026-12-02"},
                 datetime.datetime(2026, 12, 3, tzinfo=datetime.timezone.utc))
    ck("Nov miss = 17.50 - 17.86 = -0.36", lg4["months"]["2026-11"].get("miss") == -0.36, lg4["months"]["2026-11"])
    # a month first seen only well after it began gets no said (look-ahead guard)
    stale = {"fetched": "2027-01-20T15:00:00Z", "quotes": {"milk-jan27": q({"2027-01-15": 16.0, "2027-01-19": 16.1})}}
    lg5 = update({}, stale, {}, datetime.datetime(2027, 1, 20, tzinfo=datetime.timezone.utc))
    ck("no said from a session inside the month", "said" not in lg5["months"].get("2027-01", {}), lg5["months"])
    gap = {"fetched": "2027-01-04T15:00:00Z", "quotes": {"milk-jan27": q({"2026-12-24": 16.0})}}
    lg6 = update({}, gap, {}, datetime.datetime(2027, 1, 4, tzinfo=datetime.timezone.utc))
    ck("a settle a week before the 1st is not the month-start price", "said" not in lg6["months"].get("2027-01", {}), lg6["months"])
    sat = {"fetched": "2026-11-02T15:00:00Z", "quotes": {"milk-nov26": q({"2026-10-31": 17.0})}}
    ck("a Saturday-dated settle is never the month-start price",
       "said" not in update({}, sat, {}, t2)["months"].get("2026-11", {}))
    print()
    if fails:
        print(f"{len(fails)} FAILED")
        return 1
    print("all milk miss checks pass")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    run()
