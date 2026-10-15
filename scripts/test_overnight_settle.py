#!/usr/bin/env python3
"""test_overnight_settle.py — offline selftest for the evening-session split in
fetch_prices (split_settle, carried_settles, fetch_quote) (2026-10-15).

The case it pins is real. data/prices.json, Dec corn (ZCZ26.CBT):
  2026-10-14 18:46 UTC  481.00  close_date Oct 14, prev 482.75 Oct 13
  2026-10-15 00:01 UTC  481.00  (19:01 CT, the overnight just open)
  2026-10-15 03:16 UTC  478.75  close_date Oct 14   <- an overnight trade
  2026-10-15 04:16 UTC  478.75  close_date Oct 15, prev 480.75 Oct 14
The CBOT settles in data/harvest-prices.json: Oct 12 4.83, Oct 13 4.8275,
Oct 14 4.81. So the Oct 14 close is 481.00 and the 03:16 file printed a trade
as a close, 2 1/4 cents off, with the change measured from Oct 13.
WTI crude (CL=F) the same evening: 18:46 UTC 95.08 Oct 14 (a trade, the
session runs to 16:00 CT), 23:46 UTC 94.82 Oct 14 (the 17:00 CT reopen).

No network: yfinance is replaced by a stub for the fetch_quote cases. Run:
    python3 scripts/test_overnight_settle.py
"""
import sys
from datetime import datetime, timezone

sys.path.insert(0, "scripts")
import fetch_prices

UTC = timezone.utc


def at(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)


# The daily bars Yahoo served at each fetch (the two newest from the files
# above; Oct 12 is the 4.83 settle).
CORN_1846 = [("2026-10-12", 483.0), ("2026-10-13", 482.75), ("2026-10-14", 481.0)]
CORN_0316 = [("2026-10-12", 483.0), ("2026-10-13", 482.75), ("2026-10-14", 478.75)]
CORN_0416 = [("2026-10-13", 482.75), ("2026-10-14", 480.75), ("2026-10-15", 478.75)]
CRUDE_2346 = [("2026-10-12", 93.74), ("2026-10-13", 94.14), ("2026-10-14", 94.82)]
CRUDE_1846 = [("2026-10-12", 93.74), ("2026-10-13", 94.14), ("2026-10-14", 95.08)]
CATTLE_0316 = [("2026-10-12", 224.75), ("2026-10-13", 224.625), ("2026-10-14", 223.95)]

# The 18:46 UTC Oct 14 quote as fetch_prices v3.5 wrote it (no settles map).
OLD_1846 = {"ticker": "ZCZ26.CBT", "close": 481.0, "open": 482.75,
            "netChange": -1.75, "pctChange": -0.3625,
            "close_date": "2026-10-14", "prev_date": "2026-10-13"}


class _Info:
    def __init__(self, last):
        self.last_price = last
        self.year_high = 520.0
        self.year_low = 400.0


class _Ticker:
    BARS = {}

    def __init__(self, sym):
        self.sym = sym
        self.fast_info = _Info(self.BARS[sym][-1][1])


def _stub(sym, bars):
    _Ticker.BARS = {sym: bars}
    fetch_prices.yf.Ticker = _Ticker
    fetch_prices._bars = lambda t: list(_Ticker.BARS[t.sym])


def quote(key, sym, bars, now, carried=None):
    """fetch_quote with stubbed bars. Before 2026-10-15 fetch_quote took no
    time or settles; calling it the old way is what shows the bug."""
    _stub(sym, bars)
    try:
        return fetch_prices.fetch_quote(key, sym, now=now, carried=carried)
    except TypeError:
        return fetch_prices.fetch_quote(key, sym)


