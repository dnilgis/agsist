#!/usr/bin/env python3
"""Buyer and seller names apart from the county transfer files (lead decision on PR 324, Nov 4, 2026).

The owner's rule (the standing decisions, Oct 27): names load only on a reader's tap, from separate names files in the
robots-blocked folder. So a county transfer file, data/land/<st>/<fips>.json, carries no grantor or grantee column.
Its names sit in data/land/<st>/names/<fips>.json: the county's distinct sellers and buyers, each once (as first
written), stamped with the county file's read time and row count (a tap trusts the file only when both match):

    {"state": "WI", "fips": "55005", "fetched_utc": "...", "n": 1234, "s": [seller, ...], "b": [buyer, ...]}

What stays in the county file is two numbers, si and bi: the row's seller and buyer as places in those lists (names
compared the way build_land_summary.up writes them), null when the record names no one. The one market
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
import hashlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAND = os.path.join(ROOT, "data", "land")
NAME_COLS = ("grantor", "grantee")
ID_COLS = ("si", "bi")
NAME_MARK = "[NAME]"     # where a legal named the sale's own seller or buyer (components/land-sales.js shows a tap hint)
# A legal description that holds any rare word of its own row's seller or buyer (a name written another way, "JOHN A
# SMITH" for "SMITH, JOHN") leaves the county file whole (checker on PR 324, Nov 4, 2026): the county file keeps
# LEGAL_MARK + a hash of the legal's first 40 letters (so the one rule still groups and dedupes deeds of one parcel the
# same way) + any part-interest words the rule reads, and the names file keeps the legal under "lg", shown on the tap.
LEGAL_MARK = "[LEGAL WITH A NAME "
HELD_COL = "legal_named"   # attach() and the fetcher's held() carry a held legal under this column, in memory only
HOLD_MIN = 10              # a held text this long or longer also holds any legal that contains it (shorter: equal only)
OWN_MIN = 5                # a word this long of a row's own seller or buyer (not in NAME_STOP) in its own legal holds it, rare or not
NAME_STOP = set("""LLC INC LTD LLP CORP CORPORATION COMPANY TRUST TRUSTS TRUSTEE TRUSTEES REVOCABLE IRREVOCABLE LIVING FAMILY
FARM FARMS LAND LANDS ESTATE ESTATES PROPERTY PROPERTIES HOLDINGS INVESTMENTS INVESTMENT ENTERPRISES PARTNERSHIP PARTNERS
LIMITED AGRICULTURAL AGRICULTURE DATED JOINT TENANTS TENANT HUSBAND WIFE BANK NATIONAL ASSOCIATION COUNTY STATE CITY
VILLAGE TOWN TOWNSHIP SECTION NORTH SOUTH EAST WEST QUARTER HALF THE AND UNDER AGREEMENT DECLARATION SURVIVORSHIP
DECEASED HEIRS SUCCESSOR SUCCESSORS CHURCH SCHOOL DISTRICT CREDIT UNION SERVICES GROUP ACRES ACRE""".split())
# Words that name no person, skipped by the common-word rule only (OWN_MIN; a rare one still holds): states, public
# bodies and utilities that buy right of way, and survey words. The county's own place names are skipped the same way
# (split() reads them from the county and its munis). On the Nov 5 data these few words alone (the state's name 780 rows,
# TRANSPORTATION 171, HIGHWAY 30) and the place names (624 rows) would have hidden 1,600 public legals that name no one.
OWN_SKIP = NAME_STOP | set("""ILLINOIS INDIANA WISCONSIN VERMONT JERSEY IOWA MINNESOTA MICHIGAN MISSOURI KENTUCKY OHIO NEW YORK
AMERICA AMERICAN UNITED STATES FEDERAL DEPARTMENT DEPT TRANSPORTATION HIGHWAY HIGHWAYS NATURAL RESOURCES CONSERVATION
CONSERVANCY COMMISSION COMMISSIONERS AUTHORITY AGENCY BOARD SUPERVISORS PUBLIC WORKS UTILITY UTILITIES ELECTRIC POWER
ENERGY COOPERATIVE TELEPHONE COMMUNICATIONS PIPELINE RAILROAD RAILWAY DRAINAGE SANITARY WATER SEWER FOREST PRESERVE
PRESERVES PARKS RECREATION HOUSING DEVELOPMENT SECRETARY VETERANS AFFAIRS GOVERNMENT ADDITION SUBDIVISION BLOCK SURVEY
CERTIFIED PARCEL EXCEPT EXCEPTING THENCE BEGINNING COMMENCING TOWNSHIPS RANGE MERIDIAN PRINCIPAL NORTHEAST NORTHWEST
SOUTHEAST SOUTHWEST RECORDED VOLUME DOCUMENT OUTLOT CONDOMINIUM PLAT FIRST SECOND THIRD FOURTH""".split())


# A party that looks like an entity (checker, Nov 5): it carries one of these words, or it is not 1 to 5 alphabetic
# words. Only such a party may have its state, public body, survey or county place word skipped by the common-word rule;
# a person whose surname is a township's name is still held.
ENTITY_WORDS = set("""LLC INC LTD LLP LP CORP CORPORATION COMPANY CO TRUST TRUSTS BANK ASSOCIATION ASSN COUNTY STATE CITY VILLAGE
TOWN TOWNSHIP CHURCH SCHOOL DISTRICT CREDIT UNION PARTNERSHIP PARTNERS HOLDINGS INVESTMENTS INVESTMENT ENTERPRISES
PROPERTIES PROPERTY LIMITED GROUP SERVICES FARMS FARM LAND LANDS ESTATES DEPARTMENT DEPT COMMISSION COMMISSIONERS
AUTHORITY AGENCY BOARD SUPERVISORS UTILITY UTILITIES ELECTRIC POWER ENERGY COOPERATIVE COOP TELEPHONE COMMUNICATIONS
PIPELINE RAILROAD RAILWAY UNITED STATES AMERICA FEDERAL GOVERNMENT CONSERVANCY FOUNDATION SOCIETY CLUB MINISTRIES
HOSPITAL UNIVERSITY COLLEGE""".split())


def looks_like_entity(party):
    w = re.findall(r"[A-Z]+", up(party))
    return any(x in ENTITY_WORDS for x in w) or not 1 <= len(w) <= 5


def tokens(s):
    return set(w for w in re.findall(r"[A-Z]+", up(s)) if len(w) >= 4)


def rare_words(legals):
    """{word: in how many of the county's legals}: a word in at most 1 percent of them (3 at least) counts as rare."""
    df = {}
    for t in legals:
        for w in tokens(t):
            df[w] = df.get(w, 0) + 1
    cap = max(3, len(legals) // 100)
    return {w for w, n in df.items() if n <= cap}


def names_in_legal(legal, pair, rare, places=frozenset()):
    """True when the legal holds a word of the row's own seller or buyer that is not an entity or survey word: a rare
    one of 4 letters or more, or any one of OWN_MIN letters or more, rare or not (checker, Nov 5: a common surname of
    the row's own party in its own legal still names the party). A state, public body, survey word or the county's own
    place name is skipped only when its party looks like an entity (looks_like_entity). Never prints or returns the word."""
    lt = tokens(legal)
    for v in pair:
        for party in str(v or "").split(";"):
            ent = None
            for w in tokens(party):
                if w in NAME_STOP or w not in lt:
                    continue
                if w in rare:
                    return True
                if len(w) >= OWN_MIN:
                    if w not in OWN_SKIP and w not in places:
                        return True
                    if ent is None:
                        ent = looks_like_entity(party)
                    if not ent:
                        return True      # a person whose name is also a state, survey or place word: held all the same
    return False


def place_words(doc):
    """The county's own place words (its name and its municipalities'), which the common-word rule skips."""
    out = tokens(doc.get("county"))
    for v in (doc.get("munis") or {}).values():
        out |= tokens(v[0] if isinstance(v, (list, tuple)) and v else v)
    return out


def legal_mark(legal):
    """What a county file keeps for a legal that left it: the mark, a short hash of its first 40 letters, and any part
    interest words the market rule reads (build_land_summary.PARTIAL)."""
    import build_land_summary as B
    u = up(legal)
    h = hashlib.sha1(u[:40].encode("utf-8")).hexdigest()[:10]
    m = B.PARTIAL_RE.search(u)
    return LEGAL_MARK + h + "]" + (" " + m.group(0) if m else "")


def is_marked(legal):
    return str(legal or "").startswith(LEGAL_MARK)


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
    """The legal description with the row's own seller and buyer (5 letters or more) as NAME_MARK, in any case, spacing
    or punctuation: "SMITH, JOHN A." matches "Smith John A" and "SMITH,JOHN A" (checker, Nov 5)."""
    t = "" if legal is None else str(legal)
    for v in pair:
        for n in str(v or "").split(";"):
            w = re.findall(r"[A-Za-z0-9]+", n)
            if len("".join(w)) >= 5:
                rx = r"[^A-Za-z0-9]*".join(re.escape(x) for x in w)
                t = re.sub(rx, NAME_MARK, t, flags=re.I)
    return t


def prior_held(land_dir, st, fips):
    """The held legal texts of a county's names file on disk (its "lg"), [] when there is none. A rebuild seeds split()
    with them, so a legal once held stays held after the deed that named a party rolls out of the window or its word
    stops being rare: holds only grow (checker, Nov 5)."""
    try:
        with open(path_for(land_dir, st, fips), encoding="utf-8") as fh:
            lg = json.load(fh).get("lg") or {}
    except (OSError, ValueError, AttributeError):
        return []
    return [v for v in lg.values() if isinstance(v, str) and v.strip()] if isinstance(lg, dict) else []


def split(doc, prior=None):
    """(county doc with no name column and si, bi added; names doc). Changes neither input; a doc with no
    name column comes back as it is, with names None. prior: legal texts held on an earlier run (prior_held); any
    legal that equals or contains one of them is held again."""
    cols = list(doc.get("cols") or [])
    if not has_names(doc) and HELD_COL not in cols:
        return doc, None
    ix = [cols.index(c) if c in cols else None for c in NAME_COLS]
    hx = cols.index(HELD_COL) if HELD_COL in cols else None
    keep = [i for i, c in enumerate(cols) if c not in NAME_COLS and c not in ID_COLS and c != HELD_COL]
    li = cols.index("legal") if "legal" in cols else None
    ids, firsts = [{}, {}], [[], []]
    rows, lg = [], {}
    # rarity over the legals as written: a legal held before counts by its stored text, so a second run sees what the first saw
    held = lambda r: r[hx] if hx is not None and hx < len(r) else None
    rare = rare_words([held(r) if is_marked(r[li]) else r[li] for r in doc.get("rows") or []
                       if li is not None and r[li] and (not is_marked(r[li]) or held(r))]) if li is not None else set()
    src = doc.get("rows") or []
    pairs = [[r[i] if i is not None and i < len(r) else None for i in ix] for r in src]
    leg = lambda r: r[li] if li is not None and li < len(r) else None
    # which legals are held: a mark from an earlier run (kept as it is), a legal with a rare word of its own party,
    # then, until nothing changes, any legal that equals or contains a held legal's text (the same parcel on another
    # deed whose own parties the legal does not name: checker, Nov 4)
    places = place_words(doc)
    hold = [bool(leg(r)) and (is_marked(leg(r)) or names_in_legal(leg(r), pairs[ri], rare, places)) for ri, r in enumerate(src)]
    texts = {up(held(r) if is_marked(leg(r)) else leg(r)) for ri, r in enumerate(src) if hold[ri] and (held(r) or not is_marked(leg(r)))}
    texts |= {up(t) for t in prior or ()}
    texts.discard("")
    grew = True
    while grew:
        grew = False
        for ri, r in enumerate(src):
            if hold[ri] or not leg(r):
                continue
            n = up(leg(r))
            if n in texts or any(len(t) >= HOLD_MIN and t in n for t in texts):
                hold[ri] = True
                texts.add(n)
                grew = True
    for ri, r in enumerate(src):
        pair = pairs[ri]
        nums = []
        for side in (0, 1):
            k = up(pair[side])
            if k and k not in ids[side]:
                ids[side][k] = len(firsts[side])
                firsts[side].append(re.sub(r"\s+", " ", str(pair[side])).strip())
            nums.append(ids[side][k] if k else None)
        row = [r[i] for i in keep]
        if leg(r) and is_marked(leg(r)):
            # held on an earlier run: the mark and its hash stay exactly as they are (never re-tested, never re-hashed),
            # and the stored legal goes back to the names file
            if held(r):
                lg[str(ri)] = held(r)
        elif leg(r) and hold[ri]:
            lg[str(ri)] = leg(r)                              # shown only on the tap, from the names file
            row[keep.index(li)] = legal_mark(leg(r))
        elif leg(r):
            row[keep.index(li)] = blank_names(leg(r), pair)
        rows.append(row + nums)
    out = dict(doc)
    out["cols"] = [cols[i] for i in keep] + list(ID_COLS)
    out["rows"] = rows
    out["names"] = bool(firsts[0] or firsts[1])
    out["names_file"] = rel_path(doc.get("state"), doc.get("fips"))
    names = {"state": doc.get("state"), "fips": doc.get("fips"), "fetched_utc": doc.get("fetched_utc"), "n": len(rows),
             "s": firsts[0], "b": firsts[1], "lg": lg}
    return out, names


def attach(doc, names):
    """The county doc with grantor and grantee put back from its names doc, in memory only. A names doc that
    does not belong to this file (another read time or row count) attaches nothing."""
    if has_names(doc) or not names:
        return doc
    if names.get("n") != len(doc.get("rows") or []) or str(names.get("fetched_utc")) != str(doc.get("fetched_utc")):
        return doc
    cols = doc["cols"]
    if not all(c in cols for c in ID_COLS):
        return doc
    i_s, i_b, S, B = cols.index("si"), cols.index("bi"), names.get("s") or [], names.get("b") or []
    pick = lambda L, i: L[i] if isinstance(i, int) and 0 <= i < len(L) else None
    lg = names.get("lg") or {}
    out = dict(doc)
    # legal_named: the whole legal of a row whose legal left the county file (memory only; the rule keeps reading "legal")
    out["cols"] = list(cols) + list(NAME_COLS) + [HELD_COL]
    out["rows"] = [list(r) + [pick(S, r[i_s]), pick(B, r[i_b]), lg.get(str(i))] for i, r in enumerate(doc["rows"])]
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
        out, names = split(doc, prior_held(land_dir, st, doc.get("fips")))
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
    ck("a legal that names its own seller leaves the county file for the names file", is_marked(out["rows"][0][3])
       and names["lg"] == {"0": "PT NW EXC TO seller  one AND WIFE"})
    ck("blank_names: the exact name, any case or spacing, becomes the mark", blank_names("PT NW EXC TO seller  one AND WIFE", ["Seller One", None])
       == "PT NW EXC TO [NAME] AND WIFE")
    ck("si and bi: the same seller written two ways is one id; no one is null",
       [r[-2:] for r in out["rows"]] == [[0, 0], [0, None], [None, 1]])
    ck("the names file holds each seller and buyer once, as first written, stamped", names["s"] == ["Seller One"] and names["b"] == ["BUYER A", "Buyer B"]
       and names["n"] == 3 and names["fetched_utc"] == doc["fetched_utc"] and out["names_file"] == "/data/land/wi/names/55999.json")
    back = attach(out, names)
    ck("attach puts them back in memory, row by row", [(dict(zip(back["cols"], r))["grantor"], dict(zip(back["cols"], r))["grantee"]) for r in back["rows"]]
       == [("Seller One", "BUYER A"), ("Seller One", None), (None, "Buyer B")])
    ck("a names file from another read is not attached", not has_names(attach(out, dict(names, fetched_utc="2026-10-01"))))
    ck("a names file with another row count is not attached", not has_names(attach(out, dict(names, n=2))))
    ck("split of a split file changes nothing", split(out)[0] is out and split(out)[1] is None)
    # a legal that names its own buyer in another word order ("SMITH, JOHN" written "JOHN Q SMITH"): out of the county file
    rows = [["%d" % i, "2026-01-%02d" % (i + 1), 100, "NW SEC %d T1N R1E" % i, "SELLER %d" % i, "BUYER %d" % i, None] for i in range(20)]
    rows.append(["21", "2026-02-01", 500, "UNDIVIDED ONE-HALF INTEREST, PT SW EXC TRACT DEEDED TO JOHN Q ZYZZYVA", "Old Owner Estate", "ZYZZYVA, JOHN", None])
    rows.append(["22", "2026-02-02", 500, "THE SMITH ADDITION LOT 4", "SMITH FARMS LLC", "NEW BUYER CO", None])
    d2 = dict(doc, rows=rows)
    o2, n2 = split(d2)
    leg = [r[3] for r in o2["rows"]]
    ck("a legal naming the buyer in another word order leaves the county file", "ZYZZYVA" not in json.dumps(o2) and is_marked(leg[20])
       and n2["lg"].get("20") == rows[20][3])
    ck("the county file keeps the part-interest words the rule reads, and a hash for grouping", leg[20].endswith("] UNDIVIDED")
       and leg[20] == legal_mark(rows[20][3]))
    ck("a word that names many of the county's legals is not rare; the legal stays (an LLC word never counts)",
       not names_in_legal("NW SEC 3 T1N R1E", ["SELLER 3", None], rare_words([r[3] for r in rows])) and not is_marked(leg[0]))
    b2 = attach(o2, n2)
    ck("attach brings the whole legal back in memory only beside the rule's legal", dict(zip(b2["cols"], b2["rows"][20]))["legal_named"] == rows[20][3]
       and dict(zip(b2["cols"], b2["rows"][20]))["legal"] == leg[20])
    ck("the input doc is not changed", doc["cols"][4] == "grantor" and len(doc["rows"][0]) == 7 and "seller" in doc["rows"][0][3])
    # split, attach, split again, twice: the county file and its names file come out the same (held legals, marks, hashes)
    o3, n3 = o2, n2
    for _ in range(2):
        b3 = attach(o3, n3)
        o3, n3 = split(dict(b3, cols=[c for c in b3["cols"]]))
    ck("two split cycles change nothing: held legals, their marks and hashes stay", o3["rows"] == o2["rows"] and n3["lg"] == n2["lg"]
       and n3["s"] == n2["s"] and n3["b"] == n2["b"])
    # two deeds of one parcel, only the first names its own party: the second, with the same legal, is held too
    rows4 = [["%d" % i, "2026-03-%02d" % (i + 1), 100, "NE SEC %d T2N R2E" % i, "OWNER %d" % i, "TAKER %d" % i, None] for i in range(20)]
    rows4.append(["40", "2026-04-01", 900, "W 1/2 NW 1/4 SEC 9 EXC 2 AC TO QUILLFEATHER", "QUILLFEATHER, ANN", "NEXT ONE", None])
    rows4.append(["41", "2026-04-20", 950, "w 1/2  nw 1/4 sec 9 exc 2 ac to quillfeather", "OTHER PARTY", "SOMEONE ELSE", None])
    rows4.append(["42", "2026-05-01", 990, "PARCEL A: W 1/2 NW 1/4 SEC 9 EXC 2 AC TO QUILLFEATHER, AND MORE", "THIRD", "FOURTH", None])
    o4, n4 = split(dict(doc, rows=rows4))
    l4 = [r[3] for r in o4["rows"]]
    ck("closure: the same parcel on another deed (any case or spacing) and a legal containing it are held too",
       all(is_marked(x) for x in l4[20:23]) and sorted(n4["lg"]) == ["20", "21", "22"] and "QUILLFEATHER" not in json.dumps(o4).upper())
    ck("closure: the other legals stay", not any(is_marked(x) for x in l4[:20]))
    o5, n5 = split(attach(o4, n4))
    ck("closure is a fixed point: a second split changes nothing", o5["rows"] == o4["rows"] and n5["lg"] == n4["lg"])
    # holds only grow (checker, Nov 5): an IL-style rebuild refetches the window, so no mark comes back; the names file's
    # held texts seed the split instead
    import tempfile
    base = lambda rows: {"state": "IL", "fips": "17999", "fetched_utc": "t", "names": True,
                         "cols": ["doc", "date", "price", "legal", "grantor", "grantee", "rec"], "rows": rows}
    mk = lambda n: [["%d" % i, "2026-01-01", 1, "NE SEC %d T2N R2E" % i, "OWN %d" % i, "TAK %d" % i, None] for i in range(n)]
    pl = "W 1/2 NW 1/4 SEC 9 EXC TRACT DEEDED TO QUILLFEATHER"
    d1 = mk(30) + [["a", "2026-02-01", 1, pl, "QUILLFEATHER, ANN", "X Y", None], ["b", "2026-04-01", 1, pl, "OTHER", "SOME", None]]
    with tempfile.TemporaryDirectory() as td:
        o1, n1 = split(base(d1), prior_held(td, "IL", "17999"))
        write(td, "IL", o1, n1)
        ck("holds grow: no names file yet seeds nothing", prior_held(os.path.join(td, "none"), "IL", "17999") == [])
        d2 = mk(30) + [d1[-1]]                                   # the deed that named its party rolled out of the window
        o2, n2 = split(base(d2), prior_held(td, "IL", "17999"))
        ck("holds grow: a window roll keeps the same parcel's other deed held", sorted(n1["lg"]) == ["30", "31"]
           and sorted(n2["lg"]) == ["30"] and "QUILLFEATHER" not in json.dumps(o2).upper())
        ck("holds grow: without the seed it would have come back (the case the seed closes)",
           "QUILLFEATHER" in json.dumps(split(base(d2))[0]).upper())
        write(td, "IL", o2, n2)
        d3 = mk(30) + [["a", "2026-02-01", 1, "PT SEC 9 DEEDED TO QUILLFEATHER", "QUILLFEATHER, ANN", "X Y", None]]
        o3, n3 = split(base(d3), prior_held(td, "IL", "17999"))
        write(td, "IL", o3, n3)
        d4 = d3 + [["c%d" % i, "2026-03-01", 1, "QUILLFEATHER ADDITION LOT %d" % i, "P%d" % i, "Q%d" % i, None] for i in range(4)]
        o4b, n4b = split(base(d4), prior_held(td, "IL", "17999"))
        ck("holds grow: a word that stops being rare keeps its legal held", sorted(n3["lg"]) == ["30"] and "30" in n4b["lg"]
           and is_marked(o4b["rows"][30][3]))
        write(td, "IL", o4b, n4b)
        o4c, n4c = split(base(d4), prior_held(td, "IL", "17999"))
        ck("holds grow: a second rebuild changes nothing", o4c["rows"] == o4b["rows"] and n4c["lg"] == n4b["lg"])
    # own party in its own legal: punctuation and spacing never hide it, and a common word of 5+ letters still holds it
    ck("blank_names reads past punctuation and spacing",
       blank_names("PT NE EXC TO SMITH,JOHN  A. ROW", ["SMITH, JOHN A", None]) == "PT NE EXC TO [NAME]. ROW"
       and blank_names("LOT 2 smith-john a", ["SMITH JOHN A.", None]) == "LOT 2 [NAME]")
    rows6 = [["%d" % i, "2026-03-01", 100, "SMITHS ADDN LOT %d BAKER" % i, "BAKER, JO", "LANE %d" % i, None] for i in range(40)]
    rows6.append(["x", "2026-03-02", 100, "NE SEC 4 T2N R2E", "BAKER, JO", "ZED", None])
    o6, n6 = split(dict(doc, rows=rows6))
    ck("a common own-party word of 5+ letters in its own legal holds it", sorted(n6["lg"], key=int) == [str(i) for i in range(40)])
    ck("a stop word or a short word alone holds nothing",
       not names_in_legal("PART OF THE FARM LOT JO", ["FARM TRUST", "JO X"], set()))
    ck("a state, a public body or the county's own place name alone holds nothing; a rare one still does",
       not names_in_legal("RIGHT OF WAY TO STATE OF WISCONSIN DEPT OF TRANSPORTATION IN VILLAGE OF MAPLEFORD",
                          ["WISCONSIN DEPARTMENT OF TRANSPORTATION", "MAPLEFORD VILLAGE"], set(), {"MAPLEFORD"})
       and names_in_legal("LOT 1 MAPLEFORD", ["MAPLEFORD, ANN", None], {"MAPLEFORD"}, {"MAPLEFORD"}))
    ck("a person whose surname is a township's name is held; an entity with the same place word is not",
       names_in_legal("NE SEC 4 MAPLEFORD TOWNSHIP", ["MAPLEFORD, ANN B", None], set(), {"MAPLEFORD"})
       and not names_in_legal("NE SEC 4 MAPLEFORD TOWNSHIP", ["MAPLEFORD GRAIN LLC", None], set(), {"MAPLEFORD"})
       and not names_in_legal("NE SEC 4 MAPLEFORD TOWNSHIP", ["TOWNSHIP OF MAPLEFORD", None], set(), {"MAPLEFORD"}))
    ck("each party of a pair is read on its own: a person after an entity is still held",
       names_in_legal("RIGHT OF WAY WISCONSIN", ["WISCONSIN DEPT OF TRANSPORTATION; WISCONSIN, JO", None], set(), set()))
    ck("looks_like_entity: an entity word, or not 1 to 5 words", looks_like_entity("A B C D E F") and looks_like_entity("SMITH FARMS")
       and not looks_like_entity("SMITH, JOHN A & MARY B") and looks_like_entity(""))
    ck("place words come from the county and its munis", place_words({"county": "Dane", "munis": {"0": ["Mapleford", 1, 2]}}) == {"DANE", "MAPLEFORD"})
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
