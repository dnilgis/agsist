#!/usr/bin/env python3
"""build_buyers.py -- where the big grain buyers are: one data/buyers.json of
ethanol plants, oilseed crush plants, export elevators, rail shuttle loaders
and river terminals, each placed at its town point. Also the helpers the cash
bid town pages and the Atlas county homes use to print one line:
"Nearby buyers within 50 miles: 2 ethanol plants, 1 oilseed crusher".

SOURCES (the plant lists researched Oct 28, 2026, filed in feedbag
notes/chatgpt/2026-10-28-answers/elevator-attributes/; one CSV per list)
  01 BNSF and 02 other railroad shuttle elevators: Kansas Department of Revenue
     grain elevator guide (Kansas only). A loader on two railroads is one row
     with both railroads named.
  03 ethanol plants: Renewable Fuels Association biorefinery list, capacity in
     million gallons a year as RFA publishes it.
  04 oilseed processing plants: NOPA plant locations (most crush soybeans; a
     few crush canola or sunflower, so the line says "oilseed crusher").
  05 river terminal: USACE river gage station page (one row).
  06 export elevators: port and operator terminal pages, capacity as each
     page states it (storage or throughput, as written).
  EIA (--eia, the U.S. Fuel Ethanol Plant Production Capacity workbook as of
  Jan 1, 2025, saved on the feedbag raw branch history/biofuel-plants/2026-10-28/)
  is read only to check the RFA list: a plant in both gets EIA's capacity
  beside RFA's; a plant in one list and not the other is written to the log,
  never placed from EIA alone.

PLACING. A plant's point is its town's point, never a guess at the gate:
  1. build_search_index.town_points(), the same lookup scripts/agstocks_plants.py
     uses (ZIP grid, elevator towns, rain-gauge towns);
  2. else the cash bid pages' own ZIP table (the bids repo's
     geocodes/zip-towns.json and data/zips/NN.json, read through
     build_cash_bid_pages.town_zips and zip_centroids): the middle of the
     town's ZIP centres.
A plant whose town has neither is listed in the log and in "unplaced", not
placed. No capacity is ever made up: a row with no published capacity has none.

    python3 scripts/build_buyers.py --src <dir of the csv files> --eia <xlsx> --bids-dir <bids clone>
    python3 scripts/build_buyers.py --selftest
"""
import csv
import hashlib
import html
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
OUT = os.path.join("data", "buyers.json")
RADIUS_MI = 50
READ = "2026-10-28"

SOURCES = {
    "rfa": ("Renewable Fuels Association", "https://ethanolrfa.org/resources/us-ethanol-and-alcohol-to-jet-biorefineries"),
    "eia": ("EIA", "https://www.eia.gov/petroleum/ethanolcapacity/"),
    "nopa": ("NOPA", "https://www.nopa.org/about-us/nopa-plant-locations/"),
    "ksrev": ("Kansas Dept. of Revenue", "https://www.ksrevenue.gov/pdf/KSGrainElevatorGuide.pdf"),
    "usace": ("USACE", "https://rivergages.mvr.usace.army.mil/"),
    "port": ("port and terminal pages", None),
}
# kind -> (one, many, CSV files, source key)
KINDS = {
    "ethanol": ("ethanol plant", "ethanol plants", ["03_ethanol_capacities_RFA_NOT_EIA.csv"], "rfa"),
    "crush": ("oilseed crusher", "oilseed crushers", ["04_soybean_crushing_plants.csv"], "nopa"),
    "export": ("export elevator", "export elevators", ["06_export_grain_elevators.csv"], "port"),
    "rail": ("rail shuttle loader", "rail shuttle loaders",
             ["01_bnsf_shuttle_grain_facilities.csv", "02_other_railroad_grain_facilities.csv"], "ksrev"),
    "river": ("river terminal", "river terminals", ["05_usace_inland_grain_terminals.csv"], "usace"),
}
ORDER = list(KINDS)
STATES = {"AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA",
          "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
          "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"}
STATE_ABBR = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
    "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
    "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
    "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
    "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA",
    "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
    "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV",
    "Wisconsin": "WI", "Wyoming": "WY"}


