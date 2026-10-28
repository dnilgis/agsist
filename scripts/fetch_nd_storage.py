#!/usr/bin/env python3
"""Licensed grain storage in North Dakota, from the ND Department of Agriculture (Oct 28, 2026).

The Department posts one PDF of every licensed grain entity (GrainEntities_624.pdf, the file it
still served on Oct 28, 2026; the PDF itself is dated Jun 7, 2024 and prints no other date). One
row per entity: its name and entity number, every licence it holds (grain warehouse, grain
processor, roving grain buyer, grain broker), every warehouse location with that location's licence
number, the bond, contact columns, and ONE "Total Capacity" for the whole entity. The list gives
no capacity per location, so a town page never prints one: a single-location licensee's capacity
is that location's, and a licensee with several locations gets its total said as a total.

The PDF has no ruled cells. pdftotext -layout puts each entity on several lines, the licence and
warehouse columns each sorted on their own (a warehouse line is not the licence beside it), the
entity name, bond and capacity on the entity's LAST line (the bond amount closes every entity).
Columns are found per page: the licence column where the left-most licence starts, the warehouse
column where most warehouse names start.

Writes data/licensed-storage/ND.json:
  {"schema", "source": {name, short, url, file_date, read, ref, sha256}, "totals": {...},
   "locations": [{lic, kind, wh, city, st, name, names, ent, ent_bu, ent_n, lic_twice, id, src, how}],
   "join": {...}, "unjoined": [...], "ambiguous": [...]}
  One row per warehouse location. wh is the location as the list names it, city the town read from
  it (a trailing "(Rural)" or "(West Terminal)", a trailing "Warehouse" and the licensee's own
  leading name words taken off, unless nothing would be left); a name that is no town of ours never joins. ent_bu is the ENTITY's total
  capacity, ent_n how many locations share it. lic_twice: the list prints the same licence (kind and
  number) under another entity too (14 locations on the Jun 2024 list; each stays with the entity it
  is printed under). No contact, phone, email or address is kept.

RECONCILED OR NOTHING (the list prints no grand total, so it reconciles to itself): every
"... License (N)" in the text is one of the four kinds; every entity has exactly one entity number,
one bond line and at most one capacity; an entity has a capacity exactly when it has a warehouse
location; each warehouse location's licence is one of that entity's licences, and every grain
warehouse licence has its location; no licence number twice within one entity; nothing is left
over after the last entity. Any miss and nothing is written (exit 1).

THE JOIN: scripts/licensed_storage.py (the same rules as Nebraska), North Dakota facilities only,
each location's town and the entity's legal name and "dba" name.

Usage:
  python3 scripts/fetch_nd_storage.py --pdf FILE [--ref ID]    read the PDF (pdftotext, pdfinfo)
  python3 scripts/fetch_nd_storage.py --txt FILE --file-date YYYY-MM-DD [--ref ID]
  python3 scripts/fetch_nd_storage.py --check
  python3 scripts/fetch_nd_storage.py --selftest
"""
import argparse
import datetime as dt
import hashlib
import os
import re
import subprocess
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import licensed_storage as LS  # noqa: E402

ST = "ND"
OUT = os.path.join(LS.DIR, "ND.json")
REF_ID = "nd-grain-entities-624"
URL = "https://www.ndda.nd.gov/sites/www/files/documents/files/GrainEntities_624.pdf"
SOURCE_NAME = "ND Dept. of Agriculture"
SOURCE_LONG = "North Dakota Department of Agriculture, licensed grain entities"
SCHEMA = 1
Refused = LS.Refused

# licence -> our facility names for a licensee that trades under another name (cite the record).
ALIASES = {}
NOISE = re.compile(r"\b(non\s?-?\s?stock|incorporated|limited|ltd|north dakota|the)\b")

KINDS = {"Grain Warehouse": "warehouse", "Grain Processor": "processor", "Roving Grain Buyer": "roving",
         "Grain Broker": "broker"}
LIC = re.compile(r"(Grain Warehouse|Grain Processor|Roving Grain Buyer|Grain Broker) License \((\d+)\)")
ANY_LIC = re.compile(r"License \((\d+)\)")
SEG = re.compile(r"\S+(?: \S+)*")
BOND = re.compile(r"\$[\d,]+\.\d\d")
CAP = re.compile(r"\b([\d,]+) bu\s*$")
HEADER = "Entity (Entity Number)"


