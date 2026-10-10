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
> morning briefing. Built and maintained by one person: Sigurd Lindquist, a
> licensed crop insurance agent at Farmers First Agri Service in Wisconsin.

How fresh the numbers are: futures prices and cash bids refresh about every 15
minutes. Prices are delayed exchange quotes from the Yahoo Finance feed, not an
official CME feed. The AGSIST Daily briefing publishes each morning. Every other
page states its own source and date on the page, and /status shows whether each
feed is current right now. Nothing on the site is financial or trading advice.

Sources: cash bids from AGSIST's own network of elevator bid boards plus a
licensed cash-bid feed; weather from Open-Meteo and NOAA; crop, price and
program data from USDA (NASS, FAS, RMA, FSA); positioning from the CFTC.
Every number's source is on /data-sources.

When citing AGSIST, please attribute to "AGSIST (agsist.com)" and link the
specific page. Each daily briefing has a permanent dated URL.
"""

# (heading, [(path, title, description) or ("@machine", key)])
PAGES = [
    ("What's my grain worth today?", [
        ("/cash-bids", "Cash Grain Bids", "local elevator bids and basis by ZIP"),
        ("/cash-bids/iowa/", "Bids and Basis by State",
         "each state's best bids, median corn and soybean basis with the number of elevators behind it, and every elevator's bid, at /cash-bids/<state>/"),
        ("/basis", "Basis by State and vs Normal",
         "your state's median corn and soybean basis, USDA regions against their own 5-year same-week normal, barge rates, and this fall's grain vs bin space"),
        ("/corn-futures-prices", "Corn Futures", "CBOT corn with 52-week and 5-year context"),
        ("/soybean-futures-prices", "Soybean Futures", "CBOT soybeans with 52-week and 5-year context"),
        ("/wheat-futures-prices", "Wheat Futures", "Chicago SRW and KC HRW wheat"),
        ("/cattle-futures-prices", "Cattle Futures", "live and feeder cattle, the feeder/live ratio and a cost-of-gain break-even"),
        ("/milk-prices", "Milk Prices", "Class III and IV, cheese and butter, and the component formula behind the milk check"),
        ("/markets", "Markets", "grains, livestock, milk, energy and metals in one view"),
        ("/elevators", "For Elevators", "the map of every elevator AGSIST tracks, and how an elevator claims its board"),
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
        ("/conditions", "Crop Conditions Ranked", "each state's good-to-excellent share ranked against the same week of every year since 2000"),
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
        ("/planting-date", "Planting Date Calculator", "corn and soybean planting windows and final planting dates"),
        ("/drought-monitor", "Drought Monitor", "this week's US Drought Monitor map and what each category means for crops"),
        ("/field-scout", "Field Scout", "draw a field and see its soils, crop history, weather, drought and nearby bids"),
        ("/fertilizer", "Fertilizer Prices", "dealer quotes for urea, MAP, potash and AMS, dated per row"),
        ("/fast-facts", "Ag Fast Facts", "on-farm reference: N rates, P and K by soil test, staging, thresholds, manure value"),
        ("/tools", "All Tools", "every AGSIST calculator on one page"),
    ]),
    ("Sell, store or price ahead?", [
        ("/breakeven", "Break-Even Calculator", "cost per bushel and profit per acre, with what-if tables"),
        ("/harvest-price-tracker", "Harvest Price Tracker",
         "the RMA projected and harvest prices that set Revenue Protection guarantees, what your guarantee is worth, and how many bushels you can safely pre-sell"),
        ("/grain-bin-calculator", "Grain Bin Calculator", "bushels in a bin and moisture shrink"),
    ]),
    ("My ground and programs", [
        ("/rent/", "Cash Rent by State", "USDA county cash rent for every published state, one page per state at /rent/<state>"),
        ("/farmland-atlas", "Farmland Atlas",
         "every US county's cash rent, land value, crop insurance loss record, drought and more from public records, one page per county at /farmland-atlas/<state>/<county>"),
        ("/farmland-atlas/compare", "Compare Counties", "up to three counties side by side"),
        ("/farmland-atlas/data", "Farmland Atlas Data", "the county table as a CSV, every column with its unit and source"),
        ("/farmland-atlas/methods", "Farmland Atlas Methods", "sources and formulas"),
        ("@machine", "arc"),
        ("@machine", "arc-county"),
        ("@machine", "arc-crops"),
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
SET_RE = re.compile(r"^/(daily|hail|hail-map|rent|yield|basis|cash-bids|arc-plc|farmland-atlas|embed)/.+")


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
    return "\n".join(out) + "\n", problems


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
    # the real list: no retired URL, one refresh statement, no em dash
    t, probs = build(open(os.path.join(REPO, OUT), encoding="utf-8").read() if os.path.exists(os.path.join(REPO, OUT)) else "")
    for gone in ("/presell-calculator", "/ag-odds", "/embed)", "/cash-rent", "/land-tenure", "/storage-crunch", "/basis-map", "/cash-bids-national"):
        ok(gone not in t, "retired URL in output: " + gone)
    ok(t.count("every 15") == 1 and "30 minutes" not in t, "one refresh-rate statement")
    ok("—" not in t, "no em dash")
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
