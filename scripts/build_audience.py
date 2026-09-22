#!/usr/bin/env python3
"""Who reads AGSIST, refreshed every morning: data/audience.json.

    python3 scripts/build_audience.py            # needs the secrets below
    python3 scripts/build_audience.py --selftest # no network

Every sponsor's portal draws its "Who reads AGSIST" dashboard from this one
file. It is site-wide, not per sponsor, and it holds nothing a forwarded link
could not show.

SOURCES AND SECRETS -- each one is optional and fails on its own
    GA4             GA4_PROPERTY_ID + GA4_SERVICE_ACCOUNT (Viewer on the property)
    Search Console  the same service account, added as a user on the property
    Bing Webmaster  BING_API_KEY
    Email list      LIST_URL + LIST_TOKEN (the subscriptions worker; only the
                    COUNT is kept -- no address is written anywhere)

A source that is not configured, or that fails, keeps what the previous file
held for it, with its own dates on it, and the run says so. A source is never
blanked because another one broke, and a number is never carried forward
without the dates that say how old it is.

US ONLY, AND THE SERVER TOWNS COME OUT FIRST

Every GA4 figure is filtered to the United States. Then, city by city over the
last 90 days, any town whose readers average under SERVER_SECONDS of
engagement across at least SERVER_MIN readers is treated as a server farm and
removed from EVERY GA4 query on the page -- totals, states, pages, devices,
channels, the daily series. Singapore averaged 2 seconds a "user" this year;
the US averaged 119. The towns removed, and how many "readers" each carried,
are written into the file and listed on the page, so the removal can be
checked rather than trusted.

Search Console is filtered to US searches. Bing's API has no country filter, so
Bing figures are worldwide and the file says so.

WHAT IT DOES NOT DO

It does not touch the AI-citation figures. Bing publishes those in its
dashboard and has no API for them; they come from an export
(scripts/audience_from_exports.py) and carry that export's dates.
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "audience.json"
SCHEMA = "agsist-audience/2"

SERVER_SECONDS = 10     # average engagement per reader, seconds
SERVER_MIN = 20         # readers, over the 90-day window
HOME_STATE = "WI"       # AGSIST is run from Chetek; shown, not ranked
# Windows end LAG days ago. Measured on the first live run (2026-09-22, 11:39
# CT): yesterday came back with 256 users and ZERO engaged sessions -- GA4 had
# counted the visits and not yet processed the engagement -- and Search Console
# and Bing had no row for it at all. One day behind put a false cliff at the end
# of every chart and dragged the 7-day engagement rate from about 62% to 52%.
LAG = 2
UA = "AGSIST-automation/1.0 (+https://agsist.com; sig@farmers1st.com)"

STATES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
    "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC",
    "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL",
    "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
    "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR",
    "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
    "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA",
    "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}
METRICS = ["activeUsers", "engagedSessions", "userEngagementDuration", "sessions",
           "screenPageViews", "newUsers"]


def log(msg):
    print(msg, flush=True)


# ── the windows ───────────────────────────────────────────────────────────
def ranges(today):
    """Every window ends LAG days ago, on the last day all three sources have
    finished: a number that moves after a sponsor looked at it is worse than one
    a day older."""
    end = today - timedelta(days=LAG)
    jan1 = date(end.year, 1, 1)
    out = [("7d", "7 days", end - timedelta(days=6)),
           ("28d", "28 days", end - timedelta(days=27)),
           ("90d", "90 days", end - timedelta(days=89)),
           ("ytd", str(end.year), jan1)]
    return [{"id": i, "label": l, "start": s.isoformat(), "end": end.isoformat()} for i, l, s in out]


def series_start(today):
    """The daily series reaches back to Jan 1, or 90 days in January-March, so
    every range on the picker has its days."""
    end = today - timedelta(days=LAG)
    return min(date(end.year, 1, 1), end - timedelta(days=89))


# ── GA4 ───────────────────────────────────────────────────────────────────
class GA4:
    """A thin layer over the Data API so the selftest can swap the client.
    run() returns a list of dicts keyed by dimension and metric NAME -- the API
    adds a `dateRange` dimension when several ranges are asked for, and reading
    columns by position is how a report silently shifts one column over."""

    def __init__(self, prop, client):
        self.prop, self.client = prop, client

    def run(self, dims, metrics, date_ranges, filt=None, order=None, limit=100000):
        from google.analytics.data_v1beta.types import (
            DateRange, Dimension, Metric, OrderBy, RunReportRequest)
        req = RunReportRequest(
            property="properties/" + self.prop,
            dimensions=[Dimension(name=d) for d in dims],
            metrics=[Metric(name=m) for m in metrics],
            date_ranges=[DateRange(start_date=r["start"], end_date=r["end"], name=r["id"]) for r in date_ranges],
            dimension_filter=filt,
            order_bys=[OrderBy(metric=OrderBy.MetricOrderBy(metric_name=order), desc=True)] if order else [],
            limit=limit,
        )
        res = self.client.run_report(req)
        dh = [h.name for h in res.dimension_headers]
        mh = [h.name for h in res.metric_headers]
        out = []
        for r in res.rows:
            row = {n: v.value for n, v in zip(dh, r.dimension_values)}
            for n, v in zip(mh, r.metric_values):
                x = float(v.value)
                row[n] = int(x) if x.is_integer() else x
            out.append(row)
        return out


def f_us():
    from google.analytics.data_v1beta.types import Filter, FilterExpression
    return FilterExpression(filter=Filter(field_name="country", string_filter=Filter.StringFilter(value="United States")))


def f_readers(servers):
    """US, minus every server town, matched on region AND city: a city name is
    not unique ("Ashburn" is in Virginia and in Georgia)."""
    from google.analytics.data_v1beta.types import Filter, FilterExpression, FilterExpressionList

    def eq(field, value):
        return FilterExpression(filter=Filter(field_name=field, string_filter=Filter.StringFilter(value=value)))
    if not servers:
        return f_us()
    towns = [FilterExpression(and_group=FilterExpressionList(expressions=[eq("region", s["region"]), eq("city", s["city"])]))
             for s in servers]
    return FilterExpression(and_group=FilterExpressionList(expressions=[
        f_us(),
        FilterExpression(not_expression=FilterExpression(or_group=FilterExpressionList(expressions=towns))),
    ]))


def summarise(rows):
    u = sum(r.get("activeUsers", 0) for r in rows)
    e = sum(r.get("engagedSessions", 0) for r in rows)
    s = sum(r.get("sessions", 0) for r in rows)
    t = sum(r.get("userEngagementDuration", 0) for r in rows)
    return {"users": u, "engaged": e, "sessions": s,
            "views": sum(r.get("screenPageViews", 0) for r in rows),
            "newUsers": sum(r.get("newUsers", 0) for r in rows),
            "avgSeconds": round(t / u, 1) if u else None,
            "engagementRate": round(e / s, 3) if s else None}


def by_range(rows):
    out = {}
    for r in rows:
        out.setdefault(r.get("dateRange", "only"), []).append(r)
    return out


def ga4_section(ga, rg, today):
    r90 = [x for x in rg if x["id"] == "90d"]
    # 1. find the server towns
    cities = ga.run(["region", "city"], ["activeUsers", "userEngagementDuration"], r90, filt=f_us())
    servers = []
    for c in cities:
        if c["city"] in ("(not set)", "") or c["activeUsers"] < SERVER_MIN:
            continue
        avg = c["userEngagementDuration"] / c["activeUsers"]
        if avg < SERVER_SECONDS:
            servers.append({"city": c["city"], "region": c["region"], "users": c["activeUsers"],
                            "avgSeconds": round(avg, 1)})
    servers.sort(key=lambda s: -s["users"])
    F = f_readers(servers)

    totals = {k: summarise(v) for k, v in by_range(ga.run([], METRICS, rg, filt=F)).items()}

    st = {}
    for k, v in by_range(ga.run(["region"], METRICS, rg, filt=F)).items():
        rows = []
        for r in v:
            if r["region"] not in STATES:
                continue
            x = summarise([r])
            x.update(code=STATES[r["region"]], name=r["region"])
            rows.append(x)
        rows.sort(key=lambda x: (-x["engaged"], -x["users"], x["code"]))
        n = 0
        for x in rows:
            if x["code"] == HOME_STATE:
                x["rank"], x["flag"] = None, "home"
            else:
                n += 1
                x["rank"] = n
        st[k] = rows

    start = series_start(today).isoformat()
    end = rg[0]["end"]
    daily = ga.run(["date"], ["activeUsers", "engagedSessions"], [{"id": "s", "start": start, "end": end}], filt=F)
    days = {}
    for r in daily:
        d = r["date"]
        days["%s-%s-%s" % (d[:4], d[4:6], d[6:])] = {"users": r["activeUsers"], "engaged": r["engagedSessions"]}

    # One call per window, so one window's rows can never crowd out the other's
    # under the row limit. Views only: views add across a page's titles, readers
    # do not (the same person reading two titles would count twice).
    pages = {}
    for win in [x for x in rg if x["id"] in ("28d", "90d")]:
        agg = {}
        for r in ga.run(["pagePath", "pageTitle"], ["screenPageViews"], [win], filt=F, order="screenPageViews", limit=400):
            p = r["pagePath"]
            a = agg.setdefault(p, {"path": p, "title": r["pageTitle"], "views": 0})
            a["views"] += r["screenPageViews"]
        k = win["id"]
        pages[k] = sorted(agg.values(), key=lambda x: -x["views"])[:15]
        for p in pages[k]:
            p["title"] = re.sub(r"\s*[|—-]\s*AGSIST\s*$", "", p["title"] or "").strip() or p["path"]

    devices = {k: {r["deviceCategory"]: r["activeUsers"] for r in v}
               for k, v in by_range(ga.run(["deviceCategory"], ["activeUsers"], rg, filt=F)).items()}
    channels = {k: sorted([{"channel": r["sessionDefaultChannelGroup"], "sessions": r["sessions"]} for r in v],
                          key=lambda x: -x["sessions"])
                for k, v in by_range(ga.run(["sessionDefaultChannelGroup"], ["sessions"], rg, filt=F)).items()}

    return {"totals": totals, "states": st, "gaDays": days, "pages": pages, "devices": devices,
            "channels": channels,
            "servers": {"rule": {"seconds": SERVER_SECONDS, "minReaders": SERVER_MIN},
                        "window": r90[0], "towns": servers,
                        "users": sum(s["users"] for s in servers)}}


# ── Search Console ────────────────────────────────────────────────────────
def is_ours(u):
    u = (u or "").lower()
    return u in ("sc-domain:agsist.com",) or re.match(r"^https?://(www\.)?agsist\.com/?$", u) is not None


def gsc_section(session, rg, today):
    base = "https://www.googleapis.com/webmasters/v3/sites"
    def call(method, url, **kw):
        r = getattr(session, method)(url, timeout=60, **kw)
        r.raise_for_status()      # a 403 or 429 must fail this source, not look like an empty month
        return r.json()
    sites = call("get", base).get("siteEntry") or []
    mine = [s["siteUrl"] for s in sites if is_ours(s.get("siteUrl", ""))]
    if not mine:
        raise RuntimeError("the service account can see %d Search Console properties and none is agsist.com -- "
                           "add it as a user on the property" % len(sites))
    site = sorted(mine, key=lambda u: not u.startswith("sc-domain:"))[0]
    url = base + "/" + urllib.parse.quote(site, safe="") + "/searchAnalytics/query"
    us = [{"filters": [{"dimension": "country", "operator": "equals", "expression": "usa"}]}]
    start, end = series_start(today).isoformat(), rg[0]["end"]
    daily = call("post", url, json={"startDate": start, "endDate": end, "dimensions": ["date"],
                                    "dimensionFilterGroups": us, "rowLimit": 25000}).get("rows") or []
    days = {r["keys"][0]: {"clicks": int(r["clicks"]), "impr": int(r["impressions"])} for r in daily}
    r28 = [x for x in rg if x["id"] == "28d"][0]
    q = call("post", url, json={"startDate": r28["start"], "endDate": r28["end"], "dimensions": ["query"],
                                "dimensionFilterGroups": us, "rowLimit": 20}).get("rows") or []
    queries = [{"q": r["keys"][0], "clicks": int(r["clicks"]), "impr": int(r["impressions"]),
                "pos": round(r["position"], 1)} for r in q]
    return {"site": site, "days": days, "queries": {"start": r28["start"], "end": r28["end"], "rows": queries}}


# ── Bing ──────────────────────────────────────────────────────────────────
def bing_date(s):
    m = re.search(r"/Date\((-?\d+)", str(s))
    return datetime.fromtimestamp(int(m.group(1)) / 1000, tz=timezone.utc).date() if m else None


def bing_section(get, rg, today):
    sites = get("GetUserSites", {}).get("d") or []
    mine = [s.get("Url") for s in sites if is_ours(s.get("Url"))]
    if not mine:
        raise RuntimeError("the Bing key sees %d sites and none is agsist.com" % len(sites))
    site = sorted(mine, key=lambda u: not u.startswith("https://"))[0]
    days = {}
    for r in get("GetRankAndTrafficStats", {"siteUrl": site}).get("d") or []:
        d = bing_date(r.get("Date"))
        if d:
            days[d.isoformat()] = {"clicks": int(r.get("Clicks") or 0), "impr": int(r.get("Impressions") or 0)}
    # Query stats come back in weekly buckets. The last four buckets are used,
    # and the window printed is the buckets' own dates, not "28 days".
    qs = get("GetQueryStats", {"siteUrl": site}).get("d") or []
    # The bucket width is MEASURED from the gaps between dates rather than
    # assumed to be a week; the window then covers about 28 days of buckets.
    allb = sorted({bing_date(r.get("Date")) for r in qs if bing_date(r.get("Date"))})
    gaps = [(b - a).days for a, b in zip(allb, allb[1:]) if (b - a).days > 0]
    width = min(gaps) if gaps else 7
    weeks = [b for b in allb if allb and b > allb[-1] - timedelta(days=28 - width + 1)] if allb else []
    agg = {}
    for r in qs:
        if bing_date(r.get("Date")) not in weeks:
            continue
        a = agg.setdefault(r.get("Query"), {"q": r.get("Query"), "clicks": 0, "impr": 0})
        a["clicks"] += int(r.get("Clicks") or 0)
        a["impr"] += int(r.get("Impressions") or 0)
    rows = sorted(agg.values(), key=lambda x: (-x["clicks"], -x["impr"]))[:20]
    q = ({"start": weeks[0].isoformat(), "end": min(weeks[-1] + timedelta(days=width - 1), today - timedelta(days=LAG)).isoformat(),
          "rows": rows} if weeks else None)
    return {"site": site, "days": days, "queries": q}


# ── email ─────────────────────────────────────────────────────────────────
def email_count(base, token, fetch=None):
    u = base.rstrip("/") + "/list?token=" + urllib.parse.quote(token)
    if fetch is None:
        def fetch(url):
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
                return r.read().decode()
    body = fetch(u)
    return len({x.strip().lower() for x in re.split(r"[,\n]", body) if "@" in x})


# ── assembly ──────────────────────────────────────────────────────────────
def merge_series(ga_days, g_days, b_days, start, end):
    out, d = [], date.fromisoformat(start)
    while d <= date.fromisoformat(end):
        k = d.isoformat()
        a, g, b = (ga_days or {}).get(k), (g_days or {}).get(k), (b_days or {}).get(k)
        out.append({"d": k,
                    "users": a["users"] if a else None, "engaged": a["engaged"] if a else None,
                    "gClicks": g["clicks"] if g else None, "gImpr": g["impr"] if g else None,
                    "bClicks": b["clicks"] if b else None, "bImpr": b["impr"] if b else None})
        d += timedelta(days=1)
    return out


def build(today, prev, ga=None, gsc=None, bing=None, email=None, errors=None):
    """prev: the previous file (or {}). ga/gsc/bing: section dicts or None when
    that source was not available this run. Anything None is carried from prev."""
    rg = ranges(today)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    src = dict(prev.get("sources") or {})
    out = {"schema": SCHEMA, "built": now, "ranges": rg, "homeState": HOME_STATE}

    if ga:
        out.update({k: ga[k] for k in ("totals", "states", "pages", "devices", "channels", "servers")})
        src["ga4"] = {"ok": True, "through": rg[0]["end"], "fetched": now}
    else:
        for k in ("totals", "states", "pages", "devices", "channels", "servers",
                  "mode", "stateFlagRule", "stateWindow", "leftOut"):
            if k in prev:
                out[k] = prev[k]
        if prev.get("schema") == SCHEMA:
            out["ranges"] = prev.get("ranges", rg)   # the carried numbers keep the windows they were cut on
        src.setdefault("ga4", {"ok": False})
        src["ga4"] = dict(src["ga4"], ok=False, error=(errors or {}).get("ga4", "not configured"))

    prev_days = {r["d"]: r for r in (prev.get("series") or {}).get("days", [])}

    def carry(key, fresh):
        if fresh is not None:
            return fresh
        return {d: {"clicks": r.get(key[0] + "Clicks"), "impr": r.get(key[0] + "Impr")}
                for d, r in prev_days.items() if r.get(key[0] + "Clicks") is not None} or None

    ga_days = ga["gaDays"] if ga else ({d: {"users": r["users"], "engaged": r["engaged"]}
                                        for d, r in prev_days.items() if r.get("users") is not None} or None)
    g_days = carry("g", gsc["days"] if gsc else None)
    b_days = carry("b", bing["days"] if bing else None)
    if ga_days or g_days or b_days:
        s_end = rg[0]["end"]      # fresh search days are kept even while GA4 is failing
        s_start = series_start(date.fromisoformat(s_end) + timedelta(days=LAG)).isoformat()
        out["series"] = {"start": s_start, "end": s_end,
                         "days": merge_series(ga_days, g_days, b_days, s_start, s_end)}

    q = dict(prev.get("queries") or {})
    if gsc:
        q["google"] = dict(gsc["queries"], country="US")
        src["gsc"] = {"ok": True, "site": gsc["site"], "fetched": now}
    else:
        src["gsc"] = dict(src.get("gsc") or {}, ok=False, error=(errors or {}).get("gsc", "not configured"))
    if bing:
        if bing.get("queries"):
            q["bing"] = dict(bing["queries"], country="worldwide")
        src["bing"] = {"ok": True, "site": bing["site"], "fetched": now}
    else:
        src["bing"] = dict(src.get("bing") or {}, ok=False, error=(errors or {}).get("bing", "not configured"))
    if q:
        out["queries"] = q

    if email is not None:
        out["email"] = {"subscribers": email, "asOf": today.isoformat()}
        src["email"] = {"ok": True, "fetched": now}
    else:
        if prev.get("email"):
            out["email"] = prev["email"]
        src["email"] = dict(src.get("email") or {}, ok=False, error=(errors or {}).get("email", "not configured"))

    # Carried from the exports, with their own dates, until Bing has an API for them.
    if "ai" in prev:
        out["ai"] = prev["ai"]
    ss = dict(prev.get("searchStatic") or {})
    if gsc:
        ss.pop("google", None)
    if bing:
        ss.pop("bing", None)
    if ss:
        out["searchStatic"] = ss
    out["sources"] = src
    return out


def main():
    today = date.today()
    try:
        prev = json.loads(OUT.read_text()) if OUT.exists() else {}
    except ValueError:
        prev = {}
    errors = {}
    ga = gsc = bing = email = None
    prop = os.environ.get("GA4_PROPERTY_ID", "").strip()
    cred = os.environ.get("GA4_SERVICE_ACCOUNT", "").strip()
    info = None
    if cred:
        try:
            info = json.loads(cred)
        except ValueError:
            errors["ga4"] = errors["gsc"] = "GA4_SERVICE_ACCOUNT is not the whole JSON key file"
    rg = ranges(today)

    if prop and info:
        try:
            from google.analytics.data_v1beta import BetaAnalyticsDataClient
            from google.oauth2 import service_account
            c = service_account.Credentials.from_service_account_info(
                info, scopes=["https://www.googleapis.com/auth/analytics.readonly"])
            ga = ga4_section(GA4(prop, BetaAnalyticsDataClient(credentials=c)), rg, today)
            log("GA4: %s US readers in 28 days after removing %d server town(s) carrying %d"
                % (ga["totals"]["28d"]["users"], len(ga["servers"]["towns"]), ga["servers"]["users"]))
        except Exception as e:  # noqa: BLE001 -- one source failing must not take the others down
            errors["ga4"] = "%s: %s" % (type(e).__name__, str(e)[:300])
            log("::warning::GA4 failed, keeping the previous figures: " + errors["ga4"])
    if info:
        try:
            from google.auth.transport.requests import AuthorizedSession
            from google.oauth2 import service_account
            c = service_account.Credentials.from_service_account_info(
                info, scopes=["https://www.googleapis.com/auth/webmasters.readonly"])
            gsc = gsc_section(AuthorizedSession(c), rg, today)
            log("Search Console: %s, %d days, %d queries" % (gsc["site"], len(gsc["days"]), len(gsc["queries"]["rows"])))
        except Exception as e:  # noqa: BLE001
            errors["gsc"] = "%s: %s" % (type(e).__name__, str(e)[:300])
            log("::warning::Search Console failed, keeping the previous figures: " + errors["gsc"])
    key = os.environ.get("BING_API_KEY", "").strip()
    if key:
        def get(method, params):
            q = dict(params, apikey=key)
            u = "https://ssl.bing.com/webmaster/api.svc/json/%s?%s" % (method, urllib.parse.urlencode(q))
            with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=60) as r:
                return json.loads(r.read().decode())
        try:
            bing = bing_section(get, rg, today)
            log("Bing: %s, %d days" % (bing["site"], len(bing["days"])))
        except Exception as e:  # noqa: BLE001
            errors["bing"] = "%s: %s" % (type(e).__name__, str(e)[:300])
            log("::warning::Bing failed, keeping the previous figures: " + errors["bing"])
    lu, lt = os.environ.get("LIST_URL", "").strip(), os.environ.get("LIST_TOKEN", "").strip()
    if lu and lt:
        try:
            email = email_count(lu, lt)
            log("email: %d subscribers" % email)
        except Exception as e:  # noqa: BLE001
            errors["email"] = "%s: %s" % (type(e).__name__, str(e)[:200])
            log("::warning::subscriber count failed: " + errors["email"])

    if not any((ga, gsc, bing, email is not None)):
        log("::warning::no source was reachable or configured -- data/audience.json left exactly as it was")
        return 0
    out = build(today, prev, ga, gsc, bing, email, errors)
    OUT.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    log("wrote data/audience.json")
    return 0


# ── selftest ──────────────────────────────────────────────────────────────
def selftest():
    ok = True

    def t(c, name):
        nonlocal ok
        print(("  ok    " if c else "  FAIL  ") + name)
        ok = ok and bool(c)

    today = date(2026, 9, 24)
    rg = ranges(today)
    t(all(r["end"] == "2026-09-22" for r in rg), "every window ends LAG days back, on the last finished day")
    t(rg[0]["start"] == "2026-09-16" and rg[3]["start"] == "2026-01-01", "7 days is seven days; the year starts Jan 1")
    t(series_start(date(2026, 2, 1)) == date(2025, 11, 2), "in January the series still covers 90 days")

    # A fake GA4 client that answers from a table and records every request.
    class V:
        def __init__(self, v):
            self.value = v

    class H:
        def __init__(self, n):
            self.name = n

    class Res:
        def __init__(self, dims, mets, rows):
            self.dimension_headers = [H(d) for d in dims]
            self.metric_headers = [H(m) for m in mets]
            self.rows = [type("R", (), {"dimension_values": [V(str(x)) for x in r[:len(dims)]],
                                        "metric_values": [V(str(x)) for x in r[len(dims):]]}) for r in rows]
    seen = []

    class Client:
        def run_report(self, req):
            seen.append(req)
            dims = [d.name for d in req.dimensions]
            mets = [m.name for m in req.metrics]
            multi = len(req.date_ranges) > 1
            if dims == ["region", "city"]:
                return Res(dims, mets, [["Virginia", "Ashburn", 600, 600], ["Georgia", "Ashburn", 25, 2500],
                                        ["Iowa", "Des Moines", 120, 16000], ["Iowa", "Council Bluffs", 40, 120],
                                        ["Ohio", "Tiny", 5, 1]])
            H_ = dims + (["dateRange"] if multi else [])
            rows = []
            for r in req.date_ranges:
                tag = [r.name] if multi else []
                vals = {m: 10 for m in mets}
                if dims == []:
                    rows.append(tag + [vals[m] for m in mets])
                elif dims == ["region"]:
                    for reg, e in (("Iowa", 50), ("Wisconsin", 90), ("Texas", 30), ("Tbilisi", 99)):
                        rows.append([reg] + tag + [e if m == "engagedSessions" else 10 for m in mets])
                elif dims == ["date"]:
                    rows.append(["20260922", 11, 7])
                elif dims == ["pagePath", "pageTitle"]:
                    rows.append(["/cash-bids", "Local Cash Grain Bids Today | AGSIST"] + tag + ["4e1"])
                    rows.append(["/cash-bids", "Old title | AGSIST"] + tag + [5])
                elif dims == ["deviceCategory"]:
                    rows.append(["mobile"] + tag + [7]); rows.append(["desktop"] + tag + [3])
                elif dims == ["sessionDefaultChannelGroup"]:
                    rows.append(["Organic Search"] + tag + [9])
            # the API puts dateRange LAST among the dimensions; rows above put it after the real dims
            return Res(H_, mets, rows)

    g = ga4_section(GA4("123", Client()), rg, today)
    towns = {(s["region"], s["city"]) for s in g["servers"]["towns"]}
    t(("Virginia", "Ashburn") in towns and ("Iowa", "Council Bluffs") in towns, "towns averaging under the rule are removed")
    t(("Georgia", "Ashburn") not in towns, "a real town sharing a server town's name is kept -- matched on state AND city")
    t(("Ohio", "Tiny") not in towns, "a town under the minimum readers is never judged")
    t(g["servers"]["users"] == 640, "the removed readers are counted and published")
    later = [r for r in seen if [d.name for d in r.dimensions] != ["region", "city"]]
    t(all("Ashburn" in str(r.dimension_filter) for r in later), "every later GA4 query excludes the server towns")
    t(all("United States" in str(r.dimension_filter) for r in seen), "every GA4 query is US only")
    t(set(g["totals"]) == {"7d", "28d", "90d", "ytd"}, "totals exist for every range")
    st = {x["code"]: x for x in g["states"]["28d"]}
    t(set(st) == {"IA", "WI", "TX"}, "only US states become rows")
    t(st["WI"]["rank"] is None and st["IA"]["rank"] == 1 and st["TX"]["rank"] == 2, "home state unranked, others 1..n by engaged")
    t(g["pages"]["28d"][0]["views"] == 45 and g["pages"]["28d"][0]["title"] == "Local Cash Grain Bids Today"
      and "users" not in g["pages"]["28d"][0],
      "a page's views are summed across its titles, and the site suffix is dropped")
    t(g["devices"]["7d"] == {"mobile": 7, "desktop": 3}, "devices per range")
    t(g["gaDays"] == {"2026-09-22": {"users": 11, "engaged": 7}}, "daily series keyed by ISO date")

    # Search Console
    class Sess:
        def __init__(self):
            self.bodies = []

        def get(self, url, timeout=None):
            return type("J", (), {"raise_for_status": lambda s: None, "json": lambda s: {"siteEntry": [{"siteUrl": "https://agsist.com/"},
                                                                    {"siteUrl": "sc-domain:agsist.com"},
                                                                    {"siteUrl": "https://other.com/"}]}})()

        def post(self, url, json, timeout=None):
            self.bodies.append((url, json))
            if json["dimensions"] == ["date"]:
                rows = [{"keys": ["2026-09-20"], "clicks": 30, "impressions": 900, "ctr": .03, "position": 9}]
            else:
                rows = [{"keys": ["cash bids near me"], "clicks": 12, "impressions": 300, "ctr": .04, "position": 5.44}]
            return type("J", (), {"raise_for_status": lambda s: None, "json": lambda s: {"rows": rows}})()
    s = Sess()
    gs = gsc_section(s, rg, today)
    t(gs["site"] == "sc-domain:agsist.com", "the domain property is preferred over a URL-prefix one")
    t(all(b[1]["dimensionFilterGroups"][0]["filters"][0]["expression"] == "usa" for b in s.bodies), "Search Console is US searches only")
    t("sc-domain%3Aagsist.com" in s.bodies[0][0], "the property is URL-encoded into the path")
    t(gs["queries"]["rows"][0] == {"q": "cash bids near me", "clicks": 12, "impr": 300, "pos": 5.4}, "queries carry clicks, impressions, position")

    # Bing
    def get(method, params):
        if method == "GetUserSites":
            return {"d": [{"Url": "https://agsist.com/"}]}
        if method == "GetRankAndTrafficStats":
            return {"d": [{"Date": "/Date(1790060400000-0700)/", "Clicks": 90, "Impressions": 3000}]}
        wk = lambda d: "/Date(%d)/" % (datetime(2026, 9, d, tzinfo=timezone.utc).timestamp() * 1000)
        return {"d": [{"Date": wk(1), "Query": "grain bids", "Clicks": 5, "Impressions": 50},
                      {"Date": wk(8), "Query": "grain bids", "Clicks": 6, "Impressions": 60},
                      {"Date": wk(15), "Query": "hail map", "Clicks": 9, "Impressions": 70},
                      {"Date": wk(22), "Query": "cbot corn", "Clicks": 1, "Impressions": 40},
                      {"Date": "/Date(1700000000000)/", "Query": "old", "Clicks": 99, "Impressions": 999}]}
    b = bing_section(get, rg, today)
    t(b["days"] == {"2026-09-22": {"clicks": 90, "impr": 3000}}, "Bing's /Date(ms)/ is read as a UTC date")
    t([r["q"] for r in b["queries"]["rows"]] == ["grain bids", "hail map", "cbot corn"], "only the last four weekly buckets, summed per query")
    t(b["queries"]["start"] == "2026-09-01" and b["queries"]["end"] == "2026-09-22", "the query window is the buckets' own dates")

    t(email_count("https://w", "t", fetch=lambda u: "a@x.com,\nB@x.com\nb@x.com\n\nnot-an-email") == 2,
      "the subscriber count de-duplicates and keeps only the count")

    out = build(today, {}, g, gs, b, 42)
    t(out["schema"] == SCHEMA and out["email"]["subscribers"] == 42, "a full build carries every section")
    day = [x for x in out["series"]["days"] if x["d"] == "2026-09-22"][0]
    t(day["users"] == 11 and day["bClicks"] == 90 and day["gClicks"] is None, "one day row joins all three sources; a missing one is null, not zero")
    prev = out
    out2 = build(today, prev, None, gs, None, None, {"ga4": "boom"})
    t(out2["totals"] == prev["totals"] and out2["sources"]["ga4"]["ok"] is False and out2["sources"]["ga4"]["error"] == "boom",
      "a failed GA4 run keeps the previous numbers and says it failed")
    day2 = [x for x in out2["series"]["days"] if x["d"] == "2026-09-22"][0]
    t(day2["users"] == 11 and day2["bClicks"] == 90, "the carried days survive a partial run")
    t(out2["email"]["subscribers"] == 42, "a missing subscriber count carries the last one with its date")
    exp = {"schema": SCHEMA, "mode": "export", "ranges": [{"id": "ytd", "label": "2026", "start": "2026-01-01", "end": "2026-09-22"}],
           "totals": {"ytd": {"users": 5}}, "states": {"ytd": []}, "stateFlagRule": {"seconds": 40},
           "searchStatic": {"google": {}}, "ai": {"perDay": 1}}
    o3 = build(today, exp, None, gs, None, None)
    t(o3["mode"] == "export" and o3["stateFlagRule"] == {"seconds": 40} and o3["ranges"] == exp["ranges"],
      "with GA4 still unconnected, the export's figures keep the export's windows and flag rule")
    t("searchStatic" not in o3 and o3["ai"] == {"perDay": 1}, "live search replaces the export's search card; AI citations carry")
    o5 = build(today, dict(exp, searchStatic={"google": {"c": 1}, "bing": {"c": 2}}), None, None, b, None)
    t(o5["searchStatic"] == {"google": {"c": 1}}, "Bing live alone removes only the Bing export card")
    t(o5["series"]["end"] == "2026-09-22", "the series ends at the last finished day even when GA4 carried older windows")
    t(is_ours("sc-domain:agsist.com") and is_ours("https://www.agsist.com/") and not is_ours("https://notagsist.com/")
      and not is_ours("https://agsist.com.evil.io/"), "only agsist.com itself is taken as ours")

    class Bad:
        def get(self, url, timeout=None):
            return type("R", (), {"raise_for_status": lambda s: (_ for _ in ()).throw(RuntimeError("403")), "json": lambda s: {}})()
    try:
        gsc_section(Bad(), rg, today)
        t(False, "a Search Console HTTP error fails the source")
    except RuntimeError:
        t(True, "a Search Console HTTP error fails the source instead of reading as an empty month")
    o4 = build(today, exp, g, None, None, None)
    t("mode" not in o4 and "stateFlagRule" not in o4 and set(o4["totals"]) == {"7d", "28d", "90d", "ytd"},
      "once GA4 answers, the export's single range and flag rule are gone")
    print("selftest " + ("passed" if ok else "FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else main())
