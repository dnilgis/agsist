#!/usr/bin/env python3
"""Writes the saved ACIS answers scripts/fetch_rain_weather.py --selftest reads. NOT REAL WEATHER.

Shaped like RCC-ACIS MultiStnData answers ({"data": [{"meta": {...}, "data": [[maxt, mint], ...]}]});
the 1991-2020 rows use a test-only shorthand, "rep": [[rows, times], ...], that the test reader
expands. Highs and lows are a smooth made-up season; the station names are real ones so the
wording can be checked, and nothing here is ever published as data.

  rain-ia.json      a cut-down county rain state file (three Iowa counties)
  year-ia.json      this year's highs and lows, Jan 1 to Nov 3, 2026, for the state
  norm-ia.json      1991-2020 highs and lows for the two co-op stations
  rec-ia-10.json    each year's highest October high and lowest October low, 1850-2025
  rec-ia-11.json    the same for November

  python3 test/fixtures/rain-wx/make_fixtures.py
"""
import datetime as dt
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
YEAR, EDATE = 2026, "2026-11-03"


def season(d, warm=0.0):
    """A made-up smooth high and low for a day (Iowa-ish)."""
    k = (d - dt.date(d.year, 1, 1)).days
    c = math.cos(2 * math.pi * (k - 200) / 365.0)
    return round(57 + 30 * c + warm), round(36 + 28 * c + warm)


def year_rows(miss_every=0):
    out = []
    d = dt.date(YEAR, 1, 1)
    i = 0
    while d.isoformat() <= EDATE:
        h, l = season(d)
        if d == dt.date(YEAR, 10, 5):
            h = 88
        if miss_every and i % miss_every == 0:
            out.append(["M", "M"])
        else:
            out.append([str(h), str(l)])
        d += dt.timedelta(days=1)
        i += 1
    return out


def main():
    rain = {"schema": "agsist-county-rain/1", "state": "IA", "year": YEAR, "edate": EDATE,
            "fetched": "2026-11-04T13:27:11Z", "normals": "1991-2020",
            "counties": {
                "19015": {"name": "Boone County", "as_of": EDATE,
                          "station": {"raw": "BOONE", "name": "Boone", "sid": "130807 2", "net": "noaa", "ll": [-93.88, 42.06], "mi": 4.0}},
                "19169": {"name": "Story County", "as_of": EDATE,
                          "station": {"raw": "GILBERT 0.2 W", "name": "Gilbert, 0.2 mi W", "sid": "US1IASR0019 6", "net": "cocorahs",
                                      "ll": [-93.6511, 42.1079], "mi": 11.0}},
                "19127": {"name": "Marshall County", "as_of": EDATE,
                          "station": {"raw": "MARSHALLTOWN", "name": "Marshalltown", "sid": "135198 2", "net": "noaa", "ll": [-92.909, 42.066], "mi": 3.0}},
            }, "none": {}}
    json.dump(rain, open(os.path.join(HERE, "rain-ia.json"), "w"), indent=0)
    meta = lambda name, sids, ll, county: {"name": name, "state": "IA", "sids": sids, "ll": ll, "county": county}
    year = {"data": [
        {"meta": meta("BOONE", ["130807 2"], [-93.88, 42.06], "19015"), "data": year_rows()},
        {"meta": meta("AMES 8 WSW", ["130203 2", "USC00130203 6"], [-93.763, 41.99], "19169"), "data": year_rows()},
        {"meta": meta("MARSHALLTOWN", ["135198 2"], [-92.909, 42.066], "19127"), "data": year_rows(miss_every=2)},
    ]}
    json.dump(year, open(os.path.join(HERE, "year-ia.json"), "w"), separators=(",", ":"))
    # 1991-2020: a made-up 1991-1994 block (1992 a leap year), a little cooler than this year,
    # repeated 7 times, then 2019-2020 (the block's first two years line up: 2020 is a leap year)
    block = []
    d = dt.date(1991, 1, 1)
    while d.year < 1995:
        h, l = season(d, -1.0)
        block.append([str(h), str(l)])
        d += dt.timedelta(days=1)
    rep = [[block, 7], [block[:365 + 366], 1]]
    norm = {"data": [{"meta": {"sids": ["130807 2"]}, "rep": rep},
                     {"meta": {"sids": ["130203 2", "USC00130203 6"]}, "rep": rep}]}
    json.dump(norm, open(os.path.join(HERE, "norm-ia.json"), "w"), separators=(",", ":"))
    # the month records, 1850-2025: the stations begin in 1951; October 2011 reached 90
    for m in (10, 11):
        rows = []
        for y in range(1850, 2026):
            if y < 1951:
                rows.append(["M", "M"])
            elif m == 10 and y == 2011:
                rows.append(["90", "18"])
            else:
                rows.append([str(80 + y % 5 if m == 10 else 66 + y % 4), str(18 + y % 3 if m == 10 else 2 + y % 5)])
        rec = {"data": [{"meta": {"sids": ["130807 2"]}, "data": rows},
                        {"meta": {"sids": ["130203 2", "USC00130203 6"]}, "data": rows}]}
        json.dump(rec, open(os.path.join(HERE, f"rec-ia-{m:02d}.json"), "w"), separators=(",", ":"))


if __name__ == "__main__":
    main()
