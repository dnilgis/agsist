#!/usr/bin/env python3
"""probe_feeder_archive.py -- where can past issues of the USDA AMS single-barn
auction reports (the "Livestock Auction Wtd Avg" PDFs that
scripts/fetch_cattle_auction.py reads) be read, for backfilling the AGSIST
USDA feeder steer index (scripts/build_feeder_index.py)?

www.ams.usda.gov/mnreports/ams_<slug>.pdf is only ever the LATEST issue. This
asks each candidate archive, for a few barns, what it holds, and saves every
answer as sent to history/feeder-archive/probe/ (the workflow puts that on the
private raw branch). It never decides anything on its own: a person reads the
result.

Candidates (all public, no login):
  1. My Market News file repository listing for the report number
       https://mymarketnews.ams.usda.gov/filerepo/reports?field_slug_id_value=<slug>
     and the PDFs it links to.
  2. My Market News report page https://mymarketnews.ams.usda.gov/viewReport/<slug> (shape only).
  3. The MARS API https://marsapi.ams.usda.gov/services/v1.2/reports/<slug>: without a key (to see
     whether it answers at all) and, only when a MARS_API_KEY secret is set, with it (HTTP basic,
     never printed; the log says only whether a key was present).
  4. The Internet Archive's captures of ams_<slug>.pdf (CDX list, then one capture from early 2025).
  5. search.ams.usda.gov (the old Market News text archive) and ESMIS: status only.

Manners: robots.txt is read for every host first and a path it disallows is not
asked (recorded as "robots: disallowed"); one request at a time, 1.5 s apart; a
refusal (401/403/429) is recorded, never worked around.

Every PDF that comes back goes through fetch_cattle_auction's own reader
(parse_report, title check, summarize) and the result is in summary.json.

    python3 scripts/probe_feeder_archive.py --selftest
    python3 scripts/probe_feeder_archive.py --probe [--slugs 1856,1245]
    python3 scripts/probe_feeder_archive.py --coverage
        the Internet Archive's capture list (CDX) for every single-barn report in
        scripts/cattle_auction_sources.json, no PDFs: how many barns and states
        have a capture in each week (coverage.json). A capture holds the report
        that was current then, so its sale is in that week or the one before:
        this is an upper bound on what a week could be built from.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import argparse
import base64
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.robotparser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from history_lib import UA, Fetcher, FetchError, now_iso  # noqa: E402
import fetch_cattle_auction as FCA  # noqa: E402
import fetch_dairy as FD  # noqa: E402

OUT = "history/feeder-archive/probe"
DEFAULT_SLUGS = ["1856", "1245"]          # Valentine NE, Joplin MO: confirmed, large, every week
MMN = "https://mymarketnews.ams.usda.gov"
FILEREPO = MMN + "/filerepo/reports?field_slug_id_value=%s&page=%d"
VIEW = MMN + "/viewReport/%s"
MARS = "https://marsapi.ams.usda.gov/services/v1.2/reports/%s?q=report_begin_date=%s:%s"
MARS_LIST = "https://marsapi.ams.usda.gov/services/v1.2/reports"
CDX = ("https://web.archive.org/cdx/search/cdx?url=%s&output=json"
       "&fl=timestamp,original,statuscode,mimetype,digest,length&filter=statuscode:200&collapse=digest")
WAYBACK = "https://web.archive.org/web/%sid_/%s"
OTHERS = ["https://search.ams.usda.gov/mnreports/ams_%s.pdf", "https://search.ams.usda.gov/mndms/2025/01/",
          "https://esmis.nal.usda.gov/search?search_api_fulltext=ams_%s"]
PDF_HREF_RE = re.compile(r"""href=["']([^"']+?\.pdf)["']""", re.I)
DATE_IN_PATH_RE = re.compile(r"/(20\d\d-\d\d-\d\d)/")
SAVE_CAP = 400000


class Robots:
    """robots.txt per host, read once. A host whose robots.txt cannot be read is
    treated as allowing (the standard), and that is recorded."""

    def __init__(self, fetch, log=print):
        self.fetch, self.log, self.seen = fetch, log, {}

    def allowed(self, url):
        p = urllib.parse.urlsplit(url)
        host = p.scheme + "://" + p.netloc
        if host not in self.seen:
            rp = urllib.robotparser.RobotFileParser()
            try:
                s, b = self.fetch.get(host + "/robots.txt")
                txt = b.decode("utf-8", "replace") if s == 200 else ""
                note = "HTTP %s, %d bytes" % (s, len(b or b""))
            except FetchError as e:
                txt, note = "", "not read: %s" % e
            rp.parse(txt.splitlines())
            self.seen[host] = {"rp": rp, "note": note, "text": txt[:4000]}
            self.log("  robots %s: %s" % (host, note))
        return self.seen[host]["rp"].can_fetch(UA, url)

    def record(self):
        return {h: {"note": v["note"], "text": v["text"]} for h, v in self.seen.items()}


def safe_name(url):
    return re.sub(r"[^A-Za-z0-9]+", "_", url.split("//", 1)[-1])[:110]


def pdf_links(page_html, base=MMN):
    """PDF links on a file repository page, absolute, in page order, no repeats."""
    out = []
    for h in PDF_HREF_RE.findall(page_html or ""):
        u = urllib.parse.urljoin(base + "/", html.unescape(h))
        if u not in out:
            out.append(u)
    return out


def read_pdf(raw, slug, src=None):
    """What fetch_cattle_auction's own reader makes of one archived PDF."""
    if not raw or raw[:5] != b"%PDF-":
        return {"pdf": False}, None
    text, err = FD.pdf_to_text(raw)
    if not text:
        return {"pdf": True, "text": False, "why": err}, None
    p, why = FCA.parse_report(text)
    o = {"pdf": True, "text": True, "title": FCA.report_title(text)[:160]}
    if p is None:
        o["parsed"], o["why"] = False, why
        return o, text
    s = FCA.summarize(p)
    o.update({"parsed": True, "date": p["date"], "receipts": p["receipts"],
              "title_ok": FCA.title_ok(src, p["title"]) if src else None,
              "tables": {k: len(v) for k, v in p["tables"].items()},
              "steers_700_800": {c: (s["classes"].get("steers|1", {}).get(c) or s["classes"].get("steers|1-2", {}).get(c) or {}).get("head")
                                 for c in ("700", "800")}})
    return o, text


