#!/usr/bin/env python3
"""COMPANIES BEHIND A STATE BASIS MIDDLE, FROM REAL BOARDS.

    python3 scripts/test_basis_companies.py

The god's-eye panel (Oct 27, 2026, seat 8) found the Kansas corn middle rests
on 203 locations but only 23 companies, one of them holding 50. Sig approved
printing the company count beside every state middle (STANDING-DECISIONS,
decision 4). These are the Dec '26 corn headline boards of three states from
the network snapshot of 2026-10-27T14:00:23Z: printed name, the board's website
host (scripts/basis_method.py site_key) and how many locations post under them.

  KS: AgMark posts from two sites under one name (one company).
  NE: "Farmers Cooperative" and "Farmers Cooperative Dorchester" share one site
      (one co-op); CHS High Plains and CHS Holdrege are both CHS.
  ND: six CHS-branded businesses, each on its own site, count as one (CHS).
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import basis_method as BM  # noqa: E402

REAL = {
    "KS": {"n": 203, "companies": 23, "median": -0.35, "boards": [
        ("Abbyville Farmers Co-op Grain Co.", "abbyvillecoop.com", 1),
        ("AgMark LLC.", "agmarkllc.com", 35),
        ("AgMark LLC.", "agmarkresp.agricharts.com", 15),
        ("Agri Trails Coop", "agritrails.agricharts.com", 12),
        ("American Plains Co-op", "americanplains.agricharts.com", 6),
        ("American Plains Co-op", "apcoop.com", 5),
        ("Aurora Cooperative", "auroracoop.com", 1),
        ("Beardsley Equity Coop", "beardsleycoop.com", 1),
        ("CHS United Plains Ag", "chsunitedplains.com", 5),
        ("CoMark Equity Alliance LLC", "ceagrain.com", 45),
        ("Cornerstone Ag LLC", "cornerstone-ag.com", 1),
        ("Farmers Coop Elevator - Morganville Coop", "morganvillecoop.com", 1),
        ("Farmers Cooperative Dorchester", "farmersco-operative.agricharts.com", 8),
        ("Garden City Co-op", "gccoop.agricharts.com", 17),
        ("Hi-Plains Coop", "hi-plainscoop.com", 8),
        ("Home City Grain, Inc.", "homecitygrain.com", 2),
        ("Jackson Farmers, Inc.", "jacksonfarmers.agricharts.com", 2),
        ("Kansas Ethanol", "kansasethanol.net", 1),
        ("Kanza Cooperative", "kanzacoop.com", 19),
        ("Pawnee Co. Cooperative Association", "pawneecoop.com", 1),
        ("Piqua Farmers Coop", "piquacoop.com", 1),
        ("Scott Coop", "scottcoop.com", 11),
        ("Scoular", "scoularview.com", 3),
        ("Stafford County Flour Mills", "scfmco.com", 1),
        ("Turon Mill & Elevator, Inc.", "turonmill.com", 1),
    ]},
    "NE": {"n": 243, "companies": 29, "median": -0.39, "boards": [
        ("ADM", "adm.gradable.com", 8),
        ("Ag Valley Co-op", "agvalley.com", 6),
        ("Aurora Cooperative", "auroracoop.com", 13),
        ("CHS High Plains", "chsunitedplains.com", 1),
        ("CHS Holdrege", "chsholdrege.com", 8),
        ("Central Valley Ag", "cvacoop365.agricharts.com", 42),
        ("CoMark Equity Alliance LLC", "ceagrain.com", 1),
        ("Cooperative Producers, Inc.", "cpicoop.com", 22),
        ("Country Partners Cooperative", "countrypartnerscoop.com", 10),
        ("Crossroads Coop", "crossroadscoop.com", 1),
        ("Dixon Elevator", "dixonelevator.com", 2),
        ("E-Energy Adams", "corn.eenergyadams.com", 1),
        ("Elkhorn Valley Grain", "evgrain.com", 3),
        ("Farmers Cooperative", "farmersco-operative.agricharts.com", 1),
        ("Farmers Cooperative Dorchester", "farmersco-operative.agricharts.com", 34),
        ("Farmers Pride Coop", "farmerspridecoop.com", 5),
        ("Farmers Union Cooperative Company", "farmersunioncoop.com", 1),
        ("Fordyce, Farmers Non-Stock Coop", "fordycecoop.com", 1),
        ("Frenchman Valley Farmers Cooperative, Inc.", "fvcoop.com", 15),
        ("Frontier Cooperative", "frontiercooperative.com", 40),
        ("Husker Ag, LLC", "huskerag.com", 1),
        ("KAAPA Ethanol Commodities LLC", "kaapagrains.agricharts.com", 4),
        ("Legacy Coop", "legacycoop.com", 8),
        ("Nebraska Corn Processing", "nebraskacornprocessing.com", 1),
        ("Niewohner Farms", "niewohnerbros.com", 3),
        ("POET Grain", "poet.gradable.com", 1),
        ("Pride Grain", "pridegrain.com", 1),
        ("Sandhills Renewable Energy, LLC", "sandhillsrenewables.com", 1),
        ("Scoular", "scoularview.com", 6),
        ("Siouxland Ethanol LLC", "siouxlandethanol.com", 1),
        ("Thomas Livestock Co", "thomaslivestock.com", 1),
    ]},
    "ND": {"n": 44, "companies": 15, "median": -0.87, "boards": [
        ("Agtegra", "agtegra.com", 1),
        ("Berthold Farmers", "bertholdfarmers.com", 1),
        ("CHS Dakota Plains Ag", "chsdakotaplainsag.com", 5),
        ("CHS Devils Lake (North Dakota)", "chsdevilslake.com", 1),
        ("CHS Drayton", "chsdrayton.com", 4),
        ("CHS River Plains", "chsriverplains.com", 2),
        ("CHS South Central (North Dakota)", "chssouthcentral.com", 2),
        ("CHS Southwest Grain (North Dakota/South Dakota)", "chssouthwestgrain.com", 1),
        ("CenDak Cooperative", "cendakcooperative.com", 7),
        ("Country Grain Cooperative", "countrygraincooperative.com", 1),
        ("Dakota Midland Grain", "dakotamidland.com", 1),
        ("Farmers Coop Elevator Lidgerwood", "fcelidgerwood.com", 1),
        ("Finley Farmers Grain & Elevator", "finleyfarmerselevator.com", 2),
        ("Fullerton Farmers Elevator", "fullertonelevator.net", 1),
        ("James Valley Grain, LLC", "jamesvalleygrain.com", 3),
        ("Maple River Grain", "mrga.com", 3),
        ("Minn-Kota Ag Products, Inc.", "mkap.com", 3),
        ("North Prairie Ag - NPA Coop", "npacoop.com", 1),
        ("Valley United Coop", "valleyunited.agricharts.com", 3),
        ("Walsh Grain Terminal", "walshgrainterminal.com", 1),
    ]},
}

# PARENTS (Oct 27, fx/bidkeys): data/ids/board-parents.json gives a board a parent only from evidence on
# the board itself (scripts/board_parents.py). Wisconsin corn, Dec '26 headline, network snapshot of
# 2026-10-27T18:07:59Z: Landmark Services Cooperative's Burlington board is listed on ALCIVIA's own cash bid
# page (alciviacoop.agricharts.com), so it is ALCIVIA's: 66 locations, 20 companies before, 19 with parents.
# Kansas, Nebraska and North Dakota have no board-page parent; their CHS boards were one CHS already.
WI_PARENTS = {"n": 66, "before": 20, "companies": 19, "boards": [
    ("ALCIVIA", "alciviacoop.agricharts.com", 14, ""),
    ("Burnett Dairy Cooperative", "burnettdairy.com", 1, ""),
    ("Country Visions Cooperative", "countryvisionscoop.com", 8, ""),
    ("Cushing Cooperative Society", "cushingcoop.com", 1, ""),
    ("Duffy Grain, Inc.", "duffygrain.com", 1, ""),
    ("Dummer's Grain Service", "dummersgrain.com", 1, ""),
    ("Eastland Feed & Grain, Inc", "efgi.net", 4, ""),
    ("Innovative Ag Services", "innovativeag.com", 2, ""),
    ("Landmark Services Cooperative", "landmark.coop", 1, "ALCIVIA"),
    ("Medford Cooperative", "medfordcoop.com", 1, ""),
    ("Meyer Brothers Grain", "meyerbrothersgrain.com", 1, ""),
    ("Nutrition Service Co. LLC", "nutritionservice.com", 5, ""),
    ("Premier Cooperative", "premiercooperative.com", 4, ""),
    ("Reddy Feed and Grain", "reddyagservice.com", 1, ""),
    ("See-Mor Grain", "seemorgrain.com", 1, ""),
    ("United Cooperative", "unitedcooperative.com", 16, ""),
    ("United Wisconsin Grain Producers", "uwgp.com", 1, ""),
    ("Walsh Grain Farms, Inc.", "walshgrain.com", 1, ""),
    ("Wheaton Grain", "wheatongrain.com", 1, ""),
    ("Wolf River Grain", "wolfrivergrain.com", 1, ""),
]}

fails, passes = [], 0


def check(cond, msg):
    global passes
    if cond:
        passes += 1
    else:
        fails.append(msg)


def rows(st):
    return [{"operator": o, "site": f"https://www.{s}/" if s else ""}
            for o, s, k in REAL[st]["boards"] for _ in range(k)]


for st, v in REAL.items():
    rs = rows(st)
    check(len(rs) == v["n"], f"{st}: fixture has {len(rs)} locations, expected {v['n']}")
    got = BM.companies_behind(rs)
    check(got == v["companies"], f"{st}: {got} companies, expected {v['companies']}")
    names = len({o for o, _, _ in v["boards"]})
    check(got <= names, f"{st}: never more companies ({got}) than printed names ({names}); unsure matches fold")

# the KS case the panel measured: 203 locations, 23 companies, one with 50
ks = REAL["KS"]
check(ks["n"] == 203 and ks["companies"] == 23, "Kansas corn: 203 locations, 23 companies (godseye seat 8)")
check(sum(k for o, _, k in ks["boards"] if o == "AgMark LLC.") == 50, "AgMark holds 50 of Kansas's 203")
# NE: name alone would say 31 companies; the shared site and CHS fold it to 29
ne = REAL["NE"]
check(len({o for o, _, _ in ne["boards"]}) - ne["companies"] == 2, "NE: one shared-site fold and one CHS fold")
# ND: every CHS name is one company
nd_chs = [o for o, _, _ in REAL["ND"]["boards"] if o.startswith("CHS")]
check(len(nd_chs) == 6 and BM.companies_behind([{"operator": o, "site": ""} for o in nd_chs]) == 1, "ND: six CHS names, one CHS")
# parents: WI folds Landmark into ALCIVIA; without the parent column the count is as before
wi = [{"operator": o, "site": f"https://www.{st_}/", **({"parent": p} if p else {})}
      for o, st_, k, p in WI_PARENTS["boards"] for _ in range(k)]
check(len(wi) == WI_PARENTS["n"], f"WI: fixture has {len(wi)} locations")
check(BM.companies_behind(wi) == WI_PARENTS["companies"], f"WI with parents: {BM.companies_behind(wi)} companies, expected 19")
check(BM.companies_behind([{k: v for k, v in r.items() if k != "parent"} for r in wi]) == WI_PARENTS["before"],
      "WI without parents: 20 companies, as before")
for st in ("KS", "NE", "ND"):     # the CHS-brand parent changes nothing: CHS was one company already
    rp = [dict(r, parent="CHS Inc.") if r["operator"].startswith("CHS") else r for r in rows(st)]
    check(BM.companies_behind(rp) == REAL[st]["companies"], f"{st}: the CHS parent changes the count")
check(BM.companies_behind([{"operator": "Pro Cooperative", "site": "", "dest": "AGP"}, {"operator": "AGP", "site": ""}]) == 2,
      "a destination buyer never joins the co-op that delivers to it")
# the cash bid build attaches the parent from data/ids/board-parents.json by board id, and nothing without it
import build_cash_bid_pages as _CB  # noqa: E402
_CB.BOARD_PARENTS = {"alciviacoop-burlington": {"parent": "ALCIVIA", "pv": "board-page:alciviacoop.agricharts.com"}}
_rows = [{"source": "alciviacoop-burlington", "operator": "Landmark Services Cooperative"}, {"source": "x", "operator": "Y"}]
_orig = (_CB.SB.fresh_rows, _CB.SB.flag_futures_disagreement, _CB.SB.nearby)
_CB.SB.fresh_rows, _CB.SB.flag_futures_disagreement, _CB.SB.nearby = (lambda m, i: _rows), (lambda r: None), (lambda r: r)
try:
    _got = _CB.state_basis_rows({}, {"sources": []})
finally:
    _CB.SB.fresh_rows, _CB.SB.flag_futures_disagreement, _CB.SB.nearby = _orig
    _CB.BOARD_PARENTS = None
check(_got[0].get("parent") == "ALCIVIA" and "parent" not in _got[1], f"state_basis_rows attaches the parent by board id: {_got}")

# a stat carries it to data/basis-states.json
st = BM.state_basis([dict(r, source=f"s{i}", group="corn", crop="corn", commodity="Corn", period="2026-10",
                          contract=("ZC", 11, 2026), basis=-0.35, cash=4.2, priced=i, city="T", fut_off=False)
                     for i, r in enumerate(rows("KS"))], None)["corn"]["contracts"][0]
j = BM.headline_json(st)
check(j["n"] == 203 and j["companies"] == 23, f"headline_json carries n and companies: {j}")

# ONE WORDING: every page script prints the count with a locCo helper that says
# the same words as the state pages' Python (run in node, not matched as text:
# the size-capped scripts carry a shorter spelling of it)
import json as _json  # noqa: E402
import subprocess  # noqa: E402
CASES = [[203, 23], [1, 1], [7, None]]
WANT = ["203 locations, 23 companies", "1 location, 1 company", "7 elevators"]
for f in ("basis-map", "breakeven-more", "cb-vs-state", "combine-loss-ui", "fast-facts", "grain-shrink-ui",
          "harvest-wait-ui", "home", "near-coop", "place", "price-local", "your-area", "ys-tariffs"):
    src = open(os.path.join(ROOT, "components", f + ".js"), encoding="utf-8").read()
    m = re.search(r"function locCo\(n, ?m\) ?\{[^\n]*\}", src)
    check(m is not None, f"components/{f}.js: no locCo helper")
    if not m:
        continue
    check(src.count("locCo(") >= 2, f"components/{f}.js: locCo defined but not used")
    js = m.group(0) + "; console.log(JSON.stringify(" + _json.dumps(CASES) + ".map(function (c) { return locCo(c[0], c[1] === null ? undefined : c[1]); })));"
    out = subprocess.run(["node", "-e", js], capture_output=True, text=True)
    got = _json.loads(out.stdout or "null")
    check(got == WANT, f"components/{f}.js: locCo says {got}")
hub = open(os.path.join(ROOT, "basis.html"), encoding="utf-8").read()
check("function locCo(c)" in hub and "+locCo(c)" in hub, "basis.html: the state pick does not print locations and companies")
import build_cash_bid_pages as CB  # noqa: E402
check(CB.loc_co({"n": 203, "companies": 23}) == "203 locations, 23 companies", "loc_co words")
check(CB.loc_co({"n": 1, "companies": 1}) == "1 location, 1 company", "loc_co singular")
check(CB.loc_co({"n": 7}) == "7 elevators", "an older record without companies keeps its words")
check("\u2014" not in CB.CO_RULE and len(CB.CO_RULE) < 160, "the matching rule is one short line, no em dash")

for f in fails:
    print("FAIL: " + f)
print(f"test_basis_companies: {passes} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
