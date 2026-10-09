#!/usr/bin/env python3
"""
build_arc_plc.py -- the ARC or PLC decision calculator (2026 and 2027) and its pages.

OFFLINE. Reads committed files only. MACHINE-OWNED OUTPUT: edit this script,
never the files below.

  data/arc-plc.json               what the calculator reads (components/arc-plc.js)
  arc-plc.html                    /arc-plc, the calculator, every key number baked
                                  into the HTML so crawlers see it without JS
  arc-plc/<state>.html            /arc-plc/<state>, FSA's official ARC-CO
                                  benchmark yields for every county in the state
  arc-plc/<state>/<county>.html   /arc-plc/<state>/<county>, one county, with a
                                  printable summary for the FSA office
  embed/arc-plc.html              the embeddable calculator (noindex)
  sitemap-arc-plc.xml             every indexable URL above, lastmod per page
  llms.txt                        its two ARC/PLC lines are rewritten from the data

    python3 scripts/build_arc_plc.py              write everything
    python3 scripts/build_arc_plc.py --check      exit 1 if any output is stale
    python3 scripts/build_arc_plc.py --selftest   hand-checked cases, writes nothing

=============================================================================
WHERE EVERY NUMBER COMES FROM (verified 2026-10-09)
=============================================================================
fsa.usda.gov, federalregister.gov, ecfr.gov and law.cornell.edu are not
reachable from the build sandbox. Program rules were checked through search
results quoting those pages, each against a second source. FSA's own data
files are fetched by .github/workflows/fetch-fsa-arcplc.yml into data/fsa/.

1. FSA OFFICIAL COUNTY DATA (data/fsa/arcco_<PY>_data*.xlsx)
   "ARC-CO trend adjusted yields, benchmark yields and guarantee revenues for
   program year PY", one row per county x sub-county x crop x practice
   ("ARC-CO Yield Designation": All, Irrigated or Nonirrigated). Columns: the
   five window years' trend-adjusted yields (county yield or 80% of T-yield),
   the PY benchmark yield (Olympic average), benchmark price, benchmark
   revenue, guarantee, maximum payment rate, and once the year is settled the
   actual county yield, national price, actual revenue and ARC-CO payment rate.
   The newest program year file is the official benchmark shown everywhere.
   Older files give each county's history (benchmark and payment rate by year).
   The benchmark price in the file must equal the one computed below for the
   same year, or the build refuses (two sources disagreeing in front of a reader).

   2027: FSA has not posted 2027 benchmark yields. Building them FSA's way needs
   the 2021-2025 county yields with 80% T-yield plugs, trend-adjusted to 2027
   with RMA's PY2027 trend factors, which are not published. So the 2027 view
   uses FSA's official 2026 benchmark yield, labeled as such ("the 2027
   benchmark shifts the window one year; FSA posts it later"). No NASS
   estimate is used anywhere: a county with no FSA row gets no page and the
   calculator asks for the benchmark from the county office.

2. PROGRAM RULES. Law: One Big Beautiful Bill Act, Pub. L. 119-21 (2025),
   Title I. FSA rule: Federal Register 2026-00313, Jan 12, 2026 [FR26].
   Definitions at 7 CFR 1412.3 [CFR].
   Statutory reference prices 2025-2030 [FR26][ERS]: corn $4.10 (was $3.70),
     soybeans $10.00 (was $8.40), wheat $6.35 (was $5.50); sorghum $4.40,
     barley $5.45, oats $2.65 [ERS][CWA]. DTN (2026-09-17) printed wheat $6.33;
     FR26, ERS and farmdoc say $6.35, which is used. From 2031: +0.5% a year,
     capped at 113% [FR26]. Iowa State CALT called the ERP cap 113%; the eCFR
     and FSA say 115% (113% is the 2031 escalator cap). 115% is used.
   ERP [CFR]: lesser of 115% of statutory, or greater of statutory and (from
     2025) 88% of the Olympic average national MYA price of the 5 most recent
     crop years. Program year PY uses PY-6..PY-2 (2026: 2020-2024; 2027:
     2021-2025): the lag that reproduces every published ERP in --selftest.
   PLC rate = ERP - max(MYA, loan rate), not below 0; paid on 85% of base x
     the farm's PLC yield [FSAF].
   Loan rates 2026 and later [LOAN]: corn $2.42, soybeans $6.82, wheat $3.72.
   ARC-CO [FR26][FD25]: guarantee 90% of benchmark revenue, payment capped at
     12% of benchmark revenue (2025-2031); benchmark price = Olympic average of
     the same 5 MYAs each raised to the program year's ERP (reproduces FSA's
     published 2023, 2024 and 2026 benchmark prices); actual revenue = county
     yield x max(MYA, loan rate); paid on 85% of base [FSAF]. A farm with
     irrigated and nonirrigated county figures is weighted by the farm's
     historical irrigated percentage, not by what it plants [FSA24][APPX].
   Payment limit [ALA][FR26][DTNL]: $155,000 per person or legal entity,
     indexed to CPI-U; USDA put 2025 at $160,000; the rule's own example shows
     $164,000 (factor 1.059). 2026 and 2027 not announced. Members of LLCs and
     S corporations who are actively engaged each get a limit under the 2025
     law [CCF][UMN]. Sequestration: 5.7% on recent payments [SEQ].
   AGI: $900,000 average AGI limit still applies to ARC and PLC; the 75%-of-
     gross-from-farming exception covers certain conservation and disaster
     programs, not ARC/PLC [CALT][CRS].
   10 base acres: farms with 10 or fewer base acres are not paid, except
     socially disadvantaged, limited resource, veteran and beginning farmers [ERS].
   New base acres (up to 30 million, 2019-2023 plantings, 3.69% cut on new
     acres only) take the farm's existing PLC yield for that crop, or the
     county average PLC yield if the farm has none [FD-BASE][FR26][DTN].
   2026 election: unanimous among producers on the farm; one-time for 2026;
     2027-2031 can be changed crop by crop each year [FR26][CFR71]. Multi-year
     contract 2026-2031 stays valid while farm records and producers do not
     change [FR26 via search].
   Rented ground [CFR54][TAMU]: cash lease, the tenant gets the payment unless
     agreed otherwise; share lease, landlord and tenant share it and both sign.
   SCO [RMA25][HOEV][RMA27]: under the 2025 law SCO can be bought whatever the
     ARC/PLC election, from policies with sales closing on or after July 1,
     2025; for 2026 the 90% band is sold as ECO, SCO goes to 90% in 2027;
     premium support 80%. RMA's 27-SCO summary lists removing the ARC
     restriction as a 2027 endorsement change, so the page says to confirm
     2026 with the agent.
   Enrollment [USDA0915 via DTN]: 2026 Sept 16 to Dec 11, 2026; 2027 Nov 2,
     2026 to Mar 15, 2027. No 2026 election: the 2025 election carries over
     and the farm gets no 2026 payment.

3. PRICES: data/nass/{corn,soy,wheat}-price-my.json, national MYA, final only
   (scope string must say so). 2025 corn ($4.16) and soybeans ($10.50) came
   out at the end of Sept 2026; corn 2025 is the low year and is dropped from
   the 2027 ERP.

Source URLs: SRC below, printed on the page. Stdlib + openpyxl.
"""
import argparse
import datetime as dt
import glob
import html
import io
import json
import math
import os
import re
import sys
import zipfile
from decimal import Decimal, ROUND_HALF_UP

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

SITE = "https://agsist.com"
YEARS = (2026, 2027)
OUT_JSON = "data/arc-plc.json"
OUT_STATE_JSON = "data/arc-plc"
OUT_MAIN = "arc-plc.html"
OUT_DIR = "arc-plc"
OUT_EMBED = "embed/arc-plc.html"
OUT_SITEMAP = "sitemap-arc-plc.xml"
FSA_DIR = "data/fsa"
FINAL_SCOPE = "final only"
STYLES_V = "23"
LOADER_V = "18"
ASOF_V = "1"
CALC_V = "3"
MIN_STATE_COUNTIES = 3
SCEN_YEARS = list(range(2015, 2025))   # years with both an FSA county yield and a price change
MIN_SCEN = 8          # never recommend from fewer scenario years
MIN_GAP = 2.00        # $/base acre: a smaller expected gap is "too close to call" whatever the spread
MIN_STATE_N = 3       # counties a state-year needs to stand in for a county

# ---------------------------------------------------------------- sources
SRC = {
    "FSADATA": ("FSA ARC/PLC program data (official county benchmark files)",
                "https://www.fsa.usda.gov/resources/programs/arc-plc/program-data"),
    "FR26": ("Federal Register 2026-00313, Jan 12, 2026 (FSA rule for the 2025 law)",
             "https://www.federalregister.gov/documents/2026/01/12/2026-00313/changes-to-agriculture-risk-coverage-price-loss-coverage-and-dairy-margin-coverage-programs"),
    "CFR": ("7 CFR 1412.3, definitions (eCFR)",
            "https://www.ecfr.gov/current/title-7/subtitle-B/chapter-XIV/subchapter-B/part-1412/subpart-A"),
    "CFR54": ("7 CFR 1412.54, leases and division of payment (eCFR)",
              "https://www.ecfr.gov/current/title-7/subtitle-B/chapter-XIV/subchapter-B/part-1412/subpart-E/section-1412.54"),
    "ERS": ("USDA ERS, Title I crop commodity program provisions",
            "https://www.ers.usda.gov/topics/farm-economy/farm-commodity-policy/title-i-crop-commodity-program-provisions"),
    "FSAF": ("FSA ARC and PLC fact sheet, Sept 2025",
             "https://www.fsa.usda.gov/sites/default/files/2025-09/FSA_ARC%20&%20PLC_3pg_Fact%20Sheet-SEPT%202025_final.pdf"),
    "FSA24": ("FSA ARC and PLC fact sheet, Dec 2024 (irrigated weighting)",
              "https://www.fsa.usda.gov/sites/default/files/2024-12/fsa_arc_plc_factsheet_1223.pdf"),
    "LOAN25": ("FSA, 2025 national average loan rates",
               "https://www.fsa.usda.gov/sites/default/files/2025-04/2025-National-Average-Loan-Rates_0.pdf"),
    "LOAN": ("FSA, 2026 marketing assistance loan rates (Apr 8, 2026)",
             "https://www.fsa.usda.gov/news-events/news/04-08-2026/usda-announces-2026-marketing-assistance-loan-rates-wheat-feed-grains"),
    "APPX": ("FSA, ARC/PLC contract appendix (benchmark yield rules)",
             "https://www.fsa.usda.gov/sites/default/files/documents/appendix-to-arc_plc-contracts.pdf"),
    "FD24": ("farmdoc daily, Feb 2024 (2024 ERPs and benchmark prices)",
             "https://farmdocdaily.illinois.edu/2024/02/estimated-likelihoods-of-plc-and-arc-co-payments-for-2024.html"),
    "FD25": ("farmdoc daily, Jul 2025 (2025 law, commodity title)",
             "https://farmdocdaily.illinois.edu/2025/07/impacts-of-the-commodity-title-changes-under-the-one-big-beautiful-bill-act-obbba-for-midwestern-farms-in-2025.html"),
    "FDBASE": ("farmdoc daily, Jul 2025 (new base acre provisions)",
               "https://farmdocdaily.illinois.edu/2025/07/the-new-base-acre-provisions-in-the-2025-farm-bill.html"),
    "AFBF26": ("American Farm Bureau Market Intel (2026 ERPs and benchmark prices)",
               "https://www.fb.org/market-intel/risk-management-options-for-2026-corn-soybeans-and-wheat"),
    "ALA": ("Alabama Cooperative Extension, Title I program changes",
            "https://www.aces.edu/blog/topics/crop-production/title-i-commodity-program-changes/"),
    "DTNL": ("DTN, Sept 2, 2026: 2025 payment limit $160,000",
             "https://www.dtnpf.com/agriculture/web/ag/blogs/ag-policy-blog/blog-post/2026/09/02/usda-official-arc-plc-payments-will"),
    "CCF": ("Center for Commercial Agriculture: LLC and S corp payment limits",
            "https://ccf.us/a-big-change/"),
    "CALT": ("Iowa State CALT: new payment limitation and eligibility rules",
             "https://www.calt.iastate.edu/post/usda-issues-new-payment-limitation-and-eligibility-rules"),
    "SEQ": ("Farm CPA Report, sequestration and the 2025 limit",
            "https://www.farmcpareport.com/p/correction-the-2025-arcplc-limit"),
    "TAMU": ("Texas A&M AgriLife, lease payment structures",
             "https://agrilife.org/texasaglaw/2019/03/25/common-agricultural-lease-payment-structures/"),
    "RMA25": ("RMA bulletin MGR-25-006 (2025 law crop insurance changes)",
              "https://www.rma.usda.gov/policy-procedure/bulletins-memos/managers-bulletin/mgr-25-006-one-big-beautiful-bill-act-amendment"),
    "HOEV": ("Sen. Hoeven: RMA implements 2025 law (ECO 90% for 2026)",
             "https://www.hoeven.senate.gov/newsroom/press-releases/hoeven-rma-follows-through-on-one-big-beautiful-bill-implements-enhanced-crop-insurance"),
    "RMA27": ("RMA, 2027 SCO endorsement summary of changes",
              "https://www.rma.usda.gov/sites/default/files/2026-06/SCO%20Endorsement%2027-SCO.pdf"),
    "USDA0915": ("USDA, Sept 15, 2026: 2026 and 2027 ARC/PLC enrollment",
                 "https://www.fsa.usda.gov/news-events/news/09-15-2026/usda-announces-2026-2027-enrollment-key-price-revenue-safety-net"),
    "DTN": ("DTN, Sept 17, 2026: USDA opens ARC/PLC enrollment",
            "https://www.dtnpf.com/agriculture/web/ag/crops/article/2026/09/17/usda-opens-arcplc-enrollment-2026"),
    "CWA": ("Colorado Wheat, 2025 law provisions table",
            "https://coloradowheat.org/wp-content/uploads/FINAL-OBBBA-Agriculture-Provisions-06.09.2025-MA.pdf"),
}
FSA_PAGE = "https://www.fsa.usda.gov/resources/programs/arc-plc"
FSA_DATA = SRC["FSADATA"][1]
OFFICE = "https://offices.sc.egov.usda.gov/locator/app"