def mars_auth():
    key = os.environ.get("MARS_API_KEY", "").strip()
    if not key:
        return None
    return {"Authorization": "Basic " + base64.b64encode((key + ":").encode()).decode(), "Accept": "application/json"}


def ask(fetch, robots, url, rec, save_dir, name=None, keep=True):
    """GET url politely; record status and size; save the body. -> (status, body) or (None, b"")."""
    r = {"url": url.split("?")[0] if "marsapi" in url else url}
    if not robots.allowed(url):
        r["status"] = "robots: disallowed"
        rec.append(r)
        return None, b""
    try:
        s, b = fetch.get(url)
    except FetchError as e:
        r["status"], r["error"] = "failed", str(e)[:300]
        rec.append(r)
        return None, b""
    r["status"], r["bytes"] = s, len(b or b"")
    r["kind"] = "pdf" if (b or b"")[:5] == b"%PDF-" else "json" if (b or b"").lstrip()[:1] in (b"{", b"[") else "html/text"
    if keep and b:
        fn = (name or safe_name(url)) + (".pdf" if r["kind"] == "pdf" else ".txt")
        with open(os.path.join(save_dir, fn), "wb") as f:
            f.write(b if r["kind"] == "pdf" else b[:SAVE_CAP])
        r["saved"] = fn
    rec.append(r)
    return s, b or b""


