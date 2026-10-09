#!/usr/bin/env python3
"""
build_arc_plc.py -- the 2027 ARC/PLC decision calculator and its pages.

OFFLINE. Reads committed files only. MACHINE-OWNED OUTPUT: edit this script,
never the files below.

  data/arc-plc-2027.json          what the calculator reads (components/arc-plc.js)
  arc-plc.html                    /arc-plc, the calculator with every key number
                                  baked into the HTML (crawlers see it without JS)
  arc-plc/<state>.html            /arc-plc/<state>, every county's estimated
                                  ARC-CO benchmark yield and revenue
  arc-plc/<state>/<county>.html   /arc-plc/<state>/<county>, one county
  embed/arc-plc.html              the embeddable calculator (noindex)
  sitemap-arc-plc.xml             every indexable URL above

    python3 scripts/build_arc_plc.py              write everything
    python3 scripts/build_arc_plc.py --check      exit 1 if any output is stale
    python3 scripts/build_arc_plc.py --selftest   hand-checked cases, writes nothing

=============================================================================
PROGRAM PARAMETERS FOR CROP YEAR 2027, VERIFIED 2026-10-09
=============================================================================
fsa.usda.gov, federalregister.gov, ecfr.gov and law.cornell.edu are not
reachable from the build sandbox; each figure was checked through search
results quoting those pages, and cross-checked against a second source.

Law: One Big Beautiful Bill Act, Pub. L. 119-21 (2025), Title I. FSA's rule
putting it into effect: Federal Register 2026-00313, Jan 12, 2026,
"Changes to Agriculture Risk Coverage, Price Loss Coverage, and Dairy Margin
Coverage Programs" [FR26]. Definitions at 7 CFR 1412.3 [CFR].

  Statutory reference prices, 2025-2030 crop years [FR26] [ERS]:
    corn $4.10/bu (was $3.70), soybeans $10.00 (was $8.40), wheat $6.35 (was
    $5.50); sorghum $4.40, barley $5.45, oats $2.65 [ERS] [CWA].
    DISAGREEMENT: DTN (2026-09-17) printed wheat at $6.33. The FR rule, ERS,
    farmdoc and Alabama Extension all say $6.35. $6.35 is used.
    From 2031 the statutory price rises 0.5% a year, capped at 113% of the
    OBBBA level [FR26]. Not relevant to 2027.
    DISAGREEMENT: Iowa State CALT described the effective-price cap as 113%;
    the eCFR text and FSA say 115%, and the 113% is the 2031 escalator cap.
    115% is used.

  Effective reference price (ERP) [CFR 1412.3]: the lesser of (1) 115% of the
    statutory reference price, or (2) the greater of the statutory reference
    price and, from the 2025 crop year, 88% (was 85%) of the average national
    marketing-year average (MYA) price for the most recent 5 crop years
    available, dropping the highest and lowest year (Olympic average).
    For crop year 2027 the five years are 2021-2025: the same lag that
    reproduces every published ERP checked in --selftest (2024: corn $4.01,
    soybeans $9.26, wheat $5.50 [FD24]; 2025 and 2026: corn $4.42, soybeans
    $10.71, wheat $6.35 [AFBF26] [CWA]).

  PLC payment rate = ERP - the higher of (MYA, national loan rate), not below
    zero. Paid on 85% of base acres times the farm's PLC payment yield [FSAF].

  Loan rates, 2026 and later crop years [LOAN] [ERS]: corn $2.42, soybeans
    $6.82, wheat $3.72 (sorghum $2.42, barley $2.75, oats $2.20).

  ARC-CO [FR26] [FD25]: guarantee 90% of benchmark revenue (was 86%); payment
    capped at 12% of benchmark revenue (was 10%), 2025-2031 crop years.
    Benchmark revenue = benchmark yield x benchmark price.
    Benchmark price = Olympic average of the same 5 MYA years, each year's MYA
      replaced by the program year's ERP where the MYA is lower. The program
      year's ERP (not each year's own) is what reproduces FSA's published
      benchmarks: 2023 corn $3.98, 2024 corn $4.85 / soybeans $11.12 / wheat
      $6.21 [FD24], 2026 corn $5.03 / soybeans $12.17 / wheat $6.98 [AFBF26].
    Benchmark yield = Olympic average of the county's yields for the same 5
      years, each year's yield raised to 80% of the county transitional yield
      (T-yield) where lower, and trend-adjusted [APPX] [FR19]. FSA uses RMA
      yield data first, then NASS, then other sources.
    Actual revenue = actual county yield x the higher of (MYA, loan rate).
    Payment rate = guarantee - actual revenue, not below zero, not above the
      12% cap. Paid on 85% of base acres [FSAF].

  Payment limit: $155,000 per person or legal entity for ARC and PLC
    combined, indexed to inflation [ALA] [FR26]. Reported at $160,000 for the
    2025 crop year [GFB]. The 2027 figure is not published.
  Sequestration: FSA has cut ARC and PLC payments 5.7% in recent years,
    applied before the payment limit [SEQ]. Not applied in the figures here.
  Payment timing: after October 1 of the year after the crop year [FD25];
    2027 crops pay after October 1, 2028.
  2025 only: producers got the higher of ARC-CO or PLC automatically [FR26].
    That rule does not carry into 2026 or 2027.

  Enrollment [USDA0915] (press release not reachable; dates confirmed by DTN,
    Texas Farm Bureau and UNL CropWatch):
    2026 crop year: Sept 16 to Dec 11, 2026.
    2027 crop year: Nov 2, 2026 to Mar 15, 2027.
    New multi-year contract option for 2026 through 2031; it stays valid while
      farm records and producers do not change, and the election can still be
      changed in a later year's signup [FR26 via search].
    No 2026 election by Dec 11: the 2025 election carries over and the farm
      gets no 2026 payment [USDA0915 via DTN].
    New base acres (up to 30 million nationally, from 2019-2023 plantings)
      were allocated this fall with a 3.69% across-the-board cut to newly
      allocated acres only; existing base is unchanged [USDA0915 via DTN].

Sources (URL list kept in PARAMS["sources"] below, printed on the page):
  [FR26]   federalregister.gov/documents/2026/01/12/2026-00313/...
  [CFR]    ecfr.gov 7 CFR part 1412 subpart A (1412.3 definitions)
  [ERS]    ers.usda.gov Title I crop commodity program provisions
  [CWA]    coloradowheat.org OBBBA provisions table
  [FSAF]   fsa.usda.gov ARC & PLC fact sheet, Sept 2025
  [LOAN]   fsa.usda.gov news 04-08-2026, 2026 marketing assistance loan rates
  [APPX]   fsa.usda.gov CCC-862/CCC-866 contract appendix
  [FR19]   federalregister.gov 2019-18853 (80% T-yield plug, trend adjustment)
  [FD24]   farmdoc daily 2024-02 likelihoods of PLC and ARC-CO payments
  [FD25]   farmdoc daily 2025-07 OBBBA commodity title impacts
  [AFBF26] fb.org Market Intel, risk management options for 2026
  [ALA]    Alabama Cooperative Extension, Title I commodity program changes
  [GFB]    Georgia Farm Bureau, USDA expands payment limits
  [SEQ]    farmcpareport.com, the 2025 ARC/PLC limit really is $160,000
  [USDA0915] fsa.usda.gov news 09-15-2026 2026-2027 enrollment
  [DTN]    dtnpf.com 2026-09-17 USDA opens ARC/PLC enrollment for 2026

=============================================================================
DATA (repo files, nothing fetched)
=============================================================================
  data/nass/{corn,soy,wheat}-price-my.json  national MYA price received,
      final only (scope string must say so or the build refuses). 2021-2025
      used for 2027. 2025 corn ($4.16) and soybeans ($10.50) were published
      by NASS at the end of Sept 2026; search results showed $4.15 and
      $10.50 as the last WASDE estimates. Corn 2025 is the low year and is
      dropped, so it cannot move the corn ERP; a 10-cent change in 2025
      soybeans moves the soybean ERP about 3 cents.
  data/cash-rent/<ST>.json  NASS county yields, all practices (yield.corn,
      yield.beans .hist), as pulled by scripts/fetch_cash_rent.py.
  farmland-atlas/data/counties-index.json  county names and page slugs.
  No county wheat yields are in the repo, so wheat has no county estimate;
  the page asks for the official FSA benchmark.

THE COUNTY ESTIMATE IS NOT FSA'S NUMBER. It is the Olympic average of the
five NASS county yields 2021-2025, with no T-yield plug and no trend
adjustment (both can only raise FSA's figure) and NASS instead of RMA data
(can differ either way). A county missing any of the five NASS years gets no
estimate: never filled, never averaged over four. Every page says so and
lets the reader type the official benchmark from the county FSA office.

Stdlib only.
"""
import argparse
import datetime as dt
import html
import json
import math
import os
import re
import sys
import tempfile
from decimal import Decimal, ROUND_HALF_UP

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

SITE = "https://agsist.com"
PY = 2027                                  # program (crop) year
MYA_YEARS = list(range(PY - 6, PY - 1))    # 2021..2025
OUT_JSON = "data/arc-plc-2027.json"
OUT_MAIN = "arc-plc.html"
OUT_DIR = "arc-plc"
OUT_EMBED = "embed/arc-plc.html"
OUT_SITEMAP = "sitemap-arc-plc.xml"
FINAL_SCOPE = "final only"
STYLES_V = "23"
LOADER_V = "18"
ASOF_V = "1"
CALC_V = "1"
MIN_STATE_COUNTIES = 3     # a state page with fewer county estimates is noindex

