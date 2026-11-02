#!/usr/bin/env python3
"""The shared county code table (god's-eye panel, build 2, Oct 27 2026): data/ids/geo-crosswalk.json.

Every county file on the site joins on the 3,141 county FIPS codes of data/atlas/counties.geo.json (the
spine: Census 2010-vintage outlines, eight old Connecticut counties, 02261 Valdez-Cordova, 46102 Oglala
Lakota). Federal files do not all write those codes. FSA writes its own office codes for a few
counties, RMA and the Drought Monitor write Connecticut's 2022 planning regions, the census of
agriculture still writes some retired codes. This file holds, in one place:

  states  state FIPS -> postal code
  asd     county FIPS -> NASS Agricultural Statistics District (crop reporting district), two digits.
          The district id NASS uses is the state FIPS plus these two digits (19001 -> "70" -> 1970,
          Iowa Southwest). Counties NASS does not list are in asd_missing, never guessed.
  codes   every code a federal file publishes that is NOT a spine county, with what it is:
            rename  the same ground under a new code: join it onto `to`
            part    an agency's admin area inside one county (FSA and RMA split a few big counties
                    into two offices): it belongs to `to`, but its numbers are part of a county,
                    not the county; never add them to the county's own row without saying so
            office  an FSA office area named for a town, placed on the county that town is in
            merger  a place that merged into `to`
            split   one spine polygon holds the pieces (02063 and 02066 both sit on 02261), or one
                    old code covers several spine counties (02010 -> 02013 and 02016). Shares of
                    area cannot be added or copied across; a join through a split is lossy
            reshape Connecticut's 2022 planning regions cross the old county lines. `to` is null:
                    no area shares are in this repo, so nothing is folded
          agencies: which of our sources was seen writing that code (fsa, rma, usdm, nass).
  Any spine county that is not in `codes` is written the same way by FSA, RMA (state code plus county
  code) and the Drought Monitor in every file we read; scripts/join_report.py proves that per dataset
  every build, and fails the ship checks when a match rate falls below its floor.

  build_farmland_atlas.FIPS_ALIAS (the Atlas build's own fold) is a strict subset of `codes`, with the
  same targets; the selftest and test/geo-crosswalk.test.mjs fail if the two ever disagree.

The Drought Monitor's regions (High Plains, Midwest, ...) are not here: no file in this repo states
their state lists, and the county statistics the site reads are already keyed by county.

ASD SOURCE
  The NASS county and district code list,
  https://www.nass.usda.gov/Data_and_Statistics/County_Data_Files/Frequently_Asked_Questions/county_list.txt
  The sandbox cannot reach nass.usda.gov. The first build (Oct 27) read a public parse of that file
  (github.com/kevinrhaas/analytics.polecat.live, vendor/geo/us-crd-counties.json at commit 51cc39c,
  which keeps current rows, flag 1). The references job keeps the file itself (references/sources.json
  id nass-county-list); once origin/references has it, a plain run reads it from there instead and
  the --check line names any district that differs.

Usage: python3 scripts/build_geo_crosswalk.py                 rebuild (district codes from the references
                                                              copy when present, else the committed file)
       python3 scripts/build_geo_crosswalk.py --nass FILE     district codes from a county_list.txt copy
       python3 scripts/build_geo_crosswalk.py --nass-json FILE  ... or from a {"counties": {fips: st+asd}} parse
       python3 scripts/build_geo_crosswalk.py --check         exit 1 when the committed file is not what this builds
       python3 scripts/build_geo_crosswalk.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from build_farmland_atlas import FIPS_ALIAS, RENAMES  # noqa: E402  (the Atlas build's fold, kept as the seed)

OUT = os.path.join(ROOT, "data", "ids", "geo-crosswalk.json")
SPINE = os.path.join(ROOT, "data", "atlas", "counties.geo.json")
MAX_BYTES = 60 * 1024
NASS_URL = "https://www.nass.usda.gov/Data_and_Statistics/County_Data_Files/Frequently_Asked_Questions/county_list.txt"
REFS_BLOB = "origin/references:refs/nass-county-list.html"
FIRST_SOURCE = ("a public parse of NASS county_list.txt (github.com/kevinrhaas/analytics.polecat.live "
                "vendor/geo/us-crd-counties.json, commit 51cc39c, current rows only), read Oct 27 2026")

STATES = {"01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE",
          "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA",
          "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
          "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM",
          "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
          "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
          "54": "WV", "55": "WI", "56": "WY"}

# Codes our sources publish that are not spine counties. The Atlas fold (FIPS_ALIAS) is merged in
# below; these are the rest, each from a file in this repo (agencies) and checked by hand against
# the name that file prints beside the code.
EXTRA = {
    "29193": dict(to=["29186"], kind="rename", agencies=["fsa"], name="Ste. Genevieve MO",
                  note="FSA still writes the pre-1979 code; Census moved Ste. Genevieve to 29186"),
    "27138": dict(to=["27137"], kind="part", agencies=["fsa"], name="South St. Louis MN",
                  note="FSA office area inside St. Louis County"),
    "39094": dict(to=["39095"], kind="part", agencies=["fsa"], name="East Lucas OH",
                  note="FSA office area inside Lucas County"),
    "23002": dict(to=["23003"], kind="part", agencies=["fsa"], name="Houlton ME",
                  note="FSA office area inside Aroostook County (Houlton is its county seat)"),
    "23004": dict(to=["23003"], kind="part", agencies=["fsa"], name="Fort Kent ME",
                  note="FSA office area inside Aroostook County"),
    "32035": dict(to=["32023"], kind="part", agencies=["fsa"], name="Southeast Nye NV",
                  note="FSA office area inside Nye County"),
    "02002": dict(to=["02240"], kind="office", agencies=["fsa"], name="Delta AK",
                  note="FSA's Delta office; Delta Junction lies in Southeast Fairbanks Census Area. "
                       "Its area may reach past that census area: treat as approximate"),
    "02010": dict(to=["02013", "02016"], kind="split", agencies=["nass"], name="Aleutian Islands AK",
                  note="retired 1987, now Aleutians East and Aleutians West; the census of agriculture "
                       "still reports the pair as one"),
}
CT_REGIONS = {"09110": "Capitol", "09120": "Greater Bridgeport", "09130": "Lower Connecticut River Valley",
              "09140": "Naugatuck Valley", "09150": "Northeastern Connecticut", "09160": "Northwest Hills",
              "09170": "South Central Connecticut", "09180": "Southeastern Connecticut", "09190": "Western Connecticut"}
ATLAS_NOTES = {
    "46113": ("Shannon SD -> Oglala Lakota", "2015-05-01", ["fsa", "nass"]),
    "02270": ("Wade Hampton AK -> Kusilvak", "2015-07-01", ["nass"]),
    "51515": ("Bedford city VA -> Bedford County", "2013-07-01", ["fsa", "nass"]),
    "02063": ("Chugach AK, out of Valdez-Cordova", "2019-01-02", ["usdm"]),
    "02066": ("Copper River AK, out of Valdez-Cordova", "2019-01-02", ["usdm"]),
    "12025": ("Dade FL -> Miami-Dade", "1997", ["rma"]),
    "19156": ("West Pottawattamie IA", None, ["fsa", "rma"]),
    "27112": ("West Otter Tail MN", None, ["fsa", "rma"]),
    "27120": ("West Polk MN", None, ["fsa", "rma"]),
}


def atlas_kind(code):
    if code in ("19156", "27112", "27120"):
        return "part"      # RMA and FSA rating/office areas; the Atlas adds their old books onto the county
    if code in RENAMES:
        return "rename"
    if code == "51515":
        return "merger"
    return "split"


def codes_table():
    out = {}
    for code, target in FIPS_ALIAS.items():
        name, since, ag = ATLAS_NOTES.get(code, (code, None, []))
        row = dict(to=[target], kind=atlas_kind(code), agencies=ag, name=name)
        if since:
            row["since"] = since
        row["atlas"] = True
        out[code] = row
    for code, row in EXTRA.items():
        assert code not in out, code
        out[code] = dict(row)
    for code, name in CT_REGIONS.items():
        out[code] = dict(to=None, kind="reshape", agencies=["rma", "usdm"], name=name + " planning region CT",
                         since="2022", note="crosses the eight old county lines; no area shares in this repo, not folded")
    return dict(sorted(out.items()))


# ------------------------------------------------------------------ sources
def spine_codes(path=SPINE):
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    return sorted(str(ft["id"]) for ft in doc["features"])


def parse_county_list(text):
    """NASS county_list.txt -> {fips: asd}. Rows: state, district, county, name, flag (1 current, 2 old)."""
    out = {}
    for ln in text.splitlines():
        m = re.match(r"^\s*(\d{2})\s+(\d{2})\s+(\d{3})\s+(.*?)\s+(\d)\s*$", ln)
        if not m:
            continue
        st, dist, cty, _name, flag = m.groups()
        if flag != "1" or dist == "00" or cty in ("000", "888", "999") or int(cty) >= 888:
            continue
        out[st + cty] = dist
    return out


def parse_parse_json(doc):
    """The first build's source: {"counties": {fips: state fips + district}}."""
    out = {}
    for fips, v in (doc.get("counties") or {}).items():
        v = str(v)
        if len(fips) == 5 and len(v) == 4 and v[:2] == fips[:2] and not fips.endswith("888"):
            out[fips] = v[2:]
    return out


