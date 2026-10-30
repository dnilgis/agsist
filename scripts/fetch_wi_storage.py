#!/usr/bin/env python3
"""Licensed grain warehouse keepers in Wisconsin, from WI DATCP (Oct 28, 2026).

DATCP posts one spreadsheet of licensed grain dealers and warehouse keepers
(LicensedGrainDealersAndWarehouseKeepers.xls; read Oct 28, 2026, its sheet named "As of May 4, 2026"):
license status, legal name, mailing address, city/state/ZIP, dealer license number, warehouse
keeper license number, comments, and the disclosure rules that apply. Its last row counts the
dealer and warehouse keeper license numbers. IT HAS NO CAPACITY COLUMN, so no bushel figure is ever
printed from it: a matched elevator's town page says only that the business holds a Wisconsin grain
warehouse keeper license, with the number and the list's date.

Writes data/licensed-storage/WI.json:
  {"schema", "source": {name, short, url, as_of, read, sha256}, "totals": {...},
   "locations": [{lic, dealer, status, name, city, st, id, src, how}], "join": {...},
   "unjoined": [...], "ambiguous": [...]}
  One row per warehouse keeper license, placed at the city of its mailing address (the list names
  no other place; the join only ever lands at that town). No street address is kept.

RECONCILED OR NOTHING: the count of dealer license numbers and of warehouse keeper license numbers
must equal the sheet's own count row; each status must agree with the numbers the row carries
("Warehouse & Dealer" both, "Warehouse Only" a warehouse keeper license only, "Dealer Only" and
"Producer Agent / Dealer" a dealer license only); no warehouse keeper license twice; every row's
city reads as "City, ST ZIP"; the sheet's name gives its date. Any miss and nothing is written.

THE JOIN: scripts/licensed_storage.py (the same rules as Nebraska), Wisconsin facilities only.

Usage:
  python3 scripts/fetch_wi_storage.py --xls FILE        read the spreadsheet (needs xlrd)
  python3 scripts/fetch_wi_storage.py --check
  python3 scripts/fetch_wi_storage.py --selftest
"""
import argparse
import datetime as dt
import hashlib
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import licensed_storage as LS  # noqa: E402

ST = "WI"
OUT = os.path.join(LS.DIR, "WI.json")
URL = "https://datcp.wi.gov/Documents/LicensedGrainDealersAndWarehouseKeepers.xls"
SOURCE_NAME = "WI DATCP"
SOURCE_LONG = "Wisconsin Department of Agriculture, Trade and Consumer Protection, licensed grain dealers and warehouse keepers"
SCHEMA = 1
Refused = LS.Refused
ALIASES = {}

HEAD = ["Current License Status", "Legal Name of Entity", "Mailing Address", "City, State & Zip Code",
        "Dealer License", "Warehouse Keeper License"]
STATUS = {"Warehouse & Dealer": (True, True), "Warehouse Only": (False, True), "Dealer Only": (True, False),
          "Producer Agent / Dealer": (True, False)}
ASOF = re.compile(r"^as of ([A-Z][a-z]+ \d{1,2}, \d{4})\s*$", re.I)
CITY = re.compile(r"^(.*?),\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*$")


def _cell(v):
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def parse(sheet_name, cells):
    """cells: the sheet's rows as lists of values. -> (rows, totals, as_of)."""
    m = ASOF.match(sheet_name or "")
    if not m:
        raise Refused(f"sheet name {sheet_name!r} gives no 'As of <date>'")
    as_of = dt.datetime.strptime(m.group(1), "%B %d, %Y").date().isoformat()
    rows = [[_cell(v) for v in r] for r in cells]
    if not rows or rows[0][:len(HEAD)] != HEAD:
        raise Refused("the header is not the DATCP list's")
    body = [r for r in rows[1:] if any(r)]
    foot = body[-1] if body else []
    if not foot or any(foot[:4]) or not (foot[4].isdigit() and foot[5].isdigit()):
        raise Refused("no count row at the bottom")
    want_d, want_w = int(foot[4]), int(foot[5])
    out, n_d, n_w, seen = [], 0, 0, set()
    for r in body[:-1]:
        status, name, _addr, place, dealer, wk = r[:6]
        if not status and not name:
            continue                                   # the disclosure links under the header
        if status not in STATUS:
            raise Refused(f"unknown status {status!r} ({name})")
        need_d, need_w = STATUS[status]
        if bool(dealer) != need_d or bool(wk) != need_w:
            raise Refused(f"{name}: status {status!r} but dealer {dealer or '-'}, warehouse keeper {wk or '-'}")
        for v in (dealer, wk):
            if v and not v.isdigit():
                raise Refused(f"{name}: license number {v!r}")
        n_d += bool(dealer)
        n_w += bool(wk)
        if not wk:
            continue
        cm = CITY.match(place)
        if not cm:
            raise Refused(f"{name}: city {place!r} does not read as 'City, ST ZIP'")
        if wk in seen:
            raise Refused(f"warehouse keeper license {wk} twice")
        seen.add(wk)
        out.append({"lic": wk, "dealer": dealer or None, "status": status, "name": name,
                    "city": re.sub(r"\s+", " ", cm.group(1)).strip(), "st": cm.group(2)})
    if (n_d, n_w) != (want_d, want_w):
        raise Refused(f"{n_d} dealer and {n_w} warehouse keeper licenses, the sheet counts {want_d} and {want_w}")
    return out, {"dealer_licences": n_d, "warehouse_keepers": n_w}, as_of


