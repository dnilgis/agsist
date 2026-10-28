#!/usr/bin/env python3
"""Temporary probe for fx/dairy3 (removed before the PR), run 3: every Internet
Archive copy of FSA's MPP calculations PDF (mpp_prices.pdf), so Aug 2015 to Dec
2018 can be read from FSA's own file. Identifies itself honestly (same
User-Agent as scripts/fetch_dairy.py), one request at a time with a pause.
Writes only to out/."""
import json
import re
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path("out")
OUT.mkdir(exist_ok=True)
UA = "agsist.com dairy feed (contact: sig@agsist.com)"
LOG = []


def get(u, timeout=90, tries=3):
    last = None
    for _ in range(tries):
        try:
            req = urllib.request.Request(u, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read(), None
        except Exception as e:  # noqa: BLE001
            last = "%s: %s" % (type(e).__name__, str(e)[:200])
            time.sleep(8)
    return None, last


def save(name, u, timeout=90):
    b, e = get(u, timeout)
    time.sleep(2)
    LOG.append({"name": name, "url": u, "ok": b is not None, "bytes": len(b) if b else 0, "err": e})
    print(name, ("ok %d" % len(b)) if b else ("FAIL %s" % e), flush=True)
    if b is None:
        return None
    p = OUT / name
    p.write_bytes(b)
    if b[:5] == b"%PDF-":
        subprocess.run(["pdftotext", "-layout", str(p), str(p) + ".txt"], timeout=120)
    return b


for nm, u in (("mppA", "fsa.usda.gov/Assets/USDA-FSA-Public/usdafiles/MPP-Dairy/mpp_prices.pdf"),
              ("mppB", "fsa.usda.gov/Assets/USDA-FSA-Public/usdafiles/MPP-Dairy/MPP-Dairy.pdf"),
              ("mppC", "fsa.usda.gov/Assets/USDA-FSA-Public/usdafiles/MPP-Dairy/mpp-prices.pdf"),
              ("mppD", "fsa.usda.gov/sites/default/files/documents/mpp-prices.pdf")):
    q = "https://web.archive.org/cdx/search/cdx?" + urllib.parse.urlencode(
        {"url": u, "output": "json", "filter": "statuscode:200"})
    b = save("cdx-%s.json" % nm, q, 120)
    try:
        rows = json.loads(b or b"[]")[1:]
    except ValueError:
        rows = []
    print(nm, [x[1] for x in rows], flush=True)
    # newest copy, plus the last copy of each year (each holds the months to its date)
    by_year = {}
    for x in rows:
        by_year[x[1][:4]] = x
    pick = {x[1]: x for x in list(by_year.values()) + rows[-1:]}
    for ts, x in sorted(pick.items()):
        ext = "pdf" if re.search(r"(?i)\.pdf", x[2]) else "bin"
        save("arch-%s-%s.%s" % (nm, ts, ext), "https://web.archive.org/web/%sid_/%s" % (ts, x[2]), 120)
(OUT / "log.json").write_text(json.dumps(LOG, indent=1))
