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
v1.2 - 2026-10-10 each page lists that state's storm days (data/hail/storm-days.json,
       written by generate_hail_events.py, which mesh.yml runs daily before this);
       Avg/yr is reports over the elapsed span of the record, not the file count.
`--selftest` runs hand-worked checks and exits.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone

SC = "data/hail/state-counties.json"
DAYS = "data/hail/storm-days.json"
DAYS_MAX = 24        # storm days listed per state page, newest first; the storm log has them all
OUTDIR = "hail-map"
SITEMAP = "sitemap.xml"
MARK_A = "<!-- HAIL-STATE-PAGES -->"
MARK_B = "<!-- /HAIL-STATE-PAGES -->"

STATE_NAME = {"AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California","CO":"Colorado","CT":"Connecticut","DE":"Delaware","DC":"District of Columbia","FL":"Florida","GA":"Georgia","HI":"Hawaii","ID":"Idaho","IL":"Illinois","IN":"Indiana","IA":"Iowa","KS":"Kansas","KY":"Kentucky","LA":"Louisiana","ME":"Maine","MD":"Maryland","MA":"Massachusetts","MI":"Michigan","MN":"Minnesota","MS":"Mississippi","MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada","NH":"New Hampshire","NJ":"New Jersey","NM":"New Mexico","NY":"New York","NC":"North Carolina","ND":"North Dakota","OH":"Ohio","OK":"Oklahoma","OR":"Oregon","PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina","SD":"South Dakota","TN":"Tennessee","TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia","WA":"Washington","WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming"}

MONTH_FULL = {"Jan":"January","Feb":"February","Mar":"March","Apr":"April","May":"May","Jun":"June","Jul":"July","Aug":"August","Sep":"September","Oct":"October","Nov":"November","Dec":"December"}


def inch(x):
    """1.0 -> "1", 1.5 -> "1.5": a threshold reads the way people say it."""
    x = float(x)
    return str(int(x)) if x == int(x) else ("%g" % x)


def size_line(dmg_in):
    """Severe means 1 inch, the NWS severe size, everywhere on the site. A
    state-counties.json built before the switch carries another threshold
    (1.5 until 2026-10); name that size plainly and never call it severe."""
    if float(dmg_in) == 1.0:
        return "1\u2033 or larger, the National Weather Service severe size"
    return inch(dmg_in) + "\u2033 or larger (the National Weather Service severe size is 1\u2033)"


def share_word(dmg_in):
    return "severe-hail share" if float(dmg_in) == 1.0 else "large-hail share"


def slug(name):
    return re.sub(r"[^a-z]+", "-", name.lower()).strip("-")


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def county_name(c):
    """Upstream sends some counties in capitals ("LINN") and some not ("Story"),
    so one table read "LINN, SCOTT, Story". Capitals are set in title case;
    a name that already has lower case, or carries a digit (marine zones), is
    left as sent."""
    c = str(c or "")
    if not c.isupper() or any(ch.isdigit() for ch in c):
        return c
    t = c.title()
    t = re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), t)
    return t


def all_state_links(current):
    return " ".join('<a href="/hail-map/' + slug(n) + '">' + esc(n) + "</a>"
                    for n in sorted(STATE_NAME.values()) if n != current)


def elapsed_years(years, end_iso):
    """Jan 1 of the first year to the pull date, in years (fetch_hail.elapsed_years,
    yrSpan() in hail-map.html). Five files pulled Oct 1 of the fifth year: 4.75."""
    try:
        start = datetime(int(years[0]), 1, 1, 12, tzinfo=timezone.utc)
        end = datetime.strptime(str(end_iso)[:10], "%Y-%m-%d").replace(hour=12, tzinfo=timezone.utc)
        y = (end - start).total_seconds() / (365.2425 * 86400)
        return y if y > 0.5 else max(1, len(years))
    except (ValueError, IndexError, TypeError):
        return max(1, len(years))


