#!/usr/bin/env python3
"""build_prf_states.py: one PRF page per state, prf/<state>.html.

WHY
  "PRF insurance Missouri" is what people search. /prf is the calculator;
  these pages answer the state question in plain HTML a crawler can read:
  how many counties and grids, USDA's county base values for grazing and hay
  in every county, the January to February cap, what each pair of months
  costs and how often it fell under the trigger across the state's grids,
  and the dates. Each county row opens the calculator on that county.

WHERE THE NUMBERS COME FROM
  data/prf/meta.json, data/prf/s/<ST>.json (USDA's county values and limits,
  copied unchanged) and data/prf/facts.json (scripts/prf_facts.mjs: every
  middle and count, worked out with components/prf-math.js). This script
  computes nothing; it formats. A page is never written from files of two
  different builds.

SIZE (CLAUDE.md): 48 pages; the largest, Texas, has 254 county rows. The
  check below refuses any page over 150 KB.

  python3 scripts/build_prf_states.py           write prf/<state>.html
  python3 scripts/build_prf_states.py --check   exit 1 if any page differs from what this would write
"""
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, "data", "prf")
OUT = os.path.join(ROOT, "prf")
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
LONG_IV = ["January to February", "February to March", "March to April", "April to May", "May to June", "June to July",
           "July to August", "August to September", "September to October", "October to November", "November to December"]
SOD = {"IA", "MN", "MT", "NE", "ND", "SD"}
MAX_KB = 150
e = html.escape
# The day the wording of the state and county pages last changed (a new
# section, a rewritten paragraph). Their dateModified is the later of this and
# the date of USDA's files, so a page that changed says so. Move it in the
# same commit as any wording change; a data refresh moves the other date.
PAGE_REVISED = "2026-10-16"
# Where each 2027 change is written down at RMA (read 2026-10-15).
RMA_NCEI = "https://www.rma.usda.gov/news-events/news/2026/washington-dc/usda-risk-management-agency-upgrades-rainfall-data-source"
RMA_PM_26_053 = "https://www.rma.usda.gov/policy-procedure/bulletins-memos/product-management-bulletin/pm-26-053-rainfall-index-crop"
RMA_STOCKING = "https://www.rma.usda.gov/about-crop-insurance/frequently-asked-questions/pasture-rangeland-forage-stocking-rate"


def modified(meta):
    return max(meta["built"][:10], PAGE_REVISED)


def long_date(iso):
    y, m, d = iso.split("-")
    return f"{MONTHS[int(m) - 1]} {int(d)}, {y}"


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def money2(x):
    return "&mdash;" if x is None else f"${x:,.2f}"


def boot():
    model = open(os.path.join(ROOT, "store-or-sell.html"), encoding="utf-8").read()
    m = re.search(r"<script>/\* agsist-theme-early.*?</script><script>/\* agsist-ga-guard.*?</script>\s*<script>window\.dataLayer.*?</script>", model, flags=re.S)
    if not m:
        raise SystemExit("boilerplate scripts not found in store-or-sell.html")
    return m.group(0)


def dataset(meta, name, desc, url, place=None):
    """schema.org Dataset for a PRF page: USDA's files, as read on the build date. USDA data is public domain."""
    d = {"@context": "https://schema.org", "@type": "Dataset", "name": name, "description": desc, "url": url,
         "temporalCoverage": f"{meta['years']['first']}/{meta['years']['last_complete']}", "dateModified": modified(meta),
         "isAccessibleForFree": True, "license": "https://www.usa.gov/government-works",
         "creator": {"@type": "Organization", "name": "USDA Risk Management Agency", "url": "https://www.rma.usda.gov/"},
         "publisher": {"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com/"},
         "isBasedOn": [meta["sources"]["adm"], meta["sources"]["index"]],
         "variableMeasured": ["county base value per acre", "premium rate", "precipitation index"]}
    if place:
        d["spatialCoverage"] = {"@type": "Place", "name": place + ", United States"}
    return d


def text_of(fragment):
    t = re.sub(r"<[^>]+>", "", fragment)
    return re.sub(r"\s+", " ", html.unescape(t)).strip()


PRF_SPONSOR_JS = '<script src="/components/prf-sponsor.js?v=5" defer></script>'


