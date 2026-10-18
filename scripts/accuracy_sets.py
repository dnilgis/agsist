#!/usr/bin/env python3
"""The "sets" accuracy pass: a stratified sample of every generated page set,
each page sent with the slice of data it was built from (scripts/accuracy_pass.py
sets mode; this file holds the set list, the sampler, the slicer, the checker
prompt and the set-wide ranking).

  python3 scripts/accuracy_pass.py sets OUT.json [--root DIR] [--cb-pages DIR] [--share 0.03]
  python3 scripts/accuracy_pass.py --run sets-2026-10 estimate OUT.json      (in Actions)

About 3% of each set (at least SET_MIN pages), split across states in
proportion to the set's pages per state, picked with a fixed seed so a rerun
picks the same pages. Each page goes with:
  - its text as built (static HTML: menus, scripts and styles stripped), its
    JSON-LD, title, meta description and canonical URL;
  - the data files its builder reads, cut down to this page (its FIPS, county,
    town, state or date; everything else counted, not sent);
  - excerpts of the primary sources on the references branch for that set.
The cash bid town, state and company pages come from the network at build
time. In Actions, --cb-pages points at a fresh build of those pages and the
network files are read right after it, so page and data match; without it the
committed pages go with no network slice and the checker is told so.

The model flags only real errors, with evidence, and says whether the cause is
the TEMPLATE (the builder would print the same mistake on every page of the
set) or this PAGE's data. report ranks set-wide issues first. Nothing here
touches a page: outputs are leads on the raw branch for the lead to check.
"""
import glob
import hashlib
import html as H
import json
import math
import os
import random
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SHARE = 0.03          # about 3% of each set
SET_MIN = 3           # never fewer than this many pages from a set (or all of a small set)
TEXT_CHARS = 20000    # page text sent per page
DATA_CHARS = 22000    # data slice sent per page, all files together
REF_CHARS = 4500      # per reference excerpt
REFS_CHARS = 12000    # all reference excerpts for a set
MAX_TOKENS = 6000     # model output per page (thinking included); the errors list is short
EFFORT = "medium"
SEED = "accsets-1"

STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas",
    "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming",
}
SLUG_ST = {re.sub(r"[^a-z0-9]+", "-", n.lower()): st for st, n in STATES.items()}

# name, page glob, page kind, data files (templates), reference ids on the references branch.
# Kinds: county (<set>/<state>/<county>.html), state (<set>/<state>.html or <set>/<state>/index.html),
# town and company (cash bids), date (<set>/<YYYY-MM-DD>.html), single (one page; its data is sampled).
# A data template may name {st} {ST} {fips} {date} {year}; "@prf-county-facts" and "@net:merged" /
# "@net:index" are computed (scripts/prf_county_facts.mjs; the bids network, Actions only).
SET_DEFS = [
    ("rain-county", "rain/*/*.html", "county", ["data/rain/{st}.json", "data/rain/stories/{st}.json"],
     ["ncei-normals-1991-2020", "bench-rain-county-2"]),
    ("rain-state", "rain/*.html", "state", ["data/rain/{st}.json"], ["ncei-normals-1991-2020"]),
    ("prf-county", "prf/*/*.html", "county", ["data/prf/meta.json", "data/prf/s/{ST}.json", "@prf-county-facts"],
     ["bench-prf-2"]),
    ("prf-state", "prf/*.html", "state", ["data/prf/meta.json", "data/prf/s/{ST}.json", "data/prf/facts.json"],
     ["bench-prf-2"]),
    ("atlas-county", "farmland-atlas/*/*.html", "county",
     ["data/atlas/counties/{fips}.json", "data/atlas/atlas.json", "data/tenure/tenure.json", "data/cash-rent/{ST}.json"],
     ["bench-farmland-atlas-2", "nass-cash-rents-county", "bench-land-tenure-1"]),
    ("atlas-state", "farmland-atlas/*/index.html", "state",
     ["data/atlas/atlas.json", "data/tenure/tenure.json", "data/cash-rent/{ST}.json"],
     ["bench-farmland-atlas-2", "bench-land-tenure-1"]),
    ("arc-plc-county", "arc-plc/*/*.html", "county",
     ["data/arc-plc.json", "data/arc-plc/{ST}.json", "data/arc-plc/math/{ST}.json"],
     ["fsa-arc-plc-2026-release", "fr-2026-00313", "ecfr-7-1412", "fsa-arc-plc"]),
    ("arc-plc-state", "arc-plc/*.html", "state", ["data/arc-plc.json", "data/arc-plc/{ST}.json"],
     ["fsa-arc-plc-2026-release", "fr-2026-00313", "ecfr-7-1412"]),
    ("hail-map-state", "hail-map/*.html", "state", ["data/hail/state-counties.json", "data/hail/storm-days.json"],
     ["bench-hail-map-1", "bench-hail-map-2"]),
    ("hail-day", "hail/*.html", "date",
     ["data/hail/storm-days.json", "data/hail/events-{year}.json", "data/hail/{year}.json"],
     ["bench-hail-map-1", "bench-hail-map-2"]),
    ("yield-state", "yield/*.html", "state", ["data/state-stats.json", "data/nass/*.json"],
     ["bench-conditions-yield-1", "bench-usda-quick-stats-3"]),
    ("rent-state", "rent/*.html", "state", ["data/cash-rent/{ST}.json"], ["nass-cash-rents-county", "bench-cash-rent-3"]),
    ("cash-bids-town", "cash-bids/*/*.html", "town", ["@net:merged", "@net:index", "data/state-basis/{ST}.json"], []),
    ("cash-bids-state", "cash-bids/*/index.html", "state", ["data/state-basis/{ST}.json", "@net:index"], ["bench-basis-2"]),
    ("cash-bids-company", "cash-bids/company/*.html", "company", ["@net:merged", "@net:index"], []),
    ("daily", "daily/*.html", "date", ["data/daily-archive/{date}.json"], []),
    ("cattle-auction", "cattle-auction-prices.html", "single", ["data/cattle-auction.json"],
     ["ams-feeder-auction-list", "bench-cattle-auction-prices-1"]),
    ("drought-county", "drought-monitor.html", "single", ["data/drought/summary.json", "data/drought/county-week.json"],
     ["ndmc-fsa-lfp", "usdm-data-services"]),
]
CB_SETS = ("cash-bids-town", "cash-bids-state", "cash-bids-company")

