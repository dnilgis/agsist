#!/usr/bin/env python3
"""
AGSIST -- data/planting/<st>.json: station frost odds and heat-unit normals for
planting-date.html, one file per state (Wisconsin and Minnesota).

Source: NOAA NCEI U.S. Climate Normals, 1991-2020, per-station CSV files.
  Annual/seasonal (freeze probability dates):
    https://www.ncei.noaa.gov/data/normals-annualseasonal/1991-2020/access/<ID>.csv
  Daily (growing degree days, base 50 F, max 86 F: the corn GDU):
    https://www.ncei.noaa.gov/data/normals-daily/1991-2020/access/<ID>.csv
  Which stations are in which state: GHCN-Daily station list
    https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt
The sandbox this was written in cannot reach NCEI. GitHub runners can:
.github/workflows/planting-normals.yml runs it.

WHAT IS KEPT PER STATION
  s32  the three last-spring 32 F dates (10, 50, 90% probability columns),
       sorted earliest to latest, as "MM-DD". Sorting makes the column naming
       direction irrelevant: P(last freeze later than d) falls as d moves later,
       so the latest of the three is always the 1-in-10-years-later date.
  f32  the three first-fall 32 F dates, earliest to latest (the earliest is the
       1-in-10-years-earlier date).
  s28, f28  the same at 28 F, when the station has them.
  g    cumulative GDD (base 50, cap 86) from Apr 1, every 5 days: g[i] is the
       normal total from Apr 1 up to, not including, day-of-year 91 + 5 i
       (a 365-day year; NCEI normals have no Feb 29). 47 values, to Nov 17.

WHAT IT WILL NOT DO
  * Keep a freeze date it cannot read as a calendar date in the season it
    belongs to (spring Mar 1 to Jul 15, fall Aug 1 to Nov 30), three dates out
    of order, or a 10-to-90 spread over 60 days.
  * Keep a GDD series without 365 days, with a day under 0 or over 36 (86-50),
    or an Apr 1 to Oct 31 total outside 800 to 4,500.
  * Write a state with fewer than 20 stations that pass, or one that has under
    half the stations of the file already published.
  * Guess a column name: freeze columns must end in PRBLST-T32FP10 (etc.),
    GDD in GRDD-TB5086 or GRDD-TB5086-NORMAL (any case).

Modes:
  (default)      fetch WI and MN, validate, write data/planting/<st>.json
  --states WI,MN
  --probe        save the station listing, the station list lines for the
                 states and two stations' raw CSVs to data/planting-normals-raw/,
                 print what parsed. Writes no data file.
  --check        validate data/planting/*.json
  --selftest     offline tests on test/fixtures/planting-normals/
Stdlib only.
"""
import csv
import datetime
import io
import json
import math
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "planting"
RAW_DIR = ROOT / "data" / "planting-normals-raw"
FIX_DIR = ROOT / "test" / "fixtures" / "planting-normals"
SCHEMA = "agsist-planting-normals/1"
ANN_BASE = "https://www.ncei.noaa.gov/data/normals-annualseasonal/1991-2020/access/"
DLY_BASE = "https://www.ncei.noaa.gov/data/normals-daily/1991-2020/access/"
STN_URL = "https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt"
SRC_PAGE = "https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals"
UA = "agsist.com planting date normals (https://agsist.com/planting-date; yearly)"
STATES = ("WI", "MN")
PROBE_IDS = ("USW00014837", "USW00014922")   # Madison WI, Minneapolis MN airports
G_START, G_STEP, G_N = 91, 5, 47             # Apr 1, every 5 days, 47 values
MIN_STATIONS = 20
MDAYS = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


# ------------------------------------------------------------------ dates

def doy(mo, d):
    return sum(MDAYS[:mo - 1]) + d


def md_of_doy(n):
    mo = 1
    while n > MDAYS[mo - 1]:
        n -= MDAYS[mo - 1]
        mo += 1
    return "%02d-%02d" % (mo, n)


SEASON = {"spring": (doy(3, 1), doy(7, 15)), "fall": (doy(8, 1), doy(11, 30))}


