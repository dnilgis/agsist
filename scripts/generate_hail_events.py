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
v2 — 2026-10-06  The day's figures are baked into the static HTML (these pages
  have no client-side hail rendering; loader.js only adds header/footer):
  report count, top-5 largest measured stones, top-10 counties and states, a
  summary sentence, and a "how these figures are built" block. County is
  assigned by point-in-polygon of the report's coordinates against
  data/atlas/counties.geo.json (the archived events carry no county, town or
  time). Days with fewer than THIN_REPORTS reports get noindex,follow and are
  left out of the sitemap block, but stay linked from the hub.
  Days on or after the yearly events vintage (manifest "generated") are read
  from recent.json, the daily 30-day layer, so the newest pages do not claim
  zero reports for days the monthly events file has not reached yet.
  `--selftest` runs hand-worked checks and exits.
"""

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

HAIL_DIR = "data/hail"
MESH_DIR = "data/hail/mesh"
OUT_DIR = "hail"
SITEMAP = "sitemap.xml"
COUNTY_GEO = "data/atlas/counties.geo.json"
MARK_A = "<!-- HAIL-EVENT-PAGES -->"
MARK_B = "<!-- /HAIL-EVENT-PAGES -->"
MIN_REPORTS = 150          # report-count threshold for days with no swath file
THIN_REPORTS = 25          # below this a day page is noindex,follow and not in the sitemap
TOP_STONES = 5
TOP_PLACES = 10

STATE_NAME = {"AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California","CO":"Colorado","CT":"Connecticut","DE":"Delaware","DC":"District of Columbia","FL":"Florida","GA":"Georgia","HI":"Hawaii","ID":"Idaho","IL":"Illinois","IN":"Indiana","IA":"Iowa","KS":"Kansas","KY":"Kentucky","LA":"Louisiana","ME":"Maine","MD":"Maryland","MA":"Massachusetts","MI":"Michigan","MN":"Minnesota","MS":"Mississippi","MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada","NH":"New Hampshire","NJ":"New Jersey","NM":"New Mexico","NY":"New York","NC":"North Carolina","ND":"North Dakota","OH":"Ohio","OK":"Oklahoma","OR":"Oregon","PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina","SD":"South Dakota","TN":"Tennessee","TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia","WA":"Washington","WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming"}


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def nice_date(d):
    return datetime.strptime(d, "%Y-%m-%d").strftime("%B %-d, %Y") \
        if sys.platform != "win32" else d


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


def _new_rec(src):
    return {"n": 0, "max": 0.0, "dmg": 0, "states": {}, "reports": [], "src": src}


def _add_report(rec, lat, lon, mag, st, city=None):
    rec["n"] += 1
    if mag is not None:
        mag = float(mag)
        if mag > rec["max"]:
            rec["max"] = mag
        if mag >= 1.5:
            rec["dmg"] += 1
    st = (st or "").strip().upper()[:2] or None
    if st:
        rec["states"][st] = rec["states"].get(st, 0) + 1
    rec["reports"].append({"lat": lat, "lon": lon, "mag": mag, "st": st,
                           "city": (city or "").strip() or None})


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def load_day_index():
    """date -> {n, max, dmg (>=1.5in count), states, reports, src}.

    Yearly events files (monthly vintage) are the base. Dates on or after that
    vintage (manifest "generated") and inside the recent.json window are taken
    from recent.json instead: the monthly file cannot hold those days in full,
    and the daily layer does. Either way one day reads ONE file."""
    days = {}
    if not os.path.isdir(HAIL_DIR):
        return days
    for f in sorted(os.listdir(HAIL_DIR)):
        m = re.match(r"events-(\d{4})\.json$", f)
        if not m:
            continue
        year = m.group(1)
        d = _read_json(os.path.join(HAIL_DIR, f))
        if not d:
            continue
        for e in d.get("ev", []):
            md = str(e[3]).replace("/", "-")
            date = year + "-" + md
            rec = days.setdefault(date, _new_rec("events-" + year + ".json"))
            st = e[4] if len(e) > 4 and e[4] else None
            _add_report(rec, e[0], e[1], e[2], st)

    man = _read_json(os.path.join(HAIL_DIR, "manifest.json")) or {}
    recent = _read_json(os.path.join(HAIL_DIR, "recent.json")) or {}
    vintage = man.get("generated")
    rgen, rdays = recent.get("generated"), recent.get("days")
    if vintage and rgen and rdays:
        try:
            rstart = (datetime.strptime(rgen, "%Y-%m-%d")
                      - timedelta(days=int(rdays))).strftime("%Y-%m-%d")
        except ValueError:
            rstart = None
        if rstart:
            lo = max(vintage, rstart)
            # every date in [lo, rgen] is now read from recent.json, even if empty
            dt = datetime.strptime(lo, "%Y-%m-%d")
            while dt.strftime("%Y-%m-%d") <= rgen:
                days[dt.strftime("%Y-%m-%d")] = _new_rec("recent.json")
                dt += timedelta(days=1)
            for r in recent.get("reports", []):
                date = r.get("date")
                if date and lo <= date <= rgen:
                    _add_report(days[date], r.get("lat"), r.get("lon"), r.get("mag"),
                                r.get("st"), r.get("city"))
            for date in list(days):
                if days[date]["src"] == "recent.json" and days[date]["n"] == 0:
                    del days[date]
    for rec in days.values():
        rec["vintage"] = rgen if rec["src"] == "recent.json" else vintage
    return days


# ---------------------------------------------------------------- counties
class CountyIndex:
    """Point-in-polygon against the Census cartographic county file the Atlas
    ships. 20m-resolution boundaries and report coordinates rounded to 0.01 deg
    (events files) mean a report within about a kilometre of a county line can
    land in the neighbour; a point is only accepted in a county of the state
    the report itself names."""

    def __init__(self, features):
        self.feats = []
        self.grid = {}
        for f in features:
            g = f.get("geometry") or {}
            polys = ([g["coordinates"]] if g.get("type") == "Polygon"
                     else g.get("coordinates", []) if g.get("type") == "MultiPolygon" else [])
            if not polys:
                continue
            xs = [p[0] for poly in polys for p in poly[0]]
            ys = [p[1] for poly in polys for p in poly[0]]
            bb = (min(xs), min(ys), max(xs), max(ys))
            pr = f.get("properties") or {}
            label = pr.get("name", "?") + " " + (pr.get("u") or "County")
            i = len(self.feats)
            self.feats.append((bb, polys, label, pr.get("st")))
            for gx in range(int(bb[0] // 1), int(bb[2] // 1) + 1):
                for gy in range(int(bb[1] // 1), int(bb[3] // 1) + 1):
                    self.grid.setdefault((gx, gy), []).append(i)

    @staticmethod
    def _in_ring(x, y, ring):
        inside = False
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i][0], ring[i][1]
            xj, yj = ring[j][0], ring[j][1]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
        return inside

    def lookup(self, lat, lon, st=None):
        if lat is None or lon is None:
            return None
        x, y = float(lon), float(lat)
        for i in self.grid.get((int(x // 1), int(y // 1)), []):
            bb, polys, label, fst = self.feats[i]
            if st and fst != st:
                continue
            if not (bb[0] <= x <= bb[2] and bb[1] <= y <= bb[3]):
                continue
            for poly in polys:
                if self._in_ring(x, y, poly[0]) and not any(
                        self._in_ring(x, y, h) for h in poly[1:]):
                    return label
        return None


def load_counties():
    d = _read_json(COUNTY_GEO)
    return CountyIndex(d.get("features", [])) if d else None


# ---------------------------------------------------------------- figures
def state_name(s):
    return STATE_NAME.get(s, s) if s else None


def day_figures(rec, counties):
    """Every number a page prints, computed once here (pages only render)."""
    reps = rec["reports"] if rec else []
    for r in reps:
        if "county" not in r:
            r["county"] = counties.lookup(r["lat"], r["lon"], r["st"]) if counties else None
    measured = [r for r in reps if r["mag"] is not None]
    # deterministic order: size desc, then state, then north-to-south, west-to-east
    stones = sorted(measured, key=lambda r: (-r["mag"], r["st"] or "~",
                                             -(r["lat"] or 0), r["lon"] or 0))
    mx = stones[0]["mag"] if stones else 0.0
    at_max = [r for r in stones if r["mag"] == mx] if stones else []
    states = sorted((rec["states"] if rec else {}).items(), key=lambda x: (-x[1], x[0]))
    cty = {}
    for r in reps:
        if r["county"] and r["st"]:
            k = (r["county"], r["st"])
            c = cty.setdefault(k, {"n": 0, "max": None})
            c["n"] += 1
            if r["mag"] is not None and (c["max"] is None or r["mag"] > c["max"]):
                c["max"] = r["mag"]
    ctys = sorted(cty.items(), key=lambda x: (-x[1]["n"], x[0][1], x[0][0]))
    return {
        "n": len(reps), "measured": len(measured), "max": mx, "at_max": at_max,
        "dmg": sum(1 for r in measured if r["mag"] >= 1.5),
        "stones": stones[:TOP_STONES], "states": states, "n_states": len(states),
        "counties": ctys[:TOP_PLACES], "n_counties": len(ctys),
        "unmatched": sum(1 for r in reps if not r["county"]),
        "has_city": any(r["city"] for r in reps),
        "src": rec["src"] if rec else None, "vintage": rec.get("vintage") if rec else None,
    }


def _place(r):
    st = state_name(r["st"])
    if r["county"]:
        return r["county"] + (", " + st if st else "")
    return (st + " (county not matched)") if st else "location not matched"


def _list_and(xs):
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1]


def summary_sentence(nd, fig, mesh_max, has_swath):
    n = fig["n"]
    if not n:
        s = (f"No ground hail reports for {nd} are in the archived NWS Local Storm Reports"
             + ("; NOAA MRMS radar estimated hail up to " + f"{mesh_max:.2f}" + " inches that day"
                " (an estimate, not a measurement), so the swath map is the record for this day."
                if has_swath and mesh_max else
                "; the radar swath map is the record for this day." if has_swath else "."))
        return s
    k = fig["n_states"]
    s = (f"On {nd}, the archived NWS Local Storm Reports hold {n:,} hail report"
         + ("s" if n != 1 else "")
         + ((f" across {k} states" if k > 1 else " in " + state_name(fig["states"][0][0])) if k else ""))
    if fig["measured"]:
        am = fig["at_max"]
        if len(am) == 1:
            s += f"; the largest reported stone was {fig['max']:.2f} inches, in {_place(am[0])}"
        else:
            places = []
            for r in am:
                p = _place(r)
                if p not in places:
                    places.append(p)
            s += (f"; the largest reported size, {fig['max']:.2f} inches, was logged {len(am)} times"
                  + (" (" + "; ".join(places[:3]) + ("; and more" if len(places) > 3 else "") + ")"))
    else:
        s += "; none of them carries a measured size"
    if fig["states"]:
        top = fig["states"][0][1]
        tied = [state_name(st) for st, c in fig["states"] if c == top]
        if k > 1:
            if len(tied) == 1:
                s += f", and {tied[0]} logged the most reports ({top})"
            elif len(tied) <= 3:
                s += f", and {_list_and(tied)} tied for the most reports ({top} each)"
    return s + "."


def meta_description(nd, fig, mesh_max, has_swath):
    """120-160 chars from the day's real figures; longest candidate that fits."""
    n = fig["n"]
    if n:
        head = f"Hail on {nd}: {n:,} NWS report" + ("s" if n != 1 else "")
        cores = []
        big = ""
        if fig["measured"]:
            r0 = fig["at_max"][0]
            big = f", largest {fig['max']:.2f} inches" + (" in " + state_name(r0["st"]) if r0["st"] and len(
                {r["st"] for r in fig["at_max"]}) == 1 and fig["n_states"] > 1 else "")
        top = ""
        if fig["n_states"] > 1:
            st, c = fig["states"][0]
            if fig["states"][1][1] < c:
                top = f"; most in {state_name(st)} ({c})"
        k = fig["n_states"]
        across = (f" across {k} states" if k > 1 else " in " + state_name(fig["states"][0][0])) if k else ""
        for a in (across, ""):
            for t in (top, ""):
                cores.append(head + a + big + t + ".")
    else:
        cores = [f"Hail on {nd}: no ground reports archived; NOAA radar estimated hail"
                 + (f" up to {mesh_max:.2f} in." if mesh_max else ".")]
    tails = [" See the largest stones, top counties and the swath map. Free, no login.",
             " See the largest stones, top counties and the swath map.",
             " Largest stones, top counties, swath map. Free, no login.",
             " Top counties, sizes and swath map.",
             " Free, no login."] if n else [
             " See the estimated swath map and check any address. Free, no login.",
             " See the estimated swath map and check any address.",
             " See the swath map. Free, no login."]
    best = None
    for c in cores:
        for t in tails:
            s = c + t
            if 120 <= len(s) <= 160 and (best is None or len(s) > len(best)):
                best = s
        if best:
            return best
    return min((c + t for c in cores for t in tails), key=lambda s: abs(len(s) - 140))


