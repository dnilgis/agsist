#!/usr/bin/env python3
"""
gsc_index_check.py - is Google actually indexing the pages we publish?

Sitemaps say what we offer; only Google can say what it kept. This asks the
Search Console URL Inspection API about a small weekly sample and writes
data/seo-index.json:

    POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect
         {"inspectionUrl": ..., "siteUrl": ...}

The sample (about 100 URLs a week, far under the 2,000 a day quota):
  * the hub pages in HUBS, every week
  * PER_SITEMAP URLs from each sitemap robots.txt lists, rotating: the
    sitemap's URLs are sorted and the week number picks an evenly spaced
    slice, so over len/PER_SITEMAP weeks every URL gets inspected once

Per URL it records verdict, coverageState, indexingState, robotsTxtState,
pageFetchState, lastCrawlTime, googleCanonical and userCanonical, and flags
when Google chose a different canonical from ours. Per sitemap it records how
many of the inspected URLs Google reports as indexed (verdict PASS). Those
shares are of a small sample, so the file carries the sample size next to
every share. The last HISTORY_RUNS summaries are kept for a trend.

Auth: the same service account and property as gsc_submit_sitemaps.py
(GSC_SERVICE_ACCOUNT_JSON; GSC_SITE, default sc-domain:agsist.com, then
https://agsist.com/). URL Inspection needs that account to be a user of the
property, which it already is for the sitemap submit. Missing secret: one
notice line, exit 0. An error on a single URL is recorded and the run goes
on; a run where nothing could be inspected leaves the file alone and exits 1.

    python3 scripts/gsc_index_check.py             # inspect and write
    python3 scripts/gsc_index_check.py --dry-run   # print the sample, no network
    python3 scripts/gsc_index_check.py --selftest  # offline, fake transport
"""
import json
import math
import os
import re
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gsc_submit_sitemaps import robots_sitemaps, site_candidates  # noqa: E402
from site_usage_report import UrllibTransport, google_token, load_key, err_text  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
OUT = "data/seo-index.json"
API = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
SECRET_ENV = "GSC_SERVICE_ACCOUNT_JSON"
ORIGIN = "https://agsist.com"

PER_SITEMAP = 20       # rotating sample per sitemap per run
HISTORY_RUNS = 26      # weekly summaries kept for the trend
PAUSE_S = 0.4          # between calls; the per-minute quota is 600

# Inspected every run: the pages most of the search traffic lands on, and the
# hubs each generated set hangs off.
HUBS = [
    "/", "/markets", "/cash-bids", "/arc-plc", "/farmland-atlas", "/rent/",
    "/usda-calendar", "/usda-quick-stats", "/corn-futures-prices",
    "/soybean-futures-prices", "/wheat-futures-prices", "/cattle-futures-prices",
    "/grain-bin-calculator", "/yield-estimator", "/hail-map", "/cot",
    "/crop-tour", "/fertilizer", "/spray", "/daily",
]
FIELDS = ("verdict", "coverageState", "indexingState", "robotsTxtState",
          "pageFetchState", "lastCrawlTime", "googleCanonical", "userCanonical")


def sitemap_urls(root=REPO):
    """{sitemap file name: [urls]} for every sitemap robots.txt lists."""
    out = {}
    for sm in robots_sitemaps(root):
        name = sm.rsplit("/", 1)[-1]
        p = Path(root) / name
        if p.is_file():
            out[name] = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", p.read_text(encoding="utf-8"))
    return out


def rotating(urls, n, week):
    """n evenly spaced URLs, shifted by the week number. Every URL comes up
    once every ceil(len/n) weeks."""
    urls = sorted(set(urls))
    if len(urls) <= n:
        return urls
    stride = len(urls) / n
    off = week % math.ceil(stride)
    return [urls[int(i * stride) + off] for i in range(n) if int(i * stride) + off < len(urls)]


def build_sample(sitemaps, week, hubs=HUBS, per=PER_SITEMAP):
    """[(url, group)]: hubs first, then each sitemap's rotating slice."""
    seen, out = set(), []
    for h in hubs:
        u = ORIGIN + h
        if u not in seen:
            seen.add(u)
            out.append((u, "hubs"))
    for name, urls in sitemaps.items():
        for u in rotating([x for x in urls if x not in seen], per, week):
            seen.add(u)
            out.append((u, name))
    return out


