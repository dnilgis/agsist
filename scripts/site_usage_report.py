#!/usr/bin/env python3
"""
site_usage_report.py - 90 days of real usage per page, for the site audit.

Writes data/site-usage.json with two blocks, each aggregate only:

  ga4  GA4 Data API, per page path: page views, total users, active users,
       entrances, engagement seconds, and average engagement seconds per
       active user (userEngagementDuration / activeUsers, the same figure the
       GA4 UI calls "average engagement time").
  gsc  Search Console, per page: clicks, impressions, CTR, average position,
       and the top 10 queries for the top 300 pages by impressions.

Paths are normalized so one page is one row: query and fragment dropped,
".html" dropped, trailing slash dropped, "/x/index" -> "/x", "" -> "/".
When several raw paths fold into one, counts are summed. Users cannot be
de-duplicated across raw paths, so a merged row's users is an upper bound and
the row says how many raw paths it folded ("variants").

Windows: GA4 is the 90 days ending yesterday. Search Console data runs about
3 days behind, so its 90 days end 3 days ago. Both are written to the file.

Auth (repo secrets, same names the other workflows use):
  GA4_PROPERTY_ID, GA4_SERVICE_ACCOUNT  (scripts/build_sponsor_report.py)
  GSC_SERVICE_ACCOUNT_JSON              (scripts/gsc_submit_sitemaps.py)
  GSC_SITE (optional repo variable, default sc-domain:agsist.com)

Each source fails on its own: a missing secret, a bad key or an API error sets
that block to null with a "reason". If both fail, the existing file is left
alone so a bad run never wipes good numbers. Keys and tokens are never printed.

    python3 scripts/site_usage_report.py             # fetch and write
    python3 scripts/site_usage_report.py --selftest  # offline, fake transports
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "data" / "site-usage.json"
DAYS = 90
GSC_LAG_DAYS = 3
TOP_QUERY_PAGES = 300
QUERIES_PER_PAGE = 10

GA4_API = "https://analyticsdata.googleapis.com/v1beta"
GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
GSC_API = "https://www.googleapis.com/webmasters/v3"
GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
DEFAULT_SITE = "sc-domain:agsist.com"
FALLBACK_SITE = "https://agsist.com/"


# ------------------------------------------------------------------ helpers
def norm_path(p):
    """Page path or full URL -> one normalized site path."""
    p = (p or "").strip()
    if "://" in p:
        p = urllib.parse.urlsplit(p).path
    p = p.split("#", 1)[0].split("?", 1)[0]
    if not p.startswith("/"):
        p = "/" + p
    p = re.sub(r"/{2,}", "/", p)
    if p.endswith(".html"):
        p = p[:-5]
    p = p.rstrip("/")
    if p == "/index" or p.endswith("/index"):
        p = p[: -len("index")].rstrip("/")
    return p or "/"


def err_text(body):
    """Google's error message only, short: never echoes request headers."""
    try:
        return json.loads(body)["error"]["message"][:200]
    except Exception:
        return (body or "").strip()[:200]


class UrllibTransport:
    """(method, url, token, body_dict) -> (status, text). Never logs the token."""

    def __call__(self, method, url, token, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, method=method, data=data, headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "AGSIST-Site-Usage/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")
        except urllib.error.URLError as e:
            return 0, f"network error: {e.reason}"


def google_token(info, scope):
    from google.oauth2 import service_account
    import google.auth.transport.requests
    creds = service_account.Credentials.from_service_account_info(info, scopes=[scope])
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def load_key(env_name, raw):
    """(info, reason). Reason names the problem without quoting the secret."""
    raw = (raw or "").strip()
    if not raw:
        return None, f"{env_name} is not set"
    try:
        info = json.loads(raw)
    except ValueError:
        return None, f"{env_name} is not valid JSON (contents not shown)"
    if not isinstance(info, dict) or "private_key" not in info:
        return None, f"{env_name} is not a service account key file"
    return info, None


class SourceError(Exception):
    pass


