#!/usr/bin/env python3
"""Licensed grain storage per location, from the Nebraska Public Service Commission (Oct 28, 2026).

The PSC posts a "Location Capacity Report": every grain warehouse location it licenses, with the
licence number, city, county, the licensee's legal name and the licensed bushels, a subtotal per
licence and a grand total (Oct 28, 2026: 191 locations, 451,999,873 bu, 12 of them in Kansas
under a Nebraska licence). The sandbox cannot open psc.nebraska.gov; refs.yml keeps a copy on the
references branch (id ne-psc-capacity-<yyyy-mm-dd>, references/sources.json), and this reads its
text (pdftotext -layout).

Writes data/licensed-storage/NE.json:
  {"schema", "source": {name, url, as_of, ref, sha256}, "totals": {locations, bushels, by_state},
   "locations": [{lic, name, city, county, st, fips, bu, id, src, how}], "join": {...},
   "unjoined": [...], "ambiguous": [...]}
  id is the permanent elevator id (data/ids/elevators.json) when the join below finds exactly one,
  src the bids-network boards that id holds (what a town page looks up), how the rule that matched.

RECONCILED OR NOTHING. Every line that starts with a licence number must parse; the count of
locations must equal the report's own "N LOCATIONS"; the bushels must add to its "TOTAL CAPACITY";
each licence's rows must add to the subtotal printed on its last row; every county must be a county
of its state (Nebraska, or "<name> KS"). Any miss and nothing is written (exit 1).

THE JOIN (the ids' own rules, scripts/build_ids.py; never guessed; the code is shared with the other
states in scripts/licensed_storage.py):
  1. Operator: the licensee's legal name and our facility's names (name, company, aliases) are
     compared with the cash-bid pages' operator key (build_cash_bid_pages.op_key: legal and trade
     words and the town taken out), after also taking out "Non-Stock" and "Incorporated". A legal
     name that is ONLY such words ("Farmers Cooperative", "Farmers Cooperative Company") never
     matches on its name: it matches only through a declared alias.
     ALIASES below: a licence whose company trades under another name, each with the public record
     that says so. An alias name must equal one of our facility names exactly (case and punctuation
     aside).
  2. Town: same state, same town key (build_cash_bid_pages.town_key) as the PSC city, exactly
     ("Tecumseh North" is not "Tecumseh").
  3. County: when our facility has a county (point in polygon), it must be the PSC's county.
  4. Exactly one facility, and that facility claimed by exactly one PSC row. Two or more candidates,
     or one facility claimed by two rows: no join, listed under "ambiguous" with the candidates.
     No candidate: listed under "unjoined" with the reason.

Usage:
  python3 scripts/fetch_ne_capacity.py                   read the references copy, write the file
  python3 scripts/fetch_ne_capacity.py --txt FILE [--ref ID]   read a local pdftotext -layout copy
  python3 scripts/fetch_ne_capacity.py --check           the committed file still reconciles and joins
  python3 scripts/fetch_ne_capacity.py --selftest
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import licensed_storage as LS  # noqa: E402

OUT = os.path.join("data", "licensed-storage", "NE.json")
REF_ID = "ne-psc-capacity-2026-10-28"
SOURCE_NAME = "Nebraska PSC"
SOURCE_LONG = "Nebraska Public Service Commission, Location Capacity Report"
SCHEMA = 1

# licence -> our facility names for a licensee that trades under another name. Each needs the public
# record that says so (cite). Adding one is a decision: name the record in the same commit.
ALIASES = {
    "279": {"names": ["Farmers Cooperative Dorchester", "Farmers Coop of Dorchester"],
            "cite": "PSC grain dealer list (Sep 29, 2026): licence 279, Farmers Cooperative, Dorchester. "
                    "The company signs its boards Farmers Cooperative Dorchester."},
    "378": {"names": ["Farmers Pride Coop"],
            "cite": "USDA licensed warehouse list (via the bids registry, registry-wcmd): Battle Creek Farmers "
                    "Cooperative, Non-Stock, facility name Farmers Pride, at Battle Creek and Osmond."},
    "2185": {"names": ["Pride Grain"],
             "cite": "PSC grain dealer list (Sep 29, 2026): licence 2185, Pride Enterprises, Inc. DBA Pride Grain, "
                     "Long Pine."},
}

EXTRA_NOISE = re.compile(r"\b(non\s?-?\s?stock|incorporated)\b")
LINE = re.compile(r"^\s*(\d+)\s+(\S.*?)\s+([\d,]+)\s+(\S+)(?:\s+([\d,]+))?\s*$")
FOOT = re.compile(r"^\s*([\d,]+)\s+LOCATIONS\s+TOTAL CAPACITY:\s*([\d,]+)\s*$")
ASOF = re.compile(r"As of\s+([A-Z][a-z]+ \d{1,2}, \d{4})")


Refused = LS.Refused


def _num(s):
    return int(s.replace(",", ""))


def counties(root=ROOT):
    """{(ST, county name lower): fips} for NE and KS from the site's county spine."""
    with open(os.path.join(root, "data", "atlas", "counties.geo.json"), encoding="utf-8") as f:
        doc = json.load(f)
    out = {}
    for ft in doc["features"]:
        p = ft.get("properties") or {}
        if p.get("st") in ("NE", "KS"):
            out[(p["st"], p["name"].lower())] = ft["id"]
    return out


