#!/usr/bin/env python3
"""Writes the saved ACIS answers the county rain tests read. NOT REAL WEATHER.

Each file is shaped like an RCC-ACIS MultiStnData answer:
  {"data": [{"meta": {"name", "state", "sids", "ll": [lon, lat], "county"},
             "data": [["<pcpn>", "<normal>"], ...one row per day from Jan 1...]}]}
with ACIS's daily codes: "M" (not recorded), "T" (trace), "S" (not read; in
the next "A" value), "1.25A" (an accumulated total). The amounts are made up
by a seeded random walk; the stations are named like real ones so the page
wording can be checked, and nothing here is ever published as data.

The "_normal" key says which ACIS normals code the saved answer stands for;
FixtureSource refuses the other code, the way ACIS refuses one it does not
know. KS is saved as "1" to test the fallback.

  python3 test/fixtures/rain/make_fixtures.py
"""
import datetime as dt
import json
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
MON_IN = {  # a made-up usual inches per month
    "IA": [0.9, 1.1, 2.1, 3.6, 4.6, 5.0, 4.4, 4.0, 3.2, 2.6, 2.0, 1.3],
    "KS": [0.7, 0.9, 2.0, 2.7, 4.6, 4.9, 3.9, 3.7, 2.9, 2.3, 1.3, 1.0],
    "DE": [3.4, 3.0, 4.2, 3.6, 3.8, 3.7, 4.4, 4.2, 4.1, 3.6, 3.2, 3.8],
}
# name, sids, lon, lat, county, options
STATIONS = {
    "IA": [
        ("AMES 8 WSW", ["130203 2", "USC00130203 6"], -93.763, 41.990, "19169", {"gaps": [(150, 2), (201, 1)]}),
        ("AMES 2.4 SSE", ["US1IAST0007 10"], -93.611, 41.995, "19169", {"gaps": [(40, 30), (220, 30)], "nonorm": True}),
        ("BOONE", ["130807 2"], -93.880, 42.060, "19015", {"gaps": [(10, 60), (100, 30)]}),
        ("DES MOINES INTL AP", ["132203 2", "KDSM 5"], -93.653, 41.534, "19153", {}),
        ("MARSHALLTOWN", ["135198 2"], -92.909, 42.066, "19127", {"gaps": [(88, 1)]}),
        ("NEWTON", ["135952 2"], -93.061, 41.689, "19099", {}),
        ("FORT DODGE", ["132999 2"], -94.175, 42.499, "19187", {"gaps": [(170, 3)]}),
        ("IOWA FALLS", ["134142 2"], -93.267, 42.523, "19083", {}),
        ("JEFFERSON 1.2 N", ["US1IAGR0003 10"], -94.377, 42.033, "19073", {"nonorm": True}),
        ("ADEL", ["130112 2"], -94.017, 41.617, "19049", {"stops": 230}),
        ("ADEL 3.1 NE", ["US1IADL0010 10"], -93.990, 41.640, "19049", {"nonorm": True}),
        ("OMAHA EPPLEY AF", ["256255 2"], -95.899, 41.310, "31055", {}),
    ],
    "KS": [
        ("MANHATTAN", ["144972 2"], -96.588, 39.207, "20161", {"sa": True}),
        ("TOPEKA BILLARD MUNI AP", ["148167 2"], -95.626, 39.069, "20177", {}),
        ("SALINA MUNI AP", ["147160 2"], -97.651, 38.791, "20169", {}),
        ("GARDEN CITY EXP STN", ["142980 2"], -100.825, 37.993, "20055", {"sa": True}),
    ],
    "DE": [
        ("DOVER", ["072730 2"], -75.517, 39.159, "10001", {}),
        ("WILMINGTON NEW CASTLE CO AP", ["079595 2"], -75.606, 39.674, "10003", {}),
        ("GEORGETOWN 5 SW", ["073570 2"], -75.442, 38.637, "10005", {"gaps": [(59, 1)]}),
    ],
}


def series(st, year, end, seed, opt, nrm=True):
    rnd = random.Random(seed)
    d0 = dt.date(year, 1, 1)
    n = (end - d0).days + 1
    rows = []
    pend_s = 0
    for i in range(n):
        d = d0 + dt.timedelta(days=i)
        mi = d.month - 1
        days_m = ((dt.date(year + (mi == 11), (mi + 1) % 12 + 1, 1)) - dt.date(year, mi + 1, 1)).days
        usual = MON_IN[st][mi] / days_m
        p = 0.28
        if rnd.random() < p:
            v = rnd.expovariate(1 / (usual / p))
            v = round(min(v, 4.8), 2)
            s = "T" if v < 0.01 else f"{v:.2f}"
        else:
            s = "0.00"
        if opt.get("sa") and d.month == 5 and d.day in (10, 11):
            s = "S"
            pend_s += 1
        elif opt.get("sa") and d.month == 5 and d.day == 12:
            s = "1.37A"
        for a, k in opt.get("gaps", []):
            if a <= i < a + k:
                s = "M"
        if opt.get("stops") and i >= opt["stops"]:
            s = "M"
        norm = "M" if (opt.get("nonorm") or not nrm) else ("M" if d.month == 2 and d.day == 29 else f"{usual:.3f}")
        rows.append([s, norm])
    return rows


def write(st, year, end, with_norm, code):
    out = []
    for k, (name, sids, lon, lat, cty, opt) in enumerate(STATIONS[st]):
        rows = series(st, year, end, year * 100 + k * 7 + len(st), opt, with_norm)
        if not with_norm:
            rows = [[r[0]] for r in rows]
        out.append({"meta": {"name": name, "state": st, "sids": sids, "ll": [lon, lat], "county": cty}, "data": rows})
    j = {"data": out}
    if with_norm:
        j["_normal"] = code
    p = os.path.join(HERE, f"{st}-{year}.json")
    with open(p, "w") as fh:
        json.dump(j, fh, separators=(",", ":"))
        fh.write("\n")
    return p


if __name__ == "__main__":
    for p in (
        write("IA", 2026, dt.date(2026, 10, 12), True, "91"),
        write("IA", 2025, dt.date(2025, 12, 31), False, None),
        write("KS", 2026, dt.date(2026, 10, 12), True, "1"),
        write("KS", 2025, dt.date(2025, 12, 31), False, None),
        write("DE", 2024, dt.date(2024, 12, 31), True, "91"),
        write("DE", 2023, dt.date(2023, 12, 31), False, None),
    ):
        print(p, os.path.getsize(p))
