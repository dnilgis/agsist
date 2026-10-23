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
        # A survey whose license forbids reposting (Missouri G302) is marked
        # "numbers_only" in its TSV: no copy is stored anywhere public, the typed
        # rows plus the page link and publication date are the record, and this
        # check skips it and says so. A survey that prints a median gets an "md" column, checked in printed order; a row the
        # survey printed as a median alone is printed=median-only (no average,
        # range or count, never in the comparison)
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

META_REQ = ("state", "name", "survey", "publisher", "survey_year", "collected", "url", "spread", "includes", "range_note")
SPREADS = {
    "minmax": "lowest to highest answer",
    "trimmed": "range without the single lowest and highest answer",
    "sd": "average plus and minus one standard deviation (about two thirds of answers)",
    "none": "no range printed",
    "mid80": "middle 80 percent of answers (the lowest and highest tenth left out)",
}
UNITS = {
    "acre", "hour", "bushel", "bale", "ton", "mile", "loaded mile", "point per bushel", "1,000 gallon",
    "foot", "foot of bag", "head", "head / day", "cwt", "gross bushel", "pivot", "metered hour",
    "bushel / month", "bushel / year", "bushel / round trip", "horsepower / hour", "hour / head row",
    "hour / foot of blade", "hour / foot of blower", "bale / loaded mile", "load weighed",
    "pound", "linear foot", "percent of crop", "gallon", "point", "sample", "hole", "hive", "plant",
}

# The jobs more than one survey prices, under one name, so the page can set
# states side by side and take the middle. Each state's own wording still shows.
# Grouped by the page's categories (Sig, Oct 23: categories on top, every kind of
# planter, drill and combine under its category), in the order the page lists them.
CATS = [("tillage", "Tillage"), ("planting", "Planting"), ("spray", "Spraying and fertilizing"),
        ("harvest", "Harvest"), ("hauling", "Hauling"), ("hay", "Hay and forage"),
        ("livestock", "Livestock"), ("other", "Other")]
CAT_NAME = dict(CATS)
KEYED = [
    ("tillage", [("chisel", "Chisel plow"), ("disk-chisel", "Disk-chisel"), ("moldboard", "Moldboard plow"),
                 ("subsoil", "Subsoil or rip"), ("strip-till", "Strip till"), ("vertical-till", "Vertical tillage"),
                 ("disk-tandem", "Tandem or finishing disk"), ("field-cult", "Field cultivate"),
                 ("cultivate-row", "Row cultivate"), ("rotary-hoe", "Rotary hoe"), ("land-roll", "Roll land"),
                 ("stalk-chop", "Chop stalks")]),
    ("planting", [("plant-row", "Planter, no fertilizer"), ("plant-row-fert", "Planter with fertilizer"),
                  ("plant-notill", "No-till planter, corn"), ("drill-soy", "Drill soybeans"),
                  ("drill-soy-notill", "No-till drill, soybeans"), ("drill-smallgrain", "Drill wheat or small grain"),
                  ("drill-cover", "Drill a cover crop")]),
    ("spray", [("spray-ground", "Spray, self-propelled or ground rig"), ("spray-tractor", "Spray, tractor and pull-type sprayer"),
               ("spray-aerial", "Spray by airplane"), ("spray-drone", "Spray by drone"),
               ("fert-dry", "Spread dry fertilizer"), ("fert-liquid", "Apply liquid fertilizer"),
               ("sidedress-liquid", "Side-dress liquid fertilizer"), ("nh3", "Apply anhydrous"),
               ("lime-ton", "Spread lime"), ("manure-solid-ton", "Spread solid manure"),
               ("manure-inject", "Inject liquid manure"), ("manure-dragline", "Liquid manure by drag hose")]),
    ("harvest", [("combine-corn", "Combine corn"), ("combine-soy", "Combine soybeans"),
                 ("combine-smallgrain", "Combine wheat or small grain"),
                 ("harvest-haul-corn", "Corn: combine, cart and haul home"),
                 ("harvest-haul-soy", "Soybeans: combine, cart and haul home"),
                 ("harvest-haul-smallgrain", "Wheat: combine, cart and haul home"),
                 ("grain-cart", "Grain cart"), ("dry-corn-pt", "Dry corn")]),
    ("hauling", [("haul-grain-bu", "Haul grain by truck")]),
    ("hay", [("mow-hay", "Mow hay"), ("mow-cond", "Mow and condition hay"), ("swath", "Swath"),
             ("rake", "Rake hay"), ("ted", "Ted hay"), ("merge-hay", "Merge windrows"),
             ("bale-smallsq", "Bale small squares"), ("bale-largesq", "Bale large squares"),
             ("bale-round", "Bale round bales"), ("bale-round-net", "Bale round bales, net wrap"),
             ("silage-chop-ton", "Chop silage"), ("tub-grind", "Tub grind hay")]),
    ("livestock", [("haul-cattle-semi", "Haul cattle by semi")]),
    ("other", [("custom-farm-corn", "Custom farm corn, every trip"), ("custom-farm-soy", "Custom farm soybeans, every trip"),
               ("mow-crp", "Mow CRP or pasture"), ("skid-rent", "Rent a skid loader"), ("backhoe", "Backhoe"),
               ("store-bin-month", "Store grain in a bin")]),
]
KEYS = {k: lab for _, ks in KEYED for k, lab in ks}
KEY_CAT = {k: c for c, ks in KEYED for k, _ in ks}

# Every other row goes to a category by its own words (first rule that fits), then
# by its survey section. A few sections decide first (silage hauling is forage
# work). Order matters: "hauling cattle" is livestock, "grain cart" is harvest,
# "hauling liquid manure" is fertilizing, "bale and haul" is hay.
SEC_FIRST = [("hay", r"^silage|corn silage"), ("other", r"labor|wages|full-service|machinery and operator|custom contract|custom farming"),
             ("planting", r"^grain planting|^planting|^row crop planting|^small grain seeding|^drilling")]