def _split_place(mid, cmap):
    """'Frankfort North, KS Marshall KS     Farmers Cooperative' -> (city, county, st, legal name).
    Columns are two or more spaces apart; where the city and county run together the county is the
    longest county name of NE (or '<name> KS') the text before the name ends with."""
    parts = re.split(r"\s{2,}", mid.strip())
    if len(parts) < 2:
        raise Refused(f"cannot split {mid!r}")
    name = parts[-1]
    head = " ".join(parts[:-1])
    if len(parts) == 3:
        city, county = parts[0], parts[1]
    else:
        city = county = None
        for (st, cn) in sorted(cmap, key=lambda k: -len(k[1])):
            suf = cn + (" ks" if st == "KS" else "")
            if head.lower().endswith(" " + suf):
                city, county = head[: -len(suf)].strip(), head[-len(suf):]
                break
        if city is None:
            raise Refused(f"no county found in {head!r}")
    st = "NE"
    if re.search(r"\sKS$", county):
        st, county = "KS", county[:-3].strip()
    city = re.sub(r",\s*KS$", "", city).strip()
    if (st, county.lower()) not in cmap:
        raise Refused(f"county {county!r} is not a county of {st}")
    return city, county, st, name.strip()


def parse(text, cmap):
    """-> (rows, as_of). Refuses (Refused) unless every count and total reconciles."""
    rows, foot, subs = [], None, []
    m = ASOF.search(text)
    if not m:
        raise Refused("no 'As of <date>' line")
    as_of = dt.datetime.strptime(m.group(1), "%B %d, %Y").date().isoformat()
    seen_lines = 0
    for ln in text.splitlines():
        if ln.startswith("#"):
            continue
        f = FOOT.match(ln)
        if f:
            foot = (_num(f.group(1)), _num(f.group(2)))
            continue
        if not re.match(r"^\s*\d+\s+\S", ln):
            continue
        seen_lines += 1
        lm = LINE.match(ln)
        if not lm:
            raise Refused(f"line did not parse: {ln.strip()!r}")
        lic, mid, bu, _code, sub = lm.groups()
        city, county, st, name = _split_place(mid, cmap)
        rows.append({"lic": lic, "name": name, "city": city, "county": county, "st": st,
                     "fips": cmap[(st, county.lower())], "bu": _num(bu)})
        if sub:
            subs.append((len(rows) - 1, lic, _num(sub)))
    if foot is None:
        raise Refused("no 'N LOCATIONS ... TOTAL CAPACITY' line")
    if seen_lines != len(rows) or len(rows) != foot[0]:
        raise Refused(f"{len(rows)} rows parsed, the report says {foot[0]} locations")
    total = sum(r["bu"] for r in rows)
    if total != foot[1]:
        raise Refused(f"rows add to {total:,} bu, the report says {foot[1]:,}")
    # each licence's subtotal sits on its last row; rows of one licence are contiguous
    start = 0
    for i, lic, sub in subs:
        grp = rows[start:i + 1]
        if {r["lic"] for r in grp} != {lic}:
            raise Refused(f"licence {lic}: its rows are not together before its subtotal")
        if sum(r["bu"] for r in grp) != sub:
            raise Refused(f"licence {lic}: rows add to {sum(r['bu'] for r in grp):,}, subtotal says {sub:,}")
        if len({r["name"] for r in grp}) != 1:
            raise Refused(f"licence {lic}: more than one legal name")
        start = i + 1
    if start != len(rows):
        raise Refused("rows after the last licence subtotal")
    return rows, as_of


