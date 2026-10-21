#!/usr/bin/env python3
"""reader_area_counts.py -- a daily snapshot of reader counts by area, counts
only, to the private-data branch (Sig, Oct 21: the insight machine's "readers
by place"). Runs inside morning-report.yml after the email (no new schedule).

READS the subs worker's GET /count-area (v5.45, Bearer LIST_TOKEN), one list
at a time, page by page, and adds the pages up:
  daily        sign-ups by ZIP3 (first three ZIP digits) and by sign-up page
  alerts       hail alerts by state (from the place the reader typed)
  watch        county watches by state (each watched county's state, once per address)
  ewatch       elevator watches (total)
  pwatch       price targets (total, by symbol)
  notices      one-time notices by kind, rent state, rain-year state, gauge-list ZIP3
  rp_designs   saved Rain Print designs by state or province and by year
  rp_orders    Rain Print orders (kept 120 days by the worker) by state and product, and paid ones
and GET /count's totals.

WRITES private/data/reader-area/<YYYY>/<YYYY-MM-DD>.json (Central date; a rerun
that day replaces it). EVERY CELL UNDER 3 IS WITHHELD: it is left out, and the
number of withheld cells is kept per dimension. No address, no full ZIP, no
place name, nothing a reader typed: the worker never sends them, and this
script refuses to write a file in which anything looks like one.

    python3 scripts/reader_area_counts.py              (LIST_URL, LIST_TOKEN)
    python3 scripts/reader_area_counts.py --selftest
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

OUT = "private/data/reader-area"
PARTS = ("daily", "alerts", "watch", "ewatch", "pwatch", "notices", "rp_designs", "rp_orders")
MIN_CELL = 3
MAX_PAGES = 200
ST_FIPS = {"01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
           "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
           "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
           "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
           "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
           "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY"}
FIPS_DIMS = {"st_fips": "state", "rainyear_st_fips": "rainyear_state"}
COUNT_KEYS = ("daily", "daily_with_zip", "alerts", "ewatch", "pwatch", "watch", "notice")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+")


class Worker:
    def __init__(self, list_url, token, opener=None):
        u = urllib.parse.urlsplit((list_url or "").strip())
        self.base = f"{u.scheme}://{u.netloc}" if u.scheme and u.netloc else ""
        self.token = (token or "").strip()
        self.opener = opener

    def get(self, path, **q):
        if not (self.base and self.token):
            raise LookupError("no LIST_URL / LIST_TOKEN")
        url = f"{self.base}/{path}" + ("?" + urllib.parse.urlencode(q) if q else "")
        if self.opener:
            return self.opener(url)
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.token}", "User-Agent": "agsist-reader-area"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            return e.code, None


def read_part(w, part):
    tot, n, cursor = {}, 0, ""
    for _ in range(MAX_PAGES):
        q = {"part": part}
        if cursor:
            q["cursor"] = cursor
        status, d = w.get("count-area", **q)
        if status == 404:
            raise LookupError("the worker has no /count-area yet (v5.45 not deployed)")
        if status != 200 or not isinstance(d, dict) or not d.get("ok"):
            raise RuntimeError(f"{part}: HTTP {status}")
        for dim, m in (d.get("counts") or {}).items():
            t = tot.setdefault(dim, {})
            for k, v in m.items():
                if isinstance(v, int) and not isinstance(v, bool):
                    t[str(k)] = t.get(str(k), 0) + v
        n += int(d.get("n") or 0)
        cursor = d.get("cursor") or ""
        if not cursor:
            return n, tot
    raise RuntimeError(f"{part}: more than {MAX_PAGES} pages")


def withhold(tot):
    """{dim: {k: n}} -> ({dim: {k: n >= 3}}, {dim: cells withheld}). FIPS dims become state letters."""
    shown, held = {}, {}
    for dim, m in tot.items():
        name = dim
        if dim in FIPS_DIMS:
            name = FIPS_DIMS[dim]
            mm = {}
            for k, v in m.items():
                st = ST_FIPS.get(k, "?")
                mm[st] = mm.get(st, 0) + v
            m = mm
        shown[name] = {k: v for k, v in sorted(m.items()) if v >= MIN_CELL}
        h = sum(1 for v in m.values() if v < MIN_CELL)
        if h:
            held[name] = h
    return shown, held


def privacy_problems(doc):
    s = json.dumps(doc)
    out = []
    if EMAIL_RE.search(s):
        out.append("an address")
    for part in (doc.get("parts") or {}).values():
        for dim, m in (part.get("counts") or {}).items():
            for k, v in m.items():
                if re.fullmatch(r"\d{4,}", k) and dim not in ("year",):
                    out.append(f"{dim}: a key that looks like a ZIP")
                if isinstance(v, int) and v < MIN_CELL:
                    out.append(f"{dim}: a cell under {MIN_CELL}")
                if len(k) > 40:
                    out.append(f"{dim}: a long key")
    for k, v in (doc.get("count") or {}).items():
        if isinstance(v, int) and 0 < v < MIN_CELL and not k.endswith("_withheld"):   # *_withheld counts cells, not readers
            out.append(f"count.{k} under {MIN_CELL}")
    return out


def build(w, now=None):
    now = now or datetime.now(timezone.utc)
    doc = {"schema": "agsist-reader-area/1", "day": now.astimezone(ZoneInfo("America/Chicago")).date().isoformat(),
           "made": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "min_cell": MIN_CELL,
           "note": ("Counts only, from the subs worker's /count-area (v5.45) and /count. Cells under 3 are withheld "
                    "(left out; 'withheld' says how many cells per dimension). ZIP3 = first three ZIP digits. "
                    "State = the two letters at the end of the place a reader typed, ? when there are none."),
           "parts": {}, "errors": {}}
    try:
        status, c = w.get("count")
        if status == 200 and isinstance(c, dict) and c.get("ok"):
            cnt = {k: c[k] for k in COUNT_KEYS if isinstance(c.get(k), int)}
            doc["count"] = {k: v for k, v in cnt.items() if v == 0 or v >= MIN_CELL}
            src, held = withhold({"by_source": {str(k): v for k, v in (c.get("by_source") or {}).items() if isinstance(v, int)}})
            doc["count"]["by_source"] = src["by_source"]
            if held:
                doc["count"]["by_source_withheld"] = held["by_source"]
    except Exception as e:  # noqa: BLE001
        doc["errors"]["count"] = type(e).__name__
    for part in PARTS:
        try:
            n, tot = read_part(w, part)
        except LookupError:
            raise
        except Exception as e:  # noqa: BLE001  one list failing never loses the rest
            doc["errors"][part] = str(e)[:120]
            continue
        shown, held = withhold(tot)
        doc["parts"][part] = {"records": n if n == 0 or n >= MIN_CELL else None, "counts": shown}
        if held:
            doc["parts"][part]["withheld"] = held
    return doc


def write(doc, out=OUT):
    p = os.path.join(out, doc["day"][:4], doc["day"] + ".json")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, sort_keys=True)
        f.write("\n")
    return p


def main():
    w = Worker(os.environ.get("LIST_URL", ""), os.environ.get("LIST_TOKEN", ""))
    try:
        doc = build(w)
    except LookupError as e:
        print(f"::warning::reader counts by area not taken: {e}")
        return 0
    bad = privacy_problems(doc)
    if bad:
        print(f"::warning::reader counts by area not written: {sorted(set(bad))[:5]}")
        return 0
    p = write(doc)
    parts = ", ".join(f"{k} {v['records'] if v['records'] is not None else '<3'}" for k, v in doc["parts"].items())
    print(f"reader counts by area: {p} ({parts}){'; not read: ' + ', '.join(doc['errors']) if doc['errors'] else ''}")
    return 0


# ------------------------------------------------------------------ selftest
def selftest():
    import tempfile
    fails = []

    def ck(name, ok, detail=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  {detail}"))
        if not ok:
            fails.append(name)

    pages = {
        "daily": [{"n": 4, "counts": {"zip3": {"547": 3, "500": 1}, "src": {"footer": 2, "cash-bids": 2}}},
                  {"n": 3, "counts": {"zip3": {"547": 1, "none": 2}, "src": {"cash-bids": 3}}}],
        "watch": [{"n": 4, "counts": {"st_fips": {"55": 3, "19": 1, "27": 1}}}],
        "rp_designs": [{"n": 5, "counts": {"state": {"WI": 4, "SK": 1}, "year": {"2025": 3, "1998": 2}}}],
    }

    def opener(url):
        q = {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).items()}
        if url.split("?")[0].endswith("/count"):
            return 200, {"ok": True, "daily": 150, "daily_with_zip": 90, "alerts": 2, "secret": True,
                         "by_source": {"footer": 80, "rp": 1}, "forms": {"x": 1}}
        part = q["part"]
        if part == "notices":
            return 500, None
        pg = pages.get(part, [{"n": 0, "counts": {}}])
        i = int(q.get("cursor", "0"))
        return 200, dict(pg[i], ok=True, part=part, cursor=str(i + 1) if i + 1 < len(pg) else "")

    w = Worker("https://agsist-subs.example.test/list", "tok", opener=opener)
    doc = build(w, now=datetime(2026, 10, 21, 11, 45, tzinfo=timezone.utc))
    d = doc["parts"]["daily"]
    ck("pages added up", d["records"] == 7 and d["counts"]["zip3"] == {"547": 4} and d["counts"]["src"] == {"cash-bids": 5}, d)
    ck("cells under 3 withheld and counted", d["withheld"] == {"zip3": 2, "src": 1}, d.get("withheld"))
    ck("county watches by state letters", doc["parts"]["watch"]["counts"]["state"] == {"WI": 3} and doc["parts"]["watch"]["withheld"] == {"state": 2})
    ck("designs by state and year", doc["parts"]["rp_designs"]["counts"] == {"state": {"WI": 4}, "year": {"2025": 3}})
    ck("one list failing keeps the rest", "notices" in doc["errors"] and "rp_orders" in doc["parts"])
    ck("/count totals, small ones withheld", doc["count"]["daily"] == 150 and "alerts" not in doc["count"]
       and doc["count"]["by_source"] == {"footer": 80} and "secret" not in doc["count"], doc["count"])
    ck("an empty list: records 0", doc["parts"]["ewatch"]["records"] == 0)
    ck("Central date", doc["day"] == "2026-10-21")
    ck("a clean file passes the privacy check", privacy_problems(doc) == [], privacy_problems(doc))
    ck("an address is refused", privacy_problems(dict(doc, note="x@example.test")))
    bad = json.loads(json.dumps(doc))
    bad["parts"]["daily"]["counts"]["zip3"]["54728"] = 5
    ck("a full ZIP is refused", privacy_problems(bad))
    bad = json.loads(json.dumps(doc))
    bad["parts"]["daily"]["counts"]["zip3"]["547"] = 2
    ck("a cell under 3 is refused", privacy_problems(bad))
    with tempfile.TemporaryDirectory() as t:
        p = write(doc, t)
        ck("path", p.endswith("2026/2026-10-21.json") and json.load(open(p))["parts"]["daily"]["records"] == 7)

    def old(url):
        return (200, {"ok": True, "daily": 5}) if url.split("?")[0].endswith("/count") else (404, None)
    try:
        build(Worker("https://x.test", "tok", opener=old))
        ck("an old worker (no route) stops the snapshot", False)
    except LookupError:
        ck("an old worker (no route) stops the snapshot", True)
    print(f"reader_area_counts selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else main())