SYSTEM = """You check one page of agsist.com, a free farm website, for errors. The page is one of many built by the same program from data (one page per county, state, town, company or date). Today is {today}.

You get: the page's text as built (the HTML file, before scripts run, with the menus stripped; anything a script draws after the page loads is not in it, and that is not an error), its structured data (JSON-LD), the slice of the data files the program built it from (cut down to this page; "_omitted" notes count what was left out), and excerpts of primary sources from our references library for this set of pages.

Check every number, date, year, name, unit and claim on the page against the data slice and the sources. Redo any arithmetic the page shows or implies (totals, differences, percents, averages, per-acre figures, rankings).

Report ONLY real errors, each with evidence:
- a figure, date or name that does not match the data slice;
- arithmetic that does not work;
- a rule, rate, deadline or program detail that a source excerpt contradicts;
- a wrong label: the wrong county, state, crop, unit, year or time span for a number;
- text that contradicts itself or the structured data;
- a claim the data plainly cannot support (a trend or rank the numbers do not show).
Do NOT report: anything you cannot check, style or wording you would change, missing features, prices that differ from today's market, content a script draws later, a value the data slice left out, or rounding within the page's own precision. If the page is right, return an empty errors list; that is a normal result.

For each error give its cause:
- "template": the program or its fixed text would print the same mistake on every page of the set (a wrong formula, a wrong fixed sentence or default, a wrong unit or year in a label, a mixed-up column, a wrong source description);
- "page_data": only this page's data is off (one bad row, a missing or odd value, a wrong name match, a county joined to the wrong record);
- "unclear": you cannot tell which.

Evidence must be checkable: the data file and field path with its value, or the source id and the words in it, or the math written out. "exact_text" must be copied character for character from the page text, short (one sentence or one table row).

Finish with one JSON object in a ```json fenced block and nothing after it:
{{"page": "<path>", "errors": [{{"exact_text": "...", "claim": "<what the page says, in your words>", "problem": "<what is wrong, one line>", "evidence": "<field path and value, source id and quote, or the math>", "data_path": "<file and field, or null>", "source_id": "<reference id or null>", "correct_value": "<or null>", "cause": "template|page_data|unclear", "severity": "high|medium|low"}}], "checked": "<one line: what you checked>", "notes": "<anything a reviewer should know, such as cut text>"}}
Severity: high means a reader could lose money or miss a deadline acting on it; medium means a wrong figure; low means a minor detail.

=== THIS SET: {set_name} ({set_pages} pages built by the same program) ===
{set_note}

=== PRIMARY SOURCES FOR THIS SET (excerpts from the references branch) ===
{refs}"""

USER = """Page: {url}  (file {page})
Title: {title}
Meta description: {meta}

=== PAGE TEXT AS BUILT{cut} ===
{text}

=== STRUCTURED DATA (JSON-LD) ===
{ld}

=== DATA THE PAGE WAS BUILT FROM (sliced to this page) ===
{data}"""