def page_title(nd):
    return "Hail on " + nd + ": Reports, Sizes & Map | AGSIST"


def figures_html(nd, fig):
    if not fig["n"]:
        return ""
    out = []
    if fig["stones"]:
        city_col = fig["has_city"]
        rows = "".join(
            "<tr><td class=\"num\">" + f"{r['mag']:.2f}&Prime;" + "</td>"
            "<td>" + (esc(r["county"]) if r["county"] else "&mdash; <span class=\"he-dim\">not matched</span>") + "</td>"
            "<td>" + (esc(state_name(r["st"])) if r["st"] else "&mdash;") + "</td>"
            + ("<td>" + (esc(r["city"]) if r["city"] else "&mdash;") + "</td>" if city_col else "")
            + "<td class=\"num\">" + f"{r['lat']:.2f}, {r['lon']:.2f}" + "</td></tr>"
            for r in fig["stones"])
        tied = len(fig["at_max"])
        out.append(
            "<h2>Largest reported stones on " + esc(nd) + "</h2>\n"
            "<p>The " + str(len(fig["stones"])) + " largest of " + f"{fig['measured']:,}" +
            " report" + ("s" if fig["measured"] != 1 else "") + " with a measured size"
            + (f" ({fig['n'] - fig['measured']:,} more carried no size)" if fig["n"] > fig["measured"] else "")
            + ". " + (f"{tied} reports share the top size of {fig['max']:.2f} inches. " if tied > 1 else "")
            + "Report times are not kept in the archived file, so none are shown.</p>\n"
            "<div class=\"he-tw\"><table><thead><tr><th class=\"num\">Size</th><th>County</th><th>State</th>"
            + ("<th>Place as logged</th>" if city_col else "") +
            "<th class=\"num\">Lat, Lon</th></tr></thead><tbody>" + rows + "</tbody></table></div>\n")
    if fig["counties"]:
        rows = "".join(
            "<tr><td>" + esc(c) + "</td><td>" + esc(state_name(st)) + "</td><td class=\"num\">" + str(v["n"]) +
            "</td><td class=\"num\">" + (f"{v['max']:.2f}&Prime;" if v["max"] is not None else "&mdash;") + "</td></tr>"
            for (c, st), v in fig["counties"])
        out.append(
            "<h2>Counties with the most hail reports</h2>\n"
            "<p>" + ("Top " + str(len(fig["counties"])) + " of " + str(fig["n_counties"]) +
                     " counties with at least one report" if fig["n_counties"] > len(fig["counties"]) else
                     "All " + str(fig["n_counties"]) + " counties with at least one report"
                     if fig["n_counties"] > 1 else "The only county with a placed report")
            + ("; ties are listed by state, then name." if fig["n_counties"] > 1 else ".")
            + (f" {fig['unmatched']:,} report" + ("s" if fig["unmatched"] != 1 else "") +
               " could not be placed in a county and " + ("are" if fig["unmatched"] != 1 else "is") +
               " left out of this table." if fig["unmatched"] else "") + "</p>\n"
            "<div class=\"he-tw\"><table><thead><tr><th>County</th><th>State</th><th class=\"num\">Reports</th>"
            "<th class=\"num\">Largest</th></tr></thead><tbody>" + rows + "</tbody></table></div>\n")
    if fig["states"]:
        shown = fig["states"][:TOP_PLACES]
        items = "".join("<li>" + esc(state_name(s)) + ": " + f"{c:,}" + " report" + ("s" if c != 1 else "") + "</li>"
                        for s, c in shown)
        out.append(
            "<h2>States with the most hail reports</h2>\n"
            "<p>" + (f"Top {len(shown)} of {fig['n_states']} states." if fig["n_states"] > len(shown)
                     else f"All {fig['n_states']} states with reports." if fig["n_states"] > 1
                     else "The only state with reports.")
            + "</p>\n<ol class=\"he-ol\">" + items + "</ol>\n")
    return "".join(out)


