"""Wisconsin real estate transfer return (RETR) files, read through DOR's public My Tax Account pages.

Wisconsin DOR's data page (revenue.wi.gov/Pages/ERETR/data-home.aspx) is a My Tax Account app
that needs a browser running its scripts; the monthly historical RETR files sit behind its
"Download historical RETR data" screen with no plain link. This opens that public screen in one
headless Chromium session (no sign-in), the way a person would, and saves what it finds.

  python3 scripts/wi_retr_browser.py --fetch OUTDIR [--months N] [--newest-only]
        --newest-only: just the months data/land/wi does not hold yet, plus the newest month it
        holds again (DOR keeps adding late returns to it); build with
        `scripts/fetch_land_sales.py --from OUTDIR/build WI --merge`.
        every month the screen offers (newest first; at most N, or 120), in DOR's XML report,
        which lists every parcel, grantor and grantee on a return. Each file is read as it
        arrives and deleted; the farm and forest returns go to OUTDIR/build/wi-retr.csv for
        `scripts/fetch_land_sales.py --from OUTDIR/build WI`. The three newest months are also
        fetched as CSV, only to name the municipality codes the XML gives.
  python3 scripts/wi_retr_browser.py --convert OUTDIR FILE...
        the same conversion from XML (.xml or .xml.gz) and CSV reports already on disk.
  python3 scripts/wi_retr_browser.py --explore OUTDIR
        robots.txt, then the data page and the historical screen: a screenshot, the page HTML
        (scripts removed), every link and button, and every request the app makes.

The flow (Oct 2026): revenue.wi.gov/Pages/ERETR/data-home.aspx redirects to
tap.revenue.wi.gov/RETRHistoric (My Tax Account); a disclaimer with Agree / Disagree; Agree
opens "Real Estate Historical Data": a CSV Report / XML Report choice, then one link per month
for the last five years. A month link posts a FAST app event and the file comes back from a
session-bound Retrieve URL, so a plain fetch cannot ask for it; the browser does.

Polite by design: one browser session, one request at a time, a pause between files, and a
User-Agent that names agsist.com. It stops if robots.txt disallows the pages.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 AGSIST-land-data/1.0 (agsist.com; sig@agsist.com)"
HOME = "https://www.revenue.wi.gov/Pages/ERETR/data-home.aspx"
# data-home.aspx only redirects here; used when www.revenue.wi.gov does not answer
TAP = "https://tap.revenue.wi.gov/RETRHistoric"
PAUSE = 4.0          # seconds between page actions
FILE_PAUSE = 10.0    # seconds between monthly files
CSV_MONTHS = 3       # newest months also fetched as CSV, to name the municipality codes


def strip(html):
    html = re.sub(r"(?is)<script\b.*?</script>", "", html)
    html = re.sub(r"(?is)<style\b.*?</style>", "", html)
    return re.sub(r"\b(AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[0-9A-Za-z]{20,}|AKIA[0-9A-Z]{16})", "[key removed]", html)


def robots_allows(txt, path, agent="*"):
    """True unless a Disallow rule for our agent (or *) covers path. Plain prefix rules, as
    robots.txt files on state sites use them; '*' and '$' are honored."""
    groups, cur, last_was_agent = [], None, False
    for raw in txt.splitlines():
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        k, v = [x.strip() for x in line.split(":", 1)]
        k = k.lower()
        if k == "user-agent":
            if not last_was_agent:
                cur = {"agents": [], "rules": []}
                groups.append(cur)
            cur["agents"].append(v.lower())
            last_was_agent = True
            continue
        last_was_agent = False
        if cur is not None and k in ("allow", "disallow"):
            cur["rules"].append((k, v))
    mine = [g for g in groups if any(a != "*" and a in agent.lower() for a in g["agents"])] or [g for g in groups if "*" in g["agents"]]
    best = None
    for g in mine:
        for k, v in g["rules"]:
            if not v:
                continue
            rx = "^" + re.escape(v).replace(r"\*", ".*").replace(r"\$", "$")
            if re.match(rx, path, re.I) and (best is None or len(v) > len(best[1])):
                best = (k, v)
    return best is None or best[0] == "allow"


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError:
            raise
        except Exception:  # noqa: BLE001
            if i == tries - 1:
                raise
            time.sleep(20 * (i + 1))


def open_home(page, log):
    """The historical screen's start, by DOR's link or, when www does not answer, the app link it redirects to."""
    for url, tries in ((HOME, 2), (TAP, 3)):
        try:
            return goto(page, url, log, tries)
        except Exception:  # noqa: BLE001
            if url == TAP:
                raise


def goto(page, url, log, tries=3):
    """The DOR server sometimes does not answer for a minute or two: wait and try again."""
    for i in range(tries):
        try:
            return page.goto(url, wait_until="domcontentloaded", timeout=90000)
        except Exception as e:  # noqa: BLE001
            log.append("goto %s try %d: %s" % (url, i + 1, str(e).splitlines()[0][:200]))
            if i == tries - 1:
                raise
            time.sleep(30 * (i + 1))


def note(title, text, chunk=6000, most=4):
    for i in range(0, min(len(text), chunk * most), chunk):
        print("::notice title=%s %d::%s" % (title, i // chunk + 1, text[i:i + chunk].replace("%", "%25").replace("\r", "").replace("\n", "%0A")))


def lands():
    import importlib.util
    spec = importlib.util.spec_from_file_location("fetch_land_sales", os.path.join(os.path.dirname(os.path.abspath(__file__)), "fetch_land_sales.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class Collector:
    """Reads each monthly report as it arrives and keeps only what the build needs."""

    def __init__(self):
        self.L = lands()
        self.farm = []          # farm and forest returns (dicts from wi_returns)
        self.munis = {}         # (county code, muni code) -> name
        self.months = []        # (yyyymm, returns, farm returns)
        self.index = {}         # yyyymm -> {(doc, first pin): (cc, muni)} for months with a CSV

    def xml(self, path, ym, want_index=False):
        import gzip
        fh = gzip.open(path, "rb") if path.endswith(".gz") else open(path, "rb")
        n = f = 0
        idx = {} if want_index else None
        with fh:
            for r in self.L.wi_returns(fh):
                n += 1
                if idx is not None and r["parcels"]:
                    idx[(r["doc"], r["parcels"][0]["pin"])] = (r["cc"], r["parcels"][0]["muni"])
                if any(p["use"] in self.L.WI_FARM_USE for p in r["parcels"]):
                    f += 1
                    self.farm.append(r)
        if idx is not None:
            self.index[ym] = idx
        self.months.append((ym, n, f))
        return n, f

    def csv(self, path, ym):
        got = self.L.wi_learn_munis(open(path, "rb").read(), self.index.get(ym, {}))
        self.munis.update(got)
        return len(got)

    def write(self, out):
        import csv
        os.makedirs(os.path.join(out, "build"), exist_ok=True)
        fn = os.path.join(out, "build", "wi-retr.csv")
        rows = [self.L.wi_row(r, self.munis) for r in self.farm]
        rows = [r for r in rows if r]
        with open(fn, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(self.L.WI_HEAD)
            w.writerows(rows)
        named = sum(1 for r in rows if r[7])
        rep = {"months": [{"month": m, "returns": n, "farm": k} for m, n, k in sorted(self.months)], "farm_rows": len(rows),
               "with_town": named, "muni_codes_named": len(self.munis)}
        open(os.path.join(out, "build", "wi-retr-report.json"), "w").write(json.dumps(rep, indent=1))
        return fn, rep


def convert(out, files):
    c = Collector()
    xs = sorted(f for f in files if re.search(r"\.xml(\.gz)?$", f))
    cs = [f for f in files if f.endswith(".csv")]
    csv_months = {re.search(r"(\d{6})", os.path.basename(f)).group(1) for f in cs}
    for f in xs:
        ym = re.search(r"(\d{6})", os.path.basename(f)).group(1)
        c.xml(f, ym, ym in csv_months)
    for f in cs:
        c.csv(f, re.search(r"(\d{6})", os.path.basename(f)).group(1))
    fn, rep = c.write(out)
    print(json.dumps(rep)[:3000])
    return 0


MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def month_links(page):
    """Every month link on the historical screen with the year it sits under; on = a file is offered."""
    got = page.evaluate("""() => {
        const out = []; let year = null;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        while (walker.nextNode()) {
            const e = walker.currentNode;
            const t = (e.innerText || '').trim();
            if (e.children.length === 0 && /^20\\d\\d$/.test(t)) year = +t;
            if (e.tagName === 'A' && e.id && e.id.startsWith('cl_') && year) out.push({id: e.id, year: year, name: t, on: !!e.getAttribute('href')});
        }
        return out; }""")
    out = []
    for g in got:
        if g["name"] in MONTHS:
            out.append({"id": g["id"], "year": g["year"], "month": MONTHS.index(g["name"]) + 1, "on": g["on"]})
    return out


def grab(page, loc, out, tag, log, wait=180000):
    """Click loc and keep the file it hands back; None when it opens no download."""
    try:
        with page.expect_download(timeout=wait) as dl:
            loc.click()
        d = dl.value
        fn = os.path.join(out, tag + "-" + re.sub(r"[^A-Za-z0-9._-]", "_", d.suggested_filename))
        d.save_as(fn)
        log.append("%s: download %s (%d bytes) url %s" % (tag, d.suggested_filename, os.path.getsize(fn), d.url[:200]))
        return fn
    except Exception as e:  # noqa: BLE001
        log.append("%s: no download: %s" % (tag, str(e).splitlines()[0][:200]))
        return None


def xml_shape(fn, log):
    """Tag paths with counts, and how many children of each repeating kind a return has."""
    import collections
    import xml.etree.ElementTree as ET
    paths, depth, stack = collections.Counter(), 0, []
    per = collections.defaultdict(collections.Counter)
    kids = None
    for ev, el in ET.iterparse(fn, events=("start", "end")):
        tag = el.tag.split("}")[-1]
        if ev == "start":
            stack.append(tag)
            if len(stack) <= 6:
                paths["/".join(stack)] += 1
            if len(stack) == 2:
                kids = collections.Counter()
            elif len(stack) == 3 and kids is not None:
                kids[tag] += 1
        else:
            if len(stack) == 2 and kids is not None:
                for k, v in kids.items():
                    per[k][min(v, 10)] += 1
                el.clear()
            stack.pop()
    log.append("xml paths: " + "; ".join("%s=%d" % kv for kv in paths.most_common(140)))
    for k, c in sorted(per.items()):
        log.append("children per return, %s: %s" % (k, dict(sorted(c.items()))))


def pick_format(page, fmt):
    lab = page.locator("label[for=Dc-s_%d]" % (0 if fmt == "CSV" else 1))
    if not lab.count():
        lab = page.locator("label").filter(has_text=re.compile(r"^\s*%s Report\s*$" % fmt))
    lab.first.click()
    time.sleep(PAUSE)


def start(page, log):
    """Open the historical screen past the disclaimer; the month links on it."""
    open_home(page, log)
    time.sleep(PAUSE)
    agree = page.locator("#Dc-b")
    if agree.count():
        agree.first.click()
        time.sleep(PAUSE)
    try:
        page.wait_for_load_state("networkidle", timeout=30000)
    except Exception:  # noqa: BLE001
        pass
    return month_links(page)


def newest_only(offered, have):
    """The months to read when data/land/wi already holds `have` (yyyymm strings): every offered
    month it lacks, plus the newest one it holds, read again. Newest first."""
    if not have:
        return list(offered)
    top = max(have)
    want = [m for m in offered if m not in have or m == top]
    return sorted(set(want), reverse=True)


def fetch(out, most=120, only_new=False):
    """Every offered month, newest first, through one browser session, one file at a time."""
    os.makedirs(out, exist_ok=True)
    raw = os.path.join(out, "raw")
    os.makedirs(raw, exist_ok=True)
    log = []
    try:
        rb = get("https://www.revenue.wi.gov/robots.txt")
        if not robots_allows(rb, "/Pages/ERETR/data-home.aspx", "AGSIST-land-data"):
            print("::error::robots.txt disallows the RETR data page; nothing fetched")
            return 2
    except urllib.error.HTTPError as e:
        log.append("robots.txt: %s (none)" % e)
    except Exception as e:  # noqa: BLE001
        log.append("robots.txt did not answer (%s); it allowed these pages when last read" % str(e)[:120])
    from playwright.sync_api import sync_playwright
    c = Collector()
    failed, csvs = [], []
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        ctx = br.new_context(user_agent=UA, accept_downloads=True, viewport={"width": 1280, "height": 1600})
        page = ctx.new_page()
        months = [m for m in start(page, log) if m["on"]]
        months.sort(key=lambda m: (m["year"], m["month"]), reverse=True)
        months = months[:most]
        if only_new:
            have = lands().held("WI")[2]
            keep = set(newest_only(["%04d%02d" % (m["year"], m["month"]) for m in months], have))
            log.append("newest only: %d months on disk (%s to %s); reading %s" % (len(have), min(have) if have else "-", max(have) if have else "-", ", ".join(sorted(keep)) or "none"))
            months = [m for m in months if "%04d%02d" % (m["year"], m["month"]) in keep]
        log.append("months offered: %d, %04d-%02d to %04d-%02d" % (len(months), months[-1]["year"], months[-1]["month"], months[0]["year"], months[0]["month"]) if months else "no months offered")
        if not months:
            print("::error::the historical screen offered no month")
            br.close()
            return 1
        want_csv = {"%04d%02d" % (m["year"], m["month"]) for m in months[:CSV_MONTHS]}

        def get_month(m, fmt):
            """One file; on a miss, reopen the screen once (the session ends after 15 idle minutes)."""
            ym = "%04d%02d" % (m["year"], m["month"])
            tag = "%s-%s" % (fmt.lower(), ym)
            for attempt in (1, 2):
                if attempt == 2:
                    log.append("%s: reopening the screen" % tag)
                    fresh = {(x["year"], x["month"]): x for x in start(page, log)}
                    m = fresh.get((m["year"], m["month"]), m)
                    pick_format(page, fmt)
                fn = grab(page, page.locator("#" + m["id"]), raw, tag, log, wait=300000)
                if fn:
                    return fn
                time.sleep(FILE_PAUSE)
            return None
        pick_format(page, "CSV")
        for m in months[:CSV_MONTHS]:
            fn = get_month(m, "CSV")
            if fn:
                csvs.append((fn, "%04d%02d" % (m["year"], m["month"])))
            time.sleep(FILE_PAUSE)
        pick_format(page, "XML")
        for m in months:
            ym = "%04d%02d" % (m["year"], m["month"])
            fn = get_month(m, "XML")
            if not fn:
                failed.append(ym)
                continue
            try:
                n, f = c.xml(fn, ym, ym in want_csv)
                log.append("%s: %d returns, %d farm or forest (%.1f MB)" % (ym, n, f, os.path.getsize(fn) / 1048576))
            except Exception as e:  # noqa: BLE001
                failed.append(ym)
                log.append("%s: could not read: %s" % (ym, str(e)[:200]))
            os.remove(fn)
            print(log[-1], flush=True)
            time.sleep(FILE_PAUSE)
        br.close()
    for fn, ym in csvs:
        log.append("%s CSV: %d municipality codes named" % (ym, c.csv(fn, ym)))
        os.remove(fn)
    fn, rep = c.write(out)
    rep["failed_months"] = failed
    open(os.path.join(out, "build", "wi-retr-report.json"), "w").write(json.dumps(rep, indent=1))
    log.append("wrote %s: %d farm and forest returns from %d months; %d with a town named; %d municipality codes named; months not read: %s"
               % (fn, rep["farm_rows"], len(rep["months"]), rep["with_town"], rep["muni_codes_named"], ", ".join(failed) or "none"))
    open(os.path.join(out, "fetch-log.txt"), "w").write("\n".join(log) + "\n")
    print("\n".join(log))
    note("wi fetch", "\n".join(log[-80:]), most=3)
    if failed:
        print("::warning::Wisconsin months not read: %s" % ", ".join(failed))
    return 0 if rep["farm_rows"] else 1


def explore(out):
    """Every step logged; whatever fails, the log and the screens so far are kept."""
    import traceback
    os.makedirs(out, exist_ok=True)
    log = []
    try:
        rc = _explore(out, log)
    except Exception:  # noqa: BLE001
        log.append("ERROR " + traceback.format_exc()[-3000:])
        rc = 1
    open(os.path.join(out, "explore-log.txt"), "w").write("\n".join(log) + "\n")
    print("\n".join(log))
    note("wi explore", "\n".join(log), most=8)
    return rc


def _explore(out, log):
    try:
        rb = get("https://www.revenue.wi.gov/robots.txt")
    except Exception as e:  # noqa: BLE001
        rb = ""
        log.append("robots.txt: %s" % e)
    open(os.path.join(out, "robots.txt"), "w").write(rb)
    log.append("robots.txt (%d bytes): %s" % (len(rb), rb[:1500]))
    for p in ("/Pages/ERETR/data-home.aspx", "/SLFReportsHistSales/", "/"):
        log.append("robots allows %s: %s" % (p, robots_allows(rb, p, "AGSIST-land-data")))
    if not robots_allows(rb, "/Pages/ERETR/data-home.aspx", "AGSIST-land-data"):
        log.append("STOP: robots.txt disallows the data page")
        return 2
    from playwright.sync_api import sync_playwright
    reqs = []
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        ctx = br.new_context(user_agent=UA, accept_downloads=True, viewport={"width": 1280, "height": 1600})
        page = ctx.new_page()

        def on_req(r):
            if r.resource_type in ("image", "stylesheet", "font"):
                return
            reqs.append({"m": r.method, "url": r.url, "type": r.resource_type, "post": (r.post_data or "")[:3000]})

        def on_resp(r):
            for q in reversed(reqs):
                if q["url"] == r.url and "status" not in q:
                    q["status"] = r.status
                    q["ctype"] = r.headers.get("content-type", "")
                    q["disp"] = r.headers.get("content-disposition", "")
                    q["len"] = r.headers.get("content-length", "")
                    break
        page.on("request", on_req)
        page.on("response", on_resp)

        def snap(tag):
            time.sleep(PAUSE)
            try:
                page.wait_for_load_state("networkidle", timeout=30000)
            except Exception:  # noqa: BLE001
                pass
            page.screenshot(path=os.path.join(out, tag + ".png"), full_page=True)
            html = page.content()
            open(os.path.join(out, tag + ".html"), "w").write(strip(html))
            items = page.evaluate("""() => Array.from(document.querySelectorAll('a,button,input[type=button],input[type=submit],select,[role=button],[onclick]')).map(e => ({
                tag: e.tagName, id: e.id, text: (e.innerText || e.value || '').trim().slice(0, 120), href: e.getAttribute('href') || '',
                onclick: (e.getAttribute('onclick') || '').slice(0, 200), visible: !!(e.offsetWidth || e.offsetHeight),
                options: e.tagName === 'SELECT' ? Array.from(e.options).map(o => [o.value, o.text]).slice(0, 400) : undefined }))""")
            open(os.path.join(out, tag + "-items.json"), "w").write(json.dumps(items, indent=1))
            vis = [i for i in items if i["visible"]]
            log.append("[%s] url %s title %r; %d visible controls" % (tag, page.url, page.title(), len(vis)))
            for i in vis[:80]:
                log.append("   %s#%s %r href=%s onclick=%s%s" % (i["tag"], i["id"], i["text"][:80], i["href"][:150], i["onclick"][:80],
                                                         (" options=%s" % json.dumps(i["options"][:40])) if i.get("options") else ""))
            txt = re.sub(r"\s+", " ", page.inner_text("body"))
            log.append("   text: " + txt[:2500])
            return items

        open_home(page, log)
        snap("01-home")
        try:
            log.append("tap robots.txt: %r" % get("https://tap.revenue.wi.gov/robots.txt")[:800])
        except Exception as e:  # noqa: BLE001
            log.append("tap robots.txt: %s" % e)
        agree = page.locator("#Dc-b")
        if agree.count():
            log.append("clicking the disclaimer's Agree")
            agree.first.click()
        snap("02-after-agree")
        months = month_links(page)
        log.append("month links: %d enabled of %d; years %s" % (sum(1 for m in months if m["on"]), len(months), sorted({m["year"] for m in months})))
        on = [m for m in months if m["on"]]
        if on:
            m = on[0]
            log.append("newest offered month: %04d-%02d" % (m["year"], m["month"]))
            for fmt in ("XML",):
                page.locator("label[for=Dc-s_%d]" % (0 if fmt == "CSV" else 1)).click()
                time.sleep(PAUSE)
                fn = grab(page, page.locator("#" + m["id"]), out, "%s-%04d-%02d" % (fmt.lower(), m["year"], m["month"]), log)
                if fn and fmt == "XML":
                    xml_shape(fn, log)
                    import gzip
                    import shutil
                    with open(fn, "rb") as f, gzip.open(fn + ".gz", "wb", 9) as g:
                        shutil.copyfileobj(f, g)
                    os.remove(fn)
                elif fn:
                    os.remove(fn)
            # the XML schema screen last (it replaces the month list)
            grab(page, page.get_by_text("View XML Schema").first, out, "doc-xml", log, wait=20000)
            snap("05-doc-xml")
        br.close()
    open(os.path.join(out, "requests.json"), "w").write(json.dumps(reqs, indent=1))
    log.append("requests (%d):" % len(reqs))
    for q in [q for q in reqs if q["type"] != "script"][:150]:
        log.append("   %s %s %s %s %s %s post=%s" % (q["m"], q.get("status"), q["type"], q.get("ctype", "")[:40], q.get("disp", "")[:80], q["url"][:200], q["post"][:300]))
    return 0


def selftest():
    bad = 0

    def ck(name, ok):
        nonlocal bad
        print(("ok   " if ok else "FAIL ") + name)
        bad += 0 if ok else 1
    offered = ["202610", "202609", "202608", "202607"]
    ck("newest only: the new month plus the newest held, read again", newest_only(offered, {"202607", "202608", "202609"}) == ["202610", "202609"])
    ck("newest only: nothing new still rereads the newest held", newest_only(offered[1:], {"202607", "202608", "202609"}) == ["202609"])
    ck("newest only: a gap in the middle is filled", newest_only(offered, {"202607", "202609"}) == ["202610", "202609", "202608"])
    ck("newest only: nothing on file reads every offered month", newest_only(offered, set()) == offered)
    rb = "User-agent: *\nDisallow: /_layouts/\nDisallow: /Pages/Employment/Badge-Photo.aspx\n"
    ck("robots: DOR's rules allow the data page", robots_allows(rb, "/Pages/ERETR/data-home.aspx") and not robots_allows(rb, "/_layouts/x"))
    ck("robots: a disallow of everything stops the fetch", not robots_allows("User-agent: *\nDisallow: /\n", "/Pages/ERETR/data-home.aspx"))
    print("FAILS=%d" % bad)
    return 1 if bad else 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--selftest" in a:
        sys.exit(selftest())
    if "--fetch" in a:
        sys.exit(fetch(a[a.index("--fetch") + 1], int(a[a.index("--months") + 1]) if "--months" in a else 120, "--newest-only" in a))
    if "--convert" in a:
        i = a.index("--convert")
        sys.exit(convert(a[i + 1], a[i + 2:]))
    if "--explore" in a:
        sys.exit(explore(a[a.index("--explore") + 1]))
    print("usage: wi_retr_browser.py --explore OUTDIR")
    sys.exit(2)
