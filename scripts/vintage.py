#!/usr/bin/env python3
"""vintage.py -- a daily point-in-time copy of outside data, saved exactly as
published with the time we fetched it (Sig, Oct 28 2026, STANDING-DECISIONS).

WHY. A forecast test may only use what was knowable on each date. USDA, USGS
and EIA revise their numbers (provisional river readings, late inspection
certificates, corrected barge weeks), and nobody can rebuild what a page said
on a past day once it has changed. This keeps that record from now on.

WHERE. vintage/<source>/<YYYY-MM-DD>.json.gz in the runner, saved by
vintage.yml to the PRIVATE raw branch (dnilgis/feedbag) with scripts/push_raw.sh
and RAW_KEEP=1. Never main (/vintage/ is in .gitignore), never a page.
  vintage/manifest/<YYYY-MM-DD>.json   one line per source: ok or failed, HTTP
                                        status, rows, bytes, sha256 of the file
A day is written once. A file already there is left alone (here, and again at
the push: RAW_KEEP), so a second run the same day never replaces the first.

SOURCES (all public, no key)
  agtransport-<name>   USDA AMS AgTransport (Socrata): the dataset's metadata
                       (/api/views/<id>.json, which says when USDA last changed
                       it) and every row dated in the last 60 days, with
                       Socrata's own :id, :created_at and :updated_at, so a
                       revision shows from one day to the next. The date column
                       comes from the metadata, never assumed.
  usgs-river           USGS daily mean stage (00065) and flow (00060), last 30
                       days, for a short list of grain river gauges. The newer
                       api.waterdata.usgs.gov first, one gauge at a time; the older
                       WaterServices (one request for every gauge) when a gauge is left out.
  eia-ethanol          EIA weekly fuel ethanol production by PADD (table download)
  eia-diesel           EIA weekly on-highway diesel retail prices (table download)
                       Bytes kept as sent (base64), never opened here.
  settles-yahoo        the daily futures bars the site's prices are read from (last 10 sessions,
                       grains, oilseed products, cattle, hogs), so a restated settle shows
  settles-cme          CME's own settlement tables for the last weekday (corn, soybeans, wheat,
                       cattle, hogs); a refusal is recorded like any failure
  cot-cftc             CFTC Commitments of Traders: this week's disaggregated and legacy text
                       files as posted, and the newest rows of the disaggregated dataset
  ams-reports          USDA AMS Market News PDFs the site reads (grain, hay, fertilizer, cattle,
                       dairy), from www.ams.usda.gov or its mirror host (scripts/ams_http.py)
  The last four keep each document's bytes as sent (base64) with its own URL, status, fetch
  time and sha256; a source is ok when at least one document came back, and the ones that did
  not are named.

Each file: {schema, source, day, fetched_utc, finished_utc, ok, rows, error,
requests: [{url, status, fetched_utc, bytes, sha256, error}], meta?, data}.
sha256 is of each response body as received. A request that fails is recorded
with its status and error; it is tried at most three times (a short pause, then
a longer one), never in a loop. Polite: one request at a time, a pause between.
Logs are counts only.

    python3 scripts/vintage.py --selftest
    python3 scripts/vintage.py [--out vintage] [--only usgs-river,eia-diesel]
  (--day takes only today's UTC date: a past day cannot be fetched again)
"""
import argparse
import base64
import gzip
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from history_lib import UA  # noqa: E402
from released_at import socrata  # noqa: E402  when the rows were public

SCHEMA = "agsist-vintage/1"
OUT = "vintage"
SOCRATA = "https://agtransport.usda.gov"
SOCRATA_DAYS = 60
SOCRATA_PAGE = 50000
USGS_DAYS = 30
GAP = 3.0                       # seconds between requests to any host
PAUSES = (15, 60)               # retry pauses: three tries at most, then the failure is recorded

AGTRANSPORT = {
    "barge_rates": "deqi-uken",
    "railcar": "cvu8-kpyk",
    "inspections": "sruw-w49i",
    "lock_tons": "n4pw-9ygw",
    "grain_basis": "v85y-3hep",
    "car_orders": "57pa-stwn",
    "vessels": "uiht-9xts",
    "cost_index": "8uye-ieij",
}

