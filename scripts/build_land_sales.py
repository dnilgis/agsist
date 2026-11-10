#!/usr/bin/env python3
"""build_land_sales.py: the farm sale pages and their small data files (Sig, Oct 27, 2026).

"People are nosey; getting those land sales in front of people is a must." This builds, from the
committed county transfer files (data/land/<st>/<fips>.json, scripts/fetch_land_sales.py) and the
one shared market-sale rule (build_land_summary: row_objs, sale_rows, market_sale, stat_ok), with
the month and place logic of the land sale email (land_alert: Land.sales, windows, fresh):

  land-sales/index.html                 the hub: the latest monthly update, every county, the
                                        per-state source table and coverage map
  land-sales/<YYYY-MM>.html             the monthly update (biggest buyers by acres and by dollars,
                                        biggest sales, unusual prices, best value per acre); only the
                                        newest month is written, older ones stay as they were
  land-sales/<state>/<county>.html      "Farmland sales in <County>, <State>": every recorded sale, newest
                                        first; the newest COUNTY_ROWS are in the page, the rest load on
                                        "Show more" (or a type filter) from the county's list file
  sitemap-land-sales.xml
  data/land-sales/latest.json           the newest update in brief (homepage card, rent pages, Daily)
  data/land-sales/lead.json             one real sale per state for the home page's Farmland sales block, by
                                        LEAD_RULE (the highest $/acre inside its county's usual range, last 30 days,
                                        farm counties only; farm_filter counts what that drops)
  data/land-sales/<st>.json             each county's latest few sales with the township point
                                        (Atlas county pages, Fast Facts within 25 miles)
  data/land-sales/<st>/<fips>.json      every recorded sale of the county, any acreage, no names
                                        (the county page's "Show more" and type filter)
  data/land/names/<st>/<fips>.json      buyer and seller for every sale on the county's list
  data/land/names/<YYYY-MM>.json        buyer and seller for the sales and buyers in the update

NAMES (STANDING-DECISIONS, Oct 27): pages show the sale without names plus "Show buyer and seller";
the names load on that tap from a file under /data/land/, which robots.txt blocks; a "Remove my
name" link sits beside them. No name is ever written into a page, a sitemap, a snippet or a data
file outside data/land/ (test/land-sales.test.mjs greps every published file for every name).
A sale whose id is in data/land-sales/removed.json keeps no names at all.

WORDS: "unusual price", with plain possible reasons (family sale, part interest, buildings or timber
included); never "questionable" or any word that accuses anyone.

STATES: Illinois, Wisconsin, Indiana, Vermont and New Jersey (Sig, Oct 27: "Yes turn on Indiana"; it was held to Field Scout
and the comp report since Oct 18), the monthly land sale email included (land_alert.STATES); the email
ask shows beside any state the email covers. Indiana's records differ and the pages say so
(IN_NOTE): the date is the sale date on the disclosure form (no recording date), and the place is the
parcel's postal town, placed at its ZIP's middle, not a township. data/land-sales/coverage.json is the
per-state source table, kept by hand; this script only draws it and counts the states with sales.

EVERY SALE (Sig, Oct 29, 2026: "people are nosey"): a county page lists every recorded market sale of
any acreage, newest first, with its date, acres, price, $/acre and type: farmland, with buildings,
forest or small parcel (build_land_summary.land_type, the one land rule: buildings by property class
only, never deed text; a Wisconsin or Vermont forest-class sale with no farm class is forest; a small parcel is
under 20 known acres). Small parcels, buildings and forest are listed, never mixed into the middle.

HONEST NUMBERS: a section with too few sales is withheld and says why. "Usual", the county page's
headline middle, is the middle half of $/acre over the 24 months ending with the month of bare farm
land sales (market sales of 20+ known acres, $500 an acre or more, no buildings, not forest:
build_land_summary.farm_comp, the same sales the Atlas range uses), n shown, under 5 withheld; a
sale is unusual when it is more than 1.5 middle-halves past either end (the Atlas rule), judged only
for bare farm land with 5 or more such sales. Indiana's middle stays, labeled: most Indiana sales
carry the state's "not valid for trending" mark, and the page counts them. A month is written only
when every state's files were fetched after it ended.

  python3 scripts/build_land_sales.py           write everything
  python3 scripts/build_land_sales.py --check   build to memory, compare with the committed files
  python3 scripts/build_land_sales.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import datetime
import hashlib
import html
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import build_land_summary as BLS   # noqa: E402
import land_alert as LA             # noqa: E402
import source_links as SL           # noqa: E402  no direct links to data sources
import land_names                   # noqa: E402  names apart from the county files (Nov 4, 2026)

ORIGIN = "https://agsist.com"
# Vermont and New Jersey since Oct 29, 2026 (Sig: next land states); Florida since Nov 5 (sale months, not days; its county
# files are on agsist-data, build_land_summary.HOSTED: see CARRY below)
STATES = ("IL", "WI", "IN", "VT", "NJ", "FL")
SLUG = dict(LA.STATE_SLUGS, IN="indiana")
NAME = dict(LA.STATE_NAMES, IN="Indiana")
SOURCES = dict(LA.SOURCES, IN="Indiana Department of Local Government Finance, sales disclosure forms (from STATS Indiana), farm parcels")
# the monthly email covers these; the ask shows only beside them. Florida's ask waits (Nov 5, 2026): its files reach the
# newest months late, so a Florida reader would mostly get no email; the email itself reads Florida (land_alert.STATES)
ASK_HELD = ("FL",)
EMAIL_STATES = tuple(st for st in LA.STATES if st not in ASK_HELD)
IN_NOTE = ("A farm sale is a sale of land the county classes as farm. Left out: gifts, family and related-party sales and anything less "
           "than the whole interest. The date is the sale date on the disclosure form, and the town is the parcel's mailing town, "
           "placed at the middle of its ZIP code.")
# Vermont's return, mapped onto the shared market-sale rule (fetch_land_sales.vt_table, vt_class).
VT_NOTE = ("A farm sale is a return where the land's use before or after the sale is an operating farm or timberland, or open land "
           "enrolled in current use. Left out: a buyer related to the seller, a return that claims a transfer tax exemption, transfers "
           "without pay, by divorce or by foreclosure, and part interests such as a share, a life estate, a lease or an easement.")
# New Jersey's deeds, mapped onto the same rule (fetch_land_sales.nj_table, NJ_NU): the method note on every New Jersey
# page and in any month with a New Jersey sale. The acres are today's lot, said here and on every page.
NJ_NOTE = LA.NJ_NOTE
FL_NOTE = LA.FL_NOTE      # Florida's method note, on every Florida page and in any month with a Florida sale
LIST_MIN_ACRES = LA.LIST_MIN_ACRES      # 10: a listed sale
COMP_MIN_ACRES = BLS.MIN_ACRES          # 20: a sale that sets or is judged against the usual price
MIN_COMPS = BLS.MIN_N                   # 5 comparable sales before anything is called unusual
COUNTY_ROWS = 50                        # rows in a county page; the rest load from its list file on "Show more"
FEATURED = 6                            # rows per county in data/land-sales/<st>.json
TOP = 10                                # rows in a monthly table
TOP_BUYERS = 8
TOP_SALES = 6
MIN_LISTED = 3                          # biggest sales withheld under this many listed sales
MIN_BUYERS = 5                          # buyers withheld under this many distinct buyers
MIN_JUDGED = 10                         # unusual and best value withheld under this many judged sales
BEST_MIN_ACRES = 40
CSS = '<link rel="stylesheet" href="/components/land-sales.css?v=4">'
JS = '<script src="/components/land-sales.js?v=6" defer></script>'
KIND_WORDS = {"farm": "farmland", "bldg": "with buildings", "forest": "forest", "small": "small parcel"}
KIND_CODE = {"farm": "f", "bldg": "b", "forest": "w", "small": "s"}   # the list file's type column
LIST_COLS = ["id", "when", "recorded", "acres", "price", "ppa", "place", "kind", "flag"]
# The detail panel (Sig, Nov 4, 2026: "when you click I want it to open every detail about the sale that is pertinent").
# Each listed sale carries three more facts, no name in any: ri, the sale's first deed as a row number in the county's
# transfer file (data/land/<st>/<fips>.json, robots-blocked, the file Field Scout already loads; the panel reads the
# deed type, document, parcel, legal, section and the rest from it on the first tap, and checks the row against the
# sale id before it trusts it); g, how many deeds were counted as this one sale (deeds of one parcel within 31 days);
# m, whether the sale counts toward the county's middle price and, when not, why (MID_WHY). DETAIL_COLS is the order
# of a page row's data-ls attribute (components/land-sales.js DCOLS, the same list).
DETAIL_COLS = ["ri", "g", "m"]
ROW_COLS = ["id", "when", "recorded", "acres", "price", "ppa", "place", "kind", "flag", "cu"] + DETAIL_COLS   # then lx, only when there is one
MID_WHY = {"y": "counts toward the middle", "b": "with buildings", "w": "forest", "a": "acres not stated", "s": "under %d acres",
           "p": "under $%d an acre", "o": "outside the 24 months"}
NVT = "not valid for trending"          # Indiana's sales disclosure mark, carried in the deed-type text
REMOVE_TO = "sig@agsist.com"            # the site's own contact address (contact.html)

UP_WHY = "a house or buildings, timber or hunting ground, a building site or development land, or a neighbor paying more for the piece next door"
DOWN_WHY = "a family or neighbor sale, a part interest, wooded, wet or poorer ground, no road access, or a land contract"


def and_list(xs):
    xs = list(xs)
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1] if xs else ""


def e(s):
    return html.escape("" if s is None else str(s), quote=True)


def money(x):
    return "$" + format(int(BLS.js_round(x)), ",")


def acres(a):
    """Acres as the email writes them, with a thousands comma ("2,280")."""
    t = LA.acres_text(a)
    w, _, f = t.partition(".")
    return format(int(w), ",") + ("." + f if f else "")


def day(iso):
    return LA.long_day(iso)


def when_text(p, year=True):
    """A published row's date: "Aug 5, 2025" (or "Aug 5"), or the month alone, "Aug 2025", for a sale-month row (Florida)."""
    if p.get("basis") == "sale month":
        return LA.month_text(p["when"])
    return LA.short_day(p["when"]) + (", " + p["when"][:4] if year else "")


county_slug = LA.county_slug    # one copy: the land sale email links each sale to land-sales/<state>/<county_slug>#s-<sale_id>
sale_id = LA.sale_id            # opaque and stable: the state, county, document, deed date and price of the first deed


def buyer_key(name):
    return re.sub(r"[^A-Z0-9]+", " ", BLS.up(name)).strip()


def buyer_id(month, key):
    return "b" + hashlib.sha1((month + "|" + key).encode("utf-8")).hexdigest()[:9]


def clean_name(v):
    s = BLS.clean(v)
    return s[:120] if s else ""


def stats(v):
    return BLS.stats(v)


def usual(rows, w24, skip_id=None):
    """The county's usual $/acre: the middle half of comparable sales in the 24-month window."""
    comp = [r for r in rows if BLS.inw(r, w24) and BLS.farm_comp(r) and r.get("_id") != skip_id]
    s = stats([r["ppa"] for r in comp])
    if not s or s["n"] < MIN_COMPS:
        return None
    s["nvt"] = sum(1 for r in comp if NVT in str(r.get("conv") or "").lower())
    iqr = s["q3"] - s["q1"]
    s["lo"], s["hi"] = BLS.js_round(s["q1"] - 1.5 * iqr), BLS.js_round(s["q3"] + 1.5 * iqr)
    return s


def judge(r, u):
    """+1 above the usual range, -1 below, 0 inside, None when it cannot be judged."""
    if not u or not BLS.farm_comp(r):
        return None
    if r["ppa"] > u["hi"]:
        return 1
    if r["ppa"] < u["lo"]:
        return -1
    return 0


def with_bldg(r):
    """Buildings by property class only (the one land rule; FSLand.hasBuildings), never the deed text."""
    return BLS.has_buildings(r.get("cls"))


# ---------------------------------------------------------------- read the county files


class Data:
    def __init__(self, repo=REPO, states=STATES):
        self.repo = Path(repo)
        self.land = LA.Land(repo, states)
        self.states = [st for st in states if self.land.index(st)]
        self.removed = set()
        try:
            self.removed = set(json.load(open(self.repo / "data" / "land-sales" / "removed.json", encoding="utf-8")).get("sales") or [])
        except (OSError, ValueError):
            pass
        self.fetched = {st: str(self.land.index(st).get("fetched_utc") or "")[:10] for st in self.states}
        self.today = {st: self.fetched[st] for st in self.states}
        self.counties = {}      # st -> [(index row, rows)]
        # a state whose files name no one ("names": false: Florida, New Jersey) gets no names file, no names path and no
        # "Show buyer and seller" button (checker, Nov 5, 2026: a dead button; New Jersey's 6,975 taps all read "no names", Nov 6)
        self.named = {}
        for st in self.states:
            c0 = (self.land.index(st).get("counties") or [None])[0]
            self.named[st] = not (c0 and (self.land.file(st, c0["fips"]) or {}).get("names") is False)
        for st in self.states:
            lst = []
            for c in self.land.index(st).get("counties") or []:
                rows = self.land.sales(st, c["fips"], self.today[st])
                at = file_rows(self.land.file(st, c["fips"]))
                for r in rows:
                    r["_id"] = sale_id(st, r)
                    r["_ri"] = at.get(row_key(r))
                lst.append((c, rows))
            self.counties[st] = lst

    def names(self, r):
        if r["_id"] in self.removed:
            return 0
        return [clean_name(r.get("grantor")), clean_name(r.get("grantee"))]

    def summary(self, st):
        try:
            return json.load(open(self.repo / "data" / "land" / st.lower() / "summary.json", encoding="utf-8"))
        except (OSError, ValueError):
            pass
        # no Atlas summary for this state (Indiana): the same numbers by the same rule, in memory only
        files = [f for f in (self.land.file(st, c["fips"]) for c in self.land.index(st).get("counties") or []) if f]
        return BLS.build_state(st, files) if files else None