# ---------------------------------------------------------------- parameters
SRC = {
    "FR26": ("Federal Register 2026-00313, Jan 12, 2026 (FSA rule for the 2025 law)",
             "https://www.federalregister.gov/documents/2026/01/12/2026-00313/changes-to-agriculture-risk-coverage-price-loss-coverage-and-dairy-margin-coverage-programs"),
    "CFR": ("7 CFR 1412.3, definitions (eCFR)",
            "https://www.ecfr.gov/current/title-7/subtitle-B/chapter-XIV/subchapter-B/part-1412/subpart-A"),
    "ERS": ("USDA ERS, Title I crop commodity program provisions",
            "https://www.ers.usda.gov/topics/farm-economy/farm-commodity-policy/title-i-crop-commodity-program-provisions"),
    "FSAF": ("FSA ARC and PLC fact sheet, Sept 2025",
             "https://www.fsa.usda.gov/sites/default/files/2025-09/FSA_ARC%20&%20PLC_3pg_Fact%20Sheet-SEPT%202025_final.pdf"),
    "LOAN": ("FSA, 2026 marketing assistance loan rates (Apr 8, 2026)",
             "https://www.fsa.usda.gov/news-events/news/04-08-2026/usda-announces-2026-marketing-assistance-loan-rates-wheat-feed-grains"),
    "APPX": ("FSA, ARC/PLC contract appendix (benchmark yield rules)",
             "https://www.fsa.usda.gov/sites/default/files/documents/appendix-to-arc_plc-contracts.pdf"),
    "FR19": ("Federal Register 2019-18853 (80% T-yield plug, trend adjustment)",
             "https://www.federalregister.gov/documents/2019/09/03/2019-18853/agriculture-risk-coverage-and-price-loss-coverage-programs"),
    "FD24": ("farmdoc daily, Feb 2024 (2024 ERPs and benchmark prices)",
             "https://farmdocdaily.illinois.edu/2024/02/estimated-likelihoods-of-plc-and-arc-co-payments-for-2024.html"),
    "FD25": ("farmdoc daily, Jul 2025 (2025 law, commodity title)",
             "https://farmdocdaily.illinois.edu/2025/07/impacts-of-the-commodity-title-changes-under-the-one-big-beautiful-bill-act-obbba-for-midwestern-farms-in-2025.html"),
    "AFBF26": ("American Farm Bureau Market Intel (2026 ERPs and benchmark prices)",
               "https://www.fb.org/market-intel/risk-management-options-for-2026-corn-soybeans-and-wheat"),
    "ALA": ("Alabama Cooperative Extension, Title I program changes",
            "https://www.aces.edu/blog/topics/crop-production/title-i-commodity-program-changes/"),
    "GFB": ("Georgia Farm Bureau, USDA payment limits",
            "https://www.gfb.org/news/ag-news/post/usda-expands-payment-limits-eligibility-provisions-for-farmers"),
    "SEQ": ("Farm CPA Report, sequestration and the 2025 limit",
            "https://www.farmcpareport.com/p/correction-the-2025-arcplc-limit"),
    "USDA0915": ("USDA, Sept 15, 2026: 2026 and 2027 ARC/PLC enrollment",
                 "https://www.fsa.usda.gov/news-events/news/09-15-2026/usda-announces-2026-2027-enrollment-key-price-revenue-safety-net"),
    "DTN": ("DTN, Sept 17, 2026: USDA opens ARC/PLC enrollment",
            "https://www.dtnpf.com/agriculture/web/ag/crops/article/2026/09/17/usda-opens-arcplc-enrollment-2026"),
    "CWA": ("Colorado Wheat, 2025 law provisions table",
            "https://coloradowheat.org/wp-content/uploads/FINAL-OBBBA-Agriculture-Provisions-06.09.2025-MA.pdf"),
}
FSA_PAGE = "https://www.fsa.usda.gov/resources/programs/arc-plc"
FSA_DATA = "https://www.fsa.usda.gov/resources/programs/arc-plc/program-data"
OFFICE = "https://offices.sc.egov.usda.gov/locator/app"

PARAMS = {
    "program_year": PY,
    "erp_pct": 0.88, "erp_cap_pct": 1.15,
    "arc_guarantee_pct": 0.90, "arc_max_pct": 0.12,
    "payment_acres_pct": 0.85,
    "payment_limit_base": 155000, "payment_limit_2025": 160000,
    "sequestration_recent_pct": 0.057,
    "dates": {
        "y2026_open": "2026-09-16", "y2026_close": "2026-12-11",
        "y2027_open": "2026-11-02", "y2027_close": "2027-03-15",
        "multi_year": "2026 through 2031",
        "pay_after": "2028-10-01",
    },
}
CROPS = {
    "corn": {"label": "Corn", "unit": "bu", "statutory": 4.10, "loan": 2.42, "mya": "corn-price-my",
             "county": "corn", "fut": ("corn-dec27", "Dec 2027 corn futures"),
             "grid": (3.20, 5.20, 0.20), "prior_statutory": 3.70},
    "soybeans": {"label": "Soybeans", "unit": "bu", "statutory": 10.00, "loan": 6.82, "mya": "soy-price-my",
                 "county": "beans", "fut": ("beans-nov27", "Nov 2027 soybean futures"),
                 "grid": (8.00, 13.00, 0.50), "prior_statutory": 8.40},
    "wheat": {"label": "Wheat", "unit": "bu", "statutory": 6.35, "loan": 3.72, "mya": "wheat-price-my",
              "county": None, "fut": ("wheat-jul27", "Jul 2027 Chicago wheat futures"),
              "grid": (4.40, 7.40, 0.30), "prior_statutory": 5.50},
}
CROP_LC = {"corn": "corn", "soybeans": "soybeans", "wheat": "wheat"}
OTHER_STATUTORY = [("Sorghum", 4.40, 3.95, 2.42), ("Barley", 5.45, 4.95, 2.75), ("Oats", 2.65, 2.40, 2.20)]

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
    "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# ---------------------------------------------------------------- math
def rnd(v, k=2):
    """Half away from zero, as FSA rounds a price to the cent."""
    # round(v, 9) first: 4.10 * 1.15 is 4.7149999... in binary and must round to 4.72
    d = Decimal(repr(round(float(v), 9))).quantize(Decimal(1).scaleb(-k), rounding=ROUND_HALF_UP)
    return float(d)


def olympic(vals):
    """5 values -> (mean of the middle 3, low dropped, high dropped)."""
    if len(vals) != 5:
        raise ValueError("an Olympic average needs exactly 5 values")
    s = sorted(vals)
    return (s[1] + s[2] + s[3]) / 3.0, s[0], s[4]


def erp_calc(myas, statutory, pct=0.88, cap_pct=1.15):
    """7 CFR 1412.3. myas: the 5 MYA prices. Returns a dict with the math."""
    avg, lo, hi = olympic(myas)
    pv = rnd(avg * pct)
    cap = rnd(statutory * cap_pct)
    erp = min(cap, max(statutory, pv))
    binding = "cap" if erp == cap and pv > cap else ("formula" if pv > statutory else "statutory")
    return {"olympic_avg": rnd(avg, 4), "dropped_low": lo, "dropped_high": hi, "pct": pct,
            "pct_value": pv, "statutory": statutory, "cap_pct": cap_pct, "cap": cap,
            "erp": rnd(erp), "binding": binding}


def benchmark_price(myas, erp):
    """Each year's MYA, floored at the program year's ERP, Olympic-averaged."""
    used = [max(m, erp) for m in myas]
    avg, lo, hi = olympic(used)
    return rnd(avg), used, lo, hi


def plc_rate(erp, mya, loan):
    return max(0.0, erp - max(mya, loan))


def arc_rate(by, bp, y, mya, loan, g=0.90, cap=0.12):
    br = by * bp
    return min(max(0.0, g * br - y * max(mya, loan)), cap * br)


def per_base(rate_value, pa=0.85):
    return rate_value * pa


def ranges(erp, loan, plc_y, by, bp, y, g=0.90, cap=0.12, pa=0.85):
    """Which program pays more at each cent of season-average price, at county
    yield y. Returns runs [{w, lo, hi}] in cents, inclusive; w in plc/arc/same/none.
    Mirrors AgArcPlc.ranges in components/arc-plc.js (test/arc-plc.test.mjs)."""
    lo_c = int(round(loan * 100))
    top = max(erp, (g * by * bp / y) if y > 0 else erp)
    hi_c = int(math.ceil(top * 100)) + 1
    runs = []
    for c in range(lo_c, hi_c + 1):
        p = c / 100.0
        a = round(per_base(arc_rate(by, bp, y, p, loan, g, cap), pa) * 100)
        b = round(per_base(plc_rate(erp, p, loan) * plc_y, pa) * 100)
        w = "none" if a == 0 and b == 0 else ("same" if a == b else ("plc" if b > a else "arc"))
        if runs and runs[-1]["w"] == w:
            runs[-1]["hi"] = c
        else:
            runs.append({"w": w, "lo": c, "hi": c})
    return runs


def plc_below(runs):
    """The price at or below which PLC pays more (cents), when the lowest run is PLC."""
    return runs[0]["hi"] if runs and runs[0]["w"] == "plc" else None


# ---------------------------------------------------------------- formatting
def esc(s):
    return html.escape("" if s is None else str(s), quote=True)


def usd(v, k=2):
    return f"${rnd(v, k):,.{k}f}"


def c2(c):
    return f"${c / 100:.2f}"


def bu(v):
    return f"{rnd(v, 1):.1f}"


def nice_date(iso, year=True):
    d = dt.date.fromisoformat(iso)
    return f"{MON[d.month - 1]} {d.day}" + (f", {d.year}" if year else "")


def slugify(s):
    import unicodedata
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.lower().replace("&", " and ").replace("'", "").replace("’", "")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "x"


WORD = {"plc": "PLC", "arc": "ARC-CO"}


def ranges_text(runs):
    """Plain sentences for the runs, lowest price first. Mirrors rangeText in JS."""
    out = []
    n = len(runs)
    for i, r in enumerate(runs):
        lo, hi = c2(r["lo"]), c2(r["hi"])
        if r["w"] == "none":
            out.append(f"Neither pays at {lo} or higher." if i == n - 1 else f"Neither pays from {lo} to {hi}.")
            continue
        who = "Both pay the same" if r["w"] == "same" else f"{WORD[r['w']]} pays more"
        if i == 0:
            out.append(f"{who} at {hi} or lower.")
        elif i == n - 1:
            out.append(f"{who} at {lo} or higher.")
        else:
            out.append(f"{who} from {lo} to {hi}.")
    return out


# ---------------------------------------------------------------- loading
def _read(root, rel):
    with open(os.path.join(root, rel), encoding="utf-8") as f:
        return json.load(f)


