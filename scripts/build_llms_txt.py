#!/usr/bin/env python3
"""
build_llms_txt.py - writes llms.txt from one list of live pages, grouped by the
questions a farmer comes with.

WHY: llms.txt was kept by hand. By 2026-10 it was missing about 20 pages,
listed pages that had been retired to forwarding stubs, and said prices refresh
"every 30 minutes" in one paragraph and "every 15 minutes" in the next.

WHERE THE LIST COMES FROM: PAGES below is the one hand-kept list (the wording
for each line). Every URL in it is checked against the published site itself:
the file has to exist, must not be a forwarding stub or noindex, and has to be
in one of the sitemap*.xml files. And every top-level page in sitemap.xml has to
be either in PAGES or in OMIT with a reason, so a new page cannot go missing
from llms.txt without someone deciding it should.

MACHINE-OWNED LINES: the ARC/PLC lines carry live numbers and signup dates and
are written by scripts/build_arc_plc.py (two lines) and scripts/arc_plc_crops.py
(one line). This script copies those lines through unchanged from the current
llms.txt, in their place, so the two builders never fight over them.

    python3 scripts/build_llms_txt.py              write llms.txt
    python3 scripts/build_llms_txt.py --check      exit 1 if llms.txt is stale, lists a
                                                   dead or retired URL, or a sitemap page
                                                   is in neither PAGES nor OMIT
    python3 scripts/build_llms_txt.py --selftest   hand-checked cases, writes nothing

Stdlib only. Offline.
"""
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = "llms.txt"
HOST = "https://agsist.com"

# Lines other builders own, by their exact prefix (see the module docstring).
MACHINE = {
    "arc": "- [ARC or PLC for 2026 and 2027](https://agsist.com/arc-plc):",
    "arc-county": "- [ARC-CO benchmark yields by county](https://agsist.com/arc-plc/iowa):",
    "arc-crops": "- [ARC or PLC by crop](https://agsist.com/arc-plc/sorghum):",
}
# What to print if the owner has not written its line yet (fresh file).
MACHINE_FALLBACK = {
    "arc": ("/arc-plc", "ARC or PLC for 2026 and 2027",
            "PLC effective reference prices and a calculator that compares PLC and ARC-CO per base acre by price and county yield"),
    "arc-county": ("/arc-plc/iowa", "ARC-CO benchmark yields by county",
                   "FSA's official ARC-CO benchmark yields by county, crop and practice, at /arc-plc/<state> and /arc-plc/<state>/<county>"),
    "arc-crops": None,
}

HEAD = """# AGSIST

> AGSIST (agsist.com) is a free, no-login farm market site for working US
> producers: cash grain bids and basis near you, futures prices, USDA report
> data, crop size, weather and field conditions, farm programs, and a daily
> morning briefing. Built and maintained by one person: Sigurd Lindquist,
> Certified Crop Adviser (CCA), Chetek, Wisconsin, who also works at Farmers
> First Agri Service.

How fresh the numbers are: futures prices and cash bids refresh about every 15
minutes. Prices are delayed exchange quotes from the Yahoo Finance feed, not an
official CME feed. The AGSIST Daily briefing publishes each morning. Every other
page states its own source and date on the page, and /status shows whether each
feed is current right now. Nothing on the site is financial or trading advice.

Sources: cash bids read from AGSIST's own network of elevator bid boards (each
elevator's own posted board); weather from Open-Meteo and NOAA; crop, price and
program data from USDA (NASS, FAS, RMA, FSA); positioning from the CFTC.
Every number's source is on /data-sources.

When citing AGSIST, please attribute to "AGSIST (agsist.com)" and link the
specific page. Each daily briefing has a permanent dated URL.
"""