def _num(s):
    return int(s.replace(",", ""))


def _groups(text):
    """[[(lic_col, wh_col, line), ...]] per entity (columns of the line's own page), the bond line
    closing each."""
    if HEADER not in text:
        raise Refused(f"no '{HEADER}' header: not the grain entities list")
    groups, cur = [], []
    for pg in text.split("\f"):
        lines = [ln for ln in pg.splitlines() if ln.strip() and not ln.startswith(HEADER)
                 and not ln.startswith("#")]
        if not lines:
            continue
        starts = [m.start() for ln in lines for m in [LIC.search(ln)] if m]
        if not starts:
            raise Refused("a page with no licence on it")
        lic_col = min(starts)
        wh = Counter()
        for ln in lines:
            m = LIC.search(ln)
            s = SEG.search(ln, m.end()) if m else None
            if s and re.search(r"\(\d+\)$", s.group()) and not BOND.match(s.group()):
                wh[s.start()] += 1
        wh_col = wh.most_common(1)[0][0] if wh else None
        for ln in lines:
            cur.append((lic_col, wh_col, ln))
            if BOND.search(ln):
                groups.append(cur)
                cur = []
    if cur:
        raise Refused(f"lines after the last entity: {cur[0][2].strip()[:60]!r}")
    return groups


def town_of(wh, entity):
    """'Mooreton (West Terminal)' -> Mooreton; 'Dickinson Warehouse' -> Dickinson; 'TriGen Makoti'
    (TriGen Ag Partners) -> Makoti. A name that is only the licensee's own ('Northwood' for Northwood
    Equity, 'Ardent Mills' for Ardent Mills, LLC) stays as it is: a town only if it is one."""
    s = re.sub(r"\s*\(\d+\)$", "", wh).strip()
    while True:
        t = re.sub(r"\s*\([^()]*\)$", "", s).strip()
        if t == s:
            break
        s = t
    s = re.sub(r"\s+warehouse$", "", s, flags=re.I).strip()
    ew = re.findall(r"[a-z0-9&']+", entity.lower())
    sw = s.split()
    k = 0
    while k < len(sw) and k < len(ew) and re.sub(r"[^a-z0-9&']", "", sw[k].lower()) == ew[k]:
        k += 1
    rest = " ".join(sw[k:]).strip(" ,-")
    return (rest or s) or None


def entity_names(ent):
    """'Minn-Dak Ag LLC dba Minn-Dak Growers' -> both names; '(The)' taken off."""
    s = re.sub(r"\s*\(The\)", "", ent).strip()
    parts = [p.strip(" ,") for p in re.split(r",?\s+dba\s+", s, flags=re.I) if p.strip(" ,")]
    return [s] + (parts if len(parts) > 1 else [])


