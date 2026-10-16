#!/usr/bin/env python3
"""moved_line.py: one dated line per crop of what USDA last printed, and the
board that day, for the top of the corn, soybean and wheat futures pages.

Built only from files the site already keeps:
  data/wasde.json            what the latest WASDE printed, with last month's
                             column beside it (scripts/read_wasde_pdf.py)
  data/whats-priced-in.json  other dated reports (Grain Stocks ...), for a
                             report newer than the WASDE
  data/harvest-prices.json   CBOT settles of Dec corn and Nov soybeans through
                             the February and October windows
  data/crop-progress.json    the national NASS progress block

Facts side by side, never a cause. Nothing here says why the board moved: a
report and the settle that day are printed next to each other and the reader
draws the line. A settle move prints only when the day after it is on file too,
so a provisional last value is never called a settle (the same rule as
build_whats_priced_in.settle_moves). Wheat has no settles on file, so the wheat
line carries no move. A report over 35 days old, a progress week over 10 days
old, or anything dated after today is left out. No fact, no line.

Selftest: python3 scripts/moved_line.py --selftest
"""
import html as H
import json
import sys
from datetime import date

import pricefmt

MON = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
REPORT_MAX_DAYS = 35
PROGRESS_MAX_DAYS = 10

# page crop -> (wasde_pdf crop, harvest-prices window crop, progress key, progress words,
#               WASDE metrics to print, words that pick its whats-priced-in rows)
CROPS = {
    "corn": ("corn", "Corn", "corn_harvested", "of corn harvested",
             (("yield", "corn yield"), ("ending_stocks", "ending stocks")), ("corn",)),
    "soybean": ("soybeans", "Soybeans", "soybeans_harvested", "of soybeans harvested",
                (("yield", "soybean yield"), ("ending_stocks", "ending stocks")), ("soybean",)),
    "wheat": ("wheat", None, "winter_wheat_planted", "of winter wheat planted",
              (("ending_stocks", "wheat ending stocks"), ("production", "production")), ("wheat",)),
}


def _d(iso):
    try:
        y, m, d = (int(x) for x in str(iso)[:10].split("-"))
        return date(y, m, d)
    except (ValueError, TypeError):
        return None


def _md(dt):
    return f"{MON[dt.month - 1]} {dt.day}"


def _num(v, unit):
    """181.2 bu/acre keeps its tenth; bushels print whole with commas."""
    if unit == "bu/acre":
        return f"{float(v):.1f}"
    if unit == "$/bu":
        return f"${float(v):.2f}"
    f = float(v)
    return f"{f:,.0f}" if f == int(f) else f"{f:,.3f}".rstrip("0").rstrip(".")


def _delta(v, prev, unit):
    if prev is None:
        return ""
    dv = round(float(v) - float(prev), 4)
    if abs(dv) < 1e-9:
        return ", unchanged"
    mag = _num(abs(dv), unit)
    return (", up " if dv > 0 else ", down ") + mag


def wasde_part(crop, wasde, today):
    """(date, text) for the latest WASDE, or (None, "")."""
    blk = (wasde or {}).get("wasde_pdf") or {}
    dt = _d(blk.get("date"))
    c = (blk.get("crops") or {}).get(CROPS[crop][0]) or {}
    if not dt or not c or dt > today or (today - dt).days > REPORT_MAX_DAYS:
        return None, ""
    bits = []
    for key, words in CROPS[crop][4]:
        m = c.get(key) or {}
        if m.get("value") is None:
            continue
        unit = m.get("unit") or ""
        u = " bu/acre" if unit == "bu/acre" else (" million bu" if unit == "mil bu" else (" " + unit if unit else ""))
        bits.append(f"{words} {_num(m['value'], unit)}{u}{_delta(m['value'], m.get('prev'), unit)}")
    if not bits:
        return None, ""
    head = ", ".join(x for x in (c.get("marketing_year"), ("change from " + c["prev_month"]) if c.get("prev_month") else None) if x)
    return dt, f"{_md(dt)} WASDE" + (f" ({head})" if head else "") + ": " + "; ".join(bits) + "."


