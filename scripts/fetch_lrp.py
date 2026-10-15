#!/usr/bin/env python3
"""
fetch_lrp.py: USDA RMA Livestock Risk Protection (LRP) offers and actual
ending values -> the lrp-history branch, and data/lrp/ for the page

WHY THIS EXISTS
  /lrp will show what an LRP endorsement would have paid on every day RMA has
  published, so a buyer can see the record instead of a sales sheet. RMA
  publishes every day's full offer menu; this keeps it, unchanged, so the
  backtest can use the numbers a buyer saw on the day and nothing else.

THE SOURCE (opened by the probe of 2026-10-15; the capture is on lrp-history)
  ADM livestock, one zip per sales day, reinsurance years 2014 on (sales from
  July 1 2013):
    https://pubfs-rma.fpac.usda.gov/pub/References/adm_livestock/<RY>/<RY>_ADMLivestockLrp_Daily_<YYYYMMDD>.zip
  Pipe-delimited, one header line per member:
    A00630 LrpRate             one row per state x commodity x type x practice
                               x length x coverage level: coverage price,
                               expected ending value, level, rate, cost per
                               cwt, end date, price adjustment factor, target
                               weights. About 1 MB zipped a weekday.
    A00620 LrpActualEndingValue  commodity x type x end date (x sales date
                               from about RY2023): the actual ending value.
  Commodities: 0801 feeder cattle, 0802 fed cattle, 0815 swine, 0804 lamb
  (to RY2020, kept in the history, never published).
  Type codes are only meaningful inside one reinsurance year: RY2027 changed
  the dairy factors and the classes of 817-819 and added 820-823. An offer
  settles only against the actual ending value of its own reinsurance year.

  Not used: the Livestock Reports app (public.rma.usda.gov/livestockreports,
  a three-step form with about six months of dates) and the Summary of
  Business lrp_<YYYY>.zip files (only what was bought; no actual ending value).

USAGE
  python scripts/fetch_lrp.py --selftest
  python scripts/fetch_lrp.py --history DIR [--years 2014-2016] [--minutes 300]
  python scripts/fetch_lrp.py --publish DIR --out data/lrp
  python scripts/fetch_lrp.py --probe          # the first look; writes data/lrp-raw/probe/
"""

import argparse
import collections
import concurrent.futures
import gzip
import html.parser
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

UA = "AGSIST-automation/1.0 (+https://agsist.com/lrp)"
PUBFS = "https://pubfs-rma.fpac.usda.gov/pub/"
ADM_LIVE = PUBFS + "References/adm_livestock/"
ADM_MAIN = PUBFS + "References/actuarial_data_master/"
SOB = PUBFS + "Web_Data_Files/Summary_of_Business/livestock_and_dairy_participation/"
REPORT_BASES = ["https://public.rma.usda.gov/livestockreports/",
                "https://public-rma.fpac.usda.gov/apps/livestockreports/"]
REPORT_PAGES = ["main.aspx", "LRPReport", "LRPReport.aspx"]
LEGACY = ["https://legacy.rma.usda.gov/livestock/archive.html",
          "https://legacy.rma.usda.gov/tools/livestock.html",
          "https://old.rma.usda.gov/Information-Tools/Livestock-Reports"]

PROBE_DIR = "data/lrp-raw/probe"
PUBLISH_DIR = "data/lrp"
PROBE_CAP = 9 * 1024 * 1024        # whole capture
FILE_CAP = 4 * 1024 * 1024         # any one download kept
PAGE_CAP = 600 * 1024              # any one report response kept
FIRST_YEAR = 2003


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- parsing

class LinkParser(html.parser.HTMLParser):
    """Every <a href> with the text of the row it sits in (for sizes and dates
    in a directory listing)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []          # [href, link text, row text]
        self._row = []
        self._row_links = []
        self._a = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr" or tag == "li" or tag == "br":
            self._flush()
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self._a = [href, ""]

    def handle_endtag(self, tag):
        if tag == "a" and self._a is not None:
            self._row_links.append(self._a)
            self._a = None
        if tag in ("tr", "li"):
            self._flush()

    def handle_data(self, data):
        if self._a is not None:
            self._a[1] += data
        self._row.append(data)

    def _flush(self):
        text = " ".join(" ".join(self._row).split())
        for href, t in self._row_links:
            self.links.append([href, " ".join(t.split()), text])
        self._row, self._row_links = [], []

    def close(self):
        super().close()
        self._flush()


def parse_links(html_text, base):
    p = LinkParser()
    p.feed(html_text)
    p.close()
    out = []
    for href, text, row in p.links:
        out.append({"url": urllib.parse.urljoin(base, href), "text": text, "row": row})
    return out


class FormParser(html.parser.HTMLParser):
    """Forms with their inputs, selects (and options) and textareas."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.forms = []
        self._f = None
        self._sel = None
        self._opt = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "form":
            self._f = {"action": a.get("action", ""), "method": (a.get("method") or "get").lower(),
                       "id": a.get("id", ""), "fields": []}
            self.forms.append(self._f)
        if self._f is None:
            return
        if tag == "input":
            self._f["fields"].append({"kind": "input", "type": (a.get("type") or "text").lower(),
                                      "name": a.get("name"), "id": a.get("id"),
                                      "value": a.get("value", ""),
                                      "checked": "checked" in a})
        elif tag == "select":
            self._sel = {"kind": "select", "name": a.get("name"), "id": a.get("id"),
                         "multiple": "multiple" in a, "options": []}
            self._f["fields"].append(self._sel)
        elif tag == "option" and self._sel is not None:
            self._opt = {"value": a.get("value"), "text": "", "selected": "selected" in a}
            self._sel["options"].append(self._opt)
        elif tag == "textarea":
            self._f["fields"].append({"kind": "textarea", "name": a.get("name"), "value": ""})
        elif tag == "button":
            self._f["fields"].append({"kind": "button", "type": (a.get("type") or "submit").lower(),
                                      "name": a.get("name"), "value": a.get("value", "")})

    def handle_endtag(self, tag):
        if tag == "form":
            self._f = None
        elif tag == "select":
            self._sel = None
        elif tag == "option":
            self._opt = None

    def handle_data(self, data):
        if self._opt is not None:
            self._opt["text"] += data


def parse_forms(html_text):
    p = FormParser()
    p.feed(html_text)
    p.close()
    for f in p.forms:
        for fld in f["fields"]:
            for o in fld.get("options", []):
                o["text"] = " ".join(o["text"].split())
                if o["value"] is None:
                    o["value"] = o["text"]
    return p.forms


def is_lrp_name(name):
    """An LRP file, not LGM or DRP (both sit in the same folders)."""
    n = name.lower()
    if "lgm" in n or "drp" in n:
        return False
    return "lrp" in n


def daily_date(name):
    m = re.search(r"daily[_-]?(\d{8})", name, re.I)
    return m.group(1) if m else None