def tkey(name):
    """Twin of build_cash_bid_pages.town_key, with "St." read as "Saint"."""
    s = (name or "").lower().strip()
    s = re.sub(r"^st\.?\s", "saint ", s)
    s = re.sub(r"^mt\.?\s", "mount ", s)
    s = re.sub(r"^ft\.?\s", "fort ", s)
    for a, b in ((r"\bsaint\b", "st"), (r"\bmount\b", "mt"), (r"\bfort\b", "ft"), (r"\bsainte\b", "ste")):
        s = re.sub(a, b, s)
    return re.sub(r"[^a-z0-9]", "", s)


def pid(kind, op, town, st):
    return hashlib.sha1(f"{kind}|{op.lower()}|{tkey(town)}|{st}".encode()).hexdigest()[:8]


def short_cap(kind, cap):
    """The capacity as published, trimmed of the list's own boilerplate. '' when none."""
    cap = (cap or "").strip()
    if not cap:
        return ""
    if kind == "ethanol":
        m = re.match(r"^([\d.,]+) million gallons per year", cap)
        return f"{m.group(1)} million gal a year" if m else cap
    return re.sub(r"\s*\(NOT storage\)", "", cap).replace("grain/year", "of grain a year")


def mi(a_lat, a_lon, b_lat, b_lon):
    """Great-circle miles (the same formula as build_cash_bid_pages.miles)."""
    r = math.pi / 180
    x = (math.sin((b_lat - a_lat) * r / 2) ** 2
         + math.cos(a_lat * r) * math.cos(b_lat * r) * math.sin((b_lon - a_lon) * r / 2) ** 2)
    return 3958.8 * 2 * math.asin(math.sqrt(x))


# ----------------------------------------------------------------- build
def read_rows(src):
    """[(kind, row)] from every CSV, in file order."""
    out = []
    for kind, (_, _, files, _) in KINDS.items():
        for fname in files:
            with open(os.path.join(src, fname), encoding="utf-8-sig") as f:
                for i, r in enumerate(csv.DictReader(f)):
                    out.append((kind, fname, i + 2, r))
    return out


def read_eia(path):
    """{(ST, town key): [(respondent, city, MMgal/yr)]} from the EIA workbook's one sheet."""
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    out, st = {}, None
    for r in wb.worksheets[0].iter_rows(values_only=True):
        a, resp, city, cap = (r + (None,) * 4)[:4]
        if isinstance(a, str) and a.strip() in STATE_ABBR:
            st = STATE_ABBR[a.strip()]
        elif isinstance(a, str) and a.strip():
            st = None if not a.startswith("PADD") else st
        if st and resp and city and isinstance(cap, (int, float)):
            out.setdefault((st, tkey(str(city))), []).append((str(resp).strip(), str(city).strip(), cap))
    return out


def eia_check(plants, eia, log):
    """EIA beside RFA, one town at a time. Only a town with exactly one plant on
    each list is compared: that plant gets EIA's capacity beside RFA's. A town
    with several plants on either list is not paired by guess; every plant in
    one list and not the other is logged."""
    rfa = {}
    for p in plants.values():
        if p["k"] == "ethanol":
            rfa.setdefault((p["st"], tkey(p["town"])), []).append(p)
    for k in sorted(set(rfa) | set(eia)):
        a, b = rfa.get(k, []), eia.get(k, [])
        if len(a) == 1 and len(b) == 1:
            p, (resp, _, cap) = a[0], b[0]
            p["eia"] = f"{cap:g} million gal a year"
            m = re.match(r"^([\d.,]+)", p.get("cap", ""))
            if m and abs(float(m.group(1).replace(",", "")) - cap) > 0.5:
                log.append(f"capacity differs: {p['op']} ({p['town']}, {p['st']}) RFA {m.group(1)} vs EIA {cap:g} MMgal/yr")
        elif a and b:
            log.append(f"not compared, {len(a)} RFA and {len(b)} EIA plants in {a[0]['town']}, {k[0]}: "
                       + "; ".join(x["op"] for x in a) + " | " + "; ".join(f"{r} {c:g}" for r, _, c in b))
        elif a:
            for p in a:
                log.append(f"in RFA, not in EIA: {p['op']} ({p['town']}, {p['st']})")
        else:
            for r, city, c in b:
                log.append(f"in EIA, not in RFA: {r} ({city}, {k[0]}) {c:g} MMgal/yr")