def state_storm_days(days, abbr):
    """[(date, reports in this state, max for the day, swath)] for every storm-day
    page with at least one report from this state, newest first."""
    out = []
    for x in days or []:
        n = (x.get("st") or {}).get(abbr, 0)
        if n:
            out.append((x["d"], n, x.get("max") or 0, bool(x.get("swath"))))
    return out


def storm_days_html(name, sdays):
    if not sdays:
        return ("<section class=\"hs-days\"><h2>Storm days in " + esc(name) + "</h2><p>None of the storm days in "
                "<a href=\"/hail/\">the storm log</a> carry a report from " + esc(name) + ".</p></section>\n")
    lis = "".join(
        "<li><a href=\"/hail/" + d + "\">" + esc(datetime.strptime(d, "%Y-%m-%d").strftime("%b ") + str(int(d[8:])) + ", " + d[:4])
        + "</a> <span>" + f"{n:,}" + " report" + ("" if n == 1 else "s") + " here</span></li>"
        for d, n, _mx, _sw in sdays[:DAYS_MAX])
    more = (" Showing the newest " + str(DAYS_MAX) + " of " + str(len(sdays)) + "." if len(sdays) > DAYS_MAX else "")
    return ("<section class=\"hs-days\" id=\"storm-days\"><h2>Storm days in " + esc(name) + "</h2>"
            "<p>Days in the storm log with at least one NWS hail report from " + esc(name) + ", newest first. Each page maps that day across the country. "
            "The storm log keeps only the big hail days nationwide, so this is not every day it hailed here." + more + "</p>"
            "<ul>" + lis + "</ul><p><a href=\"/hail/\">Every storm day in the storm log &rarr;</a></p></section>\n")


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
            if t2 > t1 and not (str(r.get("county", "")).isupper() and not str(m["county"]).isupper()):
                m["county"] = r.get("county", m["county"])
                m["peak"] = r.get("peak") or m.get("peak")
            m["total"] = T
            m["avg"] = round(T / max(1, n_yrs), 1)
        else:
            seen[k] = dict(r)
            out.append(seen[k])
    out.sort(key=lambda x: -(x.get("total", 0)))
    return out


MAP_PAGE = "hail-map.html"


def asset_url(path):
    """path with the ?v= that hail-map.html carries for it, so generated pages
    pick up a new stylesheet or loader the same day the top pages do."""
    try:
        with open(MAP_PAGE, encoding="utf-8") as f:
            m = re.search(re.escape(path) + r"\?v=(\d+)", f.read())
        return path + "?v=" + m.group(1) if m else path
    except OSError:
        return path


MONTH_ORDER = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def season_line(name, months):
    """The busiest months from the state's own 12 monthly counts: the fewest
    months that hold at least 60% of reports (at most four), in calendar order.
    None when there is nothing to say."""
    total = sum(months or [])
    if not total:
        return None
    order = sorted(range(12), key=lambda i: (-months[i], i))
    pick, got = [], 0
    for i in order:
        if months[i] <= 0 or len(pick) >= 4:
            break
        pick.append(i)
        got += months[i]
        if got >= 0.6 * total:
            break
    pick.sort()
    names = [MONTH_FULL[MONTH_ORDER[i]] for i in pick]
    contiguous = len(pick) > 2 and pick[-1] - pick[0] == len(pick) - 1
    if len(names) == 1:
        span_txt = names[0]
    elif contiguous:
        span_txt = names[0] + " through " + names[-1]
    elif len(names) == 2:
        span_txt = names[0] + " and " + names[1]
    else:
        span_txt = ", ".join(names[:-1]) + " and " + names[-1]
    verb = "holds" if len(names) == 1 else "hold"
    share = (f"{got:,} of the {total:,} reports" if total < 50 else str(round(100.0 * got / total)) + "% of reports")
    return span_txt + " " + verb + " " + share + " in " + name + "."


