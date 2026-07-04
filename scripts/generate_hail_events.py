#!/usr/bin/env python3
"""
generate_hail_events.py — one static page per significant hail day, plus a
storm-log hub, plus their sitemap block. The morning-after query surface:
"hail june 11 2026", "where did it hail yesterday", "june 11 hail map".

A day qualifies if it has a MESH swath file (data/hail/mesh/DATE.json) OR at
least MIN_REPORTS dated reports in the events files. Pages are rebuilt only
when content changes; the daily mesh workflow runs this after new data lands,
so a storm's page exists by the next morning — when the searches happen.

Honesty rules carried over: radar sizes labeled estimated, report counts
labeled reported, no state named unless the data actually carries it.

v1 — 2026-07-04
"""

import json
import os
import re
import sys
from datetime import datetime, timezone

HAIL_DIR = "data/hail"
MESH_DIR = "data/hail/mesh"
OUT_DIR = "hail"
SITEMAP = "sitemap.xml"
MARK_A = "<!-- HAIL-EVENT-PAGES -->"
MARK_B = "<!-- /HAIL-EVENT-PAGES -->"
MIN_REPORTS = 150          # report-count threshold for days with no swath file

STATE_NAME = {"AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California","CO":"Colorado","CT":"Connecticut","DE":"Delaware","DC":"District of Columbia","FL":"Florida","GA":"Georgia","HI":"Hawaii","ID":"Idaho","IL":"Illinois","IN":"Indiana","IA":"Iowa","KS":"Kansas","KY":"Kentucky","LA":"Louisiana","ME":"Maine","MD":"Maryland","MA":"Massachusetts","MI":"Michigan","MN":"Minnesota","MS":"Mississippi","MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada","NH":"New Hampshire","NJ":"New Jersey","NM":"New Mexico","NY":"New York","NC":"North Carolina","ND":"North Dakota","OH":"Ohio","OK":"Oklahoma","OR":"Oregon","PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina","SD":"South Dakota","TN":"Tennessee","TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia","WA":"Washington","WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming"}


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def nice_date(d):
    return datetime.strptime(d, "%Y-%m-%d").strftime("%B %-d, %Y") \
        if sys.platform != "win32" else d


def load_day_index():
    """date -> {n, max, dmg (>=1.5in count), states Counter} from events files."""
    days = {}
    if not os.path.isdir(HAIL_DIR):
        return days
    for f in sorted(os.listdir(HAIL_DIR)):
        m = re.match(r"events-(\d{4})\.json$", f)
        if not m:
            continue
        year = m.group(1)
        try:
            d = json.load(open(os.path.join(HAIL_DIR, f)))
        except (OSError, ValueError):
            continue
        for e in d.get("ev", []):
            md = str(e[3]).replace("/", "-")
            date = year + "-" + md
            rec = days.setdefault(date, {"n": 0, "max": 0.0, "dmg": 0, "states": {}})
            rec["n"] += 1
            mag = e[2]
            if mag is not None:
                mag = float(mag)
                if mag > rec["max"]:
                    rec["max"] = mag
                if mag >= 1.5:
                    rec["dmg"] += 1
            st = e[4] if len(e) > 4 and e[4] else None
            if st:
                rec["states"][st] = rec["states"].get(st, 0) + 1
    return days


def mesh_dates():
    out = {}
    idx = os.path.join(MESH_DIR, "index.json")
    if os.path.exists(idx):
        try:
            d = json.load(open(idx))
            for i, dt in enumerate(d.get("dates", [])):
                mx = None
                mxs = d.get("max_in") or []
                if i < len(mxs):
                    mx = mxs[i]
                out[dt] = mx
        except (OSError, ValueError):
            pass
    return out


