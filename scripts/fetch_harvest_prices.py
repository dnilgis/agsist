#!/usr/bin/env python3
"""
AGSIST harvest/projected price maintainer.

Runs Monday to Saturday evenings after CBOT settlement (Saturday picks up
Friday's settle, 2026-10-17). During the two discovery
windows (February = projected, October = harvest) it rebuilds each
commodity's daily-settlement series for the month from exchange data,
recomputes the running average exactly as RMA's Commodity Exchange Price
Provisions do (mean of daily settlements across the month's trading days,
rounded to the cent), finalizes when the window closes, and seeds the
static hero numbers + dateModified into harvest-price-tracker.html so the
figures are crawler-visible. Off-window it exits quietly unless a pending
finalize or a January crop-year rollover is due.

Honesty rails: the series is REBUILT from exchange data every run (no
accumulation bugs), a failed or empty download fails the run loudly rather
than writing anything, and in-window figures are always labeled running
estimates — official prices are RMA's alone.

Data: data/harvest-prices.json (existing schema, series now populated).
Page: harvest-price-tracker.html between <!--SEED:hpcards--> markers.
"""
import calendar
import json
import re
import sys
from datetime import datetime, date, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data" / "harvest-prices.json"
PAGE = REPO / "harvest-price-tracker.html"
CENTRAL = ZoneInfo("America/Chicago")

RMA = REPO / "data" / "rma-prices.json"
PRICES = REPO / "data" / "prices.json"
ROOTS = {"Corn": "ZC", "Soybeans": "ZS"}
MONTH_CODE = {"Dec": "Z", "Nov": "X"}
FULL_CODE = {"January": "F", "February": "G", "March": "H", "April": "J", "May": "K", "June": "M",
             "July": "N", "August": "Q", "September": "U", "October": "V", "November": "X",
             "December": "Z"}


def today_central():
    return datetime.now(CENTRAL).date()


def contract_ticker(commodity):
    root = ROOTS[commodity["label"]]
    mon = commodity["contract"].split()[0]
    yy = commodity["contract"].split("'")[1]
    return root + MONTH_CODE[mon] + yy + ".CBT"


# Today's bar is the settle between the day close and the evening reopen.
SETTLED_FROM = (14, 0)     # CBOT grains close 1:20 PM CT; settles post by 2
REOPEN = (19, 0)           # the overnight session opens 7 PM CT


def settled_only(rows, today, now=None):
    """Settled bars only. A bar dated before today (Central) always counts.
    Today's bar counts only when `now` (Central) is between the settle and the
    7 PM reopen: after the reopen it holds evening trades (Oct 5, 2026: 4.9625
    recorded against a 4.975 close).

    2026-10-10: this used to drop today's bar at every run. The workflow runs
    at 4:47 PM CT on weekdays only, so Friday's settle was not counted until
    Monday evening: on Oct 9 and 10 the file held 6 settles and $5.01 when the
    7 settled days averaged $4.98, and the pages counted 5, 6 and 7 days. Yahoo
    can restate a fresh bar by a tick the next day (Oct 2: 4.9725 that
    evening, 4.9775 later); the series is rebuilt from the exchange data on
    every run, so a restated figure replaces it on the next run."""
    cut = today.isoformat()
    if (now is not None and now.date() == today and now.weekday() < 5
            and SETTLED_FROM <= (now.hour, now.minute) < REOPEN):
        return [r for r in rows if r["d"] <= cut]
    return [r for r in rows if r["d"] < cut]


def month_settlements(ticker, year, month, today=None):
    """Daily closes for the given month, settled days only. Fails loudly on empty."""
    start = date(year, month, 1)
    end = date(year + (month == 12), (month % 12) + 1, 1)
    return range_settlements(ticker, start, end, today)


def range_settlements(ticker, start, end_excl, today=None):
    """Daily closes in [start, end_excl), settled days only. Fails loudly on empty."""
    import yfinance as yf
    year, month = start.year, start.month
    df = yf.download(ticker, start=start.isoformat(), end=end_excl.isoformat(),
                     progress=False, auto_adjust=False)
    if df is None or df.empty:
        raise RuntimeError("no settlement data for " + ticker + " " + f"{year}-{month:02d}")
    closes = df["Close"]
    if hasattr(closes, "columns"):          # yfinance sometimes returns a frame
        closes = closes.iloc[:, 0]
    out = []
    for idx, val in closes.items():
        if val == val:                      # not NaN
            out.append({"d": idx.strftime("%Y-%m-%d"), "s": round(float(val) / 100, 4)})
    if not out:
        raise RuntimeError("all-NaN settlements for " + ticker)
    now = datetime.now(CENTRAL)
    out = settled_only(out, today or now.date(), now)
    if not out:
        raise RuntimeError("no settled day yet for " + ticker + f" {year}-{month:02d}")
    return mark_provisional(out, today or now.date())


def mark_provisional(rows, today):
    """Flag today's bar "p": it is Yahoo's close a few hours after the session,
    which can sit a tick off the exchange settle (Dec corn Oct 13 2026: 482.25
    at 1:16 p.m. CT, settle 482.75). The next evening's run rebuilds the series
    and the flag goes. The page calls a flagged day provisional, never a
    settle (2026-10-15)."""
    cut = today.isoformat()
    for r in rows:
        if r["d"] == cut:
            r["p"] = True
        else:
            r.pop("p", None)
    return rows


