#!/usr/bin/env python3
"""build_county_rain.py: "How much rain has <County>, <State> had this year?"

WHY
  From harvest through January farmers search how much rain their county had
  this year. Each county with a NOAA station that reported enough days gets one
  page that answers it in the first line, in plain HTML, with the month by
  month table, the wettest month, the biggest rain, the longest dry stretch and
  last year by the same date, and a way to put the whole year on a Rain Print.

WHERE THE NUMBERS COME FROM
  data/rain/<st>.json, written by scripts/fetch_county_rain.py from NOAA's
  daily records (RCC-ACIS). Nothing is computed here but differences and
  rounding; this formats. A number the data file does not have (no normals,
  too early for a percent, last year too gappy) is left off the page, and the
  page says why where a reader would look for it.

WHAT IT WRITES
  rain/<state-slug>/<county-slug>.html   one per county with a qualifying station
  rain/<state-slug>.html                 every county in the state, and the ones without a station
  rain.html                              the hub, one line per state
  sitemap-rain.xml                       every page above (robots.txt names it)
  With no data files yet it writes an empty sitemap and nothing else.

SIZE (CLAUDE.md)
  About 12 KB a county page, at most MAX_KB; the build refuses anything over.
  No per-page styles (components/rain-county.css is shared and cached), no
  static header or footer copy in county and state pages (loader.js fills
  both; the hub, a root page, carries the static nav like every root page).
  About 3,000 county pages x 12 KB is about 36 MB; FOLDER_MB["rain"] in
  scripts/check_site_budget.py is 50.

  python3 scripts/build_county_rain.py              write
  python3 scripts/build_county_rain.py --check      exit 1 if anything differs from what this would write
  python3 scripts/build_county_rain.py --selftest   build from test/fixtures/rain into a temp folder and test it
  python3 scripts/build_county_rain.py --data DIR --root DIR   read data from DIR, write the site under DIR
"""
import datetime as dt
import glob
import json
import os
import re
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import county_rain as R  # noqa: E402
import build_prf_states as S  # noqa: E402  boot() and text_of()
import inject_static_nav as nav  # noqa: E402

ROOT = R.ROOT
MAX_KB = 25
CSS = '<link rel="stylesheet" href="/components/rain-county.css?v=1">'
ORIGIN = "https://agsist.com"
M3, ML = R.MONTHS, R.MONTHS_LONG


def e(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))


def short_date(iso):
    y, m, d = iso.split("-")
    return f"{M3[int(m) - 1]} {int(d)}"


def long_date(iso):
    y, m, d = iso.split("-")
    return f"{M3[int(m) - 1]} {int(d)}, {y}"


def inch(x):
    return f"{x:.2f}"


def inches_word(x, places=2):
    v = f"{x:.{places}f}"
    return f"{v} {'inch' if v in ('1.00', '1.0') else 'inches'}"


def done_year(c):
    return c["as_of"][5:] == "12-31"


def where_words(c):
    raw, net = c["station"]["raw"], c["station"]["net"]
    kind = "CoCoRaHS volunteer gauge" if net == "cocorahs" else "NOAA station"
    return f"the {kind} {R.station_where(raw)}"


def compare(c, year_word="a usual year to date"):
    """'That is 2.1 inches less than a usual year to date (91%).' or the reason there is none."""
    if c["usual"] is None:
        return "This station has no NOAA normal, so there is no usual year to compare it with."
    if c["pct"] is None:
        return "It is too early in the year for a fair comparison with a usual year."
    d = c["total"] - c["usual"]
    if abs(d) < 0.05:
        return f"That is about the same as {year_word} ({c['pct']}%)."
    return f"That is {inches_word(abs(d), 1)} {'more' if d > 0 else 'less'} than {year_word} ({c['pct']}%)."


def answer(c, county, year):
    w = where_words(c)
    if done_year(c):
        return (f"{inches_word(c['total'])} of rain fell in {year} at {w}, {county}. "
                + compare(c, "a usual year"))
    return (f"{inches_word(c['total'])} of rain so far in {year} at {w}, {county}, through {short_date(c['as_of'])}. "
            + compare(c))


def rain_print_href(c, st, year):
    town = R.station_town(c["station"]["raw"])
    place = f"{town}, {st}"[:32]
    sid = re.sub(r"[^A-Za-z0-9 ]", "", c["station"]["sid"]).strip()[:16]
    q = urllib.parse.urlencode({"place": place, "year": year, "station": sid})
    return "/rain-print?" + q


# ---------------------------------------------------------------- the chart

