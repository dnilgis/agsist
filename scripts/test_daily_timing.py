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
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
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

print("\nExport Sales in a Monday-to-Wednesday federal holiday week")
from datetime import date, datetime as _real_dt  # noqa: E402


class _Clock:
    """Set generate_daily's clock (it reads datetime.now()) for a block."""
    def __init__(self, y, m, d, hh=5, mm=46):
        fixed = _real_dt(y, m, d, hh, mm)

        class FakeDT(_real_dt):
            @classmethod
            def now(cls, tz=None):
                return fixed if tz is None else fixed.replace(tzinfo=tz)
        self.fake = FakeDT

    def __enter__(self):
        self.saved = g.datetime
        g.datetime = self.fake

    def __exit__(self, *a):
        g.datetime = self.saved


def es_line(day, report_date):
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "export-sales.json"
        p.write_text(json.dumps({"report_date": report_date}))
        old = g.EXPORT_SALES_PATH
        g.EXPORT_SALES_PATH = p
        try:
            line = g.weekly_release_line(day)
            with _Clock(day.year, day.month, day.day):
                today = g.get_usda_release_today()
        finally:
            g.EXPORT_SALES_PATH = old
    es = [x.strip() for x in line.splitlines() if "Export Sales" in x]
    return (es[0] if es else ""), today


# Columbus Day, Mon Oct 12 2026. Before the release the file holds the week
# ending Oct 1; the Oct 15/16 release is the week ending Oct 8.
for d in (13, 14, 15):
    ln, _ = es_line(date(2026, 10, d), "2026-10-01")
    chk(ln.startswith("- Weekly Export Sales: Thursday, Oct 15 or Friday, Oct 16, 7:30 AM CT (federal holiday Mon Oct 12, Columbus Day")
        and "write 'Thursday or Friday'" in ln, "Oct %d: the line says Thursday or Friday" % d, ln)
ln, today = es_line(date(2026, 10, 15), "2026-10-01")
chk("USDA Weekly Export Sales, 7:30 AM CT (or Friday: FAS often releases a day late" in today and "say Thursday or Friday" in today,
    "Thu Oct 15: the release-day block hedges Friday too", today)
ln, today = es_line(date(2026, 10, 16), "2026-10-01")
chk(ln.startswith("- Weekly Export Sales: Friday, Oct 16, 7:30 AM CT (a day late after the federal holiday Mon Oct 12"),
    "Fri Oct 16 before it lands: today, not next week", ln)
chk("Oct 22" not in ln, "and no jump to Oct 22 before this week's report is on file", ln)
chk("USDA Weekly Export Sales, 7:30 AM CT (a day late" in today, "Fri Oct 16: the release-day block names it", today)
ln, today = es_line(date(2026, 10, 16), "2026-10-08")
chk(ln == "- Weekly Export Sales: Thursday, Oct 22, 7:30 AM CT", "Fri Oct 16 once the Oct 8 week is on file: next week's", ln)
chk("Export Sales" not in today, "and no release-day line", today)
ln, _ = es_line(date(2026, 10, 15), "2026-10-08")
chk("Oct 22" in ln, "a release already on file Thursday moves the line to next week", ln)
ln, _ = es_line(date(2026, 10, 12), "")
chk("Thursday, Oct 15 or Friday, Oct 16" in ln, "a missing report_date hedges")
ln, _ = es_line(date(2026, 10, 11), "2026-10-01")
chk("Thursday, Oct 15 or Friday, Oct 16" in ln, "Sunday Oct 11 looks ahead to the holiday week and hedges", ln)
# Veterans Day, Wed Nov 11 2026.
ln, _ = es_line(date(2026, 11, 9), "2026-10-29")
chk("Thursday, Nov 12 or Friday, Nov 13, 7:30 AM CT (federal holiday Wed Nov 11, Veterans Day" in ln,
    "Veterans Day week hedges the same way", ln)
ln, _ = es_line(date(2026, 11, 13), "2026-11-05")
chk("Thursday, Nov 19" in ln, "Fri Nov 13 with the Nov 5 week on file: next week's", ln)
# Thanksgiving, Thu Nov 26: the holiday is the release day itself, and
# usda_dates already moves it to Friday.
ln, _ = es_line(date(2026, 11, 23), "2026-11-12")
chk(ln == "- Weekly Export Sales: Friday, Nov 27 (moved from Thursday, Nov 26, Thanksgiving), 7:30 AM CT",
    "Thanksgiving week keeps usda_dates' Friday", ln)
