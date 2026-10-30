#!/usr/bin/env python3
"""Parent company and destination for each bids board (god's-eye panel build 4, Oct 27 2026).

Writes data/ids/board-parents.json (built by scripts/build_ids.py on every bids run; read by
builds only, never by a page). One entry per live board of the bids repo (dnilgis/bids
data/index.json) that has evidence, keyed by the board id (the row `source`):

  parent  the company that runs the board when the board itself says so. Evidence, never a
          name alone (the Oct 19 fold rule; the skeptic showed a name normalizer merges unrelated
          co-ops). Three rules:
            board-page  the board is read from another company's own cash bid page: the page's
                        host is the website of every other board on it, and those boards all
                        print one name. Real case: ALCIVIA's page (alciviacoop.agricharts.com)
                        lists Landmark Services Cooperative's Burlington WI board.
            change      a completed ownership change (data/ids/ownership-changes.json, dated, from the
                        Oct 27 2026 research) names the parent of the facility the board is. The board keeps
                        its own posted name; chs-brand and board-page win over it.
            chs-brand   CHS Inc. runs its owned units as "CHS <place>", each on its own site
                        (scripts/basis_method.py PARENT_BRANDS, the standing rule).
  dest    the buyer the board's bids deliver to, when the board's own location names a buyer
          from DEST_BRANDS that is itself an operator in the bids directory ("Innovative Ag
          Services, ADM CR"; "Farmers Cooperative Dorchester, {GREEN PLAINS - YORK}"). The board
          is still the co-op's: dest never joins companies. It is for tests that compare buyers
          (a co-op bid delivered to ADM is ADM's bid less freight, not a rival).

Unsure is blank: a board with no evidence has no entry; a board-page whose own boards print two
names gives no parent; an abbreviation nobody can check ("SF Ia Fall") gives no dest.

  python3 scripts/board_parents.py --selftest
"""
import collections
import json
import re
import sys
from urllib.parse import urlparse

import basis_method as BM
from elevator_names import display_name

SCHEMA = "agsist-board-parents/1"
# platform hosts that serve many firms from one URL with no account in it
NO_ACCOUNT = frozenset({"api.bushelpowered.com", "stonehedge.stonex.com", "futures.bushelops.com"})
# platform hosts whose account sits in the path
ACCOUNT_IN_PATH = {"api.dtn.com": r"/sites/([^/?#]+)", "marketplace.graindiscovery.com": r"/public-sites/([^/?#]+)",
                   "cihedging.com": r"/cashbids/(\d+)"}
# (label, pattern, case-sensitive). Acronyms match in capitals only, so "Admin" or "agp" in a
# town never count. A brand counts only when some directory row is run by it (dest_brands()).
DEST_BRANDS = (
    ("ADM", r"\bADM\b", True), ("AGP", r"\bAGP\b", True), ("CGB", r"\bCGB\b|\bconsolidated grain\b", False),
    ("Cargill", r"\bcargill\b", False), ("Bunge", r"\bbunge\b", False), ("Valero", r"\bvalero\b", False),
    ("POET", r"\bpoet\b", False), ("Viserion", r"\bviserion\b", False), ("Marquis", r"\bmarquis\b", False),
    ("Big River", r"\bbig river\b", False), ("Green Plains", r"\bgreen plains\b", False),
    ("Ingredion", r"\bingredion\b", False), ("Gavilon", r"\bgavilon\b", False), ("Scoular", r"\bscoular\b", False),
    ("Louis Dreyfus", r"\bLDC\b|\blouis dreyfus\b", False), ("Didion", r"\bdidion\b", False),
)


def account(url):
    """The board's page account: a host the firm owns, or platform host/account. '' when the
    URL says nothing about who publishes it."""
    p = urlparse(url or "")
    h = (p.hostname or "").lower()
    h = h[4:] if h.startswith("www.") else h
    if not h or h in NO_ACCOUNT or h in BM.SHARED_HOSTS:
        return ""
    if h in ACCOUNT_IN_PATH:
        m = re.search(ACCOUNT_IN_PATH[h], p.path)
        return f"{h}/{m.group(1).lower()}" if m else ""
    return h


def dest_brands(directory):
    """DEST_BRANDS that run at least one row of the bids directory (read or known)."""
    ops = [r.get("operator") or "" for r in directory.get("elevators") or []]
    out = []
    for label, pat, case in DEST_BRANDS:
        rx = re.compile(pat, 0 if case else re.I)
        if any(rx.search(o) for o in ops):
            out.append((label, rx))
    return out