def row_key(r):
    """What finds a sale's first deed in its county file: document, deed date and parcel (a merged sale keeps its first deed's)."""
    return (str(r.get("doc") or ""), str(r.get("date") or "")[:10], str(r.get("pid") or ""))


def file_rows(f):
    """{row_key: row number} of a county transfer file, the first row of each key."""
    out = {}
    if not f or not f.get("cols"):
        return out
    cols = f["cols"]
    for i, a in enumerate(f.get("rows") or []):
        out.setdefault(row_key(dict(zip(cols, a))), i)
    return out


def legal_mask(r):
    """[[start, length], ...] of the sale's own buyer or seller names inside its legal description, so the panel can
    blank them without ever reading a name (about 55 of 78,000 listed sales, Nov 4, 2026). Empty for the rest."""
    leg = str(r.get("legal") or "").upper()
    out = []
    for v in (r.get("grantor"), r.get("grantee")):
        for n in str(v or "").upper().split(";"):
            n = n.strip()
            if len(n) < 5:
                continue
            i = leg.find(n)
            while i >= 0:
                out.append([i, len(n)])
                i = leg.find(n, i + len(n))
    out.sort()
    merged = []
    for a, ln in out:
        if merged and a < merged[-1][0] + merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], a + ln - merged[-1][0])
        else:
            merged.append([a, ln])
    return merged


def mid_code(r, st, w24=None):
    """Whether a listed sale counts toward its county's middle (y) and, when not, why: b with buildings, w forest,
    a acres not stated, s under 20 acres, p under $500 an acre, o outside the 24 months. The same tests, in the
    same order, as build_land_summary.farm_comp and usual()."""
    k = BLS.land_type(r, st)
    if k == "bldg":
        return "b"
    if k == "forest":
        return "w"
    if BLS.num(r.get("acres")) is None:
        return "a"
    if k == "small":
        return "s"
    if not BLS.stat_ok(r):
        return "p"
    if w24 and not BLS.inw(r, w24):
        return "o"
    return "y"


def latest_month(d):
    """(year, m0) of the newest month every state was fetched after."""
    f = min(d.fetched.values())
    dt = datetime.date.fromisoformat(f)
    first = dt.replace(day=1) - datetime.timedelta(days=1)
    return first.year, first.month - 1


def shown_day(r):
    """The day a page shows: the recorded (filed) day when the state file carries it, else the deed date."""
    return r["when"] or str(r.get("date") or "")[:10] or None


def pub_row(st, r, county, u=None, w24=None):
    """The only shape a sale is published in: no names, parcel, legal or document (ri points at the deed's row in
    the robots-blocked county file; the panel reads those there)."""
    a = BLS.num(r.get("acres"))
    rec = bool(r["has_rec"] and r["when"])
    return {"id": r["_id"], "st": st, "fips": r.get("fips"), "county": county, "place": r.get("muniName") or None,
            "when": shown_day(r), "basis": "recorded" if rec else "sale month" if r.get("dm") else "sale date",
            "acres": round(a, 2) if a is not None else None, "price": BLS.js_round(BLS.num(r.get("price")) or 0),
            "ppa": r.get("ppa"), "pt": [round(r["pt"][0], 4), round(r["pt"][1], 4)] if r.get("pt") else None,
            "bldg": with_bldg(r), "kind": BLS.land_type(r, st), "flag": judge(r, u),
            "cu": st == "VT" and "ENROLLED IN CURRENT USE" in str(r.get("conv") or "").upper(),
            "ri": r.get("_ri"), "g": int(r.get("grp") or 1), "m": mid_code(r, st, w24),
            # "h": the legal names its own seller or buyer and sits in the names file, shown only on the tap (land_names)
            "lx": "h" if land_names.is_marked(r.get("legal")) else legal_mask(r)}


# ---------------------------------------------------------------- the monthly update
def month_build(d, year, m0):
    first, last = LA.month_bounds(year, m0)
    key = "%04d-%02d" % (year, m0 + 1)
    W = LA.windows(year, m0)
    listed, buyers, judged, names_s, names_b, legals_s = [], {}, [], {}, {}, {}
    per_state = {st: {"n": 0, "basis": None, "fresh": True} for st in d.states}
    later = {}
    for st in d.states:
        # a month-date state (Florida) is in a month only once its files hold a later month: the newest month on file may
        # still be filling in, and there is no day to read a month's last week by (land_alert.ready)
        if any((d.land.file(st, c["fips"]) or {}).get("dates") == "month" for c, rows in d.counties[st][:1]):
            to = max((str(c.get("to") or "")[:10] for c, rows in d.counties[st]), default="")
            if not to > last:
                later[st] = to
                continue
    for st in [x for x in d.states if x not in later]:
        for c, rows in d.counties[st]:
            f = d.land.file(st, c["fips"])
            if not LA.fresh(f, last):
                per_state[st]["fresh"] = False
            for r in rows:
                if not (r["when"] and first <= r["when"] <= last):
                    continue
                a = BLS.num(r.get("acres")) or 0
                if a < LIST_MIN_ACRES:
                    continue
                u = usual(rows, W["w24"], skip_id=r["_id"])
                p = pub_row(st, r, c["name"], u, W["w24"])
                p["usual"] = {"med": u["med"], "q1": u["q1"], "q3": u["q3"], "n": u["n"]} if u else None
                listed.append(p)
                per_state[st]["n"] += 1
                per_state[st]["basis"] = p["basis"]
                nm = d.names(r)
                names_s[p["id"]] = nm
                if p["lx"] == "h" and nm != 0 and r.get("legal_named"):
                    legals_s[p["id"]] = r["legal_named"]
                if p["flag"] is not None:
                    judged.append(p)
                bk = buyer_key(r.get("grantee"))
                if bk and nm != 0:
                    b = buyers.setdefault((st, bk), {"st": st, "acres": 0.0, "price": 0, "n": 0, "counties": set(), "name": clean_name(r.get("grantee"))})
                    b["acres"] += a
                    b["price"] += p["price"]
                    b["n"] += 1
                    b["counties"].add(c["name"])
    listed.sort(key=lambda p: (-p["price"], p["when"], p["id"]))
    by_acres = sorted(listed, key=lambda p: (-(p["acres"] or 0), p["when"], p["id"]))
    for st in later:
        per_state.pop(st, None)
    out = {"month": key, "label": "%s %d" % (LA.MONTHS[m0], year), "states": [st for st in d.states if st not in later],
           "later": later, "fetched": d.fetched, "window": W["w24"], "per_state": per_state, "n": len(listed)}
    out["fresh"] = all(v["fresh"] for v in per_state.values())
    out["biggest"] = listed[:TOP_SALES] if len(listed) >= MIN_LISTED else None
    out["biggest_acres"] = by_acres[:TOP_SALES] if len(listed) >= MIN_LISTED else None
    out["biggest_acres_all"] = by_acres
    out["biggest_why"] = None if out["biggest"] else "only %d sales of %d acres or more recorded" % (len(listed), LIST_MIN_ACRES)
    bl = []
    for (st, bk), b in buyers.items():
        bid = buyer_id(key, st + "|" + bk)
        names_b[bid] = b["name"]
        bl.append({"id": bid, "st": st, "acres": round(b["acres"], 1), "price": b["price"], "n": b["n"], "counties": sorted(b["counties"])})
    if len(bl) >= MIN_BUYERS:
        out["buyers_acres"] = sorted(bl, key=lambda b: (-b["acres"], -b["price"], b["id"]))[:TOP_BUYERS]
        out["buyers_dollars"] = sorted(bl, key=lambda b: (-b["price"], -b["acres"], b["id"]))[:TOP_BUYERS]
        out["buyers_why"] = None
    else:
        out["buyers_acres"] = out["buyers_dollars"] = None
        out["buyers_why"] = "only %d buyers named on the month's sales" % len(bl)
    out["n_buyers"] = len(bl)
    out["n_judged"] = len(judged)
    if len(judged) >= MIN_JUDGED:
        far = [p for p in judged if p["flag"]]

        def dist(p):
            u = p["usual"]
            iqr = (u["q3"] - u["q1"]) or 1
            return (p["ppa"] - u["q3"]) / iqr if p["flag"] > 0 else (u["q1"] - p["ppa"]) / iqr
        far.sort(key=lambda p: (-dist(p), p["id"]))
        out["unusual"] = far[:TOP]
        out["n_unusual"] = len(far)
        # close to the usual: not past the far-off test, and no more than half a middle-half under the
        # county's lower quarter (where the middle half is wide the far-off test alone lets in woods and wetland)
        inside = [p for p in judged if p["flag"] == 0 and (p["acres"] or 0) >= BEST_MIN_ACRES
                  and p["ppa"] >= p["usual"]["q1"] - 0.5 * (p["usual"]["q3"] - p["usual"]["q1"])]
        inside.sort(key=lambda p: (p["ppa"] / p["usual"]["med"], p["id"]))
        out["best"] = inside[:5] if len(inside) >= 3 else None
        out["best_why"] = None if out["best"] else "only %d sales of %d acres or more inside their county's usual range" % (len(inside), BEST_MIN_ACRES)
        out["unusual_why"] = None
    else:
        out["unusual"] = out["best"] = None
        out["n_unusual"] = 0
        out["unusual_why"] = out["best_why"] = ("only %d sales of %d acres or more could be set against a county's usual price "
                                                "(a county needs %d comparable sales in 24 months); this needs %d"
                                                % (len(judged), COMP_MIN_ACRES, MIN_COMPS, MIN_JUDGED))
    out["stand"] = stand_out(listed, by_acres)
    used = {p["id"] for k in ("biggest", "biggest_acres", "unusual", "best") for p in (out.get(k) or [])}
    names = {"month": key, "sales": {i: names_s[i] for i in sorted(used)},
             "buyers": {b["id"]: names_b[b["id"]] for k in ("buyers_acres", "buyers_dollars") for b in (out.get(k) or [])}}
    if any(i in legals_s for i in used):
        names["legals"] = {i: legals_s[i] for i in sorted(used) if i in legals_s}
    return out, names


# ---------------------------------------------------------------- the hub's stand-out sales (Sig, Nov 8)
# "The map and any stand-out sales top and center." Up to four cards, each a different sale of the latest month: the
# largest by acres; the highest and the lowest price per acre against the county's usual (bare farmland of
# BEST_MIN_ACRES or more in a county with a usual, the same "usual" the month page uses); the newest. A card that has no
# honest candidate is not drawn. A sale is never on two cards. No names; the link is the county page row.
STAND_COLS = ("id", "st", "county", "place", "when", "basis", "acres", "price", "ppa")