# (heading, [(path, title, description) or ("@machine", key)])
PAGES = [
    ("What's my grain worth today?", [
        ("/cash-bids", "Cash Grain Bids", "local elevator bids and basis by ZIP"),
        ("/cash-bid-index", "AGSIST Cash Bid Index", "monthly cash corn and soybean bids and basis by state, counted from the elevators AGSIST reads"),
        ("/cash-bids/company/", "Cash Bids by Elevator Company", "every elevator company with 3 or more network locations, today's bids at all its locations on one page"),
        ("/cash-bids/iowa/", "Bids and Basis by State",
         "each state's best bids, median corn and soybean basis with the number of elevators behind it, and every elevator's bid, at /cash-bids/<state>/"),
        ("/cash-bids/iowa/ackley", "Cash Bids by Town",
         "each town's nearest-delivery corn and soybean bid and basis, the elevator and the date it posted, at /cash-bids/<state>/<town>"),
        ("/basis", "Basis by State and vs Normal",
         "your state's median corn and soybean basis, USDA regions against their own 5-year same-week normal, barge rates, and this fall's grain vs bin space"),
        ("/corn-futures-prices", "Corn Futures", "CBOT corn with 52-week and 5-year context"),
        ("/soybean-futures-prices", "Soybean Futures", "CBOT soybeans with 52-week and 5-year context"),
        ("/wheat-futures-prices", "Wheat Futures", "Chicago SRW and KC HRW wheat"),
        ("/cattle-futures-prices", "Cattle Futures", "live and feeder cattle, the feeder/live ratio and a cost-of-gain break-even"),
        ("/milk-prices", "Milk Prices", "Class III and IV, cheese and butter, and the component formula behind the milk check"),
        ("/markets", "Markets", "grains, livestock, milk, energy and metals in one view"),
        ("/elevators", "For Elevators", "the map of every elevator AGSIST tracks, and how an elevator claims its board"),
        ("/list-your-elevator", "List Your Elevator", "how an elevator not on AGSIST yet asks to be added, and the ways to send its bids: a bid sheet, the posting page, or a link to its own board"),
    ]),
    ("What will USDA say, and what moves the price?", [
        ("/usda-calendar", "USDA Report Calendar", "every USDA report date"),
        ("/whats-priced-in", "What's Priced In", "trade expectations before each USDA report, and how each report graded against them"),
        ("/usda-quick-stats", "USDA Crop Data by State", "yields, acres, production and prices by state for corn, soybeans and wheat, from USDA NASS"),
        ("/yield/iowa", "Yield by Year, by State", "each state's corn and soybean yield by year since 2010, at /yield/<state>"),
        ("/cot", "Fund Positioning (COT)", "weekly CFTC managed-money positioning for 11 ag markets, and whether positioning has predicted price"),
        ("/scorecard", "Prediction Bot Scorecard",
         "a fixed statistical rule calls whether corn, soybeans, Chicago and KC wheat close higher or lower about four weeks out, one call per crop for each weekly CFTC report, every call graded by code against Yahoo Finance daily closes, with the backtest kept apart from the live record"),
        ("/tariffs", "Tariff Tracker", "current tariff rates on US corn, soybean, wheat and pork exports"),
    ]),
    ("How big is this crop?", [
        ("/conditions-yield", "2026 Crop Size: Every Forecast", "every US corn and soybean yield forecast side by side: USDA, the Pro Farmer tour, private estimates and AGSIST's ratings model"),
        ("/crop-tour", "Pro Farmer Crop Tour", "the tour's state results and national estimate, set against USDA's, with the tour's record since 2015"),
        ("/conditions", "Crop Conditions Ranked", "each state's good-to-excellent share ranked against the same week of every year USDA rated it"),
        ("/pod-counts", "Do Pod Counts Predict Soybean Yield?", "what 28 state-years of crop tour pod counts actually predict"),
        ("/yield-estimator", "Yield Estimator", "corn ear counts and soybean pod counts turned into bushels per acre"),
    ]),
    ("What's happening in my fields?", [
        ("/hail-map", "Hail Map", "did it hail at your place: NWS hail reports, radar-estimated swaths, warnings, free hail alerts, and county rankings"),
        ("/hail/", "Hail Storm Log", "one page per significant US hail day, at /hail/YYYY-MM-DD"),
        ("/hail-map/iowa", "Hail by State", "each state's hail counties, peak months and storm days, at /hail-map/<state>"),
        ("/spray", "Spray Conditions", "can I spray today, by the hour, plus a tank-mix calculator"),
        ("/urea", "Urea Volatilization Risk", "nitrogen loss risk for surface-applied urea in the days ahead"),
        ("/gdu-calculator", "GDU Calculator", "growing degree units from planting, crop stage and black layer"),
        ("/planting-date", "Planting Date Calculator", "soil temperature and 5-day soil forecast at your ZIP, nearest NOAA station frost odds, county final planting dates, and yield loss by planting week (UMN, UW)"),
        ("/rain", "Rain by County",
         "rain so far this year at a weather station in each county: inches, percent of a usual year and month by month, dated through the last day read, at /rain/<state>/<county>"),
        ("/drought-monitor", "Drought Monitor", "this week's US Drought Monitor map and what each category means for crops"),
        ("/rain-print", "Rain Print", "one year of daily rain at the nearest weather station, drawn as wall art with your farm name and dates; free to make, prints for sale"),
        ("/gifts-for-farmers", "Gifts for Farmers", "Sig's gift ideas for a farmer: a Rain Print of the year they still talk about, with the Christmas order-by dates, then plain gear and time gifts; no store links"),
        ("/editorial-standards", "Editorial Standards", "How the AGSIST Daily is made, where the numbers come from, sponsors, and how corrections work"),
        ("/rain-print-business", "Rain Print for Businesses", "Customer Christmas gifts for co-ops and elevators: a Rain Print of each customer's own town and year, from 5 prints, delivered prices, one proof sheet, net 30"),
        ("/farmer-retirement-gifts", "Farmer Retirement Gifts", "Gift ideas for a retiring farmer, with a Rain Print of a year on the farm as one option; no store links"),
        ("/farm-anniversary-gifts", "Farm Anniversary Gifts", "Gift ideas for a farm anniversary or a farmer who has everything, with a Rain Print of the founding or a remembered year as one option"),
        ("/prf-sponsor", "PRF State Sponsor", "how a business sponsors the PRF pages for one or more states: what the sponsor slot shows and how to ask; price on request"),
        ("/rain-gauge", "Rain Gauge (in the works)", "a rain gauge Sig is building: a clear tube in front of a printed scale, read by eye or logged with a phone photo, field by field; a prototype now, aiming for before planting 2027, no price set; waitlist by email"),
        ("/field-scout", "Field Scout", "draw a field and see its soils, crop history, weather, drought and nearby bids"),
        ("/fertilizer", "Fertilizer Prices", "the middle cash price per ton that farm co-ops post for anhydrous, urea, UAN, DAP, potash and more, read each weekday from their own websites and credited by name, each price with its region and date"),
        ("/fast-facts", "Ag Fast Facts", "on-farm reference tables: corn N rates, P and K by soil test, crop removal, manure nutrients, crop stages, pest thresholds, herbicide groups, conversions; each tab has its own #link"),
        ("/manure-value", "Manure Value", "what dairy, hog, beef, poultry and horse manure is worth per 1,000 gallons and per ton at current co-op posted fertilizer prices (P from MAP or DAP with its N credited): the value of all the N, P and K by UW A2809's typical totals, with the part a crop can use the first year beside it, an acre and for a whole field, a worked dairy example and a calculator that takes your own manure test"),
        ("/tools", "All Tools", "every AGSIST calculator on one page"),
    ]),
    ("Sell, store or price ahead?", [
        ("/store-or-sell", "Sell Now or Store?", "net carry after storage and interest from your nearest elevator's posted bids, or the futures spread"),
        ("/breakeven", "Break-Even Calculator", "cost per bushel and profit per acre, with what-if tables"),
        ("/harvest-price-tracker", "Harvest Price Tracker",
         "the RMA projected and harvest prices that set Revenue Protection guarantees, what your guarantee is worth, and how many bushels you can safely pre-sell"),
        ("/grain-bin-calculator", "Grain Bin Calculator", "bushels in a bin and moisture shrink"),
        ("/rain-radar", "Rain on Your Field (Radar)", "rain in the last 24 hours, 3 days, 7 days and this month at any spot in the lower 48, from NOAA MRMS radar corrected with rain gauges, updated four times a day; checked against 1,175 NOAA co-op gauges"),
        ("/grain-emc", "Grain EMC Calculator", "when to run aeration fans for corn, soybeans or wheat: drying wet grain (against its own moisture), cooling (outside air 10 F or more under the grain) or holding dry grain, hour by hour for 3 days at your ZIP; printable corn, soybean and wheat EMC charts from published equations"),
        ("/grain-shrink", "Grain Shrink Calculator", "what wet corn, soybeans, wheat or sorghum nets after the elevator's shrink and drying charges, and the bushels and dollars given away delivering below base moisture (soybeans under 13%); at your bid, a ZIP's nearest posted bid, or a labeled state estimate"),
        ("/harvest-or-wait", "Harvest now or wait", "Corn drying cost now vs after field drydown, against the field loss you expect; break-even loss when you do not know it"),
        ("/fall-nitrogen", "Fall anhydrous soil temperature", "Measured 4 in soil temperature by county against the 50 F line for fall anhydrous, from NOAA, NRCS and state mesonet stations; never says go"),
        ("/commodity-loan", "Commodity Loan Calculator", "marketing assistance loan on stored grain: bushels x county loan rate, CCC interest per bushel per month, against the carry; not an eligibility check"),
        ("/here", "One place, all its numbers", "type a ZIP, town or county and get one page about that county: a one-line summary from the numbers, where it ranks in its state on 17 Farmland Atlas figures, the figures furthest from its neighbors, this week's bids, basis vs normal, rain, drought, hail and the next USDA report, and the long view by year; every figure sourced and dated, missing figures say why"),
        ("/combine-loss", "Combine Loss Check", "harvest loss from beans or kernels counted on the ground behind the combine (UNL rules: 4 beans or 2 kernels per sq ft = 1 bu/ac), with ears, in bu/ac and dollars at your bid"),
        ("/nutrient-removal", "Nutrient Removal Value Calculator", "pounds of P2O5 and K2O removed per ton, bale and acre when you bale corn stalks or small grain straw, chop silage, sell hay or haul grain (UW A2809 Table 4.2), priced at posted co-op fertilizer prices; N and S withheld until sourced"),
        ("/hay-prices", "Hay Prices by State", "This week's USDA AMS hay trades by state, grade and bale type ($ a ton, each report dated), beside USDA NASS monthly prices received for alfalfa, other hay and all hay, every published state, the same month last year and 3 years of history; withheld states say so"),
        ("/haymow", "The Haymow (hay for sale and wanted)", "a free board where farmers post hay, straw and forage for sale or wanted, sorted by distance from a ZIP, with the price per ton worked out from a per-bale price and the poster's bale weight; buyers and sellers call each other, no fees and no cut"),
        ("/cattle-auction-prices", "Sale Barn Prices", "feeder steer and heifer prices by 100 lb weight class (Medium and Large 1 and 1-2), weighted average $/cwt and $/head with head counts, at USDA-reported sale barns and state auction summaries near a ZIP"),
    ]),
    ("My ground and programs", [
        ("/custom-rates", "Custom Farm Rates by State", "what hired combining, planting, spraying, tillage, hauling and baling cost, as each state's university or state survey published it (average, range, unit, survey year, link): Iowa, Kansas, Nebraska, North Dakota, Wisconsin, Indiana, Ohio, Missouri, Oklahoma; one page per state at /custom-rates/<state>"),
        ("/rent/", "Cash Rent by State", "USDA county cash rent for every published state, one page per state at /rent/<state>"),
        ("/farmland-atlas", "Farmland Atlas",
         "every US county's cash rent, land value, crop insurance loss record, drought and more from public records, one page per county at /farmland-atlas/<state>/<county>"),
        ("/farmland-index", "Illinois Farmland Sale Index",
         "what Illinois farm ground sold for each quarter since 2018, from the state's PTAX-203 sale declarations: arm's-length bare-land sales of 20+ acres, county mix and tract size held fixed, 2018 = 100, with 90% ranges, the latest quarter marked provisional, USDA NASS cropland value as a separate line, county medians by year, price-to-rent multiples and buyer-type shares; no names"),
        ("/farmland-atlas/compare", "Compare Counties", "up to three counties side by side"),
        ("/farmland-atlas/data", "Farmland Atlas Data", "the county table as a CSV, every column with its unit and source"),
        ("/farmland-atlas/methods", "Farmland Atlas Methods", "sources and formulas"),
        ("@machine", "arc"),
        ("@machine", "arc-county"),
        ("@machine", "arc-crops"),
        ("/prf", "PRF Rainfall Insurance Calculator",
         "Pasture, Rangeland, Forage rainfall index insurance: pick a grid, acres and two-month intervals and see the premium, USDA's share, and what the policy would have paid in every year since 1951 at this year's rates, for every grid in the 48 contiguous states; one page per state at /prf/<state> with every county's USDA base values, one page per county at /prf/<state>/<county> (e.g. /prf/texas/anderson-county) naming its grids with their month-by-month rates, how often each pair of months came in under 90% of normal since 1951 and the last five years, and a plain-words explainer at /prf/how-prf-works"),
        ("/lrp", "LRP Calculator (Livestock Risk Protection)",
         "pick fed cattle, feeder cattle or hogs, enter head and weight at sale and pick the end date: today's RMA LRP cost for the lot, a head and a cwt after the subsidy at the top coverage and 95%, the floor and the floor net of premium, the premium billing date, what LRP pays if the price drops by an amount you pick, and since July 2020 what each $1 of premium paid back for that animal and length; the weight picks RMA's weight class; inputs in the URL (?a=fed&h=120&w=1400&l=13); FAQ on how LRP pays, subsidy, sales hours, premium due date, head limits and basis"),
        ("/lrp/record", "LRP Record and Tests",
         "the 95-100% coverage record per $100 of coverage on every RMA sales day since July 2013; 36 walk-forward tests of lower coverage levels and a best-so-far rule under one Holm family, none kept; each test year by year; the method, gaps and subsidy table"),
        ("/farm-bill", "Farm Bill", "what the 2026 farm bill fight changes for a farm, where it stands, and where the money goes"),
        ("/cash-lease", "Cash Farm Lease", "a fillable, printable plain-English cash lease with state termination notes"),
        ("/foreign-land", "Foreign-Owned Farmland", "USDA AFIDA disclosures mapped by county"),
    ]),
    ("Every morning", [
        ("/daily", "AGSIST Daily", "today's morning briefing"),
        ("/archive", "Briefing Archive", "every past briefing, by month, at /daily/YYYY-MM-DD"),
        ("/news", "The Wire", "dated market events the moment they are measurable: USDA surprises, positioning extremes, 52-week highs and lows"),
        ("/", "AGSIST Homepage", "today's prices, the briefing, local bids, weather and the farm and trade odds board"),
    ]),
    ("About this site", [
        ("/data-sources", "Data Sources", "where every number comes from"),
        ("/glossary", "Farm Market Glossary", "plain definitions of basis, cash bid, futures, settle, nearby, carry, WASDE, ending stocks, managed money, NASS, RMA, FSA, CRP, cwt, shrink and other words the site uses"),
        ("/status", "Status", "whether each data feed is current right now"),
        ("/developer", "Embed Tools and Data Feeds", "embeddable GDU and ARC or PLC widgets, and the open JSON feeds"),
        ("/changelog", "Changelog", "dated list of site changes"),
        ("/about", "About", "who builds AGSIST and why"),
        ("/contact", "Contact", "sig@farmers1st.com"),
    ]),
]

