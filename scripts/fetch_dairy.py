#!/usr/bin/env python3
"""
AGSIST -- build data/dairy-data.json and data/dairy-history.json for milk-prices.html.

Sources (nothing behind a bot challenge, no CME, no Barchart):
  1. USDA AMS "Announcement of Class and Component Prices" PDF
     https://www.ams.usda.gov/mnreports/dymclassprices.pdf  (issued about the 5th)
     -> Class II/III/IV, four component prices, four product price averages.
  2. USDA NASS Quick Stats API (env NASS_API_KEY): national monthly all-milk
     price received. Fails soft.

Modes:
  (default)   fetch, validate, write. Keep-last-good on any failure.
  --probe     fetch each source, save the raw result to data/dairy-raw/, print
              what parsed and what did not, exit 0. Writes no feed.
  --selftest  offline tests, non-zero exit on any failure.

WHAT THIS FILE WILL NOT DO
  * It never writes a zero for a missing value. A missing value is an omitted key.
  * It never publishes a components/products block that fails the three
    identities in 7 CFR 1000.50 (butterfat vs butter, other solids vs whey,
    nonfat solids vs NDM). If it cannot validate it, it does not publish it.
  * It never replaces a newer month with an older one.
  * On failure it leaves the last good feed alone and only updates `status`.
    If no feed exists yet, it writes nothing.

REAL-WORLD ASSUMPTIONS ONLY A LIVE RUN CAN CONFIRM
  * The AMS layout is now CONFIRMED for `pdftotext -layout`: the selftest embeds
    the first 60 lines of the real August 2026, January 2026 and August 2025
    reports. Page 1 has one "Label ... $value (per unit)" line per price, footnote
    glyphs after labels, decoy lines ("Class II Butterfat Price:", "Class III Skim
    Milk Price:"), and a whole-year table on page 2 that is cut off. The three
    older reconstructed layouts and a pypdf-style extraction (no column alignment,
    footnotes as plain digits) stay in the tests for the pypdf fallback path.
  * Whether GitHub runner IPs can reach www.ams.usda.gov.
  * The NASS short_desc and that the API returns monthly rows for it.

Stdlib only. Optional: pdftotext (poppler) or pypdf for the PDF text.
"""
import copy
import datetime
import itertools
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = "data/dairy-data.json"
HIST = "data/dairy-history.json"
RAW_DIR = "data/dairy-raw"

AMS_URL = "https://www.ams.usda.gov/mnreports/dymclassprices.pdf"
NASS_API = "https://quickstats.nass.usda.gov/api/api_GET/"
NASS_SHORT = "MILK - PRICE RECEIVED, MEASURED IN $ / CWT"
UA = "agsist.com dairy feed (contact: sig@farmers1st.com)"

CLASS_RANGE = (5.0, 45.0)      # $/cwt
LB_RANGE = (0.05, 6.0)         # $/lb
ALLMILK_RANGE = (5.0, 60.0)    # $/cwt
TOL = 0.002

MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
MON_IDX = {}
for _i, _m in enumerate(MONTHS, 1):
    MON_IDX[_m.lower()] = _i
    MON_IDX[_m[:3].lower()] = _i
MON_IDX["sept"] = 9


# ---------------------------------------------------------------- fetching
def http_get(url, headers=None, tries=3, timeout=30, opener=None, sleep=time.sleep):
    """Plain honest GET. 3 tries, backoff. Returns (bytes, None) or (None, error)."""
    h = {"User-Agent": UA, "Accept": "*/*"}
    h.update(headers or {})
    opener = opener or urllib.request.urlopen
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=h)
            with opener(req, timeout=timeout) as r:
                return r.read(), None
        except Exception as e:  # noqa: BLE001 network -> retry
            last = "%s: %s" % (type(e).__name__, e)
            if i < tries - 1:
                sleep(2 * (i + 1))
    return None, last


def pdf_to_text(raw):
    """PDF bytes -> text. pdftotext -layout first, pypdf second. (text, error)."""
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "in.pdf")
        Path(p).write_bytes(raw)
        exe = shutil.which("pdftotext")
        if exe:
            try:
                r = subprocess.run([exe, "-layout", p, "-"], capture_output=True, timeout=60)
                t = r.stdout.decode("utf-8", "replace")
                if r.returncode == 0 and t.strip():
                    return t, None
            except Exception:  # noqa: BLE001
                pass
        try:
            import pypdf  # noqa: WPS433
            rd = pypdf.PdfReader(p)
            t = "\f".join((pg.extract_text() or "") for pg in rd.pages)
            if t.strip():
                return t, None
            return None, "pypdf found no text (scanned or empty PDF)"
        except ImportError:
            return None, "no pdftotext and no pypdf available"
        except Exception as e:  # noqa: BLE001
            return None, "pypdf failed: %s: %s" % (type(e).__name__, e)


def fetch_ams(opener=None, sleep=time.sleep):
    """Returns (raw_bytes|None, text|None, error|None)."""
    raw, err = http_get(AMS_URL, opener=opener, sleep=sleep)
    if raw is None:
        return None, None, "AMS fetch failed: %s" % err
    if raw[:5] == b"%PDF-":
        text, e = pdf_to_text(raw)
        if text is None:
            return raw, None, "AMS PDF text extraction failed: %s" % e
        return raw, text, None
    txt = raw.decode("utf-8", "replace")
    if re.search(r"<html|<!doctype|captcha|access denied", txt[:2000], re.I):
        return raw, None, "AMS returned a web page, not a PDF (blocked or moved)"
    return raw, txt, None        # a plain-text report is fine too


def nass_params(key, year_now, agg="NATIONAL"):
    return {
        "key": key, "short_desc": NASS_SHORT, "agg_level_desc": agg,
        "source_desc": "SURVEY", "freq_desc": "MONTHLY", "format": "JSON",
        "year__GE": str(year_now - 1),
    }


def fetch_nass(key, year_now, opener=None, sleep=time.sleep, agg="NATIONAL", raw_out=None):
    """Returns (rows|None, error|None). agg is NATIONAL or STATE. raw_out, if a
    list, gets the response text appended (used by --probe)."""
    if not key:
        return None, "no NASS_API_KEY"
    url = NASS_API + "?" + urllib.parse.urlencode(nass_params(key, year_now, agg))
    # Quick Stats is slow. The repo's own NASS builder waits 90 s and retries 4x;
    # the first live run of this script timed out on both queries at 30 s x 3.
    raw, err = http_get(url, opener=opener, sleep=sleep, tries=4, timeout=120)
    if raw is None:
        return None, "NASS fetch failed: %s" % err.replace(key, "***")
    if raw_out is not None:
        raw_out.append(raw.decode("utf-8", "replace").replace(key, "***"))
    try:
        js = json.loads(raw.decode("utf-8", "replace"))
    except ValueError as e:
        return None, "NASS returned non-JSON: %s" % e
    if isinstance(js, dict) and js.get("error"):
        return None, "NASS error: %s" % js.get("error")
    rows = js.get("data") if isinstance(js, dict) else None
    if not isinstance(rows, list):
        return None, "NASS response has no data list"
    return rows, None


# ---------------------------------------------------------------- NASS parsing
def nass_val(v):
    """'(D)', '(NA)', '' and junk -> None. Never 0 for a missing value."""
    if v is None:
        return None
    v = str(v).strip().replace(",", "")
    if not v or v[0] == "(":
        return None
    try:
        return float(v)
    except ValueError:
        return None


US_NAMES = ("US TOTAL", "UNITED STATES", "US")


def _row_points(rows):
    """{None: {(y,m): v}} for the national series, {'WISCONSIN': {...}} per state.
    Skips (D)/(NA), non-month periods, other milk classes, and out-of-range values."""
    out = {}
    for r in rows or []:
        cd = str(r.get("class_desc", "ALL CLASSES")).upper()
        if cd not in ("ALL CLASSES", ""):
            continue
        per = str(r.get("reference_period_desc", "")).strip().lower()
        mi = MON_IDX.get(per[:3]) if per[:3] in MON_IDX and len(per) <= 9 else None
        if not mi or per.startswith(("year", "marketing", "annual")):
            continue
        yr = str(r.get("year", "")).strip()
        if not yr.isdigit():
            continue
        val = nass_val(r.get("Value"))
        if val is None or not (ALLMILK_RANGE[0] <= val <= ALLMILK_RANGE[1]):
            continue
        st = str(r.get("state_name", "")).strip().upper()
        agg = str(r.get("agg_level_desc", "")).upper()
        if agg == "NATIONAL" or not st or st in US_NAMES:
            who = None
        else:
            who = st
        out.setdefault(who, {})[(int(yr), mi)] = round(val, 2)
    return out


def _prev(y, m):
    return (y - 1, 12) if m == 1 else (y, m - 1)


def parse_nass(rows):
    """National all-milk price: latest month with a real value, the month before it
    and the same month a year earlier, all from the same series. A row whose state
    is 'US TOTAL' counts as national (used when only the state query worked).
    Returns (dict|None, reason|None)."""
    pts = _row_points(rows).get(None) or {}
    if not pts:
        return None, "no usable monthly rows ((D)/(NA) suppressed or none returned)"
    y, m = max(pts)
    out = {"value": pts[(y, m)], "month": "%s %d" % (MONTHS[m - 1], y),
           "month_key": "%d-%02d" % (y, m), "source": "NASS Agricultural Prices"}
    pm = pts.get(_prev(y, m))
    if pm is not None:
        out["prev_month"] = pm
    ya = pts.get((y - 1, m))
    if ya is not None:
        out["year_ago"] = ya
    return out, None