# USGS site number -> what we expect it to be. The saved answer carries USGS's
# own site name; the run warns (by number only) when a gauge does not answer.
GAUGES = {
    "07010000": "Mississippi River at St. Louis, MO",
    "07020500": "Mississippi River at Chester, IL",
    "07032000": "Mississippi River at Memphis, TN",
    "05568500": "Illinois River at Kingston Mines, IL (below Peoria)",
    "05586100": "Illinois River at Valley City, IL",
    "03611500": "Ohio River at Metropolis, IL",
    "03612600": "Ohio River at Olmsted, IL",
    "06934500": "Missouri River at Hermann, MO",
}
USGS_PARAMS = "00060,00065"     # discharge, gage height; daily mean (00003)

EIA = {
    "eia-ethanol": ["https://www.eia.gov/dnav/pet/xls/PET_PNP_WPRODE_S1_W.xls",
                    "https://www.eia.gov/dnav/pet/hist_xls/W_EPOOXE_YOP_NUS_MBBLDw.xls"],
    "eia-diesel": ["https://www.eia.gov/dnav/pet/xls/PET_PRI_GND_DCUS_NUS_W.xls",
                   "https://www.eia.gov/dnav/pet/hist_xls/EMD_EPD2D_PTE_NUS_DPGw.xls"],
}
SHEET_MAGIC = (bytes.fromhex("D0CF11E0A1B11AE1"), b"PK\x03\x04")   # Excel 97 (OLE), xlsx (zip)

# Documents kept byte for byte: source -> [(label, kind, [urls, first answer that passes wins])].
# kind: json (parses), pdf (%PDF- magic), text (not a web page). {td} is the last weekday before the
# day as MM/DD/YYYY (CME's tradeDate). AMS paths are tried on the mirror host too (ams_http.MIRRORS).
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=10d&interval=1d"
CME = ("https://www.cmegroup.com/CmeWS/mvc/Settlements/Futures/Settlements/{pid}/FUT"
       "?strategy=DEFAULT&tradeDate={td}&pageSize=50")
AMS = "https://{host}/mnreports/ams_{slug}.pdf"
AMS_HOSTS = ("www.ams.usda.gov", "ams-prod.azureedge.us")
DOCS = {
    "settles-yahoo": [(sym, "json", [YAHOO.format(sym=sym)]) for sym in
                      ("ZC=F", "ZS=F", "ZW=F", "KE=F", "MWE=F", "ZM=F", "ZL=F", "LE=F", "GF=F", "HE=F")],
    "settles-cme": [(name, "json", [CME.replace("{pid}", str(pid))]) for name, pid in
                    (("corn", 300), ("soybeans", 320), ("chicago wheat", 323), ("kc wheat", 348),
                     ("live cattle", 22), ("feeder cattle", 34), ("lean hogs", 19))],
    "cot-cftc": [
        ("disaggregated futures", "text", ["https://www.cftc.gov/dea/newcot/f_disagg.txt"]),
        ("disaggregated futures and options", "text", ["https://www.cftc.gov/dea/newcot/c_disagg.txt"]),
        ("legacy futures", "text", ["https://www.cftc.gov/dea/newcot/deafut.txt"]),
        ("disaggregated dataset, newest rows", "json",
         ["https://publicreporting.cftc.gov/resource/72hh-3qpy.json?$limit=400&$order=report_date_as_yyyy_mm_dd%20DESC"]),
    ],
    "ams-reports": [("ams_%s" % slug, "pdf", [AMS.format(host=h, slug=slug) for h in AMS_HOSTS]) for slug in
                    ("3195", "1856", "3357", "1245", "2511", "2498", "2477", "2453", "3183", "3050", "2162", "1889")],
}
WEB_PAGE = (b"<html", b"<!doctype", b"<HTML", b"<!DOCTYPE")


def sources():
    return [f"agtransport-{n}" for n in AGTRANSPORT] + ["usgs-river"] + list(EIA) + list(DOCS)


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ------------------------------------------------------------------ network
class Net:
    """One request at a time, at least `gap` seconds apart. `opener` (tests): url -> (status, bytes)."""

    def __init__(self, gap=GAP, pauses=PAUSES, opener=None, sleep=time.sleep, clock=time.monotonic, headers=None):
        self.gap, self.pauses, self.opener, self.sleep, self.clock = gap, pauses, opener, sleep, clock
        self.headers = dict({"User-Agent": UA, "Accept": "*/*"}, **(headers or {}))
        self._last = None
        self.calls = 0

    def _open(self, url):
        if self.opener:
            return self.opener(url)
        req = urllib.request.Request(url, headers=self.headers)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            try:
                return e.code, e.read()
            except Exception:  # noqa: BLE001
                return e.code, b""

    def get(self, url):
        """-> request record {url, status, fetched_utc, bytes, sha256, error} and the body (b"" on failure)."""
        err = None
        for attempt in range(len(self.pauses) + 1):
            if self._last is not None:
                wait = self._last + self.gap - self.clock()
                if wait > 0:
                    self.sleep(wait)
            when = now_iso()
            self.calls += 1
            try:
                status, body = self._open(url)
            except Exception as e:  # noqa: BLE001  network: tried again, then recorded
                status, body, err = None, b"", f"{type(e).__name__}: {str(e)[:200]}"
            self._last = self.clock()
            if status == 200:
                return {"url": url, "status": 200, "fetched_utc": when, "bytes": len(body),
                        "sha256": hashlib.sha256(body).hexdigest(), "tries": attempt + 1}, body
            if status is not None:
                err = f"HTTP {status}"
            retry = status is None or status == 429 or status >= 500
            if not retry or attempt == len(self.pauses):
                break
            self.sleep(self.pauses[attempt])
        return {"url": url, "status": status, "fetched_utc": when, "bytes": len(body or b""),
                "sha256": hashlib.sha256(body or b"").hexdigest() if body else None,
                "tries": attempt + 1, "error": err}, b""


