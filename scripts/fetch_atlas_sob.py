#!/usr/bin/env python3
"""
fetch_atlas_sob.py — USDA RMA Summary of Business, county premium and indemnity
-> data/atlas/raw/sob.json

WHY THIS EXISTS
  The cause-of-loss files carry premium only on rows that had a loss, so the
  Atlas withholds the loss ratio. The Summary of Business county file carries
  the whole book: every policy's liability, premium and indemnity by county,
  crop, plan and coverage level, whether it paid or not. Indemnity over THIS
  premium is the county's true loss ratio. Weekly, 1989 onward:
  https://pubfs-rma.fpac.usda.gov/pub/Web_Data_Files/Summary_of_Business/state_county_crop/sobcov_YYYY.zip

LAYOUT (SOB_State_County_Crop_with_Coverage_Level_1989_Forward.pdf, read
2026-09-15): pipe-delimited, 28 fields. The PDF is unclear on a header row,
so a first line whose first field is not a four-digit year is skipped and
reported.
   1 commodity year         10 coverage category      19 net reported quantity
   2 state code (FIPS)      11 delivery type          20 endorsed/companion acres
   3 state abbreviation     12 coverage level         21 liability
   4 county code (FIPS)     13 policies sold          22 total premium
   5 county name            14 policies earning prem  23 subsidy
   6 commodity code         15 policies indemnified   24 state/private subsidy
   7 commodity name         16 units earning premium  25 additional subsidy
   8 insurance plan code    17 units indemnified      26 EFA premium discount
   9 plan abbreviation      18 quantity type          27 indemnity
                                                      28 loss ratio
  Any other field count stops the run and prints the row.

WHAT IS KEPT
  Per county per year: liability, premium, indemnity, policies earning
  premium; all plans except Rainfall/Vegetation Index (13, 14), which are
  summed on their own as prf, the same rule as fetch_atlas_loss.py so the two
  files describe the same book. Corn on its own.

USAGE
  python scripts/fetch_atlas_sob.py --selftest
  python scripts/fetch_atlas_sob.py            # first run 1989..now, later runs the last 4 years merged
  python scripts/fetch_atlas_sob.py --all
"""

import io
import json
import os
import sys
import time
import zipfile
from datetime import datetime, timezone

from atlas_common import get, log
from build_farmland_atlas import ATLAS_STATE_FIPS

BASE = "https://pubfs-rma.fpac.usda.gov/pub/Web_Data_Files/Summary_of_Business/state_county_crop/"
OUT = "data/atlas/raw/sob.json"
FIRST_YEAR = 1989
NFIELDS = 28
INDEX_PLANS = {"13", "14"}
CORN_CODE = "0041"
REFETCH_YEARS = 4
F_YEAR, F_STATE, F_COUNTY, F_COMM, F_PLAN, F_POL, F_LIAB, F_PREM, F_INDEM = 0, 1, 3, 5, 7, 13, 20, 21, 26


def money(s):
    s = (s or "").strip().replace(",", "")
    try:
        return float(s) if s else 0.0
    except ValueError:
        return 0.0


def aggregate(lines, agg=None):
    agg = agg if agg is not None else {}
    n = kept = skipped_header = 0
    for line in lines:
        line = line.rstrip("\r\n")
        if not line:
            continue
        f = line.split("|")
        if len(f) == NFIELDS + 1 and not f[-1].strip():      # a row that ends with its delimiter is still a row
            f.pop()
        if len(f) != NFIELDS:
            raise ValueError(f"expected {NFIELDS} fields, got {len(f)}: {line[:300]}")
        if not f[F_YEAR].strip().isdigit():
            skipped_header += 1
            continue
        n += 1
        st = f[F_STATE].strip().zfill(2)
        if st not in ATLAS_STATE_FIPS:
            continue
        county = f[F_COUNTY].strip().zfill(3)
        if county >= "900":
            continue
        fips = st + county
        year = int(f[F_YEAR].strip())
        liab, prem, indem, pol = money(f[F_LIAB]), money(f[F_PREM]), money(f[F_INDEM]), money(f[F_POL])
        rec = agg.setdefault(fips, {"years": {}, "corn": {}, "prf": {}})
        if f[F_PLAN].strip().zfill(2) in INDEX_PLANS:
            p = rec["prf"].setdefault(year, {"liab": 0.0, "prem": 0.0, "indem": 0.0})
            p["liab"] += liab
            p["prem"] += prem
            p["indem"] += indem
            kept += 1
            continue
        y = rec["years"].setdefault(year, {"liab": 0.0, "prem": 0.0, "indem": 0.0, "policies": 0.0})
        y["liab"] += liab
        y["prem"] += prem
        y["indem"] += indem
        y["policies"] += pol
        if f[F_COMM].strip().zfill(4) == CORN_CODE:
            c = rec["corn"].setdefault(year, {"liab": 0.0, "prem": 0.0, "indem": 0.0})
            c["liab"] += liab
            c["prem"] += prem
            c["indem"] += indem
        kept += 1
    return agg, n, kept, skipped_header


