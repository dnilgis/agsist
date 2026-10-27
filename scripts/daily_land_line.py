#!/usr/bin/env python3
"""daily_land_line.py: one Daily line for a ZIP reader near Illinois or Wisconsin farm sales (Sig, Oct 27, 2026:
land sales get a Daily line). scripts/only_here.py adds it under "Only here"; nothing else in the Daily changes.

For the newest monthly update (data/land-sales/latest.json, scripts/build_land_sales.py), in the first DAYS days
after the state files were read: how many farm sales of 10 acres or more were recorded that month within 25 miles
of the reader's ZIP, and the largest by acres. The same rows and rule as the monthly land sale email
(land_alert.month_report). No names, no parcel. Withheld when the month is not fresh, the reader is not near IL or WI,
or no sale is inside 25 miles.

    python3 scripts/daily_land_line.py --selftest
"""
import datetime
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)

MILES = 25
DAYS = 10
_LAND = {}


def latest(repo=REPO):
    try:
        return json.load(open(os.path.join(repo, "data", "land-sales", "latest.json"), encoding="utf-8"))
    except (OSError, ValueError):
        return None


def line(at, before, repo=REPO, land=None):
    """at = (lat, lon) of the reader's ZIP; before = the issue's day (ISO). A dict for only_here, or None."""
    if not at:
        return None
    L = latest(repo)
    if not L or not L.get("month") or not L.get("published"):
        return None
    try:
        age = (datetime.date.fromisoformat(before[:10]) - datetime.date.fromisoformat(L["published"][:10])).days
    except ValueError:
        return None
    if age < 0 or age > DAYS:
        return None
    import land_alert as LA
    if land is None:
        land = _LAND.get(repo) or _LAND.setdefault(repo, LA.Land(repo))
    year, m0 = int(L["month"][:4]), int(L["month"][5:7]) - 1
    today = max((L.get("fetched") or {}).values() or [L["published"]])
    rep = LA.month_report(land, tuple(at), MILES, year, m0, today)
    if "skip" in rep or not rep.get("n"):
        return None
    big = max(rep["rows"], key=lambda r: (r["acres"] or 0, -r["mi"]))
    n = rep["n"]
    text = ("Farm sales near you: %d of 10 acres or more recorded within %d miles in %s. The largest, %s acres in %s County, %s, at %s an acre."
            % (n, MILES, LA.MONTHS[m0], LA.acres_text(big["acres"]), big["county"], big["st"],
               LA.money(big["ppa"]) if big.get("ppa") is not None else "a price not figured per acre"))
    if n == 1:
        text = ("Farm sales near you: 1 of 10 acres or more recorded within %d miles in %s, %s acres in %s County, %s, at %s an acre."
                % (MILES, LA.MONTHS[m0], LA.acres_text(big["acres"]), big["county"], big["st"],
                   LA.money(big["ppa"]) if big.get("ppa") is not None else "a price not figured per acre"))
    return {"text": text, "kind": "land_sales", "url": "/land-sales/" + L["month"], "link": "The month's biggest buyers and sales", "n": n}


def _selftest():
    import tempfile
    bad = []

    def ok(c, m):
        print(("ok   " if c else "FAIL ") + m)
        if not c:
            bad.append(m)
    with tempfile.TemporaryDirectory() as t:
        os.makedirs(os.path.join(t, "data", "land", "wi"))
        os.makedirs(os.path.join(t, "data", "land-sales"))
        cols = ["doc", "date", "price", "acres", "tac", "np", "cls", "conv", "pid", "muni", "legal", "exempt", "grantor", "grantee", "ac1", "rec"]
        rows = [["A", "2026-09-02", 800000, 80.0, None, 1, "4", "Warranty Deed", "P1", "0", "SEC 1", 0, "SELLER A", "BUYER A", None, "2026-09-05"],
                ["B", "2026-09-03", 1600000, 160.0, None, 1, "4", "Warranty Deed", "P2", "0", "SEC 2", 0, "SELLER B", "BUYER B", None, "2026-09-06"]]
        json.dump({"state": "WI", "county": "Testa", "fips": "55999", "fetched_utc": "2026-10-03T00:00:00Z", "cols": cols, "rows": rows,
                   "munis": {"0": ["Town of Test", 45.0, -91.0]}, "coverage": {"from": "2020-01-01"}}, open(os.path.join(t, "data", "land", "wi", "55999.json"), "w"))
        json.dump({"state": "WI", "fetched_utc": "2026-10-03T00:00:00Z", "counties": [{"fips": "55999", "name": "Testa", "lat": 45.0, "lng": -91.0}]},
                  open(os.path.join(t, "data", "land", "wi", "index.json"), "w"))
        json.dump({"month": "2026-09", "published": "2026-10-03", "fetched": {"WI": "2026-10-03"}}, open(os.path.join(t, "data", "land-sales", "latest.json"), "w"))
        x = line((45.05, -91.0), "2026-10-04", t)
        ok(bool(x) and "2 of 10 acres or more" in x["text"] and "160 acres in Testa County, WI" in x["text"], "the line: %s" % (x and x["text"]))
        ok(x and x["url"] == "/land-sales/2026-09", "links the month's page")
        ok(x and "BUYER" not in x["text"] and "SELLER" not in x["text"], "no names")
        ok(line((45.05, -91.0), "2026-10-20", t) is None, "not after %d days" % DAYS)
        ok(line((45.05, -91.0), "2026-10-02", t) is None, "not before the update")
        ok(line((40.0, -100.0), "2026-10-04", t) is None, "not far from any county")
        ok(line(None, "2026-10-04", t) is None, "not without a ZIP")
        ok("—" not in (x or {}).get("text", ""), "no em dash")
    print("daily_land_line selftest:", "ok" if not bad else "%d failure(s)" % len(bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(_selftest() if "--selftest" in sys.argv else 0)