def exchange_settles(ticker, prices):
    """The CBOT settles data/prices.json holds for this contract, in dollars.

    2026-10-17 audit (N1): Friday Oct 16 Nov beans stayed at Yahoo's afternoon
    close, $12.60 1/2 and "provisional", all weekend, while prices.json had the
    settle, $12.61 1/4, from 06:46 UTC Saturday and every other page showed it.
    fetch_prices.py keeps a settles map of true settles only (settles_v 2), so
    a day it holds is a settle and replaces the Yahoo bar here."""
    out = {}
    for q in ((prices or {}).get("quotes") or {}).values():
        if not isinstance(q, dict) or q.get("ticker") != ticker or q.get("settles_v") != 2:
            continue
        for d, px in (q.get("settles") or {}).items():
            if isinstance(px, (int, float)) and px > 0:
                out[str(d)[:10]] = round(px / 100, 4)
    return out


def apply_settles(series, settles):
    """Swap in each exchange settle on file and drop its provisional flag."""
    for r in series:
        if r["d"] in settles:
            r["s"] = settles[r["d"]]
            r.pop("p", None)
    return series


def load_prices():
    try:
        return json.loads(PRICES.read_text())
    except (OSError, ValueError) as e:
        print("prices.json unreadable, Yahoo bars kept as they are: " + str(e), file=sys.stderr)
        return None


def finish_line(leg, projected):
    """The October arithmetic, not a forecast: what the settles still to come
    would have to average for the harvest price to finish on the other side of
    the projected price. None when the window is not running or nothing is
    left to count. Same math as RMA's average: (sum so far + left x avg) /
    days_total, less the half cent RMA's rounding takes."""
    ser = leg.get("series") or []
    total = leg.get("days_total")
    if leg.get("status") != "running" or not ser or not total or projected is None:
        return None
    left = total - len(ser)
    if left <= 0:
        return None
    below = (leg.get("running_avg") or 0) >= projected
    # RMA rounds the final average to the cent, halves up: finishing below
    # $4.62 means a raw average under $4.615, above means $4.625 or more.
    target = projected - 0.005 if below else projected + 0.005
    need = (target * total - sum(x["s"] for x in ser)) / left
    last = ser[-1]
    return {"left": left, "need": need, "below": below, "last": last["s"],
            "last_d": last["d"], "last_p": bool(last.get("p"))}


def _md(iso):
    x = date.fromisoformat(iso)
    return x.strftime("%b ") + str(x.day)


def finish_text(f, projected):
    """Plain words for finish_line. A need under zero cannot happen in a
    market; it is said as such rather than printed as a price."""
    if not f:
        return ""
    sys.path.insert(0, str(REPO / "scripts"))
    import pricefmt
    last = pricefmt.price(f["last"] * 100) + " on " + _md(f["last_d"]) + (", provisional" if f["last_p"] else "")

    def amt(x):
        c = round(x * 100)
        return ("$" + f"{c / 100:.2f}") if c >= 100 else (str(c) + "\u00a2")
    import math
    # "or less" is floored and "or more" ceiled to the cent, so the printed
    # figure itself meets the condition (corn Oct 14: 4.3583 prints $4.35)
    lo = math.floor(f["need"] * 100 + 1e-9) / 100
    hi = math.ceil(f["need"] * 100 - 1e-9) / 100
    if f["below"]:
        if f["need"] <= 0:
            return ("The harvest price can no longer finish below the $" + f"{projected:.2f}" + " projected price.")
        gap = f["last"] - lo
        return ("For the harvest price to finish below the $" + f"{projected:.2f}" + " projected price, the "
                + str(f["left"]) + " settles left would have to average $" + f"{lo:.2f}"
                + " or less" + (", " + amt(gap) + " under the latest ("
                                + last + ")" if gap > 0 else " (latest " + last + ")") + ".")
    gap = hi - f["last"]
    return ("For the harvest price to finish above the $" + f"{projected:.2f}" + " projected price, the "
            + str(f["left"]) + " settles left would have to average $" + f"{hi:.2f}"
            + " or more" + (", " + amt(gap) + " over the latest ("
                            + last + ")" if gap > 0 else " (latest " + last + ")") + ".")


def with_running_avg(series):
    """Stamp each settle with the running average through that day ("a"),
    rounded to the cent like the headline figure. The last one IS the
    running average. The homepage matches RMA's posted average against these
    to say how many settles RMA's figure holds."""
    tot = 0.0
    for i, p in enumerate(series):
        tot += p["s"]
        p["a"] = cents(tot / (i + 1))
    return series


def cents(x):
    """To the cent, halves up, as RMA rounds. Python's round() on a float sends
    12.885 (77.31 / 6, Nov beans Oct 1-8 2026) to 12.88 because the float is a
    hair under the half; RMA posted 12.89."""
    return round(x + 1e-9, 2)