def page_html(date, rec, has_swath, mesh_max, today):
    nd = nice_date(date)
    canonical = "https://agsist.com/hail/" + date
    n = rec["n"] if rec else 0
    mx = rec["max"] if rec else 0
    dmg = rec["dmg"] if rec else 0
    states = sorted((rec["states"] if rec else {}).items(), key=lambda x: -x[1])[:6]
    st_line = ", ".join(
        (STATE_NAME.get(s, s) + " (" + str(c) + ")") for s, c in states) if states else None

    lead = ("<p class=\"he-sub\">" +
        (f"{n:,} National Weather Service hail reports were logged on {nd}"
         + (f", the largest a reported <strong>{mx:.2f}&Prime;</strong> stone" if mx else "")
         + (f", with {dmg} reports at damaging size (1.5&Prime; or larger)" if dmg else "")
         + "." if n else
         f"Radar estimated hail on {nd}, though few ground reports were phoned in — the swath map below is the record for this day.")
        + (f" Hardest-reported states: {esc(st_line)}." if st_line else "")
        + " Every number below is the public record — reported sizes from spotters and radar-estimated swaths from NOAA MRMS, labeled as what they are.</p>")

    swath_cta = (('<a class="he-cta" href="/hail-map?swath=' + date + '">Open the radar swath map for ' + esc(nd) + ' &rarr;</a>')
                 if has_swath else
                 '<p class="he-note">Radar swath archive begins after this date &mdash; the dated reports above are the record for this day.</p>')

    faq = [
        ("How big was the hail on " + nd + "?",
         (f"The largest reported stone on {nd} was {mx:.2f} inches" if mx else
          f"No measured sizes were reported on {nd}") +
         (f", among {n:,} reports nationwide" if n else "") +
         (". Radar (NOAA MRMS MESH) also estimated the swath footprint — an estimate, not a measurement." if has_swath else ".")),
        ("Did the " + nd + " hail hit my address?",
         "Use the hail map's address search: it lists every dated report within 25 miles of any US address and, for days in the radar archive, tests your exact point against the estimated swath — then prints a sourced report you can keep."),
    ]
    faq_ld = ",".join('{"@type":"Question","name":' + json.dumps(q) +
                      ',"acceptedAnswer":{"@type":"Answer","text":' + json.dumps(a) + '}}'
                      for q, a in faq)
    faq_vis = "".join("<details" + (" open" if i == 0 else "") + "><summary>" + esc(q) +
                      "</summary><p>" + esc(a) + "</p></details>" for i, (q, a) in enumerate(faq))

    return ("<!DOCTYPE html>\n<html lang=\"en\" data-theme=\"dark\">\n<head>\n"
        "<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        "<title>Hail on " + esc(nd) + " \u2014 Where It Hit, Sizes &amp; Swath Map | AGSIST</title>\n"
        "<meta name=\"description\" content=\"Hail " + esc(nd) + ": " +
        (f"{n:,} NWS reports, largest {mx:.2f} inch" if n else "radar-estimated swaths") +
        ". Check any address, see the swath map, print the record \u2014 no charge, no login.\">\n"
        "<link rel=\"canonical\" href=\"" + canonical + "\">\n"
        "<meta property=\"og:title\" content=\"Hail on " + esc(nd) + " \u2014 where it hit | AGSIST\">\n"
        "<meta property=\"og:url\" content=\"" + canonical + "\">\n"
        "<meta property=\"og:type\" content=\"article\">\n"
        "<meta property=\"og:image\" content=\"https://agsist.com/img/og/hail-map.jpg\">\n"
        "<link rel=\"icon\" type=\"image/x-icon\" href=\"/img/favicon.ico\">\n"
        "<link rel=\"stylesheet\" href=\"/components/styles.css\">\n"
        "<script type=\"application/ld+json\">{\"@context\":\"https://schema.org\",\"@graph\":["
        "{\"@type\":\"WebPage\",\"@id\":\"" + canonical + "#webpage\",\"url\":\"" + canonical + "\","
        "\"name\":\"Hail on " + esc(nd) + "\",\"datePublished\":\"" + date + "\",\"dateModified\":\"" + today + "\","
        "\"isPartOf\":{\"@id\":\"https://agsist.com/#website\"},"
        "\"breadcrumb\":{\"@type\":\"BreadcrumbList\",\"itemListElement\":["
        "{\"@type\":\"ListItem\",\"position\":1,\"name\":\"Home\",\"item\":\"https://agsist.com/\"},"
        "{\"@type\":\"ListItem\",\"position\":2,\"name\":\"Hail Map\",\"item\":\"https://agsist.com/hail-map\"},"
        "{\"@type\":\"ListItem\",\"position\":3,\"name\":\"Storm Log\",\"item\":\"https://agsist.com/hail/\"},"
        "{\"@type\":\"ListItem\",\"position\":4,\"name\":" + json.dumps(nd) + ",\"item\":\"" + canonical + "\"}]}},"
        "{\"@type\":\"FAQPage\",\"mainEntity\":[" + faq_ld + "]}]}"
        "</script>\n<style>\n"
        ".he-wrap{max-width:820px;margin:0 auto;padding:1.2rem .9rem 3rem}\n"
        ".he-bc{font-family:'JetBrains Mono',monospace;font-size:.72rem;color:var(--text-dim,#8a948f);margin-bottom:1rem}\n"
        ".he-bc a{color:var(--text-dim,#8a948f)}\n"
        "h1{font-size:clamp(1.4rem,4vw,2rem);margin:.2rem 0 .6rem}\n"
        ".he-sub{line-height:1.7;max-width:70ch}\n"
        ".he-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.6rem;margin:1rem 0}\n"
        ".he-stat{background:var(--surface,#101415);border:1px solid var(--border,rgba(132,160,168,.12));border-radius:10px;padding:.8rem .9rem}\n"
        ".he-stat .v{font-family:'JetBrains Mono',monospace;font-size:1.5rem;font-weight:700}\n"
        ".he-stat .l{font-family:'JetBrains Mono',monospace;font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim,#8a948f);margin-top:.2rem}\n"
        ".he-cta{display:inline-flex;margin:.6rem 0 1rem;padding:.65rem 1rem;border:1px solid var(--brand,#d4a23f);border-radius:8px;color:var(--brand,#d4a23f);font-family:'JetBrains Mono',monospace;font-weight:700;font-size:.8rem;text-decoration:none}\n"
        ".he-note{color:var(--text-dim,#8a948f);font-size:.85rem}\n"
        "details{border-top:1px solid var(--border,rgba(132,160,168,.12));padding:.7rem 0}summary{cursor:pointer;font-weight:600}details p{line-height:1.7;font-size:.92rem}\n"
        ".he-src{font-family:'JetBrains Mono',monospace;font-size:.7rem;color:var(--text-dim,#8a948f);margin-top:1.2rem;line-height:1.7}\n"
        "</style>\n</head>\n<body>\n<div id=\"site-header\"></div>\n<main id=\"main\">\n<div class=\"he-wrap\">\n"
        "<nav class=\"he-bc\" aria-label=\"Breadcrumb\"><a href=\"/\">AGSIST</a> \u203a <a href=\"/hail-map\">Hail Map</a> \u203a <a href=\"/hail/\">Storm Log</a> \u203a " + esc(nd) + "</nav>\n"
        "<h1>Hail on " + esc(nd) + " \u2014 where it hit</h1>\n"
        + lead +
        "<div class=\"he-stats\">"
        "<div class=\"he-stat\"><div class=\"v\">" + (f"{n:,}" if n else "\u2014") + "</div><div class=\"l\">NWS reports</div></div>"
        "<div class=\"he-stat\"><div class=\"v\">" + (f"{mx:.2f}\u2033" if mx else "\u2014") + "</div><div class=\"l\">largest reported</div></div>"
        "<div class=\"he-stat\"><div class=\"v\">" + (str(dmg) if dmg else "0") + "</div><div class=\"l\">reports \u22651.5\u2033</div></div>"
        + ("<div class=\"he-stat\"><div class=\"v\">" + (f"{mesh_max:.2f}\u2033" if mesh_max else "\u2713") + "</div><div class=\"l\">radar-estimated max</div></div>" if has_swath else "")
        + "</div>\n"
        + swath_cta +
        "\n<p><a href=\"/hail-map\" style=\"color:var(--brand,#d4a23f)\">Check any address against this storm on the hail map &rarr;</a></p>\n"
        "<h2>Questions about the " + esc(nd) + " hail</h2>\n" + faq_vis +
        "\n<div class=\"he-src\">Sources: NWS Local Storm Reports via the Iowa Environmental Mesonet (reported sizes); NOAA MRMS MESH via Iowa State (radar-estimated swaths). Reported and estimated are different things and are labeled throughout. Compiled by Sigurd Lindquist \u00b7 AGSIST \u00b7 no charge, no login.</div>\n"
        "</div>\n</main>\n<div id=\"site-footer\"></div>\n<script src=\"/components/loader.js\" defer></script>\n</body>\n</html>\n")


