#!/usr/bin/env python3
"""
fetch_lrp.py: USDA RMA Livestock Risk Protection (LRP) coverage prices, rates
and actual ending values -> data/lrp/ (phase 1: probe only)

WHY THIS EXISTS
  /lrp will show what an LRP endorsement would have paid for every day RMA has
  published, so a buyer can see the record instead of a sales sheet. The
  sandbox this is written in cannot reach USDA, so the first job is to capture
  what RMA actually serves, raw, inside GitHub Actions, and commit it to
  data/lrp-raw/probe/ where it can be read before a parser is written.

THE SOURCES THE PROBE OPENS (found by search on 2026-10-15, none opened yet)
  1. ADM livestock, one small zip per sales day:
       https://pubfs-rma.fpac.usda.gov/pub/References/adm_livestock/<YYYY>/
         e.g. 2018_ADMLivestockLrp_Daily_20170703.zip (a few KB to 20 KB)
     Seen in the 2018 folder. Later year folders were seen listing DRP and LGM
     files; whether LRP is still there, or renamed, is what the probe answers.
     These carry the coverage prices, rates and expected ending values RMA
     offered each day, per commodity, type and endorsement length.
  2. LRP Summary of Business, one zip per crop year, 2004 forward:
       https://pubfs-rma.fpac.usda.gov/pub/Web_Data_Files/Summary_of_Business/
         livestock_and_dairy_participation/lrp_<YYYY>.zip
     Pipe-delimited, one row per endorsement sold: sales effective date, end
     date, coverage price, expected and actual ending value, cost per cwt.
     Only days somebody bought, but it reaches back to 2004 and carries the
     actual ending values.
  3. The Livestock Reports app (the daily table people look at):
       https://public.rma.usda.gov/livestockreports/main.aspx
       https://public.rma.usda.gov/livestockreports/LRPReport
     The probe saves the criteria page, reads its form and submits it once per
     commodity for a few recent days, so the result layout can be seen.
  4. RMA's legacy livestock archive pages, saved for any older files they link.

USAGE
  python scripts/fetch_lrp.py --selftest
  python scripts/fetch_lrp.py --probe        # in Actions only; writes data/lrp-raw/probe/

The probe never fails the run for one bad URL; every request, with its status,
size and type, goes in data/lrp-raw/probe/manifest.json. It keeps the whole
capture under PROBE_CAP bytes (data/ is close to its folder budget).
"""

import argparse
import gzip
import html.parser
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

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
    print("fetch_lrp selftest: ok")
    return 0


def main():
    ap = argparse.ArgumentParser(description="RMA LRP data (probe phase)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--out", default=PROBE_DIR)
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.probe:
        return run_probe(a.out)
    log("Only --probe and --selftest exist so far; the parser comes after the probe is read.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