def town_lookup(bids_dir=None):
    """(town, ST) -> ((lat, lon), how) or None: town_points() first, then the
    cash bid pages' ZIP table. One lookup, built from the two existing ones."""
    import build_search_index as BSI
    pts = BSI.town_points()
    by_key = {}
    for (n, st), v in pts.items():
        by_key.setdefault((st, tkey(n)), (v[1], v[2]))
    zt, zc = {}, None
    if bids_dir:
        import build_cash_bid_pages as CB
        try:
            with open(os.path.join(bids_dir, "geocodes", "zip-towns.json"), encoding="utf-8") as f:
                zips = CB.town_zips(json.load(f))
            zt = {(st, k): v for (st, k), v in zips.items()}
            zc = CB.zip_centroids(bids_dir)
        except (OSError, ValueError) as e:
            print(f"[buyers] ZIP table unreadable ({e}); town points only")

    def find(town, st):
        k = (st, tkey(town))
        if k in by_key:
            return by_key[k], "town point"
        if zc:
            cs = [c for c in (zc(z) for z in zt.get((st, CB_key(town)), [])) if c]
            if cs:
                return (sum(c[0] for c in cs) / len(cs), sum(c[1] for c in cs) / len(cs)), "ZIP table"
        return None
    return find


def CB_key(town):
    import build_cash_bid_pages as CB
    t = re.sub(r"^(?i:st)\.?\s", "Saint ", town.strip())
    t = re.sub(r"^(?i:mt)\.?\s", "Mount ", t)
    return CB.town_key(t)


def build(rows, find, eia=None):
    plants, unplaced, log = {}, [], []
    for kind, fname, line, r in rows:
        op = (r.get("operator") or "").strip()
        town = (r.get("city") or "").strip()
        st = (r.get("state") or "").strip().upper()
        name = (r.get("name") or op).strip()
        if not op or not town or st not in STATES:
            log.append(f"skipped {fname}:{line} (no operator, town or state): {name}")
            continue
        i = pid(kind, op, town, st)
        if kind == "rail":
            m = re.search(r" - (\w+) shuttle elevator$", name)
            rr = m.group(1) if m else ""
            if i in plants:
                p = plants[i]
                if rr and rr not in p["rr"]:
                    p["rr"].append(rr)
                p["rows"].append(f"{fname[:2]}:{line}")
                continue
            name = op
        elif i in plants:
            log.append(f"duplicate {fname}:{line} {name} ({town}, {st}); kept the first")
            continue
        if name.startswith(op + " - "):
            name = op
        p = {"k": kind, "n": name, "op": op, "town": town, "st": st, "src": KINDS[kind][3],
             "rows": [f"{fname[:2]}:{line}"]}
        url = (r.get("source_url") or "").strip()
        if url and url.split("?")[0] != (SOURCES[p["src"]][1] or ""):
            p["url"] = url
        if (r.get("read_date") or READ).strip() != READ:
            p["read"] = r["read_date"].strip()
        if kind == "rail":
            p["rr"] = [rr] if rr else []
        cap = short_cap(kind, r.get("capacity"))
        if cap:
            p["cap"] = cap
        pt = find(town, st)
        if pt:
            p["ll"] = [round(pt[0][0], 4), round(pt[0][1], 4)]
            if pt[1] != "town point":
                log.append(f"placed from the {pt[1]}: {name} ({town}, {st})")
        else:
            unplaced.append(f"{KINDS[kind][0]}: {name} ({town}, {st})")
        plants[i] = p
    if eia is not None:
        eia_check(plants, eia, log)
    out_plants = {}
    for i, p in sorted(plants.items(), key=lambda kv: (kv[1]["st"], kv[1]["town"], kv[1]["k"], kv[1]["n"])):
        if "ll" not in p:
            continue
        out_plants[i] = p
    srcs = {k: {"name": n, "url": u} for k, (n, u) in SOURCES.items()}
    doc = {"v": 1, "read": READ, "radius_mi": RADIUS_MI,
           "method": ("Each buyer is placed at its town point (the middle of its town), not at its gate. Capacity is as "
                      "each list publishes it; none is estimated. Built by scripts/build_buyers.py."),
           "kinds": {k: [v[0], v[1]] for k, v in KINDS.items()}, "sources": srcs,
           "plants": out_plants, "unplaced": sorted(unplaced)}
    return doc, log