def build(sheet_name, cells, elevators, read="2026-10-28", sha=None, url=URL):
    rows, totals, as_of = parse(sheet_name, cells)
    unjoined, ambiguous = LS.join(rows, elevators, (ST,), ALIASES)
    totals = dict(totals, locations=len(rows), in_state=sum(1 for r in rows if r["st"] == ST))
    return {
        "schema": SCHEMA,
        "note": ("Grain warehouse keepers licensed by Wisconsin DATCP, one row per warehouse keeper license, at the "
                 "city of the license's mailing address. The list gives no storage capacity. id: the AGSIST "
                 "elevator id when exactly one of our facilities matches; unjoined "
                 "and ambiguous rows are listed, never guessed."),
        "source": {"name": SOURCE_LONG, "short": SOURCE_NAME, "url": url, "as_of": as_of, "read": read,
                   "sha256": sha},
        "totals": totals,
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
        return (doc.get("schema") == SCHEMA and len(locs) == t["warehouse_keepers"] == t["locations"]
                and len({r["lic"] for r in locs}) == len(locs) and doc["source"]["as_of"]
                and not any("bu" in r for r in locs) and LS.joins_hold(doc))
    except (KeyError, TypeError):
        return False


by_source = LS.by_source


def _credit(doc, esc):
    s = doc["source"]
    return f'<a href="{esc(s["url"])}" rel="noopener">{esc(s["short"])}</a>'


def storage_line_html(row, doc, esc):
    """No capacity in the list: the license only, never a capacity figure."""
    return (f'<p class="cbt-sub cbt-cap" style="margin:8px 0 0">Licensed grain warehouse keeper ({_credit(doc, esc)} '
            f'license {esc(row["lic"])}, list as of {LS.fmt_date(doc["source"]["as_of"])})</p>')


def state_note_html(doc, st, esc):
    if not doc or st != ST:
        return None
    t, s = doc["totals"], doc["source"]
    out = t["locations"] - t["in_state"]
    out_txt = f", {out} of them with a mailing address outside Wisconsin" if out else ""
    return (f'<div class="cbt-note" id="licensed-storage"><b>Licensed grain storage.</b> {t["warehouse_keepers"]} '
            f'businesses hold a Wisconsin grain warehouse keeper license{out_txt} ({_credit(doc, esc)} list as of '
            f'{LS.fmt_date(s["as_of"])}). The list gives no storage capacity, so we show none. Warehouses licensed '
            f'federally instead are not on the state&rsquo;s list. Where we read a licensed business&rsquo;s bids in '
            f'the town on its license, its town page says so.</div>')


# ---------------------------------------------------------------- CLI

def _read_xls(path):
    try:
        import xlrd
    except ImportError:
        raise SystemExit("[wi-storage] needs xlrd (pip install xlrd==2.0.1)")
    book = xlrd.open_workbook(path)
    if book.nsheets != 1:
        raise SystemExit(f"[wi-storage] {book.nsheets} sheets, expected one")
    sh = book.sheet_by_index(0)
    cells = [[sh.cell_value(r, c) for c in range(sh.ncols)] for r in range(sh.nrows)]
    with open(path, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    return sh.name, cells, sha


def check(root=ROOT):
    doc = load(root)
    if doc is None:
        print(f"[wi-storage] {OUT} missing or does not add up")
        return 1
    bad = LS.check_ids(doc, "wi-storage", root)
    j = doc["join"]
    print(f"[wi-storage] {doc['totals']['warehouse_keepers']} warehouse keepers, joined {j['joined']} of {j['of']}")
    return 1 if bad else 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--xls")
    ap.add_argument("--read", default=dt.date.today().isoformat())
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    if a.check:
        return check()
    if not a.xls:
        raise SystemExit("[wi-storage] give --xls FILE")
    name, cells, sha = _read_xls(a.xls)
    try:
        doc = build(name, cells, LS.elevators(), read=a.read, sha=sha)
    except Refused as e:
        print(f"[wi-storage] REFUSED, nothing written: {e}")
        return 1
    LS.write(doc, ST)
    t, j = doc["totals"], doc["join"]
    print(f"[wi-storage] {t['warehouse_keepers']} warehouse keepers, {t['dealer_licences']} dealer licenses (as of "
          f"{doc['source']['as_of']}); joined {j['joined']} of {j['of']} ({j['rate']:.0%}), {j['with_bids_key']} with a "
          f"bids-network key; unjoined {j['unjoined']}, ambiguous {j['ambiguous']}")
    return 0


# ---------------------------------------------------------------- selftest (real rows, sheet "As of May 4, 2026")
# Rows as xlrd reads them (licence numbers as text, the count row as numbers), street addresses
# left out. The count row is recounted for these rows (the sheet's own says 205 and 83).

SHEET = "as of May 4, 2026 "
HDR = HEAD + ["Comments / Conditional Licenses", "Dealer - Required Disclosure to Producers",
              "Warehouse Keeper - Required Disclosure to Depositors"]
SAMPLE = [
    HDR,
    ["", "", "", "", "", "", "", "https://datcp.wi.gov/Documents/DealerProducerDisclosure.pdf",
     "https://datcp.wi.gov/Documents/WarehouseKeeperDepositorDisclosures.pdf"],
    ["Warehouse & Dealer", "121 Farms LLC", "", "Independence, WI 54747", "560300", "559335", "", "ATCP 99.14(2)(a)",
     "ATCP 99.26(2)(a)"],
    ["Warehouse Only", "24/7 Grain Services LLC", "", "Almena, WI 54805", "", "264124", "", "n/a", "ATCP 99.26(2)(a)"],
    ["Dealer Only", "Adell Cooperative Union", "", "Adell, WI 53001", "187807", "", "", "ATCP 99.14(2)(a)",
     "Federal License"],
    ["Warehouse & Dealer", "Eastland Feed and Grain, Inc.", "", "Shannon, IL 61078", "187983", "322669", "",
     "ATCP 99.14(2)(a)", "ATCP 99.26(2)(a)"],
    ["Warehouse & Dealer", "Great Lakes Agri-Services, Inc.", "", "Adell, WI 53001", "310907", "310905",
     "GW Conditional License", "ATCP 99.14(2)(a)", "ATCP 99.26(2)(a)"],
    ["Warehouse & Dealer", "Holtz Farms Grain LLC", "", "Lake Delton, WI  53940", "537306", "560377", "",
     "ATCP 99.14(2)(a)", "ATCP 99.26(2)(a)"],
    ["Producer Agent / Dealer", "NFO Members Grain, Inc.", "", "Ames, IA 50010", "279517", "", "", "ATCP 99.14(2)(a)",
     "n/a"],
    ["Warehouse & Dealer", "Sparta Cooperative Services", "", "Sparta, WI 54656", "187906", "188138", "",
     "ATCP 99.14(2)(a)", "ATCP 99.26(2)(a)"],
    ["Warehouse & Dealer", "Star Blends, LLC", "", "Sparta, WI 54656", "187978", "289573", "", "ATCP 99.14(2)(a)",
     "ATCP 99.26(2)(a)"],
    ["Warehouse Only", "Wiese Brothers Farms", "", "Greenleaf, WI 54126", "", "248090", "", "n/a", "ATCP 99.26(2)(a)"],
    ["", "", "", "", "", "", "", "", ""],
    ["", "", "", "", 8.0, 8.0, "", "", ""],
]


def selftest():
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)

    rows, totals, as_of = parse(SHEET, SAMPLE)
    by = {r["lic"]: r for r in rows}
    ok(as_of == "2026-05-04", "the sheet's own date")
    ok(totals == {"dealer_licences": 8, "warehouse_keepers": 8}, f"counts {totals}")
    ok(len(rows) == 8 and "187807" not in {r["dealer"] for r in rows}, "warehouse keepers only, no dealer-only row")
    ok(by["559335"]["city"] == "Independence" and by["559335"]["dealer"] == "560300", "one row read")
    ok(by["560377"]["city"] == "Lake Delton", "two spaces before the ZIP")
    ok(by["322669"]["st"] == "IL", "an Illinois mailing address stays Illinois")
    ok(by["264124"]["dealer"] is None, "warehouse only")
    ok(all(set(r) == {"lic", "dealer", "status", "name", "city", "st"} for r in rows), "no street address kept")

    def refused(cells, why, sheet=SHEET):
        try:
            parse(sheet, cells)
        except Refused:
            return
        fails.append("should refuse: " + why)

    def edit(i, j, v):
        c = [list(r) for r in SAMPLE]
        c[i][j] = v
        return c

    refused(edit(-1, 5, 9.0), "warehouse keeper count off by one")
    refused(edit(-1, 4, 7.0), "dealer count off by one")
    refused(SAMPLE[:-1], "no count row")
    refused(edit(3, 0, "Dealer Only"), "a status the numbers disagree with")
    refused(edit(3, 0, "Warehouse"), "an unknown status")
    refused(edit(10, 5, "264124"), "one warehouse keeper license twice")
    refused(edit(2, 3, "Independence WI"), "a city that does not read")
    refused(SAMPLE, "no date", sheet="Sheet1")
    refused(edit(0, 5, "Warehouse License"), "not this list")

    def fac(i, name, city, src, st="WI"):
        return {"id": i, "name": name, "company": name, "city": city, "st": st, "fips": None, "aliases": [],
                "sources": {"bids_repo": src}}

    els = [fac("w1", "121 Farms", "Independence", ["121farms"]),
           fac("w2", "Sparta Co-op Services", "Sparta", ["spartacoop"]),
           fac("w3", "Star Blends", "Sparta", ["starblends"]),
           fac("w4", "Eastland Feed & Grain", "Shannon", ["eastland"], st="IL"),
           fac("w5", "Great Lakes Agri-Services", "Adell", ["gla-a"]),
           fac("w6", "Great Lakes Agri Services Inc", "Adell", ["gla-b"]),
           fac("w7", "Holtz Farms Grain", "Wisconsin Dells", ["holtz"])]
    doc = build(SHEET, SAMPLE, els, sha="x")
    got = {r["lic"]: (r["id"], r["how"]) for r in doc["locations"]}
    ok(got["559335"] == ("w1", "name+town"), "121 Farms LLC at Independence")
    ok(got["188138"] == ("w2", "name+town") and got["289573"] == ("w3", "name+town"), "two in one town, each its own")
    ok(got["322669"] == (None, None), "Wisconsin facilities only")
    ok(got["310905"] == (None, None) and any(a["lic"] == "310905" for a in doc["ambiguous"]), "two facilities: ambiguous")
    ok(got["560377"] == (None, None), "only at the town on the license")
    ok(doc["join"]["joined"] == 3 and doc["totals"]["in_state"] == 7, f"{doc['join']} {doc['totals']}")
    ok(_holds(doc), "the file holds")
    ok(not _holds(dict(doc, locations=doc["locations"][:-1])), "a row short: not used")
    ok(not _holds(dict(doc, locations=[dict(doc["locations"][0], bu=1000)] + doc["locations"][1:])),
       "a bushel figure in a list that has none: not used")
    ok(load("/nonexistent") is None, "no file: the pages print nothing")

    esc = lambda s: s  # noqa: E731
    line = storage_line_html(by_source(doc)["121farms"], doc, esc)
    ok(line.endswith('Licensed grain warehouse keeper (<a href="https://datcp.wi.gov/Documents/LicensedGrainDealersAnd'
                     'WarehouseKeepers.xls" rel="noopener">WI DATCP</a> license 559335, list as of May 4, 2026)</p>'), line)
    ok(not re.search(r"\d,\d{3}|bushel", line), "never a capacity")
    note = state_note_html(doc, "WI", esc)
    ok("8 businesses hold a Wisconsin grain warehouse keeper license, 1 of them with a mailing address outside" in note
       and "no storage capacity" in note and "May 4, 2026" in note, note)
    ok(state_note_html(doc, "ND", esc) is None, "no line on another state's page")
    ok(chr(0x2014) not in line + note, "no em dash in copy")

    for f in fails:
        print("FAIL", f)
    print("[wi-storage] selftest", "FAILED" if fails else "ok")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
