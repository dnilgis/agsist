#!/usr/bin/env python3
"""
stats_ingest.py - daily GA4, Search Console and Bing numbers, kept private.

Sig, Oct 23 2026: "all available tracking reporting, full ingestion and
correlation". This pulls the raw daily rows so they can be joined later on
date + page, and writes them under private/stats/ (gitignored on main). The
workflow saves that folder to the private repo's private-data branch with
scripts/push_raw.sh. Nothing here is committed to this public repo, and the
log prints counts only (the Actions log is public).

One gzipped JSON file per source per data day, overwritten on each run, so a
day that GA4 or Search Console fills in late is refreshed by the next run:
  private/stats/ga4/<date>.json.gz   reports: pages, sources, landing, events, devices, geo
  private/stats/gsc/<date>.json.gz   reports: query_page, device_country
  private/stats/bing/<run date>.json.gz   the Webmaster API snapshot (Bing keeps its own window)
  private/stats/manifest.json        what each run fetched and any per-source error

Each source fails on its own; a missing secret or an API error is written to
the manifest and the others still run. Exit 1 only if every source failed.

Auth: GA4_PROPERTY_ID + GA4_SERVICE_ACCOUNT, GSC_SERVICE_ACCOUNT_JSON (+ GSC_SITE),
BING_API_KEY1 (or BING_API_KEY). Same secrets the other workflows use.

    python3 scripts/stats_ingest.py [--days N] [--out private/stats]
    python3 scripts/stats_ingest.py --selftest
"""
import argparse
import gzip
import json
import os
import sys
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from site_usage_report import (UrllibTransport, google_token, load_key, err_text,  # noqa: E402
                               GA4_API, GA4_SCOPE, GSC_API, GSC_SCOPE, DEFAULT_SITE, FALLBACK_SITE)

REPO = Path(__file__).resolve().parent.parent

GA4_REPORTS = {
    "pages": (["date", "pagePath"], ["screenPageViews", "activeUsers", "sessions", "userEngagementDuration"]),
    "sources": (["date", "sessionSource", "sessionMedium", "sessionCampaignName"], ["sessions", "activeUsers", "newUsers", "engagedSessions"]),
    "landing": (["date", "landingPagePlusQueryString"], ["sessions", "activeUsers", "newUsers"]),
    "landing_source": (["date", "landingPage", "sessionSource", "sessionMedium"], ["sessions", "engagedSessions"]),
    "events": (["date", "eventName", "pagePath"], ["eventCount", "totalUsers"]),
    "devices": (["date", "deviceCategory", "newVsReturning"], ["activeUsers", "sessions"]),
    "geo": (["date", "country", "region", "city"], ["activeUsers", "sessions"]),
}
GSC_REPORTS = {
    "query_page": ["date", "query", "page"],
    "device_country": ["date", "device", "country"],
}
BING_METHODS = ["GetQueryStats", "GetPageStats", "GetRankAndTrafficStats", "GetCrawlStats",
                "GetCrawlIssues", "GetLinkCounts"]
CHUNK_DAYS = 30
GA4_PAGE = 100000
GSC_PAGE = 25000


class SourceError(Exception):
    pass


def chunks(start, end, n=CHUNK_DAYS):
    d = start
    while d <= end:
        e = min(end, d + timedelta(days=n - 1))
        yield d, e
        d = e + timedelta(days=1)


def ga4_date(s):
    return f"{s[:4]}-{s[4:6]}-{s[6:]}" if len(s) == 8 and s.isdigit() else s


def ga4_report(prop, token, transport, dims, mets, start, end):
    rows, offset = [], 0
    while True:
        st, text = transport("POST", f"{GA4_API}/{prop}:runReport", token, {
            "dateRanges": [{"startDate": start.isoformat(), "endDate": end.isoformat()}],
            "dimensions": [{"name": d} for d in dims], "metrics": [{"name": m} for m in mets],
            "limit": GA4_PAGE, "offset": offset})
        if st != 200:
            raise SourceError(f"GA4 HTTP {st}: {err_text(text)}")
        j = json.loads(text)
        got = j.get("rows") or []
        for r in got:
            k = [v.get("value", "") for v in r.get("dimensionValues", [])]
            m = [float(v.get("value") or 0) for v in r.get("metricValues", [])]
            rows.append(k + [int(x) if x.is_integer() else round(x, 2) for x in m])
        offset += len(got)
        if not got or offset >= int(j.get("rowCount") or 0):
            return rows


