#!/usr/bin/env python3
"""build_prf_counties.py: one PRF page per county, prf/<state>/<county>.html.

WHY
  "PRF <county> county", "PRF grid 30454" and "PRF payout history <county>"
  are what people type in October and November. /prf is the calculator and
  /prf/<state> covers the state; these pages answer the county question in
  plain HTML a crawler can read without running the calculator: the grids that
  touch the county (by number), USDA's county base values for grazing and hay,
  what each pair of months costs there at 90% coverage, how often each pair
  came in under 90% of normal since 1951, what the last five years and this
  year so far did, and the dates. Every grid opens the calculator on itself.

WHERE THE NUMBERS COME FROM
  data/prf/meta.json and data/prf/s/<ST>.json (USDA's county values and
  limits, copied unchanged), and scripts/prf_county_facts.mjs, which works out
  every count and middle from data/prf/g and data/prf/y with
  components/prf-math.js and prints them. Nothing is computed here; this
  formats. The county facts are not written to a file, so no extra data is
  published.

  URLs follow the Farmland Atlas (farmland-atlas/data/counties-index.json, by
  county code) so /prf/texas/anderson-county sits beside
  /farmland-atlas/texas/anderson-county and /arc-plc/texas/anderson-county.

SIZE (CLAUDE.md): 3,070 pages. The page carries the answer and the tables a
  reader needs at first glance; the full year-by-year record and the pricing
  stay in the calculator, loaded on demand. No static header or footer copy (loader.js
  fills both); the breadcrumb and the links at the foot give crawlers the way
  up and across. The build refuses any page
  over MAX_KB and prints the total. Run scripts/check_site_budget.py after.

  python3 scripts/build_prf_counties.py           write prf/<state>/<county>.html and sitemap-prf.xml
  python3 scripts/build_prf_counties.py --check   exit 1 if any page or the sitemap differs from what this would write
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import build_prf_states as S  # noqa: E402  shared helpers: long_date, money2, slug, boot, text_of
import inject_static_nav as nav  # noqa: E402
from county_rain import STATES as RAIN_STATES, slug as rain_slug  # noqa: E402  the 50 states with a /rain/<state> page

D = os.path.join(ROOT, "data", "prf")
OUT = os.path.join(ROOT, "prf")
SITEMAP = os.path.join(ROOT, "sitemap-prf.xml")
MAX_KB = 40          # well under the 150 KB set cap; the target is about 20
MAX_GRID_ROWS = 30   # a county with more grids lists the rest by number
SHORT_IV = ["Jan-Feb", "Feb-Mar", "Mar-Apr", "Apr-May", "May-Jun", "Jun-Jul", "Jul-Aug", "Aug-Sep", "Sep-Oct", "Oct-Nov", "Nov-Dec"]
e = S.e
money2 = S.money2


def county_facts():
    r = subprocess.run(["node", os.path.join(ROOT, "scripts", "prf_county_facts.mjs")], capture_output=True, text=True, check=False)
    if r.returncode != 0:
        raise SystemExit("prf_county_facts.mjs failed:\n" + r.stderr)
    return json.loads(r.stdout)


def atlas_index():
    """fips -> (display name without the state, page slug). Empty if the Atlas index is missing."""
    p = os.path.join(ROOT, "farmland-atlas", "data", "counties-index.json")
    if not os.path.exists(p):
        return {}
    out = {}
    for fips, label, href in json.load(open(p, encoding="utf-8")):
        out[fips] = (re.sub(r",\s*[A-Z]{2}$", "", label), href.rstrip("/").rsplit("/", 1)[-1])
    return out


def place(st_code, fips, adm_name, ATL):
    """(display name, slug) for a county."""
    if fips in ATL:
        return ATL[fips]
    if st_code == "CT":
        n = f"{adm_name} Planning Region" if "Planning Region" not in adm_name else adm_name
    elif st_code == "LA":
        n = f"{adm_name} Parish"
    else:
        n = f"{adm_name} County"
    return n, S.slug(n)


def county_urls(meta, ATL=None):
    """fips -> (name, href, slug, state) for every county with PRF, and the loaded state files.
    build_prf_states.py uses it to link each county row to its page."""
    if ATL is None:
        ATL = atlas_index()
    where, loaded = {}, {}
    for st in sorted(meta["states"], key=lambda s: s["name"]):
        sd = json.load(open(os.path.join(D, "s", st["st"] + ".json")))
        loaded[st["st"]] = sd
        used = set()
        for code, c in sorted(sd["counties"].items()):
            fips = sd["fips"] + code
            n, sl = place(st["st"], fips, c["n"], ATL)
            if sl in used:
                sl = f"{sl}-{code}"
            used.add(sl)
            where[fips] = (n, f"/prf/{S.slug(st['name'])}/{sl}", sl, st)
    return where, loaded


def pct_cell(c):
    if not c:
        return "<td>&mdash;</td>"
    cls = ' class="is-pay"' if c["mid"] < 90 else ""
    return f"<td{cls}>{c['mid']}</td>"


def dollars(x):
    return f"${x:,.0f}"


def example_html(ex, cy, y0, y1, many, ng):
    """The labeled 100-acre example under the stat tiles (scripts/prf_county_facts.mjs countyExample):
    the calculator's opening policy, priced on the county's middle grid by premium."""
    if not ex:
        return ('<p class="prf-note prf-ex"><b>Example:</b> the calculator opens on April to May and June to July, and this county '
                'does not offer both for grazing, so no example is priced here. The calculator prices the months it does offer.</p>')
    where = (f"grid {ex['grid']}, the middle of the county&rsquo;s {ex['of']} grids by premium" if ex["of"] > 1
             else f"grid {ex['grid']}")
    return (f'<p class="prf-note prf-ex" id="example"><b>Example, not a recommendation:</b> 100 acres of grazing at 90% coverage, productivity factor 100, '
            f'half in April to May and half in June to July, on {where}. The full premium is {dollars(ex["premium"])}: USDA pays {dollars(ex["usda"])} '
            f'and you pay {dollars(ex["you"])}, or ${ex["you_acre"]:.2f} an acre. Run over {y0} to {y1} at {cy} rates, it would have paid in '
            f'{ex["paid_years"]} of {ex["years"]} years, an average of {dollars(ex["avg"])} a year, or ${ex["avg_acre"]:.2f} an acre. '
            f'That is the past record, not a forecast, and it leaves out the administrative fee.</p>')


def page(ctx):
    meta, cf, st, sd, code, c, fx, name, sl, st_slug, nbrs, links, BOOT = (
        ctx[k] for k in ("meta", "cf", "st", "sd", "code", "c", "fx", "name", "slug", "st_slug", "nbrs", "links", "BOOT"))
    stn, stc = st["name"], st["st"]
    fips = sd["fips"] + code
    cy, y0, y1 = meta["crop_year"], cf["years"]["first"], cf["years"]["last"]
    ny = cf["years"]["n"]
    sales, acre, bill = (S.long_date(meta["dates"][k]) for k in ("sales_closing", "acreage_reporting", "premium_billing"))
    sub = meta["subsidy"]
    grids = fx["grids"]
    ng = len(grids)
    b = c["b"]
    gz, hy, hi = b[0], b[4], b[1]
    lim = c.get("lim") or next(iter((c.get("limc") or {}).values()), None)
    jf = (str(lim[0][1]) + "%") if lim and lim[0] else "not offered"
    url = f"https://agsist.com/prf/{st_slug}/{sl}"
    full = f"{name}, {stn}"
    g_list = ", ".join(str(g) for g in grids)
    g_short = ", ".join(str(g) for g in grids[:6]) + (f" and {ng - 6} more" if ng > 6 else "")
    title = f"PRF Insurance in {full}: {cy} Grids and Rates | AGSIST"
    if len(title) > 75:
        title = f"PRF Insurance, {full}: {cy} | AGSIST"
    desc = (f"PRF insurance in {full} for {cy}: {ng} {'grid' if ng == 1 else 'grids'} ({g_short}), "
            f"county values {money2(gz)} grazing and {money2(hy) if hy is not None else 'no'} hay per acre, rates by month, history since {y0}.")
    if len(desc) > 160:
        desc = (f"PRF in {full} for {cy}: {ng} {'grid' if ng == 1 else 'grids'}, county values for grazing and hay, "
                f"rates by month and how often each paid since {y0}.")
    if len(desc) > 160:
        desc = f"PRF in {full}, {cy}: {ng} grids, county values, rates by month and the record since {y0}."
    calc = f"/prf?c={fips}"
    # ---- each pair of months
    def rng(r, f):
        if not r:
            return "&mdash;"
        if r["low"] == r["high"]:
            return f(r["mid"])
        return f'{f(r["mid"])}<br><span class="prf-th-s">{f(r["low"])}&ndash;{f(r["high"]).lstrip("$")}</span>'
    iv_rows = []
    for i, r in enumerate(fx["intervals"]):
        iv_rows.append(f'<tr><th scope="row"><abbr title="{S.LONG_IV[i]}">{SHORT_IV[i]}</abbr></th>'
                       f'<td>{("%.2f in" % r["normal_in"]) if r["normal_in"] is not None else "&mdash;"}</td>'
                       f'<td>{rng(r["rate"], money2)}</td><td>{rng(r["below"], str)}</td></tr>')
    many = ng > 1
    # ---- recent years: rows are intervals, columns are years
    rec = fx["recent"]
    so_far = '<br><span class="prf-th-s">so far</span>'
    yr_head = "".join(f'<th scope="col">{x["year"]}{so_far if x.get("open") else ""}</th>' for x in rec)
    yr_rows = "".join(f'<tr><th scope="row">{SHORT_IV[i]}</th>{"".join(pct_cell(x["iv"][i]) for x in rec)}</tr>' for i in range(11))
    open_y = next((x for x in rec if x.get("open")), None)
    open_n = sum(1 for v in (open_y["iv"] if open_y else []) if v)
    # ---- the grids
    grows = []
    for g in fx["grid_rows"][:MAX_GRID_ROWS]:
        grows.append(f'<tr><th scope="row">{g["g"]}</th>'
                     f'<td>{("%.1f in" % g["normal_in"]) if g["normal_in"] is not None else "&mdash;"}</td>'
                     f'<td>{(str(g["dry_year"]) + ", " + str(g["dry_pct"]) + "%") if g["dry_year"] else "&mdash;"}</td>'
                     f'<td>{(str(g["last_pct"]) + "%") if g["last_pct"] is not None else "&mdash;"}</td>'
                     f'<td>{g["years_under_90"] if g["years_under_90"] is not None else "&mdash;"}</td>'
                     f'<td><a href="/prf?g={g["g"]}&amp;c={fips}" rel="nofollow">Open</a></td></tr>')
    rest = fx["grid_rows"][MAX_GRID_ROWS:]
    rest_txt = (f'<p class="prf-fine">And {len(rest)} more grids: {", ".join(str(g["g"]) for g in rest)}. '
                f'Each opens in the <a href="{calc}" rel="nofollow">calculator</a>.</p>') if rest else ""
    # ---- figures for the prose
    mids = [(i, r["rate"]["mid"]) for i, r in enumerate(fx["intervals"]) if r["rate"]]
    cheap = min(mids, key=lambda t: t[1]) if mids else None
    dear = max(mids, key=lambda t: t[1]) if mids else None
    wet = max(((i, r["normal_in"]) for i, r in enumerate(fx["intervals"]) if r["normal_in"] is not None), key=lambda t: t[1], default=None)
    dry = min(((i, r["normal_in"]) for i, r in enumerate(fx["intervals"]) if r["normal_in"] is not None), key=lambda t: t[1], default=None)
    dry_years = sorted({g["dry_year"] for g in fx["grid_rows"] if g["dry_year"]})
    pb = fx["payback_mid_90"]
    prot = round(gz * 0.9, 2)
    subrow = ", ".join(f"{int(round(sub[k] * 100))}% at {k}%" for k in sorted(sub, key=int))
    # Each cell's middle is the median of the county's grids for that pair of months (and year),
    # so the middle can be a different grid from row to row; say so rather than "the middle grid".
    mid_word = f"the middle of the {ng} grids" if many else "the grid"
    ex = fx.get("example")
    faq = [
        (f"When is the PRF deadline in {name} for {cy}?",
         f"The sales closing date is {sales}, the same across the country. The acreage report is due {acre}, and the premium is billed no earlier than {bill}."),
        (f"Which PRF grid is {name} in?",
         f"{'Grids' if many else 'Grid'} {g_list} {'touch' if many else 'touches'} {name}. A grid is a quarter degree of latitude by a quarter degree of longitude, "
         f"about 17 miles north to south. Your grid follows from a point inside the acres you insure; type a ZIP or coordinates in the calculator to find it."),
        (f"How much does PRF cost per acre in {name}?",
         f"It depends on the grid, the months, the coverage level and your productivity factor. USDA&rsquo;s {cy} county base value is {money2(gz)} an acre for grazing"
         f"{', ' + money2(hy) + ' for non-irrigated hay' if hy is not None else ''}. At 90% coverage and a productivity factor of 100, grazing land is protected for "
         f"{money2(prot)} an acre, and the full premium runs {money2(cheap[1]) if cheap else '&mdash;'} to {money2(dear[1]) if dear else '&mdash;'} per $100 of protection "
         f"depending on the months, on {mid_word}. USDA pays 51% to 59% of the premium. "
         + (f"In the example above, 100 acres of grazing at 90% with half in April to May and half in June to July, you pay ${ex['you_acre']:.2f} an acre on grid {ex['grid']}. " if ex else "")
         + "The calculator gives the figure for your acres and months."),
        (f"How often has PRF paid in {name}?",
         f"At 90% coverage a pair of months pays when the index comes in under 90% of normal. Over {y0} to {y1}, on {mid_word}, that happened in "
         f"{min(r['below']['mid'] for r in fx['intervals'] if r['below'])} to {max(r['below']['mid'] for r in fx['intervals'] if r['below'])} of {ny} years, depending on the months. "
         + (f"Run at {cy} rates, $1 of full premium at 90% would have paid back a middle ${pb:.2f} across the county&rsquo;s grids and months. " if pb is not None else "")
         + "That is the past record, not a forecast."),
    ]
    faq_html = "".join(f"<details><summary>{q}</summary><p>{a}</p></details>" for q, a in faq)
    nb_html = (" ".join(f'<a href="{h}">{e(n)}</a>' for n, h in nbrs)) if nbrs else ""
    more = " &middot; ".join(f'<a href="{h}">{t}</a>' for t, h in links)
    # The rain STATE page only: rain county pages can come and go week to week,
    # and this build must not read data/rain (it is held to its output by --check).
    rain = (f'<p class="prf-fine"><a href="/rain/{rain_slug(RAIN_STATES[stc])}">Rain so far this year in {e(RAIN_STATES[stc])}, county by county</a></p>'
            if stc in RAIN_STATES else "")
    ld = [
        {"@context": "https://schema.org", "@type": "WebPage", "@id": url, "url": url, "name": title.replace(" | AGSIST", ""), "description": desc,
         "dateModified": S.modified(meta), "inLanguage": "en-US", "isPartOf": {"@id": "https://agsist.com/prf#app"},
         "about": {"@type": "AdministrativeArea", "name": full},
         "author": {"@type": "Person", "name": "Sigurd Lindquist", "jobTitle": "Certified Crop Adviser (CCA)", "url": "https://agsist.com/about"},
         "publisher": {"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com/"}},
        {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": S.text_of(q), "acceptedAnswer": {"@type": "Answer", "text": S.text_of(a)}} for q, a in faq]},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://agsist.com/"},
            {"@type": "ListItem", "position": 2, "name": "PRF insurance calculator", "item": "https://agsist.com/prf"},
            {"@type": "ListItem", "position": 3, "name": stn, "item": f"https://agsist.com/prf/{st_slug}"},
            {"@type": "ListItem", "position": 4, "name": name, "item": url}]},
    ]
    ldh = "".join('<script type="application/ld+json">' + json.dumps(x, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/") + "</script>" for x in ld)
    exh = example_html(fx.get("example"), cy, y0, y1, many, ng)
    sod = (f'<p class="prf-note">{stn} has the native sod rule: native sod broken in recent years gets 65% of the protection and 50 points less of USDA&rsquo;s share. '
           f'The values here are for land the rule does not touch.</p>') if stc in S.SOD else ""
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0a0c0d">
  <link rel="stylesheet" href="/components/styles.css?v=24">
  <link rel="stylesheet" href="/components/prf.css?v=6">
  <link rel="icon" type="image/x-icon" href="/img/favicon.ico">
  <link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
  <title>{e(title)}</title>
  <meta name="description" content="{e(desc)}">
  <meta name="author" content="Sigurd Lindquist">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
  <link rel="canonical" href="{url}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="AGSIST">
  <meta property="og:title" content="{e(title.replace(' | AGSIST', ''))}">
  <meta property="og:description" content="{e(desc)}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="https://agsist.com/img/og/prf.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="{e(title.replace(' | AGSIST', ''))}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="https://agsist.com/img/og/prf.jpg">
  {BOOT}
  {ldh}
</head>
<body>
  <a href="#main" class="skip">Skip to content</a>
  <div id="site-header"></div>
  <main id="main" class="main" tabindex="-1">
  <div class="prf prf-st">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/prf">PRF insurance calculator</a> &rsaquo; <a href="/prf/{st_slug}">{e(stn)}</a> &rsaquo; <span aria-current="page">{e(name)}</span></nav>
    <p class="page-kicker">Crop year {cy} &middot; sign-up deadline {sales}</p>
    <h1>PRF insurance in {e(full)}: {cy} grids, values and record</h1>
    <p class="prf-lede">Pasture, Rangeland, Forage (PRF) is USDA&rsquo;s rainfall-index insurance for grazing land and hay ground. USDA&rsquo;s {cy} files offer it in {e(name)} on {ng} {'grid' if ng == 1 else 'grids'}: {g_list}. It pays when precipitation in the grid over two months you choose comes in under a set share of normal.</p>
    <p><a class="btn btn-primary prf-cta" href="{calc}" rel="nofollow">Open the PRF calculator</a></p>
    <p class="prf-spon-band prf-spon-line" data-prf-spon="county" data-prf-st="{stc}" data-prf-name="{e(stn)}"><span class="prf-spon-tag">For businesses</span> <a href="/prf-sponsor?state={stc}">Sponsor PRF in {e(stn)} &rarr;</a></p>
    <dl class="prf-figs prf-st-figs">
      <div><dt>Grids</dt><dd>{ng}</dd></div>
      <div><dt>Grazing, county base value per acre</dt><dd>{money2(gz)}</dd></div>
      <div><dt>Hay, non-irrigated, per acre</dt><dd>{money2(hy)}</dd></div>
      <div><dt>Hay, irrigated, per acre</dt><dd>{money2(hi)}</dd></div>
      <div><dt>January to February cap</dt><dd>{jf}</dd></div>
      <div><dt>Sign-up deadline</dt><dd>{sales}</dd></div>
    </dl>
    <p class="prf-fine">USDA&rsquo;s {cy} county base values, the same on every grid in the county. Protection per acre is the value times your coverage level times a productivity factor of 60 to 150: grazing at 90% and 100 is {money2(prot)} an acre.</p>
    {exh}
    {sod}
    <div class="prf-prose">
    <h2 id="months">What each pair of months costs in {e(name)}</h2>
    <p>At 90% coverage{', across the ' + str(ng) + ' grids that touch the county: first the middle of the ' + str(ng) + ' for that pair of months (it can be a different grid in each row), then the lowest and highest' if many else ''}. The premium is the full rate per $100 of protection; USDA pays {subrow}. Normal is the grid&rsquo;s average precipitation for those months. A year counts, of the {ny} from {y0} to {y1}, when the grid&rsquo;s index for those months came in under 90% of normal, which is when a 90% policy pays.</p>
    <div class="prf-scroll" tabindex="0" role="region" aria-label="Each pair of months, scrolls sideways"><table class="prf-t prf-sub-t prf-iv-t"><caption class="prf-sr">Each pair of months in {e(full)} at 90% coverage</caption><thead><tr><th scope="col">Months</th><th scope="col">Normal</th><th scope="col">Premium per $100</th><th scope="col">Years under 90%</th></tr></thead><tbody>{''.join(iv_rows)}</tbody></table></div>
    <p>{('The wettest pair of months here is ' + S.LONG_IV[wet[0]] + f' ({wet[1]:.2f} in on {mid_word}) and the driest is ' + S.LONG_IV[dry[0]] + f' ({dry[1]:.2f} in). ') if wet and dry else ''}{('Coverage costs least in ' + S.LONG_IV[cheap[0]] + ' and most in ' + S.LONG_IV[dear[0]] + '. ') if cheap and dear and cheap[0] != dear[0] else ''}The months to insure are the ones when a dry spell costs you grass or hay, not the cheapest ones.</p>

    <h2 id="record">The last five years in {e(name)}, and {cf['open_year'] or ''} so far</h2>
    <p>The index for each pair of months as a percent of normal (100 is a normal year), on {mid_word}{' (each grid has its own; the calculator shows yours)' if many else ''}. Shaded cells came in under 90%, where a 90% policy on those months would have paid.{(' ' + str(cf['open_year']) + ' shows the ' + str(open_n) + ' pairs of months USDA has published so far.') if open_y else ''}</p>
    <div class="prf-scroll" tabindex="0" role="region" aria-label="Recent years, scrolls sideways"><table class="prf-t prf-yr-t"><caption class="prf-sr">PRF index by pair of months, {rec[0]['year']} to {rec[-1]['year']}, {e(full)}</caption><thead><tr><th scope="col">Months</th>{yr_head}</tr></thead><tbody>{yr_rows}</tbody></table></div>
    <p class="prf-fine">Every year since {y0}, priced at {cy} rates, is in the <a href="{calc}" rel="nofollow">calculator</a>.</p>

    <h2 id="grids">PRF {'grids' if many else 'grid'} in {e(name)}</h2>
    <p>Each grid&rsquo;s normal precipitation over a year, its driest year since {y0} as a percent of normal, {y1} as a percent of normal, and how many of {ny} years as a whole came in under 90%.{(' The driest year on the record here was ' + str(dry_years[0]) + '.') if len(dry_years) == 1 else ''}</p>
    <div class="prf-scroll" tabindex="0" role="region" aria-label="Every grid, scrolls sideways"><table class="prf-t prf-co-t"><caption class="prf-sr">PRF grids in {e(full)}</caption><thead><tr><th scope="col">Grid</th><th scope="col">Normal, year</th><th scope="col">Driest year</th><th scope="col">{y1}</th><th scope="col">Years under 90%</th><th scope="col"><span class="prf-sr">Calculator</span></th></tr></thead><tbody>{''.join(grows)}</tbody></table></div>
    {rest_txt}

    <h2 id="dates">PRF dates for {cy}</h2>
    <ul>
      <li><b>{sales}</b>: sales closing. New policies and changes are due at your agent.</li>
      <li><b>{acre}</b>: acreage report.</li>
      <li><b>{bill}</b>: premium billed, no earlier than this.</li>
    </ul>
    <p>From {cy}, grazing acres need livestock you have an interest in, equal to at least 25% of the stocking rate, or no payment is due and the premium is still owed. PRF pays on the grid&rsquo;s precipitation index, not on your production. <a href="/prf/how-prf-works">How PRF works</a> &middot; <a href="/prf#before">Before you sign</a> &middot; <a href="/prf/{st_slug}">PRF in {e(stn)}</a></p>

    <h2 id="faq">PRF questions in {e(name)}</h2>
    <div class="prf-faq">{faq_html}</div>
    </div>

    <p class="prf-byline">By <a href="/about">Sigurd Lindquist</a>, a Certified Crop Adviser (CCA) who owns a licensed crop insurance agency. This page sells no insurance and asks for no contact details. Figures from USDA RMA&rsquo;s {cy} Actuarial Data Master and PRF index record, read {S.long_date(meta['built'][:10])}. The index record is what USDA publishes for {cy}; policies in past years were paid on their own rates and data.</p>
    {('<nav class="prf-links prf-st-links" aria-label="PRF next door"><b>PRF next door:</b> ' + nb_html + '</nav>') if nb_html else ''}
    <p class="prf-fine">{more}</p>
    {rain}
    <p class="rp-promo" data-rain-print-promo="see" hidden></p><script src="/components/rain-print-promo.js?v=2" defer></script>
  </div>
  </main>
  <div id="site-footer"></div>
  <script src="/components/loader.js?v=19" defer></script>
  {S.PRF_SPONSOR_JS}
</body>
</html>
"""