def sponsor_ribbon(name, code):
    """The unsold offer on /prf/<state>, one slim band under the opening answer
    (Sig, 2026-10-14: "the advertise-here CTA needs to be on the upper part of
    the page"). Price on request, never printed. The link goes to /prf-sponsor
    with this state ticked, where a business sees its own block and asks (the
    email to Sig is there too). The part in prf-spon-x drops on a phone so the
    band stays two short lines."""
    return (f'<aside class="prf-spon-band" id="sponsor" data-prf-spon="state" data-prf-st="{code}" data-prf-name="{e(name)}" aria-label="For businesses">'
            f'<span class="prf-spon-tag">For businesses</span> '
            f'<span class="prf-spon-t">Sponsor PRF in {e(name)}.<span class="prf-spon-x"> Your business here, on this page and every {e(name)} county page.</span></span> '
            f'<a href="/prf-sponsor?state={code}" data-out="prf-sponsor">See your block and ask &rarr;</a></aside>')


def page(st, meta, facts, sd, states, BOOT, where=None):
    name, code = sd["name"], st["st"]
    f = facts["by_state"][code]
    cy, y0, y1 = meta["crop_year"], meta["years"]["first"], meta["years"]["last_complete"]
    ny = y1 - y0 + 1
    sales, acre, bill = (long_date(meta["dates"][k]) for k in ("sales_closing", "acreage_reporting", "premium_billing"))
    sub = meta["subsidy"]
    counties = sorted(sd["counties"].items(), key=lambda kv: kv[1]["n"])
    n_co = len(counties)
    n_grid = next(x["grids"] for x in facts["states"] if x["st"] == code)
    gz, hy = f["grazing"], f["hay_dry"]
    url = f"https://agsist.com/prf/{slug(name)}"
    jf = sorted({(c.get("lim") or next(iter((c.get("limc") or {}).values()), [None]))[0][1] for _, c in counties
                 if (c.get("lim") or next(iter((c.get("limc") or {}).values()), [None]))[0]})
    jf_txt = (f"{jf[0]}%" if len(jf) == 1 else " or ".join(f"{x}%" for x in jf)) if jf else "not offered"
    jf25 = sum(1 for _, c in counties if (lambda L: bool(L and L[0] and L[0][1] == 25))(c.get("lim") or next(iter((c.get("limc") or {}).values()), None)))
    jf_here = (f"all {n_co} {name} counties" if jf25 == n_co and n_co > 1 else f"the one {name} county" if jf25 == n_co
               else f"{jf25} of the {n_co} {name} counties")
    title = f"PRF Insurance in {name}: {cy} Rates and County Values | AGSIST"
    desc = (f"PRF (Pasture, Rangeland, Forage) insurance in {name} for {cy}: county base values for grazing and hay in all "
            f"{n_co} {'county' if n_co == 1 else 'counties'}, rates by month and a free calculator.")
    if len(desc) > 160:
        desc = f"PRF (Pasture, Rangeland, Forage) insurance in {name} for {cy}: county values for grazing and hay, rates by month, free calculator."
    rows = []
    for k, c in counties:
        lim = c.get("lim") or next(iter((c.get("limc") or {}).values()), None)
        b = c["b"]
        href = (where or {}).get(sd["fips"] + k)
        cname = f'<a href="{href[1]}">{e(c["n"])}</a>' if href else e(c["n"])
        rows.append(f'<tr><th scope="row">{cname}</th><td>{len(c["g"])}</td><td>{money2(b[0])}</td><td>{money2(b[4])}</td>'
                    f'<td>{(str(lim[0][1]) + "%") if lim and lim[0] else "&mdash;"}</td>'
                    f'<td><a href="/prf?c={sd["fips"]}{k}" rel="nofollow">Open</a></td></tr>')
    iv = "".join(f'<tr><th scope="row">{LONG_IV[i]}</th><td>{("%.2f in" % r["mid_normal_in"]) if r["mid_normal_in"] is not None else "&mdash;"}</td>'
                 f'<td>{money2(r["mid_rate_per_100"])}</td><td>{r["mid_years_below"] if r["mid_years_below"] is not None else "&mdash;"}</td>'
                 f'<td>{r["grids"]:,}</td></tr>' for i, r in enumerate(f["intervals"]))
    span = lambda s: (f'{money2(s["mid"])} <span class="prf-th-s">{money2(s["low"])} to {money2(s["high"])}</span>' if s else "&mdash;")
    faq = [
        (f"When is the PRF deadline in {name} for {cy}?",
         f"The sales closing date is {sales}, the same across the country. The acreage report is due {acre}, and the premium is billed no earlier than {bill}."),
        (f"How much does PRF cost per acre in {name}?",
         f"It depends on the grid, the months, the coverage level and the county&rsquo;s value. USDA&rsquo;s county base value for grazing land in {name} runs from "
         f"{money2(gz['low'])} to {money2(gz['high'])} an acre{', and for non-irrigated hay from ' + money2(hy['low']) + ' to ' + money2(hy['high']) if hy else ''}. "
         f"USDA pays 51% to 59% of the premium. The calculator gives the figure for your grid, acres and months."),
        (f"Is PRF offered in every {name} county?",
         f"USDA&rsquo;s {cy} files list PRF in {n_co} {name} {'county' if n_co == 1 else 'counties'}, across {n_grid:,} grids. Each county row in the table above opens the calculator on that county."),
        (f"What changed in PRF for {cy}?",
         f"Three things. The precipitation index now comes from NOAA&rsquo;s National Centers for Environmental Information in place of the Climate Prediction Center, "
         f"on the same grids, with a record that starts in {y0}. January to February is capped at 25% of a policy&rsquo;s value, in {jf_here}. "
         f"And grazing acres need livestock you have an interest in, equal to at least 25% of an average stocking rate, or no payment is due and the full premium is still owed."),
        (f"Has PRF paid more than it cost in {name}?",
         f"On the full premium, about the same as everywhere: across {name}&rsquo;s grids at 90% coverage, $1 of premium would have paid back a middle ${f['payback_mid_90']:.2f} over {y0} to {y1} at {cy} rates, close to the national middle of $0.87. "
         f"That average is made of a few big years and many small or empty ones, and none of it says what next year will do."),
    ]
    faq_html = "".join(f"<details><summary>{q}</summary><p>{a}</p></details>" for q, a in faq)
    others = " ".join(f'<a href="/prf/{slug(x["name"])}">{e(x["name"])}</a>' for x in states if x["st"] != code)
    sod = (f'<p class="prf-note">{name} is one of six states with the native sod rule: native sod broken in recent years gets 65% of the protection '
           f'and 50 points less of USDA&rsquo;s share (Crop Provisions, section 4(g)). The values below are for land the rule does not touch.</p>') if code in SOD else ""
    ld = [
        {"@context": "https://schema.org", "@type": "WebPage", "@id": url, "url": url, "name": title.replace(" | AGSIST", ""), "description": desc,
         "dateModified": modified(meta), "inLanguage": "en-US", "isPartOf": {"@id": "https://agsist.com/prf#app"},
         "author": {"@type": "Person", "name": "Sigurd Lindquist", "url": "https://agsist.com/about"},
         "publisher": {"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com/"}},
        {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": text_of(q), "acceptedAnswer": {"@type": "Answer", "text": text_of(a)}} for q, a in faq]},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://agsist.com/"},
            {"@type": "ListItem", "position": 2, "name": "PRF insurance calculator", "item": "https://agsist.com/prf"},
            {"@type": "ListItem", "position": 3, "name": name, "item": url}]},
        dataset(meta, f"PRF county base values and rainfall index record, {name}, {cy}",
                f"USDA RMA's {cy} Pasture, Rangeland, Forage county base values for grazing and hay in {n_co} {name} counties, interval limits, "
                f"and premium rates and precipitation index history for the {n_grid:,} grids that touch them, {y0} to {y1}.", url, name),
    ]
    ldh = "".join('<script type="application/ld+json">' + json.dumps(b, ensure_ascii=False).replace("</", "<\\/") + "</script>" for b in ld)
    # Sig, 2026-10-12: the PRF state slots are priced on request, prepaid, with the
    # placement guaranteed to the end of the year. Kept out of the self-serve
    # monthly flow (/sponsor-apply) and out of data/sponsor-slots.json on purpose:
    # the link is not /sponsor-apply, so scripts/stamp_rates.py adds no price.
    # 2026-10-13: one business per state, on this page and every county page in
    # it; a business may own one state or several. A sale is a line in
    # data/prf-sponsors.json, and components/prf-sponsor.js swaps this offer for
    # the sponsor in the browser (data-prf-spon), so no page is rebuilt to sell.
    ribbon = sponsor_ribbon(name, code)
    subrow = ", ".join(f"{int(round(sub[c] * 100))}% at {c}%" for c in sorted(sub, key=int))
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0a0c0d">
  <link rel="preload" href="/components/styles.css?v=26" as="style">
  <link rel="stylesheet" href="/components/styles.css?v=26">
  <link rel="stylesheet" href="/components/prf.css?v=9">
  <link rel="icon" href="/img/favicon.ico" sizes="32x32">
  <link rel="icon" type="image/svg+xml" href="/img/icon.svg">
  <link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.json">
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
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/prf">PRF insurance calculator</a> &rsaquo; <span aria-current="page">{e(name)}</span></nav>
    <p class="page-kicker">Crop year {cy} &middot; sign-up deadline {sales}</p>
    <h1>PRF insurance in {e(name)}: {cy} county values and rates</h1>
    <p class="prf-lede">Pasture, Rangeland, Forage (PRF) is USDA&rsquo;s rainfall-index insurance for grazing land and hay ground. USDA&rsquo;s {cy} files offer it in {n_co} {e(name)} {'county' if n_co == 1 else 'counties'}, on {n_grid:,} grids. The policy pays when precipitation in the grid over two months you choose comes in under a set share of normal.</p>
    <p><a class="btn btn-primary prf-cta" href="/prf?st={code}">Open the PRF calculator for {e(name)}</a></p>
    {ribbon}
    <dl class="prf-figs prf-st-figs">
      <div><dt>Counties with PRF</dt><dd>{n_co}</dd></div>
      <div><dt>Grids</dt><dd>{n_grid:,}</dd></div>
      <div><dt>Grazing, county base value per acre</dt><dd>{span(gz)}</dd></div>
      <div><dt>Hay, non-irrigated, per acre</dt><dd>{span(hy)}</dd></div>
      <div><dt>January to February cap</dt><dd>{jf_txt}</dd></div>
      <div><dt>Sign-up deadline</dt><dd>{sales}</dd></div>
    </dl>
    <p class="prf-fine">The first figure is the middle county; the small ones are the lowest and highest. Protection per acre is the county value times your coverage level times a productivity factor of 60 to 150.</p>
    {sod}
    <div class="prf-prose">
    <h2 id="months">What each pair of months costs in {e(name)}</h2>
    <p>At 90% coverage, across the {n_grid:,} grids that touch a {e(name)} county with PRF. The premium is the full rate per $100 of protection; USDA pays {subrow}. Each figure is the middle of the grids for that pair of months, so a row&rsquo;s middle can be a different grid from the next row&rsquo;s.</p>
    <div class="prf-scroll" tabindex="0" role="region" aria-label="Each pair of months, scrolls sideways"><table class="prf-sub-t prf-iv-t"><caption class="prf-sr">Each pair of months in {e(name)} at 90% coverage, middle of the grids for each pair</caption><thead><tr><th scope="col">Months</th><th scope="col">Normal precipitation, middle grid for the pair</th><th scope="col">Premium per $100, middle grid for the pair</th><th scope="col">Years under 90% of normal, of {ny}, middle grid for the pair</th><th scope="col">Grids offered</th></tr></thead><tbody>{iv}</tbody></table></div>
    <p>Across {e(name)}&rsquo;s grids, $1 of full premium at 90% coverage would have paid back a middle ${f['payback_mid_90']:.2f} over {y0} to {y1} at {cy} rates ({f['payback_n_90']:,} grid and month pairs), close to the national middle of $0.87. On the full premium, no month or grid stands out. The months to insure are the ones when a dry spell costs you grass or hay.</p>
    </div>

    <h2 id="counties">PRF in every {e(name)} county</h2>
    <p class="prf-fine">USDA&rsquo;s county base value per acre for {cy}, the number of grids that touch the county, and the most of a policy that can go in January to February. A county&rsquo;s name opens its page with the grids and their record; Open sets acres, months and coverage in the calculator.</p>
    <div class="prf-scroll" tabindex="0" role="region" aria-label="Every county, scrolls sideways"><table class="prf-t prf-co-t"><caption class="prf-sr">PRF county base values in every {e(name)} county, {cy}</caption><thead><tr><th scope="col">County</th><th scope="col">Grids</th><th scope="col">Grazing</th><th scope="col">Hay, non-irrigated</th><th scope="col">Jan-Feb cap</th><th scope="col"><span class="prf-sr">Calculator</span></th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>

    <div class="prf-prose">
    <h2 id="changes">What changed in PRF for {cy}</h2>
    <ul>
      <li><b>A new precipitation record.</b> From the {cy} crop year the index comes from NOAA&rsquo;s National Centers for Environmental Information (NCEI) in place of the Climate Prediction Center. The grids did not move (<a href="{RMA_NCEI}" rel="noopener">USDA RMA, April 30, 2026</a>). USDA&rsquo;s {cy} record starts in {y0}, and every past year on this page and in the calculator is from it.</li>
      <li><b>January to February is capped at 25%.</b> No more than 25% of a policy&rsquo;s value can go in that interval (<a href="{RMA_PM_26_053}" rel="noopener">RMA bulletin PM-26-053</a>). USDA&rsquo;s {cy} files set that cap in {jf_here}.</li>
      <li><b>Grazing land needs livestock on it.</b> Acres insured for grazing need livestock you have an insurable interest in, equal to at least 25% of an average stocking rate for those acres, with the records kept three years (PM-26-053). RMA&rsquo;s stocking rate questions: &ldquo;Failure means no indemnity is due and full premium is owed&rdquo; (<a href="{RMA_STOCKING}" rel="noopener">RMA</a>). Hay ground is not under this rule.</li>
    </ul>

    <h2 id="dates">PRF dates for {cy}</h2>
    <ul>
      <li><b>{sales}</b>: sales closing. New policies and changes are due at your agent.</li>
      <li><b>{acre}</b>: acreage report, with any lease signed and in hand.</li>
      <li><b>{bill}</b>: premium billed, no earlier than this. Premium owed comes out of any payment first.</li>
    </ul>
    <p>USDA&rsquo;s share of the premium needs form AD-1026 on file with the Farm Service Agency. PRF pays on a precipitation index for the grid, not on your production. <a href="/prf/how-prf-works">How PRF works</a> &middot; <a href="/prf#before">Before you sign</a> &middot; <a href="/prf#new">New for 2027</a> &middot; <a href="/prf#payback">How payouts compare with the premium</a></p>

    <h2 id="faq">PRF questions in {e(name)}</h2>
    <div class="prf-faq">{faq_html}</div>
    </div>

    <p class="prf-byline">By <a href="/about">Sigurd Lindquist</a>, CCA, who owns a licensed crop insurance agency. This page sells no insurance and asks for no contact details. Sponsored space is marked in orange; a sponsor may sell crop insurance, and has no say over any figure here. Figures from USDA RMA&rsquo;s {cy} Actuarial Data Master and PRF index record, read {long_date(meta['built'][:10])}.</p>
    <nav class="prf-links prf-st-links" aria-label="PRF in other states"><a href="/prf">PRF calculator</a> {others}</nav>
    <p class="rp-promo" data-rain-print-promo="auto" hidden></p><script src="/components/rain-print-promo.js?v=6" defer></script>
  </div>
  </main>
  <div id="site-footer"></div>
  <script src="/components/loader.js?v=19" defer></script>
  {PRF_SPONSOR_JS}
