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
    "https://www.fsa.usda.gov/resources/programs/dairy-margin-coverage-program",
    "https://www.fsa.usda.gov/dairy",
    "https://www.fsa.usda.gov/news-events/news/09-30-2026/usda-announces-2027-dairy-margin-coverage-enrollment",
]


def _follow(u):
    return bool(re.search(r"dairy-margin|/dmc|dairy_margin", u, re.I)) and not re.search(r"\.(pdf|xlsx?|csv)(\?|$)", u, re.I)


def _keep(u):
    return bool(re.search(r"\.(pdf|xlsx?|csv)(\?|$)", u, re.I)) and bool(re.search(r"dmc|margin|dairy|premium", u, re.I))


WAYBACK = "https://web.archive.org/web/2026id_/"


def get_fsa(u, direct=None, archive=None):
    """FSA live first; the Oct 28 probe timed out on every fsa.usda.gov page from
    the runner, so then the Internet Archive's newest 2026 copy of the same URL
    (the original bytes, id_). The probe index says which one answered."""
    from fetch_dairy import http_get
    direct = direct or (lambda x: http_get(x, tries=2, timeout=45))
    archive = archive or (lambda x: http_get(WAYBACK + x, tries=2, timeout=60))
    body, err = direct(u)
    if body is not None:
        return body, None
    body, err2 = archive(u)
    return (body, None) if body is not None else (None, "%s; archive: %s" % (err, err2))


def probe(root):
    print("FSA DMC probe")
    ix = dairy_probe.crawl(Path(root) / RAW, STARTS, ["fsa.usda.gov"], _follow, _keep, depth=2, max_files=25, get=get_fsa)
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
    b, e = get_fsa("https://www.fsa.usda.gov/dairy", direct=lambda u: (None, "timeout"),
                   archive=lambda u: (seen.append(u) or b"<html>", None))
    ck("a timed-out FSA page is read from the archive copy of the same URL", b == b"<html>" and seen == ["https://www.fsa.usda.gov/dairy"])
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
