#!/usr/bin/env python3
"""
build_elevator_contacts.py -- phone and facility type per elevator, sharded by
state, small enough for the homepage cash card to load.

WHY (WAVE1-A, 2026-10-03)

The cash card can offer a Call link and say what kind of buyer an elevator is
only if the page can load a file that says so. data/elevator-directory.json
says so for 2,185 phones and 711 facility types, but it is 650 KB and
national. This writes the same facts, nothing added, as one file per state:

data/elevator-contacts/<ST>.json
    rows: [[operator, town, phone, facility_type], ...]

operator   the directory's `company`, else its `facility`. Written as the
           directory has it; the page normalises names itself (the same
           normOperator() it already uses to merge the two feeds), so there is
           one copy of that rule.
phone      as written, only when it is ten digits after an optional leading 1
           and not one digit repeated (the directory carries 9999999999 for
           "none"). Otherwise empty.
type       the directory's own `facility_type`, only from the list the page
           knows how to word. Nothing is inferred from a name: "Farmers Co-op"
           is not tagged a co-op, because no field says it is.

Usage:
    python3 scripts/build_elevator_contacts.py
    python3 scripts/build_elevator_contacts.py --selftest
"""
import argparse
import datetime as dt
import glob
import json
import os
import re

REPO = os.environ.get("AGSIST_REPO", ".")
SRC = os.path.join(REPO, "data/elevator-directory.json")
OUT_DIR = os.path.join(REPO, "data/elevator-contacts")
TYPES = {"Country Elevator", "Ethanol/Bio-Fuel", "River Terminal", "Export Terminal", "Feed Mill", "Feedlot"}
MIN_ROWS = 500   # a directory this thin is a broken read, not a shrinking country


def clean_phone(p):
    d = re.sub(r"\D", "", str(p or ""))
    if len(d) == 11 and d[0] == "1":
        d = d[1:]
    if len(d) != 10 or len(set(d)) == 1 or d[0] in "01":
        return ""
    return str(p).strip()


def shards_from(directory):
    out = {}
    for e in directory.get("elevators") or []:
        st = str(e.get("state") or "").strip().upper()
        if len(st) != 2 or not st.isalpha():
            continue
        op = str(e.get("company") or e.get("facility") or "").strip()
        town = str(e.get("city") or "").strip()
        if not op or not town:
            continue
        phone = clean_phone(e.get("phone"))
        ftype = e.get("facility_type") if e.get("facility_type") in TYPES else ""
        if not phone and not ftype:
            continue
        out.setdefault(st, set()).add((op, town, phone, ftype))
    return {st: [list(r) for r in sorted(rows)] for st, rows in out.items()}


def main_build():
    with open(SRC) as f:
        directory = json.load(f)
    shards = shards_from(directory)
    n = sum(len(v) for v in shards.values())
    if n < MIN_ROWS:
        raise SystemExit(f"only {n} contact rows from {SRC}; refusing to overwrite the shards")
    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    wrote = 0
    for st, rows in shards.items():
        fp = os.path.join(OUT_DIR, st + ".json")
        old = None
        if os.path.exists(fp):
            with open(fp) as f:
                old = json.load(f)
        if old and old.get("rows") == rows:
            continue
        doc = {"generated": stamp, "from": "data/elevator-directory.json (" + str(directory.get("generated")) + ")",
               "cols": ["operator", "town", "phone", "facility_type"],
               "note": "Phone and facility type exactly as the elevator directory files them. No type is inferred from a name.",
               "rows": rows}
        with open(fp, "w") as f:
            json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
        wrote += 1
    for fp in glob.glob(os.path.join(OUT_DIR, "*.json")):
        if os.path.basename(fp)[:-5] not in shards:
            os.remove(fp)
    print(f"[elevator-contacts] {n} rows in {len(shards)} states; {wrote} shard(s) changed")


def selftest():
    assert clean_phone("(715) 555-0142") == "(715) 555-0142"
    assert clean_phone("1-715-555-0142") == "1-715-555-0142"
    assert clean_phone("9999999999") == "", "repeated digit is the directory's 'none'"
    assert clean_phone("N/A") == "" and clean_phone("555-0142") == "" and clean_phone("0155550142") == ""
    d = {"elevators": [
        {"company": "One Earth Energy", "city": "Gibson City", "state": "IL", "phone": "(217) 784-5321", "facility_type": "Ethanol/Bio-Fuel"},
        {"facility": "Farmers Co-op", "city": "Dumas", "state": "TX", "phone": "9999999999"},
        {"facility": "Badger Grain", "city": "Wheeler", "state": "wi", "phone": "715-555-0142", "facility_type": "Direct Ship"},
        {"facility": "Nowhere", "city": "X", "state": "AB", "phone": "403-766-2000"},
        {"facility": "Agrex Inc", "city": "Montgomery", "state": "AL", "phone": "(334) 262-6051"},
        {"facility": "Agrex Inc", "city": "Montgomery", "state": "AL", "phone": "(334) 262-6051"},
    ]}
    s = shards_from(d)
    assert s["IL"] == [["One Earth Energy", "Gibson City", "(217) 784-5321", "Ethanol/Bio-Fuel"]], s
    assert "TX" not in s, "no phone and no type: no row; a co-op is never inferred from the name"
    assert s["WI"] == [["Badger Grain", "Wheeler", "715-555-0142", ""]], "Direct Ship is not a buyer type"
    assert s["AL"] == [["Agrex Inc", "Montgomery", "(334) 262-6051", ""]], "duplicates fold"
    assert "AB" in s, "a two-letter province passes; the page only ever asks for the state an elevator is in"
    print("build_elevator_contacts selftest: ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    selftest() if a.selftest else main_build()