# ----------------------------------------------------------------- page side
_CACHE = {}


def load(root="."):
    """The placed plants as a list, or [] when data/buyers.json is missing or bad
    (every page is then built exactly as before)."""
    path = os.path.join(root, OUT)
    if path not in _CACHE:
        try:
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
            _CACHE[path] = [dict(p, id=i) for i, p in (d.get("plants") or {}).items()
                            if isinstance(p.get("ll"), list) and len(p["ll"]) == 2 and p.get("k") in KINDS]
        except (OSError, ValueError):
            _CACHE[path] = []
    return _CACHE[path]


def near(lat, lon, plants, radius=RADIUS_MI):
    """[(rounded miles, plant)] within radius, nearest first."""
    out = []
    for p in plants:
        d = round(mi(lat, lon, p["ll"][0], p["ll"][1]))
        if d <= radius:
            out.append((d, p))
    out.sort(key=lambda x: (x[0], ORDER.index(x[1]["k"]), x[1]["n"]))
    return out


def counts_text(hits):
    c = {}
    for _, p in hits:
        c[p["k"]] = c.get(p["k"], 0) + 1
    return ", ".join(f"{c[k]} {KINDS[k][0] if c[k] == 1 else KINDS[k][1]}" for k in ORDER if k in c)


def source_line(hits):
    used = []
    for _, p in hits:
        for s in [p["src"]] + (["eia"] if p.get("eia") else []):
            if s not in used:
                used.append(s)
    used.sort(key=list(SOURCES).index)
    parts = []
    for s in used:
        n, u = SOURCES[s]
        parts.append(f'<a href="{html.escape(u)}" rel="noopener">{html.escape(n)}</a>' if u else html.escape(n))
    return "Lists from " + ", ".join(parts) + f", read {fmt_read(READ)}."


def fmt_read(iso):
    m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    y, mo, d = iso.split("-")
    return f"{m[int(mo) - 1]} {int(d)}, {y}"


BUYERS_JS = '<script src="/components/cb-buyers.js?v=1" defer></script>\n'


def line_html(hits, frm, cls="cbt-sub"):
    """One closed <details>: the count line, and inside it the list (drawn on
    open by components/cb-buyers.js from data/buyers.json) and the one note.
    '' when no buyer is within the radius."""
    if not hits:
        return ""
    ids = ",".join(f'{p["id"]}:{d}' for d, p in hits)
    return (f'<details class="buyers" data-buyers="{ids}"><summary>Nearby buyers within {RADIUS_MI} miles: '
            f'{counts_text(hits)}</summary><div class="buyers-list" aria-live="polite">The list loads when this '
            f'opens.</div><p class="{cls}">Straight-line (great-circle) miles from {html.escape(frm)} to each buyer&rsquo;s '
            f'town point, rounded to the mile; a town point is the middle of the town, not the plant&rsquo;s gate. '
            f'Capacity is as each list publishes it. This shows where the buyers are, not what they pay. '
            f'{source_line(hits)}</p></details>')


BUYERS_CSS = ("details.buyers{margin:.6rem 0;font-size:.9rem}details.buyers>summary{cursor:pointer;color:var(--text)}"
              ".buyers-list{margin:.4rem 0}.buyers-list ul{margin:.2rem 0;padding-left:1.1rem}")