</body>
</html>
"""


def dollars(x):
    return f"${x:,.0f}"


GUIDE_SLUG = "how-prf-works"


def guide(meta, facts, states, BOOT):
    """/prf/how-prf-works: the plain-words explainer, every figure from facts.json and meta.json."""
    cy, y0, y1 = meta["crop_year"], facts["years"]["first"], facts["years"]["last"]
    ny = facts["years"]["n"]
    sales, acre, bill = (long_date(meta["dates"][k]) for k in ("sales_closing", "acreage_reporting", "premium_billing"))
    sub = meta["subsidy"]
    ex, exg, exh = facts["example"], facts["example"]["grazing"], facts["example"]["hay"]
    paid = facts["example_years"]["paid"]
    big = max(paid)
    big_year = y0 + paid.index(big)
    pb90 = facts["payback"]["by_coverage"]["90"]
    you90 = pb90["mid"] / (1 - sub["90"])
    lim = facts["limits"]
    jf25 = lim["jan_feb_max"].get("25", 0)
    other_max = lim["other_max"]
    dry = facts["largest_net_in_two_driest"]
    ivs = facts["intervals_at_90"]
    cheap = min(ivs, key=lambda r: r["mid_rate_per_100"])
    dear = max(ivs, key=lambda r: r["mid_rate_per_100"])
    n_grids, n_co = meta["counts"]["grids"], meta["counts"]["counties"]
    url = f"https://agsist.com/prf/{GUIDE_SLUG}"
    title = f"How PRF Insurance Works: Intervals, Coverage, Productivity Factor ({cy}) | AGSIST"
    desc = (f"How Pasture, Rangeland, Forage (PRF) insurance works for {cy}, in plain words: the grid, the eleven intervals, coverage, "
            f"productivity factor, USDA's share and what the record says.")
    if len(desc) > 160:
        desc = f"How PRF (Pasture, Rangeland, Forage) insurance works for {cy}: grids, intervals, coverage, productivity factor, USDA's share and the record."
    subrows = "".join(f"<tr><th scope=\"row\">{c}%</th><td>{int(round(sub[c] * 100))}%</td><td>{100 - int(round(sub[c] * 100))}%</td></tr>"
                      for c in sorted(sub, key=int))
    ivrows = "".join(f'<tr><th scope="row">{LONG_IV[i]}</th><td>{r["mid_normal_in"]:.2f} in</td><td>{money2(r["mid_rate_per_100"])}</td><td>{r["mid_years_below"]}</td></tr>'
                     for i, r in enumerate(ivs))
    faq = [
        ("How does PRF insurance work?",
         f"You insure grazing land or hay ground in a grid, pick a coverage level from 70% to 90% and spread the policy over at least two two-month intervals. "
         f"When the grid&rsquo;s precipitation index for an interval you insured comes in under your coverage level, it pays, with no claim to file. USDA pays {int(round(sub['90'] * 100))}% to {int(round(sub['70'] * 100))}% of the premium."),
        ("What is the PRF productivity factor?",
         "A percent from 60 to 150 you choose for each county, use and practice. It moves the protection per acre, and the premium with it, in the same proportion. "
         "At 150 you insure half again the county base value and pay half again the premium; the payment per premium dollar does not change."),
        ("What are the best PRF intervals?",
         f"No interval stands out on the record: at {cy} rates, $1 of full premium at 90% coverage would have paid back a middle ${pb90['mid']:.2f} over {y0} to {y1}, "
         f"with 90% of grid-interval pairs between ${pb90['p05']:.2f} and ${pb90['p95']:.2f}. The intervals to insure are the ones when a dry spell costs you grass or hay."),
        ("Is PRF worth it?",
         f"On the full premium the record returns a bit less than it costs, a middle ${pb90['mid']:.2f} per $1 at 90% coverage. USDA pays {int(round(sub['90'] * 100))}% of that premium, "
         f"so on the share you pay the same record works out to about ${you90:.2f} per $1. The money comes in a few dry years with many years of little or nothing between, and none of it says what next year will do."),
        (f"When is the PRF deadline for {cy}?",
         f"The sales closing date is {sales}. The acreage report is due {acre}. The premium is billed no earlier than {bill}."),
    ]
    faq_html = "".join(f"<details><summary>{q}</summary><p>{a}</p></details>" for q, a in faq)
    ld = [
        {"@context": "https://schema.org", "@type": "Article", "@id": url, "url": url, "headline": title.replace(" | AGSIST", ""), "description": desc,
         "dateModified": meta["built"][:10], "inLanguage": "en-US", "image": "https://agsist.com/img/og/prf.jpg",
         "author": {"@type": "Person", "name": "Sigurd Lindquist", "jobTitle": "Certified Crop Adviser (CCA)", "url": "https://agsist.com/about"},
         "publisher": {"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com/", "logo": {"@type": "ImageObject", "url": "https://agsist.com/img/apple-touch-icon.png"}},
         "mainEntityOfPage": url, "isBasedOn": meta["sources"]["adm"]},
        {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": text_of(q), "acceptedAnswer": {"@type": "Answer", "text": text_of(a)}} for q, a in faq]},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://agsist.com/"},
            {"@type": "ListItem", "position": 2, "name": "PRF insurance calculator", "item": "https://agsist.com/prf"},
            {"@type": "ListItem", "position": 3, "name": "How PRF works", "item": url}]},
    ]
    ldh = "".join('<script type="application/ld+json">' + json.dumps(b, ensure_ascii=False).replace("</", "<\\/") + "</script>" for b in ld)
    st_links = " ".join(f'<a href="/prf/{slug(x["name"])}">{e(x["name"])}</a>' for x in states)
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0a0c0d">
  <link rel="preload" href="/components/styles.css?v=26" as="style">
  <link rel="stylesheet" href="/components/styles.css?v=26">
  <link rel="stylesheet" href="/components/prf.css?v=9">
  <link rel="icon" href="/img/favicon.ico" sizes="32x32">
  <link rel="icon" type="image/svg+xml" href="/img/icon.svg">
  <link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.json">
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
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/prf">PRF insurance calculator</a> &rsaquo; <span aria-current="page">How PRF works</span></nav>
    <p class="page-kicker">Crop year {cy} &middot; sign-up deadline {sales}</p>
    <h1>How PRF insurance works, in plain words</h1>
    <p class="prf-lede">Pasture, Rangeland, Forage (PRF) is USDA&rsquo;s rainfall-index insurance for grazing land and hay ground. It does not look at your grass, your hay or your cattle. It pays when precipitation in your grid, over two months you chose, comes in under a share of that grid&rsquo;s normal. For {cy} it is offered on {n_grids:,} grids in {n_co:,} counties of the 48 contiguous states.</p>
    <p><a class="btn btn-primary prf-cta" href="/prf">Open the PRF calculator</a></p>
    <div class="prf-prose">
    <h2 id="grid">1. The grid</h2>
    <p>The country is cut into squares a quarter of a degree on each side: about 17 miles north to south and 11 to 16 miles east to west. USDA works out each grid&rsquo;s precipitation from weather stations, as an index where 100 is the grid&rsquo;s normal for those two months. Your own rain gauge does not count. You pick a point inside the acres you insure and the grid follows from it. Every grid number has its own record from {y0}; the <a href="/prf">calculator</a> finds yours from a ZIP or coordinates, and each state page lists the grids county by county.</p>

    <h2 id="intervals">2. The eleven intervals</h2>
    <p>The year is split into eleven overlapping two-month intervals, January to February through November to December. You spread the policy over at least two of them, no month in two, each with at least {lim['min_pct'][0]}% of the policy and no more than {' or '.join(str(x) + '%' for x in other_max)}, depending on the county. January to February is capped at 25% in {jf25:,} counties. Each interval pays on its own.</p>
    <p>Across every grid at 90% coverage, the middle of all the grids for each interval looks like this (a different grid can be the middle one in each row). Normal is the grid&rsquo;s average precipitation for the two months; the premium is the full rate per $100 of protection; the last column counts the years from {y0} to {y1} when the index came in under 90.</p>
    <div class="prf-scroll" tabindex="0" role="region" aria-label="Each interval, scrolls sideways"><table class="prf-t prf-sub-t"><caption class="prf-sr">Each interval at 90% coverage, middle grid, all grids</caption><thead><tr><th scope="col">Interval</th><th scope="col">Normal</th><th scope="col">Premium per $100</th><th scope="col">Years under 90, of {ny}</th></tr></thead><tbody>{ivrows}</tbody></table></div>
    <p>Coverage costs least in {LONG_IV[ivs.index(cheap)]} and most in {LONG_IV[ivs.index(dear)]}, at the middle of the grids. The price follows how often and how far the index has fallen short, so a cheaper interval is not a better buy. RMA&rsquo;s handbook says choosing intervals &ldquo;when precipitation is not needed for the insured crop or when precipitation does not normally occur is not an effective use&rdquo; of the policy. On {dry['grids']:,} of {dry['of']:,} grids, the interval with the most average payment over your share of the premium was one of the grid&rsquo;s two driest.</p>

    <h2 id="coverage">3. Coverage level and USDA&rsquo;s share</h2>
    <p>You pick 70%, 75%, 80%, 85% or 90%. At 90% an interval pays once the index is under 90; at 70% it has to fall under 70. A higher level pays sooner and costs more. USDA pays part of the premium, more at the lower levels:</p>
    <div class="prf-scroll" tabindex="0" role="region" aria-label="USDA share by coverage level"><table class="prf-t prf-sub-t"><caption class="prf-sr">USDA share of the PRF premium by coverage level, {cy}</caption><thead><tr><th scope="col">Coverage</th><th scope="col">USDA pays</th><th scope="col">You pay</th></tr></thead><tbody>{subrows}</tbody></table></div>

    <h2 id="productivity">4. The productivity factor</h2>
    <p>USDA sets a county base value per acre for grazing and for hay, the same on every grid in the county. You choose a productivity factor from 60 to 150 to move it up or down for your ground. Protection per acre is the county base value times your coverage level times the factor. The premium moves with it in the same proportion, so the factor changes how many dollars ride on the policy, not the odds or the payment per premium dollar. One factor per county, use and practice.</p>

    <h2 id="payment">5. How a payment is figured</h2>
    <p>For an interval you insured, the payment is that interval&rsquo;s protection times how far the index fell under your coverage level, as a share of it. At 90% coverage, an index of 72 pays (90 &minus; 72) / 90 = 20% of the interval&rsquo;s protection. Payment comes within 60 days after RMA publishes the final index, with no claim to file, and any premium owed comes out first.</p>
    <p>A worked example on grid {ex['grid']}, {e(ex['county'])}: {ex['acres']} acres of grazing land, {ex['coverage']}% coverage, productivity factor 100, {e(ex['months'])}. At {cy} rates the county base value is {money2(exg['cbv'])} an acre, the protection {dollars(exg['protection'])}, the premium {dollars(exg['premium'])}, of which USDA pays {dollars(exg['usda'])} and you pay {dollars(exg['you'])} (${exg['per_acre']:.2f} an acre). Run over {y0} to {y1}, that policy would have paid something in {exg['paid_years']} of {exg['years']} years, more than your share of the premium in {exg['ahead_years']}, an average of {dollars(exg['avg'])} a year, and most in {big_year}: {dollars(big)}. The same policy on non-irrigated hay costs you {dollars(exh['you'])} on a county value of {money2(exh['cbv'])}.</p>

    <h2 id="worth">6. What the record says</h2>
    <p>For every grid, interval and coverage level USDA prices, the calculator works out what $1 of full premium would have paid back over {y0} to {y1} at {cy} rates. At 90% coverage the middle is ${pb90['mid']:.2f}, and 90% of the {pb90['n']:,} grid and interval pairs fall between ${pb90['p05']:.2f} and ${pb90['p95']:.2f}. No grid or interval stands out. On the share you pay after USDA&rsquo;s {int(round(sub['90'] * 100))}%, the same record is about ${you90:.2f} per $1. These are averages of a few big years and many small or empty ones. The neighboring grids and intervals move together, and none of it says what next year will do.</p>

    <h2 id="dates">7. Dates for {cy}</h2>
    <ul>
      <li><b>{sales}</b>: sales closing. New policies and any change to coverage, intervals, acres or productivity factor are due at your agent.</li>
      <li><b>{acre}</b>: acreage report, with any lease signed and in hand.</li>
      <li><b>{bill}</b>: premium billed, no earlier than this.</li>
    </ul>
    <p>From {cy}, grazing acres need livestock you have an interest in, equal to at least 25% of the stocking rate, or no payment is due and the premium is still owed. USDA&rsquo;s share needs form AD-1026 on file with the Farm Service Agency. <a href="/prf#before">Before you sign</a> &middot; <a href="/prf#prf-not">What PRF does not do</a> &middot; <a href="/prf#method">How the calculator figures it</a></p>

    <h2 id="faq">Questions</h2>
    <div class="prf-faq">{faq_html}</div>
    </div>
    <p class="prf-byline">By <a href="/about">Sigurd Lindquist</a>, CCA, who owns a licensed crop insurance agency. This page sells no insurance and asks for no contact details. Figures from USDA RMA&rsquo;s {cy} Actuarial Data Master and PRF index record, read {long_date(meta['built'][:10])}.</p>
    <nav class="prf-links prf-st-links" aria-label="PRF by state"><a href="/prf">PRF calculator</a> {st_links}</nav>
  </div>
  </main>
  <div id="site-footer"></div>
  <script src="/components/loader.js?v=19" defer></script>
</body>
</html>
"""