def selftest_windows():
    """County windows: one average per distinct window, settled days only,
    ratio-priced crops left out, a failed fetch stored with its reason."""
    def row(crop, sym, mon, hs, he, status, scd, p):
        return {"year": 2026, "practice": "Conventional", "state": "Texas", "crop": crop, "type": "All",
                "scd": scd, "p_price": p, "h_sym": sym, "h_exch": "CBOT", "h_mon": mon, "h_yr": 2026,
                "h_start": hs, "h_end": he, "h_status": status}
    rma = {"crop_year": 2026, "rows": [
        row("Soybeans", "ZS", "November", "2026-09-01", "2026-09-30", "Released", "1/31/2026", 10.72),
        row("Soybeans", "ZS", "November", "2026-10-01", "2026-10-31", "In Discovery", "2/28/2026", 10.87),
        row("Soybeans", "ZS", "November", "2026-10-01", "2026-10-31", "In Discovery", "3/15/2026", 11.09),
        row("Grain Sorghum", "ZC", "December", "2026-10-01", "2026-10-31", "In Discovery", "2/28/2026", 4.55),
        row("Corn", "ZC", "December", "2026-11-01", "2026-11-30", "Yet To Start", "3/15/2026", 4.62),
        row("Corn", "ZC", "December", "2026-09-01", "2026-09-30", "In Discovery", "2/15/2026", 4.55),
    ]}
    today = date(2026, 10, 6)
    calls = []

    def fake(ticker, start, end_excl, t):
        calls.append(ticker)
        if ticker == "ZCZ26.CBT":
            raise RuntimeError("no settlement data for ZCZ26.CBT 2026-09")
        bars = [{"d": "2026-10-01", "s": 12.84}, {"d": "2026-10-02", "s": 12.7825},
                {"d": "2026-10-05", "s": 12.9}, {"d": "2026-10-06", "s": 99.0}]
        return settled_only(bars, t)
    d = {}
    assert update_windows(d, rma, today, fetch=fake)
    ws = d["windows"]
    keys = [w["key"] for w in ws]
    assert keys == ["ZCZ26.CBT|2026-09-01|2026-09-30", "ZSX26.CBT|2026-10-01|2026-10-31"], keys
    assert calls.count("ZSX26.CBT") == 1, "two counties sharing one window are one fetch, one average"
    sb = ws[1]
    assert sb["status"] == "running" and sb["days_counted"] == 3, sb
    assert sb["running_avg"] == round((12.84 + 12.7825 + 12.9) / 3, 2), "today's bar is not a settle"
    assert sb["days_total"] == 22, sb["days_total"]
    cz = ws[0]
    assert cz["status"] == "unavailable" and cz["running_avg"] is None and "no settlement" in cz["reason"], cz
    assert not any(w["crop"] == "Grain Sorghum" for w in ws), "sorghum is ratio-priced, not a plain average"
    # after the window ends it finalizes; a later failed fetch keeps the final
    d2 = {"windows": [dict(sb)]}
    update_windows(d2, rma, date(2026, 11, 2), fetch=lambda *a: [
        {"d": "2026-10-01", "s": 12.0}, {"d": "2026-10-30", "s": 13.0}])
    f = [w for w in d2["windows"] if w["ticker"] == "ZSX26.CBT"][0]
    assert f["status"] == "final" and f["price"] == 12.5 and f["running_avg"] is None, f

    def down(*a):
        raise RuntimeError("down")
    update_windows(d2, rma, date(2026, 11, 3), fetch=down)
    assert [w for w in d2["windows"] if w["ticker"] == "ZSX26.CBT"][0]["price"] == 12.5


