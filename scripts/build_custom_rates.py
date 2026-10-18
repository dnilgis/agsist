#!/usr/bin/env python3
"""Custom farm work rates by state, from the published university and state surveys.

Source rows live in scripts/custom_rates/<st>.tsv, one file per state, typed
from the survey PDF saved on the references branch (refs/<ref>.txt). Every row
is a number the survey printed: the operation, the unit, the average and the
range (or Purdue's one-standard-deviation band, or nothing when the survey
prints no range), and the number of answers. Nothing is filled in, scaled,
inflated or averaged across states. A row a survey left unclear stays out, and
the file's "withheld" or "range_note" line says so.

Writes:
  data/custom-rates/<st>.json   the state's full table (the page loads only this one)
  data/custom-rates/index.json  states, survey years, sources, and the few common
                                operations side by side for the neighbor comparison
  custom-rates/<slug>.html      one landing page per state (static table, FAQ)
  custom-rates.html             the summary block between the cr:summary markers

  python3 scripts/build_custom_rates.py             # write
  python3 scripts/build_custom_rates.py --check     # exit 1 if anything on disk is stale or a row fails
  python3 scripts/build_custom_rates.py --selftest  # validator and builder tests, no files touched
  python3 scripts/build_custom_rates.py --verify-refs
        # every row's numbers must sit together on one line of the saved source
        # text (git show origin/references:refs/<ref>.txt); run after editing a TSV
"""
import html
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "scripts", "custom_rates")
OUT = os.path.join(ROOT, "data", "custom-rates")
PAGES = os.path.join(ROOT, "custom-rates")
MAIN = os.path.join(ROOT, "custom-rates.html")
PAGE_KB = 60  # each state page; the site cap for a generated page is 150

META_REQ = ("state", "name", "survey", "publisher", "survey_year", "collected", "url", "ref", "spread", "includes", "range_note")
SPREADS = {
    "minmax": "lowest to highest answer",
    "trimmed": "range without the single lowest and highest answer",
    "sd": "average plus and minus one standard deviation (about two thirds of answers)",
    "none": "no range printed",
}
UNITS = {
    "acre", "hour", "bushel", "bale", "ton", "mile", "loaded mile", "point per bushel", "1,000 gallon",
    "foot", "foot of bag", "head", "head / day", "cwt", "gross bushel", "pivot", "metered hour",
    "bushel / month", "bushel / year", "bushel / round trip", "horsepower / hour", "hour / head row",
    "hour / foot of blade", "hour / foot of blower", "bale / loaded mile", "load weighed",
}

# The few jobs farmers ask about most, under one name, so the page can set
# states side by side. Each state's own wording still shows in the table.
KEYS = {
    "combine-corn": "Combine corn",
    "combine-soy": "Combine soybeans",
    "combine-smallgrain": "Combine wheat or small grain",
    "harvest-haul-corn": "Corn: combine, cart and haul to the farm",
    "harvest-haul-soy": "Soybeans: combine, cart and haul to the farm",
    "plant-row": "Plant row crops, no fertilizer",
    "plant-row-fert": "Plant row crops with fertilizer",
    "plant-notill": "No-till plant corn",
    "drill-soy": "Drill soybeans",
    "drill-soy-notill": "No-till drill soybeans",
    "drill-smallgrain": "Drill small grain",
    "spray-ground": "Spray, ground rig",
    "spray-tractor": "Spray, tractor and sprayer",
    "spray-aerial": "Spray, airplane",
    "spray-drone": "Spray, drone",
    "fert-dry": "Spread dry fertilizer",
    "fert-liquid": "Apply liquid fertilizer",
    "nh3": "Apply anhydrous ammonia",
    "lime-ton": "Spread lime",
    "chisel": "Chisel plow",
    "disk-tandem": "Tandem or finishing disk",
    "disk-chisel": "Disk-chisel",
    "field-cult": "Field cultivate",
    "vertical-till": "Vertical tillage",
    "subsoil": "Subsoil or rip",
    "strip-till": "Strip till",
    "moldboard": "Moldboard plow",
    "land-roll": "Roll land",
    "mow-hay": "Mow hay",
    "mow-cond": "Mow and condition hay",
    "rake": "Rake hay",
    "ted": "Ted hay",
    "swath": "Swath",
    "bale-smallsq": "Bale small squares",
    "bale-largesq": "Bale large squares",
    "bale-round": "Bale round bales",
    "bale-round-net": "Bale round bales, net wrap",
    "grain-cart": "Grain cart",
    "haul-grain-bu": "Haul grain by truck",
    "dry-corn-pt": "Dry corn, per point",
    "custom-farm-corn": "Custom farm corn, all trips",
    "custom-farm-soy": "Custom farm soybeans, all trips",
    "mow-crp": "Mow CRP or pasture",
    "tub-grind": "Tub grind hay",
    "backhoe": "Backhoe",
    "manure-inject": "Inject liquid manure",
    "manure-dragline": "Liquid manure by drag line",
}