def ga4(env, transport, token_fn, start, end, log):
    prop = (env.get("GA4_PROPERTY_ID") or "").strip()
    info, why = load_key("GA4_SERVICE_ACCOUNT", env.get("GA4_SERVICE_ACCOUNT"))
    if not prop:
        why = "GA4_PROPERTY_ID is not set"
    if why:
        raise SourceError(why)
    if not prop.startswith("properties/"):
        prop = "properties/" + prop
    token = token_fn(info, GA4_SCOPE)
    days = {}
    for name, (dims, mets) in GA4_REPORTS.items():
        n = 0
        for a, b in chunks(start, end):
            for r in ga4_report(prop, token, transport, dims, mets, a, b):
                day = ga4_date(r[0])
                days.setdefault(day, {"columns": {}, "reports": {}})
                days[day]["columns"][name] = dims[1:] + mets
                days[day]["reports"].setdefault(name, []).append(r[1:])
                n += 1
        log(f"[stats] ga4 {name}: {n} rows")
    return days


def gsc_site(token, transport, env_site, start, end, log):
    last = ""
    for s in dict.fromkeys(x for x in (env_site, DEFAULT_SITE, FALLBACK_SITE) if x):
        url = f"{GSC_API}/sites/{urllib.parse.quote(s, safe='')}/searchAnalytics/query"
        st, text = transport("POST", url, token, {"startDate": start.isoformat(), "endDate": end.isoformat(),
                                                  "dimensions": ["page"], "rowLimit": 1})
        if st == 200:
            return s
        last = f"HTTP {st}: {err_text(text)}"
        if st not in (403, 404):
            break
    raise SourceError(f"no Search Console property accepted the service account ({last})")


def gsc(env, transport, token_fn, start, end, log):
    info, why = load_key("GSC_SERVICE_ACCOUNT_JSON", env.get("GSC_SERVICE_ACCOUNT_JSON"))
    if why:
        raise SourceError(why)
    token = token_fn(info, GSC_SCOPE)
    site = gsc_site(token, transport, (env.get("GSC_SITE") or "").strip(), start, end, log)
    url = f"{GSC_API}/sites/{urllib.parse.quote(site, safe='')}/searchAnalytics/query"
    days = {}
    for name, dims in GSC_REPORTS.items():
        n = 0
        for a, b in chunks(start, end, 7):
            row0 = 0
            while True:
                st, text = transport("POST", url, token, {
                    "startDate": a.isoformat(), "endDate": b.isoformat(), "dimensions": dims,
                    "rowLimit": GSC_PAGE, "startRow": row0, "dataState": "all"})
                if st != 200:
                    raise SourceError(f"Search Console HTTP {st}: {err_text(text)}")
                got = json.loads(text).get("rows") or []
                for r in got:
                    k = r["keys"]
                    days.setdefault(k[0], {"site": site, "columns": {}, "reports": {}})
                    days[k[0]]["columns"][name] = dims[1:] + ["clicks", "impressions", "ctr", "position"]
                    days[k[0]]["reports"].setdefault(name, []).append(
                        k[1:] + [int(r.get("clicks", 0)), int(r.get("impressions", 0)),
                                 round(r.get("ctr", 0), 4), round(r.get("position", 0), 1)])
                n += len(got)
                row0 += len(got)
                if len(got) < GSC_PAGE:
                    break
        log(f"[stats] gsc {name}: {n} rows")
    return days


def bing(env, get, log):
    key = (env.get("BING_API_KEY1") or env.get("BING_API_KEY") or "").strip()
    if not key:
        raise SourceError("BING_API_KEY1 / BING_API_KEY is not set")
    out, errs = {}, []
    site = urllib.parse.quote("https://agsist.com/", safe="")
    for m in BING_METHODS:
        st, text = get(f"https://ssl.bing.com/webmaster/api.svc/json/{m}?siteUrl={site}&apikey={key}")
        if st == 200:
            try:
                out[m] = json.loads(text).get("d")
            except ValueError:
                errs.append(f"{m}: non-JSON")
        else:
            errs.append(f"{m}: HTTP {st}")
        log(f"[stats] bing {m}: HTTP {st}")
    if not out:
        raise SourceError("; ".join(errs) or "no Bing method answered")
    return out, errs