def selftest():
    s = with_running_avg([{"d": "2026-10-01", "s": 5.0225}, {"d": "2026-10-02", "s": 4.9725}])
    assert [p["a"] for p in s] == [5.02, 5.0], s
    # the last stamp equals the old one-shot formula
    t = [{"d": str(i), "s": v} for i, v in enumerate([12.84, 12.7725, 12.9, 13.0125])]
    assert with_running_avg(t)[-1]["a"] == cents(sum(p["s"] for p in t) / len(t))
    beans = [12.84, 12.7825, 12.8075, 13.03, 12.975, 12.875]
    assert with_running_avg([{"d": str(i), "s": v} for i, v in enumerate(beans)])[-1]["a"] == 12.89, "half rounds up, like RMA"
    rows = [{"d": "2026-10-01", "s": 5.0225}, {"d": "2026-10-02", "s": 4.9775}, {"d": "2026-10-05", "s": 4.9625}]
    assert [r["d"] for r in settled_only(rows, date(2026, 10, 5))] == ["2026-10-01", "2026-10-02"], \
        "a bar dated today is not a settlement yet"
    assert len(settled_only(rows, date(2026, 10, 6))) == 3
    # Friday Oct 9 2026: the 4:47 PM CT run counts that day's settle ...
    fri = rows + [{"d": "2026-10-09", "s": 4.805}]
    at = lambda h, m: datetime(2026, 10, 9, h, m, tzinfo=CENTRAL)
    assert settled_only(fri, date(2026, 10, 9), at(16, 47))[-1]["d"] == "2026-10-09", "settle after the close counts"
    # ... but not before the close, nor after the 7 PM reopen
    assert settled_only(fri, date(2026, 10, 9), at(11, 0))[-1]["d"] == "2026-10-05", "intraday bar is not a settle"
    assert settled_only(fri, date(2026, 10, 9), at(19, 30))[-1]["d"] == "2026-10-05", "evening bar is not a settle"
    # a weekend run counts Friday as an earlier day
    assert settled_only(fri, date(2026, 10, 10), datetime(2026, 10, 10, 9, 0, tzinfo=CENTRAL))[-1]["d"] == "2026-10-09"
    # the hand-worked Oct 9 average: 7 settles, $4.98 (not the 6-settle $5.01)
    oct_ = [5.0225, 4.9775, 4.9725, 5.08, 5.02, 5.0025, 4.805]
    s7 = with_running_avg([{"d": str(i), "s": v} for i, v in enumerate(oct_)])
    assert (len(s7), s7[-1]["a"], s7[-2]["a"]) == (7, 4.98, 5.01), s7
    # 2026-10-15: the day fetched that evening is provisional, never a settle
    rows = mark_provisional([{"d": "2026-10-13", "s": 4.8275, "p": True}, {"d": "2026-10-14", "s": 4.81}],
                            date(2026, 10, 14))
    assert "p" not in rows[0] and rows[1]["p"] is True, rows
    # the October arithmetic, hand-worked on the Oct 14 corn file: 10 settles
    # summing 49.34, 22 days, projected $4.62. Below means a raw average under
    # 4.615: (4.615 x 22 - 49.34) / 12 = 4.34917, printed floored, $4.34.
    corn = [5.0225, 4.9775, 4.9725, 5.08, 5.02, 5.0025, 4.7975, 4.83, 4.8275, 4.81]
    leg = {"status": "running", "days_total": 22, "running_avg": 4.93,
           "series": [{"d": "2026-10-%02d" % i, "s": v} for i, v in zip((1, 2, 5, 6, 7, 8, 9, 12, 13, 14), corn)]}
    leg["series"][-1]["p"] = True
    fl = finish_line(leg, 4.62)
    assert fl["left"] == 12 and abs(fl["need"] - 4.349166) < 1e-5 and fl["below"], fl
    tx = finish_text(fl, 4.62)
    assert tx == ("For the harvest price to finish below the $4.62 projected price, the 12 settles left would "
                  "have to average $4.34 or less, 47\u00a2 under the latest ($4.81 on Oct 14, provisional)."), tx
    # check: twelve settles at $4.34 do finish below, at $4.61
    assert cents((sum(corn) + 12 * 4.34) / 22) == 4.61 and cents((sum(corn) + 12 * 4.35) / 22) == 4.62
    assert finish_line(dict(leg, status="final"), 4.62) is None
    up = finish_text(finish_line(dict(leg, running_avg=4.5), 5.00), 5.00)
    assert up.startswith("For the harvest price to finish above the $5.00 projected price") and "or more" in up, up
    # the head carries the running number, inside the caps, and goes back after
    dd = {"crop_year": 2026, "commodities": [
        {"label": "Corn", "projected": {"price": 4.62}, "harvest": dict(leg)},
        {"label": "Soybeans", "projected": {"price": 11.09},
         "harvest": {"status": "running", "running_avg": 12.87, "series": leg["series"]}}]}
    t, de, h1 = head_text(dd)
    assert t == "2026 Harvest Price So Far: Corn $4.93, Soybeans $12.87 | AGSIST", t
    assert len(t) <= 68 and len(de) <= 160 and "through Oct 14" in de and "%" not in t + de, de
    assert h1 == "2026 harvest price so far: corn $4.93, soybeans $12.87"
    page = ('<title>x</title><meta name="description" content="y"><meta name="twitter:title" content="z">'
            '<meta property="og:title" content="w"><h1><!--SEED:hph1-->old<!--/SEED:hph1--></h1>')
    out = stamp_head(page, dd)
    assert "<title>2026 Harvest Price So Far" in out and "<!--SEED:hph1-->2026 harvest price so far" in out
    dd["commodities"][0]["harvest"] = {"status": "pending", "series": []}
    out = stamp_head(page, dd)
    assert "<title>2026 Harvest vs Projected Price: Crop Insurance | AGSIST</title>" in out
    assert "<!--SEED:hph1-->When does your <em>price</em> get set?<!--/SEED:hph1-->" in out
    # 2026-10-17 (N1): the settle in prices.json replaces Friday's provisional bar
    pj = {"quotes": {"beans-nov": {"ticker": "ZSX26.CBT", "settles_v": 2,
                                   "settles": {"2026-10-15": 1263.0, "2026-10-16": 1261.25}},
                     "beans": {"ticker": "ZS=F", "settles_v": 2, "settles": {"2026-10-16": 9999.0}},
                     "old": {"ticker": "ZSX26.CBT", "settles": {"2026-10-14": 1.0}}}}
    st = exchange_settles("ZSX26.CBT", pj)
    assert st == {"2026-10-15": 12.63, "2026-10-16": 12.6125}, st
    ser = [{"d": "2026-10-14", "s": 12.7725}, {"d": "2026-10-15", "s": 12.63}, {"d": "2026-10-16", "s": 12.605, "p": True}]
    apply_settles(ser, st)
    assert ser[-1] == {"d": "2026-10-16", "s": 12.6125} and ser[0]["s"] == 12.7725, ser
    assert exchange_settles("ZSX26.CBT", None) == {} and exchange_settles("ZCZ26.CBT", pj) == {}
    ser = [{"d": "2026-10-19", "s": 12.5, "p": True}]
    assert apply_settles(ser, st)[0].get("p") is True, "a day with no settle on file stays provisional"
    selftest_windows()
    print("selftest ok")
    return 0


def month_over(year, month, today):
    return today > date(year, month, calendar.monthrange(year, month)[1])