def other_report_part(crop, wpi, today, after):
    """(date, text) for a dated non-WASDE report in whats-priced-in history that
    is newer than `after` (the WASDE date), or (None, "")."""
    words = CROPS[crop][5]
    best = None
    for r in (wpi or {}).get("history") or []:
        dt = _d(r.get("date"))
        rep = str(r.get("report") or "")
        if not dt or "WASDE" in rep or dt > today or (today - dt).days > REPORT_MAX_DAYS:
            continue
        if after and dt <= after:
            continue
        lab = str(r.get("metric") or "")
        if not any(w in lab.lower() for w in words) or r.get("actual") is None:
            continue
        if best is None or dt > best[0]:
            best = (dt, rep, lab, r.get("actual"), r.get("unit") or "")
    if not best:
        return None, ""
    dt, rep, lab, val, unit = best
    return dt, f"{_md(dt)} {rep}: {lab[0].lower() + lab[1:]} {_num(val, unit)} {unit}".rstrip() + "."


def settle_part(crop, harvest, dt):
    """'Dec '26 settled 20½¢ lower that day ($5.00¼ to $4.79¾, CBOT settles).'
    when the report day and the days either side are on file, else ""."""
    want = CROPS[crop][1]
    if not want or not dt:
        return ""
    for w in (harvest or {}).get("windows") or []:
        if w.get("crop") != want:
            continue
        ser = sorted((x for x in (w.get("series") or [])
                      if x.get("d") and isinstance(x.get("s"), (int, float))), key=lambda x: x["d"])
        for i in range(1, len(ser) - 1):
            b = ser[i]
            if b["d"] != dt.isoformat() or b.get("p"):
                continue
            c0, c1 = round(ser[i - 1]["s"] * 100, 4), round(b["s"] * 100, 4)
            q = pricefmt.quarters(c1 - c0)
            what = ("settled unchanged" if q == 0 else
                    "settled %s %s that day" % (pricefmt.move(abs(c1 - c0)), "higher" if q > 0 else "lower"))
            return " %s %s (%s to %s, CBOT settles)." % (w.get("contract") or "", what, pricefmt.price(c0), pricefmt.price(c1))
    return ""


def progress_part(crop, progress, today):
    p = ((progress or {}).get("progress") or {}).get(CROPS[crop][2]) or {}
    dt = _d(p.get("date"))
    if p.get("pct") is None or not dt or dt > today or (today - dt).days > PROGRESS_MAX_DAYS:
        return ""
    ex = []
    if p.get("avg5") is not None:
        ex.append(f"5-yr avg {p['avg5']}%")
    if p.get("prev_year") is not None:
        ex.append(f"last year {p['prev_year']}%")
    return (f" Crop Progress, week ending {_md(dt)}: {p['pct']}% {CROPS[crop][3]}"
            + (f" ({', '.join(ex)})" if ex else "") + ".")


def moved_line(crop, wasde, wpi, harvest, progress, today):
    """Plain text of the line, or "" when there is no dated fact to print."""
    if not today:
        return ""
    wd, wt = wasde_part(crop, wasde, today)
    od, ot = other_report_part(crop, wpi, today, wd)
    if od:
        dt, txt = od, ot
    else:
        dt, txt = wd, wt
    if txt:
        txt += settle_part(crop, harvest, dt)
    txt += progress_part(crop, progress, today)
    return txt.strip()