def parse_date_cell(v, season):
    """A freeze-date cell as day of year, or None. NCEI has written these as
    MMDD numbers; a day-of-year reading is also tried. Only a reading that
    lands inside the season counts, and if both do, the cell is refused."""
    s = str(v or "").strip()
    if not re.fullmatch(r"-?\d+(\.0+)?", s):
        return None
    n = int(float(s))
    if n <= 0:
        return None          # -4444 / -7777 / -9999 style special values
    lo, hi = SEASON[season]
    hits = set()
    mo, d = divmod(n, 100)
    if 1 <= mo <= 12 and 1 <= d <= MDAYS[mo - 1]:
        x = doy(mo, d)
        if lo <= x <= hi:
            hits.add(x)
    if 1 <= n <= 365 and lo <= n <= hi:
        hits.add(n)
    return hits.pop() if len(hits) == 1 else None


def find_col(header, pattern):
    rx = re.compile(pattern, re.I)
    hits = [h for h in header if h and "flag" not in h.lower() and rx.search(h.strip())]
    return hits[0] if len(hits) == 1 else None


def three_dates(row, header, season, temp):
    kind = "PRBLST" if season == "spring" else "PRBFST"
    out = []
    for p in ("10", "50", "90"):
        c = find_col(header, r"(^|-)%s-T%sFP%s$" % (kind, temp, p))
        if c is None:
            return None, "no %s T%s FP%s column" % (kind, temp, p)
        x = parse_date_cell(row.get(c), season)
        if x is None:
            return None, "%s T%s FP%s unreadable: %r" % (kind, temp, p, row.get(c))
        out.append(x)
    p50 = out[1]
    s = sorted(out)
    if s[1] != p50:
        return None, "the 50%% date is not the middle one: %s" % out
    if s[2] - s[0] > 60:
        return None, "10-to-90 spread over 60 days: %s" % out
    return [md_of_doy(x) for x in s], None


def num(v):
    s = str(v or "").strip()
    if not re.fullmatch(r"-?\d+(\.\d+)?", s):
        return None
    return float(s)


# ------------------------------------------------------------------ parsers

def parse_annual(text):
    """-> (meta, {s32,f32,s28,f28}, problems)"""
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        return None, None, ["empty annual CSV"]
    row, header = rows[0], list(rows[0].keys())
    meta = {}
    for k in ("STATION", "NAME", "LATITUDE", "LONGITUDE", "ELEVATION"):
        c = find_col(header, "^%s$" % k)
        meta[k] = row.get(c) if c else None
    out, probs = {}, []
    for key, season, temp in (("s32", "spring", "32"), ("f32", "fall", "32"),
                              ("s28", "spring", "28"), ("f28", "fall", "28")):
        v, why = three_dates(row, header, season, temp)
        if v:
            out[key] = v
        else:
            probs.append(key + ": " + why)
    # The two seasons must not cross: last spring median before first fall median.
    if "s32" in out and "f32" in out:
        a = doy(*map(int, out["s32"][1].split("-")))
        b = doy(*map(int, out["f32"][1].split("-")))
        if not a < b:
            probs.append("spring median not before fall median")
            out.pop("s32"); out.pop("f32")
    return meta, out, probs


def parse_daily(text):
    """-> (g list or None, problem or None)"""
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        return None, "empty daily CSV"
    header = list(rows[0].keys())
    c = find_col(header, r"GRDD-TB5086(-NORMAL)?$")
    dc = find_col(header, r"^DATE$")
    if c is None or dc is None:
        return None, "no GRDD-TB5086 or DATE column"
    vals = {}
    for r in rows:
        m = re.search(r"(\d{2})-(\d{2})$", str(r.get(dc) or "").strip())
        if not m:
            continue
        mo, d = int(m.group(1)), int(m.group(2))
        if mo == 2 and d == 29:
            continue
        v = num(r.get(c))
        if v is None or v < 0 or v > 36:
            return None, "GDD value out of range on %02d-%02d: %r" % (mo, d, r.get(c))
        vals[doy(mo, d)] = v
    if len(vals) != 365:
        return None, "GDD has %d days, not 365" % len(vals)
    season = sum(vals[x] for x in range(doy(4, 1), doy(10, 31) + 1))
    if not 800 <= season <= 4500:
        return None, "Apr 1 to Oct 31 GDD %.0f outside 800 to 4,500" % season
    g, cum = [], 0.0
    for i in range(G_N):
        start = G_START + G_STEP * i
        if i:
            cum += sum(vals[x] for x in range(start - G_STEP, start))
        g.append(int(round(cum)))
    return g, None