def parse_nass_states(rows, month_key=None):
    """State all-milk prices for one month: the national month if given, else the
    latest month any state has. A state row is published only with a real value.
    Returns ({month, month_key, rows[{state,value,prev_month?,year_ago?}]}|None, reason|None)."""
    series = {k: v for k, v in _row_points(rows).items() if k is not None}
    if not series:
        return None, "no usable state rows ((D)/(NA) suppressed or none returned)"
    if month_key:
        y, m = int(month_key[:4]), int(month_key[5:])
    else:
        y, m = max(max(v) for v in series.values())
    out_rows = []
    for st in sorted(series, key=lambda x: x.title()):
        pts = series[st]
        if (y, m) not in pts:
            continue
        r = {"state": st.title(), "value": pts[(y, m)]}
        if _prev(y, m) in pts:
            r["prev_month"] = pts[_prev(y, m)]
        if (y - 1, m) in pts:
            r["year_ago"] = pts[(y - 1, m)]
        out_rows.append(r)
    if not out_rows:
        return None, "no state has a value for %d-%02d" % (y, m)
    return {"month": "%s %d" % (MONTHS[m - 1], y), "month_key": "%d-%02d" % (y, m), "rows": out_rows}, None


# ---------------------------------------------------------------- AMS parsing
def norm(text):
    t = text.replace("\u00a0", " ").replace("\u2013", "-").replace("\u2014", "-")
    t = t.replace("\u2212", "-")
    # Footnote glyphs (superscript 1 2 3 and friends) sit right after labels in the
    # real report ("Protein Price \u00b2:"). They are not values. Drop them.
    t = re.sub("[\u00b9\u00b2\u00b3\u2070\u2074-\u2079]", "", t)
    return t


def first_page(text):
    """Page 1 of the report holds every number we want. Later pages carry a
    whole-year table with numbers for every month, which are decoys. Cut at the
    first form feed, and also at the page-2 running header in case an extractor
    drops form feeds."""
    t = text.split("\f")[0] if "\f" in text and len(text.split("\f")[0]) > 500 else text
    i = t.find("Product Price Averages")
    if i >= 0:
        m = re.search(r"USDA\s*-\s*Agricultural Marketing Service", t[i:])
        if m:
            t = t[:i + m.start()]
    return t


LABELS = [  # (key, regex). Order matters only for overlap resolution (longest wins).
    ("butterfat", r"Butter\s*fat"),
    ("nonfat_solids", r"Non-?\s?fat\s+Solids"),
    ("other_solids", r"Other\s+Solids"),
    ("ndm", r"Non-?\s?fat\s+Dry\s+Milk|NFDM|NDM"),
    ("protein", r"Protein"),
    ("butter", r"Butter(?!\w)"),
    ("cheese", r"Cheese"),
    ("whey", r"Whey"),
    ("class2", r"Class\s+(?:II|2)(?!\w)"),
    ("class3", r"Class\s+(?:III|3)(?!\w)"),
    ("class4", r"Class\s+(?:IV|4)(?!\w)"),
    ("class1", r"Class\s+(?:I|1)(?!\w)"),
]
CLASS_KEYS = {"class1", "class2", "class3", "class4"}
LB_KEYS = {"butterfat", "protein", "nonfat_solids", "other_solids",
           "butter", "ndm", "cheese", "whey"}

NUM2 = r"(?<![\d.,])(\d{1,3}\.\d{2})(?!\d)"     # class prices, $/cwt
NUM4 = r"(?<![\d.,])(\d{1,2}\.\d{4})(?!\d)"     # component/product prices, $/lb
# Filler allowed between a label and its number, in the S1 (inline) pattern.
GAP = (r"(?:[\s$:.\-_=|*]|\b\d\b(?![.\d,])|\([^()\n]{0,30}\)|\b(?:price|prices|milk|per|cwt|hundredweight|lb|lbs|pound|"
       r"is|are|of|the|was|at|announced|average|averages|for|dollars|component)\b)")
# Filler allowed between column headers, and between the last header and the numbers.
HDR_GAP = r"^[\s,|/:;$\-]*(?:(?:price|prices|component|components|milk|dry|per|cwt|lb|lbs|\(\$?/?\w*\))\s*)*$"
NUM_LEAD = r"[\s$:.\-_|]*(?:[A-Za-z][A-Za-z.]{2,9}(?:\s+\d{4})?[\s$:.\-_|]*)?(?:\(?\$?/?(?:cwt|lb)s?\)?[\s$:.\-_|]*|(?:price|prices|per|dollars|announced)[\s$:.\-_|]*)*"


def find_hits(t):
    """Label hits, longest first, decoys removed."""
    hits = []
    for key, rx in LABELS:
        for m in re.finditer(rx, t, re.I):
            hits.append([m.start(), m.end(), key])
    hits.sort(key=lambda h: (h[0], -(h[1] - h[0])))
    kept = []
    for h in hits:
        if kept and h[0] < kept[-1][1]:      # overlaps an earlier, longer/equal hit
            continue
        # "Class II Butterfat Price:" is the Class II fat price, not the FMMO
        # butterfat component price. Same for any label right after "Class I..IV".
        if h[2] in LB_KEYS and re.search(r"Class\s+(?:I|II|III|IV)[ \t]+$", t[max(0, h[0] - 14):h[0]]):
            continue
        kept.append(h)
    return kept


def collect_candidates(text, with_blocks=False):
    """{key: [values...]} with every plausible value, in text order.
    with_blocks=True also returns {key: [block ids]} in the same order: "R<n>" for a
    column-header run, "P<n>" for the blank-line-separated paragraph of an inline hit.
    Two readers: S2 (a run of column headers, then numbers in order) and
    S1 (label, filler, number). A label consumed by an S2 run is not read by S1."""
    t = first_page(norm(text))
    hits = find_hits(t)
    cands = {k: [] for k, _ in LABELS}
    blks = {k: [] for k, _ in LABELS}
    used = set()
    # S2: runs of adjacent labels
    i = 0
    while i < len(hits):
        j = i
        while j + 1 < len(hits) and re.match(HDR_GAP, t[hits[j][1]:hits[j + 1][0]], re.I | re.S):
            j += 1
        if j > i:
            run = hits[i:j + 1]
            pos = run[-1][1]
            vals, ok = [], True
            for h in run:
                rx = NUM2 if h[2] in CLASS_KEYS else NUM4
                m = re.compile(NUM_LEAD + rx, re.I).match(t, pos)
                if not m:
                    ok = False
                    break
                vals.append(float(m.group(1)))
                pos = m.end()
            if ok:
                for h, v in zip(run, vals):
                    cands[h[2]].append(v)
                    blks[h[2]].append("R%d" % i)
                used.update(range(i, j + 1))
        i = j + 1
    # S1: label + filler + number
    for idx, (s, e, key) in enumerate(hits):
        if idx in used:
            continue
        rx = NUM2 if key in CLASS_KEYS else NUM4
        m = re.compile(r"(?:%s){0,240}?%s" % (GAP, rx), re.I).match(t, e)
        if m:
            cands[key].append(float(m.group(1)))
            blks[key].append("P%d" % len(re.findall(r"\n[ \t]*\n", t[:s])))
    lo_hi = {k: (CLASS_RANGE if k in CLASS_KEYS else LB_RANGE) for k in cands}
    keep = {k: [i for i, v in enumerate(vs) if lo_hi[k][0] <= v <= lo_hi[k][1]] for k, vs in cands.items()}
    vals_out = {k: [cands[k][i] for i in ix] for k, ix in keep.items()}
    if with_blocks:
        return vals_out, {k: [blks[k][i] for i in ix] for k, ix in keep.items()}
    return vals_out


def majority(vals):
    """Single value, or None if there are several distinct with no strict majority."""
    if not vals:
        return None
    counts = {}
    for v in vals:
        counts[v] = counts.get(v, 0) + 1
    top = sorted(counts.items(), key=lambda kv: -kv[1])
    if len(top) == 1 or top[0][1] > top[1][1]:
        return top[0][0]
    return None


def r4(x):
    return round(x + 1e-12, 4)


def identity_errors(c):
    """Deviations of the three CONTRACT identities. {name: abs error}."""
    return {
        "butterfat": abs((c["butter"] - 0.2272) * 1.211 - c["butterfat"]),
        "other_solids": abs((c["whey"] - 0.2668) * 1.03 - c["other_solids"]),
        "nonfat_solids": abs((c["ndm"] - 0.2393) * 0.99 - c["nonfat_solids"]),
    }


def identities_hold(c):
    return all(e <= TOL for e in identity_errors(c).values())


# FMMO composition factors for the skim/fat class formulas, in ONE place.
# In force since 2025-12-01 (same as LB and the 0.965 split in milk-prices.html near
# MA_CHEESE, 7 CFR 1000.50). A future FMMO rule change means editing these and
# nothing else. If they go stale the cross-check fails LOUD (status "partial" and a
# ::warning::); it never silently passes.
FACTORS_EFFECTIVE = "2025-12-01"
SKIM_SHARE = 0.965        # skim share of a cwt after the fat split
LB_PROTEIN = 3.3          # lb protein per cwt skim
LB_OTHER = 6.0            # lb other solids per cwt skim
LB_NONFAT = 9.3           # lb nonfat solids per cwt skim
LB_FAT = 3.5              # lb butterfat per cwt milk
CLASS_XCHECK_TOL = 0.02   # $/cwt
CHEESE_TOL = 0.005        # $/lb protein gap above which cheese is dropped
CLASS2_BAND = (-0.5, 3.0)  # sanity band for Class II minus Class IV, $/cwt (a sanity band, not a formula)


def class_from_components(c):
    """Class III and IV from the validated components. Unrounded, so compare with a
    tolerance. August 2026: III 16.6396 (announced 16.64), IV 17.3635 (17.36)."""
    fat = LB_FAT * c["butterfat"]
    return {"class3": SKIM_SHARE * (LB_PROTEIN * c["protein"] + LB_OTHER * c["other_solids"]) + fat,
            "class4": SKIM_SHARE * (LB_NONFAT * c["nonfat_solids"]) + fat}