def as_json(req, body):
    """Parse a 200 body as JSON; a body that is not JSON marks the request failed."""
    if req["status"] != 200:
        return None
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as e:
        req["error"] = f"not JSON: {type(e).__name__}"
        return None


# ------------------------------------------------------------------ sources
def date_column(meta):
    """The dataset's date column from its metadata: 'date' if it is a date
    column, else the first date column. None when there is none."""
    cols = [c for c in (meta or {}).get("columns") or [] if isinstance(c, dict) and c.get("fieldName")
            and not str(c["fieldName"]).startswith(":")]
    cal = [c["fieldName"] for c in cols if c.get("dataTypeName") in ("calendar_date", "date")]
    if "date" in cal:
        return "date"
    return cal[0] if cal else None


def socrata_url(ds, params):
    return f"{SOCRATA}/resource/{ds}.json?" + urllib.parse.urlencode(params)


def fetch_agtransport(net, name, day, days=SOCRATA_DAYS, page=SOCRATA_PAGE):
    ds = AGTRANSPORT[name]
    rec = {"dataset": ds, "requests": [], "data": None}
    req, body = net.get(f"{SOCRATA}/api/views/{ds}.json")
    rec["requests"].append(req)
    meta = as_json(req, body)
    if not isinstance(meta, dict):
        rec["error"] = f"metadata: {req.get('error') or 'not an object'}"
        return rec
    rec["meta"] = meta
    col = date_column(meta)
    if not col:
        rec["error"] = "no date column in the dataset's metadata"
        return rec
    since = (day - timedelta(days=days)).isoformat()
    rec["window"] = {"date_column": col, "since": since, "days": days}
    rows, off = [], 0
    while True:
        u = socrata_url(ds, {"$select": ":*, *", "$where": f"{col} >= '{since}T00:00:00'",
                             "$order": ":id", "$limit": page, "$offset": off})
        req, body = net.get(u)
        rec["requests"].append(req)
        part = as_json(req, body)
        if not isinstance(part, list):
            rec["error"] = f"rows at offset {off}: {req.get('error') or 'not a list'}"
            return rec          # a partial read is never saved as the day's rows
        rows += part
        if len(part) < page:
            break
        off += page
    rec["data"] = rows
    rec["rows"] = len(rows)
    return rec


def usgs_legacy_url(sites, start, end):
    return "https://waterservices.usgs.gov/nwis/dv/?" + urllib.parse.urlencode(
        {"format": "json", "sites": ",".join(sites), "parameterCd": USGS_PARAMS, "statCd": "00003",
         "startDT": start, "endDT": end, "siteStatus": "all"})


def usgs_ogc_url(site, start, end):
    return "https://api.waterdata.usgs.gov/ogcapi/v0/collections/daily/items?" + urllib.parse.urlencode(
        {"f": "json", "monitoring_location_id": f"USGS-{site}", "parameter_code": USGS_PARAMS,
         "statistic_id": "00003", "time": f"{start}/{end}", "limit": 10000})


def legacy_sites(doc):
    """Site numbers with at least one series in a WaterServices answer."""
    out = set()
    for ts in ((doc or {}).get("value") or {}).get("timeSeries") or []:
        for c in (ts.get("sourceInfo") or {}).get("siteCode") or []:
            if c.get("value"):
                out.add(str(c["value"]))
    return out


def legacy_values(doc):
    n = 0
    for ts in ((doc or {}).get("value") or {}).get("timeSeries") or []:
        for blk in ts.get("values") or []:
            n += len(blk.get("value") or [])
    return n