# Shared land borders, for the neighbor comparison.
BORDERS = {
    "AL": "FL GA MS TN", "AR": "LA MO MS OK TN TX", "AZ": "CA CO NM NV UT", "CA": "AZ NV OR",
    "CO": "AZ KS NE NM OK UT WY", "CT": "MA NY RI", "DE": "MD NJ PA", "FL": "AL GA", "GA": "AL FL NC SC TN",
    "IA": "IL MN MO NE SD WI", "ID": "MT NV OR UT WA WY", "IL": "IA IN KY MO WI", "IN": "IL KY MI OH",
    "KS": "CO MO NE OK", "KY": "IL IN MO OH TN VA WV", "LA": "AR MS TX", "MA": "CT NH NY RI VT",
    "MD": "DE PA VA WV", "ME": "NH", "MI": "IN OH WI", "MN": "IA ND SD WI", "MO": "AR IA IL KS KY NE OK TN",
    "MS": "AL AR LA TN", "MT": "ID ND SD WY", "NC": "GA SC TN VA", "ND": "MN MT SD", "NE": "CO IA KS MO SD WY",
    "NH": "MA ME VT", "NJ": "DE NY PA", "NM": "AZ CO OK TX UT", "NV": "AZ CA ID OR UT", "NY": "CT MA NJ PA VT",
    "OH": "IN KY MI PA WV", "OK": "AR CO KS MO NM TX", "OR": "CA ID NV WA", "PA": "DE MD NJ NY OH WV",
    "RI": "CT MA", "SC": "GA NC", "SD": "IA MN MT ND NE WY", "TN": "AL AR GA KY MO MS NC VA",
    "TX": "AR LA NM OK", "UT": "AZ CO ID NM NV WY", "VA": "KY MD NC TN WV", "VT": "MA NH NY",
    "WA": "ID OR", "WI": "IA IL MI MN", "WV": "KY MD OH PA VA", "WY": "CO ID MT NE SD UT",
}
STATE_NAMES = {
    "AL": "Alabama", "AR": "Arkansas", "AZ": "Arizona", "CA": "California", "CO": "Colorado", "CT": "Connecticut",
    "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "IA": "Iowa", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "MA": "Massachusetts", "MD": "Maryland", "ME": "Maine",
    "MI": "Michigan", "MN": "Minnesota", "MO": "Missouri", "MS": "Mississippi", "MT": "Montana", "NC": "North Carolina",
    "ND": "North Dakota", "NE": "Nebraska", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NV": "Nevada",
    "NY": "New York", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island",
    "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VA": "Virginia",
    "VT": "Vermont", "WA": "Washington", "WI": "Wisconsin", "WV": "West Virginia", "WY": "Wyoming",
}
# Asked about and checked, but no current public survey of that state's own rates was found.
NOT_COVERED = {
    "IL": "Illinois Extension points readers to the Iowa survey; no Illinois survey of its own was found.",
    "MN": "No current University of Minnesota custom rate survey was found (the last one in the university archive is from 1993).",
    "SD": "SDSU Extension ran a new survey in 2026; its report was not out when this page was built.",
    "MI": "Michigan State publishes machinery cost estimates, not a survey of rates charged, so it is not mixed in here.",
    "KY": "Kentucky's guide averages other states' surveys, so it is not a Kentucky survey.",
}
STAMP = "2026-10-17"
UNIT_LABEL = {"1,000 gallon": "1,000 gallons", "head / day": "head a day", "bushel / month": "bushel a month",
              "bushel / year": "bushel a year", "bushel / round trip": "bushel, round trip",
              "horsepower / hour": "horsepower-hour", "hour / head row": "hour per row of head",
              "hour / foot of blade": "hour per foot of blade", "hour / foot of blower": "hour per foot of blower",
              "bale / loaded mile": "bale per loaded mile", "point per bushel": "bushel per point"}


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def num(s):
    s = s.strip().replace(",", "").replace("$", "")
    if s == "":
        return None
    if not re.fullmatch(r"\d+(\.\d+)?", s):
        raise ValueError("not a number: %r" % s)
    return float(s)


def parse_tsv(text, where="tsv"):
    meta, rows, cols, errs = {}, [], None, []
    for i, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        if line.startswith("#"):
            m = re.match(r"#\s*([a-z_0-9]+):\s*(.*)$", line)
            if m:
                meta[m.group(1)] = m.group(2).strip()
            continue
        parts = line.split("\t")
        if cols is None:
            cols = parts
            for c in ("key", "section", "operation", "unit", "avg", "lo", "hi", "n"):
                if c not in cols:
                    errs.append("%s: header lacks %s" % (where, c))
            continue
        if len(parts) > len(cols):
            errs.append("%s:%d: %d fields, header has %d" % (where, i, len(parts), len(cols)))
            continue
        parts += [""] * (len(cols) - len(parts))
        rows.append(dict(zip(cols, parts), _line=i))
    return meta, rows, errs