# --------------------------------------------------------------------- GA4
GA4_METRICS = ["screenPageViews", "totalUsers", "activeUsers", "entrances",
               "userEngagementDuration"]


def ga4_fetch(prop, token, transport, start, end, page_size=100000, metrics=None):
    """If GA4 rejects the metric set (HTTP 400), retry once without entrances so
    one incompatible field does not cost the whole block; the result says so."""
    metrics = metrics or GA4_METRICS
    try:
        return _ga4_fetch(prop, token, transport, start, end, page_size, metrics)
    except SourceError as e:
        if "HTTP 400" not in str(e) or "entrances" not in metrics:
            raise
        res = _ga4_fetch(prop, token, transport, start, end, page_size,
                         [m for m in metrics if m != "entrances"])
        res["notes"].append("entrances left out: GA4 refused it (%s)" % str(e)[:160])
        for p in res["pages"].values():
            p["entrances"] = None
        res["totals"]["entrances"] = None
        return res


def _ga4_fetch(prop, token, transport, start, end, page_size, metrics):
    prop = prop.strip()
    if not prop.startswith("properties/"):
        prop = "properties/" + prop
    url = f"{GA4_API}/{prop}:runReport"
    raw, offset = [], 0
    while True:
        body = {"dateRanges": [{"startDate": start, "endDate": end}],
                "dimensions": [{"name": "pagePath"}],
                "metrics": [{"name": m} for m in metrics],
                "limit": page_size, "offset": offset,
                "keepEmptyRows": False}
        st, text = transport("POST", url, token, body)
        if st != 200:
            raise SourceError(f"GA4 runReport HTTP {st}: {err_text(text)}")
        try:
            js = json.loads(text)
        except ValueError:
            raise SourceError("GA4 runReport returned non-JSON")
        names = [h["name"] for h in js.get("metricHeaders", [])] or metrics
        rows = js.get("rows") or []
        for r in rows:
            vals = {n: float(v.get("value") or 0) for n, v in zip(names, r.get("metricValues", []))}
            raw.append((r["dimensionValues"][0]["value"], vals))
        total = int(js.get("rowCount") or 0)
        offset += len(rows)
        if not rows or offset >= total:
            break
    pages = {}
    for path, v in raw:
        k = norm_path(path)
        p = pages.setdefault(k, {"views": 0, "users": 0, "activeUsers": 0, "entrances": 0,
                                 "engagementSeconds": 0.0, "variants": 0})
        p["views"] += int(v.get("screenPageViews", 0))
        p["users"] += int(v.get("totalUsers", 0))
        p["activeUsers"] += int(v.get("activeUsers", 0))
        p["entrances"] += int(v.get("entrances", 0))
        p["engagementSeconds"] += v.get("userEngagementDuration", 0.0)
        p["variants"] += 1
    for p in pages.values():
        p["avgEngagementSeconds"] = (round(p["engagementSeconds"] / p["activeUsers"], 1)
                                     if p["activeUsers"] else None)
        p["engagementSeconds"] = round(p["engagementSeconds"])
    ordered = dict(sorted(pages.items(), key=lambda kv: (-kv[1]["views"], kv[0])))
    return {"start": start, "end": end, "rawRows": len(raw), "pageCount": len(ordered),
            "totals": {"views": sum(p["views"] for p in ordered.values()),
                       "entrances": sum(p["entrances"] for p in ordered.values())},
            "notes": ["users and activeUsers are summed per page path; a person who saw two raw "
                      "variants of one page counts twice, so merged rows (variants > 1) are an upper bound",
                      "avgEngagementSeconds = engagementSeconds / activeUsers"],
            "pages": ordered}


