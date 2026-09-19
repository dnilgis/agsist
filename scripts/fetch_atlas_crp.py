#!/usr/bin/env python3
"""
fetch_atlas_crp.py — Conservation Reserve Program acres by county, by year,
and the acres whose contracts expire, by year -> data/atlas/raw/crp.json

TWO WORKBOOKS, ONE PAGE
  https://www.fsa.usda.gov/tools/informational/reports/conservation-statistics/crp
    "CRP Enrollment and Rental Payments by County, 1986-2025"
        https://www.fsa.usda.gov/documents/crphistorycounty86-25xlsx
    "CRP Contract Expirations by County, 2020-2031+"
        https://www.fsa.usda.gov/sites/default/files/documents/EXPIRECOUNTY.xlsx
  (link text and URLs read from the page 2026-09-15; the workbooks themselves
  could not be opened from where this was written, so their layout is READ,
  not assumed: see below.)

HOW THE SHEETS ARE READ
  FSA publishes county NAMES, not FIPS codes, and re-lays these workbooks out
  from time to time. Every sheet is scanned for a header row that carries a
  state column and a county column; the table is then read one of two ways:
    wide  a column per year (1986, 1987 ... or FY2025): the cell is that
          year's value for that county
    long  a YEAR (or FY) column plus a value column
  A value column is picked by its header: for the history file the column whose
  header mentions ACRE; for expirations every year column is acres.
  If no sheet yields a header row, or the header names do not say what a value
  is, the script prints the first rows of every sheet and exits non-zero, so
  the first run against a new layout is a probe that shows what it saw and
  writes nothing wrong. Counties are joined to FIPS on (state, normalised
  name); unmatched names are listed in the output, never guessed.

USAGE
  python scripts/fetch_atlas_crp.py --selftest
  python scripts/fetch_atlas_crp.py
  python scripts/fetch_atlas_crp.py --history h.xlsx --expire e.xlsx
"""

import io
import json
import os
import re
import sys
from datetime import datetime, timezone

from urllib.parse import urljoin

from atlas_common import get, county_index, names_to_fips, log


def _host_of(url):
    return url.split("://", 1)[-1].split("/", 1)[0].lower()

# THIS ONE IS A LANDING PAGE, NOT THE WORKBOOK -- 2026-09-17.
#
# The CRP statistics page links here and the link text says xlsx, so this was
# read as a file url. It is not: it answers with an HTML page that says "Your
# file is ready" and carries the real href. The first run from a runner never
# got that far -- the connection was accepted and then dropped after 629
# seconds -- but even a successful fetch would have handed openpyxl a web page.
#
# THE REAL FILE SITS UNDER A DATED DIRECTORY, measured the same day:
#   https://www.fsa.usda.gov/sites/default/files/2026-05/CRPHistoryCounty86-25.xlsx
# and `2026-05` is why that address is NOT hardcoded here. FSA republishes this
# workbook every year -- the name already carries "86-25" -- and the next one
# lands in a different month's folder. A url pinned to 2026-05 works until it
# silently does not. So the landing page is fetched and its link followed,
# which is what a browser does and what survives the directory moving.
#
# EXPIRE_URL below needs none of this; it is already the file.
HISTORY_URL = "https://www.fsa.usda.gov/documents/crphistorycounty86-25xlsx"
EXPIRE_URL = "https://www.fsa.usda.gov/sites/default/files/documents/EXPIRECOUNTY.xlsx"
OUT = "data/atlas/raw/crp.json"
# The history gate, as a share of the map rather than a count. The old gate was
# a flat 500, written when the Atlas was 1,450 counties -- 500/1450 = 0.34. The
# map is 3,141 counties now, so a flat 500 would have passed a run that found
# CRP in one county in six. Held at the share the old gate protected.
HISTORY_MIN_SHARE = 0.34
YEAR_RE = re.compile(r"^(?:FY\s*)?((?:19|20)\d\d)(?:\s*\+)?$", re.I)
STATE_ABBR = {"ALABAMA": "AL", "ARKANSAS": "AR", "COLORADO": "CO", "ILLINOIS": "IL", "INDIANA": "IN", "IOWA": "IA",
              "KANSAS": "KS", "KENTUCKY": "KY", "MICHIGAN": "MI", "MINNESOTA": "MN", "MISSISSIPPI": "MS",
              "MISSOURI": "MO", "MONTANA": "MT", "NEBRASKA": "NE", "NEW MEXICO": "NM", "NORTH DAKOTA": "ND",
              "OHIO": "OH", "OKLAHOMA": "OK", "SOUTH DAKOTA": "SD", "TENNESSEE": "TN", "TEXAS": "TX",
              "WISCONSIN": "WI", "WYOMING": "WY", "LOUISIANA": "LA", "PENNSYLVANIA": "PA", "NEW YORK": "NY",
              "IDAHO": "ID", "WASHINGTON": "WA", "OREGON": "OR", "CALIFORNIA": "CA", "GEORGIA": "GA",
              "NORTH CAROLINA": "NC", "SOUTH CAROLINA": "SC", "VIRGINIA": "VA", "FLORIDA": "FL", "UTAH": "UT",
              "NEVADA": "NV", "ARIZONA": "AZ", "MARYLAND": "MD", "DELAWARE": "DE", "NEW JERSEY": "NJ",
              "WEST VIRGINIA": "WV", "MAINE": "ME", "VERMONT": "VT", "NEW HAMPSHIRE": "NH", "MASSACHUSETTS": "MA",
              "CONNECTICUT": "CT", "RHODE ISLAND": "RI", "HAWAII": "HI", "ALASKA": "AK"}


