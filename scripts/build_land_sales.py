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
  land-sales/<state>/<county>.html      "Farmland sales in <County>, <State>": the latest sales
  sitemap-land-sales.xml
  data/land-sales/latest.json           the newest update in brief (homepage card, rent pages, Daily)
  data/land-sales/<st>.json             each county's latest few sales with the township point
                                        (Atlas county pages, Fast Facts within 25 miles)
  data/land/names/<st>/<fips>.json      buyer and seller for the sales on the county page
  data/land/names/<YYYY-MM>.json        buyer and seller for the sales and buyers in the update

NAMES (STANDING-DECISIONS, Oct 27): pages show the sale without names plus "Show buyer and seller";
the names load on that tap from a file under /data/land/, which robots.txt blocks; a "Remove my
name" link sits beside them. No name is ever written into a page, a sitemap, a snippet or a data
file outside data/land/ (test/land-sales.test.mjs greps every published file for every name).
A sale whose id is in data/land-sales/removed.json keeps no names at all.

WORDS: "unusual price", with plain possible reasons (family sale, part interest, buildings or timber
included); never "questionable" or any word that accuses anyone.

STATES: Illinois and Wisconsin (land_alert.STATES). Indiana is held off every page beyond Field Scout
and the comp report (Sig, Oct 18); the coverage table says so. data/land-sales/coverage.json is the
per-state source table, kept by hand; this script only draws it and counts the states with sales.

HONEST NUMBERS: a section with too few sales is withheld and says why. "Usual" is the county's
middle half of $/acre over the 24 months ending with the month (market sales of 20+ acres, known
acres, $500 an acre or more), n shown; a sale is unusual when it is more than 1.5 middle-halves past
either end (the Atlas rule), judged only with 5 or more such sales. A month is written only when
every state's files were fetched after it ended.

  python3 scripts/build_land_sales.py           write everything
  python3 scripts/build_land_sales.py --check   build to memory, compare with the committed files
  python3 scripts/build_land_sales.py --selftest