# ----------------------------------------------------------------- selftest
def selftest():
    rows = [
        ("ethanol", "03.csv", 2, {"name": "Golden Grain Energy - Mason City biorefinery", "operator": "Golden Grain Energy",
                                  "city": "Mason City", "state": "IA",
                                  "capacity": "120 million gallons per year (MGY), existing capacity", "source_url": "u1",
                                  "read_date": READ}),
        ("ethanol", "03.csv", 3, {"name": "Nowhere Ethanol", "operator": "Nowhere Ethanol", "city": "Nowheresville",
                                  "state": "IA", "capacity": "50 million gallons per year (MGY), existing capacity"}),
        ("crush", "04.csv", 2, {"name": "Ag Processing Inc. - Mason City", "operator": "Ag Processing Inc.",
                                "city": "Mason City", "state": "IA", "capacity": ""}),
        ("rail", "01.csv", 2, {"name": "Flint Hills Grain LLC - BNSF shuttle elevator", "operator": "Flint Hills Grain LLC",
                               "city": "Abilene", "state": "KS"}),
        ("rail", "02.csv", 2, {"name": "Flint Hills Grain LLC - UP shuttle elevator", "operator": "Flint Hills Grain LLC",
                               "city": "Abilene", "state": "KS"}),
        ("export", "06.csv", 2, {"name": "EGT", "operator": "EGT LLC", "city": "Longview", "state": "WA",
                                 "capacity": "more than 8,000,000 metric tons grain/year handling throughput (NOT storage)"}),
    ]
    pts = {("IA", "masoncity"): (43.15, -93.2), ("KS", "abilene"): (38.92, -97.21), ("WA", "longview"): (46.14, -122.94)}
    find = lambda t, s: ((pts[(s, tkey(t))], "town point") if (s, tkey(t)) in pts else None)  # noqa: E731
    eia = {("IA", "masoncity"): [("Golden Grain Energy LLC", "MASON CITY", 125)],
           ("IA", "nowheresville"): [("A", "x", 1), ("B", "x", 2)]}
    doc, log = build(rows, find, eia)
    P = doc["plants"]
    assert len(P) == 4, P
    assert any("Nowheresville" in u for u in doc["unplaced"]), "a town with no point is listed, not placed"
    rail = [p for p in P.values() if p["k"] == "rail"]
    assert len(rail) == 1 and rail[0]["rr"] == ["BNSF", "UP"], rail
    eth = next(p for p in P.values() if p["k"] == "ethanol")
    assert eth["cap"] == "120 million gal a year" and eth["eia"] == "125 million gal a year", eth
    assert any("capacity differs" in x for x in log)
    crush = next(p for p in P.values() if p["k"] == "crush")
    assert "cap" not in crush, "no capacity is invented"
    ex = next(p for p in P.values() if p["k"] == "export")
    assert "NOT storage" not in ex["cap"] and "8,000,000 metric tons" in ex["cap"], ex
    for p in P.values():
        assert p["rows"], "every placed plant traces to a source row"
    plants = [dict(p, id=i) for i, p in P.items()]
    hits = near(43.1, -93.25, plants)
    assert counts_text(hits) == "1 ethanol plant, 1 oilseed crusher", counts_text(hits)
    h = line_html(hits, "the center of ZIP 50401")
    assert "Nearby buyers within 50 miles: 1 ethanol plant, 1 oilseed crusher" in h
    assert "Renewable Fuels Association" in h and "NOPA" in h and "EIA" in h
    assert "&mdash;" not in h and "—" not in h
    assert line_html(near(30.0, -85.0, plants), "x") == "", "no line when none"
    assert near(43.15 + 50.4 / 69.0, -93.2, plants) and not near(43.15 + 51 / 69.0, -93.2, plants)
    print("build_buyers selftest: ok")
    return 0


def main(argv):
    if "--selftest" in argv:
        return selftest()

    def arg(k):
        return argv[argv.index(k) + 1] if k in argv else None
    src = arg("--src")
    if not src:
        print(__doc__)
        return 2
    eia = read_eia(arg("--eia")) if arg("--eia") else None
    doc, log = build(read_rows(src), town_lookup(arg("--bids-dir")), eia)
    with open(os.path.join(ROOT, OUT), "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
        f.write("\n")
    by = {}
    for p in doc["plants"].values():
        by[p["k"]] = by.get(p["k"], 0) + 1
    print(f"buyers: {len(doc['plants'])} placed ({', '.join(f'{k} {by.get(k, 0)}' for k in ORDER)}), "
          f"{len(doc['unplaced'])} with no town point")
    for x in doc["unplaced"]:
        print("  not placed:", x)
    for x in log:
        print("  " + x)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
