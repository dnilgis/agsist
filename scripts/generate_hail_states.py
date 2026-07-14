#!/usr/bin/env python3
"""
generate_hail_states.py — emits a static /hail-map/{state} page for every state
from data/hail/state-counties.json, and maintains their sitemap entries.

WHY: the national hail map is one URL competing for thousands of query shapes
("hail map texas", "worst hail counties kansas", "does it hail in colorado").
The county-ranking data already computed monthly contains everything a
state-level page needs. Static pages = full crawler visibility = the citation
lane, same playbook as the rest of the site.

Runs in GitHub Actions after the monthly hail-data refresh (or on dispatch).
Idempotent: identical inputs produce identical pages; sitemap entries live
between marker comments and are fully regenerated each run.

v1.1 — 2026-07-03 (cross-state link mesh on every page)
"""

import json
import os
import re
import sys
from datetime import datetime, timezone

SC = "data/hail/state-counties.json"
OUTDIR = "hail-map"
SITEMAP = "sitemap.xml"
MARK_A = "<!-- HAIL-STATE-PAGES -->"
MARK_B = "<!-- /HAIL-STATE-PAGES -->"

STATE_NAME = {"AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California","CO":"Colorado","CT":"Connecticut","DE":"Delaware","DC":"District of Columbia","FL":"Florida","GA":"Georgia","HI":"Hawaii","ID":"Idaho","IL":"Illinois","IN":"Indiana","IA":"Iowa","KS":"Kansas","KY":"Kentucky","LA":"Louisiana","ME":"Maine","MD":"Maryland","MA":"Massachusetts","MI":"Michigan","MN":"Minnesota","MS":"Mississippi","MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada","NH":"New Hampshire","NJ":"New Jersey","NM":"New Mexico","NY":"New York","NC":"North Carolina","ND":"North Dakota","OH":"Ohio","OK":"Oklahoma","OR":"Oregon","PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina","SD":"South Dakota","TN":"Tennessee","TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia","WA":"Washington","WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming"}

MONTH_FULL = {"Jan":"January","Feb":"February","Mar":"March","Apr":"April","May":"May","Jun":"June","Jul":"July","Aug":"August","Sep":"September","Oct":"October","Nov":"November","Dec":"December"}


def slug(name):
    return re.sub(r"[^a-z]+", "-", name.lower()).strip("-")


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def all_state_links(current):
    return " ".join('<a href="/hail-map/' + slug(n) + '">' + esc(n) + "</a>"
                    for n in sorted(STATE_NAME.values()) if n != current)


def merge_counties(rows, n_yrs):
    """Upstream names arrive with mixed casing ("Dane"/"DANE") splitting one
    county into two rows — merge case-insensitively, totals summed, damaging
    share re-weighted, then re-rank."""
    seen = {}
    out = []
    for r in rows:
        k = str(r.get("county", "")).lower().strip()
        if k in seen:
            m = seen[k]
            t1, t2 = m.get("total", 0), r.get("total", 0)
            T = t1 + t2
            if T:
                m["dmg_pct"] = round(((m.get("dmg_pct", 0) or 0) * t1 +
                                      (r.get("dmg_pct", 0) or 0) * t2) / T)
            if t2 > t1:
                m["county"] = r.get("county", m["county"])
                m["peak"] = r.get("peak") or m.get("peak")
            m["total"] = T
            m["avg"] = round(T / max(1, n_yrs), 1)
        else:
            seen[k] = dict(r)
            out.append(seen[k])
    out.sort(key=lambda x: -(x.get("total", 0)))
    return out