def main():
    ok = True

    def chk(cond, msg):
        nonlocal ok
        print(("  OK   " if cond else "  FAIL ") + msg)
        if not cond:
            ok = False

    print("test_overnight_settle selftest")

    # 1. The 18:46 UTC run (13:46 CT, after the 13:20 close, before the 19:00
    #    reopen) records Oct 14's close and prints it unchanged.
    q = quote("corn-dec26", "ZCZ26.CBT", CORN_1846, at("2026-10-14T18:46:00Z"))
    chk(q and q["close"] == 481.0 and q["close_date"] == "2026-10-14", "13:46 CT: close 481.00 Oct 14")
    chk(q and q.get("settles", {}).get("2026-10-14") == 481.0, "13:46 CT: Oct 14 settle recorded for the evening")
    chk(q and not q.get("settled") and "last" not in q, "13:46 CT: no evening trade to split off")
    rec = (q or {}).get("settles", {})

    # 2. The 03:16 UTC run (22:16 CT, overnight): the bar dated Oct 14 holds
    #    478.75. Close stays 481.00 Oct 14, change -1.75 from Oct 13; the trade
    #    is last for Oct 15, -2.25 from that close.
    q = quote("corn-dec26", "ZCZ26.CBT", CORN_0316, at("2026-10-15T03:16:00Z"), carried=rec)
    chk(q and q["close"] == 481.0, "22:16 CT: close is 481.00, not the overnight 478.75 (got %s)" % (q or {}).get("close"))
    chk(q and q["close_date"] == "2026-10-14" and q["open"] == 482.75 and q["prev_date"] == "2026-10-13",
        "22:16 CT: Oct 14 close against the Oct 13 close")
    chk(q and q["netChange"] == -1.75, "22:16 CT: change -1.75, the Oct 14 day")
    chk(q and q.get("last") == 478.75 and q.get("last_date") == "2026-10-15",
        "22:16 CT: 478.75 kept as last, trade date Oct 15")
    chk(q and q.get("last_net") == -2.25, "22:16 CT: last is -2.25 from the Oct 14 close")
    chk(q and q.get("last_time") == "2026-10-15T03:16:00Z", "22:16 CT: last_time is the fetch time")
    chk(q and q.get("settled") is True and "settle_pending" not in q, "22:16 CT: marked settled, nothing pending")

    # 3. The first run after this change has no settles map: the 18:46 file's
    #    own close was fetched in the clean window, so it is carried.
    boot = fetch_prices.carried_settles("corn-dec26", OLD_1846, "2026-10-14T18:46:01Z")
    chk(boot == {"2026-10-14": 481.0}, "bootstrap: the 18:46 file's close is Oct 14's settle (%s)" % boot)
    chk(fetch_prices.carried_settles("corn-dec26", dict(OLD_1846, close=478.75), "2026-10-15T03:16:01Z") == {},
        "bootstrap: a file fetched in the overnight carries nothing")
    chk(fetch_prices.carried_settles("corn-dec26", dict(OLD_1846, stale=True), "2026-10-14T18:46:01Z") == {},
        "bootstrap: a stale quote carries nothing")

    # 4. No settle on record at all: the newest close known is Oct 13, printed
    #    under Oct 13 with its own change; Oct 14 is named as pending.
    q = quote("corn-dec26", "ZCZ26.CBT", CORN_0316, at("2026-10-15T03:16:00Z"), carried={})
    chk(q and q["close"] == 482.75 and q["close_date"] == "2026-10-13", "no record: close steps back to Oct 13 482.75")
    chk(q and q["open"] == 483.0 and q["netChange"] == -0.25, "no record: Oct 13 change -0.25 from Oct 12")
    chk(q and q.get("settle_pending") == "2026-10-14" and q.get("last_net") is None,
        "no record: Oct 14 pending, the trade's change withheld")

    # 5. 04:16 UTC: Yahoo opened the Oct 15 bar and rewrote Oct 14 to 480.75.
    #    The trade is the Oct 15 session's (close_date Oct 15, as in the day
    #    session); the base is the recorded 481.00, not 480.75.
    q = quote("corn-dec26", "ZCZ26.CBT", CORN_0416, at("2026-10-15T04:16:00Z"), carried=rec)
    chk(q and q["close"] == 478.75 and q["close_date"] == "2026-10-15", "23:16 CT: Oct 15 bar is a trade of Oct 15")
    chk(q and q["open"] == 481.0 and q.get("prev_source") == "recorded settle",
        "23:16 CT: change measured from the recorded 481.00, not Yahoo's 480.75")
    chk(q and q["netChange"] == -2.25 and not q.get("settled"), "23:16 CT: change -2.25, no split")

    # 6. Crude: settles 13:30 CT and trades to 16:00, so nothing is recorded
    #    from the bar, and the 17:00 reopen buries Oct 14 the same way.
    q = quote("crude", "CL=F", CRUDE_1846, at("2026-10-14T18:46:00Z"))
    chk(q and q["close"] == 95.08 and not q.get("settles") and not q.get("settled"),
        "crude 13:46 CT: an in-session trade, nothing recorded")
    q = quote("crude", "CL=F", CRUDE_2346, at("2026-10-14T23:46:00Z"), carried={})
    chk(q and q["close"] == 94.14 and q["close_date"] == "2026-10-13" and q.get("settle_pending") == "2026-10-14",
        "crude 18:46 CT: 94.82 is not called the Oct 14 close; Oct 13 94.14 under its date")
    chk(q and q.get("last") == 94.82 and q.get("last_date") == "2026-10-15", "crude 18:46 CT: 94.82 kept as last")

    # 7. Live cattle has no evening session: the Oct 14 bar at 22:16 CT is
    #    the close, untouched.
    q = quote("cattle", "LE=F", CATTLE_0316, at("2026-10-15T03:16:00Z"))
    chk(q and q["close"] == 223.95 and q["close_date"] == "2026-10-14" and not q.get("settled"),
        "cattle 22:16 CT: Oct 14 close stands")

    # 8. Friday close, Sunday reopen: Saturday is clean; Sunday 19:30 CT is not.
    fri = [("2026-10-15", 480.0), ("2026-10-16", 482.0)]
    r = fetch_prices.split_settle("corn-dec26", fri, at("2026-10-17T15:00:00Z"))
    chk(r["close"] == 482.0 and r["settles"].get("2026-10-16") == 482.0 and not r.get("settled"),
        "Saturday: Friday's close recorded and printed")
    sun = [("2026-10-15", 480.0), ("2026-10-16", 479.5)]
    r = fetch_prices.split_settle("corn-dec26", sun, at("2026-10-19T00:30:00Z"), {"2026-10-16": 482.0})
    chk(r["close"] == 482.0 and r["last"] == 479.5 and r["last_date"] == "2026-10-19",
        "Sunday 19:30 CT: Friday's 482 stays the close, 479.50 is Monday's trade")

    # 9. A bar still dated Oct 14 after the Oct 15 close is a missing bar,
    #    not evening trades: left alone.
    r = fetch_prices.split_settle("corn-dec26", CORN_1846, at("2026-10-15T19:00:00Z"), rec)
    chk(not r.get("settled") and r["close"] == 481.0, "missing bar after the next close: not split")

    # 10. Indexes and crypto have no session table: bars pass through.
    r = fetch_prices.split_settle("sp500", [("2026-10-13", 1.0), ("2026-10-14", 2.0)], at("2026-10-15T03:16:00Z"))
    chk(r["close"] == 2.0 and not r.get("settled") and r["settles"] == {}, "sp500: untouched")

    # 11. The settles map stays short.
    many = {"2026-10-0%d" % i: 400.0 + i for i in range(1, 8)}
    r = fetch_prices.split_settle("corn-dec26", CORN_1846, at("2026-10-14T18:46:00Z"), many)
    chk(len(r["settles"]) == fetch_prices.SETTLES_KEPT and "2026-10-14" in r["settles"],
        "settles keeps the newest %d dates" % fetch_prices.SETTLES_KEPT)

    # 12. seed_static bakes titles from the close. A split quote's close is a
    #     finished session, so the 22:16 CT file can say "closed Oct 14".
    import seed_static
    q = quote("corn-dec26", "ZCZ26.CBT", CORN_0316, at("2026-10-15T03:16:00Z"), carried=rec)
    sc = seed_static.settled_close(q, "2026-10-15T03:16:01Z")
    chk(sc and sc["px"] == 481.0 and sc["date"] == "2026-10-14" and sc["net"] == -1.75,
        "seed_static: the split quote reads as the Oct 14 close, -1.75 (%s)" % sc)
    chk(seed_static.quote_state(q, "2026-10-15T03:16:01Z")[0] is False, "seed_static: worded as closed")

    print("PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
