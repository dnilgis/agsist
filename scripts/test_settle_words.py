#!/usr/bin/env python3
"""test_settle_words.py — the briefing may call a price closed or settled only
when the price file says it is the settle (fetch_prices v3.7 close_kind).

The case is Oct 16 2026. The 1:46 p.m. CT price file had Nov soybeans at
1260.50, a last trade; CBOT settled them at 1261.25, -1.75, and the Oct 15
settle was 1263.00. The briefing and the pages said "closed $12.60 1/2
(-3 3/4c)". Dec lean hogs settled 66.875, +0.30; the briefing said "Hogs sat
flat at $75.55", which was Oct '26 hogs, dead since Oct 14.

Run: python3 scripts/test_settle_words.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import generate_daily as g  # noqa: E402


def main():
    ok = True

    def chk(cond, msg):
        nonlocal ok
        print(("  OK   " if cond else "  FAIL ") + msg)
        if not cond:
            ok = False

    print("test_settle_words selftest")
    fetched = "2026-10-16T18:46:22Z"            # 1:46 p.m. CT Friday
    last = {"beans-nov": {"prev": 12.63, "pct": -0.198, "kind": "last"},
            "corn-dec": {"prev": 4.78, "pct": -0.784, "kind": "last"}}
    t = g.quote_timing(fetched, {"is_closed": False}, last)
    chk(t["settled"] is False and t["phase"] == "last trade",
        "1:46 p.m. CT with last-trade quotes: not settled, phase 'last trade' (%s)" % t)
    blk = g.price_timing_block(t)
    chk("NOT settlements" in blk and "not posted yet" in blk and "$12.63" in blk,
        "the prompt says they are not settlements and lists the Oct 15 settle")
    bad = g.close_claims_on_live_quotes("Soybeans closed $12.60 1/2, down 3 3/4 cents.", t)
    chk(bad, "'closed $12.60 1/2' on a last trade is refused")
    chk(not g.close_claims_on_live_quotes("Soybeans settled at $12.63 Thursday.", t),
        "the Oct 15 settle may be called settled")

    # Saturday with the settle in the file: the board is settled.
    done = {"beans-nov": {"prev": 12.63, "pct": -0.139, "kind": "settle"},
            "corn-dec": {"prev": 4.78, "pct": -0.784, "kind": "settle"}}
    t = g.quote_timing("2026-10-17T05:00:00Z", {"is_closed": True}, done)
    chk(t["settled"] is True and g.price_timing_block(t) == "", "settle quotes: settled, no warning block")

    # The weekend with only Friday's last trade on file (the Friday night run
    # missed): still not a settle, market closed or not.
    t = g.quote_timing("2026-10-17T15:00:00Z", {"is_closed": True}, last)
    chk(t["settled"] is False, "weekend on a last trade is not settled")

    # A file from before v3.7 (no kind) keeps the clock rule.
    old = {"beans-nov": {"prev": 12.6425, "pct": -0.3}}
    t = g.quote_timing("2026-10-16T15:00:00Z", {"is_closed": False}, old)
    chk(t["settled"] is False and t["phase"] == "intraday", "no kind, 10 a.m. CT: intraday")

    # The price lines name the month for livestock and say settle or last.
    import json
    import tempfile
    from pathlib import Path
    q = {"fetched": fetched, "quotes": {
        "hogs": {"ticker": "HEZ26.CME", "close": 66.875, "open": 66.575, "netChange": 0.3, "pctChange": 0.4506,
                 "contract": "Dec '26", "alias_of": "hogs-dec26", "close_kind": "last",
                 "close_date": "2026-10-16", "prev_date": "2026-10-15"},
        "hogs-dec26": {"ticker": "HEZ26.CME", "close": 66.875, "open": 66.575, "netChange": 0.3,
                       "pctChange": 0.4506, "close_date": "2026-10-16", "prev_date": "2026-10-15"}}}
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "prices.json"
        p.write_text(json.dumps(q))
        old_path = g.PRICES_PATH
        g.PRICES_PATH = p
        try:
            pdata, _ = g.load_prices()
        finally:
            g.PRICES_PATH = old_path
    line = [x for x in pdata["price_block"].splitlines() if "Lean Hogs" in x]
    # 2026-10-17: livestock print to the tick ($66.875, the site's one rule) and a last
    # trade says its hour, so the Daily and /markets name the same quote the same way.
    chk(line and "Lean Hogs Dec '26: $66.875" in line[0] and "[last trade as of 1:46 p.m. CT Fri, not the settle]" in line[0],
        "the hogs line names Dec '26, prints the tick and says it is a last trade with its hour (%s)" % line)
    q["quotes"]["crude"] = {"ticker": "CL=F", "close": 99.25, "open": 97.97, "netChange": 1.28, "pctChange": 1.3065,
                            "close_date": "2026-10-16"}       # the Oct 16 1:46 p.m. file: no close_kind
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "prices.json"
        p.write_text(json.dumps(q))
        old_path = g.PRICES_PATH
        g.PRICES_PATH = p
        try:
            pdata2, _ = g.load_prices()
        finally:
            g.PRICES_PATH = old_path
    cl = [x for x in pdata2["price_block"].splitlines() if "Crude" in x or "WTI" in x]
    chk(cl and "$99.25" in cl[0] and "[last trade as of 1:46 p.m. CT Fri, not the settle]" in cl[0],
        "a quote with no close_kind is a last trade as of the fetch, never a settle (%s)" % cl)
    chk(pdata2["locked_changes"]["crude"].get("kind") == "last" and pdata2["locked_changes"]["crude"].get("at") == fetched,
        "the lock carries kind last and the fetch time")
    chk("75.55" not in pdata["price_block"], "the dead Oct '26 price is nowhere")
    chk(pdata["locked_changes"]["hogs"].get("kind") == "last", "the lock carries the kind")

    # 2026-10-17: the watch list follows close_kind too. A last trade called a
    # close there is refused; a look-ahead "today's close" is not.
    t = g.quote_timing(fetched, {"is_closed": False}, last)
    b = {"headline": "Corn eases", "lead": "Corn is trading at $4.74.", "sections": [],
         "watch_list": [{"time": "Mon", "desc": "Corn closed $4.74 1/4; a settle under $4.70 opens $4.60."},
                        {"time": "Tue", "desc": "Watch today's close against $4.70 on Dec corn."}]}
    _, w = g.validate_briefing(b, {"corn-dec": 4.7425}, t)
    wl = [x for x in w if "(watch list)" in x]
    chk(len(wl) == 1 and "closed $4.74" in wl[0], "a watch item calling a last trade closed is refused, the look-ahead one is not (%s)" % wl)
    t2 = g.quote_timing("2026-10-17T05:00:00Z", {"is_closed": True}, done)
    _, w2 = g.validate_briefing(b, {"corn-dec": 4.7425}, t2)
    chk(not [x for x in w2 if "(watch list)" in x], "on a settled board the same watch item passes")

    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