def page_html(abbr, name, rows, years, dmg_in, today, span=None, sdays=None, st_tot=None):
    n_yrs = len(years)
    span = span or n_yrs
    # The averages divide by the elapsed span (Jan 1 of the first year to the pull), so the
    # words say that span too: "the last 5 years" beside a 4.8-year divisor read as 357/5 = 74.5
    # (Pennington Co., SD, 2026-10-18 accuracy pass).
    per = (f"the {span:.1f} years since January {years[0]}" if years and abs(span - n_yrs) >= 0.05
           else f"the last {n_yrs} years")
    rows = merge_counties(rows, span)
    for r in rows:
        r["avg"] = round(r.get("total", 0) / span, 1)
        r["county"] = county_name(r.get("county", ""))
    top = rows[0] if rows else None
    months = (st_tot or {}).get("months") or []
    if st_tot and st_tot.get("total") and len(months) == 12:
        # True statewide figures (fetch_hail.py state_totals), every report.
        total = int(st_tot["total"])
        dmg_reports = int(st_tot.get("dmg", 0))
        where = " statewide"
        peak = MONTH_ORDER[max(range(12), key=lambda i: (months[i], -i))]
        season = season_line(name, months)
    else:
        # Older data file: only the ranked counties are known, so say so.
        total = sum(r.get("total", 0) for r in rows)
        dmg_reports = sum(round(r.get("total", 0) * r.get("dmg_pct", 0) / 100) for r in rows)
        where = (" in the " + str(len(rows)) + " counties with the most reports" if len(rows) >= 12 else "")
        # dominant peak month across the top counties, weighted by report count
        month_w = {}
        for r in rows:
            m = r.get("peak")
            if m and m in MONTH_FULL:
                month_w[m] = month_w.get(m, 0) + r.get("total", 0)
        peak = max(month_w, key=month_w.get) if month_w else None
        season = None
    peak_full = MONTH_FULL.get(peak, peak) if peak else None
    heavy = total >= 400
    canonical = "https://agsist.com/hail-map/" + slug(name)

    trs = "".join(
        '<tr><td>' + esc(r.get("county", "")) + '</td>'
        '<td class="num">' + str(r.get("total", 0)) + '</td>'
        '<td class="num">' + str(r.get("avg", "")) + '</td>'
        '<td>' + esc(r.get("peak", "") or "n/a") + '</td>'
        '<td class="num">' + str(r.get("dmg_pct", "")) + '%</td></tr>'
        for r in rows[:15])

    faq = [
        ("Where does it hail the most in " + name + "?",
         ("By reported hail over " + per + ", the most active counties in " + name +
          " are " + ", ".join(r["county"] for r in rows[:3]) + "." if rows else
          name + " has recorded relatively few hail reports in " + per + ".") +
         " Reports track population and spotter coverage as well as storms, so rural corridors can be under-counted; the persistent leaders on this table are real hail geography."),
        ("When is hail season in " + name + "?",
         ("Reported hail in " + name + " peaks around " + peak_full + ". " if peak_full else
          "Hail in " + name + " follows the severe-thunderstorm season. ") +
         (season + " " if season else "") + "Any single year can break the pattern."),
        ("How much of " + name + "'s hail is severe?",
         "Severe hail is 1\u2033 or larger, the National Weather Service severe size, which dents roofs and vehicles. Crops can be hurt by smaller hail, especially with wind, and the loss depends on growth stage. " +
         ("The per-county severe share is in the table" if float(dmg_in) == 1.0 else
          "The table\u2019s share column counts stones " + size_line(dmg_in)) +
         "; " + (where.strip() + ", " if where else "") + "hail of any size totaled " +
         f"{total:,}" + " reports over " + per + "."),
    ]
    faq_ld = ",".join(
        '{"@type":"Question","name":' + json.dumps(q) + ',"acceptedAnswer":{"@type":"Answer","text":' + json.dumps(a) + '}}'
        for q, a in faq)
    faq_vis = "".join(
        "<details" + (" open" if i == 0 else "") + "><summary>" + esc(q) + "</summary><p>" + a + "</p></details>"
        for i, (q, a) in enumerate(faq))

    intro = (
        "<p class=\"hs-sub\">" +
        ((name + " logged " + f"{total:,}" +
          " National Weather Service hail reports" + where + " in " + per + ". " +
          esc(top["county"]) + " County had the most" + (", and reports peak around " + peak_full if peak_full else "") + ".")
         if heavy and top else
         (name + " logged " + f"{total:,}" + " National Weather Service hail reports" + where + " over " +
          per + ", " + ("meaningful but not hail-alley volume." if total >= 60 else
          "a comparatively quiet record by national standards."))) +
        " The table ranks the counties. To check one address, use the map\u2019s search: it lists every dated report within 10 miles (5 or 25 if you pick).</p>")

    # Key Figures — complete standalone sentences, because that is what
    # writers and AI engines lift verbatim (see: insurance lead-gen pages
    # already quoting this site). Each fact is quotable without editing.
    figs = [name + " logged " + f"{total:,}" + " National Weather Service hail reports" + where + " over " + per + " (" + str(years[0]) + "\u2013" + str(years[-1]) + ")."]
    if top:
        figs.append(esc(top["county"]) + " County leads " + name + " with " + f"{top.get('total',0):,}" + " hail reports over that span, about " + str(top.get("avg", "")) + " per year.")
    if peak_full:
        figs.append("Reported hail in " + name + " peaks in " + peak_full + ".")
    if total:
        figs.append(("Roughly " if not st_tot else "") + f"{dmg_reports:,}" + " of " + name + "'s reports" + (where if not st_tot else "") + " involved stones " + size_line(dmg_in) + ".")
    key_figs = ("<section class=\"hs-figs\" id=\"key-figures\"><h2>Key figures: " + esc(name) + " hail at a glance</h2><ul>"
        + "".join("<li>" + f + "</li>" for f in figs) + "</ul>"
        "<p class=\"hs-cite\">To cite these figures: <em>AGSIST National Hail Map, "
        + canonical + " (NWS Local Storm Reports, " + str(years[0]) + "\u2013" + str(years[-1]) + ")</em>. "
        "A link back is appreciated.</p></section>\n")

    b2b = ("<p class=\"hs-pro\">Insurance, roofing and ag firms that use this data with clients can license it as an "
        "embeddable widget. See "
        "<a href=\"/sponsor\">details on the sponsor page</a> or email "
        "<a href=\"mailto:sig@farmers1st.com\">sig@farmers1st.com</a>.</p>\n")

    dataset_ld = ("{\"@type\":\"Dataset\",\"name\":\"" + esc(name) + " hail reports by county\","
        "\"description\":\"" + str(n_yrs) + " years of National Weather Service hail Local Storm Reports for " + esc(name) + ", aggregated by county with peak months and " + share_word(dmg_in) + ".\","
        "\"url\":\"" + canonical + "\",\"temporalCoverage\":\"" + str(years[0]) + "/" + str(years[-1]) + "\","
        "\"spatialCoverage\":\"" + esc(name) + ", United States\","
        "\"isBasedOn\":\"NWS Local Storm Reports via Iowa Environmental Mesonet\","
        "\"creator\":{\"@type\":\"Person\",\"name\":\"Sigurd Lindquist\"},"
        "\"isAccessibleForFree\":true},")

    return ("<!DOCTYPE html>\n<html lang=\"en\" data-theme=\"dark\">\n<head>\n"
        "<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        "<title>Hail Map " + esc(name) + ": Worst Hail Counties &amp; Hail Season | AGSIST</title>\n"
        "<meta name=\"description\" content=\"Where it hails in " + esc(name) + ": " + str(n_yrs) + " years of NWS hail reports ranked by county, peak months, and " + share_word(dmg_in) + ", with an interactive map and address lookup.\">\n"
        "<link rel=\"canonical\" href=\"" + canonical + "\">\n"
        "<meta property=\"og:title\" content=\"Hail Map " + esc(name) + ": Worst Hail Counties | AGSIST\">\n"
        "<meta property=\"og:description\" content=\"" + str(n_yrs) + " years of hail reports across " + esc(name) + ", county by county.\">\n"
        "<meta property=\"og:url\" content=\"" + canonical + "\">\n"
        "<meta property=\"og:type\" content=\"website\">\n"
        "<meta property=\"og:image\" content=\"https://agsist.com/img/og/hail-map.jpg\">\n"
        "<meta property=\"og:image:width\" content=\"1200\">\n<meta property=\"og:image:height\" content=\"630\">\n"
        "<meta property=\"og:image:alt\" content=\"AGSIST hail map: radar-detected hail swaths and ground reports\">\n"
        "<meta name=\"twitter:card\" content=\"summary_large_image\">\n"
        "<meta name=\"twitter:image\" content=\"https://agsist.com/img/og/hail-map.jpg\">\n"
        "<link rel=\"icon\" type=\"image/x-icon\" href=\"/img/favicon.ico\">\n"
        "<link rel=\"icon\" type=\"image/png\" sizes=\"32x32\" href=\"/img/favicon-32.png\">\n"
        "<link rel=\"apple-touch-icon\" href=\"/img/apple-touch-icon.png\">\n"
        "<link rel=\"stylesheet\" href=\"" + asset_url("/components/styles.css") + "\">\n"
        "<script type=\"application/ld+json\">{\"@context\":\"https://schema.org\",\"@graph\":["
        "{\"@type\":\"WebPage\",\"@id\":\"" + canonical + "#webpage\",\"url\":\"" + canonical + "\","
        "\"name\":\"Hail Map " + esc(name) + ": Worst Hail Counties\",\"dateModified\":\"" + today + "\","
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
        ".hs-tw{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:.4rem 0 .4rem}\n"
        ".hs-note{font-size:.8rem;color:var(--text-dim,#8a948f);line-height:1.6;margin:0 0 1.4rem}\n"
        "table{width:100%;border-collapse:collapse;font-size:.88rem}\n"
        "@media(max-width:480px){.hs-tw th,.hs-tw td{padding:.5rem .3rem}.hs-tw th{letter-spacing:.04em}}\n"
        "th,td{border-bottom:1px solid var(--border,rgba(132,160,168,.12));padding:.5rem .55rem;text-align:left}\n"
        "th{font-family:'JetBrains Mono',monospace;font-size:.66rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim,#8a948f)}\n"
        "td.num,th.num{text-align:right;font-family:'JetBrains Mono',monospace}\n"
        "details{border-top:1px solid var(--border,rgba(132,160,168,.12));padding:.7rem 0}\n"
        "summary{cursor:pointer;font-weight:600}\n"
        "details p{color:var(--text,#e6ebe9);line-height:1.7;font-size:.92rem}\n"
        ".hs-states{margin:1.6rem 0 0}.hs-states h2{font-size:1rem}.hs-states-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:0 .8rem;font-size:.85rem}.hs-states a{color:var(--text-dim,#9aa39e);text-decoration:none;display:flex;align-items:center;min-height:40px}.hs-states a:hover{color:var(--brand,#d4a23f)}\n"
        ".hs-src{font-family:'JetBrains Mono',monospace;font-size:.7rem;color:var(--text-dim,#8a948f);margin-top:1.2rem;line-height:1.7}\n"
        ".hs-figs{border:1px solid var(--border,rgba(132,160,168,.12));padding:1rem 1.1rem;margin:1.4rem 0}.hs-figs h2{margin:0 0 .5rem;font-size:1rem}.hs-figs ul{margin:.3rem 0 .7rem;padding-left:1.1rem}.hs-figs li{line-height:1.75;margin:.25rem 0}\n"
        ".hs-cite{font-family:'JetBrains Mono',monospace;font-size:.68rem;color:var(--text-dim,#8a948f);line-height:1.7;margin:0}\n"
        ".hs-days ul{list-style:none;margin:.4rem 0 .6rem;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.1rem .9rem}.hs-days li{font-size:.88rem}.hs-days li a{display:inline-block;min-height:40px;line-height:40px}.hs-days a{color:var(--brand,#d4a23f);text-decoration:none}.hs-days li span{color:var(--text-dim,#8a948f);font-size:.8rem}.hs-days p{line-height:1.7;font-size:.9rem}\n"
        ".hs-pro{font-size:.85rem;color:var(--text-dim,#8a948f);line-height:1.7;margin-top:1.2rem}.hs-pro a{color:var(--brand,#d4a23f)}\n"
        "</style>\n</head>\n<body>\n<div id=\"site-header\"></div>\n<main id=\"main\">\n<div class=\"hs-wrap\">\n"
        "<nav class=\"hs-bc\" aria-label=\"Breadcrumb\"><a href=\"/\">AGSIST</a> \u203a <a href=\"/hail-map\">Hail Map</a> \u203a " + esc(name) + "</nav>\n"
        "<h1>Hail in " + esc(name) + ": where it hits, county by county</h1>\n"
        + intro +
        "\n<a class=\"hs-cta\" href=\"/hail-map?state=" + abbr + "\">Open the interactive map on " + esc(name) + " \u2192</a>\n"
        "<h2>Top hail counties in " + esc(name) + " (" + str(years[0]) + "\u2013" + str(years[-1]) + ")</h2>\n"
        "<div class=\"hs-tw\"><table><thead><tr><th>County</th><th class=\"num\">Reports</th><th class=\"num\">Avg/yr</th><th>Peak</th><th class=\"num\">% \u2265" + inch(dmg_in) + "\u2033</th></tr></thead>"
        "<tbody>" + (trs or '<tr><td colspan="5">Too few reports to rank counties.</td></tr>') + "</tbody></table></div>\n"
        "<p class=\"hs-note\">Peak is the county's month with the most reports. % \u2265" + inch(dmg_in) + "\u2033 is the share of its reports with stones " + size_line(dmg_in) + ". Crops can be hurt by smaller hail; the loss depends on growth stage.</p>\n"
        + key_figs
        + storm_days_html(name, sdays) +
        "<h2>" + esc(name) + " hail: the questions people ask</h2>\n"
        + faq_vis +
        "\n<nav class=\"hs-states\" aria-label=\"Hail by state\"><h2>Hail in other states</h2><div class=\"hs-states-grid\">" + all_state_links(name) + "</div></nav>\n"
        + b2b +
        "\n<div class=\"hs-src\">Source: National Weather Service Local Storm Reports via the Iowa Environmental Mesonet, " + str(years[0]) + "\u2013" + str(years[-1]) + ". Reports depend on someone reporting, so population and spotter density bias the counts. Compiled by Sigurd Lindquist \u00b7 AGSIST.</div>\n"
        # one quiet promo line, filled by components/rain-print-promo.js; empty and hidden when off
        "<p class=\"rp-promo\" data-rain-print-promo=\"gauge\" hidden></p><script src=\"/components/rain-print-promo.js?v=2\" defer></script>\n"
        "</div>\n</main>\n<div id=\"site-footer\"></div>\n"
        "<script src=\"" + asset_url("/components/loader.js") + "\" defer></script>\n</body>\n</html>\n")


