#!/usr/bin/env python3
"""test_daily_timing.py: each price in the Daily's prompt carries its OWN session.

CME livestock has no overnight session. At the 10:46Z pull its price is the
prior session's settle, and the change is against the session before that.
The prompt used to call the whole board OVERNIGHT and label every previous
settle with the board's previous session, so the Oct 15 2026 issue printed
"from Wednesday's $224.62 settle" for Tuesday's $224.625.

The cases are the saved morning price files (minimal copies in
test/fixtures/daily-timing/):
  Oct 13 (Tue after Columbus Day): cattle is Mon Oct 12's settle vs Fri Oct 9's.
  Oct 15 (Thu): cattle is Wed Oct 14's settle vs Tue Oct 13's; milk is stale.
  Oct 16 (Fri 1:46 p.m. CT): hogs repaired to a fresh Dec '26 quote must not
  read as stale.

Run: python3 scripts/test_daily_timing.py
"""
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import generate_daily as g  # noqa: E402
import preflight_prices  # noqa: E402

FIX = Path(HERE).parent / "test" / "fixtures" / "daily-timing"
OPEN = {"is_closed": False}

ok = True


def chk(cond, msg, got=""):
    global ok
    print(("  OK   " if cond else "  FAIL ") + msg + ("" if cond or not got else "\n         got: %s" % got))
    if not cond:
        ok = False


def load(feed):
    """load_prices() on `feed` (a dict), with the front-month gate run as of the
    fetch time so the fixture means the same thing on any later day."""
    fetched = datetime.fromisoformat(feed["fetched"].replace("Z", "+00:00"))
    real_run = preflight_prices.run
    preflight_prices.run = lambda data, today=None, repair=False: real_run(data, today=fetched, repair=repair)
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "prices.json"
        p.write_text(json.dumps(feed))
        old = g.PRICES_PATH
        g.PRICES_PATH = p
        try:
            pdata, surprises = g.load_prices()
        finally:
            g.PRICES_PATH = old
            preflight_prices.run = real_run
    t = g.quote_timing(pdata["fetched"], OPEN, pdata["locked_changes"], pdata["locked_prices"])
    return pdata, surprises, t, g.price_timing_block(t)


def fixture(day):
    return json.loads((FIX / ("prices-2026-%s.json" % day)).read_text())


def row(block, label):
    return [x for x in block.splitlines() if x.lstrip().startswith(label + ":")]


def prev_list(blk):
    """The lines under PREVIOUS SETTLES, up to the next section."""
    out, on = [], False
    for x in blk.splitlines():
        if x.startswith("PRICE TIMING"):
            on = True
            continue
        if on and not x.startswith("  "):
            break
        if on:
            out.append(x)
    return out


print("test_daily_timing selftest")

print("\nOct 15 2026, 10:46Z Thursday")
pdata, surprises, t, blk = load(fixture("10-15"))
cattle = row(pdata["price_block"], "Live Cattle")
chk(cattle and "$223.90" in cattle[0] and "[settle Wed Oct 14, change vs Tue Oct 13 settle; livestock has no overnight session]" in cattle[0],
    "the cattle price line says it is the Wed Oct 14 settle against Tue Oct 13", cattle)
chk("last trade" not in (cattle[0] if cattle else ""), "and never a 5:46 a.m. last trade", cattle)
chk(pdata["locked_changes"]["cattle"].get("date") == "2026-10-14"
    and pdata["locked_changes"]["cattle"].get("prev_date") == "2026-10-13",
    "the lock keeps the quote's own close_date and prev_date", pdata["locked_changes"]["cattle"])
chk("OVERNIGHT quotes" in blk and "PREVIOUS SETTLES (Wed Oct 14)" in blk, "the grain board is still overnight vs Wed Oct 14")
chk(not [x for x in prev_list(blk) if "Cattle" in x or "Hogs" in x],
    "no livestock price sits under the Wed Oct 14 previous settles", prev_list(blk))
chk("  Live Cattle: SETTLED Wed Oct 14 at $223.90 vs Tue Oct 13 settle $224.625 (livestock has no overnight session)" in blk,
    "the timing block names cattle's own session and the previous settle by ITS day, to the tick", blk)
chk("  Feeder Cattle: SETTLED Wed Oct 14 at $340.95 vs Tue Oct 13 settle $343.075" in blk, "feeders the same")
chk("224.62\n" not in blk and "224.62 " not in blk, "livestock is never cut to 224.62")
chk("S&P 500: CLOSED Wed Oct 14" in blk and "vs Tue Oct 13 close" in blk, "the S&P 500 is Wednesday's close, an index close not a settle")
chk(not g.close_claims_on_live_quotes("Live cattle settled at $223.90 Wednesday.", t),
    "'cattle settled $223.90' (the Wed settle) is allowed")
chk(not g.close_claims_on_live_quotes("Live cattle slipped from Tuesday's $224.62 settle.", t),
    "the Tue settle may be called a settle")
chk(g.close_claims_on_live_quotes("Soybeans closed $12.73 1/4, down 4 cents.", t), "an overnight bean quote called a close is still refused")

