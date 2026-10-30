#!/usr/bin/env python3
"""Section key for a recorded land sale (Oct 29, 2026, property panel build step 5).

One short key per sale, where the legal description gives a section, township and range:
  "29-15N-6E"      section 29, township 15 north, range 6 east
  "29-15N-6E-4"    the same, when the legal names its principal meridian (4 = Fourth)
  "17-11?-5?"      Indiana's "17-11-5" shorthand, directions not written (see below)

The key is written into the county transfer files (data/land/<st>/<fips>.json, column "str") by
scripts/fetch_land_sales.py, and only there: data/land/ is blocked in robots.txt, and no indexed
page prints it (Sig decides whether a section may show on indexed pages). Field Scout's comps use
it to put a sale in the reader's own section, or a touching one, first.

Readers, in order:
  1. legal_parts(): the same reading as FSLand.strOf in field-scout-land.js (numerals, or words
     with numerals beside them: "Section Twenty-nine (29), Township fifteen (15) North, Range
     Six (6) E"). test/land-keys.test.mjs runs both over real legals and fails on any difference.
  2. Indiana only: the "section-township-range" shorthand Indiana assessors write ("PT SW 29-18-2W",
     "S1/2 17-11-5", "Sec 6-1n-9e"). Most leave the directions out. A missing direction is kept as
     "?", and only when the county lies wholly on one side of the Second Principal Meridian (for a
     missing E or W) and of its base line (for a missing N or S), so the numbers cannot name two
     places in that county. A key with a "?" is only ever compared inside its own county.
Nothing is guessed: no legal, no key. A legal cut at our 140-character copy that loses its range
gets no key (count_misses() reports how many).

  python3 scripts/land_keys.py --selftest
  python3 scripts/land_keys.py --write [data/land]   rewrite the county files with the column
  python3 scripts/land_keys.py --report [data/land]  per-state reads, misses, cut legals (JSON)
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = os.path.join(ROOT, "data", "atlas", "counties.geo.json")
LEGAL_MAX = 140   # scripts/fetch_land_sales.py LEGAL_MAX (FSLand.LEGAL_MAX)
COL = "str"

# JavaScript's \s, so this reads a legal exactly as the browser does.
_S = "[\t\n\v\f\r    -     　﻿]"
_A = re.ASCII
_WS = re.compile(_S + "+")
_WORDNUM = re.compile(r"\b(?:[A-Z]+-)?[A-Z]+" + _S + r"*\((\d{1,3})\)", _A)
_SEC = re.compile(r"\bSEC(?:TION|S)?\.?" + _S + r"*(\d{1,2})\b", _A)
_TWP = re.compile(r"\bT(?:OWNSHIP|WP)?\.?" + _S + r"*(\d{1,3})" + _S + r"*(N|S)(?:ORTH|OUTH)?\b", _A)
_RNG = re.compile(r"\bR(?:ANGE|GE)?\.?" + _S + r"*(\d{1,3})" + _S + r"*(E|W)(?:AST|EST)?\b", _A)
_PM = re.compile(r"\b(SECOND|THIRD|FOURTH|FIFTH|2ND|3RD|4TH|5TH)" + _S + r"+(?:PRINCIPAL" + _S + r"+MERIDIAN|P\.?" + _S + r"?M\b)", _A)
_PMN = {"SECOND": 2, "2ND": 2, "THIRD": 3, "3RD": 3, "FOURTH": 4, "4TH": 4, "FIFTH": 5, "5TH": 5}
# Indiana shorthand: section-township-range, each 1 or 2 digits, directions optional.
_IN3 = re.compile(r"(?<![\d.\-/])(\d{1,2})-(\d{1,2})" + _S + r"*([NS])?-(\d{1,2})" + _S + r"*([EW])?(?![\d.\-/])", _A)

# Indiana's Second Principal Meridian and its base line (BLM). A county inside this margin of
# either line is treated as straddling it.
IN_PM2_LNG = -86.4667
IN_BASE_LAT = 38.4706
MARGIN = 0.03


def _clean(s):
    s = _WS.sub(" ", "" if s is None else str(s))   # one space per run, as clean() in the browser
    if s.startswith(" "):
        s = s[1:]
    if s.endswith(" "):
        s = s[:-1]
    return s


def _upper(s):
    return s.upper()


def legal_parts(legal):
    """(sec, twp, ns, rng, ew, pm) as FSLand.strOf reads them, or None."""
    s = _upper(_clean(legal))
    if not s:
        return None
    s = _WORDNUM.sub(r"\1", s)
    sec, t, r = _SEC.search(s), _TWP.search(s), _RNG.search(s)
    if not sec or not t or not r:
        return None
    pm = _PM.search(s)
    return int(sec.group(1)), int(t.group(1)), t.group(2), int(r.group(1)), r.group(2), (_PMN[pm.group(1)] if pm else None)


def _fmt(sec, twp, ns, rng, ew, pm=None):
    return "%d-%d%s-%d%s%s" % (sec, twp, ns, rng, ew, "-%d" % pm if pm else "")


def legal_key(legal):
    """The key from the legal alone (FSLand.strKey in field-scout-land.js), or None."""
    p = legal_parts(legal)
    if not p or not (1 <= p[0] <= 36) or p[1] < 1 or p[3] < 1:
        return None
    return _fmt(*p)


_SIDES = {}


def county_sides(fips, geo=GEO):
    """(one_ew, one_ns) for an Indiana county: True when the county lies wholly on one side of
    the Second Principal Meridian (one_ew) or its base line (one_ns)."""
    if not _SIDES:
        g = json.load(open(geo, encoding="utf-8"))
        for f in g["features"]:
            if str(f.get("id", "")).startswith("18"):
                gm = f["geometry"]
                polys = [gm["coordinates"]] if gm["type"] == "Polygon" else gm["coordinates"]
                xs = [p[0] for poly in polys for ring in poly for p in ring]
                ys = [p[1] for poly in polys for ring in poly for p in ring]
                one_ew = max(xs) < IN_PM2_LNG - MARGIN or min(xs) > IN_PM2_LNG + MARGIN
                one_ns = max(ys) < IN_BASE_LAT - MARGIN or min(ys) > IN_BASE_LAT + MARGIN
                _SIDES[str(f["id"])] = (one_ew, one_ns)
    return _SIDES.get(str(fips), (False, False))


def in_short_key(legal, fips, geo=GEO):
    """Indiana's "29-18-2W" shorthand, or None. Townships 1 to 40, ranges 1 to 20 (Indiana's run
    T7S to T38N, R14W to R15E), sections 1 to 36. A missing direction is "?" and needs the county
    wholly on one side of the line it would name."""
    m = _IN3.search(_upper(_clean(legal)))
    if not m:
        return None
    sec, twp, ns, rng, ew = int(m.group(1)), int(m.group(2)), m.group(3), int(m.group(4)), m.group(5)
    if not (1 <= sec <= 36 and 1 <= twp <= 40 and 1 <= rng <= 20):
        return None
    if not ns or not ew:
        one_ew, one_ns = county_sides(fips, geo)
        if (not ew and not one_ew) or (not ns and not one_ns):
            return None
    return _fmt(sec, twp, ns or "?", rng, ew or "?")


def key_for(st, legal, fips=None, geo=GEO):
    """The section key for one sale: the legal as strOf reads it, then the state's own shorthand."""
    k = legal_key(legal)
    if k or str(st).upper() != "IN":
        return k
    return in_short_key(legal, fips, geo)