def load_inputs(root="."):
    inp = {"mya": {}, "mya_meta": {}, "yields": {}, "counties": [], "prices": None}
    for crop, c in CROPS.items():
        d = _read(root, f"data/nass/{c['mya']}.json")
        if FINAL_SCOPE not in d.get("scope", ""):
            raise SystemExit(f"{c['mya']}.json scope does not say '{FINAL_SCOPE}'; refusing a forecast price")
        inp["mya"][crop] = {int(k): float(v) for k, v in d["values"].items()}
        inp["mya_meta"][crop] = {"file": f"data/nass/{c['mya']}.json", "updated": d.get("updated"),
                                 "source": d.get("source")}
    for fn in sorted(os.listdir(os.path.join(root, "data/cash-rent"))):
        if not re.fullmatch(r"[A-Z]{2}\.json", fn):
            continue
        d = _read(root, f"data/cash-rent/{fn}")
        for c in d.get("counties", []):
            inp["yields"][c["fips"]] = {k: {int(y): float(v) for y, v in (c["yield"].get(k) or {}).get("hist", {}).items()}
                                        for k in ("corn", "beans")}
        inp.setdefault("yield_generated", []).append(d.get("generated", ""))
    inp["yield_generated"] = max(inp.get("yield_generated") or [""])
    inp["counties"] = _read(root, "farmland-atlas/data/counties-index.json")
    return inp


def county_estimate(hist):
    """NASS county yields -> (estimate, the 5 yields) or (None, missing years)."""
    miss = [y for y in MYA_YEARS if y not in hist]
    if miss:
        return None, miss
    ys = [hist[y] for y in MYA_YEARS]
    return rnd(olympic(ys)[0], 1), ys


# ---------------------------------------------------------------- compute
def compute(inp):
    crops = {}
    for crop, c in CROPS.items():
        mya = inp["mya"][crop]
        miss = [y for y in MYA_YEARS if y not in mya]
        if miss:
            raise SystemExit(f"{crop}: no final MYA for {miss}; the {PY} ERP cannot be computed")
        ys = [mya[y] for y in MYA_YEARS]
        e = erp_calc(ys, c["statutory"], PARAMS["erp_pct"], PARAMS["erp_cap_pct"])
        bp, used, blo, bhi = benchmark_price(ys, e["erp"])
        crops[crop] = {
            "label": c["label"], "unit": c["unit"], "statutory": c["statutory"], "loan": c["loan"],
            "prior_statutory": c["prior_statutory"],
            "mya": {str(y): v for y, v in zip(MYA_YEARS, ys)},
            "erp": e,
            "bp": {"value": bp, "used": {str(y): v for y, v in zip(MYA_YEARS, used)}, "dropped_low": blo, "dropped_high": bhi},
            "futures": {"key": c["fut"][0], "label": c["fut"][1]},
            "grid": {"lo": c["grid"][0], "hi": c["grid"][1], "step": c["grid"][2]},
            "county_est": bool(c["county"]),
            "mya_source": inp["mya_meta"][crop],
        }
    states = {}
    for fips, name_st, path in inp["counties"]:
        parts = path.strip("/").split("/")
        if len(parts) != 3:
            continue
        name, st = name_st.rsplit(", ", 1)
        if st not in STATE_NAMES:
            continue
        rec = [fips, name, parts[2]]
        y = inp["yields"].get(fips, {})
        any_est = False
        for crop in ("corn", "soybeans"):
            hist = y.get(CROPS[crop]["county"], {})
            recent = {k: v for k, v in hist.items() if k in MYA_YEARS}
            if not recent:
                rec.append(0)                      # no NASS county yield in the window
                continue
            est, ys = county_estimate(hist)
            if est is None:
                rec.append({"miss": ys})
            else:
                rec.append({"by": est, "y": ys})
                any_est = True
        s = states.setdefault(st, {"n": STATE_NAMES[st], "slug": parts[1], "c": []})
        rec.append(1 if any_est else 0)
        s["c"].append(rec)
    for s in states.values():
        s["c"].sort(key=lambda r: r[1])
        s["n_est"] = sum(1 for r in s["c"] if r[5])
    updated = max([m["updated"] or "" for m in inp["mya_meta"].values()] + [inp["yield_generated"]])
    return {
        "program_year": PY,
        "updated": updated,
        "mya_years": MYA_YEARS,
        "params": PARAMS,
        "crops": crops,
        "states": states,
        "county_fields": ["fips", "name", "slug", "corn", "soybeans", "has_page"],
        "county_note": ("Estimate: Olympic average of NASS county yields (all practices) for "
                        f"{MYA_YEARS[0]}-{MYA_YEARS[-1]}. FSA's official benchmark uses RMA data first, "
                        "raises any year below 80% of the county T-yield, and adds a trend adjustment, "
                        "so it can differ. Your county FSA office has the official number."),
        "sources": {k: {"name": v[0], "url": v[1]} for k, v in SRC.items()},
        "links": {"fsa": FSA_PAGE, "fsa_data": FSA_DATA, "office": OFFICE},
    }


# ---------------------------------------------------------------- shared page parts
def chrome():
    try:
        import inject_static_nav as NAV
        return (f'<div id="site-header">{NAV.block("header")}</div>',
                f'<div id="site-footer">{NAV.block("footer")}</div>', NAV.FONT_BLOCK)
    except Exception:  # pragma: no cover
        return ('<div id="site-header"></div>', '<div id="site-footer"></div>', "")


