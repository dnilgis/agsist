#!/usr/bin/env python3
"""stories_prf.py: the dated lead paragraph on each PRF county page (prf/<state>/<county>.html).

FACTS (only what the page prints, as it prints it; scripts/build_prf_counties.py page())
  the grids, USDA's county base values, each pair of months on the middle grid
  (normal, premium per $100 at 90%, years of the record under 90% of normal),
  the wettest and driest pair and where coverage costs least and most, the last
  full year and the open year's published pairs (percent of normal), each grid's
  driest year and years under 90%, and, labeled preliminary, an ended pair RMA
  has not published yet, from the page's "This interval so far" card
  (data/prf/now/<ST>.json, the card's own grid and arithmetic).
  Left out on purpose: the payback per premium dollar, the priced example and
  the deadlines (the PRF rule: the page stays neutral, sells nothing, routes no
  one to an agent).

THE PAGE: build_prf_counties.py prints a kept story under the lede only when the
county's facts rebuilt now (plus the stored "as of" day and preliminary figure)
hash to the story's own, it passes check(), and it is at most 35 days older than
the data the page was built from.

  python3 scripts/stories_core.py selftest prf
  python3 scripts/stories_core.py bundle prf OUT.json
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import stories_core as K  # noqa: E402

NAME, PREFIX = "prf", "p"
STORE = os.path.join("data", "prf-stories")      # not under data/prf: prf.yml rebuilds that folder from scratch
VOLATILE = ("as_of", "as_of_iso", "preliminary")
MAX_AGE = 35
LONG_IV = ["January to February", "February to March", "March to April", "April to May", "May to June", "June to July",
           "July to August", "August to September", "September to October", "October to November", "November to December"]
SHORT_IV = ["Jan-Feb", "Feb-Mar", "Mar-Apr", "Apr-May", "May-Jun", "Jun-Jul", "Jul-Aug", "Aug-Sep", "Sep-Oct", "Oct-Nov", "Nov-Dec"]
NOW_MAX_AGE = 10      # components/prf-now.js MAX_AGE: past this the card itself holds its numbers back
MIN_AVG_MM = 5        # components/prf-now.js MIN_AVG_MM


def _B():
    import build_prf_counties as B
    return B


def money2(x):
    return None if x is None else f"${x:,.2f}"


def js_round(x):
    import math
    return math.floor(x + 0.5)


def preliminary(now_doc, grid, rec_open):
    """The card's own figures for the ended pairs of months RMA has not published
    (components/prf-now.js model()), or None. Never an open pair: its index so far
    only climbs, so a dated line about it would read low by the time anyone saw it."""
    if not now_doc or not now_doc.get("g") or not now_doc.get("through"):
        return None
    row = now_doc["g"].get(str(grid))
    if not row:
        return None
    import datetime as dt
    thr = dt.date.fromisoformat(now_doc["through"])
    out = []
    for k, m in enumerate(now_doc.get("iv") or []):
        if m.get("withheld") or dt.date.fromisoformat(m["to"]) > thr:
            continue
        i, y = m["i"], m["y"]
        if rec_open and rec_open.get("year") == y and rec_open["iv"][i] is not None:
            continue     # RMA's own index is on the page already
        cell = row[k] if k < len(row) else None
        if not cell or cell[0] is None or not cell[1]:
            continue
        a = cell[1] / 10
        if a < MIN_AVG_MM:
            continue
        idx = js_round(cell[0] / cell[1] * 1000) / 10
        how = m.get("how") or []
        out.append({"months": f"{LONG_IV[i]} {y}", "pair": i, "year": y, "index_estimate": f"{idx:.1f}",
                    "both_months_final": len(how) == 2 and how[0][1] == "final" and how[1][1] == "final"})
    if not out:
        return None
    return {"grid": grid, "noaa_through": K.short_date(now_doc["through"]), "pairs": out[-2:],
            "means": "an estimate from NOAA rain, not RMA's index; RMA's final index can differ"}


def county_facts(meta, cf, st, sd, code, c, fx, name):
    """What page() prints, as it prints it. Without the volatile keys."""
    cy, y0, y1, ny = meta["crop_year"], cf["years"]["first"], cf["years"]["last"], cf["years"]["n"]
    grids = fx["grids"]
    ng = len(grids)
    b = c["b"]
    many = ng > 1
    f = {"county": name, "state": st["name"], "crop_year": cy, "grids": ng, "grid_numbers": grids[:8],
         "middle": f"the middle of the {ng} grids" if many else "the grid",
         "record": {"from": y0, "to": y1, "years": ny},
         "grazing_value_per_acre": money2(b[0]), "hay_value_per_acre": money2(b[4]), "irrigated_hay_value_per_acre": money2(b[1]),
         "pairs": [], "wettest_pair": None, "driest_pair": None, "costs_least": None, "costs_most": None,
         "last_full_year": None, "open_year": None, "grid_rows": []}
    for i, r in enumerate(fx["intervals"]):
        f["pairs"].append({"months": LONG_IV[i],
                           "normal_in": ("%.2f" % r["normal_in"]) if r["normal_in"] is not None else None,
                           "premium_per_100_at_90": money2(r["rate"]["mid"]) if r["rate"] else None,
                           "years_under_90_pct_of_normal": r["below"]["mid"] if r["below"] else None})
        # a pair priced on fewer grids than the county has (Madera: 4 pairs on 3 of 19), as the table row
        # says; only then, so every other county's facts and stored stories are unchanged
        if many and r.get("n") and r["n"] < ng:
            f["pairs"][-1]["grids_priced"] = r["n"]
    mids = [(i, r["rate"]["mid"]) for i, r in enumerate(fx["intervals"]) if r["rate"]]
    cheap = min(mids, key=lambda t: t[1]) if mids else None
    dear = max(mids, key=lambda t: t[1]) if mids else None
    wet = max(((i, r["normal_in"]) for i, r in enumerate(fx["intervals"]) if r["normal_in"] is not None), key=lambda t: t[1], default=None)
    dry = min(((i, r["normal_in"]) for i, r in enumerate(fx["intervals"]) if r["normal_in"] is not None), key=lambda t: t[1], default=None)
    if wet and dry:
        f["wettest_pair"] = {"months": LONG_IV[wet[0]], "normal_in": "%.2f" % wet[1]}
        f["driest_pair"] = {"months": LONG_IV[dry[0]], "normal_in": "%.2f" % dry[1]}
    if cheap and dear and cheap[0] != dear[0]:
        f["costs_least"], f["costs_most"] = LONG_IV[cheap[0]], LONG_IV[dear[0]]
    for x in fx["recent"]:
        cells = {LONG_IV[i]: v["mid"] for i, v in enumerate(x["iv"]) if v}
        if x.get("open"):
            f["open_year"] = {"year": x["year"], "published_so_far": cells}
        elif x["year"] == y1:
            f["last_full_year"] = {"year": x["year"], "pct_of_normal": cells}
    # "every grid had its driest year in 1954": the grid table states it when every row the page prints
    # carries that year and the table lists every grid (build_prf_counties MAX_GRID_ROWS = 30)
    dys = {g["dry_year"] for g in fx["grid_rows"]}
    f["driest_year_every_grid"] = next(iter(dys)) if (len(dys) == 1 and None not in dys and 0 < ng <= 30
                                                      and len(fx["grid_rows"]) == ng) else None
    f["every_grid_driest_pct"] = None
    if f["driest_year_every_grid"] and all(g["dry_pct"] is not None for g in fx["grid_rows"]):
        ps = [g["dry_pct"] for g in fx["grid_rows"]]
        lows = [g["g"] for g in fx["grid_rows"] if g["dry_pct"] == min(ps)]
        f["every_grid_driest_pct"] = {"low": min(ps), "high": max(ps), "low_grid": lows[0] if len(lows) == 1 else None}
    for g in fx["grid_rows"][:8]:
        f["grid_rows"].append({"grid": g["g"], "normal_in_year": ("%.1f" % g["normal_in"]) if g["normal_in"] is not None else None,
                               "driest_year": g["dry_year"], "driest_year_pct": g["dry_pct"],
                               "last_year_pct": g["last_pct"], "years_under_90": g["years_under_90"]})
    return f


def card_grid(fx):
    grids = fx["grids"]
    ex_g = (fx.get("example") or {}).get("grid")
    return ex_g if ex_g in grids else grids[len(grids) // 2]


def _ctx():
    B = _B()
    meta = json.load(open(os.path.join(B.D, "meta.json")))
    cf = B.county_facts()
    where, loaded = B.county_urls(meta)
    return B, meta, cf, where, loaded


def facts_all(now_dir=None, today=None):
    """[(id 'ST:fips', facts)] for every county page, with the volatile keys for
    a bundle built today: as_of is the day the page's data was read."""
    import datetime as dt
    B, meta, cf, where, loaded = _ctx()
    now_dir = now_dir or os.path.join(B.D, "now")
    today = today or dt.date.today().isoformat()
    day = meta["built"][:10]
    out = []
    for st in sorted(meta["states"], key=lambda s: s["name"]):
        sd = loaded[st["st"]]
        try:
            nd = json.load(open(os.path.join(now_dir, st["st"] + ".json")))
        except (OSError, ValueError):
            nd = None
        if nd and (dt.date.fromisoformat(today) - dt.date.fromisoformat(nd.get("through", "1900-01-01"))).days > NOW_MAX_AGE:
            nd = None      # the card itself holds stale numbers back
        for code, c in sorted(sd["counties"].items()):
            fips = sd["fips"] + code
            fx = cf["counties"][fips]
            f = county_facts(meta, cf, st, sd, code, c, fx, where[fips][0])
            rec_open = next((x for x in fx["recent"] if x.get("open")), None)
            f.update(as_of=K.short_date(day), as_of_iso=day, preliminary=preliminary(nd, card_grid(fx), rec_open))
            out.append((f"{st['st']}:{fips}", f))
    return out