def page_html(abbr, name, rows, years, dmg_in, today):
    n_yrs = len(years)
    rows = merge_counties(rows, n_yrs)
    total = sum(r.get("total", 0) for r in rows)
    top = rows[0] if rows else None
    # dominant peak month across the top counties, weighted by report count
    month_w = {}
    for r in rows:
        m = r.get("peak")
        if m:
            month_w[m] = month_w.get(m, 0) + r.get("total", 0)
    peak = max(month_w, key=month_w.get) if month_w else None
    peak_full = MONTH_FULL.get(peak, peak) if peak else None
    heavy = total >= 400
    canonical = "https://agsist.com/hail-map/" + slug(name)

    trs = "".join(
        '<tr><td>' + esc(r.get("county", "")) + '</td>'
        '<td class="num">' + str(r.get("total", 0)) + '</td>'
        '<td class="num">' + str(r.get("avg", "")) + '</td>'
        '<td>' + esc(r.get("peak", "") or "&mdash;") + '</td>'
        '<td class="num">' + str(r.get("dmg_pct", "")) + '%</td></tr>'
        for r in rows[:15])

    faq = [
        ("Where does it hail the most in " + name + "?",
         ("By reported hail over the last " + str(n_yrs) + " years, the most active counties in " + name +
          " are " + ", ".join(r["county"] for r in rows[:3]) + "." if rows else
          name + " has recorded relatively few hail reports in the last " + str(n_yrs) + " years.") +
         " Reports track population and spotter coverage as well as storms, so rural corridors can be under-counted; the persistent leaders on this table are real hail geography."),
        ("When is hail season in " + name + "?",
         ("Reported hail in " + name + " peaks around " + peak_full + "," if peak_full else
          "Hail in " + name + " follows the severe-thunderstorm season,") +
         " with most activity in the spring-through-midsummer window. Any single year can break the pattern."),
        ("How much of " + name + "'s hail is damaging?",
         "On this page, damaging means reported stones of " + str(dmg_in) +
         "\u2033 or larger \u2014 the size that reliably dents roofs and vehicles and strips crops. The per-county damaging share is in the table; statewide, hail of any size totaled " +
         f"{total:,}" + " reports over " + str(n_yrs) + " years."),
    ]
    faq_ld = ",".join(
        '{"@type":"Question","name":' + json.dumps(q) + ',"acceptedAnswer":{"@type":"Answer","text":' + json.dumps(a) + '}}'
        for q, a in faq)
    faq_vis = "".join(
        "<details" + (" open" if i == 0 else "") + "><summary>" + esc(q) + "</summary><p>" + a + "</p></details>"
        for i, (q, a) in enumerate(faq))

    intro = (
        "<p class=\"hs-sub\">" +
        (("Hail is a fact of life on " + name + " ground \u2014 " + f"{total:,}" +
          " National Weather Service hail reports in the last " + str(n_yrs) + " years, led by " +
          esc(top["county"]) + " County" + (", peaking around " + peak_full if peak_full else "") + ".")
         if heavy and top else
         (name + " logged " + f"{total:,}" + " National Weather Service hail reports over the last " +
          str(n_yrs) + " years \u2014 " + ("meaningful but not hail-alley volume." if total >= 60 else
          "a comparatively quiet record by national standards."))) +
        " The table below ranks the counties; the interactive national map shows exactly where, year by year. Checking a specific address? The map\u2019s search box pulls every dated report within 25 miles.</p>")

    # Key Figures — complete standalone sentences, because that is what
    # writers and AI engines lift verbatim (see: insurance lead-gen pages
    # already quoting this site). Each fact is quotable without editing.
    dmg_reports = sum(round(r.get("total", 0) * r.get("dmg_pct", 0) / 100) for r in rows)
    figs = [name + " logged " + f"{total:,}" + " National Weather Service hail reports statewide over the last " + str(n_yrs) + " years (" + str(years[0]) + "\u2013" + str(years[-1]) + ")."]
    if top:
        figs.append(esc(top["county"]) + " County leads " + name + " with " + f"{top.get('total',0):,}" + " hail reports over that span \u2014 about " + str(top.get("avg", "")) + " per year.")
    if peak_full:
        figs.append("Reported hail in " + name + " peaks in " + peak_full + ".")
    if total:
        figs.append("Roughly " + f"{dmg_reports:,}" + " of " + name + "'s reports involved stones " + str(dmg_in) + "\u2033 or larger \u2014 the size that damages roofs, vehicles, and crops.")
    key_figs = ("<section class=\"hs-figs\" id=\"key-figures\"><h2>Key figures \u2014 " + esc(name) + " hail at a glance</h2><ul>"
        + "".join("<li>" + f + "</li>" for f in figs) + "</ul>"
        "<p class=\"hs-cite\">Citing these figures? Attribution: <em>AGSIST National Hail Map, "
        + canonical + " (NWS Local Storm Reports, " + str(years[0]) + "\u2013" + str(years[-1]) + ")</em>. "
        "Data is available at no charge; a link back keeps it that way.</p></section>\n")

    b2b = ("<p class=\"hs-pro\">Insurance, roofing, or ag professional using this data in client-facing work? "
        "The same dataset is available as a licensable embeddable widget \u2014 "
        "<a href=\"/sponsor\">details on the sponsor page</a> or email "
        "<a href=\"mailto:sig@farmers1st.com\">sig@farmers1st.com</a>.</p>\n")

    dataset_ld = ("{\"@type\":\"Dataset\",\"name\":\"" + esc(name) + " hail reports by county\","
        "\"description\":\"" + str(n_yrs) + " years of National Weather Service hail Local Storm Reports for " + esc(name) + ", aggregated by county with peak months and damaging-hail share.\","
        "\"url\":\"" + canonical + "\",\"temporalCoverage\":\"" + str(years[0]) + "/" + str(years[-1]) + "\","
        "\"spatialCoverage\":\"" + esc(name) + ", United States\","
        "\"isBasedOn\":\"NWS Local Storm Reports via Iowa Environmental Mesonet\","
        "\"creator\":{\"@type\":\"Person\",\"name\":\"Sigurd Lindquist\"},"
        "\"isAccessibleForFree\":true},")

    return ("<!DOCTYPE html>\n<html lang=\"en\" data-theme=\"dark\">\n<head>\n"
        "<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        "<title>Hail Map " + esc(name) + " \u2014 Worst Hail Counties &amp; Hail Season | AGSIST</title>\n"
        "<meta name=\"description\" content=\"Where it hails in " + esc(name) + ": " + str(n_yrs) + " years of NWS hail reports ranked by county, peak months, and damaging-hail share \u2014 with an interactive map and address lookup. No charge, no login.\">\n"
        "<link rel=\"canonical\" href=\"" + canonical + "\">\n"
        "<meta property=\"og:title\" content=\"Hail Map " + esc(name) + " \u2014 Worst Hail Counties | AGSIST\">\n"
        "<meta property=\"og:description\" content=\"" + str(n_yrs) + " years of hail reports across " + esc(name) + ", county by county.\">\n"
        "<meta property=\"og:url\" content=\"" + canonical + "\">\n"
        "<meta property=\"og:type\" content=\"website\">\n"
        "<meta property=\"og:image\" content=\"https://agsist.com/img/og/hail-map.jpg\">\n"
        "<link rel=\"icon\" type=\"image/x-icon\" href=\"/img/favicon.ico\">\n"
        "<link rel=\"icon\" type=\"image/png\" sizes=\"32x32\" href=\"/img/favicon-32.png\">\n"
        "<link rel=\"apple-touch-icon\" href=\"/img/apple-touch-icon.png\">\n"
        "<link rel=\"stylesheet\" href=\"/components/styles.css\">\n"
        "<script type=\"application/ld+json\">{\"@context\":\"https://schema.org\",\"@graph\":["
        "{\"@type\":\"WebPage\",\"@id\":\"" + canonical + "#webpage\",\"url\":\"" + canonical + "\","
        "\"name\":\"Hail Map " + esc(name) + " \u2014 Worst Hail Counties\",\"dateModified\":\"" + today + "\","
        "\"isPartOf\":{\"@id\":\"https://agsist.com/#website\"},"
        "\"breadcrumb\":{\"@type\":\"BreadcrumbList\",\"itemListElement\":["
        "{\"@type\":\"ListItem\",\"position\":1,\"name\":\"Home\",\"item\":\"https://agsist.com/\"},"
        "{\"@type\":\"ListItem\",\"position\":2,\"name\":\"Hail Map\",\"item\":\"https://agsist.com/hail-map\"},"
        "{\"@type\":\"ListItem\",\"position\":3,\"name\":" + json.dumps(name) + ",\"item\":\"" + canonical + "\"}]}},"
        
        + dataset_ld +
        "{\"@type\":\"FAQPage\",\"mainEntity\":[" + faq_ld + "]}]}"
        "</script>\n<style>\n"
        ".hs-wrap{max-width:900px;margin:0 auto;padding:1.2rem .9rem 3rem}\n"
        ".hs-bc{font-family:'JetBrains Mono',monospace;font-size:.72rem;color:var(--text-dim,#8a948f);margin-bottom:1rem}\n"
        ".hs-bc a{color:var(--text-dim,#8a948f)}\n"
        "h1{font-size:clamp(1.5rem,4vw,2.1rem);margin:.2rem 0 .6rem}\n"
        ".hs-sub{color:var(--text,#e6ebe9);line-height:1.7;max-width:70ch}\n"
        ".hs-cta{display:inline-flex;align-items:center;gap:.4rem;margin:.9rem 0 1.4rem;padding:.6rem 1rem;border:1px solid var(--brand,#d4a23f);border-radius:8px;color:var(--brand,#d4a23f);font-family:'JetBrains Mono',monospace;font-weight:700;font-size:.8rem;text-decoration:none}\n"
        "table{width:100%;border-collapse:collapse;font-size:.88rem;margin:.4rem 0 1.4rem}\n"
        "th,td{border-bottom:1px solid var(--border,rgba(132,160,168,.12));padding:.5rem .55rem;text-align:left}\n"
        "th{font-family:'JetBrains Mono',monospace;font-size:.66rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim,#8a948f)}\n"
        "td.num,th.num{text-align:right;font-family:'JetBrains Mono',monospace}\n"
        "details{border-top:1px solid var(--border,rgba(132,160,168,.12));padding:.7rem 0}\n"
        "summary{cursor:pointer;font-weight:600}\n"
        "details p{color:var(--text,#e6ebe9);line-height:1.7;font-size:.92rem}\n"
        ".hs-states{margin:1.6rem 0 0}.hs-states h2{font-size:1rem}.hs-states p{line-height:2;font-size:.8rem}.hs-states a{color:var(--text-dim,#9aa39e);text-decoration:none;margin-right:.65rem;white-space:nowrap}.hs-states a:hover{color:var(--brand,#d4a23f)}\n"
        ".hs-src{font-family:'JetBrains Mono',monospace;font-size:.7rem;color:var(--text-dim,#8a948f);margin-top:1.2rem;line-height:1.7}\n"
        ".hs-figs{border:1px solid var(--border,rgba(132,160,168,.12));padding:1rem 1.1rem;margin:1.4rem 0}.hs-figs h2{margin:0 0 .5rem;font-size:1rem}.hs-figs ul{margin:.3rem 0 .7rem;padding-left:1.1rem}.hs-figs li{line-height:1.75;margin:.25rem 0}\n"
        ".hs-cite{font-family:'JetBrains Mono',monospace;font-size:.68rem;color:var(--text-dim,#8a948f);line-height:1.7;margin:0}\n"
        ".hs-pro{font-size:.85rem;color:var(--text-dim,#8a948f);line-height:1.7;margin-top:1.2rem}.hs-pro a{color:var(--brand,#d4a23f)}\n"
        "</style>\n</head>\n<body>\n<div id=\"site-header\"></div>\n<main id=\"main\">\n<div class=\"hs-wrap\">\n"
        "<nav class=\"hs-bc\" aria-label=\"Breadcrumb\"><a href=\"/\">AGSIST</a> \u203a <a href=\"/hail-map\">Hail Map</a> \u203a " + esc(name) + "</nav>\n"
        "<h1>Hail in " + esc(name) + " \u2014 where it hits, county by county</h1>\n"
        + intro +
        "\n<a class=\"hs-cta\" href=\"/hail-map?state=" + abbr + "\">Open the interactive map on " + esc(name) + " \u2192</a>\n"
        "<h2>Top hail counties in " + esc(name) + " (" + str(years[0]) + "\u2013" + str(years[-1]) + ")</h2>\n"
        "<table><thead><tr><th>County</th><th class=\"num\">Reports</th><th class=\"num\">Avg/yr</th><th>Peak month</th><th class=\"num\">% damaging (\u2265" + str(dmg_in) + "\u2033)</th></tr></thead>"
        "<tbody>" + (trs or '<tr><td colspan="5">Too few reports to rank counties.</td></tr>') + "</tbody></table>\n"
        + key_figs +
        "<h2>" + esc(name) + " hail \u2014 the questions people ask</h2>\n"
        + faq_vis +
        "\n<nav class=\"hs-states\" aria-label=\"Hail by state\"><h2>Hail in other states</h2><p>" + all_state_links(name) + "</p></nav>\n"
        + b2b +
        "\n<div class=\"hs-src\">Source: National Weather Service Local Storm Reports via the Iowa Environmental Mesonet, " + str(years[0]) + "\u2013" + str(years[-1]) + ". Reports depend on someone reporting \u2014 population and spotter density bias the counts; the persistent leaders are real hail geography. Compiled by Sigurd Lindquist \u00b7 AGSIST \u00b7 available at no charge.</div>\n"
        "</div>\n</main>\n<div id=\"site-footer\"></div>\n"
        "<script src=\"/components/loader.js\" defer></script>\n</body>\n</html>\n")