def refs_copy():
    try:
        r = subprocess.run(["git", "-C", ROOT, "show", REFS_BLOB], capture_output=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout.decode("utf-8", "replace") if r.returncode == 0 and r.stdout else None


def committed():
    try:
        with open(OUT, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


# ------------------------------------------------------------------ build
def build(spine, nass, source_line):
    sp = set(spine)
    codes = codes_table()
    asd = {f: nass[f] for f in spine if f in nass}
    # a rename is the same ground under a new code, so NASS's row for the old code is that county's district
    asd_from = {}
    for code, row in codes.items():
        if row["kind"] == "rename" and code in nass and row["to"][0] in sp and row["to"][0] not in asd:
            asd[row["to"][0]] = nass[code]
            asd_from[row["to"][0]] = code
    asd = dict(sorted(asd.items()))
    missing = [f for f in spine if f not in asd]
    for code, row in codes.items():
        assert code not in sp, code + " is a spine county; it cannot also be an off-spine code"
        for t in row["to"] or []:
            assert t in sp, f"{code} folds onto {t}, which is not a spine county"
    return {
        "schema": "agsist-geo-crosswalk/1",
        "note": ("County code table. Join every county file on the spine FIPS (data/atlas/counties.geo.json). "
                 "asd: NASS Agricultural Statistics District, two digits; the NASS district id is the state "
                 "FIPS plus these two digits. codes: every code a federal file publishes that is not a spine "
                 "county, with what it is (rename, part, office, merger, split, reshape) and where it goes; "
                 "a part, office, split or reshape is a lossy join. A spine county not in codes is written "
                 "the same by FSA, RMA and the Drought Monitor in every file we read."),
        "spine": {"file": "data/atlas/counties.geo.json", "counties": len(spine),
                  "vintage": "Census 2010-vintage outlines: eight Connecticut counties (09001-09015), 02261 Valdez-Cordova, 46102 Oglala Lakota"},
        "sources": {"asd": source_line, "asd_url": NASS_URL},
        "counts": {"counties": len(spine), "asd": len(asd), "asd_missing": len(missing), "codes": len(codes),
                   "by_kind": {k: sum(1 for r in codes.values() if r["kind"] == k) for k in
                               ("rename", "part", "office", "merger", "split", "reshape")}},
        "states": {k: v for k, v in sorted(STATES.items()) if any(f.startswith(k) for f in spine)},
        "asd_missing": missing,
        "asd_from": dict(sorted(asd_from.items())),
        "codes": codes,
        "asd": asd,
    }


def text(doc):
    # one line per code, the district map compact: under 60 KB and still readable in a diff
    head = {k: v for k, v in doc.items() if k not in ("codes", "asd")}
    s = json.dumps(head, ensure_ascii=False, indent=1)[:-2]
    s += ',\n "codes": {\n' + ",\n".join("  " + json.dumps(k) + ": " + json.dumps(v, ensure_ascii=False, separators=(",", ":"))
                                         for k, v in doc["codes"].items()) + "\n },"
    s += '\n "asd": ' + json.dumps(doc["asd"], separators=(",", ":")) + "\n}\n"
    return s


def fold(code, xw):
    """Spine codes a published county code lands on, and how: (codes, kind). kind None = a spine county."""
    row = (xw.get("codes") or {}).get(code)
    if row is None:
        return [code], None
    return list(row.get("to") or []), row["kind"]


def resolve_nass(argv):
    if "--nass" in argv:
        p = argv[argv.index("--nass") + 1]
        return parse_county_list(open(p, encoding="utf-8", errors="replace").read()), "NASS county_list.txt, local copy " + os.path.basename(p)
    if "--nass-json" in argv:
        p = argv[argv.index("--nass-json") + 1]
        return parse_parse_json(json.load(open(p, encoding="utf-8"))), FIRST_SOURCE
    t = refs_copy()
    if t:
        got = parse_county_list(t)
        if len(got) > 3000:
            return got, "NASS county_list.txt, references branch copy (refs/nass-county-list)"
    old = committed()
    if old and old.get("asd"):
        return dict(old["asd"]), old["sources"]["asd"]
    raise SystemExit("no district source: pass --nass FILE or --nass-json FILE")


def selftest():
    ok = 0

    def ck(cond, msg):
        nonlocal ok
        if not cond:
            raise SystemExit("build_geo_crosswalk selftest FAILED: " + msg)
        ok += 1

    lst = ("Header line\n01        10        000       Northern Valley                 1\n"
           "01        10        077       Lauderdale                      1\n"
           "01        10        079       Lawrence\t\t1\n"
           "01        98        888       Combined Counties               1\n"
           "46        70        113       Shannon                         2\n"
           "46        70        102       Oglala Lakota                   1\n")
    p = parse_county_list(lst)
    ck(p == {"01077": "10", "01079": "10", "46102": "70"}, f"county_list rows: current only, no 000/888 rows: {p}")
    ck(parse_parse_json({"counties": {"19001": "1970", "19888": "1998", "19003": "2070"}}) == {"19001": "70"},
       "parse json: state prefix must match, 888 dropped")
    codes = codes_table()
    for k, v in FIPS_ALIAS.items():
        ck(codes.get(k, {}).get("to") == [v], f"Atlas FIPS_ALIAS {k}->{v} is in the table with the same target")
    ck(codes["29193"]["to"] == ["29186"] and codes["46113"]["to"] == ["46102"],
       "real case Oct 27: Ste. Genevieve (FSA 29193) and Oglala Lakota (FSA 46113) fold onto their FIPS")
    ck(all(codes[c]["to"] is None and codes[c]["kind"] == "reshape" for c in CT_REGIONS), "CT regions are never folded")
    spine = ["02013", "02016", "02240", "02261", "09001", "12086", "19155", "23003", "27111", "27119", "27137",
             "29186", "32023", "39095", "46102", "02158", "51019"]
    d = build(spine, {"46102": "70", "19155": "70", "99999": "10", "02270": "50", "02010": "50"}, "test")
    ck(d["asd"] == {"02158": "50", "19155": "70", "46102": "70"}, f"only spine counties carry a district: {d['asd']}")
    ck(d["asd_from"] == {"02158": "02270"}, "a renamed county takes its old code's district, and says so")
    ck("02013" in d["asd_missing"] and "02016" in d["asd_missing"], "a split never hands its district on")
    ck(len(d["asd_missing"]) == len(spine) - 3, "the rest are listed missing, not guessed")
    ck(fold("29193", d) == (["29186"], "rename") and fold("19001", d) == (["19001"], None) and fold("09110", d) == ([], "reshape"),
       "fold: rename, spine, reshape")
    try:
        build(["19155"], {}, "x")
        ck(False, "a fold onto a county missing from the spine must stop the build")
    except AssertionError:
        ck(True, "")
    t = text(d)
    ck(json.loads(t) == d, "text round-trips")
    print(f"build_geo_crosswalk selftest: ok ({ok} checks)")


def main(argv):
    if "--selftest" in argv:
        return selftest()
    spine = spine_codes()
    if "--check" in argv:
        old = committed() or {}
        nass, source = dict(old.get("asd") or {}), (old.get("sources") or {}).get("asd") or ""
        for new, oldc in (old.get("asd_from") or {}).items():
            nass.pop(new, None)
            nass[oldc] = (old.get("asd") or {}).get(new)
        t = refs_copy()
        fresh = parse_county_list(t) if t else {}
        if len(fresh) > 3000:
            moved = sorted(f for f in spine if f in fresh and fresh[f] != nass.get(f))
            if moved:
                print(f"geo-crosswalk: note, the references copy of the NASS list differs on {len(moved)} counties; "
                      "rebuild with python3 scripts/build_geo_crosswalk.py and commit")
    else:
        nass, source = resolve_nass(argv)
    doc = build(spine, nass, source)
    t = text(doc)
    if len(t.encode("utf-8")) > MAX_BYTES:
        print(f"geo-crosswalk: {len(t.encode())} bytes, over the {MAX_BYTES} cap", file=sys.stderr)
        return 1
    if "--check" in argv:
        old = committed()
        if old is None or open(OUT, encoding="utf-8").read() != t:
            diff = sorted(f for f in set(doc["asd"]) | set((old or {}).get("asd") or {})
                          if doc["asd"].get(f) != ((old or {}).get("asd") or {}).get(f))
            print("data/ids/geo-crosswalk.json is not what scripts/build_geo_crosswalk.py builds"
                  + (f" ({len(diff)} district codes differ, e.g. {', '.join(diff[:5])})" if diff else "")
                  + "; run it and commit", file=sys.stderr)
            return 1
        print(f"geo-crosswalk: up to date, {doc['counts']['asd']} of {len(spine)} counties with a district, "
              f"{doc['counts']['codes']} off-spine codes, {len(t.encode())} bytes")
        return 0
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(t)
    print("wrote", os.path.relpath(OUT, ROOT), len(t.encode()), "bytes", doc["counts"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]) or 0)