def cell(v):
    return str(v).strip() if v is not None else ""


def state_abbr(v):
    s = cell(v).upper()
    if len(s) == 2:
        return s
    return STATE_ABBR.get(s, s)


def year_of(h):
    m = YEAR_RE.match(cell(h))
    return int(m.group(1)) if m else None


def find_table(rows):
    """rows: iterable of tuples. Returns (header list, body rows) at the first
    row that has both a STATE-ish and a COUNTY-ish cell, or None."""
    rows = list(rows)
    for i, row in enumerate(rows):
        vals = [cell(v).upper() for v in row]
        has_state = any(v == "STATE" or v.startswith("STATE ") or v == "ST" for v in vals)
        has_county = any(v == "COUNTY" or v.startswith("COUNTY ") for v in vals)
        if has_state and has_county:
            return [cell(v) for v in row], rows[i + 1:], ([cell(v) for v in rows[i - 1]] if i else [])
    return None


def num(v):
    s = cell(v).replace(",", "").replace("$", "")
    if not s or s in ("-", "--", "*", "(D)", "NA", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


# FSA still files a county under its old code: Shannon SD is Oglala Lakota since
# 2015, Dade FL is Miami-Dade; Bedford city VA went into Bedford County in 2013,
# Clifton Forge into Alleghany, South Boston into Halifax.
FIPS_RENAME = {"46113": "46102", "12025": "12086", "02270": "02158",
               "51515": "51019", "51560": "51005", "51780": "51083"}


def fips5(v):
    s = cell(v).split(".")[0]
    if not s.isdigit() or len(s) > 5:
        return None
    s = s.zfill(5)
    return FIPS_RENAME.get(s, s)


def read_table(header, body, value_hint=None, above=None):
    """-> list of {"state","county","year","value"}; layout decided by the header.
    value_hint: substring the value column's header (long form) or the block
    label in the row above the header (wide form with a year twice, e.g. an
    ACRES block and a PAYMENTS block) must contain (upper)."""
    up = [h.upper() for h in header]
    i_state = next(i for i, h in enumerate(up) if h == "STATE" or h.startswith("STATE ") or h == "ST")
    i_county = next(i for i, h in enumerate(up) if h == "COUNTY" or h.startswith("COUNTY "))
    # the 2026 workbooks carry a FIPS column: it beats the name join, which loses
    # FSA's split districts ("W POTTAWATTAMIE", "N ST LOUIS") and typos ("MOUNTRIAL")
    i_fips = next((i for i, h in enumerate(up) if h in ("FIPS", "FIPS CODE", "COUNTY FIPS")), None)
    year_cols = [(i, year_of(h)) for i, h in enumerate(header) if year_of(h)]
    if year_cols and len({y for _, y in year_cols}) != len(year_cols):
        # two blocks of years side by side; the row above names the blocks
        labels, cur = [], ""
        for i in range(len(header)):
            v = (above[i].upper() if above and i < len(above) else "")
            cur = v or cur
            labels.append(cur)
        keep = [(i, y) for i, y in year_cols if value_hint and value_hint in labels[i]]
        if not keep or len({y for _, y in keep}) != len(keep):
            raise ValueError(f"years appear more than once and the row above does not name a {value_hint!r} block: {above}")
        year_cols = keep
    i_year = next((i for i, h in enumerate(up) if h in ("YEAR", "FY", "FISCAL YEAR", "PROGRAM YEAR", "CONTRACT EXPIRATION YEAR", "EXPIRATION YEAR")), None)
    out = []
    if year_cols and i_year is None:
        for r in body:
            st, co = state_abbr(r[i_state] if i_state < len(r) else ""), cell(r[i_county] if i_county < len(r) else "")
            if not st or not co or co.upper() in ("TOTAL", "STATE TOTAL", "US TOTAL", "GRAND TOTAL"):
                continue
            fp = fips5(r[i_fips]) if i_fips is not None and i_fips < len(r) else None
            for i, y in year_cols:
                v = num(r[i]) if i < len(r) else None
                if v is not None:
                    rec = {"state": st, "county": co, "year": y, "value": v}
                    if fp:
                        rec["fips"] = fp
                    out.append(rec)
        return out, "wide"
    if i_year is not None:
        cands = [i for i, h in enumerate(up) if i not in (i_state, i_county, i_year) and (value_hint is None or value_hint in h)]
        if not cands:
            raise ValueError(f"long layout but no value column matching {value_hint!r} in header {header}")
        i_val = cands[0]
        for r in body:
            st, co = state_abbr(r[i_state] if i_state < len(r) else ""), cell(r[i_county] if i_county < len(r) else "")
            y = year_of(r[i_year]) if i_year < len(r) else None
            v = num(r[i_val]) if i_val < len(r) else None
            if st and co and y and v is not None:
                out.append({"state": st, "county": co, "year": y, "value": v})
        return out, f"long:{header[i_val]}"
    raise ValueError(f"neither year columns nor a YEAR column in header {header}")


def fsa_proxy_path(url):
    """The Worker path for an FSA url: /fsa + the path, query dropped.

    FSA HAS NEVER ANSWERED A GITHUB RUNNER. Twice on 2026-09-17 it accepted
    the connection and held it until the far end closed. workers/atlas-rma-proxy.js
    serves /fsa/documents/... and /fsa/sites/default/files/... and nothing else,
    and atlas_common.get() uses it only after the direct route has failed."""
    path = "/" + url.split("://", 1)[-1].split("/", 1)[-1].split("?", 1)[0]
    return "/fsa" + path


# Every .xlsx is a zip, so every one begins "PK". Anything else that came back
# from a url we asked for a workbook is a page about the workbook.
XLSX_MAGIC = b"PK"
HREF_XLSX = re.compile(rb'href=["\']([^"\']+\.xlsx)["\']', re.I)


def _selftest_follow():
    """The landing-page hop, without a network."""
    real = XLSX_MAGIC + b"rest of a workbook"
    calls = []
    import builtins  # noqa: F401  (kept explicit; the stub below replaces a module global)
    global get
    orig = get
    try:
        get = lambda u, **k: calls.append(u) or real           # noqa: E731
        assert fsa_proxy_path(HISTORY_URL) == "/fsa/documents/crphistorycounty86-25xlsx"
        assert fsa_proxy_path(EXPIRE_URL) == "/fsa/sites/default/files/documents/EXPIRECOUNTY.xlsx"
        assert fsa_proxy_path("https://www.fsa.usda.gov/sites/default/files/2026-05/X.xlsx?x=1") == "/fsa/sites/default/files/2026-05/X.xlsx"
        calls.clear()
        assert follow_to_workbook(b'<a href="//www.fsa.usda.gov/sites/default/files/Y.xlsx">', "https://www.fsa.usda.gov/documents/x") is real
        assert calls == ["https://www.fsa.usda.gov/sites/default/files/Y.xlsx"], calls
        calls.clear()
        assert follow_to_workbook(b'<a href="Z.xlsx">', "https://www.fsa.usda.gov/documents/x") is real
        assert calls == ["https://www.fsa.usda.gov/documents/Z.xlsx"], calls
        calls.clear()
        try:
            follow_to_workbook(b'<a href="https://fsa.usda.gov/sites/default/files/Y.xlsx">', "https://www.fsa.usda.gov/documents/x")
            raise AssertionError("an off-host link must not be followed")
        except SystemExit as e:
            assert "another host" in str(e), e
        calls.clear()
        # already a workbook: returned untouched, nothing fetched
        assert follow_to_workbook(real, "u") is real and not calls
        # a landing page with an absolute link
        page = b'<a href="https://www.fsa.usda.gov/sites/default/files/2026-05/X.xlsx">get</a>'
        assert follow_to_workbook(page, "https://www.fsa.usda.gov/documents/x") is real
        assert calls == ["https://www.fsa.usda.gov/sites/default/files/2026-05/X.xlsx"], calls
        # and a root-relative one, resolved against the page's host
        calls.clear()
        assert follow_to_workbook(b"<a href='/sites/default/files/2026-05/X.xlsx'>",
                                  "https://www.fsa.usda.gov/documents/x") is real
        assert calls == ["https://www.fsa.usda.gov/sites/default/files/2026-05/X.xlsx"], calls
        # a page with no link at all must exit loudly, never return the page
        calls.clear()
        try:
            follow_to_workbook(b"<html>nothing here</html>", "https://www.fsa.usda.gov/documents/x")
        except SystemExit as e:
            assert "carry no .xlsx link" in str(e), e
        else:
            raise AssertionError("a page with no workbook link must not pass silently")
    finally:
        get = orig


def follow_to_workbook(body, from_url):
    """The bytes of a workbook, following one landing page if that is what came back.

    ONE HOP, NOT A CRAWLER. If the page it lands on is another page, that is a
    different failure and it should say so rather than wander."""
    if body is None or body[:2] == XLSX_MAGIC:
        return body
    hrefs = HREF_XLSX.findall(body)
    if not hrefs:
        sys.exit(f"{from_url} returned {len(body)} bytes that are not a workbook and carry no "
                 f".xlsx link. Open it in a browser: the CRP statistics page has been relaid out.")
    # urljoin, not a string prefix: a protocol-relative "//host/x" or a
    # page-relative "x.xlsx" would otherwise become a malformed url. And the
    # link must stay on the host we asked: anything else would get neither the
    # short FSA timeout nor the proxy route, and could hang a runner 20 minutes.
    href = urljoin(from_url, hrefs[0].decode("utf-8", "replace"))
    if _host_of(href) != _host_of(from_url):
        sys.exit(f"{from_url} links its workbook on another host ({href}); not following it. "
                 "Open the CRP statistics page in a browser and check the link.")
    log(f"  landing page; following {href}")
    got = get(href, proxy_path=fsa_proxy_path(href))
    if got is None or got[:2] != XLSX_MAGIC:
        sys.exit(f"{href} did not return a workbook either")
    return got


def read_workbook(xlsx_bytes, value_hint=None, label="", sheet=None):
    """sheet: keep only the worksheet of that title when the workbook has it.
    The 2026 history workbook has three sheets of the same shape -- ACRES,
    RENT ($) and AVERAGE ($/acre) -- and reading every sheet summed dollars
    into acres."""
    try:
        import openpyxl
    except ImportError:
        sys.exit("openpyxl missing: pip install openpyxl")
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), read_only=True, data_only=True)
    found = []
    previews = []
    sheets = wb.worksheets
    if sheet and any(ws.title.strip().upper() == sheet for ws in sheets):
        sheets = [ws for ws in sheets if ws.title.strip().upper() == sheet]
    elif len(sheets) > 1:
        log(f"  {label}: no sheet called {sheet!r}; reading all {len(sheets)}")
    for ws in sheets:
        rows = list(ws.iter_rows(values_only=True, max_row=20000))
        previews.append((ws.title, rows[:6]))
        t = find_table(rows)
        if t is None:
            continue
        header, body, above = t
        try:
            recs, layout = read_table(header, body, value_hint, above)
        except ValueError as e:
            log(f"  {label} sheet {ws.title!r}: {e}")
            continue
        log(f"  {label} sheet {ws.title!r}: {layout}, {len(recs)} values; header {header[:12]}{'...' if len(header) > 12 else ''}")
        found.extend(recs)
    if not found:
        log(f"{label}: no sheet yielded a table. First rows of every sheet:")
        for title, rows in previews:
            log(f"  sheet {title!r}")
            for r in rows:
                log("    " + " | ".join(cell(v) for v in r)[:400])
        sys.exit(f"{label}: layout not recognised; nothing written")
    return found