def main():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        d = json.load(open(SC))
    except Exception as e:
        print("FATAL: cannot read", SC, e)
        sys.exit(1)
    years = d.get("years", [])
    dmg_in = d.get("damaging_in", 1.5)
    span = elapsed_years(years, d.get("generated")) if years else 1
    try:
        days = json.load(open(DAYS)).get("days", [])
    except Exception as e:
        print("storm-days.json unreadable, state pages list no storm days:", e)
        days = []
    states = d.get("states", {})
    os.makedirs(OUTDIR, exist_ok=True)
    # LASTMOD MOVES ONLY WITH CONTENT. Every page carries a build date, so a
    # plain "did the file change" test rewrote all 51 pages and stamped them all
    # with today every month, data or no data. Render each page again with the
    # date it last carried: if that equals the file on disk, nothing a reader
    # sees has changed, so the file and its sitemap date are left alone.
    try:
        _sm = open(SITEMAP, encoding="utf-8").read()
    except FileNotFoundError:
        _sm = ""
    prev_mod = dict(re.findall(r"<loc>https://agsist\.com/hail-map/([a-z-]+)</loc><lastmod>([0-9-]+)</lastmod>", _sm))
    lastmod = {}
    made = []
    for abbr, name in STATE_NAME.items():
        rows = states.get(abbr) or []
        path = os.path.join(OUTDIR, slug(name) + ".html")
        prev = open(path).read() if os.path.exists(path) else None
        old = prev_mod.get(slug(name))
        sd = state_storm_days(days, abbr)
        tot = (d.get("state_totals") or {}).get(abbr)
        if prev is not None and old and page_html(abbr, name, rows, years, dmg_in, old, span, sd, tot) == prev:
            lastmod[slug(name)] = old
            continue
        html = page_html(abbr, name, rows, years, dmg_in, today, span, sd, tot)
        lastmod[slug(name)] = today
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
        "\n  <url><loc>https://agsist.com/hail-map/" + slug(n) + "</loc><lastmod>" + lastmod.get(slug(n), today) +
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