# ---------------------------------------------------------------- join

def join(rows, elevators):
    """Fills id/src/how per row; returns (unjoined, ambiguous) lists. The rules are the shared ones
    (scripts/licensed_storage.py, the docstring above): NE and KS facilities, this file's ALIASES."""
    return LS.join(rows, elevators, ("NE", "KS"), ALIASES, EXTRA_NOISE)


def build(text, elevators, cmap, ref=REF_ID, sha=None, url=None):
    rows, as_of = parse(text, cmap)
    unjoined, ambiguous = join(rows, elevators)
    by_state = {}
    for st in ("NE", "KS"):
        rs = [r for r in rows if r["st"] == st]
        by_state[st] = {"locations": len(rs), "bushels": sum(r["bu"] for r in rs)}
    joined = [r for r in rows if r["id"]]
    return {
        "schema": SCHEMA,
        "note": ("Grain warehouse locations licensed by the Nebraska Public Service Commission and the bushels "
                 "each is licensed to store, as the PSC reports them. Warehouses licensed federally instead are "
                 "not on the state's list. id: the AGSIST elevator id when exactly one of our facilities matches; "
                 "unjoined and ambiguous rows are listed, never guessed."),
        "source": {"name": SOURCE_LONG, "short": SOURCE_NAME, "as_of": as_of, "ref": ref, "sha256": sha,
                   "url": url or ("https://psc.nebraska.gov/sites/default/files/doc/"
                                  f"{as_of}%20Location%20Capacity%20Report.pdf")},
        "totals": {"locations": len(rows), "bushels": sum(r["bu"] for r in rows), "by_state": by_state},
        "join": {"joined": len(joined), "of": len(rows), "rate": round(len(joined) / len(rows), 4),
                 "by_rule": {h: sum(1 for r in joined if r["how"] == h) for h in ("name+town", "alias+town")},
                 "with_bids_key": sum(1 for r in joined if r["src"]),
                 "unjoined": len(unjoined), "ambiguous": len(ambiguous)},
        "locations": rows,
        "unjoined": [dict(u, lic=rows[u["i"]]["lic"], city=rows[u["i"]]["city"]) for u in unjoined],
        "ambiguous": [dict(a, lic=rows[a["i"]]["lic"], city=rows[a["i"]]["city"]) for a in ambiguous],
    }


# ---------------------------------------------------------------- what the pages read

def load(root=ROOT):
    """The committed file, or None (no file, or a file that does not hold together: the pages
    then print nothing, never a half number)."""
    p = os.path.join(root, OUT)
    try:
        with open(p, encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError):
        return None
    if not _holds(doc):
        return None
    return doc


def _holds(doc):
    try:
        locs = doc["locations"]
        return (doc.get("schema") == SCHEMA and len(locs) == doc["totals"]["locations"]
                and sum(r["bu"] for r in locs) == doc["totals"]["bushels"] and doc["source"]["as_of"])
    except (KeyError, TypeError):
        return False


by_source = LS.by_source
fmt_date = LS.fmt_date


def storage_line_html(row, doc, esc):
    """'Licensed storage: 6,855,106 bushels (Nebraska PSC, report of Oct 28, 2026)', the source linked."""
    s = doc["source"]
    return (f'<p class="cbt-sub cbt-cap" style="margin:8px 0 0">Licensed storage: {row["bu"]:,} bushels '
            f'(<a href="{esc(s["url"])}" rel="noopener">{esc(s["short"])}</a>, report of {fmt_date(s["as_of"])})</p>')