def build_params(e, today, model):
    data = "\n\n".join(f"--- {d['path']} ---\n{d['body']}" for d in e.get("data", [])) or "(none)"
    if e.get("data_note"):
        data = e["data_note"] + "\n\n" + data
    system = SYSTEM.format(today=today, set_name=e["set"], set_pages=e.get("reach", "?"),
                           set_note=e.get("set_note") or "(none)", refs=e.get("refs") or "(none for this set)")
    return {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": EFFORT},
        # the system block (rules + this set's sources) is the same for every page of a set
        "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        "messages": [{"role": "user", "content": USER.format(
            url=e["url"], page=e["page"], title=e.get("title", ""), meta=e.get("meta", ""),
            cut=" (CUT: the page text was longer; only the first part is shown)" if e.get("text_cut") else "",
            text=e["text"], ld="\n".join(e.get("ld", []))[:6000] or "(none)", data=data)}],
    }


def worst_case(base_tokens, price_write, price_out):
    """Upper bound for one page: no tools, so the prompt is read once; priced as if it
    were all a cache write (dearer than plain input), with the full max_tokens out."""
    return (base_tokens * price_write + MAX_TOKENS * price_out) / 1e6


# ---------------------------------------------------------------- page reading
def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")


def page_text(raw):
    """(title, meta, canonical, text, ld list, is_stub) from a built HTML file."""
    title = H.unescape((re.search(r"(?is)<title>(.*?)</title>", raw) or [None, ""])[1]).strip()
    meta = H.unescape((re.search(r'(?is)<meta\s+name="description"\s+content="([^"]*)"', raw) or [None, ""])[1])
    canon = (re.search(r'(?is)<link\s+rel="canonical"\s+href="([^"]+)"', raw) or [None, ""])[1]
    ld = [m.strip() for m in re.findall(r'(?is)<script[^>]+application/ld\+json[^>]*>(.*?)</script>', raw)]
    stub = bool(re.search(r'(?i)<meta\s+http-equiv="refresh"', raw)) and len(raw) < 4000
    s = re.sub(r"(?is)<head\b.*?</head>", " ", raw)
    s = re.sub(r"(?is)<(script|style|noscript|template|nav)\b[^>]*>.*?</\1>", " ", s)
    s = re.sub(r"(?is)<header\b[^>]*class=\"[^\"]*site-header[^\"]*\"[^>]*>.*?</header>", " ", s)
    s = re.sub(r"(?i)<br\s*/?>|</(p|div|li|tr|h[1-6]|section|table|ul|ol|dd|dt)>", "\n", s)
    s = re.sub(r"(?i)</t[dh]>", " | ", s)
    s = H.unescape(re.sub(r"<[^>]+>", " ", s))
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r"\n\s*\n+", "\n", s).strip()
    return title, meta, canon, s, ld, stub


COUNTY_INDEX = {}    # "<state-slug>/<county-slug>" -> (fips, name), from farmland-atlas/data/counties-index.json


def load_county_index(root):
    """Every county set uses the Atlas URLs (scripts/build_prf_counties.py), so one index names them all."""
    try:
        for fips, label, href in json.load(open(os.path.join(root, "farmland-atlas", "data", "counties-index.json"), encoding="utf-8")):
            COUNTY_INDEX["/".join(href.strip("/").split("/")[-2:])] = (fips, re.sub(r",\s*[A-Z]{2}$", "", label))
    except (OSError, ValueError):
        pass


def ids_of(kind, rel, raw, title):
    """What a page is about: state, county FIPS and name, town, date."""
    parts = rel[:-5].split("/")
    out = {}
    if kind in ("county", "town", "state") and len(parts) >= 2 and parts[1] in SLUG_ST:
        out["ST"] = SLUG_ST[parts[1]]
    if kind == "state":
        sl = parts[1] if parts[-1] in ("index",) else parts[-1]
        if sl in SLUG_ST:
            out["ST"] = SLUG_ST[sl]
    if kind == "county":
        m = re.search(r'data-fips="(\d{5})"', raw) or re.search(r'"fips"\s*:\s*"(\d{5})"', raw)
        known = COUNTY_INDEX.get("/".join(parts[-2:]))
        if m:
            out["fips"] = m.group(1)
        elif known:
            out["fips"] = known[0]
        out["county"] = known[1] if known else parts[-1].replace("-", " ").title()
    if kind == "town":
        h1 = re.search(r"(?is)<h1[^>]*>(.*?)</h1>", raw)
        nm = H.unescape(re.sub(r"<[^>]+>", "", h1.group(1))).strip() if h1 else ""
        m = re.search(r"\b(?:in|near|for) (.+?),\s*[A-Z]{2}\b", nm)
        out["town"] = m.group(1).strip() if m else parts[-1].replace("-", " ").title()
    if kind == "company":
        h1 = re.search(r"(?is)<h1[^>]*>(.*?)</h1>", raw)
        nm = H.unescape(re.sub(r"<[^>]+>", "", h1.group(1))).strip() if h1 else title
        out["company"] = re.split(r"\s+(?:cash|grain|bids|elevators|locations)\b|[:|,]", nm, flags=re.I)[0].strip() or parts[-1]
    if kind == "date":
        m = re.search(r"(20\d\d-\d\d-\d\d)", parts[-1])
        if m:
            out["date"] = m.group(1)
            out["year"] = m.group(1)[:4]
    return out


