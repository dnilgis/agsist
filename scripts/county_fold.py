#!/usr/bin/env python3
"""The one county code fold (god's-eye build 1, Nov 9 2026). Every county builder imports it from here.

Every county file on the site joins on the 3,141 county FIPS codes of data/atlas/counties.geo.json (the
spine: Census 2010-vintage outlines, eight old Connecticut counties, 02261 Valdez-Cordova, 46102 Oglala
Lakota). Federal files do not all write those codes. Before this module the fold lived in four places
(build_geo_crosswalk.EXTRA, build_farmland_atlas.FIPS_ALIAS, atlas_geometry.FIPS_RENAMED and
fetch_atlas_crp.FIPS_RENAME), and they disagreed: the CRP fetcher folded Clifton Forge and South Boston
VA, which the crosswalk did not know; the crosswalk folded Ste. Genevieve MO (29193), which no builder did.

TABLE holds every code a federal file publishes that is NOT a spine county, with what it is:
  rename   the same ground under a new code: exact
  merger   a place that merged into `to`: its ground is part of `to` now
  part     an agency's admin area inside one county (FSA and RMA split a few big counties in two)
  office   an FSA office area named for a town, placed on the county that town is in (approximate)
  split    one spine polygon holds the pieces (02063 and 02066 both sit on 02261), or one old code
           covers several spine counties (02010 -> 02013 and 02016)
  reshape  Connecticut's 2022 planning regions cross the eight old county lines; `to` is None. No area
           shares are in this repo, so a region is never put on a county: a builder that meets one says
           so (lossy, no county value) and never invents a county figure from it.

Two questions, two functions:
  resolve(code)  -> Fold(to, kind, lossy): every spine county the code touches and how, for joins and
                    reports. lossy is True for part, office, split and reshape.
  fold(code)     -> the one spine code a builder keyed by county may file this code's record under, or
                    the code unchanged. Only rows with onto=True fold here: renames, mergers, RMA's second
                    rating area of one county (its book adds onto the county) and the two 2019 Alaska
                    pieces of the one 2010 polygon. FSA office parts, offices, a one-to-many split and the
                    CT regions are left as they are, so nothing lands on a county as if it were the county.

data/ids/geo-crosswalk.json is the published copy of TABLE (scripts/build_geo_crosswalk.py writes it;
`onto` is not written). test/county-fold.test.mjs fails if another script defines its own alias table.

Usage: python3 scripts/county_fold.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
from collections import namedtuple
import sys

# builder-only fields, not published: onto (fold files it under its target), new_name and dropped
# (atlas_geometry renames or drops the 2010 boundary file's feature with these)
BUILDER_ONLY = ("onto", "new_name", "dropped")
LOSSY = frozenset({"part", "office", "split", "reshape"})
KINDS = ("rename", "part", "office", "merger", "split", "reshape")

TABLE = {
    # The Atlas fold since Sep 2026 (was build_farmland_atlas.FIPS_ALIAS); "atlas": True is kept in the
    # published file so its readers see the same rows.
    "46113": dict(to=["46102"], kind="rename", agencies=["fsa", "nass"], name="Shannon SD -> Oglala Lakota",
                  since="2015-05-01", atlas=True, onto=True, new_name="Oglala Lakota"),
    "02270": dict(to=["02158"], kind="rename", agencies=["nass"], name="Wade Hampton AK -> Kusilvak",
                  since="2015-07-01", atlas=True, onto=True, new_name="Kusilvak"),
    "51515": dict(to=["51019"], kind="merger", agencies=["fsa", "nass"], name="Bedford city VA -> Bedford County",
                  since="2013-07-01", atlas=True, onto=True,
                  dropped="Bedford city VA reverted to a town and merged into 51019 on 2013-07-01"),
    "02063": dict(to=["02261"], kind="split", agencies=["usdm"], name="Chugach AK, out of Valdez-Cordova",
                  since="2019-01-02", atlas=True, onto=True),
    "02066": dict(to=["02261"], kind="split", agencies=["usdm"], name="Copper River AK, out of Valdez-Cordova",
                  since="2019-01-02", atlas=True, onto=True),
    # Dade FL -> Miami-Dade, 1997. RMA kept writing 12025 into 2002.
    "12025": dict(to=["12086"], kind="rename", agencies=["rma"], name="Dade FL -> Miami-Dade",
                  since="1997", atlas=True, onto=True),
    # RMA split three big counties into two rating areas through 2012; the second code is the other half
    # of the same county, with its own policies. Its 1989-2012 book belongs on the county's polygon, added
    # (panel 9/19: the 19156 "W Pottawattamie" record sat off the map and 19155 ran short).
    "19156": dict(to=["19155"], kind="part", agencies=["fsa", "rma"], name="West Pottawattamie IA", atlas=True, onto=True),
    "27112": dict(to=["27111"], kind="part", agencies=["fsa", "rma"], name="West Otter Tail MN", atlas=True, onto=True),
    "27120": dict(to=["27119"], kind="part", agencies=["fsa", "rma"], name="West Polk MN", atlas=True, onto=True),
    # Codes our sources publish, each from a file in this repo (agencies) and checked by hand against the
    # name that file prints beside the code (was build_geo_crosswalk.EXTRA, Oct 27).
    "29193": dict(to=["29186"], kind="rename", agencies=["fsa"], name="Ste. Genevieve MO", onto=True,
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
    # FSA CRP files (was fetch_atlas_crp.FIPS_RENAME): two Virginia cities that became towns.
    "51560": dict(to=["51005"], kind="merger", agencies=["fsa"], name="Clifton Forge city VA -> Alleghany County",
                  since="2001-07-01", onto=True),
    "51780": dict(to=["51083"], kind="merger", agencies=["fsa"], name="South Boston city VA -> Halifax County",
                  since="1995-06-30", onto=True),
}
CT_REGIONS = {"09110": "Capitol", "09120": "Greater Bridgeport", "09130": "Lower Connecticut River Valley",
              "09140": "Naugatuck Valley", "09150": "Northeastern Connecticut", "09160": "Northwest Hills",
              "09170": "South Central Connecticut", "09180": "Southeastern Connecticut", "09190": "Western Connecticut"}
for _c, _n in CT_REGIONS.items():
    TABLE[_c] = dict(to=None, kind="reshape", agencies=["rma", "usdm"], name=_n + " planning region CT", since="2022",
                     note="crosses the eight old county lines; no area shares in this repo, not folded")
TABLE = dict(sorted(TABLE.items()))

# The codes a builder keyed by county files under their target, and the renames among them (one place
# under two codes: a builder may JOIN their year-keyed records; the others keep first-code-wins).
ONTO = {c: r["to"][0] for c, r in TABLE.items() if r.get("onto")}
RENAMES = frozenset(c for c, r in TABLE.items() if r.get("onto") and (r["kind"] == "rename" or r.get("atlas") and r["kind"] == "part"))

Fold = namedtuple("Fold", "to kind lossy")


def fold(code):
    """The spine code a builder keyed by county files this code under; the code itself otherwise."""
    return ONTO.get(code, code)


def resolve(code, spine=None, table=None):
    """-> Fold(to, kind, lossy). to: tuple of spine codes (empty when none); kind: None for a code not in the
    table (a spine county, or a code nobody listed), else the table's kind. With `spine`, a code on it is
    direct and targets off it are dropped. `table` lets a reader pass the published JSON copy."""
    code = str(code or "").strip()
    if spine is not None and code in spine:
        return Fold((code,), None, False)
    row = (TABLE if table is None else table).get(code)
    if row is None:
        return Fold((code,) if spine is None else (), None, False)
    to = tuple(t for t in (row.get("to") or []) if spine is None or t in spine)
    return Fold(to, row["kind"], row["kind"] in LOSSY)


def published(row):
    """A TABLE row as data/ids/geo-crosswalk.json writes it (builder-only fields dropped)."""
    return {k: v for k, v in row.items() if k not in BUILDER_ONLY}


def lossy_note(code):
    """One plain line for a builder's output when it meets a code it cannot put on a county."""
    r = resolve(code)
    row = TABLE.get(code) or {}
    if r.kind == "reshape":
        return f"{code} {row['name']}: crosses the old county lines, kept as published, no county value"
    if r.kind and r.lossy:
        return f"{code} {row['name']}: {r.kind} of {', '.join(r.to)}, kept as published, no county value"
    return None