def path_of(pid):
    st, fips = pid.split(":")
    return st, fips


# ---------------------------------------------------------------- the validator rules
YEAR_RX = r"\b(?:19|20)\d\d\b"


def spec(f):
    masks, claims, premasks = [], [], []
    for i in range(11):
        tok = f"PAIR{i:02d}"
        mo = LONG_IV[i].split(" to ")
        premasks += [(r"\b" + re.escape(LONG_IV[i]) + r"\b", tok),
                  (r"\b" + mo[0][:3] + r"(?:" + mo[0][3:] + r")?\s*(?:-|to|and)\s*" + mo[1][:3] + r"(?:" + mo[1][3:] + r")?\b", tok)]
    grids = [g["grid"] for g in f["grid_rows"]] + f["grid_numbers"] + ([f["preliminary"]["grid"]] if f.get("preliminary") else [])
    eg = f.get("every_grid_driest_pct")
    if eg and eg.get("low_grid"):
        grids.append(eg["low_grid"])
    for g in sorted(set(grids)):
        masks.append((r"\b" + str(g) + r"\b", f"GRIDg{g}"))
    # "more than any other pair", "the most of any pair", "tied with May to June for the most": checked in extra()
    # against every pair's count; "fell to 39%", "bottomed out at 45%": checked against the number after them
    premasks += [(r"\b(?:more|higher) than any other pair\b|\b(?:the )?most of any pair\b|\bthe most\b(?= in the county| on the record| among)",
                  "PAIRMAX"),
                 (r"\b(?:fewer|lower|less) than any other pair\b|\b(?:the )?(?:fewest|least) of any pair\b", "PAIRMIN"),
                 (r"\btied with (PAIR\d\d) for (?:the )?most\b", r"TIEMAX\1"), (r"\btied with (PAIR\d\d) for (?:the )?fewest\b", r"TIEMIN\1"),
                 (r"\b(?:fell|dropped|slipped|sank|down|bottomed out|fell off)\s+(?:to|at)\b", "LOWTO"),
                 (r"\b(?:rose|climbed|jumped|went up|up|shot up)\s+(?:to|at)\b", "HIGHTO")]
    masks += [(r"\bper \$100\b", "PER100"), (r"\b(?:under|below) 90%(?: of normal)?", "UNDER90"), (r"\b90%(?= coverage| policy| level)", "COV90"),
              (r"\bat 90%", "at COV90")]
    P = lambda i: f"PAIR{i:02d}"  # noqa: E731
    claims.append(K.claim("int", f["grids"], kw=r"\bgrids?\b"))
    claims.append(K.claim("int", f["record"]["years"], kw=r"\byears\b"))
    claims.append(K.claim("money", f["grazing_value_per_acre"], kw=r"graz|pasture|range"))
    claims.append(K.claim("money", f["hay_value_per_acre"], kw=r"\bhay\b"))
    claims.append(K.claim("money", f["irrigated_hay_value_per_acre"], kw=r"irrigated"))
    for i, p in enumerate(f["pairs"]):
        claims.append(K.claim("inch", p["normal_in"], near={"pair": P(i)}, kw=r"normal|rain|precipitation|wet|dry|driest|wettest"))
        claims.append(K.claim("money", p["premium_per_100_at_90"], near={"pair": P(i)}, kw=r"premium|per \$100|cost|rate"))
        if p["years_under_90_pct_of_normal"] is not None:
            claims.append(K.claim("int", p["years_under_90_pct_of_normal"], near={"pair": P(i)}, kw=r"UNDER90|\bpaid\b|\bpays?\b"))
    for key, cells in (("last_full_year", "pct_of_normal"), ("open_year", "published_so_far")):
        x = f.get(key)
        if not x:
            continue
        for mo, v in x[cells].items():
            claims.append(K.claim("pct", v, near={"pair": P(LONG_IV.index(mo)), "year": str(x["year"])}))
    for g in f["grid_rows"]:
        gt = f"GRIDg{g['grid']}"
        claims.append(K.claim("inch", g["normal_in_year"], near={"grid": gt}, kw=r"normal|year|rain|precipitation"))
        if g["driest_year_pct"] is not None:
            claims.append(K.claim("pct", g["driest_year_pct"], near={"grid": gt, "year": str(g["driest_year"])}, kw=r"driest|dry"))
        if g["last_year_pct"] is not None:
            claims.append(K.claim("pct", g["last_year_pct"], near={"grid": gt, "year": str(f["record"]["to"])}))
        if g["years_under_90"] is not None:
            claims.append(K.claim("int", g["years_under_90"], near={"grid": gt}, kw=r"\byears\b"))
    if eg:
        Y = str(f["driest_year_every_grid"])
        for v in {eg["low"], eg["high"]}:
            claims.append(K.claim("pct", v, opt={"year": Y}, kw=r"driest|lowest|bottom"))
        if eg.get("low_grid"):
            claims.append(K.claim("pct", eg["low"], near={"grid": f"GRIDg{eg['low_grid']}"}, kw=r"driest|lowest|bottom"))
    pre = f.get("preliminary")
    if pre:
        for p in pre["pairs"]:
            for kind in ("int", "pct"):
                claims.append(K.claim(kind, p["index_estimate"], near={"pair": P(p["pair"])}, kw=r"prelim|estimate"))
    years = {f["crop_year"], f["record"]["from"], f["record"]["to"]} | {g["driest_year"] for g in f["grid_rows"] if g["driest_year"]}
    for key in ("last_full_year", "open_year"):
        if f.get(key):
            years.add(f[key]["year"])
    if pre:
        years |= {p["year"] for p in pre["pairs"]}
    names = set()
    for x in (f["county"], f["state"]):
        names |= set(re.findall(r"[A-Za-z'’]+", x))
    names |= {"Pasture", "Rangeland", "Forage", "NCEI", "Index", "Non"}
    supers = []
    if f["wettest_pair"]:
        supers.append((r"\bwettest\b", [[P(LONG_IV.index(f["wettest_pair"]["months"]))]]))
        supers.append((r"\bdriest\b", [[P(LONG_IV.index(f["driest_pair"]["months"]))]] +
                       [[f"GRIDg{g['grid']}", str(g["driest_year"])] for g in f["grid_rows"] if g["driest_year"]] +
                       [[str(y), r"GRIDg"] for y in years]))
    else:
        supers.append((r"\bdriest\b", [[f"GRIDg{g['grid']}", str(g["driest_year"])] for g in f["grid_rows"] if g["driest_year"]]))
    if eg and eg.get("low_grid"):
        supers.append((r"\blowest\b", [[f"GRIDg{eg['low_grid']}", r"(?i)\b(?:every|all|each)\b"]]))
    if f.get("driest_year_every_grid"):
        supers = [(rx, alts + [[r"(?i)\b(?:every|all|each)\b", str(f["driest_year_every_grid"])]]) if rx == r"\bdriest\b" else (rx, alts)
                  for rx, alts in supers]
    if f["costs_least"]:
        supers.append((r"\bleast\b", [[P(LONG_IV.index(f["costs_least"])), r"\bcosts?\b"]]))
        supers.append((r"\bmost\b", [[P(LONG_IV.index(f["costs_most"])), r"\bcosts?\b"]]))
    dates = {f["as_of"]} | ({pre["noaa_through"]} if pre else set())
    return {"lead": f["as_of"], "literal": [f["county"], f["state"]], "premasks": premasks, "masks": masks, "claims": claims, "years": years, "dates": dates, "names": names,
            "classes": {"pair": r"PAIR\d\d", "year": YEAR_RX, "grid": r"GRIDg\d+"},
            "banned": BANNED, "unban": ["most", "least", "record"], "supers": supers, "dirs": [], "chars": (120, 650)}


