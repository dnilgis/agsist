#!/usr/bin/env python3
"""build_wasde_history.py -- the small public files behind "How this estimate moved".

Reads the U.S. grain rows scripts/backfill_wasde.py saved (history/wasde/us-grains/,
pulled from the private raw branch) and writes, for the site, loaded only when a
reader opens the section on /whats-priced-in:

  data/wasde-history/index.json       what is there: reports, years, months with no report on file
  data/wasde-history/corn.json        every U.S. balance sheet line, every market year,
  data/wasde-history/soybeans.json    as each monthly WASDE printed it, so a figure's
  data/wasde-history/wheat.json       path from first projection to last estimate shows

Honest numbers (BUILD-RULES, honest-numbers skill):
  - Only the U.S. supply and use tables (title starts "U.S."), annual rows, the
    crop's own table, bushel-and-acre units. World tables, quarterly rows, the
    wheat-by-class table and metric units are left out and counted.
  - A report that prints last month's column beside this month's: rows whose
    forecast month is not the report's own month are last month's column and
    are left out (that figure is already on file from last month's report).
  - Two different values for one line in one report: the figure is withheld,
    never picked, and the count is published in index.json.
  - A file USDA re-issued (a V2) replaces the first copy for the reports it holds.
  - A non-number (n/a, a range) is left out and counted.
  - Too little history (--min-reports per crop with ending stocks) writes
    nothing and exits 2: a thin file must not look like the archive.

    python3 scripts/build_wasde_history.py [--src history/wasde/us-grains] [--out data/wasde-history]
    python3 scripts/build_wasde_history.py --selftest

Stdlib only, no network.
"""
import argparse
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import history_lib as H  # noqa: E402
from backfill_wasde import EXTRACT_HEAD, LANDING, iso_date  # noqa: E402

SRC = os.path.join(H.ROOT, "history", "wasde", "us-grains")
OUT = os.path.join(H.ROOT, "data", "wasde-history")
CROPS = {"corn": "Corn", "soybeans": "Soybeans", "wheat": "Wheat"}
SOURCE = {"name": "USDA World Agricultural Outlook Board, WASDE report data as published each month",
          "url": LANDING}
NOTE = ("Each figure as that month's WASDE printed it, for the U.S. supply and use tables. USDA notes these keep "
        "estimates as published and leave out later revisions to the underlying series; the reports themselves "
        "are the official record.")
ORDER = ["area planted", "area harvested", "yield", "beginning stocks", "production", "imports", "supply",
         "feed", "food", "ethanol", "seed", "crush", "domestic", "exports", "use, total", "total use", "ending stocks",
         "farm price", "price"]
VER_RE = re.compile(r"-v(\d+)$", re.I)
MY_RE = re.compile(r"^\d{4}/\d{2}$")


def crop_of(commodity, title):
    c, t = (commodity or "").strip().lower(), (title or "").strip().lower()
    if not t.startswith("u.s."):
        return None, "not_us_table"
    if c == "corn" and "corn" in t:
        return "corn", None
    if c == "soybeans" and "soybean" in t:
        return "soybeans", None
    if c in ("wheat", "all wheat") and "wheat" in t and "by class" not in t:
        return "wheat", None
    return None, "other_table"


def num(s):
    s = (s or "").replace(",", "").strip()
    if not re.fullmatch(r"-?\d+(\.\d+)?", s):
        return None
    v = float(s)
    return int(v) if v.is_integer() else round(v, 3)


def rank(attr):
    a = attr.lower()
    for i, k in enumerate(ORDER):
        if k in a:
            return (i, a)
    return (len(ORDER), a)


def version(label):
    m = VER_RE.search(label or "")
    return int(m.group(1)) if m else 1


def load(src):
    """All extract rows as dicts, oldest file first."""
    rows = []
    for p in sorted(glob.glob(os.path.join(src, "*.csv.gz"))):
        head, recs = H.read_csv_gz(p)
        if head != EXTRACT_HEAD:
            raise ValueError(f"{p}: unexpected header {head}")
        rows += [dict(zip(head, r)) for r in recs]
    return rows


