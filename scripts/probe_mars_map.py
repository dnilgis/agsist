#!/usr/bin/env python3
"""probe_mars_map.py -- research probe for the USDA My Market News (MARS API) map
(Sig, Nov 2: "map them, bring a ranked list before building"). Probe only: it
writes nothing a page reads. Everything goes under history/mars-map/ and is saved
to the PRIVATE raw branch by history-backfill.yml (source mars-map); raw MARS
answers never go into data/ on main.

Needs MARS_API_KEY (Actions secret; HTTP basic, key as user, empty password; the
key is never printed or saved).

    python3 scripts/probe_mars_map.py --probe [--out history/mars-map]
        1. scan: slug ids the public catalog does not list (the mandatory
           livestock reports, LM_*, are not in the catalog), header rows of
           the last 10 days, so each answering id is named.
        2. for every candidate slug (CANDIDATES plus every LM_* the scan
           found): history depth (one 45-day header window per sample year),
           release times and report dates over the last 60 days, and one
           sample of every section (last 10 days, trimmed) to samples/.
        Writes map.json (the summary) as it goes.
    python3 scripts/probe_mars_map.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import argparse
import base64
import collections
import datetime
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from history_lib import Fetcher, FetchError, now_iso  # noqa: E402

BASE = "https://marsapi.ams.usda.gov/services/v1.2/reports"
OUT = "history/mars-map"

# the brief's candidates, by catalog slug id (catalog-2026-11-03 on raw)
CANDIDATES = [
    # production costs (fertilizer, fuel)
    "2863", "3195", "3159", "3621", "3883", "3776",
    # bioenergy
    "3616", "3617", "3618",
    # point of sale grain, corn belt and plains first
    "2850", "3192", "3225", "2886", "3049", "3463", "2851", "3186", "3878", "2932", "3043",
    "3147", "3148", "3046", "3223", "2892", "3088",
    # hay
    "2807", "2885", "2935", "2929", "3183", "2905", "2707", "3095", "2243", "2244", "2246",
    # truck rates (specialty crops), feedstuffs, by-products, slaughter
    "2375", "3511", "3510", "3512", "2829", "3208", "3658",
    # dairy beyond the class price and mailbox reports
    "1083", "1089", "1100", "1049", "2995", "1095",
    # direct feeder cattle (state)
    "3455", "3097", "3237",
]
SCAN = [(2440, 2730), (3400, 3460), (3460, 3700), (3880, 4000)]
DEPTH_YEARS = [2001, 2005, 2008, 2012, 2016, 2019, 2022, 2025]
MAX_ROWS = 40          # rows kept per section in a sample


def auth():
    key = os.environ.get("MARS_API_KEY", "").strip()
    if not key:
        return None
    return {"Authorization": "Basic " + base64.b64encode((key + ":").encode()).decode(), "Accept": "application/json"}


def mdy(d):
    return d.strftime("%m/%d/%Y")


def url(slug, a, b, all_sections=False):
    u = "%s/%s?q=report_begin_date=%s:%s" % (BASE, slug, mdy(a), mdy(b))
    return u + "&allSections=true" if all_sections else u


def sections(body):
    """A MARS answer -> [(section name, rows)]. allSections gives a list of section
    objects; one section gives {"results": [...]} or a bare list of rows."""
    try:
        d = json.loads(body) if isinstance(body, (bytes, str)) else body
    except ValueError:
        return []
    if isinstance(d, dict):
        if isinstance(d.get("results"), list):
            return [(d.get("reportSection") or "default", d["results"])]
        return []
    if isinstance(d, list):
        if d and all(isinstance(x, dict) and isinstance(x.get("results"), list) for x in d):
            return [(x.get("reportSection") or "section%d" % i, x["results"]) for i, x in enumerate(d)]
        return [("default", [x for x in d if isinstance(x, dict)])]
    return []


def parse_dt(v):
    if not isinstance(v, str):
        return None
    for f in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(v.strip()[:19], f)
        except ValueError:
            pass
    return None


def describe(rows):
    """Field names, row count, empty cells per field, and the values of short
    low-cardinality text fields (states, classes, units): what a reader of the
    report would see, never a key or a reader's anything."""
    fields = collections.OrderedDict()
    empty = collections.Counter()
    vals = collections.defaultdict(collections.Counter)
    for r in rows:
        for k, v in r.items():
            fields[k] = True
            if v in (None, "", "N/A", "NA") or (isinstance(v, str) and v.strip().lower() in ("not reported", "confidential")):
                empty[k] += 1
            if isinstance(v, str) and len(v) <= 60:
                vals[k][v] += 1
    cats = {k: dict(c.most_common(30)) for k, c in vals.items() if len(c) <= 30 and k not in ("report_date", "published_date", "report_begin_date", "report_end_date")}
    return {"rows": len(rows), "fields": list(fields), "empty": dict(empty), "values": cats}


