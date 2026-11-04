#!/usr/bin/env python3
"""Buyer and seller names apart from the county transfer files (lead decision on PR 324, Nov 4, 2026).

Sig's rule (STANDING-DECISIONS, Oct 27): names load only on a reader's tap, from separate names files in the
robots-blocked folder. So a county transfer file, data/land/<st>/<fips>.json, carries no grantor or grantee column.
Its names sit in data/land/<st>/names/<fips>.json, one [seller, buyer] pair per row of the county file, in the same
order, stamped with the county file's read time and row count (a tap trusts the pair only when both match):

    {"state": "WI", "fips": "55005", "fetched_utc": "...", "n": 1234, "cols": ["grantor", "grantee"], "rows": [[s, b], ...]}

What stays in the county file is two numbers, si and bi: the seller's and the buyer's place in the county's list of
distinct names (written up the way build_land_summary.up does it), null when the record names no one. The one market
rule (build_land_summary.sale_rows, FSLand.saleRows) needs only whether two rows have the same seller or buyer, and
these answer that with no name in them. A legal description that names the row's own seller or buyer keeps NAME_MARK
in its place.

Writers: scripts/fetch_land_sales.py build (every run), and --split here for county files written before.
Readers that need a name (the land-sales names files, the monthly buyers, the Illinois index's buyer type, the leak
checks) put them back in memory with attach() / load(); no page reads a county file for a name.

  python3 scripts/land_names.py --selftest
  python3 scripts/land_names.py --split [data/land]   move names out of every county file still holding them
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAND = os.path.join(ROOT, "data", "land")
NAME_COLS = ("grantor", "grantee")
ID_COLS = ("si", "bi")
NAME_MARK = "[NAME]"     # where a legal named the sale's own seller or buyer (components/land-sales.js shows a tap hint)


def up(v):
    """build_land_summary.up (FSLand up): spaces collapsed, upper case."""
    return re.sub(r"\s+", " ", "" if v is None else str(v)).strip().upper()


def rel_path(st, fips):
    return "/data/land/%s/names/%s.json" % (str(st).lower(), fips)


def path_for(land_dir, st, fips):
    return os.path.join(land_dir, str(st).lower(), "names", "%s.json" % fips)


def has_names(doc):
    return any(c in (doc.get("cols") or []) for c in NAME_COLS)


def blank_names(legal, pair):
    """The legal description with the row's own seller and buyer (5 letters or more, any case, any spacing) as NAME_MARK."""
    t = "" if legal is None else str(legal)
    for v in pair:
        for n in str(v or "").split(";"):
            n = re.sub(r"\s+", " ", n).strip()
            if len(n) >= 5:
                rx = r"\s+".join(re.escape(w) for w in n.split(" "))
                t = re.sub(rx, NAME_MARK, t, flags=re.I)
    return t


def split(doc):
    """(county doc with no name column and si, bi added; names doc). Changes neither input; a doc with no
    name column comes back as it is, with names None."""
    cols = list(doc.get("cols") or [])
    if not has_names(doc):
        return doc, None
    ix = [cols.index(c) if c in cols else None for c in NAME_COLS]
    keep = [i for i, c in enumerate(cols) if c not in NAME_COLS and c not in ID_COLS]
    li = cols.index("legal") if "legal" in cols else None
    ids = [{}, {}]
    rows, pairs = [], []
    for r in doc.get("rows") or []:
        pair = [r[i] if i is not None and i < len(r) else None for i in ix]
        pairs.append([p if p != "" else None for p in pair])
        nums = []
        for side in (0, 1):
            k = up(pair[side])
            nums.append(ids[side].setdefault(k, len(ids[side])) if k else None)
        row = [r[i] for i in keep]
        if li is not None and r[li]:
            row[keep.index(li)] = blank_names(r[li], pair)
        rows.append(row + nums)
    out = dict(doc)
    out["cols"] = [cols[i] for i in keep] + list(ID_COLS)
    out["rows"] = rows
    out["names"] = any(p[0] or p[1] for p in pairs)
    out["names_file"] = rel_path(doc.get("state"), doc.get("fips"))
    names = {"state": doc.get("state"), "fips": doc.get("fips"), "fetched_utc": doc.get("fetched_utc"), "n": len(rows),
             "cols": list(NAME_COLS), "rows": pairs}
    return out, names


