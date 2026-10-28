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

    def ck(name, ok):
        print(("  ok   " if ok else "  FAIL ") + name)
        if not ok:
            fails.append(name)

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
    print("[dmc] parser not written yet; run --probe")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