def state_note_html(doc, st, esc):
    """The state page's line: Nebraska only (the report's own state). None elsewhere."""
    if not doc or st != "NE":
        return None
    s, t = doc["source"], doc["totals"]
    ne, ks = t["by_state"]["NE"], t["by_state"]["KS"]
    ks_txt = (f" The same report lists {ks['locations']} more location{'s' if ks['locations'] != 1 else ''} in "
              f"Kansas under Nebraska licenses ({ks['bushels']:,} bushels), {t['locations']} locations and "
              f"{t['bushels']:,} bushels in all." if ks["locations"] else "")
    return (f'<div class="cbt-note" id="licensed-storage"><b>Licensed grain storage.</b> {ne["locations"]} grain '
            f'warehouse locations in Nebraska hold a state license for {ne["bushels"]:,} bushels '
            f'(<a href="{esc(s["url"])}" rel="noopener">{esc(s["short"])}</a>, report of {fmt_date(s["as_of"])}).'
            f'{ks_txt} Warehouses licensed federally instead are not on the state&rsquo;s list. Where we read a '
            f'licensed location&rsquo;s bids, its town page shows its licensed bushels.</div>')


# ---------------------------------------------------------------- CLI

def _ref_text(ref):
    try:
        return subprocess.run(["git", "-C", ROOT, "show", f"origin/references:refs/{ref}.txt"], check=True,
                              capture_output=True, text=True).stdout
    except subprocess.CalledProcessError:
        raise SystemExit(f"[ne-capacity] no references copy of {ref}: run "
                         "`bash scripts/fetch_private.sh references` (or refs.yml with that id) first")


def _sha(text):
    m = re.search(r"sha256 ([0-9a-f]{64})", text[:600])
    return m.group(1) if m else None


def _url(text):
    m = re.search(r"^# (https://\S+)$", text[:600], re.M)
    return m.group(1) if m else None


def _elevators(root=ROOT):
    with open(os.path.join(root, "data", "ids", "elevators.json"), encoding="utf-8") as f:
        return json.load(f)["elevators"]


def write(doc, root=ROOT):
    p = os.path.join(root, OUT)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=0, separators=(",", ":"))
        f.write("\n")


def check(root=ROOT):
    """The committed file holds together, and its joins still match today's ids file (an id that
    left elevators.json, or a board list that changed, is a stale join)."""
    doc = load(root)
    if doc is None:
        print(f"[ne-capacity] {OUT} missing or does not add up")
        return 1
    ids = {e["id"]: e for e in _elevators(root)}
    bad = [r for r in doc["locations"] if r.get("id") and r["id"] not in ids]
    for r in bad:
        print(f"[ne-capacity] licence {r['lic']} {r['city']}: id {r['id']} is no longer in data/ids/elevators.json")
    print(f"[ne-capacity] {doc['totals']['locations']} locations, {doc['totals']['bushels']:,} bu, "
          f"joined {doc['join']['joined']} of {doc['join']['of']}")
    return 1 if bad else 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--txt")
    ap.add_argument("--ref", default=REF_ID)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    if a.check:
        return check()
    if not re.fullmatch(r"ne-psc-capacity-\d{4}-\d{2}-\d{2}", a.ref):
        raise SystemExit("[ne-capacity] --ref must look like ne-psc-capacity-2026-10-28")
    text = open(a.txt, encoding="utf-8").read() if a.txt else _ref_text(a.ref)
    try:
        doc = build(text, _elevators(), counties(), ref=a.ref, sha=_sha(text), url=_url(text))
    except Refused as e:
        print(f"[ne-capacity] REFUSED, nothing written: {e}")
        return 1
    write(doc)
    j = doc["join"]
    print(f"[ne-capacity] {doc['totals']['locations']} locations, {doc['totals']['bushels']:,} bu (as of "
          f"{doc['source']['as_of']}); joined {j['joined']} of {j['of']} ({j['rate']:.0%}), {j['with_bids_key']} with a "
          f"bids-network key; unjoined {j['unjoined']}, ambiguous {j['ambiguous']}")
    return 0


# ---------------------------------------------------------------- selftest (real rows, Oct 28, 2026 report)

