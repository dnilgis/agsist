#!/usr/bin/env python3
"""
AGSIST -- data/hog-cash.json: the national cash hog price and the pork cutout.

Sources, USDA AMS Livestock Mandatory Reporting, public PDFs (latest issue):
  * Cash hogs, LM_HG201 "National Daily Direct Hog Prior Day Report -
    Slaughtered Swine" (MMN 2511), each weekday morning (USDA stamps
    09:40-10:30 at the Des Moines office), for the prior slaughter day(s).
      https://www.ams.usda.gov/mnreports/ams_2511.pdf
    Read: the "Producer Sold:" table, Negotiated column and Totals/Wtd Avg
    column: head count, carcass base price, net price, carcass weight.
  * Pork cutout, LM_PK602 "National Daily Pork Report FOB Plant - Negotiated
    Sales - Afternoon" (MMN 2498), each weekday afternoon (stamped 14:5x).
      https://www.ams.usda.gov/mnreports/ams_2498.pdf
    Read: "Today's Estimated Primal Cutout Values", the first dated row.

HISTORY: data/hog-cash.json "history" holds the last 45 days of both figures
(PDF days win; the LMR DataMart fills missing days while fewer than 15 are
held). The cattle page draws its 30-day chart from it.

NOT HERE: LM_HG203 (National Daily Direct Hogs Afternoon). USDA stopped it on
Dec 31, 2020 (DataMart list, probe of 2026-11-03); its successor is LSDLM_HG217
(MMN 2675), which this file does not read yet.

Probe of 2026-11-03 (cattle-cash workflow, hog_probe ticked, saved on the raw
branch under data/hog-cash-raw/):
  * mnreports PDFs: ams_2511 and ams_2498 answer with the current issue.
    The old .txt files (lm_hg201.txt, lm_pk602.txt) are frozen notices from
    April 2020.
  * LMR DataMart API (mpr.datamart.ams.usda.gov/services/v1.1/reports): answers,
    no key. LM_HG201 rows from Jan 2, 2002; LM_PK602 rows from Jan 2, 2014.
    Report ids come from its list: the slug_name there is AMS_<id>, the LM code
    is in the title. A section name with a slash ("Barrows/Gilts") must go bare:
    %2F gets 400. An open call (no q=report_date=a:b) returns the whole history,
    up to 83 MB a section, so every call carries a range. LSDLM_HG217 answers
    (rows from 2020). The history backfill route, not used here yet.
  * MARS API v1.2: 404 for every LM id. The LM reports are not in MARS.

Modes:
  (default)   fetch both, validate, write. Each block keeps its last good value
              on any failure and records why in `status`.
  --probe     ask every route (DataMart, MARS, mnreports), save the answers and
              probe.json to data/hog-cash-raw/ (the workflow saves that folder
              on the raw branch, never on main). Writes no feed.
  --selftest  offline tests, non-zero exit on any failure.

WHAT THIS FILE WILL NOT DO
  * Write a value it could not read, a zero, or a price USDA withheld ("*").
  * Replace a newer report date with an older one.
  * Keep a hog table whose column head counts do not add to its own total, or
    a cutout whose change line or load count disagrees with its own rows.
  * Keep a negotiated base price more than 30% from nearby lean hog futures.
  * Print or save the MARS key, or put it in a URL.

Stdlib only, plus pdftotext or pypdf through fetch_dairy.pdf_to_text.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import base64
import datetime
import json
import os
import re
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_dairy as FD  # noqa: E402
import ams_http as AMS  # noqa: E402  www.ams.usda.gov first, then the measured mirror

ROOT = Path(__file__).resolve().parent.parent
OUT = "data/hog-cash.json"
RAW_DIR = "data/hog-cash-raw"
PRICES = "data/prices.json"
SRC = {
    "hogs": {"url": "https://www.ams.usda.gov/mnreports/ams_2511.pdf", "code": "LM_HG201",
             "name": "USDA AMS, National Daily Direct Hog Prior Day Report - Slaughtered Swine (LM_HG201)",
             "date_field": "report_date"},
    "cutout": {"url": "https://www.ams.usda.gov/mnreports/ams_2498.pdf", "code": "LM_PK602",
               "name": "USDA AMS, National Daily Pork Report FOB Plant - Negotiated Sales - Afternoon (LM_PK602)",
               "date_field": "date"},
}
BASE_RANGE = (25.0, 200.0)      # $/cwt carcass
CWT_RANGE = (150.0, 300.0)      # lb carcass
CUTOUT_RANGE = (40.0, 250.0)    # $/cwt
FUTURES_GAP = 0.30
MONTHS = ["january", "february", "march", "april", "may", "june", "july",
          "august", "september", "october", "november", "december"]
COLS = ("negotiated", "other_market_formula", "swine_pork_market_formula", "other_purchase",
        "negotiated_formula", "total")


def norm_lines(text):
    return [re.sub(r"[ \t ]+", " ", ln).strip() for ln in (text or "").splitlines()]


def joined(text):
    """All lines run together with single spaces. The runner's text puts every
    cell on its own line, pdftotext -layout puts a row on a line; both read the
    same left to right once joined."""
    return " ".join(ln for ln in norm_lines(text) if ln)


def find_date(s):
    """First date in s as YYYY-MM-DD: 'November 02, 2026' or '11/02/2026'."""
    m = re.search(r"\b(" + "|".join(x[:3] for x in MONTHS) + r")[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b", s, re.I)
    if m:
        try:
            return datetime.date(int(m.group(3)), [x[:3] for x in MONTHS].index(m.group(1).lower()[:3]) + 1,
                                 int(m.group(2))).isoformat()
        except ValueError:
            pass
    m = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", s)
    if m:
        try:
            return datetime.date(int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat()
        except ValueError:
            pass
    return None


def all_dates(s):
    out = []
    for m in re.finditer(r"\b(?:" + "|".join(x[:3] for x in MONTHS) + r")[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b", s, re.I):
        d = find_date(m.group(0))
        if d:
            out.append(d)
    return out


def report_date(text, code):
    """The issue date from the heading lines, only when the heading names `code`."""
    head = joined("\n".join(norm_lines(text)[:12]))
    if code not in head:
        return None
    return find_date(head)


CELL = r"(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|\*)"


def num(tok):
    return None if tok == "*" else float(tok.replace(",", ""))


def row(block, label, n):
    """The n cells after `label` in a joined block, or None."""
    m = re.search(re.escape(label) + r"\s+" + r"\s+".join([CELL] * n) + r"(?![\d.,])", block)
    return [num(x) for x in m.groups()] if m else None


def parse_hogs(text):
    """({report_date, slaughter_dates, negotiated{}, total{}}, None) or (None, reason)."""
    rd = report_date(text, "LM_HG201")
    if not rd:
        return None, "no LM_HG201 heading with a date"
    j = joined(text)
    sm = re.search(r"slaughter data for\s+(.{0,120}?)(?:barrows|negotiated|producer sold)", j, re.I)
    slaughter = all_dates(sm.group(1)) if sm else []
    if not slaughter:
        return None, "no slaughter date line"
    if any(d > rd for d in slaughter):
        return None, "slaughter date after the report date"
    i = j.find("Producer Sold:")
    k = j.find("(Packer Buying Programs)", i)
    if i < 0 or k < 0:
        return None, "no Producer Sold table"
    block = j[i:k]
    rows = {lab: row(block, lab, 6) for lab in ("Head Count", "Carcass Base Price", "Average Net Price",
                                                 "Lowest Net Lot", "Highest Net Lot", "Average Carcass Wt")}
    if not rows["Head Count"] or not rows["Carcass Base Price"]:
        return None, "the Producer Sold table has no 6-column head count or base price row"
    heads = rows["Head Count"]
    if any(h is None for h in heads) or abs(sum(heads[:5]) - heads[5]) > 0.5:
        return None, "column head counts %s do not add to the total %s: misread" % (heads[:5], heads[5])

    def col(c):
        v = {"head": int(heads[c]), "base": rows["Carcass Base Price"][c]}
        for lab, key in (("Average Net Price", "net"), ("Average Carcass Wt", "carcass_wt")):
            if rows[lab]:
                v[key] = rows[lab][c]
        lo, hi = (rows["Lowest Net Lot"] or [None] * 6)[c], (rows["Highest Net Lot"] or [None] * 6)[c]
        return v, lo, hi

    out = {"report_date": rd, "slaughter_dates": slaughter}
    for c, key in ((0, "negotiated"), (5, "total")):
        v, lo, hi = col(c)
        if v["head"] <= 0 or v["base"] is None:
            continue    # USDA withheld it ("*"): never filled in
        if not BASE_RANGE[0] <= v["base"] <= BASE_RANGE[1]:
            return None, "%s base %.2f outside %s" % (key, v["base"], BASE_RANGE)
        if v.get("carcass_wt") is not None and not CWT_RANGE[0] <= v["carcass_wt"] <= CWT_RANGE[1]:
            return None, "%s carcass weight %.2f outside %s" % (key, v["carcass_wt"], CWT_RANGE)
        if v.get("net") is not None and lo is not None and hi is not None and not lo <= v["net"] <= hi:
            return None, "%s net price %.2f outside its own lots %.2f-%.2f: misread" % (key, v["net"], lo, hi)
        out[key] = {x: v[x] for x in ("head", "base", "net", "carcass_wt") if v.get(x) is not None}
    if "total" not in out:
        return None, "no producer-sold total"
    # page 3 repeats the negotiated column; where it is there it must agree
    m = re.search(r"Negotiated Negotiated Formula Combined Producer Sold:\s+Head Count\s+" + CELL, j)
    if m and "negotiated" in out and num(m.group(1)) != out["negotiated"]["head"]:
        return None, "negotiated head %d disagrees with the page 3 table %s" % (out["negotiated"]["head"], m.group(1))
    return out, None


PRIMALS = ("loin", "butt", "picnic", "rib", "ham", "belly")
PX = r"(-?\d{1,3}\.\d{2})"


def parse_cutout(text):
    """({date, carcass, loads, primals{}}, None) or (None, reason)."""
    rd = report_date(text, "LM_PK602")
    if not rd:
        return None, "no LM_PK602 heading with a date"
    j = joined(text)
    m = re.search(r"Today's Estimated Primal Cutout Values\s+Date\s+Loads\s+Carcass\s+Loin\s+Butt\s+Pic\s+Rib\s+Ham\s+Belly\s+"
                  r"(\d{2}/\d{2}/\d{4})\s+" + r"\s+".join([PX] * 8)
                  + r"\s+Change:\s+" + r"\s+".join([PX] * 7)
                  + r"\s+(\d{2}/\d{2}/\d{4})\s+" + r"\s+".join([PX] * 8), j)
    if not m:
        return None, "no primal cutout table (today, change, prior day)"
    g = m.groups()
    day, today, change, prior = find_date(g[0]), [float(x) for x in g[1:9]], [float(x) for x in g[9:16]], \
        [float(x) for x in g[17:25]]
    if day != rd:
        return None, "cutout row dated %s, report %s" % (day, rd)
    for t, c, p in zip(today[1:], change, prior[1:]):
        if abs((t - p) - c) > 0.011:
            return None, "change %.2f is not %.2f - %.2f: misread" % (c, t, p)
    carcass = today[1]
    if not CUTOUT_RANGE[0] <= carcass <= CUTOUT_RANGE[1]:
        return None, "cutout %.2f outside %s" % (carcass, CUTOUT_RANGE)
    lc = re.search(r"Loads PORK CUTS\s*:\s*" + PX, j)
    lt = re.search(r"Loads TRIM/PROCESS PORK\s*:\s*" + PX, j)
    if lc and lt and abs(float(lc.group(1)) + float(lt.group(1)) - today[0]) > 0.011:
        return None, "loads %.2f are not cuts %s + trim %s" % (today[0], lc.group(1), lt.group(1))
    if today[0] <= 0:
        return None, "no loads"
    return {"date": rd, "carcass": carcass, "loads": today[0], "change": change[0],
            "primals": dict(zip(PRIMALS, today[2:]))}, None


def nearby_hogs(prices):
    q = (prices or {}).get("quotes") or {}
    o = q.get("hogs-nearby") or q.get("hogs") or {}
    c = o.get("close")
    return float(c) if isinstance(c, (int, float)) and c > 0 else None


def merge(existing, key, parsed, err, now_iso, extra_check=None):
    """One block, keep-last-good, never older."""
    date_field = SRC[key]["date_field"]
    doc = dict(existing or {})
    blk = dict(doc.get(key) or {})
    st = dict(doc.get("status") or {})
    if parsed is not None and extra_check:
        why = extra_check(parsed)
        if why:
            parsed, err = None, why
    if parsed is None:
        st[key] = {"ok": False, "note": err, "checked": now_iso}
    elif blk.get(date_field) and parsed[date_field] < blk[date_field]:
        st[key] = {"ok": True, "note": "report %s older than %s held" % (parsed[date_field], blk[date_field]),
                   "checked": now_iso}
    else:
        doc[key] = dict(parsed, source=SRC[key]["name"])
        st[key] = {"ok": True, "note": "", "checked": now_iso}
    doc["status"] = st
    return doc


# ---------------------------------------------------------------- history
# The last 45 days of the two daily figures, for the small chart on the cattle
# page. Each report adds its own day; a PDF figure always wins over a DataMart
# one for the same day. While fewer than BACKFILL_MIN days are held, the LMR
# DataMart (no key, every call with a date range) fills the missing days from
# the same two reports: the Nov 2, 2026 Prod. Sold Negotiated row there is the
# PDF's own 8,718 head at 64.49, and its carcass cutout the PDF's 72.28.
HIST_DAYS = 45
BACKFILL_MIN = 15
DM = {"hogs": ("2511", "Barrows/Gilts"), "cutout": ("2498", "Cutout and Primal Values")}
NEGOTIATED = "Prod. Sold Negotiated"


def _iso(mdy_s):
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", str(mdy_s or "").strip())
    return "%s-%s-%s" % (m.group(3), m.group(1), m.group(2)) if m else None


def _num(s):
    try:
        v = float(str(s).replace(",", ""))
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


def entry_of(doc, key):
    """The history entry the current block gives, or None."""
    b = (doc or {}).get(key) or {}
    if key == "hogs":
        n = b.get("negotiated") or {}
        if b.get("report_date") and n.get("base") and n.get("head"):
            return {"d": b["report_date"], "base": n["base"], "head": n["head"]}
        return None
    if b.get("date") and b.get("carcass"):
        return {"d": b["date"], "carcass": b["carcass"]}
    return None


def dm_entries(raw, key):
    """History entries from one DataMart answer; rows outside the ranges are left out."""
    try:
        body = json.loads(raw.decode("utf-8", "replace"))
    except (ValueError, AttributeError):
        return []
    out = {}
    for r in rows_of(body):
        d = _iso(r.get("report_date"))
        if not d:
            continue
        if key == "hogs":
            if str(r.get("purchase_type") or "").strip() != NEGOTIATED:
                continue
            base, head = _num(r.get("base_price")), _num(r.get("head_count"))
            if base is None or head is None or not BASE_RANGE[0] <= base <= BASE_RANGE[1]:
                continue
            out[d] = {"d": d, "base": round(base, 2), "head": int(head)}
        else:
            c = _num(r.get("pork_carcass"))
            if c is None or not CUTOUT_RANGE[0] <= c <= CUTOUT_RANGE[1]:
                continue
            out[d] = {"d": d, "carcass": round(c, 2)}
    return [out[d] for d in sorted(out)]


def put_history(doc, key, entries, wins):
    """Add entries to doc["history"][key]; wins=True replaces a held day, False only fills gaps.
    Keeps HIST_DAYS days back from the newest held day, oldest first."""
    hist = dict(doc.get("history") or {})
    held = {e["d"]: e for e in (hist.get(key) or []) if isinstance(e, dict) and e.get("d")}
    for e in entries:
        if wins or e["d"] not in held:
            held[e["d"]] = e
    if held:
        newest = datetime.date.fromisoformat(max(held))
        cut = (newest - datetime.timedelta(days=HIST_DAYS)).isoformat()
        held = {d: e for d, e in held.items() if d > cut}
    hist[key] = [held[d] for d in sorted(held)]
    doc["history"] = hist
    return doc


def backfill(doc, get, today):
    """Fill missing days from the DataMart while the history is short. Never fails the run."""
    for key, (sid, section) in DM.items():
        if len(((doc.get("history") or {}).get(key)) or []) >= BACKFILL_MIN:
            continue
        url = "%s/%s/%s?%s" % (DATAMART, sid, urllib.parse.quote(section, safe="/"),
                               range_q(today - datetime.timedelta(days=HIST_DAYS), today))
        try:
            raw, _ = get(url)
        except Exception:                                 # noqa: BLE001 soft: the chart waits
            raw = None
        if raw:
            put_history(doc, key, dm_entries(raw, key), wins=False)
    return doc


def short(d):
    x = datetime.date.fromisoformat(d)
    return "%s %d" % (x.strftime("%b"), x.day)


def daily_line(doc):
    """One plain sentence for the Daily from what the file holds, each figure dated; None when empty."""
    parts = []
    h = (doc or {}).get("hogs") or {}
    sd = h.get("slaughter_dates") or []
    when = None
    if sd:
        a, b = short(sd[0]), short(sd[-1])
        when = a if a == b else ("%s-%s" % (a, b.split()[1]) if a.split()[0] == b.split()[0] else "%s-%s" % (a, b))
    if h.get("negotiated"):
        n = h["negotiated"]
        parts.append("National negotiated cash hogs $%.2f/cwt carcass base on %s head (killed %s)" % (
            n["base"], "{:,}".format(n["head"]), when))
    elif h.get("total"):
        t = h["total"]
        parts.append("National cash hogs, all purchase types, $%.2f/cwt carcass base (killed %s)" % (t["base"], when))
    c = (doc or {}).get("cutout") or {}
    if c.get("carcass"):
        parts.append("pork cutout $%.2f/cwt on %s" % (c["carcass"], short(c["date"])))
    if not parts:
        return None
    return "; ".join(parts) + ". USDA AMS."


def fetch(key):
    url = SRC[key]["url"]
    raw, err = AMS.get(url, expect=re.compile(SRC[key]["code"]))
    if raw is None:
        return None, None, "fetch failed: %s" % err
    if raw[:5] != b"%PDF-":
        return raw, None, "not a PDF (blocked or moved)"
    text, e = FD.pdf_to_text(raw)
    return raw, text, (None if text else "PDF text extraction failed: %s" % e)


def run(root, got=None, now=None, dm_get=None):
    """got = {"hogs": (raw, text, err), "cutout": (...)} in tests; dm_get answers the
    DataMart history calls (live by default, none in a test that does not pass one)."""
    if dm_get is None and got is None:
        dm_get = lambda u: FD.http_get(u, tries=2, timeout=45)  # noqa: E731
    root = Path(root)
    now = now or datetime.datetime.now(datetime.timezone.utc)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    got = got or {k: fetch(k) for k in SRC}
    existing = FD.read_json(root / OUT) or {}
    fut = nearby_hogs(FD.read_json(root / PRICES))

    def near_futures(x):
        n = x.get("negotiated") or x.get("total")
        if fut and abs(n["base"] - fut) / fut > FUTURES_GAP:
            return "base %.2f is over 30%% from nearby lean hog futures %.2f" % (n["base"], fut)
        return None
    doc = existing
    for key, parse, check in (("hogs", parse_hogs, near_futures), ("cutout", parse_cutout, None)):
        _, t, e = got[key]
        p, e = parse(t) if t else (None, e)
        doc = merge(doc, key, p, e, now_iso, check)
    if not any(k in doc for k in SRC):
        return None
    for key in SRC:
        e = entry_of(doc, key)
        if e:
            doc = put_history(doc, key, [e], wins=True)
    if dm_get:
        doc = backfill(doc, dm_get, now.date())
    doc["daily_line"] = daily_line(doc)
    doc["updated"] = now_iso
    if doc != existing:
        FD.atomic_write(root / OUT, doc)
    return doc


# ---------------------------------------------------------------- probe
DATAMART = "https://mpr.datamart.ams.usda.gov/services/v1.1/reports"
MARS = "https://marsapi.ams.usda.gov/services/v1.2/reports"
MNREPORTS = "https://www.ams.usda.gov/mnreports/"
WANT = ("LM_HG201", "LM_HG203", "LM_HG217", "LM_PK602")
# DataMart list of 2026-11-03; used only when the list does not answer.
KNOWN_IDS = {"LM_HG201": "2511", "LM_HG203": "2513", "LM_HG217": "2675", "LM_PK602": "2498"}
HISTORY_WEEKS = ("2002-10-07", "2008-10-06", "2014-10-06", "2020-10-05", "2025-10-06")
RECENT_DAYS = 45
SECTION_CAP = 6


def mdy(d):
    return "%02d/%02d/%04d" % (d.month, d.day, d.year)


def mars_headers():
    key = os.environ.get("MARS_API_KEY", "").strip()
    if not key:
        return None
    return {"Authorization": "Basic " + base64.b64encode((key + ":").encode()).decode(),
            "Accept": "application/json"}


def range_q(a, b):
    return "q=report_date=%s:%s" % (mdy(a), mdy(b))


def rows_of(body):
    if isinstance(body, list):
        return [r for r in body if isinstance(r, dict)]
    if isinstance(body, dict):
        for k in ("results", "data", "rows"):
            if isinstance(body.get(k), list):
                return [r for r in body[k] if isinstance(r, dict)]
    return []


def describe(raw):
    """A short summary of one JSON answer: row count, fields, dates, sections, release times."""
    try:
        body = json.loads(raw.decode("utf-8", "replace"))
    except ValueError:
        return {"json": False, "head": re.sub(r"\s+", " ", raw[:300].decode("utf-8", "replace"))[:200]}
    rows = rows_of(body)
    out = {"json": True, "rows": len(rows)}
    if isinstance(body, dict):
        out["top_keys"] = sorted(body)[:20]
        for k in ("reportSection", "reportSections", "stats"):
            if k in body:
                out[k] = body[k]
    if rows:
        out["fields"] = sorted(rows[0])[:80]
        out["first"] = {k: rows[0][k] for k in sorted(rows[0])[:80]}
        for k in ("report_date", "published_date"):
            vals = sorted({str(r[k]) for r in rows if r.get(k)},
                          key=lambda v: (v[6:10], v[0:2], v[3:5], v[11:]))
            if vals:
                out[k] = {"n": len(vals), "min": vals[0], "max": vals[-1]}
        times = {}
        for r in rows:
            m = re.search(r"(\d{1,2}):(\d{2})", str(r.get("published_date") or ""))
            if m:
                t = "%02d:%sx" % (int(m.group(1)), m.group(2)[0])
                times[t] = times.get(t, 0) + 1
        if times:
            out["publish_times"] = dict(sorted(times.items()))
    return out


CODE_RE = re.compile(r"\((?:LSD|LSW)?(LM_[A-Z]{2}\d{3})\)\s*$")


def find_ids(list_raw):
    """{LM code: {"id", "title", "sections"}} for the wanted reports. The DataMart list's
    slug_name is AMS_<id>; the LM code is the last bracket of the title."""
    try:
        body = json.loads(list_raw.decode("utf-8", "replace"))
    except (ValueError, AttributeError):
        return {}
    out = {}
    for r in (body if isinstance(body, list) else rows_of(body)):
        if not isinstance(r, dict):
            continue
        title = str(r.get("report_title") or "")
        m = CODE_RE.search(title)
        code = m.group(1) if m else str(r.get("slug_name") or "").upper()
        if code in WANT:
            out[code] = {"id": str(r.get("slug_id") or ""), "title": title,
                         "sections": [s for s in (r.get("sectionNames") or []) if isinstance(s, str)],
                         "published": r.get("published_date")}
    return out


def safe_name(s):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s).strip("_")[:90]


def probe(root=ROOT, get=None, ams_get=None, to_text=None, today=None, log=print):
    """Ask every route; save answers and probe.json under root/RAW_DIR. Returns the summary.
    Every DataMart call carries a date range: an open call returns the whole history
    (up to 83 MB a section on 2026-11-03)."""
    get = get or (lambda u, h=None: FD.http_get(u, headers=h, tries=2, timeout=45))
    ams_get = ams_get or (lambda u: AMS.get(u, tries=2, timeout=45))
    to_text = to_text or FD.pdf_to_text
    today = today or datetime.date.today()
    rd = Path(root) / RAW_DIR
    rd.mkdir(parents=True, exist_ok=True)
    summary = {"probed": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
               "calls": []}

    def ask(route, label, url, headers=None, fetch=None):
        raw, err = fetch(url) if fetch else get(url, headers)
        rec = {"route": route, "label": label, "url": url, "ok": raw is not None}
        if raw is None:
            rec["error"] = str(err)[:300]
        else:
            rec["bytes"] = len(raw)
            ext = ".pdf" if raw[:5] == b"%PDF-" else (".json" if raw[:1] in (b"{", b"[") else ".txt")
            fn = safe_name("%s-%s" % (route, label)) + ext
            (rd / fn).write_bytes(raw)
            rec["file"] = fn
            if ext == ".json":
                rec["summary"] = describe(raw)
            elif ext == ".pdf":
                text, e = to_text(raw)
                if text:
                    (rd / (fn[:-4] + ".pdf.txt")).write_text(text)
                rec["head"] = [ln.strip() for ln in (text or "").splitlines() if ln.strip()][:15] or [str(e)]
            else:
                rec["head"] = [ln.strip() for ln in raw.decode("utf-8", "replace").splitlines() if ln.strip()][:15]
        summary["calls"].append(rec)
        log("%-9s %-34s %s" % (route, label, ("%d bytes" % rec["bytes"]) if rec["ok"] else "FAILED " + rec["error"][:120]))
        return raw

    lst = ask("datamart", "list", DATAMART)
    found = find_ids(lst) if lst else {}
    summary["ids_from_list"] = found
    use = {n: (found.get(n) or {}).get("id") or KNOWN_IDS[n] for n in WANT}
    summary["ids_used"] = use
    recent = range_q(today - datetime.timedelta(days=RECENT_DAYS), today)
    week = range_q(today - datetime.timedelta(days=7), today)
    for name, sid in use.items():
        base = "%s/%s" % (DATAMART, sid)
        ask("datamart", name + "-recent", "%s?%s" % (base, recent))
        for s in ((found.get(name) or {}).get("sections") or [])[1:SECTION_CAP + 1]:
            r = ask("datamart", "%s-sec-%s" % (name, s), "%s/%s?%s" % (base, urllib.parse.quote(s, safe=""), week))
            if r is None and "/" in s:   # %2F is refused (400); the bare slash answers (2026-11-03)
                ask("datamart", "%s-sec2-%s" % (name, s), "%s/%s?%s" % (base, urllib.parse.quote(s, safe="/"), week))
        for w in HISTORY_WEEKS:
            a = datetime.date.fromisoformat(w)
            ask("datamart", "%s-hist-%s" % (name, w[:4]), "%s?%s" % (base, range_q(a, a + datetime.timedelta(days=6))))

    h = mars_headers()
    if h is None:
        summary["mars"] = "no MARS_API_KEY: not asked"
        log("mars      skipped: no MARS_API_KEY")
    else:
        for name, sid in use.items():
            ask("mars", name + "-recent", "%s/%s?%s" % (MARS, sid, recent), h)

    for name, sid in use.items():
        ask("mnreports", name + "-pdf", MNREPORTS + "ams_%s.pdf" % sid, fetch=ams_get)

    ok = sum(1 for c in summary["calls"] if c["ok"])
    summary["answered"] = "%d of %d" % (ok, len(summary["calls"]))
    (rd / "probe.json").write_text(json.dumps(summary, indent=1, sort_keys=True) + "\n")
    log("answered %s; summary in %s/probe.json" % (summary["answered"], RAW_DIR))
    for c in summary["calls"]:
        s = c.get("summary") or {}
        if s.get("rows"):
            log("  %s %s: %d rows, report_date %s, published %s, times %s" % (
                c["route"], c["label"], s["rows"], s.get("report_date"), s.get("published_date"),
                s.get("publish_times")))
    for name in use:
        p = next((c for c in summary["calls"] if c["label"] == name + "-pdf" and c.get("file")), None)
        if p and name in ("LM_HG201", "LM_PK602"):
            t = (rd / (p["file"][:-4] + ".pdf.txt"))
            if t.exists():
                v, why = (parse_hogs if name == "LM_HG201" else parse_cutout)(t.read_text())
                log("  parsed %s: %s" % (name, v or "NOT PARSED (%s)" % why))
    return summary


# ---------------------------------------------------------------- selftest
FIX = ROOT / "test" / "fixtures" / "hog-cash"


def selftest():
    import tempfile
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + (f"  ({detail})" if not ok and detail else ""))
        if not ok:
            fails.append(name)

    HOGS = {"report_date": "2026-11-02", "slaughter_dates": ["2026-10-30", "2026-10-31"],
            "negotiated": {"head": 8718, "base": 64.49, "net": 63.83, "carcass_wt": 220.57},
            "total": {"head": 340653, "base": 66.91, "net": 68.22, "carcass_wt": 221.73}}
    CUT = {"date": "2026-11-02", "carcass": 72.28, "loads": 310.84, "change": 2.18,
           "primals": {"loin": 75.65, "butt": 95.5, "picnic": 51.76, "rib": 134.5, "ham": 64.43, "belly": 74.12}}
    # the real reports (probe of 2026-11-03), in both text layouts; every number checked by hand
    for lay in ("", ".layout"):
        th = (FIX / ("lm_hg201_2026-11-02%s.txt" % lay)).read_text()
        tc = (FIX / ("lm_pk602_2026-11-02%s.txt" % lay)).read_text()
        tag = "real%s: " % lay
        h, why = parse_hogs(th)
        ck(tag + "LM_HG201 Nov 2 2026: negotiated 8,718 head at 64.49, total 340,653 at 66.91", h == HOGS, h or why)
        c, why = parse_cutout(tc)
        ck(tag + "LM_PK602 Nov 2 2026: cutout 72.28 on 310.84 loads, primals", c == CUT, c or why)
        ck(tag + "the cutout row of another day than the report is refused",
           parse_cutout(tc.replace("11/02/2026", "11/01/2026", 1))[0] is None)
        ck(tag + "a cutout that breaks its own change line is refused",
           parse_cutout(re.sub(r"72\.28", "72.38", tc, count=1))[0] is None)
        ck(tag + "loads that are not cuts + trim are refused",
           parse_cutout(tc.replace("272.50", "270.50", 1))[0] is None)
        ck(tag + "without the LM_PK602 heading, nothing", parse_cutout(tc.replace("LM_PK602", "LM_PK603"))[0] is None)
        ck(tag + "head counts that do not add to the total are refused",
           parse_hogs(th.replace("31,720", "31,730", 1))[0] is None)
        ck(tag + "a net price outside its own lots is refused",
           parse_hogs(th.replace("63.83", "79.83", 1))[0] is None)
        ck(tag + "the page 3 negotiated head must agree",
           parse_hogs(re.sub(r"(Combined\s+Producer Sold:\s+Head Count\s+)8,718", r"\g<1>8,719", th))[0] is None)
        ck(tag + "a withheld (*) negotiated base is left out, never filled",
           (lambda r: r and "negotiated" not in r and r["total"]["base"] == 66.91)(
               parse_hogs(re.sub(r"(Carcass Base Price\s+)64\.49", r"\g<1>*", th, count=1)
                          .replace("64.49", "*"))[0]))
        ck(tag + "without the LM_HG201 heading, nothing", parse_hogs(th.replace("LM_HG201", "LM_HG200"))[0] is None)
        ck(tag + "the frozen 2020 .txt notice is never read as a report",
           parse_hogs("LM_HG201\nDes Moines, IA Tue, Apr 21, 2020 USDA Market News\nText Reports will not be generated")[0] is None)

    now = "2026-11-03T21:45:00Z"
    d = merge({}, "hogs", HOGS, None, now)
    d = merge(d, "cutout", CUT, None, now)
    ck("blocks written with their USDA source named in plain text",
       "LM_HG201" in d["hogs"]["source"] and "LM_PK602" in d["cutout"]["source"]
       and not any("http" in d[k]["source"] for k in SRC))
    ck("an older report never replaces a newer date",
       merge(d, "cutout", dict(CUT, date="2026-10-30", carcass=70.1), None, now)["cutout"]["carcass"] == 72.28)
    d3 = merge(d, "hogs", None, "fetch failed: timeout", now)
    ck("a failed fetch keeps the last good block and records why",
       d3["hogs"]["negotiated"]["base"] == 64.49 and d3["status"]["hogs"]["ok"] is False)
    ck("daily_line: each figure with its own date, plain words",
       daily_line(d) == "National negotiated cash hogs $64.49/cwt carcass base on 8,718 head (killed Oct 30-31); "
       "pork cutout $72.28/cwt on Nov 2. USDA AMS.", daily_line(d))
    ck("daily_line: no em dash", "\u2014" not in (daily_line(d) or ""))
    ck("daily_line: nothing when the file holds nothing", daily_line({}) is None)
    with tempfile.TemporaryDirectory() as t:
        (Path(t) / "data").mkdir()
        (Path(t) / PRICES).write_text(json.dumps({"quotes": {"hogs-nearby": {"close": 58.375}}}))
        th = (FIX / "lm_hg201_2026-11-02.txt").read_text()
        tc = (FIX / "lm_pk602_2026-11-02.txt").read_text()
        doc = run(t, got={"hogs": (b"", th, None), "cutout": (b"", tc, None)},
                  now=datetime.datetime(2026, 11, 3, 21, 45, tzinfo=datetime.timezone.utc))
        on_disk = json.loads((Path(t) / OUT).read_text())
        ck("run: real reports pass the futures check (58.375) and are written with a daily_line",
           on_disk["hogs"]["negotiated"]["base"] == 64.49 and on_disk["cutout"]["carcass"] == 72.28
           and on_disk["daily_line"] == daily_line(on_disk) and doc == on_disk, on_disk.get("status"))
        (Path(t) / PRICES).write_text(json.dumps({"quotes": {"hogs-nearby": {"close": 99.0}}}))
        doc = run(t, got={"hogs": (b"", th.replace("November 02, 2026", "November 03, 2026"), None),
                          "cutout": (None, None, "fetch failed: x")})
        ck("run: a base over 30% from futures is refused, the last good one stays",
           doc["hogs"]["report_date"] == "2026-11-02" and doc["status"]["hogs"]["ok"] is False
           and "futures" in doc["status"]["hogs"]["note"])
    with tempfile.TemporaryDirectory() as t:
        ck("run: nothing read and no file, nothing written",
           run(t, got={"hogs": (None, None, "x"), "cutout": (None, None, "y")}) is None
           and not (Path(t) / OUT).exists())

    # history and the DataMart backfill (real answers from the same probe)
    dmh = (FIX / "datamart_lm_hg201_barrows_gilts_2026-11-03.json").read_bytes()
    dmc = (FIX / "datamart_lm_pk602_cutout_2026-11-03.json").read_bytes()
    eh = dm_entries(dmh, "hogs")
    ck("datamart: Prod. Sold Negotiated rows only, one per report, oldest first",
       [(e["d"], e["head"], e["base"]) for e in eh] == [
           ("2026-10-27", 7532, 66.75), ("2026-10-28", 6148, 66.13), ("2026-10-29", 4476, 66.23),
           ("2026-10-30", 5992, 66.64), ("2026-11-02", 8718, 64.49)], eh)
    ck("datamart: the Nov 2 row is the PDF's own negotiated figure",
       eh[-1] == {"d": "2026-11-02", "base": HOGS["negotiated"]["base"], "head": HOGS["negotiated"]["head"]})
    ec = dm_entries(dmc, "cutout")
    ck("datamart: carcass cutout by report day, Nov 2 is the PDF's 72.28",
       [(e["d"], e["carcass"]) for e in ec] == [("2026-10-27", 73.09), ("2026-10-28", 72.45),
                                                 ("2026-10-29", 70.69), ("2026-10-30", 70.1), ("2026-11-02", 72.28)], ec)
    ck("datamart: a withheld, zero or out-of-range price is left out",
       dm_entries(json.dumps({"results": [
           {"report_date": "11/02/2026", "purchase_type": NEGOTIATED, "head_count": "8,718", "base_price": None},
           {"report_date": "11/03/2026", "purchase_type": NEGOTIATED, "head_count": "0", "base_price": "60.00"},
           {"report_date": "11/04/2026", "purchase_type": NEGOTIATED, "head_count": "900", "base_price": "260.00"}]}).encode(),
           "hogs") == [])
    ck("datamart: a broken answer gives nothing", dm_entries(b"<html>", "hogs") == [] and dm_entries(None, "cutout") == [])
    hd = put_history({}, "hogs", eh, wins=False)
    hd = put_history(hd, "hogs", [{"d": "2026-11-02", "base": 64.0, "head": 1}], wins=False)
    ck("history: a DataMart day never replaces a held day", hd["history"]["hogs"][-1]["base"] == 64.49)
    hd = put_history(hd, "hogs", [{"d": "2026-11-02", "base": 64.5, "head": 8720}], wins=True)
    ck("history: the day's own report replaces it", hd["history"]["hogs"][-1]["base"] == 64.5)
    hd = put_history(hd, "hogs", [{"d": "2026-12-20", "base": 60.0, "head": 5000}], wins=True)
    ck("history: only 45 days back from the newest day are kept",
       [e["d"] for e in hd["history"]["hogs"]] == ["2026-12-20"], hd["history"]["hogs"])
    with tempfile.TemporaryDirectory() as t:
        (Path(t) / "data").mkdir()
        th = (FIX / "lm_hg201_2026-11-02.txt").read_text()
        tc = (FIX / "lm_pk602_2026-11-02.txt").read_text()
        urls = []

        def dm(u):
            urls.append(u)
            return (dmh if "/2511/" in u else dmc), None
        doc = run(t, got={"hogs": (b"", th, None), "cutout": (b"", tc, None)},
                  now=datetime.datetime(2026, 11, 3, 21, 45, tzinfo=datetime.timezone.utc), dm_get=dm)
        ck("run: the report's day plus the DataMart days, five each",
           len(doc["history"]["hogs"]) == 5 and len(doc["history"]["cutout"]) == 5
           and doc["history"]["hogs"][-1] == {"d": "2026-11-02", "base": 64.49, "head": 8718}, doc.get("history"))
        ck("run: each DataMart call carries a date range and the bare slash",
           len(urls) == 2 and all("?q=report_date=09/19/2026:11/03/2026" in u for u in urls)
           and any("/2511/Barrows/Gilts?" in u for u in urls), urls)
        full = dict(doc, history={k: [{"d": "2026-10-%02d" % i, "base": 60.0, "head": 1, "carcass": 70.0}
                                      for i in range(1, 16)] for k in SRC})
        (Path(t) / OUT).write_text(json.dumps(full))
        urls.clear()
        run(t, got={"hogs": (b"", th, None), "cutout": (b"", tc, None)},
            now=datetime.datetime(2026, 11, 3, 21, 45, tzinfo=datetime.timezone.utc), dm_get=dm)
        ck("run: a full history asks the DataMart nothing", urls == [], urls)

        def down(u):
            raise OSError("no route")
        (Path(t) / OUT).unlink()
        doc = run(t, got={"hogs": (b"", th, None), "cutout": (b"", tc, None)},
                  now=datetime.datetime(2026, 11, 3, 21, 45, tzinfo=datetime.timezone.utc), dm_get=down)
        ck("run: a DataMart that does not answer leaves the report's own day and the file written",
           [e["d"] for e in doc["history"]["hogs"]] == ["2026-11-02"] and (Path(t) / OUT).exists())

    # probe
    lst = json.dumps([
        {"slug_id": 2511, "slug_name": "AMS_2511", "report_title": "National Daily Direct Prior Day Slaughtered Swine (PDF) (LM_HG201)",
         "sectionNames": ["Summary", "Barrows/Gilts", "Carcass Measurements"]},
        {"slug_id": 2675, "slug_name": "AMS_2675", "report_title": "Daily Direct Afternoon Hog Report (PDF) (LSDLM_HG217)",
         "sectionNames": ["Summary"]},
        {"slug_id": 2499, "slug_name": "AMS_2499", "report_title": "National Daily Pork FOB Omaha (PDF) (LM_PK603)"}]).encode()
    ids = find_ids(lst)
    ck("the list: LM code from the title (slug_name is AMS_<id>), LSD prefix read, others skipped",
       {k: v["id"] for k, v in ids.items()} == {"LM_HG201": "2511", "LM_HG217": "2675"}, ids)
    ck("a broken list gives no ids", find_ids(b"<html>") == {})
    body = json.dumps({"reportSections": ["Summary"], "results": [
        {"report_date": "10/30/2026", "published_date": "10/30/2026 09:55:11"},
        {"report_date": "12/31/2025", "published_date": "12/31/2025 10:21:40"}]}).encode()
    dsc = describe(body)
    ck("describe: dates sorted by year, not as text; release times",
       dsc["report_date"] == {"n": 2, "min": "12/31/2025", "max": "10/30/2026"}
       and dsc["publish_times"] == {"09:5x": 1, "10:2x": 1}, dsc)
    os.environ["MARS_API_KEY"] = "sekret-key"
    calls = []

    def fake_get(u, h=None):
        calls.append((u, h))
        if u == DATAMART:
            return lst, None
        if "/2511?" in u:
            return body, None
        return None, "HTTPError: HTTP Error 400: Bad Request"

    with tempfile.TemporaryDirectory() as t:
        s = probe(root=t, get=fake_get, ams_get=lambda u: (None, "no DNS"), to_text=lambda r: (None, "x"),
                  today=datetime.date(2026, 11, 3), log=lambda *a: None)
        saved = "".join(p.read_text(errors="replace") for p in (Path(t) / RAW_DIR).iterdir())
        ck("probe: ids from the list, the known ids only for the missing ones",
           s["ids_used"] == {"LM_HG201": "2511", "LM_HG203": "2513", "LM_HG217": "2675", "LM_PK602": "2498"}, s["ids_used"])
        dm = [u for u, _ in calls if u.startswith(DATAMART + "/")]
        ck("probe: every DataMart report call carries a date range", dm and all("?q=report_date=" in u for u in dm))
        ck("probe: a section with a slash is tried encoded, then bare",
           any("/2511/Barrows%2FGilts?" in u for u in dm) and any("/2511/Barrows/Gilts?" in u for u in dm))
        ck("probe: MARS asked only with the key in a header",
           any(u.startswith(MARS) and h and h["Authorization"].startswith("Basic ") for u, h in calls))
        ck("probe: the key is in no URL and no saved file",
           not any("sekret" in u for u, _ in calls) and "sekret" not in saved
           and base64.b64encode(b"sekret-key:").decode() not in saved)
        ck("probe: probe.json counts every call", s["answered"].endswith("of %d" % len(s["calls"])))
    os.environ.pop("MARS_API_KEY", None)
    with tempfile.TemporaryDirectory() as t:
        s = probe(root=t, get=lambda u, h=None: (None, "down"), ams_get=lambda u: (None, "down"),
                  to_text=lambda r: (None, "x"), today=datetime.date(2026, 11, 3), log=lambda *a: None)
        ck("probe: no key, MARS not asked; no list, the known ids", s["mars"].startswith("no MARS_API_KEY")
           and s["ids_used"] == KNOWN_IDS and not any(c["url"].startswith(MARS) for c in s["calls"]))

    print()
    if fails:
        print("%d FAILED" % len(fails))
        return 1
    print("all hog cash checks pass")
    return 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--probe" in argv:
        s = probe(ROOT)
        return 0 if any(c["ok"] for c in s["calls"]) else 1
    doc = run(ROOT)
    st = (doc or {}).get("status") or {}
    for k in SRC:
        s = st.get(k) or {}
        print("[hog-cash] %s ok=%s %s" % (k, s.get("ok"), s.get("note", "")))
        if not s.get("ok"):
            print("::warning::%s not refreshed: %s" % (k, s.get("note", "no file")))
    print("[hog-cash] daily_line: %s" % (doc or {}).get("daily_line"))
    return 0


if __name__ == "__main__":
    _argv = sys.argv[1:]
    _rc = main(_argv)
    sys.exit(_rc if "--selftest" in _argv else AMS.finish("hog-cash", _rc, probe="--probe" in _argv))