# the PRF rule: neutral, sells nothing, no agent, no lead capture, no return pitch
BANNED = ["agent", "agents", "buy", "buying", "bought", "purchase", "sign", "signup", "enroll", "enrol", "sell", "selling",
          "quote", "quotes", "recommend", "recommended", "advice", "choose", "pick", "picks", "worth", "protect",
          "profit", "profitable", "payback", "return", "returns", "deal", "bargain", "cheap", "cheaper", "save",
          "saves", "savings", "afford", "affordable", "smart", "wise", "consider", "you", "your", "yours", "insure",
          "guarantee", "guaranteed", "safe", "safety", "subsidy", "subsidized", "deadline", "call", "contact", "email",
          "spring", "summer", "fall", "autumn", "winter", "crop", "crops", "hay", "cattle", "grass"]
BANNED.remove("hay")      # hay ground is a fact the page gives (its county value)


def extra(s, m, f):
    bad = []
    # 'under 90%', 'below normal', 'above normal': a claim about an index, so it needs one beside it, the right way
    for st, se in K.sentences(m):
        for cs, cl in K.clauses(se):
            pcts = [(a, float(v)) for a, b, k, v in K.tokens(cl) if k == "pct"]
            for mm in re.finditer(r"UNDER90|\b(above|over|below|under) normal\b", cl, re.I):
                if mm.group(0) == "UNDER90" and re.search(r"\byears?\b|\btimes\b|\bpaid\b|\bpays?\b|\bwhen\b", se):
                    if not pcts:
                        continue
                if mm.group(0) == "UNDER90" and not pcts and re.search(r"(?i)\b(?:every|all|each)\b", se) and re.search(r"(?i)published|so far", se):
                    oy = (f.get("open_year") or {}).get("published_so_far") or {}
                    if not (oy and all(v < 90 for v in oy.values())):
                        bad.append("says every published pair came in under 90% when one did not")
                    continue
                if not pcts:
                    bad.append(f"'{mm.group(0)}' with no index beside it")
                    continue
                a, v = min(pcts, key=lambda t: abs(t[0] - mm.start()))
                w = mm.group(0).lower()
                if (w == "under90" and v >= 90) or (w.startswith(("below", "under")) and v >= 100) or (w.startswith(("above", "over")) and v <= 100):
                    bad.append(f"'{mm.group(0)}' the wrong way for {v:g}%")
    # the most or fewest of any pair: the pair it is said of has that count, and no other pair has it (or the tie is named)
    cnt = {f"PAIR{i:02d}": p["years_under_90_pct_of_normal"] for i, p in enumerate(f["pairs"]) if p["years_under_90_pct_of_normal"] is not None}
    hi, lo = (max(cnt.values()), min(cnt.values())) if cnt else (None, None)
    for st, se in K.sentences(m):
        for mm in re.finditer(r"PAIRMAX|PAIRMIN|TIEMAX(PAIR\d\d)|TIEMIN(PAIR\d\d)", se):
            w = mm.group(0)
            want = hi if "MAX" in w else lo
            pairs_ = re.findall(r"PAIR\d\d", se[:mm.start()])
            if not pairs_:
                pairs_ = re.findall(r"PAIR\d\d", se)
            subj = [p_ for p_ in re.findall(r"PAIR\d\d", se[:mm.start()]) if p_ in cnt]
            if not subj or want is None:
                bad.append(f"'{w}' with no pair of months")
                continue
            two = re.search(r"(PAIR\d\d)\s+and\s+(PAIR\d\d)\b", se[:mm.start()])
            if not w.startswith("TIE") and two:
                if not (cnt.get(two.group(1)) == want == cnt.get(two.group(2)) and sum(1 for v in cnt.values() if v == want) == 2):
                    bad.append("a shared most or fewest that the counts do not show")
                continue
            if w.startswith("TIE"):
                other = mm.group(1) or mm.group(2)
                if not (cnt.get(subj[-1]) == want == cnt.get(other)):
                    bad.append("a tie for the most or fewest that the counts do not show")
            elif cnt[subj[-1]] != want or sum(1 for v in cnt.values() if v == want) > 1:
                bad.append(f"the {'most' if 'MAX' in w else 'fewest'} of any pair is not {subj[-1]} alone")
        for mm in re.finditer(r"LOWTO|HIGHTO", se):
            nxt = [t for t in K.tokens(se[mm.end():]) if t[2] == "pct"]
            prv = [t for t in K.tokens(se[:mm.start()]) if t[2] == "pct"]
            if not nxt:
                bad.append(f"'{mm.group(0)}' with no index after it")
                continue
            v = float(nxt[0][3])
            ref = float(prv[-1][3]) if prv else 100.0
            if (mm.group(0) == "LOWTO" and not v < ref) or (mm.group(0) == "HIGHTO" and not v > ref):
                bad.append(f"'{mm.group(0)}' the wrong way for {v:g}%")
    # a word for how a year went needs every percent in its sentence to agree ('ran dry ... at 37% and 52%'),
    # and 'middle grid' reads as one grid when it is the middle value of several
    for st, se in K.sentences(m):
        ps = [float(t[3]) for t in K.tokens(se) if t[2] == "pct"]
        for mm in re.finditer(r"\b(short|low|dry|wet|rough|tough|poor|strong)\b", se, re.I):
            w = mm.group(1).lower()
            if not ps or (w == "wet" and not all(v > 100 for v in ps)) or (w != "wet" and not all(v < 100 for v in ps)) or w in ("rough", "tough", "poor", "strong"):
                bad.append(f"'{w}' is not borne out by every figure in its sentence")
        if re.search(r"\bmiddle grid\b", se, re.I) and f["grids"] > 1:
            bad.append("'middle grid': the figures are the middle value of the county's grids, not one grid")
        # "the middle of the 19 grids" said of a pair only 3 of them price
        few = [p for p in f.get("pairs") or [] if p.get("grids_priced")]
        if few and re.search(r"\bmiddle of the " + str(f["grids"]) + r"\b", s, re.I) and \
                any(re.search(re.escape(p["months"]), s0_, re.I) for p in few for s0_ in [s]):
            bad.append("the middle of every grid said of a pair fewer grids price")
    pre = f.get("preliminary")
    for st, se in K.sentences(m):
        if pre and any(re.search(r"\b" + re.escape(p["index_estimate"]) + r"\b", se) for p in pre["pairs"]):
            if not re.search(r"\bpreliminary\b", se, re.I):
                bad.append("a preliminary figure not called preliminary")
        if re.search(r"\bprelim|\bestimate", se, re.I) and not pre:
            bad.append("a preliminary figure the facts do not give")
    if re.search(r"\bpaid\b|\bpays?\b|\bpayment", s, re.I) and not re.search(r"UNDER90|COV90", m):
        bad.append("speaks of paying without the 90% rule")
    return bad