def station_record(sid, ann_text, dly_text):
    meta, fr, probs = parse_annual(ann_text) if ann_text else (None, {}, ["no annual CSV"])
    if not meta or "s32" not in (fr or {}) or "f32" not in (fr or {}):
        return None, probs
    try:
        lat, lon = float(meta["LATITUDE"]), float(meta["LONGITUDE"])
    except (TypeError, ValueError):
        return None, probs + ["no coordinates"]
    if not (24 < lat < 50 and -125 < lon < -66):
        return None, probs + ["coordinates outside the lower 48"]
    rec = {"id": sid, "n": re.sub(r",\s*[A-Z]{2}\s+US$", "", str(meta.get("NAME") or sid)).strip().title(),
           "lat": round(lat, 4), "lon": round(lon, 4)}
    el = num(meta.get("ELEVATION"))
    if el is not None:
        rec["el"] = int(round(el * 3.28084))     # NCEI gives metres
    rec.update(fr)
    if dly_text:
        g, why = parse_daily(dly_text)
        if g:
            rec["g"] = g
        else:
            probs.append("gdd: " + why)
    return rec, probs


def validate_file(d, name="file"):
    errs = []
    if d.get("schema") != SCHEMA:
        errs.append("%s: schema %r" % (name, d.get("schema")))
    st = d.get("stations") or []
    if len(st) < MIN_STATIONS:
        errs.append("%s: %d stations, need %d" % (name, len(st), MIN_STATIONS))
    for s in st:
        for k in ("s32", "f32"):
            v = s.get(k)
            if not (isinstance(v, list) and len(v) == 3 and all(re.fullmatch(r"\d{2}-\d{2}", x) for x in v) and v == sorted(v)):
                errs.append("%s: %s bad %s %r" % (name, s.get("id"), k, v))
        g = s.get("g")
        if g is not None and (len(g) != G_N or g[0] != 0 or any(b < a for a, b in zip(g, g[1:]))):
            errs.append("%s: %s bad gdd series" % (name, s.get("id")))
        if not (isinstance(s.get("lat"), (int, float)) and isinstance(s.get("lon"), (int, float))):
            errs.append("%s: %s no coordinates" % (name, s.get("id")))
    return errs


# ------------------------------------------------------------------ network