def probe(slugs, out=OUT, fetch=None, mars_fetch=None, log=print):
    os.makedirs(out, exist_ok=True)
    fetch = fetch or Fetcher(min_gap=1.5, retries=1, timeout=60, ok=(200, 401, 403, 404, 410, 429))
    robots = Robots(fetch, log)
    cfg = FCA.load_sources(FCA.ROOT)
    by_slug = {}
    for b in cfg.get("barns") or []:
        for s in [b.get("slug")] + list(b.get("also") or []):
            if s:
                by_slug.setdefault(str(s), b)
    summary = {"read": now_iso(), "slugs": slugs, "mars_key_present": bool(mars_auth()), "barns": {}}
    log("MARS key present: %s" % summary["mars_key_present"])
    for slug in slugs:
        src = by_slug.get(slug)
        d = os.path.join(out, slug)
        os.makedirs(d, exist_ok=True)
        rec, reads = [], []
        log("barn %s (%s)" % (slug, src["id"] if src else "not in the barn list"))
        # 1. file repository: pages 0, 1, then deep pages to find the oldest issue
        links = []
        for pg in (0, 1, 10, 40):
            s, b = ask(fetch, robots, FILEREPO % (slug, pg), rec, d, "filerepo_p%d" % pg)
            got = pdf_links(b.decode("utf-8", "replace")) if s == 200 else []
            log("  filerepo page %d: %s, %d PDF links" % (pg, s, len(got)))
            links += [u for u in got if u not in links]
            if s != 200 or not got:
                break
        dated = sorted(((DATE_IN_PATH_RE.search(u).group(1) if DATE_IN_PATH_RE.search(u) else "", u) for u in links))
        picks = []
        if dated:
            picks = [dated[-1][1]] + ([dated[0][1]] if dated[0][1] != dated[-1][1] else [])
            jan25 = [u for k, u in dated if k.startswith("2025-01")]
            if jan25 and jan25[0] not in picks:
                picks.append(jan25[0])
        for i, u in enumerate(picks[:3]):
            s, b = ask(fetch, robots, u, rec, d, "filerepo_pdf_%d" % i)
            o, text = read_pdf(b, slug, src)
            o["url"] = u
            reads.append(o)
            if text:
                with open(os.path.join(d, "filerepo_pdf_%d.text.txt" % i), "w", encoding="utf-8") as f:
                    f.write(text)
            log("  filerepo pdf %s: %s" % (u.rsplit("/", 1)[-1], json.dumps(o)[:300]))
        summary_links = {"count": len(links), "first_dates": [k for k, _ in dated[:3]], "last_dates": [k for k, _ in dated[-3:]]}
        # 2. report page
        ask(fetch, robots, VIEW % slug, rec, d, "viewreport")
        # 3. MARS, without a key, then with one if set
        mu = MARS % (slug, "01/06/2025", "01/12/2025")
        s, b = ask(fetch, robots, mu, rec, d, "mars_nokey")
        log("  MARS without a key: %s" % s)
        if mars_auth():
            mf = mars_fetch or Fetcher(min_gap=1.5, retries=1, timeout=60, headers=mars_auth(), ok=(200, 401, 403, 404))
            s, b = ask(mf, robots, mu, rec, d, "mars_key")
            log("  MARS with the key: %s, %d bytes" % (s, len(b)))
        # 4. Internet Archive captures of the latest-issue URL
        for orig in ("www.ams.usda.gov/mnreports/ams_%s.pdf" % slug,):
            s, b = ask(fetch, robots, CDX % urllib.parse.quote(orig, safe=""), rec, d, "cdx")
            caps = []
            if s == 200:
                try:
                    rows = json.loads(b.decode("utf-8", "replace") or "[]")
                    caps = rows[1:] if rows and rows[0] and rows[0][0] == "timestamp" else rows
                except ValueError:
                    caps = []
            years = {}
            for c in caps:
                years[c[0][:4]] = years.get(c[0][:4], 0) + 1
            summary_links["wayback_captures"] = len(caps)
            summary_links["wayback_by_year"] = years
            log("  wayback captures of %s: %d %s" % (orig, len(caps), years))
            early = [c for c in caps if c[0][:6] >= "202501"][:1] or caps[:1]
            for i, c in enumerate(early):
                s, b = ask(fetch, robots, WAYBACK % (c[0], c[1]), rec, d, "wayback_%s" % c[0])
                o, text = read_pdf(b, slug, src)
                o["capture"] = c[0]
                reads.append(o)
                if text:
                    with open(os.path.join(d, "wayback_%s.text.txt" % c[0]), "w", encoding="utf-8") as f:
                        f.write(text)
                log("  wayback %s: %s" % (c[0], json.dumps(o)[:300]))
        # 5. status only
        for t in OTHERS:
            u = t % slug if "%s" in t else t
            s, b = ask(fetch, robots, u, rec, d, keep=True)
            log("  %s: %s" % (u, s))
        summary["barns"][slug] = {"barn": src["id"] if src else None, "asked": rec, "reads": reads, "filerepo": summary_links}
    ask(fetch, robots, MARS_LIST, summary.setdefault("mars_list", []), out, "mars_list_nokey")
    summary["robots"] = robots.record()
    with open(os.path.join(out, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=1)
    ok = any(r.get("parsed") for b in summary["barns"].values() for r in b["reads"])
    log("probe done: %s" % ("at least one archived report read by the barn reader" if ok else "no archived report read"))
    return summary


def week_of(ts):
    import datetime
    d = datetime.date(int(ts[:4]), int(ts[4:6]), int(ts[6:8]))
    return (d - datetime.timedelta(days=d.weekday())).isoformat()


def flush_log(*a):
    print(*a, flush=True)


def coverage(out=OUT, fetch=None, log=flush_log, since="2024", minutes=0, clock=None):
    """Captures per week across every single-barn report (CDX lists only). Saved
    after every report, so a run cut short keeps what it listed."""
    import time
    clock = clock or time.monotonic
    stop = clock() + minutes * 60 if minutes else None
    os.makedirs(out, exist_ok=True)
    fetch = fetch or Fetcher(min_gap=1.5, retries=1, timeout=30, backoff=(5,), ok=(200, 404))
    robots = Robots(fetch, log)
    cfg = FCA.load_sources(FCA.ROOT)
    weeks, per_slug, rec = {}, {}, []
    for b in cfg.get("barns") or []:
        for slug in [b.get("slug")] + list(b.get("also") or []):
            if not slug:
                continue
            orig = "www.ams.usda.gov/mnreports/ams_%s.pdf" % slug
            s, body = ask(fetch, robots, CDX % urllib.parse.quote(orig, safe=""), rec, out, keep=False)
            caps = []
            if s == 200:
                try:
                    rows = json.loads(body.decode("utf-8", "replace") or "[]")
                    caps = [r for r in rows[1:]] if rows and rows[0] and rows[0][0] == "timestamp" else rows
                except ValueError:
                    caps = []
            caps = [c for c in caps if c[0][:4] >= since]
            per_slug[slug] = [c[0] for c in caps]
            for c in caps:
                w = weeks.setdefault(week_of(c[0]), {"barns": set(), "states": set()})
                w["barns"].add(b["id"])
                w["states"].add(b["state"])
            log("  %s (%s): %s, %d copies since %s" % (slug, b["id"], rec[-1].get("status") if rec else "-", len(caps), since))
            save_coverage(out, since, per_slug, weeks, rec, partial=True)
            if stop and clock() > stop:
                log("stopped at the time limit")
                break
        else:
            continue
        break
    return save_coverage(out, since, per_slug, weeks, rec, partial=False, log=log)


def save_coverage(out, since, per_slug, weeks, rec, partial, log=None):
    table = {k: {"barns": len(v["barns"]), "states": len(v["states"])} for k, v in sorted(weeks.items())}
    doc = {"read": now_iso(), "since": since, "partial": partial, "slugs": len(per_slug),
           "slugs_with_captures": sum(1 for v in per_slug.values() if v),
           "weeks": table, "weeks_30_barns_8_states": sum(1 for v in table.values() if v["barns"] >= 30 and v["states"] >= 8),
           "per_slug": per_slug, "failed": [r for r in rec if r.get("status") != 200]}
    with open(os.path.join(out, "coverage.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1)
    if log:
        log("coverage: %d reports, %d with captures since %s; %d weeks with a capture; weeks with 30+ barns in 8+ states: %d"
            % (doc["slugs"], doc["slugs_with_captures"], since, len(table), doc["weeks_30_barns_8_states"]))
        for k, v in table.items():
            log("  week of %s: %d barns, %d states" % (k, v["barns"], v["states"]))
    return doc


# ------------------------------------------------------------------ selftest
def selftest():
    import tempfile
    fails = []

    def ck(name, ok, detail=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  %s" % (detail,)))
        if not ok:
            fails.append(name)

    page = ('<a href="/filerepo/sites/default/files/1856/2025-01-06/1/ams_1856_00001.pdf">a</a>'
            '<a href="https://mymarketnews.ams.usda.gov/filerepo/sites/default/files/1856/2026-10-26/9/ams_1856_00090.pdf">b</a>'
            '<a href="/filerepo/sites/default/files/1856/2025-01-06/1/ams_1856_00001.pdf">a again</a>')
    links = pdf_links(page)
    ck("pdf links: absolute, in order, no repeats", links == [
        MMN + "/filerepo/sites/default/files/1856/2025-01-06/1/ams_1856_00001.pdf",
        MMN + "/filerepo/sites/default/files/1856/2026-10-26/9/ams_1856_00090.pdf"], links)
    asked = []

    def opener(u):
        asked.append(u)
        if u.endswith("/robots.txt"):
            if "web.archive.org" in u:
                return 200, b"User-agent: *\nDisallow: /cdx/\n", {}
            return 200, b"User-agent: *\nDisallow: /private/\n", {}
        if "filerepo/reports" in u:
            return 200, (page if u.endswith("page=0") else "").encode(), {}
        if u.endswith(".pdf"):
            return 200, b"%PDF-1.4 not really", {}
        if "marsapi" in u:
            return 401, b'{"message":"unauthorized"}', {}
        return 404, b"", {}

    os.environ.pop("MARS_API_KEY", None)
    with tempfile.TemporaryDirectory() as d:
        f = Fetcher(min_gap=0, retries=0, opener=opener, sleep=lambda s: None, ok=(200, 401, 403, 404))
        s = probe(["1856"], out=d, fetch=f, log=lambda *a: None)
        b = s["barns"]["1856"]
        ck("barn found in the source list", b["barn"] == "valentine-ne", b["barn"])
        ck("two archived PDFs asked (newest, oldest)", sum(1 for r in b["asked"] if "filerepo/sites" in r["url"]) == 2, b["asked"])
        ck("robots disallow obeyed: no CDX request", not any("/cdx/" in u for u in asked) and
           any(r["status"] == "robots: disallowed" for r in b["asked"]), asked)
        ck("MARS without a key recorded as 401", any("marsapi" in r["url"] and r["status"] == 401 for r in b["asked"]))
        ck("no key: never sent", s["mars_key_present"] is False)
        ck("a non-PDF body is not parsed", all(r.get("parsed") is None or r.get("parsed") is False for r in b["reads"]), b["reads"])
        ck("summary saved", os.path.exists(os.path.join(d, "summary.json")))
        ck("MARS url saved without its query", all("?" not in r["url"] for r in b["asked"] if "marsapi" in r["url"]))
    ck("week_of: a Saturday capture is that Monday's week", week_of("20250111093909") == "2025-01-06")

    def op2(u):
        if u.endswith("robots.txt"):
            return 404, b"", {}
        if "ams_1856" in u:
            return 200, json.dumps([["timestamp", "original"], ["20250111093909", "x"], ["20250112093909", "x"], ["20230101000000", "x"]]).encode(), {}
        return 200, b"[]", {}
    with tempfile.TemporaryDirectory() as d:
        doc = coverage(out=d, fetch=Fetcher(min_gap=0, retries=0, opener=op2, sleep=lambda s: None), log=lambda *a: None)
        ck("coverage: one barn, two copies in one week, older copies left out", doc["weeks"] == {"2025-01-06": {"barns": 1, "states": 1}}, doc["weeks"])
        ck("coverage: every single-barn report asked, saved, not partial", doc["slugs"] > 100 and not doc["partial"]
           and os.path.exists(os.path.join(d, "coverage.json")))
        t = [0]
        doc = coverage(out=d, fetch=Fetcher(min_gap=0, retries=0, opener=op2, sleep=lambda s: None), log=lambda *a: None,
                       minutes=1, clock=lambda: t.__setitem__(0, t[0] + 30) or t[0])
        ck("coverage: stops at the time limit and keeps what it listed", 0 < doc["slugs"] < 10, doc["slugs"])
    print("probe_feeder_archive selftest: %d failure(s)" % len(fails))
    return 1 if fails else 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="probe_feeder_archive.py")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--coverage", action="store_true")
    ap.add_argument("--slugs", default=",".join(DEFAULT_SLUGS))
    ap.add_argument("--max-minutes", type=float, default=0)
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    if a.coverage:
        coverage(out=a.out, minutes=a.max_minutes)
        return 0
    if not a.probe:
        print("nothing to do: --probe, --coverage or --selftest")
        return 2
    slugs = [s for s in re.split(r"[,\s]+", a.slugs) if re.fullmatch(r"\d{3,5}", s)]
    probe(slugs, out=a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