def add_column(doc, geo=GEO):
    """Put the "str" column into one county file's dict (in place), right after "legal".
    Recomputed from the legal every time, so a file written before the column gets it."""
    cols = doc["cols"]
    if COL in cols:
        i = cols.index(COL)
        cols.pop(i)
        for row in doc["rows"]:
            row.pop(i)
    li = cols.index("legal")
    cols.insert(li + 1, COL)
    for row in doc["rows"]:
        row.insert(li + 1, key_for(doc.get("state"), row[li], doc.get("fips"), geo))
    return doc


def write(out):
    """Rewrite every county file under out/<st>/ with the column; returns {st: (files, keyed, rows)}."""
    done = {}
    for p in sorted(glob.glob(os.path.join(out, "*", "[0-9]*.json"))):
        doc = json.load(open(p, encoding="utf-8"))
        if "cols" not in doc or "legal" not in doc["cols"]:
            continue
        add_column(doc)
        with open(p, "w", encoding="utf-8") as f:
            f.write(json.dumps(doc, separators=(",", ":")))
        st = doc.get("state") or os.path.basename(os.path.dirname(p)).upper()
        i = doc["cols"].index(COL)
        a = done.setdefault(st, [0, 0, 0])
        a[0] += 1
        a[1] += sum(1 for r in doc["rows"] if r[i])
        a[2] += len(doc["rows"])
    return done


_CUT_HINT = re.compile(r"\bSEC(?:TION|S)?\.?" + _S + r"*\d{1,2}\b", _A)


def count_misses(out):
    """Per state: rows, rows with a legal, keyed (by the legal, by the shorthand), and of the
    misses how many are legals at our 140-character cut, and how many of those read a section
    but lose the township or range (the cut most likely took the key)."""
    rep = {}
    for p in sorted(glob.glob(os.path.join(out, "*", "[0-9]*.json"))):
        doc = json.load(open(p, encoding="utf-8"))
        if "cols" not in doc or "legal" not in doc["cols"]:
            continue
        st = doc.get("state")
        li = doc["cols"].index("legal")
        a = rep.setdefault(st, {"rows": 0, "with_legal": 0, "keyed": 0, "by_legal": 0, "by_shorthand": 0, "dir_unwritten": 0,
                                "miss": 0, "miss_at_cut": 0, "miss_at_cut_section_read": 0})
        for row in doc["rows"]:
            a["rows"] += 1
            leg = _clean(row[li])
            if not leg:
                continue
            a["with_legal"] += 1
            k1 = legal_key(leg)
            k = k1 or (in_short_key(leg, doc.get("fips")) if st == "IN" else None)
            if k:
                a["keyed"] += 1
                a["by_legal" if k1 else "by_shorthand"] += 1
                a["dir_unwritten"] += "?" in k
                continue
            a["miss"] += 1
            if len(leg) >= LEGAL_MAX - 2:
                a["miss_at_cut"] += 1
                if _CUT_HINT.search(_WORDNUM.sub(r"\1", _upper(leg))):
                    a["miss_at_cut_section_read"] += 1
    for a in rep.values():
        a["pct"] = round(100.0 * a["keyed"] / a["rows"], 1) if a["rows"] else None
    return rep