def hub_html(dates_meta, today):
    rows = "".join(
        "<tr><td><a href=\"/hail/" + d + "\">" + esc(nice_date(d)) + "</a></td>"
        "<td class=\"num\">" + (f"{m['n']:,}" if m and m.get("n") else "\u2014") + "</td>"
        "<td class=\"num\">" + (f"{m['max']:.2f}\u2033" if m and m.get("max") else "\u2014") + "</td>"
        "<td>" + ("swath map" if m.get("swath") else "reports") + "</td></tr>"
        for d, m in dates_meta)
    return ("<!DOCTYPE html>\n<html lang=\"en\" data-theme=\"dark\">\n<head>\n"
        "<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        "<title>US Hail Storm Log \u2014 Every Significant Hail Day, Mapped | AGSIST</title>\n"
        "<meta name=\"description\" content=\"A running log of every significant US hail day: report counts, largest stones, and radar swath maps \u2014 one page per storm, no charge, no login.\">\n"
        "<link rel=\"canonical\" href=\"https://agsist.com/hail/\">\n"
        "<meta property=\"og:image\" content=\"https://agsist.com/img/og/hail-map.jpg\">\n"
        "<link rel=\"icon\" type=\"image/x-icon\" href=\"/img/favicon.ico\">\n"
        "<link rel=\"stylesheet\" href=\"/components/styles.css\">\n"
        "<script type=\"application/ld+json\">{\"@context\":\"https://schema.org\",\"@type\":\"CollectionPage\","
        "\"name\":\"US Hail Storm Log\",\"url\":\"https://agsist.com/hail/\",\"dateModified\":\"" + today + "\"}"
        "</script>\n<style>.he-wrap{max-width:820px;margin:0 auto;padding:1.2rem .9rem 3rem}"
        "h1{font-size:clamp(1.4rem,4vw,2rem)}table{width:100%;border-collapse:collapse;font-size:.9rem;margin-top:1rem}"
        "th,td{border-bottom:1px solid var(--border,rgba(132,160,168,.12));padding:.5rem .55rem;text-align:left}"
        "th{font-family:'JetBrains Mono',monospace;font-size:.66rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim,#8a948f)}"
        "td.num,th.num{text-align:right;font-family:'JetBrains Mono',monospace}"
        "td a{color:var(--brand,#d4a23f);text-decoration:none}</style>\n</head>\n<body>\n"
        "<div id=\"site-header\"></div>\n<main id=\"main\">\n<div class=\"he-wrap\">\n"
        "<h1>US Hail Storm Log</h1>\n"
        "<p>Every significant hail day on record here \u2014 one page per storm with report counts, largest stones, and the radar swath map. Newest first. Checking a specific address? <a href=\"/hail-map\" style=\"color:var(--brand,#d4a23f)\">The hail map's search</a> pulls its full history in one tap.</p>\n"
        "<table><thead><tr><th>Storm day</th><th class=\"num\">Reports</th><th class=\"num\">Largest</th><th>Record</th></tr></thead><tbody>"
        + rows + "</tbody></table>\n"
        "</div>\n</main>\n<div id=\"site-footer\"></div>\n<script src=\"/components/loader.js\" defer></script>\n</body>\n</html>\n")


