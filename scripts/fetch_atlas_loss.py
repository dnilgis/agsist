#!/usr/bin/env python3
"""
fetch_atlas_loss.py — USDA RMA cause of loss, 1989 to now -> data/atlas/raw/loss.json

WHAT THIS IS
  Every federal crop insurance indemnity since 1989, by county, crop and the
  peril that caused it. RMA publishes one zip per commodity year at
  https://pubfs-rma.fpac.usda.gov/pub/Web_Data_Files/Summary_of_Business/cause_of_loss/colsom_YYYY.zip
  Each holds one pipe-delimited text file with no header row. The layout is
  the same for all years (COL_Summary_of_Business_with_Month_All_Years.pdf,
  read 2026-09-13) and has exactly 30 fields:

   1 commodity year        11 stage code             21 liability
   2 state code (FIPS)     12 cause of loss code     22 total premium
   3 state abbreviation    13 cause of loss desc     23 producer paid premium
   4 county code (FIPS)    14 month of loss          24 subsidy
   5 county name           15 month of loss name     25 state/private subsidy
   6 commodity code        16 year of loss           26 additional subsidy
   7 commodity name        17 policies earning prem  27 EFA premium discount
   8 insurance plan code   18 policies indemnified   28 net determined quantity
   9 plan abbreviation     19 net planted quantity   29 indemnity amount
  10 coverage category     20 net endorsed acres     30 loss ratio

  A row with any other field count stops the run and prints the row. Do not
  "fix" that by trimming: the layout changed and the columns must be re-read.

WHAT IS KEPT
  Per Atlas county, per commodity year, per cause GROUP: indemnity, total
  premium, liability. All crops together, and corn on its own. Rows for the
  Rainfall Index and Vegetation Index plans (13, 14: pasture, rangeland,
  forage, apiculture) are excluded from every group and counted on their own
  as prf_indemnity. County code 999 (RMA's "all other") is dropped. The groups:
    heat_drought  Drought, Heat, Hot Wind, Excess Sun
    wet           Excess Moisture/Precip/Rain, Flood, Poor Drainage
    hail          Hail
    wind          Wind/Excess Wind, Tornado, Hurricane/Tropical Depression, Cyclone
    cold          Freeze, Frost, Cold Wet Weather, Cold Winter
    irrigation    Failure of Irrigation Supply, Failure of Irrigation Equipment,
                  Inability to Prepare Land for Irrigation
    price         Decline in Price
    unassigned    "Area Plan Crops Only" / "ARPI/SCO/STAX/MP/HIP WI Crops Only":
                  area and index plans, where RMA assigns no peril
    other         everything else (insects, disease, wildlife, fire, mycotoxin...)
  Every cause description that fell into "other" is printed at the end of the
  run with its dollar total, so a new peril name cannot hide there unseen.

  Premium and liability are on the same row as the loss, so a county-year's
  premium here is the premium of policies THAT HAD A LOSS, not all premium.
  RMA's Summary of Business county files carry total premium; this file does
  not. The builder therefore WITHHOLDS the loss ratio (indemnity over this
  premium would overstate it) until the Summary of Business county premium is
  fetched. Premium is still kept here so that step is a one-line change.

USAGE
  python scripts/fetch_atlas_loss.py --selftest
  python scripts/fetch_atlas_loss.py                    # first run: 1989..now; later runs: the last two years, merged
  python scripts/fetch_atlas_loss.py --all              # force every year again
  python scripts/fetch_atlas_loss.py --years 2020,2024
  python scripts/fetch_atlas_loss.py --dir /path/with/colsom_YYYY.zip   # already downloaded
"""

import io
import json
import os
import sys
import time
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone

from build_farmland_atlas import ATLAS_STATE_FIPS, CAUSE_GROUPS

BASE = "https://pubfs-rma.fpac.usda.gov/pub/Web_Data_Files/Summary_of_Business/cause_of_loss/"
OUT = "data/atlas/raw/loss.json"
UA = "AGSIST-automation/1.0 (+https://agsist.com/farmland-atlas)"
FIRST_YEAR = 1989
NFIELDS = 30
CORN_CODE = "0041"

# field indexes, zero-based, from the layout above
F_YEAR, F_STATE, F_STABBR, F_COUNTY, F_CNAME, F_COMM, F_COMMNAME = 0, 1, 2, 3, 4, 5, 6
F_PLAN, F_CAUSE_DESC, F_LIAB, F_PREM, F_INDEM = 7, 12, 20, 21, 28
# Rainfall Index (13) and Vegetation Index (14): the Pasture, Rangeland, Forage and
# apiculture programs. They pay on a grid rainfall index, not on a destroyed crop,
# and in Plains ranch counties they dwarf crop indemnities since about 2010. Kept
# out of every share and counted separately so the exclusion is visible.
INDEX_PLANS = {"13", "14"}
REFETCH_YEARS = 4     # RMA keeps settling claims for three or four crop years