def class3_math(comp):
    """The Class III component math the page prints, from the ANNOUNCED
    components, at full precision and then rounded the way 7 CFR 1000.50 rounds
    it (the skim milk price to the cent before the 0.965 split).

    September 2026: protein 2.6619 x 3.3 + other solids 0.4147 x 6.0 =
    11.27247 -> 11.2725 exact, $11.27 as rounded; 0.965 x 11.27 + 3.5 x 1.4762
    = 16.0423 -> $16.04, the announced price. The page used to print the
    rounded skim with four decimals ("$11.2700"), which no reader could
    reproduce from the two products beside it."""
    p, os_, fat = comp.get("protein"), comp.get("other_solids"), comp.get("butterfat")
    if not all(isinstance(x, (int, float)) for x in (p, os_, fat)):
        return None
    skim_exact = r4(LB_PROTEIN * p + LB_OTHER * os_)
    skim = round(skim_exact + 1e-9, 2)
    c3_exact = r4(SKIM_SHARE * skim + LB_FAT * fat)
    return {"protein": p, "other_solids": os_, "butterfat": fat,
            "lb_protein": LB_PROTEIN, "lb_other": LB_OTHER, "lb_fat": LB_FAT, "skim_share": SKIM_SHARE,
            "skim_exact": skim_exact, "skim": skim, "class3_exact": c3_exact,
            "class3": round(c3_exact + 1e-9, 2)}


def protein_from(cheese, fat):
    """Same skim protein formula as milk-prices.html proteinPrice(); used only to
    break ties between candidates and as a note. It is NOT a hard gate, because a
    rule change would move it while the three identities still hold."""
    c = cheese - 0.2519
    return c * 1.383 + (c * 1.589 - fat * 0.91) * 1.17


def pick_components(cands):
    """(block|None, notes[], reason|None). block = the 8 $/lb values."""
    keys = ["butterfat", "protein", "nonfat_solids", "other_solids",
            "butter", "ndm", "cheese", "whey"]
    pools = []
    for k in keys:
        seen = []
        for v in cands.get(k, []):
            if v not in seen:
                seen.append(v)
        if not seen:
            return None, [], "no plausible value found for %s" % k
        pools.append(seen[:5])
    good = []
    for combo in itertools.product(*pools):
        c = dict(zip(keys, combo))
        if identities_hold(c):
            good.append(c)
    if not good:
        first = {k: p[0] for k, p in zip(keys, pools)}
        errs = identity_errors(first)
        return None, [], ("identity check failed on the first candidates (%s); errors %s"
                          % (", ".join("%s=%s" % (k, first[k]) for k in keys),
                             ", ".join("%s %.4f" % (k, v) for k, v in errs.items())))
    notes = []
    if len({tuple(sorted(g.items())) for g in good}) > 1:
        tied = [g for g in good if abs(protein_from(g["cheese"], g["butterfat"]) - g["protein"]) <= TOL]
        if len({tuple(sorted(g.items())) for g in tied}) != 1:
            return None, [], "several value sets satisfy the identities; layout is ambiguous"
        good = tied
    best = dict(good[0])
    dev = abs(protein_from(best["cheese"], best["butterfat"]) - best["protein"])
    if dev > CHEESE_TOL:
        # The three identities never touch cheese. Cheese and butterfat drive protein,
        # so a cheese price that does not reproduce the protein price is not trusted.
        notes.append("cheese %.4f omitted: protein formula gives %.4f, report shows %.4f"
                     % (best["cheese"], protein_from(best["cheese"], best["butterfat"]), best["protein"]))
        del best["cheese"]
    elif dev > TOL:
        notes.append("protein formula cross-check not confirmed")
    return best, notes, None


def parse_month(text, today):
    """(key 'YYYY-MM' | None, label, reason)."""
    t = first_page(norm(text))
    id_key = None
    m = re.search(r"CLS\s*[-]?\s*(\d{2})\s*[-/]?\s*(\d{2})\b", t, re.I)
    if m:
        mm, yy = int(m.group(1)), int(m.group(2))
        if 1 <= mm <= 12:
            id_key = "%d-%02d" % (2000 + yy, mm)
    txt = []
    for m in re.finditer(r"\b(%s)[a-z]*\.?\s+(\d{4})\b" % "|".join(x[:3] for x in MONTHS), t, re.I):
        mi = MON_IDX.get(m.group(1).lower())
        if mi:
            txt.append("%s-%02d" % (m.group(2), mi))
    key = None
    if id_key:
        if txt and id_key not in txt:
            return None, None, "report id says %s but the text names %s" % (id_key, sorted(set(txt)))
        key = id_key
    elif txt:
        # No report id, so the month is a guess unless a printed issue date backs it.
        # Keep only months whose window right after the month contains a printed date.
        ok = [k for k in sorted(set(txt)) if parse_release(t, k)]
        if len(ok) != 1:
            return None, None, ("no report id and no single month backed by a printed issue date "
                                "(months named %s, backed %s)" % (sorted(set(txt)), ok))
        key = ok[0]
    else:
        return None, None, "no month found in the report"
    y, mo = int(key[:4]), int(key[5:])
    cur = (today.year, today.month)
    if (y, mo) > cur:
        return None, None, "month %s is in the future" % key
    if (cur[0] * 12 + cur[1]) - (y * 12 + mo) > 4:
        return None, None, "month %s is more than four months old" % key
    return key, "%s %d" % (MONTHS[mo - 1], y), None