def moved_html(crop, wasde, wpi, harvest, progress, today):
    t = moved_line(crop, wasde, wpi, harvest, progress, today)
    if not t:
        return '<p class="moved-line" id="moved-line" hidden></p>'
    src = ["USDA WASDE" if "WASDE" in t else "USDA"]
    if "settles" in t:
        src.append("CBOT settles")
    if "Crop Progress" in t:
        src.append("NASS Crop Progress" + ("; 5-yr avg is AGSIST's arithmetic on the NASS weeks" if "5-yr avg" in t else ""))
    return ('<p class="moved-line" id="moved-line"><b>Latest from USDA:</b> ' + H.escape(t, quote=False)
            + ' <span class="ml-src">Sources: ' + H.escape(", ".join(src), quote=False)
            + '. <a href="/whats-priced-in">Report track record</a></span></p>')


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _selftest():
    ok = True

    def chk(c, m):
        nonlocal ok
        print(("  OK   " if c else "  FAIL ") + m)
        ok = ok and c

    wasde = {"wasde_pdf": {"date": "2026-10-09", "crops": {
        "corn": {"marketing_year": "2026/27", "prev_month": "Sep", "yield": {"value": 181.2, "prev": 178.5, "unit": "bu/acre"},
                 "ending_stocks": {"value": 1849, "prev": 1567, "unit": "mil bu"}},
        "soybeans": {"prev_month": "Sep", "yield": {"value": 53.1, "prev": 52.8, "unit": "bu/acre"},
                     "ending_stocks": {"value": 315, "prev": 310, "unit": "mil bu"}},
        "wheat": {"prev_month": "Sep", "ending_stocks": {"value": 740, "prev": 717, "unit": "mil bu"},
                  "production": {"value": 1534, "prev": 1531, "unit": "mil bu"}}}}}
    harvest = {"windows": [
        {"crop": "Corn", "contract": "Dec '26", "series": [
            {"d": "2026-10-08", "s": 5.0025}, {"d": "2026-10-09", "s": 4.7975}, {"d": "2026-10-10", "s": 4.80, "p": True}]},
        {"crop": "Soybeans", "contract": "Nov '26", "series": [
            {"d": "2026-10-08", "s": 12.875}, {"d": "2026-10-09", "s": 12.92}]}]}
    prog = {"progress": {"corn_harvested": {"date": "2026-10-11", "pct": 33, "prev_year": None, "avg5": 39},
                         "winter_wheat_planted": {"date": "2026-10-11", "pct": 51, "prev_year": None, "avg5": 58}}}
    today = date(2026, 10, 16)
    corn = moved_line("corn", wasde, {}, harvest, prog, today)
    print("   ", corn)
    chk(corn.startswith("Oct 9 WASDE (2026/27, change from Sep): corn yield 181.2 bu/acre, up 2.7; ending stocks 1,849 million bu, up 282."),
        "corn: yield 181.2 up 2.7 (178.5 -> 181.2) and stocks up 282 (1,567 -> 1,849)")
    chk("Dec '26 settled 20½¢ lower that day ($5.00¼ to $4.79¾, CBOT settles)." in corn,
        "corn: 500.25 - 479.75 = 20.5 cents lower, from the settles on file")
    chk("week ending Oct 11: 33% of corn harvested (5-yr avg 39%)." in corn, "corn: harvest pace with the 5-yr avg")
    soy = moved_line("soybean", wasde, {}, harvest, prog, today)
    print("   ", soy)
    chk("soybean yield 53.1 bu/acre, up 0.3" in soy, "soy: 52.8 -> 53.1 is up 0.3")
    chk("settled" not in soy, "soy: Oct 9 is the last day on file, so no settle move is printed")
    wh = moved_line("wheat", wasde, {}, harvest, prog, today)
    print("   ", wh)
    chk(wh.startswith("Oct 9 WASDE (change from Sep): wheat ending stocks 740 million bu, up 23; production 1,534 million bu, up 3."),
        "wheat: stocks 717 -> 740 up 23, production 1,531 -> 1,534 up 3")
    chk("settled" not in wh and "51% of winter wheat planted (5-yr avg 58%)" in wh, "wheat: no move, planting pace")
    chk(moved_line("corn", wasde, {}, harvest, prog, date(2026, 11, 20)) == "",
        "Nov 20: a 42-day-old WASDE and a 40-day-old progress week print nothing")
    chk("Crop Progress" not in moved_line("corn", wasde, {}, harvest, prog, date(2026, 10, 22)),
        "Oct 22: the Oct 11 progress week (11 days) is dropped")
    chk(moved_line("corn", wasde, {}, harvest, prog, date(2026, 10, 8)) == "",
        "Oct 8: nothing dated after today is printed")
    wpi = {"history": [{"date": "2026-10-12", "report": "October Grain Stocks", "metric": "Corn stocks, all positions",
                        "actual": 2.095, "unit": "bil bu"}]}
    newer = moved_line("corn", wasde, wpi, harvest, {}, today)
    chk(newer.startswith("Oct 12 October Grain Stocks: corn stocks, all positions 2.095 bil bu."),
        "a report newer than the WASDE leads: " + newer)
    h = moved_html("corn", wasde, {}, harvest, prog, today)
    chk("—" not in h and "CBOT settles" in h and "AGSIST's arithmetic" in h, "html names its sources, no em dash")
    chk(moved_html("corn", {}, {}, {}, {}, today).endswith("hidden></p>"), "no facts: an empty hidden line")
    print("SELFTEST OK" if ok else "SELFTEST FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        raise SystemExit(_selftest())
    t = date.today()
    for c in CROPS:
        print(c, "|", moved_line(c, load("data/wasde.json"), load("data/whats-priced-in.json"),
                                 load("data/harvest-prices.json"), load("data/crop-progress.json"), t))