def parse(text):
    """-> (rows, entities). Refuses unless the list holds together (docstring)."""
    found = len(ANY_LIC.findall(text))
    known = len(LIC.findall(text))
    if found != known:
        raise Refused(f"{found - known} licence(s) of a kind this reader does not know")
    rows, ents, seen_lic = [], [], {}
    for group in _groups(text):
        ent, lics, whs, caps, frag = [], [], [], [], ""
        for lic_col, wh_col, ln in group:
            m = LIC.search(ln)
            if m:
                lics.append((KINDS[m.group(1)], m.group(2)))
            for s in SEG.finditer(ln):
                a, txt = s.start(), s.group()
                if m and a <= m.start() < s.end():
                    if ln[a:m.start()].strip():
                        ent.append(ln[a:m.start()].strip())
                    continue
                if a < lic_col - 1:
                    ent.append(txt)
                elif wh_col is not None and abs(a - wh_col) <= 3 and not BOND.match(txt):
                    frag += txt
                    if re.search(r"\(\d+\)$", frag):
                        whs.append(frag)
                        frag = ""
                    else:
                        frag += " "
            c = CAP.search(ln)
            if c:
                caps.append(_num(c.group(1)))
        etxt = " ".join(ent)
        em = re.fullmatch(r"(.+?)\s*\((\d+)\)", etxt)
        if not em:
            raise Refused(f"no entity number in {etxt[:60]!r}")
        name, eno = em.group(1).strip(), em.group(2)
        if frag.strip():
            raise Refused(f"entity {eno}: warehouse name without its licence: {frag.strip()!r}")
        if len(caps) > 1:
            raise Refused(f"entity {eno}: {len(caps)} capacities")
        wl = [re.search(r"\((\d+)\)$", w).group(1) for w in whs]
        mine = {n for _, n in lics}
        if len(set(wl)) != len(wl) or not set(wl) <= mine:
            raise Refused(f"entity {eno}: a location's licence is not one of its licences")
        if {n for k, n in lics if k == "warehouse"} - set(wl):
            raise Refused(f"entity {eno}: a grain warehouse licence with no location")
        if bool(whs) != bool(caps):
            raise Refused(f"entity {eno}: capacity {'without' if caps else 'missing for'} a warehouse location")
        kind_of = {n: k for k, n in lics}
        if len(kind_of) != len(lics):
            raise Refused(f"entity {eno}: one licence number twice")
        # numbers run per kind (warehouse 1099 is Rugby Farmers' York, processor 1099 Ardent Mills)
        keys = {(kind_of[n], n) for n in wl}
        for k in sorted(keys):
            seen_lic.setdefault(k, []).append(eno)
        for w, n in zip(whs, wl):
            rows.append({"lic": n, "kind": kind_of[n], "wh": re.sub(r"\s*\(\d+\)$", "", w), "city": town_of(w, name),
                         "st": ST, "name": name, "names": entity_names(name), "ent": eno,
                         "ent_bu": caps[0], "ent_n": len(whs)})
        ents.append({"ent": eno, "name": name, "licences": Counter(k for k, _ in lics), "bu": caps[0] if caps else None,
                     "n": len(whs)})
    if len({e["ent"] for e in ents}) != len(ents):
        raise Refused("an entity number twice")
    if sum(len(LIC.findall(ln)) for ln in text.splitlines()) != sum(sum(e["licences"].values()) for e in ents):
        raise Refused("a licence outside any entity")
    for r in rows:
        r["lic_twice"] = len(seen_lic[(r["kind"], r["lic"])]) > 1
    return rows, ents


def build(text, elevators, file_date, read="2026-10-28", ref=REF_ID, sha=None, url=URL):
    rows, ents = parse(text)
    unjoined, ambiguous = LS.join(rows, elevators, (ST,), ALIASES, NOISE)
    lic = Counter()
    for e in ents:
        lic.update(e["licences"])
    return {
        "schema": SCHEMA,
        "note": ("Grain warehouse and processor locations licensed by the North Dakota Department of Agriculture. "
                 "The list gives one total capacity per licensee (ent_bu), shared by its ent_n locations; it gives "
                 "none per location. id: the AGSIST elevator id when exactly one of our facilities matches "
                 "(scripts/licensed_storage.py); unjoined and ambiguous rows are listed, never guessed."),
        "source": {"name": SOURCE_LONG, "short": SOURCE_NAME, "url": url, "file_date": file_date, "read": read,
                   "ref": ref, "sha256": sha},
        "totals": {"entities": len(ents), "licences": {k: lic.get(k, 0) for k in KINDS.values()},
                   "with_capacity": sum(1 for e in ents if e["bu"]), "locations": len(rows),
                   "bushels": sum(e["bu"] for e in ents if e["bu"])},
        "join": LS.join_summary(rows, unjoined, ambiguous),
        "locations": rows,
        "unjoined": LS.listed(rows, unjoined),
        "ambiguous": LS.listed(rows, ambiguous),
    }


# ---------------------------------------------------------------- what the pages read

def load(root=ROOT):
    doc = LS.read_json(ST, root)
    return doc if doc and _holds(doc) else None


def _holds(doc):
    try:
        locs, t = doc["locations"], doc["totals"]
        by_ent = {}
        for r in locs:
            by_ent.setdefault(r["ent"], []).append(r)
        return (doc.get("schema") == SCHEMA and len(locs) == t["locations"] and doc["source"]["file_date"]
                and all(len({(r["ent_bu"], r["ent_n"]) for r in rs}) == 1 and rs[0]["ent_n"] == len(rs)
                        for rs in by_ent.values())
                and sum(rs[0]["ent_bu"] for rs in by_ent.values()) == t["bushels"]
                and len(by_ent) == t["with_capacity"] and LS.joins_hold(doc))
    except (KeyError, TypeError, IndexError):
        return False