# ---------------------------------------------------------- Search Console
def gsc_pick_site(token, transport, env_site, start, end, log):
    cands = []
    for s in (env_site, DEFAULT_SITE, FALLBACK_SITE):
        if s and s not in cands:
            cands.append(s)
    last = ""
    for s in cands:
        url = f"{GSC_API}/sites/{urllib.parse.quote(s, safe='')}/searchAnalytics/query"
        st, text = transport("POST", url, token, {"startDate": start, "endDate": end,
                                                  "dimensions": ["page"], "rowLimit": 1})
        if st == 200:
            log(f"[usage] gsc property {s}: accepted")
            return s
        last = f"HTTP {st}: {err_text(text)}"
        log(f"[usage] gsc property {s}: {last}")
        if st not in (403, 404):
            raise SourceError(f"Search Console {last}")
    raise SourceError(f"no Search Console property accepted the service account ({last})")


def gsc_query(site, token, transport, body):
    url = f"{GSC_API}/sites/{urllib.parse.quote(site, safe='')}/searchAnalytics/query"
    st, text = transport("POST", url, token, body)
    if st != 200:
        raise SourceError(f"Search Console query HTTP {st}: {err_text(text)}")
    try:
        return json.loads(text).get("rows") or []
    except ValueError:
        raise SourceError("Search Console returned non-JSON")


def _merge_rows(rows):
    """[(clicks, impressions, position)] -> merged dict; position impression-weighted."""
    c = sum(r[0] for r in rows)
    i = sum(r[1] for r in rows)
    pos = (sum(r[2] * r[1] for r in rows) / i) if i else None
    return {"clicks": int(c), "impressions": int(i),
            "ctr": round(c / i, 4) if i else None,
            "position": round(pos, 1) if pos is not None else None}


def gsc_fetch(token, transport, env_site, start, end, log=print, page_size=25000):
    site = gsc_pick_site(token, transport, env_site, start, end, log)
    raw, start_row = [], 0
    while True:
        rows = gsc_query(site, token, transport, {
            "startDate": start, "endDate": end, "dimensions": ["page"],
            "rowLimit": page_size, "startRow": start_row, "dataState": "final"})
        raw.extend(rows)
        start_row += len(rows)
        if len(rows) < page_size:
            break
    by_path = {}
    for r in raw:
        url = r["keys"][0]
        by_path.setdefault(norm_path(url), []).append(r)
    pages = {}
    for path, rs in by_path.items():
        m = _merge_rows([(r.get("clicks", 0), r.get("impressions", 0), r.get("position", 0)) for r in rs])
        m["variants"] = len(rs)
        m["_urls"] = [r["keys"][0] for r in rs]
        pages[path] = m
    ordered = dict(sorted(pages.items(), key=lambda kv: (-kv[1]["impressions"], kv[0])))
    top = list(ordered)[:TOP_QUERY_PAGES]
    for path in top:
        urls = ordered[path]["_urls"]
        if len(urls) == 1:
            flt = {"dimension": "page", "operator": "equals", "expression": urls[0]}
        else:
            flt = {"dimension": "page", "operator": "includingRegex",
                   "expression": "^(?:" + "|".join(re.escape(u) for u in urls) + ")$"}
        qrows = gsc_query(site, token, transport, {
            "startDate": start, "endDate": end, "dimensions": ["query"],
            "dimensionFilterGroups": [{"filters": [flt]}],
            "rowLimit": QUERIES_PER_PAGE, "dataState": "final"})
        ordered[path]["topQueries"] = [
            {"query": q["keys"][0], "clicks": int(q.get("clicks", 0)),
             "impressions": int(q.get("impressions", 0)),
             "ctr": round(q.get("ctr", 0), 4), "position": round(q.get("position", 0), 1)}
            for q in qrows[:QUERIES_PER_PAGE]]
    for p in ordered.values():
        p.pop("_urls", None)
    tc = sum(p["clicks"] for p in ordered.values())
    ti = sum(p["impressions"] for p in ordered.values())
    return {"site": site, "start": start, "end": end, "rawRows": len(raw),
            "pageCount": len(ordered), "pagesWithQueries": len(top),
            "totals": {"clicks": tc, "impressions": ti},
            "notes": ["Search Console leaves out rare queries for privacy, so a page's top queries "
                      "can sum to less than its clicks",
                      "position is impression-weighted across raw URL variants"],
            "pages": ordered}