def selftest():
    ok = 0

    def ck(cond, msg):
        nonlocal ok
        if not cond:
            raise SystemExit("county_fold selftest FAILED: " + msg)
        ok += 1

    # real cases (status audit Nov 9): FSA ARC files Ste. Genevieve MO under 29193 and Oglala Lakota under
    # 46113; the Drought Monitor writes Connecticut's planning regions (09110 Capitol)
    ck(fold("29193") == "29186" and resolve("29193") == ((("29186",), "rename", False)), "Ste. Genevieve 29193 -> 29186")
    ck(TABLE["29193"]["name"] == "Ste. Genevieve MO", "the row names Ste. Genevieve")
    ck(fold("46113") == "46102" and "46113" in RENAMES, "Shannon 46113 -> Oglala Lakota 46102, a rename (joined)")
    ck(fold("09110") == "09110", "a CT region is never filed under a county")
    r = resolve("09110")
    ck(r.to == () and r.kind == "reshape" and r.lossy, f"09110 resolves lossy with no county: {r}")
    ck("no county value" in lossy_note("09110") and "Capitol" in lossy_note("09110"), "the lossy line says so")
    ck(all(resolve(c).lossy and fold(c) == c for c in CT_REGIONS), "all nine CT regions")
    # parts and offices FSA writes are not filed as the county
    for c in ("27138", "39094", "23002", "23004", "32035", "02002", "02010"):
        ck(fold(c) == c and resolve(c).lossy, f"{c} stays as published")
    ck(resolve("02010").to == ("02013", "02016"), "one old code onto two counties")
    # the old Atlas fold, unchanged
    old_atlas = {"46113": "46102", "02270": "02158", "51515": "51019", "02063": "02261", "02066": "02261",
                 "12025": "12086", "19156": "19155", "27112": "27111", "27120": "27119"}
    ck(all(fold(k) == v for k, v in old_atlas.items()), "every code the Atlas folded folds the same")
    ck(RENAMES == {"46113", "02270", "12025", "19156", "27112", "27120", "29193"}, f"renames: {sorted(RENAMES)}")
    # the old CRP fold, unchanged
    old_crp = {"46113": "46102", "12025": "12086", "02270": "02158", "51515": "51019", "51560": "51005", "51780": "51083"}
    ck(all(fold(k) == v for k, v in old_crp.items()), "every code the CRP fetcher folded folds the same")
    # with a spine
    sp = {"29186", "19001", "02013"}
    ck(resolve("19001", sp) == (("19001",), None, False), "spine county is direct")
    ck(resolve("29193", sp).to == ("29186",), "fold onto the spine")
    ck(resolve("02010", sp).to == ("02013",), "targets off the spine are dropped")
    ck(resolve("99999", sp) == ((), None, False), "an unknown code reaches nothing")
    ck(resolve("09110", sp, {"09110": {"to": None, "kind": "reshape"}}).lossy, "a passed table is read")
    for c, row in TABLE.items():
        ck(row["kind"] in KINDS and row["name"] and row["agencies"], f"{c}: kind, name, agencies")
        ck((row["to"] is None) == (row["kind"] == "reshape"), f"{c}: only a reshape has no target")
        ck(not row.get("onto") or len(row["to"]) == 1, f"{c}: onto needs one target")
        ck(not set(BUILDER_ONLY) & set(published(row)), f"{c}: builder-only fields are not published")
    print(f"county_fold selftest: ok ({ok} checks)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