def stand_out(listed, by_acres):
    used = set()
    cards = []

    def add(kind, p):
        if p is None or p["id"] in used:
            return
        used.add(p["id"])
        c = {k: p[k] for k in STAND_COLS}
        c["kind"] = kind
        u = p.get("usual")
        c["med"] = u["med"] if u else None
        c["flag"] = p.get("flag") or 0
        cards.append(c)

    if by_acres and (by_acres[0]["acres"] or 0) > 0:
        add("acres", by_acres[0])
    judged = [p for p in listed if p.get("usual") and p["usual"]["med"] and p["kind"] == "farm" and (p["acres"] or 0) >= BEST_MIN_ACRES and p["ppa"]
              and p.get("flag") == 0]     # inside the county's usual range: the far-off prices (family sales, buildings, timber) are on the month page
    ratio = lambda p: p["ppa"] / p["usual"]["med"]
    mid = {}
    for st in {p["st"] for p in judged}:
        v = sorted(p["ppa"] for p in judged if p["st"] == st)
        mid[st] = v[len(v) // 2]
    # town and development ground (a price over LEAD_FARM_X times the state's middle) is not a farm stand-out
    hi = sorted((p for p in judged if ratio(p) > 1 and p["id"] not in used and p["ppa"] <= LEAD_FARM_X * mid[p["st"]]), key=lambda p: (-ratio(p), p["id"]))
    lo = sorted((p for p in judged if ratio(p) < 1 and p["id"] not in used), key=lambda p: (ratio(p), p["id"]))
    add("high", hi[0] if hi else None)
    add("low", next((p for p in lo if p["id"] not in used), None))
    new = sorted((p for p in listed if p["when"] and p["id"] not in used), key=lambda p: (p["when"], p["price"], p["id"]), reverse=True)
    add("new", new[0] if new else None)
    return cards


# ---------------------------------------------------------------- the home page's one sale
# Sig, Nov 4, 2026: "my buddy didn't know that farm land sales were on agsist"; "maybe we can link it somehow with
# the unusual sales or something to get people's attention". The home page leads with one real sale per state,
# picked by this rule (LEAD_RULE is printed under the sale on tap, word for word):
#   bare farmland of 40 acres or more (the market-sale rule's comparable sales: known acres, $500 an acre or more, no buildings,
#   not forest), recorded (or, in Indiana, sold) in the LEAD_DAYS days ending with the state's newest such sale
#   on file, in a county with MIN_COMPS or more comparable sales over 24 months, and inside that county's usual
#   range (a sale far outside it is "unusual" and may not be a market price: family sale, buildings, timber).
#   Of those, the highest $/acre, set against the county's 24-month middle. No name, ever: county, acres, $/acre
#   and the date only. Fewer than LEAD_MIN_SALES such sales in the window: the state has no lead (withheld).
#   Farm counties only (lead's call, Nov 4, after the first samples were edge-of-town ground: Marion IN $48,285,
#   Will IL $24,125): a county whose 24-month middle is more than LEAD_FARM_X times the state's middle by the same
#   rule (every comparable sale in the state over the same 24 months) is skipped, and so is a sale itself priced
#   over LEAD_FARM_X times the state's middle (lead's call, Nov 4: Will IL passed the county test at 1.4x but the
#   sale was 2.3x); lead.json counts what each drops.
LEAD_DAYS = 30
LEAD_MIN_SALES = 3
LEAD_MIN_ACRES = BEST_MIN_ACRES          # 40: a field, not a building lot at the edge of town
LEAD_FARM_X = 2                          # a county middle over twice the state's: town and development ground
LEAD_RULE = ("The highest price per acre among bare farmland sales of %d acres or more (no buildings, not forest) %%s in %%s "
             "in the %d days to %%s, the newest on file. Only farm ground counts: the county needs at least %d bare farmland "
             "sales of %d acres or more over 24 months to compare with, a county whose middle price is more than twice the "
             "state's (%%s an acre) is left out as town or development ground, and so is any sale priced at more than twice "
             "the state's middle. Sales far outside their county's usual range are left out too; they are on the monthly page. "
             "Fewer than %d such sales: no sale shown."
             % (LEAD_MIN_ACRES, LEAD_DAYS, MIN_COMPS, COMP_MIN_ACRES, LEAD_MIN_SALES))


def lead_pick(st, cands, state_med=None):
    """The home lead for one state from [(pub row, usual, county slug)] of its market sales (any county), or None.
    state_med: the state's middle $/acre by the same rule; counties over LEAD_FARM_X times it are skipped.
    Returns (lead or None, {"counties": n, "sales": n} dropped by the farm-county filter in the window)."""
    drop = {"counties": 0, "sales": 0}
    farm = [(p, u, cs) for p, u, cs in cands if p.get("kind") == "farm" and p.get("ppa") and p.get("when")]
    if any(p.get("basis") == "sale month" for p, u, cs in farm):
        return None, drop     # sale months (Florida): no 30 days to count back by, and its newest months arrive late
    if not farm:
        return None, drop
    end = max(p["when"] for p, u, cs in farm)
    start = (datetime.date.fromisoformat(end) - datetime.timedelta(days=LEAD_DAYS - 1)).isoformat()
    ok = [(p, u, cs) for p, u, cs in farm
          if start <= p["when"] <= end and u and u["n"] >= MIN_COMPS and p.get("flag") == 0 and (p["acres"] or 0) >= LEAD_MIN_ACRES]
    if not state_med:
        return None, drop               # no state middle: the farm-county test cannot be made, so no lead
    if state_med:
        far = [x for x in ok if x[1]["med"] > LEAD_FARM_X * state_med]
        drop = {"counties": len({x[2] for x in far}), "sales": len(far)}
        ok = [x for x in ok if x[1]["med"] <= LEAD_FARM_X * state_med]
        # and the sale itself: over LEAD_FARM_X times the state's middle is town or development ground too
        hot = [x for x in ok if x[0]["ppa"] > LEAD_FARM_X * state_med]
        drop["over_cap"] = len(hot)
        ok = [x for x in ok if x[0]["ppa"] <= LEAD_FARM_X * state_med]
    if len(ok) < LEAD_MIN_SALES:
        return None, drop
    p, u, cs = sorted(ok, key=lambda x: (-x[0]["ppa"], x[0]["when"], x[0]["id"]))[0]
    return {"st": st, "id": p["id"], "county": p["county"], "acres": p["acres"], "ppa": p["ppa"], "when": p["when"],
            "basis": p["basis"], "med": u["med"], "n24": u["n"], "pct": BLS.js_round((p["ppa"] / u["med"] - 1) * 100) if u["med"] else None,
            "of": len(ok), "window": [start, end], "url": "/land-sales/%s/%s#s-%s" % (SLUG[st], cs, p["id"]),
            "rule": LEAD_RULE % ("sold" if p["basis"] in ("sale date", "sale month") else "recorded", NAME[st], LA.month_text(end) if p["basis"] == "sale month" else LA.short_day(end) + ", " + end[:4], money(state_med)),
            "src": SOURCES[st].split(",")[0]}, drop      # the credit beside the figure, in plain text (Oct 29: no link)


# ---------------------------------------------------------------- per county
def county_build(d, st, c, rows, through):
    """(featured rows, every listed row, names, usual, n12) for one county. Every market sale of any
    acreage is listed, newest first; the page carries the first COUNTY_ROWS and the list file all."""
    W = BLS.windows(datetime.date.fromisoformat(through))
    u = usual(rows, W["w24"])
    lst = [r for r in rows if shown_day(r) and shown_day(r) <= d.today[st]]
    # newest first by the date the page shows (recorded, else the deed date)
    lst.sort(key=lambda r: (shown_day(r), r["_id"]), reverse=True)
    allp = [pub_row(st, r, c["name"], u, W["w24"]) for r in lst]
    w12 = W["cur"]
    names = {p["id"]: d.names(r) for p, r in zip(allp, lst)}
    # a legal that names its own seller or buyer: in the names file, loaded only on the tap (removed names: none)
    legals = {p["id"]: r["legal_named"] for p, r in zip(allp, lst) if p["lx"] == "h" and names[p["id"]] != 0 and r.get("legal_named")}
    names = (names, legals)
    big = [p for p in allp if (p["acres"] or 0) >= LIST_MIN_ACRES]
    feat = [p for p in big if p["when"] >= w12[0]][:FEATURED]
    n12 = len([r for r in rows if BLS.inw({"date": shown_day(r)}, w12) and (BLS.num(r.get("acres")) or 0) >= LIST_MIN_ACRES])
    n12all = len([p for p in allp if w12[0] <= p["when"] <= w12[1]])
    k24 = u["n"] if u else len([r for r in rows if BLS.inw(r, W["w24"]) and BLS.farm_comp(r)])
    return feat, allp, names, u, n12, W, k24, n12all


# ---------------------------------------------------------------- html
def early_scripts(repo=REPO):
    # lifted from a page scripts/inject_static_nav.py keeps current (farmland-index.html until Oct 29, 2026,
    # when that page became a moved-page stub)
    model = (REPO / "grain-emc.html") if Path(repo) == REPO else Path(repo) / "grain-emc.html"
    src = open(model, encoding="utf-8").read()
    m = re.search(r"<script>/\* agsist-theme-early.*?</script><script>/\* agsist-ga-guard.*?</script>", src, re.S)
    # and the GA config line beside them (Nov 4, 2026: without it the guard's gtag shim stopped loader.js from adding
    # analytics, and gtag.js loaded with no config, so not one land sales page view reached GA since Oct 27)
    g = re.search(r"<script>window\.dataLayer=window\.dataLayer\|\|\[\];function gtag\(\)\{dataLayer\.push\(arguments\);\}"
                  r"gtag\('js',new Date\(\)\);gtag\('config','G-[A-Z0-9]+'\);[^<]*</script>", src)
    return (m.group(0) if m else "") + (g.group(0) if g else "")


def head(title, desc, url, ld, early, style=""):
    ldh = "".join('<script type="application/ld+json">' + json.dumps(x, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/") + "</script>" for x in ld)
    return ("<!DOCTYPE html>\n<html lang=\"en\" data-theme=\"dark\">\n<head>\n"
            '<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n'
            '<meta name="theme-color" content="#0a0c0d">\n<link rel="stylesheet" href="/components/styles.css?v=28">\n' + CSS + "\n"
            '<link rel="icon" href="/img/favicon.ico" sizes="32x32">\n<link rel="icon" type="image/svg+xml" href="/img/icon.svg">\n'
            "<title>%s</title>\n<meta name=\"description\" content=\"%s\">\n"
            '<meta name="robots" content="index, follow, max-snippet:-1">\n<link rel="canonical" href="%s">\n'
            '<meta property="og:type" content="article">\n<meta property="og:site_name" content="AGSIST">\n'
            '<meta property="og:title" content="%s">\n<meta property="og:description" content="%s">\n<meta property="og:url" content="%s">\n'
            '<meta property="og:image" content="https://agsist.com/img/og/farmland-atlas.jpg">\n'
            '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n'
            '<meta property="og:image:alt" content="AGSIST Farmland Atlas: land values, rent and farm sales by county">\n'
            '<meta name="twitter:card" content="summary_large_image">\n'
            '<meta name="twitter:image" content="https://agsist.com/img/og/farmland-atlas.jpg">\n'
            "%s\n%s\n%s</head>\n<body>\n<a href=\"#main\" class=\"skip\">Skip to content</a>\n<div id=\"site-header\"></div>\n"
            '<main id="main" class="main ls" tabindex="-1">\n'
            % (e(title), e(desc), url, e(title.replace(" | AGSIST", "")), e(desc), url, early, ldh, ("<style>%s</style>\n" % style) if style else ""))


FOOT = ("</main>\n<div id=\"site-footer\"></div>\n<script src=\"/components/loader.js?v=19\" defer></script>\n" + JS + "\n</body>\n</html>\n")


def crumbs(items):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": u} for i, (n, u) in enumerate(items)]}


def names_btn(sid, file, what="buyer and seller"):
    if not file:
        return ""      # the state's file names no one: no button that would load nothing
    return ('<button type="button" class="ls-nm" data-ls-id="%s" data-ls-f="%s">Show %s</button>' % (e(sid), e(file), e(what)))


def flag_words(p):
    """The note for a sale: an unusual price, and for Vermont whether the return says the land is enrolled in
    current use (a fact about the sale, not a farm test: Sig's brief, Oct 29)."""
    w = ""
    if p.get("flag") == 1:
        w = "Unusual price: above the county's usual"
    elif p.get("flag") == -1:
        w = "Unusual price: below the county's usual"
    if p.get("cu"):
        w = (w + "; " if w else "") + "Enrolled in current use"
    return w


# What every price on these pages is (benchmark review, Oct 29, 2026: recorded sale vs auction result vs
# asking price, unmistakable wherever a price shows). Transfer records only: an auction counts once it
# is recorded, at the recorded price; a listing or a bid that did not close is never here.
PRICE_KIND = ("Every price here is a recorded sale: what the state's transfer record says was paid once the sale closed. "
              "Auction sales count once recorded. Asking prices and auction bids that did not close are never shown.")


def jdump(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


def sq(s):
    """An attribute value in single quotes (JSON keeps its double quotes, no &quot; in every row)."""
    return "'" + s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("'", "&#39;") + "'"


def row_data(p):
    """A sale's data-ls attribute: ROW_COLS, what the detail panel draws before (and besides) the county file."""
    # place: null here (it is in the row's own cell; the panel names it from the county file), so no town name sits in an attribute
    return jdump([p["id"], p["when"], 1 if p["basis"] == "recorded" else 0, p["acres"], p["price"], p.get("ppa"), None,
                  KIND_CODE.get(p.get("kind"), "f"), p.get("flag") or 0, 1 if p.get("cu") else 0, p.get("ri"), p.get("g") or 1, p.get("m") or ""]
                 + ([p["lx"]] if p.get("lx") else []))


def usual_list(u):
    return [u["med"], u["q1"], u["q3"], u["n"]] if u else None


def rec_ok(d, st, fips):
    """1 when the county's transfer file on disk carries no name (written since Nov 4, 2026, scripts/land_names.py, or a
    state whose file never had names): only then may the panel read it. A file still holding names is never fetched
    by a page; its panel shows what the page has until the next run rewrites the file."""
    f = d.land.file(st, fips) if d else None   # in memory names are put back; a split file says so with names_file
    return 1 if f and (f.get("names_file") or not land_names.has_names(f)) else 0


def ctx_data(st, fips, county, u, w24, ok=0):
    """A sale's data-ls-c attribute (on the county table, or on each row of a month table): the state, county, the
    county's 24-month middle the panel compares the sale with ([middle, lower quarter, upper quarter, sales] or null),
    its window, and rec_ok."""
    return jdump([st, fips, county, usual_list(u), w24, ok])


# Phones (Sig, Nov 8, 2026: the Unusual prices table was cut off at 390 px): every table this builder makes becomes one
# block per row, each value under a small label, so no number is cut and the page never scrolls sideways. The labels are
# CSS (td:nth-child), so the rows components/land-sales.js draws later read the same. Inline, so no shared file changes.
SALE_COLS = {"when": "Date", "where": "Where", "acres": "Acres", "price": "Price", "ppa": "$/acre", "note": "Note",
             "usual": "County usual", "kind": "Type"}
STACK_LAYOUTS = {
    "sales": [("when", "where", "acres", "ppa", "usual", "note"), ("when", "where", "acres", "price", "ppa", "note"),
              ("when", "where", "acres", "price", "ppa", "kind", "note")],
    "buyers": [("Rank", "State", "Counties", "Sales", "Acres", "Dollars")],
    "source": [("State", "On this site", "Source", "Names in the source", "How often", "Terms")],
}


def stack_css():
    r = ["@media(max-width:560px){"
         ".ls-st thead{display:none}"
         ".ls-st,.ls-st tbody{display:block}"
         ".ls-st tr{display:block;border-top:1px solid var(--border);padding:.45rem 0}"
         ".ls-st tr:first-child{border-top:0}"
         ".ls-st td{display:block;border:0;padding:.1rem 0 .1rem 6.8rem;position:relative;text-align:left;overflow-wrap:anywhere}"
         ".ls-st td.n{text-align:left;white-space:normal}"
         ".ls-st td:empty{display:none}"
         ".ls-st td::before{position:absolute;left:0;width:6.4rem;color:var(--text-muted);font-size:.8rem;font-weight:600}"
         ".ls-st tr.ls-dr>td{padding-left:0}"
         ".ls-st tr.ls-dr>td::before{content:none}"]
    for name, lays in STACK_LAYOUTS.items():
        for lay in lays:
            labs = [SALE_COLS.get(c, c) for c in lay]
            cls = ".ls-l-" + "-".join(c.replace(" ", "_") for c in lay)
            for i, lab in enumerate(labs, 1):
                r.append(".ls-st%s tr:not(.ls-dr)>td:nth-child(%d)::before{content:\"%s\"}" % (cls, i, lab))
    r.append("}")
    return "".join(r)


def lay_class(cols):
    return " ls-st ls-l-" + "-".join(str(c).replace(" ", "_") for c in cols)


def sale_table(rows, names_file, cols=("when", "where", "acres", "price", "ppa", "note"), caption=None, county_link=None, tid=None, anchors=False,
               ctx=None, win=None, d=None):
    """anchors: each row gets id="s-<sale id>" (the county page; the land sale email links to it).
    ctx: the table's data-ls-c (one county); without it each row carries its own, with its own usual and win (a month table).
    Every row carries data-ls (row_data): components/land-sales.js opens the sale's detail panel from it."""
    th = {"when": "Date", "where": "Where", "acres": "Acres", "price": "Recorded price", "ppa": "$/acre", "note": "Note", "usual": "County usual $/acre",
          "kind": "Type"}
    num = {"acres", "price", "ppa", "usual"}
    h = ['<div class="ls-tw"><table class="ls-t%s"%s%s>' % (lay_class(cols), ' id="%s"' % e(tid) if tid else "", ' data-ls-c=%s' % sq(ctx) if ctx else "")]
    if caption:
        h.append("<caption>%s</caption>" % e(caption))
    h.append("<thead><tr>" + "".join('<th scope="col"%s>%s</th>' % (' class="n"' if c in num else "", th[c]) for c in cols)
             + '<th scope="col">Names</th></tr></thead><tbody>')
    for p in rows:
        tds = []
        for c in cols:
            if c == "when":
                v = when_text(p) + ("*" if p["basis"] == "sale date" else "")
            elif c == "where":
                cl = county_link(p) if county_link else None
                cn = "%s County, %s" % (p["county"], p["st"])
                v = ((e(p["place"]) + ", ") if p.get("place") else "") + ('<a href="%s">%s</a>' % (cl, e(cn)) if cl else e(cn))
                tds.append("<td>%s</td>" % v)
                continue
            elif c == "acres":
                v = acres(p["acres"]) if p["acres"] is not None else "not stated"
            elif c == "price":
                v = money(p["price"])
            elif c == "ppa":
                v = money(p["ppa"]) if p.get("ppa") is not None else ""
            elif c == "kind":
                v = KIND_WORDS.get(p.get("kind"), "")
            elif c == "usual":
                u = p.get("usual")
                v = ("%s (%s to %s, %d sales)" % (money(u["med"]), money(u["q1"]), money(u["q3"]), u["n"])) if u else ""
            elif "kind" in cols:
                v = flag_words(p)
            else:
                v = "; ".join(x for x in (flag_words(p), "with buildings" if p.get("bldg") else "") if x)
            tds.append('<td%s>%s</td>' % (' class="n"' if c in num else "", e(v)))
        tds.append("<td>%s</td>" % names_btn(p["id"], names_file if d is None or d.named.get(p["st"], True) else None))
        rid = ' id="s-%s"' % e(p["id"]) if anchors else ""
        dl = ' data-ls=%s' % sq(row_data(p))
        if not ctx:
            dl += ' data-ls-c=%s' % sq(ctx_data(p["st"], p.get("fips"), p["county"], p.get("usual"), win, rec_ok(d, p["st"], p.get("fips"))))
        h.append(('<tr%s data-k="%s"%s>' % (rid, KIND_CODE.get(p.get("kind"), "f"), dl) if "kind" in cols else "<tr%s%s>" % (rid, dl)) + "".join(tds) + "</tr>")
    h.append("</tbody></table></div>")
    return "".join(h)


def src_line(d, states):
    parts = []
    for st in states:
        parts.append("%s, read %s" % (SOURCES[st], day(d.fetched[st])))
    return "Source: " + "; ".join(parts) + "."


RULE = ("A sale is listed when it carries a price and acres and a whole interest changed hands in a normal sale: gifts, family and "
        "related-party sales, quit claims, foreclosures and the like are left out, the same rule as Field Scout and the Farmland Atlas. "
        "Township and town are where the state places the sale; no parcel is pinned. None of this is an appraisal.")
def names_note(d, states):
    """The names line: the tap and Remove my name where a state's file names its buyers and sellers, else that it names no one."""
    named = [st for st in states if d.named.get(st, True)]
    none = [NAME[st] for st in states if not d.named.get(st, True)]
    out = NAMES_NOTE if named else ""
    if none:
        out += (" " if out else "") + "%s sales carry no buyer or seller names in the state's file; the deed at the county has them." % and_list(none)
    return out


# Method text never sits at the top (Sig, Nov 7, on /land-sales/2026-09: "way too much info ... needs to be on the bottom
# of page and collapsed unless someone wants to read it"; STANDING-DECISIONS Nov 7). The market rule and each state's
# method note move, word for word, into one closed details block at the bottom, each state under its own small heading.
# The ls-src class is the page's own collapsed source table (coverage_html); ls-dh is its small heading. No new CSS.
IL_NOTE = ("A farm sale is a farm parcel on a MyDec transfer declaration. Left out: gifts, family and related-party sales and anything "
           "less than the whole interest.")
WI_NOTE = ("A farm sale is a transfer return for land in the farm or forest classes. Left out: gifts, family and related-party sales and "
           "anything less than the whole interest.")
STATE_NOTES = (("IL", IL_NOTE), ("WI", WI_NOTE), ("IN", IN_NOTE), ("VT", VT_NOTE), ("NJ", NJ_NOTE), ("FL", FL_NOTE))
METHOD_SUMMARY = "Sources and terms"


def method_html(states, d=None, extra=()):
    """The one closed fold at the bottom: the rule, then extra [(heading, text)] (the unusual price definition and the
    date note on a month page), then the names line (when d is given), then each state's note."""
    h = ['<details class="ls-src" id="how-counted"><summary>%s</summary>' % METHOD_SUMMARY,
         '<h3 class="ls-dh">Every state</h3>', '<p class="ls-fine">%s</p>' % e(RULE)]
    for head_, text in extra:
        h.append('<h3 class="ls-dh">%s</h3><p class="ls-fine">%s</p>' % (e(head_), e(text)))
    if d is not None:
        h.append('<h3 class="ls-dh">Names</h3><p class="ls-fine">%s</p>' % e(names_note(d, states)))
    for st, note in STATE_NOTES:
        if st in states:
            src = ("%s, read %s. " % (SOURCES[st], day(d.fetched[st]))) if d is not None and d.fetched.get(st) else ""
            h.append('<h3 class="ls-dh">%s</h3><p class="ls-fine">%s%s</p>' % (e(NAME[st]), e(src), e(note)))
    h.append("</details>")
    return "\n".join(h)


NAMES_NOTE = ("Buyer and seller names are public record on the state's transfer return. They load only when you tap, and are not "
              "shown to search engines. If one is yours and you want it off this site, tap Remove my name beside it.")


def county_link_fn(repo):
    def f(p):
        s = SLUG.get(p["st"])
        slug = county_slug(p["county"])
        if (Path(repo) / "land-sales" / s / (slug + ".html")).exists() or True:
            return "/land-sales/%s/%s" % (s, slug)
    return f


def lead_big(M):
    """One sentence on the largest sale by acres."""
    b = (M.get("biggest_acres") or [None])[0]
    if not b:
        return ""
    return "The largest by acres: %s acres in %s County, %s, for %s." % (acres(b["acres"]), e(b["county"]), b["st"], money(b["price"]))


def unusual_def(M):
    """What 'unusual' means, in one plain sentence for the fold (the month page keeps one short line by the table)."""
    return ("A sale of %d acres or more is marked unusual when its price per acre is far above or below the usual for its county, "
            "which is the middle half of that county's sales of that size over the two years from %s to %s. "
            "Possible reasons above the usual: %s. Possible reasons below: %s. The return does not say which, and a price is not wrong because it is unusual."
            % (COMP_MIN_ACRES, LA.short_day(M["window"][0]) + ", " + M["window"][0][:4],
               LA.short_day(M["window"][1]) + ", " + M["window"][1][:4], UP_WHY, DOWN_WHY))


def best_def():
    """What 'best value' means, in plain words, for the fold."""
    return ("Best value lists sales of %d acres or more with the lowest price per acre against their county's usual, leaving out the unusual "
            "prices and anything well under the usual range. The record has no soil, tillable acres, buildings or drainage, so a low price "
            "can just mean poorer ground." % BEST_MIN_ACRES)


def month_page(d, M, early, coverage, archive):
    key, lab = M["month"], M["label"]
    url = "%s/land-sales/%s" % (ORIGIN, key)
    nf = "/data/land/names/%s.json" % key
    sts = and_list([NAME[s] for s in M["states"]])
    title = "Farmland sales, %s: biggest buyers and sales in %s | AGSIST" % (lab, sts)
    big = M.get("biggest") or []
    desc = ("%d farm sales of %d acres or more in %s, %s: the biggest buyers and sales, unusual prices and the best value per acre, "
            "from the state transfer records." % (M["n"], LIST_MIN_ACRES, sts, lab))
    ld = [crumbs([("AGSIST", ORIGIN + "/"), ("Farmland sales", ORIGIN + "/land-sales/"), (lab, url)]),
          {"@context": "https://schema.org", "@type": "Article", "headline": "Farmland sales, " + lab, "url": url,
           "datePublished": max(d.fetched.values()), "author": {"@type": "Person", "name": "Sigurd Lindquist", "url": ORIGIN + "/about"}}]
    cl = county_link_fn(d.repo)
    b = [head(title, desc, url, ld, early, stack_css()), '<div class="ls-w">',
         '<nav class="ls-bc" aria-label="Breadcrumb"><a href="/land-sales/">Farmland sales</a> / %s</nav>' % e(lab),
         "<h1>Farmland sales, %s</h1>" % e(lab)]
    lead = []
    for st in M["states"]:
        ps = M["per_state"][st]
        lead.append("%d in %s%s" % (ps["n"], NAME[st], " (by deed date)" if ps["basis"] == "sale date" else " (by sale month)" if ps["basis"] == "sale month" else ""))
    b.append('<p class="ls-ans">%d farm sales of %d acres or more were recorded in %s: %s. %s</p>'
             % (M["n"], LIST_MIN_ACRES, e(lab), e(", ".join(lead)),
                lead_big(M)))
    # one caveat line under the answer, at most (the method notes are in method_html at the bottom)
    cav = []
    dated = [NAME[s] for s in M["states"] if M["per_state"][s]["basis"] == "sale date"]
    star = ("* %s sales are dated by the deed for now, so a sale signed late in the month may still be filed after this was read and show up next month."
            % and_list(dated)) if dated else None
    for st, to in sorted((M.get("later") or {}).items()):
        cav.append("%s is not in this month yet: its files hold sales through %s." % (e(NAME[st]), e(LA.month_text(to))))
    if cav:
        b.append('<p class="ls-fine ls-cav">%s</p>' % " ".join(cav))
    b.append('<div class="ls-ask"><div data-land-alert data-source="page:land-sales-month"></div></div>')
    # buyers
    b.append('<h2 id="buyers">Biggest buyers</h2>')
    if M.get("buyers_acres"):
        b.append("<p>Buyers named on the month's sales, all their purchases added up within a state. Names load when you tap.</p>")
        for k, cap in (("buyers_acres", "Most acres bought"), ("buyers_dollars", "Most dollars spent")):
            h = ['<div class="ls-tw"><table class="ls-t' + lay_class(STACK_LAYOUTS["buyers"][0]) + '"><caption>%s</caption><thead><tr><th scope="col">#</th><th scope="col">State</th>'
                 '<th scope="col">Counties</th><th scope="col" class="n">Sales</th><th scope="col" class="n">Acres</th>'
                 '<th scope="col" class="n">Dollars</th><th scope="col">Buyer</th></tr></thead><tbody>' % cap]
            for i, x in enumerate(M[k], 1):
                h.append("<tr><td>%d</td><td>%s</td><td>%s</td><td class=\"n\">%d</td><td class=\"n\">%s</td><td class=\"n\">%s</td><td>%s</td></tr>"
                         % (i, x["st"], e(", ".join(x["counties"][:3]) + (" and more" if len(x["counties"]) > 3 else "")), x["n"],
                            acres(x["acres"]), money(x["price"]), names_btn(x["id"], nf, "buyer")))
            h.append("</tbody></table></div>")
            b.append("".join(h))
    else:
        b.append('<p class="ls-held">Not shown this month: %s.</p>' % e(M["buyers_why"]))
    # biggest sales
    b.append('<h2 id="biggest">Biggest sales</h2>')
    if big:
        b.append(sale_table(M["biggest_acres"], nf, caption="Most acres, %s" % lab, county_link=cl, win=M["window"], d=d))
        b.append(sale_table(big, nf, caption="Highest price, %s" % lab, county_link=cl, win=M["window"], d=d))
    else:
        b.append('<p class="ls-held">Not shown this month: %s.</p>' % e(M["biggest_why"]))
    # unusual
    b.append('<h2 id="unusual">Unusual prices</h2>')
    if M.get("unusual") is not None:
        b.append("<p>Sales of %d acres or more priced far from the county's usual. %d of %d sales that could be compared this month.</p>"
                 % (COMP_MIN_ACRES, M["n_unusual"], M["n_judged"]))
        if M["unusual"]:
            b.append(sale_table(M["unusual"], nf, cols=("when", "where", "acres", "ppa", "usual", "note"), county_link=cl, win=M["window"], d=d))
        else:
            b.append("<p>None this month.</p>")
    else:
        b.append('<p class="ls-held">Not shown this month: %s.</p>' % e(M["unusual_why"]))
    # best value
    b.append('<h2 id="value">Best value per acre</h2>')
    if M.get("best"):
        b.append("<p>Sales of %d acres or more with the lowest price per acre against their county's usual. A low price can just mean poorer ground.</p>"
                 % BEST_MIN_ACRES)
        b.append(sale_table(M["best"], nf, cols=("when", "where", "acres", "ppa", "usual", "note"), county_link=cl, win=M["window"], d=d))
    else:
        b.append('<p class="ls-held">Not shown this month: %s.</p>' % e(M["best_why"]))
    b.append('<p class="ls-fine">%s</p>' % e(src_line(d, M["states"])))
    b.append(coverage_html(coverage, d))
    extra = [("Unusual prices", unusual_def(M))] if M.get("unusual") is not None else []
    if M.get("best"):
        extra.append(("Best value per acre", best_def()))
    if star:
        extra.append(("Dates", star))
    b.append(method_html(M["states"], d, extra))
    if archive:
        b.append('<h2 id="earlier">Other months</h2><p>%s</p>' % " &middot; ".join('<a href="/land-sales/%s">%s</a>' % (k, e(v)) for k, v in archive if k != key))
    b.append('<p><a href="/land-sales/">Farmland sales by county</a> &middot; <a href="/comp-report">Comparable sales report</a> &middot; <a href="/field-scout">Field Scout</a></p>')
    b.append("</div>")
    return "\n".join(b) + "\n" + FOOT


# The map is the shared real US map (components/usmap.js, data/us-states-map.svg). It shows only what a reader can use
# (Sig, Nov 8): the states with sales on these pages (each links to its county list) and the states where the Farmland
# Atlas has other county land values (each links to its Atlas page). Every other state is drawn neutral with its name and
# nothing else. data/land-sales/coverage.json (our own research status, kept by hand) feeds no page and no public file.
MAP_FILL = {"live": "#2e7d4f", "atlas": "#e6d6a8"}
MAP_WORDS = {"live": "Sales on these pages", "atlas": "Other county land values"}
MAP_JS = ('<script src="/components/usmap.js?v=2" defer></script><script>document.addEventListener("DOMContentLoaded",function(){'
          'var h=document.getElementById("ls-map");if(!h||!window.AgUSMap)return;var d=JSON.parse(h.getAttribute("data-map")),F=%s,s={};'
          'for(var k in d)s[k]={fill:F[d[k][0]]||"",text:d[k][1],href:d[k][2]};'
          'AgUSMap.mount(h,{states:s,plain:true,hint:"Tap a state.",name:"Map of the states with farmland sales on this site"});});</script>'
          % json.dumps(MAP_FILL, separators=(",", ":")))


# Where sale prices are not public record, the county land values two other sources publish
# (data/land/<st>/survey.json, scripts/build_land_survey.py): counted by county, linked to the Atlas county pages that
# show them. Never a recorded sale and never in the middles above. test/land-survey.test.mjs checks the counts against the files.
SURVEY_STATES = (("ND", "North Dakota", "north-dakota"), ("KS", "Kansas", "kansas"))


def survey_counts(S):
    """(counties with at least one dollar value, counties in the file)."""
    vals = 0
    for c in (S.get("counties") or {}).values():
        if any(isinstance(v, dict) and (v.get("value") is not None or v.get("avg") is not None) for v in c.values()):
            vals += 1
    return vals, len(S.get("counties") or {})


def survey_states(d):
    """[(st, name, slug, counties, data-file)] for the states whose Atlas pages show other county land values."""
    out = []
    for st, name, slug in SURVEY_STATES:
        try:
            S = json.load(open(d.repo / "data" / "land" / st.lower() / "survey.json", encoding="utf-8"))
        except (OSError, ValueError):
            continue
        n, _ = survey_counts(S)
        if n:
            out.append((st, name, slug, n, S))
    return out


def map_html(d, live_href="#%s"):
    """The map and its two-key legend. live_href: where a state with sales goes (% the state's slug)."""
    data = {}
    for st in d.states:
        data[st] = ["live", MAP_WORDS["live"], live_href % SLUG[st]]
    for st, name, slug, n, S in survey_states(d):
        data[st] = ["atlas", MAP_WORDS["atlas"], "/farmland-atlas/%s/" % slug]
    return ('<div class="ls-usmap" id="ls-map" data-map="%s"><noscript><p>The map needs JavaScript. Every state with sales is in the list below.</p></noscript></div>'
            % e(json.dumps(data, separators=(",", ":")))
            + MAP_JS
            + '<p class="ls-key"><span class="ls-k ls-st-live"></span> %s <span class="ls-k ls-st-county"></span> %s</p>' % (MAP_WORDS["live"], MAP_WORDS["atlas"]))


def survey_html(d):
    """One short line and links: where sale prices are private, the Atlas shows county land values."""
    rows = survey_states(d)
    if not rows:
        return ""
    links = " and ".join('<a href="/farmland-atlas/%s/">%s</a> (%d counties)' % (slug, e(name), n) for st, name, slug, n, S in rows)
    return ('<p class="ls-surv" id="other-evidence">Other county land values, not recorded sales: %s in the Farmland Atlas.</p>' % links)


def coverage_html(cov, d):
    """The month page's block: the map with the states that have sales."""
    live = [NAME[st] for st in d.states]
    return "\n".join(['<h2 id="coverage">Where the sales come from</h2>',
                      '<p class="ls-cov-n">Sales reported for %d states: %s.</p>' % (len(live), e(and_list(live))),
                      map_html(d, "/land-sales/#%s"), survey_html(d)])


MONTH_STATES = ("FL",)     # files with sale months, not days (fetch_land_sales STATES[st]["dates"]): their pages say months only


def span_words(w, month=False):
    if month:
        return "%s to %s" % (LA.month_text(w[0]), LA.month_text(w[1]))
    return "%s to %s" % (LA.short_day(w[0]) + ", " + w[0][:4], LA.short_day(w[1]) + ", " + w[1][:4])


def middle_words(st, u, k24, w24):
    """The headline middle in words: the market-sale rule, labeled as such; withheld under MIN_COMPS."""
    if u:
        t = ("Market middle: %s an acre, the middle of %d bare farmland sales of %d acres or more at %s an acre or more, %s "
             "(middle half %s to %s). Sales with buildings, forest and small parcels are listed below but kept out of this middle."
             % (money(u["med"]), u["n"], COMP_MIN_ACRES, money(BLS.PPA_FLOOR), span_words(w24, st in MONTH_STATES), money(u["q1"]), money(u["q3"])))
    else:
        t = ("No market middle: %s bare farmland sale%s of %d acres or more at %s an acre or more, %s, and it takes %d."
             % (k24 or "no", "" if k24 == 1 else "s", COMP_MIN_ACRES, money(BLS.PPA_FLOOR), span_words(w24, st in MONTH_STATES), MIN_COMPS))
    return t


def in_trend_words(u):
    """Indiana: the middle stays, labeled (Sig, Oct 29, 2026)."""
    if not u:
        return "Most Indiana sales are marked not valid for trending by the state."
    return ("Most Indiana sales are marked not valid for trending by the state: %d of the %d sales behind this middle carry that mark. "
            "The state's form does not say why for each sale." % (u.get("nvt") or 0, u["n"]))


def kind_counts(rows):
    n = {k: 0 for k in KIND_WORDS}
    for p in rows:
        n[p.get("kind") or "farm"] = n.get(p.get("kind") or "farm", 0) + 1
    return n


def county_page(d, st, c, allp, u, n12, summ, early, latest, W, k24, n12all):
    s = SLUG[st]
    slug = county_slug(c["name"])
    url = "%s/land-sales/%s/%s" % (ORIGIN, s, slug)
    nf = "/data/land/names/%s/%s.json" % (st.lower(), c["fips"]) if d.named.get(st, True) else ""
    lf = "/data/land-sales/%s/%s.json" % (st.lower(), c["fips"])
    cn = "%s County, %s" % (c["name"], NAME[st])
    title = "Farmland Sales in %s: Every Recorded Sale and Price per Acre | AGSIST" % cn
    mid = middle_words(st, u, k24, W["w24"])
    desc = ("Every recorded farm sale in %s: date, township, acres, price, price per acre and type. %d sales in the last 12 months. %s"
            % (cn, n12all, ("Market middle %s an acre on %d bare farmland sales of %d+ acres over 24 months." % (money(u["med"]), u["n"], COMP_MIN_ACRES)) if u else ""))
    ld = [crumbs([("AGSIST", ORIGIN + "/"), ("Farmland sales", ORIGIN + "/land-sales/"), (NAME[st], ORIGIN + "/land-sales/#" + s), (cn, url)])]
    atlas = "/farmland-atlas/%s/%s" % (s, slug)
    has_atlas = (d.repo / "farmland-atlas" / s / (slug + ".html")).exists()
    page = allp[:COUNTY_ROWS]
    b = [head(title, desc[:300], url, ld, early, SALE_CSS + stack_css()), '<div class="ls-w">',
         '<nav class="ls-bc" aria-label="Breadcrumb"><a href="/land-sales/">Farmland sales</a> / %s</nav>' % e(NAME[st]),
         "<h1>Farmland sales in %s</h1>" % e(cn),
         '<p class="ls-ans">%d recorded sales in the last 12 months, any size (%d of %d acres or more).</p>' % (n12all, n12, LIST_MIN_ACRES),
         '<p class="ls-mid">%s</p>' % e(mid)]
    # Two windows, one county (benchmark review, Oct 29, 2026: a 24-month middle here and a 12-month
    # median on the Atlas page read like a conflict). Both from data/land/<st>/summary.json and the
    # sale file; the Atlas page says the same the other way round (build_atlas_pages.land_first).
    m12 = (((summ or {}).get("counties") or {}).get(c["fips"]) or {}).get("med") if u else None
    w12 = ((summ or {}).get("windows") or {}).get("cur")
    if m12 and w12 and has_atlas:
        b.append('<p class="ls-fine ls-two">Two windows: this middle covers 24 months (%d sales). The <a href="%s">Farmland Atlas page</a> '
                 'also shows the last 12 months, %s: %d sales, median %s an acre. Different windows, different numbers.</p>'
                 % (u["n"], atlas, e(span_words(w12, st in MONTH_STATES)), m12["n"], money(m12["med"])))
    if st == "IN":
        b.append('<p class="ls-fine">%s</p>' % e(in_trend_words(u)))
    if latest and latest.get("month"):
        b.append('<p>All of %s together: <a href="/land-sales/%s">the %s update</a>, with the biggest buyers and unusual prices.</p>'
                 % (e(and_list([NAME[x] for x in latest["states"]])), latest["month"], e(latest["label"])))
    if st in EMAIL_STATES:
        b.append('<div class="ls-ask"><div data-land-alert data-source="page:land-sales-county"></div></div>')
    b.append('<h2 id="every-sale">Every recorded sale</h2>')
    if allp:
        kc = kind_counts(allp)
        days = sorted(p["when"] for p in allp)
        parts = ["%d %s" % (kc[k], {"farm": "farmland", "bldg": "with buildings", "forest": "forest", "small": "small parcels" if kc[k] != 1 else "small parcel"}[k])
                 for k in ("farm", "bldg", "forest", "small") if kc[k]]
        dfmt = LA.month_text if allp[0]["basis"] == "sale month" else day
        b.append('<p>%d sales on file, %s to %s: %s.%s</p>'
                 % (len(allp), e(dfmt(days[0])), e(dfmt(days[-1])), e(", ".join(parts)),
                    " Illinois declarations do not say whether buildings were included, so no Illinois sale is marked with buildings." if st == "IL" else ""))
        b.append('<p class="ls-fine ls-kind">%s</p>' % e(PRICE_KIND))
        opts = "".join('<option value="%s">%s</option>' % (KIND_CODE[k], e(w[0].upper() + w[1:])) for k, w in KIND_WORDS.items() if kc[k])
        b.append('<div class="ls-flt" hidden data-ls-list="%s" data-ls-names="%s" data-ls-n="%d"><label>Type <select class="ls-fk">'
                 '<option value="">All types</option>%s</select></label></div>' % (e(lf), e(nf), len(allp), opts))
        b.append(sale_table(page, nf, cols=("when", "where", "acres", "price", "ppa", "kind", "note"), caption="Newest first, %s" % cn, tid="ls-all", anchors=True,
                             ctx=ctx_data(st, c["fips"], c["name"], u, W["w24"], rec_ok(d, st, c["fips"]))))
        if len(allp) > len(page):
            b.append('<p class="ls-more" data-ls-shown="%d">Showing the newest %d of %d sales. '
                     '<button type="button" class="ls-mo" hidden>Show %d more</button></p>' % (len(page), len(page), len(allp), COUNTY_ROWS))
        if any(p["basis"] == "sale date" for p in allp):
            b.append('<p class="ls-fine">* Dated by the deed; the state file this was read from does not carry the recording date for these rows.</p>')
        b.append('<p class="ls-fine">Type: with buildings means the property class on the record shows a house, farm buildings or a business; '
                 'forest means forest classes with no farm class (Wisconsin), timberland with no operating farm (Vermont) or timberland use codes (Florida); a small parcel is under %d acres; farmland is the rest. '
                 'Acres not stated: a return covering several parcels that does not give them.</p>' % COMP_MIN_ACRES)
        if u:
            b.append("<p>A sale marked unusual is bare farmland whose price per acre sits well outside the market middle half; possible reasons above it: %s; below: %s.</p>"
                     % (e(UP_WHY), e(DOWN_WHY)))
    else:
        b.append('<p class="ls-held">No recorded sales on file for this county yet.</p>')
    b.append('<p class="ls-fine">%s</p>' % e(src_line(d, [st])))
    b.append(method_html([st], d))
    links = []
    if has_atlas:
        links.append('<a href="%s">%s in the Farmland Atlas</a>' % (atlas, e(c["name"] + " County")))
    links.append('<a href="/field-scout?fips=%s">Every sale on a map in Field Scout</a>' % c["fips"])
    links.append('<a href="/comp-report">Comparable sales report</a>')
    links.append('<a href="/land-sales/">Other counties</a>')
    b.append("<p>" + " &middot; ".join(links) + "</p></div>")
    if allp:
        b.append("<script>%s</script>" % SALE_JS)
    return "\n".join(b) + "\n" + FOOT


# One sale, linked (Sig, Nov 3, 2026: every sale in the land sale email links to its row here). Each row of
# the county table has id="s-<sale id>" (land_alert.sale_id: a hash, no name). #s-<id> scrolls to the row and
# marks it (:target). A sale past the newest COUNTY_ROWS is not in the page until components/land-sales.js draws
# it from the list file, so this presses its "Show more" until the row is there (found by its names button,
# which carries the same id), then marks it. Kept in the page, not in land-sales.js, so no shared file changes.
SALE_CSS = (".ls-t tr[id]{scroll-margin-top:5rem}"
            ".ls-t tr:target td,.ls-t tr.ls-hit td{background:rgba(212,160,23,.18)}"
            ".ls-t tr:target,.ls-t tr.ls-hit{outline:2px solid var(--brand,var(--gold,#d4a017));outline-offset:-2px}")
SALE_JS = ("(function(){var t=0,n=0,id='',k=0;"
           "function find(){var r=document.getElementById('s-'+id);if(r)return r;"
           "var b=document.querySelector('#ls-all button.ls-nm[data-ls-id=\"'+id+'\"]');return b?b.closest('tr'):null;}"
           "function show(r){try{r.scrollIntoView({block:'center'});}catch(e){}}"
           "function step(my){if(my!==k)return;var r=find();if(r){r.classList.add('ls-hit');show(r);[600,1600].forEach(function(d){setTimeout(function(){if(my===k&&r.isConnected)show(r);},d);});return;}"
           "var mo=document.querySelector('.ls-more button.ls-mo');"
           "if(mo&&!mo.hidden&&mo.getAttribute('aria-busy')!=='true'&&n<80){n++;mo.click();}"
           "if(++t<160)setTimeout(function(){step(my);},250);}"
           "function go(){var m=/^#s-([0-9a-f]{10})$/.exec(location.hash||'');"
           "Array.prototype.forEach.call(document.querySelectorAll('#ls-all tr.ls-hit'),function(r){r.classList.remove('ls-hit');});"
           "if(!m)return;id=m[1];t=0;step(++k);}"
           "window.addEventListener('hashchange',go);"
           "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();})();")


# "Your county" on the hub (Sig, Oct 29, 2026: the land sale page should be easy to find). The jump
# row is plain links to the state lists and the source table. The script reads the place the reader
# saved elsewhere on the site (localStorage agsist-wx-loc: state and county, written by
# components/geo.js and Fast Facts), finds that county's link in the list already on this page
# and offers it; nothing is fetched or sent, and a county not in the list gets its state instead.
JUMP_JS = ("(function(){function go(){try{var w=JSON.parse(localStorage.getItem('agsist-wx-loc')||'null');if(!w||!w.state)return;"
           "var S={IL:'illinois',WI:'wisconsin',IN:'indiana',VT:'vermont',NJ:'new-jersey',FL:'florida',ILLINOIS:'illinois',WISCONSIN:'wisconsin',INDIANA:'indiana',VERMONT:'vermont','NEW JERSEY':'new-jersey',FLORIDA:'florida'},"
           "st=S[String(w.state).toUpperCase()],el=document.getElementById('ls-mine');if(!el)return;"
           "var n=function(x){return String(x||'').toLowerCase().replace(/\\s+(county|parish)$/,'').replace(/[^a-z]/g,'')};"
           "if(!st){el.innerHTML='Your state is not on these pages yet: <a href=\"#coverage\">the map</a>.';el.hidden=false;return;}"
           "var a=null,c=n(w.county);if(c){var L=document.querySelectorAll('#'+st+' + ul a');"
           "for(var i=0;i<L.length;i++){if(n(L[i].textContent)===c){a=L[i];break;}}}"
           "var h=document.getElementById(st).textContent;"
           "el.innerHTML=a?'Your county: <a href=\"'+a.getAttribute('href')+'\">'+a.textContent+', '+h+'</a>':'Your state: <a href=\"#'+st+'\">'+h+' counties</a>';"
           "el.hidden=false;}catch(e){}}"
           "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();})();")


def mine_row():
    """The saved-place line (JUMP_JS): hidden until this device has a saved county."""
    return '<p class="ls-mine" id="ls-mine" hidden></p><script>%s</script>' % JUMP_JS


STAND_TAG = {"acres": "Largest by acres", "high": "Highest price per acre", "low": "Lowest price per acre", "new": "Newest sale"}
OPEN_JS = ("(function(){function o(){var h=location.hash.slice(1),t=h&&document.getElementById(decodeURIComponent(h));if(!t)return;"
           "for(var n=t.parentElement;n;n=n.parentElement)if(n.tagName==='DETAILS')n.open=true;t.scrollIntoView();}"
           "addEventListener('hashchange',o);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',o);else o();})();")
PICK_JS = ("(function(){var f=document.getElementById('ls-pick');if(!f)return;var S=f.elements.st,C=f.elements.co;"
           "function fill(){var id=S.value;C.length=1;C.disabled=!id;if(!id)return;"
           "var L=document.querySelectorAll('#'+id+' + ul a');for(var i=0;i<L.length;i++){var o=new Option(L[i].textContent.replace(/ County$/,''),L[i].getAttribute('href'));C.add(o);}}"
           "S.addEventListener('change',fill);"
           "f.addEventListener('submit',function(e){e.preventDefault();var v=C.value||(S.value?'#'+S.value:'');if(!v)return;"
           "if(v.charAt(0)==='#'){location.hash=v;}else location.href=v;});})();")


def stand_card(c):
    """One stand-out sale: what it is, where, acres, price, $/acre, date; the whole card is the link."""
    where = ("%s, " % e(str(c["place"]).strip(" ,")) if str(c.get("place") or "").strip(" ,") else "") + "%s County, %s" % (e(c["county"]), e(c["st"]))
    sub = ""
    if c["kind"] in ("high", "low") and c.get("med"):
        pct = round(abs(c["ppa"] / c["med"] - 1) * 100)
        sub = '<span class="ls-d">%d%% %s the county usual of %s</span>' % (pct, "above" if c["kind"] == "high" else "below", money(c["med"]))
    return ('<li><a class="ls-card" href="/land-sales/%s/%s#s-%s"><span class="ls-tag">%s</span><b>%s acres in %s</b>'
            '<span class="ls-fig">%s &middot; %s an acre</span><span class="ls-d">%s</span>%s</a></li>'
            % (SLUG[c["st"]], county_slug(c["county"]), e(c["id"]), STAND_TAG[c["kind"]], acres(c["acres"]), where,
               money(c["price"]), money(c["ppa"]), e(when_text(c)), sub))


def index_section(repo):
    """The Illinois farmland sale index (scripts/build_land_index.py writes data/land/index.json; this
    bakes its section into the hub). None when the file is missing or Illinois is held back."""
    p = Path(repo) / "data" / "land" / "index.json"
    if not p.exists():
        return None
    data = json.loads(p.read_text(encoding="utf-8"))
    if not (data.get("states") or {}).get("IL") or data["states"]["IL"].get("held"):
        return None
    import build_land_index as LI
    return LI.hub_section(data)


def index_page(d, latest, counties, early, coverage, archive, ix=None):
    url = ORIGIN + "/land-sales/"
    # Nov 4 (Sig: "my buddy didn't know that farm land sales were on agsist"): the words people search for first
    title = "Farmland Sales Prices by County | AGSIST"     # 60 characters or fewer; the states are in the description
    desc = ("What farmland sold for in %s: every recorded farm sale by county with acres, price and price per acre, and a monthly "
            "update of the biggest buyers and sales." % and_list(sorted(NAME[x] for x in d.states)))
    if ix:
        desc = ("What farmland sold for in %s: every recorded farm sale by county with acres, price and price per acre, the "
                "Illinois farmland sale index and a monthly update of the biggest buyers and sales." % and_list(sorted(NAME[x] for x in d.states)))
    ld = [crumbs([("AGSIST", ORIGIN + "/"), ("Farmland sales", url)])] + (ix["ld"] if ix else [])
    b = [head(title, desc, url, ld, early, (ix["css"] if ix else "") + stack_css()), '<div class="ls-w ls-hub">', "<h1>Farmland sales</h1>"]
    # top: one sentence, the map, the stand-out sales, the picker (Sig, Nov 8, on a phone: the map and the stand-out sales top and center)
    if latest:
        b.append('<p class="ls-ans">%d farm sales in %s. Tap a state, or see the biggest <a href="/land-sales/%s">buyers and sales of the month</a>.</p>'
                 % (latest["n"], e(latest["label"]), latest["month"]))
    else:
        b.append('<p class="ls-ans">What farmland sold for, county by county. Tap a state.</p>')
    b.append('<div id="coverage">%s</div>' % map_html(d))
    stand = (latest or {}).get("stand") or []
    if stand:
        b.append('<h2 id="stand-out">Stand-out sales, %s</h2><ul class="ls-cards">%s</ul>' % (e(latest["label"]), "".join(stand_card(c) for c in stand)))
    b.append('<form class="ls-pick" id="ls-pick" aria-label="Find your state or county"><h2>Find your state or county</h2><div class="ls-pr">'
             '<label>State<select name="st"><option value="">Choose</option>%s</select></label>'
             '<label>County<select name="co" disabled><option value="">Choose</option></select></label>'
             '<button type="submit">Go</button></div><noscript><p class="ls-fine">The full list is in All states and counties, below.</p></noscript></form>'
             % "".join('<option value="%s">%s</option>' % (SLUG[st], e(NAME[st])) for st in d.states))
    b.append(mine_row())
    b.append("<script>%s</script>" % PICK_JS)
    # below: the latest months, other values, the email ask, the Illinois index, the full lists, sources
    if archive:
        b.append('<h2 id="months">Latest months</h2><p class="ls-mo">%s</p>' % " &middot; ".join('<a href="/land-sales/%s">%s</a>' % (k, e(v)) for k, v in archive[:6]))
    sv = survey_html(d)
    if sv:
        b.append(sv)
    if ix:
        b.append('<details class="ls-all ls-ixf" id="ix-fold"><summary>Illinois farmland sale index</summary>%s</details>' % ix["html"])
    b.append('<details class="ls-all" id="all-states"><summary>All states and counties</summary>')
    for st in d.states:
        b.append('<h3 id="%s">%s</h3><ul class="ls-cos">' % (SLUG[st], e(NAME[st])))
        for name, slug, n in counties[st]:
            b.append('<li><a href="/land-sales/%s/%s">%s County</a> <span>%d</span></li>' % (SLUG[st], slug, e(name), n))
        b.append("</ul>")
    b.append('<p class="ls-fine">The number beside each county: sales of %d acres or more in the last 12 months.</p></details>' % LIST_MIN_ACRES)
    b.append('<div class="ls-ask" id="email"><div data-land-alert data-source="page:land-sales"></div></div>')
    b.append('<p class="ls-fine">%s</p>' % e(src_line(d, d.states)))
    b.append(method_html(d.states) + "</div>")
    b.append("<script>%s</script>" % OPEN_JS)
    foot = FOOT.replace("</main>", "</main>\n<script>%s</script>" % ix["js"], 1) if ix else FOOT
    return "\n".join(b) + "\n" + foot


def sitemap(urls):
    body = "".join("  <url><loc>%s</loc><lastmod>%s</lastmod></url>\n" % (u, m) for u, m in urls)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<!-- Farmland sales. Written by scripts/build_land_sales.py; lastmod is the day the state files were read. -->\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + "</urlset>\n")


def dump(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"


# ---------------------------------------------------------------- build
def build(repo=REPO):
    """{relative path: text} of everything this script owns."""
    d = Data(repo)
    out = {}
    if not d.states:
        return out
    coverage = json.load(open(Path(repo) / "data" / "land-sales" / "coverage.json", encoding="utf-8"))
    early = early_scripts(repo)
    year, m0 = latest_month(d)
    M, mnames = month_build(d, year, m0)
    key = M["month"]
    # archive: the month pages already on disk plus this one
    arch = {}
    for p in sorted((Path(repo) / "land-sales").glob("[0-9][0-9][0-9][0-9]-[0-9][0-9].html")):
        k = p.stem
        arch[k] = "%s %s" % (LA.MONTHS[int(k[5:]) - 1], k[:4])
    if M["fresh"] and M["n"]:
        arch[key] = M["label"]
    archive = sorted(arch.items(), reverse=True)
    pub = max(d.fetched.values())
    latest = None
    if M["fresh"] and M["n"]:
        top = [{k: p[k] for k in ("id", "st", "county", "place", "when", "basis", "acres", "price", "ppa")} for p in (M.get("biggest_acres") or [])[:3]]
        latest = {"month": key, "label": M["label"], "url": "/land-sales/" + key, "published": pub, "states": M["states"],
                  "n": M["n"], "per_state": {s: M["per_state"][s]["n"] for s in M["states"]}, "top": top, "stand": M.get("stand") or [],
                  "n_unusual": M["n_unusual"], "n_buyers": M["n_buyers"],
                  "top_state": {st: next(({k: p[k] for k in ("id", "st", "county", "place", "when", "basis", "acres", "price", "ppa")}
                                          for p in (M.get("biggest_acres_all") or []) if p["st"] == st), None) for st in M["states"]},
                  "sources": {s: SOURCES[s] for s in M["states"]}, "fetched": d.fetched}
        out["land-sales/%s.html" % key] = month_page(d, M, early, coverage, archive)
        out["data/land/names/%s.json" % key] = dump(mnames)
        out["data/land-sales/latest.json"] = dump(latest)
    if carried_states(repo, d):
        # a hosted state's files are not in this copy (CARRY): the county pages name the committed update, not this one
        try:
            latest = json.load(open(Path(repo) / "data" / "land-sales" / "latest.json", encoding="utf-8"))
        except (OSError, ValueError):
            latest = None
    urls = []
    counties = {}
    lead = {"states": d.states, "published": pub, "fetched": d.fetched, "lead": {}, "farm_filter": {}}
    for st in d.states:
        lc, lpool = [], []
        summ = d.summary(st)
        through = (summ or {}).get("through") or BLS.month_end_before(d.fetched[st]).isoformat()
        sfile = {"state": st, "name": NAME[st], "through": through, "fetched": d.fetched[st], "source": SOURCES[st],
                 "names_dir": "/data/land/names/%s/" % st.lower() if d.named[st] else None, "counties": {}}
        dm = any((d.land.file(st, c["fips"]) or {}).get("dates") == "month" for c, rows in d.counties[st][:1])
        if dm:
            sfile["dates"] = "month"      # each "when" is the first of the sale month: readers show the month, never a day
        counties[st] = []
        for c, rows in d.counties[st]:
            feat, allp, names, u, n12, W, k24, n12all = county_build(d, st, c, rows, through)
            slug = county_slug(c["name"])
            counties[st].append((c["name"], slug, n12))
            lc.extend((p, u, slug) for p in allp)
            lpool.extend(r["ppa"] for r in rows if BLS.inw(r, W["w24"]) and BLS.farm_comp(r))
            sfile["counties"][c["fips"]] = {"name": c["name"], "slug": slug, "ll": [c["lat"], c["lng"]], "n12": n12,
                                           "usual": {"med": u["med"], "n": u["n"], "q1": u["q1"], "q3": u["q3"]} if u else None, "k24": k24,
                                           "w24": W["w24"], "lx": {p["id"]: p["lx"] for p in feat if p.get("lx")},
                                           "rec": rec_ok(d, st, c["fips"]),
                                           "s": [[p["id"], p["when"], 1 if p["basis"] == "recorded" else 0, p["acres"], p["price"], p["ppa"],
                                                  p["place"], p["pt"][0] if p["pt"] else None, p["pt"][1] if p["pt"] else None,
                                                  p["flag"] or 0, 1 if p["bldg"] else 0, KIND_CODE[p["kind"]], 1 if p["cu"] else 0,
                                                  p["ri"], p["g"], p["m"]] for p in feat]}
            names, legals = names
            if d.named[st]:
                out["data/land/names/%s/%s.json" % (st.lower(), c["fips"])] = dump(dict({"fips": c["fips"], "sales": names}, **({"legals": legals} if legals else {})))
            out["land-sales/%s/%s.html" % (SLUG[st], slug)] = county_page(d, st, c, allp, u, n12, summ, early, latest, W, k24, n12all)
            cu = st == "VT"      # Vermont's list carries current use enrollment as a last column
            out["data/land-sales/%s/%s.json" % (st.lower(), c["fips"])] = dump(
                dict({"st": st, "fips": c["fips"], "county": c["name"], "through": through, "names": "/data/land/names/%s/%s.json" % (st.lower(), c["fips"]) if d.named[st] else None,
                 "kinds": {v: KIND_WORDS[k] for k, v in KIND_CODE.items()}, "cols": LIST_COLS + (["cu"] if cu else []) + DETAIL_COLS,
                 "usual": usual_list(u), "w24": W["w24"], "lx": {p["id"]: p["lx"] for p in allp if p.get("lx")},
                 "rec": rec_ok(d, st, c["fips"]),
                 "s": [[p["id"], p["when"], 1 if p["basis"] == "recorded" else 0, p["acres"], p["price"], p["ppa"], p["place"],
                        KIND_CODE[p["kind"]], p["flag"] or 0] + ([1 if p["cu"] else 0] if cu else []) + [p["ri"], p["g"], p["m"]] for p in allp]},
                     **({"dates": "month"} if dm else {})))
            urls.append(("%s/land-sales/%s/%s" % (ORIGIN, SLUG[st], slug), d.fetched[st]))
        sfile["cols"] = ["id", "when", "recorded", "acres", "price", "ppa", "place", "lat", "lng", "flag", "bldg", "kind", "cu"] + DETAIL_COLS
        out["data/land-sales/%s.json" % st.lower()] = dump(sfile)
        sm = stats(lpool)
        lead["lead"][st], lead["farm_filter"][st] = lead_pick(st, lc, sm["med"] if sm else None)
        lead["farm_filter"][st]["state_med"] = sm["med"] if sm else None
    # the home page's Farmland sales block (index.html, components/home-land.js): one sale per state, by LEAD_RULE
    out["data/land-sales/lead.json"] = dump(lead)
    out["land-sales/index.html"] = index_page(d, latest, counties, early, coverage, archive, index_section(repo))
    urls = [(ORIGIN + "/land-sales/", pub)] + [("%s/land-sales/%s" % (ORIGIN, k), pub if k == key else k + "-28") for k, _ in archive] + urls
    out["sitemap-land-sales.xml"] = sitemap(urls)
    return carry(repo, d, out)


# CARRY (Nov 5, 2026). A hosted state's county files (Florida, build_land_summary.HOSTED) are on agsist-data, not in
# this repository; only land-data.yml puts a copy at data/land-hosted/. A build without that copy (the PR checks, the
# main-checks rebuild, a local run) keeps every committed Florida output as it is, and the pages that mix the states
# (the hub, the monthly update, the sitemap, the home lead, latest.json) too, so a build from a part of the data never
# rewrites them. The next land-data run, with the copy, rebuilds them all.
CROSS = ("land-sales/index.html", "sitemap-land-sales.xml", "data/land-sales/lead.json", "data/land-sales/latest.json")


def carried_states(repo, d):
    """The hosted states with committed pages whose county files are not in this copy."""
    return [st for st in STATES if st in BLS.HOSTED and st not in d.states and (Path(repo) / "data" / "land-sales" / ("%s.json" % st.lower())).is_file()]


def carry(repo, d, out):
    repo = Path(repo)
    gone = carried_states(repo, d)
    if not gone:
        return out
    for st in gone:
        for folder, pat in (("land-sales/" + SLUG[st], "*.html"), ("data/land-sales/" + st.lower(), "*.json"), ("data/land/names/" + st.lower(), "*.json")):
            for p in sorted((repo / folder).glob(pat)):
                out["%s/%s" % (folder, p.name)] = p.read_text(encoding="utf-8")
        out["data/land-sales/%s.json" % st.lower()] = (repo / "data" / "land-sales" / ("%s.json" % st.lower())).read_text(encoding="utf-8")
    month = re.compile(r"(land-sales|data/land/names)/\d{4}-\d{2}\.(html|json)$")
    for k in [k for k in out if k in CROSS or month.fullmatch(k)]:
        if (repo / k).is_file():
            out[k] = (repo / k).read_text(encoding="utf-8")
        else:
            del out[k]
    return out


def names_in(texts):
    """Every name in the names files of this build (for the leak check)."""
    out = set()
    for p, t in texts.items():
        if p.startswith("data/land/names/"):
            o = json.loads(t)
            for v in (o.get("sales") or {}).values():
                if v:
                    out.update(x for x in v if x)
            out.update(v for v in (o.get("buyers") or {}).values() if v)
    return out


def public_body(n, counties):
    """A county government as a party ("Monroe County", "County of Dane"): its name is the county's,
    printed on every page anyway, not a private name. counties: upper-case county names of the build."""
    u = re.sub(r",? (?:ILLINOIS|WISCONSIN|INDIANA)$", "", re.sub(r"\s+", " ", str(n or "").upper()).strip())
    m = re.fullmatch(r"(?:COUNTY OF ([A-Z .']+))|(?:([A-Z .']+) COUNTY)", u)
    return bool(m) and (m.group(1) or m.group(2)).strip() in counties


def leaks(texts, counties=None):
    """[(path, name)] for a name found in a file this build writes outside data/land/."""
    if counties is None:
        counties = set()
        for p, t in texts.items():
            if re.fullmatch(r"data/land-sales/[a-z]{2}\.json", p):
                counties.update(str(c.get("name") or "").upper() for c in (json.loads(t).get("counties") or {}).values())
    names = [n for n in names_in(texts) if len(n) >= 8 and not public_body(n, counties)]
    # every name is 8 characters or more: index them by their first 8, then walk each text once
    # (every county's full list made the name-by-file search too slow, Oct 29)
    by8 = {}
    for n in names:
        by8.setdefault(n[:8], []).append(n)
    bad = []
    for p, t in texts.items():
        if p.startswith("data/land/"):
            continue
        hit = set()
        for i in range(len(t) - 7):
            lst = by8.get(t[i:i + 8])
            if lst:
                hit.update(n for n in lst if t.startswith(n, i))
        bad.extend((p, n) for n in sorted(hit))
    return bad


def orphans(texts, repo=REPO):
    """names files left from a state that now names no one (its state file has names_dir null): removed on a build"""
    out = []
    for p, t in texts.items():
        m = re.fullmatch(r"data/land-sales/([a-z]{2})\.json", p)
        if m and json.loads(t).get("names_dir") is None:
            out += sorted(str(f.relative_to(repo)) for f in (Path(repo) / "data" / "land" / "names" / m.group(1)).glob("*.json"))
    return out


def main(argv):
    if "--selftest" in argv:
        return selftest()
    texts = build()
    gone = orphans(texts)
    bad = leaks(texts)
    if bad:
        print("REFUSED: a buyer or seller name would be written outside data/land/: %d (first in %s)" % (len(bad), bad[0][0]))
        return 1
    if "--check" in argv:
        stale = [p for p, t in texts.items() if not (REPO / p).exists() or (REPO / p).read_text(encoding="utf-8") != t] + gone
        if stale:
            print("land sales: %d file(s) differ from a fresh build (first: %s); run python3 scripts/build_land_sales.py" % (len(stale), stale[0]))
            return 1
        print("land sales: %d file(s) match a fresh build" % len(texts))
        return 0
    n = 0
    for p, t in texts.items():
        fp = REPO / p
        fp.parent.mkdir(parents=True, exist_ok=True)
        if not fp.exists() or fp.read_text(encoding="utf-8") != t:
            fp.write_text(t, encoding="utf-8")
            n += 1
    for p in gone:
        (REPO / p).unlink()
    print("land sales: wrote %d of %d file(s)" % (n, len(texts)) + (", removed %d names file(s) of a state that names no one" % len(gone) if gone else ""))
    return 0


# ---------------------------------------------------------------- selftest
def selftest():
    import tempfile
    fails = []

    def ck(name, cond):
        print(("ok   " if cond else "FAIL ") + name)
        if not cond:
            fails.append(name)

    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        (t / "data" / "land" / "il").mkdir(parents=True)
        (t / "data" / "land" / "wi").mkdir(parents=True)
        (t / "data" / "land-sales").mkdir(parents=True)
        (t / "grain-emc.html").write_text("<script>/* agsist-theme-early */</script><script>/* agsist-ga-guard */</script>\n  "
                                          "<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}"
                                          "gtag('js',new Date());gtag('config','G-TEST1234');</script>")
        (t / "data" / "land-sales" / "coverage.json").write_text(json.dumps(
            {"labels": {"live": "Sales on this site", "none": "No public source found"}, "note": "",
             "states": [{"st": "IL", "name": "Illinois", "status": "live", "tile": [7, 3]}, {"st": "WI", "name": "Wisconsin", "status": "live"},
                        {"st": "KS", "name": "Kansas", "status": "none"}]}))
        cols = ["doc", "date", "price", "acres", "tac", "np", "cls", "conv", "pid", "muni", "legal", "exempt", "grantor", "grantee", "ac1", "rec"]
        rows = []
        # 12 ordinary sales at about $10,000 an acre, one far above, one far below, one quit claim
        for i in range(12):
            rows.append(["D%d" % i, "2026-%02d-10" % (i % 8 + 1), 800000 + i * 10000, 80.0, None, 1, "4", "Warranty Deed", "P%d" % i, "0",
                         "SEC %d" % i, 0, "SELLER NUMBER%d" % i, "BUYER NUMBER%d" % i, None, "2026-%02d-15" % (i % 8 + 1)])
        rows.append(["DX", "2026-09-05", 2400000, 80.0, None, 1, "4", "Warranty Deed", "PX", "0", "SEC X", 0, "HIGHSELLER ONE", "BIGBUYER LLC", None, "2026-09-08"])
        rows.append(["DY", "2026-09-06", 120000, 60.0, None, 1, "4", "Warranty Deed", "PY", "0", "SEC Y", 0, "LOWSELLER TWO", "BIGBUYER LLC", None, "2026-09-09"])
        rows.append(["DZ", "2026-09-07", 500000, 50.0, None, 1, "4", "Quit Claim Deed", "PZ", "0", "SEC Z", 0, "QUIT SELLERX", "QUIT BUYERX", None, "2026-09-10"])
        for i in range(6):
            rows.append(["DS%d" % i, "2026-09-%02d" % (11 + i), 700000 + i * 20000, 70.0, None, 1, "4", "Warranty Deed", "PS%d" % i, "0",
                         "SEC S%d" % i, 0, "SEPSELLER %d" % i, "SEPBUYER %d" % i, None, "2026-09-%02d" % (12 + i)])
        f = {"state": "WI", "county": "Testa", "fips": "55999", "fetched_utc": "2026-10-18T00:00:00Z", "cols": cols, "rows": rows,
             "munis": {"0": ["Town of Test", 45.0, -91.0]}, "coverage": {"from": "2020-01-01", "to": "2026-09-30"}}
        (t / "data" / "land" / "wi" / "55999.json").write_text(json.dumps(f))
        (t / "data" / "land" / "wi" / "index.json").write_text(json.dumps(
            {"state": "WI", "fetched_utc": "2026-10-18T00:00:00Z", "counties": [{"fips": "55999", "name": "Testa", "lat": 45.0, "lng": -91.0}]}))
        texts = build(t)
        ck("month page written for September 2026", "land-sales/2026-09.html" in texts)
        ck("county page written", "land-sales/wisconsin/testa-county.html" in texts)
        ck("no name outside data/land/", not leaks(texts))
        ck("a county government as a party is not a private name", public_body("Testa County", {"TESTA"}) and public_body("COUNTY OF TESTA", {"TESTA"}) and public_body("Testa County, Wisconsin", {"TESTA"})
           and not public_body("Testa County Farms LLC", {"TESTA"}) and not public_body("Smith County", {"TESTA"}))
        allnames = names_in(texts)
        ck("names files hold the buyer and seller", "BIGBUYER LLC" in allnames and "HIGHSELLER ONE" in allnames)
        ck("a quit claim is never listed", "QUIT BUYERX" not in allnames)
        ck("a state whose file carries names keeps its names path", json.loads(texts["data/land-sales/wi.json"])["names_dir"] == "/data/land/names/wi/")
        (t / "data" / "land" / "names" / "nj").mkdir(parents=True)
        (t / "data" / "land" / "names" / "nj" / "34001.json").write_text("{}")
        ck("a names file left from a state that names no one is removed; a named state's are kept",
           orphans({"data/land-sales/nj.json": '{"names_dir": null}', "data/land-sales/wi.json": texts["data/land-sales/wi.json"]}, t)
           == ["data/land/names/nj/34001.json"])
        page = texts["land-sales/2026-09.html"]
        ck("no accusing words", not re.search(r"questionable|suspicious|fraud|shady|sham", page, re.I))
        ck("unusual price wording", "Unusual price" in page)
        ck("sections withheld with a reason when too few", "Not shown this month" in page)
        ck("no em dash", "—" not in "".join(texts.values()))
        ck("a county file that still holds names is never offered to the panel (rec 0)",
           json.loads(texts["data/land-sales/wi/55999.json"])["rec"] == 0
           and re.search(r"data-ls-c='\[\"WI\",\"55999\",[^']*,0\]'", texts["land-sales/wisconsin/testa-county.html"]) is not None)
        ck("every page carries the GA config, not only the guard (Nov 4: no land page view reached GA)",
           all("gtag('config','G-TEST1234')" in v and "agsist-ga-guard" in v for k, v in texts.items() if k.endswith(".html")))
        ck("the hub and the monthly page draw the shared US map, not a tile grid, with only states a reader can use",
           all('id="ls-map"' in texts[k] and "/components/usmap.js" in texts[k] and "ls-s ls-st-" not in texts[k]
               and "&quot;WI&quot;:[&quot;live&quot;" in texts[k] and "&quot;IL&quot;" not in texts[k] for k in ("land-sales/index.html", "land-sales/2026-09.html")))
        hub = texts["land-sales/index.html"]
        ck("no internal research status on the hub or month page (Nov 8): no 'on request', 'not built yet', 'not checked', 'not public record', no source table",
           not re.search(r"on request|for a fee|not built yet|not checked|not public record|No public source|Where each state stands|source table|The goal is every state|nondisclosure|unchecked",
                         hub + texts["land-sales/2026-09.html"], re.I) and "Kansas" not in hub)
        ck("hub order: one title, the map, the stand-out sales, the picker, then the months and the folds",
           [hub.find(x) for x in ('<h1>', 'id="ls-map"', 'id="stand-out"', 'id="ls-pick"', 'id="months"', 'id="all-states"', 'id="how-counted"')]
           == sorted(hub.find(x) for x in ('<h1>', 'id="ls-map"', 'id="stand-out"', 'id="ls-pick"', 'id="months"', 'id="all-states"', 'id="how-counted"'))
           and -1 not in [hub.find(x) for x in ('id="stand-out"', 'id="ls-pick"', 'id="months"')])
        ck("hub: the stand-out cards are distinct sales, each with acres, price, $/acre, date and a link to the county row",
           len(re.findall(r'class="ls-card" href="/land-sales/wisconsin/testa-county#s-[0-9a-f]{10}"', hub)) >= 3
           and len(set(re.findall(r'#s-([0-9a-f]{10})"', hub))) == len(re.findall(r'class="ls-card"', hub))
           and "Largest by acres" in hub and "Newest sale" in hub and re.search(r"an acre</span>", hub))
        ck("hub: every county link is in the closed All states and counties fold exactly once",
           hub.count('href="/land-sales/wisconsin/testa-county"') == 1
           and hub.index('id="all-states"') < hub.index('href="/land-sales/wisconsin/testa-county"') and '<details class="ls-all" id="all-states">' in hub)
        ck("the fixture has no private values, so the hub says nothing about them", 'id="other-evidence"' not in hub)
        lat = json.loads(texts["data/land-sales/latest.json"])
        ck("latest.json names no one", not any(n in texts["data/land-sales/latest.json"] for n in allnames))
        # one sale, linked (Nov 3): every row of the county table has id="s-<sale id>", the same on a rebuild
        cp = texts["land-sales/wisconsin/testa-county.html"]
        rids = re.findall(r'<tr id="s-([0-9a-f]{10})" data-k=', cp)
        lf = json.loads(texts["data/land-sales/wi/55999.json"])
        want = sorted(a[lf["cols"].index("id")] for a in lf["s"])      # the county's whole list (under COUNTY_ROWS here)
        ck("county page: each listed sale's row carries its id, once", len(rids) == len(set(rids)) == len(want) and sorted(rids) == want)
        ck("county page: the row ids are the same on a second build", re.findall(r'<tr id="s-([0-9a-f]{10})"', build(t)["land-sales/wisconsin/testa-county.html"]) == rids)
        ck("county page: #s-<id> marks the row (:target) and the page opens Show more for an older one",
           "tr:target" in cp and "ls-hit" in cp and "mo.click()" in cp and "<style>" in cp)
        ck("the row id is a hash, never a name or document", all(not re.search(r"[A-Z]", x) for x in rids) and not re.search(r'id="s-[^"]*(SELLER|BUYER|D\d)', cp))
        ck("latest.json month", lat["month"] == "2026-09" and lat["n"] == 8)
        # the home lead (Nov 4): the highest $/acre inside the county's usual range, never the far-off sale, no names
        ld = json.loads(texts["data/land-sales/lead.json"])
        wl = ld["lead"]["WI"]
        ck("lead.json: Wisconsin's lead is the top in-range sale (DS5, $11,429), not the far-above one",
           wl is not None and wl["ppa"] == 11429 and wl["county"] == "Testa" and wl["acres"] == 70.0)
        ck("lead.json: its county middle, sample and window", wl["n24"] >= MIN_COMPS and wl["med"] > 0 and wl["window"][1] == "2026-09-17"
           and wl["of"] >= LEAD_MIN_SALES and wl["url"].startswith("/land-sales/wisconsin/testa-county#s-") and "Wisconsin" in wl["rule"])
        ck("lead.json: a state with no sales has no lead", ld["lead"].get("IL") is None)
        ck("lead.json names no one", not any(n in texts["data/land-sales/lead.json"] for n in allnames)
           and set(wl) == {"st", "id", "county", "acres", "ppa", "when", "basis", "med", "n24", "pct", "of", "window", "url", "rule", "src"})
        thin, _ = lead_pick("WI", [(dict(p, when="2026-09-1%d" % i), {"n": 9, "med": 1}, "x") for i, p in enumerate(
            [{"kind": "farm", "ppa": 10, "flag": 0, "acres": 40, "id": "a", "county": "X", "basis": "recorded"}] * (LEAD_MIN_SALES - 1))], 10)
        ck("lead: withheld under %d sales in the window" % LEAD_MIN_SALES, thin is None)
        few, _ = lead_pick("WI", [(dict(p, when="2026-09-1%d" % i, id=str(i)), {"n": MIN_COMPS - 1, "med": 1}, "x") for i, p in enumerate(
            [{"kind": "farm", "ppa": 10, "flag": 0, "acres": 40, "county": "X", "basis": "recorded"}] * 5)], 10)
        ck("lead: withheld when the county has under %d comparable sales" % MIN_COMPS, few is None)
        # the farm-county filter: a county middle over twice the state's is skipped, and counted
        mk = lambda c, ppa, med, i: ({"kind": "farm", "ppa": ppa, "flag": 0, "acres": 80, "id": c + str(i), "county": c, "basis": "recorded",
                                      "when": "2026-09-1%d" % i}, {"n": 9, "med": med}, c.lower())
        town = [mk("Town", 40000, 30000, i) for i in range(3)] + [mk("Farm", 9000 + i, 8000, i) for i in range(3)]
        fl, fd = lead_pick("WI", town, 10000)
        ck("lead: a county whose middle is over twice the state's is skipped and counted",
           fl is not None and fl["county"] == "Farm" and fl["ppa"] == 9002 and fd == {"counties": 1, "sales": 3, "over_cap": 0} and "$10,000 an acre" in fl["rule"]
           and "more than twice the state's middle" in fl["rule"])
        hot = [mk("Farm", 25000, 9000, 7)] + [mk("Farm", 9000 + i, 9000, i) for i in range(3)]
        hl, hd = lead_pick("WI", hot, 10000)
        ck("lead: a sale over twice the state's middle is left out, in a farm county too, and counted",
           hl is not None and hl["ppa"] == 9002 and hd["over_cap"] == 1 and hd["counties"] == 0)
        nf, nd = lead_pick("WI", town[:3] + town[3:4], 10000)
        ck("lead: withheld when the filter leaves under %d sales" % LEAD_MIN_SALES, nf is None and nd["sales"] == 3)
        ck("lead: the rule says 20-acre county sales, recorded or sold, and no sale under 3",
           "at least 5 bare farmland sales of 20 acres or more" in fl["rule"] and " recorded in Wisconsin " in fl["rule"]
           and "Fewer than 3 such sales: no sale shown." in fl["rule"]
           and " sold in Indiana " in lead_pick("IN", [(dict(x[0], basis="sale date"), x[1], x[2]) for x in town], 10000)[0]["rule"])
        ck("hub title is 60 characters or fewer", len(re.search(r"<title>([^<]*)</title>", texts["land-sales/index.html"]).group(1)) <= 60)
        ck("lead: withheld with no state middle to test the county against", lead_pick("WI", town, None)[0] is None)
        ck("lead.json: the farm filter's counts and the state middle are written", set(ld["farm_filter"]["WI"]) == {"counties", "sales", "over_cap", "state_med"})
        sf = json.loads(texts["data/land-sales/wi.json"])
        ck("featured rows carry the township point", sf["counties"]["55999"]["s"][0][7] == 45.0)
        # removal: the high sale's names go
        hid = [p for p in (json.loads(texts["data/land/names/2026-09.json"])["sales"])]
        x = Data(t)
        tgt = [r for c, rs in x.counties["WI"] for r in rs if r.get("doc") == "DX"][0]["_id"]
        (t / "data" / "land-sales" / "removed.json").write_text(json.dumps({"sales": [tgt]}))
        texts2 = build(t)
        ck("a removed sale keeps no names", "HIGHSELLER ONE" not in names_in(texts2) and tgt in hid)
        ck("robots-blocked folder only", all(not p.startswith("data/land-sales/") or "names" not in p for p in texts2))
    print("build_land_sales selftest:", "ok" if not fails else "%d failure(s)" % len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