def build(directory, index, today, changes=None):
    eid_of = {r.get("id"): r.get("elevId") for r in directory.get("elevators") or [] if r.get("id")}
    live = [s for s in index.get("sources") or [] if s.get("health") == "live" and s.get("id")]
    boards = {}

    def put(sid, **kw):
        e = boards.setdefault(sid, {"elevId": eid_of.get(sid)})
        e.update(kw)

    # board-page: another company's own page lists this board
    by_acct = collections.defaultdict(list)
    for s in live:
        a = account(s.get("url"))
        if a and "/" not in a:
            by_acct[a].append(s)
    pages = 0
    for a, ss in sorted(by_acct.items()):
        own = [s for s in ss if BM.site_key(s.get("website")) == a]
        names = {BM.name_key(display_name(s.get("operator"))) for s in own}
        if not own or len(names) != 1:
            continue
        owner = display_name(own[0].get("operator"))
        others = [s for s in ss if BM.name_key(display_name(s.get("operator"))) not in names]
        for s in others:
            put(s["id"], parent=owner, pv=f"board-page:{a}")
        pages += bool(others)
    # chs-brand
    for s in live:
        op = (s.get("operator") or "").strip()
        if s["id"] not in boards or "parent" not in boards[s["id"]]:
            if any(pat.search(op) for pat, _b in BM.PARENT_BRANDS):
                put(s["id"], parent="CHS Inc.", pv="chs-brand")
    # ownership-change: a completed change in data/ids/ownership-changes.json names a parent for the facility the
    # board is. Only a parent is added; the board's own posted name is never touched, and chs-brand/board-page win.
    for e in (changes or {}).get("events") or []:
        if e.get("noop") or e.get("kind") != "parent" or not e.get("parent") or (e.get("effective") or "9999") > today:
            continue
        fac = set(e.get("facilities") or [])
        for s in live:
            if eid_of.get(s["id"]) in fac and ("parent" not in boards.get(s["id"], {})) \
                    and BM.name_key(display_name(s.get("operator"))) != BM.name_key(e["parent"]):
                put(s["id"], parent=e["parent"], pv="change:" + e["id"])
    # dest
    brands = dest_brands(directory)
    for s in live:
        loc, op = s.get("location") or "", s.get("operator") or ""
        hit = [label for label, rx in brands if rx.search(loc) and not rx.search(op)]
        if len(hit) == 1:            # two buyers named in one location: unsure, blank
            put(s["id"], dest=hit[0], dv="location")
    c = collections.Counter()
    for e in boards.values():
        c["parent"] += "parent" in e
        c["dest"] += "dest" in e
        if "pv" in e:
            c["by_" + e["pv"].split(":")[0]] += 1
    counts = {"live_boards": len(live), "with_parent": c["parent"], "with_dest": c["dest"],
              "parent_by_rule": {k[3:]: v for k, v in sorted(c.items()) if k.startswith("by_")},
              "dest_by_brand": dict(sorted(collections.Counter(e["dest"] for e in boards.values() if "dest" in e).items())),
              "board_pages_with_other_firms": pages}
    return {"schema": SCHEMA, "generated": today,
            "note": ("Parent company and destination buyer per live bids board (key: the board id, the bid row's "
                     "`source`), from evidence on the board itself, never a name alone. parent: the firm that runs the "
                     "board (pv: board-page:<host> = listed on that firm's own cash bid page; chs-brand = a CHS-branded "
                     "unit; change:<id> = a dated ownership change in data/ids/ownership-changes.json). dest: the buyer the board's location names (dv: location); a co-op's delivered bid, never a "
                     "company join. No entry = no evidence. Rules: scripts/board_parents.py."),
            "counts": counts, "boards": dict(sorted(boards.items()))}


def load(path):
    """{board id: entry} from data/ids/board-parents.json; {} when it cannot be read."""
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f).get("boards") or {}
    except (OSError, ValueError, AttributeError):
        return {}