def log(*a):
    print(*a, flush=True)


def cause_group(desc):
    d = (desc or "").upper()
    # Area and index plans (GRP, GRIP, ARPI, SCO, STAX, MP, HIP-WI) pay on a county
    # or index outcome; RMA assigns them no peril and codes them "... Crops Only".
    # They are a real share of 2012 corn dollars and must not dilute the weather
    # groups as "other", nor be guessed into drought.
    if "CROPS ONLY" in d or "AREA PLAN" in d or "ARPI" in d:
        return "unassigned"
    if "IRRIG" in d:
        return "irrigation"
    if "HOT WIND" in d or "DROUGHT" in d or "HEAT" in d or "EXCESS SUN" in d:
        return "heat_drought"
    if "EXCESS MOISTURE" in d or "PRECIP" in d or "FLOOD" in d or "POOR DRAINAGE" in d or "RAIN" in d:
        return "wet"
    if "HAIL" in d:
        return "hail"
    if "WIND" in d or "TORNADO" in d or "HURRICANE" in d or "CYCLONE" in d or "TROPICAL" in d:
        return "wind"
    if "FREEZE" in d or "FROST" in d or "COLD" in d:
        return "cold"
    if "PRICE" in d:
        return "price"
    return "other"


def money(s):
    s = (s or "").strip()
    if not s:
        return 0.0
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return 0.0


def aggregate(lines, agg=None, others=None):
    """lines: iterable of pipe-delimited rows. agg: {fips: {"name":..., "years": {y: {g: {..}}}, "corn": {...}}}"""
    agg = agg if agg is not None else {}
    others = others if others is not None else defaultdict(float)
    n = 0
    kept = 0
    for line in lines:
        line = line.rstrip("\r\n")
        if not line:
            continue
        f = line.split("|")
        if len(f) != NFIELDS:
            raise ValueError(f"expected {NFIELDS} fields, got {len(f)}: {line[:300]}")
        n += 1
        st = f[F_STATE].strip().zfill(2)
        if st not in ATLAS_STATE_FIPS:
            continue
        county = f[F_COUNTY].strip().zfill(3)
        if county >= "900":          # 999 = "all other / unknown county" in RMA files; not a place
            continue
        fips = st + county
        year = int(f[F_YEAR].strip())
        indem = money(f[F_INDEM])
        prem = money(f[F_PREM])
        liab = money(f[F_LIAB])
        rec = agg.setdefault(fips, {"name": f[F_CNAME].strip().title(), "years": {}, "corn": {}, "prf_indemnity": 0.0})
        if f[F_PLAN].strip().zfill(2) in INDEX_PLANS:
            rec["prf_indemnity"] = rec.get("prf_indemnity", 0.0) + indem
            kept += 1
            continue
        g = cause_group(f[F_CAUSE_DESC])
        if g == "other":
            others[f[F_CAUSE_DESC].strip().upper()] += indem
        y = rec["years"].setdefault(year, {})
        gg = y.setdefault(g, {"indem": 0.0, "prem": 0.0, "liab": 0.0})
        gg["indem"] += indem
        gg["prem"] += prem
        gg["liab"] += liab
        if f[F_COMM].strip().zfill(4) == CORN_CODE:
            cy = rec["corn"].setdefault(year, {})
            cg = cy.setdefault(g, {"indem": 0.0, "prem": 0.0, "liab": 0.0})
            cg["indem"] += indem
            cg["prem"] += prem
            cg["liab"] += liab
        kept += 1
    return agg, others, n, kept


def zip_lines(zbytes):
    with zipfile.ZipFile(io.BytesIO(zbytes)) as z:
        names = [n for n in z.namelist() if not n.endswith("/")]
        if len(names) != 1:
            raise ValueError(f"expected one file in the zip, found {names}")
        with z.open(names[0]) as f:
            for raw in io.TextIOWrapper(f, encoding="latin-1"):
                yield raw


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if attempt == 2:
                raise
            time.sleep(10 * (attempt + 1))
        except Exception:
            if attempt == 2:
                raise
            time.sleep(10 * (attempt + 1))