# An ordinary week is untouched.
ln, _ = es_line(date(2026, 10, 20), "2026-10-08")
chk(ln == "- Weekly Export Sales: Thursday, Oct 22, 7:30 AM CT", "an ordinary week says Thursday", ln)
chk("FAS often releases it Friday" in g.CALENDAR_FACTS_2026, "the calendar block no longer says every Thursday without exception")

# 2026-11-02 audit: Oct 27's 10:46Z natural gas was a Dec trade (3.019) over the
# expiring Nov close (2.602), printed "up 16.0%". fetch_prices.energy_roll_guard
# marks it; the lock keeps the price and drops the move, and it is no surprise.
print("\nOct 27 2026, natural gas in the Nov expiry window")
import copy as _copy  # noqa: E402
_fx = json.loads((Path(HERE).parent / "test" / "fixtures" / "daily-audit" / "ng-roll-2026-10.json").read_text())
_r = next(r for r in _fx["rows"] if r["fetched"].startswith("2026-10-27"))
_feed = {"fetched": _r["fetched"], "quotes": _copy.deepcopy(_r["quotes"])}
import types as _types  # noqa: E402
sys.modules.setdefault("yfinance", _types.ModuleType("yfinance"))  # the guard never calls Yahoo
import fetch_prices as _fp  # noqa: E402
_fp.energy_roll_guard(_feed["quotes"])
pdata, surprises, t, blk = load(_feed)
ng = row(pdata["price_block"], "Natural Gas")
chk(ng and "$3.02" in ng[0] and "MOVE WITHHELD" in ng[0] and "%)" not in ng[0] and "(UP" not in ng[0], "the gas line keeps $3.02 and carries no percent", ng)
lc = pdata["locked_changes"].get("natgas") or {}
chk(lc.get("pct") is None and lc.get("prev") is None and lc.get("withheld"), "the lock has no prev and no pct for gas", lc)
chk(not [s for s in surprises if s["key"] == "natgas"], "gas is not an overnight surprise", surprises)
chk("natgas" not in t["prev_settles"], "no previous settle is offered for gas", t["prev_settles"])
cl = row(pdata["price_block"], "WTI Crude Oil")
chk(cl and "(UP +0.7%)" in cl[0], "crude keeps its move", cl)

# 2026-11-02 audit: the Nov 1 issue read the Oct 31 06:46Z file; preflight
# repaired the cattle key from dead Oct '26 to Dec '26 (220.95) but the label
# stayed "Oct '26", and the issue said "October live cattle ... $220.95".
print("\nNov 1 2026, cattle repaired to Dec '26")
_lv = json.loads((Path(HERE).parent / "test" / "fixtures" / "daily-audit" / "prices-2026-10-31-livestock.json").read_text())
_feed = {"fetched": "2026-11-01T12:09:37Z", "quotes": _copy.deepcopy(_lv["quotes"])}
pdata, surprises, t, blk = load(_feed)
lc_row = row(pdata["price_block"], "Live Cattle Dec '26")
chk(lc_row and "$220.95" in lc_row[0], "the cattle line names Dec '26 beside $220.95", row(pdata["price_block"], "Live Cattle Oct '26") or pdata["price_block"])
chk(not row(pdata["price_block"], "Live Cattle Oct '26"), "and never Oct '26")
chk(pdata["locked_changes"]["cattle"].get("contract") == "Dec '26", "the lock carries the month", pdata["locked_changes"]["cattle"])
chk(pdata["locked_changes"]["feeders"].get("contract") == "Nov '26", "feeders carry Nov '26", pdata["locked_changes"]["feeders"])
chk(g.quoted_contract({"ticker": "LEZ26.CME", "contract": "Oct '26"}) == "Dec '26", "the ticker beats a stale label")
chk(g.quoted_contract({"alias_of": "cattle-oct26", "repaired_from": "cattle-dec26"}) == "Dec '26", "the repair beats the alias")

print("PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
