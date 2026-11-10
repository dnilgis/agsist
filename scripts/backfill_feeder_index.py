#!/usr/bin/env python3
"""backfill_feeder_index.py -- past weeks of the AGSIST USDA feeder steer index
(data/feeder-index-history.json) from archived copies of the same USDA AMS
single-barn auction reports the live record reads.

WHERE THE PAST REPORTS ARE (probe of Nov 2 2026, scripts/probe_feeder_archive.py,
saved on the raw branch at history/feeder-archive/probe/):
  * www.ams.usda.gov/mnreports/ams_<slug>.pdf is only ever the latest issue.
  * My Market News (its file repository and report pages) did not answer a
    GitHub runner at all (robots.txt included: read timed out).
  * The MARS API answers 403 without a key; there is no MARS_API_KEY secret.
  * search.ams.usda.gov timed out; ESMIS's robots.txt disallows its search.
  * The Internet Archive holds copies of ams_<slug>.pdf, taken when its
    crawler passed: a handful a year per barn. Each copy is USDA's own PDF as
    it stood that day; read through fetch_cattle_auction's reader it gives the
    barn's sale of that week (fixtures: test/fixtures/cattle-auction/*archive*).
So this first read the Internet Archive copies (Nov 2). A week gets only the barns a copy
happened to catch, so most weeks are withheld by the index's own rule (30
barns, 8 states, 4,000 head, no state over half); the ones that pass are
real counts of real USDA rows.

  --fetch --from 2025-01-01 --to 2026-10-11 [--max-minutes 300]
      For every single-barn report in scripts/cattle_auction_sources.json
      (state summaries never), list the copies (CDX), fetch each one not yet
      read (robots.txt obeyed), and read it with
      fetch_cattle_auction.parse_report / title_ok / summarize (no second
      parser). One request every 4 s: the Internet Archive refused a run that
      asked every 1.5 s. Writes history/feeder-archive/:
        text/<slug>/<capture>.txt   the report text as read (the record)
        sales/<slug>.json           {sale date: summarize() result}
        manifest.json               per report: copies listed, read, refused and why
      Resumable: a copy in the manifest is not asked again.
  --mars-fetch --from 2024-01-01 [--to 2026-10-11] [--max-minutes 300]
      (Nov 3 2026: the owner made a My Market News key, secret MARS_API_KEY, Actions only.)
      Every single-barn report through the MARS API, one ask per report and year,
      1.5 s apart; the rows are mapped to fetch_cattle_auction's own records
      (mars_reports: same tables, same row rules via FCA.check_row, same title check)
      and summarized by FCA.summarize. Writes history/feeder-mars/:
        rows/<slug>.json   feeder rows as MARS sent them (the fields read)
        sales/<slug>.json  {sale date: summarize() result}
        manifest.json      per report and year: status, rows; refusals and why
  --mars-saved DIR
      The same from MARS answers already saved (the probe's header_<slug>.json), no network.
  --mars-check
      The cross-check: every saved Internet Archive copy (text/) read by the PDF
      reader against MARS's rows for the same sale, row for row, then the index of
      every week built both ways from those sales -> history/feeder-mars/crosscheck.json.
  --build [--dry-run]
      MARS sales first; an Internet Archive copy's sale only for a barn and week MARS
      does not hold -> build_feeder_index.build_history -> data/feeder-index-history.json
      (only weeks before the live record starts; each week says how its barns were read
      in "via"; a re-run changes nothing).

    python3 scripts/backfill_feeder_index.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import argparse
import datetime
import glob
import json
import os
import re
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from history_lib import Fetcher, FetchError, Saver, now_iso  # noqa: E402
import fetch_cattle_auction as FCA  # noqa: E402
import fetch_dairy as FD  # noqa: E402
import build_feeder_index as BFI  # noqa: E402
import probe_feeder_archive as PFA  # noqa: E402

OUT = "history/feeder-archive"
SOURCE = "USDA AMS single-barn auction reports, from copies kept by the Internet Archive"
ORIG = "www.ams.usda.gov/mnreports/ams_%s.pdf"


def reports(cfg):
    """[(slug, barn)] for every single-barn report (slug and `also`), state summaries never."""
    out = []
    for b in cfg.get("barns") or []:
        for s in [b.get("slug")] + list(b.get("also") or []):
            if s and str(s) not in [x for x, _ in out]:
                out.append((str(s), b))
    return out


def iso_(d):
    return d.isoformat()


def ts_date(ts):
    return datetime.date(int(ts[:4]), int(ts[4:6]), int(ts[6:8]))


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=0, sort_keys=True)
    os.replace(tmp, path)


def heads(sale):
    return sum(c.get("head", 0) for cl in (sale.get("classes") or {}).values() for c in cl.values())


def read_copy(raw, barn):
    """(sale, text, None) or (None, text, why): the barn reader on one archived copy."""
    if not raw or raw[:5] != b"%PDF-":
        return None, None, "not a PDF"
    text, err = FD.pdf_to_text(raw)
    if not text:
        return None, None, "no text: %s" % err
    p, why = FCA.parse_report(text)
    if p is None:
        return None, text, why
    if not FCA.title_ok(barn, p["title"]):
        return None, text, "title does not name this barn: %r" % p["title"][:90]
    return FCA.summarize(p), text, None


def fetch(d0, d1, out=OUT, fetch_=None, minutes=0, clock=time.monotonic, log=PFA.flush_log, root=FCA.ROOT):
    # The Internet Archive refused connections (errno 111) to the Nov 2 coverage run at one ask
    # every 1.5 s, so this goes at one every 4 s and waits minutes, not seconds, when refused.
    fetch_ = fetch_ or Fetcher(min_gap=4.0, retries=3, timeout=90, backoff=(30, 120, 300), ok=(200, 404))
    robots = PFA.Robots(fetch_, log)
    stop = clock() + minutes * 60 if minutes else None
    man_path = os.path.join(out, "manifest.json")
    man = load(man_path, {"source": SOURCE, "reports": {}})
    cfg = FCA.load_sources(root)
    saver = Saver(out, "history feeder-archive", every_min=30)   # HISTORY_PUSH=1 in the workflow only

    class _Man:
        def save(self):
            save(man_path, man)
    hi = d1 + datetime.timedelta(days=10)    # a copy taken after the last week can hold its sale
    by_slug = dict(reports(cfg))
    # 1. the copy list of every report (kept in the manifest, so a resumed run does not ask again)
    for slug, barn in reports(cfg):
        if stop and clock() > stop:
            break
        m = man["reports"].setdefault(slug, {"barn": barn["id"], "done": {}, "listed": None})
        if m.get("caps") is not None and m.get("range") == [iso_(d0), iso_(hi)]:
            continue
        url = PFA.CDX % urllib.parse.quote(ORIG % slug, safe="")
        if not robots.allowed(url):
            m["listed"] = "robots: disallowed"
            continue
        try:
            s, body = fetch_.get(url)
            rows = json.loads(body.decode("utf-8", "replace") or "[]") if s == 200 else []
        except (FetchError, ValueError) as e:
            m["listed"] = "failed: %s" % str(e)[:200]
            log("  %s: copy list failed (%s)" % (slug, str(e)[:120]))
            continue
        caps = rows[1:] if rows and rows[0] and rows[0][0] == "timestamp" else rows
        m["caps"] = [[c[0], c[1]] for c in caps if d0 <= ts_date(c[0]) <= hi]
        m["range"] = [iso_(d0), iso_(hi)]
        m["listed"] = now_iso()
        m["copies"] = len(m["caps"])
        log("  %s (%s): %d copies listed" % (slug, barn["id"], m["copies"]))
        save(man_path, man)
        saver.tick(_Man())                # the copy lists alone took about an hour on Nov 2
    save(man_path, man)
    # 2. read the copies, the weeks the crawler caught the most barns in first: those are the
    #    weeks that can pass the index's bar, so a run cut short has read them
    week_barns = {}
    for slug, m in man["reports"].items():
        for ts, _ in m.get("caps") or []:
            week_barns.setdefault(PFA.week_of(ts), set()).add(m["barn"])
    queue = sorted(((slug, ts, orig) for slug, m in man["reports"].items() if slug in by_slug
                    for ts, orig in (m.get("caps") or []) if ts not in m["done"]),
                   key=lambda q: (-len(week_barns.get(PFA.week_of(q[1]), ())), q[1], q[0]))
    log("copy lists: %d reports, %d copies to read" % (sum(1 for m in man["reports"].values() if m.get("caps") is not None), len(queue)))
    sales_cache = {}
    n = 0
    for slug, ts, orig in queue:
        if stop and clock() > stop:
            log("stopped at the time limit; dispatch again to go on")
            break
        m, barn = man["reports"][slug], by_slug[slug]
        u = PFA.WAYBACK % (ts, orig)
        if not robots.allowed(u):
            m["done"][ts] = "robots: disallowed"
            continue
        try:
            s, raw = fetch_.get(u)
        except FetchError as e:
            log("  %s %s: %s" % (slug, ts, e))
            continue                      # not marked: asked again next run
        if s != 200:
            m["done"][ts] = "HTTP %s" % s
            continue
        sale, text, why = read_copy(raw, barn)
        if text:
            tp = os.path.join(out, "text", slug, ts + ".txt")
            os.makedirs(os.path.dirname(tp), exist_ok=True)
            with open(tp, "w", encoding="utf-8") as f:
                f.write(text)
        if sale is None:
            m["done"][ts] = "refused: %s" % why
        else:
            sale["copy"] = ts
            sales_path = os.path.join(out, "sales", slug + ".json")
            sales = sales_cache.setdefault(slug, load(sales_path, {}))
            old = sales.get(sale["date"])
            if old is None or heads(sale) > heads(old):
                sales[sale["date"]] = sale
            save(sales_path, sales)
            m["done"][ts] = "read %s" % sale["date"]
        n += 1
        if n % 10 == 0:
            save(man_path, man)
            log("  %d copies read this run (last: %s %s, %s)" % (n, slug, ts, m["done"][ts][:60]))
            saver.tick(_Man())
    save(man_path, man)
    return man


# ------------------------------------------------------------------ MARS (USDA My Market News)
# Nov 2. MARS_API_KEY is an Actions secret (HTTP basic, key as
# the user name, empty password); it is never printed or saved. The MARS answer for a
# report (https://marsapi.ams.usda.gov/services/v1.2/reports/<slug>?q=report_begin_date=
# MM/DD/YYYY:MM/DD/YYYY) is one JSON row per table row of the same USDA report the PDF
# prints (probe of Nov 3 2026, raw history/feeder-mars/probe/): commodity, class, frame,
# muscle_grade, price_unit, weight_collect, lot_desc, head_count, avg_weight_min/max,
# avg_weight, avg_price_min/max, avg_price, receipts, report_date, report_title.
MARS_OUT = "history/feeder-mars"
MARS_SOURCE = "USDA AMS single-barn auction reports, read through USDA My Market News"
MARS_ROWS_KEEP = ("report_date", "published_date", "report_title", "slug_id", "commodity", "class", "frame",
                  "muscle_grade", "price_unit", "weight_collect", "lot_desc", "head_count", "avg_weight_min",
                  "avg_weight_max", "avg_weight", "avg_price_min", "avg_price_max", "avg_price", "receipts",
                  "final_ind", "age", "dressing")


def mars_key(r):
    """The PDF reader's table key for a MARS row ("steers|1"), or None for a row the PDF
    reader never reads: only Feeder Cattle steers and heifers, Medium and Large 1 and 1-2,
    Per Cwt on Actual Wt (fetch_cattle_auction.SECTION_RE)."""
    if r.get("commodity") != "Feeder Cattle" or r.get("frame") != "Medium and Large":
        return None
    c, g = str(r.get("class") or ""), str(r.get("muscle_grade") or "")
    if c not in ("Steers", "Heifers") or g not in ("1", "1-2"):
        return None
    if r.get("price_unit") != "Per Cwt" or r.get("weight_collect") != "Actual":
        return None
    return "%s|%s" % (c.lower(), g)


def mars_note(v):
    v = str(v or "").strip()
    return "" if v.lower() in ("", "none", "null") else v


def _num(v):
    if isinstance(v, bool) or v is None:
        raise ValueError("missing")
    return float(v)


def mars_row(r):
    """(row, None) in fetch_cattle_auction.parse_rows' shape, ("skip", None), or (None, why)."""
    try:
        row = {"head": int(_num(r.get("head_count"))), "lo": int(_num(r.get("avg_weight_min"))),
               "hi": int(_num(r.get("avg_weight_max"))), "wt": int(_num(r.get("avg_weight"))),
               "plo": round(_num(r.get("avg_price_min")), 2), "phi": round(_num(r.get("avg_price_max")), 2),
               "price": round(_num(r.get("avg_price")), 2), "note": mars_note(r.get("lot_desc"))}
    except (TypeError, ValueError):
        return None, "a row with a number missing"
    why = FCA.check_row(row)
    if why == "skip":
        return "skip", None
    if why:
        return None, why
    return row, None


