#!/usr/bin/env python3
"""build_search_index.py -- the site search index, from the repo's own files.

Writes two files that components/search.js loads only when a reader opens
search (never on page load):

  data/search-index.json      pages, states, towns, counties, futures
  data/search-elevators.json  elevator names + town (loaded on first search)

WHERE EACH PART COMES FROM (nothing is fetched; every entry points at a page
that exists in this checkout)
  pages     PAGES below: a plain title and the words a farmer would type.
            Any other top-level page that is indexable and not listed here is
            added with its <title>, and named on stderr so it gets a proper
            entry.
  states    basis/, rent/, yield/, hail-map/, cash-bids/<state>/,
            farmland-atlas/<state>/ pages that exist and are not noindex
  towns     cash-bids/<state>/<town>.html (title "Cash Grain Bids in X, ST")
  counties  farmland-atlas/data/counties-index.json, kept only where the page
            exists and is not noindex
  futures   data/prices.json quote keys with a contract month (corn-dec26),
            linked to the page that shows that contract
  elevators names on the town pages (bid boards and "no current bid" lists),
            then data/elevator-directory.json facilities in a town with a page
            (or a ZIP, linked to the live /cash-bids?zip= search)

No price, basis or other number is put in the index: titles are plain names,
so a result never shows a stale figure.

Entry shape (arrays keep it small): [type, title, sub, url, keywords]
  type: 0 page, 1 state page, 2 town, 3 county, 4 futures, 5 elevator

Usage:
  python3 scripts/build_search_index.py            # write both files
  python3 scripts/build_search_index.py --check    # fail if the files are stale
"""
import argparse
import glob
import gzip
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_MAIN = "data/search-index.json"
OUT_ELEV = "data/search-elevators.json"
MAX_MAIN_GZ = 150 * 1024
MAX_ELEV_GZ = 150 * 1024

STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia",
    "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
