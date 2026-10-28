#!/usr/bin/env python3
"""
usda_corrections.py -- corrections USDA published to a report we already use.

WHY. On Oct 23 and 24, 2026 NASS corrected its September 11 Crop Production
corn yields (U.S. 178.5 -> 178.8, Kansas 121 -> 118, Nebraska 177 -> 182).
The site carried September's 178.5 in a dozen places, and three of them grade
something against it: the nowcast's direction calls, the trade-survey track
record and the analyst board. A correction that lives in one person's head is
applied in the one place that person remembers.

THE RULES (honest-numbers):
  * What USDA printed stays printed. History is history; the correction goes
    BESIDE the printed figure, with the notice date and the source.
  * Anything graded against the printed figure is graded against the corrected
    one too, and the record says whether the verdict changed.
  * A figure USDA says changed but did not publish (here: corrected production
    totals) is listed as not on file and never computed.

ONE TABLE: data/usda-corrections.json, keyed by report + release + place.
Every builder that prints or grades a USDA figure asks this module; --check is
the guard that fails the build when a data file or page carries a corrected
figure without its correction.

    python3 scripts/usda_corrections.py --selftest
    python3 scripts/usda_corrections.py --check
"""
import json
import os
import re
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TABLE = os.path.join(ROOT, "data", "usda-corrections.json")

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]
STATES = {"KS": "Kansas", "NE": "Nebraska", "IA": "Iowa", "IL": "Illinois", "MN": "Minnesota",
          "IN": "Indiana", "SD": "South Dakota", "ND": "North Dakota", "OH": "Ohio", "MO": "Missouri",
          "WI": "Wisconsin", "MI": "Michigan", "TX": "Texas", "CO": "Colorado", "KY": "Kentucky"}
EPS = 1e-9


def load(path=None):
    """The list of corrections, or [] when the file is missing or unreadable.
    A missing table means no known correction, never a crash in a builder."""
    try:
        with open(path or TABLE, encoding="utf-8") as f:
            return list(json.load(f).get("corrections") or [])
    except (OSError, ValueError):
        return []


def short_date(iso):
    d = date.fromisoformat(str(iso)[:10])
    return "%s %d, %d" % (MONTHS[d.month - 1][:3], d.day, d.year)


def long_day(iso):
    d = date.fromisoformat(str(iso)[:10])
    return "%s %d" % (MONTHS[d.month - 1], d.day)


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def view(c, geo="US"):
    """One place's correction, flat, for a builder to carry: printed,
    corrected, change, when and where NASS said so."""
    vals = (c.get("values") or {}).get(geo)
    if not vals:
        return None
    p, k = float(vals["printed"]), float(vals["corrected"])
    return {"id": c["id"], "geo": geo, "report": c.get("report_name") or c.get("report"),
            "release": c["release"], "crop": c.get("crop"), "metric": c.get("metric"),
            "unit": c.get("unit"), "printed": vals["printed"], "corrected": vals["corrected"],
            "change": round(k - p, 1), "notice_date": c.get("notice_date"),
            "source": (c.get("sources") or [None])[-1], "sources": c.get("sources") or []}


def find(release, crop, metric="yield", geo="US", corrections=None):
    """The correction for (release, crop, metric, place), or None. A WASDE on
    the same day as the Crop Production it carries uses this too: its yield is
    NASS's figure."""
    rel = str(release or "")[:10]
    for c in (load() if corrections is None else corrections):
        if (c.get("release") == rel and c.get("crop") == crop and c.get("metric") == metric
                and geo in (c.get("values") or {})):
            return view(c, geo)
    return None


def for_value(value, release, crop, metric="yield", geo="US", corrections=None):
    """The correction when `value` IS the printed figure it corrects, else None.
    A value that already equals the corrected one, or anything else, is left
    alone: this never guesses which figure a file meant."""
    v = _num(value)
    if v is None:
        return None
    cv = find(release, crop, metric, geo, corrections)
    if cv and abs(float(cv["printed"]) - v) < EPS:
        return cv
    return None