SYSTEM = """You write the opening paragraph for one county page on agsist.com, a free farm website run by Sig Lindquist, a Certified Crop Adviser. The page is about PRF (Pasture, Rangeland, Forage), USDA's rainfall index insurance, in one county: its grids, USDA's county values, each pair of months, and the record since 1951. Your paragraph sits under the page's opening lines and tells what this county's record shows, in a few plain sentences.

You get the facts the page already shows, as JSON. Use only those facts. The page prints every number below, and a reader will check your words against it.

Write:
- 2 to 4 sentences, 120 to 600 characters, one paragraph, plain text.
- In Sig's voice: plain farm words, short sentences, a little dry. Not a news story and not a sales pitch.
- Start with "As of {as_of}," naming the day exactly as the facts give it.
- Pick the two or three facts that tell this county's record best: how often a pair of months came in under 90% of normal, what the last full year or this year so far did in a pair of months or two, the wettest and driest pair, a grid's driest year. Do not list them all.
- Name pairs of months as the facts do ("April to May") or short ("Apr-May"), and name the year next to every percent of normal. Each number sits next to the pair of months, grid or year it belongs to.
- The pairs and percents are on "the middle" of the county's grids as the facts say; say so when you give one.
- A figure in preliminary is an estimate: if you use it, the same sentence must say "preliminary" and name its pair of months.
- Numbers exactly as the facts print them, in digits. Percents with a % sign.

Do not:
- sell or advise. No buying, signing up, choosing months or coverage, no agents, no "you" or "your", no talk of what pays back, no "best" or "worth it", no deadlines.
- add anything the facts do not say: no causes, no weather words, no seasons, no crops, no forecast, no rankings beyond the wettest and driest pair, where coverage costs least and most, and a grid's driest year.
- use number words (two, half, most years), em dashes, dashes, semicolons, parentheses, slashes, exclamation marks, questions or quotes.
- sound like a machine: no "notably", "remarkable", no wrap-up line.

Answer with one JSON object in a ```json fenced block and nothing after it:
{"story": "<the paragraph>"}"""

