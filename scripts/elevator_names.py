#!/usr/bin/env python3
"""elevator_names.py -- the name a page prints for an elevator and its place.

Some boards hand the reader a page title or a code where the name goes:
"Cash Bid JSI Site - Ag State" was the elevator name on 83 Iowa town pages
(headline, FAQ and structured data) on 2026-10-15, "SF Ia Fall" was a town,
and "Dewar, IA" printed as "Dewar, IA, IA". Nothing here changes a number or
a key; it changes only the words printed. data/elevator-names.json holds the
exact fixes; the general rules below are the twin of components/elev-names.js
and test/elev-names.test.mjs runs the same cases through both.

THE ONE NAME KEY. Every place that cleans or matches an elevator name imports
it from here (Python) or components/elev-names.js (browser):
  display_name   the name a page prints
  basis_name     the basis history key (data/basis, data/basis-sparklines)
  fac_key        one elevator across spellings ("CDR FARMS, LLC" = "CDR Farms LLC")
  merge_key      one board across the two feeds ("Services Inc." = "Service, Inc.")
  name_key       one business for counting companies
  trade_key      one operator inside a town (trade words and the town taken out)
Each starts from display_name, so a source system's archived copy
("zFarmers Cooperative Elevator Co.OLD") keys as the elevator it is.

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
_ARCH_HEAD = re.compile(r"^z(?:OLD)?(?=[A-Z])")
_ARCH_OLD = re.compile(r"\s*\.?\s*\b(?:OLD|Old)$")
_ARCH_GLUED_OLD = re.compile(r"([a-z])OLD$")
_ARCH_YEAR = re.compile(r"([A-Za-z])(?:19|20)\d\d$")
_LEGAL_TAIL = re.compile(r"[\s,._-]*\b(inc|incorporated|llc|l\.l\.c|ltd|lp|co|corp|company)\b\.?[\s,._-]*$", re.I)
_LEGAL_SUFFIX = {"llc", "lc", "inc", "incorporated", "co", "corp", "corporation", "ltd", "limited", "lp", "llp", "company"}
_FOLD = {"bros": "brother", "brothers": "brother", "brother": "brother", "st": "saint", "mt": "mount", "ft": "fort",
         "farmers": "farmer", "assn": "association", "assoc": "association", "elev": "elevator", "elevators": "elevator"}
_FAC_TAIL = {"LLC", "LC", "INC", "INCORPORATED", "CO", "CORP", "CORPORATION", "LTD", "LIMITED", "LP", "LLP",
             "COMPANY", "COOP", "COOPERATIVE", "ASSN", "ASSOCIATION"}
_OP_NOISE = re.compile(r"\b(inc|llc|l\s?l\s?c|co|company|corp|corporation|cooperative|coop|co-op|the|of|grain|"
                       r"elevator|elevators|farmers)\b")
_TOWN_ALT = {"saint": "st", "mount": "mt", "fort": "ft", "sainte": "ste"}
# A firm's full legal name and the short name its boards use: one operator in a town (Wisner NE lists
# "ADM" as a board and "Archer-Daniels-Midland Company" on the roster).
_PARENT_ALIASES = ((re.compile(r"\barcher[\s-]*daniels[\s-]*midland\b"), "adm"),)
_CO_OPERATIVE = re.compile(r"\bco[\s.-]*operative\b")
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
    return archive_clean(s)


def archive_clean(s):
    """A source system's archived copy of a board, as the board: "zShawnee
    Feed Old", "zFarmers ... Co.OLD", "zOLDPettisville Grain Co.",
    "zSargeant Grain CompanyOLD", "zFosston Tri-Coop2017" (a glued year)."""
    s = _ARCH_HEAD.sub("", (s or "").strip())
    s = _ARCH_OLD.sub("", s)
    s = _ARCH_GLUED_OLD.sub(r"\1", s)
    s = _ARCH_YEAR.sub(r"\1", s)
    return s.strip()


def archive_clean_upper(s):
    """The same for a key already in capitals ("ZFARMERS ... CO.OLD"), where
    a leading Z cannot be told from a name's own Z ("ZEELAND"). Returns the
    candidate and whether the name itself says it is archived (a Z head with an
    OLD or glued-year tail). A candidate without that is used only when the
    same elevator already sits under it (build_basis_history, sparklines)."""
    s = (s or "").strip()
    m = re.match(r"^Z(?:OLD)?(?=[A-Z])", s)
    if not m:
        return s, False
    rest = s[m.end():]
    t = re.sub(r"\s*\.?\s*\bOLD$", "", rest)
    sure = t != rest or m.group(0) == "ZOLD"
    y = re.sub(r"([A-Z])(?:19|20)\d\d$", r"\1", t)
    sure = sure or y != t
    if y == rest:   # a glued "OLD" ("COMPANYOLD") is a guess in capitals ("GOLD")
        y = re.sub(r"([A-Z])OLD$", r"\1", rest)
    return y.strip(), sure


def basis_name(op):
    """The basis history key: the printed name in capitals, spaces folded
    (build_basis_history.key_of; cash-bids.js and cb-myelev.js look it up)."""
    return " ".join(display_name(op).upper().split())


def fac_key(s):
    """One elevator across spellings: "CDR FARMS, LLC" and "CDR Farms LLC";
    trailing legal and co-op words off (the town page's history box and the
    home page's basis chart)."""
    t = re.sub(r"\bCO[\s.-]*OPERATIVE\b", "COOPERATIVE", display_name(s).upper().replace("&", " AND "))
    t = re.sub(r"\bCO[\s.-]*OP\b", "COOP", t)
    t = [x for x in re.sub(r"[^A-Z0-9]+", " ", t).strip().split(" ") if x]
    while len(t) > 1 and t[-1] in _FAC_TAIL:
        t.pop()
    return "".join(t)


def merge_key(name):
    """One board as the two feeds spell it: punctuation out, a trailing legal
    suffix dropped, co-op spellings settled, common short forms folded and a
    trailing plural removed from each word ("Badger Grain Supply" = "Badger
    Grain Supply, LLC"; "Services Inc." = "Service, Inc."). Names that differ
    by a real word ("ADM Grain" / "ADM") stay apart."""
    s = re.sub(r"[^a-z0-9]+", " ", display_name(name).lower())
    s = s.replace("co op", "coop").replace("co operative", "cooperative")
    t = [x for x in s.split(" ") if x]
    while t and t[-1] in _LEGAL_SUFFIX:
        t.pop()
    t = ["coop" if x in ("cooperative", "coops") else x for x in t]
    t = [_FOLD.get(x, x) for x in t]
    t = [x[:-1] if (len(x) > 3 and x.endswith("s")) else x for x in t]
    return "".join(t)


def name_key(op):
    """'Farmers Elevator & Exchange, Inc.' and 'Farmers Elevator & Exchange'
    are one name; letters and digits only, legal tails off."""
    s = display_name(op)
    for _ in range(2):
        t = _LEGAL_TAIL.sub("", s).strip()
        s = t or s
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def trade_key(name, town=""):
    """An operator name with the legal and trade words, and the town's own
    name, taken out: "Bartlett Grain Company- St. Joseph" and "Bartlett Grain
    Company, LLC" in Saint Joseph are one operator there."""
    # "Co-operative" and "Co-op" first: the noise word "co" would leave "operative" or "op"
    # ("Cameron Co-operative Elevator Association" is Cameron Cooperative Elevator Association)
    s = _CO_OPERATIVE.sub("cooperative", display_name(name).lower())
    for pat, short in _PARENT_ALIASES:
        s = pat.sub(short, s)
    s = _OP_NOISE.sub(" ", re.sub(r"\bco\s?-?\s?op\b", "coop", s))
    for w in re.findall(r"[a-z0-9]+", (town or "").lower()):
        for v in {w, _TOWN_ALT.get(w, w)}:
            s = re.sub(rf"\b{v}\b", " ", s)
    return re.sub(r"[^a-z0-9]", "", s)


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


def nice_case(s):
    """A name or town sent in capitals ("PINE BLUFFS"), as people write it."""
    s = " ".join(str("" if s is None else s).split())
    if not s or not (s == s.upper() or s == s.lower()) or not re.search(r"[a-z]", s, re.I):
        return s
    s = re.sub(r"(^|[\s\-'(/.])([a-z])", lambda m: m.group(1) + m.group(2).upper(), s.lower())
    return re.sub(r"\b(Llc|Inc|Co-op|Coop)\b", lambda m: {"Llc": "LLC"}.get(m.group(1), m.group(1)), s)


CASES_OP = [("Cash Bid JSI Site - Ag State", "Ag State"), ("JSI Site - Farmers Cooperative", "Farmers Cooperative"),
            ("iframe - Pearl City Elevator, Inc.", "Pearl City Elevator, Inc."),
            ("Current Grain Bids - Fremont Farms", "Fremont Farms"),
            ("American Plains Co-op - Cash Bid Include", "American Plains Co-op"),
            ("Cash Bid JSI Site - Somebody New", "Somebody New"), ("Premier Cooperative - IL", "Premier Cooperative - IL"),
            ("Farmers Coop Elevator - Morganville Coop", "Farmers Coop Elevator - Morganville Coop"),
            ("Heartland Co-op,", "Heartland Co-op"), ("zShawnee Feed Old", "Shawnee Feed"),
            ("zFarmers Cooperative Elevator Co.OLD", "Farmers Cooperative Elevator Co"),
            ("zPCE Producers Coop Elevator", "PCE Producers Coop Elevator"), ("Zeeland Farm Services", "Zeeland Farm Services"),
            ("zFosston Tri-Coop2017", "Fosston Tri-Coop"), ("zOLDPettisville Grain Co.", "Pettisville Grain Co."),
            ("zSargeant Grain CompanyOLD", "Sargeant Grain Company"), ("zHanenkratt Grain Co, Inc. OLD", "Hanenkratt Grain Co, Inc"),
            ("zGanaraska Grain OLD", "Ganaraska Grain"), ("Route 2020", "Route 2020"), ("BOLD Grain", "BOLD Grain"),
            ("", "")]
# (function, input, expected): every key, run through Python and components/elev-names.js
CASES_KEY = [
    ("basis_name", "zFarmers Cooperative Elevator Co.OLD", "FARMERS COOPERATIVE ELEVATOR CO"),
    ("basis_name", "  Badger  Grain Supply, LLC ", "BADGER GRAIN SUPPLY, LLC"),
    ("basis_name", "zFinley Farmers Grain & Elevator", "FINLEY FARMERS GRAIN & ELEVATOR"),
    ("fac_key", "CDR FARMS, LLC", "CDRFARMS"), ("fac_key", "CDR Farms LLC", "CDRFARMS"),
    ("fac_key", "zFarmers Cooperative Elevator Co.OLD", "FARMERSCOOPERATIVEELEVATOR"),
    ("fac_key", "Heartland Co-op", "HEARTLAND"), ("fac_key", "Farmers & Merchants", "FARMERSANDMERCHANTS"),
    ("merge_key", "Badger Grain Supply", "badgergrainsupply"), ("merge_key", "Badger Grain Supply, LLC", "badgergrainsupply"),
    ("merge_key", "Midwest Commodity Services Inc.", "midwestcommodityservice"),
    ("merge_key", "Midwest Commodity Service, Inc.", "midwestcommodityservice"),
    ("merge_key", "ADM Grain", "admgrain"), ("merge_key", "ADM", "adm"),
    ("merge_key", "Centerra Co-op", "centerracoop"), ("merge_key", "St. Ansgar Mills", "saintansgarmill"),
    ("name_key", "Farmers Elevator & Exchange, Inc.", "farmerselevatorexchange"),
    ("name_key", "Farmers Elevator & Exchange", "farmerselevatorexchange"),
    ("name_key", "zFosston Tri-Coop2017", "fosstontricoop"),
    ("trade_key", "Bartlett Grain Company- St. Joseph|Saint Joseph", "bartlett"),
    ("trade_key", "Bartlett Grain Company, LLC|St Joseph", "bartlett"),
    ("trade_key", "Heartland Co-op|", "heartland"), ("trade_key", "Rice Lake Grain|Rice Lake", ""),
    ("trade_key", "Cameron Cooperative Elevator Association|Cameron", "association"),
    ("trade_key", "Cameron Co-operative Elevator Association|Cameron", "association"),
    ("trade_key", "ADM|Wisner", "adm"), ("trade_key", "Archer-Daniels-Midland Company|Wisner", "adm"),
    ("fac_key", "Cameron Co-operative Elevator Association", "CAMERONCOOPERATIVEELEVATOR"),
    ("fac_key", "Cameron Cooperative Elevator Association", "CAMERONCOOPERATIVEELEVATOR"),
]

CASES_KEY += [("nice_case", "PINE BLUFFS", "Pine Bluffs"), ("nice_case", "FARMERS COOP LLC", "Farmers Coop LLC"),
              ("nice_case", "Badger Grain", "Badger Grain"), ("nice_case", "O'NEILL", "O'Neill"), ("nice_case", "  ", "")]


def run_key(fn, a):
    """One CASES_KEY row (trade_key takes "name|town")."""
    if fn == "trade_key":
        n, t = (a.split("|", 1) + [""])[:2]
        return trade_key(n, t)
    return globals()[fn](a)
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
    for fn, a, b in CASES_KEY:
        assert run_key(fn, a) == b, (fn, a, run_key(fn, a), b)
    for a, b in [("ZFARMERS COOPERATIVE ELEVATOR CO.OLD", ("FARMERS COOPERATIVE ELEVATOR CO", True)),
                 ("ZSARGEANT GRAIN COMPANYOLD", ("SARGEANT GRAIN COMPANY", False)), ("ZEELAND GOLD", ("EELAND G", False)),
                 ("ZFOSSTON TRI-COOP2017", ("FOSSTON TRI-COOP", True)),
                 ("ZOLDPETTISVILLE GRAIN CO.", ("PETTISVILLE GRAIN CO.", True)), ("ZHANENKRATT GRAIN CO, INC. OLD", ("HANENKRATT GRAIN CO, INC", True)),
                 ("ZSHAWNEE FEED OLD", ("SHAWNEE FEED", True)), ("ZWEST-CON", ("WEST-CON", False)),
                 ("ZEELAND FARM SERVICES", ("EELAND FARM SERVICES", False)), ("ADM", ("ADM", False))]:
        assert archive_clean_upper(a) == b, (a, archive_clean_upper(a), b)
    print("elevator_names selftest OK")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