def pick_lrp_files(urls, recent):
    """From one year folder's LRP files: every non-daily file (YTD, layout,
    monthly), and of the daily ones the first and last, plus the middle one
    when `recent`. Sorted, no repeats."""
    lrp = sorted({u for u in urls if is_lrp_name(u.rsplit("/", 1)[-1])})
    daily = sorted((daily_date(u.rsplit("/", 1)[-1]), u) for u in lrp if daily_date(u.rsplit("/", 1)[-1]))
    other = [u for u in lrp if not daily_date(u.rsplit("/", 1)[-1])]
    pick = []
    if daily:
        idx = {0, len(daily) - 1}
        if recent:
            idx.add(len(daily) // 2)
        pick = [daily[i][1] for i in sorted(idx)]
    return other + pick


def year_folders(links, base):
    ys = set()
    for l in links:
        u = l["url"]
        if not u.startswith(base):
            continue
        m = re.match(r"(\d{4})/?(index\.html)?$", u[len(base):])
        if m:
            ys.add(int(m.group(1)))
    return sorted(ys)


def recent_weekdays(today, n):
    out, d = [], today
    while len(out) < n:
        d -= timedelta(days=1)
        if d.weekday() < 5:
            out.append(d)
    return out


def fill_form(form, commodity_value, when):
    """A best-guess submission of the LRP criteria form: hidden fields as
    served, the commodity select set to `commodity_value`, any date field to
    `when` (M/D/YYYY, as RMA's apps take it), other selects at their selected
    or first non-empty option, one submit control."""
    data = []
    submitted = False
    for f in form["fields"]:
        name = f.get("name")
        if not name:
            continue
        kind, ftype = f["kind"], f.get("type", "")
        lname = name.lower()
        if kind == "input" and ftype in ("hidden",):
            data.append((name, f.get("value", "")))
        elif kind == "input" and ftype in ("checkbox", "radio"):
            if f.get("checked"):
                data.append((name, f.get("value", "on")))
        elif kind == "input" and ftype in ("submit", "image") or kind == "button":
            if not submitted:
                data.append((name, f.get("value", "")))
                submitted = True
        elif kind == "input":
            if "date" in lname or ftype == "date":
                data.append((name, when.strftime("%Y-%m-%d") if ftype == "date"
                             else f"{when.month}/{when.day}/{when.year}"))
            else:
                data.append((name, f.get("value", "")))
        elif kind == "select":
            opts = [o for o in f["options"] if (o["value"] or "").strip()]
            if "commod" in lname and commodity_value is not None:
                val = commodity_value
            elif "date" in lname and opts:
                want = {f"{when.month}/{when.day}/{when.year}", when.strftime("%m/%d/%Y"),
                        when.strftime("%Y-%m-%d"), when.strftime("%Y%m%d")}
                hit = [o for o in opts if (o["value"] in want or o["text"] in want)]
                val = (hit or opts)[0]["value"]
            else:
                sel = [o for o in f["options"] if o["selected"]]
                val = (sel or opts or [{"value": ""}])[0]["value"]
            data.append((name, val))
        elif kind == "textarea":
            data.append((name, f.get("value", "")))
    return data


def commodity_select(form):
    for f in form["fields"]:
        if f["kind"] == "select" and f.get("name") and "commod" in f["name"].lower():
            return f
    return None


# ---------------------------------------------------------------- network

class Probe:
    def __init__(self, out):
        self.out = out
        self.used = 0
        self.manifest = {"started": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                         "requests": [], "notes": []}

    def get(self, url, data=None, method=None, keep_cap=FILE_CAP, tries=3):
        """Returns (status, headers dict, bytes or None). Never raises."""
        body = None
        if data is not None:
            body = urllib.parse.urlencode(data).encode()
        rec = {"url": url, "method": method or ("POST" if body else "GET")}
        if body:
            rec["form"] = data
        for attempt in range(tries):
            try:
                req = urllib.request.Request(url, data=body, method=rec["method"],
                                             headers={"User-Agent": UA, "Accept": "*/*"})
                with urllib.request.urlopen(req, timeout=90) as r:
                    raw = r.read(keep_cap + 1)
                    truncated = len(raw) > keep_cap
                    if truncated:
                        raw = raw[:keep_cap]
                    rec.update(status=r.status, final_url=r.geturl(),
                               type=r.headers.get("Content-Type"),
                               length=r.headers.get("Content-Length"),
                               read=len(raw), truncated=truncated)
                    self.manifest["requests"].append(rec)
                    log(f"  {r.status} {len(raw):>9} {url}")
                    return r.status, dict(r.headers), raw
            except urllib.error.HTTPError as e:
                rec.update(status=e.code, error=str(e))
                if e.code in (400, 401, 403, 404, 405, 410):
                    break
            except Exception as e:  # noqa: BLE001 - a probe records every failure
                rec.update(status=None, error=f"{type(e).__name__}: {e}")
            time.sleep(3 * (attempt + 1))
        self.manifest["requests"].append(rec)
        log(f"  FAIL {rec.get('status')} {url} {rec.get('error', '')}")
        return rec.get("status"), {}, None

    def head_size(self, url):
        try:
            req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                n = r.headers.get("Content-Length")
                return int(n) if n and n.isdigit() else None
        except Exception:  # noqa: BLE001
            return None

    def save(self, rel, raw, gz=False):
        if raw is None:
            return None
        if gz:
            raw = gzip.compress(raw, 9, mtime=0)
            rel += ".gz"
        if self.used + len(raw) > PROBE_CAP:
            self.manifest["notes"].append(f"skipped {rel}: probe cap reached")
            log(f"  cap reached, not saving {rel}")
            return None
        path = os.path.join(self.out, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(raw)
        self.used += len(raw)
        return rel


def safe_name(url):
    tail = urllib.parse.urlparse(url).path.rstrip("/").rsplit("/", 1)[-1] or "index"
    return re.sub(r"[^A-Za-z0-9._-]", "_", tail)[:120]


def listing(p, url, rel):
    """Fetch a directory listing; save it gzipped and as a plain link list."""
    st, _, raw = p.get(url, keep_cap=PAGE_CAP * 4)
    if raw is None and not url.endswith("index.html"):
        st, _, raw = p.get(url + "index.html", keep_cap=PAGE_CAP * 4)
    if raw is None:
        return []
    p.save(rel + ".html", raw, gz=True)
    links = parse_links(raw.decode("utf-8", "replace"), url)
    p.save(rel + ".links.txt", "\n".join(f"{l['url']}\t{l['row']}" for l in links).encode())
    return links


# ---------------------------------------------------------------- probe parts

def probe_adm(p, this_year):
    log("ADM livestock folders")
    root = listing(p, ADM_LIVE, "adm_livestock/_root")
    years = year_folders(root, ADM_LIVE) or list(range(FIRST_YEAR, this_year + 2))
    p.manifest["adm_years"] = years
    found = {}
    for y in years:
        base = f"{ADM_LIVE}{y}/"
        links = listing(p, base, f"adm_livestock/{y}")
        urls = [l["url"] for l in links if l["url"].startswith(base)]
        lrp = [u for u in urls if is_lrp_name(u.rsplit("/", 1)[-1])]
        found[y] = {"files": len(urls), "lrp_files": len(lrp),
                    "lrp_examples": [u.rsplit("/", 1)[-1] for u in lrp[:3] + lrp[-3:]]}
        for u in pick_lrp_files(urls, recent=y >= this_year - 1):
            size = p.head_size(u)
            if size is not None and size > FILE_CAP:
                p.manifest["notes"].append(f"not downloaded (size {size}): {u}")
                continue
            _, _, raw = p.get(u)
            p.save(f"adm_livestock/files/{safe_name(u)}", raw)
    p.manifest["adm_lrp_by_year"] = found
    # In case LRP moved into the main ADM: the current year's listing only.
    for y in (this_year, this_year + 1):
        links = listing(p, f"{ADM_MAIN}{y}/", f"adm_main/{y}")
        hits = [l["url"] for l in links if is_lrp_name(l["url"]) or "livestock" in l["url"].lower()]
        p.manifest[f"adm_main_{y}_livestock_links"] = hits[:50]


def probe_sob(p, this_year):
    log("Summary of Business, livestock participation")
    links = listing(p, SOB, "sob/_root")
    urls = [l["url"] for l in links]
    lrp = sorted(u for u in urls if re.search(r"/lrp_?\d{4}\.zip$", u, re.I))
    p.manifest["sob_lrp_files"] = [u.rsplit("/", 1)[-1] for u in lrp]
    docs = [u for u in urls if re.search(r"lrp", u, re.I) and re.search(r"\.(pdf|docx?|txt)$", u, re.I)]
    picks = docs[:3]
    if lrp:
        # the latest full year and one early year: enough to read the layout and
        # see whether it changed. Sizes go in the manifest for all of them.
        full = [u for u in lrp if str(this_year) not in u]
        picks += [(full or lrp)[-1], lrp[0]]
    for u in lrp:
        p.manifest.setdefault("sob_sizes", {})[u.rsplit("/", 1)[-1]] = p.head_size(u)
    for u in dict.fromkeys(picks):
        size = p.head_size(u)
        if size is not None and size > FILE_CAP:
            p.manifest["notes"].append(f"not downloaded (size {size}): {u}")
            continue
        _, _, raw = p.get(u)
        p.save(f"sob/{safe_name(u)}", raw)


def probe_reports(p, today):
    log("Livestock Reports app")
    days = recent_weekdays(today, 3)
    tried = 0
    for base in REPORT_BASES:
        host = urllib.parse.urlparse(base).netloc.split(".")[0]
        for page in REPORT_PAGES:
            url = base + page
            st, hdr, raw = p.get(url, keep_cap=PAGE_CAP)
            if raw is None:
                continue
            text = raw.decode("utf-8", "replace")
            p.save(f"reports/{host}_{safe_name(url)}.html", raw, gz=True)
            links = parse_links(text, url)
            p.save(f"reports/{host}_{safe_name(url)}.links.txt",
                   "\n".join(f"{l['url']}\t{l['text']}" for l in links).encode())
            forms = parse_forms(text)
            p.save(f"reports/{host}_{safe_name(url)}.forms.json",
                   json.dumps(forms, indent=1).encode())
            for fi, form in enumerate(forms):
                cs = commodity_select(form)
                values = [o["value"] for o in cs["options"] if (o["value"] or "").strip()] if cs else [None]
                action = urllib.parse.urljoin(url, form["action"] or url)
                for cv in values[:4]:
                    for d in days:
                        if tried >= 24:
                            break
                        tried += 1
                        data = fill_form(form, cv, d)
                        if form["method"] == "post":
                            _, _, r = p.get(action, data=data, keep_cap=PAGE_CAP)
                        else:
                            q = action + ("&" if "?" in action else "?") + urllib.parse.urlencode(data)
                            _, _, r = p.get(q, keep_cap=PAGE_CAP)
                        tag = re.sub(r"[^A-Za-z0-9]", "", str(cv))[:20] or "none"
                        p.save(f"reports/submit/{host}_{safe_name(url)}_f{fi}_{tag}_{d:%Y%m%d}.html",
                               r, gz=True)


def probe_legacy(p):
    log("Legacy livestock pages")
    for url in LEGACY:
        _, _, raw = p.get(url, keep_cap=PAGE_CAP)
        if raw is None:
            continue
        p.save(f"legacy/{safe_name(url)}.html", raw, gz=True)
        links = parse_links(raw.decode("utf-8", "replace"), url)
        p.save(f"legacy/{safe_name(url)}.links.txt",
               "\n".join(f"{l['url']}\t{l['text']}" for l in links).encode())
        for l in links:
            u = l["url"]
            if is_lrp_name(u.rsplit("/", 1)[-1]) and re.search(r"\.(zip|txt|csv|xls|xlsx|pdf)$", u, re.I):
                p.manifest.setdefault("legacy_lrp_links", []).append(u)
    for u in list(dict.fromkeys(p.manifest.get("legacy_lrp_links", [])))[:4]:
        size = p.head_size(u)
        if size is not None and size > FILE_CAP // 4:
            continue
        _, _, r = p.get(u)
        p.save(f"legacy/files/{safe_name(u)}", r)


def run_probe(out):
    if os.path.isdir(out):
        for dp, _, fs in os.walk(out, topdown=False):
            for f in fs:
                os.remove(os.path.join(dp, f))
            os.rmdir(dp)
    os.makedirs(out, exist_ok=True)
    p = Probe(out)
    today = datetime.now(timezone.utc).date()
    for part in (lambda: probe_adm(p, today.year), lambda: probe_sob(p, today.year),
                 lambda: probe_reports(p, today), lambda: probe_legacy(p)):
        try:
            part()
        except Exception as e:  # noqa: BLE001 - keep going, say what broke
            p.manifest["notes"].append(f"part failed: {type(e).__name__}: {e}")
            log("PART FAILED", e)
    p.manifest["bytes_saved"] = p.used
    p.manifest["finished"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump(p.manifest, f, indent=1, sort_keys=True)
    ok = sum(1 for r in p.manifest["requests"] if r.get("status") == 200)
    log(f"probe: {ok} of {len(p.manifest['requests'])} requests answered 200; {p.used} bytes saved")
    return 0 if ok else 1


# ---------------------------------------------------------------- history
#
# THE HISTORY (the lrp-history branch, never deployed by Pages)
#   state.json                  every daily zip read: name -> listed size, plus run stats
#   offers/<RY>/<YYYYMMDD>.json one sales effective date: every offer, one state
#   aev/<RY>.json               actual ending values released in that reinsurance year
#   probe/                      the first probe's raw capture, kept for reference
#
# One offers file per day so a day, once written, is never rewritten (the
# branch grows by about 10 KB a day in git, not by a year file each day).
#
# WHAT IS CHECKED ON EVERY FILE (the run stops on the first two)
#   * Every state carries the same offers. RMA repeats each offer once per
#     state (37 to 50 of them); the history keeps one copy. Seen on single days
#     in every crop year 2014-2027 by the probe; asserted here on every day.
#   * Within one commodity, type, practice and length on one day there is one
#     end date, expected ending value, price adjustment factor and weight range,
#     and no coverage level twice with different numbers.
#   * Counted, not stopped: cost per cwt = coverage price x rate (to $0.001),
#     coverage price = expected ending value x level (to the cent), rows with a
#     Deleted Date (skipped), and actual ending values restated by a later file.

RATE_TAG = "A00630"
AEV_TAG = "A00620"
WORKERS = 8
MAX_FAIL_SHARE = 0.02
FIRST_ADM_RY = 2014
LAMB = "0804"
# In the backtest. Everything else (lamb, and types with too little history:
# feeder 820-823, fed cattle 821, swine 821) is labeled "too new to test".
BACKTEST_TYPES = {"0801": [str(t) for t in range(809, 820)], "0802": ["820"], "0815": ["997"]}
PRODUCT_NAMES = {"0801": "Feeder Cattle", "0802": "Fed Cattle", "0815": "Swine", "0804": "Lamb"}


class LrpCheckError(Exception):
    """A structural check failed: the history is not written for this file."""


def milli(s, scale=1000):
    """'324.534' -> 324534 exactly ('' -> None). Refuses a value that is not a
    whole number at this scale, so nothing is rounded silently."""
    s = (s or "").strip()
    if not s:
        return None
    d = Decimal(s) * scale
    if d != d.to_integral_value():
        raise LrpCheckError(f"{s} has more precision than 1/{scale}")
    return int(d)


def round_half_up(d, places):
    return d.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)


def read_zip_members(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        return {n: z.read(n).decode("utf-8-sig", "replace") for n in z.namelist() if not n.endswith("/")}


def split_pipe(text):
    lines = [l for l in text.splitlines() if l.strip()]
    if not lines:
        return [], []
    head = [h.strip() for h in lines[0].split("|")]
    rows = [l.split("|") for l in lines[1:]]
    for r in rows:
        if len(r) != len(head):
            raise LrpCheckError(f"a row has {len(r)} fields, the header {len(head)}")
    return head, rows


def same_in_every_state(head, rows, what, ident):
    """RMA repeats each row once per state that offers the product. A product
    need not be offered in every state (lamb was in some only), but a row that
    two states share must carry the same numbers in both. `ident` names the
    columns that say which offer a row is. Returns (one copy of each row, the
    states offering each commodity)."""
    si = head.index("State Code")
    ci = head.index("Commodity Code")
    ii = [head.index(n) for n in ident if n in head]
    seen = {}
    keep = []
    states = collections.defaultdict(set)
    for r in rows:
        states[r[ci]].add(r[si])
        k = tuple(r[i] for i in ii)
        body = tuple(r[:si] + r[si + 1:])
        prev = seen.get(k)
        if prev is None:
            seen[k] = (body, r[si])
            keep.append(r)
        elif prev[0] != body:
            raise LrpCheckError(f"{what}: {'/'.join(k)} differs between states {prev[1]} and {r[si]}")
    return keep, {c: sorted(v) for c, v in sorted(states.items())}


def reduce_rates(text, ry):
    """One A00630 file -> ({sales date: day}, stats)."""
    head, rows = split_pipe(text)
    if not rows:
        return {}, {"rows": 0}
    c = {h: i for i, h in enumerate(head)}
    need = ["Commodity Code", "Type Code", "Practice Code", "Sales Effective Date", "Endorsement Length Count",
            "Coverage Price", "Expected Ending Value Amount", "Livestock Coverage Level Percent",
            "Livestock Rate", "Cost Per Cwt Amount", "End Date", "Deleted Date", "State Code"]
    miss = [n for n in need if n not in c]
    if miss:
        raise LrpCheckError(f"rate file has no {miss}")
    deleted = sum(1 for r in rows if r[c["Deleted Date"]].strip())
    rows = [r for r in rows if not r[c["Deleted Date"]].strip()]
    rows, nstates = same_in_every_state(head, rows, "offers", [
        "Sales Effective Date", "Commodity Code", "Type Code", "Practice Code", "Endorsement Length Count",
        "Livestock Coverage Level Percent"])
    get = lambda r, n: r[c[n]].strip() if n in c else ""  # noqa: E731
    days = {}
    st = {"rows": len(rows), "deleted": deleted, "cost_off": 0, "price_off": 0}
    for r in rows:
        sed = get(r, "Sales Effective Date")
        day = days.setdefault(sed, {"sed": sed, "ry": ry, "o": {}, "states": nstates})
        key = "/".join([get(r, "Commodity Code"), get(r, "Type Code"), get(r, "Practice Code"),
                        str(int(get(r, "Endorsement Length Count")))])
        head_vals = {"end": get(r, "End Date"), "eev": milli(get(r, "Expected Ending Value Amount")),
                     "paf": get(r, "Price Adjustment Factor") or None,
                     "w": [get(r, "Target Low Weight"), get(r, "Target High Weight")],
                     "ct": get(r, "Commodity Type Code"), "cl": get(r, "Class Code")}
        e = day["o"].get(key)
        if e is None:
            e = day["o"][key] = dict(head_vals, r=[])
        elif any(e[k] != v for k, v in head_vals.items()):
            raise LrpCheckError(f"offers {sed} {key}: two end dates, values or factors on one day")
        cp, lvl = get(r, "Coverage Price"), get(r, "Livestock Coverage Level Percent")
        rate, cost = get(r, "Livestock Rate"), get(r, "Cost Per Cwt Amount")
        row = [milli(lvl, 10 ** 6), milli(cp), milli(rate, 10 ** 6), milli(cost)]
        e["r"].append(row)
        if round_half_up(Decimal(cp) * Decimal(rate), 3) != Decimal(cost):
            st["cost_off"] += 1
        if round_half_up(Decimal(get(r, "Expected Ending Value Amount")) * Decimal(lvl), 2) != Decimal(cp):
            st["price_off"] += 1
    for day in days.values():
        for key, e in day["o"].items():
            e["r"].sort()
            seen = {}
            uniq = []
            for row in e["r"]:
                prev = seen.get(row[0])
                if prev is None:
                    seen[row[0]] = row
                    uniq.append(row)
                elif prev != row:
                    raise LrpCheckError(f"offers {day['sed']} {key}: level {row[0]} twice, different numbers")
            e["r"] = uniq
    return days, st


def reduce_aev(text):
    """One A00620 file -> ({'comm/type/end': {sales date: value}}, released date, stats)."""
    head, rows = split_pipe(text)
    if not rows:
        return {}, None, {"rows": 0}
    c = {h: i for i, h in enumerate(head)}
    deleted = sum(1 for r in rows if r[c["Deleted Date"]].strip())
    rows = [r for r in rows if not r[c["Deleted Date"]].strip()]
    rows, nstates = same_in_every_state(head, rows, "actual ending values", [
        "Commodity Code", "Type Code", "Practice Code", "End Date", "Sales Effective Date"])
    out = {}
    released = set()
    for r in rows:
        g = lambda n: r[c[n]].strip()  # noqa: E731
        key = f"{g('Commodity Code')}/{g('Type Code')}/{g('End Date')}"
        sed = (g("Sales Effective Date") if "Sales Effective Date" in c else "") or "*"
        v = milli(g("Actual Ending Value Amount"))
        d = out.setdefault(key, {})
        if d.get(sed, v) != v:
            raise LrpCheckError(f"aev {key} {sed}: two values in one file")
        d[sed] = v
        released.add(g("Released Date"))
    return out, max(released) if released else None, {"rows": len(rows), "deleted": deleted}


def merge_aev(store, new, stats):
    """store: {'comm/type/end': {sales date: value}}. A later file's value wins
    and the change is counted."""
    for key, d in new.items():
        s = store.setdefault(key, {})
        for sed, v in d.items():
            if sed in s and s[sed] != v:
                stats["aev_restated"] = stats.get("aev_restated", 0) + 1
            s[sed] = v


def compact_aev(store):
    """Lossless and small: each value once, with the sales dates it holds for
    ("*" when RMA's file names no sales date). Nearly every key has one value."""
    out = {}
    for key in sorted(store):
        inv = {}
        for sed, v in store[key].items():
            inv.setdefault(str(v), []).append(sed)
        out[key] = {v: sorted(seds) for v, seds in sorted(inv.items())}
    return out


def expand_aev(compact):
    return {k: {sed: int(v) for v, seds in inv.items() for sed in seds} for k, inv in compact.items()}


def aev_value(inv):
    """The one value of a compact entry, or None when sales dates disagree."""
    return int(next(iter(inv))) if len(inv) == 1 else None


def listed_size(row_text, name):
    m = re.search(r"(\d+)\s+" + re.escape(name) + r"\s*$", row_text or "")
    return int(m.group(1)) if m else None


def adm_files(links, base):
    """[(name, url, listed size)] for the LRP daily zips in one year folder."""
    out = []
    for l in links:
        u = l["url"]
        name = u.rsplit("/", 1)[-1]
        if u.startswith(base) and is_lrp_name(name) and daily_date(name) and name.lower().endswith(".zip"):
            out.append((name, u, listed_size(l["row"], name)))
    return sorted(set(out))


def http_get(url, tries=4, timeout=120):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (403, 404, 410):
                break
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(4 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def write_json(path, obj, pretty=False):
    text = json.dumps(obj, sort_keys=True, indent=1 if pretty else None,
                      separators=None if pretty else (",", ":")) + "\n"
    return write_if_changed(path, text)


def write_if_changed(path, text):
    try:
        with open(path, encoding="utf-8") as f:
            if f.read() == text:
                return False
    except FileNotFoundError:
        pass
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)
    return True


class History:
    def __init__(self, root):
        self.root = root
        self.state = load_json(os.path.join(root, "state.json"), {"files": {}, "stats": {}})
        self.aev = {}          # ry -> expanded store
        self.dirty_aev = set()

    def aev_store(self, ry):
        if ry not in self.aev:
            self.aev[ry] = expand_aev(load_json(os.path.join(self.root, "aev", f"{ry}.json"), {}))
        return self.aev[ry]

    def apply(self, name, raw):
        """Parse one daily zip and write what it holds. Raises LrpCheckError."""
        ry = name[:4]
        st = self.state["stats"]
        for member, text in sorted(read_zip_members(raw).items()):
            if RATE_TAG in member:
                days, s = reduce_rates(text, ry)
                for sed, day in days.items():
                    day["src"] = name
                    path = os.path.join(self.root, "offers", ry, f"{sed}.json")
                    if os.path.exists(path):
                        old = load_json(path, {})
                        if old.get("o") != day["o"]:
                            st["offers_restated"] = st.get("offers_restated", 0) + 1
                    write_json(path, day)
                for k in ("rows", "deleted", "cost_off", "price_off"):
                    st["rate_" + k] = st.get("rate_" + k, 0) + s.get(k, 0)
                st["offer_days_written"] = st.get("offer_days_written", 0) + len(days)
            elif AEV_TAG in member:
                new, _, s = reduce_aev(text)
                merge_aev(self.aev_store(ry), new, st)
                self.dirty_aev.add(ry)
                for k in ("rows", "deleted"):
                    st["aev_" + k] = st.get("aev_" + k, 0) + s.get(k, 0)
            else:
                st.setdefault("other_members", [])
                if member not in st["other_members"] and len(st["other_members"]) < 50:
                    st["other_members"].append(member)

    def save(self):
        for ry in sorted(self.dirty_aev):
            write_json(os.path.join(self.root, "aev", f"{ry}.json"), compact_aev(self.aev[ry]))
        self.dirty_aev.clear()
        self.state["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        write_json(os.path.join(self.root, "state.json"), self.state, pretty=True)


def parse_years(spec, have):
    if not spec:
        return have
    lo, _, hi = spec.partition("-")
    lo, hi = int(lo), int(hi or lo)
    return [y for y in have if lo <= y <= hi]


def run_history(root, years_spec=None, minutes=300, max_files=None):
    """Read every LRP daily zip not yet in the history (or listed at a new
    size), oldest first. Stops starting new downloads after `minutes` and saves:
    run it again and it carries on."""
    t0 = time.time()
    h = History(root)
    st = h.state["stats"]
    st.pop("last_run", None)
    p = Probe("/nonexistent")       # only its listing parser and HTTP; nothing saved
    _, _, raw = p.get(ADM_LIVE, keep_cap=8 * 1024 * 1024)
    if raw is None:
        log("the ADM livestock folder did not answer")
        return 1
    years = year_folders(parse_links(raw.decode("utf-8", "replace"), ADM_LIVE), ADM_LIVE)
    years = parse_years(years_spec, years)
    todo = []
    for y in years:
        base = f"{ADM_LIVE}{y}/"
        _, _, raw = p.get(base, keep_cap=8 * 1024 * 1024)
        if raw is None:
            log(f"year {y}: listing failed")
            st["listing_failed"] = sorted(set(st.get("listing_failed", [])) | {y})
            continue
        files = adm_files(parse_links(raw.decode("utf-8", "replace"), base), base)
        for name, url, size in files:
            if h.state["files"].get(name) != size or size is None:
                todo.append((daily_date(name), name, url, size))
        log(f"year {y}: {len(files)} LRP daily files")
    # Process in date order (and rate files before the AEVs that follow them
    # does not matter: each lands in its own place).
    todo.sort()
    if max_files:
        todo = todo[:max_files]
    log(f"{len(todo)} files to read")
    done = failed = 0
    stopped = False
    with concurrent.futures.ThreadPoolExecutor(WORKERS) as ex:
        it = iter(todo)
        running = {}

        def launch():
            nonlocal stopped
            while len(running) < WORKERS * 2:
                if time.time() - t0 > minutes * 60:
                    stopped = True
                    return
                nxt = next(it, None)
                if nxt is None:
                    return
                running[ex.submit(http_get, nxt[2])] = nxt
        launch()
        # Results are applied in the order they were listed, so a restated
        # file always lands after the one it restates.
        pending = {}
        order = [t[1] for t in todo]
        pos = 0
        while running or pending:
            if running:
                fin, _ = concurrent.futures.wait(list(running), return_when=concurrent.futures.FIRST_COMPLETED)
                for f in fin:
                    item = running.pop(f)
                    try:
                        pending[item[1]] = (item, f.result())
                    except Exception as e:  # noqa: BLE001
                        pending[item[1]] = (item, e)
                launch()
            while pos < len(order) and order[pos] in pending:
                (sd, name, url, size), res = pending.pop(order[pos])
                pos += 1
                if isinstance(res, Exception):
                    failed += 1
                    log(f"  FAILED {name}: {res}")
                    continue
                try:
                    h.apply(name, res)
                except LrpCheckError as e:
                    h.save()
                    log(f"CHECK FAILED in {name}: {e}")
                    st["stopped_on"] = f"{name}: {e}"
                    h.save()
                    return 3
                h.state["files"][name] = size if size is not None else len(res)
                done += 1
                if done % 100 == 0:
                    h.save()
                    log(f"  {done} read, {failed} failed, {int(time.time() - t0)} s")
            if not running and pos < len(order) and order[pos] not in pending:
                break   # stopped launching (time limit); the rest waits for the next run
    st["last_run"] = {"read": done, "failed": failed, "left": len(todo) - done - failed,
                      "stopped_for_time": stopped, "seconds": int(time.time() - t0)}
    h.save()
    log(f"history: {done} read, {failed} failed, {len(todo) - done - failed} left")
    if todo and failed > max(3, MAX_FAIL_SHARE * len(todo)):
        return 1
    return 0


# ---------------------------------------------------------------- publish

def latest_offer_day(root):
    best = None
    od = os.path.join(root, "offers")
    if not os.path.isdir(od):
        return None
    for ry in os.listdir(od):
        for f in os.listdir(os.path.join(od, ry)):
            if f.endswith(".json"):
                key = (f[:8], ry)
                if best is None or key > best:
                    best = key
    return best


def in_backtest(comm, typ):
    return typ in BACKTEST_TYPES.get(comm, [])


def build_today(day):
    """The newest day's offers, one row per commodity, type and length."""
    out = {"sed": day["sed"], "ry": day["ry"], "fields": ["level_e6", "coverage_price_milli", "rate_e6",
                                                           "cost_per_cwt_milli"], "offers": []}
    for key in sorted(day["o"]):
        comm, typ, prac, length = key.split("/")
        if comm == LAMB:
            continue
        e = day["o"][key]
        out["offers"].append({"c": comm, "t": typ, "p": prac, "len": int(length), "end": e["end"],
                              "eev": e["eev"], "paf": e["paf"], "w": e["w"], "r": e["r"],
                              "tested": in_backtest(comm, typ)})
    return out


def build_aev(root):
    """Every actual ending value for the backtest types, kept per reinsurance
    year: RMA reuses type codes, and a code can mean another class or factor
    the next year (RY2027 type 815 settles at 370.40 where RY2026 type 815
    settles at 168.37 for the same end date). An offer settles only against
    the AEV of its own reinsurance year. Per year and commodity: one end-date
    list and one value array per type (null where none)."""
    res = {"units": "dollars per cwt x 1000", "ry": {}}
    odd = {}
    ad = os.path.join(root, "aev")
    for f in sorted(os.listdir(ad)) if os.path.isdir(ad) else []:
        ry = f[:4]
        out = {}
        for key, d in expand_aev(load_json(os.path.join(ad, f), {})).items():
            comm, typ, end = key.split("/")
            if not in_backtest(comm, typ):
                continue
            vals = set(d.values())
            if len(vals) != 1:
                odd[f"{ry}/{key}"] = d
                continue
            out.setdefault(comm, {}).setdefault(typ, {})[end] = vals.pop()
        for comm, types in sorted(out.items()):
            ends = sorted({e for t in types.values() for e in t})
            res["ry"].setdefault(ry, {})[comm] = {"ends": ends,
                                                   "t": {t: [types[t].get(e) for e in ends] for t in sorted(types)}}
    if odd:
        res["by_sales_date"] = odd
    return res


def type_book(root):
    """What each type code meant in each reinsurance year, from its first
    offer day: commodity type, class, price adjustment factor, weight range."""
    book = {}
    od = os.path.join(root, "offers")
    for ry in sorted(os.listdir(od)):
        for f in sorted(os.listdir(os.path.join(od, ry))):
            day = load_json(os.path.join(od, ry, f), {})
            for key, e in day.get("o", {}).items():
                comm, typ = key.split("/")[:2]
                k = f"{comm}/{typ}"
                b = book.setdefault(ry, {})
                if k not in b:
                    b[k] = {"ct": e["ct"], "cl": e["cl"], "paf": e["paf"], "w": e["w"], "first": day["sed"]}
                elif any(b[k][x] != e[x] for x in ("ct", "cl", "paf", "w")):
                    b[k].setdefault("changed", day["sed"])
    return book


def run_publish(root, out):
    last = latest_offer_day(root)
    if last is None:
        log("no offers in the history yet")
        return 1
    sed, ry = last
    day = load_json(os.path.join(root, "offers", ry, f"{sed}.json"), None)
    today = build_today(day)
    aev = build_aev(root)
    state = load_json(os.path.join(root, "state.json"), {"files": {}, "stats": {}})
    days_by_ry = {ry_: len(os.listdir(os.path.join(root, "offers", ry_)))
                  for ry_ in sorted(os.listdir(os.path.join(root, "offers")))}
    first = min(f[:8] for ry_ in days_by_ry for f in os.listdir(os.path.join(root, "offers", ry_)))
    meta = {"v": 1, "source": ADM_LIVE, "first_sales_date": first, "last_sales_date": sed,
            "offer_days_by_reinsurance_year": days_by_ry,
            "aev_end_dates": {ry: {c: [v["ends"][0], v["ends"][-1], len(v["ends"])] for c, v in cs.items()}
                              for ry, cs in aev["ry"].items()},
            "types_by_reinsurance_year": type_book(root),
            "products": PRODUCT_NAMES, "backtest_types": BACKTEST_TYPES,
            "checks": {k: v for k, v in state.get("stats", {}).items() if k != "other_members"},
            "files_read": len(state.get("files", {}))}
    changed = [p for p, o in (("today.json", today), ("aev.json", aev), ("meta.json", meta))
               if write_json(os.path.join(out, p), o, pretty=(p == "meta.json"))]
    log(f"publish: latest sales date {sed}; changed {changed or 'nothing'}")
    return 0


# ---------------------------------------------------------------- selftest

def selftest():
    listing_html = """<html><body><h1>Directory Tree - pub/References/adm_livestock/2018/</h1>
    <table><tr><td><a href="../index.html">Parent</a></td></tr>
    <tr><td><a href="2018_ADMLivestockLgm_Daily_20170728.zip">2018_ADMLivestockLgm_Daily_20170728.zip</a></td><td>12 KB</td></tr>
    <tr><td><a href="2018_ADMLivestockLrp_Daily_20170703.zip">2018_ADMLivestockLrp_Daily_20170703.zip</a></td><td>02/10/2025</td><td>18 KB</td></tr>
    <tr><td><a href="2018_ADMLivestockLrp_Daily_20171229.zip">x</a></td><td>19 KB</td></tr>
    <tr><td><a href="2018_ADMLivestockLrp_Daily_20170915.zip">x</a></td></tr>
    <tr><td><a href="2018_ADMLivestockLrp_YTD.zip">x</a></td></tr>
    <tr><td><a href="2019_A00833_ADMDrpDailyPrice_Daily_20231006.zip">x</a></td></tr>
    </table></body></html>"""
    base = ADM_LIVE + "2018/"
    links = parse_links(listing_html, base)
    assert links[0]["url"] == ADM_LIVE + "index.html", links[0]
    lrp_row = [l for l in links if l["url"].endswith("Lrp_Daily_20170703.zip")][0]
    assert "18 KB" in lrp_row["row"] and "02/10/2025" in lrp_row["row"], lrp_row
    urls = [l["url"] for l in links]
    picks = pick_lrp_files(urls, recent=False)
    names = [u.rsplit("/", 1)[-1] for u in picks]
    assert names == ["2018_ADMLivestockLrp_YTD.zip", "2018_ADMLivestockLrp_Daily_20170703.zip",
                     "2018_ADMLivestockLrp_Daily_20171229.zip"], names
    picks = pick_lrp_files(urls, recent=True)
    assert len(picks) == 4 and picks[2].endswith("20170915.zip"), picks
    assert not is_lrp_name("2018_ADMLivestockLgm_Daily_20170728.zip")
    assert not is_lrp_name("2024_ADMDrpDailyPrice_Daily_20231006.zip")
    assert is_lrp_name("lrp_2024.zip") and daily_date("x_Daily_20240102.zip") == "20240102"

    root_html = '<a href="2016/index.html">2016</a><a href="2017/">2017</a><a href="README.txt">r</a>' \
                '<a href="https://elsewhere.gov/2019/">no</a>'
    assert year_folders(parse_links(root_html, ADM_LIVE), ADM_LIVE) == [2016, 2017]

    form_html = """<form method="post" action="./LRPReport" id="f1">
      <input type="hidden" name="__VIEWSTATE" value="abc">
      <select name="ddlCommodity"><option value="">Select</option>
        <option value="0801">Feeder Cattle</option><option value="0802">Fed Cattle</option>
        <option value="0815">Swine</option></select>
      <select name="ddlState"><option value="">All</option><option value="31" selected>Nebraska</option></select>
      <input type="text" name="txtEffectiveDate" value="">
      <input type="checkbox" name="chkAll" value="y">
      <input type="submit" name="btnSubmit" value="Submit"><input type="submit" name="btnReset" value="Reset">
    </form>"""
    forms = parse_forms(form_html)
    assert len(forms) == 1 and forms[0]["method"] == "post"
    cs = commodity_select(forms[0])
    assert [o["text"] for o in cs["options"]][1:] == ["Feeder Cattle", "Fed Cattle", "Swine"]
    data = dict(fill_form(forms[0], "0815", date(2026, 10, 9)))
    assert data == {"__VIEWSTATE": "abc", "ddlCommodity": "0815", "ddlState": "31",
                    "txtEffectiveDate": "10/9/2026", "btnSubmit": "Submit"}, data

    assert recent_weekdays(date(2026, 10, 12), 3) == [date(2026, 10, 9), date(2026, 10, 8), date(2026, 10, 7)]
    assert safe_name("https://x.gov/a/b/LRPReport?x=1") == "LRPReport"

    # the cap: a save past PROBE_CAP is refused and noted, not written
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        p = Probe(td)
        p.used = PROBE_CAP - 10
        assert p.save("a.bin", b"x" * 11) is None and p.manifest["notes"]
        assert p.save("b.bin", b"x" * 10) == "b.bin" and p.used == PROBE_CAP
    selftest_history()
    print("fetch_lrp selftest: ok")
    return 0


FIXTURES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "test", "fixtures", "lrp")


def fixture(name):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as f:
        return f.read()


def zip_of(members):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for n, t in members.items():
            z.writestr(n, t)
    return buf.getvalue()


def expect_check_error(fn, words):
    try:
        fn()
    except LrpCheckError as e:
        assert words in str(e), e
        return
    raise AssertionError(f"no check error ({words})")


def selftest_history():
    """Against real rows cut from RMA's files (test/fixtures/lrp/, from the
    probe of 2026-10-15)."""
    import tempfile
    assert milli("324.534") == 324534 and milli("0.003367", 10 ** 6) == 3367 and milli("") is None
    expect_check_error(lambda: milli("1.2345"), "precision")

    # CY2027 offers: two states, one copy kept; every number exact.
    r27 = fixture("2027_A00630_LrpRate_Daily_20260701.txt")
    days, st = reduce_rates(r27, "2027")
    assert list(days) == ["20260701"] and st["rows"] == 15 and st["cost_off"] == 0, st
    day = days["20260701"]
    assert day["states"] == {"0801": ["31", "48"], "0802": ["31", "48"], "0815": ["31", "48"]}, day["states"]
    e = day["o"]["0801/809/206/52"]
    assert e["end"] == "20270630" and e["eev"] == 376646 and e["paf"] == "1.10", e
    assert e["r"] == [[750000, 282480, 12282, 3469], [950000, 357810, 55261, 19773],
                      [1000000, 376650, 76116, 28669]], e["r"]
    assert sorted(day["o"]) == ["0801/809/206/52", "0801/809/209/13", "0801/823/209/13",
                                "0802/820/209/13", "0815/997/209/13"], sorted(day["o"])
    # A state that disagrees stops the file.
    bad = r27.replace("|48|998|809|206|20260701|52|282.480|", "|48|998|809|206|20260701|52|282.490|", 1)
    assert bad != r27
    expect_check_error(lambda: reduce_rates(bad, "2027"), "differs between states")
    # Two numbers for one level on one day stops it too.
    lines = r27.splitlines()
    dup = [l for l in lines if "|31|998|809|206|20260701|52|282.480|" in l][0].replace("|282.480|", "|282.470|")
    expect_check_error(lambda: reduce_rates("\n".join(lines + [dup]), "2027"), "differs between states 31 and 31")

    # CY2014 offers: the old layout (no factor, levels set by coverage price);
    # lamb offered in Arizona only is fine, and is kept with its state list.
    days, st = reduce_rates(fixture("2014_A00630_LrpRate_Daily_20130701.txt"), "2014")
    d = days["20130701"]
    assert d["states"] == {"0801": ["01", "04"], "0804": ["04"]}, d["states"]
    e = d["o"]["0801/809/997/13"]
    assert e["paf"] is None and e["eev"] == 169019 and [x[1] for x in e["r"]] == [157080, 161480, 163680], e
    assert st["cost_off"] == 0 and st["price_off"] == 2, st   # old levels are rounded from the price

    # Actual ending values: one per end date, except the per-head type 823,
    # whose value depends on the sales date.
    new, rel, st = reduce_aev(fixture("2026_A00620_LrpActualEndingValue_Daily_20261015.txt"))
    assert rel == "20261015" and st["rows"] == 6, st
    c = compact_aev(new)
    assert c["0801/809/20261007"] == {"370400": ["20251008", "20251112", "20260107", "20260408"]}, c
    assert c["0801/823/20261007"] == {"1340190": ["20260107"], "1417630": ["20260408"]}, c
    assert aev_value(c["0801/809/20261007"]) == 370400 and aev_value(c["0801/823/20261007"]) is None
    assert expand_aev(c) == new
    # The older layout has no sales date and repeats the value per interval.
    new21, _, _ = reduce_aev(fixture("2021_A00620_LrpActualEndingValue_Daily_20220704.txt"))
    assert compact_aev(new21) == {"0815/821/20220629": {"110840": ["*"]},
                                  "0815/997/20220629": {"110840": ["*"]}}, compact_aev(new21)
    # A later file that restates a value wins, and is counted.
    store, stats = {}, {}
    merge_aev(store, {"0801/809/20261007": {"*": 1}}, stats)
    merge_aev(store, {"0801/809/20261007": {"*": 2}}, stats)
    assert store["0801/809/20261007"]["*"] == 2 and stats["aev_restated"] == 1

    # Listing rows as RMA's folder prints them.
    row = "03/01/2025 08:35 AM 77756 2025_ADMLivestockLrp_Daily_20250301.zip"
    assert listed_size(row, "2025_ADMLivestockLrp_Daily_20250301.zip") == 77756
    base = ADM_LIVE + "2025/"
    links = [{"url": base + "2025_ADMLivestockLrp_Daily_20250301.zip", "row": row},
             {"url": base + "2025_A00831_ADMDrpDraw_Quarterly_20240624.zip", "row": "x 1 y"},
             {"url": base + "2025_ADMLivestockLgm_Daily_20250301.zip", "row": "x"}]
    assert adm_files(links, base) == [("2025_ADMLivestockLrp_Daily_20250301.zip", links[0]["url"], 77756)]
    assert parse_years("2015-2016", [2014, 2015, 2016, 2017]) == [2015, 2016]
    assert parse_years("2017", [2014, 2017]) == [2017] and parse_years(None, [1]) == [1]

    # End to end: zips into a history, then the published files.
    with tempfile.TemporaryDirectory() as td:
        hist, out = os.path.join(td, "h"), os.path.join(td, "out")
        h = History(hist)
        h.apply("2014_ADMLivestockLrp_Daily_20130701.zip",
                zip_of({"2014_A00630_LrpRate_Daily_20130701.txt": fixture("2014_A00630_LrpRate_Daily_20130701.txt")}))
        h.apply("2027_ADMLivestockLrp_Daily_20260701.zip", zip_of({"2027_A00630_LrpRate_Daily_20260701.txt": r27}))
        h.apply("2026_ADMLivestockLrp_Daily_20261015.zip",
                zip_of({"2026_A00620_LrpActualEndingValue_Daily_20261015.txt":
                        fixture("2026_A00620_LrpActualEndingValue_Daily_20261015.txt")}))
        h.save()
        assert os.path.exists(os.path.join(hist, "offers", "2027", "20260701.json"))
        assert aev_value(load_json(os.path.join(hist, "aev", "2026.json"), {})["0801/809/20261007"]) == 370400
        # The same file again changes nothing and restates nothing.
        h.apply("2027_ADMLivestockLrp_Daily_20260701.zip", zip_of({"x_A00630_y.txt": r27}))
        assert "offers_restated" not in h.state["stats"]
        assert run_publish(hist, out) == 0
        today = load_json(os.path.join(out, "today.json"), {})
        assert today["sed"] == "20260701" and today["ry"] == "2027"
        tested = {(o["c"], o["t"]): o["tested"] for o in today["offers"]}
        assert tested == {("0801", "809"): True, ("0801", "823"): False, ("0802", "820"): True,
                          ("0815", "997"): True}, tested
        aev = load_json(os.path.join(out, "aev.json"), {})
        assert aev["ry"]["2026"]["0801"] == {"ends": ["20261007"], "t": {"809": [370400]}}, aev
        assert "0801/823" not in json.dumps(aev["ry"]) and "by_sales_date" not in aev   # 823 is not tested
        meta = load_json(os.path.join(out, "meta.json"), {})
        assert meta["first_sales_date"] == "20130701" and meta["last_sales_date"] == "20260701"
        assert meta["types_by_reinsurance_year"]["2027"]["0801/809"]["paf"] == "1.10"
        # Lamb stays in the history but never reaches the page.
        assert "0804" in json.dumps(load_json(os.path.join(hist, "offers", "2014", "20130701.json"), {}))
        assert '"0804"' not in json.dumps(today["offers"])

    selftest_run_history()


def selftest_run_history():
    """run_history against a fake RMA: what it reads, in what order, and what
    a second run, a re-listed file and a time limit do."""
    import tempfile
    files = {
        "2027_ADMLivestockLrp_Daily_20260701.zip":
            zip_of({"2027_A00630_LrpRate_Daily_20260701.txt": fixture("2027_A00630_LrpRate_Daily_20260701.txt")}),
        "2026_ADMLivestockLrp_Daily_20261015.zip":
            zip_of({"2026_A00620_LrpActualEndingValue_Daily_20261015.txt":
                    fixture("2026_A00620_LrpActualEndingValue_Daily_20261015.txt")}),
    }

    def listing_html(year):
        rows = "".join(f'<tr><td>01/01/2026 08:00 AM {len(b)} <a href="{n}">{n}</a></td></tr>'
                       for n, b in files.items() if n.startswith(year))
        return f"<table>{rows}</table>".encode()

    def fake_get(self, url, **kw):
        if url == ADM_LIVE:
            return 200, {}, b'<a href="2026/">2026</a><a href="2027/">2027</a>'
        return 200, {}, listing_html(url[len(ADM_LIVE):len(ADM_LIVE) + 4])

    fetched = []

    def fake_http(url, **kw):
        fetched.append(url.rsplit("/", 1)[-1])
        return files[url.rsplit("/", 1)[-1]]

    real_get, real_http = Probe.get, globals()["http_get"]
    Probe.get = fake_get
    globals()["http_get"] = fake_http
    try:
        with tempfile.TemporaryDirectory() as td:
            assert run_history(td, minutes=0) == 0 and fetched == []        # time limit: nothing started
            assert load_json(os.path.join(td, "state.json"), {})["stats"]["last_run"]["left"] == 2
            assert run_history(td) == 0
            assert sorted(fetched) == sorted(files), fetched
            st = load_json(os.path.join(td, "state.json"), {})
            assert st["files"] == {n: len(b) for n, b in files.items()}, st["files"]
            fetched.clear()
            assert run_history(td) == 0 and fetched == []                   # nothing new
            files["2026_ADMLivestockLrp_Daily_20261015.zip"] += b""          # same size: still nothing
            assert run_history(td, years_spec="2026") == 0 and fetched == []
            # RMA re-posts a file at a new size: it is read again.
            files["2026_ADMLivestockLrp_Daily_20261015.zip"] = zip_of({
                "2026_A00620_LrpActualEndingValue_Daily_20261015.txt":
                    fixture("2026_A00620_LrpActualEndingValue_Daily_20261015.txt").replace("|370.400|", "|1370.400|")})
            assert run_history(td) == 0 and fetched == ["2026_ADMLivestockLrp_Daily_20261015.zip"], fetched
            st = load_json(os.path.join(td, "state.json"), {})
            assert st["stats"]["aev_restated"] == 4, st["stats"]
            assert aev_value(load_json(os.path.join(td, "aev", "2026.json"), {})["0801/809/20261007"]) == 1370400
            # A file that fails a check stops the run, says where, and is not marked read.
            files["2027_ADMLivestockLrp_Daily_20260702.zip"] = zip_of({"x_A00630_y.txt": fixture(
                "2027_A00630_LrpRate_Daily_20260701.txt").replace(
                "|48|998|809|206|20260701|52|282.480|", "|48|998|809|206|20260701|52|282.490|")})
            assert run_history(td) == 3
            st = load_json(os.path.join(td, "state.json"), {})
            assert "2027_ADMLivestockLrp_Daily_20260702.zip" not in st["files"]
            assert "differs between states" in st["stats"]["stopped_on"]
    finally:
        Probe.get, globals()["http_get"] = real_get, real_http


def main():
    ap = argparse.ArgumentParser(description="RMA LRP data")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--out", default=PROBE_DIR)
    ap.add_argument("--history", metavar="DIR", help="read new ADM daily zips into this history checkout")
    ap.add_argument("--years", help="reinsurance years to read, e.g. 2014-2016 (default: all)")
    ap.add_argument("--minutes", type=int, default=300, help="stop starting downloads after this long")
    ap.add_argument("--max-files", type=int)
    ap.add_argument("--publish", metavar="DIR", help="write data/lrp/ from this history checkout")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.probe:
        return run_probe(a.out)
    if a.history:
        return run_history(a.history, a.years, a.minutes, a.max_files)
    if a.publish:
        return run_publish(a.publish, a.out if a.out != PROBE_DIR else PUBLISH_DIR)
    log("nothing to do: pass --history DIR, --publish DIR, --probe or --selftest")
    return 2


if __name__ == "__main__":
    sys.exit(main())