def fetch_usgs(net, day, days=USGS_DAYS, gauges=GAUGES):
    """The newer api.waterdata.usgs.gov first, one gauge at a time. WaterServices (retired by USGS in
    Q1 2027) is asked once for every gauge only when the new API left a gauge out, and its answer is
    kept when it covers more gauges. The record keeps whichever answer it is, as sent."""
    start, end = (day - timedelta(days=days)).isoformat(), day.isoformat()
    sites = list(gauges)
    rec = {"gauges": gauges, "window": {"start": start, "end": end, "days": days}, "requests": [], "data": None}
    out, missing, rows = {}, [], 0
    for s in sites:
        req, body = net.get(usgs_ogc_url(s, start, end))
        rec["requests"].append(req)
        d = as_json(req, body)
        feats = (d or {}).get("features") if isinstance(d, dict) else None
        if feats:
            out[s] = d
            rows += len(feats)
        else:
            missing.append(s)
    if not missing:
        rec.update(service="api.waterdata", data=out, rows=rows, missing_sites=[])
        return rec
    req, body = net.get(usgs_legacy_url(sites, start, end))
    rec["requests"].append(req)
    doc = as_json(req, body)
    if isinstance(doc, dict) and len(legacy_sites(doc)) > len(out):
        rec.update(service="waterservices", data=doc, rows=legacy_values(doc))
        rec["missing_sites"] = sorted(set(sites) - legacy_sites(doc))
        return rec
    if not out:
        rec["error"] = "no gauge answered (api.waterdata and WaterServices)"
        return rec
    rec.update(service="api.waterdata", data=out, rows=rows, missing_sites=missing)
    return rec


def fetch_eia(net, source):
    rec = {"requests": [], "data": None}
    for u in EIA[source]:
        req, body = net.get(u)
        rec["requests"].append(req)
        if req["status"] != 200:
            continue
        if not body.startswith(SHEET_MAGIC):
            req["error"] = "not a spreadsheet (first bytes: %s)" % body[:16].hex()
            continue
        rec["data"] = {"url": u, "content_type": "application/vnd.ms-excel" if body.startswith(SHEET_MAGIC[0])
                       else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                       "body_b64": base64.b64encode(body).decode("ascii")}
        rec["rows"] = None          # never opened here; the bytes are the record
        return rec
    rec["error"] = "no table download answered with a spreadsheet"
    return rec


def last_weekday(day):
    d = day - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def doc_problem(kind, body):
    """None when the body is the kind of document asked for, else why it is not."""
    head = body[:512].lstrip()
    if kind == "pdf":
        return None if body.startswith(b"%PDF-") else "not a PDF (first bytes: %s)" % body[:16].hex()
    if any(head.startswith(w) or w in head[:200] for w in WEB_PAGE):
        return "a web page, not the document"
    if kind == "json":
        try:
            json.loads(body)
        except ValueError:
            return "not JSON"
    if kind == "text" and not body.strip():
        return "empty"
    return None


def fetch_docs(net, source, day):
    """Every document of a DOCS source, bytes as sent. ok when at least one came back."""
    td = last_weekday(day).strftime("%m/%d/%Y")
    rec = {"requests": [], "data": None, "missing": []}
    docs = []
    for label, kind, urls in DOCS[source]:
        got = None
        for u in urls:
            u = u.replace("{td}", td)
            req, body = net.get(u)
            rec["requests"].append(req)
            if req["status"] != 200:
                continue
            why = doc_problem(kind, body)
            if why:
                req["error"] = why
                continue
            got = {"label": label, "kind": kind, "url": u, "fetched_utc": req["fetched_utc"], "bytes": len(body),
                   "sha256": req["sha256"], "body_b64": base64.b64encode(body).decode("ascii")}
            break
        if got:
            docs.append(got)
        else:
            rec["missing"].append(label)
    rec["rows"] = len(docs)
    if docs:
        rec["data"] = {"docs": docs}
    else:
        rec["error"] = "no document answered"
    return rec


# ------------------------------------------------------------------ files
def gz_bytes(doc):
    raw = json.dumps(doc, separators=(",", ":"), sort_keys=True, ensure_ascii=False).encode("utf-8")
    return gzip.compress(raw, mtime=0)