def chart(c, year, county):
    W, H, L, Rm, T, B = 520, 230, 38, 52, 10, 26
    n_year = 366 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 365
    pts = c["cum"]
    has_us = c["usual"] is not None and all(p[2] is not None for p in pts)
    top = max([c["total"]] + ([c["usual"]] if has_us else []) + [1.0])
    step = 1 if top <= 6 else 2 if top <= 12 else 5 if top <= 40 else 10
    ymax = step * (int(top / step) + 1)
    pw, ph = W - L - Rm, H - T - B
    X = lambda doy: L + pw * doy / n_year
    Y = lambda v: T + ph * (1 - v / ymax)
    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-labelledby="rc-ct"><title id="rc-ct">Running total of rain in {e(county)}, {year}'
           + (", against a usual year" if has_us else "") + "</title>"]
    for v in range(0, int(ymax) + 1, step):
        y = Y(v)
        out.append(f'<line class="{"rc-ax" if v == 0 else "rc-grid"}" x1="{L}" x2="{W - Rm}" y1="{y:.1f}" y2="{y:.1f}"/>'
                   f'<text class="rc-lab" x="{L - 6}" y="{y + 4:.1f}" text-anchor="end">{v}</text>')
    for m in range(12):
        doy = (dt.date(year, m + 1, 1) - dt.date(year, 1, 1)).days
        x = X(doy)
        out.append(f'<line class="rc-grid" x1="{x:.1f}" x2="{x:.1f}" y1="{T + ph}" y2="{T + ph + 4}"/>'
                   f'<text class="rc-lab" x="{X(doy + 15):.1f}" y="{H - 8}" text-anchor="middle">{M3[m][0]}</text>')

    def path(k):
        d = [f"M{X(0):.1f},{Y(0):.1f}"]
        for p in pts:
            d.append(f"L{X(p[0] + 1):.1f},{Y(p[k]):.1f}")
        return "".join(d)
    ly, lu = Y(pts[-1][1]), (Y(pts[-1][2]) if has_us else None)
    if has_us:
        out.append(f'<path class="rc-us" d="{path(2)}"/>')
        if abs(ly - lu) < 15:
            if ly <= lu:
                ly, lu = ly - (15 - (lu - ly)) / 2, lu + (15 - (lu - ly)) / 2
            else:
                lu, ly = lu - (15 - (ly - lu)) / 2, ly + (15 - (ly - lu)) / 2
    out.append(f'<path class="rc-yr" d="{path(1)}"/>')
    xe = X(pts[-1][0] + 1) + 5
    out.append(f'<text class="rc-yl" x="{xe:.1f}" y="{ly + 4:.1f}">{year}</text>')
    if has_us:
        out.append(f'<text class="rc-lab" x="{xe:.1f}" y="{lu + 4:.1f}">Usual</text>')
    out.append("</svg>")
    cap = (f"Inches of rain added up day by day from Jan 1{', solid line' if has_us else ''}"
           + (", against the usual year at this station (dashed), counted on the same days" if has_us else "")
           + ". Days with no report add nothing to either line.")
    return f'<figure class="rc-chart">{"".join(out)}<figcaption>{cap}</figcaption></figure>'


# ---------------------------------------------------------------- county page