def update_leg(commodity, leg_name, month, crop_year, today):
    """Rebuild one discovery leg (projected=Feb, harvest=Oct). Returns True if changed."""
    leg = commodity[leg_name]
    disc_year = crop_year if leg_name == "harvest" else crop_year
    in_window = (today.year == disc_year and today.month == month)
    pending_final = leg["status"] == "running" and month_over(disc_year, month, today)
    if leg["status"] == "final" or not (in_window or pending_final):
        return False
    ticker = contract_ticker(commodity)
    try:
        series = month_settlements(ticker, disc_year, month, today)
    except RuntimeError as e:
        if "no settled day yet" in str(e):
            return False                      # first day of the window: nothing settled to count
        raise
    apply_settles(series, exchange_settles(ticker, load_prices()))
    with_running_avg(series)
    avg = series[-1]["a"]
    changed = (series != leg.get("series") or leg.get("status") == "pending")
    leg["series"] = series
    leg["days_counted"] = len(series)
    if pending_final or (in_window and today.day == calendar.monthrange(disc_year, month)[1]
                         and month_over(disc_year, month, today)):
        leg["status"] = "final"
        leg["price"] = avg
        leg["running_avg"] = None
    else:
        leg["status"] = "running"
        leg["running_avg"] = avg
        leg["price"] = None
    return changed or leg["status"] == "final"


def _trading_days(start, end):
    """Sessions in [start, end], by scripts/contract_calendar.py's one definition."""
    sys.path.insert(0, str(REPO / "scripts"))
    import contract_calendar as cc
    return cc.sessions_between(start, end + timedelta(days=1))


def window_candidates(rma, today):
    """Every distinct county-level harvest window in RMA's file whose price is
    a plain average of one CBOT contract's settles: corn on ZC, soybeans on ZS.
    Sorghum, barley and others priced off corn use a ratio, and cotton, rice
    and wheat contracts are not proven on our feed, so they are left out and
    the homepage shows RMA's own posted figure for them.

    A window is listed once it has started. One RMA has already released a
    final price for is skipped (RMA's figure is the answer), unless we were
    already tracking it and only need to finalize it."""
    out = {}
    for x in (rma or {}).get("rows", []):
        if x.get("practice") != "Conventional" or x.get("year") != rma.get("crop_year"):
            continue
        root = ROOTS.get(x.get("crop"))
        if not root or x.get("h_sym") != root or x.get("h_exch") != "CBOT":
            continue
        mon, yr = x.get("h_mon"), x.get("h_yr")
        try:
            hs, he = date.fromisoformat(x["h_start"]), date.fromisoformat(x["h_end"])
        except (KeyError, TypeError, ValueError):
            continue
        if mon not in FULL_CODE or not yr or hs > today:
            continue
        ticker = root + FULL_CODE[mon] + str(yr)[-2:] + ".CBT"
        key = ticker + "|" + hs.isoformat() + "|" + he.isoformat()
        w = out.setdefault(key, {"key": key, "crop": x["crop"], "ticker": ticker,
                                 "contract": mon[:3] + " '" + str(yr)[-2:],
                                 "start": hs.isoformat(), "end": he.isoformat(),
                                 "rma_released": True})
        if x.get("h_status") != "Released":
            w["rma_released"] = False
    return list(out.values())


def update_windows(d, rma, today, fetch=None):
    """Rebuild d["windows"]: our own settled-only average for each county-level
    harvest window (see window_candidates). Each is rebuilt from exchange data
    every run, like the main legs. A failure on one window is logged and stored
    with its reason; it never stops the main legs or writes a made-up figure.
    Returns True if anything changed."""
    fetch = fetch or range_settlements
    old = {w["key"]: w for w in d.get("windows", []) if isinstance(w, dict) and "key" in w}
    new = []
    for c in window_candidates(rma, today):
        prev = old.get(c["key"])
        hs, he = date.fromisoformat(c["start"]), date.fromisoformat(c["end"])
        ended = today > he
        if prev and prev.get("status") == "final":
            new.append(prev)
            continue
        if ended and c["rma_released"] and not prev:
            continue
        w = {k: c[k] for k in ("key", "crop", "contract", "ticker", "start", "end")}
        w["days_total"] = _trading_days(hs, he)
        try:
            series = fetch(c["ticker"], hs, he + timedelta(days=1), today)
        except Exception as e:  # noqa: BLE001 - logged and stored, never hidden
            msg = str(e)
            if "no settled day yet" in msg:
                w.update(status="pending", price=None, running_avg=None, series=[], days_counted=0)
            elif prev and prev.get("series"):
                print("window " + c["key"] + ": fetch failed, kept the last good build: " + msg,
                      file=sys.stderr)
                new.append(prev)
                continue
            else:
                print("window " + c["key"] + ": fetch failed, no average: " + msg, file=sys.stderr)
                w.update(status="unavailable", reason=msg[:200], price=None, running_avg=None,
                         series=[], days_counted=0)
            new.append(w)
            continue
        series = [p for p in series if c["start"] <= p["d"] <= c["end"]]
        if not series:
            w.update(status="pending", price=None, running_avg=None, series=[], days_counted=0)
            new.append(w)
            continue
        with_running_avg(series)
        avg = series[-1]["a"]
        w["series"] = series
        w["days_counted"] = len(series)
        if ended:
            w.update(status="final", price=avg, running_avg=None)
        else:
            w.update(status="running", price=None, running_avg=avg)
        new.append(w)
    new.sort(key=lambda w: (w["crop"], w["start"], w["ticker"]))
    changed = new != d.get("windows", [])
    d["windows"] = new
    return changed