def mars_reports(rows, barn):
    """MARS rows of one report number -> ({sale date: parse_report-shaped dict}, {date: why}).
    The same rules as the PDF reader: the report's title must name the barn, one misread
    row refuses the whole sale, a sale with no feeder row is not a sale."""
    by_date = {}
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        d = PFA.mars_date(r.get("report_date"))
        if d:
            by_date.setdefault(d.isoformat(), []).append(r)
    good, bad = {}, {}
    for d, rs in sorted(by_date.items()):
        title = next((str(r.get("report_title")) for r in rs if r.get("report_title")), "")
        if not FCA.title_ok(barn, title):
            bad[d] = "title does not name this barn: %r" % title[:90]
            continue
        tables, why, rec = {}, None, None
        for r in rs:
            k = mars_key(r)
            if k is None:
                continue
            row, why = mars_row(r)
            if row is None:
                break
            if row != "skip":
                tables.setdefault(k, []).append(row)
        if why:
            bad[d] = "%s: %s" % (k, why)
            continue
        if not any(tables.values()):
            bad[d] = "no feeder steer or heifer Medium and Large 1 / 1-2 rows (Per Cwt, Actual Wt)"
            continue
        for r in rs:
            if isinstance(r.get("receipts"), int):
                rec = r["receipts"]
                break
        good[d] = {"date": d, "receipts": rec, "title": title, "tables": tables,
                   "final": all(str(r.get("final_ind") or "Final") == "Final" for r in rs)}
    return good, bad