def main():
    meta = json.load(open(os.path.join(D, "meta.json")))
    facts = json.load(open(os.path.join(D, "facts.json")))
    if facts.get("built_from") != meta["built"] or facts.get("crop_year") != meta["crop_year"]:
        raise SystemExit("data/prf/facts.json is from another build of data/prf: run node scripts/prf_facts.mjs")
    BOOT = boot()
    sys.path.insert(0, os.path.join(ROOT, 'scripts'))
    import inject_static_nav as nav   # the site header, footer and font preloads, as on every top-level page
    hdr, ftr = nav.block('header'), nav.block('footer')
    states = sorted(meta["states"], key=lambda s: s["name"])
    import build_prf_counties  # each county row links to its page (prf/<state>/<county>.html)
    where = build_prf_counties.county_urls(meta)[0]
    want = {}
    for st in states:
        sd = json.load(open(os.path.join(D, "s", st["st"] + ".json")))
        body = nav.render(page(st, meta, facts, sd, states, BOOT, where), slug(st['name']) + '.html', hdr, ftr)
        if len(body.encode()) > MAX_KB * 1024:
            raise SystemExit(f"prf/{slug(st['name'])}.html would be {len(body.encode()) // 1024} KB, over {MAX_KB} KB")
        want[slug(st["name"]) + ".html"] = body
    want[GUIDE_SLUG + ".html"] = nav.render(guide(meta, facts, states, BOOT), GUIDE_SLUG + ".html", hdr, ftr)
    check = "--check" in sys.argv
    bad = []
    for fn, body in want.items():
        p = os.path.join(OUT, fn)
        have = open(p, encoding="utf-8").read() if os.path.exists(p) else None
        if check:
            if have != body:
                bad.append(fn)
        elif have != body:
            os.makedirs(OUT, exist_ok=True)
            open(p, "w", encoding="utf-8").write(body)
    if check:
        if bad:
            print("state pages out of date:", ", ".join(bad[:5]), "... run python3 scripts/build_prf_states.py")
            return 1
        print(f"{len(want)} state pages match data/prf")
        return 0
    print(f"{len(want)} state pages written to prf/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
