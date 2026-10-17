#!/usr/bin/env python3
"""
fetch_prf.py — USDA RMA Pasture, Rangeland, Forage (PRF) rainfall index:
premium rates, county base values and the index history for every grid in the
48 contiguous states -> data/prf/

WHY THIS EXISTS
  /prf lets a producer see what a PRF policy would have paid in every year on
  record for the intervals they pick. RMA's own tool shows one sample year at a
  time and needs a round trip to its server for each change. Everything the
  arithmetic needs is public; this mirrors it, unchanged, so the page can do the
  arithmetic in the reader's hand. Nothing here is estimated or modelled.

THE TWO SOURCES (both opened by a probe on 2026-10-12, since removed)
  1. The Actuarial Data Master, one zip per crop year, about 1.2 GB:
       https://pubfs-rma.fpac.usda.gov/pub/References/actuarial_data_master/<YYYY>/<YYYY>_ADM_YTD.zip
     Pipe-delimited, one header line per member. PRF is commodity 0088, plan 13.
       A00030 InsuranceOffer     offer id -> county, intended use, irrigation and
                                 organic practice, interval. 232,184 PRF offers.
       A00810 Price              offer x grid ("Sub County Code") -> county base
                                 value, minimum and maximum acre percent,
                                 expected index (always 1.0000).
       A01130 AreaCoverageLevel  offer x grid x coverage level -> area rate id.
       A01135 AreaRate           area rate id -> base rate (the premium rate).
       A00200 Date               sales closing, acreage reporting, billing.
       A00070 SubsidyPercent     plan 13 by coverage level.
       A00480 / A00440 / A00520  interval, county and state names.
     Rows with a Deleted Date are skipped and counted.
  2. The service behind RMA's PRF tool, one call per grid:
       https://public-rma.fpac.usda.gov/apps/PrfWebApi/PrfExternalIndexes/GetIndexValues
         ?intervalType=BiMonthly&sampleYearMinimum=..&sampleYearMaximum=..&gridId=..
     -> HistoricalIndexRows[].HistoricalIndexDataColumns[] with IntervalCode,
        PercentOfNormal (a fraction to three places, null when unpublished),
        IntervalMeasurement and AverageIntervalMeasurement (millimetres) and
        FilingStatusId. The record starts in 1951.

WHAT WAS MEASURED BEFORE THIS WAS WRITTEN (rule 44, rule 45)
  * In Wisconsin, Texas and Montana the premium rate depends on the grid, the
    interval and the coverage level and on nothing else: 121,055 keys, none with
    two rates, and 847,385 keys once use and practice are added, none with two.
    That is three states, so it is ASSERTED over the whole country on every
    run. A grid with two rates for one key stops the run.
  * A county, use and practice has one county base value in 21,184 of 21,185
    cases. The odd one is kept per grid ("bg" in the state file).
  * Minimum and maximum acre percent come in four pairs (10-25, 10-50, 10-60,
    10-70). They are stored per county and interval; if they are ever found to
    differ between grids of one county the run stops and says where.
  * The rate in the ADM for grid 30152 equals the rate RMA's tool returns for
    it, for all 55 interval and coverage pairs (test/prf-math.test.mjs).
  * Grid ids are row x 300 + column + 1 over NOAA's quarter-degree boxes from
    20N 130W. Hawaii has lettered grids (H0420...), its own crop provisions and
    is NOT in this build. It is counted and reported, never dropped silently.

OUTPUT (all under data/prf/, written only when the bytes change)
  meta.json          crop year, dates, subsidy, counts, what was checked
  s/<ST>.json        one state's counties: name, grids, base values, limits
  g/<row>_<blk>.json twenty grids across: history to the last complete year
                     (uint16 x 1000, 65535 = none, little-endian, base64),
                     55 rates (x 10000), interval averages (mm x 10), counties
  y/<row>_<blk>.json the years after that, as far as RMA has published them
  The g files change once a year. The y files change when an interval is final.

USAGE
  python scripts/fetch_prf.py --selftest
  python scripts/fetch_prf.py                 # refresh: ADM again, open years only
  python scripts/fetch_prf.py --full          # every grid's whole history
  python scripts/fetch_prf.py --limit 40      # a trial: the first 40 grids only,
                                              #   written to data/prf-trial/
"""

import argparse
import base64
import collections
import concurrent.futures
import io
import json
import os
import struct
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone

UA = "AGSIST-automation/1.0 (+https://agsist.com/prf)"
ADM_BASE = "https://pubfs-rma.fpac.usda.gov/pub/References/actuarial_data_master/"
API = "https://public-rma.fpac.usda.gov/apps/PrfWebApi/"
OUT = "data/prf"
V = 1

COMMODITY, PLAN = "0088", "13"
CODES = ["625", "626", "627", "628", "629", "630", "631", "632", "633", "634", "635"]
COVS = ["0.70", "0.75", "0.80", "0.85", "0.90"]
# intended use, irrigation practice, organic practice. Order is the file format.
COMBOS = [("007", "997", "997"),                      # grazing
          ("030", "002", "997"), ("030", "002", "001"), ("030", "002", "002"),   # haying, irrigated
          ("030", "003", "997"), ("030", "003", "001"), ("030", "003", "002")]   # haying, non-irrigated
COMBO_NAMES = ["Grazing", "Haying, irrigated", "Haying, irrigated, certified organic",
               "Haying, irrigated, transitional organic", "Haying, non-irrigated",
               "Haying, non-irrigated, certified organic", "Haying, non-irrigated, transitional organic"]
MISSING = 65535
COLS, ROWS, BLOCK = 300, 120, 20
FIRST_YEAR = 1951
WORKERS = 8
MAX_FAIL_SHARE = 0.02



def census_name(st, co, rma_name):
    """RMA writes "Mclean"; the page shows the Census spelling by FIPS (Oct 17, 2026)."""
    if not rma_name:
        return rma_name
    try:
        from fetch_cash_rent import county_name
    except ImportError:
        return rma_name
    return county_name(f"{st}{co}", rma_name)

def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- small helpers

def shard_key(grid):
    row, col = (grid - 1) // COLS, (grid - 1) % COLS
    return f"{row}_{col // BLOCK}"


def is_conus_grid(code):
    return code.isdigit() and 1 <= int(code) <= COLS * ROWS


def pack16(values):
    return base64.b64encode(struct.pack("<%dH" % len(values), *values)).decode("ascii")