def inspect_one(url, site, token, transport):
    """(status, record). Record holds the fields, or an "error"."""
    st, body = transport("POST", API, token, {"inspectionUrl": url, "siteUrl": site})
    if st != 200:
        return st, {"error": f"HTTP {st} {err_text(body)}"}
    try:
        r = (json.loads(body).get("inspectionResult") or {}).get("indexStatusResult") or {}
    except ValueError:
        return st, {"error": "unreadable response"}
    rec = {k: r.get(k) for k in FIELDS}
    gc, uc = rec.get("googleCanonical"), rec.get("userCanonical")
    rec["canonicalMismatch"] = bool(gc and uc and gc != uc)
    return st, rec


def summarize(results):
    groups = {}
    for r in results:
        g = groups.setdefault(r["group"], {"inspected": 0, "indexed": 0, "errors": 0,
                                           "canonicalMismatch": 0, "notIndexedStates": {}})
        if r.get("error"):
            g["errors"] += 1
            continue
        g["inspected"] += 1
        if r.get("verdict") == "PASS":
            g["indexed"] += 1
        else:
            s = r.get("coverageState") or "unknown"
            g["notIndexedStates"][s] = g["notIndexedStates"].get(s, 0) + 1
        if r.get("canonicalMismatch"):
            g["canonicalMismatch"] += 1
    for g in groups.values():
        g["shareIndexed"] = round(g["indexed"] / g["inspected"], 3) if g["inspected"] else None
    return groups


def run(token, transport, env_site, today, root=REPO, log=print, pause=PAUSE_S, prev=None):
    """Returns (exit code, payload or None)."""
    week = today.isocalendar()[1] + 53 * today.isocalendar()[0]
    sample = build_sample(sitemap_urls(root), week)
    site = None
    results = []
    cands = site_candidates(env_site)
    for url, group in sample:
        if site is None:
            for cand in cands:
                st, rec = inspect_one(url, cand, token, transport)
                if st in (403, 404) or (st == 400 and "property" in rec.get("error", "").lower()):
                    log(f"[index] property {cand}: {rec.get('error')}")
                    continue
                site = cand
                log(f"[index] property {cand}")
                break
            if site is None:
                log("[index] no property accepted the service account. Add its email as a user "
                    "of the Search Console property, or set GSC_SITE.")
                return 1, None
        else:
            st, rec = inspect_one(url, site, token, transport)
            if pause:
                time.sleep(pause)
        if st == 429:
            log("[index] quota reached; stopping with what we have")
            results.append(dict(rec, url=url, group=group))
            break
        results.append(dict(rec, url=url, group=group))
    ok = [r for r in results if not r.get("error")]
    if not ok:
        log(f"[index] nothing could be inspected ({len(results)} errors); file left alone")
        # Counts only: the Actions log is public, and which page fails how is
        # part of the private SEO picture.
        kinds = {}
        for r in results:
            k = " ".join(str(r.get("error") or "").split()[:2])   # "HTTP 403", no URL
            kinds[k] = kinds.get(k, 0) + 1
        for k, n in sorted(kinds.items(), key=lambda kv: -kv[1])[:3]:
            log(f"  {n} x {k}")
        return 1, None
    summary = summarize(results)
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    hist = [h for h in (prev or {}).get("history", []) if h.get("date") != today.isoformat()]
    hist.append({"date": today.isoformat(),
                 "groups": {k: {"inspected": v["inspected"], "indexed": v["indexed"]}
                            for k, v in summary.items()}})
    payload = {
        "schema": "agsist-seo-index/1",
        "generated": now,
        "site": site,
        "note": ("A weekly sample from the Search Console URL Inspection API: the hub pages "
                 "every week, plus a rotating slice of each sitemap. Shares are of the "
                 "inspected sample only; 'inspected' is the sample size."),
        "sampleSize": len(sample),
        "summary": summary,
        "history": hist[-HISTORY_RUNS:],
        "urls": results,
    }
    log(f"[index] {len(ok)} inspected, {len(results) - len(ok)} errors")
    for g, v in summary.items():
        share = "n/a" if v["shareIndexed"] is None else f"{v['shareIndexed'] * 100:.0f}%"
        log(f"  {g:24s} indexed {v['indexed']}/{v['inspected']} ({share})"
            f"  canonical differs {v['canonicalMismatch']}  errors {v['errors']}")
        for s, n in sorted(v["notIndexedStates"].items(), key=lambda kv: -kv[1])[:3]:
            log(f"      not indexed: {n} x {s}")
    return 0, payload


