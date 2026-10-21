#!/usr/bin/env python3
"""history_append.py -- ongoing history pieces that ride an existing job's
schedule (no new cron), saved to the private raw branch by that job.

  cattle   after cattle-auction.yml writes data/cattle-auction.json: every
           barn's sales in the feed (the latest two each, AMS and own
           reports) with their receipts (head sold that day, as the report
           prints it) and the feeder head the page's classes counted, to
             history/cattle-auction/receipts/<YYYY>/<YYYY-MM-DD>.csv
           one file per Central-time run day (a later run that day rewrites
           it with the same or newer sales). A sale shows up on more than one
           day's file until it is two sales old; load_receipts() keeps one row
           per barn and sale date, the last seen. No file is ever merged with
           what is on raw, so a failed read of raw can never shorten the record.

    python3 scripts/history_append.py cattle [--feed data/cattle-auction.json] [--out history/cattle-auction]
    python3 scripts/history_append.py receipts DIR      # print one row per barn and sale (JSON lines)
    python3 scripts/history_append.py --selftest
"""
import argparse
import csv
import glob
import json
import os
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

OUT = "history/cattle-auction"
FEED = "data/cattle-auction.json"
COLS = ["barn_id", "kind", "name", "town", "state", "sale_date", "receipts", "feeder_head", "report", "seen"]


def feeder_head(sale):
    """Head in the classes the page pooled (AMS reports); None for own-report barns."""
    cl = sale.get("classes")
    if not isinstance(cl, dict):
        return None
    n = 0
    for tab in cl.values():
        for c in (tab or {}).values():
            if isinstance(c, dict) and isinstance(c.get("head"), int):
                n += c["head"]
    return n


def cattle_rows(doc, seen):
    rows = []
    for kind, barns in (("ams", doc.get("barns") or []), ("own", doc.get("own") or [])):
        for b in barns:
            for s in b.get("sales") or []:
                if not s.get("date"):
                    continue
                rec = s.get("receipts")
                rows.append([b.get("id"), kind, b.get("name"), b.get("town"), b.get("state"), s["date"],
                             rec if isinstance(rec, int) and not isinstance(rec, bool) else None,
                             feeder_head(s), s.get("source_url") or b.get("source_url") or b.get("slug"), seen])
    rows.sort(key=lambda r: (str(r[0]), r[5]))
    return rows


def write_cattle(feed=FEED, out=OUT, now=None):
    now = now or datetime.now(timezone.utc)
    day = now.astimezone(ZoneInfo("America/Chicago")).date().isoformat()
    with open(feed, encoding="utf-8") as f:
        doc = json.load(f)
    rows = cattle_rows(doc, now.strftime("%Y-%m-%dT%H:%M:%SZ"))
    if not rows:
        return None, 0
    p = os.path.join(out, "receipts", day[:4], f"{day}.csv")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(COLS)
        for r in rows:
            w.writerow(["" if v is None else v for v in r])
    return p, len(rows)


def load_receipts(folder):
    """Every day file under folder/receipts -> one dict per (barn, sale date), the last seen."""
    best = {}
    for p in sorted(glob.glob(os.path.join(folder, "receipts", "*", "*.csv"))):
        with open(p, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                k = (r["barn_id"], r["sale_date"])
                if k not in best or r["seen"] >= best[k]["seen"]:
                    best[k] = r
    return [best[k] for k in sorted(best)]


def selftest():
    import tempfile
    from datetime import timedelta
    fails = []

    def ck(name, ok, detail=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  {detail}"))
        if not ok:
            fails.append(name)

    fx = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "fixtures", "history", "cattle", "cattle-auction.json")
    with tempfile.TemporaryDirectory() as d:
        t1 = datetime(2026, 10, 21, 1, 30, tzinfo=timezone.utc)          # Oct 20 evening, Central
        p, n = write_cattle(fx, d, now=t1)
        ck("one file per Central day", p.endswith("receipts/2026/2026-10-20.csv"), p)
        doc = json.load(open(fx))
        ck("every sale in the feed", n == sum(len(b.get("sales") or []) for b in doc["barns"] + doc["own"]), n)
        rows = list(csv.DictReader(open(p)))
        oz = [r for r in rows if r["barn_id"] == "ozark-ar"]
        ck("receipts and feeder head kept", oz[0]["receipts"] == "368" and oz[0]["feeder_head"] == "107", oz)
        ck("own report: receipts, no class head", [r for r in rows if r["kind"] == "own"][0]["feeder_head"] == "")
        ck("no receipts printed: blank, never 0", any(r["receipts"] == "" for r in rows))
        # next day: the barn sold again; the old sale is in both files, once in the history
        doc["barns"][0]["sales"].insert(0, dict(doc["barns"][0]["sales"][0], date="2026-10-22", receipts=410))
        doc["barns"][0]["sales"] = doc["barns"][0]["sales"][:2]
        fx2 = os.path.join(d, "feed2.json")
        json.dump(doc, open(fx2, "w"))
        write_cattle(fx2, d, now=t1 + timedelta(days=2))
        hist = load_receipts(d)
        oz = [r for r in hist if r["barn_id"] == "ozark-ar"]
        ck("history: one row per barn and sale", [r["sale_date"] for r in oz] == ["2026-10-15", "2026-10-22"], [r["sale_date"] for r in oz])
        ck("history: the newest file wins a repeat", [r for r in oz if r["sale_date"] == "2026-10-15"][0]["seen"].startswith("2026-10-23"))
        ck("nothing about a person", not any("@" in v for r in hist for v in r.values()))
    print(f"history_append selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["--selftest"]:
        return selftest()
    ap = argparse.ArgumentParser(prog="history_append.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("cattle")
    s.add_argument("--feed", default=FEED)
    s.add_argument("--out", default=OUT)
    s = sub.add_parser("receipts")
    s.add_argument("dir")
    a = ap.parse_args(argv)
    if a.cmd == "cattle":
        p, n = write_cattle(a.feed, a.out)
        print(f"cattle receipts history: {n} sales -> {p}" if p else "cattle receipts history: no sales in the feed")
        return 0
    for r in load_receipts(a.dir):
        print(json.dumps(r))
    return 0


if __name__ == "__main__":
    sys.exit(main())