def method_html(fig, has_swath):
    src = fig["src"]
    vint = fig["vintage"]
    file_line = ("" if not src else
                 " This page reads data/hail/" + esc(src) +
                 (" (pulled " + esc(vint) + ")" if vint else "") + ".")
    return (
        "<details class=\"he-how\"><summary>How these figures are built</summary><p>"
        "Reports are NWS Local Storm Reports of hail, pulled from the Iowa Environmental Mesonet archive."
        + file_line +
        " Local Storm Reports are preliminary and unverified: sizes are what spotters, the public and "
        "emergency managers reported, and NOAA NCEI's Storm Data, published months later, is the "
        "verified record. A report with no size counts toward the total but not toward the size figures. "
        "Damaging size means 1.5 inches or larger. State is the state named on the report. "
        "County is not carried in the archived file; it is assigned here by placing each report's "
        "coordinates (rounded to about 1 km) inside US Census cartographic county boundaries, so a "
        "report near a county line can land in the neighbouring county."
        + (" Radar figures are NOAA MRMS MESH, a radar estimate of maximum hail size, not a measurement."
           if has_swath else "") + "</p></details>\n")


def page_html(date, rec, has_swath, mesh_max, today, counties=None):
    nd = nice_date(date)
    canonical = "https://agsist.com/hail/" + date
    fig = day_figures(rec, counties)
    n, mx, dmg = fig["n"], fig["max"], fig["dmg"]
    thin = n < THIN_REPORTS
    summary = summary_sentence(nd, fig, mesh_max, has_swath)

    lead = ("<p class=\"he-sub\">" + esc(summary) +
        " Every number below is the public record: reported sizes from spotters and radar-estimated "
        "swaths from NOAA MRMS, labeled as what they are.</p>")

    swath_cta = (('<a class="he-cta" href="/hail-map?swath=' + date + '">Open the radar swath map for ' + esc(nd) + ' &rarr;</a>')
                 if has_swath else
                 '<p class="he-note">Radar swath archive begins after this date &mdash; the dated reports on this page are the record for this day.</p>')

    faq = [
        ("How big was the hail on " + nd + "?",
         (f"The largest reported stone on {nd} was {mx:.2f} inches" if mx else
          f"No measured sizes were reported on {nd}") +
         (f", among {n:,} reports nationwide" if n else "") +
         (". Radar (NOAA MRMS MESH) also estimated the swath footprint, an estimate, not a measurement." if has_swath else ".")),
    ]
    if fig["n_states"]:
        st_txt = ", ".join(state_name(s) + " (" + f"{c:,}" + ")" for s, c in fig["states"][:5])
        cty_txt = ", ".join(c + ", " + st + " (" + str(v["n"]) + ")" for (c, st), v in fig["counties"][:3])
        faq.append(("Where did it hail on " + nd + "?",
                    "Reports by state: " + st_txt +
                    (" and " + str(fig["n_states"] - 5) + " more" if fig["n_states"] > 5 else "") + "." +
                    (" Counties with the most reports: " + cty_txt + "." if cty_txt else "")))
    faq.append(("Did the " + nd + " hail hit my address?",
         "Use the hail map's address search: it lists every dated report within 25 miles of any US address and, for days in the radar archive, tests your exact point against the estimated swath, then prints a sourced report you can keep."))
    faq_ld = ",".join('{"@type":"Question","name":' + json.dumps(q) +
                      ',"acceptedAnswer":{"@type":"Answer","text":' + json.dumps(a) + '}}'
                      for q, a in faq)
    faq_vis = "".join("<details" + (" open" if i == 0 else "") + "><summary>" + esc(q) +
                      "</summary><p>" + esc(a) + "</p></details>" for i, (q, a) in enumerate(faq))

    return ("<!DOCTYPE html>\n<html lang=\"en\" data-theme=\"dark\">\n<head>\n"
        "<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        "<title>" + esc(page_title(nd)) + "</title>\n"
        "<meta name=\"description\" content=\"" + esc(meta_description(nd, fig, mesh_max, has_swath)) + "\">\n"
        + ("<meta name=\"robots\" content=\"noindex,follow\">\n" if thin else "") +
        "<link rel=\"canonical\" href=\"" + canonical + "\">\n"
        "<meta property=\"og:title\" content=\"Hail on " + esc(nd) + " — where it hit | AGSIST\">\n"
        "<meta property=\"og:url\" content=\"" + canonical + "\">\n"
        "<meta property=\"og:type\" content=\"article\">\n"
        "<meta property=\"og:image\" content=\"https://agsist.com/img/og/hail-map.jpg\">\n"
        "<meta property=\"og:image:width\" content=\"1200\">\n<meta property=\"og:image:height\" content=\"630\">\n"
        "<meta property=\"og:image:alt\" content=\"AGSIST hail map: radar-detected hail swaths and ground reports\">\n"
        "<meta name=\"twitter:card\" content=\"summary_large_image\">\n"
        "<meta name=\"twitter:image\" content=\"https://agsist.com/img/og/hail-map.jpg\">\n"
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
        "h2{font-size:1.15rem;margin:1.6rem 0 .5rem}\n"
        ".he-sub{line-height:1.7;max-width:70ch}\n"
        ".he-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.6rem;margin:1rem 0}\n"
        ".he-stat{background:var(--surface,#101415);border:1px solid var(--border,rgba(132,160,168,.12));border-radius:10px;padding:.8rem .9rem}\n"
        ".he-stat .v{font-family:'JetBrains Mono',monospace;font-size:1.5rem;font-weight:700}\n"
        ".he-stat .l{font-family:'JetBrains Mono',monospace;font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim,#8a948f);margin-top:.2rem}\n"
        ".he-cta{display:inline-flex;margin:.6rem 0 1rem;padding:.65rem 1rem;border:1px solid var(--brand,#d4a23f);border-radius:8px;color:var(--brand,#d4a23f);font-family:'JetBrains Mono',monospace;font-weight:700;font-size:.8rem;text-decoration:none}\n"
        ".he-note,.he-dim{color:var(--text-dim,#8a948f);font-size:.85rem}\n"
        ".he-tw{overflow-x:auto;-webkit-overflow-scrolling:touch}\n"
        ".he-wrap table{width:100%;border-collapse:collapse;font-size:.88rem}\n"
        ".he-wrap th,.he-wrap td{border-bottom:1px solid var(--border,rgba(132,160,168,.12));padding:.45rem .5rem;text-align:left}\n"
        ".he-wrap th{font-family:'JetBrains Mono',monospace;font-size:.64rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim,#8a948f)}\n"
        ".he-wrap td.num,.he-wrap th.num{text-align:right;font-family:'JetBrains Mono',monospace;white-space:nowrap}\n"
        ".he-ol{line-height:1.8;padding-left:1.4rem}\n"
        "details{border-top:1px solid var(--border,rgba(132,160,168,.12));padding:.7rem 0}summary{cursor:pointer;font-weight:600}details p{line-height:1.7;font-size:.92rem}\n"
        ".he-src{font-family:'JetBrains Mono',monospace;font-size:.7rem;color:var(--text-dim,#8a948f);margin-top:1.2rem;line-height:1.7}\n"
        "</style>\n</head>\n<body>\n<div id=\"site-header\"></div>\n<main id=\"main\">\n<div class=\"he-wrap\">\n"
        "<nav class=\"he-bc\" aria-label=\"Breadcrumb\"><a href=\"/\">AGSIST</a> › <a href=\"/hail-map\">Hail Map</a> › <a href=\"/hail/\">Storm Log</a> › " + esc(nd) + "</nav>\n"
        "<h1>Hail on " + esc(nd) + " — where it hit</h1>\n"
        + lead +
        "<div class=\"he-stats\">"
        "<div class=\"he-stat\"><div class=\"v\">" + (f"{n:,}" if n else "0") + "</div><div class=\"l\">NWS reports</div></div>"
        "<div class=\"he-stat\"><div class=\"v\">" + (f"{mx:.2f}″" if mx else "—") + "</div><div class=\"l\">largest reported</div></div>"
        "<div class=\"he-stat\"><div class=\"v\">" + str(dmg) + "</div><div class=\"l\">reports ≥1.5″</div></div>"
        "<div class=\"he-stat\"><div class=\"v\">" + str(fig["n_states"]) + "</div><div class=\"l\">states reporting</div></div>"
        + ("<div class=\"he-stat\"><div class=\"v\">" + (f"{mesh_max:.2f}″" if mesh_max else "✓") + "</div><div class=\"l\">radar-estimated max</div></div>" if has_swath else "")
        + "</div>\n"
        + swath_cta + "\n"
        + figures_html(nd, fig) +
        "<p><a href=\"/hail-map\" style=\"color:var(--brand,#d4a23f)\">Check any address against this storm on the hail map &rarr;</a></p>\n"
        "<h2>Questions about the " + esc(nd) + " hail</h2>\n" + faq_vis + "\n"
        + method_html(fig, has_swath) +
        "<div class=\"he-src\">Sources: NWS Local Storm Reports via the Iowa Environmental Mesonet (reported sizes, preliminary); NOAA MRMS MESH via Iowa State (radar-estimated swaths); US Census cartographic boundaries (county placement). Reported and estimated are different things and are labeled throughout. Compiled by Sigurd Lindquist · AGSIST · no charge, no login.</div>\n"
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
        "<meta property=\"og:image:width\" content=\"1200\">\n<meta property=\"og:image:height\" content=\"630\">\n"
        "<meta property=\"og:image:alt\" content=\"AGSIST hail map: radar-detected hail swaths and ground reports\">\n"
        "<meta name=\"twitter:card\" content=\"summary_large_image\">\n"
        "<meta name=\"twitter:image\" content=\"https://agsist.com/img/og/hail-map.jpg\">\n"
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
    counties = load_counties()
    if counties is None:
        print("county boundaries missing — county tables will be empty")
    qualifying = sorted(set(list(mdates.keys()) +
                            [d for d, r in day_idx.items() if r["n"] >= MIN_REPORTS]),
                        reverse=True)
    if not qualifying:
        print("no qualifying storm days — nothing to do")
        return
    os.makedirs(OUT_DIR, exist_ok=True)
    made = 0
    meta = []
    indexable = []
    modified = {}
    for d in qualifying:
        rec = day_idx.get(d)
        has_swath = d in mdates
        path = os.path.join(OUT_DIR, d + ".html")
        prev = open(path).read() if os.path.exists(path) else None
        # dateModified MOVES ONLY WITH CONTENT. Every run used to stamp today on
        # all 240 pages, so each was rewritten daily and claimed a fresh
        # modification it did not have. Re-render with the date the page last
        # carried; if that reproduces the file, nothing changed for a reader.
        old = re.search(r'"dateModified":"(\d{4}-\d{2}-\d{2})"', prev or "")
        old = old.group(1) if old else None
        if old and page_html(d, rec, has_swath, mdates.get(d), old, counties) == prev:
            html, modified[d] = prev, old
        else:
            html, modified[d] = page_html(d, rec, has_swath, mdates.get(d), today, counties), today
        n = rec["n"] if rec else 0
        if n >= THIN_REPORTS:
            indexable.append(d)
        meta.append((d, {"n": n, "max": rec["max"] if rec else 0, "swath": has_swath}))
        if prev != html:
            open(path, "w", encoding="utf-8").write(html)
            made += 1
    hp = os.path.join(OUT_DIR, "index.html")
    hprev = open(hp).read() if os.path.exists(hp) else None
    hold = re.search(r'"dateModified":"(\d{4}-\d{2}-\d{2})"', hprev or "")
    hub_mod = hold.group(1) if hold and hub_html(meta, hold.group(1)) == hprev else today
    hub = hub_html(meta, hub_mod)
    if hprev != hub:
        open(hp, "w", encoding="utf-8").write(hub)
    print(f"storm pages: {made} written/updated of {len(qualifying)} qualifying days · "
          f"{len(qualifying) - len(indexable)} thin (<{THIN_REPORTS} reports) noindexed · hub updated")

    # sitemap block — thin days are noindex, so they stay out of it (still linked from the hub)
    try:
        sm = open(SITEMAP, encoding="utf-8").read()
    except FileNotFoundError:
        print("sitemap.xml missing — skipped")
        return
    block = (MARK_A + "\n  <url><loc>https://agsist.com/hail/</loc><lastmod>" + hub_mod +
             "</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>" +
             "".join("\n  <url><loc>https://agsist.com/hail/" + d +
                     "</loc><lastmod>" + modified.get(d, d) +
                     "</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>"
                     for i, d in enumerate(indexable)) + "\n  " + MARK_B)
    if MARK_A in sm and MARK_B in sm:
        new = re.sub(re.escape(MARK_A) + r".*?" + re.escape(MARK_B), lambda m: block, sm, flags=re.S)
    else:
        new = sm.replace("</urlset>", "  " + block + "\n</urlset>")
    if new != sm:
        open(SITEMAP, "w", encoding="utf-8").write(new)
        print(f"sitemap: {len(indexable)+1} storm-log URLs")


def selftest():
    """Hand-worked fixtures. Exit non-zero on any failure."""
    fails = []

    def ok(cond, msg):
        if not cond:
            fails.append(msg)

    # a 1x1 degree square county with a hole, and a neighbour in another state
    sq = {"type": "Feature", "properties": {"name": "Alpha", "st": "KS"},
          "geometry": {"type": "Polygon", "coordinates": [
              [[-99, 38], [-98, 38], [-98, 39], [-99, 39], [-99, 38]],
              [[-98.6, 38.4], [-98.4, 38.4], [-98.4, 38.6], [-98.6, 38.6], [-98.6, 38.4]]]}}
    nb = {"type": "Feature", "properties": {"name": "Beta", "st": "NE", "u": "Parish"},
          "geometry": {"type": "MultiPolygon", "coordinates": [[
              [[-99, 39], [-98, 39], [-98, 40], [-99, 40], [-99, 39]]]]}}
    ci = CountyIndex([sq, nb])
    ok(ci.lookup(38.2, -98.8, "KS") == "Alpha County", "pip: inside square")
    ok(ci.lookup(38.5, -98.5, "KS") is None, "pip: inside hole")
    ok(ci.lookup(38.2, -98.8, "NE") is None, "pip: state mismatch rejected")
    ok(ci.lookup(39.5, -98.5, "NE") == "Beta Parish", "pip: multipolygon + unit word")
    ok(ci.lookup(37.5, -98.5, "KS") is None, "pip: outside")

    rec = _new_rec("events-2026.json")
    rows = [(38.2, -98.8, 2.0, "KS"), (38.3, -98.7, 2.0, "KS"), (38.1, -98.9, 1.0, "KS"),
            (39.5, -98.5, 1.75, "NE"), (39.6, -98.4, None, "NE"), (38.5, -98.5, 0.75, "KS")]
    for r in rows:
        _add_report(rec, *r)
    f = day_figures(rec, ci)
    # by hand: 6 reports, 5 measured, max 2.00 twice, dmg = 2.0,2.0,1.75 = 3,
    # states KS 4 / NE 2, counties Alpha 3 (hole point unmatched) / Beta 2
    ok(f["n"] == 6 and f["measured"] == 5, "counts")
    ok(f["max"] == 2.0 and len(f["at_max"]) == 2, "max + ties")
    ok(f["dmg"] == 3, "damaging count")
    ok(f["states"] == [("KS", 4), ("NE", 2)], "state ranking")
    ok([(k, v["n"]) for k, v in f["counties"]] == [(("Alpha County", "KS"), 3), (("Beta Parish", "NE"), 2)],
       "county ranking")
    ok(f["unmatched"] == 1, "unmatched count")
    ok([r["mag"] for r in f["stones"]] == [2.0, 2.0, 1.75, 1.0, 0.75], "stone order")
    s = summary_sentence("June 1, 2026", f, None, False)
    ok("6 hail reports across 2 states" in s and "2.00 inches, was logged 2 times" in s
       and "Kansas logged the most reports (4)" in s, "summary: " + s)
    for nd in ("May 1, 2026", "September 30, 2026"):
        ok(len(page_title(nd)) <= 60, "title length " + nd)
        d = meta_description(nd, f, None, False)
        ok(120 <= len(d) <= 160, "description length %d: %s" % (len(d), d))
        empty = day_figures(_new_rec("events-2026.json"), ci)
        d0 = meta_description(nd, empty, 1.25, True)
        ok(120 <= len(d0) <= 160, "empty-day description length %d: %s" % (len(d0), d0))
    html = page_html("2026-06-01", rec, False, None, "2026-06-02", ci)
    ok('noindex' in html, "6-report day is noindex")
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        try:
            ld = json.loads(m.group(1))
            for q in ld["@graph"][1]["mainEntity"]:
                ok(esc(q["acceptedAnswer"]["text"]) in html.split("</script>", 1)[1], "FAQ answer visible")
        except ValueError:
            fails.append("JSON-LD parses")
    if fails:
        print("SELFTEST FAILED:\n  " + "\n  ".join(fails))
        sys.exit(1)
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        main()
