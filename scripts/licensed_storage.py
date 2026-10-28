#!/usr/bin/env python3
"""Shared parts of the state licensed-storage readers (Oct 28, 2026).

Each state reader parses its own list (the formats share nothing: a PSC report, an ND
Department of Agriculture PDF, a DATCP spreadsheet) and writes data/licensed-storage/<ST>.json.
What they share lives here, so the rules cannot drift apart between states:

  join()        the one join from a licensed location to the AGSIST elevator ids (rules below)
  by_source()   {bids board id: location row} for the boards a joined id holds today
  read_json(), write(), fmt_date()

THE JOIN (the ids' own rules, scripts/build_ids.py; never guessed):
  1. Operator: each of the licensee's names (its legal name, and a "dba" trade name when the list
     prints one) and our facility's names (name, company, aliases) are compared with the cash-bid
     pages' operator key (build_cash_bid_pages.op_key: legal and trade words and the town taken
     out), after also taking out the reader's extra noise words ("Non-Stock", "Incorporated").
     A name that is ONLY such words ("Farmers Cooperative") never matches on its name: it matches
     only through a declared alias. Aliases: licence -> our facility names, each with the public
     record that says so; an alias must equal one of our facility names exactly (case and
     punctuation aside).
  2. Town: same state, same town key (build_cash_bid_pages.town_key), exactly.
  3. County: when both the row and our facility have a county (fips), they must agree.
  4. Exactly one facility, and that facility claimed by exactly one row. Two or more candidates,
     or one facility claimed by two rows: no join, listed under "ambiguous" with the candidates.
     No candidate: listed under "unjoined" with the reason.

Every page line built from these files is printed only for a joined row whose facility holds the
board today (by_source with today's ids), and the reader's own load() refuses a file that does not
add up to its own totals.
"""
import datetime as dt
import json
import os
import re
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DIR = os.path.join("data", "licensed-storage")

DEFAULT_NOISE = re.compile(r"\b(non\s?-?\s?stock|incorporated)\b")
HOWS = ("name+town", "alias+town")


class Refused(Exception):
    """The list does not reconcile to its own totals: nothing is written."""


def op(name, town="", noise=DEFAULT_NOISE):
    from build_cash_bid_pages import op_key
    return op_key(noise.sub(" ", (name or "").lower()), town)


def full(name):
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def row_names(r):
    return [n for n in (r.get("names") or [r.get("name")]) if n]


def join(rows, elevators, states, aliases=None, noise=DEFAULT_NOISE):
    """Fills id/src/how on each row (name or names, city, st, lic, optional fips); returns
    (unjoined, ambiguous), each a list of {i, why[, ids]}. elevators: data/ids/elevators.json records."""
    from build_cash_bid_pages import town_key
    aliases = aliases or {}
    by_town = defaultdict(list)
    for e in elevators:
        if e.get("st") in states:
            by_town[(e["st"], town_key(e.get("city") or ""))].append(e)
    claims = defaultdict(list)
    unjoined, ambiguous = [], []
    for i, r in enumerate(rows):
        r.update(id=None, src=[], how=None)
        lk = {k for n in row_names(r) for k in (op(n, r["city"], noise), op(n, "", noise)) if k}
        alias = {full(n) for n in aliases.get(r["lic"], {}).get("names", [])}
        cands = []
        for e in by_town.get((r["st"], town_key(r["city"])), []):
            names = {e.get("name"), e.get("company"), *(e.get("aliases") or [])} - {None, ""}
            how = None
            if lk & {k for n in names for k in (op(n, e.get("city") or "", noise), op(n, "", noise)) if k}:
                how = "name+town"
            elif alias & {full(n) for n in names}:
                how = "alias+town"
            if how:
                cands.append((e, how))
        if not cands:
            unjoined.append({"i": i, "why": "no facility of this operator in this town in our list"})
            continue
        ok = [(e, h) for e, h in cands if not e.get("fips") or not r.get("fips") or e["fips"] == r["fips"]]
        if not ok:
            unjoined.append({"i": i, "why": "our facility there is placed in another county"})
            continue
        if len(ok) > 1:
            ambiguous.append({"i": i, "why": f"{len(ok)} facilities of this operator in this town",
                              "ids": sorted(e["id"] for e, _ in ok)})
            continue
        claims[ok[0][0]["id"]].append((i, ok[0]))
    for eid, cl in claims.items():
        if len(cl) > 1:
            for i, _ in cl:
                ambiguous.append({"i": i, "why": f"{len(cl)} licensed locations point at one facility", "ids": [eid]})
            continue
        i, (e, how) = cl[0]
        rows[i].update(id=eid, src=sorted((e.get("sources") or {}).get("bids_repo") or []), how=how)
    unjoined.sort(key=lambda u: u["i"])
    ambiguous.sort(key=lambda u: u["i"])
    return unjoined, ambiguous