def pages_of(root, pat, kind, cb_root=None):
    """(rel path, abs path) for every real page of a set: no redirect stubs, no index
    pages in a county set, no non-state pages in a state set."""
    base = root
    if cb_root and pat.startswith("cash-bids/"):
        base, pat = cb_root, pat[len("cash-bids/"):]
    out = []
    for p in sorted(glob.glob(os.path.join(base, pat))):
        rel = os.path.relpath(p, base)
        if base == cb_root:
            rel = "cash-bids/" + rel
        parts = rel[:-5].split("/")
        if kind == "county" and (parts[-1] == "index" or parts[-1].endswith("-sheet") or parts[1] not in SLUG_ST):
            continue
        if kind == "town" and (parts[-1] == "index" or parts[1] not in SLUG_ST):
            continue
        if kind == "state":
            sl = parts[1] if parts[-1] == "index" and len(parts) == 3 else parts[-1]
            if len(parts) > 3 or sl not in SLUG_ST or (len(parts) == 3 and parts[-1] != "index"):
                continue
        if kind == "date" and not re.fullmatch(r"20\d\d-\d\d-\d\d", parts[-1]):
            continue
        out.append((rel, p))
    return out


def stratum(rel, kind):
    parts = rel.split("/")
    if kind in ("county", "town", "state") and len(parts) >= 2:
        return parts[1].replace(".html", "")
    if kind == "date":
        return parts[-1][:7]          # by month
    return "all"


def sample(items, kind, share=SHARE, minimum=SET_MIN, seed=SEED):
    """Proportional allocation across strata (largest remainder), fixed seed."""
    if not items:
        return []
    n = min(len(items), max(minimum, math.ceil(share * len(items))))
    groups = {}
    for it in items:
        groups.setdefault(stratum(it[0], kind), []).append(it)
    quotas = {g: n * len(v) / len(items) for g, v in groups.items()}
    take = {g: int(q) for g, q in quotas.items()}
    order = sorted(groups, key=lambda g: (-(quotas[g] - take[g]), hashlib.sha1((seed + g).encode()).hexdigest()))
    for g in order[:n - sum(take.values())]:
        take[g] += 1
    out = []
    for g in sorted(groups):
        v = sorted(groups[g])
        random.Random(seed + g).shuffle(v)
        out += v[:take[g]]
    return sorted(out)


# ---------------------------------------------------------------- data slicing
def needles(ids):
    """(strong, keys): strong strings mark a JSON child as this page's; keys are dict
    keys that belong to it."""
    strong, keys = set(), set()
    if ids.get("fips"):
        strong.add(f'"{ids["fips"]}"')
        keys |= {ids["fips"], ids["fips"][2:]}
    for k in ("county", "town", "company"):
        if ids.get(k):
            nm = ids[k]
            strong |= {f'"{nm}"', f'"{nm.lower()}"', f'"{slug(nm)}"'}
            short = re.sub(r"\s+(County|Parish|Borough|Census Area|city)$", "", nm, flags=re.I)
            if short != nm and len(short) > 3:
                strong.add(f'"{short}"')
            if k != "county":
                strong.add(nm)
    if ids.get("date"):
        strong.add(f'"{ids["date"]}"')
        keys.add(ids["date"])
    if ids.get("ST"):
        st = ids["ST"]
        keys |= {st, st.lower(), STATES[st], slug(STATES[st])}
        if not (ids.get("fips") or ids.get("town") or ids.get("company")):
            strong |= {f'"{st}"', f'"{STATES[st]}"'}
    return strong, keys


def dumps(o):
    return json.dumps(o, separators=(",", ":"), ensure_ascii=False)


