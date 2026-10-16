#!/usr/bin/env python3
"""build_share_images.py: every page's share image (og:image), from its own data.

What a link looks like when someone texts it: Sig picked the looks on
2026-10-15 (scripts/share_cards.py draws them):

  A, the answer card, for every indexable root page. The page's answer big
     (a number from its data file or its baked HTML, with the date it is
     from), or, when a page has no single answer, its title and one plain
     line of what it gives.
  C, picture from the data, where the data makes a real picture: /cash-bids
     (elevators by state), /farm-bill (where the money goes) and the futures
     pages (a year of weekly closes), and the county rain maps. The homepage
     and the daily briefing use C through scripts/build_social_card.py, /prf
     through scripts/build_prf_card.py.
  Product cards: /rain-print shows a real Rain Print (drawn by the page's own
     engine from saved NOAA answers, scripts/render_rain_print_card_art.mjs)
     framed on a wall; /rain-gauge shows the gauge render beside its line.

Writes img/og/<page>.jpg (1200 x 630, under 120 KB) and sets og:image,
og:image:width/height/alt, twitter:card and twitter:image on the page. The
image URL carries ?v=<hash of the image> so Messages and Facebook fetch the
new card when the numbers change. A card is only rewritten when its bytes
change, so a run with no new data commits nothing.

Generated sets share ONE image per set, never one per page (CLAUDE.md): the
set's builder writes the URL into every page; this script draws the image.
  arc-plc/*   -> img/og/arc-plc.jpg   (scripts/build_arc_plc.py)
  rain.html   -> img/og/rain.jpg      (scripts/build_county_rain.py; a US county map)
  rain/<state>.html, rain/<state>/* -> img/og/rain-<st>.jpg, one per state (50),
                                      the state's county map, shaded by percent of usual
  cash-bids/* -> img/og/cash-bids.jpg (scripts/build_cash_bid_pages.py)
  hail-map/*, hail/* -> img/og/hail-map.jpg (generate_hail_*.py)
  rent/*      -> img/og/rent.jpg      (scripts/build_state_rent_pages.py)
  yield/*     -> img/og/yield.jpg     (scripts/build_state_yield_pages.py)
  prf/*       -> img/og/prf.jpg       (scripts/build_prf_card.py)
  daily/*     -> data/social/card-<date>.jpg (scripts/build_social_card.py)
lrp/record.html gets its own card, img/og/lrp-record.jpg (SUB_PAGES); --only lrp draws both.
img/og/agsist.jpg is the plain fallback card.

Never fails a data workflow: a page whose data cannot be read gets its title
card and a loud line in the log (--strict makes that an error, for tests).

  python3 scripts/build_share_images.py                 # every card
  python3 scripts/build_share_images.py --only farm-bill,cash-bids
  python3 scripts/build_share_images.py --check         # every indexable page has a good og:image
  python3 scripts/build_share_images.py --selftest
"""
import hashlib
import html as htmlmod
import json
import os
import re
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import share_cards as SC  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://agsist.com"
OG_DIR = os.path.join(ROOT, "img", "og")
BYLINE = "Sigurd Lindquist, Certified Crop Adviser (CCA)"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August",
               "September", "October", "November", "December"]


# ------------------------------------------------------------------ helpers