SAMPLE = """# Nebraska Public Service Commission, Location Capacity Report, Oct 28, 2026
# https://psc.nebraska.gov/sites/default/files/doc/2026-10-28%20Location%20Capacity%20Report.pdf
# fetched 2026-10-28T21:44:45Z, sha256 61b9080feeea5749caa9bbbc47849cf6cb712b8cdaa7390d59ad28e434415c3e

                                            LICENSED GRAIN WAREHOUSES
                                                As of October 28, 2026
License          City      County                        Legal Name      Capacity     Code License Total
     22 Jennings        Decatur KS   Ag Valley Cooperative, Non-Stock     1,501,327   8-4858
     22 Maywood         Frontier     Ag Valley Cooperative, Non-Stock     6,247,043   8-4858   7,748,370
153 Tecumseh            Johnson         Frontier Cooperative Company   1,342,487   8-5090
153 Tecumseh North      Johnson         Frontier Cooperative Company   1,472,192   8-5090   2,814,679
244 Guide Rock          Webster         Ely's, Incorporated            1,484,900   8-5471    1,484,900
279 Dorchester          Saline          Farmers Cooperative            6,855,106   8-5758
279 Frankfort North, KS Marshall KS     Farmers Cooperative            6,248,529   8-5758   13,103,635
 405 Pilger           Stanton       Farmers Cooperative                            1,905,591 8-5737      1,905,591
1013 Bruning          Thayer        Bruning Grain & Feed Co., Inc.                 4,091,067 1178486     4,091,067
2187 South Sioux City   Dakota       Richardson Milling Inc.                           3,174,867        0    3,174,867
 10 LOCATIONS                                                       TOTAL CAPACITY: 34,323,109
"""


