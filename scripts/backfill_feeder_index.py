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
So this reads the Internet Archive copies. A week gets only the barns a copy
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
  --build [--dry-run]
      sales/*.json -> build_feeder_index.build_history -> data/feeder-index-history.json
      (only weeks before the live record starts; a re-run changes nothing).

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


def build(out=OUT, root=FCA.ROOT, read_date=None, dry=False, log=print):
    read_date = read_date or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    prev = load(os.path.join(root, BFI.HISTORY), None)
    store = BFI.history_store(archived_sales(out, root))
    doc = BFI.build_history(store, prev, read_date, SOURCE)
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
    print("backfill_feeder_index selftest: %d failure(s)" % len(fails))
    return 1 if fails else 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="backfill_feeder_index.py")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--build", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--from", dest="d0", default="2025-01-01")
    ap.add_argument("--to", dest="d1", default="")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--max-minutes", type=float, default=0)
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    if not (a.fetch or a.build):
        print("nothing to do: --fetch, --build or --selftest")
        return 2
    if a.fetch:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", a.d0) or (a.d1 and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", a.d1)):
            print("dates are YYYY-MM-DD")
            return 2
        d0 = datetime.date.fromisoformat(a.d0)
        d1 = datetime.date.fromisoformat(a.d1) if a.d1 else BFI.IDX_START - datetime.timedelta(days=1)
        fetch(d0, d1, out=a.out, minutes=a.max_minutes)
    if a.build:
        build(a.out, dry=a.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