USER = """Facts for {county}, {state} (PRF, crop year {cy}, as of {as_of}):
{facts}"""


def prompt(f):
    shown = {k: v for k, v in f.items() if k != "as_of_iso"}
    if shown.get("preliminary"):
        shown["preliminary"] = dict(shown["preliminary"], pairs=[{k: v for k, v in p.items() if k != "pair"} for p in shown["preliminary"]["pairs"]])
    return USER.format(county=f["county"], state=f["state"], cy=f["crop_year"], as_of=f["as_of"],
                       facts=json.dumps(shown, ensure_ascii=False, separators=(", ", ": ")))


# ---------------------------------------------------------------- the page
def story_html(store, st, fips, f_now, page_day):
    """The <p> for build_prf_counties.page(), or ''."""
    S = sys.modules[__name__]
    s = K.story_for(S, K.lookup(store, S, f"{st}:{fips}"), f_now, page_day)
    return f'<p class="prf-lede prf-story">{_esc(s)}</p>\n    ' if s else ""


def _esc(s):
    import html
    return html.escape(s, quote=False).replace("'", "&rsquo;").replace("’", "&rsquo;")


# ---------------------------------------------------------------- selftest
def selftest():
    import tempfile
    fails = []

    def ok(c, msg):
        if not c:
            fails.append(msg)
            print("FAIL", msg, flush=True)
    S = sys.modules[__name__]
    B, meta, cf, where, loaded = _ctx()
    rows = facts_all(today=meta["built"][:10])
    ok(len(rows) == len(cf["counties"]) == 3070 or len(rows) == len(cf["counties"]), f"one facts row per county ({len(rows)})")
    # facts against the real pages: every figure the facts give is printed on that county's page
    miss = []
    for pid, f in rows:
        st, fips = pid.split(":")
        href = where[fips][1]
        p = os.path.join(K.ROOT, href.lstrip("/") + ".html")
        if not os.path.exists(p):
            miss.append(f"{pid}: no page")
            continue
        h = open(p, encoding="utf-8").read()
        want = [", ".join(str(g) for g in f["grid_numbers"]), f["grazing_value_per_acre"] or "&mdash;", f["middle"]]
        for x in f["pairs"]:
            if x["normal_in"]:
                want.append(f"<td>{x['normal_in']} in</td>")
            if x["premium_per_100_at_90"]:
                want.append(f"<td>{x['premium_per_100_at_90']}")
        if f["wettest_pair"]:
            want.append(f"The wettest pair of months here is {f['wettest_pair']['months']} ({f['wettest_pair']['normal_in']} in")
            want.append(f"the driest is {f['driest_pair']['months']} ({f['driest_pair']['normal_in']} in)")
        if f["costs_least"]:
            want.append(f"Coverage costs least in {f['costs_least']} and most in {f['costs_most']}.")
        for g in f["grid_rows"]:
            want.append(f'<th scope="row">{g["grid"]}</th><td>{g["normal_in_year"]} in</td><td>' +
                        (f'{g["driest_year"]}, {g["driest_year_pct"]}%' if g["driest_year"] else "&mdash;"))
        for key, cells in (("last_full_year", "pct_of_normal"), ("open_year", "published_so_far")):
            x = f.get(key)
            if x:
                for mo, v in x[cells].items():
                    want.append(f">{v}</td>")
        for w in want:
            if w not in h:
                miss.append(f"{pid}: {w!r}")
                break
    ok(not miss, f"facts on the real pages: {miss[:5]} ({len(miss)})")
    # a hand-checked county: Kent County, Delaware
    kent = dict(rows)["DE:10001"]
    ok(kent["grids"] == 8 and kent["pairs"][3]["months"] == "April to May" and kent["pairs"][3]["normal_in"] == "7.06"
       and kent["pairs"][3]["premium_per_100_at_90"] == "$9.86" and kent["pairs"][3]["years_under_90_pct_of_normal"] == 28,
       f"Kent County Apr-May as the page prints it: {kent['pairs'][3]}")
    # the planted-error suite on a fixed copy of those facts
    f = json.loads(json.dumps(kent))
    f.update(as_of="Oct 12", as_of_iso="2026-10-12", preliminary={
        "grid": 23318, "noaa_through": "Oct 13", "pairs": [{"months": "August to September 2026", "pair": 7, "year": 2026,
                                                            "index_estimate": "83.4", "both_months_final": False}], "means": "x"})
    f["last_full_year"] = {"year": 2025, "pct_of_normal": {"April to May": 73, "June to July": 104, "October to November": 62}}
    f["open_year"] = {"year": 2026, "published_so_far": {"April to May": 59, "June to July": 93}}
    yu = {p["months"]: p["years_under_90_pct_of_normal"] for p in f["pairs"]}
    good = ("As of Oct 12, April to May came in under 90% of normal in 28 of 75 years on the middle of the 8 grids in Kent County. "
            "In 2025 Apr-May was at 73% of normal, and in 2026 it was at 59%. "
            "The wettest pair of months here is August to September at 8.13 inches.")
    ok(yu["April to May"] == 28, "fixture: Apr-May 28 years")
    ok(f["wettest_pair"] and f["wettest_pair"]["months"] == "July to August", f"Kent wettest pair {f['wettest_pair']}")
    good = good.replace("August to September at 8.13", "July to August at 8.59")
    r = K.validate(S, good, f)
    ok(r == [], f"a true PRF story passes: {r}")
    planted = {
        "a wrong count": good.replace("in 28 of 75", "in 29 of 75"),
        "a count on the wrong pair": good.replace("April to May came in", "May to June came in"),
        "a percent on the wrong year": good.replace("In 2025 Apr-May was at 73%", "In 2024 that pair was at 73%"),
        "a percent on the wrong pair": good.replace("In 2025 Apr-May was at 73% of normal", "In 2025 June to July was at 73% of normal"),
        "a wrong wettest pair": good.replace("wettest pair of months here is July to August", "wettest pair of months here is May to June"),
        "a sales word": good.replace("The wettest", "Your best buy is the wettest"),
        "an agent": good + " Ask an agent.",
        "a payback pitch": good.replace("The wettest pair of months here is July to August at 8.59 inches.", "Each premium dollar returned 0.87."),
        "advice on months": good.replace("The wettest", "Ranchers should pick the wettest"),
        "under 90 the wrong way": good.replace("In 2025 Apr-May was at 73% of normal", "In 2025 June to July came in under 90% at 104%"),
        "above normal the wrong way": good.replace("In 2025 Apr-May was at 73% of normal", "In 2025 that pair was above normal at 73%"),
        "a grid not in the facts": good.replace("the 8 grids", "the 8 grids, led by grid 99999,"),
        "a year not in the facts": good.replace("In 2025", "In 2019"),
        "no lead day": good.replace("As of Oct 12, ", ""),
        "the wrong lead day": good.replace("As of Oct 12,", "As of Oct 6,"),
        "an em dash": good.replace(". In 2025", " \u2014 in 2025"),
        "a number word": good.replace("in 28 of 75 years", "in 28 of 75 years, more than a third"),
        "a forecast": good + " It will likely pay again.",
        "a season": good.replace("The wettest pair", "In summer the wettest pair"),
        "a cost rank that is not the page's": good + " Coverage costs least in March to April.",
        "a preliminary figure not called that": good + " August to September 2026 sits at 83.4 on grid 23318.",
        "a preliminary figure on the wrong pair": good + " A preliminary estimate puts July to August at 83.4 on grid 23318.",
        "a name": good.replace("Kent County", "Kent County, where Bob Jones ranches"),
    }
    for k, s in planted.items():
        ok(K.validate(S, s, f) != [], f"PRF validator catches {k}: {s}")
    # the 2026-10-18 page-set pass: a pair only some grids price is not "the middle of the 8 grids"
    f3 = json.loads(json.dumps(f))
    f3["pairs"][3]["grids_priced"] = 3
    ok(K.validate(S, good, f3) != [], "PRF validator catches the middle of every grid said of a pair 3 grids price")
    ok(K.validate(S, good, f) == [], "the same story passes when every grid prices the pair")
    ok("grids_priced" not in json.dumps(kent),
       "a county whose grids all price every pair keeps its facts (and its stored story)")
    mad = dict(rows).get("CA:06039")
    ok(mad is not None and [p.get("grids_priced") for p in mad["pairs"]].count(3) == 4, f"Madera: 4 pairs priced on 3 grids {mad and [p.get('grids_priced') for p in mad['pairs']]}")
    # true stories said other ways must pass (the rain set's lesson: 49% rejected until these passed)
    pairs = [
        ("As of Oct 12, on the middle of the 8 grids in Kent County, Apr-May has come in under 90% of normal in 28 of 75 years. "
         "Jun-Jul did it in 33. Coverage costs least in April to May and most in November to December.",
         "As of Oct 12, on the middle of the 8 grids in Kent County, Apr-May has come in under 90% of normal in 28 of 75 years. "
         "Jun-Jul did it in 34. Coverage costs least in April to May and most in November to December."),
        ("As of Oct 12, the middle of the 8 grids in Kent County was at 73% of normal for April to May 2025 and 104% for June to July. "
         "So far in 2026, Apr-May came in at 59% of normal and Jun-Jul at 93%.",
         "As of Oct 12, the middle of the 8 grids in Kent County was at 104% of normal for April to May 2025 and 73% for June to July. "
         "So far in 2026, Apr-May came in at 59% of normal and Jun-Jul at 93%."),
        ("As of Oct 12, grid 22718 had its driest year in 1965, at 70% of normal. It came in under 90% in 21 of 75 years "
         "on the record, and grid 23017 did in 26.",
         "As of Oct 12, grid 22718 had its driest year in 1966, at 70% of normal. It came in under 90% in 21 of 75 years "
         "on the record, and grid 23017 did in 26."),
        ("As of Oct 12, a preliminary estimate from NOAA rain puts August to September 2026 at 83.4 on grid 23318. "
         "In 2025 the middle of the 8 grids was at 62% of normal for Oct-Nov.",
         "As of Oct 12, an estimate from NOAA rain puts August to September 2026 at 83.4 on grid 23318. "
         "In 2025 the middle of the 8 grids was at 62% of normal for Oct-Nov."),
        ("As of Oct 12, the county base value in Kent County is $" + f["grazing_value_per_acre"][1:] + " an acre for grazing. "
         "July to August is the wettest pair of months on the middle of the 8 grids, with 8.59 inches.",
         "As of Oct 12, the county base value in Kent County is $" + f["grazing_value_per_acre"][1:] + " an acre for hay. "
         "July to August is the wettest pair of months on the middle of the 8 grids, with 8.59 inches."),
        ("As of Oct 12, a 90% policy on Apr-May would have paid in 28 of 75 years on the middle of the 8 grids in Kent County. "
         "In 2025, Oct-Nov came in under 90% at 62% of normal.",
         "As of Oct 12, a 90% policy on Apr-May would have paid in 28 of 75 years on the middle of the 8 grids in Kent County. "
         "In 2025, Jun-Jul came in under 90% at 104% of normal."),
    ]
    K.run_pairs(S, f, pairs, ok)
    # false positives from the first PRF batch (Oct 2026, 1,185 of 3,070 rejected): each true story
    # must pass next to the wrong version the rule still catches. A fixed copy of the facts:
    g = json.loads(json.dumps(f))
    counts = [27, 29, 26, 28, 32, 33, 33, 36, 39, 30, 32]
    for i, n in enumerate(counts):
        g["pairs"][i]["years_under_90_pct_of_normal"] = n
    gr = [r["grid"] for r in g["grid_rows"]]
    for k, r in enumerate(g["grid_rows"]):
        r["driest_year"], r["driest_year_pct"] = 1965, 54 + k
    g["driest_year_every_grid"] = 1965
    g["every_grid_driest_pct"] = {"low": 54, "high": 61, "low_grid": gr[0]}
    g["county"] = "St. Clair County"
    g["wettest_pair"] = {"months": "July to August", "normal_in": "8.59"}
    g["driest_pair"] = {"months": "January to February", "normal_in": "5.97"}
    g["open_year"] = {"year": 2026, "published_so_far": {"January to February": 60, "February to March": 49, "March to April": 52}}
    fp = [
        ("As of Oct 12, a preliminary estimate puts August to September 2026 at 83.4 on grid 23318, and RMA's final index can differ. "
         "In 2025 Apr-May was at 73% of normal on the middle of the 8 grids.",
         "As of Oct 12, a preliminary estimate puts August to September 2026 at 83.4 on grid 23318, and Smith's final index can differ. "
         "In 2025 Apr-May was at 73% of normal on the middle of the 8 grids."),
        ("As of Oct 12, on the middle of the 8 grids, September to October came in under 90% of normal in 39 of 75 years, more than any other pair. "
         "In 2025 Apr-May was at 73% of normal.",
         "As of Oct 12, on the middle of the 8 grids, August to September came in under 90% of normal in 36 of 75 years, more than any other pair. "
         "In 2025 Apr-May was at 73% of normal."),
        ("As of Oct 12, the middle of the 8 grids came in under 90% of normal in September to October 39 times in 75 years, the most of any pair. "
         "In 2025 Apr-May was at 73% of normal.",
         "As of Oct 12, the middle of the 8 grids came in under 90% of normal in September to October 38 times in 75 years, the most of any pair. "
         "In 2025 Apr-May was at 73% of normal."),
        ("As of Oct 12, June to July and July to August each came in under 90% of normal in 33 of 75 years on the middle of the 8 grids. "
         "Every grid had its driest year in 1965, with grid " + str(gr[0]) + " at 54%.",
         "As of Oct 12, June to July and July to August each came in under 90% of normal in 33 of 75 years on the middle of the 8 grids. "
         "Every grid had its driest year in 1966, with grid " + str(gr[0]) + " at 54%."),
        ("As of Oct 12, St. Clair County's record on the middle of the 8 grids runs 75 years. "
         "All 8 grids had their driest year in 1965, at 54% to 61% of normal.",
         "As of Oct 12, St. Clair County's record on the middle of the 8 grids runs 75 years. "
         "All 8 grids had their driest year in 1965, at 54% to 62% of normal."),
        ("As of Oct 12, on the middle of the 8 grids, January to February came in under 90% of normal in 27 of 75 years. "
         "It is also the driest pair, at 5.97 inches.",
         "As of Oct 12, on the middle of the 8 grids, February to March came in under 90% of normal in 29 of 75 years. "
         "It is also the driest pair, at 5.97 inches."),
        ("As of Oct 12, on the middle of the 8 grids, January to February came in under 90% in 27 of 75 years, the driest pair at 5.97 inches. "
         "July to August is the wettest at 8.59.",
         "As of Oct 12, on the middle of the 8 grids, January to February came in under 90% in 27 of 75 years, the driest pair at 5.97 inches. "
         "July to August is the wettest at 8.95."),
        ("As of Oct 12, every grid had its driest year in 1965, and grid " + str(gr[0]) + " fell to 54% that year. "
         "On the middle of the 8 grids, Apr-May came in at 73% of normal in 2025.",
         "As of Oct 12, every grid had its driest year in 1965, and grid " + str(gr[0]) + " rose to 54% that year. "
         "On the middle of the 8 grids, Apr-May came in at 73% of normal in 2025."),
        ("As of Oct 12, every grid had its driest year in 1965, with grid " + str(gr[0]) + " lowest at 54%. "
         "On the middle of the 8 grids, Apr-May came in at 73% of normal in 2025.",
         "As of Oct 12, every grid had its driest year in 1965, with grid " + str(gr[1]) + " lowest at 55%. "
         "On the middle of the 8 grids, Apr-May came in at 73% of normal in 2025."),
        ("As of Oct 12, every pair published so far for 2026 came in under 90% of normal on the middle of the 8 grids, with Feb-Mar 2026 at 49%. "
         "In 2025 Apr-May was at 73% of normal.",
         "As of Oct 12, every pair published so far for 2026 came in under 90% of normal on the middle of the 8 grids, with Feb-Mar 2026 at 94%. "
         "In 2025 Apr-May was at 73% of normal."),
        ("As of Oct 12, on the middle of the 8 grids, Oct-Nov came in under 90% in 30 of 75 years. In 2025 that same middle went to 104% "
         "in June to July and fell to 62% in October to November.",
         "As of Oct 12, on the middle of the 8 grids, Oct-Nov came in under 90% in 30 of 75 years. In 2025 that same middle went to 62% "
         "in October to November and fell to 104% in June to July."),
    ]
    fp.append(("As of Oct 12, the 2026 pairs published so far ran low on the middle of the 8 grids, with Jan-Feb 2026 at 60% and Feb-Mar 2026 at 49%. "
               "In 2025 Apr-May was at 73% of normal.",
               "As of Oct 12, the 2026 pairs published so far ran low on the middle of the 8 grids, with Jan-Feb 2026 at 60% and Feb-Mar 2026 at 104%. "
               "In 2025 Apr-May was at 73% of normal.".replace("104%", "104%").replace("Feb-Mar 2026 at 104%", "Mar-Apr 2026 at 52%, and Jun-Jul 2025 at 104%")))
    fp += [
        ("As of Oct 12, over the 75 years from 1951 to 2025, Oct-Nov came in under 90% of normal in 30 years on the middle of the 8 grids. "
         "In 2025 June to July was at 104% of normal, and Oct-Nov 2025 was lower at 62%.",
         "As of Oct 12, over the 75 years from 1951 to 2025, Oct-Nov came in under 90% of normal in 30 years on the middle of the 8 grids. "
         "In 2025 Oct-Nov was at 62% of normal, and June to July 2025 was lower at 104%."),
    ]
    K.run_pairs(S, g, fp, ok)
    ok(K.validate(S, "As of Oct 12, in 2025 that middle grid ran 73% of normal in April to May. That is on the 8 grids in the county.", g) != [],
       "'middle grid' on a county with several grids is caught")
    g2 = json.loads(json.dumps(g))
    g2["pairs"][9]["years_under_90_pct_of_normal"] = 39
    ok(K.validate(S, "As of Oct 12, September to October and October to November came in under 90% of normal in 39 of 75 years, more than any other pair. "
                     "That is on the middle of the 8 grids.", g2) == [], "a two-pair tie for the most passes")
    ok(K.validate(S, "As of Oct 12, September to October came in under 90% of normal in 39 of 75 years, the most of any pair. "
                     "That is on the middle of the 8 grids.", g2) != [], "the most of any pair when another pair ties is caught")
    # the page: a story prints only on a facts match, and drops off when a figure moves
    with tempfile.TemporaryDirectory() as t:
        bd = {"story": [{"set": NAME, "id": "DE:10001", "hash": K.facts_hash(f), "facts": f}]}
        res = {"model": "m", "batch_id": "b", "items": {K.cid_of(S, "DE:10001"): {"result": "succeeded", "stop_reason": "end_turn", "parsed": {"story": good}}}}
        kept, rej = K.collect(S, bd, res, t, made="2026-10-12")
        ok(kept == 1 and not rej, f"collect keeps the good one {rej}")
        j = json.load(open(os.path.join(t, "DE.json")))
        e = j["pages"]["10001"]
        ok(set(e) == {"story", "hash", "vol"} and "grid_rows" not in json.dumps(e), "only the story, its hash and the volatile facts are stored")
        ok(len(json.dumps(e)) < 1200, f"a stored story is small ({len(json.dumps(e))} bytes)")
        store = K.load(S, t)
        now = K.stable(S, f)
        ok(story_html(store, "DE", "10001", now, "2026-10-14") == f'<p class="prf-lede prf-story">{good}</p>\n    ', "a matching story prints")
        ok(story_html(store, "DE", "10001", now, "2026-11-17") == "", "36 days on: no story")
        moved = json.loads(json.dumps(now))
        moved["pairs"][3]["years_under_90_pct_of_normal"] = 29
        ok(story_html(store, "DE", "10001", moved, "2026-10-14") == "", "a figure moved: no story")
        ok(story_html(store, "DE", "10003", now, "2026-10-14") == "", "another county: no story")
        bad_store = {"DE": {"10001": dict(e, story=good.replace("28 of 75", "29 of 75"))}}
        ok(story_html(bad_store, "DE", "10001", now, "2026-10-14") == "", "a stored story that fails the validator never prints")
    # the real build: no store, no change (build --check covers the bytes); with a store, only that page changes
    ok(not os.path.isdir(os.path.join(K.ROOT, STORE)) or K.load(S) is not None, "store readable")
    ok("\u2014" not in SYSTEM and "\u2013" not in SYSTEM, "no em dash in the prompt")
    p = prompt(f)
    ok("as_of_iso" not in p and "83.4" in p and "payback" not in p and '"example"' not in p, "prompt: facts only, no payback, no example")
    print("prf stories selftest:", "ok" if not fails else f"{len(fails)} failure(s)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(selftest())