def head(title, desc, url, ld, og_title=None, extra=""):
    ldh = "".join('<script type="application/ld+json">' + json.dumps(x, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/") + "</script>" for x in ld)
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0a0c0d">
  <link rel="stylesheet" href="/components/styles.css?v=23">
  {CSS}
  <link rel="icon" type="image/x-icon" href="/img/favicon.ico">
  <link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
  <title>{e(title)}</title>
  <meta name="description" content="{e(desc)}">
  <meta name="author" content="Sigurd Lindquist">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
  <link rel="canonical" href="{url}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="AGSIST">
  <meta property="og:title" content="{e(og_title or title.replace(' | AGSIST', ''))}">
  <meta property="og:description" content="{e(desc)}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="https://agsist.com/img/og/rain-print.jpg">
  <meta name="twitter:card" content="summary_large_image">
  {BOOT}
  {ldh}{extra}
</head>"""


AUTHOR = {"@type": "Person", "name": "Sigurd Lindquist", "jobTitle": "Certified Crop Adviser (CCA)", "url": "https://agsist.com/about"}
PUBLISHER = {"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com/"}
FOOT = """  </main>
  <div id="site-footer"></div>
  <script src="/components/loader.js?v=18" defer></script>
</body>
</html>
"""


def crumbs_ld(items):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": u} for i, (n, u) in enumerate(items)]}


def county_page(ctx):
    c, st, fips, year, d = ctx["c"], ctx["st"], ctx["fips"], ctx["year"], ctx["d"]
    stn = R.STATES[st]
    name = c["name"]
    full = f"{name}, {stn}"
    st_slug = R.slug(stn)
    url = f"{ORIGIN}/rain/{st_slug}/{ctx['slug']}"
    done = done_year(c)
    asof = c["as_of"]
    ans = answer(c, name, year)
    title = (f"How Much Rain Did {full} Get in {year}? | AGSIST" if done
             else f"How Much Rain Has {full} Had in {year}? | AGSIST")
    span = f"Jan 1 to {short_date(asof)}"
    pct_bit = f", {c['pct']}% of a usual year{'' if done else ' to date'}" if c["pct"] is not None else ""
    desc = (f"{inch(c['total'])} inches of rain in {full} in {year} ({span}){pct_bit}. "
            f"Month by month, the wettest month, the biggest rain and the longest dry stretch.")
    if len(desc) > 165:
        desc = f"{inch(c['total'])} inches of rain in {full} in {year} ({span}){pct_bit}. Month by month and the year's biggest rain."
    if len(desc) > 165:
        desc = f"{inch(c['total'])} inches of rain in {full}, {span}, {year}{pct_bit}."
    stw = c["station"]
    norm_words = ("NOAA&rsquo;s 1991 to 2020 daily normals for this station" if d["normals"] == "1991-2020"
                  else "NOAA&rsquo;s current 30-year daily normals for this station")
    # ---- figures
    figs = [(f"Rain {'in ' + str(year) if done else 'so far'}", f"{inch(c['total'])} <small>in</small>")]
    if c["usual"] is not None:
        figs.append((f"Usual {'year' if done else 'by ' + short_date(asof)}", f"{inch(c['usual'])} <small>in</small>"))
    if c["pct"] is not None:
        figs.append(("Percent of usual", f"{c['pct']}%"))
    if c.get("last"):
        figs.append((f"{year - 1} by {short_date(c['last']['through'])}", f"{inch(c['last']['total'])} <small>in</small>"))
    figs_html = "".join(f"<div><dt>{a}</dt><dd>{b}</dd></div>" for a, b in figs)
    # ---- month table
    has_us = c["usual"] is not None
    rows = []
    for i, (t, u, rep, days) in enumerate(c["months"]):
        lab = ML[i]
        if i == len(c["months"]) - 1 and not done and days < (dt.date(year + (i == 11), (i + 1) % 12 + 1, 1) - dt.date(year, i + 1, 1)).days:
            lab += f' <span class="rc-n">through the {days}{"st" if days in (1, 21, 31) else "nd" if days in (2, 22) else "rd" if days in (3, 23) else "th"}</span>'
        if rep < days:
            miss = days - rep
            lab += f' <span class="rc-n">{miss} {"day" if miss == 1 else "days"} not reported</span>'
        cells = f"<td>{inch(t)}</td>"
        if has_us:
            df = t - u
            cls = "rc-up" if df > 0.004 else "rc-dn" if df < -0.004 else ""
            sign = "+" if df > 0.004 else "&minus;" if df < -0.004 else ""
            cells += f"<td>{inch(u)}</td><td{' class=' + chr(34) + cls + chr(34) if cls else ''}>{sign}{inch(abs(df))}</td>"
        rows.append(f"<tr><td>{lab}</td>{cells}</tr>")
    tot = f"<td><b>{inch(c['total'])}</b></td>"
    if has_us:
        df = c["total"] - c["usual"]
        tot += f"<td><b>{inch(c['usual'])}</b></td><td><b>{'+' if df > 0.004 else '&minus;' if df < -0.004 else ''}{inch(abs(df))}</b></td>"
    head_cells = "<th scope=\"col\">Month</th><th scope=\"col\">Rain, in</th>" + ("<th scope=\"col\">Usual, in</th><th scope=\"col\">Difference</th>" if has_us else "")
    table = (f'<div class="rc-scroll" tabindex="0" role="region" aria-label="Rain by month"><table class="rc-t"><caption class="rc-sr">Rain by month in {e(full)}, {year}</caption>'
             f"<thead><tr>{head_cells}</tr></thead><tbody>{''.join(rows)}<tr><td><b>{'The year' if done else 'So far'}</b></td>{tot}</tr></tbody></table></div>")
    # ---- the year in a few lines
    facts = []
    faq = [(f"How much rain {'did' if done else 'has'} {full} {'get' if done else 'had'} in {year}?", ans)]
    if c["pct"] is not None:
        p = c["pct"]
        word = "About usual" if 97 <= p <= 103 else ("Wetter" if p > 103 else "Drier")
        faq.append((f"Is {name} wetter or drier than usual in {year}?",
                    f"{word}{'' if done else ' so far'}. {where_words(c)[0].upper() + where_words(c)[1:]} had {inches_word(c['total'])} "
                    f"{'in ' + str(year) if done else 'from Jan 1 to ' + short_date(asof)}, {p}% of the usual {inches_word(c['usual'])} for the same days."))
    if c.get("wet_month"):
        m, v = c["wet_month"]
        facts.append(f"<li><b>Wettest month:</b> {ML[m]}, {inches_word(v)}.</li>")
        faq.append((f"What was the wettest month in {name} in {year}?",
                    f"{ML[m]}, with {inches_word(v)} at {where_words(c)}{'' if done else ', counting the months through ' + short_date(asof)}."))
    if c.get("max_day"):
        dd, v = c["max_day"]
        facts.append(f"<li><b>Biggest single day:</b> {inches_word(v)} on {short_date(dd)}.</li>")
        faq.append((f"What was the biggest rain in {name} in {year}?",
                    f"{inches_word(v)} on {long_date(dd)}, the most the gauge caught in one day{'' if done else ' this year through ' + short_date(asof)}."
                    + (" Reports that cover more than one day are not counted as one day." if c["acc"] else "")))
    if c.get("dry") and c["dry"][0] >= 2:
        n, a, b = c["dry"]
        still = (b == asof and not done)
        facts.append(f"<li><b>Longest dry stretch:</b> {n} days in a row with the gauge at zero, {short_date(a)} to {short_date(b)}"
                     + (", still going on the last day reported" if still else "") + ".</li>")
    if c.get("last"):
        L = c["last"]
        d2 = c["total"] - L["total"]
        facts.append(f"<li><b>{year - 1} by the same date:</b> {inches_word(L['total'])} at the same station, "
                     + (f"so {year} is {inches_word(abs(d2), 1)} {'ahead' if d2 > 0 else 'behind'}." if abs(d2) >= 0.05 else f"about the same as {year}.") + "</li>")
        faq.append((f"How does {year} compare with {year - 1} in {name}?",
                    f"From Jan 1 to {short_date(L['through'])}, {where_words(c)} had {inches_word(L['total'])} in {year - 1} and {inches_word(c['total'])} in {year}."))
    if c["acc"] or c["unsplit"]:
        facts.append(f"<li>On {c['acc']} {'report' if c['acc'] == 1 else 'reports'} the observer read the gauge after more than one day. "
                     "That rain counts on the day it was read, so it is in the totals but not split by day.</li>")
    facts_html = f'<ul class="rc-list">{"".join(facts)}</ul>' if facts else ""
    # ---- station
    miss = c["missing"]
    station_p = (f"The numbers come from NOAA&rsquo;s daily record for {e(stw['name'])}"
                 f"{' (a CoCoRaHS volunteer gauge)' if stw['net'] == 'cocorahs' else ''}, {stw['mi']:.0f} miles from the middle of {e(name)}. "
                 f"It reported {c['reported']} of the {c['days']} days from Jan 1 to {short_date(asof)}"
                 + (f"; {'the one day' if miss == 1 else 'the ' + str(miss) + ' days'} with no report count as unknown, not as dry." if miss else ", every one.")
                 + " Rain here means everything the gauge caught: rain, and snow melted down to water. A trace counts as zero.")
    usual_p = (f"Usual means {norm_words}, added up over the same {c['reported']} days the station reported, so a missing day counts on neither side."
               if c["usual"] is not None else "This station has no NOAA normal, so this page gives no usual year or percent for it.")
    n_ok = c.get("n_ok", 1)
    if n_ok <= 1:
        pick_p = (f"Why this station: it is the only one inside {e(name)} that reported at least 90% of the days in {year}. "
                  "Your own rain gauge can read quite differently a few miles away.")
    else:
        pick_p = (f"Why this station: {n_ok} stations inside {e(name)} reported at least 90% of the days in {year}. "
                  "The pick goes to one with NOAA normals first, then the most days reported, then the one nearest the middle of the county. "
                  "Your own rain gauge can read quite differently a few miles away.")
    # ---- next door and links
    nb_html = "".join(f'<li><a href="{h}">{e(n)}<small>{v}</small></a></li>' for n, h, v in ctx["nbrs"])
    more = [(f"Rain in {e(stn)}, county by county", f"/rain/{st_slug}")]
    for label, top in (("PRF insurance in", "prf"), ("Farmland Atlas:", "farmland-atlas")):
        if os.path.exists(os.path.join(ROOT, top, st_slug, ctx["slug"] + ".html")):
            more.append((f"{label} {e(name)}", f"/{top}/{st_slug}/{ctx['slug']}"))
    more_html = " &middot; ".join(f'<a href="{h}">{t}</a>' for t, h in more)
    rp = rain_print_href(c, st, year)
    ship = "" if done else f" Prints of {year} ship in January, once the whole year is in."
    ld = [
        {"@context": "https://schema.org", "@type": "WebPage", "@id": url, "url": url, "name": title.replace(" | AGSIST", ""),
         "description": desc, "dateModified": d["fetched"][:10], "inLanguage": "en-US",
         "about": {"@type": "AdministrativeArea", "name": full}, "author": AUTHOR, "publisher": PUBLISHER},
        {"@context": "https://schema.org", "@type": "Dataset", "name": f"Rain in {full}, {year}, Jan 1 to {short_date(asof)}",
         "description": f"Daily precipitation from NOAA station {stw['raw']} ({stw['sid'].split(' ')[0]}) in {full}, added up by month for {year} through {long_date(asof)}"
                        + (", with NOAA daily normals summed over the same days." if c["usual"] is not None else "."),
         "url": url, "temporalCoverage": f"{year}-01-01/{asof}", "isBasedOn": "https://www.rcc-acis.org/",
         "spatialCoverage": {"@type": "Place", "name": full, "geo": {"@type": "GeoCoordinates", "latitude": stw["ll"][1], "longitude": stw["ll"][0]}},
         "creator": PUBLISHER, "dateModified": d["fetched"][:10],
         "distribution": {"@type": "DataDownload", "encodingFormat": "application/json", "contentUrl": f"{ORIGIN}/data/rain/{st.lower()}.json"}},
        {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": S.text_of(q), "acceptedAnswer": {"@type": "Answer", "text": S.text_of(a)}} for q, a in faq]},
        crumbs_ld([("Home", ORIGIN + "/"), ("Rain by county", ORIGIN + "/rain"), (stn, f"{ORIGIN}/rain/{st_slug}"), (name, url)]),
    ]
    faq_html = "".join(f"<details><summary>{q}</summary><p>{a}</p></details>" for q, a in faq)
    h1 = (f"How much rain did {e(full)} get in {year}?" if done else f"How much rain has {e(full)} had in {year}?")
    return head(title, desc, url, ld) + f"""
<body>
  <a href="#main" class="skip">Skip to content</a>
  <div id="site-header"></div>
  <main id="main" class="main" tabindex="-1">
  <div class="rc">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/rain">Rain by county</a> &rsaquo; <a href="/rain/{st_slug}">{e(stn)}</a> &rsaquo; <span aria-current="page">{e(name)}</span></nav>
    <p class="rc-asof">{'All of ' + str(year) + ', Jan 1 to Dec 31' if done else 'As of ' + long_date(asof) + ', the last day reported'}</p>
    <h1>{h1}</h1>
    <p class="rc-answer">{ans.replace(inches_word(c['total']), '<b>' + inches_word(c['total']) + '</b>', 1)}</p>
    <dl class="rc-figs">{figs_html}</dl>
    {chart(c, year, name)}
    <h2>Month by month</h2>
    {table}
    {('<h2>' + str(year) + (' in' if done else ' so far in') + ' ' + e(name) + '</h2>' + facts_html) if facts_html else ''}
    <section class="rc-cta" aria-labelledby="rc-cta-h">
      <h2 id="rc-cta-h">See the whole year on a print you can hang</h2>
      <p>Rain Print draws every day of {year} at this station on a 12 x 18 print: the rains, the dry spells, the dates you want to remember.{ship}</p>
      <a class="btn btn-primary" href="{e(rp)}">Draw the {year} Rain Print</a>
    </section>
    <h2>The station, and what usual means</h2>
    <p>{station_p}</p>
    <p>{usual_p}</p>
    <p class="rc-fine">{pick_p}</p>
    <h2>Questions</h2>
    <div class="rc-faq">{faq_html}</div>
    {('<h2>Next door</h2><ul class="rc-next">' + nb_html + '</ul>') if nb_html else ''}
    <p class="rc-fine">{more_html}</p>
    <p class="rc-byline">By <a href="/about">Sigurd Lindquist</a>, Certified Crop Adviser (CCA). Daily NOAA records through <a href="https://www.rcc-acis.org/" rel="noopener">RCC-ACIS</a>, read {long_date(d['fetched'][:10])}; this page is rebuilt every Monday. NOAA&rsquo;s daily numbers come in a few days late and are sometimes corrected.</p>
  </div>
{FOOT}"""


# ---------------------------------------------------------------- state page

def state_page(st, d, pages, none_rows):
    stn = R.STATES[st]
    st_slug = R.slug(stn)
    url = f"{ORIGIN}/rain/{st_slug}"
    year = d["year"]
    cs = d["counties"]
    asofs = sorted({c["as_of"] for c in cs.values()})
    done = all(done_year(c) for c in cs.values())
    pcts = sorted(c["pct"] for c in cs.values() if c["pct"] is not None)
    mid = pcts[len(pcts) // 2] if len(pcts) % 2 else (round((pcts[len(pcts) // 2 - 1] + pcts[len(pcts) // 2]) / 2) if pcts else None)
    title = f"How Much Rain Has {stn} Had in {year}? Every County | AGSIST" if not done else f"How Much Rain Did {stn} Get in {year}? Every County | AGSIST"
    lede = (f"{len(cs)} {stn} counties have a NOAA station inside the county that reported at least 90% of the days in {year}"
            + ("." if done else f", through {short_date(asofs[-1])}" + (f" (a few stations stop a day or more earlier)." if len(asofs) > 1 else ".")))
    if mid is not None:
        lede += f" The middle county is at {mid}% of a usual year{'' if done else ' to date'}."
    wettest = max(cs.items(), key=lambda kv: kv[1]["total"])
    driest = min(cs.items(), key=lambda kv: kv[1]["total"])
    desc = (f"Rain {'in' if done else 'so far in'} {year} in {len(cs)} {stn} counties, from NOAA stations: inches, percent of usual and the station. "
            f"Most: {wettest[1]['name']}, {inch(wettest[1]['total'])} in.")
    if len(desc) > 165:
        desc = f"Rain {'in' if done else 'so far in'} {year} in {len(cs)} {stn} counties from NOAA stations: inches, percent of usual, the station."
    rows = []
    for fips, c in sorted(cs.items(), key=lambda kv: kv[1]["name"]):
        href = pages[fips][1]
        rows.append(f'<tr><td><a href="{href}">{e(c["name"])}</a></td><td>{inch(c["total"])}</td>'
                    f'<td>{inch(c["usual"]) if c["usual"] is not None else "none"}</td><td>{str(c["pct"]) + "%" if c["pct"] is not None else "none"}</td>'
                    f'<td>{e(c["station"]["name"])}</td><td>{short_date(c["as_of"])}</td></tr>')
    none_html = ""
    if none_rows:
        items = "".join(f"<li>{e(n)}: {('nearest county with one is <a href=' + chr(34) + h + chr(34) + '>' + e(nn) + '</a>') if h else 'no county nearby has one either'}</li>"
                        for n, nn, h in none_rows)
        none_html = (f'<h2>Counties where no NOAA station reported enough days</h2><p>These {len(none_rows)} counties have no station inside them that reported at least 90% of the days '
                     f'in {year}{"" if done else " so far"}, so they get no page. A missing day is not a dry day, and a total with too many of them would read low.</p><ul class="rc-list">{items}</ul>')
    ld = [
        {"@context": "https://schema.org", "@type": "WebPage", "@id": url, "url": url, "name": title.replace(" | AGSIST", ""), "description": desc,
         "dateModified": d["fetched"][:10], "inLanguage": "en-US", "about": {"@type": "AdministrativeArea", "name": stn}, "author": AUTHOR, "publisher": PUBLISHER},
        crumbs_ld([("Home", ORIGIN + "/"), ("Rain by county", ORIGIN + "/rain"), (stn, url)]),
    ]
    h1 = f"How much rain has {e(stn)} had in {year}? County by county" if not done else f"How much rain did {e(stn)} get in {year}? County by county"
    return head(title, desc, url, ld) + f"""
<body>
  <a href="#main" class="skip">Skip to content</a>
  <div id="site-header"></div>
  <main id="main" class="main" tabindex="-1">
  <div class="rc">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/rain">Rain by county</a> &rsaquo; <span aria-current="page">{e(stn)}</span></nav>
    <p class="rc-asof">{'All of ' + str(year) if done else 'As of ' + long_date(asofs[-1])}</p>
    <h1>{h1}</h1>
    <p class="rc-answer">{lede}</p>
    <div class="rc-scroll" tabindex="0" role="region" aria-label="Every county, scrolls sideways"><table class="rc-t rc-t-wide"><caption class="rc-sr">Rain {'in' if done else 'so far in'} {year} by county, {e(stn)}</caption>
    <thead><tr><th scope="col">County</th><th scope="col">Rain, in</th><th scope="col">Usual, in</th><th scope="col">Percent of usual</th><th scope="col">NOAA station</th><th scope="col">Through</th></tr></thead>
    <tbody>{''.join(rows)}</tbody></table></div>
    <p class="rc-fine">Usual is NOAA&rsquo;s daily normal at each station, added up over the days that station reported. A station with no NOAA normal shows none. Each county page has the month by month table and how the station was picked.</p>
    {none_html}
    <p class="rc-byline">By <a href="/about">Sigurd Lindquist</a>, Certified Crop Adviser (CCA). Daily NOAA records through <a href="https://www.rcc-acis.org/" rel="noopener">RCC-ACIS</a>, read {long_date(d['fetched'][:10])}; rebuilt every Monday. <a href="/rain">Every state</a> &middot; <a href="/rain-print">Rain Print</a></p>
  </div>
{FOOT}"""


# ---------------------------------------------------------------- hub

def hub_page(files, built):
    url = f"{ORIGIN}/rain"
    years = sorted({d["year"] for d in files.values()})
    yw = str(years[-1]) if len(years) == 1 else f"{years[0]} to {years[-1]}"
    total = sum(len(d["counties"]) for d in files.values())
    rows = []
    for st, d in sorted(files.items(), key=lambda kv: R.STATES[kv[0]]):
        if not d["counties"]:
            continue
        pcts = sorted(c["pct"] for c in d["counties"].values() if c["pct"] is not None)
        mid = pcts[len(pcts) // 2] if pcts else None
        last = max(c["as_of"] for c in d["counties"].values())
        rows.append(f'<li><a href="/rain/{R.slug(R.STATES[st])}">{e(R.STATES[st])}</a> <small>{len(d["counties"])} counties'
                    + (f", middle county {mid}% of usual" if mid is not None else "") + f", {d['year']} through {short_date(last)}</small></li>")
    title = "How Much Rain Has Your County Had This Year? | AGSIST"
    desc = (f"Rain so far in {yw} for {total:,} US counties, from the NOAA station in each county: inches, percent of a usual year, month by month.")
    ld = [
        {"@context": "https://schema.org", "@type": "WebPage", "@id": url, "url": url, "name": title.replace(" | AGSIST", ""), "description": desc,
         "dateModified": built, "inLanguage": "en-US", "author": AUTHOR, "publisher": PUBLISHER},
        crumbs_ld([("Home", ORIGIN + "/"), ("Rain by county", url)]),
    ]
    page = head(title, desc, url, ld) + f"""
<body>
  <a href="#main" class="skip">Skip to content</a>
  <div id="site-header"></div>
  <main id="main" class="main" tabindex="-1">
  <div class="rc">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <span aria-current="page">Rain by county</span></nav>
    <h1>How much rain has your county had this year?</h1>
    <p class="rc-answer">Pick your state, then your county. Each county page gives the rain {yw} so far at the NOAA station in that county, against a usual year, month by month.</p>
    <ul class="rc-states">{''.join(rows)}</ul>
    <h2>How these numbers are kept honest</h2>
    <ul class="rc-list">
      <li>One NOAA station per county, inside the county, and only one that reported at least 90% of the days this year. Counties without one are listed on the state page with the nearest county that has one.</li>
      <li>A day the station did not report is unknown, not dry. It adds nothing to the total and nothing to the usual year either.</li>
      <li>Usual is NOAA&rsquo;s daily normal for that station, added up over the same days it reported.</li>
      <li>Every page says the last day reported. NOAA&rsquo;s daily numbers come in a few days late, and the pages are rebuilt every Monday.</li>
    </ul>
    <p class="rc-fine">Want one year of rain at your place on the wall? <a href="/rain-print">Rain Print</a> draws it from the same NOAA records.</p>
    <p class="rc-byline">By <a href="/about">Sigurd Lindquist</a>, Certified Crop Adviser (CCA). Daily NOAA records through <a href="https://www.rcc-acis.org/" rel="noopener">RCC-ACIS</a>.</p>
  </div>
{FOOT}"""
    return nav.render(page, "rain.html", nav.block("header"), nav.block("footer"))


def sitemap(urls):
    body = "".join(f"  <url><loc>{u}</loc><lastmod>{m}</lastmod></url>\n" for u, m in urls)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!-- Rain by county. Written by scripts/build_county_rain.py; lastmod is the day the NOAA records were read. -->\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + "</urlset>\n")


# ---------------------------------------------------------------- build

BOOT = None


def load(data_dir):
    files = {}
    for p in sorted(glob.glob(os.path.join(data_dir, "*.json"))):
        d = json.load(open(p, encoding="utf-8"))
        if d.get("state") in R.STATES:
            files[d["state"]] = d
    return files


def build(data_dir, C=None, NB=None):
    """{relative path: text} for everything this build owns."""
    global BOOT
    if BOOT is None:
        BOOT = S.boot()
    C = C or R.counties()
    NB = NB if NB is not None else R.neighbors()
    files = load(data_dir)
    pages = {}   # fips -> (name, href, total text)
    for st, d in files.items():
        for fips, c in d["counties"].items():
            if fips in C:
                pages[fips] = (c["name"], f"/rain/{R.slug(R.STATES[st])}/{C[fips]['slug']}",
                               f"{inch(c['total'])} in" + (f", {c['pct']}%" if c["pct"] is not None else ""))
    want, urls = {}, []
    for st, d in sorted(files.items(), key=lambda kv: R.STATES[kv[0]]):
        st_slug = R.slug(R.STATES[st])
        day = d["fetched"][:10]
        for fips, c in sorted(d["counties"].items()):
            if fips not in C:
                continue
            nb = [f for f in NB.get(fips, []) if f in pages]
            nb.sort(key=lambda f: (C[f]["st"] != st, pages[f][0]))
            nbrs = [(pages[f][0] + ("" if C[f]["st"] == st else ", " + C[f]["st"]), pages[f][1], pages[f][2]) for f in nb[:4]]
            body = county_page({"c": c, "st": st, "fips": fips, "year": d["year"], "d": d, "slug": C[fips]["slug"],
                                "nbrs": nbrs, "n_ok": c.get("n_ok", 1)})
            body = nav.fill_fonts(body)
            rel = f"rain/{st_slug}/{C[fips]['slug']}.html"
            if len(body.encode()) > MAX_KB * 1024:
                raise SystemExit(f"{rel} would be {len(body.encode()) // 1024} KB, over {MAX_KB} KB")
            want[rel] = body
            urls.append((f"{ORIGIN}/rain/{st_slug}/{C[fips]['slug']}", day))
        if d["counties"]:
            none_rows = []
            for fips, x in sorted(d["none"].items(), key=lambda kv: kv[1]["name"]):
                nf = x.get("near")
                if nf and nf in pages:
                    nn = pages[nf][0] + ("" if C[nf]["st"] == st else ", " + C[nf]["st"])
                    none_rows.append((x["name"], nn, pages[nf][1]))
                else:
                    none_rows.append((x["name"], None, None))
            want[f"rain/{st_slug}.html"] = nav.fill_fonts(state_page(st, d, pages, none_rows))
            urls.insert(0, (f"{ORIGIN}/rain/{st_slug}", day))
    if pages:
        built = max(d["fetched"][:10] for d in files.values())
        want["rain.html"] = hub_page(files, built)
        urls.insert(0, (f"{ORIGIN}/rain", built))
    urls = [urls[0]] + sorted(urls[1:]) if pages else []
    want["sitemap-rain.xml"] = sitemap(urls)
    return want


def owned(root):
    """Files under root this build owns now (to find stale ones)."""
    out = set()
    for p in glob.glob(os.path.join(root, "rain", "**", "*.html"), recursive=True):
        out.add(os.path.relpath(p, root).replace(os.sep, "/"))
    for f in ("rain.html", "sitemap-rain.xml"):
        if os.path.exists(os.path.join(root, f)):
            out.add(f)
    return out


def write_or_check(want, root, check):
    bad, wrote = [], 0
    for rel, body in want.items():
        p = os.path.join(root, rel)
        have = open(p, encoding="utf-8").read() if os.path.exists(p) else None
        if have != body:
            if check:
                bad.append(rel)
            else:
                os.makedirs(os.path.dirname(p) or root, exist_ok=True)
                open(p, "w", encoding="utf-8").write(body)
                wrote += 1
    stale = sorted(owned(root) - set(want))
    if check:
        return bad + stale
    for rel in stale:
        os.remove(os.path.join(root, rel))
    for dd in glob.glob(os.path.join(root, "rain", "*")):
        if os.path.isdir(dd) and not os.listdir(dd):
            os.rmdir(dd)
    return wrote, stale


def selftest():
    import subprocess
    import tempfile
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
    fx = os.path.join(ROOT, "test", "fixtures", "rain")
    with tempfile.TemporaryDirectory() as t:
        data = os.path.join(t, "data")
        for st, ed in (("IA", "2026-10-12"), ("KS", "2026-10-12"), ("DE", "2024-12-31")):
            r = subprocess.run([sys.executable, os.path.join(HERE, "fetch_county_rain.py"), "--fixtures", fx, "--out", data, "--states", st, "--edate", ed],
                               capture_output=True, text=True)
            ok(r.returncode == 0, f"fixture fetch {st}: {r.stdout[-300:]} {r.stderr[-300:]}")
        want = build(data)
        site = os.path.join(t, "site")
        write_or_check(want, site, False)
        ok(write_or_check(build(data), site, True) == [], "a second build matches the first (--check)")
        story = want.get("rain/iowa/story-county.html", "")
        ok(story, "Story County page written")
        ok("rain/iowa/hamilton-county.html" not in want, "no page for a county without a station")
        ok("rain/iowa/boone-county.html" not in want, "no page for a county whose station missed too many days")
        ok("rain/wyoming.html" not in want, "no state page without data")
        for rel, body in want.items():
            if not rel.endswith(".html"):
                continue
            ok("—" not in body and "&mdash;" not in body, f"{rel}: em dash")
            ok(len(body.encode()) <= MAX_KB * 1024, f"{rel}: over {MAX_KB} KB")
            for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', body, re.S):
                try:
                    json.loads(m.group(1))
                except ValueError as x:
                    fails.append(f"{rel}: JSON-LD does not parse ({x})")
            ok(body.count("<title>") == 1 and '<link rel="canonical"' in body, f"{rel}: title and canonical")
            ok("today" not in S.text_of(re.sub(r"<script.*?</script>", "", body, flags=re.S)).lower(), f"{rel}: never says today")
        d = json.load(open(os.path.join(data, "ia.json")))
        c = d["counties"]["19169"]
        ok(f"{c['total']:.2f} inches of rain so far in 2026 at the NOAA station 8 miles west-southwest of Ames, Story County, through Oct 12." in story,
           "the answer comes first, in plain words")
        ok(f"({c['pct']}%)" in story and ("less than a usual year to date" in story or "more than a usual year to date" in story), "the comparison sentence")
        ok("<title>How Much Rain Has Story County, Iowa Had in 2026? | AGSIST</title>" in story, "title")
        ok(re.search(r'<meta name="description" content="27\.61 inches of rain in Story County, Iowa in 2026', story) is not None, "description carries the number")
        ok("/rain-print?place=Ames%2C+IA&amp;year=2026&amp;station=130203+2" in story, "Rain Print link draws that place and year")
        ok("See the whole year on a print you can hang" in story, "Rain Print CTA")
        ok("ship in January" in story, "this year's prints ship in January")
        ok('"@type":"FAQPage"' in story and '"@type":"Dataset"' in story and '"@type":"BreadcrumbList"' in story, "structured data")
        ok("As of Oct 12, 2026" in story, "as-of date shown")
        ok('<svg viewBox' in story and 'class="rc-us"' in story, "chart with the usual line")
        ok("1991 to 2020" in story, "normals period named when ACIS confirmed it")
        ok('href="/rain/iowa/polk-county"' in story or 'href="/rain/iowa/marshall-county"' in story, "next-door links")
        ok("3 days not reported" not in story and "1 day not reported" in story, "a month with a gap says so")
        jef = want.get("rain/iowa/greene-county.html", "")
        ok(jef and "no NOAA normal" in jef and "Percent of usual" not in jef and 'class="rc-us"' not in jef, "no normals: no percent, no usual line")
        ok(jef and "CoCoRaHS volunteer gauge" in jef, "a CoCoRaHS gauge is named as one")
        ks = want.get("rain/kansas/riley-county.html", "")
        ok(ks and "1991 to 2020" not in ks and "current 30-year" in ks, "normals period not claimed when ACIS did not confirm it")
        ok(ks and "read the gauge after more than one day" in ks, "accumulated reports explained")
        de = want.get("rain/delaware/kent-county.html", "")
        ok(de and "How Much Rain Did Kent County, Delaware Get in 2024?" in de and "fell in 2024" in de, "finished year wording")
        ok(de and "ship in January" not in de and "All of 2024" in de, "finished year: no January note")
        stp = want.get("rain/iowa.html", "")
        ok("Hamilton County: nearest county with one is <a href=" in stp, "no-station county listed with the nearest that has one")
        ok('href="/rain/iowa/story-county"' in stp, "state page links each county")
        sm = want["sitemap-rain.xml"]
        n_pages = sum(1 for k in want if k.endswith(".html"))
        ok(sm.count("<loc>") == n_pages, f"sitemap lists every page ({sm.count('<loc>')} of {n_pages})")
        ok("https://agsist.com/rain</loc>" in sm and "https://agsist.com/rain/iowa/story-county</loc>" in sm, "sitemap URLs are clean")
        hub = want["rain.html"]
        ok("static-nav:header" in hub, "hub carries the static nav")
        # no data at all: an empty sitemap and nothing else
        empty = build(os.path.join(t, "nothing"))
        ok(list(empty) == ["sitemap-rain.xml"] and "<loc>" not in empty["sitemap-rain.xml"], "no data: empty sitemap only")
        write_or_check(empty, site, False)
        ok(not os.path.exists(os.path.join(site, "rain", "iowa", "story-county.html")) and not os.path.exists(os.path.join(site, "rain.html")), "stale pages removed")
        sizes = [len(b.encode()) for k, b in want.items() if k.count("/") == 2]
        print(f"  fixture county pages: {len(sizes)}, largest {max(sizes) / 1024:.1f} KB, mean {sum(sizes) / len(sizes) / 1024:.1f} KB")
    for f in fails:
        print("FAIL", f)
    print("county rain pages selftest:", "ok" if not fails else f"{len(fails)} failure(s)")
    return 0 if not fails else 1


def main(argv):
    def arg(k):
        return argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else None
    if "--selftest" in argv:
        return selftest()
    data = arg("--data") or os.path.join(ROOT, "data", "rain")
    root = arg("--root") or ROOT
    want = build(data)
    if "--check" in argv:
        bad = write_or_check(want, root, True)
        if bad:
            print("rain pages out of date:", ", ".join(bad[:5]), f"({len(bad)}) ... run python3 scripts/build_county_rain.py")
            return 1
        print(f"{sum(1 for k in want if k.endswith('.html'))} rain pages and sitemap-rain.xml match data/rain")
        return 0
    wrote, stale = write_or_check(want, root, False)
    html = [b for k, b in want.items() if k.startswith("rain/") and k.count("/") == 2]
    tot = sum(len(b.encode()) for k, b in want.items() if k.endswith(".html"))
    print(f"{len(html)} county pages, {sum(1 for k in want if k.startswith('rain/') and k.count('/') == 1)} state pages; "
          f"{tot / 1048576:.1f} MB in all, largest county page {max((len(b.encode()) for b in html), default=0) / 1024:.1f} KB; "
          f"{wrote} written, {len(stale)} stale removed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