def write(payload, root=REPO):
    (Path(root) / OUT).parent.mkdir(parents=True, exist_ok=True)
    with open(Path(root) / OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)
        fh.write("\n")


def read_prev(root=REPO):
    try:
        return json.loads((Path(root) / OUT).read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def main():
    today = date.today()
    if "--dry-run" in sys.argv:
        week = today.isocalendar()[1] + 53 * today.isocalendar()[0]
        for u, g in build_sample(sitemap_urls(), week):
            print(g, u)
        return 0
    info, reason = load_key(SECRET_ENV, os.environ.get(SECRET_ENV))
    if info is None:
        if not (os.environ.get(SECRET_ENV) or "").strip():
            print(f"[index] {SECRET_ENV} is not set; skipping the URL Inspection check.")
            return 0
        print(f"[index] {reason}")
        return 1
    try:
        token = google_token(info, SCOPE)
    except Exception as e:  # noqa: BLE001  message may quote the key; print the type only
        print(f"[index] could not get an access token ({type(e).__name__}).")
        return 1
    rc, payload = run(token, UrllibTransport(), os.environ.get("GSC_SITE"), today, prev=read_prev())
    if payload:
        write(payload)
        print(f"[index] wrote {OUT}")
    return rc


# ---------------------------------------------------------------- selftest
def selftest():
    import tempfile
    failed = []

    def check(ok, name, detail=""):
        print(("  ok    " if ok else "  FAIL  ") + name + ("" if ok else "  :: " + str(detail)))
        if not ok:
            failed.append(name)

    class Fake:
        def __init__(self, ok_site="sc-domain:agsist.com", fail=(), quota_after=None):
            self.ok_site, self.fail, self.calls, self.quota_after = ok_site, set(fail), [], quota_after

        def __call__(self, method, url, token, body=None):
            self.calls.append((method, url, token, body))
            if body["siteUrl"] != self.ok_site:
                return 403, json.dumps({"error": {"message": "You do not own this site"}})
            if self.quota_after is not None and len(self.calls) > self.quota_after:
                return 429, json.dumps({"error": {"message": "Quota exceeded"}})
            u = body["inspectionUrl"]
            if any(f in u for f in self.fail):
                return 0, "network error: timed out"
            idx = not u.endswith("-county") or u.endswith("a-county")
            res = {"verdict": "PASS" if idx else "NEUTRAL",
                   "coverageState": "Submitted and indexed" if idx else "Crawled - currently not indexed",
                   "indexingState": "INDEXING_ALLOWED", "robotsTxtState": "ALLOWED",
                   "pageFetchState": "SUCCESSFUL", "lastCrawlTime": "2026-10-01T00:00:00Z",
                   "userCanonical": u,
                   "googleCanonical": u if "/rent/" not in u else ORIGIN + "/rent"}
            return 200, json.dumps({"inspectionResult": {"indexStatusResult": res}})

    with tempfile.TemporaryDirectory() as d:
        Path(d, "robots.txt").write_text("Sitemap: https://agsist.com/sitemap.xml\n"
                                         "Sitemap: https://agsist.com/sitemap-x.xml\n")
        Path(d, "sitemap.xml").write_text("".join(f"<loc>https://agsist.com/p{i}</loc>" for i in range(50))
                                          + "<loc>https://agsist.com/markets</loc>")
        Path(d, "sitemap-x.xml").write_text("".join(f"<loc>https://agsist.com/x/{c}-county</loc>"
                                                    for c in "abcdefghij"))
        today = date(2026, 10, 12)
        logs = []
        f = Fake()
        rc, p = run("TOKEN123", f, None, today, root=d, log=logs.append, pause=0)
        check(rc == 0 and p, "runs and builds a payload", logs)
        check(len(f.calls) == len(HUBS) + PER_SITEMAP + 10, "hubs + rotating slice + small sitemap whole",
              len(f.calls))
        check(sum(1 for r in p["urls"] if r["url"] == ORIGIN + "/markets") == 1, "a hub is not inspected twice")
        s = p["summary"]
        check(s["sitemap-x.xml"]["inspected"] == 10 and s["sitemap-x.xml"]["indexed"] == 1,
              "per-sitemap indexed count", s["sitemap-x.xml"])
        check(s["sitemap-x.xml"]["notIndexedStates"] == {"Crawled - currently not indexed": 9},
              "not-indexed reasons counted", s["sitemap-x.xml"])
        check(s["hubs"]["canonicalMismatch"] == 1, "google vs user canonical mismatch flagged", s["hubs"])
        check(f.calls[0][1] == API and f.calls[0][3] == {"inspectionUrl": ORIGIN + "/",
                                                         "siteUrl": "sc-domain:agsist.com"},
              "POST body is inspectionUrl + siteUrl", f.calls[0])
        check(not any("TOKEN123" in l for l in logs), "token never logged")
        check(len(p["history"]) == 1, "history started")

        rc2, p2 = run("T", Fake(), None, date(2026, 10, 19), root=d, log=[].append, pause=0, prev=p)
        check(len(p2["history"]) == 2, "history carried forward")
        a = {r["url"] for r in p["urls"] if r["group"] == "sitemap.xml"}
        b = {r["url"] for r in p2["urls"] if r["group"] == "sitemap.xml"}
        check(a != b, "next week inspects a different slice")

        logs = []
        f = Fake("https://agsist.com/")
        rc, p = run("T", f, None, today, root=d, log=logs.append, pause=0)
        check(rc == 0 and p["site"] == "https://agsist.com/", "403 falls back to the URL-prefix property", logs)

        logs = []
        rc, p = run("T", Fake(fail=["/p"]), None, today, root=d, log=logs.append, pause=0)
        check(rc == 0 and p["summary"]["sitemap.xml"]["errors"] == PER_SITEMAP,
              "single-URL network errors are recorded, run continues", p and p["summary"])

        logs = []
        rc, p = run("T", Fake(fail=["agsist.com"]), None, today, root=d, log=logs.append, pause=0)
        check(rc == 1 and p is None, "nothing inspected: exit 1, no payload", logs)

        rc, p = run("T", Fake("sc-domain:other.com"), None, today, root=d, log=[].append, pause=0)
        check(rc == 1 and p is None, "no property works: exit 1")

        rc, p = run("T", Fake(quota_after=5), None, today, root=d, log=[].append, pause=0)
        check(rc == 0 and len(p["urls"]) == 6, "quota stop keeps what was inspected", p and len(p["urls"]))

        write(p2, d)
        check(read_prev(d)["schema"] == "agsist-seo-index/1", "write and read back")

    r = rotating([f"u{i:03d}" for i in range(100)], 10, 3)
    check(len(r) == 10 and r[0] == "u003" and r[1] == "u013", "rotating slice is evenly spaced and shifted", r)
    seen = set()
    for wk in range(10):
        seen |= set(rotating([f"u{i:03d}" for i in range(100)], 10, wk))
    check(len(seen) == 100, "ten weeks cover all hundred URLs", len(seen))
    big = [f"u{i:04d}" for i in range(2839)]
    seen = set()
    for wk in range(142):
        seen |= set(rotating(big, 20, wk))
    check(len(seen) == 2839, "an uneven stride still covers every URL", len(seen))

    saved = os.environ.pop(SECRET_ENV, None)
    try:
        check(main() == 0, "missing secret: exit 0")
    finally:
        if saved is not None:
            os.environ[SECRET_ENV] = saved

    if failed:
        print(f"\n{len(failed)} failed")
        return 1
    print("\nall index check tests pass")
    return 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv[1:] else main())