def parse_release(text, key):
    """Issue date printed on the report: the earliest date within 25 days after the
    end of the price month. None if not found (then the field is omitted)."""
    t = first_page(norm(text))
    y, mo = int(key[:4]), int(key[5:])
    start = datetime.date(y + (mo == 12), mo % 12 + 1, 1)
    end = start + datetime.timedelta(days=25)
    found = []
    for m in re.finditer(r"\b(%s)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b" % "|".join(x[:3] for x in MONTHS), t, re.I):
        found.append((m.start(), m.group(3), MON_IDX.get(m.group(1).lower()), m.group(2)))
    for m in re.finditer(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", t):
        found.append((m.start(), m.group(3), int(m.group(1)), m.group(2)))
    for m in re.finditer(r"\b(\d{4})-(\d{2})-(\d{2})\b", t):
        found.append((m.start(), m.group(1), int(m.group(2)), m.group(3)))
    for _, yy, mm, dd in sorted(found):
        try:
            d = datetime.date(int(yy), int(mm), int(dd))
        except (ValueError, TypeError):
            continue
        if start <= d <= end:
            return d.isoformat()
    return None


def parse_highlights(text):
    """The Highlights paragraph: "Class II Price was $18.71 per hundredweight for the
    month of August 2026. The price per hundredweight decreased $3.18 from the
    previous month." Returns {class2: (value, signed_change), ...}. Unchanged -> 0.0."""
    t = re.sub(r"\s+", " ", first_page(norm(text)))
    out = {}
    for m in re.finditer(r"Class (II|III|IV) Price was \$(\d{1,2}\.\d{2}) per hundredweight for the month of "
                         r"[A-Za-z]+ \d{4}\. The price per hundredweight "
                         r"(?:(increased|decreased) \$(\d{1,2}\.\d{2})|(?:was |remained )?unchanged) "
                         r"from the previous month", t):
        k = {"II": "class2", "III": "class3", "IV": "class4"}[m.group(1)]
        chg = 0.0 if not m.group(3) else float(m.group(4)) * (1 if m.group(3) == "increased" else -1)
        out.setdefault(k, (float(m.group(2)), chg))
    return out


def parse_ams(text, today=None):
    """Full parse. Returns dict:
      ok_class: bool, class: {...}, month_key, month_label, release,
      components: {...}|None, notes: [..], problems: [..]
    Class block and components block are validated independently."""
    today = today or datetime.datetime.now(datetime.timezone.utc).date()
    res = {"ok_class": False, "class": {}, "month_key": None, "month_label": None,
           "release": None, "components": None, "notes": [], "problems": []}
    key, label, why = parse_month(text, today)
    if not key:
        res["problems"].append("month: " + why)
        return res
    res["month_key"], res["month_label"] = key, label
    res["release"] = parse_release(text, key)
    if not res["release"]:
        res["notes"].append("issue date not found")
    cands, blocks = collect_candidates(text, with_blocks=True)
    comp, notes, why = pick_components(cands)
    if comp is None:
        res["problems"].append("components withheld: " + why)
    else:
        res["components"] = comp
        res["notes"].extend(notes)
    expect = class_from_components(comp) if comp else {}
    cls, partial, acc_blocks = {}, [], set()
    for k in ("class3", "class4"):
        vals = cands.get(k, [])
        if k in expect:                       # gate III and IV against the components
            near = sorted(set(v for v in vals if abs(v - expect[k]) <= CLASS_XCHECK_TOL),
                          key=lambda v: abs(v - expect[k]))
            v = near[0] if near else None
            if v is None:
                seen = sorted(set(vals))
                partial.append("%s disagrees with the components: report shows %s, components give %.2f; not published"
                               % (k, seen if seen else "nothing", expect[k]))
        else:
            v = majority(vals)
            if v is None:
                partial.append("%s: %s; not published" % (k, "ambiguous %s" % sorted(set(vals)) if vals else "not found"))
        if v is not None:
            cls[k] = v
            acc_blocks.update(b for x, b in zip(vals, blocks[k]) if x == v)
    # Class II has no components formula here, so it is only accepted next to
    # Class III/IV that were accepted. A prior-month or advanced row must not slip in.
    v2s = cands.get("class2", [])
    if "class3" not in cls or "class4" not in cls:
        partial.append("class2 not published: class3 or class4 was withheld, so its month cannot be confirmed"
                       if v2s else "class2: not found; not published")
    else:
        same = sorted(set(x for x, b in zip(v2s, blocks["class2"]) if b in acc_blocks))
        band = sorted(set(x for x in v2s if CLASS2_BAND[0] <= x - cls["class4"] <= CLASS2_BAND[1]))
        pick = same[0] if len(same) == 1 else None
        if pick is None and len(same) > 1:
            in_band = [x for x in same if x in band]
            pick = in_band[0] if len(in_band) == 1 else None
        if pick is None and not same:
            pick = majority([x for x in v2s if x in band])
        if pick is None:
            partial.append("class2 not published: %s" % ("ambiguous %s" % sorted(set(v2s)) if v2s else "not found"))
        else:
            cls["class2"] = pick
    if not comp:
        res["notes"].append("class prices not cross-checked")
    res["class"] = cls
    res["highlights"] = parse_highlights(text)
    res["ok_class"] = bool(cls)
    res["partial"] = partial
    res["problems"].extend(partial)
    return res


# ---------------------------------------------------------------- document building
def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def atomic_write(path, obj):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def prev_key(key):
    y, m = int(key[:4]), int(key[5:])
    return "%d-%02d" % ((y - 1, 12) if m == 1 else (y, m - 1))


def short_label(label):
    mon, yr = label.split()
    return "%s %s" % (mon[:3], yr)


CLASS_FIELDS = ["class_month", "class_month_key", "class_release", "class2", "class3", "class4",
                "class2_prev", "class3_prev", "class4_prev", "class3_label", "class4_label",
                "components", "butter", "ndm", "cheese", "whey",
                "butter_chg", "ndm_chg", "cheese_chg", "whey_chg", "spot_date",
                "survey_cheese", "survey_whey", "survey_fat"]


def class_block(parsed, history):
    """Build the month-bound fields. Only from what was validated and what
    history actually holds."""
    key, label = parsed["month_key"], parsed["month_label"]
    b = {"class_month": label, "class_month_key": key}
    if parsed["release"]:
        b["class_release"] = parsed["release"]
    for k in ("class2", "class3", "class4"):
        if k in parsed["class"]:
            b[k] = parsed["class"][k]
    prior = (history.get("months") or {}).get(prev_key(key)) or {}
    for k in ("class2", "class3", "class4"):
        if k in b and isinstance(prior.get(k), (int, float)):
            b[k + "_prev"] = prior[k]
    # No prior month in history: derive it from the report's own "from the previous
    # month" sentence, but only when that sentence quotes the same price we accepted.
    for k, (hv, chg) in (parsed.get("highlights") or {}).items():
        if k in b and hv == b[k] and k + "_prev" not in b:
            b[k + "_prev"] = round(hv - chg, 2)
    for k in ("class3", "class4"):
        if k in b:
            b[k + "_label"] = "announced \u00b7 " + short_label(label)
    comp = parsed["components"]
    if comp:
        b["components"] = {k: comp[k] for k in ("butterfat", "protein", "nonfat_solids", "other_solids")}
        m3 = class3_math(b["components"])
        if m3:
            b["class3_math"] = m3
        for k in ("butter", "ndm", "cheese", "whey"):
            if k not in comp:
                continue
            b[k] = comp[k]
            if isinstance(prior.get(k), (int, float)):
                b[k + "_chg"] = r4(comp[k] - prior[k])
        b["spot_date"] = "USDA survey avg · " + short_label(label)
        if "cheese" in comp:
            b["survey_cheese"] = comp["cheese"]
        b["survey_whey"] = comp["whey"]
        # survey_fat: milk-prices.html SEED.fat is the BUTTERFAT PRICE in $/lb. It goes
        # into proteinPrice(cheese, fat) as fat*0.91 and into classIII() as LB.fat*fat
        # (3.5 lb of fat per cwt). That is exactly the announced butterfat component
        # price, so it is copied as is, not derived. Check: cheese 1.6203 and butterfat
        # 1.5107 give protein 2.8281 in that same JS formula.
        b["survey_fat"] = comp["butterfat"]
    return b


def history_record(parsed):
    rec = dict(parsed["class"])
    if parsed["components"]:
        rec.update(parsed["components"])
    if parsed["release"]:
        rec["release"] = parsed["release"]
    return rec


def compose(existing, parsed, ams_err, nass, nass_err, history, now_iso, states=None, states_err=None):
    """Returns (new_doc|None, new_history, summary). None means: write nothing."""
    existing = existing if isinstance(existing, dict) else None
    hist = copy.deepcopy(history) if isinstance(history, dict) else {}
    hist.setdefault("months", {})
    status = {}
    doc = copy.deepcopy(existing) if existing else {}
    have_key = (existing or {}).get("class_month_key")
    hist_max = max(hist["months"]) if hist["months"] else None
    newest_held = max([k for k in (have_key, hist_max) if k], default=None)
    published = False

    if parsed and parsed["ok_class"]:
        key = parsed["month_key"]
        if newest_held and key < newest_held:
            status["class"] = "stale"
            status["note"] = "AMS report is for %s, older than %s already held; not published" % (key, newest_held)
        else:
            block = class_block(parsed, hist)
            if have_key == key:
                # Same month again: merge. Only fields that are present now overwrite;
                # a validated value already held is never deleted by a degraded re-read.
                for f, v in block.items():
                    if not parsed["components"] and f in doc and f.startswith("class") and f[-1].isdigit():
                        continue      # an uncross-checked class price never replaces a held one
                    if f == "components" and isinstance(doc.get(f), dict):
                        doc[f] = dict(doc[f], **v)
                    else:
                        doc[f] = v
            else:
                for f in CLASS_FIELDS:
                    doc.pop(f, None)
                doc.update(block)
            doc["sources"] = {"class": AMS_URL, "all_milk": "https://quickstats.nass.usda.gov/"}
            rec = dict(hist["months"].get(key) or {})
            rec.update(history_record(parsed))
            if hist["months"].get(key) != rec:
                hist["months"][key] = rec
            status["class"] = "partial" if parsed.get("partial") else "ok"
            notes = []
            if not parsed["components"]:
                notes.append("components withheld: " + "; ".join(p for p in parsed["problems"] if p.startswith("components")))
            notes.extend(parsed.get("partial", []))
            notes.extend(parsed["notes"])
            if notes:
                status["note"] = "; ".join(notes)
            published = True
    else:
        status["class"] = "failed"
        why = ams_err or "; ".join((parsed or {}).get("problems", [])) or "unknown"
        status["note"] = "last good kept; " + why

    if nass:
        old = (doc.get("all_milk") or {}).get("month_key")
        if old and nass["month_key"] < old:
            status["all_milk"] = "stale"
            status["note"] = (status.get("note", "") + "; " if status.get("note") else "") + "NASS month older than held"
        else:
            doc["all_milk"] = nass
            status["all_milk"] = "ok"
    else:
        # Keep the last good value if one is held; it is marked stale, not deleted.
        # With none held the field stays omitted (never 0).
        status["all_milk"] = "stale" if doc.get("all_milk") else "failed"
        if nass_err:
            status["note"] = (status.get("note", "") + "; " if status.get("note") else "") + "all_milk: " + nass_err

    # State all-milk table: same keep-last-good rule as the national value.
    held_st = doc.get("all_milk_states")
    if states:
        if held_st and states["month_key"] < held_st.get("month_key", ""):
            status["all_milk_states"] = "stale"
        else:
            doc["all_milk_states"] = states
            status["all_milk_states"] = "ok"
    else:
        status["all_milk_states"] = "stale" if held_st else "failed"
        if states_err:
            status["note"] = (status.get("note", "") + "; " if status.get("note") else "") + "all_milk_states: " + states_err

    if not existing and not published:
        return None, history, {"wrote": False, "status": status}

    doc["status"] = status
    strip = lambda d: {k: v for k, v in d.items() if k != "updated"}  # noqa: E731
    if published:
        if existing and strip(existing) == strip(doc):
            doc = existing                       # identical: byte-stable, commits nothing
        else:
            doc["updated"] = now_iso
    else:
        doc["updated"] = existing.get("updated", now_iso) if existing else now_iso
    order = ["updated"] + [k for k in doc if k != "updated"]
    doc = {k: doc[k] for k in order if k in doc}
    return doc, hist, {"wrote": True, "status": status, "published": published}


# ---------------------------------------------------------------- run / probe
def run(root, ams=None, nass_rows=None, nass_key=None, now=None, state_rows=None):
    """ams = (raw, text, err); nass_rows and state_rows = (rows, err). Injected in tests.
    When nass_rows is injected and state_rows is not, the state query is treated as
    not run (no network in tests)."""
    root = Path(root)
    now = now or datetime.datetime.now(datetime.timezone.utc)
    if ams is None:
        ams = fetch_ams()
    if nass_rows is None:
        nass_rows = fetch_nass(nass_key, now.year)
        if state_rows is None:
            state_rows = fetch_nass(nass_key, now.year, agg="STATE")
    if state_rows is None:
        state_rows = (None, "not queried")
    raw, text, ams_err = ams
    parsed = parse_ams(text, now.date()) if text else None
    nass, nass_err = None, nass_rows[1]
    if nass_rows[0] is not None:
        nass, nass_err = parse_nass(nass_rows[0])
    states, states_err = None, state_rows[1]
    if state_rows[0] is not None:
        if nass is None:               # national query failed: use a US TOTAL row if the state query has one
            nass, _ = parse_nass(state_rows[0])
            if nass:
                nass_err = None
        states, states_err = parse_nass_states(state_rows[0], nass["month_key"] if nass else None)
    existing = read_json(root / OUT)
    history = read_json(root / HIST) or {}
    doc, hist, info = compose(existing, parsed, ams_err, nass, nass_err, history,
                              now.strftime("%Y-%m-%dT%H:%M:%SZ"), states, states_err)
    if info["wrote"]:
        if hist != (history if history else {}) and hist.get("months"):
            atomic_write(root / HIST, hist)
        if doc != existing:
            atomic_write(root / OUT, doc)
    return info


def probe(root, key, now=None):
    root = Path(root)
    now = now or datetime.datetime.now(datetime.timezone.utc)
    rd = root / RAW_DIR
    rd.mkdir(parents=True, exist_ok=True)
    raw, text, err = fetch_ams()
    print("AMS  %s" % AMS_URL)
    if raw is not None:
        (rd / "ams-class-prices.raw").write_bytes(raw)
        print("  got %d bytes (%s)" % (len(raw), "PDF" if raw[:5] == b"%PDF-" else "not a PDF"))
    if err:
        print("  ERROR:", err)
    if text is not None:
        (rd / "ams-class-prices.txt").write_text(text)
        p = parse_ams(text, now.date())
        print("  text: %d chars -> data/dairy-raw/ams-class-prices.txt" % len(text))
        print("  month: %s (%s)  release: %s" % (p["month_label"], p["month_key"], p["release"]))
        print("  class:", p["class"] or "NOT PARSED")
        print("  components:", p["components"] or "NOT PARSED/WITHHELD")
        for x in p["problems"] + p["notes"]:
            print("  note:", x)
        c = collect_candidates(text)
        print("  raw candidates:", {k: v for k, v in c.items() if v})
    rows, nerr = fetch_nass(key, now.year)
    print("NASS %s" % NASS_SHORT)
    if rows is None:
        print("  ERROR:", nerr)
        summary = {"error": nerr}
    else:
        slim = [{k: r.get(k) for k in ("year", "reference_period_desc", "freq_desc", "class_desc",
                                        "agg_level_desc", "short_desc", "Value")} for r in rows]
        slim.sort(key=lambda r: (str(r["year"]), str(r["reference_period_desc"])))
        summary = {"query": {k: v for k, v in nass_params("***", now.year).items()},
                   "row_count": len(rows), "last_rows": slim[-30:]}
        n, why = parse_nass(rows)
        print("  %d rows; parsed: %s" % (len(rows), n or "NOT PARSED (%s)" % why))
        if slim:
            print("  distinct reference periods:", sorted({str(r["reference_period_desc"]) for r in slim}))
    (rd / "nass-response.json").write_text(json.dumps(summary, indent=1) + "\n")
    raw_st = []
    srows, serr = fetch_nass(key, now.year, agg="STATE", raw_out=raw_st)
    print("NASS state query (agg_level_desc=STATE)")
    if srows is None:
        print("  ERROR:", serr)
    else:
        sp, swhy = parse_nass_states(srows, n["month_key"] if rows is not None and n else None)
        print("  %d rows; parsed: %s" % (len(srows), ("%d states for %s" % (len(sp["rows"]), sp["month"])) if sp else "NOT PARSED (%s)" % swhy))
    (rd / "nass-states-response.txt").write_text(((raw_st[0][:3000]) if raw_st else "(no response: %s)" % serr) + "\n")
    return 0


# ---------------------------------------------------------------- selftest
# The fixtures below are RECONSTRUCTIONS of plausible report layouts. They use the
# real published August 2026 values (CLS-0826, issued 2026-09-02) but are NOT
# captures of the real PDF. Passing here proves the parser copes with these three
# shapes, not that it reads the real file. Run --probe on the first live run.
VALS = dict(class2=18.71, class3=16.64, class4=17.36, butterfat=1.5107, protein=2.8281,
            nonfat_solids=1.3456, other_solids=0.4052, butter=1.4747, ndm=1.5985,
            cheese=1.6203, whey=0.6602)

FIX_TABLE = """
                     ANNOUNCEMENT OF CLASS AND COMPONENT PRICES                      CLS - 0826
                                   Issued September 2, 2026
Class III milk is priced from cheese and whey. The Class III price for August 2026 is $16.64 per cwt.

              Class II         Class III         Class IV
  August       $18.71            $16.64            $17.36

            Butterfat    Protein    Nonfat Solids    Other Solids
             $1.5107     $2.8281       $1.3456          $0.4052

  Product Price Averages
            Butter       NFDM       Cheese      Dry Whey
            1.4747       1.5985     1.6203       0.6602
"""

FIX_ROWS = """
USDA Agricultural Marketing Service - Dairy Programs             CLS-0826
Announcement of Class and Component Prices        Release date: 09/02/2026
Prices for the month of August 2026

Class II Price ....................... $ 18.71     21.89
Class III Price ...................... $ 16.64     15.52
Class IV Price ....................... $ 17.36     18.34
Butterfat Price ...................... $ 1.5107
Protein Price ........................ $ 2.8281
Nonfat Solids Price .................. $ 1.3456
Other Solids Price ................... $ 0.4052
Average Butter Price ................. $ 1.4747
Average Nonfat Dry Milk Price ........ $ 1.5985
Average Cheese Price (40-lb block) ... $ 1.6203
Average Dry Whey Price ............... $ 0.6602
"""

FIX_VERTICAL = """
Announcement of Class and Component Prices
CLS - 0826
Issue Date: September 2, 2026
Month: August 2026

Class II
$18.71

Class III
$16.64

Class IV
$17.36

Butterfat
1.5107

Protein
2.8281

Nonfat Solids
1.3456

Other Solids
0.4052

Butter
1.4747

Nonfat Dry Milk
1.5985

Cheese
1.6203

Dry Whey
0.6602
"""


# REAL TEXT. The first 60 lines of three USDA AMS reports as `pdftotext -layout`
# printed them (public-domain USDA text, footnote glyphs and page break kept;
# <FF> stands for the form feed). REAL_AUG26 is the file the workflow will see.
# REAL_JAN26 was filed as classprc1225.pdf but is CLS-0126 (January 2026).
# REAL_AUG25 is CLS-0825 (old formulas).
REAL_AUG26 = """                                               Announcement of Class and
                                                  Component Prices
Email us with accessibility issues regarding
this report.
                                                    United States Department of Agriculture
Agricultural Marketing Service                      Dairy Program                        Market Information Branch
CLS - 0826                                                                                          September 2, 2026

August 2026 Highlights

Class II Price was $18.71 per hundredweight for the month of August 2026. The price per hundredweight decreased
$3.18 from the previous month. Class III Price was $16.64 per hundredweight for the month of August 2026. The
price per hundredweight increased $1.12 from the previous month. Class IV Price was $17.36 per hundredweight for
the month of August 2026. The price per hundredweight decreased $0.98 from the previous month.

Announcement of Class and Component Prices for August 2026

Class II Price:                                                             $18.71 (per hundredweight)
Class II Butterfat Price:                                                  $1.5177 (per pound)
Class II Skim Milk Price ¹:                                                 $13.88 (per hundredweight)

Class III Price:                                                            $16.64 (per hundredweight)
Class III Skim Milk Price ²:                                                $11.76 (per hundredweight)

Class IV Price:                                                             $17.36 (per hundredweight)
Class IV Skim Milk Price ²:                                                 $12.51 (per hundredweight)

Butterfat Price ²:                                                         $1.5107   (per pound)
Nonfat Solids Price ²:                                                     $1.3456   (per pound)
Protein Price ²:                                                           $2.8281   (per pound)
Other Solids Price ²:                                                      $0.4052   (per pound)

Somatic Cell Adjustment Rate:                                              0.00081 (per 1,000 somatic cell count)

Product Price Averages:
Butter                                                                      $1.4747 (per pound)
Nonfat Dry Milk                                                             $1.5985 (per pound)
Cheese ² ³                                                                  $1.6203 (per pound)
Dry Whey                                                                    $0.6602 (per pound)
¹ July 2026 Advanced Price Announcement.
² Per Final Rule 90 FR 6600, published in the Federal Register on January 17, 2025, changes were made to the
pricing formulas. See the methodology section (p. 5) for details.
³ The cheese price is derived using the weighted average of cheddar cheese in 40-pound blocks for the previous four
or five weeks (depending on date of last publication), weighted by sales volume in pounds.
<FF>                                   Class and Component Prices
                                USDA - Agricultural Marketing Service
                                                                                                 September 2, 2026

                     Federal Milk Order Class II, Class III, and Class IV Milk Prices, 2026

                                 Class II                     Class III                    Class IV
                     Class II                   Class III                    Class IV
             Month               Butterfat                   Skim Milk                    Skim Milk
                      Price                       Price                        Price
                                  Price                         Price                        Price

                      ($/cwt)      ($/lb)                         (dollars per cwt)
             Jan      13.92       1.4595         14.59          9.85           13.55           8.77
             Feb      15.34       1.7864         14.94          9.03           16.29          10.43
             Mar      17.34       2.0290         16.16          9.41           18.94          12.29""".replace("<FF>", "\f")

REAL_JAN26 = """                                               Announcement of Class and
                                                  Component Prices
Email us with accessibility issues regarding
this report.
                                                    United States Department of Agriculture
Agricultural Marketing Service                      Dairy Program                        Market Information Branch
CLS - 0126                                                                                           February 4, 2026

January 2026 Highlights

Class II Price was $13.92 per hundredweight for the month of January 2026. The price per hundredweight decreased
$0.49 from the previous month. Class III Price was $14.59 per hundredweight for the month of January 2026. The
price per hundredweight decreased $1.27 from the previous month. Class IV Price was $13.55 per hundredweight for
the month of January 2026. The price per hundredweight decreased $0.09 from the previous month.

Announcement of Class and Component Prices for January 2026

Class II Price:                                                             $13.92 (per hundredweight)
Class II Butterfat Price:                                                  $1.4595 (per pound)
Class II Skim Milk Price ¹:                                                  $9.13 (per hundredweight)

Class III Price:                                                            $14.59 (per hundredweight)
Class III Skim Milk Price ²:                                                 $9.85 (per hundredweight)

Class IV Price:                                                             $13.55 (per hundredweight)
Class IV Skim Milk Price ²:                                                  $8.77 (per hundredweight)

Butterfat Price ²:                                                         $1.4525   (per pound)
Nonfat Solids Price ²:                                                     $0.9433   (per pound)
Protein Price ²:                                                           $2.1768   (per pound)
Other Solids Price ²:                                                      $0.4448   (per pound)

Somatic Cell Adjustment Rate:                                              0.00070 (per 1,000 somatic cell count)

Product Price Averages:
Butter                                                                      $1.4266 (per pound)
Nonfat Dry Milk                                                             $1.1921 (per pound)
Cheese ² ³                                                                  $1.4003 (per pound)
Dry Whey                                                                    $0.6986 (per pound)
¹ December 2025 Advanced Price Announcement.
² Per Final Rule 90 FR 6600, published in the Federal Register on January 17, 2025, changes were made to the
pricing formulas. See the methodology section (p. 5) for details.
³ The cheese price is derived using the weighted average of cheddar cheese in 40-pound blocks for the previous four
or five weeks (depending on date of last publication), weighted by sales volume in pounds.
<FF>                                   Class and Component Prices
                                USDA - Agricultural Marketing Service
                                                                                                      February 4, 2026

                     Federal Milk Order Class II, Class III, and Class IV Milk Prices, 2026

                                 Class II                     Class III                    Class IV
                     Class II                   Class III                    Class IV
             Month               Butterfat                   Skim Milk                    Skim Milk
                      Price                       Price                        Price
                                  Price                         Price                        Price

                      ($/cwt)      ($/lb)                         (dollars per cwt)
              Jan     13.92       1.4595         14.59          9.85           13.55           8.77

""".replace("<FF>", "\f")

REAL_AUG25 = """                                               Announcement of Class and
                                                  Component Prices
Email us with accessibility issues regarding
this report.
                                                    United States Department of Agriculture
Agricultural Marketing Service                      Dairy Program                        Market Information Branch
CLS - 0825                                                                                          September 4, 2025

August 2025 Highlights

Class II Price was $19.18 per hundredweight for the month of August 2025. The price per hundredweight decreased
$0.13 from the previous month. Class III Price was $17.24 per hundredweight for the month of August 2025. The
price per hundredweight decreased $0.08 from the previous month. Class IV Price was $18.50 per hundredweight for
the month of August 2025. The price per hundredweight decreased $0.39 from the previous month.

Announcement of Class and Component Prices for August 2025

Class II Price:                                                             $19.18 (per hundredweight)
Class II Butterfat Price:                                                  $2.7325 (per pound)
Class II Skim Milk Price ¹:                                                  $9.96 (per hundredweight)

Class III Price:                                                            $17.24 (per hundredweight)
Class III Skim Milk Price ²:                                                 $7.98 (per hundredweight)

Class IV Price:                                                             $18.50 (per hundredweight)
Class IV Skim Milk Price ²:                                                  $9.29 (per hundredweight)

Butterfat Price ²:                                                         $2.7255   (per pound)
Nonfat Solids Price ²:                                                     $1.0323   (per pound)
Protein Price ²:                                                           $1.9646   (per pound)
Other Solids Price ²:                                                      $0.3204   (per pound)

Somatic Cell Adjustment Rate:                                              0.00088 (per 1,000 somatic cell count)

Product Price Averages:
Butter                                                                      $2.4778 (per pound)
Nonfat Dry Milk                                                             $1.2820 (per pound)
Cheese ² ³                                                                  $1.7529 (per pound)
Dry Whey                                                                    $0.5779 (per pound)
¹ July 2025 Advanced Price Announcement.
² Per Final Rule 90 FR 6600, published in the Federal Register on January 17, 2025, changes were made to the
pricing formulas. See the methodology section (p. 5) for details.
³ The cheese price is derived using the weighted average of cheddar cheese in 40-pound blocks for the previous four
or five weeks (depending on date of last publication), weighted by sales volume in pounds.
<FF>                                   Class and Component Prices
                                USDA - Agricultural Marketing Service
                                                                                                 September 4, 2025

                     Federal Milk Order Class II, Class III, and Class IV Milk Prices, 2025

                                 Class II                     Class III                    Class IV
                     Class II                   Class III                    Class IV
             Month               Butterfat                   Skim Milk                    Skim Milk
                      Price                       Price                        Price
                                  Price                         Price                        Price

                      ($/cwt)      ($/lb)                         (dollars per cwt)
             Jan      21.58       2.9530         20.34         10.39           20.73          10.80
             Feb      21.08       2.8256         20.18         10.69           19.90          10.40
             Mar      20.12       2.6312         18.62          9.78           18.21           9.35""".replace("<FF>", "\f")

TODAY = datetime.date(2026, 9, 27)
NOW = datetime.datetime(2026, 9, 27, 12, 0, 0, tzinfo=datetime.timezone.utc)


def selftest():
    m = class3_math({"protein": 2.6619, "other_solids": 0.4147, "butterfat": 1.4762})
    assert (m["skim_exact"], m["skim"], m["class3"]) == (11.2725, 11.27, 16.04), m
    assert class3_math({"protein": None, "other_solids": 0.4, "butterfat": 1.4}) is None
    fails = []

    def ck(name, cond):
        if not cond:
            fails.append(name)
            print("FAIL:", name)

    # 0. REAL text (pdftotext -layout), the file the workflow will see
    AUG_EXPECT = dict(class2=18.71, class3=16.64, class4=17.36)
    p = parse_ams(REAL_AUG26, TODAY)
    ck("real Aug 2026: classes", p["class"] == AUG_EXPECT and not p["partial"] and not p["notes"])
    ck("real Aug 2026: components", p["components"] == {
        "butterfat": 1.5107, "protein": 2.8281, "nonfat_solids": 1.3456, "other_solids": 0.4052,
        "butter": 1.4747, "ndm": 1.5985, "cheese": 1.6203, "whey": 0.6602})
    ck("real Aug 2026: month and release", p["month_key"] == "2026-08" and p["release"] == "2026-09-02")
    ck("real Aug 2026: decoy Class II butterfat 1.5177 not used", p["components"]["butterfat"] == 1.5107)
    ck("real Aug 2026: Class III skim 11.76 confirms 3.3*P+6*OS",
       round(LB_PROTEIN * 2.8281 + LB_OTHER * 0.4052, 2) == 11.76)
    p = parse_ams(REAL_JAN26, datetime.date(2026, 2, 10))
    ck("real Jan 2026: classes", p["class"] == dict(class2=13.92, class3=14.59, class4=13.55) and not p["partial"])
    ck("real Jan 2026: month, release, components",
       p["month_key"] == "2026-01" and p["release"] == "2026-02-04" and p["components"]["protein"] == 2.1768
       and p["components"]["cheese"] == 1.4003)
    ck("real Jan 2026 today (Sep 2026): refused as too old", not parse_ams(REAL_JAN26, TODAY)["ok_class"])
    p = parse_ams(REAL_AUG25, datetime.date(2025, 9, 10))
    ck("real Aug 2025 (old formulas): class prices refused, nothing published",
       not p["ok_class"] and p["class"] == {} and len(p["partial"]) == 3)
    with tempfile.TemporaryDirectory() as dd:
        run(dd, ams=(b"x", REAL_AUG26, None), nass_rows=(None, "k"), now=NOW)
        before = (Path(dd) / OUT).read_bytes()
        run(dd, ams=(b"x", REAL_AUG25, None), nass_rows=(None, "k"),
            now=datetime.datetime(2025, 9, 10, 12, tzinfo=datetime.timezone.utc))
        after = read_json(Path(dd) / OUT)
        ck("Aug 2025 report does not replace Aug 2026", after["class3"] == 16.64 and after["status"]["class"] == "failed")
        run(dd, ams=(b"x", REAL_JAN26, None), nass_rows=(None, "k"),
            now=datetime.datetime(2026, 2, 10, 12, tzinfo=datetime.timezone.utc))
        after = read_json(Path(dd) / OUT)
        ck("Jan 2026 report is stale against Aug 2026 on file",
           after["class_month_key"] == "2026-08" and after["status"]["class"] == "stale")
    # pypdf-style extraction: no column alignment, footnote marks as plain digits
    flat = "\n".join(re.sub(r" +", " ", ln) for ln in REAL_AUG26.split("\n"))
    for a, b in (("\u00b9", "1"), ("\u00b2", "2"), ("\u00b3", "3")):
        flat = flat.replace(a, b)
    ck("flat text has digit footnotes", "Protein Price 2: $2.8281" in flat and "Cheese 2 3 $1.6203" in flat)
    for nm, txt in (("pypdf style", flat), ("no form feeds", flat.replace("\f", "\n"))):
        p = parse_ams(txt, TODAY)
        ck(nm + ": classes", p["class"] == AUG_EXPECT and not p["partial"])
        ck(nm + ": footnote digit is not the value",
           p["components"] is not None and p["components"]["protein"] == 2.8281
           and p["components"]["cheese"] == 1.6203 and p["components"]["butterfat"] == 1.5107)
        ck(nm + ": month/release", p["month_key"] == "2026-08" and p["release"] == "2026-09-02")
    # NASS: US and state series (real July 2026 values), (D), US TOTAL
    def qs(state, yr, per, val, agg="STATE"):
        return {"state_name": state, "year": yr, "reference_period_desc": per, "Value": val,
                "freq_desc": "MONTHLY", "agg_level_desc": agg, "class_desc": "ALL CLASSES"}
    st_rows = [qs("US TOTAL", "2026", "JUL", "20.30"), qs("US TOTAL", "2026", "JUN", "21.10"), qs("US TOTAL", "2025", "JUL", "20.80"),
               qs("WISCONSIN", "2026", "JUL", "18.20"), qs("WISCONSIN", "2026", "JUN", "18.60"), qs("WISCONSIN", "2025", "JUL", "19.80"),
               qs("MINNESOTA", "2026", "JUL", "18.70"), qs("MINNESOTA", "2026", "JUN", "18.70"), qs("MINNESOTA", "2025", "JUL", "20.20"),
               qs("ALASKA", "2026", "JUL", "(D)"), qs("NEW YORK", "2026", "JUL", "21.70"),
               qs("VERMONT", "2026", "JUN", "22.00")]
    sp, why = parse_nass_states(st_rows, "2026-07")
    ck("states: sorted, no US TOTAL, no (D) state, no state without the month",
       [r["state"] for r in sp["rows"]] == ["Minnesota", "New York", "Wisconsin"])
    wi = [r for r in sp["rows"] if r["state"] == "Wisconsin"][0]
    ck("state row has prev and year-ago", wi == {"state": "Wisconsin", "value": 18.2, "prev_month": 18.6, "year_ago": 19.8})
    ck("state row without history omits it", [r for r in sp["rows"] if r["state"] == "New York"][0] == {"state": "New York", "value": 21.7})
    ck("states month", sp["month"] == "July 2026" and sp["month_key"] == "2026-07")
    ck("states without month_key use the latest", parse_nass_states(st_rows)[0]["month_key"] == "2026-07")
    ck("states none -> None, not empty rows", parse_nass_states([qs("ALASKA", "2026", "JUL", "(D)")])[0] is None)
    us, _ = parse_nass(st_rows)
    ck("US from a US TOTAL row",
       us == {"value": 20.3, "month": "July 2026", "month_key": "2026-07", "source": "NASS Agricultural Prices",
              "prev_month": 21.1, "year_ago": 20.8})
    with tempfile.TemporaryDirectory() as dd:
        # national query failed, state query fine: US value from US TOTAL, states published
        run(dd, ams=(b"x", REAL_AUG26, None), nass_rows=(None, "NASS fetch failed: x"), state_rows=(st_rows, None), now=NOW)
        sd = read_json(Path(dd) / OUT)
        ck("all_milk from US TOTAL when national failed",
           sd["all_milk"]["value"] == 20.3 and sd["all_milk"]["prev_month"] == 21.1 and sd["status"]["all_milk"] == "ok")
        ck("all_milk_states published",
           sd["all_milk_states"]["rows"][2]["state"] == "Wisconsin" and sd["status"]["all_milk_states"] == "ok")
        # state query fails later: last good kept, marked stale
        run(dd, ams=(b"x", REAL_AUG26, None), nass_rows=(None, "boom"), state_rows=(None, "boom"), now=NOW)
        sd = read_json(Path(dd) / OUT)
        ck("state failure keeps last good, stale",
           sd["all_milk_states"]["rows"][0]["state"] == "Minnesota" and sd["status"]["all_milk_states"] == "stale"
           and sd["status"]["all_milk"] == "stale")
    # highlights-derived prior month
    p = parse_ams(REAL_AUG26, TODAY)
    ck("highlights parsed", p["highlights"] == {"class2": (18.71, -3.18), "class3": (16.64, 1.12), "class4": (17.36, -0.98)})
    with tempfile.TemporaryDirectory() as dd:
        run(dd, ams=(b"x", REAL_AUG26, None), nass_rows=(None, "k"), now=NOW)
        hd = read_json(Path(dd) / OUT)
        ck("prev derived from highlights", (hd["class2_prev"], hd["class3_prev"], hd["class4_prev"]) == (21.89, 15.52, 18.34))
    with tempfile.TemporaryDirectory() as dd:
        atomic_write(Path(dd) / HIST, {"months": {"2026-07": dict(class2=21.90, class3=15.50, class4=18.30)}})
        run(dd, ams=(b"x", REAL_AUG26, None), nass_rows=(None, "k"), now=NOW)
        hd = read_json(Path(dd) / OUT)
        ck("history prior month wins over highlights", (hd["class2_prev"], hd["class3_prev"], hd["class4_prev"]) == (21.90, 15.50, 18.30))
    bad = REAL_AUG26.replace("Class III Price was $16.64", "Class III Price was $16.46")
    with tempfile.TemporaryDirectory() as dd:
        run(dd, ams=(b"x", bad, None), nass_rows=(None, "k"), now=NOW)
        hd = read_json(Path(dd) / OUT)
        ck("mismatched highlight ignored", "class3_prev" not in hd and hd["class3"] == 16.64 and hd["class2_prev"] == 21.89)
    # 1. three layouts parse to the known values, with month and release
    for nm, fx in (("table", FIX_TABLE), ("rows", FIX_ROWS), ("vertical", FIX_VERTICAL)):
        p = parse_ams(fx, TODAY)
        ck(nm + ": class ok", p["ok_class"])
        for k in ("class2", "class3", "class4"):
            ck("%s: %s" % (nm, k), p["class"].get(k) == VALS[k])
        c = p["components"] or {}
        for k in ("butterfat", "protein", "nonfat_solids", "other_solids", "butter", "ndm", "cheese", "whey"):
            ck("%s: %s" % (nm, k), c.get(k) == VALS[k])
        ck(nm + ": month", p["month_key"] == "2026-08" and p["month_label"] == "August 2026")
        ck(nm + ": release", p["release"] == "2026-09-02")
    # 2. identity gate: accepts the truth, rejects transposed digits
    ck("identities hold on truth", identities_hold(VALS))
    bad = dict(VALS, butterfat=1.5170)
    ck("identities reject transposed butterfat", not identities_hold(bad))
    corrupted = FIX_ROWS.replace("1.4747", "1.4774")
    p = parse_ams(corrupted, TODAY)
    ck("corrupted product: components withheld", p["components"] is None)
    ck("corrupted product: class still ok", p["ok_class"])
    ck("corrupted product: problem stated", any("identity" in x for x in p["problems"]))
    # 2b. class III/IV cross-check against the components (FMMO factors of 2025-12-01)
    exp = class_from_components(VALS)
    ck("formula III", abs(exp["class3"] - 16.6396) < 0.0005 and abs(exp["class4"] - 17.3635) < 0.0005)
    decoy = ("Advanced prices for September 2026: Class III $17.05  Class IV $17.40\n" + FIX_ROWS)
    p = parse_ams(decoy, TODAY)
    ck("decoy advanced Class III not chosen", p["class"].get("class3") == 16.64 and p["class"].get("class4") == 17.36)
    ck("decoy: no partial", not p["partial"])
    wrong = FIX_ROWS.replace("$ 16.64", "$ 17.05")
    p = parse_ams(wrong, TODAY)
    ck("disagreeing class III omitted", "class3" not in p["class"] and p["class"].get("class4") == 17.36
       and "class2" not in p["class"] and p["components"] is not None)
    ck("disagreement names both numbers", any("class3" in x and "17.05" in x and "16.64" in x for x in p["partial"]))
    nocomp = FIX_ROWS.replace("1.4747", "1.4774")
    p = parse_ams(nocomp, TODAY)
    ck("fallback: classes range-checked and noted",
       p["class"].get("class3") == 16.64 and "class prices not cross-checked" in p["notes"])
    with tempfile.TemporaryDirectory() as dd:
        run(dd, ams=(b"x", wrong, None), nass_rows=(None, "k"), now=NOW)
        pd_ = read_json(Path(dd) / OUT)
        ck("partial published, class3 absent",
           pd_["status"]["class"] == "partial" and "class3" not in pd_ and "class3_label" not in pd_
           and pd_["class4"] == 17.36 and pd_["components"]["protein"] == 2.8281)
        ck("partial note is loud", "17.05" in pd_["status"]["note"])
    # 2c. Class II must come from the accepted block, never a prior-month row
    prior = ("Class II Price ....... $ 21.89\nClass III Price ...... $ 15.52\nClass IV Price ....... $ 18.34\n\n" + FIX_ROWS)
    p = parse_ams(prior, TODAY)
    ck("prior-month rows above: current class II", p["class"].get("class2") == 18.71 and not p["partial"])
    both_bad = FIX_ROWS.replace("$ 16.64", "$ 15.52").replace("$ 17.36", "$ 18.34")
    p = parse_ams("Class II Price ....... $ 21.89\n\n" + both_bad, TODAY)
    ck("class III/IV withheld -> class II withheld, no mixed month",
       set(p["class"]) == set() and any("class2" in x for x in p["partial"]))
    # 2d. month without an id needs a printed issue date in the window
    noid = ("Advanced Class I prices for September 2026: $19.10\nAnnouncement of Class and Component Prices\n"
            "Prices for August 2026. Issued September 2, 2026\n" + FIX_ROWS.split("\n", 4)[4])
    p = parse_ams(noid, TODAY)
    ck("no id: August chosen over advanced September", p["month_key"] == "2026-08" and p["ok_class"])
    ck("no id and no printed date: refused", not parse_ams(noid.replace("Issued September 2, 2026", ""), TODAY)["ok_class"])
    ck("id and text disagree: nothing published",
       not parse_ams("CLS - 0826\nPrices for July 2026\n" + FIX_ROWS.split("\n", 4)[4], TODAY)["ok_class"])
    # 2e. cheese is validated through the protein formula
    p = parse_ams(FIX_ROWS.replace("1.6203", "1.6230"), TODAY)
    ck("bad cheese dropped, rest kept", p["components"] is not None and "cheese" not in p["components"]
       and p["components"]["whey"] == 0.6602 and p["ok_class"] and any("cheese" in x for x in p["notes"]))
    with tempfile.TemporaryDirectory() as dd:
        run(dd, ams=(b"x", FIX_ROWS.replace("1.6203", "1.6230"), None), nass_rows=(None, "k"), now=NOW)
        cd = read_json(Path(dd) / OUT)
        ck("feed omits cheese and survey_cheese, says so",
           "cheese" not in cd and "survey_cheese" not in cd and "cheese" in cd["status"].get("note", "")
           and cd["survey_whey"] == 0.6602)
    # 3. a stray number after a label must not win over the identities
    stray = FIX_ROWS + "\nButter = 0.2272 plus adjustment\n"
    p = parse_ams(stray, TODAY)
    ck("stray formula number ignored", (p["components"] or {}).get("butter") == 1.4747)
    # 4. month / date parsing
    ck("month from id only", parse_month("CLS - 0826 nothing else", TODAY)[0] == "2026-08")
    ck("month from text with printed date", parse_month("Prices for July 2026. Issued August 4, 2026", TODAY)[0] == "2026-07")
    ck("month from text without date refused", parse_month("Prices for July 2026", TODAY)[0] is None)
    ck("id and text disagree", parse_month("CLS - 0826 for July 2026", TODAY)[0] is None)
    ck("future month refused", parse_month("CLS - 1226", TODAY)[0] is None)
    ck("no month refused", parse_month("no dates here", TODAY)[0] is None)
    ck("release numeric", parse_release("Issued 9/2/2026", "2026-08") == "2026-09-02")
    ck("release absent -> None", parse_release("August 2026 prices", "2026-08") is None)
    # 5. NASS parsing incl. (D) and never zero
    rows = [
        {"year": "2025", "reference_period_desc": "JUL", "Value": "21.30", "class_desc": "ALL CLASSES"},
        {"year": "2026", "reference_period_desc": "JUN", "Value": "20.10", "class_desc": "ALL CLASSES"},
        {"year": "2026", "reference_period_desc": "JUL", "Value": "19.90", "class_desc": "ALL CLASSES"},
        {"year": "2026", "reference_period_desc": "AUG", "Value": "(D)", "class_desc": "ALL CLASSES"},
        {"year": "2026", "reference_period_desc": "YEAR", "Value": "99.00", "class_desc": "ALL CLASSES"},
        {"year": "2026", "reference_period_desc": "SEP", "Value": "(NA)"},
        {"year": "2026", "reference_period_desc": "JUL", "Value": "30.00", "class_desc": "FLUID"},
    ]
    n, why = parse_nass(rows)
    ck("nass latest skips (D)/(NA)/YEAR/other class",
       n == {"value": 19.9, "month": "July 2026", "month_key": "2026-07",
             "source": "NASS Agricultural Prices", "prev_month": 20.1, "year_ago": 21.3})
    n2, why2 = parse_nass([{"year": "2026", "reference_period_desc": "JUL", "Value": "(D)"}])
    ck("nass all suppressed -> None, not 0", n2 is None and why2)
    n3, _ = parse_nass([{"year": "2026", "reference_period_desc": "JUL", "Value": "19.90"}])
    ck("nass without year-ago omits it", n3 is not None and "year_ago" not in n3)
    ck("nass_val flags", nass_val("(D)") is None and nass_val("") is None and nass_val(None) is None
       and nass_val("1,234.5") == 1234.5)
    ck("nass no key -> error", fetch_nass("", 2026)[1] == "no NASS_API_KEY")
    # 6. run(): first run, keep-last-good, stale refusal, idempotence, no zeros
    with tempfile.TemporaryDirectory() as d:
        good = (b"x", FIX_ROWS, None)
        # nothing on file + failure -> writes nothing
        info = run(d, ams=(None, None, "boom"), nass_rows=(None, "no NASS_API_KEY"), now=NOW)
        ck("no file + failure writes nothing", not info["wrote"] and not (Path(d) / OUT).exists())
        # first success, no NASS key
        info = run(d, ams=good, nass_rows=(None, "no NASS_API_KEY"), now=NOW)
        doc = read_json(Path(d) / OUT)
        ck("first run writes feed", doc is not None and doc["class3"] == 16.64)
        ck("no key: all_milk omitted, status failed",
           "all_milk" not in doc and doc["status"]["all_milk"] == "failed")
        ck("no prev without history", "class3_prev" not in doc and "butter_chg" not in doc)
        ck("survey_fat is the butterfat price", doc["survey_fat"] == 1.5107)
        ck("labels", doc["class3_label"].endswith("Aug 2026") and doc["spot_date"].endswith("Aug 2026"))
        hist = read_json(Path(d) / HIST)
        ck("history holds month", "2026-08" in hist["months"] and hist["months"]["2026-08"]["cheese"] == 1.6203)
        ck("no zero values anywhere", not any_zero(doc))
        before = (Path(d) / OUT).read_bytes()
        # rerun same data later: byte-identical
        later = NOW + datetime.timedelta(days=3)
        run(d, ams=good, nass_rows=(None, "no NASS_API_KEY"), now=later)
        ck("idempotent rerun", (Path(d) / OUT).read_bytes() == before)
        # failure: last good kept, only status changes
        run(d, ams=(None, None, "AMS fetch failed: timeout"), nass_rows=(None, "no NASS_API_KEY"), now=later)
        d2 = read_json(Path(d) / OUT)
        ck("failure keeps values", d2["class3"] == 16.64 and d2["components"]["protein"] == 2.8281)
        ck("failure flags status", d2["status"]["class"] == "failed")
        ck("failure keeps updated stamp", d2["updated"] == doc["updated"])
        # stale month refused
        july = (FIX_ROWS.replace("0826", "0726").replace("August 2026", "July 2026")
                .replace("09/02/2026", "08/04/2026"))
        run(d, ams=(b"x", july, None), nass_rows=(None, "no NASS_API_KEY"), now=later)
        d3 = read_json(Path(d) / OUT)
        ck("stale month refused", d3["class_month_key"] == "2026-08" and d3["status"]["class"] == "stale")
        ck("stale month not in history", "2026-07" not in read_json(Path(d) / HIST)["months"])
        # NASS ok next: all_milk appears
        nrows = ([{"year": "2026", "reference_period_desc": "JUL", "Value": "19.90"},
                  {"year": "2025", "reference_period_desc": "JUL", "Value": "21.30"}], None)
        run(d, ams=good, nass_rows=nrows, now=later)
        d4 = read_json(Path(d) / OUT)
        ck("all_milk published", d4["all_milk"]["value"] == 19.9 and d4["status"]["all_milk"] == "ok")
    # 6b. same-month degraded re-read never deletes held validated fields; NASS failure keeps all_milk
    with tempfile.TemporaryDirectory() as dd:
        nrows = ([{"year": "2026", "reference_period_desc": "JUL", "Value": "19.90"}], None)
        run(dd, ams=(b"x", FIX_ROWS, None), nass_rows=nrows, now=NOW)
        degraded = FIX_ROWS.replace("1.4747", "1.4774").replace("$ 16.64", "$ 17.05")
        run(dd, ams=(b"x", degraded, None), nass_rows=(None, "NASS fetch failed: timeout"), now=NOW)
        md = read_json(Path(dd) / OUT)
        ck("held class III/components survive a degraded re-read",
           md["class3"] == 16.64 and md["components"]["protein"] == 2.8281 and md["cheese"] == 1.6203)
        ck("held history record intact", read_json(Path(dd) / HIST)["months"]["2026-08"]["butter"] == 1.4747)
        ck("NASS failure keeps last all_milk as stale",
           md["all_milk"]["value"] == 19.9 and md["status"]["all_milk"] == "stale")
    # 7. prev/chg only from history held; next month uses it
    with tempfile.TemporaryDirectory() as d:
        hist = {"months": {"2026-08": dict(class2=18.71, class3=16.64, class4=17.36, butter=1.4747,
                                           ndm=1.5985, cheese=1.6203, whey=0.6602)}}
        atomic_write(Path(d) / HIST, hist)
        sep = FIX_ROWS.replace("0826", "0926").replace("August 2026", "September 2026")
        sep = sep.replace("09/02/2026", "10/02/2026")
        p = parse_ams(sep, datetime.date(2026, 10, 3))
        ck("sep parse ok", p["ok_class"] and p["month_key"] == "2026-09")
        info = run(d, ams=(b"x", sep, None), nass_rows=(None, "no key"),
                   now=datetime.datetime(2026, 10, 3, 12, tzinfo=datetime.timezone.utc))
        dd = read_json(Path(d) / OUT)
        ck("prev from history", dd["class3_prev"] == 16.64 and dd["class2_prev"] == 18.71)
        ck("chg from history", dd["butter_chg"] == 0.0 and "whey_chg" in dd)
        ck("history append keeps old month", "2026-08" in read_json(Path(d) / HIST)["months"])
    # 8. components withheld but class published; old components not carried across months
    with tempfile.TemporaryDirectory() as d:
        run(d, ams=(b"x", FIX_ROWS, None), nass_rows=(None, "k"), now=NOW)
        sep = (FIX_ROWS.replace("0826", "0926").replace("August 2026", "September 2026")
               .replace("09/02/2026", "10/02/2026").replace("1.4747", "1.4774"))
        run(d, ams=(b"x", sep, None), nass_rows=(None, "k"),
            now=datetime.datetime(2026, 10, 3, 12, tzinfo=datetime.timezone.utc))
        dd = read_json(Path(d) / OUT)
        ck("class published, components dropped",
           dd["class_month_key"] == "2026-09" and "components" not in dd and "butter" not in dd)
        ck("status names withheld components", "components withheld" in dd["status"].get("note", ""))
    # 9. blocked page is not parsed
    ck("html challenge refused", fetch_ams(opener=_fake_opener(b"<html>captcha</html>"))[2] is not None)
    if fails:
        print("selftest FAILED: %d" % len(fails))
        return 1
    print("selftest ok")
    return 0


def any_zero(o):
    if isinstance(o, dict):
        return any(any_zero(v) for v in o.values())
    if isinstance(o, list):
        return any(any_zero(v) for v in o)
    return o == 0 and not isinstance(o, bool)


def _fake_opener(body):
    class R:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return body
    return lambda req, timeout=30: R()


def main(argv):
    key = os.environ.get("NASS_API_KEY", "").strip()
    if "--selftest" in argv:
        return selftest()
    if "--probe" in argv:
        return probe(ROOT, key)
    info = run(ROOT, nass_key=key)
    st = info["status"]
    print("[dairy] wrote=%s class=%s all_milk=%s %s" % (info["wrote"], st.get("class"), st.get("all_milk"),
                                                        st.get("note", "")))
    if st.get("class") != "ok":
        print("::warning::dairy class prices not refreshed: %s" % st.get("note", ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
