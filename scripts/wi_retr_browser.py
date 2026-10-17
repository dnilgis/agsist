"""Wisconsin real estate transfer return (RETR) files, read through DOR's public My Tax Account pages.

Wisconsin DOR's data page (revenue.wi.gov/Pages/ERETR/data-home.aspx) is a My Tax Account app
that needs a browser running its scripts; the monthly historical RETR files sit behind its
"Download historical RETR data" screen with no plain link. This opens that public screen in one
headless Chromium session (no sign-in), the way a person would, and saves what it finds.

  python3 scripts/wi_retr_browser.py --explore OUTDIR
        robots.txt, then the data page and the historical screen: a screenshot, the page HTML
        (scripts removed), every link and button, and every request the app makes, so the
        clicks and the file requests can be read before anything is downloaded in bulk.

Polite by design: one browser session, one request at a time, a pause between files, and a
User-Agent that names agsist.com. It stops if robots.txt disallows the pages.
"""
import json
import os
import re
import sys
import time
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 AGSIST-land-data/1.0 (agsist.com; sig@farmers1st.com)"
HOME = "https://www.revenue.wi.gov/Pages/ERETR/data-home.aspx"
PAUSE = 4.0          # seconds between page actions and between files


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


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", errors="replace")


def note(title, text, chunk=6000, most=4):
    for i in range(0, min(len(text), chunk * most), chunk):
        print("::notice title=%s %d::%s" % (title, i // chunk + 1, text[i:i + chunk].replace("%", "%25").replace("\r", "").replace("\n", "%0A")))


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

        page.goto(HOME, wait_until="domcontentloaded", timeout=90000)
        snap("01-home")
        hit = page.get_by_text(re.compile(r"historical\s+RETR", re.I))
        n = hit.count()
        log.append("historical links: %d" % n)
        if n:
            hit.first.click()
            snap("02-historical")
            # whatever the historical screen offers: say what a first file click asks for, without bulk download
            links = page.locator("a").filter(has_text=re.compile(r"\d{4}|\.zip|\.csv|download", re.I))
            log.append("file-like links on the historical screen: %d" % links.count())
            if links.count():
                try:
                    with page.expect_download(timeout=90000) as dl:
                        links.first.click()
                    d = dl.value
                    fn = os.path.join(out, "first-" + re.sub(r"[^A-Za-z0-9._-]", "_", d.suggested_filename))
                    d.save_as(fn)
                    log.append("first download: %s url %s bytes %d" % (d.suggested_filename, d.url, os.path.getsize(fn)))
                except Exception as e:  # noqa: BLE001
                    log.append("first link gave no download: %s" % e)
                    snap("03-after-first-link")
        br.close()
    open(os.path.join(out, "requests.json"), "w").write(json.dumps(reqs, indent=1))
    log.append("requests (%d):" % len(reqs))
    for q in reqs[:120]:
        log.append("   %s %s %s %s %s %s post=%s" % (q["m"], q.get("status"), q["type"], q.get("ctype", "")[:40], q.get("disp", "")[:80], q["url"][:200], q["post"][:300]))
    return 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--explore" in a:
        sys.exit(explore(a[a.index("--explore") + 1]))
    print("usage: wi_retr_browser.py --explore OUTDIR")
    sys.exit(2)