def selftest():
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
    ok(abs(elapsed_years([2022, 2023, 2024, 2025, 2026], "2026-10-01") - 4.7475) < 0.001, "span 2022..2026-10-01")
    ok(elapsed_years([2026], "2026-02-01") == 1, "short span falls back to file count")
    days = [{"d": "2026-06-02", "n": 300, "max": 2.5, "swath": True, "st": {"KS": 40, "NE": 2}},
            {"d": "2026-06-01", "n": 6, "max": 2.0, "swath": False, "st": {"NE": 6}}]
    ok(state_storm_days(days, "NE") == [("2026-06-02", 2, 2.5, True), ("2026-06-01", 6, 2.0, False)], "NE days")
    ok(state_storm_days(days, "IA") == [], "no IA days")
    h = storm_days_html("Nebraska", state_storm_days(days, "NE"))
    ok('href="/hail/2026-06-02"' in h and "2 reports here" in h and "6 reports here" in h, "days html: " + h)
    ok('href="/hail/"' in storm_days_html("Iowa", []), "empty state still links the log")
    rows = [{"county": "Dane", "total": 190, "avg": 38.0, "peak": "Apr", "dmg_pct": 39}]
    html = page_html("WI", "Wisconsin", rows, [2022, 2023, 2024, 2025, 2026], 1.0, "2026-10-10", 4.75, [])
    ok('<td class="num">40.0</td>' in html, "avg = 190 / 4.75 = 40.0")
    ok("1\u2033 or larger, the National Weather Service severe size" in html and "1.0\u2033" not in html, "1 inch is the NWS severe size, printed as 1")
    h15 = page_html("WI", "Wisconsin", rows, [2022, 2023, 2024, 2025, 2026], 1.5, "2026-10-10", 4.75, [])
    ok("1.5\u2033 or larger, the National Weather Service severe size" not in h15 and "severe-hail share" not in h15, "1.5 inches is never called severe")
    ks = {"total": 4469, "dmg": 3410, "months": [3, 7, 267, 1065, 1092, 790, 497, 317, 319, 101, 4, 7]}
    ok(season_line("Kansas", ks["months"]) == "April through June hold 66% of reports in Kansas.", season_line("Kansas", ks["months"]))
    ok(season_line("Hawaii", [0, 1, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0]) == "March holds 5 of the 6 reports in Hawaii.", "HI season")
    hk = page_html("KS", "Kansas", rows * 12, [2022, 2023, 2024, 2025, 2026], 1.0, "2026-10-10", 4.75, [], ks)
    ok("4,469 National Weather Service hail reports statewide" in hk and "3,410 of Kansas's reports" in hk, "statewide totals come from state_totals")
    ok("spring-through-midsummer" not in hk and "peaks around May" in hk, "season from the state's own months")
    r12 = [{"county": "C%d" % i, "total": 100 - i, "avg": 1.0, "peak": "May", "dmg_pct": 50} for i in range(12)]
    h12 = page_html("KS", "Kansas", r12, [2022, 2023, 2024, 2025, 2026], 1.0, "2026-10-10", 4.75, [])
    ok("statewide" not in h12 and "in the 12 counties with the most reports" in h12, "no statewide claim from a top-12 subtotal")
    if fails:
        print("SELFTEST FAILED:\n  " + "\n  ".join(fails))
        sys.exit(1)
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        main()