def main():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        d = json.load(open(SC))
    except Exception as e:
        print("FATAL: cannot read", SC, e)
        sys.exit(1)
    years = d.get("years", [])
    dmg_in = d.get("damaging_in", 1.5)
    states = d.get("states", {})
    os.makedirs(OUTDIR, exist_ok=True)
    made = []
    for abbr, name in STATE_NAME.items():
        rows = states.get(abbr) or []
        html = page_html(abbr, name, rows, years, dmg_in, today)
        path = os.path.join(OUTDIR, slug(name) + ".html")
        prev = open(path).read() if os.path.exists(path) else None
        if prev != html:
            open(path, "w", encoding="utf-8").write(html)
            made.append(slug(name))
    print(f"pages written/updated: {len(made)} of {len(STATE_NAME)}")

    # sitemap block between markers, fully regenerated
    try:
        sm = open(SITEMAP, encoding="utf-8").read()
    except FileNotFoundError:
        print("sitemap.xml missing — skipped")
        return
    block = MARK_A + "".join(
        "\n  <url><loc>https://agsist.com/hail-map/" + slug(n) + "</loc><lastmod>" + today +
        "</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>"
        for n in STATE_NAME.values()) + "\n  " + MARK_B
    if MARK_A in sm and MARK_B in sm:
        new = re.sub(re.escape(MARK_A) + r".*?" + re.escape(MARK_B), block, sm, flags=re.S)
    else:
        new = sm.replace("</urlset>", "  " + block + "\n</urlset>")
    if new != sm:
        open(SITEMAP, "w", encoding="utf-8").write(new)
        print("sitemap: state pages block updated")
    else:
        print("sitemap: no change")


if __name__ == "__main__":
    main()