def mars_sales_of(rows, barn):
    """{date: summarize() sale} plus the refusals, for the sales file."""
    good, bad = mars_reports(rows, barn)
    out = {}
    for d, p in good.items():
        s = FCA.summarize(p)
        if not s["classes"]:
            bad[d] = "no feeder row in the classes read"
            continue
        if not p["final"]:
            s["preliminary"] = True
        out[d] = s
    return out, bad


def mars_feeder_rows(body):
    """The rows worth keeping from one MARS answer (feeder cattle only, the fields read)."""
    rows, _ = PFA.mars_rows(body)
    return [{k: r.get(k) for k in MARS_ROWS_KEEP} for r in rows or []
            if isinstance(r, dict) and r.get("commodity") == "Feeder Cattle"]


def mars_fetch(d0, d1, out=MARS_OUT, fetch_=None, log=PFA.flush_log, root=FCA.ROOT, minutes=0, clock=time.monotonic):
    """Every single-barn report's rows from d0 to d1, one ask per report and year, 1.5 s
    apart. Saves rows/<slug>.json (feeder rows as MARS sent them, the fields read),
    sales/<slug>.json and manifest.json. Needs MARS_API_KEY."""
    auth = PFA.mars_auth()
    if not auth and fetch_ is None:     # a stand-in fetcher (tests) needs no key
        log("no MARS_API_KEY: nothing asked")
        return None
    fetch_ = fetch_ or Fetcher(min_gap=1.5, retries=2, timeout=180, headers=auth, ok=(200, 204, 404))
    stop = clock() + minutes * 60 if minutes else None
    man_path = os.path.join(out, "manifest.json")
    man = load(man_path, {"source": MARS_SOURCE, "reports": {}})
    cfg = FCA.load_sources(root)
    years = list(range(d0.year, d1.year + 1))
    for slug, barn in reports(cfg):
        if stop and clock() > stop:
            log("stopped at the time limit; dispatch again to go on")
            break
        m = man["reports"].setdefault(slug, {"barn": barn["id"], "years": {}})
        rows_path = os.path.join(out, "rows", slug + ".json")
        have_rows = os.path.exists(rows_path)
        rows = load(rows_path, [])
        for y in years:
            a, b = max(d0, datetime.date(y, 1, 1)), min(d1, datetime.date(y, 12, 31))
            # a finished year is asked once, but only while its saved rows are here to keep
            if have_rows and m["years"].get(str(y), {}).get("to") == iso_(b) and y < d1.year:
                continue
            try:
                s, body = fetch_.get(PFA.MARS % (slug, PFA.mdy(a), PFA.mdy(b)))
            except FetchError as e:
                m["years"][str(y)] = {"status": "failed", "error": str(e)[:200]}
                log("  %s %d: failed (%s)" % (slug, y, str(e)[:100]))
                continue
            got = mars_feeder_rows(body) if s == 200 else []
            ds = {r.get("report_date") for r in got}
            rows = [r for r in rows if r.get("report_date") not in ds] + got
            m["years"][str(y)] = {"status": s, "from": iso_(a), "to": iso_(b), "rows": len(got), "read": now_iso()}
        save(rows_path, rows)
        sales, bad = mars_sales_of(rows, barn)
        save(os.path.join(out, "sales", slug + ".json"), sales)
        m["sales"], m["refused"] = len(sales), bad
        log("  %s (%s): %d feeder rows, %d sales, %d refused" % (slug, barn["id"], len(rows), len(sales), len(bad)))
        save(man_path, man)
    save(man_path, man)
    return man


