#!/usr/bin/env python3
"""build_state_rent_pages.py — 47 per-state cash-rent pages + /rent hub, from
data/cash-rent/*.json. OFFLINE — reads committed data, writes rent/*.html.

WHY GENERATED, NOT HAND-WRITTEN: the numbers refresh every August. CI reruns
this after fetch_cash_rent.py lands new data and the pages stay true. Nobody
hand-uploads 47 files, ever. The pages are MACHINE-OWNED (like sitemap.xml):
edit this script, never the emitted HTML.

URL scheme (GitHub Pages extensionless): rent/iowa.html -> /rent/iowa,
rent/index.html -> /rent/. No collision with /cash-rent (cash-rent.html).

Honesty rules carried in:
  - YoY and 10-yr deltas use MATCHED counties only (both years published) —
    composition drift would otherwise invent a trend.
  - 2015 labeled "no survey"; other missing years "not published". No line
    is drawn across a gap.
  - Primary land type per state is whichever has the most 2025 counties
    (AZ/NV are irrigated states) and every table/stat SAYS which it is.
  - County medians of published counties only, labeled as such.

No naked squiggles: history is a labeled bar table (year + $ printed on
every bar), not a sparkline.

--selftest builds everything to a temp dir and asserts invariants.
"""
import glob
import html
import json
import os
import statistics
import sys

DATA_DIR = "data/cash-rent"
OUT_DIR = "rent"
SITE = "https://agsist.com"

STATE_NAMES = {
    "AL": "Alabama", "AR": "Arkansas", "AZ": "Arizona", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida",
    "GA": "Georgia", "IA": "Iowa", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "MA": "Massachusetts", "MD": "Maryland", "ME": "Maine", "MI": "Michigan",
    "MN": "Minnesota", "MO": "Missouri", "MS": "Mississippi", "MT": "Montana",
    "NC": "North Carolina", "ND": "North Dakota", "NE": "Nebraska",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
    "NV": "Nevada", "NY": "New York", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VA": "Virginia", "VT": "Vermont", "WA": "Washington", "WI": "Wisconsin",
    "WV": "West Virginia", "WY": "Wyoming",
}
TYPE_LABEL = {"nonirr": "non-irrigated cropland", "irr": "irrigated cropland",
              "pasture": "permanent pasture"}
TYPE_SHORT = {"nonirr": "Non-irrigated", "irr": "Irrigated", "pasture": "Pasture"}
# Statutory termination-notice facts, same tier-1 set cash-lease.html cites.
NOTICE = {
    "IA": "September 1 before the lease year ends (Iowa Code &sect;562.7)",
    "IL": "4 months before the end of the lease year (735 ILCS 5/9-206)",
    "IN": "3 months before the end of the lease year (Ind. Code &sect;32-31-1-3)",
    "KS": "30 days before March 1 (K.S.A. &sect;58-2506)",
    "NE": "September 1 for oral/holdover leases (Neb. Rev. Stat. &sect;76-1445)",
    "SD": "September 1 before the new lease year (SDCL &sect;43-32-13)",
}


def slug(name):
    return name.lower().replace(" ", "-")


def esc(s):
    return html.escape(str(s), quote=True)


def money(v):
    return f"${v:,.0f}" if v == int(v) else f"${v:,.2f}".rstrip("0").rstrip(".")


def latest(d):
    """{'2025': v, ...} -> (year:int, v) of newest, or (None, None)."""
    if not d:
        return None, None
    y = max(d, key=int)
    return int(y), d[y]


def med(vals):
    return round(statistics.median(vals), 2) if vals else None


def load_states():
    out = {}
    for f in sorted(glob.glob(f"{DATA_DIR}/[A-Z][A-Z].json")):
        d = json.load(open(f))
        if d.get("state") in STATE_NAMES:
            out[d["state"]] = d
    return out