def rd(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def js(rel):
    return json.loads(rd(rel))


def d_iso(s):
    return date.fromisoformat(str(s)[:10])


def mdy(d):
    d = d_iso(d) if not isinstance(d, date) else d
    return f"{MONTHS[d.month - 1]} {d.day}, {d.year}"


def md(d):
    d = d_iso(d) if not isinstance(d, date) else d
    return f"{MONTHS[d.month - 1]} {d.day}"


def text(fragment):
    """HTML fragment to plain text, no em or en dashes."""
    t = re.sub(r"<br\s*/?>", " ", fragment)
    t = re.sub(r"<[^>]+>", "", t)
    t = htmlmod.unescape(t).replace("–", "-").replace("—", ", ").replace("‑", "-")
    return re.sub(r"\s+", " ", t).strip()


def h1_of(page_html):
    m = re.search(r"<h1[^>]*>(.*?)</h1>", page_html, re.S)
    if not m:
        return None
    t = re.sub(r"<br\s*/?>", " ", m.group(1))
    t = re.sub(r'<span class="sub".*', "", t, flags=re.S)
    return text(t)


def money(v, nd=2):
    return f"${v:,.{nd}f}"


def cents_frac(v):
    """Futures dollars as the site prints them: $4.81 1/4 (quarter cents)."""
    c = round(v * 400) / 4  # cents to the quarter
    whole = int(c)
    frac = {0.25: " 1/4", 0.5: " 1/2", 0.75: " 3/4"}.get(round(c - whole, 2), "")
    return f"${whole / 100:.2f}{frac}"


# ------------------------------------------------------------------ copy for title cards
# page: (kicker, plain line). The title is the page's own h1.
LINES = {
    "about": ("About", "Free farm prices and tools, built by a crop adviser in Chetek, Wisconsin."),
    "accessibility": ("Accessibility", "How the site works with a keyboard, a screen reader and big text."),
    "archive": ("AGSIST Daily", "Every morning briefing, by date."),
    "basis": ("Grain basis", "Your state's basis against its 5-year normal, and what is driving it."),
    "breakeven": ("Break-even", "Your cost per acre and yield in, your break-even price out. Corn, soybeans, wheat."),
    "cash-lease": ("Farm lease", "A free cash lease you can fill in and print, with your state's deadlines."),
    "changelog": ("What's new", "Every change to the site, by date."),
    "contact": ("Contact", "Questions, data problems or a sponsor spot: write Sig."),
    "daily": ("AGSIST Daily", "Grain markets before the open, free in your inbox every weekday."),
    "data-sources": ("Data sources", "Where every number on the site comes from."),
    "developer": ("For developers", "Put our calculators on your site, or pull the market data feeds."),
    "drought-monitor": ("Drought", "This week's US Drought Monitor map, and what each category means for crops."),
    "elevators": ("Elevators", "Every elevator we track, and how to claim and post your own bids."),
    "farmland-atlas": ("Farmland Atlas", "Land value, rent, heat, water and risk for every county on one map."),
    "fast-facts": ("Fast Facts", "N rates, P and K, manure, crop removal, growth stages and thresholds."),
    "field-scout": ("Field Scout", "Draw a field: soils, crop history, weather, drought and cash bids nearby."),
    "foreign-land": ("Foreign-held land", "Who owns US farmland from abroad, county by county, from USDA."),
    "gdu-calculator": ("GDU calculator", "Growing degree units from your planting date, with real weather."),
    "grain-bin-calculator": ("Grain bins", "Bin size to bushels, moisture shrink and what the grain is worth."),
    "grain-emc": ("Grain EMC", "Drying, cooling or holding corn, soybeans and wheat: which hours to run fans where you are."),
    "grain-shrink": ("Grain shrink", "Corn, soybeans, wheat and sorghum: shrink, drying charges and overdry loss at your bid."),
    "hail-map": ("Hail map", "Hail swaths and ground reports for any US address, by storm day."),
    "list-your-elevator": ("Elevators", "Post your elevator's cash bids free, where farmers already look."),
    "nutrient-removal": ("Nutrient removal", "P and K hauled off in stalks, straw, silage and hay, in dollars."),
    "news": ("What moved", "Dated market events the moment they can be measured."),
    "planting-date": ("Planting", "Soil temperature, frost odds and the yield cost of each week's delay."),
    "pod-counts": ("Pod counts", "What the crop tour's soybean pod counts actually predict."),
    "prf-sponsor": ("PRF sponsor", "One business per state on the PRF state and county pages."),
    "privacy": ("Privacy", "What the site collects, who handles it and how long it is kept."),
    "scorecard": ("Scorecard", "The prediction bot's calls, graded by code against the closes."),
    "sponsor": ("Sponsor", "A footer spot, your own page, or the daily briefing."),
    "spray": ("Spray conditions", "Wind, temperature, humidity and inversion risk where you are."),
    "status": ("Status", "Whether every data feed on the site is fresh right now."),
    "store-or-sell": ("Store or sell", "What holding grain pays at your own elevator, after storage and interest."),
    "tariffs": ("Tariffs", "Tariff rates on US corn, soybeans, wheat, pork and ethanol, by country."),
    "terms": ("Terms", "Use the numbers as one input. Forecasts can be wrong."),
    "tools": ("Tools", "Every calculator on the site, free and with no login."),
    "urea": ("Urea", "How much urea you could lose to the air today, where you are."),
    "whats-priced-in": ("What's priced in", "What the trade expects from the next USDA report, scored after."),
    "yield-estimator": ("Yield estimate", "Bushels per acre from your own ear and pod counts."),
    "usda-quick-stats": ("Yield by state", "Corn, soybean and wheat yields for every state since 2010."),
    "milk-prices": ("Milk prices", "Class prices, all-milk by state and the formula behind your check."),
    "fertilizer": ("Fertilizer", "Co-op posted prices and the cost per pound of N, P and K."),
    "markets": ("Markets", "Grain, livestock and energy futures, free."),
    "cot": ("Commitments of Traders", "What the funds hold in corn, soybeans, wheat and cattle."),
    "conditions": ("Crop conditions", "Every state's crop rating, ranked against the same week since 2000."),
    "conditions-yield": ("Crop size", "Every 2026 corn and soybean yield forecast, side by side."),
    "crop-tour": ("Crop tour", "The tour's yield, set against USDA's and how close it has been."),
    "harvest-price-tracker": ("Harvest price", "Projected and harvest prices, and what your RP guarantee is worth."),
    "usda-calendar": ("USDA calendar", "Every USDA report date on one calendar."),
    "arc-plc": ("ARC or PLC", "Your county's numbers for the ARC or PLC decision."),
    "rain": ("County rain", "Rain so far this year for your county, from a NOAA station."),
    "manure-value": ("Manure value", "What the N, P and K in manure are worth at posted fertilizer prices."),
    "lrp": ("LRP livestock insurance", "Today's LRP rates for cattle and hogs, and what RMA's record says."),
    "farm-bill": ("Farm bill", "Where the farm bill stands, House against Senate."),
    "cash-bids": ("Cash bids", "Corn, soybean and wheat bids at the elevators near your ZIP."),
}

# Pages that borrow another page's card (drawn first, then pointed at).
KEEP = {
    "gifts-for-farmers": "img/og/rain-print.jpg",
}
# Pages whose meta tags their own builder writes (its --check compares the
# whole file): this script draws the image, the builder points at it.
IMAGE_ONLY = {
    "arc-plc": "scripts/build_arc_plc.py",
    "rain": "scripts/build_county_rain.py",
}
# Pages whose image and meta tags another builder owns.
OWNED = {
    "index": "scripts/build_social_card.py (the daily card)",
    "prf": "scripts/build_prf_card.py",
}


def title_card(page, kicker=None, line=None, foot=None, title=None):
    h = rd(page + ".html")
    k, ln = LINES.get(page, ("AGSIST", None))
    title = title or h1_of(h) or page
    line = line or ln
    path = "" if page == "index" else "/" + page
    return {"kind": "A", "args": dict(kicker=kicker or k, path=path, foot=foot or BYLINE, title=title, ctx=line),
            "alt": f"{title}{'' if title.endswith(('?', '.', '!')) else '.'} {line or ''}".strip()}


def a_card(page, kicker, foot, alt, **kw):
    path = "" if page == "index" else "/" + page
    return {"kind": "A", "args": dict(kicker=kicker, path=path, foot=foot, **kw), "alt": alt}


# ------------------------------------------------------------------ data cards

def card_manure_value():
    h = rd("manure-value.html")
    big = re.search(r'class="mv-num"[^>]*>(?:\s*<[^>]+>)*\s*(\$[\d,]+\.\d\d)', h)
    when = re.search(r"fertilizer prices posted through (\w+ \d+, \d{4})", text(h)).group(1)
    tab = re.search(r"<table.*?</table>", h, re.S).group(0)
    rows, group = {}, None
    for tr in re.findall(r"<tr.*?</tr>", tab, re.S):
        cells = [text(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr, re.S)]
        if len(cells) == 1:
            group = cells[0]
            continue
        if len(cells) >= 5 and cells[1].startswith("$"):
            cells[1] = re.match(r"\$[\d,]+\.\d\d", cells[1]).group(0)   # "$31.20" from "$31.20$7.48 a ton"
            name = cells[0]
            if group and not name.startswith(group):
                name = f"{group}, {name}"
            rows[name] = (cells[0], cells[1])     # name with its unit, "all the nutrients"
    hero_key = next(k for k in rows if k.startswith("Dairy") and "4 to 11%" in k)
    hero = rows[hero_key][1]
    if big and big.group(1) != hero:
        raise ValueError(f"manure hero {big.group(1)} != table {hero}")

    def pick(prefix, contains):
        k = next(k for k in rows if k.startswith(prefix) and contains in k)
        unit = "/1,000 gal" if "gal" in rows[k][0] else "/ton"
        return rows[k][1], unit

    table = []
    for lab, pre, has in (("Hog, finishing pit", "Hog", "indoor pit"), ("Beef, liquid", "Beef", "Liquid"),
                          ("Chicken, solid", "Poultry", "Chicken"), ("Dairy, solid", "Dairy", "over 20%")):
        v, u = pick(pre, has)
        table.append((lab, v, u))
    return a_card("manure-value", "Manure value", f"Fertilizer prices of {when}",
                  f"All the nutrients in liquid dairy manure are worth {hero} per 1,000 gallons at {when} fertilizer prices.",
                  big=hero, unit="per 1,000 gal of liquid dairy manure",
                  ctx="All the N, P and K, UW typical totals, at co-op posted fertilizer prices.",
                  table=table, table_title="Other manure")


def card_lrp():
    """/lrp leads with today's offers (2026-10-16), so its card does too: the
    page's own baked table of the top coverage RMA offered (scripts/bake_lrp.mjs),
    read from lrp.html so the card and the page never disagree. The record and
    the tests have their own card on /lrp/record (card_lrp_record)."""
    h = rd("lrp.html")
    m = re.search(r"<!--lrp:offers0-->(.*?)<!--/lrp:offers0-->", h, re.S)
    day = re.search(r"<caption>Top coverage RMA offered for sales on (\w+ \w+ \d+, \d{4})</caption>", m.group(1)).group(1)
    rows = {}
    for tr in re.findall(r"<tr>.*?</tr>", m.group(1), re.S):
        cells = [text(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr, re.S)]
        if len(cells) == 4 and cells[2].startswith("$"):
            rows[cells[0].split(",")[0]] = cells[1:]
    lv, cov, prem = rows["Feeder steers"]
    table = [(lab, rows[k][2], "a cwt")
             for k, lab in (("Feeder steers", "Feeder steers"), ("Fed steers and heifers", "Fed cattle"), ("Hogs", "Hogs")) if k in rows]
    when = day.split(" ", 1)[1]     # "Oct 15, 2026"
    return a_card("lrp", "LRP calculator", f"RMA's offers for sales on {when}",
                  f"LRP for sales on {when}: {lv} coverage at {cov} a cwt on feeder steers, 13 weeks, "
                  f"costs {prem} a cwt after the subsidy.",
                  big=prem, unit=f"a cwt for a {cov} floor on feeder steers",
                  ctx=f"{lv} coverage, 13 weeks, after the subsidy. Your premium per head is on the page.",
                  table=table, table_title="Premium, top level, 13 wk")


def card_lrp_record():
    b = js("data/lrp/bt.json")
    n, kept = b["family_size"], len(b["kept"])
    ymd = lambda x: date(int(x[:4]), int(x[4:6]), int(x[6:8]))
    first = ymd(b["record"]["all/feeder/95-100/13"]["first"])
    asof = ymd(b["as_of"])
    rows = []
    for pid, lab in (("feeder", "Feeder cattle"), ("fed", "Fed cattle"), ("swine", "Hogs")):
        r = b["record"].get(f"current/{pid}/95-100/13")
        if r and r["years"] >= b["method"]["min_years"]:
            v = r["net"]
            rows.append((lab, ("\u2212" if v < -0.005 else "") + f"${abs(v):.2f}", "per $100"))
    ctx = ("No lower coverage level beat 95 to 100% by more than luck." if kept == 0
           else "Which coverage levels held up, and how every level did.")
    return a_card("lrp/record", "LRP record", f"RMA daily files, {md(first)}, {first.year} to {mdy(asof)}",
                  f"{kept} of {n} LRP tests held up on RMA's record since {first.year}."
                  + (" No lower coverage level beat 95 to 100% by more than luck." if kept == 0 else ""),
                  big=f"{kept} of {n}", unit="tests held up on RMA's record", ctx=ctx,
                  table=rows, table_title="Since Jul 2020, top level, 13 wk")


def card_fertilizer():
    """data/fertilizer-prices.json (scripts/build_fert_prices.py): co-op middle
    cash prices of the co-ops Sig sent, nothing else. Until 2026-10-15 this
    read the hand-typed dealer sheet."""
    d = js("data/fertilizer-prices.json")
    by = {p["key"]: p for p in d["prices"]}
    u = by["urea"]
    who = u["src_label"].split(", posted")[0]
    rows = []
    for key, lab in (("anhydrous", "Anhydrous"), ("dap", "DAP"), ("potash", "Potash")):
        if key in by:
            rows.append((lab, f"${by[key]['price']:,.0f}", "/ton"))
    when = mdy(u["as_of"])
    return a_card("fertilizer", "Fertilizer prices", f"Co-op posted prices through {when}",
                  f"Urea ${u['price']:,.0f} a ton, {who}, posted through {when}.",
                  big=f"${u['price']:,.0f}", unit=f"a ton of urea, {who}", ctx="Call the co-op to confirm.",
                  table=rows, table_title="Also a ton")


def card_milk():
    h = js("data/dairy-history.json")["months"]
    key = sorted(h)[-1]
    m = h[key]
    y, mo = int(key[:4]), int(key[5:7])
    month = f"{MONTHS_LONG[mo - 1]} {y}"
    prev = h.get(sorted(h)[-2]) if len(h) > 1 else None
    ctx = None
    if prev and prev.get("class3") is not None:
        diff = m["class3"] - prev["class3"]
        pm = MONTHS_LONG[int(sorted(h)[-2][5:7]) - 1]
        ctx = (f"{'Up' if diff > 0 else 'Down'} ${abs(diff):.2f} from {pm}." if abs(diff) >= 0.005
               else f"Same as {pm}.")
    rows = [("Class IV", f"${m['class4']:.2f}", "/cwt")]
    if m.get("class2") is not None:
        rows.append(("Class II", f"${m['class2']:.2f}", "/cwt"))
    dd = js("data/dairy-data.json").get("all_milk") or {}
    if dd.get("value") is not None:
        rows.append((f"All-milk, {dd['month'].split()[0][:3]}", f"${dd['value']:.2f}", "/cwt"))
    return a_card("milk-prices", "Milk prices", f"USDA class prices, {month}",
                  f"Class III milk was ${m['class3']:.2f} per cwt for {month}.",
                  big=f"${m['class3']:.2f}", unit=f"Class III milk, {month}, per cwt", ctx=ctx,
                  table=rows, table_title=month)


def card_cot():
    d = js("data/cot.json")
    c = d["corn"]

    def side(n):
        return "long" if n >= 0 else "short"
    chg = c["net"] - c["prev"]
    rep = datetime.strptime(d["report_date"], "%B %d, %Y").date()
    ctx = f"Funds {'added' if chg > 0 else 'cut'} {abs(chg):,} on the week." if chg else "No change on the week."
    rows = []
    for k, lab in (("beans", "Soybeans"), ("wheat", "Wheat"), ("cattle", "Live cattle")):
        if k in d and d[k].get("net") is not None:
            n = d[k]["net"]
            rows.append((lab, f"{abs(n):,}", side(n)))
    return a_card("cot", "Commitments of Traders", f"CFTC report of {mdy(rep)}",
                  f"Managed money held {abs(c['net']):,} corn contracts net {side(c['net'])} on {mdy(rep)}.",
                  big=f"{abs(c['net']):,}", unit=f"corn contracts net {side(c['net'])}, managed money",
                  ctx=ctx, table=rows, table_title="Net, contracts")


def card_conditions():
    d = js("data/crop-progress.json")
    if not d.get("in_season"):
        return title_card("conditions")
    corn, soy = d["corn"], d.get("soybeans") or {}
    rep = d_iso(corn.get("report_date") or d["report_date"])
    rows = []
    for lab, c in (("Corn", corn), ("Soybeans", soy)):
        if c.get("good_excellent") is not None:
            rows.append((lab + ", good-excellent", f"{c['good_excellent']:g}%", None))
        if c.get("harvest_pct") is not None:
            rows.append((lab + ", harvested", f"{c['harvest_pct']:g}%", None))
    ctx = None
    if corn.get("good_excellent_prev_week") is not None:
        ctx = f"{corn['good_excellent_prev_week']:g}% the week before."
    return a_card("conditions", "Crop conditions", f"USDA, week ending {mdy(rep)}",
                  f"US corn is {corn['good_excellent']:g}% good to excellent, week ending {mdy(rep)}.",
                  big=f"{corn['good_excellent']:g}%", unit="of US corn rated good to excellent",
                  ctx=ctx, table=rows, table_title="US crop")


def _yield_rows():
    d = js("data/yield-panel.json")
    return d, [r for r in d["crops"]["corn"]["rows"] if r.get("value") is not None]


def card_cond_yield():
    d, rows = _yield_rows()
    short = {"usda": "USDA", "profarmer": "Pro Farmer tour", "dtn": "DTN", "agsist": "Our ratings model"}
    usda = next(r for r in rows if r["id"] == "usda")
    table = [(short.get(r["id"], r.get("name", "")), f"{float(r['value']):.1f}", md(r["as_of"]))
             for r in rows if r["id"] != "usda"]
    return a_card("conditions-yield", f"{d['season']} crop size", f"Forecasts as of {mdy(d['generated'])}",
                  f"USDA's {d['season']} corn yield forecast is {float(usda['value']):.1f} bu/acre ({mdy(usda['as_of'])}), "
                  "with the other forecasts beside it.",
                  big=f"{float(usda['value']):.1f}", unit=f"bu/acre US corn, USDA, {md(usda['as_of'])}",
                  ctx="Every other forecast beside it.", table=table, table_title="Other forecasts")


def card_crop_tour():
    d, rows = _yield_rows()
    pf = next(r for r in rows if r["id"] == "profarmer")
    usda = next(r for r in rows if r["id"] == "usda")
    gap = float(pf["value"]) - float(usda["value"])
    tour = js("data/crop-tour.json")["history"]
    misses = [abs(h["tour_corn"] - h["usda_final_corn"]) for h in tour
              if h.get("tour_corn") is not None and h.get("usda_final_corn") is not None]
    ctx = f"{abs(gap):.1f} bu {'under' if gap < 0 else 'over'} USDA's {float(usda['value']):.1f} ({md(usda['as_of'])})."
    tbl = None
    if misses:
        tbl = [("Years checked", f"{len(misses)}", None),
               ("Average miss", f"{sum(misses) / len(misses):.1f}", "bu"),
               ("Biggest miss", f"{max(misses):.1f}", "bu")]
    return a_card("crop-tour", f"Crop tour {d['season']}", f"Tour estimate of {mdy(pf['as_of'])}",
                  f"Pro Farmer's {d['season']} crop tour put US corn at {float(pf['value']):.1f} bu/acre.",
                  big=f"{float(pf['value']):.1f}", unit="bu/acre US corn, Pro Farmer crop tour",
                  ctx=ctx, table=tbl, table_title="Tour vs USDA final")


def card_harvest_price():
    d = js("data/harvest-prices.json")
    corn = next(c for c in d["commodities"] if c["label"] == "Corn")
    hv = corn["harvest"]
    if hv.get("price") is not None:
        big, unit = hv["price"], f"corn harvest price, final ({corn['contract']} futures)"
    elif hv.get("running_avg") is not None:
        big, unit = hv["running_avg"], f"corn harvest price so far, {hv['window']} average"
    else:
        big, unit = corn["projected"]["price"], f"corn projected price, {corn['contract']}"
    rows = []
    for c in d["commodities"]:
        lab = "Soybeans" if c["label"].startswith("Soy") else c["label"]
        rows.append((f"{lab}, projected", f"${c['projected']['price']:.2f}", None))
        h = c["harvest"]
        hv2 = h.get("price") if h.get("price") is not None else h.get("running_avg")
        if hv2 is not None and c is not corn:
            rows.append((f"{lab}, harvest", f"${hv2:.2f}", "so far" if h.get("price") is None else None))
    return a_card("harvest-price-tracker", f"Harvest price {d['crop_year']}", f"CBOT settles through {mdy(d['updated'])}",
                  f"The {d['crop_year']} corn harvest price is ${big:.2f} so far; the projected price was "
                  f"${corn['projected']['price']:.2f}.",
                  big=f"${big:.2f}", unit=unit, table=rows, table_title="Crop insurance prices")


def card_arc_plc():
    d = js("data/arc-plc.json")
    years = sorted(d["years"])
    y = d["years"][years[0]]
    rows = []
    for k, lab in (("corn", "Corn"), ("soybeans", "Soybeans"), ("wheat", "Wheat")):
        rows.append((lab, f"${y['crops'][k]['erp']['erp']:.2f}", "/bu"))
    close = d_iso(y["close"])
    h1 = h1_of(rd("arc-plc.html"))
    return a_card("arc-plc", "ARC or PLC", f"FSA numbers as of {mdy(d['updated'])}",
                  f"{h1}. {years[0]} signup closes {mdy(close)}. Effective reference prices: "
                  + ", ".join(f"{a} {b}" for a, b, _ in rows) + ".",
                  title=h1, ctx=f"{years[0]} signup closes {mdy(close)}. Every county's numbers.",
                  table=rows, table_title=f"Reference price, {years[0]}")


def card_usda_calendar():
    import usda_dates
    today = date.today()
    w = usda_dates.next_wasde(today)
    if not w:
        return title_card("usda-calendar")
    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    rest = [d for d in sorted(usda_dates.WASDE_2026) if d > w][:3]
    rows = [("WASDE", md(d), None) for d in rest]
    return a_card("usda-calendar", "USDA calendar", f"WASDE dates for {w.year}",
                  f"The next WASDE report is {days[w.weekday()]}, {mdy(w)}, at noon Eastern.",
                  big=md(w), unit=f"Next WASDE, {days[w.weekday()]}, noon Eastern",
                  ctx="Every USDA report date on one calendar.",
                  table=rows or None, table_title="After that")


def card_quick_stats():
    import bake_seo as B
    ss = js("data/state-stats.json")["stateStats"]
    ia = ss["IA"]
    kind = B._qs_kind(ia)
    top = B._qs_top(ss, ia, "corn", 4)
    beans = B._qs_top(ss, ia, "bean", 1)
    rows = [(f"{n} corn", f"{v:g}", "bu") for n, v in top[1:4]]
    if beans:
        rows.append((f"{beans[0][0]} soybeans", f"{beans[0][1]:g}", "bu"))
    return a_card("usda-quick-stats", "Yield by state", kind,
                  f"{kind}: {top[0][0]} corn {top[0][1]:g} bu/acre.",
                  big=f"{top[0][1]:g}", unit=f"bu/acre, {top[0][0]} corn", ctx=kind + ".",
                  table=rows, table_title="Other states")


def card_markets():
    d = js("data/price-stats.json")
    rows = []
    for k, lab in (("corn", "Corn"), ("soybean", "Soybeans"), ("wheat", "Wheat"), ("cattle", "Live cattle")):
        s = d.get(k)
        if s and s.get("hist"):
            v = s["hist"][-1]
            rows.append((lab, cents_frac(v) if k != "cattle" else f"${v:,.2f}", None))
    wk = d["corn"]["hist_to"]
    return a_card("markets", "Markets", f"Weekly closes, week of {mdy(wk)}",
                  f"Commodity futures prices. Weekly closes for the week of {mdy(wk)}: "
                  + ", ".join(f"{a} {b}" for a, b, _ in rows) + ".",
                  title=h1_of(rd("markets.html")), ctx="Grain, livestock and energy futures, every 15 minutes.",
                  table=rows, table_title=f"Week of {md(wk)}")


# ------------------------------------------------------------------ C cards

def card_futures(page, key, name, unit_note):
    d = js("data/price-stats.json")[key]
    vals = d["hist"][-52:]
    to = d_iso(d["hist_to"])
    frm = date(to.year - 1, to.month, min(to.day, 28))
    last = vals[-1]
    shown = f"${last:,.2f}" if key == "cattle" else cents_frac(last)
    hi, lo = max(vals), min(vals)
    fmt = (lambda v: f"${v:,.2f}") if key == "cattle" else cents_frac
    return {"kind": "C", "args": dict(
        head=[(f"{name}:", False), (shown, True), (f"at the {md(to)} weekly close", False)],
        meta=f"{unit_note}  ·  12-month range {fmt(lo)} to {fmt(hi)}",
        caption=f"{name}, weekly closes, last 12 months",
        pic=("line", {"values": vals, "big": shown, "big_label": f"week of {md(to)}",
                      "start_label": f"{MONTHS[frm.month - 1]} {frm.year}", "end_label": f"{MONTHS[to.month - 1]} {to.year}"})),
            "alt": f"{name} closed the week of {mdy(to)} at {shown}; a line of the last 12 months of weekly closes, "
                   f"from {fmt(lo)} to {fmt(hi)}."}


def card_cash_bids():
    ec = js("data/elevator-counts.json")
    st = {k: v["elevators"] for k, v in ec["states"].items() if v.get("elevators")}
    lead = max(st, key=st.get)
    names = state_names()
    n, towns = ec["bids"]["elevators"], ec["bids"]["towns"]
    when = mdy(ec["generated"])
    return {"kind": "C", "args": dict(
        head=[("Cash grain bids near you,", False), ("by ZIP", True)],
        meta=f"Corn, soybeans and wheat  ·  updated {when}  ·  agsist.com/cash-bids",
        caption="Elevators with a bid today",
        pic=("tiles", {"counts": st, "big": f"{n:,}",
                       "lines": [f"elevators in {towns:,} towns.", f"{names.get(lead, lead)} leads with {st[lead]:,}."]})),
            "alt": f"A map of the US by state: {n:,} elevators in {towns:,} towns posting cash grain bids on {when}; "
                   f"{names.get(lead, lead)} has the most, {st[lead]:,}."}


def card_farm_bill():
    j = js("data/farm-bill.json")
    h = rd("farm-bill.html")
    figs = re.findall(r'<span class="name">([^<]+)</span></div><div class="figs"><b>\$([\d.,]+)B', h)
    tot = None
    for t in j.get("tldr", []):
        m = re.search(r"\$([\d.]+)T", t.get("v", ""))
        if m and "baseline" in t.get("v", ""):
            tot = float(m.group(1)) * 1000
    if not figs or not tot:
        raise ValueError("farm-bill: baseline figures not found on the page")
    figs = [(text(n), float(v.replace(",", ""))) for n, v in figs]
    cols = [SC.GREEN2, SC.GOLD, SC.GOLD2, SC.SAGE]
    segs = [(n, v, cols[i % 4]) for i, (n, v) in enumerate(figs[:4])]
    rest = sum(v for _, v in figs[4:])
    if rest > 0:
        segs.append(("All other", rest, SC.GREY))
    first = segs[0]
    pct = round(first[1] / sum(v for _, v, _ in segs) * 100)
    status = "  ".join(text(p["html"]).replace(" · ", ", ") + "." for p in j.get("pills", []))
    legend = [(f"${v:,.1f}B", n[0].lower() + n[1:]) for n, v, _ in segs[1:4]]
    tril = f"${tot / 1000:.3f} trillion"
    return {"kind": "C", "args": dict(
        head=[("The 2026 farm bill:", False), (tril + ",", True), ("and where it goes", False)],
        meta=f"10 years of program money  ·  updated {j['updated_display']}  ·  agsist.com/farm-bill",
        caption="Farm bill money, 10-year baseline",
        pic=("strip", {"segments": segs, "first_big": f"{pct}%", "first_small": f"${first[1]:,.1f} billion",
                       "note2": status, "legend_title": f"The other {100 - pct}%", "legend": legend})),
            "alt": f"The 2026 farm bill's {tril} ten-year baseline: {first[0]} is {pct}% (${first[1]:,.1f} billion). "
                   f"{status}"}


def state_names():
    try:
        g = js("data/us-states.geo.json")
        out = {}
        for f in g.get("features", []):
            p = f.get("properties", {})
            ab = p.get("abbr") or p.get("postal") or p.get("STUSPS")
            nm = p.get("name") or p.get("NAME")
            if ab and nm:
                out[ab] = nm
        if out:
            return out
    except Exception:
        pass
    return {"IA": "Iowa", "KS": "Kansas", "IL": "Illinois", "NE": "Nebraska", "MN": "Minnesota",
            "SD": "South Dakota", "ND": "North Dakota", "OH": "Ohio", "IN": "Indiana", "WI": "Wisconsin"}


# ------------------------------------------------------------------ product cards

RP_ART = "scripts/cardart/rain-print-2012-ames-ia.jpg"   # scripts/render_rain_print_card_art.mjs


def card_rain_print():
    """A real Rain Print, drawn by components/rain-print-art.js from the saved
    NOAA answers for Ames, Iowa, 2012 (data/rain-print-examples), framed on a
    wall. The price is the unframed print's, from data/rain-print.json."""
    price = js("data/rain-print.json")["print12x18"]
    sub = "Prints from $" + f"{float(price):,.2f}".replace(".00", "")
    return {"kind": "PRINT", "args": dict(
        art_path=os.path.join(ROOT, RP_ART), head="A year of rain on your farm, framed.", sub=sub,
        note="Example: Ames, Iowa, 2012", path="/rain-print", layout="side"),
        "alt": f"An example Rain Print in a black frame: every rain and snow of 2012 at Ames, Iowa, from NOAA "
               f"records, stepping up across the months below a usual year. A year of rain on your farm, framed. {sub}."}


def card_rain_gauge():
    return {"kind": "PHOTO", "args": dict(
        photo_path=os.path.join(ROOT, "img/rain-gauge/gauge-front.jpg"), head="A rain gauge that keeps its own log.",
        sub="Prototype, waitlist open", path="/rain-gauge", focus=0.5, zoom=1.25),
        "alt": "3D render of the prototype rain gauge, charcoal cap and clear tube, on a fence post at the edge of a field. "
               "A rain gauge that keeps its own log. Prototype, waitlist open."}


# ------------------------------------------------------------------ rain maps (county rain pages)
# One card per state, img/og/rain-<st>.jpg, for rain/<state>.html and every
# county page in it, and one national card, img/og/rain.jpg, for /rain. 50 + 1
# images, never one per county (CLAUDE.md). scripts/build_county_rain.py
# points the pages at them (with ?v=<hash of the image>).

_GEO = {}


def _geo():
    if not _GEO:
        g = js("data/atlas/counties.geo.json")
        _GEO["counties"] = {f["id"]: f for f in g["features"]}
        s = js("data/us-states.geo.json")
        _GEO["states"] = {f["properties"].get("postal"): f for f in s["features"]
                          if f["properties"].get("iso_a2") == "US"}
    return _GEO


def _rain_files():
    import county_rain as R
    out = {}
    d = os.path.join(ROOT, "data", "rain")
    for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        if f.endswith(".json"):
            j = js("data/rain/" + f)
            if j.get("state") in R.STATES:
                out[j["state"]] = j
    return out


def _county_items(st, d, shift=False):
    G = _geo()["counties"]
    items = []
    for fips, f in G.items():
        if f["properties"]["st"] != st:
            continue
        c = d["counties"].get(fips) if d else None
        items.append((SC._rings(f["geometry"], shift), SC.rain_color(c["pct"] if c else None)))
    return items


OUTLINE = "outline"   # payload for a state border in fit_rings


def card_rain_state(st, d=None):
    import county_rain as R
    d = d or js(f"data/rain/{st.lower()}.json")
    f = R.share_facts(d)
    if not f["n"]:
        raise ValueError(f"rain {st}: no counties")
    u1, un = f["unit"]
    shift = st == "AK"
    items = _county_items(st, d, shift)
    lat = [p[1] for rings, _ in items for ring in rings for p in ring]
    lon = [p[0] for rings, _ in items for ring in rings for p in ring]
    lo, hi = min(lat), max(lat)
    proj = SC.albers(lo + (hi - lo) / 6, hi - (hi - lo) / 6, (lo + hi) / 2, (min(lon) + max(lon)) / 2)
    stf = _geo()["states"].get(st)
    allitems = items + ([(SC._rings(stf["geometry"], shift), OUTLINE)] if stf else [])
    fitted, _ = SC.fit_rings(allitems, (500, 34, 1150, 410), proj)
    shapes = [x for x in fitted if x[1] is not OUTLINE]
    outlines = [r for r, pl in fitted if pl is OUTLINE]
    n_county = len(shapes)
    edge = 0.8 if n_county < 120 else 0.6
    ycap = f"{f['year']} rain{'' if f['done'] else ' so far'} vs usual"
    word = un if f["n_pct"] != 1 else u1
    line = f"{f['wetter']} of {f['n_pct']} {word} wetter than usual" if f["n_pct"] else None
    big = f"{f['typical']}%" if f["typical"] is not None else None
    big_label = f"of a usual year, the typical {f['state']} {u1}" if big else ""
    if big is None and f["n_pct"]:
        # too few counties for a typical one: the count is the number
        big, big_label, line = f"{f['wetter']} of {f['n_pct']}", f"{word} wetter than usual", None
    head = ([("How much rain did", False), (f["state"], True), (f"get in {f['year']}?", False)] if f["done"]
            else [("How much rain has", False), (f["state"], True), (f"had in {f['year']}?", False)])
    meta = (f"Weather stations, Jan 1 to {md(f['asof'])}  ·  "
            f"agsist.com/rain/{R.slug(f['state'])}")
    return {"kind": "RAIN", "args": dict(
        head=head, meta=meta, caption=ycap,
        big=big, big_label=big_label,
        line=line, shapes=shapes, outlines=outlines, edge_w=edge),
        "alt": R.share_alt(d)}


def card_rain_us(files=None):
    import county_rain as R
    files = files if files is not None else _rain_files()
    if not files:
        raise ValueError("no data/rain files")
    G = _geo()
    lower = [st for st in R.STATES if st not in ("AK", "HI")]
    proj = SC.albers(29.5, 45.5, 37.5, -96)
    items, outl = [], []
    for st in lower:
        items += _county_items(st, files.get(st))
        if st in G["states"]:
            outl.append((SC._rings(G["states"][st]["geometry"]), OUTLINE))
    fitted, used = SC.fit_rings(items + outl, (480, 30, 1160, 405), proj)
    shapes = [x for x in fitted if x[1] is not OUTLINE]
    outlines = [r for r, pl in fitted if pl is OUTLINE]
    insets = []
    for st, box, p in (("AK", (480, 300, 610, 405), SC.albers(55, 65, 50, -154)),
                       ("HI", (615, 350, 700, 405), SC.albers(8, 18, 13, -157))):
        it = _county_items(st, files.get(st), shift=(st == "AK"))
        ol = [(SC._rings(G["states"][st]["geometry"], st == "AK"), OUTLINE)] if st in G["states"] else []
        fi, _ = SC.fit_rings(it + ol, box, p)
        insets.append(([x for x in fi if x[1] is not OUTLINE], [r for r, pl in fi if pl is OUTLINE]))
    n = sum(len(d["counties"]) for d in files.values())
    ps = [c["pct"] for d in files.values() for c in d["counties"].values() if c["pct"] is not None]
    wet = sum(1 for p in ps if p > 100)
    asof = max(c["as_of"] for d in files.values() for c in d["counties"].values())
    year = max(d["year"] for d in files.values())
    done = all(str(d.get("edate", "")).endswith("-12-31") for d in files.values())
    return {"kind": "RAIN", "args": dict(
        head=[(f"How much rain {'did' if done else 'has'}", False), ("your county", True),
              (f"{'get' if done else 'had'} in {year}?", False)],
        meta=f"Weather stations, Jan 1 to {md(asof)}  ·  agsist.com/rain",
        caption=f"{year} rain{'' if done else ' so far'} vs usual",
        big=f"{n:,}", big_label="US counties, each with its own station",
        line=f"{wet:,} of {len(ps):,} wetter than usual" if ps else None,
        shapes=shapes, outlines=outlines, edge_w=0, insets=insets),
        "alt": R.share_alt_us(files)}


# ------------------------------------------------------------------ registry

CARDS = {
    "manure-value": card_manure_value,
    "lrp": card_lrp,
    "fertilizer": card_fertilizer,
    "milk-prices": card_milk,
    "cot": card_cot,
    "conditions": card_conditions,
    "conditions-yield": card_cond_yield,
    "crop-tour": card_crop_tour,
    "harvest-price-tracker": card_harvest_price,
    "arc-plc": card_arc_plc,
    "usda-calendar": card_usda_calendar,
    "usda-quick-stats": card_quick_stats,
    "rain": lambda: card_rain_us(),
    "rain-print": lambda: card_rain_print(),
    "rain-gauge": lambda: card_rain_gauge(),
    "markets": card_markets,
    "cash-bids": card_cash_bids,
    "farm-bill": card_farm_bill,
    "corn-futures-prices": lambda: card_futures("corn-futures-prices", "corn", "Corn futures", "Front-month CBOT corn"),
    "soybean-futures-prices": lambda: card_futures("soybean-futures-prices", "soybean", "Soybean futures", "Front-month CBOT soybeans"),
    "wheat-futures-prices": lambda: card_futures("wheat-futures-prices", "wheat", "Wheat futures", "Front-month CBOT wheat"),
    "cattle-futures-prices": lambda: card_futures("cattle-futures-prices", "cattle", "Live cattle futures", "Front-month CME live cattle"),
}

# Set cards: (image name, card function). Pages in the set point at the image
# through their own builder.
SETS = {
    "agsist": lambda: {"kind": "A", "args": dict(
        kicker="Farm data", path="", foot=BYLINE, title="Grain prices, cash bids and farm tools",
        ctx="Free, every day, for working farmers. Sources on every page."),
        "alt": "AGSIST: grain prices, cash bids and farm tools, free."},
    "rent": lambda: {"kind": "A", "args": dict(
        kicker="Cash rent", path="/rent/", foot="USDA NASS cash rent survey", title=h1_of(rd("rent/index.html")),
        ctx="What cropland and pasture rent for, state by state and county by county."),
        "alt": "Cash rent by state and county, from the USDA survey."},
    "yield": lambda: {"kind": "A", "args": dict(
        kicker="Yield by year", path="/yield/", foot="USDA NASS", title="Corn, soybean and wheat yield by state",
        ctx="Every year's yield for your state and its counties."),
        "alt": "Corn, soybean and wheat yield by year for every state, from USDA."},
}
SET_SOURCES = {"agsist": None, "rent": None, "yield": None}
# Pages under a folder that get their own card: card name -> page (no .html).
SUB_PAGES = {"lrp-record": "lrp/record"}
SETS["lrp-record"] = card_lrp_record


def rain_state_sets():
    """rain-<st>: one card per state with a data/rain file (rain/<state>.html
    and its county pages; scripts/build_county_rain.py points them here)."""
    d = os.path.join(ROOT, "data", "rain")
    out = {}
    for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        if re.fullmatch(r"[a-z]{2}\.json", f):
            st = f[:2].upper()
            out["rain-" + f[:2]] = (lambda st=st: card_rain_state(st))
    return out


SETS.update(rain_state_sets())


def render(spec):
    a = spec["args"]
    if spec["kind"] == "A":
        return SC.card_a(**a)
    if spec["kind"] == "RAIN":
        return SC.card_rain_map(**a)
    if spec["kind"] == "PRINT":
        return SC.card_print(**a)
    if spec["kind"] == "PHOTO":
        return SC.card_photo(**a)
    return SC.card_c(**a)


def indexable_roots():
    out = []
    for f in sorted(os.listdir(ROOT)):
        if not f.endswith(".html"):
            continue
        h = rd(f)
        if is_indexable(h):
            out.append(f[:-5])
    return out


def is_indexable(h):
    if re.search(r'<meta\s+name="robots"\s+content="[^"]*noindex', h):
        return False
    if 'http-equiv="refresh"' in h:
        return False
    return True


# ------------------------------------------------------------------ meta tags

def _tag_re(attr, name):
    return re.compile(r'<meta\s+' + attr + r'="' + re.escape(name) + r'"\s+content="[^"]*"\s*/?>')


def _set_tag(h, attr, name, value, after):
    pat = _tag_re(attr, name)
    val = htmlmod.escape(value, quote=True)
    m = pat.search(h)
    if m:
        old = m.group(0)
        new = re.sub(r'content="[^"]*"', f'content="{val}"', old, count=1)
        return h[:m.start()] + new + h[m.end():], m.end() + (len(new) - len(old))
    tag = f'<meta {attr}="{name}" content="{val}">'
    if after is None:
        i = h.index("</head>")
        return h[:i] + tag + "\n" + h[i:], i + len(tag)
    # keep the indentation of the line we insert after
    ls = h.rfind("\n", 0, after) + 1
    indent = re.match(r"[ \t]*", h[ls:]).group(0)
    ins = "\n" + indent + tag
    return h[:after] + ins + h[after:], after + len(ins)


def patch_meta(h, url, alt):
    pos = None
    m = _tag_re("property", "og:image").search(h)
    if not m:
        anchor = _tag_re("property", "og:url").search(h) or _tag_re("property", "og:description").search(h)
        pos = anchor.end() if anchor else None
    h, pos = _set_tag(h, "property", "og:image", url, pos)
    h, pos = _set_tag(h, "property", "og:image:width", "1200", pos)
    h, pos = _set_tag(h, "property", "og:image:height", "630", pos)
    h, pos = _set_tag(h, "property", "og:image:alt", alt, pos)
    h, pos = _set_tag(h, "name", "twitter:card", "summary_large_image", pos)
    h, _ = _set_tag(h, "name", "twitter:image", url, pos)
    return h


def patch_ld_image(h, img_rel, url):
    """The same card named in the page's structured data (a Product's image,
    alone or first in a list) follows the new ?v=, and nothing else there moves."""
    pat = re.compile(re.escape(f"{SITE}/{img_rel}") + r'(?:\?v=[0-9a-f]+)?"')

    def fix(m):
        return pat.sub(lambda _: url + '"', m.group(0))
    return re.sub(r'<script type="application/ld\+json">.*?</script>', fix, h, flags=re.S)


def clean_alt(s):
    s = s.replace("—", ", ").replace("–", "-").replace('"', "'")
    return re.sub(r"\s+", " ", s).strip()[:300]


# ------------------------------------------------------------------ build

def write_if_changed(path, data):
    old = None
    if os.path.exists(path):
        with open(path, "rb") as f:
            old = f.read()
    if old == data:
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return True


def build(only=None, strict=False):
    changed, failed = [], []
    pages = [p for p in indexable_roots() if p not in KEEP and p not in OWNED]
    for p in KEEP:
        if p in indexable_roots():
            pages.append(p)
    names = set(pages) | set(SETS)
    if only:
        only = set(only)
        if "lrp" in only:       # the LRP workflow: /lrp and /lrp/record
            only.add("lrp-record")
        if "rain" in only:      # the county rain workflow: the national card and every state's
            only |= {n for n in SETS if n.startswith("rain-") and len(n) == 7}
        names &= only
    # pages that borrow a card go last, so they point at the card just drawn
    for name in sorted(names, key=lambda n: (n in KEEP, n)):
        if name in KEEP:
            img_rel = KEEP[name]
            h = rd(name + ".html")
            alt = (re.search(r'og:image:alt"\s+content="([^"]*)"', h) or [None, None])[1] or h1_of(h) or name
            data = open(os.path.join(ROOT, img_rel), "rb").read()
            _write_page(name, img_rel, data, htmlmod.unescape(alt), changed)
            continue
        fn = CARDS.get(name) or SETS.get(name)
        try:
            spec = fn() if fn else title_card(name)
        except Exception as e:  # never fail a data workflow over a share card
            if strict:
                raise
            print(f"[share] {name}: data card failed ({e!r}); using the title card", file=sys.stderr)
            failed.append(name)
            spec = title_card(name)
        data = render(spec)
        img_rel = f"img/og/{name}.jpg"
        if write_if_changed(os.path.join(ROOT, img_rel), data):
            changed.append(img_rel)
        if name in SUB_PAGES:
            _write_page(SUB_PAGES[name], img_rel, data, clean_alt(spec["alt"]), changed)
            continue
        if name in SETS or name in IMAGE_ONLY:
            continue
        _write_page(name, img_rel, data, clean_alt(spec["alt"]), changed)
    print(f"[share] {len(names)} cards, {len(changed)} files changed" + (f", {len(failed)} fell back: {failed}" if failed else ""))
    return changed, failed


def _write_page(name, img_rel, data, alt, changed, version=True):
    """version: add ?v=<hash> so a changed card gets fetched again."""
    url = f"{SITE}/{img_rel}"
    if version:
        url += "?v=" + hashlib.sha1(data).hexdigest()[:8]
    fp = os.path.join(ROOT, name + ".html")
    with open(fp, encoding="utf-8") as f:
        h = f.read()
    new = patch_ld_image(patch_meta(h, url, alt), img_rel, url)
    if new != h:
        with open(fp, "w", encoding="utf-8") as f:
            f.write(new)
        changed.append(name + ".html")


# ------------------------------------------------------------------ check

def _meta(h, attr, name):
    m = re.search(r'<meta\s+' + attr + r'="' + re.escape(name) + r'"\s+content="([^"]*)"', h)
    return htmlmod.unescape(m.group(1)) if m else None


def check_page(rel, h, sizes):
    """Problems with one page's share tags; [] when fine."""
    from PIL import Image
    bad = []
    og = _meta(h, "property", "og:image")
    tw = _meta(h, "name", "twitter:image")
    alt = _meta(h, "property", "og:image:alt")
    if not og:
        return ["no og:image"]
    if not tw:
        bad.append("no twitter:image")
    elif tw != og:
        bad.append("twitter:image differs from og:image")
    if not alt or not alt.strip():
        bad.append("no og:image:alt")
    if _meta(h, "property", "og:image:width") != "1200" or _meta(h, "property", "og:image:height") != "630":
        bad.append("og:image:width/height not 1200x630")
    if not og.startswith(SITE + "/"):
        bad.append(f"og:image not on agsist.com: {og}")
        return bad
    local = og[len(SITE) + 1:].split("?")[0]
    if local not in sizes:
        fp = os.path.join(ROOT, local)
        if not os.path.exists(fp):
            sizes[local] = None
        else:
            with Image.open(fp) as im:
                sizes[local] = (im.size, os.path.getsize(fp))
    info = sizes[local]
    if info is None:
        bad.append(f"og:image file missing: {local}")
    else:
        (w, hh), n = info
        if (w, hh) != (1200, 630):
            bad.append(f"{local} is {w}x{hh}, not 1200x630")
        if n > SC.MAX_BYTES:
            bad.append(f"{local} is {n // 1024} KB, over {SC.MAX_BYTES // 1024} KB")
    return bad


def all_html():
    skip = {".git", ".github", "node_modules", "scripts", "test", "vendor", "components", "workers"}
    for dp, dns, fns in os.walk(ROOT):
        dns[:] = [d for d in dns if d not in skip and not d.startswith(".")]
        for f in fns:
            if f.endswith(".html"):
                yield os.path.relpath(os.path.join(dp, f), ROOT)


def check(verbose=True):
    sizes, problems, n = {}, {}, 0
    for rel in sorted(all_html()):
        with open(os.path.join(ROOT, rel), encoding="utf-8", errors="replace") as f:
            h = f.read()
        if not is_indexable(h):
            continue
        n += 1
        bad = check_page(rel, h, sizes)
        if bad:
            problems[rel] = bad
    if verbose:
        for rel, bad in list(problems.items())[:40]:
            print(f"  {rel}: {'; '.join(bad)}")
        if len(problems) > 40:
            print(f"  ... and {len(problems) - 40} more")
        print(f"[share] checked {n} indexable pages, {len(sizes)} images: "
              f"{'OK' if not problems else str(len(problems)) + ' with problems'}")
    return problems


def selftest():
    h = ('<html><head>\n  <meta property="og:url" content="https://agsist.com/x">\n'
         '  <meta property="og:image"   content="https://agsist.com/img/og/old.jpg">\n</head></html>')
    o = patch_meta(h, "https://agsist.com/img/og/x.jpg?v=1", 'Say "hi"')
    assert 'og:image"   content="https://agsist.com/img/og/x.jpg?v=1"' in o, o
    assert o.count("og:image:width") == 1 and '\n  <meta property="og:image:width"' in o, o
    assert 'twitter:image" content="https://agsist.com/img/og/x.jpg?v=1"' in o, o
    assert "&quot;hi&quot;" in o, o
    assert patch_meta(o, "https://agsist.com/img/og/x.jpg?v=1", 'Say "hi"') == o, "not idempotent"
    h2 = '<html><head><meta property="og:url" content="u"></head></html>'
    o2 = patch_meta(h2, "https://agsist.com/a.jpg", "a")
    assert o2.index("og:url") < o2.index('"og:image"') < o2.index("twitter:image"), o2
    assert cents_frac(4.8125) == "$4.81 1/4" and cents_frac(4.81) == "$4.81" and cents_frac(12.775) == "$12.77 1/2"
    assert text("224&ndash;200 &middot; Apr") == "224-200 · Apr"
    assert not is_indexable('<meta name="robots" content="noindex,follow">')
    assert is_indexable('<meta name="robots" content="index, follow">')
    print("[share] selftest ok")


def main(argv):
    if "--selftest" in argv:
        selftest()
        return 0
    if "--check" in argv:
        return 1 if check() else 0
    only = None
    if "--only" in argv:
        only = [x.strip() for x in argv[argv.index("--only") + 1].split(",") if x.strip()]
    build(only, strict="--strict" in argv)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
