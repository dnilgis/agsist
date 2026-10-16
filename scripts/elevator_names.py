#!/usr/bin/env python3
"""elevator_names.py -- the name a page prints for an elevator and its place.

Some boards hand the reader a page title or a code where the name goes:
"Cash Bid JSI Site - Ag State" was the elevator name on 83 Iowa town pages
(headline, FAQ and structured data) on 2026-10-15, "SF Ia Fall" was a town,
and "Dewar, IA" printed as "Dewar, IA, IA". Nothing here changes a number or
a key; it changes only the words printed. data/elevator-names.json holds the
exact fixes; the general rules below are the twin of components/cb-rank.js
displayName()/cleanPlace() and test/cashfix.test.mjs runs the same cases
through both.

Selftest: python3 scripts/elevator_names.py --selftest
"""
import json
import os
import re
import sys

NAMES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "elevator-names.json")
_OP_HEAD = re.compile(r"^\s*(?:cash\s+bid\s+)?(?:jsi\s+site|iframe|current\s+grain\s+bids)\s*-\s*", re.I)
_OP_TAIL = re.compile(r"\s*-\s*cash\s+bid\s+include\s*$", re.I)
_STATES = ("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND "
           "OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY")
_ST_TAIL = re.compile(r"(?:\s*[,.]\s*(?:" + "|".join(_STATES.split()) + r"))+\s*$", re.I)
_OP_ARCHIVED = re.compile(r"^z(?=[A-Z])|\s*\.?\b(?:OLD|Old)$")
_table = None


def table():
    global _table
    if _table is None:
        try:
            with open(NAMES_FILE, encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, ValueError):
            d = {}
        _table = {"operators": d.get("operators") or {}, "places": d.get("places") or {}}
    return _table


def display_name(op):
    """The elevator's name as printed: the exact table, else the page-title
    words stripped, else as given. '' stays ''."""
    s = (op or "").strip()
    t = table()["operators"]
    if s in t:
        return t[s]
    s = _OP_TAIL.sub("", _OP_HEAD.sub("", s)).strip().rstrip(",").strip()
    # a source system's archived copy: "zShawnee Feed Old", "zFarmers ... Co.OLD"
    s = _OP_ARCHIVED.sub("", s).strip()
    return s


def clean_place(p):
    """A town or delivery-point label as printed: the exact table, else a
    state abbreviation repeated at the end ("Dewar, IA", "AYRSHIRE.IA") and
    stray trailing commas dropped. "Hedrick, IA Feed Mill" is left alone."""
    s = (p or "").strip()
    t = table()["places"]
    if s in t:
        return t[s]
    s = s.strip("{} ").rstrip(", ").strip()
    out = _ST_TAIL.sub("", s).strip().rstrip(",").strip()
    return out or s


CASES_OP = [("Cash Bid JSI Site - Ag State", "Ag State"), ("JSI Site - Farmers Cooperative", "Farmers Cooperative"),
            ("iframe - Pearl City Elevator, Inc.", "Pearl City Elevator, Inc."),
            ("Current Grain Bids - Fremont Farms", "Fremont Farms"),
            ("American Plains Co-op - Cash Bid Include", "American Plains Co-op"),
            ("Cash Bid JSI Site - Somebody New", "Somebody New"), ("Premier Cooperative - IL", "Premier Cooperative - IL"),
            ("Farmers Coop Elevator - Morganville Coop", "Farmers Coop Elevator - Morganville Coop"),
            ("Heartland Co-op,", "Heartland Co-op"), ("zShawnee Feed Old", "Shawnee Feed"),
            ("zFarmers Cooperative Elevator Co.OLD", "Farmers Cooperative Elevator Co"),
            ("zPCE Producers Coop Elevator", "PCE Producers Coop Elevator"), ("Zeeland Farm Services", "Zeeland Farm Services"),
            ("", "")]
CASES_PLACE = [("SF Ia Fall", "Iowa Falls"), ("Dewar, IA", "Dewar"), ("Dewar, IA, IA", "Dewar"), ("AYRSHIRE.IA", "AYRSHIRE"),
               ("Hedrick, IA Feed Mill", "Hedrick, IA Feed Mill"), ("Cedar Rapids,", "Cedar Rapids"),
               ("Fall Creek", "Fall Creek"), ("Ingredion", "Ingredion"), ("IA", "IA"), ("Pocahontas.ia", "Pocahontas"),
               ("Davisboro, Ga", "Davisboro"), ("{AGP - St. Jo}", "AGP - St. Jo"), ("Mid-Missouri Energy, LLC", "Mid-Missouri Energy, LLC"),
               ("Smith, Co", "Smith"), ("", "")]


def selftest():
    for a, b in CASES_OP:
        assert display_name(a) == b, (a, display_name(a), b)
    for a, b in CASES_PLACE:
        assert clean_place(a) == b, (a, clean_place(a), b)
    print("elevator_names selftest OK")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