def write_once(path, data):
    """Write a new file; never replace one. -> True when written, False when it was already there."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    except FileExistsError:
        return False
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    return True


def run(day, out=OUT, only=None, net=None, log=print):
    """Fetch every source for `day` (a date) into out/. -> the manifest dict."""
    net = net or Net(headers=({"X-App-Token": os.environ["SOCRATA_APP_TOKEN"]}
                              if os.environ.get("SOCRATA_APP_TOKEN") else None))
    ds = day.isoformat()
    man_path = os.path.join(out, "manifest", f"{ds}.json")
    if os.path.exists(man_path):
        log(f"vintage {ds}: already saved here; nothing fetched")
        with open(man_path, encoding="utf-8") as f:
            return json.load(f)
    man = {"schema": SCHEMA, "day": ds, "started_utc": now_iso(), "sources": {}}
    for src in (only or sources()):
        path = os.path.join(out, src, f"{ds}.json.gz")
        if os.path.exists(path):
            man["sources"][src] = {"kept": True, "note": "a file for this day was already there; left as it was"}
            log(f"  {src}: kept (already saved)")
            continue
        started = now_iso()
        try:
            if src.startswith("agtransport-"):
                rec = fetch_agtransport(net, src[len("agtransport-"):], day)
            elif src == "usgs-river":
                rec = fetch_usgs(net, day)
            elif src in EIA:
                rec = fetch_eia(net, src)
            elif src in DOCS:
                rec = fetch_docs(net, src, day)
            else:
                raise ValueError(f"unknown source {src}")
        except Exception as e:  # noqa: BLE001  one source's surprise never stops the others
            rec = {"requests": [], "data": None, "error": f"{type(e).__name__}: {str(e)[:200]}"}
        ok = rec.get("data") is not None and not rec.get("error")
        doc = dict(rec, schema=SCHEMA, source=src, day=ds, fetched_utc=started, finished_utc=now_iso(), ok=ok)
        if src.startswith("agtransport-") and ok:
            # when USDA last changed these rows (the dataset's rowsUpdatedAt), beside our fetch time
            doc.update(socrata([rec.get("meta")], doc["finished_utc"]))
        doc.setdefault("rows", None)
        doc.setdefault("error", None)
        if not ok:
            doc["data"] = None          # a failure is recorded, never half a day's rows
        blob = gz_bytes(doc)
        written = write_once(path, blob)
        statuses = [r.get("status") for r in rec.get("requests") or []]
        man["sources"][src] = {"ok": ok, "rows": doc["rows"], "requests": len(statuses),
                               "statuses": sorted({s for s in statuses if s is not None}),
                               "error": doc["error"], "bytes": len(blob),
                               "sha256": hashlib.sha256(blob).hexdigest(), "written": written}
        if rec.get("missing_sites"):
            man["sources"][src]["missing_sites"] = rec["missing_sites"]
        if rec.get("missing"):
            man["sources"][src]["missing"] = rec["missing"]
        log(f"  {src}: {'ok' if ok else 'FAILED'}, {doc['rows'] if doc['rows'] is not None else '-'} rows, "
            f"{len(blob)} bytes, {len(statuses)} request(s)"
            + ((f", status {','.join(str(s) for s in man['sources'][src]['statuses'])}"
                if man['sources'][src]['statuses'] else ", no answer from the host") if not ok else "")
            + (f", {len(rec['missing_sites'])} gauge(s) did not answer: {','.join(rec['missing_sites'])}"
               if rec.get("missing_sites") else ""))
    s = man["sources"]
    man["finished_utc"] = now_iso()
    man["counts"] = {"sources": len(s), "ok": sum(1 for v in s.values() if v.get("ok")),
                     "failed": sum(1 for v in s.values() if not v.get("ok") and not v.get("kept")),
                     "kept": sum(1 for v in s.values() if v.get("kept")),
                     "rows": sum(v.get("rows") or 0 for v in s.values()),
                     "bytes": sum(v.get("bytes") or 0 for v in s.values()), "requests": net.calls}
    write_once(man_path, (json.dumps(man, indent=1, sort_keys=True) + "\n").encode("utf-8"))
    c = man["counts"]
    log(f"vintage {ds}: {c['ok']} of {c['sources']} sources ok, {c['failed']} failed, {c['kept']} kept; "
        f"{c['rows']} rows, {c['bytes']} bytes, {c['requests']} requests")
    return man


def read_vintage(path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


# ------------------------------------------------------------------ selftest
def selftest():
    import tempfile
    fails = []

    def ck(name, ok, detail=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  {detail}"))
        if not ok:
            fails.append(name)

    here = os.path.dirname(os.path.abspath(__file__))
    fx = os.path.join(here, "..", "test", "fixtures", "vintage")
    meta_b = open(os.path.join(here, "..", "test", "fixtures", "history", "agtransport", "views-deqi-uken.json"), "rb").read()
    rows_b = open(os.path.join(fx, "socrata-barge.json"), "rb").read()
    usgs_b = open(os.path.join(fx, "usgs-dv.json"), "rb").read()
    xls_b = open(os.path.join(fx, "eia-table.xls"), "rb").read()
    rows = json.loads(rows_b)
    day = date(2026, 10, 28)

    def make(fail=(), html_eia=False, legacy_down=False):
        calls = []

        def opener(u):
            calls.append(u)
            for f in fail:
                if f in u:
                    return 503, b"busy"
            if "yahoo.com" in u or "cmegroup.com" in u:
                return 200, json.dumps({"u": u}).encode()
            if "cftc.gov" in u:
                return 200, (b'[{"report_date_as_yyyy_mm_dd": "2026-10-27"}]' if "publicreporting" in u
                             else b'"WHEAT-SRW - CHICAGO BOARD OF TRADE",261027,...')
            if "/mnreports/" in u:
                if "www.ams.usda.gov" in u and "ams_3195" in u:
                    return 200, b"<html>Access Denied</html>"
                return 200, b"%PDF-1.7 Market News " + u.encode()
            if "/api/views/" in u:
                return 200, meta_b
            if "/resource/" in u:
                q = urllib.parse.parse_qs(urllib.parse.urlsplit(u).query)
                off, lim = int(q["$offset"][0]), int(q["$limit"][0])
                return 200, json.dumps(rows[off:off + lim]).encode()
            if "waterservices" in u:
                return (500, b"") if legacy_down else (200, usgs_b)
            if "api.waterdata" in u:
                site = urllib.parse.parse_qs(urllib.parse.urlsplit(u).query)["monitoring_location_id"][0][5:]
                if site == "07010000":
                    return 200, json.dumps({"type": "FeatureCollection", "features": [
                        {"properties": {"time": "2026-10-26", "value": "-2.40", "parameter_code": "00065"}}]}).encode()
                return 200, json.dumps({"type": "FeatureCollection", "features": []}).encode()
            if "eia.gov" in u:
                return 200, (b"<html>moved</html>" if html_eia else xls_b)
            return 404, b""
        sleeps = []
        return Net(gap=3, pauses=(15, 60), opener=opener, sleep=sleeps.append, clock=lambda: 0.0), calls, sleeps

    quiet = lambda *a: None  # noqa: E731
    with tempfile.TemporaryDirectory() as d:
        net, calls, sleeps = make()
        man = run(day, out=d, net=net, log=quiet)
        ck("every source ok on the saved sample", man["counts"]["ok"] == len(sources()) and man["counts"]["failed"] == 0, man["counts"])
        b = read_vintage(os.path.join(d, "agtransport-barge_rates", "2026-10-28.json.gz"))
        ck("rows kept as sent, with Socrata's system fields", b["data"] == rows and b["rows"] == 18 and ":updated_at" in b["data"][0])
        ck("date column from the metadata, 60-day window", b["window"] == {"date_column": "date", "since": "2026-08-29", "days": 60}, b["window"])
        page = [u for u in calls if "/resource/deqi-uken" in u][0]
        qp = urllib.parse.parse_qs(urllib.parse.urlsplit(page).query)
        ck("query asks for system fields, the window, a stable order",
           qp["$select"] == [":*, *"] and qp["$where"] == ["date >= '2026-08-29T00:00:00'"] and qp["$order"] == [":id"], qp)
        ck("fetch time, URL, status and sha256 of each body",
           all(r["status"] == 200 and r["fetched_utc"].endswith("Z") and r["url"].startswith("https://")
               and r["sha256"] == hashlib.sha256(meta_b if "/api/views/" in r["url"] else json.dumps(rows[0:SOCRATA_PAGE]).encode()).hexdigest()
               for r in b["requests"]), b["requests"])
        ck("metadata saved as sent", b["meta"] == json.loads(meta_b))
        ck("released_at beside the fetch: the dataset's rowsUpdatedAt, or the fetch time when it states none",
           b["released_basis"] == ("source" if json.loads(meta_b).get("rowsUpdatedAt") else "fetched") and b["released_at"].endswith("Z"),
           (b.get("released_at"), b.get("released_basis")))
        u = read_vintage(os.path.join(d, "usgs-river", "2026-10-28.json.gz"))
        ck("USGS: new API asked first, one gauge at a time, then WaterServices once; the answer covering more gauges kept whole",
           u["service"] == "waterservices" and u["data"] == json.loads(usgs_b) and len(u["requests"]) == len(GAUGES) + 1, u.get("service"))
        ck("USGS: the first request goes to api.waterdata, the last to waterservices",
           "api.waterdata" in u["requests"][0]["url"] and "waterservices" in u["requests"][-1]["url"], [r["url"][:40] for r in u["requests"]])
        ck("USGS: gauges that did not answer are named", u["missing_sites"] == sorted(set(GAUGES) - {"07010000", "06934500"}), u["missing_sites"])
        ck("USGS: rows count every reading, no-data days included (kept as sent)", u["rows"] == 7, u["rows"])
        e = read_vintage(os.path.join(d, "eia-ethanol", "2026-10-28.json.gz"))
        ck("EIA: bytes kept exactly (base64)", base64.b64decode(e["data"]["body_b64"]) == xls_b and e["data"]["content_type"] == "application/vnd.ms-excel")
        ck("one request at a time, 3 s apart", sleeps and all(s == 3 for s in sleeps), sleeps[:5])
        ndocs = sum(len(v) for v in DOCS.values())
        ck("polite: one metadata and one page per dataset, one USGS call per gauge and one legacy, one per EIA table, "
           "one per document (one more for an AMS report the main host refused)",
           len(calls) == 2 * len(AGTRANSPORT) + len(GAUGES) + 1 + 2 + ndocs + 1, len(calls))
        a = read_vintage(os.path.join(d, "ams-reports", "2026-10-28.json.gz"))
        f3195 = [x for x in a["data"]["docs"] if x["label"] == "ams_3195"][0]
        ck("AMS: a web page from the main host is not the report; the mirror's PDF is kept, bytes and sha256 as sent",
           "ams-prod.azureedge.us" in f3195["url"] and base64.b64decode(f3195["body_b64"]).startswith(b"%PDF-")
           and f3195["sha256"] == hashlib.sha256(base64.b64decode(f3195["body_b64"])).hexdigest()
           and a["rows"] == len(DOCS["ams-reports"]) and a["ok"], f3195["url"])
        cm = read_vintage(os.path.join(d, "settles-cme", "2026-10-28.json.gz"))
        ck("CME: the trade date is the last weekday before the day", all("tradeDate=10/27/2026" in x["url"] for x in cm["data"]["docs"]))
        ct = read_vintage(os.path.join(d, "cot-cftc", "2026-10-28.json.gz"))
        ck("COT: the text files and the newest dataset rows, each with its own URL and fetch time",
           ct["rows"] == 4 and all(x["fetched_utc"].endswith("Z") and x["url"].startswith("https://") for x in ct["data"]["docs"]))
        mp = os.path.join(d, "manifest", "2026-10-28.json")
        m = json.load(open(mp))
        gz = os.path.join(d, "eia-diesel", "2026-10-28.json.gz")
        ck("manifest: sha256 and size of each saved file",
           m["sources"]["eia-diesel"]["sha256"] == hashlib.sha256(open(gz, "rb").read()).hexdigest()
           and m["sources"]["eia-diesel"]["bytes"] == os.path.getsize(gz))

        # never overwrites: same day again (manifest there) fetches nothing and changes nothing
        before = {p: open(os.path.join(r, p), "rb").read() for r, _, fs in os.walk(d) for p in fs}
        net2, calls2, _ = make(fail=("eia.gov", "agtransport", "waterservices", "waterdata"))
        run(day, out=d, net=net2, log=quiet)
        after = {p: open(os.path.join(r, p), "rb").read() for r, _, fs in os.walk(d) for p in fs}
        ck("same day again: nothing fetched, nothing changed", not calls2 and before == after, len(calls2))
        # a source file there without the manifest (a cut-off run): kept, others fetched
        os.remove(mp)
        old = open(gz, "rb").read()
        man3 = run(day, out=d, only=["eia-diesel"], net=make(html_eia=True)[0], log=quiet)
        ck("a saved source file is never replaced", open(gz, "rb").read() == old and man3["sources"]["eia-diesel"].get("kept"), man3["sources"])
        ck("write_once refuses an existing file", write_once(gz, b"x") is False and open(gz, "rb").read() == old)

    with tempfile.TemporaryDirectory() as d:
        # failures are recorded, tried at most three times, never half a day
        net, calls, sleeps = make(fail=("/resource/deqi-uken", "eia.gov/dnav/pet/xls/PET_PRI"), html_eia=False)
        man = run(day, out=d, net=net, log=quiet)
        s = man["sources"]["agtransport-barge_rates"]
        ck("a failed source is recorded with its status", not s["ok"] and s["statuses"] == [200, 503] and "HTTP 503" in s["error"], s)
        rb = read_vintage(os.path.join(d, "agtransport-barge_rates", "2026-10-28.json.gz"))
        tries = [r for r in rb["requests"] if "/resource/" in r["url"]]
        ck("three tries at most, with the two pauses", len(tries) == 1 and tries[0]["tries"] == 3 and 15 in sleeps and 60 in sleeps, (tries, sleeps))
        ck("failed source keeps no rows", rb["data"] is None and rb["ok"] is False)
        dz = read_vintage(os.path.join(d, "eia-diesel", "2026-10-28.json.gz"))
        ck("EIA: second URL used when the first fails", dz["ok"] and dz["data"]["url"] == EIA["eia-diesel"][1], dz["requests"])
        ck("the other sources go on", man["counts"]["ok"] == len(sources()) - 1 and man["counts"]["failed"] == 1, man["counts"])
        ck("manifest records the failure", json.load(open(os.path.join(d, "manifest", "2026-10-28.json")))["sources"]["agtransport-barge_rates"]["ok"] is False)

    with tempfile.TemporaryDirectory() as d:
        # a refusal (4xx) is not asked again; an HTML page is not a spreadsheet; USGS keeps the new API's partial answer when WaterServices is down
        net, calls, sleeps = make(legacy_down=True, html_eia=True)
        man = run(day, out=d, only=["usgs-river", "eia-ethanol"], net=net, log=quiet)
        u = read_vintage(os.path.join(d, "usgs-river", "2026-10-28.json.gz"))
        ck("USGS: the new API's answer is kept when WaterServices is down",
           u["ok"] and u["service"] == "api.waterdata" and list(u["data"]) == ["07010000"] and len(u["requests"]) == 1 + len(GAUGES), u.get("service"))
        e = read_vintage(os.path.join(d, "eia-ethanol", "2026-10-28.json.gz"))
        ck("EIA: an HTML page is not saved as the table", not e["ok"] and all("not a spreadsheet" in r["error"] for r in e["requests"]), e["requests"])
        r = Net(gap=0, opener=lambda u: (403, b"no"), sleep=lambda s: None)
        req, body = r.get("https://example.invalid/x")
        ck("a 403 is asked once", r.calls == 1 and req["status"] == 403 and body == b"", req)
    with tempfile.TemporaryDirectory() as d:
        net, calls, sleeps = make(fail=("cmegroup.com",))
        man = run(day, out=d, only=["settles-cme", "settles-yahoo"], net=net, log=quiet)
        ck("documents: a refused source is recorded failed, the others go on",
           not man["sources"]["settles-cme"]["ok"] and man["sources"]["settles-yahoo"]["ok"]
           and man["sources"]["settles-cme"]["missing"] == [n for n, _, _ in DOCS["settles-cme"]], man["sources"]["settles-cme"])
        ck("documents: a web page is never JSON or a PDF", doc_problem("json", b"<!DOCTYPE html><p>x") and doc_problem("pdf", b"<html>")
           and doc_problem("json", b"{}") is None and doc_problem("text", b"a,b\n") is None)

    with tempfile.TemporaryDirectory() as d:
        past = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
        rc = main(["--day", past, "--out", d])
        ck("a past day is refused (today's fetch never passes for an older vintage)", rc == 2 and not os.listdir(d), rc)

    ck("every dataset id is a Socrata 4x4", all(len(v) == 9 and v[4] == "-" for v in AGTRANSPORT.values()))
    ck("every gauge is an 8-digit USGS site number", all(len(k) == 8 and k.isdigit() for k in GAUGES))
    print(f"vintage selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="vintage.py")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--day", default="")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--only", default="")
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    today = datetime.now(timezone.utc).date()
    day = date.fromisoformat(a.day) if a.day else today
    if day != today:
        # A file is what was published on its day. Today's fetch saved under another
        # date would pass for an older vintage (look-ahead), so only today is allowed.
        print(f"--day {day}: only today ({today} UTC) can be saved; a past day cannot be fetched again")
        return 2
    only = [s.strip() for s in a.only.split(",") if s.strip()] or None
    bad = [s for s in only or [] if s not in sources()]
    if bad:
        print(f"unknown source(s) {bad}; known: {', '.join(sources())}")
        return 2
    man = run(day, out=a.out, only=only)
    if man["counts"]["failed"]:
        print(f"::warning::vintage {day}: {man['counts']['failed']} source(s) failed; recorded in the manifest, not retried")
    return 0


if __name__ == "__main__":
    sys.exit(main())