CAT_RULES = [
    ("livestock", r"cattle|livestock|calves|pregnan|worming|\bhogs?\b"),
    ("other", r"custom farming|lawn|fence|brush|\bmow\w* (pasture|grass|crp)|controlled burning|storage charge|elevator storage|bin rental|grain bin storage|tiling|\btile\b|drainage|excavator|track hoe|backhoe"),
    ("tillage", r"strip till|cultivat"),
    ("harvest", r"grain cart|combin|swathing (grain|canola)"),
    ("spray", r"manure"),
    ("hay", r"\bbal(e|ed|es|ing)\b|bailing|silage|\bmow"),
    ("hauling", r"haul|truck|semi\b|loaded mile|over base|extra charge per 10 miles|\d+ or more miles"),
    ("planting", r"plant|drill|seed|seeding"),
    ("hay", r"\bhay\b|forage|windrow|swath|\brak(e|ing)\b|\btedd?(ing)?\b|merg|earlage|snaplage|stover"),
    ("spray", r"spray|herbicide|fungicide|insecticide|pesticide|fertili[sz]|anhydrous|\blime\b|nitrogen|side-?dress|chemical|aerial|drone|\buav\b|electrocution|selective targeting|ditches"),
    ("harvest", r"harvest|dry(ing)?\b|moisture|corn head|soybean head|header|sorghum|sunflower|ear corn"),
    ("tillage", r"till|disk|disc(ing)?\b|chisel|plow|rip(per|ping)?\b|subsoil|hoe|roll(ing)?\b|stalk|rock picking|finishing|sweeps|harrow|cultipack|undercutter"),
]
SEC_RULES = [
    ("hauling", r"^haul"), ("hay", r"hay|forage|silage"), ("livestock", r"livestock|cattle"),
    ("spray", r"spray|fertili|chemical|pesticide|aerial|weed|manure"), ("planting", r"plant|drill|seed"),
    ("harvest", r"harvest|combin|dry"), ("hauling", r"haul"), ("tillage", r"till|soil prep|land prep"),
]
UNIT_CAT = {"head": "livestock", "head / day": "livestock"}


def category(sec, op, key=None, unit=""):
    """The page category for one survey row. Keyed rows follow their key; the rest go by their words."""
    if key:
        return KEY_CAT[key]
    if unit in UNIT_CAT:
        return UNIT_CAT[unit]
    o, s = op.lower(), sec.lower()
    for c, rx in SEC_FIRST:
        if re.search(rx, s):
            return c
    for c, rx in CAT_RULES:
        if re.search(rx, o):
            return c
    for c, rx in SEC_RULES:
        if re.search(rx, s):
            return c
    return "other"


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
UNIT_LABEL = {"point": "point of moisture", "1,000 gallon": "1,000 gallons", "head / day": "head a day", "bushel / month": "bushel a month",
              "bushel / year": "bushel a year", "bushel / round trip": "bushel, round trip",
              "horsepower / hour": "horsepower-hour", "hour / head row": "hour per row of head",
              "hour / foot of blade": "hour per foot of blade", "hour / foot of blower": "hour per foot of blower",
              "bale / loaded mile": "bale per loaded mile", "point per bushel": "bushel per point"}
# A survey's "median only" rows (Missouri G302 Table 9: too few answers to print an
# average, range or count; the guide calls them anecdotal)
MEDIAN_ONLY = "median-only"


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
    if meta.get("rate_year") and not re.fullmatch(r"20\d\d", meta["rate_year"]):
        errs.append("%s: rate_year must be a year" % where)
    for u in ("url", "url2"):
        if meta.get(u) and not meta[u].startswith("https://"):
            errs.append("%s: %s must be https" % (where, u))
    if meta.get("numbers_only"):
        # no stored copy may exist (the publisher forbids reposting): the record is the link,
        # the publication date and the typed rows
        if meta.get("ref") or meta.get("ref2"):
            errs.append("%s: a numbers_only source keeps no saved copy (drop ref)" % where)
        if not re.fullmatch(r"20\d\d-\d\d(-\d\d)?", meta.get("published", "")):
            errs.append("%s: numbers_only needs published: YYYY-MM" % where)
    elif not meta.get("ref") and not meta.get("src_pdf"):
        # src_pdf: a survey copy Sig downloaded that is not on the references branch yet; --verify-refs
        # reads it from CR_SRC_DIR (never committed to this repo)
        errs.append("%s: missing meta ref" % where)
    for k, v in meta.items():
        if "—" in v:
            errs.append("%s: em dash in %s" % (where, k))
    out, seen_keys, seen_rows = [], set(), set()
    for r in rows:
        at = "%s:%d" % (where, r["_line"])
        try:
            avg, lo, hi, md = num(r["avg"]), num(r["lo"]), num(r["hi"]), num(r.get("md", ""))
        except ValueError as e:
            errs.append("%s: %s" % (at, e))
            continue
        printed = r.get("printed", "").strip()
        if printed not in ("", "cents", MEDIAN_ONLY):
            errs.append("%s: printed must be blank, cents or %s" % (at, MEDIAN_ONLY))
            continue
        if printed == MEDIAN_ONLY:
            # the survey printed a median and nothing else: no average, range or count is made up
            if md is None or md <= 0:
                errs.append("%s: a median-only row needs its median" % at)
                continue
            if avg is not None or lo is not None or hi is not None or r["n"].strip():
                errs.append("%s: a median-only row carries no average, range or count" % at)
                continue
            if r["key"].strip():
                errs.append("%s: a median-only row never goes in the comparison" % at)
                continue
            n = None
        else:
            if meta.get("counts") == "none":
                # the survey does not print how many answered each job: nothing is made up
                if r["n"].strip():
                    errs.append("%s: counts none, but the row has a count" % at)
                    continue
                n = None
            elif not re.fullmatch(r"\d+", r["n"].strip()):
                errs.append("%s: n must be a whole number" % at)
                continue
            else:
                n = int(r["n"])
            if avg is None or avg <= 0:
                errs.append("%s: average missing" % at)
                continue
            if (lo is None) != (hi is None):
                errs.append("%s: range needs both ends" % at)
                continue
            if lo is not None and not (lo <= avg <= hi):
                errs.append("%s: average %s outside its range %s-%s" % (at, avg, lo, hi))
                continue
            if md is not None and lo is not None and not (lo <= md <= hi):
                errs.append("%s: median %s outside its range %s-%s" % (at, md, lo, hi))
                continue
            if lo is not None and meta.get("spread") == "none":
                errs.append("%s: a range on a survey marked spread none" % at)
                continue
            if n is not None and n < 1:
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
        if printed == MEDIAN_ONLY:
            row = {"s": sec, "o": op, "u": u, "md": round(md * scale, 4)}
        else:
            row = {"s": sec, "o": op, "u": u, "a": round(avg * scale, 4)}
            if n is not None:
                row["n"] = n
            if md is not None:
                row["md"] = round(md * scale, 4)
        if lo is not None:
            row["lo"], row["hi"] = round(lo * scale, 4), round(hi * scale, 4)
        if key:
            row["k"] = key
        row["c"] = category(sec, op, key, u)
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
        region = meta.get("states", "").split()
        if region:
            # one survey for two or more states (Maryland and Delaware): each state reads it, it counts once
            if region[0] != st or any(x not in STATE_NAMES for x in region):
                errs.append("%s: states %r must start with %s and be state codes" % (where, region, st))
            if meta.get("name") != " and ".join(STATE_NAMES[x] for x in region if x in STATE_NAMES):
                errs.append("%s: name %r is not the region's states" % (where, meta.get("name")))
        elif STATE_NAMES.get(st) != meta.get("name"):
            errs.append("%s: name %r is not %s's name" % (where, meta.get("name"), st))
        states[st] = (meta, clean, rows)
    return states, errs


