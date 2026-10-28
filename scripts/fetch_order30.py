#!/usr/bin/env python3
"""
AGSIST -- data/dairy-order30.json: Upper Midwest Federal Order 30 monthly
prices (Class I at the order's base zone, advanced prices, statistical uniform
price, producer price differential, somatic cell adjustment rate) from the
Order 30 market administrator and USDA AMS.

--probe   save what the market administrator's site and AMS return to
          data/dairy-raw/order30/ (raw branch), so the parser is written
          against the real layout.
--selftest offline tests.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dairy_probe  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = "data/dairy-raw/order30"
STARTS = [
    "https://www.fmma30.com/",
    "https://www.ams.usda.gov/mnreports/dymadvancedprices.pdf",
    "https://www.ams.usda.gov/mnreports/dymadvprices.pdf",
    "https://www.ams.usda.gov/rules-regulations/moa/dairy/prices",
    "https://www.ams.usda.gov/resources/marketing-order-statistics",
    "https://www.fmmacentral.com/PDFdata/cp2610.pdf",
]
FILE = re.compile(r"\.(pdf|xlsx?|csv|txt)(\?|$)", re.I)
WORDS = re.compile(r"price|pool|announce|uniform|ppd|differential|statistic|class|advance|component|somatic|market.?admin|dairy", re.I)


def _follow(u):
    return not FILE.search(u) and bool(WORDS.search(u) or re.search(r"fmma30\.com/?$", u, re.I))


def _keep(u):
    return bool(FILE.search(u)) and bool(WORDS.search(u) or "fmma30" in u.lower())


def probe(root):
    print("Order 30 probe")
    ix = dairy_probe.crawl(Path(root) / RAW, STARTS, ["fmma30.com", "ams.usda.gov", "fmmacentral.com"], _follow, _keep,
                           depth=2, max_files=45)
    print("  %d urls, %d saved" % (len(ix), sum(1 for r in ix if r.get("file"))))
    return 0


def selftest():
    fails = []

    def ck(name, ok):
        print(("  ok   " if ok else "  FAIL ") + name)
        if not ok:
            fails.append(name)

    ck("probe keeps price files", _keep("https://www.fmma30.com/PDF/uniform_2609.pdf"))
    ck("probe follows pool pages", _follow("https://www.fmma30.com/Pool_Statistics.htm"))
    print("fetch_order30 selftest: %s" % ("PASS" if not fails else "FAIL (%d)" % len(fails)))
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--probe" in argv:
        return probe(ROOT)
    print("[order30] parser not written yet; run --probe")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