def build(rows):
    """-> ({crop: doc}, index) built from extract rows."""
    dropped = {}

    def drop(why):
        dropped[why] = dropped.get(why, 0) + 1

    # a re-issued file (V2) replaces the first copy for every report it holds
    best = {}
    for r in rows:
        k = r["wasde"].strip()
        best[k] = max(best.get(k, (0, "")), (version(r["file"]), r["file"]))
    cells, flags, reports = {}, {}, {}
    for r in rows:
        if (version(r["file"]), r["file"]) != best[r["wasde"].strip()]:
            drop("replaced_by_reissue")
            continue
        crop, why = crop_of(r["commodity"], r["title"])
        if not crop:
            drop(why)
            continue
        if (r["annual_quarter"] or "").strip().lower() not in ("", "annual"):
            drop("quarterly_row")
            continue
        unit = (r["unit"] or "").strip()
        if "metric" in unit.lower():
            drop("metric_unit")
            continue
        d = iso_date(r["release_date"]) or iso_date(r["report_date"])
        if not d:
            drop("no_date")
            continue
        fy, fm = (r["forecast_year"] or "").strip(), (r["forecast_month"] or "").strip()
        if fy.isdigit() and fm.isdigit() and (int(fy), int(fm)) != (int(d[:4]), int(d[5:7])):
            drop("last_months_column")
            continue
        my = (r["market_year"] or "").strip()
        if not MY_RE.match(my):
            drop("no_market_year")
            continue
        v = num(r["value"])
        if v is None:
            drop("not_a_number")
            continue
        attr = re.sub(r"\s+", " ", r["attribute"]).strip()
        reports.setdefault(crop, {})[d] = r["wasde"].strip()
        cells.setdefault((crop, my, attr, unit, d), set()).add(v)
        f = (r["proj_est"] or "").strip()
        flags.setdefault((crop, my, d), set()).add(f)
    withheld = []
    docs = {}
    for crop, label in CROPS.items():
        reps = sorted((reports.get(crop) or {}).items())
        ri = {d: i for i, (d, _) in enumerate(reps)}
        series = sorted({(k[2], k[3]) for k in cells if k[0] == crop}, key=lambda s: (rank(s[0]), s[1]))
        si = {s: i for i, s in enumerate(series)}
        years = {}
        for (c, my, attr, unit, d), vals in sorted(cells.items()):
            if c != crop:
                continue
            y = years.setdefault(my, {"f": {}, "s": {}})
            if len(vals) > 1:
                withheld.append({"crop": crop, "market_year": my, "line": attr, "report": d, "values": sorted(vals)})
                continue
            y["s"].setdefault(str(si[(attr, unit)]), []).append([ri[d], next(iter(vals))])
            fl = flags.get((c, my, d)) or set()
            if len(fl) == 1 and next(iter(fl)):
                y["f"][str(ri[d])] = next(iter(fl))
        for y in years.values():
            for pts in y["s"].values():
                pts.sort()
            y["f"] = [[int(k), v] for k, v in sorted(y["f"].items(), key=lambda kv: int(kv[0]))]
        docs[crop] = {"crop": crop, "label": label, "source": SOURCE, "note": NOTE,
                      "reports": [[d, n] for d, n in reps],
                      "series": [{"line": a, "unit": u} for a, u in series],
                      "years": dict(sorted(years.items()))}
    alld = sorted({d for c in reports.values() for d in c})
    have = {d[:7] for d in alld}
    missing = []
    if alld:
        y, m = int(alld[0][:4]), int(alld[0][5:7])
        while f"{y:04d}-{m:02d}" <= alld[-1][:7]:
            if f"{y:04d}-{m:02d}" not in have:
                missing.append(f"{y:04d}-{m:02d}")
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    index = {"source": SOURCE, "note": NOTE, "first": alld[0] if alld else None, "through": alld[-1] if alld else None,
             "reports": len(alld), "months_with_no_report_on_file": missing,
             "withheld": withheld, "left_out": dict(sorted(dropped.items())),
             "crops": {c: {"file": f"/data/wasde-history/{c}.json", "label": d["label"], "reports": len(d["reports"]),
                           "market_years": [min(d["years"]), max(d["years"])] if d["years"] else None,
                           "lines": len(d["series"])} for c, d in docs.items()}}
    return docs, index


def ending_stock_reports(doc):
    idx = [i for i, s in enumerate(doc["series"]) if s["line"].lower() == "ending stocks"]
    rs = set()
    for y in doc["years"].values():
        for i in idx:
            rs |= {p[0] for p in y["s"].get(str(i), [])}
    return len(rs)


def dump(obj):
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False, sort_keys=False) + "\n"


def write(docs, index, out, min_reports):
    thin = {c: ending_stock_reports(d) for c, d in docs.items() if ending_stock_reports(d) < min_reports}
    if thin:
        print(f"wasde history: not written; too few reports with ending stocks {thin} (need {min_reports} each)")
        return 2
    os.makedirs(out, exist_ok=True)
    sizes = {}
    for c, d in docs.items():
        s = dump(d)
        with open(os.path.join(out, f"{c}.json"), "w", encoding="utf-8") as f:
            f.write(s)
        sizes[c] = len(s.encode())
        index["crops"][c]["bytes"] = sizes[c]
    with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps(index, indent=1, ensure_ascii=False) + "\n")
    print(f"wasde history: {index['reports']} reports, {index['first']} to {index['through']}; "
          f"bytes {sizes}; withheld {len(index['withheld'])}; left out {index['left_out']}")
    return 0


