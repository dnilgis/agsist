#!/usr/bin/env python3
"""
AGSIST -- data/production-costs.json: fertilizer, farm diesel and propane from the
USDA AMS production cost reports, read through USDA My Market News (the MARS API).

Reports (My Market News slug ids; Nov 2, 2026):
  2863 Iowa (bi-weekly)          3195 Illinois (bi-weekly)
  3621 Oklahoma (bi-weekly)      3159 North Carolina (weekly)
  3883 Inter-Mountain West (monthly: UT, ID, CO, WY)
  3657 Pacific Northwest (bi-weekly)
Each row USDA prints is a dealer asking price: low, high, average and the change
from the last report, per product, with its freight term (F.O.B. or delivered).

Needs MARS_API_KEY (Actions secret; HTTP basic, key as the user, empty password).
The key goes in a header only, never in a URL, a log line or a file.

Modes:
  (default)   fetch each report, validate, write. Keep-last-good per report.
  --selftest  offline tests on the saved MARS answers in test/fixtures/mars-prodcost/
              (the real Oct 26-30, 2026 reports, captured by the MARS map probe).

THE DATE (why data/fertilizer-ams.json says Oct 30 and MARS says Oct 26)
  MARS stamps each report with report_date = report_begin_date, the Monday that
  opens the survey week (10/26/2026). The PDF that scripts/fetch_fert_ams.py reads
  prints the day the report was published, the Friday (Fri Oct 30, 2026), which is
  also MARS's report_end_date and published_date. Same report, same numbers (the
  selftest checks the Illinois fixture against what fertilizer-ams.json carried).
  This file states the published day as the report's date and the Monday only as
  "week of"; a page never prints the Monday as the date of the prices.

WHAT THIS FILE WILL NOT DO
  * Write a number USDA did not print. A row it cannot read cleanly is left out.
  * Write a zero, a price outside its own low-high range, outside a sane band for
    the product, or in a unit it does not expect ($/ton fertilizer, $/gal fuel).
  * Keep a product that appears twice in one report (the page would not know
    which): both lines are left out.
  * Replace a newer report with an older one, or keep a report whose average
    moved more than 60% from the one on file in any product (a misread: the
    whole report is refused and the last good one stays).
  * Keep MARS's raw answer. Only the small derived file goes to data/.
  On any failure the last good report stays and status says why.

daily_line: one plain sentence of farm diesel prices from the reports published
in the newest week, for the Daily to use later (not wired yet), or null when the
newest report is over 10 days old.

Run by .github/workflows/fertilizer-ams.yml (the Friday and Monday runs that
already read the Illinois PDF; every report here posts on Friday).
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import base64
import datetime
import json
import os
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = "data/production-costs.json"
AMS_FILE = "data/fertilizer-ams.json"
FIX_DIR = "test/fixtures/mars-prodcost"
BASE = "https://marsapi.ams.usda.gov/services/v1.2/reports"
UA = "agsist.com production cost feed (contact: sig@agsist.com)"

REPORTS = ["2863", "3195", "3621", "3159", "3883", "3657"]
LOOKBACK_DAYS = 70          # the query window: a monthly report and one missed month
MAX_AGE_DAYS = 120          # an older report is not written at all
MAX_MOVE = 0.60
MIN_ITEMS = 2
FRESH_DAYS = 10             # daily_line only from a report this recent

UNITS = {"Dollars Per Ton": "$/ton", "Dollars Per Gallon": "$/gal"}
# USDA class -> (key, unit, sane band). A class not listed is kept under a slug of
# its own name with the generic band for its unit.
CLASSES = {
    "anhydrous ammonia": ("anhydrous", "$/ton", (300, 2500)),
    "liquid nitrogen (28-0-0)": ("uan28", "$/ton", (100, 1300)),
    "liquid nitrogen (30-0-0)": ("uan30", "$/ton", (100, 1350)),
    "liquid nitrogen (32-0-0)": ("uan32", "$/ton", (100, 1400)),
    "urea (46-0-0)": ("urea", "$/ton", (200, 1800)),
    "dap (diammonium phosphate 18-46-0)": ("dap", "$/ton", (300, 2000)),
    "map (monoammonium phosphate 11-52-0)": ("map", "$/ton", (300, 2000)),
    "potash (red 0-0-60)": ("potash", "$/ton", (150, 1500)),
    "ammonium sulfate": ("ams", "$/ton", (100, 1200)),
    "ammonium polyphosphate (10-34-0)": ("10-34-0", "$/ton", (200, 1800)),
    "ats (sulfate)": ("ats", "$/ton", (100, 1200)),
    "lime": ("lime", "$/ton", (5, 600)),
    "no. 2 diesel (farm)": ("diesel", "$/gal", (1.5, 12)),
    "biodiesel (farm)": ("biodiesel", "$/gal", (1.5, 12)),
    "propane": ("propane", "$/gal", (0.5, 6)),
}
GENERIC_BAND = {"$/ton": (100, 3000), "$/gal": (0.5, 12)}   # lime has its own band; a $31 "ton" is another unit
STATE_NAMES = {"IA": "Iowa", "IL": "Illinois", "OK": "Oklahoma", "NC": "North Carolina"}
MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# ---------------------------------------------------------------- small helpers
def mdy_date(v):
    """'10/30/2026' or '10/30/2026 07:06:03' -> date, else None."""
    m = re.match(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})", str(v or ""))
    if not m:
        return None
    try:
        return datetime.date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    except ValueError:
        return None


def mon_day(iso, year=True):
    d = datetime.date.fromisoformat(iso)
    return "%s %d%s" % (MON3[d.month - 1], d.day, ", %d" % d.year if year else "")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def sections(body):
    """A MARS answer -> {section name: rows}. allSections=true gives a list of
    {reportSection, results}; one section gives {"results": [...]}."""
    try:
        d = json.loads(body) if isinstance(body, (bytes, str)) else body
    except ValueError:
        return {}
    out = {}
    if isinstance(d, dict) and isinstance(d.get("results"), list):
        out[d.get("reportSection") or "default"] = d["results"]
    elif isinstance(d, list):
        for x in d:
            if isinstance(x, dict) and isinstance(x.get("results"), list):
                out.setdefault(x.get("reportSection") or "default", []).extend(x["results"])
    return out


def region_of(title, states):
    """'Iowa Production Cost Report (Bi-Weekly)' -> 'Iowa'."""
    m = re.match(r"^(.*?)\s+Production Cost Report", title or "")
    if m and m.group(1).strip():
        return m.group(1).strip()
    if len(states) == 1 and states[0] in STATE_NAMES:
        return STATE_NAMES[states[0]]
    return " and ".join(states) or "USDA region"


def cadence_of(title):
    t = (title or "").lower()
    return "monthly" if "monthly" in t else "weekly" if "(weekly)" in t else "biweekly" if "bi-weekly" in t or "biweekly" in t else None


# ---------------------------------------------------------------- parsing
def parse_report(rid, body, today):
    """One MARS answer -> (report dict or None, problems[]). The newest survey week
    in the answer is the one read; its header gives title, states and dates."""
    probs = []
    sec = sections(body)
    rows = sec.get("Report Details - Prices") or []
    hdrs = sec.get("Report Header") or []
    if not rows:
        return None, ["no price rows in the answer"]
    weeks = sorted({mdy_date(r.get("report_begin_date") or r.get("report_date")) for r in rows} - {None})
    if not weeks:
        return None, ["no report date on any row"]
    wk = weeks[-1]
    rows = [r for r in rows if mdy_date(r.get("report_begin_date") or r.get("report_date")) == wk]
    hdr = next((h for h in hdrs if mdy_date(h.get("report_begin_date") or h.get("report_date")) == wk), None) or {}
    r0 = rows[0]
    end = mdy_date(r0.get("report_end_date") or hdr.get("report_end_date"))
    pub = mdy_date(r0.get("published_date") or hdr.get("published_Date") or hdr.get("published_date")) or end
    if not pub:
        return None, ["no published date"]
    if pub > today + datetime.timedelta(days=1):
        return None, ["published date %s is in the future" % pub]
    if (today - pub).days > MAX_AGE_DAYS:
        return None, ["newest report published %s, over %d days ago" % (pub, MAX_AGE_DAYS)]
    if hdr and str(hdr.get("final_ind") or "Final").lower() not in ("final", "corrected"):
        probs.append("report marked %s, read anyway" % hdr.get("final_ind"))
    title = (r0.get("report_title") or hdr.get("report_title") or "").strip()
    if str(r0.get("slug_id") or rid) != str(rid):
        return None, ["answer is for report %s, not %s" % (r0.get("slug_id"), rid)]
    geo = r0.get("geographical_location") or hdr.get("geographical_location") or r0.get("market_location_state") or ""
    states = [s.strip().upper() for s in re.split(r"[;,]", geo) if re.fullmatch(r"\s*[A-Za-z]{2}\s*", s)]
    if not states:
        return None, ["no state on the report"]

    items, seen = {}, {}
    for r in rows:
        cls = str(r.get("class") or "").strip()
        unit = UNITS.get(str(r.get("price_unit") or "").strip())
        if not cls:
            continue
        key, want, band = CLASSES.get(cls.lower(), (slug(cls), unit, GENERIC_BAND.get(unit)))
        if unit is None or unit != want:
            probs.append("%s: unit %r not expected, left out" % (cls, r.get("price_unit")))
            continue
        lo, hi, avg = num(r.get("price_min")), num(r.get("price_max")), num(r.get("price_avg"))
        if None in (lo, hi, avg) or min(lo, hi, avg) <= 0:
            probs.append("%s: blank or zero price, left out" % cls)
            continue
        if not (lo - 0.005 <= avg <= hi + 0.005):
            probs.append("%s: average %s outside its range %s-%s, left out" % (cls, avg, lo, hi))
            continue
        if not (band[0] <= lo and hi <= band[1]):
            probs.append("%s: %s-%s outside the sane band %s, left out" % (cls, lo, hi, band))
            continue
        seen[key] = seen.get(key, 0) + 1
        ch = num(r.get("price_change"))
        items[key] = {"key": key, "name": cls, "commod": str(r.get("commod") or ""), "unit": unit,
                      "freight": str(r.get("freight") or "").strip(), "low": lo, "high": hi, "avg": round(avg, 2),
                      "change": None if ch is None else round(ch, 2), "thin": lo == hi}
    for k, n in seen.items():
        if n > 1:
            probs.append("%s: %d lines in one report, both left out" % (k, n))
            items.pop(k, None)
    if len(items) < MIN_ITEMS:
        return None, probs + ["only %d clean products" % len(items)]
    region = region_of(title, states)
    rep = {"id": str(rid), "title": title, "region": region, "states": states, "cadence": cadence_of(title),
           "week_begin": wk.isoformat(), "week_end": end.isoformat() if end else None, "published": pub.isoformat(),
           "credit": "USDA AMS, %s, %s" % (title, mon_day(pub.isoformat())),
           "items": [items[k] for k in sorted(items)]}
    return rep, probs


def compose(old_rep, new_rep):
    """-> (report to keep, why it is not the new one or None)."""
    if new_rep is None:
        return old_rep, "nothing new read"
    if old_rep and new_rep["published"] < old_rep["published"]:
        return old_rep, "report published %s is older than the one on file (%s)" % (new_rep["published"], old_rep["published"])
    if old_rep and old_rep.get("published") != new_rep["published"]:
        prev = {i["key"]: i["avg"] for i in old_rep.get("items", [])}
        for i in new_rep["items"]:
            p = prev.get(i["key"])
            if p and abs(i["avg"] - p) / p > MAX_MOVE:
                return old_rep, "%s moved %.0f%% since the last report: taken as a misread" % (i["key"], 100 * abs(i["avg"] - p) / p)
    return new_rep, None


def daily_line(reports, today):
    """One sentence of farm diesel prices from the reports of the newest week."""
    rs = [r for r in reports.values() if any(i["key"] == "diesel" and not i["thin"] for i in r["items"])]
    if not rs:
        return None
    newest = max(r["published"] for r in rs)
    if (today - datetime.date.fromisoformat(newest)).days > FRESH_DAYS:
        return None
    lo = (datetime.date.fromisoformat(newest) - datetime.timedelta(days=6)).isoformat()
    rs = sorted([r for r in rs if r["published"] >= lo], key=lambda r: REPORTS.index(r["id"]) if r["id"] in REPORTS else 99)
    parts, dates = [], []
    for n, r in enumerate(rs):
        d = next(i for i in r["items"] if i["key"] == "diesel")
        parts.append("%s $%.2f%s%s" % (r["region"], d["avg"], " a gallon" if n == 0 else "",
                                       " delivered" if d["freight"].lower().startswith("delivered") else ""))
        dates.append(r["published"])
    first, last = min(dates), max(dates)
    when = mon_day(last, False) if first == last else "%s to %s" % (mon_day(first, False), mon_day(last, False))
    text = "Farm diesel in USDA's dealer survey: %s (USDA AMS production cost reports, %s)." % (", ".join(parts), when)
    return {"key": "diesel", "date": last, "text": text}


def reconcile(reports, ams):
    """The Illinois MARS report against data/fertilizer-ams.json (the PDF read of the
    same report). -> (note, warning or None)."""
    il = reports.get("3195")
    if not il or not ams or not ams.get("report_date"):
        return "nothing to compare", None
    if ams["report_date"] == il["week_begin"] and il["week_begin"] != il["published"]:
        return None, "fertilizer-ams.json is dated %s, the survey week's Monday, not the published day %s" % (ams["report_date"], il["published"])
    if ams["report_date"] != il["published"]:
        return "different reports on file: PDF %s, MARS %s" % (ams["report_date"], il["published"]), None
    mine = {i["key"]: i["avg"] for i in il["items"]}
    off = ["%s PDF %s MARS %s" % (p["key"], p["avg"], mine.get(p["key"])) for p in ams.get("products", [])
           if p.get("key") in mine and abs(mine[p["key"]] - p["avg"]) > 0.005]
    if off:
        return None, "Illinois %s: PDF and MARS disagree: %s" % (il["published"], "; ".join(off))
    return "Illinois %s: PDF and MARS agree on %d products" % (il["published"], sum(1 for p in ams.get("products", []) if p.get("key") in mine)), None


# ---------------------------------------------------------------- the run
def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def atomic_write(path, obj):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def auth():
    key = os.environ.get("MARS_API_KEY", "").strip()
    if not key:
        return None
    return {"Authorization": "Basic " + base64.b64encode((key + ":").encode()).decode(), "Accept": "application/json"}


def mars_url(rid, today):
    a = today - datetime.timedelta(days=LOOKBACK_DAYS)
    return "%s/%s?q=report_begin_date=%s:%s&allSections=true" % (BASE, rid, a.strftime("%m/%d/%Y"), today.strftime("%m/%d/%Y"))


def default_fetch(hdrs):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from history_lib import Fetcher  # noqa: E402
    f = Fetcher(min_gap=1.0, retries=2, backoff=(10, 30), headers=dict(hdrs, **{"User-Agent": UA}))
    return f.get


def run(root=ROOT, fetch=None, now=None):
    """fetch: url -> (status, body). -> info dict."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    today = now.date()
    old = read_json(Path(root) / OUT) or {}
    old_reps = old.get("reports") or {}
    notes, wrote = {}, []
    if fetch is None:
        h = auth()
        if not h:
            return {"wrote": False, "why": "no MARS_API_KEY: nothing asked", "notes": {}}
        fetch = default_fetch(h)
    reps = dict(old_reps)
    for rid in REPORTS:
        try:
            status, body = fetch(mars_url(rid, today))
        except Exception as e:  # noqa: BLE001  network: keep the last good report
            notes[rid] = "not answering (%s)" % type(e).__name__
            continue
        if status != 200:
            notes[rid] = "MARS answered %s" % status
            continue
        rep, probs = parse_report(rid, body, today)
        keep, why = compose(old_reps.get(rid), rep)
        if keep is not None:
            reps[rid] = keep
        if keep is rep and rep is not None:
            wrote.append(rid)
        msg = "; ".join(([why] if why else []) + probs)
        if msg:
            notes[rid] = msg
    reps = {k: v for k, v in reps.items() if (today - datetime.date.fromisoformat(v["published"])).days <= MAX_AGE_DAYS}
    rec, warn = reconcile(reps, read_json(Path(root) / AMS_FILE))
    doc = {
        "note": "USDA AMS production cost reports: dealer asking prices for fertilizer and farm fuel, low, high and average, "
                "as USDA printed them. Each report's date is the day it was published; week_begin is the Monday that opens its survey week.",
        "source": "USDA AMS, production cost reports, via USDA My Market News",
        "reports": {k: reps[k] for k in sorted(reps)},
        "daily_line": daily_line(reps, today),
        "status": {"ok": bool(reps), "checked": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "notes": notes,
                   "reconcile": rec if rec else warn},
    }
    if not reps:
        return {"wrote": False, "why": "no report read and none on file", "notes": notes, "warn": warn}
    same = old.get("reports") == doc["reports"] and old.get("daily_line") == doc["daily_line"]
    if same:
        old["status"] = doc["status"]
        atomic_write(Path(root) / OUT, old)
    else:
        doc["generated"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
        atomic_write(Path(root) / OUT, doc)
    return {"wrote": not same, "why": None if wrote else "no new report", "new": wrote, "notes": notes, "warn": warn,
            "reports": sorted(reps)}


# ---------------------------------------------------------------- selftest
def selftest():
    fails = []

    def ck(name, cond):
        print(("  ok   " if cond else "  FAIL ") + name)
        if not cond:
            fails.append(name)

    fx = {rid: (Path(ROOT) / FIX_DIR / (rid + ".json")).read_text() for rid in ["2863", "3195", "3621", "3159", "3883"]}
    today = datetime.date(2026, 11, 2)

    # Iowa, the real Oct 26-30 report
    ia, p = parse_report("2863", fx["2863"], today)
    ck("Iowa reads", ia is not None and p == [])
    ck("Iowa dated the published Friday, week of the Monday", ia["published"] == "2026-10-30" and ia["week_begin"] == "2026-10-26" and ia["week_end"] == "2026-10-30")
    by = {i["key"]: i for i in ia["items"]}
    ck("Iowa products", sorted(by) == ["anhydrous", "diesel", "map", "potash", "propane", "uan32"])
    ck("Iowa anhydrous as printed", (by["anhydrous"]["low"], by["anhydrous"]["high"], by["anhydrous"]["avg"], by["anhydrous"]["change"]) == (892, 915, 902.33, -3.17))
    ck("Iowa diesel and propane per gallon", by["diesel"]["unit"] == "$/gal" and by["diesel"]["avg"] == 5.65 and by["propane"]["avg"] == 1.69)
    ck("Iowa region, state, cadence", (ia["region"], ia["states"], ia["cadence"]) == ("Iowa", ["IA"], "biweekly"))
    ck("credit names USDA AMS, the report and the date", ia["credit"] == "USDA AMS, Iowa Production Cost Report (Bi-Weekly), Oct 30, 2026")

    # Illinois: the same report fertilizer-ams.json read from the PDF on Oct 30
    il, p = parse_report("3195", fx["3195"], today)
    ib = {i["key"]: i for i in il["items"]}
    ck("Illinois single-price UAN 32 is marked thin", ib["uan32"]["thin"] is True and ib["anhydrous"]["thin"] is False)
    pdf = {"report_date": "2026-10-30", "products": [{"key": "anhydrous", "avg": 981.11}, {"key": "uan28", "avg": 467.86}, {"key": "uan32", "avg": 540.0},
                                                    {"key": "urea", "avg": 770.0}, {"key": "dap", "avg": 932.14}, {"key": "potash", "avg": 517.73}]}
    note, warn = reconcile({"3195": il}, pdf)
    ck("Illinois MARS matches the PDF file product for product", warn is None and note == "Illinois 2026-10-30: PDF and MARS agree on 6 products")
    note, warn = reconcile({"3195": il}, dict(pdf, report_date="2026-10-26"))
    ck("a file dated the Monday is flagged", note is None and "Monday" in warn)
    bad = dict(pdf, products=[{"key": "urea", "avg": 771.0}])
    ck("a price that differs is flagged", "disagree" in reconcile({"3195": il}, bad)[1])
    ck("Illinois biodiesel kept, not mixed into diesel", "biodiesel" in ib and ib["diesel"]["avg"] == 5.71)

    # Oklahoma (16 lines), North Carolina (delivered lime), Inter-Mountain West (four states, delivered fuel)
    ok, _ = parse_report("3621", fx["3621"], today)
    ck("Oklahoma reads 16 products", ok is not None and len(ok["items"]) == 16)
    nc, _ = parse_report("3159", fx["3159"], today)
    nb = {i["key"]: i for i in nc["items"]}
    ck("North Carolina weekly, UAN 30, lime delivered", nc["cadence"] == "weekly" and "uan30" in nb and nb["lime"]["freight"] == "Delivered (Applied)")
    imw, _ = parse_report("3883", fx["3883"], today)
    ck("Inter-Mountain West covers UT ID CO WY, monthly", imw["states"] == ["UT", "ID", "CO", "WY"] and imw["cadence"] == "monthly" and imw["region"] == "Inter-Mountain West")
    ck("Inter-Mountain diesel is delivered", {i["key"]: i for i in imw["items"]}["diesel"]["freight"] == "Delivered")

    # refusals
    d = json.loads(fx["2863"])
    rows = d[1]["results"]

    def variant(f):
        e = json.loads(fx["2863"])
        f(e[1]["results"])
        return json.dumps(e)
    r, p = parse_report("2863", variant(lambda rs: rs[0].update(price_avg=0)), today)
    ck("a zero is left out, never written", "anhydrous" not in {i["key"] for i in r["items"]} and any("zero" in x for x in p))
    r, p = parse_report("2863", variant(lambda rs: rs[0].update(price_avg=950)), today)
    ck("an average outside its range is left out", "anhydrous" not in {i["key"] for i in r["items"]})
    r, p = parse_report("2863", variant(lambda rs: rs[4].update(price_min=55, price_max=58, price_avg=56)), today)
    ck("diesel at $56 a gallon is outside the band", "diesel" not in {i["key"] for i in r["items"]})
    r, p = parse_report("2863", variant(lambda rs: rs[4].update(price_unit="Dollars Per Ton")), today)
    ck("diesel in $/ton is left out", "diesel" not in {i["key"] for i in r["items"]} and any("unit" in x for x in p))
    r, p = parse_report("2863", variant(lambda rs: rs.append(dict(rs[0], **{"class": "Calcium Nitrate", "price_min": 31, "price_max": 31, "price_avg": 31}))), today)
    ck("calcium nitrate at $31 a ton (Pacific Northwest, Oct 30 live run) is left out", "calcium-nitrate" not in {i["key"] for i in r["items"]})
    r, p = parse_report("2863", variant(lambda rs: rs.append(dict(rs[0], price_min=700, price_max=800, price_avg=750))), today)
    ck("a product on two lines: both left out", "anhydrous" not in {i["key"] for i in r["items"]} and any("2 lines" in x for x in p))
    r, p = parse_report("2863", variant(lambda rs: rs.append(dict(rs[0], report_date="10/12/2026", report_begin_date="10/12/2026", price_avg=800, price_min=790, price_max=810))), today)
    ck("an older week in the same answer is not read", r["week_begin"] == "2026-10-26" and {i["key"]: i for i in r["items"]}["anhydrous"]["avg"] == 902.33)
    ck("a report published in the future is refused", parse_report("2863", fx["2863"], datetime.date(2026, 10, 20))[0] is None)
    ck("a report over 120 days old is refused", parse_report("2863", fx["2863"], datetime.date(2027, 4, 1))[0] is None)
    ck("an empty answer is refused", parse_report("2863", "[]", today)[0] is None and parse_report("2863", "not json", today)[0] is None)
    ck("another report's answer is refused", parse_report("3195", fx["2863"], today)[0] is None)

    # compose: never older over newer, a 60% move is a misread
    older = dict(ia, published="2026-10-16", week_begin="2026-10-12")
    ck("a newer report replaces the old", compose(older, ia) == (ia, None))
    keep, why = compose(ia, older)
    ck("an older report never replaces a newer", keep is ia and "older" in why)
    jump = dict(ia, published="2026-11-13", items=[dict(i, avg=i["avg"] * 1.7) if i["key"] == "anhydrous" else i for i in ia["items"]])
    keep, why = compose(ia, jump)
    ck("a 70% move keeps the last good report", keep is ia and "misread" in why)
    ck("nothing new keeps the last good", compose(ia, None) == (ia, "nothing new read"))

    # daily_line
    allr = {"2863": ia, "3195": il, "3621": ok, "3159": nc, "3883": imw}
    dl = daily_line(allr, today)
    ck("daily line: diesel by region, dated, sourced", dl["text"] == "Farm diesel in USDA's dealer survey: Iowa $5.65 a gallon, Illinois $5.71, Oklahoma $5.54, North Carolina $5.40, Inter-Mountain West $6.03 delivered (USDA AMS production cost reports, Oct 30)." and dl["date"] == "2026-10-30")
    ck("daily line withheld when the newest is over 10 days old", daily_line(allr, datetime.date(2026, 11, 20)) is None)
    ck("daily line has no em dash and stays under 200 characters", "—" not in dl["text"] and len(dl["text"]) < 200)

    # the run: keep-last-good, no key, never the key in a URL
    with tempfile.TemporaryDirectory() as t:
        os.makedirs(os.path.join(t, "data"))
        seen = []

        def fetch(u):
            seen.append(u)
            rid = re.search(r"/reports/(\d+)\?", u).group(1)
            return (200, fx[rid]) if rid in fx else (200, "[]")
        now = datetime.datetime(2026, 11, 2, 16, 0, tzinfo=datetime.timezone.utc)
        info = run(t, fetch, now)
        doc = read_json(os.path.join(t, OUT))
        ck("run writes five reports (the Pacific Northwest answer was empty)", info["wrote"] and sorted(doc["reports"]) == ["2863", "3159", "3195", "3621", "3883"])
        ck("the empty report is noted", "3657" in doc["status"]["notes"])
        ck("every URL asks the last 70 days, all sections, no key", all("allSections=true" in u and "report_begin_date=08/24/2026:11/02/2026" in u and "@" not in u for u in seen))
        ck("no raw MARS field in the file", "slug_name" not in json.dumps(doc) and "office_name" not in json.dumps(doc))

        def down(u):
            raise OSError("down")
        info2 = run(t, down, now + datetime.timedelta(days=3))
        doc2 = read_json(os.path.join(t, OUT))
        ck("MARS down: the last good reports stay", doc2["reports"] == doc["reports"] and "not answering" in doc2["status"]["notes"]["2863"])
        ck("MARS down: nothing new written", info2["wrote"] is False)
        os.environ.pop("MARS_API_KEY", None)
        ck("no key: nothing asked", run(t)["why"].startswith("no MARS_API_KEY"))

    # the live file, when present, follows the same rules
    live = read_json(Path(ROOT) / OUT)
    if live:
        ck("live file: every report has a published date and a credit", all(r.get("published") and r.get("credit", "").startswith("USDA AMS, ") for r in live["reports"].values()))
        ck("live file: no zero", all(i["avg"] > 0 and i["low"] > 0 for r in live["reports"].values() for i in r["items"]))

    print("selftest: %s (%d failed)" % ("ok" if not fails else "FAILED", len(fails)))
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    info = run(ROOT)
    print("[prodcost] wrote=%s new=%s reports=%s %s" % (info["wrote"], ",".join(info.get("new") or []) or "-",
                                                         ",".join(info.get("reports") or []) or "-", info.get("why") or ""))
    for rid, n in sorted((info.get("notes") or {}).items()):
        print("  %s: %s" % (rid, n))
    if info.get("warn"):
        print("::warning title=Production cost dates::%s" % info["warn"])
    if not info.get("reports"):
        print("::warning title=Production cost reports::%s" % info["why"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