# Top-level sitemap pages deliberately left out of llms.txt, with the reason.
OMIT = {
    "/sponsor": "advertising sales page, not farm information",
    "/privacy": "legal page",
    "/terms": "legal page",
    "/accessibility": "legal page",
}

# Generated page sets: a URL under one of these is covered by its set's line.
SET_RE = re.compile(r"^/(daily|hail|hail-map|rent|yield|basis|cash-bids|arc-plc|farmland-atlas|embed|prf|custom-rates)/.+")


def url_file(path, root=REPO):
    """Published path -> the file GitHub Pages serves for it, or None."""
    p = path.split("#")[0]
    if p == "/":
        cands = ["index.html"]
    elif p.endswith("/"):
        cands = [p.strip("/") + "/index.html"]
    else:
        cands = [p.strip("/") + ".html", p.strip("/") + "/index.html"]
    for c in cands:
        f = os.path.join(root, c)
        if os.path.isfile(f):
            return f
    return None


def page_problem(path, sitemap_locs, root=REPO):
    """Why this URL cannot be listed, or None when it is live."""
    f = url_file(path, root)
    if not f:
        return "no file"
    s = open(f, encoding="utf-8", errors="replace").read()
    if re.search(r'http-equiv=["\']refresh', s, re.I):
        return "forwarding stub"
    if re.search(r'<meta[^>]+name=["\']robots["\'][^>]+noindex', s, re.I):
        return "noindex"
    base = path.split("#")[0]
    if HOST + base not in sitemap_locs and HOST + base.rstrip("/") not in sitemap_locs \
            and HOST + base.rstrip("/") + "/" not in sitemap_locs:
        return "not in any sitemap"
    if "#" in path and ('id="%s"' % path.split("#")[1]) not in s:
        return "anchor #%s not on the page" % path.split("#")[1]
    return None