def mars_from_dir(src_dir, out=MARS_OUT, root=FCA.ROOT, log=print):
    """Sales from MARS answers already saved (the probe's header_<slug>.json files), no network."""
    cfg = FCA.load_sources(root)
    man = {"source": MARS_SOURCE, "from_saved": src_dir, "reports": {}}
    for slug, barn in reports(cfg):
        p = os.path.join(src_dir, "header_%s.json" % slug)
        if not os.path.exists(p):
            continue
        with open(p, "rb") as f:
            rows = mars_feeder_rows(f.read())
        save(os.path.join(out, "rows", slug + ".json"), rows)
        sales, bad = mars_sales_of(rows, barn)
        save(os.path.join(out, "sales", slug + ".json"), sales)
        man["reports"][slug] = {"barn": barn["id"], "rows": len(rows), "sales": len(sales), "refused": bad}
        log("  %s (%s): %d feeder rows, %d sales, %d refused" % (slug, barn["id"], len(rows), len(sales), len(bad)))
    save(os.path.join(out, "manifest.json"), man)
    return man


# ------------------------------------------------------------------ cross-check: PDF and MARS, same sale
def _rowkey(k, r):
    return (k, r["head"], r["lo"], r["hi"], r["wt"], round(r["plo"], 2), round(r["phi"], 2), round(r["price"], 2),
            bool(r["note"]))


def compare_sale(pdf_parsed, mars_parsed):
    """[] when the two reads of one sale hold the same rows, else what differs (rows only in one)."""
    def rows_of(p):
        return sorted(_rowkey(k, r) for k, rs in (p.get("tables") or {}).items() for r in rs)
    a, b = rows_of(pdf_parsed), rows_of(mars_parsed)
    if a == b:
        return []
    from collections import Counter
    ca, cb = Counter(a), Counter(b)
    return ([["pdf only"] + list(x) for x in sorted((ca - cb).elements())] +
            [["mars only"] + list(x) for x in sorted((cb - ca).elements())])


