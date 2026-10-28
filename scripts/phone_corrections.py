#!/usr/bin/env python3
"""
phone_corrections.py -- the phone numbers we have checked against a buyer's own
site, applied wherever a generator prints an elevator's phone.

WHY (2026-10-27)

Three Wisconsin rows carried an out-of-state area code (test/wi-contact-area-codes
named them on Oct 27). One was checked on the buyer's own cash-bid page and is
corrected: Cushing Cooperative, 715-648-5215 (the 918 number filed for it is
Oklahoma, which has its own Cushing). The other two could not be confirmed as the
local line, so their number is withheld rather than printed as a guess.

The numbers come into AGSIST two ways: the Barchart directory
(data/elevator-directory.json, read by build_elevator_contacts.py for the
homepage card) and the bids network's source index (read by
build_cash_bid_pages.py for the town pages). Neither file is ours to rewrite
by hand on every refresh, so the checked facts live in one small file,
data/phone-corrections.json, with the page each was read from and the date, and
both generators ask this module.

    for_directory(state, town, operator, phone) -> phone to print ("" = none)
    for_source(source_id, phone)                -> phone to print ("" = none)

Usage:
    python3 scripts/phone_corrections.py --selftest
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "..", "data", "phone-corrections.json")
_KEEP = object()


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def load(path=None):
    """The rows, checked: each needs a source URL and a read date, and a
    phone that is ten digits or null. A bad file raises; a missing one is
    no corrections."""
    p = path or PATH
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as f:
        rows = json.load(f).get("rows") or []
    for r in rows:
        if not str(r.get("source") or "").startswith("https://") or not re.match(r"^\d{4}-\d\d-\d\d$", str(r.get("read") or "")):
            raise ValueError(f"phone correction without a source page and read date: {r}")
        ph = r.get("phone")
        if ph is not None and len(re.sub(r"\D", "", ph)) != 10:
            raise ValueError(f"phone correction is not ten digits: {r}")
    return rows


_ROWS = None


def _rows():
    global _ROWS
    if _ROWS is None:
        _ROWS = load()
    return _ROWS


def _result(row):
    return row.get("phone") or ""


def for_directory(state, town, operator, phone, rows=None):
    for r in (_rows() if rows is None else rows):
        if (_norm(r.get("state")) == _norm(state) and _norm(r.get("town")) == _norm(town)
                and _norm(r.get("operator")) == _norm(operator)):
            return _result(r)
    return phone


def for_source(source_id, phone, rows=None):
    for r in (_rows() if rows is None else rows):
        if source_id and source_id in (r.get("source_ids") or []):
            return _result(r)
    return phone


def _selftest():
    rows = load()
    by = {r["town"]: r for r in rows}
    assert by["Cushing"]["phone"] == "715-648-5215" and by["Cushing"]["source"] == "https://cushingcoop.com/"
    assert for_directory("WI", "Cushing", "Cushing Cooperative", "(918) 225-6559") == "715-648-5215"
    assert for_directory("wi", "CUSHING", "Cushing Co-operative", "(918) 225-6559") == "715-648-5215", "case and punctuation"
    assert for_directory("WI", "Prairie Du Chien", "Innovative Ag Services", "319-465-6896") == "", "withheld"
    assert for_directory("WI", "Arcadia", "Pilgrims Gold N Plump", "320-202-7451") == "", "withheld"
    assert for_directory("IA", "Cedar Rapids", "Innovative Ag Services", "319-465-6896") == "319-465-6896", "other towns untouched"
    assert for_directory("OK", "Cushing", "Cushing Cooperative", "918-225-6559") == "918-225-6559", "state matters"
    assert for_source("cushingcoop-cushingcoop", "19182256559") == "715-648-5215"
    assert for_source("innovativeag-bungepdc", "13194656896") == ""
    assert for_source("innovativeag-admcr", "13194656896") == "13194656896"
    assert for_source("", "1") == "1"
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        bad = os.path.join(td, "x.json")
        for row in ({"phone": "715-648-5215", "read": "2026-10-27"},
                    {"phone": "715-648", "source": "https://x.example/", "read": "2026-10-27"},
                    {"phone": None, "source": "https://x.example/"}):
            with open(bad, "w") as f:
                json.dump({"rows": [row]}, f)
            try:
                load(bad)
                raise AssertionError(f"accepted {row}")
            except ValueError:
                pass
        assert load(os.path.join(td, "missing.json")) == []
    print("phone_corrections selftest: ok")


if __name__ == "__main__":
    import sys
    if "--selftest" in sys.argv:
        _selftest()