# --------------------------------------------------------------------- main
def windows(today):
    ga_end = today - timedelta(days=1)
    gsc_end = today - timedelta(days=GSC_LAG_DAYS)
    return ((ga_end - timedelta(days=DAYS - 1)).isoformat(), ga_end.isoformat(),
            (gsc_end - timedelta(days=DAYS - 1)).isoformat(), gsc_end.isoformat())


def build(env, transport, token_fn, today, log=print):
    ga_start, ga_end, gsc_start, gsc_end = windows(today)
    out = {"schema": "agsist-site-usage/1",
           "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "days": DAYS, "pathRule": "query, fragment, .html, trailing slash and /index removed",
           "ga4": None, "ga4Reason": None, "gsc": None, "gscReason": None}

    prop = (env.get("GA4_PROPERTY_ID") or "").strip()
    info, why = load_key("GA4_SERVICE_ACCOUNT", env.get("GA4_SERVICE_ACCOUNT"))
    if not prop:
        why = "GA4_PROPERTY_ID is not set"
    if why:
        out["ga4Reason"] = why
    else:
        try:
            tok = token_fn(info, GA4_SCOPE)
            out["ga4"] = ga4_fetch(prop, tok, transport, ga_start, ga_end)
        except SourceError as e:
            out["ga4Reason"] = str(e)
        except Exception as e:  # message may quote the key; type only
            out["ga4Reason"] = f"GA4 failed ({type(e).__name__})"
    log(f"[usage] ga4: " + (f"{out['ga4']['pageCount']} pages" if out["ga4"] else out["ga4Reason"]))

    info, why = load_key("GSC_SERVICE_ACCOUNT_JSON", env.get("GSC_SERVICE_ACCOUNT_JSON"))
    if why:
        out["gscReason"] = why
    else:
        try:
            tok = token_fn(info, GSC_SCOPE)
            out["gsc"] = gsc_fetch(tok, transport, env.get("GSC_SITE"), gsc_start, gsc_end, log)
        except SourceError as e:
            out["gscReason"] = str(e)
        except Exception as e:
            out["gscReason"] = f"Search Console failed ({type(e).__name__})"
    log(f"[usage] gsc: " + (f"{out['gsc']['pageCount']} pages" if out["gsc"] else out["gscReason"]))
    return out


def main():
    out = build(os.environ, UrllibTransport(), google_token, date.today())
    if out["ga4"] is None and out["gsc"] is None:
        print("::warning::no usage source worked; data/site-usage.json left as it was")
        return 0
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[usage] wrote {OUT.relative_to(REPO)}")
    return 0


