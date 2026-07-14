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
from datetime import datetime, date
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data" / "harvest-prices.json"
PAGE = REPO / "harvest-price-tracker.html"
CENTRAL = ZoneInfo("America/Chicago")

ROOTS = {"Corn": "ZC", "Soybeans": "ZS"}
MONTH_CODE = {"Dec": "Z", "Nov": "X"}


def today_central():
    return datetime.now(CENTRAL).date()


def contract_ticker(commodity):
    root = ROOTS[commodity["label"]]
    mon = commodity["contract"].split()[0]
    yy = commodity["contract"].split("'")[1]
    return root + MONTH_CODE[mon] + yy + ".CBT"


def month_settlements(ticker, year, month):
    """Daily closes for the given month. Fails loudly on empty."""
    import yfinance as yf
    start = date(year, month, 1)
    end = date(year + (month == 12), (month % 12) + 1, 1)
    df = yf.download(ticker, start=start.isoformat(), end=end.isoformat(),
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
    return out


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
    series = month_settlements(ticker, disc_year, month)
    avg = round(sum(p["s"] for p in series) / len(series), 2)
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
        c["harvest"] = {"status": "pending", "price": None, "running_avg": None,
                        "window": "October", "series": [], "days_counted": 0,
                        "days_total": 23}
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
                '<span class="hpc-v hpc-pend">pending \u2014 discovery opens '
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
    sys.exit(main())