def zip_lines(zbytes):
    with zipfile.ZipFile(io.BytesIO(zbytes)) as z:
        names = [n for n in z.namelist() if not n.endswith("/")]
        if len(names) != 1:
            raise ValueError(f"expected one file in the zip, found {names}")
        with z.open(names[0]) as f:
            for raw in io.TextIOWrapper(f, encoding="latin-1"):
                yield raw


def keep_except(existing, years):
    drop = set(str(y) for y in years)
    agg = {}
    for fips, rec in existing["counties"].items():
        agg[fips] = {k: {int(y): v for y, v in rec.get(k, {}).items() if y not in drop} for k in ("years", "corn", "prf")}
    per_year = {int(y): v for y, v in existing.get("per_year", {}).items() if y not in drop}
    return agg, per_year


def selftest():
    def row(year, st, co, comm, plan, pol, liab, prem, indem):
        f = [""] * NFIELDS
        f[F_YEAR], f[F_STATE], f[F_COUNTY], f[F_COMM], f[F_PLAN] = str(year), st, co, comm, plan
        f[F_POL], f[F_LIAB], f[F_PREM], f[F_INDEM] = str(pol), str(liab), str(prem), str(indem)
        return "|".join(f)
    header = "|".join(["Commodity Year"] + [""] * (NFIELDS - 1))
    lines = [header + "|",
             row(2012, "31", "001", "0041", "02", 300, 10_000_000, 900_000, 2_700_000),
             row(2012, "31", "001", "0081", "02", 200, 5_000_000, 400_000, 100_000),
             row(2012, "31", "001", "0088", "13", 50, 1_000_000, 80_000, 500_000),    # PRF: kept apart
             row(2019, "31", "001", "0041", "02", 310, 12_000_000, 1_000_000, 200_000),
             row(2019, "01", "001", "0041", "02", 1, 1, 1, 1),                        # not an Atlas state
             row(2019, "31", "999", "0041", "02", 1, 1, 1, 1)]                        # not a county
    agg, n, kept, sh = aggregate(lines)
    assert sh == 1 and n == 6 and kept == 4, (n, kept, sh)
    y12 = agg["31001"]["years"][2012]
    assert y12 == {"liab": 15_000_000.0, "prem": 1_300_000.0, "indem": 2_800_000.0, "policies": 500.0}, y12
    assert agg["31001"]["corn"][2012]["indem"] == 2_700_000.0 and agg["31001"]["prf"][2012]["indem"] == 500_000.0
    assert "31999" not in agg and len(agg) == 1
    try:
        aggregate(["|".join([""] * 27)])
        raise AssertionError("27-field row accepted")
    except ValueError as e:
        assert "expected 28" in str(e)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("sobcov_2012.txt", "\n".join(lines[:2]) + "\n")
    a2, n2, _, _ = aggregate(zip_lines(buf.getvalue()))
    assert n2 == 1 and a2["31001"]["years"][2012]["prem"] == 900_000.0
    ex = {"counties": {"31001": {"years": {"2012": {"prem": 1}, "2019": {"prem": 9}}, "corn": {}, "prf": {}}}, "per_year": {"2012": {"rows": 1}, "2019": {"rows": 1}}}
    a3, py = keep_except(ex, [2019])
    assert 2012 in a3["31001"]["years"] and 2019 not in a3["31001"]["years"] and py == {2012: {"rows": 1}}
    log("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    this_year = datetime.now(timezone.utc).year
    existing = None
    if os.path.exists(OUT) and "--all" not in sys.argv:
        with open(OUT, encoding="utf-8") as f:
            existing = json.load(f)
    years = list(range(FIRST_YEAR, this_year + 1)) if existing is None else list(range(this_year - REFETCH_YEARS + 1, this_year + 1))
    if "--years" in sys.argv:
        years = [int(y) for y in sys.argv[sys.argv.index("--years") + 1].split(",")]
    agg, per_year = ({}, {}) if existing is None else keep_except(existing, years)
    if existing is not None:
        log(f"  keeping {len(per_year)} years; refetching {years}")
    for y in years:
        name = f"sobcov_{y}.zip"
        zb = get(BASE + name, proxy_path=f"/{name}")
        if zb is None:
            log(f"  {name}: 404")
            continue
        t0 = time.time()
        agg, n, kept, sh = aggregate(zip_lines(zb), agg)
        per_year[y] = {"rows": n, "atlas_rows": kept, "header_lines": sh, "bytes": len(zb)}
        log(f"  {name}: {n:,} rows, {kept:,} kept, {time.time() - t0:.0f}s")
    if not per_year:
        sys.exit("no rows")
    for rec in agg.values():
        for k in ("years", "corn", "prf"):
            for y, v in rec[k].items():
                for kk in v:
                    v[kk] = round(v[kk], 2)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "USDA RMA Summary of Business, state/county/crop/coverage (sobcov_YYYY.zip)", "url": BASE,
                   "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "first_year": min(per_year), "latest_year": max(per_year), "per_year": per_year,
                   "note": "Rainfall/Vegetation Index plans (13, 14) summed separately as prf; county 999 dropped",
                   "counties": agg}, f, separators=(",", ":"))
    log(f"wrote {OUT}: {len(agg)} counties, {min(per_year)}-{max(per_year)}")


if __name__ == "__main__":
    main()
