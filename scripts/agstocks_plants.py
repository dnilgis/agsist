#!/usr/bin/env python3
"""agstocks_plants.py -- the plants a listed ag company runs, matched by operator name only.

Reads the plant lists researched Oct 28, 2026 (feedbag notes/chatgpt/2026-10-28-answers/
elevator-attributes/): 01 BNSF shuttle elevators and 02 other railroad shuttle elevators
(Kansas Department of Revenue grain elevator guide), 03 ethanol plants (Renewable Fuels
Association plant list), 04 soybean crush plants (NOPA plant locations), 06 export grain
elevators (port and operator pages). A plant counts for a company only when its operator
name matches that company's pattern below; nothing is inferred from ownership stakes, so
REX's ethanol plants (run as One Earth Energy and NuGen Energy) are not counted for REX.
Every plant that matched no listed company is counted by operator in "unmatched".

A plant's map point is its town's point from the site search (build_search_index.town_points:
the ZIP grid, elevator towns, rain-gauge towns). A plant whose town has no point is listed
with no point ("no_point") and is left out of "near you", never placed by guess.

    python3 scripts/agstocks_plants.py --src <dir with the csv files>   # writes data/agstocks/plants.json
    python3 scripts/agstocks_plants.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import csv
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
OUT = os.path.join(ROOT, "data", "agstocks", "plants.json")

FILES = [
    ("01_bnsf_shuttle_grain_facilities.csv", "rail", "BNSF shuttle elevator",
     "Kansas Department of Revenue, grain elevator guide", "https://www.ksrevenue.gov/pdf/KSGrainElevatorGuide.pdf"),
    ("02_other_railroad_grain_facilities.csv", "rail", "Rail shuttle elevator",
     "Kansas Department of Revenue, grain elevator guide", "https://www.ksrevenue.gov/pdf/KSGrainElevatorGuide.pdf"),
    ("03_ethanol_capacities_RFA_NOT_EIA.csv", "ethanol", "Ethanol plant",
     "Renewable Fuels Association, U.S. ethanol biorefineries", "https://ethanolrfa.org/resources/us-ethanol-and-alcohol-to-jet-biorefineries"),
    ("04_soybean_crushing_plants.csv", "crush", "Soybean crush plant",
     "NOPA plant locations", "https://www.nopa.org/about-us/nopa-plant-locations/"),
    ("06_export_grain_elevators.csv", "export", "Export grain elevator",
     "Port and operator terminal pages", None),
]
# ticker -> operator-name pattern (start of the operator name, case-insensitive)
MATCH = {
    "ADM": r"^(ADM\b|Archer[- ]Daniels)",
    "BG": r"^Bunge\b",
    "GPRE": r"^Green Plains\b",
    "ALTO": r"^Alto Ingredients\b",
    "AMTX": r"^Aemetis\b",
    "ANDE": r"^(The )?Andersons\b",
    "DAR": r"^Darling\b",
    "INGR": r"^Ingredion\b",
    "CLMT": r"^Calumet\b",
    "TSN": r"^Tyson\b",
}


def match(operator):
    op = (operator or "").strip()
    for t, pat in MATCH.items():
        if re.search(pat, op, re.I):
            return t
    return None


def joint(operator, t):
    """'Bunge & Chevron' or 'ADM-Marathon Petroleum': a joint venture named with a partner."""
    op = operator.strip()
    return bool(re.search(r"\s&\s|-Marathon|/(?!ADM)", op)) and not op.upper().startswith("ADM/ADM")


def build(src, points):
    plants, unmatched, no_point = {}, {}, []
    for fname, kind, label, source, url in FILES:
        path = os.path.join(src, fname)
        with open(path, encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                op = (r.get("operator") or "").strip()
                t = match(op)
                if not t:
                    unmatched[op] = unmatched.get(op, 0) + 1
                    continue
                town, st = (r.get("city") or "").strip(), (r.get("state") or "").strip().upper()
                p = {"k": kind, "label": label, "town": town, "st": st, "op": op,
                     "src": source, "url": r.get("source_url") or url}
                if r.get("capacity"):
                    p["cap"] = r["capacity"].strip()
                if joint(op, t):
                    p["jv"] = True
                pt = points.get((town.lower(), st))
                if pt:
                    p["ll"] = [round(pt[1], 3), round(pt[2], 3)]
                else:
                    no_point.append(f"{t} {label} {town}, {st}")
                plants.setdefault(t, []).append(p)
    for t in plants:
        plants[t].sort(key=lambda p: (p["st"], p["town"], p["k"]))
    return {"v": 1, "note": "Built by scripts/agstocks_plants.py from the Oct 28, 2026 plant lists. Matched by operator name only.",
            "read": "2026-10-28", "plants": plants,
            "unmatched": dict(sorted(unmatched.items(), key=lambda kv: (-kv[1], kv[0]))),
            "no_point": no_point}


def selftest():
    fails = []
    for op, want in [("ADM", "ADM"), ("ADM Grain Co (Elev -I)", "ADM"), ("ADM (Wet Mill)", "ADM"), ("Bunge & Chevron", "BG"),
                     ("Green Plains York LLC", "GPRE"), ("The Andersons Renewables LLC", "ANDE"), ("Cargill, Inc.", None),
                     ("POET Bioprocessing", None), ("One Earth Energy LLC", None), ("ADMIRAL LLC", None)]:
        if match(op) != want:
            fails.append(f"match {op!r} -> {match(op)} want {want}")
    if not joint("Bunge & Chevron", "BG") or not joint("ADM-Marathon Petroleum", "ADM") or joint("ADM/ADM Farmland (Terminal J)", "ADM"):
        fails.append("joint venture flag")
    for f in fails:
        print("FAIL", f)
    if not fails:
        print("agstocks_plants selftest: ok")
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--src" not in argv:
        print(__doc__)
        return 2
    src = argv[argv.index("--src") + 1]
    from build_search_index import town_points
    out = build(src, town_points())
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), sort_keys=True)
        f.write("\n")
    n = sum(len(v) for v in out["plants"].values())
    print(f"plants: {n} matched to {len(out['plants'])} companies, {len(out['no_point'])} with no town point, "
          f"{sum(out['unmatched'].values())} unmatched rows ({len(out['unmatched'])} operators)")
    for t, v in sorted(out["plants"].items()):
        print(f"  {t}: {len(v)}")
    for x in out["no_point"]:
        print(f"  no point: {x}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