def head(title, desc, path, jsonld, indexable=True, fonts="", og_title=None, og_desc=None, extra=""):
    robots = "index,follow" if indexable else "noindex,follow"
    ogt, ogd = og_title or title, og_desc or desc
    ld = "\n".join('  <script type="application/ld+json">' + json.dumps(j, ensure_ascii=False).replace("</", "<\\/") + "</script>"
                   for j in jsonld)
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0a0c0d">
  <script>/* agsist-theme-early: saved theme, else the device's, set before first paint so pages do not flash the wrong color. loader.js applies the same rule. */try{{var _t=localStorage.getItem('agsist-theme');if(_t!=='light'&&_t!=='dark')_t=window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.setAttribute('data-theme',_t);}}catch(e){{}}</script><script>/* agsist-ga-guard 2026-10-09: Google Analytics loads only when the browser sends no Global Privacy Control signal and the off switch on /privacy is not set, and only once the page is shown (a page loaded ahead in the background is not a visit). dataLayer and gtag always exist, so page code that calls them never throws. */(function(w,d,n){{var off=false,v,i,s;w.dataLayer=w.dataLayer||[];if(typeof w.gtag!=='function'){{w.gtag=function(){{w.dataLayer.push(arguments);}};}}try{{off=w.localStorage.getItem('agsist-ga-off')==='1';}}catch(e){{}}if(n.globalPrivacyControl===true){{off=true;}}w.agsistGaOff=off;w.gtag('set','allow_google_signals',false);w.gtag('set','allow_ad_personalization_signals',false);if(off){{return;}}i=function(){{s=d.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H';(d.head||d.documentElement).appendChild(s);}};if(d.prerendering){{d.addEventListener('prerenderingchange',i,{{once:true}});}}else{{i();}}}})(window,document,navigator);</script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-6KXCTD5Z9H');</script>
  {fonts}
  <link rel="preload" href="/components/styles.css?v={STYLES_V}" as="style">
  <link rel="stylesheet" href="/components/styles.css?v={STYLES_V}">
  <link rel="stylesheet" href="/components/asof.css?v={ASOF_V}">
  <link rel="stylesheet" href="/components/arc-plc.css?v={CALC_V}">
  <link rel="icon" type="image/x-icon" href="/img/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/img/favicon-16.png">
  <link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.json">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}">
  <meta name="robots" content="{robots}">
  <link rel="canonical" href="{SITE}{path}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="AGSIST">
  <meta property="og:locale" content="en_US">
  <meta property="og:title" content="{esc(ogt)}">
  <meta property="og:description" content="{esc(ogd)}">
  <meta property="og:url" content="{SITE}{path}">
  <meta property="og:image" content="{SITE}/img/og/agsist.jpg">
  <meta property="og:image:alt" content="{esc(ogt)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@agsist">
  <meta name="twitter:title" content="{esc(ogt)}">
  <meta name="twitter:description" content="{esc(ogd)}">
  <meta name="twitter:image" content="{SITE}/img/og/agsist.jpg">
{ld}{extra}
</head>"""


def tail(ftr, calc=False):
    s = f"""{ftr}
<script src="/components/asof.js?v={ASOF_V}" defer></script>
<script src="/components/loader.js?v={LOADER_V}" defer></script>"""
    if calc:
        s += f'\n<script src="/components/arc-plc.js?v={CALC_V}" defer></script>'
    return s + "\n</body>\n</html>\n"


def asof(iso, prefix="Data updated"):
    """Static asof stamp (components/asof.js refreshes it). No feed: annual data never goes stale here."""
    day = (iso or "")[:10]
    if not day:
        return ""
    return (f'<time class="asof" data-asof="" data-asof-prefix="{esc(prefix)}" datetime="{day}">'
            f'{esc(prefix)} {nice_date(day)}</time>')


def form_html(D, crop="corn", st="", fips="", embed=False):
    """The calculator's inputs. components/arc-plc.js fills the selects and the
    results; with no JS the page above already carries every key number."""
    chips = "".join(
        f'<button type="button" class="chip" data-crop="{k}" aria-pressed="{"true" if k == crop else "false"}">{esc(v["label"])}</button>'
        for k, v in D["crops"].items())
    return f"""<section class="ap-calc" id="calculator" data-arcplc data-src="/data/arc-plc-2027.json" data-crop="{esc(crop)}" data-state="{esc(st)}" data-fips="{esc(fips)}"{' data-embed="1"' if embed else ''} aria-labelledby="ap-calc-h">
  <h2 id="ap-calc-h" class="ap-h2">Run your farm&rsquo;s numbers</h2>
  <div class="ap-crops" role="group" aria-label="Crop">{chips}</div>
  <div class="ap-grid">
    <div class="ap-f"><label for="ap-st">State</label><select id="ap-st"><option value="">Pick a state</option></select></div>
    <div class="ap-f"><label for="ap-co">County</label><select id="ap-co" disabled><option value="">Pick a state first</option></select></div>
    <div class="ap-f"><label for="ap-base">Base acres for this crop</label><input id="ap-base" type="number" inputmode="decimal" min="0" step="0.1" value="100"></div>
    <div class="ap-f"><label for="ap-py">PLC payment yield (bu/acre)</label><input id="ap-py" type="number" inputmode="decimal" min="0" step="1" placeholder="From your FSA-156EZ"><p class="ap-hint">On the FSA-156EZ for the farm. Each farm has its own.</p></div>
    <div class="ap-f"><label for="ap-by">Official ARC-CO benchmark yield (optional)</label><input id="ap-by" type="number" inputmode="decimal" min="0" step="0.1" placeholder="From your county FSA office"><p class="ap-hint" id="ap-by-hint">Leave blank to use our estimate where we have one.</p></div>
    <div class="ap-f"><label for="ap-y">Expected {PY} county yield (bu/acre)</label><input id="ap-y" type="number" inputmode="decimal" min="0" step="0.1"><p class="ap-hint">Starts at the benchmark yield. County average, not your farm.</p></div>
    <div class="ap-f ap-f-wide"><label for="ap-p">Expected {PY} season-average price ($/bu)</label><input id="ap-p" type="number" inputmode="decimal" min="0" step="0.01" placeholder="You set this"><p class="ap-hint ap-fut" id="ap-fut"></p></div>
  </div>
  <div class="ap-out" id="ap-out" aria-live="polite"></div>
</section>"""


def src_link(k):
    n, u = SRC[k]
    return f'<a href="{esc(u)}" rel="noopener">{esc(n)}</a>'


# ---------------------------------------------------------------- the main page
def erp_math_html(crop, c):
    e = c["erp"]
    # mark only one low and one high as dropped when values repeat
    lo_done = hi_done = False
    parts = []
    for y, v in c["mya"].items():
        if not lo_done and v == e["dropped_low"]:
            parts.append(f'<s>{y}: {usd(v)}</s>'); lo_done = True
        elif not hi_done and v == e["dropped_high"]:
            parts.append(f'<s>{y}: {usd(v)}</s>'); hi_done = True
        else:
            parts.append(f"{y}: {usd(v)}")
    yrs = " &middot; ".join(parts)
    if e["binding"] == "statutory":
        verdict = (f'88% of the average is {usd(e["pct_value"])}, below the {usd(e["statutory"])} statutory price, '
                   f'so the statutory price holds: <b>{usd(e["erp"])}</b>.')
    elif e["binding"] == "cap":
        verdict = f'88% of the average is {usd(e["pct_value"])}, above the cap, so the cap holds: <b>{usd(e["erp"])}</b>.'
    else:
        verdict = (f'88% of that is <b>{usd(e["erp"])}</b>, above the {usd(e["statutory"])} statutory price and under '
                   f'the {usd(e["cap"])} cap (115%).')
    return (f'<p class="ap-math"><b>{esc(c["label"])}.</b> Season-average prices {yrs} (struck: the high and low year, dropped). '
            f'Average of the middle three: {usd(e["olympic_avg"], 4)}. {verdict}</p>')


def worked_example(D):
    c = D["crops"]["corn"]
    erp, bp, loan = c["erp"]["erp"], c["bp"]["value"], c["loan"]
    by, py_, base, y, p = 180.0, 150.0, 100.0, 162.0, 4.00
    pr = plc_rate(erp, p, loan)
    ar = arc_rate(by, bp, y, p, loan)
    br = by * bp
    g = 0.9 * br
    runs = ranges(erp, loan, py_, by, bp, y)
    txt = " ".join(ranges_text(runs))
    return {
        "html": f"""<ol class="ap-steps">
  <li><b>PLC.</b> Payment rate = {usd(erp)} &minus; {usd(p)} = <b>{usd(pr)}/bu</b>. Per base acre: {usd(pr)} &times; {py_:.0f} bu PLC yield &times; 85% = <b>{usd(per_base(pr * py_))}</b>.</li>
  <li><b>ARC-CO.</b> Benchmark revenue = {by:.0f} bu &times; {usd(bp)} = {usd(br)}. Guarantee (90%) = {usd(g)}. Actual revenue = {y:.0f} bu &times; {usd(p)} = {usd(y * p)}.
  Shortfall {usd(g - y * p)}, capped at 12% of benchmark ({usd(0.12 * br)}): <b>{usd(ar)}/acre</b>. Per base acre &times; 85% = <b>{usd(per_base(ar))}</b>.</li>
  <li><b>On 100 base acres:</b> PLC {usd(per_base(pr * py_) * base, 0)}, ARC-CO {usd(per_base(ar) * base, 0)}.</li>
  <li><b>Where they cross at a {y:.0f} bu county yield:</b> {esc(txt)}</li>
</ol>""",
        "short": (f"Example: corn, {by:.0f} bu county benchmark, {py_:.0f} bu PLC yield, {y:.0f} bu county yield, "
                  f"{usd(p)} season-average price. PLC pays {usd(per_base(pr * py_))} per base acre; "
                  f"ARC-CO pays {usd(per_base(ar))}."),
    }


def faq_items(D):
    c, s, w = D["crops"]["corn"], D["crops"]["soybeans"], D["crops"]["wheat"]
    d = PARAMS["dates"]
    return [
        ("Should I pick ARC or PLC for 2027?",
         f"It comes down to where you think the 2027 season-average price lands. PLC pays when the national price ends below "
         f"the effective reference price ({usd(c['erp']['erp'])} corn, {usd(s['erp']['erp'])} soybeans, {usd(w['erp']['erp'])} wheat). "
         f"ARC-CO pays when county revenue falls below 90% of its benchmark, so it helps more when the county yield drops "
         f"while the price holds. Use the calculator with your PLC yield and your county to see which pays more at each price."),
        ("What is the 2027 effective reference price for corn?",
         f"{usd(c['erp']['erp'])} per bushel by our math from final USDA prices: 88% of the {MYA_YEARS[0]} to {MYA_YEARS[-1]} "
         f"Olympic average season-average price ({usd(c['erp']['olympic_avg'], 4)}), above the {usd(c['statutory'])} statutory price. "
         f"Soybeans: {usd(s['erp']['erp'])}. Wheat: {usd(w['erp']['erp'])}, the statutory price, because 88% of its average is lower. "
         f"FSA publishes the official figures."),
        ("When is the 2027 ARC/PLC deadline?",
         f"The 2027 election and enrollment runs {nice_date(d['y2027_open'])} to {nice_date(d['y2027_close'])}. "
         f"The 2026 window is {nice_date(d['y2026_open'])} to {nice_date(d['y2026_close'])}."),
        ("What happens if I don't enroll?",
         "For 2026, USDA says a farm with no election by December 11, 2026 keeps its 2025 election but gets no 2026 payment. "
         "Keeping your old choice still takes a signed contract. Ask your county office how the same rule applies to 2027."),
        ("Can I sign a multi-year contract?",
         "Yes. There is a new multi-year contract option for 2026 through 2031. It stays in force while the farm's records and "
         "producers do not change, and you can still change the election in a later year's signup. Some advisers would rather "
         "keep the yearly choice, since prices and county yields can move a lot by 2031."),
        ("How is ARC-CO paid?",
         "ARC-CO compares actual county revenue (county yield times the higher of the national season-average price or the loan rate) "
         "with a guarantee of 90% of benchmark revenue. The shortfall is paid, up to 12% of benchmark revenue, on 85% of your base acres."),
        ("How is PLC paid?",
         "The PLC rate is the effective reference price minus the higher of the national season-average price or the loan rate. "
         "It is paid on 85% of base acres times the farm's PLC payment yield."),
        ("When do 2027 ARC and PLC payments come?",
         "Once the marketing year for the 2027 crop is over and USDA has published its season-average price, so after October 1, 2028."),
        ("What is the ARC/PLC payment limit?",
         f"$155,000 per person or legal entity in the 2025 law, adjusted for inflation. It was reported at $160,000 for 2025. "
         f"The 2027 figure is not out yet."),
    ]


def build_main(D, ch):
    hdr, ftr, fonts = ch
    c, s, w = D["crops"]["corn"], D["crops"]["soybeans"], D["crops"]["wheat"]
    d = PARAMS["dates"]
    ex = worked_example(D)
    faq = faq_items(D)
    title = "ARC vs PLC 2027 Calculator and Reference Prices | AGSIST"
    desc = (f"2027 effective reference prices: corn {usd(c['erp']['erp'])}, soybeans {usd(s['erp']['erp'])}, "
            f"wheat {usd(w['erp']['erp'])}. Compare ARC-CO and PLC for your county. Sign up by Mar 15, 2027.")
    og_title = f"ARC or PLC for 2027: corn ERP {usd(c['erp']['erp'])}, soybeans {usd(s['erp']['erp'])}"
    n_states = sum(1 for x in D["states"].values() if x["n_est"])
    n_est = sum(x["n_est"] for x in D["states"].values())
    jsonld = [
        {"@context": "https://schema.org", "@type": "WebApplication", "@id": f"{SITE}/arc-plc#app",
         "name": "ARC or PLC for 2027: decision calculator", "url": f"{SITE}/arc-plc",
         "applicationCategory": "FinanceApplication", "operatingSystem": "Any (web browser)",
         "isAccessibleForFree": True, "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
         "description": desc, "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE},
         "dateModified": D["updated"][:10]},
        {"@context": "https://schema.org", "@type": "FAQPage",
         "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]},
        {"@context": "https://schema.org", "@type": "Dataset", "@id": f"{SITE}/arc-plc#erp",
         "name": f"{PY} PLC effective reference prices and ARC-CO benchmark prices, corn, soybeans, wheat",
         "description": (f"Computed by AGSIST from USDA NASS final marketing-year average prices {MYA_YEARS[0]}-{MYA_YEARS[-1]} "
                         f"under 7 CFR 1412.3 as amended for the 2025 law: ERP = min(115% of statutory, max(statutory, 88% of the "
                         f"Olympic average)). Plus county ARC-CO benchmark yield estimates for {n_est} counties."),
         "url": f"{SITE}/arc-plc", "isAccessibleForFree": True, "license": "https://creativecommons.org/licenses/by/4.0/",
         "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE},
         "isBasedOn": ["https://quickstats.nass.usda.gov/", SRC["FR26"][1]],
         "distribution": {"@type": "DataDownload", "encodingFormat": "application/json", "contentUrl": f"{SITE}/{OUT_JSON}"},
         "temporalCoverage": f"{MYA_YEARS[0]}/{PY}", "dateModified": D["updated"][:10],
         "variableMeasured": ["effective reference price ($/bu)", "ARC-CO benchmark price ($/bu)", "ARC-CO benchmark yield estimate (bu/acre)"]},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "Tools", "item": f"{SITE}/tools"},
            {"@type": "ListItem", "position": 3, "name": "ARC vs PLC 2027", "item": f"{SITE}/arc-plc"}]},
    ]
    erp_rows = "".join(
        f'<tr><th scope="row">{esc(x["label"])}</th><td class="num"><b>{usd(x["erp"]["erp"])}</b></td><td class="num">{usd(x["bp"]["value"])}</td>'
        f'<td class="num">{usd(x["statutory"])}</td><td class="num">{usd(x["prior_statutory"])}</td><td class="num">{usd(x["loan"])}</td></tr>'
        for x in D["crops"].values())
    other_rows = "".join(
        f'<tr><th scope="row">{n}</th><td class="num mut">not computed</td><td class="num mut">not computed</td><td class="num">{usd(p1)}</td><td class="num">{usd(p0)}</td><td class="num">{usd(l)}</td></tr>'
        for n, p1, p0, l in OTHER_STATUTORY)
    bp_math = "".join(
        f'<p class="ap-math"><b>{esc(x["label"])}.</b> ' + " &middot; ".join(
            f"{y}: {usd(v)}" + (f" (raised from {usd(x['mya'][y])})" if v != x["mya"][y] else "") for y, v in x["bp"]["used"].items())
        + f'. Drop the high ({usd(x["bp"]["dropped_high"])}) and low ({usd(x["bp"]["dropped_low"])}); the middle three average <b>{usd(x["bp"]["value"])}</b>.</p>'
        for x in D["crops"].values())
    faq_html = "".join(f"<h3>{esc(q)}</h3><p>{esc(a)}</p>" for q, a in faq)
    state_links = " &middot; ".join(
        f'<a href="/arc-plc/{x["slug"]}">{esc(x["n"])}</a>'
        for k, x in sorted(D["states"].items(), key=lambda kv: kv[1]["n"]) if x["n_est"])
    srcs = "".join(f"<li>{src_link(k)}</li>" for k in SRC)
    body = f"""
<body>
{hdr}
<main class="ap-wrap" id="main">
  <p class="page-kicker">Farm program &middot; {PY} crop year</p>
  <h1>ARC or PLC for {PY}: decision calculator</h1>
  <div class="ap-quick" id="quick-answer">
    <p><b>Quick answer.</b> The {PY} PLC effective reference prices work out to <b>{usd(c['erp']['erp'])}</b> for corn,
    <b>{usd(s['erp']['erp'])}</b> for soybeans and <b>{usd(w['erp']['erp'])}</b> for wheat. PLC pays if the {PY} national
    season-average price ends below that. ARC-CO pays when county revenue falls below 90% of its benchmark
    (benchmark prices {usd(c['bp']['value'])} corn, {usd(s['bp']['value'])} soybeans, {usd(w['bp']['value'])} wheat).
    The {PY} signup runs {nice_date(d['y2027_open'])} to {nice_date(d['y2027_close'])}.</p>
    <p class="ap-small">Our math from final USDA prices and the 2025 farm law; FSA publishes the official numbers. {asof(D['updated'])}</p>
  </div>
  <p class="page-lede">Pick your crop and county, type your PLC yield, and set a price. The table shows which program pays more
  per base acre across a range of prices and county yields. This does not forecast the price. You set it.</p>

  {form_html(D)}

  <h2 id="dates">Sign-up dates for {PY}</h2>
  <ul class="ap-list">
    <li><b>{PY} election and enrollment:</b> {nice_date(d['y2027_open'])} to {nice_date(d['y2027_close'])}.</li>
    <li><b>2026 election and enrollment:</b> open now, through {nice_date(d['y2026_close'])}.</li>
    <li><b>Multi-year option:</b> one contract for {d['multi_year']}. It stays in force while the farm&rsquo;s records and producers do not change, and you can still change the election in a later signup.</li>
    <li><b>If you don&rsquo;t sign:</b> for 2026, a farm with no election by {nice_date(d['y2026_close'])} keeps its 2025 election and gets no 2026 payment. Keeping your old choice still takes a signature.</li>
    <li><b>New base acres:</b> FSA allocated new base this fall, cut 3.69% across the board on the new acres only. Check your allocation notice.</li>
    <li><b>When {PY} payments come:</b> after the marketing year closes, so after Oct 1, 2028.</li>
    <li><b>Payment limit:</b> $155,000 per person or entity for ARC and PLC together, adjusted for inflation (reported at $160,000 for 2025; the {PY} figure is not out).</li>
  </ul>

  <h2 id="erp">What is the {PY} effective reference price for corn, soybeans and wheat</h2>
  <div class="ap-scroll"><table class="tbl ap-t">
    <thead><tr><th>Crop</th><th class="num">{PY} ERP</th><th class="num">{PY} ARC benchmark</th><th class="num">Statutory now</th><th class="num">Before 2025</th><th class="num">Loan rate</th></tr></thead>
    <tbody>{erp_rows}{other_rows}</tbody>
  </table></div>
  <p class="ap-small">$ per bushel. ERP = PLC effective reference price. ARC benchmark = ARC-CO benchmark price. Sorghum, barley and oats: statutory prices and loan rates only; AGSIST has no final season-average price series for them, so no {PY} figure is computed.</p>
  <details class="ap-det" open><summary>Show the math</summary>
  <p>The effective reference price is the lesser of 115% of the statutory price, or the greater of the statutory price and 88% of the
  Olympic average season-average price for the five most recent crop years ({MYA_YEARS[0]} to {MYA_YEARS[-1]} for {PY}; the high and low years are dropped).
  Prices are USDA NASS final national season-average prices received.</p>
  {''.join(erp_math_html(k, x) for k, x in D['crops'].items())}
  <p>The ARC-CO benchmark price uses the same five years, with any year below the {PY} effective reference price raised to it:</p>
  {bp_math}
  </details>

  <h2 id="how">How ARC-CO and PLC pay</h2>
  <ul class="ap-list">
    <li><b>PLC rate</b> = effective reference price &minus; the higher of the national season-average price or the loan rate. Paid on 85% of base acres &times; your PLC payment yield.</li>
    <li><b>ARC-CO rate</b> = 90% of benchmark revenue &minus; actual county revenue, never more than 12% of benchmark revenue. Paid on 85% of base acres.</li>
    <li><b>Benchmark revenue</b> = county benchmark yield &times; benchmark price. Actual revenue = actual county yield &times; the higher of the season-average price or the loan rate.</li>
    <li><b>The 2025 rule that paid the higher of the two</b> was for the 2025 crop only. For {PY} you get the program you pick.</li>
  </ul>

  <h2 id="example">A worked example</h2>
  <p>A made-up corn farm, to show the arithmetic: county benchmark yield 180 bu, PLC yield 150 bu, 100 base acres, a {PY} county yield of 162 bu and a $4.00 season-average price.</p>
  {ex['html']}

  <h2 id="benchmark-yield">ARC-CO benchmark yield for your county</h2>
  <p>FSA sets each county&rsquo;s benchmark yield from the five most recent years ({MYA_YEARS[0]} to {MYA_YEARS[-1]} for {PY}), drops the high and low,
  raises any year below 80% of the county T-yield, and adds a trend adjustment. It uses RMA crop insurance data first. We estimate it from
  NASS county yields with the same Olympic average, without the plug or trend adjustment, so the official number can differ, usually upward.
  We have an estimate for {n_est:,} counties in {n_states} states; a county missing any of the five NASS years gets none. Your county FSA office has the official number.</p>
  <p class="ap-states">{state_links}</p>

  <h2 id="faq">Questions farmers ask</h2>
  <div class="ap-faq">{faq_html}</div>

  <p class="ap-disc"><b>This is an estimate, not a USDA determination.</b> Payments depend on FSA&rsquo;s official yields, prices and your farm records.
  Read FSA&rsquo;s <a href="{FSA_PAGE}" rel="noopener">ARC/PLC page</a>, its <a href="{FSA_DATA}" rel="noopener">program data</a>,
  or <a href="{OFFICE}" rel="noopener">find your county FSA office</a>. USDA has cut recent payments 5.7% for sequestration; the dollars here are before that cut.
  Want this on your site? <a href="/embed#arc-plc">Embed the calculator</a>.</p>
  <details class="ap-det"><summary>Sources</summary><ul class="ap-src">{srcs}<li><a href="https://quickstats.nass.usda.gov/" rel="noopener">USDA NASS Quick Stats</a> (season-average prices, county yields)</li></ul></details>
  <p class="ap-small">Related: <a href="/farm-bill">Farm bill tracker</a> &middot; <a href="/presell-calculator">Pre-sell calculator</a> &middot; <a href="/breakeven">Break-even calculator</a> &middot; <a href="/harvest-price-tracker">Harvest price tracker</a></p>
</main>
"""
    return head(title, desc, "/arc-plc", jsonld, True, fonts, og_title=og_title) + body + tail(ftr, calc=True), {
        "title": title, "desc": desc, "og_title": og_title, "faq": [q for q, _ in faq]}


# ---------------------------------------------------------------- state and county pages
def county_metrics(by, crop_d):
    bp = crop_d["bp"]["value"]
    br = by * bp
    return {"br": br, "g": 0.9 * br, "max": 0.12 * br, "max_base": per_base(0.12 * br),
            "trig_y": 0.9 * br / crop_d["erp"]["erp"], "cap_y": 0.78 * br / crop_d["erp"]["erp"]}


RATIOS = (0.6, 0.7, 0.8, 0.9, 1.0)


def trigger_c(crop_d):
    """Highest cent at which ARC-CO pays when county yield = benchmark: price < 90% x benchmark price."""
    return int(math.floor(round(0.9 * crop_d["bp"]["value"] * 100, 6) - 1e-6))


def crossover_rows(crop_d, by=None):
    """PLC-wins-below price at county yield = benchmark, by PLC yield as a share
    of the benchmark. Depends only on that share, so it is the same in every county."""
    erp, loan, bp = crop_d["erp"]["erp"], crop_d["loan"], crop_d["bp"]["value"]
    base_by = by if by else 100.0
    out = []
    for r in RATIOS:
        runs = ranges(erp, loan, base_by * r, base_by, bp, base_by)
        out.append((r, base_by * r, plc_below(runs), runs))
    return out


def crossover_table(crop_d, by=None):
    rows = []
    for r, pyv, below, runs in crossover_rows(crop_d, by):
        arc_runs = [x for x in runs if x["w"] == "arc"]
        arc_txt = f'{c2(arc_runs[0]["lo"])} to {c2(arc_runs[-1]["hi"])}' if arc_runs else "never"
        lab = f"{bu(pyv)} bu ({int(r * 100)}%)" if by else f"{int(r * 100)}% of benchmark"
        rows.append(f'<tr><td>{lab}</td><td class="num">{c2(below) + " or lower" if below else "never"}</td><td class="num">{arc_txt}</td></tr>')
    return ('<div class="ap-scroll"><table class="tbl ap-t"><thead><tr><th>Your PLC yield</th><th class="num">PLC more at</th>'
            '<th class="num">ARC-CO more at</th></tr></thead><tbody>' + "".join(rows) + "</tbody></table></div>")


def state_page(st, S, D, ch, nav_states):
    hdr, ftr, fonts = ch
    name, sl = S["n"], S["slug"]
    corn, soy = D["crops"]["corn"], D["crops"]["soybeans"]
    est = [r for r in S["c"] if r[5]]
    none = [r for r in S["c"] if not r[5]]
    indexable = len(est) >= MIN_STATE_COUNTIES
    path = f"/arc-plc/{sl}"
    title = f"{name} ARC-CO Benchmark Yields 2027 by County | AGSIST"
    if len(title) > 60:
        title = f"{name} ARC-CO Benchmark Yields 2027 | AGSIST"
    n_c = sum(1 for r in est if isinstance(r[3], dict) and "by" in r[3])
    n_s = sum(1 for r in est if isinstance(r[4], dict) and "by" in r[4])
    desc = (f"Estimated {PY} ARC-CO benchmark yields and revenue for {len(est)} {name} counties "
            f"(corn {n_c}, soybeans {n_s}), from USDA NASS. Corn ERP {usd(corn['erp']['erp'])}.")

    def cell(v, crop_d):
        if isinstance(v, dict) and "by" in v:
            m = county_metrics(v["by"], crop_d)
            return (f'<td class="num">{bu(v["by"])}</td><td class="num">{usd(m["br"], 0)}</td>'
                    f'<td class="num">{usd(m["max_base"], 0)}</td>')
        why = "n/a"
        if isinstance(v, dict) and "miss" in v:
            why = "missing " + ", ".join(str(y) for y in v["miss"])
        return f'<td class="mut" colspan="3">{why}</td>'

    rows = "".join(
        f'<tr><th scope="row"><a href="/arc-plc/{sl}/{r[2]}">{esc(re.sub(r" (County|Parish)$", "", r[1]))}</a></th>{cell(r[3], corn)}{cell(r[4], soy)}</tr>'
        for r in est)
    none_names = ", ".join(esc(r[1]) for r in none)
    jsonld = [
        {"@context": "https://schema.org", "@type": "Dataset", "@id": f"{SITE}{path}#dataset",
         "name": f"{name} {PY} ARC-CO benchmark yield estimates by county",
         "description": (f"Olympic average of USDA NASS county yields {MYA_YEARS[0]}-{MYA_YEARS[-1]} (all practices) for "
                         f"{len(est)} {name} counties, with benchmark revenue at the {PY} benchmark price. "
                         "An estimate: FSA's official benchmark adds a T-yield plug and trend adjustment and uses RMA data first."),
         "url": f"{SITE}{path}", "isAccessibleForFree": True, "license": "https://creativecommons.org/licenses/by/4.0/",
         "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE},
         "isBasedOn": "https://quickstats.nass.usda.gov/", "dateModified": D["updated"][:10],
         "spatialCoverage": {"@type": "Place", "name": f"{name}, United States"},
         "variableMeasured": ["ARC-CO benchmark yield estimate (bu/acre)", "ARC-CO benchmark revenue ($/acre)"]},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "ARC vs PLC 2027", "item": f"{SITE}/arc-plc"},
            {"@type": "ListItem", "position": 3, "name": f"{name}", "item": f"{SITE}{path}"}]},
    ]
    others = " &middot; ".join(f'<a href="/arc-plc/{x["slug"]}">{esc(x["n"])}</a>' for x in nav_states if x["slug"] != sl)
    rel = [f'<a href="/arc-plc">ARC vs PLC {PY} calculator</a>']
    for d_, lab in (("rent", "cash rent by county"), ("yield", "yield by year")):
        if os.path.exists(os.path.join(ROOT, d_, f"{sl}.html")):
            rel.append(f'<a href="/{d_}/{sl}">{esc(name)} {lab}</a>')
    if os.path.exists(os.path.join(ROOT, "farmland-atlas", sl, "index.html")):
        rel.append(f'<a href="/farmland-atlas/{sl}/">{esc(name)} Farmland Atlas</a>')
    body = f"""
<body>
{hdr}
<main class="ap-wrap" id="main">
  <p class="ap-bc"><a href="/arc-plc">ARC vs PLC {PY}</a> &rsaquo; {esc(name)}</p>
  <p class="page-kicker">ARC-CO &middot; {PY} crop year</p>
  <h1>{esc(name)} ARC-CO benchmark yields for {PY}, by county</h1>
  <p class="page-lede">Our estimate of each county&rsquo;s {PY} ARC-CO benchmark yield for corn and soybeans: the Olympic average of USDA NASS
  county yields for {MYA_YEARS[0]} to {MYA_YEARS[-1]}. <b>FSA&rsquo;s official benchmark can differ</b>; it uses RMA data first, a plug yield and a
  trend adjustment. Your county FSA office has the official number. {asof(D['updated'])}</p>
  <div class="ap-quick"><p><b>{PY} prices that apply in every county.</b> Effective reference price: corn {usd(corn['erp']['erp'])}, soybeans {usd(soy['erp']['erp'])}.
  ARC-CO benchmark price: corn {usd(corn['bp']['value'])}, soybeans {usd(soy['bp']['value'])}. At the county&rsquo;s benchmark yield, ARC-CO pays when the
  season-average price ends at {c2(trigger_c(corn))} or lower for corn and {c2(trigger_c(soy))} or lower for soybeans.</p></div>
  <h2 id="counties">Benchmark yield and revenue by county</h2>
  <p class="ap-small">Benchmark yield in bu/acre. Benchmark revenue in $/acre. Max payment = 12% of benchmark revenue on 85% of base, per base acre.</p>
  <div class="ap-scroll"><table class="tbl ap-t ap-st">
    <thead><tr><th rowspan="2">County</th><th colspan="3" class="ap-grp">Corn</th><th colspan="3" class="ap-grp">Soybeans</th></tr>
    <tr><th class="num">Yield</th><th class="num">Revenue</th><th class="num">Max/base ac</th><th class="num">Yield</th><th class="num">Revenue</th><th class="num">Max/base ac</th></tr></thead>
    <tbody>{rows}</tbody></table></div>
  {f'<p class="ap-small">Counties with no estimate (NASS did not publish all five years {MYA_YEARS[0]} to {MYA_YEARS[-1]}, or none): {none_names}. Use your official FSA benchmark in the <a href="/arc-plc">calculator</a>.</p>' if none else ''}
  <p class="ap-small">Wheat: AGSIST has no NASS county wheat yields, so no wheat estimate is shown. The calculator takes your official wheat benchmark.</p>
  <h2 id="crossover">PLC vs ARC-CO break-even price at the benchmark yield</h2>
  <p>When the county yield comes in right at its benchmark, which program pays more depends on the season-average price and on your farm&rsquo;s
  PLC yield compared with the county benchmark. That makes the break-even the same in every {esc(name)} county. Corn:</p>
  {crossover_table(corn)}
  <p>Soybeans:</p>
  {crossover_table(soy)}
  <p class="ap-small">Per base acre, both programs on 85% of base. Read your PLC yield off the FSA-156EZ. A county yield below benchmark favors ARC-CO.</p>
  <p class="ap-disc">An estimate, not a USDA determination. <a href="{FSA_PAGE}" rel="noopener">FSA ARC/PLC</a> &middot; <a href="{OFFICE}" rel="noopener">Find your county office</a></p>
  <p class="ap-small">Related: {' &middot; '.join(rel)}</p>
  <h2>Other states</h2>
  <p class="ap-states">{others}</p>
</main>
"""
    page = head(title, desc, path, jsonld, indexable, fonts) + body + tail(ftr)
    return page, {"path": path, "indexable": indexable, "title": title, "desc": desc}


def county_page(st, S, r, D, ch):
    hdr, ftr, fonts = ch
    name, sl = S["n"], S["slug"]
    cname, cslug = r[1], r[2]
    path = f"/arc-plc/{sl}/{cslug}"
    title = next((t for t in (f"{cname}, {st} ARC vs PLC 2027 Benchmark Yield | AGSIST",
                              f"{cname}, {st} ARC-CO Benchmark 2027 | AGSIST",
                              f"{cname}, {st} ARC-CO Benchmark 2027") if len(t) <= 60),
                 f"{cname}, {st} ARC-CO 2027")
    est = {}
    for crop, v in (("corn", r[3]), ("soybeans", r[4])):
        if isinstance(v, dict) and "by" in v:
            est[crop] = v
    first = "corn" if "corn" in est else "soybeans"
    bits = [f"{CROP_LC[k]} {bu(v['by'])} bu" for k, v in est.items()]
    desc = (f"{cname}, {name}: estimated {PY} ARC-CO benchmark yield {', '.join(bits)}. Benchmark revenue, guarantee, "
            f"max payment and the PLC vs ARC break-even price.")
    if len(desc) > 155:
        desc = f"{cname}, {name}: estimated {PY} ARC-CO benchmark yield {', '.join(bits)}, plus the PLC vs ARC break-even price."
    if len(desc) > 155:
        desc = f"{cname}, {st}: estimated {PY} ARC-CO benchmark yield {', '.join(bits)}, and the PLC vs ARC break-even."
    blocks = []
    ds_vars = []
    for crop, v in est.items():
        cd = D["crops"][crop]
        m = county_metrics(v["by"], cd)
        avg, lo, hi = olympic(v["y"])
        ys = []
        lo_d = hi_d = False
        for y, val in zip(MYA_YEARS, v["y"]):
            if not lo_d and val == lo:
                ys.append(f"<s>{y}: {val:g}</s>"); lo_d = True
            elif not hi_d and val == hi:
                ys.append(f"<s>{y}: {val:g}</s>"); hi_d = True
            else:
                ys.append(f"{y}: {val:g}")
        blocks.append(f"""
  <h2 id="{crop}">{esc(cd['label'])}: {PY} ARC-CO benchmark in {esc(cname)}</h2>
  <div class="ap-kv">
    <div><span>Benchmark yield (estimate)</span><b>{bu(v['by'])} bu</b></div>
    <div><span>Benchmark price</span><b>{usd(cd['bp']['value'])}</b></div>
    <div><span>Benchmark revenue</span><b>{usd(m['br'])}/ac</b></div>
    <div><span>Guarantee (90%)</span><b>{usd(m['g'])}/ac</b></div>
    <div><span>Max payment (12%)</span><b>{usd(m['max'])}/ac</b></div>
    <div><span>Max per base acre (&times;85%)</span><b>{usd(m['max_base'])}</b></div>
  </div>
  <p class="ap-math">NASS county yields: {' &middot; '.join(ys)} (struck: high and low, dropped). Middle three average: <b>{bu(avg)} bu</b>.</p>
  <p>At a season-average price equal to the {PY} effective reference price ({usd(cd['erp']['erp'])}), PLC pays nothing and ARC-CO pays when the
  county yield comes in below <b>{bu(m['trig_y'])} bu</b>, reaching its cap below <b>{bu(m['cap_y'])} bu</b>.</p>
  <h3>PLC vs ARC-CO break-even at a {bu(v['by'])} bu county yield</h3>
  {crossover_table(cd, v['by'])}""")
        ds_vars.append(f"{CROP_LC[crop]} ARC-CO benchmark yield estimate (bu/acre)")
    jsonld = [
        {"@context": "https://schema.org", "@type": "Dataset", "@id": f"{SITE}{path}#dataset",
         "name": f"{cname}, {name} {PY} ARC-CO benchmark yield estimate",
         "description": (f"Olympic average of USDA NASS county yields {MYA_YEARS[0]}-{MYA_YEARS[-1]} for {cname}, {name}, with benchmark "
                         f"revenue, guarantee and maximum payment at the {PY} benchmark price. An estimate; FSA's official benchmark can differ."),
         "url": f"{SITE}{path}", "isAccessibleForFree": True, "license": "https://creativecommons.org/licenses/by/4.0/",
         "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE},
         "isBasedOn": "https://quickstats.nass.usda.gov/", "dateModified": D["updated"][:10],
         "spatialCoverage": {"@type": "Place", "name": f"{cname}, {name}, United States"},
         "variableMeasured": ds_vars},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "ARC vs PLC 2027", "item": f"{SITE}/arc-plc"},
            {"@type": "ListItem", "position": 3, "name": name, "item": f"{SITE}/arc-plc/{sl}"},
            {"@type": "ListItem", "position": 4, "name": cname, "item": f"{SITE}{path}"}]},
    ]
    atlas = os.path.exists(os.path.join(ROOT, "farmland-atlas", sl, f"{cslug}.html")) or \
        os.path.exists(os.path.join(ROOT, "farmland-atlas", sl, cslug, "index.html"))
    rel = [f'<a href="/arc-plc/{sl}">All {esc(name)} counties</a>', f'<a href="/arc-plc">ARC vs PLC {PY} calculator</a>']
    if atlas:
        rel.append(f'<a href="/farmland-atlas/{sl}/{cslug}">{esc(cname)} in the Farmland Atlas</a>')
    missing = [CROP_LC[k] for k in ("corn", "soybeans") if k not in est]
    miss_txt = (f'<p class="ap-small">No {" or ".join(missing)} estimate: NASS did not publish all five county yields {MYA_YEARS[0]} to {MYA_YEARS[-1]}. '
                f'Type the official FSA benchmark into the calculator.</p>') if missing else ""
    body = f"""
<body>
{hdr}
<main class="ap-wrap" id="main">
  <p class="ap-bc"><a href="/arc-plc">ARC vs PLC {PY}</a> &rsaquo; <a href="/arc-plc/{sl}">{esc(name)}</a> &rsaquo; {esc(cname)}</p>
  <p class="page-kicker">ARC-CO &middot; {PY} crop year</p>
  <h1>{esc(cname)}, {st}: ARC or PLC for {PY}</h1>
  <p class="page-lede">Estimated {PY} ARC-CO benchmark yields for {esc(cname)}, {esc(name)}, from USDA NASS county yields.
  <b>This is our estimate. FSA&rsquo;s official benchmark can differ</b>: it uses RMA data first, raises low years to 80% of the T-yield and adds a
  trend adjustment. Your county FSA office has the official number; type it into the calculator below. {asof(D['updated'])}</p>
  {''.join(blocks)}
  {miss_txt}
  <p class="ap-small">Break-even prices are per base acre with both programs on 85% of base, the {PY} ERP of {usd(D['crops'][first]['erp']['erp'])}
  and benchmark price of {usd(D['crops'][first]['bp']['value'])} for {CROP_LC[first]}. Your PLC yield is on the FSA-156EZ.</p>
  {form_html(D, first, st, r[0])}
  <p class="ap-disc">An estimate, not a USDA determination. <a href="{FSA_PAGE}" rel="noopener">FSA ARC/PLC</a> &middot; <a href="{OFFICE}" rel="noopener">Find your county office</a></p>
  <p class="ap-small">Related: {' &middot; '.join(rel)}</p>
</main>
"""
    page = head(title, desc, path, jsonld, True, fonts) + body + tail(ftr, calc=True)
    return page, {"path": path, "indexable": True, "title": title, "desc": desc}


def embed_page(D):
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><!-- embed target; canonical tool is /arc-plc -->
<link rel="canonical" href="{SITE}/arc-plc">
<title>ARC or PLC for {PY} | AGSIST</title>
<link rel="icon" type="image/x-icon" href="/img/favicon.ico">
<link rel="stylesheet" href="/components/styles.css?v={STYLES_V}">
<link rel="stylesheet" href="/components/asof.css?v={ASOF_V}">
<link rel="stylesheet" href="/components/arc-plc.css?v={CALC_V}">
<script>try{{var m=/[?&]theme=(dark|light)/.exec(location.search);document.documentElement.setAttribute('data-theme',m?m[1]:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));}}catch(e){{}}</script>
<style>body{{margin:0;background:var(--bg)}}.ap-wrap{{padding:12px 12px 8px}}</style>
</head>
<body>
<main class="ap-wrap ap-embed" id="main">
{form_html(D, embed=True)}
<p class="ap-small">An estimate, not a USDA determination. Prices and the full math at <a href="{SITE}/arc-plc" target="_blank" rel="noopener">agsist.com/arc-plc</a>.</p>
</main>
<script src="/components/asof.js?v={ASOF_V}" defer></script>
<script src="/components/arc-plc.js?v={CALC_V}" defer></script>
<script>
(function(){{function post(){{try{{parent.postMessage({{agsist:'arc-plc',height:document.body.scrollHeight}},'*');}}catch(e){{}}}}
window.addEventListener('load',post);document.addEventListener('arcplc:render',post);
if(window.ResizeObserver){{try{{new ResizeObserver(post).observe(document.body);}}catch(e){{}}}}}})();
</script>
</body>
</html>
"""


def sitemap(urls, lastmod):
    body = "".join(f"  <url><loc>{SITE}{u}</loc><lastmod>{lastmod}</lastmod><changefreq>monthly</changefreq><priority>{p}</priority></url>\n"
                   for u, p in urls)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{body}</urlset>\n'


# ---------------------------------------------------------------- build
def render_all(D):
    """-> {relative path: content}"""
    ch = chrome()
    out = {}
    out[OUT_JSON] = json.dumps(D, separators=(",", ":"), ensure_ascii=False) + "\n"
    main, meta = build_main(D, ch)
    out[OUT_MAIN] = main
    out[OUT_EMBED] = embed_page(D)
    urls = [("/arc-plc", "0.8")]
    nav_states = sorted([x for x in D["states"].values() if x["n_est"]], key=lambda x: x["n"])
    stats = {"states": 0, "states_indexed": 0, "counties": 0, "skipped": 0, "meta": meta, "examples": {}}
    for st, S in sorted(D["states"].items()):
        if not S["n_est"]:
            stats["skipped"] += len(S["c"])
            continue
        page, m = state_page(st, S, D, ch, nav_states)
        out[f"{OUT_DIR}/{S['slug']}.html"] = page
        stats["states"] += 1
        if m["indexable"]:
            stats["states_indexed"] += 1
            urls.append((m["path"], "0.6"))
        stats["examples"].setdefault("state", m)
        for r in S["c"]:
            if not r[5]:
                stats["skipped"] += 1
                continue
            page, m = county_page(st, S, r, D, ch)
            out[f"{OUT_DIR}/{S['slug']}/{r[2]}.html"] = page
            stats["counties"] += 1
            urls.append((m["path"], "0.5"))
            stats["examples"].setdefault("county", m)
    out[OUT_SITEMAP] = sitemap(urls, D["updated"][:10])
    llms = llms_line(D)
    if llms:
        out["llms.txt"] = llms
    return out, stats


LLMS_PREFIX = "- [ARC or PLC for 2027](https://agsist.com/arc-plc):"


def llms_line(D, root="."):
    """llms.txt carries the same numbers as the page: rewrite its one ARC/PLC
    line from D, so the two files cannot disagree."""
    p = os.path.join(root, "llms.txt")
    if not os.path.exists(p):
        return None
    cur = open(p, encoding="utf-8").read()
    c, s, w = (D["crops"][k] for k in ("corn", "soybeans", "wheat"))
    d = PARAMS["dates"]
    line = (f"{LLMS_PREFIX} {PY} PLC effective reference prices computed from final USDA NASS season-average prices "
            f"{MYA_YEARS[0]}-{MYA_YEARS[-1]} under the 2025 farm law (corn {usd(c['erp']['erp'])}, soybeans {usd(s['erp']['erp'])}, "
            f"wheat {usd(w['erp']['erp'])}; ARC-CO benchmark prices {usd(c['bp']['value'])}, {usd(s['bp']['value'])}, {usd(w['bp']['value'])}), "
            f"the {PY} signup window ({nice_date(d['y2027_open'])} to {nice_date(d['y2027_close'])}), and a calculator comparing PLC and "
            f"ARC-CO per base acre by price and county yield. Estimated county ARC-CO benchmark yields by state at /arc-plc/<state> and by "
            f"county at /arc-plc/<state>/<county> (e.g. /arc-plc/iowa/story-county); estimates from NASS county yields, not FSA's official benchmarks")
    lines = cur.split("\n")
    for i, ln in enumerate(lines):
        if ln.startswith(LLMS_PREFIX):
            lines[i] = line
            return "\n".join(lines)
    return None


def existing_outputs(root):
    paths = set()
    d = os.path.join(root, OUT_DIR)
    for base, _dirs, files in os.walk(d):
        for f in files:
            if f.endswith(".html"):
                paths.add(os.path.relpath(os.path.join(base, f), root))
    return paths


def main_build(root=".", check=False):
    D = compute(load_inputs(root))
    out, stats = render_all(D)
    stale = []
    for rel, content in out.items():
        p = os.path.join(root, rel)
        cur = open(p, encoding="utf-8").read() if os.path.exists(p) else None
        if cur != content:
            stale.append(rel)
            if not check:
                os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
                with open(p, "w", encoding="utf-8") as f:
                    f.write(content)
    gone = sorted(existing_outputs(root) - set(out))
    for rel in gone:
        stale.append(rel + " (no longer built)")
        if not check:
            os.remove(os.path.join(root, rel))
    if check:
        if stale:
            print(f"[arc-plc] STALE: {len(stale)} file(s), e.g. {stale[:5]}", file=sys.stderr)
            return 1
        print("[arc-plc] OK: outputs match the inputs.")
        return 0
    print(f"[arc-plc] {stats['states']} state pages ({stats['states_indexed']} indexable), "
          f"{stats['counties']} county pages, {stats['skipped']} counties skipped (no estimate); "
          f"{len(stale)} file(s) written, {len(gone)} removed.")
    for k, x in D["crops"].items():
        print(f"[arc-plc] {k}: ERP {x['erp']['erp']} ({x['erp']['binding']}), benchmark price {x['bp']['value']}")
    return 0


# ---------------------------------------------------------------- selftest
def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("ok   " if ok else "FAIL ") + name + (f"  {detail}" if detail and not ok else ""))
        if not ok:
            fails.append(name)

    corn = {2017: 3.36, 2018: 3.61, 2019: 3.56, 2020: 4.53, 2021: 6.00, 2022: 6.54, 2023: 4.55, 2024: 4.24, 2025: 4.16}
    soy = {2017: 9.33, 2018: 8.48, 2019: 8.57, 2020: 10.8, 2021: 13.3, 2022: 14.2, 2023: 12.4, 2024: 10.0, 2025: 10.5}
    wht = {2018: 5.16, 2019: 4.58, 2020: 5.05, 2021: 7.63, 2022: 8.83, 2023: 6.96, 2024: 5.52, 2025: 5.06}

    def win(d, y):
        return [d[k] for k in range(y - 6, y - 1)]

    # published ERPs (2018 law, 85%): 2024 corn 4.01, soy 9.26, wheat 5.50 [FD24]
    ck("ERP 2024 corn 4.01", erp_calc(win(corn, 2024), 3.70, 0.85)["erp"] == 4.01)
    ck("ERP 2024 soybeans 9.26", erp_calc(win(soy, 2024), 8.40, 0.85)["erp"] == 9.26)
    ck("ERP 2024 wheat 5.50 statutory", erp_calc(win(wht, 2024), 5.50, 0.85)["binding"] == "statutory")
    # 2025 law, 88%: 2025 and 2026 corn 4.42, soy 10.71, wheat 6.35 [AFBF26][CWA]
    for y in (2025, 2026):
        ck(f"ERP {y} corn 4.42", erp_calc(win(corn, y), 4.10)["erp"] == 4.42)
        ck(f"ERP {y} soybeans 10.71", erp_calc(win(soy, y), 10.00)["erp"] == 10.71)
    ck("ERP 2026 wheat 6.35", erp_calc(win(wht, 2026), 6.35)["erp"] == 6.35)
    # 2027 by hand: corn (6.00+4.55+4.24)/3 = 4.93 x .88 = 4.3384 -> 4.34
    e = erp_calc(win(corn, 2027), 4.10)
    ck("ERP 2027 corn 4.34, 2025 dropped as low", e["erp"] == 4.34 and e["dropped_low"] == 4.16 and e["dropped_high"] == 6.54, str(e))
    # soy (13.3+12.4+10.5)/3 = 12.0667 x .88 = 10.6187 -> 10.62
    ck("ERP 2027 soybeans 10.62", erp_calc(win(soy, 2027), 10.00)["erp"] == 10.62)
    # wheat (7.63+6.96+5.52)/3 = 6.7033 x .88 = 5.899 < 6.35
    ck("ERP 2027 wheat 6.35", erp_calc(win(wht, 2027), 6.35)["erp"] == 6.35)
    ck("cap 115% binds", erp_calc([10, 10, 10, 10, 10], 4.10)["erp"] == 4.72)
    # benchmark price, program-year ERP floor: 2023 corn 3.98; 2024 4.85/11.12/6.21 [FD24]; 2026 5.03/12.17/6.98 [AFBF26]
    ck("BP 2023 corn 3.98", benchmark_price(win(corn, 2023), 3.70)[0] == 3.98)
    ck("BP 2024 corn 4.85", benchmark_price(win(corn, 2024), 4.01)[0] == 4.85)
    ck("BP 2024 soybeans 11.12", benchmark_price(win(soy, 2024), 9.26)[0] == 11.12)
    ck("BP 2024 wheat 6.21", benchmark_price(win(wht, 2024), 5.50)[0] == 6.21)
    ck("BP 2026 corn 5.03", benchmark_price(win(corn, 2026), 4.42)[0] == 5.03)
    ck("BP 2026 soybeans 12.17", benchmark_price(win(soy, 2026), 10.71)[0] == 12.17)
    ck("BP 2026 wheat 6.98", benchmark_price(win(wht, 2026), 6.35)[0] == 6.98)
    # 2027 by hand: corn floor 4.34 -> 6.00,6.54,4.55,4.34,4.34 -> (6.00+4.55+4.34)/3 = 4.9633
    ck("BP 2027 corn 4.96", benchmark_price(win(corn, 2027), 4.34)[0] == 4.96)
    ck("BP 2027 soybeans 12.11", benchmark_price(win(soy, 2027), 10.62)[0] == 12.11)
    ck("BP 2027 wheat 6.98", benchmark_price(win(wht, 2027), 6.35)[0] == 6.98)
    # county estimate: Chippewa WI corn 170.3,162.0,167.1,181.0,173.1 -> 170.2; a gap withholds
    est, ys = county_estimate({2021: 170.3, 2022: 162.0, 2023: 167.1, 2024: 181.0, 2025: 173.1})
    ck("county estimate Olympic 170.2", est == 170.2)
    est, miss = county_estimate({2021: 52.2, 2022: 47.1, 2024: 43.1, 2025: 49.3})
    ck("county missing a year is withheld, not averaged over four", est is None and miss == [2023])
    # payments
    ck("PLC rate 4.34-4.00 = 0.34", abs(plc_rate(4.34, 4.00, 2.42) - 0.34) < 1e-9)
    ck("PLC rate floored at loan rate", abs(plc_rate(4.34, 2.00, 2.42) - 1.92) < 1e-9)
    ck("PLC rate zero above ERP", plc_rate(4.34, 4.50, 2.42) == 0)
    # ARC: by 180, bp 4.96 -> BR 892.8, G 803.52, cap 107.136; y 162 x 4.00 = 648 -> shortfall 155.52 -> capped
    ck("ARC capped at 12%", abs(arc_rate(180, 4.96, 162, 4.00, 2.42) - 107.136) < 1e-9)
    # y 170 x 4.40 = 748 -> 55.52
    ck("ARC uncapped shortfall", abs(arc_rate(180, 4.96, 170, 4.40, 2.42) - 55.52) < 1e-9)
    ck("ARC zero above guarantee", arc_rate(180, 4.96, 180, 4.47, 2.42) == 0)
    # crossover at BY 170.2, PY 136.16 (80%), corn 2027: PLC wins at 3.59 or lower; ARC 3.60..4.46; none 4.47+
    runs = ranges(4.34, 2.42, 136.16, 170.2, 4.96, 170.2)
    ck("crossover runs plc/arc/none", [x["w"] for x in runs] == ["plc", "arc", "none"], str(runs))
    ck("PLC pays more at 3.59 or lower", plc_below(runs) == 359, str(runs))
    ck("ARC stops at 4.47", runs[-1]["lo"] == 447, str(runs))
    ck("text", ranges_text(runs) == ["PLC pays more at $3.59 or lower.", "ARC-CO pays more from $3.60 to $4.46.",
                                     "Neither pays at $4.47 or higher."], str(ranges_text(runs)))
    # same crossover in any county at the same PY/BY share
    r2 = ranges(4.34, 2.42, 80.0, 100.0, 4.96, 100.0)
    ck("break-even depends only on the PLC/benchmark share", plc_below(r2) == 359, str(r2))
    # no em dash in any rendered sentence
    ck("no em dash in range text", "\u2014" not in " ".join(ranges_text(runs)))
    print(f"\n{'FAIL' if fails else 'OK'}: {len(fails)} failure(s)")
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    os.chdir(ROOT)
    if a.selftest:
        return selftest()
    return main_build(".", check=a.check)


if __name__ == "__main__":
    sys.exit(main())