def release_in_month(month_name, year, crop, metric="yield", corrections=None):
    """A corrected release that fell in the named month and year ('September',
    2026) -> its ISO date, or None. For files that name a report by its month
    ('USDA, September WASDE') rather than its date."""
    if month_name not in MONTHS:
        return None
    mm = "%04d-%02d" % (int(year), MONTHS.index(month_name) + 1)
    for c in (load() if corrections is None else corrections):
        if str(c.get("release", "")).startswith(mm) and c.get("crop") == crop and c.get("metric") == metric:
            return c["release"]
    return None


def label_release(label, near_iso, crop, metric="yield", corrections=None):
    """'USDA, September WASDE' read on or near 2026-10-09 -> '2026-09-11' when a
    correction exists for that month's release; None otherwise."""
    m = re.search(r"\b(%s)\b" % "|".join(MONTHS), str(label or ""))
    if not m or not near_iso:
        return None
    near = date.fromisoformat(str(near_iso)[:10])
    mi = MONTHS.index(m.group(1)) + 1
    year = near.year if mi <= near.month else near.year - 1
    return release_in_month(m.group(1), year, crop, metric, corrections)


def crop_metric(label):
    """'2026/27 corn yield' -> ('corn', 'yield'); anything else -> (None, None)."""
    s = str(label or "").lower()
    crop = "corn" if "corn" in s else ("soybeans" if "soy" in s else None)
    metric = "yield" if "yield" in s else None
    return (crop, metric) if crop and metric else (None, None)


def tag(cv):
    """What a data file carries beside the printed figure."""
    return {"id": cv["id"], "printed": cv["printed"], "corrected": cv["corrected"],
            "notice_date": cv["notice_date"], "source": cv["source"]}


def note(cv, tail=""):
    """The dated line a page prints, in the Daily corrections' voice.
    'USDA correction, Oct 23, 2026: NASS corrected its September 11 Crop
    Production corn yield to 178.8 bu/acre, from 178.5 as first printed.'"""
    where = "" if cv["geo"] == "US" else " for %s" % STATES.get(cv["geo"], cv["geo"])
    unit = " " + cv["unit"] if cv.get("unit") else ""
    s = ("USDA correction, %s: NASS corrected its %s %s %s %s%s to %s%s, from %s as first printed."
         % (short_date(cv["notice_date"]), long_day(cv["release"]), cv["report"], cv["crop"], cv["metric"],
            where, _fmt(cv["corrected"]), unit, _fmt(cv["printed"])))
    return s + (" " + tail.strip() if tail and tail.strip() else "")


def _fmt(v):
    f = float(v)
    return str(int(f)) if f.is_integer() else "%g" % f


# ────────────────────────────── the guard ──────────────────────────────────
DATE_KEYS = ("date", "as_of", "wasde", "release", "usda_before_as_of", "usda_current_as_of", "usda_after_as_of")
SKIP_DATA = {"bids.json", "usda-corrections.json", "search-index.json", "changelog.json", "site-inventory.json"}


def _carries(o, cid):
    t = o.get("nass_correction") if isinstance(o, dict) else None
    if isinstance(t, dict):
        return t.get("id") == cid or any(isinstance(x, dict) and x.get("id") == cid for x in t.values())
    if isinstance(t, list):
        return any(isinstance(x, dict) and x.get("id") == cid for x in t)
    return False


def _strings(o):
    return " ".join(str(v) for v in o.values() if isinstance(v, str))


