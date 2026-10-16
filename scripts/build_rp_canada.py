#!/usr/bin/env python3
"""Rain Print for Canada: the station list the page searches (2026-10-16).

Writes data/rain-print-ca/stations.json from NOAA's GHCN-Daily, which carries
Environment and Climate Change Canada's daily climate stations (source flag C)
and the CoCoRaHS Canada volunteer gauges (source flag N). The files come from
NOAA's public copy on Amazon S3 (noaa-ghcn-pds), the same files the page reads
a year from in the reader's browser (components/rp-canada.js). Nothing here is
estimated: every count is a count of days in the record.

Per station:
  id, name (as GHCN has it, in capitals), province, lat, lon, elevation (m),
  src: 'C' (ECCC) or 'N' (CoCoRaHS), whichever sent most of its rain days,
  q:   one letter per year from Y0 on, how whole that year's record is:
         a  rain: at most 10 days without a report, snowfall too
         b  rain: at most 10 days without a report, snowfall not kept
         c  rain: 11 to 31 days without a report
         -  more than 31 days without a report (no print), or no record
       The page uses it only to try the likely stations first; it still reads
       the year itself and applies the same missing-day rules as the US path.
  last: the last day with a rain report (YYYY-MM-DD), f: the first year of its rain record,
  nm:  1991-2020 monthly normals in mm, or null. A month counts only when every
       one of its days has a report (a multi-day total inside the month counts
       for its days); a normal needs 15 such years (ECCC's own floor for its
       normals) in every one of the twelve
       months. ny: the fewest years any month had. Computed here from the
       station's own daily record; it is not ECCC's published normal.

Rules a day must pass to count (the same rules rp-canada.js applies):
  PRCP with no quality flag, from source C or N (other sources are summaries
  of hourly reports and NOAA says to use them with caution: left out). M-flag
  T is a trace; H is a trace; P ("missing presumed zero") and I (no report)
  are missing. MDPR + DAPR (a total over several days) covers its days.

  python3 scripts/build_rp_canada.py              # build (needs network to S3)
  python3 scripts/build_rp_canada.py --selftest   # offline checks of the day rules
  python3 scripts/build_rp_canada.py --fixture ID YEAR OUT.csv   # save one station-year
"""
import csv
import datetime as dt
import gzip
import io
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "rain-print-ca", "stations.json")
S3 = "https://noaa-ghcn-pds.s3.amazonaws.com"
Y0 = 1990
LAST_FROM = 2000          # a station whose rain record ends before this year is left out
SOURCES = {"C", "N"}
MISS_OK, MISS_BLOCK = 10, 31
NORMAL_YEARS = (1991, 2020)
NORMAL_MIN = 15   # ECCC publishes normals for stations with at least 15 years of the 30 (climate normals readme)
FIELDS = ["id", "n", "p", "la", "lo", "el", "src", "q", "last", "nm", "ny", "f"]


def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                raise
            time.sleep(2 + 3 * i)


def is_leap(y):
    return (y % 4 == 0 and y % 100 != 0) or y % 400 == 0


def days_in(y):
    return 366 if is_leap(y) else 365


def read_rows(text):
    """GHCN by_station CSV rows -> {date: {elem: (value, mflag, qflag, sflag)}} for the elements used."""
    by = {}
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 7 or row[0] == "ID":
            continue
        el = row[2]
        if el not in ("PRCP", "SNOW", "MDPR", "DAPR"):
            continue
        try:
            v = int(row[3])
        except ValueError:
            continue
        by.setdefault(row[1], {})[el] = (v, row[4], row[5], row[6])
    return by


def day_status(rec):
    """One day's rain: ('ok', mm) | ('trace', 0) | None (missing). MDPR handled by caller."""
    p = rec.get("PRCP") if rec else None
    if not p:
        return None
    v, m, q, s = p
    if q or s not in SOURCES or m in ("P", "I") or v < 0:
        return None
    if m in ("T", "H"):
        return ("trace", 0.0)
    return ("ok", v / 10.0)


