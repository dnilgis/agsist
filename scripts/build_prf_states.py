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


def text_of(fragment):
    t = re.sub(r"<[^>]+>", "", fragment)
    return re.sub(r"\s+", " ", html.unescape(t)).strip()


def page(st, meta, facts, sd, states, BOOT):
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
    title = f"PRF Insurance in {name}: {cy} Rates and County Values | AGSIST"
    desc = (f"PRF (Pasture, Rangeland, Forage) insurance in {name} for {cy}: county base values for grazing and hay in all "
            f"{n_co} {'county' if n_co == 1 else 'counties'}, rates by month and a free calculator.")
    if len(desc) > 160:
        desc = f"PRF (Pasture, Rangeland, Forage) insurance in {name} for {cy}: county values for grazing and hay, rates by month, free calculator."
    rows = []
    for k, c in counties:
        lim = c.get("lim") or next(iter((c.get("limc") or {}).values()), None)
        b = c["b"]
        rows.append(f'<tr><th scope="row">{e(c["n"])}</th><td>{len(c["g"])}</td><td>{money2(b[0])}</td><td>{money2(b[4])}</td>'
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
         f"USDA&rsquo;s {cy} files list PRF in {n_co} {name} {'county' if n_co == 1 else 'counties'}, across {n_grid:,} grids. Each county row below opens the calculator on that county."),
        (f"Has PRF paid more than it cost in {name}?",
         f"On the full premium, about the same as everywhere: across {name}&rsquo;s grids at 90% coverage, $1 of premium would have paid back a middle ${f['payback_mid_90']:.2f} over {y0} to {y1} at {cy} rates. "
         f"USDA pays half or more of the premium, so the producer&rsquo;s share has done better on average. Most of that comes in a few dry years, and none of it says what next year will do."),
    ]
    faq_html = "".join(f"<details><summary>{q}</summary><p>{a}</p></details>" for q, a in faq)
    others = " ".join(f'<a href="/prf/{slug(x["name"])}">{e(x["name"])}</a>' for x in states if x["st"] != code)
    sod = (f'<p class="prf-note">{name} is one of six states with the native sod rule: native sod broken in recent years gets 65% of the protection '
           f'and 50 points less of USDA&rsquo;s share (Crop Provisions, section 4(g)). The values below are for land the rule does not touch.</p>') if code in SOD else ""
    ld = [
        {"@context": "https://schema.org", "@type": "WebPage", "@id": url, "url": url, "name": title.replace(" | AGSIST", ""), "description": desc,
         "dateModified": meta["built"][:10], "inLanguage": "en-US", "isPartOf": {"@id": "https://agsist.com/prf#app"},
         "author": {"@type": "Person", "name": "Sigurd Lindquist", "url": "https://agsist.com/about"},
         "publisher": {"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com/"}},
        {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": text_of(q), "acceptedAnswer": {"@type": "Answer", "text": text_of(a)}} for q, a in faq]},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://agsist.com/"},
            {"@type": "ListItem", "position": 2, "name": "PRF insurance calculator", "item": "https://agsist.com/prf"},
            {"@type": "ListItem", "position": 3, "name": name, "item": url}]},
    ]
    ldh = "".join('<script type="application/ld+json">' + json.dumps(b, ensure_ascii=False).replace("</", "<\\/") + "</script>" for b in ld)
    # Sig, 2026-10-12: the PRF state slots are priced on request, prepaid, with the
    # placement guaranteed to the end of the year. Kept out of the self-serve
    # monthly flow (/sponsor-apply) and out of data/sponsor-slots.json on purpose:
    # the link is not /sponsor-apply, so scripts/stamp_rates.py adds no price.
    yr = meta["dates"]["sales_closing"][:4]
    subj = f"PRF sponsor: {name}".replace(" ", "%20")
    ribbon = (f'<aside class="ag-sponsor-ribbon"><span class="ag-sponsor-tag">Sponsor this page</span> '
              f'One sponsor for PRF in {e(name)}: your name on this page, seen by people pricing PRF here before the {sales} sales closing. '
              f'Prepaid, with the placement guaranteed through Dec 31, {yr}, and the first say on renewing. '
              f'<span class="ag-sponsor-price">Price on request</span> '
              f'<a href="mailto:sig@farmers1st.com?subject={subj}" data-out="prf-sponsor">Ask about this page &rarr;</a></aside>')
    subrow = ", ".join(f"{int(round(sub[c] * 100))}% at {c}%" for c in sorted(sub, key=int))
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0a0c0d">
  <link rel="preload" href="/components/styles.css?v=23" as="style">
  <link rel="stylesheet" href="/components/styles.css?v=23">
  <link rel="stylesheet" href="/components/prf.css?v=2">
  <link rel="icon" type="image/x-icon" href="/img/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32.png">
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
    <p><a class="prf-btn prf-btn-go prf-cta" href="/prf?st={code}">Open the PRF calculator for {e(name)}</a></p>
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
    {ribbon}
    <div class="prf-prose">
    <h2 id="months">What each pair of months costs in {e(name)}</h2>
    <p>At 90% coverage, across the {n_grid:,} grids that touch a {e(name)} county with PRF. The premium is the full rate per $100 of protection; USDA pays {subrow}.</p>
    <div class="prf-scroll"><table class="prf-sub-t prf-iv-t"><thead><tr><th scope="col">Months</th><th scope="col">Normal precipitation, middle grid</th><th scope="col">Premium per $100, middle grid</th><th scope="col">Years under 90% of normal, of {ny}, middle grid</th><th scope="col">Grids offered</th></tr></thead><tbody>{iv}</tbody></table></div>
    <p>Across {e(name)}&rsquo;s grids, $1 of full premium at 90% coverage would have paid back a middle ${f['payback_mid_90']:.2f} over {y0} to {y1} at {cy} rates ({f['payback_n_90']:,} grid and month pairs). USDA sets each rate from the same record, so no month or grid is a bargain on it. The months to insure are the ones when a dry spell costs you grass or hay.</p>
    </div>

    <h2 id="counties">PRF in every {e(name)} county</h2>
    <p class="prf-fine">USDA&rsquo;s county base value per acre for {cy}, the number of grids that touch the county, and the most of a policy that can go in January to February. Open a county to set acres, months and coverage.</p>
    <div class="prf-scroll"><table class="prf-t prf-co-t"><thead><tr><th scope="col">County</th><th scope="col">Grids</th><th scope="col">Grazing</th><th scope="col">Hay, non-irrigated</th><th scope="col">Jan-Feb cap</th><th scope="col"><span class="prf-sr">Calculator</span></th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>

    <div class="prf-prose">
    <h2 id="dates">PRF dates for {cy}</h2>
    <ul>
      <li><b>{sales}</b>: sales closing. New policies and changes are due at your agent.</li>
      <li><b>{acre}</b>: acreage report, with any lease signed and in hand.</li>
      <li><b>{bill}</b>: premium billed, no earlier than this. Premium owed comes out of any payment first.</li>
    </ul>
    <p>From {cy}, grazing acres need livestock you have an interest in, equal to at least 25% of the stocking rate, or no payment is due and the premium is still owed (2027 Crop Provisions, section 4(j)). USDA&rsquo;s share of the premium needs form AD-1026 on file with the Farm Service Agency. PRF pays on a precipitation index for the grid, not on your production. <a href="/prf#before">Before you sign</a> &middot; <a href="/prf#new">New for 2027</a> &middot; <a href="/prf#payback">Does PRF pay back more than it costs?</a></p>

    <h2 id="faq">PRF questions in {e(name)}</h2>
    <div class="prf-faq">{faq_html}</div>
    </div>

    <p class="prf-byline">By <a href="/about">Sigurd Lindquist</a>, a Certified Crop Adviser (CCA) who owns a licensed crop insurance agency. This page sells no insurance, asks for no contact details and sends no one to any agent. Sponsored space is marked in orange. Figures from USDA RMA&rsquo;s {cy} Actuarial Data Master and PRF index record, read {long_date(meta['built'][:10])}.</p>
    <nav class="prf-links prf-st-links" aria-label="PRF in other states"><a href="/prf">PRF calculator</a> {others}</nav>
  </div>
  </main>
  <div id="site-footer"></div>
  <script src="/components/loader.js?v=18" defer></script>
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
    want = {}
    for st in states:
        sd = json.load(open(os.path.join(D, "s", st["st"] + ".json")))
        body = nav.render(page(st, meta, facts, sd, states, BOOT), slug(st['name']) + '.html', hdr, ftr)
        if len(body.encode()) > MAX_KB * 1024:
            raise SystemExit(f"prf/{slug(st['name'])}.html would be {len(body.encode()) // 1024} KB, over {MAX_KB} KB")
        want[slug(st["name"]) + ".html"] = body
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