SLUG_TO_ABBR = {re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-"): a for a, n in STATES.items()}

# path, plain title, short line, keywords (synonyms a farmer would type)
PAGES = [
    ("/", "Home", "Prices, bids and today's numbers", "home start corn soybean wheat prices today"),
    ("/markets", "All markets", "Every quote on one page", "markets quotes futures prices board grain livestock hogs oats meal soyoil"),
    ("/corn-futures-prices", "Corn futures", "CBOT corn quotes", "corn futures cbot zc price prices dec december"),
    ("/soybean-futures-prices", "Soybean futures", "CBOT soybean quotes", "soybeans soybean beans soy futures cbot zs price nov november meal soyoil oil"),
    ("/wheat-futures-prices", "Wheat futures", "CBOT and KC wheat quotes", "wheat futures srw hrw kc kansas city zw ke price"),
    ("/cattle-futures-prices", "Cattle futures", "Live and feeder cattle", "cattle live feeder feeders futures cme le gf beef steers"),
    ("/milk-prices", "Milk prices", "How the milk check is priced", "milk dairy class iii class iv check price futures dc cheese"),
    ("/basis", "Basis vs normal", "Is basis weak or strong", "basis normal weak strong regions"),
    ("/cash-bids", "Cash bids near you", "Elevator bids by ZIP", "cash bids elevator elevators prices near me zip local grain bid"),
    ("/cash-bids-national", "National basis by state", "Basis in every state", "national basis state states cash bids"),
    ("/elevators", "Elevator coverage map", "Which elevators we read", "elevators coverage map network boards"),
    ("/cot", "COT report", "What the funds hold", "cot cftc commitment traders funds managed money positions"),
    ("/storage-crunch", "Storage crunch", "Grain grown vs storage", "storage bins space crunch capacity"),
    ("/ag-odds", "Prediction markets", "Daily odds board", "odds prediction markets kalshi polymarket bets"),
    ("/tariffs", "Tariff tracker", "Trade policy and grain", "tariffs trade china exports policy"),
    ("/farm-bill", "Farm bill", "Status and the money", "farm bill congress policy payments arc plc"),
    ("/usda-calendar", "USDA report calendar", "Next WASDE and reports", "usda calendar wasde reports schedule crop progress acreage stocks"),
    ("/whats-priced-in", "What's priced in", "Report expectations", "wasde expectations priced in estimates trade guesses"),
    ("/whats-priced-in#analyst-board", "Analyst estimates", "Trade estimates for USDA reports", "analyst estimates trade guesses wasde"),
    ("/usda-quick-stats", "USDA crop data", "Yields by state", "usda nass quick stats yields acres production data"),
    ("/breakeven", "Break-even calculator", "Cost per bushel", "breakeven break even cost bushel calculator profit"),
    ("/presell-calculator", "Pre-sell calculator", "Sell ahead with crop insurance", "presell pre sell forward contract insurance calculator hedge"),
    ("/arc-plc", "ARC or PLC, 2026 and 2027", "Reference prices and FSA county benchmarks", "arc plc arc-co price loss coverage agriculture risk coverage effective reference price benchmark yield base acres fsa farm program 2026 2027 signup calculator sco"),
    ("/grain-bin-calculator", "Grain bin calculator", "Bushels and shrink", "grain bin bushels capacity moisture shrink calculator dryer"),
    ("/harvest-price-tracker", "Harvest price tracker", "Crop insurance harvest price", "harvest price projected crop insurance rma tracker"),
    ("/farmland-atlas", "Farmland Atlas", "Land value, rent and risk by county", "farmland atlas land value values county rent rents cash rent risk acre tenure rented owned landlord ownership"),
    ("/rent/", "Cash rent by state", "Rent by county", "cash rent rents rental county land acre lease"),
    ("/cash-lease", "Cash farm lease form", "Free printable lease", "cash lease form farm lease printable template contract rent"),
    ("/foreign-land", "Foreign-owned land", "By county", "foreign owned land afida ownership"),
    ("/spray", "Spray advisory", "Can I spray today", "spray spraying sprayer wind drift inversion herbicide tank mix weather"),
    ("/urea", "Urea risk", "Volatilization and N loss", "urea nitrogen volatilization n loss fertilizer apply"),
    ("/drought-monitor", "Drought monitor", "Weekly drought map", "drought dry monitor map rain weather"),
    ("/conditions", "Crop conditions", "Good to excellent by state", "crop conditions ratings good excellent progress"),
    ("/crop-tour", "Crop tour", "Pro Farmer tour results", "crop tour pro farmer yield"),
    ("/conditions-yield", "Ratings vs yield", "Do ratings predict yield", "ratings yield conditions predict"),
    ("/pod-counts", "Pod counts", "Do pod counts predict yield", "pod counts soybean yield estimate"),
    ("/hail-map", "Hail map", "Swaths, warnings and history", "hail storm map swath warnings weather"),
    ("/gdu-calculator", "GDU calculator", "Growing degree units", "gdu gdd growing degree units heat calculator"),
    ("/planting-date", "Planting date", "Corn and soybean windows", "planting date window plant replant calculator"),
    ("/fertilizer", "Fertilizer prices", "Urea, MAP, potash", "fertilizer prices urea map dap potash anhydrous nitrogen"),
    ("/yield-estimator", "Yield estimator", "Ear and pod counts", "yield estimate estimator calculator ear count pods bushels"),
    ("/field-scout", "Field scout", "Draw a field, get its story", "field scout map soil satellite field"),
    ("/fast-facts", "Reference tables", "N rates, P and K, GDU", "reference tables fast facts n rates p k seeding conversion"),
    ("/tools", "All tools", "Every calculator and tool", "tools calculators all"),
    ("/news", "The wire", "What just moved", "news wire headlines"),
    ("/daily", "AGSIST Daily", "Morning market briefing", "daily briefing morning report newsletter"),
    ("/archive", "Briefing archive", "Past daily briefings", "archive past briefings"),
    ("/scorecard", "Prediction bot scorecard", "How the calls did", "scorecard prediction bot calls record"),
    ("/about", "About", "Who runs AGSIST", "about sig sigurd lindquist"),
    ("/contact", "Contact", "Get in touch", "contact email"),
    ("/data-sources", "Data sources", "Where the numbers come from", "data sources"),
    ("/embed", "Embed widgets", "Put AGSIST on your site", "embed widgets"),
    ("/developer", "Developer API", "Data feeds", "developer api feeds"),
    ("/sponsor", "Sponsor", "Advertise on AGSIST", "sponsor advertise ads"),
    ("/changelog", "What's new", "Site updates", "changelog updates new"),
    ("/status", "Site status", "Live data health", "status health"),
    ("/privacy", "Privacy policy", "", "privacy"),
    ("/terms", "Terms of service", "", "terms"),
    ("/accessibility", "Accessibility", "", "accessibility"),
]
SKIP_ROOT = {"404.html", "sponsor-apply.html"}

# state page sections: dir, url pattern, title suffix, sub, keywords
STATE_SECTIONS = [
    ("cash-bids/{slug}/index.html", "/cash-bids/{slug}/", "cash bids by town", "Elevator bids in every town", "cash bids elevators towns grain prices"),
    ("basis/{slug}.html", "/basis/{slug}", "basis today", "Corn and soybean basis", "basis corn soybean elevators"),
    ("rent/{slug}.html", "/rent/{slug}", "cash rent by county", "Rent per acre", "cash rent rents rental county acre land"),
    ("yield/{slug}.html", "/yield/{slug}", "yield by year", "Corn and soybean yields", "yield yields corn soybean history bushels"),
    ("hail-map/{slug}.html", "/hail-map/{slug}", "hail map", "Worst hail counties", "hail storm map counties"),
    ("farmland-atlas/{slug}/index.html", "/farmland-atlas/{slug}/", "farmland atlas", "Land value by county", "farmland atlas land value values county"),
]

# futures: quote key prefix -> (label, page, keywords)
FUTURES = {
    "corn": ("Corn", "/corn-futures-prices", "corn zc cbot"),
    "beans": ("Soybeans", "/soybean-futures-prices", "soybeans soybean beans soy zs cbot"),
    "meal": ("Soybean meal", "/soybean-futures-prices", "soybean meal soymeal zm cbot"),
    "soyoil": ("Soybean oil", "/soybean-futures-prices", "soybean oil soyoil bean oil zl cbot"),
    "wheat": ("Chicago wheat", "/wheat-futures-prices", "wheat srw chicago zw cbot"),
    "kcwheat": ("KC wheat", "/wheat-futures-prices", "wheat hrw kc kansas city ke"),
    "cattle": ("Live cattle", "/cattle-futures-prices", "live cattle le cme"),
    "feeders": ("Feeder cattle", "/cattle-futures-prices", "feeder cattle feeders gf cme"),
    "milk": ("Class III milk", "/milk-prices", "milk class iii dairy dc cme"),
    "hogs": ("Lean hogs", "/markets", "lean hogs hog he cme"),
    "oats": ("Oats", "/markets", "oats zo cbot"),
}
MONTHS = {"jan": "January", "feb": "February", "mar": "March", "apr": "April", "may": "May",
          "jun": "June", "jul": "July", "aug": "August", "sep": "September", "oct": "October",
          "nov": "November", "dec": "December"}
MONTH_CODE = {"jan": "F", "feb": "G", "mar": "H", "apr": "J", "may": "K", "jun": "M",
              "jul": "N", "aug": "Q", "sep": "U", "oct": "V", "nov": "X", "dec": "Z"}


def rd(path):
    with open(os.path.join(ROOT, path), encoding="utf-8", errors="replace") as f:
        return f.read()


def exists(path):
    return os.path.isfile(os.path.join(ROOT, path))


def noindex(text):
    m = re.search(r'<meta[^>]+name="robots"[^>]*>', text, re.I)
    return bool(m and "noindex" in m.group(0).lower())


def title_of(text):
    m = re.search(r"<title>(.*?)</title>", text, re.S | re.I)
    return html.unescape(m.group(1)).strip() if m else ""


def clean(s):
    return re.sub(r"\s+", " ", html.unescape(s or "")).strip()


def build_pages(warn):
    out = []
    listed = set()
    for url, title, sub, kw in PAGES:
        base = url.split("#")[0].strip("/") or "index"
        if not (exists(base + ".html") or (url.endswith("/") and exists(base + "/index.html"))):
            warn("page listed but missing: %s" % url)
            continue
        listed.add(base + ".html")
        out.append([0, title, sub, url, kw])
    for f in sorted(glob.glob(os.path.join(ROOT, "*.html"))):
        name = os.path.basename(f)
        if name in listed or name in SKIP_ROOT:
            continue
        text = rd(name)
        if noindex(text) or re.search(r'http-equiv="refresh"', text, re.I):
            continue
        t = re.sub(r"\s*\|\s*AGSIST\s*$", "", title_of(text))
        if not t:
            continue
        warn("page not in PAGES, added with its <title>: %s" % name)
        out.append([0, t, "", "/" + name[:-5], ""])
    return out + build_arcplc_crops()


def build_arcplc_crops():
    """ARC or PLC crop pages (/arc-plc/<crop>, built by build_arc_plc.py), from the
    list in data/arc-plc.json, kept only where the page exists."""
    p = os.path.join(ROOT, "data", "arc-plc.json")
    if not os.path.exists(p):
        return []
    out = []
    for h in json.load(open(p, encoding="utf-8")).get("hubs") or []:
        if exists("arc-plc/%s.html" % h["slug"]):
            lab = h["label"]
            out.append([0, "%s ARC or PLC" % lab, "2026 and 2027, FSA county benchmarks", "/arc-plc/" + h["slug"],
                        "arc plc arc-co price loss coverage %s reference price benchmark yield fsa farm program" % lab.lower()])
    return out


def build_states():
    out = []
    for slug, abbr in sorted(SLUG_TO_ABBR.items()):
        name = STATES[abbr]
        for path, url, suffix, sub, kw in STATE_SECTIONS:
            p = path.format(slug=slug)
            if not exists(p) or noindex(rd(p)):
                continue
            out.append([1, "%s %s" % (name, suffix), sub, url.format(slug=slug), "%s %s" % (abbr.lower(), kw)])
    return out


TOWN_T = re.compile(r"Cash Grain Bids in (.+), ([A-Z]{2}) Today")


def build_towns():
    """Returns entries plus {(town_lower, ST): url} and the board names on each page."""
    out, by_town, boards = [], {}, []
    for f in sorted(glob.glob(os.path.join(ROOT, "cash-bids", "*", "*.html"))):
        rel = os.path.relpath(f, ROOT).replace(os.sep, "/")
        if rel.endswith("/index.html"):
            continue
        text = rd(rel)
        m = TOWN_T.search(title_of(text))
        if not m:
            continue
        town, st = clean(m.group(1)), m.group(2)
        url = "/" + rel[:-5]
        out.append([2, "%s, %s" % (town, st), "Cash bids", url, "%s %s" % (st.lower(), STATES.get(st, "").lower())])
        by_town[(town.lower(), st)] = url
        names = [clean(n) for n in re.findall(r'<section class="cbt-el"><h2>(.*?)</h2>', text)]
        names += [clean(n) for n in re.findall(r"<li>([^<:]+):", text.split("no current bid</h2>", 1)[1])] \
            if "no current bid</h2>" in text else []
        for n in names:
            if n:
                boards.append((n, town, st, url))
    return out, by_town, boards


def build_counties():
    out = []
    idx = json.loads(rd("farmland-atlas/data/counties-index.json"))
    for fips, label, url in idx:
        p = url.strip("/") + ".html"
        if not exists(p) or noindex(rd(p)):
            continue
        name, _, st = label.rpartition(", ")
        out.append([3, "%s, %s" % (name, st), "Farmland atlas", url,
                    "%s %s" % (st.lower(), STATES.get(st, "").lower())])
    return out


def build_futures():
    out = []
    try:
        quotes = json.loads(rd("data/prices.json")).get("quotes", {})
    except (OSError, ValueError):
        return out
    for key, q in quotes.items():
        m = re.fullmatch(r"([a-z]+)-([a-z]{3})(\d\d)", key)
        if not m or m.group(1) not in FUTURES or m.group(2) not in MONTHS:
            continue
        root, mon, yy = m.groups()
        label, page, kw = FUTURES[root]
        tick = re.sub(r"\..*$", "", (q or {}).get("ticker") or "")
        out.append([4, "%s %s '%s" % (label, mon.capitalize(), yy), tick, page,
                    "%s %s %s 20%s futures contract %s" % (kw, mon, MONTHS[mon].lower(), yy, tick.lower())])
    return out


def norm_co(s):
    s = re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower())
    s = re.sub(r"\b(llc|inc|co|corp|company|cooperative|coop|the|of)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def build_elevators(by_town, boards):
    """Network board names first (they have a town page); then directory
    facilities, titled by company, skipped when that company is already listed
    for the same town."""
    out, seen = [], set()
    for name, town, st, url in boards:
        k = (norm_co(name), town.lower(), st)
        if k in seen:
            continue
        seen.add(k)
        out.append([5, name, "%s, %s" % (town, st), url, ""])
    try:
        d = json.loads(rd("data/elevator-directory.json"))
    except (OSError, ValueError):
        d = {}
    for e in d.get("elevators", []):
        st = (e.get("state") or "").upper()
        if st not in STATES or e.get("country", "US") != "US":
            continue
        city = clean(e.get("city"))
        company = clean(e.get("company"))
        loc = clean(e.get("location"))
        if not city or not company:
            continue
        k = (norm_co(company), city.lower(), st)
        if k in seen or (norm_co(loc), city.lower(), st) in seen:
            continue
        url = by_town.get((city.lower(), st))
        z = re.sub(r"\D", "", e.get("zip") or "")[:5]
        if not url and len(z) == 5:
            url = "/cash-bids?zip=" + z
        if not url:
            continue
        seen.add(k)
        extra = loc.lower() if norm_co(loc) not in (norm_co(company), city.lower()) else ""
        out.append([5, company, "%s, %s" % (city, st), url, extra])
    return out


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=False)