def crosscheck(texts, mars_rows_by_slug, root=FCA.ROOT):
    """texts: [(slug, label, report text)] read by the PDF reader. For each sale MARS also
    holds: rows equal or the diff; then the index of every week built from the matched
    sales both ways. -> report dict."""
    cfg = FCA.load_sources(root)
    by_slug = dict(reports(cfg))
    sales_pdf, sales_mars, out = [], [], {"pairs": 0, "same": 0, "differ": [], "pdf_refused": 0, "not_in_mars": 0}
    seen = set()
    for slug, label, text in texts:
        barn = by_slug.get(slug)
        if not barn:
            continue
        p, why = FCA.parse_report(text)
        if p is None or not FCA.title_ok(barn, p["title"]):
            out["pdf_refused"] += 1
            continue
        good, bad = mars_reports(mars_rows_by_slug.get(slug) or [], barn)
        q = good.get(p["date"])
        if q is None:
            out["not_in_mars"] += 1
            continue
        if (slug, p["date"]) in seen:
            continue
        seen.add((slug, p["date"]))
        out["pairs"] += 1
        diff = compare_sale(p, q)
        if diff:
            out["differ"].append({"slug": slug, "barn": barn["id"], "date": p["date"], "copy": label, "diff": diff[:40]})
        else:
            out["same"] += 1
        sales_pdf.append(dict(FCA.summarize(p), barn=barn["id"], state=barn["state"]))
        sales_mars.append(dict(FCA.summarize(q), barn=barn["id"], state=barn["state"]))
    sp, sm = BFI.history_store(sales_pdf), BFI.history_store(sales_mars)
    weeks = sorted({BFI.week_start(BFI.pdate(s["date"])) for s in sales_pdf})
    out["weeks"] = []
    for w in weeks:
        a, _ = BFI.index_week(sp, w, BFI.FAR)
        b, _ = BFI.index_week(sm, w, BFI.FAR)
        out["weeks"].append({"start": iso_(w), "barns": a["barns"], "head_pdf": a["head"], "head_mars": b["head"],
                             "p_pdf": a["p"], "p_mars": b["p"], "same": {k: v for k, v in a.items() if k not in ("lo", "hi")} ==
                             {k: v for k, v in b.items() if k not in ("lo", "hi")} and a.get("lo") == b.get("lo")})
    out["weeks_same"] = sum(1 for w in out["weeks"] if w["same"])
    return out


def check_saved(out=OUT, mars_out=MARS_OUT, root=FCA.ROOT):
    """The cross-check on what is saved: every Internet Archive copy's text (text/<slug>/)
    against the MARS rows (rows/<slug>.json). Writes <mars_out>/crosscheck.json."""
    texts = []
    for p in sorted(glob.glob(os.path.join(out, "text", "*", "*.txt"))):
        with open(p, encoding="utf-8") as f:
            texts.append((os.path.basename(os.path.dirname(p)), os.path.basename(p)[:-4], f.read()))
    rows = {slug: load(os.path.join(mars_out, "rows", slug + ".json"), []) for slug in {t[0] for t in texts}}
    r = crosscheck(texts, rows, root)
    save(os.path.join(mars_out, "crosscheck.json"), r)
    return r


def archived_sales(out=OUT, root=FCA.ROOT):
    """Every archived sale with its barn id and state, for history_store."""
    cfg = FCA.load_sources(root)
    by_slug = dict(reports(cfg))
    out_ = []
    for p in sorted(glob.glob(os.path.join(out, "sales", "*.json"))):
        slug = os.path.basename(p)[:-5]
        b = by_slug.get(slug)
        if not b:
            continue
        for d, s in sorted(load(p, {}).items()):
            out_.append(dict(s, barn=b["id"], state=b["state"]))
    return out_


def mars_saved_sales(mars_out=MARS_OUT, root=FCA.ROOT):
    """Every sale the MARS reader made (history/feeder-mars/sales/), with barn and state."""
    cfg = FCA.load_sources(root)
    by_slug = dict(reports(cfg))
    out_ = []
    for p in sorted(glob.glob(os.path.join(mars_out, "sales", "*.json"))):
        b = by_slug.get(os.path.basename(p)[:-5])
        if not b:
            continue
        for d, s in sorted(load(p, {}).items()):
            out_.append(dict(s, barn=b["id"], state=b["state"], via="mars"))
    return out_


def combined_sales(out=OUT, mars_out=MARS_OUT, root=FCA.ROOT):
    """MARS first; an Internet Archive copy's sale only for a barn and week MARS does not hold.
    -> (sales, {"mars": n, "archive": n, "archive_dropped": n})"""
    ms = mars_saved_sales(mars_out, root)
    have = {(s["barn"], BFI.iso(BFI.week_start(BFI.pdate(s["date"])))) for s in ms if BFI.pdate(s.get("date"))}
    arch, dropped = [], 0
    for s in archived_sales(out, root):
        d = BFI.pdate(s.get("date"))
        if not d:
            continue
        if (s["barn"], BFI.iso(BFI.week_start(d))) in have:
            dropped += 1
            continue
        arch.append(dict(s, via="archive"))
    return ms + arch, {"mars": len(ms), "archive": len(arch), "archive_dropped": dropped}