by_source = LS.by_source


def _credit(doc, esc):
    s = doc["source"]
    return (f'<a href="{esc(s["url"])}" rel="noopener">{esc(s["short"])}</a> list, '
            f'file dated {LS.fmt_date(s["file_date"])}')


def storage_line_html(row, doc, esc):
    """One location: its licensee's capacity. Several: the licensee's total, said as a total."""
    if row["ent_n"] == 1:
        what = f'{row["ent_bu"]:,} bushels'
    else:
        n = "both" if row["ent_n"] == 2 else f'all {row["ent_n"]}'
        what = (f'{row["ent_bu"]:,} bushels for {n} of this licensee&rsquo;s North Dakota '
                f'locations together; the list gives no figure per location')
    return f'<p class="cbt-sub cbt-cap" style="margin:8px 0 0">Licensed storage: {what} ({_credit(doc, esc)})</p>'


def state_note_html(doc, st, esc):
    if not doc or st != ST:
        return None
    t, s = doc["totals"], doc["source"]
    return (f'<div class="cbt-note" id="licensed-storage"><b>Licensed grain storage.</b> North Dakota&rsquo;s list '
            f'names {t["locations"]} licensed grain warehouse and processor locations held by {t["with_capacity"]} '
            f'businesses, and the capacities it gives those businesses add to {t["bushels"]:,} bushels '
            f'({_credit(doc, esc)}, the list posted when we read it on {LS.fmt_date(s["read"])}). The list gives one capacity per business, not '
            f'per location. Warehouses licensed federally instead are not on the state&rsquo;s list. Where we read '
            f'a licensed location&rsquo;s bids, its town page shows that capacity.</div>')


# ---------------------------------------------------------------- CLI