def state_stats(d):
    """Everything the page needs, computed once, honesty rules applied."""
    counties = d.get("counties", [])
    yr_latest = max(int(y) for y in d.get("years", [2025]))
    # primary type = most counties published in the latest year
    coverage = {t: sum(1 for c in counties if str(yr_latest) in c["rent"].get(t, {}))
                for t in ("nonirr", "irr", "pasture")}
    primary = max(("nonirr", "irr", "pasture"), key=lambda t: (coverage[t], t == "nonirr"))
    have_types = [t for t in ("nonirr", "irr", "pasture") if coverage[t]]

    cur = {c["name"]: c["rent"][primary][str(yr_latest)]
           for c in counties if str(yr_latest) in c["rent"].get(primary, {})}

    def matched_delta(back_to):
        pairs = [(c["rent"][primary][str(yr_latest)], c["rent"][primary][str(back_to)])
                 for c in counties
                 if str(yr_latest) in c["rent"].get(primary, {})
                 and str(back_to) in c["rent"].get(primary, {})]
        if len(pairs) < 5:
            return None, 0
        now = med([p[0] for p in pairs]); then = med([p[1] for p in pairs])
        return round(100 * (now - then) / then, 1), len(pairs)

    yoy, yoy_n = matched_delta(yr_latest - 1)
    dec, dec_n = matched_delta(yr_latest - 9)

    # median of published counties, per year, primary type — for the bar table
    hist = []
    all_years = sorted({int(y) for c in counties for y in c["rent"].get(primary, {})})
    for y in range(min(all_years), yr_latest + 1) if all_years else []:
        vals = [c["rent"][primary][str(y)] for c in counties
                if str(y) in c["rent"].get(primary, {})]
        if vals:
            hist.append({"y": y, "v": med(vals), "n": len(vals)})
        else:
            hist.append({"y": y, "v": None,
                         "why": "no survey" if y in d.get("no_survey_years", []) else "not published"})
    ranked = sorted(cur.items(), key=lambda kv: -kv[1])
    return {
        "yr": yr_latest, "primary": primary, "have_types": have_types,
        "coverage": coverage, "n": len(cur), "median": med(list(cur.values())),
        "yoy": yoy, "yoy_n": yoy_n, "dec": dec, "dec_n": dec_n,
        "hi": ranked[:5], "lo": ranked[-5:][::-1] if len(ranked) >= 5 else [],
        "hist": hist, "counties": counties,
    }