"""
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

ORIGIN = "https://agsist.com"
STATES = LA.STATES
SLUG = LA.STATE_SLUGS
NAME = LA.STATE_NAMES
LIST_MIN_ACRES = LA.LIST_MIN_ACRES      # 10: a listed sale
COMP_MIN_ACRES = BLS.MIN_ACRES          # 20: a sale that sets or is judged against the usual price
MIN_COMPS = BLS.MIN_N                   # 5 comparable sales before anything is called unusual
COUNTY_ROWS = 25                        # rows on a county page
FEATURED = 6                            # rows per county in data/land-sales/<st>.json
TOP = 10                                # rows in a monthly table
TOP_BUYERS = 8
TOP_SALES = 6
MIN_LISTED = 3                          # biggest sales withheld under this many listed sales
MIN_BUYERS = 5                          # buyers withheld under this many distinct buyers
MIN_JUDGED = 10                         # unusual and best value withheld under this many judged sales
BEST_MIN_ACRES = 40
CSS = '<link rel="stylesheet" href="/components/land-sales.css?v=1">'
JS = '<script src="/components/land-sales.js?v=1" defer></script>'
REMOVE_TO = "sig@agsist.com"            # the site's own contact address (contact.html)

UP_WHY = "a house or buildings, timber or hunting ground, a building site or development land, or a neighbor paying more for the piece next door"
DOWN_WHY = "a family or neighbor sale, a part interest, wooded, wet or poorer ground, no road access, or a land contract"


def e(s):
    return html.escape("" if s is None else str(s), quote=True)


def money(x):
    return "$" + format(int(BLS.js_round(x)), ",")


def acres(a):
    return LA.acres_text(a)


def day(iso):
    return LA.long_day(iso)


def county_slug(name):
    return re.sub(r"[^a-z0-9]+", "-", str(name or "").lower()).strip("-") + "-county"


def sale_id(st, r):
    """Opaque and stable: the state, county, document and date of the first deed of the sale."""
    k = "|".join(str(x) for x in (st, r.get("fips"), r.get("doc"), str(r.get("date") or "")[:10], BLS.js_round(BLS.num(r.get("price")) or 0)))
    return hashlib.sha1(k.encode("utf-8")).hexdigest()[:10]


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
    comp = [r for r in rows if BLS.inw(r, w24) and BLS.stat_ok(r) and (BLS.num(r.get("acres")) or 0) >= COMP_MIN_ACRES
            and r.get("_id") != skip_id]
    s = stats([r["ppa"] for r in comp])
    if not s or s["n"] < MIN_COMPS:
        return None
    iqr = s["q3"] - s["q1"]
    s["lo"], s["hi"] = BLS.js_round(s["q1"] - 1.5 * iqr), BLS.js_round(s["q3"] + 1.5 * iqr)
    return s


def judge(r, u):
    """+1 above the usual range, -1 below, 0 inside, None when it cannot be judged."""
    if not u or not BLS.stat_ok(r) or (BLS.num(r.get("acres")) or 0) < COMP_MIN_ACRES:
        return None
    if r["ppa"] > u["hi"]:
        return 1
    if r["ppa"] < u["lo"]:
        return -1
    return 0


def with_bldg(r):
    return "with buildings" in str(r.get("conv") or "").lower()


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
        for st in self.states:
            lst = []
            for c in self.land.index(st).get("counties") or []:
                rows = self.land.sales(st, c["fips"], self.today[st])
                for r in rows:
                    r["_id"] = sale_id(st, r)
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
            return None


def latest_month(d):
    """(year, m0) of the newest month every state was fetched after."""
    f = min(d.fetched.values())
    dt = datetime.date.fromisoformat(f)
    first = dt.replace(day=1) - datetime.timedelta(days=1)
    return first.year, first.month - 1


def shown_day(r):
    """The day a page shows: the recorded (filed) day when the state file carries it, else the deed date."""
    return r["when"] or str(r.get("date") or "")[:10] or None


def pub_row(st, r, county, u=None):
    """The only shape a sale is published in: no names, parcel, legal or document."""
    a = BLS.num(r.get("acres"))
    rec = bool(r["has_rec"] and r["when"])
    return {"id": r["_id"], "st": st, "fips": r.get("fips"), "county": county, "place": r.get("muniName") or None,
            "when": shown_day(r), "basis": "recorded" if rec else "sale date",
            "acres": round(a, 2) if a is not None else None, "price": BLS.js_round(BLS.num(r.get("price")) or 0),
            "ppa": r.get("ppa"), "pt": [round(r["pt"][0], 4), round(r["pt"][1], 4)] if r.get("pt") else None,
            "bldg": with_bldg(r), "flag": judge(r, u)}


# ---------------------------------------------------------------- the monthly update
def month_build(d, year, m0):
    first, last = LA.month_bounds(year, m0)
    key = "%04d-%02d" % (year, m0 + 1)
    W = LA.windows(year, m0)
    listed, buyers, judged, names_s, names_b = [], {}, [], {}, {}
    per_state = {st: {"n": 0, "basis": None, "fresh": True} for st in d.states}
    for st in d.states:
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
                p = pub_row(st, r, c["name"], u)
                p["usual"] = {"med": u["med"], "q1": u["q1"], "q3": u["q3"], "n": u["n"]} if u else None
                listed.append(p)
                per_state[st]["n"] += 1
                per_state[st]["basis"] = p["basis"]
                nm = d.names(r)
                names_s[p["id"]] = nm
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
    out = {"month": key, "label": "%s %d" % (LA.MONTHS[m0], year), "states": d.states,
           "fetched": d.fetched, "window": W["w24"], "per_state": per_state, "n": len(listed)}
    out["fresh"] = all(v["fresh"] for v in per_state.values())
    out["biggest"] = listed[:TOP_SALES] if len(listed) >= MIN_LISTED else None
    out["biggest_acres"] = by_acres[:TOP_SALES] if len(listed) >= MIN_LISTED else None
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
    used = {p["id"] for k in ("biggest", "biggest_acres", "unusual", "best") for p in (out.get(k) or [])}
    names = {"month": key, "sales": {i: names_s[i] for i in sorted(used)},
             "buyers": {b["id"]: names_b[b["id"]] for k in ("buyers_acres", "buyers_dollars") for b in (out.get(k) or [])}}
    return out, names


# ---------------------------------------------------------------- per county
def county_build(d, st, c, rows, through):
    """(featured rows, county page rows, names) for one county."""
    W = BLS.windows(datetime.date.fromisoformat(through))
    u = usual(rows, W["w24"])
    lst = [r for r in rows if shown_day(r) and shown_day(r) <= d.today[st] and (BLS.num(r.get("acres")) or 0) >= LIST_MIN_ACRES]
    # newest first by the date the page shows (recorded, else the deed date)
    lst.sort(key=lambda r: (shown_day(r), r["_id"]), reverse=True)
    page = [pub_row(st, r, c["name"], u) for r in lst[:COUNTY_ROWS]]
    w12 = W["cur"]
    names = {}
    for p, r in zip(page, lst[:COUNTY_ROWS]):
        names[p["id"]] = d.names(r)
    feat = [p for p in page if p["when"] >= w12[0]][:FEATURED]
    return feat, page, names, u, len([r for r in rows if BLS.inw({"date": shown_day(r)}, w12) and (BLS.num(r.get("acres")) or 0) >= LIST_MIN_ACRES])


# ---------------------------------------------------------------- html
def early_scripts():
    src = open(REPO / "farmland-index.html", encoding="utf-8").read()
    m = re.search(r"<script>/\* agsist-theme-early.*?</script><script>/\* agsist-ga-guard.*?</script>", src, re.S)
    return m.group(0) if m else ""


def head(title, desc, url, ld, early):
    ldh = "".join('<script type="application/ld+json">' + json.dumps(x, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/") + "</script>" for x in ld)
    return ("<!DOCTYPE html>\n<html lang=\"en\" data-theme=\"dark\">\n<head>\n"
            '<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n'
            '<meta name="theme-color" content="#0a0c0d">\n<link rel="stylesheet" href="/components/styles.css?v=26">\n' + CSS + "\n"
            '<link rel="icon" href="/img/favicon.ico" sizes="32x32">\n<link rel="icon" type="image/svg+xml" href="/img/icon.svg">\n'
            "<title>%s</title>\n<meta name=\"description\" content=\"%s\">\n"
            '<meta name="robots" content="index, follow, max-snippet:-1">\n<link rel="canonical" href="%s">\n'
            '<meta property="og:type" content="article">\n<meta property="og:site_name" content="AGSIST">\n'
            '<meta property="og:title" content="%s">\n<meta property="og:description" content="%s">\n<meta property="og:url" content="%s">\n'
            '<meta property="og:image" content="https://agsist.com/img/og/agsist.jpg">\n'
            "%s\n%s\n</head>\n<body>\n<a href=\"#main\" class=\"skip\">Skip to content</a>\n<div id=\"site-header\"></div>\n"
            '<main id="main" class="main ls" tabindex="-1">\n'
            % (e(title), e(desc), url, e(title.replace(" | AGSIST", "")), e(desc), url, early, ldh))


FOOT = ("</main>\n<div id=\"site-footer\"></div>\n<script src=\"/components/loader.js?v=19\" defer></script>\n" + JS + "\n</body>\n</html>\n")


def crumbs(items):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": u} for i, (n, u) in enumerate(items)]}


def names_btn(sid, file, what="buyer and seller"):
    return ('<button type="button" class="ls-nm" data-ls-id="%s" data-ls-f="%s">Show %s</button>' % (e(sid), e(file), e(what)))


def flag_words(p):
    if p.get("flag") == 1:
        return "Unusual price: above the county's usual"
    if p.get("flag") == -1:
        return "Unusual price: below the county's usual"
    return ""


def sale_table(rows, names_file, cols=("when", "where", "acres", "price", "ppa", "note"), caption=None, county_link=None):
    th = {"when": "Date", "where": "Where", "acres": "Acres", "price": "Price", "ppa": "$/acre", "note": "Note", "usual": "County usual $/acre"}
    num = {"acres", "price", "ppa", "usual"}
    h = ['<div class="ls-tw"><table class="ls-t">']
    if caption:
        h.append("<caption>%s</caption>" % e(caption))
    h.append("<thead><tr>" + "".join('<th scope="col"%s>%s</th>' % (' class="n"' if c in num else "", th[c]) for c in cols)
             + '<th scope="col">Names</th></tr></thead><tbody>')
    for p in rows:
        tds = []
        for c in cols:
            if c == "when":
                v = LA.short_day(p["when"]) + ", " + p["when"][:4] + ("" if p["basis"] == "recorded" else "*")
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
            elif c == "usual":
                u = p.get("usual")
                v = ("%s (%s to %s, %d sales)" % (money(u["med"]), money(u["q1"]), money(u["q3"]), u["n"])) if u else ""
            else:
                v = "; ".join(x for x in (flag_words(p), "with buildings" if p.get("bldg") else "") if x)
            tds.append('<td%s>%s</td>' % (' class="n"' if c in num else "", e(v)))
        tds.append("<td>%s</td>" % names_btn(p["id"], names_file))
        h.append("<tr>" + "".join(tds) + "</tr>")
    h.append("</tbody></table></div>")
    return "".join(h)


def src_line(d, states):
    parts = []
    for st in states:
        parts.append("%s, read %s" % (LA.SOURCES[st], day(d.fetched[st])))
    return "Source: " + "; ".join(parts) + "."


RULE = ("A sale is listed when it carries a price and acres and a whole interest changed hands in a normal sale: gifts, family and "
        "related-party sales, quit claims, foreclosures and the like are left out, the same rule as Field Scout and the Farmland Atlas. "
        "Township and town are where the state places the sale; no parcel is pinned. None of this is an appraisal.")
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


def month_page(d, M, early, coverage, archive):
    key, lab = M["month"], M["label"]
    url = "%s/land-sales/%s" % (ORIGIN, key)
    nf = "/data/land/names/%s.json" % key
    sts = " and ".join(NAME[s] for s in M["states"])
    title = "Farmland sales, %s: biggest buyers and sales in %s | AGSIST" % (lab, sts)
    big = M.get("biggest") or []
    desc = ("%d farm sales of %d acres or more in %s, %s: the biggest buyers and sales, unusual prices and the best value per acre, "
            "from the state transfer records." % (M["n"], LIST_MIN_ACRES, sts, lab))
    ld = [crumbs([("AGSIST", ORIGIN + "/"), ("Farmland sales", ORIGIN + "/land-sales/"), (lab, url)]),
          {"@context": "https://schema.org", "@type": "Article", "headline": "Farmland sales, " + lab, "url": url,
           "datePublished": max(d.fetched.values()), "author": {"@type": "Person", "name": "Sigurd Lindquist", "url": ORIGIN + "/about"}}]
    cl = county_link_fn(d.repo)
    b = [head(title, desc, url, ld, early), '<div class="ls-w">',
         '<nav class="ls-bc" aria-label="Breadcrumb"><a href="/land-sales/">Farmland sales</a> / %s</nav>' % e(lab),
         "<h1>Farmland sales, %s</h1>" % e(lab)]
    lead = []
    for st in M["states"]:
        ps = M["per_state"][st]
        lead.append("%d in %s%s" % (ps["n"], NAME[st], " (by deed date)" if ps["basis"] == "sale date" else ""))
    b.append('<p class="ls-ans">%d farm sales of %d acres or more were recorded in %s: %s. %s</p>'
             % (M["n"], LIST_MIN_ACRES, e(lab), e(", ".join(lead)),
                lead_big(M)))
    if any(M["per_state"][s]["basis"] == "sale date" for s in M["states"]):
        b.append('<p class="ls-fine">* %s sales are dated by the deed for now, so a sale signed late in the month may still be filed after this was read and show up next month.</p>'
                 % " and ".join(NAME[s] for s in M["states"] if M["per_state"][s]["basis"] == "sale date"))
    b.append('<div class="ls-ask"><div data-land-alert data-source="page:land-sales-month"></div></div>')
    # buyers
    b.append('<h2 id="buyers">Biggest buyers</h2>')
    if M.get("buyers_acres"):
        b.append("<p>Buyers named on the month's sales, all their purchases added up within a state. Names load when you tap.</p>")
        for k, cap in (("buyers_acres", "Most acres bought"), ("buyers_dollars", "Most dollars spent")):
            h = ['<div class="ls-tw"><table class="ls-t"><caption>%s</caption><thead><tr><th scope="col">#</th><th scope="col">State</th>'
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
        b.append(sale_table(M["biggest_acres"], nf, caption="Most acres, %s" % lab, county_link=cl))
        b.append(sale_table(big, nf, caption="Highest price, %s" % lab, county_link=cl))
    else:
        b.append('<p class="ls-held">Not shown this month: %s.</p>' % e(M["biggest_why"]))
    # unusual
    b.append('<h2 id="unusual">Unusual prices</h2>')
    if M.get("unusual") is not None:
        b.append("<p>Sales of %d acres or more whose price per acre sits well outside what land usually brings in that county: more than one and a half "
                 "middle-halves above or below the middle half of the county's sales of %d acres or more over %s to %s. The county usual and its "
                 "count are shown on each row. %d of %d sales that could be judged this month were outside.</p>"
                 % (COMP_MIN_ACRES, COMP_MIN_ACRES, e(LA.short_day(M["window"][0]) + ", " + M["window"][0][:4]),
                    e(LA.short_day(M["window"][1]) + ", " + M["window"][1][:4]), M["n_unusual"], M["n_judged"]))
        if M["unusual"]:
            b.append(sale_table(M["unusual"], nf, cols=("when", "where", "acres", "ppa", "usual", "note"), county_link=cl))
            b.append('<p class="ls-why"><b>Above the usual, possible reasons:</b> %s. <b>Below, possible reasons:</b> %s. '
                     "The return does not say which, and a price is not wrong because it is unusual.</p>" % (e(UP_WHY), e(DOWN_WHY)))
        else:
            b.append("<p>None this month.</p>")
    else:
        b.append('<p class="ls-held">Not shown this month: %s.</p>' % e(M["unusual_why"]))
    # best value
    b.append('<h2 id="value">Best value per acre</h2>')
    if M.get("best"):
        b.append("<p>Sales of %d acres or more priced lowest against their county's middle price, leaving out the unusual prices above and anything "
                 "more than half a middle-half under the county's middle half. "
                 "The record has no soil, tillable acres, buildings or drainage, so a low price can just mean poorer ground.</p>" % BEST_MIN_ACRES)
        b.append(sale_table(M["best"], nf, cols=("when", "where", "acres", "ppa", "usual", "note"), county_link=cl))
    else:
        b.append('<p class="ls-held">Not shown this month: %s.</p>' % e(M["best_why"]))
    b.append('<p class="ls-fine">%s</p><p class="ls-fine">%s %s</p>' % (e(NAMES_NOTE), e(RULE), e(src_line(d, M["states"]))))
    b.append(coverage_html(coverage, d))
    if archive:
        b.append('<h2 id="earlier">Other months</h2><p>%s</p>' % " &middot; ".join('<a href="/land-sales/%s">%s</a>' % (k, e(v)) for k, v in archive if k != key))
    b.append('<p><a href="/land-sales/">Farmland sales by county</a> &middot; <a href="/comp-report">Comparable sales report</a> &middot; <a href="/field-scout">Field Scout</a></p>')
    b.append("</div>")
    return "\n".join(b) + "\n" + FOOT


def coverage_html(cov, d):
    rows = cov.get("states") or []
    n = sum(1 for r in rows if r.get("status") == "live")
    live = [r["name"] for r in rows if r.get("status") == "live"]
    h = ['<h2 id="coverage">Where the sales come from</h2>',
         '<p class="ls-cov-n">Sales reported for %d states: %s. The goal is every state; below is where each one stands.</p>' % (n, e(" and ".join(live))),
         '<div class="ls-map" role="img" aria-label="Map of states by whether their farm sales are on this site">']
    for r in rows:
        if r.get("tile"):
            h.append('<span class="ls-s ls-st-%s" style="grid-column:%d;grid-row:%d" title="%s">%s</span>'
                     % (e(r["status"]), r["tile"][0], r["tile"][1], e(r["name"] + ": " + cov["labels"].get(r["status"], r["status"])), e(r["st"])))
    h.append("</div>")
    h.append('<p class="ls-key">' + " ".join('<span class="ls-k ls-st-%s"></span> %s' % (k, e(v)) for k, v in cov["labels"].items()) + "</p>")
    h.append('<details class="ls-src"><summary>The source table, state by state</summary><div class="ls-tw"><table class="ls-t"><thead><tr>'
             '<th scope="col">State</th><th scope="col">On this site</th><th scope="col">Source</th><th scope="col">Names in the source</th>'
             '<th scope="col">How often</th><th scope="col">Terms</th></tr></thead><tbody>')
    for r in rows:
        h.append("<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>"
                 % (e(r["name"]), e(cov["labels"].get(r["status"], r["status"])), e(r.get("source") or ""), e(r.get("names") or ""),
                    e(r.get("cadence") or ""), e(r.get("terms") or "")))
    h.append("</tbody></table></div><p class=\"ls-fine\">%s</p></details>" % e(cov.get("note") or ""))
    return "\n".join(h)


def county_page(d, st, c, page, u, n12, summ, early, latest):
    s = SLUG[st]
    slug = county_slug(c["name"])
    url = "%s/land-sales/%s/%s" % (ORIGIN, s, slug)
    nf = "/data/land/names/%s/%s.json" % (st.lower(), c["fips"])
    cn = "%s County, %s" % (c["name"], NAME[st])
    title = "Farmland Sales in %s: Recent Sales and Price per Acre | AGSIST" % cn
    cs = (summ or {}).get("counties", {}).get(c["fips"]) or {}
    med = cs.get("med")
    if med:
        mid = "The middle price of %d sales of %d acres or more over the last 12 months was %s an acre (middle half %s to %s)." % (
            med["n"], COMP_MIN_ACRES, money(med["med"]), money(med["q1"]), money(med["q3"]))
    else:
        mid = "Too few sales of %d acres or more in the last 12 months for a middle price." % COMP_MIN_ACRES
    desc = "Recorded farm sales in %s: date, township, acres, price and price per acre. %d sales of %d acres or more in the last 12 months. %s" % (
        cn, n12, LIST_MIN_ACRES, mid)
    ld = [crumbs([("AGSIST", ORIGIN + "/"), ("Farmland sales", ORIGIN + "/land-sales/"), (NAME[st], ORIGIN + "/land-sales/#" + s), (cn, url)])]
    atlas = "/farmland-atlas/%s/%s" % (s, slug)
    has_atlas = (d.repo / "farmland-atlas" / s / (slug + ".html")).exists()
    b = [head(title, desc[:300], url, ld, early), '<div class="ls-w">',
         '<nav class="ls-bc" aria-label="Breadcrumb"><a href="/land-sales/">Farmland sales</a> / %s</nav>' % e(NAME[st]),
         "<h1>Farmland sales in %s</h1>" % e(cn),
         '<p class="ls-ans">%d farm sales of %d acres or more in the last 12 months. %s</p>' % (n12, LIST_MIN_ACRES, e(mid))]
    if latest and latest.get("month"):
        b.append('<p>All of %s and %s together: <a href="/land-sales/%s">the %s update</a>, with the biggest buyers and unusual prices.</p>'
                 % (e(NAME["IL"]), e(NAME["WI"]), latest["month"], e(latest["label"])))
    b.append('<div class="ls-ask"><div data-land-alert data-source="page:land-sales-county"></div></div>')
    b.append("<h2>The latest sales</h2>")
    if page:
        b.append(sale_table(page, nf, caption="Newest first, %s" % cn))
        if any(p["basis"] == "sale date" for p in page):
            b.append('<p class="ls-fine">* Dated by the deed; the state file this was read from does not carry the recording date for these rows.</p>')
        if u:
            b.append("<p>Usual here: %s an acre, the middle of %d sales of %d acres or more over the last 24 months (middle half %s to %s). "
                     "A sale marked unusual sits well outside that; possible reasons above the usual: %s; below: %s.</p>"
                     % (money(u["med"]), u["n"], COMP_MIN_ACRES, money(u["q1"]), money(u["q3"]), e(UP_WHY), e(DOWN_WHY)))
    else:
        b.append('<p class="ls-held">No sales of %d acres or more on file for this county yet.</p>' % LIST_MIN_ACRES)
    b.append('<p class="ls-fine">%s</p><p class="ls-fine">%s %s</p>' % (e(NAMES_NOTE), e(RULE), e(src_line(d, [st]))))
    links = []
    if has_atlas:
        links.append('<a href="%s">%s in the Farmland Atlas</a>' % (atlas, e(c["name"] + " County")))
    links.append('<a href="/field-scout?fips=%s">Every sale on a map in Field Scout</a>' % c["fips"])
    links.append('<a href="/comp-report">Comparable sales report</a>')
    links.append('<a href="/land-sales/">Other counties</a>')
    b.append("<p>" + " &middot; ".join(links) + "</p></div>")
    return "\n".join(b) + "\n" + FOOT


def index_page(d, latest, counties, early, coverage, archive):
    url = ORIGIN + "/land-sales/"
    title = "Farmland Sales by County: Illinois and Wisconsin Recorded Sales | AGSIST"
    desc = "Recorded farm sales by county with acres, price and price per acre, a monthly update of the biggest buyers and sales, and where every state's sales come from."
    ld = [crumbs([("AGSIST", ORIGIN + "/"), ("Farmland sales", url)])]
    b = [head(title, desc, url, ld, early), '<div class="ls-w">', "<h1>Farmland sales</h1>"]
    if latest:
        big = latest.get("top") or []
        b.append('<p class="ls-ans">The %s update: %d farm sales of %d acres or more in %s.%s <a href="/land-sales/%s">See the biggest buyers, sales and unusual prices</a>.</p>'
                 % (e(latest["label"]), latest["n"], LIST_MIN_ACRES, e(" and ".join(NAME[s] for s in latest["states"])),
                    (" The largest by acres: %s acres in %s County, %s, for %s." % (acres(big[0]["acres"]), e(big[0]["county"]), big[0]["st"], money(big[0]["price"]))) if big else "",
                    latest["month"]))
    b.append('<div class="ls-ask"><div data-land-alert data-source="page:land-sales"></div></div>')
    for st in d.states:
        b.append('<h2 id="%s">%s</h2><ul class="ls-cos">' % (SLUG[st], e(NAME[st])))
        for name, slug, n in counties[st]:
            b.append('<li><a href="/land-sales/%s/%s">%s County</a> <span>%d</span></li>' % (SLUG[st], slug, e(name), n))
        b.append("</ul>")
    b.append('<p class="ls-fine">The number beside each county: sales of %d acres or more in the last 12 months.</p>' % LIST_MIN_ACRES)
    b.append(coverage_html(coverage, d))
    if archive:
        b.append('<h2 id="months">Monthly updates</h2><p>%s</p>' % " &middot; ".join('<a href="/land-sales/%s">%s</a>' % (k, e(v)) for k, v in archive))
    b.append('<p class="ls-fine">%s %s</p></div>' % (e(RULE), e(src_line(d, d.states))))
    return "\n".join(b) + "\n" + FOOT


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
    early = early_scripts()
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
        latest = {"month": key, "label": M["label"], "url": "/land-sales/" + key, "published": pub, "states": d.states,
                  "n": M["n"], "per_state": {s: M["per_state"][s]["n"] for s in d.states}, "top": top,
                  "n_unusual": M["n_unusual"], "n_buyers": M["n_buyers"],
                  "sources": {s: LA.SOURCES[s] for s in d.states}, "fetched": d.fetched}
        out["land-sales/%s.html" % key] = month_page(d, M, early, coverage, archive)
        out["data/land/names/%s.json" % key] = dump(mnames)
        out["data/land-sales/latest.json"] = dump(latest)
    urls = []
    counties = {}
    for st in d.states:
        summ = d.summary(st)
        through = (summ or {}).get("through") or BLS.month_end_before(d.fetched[st]).isoformat()
        sfile = {"state": st, "name": NAME[st], "through": through, "fetched": d.fetched[st], "source": LA.SOURCES[st],
                 "names_dir": "/data/land/names/%s/" % st.lower(), "counties": {}}
        counties[st] = []
        for c, rows in d.counties[st]:
            feat, page, names, u, n12 = county_build(d, st, c, rows, through)
            slug = county_slug(c["name"])
            counties[st].append((c["name"], slug, n12))
            sfile["counties"][c["fips"]] = {"name": c["name"], "slug": slug, "ll": [c["lat"], c["lng"]], "n12": n12,
                                           "usual": {"med": u["med"], "n": u["n"]} if u else None,
                                           "s": [[p["id"], p["when"], 1 if p["basis"] == "recorded" else 0, p["acres"], p["price"], p["ppa"],
                                                  p["place"], p["pt"][0] if p["pt"] else None, p["pt"][1] if p["pt"] else None,
                                                  p["flag"] or 0, 1 if p["bldg"] else 0] for p in feat]}
            out["data/land/names/%s/%s.json" % (st.lower(), c["fips"])] = dump({"fips": c["fips"], "sales": names})
            out["land-sales/%s/%s.html" % (SLUG[st], slug)] = county_page(d, st, c, page, u, n12, summ, early, latest)
            urls.append(("%s/land-sales/%s/%s" % (ORIGIN, SLUG[st], slug), d.fetched[st]))
        sfile["cols"] = ["id", "when", "recorded", "acres", "price", "ppa", "place", "lat", "lng", "flag", "bldg"]
        out["data/land-sales/%s.json" % st.lower()] = dump(sfile)
    out["land-sales/index.html"] = index_page(d, latest, counties, early, coverage, archive)
    urls = [(ORIGIN + "/land-sales/", pub)] + [("%s/land-sales/%s" % (ORIGIN, k), pub if k == key else k + "-28") for k, _ in archive] + urls
    out["sitemap-land-sales.xml"] = sitemap(urls)
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


def leaks(texts):
    """[(path, name)] for a name found in a file this build writes outside data/land/."""
    names = [n for n in names_in(texts) if len(n) >= 8]
    bad = []
    for p, t in texts.items():
        if p.startswith("data/land/"):
            continue
        for n in names:
            if n in t:
                bad.append((p, n))
    return bad


def main(argv):
    if "--selftest" in argv:
        return selftest()
    texts = build()
    bad = leaks(texts)
    if bad:
        print("REFUSED: a buyer or seller name would be written outside data/land/: %d (first in %s)" % (len(bad), bad[0][0]))
        return 1
    if "--check" in argv:
        stale = [p for p, t in texts.items() if not (REPO / p).exists() or (REPO / p).read_text(encoding="utf-8") != t]
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
    print("land sales: wrote %d of %d file(s)" % (n, len(texts)))
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
        (t / "farmland-index.html").write_text("<script>/* agsist-theme-early */</script><script>/* agsist-ga-guard */</script>")
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
        allnames = names_in(texts)
        ck("names files hold the buyer and seller", "BIGBUYER LLC" in allnames and "HIGHSELLER ONE" in allnames)
        ck("a quit claim is never listed", "QUIT BUYERX" not in allnames)
        page = texts["land-sales/2026-09.html"]
        ck("no accusing words", not re.search(r"questionable|suspicious|fraud|shady|sham", page, re.I))
        ck("unusual price wording", "Unusual price" in page)
        ck("sections withheld with a reason when too few", "Not shown this month" in page)
        ck("no em dash", "—" not in "".join(texts.values()))
        lat = json.loads(texts["data/land-sales/latest.json"])
        ck("latest.json names no one", not any(n in texts["data/land-sales/latest.json"] for n in allnames))
        ck("latest.json month", lat["month"] == "2026-09" and lat["n"] == 8)
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