def unpack16(b64):
    raw = base64.b64decode(b64)
    return list(struct.unpack("<%dH" % (len(raw) // 2), raw))


def dump(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def write_if_changed(path, text):
    try:
        with open(path, encoding="utf-8") as f:
            if f.read() == text:
                return False
    except FileNotFoundError:
        pass
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return True


def ymd(s):
    s = (s or "").strip()
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 and s.isdigit() else None


# ---------------------------------------------------------------- the ADM

class Table:
    """One member of the ADM zip, streamed. Rows whose Deleted Date is set are
    skipped; rows whose field count differs from the header stop the run."""

    def __init__(self, z, code):
        self.code = code
        name = next((n for n in z.namelist() if f"_{code}_" in n), None)
        if name is None:
            raise RuntimeError(f"ADM zip has no member for {code}")
        self.f = z.open(name)
        self.rd = io.TextIOWrapper(self.f, encoding="latin-1", newline="")
        self.header = [c.strip() for c in self.rd.readline().rstrip("\r\n").split("|")]
        self.n = len(self.header)
        self.deleted = 0
        self.rows = 0
        self._del = self.header.index("Deleted Date") if "Deleted Date" in self.header else None

    def col(self, name):
        if name not in self.header:
            raise RuntimeError(f"{self.code} has no column {name!r}; header is {self.header}")
        return self.header.index(name)

    def __iter__(self):
        d = self._del
        for line in self.rd:
            r = line.rstrip("\r\n").split("|")
            if len(r) != self.n:
                raise RuntimeError(f"{self.code}: a row has {len(r)} fields, the header has {self.n}: {line[:300]!r}")
            if d is not None and r[d].strip():
                self.deleted += 1
                continue
            self.rows += 1
            yield r

    def close(self):
        self.rd.close()


def read_adm(path):
    z = zipfile.ZipFile(path)
    adm = {"checks": {}, "deleted": {}}

    t = Table(z, "A00480")
    ic, iname = t.col("Interval Code"), t.col("Interval Name")
    adm["intervals"] = {r[ic]: r[iname].strip() for r in t if r[ic] in CODES}
    if sorted(adm["intervals"]) != CODES:
        raise RuntimeError(f"interval table lacks some of {CODES}: has {sorted(adm['intervals'])}")

    t = Table(z, "A00070")
    pc, cl, ct, sp = t.col("Insurance Plan Code"), t.col("Coverage Level Percent"), t.col("Coverage Type Code"), t.col("Subsidy Percent")
    yr = t.col("Reinsurance Year")
    sub, crop_year = {}, None
    for r in t:
        crop_year = crop_year or int(r[yr])
        if r[pc] == PLAN and r[ct] == "A" and r[cl] in COVS:
            if r[cl] in sub and sub[r[cl]] != float(r[sp]):
                raise RuntimeError(f"two subsidy rates for plan 13 at {r[cl]}: {sub[r[cl]]} and {r[sp]}")
            sub[r[cl]] = float(r[sp])
    if sorted(sub) != COVS:
        raise RuntimeError(f"subsidy rows for plan 13 cover {sorted(sub)}, wanted {COVS}")
    adm["subsidy"] = {str(int(round(float(k) * 100))): v for k, v in sub.items()}
    adm["crop_year"] = crop_year

    t = Table(z, "A00520")
    a, b, c = t.col("State Code"), t.col("State Name"), t.col("State Abbreviation")
    states = {r[a]: (r[c].strip(), r[b].strip()) for r in t}
    t = Table(z, "A00440")
    a, b, c = t.col("State Code"), t.col("County Code"), t.col("County Name")
    cnames = {(r[a], r[b]): r[c].strip() for r in t}

    # offers
    t = Table(z, "A00030")
    ci = {k: t.col(k) for k in ("ADM Insurance Offer ID", "Commodity Code", "Insurance Plan Code", "State Code",
                                "County Code", "Intended Use Code", "Irrigation Practice Code",
                                "Organic Practice Code", "Interval Code")}
    combo_ix = {c: i for i, c in enumerate(COMBOS)}
    code_ix = {c: i for i, c in enumerate(CODES)}
    offers, odd = {}, collections.Counter()
    for r in t:
        if r[ci["Commodity Code"]] != COMMODITY:
            continue
        if r[ci["Insurance Plan Code"]] != PLAN:
            odd["plan " + r[ci["Insurance Plan Code"]]] += 1
            continue
        combo = (r[ci["Intended Use Code"]], r[ci["Irrigation Practice Code"]], r[ci["Organic Practice Code"]])
        iv = r[ci["Interval Code"]]
        if combo not in combo_ix or iv not in code_ix:
            odd[f"use/practice {combo} interval {iv}"] += 1
            continue
        offers[r[ci["ADM Insurance Offer ID"]]] = (r[ci["State Code"]], r[ci["County Code"]], combo_ix[combo], code_ix[iv])
    adm["deleted"]["A00030"] = t.deleted
    if odd:
        raise RuntimeError(f"PRF offers this build does not understand: {dict(odd.most_common(8))}")
    if not offers:
        raise RuntimeError("no PRF offers in A00030")
    log(f"  offers: {len(offers)}")

    # dates: one set for the whole country, or the run stops
    t = Table(z, "A00200")
    cc = t.col("Commodity Code")
    names = ["Sales Closing Date", "Acreage Reporting Date", "Premium Billing Date", "Contract Change Date",
             "Cancellation Date", "End Of Insurance Date"]
    dx = [t.col(n) for n in names]
    dates = collections.Counter()
    for r in t:
        if r[cc] == COMMODITY:
            dates[tuple(r[i] for i in dx)] += 1
    if len(dates) != 1:
        raise RuntimeError(f"PRF has more than one set of dates; the page prints one: {dates.most_common(5)}")
    (dt, _), = dates.items()
    adm["dates"] = {n.replace(" Date", "").replace(" ", "_").lower(): ymd(v) for n, v in zip(names, dt)}

    # Price: county base value, limits, which grids sit in which county
    t = Table(z, "A00810")
    ci = {k: t.col(k) for k in ("ADM Insurance Offer ID", "Commodity Code", "Sub County Code", "County Base Value",
                                "Minimum Acre Percent", "Maximum Acre Percent", "Expected Index Value")}
    county = {}
    grid_counties = collections.defaultdict(set)
    hawaii_grids, hawaii_rows, orphan = set(), 0, 0
    for r in t:
        if r[ci["Commodity Code"]] != COMMODITY:
            continue
        o = offers.get(r[ci["ADM Insurance Offer ID"]])
        if o is None:
            orphan += 1
            continue
        g = r[ci["Sub County Code"]].strip()
        if not is_conus_grid(g):
            hawaii_grids.add(g)
            hawaii_rows += 1
            continue
        if r[ci["Expected Index Value"]].strip() not in ("1.0000", "1", "1.0"):
            raise RuntimeError(f"expected index is not 1 for offer {r[ci['ADM Insurance Offer ID']]} grid {g}: "
                               f"{r[ci['Expected Index Value']]!r}; the trigger arithmetic assumes 1")
        g = int(g)
        st, co, combo, iv = o
        rec = county.get((st, co))
        if rec is None:
            rec = county[(st, co)] = {"grids": set(), "cbv": collections.defaultdict(collections.Counter),
                                      "cbv_g": {}, "lim": collections.defaultdict(collections.Counter),
                                      "lim_g": {}}
        rec["grids"].add(g)
        grid_counties[g].add(st + co)
        cbv = r[ci["County Base Value"]].strip()
        rec["cbv"][combo][cbv] += 1
        rec["cbv_g"][(combo, g)] = cbv
        lim = (r[ci["Minimum Acre Percent"]].strip(), r[ci["Maximum Acre Percent"]].strip())
        rec["lim"][(combo, iv)][lim] += 1
        rec["lim_g"][(combo, iv, g)] = lim
    adm["deleted"]["A00810"] = t.deleted
    adm["hawaii"] = {"grids": len(hawaii_grids), "rows": hawaii_rows}
    adm["checks"]["price_rows_without_an_offer"] = orphan
    log(f"  counties: {len(county)}  grids: {len(grid_counties)}  (Hawaii left out: {len(hawaii_grids)} grids)")

    lim_vary = [(k, kk, dict(v)) for k, rec in county.items() for kk, v in rec["lim"].items() if len(v) > 1]
    if lim_vary:
        raise RuntimeError("minimum/maximum acre percent differs between grids of one county, which the "
                           f"state files cannot hold: {len(lim_vary)} cases, e.g. {lim_vary[:3]}")
    adm["checks"]["county_use_practice_with_two_base_values"] = sum(
        1 for rec in county.values() for v in rec["cbv"].values() if len(v) > 1)

    # rate ids, then rates
    t = Table(z, "A01130")
    oi, gi, cl, ct, ri = (t.col("ADM Insurance Offer ID"), t.col("Sub County Code"), t.col("Coverage Level Percent"),
                          t.col("Coverage Type Code"), t.col("Area Rate ID"))
    cov_ix = {c: i for i, c in enumerate(COVS)}
    rate_id = {}                 # (grid, cov index * 11 + interval index) -> rate id
    extra_ids = collections.defaultdict(set)
    seen = 0
    for r in t:
        o = offers.get(r[oi])
        if o is None:
            continue
        g = r[gi].strip()
        if not is_conus_grid(g):
            continue
        c = cov_ix.get(r[cl].strip())
        if c is None or r[ct] != "A":
            continue
        seen += 1
        key = (int(g), c * 11 + o[3])
        rid = r[ri]
        prev = rate_id.get(key)
        if prev is None:
            rate_id[key] = rid
        elif prev != rid:
            extra_ids[key].add(rid)
    adm["deleted"]["A01130"] = t.deleted
    need = set(rate_id.values())
    for s in extra_ids.values():
        need |= s
    log(f"  rate keys: {len(rate_id)} from {seen} rows; keys with more than one rate id: {len(extra_ids)}")

    t = Table(z, "A01135")
    ri, br = t.col("Area Rate ID"), t.col("Base Rate")
    rate = {}
    for r in t:
        if r[ri] in need:
            rate[r[ri]] = r[br].strip()
    missing_ids = len(need) - len(rate)
    if missing_ids:
        raise RuntimeError(f"{missing_ids} area rate ids named by A01130 are absent from A01135")
    two = [(k, sorted({rate[rate_id[k]]} | {rate[x] for x in ids})) for k, ids in extra_ids.items()
           if len({rate[rate_id[k]]} | {rate[x] for x in ids}) > 1]
    if two:
        raise RuntimeError("the premium rate depends on more than grid, interval and coverage level: "
                           f"{len(two)} keys carry two rates, e.g. {two[:3]}")
    adm["checks"]["rate_keys"] = len(rate_id)
    adm["checks"]["rate_keys_with_two_rates"] = 0

    rates = {}
    for g in grid_counties:
        arr = []
        for k in range(55):
            rid = rate_id.get((g, k))
            if rid is None:
                arr.append(MISSING)
                continue
            v = float(rate[rid])
            q = int(round(v * 10000))
            if abs(q / 10000 - v) > 1e-9 or not (0 < q < MISSING):
                raise RuntimeError(f"rate {rate[rid]!r} for grid {g} does not fit four decimal places")
            arr.append(q)
        rates[g] = arr
    adm["checks"]["grids_missing_any_rate"] = sum(1 for a in rates.values() if MISSING in a)

    adm["states"] = states
    adm["cnames"] = cnames
    adm["county"] = county
    adm["grid_counties"] = {g: sorted(s) for g, s in grid_counties.items()}
    adm["rates"] = rates
    adm["offers"] = len(offers)
    z.close()
    return adm


def state_files(adm):
    """{postal: text} and the list for meta."""
    def pct(s):
        v = float(s) * 100
        q = int(round(v))
        if abs(q - v) > 1e-6:
            raise RuntimeError(f"acre percent {s!r} is not a whole percent")
        return q

    by_state = collections.defaultdict(dict)
    for (st, co), rec in adm["county"].items():
        if st not in adm["states"]:
            raise RuntimeError(f"state code {st} has PRF offers and no row in the state table")
        b, bg = [], {}
        for i in range(len(COMBOS)):
            cnt = rec["cbv"].get(i)
            if not cnt:
                b.append(None)
                continue
            top = cnt.most_common(1)[0][0]
            b.append(float(top))
            if len(cnt) > 1:
                for (ci_, g), v in rec["cbv_g"].items():
                    if ci_ == i and v != top:
                        bg.setdefault(str(g), {})[str(i)] = float(v)
        # limits: one pair per interval if every use and practice agrees
        per_combo = {}
        for i in range(len(COMBOS)):
            row = []
            for k in range(11):
                cnt = rec["lim"].get((i, k))
                row.append([pct(x) for x in cnt.most_common(1)[0][0]] if cnt else None)
            if any(x is not None for x in row):
                per_combo[i] = row
        present = sorted(per_combo)
        uniform = all(per_combo[i] == per_combo[present[0]] for i in present)
        out = {"n": census_name(st, co, adm["cnames"].get((st, co), "")), "g": sorted(rec["grids"]), "b": b}
        if not out["n"]:
            raise RuntimeError(f"county {st}{co} has PRF offers and no name in the county table")
        if uniform:
            out["lim"] = per_combo[present[0]]
        else:
            out["limc"] = {str(i): per_combo[i] for i in present}
        if bg:
            out["bg"] = bg
        by_state[st][co] = out
    files, listing = {}, []
    for st, counties in sorted(by_state.items()):
        abbr, name = adm["states"][st]
        files[abbr] = dump({"v": V, "fips": st, "st": abbr, "name": name, "combos": COMBO_NAMES, "counties": counties})
        listing.append({"fips": st, "st": abbr, "name": name, "counties": len(counties)})
    return files, sorted(listing, key=lambda s: s["name"])


# ---------------------------------------------------------------- the index history

def http_json(url, timeout=120, tries=4):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:      # timeout, reset, 5xx, bad JSON: all "did not answer"
            last = e
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"{url}: {type(last).__name__}: {last}")


def index_url(grid, y0, y1):
    return API + "PrfExternalIndexes/GetIndexValues?" + urllib.parse.urlencode(
        {"intervalType": "BiMonthly", "sampleYearMinimum": y0, "sampleYearMaximum": y1, "gridId": grid})


def parse_index(doc, grid):
    """-> ({year: [11 ints or None]}, [11 avg mm x10 or None], Counter of (year, filing status))."""
    rows = doc.get("HistoricalIndexRows")
    if not isinstance(rows, list):
        raise RuntimeError(f"grid {grid}: no HistoricalIndexRows in {str(doc)[:200]}")
    years, status = {}, collections.Counter()
    avgs = [collections.Counter() for _ in range(11)]
    for row in rows:
        vals = [None] * 11
        cols = row.get("HistoricalIndexDataColumns") or []
        for c in cols:
            code = c.get("IntervalCode")
            if code not in CODES:
                raise RuntimeError(f"grid {grid}: unknown interval code {code!r}")
            i = CODES.index(code)
            p = c.get("PercentOfNormal")
            if p is None:
                continue
            q = int(round(p * 1000))
            if abs(q / 1000 - p) > 1e-9:
                raise RuntimeError(f"grid {grid} {row.get('Year')} {code}: index {p!r} has more than three places")
            if not (0 <= q < MISSING):
                raise RuntimeError(f"grid {grid} {row.get('Year')} {code}: index {p!r} does not fit")
            vals[i] = q
            status[(int(row["Year"]), c.get("FilingStatusId"))] += 1
            a = c.get("AverageIntervalMeasurement")
            if a is not None:
                avgs[i][int(round(a * 10))] += 1
        if any(v is not None for v in vals):
            years[int(row["Year"])] = vals
    # THE AVERAGE IS NOT ONE NUMBER PER INTERVAL. Measured on the first trial
    # run, 2026-10-12: every year from 1951 to 2025 carries the crop year's own
    # baseline (grid 30152, Jan-Feb: 45.1245 mm, the mean of those 75 years)
    # and the open year 2026 carries a different one (45.4104). The index is
    # what the policy pays on and is kept year by year exactly as published;
    # the average kept here is the one most of the years share, for display.
    avg = [(cnt.most_common(1)[0][0] if cnt else None) for cnt in avgs]
    return years, avg, status


def fetch_all(grids, y0, y1, fetch=None, workers=WORKERS):
    """{grid: (years, avg, status)} and the list of grids that did not answer."""
    fetch = fetch or (lambda g: http_json(index_url(g, y0, y1)))
    got, failed = {}, []
    t0 = time.time()

    def one(g):
        return g, parse_index(fetch(g), g)

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(one, g): g for g in grids}
        for n, fut in enumerate(concurrent.futures.as_completed(futs), 1):
            g = futs[fut]
            try:
                _, res = fut.result()
                got[g] = res
            except Exception as e:
                failed.append(g)
                if len(failed) <= 10:
                    log(f"  grid {g}: {e}")
            if n % 1000 == 0:
                log(f"  {n} of {len(grids)} grids, {len(failed)} failed, {time.time() - t0:.0f}s")
            if n == 200 and len(failed) > 100:
                for f2 in futs:
                    f2.cancel()
                raise RuntimeError(f"{len(failed)} of the first 200 grids did not answer or could not be read; stopping")
    return got, sorted(failed)


# ---------------------------------------------------------------- build

def load_shards(out, kind):
    """{key: parsed json} for g or y."""
    d, res = os.path.join(out, kind), {}
    if os.path.isdir(d):
        for name in os.listdir(d):
            if name.endswith(".json"):
                with open(os.path.join(d, name), encoding="utf-8") as f:
                    res[name[:-5]] = json.load(f)
    return res


def last_complete_year(years):
    done = [y for y, vals in years.items() if all(v is not None for v in vals)]
    return max(done) if done else None


def build(adm, out, full, fetch=None, limit=None, now_year=None, workers=WORKERS):
    now_year = now_year or datetime.now(timezone.utc).year
    grids = sorted(adm["rates"])
    if limit:
        grids = grids[:limit]
    old_meta = None
    try:
        with open(os.path.join(out, "meta.json"), encoding="utf-8") as f:
            old_meta = json.load(f)
    except (FileNotFoundError, ValueError):
        pass
    old_g = load_shards(out, "g")
    old_hist = {}
    for doc in old_g.values():
        for gid, rec in doc.get("g", {}).items():
            old_hist[int(gid)] = (doc["y0"], doc["y1"], rec)

    why_full = None
    if full:
        why_full = "asked for"
    elif not old_meta or old_meta.get("v") != V:
        why_full = "no earlier build"
    elif old_meta.get("crop_year") != adm["crop_year"]:
        why_full = f"crop year moved from {old_meta.get('crop_year')} to {adm['crop_year']}"
    elif any(g not in old_hist for g in grids):
        why_full = None     # only the new grids get a whole history, below

    status, status_open = collections.Counter(), collections.Counter()
    hist, avgs = {}, {}
    if why_full:
        log(f"index history: every year for {len(grids)} grids ({why_full})")
        got, failed = fetch_all(grids, FIRST_YEAR, now_year, fetch, workers)
        if len(failed) > MAX_FAIL_SHARE * len(grids):
            raise RuntimeError(f"{len(failed)} of {len(grids)} grids did not answer; nothing written")
        lasts = collections.Counter(last_complete_year(v[0]) for v in got.values())
        y1 = lasts.most_common(1)[0][0]
        if y1 is None or lasts[y1] < 0.99 * len(got):
            raise RuntimeError(f"grids disagree on the last complete year: {lasts.most_common(4)}")
        y0 = min(min(v[0]) for v in got.values() if v[0])
        open_years = {}
        for g, (years, avg, st) in got.items():
            for (yy, sid), k in st.items():
                (status_open if yy > y1 else status)[str(sid)] += k
            flat = []
            for y in range(y0, y1 + 1):
                vals = years.get(y) or [None] * 11
                flat.extend(MISSING if v is None else v for v in vals)
            hist[g] = pack16(flat)
            avgs[g] = avg
            open_years[g] = {str(y): vals for y, vals in years.items() if y > y1}
        for g in failed:        # keep what an earlier build had, if it lines up
            o = old_hist.get(g)
            if o and o[0] == y0 and o[1] == y1:
                hist[g], avgs[g] = o[2]["h"], o[2].get("a")
    else:
        y0, y1 = old_meta["years"]["first"], old_meta["years"]["last_complete"]
        new = [g for g in grids if g not in old_hist]
        log(f"index history: {y1 + 1} to {now_year} for {len(grids)} grids; whole history for {len(new)} new ones")
        got, failed = fetch_all([g for g in grids if g in old_hist], y1 + 1, now_year, fetch, workers)
        got_new, failed_new = fetch_all(new, FIRST_YEAR, now_year, fetch, workers) if new else ({}, [])
        if len(failed) + len(failed_new) > MAX_FAIL_SHARE * len(grids):
            raise RuntimeError(f"{len(failed) + len(failed_new)} of {len(grids)} grids did not answer; nothing written")
        failed = sorted(failed + failed_new)
        open_years = {}
        # the history was not asked for again, so its filing-status count is the last full build's
        for sid, k in (old_meta.get("checks", {}).get("filing_status") or {}).items():
            status[str(sid)] += k
        for g in grids:
            if g in old_hist:
                hist[g], avgs[g] = old_hist[g][2]["h"], old_hist[g][2].get("a")
            if g in got:
                for (yy, sid), k in got[g][2].items():
                    if yy > y1:
                        status_open[str(sid)] += k
                open_years[g] = {str(y): vals for y, vals in got[g][0].items() if y > y1}
            elif g in got_new:
                years, avg, st = got_new[g]
                for (yy, sid), k in st.items():
                    (status_open if yy > y1 else status)[str(sid)] += k
                flat = []
                for y in range(y0, y1 + 1):
                    vals = years.get(y) or [None] * 11
                    flat.extend(MISSING if v is None else v for v in vals)
                hist[g], avgs[g] = pack16(flat), avg
                open_years[g] = {str(y): vals for y, vals in years.items() if y > y1}

    # a grid whose open years did not answer keeps the earlier y record
    old_y = load_shards(out, "y")
    for doc in old_y.values():
        for gid, rec in doc.get("g", {}).items():
            if int(gid) not in open_years and int(gid) in failed:
                open_years[int(gid)] = rec

    # A FINAL INDEX DOES NOT UN-PUBLISH. RMA's service answered 200 with empty
    # rows on a bad day in testing, and the old code then wrote every open year
    # away and committed it (audit 2026-10-12). Within one crop year a value
    # already published is kept when the new answer has none for it.
    same_year = bool(old_meta) and old_meta.get("crop_year") == adm["crop_year"] and not limit
    kept_values = 0
    if same_year:
        for doc in old_y.values():
            for gid, rec in doc.get("g", {}).items():
                g = int(gid)
                if g not in grids:
                    continue
                cur = open_years.setdefault(g, {})
                for y, vals in rec.items():
                    new = cur.get(y)
                    if new is None:
                        cur[y] = list(vals)
                        kept_values += sum(v is not None for v in vals)
                        continue
                    for i, v in enumerate(vals):
                        if v is not None and new[i] is None:
                            new[i] = v
                            kept_values += 1
        if kept_values:
            log(f"kept {kept_values} published open-year values the service did not return this run")

    g_docs, y_docs = collections.defaultdict(dict), collections.defaultdict(dict)
    no_history = []
    for g in grids:
        if g not in hist:
            no_history.append(g)
            continue
        key = shard_key(g)
        g_docs[key][str(g)] = {"c": adm["grid_counties"][g], "h": hist[g], "r": pack16(adm["rates"][g]),
                               "a": avgs.get(g) or [None] * 11}
        if open_years.get(g):
            y_docs[key][str(g)] = open_years[g]

    changed = collections.Counter()
    keep = {"g": set(), "y": set(), "s": set()}
    for key, recs in g_docs.items():
        keep["g"].add(key + ".json")
        changed["g"] += write_if_changed(os.path.join(out, "g", key + ".json"),
                                         dump({"v": V, "cy": adm["crop_year"], "y0": y0, "y1": y1, "g": recs}))
    for key, recs in y_docs.items():
        keep["y"].add(key + ".json")
        changed["y"] += write_if_changed(os.path.join(out, "y", key + ".json"), dump({"v": V, "g": recs}))
    sfiles, listing = state_files(adm)
    for abbr, text in sfiles.items():
        keep["s"].add(abbr + ".json")
        changed["s"] += write_if_changed(os.path.join(out, "s", abbr + ".json"), text)
    if not limit:
        for kind, names in keep.items():        # a shard nothing points at any more is removed
            d = os.path.join(out, kind)
            if os.path.isdir(d):
                for name in os.listdir(d):
                    if name.endswith(".json") and name not in names:
                        os.remove(os.path.join(d, name))
                        changed["removed"] += 1

    # how far each open year has got: grids with a value, per interval
    progress = {}
    for rec in open_years.values():
        for y, vals in rec.items():
            p = progress.setdefault(y, [0] * 11)
            for i, v in enumerate(vals):
                if v is not None:
                    p[i] += 1
    built = len(grids) - len(no_history)
    # FEWER THAN LAST TIME STOPS THE RUN. Within one crop year the grids, the
    # counties and the open-year values only grow; a drop means USDA or the
    # service gave a partial answer, and the site keeps what it had.
    if same_year:
        oc = old_meta.get("counts", {})
        drops = []
        if built < oc.get("grids", 0):
            drops.append(f"grids {oc.get('grids')} -> {built}")
        if len(adm["county"]) < oc.get("counties", 0):
            drops.append(f"counties {oc.get('counties')} -> {len(adm['county'])}")
        for y, p_old in (old_meta.get("years", {}).get("open") or {}).items():
            p_new = progress.get(y, [0] * 11)
            for i, (a_, b_) in enumerate(zip(p_old, p_new)):
                if b_ < a_:
                    drops.append(f"{y} interval {CODES[i]} values {a_} -> {b_}")
        if drops:
            raise RuntimeError("smaller than the committed build, nothing should be written: " + "; ".join(drops[:6]))
    meta = {
        "v": V, "crop_year": adm["crop_year"],
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "years": {"first": y0, "last_complete": y1, "open": {y: p for y, p in sorted(progress.items())}},
        "intervals": [{"code": c, "name": adm["intervals"][c]} for c in CODES],
        "coverage": [int(round(float(c) * 100)) for c in COVS],
        "combos": COMBO_NAMES,
        "subsidy": adm["subsidy"], "dates": adm["dates"], "states": listing,
        "counts": {"grids": built, "counties": len(adm["county"]), "states": len(listing),
                   "offers": adm["offers"], "grids_without_history": len(no_history),
                   "grids_not_answering_this_run": len(failed),
                   "hawaii_grids_left_out": adm["hawaii"]["grids"]},
        "checks": dict(adm["checks"], rows_deleted_in_adm=adm["deleted"],
                       filing_status={str(k): v for k, v in sorted(status.items(), key=lambda kv: str(kv[0]))},
                       filing_status_open_years={str(k): v for k, v in sorted(status_open.items(), key=lambda kv: str(kv[0]))}),
        "sources": {"adm": f"{ADM_BASE}{adm['crop_year']}/{adm['crop_year']}_ADM_YTD.zip",
                    "adm_last_modified": adm.get("last_modified"),
                    "index": API + "PrfExternalIndexes/GetIndexValues"},
        "trial": bool(limit),
    }
    if old_meta and changed["g"] == 0 and changed["y"] == 0 and changed["s"] == 0 and not changed["removed"]:
        same = dict(meta, built=old_meta.get("built"))
        if same == old_meta:
            log("nothing changed; meta.json left as it was")
            return old_meta, changed
    write_if_changed(os.path.join(out, "meta.json"), dump(meta))
    log(f"written: g {changed['g']}, y {changed['y']}, s {changed['s']}, removed {changed['removed']}; "
        f"{built} grids, last complete year {y1}, open {sorted(progress)}")
    return meta, changed


def download_adm(year, dest):
    url = f"{ADM_BASE}{year}/{year}_ADM_YTD.zip"
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            t0 = time.time()
            with urllib.request.urlopen(req, timeout=180) as r, open(dest, "wb") as f:
                lm = r.headers.get("Last-Modified")
                n = 0
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
                    n += len(chunk)
            log(f"  {url}: {n / 1048576:.0f} MB in {time.time() - t0:.0f}s, last modified {lm}")
            return lm
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            last = e
        except Exception as e:
            last = e
        time.sleep(20)
    raise RuntimeError(f"{url}: {type(last).__name__}: {last}")


# ---------------------------------------------------------------- selftest

def _fixture():
    """RMA's real rows and history for grid 30152 (test/fixtures/prf/rma-30152.json),
    dressed as a two-county ADM and an index service. Returns
    (fixture, tables, make_zip, api_doc, real offer ids, the Dunn grazing rates)."""
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "..", "test", "fixtures", "prf", "rma-30152.json"), encoding="utf-8") as f:
        fx = json.load(f)
    H = fx["adm_rows_header"]
    col = {n: i for i, n in enumerate(H)}
    T = {
        "A00480": ("Record Type Code|Interval Code|Interval Name|Deleted Date",
                   [f"A00480|{c}|N{c}|" for c in CODES] + ["A00480|636|DEC - JAN|"]),
        "A00070": ("Record Type Code|Reinsurance Year|Insurance Plan Code|Coverage Level Percent|Coverage Type Code|Subsidy Percent|Deleted Date",
                   ["A|2027|13|0.70|A|0.590|", "A|2027|13|0.75|A|0.590|", "A|2027|13|0.80|A|0.550|",
                    "A|2027|13|0.85|A|0.550|", "A|2027|13|0.90|A|0.510|", "A|2027|13|0.65|C|1.000|",
                    "A|2027|01|0.90|A|0.380|", "A|2027|13|0.90|A|0.999|20260901"]),
        "A00520": ("Record Type Code|State Code|State Name|State Abbreviation|Deleted Date",
                   ["A|55|Wisconsin|WI|", "A|15|Hawaii|HI|"]),
        "A00440": ("Record Type Code|State Code|County Code|County Name|Deleted Date",
                   ["A|55|005|Barron|", "A|55|033|Dunn|", "A|15|001|Hawaii|"]),
        "A00030": ("Record Type Code|ADM Insurance Offer ID|Commodity Code|Insurance Plan Code|State Code|County Code|Intended Use Code|Irrigation Practice Code|Organic Practice Code|Interval Code|Deleted Date", []),
        "A00200": ("Record Type Code|Commodity Code|Sales Closing Date|Acreage Reporting Date|Premium Billing Date|Contract Change Date|Cancellation Date|End Of Insurance Date|Deleted Date", []),
        "A00810": ("Record Type Code|ADM Insurance Offer ID|Commodity Code|Sub County Code|County Base Value|Minimum Acre Percent|Maximum Acre Percent|Expected Index Value|Deleted Date", []),
        "A01130": ("Record Type Code|ADM Insurance Offer ID|Sub County Code|Coverage Level Percent|Coverage Type Code|Area Rate ID|Deleted Date", []),
        "A01135": ("Record Type Code|Area Rate ID|Base Rate|Deleted Date", []),
    }
    seen_offer, rid = set(), 0
    for r in fx["adm_rows"]:
        oid = r[col["offer"]]
        if oid not in seen_offer:
            seen_offer.add(oid)
            T["A00030"][1].append(f"A|{oid}|0088|13|55|005|{r[col['use']]}|{r[col['irr']]}|{r[col['org']]}|{r[col['interval']]}|")
            T["A00200"][1].append("A|0088|20261201|20261201|20270901|20270831|20261201|20271231|")
            T["A00810"][1].append(f"A|{oid}|0088|30152|{r[col['cbv']]}|{r[col['min']]}|{r[col['max']]}|{r[col['expected']]}|")
        rid += 1
        T["A01130"][1].append(f"A|{oid}|30152|{r[col['coverage']]}|A|{rid}|")
        T["A01135"][1].append(f"A|{rid}|{r[col['base_rate']]}|")
    # Dunn County shares the grid: grazing only, Apr-May, a different base value
    T["A00030"][1].extend(["A|D1|0088|13|55|033|007|997|997|628|", "A|X9|0041|01|55|033|997|997|997|997|",
                           "A|HI1|0088|13|15|001|007|997|997|628|", "A|GONE|0088|13|55|033|007|997|997|629|20260901"])
    T["A00200"][1].extend(["A|0088|20261201|20261201|20270901|20270831|20261201|20271231|", "A|0041|20270315||||||"])
    T["A00810"][1].extend(["A|D1|0088|30152|29.10|0.10|0.60|1.0000|", "A|HI1|0088|H0420|50.00|0.10|0.50|1.0000|",
                           "A|D1|0088|30153|29.10|0.10|0.60|1.0000|"])
    g628 = {r[col["coverage"]]: r[col["base_rate"]] for r in fx["adm_rows"]
            if r[col["interval"]] == "628" and (r[col["use"]], r[col["irr"]], r[col["org"]]) == COMBOS[0]}
    for cov in COVS:        # the same rate under a different id: allowed
        rid += 1
        T["A01130"][1].append(f"A|D1|30152|{cov}|A|{rid}|")
        T["A01135"][1].append(f"A|{rid}|{g628[cov]}|")
        rid += 1
        T["A01130"][1].append(f"A|D1|30153|{cov}|A|{rid}|")
        T["A01135"][1].append(f"A|{rid}|0.0500|")

    def make_zip(path, tables):
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            for code, (hdr, rows) in tables.items():
                z.writestr(f"2027_{code}_Name_YTD.txt", hdr + "\n" + "\n".join(rows) + "\n")

    def api_doc(grid, y0, y1, upto=None):
        rows = []
        for y in range(y0, y1 + 1):
            vals = fx["index"].get(str(y)) or [None] * 11
            cols = []
            for i, c in enumerate(CODES):
                v = vals[i]
                if upto and (y, i) > upto:
                    v = None
                cols.append({"Year": y, "IntervalCode": c, "PercentOfNormal": v,
                             "IntervalMeasurement": None if v is None else 1.0,
                             # the open year has its own baseline in RMA's answers
                             "AverageIntervalMeasurement": None if v is None else fx["avg_mm"][i] + (0.3 if y == 2026 else 0),
                             "GridId": grid, "FilingStatusId": 6 if v is not None else 0})
            rows.append({"Year": y, "HistoricalIndexDataColumns": cols})
        return {"HistoricalIndexRows": rows}

    return fx, T, make_zip, api_doc, seen_offer, g628