def attach(doc, names):
    """The county doc with grantor and grantee put back from its names doc, in memory only. A names doc that
    does not belong to this file (another read time or row count) attaches nothing."""
    if has_names(doc) or not names:
        return doc
    if names.get("n") != len(doc.get("rows") or []) or str(names.get("fetched_utc")) != str(doc.get("fetched_utc")):
        return doc
    out = dict(doc)
    out["cols"] = list(doc["cols"]) + list(NAME_COLS)
    out["rows"] = [list(r) + list(p) for r, p in zip(doc["rows"], names["rows"])]
    return out


def load(doc, land_dir=LAND):
    """attach() with the names file on disk next to the county file, when there is one."""
    if not doc or has_names(doc):
        return doc
    p = path_for(land_dir, doc.get("state") or "", doc.get("fips") or "")
    try:
        with open(p, encoding="utf-8") as fh:
            return attach(doc, json.load(fh))
    except (OSError, ValueError):
        return doc


def write(land_dir, st, doc, names):
    """Write a county doc's names file (or remove a stale one when the doc names no one). Bytes written."""
    p = path_for(land_dir, st, doc["fips"])
    if not names:
        if os.path.exists(p):
            os.remove(p)
        return 0
    os.makedirs(os.path.dirname(p), exist_ok=True)
    s = json.dumps(names, ensure_ascii=False, separators=(",", ":"))
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(s)
    return len(s.encode("utf-8"))


def split_all(land_dir=LAND):
    """Rewrite every county file under land_dir/<st>/ that still holds names. {st: files rewritten}."""
    done = {}
    for p in sorted(glob.glob(os.path.join(land_dir, "*", "[0-9]*.json"))):
        with open(p, encoding="utf-8") as fh:
            doc = json.load(fh)
        if not has_names(doc):
            continue
        st = os.path.basename(os.path.dirname(p))
        out, names = split(doc)
        write(land_dir, st, out, names)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(out, separators=(",", ":")))
        done[st] = done.get(st, 0) + 1
    return done


def selftest():
    bad = 0

    def ck(name, ok):
        nonlocal bad
        print(("ok   " if ok else "FAIL ") + name)
        bad += 0 if ok else 1
    doc = {"state": "WI", "fips": "55999", "fetched_utc": "2026-11-01T00:00:00Z", "names": True,
           "cols": ["doc", "date", "price", "legal", "grantor", "grantee", "rec"],
           "rows": [["1", "2026-01-02", 100, "PT NW EXC TO seller  one AND WIFE", "Seller One", "BUYER A", None],
                    ["2", "2026-01-03", 200, "L", "SELLER ONE", "", None], ["3", "2026-01-04", 300, "L", None, "Buyer B", None]]}
    out, names = split(doc)
    ck("a county file keeps no name column", not has_names(out) and out["cols"][-2:] == ["si", "bi"])
    ck("no name anywhere in the county file, the legal included", not re.search(r"(?i)seller|buyer", json.dumps(out)))
    ck("a legal that names its own seller keeps a mark", out["rows"][0][3] == "PT NW EXC TO [NAME] AND WIFE")
    ck("si and bi: the same seller written two ways is one id; no one is null",
       [r[-2:] for r in out["rows"]] == [[0, 0], [0, None], [None, 1]])
    ck("the names file holds every pair, in row order, stamped", names["rows"] == [["Seller One", "BUYER A"], ["SELLER ONE", None], [None, "Buyer B"]]
       and names["n"] == 3 and names["fetched_utc"] == doc["fetched_utc"] and out["names_file"] == "/data/land/wi/names/55999.json")
    back = attach(out, names)
    ck("attach puts them back in memory", [dict(zip(back["cols"], r))["grantor"] for r in back["rows"]] == ["Seller One", "SELLER ONE", None])
    ck("a names file from another read is not attached", not has_names(attach(out, dict(names, fetched_utc="2026-10-01"))))
    ck("a names file with another row count is not attached", not has_names(attach(out, dict(names, n=2))))
    ck("split of a split file changes nothing", split(out)[0] is out and split(out)[1] is None)
    ck("the input doc is not changed", doc["cols"][4] == "grantor" and len(doc["rows"][0]) == 7 and "seller" in doc["rows"][0][3])
    print("land_names selftest: %s" % ("ok" if not bad else "%d failure(s)" % bad))
    return 1 if bad else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if argv[:1] == ["--split"]:
        d = argv[1] if len(argv) > 1 else LAND
        print(json.dumps(split_all(d)))
        return 0
    print("usage: land_names.py --selftest | --split [data/land]")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