def counts_only(c):
    """The worker /count answer, numbers only: top-level ints and the ints one level down (notices by
    topic). Anything else (text, lists) is dropped, so no address or name can ever reach the file."""
    out = {}
    for k, v in (c or {}).items():
        if isinstance(v, bool):
            continue
        if isinstance(v, int):
            out[k] = v
        elif isinstance(v, dict):
            sub = {kk: vv for kk, vv in v.items() if isinstance(vv, int) and not isinstance(vv, bool)}
            if sub:
                out[k] = sub
    return out


def lists(env, worker_get, log):
    base, tok = (env.get("LIST_URL") or "").strip().rstrip("/"), (env.get("LIST_TOKEN") or "").strip()
    if not (base and tok):
        raise SourceError("LIST_URL / LIST_TOKEN not set")
    c = worker_get(base + "/count", tok)
    if not isinstance(c, dict) or not c.get("ok"):
        raise SourceError("the worker /count did not answer ok")
    out = counts_only(c)
    out.pop("ok", None)
    log(f"[stats] lists: {len(out)} counts read")     # how many, never the numbers (public log)
    return out


def worker_count(url, tok):
    import list_source        # same route as the morning report (worker, else the private copy)
    return list_source.request("GET", url, None, {"User-Agent": "agsist-stats", "Authorization": "Bearer %s" % tok})


def url_get(url):
    import urllib.request
    import urllib.error
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "AGSIST-Stats/1.0"}), timeout=60) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:  # network
        return 0, str(type(e).__name__)