def selftest():
    fails = []

    def ck(name, ok):
        print(("ok   " if ok else "FAIL ") + name)
        if not ok:
            fails.append(name)

    # REAL BOARDS from dnilgis/bids data/index.json and data/directory.json, 2026-10-27T18:07Z
    directory = {"elevators": [
        {"id": "alciviacoop-burlington", "elevId": "etykedhvfk", "operator": "Landmark Services Cooperative"},
        {"id": "alciviacoop-baldwin", "elevId": "e1", "operator": "ALCIVIA"},
        {"id": "innovativeag-admcr", "elevId": "e2", "operator": "Innovative Ag Services"},
        {"id": "x-adm", "elevId": "e3", "operator": "ADM"},
        {"id": "x-agp", "elevId": "e4", "operator": "AGP"},
        {"id": "x-seaboard", "elevId": "e5", "operator": "Seaboard Foods"},
        {"id": "chsherman-herman", "elevId": "e6", "operator": "CHS Herman"},
        {"id": "farmersco-yorkgp", "elevId": "e7", "operator": "Farmers Cooperative Dorchester"},
        {"id": "x-gp", "elevId": "e8", "operator": "Green Plains Inc."},
        {"id": "qt-a", "elevId": "e9", "operator": "Premier Grain, LLC"},
        {"id": "qt-b", "elevId": "e10", "operator": "Quality Roasting, Inc."},
        {"id": "innovativeag-sfiafall", "elevId": "e11", "operator": "Innovative Ag Services"}]}
    page = "https://alciviacoop.agricharts.com/markets/cashgrid.php"
    index = {"sources": [
        {"id": "alciviacoop-burlington", "operator": "Landmark Services Cooperative", "location": "Burlington",
         "website": "https://www.landmark.coop/", "url": page, "health": "live"},
        {"id": "alciviacoop-baldwin", "operator": "ALCIVIA", "location": "BALDWIN",
         "website": "https://alciviacoop.agricharts.com/", "url": page, "health": "live"},
        {"id": "innovativeag-admcr", "operator": "Innovative Ag Services", "location": "ADM CR",
         "website": "https://innovativeag.agricharts.com/", "url": "https://innovativeag.agricharts.com/x", "health": "live"},
        {"id": "innovativeag-sfiafall", "operator": "Innovative Ag Services", "location": "SF Ia Fall",
         "website": "https://innovativeag.agricharts.com/", "url": "https://innovativeag.agricharts.com/x", "health": "live"},
        {"id": "chsherman-herman", "operator": "CHS Herman", "location": "Herman", "website": "https://chsherman.com/",
         "url": "https://api.bushelpowered.com/api/markets/aggregator/bids/v1/GetBidsList", "health": "live"},
        {"id": "farmersco-yorkgp", "operator": "Farmers Cooperative Dorchester", "location": "{GREEN PLAINS - YORK}",
         "website": "https://farmersco-operative.agricharts.com/", "url": "https://farmersco-operative.agricharts.com/x",
         "health": "live"},
        {"id": "qt-a", "operator": "Premier Grain, LLC", "location": "A", "website": "https://premiergrainllc.com/",
         "url": "https://fj.qtmarketcenter.com/x", "health": "live"},
        {"id": "qt-b", "operator": "Quality Roasting, Inc.", "location": "B", "website": "https://qualityroasting.com/",
         "url": "https://fj.qtmarketcenter.com/x", "health": "live"},
        {"id": "x-dead", "operator": "Landmark Services Cooperative", "location": "Dead", "website": "https://www.landmark.coop/",
         "url": page, "health": "broken"},
        {"id": "x-two", "operator": "Some Coop", "location": "ADM / AGP Sheldon", "website": "", "url": "", "health": "live"}]}
    doc = build(directory, index, "2026-10-27")
    b = doc["boards"]
    ck("Landmark's board on ALCIVIA's own page: parent ALCIVIA by board-page",
       b.get("alciviacoop-burlington", {}).get("parent") == "ALCIVIA"
       and b["alciviacoop-burlington"]["pv"] == "board-page:alciviacoop.agricharts.com"
       and b["alciviacoop-burlington"]["elevId"] == "etykedhvfk")
    ck("the page's own boards get no parent", "alciviacoop-baldwin" not in b)
    ck("a shared platform page with no owner names no parent (QT Market Center)", "qt-a" not in b and "qt-b" not in b)
    ck("a board that is not live is left out", "x-dead" not in b)
    ck("CHS Herman: parent CHS Inc. by chs-brand", b.get("chsherman-herman", {}).get("parent") == "CHS Inc."
       and b["chsherman-herman"]["pv"] == "chs-brand")
    ck("ADM CR: dest ADM, the board stays Innovative Ag's (no parent)",
       b.get("innovativeag-admcr", {}).get("dest") == "ADM" and "parent" not in b["innovativeag-admcr"])
    ck("{GREEN PLAINS - YORK}: dest Green Plains", b.get("farmersco-yorkgp", {}).get("dest") == "Green Plains")
    ck("an abbreviation nobody can check gives no dest", "innovativeag-sfiafall" not in b)
    ck("two buyers in one location: unsure, blank", "x-two" not in b)
    ck("a brand no directory row runs is never a dest", all(lb != "Didion" for lb, _ in dest_brands(directory)))
    ck("counts", doc["counts"]["with_parent"] == 2 and doc["counts"]["with_dest"] == 2
       and doc["counts"]["parent_by_rule"] == {"board-page": 1, "chs-brand": 1})
    # the company count folds on parent; unsure stays apart (as before)
    rows = [{"operator": "ALCIVIA", "site": "https://alciviacoop.agricharts.com/"},
            {"operator": "Landmark Services Cooperative", "site": "https://www.landmark.coop/"}]
    ck("without a parent, ALCIVIA and Landmark count as two", BM.companies_behind(rows) == 2)
    rows[1]["parent"] = b["alciviacoop-burlington"]["parent"]
    ck("with the parent, one company", BM.companies_behind(rows) == 1)
    ck("a dest never joins a co-op to its buyer",
       BM.companies_behind([{"operator": "Innovative Ag Services", "site": "", "dest": "ADM"},
                            {"operator": "ADM", "site": ""}]) == 2)
    print(f"FAILS={len(fails)}")
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    print(__doc__)