def main():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    day_idx = load_day_index()
    mdates = mesh_dates()
    qualifying = sorted(set(list(mdates.keys()) +
                            [d for d, r in day_idx.items() if r["n"] >= MIN_REPORTS]),
                        reverse=True)
    if not qualifying:
        print("no qualifying storm days — nothing to do")
        return
    os.makedirs(OUT_DIR, exist_ok=True)
    made = 0
    meta = []
    for d in qualifying:
        rec = day_idx.get(d)
        has_swath = d in mdates
        html = page_html(d, rec, has_swath, mdates.get(d), today)
        meta.append((d, {"n": rec["n"] if rec else 0,
                         "max": rec["max"] if rec else 0, "swath": has_swath}))
        path = os.path.join(OUT_DIR, d + ".html")
        prev = open(path).read() if os.path.exists(path) else None
        if prev != html:
            open(path, "w", encoding="utf-8").write(html)
            made += 1
    hub = hub_html(meta, today)
    hp = os.path.join(OUT_DIR, "index.html")
    if not os.path.exists(hp) or open(hp).read() != hub:
        open(hp, "w", encoding="utf-8").write(hub)
    print(f"storm pages: {made} written/updated of {len(qualifying)} qualifying days · hub updated")

    # sitemap block
    try:
        sm = open(SITEMAP, encoding="utf-8").read()
    except FileNotFoundError:
        print("sitemap.xml missing — skipped")
        return
    block = (MARK_A + "\n  <url><loc>https://agsist.com/hail/</loc><lastmod>" + today +
             "</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>" +
             "".join("\n  <url><loc>https://agsist.com/hail/" + d +
                     "</loc><lastmod>" + max(d, today if i == 0 else d) +
                     "</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>"
                     for i, d in enumerate(qualifying)) + "\n  " + MARK_B)
    if MARK_A in sm and MARK_B in sm:
        new = re.sub(re.escape(MARK_A) + r".*?" + re.escape(MARK_B), block, sm, flags=re.S)
    else:
        new = sm.replace("</urlset>", "  " + block + "\n</urlset>")
    if new != sm:
        open(SITEMAP, "w", encoding="utf-8").write(new)
        print(f"sitemap: {len(qualifying)+1} storm-log URLs")


if __name__ == "__main__":
    main()