def selftest():
    """A two-county ADM made by hand around RMA's real rows for grid 30152, and a
    fake index service that answers with RMA's real history for it."""
    fails = []

    def ok(cond, what):
        if not cond:
            fails.append(what)
            log("  FAIL", what)

    fx, T, make_zip, api_doc, seen_offer, g628 = _fixture()
    col = {n: i for i, n in enumerate(fx["adm_rows_header"])}

    with tempfile.TemporaryDirectory() as d:
        zp = os.path.join(d, "adm.zip")
        make_zip(zp, T)
        adm = read_adm(zp)
        ok(adm["crop_year"] == 2027, "crop year")
        ok(adm["subsidy"] == {"70": 0.59, "75": 0.59, "80": 0.55, "85": 0.55, "90": 0.51}, f"subsidy {adm['subsidy']}")
        ok(adm["dates"]["sales_closing"] == "2026-12-01" and adm["dates"]["premium_billing"] == "2027-09-01", f"dates {adm['dates']}")
        ok(adm["offers"] == len(seen_offer) + 2, f"offers {adm['offers']} (deleted and corn rows left out, Hawaii offer kept)")
        ok(adm["hawaii"] == {"grids": 1, "rows": 1}, f"hawaii {adm['hawaii']}")
        ok(sorted(adm["rates"]) == [30152, 30153], f"grids {sorted(adm['rates'])}")
        ok(adm["grid_counties"][30152] == ["55005", "55033"], f"grid counties {adm['grid_counties']}")
        ok(adm["rates"][30152][4 * 11 + 3] == 1119, f"90% Apr-May rate {adm['rates'][30152][4 * 11 + 3]}")
        ok(adm["rates"][30152][0 * 11 + 3] == 455, "70% Apr-May rate")
        ok(adm["rates"][30153][4 * 11 + 3] == 500 and adm["rates"][30153][0] == MISSING, "a grid with one interval")
        ok(adm["checks"]["grids_missing_any_rate"] == 1, "grids missing a rate")
        ok(adm["deleted"]["A00030"] == 1, "deleted offer counted")

        sf, listing = state_files(adm)
        wi = json.loads(sf["WI"])
        ok(list(sf) == ["WI"] and listing == [{"fips": "55", "st": "WI", "name": "Wisconsin", "counties": 2}], f"listing {listing}")
        b = wi["counties"]["005"]
        ok(b["n"] == "Barron" and b["g"] == [30152], "Barron")
        ok(b["b"] == [32.8, 127.0, 127.0, 127.0, 230.0, 275.0, 230.0], f"Barron base values {b['b']}")
        ok(b["lim"][0] == [10, 25] and b["lim"][3] == [10, 70] and len(b["lim"]) == 11, f"Barron limits {b.get('lim')}")
        dn = wi["counties"]["033"]
        ok(dn["b"] == [29.1, None, None, None, None, None, None], f"Dunn base values {dn['b']}")
        ok(dn["lim"][3] == [10, 60] and dn["lim"][0] is None and dn["g"] == [30152, 30153], f"Dunn limits {dn.get('lim')}")

        # full build as of July 2026: June-July final, later intervals not
        out = os.path.join(d, "prf")
        calls = []

        def fetch_a(g):
            calls.append(g)
            if g == 30153:
                raise RuntimeError("did not answer")
            return api_doc(g, 1951, 2026)
        try:
            build(adm, out, full=True, fetch=fetch_a, now_year=2026, workers=2)
            ok(False, "one of two grids not answering must stop a first build")
        except RuntimeError as e:
            ok("did not answer" in str(e) and not os.path.exists(os.path.join(out, "meta.json")), f"stopped clean: {e}")

        meta, ch = build(adm, out, full=True, fetch=lambda g: api_doc(g, 1951, 2026), now_year=2026, workers=2)
        ok(meta["years"] == {"first": 1951, "last_complete": 2025, "open": {"2026": [2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0]}}, f"years {meta['years']}")
        ok(meta["counts"]["grids"] == 2 and meta["counts"]["hawaii_grids_left_out"] == 1, f"counts {meta['counts']}")
        ok(meta["checks"]["filing_status"] == {"6": 2 * 75 * 11} and meta["checks"]["filing_status_open_years"] == {"6": 12},
           f"status {meta['checks']['filing_status']} {meta['checks']['filing_status_open_years']}")
        with open(os.path.join(out, "g", "100_7.json")) as f:
            gdoc = json.load(f)
        rec = gdoc["g"]["30152"]
        h = unpack16(rec["h"])
        ok(gdoc["y0"] == 1951 and gdoc["y1"] == 2025 and len(h) == 75 * 11, "history length")
        ok(h[:3] == [1134, 1749, 1305], f"1951 starts {h[:3]}")
        ok(h[(2023 - 1951) * 11 + 3] == 708 and h[(2023 - 1951) * 11 + 5] == 767, "2023 Apr-May and Jun-Jul")
        ok(unpack16(rec["r"])[4 * 11 + 3] == 1119, "rate through the file")
        ok(rec["a"][3] == 1704 and rec["c"] == ["55005", "55033"], f"average and counties {rec['a'][3]} {rec['c']}")
        with open(os.path.join(out, "y", "100_7.json")) as f:
            ydoc = json.load(f)
        ok(ydoc["g"]["30152"] == {"2026": [917, 741, 1332, 880, 694, 1038, None, None, None, None, None]}, f"open year {ydoc['g']['30152']}")

        # every history value, against the fixture
        bad = 0
        for y in range(1951, 2026):
            for i in range(11):
                want = fx["index"][str(y)][i]
                got = h[(y - 1951) * 11 + i]
                if (want is None and got != MISSING) or (want is not None and got != round(want * 1000)):
                    bad += 1
        ok(bad == 0, f"{bad} history cells differ from RMA's")

        # a refresh with nothing new writes nothing
        before = {p: os.path.getmtime(os.path.join(out, p)) for p in ("meta.json", "g/100_7.json", "y/100_7.json", "s/WI.json")}
        asked = []

        def fetch_b(g):
            asked.append(g)
            return api_doc(g, 2026, 2026)
        time.sleep(0.05)
        meta2, ch2 = build(adm, out, full=False, fetch=fetch_b, now_year=2026, workers=2)
        ok(sorted(asked) == [30152, 30153], f"refresh asked {asked}")
        ok(sum(ch2.values()) == 0 and meta2["built"] == meta["built"], f"refresh changed {dict(ch2)}")
        ok(all(os.path.getmtime(os.path.join(out, p)) == t for p, t in before.items()), "files untouched")

        # the service drops one grid on a later refresh: its open year is kept
        def fetch_c(g):
            if g == 30153:
                raise RuntimeError("did not answer")
            return api_doc(g, 2026, 2026)
        adm_big = dict(adm, rates=dict(adm["rates"]), grid_counties=dict(adm["grid_counties"]))
        for extra in range(30155, 30155 + 60):          # enough grids that one failure is under 2%
            adm_big["rates"][extra] = adm["rates"][30153]
            adm_big["grid_counties"][extra] = ["55033"]
        build(adm_big, out, full=True, fetch=lambda g: api_doc(g, 1951, 2026), now_year=2026, workers=4)
        meta3, ch3 = build(adm_big, out, full=False, fetch=fetch_c, now_year=2026, workers=4)
        with open(os.path.join(out, "y", "100_7.json")) as f:
            ok(json.load(f)["g"].get("30153", {}).get("2026", [None])[0] == 917, "a grid that did not answer keeps its open year")
        ok(meta3["counts"]["grids_not_answering_this_run"] == 1, f"counts {meta3['counts']}")

        # a new crop year forces the whole history again
        adm28 = dict(adm_big, crop_year=2028)
        n = []
        build(adm28, out, full=False, fetch=lambda g: (n.append(g), api_doc(g, 1951, 2027, upto=(2027, 1)))[1], now_year=2027, workers=4)
        with open(os.path.join(out, "g", "100_7.json")) as f:
            g28 = json.load(f)
        with open(os.path.join(out, "y", "100_7.json")) as f:
            y28 = json.load(f)
        ok(len(n) == 62 and g28["cy"] == 2028, f"a new crop year refetches every grid: asked {len(n)}, cy {g28['cy']}")
        ok(g28["y1"] == 2025 and set(y28["g"]["30152"]) == {"2026"}, f"2026 is still open in the fixture: y1 {g28['y1']}, open {sorted(y28['g']['30152'])}")

        # refusals
        def broken(mut, needle):
            t2 = {k: (h_, list(r_)) for k, (h_, r_) in T.items()}
            mut(t2)
            p2 = os.path.join(d, "bad.zip")
            make_zip(p2, t2)
            try:
                read_adm(p2)
                ok(False, f"should have stopped: {needle}")
            except RuntimeError as e:
                ok(needle in str(e), f"stopped for the wrong reason, wanted {needle!r}: {e}")
        broken(lambda t: t["A01135"][1].__setitem__(len(t["A01135"][1]) - 2, t["A01135"][1][-2].replace(g628["0.90"], "0.9999")),
               "depends on more than grid")
        broken(lambda t: t["A00200"][1].append("A|0088|20261115|20261201|20270901|20270831|20261201|20271231|"),
               "more than one set of dates")
        broken(lambda t: t["A00810"][1].append("A|D1|0088|30154|29.10|0.10|0.50|1.0000|"), "differs between grids of one county")
        broken(lambda t: t["A00810"][1].__setitem__(0, t["A00810"][1][0].replace("|1.0000|", "|0.9500|")), "expected index is not 1")
        broken(lambda t: t["A00030"][1].append("A|Z|0088|13|55|033|099|997|997|628|"), "does not understand")
        broken(lambda t: t["A01130"][1].append("A|D1|30152|0.90|A|424242|"), "absent from A01135")
        broken(lambda t: t["A00810"][1].append("A|D1|0088|30155|29.10|0.10|0.60|1.0000"), "fields, the header has")

        try:
            parse_index({"HistoricalIndexRows": [{"Year": 2000, "HistoricalIndexDataColumns": [
                {"IntervalCode": "625", "PercentOfNormal": 0.12345, "AverageIntervalMeasurement": 1.0, "FilingStatusId": 6}]}]}, 1)
            ok(False, "an index with five places should stop")
        except RuntimeError as e:
            ok("three places" in str(e), str(e))

    ok(shard_key(30152) == "100_7" and shard_key(1) == "0_0" and shard_key(36000) == "119_14", "shard keys")
    ok(unpack16(pack16([0, 1, 65535, 1119])) == [0, 1, 65535, 1119], "pack round trip")
    ok(is_conus_grid("30152") and not is_conus_grid("H0420") and not is_conus_grid("36001") and not is_conus_grid("0"), "grid ids")
    log("fetch_prf selftest:", "ok" if not fails else f"{len(fails)} failure(s)")
    return 1 if fails else 0


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--year", type=int, default=0, help="crop year of the ADM (default: newest that exists)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--adm", default="", help="use this zip instead of downloading")
    ap.add_argument("--workers", type=int, default=WORKERS)
    ap.add_argument("--fixture", default="", metavar="DIR",
                    help="write a one-grid build from the saved RMA answers into DIR (page work and tests; never data/prf)")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.fixture:
        if os.path.abspath(a.fixture) == os.path.abspath(OUT):
            raise SystemExit("--fixture must not write into data/prf")
        fx, T, make_zip, api_doc, _, _ = _fixture()
        with tempfile.TemporaryDirectory() as d:
            zp = os.path.join(d, "adm.zip")
            make_zip(zp, T)
            adm = read_adm(zp)
        adm["last_modified"] = "fixture"
        build(adm, a.fixture, full=True, fetch=lambda g: api_doc(g, 1951, 2026), now_year=2026, workers=2)
        return 0
    out = OUT + "-trial" if a.limit else OUT
    path, lm = a.adm, None
    if not path:
        path = os.path.join(tempfile.gettempdir(), "prf_adm.zip")
        now = datetime.now(timezone.utc).year
        # Next year's ADM appears in spring with no PRF in it until the August
        # filing (audit 2026-10-12): take the newest zip that has PRF offers.
        adm = None
        for y in ([a.year] if a.year else [now + 1, now]):
            log(f"ADM for crop year {y}")
            if os.path.exists(path):
                os.remove(path)
            lm = download_adm(y, path)
            if lm is None and not (os.path.exists(path) and os.path.getsize(path) > 1e6):
                continue
            t0 = time.time()
            try:
                adm = read_adm(path)
            except RuntimeError as e:
                if "no PRF offers" in str(e) and not a.year:
                    log(f"  crop year {y}: {e}; trying the year before")
                    continue
                raise
            adm["last_modified"] = lm
            break
        if adm is None:
            raise RuntimeError("no ADM zip with PRF offers found for this year or next")
    else:
        t0 = time.time()
        adm = read_adm(path)
        adm["last_modified"] = lm
    log("reading the ADM")
    log(f"  read in {time.time() - t0:.0f}s: crop year {adm['crop_year']}, checks {adm['checks']}")
    build(adm, out, full=a.full, limit=a.limit or None, workers=a.workers)
    return 0


if __name__ == "__main__":
    sys.exit(main())
