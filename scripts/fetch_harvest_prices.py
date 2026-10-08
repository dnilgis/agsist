#!/usr/bin/env python3
"""
AGSIST harvest/projected price maintainer.

Runs weekday evenings after CBOT settlement. During the two discovery
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


def settled_only(rows, today):
    """Bars dated before today (Central) only. A same-day Yahoo bar is not the
    settlement: after the 7 PM reopen it holds evening trades (Oct 5, 2026:
    4.9625 recorded against a 4.975 close), and even before then it can
    differ from the figure Yahoo restates the next day (Oct 2: 4.9725 that
    evening, 4.9775 later). Today's settle is counted on the next run."""
    return [r for r in rows if r["d"] < today.isoformat()]


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
    out = settled_only(out, today or today_central())
    if not out:
        raise RuntimeError("no settled day yet for " + ticker + f" {year}-{month:02d}")
    return out


def with_running_avg(series):
    """Stamp each settle with the running average through that day ("a"),
    rounded to the cent like the headline figure. The last one IS the
    running average. The homepage matches RMA's posted average against these
    to say how many settles RMA's figure holds."""
    tot = 0.0
    for i, p in enumerate(series):
        tot += p["s"]
        p["a"] = round(tot / (i + 1), 2)
    return series


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
    assert with_running_avg(t)[-1]["a"] == round(sum(p["s"] for p in t) / len(t), 2)
    rows = [{"d": "2026-10-01", "s": 5.0225}, {"d": "2026-10-02", "s": 4.9775}, {"d": "2026-10-05", "s": 4.9625}]
    assert [r["d"] for r in settled_only(rows, date(2026, 10, 5))] == ["2026-10-01", "2026-10-02"], \
        "a bar dated today is not a settlement yet"
    assert len(settled_only(rows, date(2026, 10, 6))) == 3
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


def card_html(c, crop_year):
    def leg_line(leg, label, month_word):
        if leg["status"] == "final":
            return ('<div class="hpc-leg"><span class="hpc-l">' + label + ' (' + month_word + ' \u00b7 final)</span>'
                    '<span class="hpc-v">$' + f"{leg['price']:.2f}" + '</span></div>')
        if leg["status"] == "running":
            return ('<div class="hpc-leg"><span class="hpc-l">' + label + ' \u00b7 day ' + str(leg["days_counted"])
                    + ' of ~' + str(leg.get("days_total", "?")) + ' \u00b7 running estimate</span>'
                    '<span class="hpc-v">$' + f"{leg['running_avg']:.2f}" + '</span></div>')
        return ('<div class="hpc-leg"><span class="hpc-l">' + label + ' (' + month_word + ')</span>'
                '<span class="hpc-v hpc-pend">pending: discovery opens '
                + month_word + ' 1</span></div>')
    return ('<div class="hp-card-s"><div class="hpc-t">' + c["label"] + ' \u00b7 ' + c["contract"]
            + ' \u00b7 ' + str(crop_year) + ' crop year</div>'
            + leg_line(c["projected"], "Projected price", "February")
            + leg_line(c["harvest"], "Harvest price", "October")
            + '</div>')


def seed_page(d, today):
    src = PAGE.read_text(encoding="utf-8")
    block = ("<!--SEED:hpcards-->\n      "
             + "\n      ".join(card_html(c, d["crop_year"]) for c in d["commodities"])
             + '\n      <div class="hp-seed-note">Figures above are baked in daily on trading days; '
             'in-window numbers are running estimates until the month closes. Official prices: USDA RMA.</div>'
             "\n      <!--/SEED:hpcards-->")
    pat = re.compile(r"<!--SEED:hpcards-->.*?<!--/SEED:hpcards-->", re.S)
    if not pat.search(src):
        raise RuntimeError("SEED:hpcards markers missing from page")
    out = pat.sub(lambda _: block, src, count=1)
    out = re.sub(r'("dateModified":\s*")(\d{4}-\d{2}-\d{2})(")',
                 lambda m: m.group(1) + today.isoformat() + m.group(3), out)
    if out != src:
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