def to_counties(recs, idx, add=True):
    """add: sum rows that land on one county (acres); False keeps the first (a rate)."""
    on_map = set(idx.values())
    by_code = [r for r in recs if r.get("fips") in on_map]
    by_name = [r for r in recs if r.get("fips") not in on_map]
    by_fips, unmatched = names_to_fips(by_name, idx)
    for r in by_code:
        by_fips.setdefault(r["fips"], []).append(r)
    out = {}
    if not add:
        for fips, rows in by_fips.items():
            years = {}
            for r in rows:
                years.setdefault(r["year"], r["value"])
            out[fips] = years
        return out, sorted(set(unmatched))
    for fips, rows in by_fips.items():
        years = {}
        for r in rows:
            years[r["year"]] = years.get(r["year"], 0.0) + r["value"]
        out[fips] = years
    seen = sorted(set(unmatched))
    return out, seen


def selftest():
    hdr = ["STATE", "COUNTY", "FY2020", "2021", "2022+"]
    body = [("IOWA", "Story", 100, "1,200", None), ("Iowa", "Adair", "-", 5, 7), ("IOWA", "TOTAL", 1, 1, 1), ("AL", "Autauga", 3, 3, 3)]
    recs, layout = read_table(hdr, body)
    assert layout == "wide" and len(recs) == 7, (layout, recs)
    assert recs[0] == {"state": "IA", "county": "Story", "year": 2020, "value": 100.0} and recs[1]["value"] == 1200.0
    hdr2 = ["State", "County", "Year", "Acres", "Rental Payments ($)"]
    body2 = [("IA", "Story", 1990, "10,000", "$1,000,000"), ("IA", "Story", "1991", 11000, 1), ("IA", "Story", 1992, None, 1)]
    recs2, layout2 = read_table(hdr2, body2, "ACRE")
    assert layout2 == "long:Acres" and [r["value"] for r in recs2] == [10000.0, 11000.0], recs2
    assert find_table([("CRP report", None), ("", ""), ("STATE", "COUNTY", "2020")]) == (["STATE", "COUNTY", "2020"], [], ["", ""])
    hdr3 = ["STATE", "COUNTY", "2020", "2021", "2020", "2021"]
    above3 = ["", "", "ACRES", "", "RENTAL PAYMENTS", ""]
    recs3, _ = read_table(hdr3, [("IA", "Story", 1, 2, 300, 400)], "ACRE", above3)
    assert [r["value"] for r in recs3] == [1.0, 2.0], recs3
    try:
        read_table(hdr3, [], "ACRE", None)
        raise AssertionError("duplicate years accepted")
    except ValueError:
        pass
    assert find_table([("a", "b")]) is None
    geo = {"features": [{"id": "19169", "properties": {"name": "Story", "st": "IA"}, "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}}]}
    c, un = to_counties(recs, county_index(geo))
    assert c == {"19169": {2020: 100.0, 2021: 1200.0}} and un == [("AL", "Autauga"), ("IA", "Adair")], (c, un)
    hdr4 = ["STATE", "COUNTY", "FIPS", "2024", "2025"]
    recs4, _ = read_table(hdr4, [("IOWA", "W POTTAWATTAMIE", 19155, 10, 20), ("SOUTH DAKOTA", "SHANNON 2/", 46113, 0, 7), ("IOWA", "STORY", 19169.0, 1, 2)])
    assert recs4[0]["fips"] == "19155" and recs4[2]["fips"] == "46102" and recs4[4]["fips"] == "19169", recs4
    geo4 = {"features": [{"id": f, "properties": {"name": n, "st": st}, "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}}
                         for f, n, st in (("19155", "Pottawattamie", "IA"), ("46102", "Oglala Lakota", "SD"), ("19169", "Story", "IA"))]}
    c4, un4 = to_counties(recs4, county_index(geo4))
    assert c4 == {"19155": {2024: 10.0, 2025: 20.0}, "46102": {2024: 0.0, 2025: 7.0}, "19169": {2024: 1.0, 2025: 2.0}} and un4 == [], (c4, un4)
    log("selftest ok")


def main():
    if "--selftest" in sys.argv:
        _selftest_follow()
        selftest()
        return
    if "--history" in sys.argv:
        with open(sys.argv[sys.argv.index("--history") + 1], "rb") as f:
            hist_bytes = f.read()
        with open(sys.argv[sys.argv.index("--expire") + 1], "rb") as f:
            exp_bytes = f.read()
    else:
        log(f"downloading {HISTORY_URL}")
        hist_bytes = follow_to_workbook(get(HISTORY_URL, proxy_path=fsa_proxy_path(HISTORY_URL)), HISTORY_URL)
        log(f"downloading {EXPIRE_URL}")
        exp_bytes = follow_to_workbook(get(EXPIRE_URL, proxy_path=fsa_proxy_path(EXPIRE_URL)), EXPIRE_URL)
        if hist_bytes is None or exp_bytes is None:
            sys.exit("FSA returned 404 for a CRP workbook; the link on the CRP statistics page has moved")
    idx = county_index()
    hist = read_workbook(hist_bytes, "ACRE", "history", sheet="ACRES")
    exp = read_workbook(exp_bytes, "ACRE", "expirations")
    # the average rental payment per acre, the sheet FSA calls AVERAGE; absent in older workbooks
    try:
        rate = read_workbook(hist_bytes, None, "rate", sheet="AVERAGE")
        rate_c, _ = to_counties(rate, idx, add=False) if any(True for _ in rate) else ({}, [])
    except SystemExit:
        rate_c = {}
    hist_c, hist_un = to_counties(hist, idx)
    exp_c, exp_un = to_counties(exp, idx)
    log(f"  history: {len(hist_c)} Atlas counties, {len(hist_un)} unmatched names (non-Atlas states included)")
    log(f"  expirations: {len(exp_c)} Atlas counties, {len(exp_un)} unmatched")
    atlas_states = {ft_st for ft_st, _ in idx}
    un_atlas = sorted(set(u for u in hist_un + exp_un if u[0] in atlas_states))
    if un_atlas:
        log(f"  unmatched Atlas-state names ({len(un_atlas)}): {un_atlas[:40]}")
    # WHAT THIS GATE CATCHES: the name join losing a whole class of county in
    # silence. FSA writes the unit word -- "Acadia Parish", "Bethel Census
    # Area", "Juneau City and Borough", "Alexandria city" -- and a normaliser
    # that does not know one of those spellings drops every county that uses
    # it: 64 Louisiana parishes, 29 Alaska boroughs and census areas, 40
    # independent cities. Each of those alone is too small to notice in a
    # county count; together with a layout change they are not.
    n_map = len(set(idx.values()))
    floor = int(n_map * HISTORY_MIN_SHARE)
    if len(hist_c) < floor:
        sys.exit(f"only {len(hist_c)} of {n_map} Atlas counties in the history workbook, floor {floor} ({HISTORY_MIN_SHARE:.0%} of the map); the name join or the layout is wrong; nothing written")
    counties = {}
    for fips in set(hist_c) | set(exp_c):
        counties[fips] = {"acres": {str(y): round(v, 1) for y, v in sorted(hist_c.get(fips, {}).items())},
                          "expiring": {str(y): round(v, 1) for y, v in sorted(exp_c.get(fips, {}).items())},
                          "rate": {str(y): round(v, 2) for y, v in sorted(rate_c.get(fips, {}).items()) if v}}
    hist_years = sorted({y for c in hist_c.values() for y in c})
    exp_years = sorted({y for c in exp_c.values() for y in c})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "USDA FSA CRP statistics: enrollment by county 1986-2025 and contract expirations by county",
                   "urls": [HISTORY_URL, EXPIRE_URL],
                   "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "history_years": [hist_years[0], hist_years[-1]] if hist_years else [],
                   "expire_years": [exp_years[0], exp_years[-1]] if exp_years else [],
                   "unmatched_atlas_names": un_atlas,
                   "counts": {"history": len(hist_c), "expirations": len(exp_c)},
                   "counties": counties}, f, separators=(",", ":"))
    log(f"wrote {OUT}: {len(counties)} counties")


if __name__ == "__main__":
    main()