def sitemap(urls, day):
    body = "".join(f"  <url><loc>{u}</loc><lastmod>{day}</lastmod></url>\n" for u in urls)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!-- PRF county pages. Written by scripts/build_prf_counties.py; lastmod is the date of the USDA files the pages were built from. -->\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + "</urlset>\n")


def main():
    meta = json.load(open(os.path.join(D, "meta.json")))
    cf = county_facts()
    if cf.get("built_from") != meta["built"] or cf.get("crop_year") != meta["crop_year"]:
        raise SystemExit("county facts and meta.json are from different builds of data/prf")
    BOOT = S.boot()
    ATL = atlas_index()
    NB = {}
    p = os.path.join(ROOT, "data", "atlas", "neighbors.json")
    if os.path.exists(p):
        NB = json.load(open(p))["counties"]
    states = sorted(meta["states"], key=lambda s: s["name"])
    # every county's name and URL first, for the next-door links
    where, loaded = county_urls(meta, ATL)
    want = {}
    urls = []
    total = 0
    for st in states:
        sd = loaded[st["st"]]
        st_slug = S.slug(st["name"])
        for code, c in sorted(sd["counties"].items()):
            fips = sd["fips"] + code
            n, href, sl, _ = where[fips]
            nbrs = []
            for nf in NB.get(fips, []):
                if nf in where:
                    nn, nh, _, nst = where[nf]
                    nbrs.append((nn + ("" if nst["st"] == st["st"] else ", " + nst["st"]), nh))
            links = [(f"PRF in {e(st['name'])}", f"/prf/{st_slug}")]
            for label, top in (("Farmland Atlas", "farmland-atlas"), ("ARC or PLC", "arc-plc")):
                if os.path.exists(os.path.join(ROOT, top, st_slug, sl + ".html")):
                    links.append((f"{e(n)} in the {label}" if label == "Farmland Atlas" else f"{label} in {e(n)}", f"/{top}/{st_slug}/{sl}"))
            links.append(("PRF calculator", "/prf"))
            body = page({"meta": meta, "cf": cf, "st": st, "sd": sd, "code": code, "c": c, "fx": cf["counties"][fips], "name": n,
                         "slug": sl, "st_slug": st_slug, "nbrs": nbrs, "links": links, "BOOT": BOOT})
            body = nav.fill_fonts(body)
            size = len(body.encode())
            if size > MAX_KB * 1024:
                raise SystemExit(f"prf/{st_slug}/{sl}.html would be {size // 1024} KB, over {MAX_KB} KB")
            total += size
            want[os.path.join(st_slug, sl + ".html")] = body
            urls.append("https://agsist.com" + href)
    sm = sitemap(urls, meta["built"][:10])
    check = "--check" in sys.argv
    bad = []
    for rel, body in want.items():
        p = os.path.join(OUT, rel)
        have = open(p, encoding="utf-8").read() if os.path.exists(p) else None
        if have != body:
            if check:
                bad.append(rel)
            else:
                os.makedirs(os.path.dirname(p), exist_ok=True)
                open(p, "w", encoding="utf-8").write(body)
    # pages this build no longer writes (a county dropped from USDA's files)
    stale = []
    for st in states:
        dd = os.path.join(OUT, S.slug(st["name"]))
        if os.path.isdir(dd):
            for fn in os.listdir(dd):
                rel = os.path.join(S.slug(st["name"]), fn)
                if fn.endswith(".html") and rel not in want:
                    stale.append(rel)
    have_sm = open(SITEMAP, encoding="utf-8").read() if os.path.exists(SITEMAP) else None
    if check:
        if have_sm != sm:
            bad.append("sitemap-prf.xml")
        bad += stale
        if bad:
            print("PRF county pages out of date:", ", ".join(bad[:5]), "... run python3 scripts/build_prf_counties.py")
            return 1
        print(f"{len(want)} county pages and sitemap-prf.xml match data/prf")
        return 0
    for rel in stale:
        os.remove(os.path.join(OUT, rel))
    if have_sm != sm:
        open(SITEMAP, "w", encoding="utf-8").write(sm)
    print(f"{len(want)} county pages written to prf/<state>/, {total / 1048576:.1f} MB, largest {max(len(b.encode()) for b in want.values()) // 1024} KB; "
          f"{len(stale)} stale removed; sitemap-prf.xml {len(urls)} URLs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