def join_summary(rows, unjoined, ambiguous):
    joined = [r for r in rows if r["id"]]
    return {"joined": len(joined), "of": len(rows), "rate": round(len(joined) / len(rows), 4) if rows else 0,
            "by_rule": {h: sum(1 for r in joined if r["how"] == h) for h in HOWS},
            "with_bids_key": sum(1 for r in joined if r["src"]),
            "unjoined": len(unjoined), "ambiguous": len(ambiguous)}


def listed(rows, items):
    return [dict(u, lic=rows[u["i"]]["lic"], city=rows[u["i"]]["city"]) for u in items]


def by_source(doc, elevators=None):
    """{bids source id: location row} for joined rows whose facility holds that board. A board id that
    two rows would claim is left out. elevators (data/ids/elevators.json records, when given): the
    boards each id holds TODAY, so a board the ids later moved to another facility loses the line
    (an id no longer there: no line)."""
    now = None
    if elevators is not None:
        now = {e["id"]: sorted((e.get("sources") or {}).get("bids_repo") or []) for e in elevators}
    out, dup = {}, set()
    for r in (doc or {}).get("locations") or []:
        if not r.get("id"):
            continue
        for s in (r.get("src") or []) if now is None else now.get(r["id"], []):
            if s in out:
                dup.add(s)
            out[s] = r
    for s in dup:
        del out[s]
    return out


def joins_hold(doc):
    """One id per row, one row per id, every row joined, unjoined or ambiguous exactly once."""
    try:
        locs = doc["locations"]
        ids = [r["id"] for r in locs if r.get("id")]
        listed_i = [u["i"] for u in doc["unjoined"]] + [a["i"] for a in doc["ambiguous"]]
        return (len(set(ids)) == len(ids) and len(ids) + len(listed_i) == len(locs)
                and len(set(listed_i)) == len(listed_i)
                and all(locs[i].get("id") is None for i in listed_i)
                and all(r.get("id") is None or r.get("how") in HOWS for r in locs))
    except (KeyError, TypeError, IndexError):
        return False


def fmt_date(iso):
    d = dt.date.fromisoformat(iso)
    return f"{d.strftime('%b')} {d.day}, {d.year}"


def read_json(st, root=ROOT):
    try:
        with open(os.path.join(root, DIR, f"{st}.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def write(doc, st, root=ROOT):
    p = os.path.join(root, DIR, f"{st}.json")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=0, separators=(",", ":"))
        f.write("\n")


def elevators(root=ROOT):
    with open(os.path.join(root, "data", "ids", "elevators.json"), encoding="utf-8") as f:
        return json.load(f)["elevators"]


def check_ids(doc, tag, root=ROOT):
    """Joined ids that left data/ids/elevators.json (a stale join): printed, and the count returned."""
    ids = {e["id"] for e in elevators(root)}
    bad = [r for r in doc["locations"] if r.get("id") and r["id"] not in ids]
    for r in bad:
        print(f"[{tag}] licence {r['lic']} {r['city']}: id {r['id']} is no longer in data/ids/elevators.json")
    return len(bad)


def readers():
    """The state readers the cash-bid pages use, in a fixed order."""
    import fetch_ne_capacity
    import fetch_nd_storage
    import fetch_wi_storage
    return [fetch_ne_capacity, fetch_nd_storage, fetch_wi_storage]