def state_doc(meta, rows):
    srcs = [{"url": meta["url"], "numbers_only": True, "published": meta["published"]} if meta.get("numbers_only")
            else {"url": meta["url"], "ref": meta["ref"]} if meta.get("ref") else {"url": meta["url"]}]
    if meta.get("url2"):
        srcs.append({"url": meta["url2"], "ref": meta.get("ref2", "")})
    d = {"state": meta["state"], "name": meta["name"], "slug": slug(meta["name"]), "survey": meta["survey"],
         "publisher": meta["publisher"], "survey_year": int(meta["survey_year"]), "collected": meta["collected"],
         "sources": srcs, "spread": meta["spread"], "spread_label": SPREADS[meta["spread"]],
         "includes": meta["includes"], "range_note": meta["range_note"], "rows": rows,
         "counts": meta.get("counts") != "none", "page": meta.get("page") != "none"}
    if meta.get("states"):
        d["states"] = meta["states"].split()
    if meta.get("withheld"):
        d["withheld"] = meta["withheld"]
    # rate_year: the year the rates were charged, when a survey says it is not its own year
    # (Missouri's G302 revised March 2026 asked fall 2025 to winter 2026 about 2025 rates;
    # the April 2023 guide before it was 2022 rates; money audit 6, 2026-10-19)
    if meta.get("rate_year"):
        d["rate_year"] = int(meta["rate_year"])
    return d


def state_href(s):
    return "/custom-rates/" + s["slug"] if s.get("page", True) else "/custom-rates?st=" + s["st"]


def year_label(s):
    """How a state's year reads beside a rate: '2022 rates' when the survey names the rate year, else its survey year."""
    return "%d rates" % s["rate_year"] if s.get("rate_year") else "%d" % s["year"]


def index_doc(docs):
    covered = sorted(docs)
    states = []
    for st in covered:
        d = docs[st]
        region = d.get("states", [st])
        nb = sorted({x for r in region for x in BORDERS.get(r, "").split() if x in docs and x not in region})
        states.append({"st": st, "name": d["name"], "slug": d["slug"], "year": d["survey_year"],
                       **({"rate_year": d["rate_year"], "yl": "%d rates" % d["rate_year"]} if d.get("rate_year") else {}),
                       "survey": d["survey"], "publisher": d["publisher"], "url": d["sources"][0]["url"],
                       "rows": len(d["rows"]), "spread": d["spread"], "neighbors": nb, "page": d["page"],
                       **({"states": d["states"]} if d.get("states") else {})})
    common = {}
    for st in covered:
        for r in docs[st]["rows"]:
            if "k" in r:
                c = [r["a"], r["u"], r.get("lo"), r.get("hi"), r.get("n"), r["o"]]
                common.setdefault(r["k"], {})[st] = c
    return {"note": "Custom farm work rates as each state survey published them. Built by scripts/build_custom_rates.py from scripts/custom_rates/*.tsv; every number is from the survey named in its state file.",
            "built": STAMP, "states": states, "keys": KEYS, "common": common,
            "borders": {st: [x for x in BORDERS.get(st, "").split()] for st in sorted(BORDERS)},
            "names": STATE_NAMES,
            "not_covered": NOT_COVERED}


# The going rate. For each job more than one survey prices: the middle of the
# state surveys' own averages, the lowest and highest of those averages, and how
# many surveys. Each state counts once (no weighting by answers); a state's
# number is its survey's average as printed (Missouri also prints a median; the
# average is used so every state is read the same way). Nothing is inflated or
# adjusted. A survey whose rate year is more than AGE_MAX years behind the
# newest survey is shown with its year but left out of the middle (the rent
# tiles' rule, Sig Oct 19). Rows in a different unit from the job's usual unit
# are shown beside it, never mixed in. Fewer than MIN_BLEND surveys: no middle,
# each number shown on its own.
AGE_MAX = 3
MIN_BLEND = 3


def rate_year(d):
    return d.get("rate_year") or d["survey_year"]


def median(vals):
    v = sorted(vals)
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


DIY = os.path.join(SRC, "diy")