def roll_crop_year(d, today):
    """January after a final harvest: open the next crop year."""
    if today.month != 1:
        return False
    if not all(c["harvest"]["status"] == "final" for c in d["commodities"]):
        return False
    if d["crop_year"] >= today.year:
        return False
    yy = str(today.year)[2:]
    d["crop_year"] = today.year
    for c in d["commodities"]:
        mon = "Dec" if c["label"] == "Corn" else "Nov"
        c["contract"] = mon + " '" + yy
        c["projected"] = {"status": "pending", "price": None, "window": "February",
                          "series": [], "days_total": 19}
        # ~trading days in October of the new crop year: weekdays (no CME
        # grain holidays fall in October). Computed, not hardcoded — Oct 2026
        # has 22, other years 21-23.
        oct_days = sum(1 for dd in range(1, 32)
                       if date(today.year, 10, dd).weekday() < 5)
        c["harvest"] = {"status": "pending", "price": None, "running_avg": None,
                        "window": "October", "series": [], "days_counted": 0,
                        "days_total": oct_days}
    return True


def _span(series):
    """'Oct 1 to 9' (or 'Sep 30 to Oct 2') from a settle series, '' if empty."""
    if not series:
        return ""
    a, b = date.fromisoformat(series[0]["d"]), date.fromisoformat(series[-1]["d"])
    fa = a.strftime("%b ") + str(a.day)
    if a == b:
        return fa
    return fa + " to " + (str(b.day) if (a.year, a.month) == (b.year, b.month) else b.strftime("%b ") + str(b.day))


def chart_svg(c):
    """The window drawn: each daily settle, the running average and the flat
    projected price, inline SVG, from the series this file already keeps
    (Oct 16 head to head, change 1). Plotted settles only, nothing projected
    forward; the days still to come are empty space. A provisional last day is
    drawn hollow. '' when there are fewer than two days to draw."""
    leg = c.get("harvest") or {}
    ser = [x for x in (leg.get("series") or []) if isinstance(x.get("s"), (int, float))]
    proj = (c.get("projected") or {}).get("price")
    total = leg.get("days_total") or len(ser)
    if len(ser) < 2 or not isinstance(proj, (int, float)) or total < len(ser):
        return ""
    W, H, L, R, T, B = 300, 132, 40, 8, 10, 20
    vals = [x["s"] for x in ser] + [x["a"] for x in ser if isinstance(x.get("a"), (int, float))] + [proj]
    lo, hi = min(vals), max(vals)
    pad = max((hi - lo) * 0.08, 0.02)
    lo, hi = lo - pad, hi + pad

    def X(i):
        return L + i * (W - L - R) / max(total - 1, 1)

    def Y(v):
        return T + (hi - v) * (H - T - B) / (hi - lo)

    def f(v):
        return "%.1f" % v
    pts = " ".join(f(X(i)) + "," + f(Y(x["s"])) for i, x in enumerate(ser))
    avg = [(i, x["a"]) for i, x in enumerate(ser) if isinstance(x.get("a"), (int, float))]
    apts = " ".join(f(X(i)) + "," + f(Y(a)) for i, a in avg)
    dots = "".join(
        '<circle cx="' + f(X(i)) + '" cy="' + f(Y(x["s"])) + '" r="2.8" class="hpg-d'
        + (' hpg-p' if x.get("p") else '') + '"/>' for i, x in enumerate(ser))
    yp = Y(proj)
    first = date.fromisoformat(ser[0]["d"])
    # the legs are calendar-month windows ("window": "October"): the axis
    # runs to the month's last day, where the window ends
    e = date(first.year, first.month, calendar.monthrange(first.year, first.month)[1])
    xl_end = e.strftime("%b ") + str(e.day)
    last = ser[-1]
    run = leg.get("running_avg") if leg.get("status") == "running" else leg.get("price")
    label = (c["label"] + " " + c["contract"] + ": " + str(len(ser)) + " daily settles, " + _span(ser)
             + (", " + _md(last["d"]) + " provisional" if last.get("p") else "")
             + (", running average $" + "%.2f" % run if isinstance(run, (int, float)) else "")
             + ", projected price $" + "%.2f" % proj)
    return (
        '<figure class="hpg"><svg viewBox="0 0 ' + str(W) + ' ' + str(H) + '" role="img" aria-label="'
        + label.replace('"', "&quot;").replace("'", "&#39;") + '">'
        + '<line x1="' + str(L) + '" x2="' + str(W - R) + '" y1="' + f(yp) + '" y2="' + f(yp) + '" class="hpg-proj"/>'
        + '<polyline points="' + pts + '" class="hpg-s"/>'
        + ('<polyline points="' + apts + '" class="hpg-a"/>' if len(avg) > 1 else '')
        + dots
        + '<text x="' + str(L - 4) + '" y="' + f(T + 4) + '" class="hpg-t" text-anchor="end">$' + "%.2f" % hi + '</text>'
        + '<text x="' + str(L - 4) + '" y="' + f(H - B) + '" class="hpg-t" text-anchor="end">$' + "%.2f" % lo + '</text>'
        + '<text x="' + str(L) + '" y="' + str(H - 5) + '" class="hpg-t">' + first.strftime("%b ") + str(first.day) + '</text>'
        + ('<text x="' + str(W - R) + '" y="' + str(H - 5) + '" class="hpg-t" text-anchor="end">' + xl_end + '</text>' if xl_end else '')
        + '</svg><figcaption class="hpg-k"><span><i class="hpg-kd"></i>daily settle'
        + (' (hollow: provisional)' if last.get("p") else '') + '</span>'
        + ('<span><i class="hpg-ka"></i>running average</span>' if len(avg) > 1 else '')
        + '<span><i class="hpg-kp"></i>projected $' + "%.2f" % proj + '</span></figcaption></figure>')