# ---------------------------------------------------------------- HTML pieces
def head(title, desc, path, jsonld):
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0a0c0d">
  <link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-6KXCTD5Z9H');function gaEvent(n,p){{try{{gtag('event',n,p||{{}});}}catch(e){{}}}}</script>
  <link rel="preload" href="/components/styles.css?v=12" as="style">
  <link rel="stylesheet" href="/components/styles.css?v=12">
  <link rel="icon" type="image/x-icon" href="/img/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/img/favicon-16.png">
  <link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.json">
  <title>{esc(title)} | AGSIST</title>
  <meta name="description" content="{esc(desc)}">
  <link rel="canonical" href="{SITE}{path}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="AGSIST">
  <meta property="og:locale" content="en_US">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(desc)}">
  <meta property="og:url" content="{SITE}{path}">
  <meta property="og:image" content="{SITE}/img/og/agsist.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@agsist">
  <meta name="twitter:title" content="{esc(title)}">
  <meta name="twitter:description" content="{esc(desc)}">
  <meta name="twitter:image" content="{SITE}/img/og/agsist.jpg">
  <script type="application/ld+json">
{json.dumps(jsonld, indent=1)}
  </script>
  <style>
    .rs-wrap{{max-width:1060px;margin:0 auto;padding:0 16px}}
    .rs-hero{{display:flex;flex-wrap:wrap;gap:14px;margin:14px 0}}
    .rs-stat{{background:#101415;border:1px solid #1a1f20;border-radius:10px;padding:12px 16px;min-width:150px;flex:1}}
    .rs-stat .v{{font-family:'JetBrains Mono',monospace;font-size:1.45rem;color:#e6ebe9}}
    .rs-stat .l{{font-size:.72rem;color:#8a948f;letter-spacing:.05em;text-transform:uppercase;margin-top:2px}}
    .rs-stat .s{{font-size:.72rem;color:#8a948f;margin-top:2px}}
    .up{{color:#5fc28a}}.dn{{color:#e0685f}}
    table.rs-t{{width:100%;border-collapse:collapse;font-size:.85rem;margin:10px 0}}
    .rs-t th{{text-align:right;color:#8a948f;font-size:.68rem;letter-spacing:.07em;text-transform:uppercase;padding:7px 9px;border-bottom:1px solid #1a1f20;cursor:pointer;white-space:nowrap;user-select:none}}
    .rs-t th:first-child,.rs-t td:first-child{{text-align:left}}
    .rs-t td{{padding:6px 9px;border-bottom:1px solid #14181a;text-align:right;font-family:'JetBrains Mono',monospace;white-space:nowrap;color:#e6ebe9}}
    .rs-t td:first-child{{font-family:Archivo,Inter,sans-serif;color:#e6ebe9}}
    .rs-t tr:hover td{{background:#101415}}
    .rs-t .mut{{color:#5a6467}}
    .rs-bars{{margin:8px 0}}
    .rs-bar{{display:flex;align-items:center;gap:10px;margin:3px 0;font-family:'JetBrains Mono',monospace;font-size:.78rem}}
    .rs-bar .y{{width:42px;color:#8a948f}}
    .rs-bar .b{{height:13px;background:linear-gradient(90deg,#2c4a3a,#5fc28a);border-radius:3px;min-width:2px}}
    .rs-bar .v{{color:#e6ebe9}}
    .rs-bar .gap{{color:#5a6467;font-style:italic;font-size:.74rem}}
    .rs-note{{background:#101415;border:1px solid #1a1f20;border-left:3px solid #d4a23f;border-radius:8px;padding:12px 15px;font-size:.85rem;line-height:1.65;color:#8a948f;margin:14px 0}}
    .rs-note b{{color:#e6ebe9}}
    .rs-links a{{color:#d4a23f}}
    .rs-cloud{{font-size:.78rem;line-height:2;color:#8a948f}}
    .rs-cloud a{{color:#8a948f;text-decoration:none;border-bottom:1px dotted #2a3133}}
    .rs-cloud a:hover{{color:#d4a23f}}
    .ag-sponsor-ribbon{{display:block;font-size:.74rem;padding:.45rem .85rem;margin:1rem 0;border:1px solid rgba(132,160,168,.18);border-radius:8px;color:#8a948f;line-height:1.6}}
    .ag-sponsor-ribbon .ag-sponsor-tag{{font-family:'JetBrains Mono',monospace;font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:#d4a23f;margin-right:.5rem}}
    .ag-sponsor-ribbon a{{color:#d4a23f}}
    h1{{font-size:1.55rem;margin:14px 0 4px}} h2{{font-size:1.12rem;margin:26px 0 6px}}
    .sub{{color:#8a948f;font-size:.9rem;line-height:1.6}}
  </style>
</head>"""


def delta_html(v, n, label):
    if v is None:
        return f'<div class="v mut">&mdash;</div><div class="l">{label}</div><div class="s">too few matched counties</div>'
    cls = "up" if v >= 0 else "dn"
    sign = "+" if v >= 0 else ""
    return (f'<div class="v {cls}">{sign}{v}%</div><div class="l">{label}</div>'
            f'<div class="s">median of {n} matched counties</div>')


def bars_html(hist):
    vals = [h["v"] for h in hist if h.get("v") is not None]
    top = max(vals) if vals else 1
    rows = []
    for h in hist:
        if h.get("v") is None:
            rows.append(f'<div class="rs-bar"><span class="y">{h["y"]}</span>'
                        f'<span class="gap">{h["why"]} &mdash; gap shown, not interpolated</span></div>')
        else:
            w = max(2, round(100 * h["v"] / top, 1))
            rows.append(f'<div class="rs-bar"><span class="y">{h["y"]}</span>'
                        f'<div class="b" style="width:{w}%"></div>'
                        f'<span class="v">{money(h["v"])}</span>'
                        f'<span class="mut" style="color:#5a6467;font-size:.7rem">{h["n"]} co.</span></div>')
    return '<div class="rs-bars">' + "".join(rows) + "</div>"


def county_table(st, s):
    yr = s["yr"]
    cols = [(t, TYPE_LABEL[t]) for t in ("nonirr", "irr", "pasture") if t in s["have_types"]]
    thead = "<th>County</th>" + "".join(
        f'<th title="{lab}, $/acre">{TYPE_SHORT[t]} {yr}</th>' for t, lab in cols)
    thead += "<th>YoY</th><th>Corn trend</th>"
    body = []
    for c in sorted(s["counties"], key=lambda c: c["name"]):
        cells = [f"<td>{esc(c['name'])}</td>"]
        for t, _ in cols:
            r = c["rent"].get(t, {})
            if str(yr) in r:
                cells.append(f'<td data-v="{r[str(yr)]}">{money(r[str(yr)])}</td>')
            else:
                ly, lv = latest(r)
                cells.append(f'<td class="mut" data-v="{lv if lv is not None else -1}">'
                             + (f"{money(lv)} <span style='font-size:.68rem'>({ly})</span>" if lv is not None else "&mdash;")
                             + "</td>")
        p = c["rent"].get(s["primary"], {})
        if str(yr) in p and str(yr - 1) in p and p[str(yr - 1)]:
            ch = 100 * (p[str(yr)] - p[str(yr - 1)]) / p[str(yr - 1)]
            cells.append(f'<td class="{"up" if ch >= 0 else "dn"}" data-v="{ch:.1f}">{"+" if ch >= 0 else ""}{ch:.1f}%</td>')
        else:
            cells.append('<td class="mut" data-v="-999">&mdash;</td>')
        ct = (c.get("yield", {}).get("corn") or {}).get("trend")
        cells.append(f'<td data-v="{ct if ct is not None else -1}">'
                     + (f"{ct:.0f} bu" if ct is not None else '<span class="mut">&mdash;</span>') + "</td>")
        body.append("<tr>" + "".join(cells) + "</tr>")
    return (f'<table class="rs-t" id="rs-table"><thead><tr>{thead}</tr></thead>'
            f'<tbody>{"".join(body)}</tbody></table>')


SORT_JS = """<script>
(function(){var t=document.getElementById('rs-table');if(!t)return;
var ths=t.tHead.rows[0].cells,dir=1,last=-1;
for(let i=0;i<ths.length;i++)ths[i].addEventListener('click',function(){
 dir=(last===i)?-dir:(i===0?1:-1);last=i;
 var rows=[].slice.call(t.tBodies[0].rows);
 rows.sort(function(a,b){
  if(i===0)return dir*a.cells[0].textContent.localeCompare(b.cells[0].textContent);
  return dir*((+a.cells[i].getAttribute('data-v')||0)-(+b.cells[i].getAttribute('data-v')||0));
 });
 rows.forEach(function(r){t.tBodies[0].appendChild(r);});
 gaEvent('rent_state_sort',{col:ths[i].textContent});
});})();
</script>"""


def explore_nav():
    L = lambda h, t: f'<a href="{h}" style="color:var(--text-muted);text-decoration:none">{t}</a>'
    return ('<nav aria-label="Explore AGSIST" style="max-width:1060px;margin:26px auto 8px;padding:0 16px;font-size:12.5px;line-height:2.1">'
            '<span style="color:var(--text-dim);font-weight:700">Land:</span> '
            + " &middot; ".join([L("/cash-rent", "Cash Rent by County"),
                                 L("/cash-lease", "Cash Farm Lease"), L("/foreign-land", "Foreign-Owned Land")])
            + '<br><span style="color:var(--text-dim);font-weight:700">Markets:</span> '
            + " &middot; ".join([L("/markets", "Futures"), L("/cash-bids", "Cash Bids"), L("/basis", "Basis vs Normal"),
                                 L("/whats-priced-in", "What&rsquo;s Priced In"), L("/cot", "COT")])
            + '<br><span style="color:var(--text-dim);font-weight:700">Field:</span> '
            + " &middot; ".join([L("/conditions", "Crop Conditions Rank"), L("/drought-monitor", "Drought Monitor"),
                                 L("/hail-map", "Hail Map"), L("/breakeven", "Break-Even"), L("/daily", "Daily Briefing")])
            + "</nav>")


def state_cloud(states, exclude=None):
    links = [f'<a href="/rent/{slug(STATE_NAMES[st])}">{STATE_NAMES[st]}</a>'
             for st in sorted(states, key=lambda s: STATE_NAMES[s]) if st != exclude]
    return '<p class="rs-cloud">' + " &middot; ".join(links) + "</p>"


def build_state_page(st, d, s, all_states):
    name = STATE_NAMES[st]
    sl = slug(name)
    yr = s["yr"]
    plabel = TYPE_LABEL[s["primary"]]
    title = f"{name} Cash Rent by County {yr} — ${{}}/acre Rates &amp; History".format("")
    title = f"{name} Cash Rent by County {yr}"
    desc = (f"{name} farmland cash rent {yr}: median {money(s['median'])}/acre ({plabel}) across "
            f"{s['n']} published counties. Every county's USDA rate, history to 2008, free.")[:160]
    hi_s = ", ".join(f"{esc(n)} ({money(v)})" for n, v in s["hi"][:3])
    lo_s = ", ".join(f"{esc(n)} ({money(v)})" for n, v in s["lo"][:3])
    faq = [
        {"q": f"What is the average cash rent per acre in {name} for {yr}?",
         "a": f"The median USDA NASS county cash rent for {plabel} in {name} is {money(s['median'])} per acre "
              f"across the {s['n']} counties with a published {yr} rate. Rents vary widely by county: "
              f"highest {hi_s}; lowest {lo_s}. The county mean is a survey reference point, not a rate card."},
        {"q": f"How much did {name} cash rent change from {yr-1} to {yr}?",
         "a": (f"Comparing the same {s['yoy_n']} counties published in both years, the median {plabel} rent moved "
               f"{'+' if s['yoy'] and s['yoy'] >= 0 else ''}{s['yoy']}% year over year."
               if s["yoy"] is not None else
               "Too few counties were published in both years for an honest year-over-year figure.")},
        {"q": f"Why is my {name} county not listed?",
         "a": "USDA NASS publishes a county rate only where enough Cash Rents Survey responses came back "
              "(and the county has at least 20,000 acres of cropland plus pasture). If your county is missing, "
              "NASS did not publish a rate for it — this page never estimates one."},
        {"q": "When is county cash rent data released?",
         "a": "USDA NASS releases county cash rent estimates each August for the current crop year. "
              "This page rebuilds automatically when new data lands."},
    ]
    if st in NOTICE:
        faq.append({"q": f"When must I give notice to terminate a {name} farm lease?",
                    "a": f"{name} statute sets the deadline at {NOTICE[st].replace('&sect;', 'section ')}. "
                         f"Miss it and the lease typically continues another year on the same terms. "
                         f"See the AGSIST cash farm lease for the details and a printable lease."})
    jsonld = {"@context": "https://schema.org", "@graph": [
        {"@type": "Dataset",
         "@id": f"{SITE}/rent/{sl}#dataset",
         "name": f"{name} County Cash Rental Rates",
         "description": f"County-level cash rent for {', '.join(TYPE_LABEL[t] for t in s['have_types'])} in {name}, "
                        f"as published annually by USDA NASS, 2008 to {yr}.",
         "url": f"{SITE}/rent/{sl}",
         "license": "https://www.usa.gov/government-works",
         "isAccessibleForFree": True,
         "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE},
         "temporalCoverage": f"2008/{yr}",
         "spatialCoverage": {"@type": "Place", "name": f"{name}, United States"}},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "AGSIST", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "Cash Rent by State", "item": f"{SITE}/rent/"},
            {"@type": "ListItem", "position": 3, "name": name, "item": f"{SITE}/rent/{sl}"}]},
        {"@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": f["q"],
             "acceptedAnswer": {"@type": "Answer", "text": f["a"]}} for f in faq]},
    ]}
    seed = (f"{s['n']} {name} counties with a published {yr} {plabel} rent &middot; "
            f"median {money(s['median'])}/acre"
            + (f" &middot; {'+' if s['yoy'] >= 0 else ''}{s['yoy']}% vs {yr-1} (matched counties)" if s["yoy"] is not None else "")
            + f" &middot; data refreshed {esc(d.get('generated', ''))}")
    other_types = ""
    if len(s["have_types"]) > 1:
        other_types = (" Columns cover " + ", ".join(TYPE_LABEL[t] for t in s["have_types"])
                       + f"; state stats above use {plabel} (the most-published type here).")
    hero = f"""
  <div class="rs-hero">
    <div class="rs-stat"><div class="v">{money(s['median'])}</div><div class="l">median rent /ac &middot; {yr}</div><div class="s">{plabel}, {s['n']} counties</div></div>
    <div class="rs-stat">{delta_html(s['yoy'], s['yoy_n'], f'vs {yr-1}')}</div>
    <div class="rs-stat">{delta_html(s['dec'], s['dec_n'], f'vs {yr-9}')}</div>
    <div class="rs-stat"><div class="v">{money(s['hi'][0][1]) if s['hi'] else '&mdash;'}</div><div class="l">top county</div><div class="s">{esc(s['hi'][0][0]) if s['hi'] else ''}</div></div>
  </div>"""
    page = head(title, desc, f"/rent/{sl}", jsonld) + f"""
<body>
<div id="site-header"></div>
<main class="rs-wrap">
  <p class="sub" style="margin-top:14px"><a href="/rent/" style="color:#8a948f">Cash Rent by State</a> &rsaquo; <b style="color:#e6ebe9">{name}</b></p>
  <h1>{name} Cash Rent by County &mdash; {yr}</h1>
  <p class="sub">Every USDA-published county cash rental rate in {name}, straight from the NASS Cash Rents
  Survey &mdash; no estimates, no modeling, no login. <span id="rs-seed"><!--SEED:rentstate-->{seed}<!--/SEED--></span></p>
  <aside class="ag-sponsor-ribbon"><span class="ag-sponsor-tag">Sponsor this page</span> Everyone on this page is pricing {name} ground &mdash; one category-exclusive slot. <a href="/sponsor?slot=rent-{st.lower()}&amp;utm_source=rent-{sl}&amp;utm_medium=slot">Put your name here &rarr;</a></aside>
  {hero}
  <h2>Every published county, {yr}</h2>
  <p class="sub">Click a column to sort. Greyed values are the county&rsquo;s most recent published year where {yr}
  wasn&rsquo;t published.{other_types} Corn trend is the AGSIST least-squares trend yield from NASS county estimates.</p>
  {county_table(st, s)}
  <h2>{name} median county rent by year</h2>
  <p class="sub">Median of counties published each year ({plabel}). Gap years are shown as gaps &mdash;
  drawing a line across them would be an invention.</p>
  {bars_html(s['hist'])}
  <div class="rs-note"><b>Honest limits.</b> These are county <b>means from a voluntary USDA survey</b> &mdash;
  rents vary widely inside a county, driven by soil, drainage, field size and how badly a neighbor wants the
  ground. Year-over-year stats above compare only counties published in both years, so a county dropping out
  of the survey can&rsquo;t fake a trend. Treat any county number as the start of a conversation, not a rate card.</div>
  <div class="rs-note rs-links" style="border-left-color:#5fc28a"><b>Do something with it:</b>
  see this county on the <a href="/cash-rent">national rent map</a> (with rent as a share of what the acre can
  actually gross) &middot; put a number in a <a href="/cash-lease?st={st}">printable {name} cash lease</a>{
      " &mdash; termination notice: " + NOTICE[st] if st in NOTICE else ""} &middot;
  check <a href="/basis">local basis vs normal</a> before you commit to a rent that needs a price.</div>
  <h2>Other states</h2>
  {state_cloud(all_states, exclude=st)}
  <p class="sub" style="font-size:.75rem;margin:18px 0">Source: USDA NASS Quick Stats &mdash; Cash Rents Survey county
  estimates (released each August) and county yield estimates. Page rebuilt automatically from data refreshed
  {esc(d.get('generated', ''))}. AGSIST is free and sells nothing on this page.</p>
</main>
{explore_nav()}
<div id="site-footer"></div>
<script src="/components/loader.js?v=14"></script>
{SORT_JS}
</body>
</html>
"""
    return page


def build_hub(states, stats, generated):
    yr = max(s["yr"] for s in stats.values())
    rows = []
    for st in sorted(states, key=lambda s: STATE_NAMES[s]):
        s = stats[st]
        yoy = (f'<td class="{"up" if s["yoy"] >= 0 else "dn"}" data-v="{s["yoy"]}">'
               f'{"+" if s["yoy"] >= 0 else ""}{s["yoy"]}%</td>') if s["yoy"] is not None \
            else '<td class="mut" data-v="-999">&mdash;</td>'
        rows.append(
            f'<tr><td><a href="/rent/{slug(STATE_NAMES[st])}" style="color:#e6ebe9">{STATE_NAMES[st]}</a></td>'
            f'<td data-v="{s["median"]}">{money(s["median"])}</td>{yoy}'
            f'<td data-v="{s["n"]}">{s["n"]}</td>'
            f'<td style="font-family:Archivo,Inter,sans-serif;color:#8a948f">{TYPE_SHORT[s["primary"]]}</td></tr>')
    medians = sorted(((s["median"], st) for st, s in stats.items()), reverse=True)
    desc = (f"USDA county cash rent for all {len(states)} published states, {yr}: median $/acre, change vs "
            f"{yr-1}, and every county's rate one click deep. Free, sources shown.")[:160]
    jsonld = {"@context": "https://schema.org", "@graph": [
        {"@type": "CollectionPage", "name": f"Cash Rent by State — {yr}",
         "url": f"{SITE}/rent/", "isAccessibleForFree": True,
         "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE}},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "AGSIST", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "Cash Rent by State", "item": f"{SITE}/rent/"}]},
    ]}
    seed = (f"{len(states)} states &middot; highest median: {STATE_NAMES[medians[0][1]]} {money(medians[0][0])}/ac "
            f"&middot; lowest: {STATE_NAMES[medians[-1][1]]} {money(medians[-1][0])}/ac &middot; "
            f"data refreshed {esc(generated)}")
    page = head(f"Cash Rent by State {yr} — Every County&rsquo;s USDA Rate", desc, "/rent/", jsonld) + f"""
<body>
<div id="site-header"></div>
<main class="rs-wrap">
  <h1>Cash Rent by State &mdash; {yr}</h1>
  <p class="sub">Pick a state for every published county&rsquo;s USDA cash rental rate, history to 2008, and the
  statutory lease-termination deadline where the state has one.
  <span id="rs-seed"><!--SEED:renthub-->{seed}<!--/SEED--></span></p>
  <aside class="ag-sponsor-ribbon"><span class="ag-sponsor-tag">Sponsor this page</span> The doorway to every county rent rate in America &mdash; one category-exclusive slot. <a href="/sponsor?slot=rent-hub&amp;utm_source=rent-hub&amp;utm_medium=slot">Put your name here &rarr;</a></aside>
  <table class="rs-t" id="rs-table"><thead><tr><th>State</th><th>Median rent /ac</th><th>YoY</th><th>Counties</th><th>Type</th></tr></thead>
  <tbody>{"".join(rows)}</tbody></table>
  <p class="sub">Medians are of published counties, most-published land type per state (marked). Matched-county
  YoY. The <a href="/cash-rent" style="color:#d4a23f">national county map</a> shows all of this on one screen,
  plus rent as a share of what the acre can actually gross.</p>
  <p class="sub" style="font-size:.75rem;margin:18px 0">Source: USDA NASS Cash Rents Survey county estimates.
  Pages rebuild automatically when NASS publishes (each August). Data refreshed {esc(generated)}.</p>
</main>
{explore_nav()}
<div id="site-footer"></div>
<script src="/components/loader.js?v=14"></script>
{SORT_JS}
</body>
</html>
"""
    return page


def build_all(out_dir=OUT_DIR):
    data = load_states()
    if not data:
        raise SystemExit("FATAL: no state files in data/cash-rent — refusing to build empty pages")
    stats = {st: state_stats(d) for st, d in data.items()}
    os.makedirs(out_dir, exist_ok=True)
    urls = [f"{SITE}/rent/"]
    open(os.path.join(out_dir, "index.html"), "w").write(
        build_hub(list(data), stats, next(iter(data.values())).get("generated", "")))
    for st, d in data.items():
        p = build_state_page(st, d, stats[st], list(data))
        open(os.path.join(out_dir, f"{slug(STATE_NAMES[st])}.html"), "w").write(p)
        urls.append(f"{SITE}/rent/{slug(STATE_NAMES[st])}")
    # stderr, NOT stdout: --print-urls pipes stdout into the sitemap step,
    # and this line as line 1 of that file broke the first live run (exit 2).
    print(f"built {len(data)} state pages + hub -> {out_dir}/", file=sys.stderr)
    return urls, stats


def selftest():
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        urls, stats = build_all(out_dir=td)
        assert len(urls) >= 40, f"expected ~48 URLs, got {len(urls)}"
        ia = open(os.path.join(td, "iowa.html")).read()
        s = stats["IA"]
        assert s["primary"] == "nonirr", "IA primary type wrong"
        assert money(s["median"]) in ia, "IA median not baked into page"
        assert "SEED:rentstate" in ia and "FAQPage" in ia and "canonical" in ia
        assert "September 1" in ia, "IA termination notice missing"
        assert 'no survey' in ia, "2015 gap not shown honestly"
        assert ia.count("<tr>") >= 99, "IA county rows missing"
        assert "/rent/texas" in ia, "state cloud missing"
        hub = open(os.path.join(td, "index.html")).read()
        assert hub.count("/rent/") >= 47 and "SEED:renthub" in hub
        # NV/AZ: irrigated-primary states must be labeled
        if "AZ" in stats:
            az = open(os.path.join(td, "arizona.html")).read()
            assert TYPE_LABEL[stats["AZ"]["primary"]].split()[0] in az
        print(f"SELFTEST OK — {len(urls)} URLs; IA baked stats, FAQ, notice, gap honesty, "
              f"county rows, link cloud, hub all verified")


def main():
    if "--selftest" in sys.argv:
        return selftest()
    if "--print-urls" in sys.argv:
        # stdout is the URL list and NOTHING else — the workflow pipes it
        # straight into update_sitemap.py --add. Any stray print anywhere in
        # build_all is forced to stderr so this can never break again.
        import contextlib
        with contextlib.redirect_stdout(sys.stderr):
            urls, _ = build_all()
        print("\n".join(urls))
    else:
        build_all()


if __name__ == "__main__":
    main()