def scan_obj(doc, corrections, where=""):
    """Every object dated on a corrected release (its own date or an
    ancestor's) that carries the printed figure for that crop as a number and
    does not carry the correction beside it. -> [(where, id, key)]."""
    out = []

    def walk(o, dates, text, path, covered):
        if isinstance(o, list):
            for i, x in enumerate(o):
                walk(x, dates, text, "%s[%d]" % (path, i), covered)
            return
        if not isinstance(o, dict):
            return
        d2 = set(dates) | {str(o[k])[:10] for k in DATE_KEYS if isinstance(o.get(k), str)}
        t2 = (text + " " + _strings(o) + " " + " ".join(o.keys())).lower()
        for c in corrections:
            if c["release"] not in d2 or c.get("crop", "") not in t2:
                continue
            if _carries(o, c["id"]) or c["id"] in covered:
                continue
            for geo, vals in (c.get("values") or {}).items():
                if geo != "US" and not any(str(v) in (geo, STATES.get(geo)) for v in o.values()):
                    continue
                for k, v in o.items():
                    if _num(v) is not None and abs(float(v) - float(vals["printed"])) < EPS and k != "nass_correction":
                        out.append((path or where, c["id"], k))
        cov = set(covered) | {c["id"] for c in corrections if _carries(o, c["id"])}
        for k, v in o.items():
            if k == "nass_correction":
                continue
            walk(v, d2, t2 if isinstance(v, (dict, list)) else text, "%s.%s" % (path, k), cov)

    walk(doc, set(), "", where, set())
    return out


def _page_hits(text, cv):
    """Places a page states the printed figure next to its month."""
    mon = MONTHS[int(cv["release"][5:7]) - 1]
    pv = re.escape(str(cv["printed"]))
    pat = re.compile(r"(%s|%s|%s).{0,160}?(?<![\d.])%s(?![\d])|(?<![\d.])%s(?![\d]).{0,40}?(%s|%s)"
                     % (mon, mon[:3] + r"\b", cv["release"], pv, pv, mon, cv["release"]), re.S)
    return pat.findall(text)


# whats-priced-in, conditions-yield and scorecard folded into usda-calendar and conditions (Oct 2026)
PAGES = ("crop-tour.html", "conditions.html", "index.html", "usda-calendar.html", "wasde.html")


def check(root=ROOT, corrections=None):
    """-> list of problems (empty means every known correction is applied)."""
    cs = load(os.path.join(root, "data", "usda-corrections.json")) if corrections is None else corrections
    probs = []
    if not cs:
        return probs
    ddir = os.path.join(root, "data")
    for n in sorted(os.listdir(ddir)):
        if not n.endswith(".json") or n in SKIP_DATA:
            continue
        p = os.path.join(ddir, n)
        if os.path.getsize(p) > 4_000_000:
            continue
        try:
            with open(p, encoding="utf-8") as f:
                doc = json.load(f)
        except (OSError, ValueError):
            continue
        for w, cid, k in scan_obj(doc, cs, "data/" + n):
            probs.append("%s: %s carries the printed figure in '%s' with no nass_correction beside it" % (w, cid, k))
    # the WASDE archive carries a note on the report whose yield NASS corrected
    for c in cs:
        for ci in c.get("carried_in") or []:
            if ci.get("report") != "wasde":
                continue
            p = os.path.join(ddir, "wasde-history", "%s.json" % c["crop"])
            try:
                with open(p, encoding="utf-8") as f:
                    wh = json.load(f)
            except (OSError, ValueError):
                continue
            if any(r[0] == ci["release"] for r in wh.get("reports") or []):
                notes = wh.get("report_notes") or {}
                if c["id"] not in json.dumps(notes.get(ci["release"]) or {}):
                    probs.append("data/wasde-history/%s.json: report %s has no note for %s"
                                 % (c["crop"], ci["release"], c["id"]))
    for page in PAGES:
        p = os.path.join(root, page)
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as f:
            text = f.read()
        for c in cs:
            cv = view(c, "US")
            if cv and _page_hits(text, cv) and str(cv["corrected"]) not in text:
                probs.append("%s states %s's %s with no corrected %s on the page"
                             % (page, MONTHS[int(c["release"][5:7]) - 1], cv["printed"], cv["corrected"]))
    return probs