def card_html(c, crop_year):
    def leg_line(leg, label, month_word):
        if leg["status"] == "final":
            return ('<div class="hpc-leg"><span class="hpc-l">' + label + ' (' + month_word + ' \u00b7 final)</span>'
                    '<span class="hpc-v">$' + f"{leg['price']:.2f}" + '</span></div>')
        if leg["status"] == "running":
            # the one count: settles in the series (also days_counted). Not the
            # official figure: RMA's is. Same settles, same method, so it is
            # labeled as a running average with the days it covers. A last day
            # still flagged provisional is named so, never called a settle.
            ser = leg.get("series") or []
            prov = bool(ser and ser[-1].get("p"))
            count = (str(len(ser)) + ' of ' + str(leg.get("days_total", "?"))
                     + (' days, ' + _md(ser[-1]["d"]) + ' provisional' if prov else ' settles'))
            math = finish_text(finish_line(leg, (c.get("projected") or {}).get("price")),
                               (c.get("projected") or {}).get("price"))
            return ('<div class="hpc-leg"><span class="hpc-l">' + label + ' so far: running average, ' + _span(ser)
                    + ' (' + count + ')</span>'
                    '<span class="hpc-v">$' + f"{leg['running_avg']:.2f}" + '</span></div>'
                    + ('<div class="hpc-math">' + math + '</div>' if math else ''))
        return ('<div class="hpc-leg"><span class="hpc-l">' + label + ' (' + month_word + ')</span>'
                '<span class="hpc-v hpc-pend">pending: discovery opens '
                + month_word + ' 1</span></div>')
    return ('<div class="hp-card-s"><div class="hpc-t">' + c["label"] + ' \u00b7 ' + c["contract"]
            + ' \u00b7 ' + str(crop_year) + ' crop year</div>'
            + leg_line(c["projected"], "Projected price", "February")
            + leg_line(c["harvest"], "Harvest price", "October")
            + (chart_svg(c) if (c.get("harvest") or {}).get("status") in ("running", "final") else "")
            + '</div>')


def seed_note(d):
    """2026-10-15: this said the running average "can lag RMA's posted figure
    by a day". On Oct 15 ours ran through Oct 14 and RMA's through Oct 13: we
    are the one ahead, because we count each evening's close and RMA posts
    after. Say which days ours covers and let RMA's figure speak for itself."""
    ser = []
    for c in d.get("commodities") or []:
        if (c.get("harvest") or {}).get("status") == "running":
            ser = c["harvest"].get("series") or []
            break
    base = ('The official harvest price is USDA RMA&rsquo;s: the average of the daily settles of the contract '
            'above across the window, released after it closes. The running average is the same math on the days '
            'so far, rebuilt each trading evening.')
    if not ser:
        return base
    last = ser[-1]
    tail = (' Ours counts through ' + _md(last["d"]) + '. RMA posts its own running figure after each day; when '
            'it covers fewer days than ours the two can differ by a cent or two, and RMA&rsquo;s is the official one.')
    if last.get("p"):
        tail += (' ' + _md(last["d"]) + ' is Yahoo Finance&rsquo;s close that afternoon, which can sit a tick off '
                 'the exchange settle; it is replaced with the CBOT settle once that is posted.')
    return base + tail


def method_note(d):
    """The Method and Sources line. 2026-10-16 head to head (H3): it said
    "Sources: CBOT settles" while the newest day was Yahoo's afternoon close.
    It now names where the settles come from and, when the newest day is not
    a settle yet, says so on the Sources line itself."""
    ser = []
    for c in d.get("commodities") or []:
        if (c.get("harvest") or {}).get("status") == "running":
            ser = c["harvest"].get("series") or []
            break
    src = "CBOT daily settles as Yahoo Finance reports them"
    if ser and ser[-1].get("p"):
        src += (" (" + _md(ser[-1]["d"]) + " is Yahoo&rsquo;s afternoon close, not yet the settle)")
    return ('<div class="method-note"><b>Method</b> &middot; Running average of the contract&rsquo;s daily settles '
            'across RMA&rsquo;s window so far, the same math RMA uses for the final harvest price. &middot; '
            '<b>Sources</b> &middot; ' + src + '; USDA RMA Price Discovery for the window and the official price. '
            '&middot; Reviewed by Sigurd Lindquist, CCA</div>')


# The page's title, description and H1 carry the running number while a
# window runs (2026-10-15: no search for "2026 harvest price" found the page,
# and its H1 answered when, not what). Rewritten every evening by this script,
# the only writer of these tags; outside October they go back to the defaults.
HEAD_DEFAULT = {
    "title": "2026 Harvest vs Projected Price: Crop Insurance | AGSIST",
    "desc": ("The 2026 RMA projected and harvest prices for corn and soybeans, what your Revenue Protection "
             "guarantee is worth, how much to pre-sell, and 15 years of history."),
    "h1": "When does your <em>price</em> get set?",
}