def load_diy(src_dir=DIY):
    """Machinery cost estimates: what owning and running the machine costs, never a rate charged. Shown
    beside the going rate as "do it yourself", never in the middle. One file per source in scripts/custom_rates/diy/."""
    out, errs = [], []
    if not os.path.isdir(src_dir):
        return out, errs
    for fn in sorted(os.listdir(src_dir)):
        if not fn.endswith(".tsv"):
            continue
        meta, rows, cols = {}, {}, None
        for i, line in enumerate(open(os.path.join(src_dir, fn), encoding="utf-8").read().splitlines(), 1):
            if not line.strip():
                continue
            if line.startswith("#"):
                m = re.match(r"#\s*([a-z_]+):\s*(.*)$", line)
                if m:
                    meta[m.group(1)] = m.group(2).strip()
                continue
            f = line.split("\t")
            if cols is None:
                cols = f
                continue
            r = dict(zip(cols, f))
            k = r.get("key", "")
            if k not in KEYS or k in rows:
                errs.append("diy/%s:%d: unknown or repeated key %r" % (fn, i, k))
                continue
            try:
                rows[k] = [num(r["cost"]), r["unit"], r["operation"]]
            except (ValueError, KeyError):
                errs.append("diy/%s:%d: cost must be a number" % (fn, i))
        for kk in ("name", "what", "publisher", "published", "basis", "files"):
            if not meta.get(kk):
                errs.append("diy/%s: missing meta %s" % (fn, kk))
        if "\u2014" in json.dumps(meta) + json.dumps(rows):
            errs.append("diy/%s: em dash" % fn)
        out.append((fn, meta, rows))
    return out, errs


def blend_doc(docs, idx):
    newest = max(rate_year(d) for d in docs.values())
    cutoff = newest - AGE_MAX
    ops, cats = {}, []
    for cat, ks in KEYED:
        keep = []
        for k, label in ks:
            ent = [(st, r) for st in sorted(docs) for r in docs[st]["rows"] if r.get("k") == k]
            if not ent:
                continue
            count = {}
            for _, r in ent:
                count[r["u"]] = count.get(r["u"], 0) + 1
            unit = sorted(count, key=lambda u: (-count[u], u))[0]
            by, other, old = {}, {}, {}
            for st, r in ent:
                v = [r["a"], r.get("lo"), r.get("hi"), r.get("n"), r["o"]]
                if r["u"] != unit:
                    other[st] = v + [r["u"]]
                elif rate_year(docs[st]) < cutoff:
                    old[st] = v
                else:
                    by[st] = v
            vals = [v[0] for v in by.values()]
            op = {"label": label, "cat": cat, "u": unit, "n": len(vals), "by": by}
            if vals:
                yrs = [rate_year(docs[st]) for st in by]
                op["y"] = [min(yrs), max(yrs)]
                op["ans"] = sum(v[3] for v in by.values() if v[3])
            if len(vals) >= MIN_BLEND:
                op["md"] = round(median(vals), 4)
            if len(vals) >= 2:
                op["lo"], op["hi"] = min(vals), max(vals)
            if other:
                op["other"] = other
            if old:
                op["old"] = old
            ops[k] = op
            keep.append(k)
        cats.append([cat, CAT_NAME[cat], keep])
    states = {}
    for s in idx["states"]:
        d = docs[s["st"]]
        states[s["st"]] = {"name": s["name"], "slug": s["slug"], "year": s["year"], "ry": rate_year(d),
                           "survey": s["survey"], "publisher": s["publisher"], "url": s["url"], "spread": s["spread"],
                           "neighbors": s["neighbors"], "rows": s["rows"], "in_blend": rate_year(d) >= cutoff,
                           "page": d["page"], "counts": d["counts"],
                           "by_cat": {c: sum(1 for r in d["rows"] if r["c"] == c) for c, _ in CATS}}
        # a state that shares a survey (Delaware reads the Maryland and Delaware survey)
        for x in d.get("states", [])[1:]:
            states[x] = {"same_as": s["st"], "name": STATE_NAMES[x]}
    diy_list, _ = load_diy()
    diy = []
    for fn, meta, rows in diy_list:
        # a cost only shows beside a job in the same unit as the going rate
        keep = {k: v for k, v in rows.items() if k in ops and ops[k]["u"] == v[1]}
        diy.append({"name": meta["name"], "what": meta["what"], "publisher": meta["publisher"], "published": meta["published"],
                    "basis": meta["basis"], "ops": keep})
    return {"note": "The going rate for custom farm work: for each job, the middle of the state surveys' own averages, with the lowest and highest of them and the number of surveys. Built by scripts/build_custom_rates.py from the same survey rows as each state file (data/custom-rates/<st>.json). Each state counts once; nothing is inflated or adjusted.",
            "built": STAMP,
            "rule": {"middle": "median of the state survey averages", "min_surveys": MIN_BLEND, "age_max": AGE_MAX,
                     "newest": newest, "oldest_in_middle": cutoff,
                     "words": "Each state counts once. A survey of rates from before %d is shown but left out of the middle. A job needs %d surveys for a middle; with fewer, each number stands on its own." % (cutoff, MIN_BLEND)},
            "cats": cats, "states": states, "ops": ops, "diy": diy, "names": STATE_NAMES, "borders": idx["borders"],
            "not_covered": NOT_COVERED}


def money(v, unit):
    if v is None:
        return ""
    if unit == "percent of crop":
        return ("%.2f" % v).rstrip("0").rstrip(".") + "%"
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
    if u == "percent of crop":
        return "of the crop"
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
            if r.get("p") == MEDIAN_ONLY:
                body.append('<tr><th scope="row">%s</th><td class="av"><span class="na">no average printed</span><span class="mdn">median %s %s, few answers</span></td><td class="rg">not printed</td><td><span class="na">not printed</span></td></tr>' % (
                    esc(r["o"]), money(r["md"], r["u"]), esc(unit_label(r["u"]))))
                continue
            rg = range_text(r, r["u"])
            mdn = ('<span class="mdn">median %s</span>' % money(r["md"], r["u"])) if "md" in r else ""
            body.append('<tr><th scope="row">%s%s</th><td class="av">%s <small>%s</small>%s<span class="rgm">%s</span></td><td class="rg">%s</td><td>%d</td></tr>' % (
                esc(r["o"]), note, money(r["a"], r["u"]), esc(unit_label(r["u"])), mdn, ("range " + rg) if "lo" in r else "", rg, r["n"]))
    me = next(s for s in idx["states"] if s["st"] == st)
    nb = ", ".join('<a href="%s">%s (%s)</a>' % (state_href(s), esc(s["name"]), year_label(s)) for s in idx["states"] if s["st"] in me["neighbors"])
    others = " &middot; ".join('<a href="%s">%s</a>' % (state_href(s), esc(s["name"])) for s in idx["states"] if s["st"] != st)
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
  <link rel="stylesheet" href="/components/styles.css?v=26">
  <link rel="stylesheet" href="/components/custom-rates.css?v=4">
  <link rel="icon" href="/img/favicon.ico" sizes="32x32">
  <link rel="icon" type="image/svg+xml" href="/img/icon.svg">
  <script type="application/ld+json">{ld}</script>