def selftest():
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)

    cmap = counties()
    rows, as_of = parse(SAMPLE, cmap)
    ok(as_of == "2026-10-28", "as-of date")
    ok(len(rows) == 10, f"10 rows, got {len(rows)}")
    fk = [r for r in rows if r["city"] == "Frankfort North"]
    ok(fk and fk[0]["st"] == "KS" and fk[0]["county"] == "Marshall" and fk[0]["bu"] == 6248529,
       "city and county run together (single space) still split")
    ok(rows[0]["st"] == "KS" and rows[0]["county"] == "Decatur", "a Kansas county")
    ok(rows[-1]["name"] == "Richardson Milling Inc." and rows[-1]["bu"] == 3174867, "code 0 row")
    ok(any(r["lic"] == "1013" and r["bu"] == 4091067 for r in rows), "a code with no dash")

    def refused(text, why):
        try:
            parse(text, cmap)
        except Refused:
            return
        fails.append("should refuse: " + why)

    refused(SAMPLE.replace("TOTAL CAPACITY: 34,323,109", "TOTAL CAPACITY: 34,323,108"), "grand total off by one")
    refused(SAMPLE.replace(" 10 LOCATIONS", " 11 LOCATIONS"), "location count")
    refused(SAMPLE.replace("1,342,487   8-5090", "1,342,488   8-5090").replace("34,323,109", "34,323,110"),
            "licence subtotal")
    refused(SAMPLE.replace("Webster ", "Westbter"), "unknown county")
    refused(SAMPLE.replace("1,484,900   8-5471    1,484,900", "n/a   8-5471"), "a line that does not parse")
    refused(SAMPLE.replace(" 10 LOCATIONS                                                       TOTAL CAPACITY: "
                           "34,323,109", ""), "no footer")

    # the join, on facilities shaped like data/ids/elevators.json
    def fac(i, name, city, st="NE", fips=None, src=None, aliases=()):
        return {"id": i, "name": name, "company": name, "city": city, "st": st, "fips": fips,
                "aliases": list(aliases), "sources": {"bids_repo": src or []}}

    els = [fac("e1", "Ag Valley Co-op", "Maywood", fips="31063", src=["agvalley-maywood"]),
           fac("e2", "Frontier Cooperative", "Tecumseh", fips="31097", src=["frontier-tecumseh"]),
           fac("e3", "Frontier Cooperative", "Tecumseh North", fips="31097", src=["frontier-tecumsehn"]),
           fac("e4", "Elys Inc", "Guide Rock", src=["elys-guiderock"]),
           fac("e5", "Farmers Cooperative Dorchester", "Dorchester", fips="31151", src=["fcd-dorchester"],
               aliases=["FARMERS COOP OF DORCHESTER"]),
           fac("e6", "Farmers Co-Op Pilger", "Pilger", fips="31167"),
           fac("e7", "Bruning Grain & Feed Co. Inc.", "Bruning", fips="31169", src=["bruning-a"]),
           fac("e8", "Bruning Grain & Feed Co., Inc.", "Bruning", fips="31169", src=["bruning-b"]),
           fac("e9", "Richardson Milling", "South Sioux City", fips="31001")]   # wrong county
    doc = build(SAMPLE, els, cmap)
    got = {(r["lic"], r["city"]): (r["id"], r["how"]) for r in doc["locations"]}
    ok(got[("22", "Maywood")] == ("e1", "name+town"), "Non-Stock taken out: Ag Valley Co-op joins")
    ok(got[("153", "Tecumseh")] == ("e2", "name+town") and got[("153", "Tecumseh North")] == ("e3", "name+town"),
       "Tecumseh and Tecumseh North stay apart")
    ok(got[("244", "Guide Rock")] == ("e4", "name+town"), "Ely's, Incorporated = Elys Inc")
    ok(got[("279", "Dorchester")] == ("e5", "alias+town"), "licence 279 joins only through its declared alias")
    ok(got[("405", "Pilger")] == (None, None), "a legal name of only legal words never joins on its name")
    ok(got[("1013", "Bruning")] == (None, None), "two facilities in one town: ambiguous, not joined")
    ok(any(a["lic"] == "1013" and a["ids"] == ["e7", "e8"] for a in doc["ambiguous"]), "ambiguous lists both")
    ok(got[("2187", "South Sioux City")] == (None, None), "county disagrees: not joined")
    ok(got[("22", "Jennings")] == (None, None), "no facility: not joined")
    ok(doc["join"]["joined"] == 5 and doc["join"]["of"] == 10, f"join count {doc['join']}")
    bs = by_source(doc)
    ok(bs["fcd-dorchester"]["bu"] == 6855106, "board lookup")
    moved = [dict(e, sources={"bids_repo": ["fcd-dorchester-new"]}) if e["id"] == "e5" else e for e in els
             if e["id"] != "e1"]
    bs2 = by_source(doc, moved)
    ok("fcd-dorchester" not in bs2 and bs2["fcd-dorchester-new"]["lic"] == "279",
       "the boards an id holds today, not the ones it held at the join")
    ok("agvalley-maywood" not in bs2, "an id that left the ids file: no line")
    # one facility claimed by two rows: neither joins
    els2 = [fac("x1", "Frontier Cooperative", "Tecumseh", src=["s"])]
    two = SAMPLE.replace("153 Tecumseh North      Johnson", "153 Tecumseh            Johnson")
    d2 = build(two, els2, cmap)
    ok(all(r["id"] is None for r in d2["locations"] if r["lic"] == "153"), "two rows on one facility: none joins")
    ok(doc["totals"]["by_state"]["KS"] == {"locations": 2, "bushels": 1501327 + 6248529}, "Kansas rows apart")

    esc = lambda s: s  # noqa: E731
    line = storage_line_html(bs["fcd-dorchester"], doc, esc)
    ok("Licensed storage: 6,855,106 bushels" in line and "Nebraska PSC</a>, report of Oct 28, 2026)" in line
       and "psc.nebraska.gov" in line, "the town page line, credited and linked")
    note = state_note_html(doc, "NE", esc)
    ok("8 grain warehouse locations in Nebraska" in note and "2 more locations in Kansas" in note
       and "34,323,109 bushels in all" in note, "the state line: Nebraska first, Kansas apart, the report total")
    ok(state_note_html(doc, "IA", esc) is None, "no line on another state's page")
    ok(load("/nonexistent") is None, "no file: the pages print nothing")
    bad = dict(doc, totals=dict(doc["totals"], bushels=doc["totals"]["bushels"] + 1))
    ok(not _holds(bad), "a file whose rows do not add up is not used")
    ok(chr(0x2014) not in line + note, "no em dash in copy")

    for f in fails:
        print("FAIL", f)
    print("[ne-capacity] selftest", "FAILED" if fails else "ok")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
