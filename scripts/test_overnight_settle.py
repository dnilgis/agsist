#!/usr/bin/env python3
"""test_overnight_settle.py — offline selftest for the settle / last-trade
split in fetch_prices (split_settle, carried_settles, fetch_quote).

Rewritten 2026-10-17 (fetch_prices v3.7). The v3.6 version of this file
pinned the Oct 14 corn "settle" at 481.00 because data/harvest-prices.json
said 4.81 that evening. Both numbers were Yahoo's afternoon bar, the last
trade. The same file now reads Oct 14 at 4.8075 (480.75), which is what the
bar turned into overnight, and the settle. Every case on file says the same:

  Nov '26 soybeans (ZSX26.CBT)
    Oct 15 18:46 UTC  1264.25   last trade, 13:46 CT
    Oct 16 04:31 UTC  Oct 15 bar 1263.00   the settle (harvest-prices 12.63)
    Oct 16 18:46 UTC  1260.50   last trade; we printed "closed $12.60 1/2
                                (-3 3/4c)", measured from 1264.25
    CBOT settle Oct 16: 1261.25, -1.75 (Barchart, Successful Farming)
  Dec '26 corn (ZCZ26.CBT)
    Oct 15 18:46 UTC 478.25 last trade; the Oct 15 settle was 478.00
    Oct 16 settle 474.25, -3.75; we printed -4 (from 478.25)
  Dec '26 lean hogs (HEZ26.CME)
    Oct 15 18:46 UTC 66.625; 03:46 UTC Oct 16 (22:46 CT) the bar read 66.575

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


# The daily bars Yahoo served at each fetch.
BEANS_1015_1846 = [("2026-10-13", 1283.75), ("2026-10-14", 1277.25), ("2026-10-15", 1264.25)]
BEANS_1016_0316 = [("2026-10-13", 1283.75), ("2026-10-14", 1277.25), ("2026-10-15", 1262.00)]
BEANS_1016_0431 = [("2026-10-14", 1277.25), ("2026-10-15", 1263.00), ("2026-10-16", 1262.75)]
BEANS_1016_1846 = [("2026-10-14", 1277.25), ("2026-10-15", 1263.00), ("2026-10-16", 1260.50)]
BEANS_1017_0500 = [("2026-10-14", 1277.25), ("2026-10-15", 1263.00), ("2026-10-16", 1261.25)]
BEANS_1019_0030 = [("2026-10-14", 1277.25), ("2026-10-15", 1263.00), ("2026-10-16", 1258.00)]
CORN_1016_1846 = [("2026-10-14", 480.75), ("2026-10-15", 478.00), ("2026-10-16", 474.25)]
HOGS_1015_1846 = [("2026-10-13", 68.025), ("2026-10-14", 66.075), ("2026-10-15", 66.625)]
HOGS_1016_0346 = [("2026-10-13", 68.025), ("2026-10-14", 66.075), ("2026-10-15", 66.575)]
CRUDE_1846 = [("2026-10-12", 93.74), ("2026-10-13", 94.14), ("2026-10-14", 95.08)]
CRUDE_2346 = [("2026-10-12", 93.74), ("2026-10-13", 94.14), ("2026-10-14", 94.82)]

# The 18:46 UTC Oct 16 quote as fetch_prices v3.6 wrote it: its `settles`
# map is the afternoon's last trades, and has no settles_v mark.
OLD_V36 = {"ticker": "ZSX26.CBT", "close": 1260.5, "open": 1264.25, "netChange": -3.75,
           "close_date": "2026-10-16", "prev_date": "2026-10-15", "prev_source": "recorded settle",
           "settles": {"2026-10-15": 1264.25, "2026-10-16": 1260.5}}


class _Info:
    def __init__(self, last):
        self.last_price = last
        self.year_high = 1400.0
        self.year_low = 50.0


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
    _stub(sym, bars)
    return fetch_prices.fetch_quote(key, sym, now=now, carried=carried)


def carry(q):
    """What the next run carries from quote q."""
    return fetch_prices.carried_settles("x", q)


def main():
    ok = True

    def chk(cond, msg):
        nonlocal ok
        print(("  OK   " if cond else "  FAIL ") + msg)
        if not cond:
            ok = False

    print("test_overnight_settle selftest (v3.7: settle vs last trade)")

    # 1. Oct 16, 1:46 p.m. CT. The bar is the last trade; the change is from
    #    the Oct 15 settle (1263.00, an older bar), not v3.6's 1264.25.
    q = quote("beans-nov26", "ZSX26.CBT", BEANS_1016_1846, at("2026-10-16T18:46:22Z"))
    chk(q["close"] == 1260.5 and q["close_kind"] == "last",
        "13:46 CT Oct 16: 1260.50 is a last trade, not a close (%s)" % q.get("close_kind"))
    chk(q.get("close_time") == "2026-10-16T18:20:00Z", "13:46 CT: the trade is dated to the 1:20 p.m. CT bell")
    chk(q["open"] == 1263.0 and q.get("prev_kind") == "settle", "13:46 CT: previous settle 1263.00")
    chk(q["netChange"] == -2.5, "13:46 CT: change -2.50 from the settle, not -3.75 (%s)" % q["netChange"])
    chk(q.get("settle") == 1263.0 and q.get("settle_date") == "2026-10-15" and q.get("settle_net") == -14.25,
        "13:46 CT: newest settle on file is Oct 15 1263.00, -14.25")
    chk("prev_source" not in q, "13:46 CT: no afternoon trade stands in for a settle")
    chk(q.get("day_last", {}).get("2026-10-16", {}).get("px") == 1260.5,
        "13:46 CT: the day-session last trade is kept for the evening")

    # 2. The v3.6 map is not carried: its "settles" were last trades.
    chk(fetch_prices.carried_settles("beans-nov26", OLD_V36, "2026-10-16T18:46:22Z")
        == {"settles": {}, "day_last": {}}, "a v3.6 settles map (no settles_v) is not carried")
    q = quote("beans-nov26", "ZSX26.CBT", BEANS_1016_1846, at("2026-10-16T18:46:22Z"),
              carried=fetch_prices.carried_settles("beans-nov26", OLD_V36))
    chk(q["open"] == 1263.0, "first run after v3.6: previous settle is the bar's 1263.00, not 1264.25")

    # 3. Saturday 00:00 CT: Yahoo has swapped the Friday bar for the settle.
    q = quote("beans-nov26", "ZSX26.CBT", BEANS_1017_0500, at("2026-10-17T05:00:00Z"))
    chk(q["close"] == 1261.25 and q["close_kind"] == "settle" and "close_time" not in q,
        "Sat 00:00 CT: settled 1261.25 (the CBOT settle)")
    chk(q["netChange"] == -1.75, "Sat 00:00 CT: -1.75, the CBOT change")
    chk(q.get("settle") == 1261.25 and q.get("settle_date") == "2026-10-16" and q.get("settle_net") == -1.75,
        "Sat 00:00 CT: settle fields name Oct 16, -1.75")
    chk(q.get("settles", {}).get("2026-10-16") == 1261.25 and q.get("settles_v") == fetch_prices.SETTLES_V,
        "Sat 00:00 CT: the settle is recorded for Sunday evening")

    # 3b. Friday 10:00 p.m. CT: too early to trust the bar.
    q = quote("beans-nov26", "ZSX26.CBT", BEANS_1016_1846, at("2026-10-17T03:00:00Z"))
    chk(q["close_kind"] == "last", "Fri 22:00 CT: still the last trade")

    # 4. Sunday 7:30 p.m. CT: the evening session trades into the Friday bar.
    #    Friday's settle (recorded Saturday) stays the close; the trade is last.
    rec = carry(quote("beans-nov26", "ZSX26.CBT", BEANS_1017_0500, at("2026-10-17T05:00:00Z")))
    q = quote("beans-nov26", "ZSX26.CBT", BEANS_1019_0030, at("2026-10-19T00:30:00Z"), carried=rec)
    chk(q["close"] == 1261.25 and q["close_kind"] == "settle" and q["close_date"] == "2026-10-16",
        "Sun 19:30 CT: Friday's settle 1261.25 stays the close")
    chk(q.get("last") == 1258.0 and q.get("last_date") == "2026-10-19" and q.get("last_net") == -3.25,
        "Sun 19:30 CT: 1258.00 is Monday's trade, -3.25 from the settle")

    # 5. A weekday evening: Oct 15 22:16 CT. The Oct 15 bar holds overnight
    #    trades; its settle is not posted yet. The close is the afternoon's
    #    last trade, worded as one, and the overnight trade is last.
    rec = carry(quote("beans-nov26", "ZSX26.CBT", BEANS_1015_1846, at("2026-10-15T18:46:00Z")))
    q = quote("beans-nov26", "ZSX26.CBT", BEANS_1016_0316, at("2026-10-16T03:16:00Z"), carried=rec)
    chk(q["close"] == 1264.25 and q["close_kind"] == "last" and q.get("close_time") == "2026-10-15T18:20:00Z",
        "22:16 CT Oct 15: close is the 1:20 p.m. last trade 1264.25, kind last")
    chk(q["open"] == 1277.25 and q.get("last") == 1262.0 and q.get("settled") is True,
        "22:16 CT Oct 15: change from the Oct 14 settle; 1262.00 kept as last")
    chk(q.get("settle") == 1277.25 and q.get("settle_date") == "2026-10-14",
        "22:16 CT Oct 15: the newest settle is Oct 14's")

    # 6. 23:31 CT Oct 15: Yahoo opened the Oct 16 bar and put the settle in
    #    the Oct 15 bar (1263.00). The change is from 1263.00, not the
    #    afternoon trade 1264.25 kept in day_last.
    rec2 = carry(q)
    q = quote("beans-nov26", "ZSX26.CBT", BEANS_1016_0431, at("2026-10-16T04:31:00Z"), carried=rec2)
    chk(q["close"] == 1262.75 and q["close_kind"] == "last" and q["open"] == 1263.0,
        "23:31 CT: Oct 16 overnight trade against the Oct 15 settle 1263.00")
    chk(q["netChange"] == -0.25, "23:31 CT: change -0.25 (v3.6 printed -1.50 from 1264.25)")

    # 7. Corn Oct 16 1:46 p.m. CT: -3.75 from the 478.00 settle (we printed -4).
    q = quote("corn-dec26", "ZCZ26.CBT", CORN_1016_1846, at("2026-10-16T18:46:22Z"))
    chk(q["netChange"] == -3.75 and q["open"] == 478.0 and q["close_kind"] == "last",
        "corn 13:46 CT Oct 16: -3.75 from the 478.00 settle, worded as a last trade")

    # 8. Lean hogs, no evening session: 22:46 CT is before the bar is trusted
    #    (it had in fact just turned to 66.575); 23:31 CT it is the settle.
    q = quote("hogs-dec26", "HEZ26.CME", HOGS_1015_1846, at("2026-10-15T18:46:00Z"))
    chk(q["close_kind"] == "last" and q.get("close_time") == "2026-10-15T18:05:00Z",
        "hogs 13:46 CT: last trade as of the 1:05 p.m. CT bell")
    q = quote("hogs-dec26", "HEZ26.CME", HOGS_1016_0346, at("2026-10-16T03:46:00Z"))
    chk(q["close_kind"] == "last", "hogs 22:46 CT: not yet called a settle")
    q = quote("hogs-dec26", "HEZ26.CME", HOGS_1016_0346, at("2026-10-16T04:31:00Z"))
    chk(q["close_kind"] == "settle" and q["close"] == 66.575 and q["netChange"] == 0.5,
        "hogs 23:31 CT: settled 66.575, +0.50")

    # 9. Crude settles mid-session; the bar is never called a settle.
    q = quote("crude", "CL=F", CRUDE_1846, at("2026-10-14T18:46:00Z"))
    chk(q["close"] == 95.08 and q["close_kind"] == "last" and "settle" not in q,
        "crude 13:46 CT: a trade, no settle field")
    q = quote("crude", "CL=F", CRUDE_2346, at("2026-10-14T23:46:00Z"))
    chk(q["close"] == 94.14 and q["close_date"] == "2026-10-13" and q.get("settle_pending") == "2026-10-14"
        and q["close_kind"] == "last", "crude 18:46 CT: 94.82 not called the Oct 14 close")
    chk(q.get("last") == 94.82, "crude 18:46 CT: 94.82 kept as last")
    q = quote("crude", "CL=F", CRUDE_1846, at("2026-10-15T06:00:00Z"))
    chk(q["close_kind"] == "last", "crude after midnight: still never a settle")

    # 10. Indexes and crypto have no session table: bars pass through.
    r = fetch_prices.split_settle("sp500", [("2026-10-13", 1.0), ("2026-10-14", 2.0)], at("2026-10-15T03:16:00Z"))
    chk(r["close"] == 2.0 and r["close_kind"] is None and not r.get("settled") and "settles" not in r,
        "sp500: untouched, no close_kind")

    # 11. A bar still dated Oct 15 after the Oct 16 close is a missing bar from
    #     a finished day: the settle, not evening trades.
    r = fetch_prices.split_settle("beans-nov26", BEANS_1015_1846, at("2026-10-16T19:00:00Z"))
    chk(not r.get("settled") and r["close_kind"] == "settle", "missing bar after the next close: an old settle")

    # 12. The maps stay short.
    many = {"settles": {"2026-10-0%d" % i: 400.0 + i for i in range(1, 8)}, "day_last": {}}
    r = fetch_prices.split_settle("beans-nov26", BEANS_1016_1846, at("2026-10-16T18:46:00Z"), many)
    chk(len(r["settles"]) == fetch_prices.SETTLES_KEPT and "2026-10-15" in r["settles"],
        "settles keeps the newest %d dates" % fetch_prices.SETTLES_KEPT)

    # 13. seed_static words them right: a last trade is never "settled".
    import seed_static
    q = quote("beans-nov26", "ZSX26.CBT", BEANS_1016_1846, at("2026-10-16T18:46:22Z"))
    st, lab = seed_static.quote_state(q, "2026-10-16T18:46:22Z")
    chk(st is True and lab == "Oct 16, 1:20 p.m. CT", "seed_static: last trade at the 1:20 p.m. CT bell (%s)" % lab)
    sc = seed_static.settled_close(q, "2026-10-16T18:46:22Z")
    chk(sc and sc["px"] == 1263.0 and sc["date"] == "2026-10-15", "seed_static: bakes the Oct 15 settle (%s)" % sc)
    q = quote("beans-nov26", "ZSX26.CBT", BEANS_1017_0500, at("2026-10-17T05:00:00Z"))
    chk(seed_static.quote_state(q, "2026-10-17T05:00:00Z") == (False, "Oct 16"), "seed_static: settled Oct 16")
    sc = seed_static.settled_close(q, "2026-10-17T05:00:00Z")
    chk(sc and sc["px"] == 1261.25 and sc["net"] == -1.75, "seed_static: $12.61 1/4, -1 3/4")
    chk(seed_static.quote_state(OLD_V36, "2026-10-16T18:46:22Z")[0] is not False,
        "seed_static: a v3.6 quote fetched at 1:46 p.m. CT is not called settled")

    print("PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