def snow_ok(rec):
    s = rec.get("SNOW") if rec else None
    if not s:
        return False
    v, m, q, src = s
    return not q and src in SOURCES and v >= 0 and m not in ("P", "I")


def year_days(by, y):
    """Every day of year y: list of (date, status) where status is 'ok', 'S' (in a multi-day total), or None."""
    start = dt.date(y, 1, 1)
    out = []
    for k in range(days_in(y)):
        d = start + dt.timedelta(days=k)
        key = d.strftime("%Y%m%d")
        st = day_status(by.get(key))
        out.append([key, "ok" if st else None, st[1] if st else None])
    # multi-day totals: MDPR on day d covers DAPR days ending on d
    for i, (key, st, _) in enumerate(out):
        rec = by.get(key) or {}
        md, da = rec.get("MDPR"), rec.get("DAPR")
        if st or not md or not da:
            continue
        v, m, q, s = md
        n = da[0]
        if q or s not in SOURCES or v < 0 or n < 2 or n > 40 or i - n + 1 < 0:
            continue
        if any(out[j][1] for j in range(i - n + 1, i)):
            continue
        for j in range(i - n + 1, i):
            out[j][1] = "S"
        out[i][1] = "A"
        out[i][2] = v / 10.0
    return out


def year_letter(by, y):
    days = year_days(by, y)
    miss = sum(1 for d in days if not d[1])
    if miss > MISS_BLOCK:
        return "-"
    if miss > MISS_OK:
        return "c"
    snow_miss = sum(1 for d in days if d[1] and not snow_ok(by.get(d[0])))
    return "a" if snow_miss <= MISS_OK else "b"


def normals(by):
    """1991-2020 monthly normals (mm) from whole months only, or (None, 0)."""
    sums = [[] for _ in range(12)]
    for y in range(NORMAL_YEARS[0], NORMAL_YEARS[1] + 1):
        days = year_days(by, y)
        tot, ok = [0.0] * 12, [True] * 12
        for key, st, v in days:
            m = int(key[4:6]) - 1
            if not st:
                ok[m] = False
            elif st in ("ok", "A"):
                tot[m] += v or 0.0
        # a multi-day total that started in the month before counts in the month it was read: keep it simple and honest,
        # a month whose first day is an S day carried from the month before is not whole
        for i, (key, st, v) in enumerate(days):
            if st == "S" and key[6:8] == "01" and i > 0 and days[i - 1][1] == "S":
                ok[int(key[4:6]) - 1] = False
        for m in range(12):
            if ok[m]:
                sums[m].append(tot[m])
    n = min(len(s) for s in sums)
    if n < NORMAL_MIN:
        return None, n
    return [round(sum(s) / len(s), 1) for s in sums], n


def station_list():
    st = {}
    for line in get(S3 + "/ghcnd-stations.txt").decode("latin-1").splitlines():
        if not line.startswith("CA"):
            continue
        try:
            st[line[0:11]] = {"lat": float(line[12:20]), "lon": float(line[21:30]), "el": float(line[31:37]),
                              "prov": line[38:40].strip(), "name": line[41:71].strip()}
        except ValueError:
            continue
    inv = {}
    for line in get(S3 + "/ghcnd-inventory.txt").decode("latin-1").splitlines():
        if not line.startswith("CA"):
            continue
        p = line.split()
        if len(p) >= 6 and p[3] == "PRCP":
            inv[p[0]] = (int(p[4]), int(p[5]))
    return [dict(id=k, **v, first=inv[k][0], lastY=inv[k][1]) for k, v in st.items()
            if k in inv and inv[k][1] >= LAST_FROM and v["prov"]]


def one(s, this_year):
    text = gzip.decompress(get(S3 + "/csv.gz/by_station/" + s["id"] + ".csv.gz")).decode("latin-1")
    by = read_rows(text)
    src = {}
    last = ""
    for k, rec in by.items():
        if day_status(rec):
            p = rec["PRCP"]
            src[p[3]] = src.get(p[3], 0) + 1
            if k > last:
                last = k
    if not last:
        return None
    q = "".join(year_letter(by, y) if y < this_year else "" for y in range(Y0, this_year))
    if not any(ch in "abc" for ch in q[LAST_FROM - Y0:]) and last[:4] != str(this_year):
        return None
    nm, ny = normals(by)
    el = s["el"]
    return {"id": s["id"], "n": s["name"], "p": s["prov"], "la": round(s["lat"], 4), "lo": round(s["lon"], 4),
            "el": None if el <= -999 else round(el), "src": max(src, key=src.get), "q": q,
            "last": last[:4] + "-" + last[4:6] + "-" + last[6:], "nm": nm, "ny": ny if nm else None, "f": s["first"]}