PARAMS = {
    "erp_pct": 0.88, "erp_cap_pct": 1.15,
    "arc_guarantee_pct": 0.90, "arc_max_pct": 0.12, "payment_acres_pct": 0.85,
    "payment_limit_base": 155000, "payment_limit_2025": 160000, "sequestration_recent_pct": 0.057,
}
YEAR_INFO = {
    2026: {"open": "2026-09-16", "close": "2026-12-11", "pay_after": "2027-10-01",
           "fut": {"corn": ("corn-dec26", "Dec 2026 corn futures"), "soybeans": ("beans-nov26", "Nov 2026 soybean futures"),
                   "wheat": ("wheat-dec26", "Dec 2026 Chicago wheat futures")},
           "my": {"corn": "Sept 2026 to Aug 2027", "soybeans": "Sept 2026 to Aug 2027", "wheat": "June 2026 to May 2027"}},
    2027: {"open": "2026-11-02", "close": "2027-03-15", "pay_after": "2028-10-01",
           "fut": {"corn": ("corn-dec27", "Dec 2027 corn futures"), "soybeans": ("beans-nov27", "Nov 2027 soybean futures"),
                   "wheat": ("wheat-jul27", "Jul 2027 Chicago wheat futures")},
           "my": {"corn": "Sept 2027 to Aug 2028", "soybeans": "Sept 2027 to Aug 2028", "wheat": "June 2027 to May 2028"}},
}
CROPS = {
    "corn": {"label": "Corn", "statutory": 4.10, "loan": 2.42, "mya": "corn-price-my", "fsa": "Corn",
             "grid": (3.20, 5.20, 0.20), "prior_statutory": 3.70},
    "soybeans": {"label": "Soybeans", "statutory": 10.00, "loan": 6.82, "mya": "soy-price-my", "fsa": "Soybeans",
                 "grid": (8.00, 13.00, 0.50), "prior_statutory": 8.40},
    "wheat": {"label": "Wheat", "statutory": 6.35, "loan": 3.72, "mya": "wheat-price-my", "fsa": "Wheat",
              "grid": (4.50, 7.50, 0.30), "prior_statutory": 5.50},
}
CROP_LC = {"corn": "corn", "soybeans": "soybeans", "wheat": "wheat"}
# 2018 law (crop years 2019-2024): statutory price, 85% escalator; loan rates 2019-2025 [ERS][LOAN25]
LAW2018 = {"corn": (3.70, 2.20), "soybeans": (8.40, 6.20), "wheat": (5.50, 3.38)}
BACKTEST_YEARS = list(range(2019, 2026))
OTHER_STATUTORY = [("Sorghum", 4.40, 3.95, 2.42), ("Barley", 5.45, 4.95, 2.75), ("Oats", 2.65, 2.40, 2.20)]
DESIG = {"all": "all", "irrigated": "irr", "nonirrigated": "non", "non-irrigated": "non"}
DLABEL = {"all": "All practices", "irr": "Irrigated", "non": "Non-irrigated"}

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
FIPS_ST = {"01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "12": "FL",
           "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA",
           "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE",
           "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK",
           "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT",
           "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY"}
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# ---------------------------------------------------------------- math
def rnd(v, k=2):
    """Half away from zero. round(v, 9) first: 4.10 x 1.15 is 4.7149999... in binary."""
    d = Decimal(repr(round(float(v), 9))).quantize(Decimal(1).scaleb(-k), rounding=ROUND_HALF_UP)
    return float(d)


def cents(x):
    """Dollars -> whole cents, half up, the way JS Math.round(x * 100) does for x >= 0."""
    return int(math.floor(x * 100 + 0.5))


def olympic(vals):
    if len(vals) != 5:
        raise ValueError("an Olympic average needs exactly 5 values")
    s = sorted(vals)
    return (s[1] + s[2] + s[3]) / 3.0, s[0], s[4]


def erp_calc(myas, statutory, pct=0.88, cap_pct=1.15):
    avg, lo, hi = olympic(myas)
    pv = rnd(avg * pct)
    cap = rnd(statutory * cap_pct)
    erp = min(cap, max(statutory, pv))
    binding = "cap" if erp == cap and pv > cap else ("formula" if pv > statutory else "statutory")
    return {"olympic_avg": rnd(avg, 4), "dropped_low": lo, "dropped_high": hi, "pct": pct,
            "pct_value": pv, "statutory": statutory, "cap_pct": cap_pct, "cap": cap, "erp": rnd(erp), "binding": binding}


def benchmark_price(myas, erp):
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
    """Which program pays more at each cent of season-average price at county
    yield y. Runs [{w, lo, hi}] in cents, inclusive. The scan stops at
    max(ERP, benchmark price) x 1.5 so no input can make it run long.
    Mirrors AgArcPlc.ranges in components/arc-plc.js (test/arc-plc.test.mjs)."""
    lo_c = cents(loan)
    trig = (g * by * bp / y) if y > 0 else erp
    hi_c = min(int(math.ceil(max(erp, trig) * 100)) + 1, int(math.ceil(max(erp, bp) * 150)))
    runs = []
    for c in range(lo_c, max(hi_c, lo_c) + 1):
        p = c / 100.0
        a = cents(per_base(arc_rate(by, bp, y, p, loan, g, cap), pa))
        b = cents(per_base(plc_rate(erp, p, loan) * plc_y, pa))
        w = "none" if a == 0 and b == 0 else ("same" if a == b else ("plc" if b > a else "arc"))
        if runs and runs[-1]["w"] == w:
            runs[-1]["hi"] = c
        else:
            runs.append({"w": w, "lo": c, "hi": c})
    return runs


def plc_below(runs):
    return runs[0]["hi"] if runs and runs[0]["w"] == "plc" else None


# ---------------------------------------------------------------- scenario engine
def scen_eval(erp, bp, loan, py, parts, center, ratios, price=None):
    """Expected PLC and ARC-CO per base acre across past years.

    parts: [(weight, benchmark_yield, {year: county yield / benchmark})]
    ratios: {year: MYA_t / MYA_t-1}. Scenario year t: price = center x r_t
    (or the reader's own price), county yield = benchmark x d_t, the same
    real year for both, so a short crop and a high price stay together.
    Mirrors AgArcPlc.scenarios in components/arc-plc.js."""
    yrs = [t for t in sorted(ratios) if all(t in p[2] for p in parts)]
    rows = []
    for t in yrs:
        p = price if price is not None else center * ratios[t]
        plc = per_base(plc_rate(erp, p, loan) * py)
        arc = sum(w * per_base(arc_rate(by, bp, by * dy[t], p, loan)) for w, by, dy in parts)
        rows.append({"t": t, "p": p, "plc": plc, "arc": arc})
    n = len(rows)
    out = {"n": n, "years": yrs, "rows": rows}
    if n == 0:
        out["verdict"] = "withheld"
        return out
    mp = sum(r["plc"] for r in rows) / n
    ma = sum(r["arc"] for r in rows) / n
    diffs = [r["plc"] - r["arc"] for r in rows]
    md = mp - ma
    sd = math.sqrt(sum((x - md) ** 2 for x in diffs) / (n - 1)) if n > 1 else 0.0
    se = sd / math.sqrt(n)
    pw = sum(1 for r in rows if cents(r["plc"]) > cents(r["arc"]))
    aw = sum(1 for r in rows if cents(r["arc"]) > cents(r["plc"]))
    band = max(MIN_GAP, 2 * se)
    out.update({"plc": mp, "arc": ma, "diff": md, "se": se, "plc_wins": pw, "arc_wins": aw, "ties": n - pw - aw, "close_band": band})
    if n < MIN_SCEN:
        out["verdict"] = "withheld"
    elif abs(md) < band or (md > 0 and pw <= aw) or (md < 0 and aw <= pw):
        # called only when the expected gap is over twice its uncertainty from
        # the n years (and over MIN_GAP), and the same program paid more in more years
        out["verdict"] = "close"
    else:
        out["verdict"] = "plc" if md > 0 else "arc"
    return out


VWORD = {"plc": "PLC expected to pay more", "arc": "ARC-CO expected to pay more", "close": "too close to call",
         "withheld": "not enough history to say"}


def verdict_line(v):
    """One plain sentence, numbers beside the verdict."""
    if v["verdict"] == "withheld":
        return f"Not enough history to say: {v['n']} past years with both a price and a county yield; we need {MIN_SCEN}."
    nums = (f"expected {usd(v['plc'])} PLC vs {usd(v['arc'])} ARC-CO per base acre; PLC paid more in {v['plc_wins']} of "
            f"{v['n']} past-year scenarios, ARC-CO in {v['arc_wins']}")
    if v["verdict"] == "close":
        return f"Too close to call ({nums}; the gap is under {usd(v['close_band'])})."
    return f"Pick {WORD[v['verdict']]} ({nums})."


# ---------------------------------------------------------------- formatting
def esc(s):
    return html.escape("" if s is None else str(s), quote=True)


def usd(v, k=2):
    return f"${rnd(v, k):,.{k}f}"


def c2(c):
    return f"${c / 100:.2f}"


def bu(v, k=1):
    return f"{rnd(v, k):.{k}f}"


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


# ---------------------------------------------------------------- FSA files
def load_xlsx(path):
    """openpyxl, tolerating the date-typed document properties FSA's files carry."""
    import openpyxl
    try:
        return openpyxl.load_workbook(path, read_only=True, data_only=True)
    except TypeError:
        zin = zipfile.ZipFile(path)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zout:
            for it in zin.infolist():
                data = zin.read(it.filename)
                if it.filename == "docProps/core.xml":
                    data = re.sub(rb"<dcterms:(created|modified)[^>]*>.*?</dcterms:\1>", b"", data, flags=re.S)
                zout.writestr(it, data)
        buf.seek(0)
        return openpyxl.load_workbook(buf, read_only=True, data_only=True)


def _num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_arcco(path):
    """One FSA 'ARC-CO trend adjusted yields, benchmark yields and guarantee
    revenues' workbook -> {py, as_of, file, rows: {(fips, sub, crop, d): {...}}}."""
    wb = load_xlsx(path)
    ws = wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    hi = next(i for i, r in enumerate(rows) if r and str(r[0] or "").strip() == "ST_Cty")
    hdr = [str(h or "").strip() for h in rows[hi]]
    low = [h.lower() for h in hdr]

    def col(pat, exclude=None):
        for i, h in enumerate(low):
            if re.search(pat, h) and not (exclude and re.search(exclude, h)):
                return i
        return None
    years = [(int(m.group(1)), i) for i, h in enumerate(low) if (m := re.match(r"(\d{4}) trend adjusted", h))]
    ib = col(r"bench ?mark(?! price)(?! revenue)", r"price|revenue")
    m = re.match(r"(\d{4})", hdr[ib] if ib is not None else "")
    py = int(m.group(1)) if m else None
    idx = {"by": ib, "bp": col(r"bench ?mark price"), "br": col(r"benchmark revenue"), "g": col(r"guarantee revenue"),
           "max": col(r"maximum payment rate"), "ay": col(r"actual yield"), "np": col(r"national price"),
           "ar": col(r"actual revenue"), "pay": col(r"arc-co payment rate")}
    ic, isub, icrop, ides = low.index("st_cty"), col(r"sub county"), low.index("crop name"), col(r"yield designation")
    icn, isn = col(r"county name"), col(r"state name")
    asof = None
    for src in (ws.title, os.path.basename(path)):
        mm = re.search(r"(20\d\d)[-_ ](\d\d)[-_ ](\d\d)", src)
        if mm:
            asof = f"{mm.group(1)}-{mm.group(2)}-{mm.group(3)}"
            break
    out = {}
    for r in rows[hi + 1:]:
        if not r or not r[ic]:
            continue
        fips = str(r[ic]).strip().zfill(5)
        crop = str(r[icrop] or "").strip()
        d = DESIG.get(str(r[ides] or "").strip().lower())
        if not d or not re.fullmatch(r"\d{5}", fips):
            continue
        sub = str(r[isub] or "").strip() if isub is not None else ""
        rec = {k: _num(r[i]) if i is not None else None for k, i in idx.items()}
        rec["yrs"] = {y: _num(r[i]) for y, i in years}
        rec["county"] = str(r[icn] or "").strip() if icn is not None else ""
        rec["state"] = str(r[isn] or "").strip() if isn is not None else ""
        out[(fips, sub, crop, d)] = rec
    return {"py": py, "as_of": asof, "file": os.path.relpath(path), "rows": out, "years": [y for y, _ in years]}


