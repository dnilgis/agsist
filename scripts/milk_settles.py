#!/usr/bin/env python3
"""milk_settles.py: one Class III futures value per CME session, from
data/prices.json snapshots, with the weekend glitches left out.

Why (dairy board, Oct 27, 2026, skeptic B2): the git history of prices.json has
12 one-day Class III spikes from Mar 1 to Oct 27, 9 of them on a Saturday or
Sunday. Before dated contracts, quotes.milk was Yahoo's continuous DC=F, and
from about 04:00 UTC after a Friday session it read another bar: Jul 17 closed
17.80, the Saturday reads said 15.74 (-1.97), Monday was back near 17.6. The
Mar 4 Daily printed "crashing $4.90" off one such read. Any futures history,
correlation or Daily dairy line has to read sessions through this, not raw
snapshots.

Rules:
  * A snapshot that says what its close is (fetch_prices.py v3.7, close_kind):
    only a settle counts, dated by its settle_date, plus the dated "settles"
    the quote carries. A last trade is never a session value.
  * A legacy snapshot (no close_kind, DC=F continuous): the session is the
    weekday D, and only reads fetched from 18:00 UTC on D (after the CME
    close) to before 04:00 UTC on D+1 count; the last one wins. Reads fetched
    on a Saturday or Sunday, or outside that window, never count.
  * A session date on a Saturday or Sunday never counts.

    python3 scripts/milk_settles.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "..", "test", "fixtures", "milk-dcf-weekend-2026.json")


def _utc(s):
    try:
        return datetime.strptime(str(s).replace("Z", "+00:00")[:25], "%Y-%m-%dT%H:%M:%S%z").astimezone(timezone.utc)
    except ValueError:
        return None


def _day(s):
    try:
        return datetime.strptime(str(s or ""), "%Y-%m-%d").date()
    except ValueError:
        return None


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v > 0


def legacy_session(fetched):
    """The weekday session a legacy read belongs to, or None."""
    t = _utc(fetched)
    if t is None:
        return None
    if t.hour >= 18:
        d = t.date()
    elif t.hour < 4:
        d = t.date() - timedelta(days=1)
    else:
        return None                      # between sessions: a stale or other bar
    if t.weekday() >= 5 and t.hour >= 4:
        return None                      # Saturday or Sunday, after the Friday window
    return d if d.weekday() < 5 else None


def session_reads(snap):
    """[(session date iso, value)] one snapshot contributes for quotes.milk."""
    q = ((snap or {}).get("quotes") or {}).get("milk") if "quotes" in (snap or {}) else (snap or {}).get("milk")
    if not isinstance(q, dict):
        return []
    out = []
    if q.get("close_kind") in ("settle", "last"):
        for k, v in (q.get("settles") or {}).items():
            d = _day(k)
            if d and d.weekday() < 5 and _num(v):
                out.append((k, round(float(v), 4)))
        if q.get("close_kind") == "settle" and _num(q.get("close")):
            d = _day(q.get("close_date"))
            if d and d.weekday() < 5:
                out.append((d.isoformat(), round(float(q["close"]), 4)))
        elif _num(q.get("settle")):
            d = _day(q.get("settle_date"))
            if d and d.weekday() < 5:
                out.append((d.isoformat(), round(float(q["settle"]), 4)))
        return out
    d = legacy_session((snap or {}).get("fetched"))
    if d and _num(q.get("close")):
        out.append((d.isoformat(), round(float(q["close"]), 4)))
    return out


def series(snaps):
    """{session date: value} from snapshots in fetch order; a later read of the
    same session replaces an earlier one."""
    out = {}
    for s in sorted(snaps, key=lambda x: str((x or {}).get("fetched") or "")):
        for d, v in session_reads(s):
            out[d] = v
    return dict(sorted(out.items()))


def spikes(ser, jump=0.50):
    """Session dates whose move in and move out both exceed `jump`, in opposite
    directions (the skeptic's detector)."""
    ks = list(ser)
    bad = []
    for i in range(1, len(ks) - 1):
        a, b, c = ser[ks[i - 1]], ser[ks[i]], ser[ks[i + 1]]
        if abs(b - a) > jump and abs(c - b) > jump and (b - a) * (c - b) < 0:
            bad.append(ks[i])
    return bad


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + (f"  ({detail})" if not ok and detail else ""))
        if not ok:
            fails.append(name)

    fx = json.load(open(FIXTURE, encoding="utf-8"))
    snaps = [{"fetched": r["fetched"], "quotes": {"milk": {"ticker": r["ticker"], "close": r["close"],
                                                           "netChange": r["netChange"]}}} for r in fx["reads"]]
    raw_sat = [r["close"] for r in fx["reads"] if r["fetched"].startswith(("2026-07-18", "2026-08-01T0"))]
    ck("the fixture holds the Saturday glitch reads (15.74, 15.67)", 15.74 in raw_sat and 15.67 in raw_sat, raw_sat)
    ser = series(snaps)
    ck("Fri Jul 17 session: 17.80, the last read after the close", ser.get("2026-07-17") == 17.80, ser)
    ck("Fri Jul 31 session: 17.58, not the morning 15.65 bar", ser.get("2026-07-31") == 17.58, ser)
    ck("Mon Aug 3 session: 17.10", ser.get("2026-08-03") == 17.10, ser)
    ck("no Saturday or Sunday session", not any(_day(k).weekday() >= 5 for k in ser), ser)
    ck("no 15.6x or 15.7x value survives", not any(v < 16 for v in ser.values()), ser)
    ck("no one-day spike left", spikes(ser) == [], spikes(ser))
    # the same reads, raw, do spike: the detector itself works
    naive = {}
    for r in fx["reads"]:                # the last snapshot of each UTC day, the naive read
        naive[r["fetched"][:10]] = r["close"]
    sp = spikes(dict(sorted(naive.items())))
    ck("the naive last-snapshot-of-the-day read spikes on Sat Jul 18 and Sat Aug 1",
       "2026-07-18" in sp and "2026-08-01" in sp, sp)

    print("dated contracts (fetch_prices.py v3.7)")
    new = {"fetched": "2026-10-24T06:16:00Z", "quotes": {"milk": {
        "ticker": "DCV26.CME", "close": 15.25, "close_date": "2026-10-23", "close_kind": "settle",
        "settles": {"2026-10-22": 15.289999961853027, "2026-10-23": 15.25}}}}
    ck("a Saturday file with Friday's settle gives Friday, once", series([new]) == {"2026-10-22": 15.29, "2026-10-23": 15.25},
       series([new]))
    live = {"fetched": "2026-10-27T15:01:00Z", "quotes": {"milk": {
        "ticker": "DCV26.CME", "close": 15.23, "close_date": "2026-10-27", "close_kind": "last",
        "settle": 15.25, "settle_date": "2026-10-26"}}}
    ck("a last trade is never a session value; the settle on file is", series([live]) == {"2026-10-26": 15.25},
       series([live]))
    wk = {"fetched": "2026-10-25T06:00:00Z", "quotes": {"milk": {
        "close": 15.0, "close_date": "2026-10-24", "close_kind": "settle"}}}
    ck("a settle dated on a Saturday is dropped", series([wk]) == {})
    ck("an unreadable file gives nothing", series([{}, {"quotes": {}}, None]) == {})
    print()
    if fails:
        print(f"{len(fails)} FAILED")
        return 1
    print("all milk settle checks pass")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    print("usage: python3 scripts/milk_settles.py --selftest")
    sys.exit(2)