def write_gz(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"))


def run(env, out, days, today, transport, token_fn, get, log=print, worker_get=None):
    worker_get = worker_get or worker_count
    ga_end = today - timedelta(days=1)
    gs_end = today - timedelta(days=2)
    ga_start = ga_end - timedelta(days=days - 1)
    gs_start = gs_end - timedelta(days=days - 1)
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    man = {"run": stamp, "days": days, "sources": {}}
    ok = 0
    try:
        d = ga4(env, transport, token_fn, ga_start, ga_end, log)
        for day, obj in d.items():
            write_gz(out / "ga4" / f"{day}.json.gz", {"date": day, "fetched": stamp, **obj})
        man["sources"]["ga4"] = {"start": ga_start.isoformat(), "end": ga_end.isoformat(), "days": len(d)}
        ok += 1
    except Exception as e:
        man["sources"]["ga4"] = {"error": str(e)[:300]}
        log(f"[stats] ga4 failed: {str(e)[:200]}")
    try:
        d = gsc(env, transport, token_fn, gs_start, gs_end, log)
        for day, obj in d.items():
            write_gz(out / "gsc" / f"{day}.json.gz", {"date": day, "fetched": stamp, **obj})
        man["sources"]["gsc"] = {"start": gs_start.isoformat(), "end": gs_end.isoformat(), "days": len(d)}
        ok += 1
    except Exception as e:
        man["sources"]["gsc"] = {"error": str(e)[:300]}
        log(f"[stats] gsc failed: {str(e)[:200]}")
    try:
        b, errs = bing(env, get, log)
        write_gz(out / "bing" / f"{today.isoformat()}.json.gz", {"fetched": stamp, "methods": b})
        man["sources"]["bing"] = {"snapshot": today.isoformat(), "methods": sorted(b), "errors": errs}
        ok += 1
    except Exception as e:
        man["sources"]["bing"] = {"error": str(e)[:300]}
        log(f"[stats] bing failed: {str(e)[:200]}")
    try:
        ls = lists(env, worker_get, log)
        write_gz(out / "lists" / f"{today.isoformat()}.json.gz", {"date": today.isoformat(), "fetched": stamp, "counts": ls})
        man["sources"]["lists"] = {"snapshot": today.isoformat(), "keys": len(ls)}
    except Exception as e:
        man["sources"]["lists"] = {"error": str(e)[:300]}
        log(f"[stats] lists failed: {str(e)[:200]}")
    out.mkdir(parents=True, exist_ok=True)
    (out / "manifest.json").write_text(json.dumps(man, indent=1) + "\n")
    return 0 if ok else 1


def selftest():
    import tempfile
    calls = []

    def fake_transport(method, url, token, body):
        calls.append(url)
        if "analyticsdata" in url:
            dims = [d["name"] for d in body["dimensions"]]
            if body["offset"]:
                return 200, json.dumps({"rows": [], "rowCount": 1})
            row = {"dimensionValues": [{"value": "20261020" if d == "date" else "x"} for d in dims],
                   "metricValues": [{"value": "3"} for _ in body["metrics"]]}
            return 200, json.dumps({"rows": [row], "rowCount": 1})
        if body.get("rowLimit") == 1:
            return 200, "{}"
        dims = body["dimensions"]
        return 200, json.dumps({"rows": [{"keys": ["2026-10-19"] + ["k"] * (len(dims) - 1),
                                          "clicks": 2, "impressions": 9, "ctr": 0.22, "position": 4.44}]})

    env = {"GA4_PROPERTY_ID": "123", "GA4_SERVICE_ACCOUNT": json.dumps({"private_key": "x"}),
           "GSC_SERVICE_ACCOUNT_JSON": json.dumps({"private_key": "x"}), "BING_API_KEY1": "k"}
    logs = []
    with tempfile.TemporaryDirectory() as t:
        out = Path(t)
        rc = run(env, out, 3, date(2026, 10, 23), fake_transport, lambda i, s: "tok",
                 lambda u: (200, json.dumps({"d": [1]})), logs.append)
        assert rc == 0, rc
        g = json.loads(gzip.open(out / "ga4" / "2026-10-20.json.gz").read())
        assert set(g["reports"]) == set(GA4_REPORTS), g["reports"].keys()
        assert g["reports"]["pages"][0] == ["x", 3, 3, 3, 3], g["reports"]["pages"][0]
        s = json.loads(gzip.open(out / "gsc" / "2026-10-19.json.gz").read())
        assert s["reports"]["query_page"][0] == ["k", "k", 2, 9, 0.22, 4.4], s["reports"]["query_page"][0]
        m = json.loads((out / "manifest.json").read_text())
        assert m["sources"]["ga4"]["end"] == "2026-10-22" and m["sources"]["gsc"]["end"] == "2026-10-21", m
        assert m["sources"]["bing"]["methods"] == sorted(BING_METHODS), m
        assert not any("tok" in l or "apikey" in l for l in logs), "a secret reached the log"
        # lists: numbers only, whatever the worker sends
        env2 = {**env, "LIST_URL": "https://w.dev/", "LIST_TOKEN": "sek"}
        seen = []
        fake_w = lambda u, k: (seen.append((u, k)), {"ok": True, "daily": 167, "alerts": 4, "email": "a@b.c",
                                                     "notices": {"rent:ia": 2, "who": "a@b.c"}, "flag": True, "rows": [1]})[1]
        logs2 = []
        run(env2, out, 1, date(2026, 10, 23), fake_transport, lambda i, s: "tok", lambda u: (200, json.dumps({"d": [1]})),
            logs2.append, fake_w)
        L = json.loads(gzip.open(out / "lists" / "2026-10-23.json.gz").read())["counts"]
        assert L == {"daily": 167, "alerts": 4, "notices": {"rent:ia": 2}}, L
        assert seen == [("https://w.dev/count", "sek")], seen
        assert not any("167" in l or "sek" in l for l in logs2), "a count or the token reached the public log"
        # one source failing leaves the others
        rc = run({**env, "GA4_PROPERTY_ID": ""}, out, 1, date(2026, 10, 23), fake_transport,
                 lambda i, s: "tok", lambda u: (500, ""), logs.append)
        m = json.loads((out / "manifest.json").read_text())
        assert rc == 0 and "error" in m["sources"]["ga4"] and "error" in m["sources"]["bing"] and "days" in m["sources"]["gsc"], m
        rc = run({}, out, 1, date(2026, 10, 23), fake_transport, lambda i, s: "tok", lambda u: (500, ""), logs.append)
        assert rc == 1
    c = list(chunks(date(2026, 1, 1), date(2026, 3, 2)))
    assert c[0] == (date(2026, 1, 1), date(2026, 1, 30)) and c[-1] == (date(2026, 3, 2), date(2026, 3, 2)), c
    assert all(b + timedelta(days=1) == n for (_, b), (n, _) in zip(c, c[1:])), "chunks leave a gap"
    print("stats_ingest selftest: ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=4)
    ap.add_argument("--out", default=str(REPO / "private" / "stats"))
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not 1 <= a.days <= 500:
        sys.exit("--days is 1 to 500")
    sys.exit(run(os.environ, Path(a.out), a.days, datetime.now(timezone.utc).date(),
                 UrllibTransport(), google_token, url_get))


if __name__ == "__main__":
    main()