def load_fsa(root="."):
    files = {}
    for p in sorted(glob.glob(os.path.join(root, FSA_DIR, "arcco_*.xls*"))):
        try:
            f = parse_arcco(p)
        except Exception as e:  # pragma: no cover
            print(f"[arc-plc] WARN could not read {p}: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        if f["py"] and (f["py"] not in files or (f["as_of"] or "") > (files[f["py"]]["as_of"] or "")):
            files[f["py"]] = f
    return files


def load_plc_county(root="."):
    """FSA average PLC yield by county (enrolled base), newest program year file."""
    best = None
    for p in sorted(glob.glob(os.path.join(root, FSA_DIR, "plc_county_yields_py*.xls*"))):
        m = re.search(r"py(\d{4})", p)
        if m and (best is None or int(m.group(1)) > best[0]):
            best = (int(m.group(1)), p)
    if not best:
        return None
    wb = load_xlsx(best[1])
    rows = list(wb.worksheets[0].iter_rows(values_only=True))
    hi = next(i for i, r in enumerate(rows) if r and "PLC Yield" in [str(x or "").strip() for x in r])
    hdr = [str(h or "").strip() for h in rows[hi]]
    ist, ico, icr, iy = hdr.index("State"), hdr.index("County"), hdr.index("Crop Name"), hdr.index("PLC Yield")
    want = {"CORN": "corn", "SOYBEANS": "soybeans", "WHEAT": "wheat"}
    out, base = {}, {}
    for r in rows[hi + 1:]:
        if not r or r[ist] is None:
            continue
        crop = want.get(str(r[icr] or "").strip().upper())
        y = _num(r[iy])
        if crop and y:
            f = str(r[ist]).zfill(2) + str(r[ico]).zfill(3)
            out.setdefault(f, {})[crop] = round(y, 1)
            b = _num(r[hdr.index("ENROLLED BASE (PLC+ARC_CO+ARC_IC)")]) if "ENROLLED BASE (PLC+ARC_CO+ARC_IC)" in hdr else None
            if b:
                base.setdefault(f, {})[crop] = b
    return {"py": best[0], "file": os.path.relpath(best[1]), "yields": out, "base": base}


def load_fsa_tables(root="."):
    """FSA's national tables: projected 2026/27 MYA (USDA's projection) and
    the official 2026 ERP. -> {date, proj: {crop: price}, erp: {crop: price}} or None."""
    out = {"proj": {}, "erp": {}, "date": None}
    want = {v["fsa"]: k for k, v in CROPS.items()}
    for fn, key in (("2026_MYA", "proj"), ("2026_ERP", "erp")):
        ps = glob.glob(os.path.join(root, FSA_DIR, fn + "*.xls*"))
        if not ps:
            continue
        rows = list(load_xlsx(sorted(ps)[-1]).worksheets[0].iter_rows(values_only=True))
        for r in rows[:4]:
            for v in r or ():
                m = re.match(r"([A-Z][a-z]+) (\d{1,2}), (20\d\d)", str(v or ""))
                if m and not out["date"]:
                    out["date"] = dt.datetime.strptime(m.group(0), "%B %d, %Y").date().isoformat()
        hdr = next((r for r in rows if r and r[0] == "Commodity"), None)
        for r in rows:
            k = want.get(str((r or [None])[0] or "").strip())
            if not k:
                continue
            if key == "proj":
                i = next(i for i, h in enumerate(hdr) if h and "Projected" in str(h) and "2026/27 MYA" in str(h))
                if str(r[i + 1] or "").strip() == "P" and _num(r[i]):
                    out["proj"][k] = _num(r[i])
            else:
                out["erp"][k] = _num(r[-1])
    return out if (out["proj"] or out["erp"]) else None


# ---------------------------------------------------------------- loading
def _read(root, rel):
    with open(os.path.join(root, rel), encoding="utf-8") as f:
        return json.load(f)


def load_inputs(root="."):
    inp = {"mya": {}, "mya_meta": {}}
    for crop, c in CROPS.items():
        d = _read(root, f"data/nass/{c['mya']}.json")
        if FINAL_SCOPE not in d.get("scope", ""):
            raise SystemExit(f"{c['mya']}.json scope does not say '{FINAL_SCOPE}'; refusing a forecast price")
        inp["mya"][crop] = {int(k): float(v) for k, v in d["values"].items()}
        inp["mya_meta"][crop] = {"file": f"data/nass/{c['mya']}.json", "updated": d.get("updated")}
    inp["counties"] = _read(root, "farmland-atlas/data/counties-index.json")
    inp["fsa"] = load_fsa(root)
    inp["plc_county"] = load_plc_county(root)
    inp["fsa_tables"] = load_fsa_tables(root)
    return inp


# ---------------------------------------------------------------- compute
def year_params(inp, py):
    out = {}
    win = list(range(py - 6, py - 1))
    for crop, c in CROPS.items():
        mya = inp["mya"][crop]
        miss = [y for y in win if y not in mya]
        if miss:
            raise SystemExit(f"{crop}: no final MYA for {miss}; the {py} ERP cannot be computed")
        ys = [mya[y] for y in win]
        e = erp_calc(ys, c["statutory"], PARAMS["erp_pct"], PARAMS["erp_cap_pct"])
        bp, used, blo, bhi = benchmark_price(ys, e["erp"])
        fk, fl = YEAR_INFO[py]["fut"][crop]
        out[crop] = {"label": c["label"], "statutory": c["statutory"], "loan": c["loan"], "prior_statutory": c["prior_statutory"],
                     "mya": {str(y): v for y, v in zip(win, ys)}, "erp": e,
                     "bp": {"value": bp, "used": {str(y): v for y, v in zip(win, used)}, "dropped_low": blo, "dropped_high": bhi},
                     "futures": {"key": fk, "label": fl}, "my": YEAR_INFO[py]["my"][crop],
                     "grid": {"lo": c["grid"][0], "hi": c["grid"][1], "step": c["grid"][2]}}
    return {"window": win, **{k: YEAR_INFO[py][k] for k in ("open", "close", "pay_after")}, "crops": out}


def backtest(inp):
    """What each program paid nationally per base acre, year by year, from
    FSA's own files: PLC rate from the ERP and final MYA; ARC-CO from the
    county payment rates in FSA's arcco files, weighted by enrolled base."""
    plc = inp["plc_county"]
    if not plc:
        return None
    nat_py = {}
    for k in CROPS:
        num_ = sum(plc["yields"][f][k] * plc["base"][f][k] for f in plc["base"] if k in plc["base"][f] and k in plc["yields"].get(f, {}))
        den = sum(plc["base"][f][k] for f in plc["base"] if k in plc["base"][f] and k in plc["yields"].get(f, {}))
        nat_py[k] = num_ / den if den else None
    by_crop = {v["fsa"]: k for k, v in CROPS.items()}
    arc = {}
    for py_, f in inp["fsa"].items():
        per = {}
        for (fips, sub, crop, d), r in f["rows"].items():
            k = by_crop.get(crop)
            if k and r["pay"] is not None:
                per.setdefault((k, fips), []).append(r["pay"])
        for k in CROPS:
            ws = [(sum(v) / len(v), plc["base"].get(fips, {}).get(k)) for (kk, fips), v in per.items() if kk == k]
            ws = [(a, b) for a, b in ws if b]
            if ws:
                arc[(py_, k)] = (per_base(sum(a * b for a, b in ws) / sum(b for _a, b in ws)), len(ws))
    rows = []
    for y in BACKTEST_YEARS:
        for k in CROPS:
            mya = inp["mya"][k]
            win = [mya.get(t) for t in range(y - 6, y - 1)]
            if None in win or y not in mya:
                continue
            if y <= 2024:
                stat, loan = LAW2018[k]
                erp = erp_calc(win, stat, 0.85, 1.15)["erp"]
            else:
                stat, loan = CROPS[k]["statutory"], LAW2018[k][1]
                erp = erp_calc(win, stat, 0.88, 1.15)["erp"]
            rate = rnd(plc_rate(erp, mya[y], loan))
            a = arc.get((y, k))
            rows.append({"y": y, "k": k, "erp": erp, "mya": mya[y], "rate": rate,
                         "plc": per_base(rate * nat_py[k]) if nat_py[k] else None,
                         "arc": a[0] if a else None, "arc_n": a[1] if a else 0})
    return {"rows": rows, "nat_py": nat_py, "plc_py": plc["py"]}


def compute(inp):
    years = {str(py): year_params(inp, py) for py in YEARS}
    fsa = inp["fsa"]
    primary = fsa.get(2026)
    history_pys = sorted(fsa)
    by_crop = {v["fsa"]: k for k, v in CROPS.items()}
    # FSA's benchmark price must equal ours for the same year
    if primary:
        for (fips, sub, crop, d), rec in primary["rows"].items():
            k = by_crop.get(crop)
            if k and rec["bp"] is not None and abs(rec["bp"] - years["2026"]["crops"][k]["bp"]["value"]) > 0.005:
                raise SystemExit(f"FSA 2026 benchmark price for {crop} is {rec['bp']}, ours "
                                 f"{years['2026']['crops'][k]['bp']['value']}: refusing to publish two answers")
    idx = {r[0]: r for r in inp["counties"]}
    counties = {}
    plc = inp["plc_county"]
    # OFFICIAL mode: rows of FSA's 2026 file. PENDING mode (no 2026 file yet):
    # the county x crop x practice rows FSA's older files list, with no
    # benchmark (by = None); pages then print only FSA's history and the
    # county average PLC yield, never a current benchmark, trigger or crossover in bushels.
    keys = sorted(primary["rows"]) if primary else sorted({k for hp in history_pys for k in fsa[hp]["rows"]})
    for key in keys:
        fips, sub, crop, d = key
        k = by_crop.get(crop)
        rec = primary["rows"][key] if primary else None
        if not k or (primary and rec["by"] is None):
            continue
        st = FIPS_ST.get(fips[:2])
        if not st:
            continue
        if True:
            cname = rec["county"] if rec else next(fsa[hp]["rows"][key]["county"] for hp in history_pys if key in fsa[hp]["rows"])
            c = counties.setdefault(fips, {"f": fips, "st": st, "n": cname, "k": {}})
            ent = {"d": d, "by": rec["by"] if rec else None, "yrs": {str(y): v for y, v in rec["yrs"].items()} if rec else {}}
            if sub:
                ent["sub"] = sub
            hist = []
            for hp in history_pys:
                h = fsa[hp]["rows"].get((fips, sub, crop, d))
                if h and h["by"] is not None:
                    hist.append({"py": hp, "by": h["by"], "bp": h["bp"], "ay": h["ay"], "np": h["np"], "pay": h["pay"]})
            ent["hist"] = hist
            # county yield / benchmark for each past year, from FSA's own files:
            # the five window years of each program year, against that year's benchmark
            dy = {}
            for hp in history_pys:
                h = fsa[hp]["rows"].get((fips, sub, crop, d))
                if not h or not h["by"]:
                    continue
                for t, v in h["yrs"].items():
                    if v is not None and t in SCEN_YEARS and (t not in dy or hp > dy[t][1]):
                        dy[t] = (v / h["by"], hp)
            ent["dy"] = {t: round(v, 4) for t, (v, _hp) in sorted(dy.items())}
            ent["dsrc"] = "county"
            c["k"].setdefault(k, []).append(ent)
    states = {}
    for fips, c in counties.items():
        r = idx.get(fips)
        if r:
            name, _st = r[1].rsplit(", ", 1)
            parts = r[2].strip("/").split("/")
            c["n"], c["s"], ss = name, parts[2], parts[1]
        else:
            nm = c["n"] + (" County" if not re.search(r"(County|Parish|Borough|city|City)$", c["n"]) else "")
            c["n"], c["s"], ss = nm, slugify(nm), slugify(STATE_NAMES[c["st"]])
        S = states.setdefault(c["st"], {"n": STATE_NAMES[c["st"]], "slug": ss, "c": []})
        S["c"].append(c)
    for S in states.values():
        S["c"].sort(key=lambda x: x["n"])
    # a county with fewer than MIN_SCEN years of its own takes its state's
    # average for that crop and practice, year by year (MIN_STATE_N counties)
    pool = {}
    for c in counties.values():
        for k, es in c["k"].items():
            for e in es:
                if len(e["dy"]) >= MIN_SCEN:
                    for t, v in e["dy"].items():
                        pool.setdefault((c["st"], k, e["d"], t), []).append(v)
    for c in counties.values():
        for k, es in c["k"].items():
            for e in es:
                if len(e["dy"]) < MIN_SCEN:
                    sdy = {t: round(sum(v) / len(v), 4) for t in SCEN_YEARS
                           if len(v := pool.get((c["st"], k, e["d"], t), [])) >= MIN_STATE_N}
                    if len(sdy) >= MIN_SCEN:
                        e["dy"], e["dsrc"] = sdy, "state"
    # scenario prices: USDA's projected 2026/27 MYA (FSA's table) x each past year's MYA change
    tabs = inp.get("fsa_tables")
    if tabs:
        for k, v in tabs["erp"].items():
            if abs(v - years["2026"]["crops"][k]["erp"]["erp"]) > 0.005:
                raise SystemExit(f"FSA's 2026 ERP for {k} is {v}, ours {years['2026']['crops'][k]['erp']['erp']}: refusing two answers")
    for y in years:
        for k, cd in years[y]["crops"].items():
            mya = inp["mya"][k]
            ratios = {t: round(mya[t] / mya[t - 1], 4) for t in SCEN_YEARS if t in mya and (t - 1) in mya}
            proj = (tabs or {}).get("proj", {}).get(k)
            cd["scen"] = ({"center": proj, "center_date": nice_date(tabs["date"]), "ratios": ratios} if proj else None)
    plc_all = inp["plc_county"]["yields"] if inp["plc_county"] else {}
    for c in counties.values():
        c["verdicts"] = {}
        for k, es in c["k"].items():
            pyv = plc_all.get(c["f"], {}).get(k)
            for i, e in enumerate(es):
                if not e["by"] or not pyv:
                    continue
                if pyv > e["by"]:
                    # FSA's county average PLC yield covers all practices; above this
                    # practice's benchmark it does not describe a typical farm here
                    for y in years:
                        c["verdicts"][(k, i, y)] = {"verdict": "mismatch", "py": pyv, "by": e["by"], "n": 0}
                    continue
                for y in years:
                    cd = years[y]["crops"][k]
                    if not cd.get("scen"):
                        continue
                    v = scen_eval(cd["erp"]["erp"], cd["bp"]["value"], cd["loan"], pyv, [(1.0, e["by"], e["dy"])],
                                  cd["scen"]["center"], cd["scen"]["ratios"])
                    c["verdicts"][(k, i, y)] = v
    plc = inp["plc_county"]
    updated = max([m["updated"] or "" for m in inp["mya_meta"].values()] + [(primary or {}).get("as_of") or ""])
    return {
        "updated": updated,
        "years": years,
        "default_year": {"until": YEAR_INFO[2026]["close"], "then": 2027, "before": 2026},
        "params": PARAMS,
        "fsa": ({"py": primary["py"], "as_of": primary["as_of"], "file": primary["file"], "window": primary["years"],
                 "history": [{"py": hp, "as_of": fsa[hp]["as_of"], "file": fsa[hp]["file"]} for hp in history_pys]}
                if primary else None),
        "plc_county": ({"py": plc["py"], "file": plc["file"]} if plc else None),
        "_backtest": backtest(inp),
        "states": states,
        "_plc_yields": plc["yields"] if plc else {},
        "sources": {k: {"name": v[0], "url": v[1]} for k, v in SRC.items()},
        "links": {"fsa": FSA_PAGE, "fsa_data": FSA_DATA, "office": OFFICE},
    }


def calc_json(D):
    """The calculator's files: a small main file (years, params, the state
    list) and one file per state with its counties, loaded when a state is
    picked, so a phone never downloads the whole country."""
    per = {}
    for code, S in D["states"].items():
        per[code] = {"st": code, "n": S["n"], "c": [
            {"f": c["f"], "n": c["n"], "s": c["s"],
             "k": {k: [{kk: v for kk, v in e.items() if kk in ("d", "by", "sub", "dy", "dsrc")} for e in es if e["by"]] for k, es in c["k"].items()
                   if any(e["by"] for e in es)},
             **({"plc": D["_plc_yields"][c["f"]]} if c["f"] in D["_plc_yields"] else {})}
            for c in S["c"]]}
    out = {k: v for k, v in D.items() if k not in ("states", "_plc_yields", "_backtest")}
    out["states"] = {code: {"n": S["n"], "slug": S["slug"], "nc": len(S["c"])} for code, S in D["states"].items()}
    return out, per


# ---------------------------------------------------------------- page parts
def chrome():
    try:
        import inject_static_nav as NAV
        return (f'<div id="site-header">{NAV.block("header")}</div>',
                f'<div id="site-footer">{NAV.block("footer")}</div>', NAV.FONT_BLOCK)
    except Exception:  # pragma: no cover
        return ('<div id="site-header"></div>', '<div id="site-footer"></div>', "")


def head(title, desc, path, jsonld, indexable=True, fonts="", og_title=None, og_desc=None):
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
{ld}
</head>"""


def tail(ftr, calc=False):
    s = f"""{ftr}
<script src="/components/asof.js?v={ASOF_V}" defer></script>
<script src="/components/loader.js?v={LOADER_V}" defer></script>"""
    if calc:
        s += f'\n<script src="/components/arc-plc.js?v={CALC_V}" defer></script>'
    return s + "\n</body>\n</html>\n"


def asof(iso, prefix="Data updated"):
    day = (iso or "")[:10]
    if not day:
        return ""
    return (f'<time class="asof" data-asof="" data-asof-prefix="{esc(prefix)}" datetime="{day}">'
            f'{esc(prefix)} {nice_date(day)}</time>')


def src_link(k):
    n, u = SRC[k]
    return f'<a href="{esc(u)}" rel="noopener">{esc(n)}</a>'


def deadlines_html():
    a, b = YEAR_INFO[2026], YEAR_INFO[2027]
    return (f'<div class="ap-dl"><div><span>2026 signup closes</span><b>{nice_date(a["close"])}</b></div>'
            f'<div><span>2027 signup</span><b>{nice_date(b["open"], False)} to {nice_date(b["close"])}</b></div></div>')


def form_html(D, crop="corn", st="", fips="", embed=False):
    chips = "".join(
        f'<button type="button" class="chip" data-crop="{k}" aria-pressed="{"true" if k == crop else "false"}">{esc(v["label"])}</button>'
        for k, v in CROPS.items())
    ychips = "".join(f'<button type="button" class="chip" data-year="{y}" aria-pressed="false">{y}</button>' for y in YEARS)
    return f"""<section class="ap-calc" id="calculator" data-arcplc data-src="/{OUT_JSON}" data-state-src="/{OUT_STATE_JSON}/" data-crop="{esc(crop)}" data-state="{esc(st)}" data-fips="{esc(fips)}"{' data-embed="1"' if embed else ''} aria-labelledby="ap-calc-h">
  <h2 id="ap-calc-h" class="ap-h2">Run your farm&rsquo;s numbers</h2>
  <p class="ap-hint ap-runone">Run each crop on each FSA farm number separately. The election is made crop by crop, farm by farm.</p>
  <div class="ap-row"><div class="ap-crops" role="group" aria-label="Program year">{ychips}</div><div class="ap-crops" role="group" aria-label="Crop">{chips}</div></div>
  <div class="ap-grid">
    <div class="ap-f"><label for="ap-st">State</label><select id="ap-st"><option value="">Pick a state</option></select></div>
    <div class="ap-f"><label for="ap-co">County</label><select id="ap-co" disabled><option value="">Pick a state first</option></select></div>
    <div class="ap-f ap-f-wide" id="ap-prac-f" hidden><label for="ap-prac">Practice</label><select id="ap-prac"></select>
      <p class="ap-hint">FSA has separate irrigated and non-irrigated benchmarks here. A farm with both is weighted by its historical irrigated percentage on FSA&rsquo;s records, not by what you plant this year.</p></div>
    <div class="ap-f" id="ap-share-f" hidden><label for="ap-share">Irrigated share of this farm&rsquo;s base (%)</label><input id="ap-share" type="number" inputmode="decimal" min="0" max="100" step="1" value="50"></div>
    <div class="ap-f"><label for="ap-base">Base acres for this crop</label><input id="ap-base" type="number" inputmode="decimal" min="0" step="0.1" value="100"><p class="ap-hint">From the FSA-156EZ. Base acres are not what you plant; each farm number has its own base.</p></div>
    <div class="ap-f"><label for="ap-py">PLC payment yield (bu/acre)</label><input id="ap-py" type="number" inputmode="decimal" min="0" step="1" placeholder="From your FSA-156EZ"><p class="ap-hint" id="ap-py-hint">On the FSA-156EZ for the farm. Each farm has its own.</p></div>
    <div class="ap-f"><label for="ap-by">ARC-CO benchmark yield (bu/acre)</label><input id="ap-by" type="number" inputmode="decimal" min="0" step="0.01" placeholder="FSA official, from the county"><p class="ap-hint" id="ap-by-hint">Fills in from FSA&rsquo;s official county file when we have it. You can type the number your county office gives you.</p></div>
    <div class="ap-f"><label for="ap-y" id="ap-y-l">Expected county yield (bu/acre)</label><input id="ap-y" type="number" inputmode="decimal" min="0" step="0.1"><p class="ap-hint">County average, not your farm. A normal year often comes in a bit above this.</p></div>
    <div class="ap-f ap-f-wide"><label for="ap-p">Expected season-average price ($/bu)</label><input id="ap-p" type="number" inputmode="decimal" min="0" step="0.01" placeholder="You set this"><p class="ap-hint" id="ap-p-hint">USDA national season-average price for the marketing year, not your local cash price.</p><p class="ap-hint ap-fut" id="ap-fut"></p></div>
  </div>
  <div class="ap-out" id="ap-out" aria-live="polite"></div>
</section>"""


# ---------------------------------------------------------------- main page
def erp_math_html(c):
    e = c["erp"]
    lo_done = hi_done = False
    parts = []
    for y, v in c["mya"].items():
        if not lo_done and v == e["dropped_low"]:
            parts.append(f"<s>{y}: {usd(v)}</s>"); lo_done = True
        elif not hi_done and v == e["dropped_high"]:
            parts.append(f"<s>{y}: {usd(v)}</s>"); hi_done = True
        else:
            parts.append(f"{y}: {usd(v)}")
    if e["binding"] == "statutory":
        verdict = (f'88% of the average is {usd(e["pct_value"])}, below the {usd(e["statutory"])} statutory price, '
                   f'so the statutory price holds: <b>{usd(e["erp"])}</b>.')
    elif e["binding"] == "cap":
        verdict = f'88% of the average is {usd(e["pct_value"])}, above the cap, so the cap holds: <b>{usd(e["erp"])}</b>.'
    else:
        verdict = (f'88% of that is <b>{usd(e["erp"])}</b>, above the {usd(e["statutory"])} statutory price and under '
                   f'the {usd(e["cap"])} cap (115%).')
    return (f'<p class="ap-math"><b>{esc(c["label"])}.</b> Season-average prices {" &middot; ".join(parts)} (struck: the high and low year). '
            f'Average of the middle three: {usd(e["olympic_avg"], 4)}. {verdict}</p>')


def bp_math_html(c):
    return (f'<p class="ap-math"><b>{esc(c["label"])}.</b> ' + " &middot; ".join(
        f"{y}: {usd(v)}" + (f" (raised from {usd(c['mya'][y])})" if v != c["mya"][y] else "") for y, v in c["bp"]["used"].items())
        + f'. Drop the high ({usd(c["bp"]["dropped_high"])}) and low ({usd(c["bp"]["dropped_low"])}); the middle three average <b>{usd(c["bp"]["value"])}</b>.</p>')


def worked_example(D):
    c = D["years"]["2027"]["crops"]["corn"]
    erp, bp, loan = c["erp"]["erp"], c["bp"]["value"], c["loan"]
    by, py_, base, y, p = 180.0, 150.0, 100.0, 162.0, 4.00
    pr, ar = plc_rate(erp, p, loan), arc_rate(by, bp, y, p, loan)
    br = by * bp
    g = 0.9 * br
    txt = " ".join(ranges_text(ranges(erp, loan, py_, by, bp, y)))
    return f"""<ol class="ap-steps">
  <li><b>PLC.</b> Rate = {usd(erp)} &minus; {usd(p)} = <b>{usd(pr)}/bu</b>. Per base acre: {usd(pr)} &times; {py_:.0f} bu PLC yield &times; 85% = <b>{usd(per_base(pr * py_))}</b>.</li>
  <li><b>ARC-CO.</b> Benchmark revenue = {by:.0f} bu &times; {usd(bp)} = {usd(br)}. Guarantee (90%) = {usd(g)}. Actual revenue = {y:.0f} bu &times; {usd(p)} = {usd(y * p)}.
  Shortfall {usd(g - y * p)}, capped at 12% of benchmark ({usd(0.12 * br)}): <b>{usd(ar)} per acre</b> before the 85% factor; <b>{usd(per_base(ar))}</b> per base acre.</li>
  <li><b>On 100 base acres:</b> PLC {usd(per_base(pr * py_) * base, 0)}, ARC-CO {usd(per_base(ar) * base, 0)}, before the 5.7% sequestration cut.</li>
  <li><b>Where they cross at a {y:.0f} bu county yield:</b> {esc(txt)}</li>
</ol>"""


def faq_items(D):
    y6, y7 = D["years"]["2026"]["crops"], D["years"]["2027"]["crops"]
    return [
        ("Should I pick ARC or PLC for 2026 or 2027?",
         f"It comes down to where the season-average price lands and how your county yields. PLC pays when the national price ends below "
         f"the effective reference price (2027 est.: {usd(y7['corn']['erp']['erp'])} corn, {usd(y7['soybeans']['erp']['erp'])} soybeans, "
         f"{usd(y7['wheat']['erp']['erp'])} wheat). ARC-CO pays when county revenue falls below 90% of its benchmark, so it helps more when "
         f"the county yield drops while the price holds. The calculator gives a verdict for your farm (pick PLC, pick ARC-CO, or too close to call) with "
         f"the expected payment per base acre for each, figured across past years' prices and your county's yields."),
        ("What is the 2027 effective reference price for corn?",
         f"{usd(y7['corn']['erp']['erp'])} per bushel by our math from final USDA prices (est.): 88% of the 2021 to 2025 Olympic average "
         f"season-average price, above the {usd(y7['corn']['statutory'])} statutory price. Soybeans {usd(y7['soybeans']['erp']['erp'])}, "
         f"wheat {usd(y7['wheat']['erp']['erp'])}. For 2026 the figures are {usd(y6['corn']['erp']['erp'])}, {usd(y6['soybeans']['erp']['erp'])} "
         f"and {usd(y6['wheat']['erp']['erp'])}, matching published FSA-based figures. FSA publishes the official 2027 numbers."),
        ("When is the ARC/PLC deadline?",
         f"2026: September 16 to December 11, 2026. 2027: November 2, 2026 to March 15, 2027. The 2026 deadline comes first."),
        ("What happens if I don't enroll?",
         "For 2026, a farm with no election by December 11, 2026 keeps its 2025 election but gets no 2026 payment. "
         "Keeping your old choice still takes a signed contract."),
        ("Can I sign a multi-year contract?",
         "Yes, for 2026 through 2031. It stays in force while the farm's records and producers do not change. The 2026 election "
         "itself must be unanimous among the producers on the farm; from 2027 the election can be changed crop by crop in each year's signup."),
        ("How is ARC-CO paid?",
         "ARC-CO compares county revenue (county yield times the higher of the national season-average price or the loan rate) with 90% "
         "of the county benchmark revenue. The shortfall is paid, up to 12% of benchmark revenue, on 85% of your base acres. A farm with "
         "irrigated and non-irrigated county figures is weighted by its historical irrigated percentage."),
        ("Can I buy SCO if I pick ARC?",
         "Under the 2025 law, yes: SCO is no longer tied to your ARC or PLC election. For 2026 the coverage up to 90% is sold as ECO; "
         "SCO itself goes to 90% in 2027. Confirm the details for your crop with your crop insurance agent."),
        ("Who gets the payment on rented ground?",
         "On a cash lease the tenant gets the ARC or PLC payment unless the two agree otherwise. On a share lease the landlord and tenant "
         "split it by their shares, and both sign the contract."),
        ("When do the payments come?",
         "After the marketing year ends and USDA publishes the season-average price: after October 1, 2027 for 2026 crops and after "
         "October 1, 2028 for 2027 crops."),
        ("What is the ARC/PLC payment limit?",
         "$155,000 per person or legal entity in the 2025 law, adjusted for inflation; USDA put 2025 at $160,000. The 2026 and 2027 figures "
         "are not out. The limit is per person across all crops and farms."),
    ]


def tally_sentence(D):
    t = {}
    for S in D["states"].values():
        for c in S["c"]:
            for (k, i, y), v in c["verdicts"].items():
                if y == "2026" and k == "corn":
                    t[v["verdict"]] = t.get(v["verdict"], 0) + 1
    n = t.get("plc", 0) + t.get("arc", 0) + t.get("close", 0)
    if not n:
        return ""
    return (f'<p><b>For a typical farm, 2026 corn:</b> our scenarios call ARC-CO in {t.get("arc", 0):,} county and practice combinations, PLC in '
            f'{t.get("plc", 0):,}, and too close to call in {t.get("close", 0):,} of {n:,}. Your own PLC yield moves the answer; the calculator below gives yours, '
            f'with the expected payments. <a href="#method">How this is figured</a>.</p>')


def method_html(D):
    """How the verdict is figured, the scenario inputs, the county tally, and the back-test."""
    y6 = D["years"]["2026"]["crops"]
    if not all(c.get("scen") for c in y6.values()):
        return ('<h2 id="method">How the ARC or PLC verdict is figured</h2><p>Not available: FSA&rsquo;s table with USDA&rsquo;s projected '
                'season-average price is not loaded, so there is no center for the price scenarios.</p>')
    yrs = sorted(int(t) for t in y6["corn"]["scen"]["ratios"])
    rat = "".join(f'<tr><th scope="row">{t}</th>' + "".join(f'<td class="num">{y6[k]["scen"]["ratios"][t]:.3f}</td>' for k in CROPS) + "</tr>" for t in yrs)
    tally = {}
    for S in D["states"].values():
        for c in S["c"]:
            for (k, i, y), v in c["verdicts"].items():
                if y == "2026":
                    tally.setdefault(k, {}).setdefault(v["verdict"], 0)
                    tally[k][v["verdict"]] += 1
    tl = "".join(f'<tr><th scope="row">{y6[k]["label"]}</th>' + "".join(f'<td class="num">{tally.get(k, {}).get(w, 0):,}</td>' for w in ("plc", "arc", "close", "withheld", "mismatch")) + "</tr>"
                 for k in CROPS)
    bt = D.get("_backtest")
    btab = ""
    if bt:
        rows = "".join(
            f'<tr><td>{r["y"]}</td><td>{y6[r["k"]]["label"]}</td><td class="num">{usd(r["erp"])}</td><td class="num">{usd(r["mya"])}</td>'
            f'<td class="num">{usd(r["rate"]) if r["rate"] else "none"}</td><td class="num">{usd(r["plc"]) if r["plc"] else "none"}</td>'
            f'<td class="num">{(usd(r["arc"]) if r["arc"] else "none") if r["arc"] is not None else "n/a"}</td></tr>' for r in bt["rows"])
        btab = (f'<h3 id="backtest">What each program paid, nationally, per base acre</h3>'
                f'<div class="ap-scroll"><table class="tbl ap-t"><thead><tr><th>Year</th><th>Crop</th><th class="num">ERP</th><th class="num">Final MYA</th>'
                f'<th class="num">PLC rate</th><th class="num">PLC $/base ac</th><th class="num">ARC-CO $/base ac</th></tr></thead><tbody>{rows}</tbody></table></div>'
                f'<p class="ap-small">PLC: ERP minus the final season-average price (NASS), never below the loan rate, times FSA&rsquo;s {bt["plc_py"]} national average PLC yield '
                f'(corn {bt["nat_py"]["corn"]:.1f}, soybeans {bt["nat_py"]["soybeans"]:.1f}, wheat {bt["nat_py"]["wheat"]:.1f} bu, weighted by enrolled base) times 85%. 2019 to 2024 use the '
                f'2018 law (statutory $3.70, $8.40, $5.50; 85% escalator); 2025 the 2025 law. ARC-CO: FSA&rsquo;s county payment rates from its program year files, '
                f'irrigated and non-irrigated averaged equally where FSA splits a county, weighted by each county&rsquo;s enrolled base, times 85%. n/a: FSA&rsquo;s county file for that '
                f'program year is not in our data (2021 and 2022 are). National averages hide wide county differences.</p>')
    c6 = y6["corn"]["scen"]
    return f"""<h2 id="method">How the ARC or PLC verdict is figured</h2>
  <p>The verdict compares what each program is expected to pay per base acre across past years, not one guess. Every scenario is a real year:</p>
  <ul class="ap-list">
    <li><b>Price.</b> Center: USDA&rsquo;s projected 2026/27 season-average price as printed in FSA&rsquo;s table of {c6['center_date']} (corn {usd(y6['corn']['scen']['center'])},
    soybeans {usd(y6['soybeans']['scen']['center'])}, wheat {usd(y6['wheat']['scen']['center'])}). Each scenario moves it by one past year&rsquo;s actual change in the final
    season-average price (NASS), {yrs[0]} to {yrs[-1]}. That is a year-to-year change, wider than what is still unknown about 2026/27 in October: we could not source enough years of
    USDA&rsquo;s October projections against the final price. A wider band makes &ldquo;too close to call&rdquo; more likely, not less. 2027 uses the same center and spread. The October 2026
    WASDE came out today and is not loaded here.</li>
    <li><b>County yield.</b> For the same year, the county&rsquo;s yield against its benchmark, from FSA&rsquo;s own files: the five window years in the program year 2021 file
    ({yrs[0]} to 2019) and the 2026 file (2020 to {yrs[-1]}), each divided by that file&rsquo;s benchmark. FSA&rsquo;s yields already have the 80% T-yield floor and trend adjustment.
    A county with fewer than {MIN_SCEN} years uses its state&rsquo;s average for that crop and practice (at least {MIN_STATE_N} counties a year).</li>
    <li><b>Pairing.</b> Price and yield come from the same real year, so a short crop and a high price stay together.</li>
    <li><b>When we call it.</b> Only with at least {MIN_SCEN} years, when the expected gap is more than twice its uncertainty from those years and at least {usd(MIN_GAP)} per base acre,
    and the same program paid more in more years. Otherwise &ldquo;too close to call&rdquo;, with the numbers.</li>
    <li><b>Typical farm</b> (county pages): FSA&rsquo;s county average PLC yield and FSA&rsquo;s official benchmark, non-irrigated first. Where the county average PLC yield is above a practice&rsquo;s
    benchmark (it covers all practices), no typical verdict is given for that practice.</li>
  </ul>
  <h3>Price changes used ({len(yrs)} years)</h3>
  <div class="ap-scroll"><table class="tbl ap-t"><thead><tr><th>Year</th>{''.join(f'<th class="num">{y6[k]["label"]}</th>' for k in CROPS)}</tr></thead><tbody>{rat}</tbody></table></div>
  <p class="ap-small">Final season-average price that year divided by the year before (USDA NASS).</p>
  <h3>Typical-farm verdicts for 2026, all counties</h3>
  <div class="ap-scroll"><table class="tbl ap-t"><thead><tr><th>Crop</th><th class="num">PLC</th><th class="num">ARC-CO</th><th class="num">Too close</th><th class="num">Too few years</th><th class="num">No typical farm</th></tr></thead><tbody>{tl}</tbody></table></div>
  <p class="ap-small">County and practice combinations. Your own PLC yield moves the answer; run it.</p>
  {btab}"""


def build_main(D, ch):
    hdr, ftr, fonts = ch
    y6, y7 = D["years"]["2026"]["crops"], D["years"]["2027"]["crops"]
    c7, s7, w7 = y7["corn"], y7["soybeans"], y7["wheat"]
    faq = faq_items(D)
    fsa = D["fsa"]
    n_c = sum(len(S["c"]) for S in D["states"].values())
    title = "ARC vs PLC 2026 and 2027 Calculator | AGSIST"
    desc = (f"Est. 2027 effective reference prices: corn {usd(c7['erp']['erp'])}, soybeans {usd(s7['erp']['erp'])}, wheat "
            f"{usd(w7['erp']['erp'])}. " + ("FSA official county benchmarks. " if fsa else "Bring your county's FSA benchmark. ") + "2026 signup ends Dec 11.")
    og_title = f"ARC or PLC: est. 2027 corn ERP {usd(c7['erp']['erp'])}, soybeans {usd(s7['erp']['erp'])}"
    jsonld = [
        {"@context": "https://schema.org", "@type": "WebApplication", "@id": f"{SITE}/arc-plc#app",
         "name": "ARC or PLC: 2026 and 2027 decision calculator", "url": f"{SITE}/arc-plc",
         "applicationCategory": "FinanceApplication", "operatingSystem": "Any (web browser)",
         "isAccessibleForFree": True, "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
         "description": desc, "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE}, "dateModified": D["updated"][:10]},
        {"@context": "https://schema.org", "@type": "FAQPage",
         "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]},
        {"@context": "https://schema.org", "@type": "Dataset", "@id": f"{SITE}/arc-plc#data",
         "name": "PLC effective reference prices and ARC-CO benchmark prices 2026 and 2027, with FSA county benchmark yields",
         "description": ("Effective reference prices and ARC-CO benchmark prices computed from USDA NASS final season-average prices under "
                         "7 CFR 1412.3 as amended for the 2025 law, plus FSA's official ARC-CO county benchmark yields"
                         + (f" for program year {fsa['py']} ({n_c} counties)." if fsa else ".")),
         "url": f"{SITE}/arc-plc", "isAccessibleForFree": True, "license": "https://creativecommons.org/licenses/by/4.0/",
         "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE},
         "isBasedOn": ["https://quickstats.nass.usda.gov/", FSA_DATA, SRC["FR26"][1]],
         "distribution": {"@type": "DataDownload", "encodingFormat": "application/json", "contentUrl": f"{SITE}/{OUT_JSON}"},
         "temporalCoverage": "2020/2027", "dateModified": D["updated"][:10]},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "Tools", "item": f"{SITE}/tools"},
            {"@type": "ListItem", "position": 3, "name": "ARC vs PLC", "item": f"{SITE}/arc-plc"}]},
    ]
    erp_rows = "".join(
        f'<tr><th scope="row">{esc(y7[k]["label"])}</th><td class="num">{usd(y6[k]["erp"]["erp"])}</td><td class="num"><b>{usd(y7[k]["erp"]["erp"])}</b></td>'
        f'<td class="num">{usd(y6[k]["bp"]["value"])}</td><td class="num">{usd(y7[k]["bp"]["value"])}</td><td class="num">{usd(y7[k]["statutory"])}</td>'
        f'<td class="num">{usd(y7[k]["prior_statutory"])}</td><td class="num">{usd(y7[k]["loan"])}</td></tr>' for k in CROPS)
    other_rows = "".join(
        f'<tr><th scope="row">{n}</th><td class="num mut" colspan="4">not computed</td><td class="num">{usd(p1)}</td><td class="num">{usd(p0)}</td><td class="num">{usd(l)}</td></tr>'
        for n, p1, p0, l in OTHER_STATUTORY)
    faq_html = "".join(f"<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>" for q, a in faq)
    state_links = " &middot; ".join(f'<a href="/arc-plc/{S["slug"]}">{esc(S["n"])}</a>'
                                    for _k, S in sorted(D["states"].items(), key=lambda kv: kv[1]["n"]))
    srcs = "".join(f"<li>{src_link(k)}</li>" for k in SRC)
    fsa_line = (f"FSA&rsquo;s official ARC-CO benchmark yields for program year {fsa['py']} (FSA file as of {nice_date(fsa['as_of'])}) cover "
                f"{n_c:,} counties." if fsa else "FSA&rsquo;s official county benchmark file is not loaded yet; type the benchmark your county office gives you.")
    body = f"""
<body>
{hdr}
<main class="ap-wrap" id="main">
  <p class="page-kicker">Farm program &middot; 2026 and 2027 crop years</p>
  <h1>ARC or PLC for 2026 and 2027: decision calculator</h1>
  {deadlines_html()}
  <div class="ap-quick" id="quick-answer">
    <p><b>Quick answer.</b> By our math from final USDA prices, the 2027 PLC effective reference prices are <b>{usd(c7['erp']['erp'])}</b> for corn,
    <b>{usd(s7['erp']['erp'])}</b> for soybeans and <b>{usd(w7['erp']['erp'])}</b> for wheat (2026: {usd(y6['corn']['erp']['erp'])},
    {usd(y6['soybeans']['erp']['erp'])}, {usd(y6['wheat']['erp']['erp'])}). PLC pays if the national season-average price ends below that.
    ARC-CO pays when county revenue falls below 90% of its benchmark. The 2026 signup closes Dec 11, 2026; the 2027 signup runs Nov 2, 2026 to Mar 15, 2027.</p>
    {tally_sentence(D)}
    <p class="ap-small">{fsa_line} {asof(D['updated'])}</p>
  </div>
  <p class="page-lede">Pick the year, crop and county, type your PLC yield, and set a price. The table shows which program pays more per base acre across
  a range of prices and county yields. It does not forecast the price. You set it.</p>

  {form_html(D)}

  <div class="ap-faq-sections">
  <h2 id="dates">When is the ARC/PLC signup for 2026 and 2027?</h2>
  <ul class="ap-list">
    <li><b>2026:</b> Sept 16 to Dec 11, 2026. The 2026 election must be unanimous among the producers on the farm.</li>
    <li><b>2027:</b> Nov 2, 2026 to Mar 15, 2027. From 2027 you can change the election crop by crop in each year&rsquo;s signup.</li>
    <li><b>Multi-year contract, 2026 through 2031:</b> one signature covers the years, and it stays in force while the farm&rsquo;s records and producers do not change.
    What it saves is paperwork; the yearly chance to switch programs from 2027 on still applies through the annual election. If the operator, owners or farm records change, it ends and you enroll yearly.
    Some advisers prefer signing each year so nothing is assumed.</li>
    <li><b>If you don&rsquo;t sign:</b> for 2026, a farm with no election by Dec 11, 2026 keeps its 2025 election and gets no 2026 payment.</li>
    <li><b>When payments come:</b> after Oct 1, 2027 for 2026 crops; after Oct 1, 2028 for 2027 crops.</li>
  </ul>

  </div>
  <h2 id="erp">2026 and 2027 effective reference prices</h2>
  <div class="ap-scroll"><table class="tbl ap-t">
    <thead><tr><th>Crop</th><th class="num">2026 ERP</th><th class="num">2027 ERP (est.)</th><th class="num">2026 ARC price</th><th class="num">2027 ARC price (est.)</th><th class="num">Statutory now</th><th class="num">Before 2025</th><th class="num">Loan rate</th></tr></thead>
    <tbody>{erp_rows}{other_rows}</tbody>
  </table></div>
  <p class="ap-small">$ per bushel. ERP = PLC effective reference price. ARC price = ARC-CO benchmark price. Est. = our math from final USDA prices; FSA publishes the
  official 2027 figures. 2026 figures match those published by FSA-based sources{" and FSA&rsquo;s 2026 county file" if fsa else ""}.</p>
  <details class="ap-det"><summary>Show the math for 2027</summary>
  <p>The effective reference price is the lesser of 115% of the statutory price, or the greater of the statutory price and 88% of the
  Olympic average season-average price for the five most recent crop years (2021 to 2025 for 2027; 2020 to 2024 for 2026).</p>
  {''.join(erp_math_html(x) for x in y7.values())}
  <p>The ARC-CO benchmark price uses the same five years, with any year below the 2027 effective reference price raised to it:</p>
  {''.join(bp_math_html(x) for x in y7.values())}
  </details>

  <div class="ap-faq-sections">
  <h2 id="changed">What changed for 2026 and 2027?</h2>
  <p class="ap-small">As of {nice_date(D['updated'][:10])}. The 2025 law (One Big Beautiful Bill Act, Pub. L. 119-21) and FSA&rsquo;s January 2026 rule:</p>
  <ul class="ap-list">
    <li><b>Higher reference prices:</b> corn $3.70 to $4.10, soybeans $8.40 to $10.00, wheat $5.50 to $6.35, for 2025 through 2030.</li>
    <li><b>Effective reference price:</b> 88% of the Olympic average (was 85%), capped at 115% of statutory.</li>
    <li><b>ARC-CO:</b> guarantee 90% of benchmark revenue (was 86%); payments up to 12% of benchmark (was 10%).</li>
    <li><b>New base acres:</b> up to 30 million, from 2019 to 2023 plantings, cut 3.69% on the new acres only. New base takes the farm&rsquo;s existing PLC yield for that crop, or the county average PLC yield if the farm has none.</li>
    <li><b>2025 only:</b> farms got the higher of ARC-CO or PLC automatically. That does not carry into 2026 or 2027.</li>
    <li><b>SCO:</b> no longer tied to the ARC/PLC election; for 2026 the band to 90% is sold as ECO, and SCO goes to 90% in 2027. Ask your crop insurance agent.</li>
    <li><b>Payment limit:</b> $155,000 per person, indexed (2025: $160,000). Actively engaged members of LLCs and S corporations can each carry a limit.</li>
    <li><b>Signup moved:</b> the 2026 window opened Sept 16, 2026, later than the usual spring signup.</li>
  </ul>

  <h2 id="how">How do ARC-CO and PLC pay?</h2>
  <ul class="ap-list">
    <li><b>PLC rate</b> = effective reference price &minus; the higher of the national season-average price or the loan rate. Paid on 85% of base acres &times; your PLC payment yield.</li>
    <li><b>ARC-CO rate</b> = 90% of benchmark revenue &minus; actual county revenue, never more than 12% of benchmark revenue. Paid on 85% of base acres.</li>
    <li><b>Benchmark revenue</b> = FSA county benchmark yield &times; benchmark price. Actual revenue = actual county yield &times; the higher of the season-average price or the loan rate.</li>
  </ul>
  <h3>A worked example (made-up corn farm, 2027 prices)</h3>
  <p>County benchmark yield 180 bu, PLC yield 150 bu, 100 base acres, a county yield of 162 bu and a $4.00 season-average price.</p>
  {worked_example(D)}

  <h2 id="checklist">What should I check before I sign?</h2>
  <ul class="ap-list">
    <li><b>Each crop, each farm number.</b> You elect ARC-CO or PLC crop by crop on each FSA farm. Run them one at a time.</li>
    <li><b>Rented ground.</b> On a cash lease the tenant gets the payment unless agreed otherwise. On a share lease landlord and tenant split it by share and both sign.</li>
    <li><b>10 base acres.</b> A farm with 10 or fewer total base acres gets no payment, unless the producer is socially disadvantaged, limited resource, a veteran or a beginning farmer.</li>
    <li><b>Income rule.</b> The $900,000 average adjusted gross income limit still applies to ARC and PLC. The new exception for those with 75% of gross income from farming covers certain conservation and disaster programs, not ARC or PLC.</li>
    <li><b>Payment limit.</b> Per person across all crops and farms, not per farm. Sequestration (5.7% lately) comes off before the limit.</li>
    <li><b>ARC-IC</b> (individual coverage, whole farm) also exists. This tool does not model it.</li>
  </ul>

  <h2 id="benchmark-yield">Where do I find my county&rsquo;s ARC-CO benchmark yield?</h2>
  <p>{fsa_line} FSA&rsquo;s benchmark is the Olympic average of the county&rsquo;s five most recent yields (2020 to 2024 for 2026), with low years raised to
  80% of the county T-yield and each year trend-adjusted. FSA has not posted 2027 benchmarks; building them needs RMA&rsquo;s 2027 trend factors, which are not out,
  so the 2027 view uses FSA&rsquo;s official 2026 benchmark, labeled. Counties FSA does not list get no page here: ask the county office for
  &ldquo;the ARC-CO benchmark yield for my county, crop and practice&rdquo; or check <a href="{FSA_DATA}" rel="noopener">FSA&rsquo;s program data</a>.</p>
  <p class="ap-states">{state_links}</p>
  </div>

  {method_html(D)}

  <h2 id="faq">Questions farmers ask</h2>
  <div class="ap-faq">{faq_html}</div>

  <p class="ap-disc"><b>This is an estimate, not a USDA determination.</b> Payments depend on FSA&rsquo;s official yields, prices and your farm records.
  Read FSA&rsquo;s <a href="{FSA_PAGE}" rel="noopener">ARC/PLC page</a>, its <a href="{FSA_DATA}" rel="noopener">program data</a>,
  or <a href="{OFFICE}" rel="noopener">find your county FSA office</a>. Dollars are before the 5.7% sequestration cut.
  Run an extension office or co-op site? <a href="/embed#arc-plc">Embed the calculator</a>.</p>
  <details class="ap-det"><summary>Sources</summary><ul class="ap-src">{srcs}<li><a href="https://quickstats.nass.usda.gov/" rel="noopener">USDA NASS Quick Stats</a> (season-average prices)</li></ul></details>
  <p class="ap-small">Related: <a href="/farm-bill">Farm bill tracker</a> &middot; <a href="/presell-calculator">Pre-sell calculator</a> &middot; <a href="/breakeven">Break-even calculator</a> &middot; <a href="/harvest-price-tracker">Harvest price tracker</a></p>
</main>
"""
    return head(title, desc, "/arc-plc", jsonld, True, fonts, og_title=og_title) + body + tail(ftr, calc=True), {
        "title": title, "desc": desc, "og_title": og_title, "faq": [q for q, _ in faq]}


# ---------------------------------------------------------------- state and county pages
RATIOS = (0.6, 0.7, 0.8, 0.9, 1.0)


def county_metrics(by, crop_d):
    bp, erp = crop_d["bp"]["value"], crop_d["erp"]["erp"]
    br = by * bp
    return {"br": br, "g": 0.9 * br, "max": 0.12 * br, "max_base": per_base(0.12 * br),
            "trig_y": 0.9 * br / erp, "cap_y": 0.78 * br / erp}


def trigger_c(crop_d):
    """Highest cent at which ARC-CO pays when county yield = benchmark: price < 90% x benchmark price."""
    return int(math.floor(round(0.9 * crop_d["bp"]["value"] * 100, 6) - 1e-6))


def crossover_table(crop_d, by=None):
    """PLC vs ARC-CO at county yield = benchmark, by PLC yield as % of the
    official benchmark. Depends only on that share, so it holds in any county."""
    erp, loan, bp = crop_d["erp"]["erp"], crop_d["loan"], crop_d["bp"]["value"]
    base_by = by or 100.0
    rows = []
    for r in RATIOS:
        runs = ranges(erp, loan, base_by * r, base_by, bp, base_by)
        below = plc_below(runs)
        arc_runs = [x for x in runs if x["w"] == "arc"]
        arc_txt = f'{c2(arc_runs[0]["lo"])} to {c2(arc_runs[-1]["hi"])}' if arc_runs else "never"
        lab = f"{int(r * 100)}%" + (f"<br><span class=\"mut\">{bu(base_by * r)} bu</span>" if by else "")
        rows.append(f'<tr><td>{lab}</td><td>PLC: {c2(below) + " or lower" if below else "never"}<br>ARC-CO: {arc_txt}</td></tr>')
    return ('<table class="tbl ap-t ap-x"><thead><tr><th>PLC yield, % of your official benchmark</th>'
            '<th>Which pays more, by season-average price</th></tr></thead><tbody>' + "".join(rows) + "</tbody></table>")


def ent_label(e):
    return DLABEL[e["d"]] + (f", {e['sub']}" if e.get("sub") else "")


ASK = ("Ask the county FSA office for &ldquo;the 2026 ARC-CO benchmark yield for my county, crop and practice (irrigated or "
       "non-irrigated)&rdquo;, or look it up in <a href=\"{u}\" rel=\"noopener\">FSA&rsquo;s program data</a> (file: ARC-CO benchmark yields "
       "and revenues, program year 2026). Then type it into the calculator.").format(u=FSA_DATA)


def pending_note(D):
    return (f'<div class="ap-quick ap-pending"><p><b>FSA&rsquo;s official 2026 benchmark yields are not loaded here yet.</b> '
            f'Until they are, this page shows only FSA&rsquo;s own published figures for the county (its history and the county average PLC yield) and '
            f'no current benchmark, trigger yield or break-even in bushels. {ASK}</p></div>')


def hist_table(e):
    hist = [h for h in e.get("hist", []) if h["py"] != 2026]
    if not hist:
        return ""
    rows = "".join(
        f'<tr><td>{h["py"]}</td><td class="num">{h["by"]:.2f}</td><td class="num">{usd(h["bp"]) if h["bp"] else "n/a"}</td>'
        f'<td class="num">{f"{h["ay"]:.2f}" if h["ay"] is not None else "not yet"}</td>'
        f'<td class="num">{("none" if h["pay"] == 0 else usd(h["pay"])) if h["pay"] is not None else "not yet"}</td></tr>' for h in hist)
    return (f'<h3>FSA history, {esc(ent_label(e).lower())}</h3><div class="ap-scroll"><table class="tbl ap-t"><thead><tr><th>Year</th>'
            f'<th class="num">Benchmark</th><th class="num">Price</th><th class="num">County yield</th><th class="num">ARC-CO $/ac</th></tr></thead>'
            f'<tbody>{rows}</tbody></table></div><p class="ap-small">Program year; benchmark yield in bu/acre; benchmark price $/bu; actual county '
            f'yield; ARC-CO payment rate per acre before the 85% factor. All from FSA&rsquo;s files. Older program years use older windows and prices, '
            f'so they are history, not this year&rsquo;s benchmark.</p>')


def state_page(st, S, D, ch, nav_states):
    hdr, ftr, fonts = ch
    name, sl = S["n"], S["slug"]
    y6 = D["years"]["2026"]["crops"]
    fsa = D["fsa"]
    official = bool(fsa)
    indexable = official and len(S["c"]) >= MIN_STATE_COUNTIES
    path = f"/arc-plc/{sl}"
    plcy = D["_plc_yields"]
    plc_py = (D["plc_county"] or {}).get("py")
    if official:
        title = next((t for t in (f"{name} ARC-CO Benchmark Yields 2026, Official | AGSIST",
                                  f"{name} ARC-CO Benchmark Yields 2026 | AGSIST",
                                  f"{name} ARC-CO Benchmarks 2026") if len(t) <= 60), f"{name} ARC-CO 2026")
        desc = (f"FSA official 2026 ARC-CO benchmark yields for {len(S['c'])} {name} counties by crop and practice, with benchmark revenue "
                f"and the PLC vs ARC break-even.")
    else:
        title = next((t for t in (f"{name} ARC or PLC 2026 and 2027 by County | AGSIST", f"{name} ARC or PLC by County | AGSIST")
                      if len(t) <= 60), f"{name} ARC or PLC")
        desc = f"{name} counties: FSA average PLC yields and ARC-CO history, and how to get your official 2026 benchmark."
    rows = []
    for c in S["c"]:
        if not official:
            pv = plcy.get(c["f"], {})
            rows.append(f'<tr><th scope="row"><a href="/arc-plc/{sl}/{c["s"]}">{esc(re.sub(r" (County|Parish)$", "", c["n"]))}</a></th>'
                        + "".join(f'<td class="num">{f"{pv[k]:.1f}" if pv.get(k) else "n/a"}</td>' for k in CROPS) + "</tr>")
            continue
        first = True
        for k in CROPS:
            for e in c["k"].get(k, []):
                link = f'<a href="/arc-plc/{sl}/{c["s"]}">{esc(re.sub(r" (County|Parish)$", "", c["n"]))}</a>' if first else ""
                py_avg = plcy.get(c["f"], {}).get(k)
                if official:
                    m = county_metrics(e["by"], y6[k])
                    cells = (f'<td class="num">{e["by"]:.2f}</td><td class="num">{usd(m["br"], 0)}</td><td class="num">{usd(m["max_base"], 0)}</td>')
                else:
                    cells = f'<td class="num">{f"{py_avg:.1f}" if py_avg else "n/a"}</td>'
                rows.append(f'<tr><th scope="row">{link}</th><td>{esc(y6[k]["label"])}</td><td>{esc(ent_label(e))}</td>{cells}</tr>')
                first = False
    head_cells = ('<th class="num">Yield</th><th class="num">Revenue</th><th class="num">Max/base ac</th>' if official
                  else f'<th class="num">Avg PLC yield{f" ({plc_py})" if plc_py else ""}</th>')
    jsonld = [{"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{SITE}/"},
        {"@type": "ListItem", "position": 2, "name": "ARC vs PLC", "item": f"{SITE}/arc-plc"},
        {"@type": "ListItem", "position": 3, "name": name, "item": f"{SITE}{path}"}]}]
    if official:
        jsonld.insert(0, {"@context": "https://schema.org", "@type": "Dataset", "@id": f"{SITE}{path}#dataset",
                          "name": f"{name} 2026 ARC-CO benchmark yields by county (FSA official)",
                          "description": (f"FSA's official program year 2026 ARC-CO benchmark yields for {len(S['c'])} {name} counties by crop and "
                                          f"practice, with benchmark revenue at the 2026 benchmark price, from FSA's county file as of {fsa['as_of']}."),
                          "url": f"{SITE}{path}", "isAccessibleForFree": True, "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE},
                          "isBasedOn": FSA_DATA, "dateModified": D["updated"][:10],
                          "spatialCoverage": {"@type": "Place", "name": f"{name}, United States"},
                          "variableMeasured": ["ARC-CO benchmark yield (bu/acre)", "ARC-CO benchmark revenue ($/acre)"]})
    others = " &middot; ".join(f'<a href="/arc-plc/{x["slug"]}">{esc(x["n"])}</a>' for x in nav_states if x["slug"] != sl)
    rel = ['<a href="/arc-plc">ARC vs PLC calculator</a>']
    for d_, lab in (("rent", "cash rent by county"), ("yield", "yield by year")):
        if os.path.exists(os.path.join(ROOT, d_, f"{sl}.html")):
            rel.append(f'<a href="/{d_}/{sl}">{esc(name)} {lab}</a>')
    if os.path.exists(os.path.join(ROOT, "farmland-atlas", sl, "index.html")):
        rel.append(f'<a href="/farmland-atlas/{sl}/">{esc(name)} Farmland Atlas</a>')
    lede = (f"FSA&rsquo;s official program year 2026 ARC-CO benchmark yields for {len(S['c'])} {esc(name)} counties, by crop and by practice where "
            f"FSA splits irrigated and non-irrigated. FSA has not posted 2027 benchmarks; the 2027 benchmark shifts the window one year. "
            f"{asof(fsa['as_of'], 'FSA file as of')}" if official else
            f"The {len(S['c'])} {esc(name)} counties FSA lists for corn, soybeans or wheat, with FSA&rsquo;s county average PLC yield. {asof(D['updated'])}")
    table_h = "Official benchmark yield and revenue by county" if official else "County average PLC yields (FSA)"
    table_note = ("Benchmark yield in bu/acre (FSA, 2026). Revenue = yield &times; 2026 benchmark price, $/acre. Max/base ac = 12% of revenue on 85% of base."
                  if official else f"Average PLC payment yield on enrolled base in the county by crop, bu/acre, FSA program year {plc_py}. Your farm&rsquo;s own is on the FSA-156EZ.")
    body = f"""
<body>
{hdr}
<main class="ap-wrap" id="main">
  <p class="ap-bc"><a href="/arc-plc">ARC vs PLC</a> &rsaquo; {esc(name)}</p>
  <p class="page-kicker">ARC-CO and PLC &middot; {"FSA official" if official else "by county"}</p>
  <h1>{esc(name)} {"ARC-CO benchmark yields for 2026, by county" if official else "ARC or PLC by county, 2026 and 2027"}</h1>
  <p class="page-lede">{lede}</p>
  {deadlines_html()}
  {'' if official else pending_note(D)}
  <div class="ap-quick"><p><b>Prices that apply in every county.</b> 2026 effective reference price: corn {usd(y6['corn']['erp']['erp'])}, soybeans {usd(y6['soybeans']['erp']['erp'])},
  wheat {usd(y6['wheat']['erp']['erp'])}. 2026 ARC-CO benchmark price: corn {usd(y6['corn']['bp']['value'])}, soybeans {usd(y6['soybeans']['bp']['value'])}, wheat {usd(y6['wheat']['bp']['value'])}.
  When the county yield comes in at its benchmark, ARC-CO pays when the season-average price ends at {c2(trigger_c(y6['corn']))} or lower for corn,
  {c2(trigger_c(y6['soybeans']))} for soybeans and {c2(trigger_c(y6['wheat']))} for wheat.</p></div>
  <h2 id="counties">{table_h}</h2>
  <p class="ap-small">{table_note}</p>
  <div class="ap-scroll"><table class="tbl ap-t ap-st">
    <thead><tr><th>County</th>{('<th>Crop</th><th>Practice</th>' + head_cells) if official else ''.join(f'<th class="num">{CROPS[k]["label"]}</th>' for k in CROPS)}</tr></thead>
    <tbody>{''.join(rows)}</tbody></table></div>
  <p class="ap-small">A county or crop not listed: FSA&rsquo;s files have nothing for it. {ASK}</p>
  <h2 id="crossover">PLC vs ARC-CO break-even at the benchmark yield</h2>
  <p>When the county yield comes in at its benchmark, which program pays more depends on the season-average price and on your PLC yield as a share of the
  county&rsquo;s official benchmark. Expressed that way, the break-even is the same in every {esc(name)} county. 2026 prices, corn:</p>
  {crossover_table(y6['corn'])}
  <p>Soybeans:</p>
  {crossover_table(y6['soybeans'])}
  <p>Wheat:</p>
  {crossover_table(y6['wheat'])}
  <p class="ap-small">Per base acre, both programs on 85% of base. Your PLC yield is on the FSA-156EZ. A county yield below benchmark favors ARC-CO.</p>
  <p class="ap-disc">An estimate, not a USDA determination. <a href="{FSA_PAGE}" rel="noopener">FSA ARC/PLC</a> &middot; <a href="{FSA_DATA}" rel="noopener">FSA program data</a> &middot; <a href="{OFFICE}" rel="noopener">Find your county office</a></p>
  <p class="ap-small">Related: {' &middot; '.join(rel)}</p>
  <h2>Other states</h2>
  <p class="ap-states">{others}</p>
</main>
"""
    page = head(title, desc, path, jsonld, indexable, fonts) + body + tail(ftr)
    return page, {"path": path, "indexable": indexable, "title": title, "desc": desc}


SHORT = {"plc": "PLC Est. Higher", "arc": "ARC-CO Est. Higher", "close": "Too Close to Call"}


def why_text(v, cd, by, py):
    """2-3 plain sentences, every claim with its number."""
    erp, loan, center = cd["erp"]["erp"], cd["loan"], cd["scen"]["center"]
    max_plc = per_base(plc_rate(erp, 0, loan) * py)
    max_arc = per_base(0.12 * by * cd["bp"]["value"])
    short = sum(1 for r in v["rows"] if r["arc"] > 0)
    return (f"PLC pays on any season-average price below {usd(erp)}, up to {usd(max_plc)} per base acre at the {usd(loan)} loan rate, so it "
            f"protects against a deep price drop. ARC-CO is capped at {usd(max_arc)} per base acre but also pays when the county&rsquo;s "
            f"yield is short; it paid something in {short} of the {v['n']} past-year scenarios. Centered on USDA&rsquo;s {usd(center)} "
            f"projection, PLC is expected to pay {usd(v['plc'])} and ARC-CO {usd(v['arc'])} per base acre.")


def default_entries(es):
    """Non-irrigated (or all practices) first, irrigated after."""
    order = {"non": 0, "all": 0, "irr": 1}
    return sorted(range(len(es)), key=lambda i: (order[es[i]["d"]], es[i].get("sub", "")))


def typical_html(c, k, D, cname):
    """The typical-farm verdict block for one crop, and the headline verdict (2026, default practice)."""
    es = c["k"].get(k) or []
    cd6 = D["years"]["2026"]["crops"][k]
    pyv = D["_plc_yields"].get(c["f"], {}).get(k)
    plc_py = (D["plc_county"] or {}).get("py")
    lines, head_v = [], None
    for i in default_entries(es):
        e = es[i]
        if not e["by"]:
            continue
        v6, v7 = c["verdicts"].get((k, i, "2026")), c["verdicts"].get((k, i, "2027"))
        lab = esc(ent_label(e))
        if not v6:
            continue
        if v6["verdict"] == "mismatch":
            lines.append(f'<p class="ap-small"><b>{lab}:</b> no typical-farm verdict. FSA&rsquo;s average PLC yield for the county ({pyv:.1f} bu) covers '
                         f'all practices and is above this benchmark ({e["by"]:.2f} bu), so it does not describe a typical farm here. Run your own PLC yield below.</p>')
            continue
        if head_v is None and v6["verdict"] in SHORT:
            head_v = (v6, e)
        src = "this county&rsquo;s own FSA yields" if e["dsrc"] == "county" else f"the {esc(STATE_NAMES[c['st']])} average for this crop and practice (the county has fewer than {MIN_SCEN} years)"
        lines.append(f'<div class="ap-verdict ap-w-{v6["verdict"] if v6["verdict"] in ("plc", "arc") else "none"}"><p><b>{lab}, 2026: {verdict_line(v6)}</b></p>'
                     + (f'<p>{why_text(v6, cd6, e["by"], pyv)}</p>' if v6["verdict"] != "withheld" else "")
                     + (f'<p class="ap-small"><b>2027:</b> {verdict_line(v7)} The 2027 view uses FSA&rsquo;s 2026 benchmark; FSA posts 2027 later.</p>' if v7 else "")
                     + f'<p class="ap-small">For a typical farm: FSA&rsquo;s county average PLC yield {pyv:.1f} bu (program year {plc_py}) and the official '
                       f'{e["by"]:.2f} bu benchmark. County yields from {src}. Run your own numbers in the calculator below.</p></div>')
    return "".join(lines), head_v



def quick_county(c, D):
    """Quick answer: each crop's 2026 typical-farm verdict, default practice, numbers beside it."""
    items = []
    for k in CROPS:
        es = c["k"].get(k) or []
        for i in default_entries(es):
            v = c["verdicts"].get((k, i, "2026"))
            if not v or v["verdict"] in ("mismatch",):
                continue
            lab = D["years"]["2026"]["crops"][k]["label"] + ("" if es[i]["d"] == "all" else ", " + DLABEL[es[i]["d"]].lower())
            if v["verdict"] == "withheld":
                items.append(f"<li><b>{esc(lab)}:</b> not enough history to say.</li>")
            else:
                items.append(f"<li><b>{esc(lab)}:</b> {VWORD[v['verdict']]} (est. {usd(v['plc'])} PLC vs {usd(v['arc'])} ARC-CO per base acre; "
                             f"PLC more in {v['plc_wins']} of {v['n']} past-year scenarios, ARC-CO in {v['arc_wins']}).</li>")
            break
    if not items:
        return ""
    return ('<div class="ap-quick" id="quick-answer"><p><b>Quick answer for 2026, for a typical farm in this county.</b> Run your own numbers; '
            'your PLC yield and base can change it.</p><ul class="ap-list">' + "".join(items) + '</ul>'
            '<p class="ap-small">Typical farm = FSA&rsquo;s county average PLC yield and FSA&rsquo;s official benchmark. Prices: USDA&rsquo;s projection moved by '
            'each past year&rsquo;s price change; county yields from the same past years. <a href="/arc-plc#method">How this is figured</a>.</p></div>')


def county_page(st, S, c, D, ch):
    hdr, ftr, fonts = ch
    name, sl = S["n"], S["slug"]
    cname, cslug = c["n"], c["s"]
    path = f"/arc-plc/{sl}/{cslug}"
    y6 = D["years"]["2026"]["crops"]
    fsa = D["fsa"]
    official = bool(fsa)
    plcy = D["_plc_yields"].get(c["f"], {})
    plc_py = (D["plc_county"] or {}).get("py")
    head_crop = next((k for k in CROPS if k in c["k"]), None)
    _th, head_v = typical_html(c, head_crop, D, cname) if official and head_crop else ("", None)
    if official and head_v:
        lab = ("Irrigated " + y6[head_crop]["label"].lower()) if head_v[1]["d"] == "irr" else y6[head_crop]["label"]
        sh = SHORT[head_v[0]["verdict"]]
        title = next((t for t in (f"{cname}, {st} {lab} ARC or PLC 2026: {sh} | AGSIST",
                                  f"{cname}, {st} {lab} 2026: {sh} | AGSIST",
                                  f"{cname}, {st} {lab} 2026: {sh}",
                                  f"{cname} {lab} 2026: {sh}") if len(t) <= 60), f"{cname}, {st} ARC or PLC 2026")
        vv = head_v[0]
        desc = (f"{cname}, {name} {lab.lower()} 2026, typical farm: {VWORD[vv['verdict']]}, est. {usd(vv['plc'])} PLC vs {usd(vv['arc'])} "
                f"ARC-CO per base acre. FSA official benchmarks. Run your numbers.")
        if len(desc) > 155:
            desc = f"{cname}, {st} {lab.lower()} 2026: {VWORD[vv['verdict']]}, est. {usd(vv['plc'])} PLC vs {usd(vv['arc'])} ARC-CO per base acre. Run your numbers."
    elif official:
        title = next((t for t in (f"{cname}, {st} ARC-CO Benchmark Yield 2026 | AGSIST",
                                  f"{cname}, {st} ARC-CO Benchmark 2026 | AGSIST",
                                  f"{cname}, {st} ARC-CO Benchmark 2026") if len(t) <= 60), f"{cname}, {st} ARC-CO 2026")
        bits = [f"{CROP_LC[k]}{'' if e['d'] == 'all' else ' ' + DLABEL[e['d']].lower()} {e['by']:.1f}" for k in CROPS for e in c["k"].get(k, [])]
        desc = f"{cname}, {name}: FSA official 2026 ARC-CO benchmark yields: {', '.join(bits)} bu. Revenue, guarantee and PLC vs ARC break-even."
        if len(desc) > 155:
            desc = f"{cname}, {st}: FSA official 2026 ARC-CO benchmark yields by crop and practice, revenue, guarantee and PLC vs ARC break-even."
    else:
        title = next((t for t in (f"{cname}, {st} ARC or PLC 2026 and 2027 | AGSIST", f"{cname}, {st} ARC or PLC | AGSIST")
                      if len(t) <= 60), f"{cname}, {st} ARC or PLC")
        desc = f"{cname}, {name}: FSA county average PLC yields and ARC-CO history, and how to get the official 2026 benchmark."
    blocks, faqs, ds_vars = [], [], []
    first = next(k for k in CROPS if k in c["k"])
    for k in CROPS:
        es = c["k"].get(k)
        if not es:
            continue
        cd = y6[k]
        th, hv = typical_html(c, k, D, cname) if official else ("", None)
        blocks.append(f'<h2 id="{k}">{esc(cd["label"])} 2026 in {esc(cname)}: {VWORD[hv[0]["verdict"]] if hv else "ARC-CO benchmark and break-even"}</h2>')
        if th:
            blocks.append(th)
            if hv:
                faqs.append((f"Should I pick ARC or PLC for {CROP_LC[k]} in {cname} for 2026?",
                             re.sub(r"<[^>]+>", "", html.unescape(f"For a typical farm ({ent_label(hv[1]).lower()}): {verdict_line(hv[0])} "
                                                                  f"{why_text(hv[0], cd, hv[1]['by'], plcy[k])} Run your own PLC yield and base acres; the answer can change."))))
        if plcy.get(k) and plc_py:
            blocks.append(f'<p>Average PLC yield on enrolled {CROP_LC[k]} base in this county: <b>{plcy[k]:.1f} bu</b> (FSA, program year {plc_py}). '
                          f'Your farm&rsquo;s own is on the FSA-156EZ.</p>')
        for e in es:
            if e["by"] is None:
                blocks.append(f'<h3>{esc(ent_label(e))}</h3><p class="ap-small">Official 2026 benchmark: not loaded here yet. Ask the county office.</p>{hist_table(e)}')
                continue
            m = county_metrics(e["by"], cd)
            yrs = e["yrs"]
            vals = [v for v in yrs.values() if v is not None]
            ys = ""
            if len(vals) == 5:
                _avg, lo, hi = olympic(vals)
                lo_d = hi_d = False
                parts = []
                for y, v in yrs.items():
                    if not lo_d and v == lo:
                        parts.append(f"<s>{y}: {v:g}</s>"); lo_d = True
                    elif not hi_d and v == hi:
                        parts.append(f"<s>{y}: {v:g}</s>"); hi_d = True
                    else:
                        parts.append(f"{y}: {v:g}")
                ys = (f'<p class="ap-math">FSA trend-adjusted county yields (county yield or 80% of T-yield): {" &middot; ".join(parts)} '
                      f'(struck: high and low). Middle three average: <b>{e["by"]:.2f} bu</b>.</p>')
            blocks.append(f"""
  <h3>{esc(ent_label(e))}: official 2026 ARC-CO benchmark</h3>
  <div class="ap-kv">
    <div><span>Benchmark yield (FSA)</span><b>{e['by']:.2f} bu</b></div>
    <div><span>Benchmark price 2026</span><b>{usd(cd['bp']['value'])}</b></div>
    <div><span>Benchmark revenue</span><b>{usd(m['br'])}/ac</b></div>
    <div><span>Guarantee (90%)</span><b>{usd(m['g'])}/ac</b></div>
    <div><span>Max payment (12%)</span><b>{usd(m['max'])}/ac</b></div>
    <div><span>Max per base acre (&times;85%)</span><b>{usd(m['max_base'])}</b></div>
  </div>
  {ys}
  <p>At a season-average price equal to the 2026 effective reference price ({usd(cd['erp']['erp'])}), PLC pays nothing and ARC-CO pays when the
  county yield comes in below <b>{bu(m['trig_y'])} bu</b>, reaching its cap below <b>{bu(m['cap_y'])} bu</b>.</p>
  <h3>PLC vs ARC-CO break-even at a {e['by']:.2f} bu county yield, 2026 prices</h3>
  {crossover_table(cd, e['by'])}
  {hist_table(e)}""")
            ds_vars.append(f"{CROP_LC[k]} {ent_label(e).lower()} ARC-CO benchmark yield (bu/acre)")
        if official and es[0]["by"]:
            faqs.append((f"What is the ARC-CO benchmark yield for {CROP_LC[k]} in {cname}?",
                         f"FSA's official 2026 benchmark yield for {CROP_LC[k]} in {cname}, {name} is "
                         + "; ".join(f"{e['by']:.2f} bu ({ent_label(e).lower()})" for e in es if e["by"])
                         + f". The 2026 benchmark price is {usd(cd['bp']['value'])}. FSA has not posted the 2027 benchmark."))
        elif plcy.get(k) and plc_py:
            faqs.append((f"What is the average PLC yield for {CROP_LC[k]} in {cname}?",
                         f"FSA lists {plcy[k]:.1f} bushels per acre as the average PLC yield on enrolled {CROP_LC[k]} base in {cname}, {name} for program year "
                         f"{plc_py}. Each farm has its own PLC yield, shown on its FSA-156EZ."))
        if not official:
            blocks.append(f"<p>Break-even by PLC yield as a share of the official benchmark (2026 prices):</p>{crossover_table(cd)}")
    faq_html = "".join(f"<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>" for q, a in faqs)
    jsonld = [{"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{SITE}/"},
        {"@type": "ListItem", "position": 2, "name": "ARC vs PLC", "item": f"{SITE}/arc-plc"},
        {"@type": "ListItem", "position": 3, "name": name, "item": f"{SITE}/arc-plc/{sl}"},
        {"@type": "ListItem", "position": 4, "name": cname, "item": f"{SITE}{path}"}]}]
    if faqs:
        jsonld.insert(0, {"@context": "https://schema.org", "@type": "FAQPage",
                          "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faqs]})
    if official:
        jsonld.insert(0, {"@context": "https://schema.org", "@type": "Dataset", "@id": f"{SITE}{path}#dataset",
                          "name": f"{cname}, {name} 2026 ARC-CO benchmark yields (FSA official)",
                          "description": (f"FSA's official program year 2026 ARC-CO benchmark yields for {cname}, {name} by crop and practice, with the "
                                          f"five trend-adjusted yields behind each, benchmark revenue, guarantee, maximum payment and FSA's history."),
                          "url": f"{SITE}{path}", "isAccessibleForFree": True, "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE},
                          "isBasedOn": FSA_DATA, "dateModified": D["updated"][:10],
                          "spatialCoverage": {"@type": "Place", "name": f"{cname}, {name}, United States"}, "variableMeasured": ds_vars})
    atlas = os.path.exists(os.path.join(ROOT, "farmland-atlas", sl, f"{cslug}.html"))
    rel = [f'<a href="/arc-plc/{sl}">All {esc(name)} counties</a>', '<a href="/arc-plc">ARC vs PLC calculator</a>']
    if atlas:
        rel.append(f'<a href="/farmland-atlas/{sl}/{cslug}">{esc(cname)} in the Farmland Atlas</a>')
    missing = [CROP_LC[k] for k in CROPS if k not in c["k"]]
    miss_txt = f'<p class="ap-small">Nothing from FSA here for {" or ".join(missing)}. {ASK}</p>' if missing else ""
    share = f"{SITE}{path}"
    lede = (f"FSA&rsquo;s official 2026 ARC-CO benchmark yields for {esc(cname)}, {esc(name)}, with the math behind them and what they mean for "
            f"ARC-CO and PLC. FSA has not posted 2027 benchmarks; the 2027 benchmark shifts the window one year. {asof(fsa['as_of'], 'FSA file as of')}"
            if official else f"What FSA publishes for {esc(cname)}, {esc(name)}, and how to run ARC-CO against PLC once you have the official benchmark. {asof(D['updated'])}")
    body = f"""
<body>
{hdr}
<main class="ap-wrap" id="main">
  <p class="ap-bc"><a href="/arc-plc">ARC vs PLC</a> &rsaquo; <a href="/arc-plc/{sl}">{esc(name)}</a> &rsaquo; {esc(cname)}</p>
  <p class="page-kicker">ARC-CO and PLC &middot; {"FSA official" if official else "county"}</p>
  <h1>{esc(cname)}, {st}: ARC or PLC for 2026 and 2027</h1>
  <p class="page-lede">{lede}</p>
  {deadlines_html()}
  {'' if official else pending_note(D)}
  {quick_county(c, D) if official else ''}
  <p class="ap-tools"><button type="button" class="btn btn-secondary" onclick="window.print()">Print a summary for the FSA office</button>
  <a class="btn btn-secondary" href="{share}" data-share="{share}" data-title="{esc(cname)} ARC or PLC">Share this county</a></p>
  {''.join(blocks)}
  {miss_txt}
  <p class="ap-small">Break-even prices are per base acre with both programs on 85% of base and 2026 prices. Your PLC yield is on the FSA-156EZ.</p>
  <div class="ap-noprint">{form_html(D, first, st, c['f'])}</div>
  {f'<div class="ap-faq ap-noprint"><h2>Questions about {esc(cname)}</h2>{faq_html}</div>' if faqs else ''}
  <p class="ap-disc">An estimate, not a USDA determination. Source: <a href="{FSA_DATA}" rel="noopener">FSA ARC/PLC program data</a>. <a href="{OFFICE}" rel="noopener">Find your county office</a>.</p>
  <p class="ap-small ap-noprint">Related: {' &middot; '.join(rel)}</p>
  <p class="ap-printonly ap-small">Printed from {share}</p>
</main>
<script>document.addEventListener('click',function(e){{var a=e.target.closest&&e.target.closest('[data-share]');if(!a||!navigator.share)return;e.preventDefault();navigator.share({{title:a.getAttribute('data-title'),url:a.getAttribute('data-share')}}).catch(function(){{}});}});</script>
"""
    page = head(title, desc, path, jsonld, official, fonts) + body + tail(ftr, calc=True)
    return page, {"path": path, "indexable": official, "title": title, "desc": desc}


def embed_page(D):
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><!-- embed target; canonical tool is /arc-plc -->
<link rel="canonical" href="{SITE}/arc-plc">
<title>ARC or PLC | AGSIST</title>
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
<p class="ap-small">An estimate, not a USDA determination. Prices, FSA county benchmarks and the full math at <a href="{SITE}/arc-plc" target="_blank" rel="noopener">agsist.com/arc-plc</a>.</p>
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


def sitemap(urls):
    body = "".join(f"  <url><loc>{SITE}{u}</loc><lastmod>{lm}</lastmod><changefreq>monthly</changefreq><priority>{p}</priority></url>\n"
                   for u, p, lm in urls)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{body}</urlset>\n'


LLMS_PREFIX = "- [ARC or PLC for 2026 and 2027](https://agsist.com/arc-plc):"
LLMS_PREFIX2 = "- [ARC-CO benchmark yields by county](https://agsist.com/arc-plc/iowa):"
LLMS_OLD = "- [ARC or PLC for 2027](https://agsist.com/arc-plc):"


def llms_text(D, root="."):
    p = os.path.join(root, "llms.txt")
    if not os.path.exists(p):
        return None
    cur = open(p, encoding="utf-8").read()
    y6, y7 = D["years"]["2026"]["crops"], D["years"]["2027"]["crops"]
    n_c = sum(len(S["c"]) for S in D["states"].values())
    l1 = (f"{LLMS_PREFIX} PLC effective reference prices computed from final USDA NASS season-average prices under the 2025 farm law: 2026 corn "
          f"{usd(y6['corn']['erp']['erp'])}, soybeans {usd(y6['soybeans']['erp']['erp'])}, wheat {usd(y6['wheat']['erp']['erp'])}; 2027 est. corn "
          f"{usd(y7['corn']['erp']['erp'])}, soybeans {usd(y7['soybeans']['erp']['erp'])}, wheat {usd(y7['wheat']['erp']['erp'])}. Signup: 2026 closes "
          f"Dec 11, 2026; 2027 runs Nov 2, 2026 to Mar 15, 2027. A calculator compares PLC and ARC-CO per base acre by price and county yield, "
          f"with what changed under the 2025 law, SCO, rented ground and payment limits")
    l2 = (f"{LLMS_PREFIX2} FSA's official 2026 ARC-CO benchmark yields for {n_c:,} counties by crop (corn, soybeans, wheat) and practice "
          f"(irrigated, non-irrigated), with benchmark revenue, guarantee, maximum payment, FSA history and the PLC vs ARC break-even, at "
          f"/arc-plc/<state> and /arc-plc/<state>/<county> (e.g. /arc-plc/iowa/story-county)")
    lines = cur.split("\n")
    out, done = [], False
    for ln in lines:
        if ln.startswith((LLMS_PREFIX, LLMS_PREFIX2, LLMS_OLD)):
            if not done:
                out += [l1] + ([l2] if D["fsa"] else [])
                done = True
            continue
        out.append(ln)
    return "\n".join(out) if done else None


def render_all(D):
    ch = chrome()
    main_j, per = calc_json(D)
    out = {OUT_JSON: json.dumps(main_j, separators=(",", ":"), ensure_ascii=False) + "\n"}
    for code, j in per.items():
        out[f"{OUT_STATE_JSON}/{code}.json"] = json.dumps(j, separators=(",", ":"), ensure_ascii=False) + "\n"
    main, meta = build_main(D, ch)
    out[OUT_MAIN] = main
    out[OUT_EMBED] = embed_page(D)
    lm = D["updated"][:10]
    urls = [("/arc-plc", "0.8", lm)]
    nav_states = sorted(D["states"].values(), key=lambda x: x["n"])
    stats = {"states": 0, "states_indexed": 0, "counties": 0, "meta": meta, "examples": {}}
    for st, S in sorted(D["states"].items()):
        page, m = state_page(st, S, D, ch, nav_states)
        out[f"{OUT_DIR}/{S['slug']}.html"] = page
        stats["states"] += 1
        if m["indexable"]:
            stats["states_indexed"] += 1
            urls.append((m["path"], "0.6", lm))
        stats["examples"].setdefault("state", m)
        for c in S["c"]:
            page, m = county_page(st, S, c, D, ch)
            out[f"{OUT_DIR}/{S['slug']}/{c['s']}.html"] = page
            stats["counties"] += 1
            if m["indexable"]:
                urls.append((m["path"], "0.5", lm))
            stats["examples"].setdefault("county", m)
    out[OUT_SITEMAP] = sitemap(urls)
    t = llms_text(D)
    if t:
        out["llms.txt"] = t
    return out, stats


def existing_outputs(root):
    paths = set()
    for d_, ext in ((OUT_DIR, ".html"), (OUT_STATE_JSON, ".json")):
        for base, _dirs, files in os.walk(os.path.join(root, d_)):
            for f in files:
                if f.endswith(ext):
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
    f = D["fsa"]
    print(f"[arc-plc] FSA official file: {('PY' + str(f['py']) + ' as of ' + str(f['as_of'])) if f else 'none'}; "
          f"{stats['states']} state pages ({stats['states_indexed']} indexable), {stats['counties']} county pages; "
          f"{len(stale)} file(s) written, {len(gone)} removed.")
    for y in D["years"]:
        for k, x in D["years"][y]["crops"].items():
            print(f"[arc-plc] {y} {k}: ERP {x['erp']['erp']} ({x['erp']['binding']}), benchmark price {x['bp']['value']}")
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

    ck("ERP 2024 corn 4.01 (85%)", erp_calc(win(corn, 2024), 3.70, 0.85)["erp"] == 4.01)
    ck("ERP 2024 soybeans 9.26", erp_calc(win(soy, 2024), 8.40, 0.85)["erp"] == 9.26)
    ck("ERP 2024 wheat 5.50 statutory", erp_calc(win(wht, 2024), 5.50, 0.85)["binding"] == "statutory")
    for y in (2025, 2026):
        ck(f"ERP {y} corn 4.42", erp_calc(win(corn, y), 4.10)["erp"] == 4.42)
        ck(f"ERP {y} soybeans 10.71", erp_calc(win(soy, y), 10.00)["erp"] == 10.71)
    ck("ERP 2026 wheat 6.35", erp_calc(win(wht, 2026), 6.35)["erp"] == 6.35)
    e = erp_calc(win(corn, 2027), 4.10)
    ck("ERP 2027 corn 4.34, 2025 dropped as low", e["erp"] == 4.34 and e["dropped_low"] == 4.16 and e["dropped_high"] == 6.54, str(e))
    ck("ERP 2027 soybeans 10.62", erp_calc(win(soy, 2027), 10.00)["erp"] == 10.62)
    ck("ERP 2027 wheat 6.35", erp_calc(win(wht, 2027), 6.35)["erp"] == 6.35)
    ck("cap 115% binds at 4.72", erp_calc([10, 10, 10, 10, 10], 4.10)["erp"] == 4.72)
    ck("BP 2023 corn 3.98", benchmark_price(win(corn, 2023), 3.70)[0] == 3.98)
    ck("BP 2024 corn 4.85", benchmark_price(win(corn, 2024), 4.01)[0] == 4.85)
    ck("BP 2024 soybeans 11.12", benchmark_price(win(soy, 2024), 9.26)[0] == 11.12)
    ck("BP 2024 wheat 6.21", benchmark_price(win(wht, 2024), 5.50)[0] == 6.21)
    ck("BP 2026 corn 5.03", benchmark_price(win(corn, 2026), 4.42)[0] == 5.03)
    ck("BP 2026 soybeans 12.17", benchmark_price(win(soy, 2026), 10.71)[0] == 12.17)
    ck("BP 2026 wheat 6.98", benchmark_price(win(wht, 2026), 6.35)[0] == 6.98)
    ck("BP 2027 corn 4.96", benchmark_price(win(corn, 2027), 4.34)[0] == 4.96)
    ck("BP 2027 soybeans 12.11", benchmark_price(win(soy, 2027), 10.62)[0] == 12.11)
    ck("BP 2027 wheat 6.98", benchmark_price(win(wht, 2027), 6.35)[0] == 6.98)
    ck("cents half up: 0.125 -> 13, 27.455 -> 2746", cents(0.125) == 13 and cents(27.455) == 2746)
    ck("PLC rate 4.34-4.00 = 0.34", abs(plc_rate(4.34, 4.00, 2.42) - 0.34) < 1e-9)
    ck("PLC rate floored at loan rate", abs(plc_rate(4.34, 2.00, 2.42) - 1.92) < 1e-9)
    ck("ARC capped at 12%", abs(arc_rate(180, 4.96, 162, 4.00, 2.42) - 107.136) < 1e-9)
    ck("ARC uncapped shortfall", abs(arc_rate(180, 4.96, 170, 4.40, 2.42) - 55.52) < 1e-9)
    runs = ranges(4.34, 2.42, 136.16, 170.2, 4.96, 170.2)
    ck("crossover runs plc/arc/none", [x["w"] for x in runs] == ["plc", "arc", "none"], str(runs))
    ck("PLC pays more at 3.59 or lower", plc_below(runs) == 359, str(runs))
    ck("text", ranges_text(runs) == ["PLC pays more at $3.59 or lower.", "ARC-CO pays more from $3.60 to $4.46.",
                                     "Neither pays at $4.47 or higher."], str(ranges_text(runs)))
    ck("break-even depends only on PLC/benchmark share", plc_below(ranges(4.34, 2.42, 80.0, 100.0, 4.96, 100.0)) == 359)
    big = ranges(4.34, 2.42, 150, 170, 4.96, 0.001)
    ck("tiny county yield cannot run the scan past 1.5 x max(ERP, BP)", big[-1]["hi"] <= int(math.ceil(4.96 * 150)), str(big[-1]))
    # scenario engine, 8 hand-worked years: ERP 4.00, BP 5.00, loan 2.00, PLC yield 100, benchmark 100, center $4.00
    R = {2015: 1.0, 2016: 0.75, 2017: 1.25, 2018: 1.25, 2019: 1.0, 2020: 0.5, 2021: 1.1, 2022: 0.9}
    Dy = {2015: 1.0, 2016: 1.0, 2017: 1.0, 2018: 0.8, 2019: 1.2, 2020: 1.0, 2021: 0.9, 2022: 1.1}
    v = scen_eval(4.0, 5.0, 2.0, 100, [(1.0, 100, Dy)], 4.0, R)
    # PLC: 2016 $3.00 -> 1.00 x 100 x .85 = 85; 2020 $2.00 -> 170; 2022 $3.60 -> 34; mean 289/8 = 36.125
    # ARC: 42.5, 51 (cap 60 x .85), 0, 42.5, 0, 51, 45.9, 45.9; mean 278.8/8 = 34.85
    ck("scenario means 36.125 PLC, 34.85 ARC", abs(v["plc"] - 36.125) < 1e-9 and abs(v["arc"] - 34.85) < 1e-9, str(v))
    ck("scenario wins 2 PLC, 4 ARC, 2 ties; SE 19.44 -> too close", v["plc_wins"] == 2 and v["arc_wins"] == 4 and abs(v["se"] - 19.4408) < 1e-3
       and v["verdict"] == "close", str(v))
    v = scen_eval(4.0, 5.0, 2.0, 100, [(1.0, 100, Dy)], 4.0, R, price=3.0)
    ck("at a fixed $3.00: PLC 85 every year, ARC 51 every year -> PLC", v["plc"] == 85 and abs(v["arc"] - 51) < 1e-9 and v["verdict"] == "plc", str(v))
    R7 = {k: v_ for k, v_ in R.items() if k != 2022}
    ck("fewer than 8 years -> withheld", scen_eval(4.0, 5.0, 2.0, 100, [(1.0, 100, Dy)], 4.0, R7)["verdict"] == "withheld")
    # published PLC rates the back-test must reproduce: 2019 corn $0.14, 2019 wheat $0.92, 2020 wheat $0.45, 2025 wheat $1.29
    bt = backtest(load_inputs(ROOT))
    got = {(r["y"], r["k"]): r["rate"] for r in bt["rows"]}
    ck("back-test PLC rates 2019 corn 0.14, wheat 0.92; 2020 wheat 0.45; 2025 wheat 1.29",
       got.get((2019, "corn")) == 0.14 and got.get((2019, "wheat")) == 0.92 and got.get((2020, "wheat")) == 0.45 and got.get((2025, "wheat")) == 1.29, str(got))
    # FSA parser on a workbook laid out like FSA's (header row, designations, years)
    try:
        import openpyxl
        import tempfile
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "ARCCO 2026 (2026-01-16)"
        ws.append(["ARC-CO TREND ADJUSTED YIELDS, BENCHMARK YIELDS AND GUARANTEE REVENUES FOR PROGRAM YEAR 2026"])
        ws.append([])
        ws.append([])
        ws.append(["ST_Cty", "State Name", "County Name", "Sub County", "Crop Name", "Unit", "ARC-CO Yield Designation",
                   "2020 trend adjusted (county yield or 80% of T)", "2021 trend adjusted (county yield or 80% of T)",
                   "2022 trend adjusted (county yield or 80% of T)", "2023 trend adjusted (county yield or 80% of T)",
                   "2024 trend adjusted (county yield or 80% of T)", None, "2026 Bench Mark (2020-24 olympic avg)",
                   "2026 Bench Mark Price (2020-24 olympic avg)", "2026 Benchmark Revenue", "2026 Guarantee Revenue",
                   "2026 Maximum Payment Rate", "2026 Actual Yield", "2026 National Price", "2026 Actual Revenue",
                   "2026 Formula Payment Rate", "2026 ARC-CO Payment Rate"])
        ws.append(["55017", "Wisconsin", "Chippewa", "", "Corn", "Bushel", "Nonirrigated", 170, 160, 175, 180, 165, None,
                   170.0, 5.03, 855.1, 769.59, 102.61, None, None, None, None, None])
        ws.append(["55017", "Wisconsin", "Chippewa", "", "Corn", "Bushel", "Irrigated", 200, 205, 210, 190, 195, None,
                   200.0, 5.03, 1006.0, 905.4, 120.72, None, None, None, None, None])
        tmp = os.path.join(tempfile.mkdtemp(), "arcco_2026_data_2026-01-16.xlsx")
        wb.save(tmp)
        f = parse_arcco(tmp)
        r = f["rows"].get(("55017", "", "Corn", "non"))
        ck("parser: program year, as-of, designation, benchmark, window",
           f["py"] == 2026 and f["as_of"] == "2026-01-16" and r and r["by"] == 170.0 and r["bp"] == 5.03
           and list(r["yrs"]) == [2020, 2021, 2022, 2023, 2024] and ("55017", "", "Corn", "irr") in f["rows"], str(f)[:300])
        # end to end: the official path, as when FSA's 2026 file lands in data/fsa/
        inp = load_inputs(ROOT)
        inp["fsa"] = dict(inp["fsa"])
        inp["fsa"][2026] = f
        D = compute(inp)
        S = D["states"]["WI"]
        cp, cm = county_page("WI", S, S["c"][0], D, ("", "", ""))
        sp, sm = state_page("WI", S, D, ("", "", ""), [S])
        ck("official path: county page indexed, official benchmark, trigger yield, both practices",
           cm["indexable"] and "official 2026 ARC-CO benchmark" in cp and "170.00 bu" in cp and "200.00 bu" in cp
           and "county yield comes in below" in cp and 'content="index,follow"' in cp, cm["title"])
        ck("official path: calculator file carries both practices",
           [e["d"] for e in calc_json(D)[1]["WI"]["c"][0]["k"]["corn"]] == ["irr", "non"])
        bad = dict(f)
        bad["rows"] = {k: dict(v, bp=4.00) for k, v in f["rows"].items()}
        inp["fsa"][2026] = bad
        try:
            compute(inp)
            ck("refuses when FSA's benchmark price disagrees with ours", False)
        except SystemExit:
            ck("refuses when FSA's benchmark price disagrees with ours", True)
        inp["fsa"].pop(2026)
        D = compute(inp)
        Sx = D["states"].get("WI")
        if Sx:
            cx = next(c for c in Sx["c"] if c["f"] == "55017")
            cp, cm = county_page("WI", Sx, cx, D, ("", "", ""))
            ck("pending path: noindex, no benchmark kv, no trigger yield in bushels",
               not cm["indexable"] and "Benchmark yield (FSA)" not in cp and "county yield comes in below" not in cp
               and 'content="noindex,follow"' in cp)
    except ImportError:
        ck("openpyxl installed", False)
    ck("no em dash in range text", "—" not in " ".join(ranges_text(runs)))
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