def validate(meta, rows, where="tsv"):
    """Return (clean rows, errors). A row that breaks a rule is an error, never quietly fixed."""
    errs = []
    for k in META_REQ:
        if not meta.get(k):
            errs.append("%s: missing meta %s" % (where, k))
    if meta.get("spread") not in SPREADS:
        errs.append("%s: spread must be one of %s" % (where, ", ".join(SPREADS)))
    if not re.fullmatch(r"20\d\d", meta.get("survey_year", "")):
        errs.append("%s: survey_year must be a year" % where)
    for u in ("url", "url2"):
        if meta.get(u) and not meta[u].startswith("https://"):
            errs.append("%s: %s must be https" % (where, u))
    for k, v in meta.items():
        if "—" in v:
            errs.append("%s: em dash in %s" % (where, k))
    out, seen_keys, seen_rows = [], set(), set()
    for r in rows:
        at = "%s:%d" % (where, r["_line"])
        try:
            avg, lo, hi = num(r["avg"]), num(r["lo"]), num(r["hi"])
        except ValueError as e:
            errs.append("%s: %s" % (at, e))
            continue
        if not re.fullmatch(r"\d+", r["n"].strip()):
            errs.append("%s: n must be a whole number" % at)
            continue
        n = int(r["n"])
        printed = r.get("printed", "").strip()
        if printed not in ("", "cents"):
            errs.append("%s: printed must be blank or cents" % at)
            continue
        if avg is None or avg <= 0:
            errs.append("%s: average missing" % at)
            continue
        if (lo is None) != (hi is None):
            errs.append("%s: range needs both ends" % at)
            continue
        if lo is not None and not (lo <= avg <= hi):
            errs.append("%s: average %s outside its range %s-%s" % (at, avg, lo, hi))
            continue
        if lo is not None and meta.get("spread") == "none":
            errs.append("%s: a range on a survey marked spread none" % at)
            continue
        if n < 1:
            errs.append("%s: no answers" % at)
            continue
        u = r["unit"].strip()
        if u not in UNITS:
            errs.append("%s: unknown unit %r" % (at, u))
            continue
        key = r["key"].strip()
        if key and key not in KEYS:
            errs.append("%s: unknown key %r" % (at, key))
            continue
        if key and key in seen_keys:
            errs.append("%s: key %s used twice" % (at, key))
            continue
        op, sec = r["operation"].strip(), r["section"].strip()
        if not op or not sec:
            errs.append("%s: section and operation are required" % at)
            continue
        if "—" in op + sec:
            errs.append("%s: em dash" % at)
            continue
        if (sec, op, u) in seen_rows:
            errs.append("%s: duplicate row %s / %s / %s" % (at, sec, op, u))
            continue
        src = r.get("src", "").strip() or "1"
        if src not in ("1", "2") or (src == "2" and not meta.get("url2")):
            errs.append("%s: src %s has no url" % (at, src))
            continue
        seen_rows.add((sec, op, u))
        if key:
            seen_keys.add(key)
        scale = 0.01 if printed == "cents" else 1.0
        row = {"s": sec, "o": op, "u": u, "a": round(avg * scale, 4), "n": n}
        if lo is not None:
            row["lo"], row["hi"] = round(lo * scale, 4), round(hi * scale, 4)
        if key:
            row["k"] = key
        if printed:
            row["p"] = printed
        if src == "2":
            row["src"] = 2
        out.append(row)
    if not out:
        errs.append("%s: no rows" % where)
    return out, errs


def load_states(src_dir=SRC):
    states, errs = {}, []
    for fn in sorted(os.listdir(src_dir)):
        if not fn.endswith(".tsv"):
            continue
        where = "scripts/custom_rates/" + fn
        text = open(os.path.join(src_dir, fn), encoding="utf-8").read()
        meta, rows, e1 = parse_tsv(text, where)
        clean, e2 = validate(meta, rows, where)
        errs += e1 + e2
        st = meta.get("state", "")
        if st != fn[:-4].upper():
            errs.append("%s: state %r does not match the file name" % (where, st))
        if STATE_NAMES.get(st) != meta.get("name"):
            errs.append("%s: name %r is not %s's name" % (where, meta.get("name"), st))
        states[st] = (meta, clean, rows)
    return states, errs


def state_doc(meta, rows):
    srcs = [{"url": meta["url"], "ref": meta["ref"]}]
    if meta.get("url2"):
        srcs.append({"url": meta["url2"], "ref": meta.get("ref2", "")})
    d = {"state": meta["state"], "name": meta["name"], "slug": slug(meta["name"]), "survey": meta["survey"],
         "publisher": meta["publisher"], "survey_year": int(meta["survey_year"]), "collected": meta["collected"],
         "sources": srcs, "spread": meta["spread"], "spread_label": SPREADS[meta["spread"]],
         "includes": meta["includes"], "range_note": meta["range_note"], "rows": rows}
    if meta.get("withheld"):
        d["withheld"] = meta["withheld"]
    return d


def index_doc(docs):
    covered = sorted(docs)
    states = []
    for st in covered:
        d = docs[st]
        nb = [x for x in BORDERS.get(st, "").split() if x in docs]
        states.append({"st": st, "name": d["name"], "slug": d["slug"], "year": d["survey_year"],
                       "survey": d["survey"], "publisher": d["publisher"], "url": d["sources"][0]["url"],
                       "rows": len(d["rows"]), "spread": d["spread"], "neighbors": nb})
    common = {}
    for st in covered:
        for r in docs[st]["rows"]:
            if "k" in r:
                c = [r["a"], r["u"], r.get("lo"), r.get("hi"), r["n"], r["o"]]
                common.setdefault(r["k"], {})[st] = c
    return {"note": "Custom farm work rates as each state survey published them. Built by scripts/build_custom_rates.py from scripts/custom_rates/*.tsv; every number is from the survey named in its state file.",
            "built": STAMP, "states": states, "keys": KEYS, "common": common,
            "borders": {st: [x for x in BORDERS.get(st, "").split()] for st in sorted(BORDERS)},
            "names": STATE_NAMES,
            "not_covered": NOT_COVERED}