def sitemap_locs(root=REPO):
    locs = set()
    for fn in sorted(os.listdir(root)):
        if fn.startswith("sitemap") and fn.endswith(".xml"):
            locs.update(re.findall(r"<loc>([^<]+)</loc>", open(os.path.join(root, fn), encoding="utf-8").read()))
    return locs


def top_level_pages(root=REPO):
    """Every page in sitemap.xml that is not part of a generated set."""
    s = open(os.path.join(root, "sitemap.xml"), encoding="utf-8").read()
    out = []
    for loc in re.findall(r"<loc>([^<]+)</loc>", s):
        if not loc.startswith(HOST):
            continue
        p = loc[len(HOST):] or "/"
        if SET_RE.match(p) and p not in ("/hail/",):
            continue
        out.append(p)
    return out


def robots_sitemaps(root=REPO):
    """Sitemap file names that robots.txt announces, in order."""
    f = os.path.join(root, "robots.txt")
    if not os.path.isfile(f):
        return []
    out = []
    for m in re.finditer(r"(?im)^\s*Sitemap:\s*(\S+)", open(f, encoding="utf-8").read()):
        out.append(m.group(1).rsplit("/", 1)[-1])
    return out


def sitemap_coverage(text, root=REPO):
    """Problems: a robots.txt Sitemap whose pages llms.txt never names.

    A sitemap is covered when a URL or a /path written in llms.txt is one of
    its <loc>s, or when every page in it is also in a covered sitemap (the news
    sitemap repeats Daily issues that sitemap.xml already holds). Added Oct 19,
    2026: the town bid and county rain sets had no line and --check passed,
    because it only read sitemap.xml.
    """
    named = set()
    for m in re.finditer(r"(?:https://agsist\.com)?(/[a-z0-9][a-z0-9/._-]*|/)(?=[)\s,;:]|$)", text):
        named.add(HOST + m.group(1))
        named.add(HOST + m.group(1).rstrip("/"))
    files = robots_sitemaps(root)
    locs = {}
    for fn in files:
        f = os.path.join(root, fn)
        locs[fn] = set(re.findall(r"<loc>([^<]+)</loc>", open(f, encoding="utf-8").read())) if os.path.isfile(f) else None
    problems = []
    covered = [fn for fn in files if locs[fn] and (locs[fn] & named)]
    for fn in files:
        if locs[fn] is None:
            problems.append("robots.txt lists %s but there is no such file" % fn)
            continue
        if fn in covered:
            continue
        others = set().union(*[locs[c] for c in covered]) if covered else set()
        if locs[fn] and locs[fn] <= others:
            continue
        problems.append("robots.txt lists %s but no line in llms.txt names a page in it" % fn)
    return problems


