#!/usr/bin/env python3
"""Temporary probe for fx/dairy3 (removed before the PR): saves what FSA, the
Internet Archive and NASS return, so the parsers are written against real files.
Identifies itself honestly (same User-Agent as scripts/fetch_dairy.py), one
request at a time with a pause. Writes only to out/. Never prints the NASS key."""
import json
import os
import re
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path("out")
OUT.mkdir(exist_ok=True)
UA = "agsist.com dairy feed (contact: sig@agsist.com)"
KEY = os.environ.get("NASS_API_KEY", "")
LOG = []


def scrub(s):
    return s.replace(KEY, "***") if (KEY and s) else s


def get(u, timeout=60, tries=2):
    last = None
    for _ in range(tries):
        try:
            req = urllib.request.Request(u, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read(), None
        except Exception as e:  # noqa: BLE001
            last = "%s: %s" % (type(e).__name__, str(e)[:200])
            time.sleep(3)
    return None, last


def save(name, u, timeout=60):
    b, e = get(u, timeout)
    time.sleep(1)
    LOG.append({"name": name, "url": scrub(u), "ok": b is not None, "bytes": len(b) if b else 0, "err": scrub(e)})
    print(name, ("ok %d" % len(b)) if b else ("FAIL %s" % scrub(e)), flush=True)
    if b is None:
        return None
    if KEY:
        b = b.replace(KEY.encode(), b"***")
    p = OUT / name
    p.write_bytes(b)
    if b[:5] == b"%PDF-":
        subprocess.run(["pdftotext", "-layout", str(p), str(p) + ".txt"], timeout=120)
    return b


FSA = "https://www.fsa.usda.gov/resources/programs/dairy-margin-coverage-program-dmc/prices-updates"
MPP = "https://www.fsa.usda.gov/sites/default/files/documents/mpp-prices.pdf"
FACTS = "https://www.fsa.usda.gov/sites/default/files/2026-01/FSA_DMC_012026.pdf"

# 1. FSA live
save("fsa-live.html", FSA, 90)
save("mpp-live.pdf", MPP, 90)

# 2. archive: the snapshot list of the margins page, the MPP pdf and the fact sheet; the newest three of each
for nm, u in (("fsa", FSA), ("mpp", MPP), ("facts", FACTS)):
    q = "https://web.archive.org/cdx/search/cdx?" + urllib.parse.urlencode(
        {"url": u, "output": "json", "filter": "statuscode:200", "from": "2015"})
    b = save("cdx-%s.json" % nm, q, 90)
    try:
        rows = json.loads(b or b"[]")[1:]
    except ValueError:
        rows = []
    ts = [x[1] for x in rows]
    print(nm, "snapshots:", ts[-12:], flush=True)
    for t in ts[-3:]:
        ext = "pdf" if u.endswith(".pdf") else "html"
        save("arch-%s-%s.%s" % (nm, t, ext), "https://web.archive.org/web/%sid_/%s" % (t, u), 90)

# 3. NASS Quick Stats: which licensed-herd series exist
if KEY:
    for c in ("MILK", "DAIRY", "CATTLE"):
        u = "https://quickstats.nass.usda.gov/api/get_param_values/?" + urllib.parse.urlencode(
            {"key": KEY, "param": "short_desc", "commodity_desc": c})
        b = save("qs-short-%s.json" % c, u, 180)
        vals = []
        if b:
            try:
                js = json.loads(b)
                vals = js.get("short_desc") or js.get(" short_desc") or []
            except ValueError:
                vals = []
        hits = [v for v in vals if "LICENS" in v.upper()]
        print(c, "licensed series:", hits, flush=True)
        for v in hits:
            for agg in ("NATIONAL", "STATE"):
                uu = "https://quickstats.nass.usda.gov/api/api_GET/?" + urllib.parse.urlencode(
                    {"key": KEY, "short_desc": v, "agg_level_desc": agg, "year__GE": "2000", "format": "JSON"})
                save("qs-%s-%s.json" % (re.sub(r"[^A-Za-z0-9]+", "_", v)[:60], agg), uu, 240)
else:
    print("no NASS key")

# 4. NASS Milk Production annual PDFs and the Wisconsin herd reports
pdfs = [ln.strip() for ln in open(".github/dairy3-probe/pdfs.txt") if ln.strip()]
for i, u in enumerate(pdfs):
    save("pdf-%02d-%s" % (i, u.rsplit("/", 1)[-1]), u, 120)
for u in ("https://esmis.nal.usda.gov/publication/milk-production",
          "https://www.nass.usda.gov/Statistics_by_State/Wisconsin/Publications/Dairy/"):
    save("idx-" + re.sub(r"[^A-Za-z0-9]+", "_", u)[-60:] + ".html", u, 90)
(OUT / "log.json").write_text(json.dumps(LOG, indent=1))