def selftest():
    import csv
    import io
    import tempfile
    from backfill_wasde import FIX, extract
    fails = []

    def ck(name, ok, detail=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  {detail}"))
        if not ok:
            fails.append(name)

    rows = []
    for fn, label in [("data-2010-04-to-2015-12.csv", "oce-wasde-report-data-2010-04-to-2015-12"),
                      ("data-2026-09.csv", "oce-wasde-report-data-2026-09"),
                      ("data-2026-10.csv", "oce-wasde-report-data-2026-10")]:
        with open(os.path.join(FIX, fn), encoding="utf-8") as f:
            ex, _ = extract(f.read(), label)
        rows += [dict(zip(EXTRACT_HEAD, r)) for r in ex]
    # a re-issue of the September report with one corrected figure
    with open(os.path.join(FIX, "data-2026-09.csv"), encoding="utf-8") as f:
        v2 = f.read().replace(",1500,Million Bushels,2026-09-11", ",1510,Million Bushels,2026-09-11")
    ex, _ = extract(v2, "oce-wasde-report-data-2026-09-V2")
    rows += [dict(zip(EXTRACT_HEAD, r)) for r in ex]
    docs, index = build(rows)
    corn = docs["corn"]
    si = {(s["line"], s["unit"]): i for i, s in enumerate(corn["series"])}
    dates = [d for d, _ in corn["reports"]]
    es = corn["years"]["2026/27"]["s"][str(si[("Ending Stocks", "Million Bushels")])]
    ck("2026/27 corn ending stocks moved Sep -> Oct, the V2 figure and not last month's column",
       [(dates[i], v) for i, v in es] == [("2026-09-11", 1510), ("2026-10-09", 1800)], es)
    ck("two values for one line in one report are withheld",
       [(w["line"], w["report"], w["values"]) for w in index["withheld"]] == [("Production", "2026-10-09", [16000, 16001])], index["withheld"])
    pr = corn["years"]["2026/27"]["s"][str(si[("Production", "Million Bushels")])]
    ck("the withheld cell is absent, the month before stays", [(dates[i], v) for i, v in pr] == [("2026-09-11", 15800)], pr)
    lo = index["left_out"]
    ck("world table, quarterly row, n/a, by-class and other crops left out and counted",
       lo.get("not_us_table") == 1 and lo.get("quarterly_row") == 1 and lo.get("not_a_number") == 1
       and lo.get("other_table") == 1 and lo.get("last_months_column") == 1 and lo.get("replaced_by_reissue") == 5, lo)
    ck("series in balance sheet order", [s["line"] for s in corn["series"]][:3] == ["Yield per Harvested Acre", "Production", "Ending Stocks"],
       corn["series"])
    ck("a market year carries its own path: 2009/10 Proj. in April, Est. in May",
       corn["years"]["2009/10"]["f"] == [[0, "Proj."], [1, "Est."]], corn["years"]["2009/10"])
    ck("wheat by class not mixed in", [p[1] for y in docs["wheat"]["years"].values() for p in y["s"].get("0", [])] == [950, 1000, 700, 740],
       docs["wheat"]["years"])
    ck("months with no report on file are listed, not filled", "2010-06" in index["months_with_no_report_on_file"]
       and "2026-09" not in index["months_with_no_report_on_file"] and index["first"] == "2010-04-09"
       and index["through"] == "2026-10-09", index["months_with_no_report_on_file"][:3])
    with tempfile.TemporaryDirectory() as d:
        ck("too little history writes nothing", write(*build(rows), d, 5) == 2 and not os.listdir(d))
        ck("enough history writes four files", write(docs, index, d, 1) == 0 and sorted(os.listdir(d)) ==
           ["corn.json", "index.json", "soybeans.json", "wheat.json"])
        with open(os.path.join(d, "corn.json"), encoding="utf-8") as f:
            back = json.load(f)
        ck("file round trip, source credited", back["years"] == json.loads(dump(corn))["years"]
           and back["source"]["url"].startswith("https://www.usda.gov/"))
        with open(os.path.join(d, "index.json"), encoding="utf-8") as f:
            ix = json.load(f)
        ck("index carries each file's bytes", all(ix["crops"][c]["bytes"] > 0 for c in CROPS), ix["crops"])
        # the same rows give the same bytes (a rerun is no change on main)
        d2 = os.path.join(d, "again")
        write(*build(rows), d2, 1)
        ck("deterministic", all(open(os.path.join(d, f), "rb").read() == open(os.path.join(d2, f), "rb").read()
                                for f in ("corn.json", "index.json")))
        # extract round trip through the gz files the fetcher writes
        src = os.path.join(d, "src")
        H.write_csv_gz(os.path.join(src, "a.csv.gz"), EXTRACT_HEAD, [[r[k] for k in EXTRACT_HEAD] for r in rows])
        ck("reads the fetcher's extract files", build(load(src))[1]["reports"] == index["reports"])
        H.write_csv_gz(os.path.join(src, "b.csv.gz"), ["x"], [["1"]])
        try:
            load(src)
            ck("a foreign file is refused", False)
        except ValueError:
            ck("a foreign file is refused", True)
    _ = (csv, io)
    print(f"build_wasde_history selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--src", default=SRC)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--min-reports", type=int, default=100)
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    rows = load(a.src)
    if not rows:
        print(f"wasde history: no extract files in {a.src}; nothing written")
        return 2
    docs, index = build(rows)
    return write(docs, index, a.out, a.min_reports)


if __name__ == "__main__":
    sys.exit(main())