def norm(p):
    return p if p in ("/",) else p.rstrip("/")


def build(current_text, root=REPO):
    """Return (text, problems). problems lists what --check fails on."""
    locs = sitemap_locs(root)
    problems = []
    cur_lines = (current_text or "").split("\n")
    out = [HEAD.rstrip("\n")]
    listed = set()
    for heading, items in PAGES:
        lines = []
        for it in items:
            if it[0] == "@machine":
                key = it[1]
                got = [ln for ln in cur_lines if ln.startswith(MACHINE[key])]
                if got:
                    lines.append(got[0])
                elif MACHINE_FALLBACK.get(key):
                    path, title, desc = MACHINE_FALLBACK[key]
                    lines.append("- [%s](%s%s): %s" % (title, HOST, path, desc))
                continue
            path, title, desc = it
            why = page_problem(path, locs, root)
            if why:
                problems.append("%s listed but %s" % (path, why))
                continue
            listed.add(norm(path.split("#")[0]))
            lines.append("- [%s](%s%s): %s" % (title, HOST, path, desc))
        if lines:
            out.append("")
            out.append("## " + heading)
            out.append("")
            out.extend(lines)
    listed.add("/arc-plc")
    for p in top_level_pages(root):
        if norm(p) in listed or p in OMIT or norm(p) in OMIT:
            continue
        if page_problem(p, locs, root):
            continue   # a stub or noindex page still in sitemap.xml is another check's business
        problems.append("%s is in sitemap.xml but in neither PAGES nor OMIT of scripts/build_llms_txt.py" % p)
    text = "\n".join(out) + "\n"
    problems.extend(sitemap_coverage(text, root))
    return text, problems