def build(out=OUT, root=FCA.ROOT, read_date=None, dry=False, log=print, mars_out=MARS_OUT):
    read_date = read_date or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    prev = load(os.path.join(root, BFI.HISTORY), None)
    sales, n = combined_sales(out, mars_out, root)
    log("sales: %d read through MARS, %d from Internet Archive copies (%d archive copies left out: MARS holds that barn's week)"
        % (n["mars"], n["archive"], n["archive_dropped"]))
    store = BFI.history_store(sales)
    src = MARS_SOURCE if n["mars"] else SOURCE
    if n["mars"] and n["archive"]:
        src = MARS_SOURCE + "; where it lacks a barn's week, from copies of the same reports kept by the Internet Archive"
    doc = BFI.build_history(store, prev, read_date, src)
    doc["sales"] = n
    log("history: %d weeks from %s to %s, %d with a figure, %d barns" % (
        len(doc["weeks"]), doc["start"], doc["end"], doc["weeks_ok"], doc["barns"]))
    if not dry:
        BFI.write_history(root, doc)
    return doc


# ------------------------------------------------------------------ selftest
def selftest():
    import shutil
    import tempfile
    fails = []

    def ck(name, ok, detail=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  %s" % (detail,)))
        if not ok:
            fails.append(name)

    here = os.path.dirname(os.path.abspath(__file__))
    fx = os.path.join(here, "..", "test", "fixtures", "cattle-auction", "ams_1856-archive-2025-01-pypdf.txt")
    text = open(fx, encoding="utf-8").read()
    with tempfile.TemporaryDirectory() as d:
        root = os.path.join(d, "root")
        os.makedirs(os.path.join(root, "scripts"))
        os.makedirs(os.path.join(root, "data"))
        shutil.copy(os.path.join(here, "cattle_auction_sources.json"), os.path.join(root, "scripts"))
        asked = []

        def opener(u):
            asked.append(u)
            if u.endswith("/robots.txt"):
                return 404, b"", {}
            if "/cdx/" in u:
                if "ams_1856" in u:
                    return 200, json.dumps([["timestamp", "original"], ["20250111093909", "https://www.ams.usda.gov/mnreports/ams_1856.pdf"],
                                            ["20230722103902", "https://www.ams.usda.gov/mnreports/ams_1856.pdf"],
                                            ["20250112000000", "https://www.ams.usda.gov/mnreports/ams_1856.pdf"],
                                            ["20250201000000", "https://www.ams.usda.gov/mnreports/ams_1856.pdf"]]).encode(), {}
                if "ams_1245" in u:
                    return 200, json.dumps([["timestamp", "original"], ["20250111093819", "https://www.ams.usda.gov/mnreports/ams_1245.pdf"]]).encode(), {}
                return 200, b"[]", {}
            if "20250111093909id_" in u or "20250111093819id_" in u:
                return 200, b"%PDF-1.4 fixture", {}
            if "20250112000000id_" in u:
                return 200, b"<html>not a pdf</html>", {}
            return 404, b"", {}

        real = FD.pdf_to_text
        FD.pdf_to_text = lambda raw: (text, None) if raw.startswith(b"%PDF") else (None, "x")
        try:
            f = Fetcher(min_gap=0, retries=0, opener=opener, sleep=lambda s: None, ok=(200, 404))
            out = os.path.join(d, "h")
            man = fetch(datetime.date(2025, 1, 1), datetime.date(2025, 12, 31), out=out, fetch_=f, log=lambda *a: None, root=root)
            m = man["reports"]["1856"]
            ck("copies outside the dates are not asked", not any("20230722" in u for u in asked) and m["copies"] == 3, m)
            order = [re.search(r"/web/(\d+)id_", u).group(1) for u in asked if "id_/" in u]
            ck("the week with the most barns is read first", order[-1] == "20250201000000" and set(order[:3]) ==
               {"20250111093909", "20250112000000", "20250111093819"}, order)
            ck("another barn's report is refused by its title", man["reports"]["1245"]["done"]["20250111093819"].startswith("refused: title"),
               man["reports"]["1245"]["done"])
            ck("a copy is read by the barn reader", m["done"]["20250111093909"] == "read 2025-01-09", m["done"])
            ck("a web page where a PDF should be is refused, with why", m["done"]["20250112000000"] == "refused: not a PDF", m["done"])
            sales = load(os.path.join(out, "sales", "1856.json"), {})
            ck("the sale is kept by its sale date with the copy it came from",
               list(sales) == ["2025-01-09"] and sales["2025-01-09"]["copy"] == "20250111093909", list(sales))
            ck("the report text is kept", os.path.exists(os.path.join(out, "text", "1856", "20250111093909.txt")))
            n = len(asked)
            fetch(datetime.date(2025, 1, 1), datetime.date(2025, 12, 31), out=out, fetch_=f, log=lambda *a: None, root=root)
            ck("resume: no copy asked twice", not any("id_" in u for u in asked[n:]), asked[n:])
            ck("state summaries are never read", not any(s for s, _ in reports(FCA.load_sources(root))
                                                          if s in [str(x.get("slug")) for x in FCA.load_sources(root)["state_reports"]]))
            al = archived_sales(out, root)
            ck("archived sale carries barn and state", al and al[0]["barn"] == "valentine-ne" and al[0]["state"] == "NE", al[:1])
            doc = build(out, root, read_date="2026-11-02", log=lambda *a: None)
            w = {x["start"]: x for x in doc["weeks"]}
            ck("one barn: the week is withheld with its counts", w["2025-01-06"]["p"] is None and w["2025-01-06"]["barns"] == 1
               and w["2025-01-06"]["from"] == "archive", w.get("2025-01-06"))
            ck("history written", os.path.exists(os.path.join(root, BFI.HISTORY)))
            before = open(os.path.join(root, BFI.HISTORY)).read()
            build(out, root, read_date="2026-11-09", log=lambda *a: None)
            ck("a re-run changes nothing", open(os.path.join(root, BFI.HISTORY)).read() == before)
            build(out, root, read_date="2026-11-10", dry=True, log=lambda *a: None)
            ck("dry run writes nothing", open(os.path.join(root, BFI.HISTORY)).read() == before)
        finally:
            FD.pdf_to_text = real

    # MARS reader: the same sale as the PDF fixtures, row for row
    fxd = os.path.join(here, "..", "test", "fixtures", "cattle-auction")
    src = dict(reports(FCA.load_sources(FCA.ROOT)))
    for slug, pdf, mj in (("1856", "ams_1856-archive-2025-01-pypdf.txt", "mars_1856-2025-01-06.json"),
                          ("1245", "ams_1245-archive-2025-01-pypdf.txt", "mars_1245-2025-01-06.json")):
        p, _ = FCA.parse_report(open(os.path.join(fxd, pdf), encoding="utf-8").read())
        mrows = load(os.path.join(fxd, mj), [])
        good, bad = mars_reports(mrows, src[slug])
        ck("MARS %s: the PDF's sale, the same rows" % slug, p["date"] in good and not bad and compare_sale(p, good[p["date"]]) == [],
           (list(good), bad, p and compare_sale(p, good.get(p["date"], {}))[:3]))
        ck("MARS %s: the same summary as the PDF reader" % slug,
           {k: v for k, v in FCA.summarize(good[p["date"]]).items() if k != "receipts"} ==
           {k: v for k, v in FCA.summarize(p).items() if k != "receipts"})
    v = load(os.path.join(fxd, "mars_1856-2025-01-06.json"), [])
    good, bad = mars_reports([dict(r, report_title="Some Other Barn - Elsewhere, KS") for r in v], src["1856"])
    ck("MARS: a report whose title does not name the barn is refused", not good and list(bad.values())[0].startswith("title"), bad)
    bent = [dict(r) for r in v]
    k = next(i for i, r in enumerate(bent) if mars_key(r))
    bent[k]["avg_price"] = bent[k]["avg_price_max"] + 5
    good, bad = mars_reports(bent, src["1856"])
    ck("MARS: one misread row refuses the whole sale", not good and "outside its own range" in list(bad.values())[0], bad)
    good, _ = mars_reports([dict(r, lot_desc="Replacement") if r.get("class") == "Steers" else r for r in v], src["1856"])
    s1 = FCA.summarize(good["2025-01-09"])
    ck("MARS: a row with a note is counted out of the class average", s1["noted_head"] > 0 and not any(
        k.startswith("steers") for k in s1["classes"]), s1["noted_head"])
    ck("MARS: rows the PDF reader never reads are not read", mars_key({"commodity": "Feeder Cattle", "class": "Dairy Steers", "frame": "Large",
       "muscle_grade": "3", "price_unit": "Per Cwt", "weight_collect": "Actual"}) is None and
       mars_key({"commodity": "Replacement Cattle", "class": "Heifers", "frame": "Medium and Large", "muscle_grade": "1",
                 "price_unit": "Per Cwt", "weight_collect": "Actual"}) is None and
       mars_key({"commodity": "Feeder Cattle", "class": "Steers", "frame": "Medium and Large", "muscle_grade": "1",
                 "price_unit": "Per Unit", "weight_collect": "Actual"}) is None)
    sales, _ = mars_sales_of([dict(r, final_ind="Preliminary") for r in v], src["1856"])
    ck("MARS: a preliminary sale is marked", sales["2025-01-09"].get("preliminary") is True)

    # MARS first; an archive copy only for a barn and week MARS lacks
    with tempfile.TemporaryDirectory() as d:
        root = os.path.join(d, "root")
        os.makedirs(os.path.join(root, "scripts"))
        os.makedirs(os.path.join(root, "data"))
        shutil.copy(os.path.join(here, "cattle_auction_sources.json"), os.path.join(root, "scripts"))
        ia, mo = os.path.join(d, "ia"), os.path.join(d, "mars")
        sale = FCA.summarize(FCA.parse_report(open(os.path.join(fxd, "ams_1856-archive-2025-01-pypdf.txt"), encoding="utf-8").read())[0])
        save(os.path.join(ia, "sales", "1856.json"), {"2025-01-09": dict(sale, copy="x"), "2025-02-06": dict(sale, date="2025-02-06", copy="y")})
        save(os.path.join(mo, "sales", "1856.json"), {"2025-01-10": dict(sale, date="2025-01-10")})
        al, n = combined_sales(ia, mo, root)
        ck("combined: MARS holds the week, the archive copy of it is left out; another week comes from the archive",
           n == {"mars": 1, "archive": 1, "archive_dropped": 1} and sorted((x["date"], x["via"]) for x in al) ==
           [("2025-01-10", "mars"), ("2025-02-06", "archive")], (n, [(x["date"], x["via"]) for x in al]))
        doc = build(ia, root, read_date="2026-11-03", log=lambda *a: None, mars_out=mo)
        w = {x["start"]: x for x in doc["weeks"]}
        ck("combined: each week says how its barns were read", w["2025-01-06"]["via"] == {"mars": 1} and
           w["2025-02-03"]["via"] == {"archive": 1} and w["2025-01-13"]["via"] == {}, (w["2025-01-06"].get("via"), w["2025-02-03"].get("via")))
        ck("combined: the file names both sources", "My Market News" in doc["source"] and "Internet Archive" in doc["source"], doc["source"])

        # the fetch: one ask per report and year, the key only in the header, feeder rows saved
        os.environ["MARS_API_KEY"] = "test-key-not-real"
        asked = []

        def mop(u):
            asked.append(u)
            if "/reports/1856?" in u and "01/01/2025" in u:
                return 200, json.dumps({"results": v + [{"commodity": "Slaughter Cattle", "report_date": "01/09/2025"}]}).encode(), {}
            return 200, json.dumps({"results": []}).encode(), {}
        try:
            f = Fetcher(min_gap=0, retries=0, opener=mop, sleep=lambda s: None, ok=(200, 204, 404))
            man = mars_fetch(datetime.date(2024, 6, 1), datetime.date(2025, 3, 1), out=mo, fetch_=f, log=lambda *a: None, root=root)
            n_rep = len(reports(FCA.load_sources(root)))
            ck("fetch: every report asked once per year", len(asked) == 2 * n_rep, (len(asked), n_rep))
            ck("fetch: the key is never in a URL or a saved file", not any("test-key" in u for u in asked) and
               not any("test-key" in open(os.path.join(dp, x), errors="ignore").read() for dp, _, fs in os.walk(mo) for x in fs))
            rows = load(os.path.join(mo, "rows", "1856.json"), [])
            ck("fetch: only feeder rows kept, sale read", rows and all(r["commodity"] == "Feeder Cattle" for r in rows) and
               man["reports"]["1856"]["sales"] == 1 and "2025-01-09" in load(os.path.join(mo, "sales", "1856.json"), {}))
            n0 = len(asked)
            mars_fetch(datetime.date(2024, 6, 1), datetime.date(2025, 3, 1), out=mo, fetch_=f, log=lambda *a: None, root=root)
            ck("fetch: a re-run asks only the last year again", len(asked) - n0 == n_rep, len(asked) - n0)
            os.remove(os.path.join(mo, "rows", "1856.json"))
            n0 = len(asked)
            mars_fetch(datetime.date(2024, 6, 1), datetime.date(2025, 3, 1), out=mo, fetch_=f, log=lambda *a: None, root=root)
            ck("fetch: a report whose saved rows are missing is asked again in full", len(asked) - n0 == n_rep + 1 and
               load(os.path.join(mo, "sales", "1856.json"), {}), len(asked) - n0)
        finally:
            os.environ.pop("MARS_API_KEY", None)
        ck("fetch: no key, nothing asked", mars_fetch(datetime.date(2024, 6, 1), datetime.date(2025, 3, 1), out=mo,
                                                      log=lambda *a: None, root=root) is None)
    print("backfill_feeder_index selftest: %d failure(s)" % len(fails))
    return 1 if fails else 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="backfill_feeder_index.py")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--build", action="store_true")
    ap.add_argument("--mars-fetch", action="store_true")
    ap.add_argument("--mars-saved", default="")
    ap.add_argument("--mars-check", action="store_true")
    ap.add_argument("--mars-out", default=MARS_OUT)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--from", dest="d0", default="2025-01-01")
    ap.add_argument("--to", dest="d1", default="")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--max-minutes", type=float, default=0)
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    if not (a.fetch or a.build or a.mars_fetch or a.mars_saved or a.mars_check):
        print("nothing to do: --fetch, --mars-fetch, --mars-saved DIR, --mars-check, --build or --selftest")
        return 2
    for v in (a.d0, a.d1):
        if v and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            print("dates are YYYY-MM-DD")
            return 2
    if a.mars_fetch:
        d1 = datetime.date.fromisoformat(a.d1) if a.d1 else BFI.IDX_START - datetime.timedelta(days=1)
        if mars_fetch(datetime.date.fromisoformat(a.d0), d1, out=a.mars_out, minutes=a.max_minutes) is None:
            return 1
    if a.mars_saved:
        mars_from_dir(a.mars_saved, out=a.mars_out)
    if a.mars_check:
        r = check_saved(a.out, a.mars_out)
        print("cross-check: %d sales read both ways, %d the same row for row, %d differ; %d weeks, %d the same index"
              % (r["pairs"], r["same"], len(r["differ"]), len(r["weeks"]), r["weeks_same"]))
    if a.fetch:
        d0 = datetime.date.fromisoformat(a.d0)
        d1 = datetime.date.fromisoformat(a.d1) if a.d1 else BFI.IDX_START - datetime.timedelta(days=1)
        fetch(d0, d1, out=a.out, minutes=a.max_minutes)
    if a.build:
        build(a.out, dry=a.dry_run, mars_out=a.mars_out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