def keep_except(existing, years):
    """Everything in the existing raw file except the given years, with int keys,
    ready for aggregate() to add the refetched years on top."""
    drop = set(str(y) for y in years)
    agg = {}
    for fips, rec in existing["counties"].items():
        agg[fips] = {"name": rec["name"],
                     "years": {int(y): g for y, g in rec["years"].items() if y not in drop},
                     "corn": {int(y): g for y, g in rec["corn"].items() if y not in drop},
                     # PRF dollars are not kept by year, so a refetch cannot subtract the
                     # dropped years; they are recounted from zero only on --all. Stated
                     # in the output so the figure is not read as exact.
                     "prf_indemnity": rec.get("prf_indemnity", 0.0)}
    per_year = {int(y): v for y, v in existing.get("per_year", {}).items() if y not in drop}
    others = defaultdict(float)
    for k, v in (existing.get("other_causes") or {}).items():
        others[k] += v
    return agg, per_year, others


def round_tree(agg):
    for rec in agg.values():
        for tbl in ("years", "corn"):
            for y, groups in rec[tbl].items():
                for g, v in groups.items():
                    for k in v:
                        v[k] = round(v[k], 2)
    return agg


def selftest():
    def row(year, st, co, comm, cause, liab, prem, indem, cname="ADAMS", stabbr="NE", plan="02"):
        f = [""] * NFIELDS
        f[F_YEAR], f[F_STATE], f[F_STABBR], f[F_COUNTY], f[F_CNAME] = str(year), st, stabbr, co, cname
        f[F_COMM], f[F_COMMNAME], f[F_CAUSE_DESC], f[F_PLAN] = comm, "CORN" if comm == "0041" else "SOYBEANS", cause, plan
        f[F_LIAB], f[F_PREM], f[F_INDEM] = str(liab), str(prem), str(indem)
        return "|".join(f)
    lines = [
        row(2012, "31", "001", "0041", "Drought", 1000000, 100000, 500000),
        row(2012, "31", "001", "0081", "Drought", 800000, 80000, 300000),
        row(2012, "31", "001", "0041", "Hail", 1000000, 100000, 50000),
        row(2019, "31", "001", "0041", "Excess Moisture/Precip/Rain", 1200000, 90000, 200000),
        row(2019, "31", "001", "0041", "Failure of Irrigation Supply", 1200000, 90000, 40000),
        row(2019, "31", "001", "0041", "Mycotoxin (Aflatoxin)", 1200000, 90000, 10000),
        row(2019, "01", "001", "0041", "Drought", 1, 1, 1, cname="AUTAUGA", stabbr="AL"),   # not an Atlas state
        row(2019, "31", "999", "0041", "Drought", 1, 1, 1, cname="ALL OTHER"),               # not a county
        row(2019, "31", "001", "0088", "ARPI/SCO/STAX/MP/HIP WI Crops Only", 500000, 50000, 300000, plan="13"),   # PRF rainfall index, RMA's real cause text
        row(2012, "31", "001", "0041", "Area Plan Crops Only", 900000, 90000, 250000, plan="04"),               # GRIP corn: peril not assigned
    ]
    agg, others, n, kept = aggregate(lines)
    assert n == 10 and kept == 8, (n, kept)
    assert "31999" not in agg
    assert agg["31001"]["prf_indemnity"] == 300000.0
    assert "heat_drought" not in agg["31001"]["years"][2019], "PRF must not enter the crop shares"
    assert agg["31001"]["years"][2012]["unassigned"]["indem"] == 250000.0 and cause_group("ARPI/SCO/STAX/MP/HIP WI Crops Only") == "unassigned"
    assert "other" not in agg["31001"]["years"][2012], "an area-plan row must not land in other"
    assert set(agg) == {"31001"}
    y12 = agg["31001"]["years"][2012]
    assert y12["heat_drought"] == {"indem": 800000.0, "prem": 180000.0, "liab": 1800000.0}, y12
    assert y12["hail"]["indem"] == 50000.0
    c12 = agg["31001"]["corn"][2012]
    assert c12["heat_drought"]["indem"] == 500000.0, c12     # soybean drought row excluded from corn
    y19 = agg["31001"]["years"][2019]
    assert y19["wet"]["indem"] == 200000.0 and y19["irrigation"]["indem"] == 40000.0 and y19["other"]["indem"] == 10000.0
    assert others == {"MYCOTOXIN (AFLATOXIN)": 10000.0}, dict(others)
    assert cause_group("Hot Wind") == "heat_drought" and cause_group("Wind/Excess Wind") == "wind"
    assert cause_group("Cold Wet Weather") == "cold" and cause_group("Decline in Price") == "price"
    assert cause_group("Failure Irrig Equip") == "irrigation" and cause_group("Excess Sun") == "heat_drought"
    # a 29-field row must stop the run
    try:
        aggregate(["|".join([""] * 29)])
        raise AssertionError("29-field row was accepted")
    except ValueError as e:
        assert "expected 30" in str(e)
    # zip round trip
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("colsom_2012.txt", "\n".join(lines[:3]) + "\n")
    agg2, _, n2, _ = aggregate(zip_lines(buf.getvalue()))
    assert n2 == 3 and agg2["31001"]["years"][2012]["hail"]["indem"] == 50000.0
    # incremental merge: an existing file with 2012 and 2019; refetch 2019 only
    existing = {"counties": {"31001": {"name": "Adams", "years": {"2012": {"hail": {"indem": 1, "prem": 1, "liab": 1}}, "2019": {"wet": {"indem": 9, "prem": 9, "liab": 9}}},
                                        "corn": {"2012": {"hail": {"indem": 1, "prem": 1, "liab": 1}}, "2019": {"wet": {"indem": 9, "prem": 9, "liab": 9}}}}},
                "per_year": {"2012": {"rows": 1}, "2019": {"rows": 1}}, "other_causes": {"X": 5.0}}
    agg3, py, oth = keep_except(existing, [2019])
    assert 2012 in agg3["31001"]["years"] and 2019 not in agg3["31001"]["years"] and py == {2012: {"rows": 1}} and oth["X"] == 5.0
    agg3, _, n3, _ = aggregate([lines[3]], agg3, oth)        # the 2019 wet row, 200000
    assert agg3["31001"]["years"][2019]["wet"]["indem"] == 200000.0 and agg3["31001"]["years"][2012]["hail"]["indem"] == 1
    log("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    this_year = datetime.now(timezone.utc).year
    # Default: on the first run every year since 1989; afterwards only the two
    # most recent crop years, which are the only ones RMA still changes. Older
    # aggregates are kept from the existing file. --all forces a full refetch.
    existing = None
    if os.path.exists(OUT) and "--all" not in sys.argv:
        with open(OUT, encoding="utf-8") as f:
            existing = json.load(f)
    years = list(range(FIRST_YEAR, this_year + 1)) if existing is None else list(range(this_year - REFETCH_YEARS + 1, this_year + 1))
    if "--years" in sys.argv:
        years = [int(y) for y in sys.argv[sys.argv.index("--years") + 1].split(",")]
    local_dir = sys.argv[sys.argv.index("--dir") + 1] if "--dir" in sys.argv else None
    agg = {}
    others = defaultdict(float)
    per_year = {}
    if existing is not None:
        agg, per_year, others = keep_except(existing, years)
        log(f"  keeping {len(per_year)} years from {OUT}; refetching {years}")
    for y in years:
        name = f"colsom_{y}.zip"
        if local_dir:
            p = os.path.join(local_dir, name)
            if not os.path.exists(p):
                log(f"  {name}: not present locally, skipped")
                continue
            with open(p, "rb") as f:
                zb = f.read()
        else:
            zb = fetch(BASE + name)
            if zb is None:
                log(f"  {name}: 404 (not published yet)")
                continue
        t0 = time.time()
        agg, others, n, kept = aggregate(zip_lines(zb), agg, others)
        per_year[y] = {"rows": n, "atlas_rows": kept, "bytes": len(zb)}
        log(f"  {name}: {n:,} rows, {kept:,} in Atlas states, {len(zb)/1e6:.1f} MB, {time.time()-t0:.0f}s")
    if not agg or not per_year:
        sys.exit("no rows aggregated")
    # a county's years arrive as int keys from aggregate() and as str keys from json; unify
    for rec in agg.values():
        rec["years"] = {int(y): g for y, g in rec["years"].items()}
        rec["corn"] = {int(y): g for y, g in rec["corn"].items()}
    latest = max(per_year)
    # a partial current year (few rows) is real data, but the page should say it is partial
    round_tree(agg)
    for rec in agg.values():
        rec["prf_indemnity"] = round(rec.get("prf_indemnity", 0.0), 2)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "USDA RMA Summary of Business, Cause of Loss (colsom_YYYY.zip)",
                   "url": BASE, "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "first_year": min(per_year), "latest_year": latest,
                   "premium_note": "premium and liability are from rows that carry a loss; not total county premium",
                   "prf_note": "prf_indemnity counts Rainfall/Vegetation Index (plans 13, 14) dollars kept out of the shares; exact only after a full --all run",
                   "refetched_years": years,
                   "per_year": per_year,
                   "other_causes": dict(sorted(others.items(), key=lambda kv: -kv[1])),
                   "counties": agg}, f, separators=(",", ":"))
    log(f"wrote {OUT}: {len(agg)} counties, years {min(per_year)}-{latest}")
    log("causes grouped as OTHER, by indemnity:")
    for k, v in sorted(others.items(), key=lambda kv: -kv[1])[:40]:
        log(f"  {v:>16,.0f}  {k}")


if __name__ == "__main__":
    main()
