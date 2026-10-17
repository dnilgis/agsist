#!/usr/bin/env python3
"""
data/breakeven/<ST>.json: the one small file per state that /breakeven loads
when a county is picked (or filled from the reader's saved location).

It carries only what the calculator uses, cut from files other builds own:

  * land rent and the paired county trend yield, from data/cash-rent/<ST>.json
    (scripts/fetch_cash_rent.py: USDA NASS county cash rent and county yields,
    the same pairing rule as /rent: a dryland rent with a dryland trend);
  * the expected ARC-CO and PLC payment per base acre for corn and soybeans,
    2026 and 2027, as scripts/build_arc_plc.py figured them for the county
    pages (data/arc-plc/math/<ST>.json), with that build's verdict.

Nothing is figured here except picking the right practice row; numbers are
carried as the source builds wrote them. The page used to load the whole
cash-rent state file (about 200 KB) for two numbers a county.

  python3 scripts/build_breakeven_data.py           write
  python3 scripts/build_breakeven_data.py --check   exit 1 if any file is stale
  python3 scripts/build_breakeven_data.py --selftest

Run after either source changes (cash-rent.yml and arc-plc-refresh.yml do).
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RENT_DIR = "data/cash-rent"
ARC_DIR = "data/arc-plc/math"
ARC_TOP = "data/arc-plc.json"
OUT_DIR = "data/breakeven"
# cash-rent practice key -> the ARC/PLC build's practice row label
PRACTICE = {"nonirr": "non", "irr": "irr", "all": "all"}
YIELD_KEYS = (("corn", "corn"), ("beans", "soybeans"))
# County names as the Census writes them, by FIPS (McLean, DeKalb, LaSalle, St. Clair,
# O'Brien, Lac qui Parle). NASS's names come title-cased from capitals ("MCLEAN" ->
# "Mclean"), which the page printed as "Mclean County" (Oct 17, 2026 re-score).
GEO = "data/atlas/counties.geo.json"
_NAMES = None


def official_names(root=ROOT):
    global _NAMES
    if _NAMES is None:
        try:
            g = json.loads((Path(root) / GEO).read_text(encoding="utf-8"))
            _NAMES = {str(f.get("id")): (f.get("properties") or {}).get("name") for f in g.get("features") or []}
        except (OSError, ValueError):
            _NAMES = {}
    return _NAMES


def fix_case(name):
    """A NASS title-cased name when the Census list has no entry: Mc, and the small
    words of a multi-word name, the way the Census writes them."""
    n = re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), str(name or ""))
    n = re.sub(r"(?<=\s)(Of|The|Qui)\b", lambda m: m.group(1).lower(), n)
    return n


def county_name(c, names=None):
    names = official_names() if names is None else names
    off, nass = names.get(str(c.get("fips"))), str(c.get("name") or "")
    if off and nass.endswith(" City") and not off.endswith(" City"):
        off += " City"      # Virginia's independent cities: the Census name drops the word
    return off or fix_case(nass)


def latest(series):
    ys = [int(y) for y, v in (series or {}).items() if v is not None and str(y).isdigit()]
    if not ys:
        return None
    y = max(ys)
    return y, series[str(y)]


def pick_row(rows, labels, rent_key):
    """The practice row that matches the rent: one row is the county's only
    row; two (irrigated and non-irrigated) take the rent's practice; anything
    else is no estimate rather than a guess."""
    if not rows:
        return None
    if len(rows) == 1 and len(labels) <= 1:
        return rows[0]
    want = PRACTICE.get(rent_key or "")
    hits = [i for i, d in enumerate(labels) if d == want]
    if len(hits) == 1 and hits[0] < len(rows):
        return rows[hits[0]]
    return None


def arc_for(rec, crop, rent_key):
    if not rec:
        return None
    rows = (rec.get("v") or {}).get(crop) or []
    labels = [e.get("d") for e in ((rec.get("e") or {}).get(crop) or [])]
    if not rows:
        return None
    if len(rows) > 1 and pick_row(rows, labels, rent_key) is None:
        return {"why": "two practices"}
    row = pick_row(rows, labels, rent_key)
    if not row:
        return None
    out = {}
    for y, p in sorted(row.items()):
        if not p:
            continue
        if p[0] == "withheld" or len(p) < 3:
            out[y] = [p[0]]
        else:
            out[y] = [p[0], int(p[1]), int(p[2])]
    return out or None


def county(c, arc_rec):
    out = {"f": c["fips"], "n": county_name(c)}
    pair = c.get("pair") or {}
    rk = pair.get("rent")
    r = latest((c.get("rent") or {}).get(rk)) if rk else None
    if r:
        out["r"] = [r[1], r[0], rk]
    ys = {}
    for k, _crop in YIELD_KEYS:
        t = (pair.get(k) or {}).get("t") or {}
        if t.get("v") is not None:
            ys[k] = {"v": t["v"], "s": t.get("slope"), "b": t.get("b")}
        else:
            ys[k] = {"w": t["w"]} if t.get("w") else {}
    out["y"] = ys
    if arc_rec:
        a = {}
        for _k, crop in YIELD_KEYS:
            v = arc_for(arc_rec, crop, rk)
            if v:
                a[crop] = v
        if a:
            out["a"] = a
        out["s"] = arc_rec.get("s")
    return out


def build_state(st, rent, arc, top):
    recs = (arc or {}).get("c") or {}
    years = (top or {}).get("years") or {}
    pay = {y: (years.get(y) or {}).get("pay_after") for y in ("2026", "2027") if (years.get(y) or {}).get("pay_after")}
    return {
        "st": st,
        "rent_gen": rent.get("generated"),
        "arc_updated": (arc or {}).get("updated"),
        "pay": pay,
        "c": sorted((county(c, recs.get(c["fips"])) for c in rent.get("counties") or []), key=lambda x: x["n"]),
    }


def outputs(root=ROOT):
    root = Path(root)
    try:
        top = json.loads((root / ARC_TOP).read_text())
    except (OSError, ValueError):
        top = None
    out = {}
    for f in sorted((root / RENT_DIR).glob("*.json")):
        st = f.stem
        if len(st) != 2 or not st.isupper():
            continue
        rent = json.loads(f.read_text())
        try:
            arc = json.loads((root / ARC_DIR / f.name).read_text())
        except (OSError, ValueError):
            arc = None
        doc = build_state(st, rent, arc, top)
        out[f"{OUT_DIR}/{st}.json"] = json.dumps(doc, separators=(",", ":"), ensure_ascii=False) + "\n"
    return out


def selftest():
    fails = []

    def ck(name, cond):
        print(("  ok   " if cond else "::error::build_breakeven_data selftest FAIL ") + name)
        if not cond:
            fails.append(name)

    rent = {"generated": "2026-10-06", "counties": [
        {"fips": "19169", "name": "Story", "rent": {"nonirr": {"2025": 278.0, "2026": 290.0}},
         "pair": {"rent": "nonirr", "corn": {"t": {"v": 217.2, "slope": 3.867, "b": "all"}}, "beans": {"t": {"w": "too few years"}}}},
        {"fips": "31001", "name": "Adams", "rent": {"irr": {"2026": 300.0}, "nonirr": {"2026": 150.0}},
         "pair": {"rent": "irr", "corn": {"t": {"v": 230.0, "slope": 2.0, "b": "irr"}}}},
    ]}
    arc = {"updated": "2026-10-16", "c": {
        "19169": {"s": "story-county", "e": {"corn": [{"d": "all"}], "soybeans": [{"d": "all"}]},
                  "v": {"corn": [{"2026": ["lean_arc", 113, 644, 0, 4, 11, 531, 4, 0, 5], "2027": ["close", 1243, 1520, 1, 2, 11, 277, 3, 0, 3]}],
                        "soybeans": [{"2026": ["withheld", 3], "2027": ["mismatch"]}]}},
        "31001": {"s": "adams-county", "e": {"corn": [{"d": "irr"}, {"d": "non"}]},
                  "v": {"corn": [{"2026": ["plc", 900, 100, 9, 1, 10, 800, 0, 0, 8]}, {"2026": ["arc", 100, 700, 1, 9, 10, 600, 0, 0, 6]}]}},
    }}
    top = {"years": {"2026": {"pay_after": "2027-10-01"}, "2027": {"pay_after": "2028-10-01"}}}
    d = build_state("XX", rent, arc, top)
    story = [c for c in d["c"] if c["f"] == "19169"][0]
    adams = [c for c in d["c"] if c["f"] == "31001"][0]
    ck("newest rent with its year and practice", story["r"] == [290.0, 2026, "nonirr"])
    ck("trend carried as built, with slope", story["y"]["corn"] == {"v": 217.2, "s": 3.867, "b": "all"})
    ck("a withheld trend keeps its reason", story["y"]["beans"] == {"w": "too few years"})
    ck("ARC/PLC expected cents carried as figured", story["a"]["corn"]["2026"] == ["lean_arc", 113, 644])
    ck("withheld carries no number", story["a"]["soybeans"]["2026"] == ["withheld"])
    ck("irrigated rent takes the irrigated row", adams["a"]["corn"]["2026"] == ["plc", 900, 100])
    ck("pay dates from the program file", d["pay"] == {"2026": "2027-10-01", "2027": "2028-10-01"})
    ck("county page slug", story["s"] == "story-county")
    ck("counties sorted by name", [c["n"] for c in d["c"]] == ["Adams", "Story"])
    names = official_names()
    ck("Census names by FIPS: McLean, DeKalb, LaSalle, St. Clair, O'Brien, Lac qui Parle",
       [county_name({"fips": f, "name": n}) for f, n in (("17113", "Mclean"), ("17037", "Dekalb"), ("17099", "Lasalle"),
                                                         ("17163", "St Clair"), ("19141", "Obrien"), ("27073", "Lac Qui Parle"))]
       == ["McLean", "DeKalb", "LaSalle", "St. Clair", "O'Brien", "Lac qui Parle"] if names else True)
    ck("no Census entry: Mc and the small words fixed", county_name({"fips": "99999", "name": "Mcduffie"}, {}) == "McDuffie"
       and fix_case("Lake Of The Woods") == "Lake of the Woods" and fix_case("Macon") == "Macon")
    for st in ("IL", "KY", "GA", "MN"):
        p = ROOT / OUT_DIR / (st + ".json")
        if p.exists():
            bad = [c["n"] for c in json.loads(p.read_text())["c"] if re.search(r"\bMc[a-z]", c["n"])]
            ck(st + ": no 'Mc' county name in lower case on disk", not bad)
    if fails:
        print("selftest FAILED: %d" % len(fails))
        return 1
    print("selftest ok")
    return 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    out = outputs()
    stale = []
    for rel, text in out.items():
        p = ROOT / rel
        old = p.read_text(encoding="utf-8") if p.exists() else None
        if old != text:
            stale.append(rel)
            if "--check" not in argv:
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(text, encoding="utf-8")
    extra = [str(p.relative_to(ROOT)) for p in (ROOT / OUT_DIR).glob("*.json") if str(p.relative_to(ROOT)) not in out] if (ROOT / OUT_DIR).exists() else []
    if "--check" in argv:
        if stale or extra:
            print("STALE %s: run python3 scripts/build_breakeven_data.py" % ", ".join(stale + extra))
            return 1
        print("ok    %d breakeven state files" % len(out))
        return 0
    for rel in extra:
        (ROOT / rel).unlink()
    print("wrote %d of %d breakeven state files" % (len(stale), len(out)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