def header_info(rows):
    title = slug_name = None
    dates, pubs = set(), []
    for r in rows:
        title = title or r.get("report_title")
        slug_name = slug_name or r.get("slug_name")
        d = parse_dt(r.get("report_date") or r.get("report_end_date") or "")
        if d:
            dates.add(d.date().isoformat())
        p = parse_dt(r.get("published_date") or "")
        if p:
            pubs.append(p)
    times = collections.Counter(p.strftime("%H:%M")[:4] + "x" for p in pubs)   # 10-minute buckets
    days = collections.Counter(p.strftime("%a") for p in pubs)
    return {"title": title, "slug_name": slug_name, "dates": sorted(dates), "publish_times": dict(times.most_common(8)),
            "publish_days": dict(days.most_common(7))}


def write(out, doc):
    os.makedirs(out, exist_ok=True)
    tmp = os.path.join(out, "map.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, sort_keys=True)
    os.replace(tmp, os.path.join(out, "map.json"))


def ask(fetch, u):
    try:
        s, b = fetch.get(u)
        return s, b
    except FetchError as e:
        return None, str(e).encode()


def probe(out=OUT, fetch=None, today=None, log=print, scan=SCAN, cands=CANDIDATES, max_minutes=300, clock=time.monotonic):
    a = auth()
    doc = {"read": now_iso(), "key_present": bool(a), "scan": {}, "reports": {}}
    log("MARS key present: %s" % bool(a))
    if not a and fetch is None:
        doc["why"] = "no MARS_API_KEY: nothing asked"
        write(out, doc)
        return doc
    fetch = fetch or Fetcher(min_gap=1.2, retries=2, timeout=120, headers=a, ok=(200, 204, 400, 404))
    today = today or datetime.date.today()
    start = clock()
    late = lambda: max_minutes and (clock() - start) > max_minutes * 60  # noqa: E731
    # 1. scan for ids the catalog leaves out
    for lo, hi in scan:
        for i in range(lo, hi):
            sid = str(i)
            if sid in cands or late():
                continue
            s, b = ask(fetch, url(sid, today - datetime.timedelta(days=10), today))
            secs = sections(b) if s == 200 else []
            rows = secs[0][1] if secs else []
            if s == 200 and rows:
                h = header_info(rows)
                doc["scan"][sid] = {"status": s, "title": h["title"], "slug_name": h["slug_name"], "dates": h["dates"][-3:]}
                log("  %s %s %s" % (sid, h["slug_name"], (h["title"] or "")[:70]))
            elif s not in (404, 204):
                doc["scan"][sid] = {"status": s, "rows": len(rows)}
        write(out, doc)
    lm = [k for k, v in doc["scan"].items() if (v.get("slug_name") or "").upper().startswith("LM_") or "contract" in (v.get("title") or "").lower()]
    # 2. every candidate
    sd = os.path.join(out, "samples")
    os.makedirs(sd, exist_ok=True)
    for sid in list(cands) + sorted(lm, key=int):
        if late():
            doc.setdefault("skipped_for_time", []).append(sid)
            continue
        rep = {}
        s, b = ask(fetch, url(sid, today - datetime.timedelta(days=60), today))
        rows = (sections(b) or [("", [])])[0][1] if s == 200 else []
        rep["recent"] = dict(header_info(rows), status=s, header_rows=len(rows))
        s, b = ask(fetch, url(sid, today - datetime.timedelta(days=10), today, all_sections=True))
        rep["sections"] = {}
        keep = []
        for name, srows in sections(b) if s == 200 else []:
            rep["sections"][name] = describe(srows)
            keep.append({"reportSection": name, "rows_total": len(srows), "results": srows[:MAX_ROWS]})
        rep["sample_status"] = s
        with open(os.path.join(sd, "%s.json" % sid), "w", encoding="utf-8") as f:
            json.dump(keep, f, indent=1)
        depth = {}
        for y in DEPTH_YEARS:
            if y > today.year:
                continue
            s, b = ask(fetch, url(sid, datetime.date(y, 10, 1), datetime.date(y, 11, 15)))
            n = len((sections(b) or [("", [])])[0][1]) if s == 200 else 0
            depth[str(y)] = n if s == 200 else "HTTP %s" % s
        rep["depth_header_rows_oct1_nov15"] = depth
        have = [int(y) for y, n in depth.items() if isinstance(n, int) and n > 0]
        rep["first_sample_year_with_rows"] = min(have) if have else None
        doc["reports"][sid] = rep
        log("  %s %s: %d recent header rows, first year %s, %d sections" % (
            sid, rep["recent"].get("slug_name"), rep["recent"]["header_rows"], rep["first_sample_year_with_rows"], len(rep["sections"])))
        write(out, doc)
    doc["finished"] = now_iso()
    doc["calls"] = getattr(fetch, "calls", None)
    write(out, doc)
    return doc


def selftest():
    import tempfile
    ok = True

    def ck(name, cond):
        nonlocal ok
        print(("ok   " if cond else "FAIL ") + name)
        ok = ok and cond
    hdr = [{"report_title": "Iowa Daily Cash Grain Bids", "slug_name": "AMS_2850", "report_date": "11/02/2026",
            "published_date": "11/02/2026 14:31:05"}]
    full = [{"reportSection": "Report Header", "results": hdr},
            {"reportSection": "Report Detail", "results": [{"commodity": "Corn", "price": None, "basis": "-.40"},
                                                            {"commodity": "Soybeans", "price": "10.10", "basis": "Not reported"}]}]
    ck("one section from a results dict", sections(json.dumps({"results": hdr}).encode())[0][1] == hdr)
    ck("every section from allSections", [n for n, _ in sections(json.dumps(full))] == ["Report Header", "Report Detail"])
    ck("bad body is no sections", sections(b"<html>") == [])
    d = describe(full[1]["results"])
    ck("empty and not-reported cells counted", d["empty"] == {"price": 1, "basis": 1} and d["rows"] == 2)
    h = header_info(hdr)
    ck("header names the report and its time", h["slug_name"] == "AMS_2850" and h["publish_times"] == {"14:3x": 1} and h["dates"] == ["2026-11-02"])
    calls = []

    class F:
        calls = 0

        def get(self, u):
            calls.append(u)
            if "/2850?" in u:
                return 200, json.dumps(full if "allSections" in u else {"results": hdr}).encode()
            if "/2460?" in u:
                return 200, json.dumps({"results": [{"slug_name": "LM_HG203", "report_title": "Hogs", "report_date": "11/02/2026"}]}).encode()
            return 404, b""
    os.environ.pop("MARS_API_KEY", None)
    with tempfile.TemporaryDirectory() as t:
        doc = probe(out=t, fetch=F(), today=datetime.date(2026, 11, 3), log=lambda *a: None, scan=[(2459, 2462)], cands=["2850"])
        ck("scan names an LM report", doc["scan"].get("2460", {}).get("slug_name") == "LM_HG203")
        ck("the LM report is probed too", "2460" in doc["reports"])
        ck("depth by year", doc["reports"]["2850"]["first_sample_year_with_rows"] == 2001)
        ck("sample saved, rows only", json.load(open(os.path.join(t, "samples", "2850.json")))[1]["rows_total"] == 2)
        ck("no key in any url", not any("Authorization" in u or "@" in u for u in calls))
        ck("map written", os.path.exists(os.path.join(t, "map.json")))
    with tempfile.TemporaryDirectory() as t:
        ck("no key, no fetcher: nothing asked", probe(out=t, log=lambda *a: None)["why"].startswith("no MARS_API_KEY"))
    print("selftest:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--max-minutes", type=int, default=300)
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.probe:
        probe(out=a.out, max_minutes=a.max_minutes, log=lambda *x: print(*x, flush=True))
        return 0
    ap.print_usage()
    return 2


if __name__ == "__main__":
    sys.exit(main())