# ─────────────────────────────── selftest ──────────────────────────────────
def _selftest():
    fails = []

    def ck(c, m):
        print(("  ok    " if c else "  FAIL  ") + m)
        if not c:
            fails.append(m)
    cs = load()
    ck(any(c["id"] == "nass-crop-production-2026-09-11-corn-yield" for c in cs), "the September 2026 corn correction is on file")
    us = find("2026-09-11", "corn")
    ck(us and us["printed"] == 178.5 and us["corrected"] == 178.8 and us["change"] == 0.3, "U.S. 178.5 -> 178.8, +0.3")
    ks, ne = find("2026-09-11", "corn", geo="KS"), find("2026-09-11", "corn", geo="NE")
    ck(ks["corrected"] == 118 and ks["change"] == -3.0 and ne["corrected"] == 182 and ne["change"] == 5.0,
       "Kansas 121 -> 118 (-3), Nebraska 177 -> 182 (+5)")
    ck(find("2026-10-09", "corn") is None, "October 9 was reviewed and unchanged: no correction")
    ck(find("2026-09-11", "soybeans") is None, "soybeans were not corrected")
    ck(for_value(178.5, "2026-09-11", "corn") is not None, "178.5 on Sep 11 is the printed figure")
    ck(for_value(178.8, "2026-09-11", "corn") is None and for_value(None, "2026-09-11", "corn") is None,
       "the corrected figure, or no figure, is left alone")
    ck(label_release("USDA, September WASDE", "2026-10-09", "corn") == "2026-09-11", "a label names the release")
    ck(label_release("USDA, August WASDE", "2026-10-09", "corn") is None, "August was not corrected")
    ck(crop_metric("2026/27 corn yield") == ("corn", "yield") and crop_metric("2026/27 corn ending stocks") == (None, None),
       "only a yield label maps")
    n = note(us)
    ck(n == "USDA correction, Oct 23, 2026: NASS corrected its September 11 Crop Production corn yield to 178.8 "
            "bu/acre, from 178.5 as first printed.", n)
    ck("for Kansas to 118 bu/acre, from 121" in note(ks), note(ks))
    ck("—" not in n, "no em dash in the note")
    # the guard
    doc = {"rows": [{"date": "2026-09-11", "metric": "2026/27 corn yield", "actual": 178.5}]}
    ck(len(scan_obj(doc, cs)) == 1, "a dated corn row with the printed figure and no correction is caught")
    doc["rows"][0]["nass_correction"] = tag(us)
    ck(scan_obj(doc, cs) == [], "with the correction beside it, it passes")
    ck(scan_obj({"date": "2026-09-11", "metric": "2026/27 soybean yield", "actual": 178.5}, cs) == [],
       "a soybean row is not a corn row")
    ck(scan_obj({"date": "2026-08-10", "crop": "corn", "value": 178.5}, cs) == [],
       "DTN's 178.5 from August 10 is a different number")
    ck(len(scan_obj({"reports": [{"date": "2026-09-11", "metrics": [{"label": "2026/27 corn yield", "actual": 178.5}]}]}, cs)) == 1,
       "a metric under a dated report inherits its date")
    ck(len(scan_obj({"state": "KS", "as_of": "2026-09-11", "crop": "corn", "yield": 121}, cs)) == 1,
       "Kansas's printed 121 is caught on a Kansas row")
    ck(scan_obj({"state": "IA", "as_of": "2026-09-11", "crop": "corn", "yield": 121}, cs) == [],
       "but not on another state's row")
    ck(len(_page_hits("up 2.7 from September's 178.5", us)) == 1 and not _page_hits("DTN 178.5 &middot; 2026-08-10", us),
       "a page stating September's 178.5 is found; DTN's August 178.5 is not")
    print()
    print("usda_corrections: " + ("all passed" if not fails else "%d FAILED" % len(fails)))
    return 1 if fails else 0


def main():
    if "--selftest" in sys.argv:
        return _selftest()
    if "--check" in sys.argv:
        probs = check()
        for p in probs:
            print("  FAIL  " + p)
        print("usda corrections: %s" % ("every known correction is applied" if not probs else "%d place(s) missing it" % len(probs)))
        return 1 if probs else 0
    print(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(main())