def http_get(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace"), None
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None, "404"
            last = "HTTP %s" % e.code
        except Exception as e:  # noqa: BLE001
            last = str(e)
        time.sleep(3 * (i + 1))
    return None, last


def state_station_ids(stations_txt, states):
    """GHCN-Daily list -> {state: [ids]} for COOP (USC00) and first-order (USW00) ids."""
    out = {s: [] for s in states}
    for line in stations_txt.splitlines():
        sid, st = line[0:11].strip(), line[38:40].strip()
        if st in out and (sid.startswith("USC00") or sid.startswith("USW00")):
            out[st].append(sid)
    return out


def listing_ids(html):
    return set(re.findall(r'href="(US[CW]00\d{6})\.csv"', html))


def build_state(st, ids, have_ann, get=http_get, log=print):
    stations, skipped = [], 0
    for sid in sorted(ids):
        if sid not in have_ann:
            continue
        ann, err = get(ANN_BASE + sid + ".csv")
        if ann is None:
            skipped += 1
            continue
        dly, _ = get(DLY_BASE + sid + ".csv")
        rec, probs = station_record(sid, ann, dly)
        if rec:
            stations.append(rec)
        else:
            skipped += 1
        time.sleep(0.15)
    log("  %s: %d stations kept, %d skipped" % (st, len(stations), skipped))
    return stations


def write_state(st, stations, now=None):
    path = OUT_DIR / (st.lower() + ".json")
    if len(stations) < MIN_STATIONS:
        print("  %s: only %d stations passed; keeping the published file" % (st, len(stations)))
        return False
    if path.exists():
        try:
            old = json.loads(path.read_text())
            if len(stations) < len(old.get("stations") or []) / 2:
                print("  %s: %d stations is under half of the published %d; refused" % (st, len(stations), len(old["stations"])))
                return False
        except ValueError:
            pass
    d = {"schema": SCHEMA, "state": st, "normals": "1991-2020",
         "source": "NOAA NCEI U.S. Climate Normals 1991-2020 (station freeze probability dates; daily growing degree days base 50 F, max 86 F)",
         "source_url": SRC_PAGE,
         "built_utc": (now or datetime.datetime.now(datetime.timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"),
         "g_start": "04-01", "g_step_days": G_STEP,
         "stations": stations}
    errs = validate_file(d, path.name)
    if errs:
        print("  %s: refused, %s" % (st, "; ".join(errs[:5])))
        return False
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(d, separators=(",", ":")) + "\n")
    print("  wrote %s (%d stations, %d with GDD)" % (path.relative_to(ROOT), len(stations), sum(1 for s in stations if "g" in s)))
    return True


def run(states):
    stx, err = http_get(STN_URL)
    if stx is None:
        print("station list failed: %s" % err); return 1
    lst, err = http_get(ANN_BASE)
    if lst is None:
        print("normals listing failed: %s" % err); return 1
    have = listing_ids(lst)
    print("normals stations listed: %d" % len(have))
    by_state = state_station_ids(stx, states)
    ok = 0
    for st in states:
        ok += write_state(st, build_state(st, by_state[st], have))
    return 0 if ok else 1


def probe(states):
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    stx, err = http_get(STN_URL)
    print("station list:", "ok" if stx else err)
    if stx:
        keep = [l for l in stx.splitlines() if l[38:40].strip() in states]
        (RAW_DIR / "ghcnd-stations-states.txt").write_text("\n".join(keep) + "\n")
    lst, err = http_get(ANN_BASE)
    print("normals listing:", "ok" if lst else err)
    if lst:
        (RAW_DIR / "annual-listing.html").write_text(lst)
        print("  ids listed:", len(listing_ids(lst)))
    for sid in PROBE_IDS:
        for base, tag in ((ANN_BASE, "annual"), (DLY_BASE, "daily")):
            t, err = http_get(base + sid + ".csv")
            print(sid, tag, "ok" if t else err)
            if t:
                (RAW_DIR / ("%s-%s.csv" % (sid, tag))).write_text(t)
                print("  header:", t.splitlines()[0][:600])
        ann = RAW_DIR / ("%s-annual.csv" % sid)
        dly = RAW_DIR / ("%s-daily.csv" % sid)
        rec, probs = station_record(sid, ann.read_text() if ann.exists() else None,
                                    dly.read_text() if dly.exists() else None)
        print("  parsed:", json.dumps(rec)[:400] if rec else None)
        print("  problems:", probs)
    return 0


def check():
    files = sorted(OUT_DIR.glob("*.json"))
    errs = []
    for f in files:
        errs += validate_file(json.loads(f.read_text()), f.name)
    for e in errs:
        print("FAIL", e)
    print("checked %d file(s), %d problem(s)" % (len(files), len(errs)))
    return 1 if errs else 0


# ------------------------------------------------------------------ selftest

def selftest():
    fails = 0

    def ok(c, msg):
        nonlocal fails
        print(("ok   " if c else "FAIL ") + msg)
        if not c:
            fails += 1

    ok(doy(4, 1) == 91 and doy(12, 31) == 365, "day of year: Apr 1 = 91, Dec 31 = 365")
    ok(md_of_doy(128) == "05-08", "day 128 is May 8")
    ok(parse_date_cell("508", "spring") == doy(5, 8), "MMDD 508 is May 8 in spring")
    ok(parse_date_cell("0508", "spring") == doy(5, 8), "MMDD 0508 is May 8")
    ok(parse_date_cell("128", "spring") == doy(5, 8), "day-of-year 128 read as May 8 (Jan 28 is not spring)")
    ok(parse_date_cell("1002", "fall") == doy(10, 2), "MMDD 1002 is Oct 2 in fall")
    ok(parse_date_cell("-4444", "spring") is None, "special value -4444 refused")
    ok(parse_date_cell("1002", "spring") is None, "a fall date in the spring column refused")
    ok(parse_date_cell("abc", "spring") is None, "text refused")
    ann = (FIX_DIR / "USW00099991-annual.csv").read_text()
    dly = (FIX_DIR / "USW00099991-daily.csv").read_text()
    rec, probs = station_record("USW00099991", ann, dly)
    ok(rec is not None, "fixture station parses: %s" % probs)
    if rec:
        ok(rec["s32"] == ["04-24", "05-08", "05-22"], "spring 32 F dates sorted early to late: %s" % rec["s32"])
        ok(rec["f32"] == ["09-20", "10-02", "10-14"], "fall 32 F dates: %s" % rec["f32"])
        ok(rec.get("s28") == ["04-10", "04-22", "05-04"], "spring 28 F dates: %s" % rec.get("s28"))
        ok(rec["n"] == "Testville Airport", "name without the state suffix: %s" % rec["n"])
        ok(rec["el"] == 860, "elevation metres to feet: 262.1 m = 860 ft (%s)" % rec.get("el"))
        g = rec.get("g")
        ok(g is not None and len(g) == G_N and g[0] == 0, "GDD series: 47 values from 0")
        # Fixture GDD: 5 a day in April, 15 in May, 20 Jun-Aug, 10 in Sep, 2 in Oct, 0 after.
        # g[6] = Apr 1 to Apr 30 = 30 x 5 = 150. g[12] = to May 30 = 150 + 30 x 15 = 600.
        ok(g and g[6] == 150, "g[6] = 30 x 5 = 150 (%s)" % (g and g[6]))
        ok(g and g[12] == 600, "g[12] = 150 + 30 x 15 = 600 (%s)" % (g and g[12]))
    bad = ann.replace(",508,", ",508X,")
    r2, p2 = station_record("USW00099991", bad, dly)
    ok(r2 is None, "an unreadable spring 50% date drops the station")
    swapped = (FIX_DIR / "USW00099992-annual.csv").read_text()
    r3, p3 = station_record("USW00099992", swapped, None)
    ok(r3 is None and any("middle" in p for p in p3), "a 50%% date outside the other two is refused: %s" % p3)
    g4, why = parse_daily(dly.replace("05-15,15.0", "05-15,40.0"))
    ok(g4 is None and "out of range" in why, "a GDD day over 36 refuses the series")
    g5, why5 = parse_daily("\n".join(dly.splitlines()[:200]))
    ok(g5 is None and "365" in why5, "a short GDD series is refused")
    noc, w6 = parse_daily(dly.replace("DLY-GRDD-TB5086-NORMAL", "DLY-GRDD-BASE50-NORMAL"))
    ok(noc is None, "a GDD column with a different base is not guessed")
    # Fixed-width like ghcnd-stations.txt: id 1-11, lat 13-20, lon 22-30, elev 32-37, state 39-40.
    fw = lambda sid, lat, lon, el, st, name: "%-11s %8.4f %9.4f %6.1f %-2s %s" % (sid, lat, lon, el, st, name)
    txt = "\n".join([fw("USC00470124", 44.1, -91.1, 300.0, "WI", "ALMA DAM 4"),
                     fw("USC00210075", 43.65, -93.37, 371.0, "MN", "ALBERT LEA"),
                     fw("US1WIDN0001", 43.0, -89.0, 260.0, "WI", "MADISON 1.2 NE"),
                     fw("USC00130112", 42.0, -93.6, 300.0, "IA", "AMES")]) + "\n"
    by = state_station_ids(txt, ("WI", "MN"))
    ok(by == {"WI": ["USC00470124"], "MN": ["USC00210075"]}, "station list: COOP ids by state, CoCoRaHS and other states left out: %s" % by)
    ok(listing_ids('<a href="USW00014837.csv">x</a><a href="USC00470124.csv">') == {"USW00014837", "USC00470124"}, "listing ids read")
    # A whole state through build_state with a fake network.
    pages = {ANN_BASE + "USW%08d.csv" % i: ann.replace("USW00099991", "USW%08d" % i) for i in range(25)}
    pages.update({DLY_BASE + "USW%08d.csv" % i: dly for i in range(25)})
    ids = ["USW%08d" % i for i in range(25)]
    sts = build_state("WI", ids, set(ids), get=lambda u: (pages.get(u), None if u in pages else "404"), log=lambda *a: None)
    ok(len(sts) == 25, "fake state: 25 stations built")
    d = {"schema": SCHEMA, "stations": sts}
    ok(validate_file(d) == [], "fake state file validates")
    ok(validate_file({"schema": SCHEMA, "stations": sts[:5]}) != [], "5 stations is too thin to write")
    print("selftest: %d failure(s)" % fails)
    return 1 if fails else 0


def main(argv):
    states = STATES
    if "--states" in argv:
        states = tuple(s.strip().upper() for s in argv[argv.index("--states") + 1].split(",") if s.strip())
    if "--selftest" in argv:
        return selftest()
    if "--check" in argv:
        return check()
    if "--probe" in argv:
        return probe(states)
    return run(states)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