def slice_json(o, strong, keys, budget):
    s = dumps(o)
    if len(s) <= budget:
        return o
    if isinstance(o, dict):
        out, dropped = {}, 0
        hits = [k for k in o if str(k) in keys or any(n in dumps(o[k]) for n in strong)]
        share = max(400, budget // max(1, len(hits)))
        for k, v in o.items():
            if k in hits:
                out[k] = slice_json(v, strong, keys, share)
            elif not isinstance(v, (dict, list)) or len(dumps(v)) <= 120:
                out[k] = v
            else:
                dropped += 1
        if dropped:
            out["_omitted"] = f"{dropped} other entries not for this page"
        return out
    if isinstance(o, list):
        hits = [x for x in o if any(n in dumps(x) for n in strong)]
        if hits:
            share = max(400, budget // min(len(hits), 20))
            out = [slice_json(x, strong, keys, share) for x in hits[:20]]
            if len(o) > len(out):
                out.append({"_omitted": f"{len(o) - len(out)} other rows of {len(o)}"})
            return out
        out = [slice_json(x, strong, keys, max(300, budget // 4)) for x in o[:3]]
        return out + [{"_omitted": f"{len(o) - 3} more rows of {len(o)}, none for this page"}] if len(o) > 3 else out
    return o


def cut(s, n):
    return s if len(s) <= n else s[:n] + f" ...(cut, {len(s) - n} more characters)"


class Data:
    """Loads each data file once; computed sources on first use."""

    def __init__(self, root, net=None):
        self.root, self.cache, self.net = root, {}, net

    def load(self, rel):
        if rel not in self.cache:
            try:
                with open(os.path.join(self.root, rel), encoding="utf-8") as f:
                    self.cache[rel] = json.load(f)
            except (OSError, ValueError):
                self.cache[rel] = None
        return self.cache[rel]

    def prf_county_facts(self):
        if "@prf" not in self.cache:
            try:
                r = subprocess.run(["node", os.path.join(self.root, "scripts", "prf_county_facts.mjs")],
                                   capture_output=True, text=True, check=False, cwd=self.root, timeout=600)
                self.cache["@prf"] = json.loads(r.stdout) if r.returncode == 0 else None
            except (OSError, ValueError, subprocess.TimeoutExpired):
                self.cache["@prf"] = None
        return self.cache["@prf"]

    def slices(self, templates, ids):
        strong, keys = needles(ids)
        files = []
        for t in templates:
            if t == "@prf-county-facts":
                files.append(("scripts/prf_county_facts.mjs output (the county facts the page prints)", self.prf_county_facts()))
                continue
            if t.startswith("@net:"):
                if self.net is not None:
                    files.append((f"bids network data/{'merged-all' if t == '@net:merged' else 'index'}.json (read right after the build)",
                                  self.net.get(t[5:])))
                continue
            try:
                rel = t.format(st=ids.get("ST", "").lower(), ST=ids.get("ST", ""), fips=ids.get("fips", ""),
                               date=ids.get("date", ""), year=ids.get("year", ""))
            except (KeyError, IndexError):
                continue
            if "{" in rel or rel.endswith("/.json") or "/.json" in rel:
                continue
            for p in sorted(glob.glob(os.path.join(self.root, rel))) if "*" in rel else [os.path.join(self.root, rel)]:
                files.append((os.path.relpath(p, self.root), self.load(os.path.relpath(p, self.root))))
        files = [(p, o) for p, o in files if o is not None]
        out, left = [], DATA_CHARS
        for i, (p, o) in enumerate(files):
            per = max(1500, left // (len(files) - i))
            body = cut(dumps(slice_json(o, strong, keys, per)), per)
            out.append({"path": p, "body": body})
            left -= len(body)
        return out


def single_sample(o, share, seed):
    """For a one-page set whose data covers many counties (drought), keep about `share`
    of the per-county rows, spread across states (FIPS state prefix)."""
    if not isinstance(o, dict):
        return o
    out = {}
    for k, v in o.items():
        if isinstance(v, dict) and len(v) > 200 and all(re.fullmatch(r"\d{5}", str(x)) for x in list(v)[:50]):
            items = [(f"x/{c[:2]}/{c}", c) for c in v]
            keep = {c for _, c in sample(items, "county", share, SET_MIN, seed)}
            out[k] = {c: v[c] for c in sorted(keep)}
            out[k]["_omitted"] = f"{len(v) - len(keep)} other counties (a {share:.0%} sample by state is shown)"
        else:
            out[k] = v
    return out


# ---------------------------------------------------------------- references
def load_refs(ids, ref_dir=None):
    """Excerpts of the named references. ref_dir holds <id>.txt; else read from origin/references."""
    out, left = [], REFS_CHARS
    for rid in ids:
        txt = None
        if ref_dir and os.path.exists(os.path.join(ref_dir, rid + ".txt")):
            txt = open(os.path.join(ref_dir, rid + ".txt"), encoding="utf-8", errors="replace").read()
        else:
            r = subprocess.run(["git", "show", f"origin/references:refs/{rid}.txt"], capture_output=True, text=True, check=False)
            txt = r.stdout if r.returncode == 0 else None
        if not txt:
            out.append(f"[{rid}] (not on the references branch; treat as not checked)")
            continue
        txt = re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", txt))
        n = min(REF_CHARS, left)
        if n < 500:
            break
        out.append(f"[{rid}]\n{cut(txt.strip(), n)}")
        left -= n
    return "\n\n".join(out)


SET_NOTES = {
    "cash-bids-town": "Bids come from the AGSIST elevator network at build time. Futures prices are never printed by design. A board whose rows are stale is named under 'no current bid'.",
    "cash-bids-company": "Bids come from the AGSIST elevator network at build time. Futures prices are never printed by design.",
    "cash-bids-state": "The state basis section: every elevator's basis in the state from data/state-basis/<ST>.json.",
    "daily": "A dated market briefing written from that day's data; the data slice is that day's archive record (the briefing as stored).",
    "drought-county": "One page; the county view is drawn by script from data/drought/county-week.json, so only the page's fixed text and summary can be checked against the data. A sample of counties is shown.",
    "cattle-auction": "One page; the auction table is drawn by script from data/cattle-auction.json.",
    "prf-county": "County facts are computed by scripts/prf_county_facts.mjs from data/prf/g and data/prf/y; the page only formats them.",
}


# ---------------------------------------------------------------- bundle
def build_bundle(root, today, cb_root=None, net=None, share=SHARE, ref_dir=None, only=None):
    D = Data(root, net)
    load_county_index(root)
    pages, sets = [], {}
    for name, pat, kind, data, refs in SET_DEFS:
        if only and name not in only:
            continue
        items = pages_of(root, pat, kind, cb_root if name in CB_SETS else None)
        real = []
        for rel, p in items:
            raw = open(p, encoding="utf-8", errors="replace").read()
            if page_text(raw)[5]:
                continue
            real.append((rel, p))
        pick = sample(real, kind, share) if kind != "single" else real
        ref_text = load_refs(refs, ref_dir) if refs else ""
        sets[name] = {"pages": len(real), "sampled": len(pick), "glob": pat, "kind": kind,
                      "states": len({stratum(r, kind) for r, _ in real}), "refs": refs}
        for rel, p in pick:
            raw = open(p, encoding="utf-8", errors="replace").read()
            title, meta, canon, text, ld, _ = page_text(raw)
            ids = ids_of(kind, rel, raw, title)
            if kind == "single":
                strong, keys = set(), set()
                files = []
                for t in data:
                    o = D.load(t)
                    if o is None:
                        continue
                    o = single_sample(o, share, SEED)
                    files.append({"path": t, "body": cut(dumps(o), DATA_CHARS // len(data))})
            else:
                files = D.slices(data, ids)
            e = {"set": name, "label": name, "reach": len(real), "kind": kind, "ids": ids,
                 "page": rel, "url": canon or "https://agsist.com/" + re.sub(r"(index)?\.html$", "", rel),
                 "title": title, "meta": meta, "text": cut(text, TEXT_CHARS), "text_cut": len(text) > TEXT_CHARS,
                 "ld": ld, "data": files, "refs": ref_text, "set_note": SET_NOTES.get(name, "")}
            if name in CB_SETS and net is None:
                e["data_note"] = ("(The bids network snapshot this page was built from is not included in this run. "
                                  "Check only the page's own arithmetic, internal consistency and fixed text; do not flag bids as unmatched.)")
            if name in CB_SETS and cb_root:
                e["data_note"] = "(This page is a fresh build from the network; the network files below were read right after it.)"
            pages.append(e)
    return {"mode": "sets", "today": today, "sets": sets, "pages": pages}


def load_net():
    """(merged-all, index) from the bids network, the same reader the cash bid build uses."""
    sys.path.insert(0, HERE)
    import build_state_basis_pages as SB
    merged, index = SB.load_network(None, None)
    return {"merged": merged, "index": index}


# ---------------------------------------------------------------- report
SEV = {"high": 3, "medium": 2, "low": 1}
CAUSES = ("template", "page_data", "unclear")


def _sq(s):
    return re.sub(r"\s+", " ", (s or "").replace("’", "'").replace("“", '"').replace("”", '"')).strip().lower()


def signature(err, ids):
    """Words of the problem with this page's own names and every number taken out, so
    the same template mistake on two pages looks alike."""
    s = _sq((err.get("problem") or "") + " " + (err.get("claim") or ""))
    for v in ids.values():
        if v and len(str(v)) > 2:
            s = s.replace(_sq(str(v)), " ")
    for st, n in STATES.items():
        s = s.replace(n.lower(), " ")
    s = re.sub(r"[$]?\d[\d,.]*%?", " # ", s)
    return {w for w in re.findall(r"[a-z#]{3,}", s) if w not in {"the", "and", "for", "page", "this", "that", "with", "data", "says", "but"}}


def build_report(results, bundle):
    by_page = {e["page"]: e for e in bundle.get("pages", [])}
    sets = bundle.get("sets", {})
    leads = []
    errs_by_set = {}
    for cid, r in results["pages"].items():
        b = by_page.get(r["page"], {})
        hay = _sq(b.get("text", "") + " " + " ".join(b.get("ld", [])) + " " + b.get("title", "") + " " + b.get("meta", ""))
        name = b.get("set") or r.get("label") or "?"
        errs = (r.get("parsed") or {}).get("errors", []) or []
        errs_by_set.setdefault(name, set())
        for err in errs:
            q = _sq(err.get("exact_text"))
            ev = err.get("evidence") or ""
            lead = {"set": name, "page": r["page"], "url": b.get("url"), "cause": err.get("cause") if err.get("cause") in CAUSES else "unclear",
                    "severity": err.get("severity") if err.get("severity") in SEV else "low",
                    "exact_text": err.get("exact_text"), "claim": err.get("claim"), "problem": err.get("problem"),
                    "evidence": ev, "data_path": err.get("data_path"), "source_id": err.get("source_id"),
                    "correct_value": err.get("correct_value"), "quote_on_page": bool(q) and q[:160] in hay,
                    "evidence_named": bool(err.get("data_path") or err.get("source_id") or re.search(r"\d\s*[-+x*/=]\s*\d|\.json|\[", ev)),
                    "_sig": signature(err, b.get("ids") or {})}
            if lead["source_id"] and lead["source_id"] not in (sets.get(name, {}).get("refs") or []):
                lead["flag"] = "source id is not one of the references sent for this set"
            leads.append(lead)
            errs_by_set[name].add(r["page"])
    # cluster leads within a set by signature (greedy, Jaccard >= 0.5)
    clusters = []
    for l in sorted(leads, key=lambda x: (x["set"], -SEV[x["severity"]], x["page"])):
        for c in clusters:
            if c["set"] == l["set"]:
                a, b = c["_sig"], l["_sig"]
                if a and b and len(a & b) / len(a | b) >= 0.5:
                    c["leads"].append(l)
                    break
        else:
            clusters.append({"set": l["set"], "_sig": l["_sig"], "leads": [l]})
    issues = []
    for c in clusters:
        L = c["leads"]
        s = sets.get(c["set"], {})
        pages_hit = sorted({l["page"] for l in L})
        sampled = s.get("sampled") or 1
        causes = [l["cause"] for l in L]
        cause = max(CAUSES, key=lambda k: (causes.count(k), k == "template"))
        sev = max(SEV[l["severity"]] for l in L)
        solid = sum(1 for l in L if l["quote_on_page"] and l["evidence_named"]) / len(L)
        # set-wide: the model called it template, or the same problem showed on 2+ sampled pages
        setwide = cause == "template" or len(pages_hit) >= 2
        est = round(len(pages_hit) / sampled * s.get("pages", 0)) if not cause == "template" else s.get("pages", 0)
        score = (1000 if setwide else 0) + sev * 100 * (0.5 + solid / 2) + min(est, 6000) ** 0.5
        top = sorted(L, key=lambda x: (-SEV[x["severity"]], not x["quote_on_page"]))[0]
        issue = {"set": c["set"], "setwide": setwide, "cause": cause, "severity": {3: "high", 2: "medium", 1: "low"}[sev],
                 "pages_flagging": len(pages_hit), "sampled": sampled, "set_pages": s.get("pages"), "est_pages_affected": est,
                 "evidence_solid_share": round(solid, 2), "score": round(score, 2),
                 "problem": top["problem"], "example_text": top["exact_text"], "evidence": top["evidence"],
                 "correct_value": top["correct_value"], "data_path": top["data_path"], "source_id": top["source_id"],
                 "pages": pages_hit[:12], "leads": [{k: v for k, v in l.items() if k != "_sig"} for l in L]}
        if top.get("flag"):
            issue["flag"] = top["flag"]
        issues.append(issue)
    issues.sort(key=lambda x: (-x["score"], x["set"]))
    for i, x in enumerate(issues):
        x["rank"] = i + 1
    problems = {k: v.get("result") if v.get("result") != "succeeded" else v.get("stop_reason")
                for k, v in results["pages"].items()
                if v.get("result") != "succeeded" or v.get("stop_reason") != "end_turn" or not v.get("parsed")}
    per_set = {n: {"pages": s.get("pages"), "sampled": s.get("sampled"),
                   "sampled_pages_with_errors": len(errs_by_set.get(n, ())),
                   "issues": sum(1 for x in issues if x["set"] == n),
                   "setwide_issues": sum(1 for x in issues if x["set"] == n and x["setwide"])} for n, s in sets.items()}
    rep = {"mode": "sets", "batch_id": results.get("batch_id"), "model": results.get("model"),
           "actual_cost_usd": results.get("actual_cost_usd"), "pages": len(results["pages"]),
           "errors_total": len(leads), "issues": len(issues), "setwide_issues": sum(1 for x in issues if x["setwide"]),
           "per_set": per_set, "pages_without_a_parsed_answer": problems,
           "how_ranked": "Set-wide issues first (the model called the cause the template, or the same problem showed on 2 or more "
                         "sampled pages of a set), then by severity x how checkable the evidence is (the quote is on the page and a "
                         "data path, source id or the math is named) + the pages it likely reaches. Leads, not findings: check each "
                         "against the builder, the data and the references branch before any fix.",
           "issues_ranked": issues}
    md = [f"# Generated page sets: accuracy leads, ranked ({results.get('batch_id')})", "",
          f"Model {results.get('model')}, {len(results['pages'])} sampled pages, {len(leads)} errors flagged, "
          f"{len(issues)} distinct issues ({rep['setwide_issues']} set-wide), actual cost ${results.get('actual_cost_usd')}.", "",
          "Leads, not findings. Check each against the builder, the data and the references branch before anything changes. "
          "`solid` = share of the flags whose quote is on the page and whose evidence names a field, a source or the math.", ""]
    if problems:
        md += ["Pages with no usable answer (rerun or read results-raw.jsonl): " + ", ".join(f"{k} ({v})" for k, v in problems.items()), ""]
    cell = lambda s, n=260: (s or "").replace("|", "/").replace("\n", " ")[:n]
    for title, want in (("Set-wide issues (template or builder: fix once, every page changes)", True),
                        ("Single-page issues (this page's data)", False)):
        md += [f"## {title}", "", "| # | set (pages) | cause | sev | flagged / sampled | est. pages | problem | text on the page | evidence / correct value | solid | pages |",
               "|---|---|---|---|---|---|---|---|---|---|---|"]
        for x in issues:
            if x["setwide"] != want:
                continue
            md.append(f"| {x['rank']} | {x['set']} ({x['set_pages']}) | {x['cause']} | {x['severity']} | {x['pages_flagging']}/{x['sampled']} | "
                      f"{x['est_pages_affected']} | {cell(x['problem'], 200)} | {cell(x['example_text'], 180)} | "
                      f"{cell(x['evidence'], 260)}{'; correct: ' + cell(x['correct_value'], 80) if x.get('correct_value') else ''}"
                      f"{' (' + x['flag'] + ')' if x.get('flag') else ''} | {x['evidence_solid_share']} | {cell(', '.join(x['pages'][:4]), 200)} |")
        md.append("")
    md += ["## Per set", "", "| set | pages | sampled | sampled pages with errors | issues | set-wide |", "|---|---|---|---|---|---|"]
    for n, s in per_set.items():
        md.append(f"| {n} | {s['pages']} | {s['sampled']} | {s['sampled_pages_with_errors']} | {s['issues']} | {s['setwide_issues']} |")
    return rep, "\n".join(md) + "\n"


def main(args):
    """accuracy_pass.py sets OUT [--root DIR] [--cb-pages DIR] [--net] [--share X] [--refs-dir DIR] [--only a,b]"""
    def take(flag, default=None, boolean=False):
        if flag in args:
            i = args.index(flag)
            if boolean:
                del args[i]
                return True
            v = args[i + 1]
            del args[i:i + 2]
            return v
        return default
    root = take("--root", os.path.dirname(HERE))
    cb = take("--cb-pages")
    use_net = take("--net", False, True)
    share = float(take("--share", str(SHARE)))
    ref_dir = take("--refs-dir")
    only = [x for x in (take("--only", "") or "").split(",") if x]
    today = take("--today")
    if not args:
        sys.exit("sets OUT.json [--root DIR] [--cb-pages DIR] [--net] [--share X] [--refs-dir DIR] [--only a,b]")
    import time
    today = today or time.strftime("%B %-d, %Y")
    net = load_net() if use_net else None
    b = build_bundle(root, today, cb_root=cb, net=net, share=share, ref_dir=ref_dir, only=only or None)
    os.makedirs(os.path.dirname(os.path.abspath(args[0])), exist_ok=True)
    json.dump(b, open(args[0], "w"), ensure_ascii=False)
    chars = sum(len(json.dumps(e, ensure_ascii=False)) for e in b["pages"])
    for n, s in b["sets"].items():
        print(f"{n}: {s['sampled']} of {s['pages']} pages ({s['states']} strata)")
    print(f"::notice title=Accuracy sets bundle::{len(b['pages'])} pages from {len(b['sets'])} sets, {chars:,} characters")
    return b
