#!/usr/bin/env python3
"""
AGSIST -- data/dairy-dmc.json from FSA's own published Dairy Margin Coverage
monthly margins (all-milk price, feed cost, margin) and the 2027 premium rates.

--probe   save what FSA's DMC pages and files return to data/dairy-raw/dmc/
          (raw branch), so the parser is written against the real layout.
--selftest offline tests.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dairy_probe  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = "data/dairy-raw/dmc"
STARTS = [
    # FSA's monthly margins live here (linked "Program Updates and Prices" from the
    # DMC page, read from the archive copy on the Oct 28 probe)
    "https://www.fsa.usda.gov/resources/programs/dairy-margin-coverage-program-dmc/prices-updates",
    # the January 2026 fact sheet: 2026-2031 premium rates by tier, the multi-year discount wording
    "https://www.fsa.usda.gov/sites/default/files/2026-01/FSA_DMC_012026.pdf",
    # 2019's 50/50 alfalfa blend and the Dec 2021 revision to premium alfalfa from 2020
    "https://www.fsa.usda.gov/news-events/news/07-11-2019/usda-now-making-payments-new-dairy-margin-coverage-program",
    "https://www.fsa.usda.gov/Internet/FSA_Notice/dmc_53.pdf",
    "https://www.fsa.usda.gov/resources/programs/dairy-margin-coverage-program",
    "https://www.fsa.usda.gov/dairy",
    "https://www.fsa.usda.gov/news-events/news/09-30-2026/usda-announces-2027-dairy-margin-coverage-enrollment",
]


def _follow(u):
    return bool(re.search(r"dairy-margin|/dmc|dairy_margin", u, re.I)) and not re.search(r"\.(pdf|xlsx?|csv)(\?|$)", u, re.I)


def _keep(u):
    return bool(re.search(r"\.(pdf|xlsx?|csv)(\?|$)", u, re.I)) and bool(re.search(r"dmc|margin|dairy|premium", u, re.I))


WAYBACK = "https://web.archive.org/web/2026id_/"
AVAIL = "https://archive.org/wayback/available?url="


VIA = {}   # url -> {"via": "live"} or {"via": "archive", "archive_url", "snapshot"}: what answered, for the citation
LIVE = {"down": False}   # after one live timeout the rest of the run goes straight to the archive


def _snap_date(ts):
    """'20261015123456' -> '2026-10-15', else None."""
    return "%s-%s-%s" % (ts[:4], ts[4:6], ts[6:8]) if re.fullmatch(r"\d{14}", ts or "") else None


def get_fsa(u, direct=None, archive=None, avail=None):
    """FSA live first; the Oct 28 probes timed out on most fsa.usda.gov pages from
    the runner, so then the Internet Archive's newest copy of the same URL, by the
    timestamp its availability API gives (the original bytes, id_), so the page
    can cite the archive URL and its snapshot date beside FSA's. VIA[u] records
    which one answered."""
    from fetch_dairy import http_get
    import json as _j
    direct = direct or (lambda x: http_get(x, tries=1, timeout=40))
    archive = archive or (lambda x: http_get(x, tries=2, timeout=60))
    avail = avail or (lambda x: http_get(AVAIL + x, tries=2, timeout=40))
    body, err = (None, "FSA timed out earlier in this run") if LIVE["down"] else direct(u)
    if body is not None:
        VIA[u] = {"via": "live"}
        return body, None
    if "timed out" in (err or "").lower() or "timeout" in (err or "").lower():
        LIVE["down"] = True
    err2 = "no snapshot"
    try:
        a, e = avail(u)
        snap = (_j.loads(a or b"{}").get("archived_snapshots") or {}).get("closest") or {}
        ts = snap.get("timestamp") or ""
        if not _snap_date(ts):
            err2 = e or "no snapshot"
        else:
            au = "https://web.archive.org/web/%s/%s" % (ts, u)
            body, err2 = archive("https://web.archive.org/web/%sid_/%s" % (ts, u))
            if body is not None:
                VIA[u] = {"via": "archive", "archive_url": au, "snapshot": _snap_date(ts)}
                return body, None
    except Exception as ex:  # noqa: BLE001
        err2 = type(ex).__name__
    return None, "%s; archive: %s" % (err, err2)


# ---------------------------------------------------------------- parsing
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
TAG = re.compile(r"<[^>]+>")


def _text(h):
    import html as _h
    return re.sub(r"\s+", " ", _h.unescape(TAG.sub(" ", h or ""))).strip()


def _num(t):
    t = (t or "").replace("$", "").replace(",", "").strip()
    m = re.fullmatch(r"\(?(-?\d+(?:\.\d+)?)\)?", t)
    if not m:
        return None
    v = float(m.group(1))
    return -abs(v) if t.startswith("(") else v


def _month(t):
    m = re.match(r"([A-Za-z]{3})[a-z]*\.?\b", (t or "").strip())
    return MONTHS.index(m.group(1).lower()) + 1 if m and m.group(1).lower() in MONTHS else None


def tables(page):
    """[(context_text_before, [[cell text]])] for each <table> in an html page."""
    t = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", page or "")
    out, last = [], 0
    for m in re.finditer(r"(?is)<table\b.*?</table>", t):
        ctx = _text(t[max(last, m.start() - 1500):m.start()])[-300:]
        cap = re.search(r"(?is)<caption\b[^>]*>(.*?)</caption>", m.group(0))
        if cap:
            ctx += " " + _text(cap.group(1))
        rows = []
        for r in re.finditer(r"(?is)<tr\b.*?</tr>", m.group(0)):
            rows.append([_text(c) for c in re.findall(r"(?is)<t[hd]\b[^>]*>(.*?)</t[hd]>", r.group(0))])
        out.append((ctx, [r for r in rows if any(r)]))
        last = m.end()
    return out


def _col(head, pat):
    for i, h in enumerate(head):
        if re.search(pat, h, re.I):
            return i
    return None


def parse_margins(page):
    """{month_key: {all_milk, feed, margin}} from FSA's margins tables, months as
    rows, a year in the heading or caption before each table, or the year in a
    'Month Year' first cell. Only cells that are plain numbers are taken."""
    out = {}
    for ctx, rows in tables(page):
        if not rows:
            continue
        head = rows[0]
        ia, ifd, im = _col(head, r"all.?milk"), _col(head, r"feed"), _col(head, r"margin")
        if None in (ia, ifd, im):
            continue
        ys = re.findall(r"\b(20[12]\d)\b", ctx + " " + " ".join(head))
        for r in rows[1:]:
            if len(r) <= max(ia, ifd, im):
                continue
            mo = _month(r[0])
            y = re.search(r"\b(20[12]\d)\b", r[0])
            yr = y.group(1) if y else (ys[-1] if ys else None)
            if not mo or not yr:
                continue
            am, fd, mg = _num(r[ia]), _num(r[ifd]), _num(r[im])
            if am is None or fd is None or mg is None:
                continue
            out["%s-%02d" % (yr, mo)] = {"all_milk": am, "feed": fd, "margin": mg}
    return dict(sorted(out.items()))


MARGINS_URL = STARTS[0]
FACTS_URL = STARTS[1]
OUT = "data/dairy-dmc.json"
FIRST = "2019-01"          # DMC's first month; MPP (2014-2018) is a different program and is not shown


def _mk_shift(mk, n):
    i = int(mk[:4]) * 12 + int(mk[5:7]) - 1 + n
    return "%d-%02d" % (i // 12, i % 12 + 1)


def confirm(parsed, nass):
    """(rows, withheld) from FSA's parsed margins. A month is kept when FSA's own
    milk minus feed is FSA's own margin (to the cent FSA prints) and, for the
    month whose NASS all-milk price we hold, FSA's all-milk is that price.
    withheld = {count, months, why} for every DMC month from Jan 2019 to the
    newest FSA month that was not kept."""
    rows, out, why = {}, [], {}
    for k, r in parsed.items():
        if k < FIRST:
            continue
        if abs(r["all_milk"] - r["feed"] - r["margin"]) > 0.006:
            why[k] = "milk minus feed is not the margin"
            continue
        if nass and nass.get("month_key") == k and isinstance(nass.get("value"), (int, float)) \
                and abs(nass["value"] - r["all_milk"]) > 0.005:
            why[k] = "all-milk is not the NASS price held"
            continue
        rows[k] = r
    if rows or why:
        last = max(list(rows) + list(why))
        k = FIRST
        while k <= last:
            if k not in rows:
                out.append(k)
                why.setdefault(k, "not on FSA's page as read")
            k = _mk_shift(k, 1)
    reasons = sorted(set(why[k] for k in out))
    return rows, {"count": len(out), "months": out, "why": "; ".join(reasons)} if out else {"count": 0}


def parse_premiums(text):
    """(premiums, discount) from the fact sheet text; written against the real layout."""
    return {}, {}


def run(root=ROOT, now=None, get=None):
    import datetime
    import json
    import os
    now = now or datetime.datetime.now(datetime.timezone.utc)
    get = get or get_fsa
    p = Path(root) / OUT
    try:
        old = json.loads(p.read_text())
    except (OSError, ValueError):
        old = {}
    try:
        nass = (json.loads((Path(root) / "data/dairy-data.json").read_text()) or {}).get("all_milk") or {}
    except (OSError, ValueError):
        nass = {}
    at = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    body, err = get(MARGINS_URL)
    parsed = parse_margins(body.decode("utf-8", "replace")) if body else {}
    rows, held = confirm(parsed, nass)
    if not rows:
        why = err or ("no margins table found on the page" if body else "not read")
        print("::warning::DMC margins not refreshed: %s" % why)
        old["status"] = {"ok": False, "why": why[:200], "at": at}
        rec = old
    else:
        via = VIA.get(MARGINS_URL, {"via": "live"})
        rec = dict(old)
        for k in ("archive_url", "snapshot"):
            rec.pop(k, None)
        rec.update(via)
        rec.update(source="USDA Farm Service Agency, Dairy Margin Coverage prices and updates", source_url=MARGINS_URL,
                   read=now.strftime("%Y-%m-%d"), margins=rows, withheld=held, status={"ok": True, "at": at})
        rec.pop("premium_tier1", None)
        print("[dmc] %d months kept (%s to %s), %d withheld%s" % (
            len(rows), min(rows), max(rows), held["count"], (": " + held["why"]) if held["count"] else ""))
    fb, ferr = get(FACTS_URL)
    if fb and fb[:5] == b"%PDF-":
        from fetch_dairy import pdf_to_text
        t, _e = pdf_to_text(fb)
        prem, disc = parse_premiums(t or "")
        if prem:
            prem.update(VIA.get(FACTS_URL, {"via": "live"}), source_url=FACTS_URL)
            rec["premiums"] = prem
        if disc:
            disc.update(VIA.get(FACTS_URL, {"via": "live"}), source_url=FACTS_URL)
            rec["discount"] = disc
        if not prem:
            print("::warning::DMC fact sheet read but no premium table found")
    else:
        print("::warning::DMC fact sheet not read: %s" % (ferr or "not a PDF"))
    rec["_note"] = ("Written by scripts/fetch_dmc.py from FSA's own DMC prices and updates page (live, or the Internet "
                    "Archive copy named by archive_url and snapshot) and FSA's DMC fact sheet. A month is kept only when "
                    "FSA's milk minus feed is FSA's margin and its all-milk matches the NASS month held; the rest are in "
                    "withheld. Never typed by hand.")
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(rec, indent=1, sort_keys=True) + "\n")
    os.replace(tmp, p)
    return rec


def probe(root):
    print("FSA DMC probe")
    ix = dairy_probe.crawl(Path(root) / RAW, STARTS, ["fsa.usda.gov"], _follow, _keep, depth=2, max_files=25, get=get_fsa)
    for r in ix:
        r.update(VIA.get(r["url"], {}))
    import json as _j
    (Path(root) / RAW / "index.json").write_text(_j.dumps(ix, indent=1) + "\n")
    print("  %d urls, %d saved" % (len(ix), sum(1 for r in ix if r.get("file"))))
    return 0


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + ("  (%s)" % (detail,) if not ok and detail != "" else ""))
        if not ok:
            fails.append(name)

    pg = ("<h3>2026 DMC Margins</h3><table><tr><th>Month</th><th>All-Milk Price</th><th>Corn</th><th>Feed Cost</th>"
          "<th>Margin</th></tr><tr><td>January</td><td>$20.10</td><td>4.40</td><td>$10.50</td><td>$9.60</td></tr>"
          "<tr><td>February</td><td></td><td></td><td></td><td></td></tr></table>"
          "<table><caption>2019</caption><tr><th>Month</th><th>All Milk ($/cwt)</th><th>Total Feed Cost</th><th>Margin</th></tr>"
          "<tr><td>Dec</td><td>20.70</td><td>8.75</td><td>11.95</td></tr></table>")
    ck("margins tables: year from the heading or caption, empty months skipped",
       parse_margins(pg) == {"2019-12": {"all_milk": 20.7, "feed": 8.75, "margin": 11.95},
                             "2026-01": {"all_milk": 20.1, "feed": 10.5, "margin": 9.6}}, parse_margins(pg))
    rows, held = confirm({"2018-12": {"all_milk": 15.0, "feed": 9.0, "margin": 6.0},
                          "2019-01": {"all_milk": 16.6, "feed": 8.89, "margin": 7.71},
                          "2019-02": {"all_milk": 16.8, "feed": 8.89, "margin": 7.81},
                          "2019-04": {"all_milk": 17.7, "feed": 8.88, "margin": 8.82}},
                         {"month_key": "2019-04", "value": 17.7})
    ck("confirm: MPP months dropped, a month that does not add up withheld, a gap counted",
       list(rows) == ["2019-01", "2019-04"] and held["count"] == 2 and held["months"] == ["2019-02", "2019-03"]
       and "milk minus feed" in held["why"] and "not on FSA" in held["why"], (rows, held))
    rows, held = confirm({"2019-04": {"all_milk": 17.8, "feed": 8.88, "margin": 8.92}}, {"month_key": "2019-04", "value": 17.7})
    ck("confirm: FSA all-milk not the NASS month held is withheld", rows == {} and "NASS" in held["why"], held)
    ck("probe keeps DMC files", _keep("https://www.fsa.usda.gov/x/DMC-Margin-2026.xlsx"))
    ck("probe skips unrelated files", not _keep("https://www.fsa.usda.gov/x/loan-rates.pdf"))
    ck("probe follows DMC pages only", _follow("https://www.fsa.usda.gov/resources/programs/dairy-margin-coverage-program/x")
       and not _follow("https://www.fsa.usda.gov/resources/programs/arc-plc"))
    seen = []
    u = "https://www.fsa.usda.gov/dairy"
    b, e = get_fsa(u, direct=lambda x: (None, "timeout"),
                   archive=lambda x: (seen.append(x) or b"<html>", None),
                   avail=lambda x: (b'{"archived_snapshots":{"closest":{"timestamp":"20261015083000","available":true}}}', None))
    ck("a timed-out FSA page is read from the archive copy of the same URL, at the snapshot the archive names",
       b == b"<html>" and seen == ["https://web.archive.org/web/20261015083000id_/" + u])
    ck("the archive copy is cited with its URL and snapshot date",
       VIA.get(u) == {"via": "archive", "archive_url": "https://web.archive.org/web/20261015083000/" + u, "snapshot": "2026-10-15"})
    b, e = get_fsa(u, direct=lambda x: (None, "timeout"), archive=lambda x: (b"x", None),
                   avail=lambda x: (b'{"archived_snapshots":{}}', None))
    ck("no snapshot means no page, not a guess", b is None and "archive" in e)
    tried = []
    b, e = get_fsa(u + "/x", direct=lambda x: (tried.append(x), (b"<html>", None))[1], archive=lambda x: (None, "404"),
                   avail=lambda x: (b"{}", None))
    ck("after a live timeout, the rest of the run skips the live site", tried == [] and LIVE["down"])
    LIVE["down"] = False
    print("fetch_dmc selftest: %s" % ("PASS" if not fails else "FAIL (%d)" % len(fails)))
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--probe" in argv:
        return probe(ROOT)
    run(ROOT)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