def money(v, unit):
    if v is None:
        return ""
    if v < 1 and unit in ("bushel", "point per bushel", "gross bushel", "bushel / month", "bushel / year",
                          "bushel / round trip", "horsepower / hour", "bale / loaded mile", "bale"):
        s = ("%.3f" % v).rstrip("0")
        if len(s.split(".")[1]) < 2:
            s = "%.2f" % v
        return "$" + s
    if v >= 1000:
        return "${:,.0f}".format(v)
    return "$%.2f" % v


def unit_label(u):
    return "per " + UNIT_LABEL.get(u, u)


def esc(s):
    return html.escape(str(s), quote=True)


def range_text(r, unit):
    if "lo" not in r:
        return "not printed"
    return "%s to %s" % (money(r["lo"], unit), money(r["hi"], unit))


def faq_for(d):
    name, yr = d["name"], d["survey_year"]
    by = {r.get("k"): r for r in d["rows"] if r.get("k")}
    qs = []
    c = by.get("combine-corn")
    s = by.get("combine-soy")
    if c or s:
        parts = []
        if c:
            parts.append("combining corn averaged %s %s (%s, %d answers)" % (money(c["a"], c["u"]), unit_label(c["u"]), range_text(c, c["u"]), c["n"]))
        if s:
            parts.append("combining soybeans averaged %s %s (%s, %d answers)" % (money(s["a"], s["u"]), unit_label(s["u"]), range_text(s, s["u"]), s["n"]))
        qs.append(("What does custom combining cost in %s?" % name,
                   "In the %s, %s. Rates are survey averages; your local custom operator may charge more or less." % (d["survey"], " and ".join(parts))))
    p = by.get("plant-row") or by.get("plant-row-fert")
    if p:
        qs.append(("What is the custom planting rate in %s?" % name,
                   "%s: %s %s in the %d survey (%s, %d answers). The survey's other planting lines are in the table above." % (p["o"], money(p["a"], p["u"]), unit_label(p["u"]), yr, range_text(p, p["u"]), p["n"])))
    sp = by.get("spray-ground")
    if sp:
        qs.append(("What does custom spraying cost in %s?" % name,
                   "%s: %s %s in the %d survey (%s, %d answers). Chemical is not included." % (sp["o"], money(sp["a"], sp["u"]), unit_label(sp["u"]), yr, range_text(sp, sp["u"]), sp["n"])))
    qs.append(("Who set these rates?",
               "Nobody set them. They are averages of what farmers and custom operators told %s they charged or paid. AGSIST copied them from the survey and links it. Your local custom operator may charge more or less." % d["publisher"]))
    qs.append(("What is included in a custom rate?", d["includes"]))
    return qs


def og_image():
    """The set's one share card (scripts/build_share_images.py draws img/og/custom-rates.jpg)."""
    fp = os.path.join(ROOT, "img", "og", "custom-rates.jpg")
    if not os.path.exists(fp):
        return "https://agsist.com/img/og/custom-rates.jpg"
    import hashlib
    return "https://agsist.com/img/og/custom-rates.jpg?v=" + hashlib.sha1(open(fp, "rb").read()).hexdigest()[:8]