def _pdf_text(path):
    try:
        text = subprocess.run(["pdftotext", "-layout", path, "-"], check=True, capture_output=True,
                              text=True).stdout
        info = subprocess.run(["pdfinfo", "-isodates", path], check=True, capture_output=True, text=True).stdout
    except (OSError, subprocess.CalledProcessError) as e:
        raise SystemExit(f"[nd-storage] pdftotext/pdfinfo failed: {e}")
    m = re.search(r"^CreationDate:\s+(\d{4}-\d{2}-\d{2})", info, re.M)
    if not m:
        raise SystemExit("[nd-storage] the PDF carries no creation date")
    with open(path, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    return text, m.group(1), sha


def check(root=ROOT):
    doc = load(root)
    if doc is None:
        print(f"[nd-storage] {OUT} missing or does not add up")
        return 1
    bad = LS.check_ids(doc, "nd-storage", root)
    t, j = doc["totals"], doc["join"]
    print(f"[nd-storage] {t['entities']} entities, {t['locations']} locations, {t['bushels']:,} bu, "
          f"joined {j['joined']} of {j['of']}")
    return 1 if bad else 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf")
    ap.add_argument("--txt")
    ap.add_argument("--file-date")
    ap.add_argument("--ref", default=REF_ID)
    ap.add_argument("--read", default=dt.date.today().isoformat())
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    if a.check:
        return check()
    if a.pdf:
        text, file_date, sha = _pdf_text(a.pdf)
    elif a.txt and a.file_date:
        text, file_date = open(a.txt, encoding="utf-8").read(), a.file_date
        sha = None
    else:
        raise SystemExit("[nd-storage] give --pdf FILE, or --txt FILE --file-date YYYY-MM-DD")
    try:
        doc = build(text, LS.elevators(), file_date, read=a.read, ref=a.ref, sha=sha)
    except Refused as e:
        print(f"[nd-storage] REFUSED, nothing written: {e}")
        return 1
    LS.write(doc, ST)
    t, j = doc["totals"], doc["join"]
    print(f"[nd-storage] {t['entities']} entities, {t['with_capacity']} with capacity, {t['locations']} locations, "
          f"{t['bushels']:,} bu (file dated {file_date}); joined {j['joined']} of {j['of']} ({j['rate']:.0%}), "
          f"{j['with_bids_key']} with a bids-network key; unjoined {j['unjoined']}, ambiguous {j['ambiguous']}")
    return 0


# ---------------------------------------------------------------- selftest (real rows, GrainEntities_624.pdf)
# Lines as pdftotext -layout gives them, cut after the bond amount (contact, address, phone and email
# columns left out), the entity's capacity kept at the line end. Page 1 rows, then two from page 10.

SAMPLE = """Entity (Entity Number)                          License (License Number)            Warehouse (License Number)                       Bond Agent                                 Required Bond Amount   Total Capacity
                                                Grain Warehouse License (3261)      Hatton (3261)
Northwood Equity Elevator Company (1050)        Grain Warehouse License (53)        Northwood (53)                                   Western Surety Company                                  $851,707.18   4,074,000 bu
                                                Grain Warehouse License (1113)      Adrian (1255)
                                                Grain Warehouse License (1255)      Englevale (1113)
                                                Grain Warehouse License (1292)      Fredonia (1292)
                                                Grain Warehouse License (1293)      LaMoure (213)
                                                Grain Warehouse License (1294)      Linton (1293)
Larson Grain Company (1068)                     Grain Warehouse License (213)       Wishek (1294)                                    Western Surety Company                                  $861,677.65   8,286,000 bu
                                                                                                                                     Travelers Casualty and Surety Company of
Voss Grain Company (1082)                       Grain Warehouse License (13)        Voss (13)                                        America                                                 $100,000.00   258,000 bu
                                                Grain Warehouse License (159)       Dickinson Warehouse (662)
                                                Grain Warehouse License (662)       Grand Forks Warehouse (159)
Minn-Dak Ag LLC dba Minn-Dak Growers (1101)     Roving Grain Buyer License (2000)                                                    Western Surety Company                                $1,470,000.00   2,000,000 bu
Specialty Commodities LLC (1202)                Roving Grain Buyer License (3006)                                                    ARCH INSURANCE COMPANY                                  $345,062.64
Thompson Farmers Co-Operative Elevator (131)    Grain Warehouse License (39)        Thompson (39)                                    Western Surety Company                                  $424,462.83   2,172,000 bu
Kirkeide Legacy Partners Company dba Kirkeides                                      Kirkeide Legacy Partners Company dba Kirkeides
Northland Bean & Seed (1311)                   Grain Warehouse License (894)        Northland Bean & Seed (894)                      Nationwide Mutual Insurance Company                     $234,114.95   1,145,600 bu
                                               Grain Warehouse License (2156)       Berlin (2156)
Agtegra Cooperative (1344)                     Grain Warehouse License (2200)       Hague (2200)                                     State of North Dakota                                   $559,310.18   1,158,000 bu
                                               Grain Warehouse License (1)          Clifford (1)
Clifford Farmers Cooperative Elevator Company Grain Warehouse License (1075)        Galesburg (1335)
(142)                                          Grain Warehouse License (1335)       Hope (1075)                                      Western Surety Company                                $1,203,648.58   15,188,000 bu
                                               Grain Warehouse License (1169)       Buxton (1169)
                                               Grain Warehouse License (1170)       Reynolds (923)
Valley United Co-op (1432)                     Grain Warehouse License (923)        Thompson (1170)                                  Western Surety Company                                  $479,234.48   5,147,000 bu
\fNash Grain & Trading Co (927)              Grain Warehouse License (215)       Nash (215)                        Western Surety Company                  $100,000.00   640,000 bu
                                           Grain Warehouse License (1267)      Falkirk (1267)
                                           Grain Warehouse License (1305)      Mayville (794)
                                           Grain Warehouse License (1306)      Portland (1305)
SRS Commodities Limited (951)              Grain Warehouse License (794)       Portland (Rural) (1306)           Employers Mutual Casualty Co           $1,628,336.08   2,602,000 bu
"""


def selftest():
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)

    rows, ents = parse(SAMPLE)
    by = {r["lic"]: r for r in rows}
    ok(len(ents) == 12, f"12 entities, got {len(ents)}")
    ok(len(rows) == 26, f"26 locations, got {len(rows)}")
    ok(by["3261"]["wh"] == "Hatton" and by["3261"]["name"] == "Northwood Equity Elevator Company"
       and by["3261"]["ent_bu"] == 4074000 and by["3261"]["ent_n"] == 2, "a location above its entity's line")
    ok(by["1255"]["wh"] == "Adrian" and by["213"]["wh"] == "LaMoure" and by["1294"]["wh"] == "Wishek",
       "a location takes its licence from its own name, not the licence printed beside it")
    ok(by["13"]["ent_bu"] == 258000 and by["13"]["ent_n"] == 1, "one location: the entity's capacity is its own")
    ok(by["662"]["city"] == "Dickinson" and by["159"]["city"] == "Grand Forks", "'X Warehouse' is town X")
    ok(by["662"]["names"] == ["Minn-Dak Ag LLC dba Minn-Dak Growers", "Minn-Dak Ag LLC", "Minn-Dak Growers"],
       "legal and dba names")
    ok(not any(e["ent"] == "1202" and e["n"] for e in ents) and any(e["ent"] == "1202" for e in ents),
       "a roving buyer only: an entity with no location")
    ok(by["894"]["wh"] == "Kirkeide Legacy Partners Company dba Kirkeides Northland Bean & Seed"
       , "a wrapped warehouse name")
    ok(by["1"]["name"] == "Clifford Farmers Cooperative Elevator Company" and by["1075"]["wh"] == "Hope"
       and by["1335"]["wh"] == "Galesburg" and by["1335"]["ent_bu"] == 15188000, "entity name wrapped and run into the licence column")
    ok(by["1306"]["city"] == "Portland" and by["1306"]["wh"] == "Portland (Rural)" and by["1305"]["city"] == "Portland",
       "page 10 columns; '(Rural)' taken off the town")
    ok(town_of("Mooreton (West Terminal) (2210)", "Minn-Kota Ag Products, Inc.") == "Mooreton", "qualifier off")
    ok(town_of("TriGen Makoti (113)", "TriGen Ag Partners") == "Makoti", "the licensee's leading word off")
    ok(town_of("Ardent Mills (1099)", "Ardent Mills, LLC") == "Ardent Mills"
       and town_of("Northwood (53)", "Northwood Equity Elevator Company") == "Northwood",
       "a name that is only the licensee's own stays whole")
    ok(not re.search(r"@|\(\d{3}\) \d{3}-\d{4}", SAMPLE), "no email or phone in the sample")

    def refused(text, why):
        try:
            parse(text)
        except Refused:
            return
        fails.append("should refuse: " + why)

    refused(SAMPLE.replace("Grain Broker", "Grain X").replace("Roving Grain Buyer License (3006)",
                                                              "Grain Dealer License (3006)"), "an unknown licence kind")
    refused(SAMPLE.replace("Voss Grain Company (1082)", "Voss Grain Company       "), "no entity number")
    refused(SAMPLE.replace("Hope (1075)", "Hope (1076)"), "a location's licence not the entity's")
    refused(SAMPLE.replace("Hatton (3261)", "             "), "a warehouse licence without its location")
    refused(SAMPLE.replace("$424,462.83   2,172,000 bu", "$424,462.83"), "a warehouse and no capacity")
    refused(SAMPLE.replace("$345,062.64", "$345,062.64   9,000 bu"), "a capacity and no warehouse")
    refused(SAMPLE.replace("Buxton (1169)", "Buxton (923) ").replace("Grain Warehouse License (1169)",
                                                                    "Grain Warehouse License (923) "),
            "one licence twice within one entity")
    # the same licence under two entities (the Jun 2024 list prints 14 such): kept, flagged, each with its own
    twice, _ = parse(SAMPLE.replace("Thompson (1170)", "Thompson (39)  ").replace("Grain Warehouse License (1170)",
                                                                               "Grain Warehouse License (39)  "))
    ok(sorted((r["name"][:8], r["lic_twice"]) for r in twice if r["lic"] == "39")
       == [("Thompson", True), ("Valley U", True)] and not any(r["lic_twice"] for r in rows),
       "a licence printed under two entities is flagged on both")
    refused(SAMPLE.rstrip() + "\n                                           Grain Warehouse License (7)        Oakes (7)\n",
            "lines after the last entity")
    refused(SAMPLE.replace("Entity (Entity Number)", "Something else"), "not this list")

    def fac(i, name, city, src, aliases=()):
        return {"id": i, "name": name, "company": name, "city": city, "st": "ND", "fips": None,
                "aliases": list(aliases), "sources": {"bids_repo": src}}

    els = [fac("e1", "Northwood Equity Elevator", "Northwood", ["nee-northwood"]),
           fac("e2", "Voss Grain", "Voss", ["voss"]),
           fac("e3", "Minn-Dak Growers", "Grand Forks", ["mdg-gf"]),
           fac("e4", "Thompson Farmers Coop", "Thompson", ["tfc"]),
           fac("e5", "Valley United", "Thompson", ["vu-thompson"]),
           fac("e6", "SRS Commodities", "Portland", ["srs-portland"]),
           fac("e7", "Clifford Farmers Coop", "Hope", ["cfc-hope"]),
           {"id": "e8", "name": "Voss Grain", "company": "Voss Grain", "city": "Voss", "st": "MN", "fips": None,
            "aliases": [], "sources": {"bids_repo": ["voss-mn"]}}]
    doc = build(SAMPLE, els, "2024-06-07", read="2026-10-28", sha="x")
    got = {r["lic"]: (r["id"], r["how"]) for r in doc["locations"]}
    ok(got["53"] == ("e1", "name+town"), "Northwood Equity joins at Northwood")
    ok(got["3261"] == (None, None), "not at Hatton, where we hold no facility of it")
    ok(got["13"] == ("e2", "name+town"), "Voss, North Dakota only")
    ok(got["159"] == ("e3", "name+town"), "the dba name joins")
    ok(got["39"] == ("e4", "name+town") and got["1170"] == ("e5", "name+town"),
       "two licensees in one town, each to its own")
    ok(got["1305"] == (None, None) and got["1306"] == (None, None)
       and sum(1 for a in doc["ambiguous"] if a["ids"] == ["e6"]) == 2, "two locations on one facility: neither")
    ok(got["1075"] == ("e7", "name+town") and got["1335"] == (None, None), "Clifford Farmers Cooperative at Hope only")
    ok(got["894"] == (None, None) and any(u["lic"] == "894" for u in doc["unjoined"]),
       "a location named for its licensee, no town: listed, not joined")
    ok(doc["join"]["joined"] == 6 and doc["join"]["of"] == 26, f"join count {doc['join']}")
    ok(doc["totals"]["bushels"] == sum(e["bu"] for e in ents if e["bu"]) == 42670600, f"{doc['totals']['bushels']}")
    ok(doc["totals"]["with_capacity"] == 11 and doc["totals"]["licences"]["roving"] == 2, f"{doc['totals']}")
    ok(_holds(doc), "the file holds")
    bad = dict(doc, totals=dict(doc["totals"], bushels=doc["totals"]["bushels"] + 1))
    ok(not _holds(bad), "a file whose capacities do not add up is not used")
    bad2 = dict(doc, locations=[dict(r, ent_n=1) if r["lic"] == "3261" else r for r in doc["locations"]])
    ok(not _holds(bad2), "a location count that disagrees with its entity is not used")
    ok(load("/nonexistent") is None, "no file: the pages print nothing")

    esc = lambda s: s  # noqa: E731
    bs = by_source(doc)
    one = storage_line_html(bs["voss"], doc, esc)
    ok("Licensed storage: 258,000 bushels (" in one and "ND Dept. of Agriculture</a> list, file dated Jun 7, 2024)" in one
       and "ndda.nd.gov" in one, f"a one-location licensee's line: {one}")
    many = storage_line_html(bs["cfc-hope"], doc, esc)
    ok("15,188,000 bushels for all 3 of this licensee&rsquo;s North Dakota locations together" in many
       and "no figure per location" in many, f"a several-location licensee's total is said as a total: {many}")
    two = storage_line_html(bs["nee-northwood"], doc, esc)
    ok("4,074,000 bushels for both of this licensee&rsquo;s North Dakota locations together" in two, two)
    note = state_note_html(doc, "ND", esc)
    ok("26 licensed grain warehouse and processor locations held by 11 businesses" in note and "42,670,600 bushels" in note
       and "Oct 28, 2026" in note and "not per location" in note, note)
    ok(state_note_html(doc, "NE", esc) is None, "no line on another state's page")
    ok(chr(0x2014) not in one + many + note, "no em dash in copy")

    for f in fails:
        print("FAIL", f)
    print("[nd-storage] selftest", "FAILED" if fails else "ok")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