def selftest():
    bad = []

    def ck(name, ok):
        print(("ok   " if ok else "FAIL ") + name)
        if not ok:
            bad.append(name)

    # real Wisconsin legal (data/land/wi/55001.json, Adams County, doc 600390)
    adams = "The Northeast One-quarter (1/4) of the Southwest One-quarter (1/4) of Section Twenty-nine (29), Township fifteen (15) North, Range Six (6) E"
    ck("WI words with numerals: 29-15N-6E", key_for("WI", adams) == "29-15N-6E")
    ck("plain numerals", key_for("WI", "SE NE SEC 12 T33N R10W") == "12-33N-10W")
    ck("meridian kept", key_for("IL", "PART OF SEC 3 T25N R6E OF THE 4TH PRINCIPAL MERIDIAN") == "3-25N-6E-4")
    ck("range cut at 140: no key", key_for("WI", "The SE 1/4 of the NW 1/4, Section Seventeen (17), Township Eighteen (18) North, Range Twen") is None)
    ck("no section: no key", key_for("WI", "Lot 1 CSM 6536 Town of Easton Adams County, Wisconsin") is None)
    ck("section 37 is not a section", key_for("WI", "SEC 37 T33N R10W") is None)
    ck("shorthand only in Indiana", key_for("WI", "PT SW 29-18-2W") is None)
    g = os.path.join(os.environ.get("TMPDIR", "/tmp"), "land_keys_geo.json")
    sq = lambda x0, y0, x1, y1: {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}
    json.dump({"features": [{"id": "18001", "properties": {}, "geometry": sq(-85.1, 40.5, -84.8, 40.9)},       # east of the meridian, north of the line
                            {"id": "18011", "properties": {}, "geometry": sq(-86.7, 39.9, -86.2, 40.2)},       # on the meridian (Boone)
                            {"id": "18025", "properties": {}, "geometry": sq(-86.6, 38.1, -86.2, 38.5)}]},     # on both (Crawford)
              open(g, "w"))
    _SIDES.clear()
    ck("IN directions written", key_for("IN", "PT SW 29-18N-2W 134.17A", "18011", g) == "29-18N-2W")
    ck("IN range direction only", key_for("IN", "PT W1/2 SE 33-20-2W 71.10A", "18001", g) == "33-20?-2W")
    ck("IN none written, one-sided county", key_for("IN", "S1/2 17-11-5 123.28a", "18001", g) == "17-11?-5?")
    ck("IN none written, county on the meridian: no key", key_for("IN", "S1/2 17-11-5 123.28a", "18011", g) is None)
    ck("IN range written, county on the base line: no key", key_for("IN", "NW SW 32-2-1W", "18025", g) is None)
    ck("IN lower case", key_for("IN", "Sec 6-1n-9e 20.646 Ac Remains", "18011", g) == "6-1N-9E")
    ck("IN a date is not a key", key_for("IN", "RECORDED 10-12-2021", "18001", g) is None)
    ck("IN decimal acres are not a key", key_for("IN", "TRACT 1.5-2-3", "18001", g) is None)
    ck("IN strOf first", key_for("IN", "SEC 4 T27N R14E 17-11-5", "18001", g) == "4-27N-14E")
    d = {"state": "IN", "fips": "18001", "cols": ["doc", "legal", "exempt"], "rows": [["a", "S1/2 17-11-5", 0], ["b", "", 0]]}
    add_column(d, g)
    ck("column after legal", d["cols"] == ["doc", "legal", "str", "exempt"] and d["rows"][0] == ["a", "S1/2 17-11-5", "17-11?-5?", 0] and d["rows"][1][2] is None)
    add_column(d, g)
    ck("column written again, not twice", d["cols"].count("str") == 1 and len(d["rows"][0]) == 4)
    _SIDES.clear()
    os.remove(g)
    print("%d failed" % len(bad) if bad else "all passed")
    return not bad


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["--selftest"]:
        sys.exit(0 if selftest() else 1)
    if a[:1] == ["--write"]:
        print(json.dumps(write(a[1] if len(a) > 1 else os.path.join(ROOT, "data", "land"))))
        sys.exit(0)
    if a[:1] == ["--report"]:
        print(json.dumps(count_misses(a[1] if len(a) > 1 else os.path.join(ROOT, "data", "land")), indent=1))
        sys.exit(0)
    print(__doc__)
    sys.exit(2)