</head>
<body>
  <a href="#main" class="skip">Skip to content</a>
  <div id="site-header"></div>
  <main id="main" tabindex="-1">
    <article class="cr">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> &rarr; <a href="/custom-rates">Custom rates</a> &rarr; {name}</nav>
      <h1>{name} custom rates, {yr} survey{ofr}</h1>
      <p class="by">Numbers from {pub}</p>
      <p class="cr-lede">What farmers and custom operators in {name} said they charged or paid for custom work, as the {survey} printed it. Rates are survey averages; your local custom operator may charge more or less.</p>
      <p class="cr-actions"><a class="cr-btn go" href="/custom-rates?st={st}">Search jobs and compare neighbors</a></p>
      <div class="cr-tw"><table class="cr-t cr-full">
        <caption>{name}, {capyr}: average{med} and {spread} for each job. Answers = how many reported that job.</caption>
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
  <p class="by-end" style="font-size:.78rem;color:var(--text-muted);margin:1.2rem 0 .4rem">Made by <a href="/about">Sigurd Lindquist, CCA</a>, Chetek, Wisconsin.</p>
</main>
  <div id="site-footer"></div>
  <script src="/components/loader.js?v=19" defer></script>
</body>
</html>
""".format(og=og_image(), title=esc(title), desc=esc(desc), url=url, ogt=esc("%s custom rates, %d survey" % (name, yr)),
           ld=json.dumps(ld, separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/"), name=esc(name), yr=yr,
           pub=esc(d["publisher"]), survey=esc(d["survey"]), st=st, spread=esc(d["spread_label"]),
           body="\n".join(body), collected=esc(d["collected"].rstrip(".")), includes=esc(d["includes"]),
           range_note=esc(d["range_note"]), withheld=withheld, med=", median" if any("md" in r for r in d["rows"]) else "",
           ofr=(" of %d rates" % d["rate_year"]) if d.get("rate_year") else "",
           capyr=("%d rates" % d["rate_year"]) if d.get("rate_year") else yr, srcl=srcl, nb=nb or "none yet",
           faq=faq_html, others=others)


LD_RE = re.compile(r"(<!-- cr:ld \(scripts/build_custom_rates.py\) -->)(.*?)(<!-- /cr:ld -->)", re.S)
FAQ_RE = re.compile(r"(<!-- cr:faq \(scripts/build_custom_rates.py\) -->)(.*?)(<!-- /cr:faq -->)", re.S)


def faq_main(docs, idx):
    def line(k):
        out = []
        for s in idx["states"]:
            r = next((x for x in docs[s["st"]]["rows"] if x.get("k") == k), None)
            if r:
                out.append("%s %s (%s%d survey, %s)" % (s["name"], money(r["a"], r["u"]), ("%d rates, " % s["rate_year"]) if s.get("rate_year") else "", s["year"], ("%d answers" % r["n"]) if r.get("n") else "answers not printed"))
        return out
    names = ", ".join("%s (%s)" % (s["name"], year_label(s)) for s in idx["states"])
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


def short_unit(u):
    return {"acre": "an acre", "hour": "an hour", "bushel": "a bushel", "bale": "a bale", "ton": "a ton",
            "mile": "a mile", "loaded mile": "a loaded mile", "1,000 gallon": "per 1,000 gallons",
            "point per bushel": "a bushel a point", "bushel / month": "a bushel a month"}.get(u, unit_label(u))


def yr_span(y):
    return "%d rates" % y[0] if y[0] == y[1] else "%d to %d rates" % (y[0], y[1])


def bar_html(op, cls="crb"):
    """The range bar: zero at the left; the band is the lowest to highest state average; a dot per
    state; the tick is the middle. Drawn from the numbers only, so it says nothing the row does not."""
    vals = [v[0] for v in op["by"].values()]
    if not vals:
        return ""
    top = max(vals) * 1.15
    pc = lambda v: "%d" % round(100.0 * v / top)
    out = ['<span class="%s" aria-hidden="true">' % cls]
    if len(vals) >= 2:
        out.append('<s style="left:%s%%;width:%s%%"></s>' % (pc(min(vals)), "%d" % round(100.0 * (max(vals) - min(vals)) / top)))
    # one dot per state, in state-code order (the page script reads them in that order)
    out.extend('<i style="left:%s%%"></i>' % pc(op["by"][st][0]) for st in sorted(op["by"]))
    if "md" in op:
        out.append('<b style="left:%s%%"></b>' % pc(op["md"]))
    out.append("</span>")
    return "".join(out)


def rate_cells(op):
    """(big number, the line under it) for one job, in words that hold for any number of surveys."""
    u, n = op["u"], op["n"]
    if "md" in op:
        return money(op["md"], u), "middle of %d surveys" % n
    if n == 2:
        return "%s to %s" % (money(op["lo"], u), money(op["hi"], u)), "2 surveys, too few for a middle"
    if n == 1:
        st = next(iter(op["by"]))
        return money(op["by"][st][0], u), "%s only" % STATE_NAMES[st]
    return "", "not in a current survey"


def hero_block(b, k="combine-corn"):
    op = b["ops"][k]
    big, under = rate_cells(op)
    u = op["u"]
    rng = ("States run %s to %s %s." % (money(op["lo"], u), money(op["hi"], u), short_unit(u))) if "lo" in op else ""
    who = ", ".join("%s %s" % (b["states"][st]["name"], money(v[0], u)) for st, v in sorted(op["by"].items(), key=lambda x: -x[1][0]))
    return ('<p class="crh-k" id="cr-ak">%s <small>%s</small></p>\n'
            '<p class="crh-v"><b id="cr-av">%s</b> <small id="cr-au">%s</small></p>\n'
            '<p class="crh-s" id="cr-as">The %s across %d state surveys (%s). %s</p>\n'
            '%s\n'
            '<p class="crh-key">Each dot is a state survey\'s average, the dark line is the middle, and your state is the gold dot. The bar starts at zero.</p>\n'
            '<p class="crh-me" id="cr-me">%s.</p>\n'
            '<p class="crh-cost" id="cr-cost"></p>\n') % (
        esc(op["label"]), esc(unit_label(u)), big, esc(short_unit(u)),
        "middle" if "md" in op else "rate", op["n"], yr_span(op["y"]), rng,
        bar_html(op, "crb crb-l"), esc(who))


def nav_block(b):
    return "\n".join('        <a href="#%s">%s <small>%d</small></a>' % (c, esc(name), len(ks)) for c, name, ks in b["cats"] if ks)


def cats_block(b, docs):
    out = []
    for c, name, ks in b["cats"]:
        lines = sum(1 for d in docs.values() for r in d["rows"] if r.get("c") == c)
        rows = []
        for k in ks:
            op = b["ops"][k]
            big, under = rate_cells(op)
            u = op["u"]
            rng = ("%s to %s" % (money(op["lo"], u), money(op["hi"], u))) if ("lo" in op and "md" in op) else ""
            rows.append(
                '<li class="cro" id="%s"><button type="button" class="cro-b" aria-expanded="false">'
                '<span class="cro-n">%s <small>%s</small></span>'
                '<span class="cro-v"><b>%s</b> <small>%s</small></span>'
                '%s'
                '<span class="cro-r">%s<small>%s</small></span>'
                '</button><div class="cro-d" hidden></div></li>' % (
                    k, esc(op["label"]), esc(unit_label(u)), big, esc(under), bar_html(op),
                    ("states run " + rng) if rng else "", " %s" % yr_span(op["y"]) if op.get("y") else ""))
        out.append(
            '<section class="crc" id="%s" data-cat="%s">\n<h2 class="crc-h"><button type="button" class="crc-t" aria-expanded="true"><span class="crc-tt">%s<span class="crc-p">%s</span></span><small>%d job%s</small></button></h2>\n'
            '<ul class="cro-l">\n%s\n</ul>\n<div class="crc-st" data-cat="%s" data-lines="%d"></div>\n</section>' % (
                c, c, esc(name), esc(", ".join(b["ops"][k]["label"] for k in ks)), len(ks), "" if len(ks) == 1 else "s", "\n".join(rows), c, lines))
    return "\n".join(out)


def how_block(b, docs):
    r = b["rule"]
    inb = [s for s in b["states"].values() if s.get("in_blend")]
    li = "".join('<li><a href="%s">%s</a>, %s: %s, %s. <a href="%s" rel="nofollow">The survey</a>.%s</li>\n' % (
        state_href(dict(s, st=st)), esc(s["name"]), ("%d rates" % s["ry"]) if s["ry"] != s["year"] else s["year"], esc(s["survey"]), esc(s["publisher"]), esc(s["url"]),
        "" if s["in_blend"] else " Too old for the middle; shown with its year.") for st, s in b["states"].items() if not s.get("same_as"))
    return ('<p>For each job I take each state survey\'s own average, as the survey printed it, and show the middle one. Half the states sit at or above it, half at or below. Under it you get the lowest and highest of the state averages and how many surveys priced the job. Tap a job and every state\'s number is there with its year, how many answered, and the lowest and highest answer that survey printed.</p>\n'
            '<p>Each state counts once, however many people answered. I don\'t inflate older surveys or adjust anything. A survey of rates from before %d is shown with its year but kept out of the middle. A job needs %d surveys before I give a middle; with fewer, each number stands on its own. Surveys word jobs their own way (combine only, or combine, cart and haul), so I only line up jobs that read the same, and each state\'s wording is under its number.</p>\n'
            '<p>%d surveys, %s. Read the data: <a href="/data/custom-rates/blend.json">blend.json</a> (the going rates), <a href="/data/custom-rates/index.json">index.json</a> and one file per state beside it.</p>\n'
            '<ul class="srcs">\n%s</ul>\n<p class="fine">Not here yet: %s</p>\n') % (
        r["oldest_in_middle"], r["min_surveys"], len(inb), yr_span([min(s["ry"] for s in inb), max(s["ry"] for s in inb)]),
        li, " ".join(esc(NOT_COVERED[k]) for k in sorted(NOT_COVERED)))


HERO_RE = re.compile(r"(<!-- cr:hero \(scripts/build_custom_rates.py\) -->)(.*?)(<!-- /cr:hero -->)", re.S)
NAV_RE = re.compile(r"(<!-- cr:nav \(scripts/build_custom_rates.py\) -->)(.*?)(<!-- /cr:nav -->)", re.S)
CATS_RE = re.compile(r"(<!-- cr:cats \(scripts/build_custom_rates.py\) -->)(.*?)(<!-- /cr:cats -->)", re.S)
HOW_RE = re.compile(r"(<!-- cr:how \(scripts/build_custom_rates.py\) -->)(.*?)(<!-- /cr:how -->)", re.S)


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
        rows.append('<tr><th scope="row"><a href="%s">%s</a> <small>%s</small></th>%s</tr>' % (state_href(s), esc(s["name"]), year_label(s), "".join(cells)))
    return ("\n      <div class=\"cr-tw\"><table class=\"cr-t cr-sum\">\n        <caption>Four common jobs, each state survey\'s average.</caption>\n"
            "        <thead><tr><th scope=\"col\">State, survey year</th><th scope=\"col\">Combine corn</th><th scope=\"col\">Combine soybeans</th><th scope=\"col\">Plant, no fertilizer</th><th scope=\"col\">Spray, ground</th></tr></thead>\n"
            "        <tbody>\n        " + "\n        ".join(rows) + "\n        </tbody>\n      </table></div>\n"
            "      <p class=\"fine\">Each state's own survey average, the year it covers, and its whole table on the state's page. The surveys and their links are under How I figure the going rate.</p>\n      ")


def build(src_dir=SRC):
    states, errs = load_states(src_dir)
    errs += load_diy()[1]
    docs = {st: state_doc(m, rows) for st, (m, rows, _) in states.items()}
    idx = index_doc(docs) if docs else None
    files = {}
    for st, d in docs.items():
        files[os.path.join(OUT, st.lower() + ".json")] = json.dumps(d, indent=1, ensure_ascii=False) + "\n"
        if not d["page"]:
            continue
        page = state_page(d, idx)
        if "—" in page:
            errs.append("%s page: em dash" % st)
        if len(page.encode()) > PAGE_KB * 1024:
            errs.append("%s page: %d KB, over %d" % (st, len(page.encode()) // 1024, PAGE_KB))
        files[os.path.join(PAGES, d["slug"] + ".html")] = page
    blend = blend_doc(docs, idx) if docs else None
    if idx:
        files[os.path.join(OUT, "index.json")] = json.dumps(idx, separators=(",", ":"), ensure_ascii=False) + "\n"
        files[os.path.join(OUT, "blend.json")] = json.dumps(blend, separators=(",", ":"), ensure_ascii=False) + "\n"
        if os.path.exists(MAIN):
            main = open(MAIN, encoding="utf-8").read()
            if not SUM_RE.search(main):
                errs.append("custom-rates.html: no cr:summary markers")
            else:
                main = SUM_RE.sub(lambda m: m.group(1) + summary_block(docs, idx) + m.group(3), main, count=1)
                for rx, body in ((HERO_RE, "\n" + hero_block(blend)), (NAV_RE, "\n" + nav_block(blend) + "\n"),
                                 (CATS_RE, "\n" + cats_block(blend, docs) + "\n"), (HOW_RE, "\n" + how_block(blend, docs))):
                    if not rx.search(main):
                        errs.append("custom-rates.html: no marker %s" % rx.pattern[:20])
                    main = rx.sub(lambda m, body=body: m.group(1) + body + m.group(3), main, count=1)
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
    rev = "origin/references"
    # CR_REFS_GIT: a clone that holds the current references branch (the private repo), when this
    # checkout's origin/references is the old public copy
    repo = os.environ.get("CR_REFS_GIT") or ROOT

    def text(ref, how=None):
        key = (ref, how)
        if key not in cache:
            try:
                if how == "pdf":
                    # the saved .txt clips the last column of some PDFs (Pennsylvania 2022): read the PDF itself
                    import tempfile
                    raw = subprocess.run(["git", "-C", repo, "show", "%s:refs/%s.pdf" % (rev, ref)], capture_output=True, check=True).stdout
                    with tempfile.NamedTemporaryFile(suffix=".pdf") as fh:
                        fh.write(raw)
                        fh.flush()
                        cache[key] = subprocess.run(["pdftotext", "-layout", fh.name, "-"], capture_output=True, check=True).stdout.decode("utf-8", "replace")
                else:
                    cache[key] = subprocess.run(["git", "-C", repo, "show", "%s:refs/%s.txt" % (rev, ref)],
                                                capture_output=True, check=True).stdout.decode("utf-8", "replace")
            except (subprocess.CalledProcessError, FileNotFoundError):
                cache[key] = None
        return cache[key]

    def toks(s):
        s = re.sub(r"(\d+\.\d)\s(\d)\b", r"\1\2", s)  # Purdue's text layer splits "9.4 0"
        s = s.replace(",", "").replace("$", "")
        out = set()
        for t in re.findall(r"\d+(?:\.\d+)?", s):
            out.add(float(t))
        return out

    def seq(s):
        s = s.replace(",", "").replace("$", "")
        return [float(t) for t in re.findall(r"\d+(?:\.\d+)?", s)]

    def in_order(want, got):
        it = iter(got)
        return all(any(w == g for g in it) for w in want)

    for st, (meta, clean, raw) in sorted(states.items()):
        if meta.get("numbers_only"):
            mo = sum(1 for r in raw if r.get("printed", "").strip() == MEDIAN_ONLY)
            print("  %s: skipped, numbers-only source (%s); %d rows typed from %s (%d full, %d median only), published %s, no stored copy to compare" % (
                st, meta["numbers_only"], len(raw), meta["url"], len(raw) - mo, mo, meta["published"]))
            continue
        lines, raws, seqs = {}, {}, {}
        how = meta.get("verify")
        if meta.get("src_pdf") and not meta.get("ref"):
            sd = os.environ.get("CR_SRC_DIR", "")
            fp = os.path.join(sd, meta["src_pdf"]) if sd else ""
            if not fp or not os.path.exists(fp):
                print("  %s: skipped, %s is not on the references branch yet; set CR_SRC_DIR to the folder that holds it" % (st, meta["src_pdf"]))
                continue
            try:
                cache[(meta["src_pdf"], "src")] = subprocess.run(["pdftotext", "-layout", fp, "-"], capture_output=True, check=True).stdout.decode("utf-8", "replace")
            except (subprocess.CalledProcessError, FileNotFoundError):
                bad.append("%s: could not read %s" % (st, fp))
                continue
            meta = dict(meta, ref=meta["src_pdf"])
            how = "src"
        for k in ("ref", "ref2"):
            if meta.get(k):
                t = text(meta[k], how)
                if t is not None and how == "window":
                    # the saved page prints each number on its own line (Maryland and Delaware's table):
                    # join each line with the four after it, so a row's name and its numbers sit together
                    ls = [l for l in t.splitlines() if l.strip()]
                    t = "\n".join(" ".join(ls[i:i + 5]) for i in range(len(ls)))
                if t is None:
                    bad.append("%s: refs/%s.txt is not on %s (bash scripts/fetch_private.sh references)" % (st, meta[k], rev))
                    lines[k], raws[k] = [], []
                else:
                    lines[k] = [toks(l) for l in t.splitlines()]
                    raws[k] = [re.sub(r"\s+", " ", l.lower()) for l in t.splitlines()]
                    seqs[k] = [seq(l) for l in t.splitlines()]
        for r in raw:
            k = "ref2" if r.get("src", "").strip() == "2" else "ref"
            want = {float(r[c].replace(",", "")) for c in ("avg", "md", "lo", "hi") if r.get(c, "").strip()}
            if r["n"].strip():
                want.add(float(r["n"]))
            hits = [i for i, L in enumerate(lines.get(k, [])) if want <= L]
            if r.get("md", "").strip() and r["n"].strip():
                # a survey that prints a median: average, median, low, high and count, in that order
                # (or the order its "order" line gives: Wisconsin 2025 prints average, range, median, count)
                cols = meta.get("order", "avg md lo hi n").split()
                order = [float(r[c].replace(",", "")) for c in cols if r.get(c, "").strip()]
                hits = [i for i in hits if in_order(order, seqs[k][i])]
            if how == "window":
                # a window holds two rows' numbers at most; it must start at this row's own name
                head = re.sub(r"\s+", " ", r["operation"].lower())[:14]
                hits = [i for i in hits if raws[k][i].startswith(head)]
            if r.get("printed", "").strip() == MEDIAN_ONLY:
                # one number alone proves little: the line must also carry the job's name
                head = re.sub(r"\s+", " ", r["operation"].lower())[:14]
                hits = [i for i in hits if head in raws[k][i]]
            if not hits:
                bad.append("%s line %d (%s): %s not found together on one line of refs/%s.txt" % (st, r["_line"], r["operation"], sorted(want), meta.get(k)))
    sd = os.environ.get("CR_SRC_DIR", "")
    for fn, meta, rows in load_diy()[0]:
        files = [os.path.join(sd, f) for f in meta.get("files", "").split()]
        if not sd or not all(os.path.exists(f) for f in files):
            print("  diy/%s: skipped, its PDFs are not on the references branch yet; set CR_SRC_DIR to the folder that holds them" % fn)
            continue
        txt = "\n".join(subprocess.run(["pdftotext", "-layout", f, "-"], capture_output=True).stdout.decode("utf-8", "replace") for f in files)
        ls = [re.sub(r"\s+", " ", l).lower() for l in txt.splitlines()]
        for k, (cost, unit, op) in rows.items():
            vs = {"%.2f" % cost, ("%.2f" % cost).lstrip("0")}  # Illinois prints $0.14 and $.88
            if not any(op.lower() in l and any(re.search(r"(^|[ $])" + re.escape(v) + r"\b", l) for v in vs) for l in ls):
                bad.append("diy/%s %s: %s %s not found on a line with its name" % (fn, k, op, v))
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
    cols_md = "key\tsection\toperation\tunit\tavg\tmd\tlo\thi\tn\tprinted"

    def run_md(lines):
        m, rows, e = parse_tsv(head + "\n" + cols_md + "\n" + "\n".join(lines))
        c, e2 = validate(m, rows)
        return c, e + e2

    c, e = run_md(["combine-corn\tH\tCorn\tacre\t47.56\t40.00\t35.00\t95.00\t9"])
    ok(not e and c[0]["a"] == 47.56 and c[0]["md"] == 40 and c[0]["n"] == 9, "median kept beside the average: %s" % e)
    c, e = run_md(["\tH\tX\tacre\t20\t40\t10\t30\t3"])
    ok(e and "median 40.0 outside" in e[0], "median outside range refused")
    c, e = run_md(["\tA\tFence removal\tfoot\t\t1.25\t\t\t\tmedian-only"])
    ok(not e and c[0] == {"s": "A", "o": "Fence removal", "u": "foot", "md": 1.25, "c": "other", "p": "median-only"}, "median-only row has no average, range or count: %s %s" % (c, e))
    c, e = run_md(["\tA\tX\tfoot\t2\t1.25\t\t\t\tmedian-only"])
    ok(e and "carries no average" in e[0], "median-only row with an average refused")
    c, e = run_md(["\tA\tX\tfoot\t\t1.25\t\t\t4\tmedian-only"])
    ok(e and "carries no average" in e[0], "median-only row with a count refused")
    c, e = run_md(["spray-aerial\tA\tX\tacre\t\t13\t\t\t\tmedian-only"])
    ok(e and "comparison" in e[0], "median-only row never keyed into the comparison")
    c, e = run_md(["\tA\tX\tfoot\t\t\t\t\t\tmedian-only"])
    ok(e and "needs its median" in e[0], "median-only row without a median refused")
    no = head.replace("# ref: r", "# numbers_only: license forbids reposting\n# published: 2026-03")
    m, rows, e = parse_tsv(no + "\n" + cols + "\n\tH\tX\tacre\t20\t\t\t3")
    c, e2 = validate(m, rows)
    ok(not e2 and state_doc(m, c)["sources"][0] == {"url": "https://x.edu/a.pdf", "numbers_only": True, "published": "2026-03"}, "numbers-only source keeps link and date, no ref: %s" % e2)
    m, rows, e = parse_tsv(no + "\n# ref: r\n" + cols + "\n\tH\tX\tacre\t20\t\t\t3")
    ok(any("keeps no saved copy" in x for x in validate(m, rows)[1]), "numbers-only source with a stored copy refused")
    m, rows, e = parse_tsv(no.replace("# published: 2026-03", "") + "\n" + cols + "\n\tH\tX\tacre\t20\t\t\t3")
    ok(any("published" in x for x in validate(m, rows)[1]), "numbers-only source needs its publication date")
    m, rows, e = parse_tsv(head.replace("# ref: r", "") + "\n" + cols + "\n\tH\tX\tacre\t20\t\t\t3")
    ok(any("missing meta ref" in x for x in validate(m, rows)[1]), "any other source still needs its saved copy")
    ok(money(58, "percent of crop") == "58%" and unit_label("percent of crop") == "of the crop", "share of the crop prints as a percent")
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
    mo = docs.get("MO")
    ok(mo and mo.get("rate_year") == 2025 and any(r.get("k") == "combine-corn" and r["a"] == 47.56 and r["md"] == 40 and r["lo"] == 35 and r["hi"] == 95 and r["n"] == 9 for r in mo["rows"]),
       "Missouri 2025 corn combining without grain cart is $47.56 (median $40, $35-$95, 9), as G302 (March 2026) Table 5 prints it")
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