milk = row(pdata["price_block"], "Class III Milk")
chk(milk and "[STALE: last settle Tue Oct 13; report no move]" in milk[0], "stale milk says STALE with its own date", milk)
chk(milk and not any(w in milk[0] for w in ("FLAT", "UP ", "DN ", "%)")), "and carries no arrow or change", milk)
chk("Class III Milk: no fresh quote, last price from Tue Oct 13" in blk and "never call it flat" in blk,
    "the timing block lists milk as stale")
chk(not [x for x in prev_list(blk) if "Milk" in x], "a stale quote's previous close is not offered as a settle")
chk(pdata["locked_changes"]["milk"].get("stale") is True, "the lock marks it stale")

print("\nOct 13 2026, 10:46Z Tuesday after Columbus Day")
pdata, surprises, t, blk = load(fixture("10-13"))
chk("PREVIOUS SETTLES (Mon Oct 12)" in blk, "grains measured against Mon Oct 12 (CBOT traded Columbus Day)")
chk("  Live Cattle: SETTLED Mon Oct 12 at $224.75 vs Fri Oct 9 settle $224.975 (livestock has no overnight session)" in blk,
    "cattle is Monday's settle against FRIDAY's, not Monday's", blk)
chk(not [x for x in prev_list(blk) if "Cattle" in x], "no cattle price is labeled Mon Oct 12's previous settle")

print("\nOct 16 2026, 18:46Z Friday (1:46 p.m. CT)")
pdata, surprises, t, blk = load(fixture("10-16"))
hogs = row(pdata["price_block"], "Lean Hogs")
chk(hogs and "$66.875" in hogs[0] and "STALE" not in hogs[0] and "(UP" in hogs[0],
    "hogs re-repaired to a fresh Dec '26 quote are not called stale", hogs)
chk("Lean Hogs: $66.575" in blk and "STALE (" not in blk, "and their Oct 15 settle is a previous settle", blk)
chk("PREVIOUS SETTLES (Thu Oct 15)" in blk and "LAST TRADE quotes" in blk, "the board is a last-trade board vs Thu Oct 15")

print("\nA stale row is never called flat")
feed = {"fetched": "2026-10-15T10:46:08Z", "quotes": {
    "corn": {"ticker": "ZC=F", "close": 480.0, "open": 480.75, "netChange": -0.75, "pctChange": -0.156,
             "close_date": "2026-10-15", "prev_date": "2026-10-14"},
    "milk": {"ticker": "DC=F", "close": 15.05, "open": 15.05, "netChange": 0.0, "pctChange": 0.0,
             "close_date": "2026-10-13", "prev_date": "2026-10-12", "stale": True, "stale_since": "2026-10-14"},
    "crude": {"ticker": "CL=F", "close": 93.8, "open": 95.09, "netChange": -1.29, "pctChange": -9.0,
              "close_date": "2026-10-14", "prev_date": "2026-10-13", "stale": True}}}
pdata, surprises, t, blk = load(feed)
m = row(pdata["price_block"], "Class III Milk")
chk(m and "FLAT" not in m[0] and "+0.0%" not in m[0] and "[STALE: last settle Tue Oct 13; report no move]" in m[0],
    "a stale zero-change row has no FLAT and no +0.0%", m)
chk(not [s for s in surprises if s["key"] == "crude"], "a stale row is never an overnight surprise", surprises)
c = row(pdata["price_block"], "WTI Crude Oil")
chk(c and "[STALE: last settle Wed Oct 14; report no move]" in c[0], "a stale crude row says STALE", c)
b = {"headline": "Corn eases", "lead": "Corn is trading at $4.80. Milk was flat at $15.05.", "sections": []}
_, w = g.validate_briefing(b, pdata["locked_prices"], t)
sw = [x for x in w if x.startswith("Stale quote called flat")]
chk(sw and "milk" in sw[0].lower(), "the validator flags 'milk was flat' on a stale quote", w)
b2 = {"headline": "Corn eases", "lead": "Corn is trading at $4.80, flat on the night.", "sections": []}
_, w2 = g.validate_briefing(b2, pdata["locked_prices"], t)
chk(not [x for x in w2 if x.startswith("Stale quote called flat")], "a fresh quote called flat is not flagged", w2)

print("\nA repaired alias carries its source's freshness (preflight)")
data = {"fetched": "2026-10-16T18:46:22Z", "stale_keys": ["hogs"], "quotes": {}}
cont = {"close_date": "2026-10-15", "stale": True, "stale_since": "2026-10-16", "stale_reason": "repaired-from-older-session"}
old = preflight_prices._carry_dates(cont, {"close_date": "2026-10-16", "prev_date": "2026-10-15"}, data, "hogs")
chk(old is False and not cont.get("stale") and "hogs" not in data["stale_keys"],
    "a fresh source clears a stale tag an earlier repair left", (cont, data["stale_keys"]))
cont = {"close_date": "2026-10-16"}
old = preflight_prices._carry_dates(cont, {"close_date": "2026-10-16", "stale": True, "stale_since": "2026-10-15"}, data, "hogs")
chk(old is True and cont.get("stale") is True and "hogs" in data["stale_keys"], "a stale source makes the alias stale")

print("\nCalendar")
chk("CME livestock: 1:05 PM CT" in g.CALENDAR_FACTS_2026 and "livestock: 1:00 PM" not in g.CALENDAR_FACTS_2026,
    "CME livestock closes 1:05 PM CT")

print("PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
