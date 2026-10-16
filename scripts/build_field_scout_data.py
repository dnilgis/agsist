#!/usr/bin/env python3
"""Small per-place slices of three national files, so one Field Scout read
does not download the whole country.

Before (Oct 16, 2026) one field read pulled about 3.9 MB of JSON: the national
tenure file (589 KB), the national AFIDA file (774 KB) and five national hail
event files (2.1 MB), to use one county and the reports within 40 miles.

Writes (nothing here is new data, only the same records cut smaller):

  data/field-scout/county/<ST>.json
      {"tenure": {"years": [...], "counties": {fips: record}},
       "afida": {fips: record}}
      Records are copied unchanged from data/tenure/tenure.json and
      data/afida/county.json, split by the first two digits of the county FIPS.
      Every state gets a file, even an empty one, so a 404 means a failed
      read and never "no data".

  data/field-scout/hail/index.json
      {"years": [closed years], "cell": 2, "cells": ["40_-94", ...]}
  data/field-scout/hail/<lat>_<lon>.json
      {"years": [...], "ev": [[lat, lon, size_in, "MM-DD", year], ...]}
      Hail reports from data/hail/events-YYYY.json for every year, the
      current one included, in 2 x 2 degree cells keyed by the cell's
      south-west corner. A cell with no report has no file and is not in
      "cells". The current year changes with each hail run, and
      .github/workflows/hail-data.yml rebuilds these cells in the same run
      and commit, so the cells never lag the national file. (Until Oct 16,
      2026 the current year was left out and the page read its 357 KB
      national file on every field.)

  python3 scripts/build_field_scout_data.py           # write
  python3 scripts/build_field_scout_data.py --check   # exit 1 if the slices
                                                      # no longer match the sources
"""
import glob
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "field-scout")
CELL = 2

FIPS_ST = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT",
    "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL",
    "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD",
    "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE",
    "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
    "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
    "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
    "55": "WI", "56": "WY",
}


def load(path):
    with open(os.path.join(ROOT, path)) as fh:
        return json.load(fh)


def dumps(obj):
    return json.dumps(obj, separators=(",", ":"), sort_keys=True)


def county_slices():
    ten = load("data/tenure/tenure.json")
    afi = load("data/afida/county.json")
    out = {st: {"tenure": {"years": ten.get("years", []), "counties": {}}, "afida": {}}
           for st in FIPS_ST.values()}
    for fips, rec in (ten.get("counties") or {}).items():
        st = FIPS_ST.get(str(fips)[:2])
        if st:
            out[st]["tenure"]["counties"][fips] = rec
    for fips, rec in afi.items():
        st = FIPS_ST.get(str(fips)[:2])
        if st:
            out[st]["afida"][fips] = rec
    return {"county/%s.json" % st: body for st, body in out.items()}


def cell_key(lat, lon):
    return "%d_%d" % (math.floor(lat / CELL) * CELL, math.floor(lon / CELL) * CELL)


def hail_slices():
    files = sorted(glob.glob(os.path.join(ROOT, "data", "hail", "events-*.json")))
    years = sorted(int(re.search(r"events-(\d{4})\.json$", f).group(1)) for f in files)
    if not years:
        return {}
    closed = years               # every year; hail-data.yml rebuilds the cells with each fetch
    cells = {}
    for y in closed:
        d = load("data/hail/events-%d.json" % y)
        for e in d.get("ev", []):
            lat, lon = float(e[0]), float(e[1])
            cells.setdefault(cell_key(lat, lon), []).append([e[0], e[1], e[2], e[3], y])
    out = {"hail/index.json": {"years": closed, "cell": CELL, "cells": sorted(cells)}}
    for k, ev in cells.items():
        out["hail/%s.json" % k] = {"years": closed, "ev": ev}
    return out


def build():
    files = {}
    files.update(county_slices())
    files.update(hail_slices())
    return {k: dumps(v) for k, v in files.items()}


def existing():
    have = {}
    for p in glob.glob(os.path.join(OUT, "**", "*.json"), recursive=True):
        rel = os.path.relpath(p, OUT).replace(os.sep, "/")
        with open(p) as fh:
            have[rel] = fh.read()
    return have


def main():
    want = build()
    if "--check" in sys.argv:
        have = existing()
        bad = sorted(k for k in set(want) | set(have) if want.get(k) != have.get(k))
        if bad:
            print("field-scout slices are stale (%d files, e.g. %s): run python3 scripts/build_field_scout_data.py"
                  % (len(bad), ", ".join(bad[:5])))
            return 1
        print("field-scout slices match their sources (%d files)" % len(want))
        return 0
    for rel in set(existing()) - set(want):
        os.remove(os.path.join(OUT, rel))
    for rel, body in want.items():
        p = os.path.join(OUT, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as fh:
            fh.write(body)
    total = sum(len(b) for b in want.values())
    print("wrote %d files, %.1f KB" % (len(want), total / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