def build(warn):
    towns, by_town, boards = build_towns()
    items = build_pages(warn) + build_states() + towns + build_counties() + build_futures()
    elev = build_elevators(by_town, boards)
    main = {"note": "Built by scripts/build_search_index.py. Do not edit.", "v": 1, "items": items}
    el = {"note": "Built by scripts/build_search_index.py. Do not edit.", "v": 1, "items": elev}
    return dumps(main) + "\n", dumps(el) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="fail if the committed files differ")
    args = ap.parse_args()
    warn = lambda m: print("search-index: " + m, file=sys.stderr)  # noqa: E731
    main_s, elev_s = build(warn)
    files = ((OUT_MAIN, main_s, MAX_MAIN_GZ), (OUT_ELEV, elev_s, MAX_ELEV_GZ))
    bad = False
    for path, s, cap in files:  # check both before writing either
        gz = len(gzip.compress(s.encode("utf-8"), 9))
        print("%s: %d entries, %d KB raw, %d KB gzip" % (
            path, len(json.loads(s)["items"]), len(s.encode()) // 1024, gz // 1024))
        if gz > cap:
            print("too big: %s is %d bytes gzipped (cap %d)" % (path, gz, cap), file=sys.stderr)
            bad = True
        if args.check and (not exists(path) or rd(path) != s):
            print("stale: %s (run scripts/build_search_index.py)" % path, file=sys.stderr)
            bad = True
    if bad:
        sys.exit(1)
    if not args.check:
        for path, s, _ in files:
            with open(os.path.join(ROOT, path), "w", encoding="utf-8") as f:
                f.write(s)

if __name__ == "__main__":
    main()