# ----------------------------------------------------------------- selftest
def selftest():
    failed = []

    def check(ok, name, detail=""):
        print(("  ok    " if ok else "  FAIL  ") + name + ("" if ok else "  :: " + str(detail)[:400]))
        if not ok:
            failed.append(name)

    for raw, want in [("/", "/"), ("/index.html", "/"), ("/cash-bids/", "/cash-bids"),
                      ("/cash-bids.html?x=1#y", "/cash-bids"), ("https://agsist.com/basis/iowa.html", "/basis/iowa"),
                      ("/cash-bids/iowa/index.html", "/cash-bids/iowa"), ("", "/"), ("//a//b/", "/a/b")]:
        check(norm_path(raw) == want, f"norm_path({raw!r}) == {want!r}", norm_path(raw))

    KEY = json.dumps({"type": "service_account", "private_key": "SECRETKEY", "client_email": "x@y"})
    TOKEN = "TOKEN-XYZ"

    def tok_fn(info, scope):
        return TOKEN

    def ga_row(path, v, u, a, e, d):
        return {"dimensionValues": [{"value": path}],
                "metricValues": [{"value": str(x)} for x in (v, u, a, e, d)]}

    class Fake:
        def __init__(self, ga_status=200, gsc_ok_site="sc-domain:agsist.com"):
            self.calls, self.ga_status, self.gsc_ok_site = [], ga_status, gsc_ok_site

        def __call__(self, method, url, token, body=None):
            self.calls.append((method, url, token, body))
            if url.startswith(GA4_API):
                if self.ga_status != 200:
                    return self.ga_status, json.dumps({"error": {"message": "permission denied"}})
                head = {"metricHeaders": [{"name": m} for m in GA4_METRICS], "rowCount": 4}
                if body["offset"] == 0:
                    rows = [ga_row("/cash-bids", 100, 40, 30, 50, 600),
                            ga_row("/cash-bids.html", 20, 10, 10, 5, 300)]
                else:
                    rows = [ga_row("/", 500, 200, 150, 300, 9000), ga_row("/tools.html?a=1", 3, 1, 0, 0, 0)]
                return 200, json.dumps(dict(head, rows=rows))
            site = urllib.parse.unquote(url.split("/sites/")[1].split("/")[0])
            if site != self.gsc_ok_site:
                return 403, json.dumps({"error": {"message": "User does not have sufficient permission"}})
            if body["dimensions"] == ["page"]:
                if body.get("rowLimit") == 1:
                    return 200, json.dumps({"rows": [{"keys": ["https://agsist.com/"]}]})
                if body.get("startRow", 0) == 0:
                    return 200, json.dumps({"rows": [
                        {"keys": ["https://agsist.com/cash-bids"], "clicks": 10, "impressions": 100, "ctr": .1, "position": 4},
                        {"keys": ["https://agsist.com/cash-bids.html"], "clicks": 0, "impressions": 100, "ctr": 0, "position": 8},
                        {"keys": ["https://agsist.com/basis/iowa"], "clicks": 1, "impressions": 50, "ctr": .02, "position": 12}]})
                return 200, json.dumps({"rows": []})
            flt = body["dimensionFilterGroups"][0]["filters"][0]
            return 200, json.dumps({"rows": [
                {"keys": [f"q{i} {flt['operator']}"], "clicks": 1, "impressions": 9, "ctr": .111, "position": 3.33}
                for i in range(12)]})

    # page sizes forced small through module constants is awkward; use real
    # functions with a small page size to prove pagination.
    f = Fake()
    ga = ga4_fetch("123", TOKEN, f, "2026-01-01", "2026-03-31", page_size=2)
    check(len([c for c in f.calls if c[1].startswith(GA4_API)]) == 2, "GA4 paginates until rowCount")
    check(f.calls[0][1] == f"{GA4_API}/properties/123:runReport", "GA4 property id gets properties/ prefix", f.calls[0][1])
    cb = ga["pages"]["/cash-bids"]
    check(cb["views"] == 120 and cb["entrances"] == 55 and cb["variants"] == 2, "GA4 merges .html variant", cb)
    check(cb["avgEngagementSeconds"] == 22.5, "avg engagement = seconds / active users", cb)
    check(ga["pages"]["/tools"]["avgEngagementSeconds"] is None, "no active users -> avg is None, not 0")
    check(list(ga["pages"])[0] == "/", "GA4 pages ordered by views")

    class Fake400(Fake):
        def __call__(self, method, url, token, body=None):
            if url.startswith(GA4_API) and any(m["name"] == "entrances" for m in body["metrics"]):
                self.calls.append((method, url, token, body))
                return 400, json.dumps({"error": {"message": "entrances is incompatible"}})
            if url.startswith(GA4_API):
                self.calls.append((method, url, token, body))
                head = {"metricHeaders": [{"name": m["name"]} for m in body["metrics"]], "rowCount": 1}
                return 200, json.dumps(dict(head, rows=[{"dimensionValues": [{"value": "/"}],
                    "metricValues": [{"value": "5"}, {"value": "2"}, {"value": "2"}, {"value": "10"}]}]))
            return super().__call__(method, url, token, body)
    ga = ga4_fetch("123", TOKEN, Fake400(), "a", "b")
    check(ga["pages"]["/"]["views"] == 5 and ga["pages"]["/"]["entrances"] is None
          and ga["pages"]["/"]["avgEngagementSeconds"] == 5.0, "GA4 400 on entrances retries without it", ga["pages"])

    f = Fake()
    gsc = gsc_fetch(TOKEN, f, None, "2026-01-01", "2026-03-31", log=lambda *a: None, page_size=3)
    cb = gsc["pages"]["/cash-bids"]
    check(cb["clicks"] == 10 and cb["impressions"] == 200 and cb["ctr"] == 0.05 and cb["position"] == 6.0,
          "GSC merges variants, CTR recomputed, position impression-weighted", cb)
    check(len(cb["topQueries"]) == 10, "top queries capped at 10", len(cb["topQueries"]))
    check("includingRegex" in cb["topQueries"][0]["query"], "multi-variant page filtered by regex")
    check("equals" in gsc["pages"]["/basis/iowa"]["topQueries"][0]["query"], "single-variant page filtered by equals")
    check("_urls" not in cb, "internal URL list not written")

    logs = []
    f = Fake(gsc_ok_site="https://agsist.com/")
    gsc = gsc_fetch(TOKEN, f, None, "a", "b", log=logs.append, page_size=3)
    check(gsc["site"] == "https://agsist.com/", "GSC falls back to URL-prefix property", logs)

    env = {"GA4_PROPERTY_ID": "123", "GA4_SERVICE_ACCOUNT": KEY, "GSC_SERVICE_ACCOUNT_JSON": KEY}
    logs = []
    out = build(env, Fake(), tok_fn, date(2026, 10, 10), logs.append)
    check(out["ga4"]["start"] == "2026-07-12" and out["ga4"]["end"] == "2026-10-09", "GA4 window is 90 days to yesterday",
          (out["ga4"]["start"], out["ga4"]["end"]))
    check(out["gsc"]["end"] == "2026-10-07", "GSC window ends 3 days back", out["gsc"]["end"])
    dump = json.dumps(out) + "\n".join(logs)
    check("SECRETKEY" not in dump and TOKEN not in dump, "no key or token in output or logs")

    out = build({"GSC_SERVICE_ACCOUNT_JSON": KEY}, Fake(), tok_fn, date(2026, 10, 10), lambda *a: None)
    check(out["ga4"] is None and "GA4_PROPERTY_ID" in out["ga4Reason"] and out["gsc"], "missing GA4 secret -> null + reason, GSC still runs", out["ga4Reason"])
    out = build({"GA4_PROPERTY_ID": "1", "GA4_SERVICE_ACCOUNT": "not json"}, Fake(), tok_fn, date(2026, 10, 10), lambda *a: None)
    check(out["ga4"] is None and "not valid JSON" in out["ga4Reason"] and "not json" not in out["ga4Reason"], "bad key named, not quoted", out["ga4Reason"])
    check(out["gsc"] is None and "GSC_SERVICE_ACCOUNT_JSON is not set" in out["gscReason"], "missing GSC secret -> null + reason")
    out = build(env, Fake(ga_status=403), tok_fn, date(2026, 10, 10), lambda *a: None)
    check(out["ga4"] is None and "HTTP 403" in out["ga4Reason"] and out["gsc"], "GA4 HTTP error -> null + reason, GSC unaffected", out["ga4Reason"])
    out = build(env, Fake(gsc_ok_site="sc-domain:other.com"), tok_fn, date(2026, 10, 10), lambda *a: None)
    check(out["gsc"] is None and "no Search Console property" in out["gscReason"] and out["ga4"], "GSC refused -> null + reason")

    def boom(info, scope):
        raise ValueError("bad key SECRETKEY")
    out = build(env, Fake(), boom, date(2026, 10, 10), lambda *a: None)
    check("SECRETKEY" not in json.dumps(out) and out["ga4Reason"] == "GA4 failed (ValueError)", "token error prints type only", out["ga4Reason"])

    print("selftest: " + ("FAILED " + ", ".join(failed) if failed else "all passed"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv[1:] else main())