def state_page(d, idx):
    name, yr, st = d["name"], d["survey_year"], d["state"]
    url = "https://agsist.com/custom-rates/" + d["slug"]
    title = "%s custom rates %d: combining, planting, spraying, baling | AGSIST" % (name, yr)
    desc = "%s custom farm work rates from the %d survey by %s: the average and range for each job, per acre, hour, bushel or bale." % (name, yr, d["publisher"].split(",")[0])
    if len(desc) > 158:
        desc = "%s custom farm work rates from the %d state survey: average and range for each job, per acre, hour, bushel or bale." % (name, yr)
    faq = faq_for(d)
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "@id": url + "#page", "name": "%s custom rates %d" % (name, yr), "url": url,
         "description": desc, "inLanguage": "en-US", "datePublished": STAMP, "dateModified": STAMP,
         "author": {"@type": "Person", "name": "Sigurd Lindquist", "jobTitle": "Certified Crop Adviser (CCA)", "url": "https://agsist.com/about"},
         "publisher": {"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com/"},
         "isBasedOn": {"@type": "CreativeWork", "name": d["survey"], "url": d["sources"][0]["url"], "publisher": {"@type": "Organization", "name": d["publisher"]}}},
        {"@type": "Dataset", "name": "%s custom farm work rates, %d survey" % (name, yr), "description": "Average and range for each custom farm operation as published in the %s." % d["survey"],
         "url": url, "isAccessibleForFree": True, "temporalCoverage": str(yr), "spatialCoverage": {"@type": "Place", "name": name},
         "creator": {"@type": "Organization", "name": d["publisher"]}, "distribution": {"@type": "DataDownload", "encodingFormat": "application/json", "contentUrl": "https://agsist.com/data/custom-rates/%s.json" % st.lower()},
         "license": "https://agsist.com/terms"},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://agsist.com/"},
            {"@type": "ListItem", "position": 2, "name": "Custom rates", "item": "https://agsist.com/custom-rates"},
            {"@type": "ListItem", "position": 3, "name": name, "item": url}]},
        {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]}]}
    secs = []
    for r in d["rows"]:
        if not secs or secs[-1][0] != r["s"]:
            secs.append((r["s"], []))
        secs[-1][1].append(r)
    body = []
    for sec, rows in secs:
        body.append('<tr class="sec"><th colspan="4" scope="colgroup">%s</th></tr>' % esc(sec))
        for r in rows:
            note = " <small>(printed in cents)</small>" if r.get("p") == "cents" else ""
            rg = range_text(r, r["u"])
            body.append('<tr><th scope="row">%s%s</th><td class="av">%s <small>%s</small><span class="rgm">%s</span></td><td class="rg">%s</td><td>%d</td></tr>' % (
                esc(r["o"]), note, money(r["a"], r["u"]), esc(unit_label(r["u"])), ("range " + rg) if "lo" in r else "", rg, r["n"]))
    me = next(s for s in idx["states"] if s["st"] == st)
    nb = ", ".join('<a href="/custom-rates/%s">%s (%d)</a>' % (s["slug"], esc(s["name"]), s["year"]) for s in idx["states"] if s["st"] in me["neighbors"])
    others = " &middot; ".join('<a href="/custom-rates/%s">%s</a>' % (s["slug"], esc(s["name"])) for s in idx["states"] if s["st"] != st)
    srcl = " and ".join('<a href="%s" rel="nofollow">%s</a>' % (esc(s["url"]), "the survey" if i == 0 else "the second part") for i, s in enumerate(d["sources"]))
    faq_html = "".join('<details><summary>%s</summary><p>%s</p></details>' % (esc(q), esc(a)) for q, a in faq)
    withheld = ('<p class="fine">%s</p>' % esc(d["withheld"])) if d.get("withheld") else ""
    return """<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#111a0a">
  <title>{title}</title>
  <meta name="description" content="{desc}">
  <meta name="author" content="Sigurd Lindquist">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
  <link rel="canonical" href="{url}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="AGSIST">
  <meta property="og:title" content="{ogt}">
  <meta property="og:description" content="{desc}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{og}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Custom farm rates by state, from the state surveys.">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="{og}">
  <script>try{{var _t=localStorage.getItem('agsist-theme');if(_t!=='light'&&_t!=='dark')_t=window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.setAttribute('data-theme',_t);}}catch(e){{}}</script>
  <link rel="stylesheet" href="/components/styles.css?v=24">
  <link rel="stylesheet" href="/components/custom-rates.css?v=1">
  <link rel="icon" type="image/x-icon" href="/img/favicon.ico">
  <script type="application/ld+json">{ld}</script>
</head>
<body>
  <a href="#main" class="skip">Skip to content</a>
  <div id="site-header"></div>
  <main id="main" tabindex="-1">
    <article class="cr">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> &rarr; <a href="/custom-rates">Custom rates</a> &rarr; {name}</nav>
      <h1>{name} custom rates, {yr} survey</h1>
      <p class="by">Sigurd Lindquist, CCA &middot; numbers from {pub}</p>
      <p class="cr-lede">What farmers and custom operators in {name} said they charged or paid for custom work, as the {survey} printed it. Rates are survey averages; your local custom operator may charge more or less.</p>
      <p class="cr-actions"><a class="cr-btn go" href="/custom-rates?st={st}">Search jobs and compare neighbors</a></p>
      <div class="cr-tw"><table class="cr-t cr-full">
        <caption>{name}, {yr}: average and {spread} for each job. Answers = how many reported that job.</caption>
        <thead><tr><th scope="col">Job</th><th scope="col">Average</th><th scope="col" class="rg">Range</th><th scope="col">Answers</th></tr></thead>
        <tbody>
{body}
        </tbody>
      </table></div>
      <p class="fine">{collected}. {includes} {range_note}</p>
      {withheld}
      <p class="fine">Source: {pub}, {srcl}. AGSIST did not set these rates and does not adjust them. Bordering states with a survey here: {nb}.</p>
      <h2>Questions</h2>
      <div class="cr-faq">{faq}</div>
      <h2>Other states</h2>
      <p class="cr-other">{others}</p>
    </article>
  </main>
  <div id="site-footer"></div>
  <script src="/components/loader.js?v=19" defer></script>
</body>
</html>
""".format(og=og_image(), title=esc(title), desc=esc(desc), url=url, ogt=esc("%s custom rates, %d survey" % (name, yr)),
           ld=json.dumps(ld, separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/"), name=esc(name), yr=yr,
           pub=esc(d["publisher"]), survey=esc(d["survey"]), st=st, spread=esc(d["spread_label"]),
           body="\n".join(body), collected=esc(d["collected"].rstrip(".")), includes=esc(d["includes"]),
           range_note=esc(d["range_note"]), withheld=withheld, srcl=srcl, nb=nb or "none yet",
           faq=faq_html, others=others)


LD_RE = re.compile(r"(<!-- cr:ld \(scripts/build_custom_rates.py\) -->)(.*?)(<!-- /cr:ld -->)", re.S)
FAQ_RE = re.compile(r"(<!-- cr:faq \(scripts/build_custom_rates.py\) -->)(.*?)(<!-- /cr:faq -->)", re.S)


def faq_main(docs, idx):
    def line(k):
        out = []
        for s in idx["states"]:
            r = next((x for x in docs[s["st"]]["rows"] if x.get("k") == k), None)
            if r:
                out.append("%s %s (%d survey, %d answers)" % (s["name"], money(r["a"], r["u"]), s["year"], r["n"]))
        return out
    names = ", ".join("%s (%d)" % (s["name"], s["year"]) for s in idx["states"])
    qs = [("What does custom combining cost per acre?",
           "Survey averages for combining corn, per acre: " + "; ".join(line("combine-corn")) + ". Soybeans: " + "; ".join(line("combine-soy")) +
           ". Some surveys price combining alone and some include the grain cart and hauling, so check the wording in each state's table. Rates are survey averages; your local custom operator may charge more or less."),
          ("What is the custom rate for planting corn?",
           "Survey averages for planting row crops without fertilizer, per acre: " + "; ".join(line("plant-row")) + ". Planting with fertilizer and no-till planting run a little higher in most surveys; each state's table has its lines."),
          ("What does custom spraying cost?",
           "Ground rig spraying, per acre, chemical not included: " + "; ".join(line("spray-ground")) + "."),
          ("Who sets these custom rates?",
           "Nobody sets them. Each number is an average of what farmers and custom operators told a university or state survey they charged or paid. AGSIST copies the survey's own numbers and links the survey; it does not set, adjust or update them between surveys. Your local custom operator may charge more or less."),
          ("Which states are covered?",
           "States with a public survey read for this page: " + names + ". " + " ".join(NOT_COVERED[k] for k in sorted(NOT_COVERED))),
          ("Why do the same jobs differ between states?",
           "The surveys were taken in different years, ask about the job in different words (combine only, or combine, cart and haul), and hear from different people. Some print the lowest and highest answer, Iowa leaves out the single lowest and highest, Purdue prints a one standard deviation band and Oklahoma prints no range. Compare the wording before you compare the numbers."),
          ("What does custom grain hauling cost per bushel?",
           "Kansas's 2026 survey prices hauling from the field to the farm or the nearest elevator. Corn averaged 23.9 cents a bushel, plus 5.5 cents a bushel a mile past 16 miles. Soybeans averaged 24.2 cents a bushel, plus 5.6 cents a bushel a mile past 18 miles."),
          ("Do custom combiners charge extra for a big corn crop?",
           "Some do. In Kansas's 2026 survey, harvesters who charge a base rate averaged $35.27 an acre for corn, plus $0.279 a bushel on yield over 69 bushels an acre. Those who charge one flat rate with no yield charge averaged $41.87 an acre.")]
    return qs


SUM_RE = re.compile(r"(<!-- cr:summary \(scripts/build_custom_rates.py\) -->)(.*?)(<!-- /cr:summary -->)", re.S)


def summary_block(docs, idx):
    """The static answer on /custom-rates: each state's survey and its combining rates."""
    rows = []
    for s in idx["states"]:
        d = docs[s["st"]]
        by = {r.get("k"): r for r in d["rows"] if r.get("k")}
        cells = []
        for k in ("combine-corn", "combine-soy", "plant-row", "spray-ground"):
            r = by.get(k)
            cells.append("<td>%s</td>" % (("%s<small>/%s</small>" % (money(r["a"], r["u"]), "ac" if r["u"] == "acre" else esc(r["u"]))) if r else "<span class=\"na\">not in survey</span>"))
        rows.append('<tr><th scope="row"><a href="/custom-rates/%s">%s</a> <small>%d</small></th>%s</tr>' % (s["slug"], esc(s["name"]), s["year"], "".join(cells)))
    return ("\n      <div class=\"cr-tw\"><table class=\"cr-t cr-sum\">\n        <caption>State survey averages. Each state's own wording and full table are on its page.</caption>\n"
            "        <thead><tr><th scope=\"col\">State, survey year</th><th scope=\"col\">Combine corn</th><th scope=\"col\">Combine soybeans</th><th scope=\"col\">Plant, no fertilizer</th><th scope=\"col\">Spray, ground</th></tr></thead>\n"
            "        <tbody>\n        " + "\n        ".join(rows) + "\n        </tbody>\n      </table></div>\n"
            "      <ul class=\"srcs\">\n" + "".join('        <li><a href="/custom-rates/%s">%s</a>: %s, %s. <a href="%s" rel="nofollow">The survey</a>.</li>\n' % (
                s["slug"], esc(s["name"]), esc(s["survey"]), esc(s["publisher"]), esc(s["url"])) for s in idx["states"]) +
            "      </ul>\n      <p class=\"fine\">Not here yet: " + " ".join(esc(NOT_COVERED[k]) for k in sorted(NOT_COVERED)) + "</p>\n      ")


def build(src_dir=SRC):
    states, errs = load_states(src_dir)
    docs = {st: state_doc(m, rows) for st, (m, rows, _) in states.items()}
    idx = index_doc(docs) if docs else None
    files = {}
    for st, d in docs.items():
        files[os.path.join(OUT, st.lower() + ".json")] = json.dumps(d, indent=1, ensure_ascii=False) + "\n"
        page = state_page(d, idx)
        if "—" in page:
            errs.append("%s page: em dash" % st)
        if len(page.encode()) > PAGE_KB * 1024:
            errs.append("%s page: %d KB, over %d" % (st, len(page.encode()) // 1024, PAGE_KB))
        files[os.path.join(PAGES, d["slug"] + ".html")] = page
    if idx:
        files[os.path.join(OUT, "index.json")] = json.dumps(idx, separators=(",", ":"), ensure_ascii=False) + "\n"
        if os.path.exists(MAIN):
            main = open(MAIN, encoding="utf-8").read()
            if not SUM_RE.search(main):
                errs.append("custom-rates.html: no cr:summary markers")
            else:
                main = SUM_RE.sub(lambda m: m.group(1) + summary_block(docs, idx) + m.group(3), main, count=1)
                qs = faq_main(docs, idx)
                fh = "".join('\n        <details><summary>%s</summary><p>%s</p></details>' % (esc(q), esc(a)) for q, a in qs) + "\n      "
                ld = {"@context": "https://schema.org", "@graph": [
                    {"@type": "WebApplication", "@id": "https://agsist.com/custom-rates#app", "name": "Custom farm work rates by state",
                     "url": "https://agsist.com/custom-rates", "description": "Custom farming rates by state from the public university and state surveys: combining, planting, spraying, tillage, hauling and baling, with the average, range, unit, survey year and source.",
                     "applicationCategory": "BusinessApplication", "operatingSystem": "Any (web browser)", "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
                     "isAccessibleForFree": True, "author": {"@type": "Person", "name": "Sigurd Lindquist", "jobTitle": "Certified Crop Adviser (CCA)", "url": "https://agsist.com/about"},
                     "publisher": {"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com/"}, "datePublished": STAMP, "dateModified": STAMP, "inLanguage": "en-US"},
                    {"@type": "Dataset", "name": "Custom farm work rates by state", "description": "Average and range for custom farm operations as published by state surveys: " + ", ".join("%s %d" % (x["name"], x["year"]) for x in idx["states"]) + ".",
                     "url": "https://agsist.com/custom-rates", "isAccessibleForFree": True, "license": "https://agsist.com/terms",
                     "isBasedOn": [{"@type": "CreativeWork", "name": docs[x["st"]]["survey"], "url": x["url"]} for x in idx["states"]],
                     "distribution": {"@type": "DataDownload", "encodingFormat": "application/json", "contentUrl": "https://agsist.com/data/custom-rates/index.json"}},
                    {"@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": 1, "name": "Home", "item": "https://agsist.com/"},
                     {"@type": "ListItem", "position": 2, "name": "Tools", "item": "https://agsist.com/tools"},
                     {"@type": "ListItem", "position": 3, "name": "Custom rates", "item": "https://agsist.com/custom-rates"}]},
                    {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in qs]}]}
                ldh = '\n  <script type="application/ld+json">' + json.dumps(ld, separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/") + '</script>\n  '
                if not (FAQ_RE.search(main) and LD_RE.search(main)):
                    errs.append("custom-rates.html: no cr:faq or cr:ld markers")
                else:
                    main = FAQ_RE.sub(lambda m: m.group(1) + fh + m.group(3), main, count=1)
                    main = LD_RE.sub(lambda m: m.group(1) + ldh + m.group(3), main, count=1)
                if "\u2014" in main:
                    errs.append("custom-rates.html: em dash")
                files[MAIN] = main
    return files, errs, docs


def verify_refs(src_dir=SRC):
    """Each row's printed numbers must appear together on one line of the saved survey text."""
    states, errs = load_states(src_dir)
    cache, bad = {}, []

    def text(ref):
        if ref not in cache:
            try:
                cache[ref] = subprocess.run(["git", "-C", ROOT, "show", "origin/references:refs/%s.txt" % ref],
                                            capture_output=True, check=True).stdout.decode("utf-8", "replace")
            except subprocess.CalledProcessError:
                cache[ref] = None
        return cache[ref]

    def toks(s):
        s = re.sub(r"(\d+\.\d)\s(\d)\b", r"\1\2", s)  # Purdue's text layer splits "9.4 0"
        s = s.replace(",", "").replace("$", "")
        out = set()
        for t in re.findall(r"\d+(?:\.\d+)?", s):
            out.add(float(t))
        return out

    for st, (meta, clean, raw) in states.items():
        lines = {}
        for k in ("ref", "ref2"):
            if meta.get(k):
                t = text(meta[k])
                if t is None:
                    bad.append("%s: refs/%s.txt is not on origin/references (git fetch origin references)" % (st, meta[k]))
                    lines[k] = []
                else:
                    lines[k] = [toks(l) for l in t.splitlines()]
        for r in raw:
            k = "ref2" if r.get("src", "").strip() == "2" else "ref"
            want = {float(r[c].replace(",", "")) for c in ("avg", "lo", "hi") if r[c].strip()}
            want.add(float(r["n"]))
            if not any(want <= L for L in lines.get(k, [])):
                bad.append("%s line %d (%s): %s not found together on one line of refs/%s.txt" % (st, r["_line"], r["operation"], sorted(want), meta.get(k)))
    return errs + bad


def selftest():
    fails = []

    def ok(c, what):
        if not c:
            fails.append(what)

    head = "\n".join("# %s: %s" % kv for kv in [("state", "IA"), ("name", "Iowa"), ("survey", "Test"), ("publisher", "Pub"),
                                                 ("survey_year", "2026"), ("collected", "c"), ("url", "https://x.edu/a.pdf"),
                                                 ("ref", "r"), ("spread", "minmax"), ("includes", "i"), ("range_note", "n")])
    cols = "key\tsection\toperation\tunit\tavg\tlo\thi\tn\tprinted"

    def run(lines, extra=""):
        m, rows, e = parse_tsv(head + extra + "\n" + cols + "\n" + "\n".join(lines))
        c, e2 = validate(m, rows)
        return c, e + e2

    c, e = run(["combine-corn\tH\tCorn combining\tacre\t46.05\t25.00\t80.00\t119"])
    ok(not e and c[0]["a"] == 46.05 and c[0]["lo"] == 25 and c[0]["k"] == "combine-corn", "good row passes: %s" % e)
    c, e = run(["\tH\tX\tacre\t90\t25\t80\t3"])
    ok(e and "outside its range" in e[0], "average outside range refused")
    c, e = run(["\tH\tX\tacre\t20\t25\t\t3"])
    ok(e and "both ends" in e[0], "half a range refused")
    c, e = run(["\tH\tX\tfurlong\t20\t\t\t3"])
    ok(e and "unknown unit" in e[0], "unknown unit refused")
    c, e = run(["nope\tH\tX\tacre\t20\t\t\t3"])
    ok(e and "unknown key" in e[0], "unknown key refused")
    c, e = run(["combine-corn\tH\tX\tacre\t20\t\t\t3", "combine-corn\tH\tY\tacre\t21\t\t\t3"])
    ok(e and "used twice" in e[0], "key twice refused")
    c, e = run(["\tH\tX\tacre\t\t\t\t3"])
    ok(e and "average missing" in e[0], "missing average refused, never filled")
    c, e = run(["\tH\tX\tacre\t20\t\t\tmany"])
    ok(e and "whole number" in e[0], "count must be a number")
    c, e = run(["\tH\tHaul\tbushel\t18.8\t12.6\t25.1\t47\tcents"])
    ok(not e and c[0]["a"] == 0.188 and c[0]["hi"] == 0.251 and c[0]["p"] == "cents", "cents become dollars and stay marked: %s %s" % (c, e))
    c, e = run(["\tH\tX\tacre\t20\t\t\t3", "\tH\tX\tacre\t21\t\t\t4"])
    ok(e and "duplicate" in e[0], "duplicate row refused")
    c, e = run(["\tH\tX — y\tacre\t20\t\t\t3"])
    ok(e and "em dash" in e[0], "em dash refused")
    m, rows, e = parse_tsv(head.replace("minmax", "none") + "\n" + cols + "\n\tH\tX\tacre\t20\t10\t30\t3")
    c, e2 = validate(m, rows)
    ok(e2 and "spread none" in e2[0], "range on a no-range survey refused")
    ok(money(0.135, "bushel") == "$0.135" and money(0.2, "bushel") == "$0.20" and money(46.05, "acre") == "$46.05"
       and money(15005, "mile") == "$15,005", "money formats")
    d = {"state": "IA", "name": "Iowa", "survey_year": 2026, "survey": "S", "publisher": "P", "includes": "I",
         "rows": [{"s": "H", "o": "Corn combining", "u": "acre", "a": 46.05, "lo": 25.0, "hi": 80.0, "n": 119, "k": "combine-corn"}]}
    f = faq_for(d)
    ok("$46.05 per acre ($25.00 to $80.00, 119 answers)" in f[0][1] and "may charge more or less" in f[0][1], "faq states the survey numbers: %s" % f[0][1])
    ok(any("Nobody set them" in a for _, a in f), "faq says AGSIST did not set the rates")
    for st, nbs in BORDERS.items():
        for x in nbs.split():
            ok(st in BORDERS.get(x, "").split(), "borders symmetric %s-%s" % (st, x))
    # the real files build clean
    files, errs, docs = build()
    ok(not errs, "real sources build clean: %s" % errs[:5])
    idx = json.loads(files[os.path.join(OUT, "index.json")])
    ok(all(s["neighbors"] == [x for x in BORDERS[s["st"]].split() if x in docs] for s in idx["states"]), "neighbors are covered bordering states")
    ia = docs.get("IA")
    ok(ia and any(r["o"] == "Corn combining" and r["a"] == 46.05 and r["lo"] == 25 and r["hi"] == 80 and r["n"] == 119 for r in ia["rows"]),
       "Iowa 2026 corn combining is $46.05 ($25-$80, 119), as A3-10 page 3 prints it")
    print("selftest: %d failed" % len(fails))
    for x in fails:
        print("  FAIL", x)
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--verify-refs" in argv:
        bad = verify_refs()
        for b in bad:
            print("  ", b)
        print("verify-refs: %d problems" % len(bad))
        return 1 if bad else 0
    files, errs, docs = build()
    if errs:
        for e in errs:
            print("ERROR", e)
        return 1
    stale = []
    for path, body in sorted(files.items()):
        cur = open(path, encoding="utf-8").read() if os.path.exists(path) else None
        if cur != body:
            stale.append(os.path.relpath(path, ROOT))
            if "--check" not in argv:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(body)
    keep = {os.path.basename(p) for p in files if p.startswith(OUT + os.sep)}
    pkeep = {os.path.basename(p) for p in files if p.startswith(PAGES + os.sep)}
    for folder, kept in ((OUT, keep), (PAGES, pkeep)):
        if os.path.isdir(folder):
            for fn in os.listdir(folder):
                if fn not in kept:
                    stale.append(os.path.relpath(os.path.join(folder, fn), ROOT) + " (not built)")
    if "--check" in argv:
        if stale:
            print("stale (run python3 scripts/build_custom_rates.py):", ", ".join(stale))
            return 1
        print("custom rates: %d states, %d rows, up to date" % (len(docs), sum(len(d["rows"]) for d in docs.values())))
        return 0
    print("custom rates: %d states, %d rows; wrote %d files" % (len(docs), sum(len(d["rows"]) for d in docs.values()), len(stale)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