def selftest():
    import tempfile
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
    with tempfile.TemporaryDirectory() as d:
        def w(rel, s):
            os.makedirs(os.path.dirname(os.path.join(d, rel)) or d, exist_ok=True)
            open(os.path.join(d, rel), "w").write(s)
        w("live.html", '<html><head><title>x</title></head><body><div id="a1"></div></body></html>')
        w("stub.html", '<meta http-equiv="refresh" content="0; url=/live">')
        w("hidden.html", '<meta name="robots" content="noindex, follow">')
        w("rent/index.html", "<html></html>")
        w("sitemap.xml", "<urlset><url><loc>https://agsist.com/live</loc></url><url><loc>https://agsist.com/stub</loc></url>"
                         "<url><loc>https://agsist.com/rent/</loc></url><url><loc>https://agsist.com/new-page</loc></url>"
                         "<url><loc>https://agsist.com/hail/2026-06-01</loc></url></urlset>")
        w("new-page.html", "<html></html>")
        locs = sitemap_locs(d)
        ok(page_problem("/live", locs, d) is None, "live page passes")
        ok(page_problem("/stub", locs, d) == "forwarding stub", "stub refused")
        ok(page_problem("/hidden", locs, d) == "noindex", "noindex refused")
        ok(page_problem("/gone", locs, d) == "no file", "missing refused")
        ok(page_problem("/rent/", locs, d) is None, "dir index with trailing slash")
        ok(page_problem("/live#a1", locs, d) is None, "anchor present")
        ok(page_problem("/live#zz", locs, d) == "anchor #zz not on the page", "anchor missing")
        ok(top_level_pages(d) == ["/live", "/stub", "/rent/", "/new-page"], "sets excluded: %s" % top_level_pages(d))
        # every robots.txt Sitemap needs a line (Oct 19: rain and town sets were missing and --check passed)
        w("sitemap-rain.xml", "<urlset><url><loc>https://agsist.com/rain</loc></url>"
                              "<url><loc>https://agsist.com/rain/iowa/polk-county</loc></url></urlset>")
        w("sitemap-news.xml", "<urlset><url><loc>https://agsist.com/live</loc></url></urlset>")
        w("robots.txt", "User-agent: *\nSitemap: https://agsist.com/sitemap.xml\n"
                        "Sitemap: https://agsist.com/sitemap-rain.xml\nSitemap: https://agsist.com/sitemap-news.xml\n")
        ok(robots_sitemaps(d) == ["sitemap.xml", "sitemap-rain.xml", "sitemap-news.xml"], "robots sitemaps read")
        cov = sitemap_coverage("- [Live](https://agsist.com/live): x\n", d)
        ok(cov == ["robots.txt lists sitemap-rain.xml but no line in llms.txt names a page in it"], "rain set missing caught: %s" % cov)
        ok(sitemap_coverage("- [Live](https://agsist.com/live): x\n- [Rain](https://agsist.com/rain): y\n", d) == [],
           "rain line covers sitemap-rain; news is a subset of sitemap.xml")
        ok(sitemap_coverage("- [Live](https://agsist.com/live): one page per county at /rain/iowa/polk-county\n", d) == [],
           "a bare /path in a description counts")
        w("robots.txt", "Sitemap: https://agsist.com/sitemap-gone.xml\n")
        ok(sitemap_coverage("", d) == ["robots.txt lists sitemap-gone.xml but there is no such file"], "missing sitemap file caught")
    # the real list: no retired URL, one refresh statement, no em dash
    t, probs = build(open(os.path.join(REPO, OUT), encoding="utf-8").read() if os.path.exists(os.path.join(REPO, OUT)) else "")
    for gone in ("/presell-calculator", "/ag-odds", "/embed)", "/cash-rent", "/land-tenure", "/storage-crunch", "/basis-map", "/cash-bids-national"):
        ok(gone not in t, "retired URL in output: " + gone)
    ok(t.count("every 15") == 1 and "30 minutes" not in t, "one refresh-rate statement")
    ok("—" not in t, "no em dash")
    ok("crop insurance agent" not in t and "Certified Crop Adviser (CCA)" in t, "standing byline, never 'crop insurance agent'")
    ok("licensed" not in t.lower(), "no licensed-feed claim (the Barchart feed is off)")
    ok("USDA Illinois" not in t, "no USDA Illinois fertilizer box (removed Oct 16)")
    ok("/cash-bids/iowa/ackley" in t and "](https://agsist.com/rain)" in t, "town and county rain sets have lines")
    ok(not probs, "problems: %s" % probs)
    if fails:
        print("SELFTEST FAILED:\n  " + "\n  ".join(fails))
        sys.exit(1)
    print("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    path = os.path.join(REPO, OUT)
    cur = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
    text, problems = build(cur)
    for p in problems:
        print("::warning title=llms.txt::" + p)
    if "--check" in sys.argv:
        stale = text != cur
        if stale:
            print("llms.txt is stale: run python3 scripts/build_llms_txt.py")
        sys.exit(1 if (stale or problems) else 0)
    if text != cur:
        open(path, "w", encoding="utf-8").write(text)
        print("llms.txt written (%d lines)" % text.count("\n"))
    else:
        print("llms.txt unchanged")


if __name__ == "__main__":
    main()