def head_text(d):
    """(title, description, h1) for the corn and soybean harvest legs."""
    cs = {c.get("label"): c for c in d.get("commodities") or []}
    corn, soy = cs.get("Corn"), cs.get("Soybeans")
    yr = d.get("crop_year")
    if not corn or not soy:
        return None
    hc, hs = corn["harvest"], soy["harvest"]
    if hc.get("status") == "running" and hs.get("status") == "running" and hc.get("series"):
        c, b = hc["running_avg"], hs["running_avg"]
        thru = _md(hc["series"][-1]["d"])
        pc, ps = corn["projected"].get("price"), soy["projected"].get("price")
        title = f"{yr} Harvest Price So Far: Corn ${c:.2f}, Soybeans ${b:.2f} | AGSIST"
        desc = (f"{yr} harvest price running average through {thru}: corn ${c:.2f} vs ${pc:.2f} projected, "
                f"soybeans ${b:.2f} vs ${ps:.2f}. Your RP guarantee and pre-sell math.")
        h1 = f"{yr} harvest price so far: corn ${c:.2f}, soybeans ${b:.2f}"
        return title, desc, h1
    if hc.get("status") == "final" and hs.get("status") == "final":
        c, b = hc["price"], hs["price"]
        pc, ps = corn["projected"].get("price"), soy["projected"].get("price")
        title = f"{yr} Harvest Price: Corn ${c:.2f}, Soybeans ${b:.2f} | AGSIST"
        desc = (f"The {yr} harvest prices, from October settles: corn ${c:.2f} vs ${pc:.2f} projected, soybeans "
                f"${b:.2f} vs ${ps:.2f}. RMA's posted figure is the official one.")
        h1 = f"{yr} harvest price: corn ${c:.2f}, soybeans ${b:.2f}"
        return title, desc, h1
    return None


def stamp_head(src, d):
    t = head_text(d)
    yr = str(d.get("crop_year") or 2026)
    title, desc, h1 = t if t else (HEAD_DEFAULT["title"].replace("2026", yr),
                                   HEAD_DEFAULT["desc"].replace("2026", yr), HEAD_DEFAULT["h1"])
    if len(title) > 68 or len(desc) > 160:
        raise RuntimeError("harvest head text over the caps: %d / %d" % (len(title), len(desc)))
    import html as _h
    te, de = _h.escape(title, quote=True), _h.escape(desc, quote=True)
    src = re.sub(r"<title>[^<]*</title>", lambda m: "<title>" + te + "</title>", src, count=1)
    src = re.sub(r'(<meta property="og:title" content=")[^"]*(")', lambda m: m.group(1) + te + m.group(2), src, count=1)
    tw = _h.escape(title.replace(" | AGSIST", ""), quote=True)
    src = re.sub(r'(<meta name="twitter:title" content=")[^"]*(")', lambda m: m.group(1) + tw + m.group(2), src, count=1)
    src = re.sub(r'(<meta name="description" content=")[^"]*(")', lambda m: m.group(1) + de + m.group(2), src, count=1)
    if "<!--SEED:hph1-->" not in src:
        raise RuntimeError("SEED:hph1 marker missing from page")
    src = re.sub(r"<!--SEED:hph1-->.*?<!--/SEED:hph1-->",
                 lambda m: "<!--SEED:hph1-->" + h1 + "<!--/SEED:hph1-->", src, count=1, flags=re.S)
    return src


def seed_page(d, today):
    orig = PAGE.read_text(encoding="utf-8")
    src = stamp_head(orig, d)
    block = ("<!--SEED:hpcards-->\n      "
             + "\n      ".join(card_html(c, d["crop_year"]) for c in d["commodities"])
             + '\n      <div class="hp-seed-note">' + seed_note(d) + '</div>'
             + "\n      " + method_note(d)
             + "\n      <!--/SEED:hpcards-->")
    pat = re.compile(r"<!--SEED:hpcards-->.*?<!--/SEED:hpcards-->", re.S)
    if not pat.search(src):
        raise RuntimeError("SEED:hpcards markers missing from page")
    out = pat.sub(lambda _: block, src, count=1)
    out = re.sub(r'("dateModified":\s*")(\d{4}-\d{2}-\d{2})(")',
                 lambda m: m.group(1) + today.isoformat() + m.group(3), out)
    if out != orig:
        PAGE.write_text(out, encoding="utf-8")
        return True
    return False


def main():
    today = today_central()
    d = json.loads(DATA.read_text())
    changed = roll_crop_year(d, today)
    for c in d["commodities"]:
        changed |= update_leg(c, "projected", 2, d["crop_year"], today)
        changed |= update_leg(c, "harvest", 10, d["crop_year"], today)
    try:
        rma = json.loads(RMA.read_text())
    except (OSError, ValueError) as e:
        print("rma-prices.json unreadable, county windows not rebuilt: " + str(e), file=sys.stderr)
        rma = None
    if rma:
        changed |= update_windows(d, rma, today)
    if not changed:
        print("no discovery activity today (" + today.isoformat() + ") — nothing to write")
        # still make sure the page carries the current seed (first-run bootstrap)
        if seed_page(d, today):
            print("page seed refreshed")
            return 0
        return 0
    d["updated"] = today.isoformat()
    DATA.write_text(json.dumps(d, indent=1))
    seed_page(d, today)
    for c in d["commodities"]:
        for leg in ("projected", "harvest"):
            L = c[leg]
            print(c["label"], leg, L["status"],
                  "price" if L["status"] == "final" else "running",
                  L["price"] if L["status"] == "final" else L.get("running_avg"),
                  "days", L.get("days_counted", 0))
    return 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else main())