def build():
    this_year = dt.date.today().year
    cands = station_list()
    print(f"{len(cands)} Canadian stations with rain reports since {LAST_FROM}", flush=True)
    out, fails = [], []
    with ThreadPoolExecutor(max_workers=16) as ex:
        futs = {ex.submit(one, s, this_year): s for s in cands}
        for i, f in enumerate(futs):
            try:
                r = f.result()
                if r:
                    out.append(r)
            except Exception as e:  # noqa: BLE001
                fails.append(futs[f]["id"])
            if i % 250 == 0:
                print(f"  {i}/{len(cands)}", flush=True)
    if len(fails) > len(cands) * 0.05:
        sys.exit(f"Too many stations failed to download ({len(fails)}); not writing.")
    out.sort(key=lambda r: r["id"])
    doc = {
        "_about": "Rain Print for Canada (components/rp-canada.js). Canadian GHCN-Daily stations with rain reports since "
                  f"{LAST_FROM}: ECCC climate stations (src C) and CoCoRaHS Canada gauges (src N). q: one letter a year from y0 "
                  "(a: rain and snowfall whole, at most 10 days missing; b: rain whole, no snowfall record; c: 11 to 31 days "
                  "missing; -: more than 31 or none). nm: 1991-2020 monthly normals in mm computed from the station's own whole "
                  "months (ny years at least in every month), not ECCC's published normals. Built by scripts/build_rp_canada.py "
                  "from NOAA GHCN-Daily on S3 (noaa-ghcn-pds).",
        "built": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "y0": Y0, "fields": FIELDS,
        "s": [[r[k] for k in FIELDS] for r in out],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {len(out)} stations to {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) // 1024} KB); {len(fails)} failed")


def fixture(sid, year, path):
    """Save one station-year (and the day before and after) exactly as S3 serves it, for the tests."""
    text = get(S3 + "/csv/by_station/" + sid + ".csv").decode("latin-1")
    keep = [l for l in text.splitlines() if l.startswith("ID,") or l.split(",")[1][:4] == str(year)]
    with open(path, "w") as fh:
        fh.write("\n".join(keep) + "\n")
    print(f"{path}: {len(keep) - 1} rows")


def selftest():
    rows = "\n".join([
        "ID,DATE,ELEMENT,DATA_VALUE,M_FLAG,Q_FLAG,S_FLAG,OBS_TIME",
        "CA1XX000001,20240101,PRCP,25,,,N,",
        "CA1XX000001,20240102,PRCP,0,T,,N,",
        "CA1XX000001,20240103,PRCP,0,P,,C,",
        "CA1XX000001,20240104,PRCP,99,,X,C,",
        "CA1XX000001,20240105,PRCP,12,,,S,",
        "CA1XX000001,20240108,MDPR,40,,,N,",
        "CA1XX000001,20240108,DAPR,3,,,N,",
    ])
    by = read_rows(rows)
    days = year_days(by, 2024)
    assert days[0][1:] == ["ok", 2.5], days[0]
    assert days[1][1:] == ["ok", 0.0], days[1]
    assert days[2][1] is None and days[3][1] is None and days[4][1] is None   # P, failed QC, GSOD source
    assert [d[1] for d in days[5:8]] == ["S", "S", "A"] and days[7][2] == 4.0, days[5:8]
    assert len(days) == 366
    assert year_letter(by, 2024) == "-"
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    elif "--fixture" in sys.argv:
        i = sys.argv.index("--fixture")
        fixture(sys.argv[i + 1], int(sys.argv[i + 2]), sys.argv[i + 3])
    else:
        build()
