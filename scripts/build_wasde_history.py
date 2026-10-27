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
from backfill_wasde import ESMIS, EXTRACT_HEAD, LANDING, iso_date  # noqa: E402

SRC = os.path.join(H.ROOT, "history", "wasde", "us-grains")
OUT = os.path.join(H.ROOT, "data", "wasde-history")
CROPS = {"corn": "Corn", "soybeans": "Soybeans", "wheat": "Wheat"}
SOURCE = {"name": "USDA World Agricultural Outlook Board, WASDE report data as published each month",
          "url": LANDING}
NOTE = ("Each figure as that month's WASDE printed it, for the U.S. supply and use tables. USDA notes these keep "
        "estimates as published and leave out later revisions to the underlying series; the reports themselves "
        "are the official record.")
# Since Oct 27 the archive reads the reports themselves from USDA's ESMIS archive (usda.gov's data
# page refuses the runners). The credit follows the rows actually used.
SOURCE_ESMIS = {"name": "USDA World Agricultural Outlook Board, monthly WASDE reports (USDA ESMIS archive)",
                "url": ESMIS}
NOTE_ESMIS = ("Each figure as that month's WASDE printed it, read from the U.S. supply and use tables of the report "
              "itself. A column that does not add up on its own balance sheet is left out, never corrected.")
# Market years before this go to one file a decade (corn-1990s.json ...), loaded only when a reader
# picks one of those years, so the file that opens first stays small (BUILD-RULES: history on demand).
PART_BEFORE = "2000/01"
MAX_WITHHELD_LISTED = 300
ORDER = ["area planted", "area harvested", "yield", "beginning stocks", "production", "imports", "supply",
         "feed", "food", "ethanol", "seed", "crush", "domestic", "exports", "use, total", "total use", "ending stocks",
         "farm price", "price"]
# The site loads one crop file when a reader opens the section (BUILD-RULES: bulky history on demand).
# Expected about 70 KB a crop; past this the build refuses and says so rather than ship a heavy file.
MAX_FILE_BYTES = 400_000
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
        b = best[r["wasde"].strip()]
        if (version(r["file"]), r["file"]) != b:
            drop("replaced_by_reissue" if version(r["file"]) < b[0] else "other_copy_of_the_same_report")
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
    used = {best[k][1] for k in best}
    esmis = any(f.startswith("esmis-") for f in used)
    csvs = any(not f.startswith("esmis-") for f in used)
    source = SOURCE_ESMIS if esmis else SOURCE
    note = NOTE_ESMIS if esmis else NOTE
    sources = ([SOURCE_ESMIS] if esmis else []) + ([SOURCE] if csvs else [])
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
        docs[crop] = {"crop": crop, "label": label, "source": source, "note": note,
                      "reports": [[d, n] for d, n in reps],
                      "series": [{"line": a, "unit": u} for a, u in series]}
        rn = report_notes(docs[crop])
        if rn:
            docs[crop]["report_notes"] = rn
        docs[crop]["years"] = dict(sorted(years.items()))
    alld = sorted({d for c in reports.values() for d in c})
    have = {d[:7] for d in alld}
    missing = []
    if alld:
        y, m = int(alld[0][:4]), int(alld[0][5:7])
        while f"{y:04d}-{m:02d}" <= alld[-1][:7]:
            if f"{y:04d}-{m:02d}" not in have:
                missing.append(f"{y:04d}-{m:02d}")
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    index = {"source": source, "sources": sources, "note": note, "first": alld[0] if alld else None, "through": alld[-1] if alld else None,
             "reports": len(alld), "months_with_no_report_on_file": missing,
             "withheld_count": len(withheld), "withheld": withheld[:MAX_WITHHELD_LISTED],
             "left_out": dict(sorted(dropped.items())),
             "crops": {c: {"file": f"/data/wasde-history/{c}.json", "label": d["label"], "reports": len(d["reports"]),
                           "market_years": [min(d["years"]), max(d["years"])] if d["years"] else None,
                           "lines": len(d["series"])} for c, d in docs.items()}}
    return docs, index


METRIC_LINE = {"yield": "Yield per Harvested Acre"}


def report_notes(doc, corrections=None):
    """USDA corrections to a figure a WASDE carried, by report date (data/usda-corrections.json).
    The WASDE figure stays as printed: a note goes beside the report, never a new number in the
    series. NASS corrected the Sep 11, 2026 Crop Production corn yield on Oct 23, 2026; whether the
    September WASDE itself was reissued is not known, so its 178.5 stays."""
    import usda_corrections as UC
    cs = UC.load() if corrections is None else corrections
    have = {d for d, _ in doc.get("reports") or []}
    out = {}
    for c in cs:
        if c.get("crop") != doc.get("crop"):
            continue
        for ci in c.get("carried_in") or []:
            if ci.get("report") != "wasde" or ci.get("release") not in have:
                continue
            cv = UC.view(c, ci.get("geo") or "US")
            if not cv:
                continue
            y = int(ci["release"][:4])
            if ci.get("reissued") is True:
                tail = "USDA reissued this WASDE with the corrected figure."
            elif ci.get("reissued") is False:
                tail = "USDA did not reissue this WASDE; its figure is left as printed."
            else:
                tail = "This WASDE figure is left as printed; whether USDA reissued the WASDE is not known."
            out.setdefault(ci["release"], []).append({
                "id": c["id"], "market_year": "%d/%02d" % (y, (y + 1) % 100),
                "line": METRIC_LINE.get(c.get("metric")), "printed": cv["printed"], "corrected": cv["corrected"],
                "notice_date": cv["notice_date"], "source": cv["source"], "reissued": ci.get("reissued"),
                "note": "USDA correction, %s: NASS corrected the %s %s %s %s behind this report to %s %s, from %s. %s"
                        % (UC.short_date(cv["notice_date"]), UC.long_day(cv["release"]), cv["report"], cv["crop"],
                           cv["metric"], cv["corrected"], cv["unit"], cv["printed"], tail)})
    return dict(sorted(out.items()))


def refresh_notes(out):
    """Put the report notes on the files already written, without the raw rows: the notes come
    from the corrections table, not from the reports. Same key order and bytes as a full build.
    Returns the number of files changed."""
    ip = os.path.join(out, "index.json")
    with open(ip, encoding="utf-8") as f:
        index = json.load(f)
    changed = 0
    for c in CROPS:
        p = os.path.join(out, f"{c}.json")
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as f:
            doc = json.load(f)
        base = {k: v for k, v in doc.items() if k not in ("report_notes", "years", "parts")}
        rn = report_notes(doc)
        if rn:
            base["report_notes"] = rn
        base["years"] = doc.get("years", {})
        if "parts" in doc:
            base["parts"] = doc["parts"]
        t = dump(base)
        with open(p, encoding="utf-8") as f:
            old = f.read()
        if t != old:
            with open(p, "w", encoding="utf-8") as f:
                f.write(t)
            changed += 1
        if c in (index.get("crops") or {}):
            index["crops"][c]["bytes"] = len(t.encode())
    t = json.dumps(index, indent=1, ensure_ascii=False) + "\n"
    with open(ip, encoding="utf-8") as f:
        if f.read() != t:
            changed += 1
            with open(ip, "w", encoding="utf-8") as g:
                g.write(t)
    print(f"wasde history: report notes refreshed, {changed} file(s) changed")
    return changed


def ending_stock_reports(doc):
    idx = [i for i, s in enumerate(doc["series"]) if s["line"].lower() == "ending stocks"]
    rs = set()
    for y in doc["years"].values():
        for i in idx:
            rs |= {p[0] for p in y["s"].get(str(i), [])}
    return len(rs)


def dump(obj):
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False, sort_keys=False) + "\n"


def split(doc):
    """-> (the crop file, {name: part}): market years before PART_BEFORE go to one file a decade.
    Report numbers in a part point into the crop file's own report list."""
    main = {k: v for k, v in doc.items() if k != "years"}
    main["years"], parts = {}, {}
    for my, y in doc["years"].items():
        if my < PART_BEFORE:
            dec = my[:3] + "0s"
            name = f"{doc['crop']}-{dec}.json"
            parts.setdefault(name, {"crop": doc["crop"], "label": doc["label"], "part": dec, "years": {}})["years"][my] = y
        else:
            main["years"][my] = y
    main["parts"] = [{"name": n, "years": sorted(p["years"])} for n, p in sorted(parts.items())]
    return main, parts


def esmis_summary(src):
    """What the ESMIS reader did, from its manifest beside the extract folder (none -> None)."""
    base = os.path.join(os.path.dirname(os.path.abspath(src)), "esmis")
    try:
        with open(os.path.join(base, "manifest.json"), encoding="utf-8") as f:
            ch = json.load(f).get("chunks") or {}
    except (OSError, ValueError):
        return None
    out = {"reports_tried": len(ch), "read": 0, "status": {}, "file_type": {}, "scans": 0, "columns_withheld": 0,
           "tables_refused": {}, "not_complete": sorted(k[6:] for k, c in ch.items() if not c.get("complete"))[:100]}
    for c in ch.values():
        st = c.get("status") or ("error" if c.get("error") else "?")
        out["status"][st] = out["status"].get(st, 0) + 1
        out["read"] += 1 if st == "read" else 0
        if c.get("ext"):
            out["file_type"][c["ext"]] = out["file_type"].get(c["ext"], 0) + 1
        out["scans"] += 1 if c.get("scan") else 0
        out["columns_withheld"] += int(c.get("columns_withheld") or 0)
        for t in (c.get("tables") or {}).values():
            if isinstance(t, str):
                out["tables_refused"][t] = out["tables_refused"].get(t, 0) + 1
    try:
        with open(os.path.join(base, "index.json"), encoding="utf-8") as f:
            ix = json.load(f)
        out["listing"] = {"releases": ix.get("count"), "with_files": ix.get("with_files"),
                          "unlisted": len(ix.get("unlisted") or {}),
                          "unplaced": len((ix.get("placement") or {}).get("unplaced") or [])}
    except (OSError, ValueError):
        pass
    for k in ("status", "file_type", "tables_refused"):
        out[k] = dict(sorted(out[k].items()))
    return out


def write(docs, index, out, min_reports):
    thin = {c: ending_stock_reports(d) for c, d in docs.items() if ending_stock_reports(d) < min_reports}
    if thin:
        print(f"wasde history: not written; too few reports with ending stocks {thin} (need {min_reports} each)")
        return 2
    files = {}
    for c, d in docs.items():
        main, parts = split(d)
        files[f"{c}.json"] = dump(main)
        for n, p in parts.items():
            files[n] = dump(p)
    heavy = {n: len(t.encode()) for n, t in files.items() if len(t.encode()) > MAX_FILE_BYTES}
    if heavy:
        print(f"wasde history: not written; files over {MAX_FILE_BYTES} bytes {heavy}")
        return 3
    os.makedirs(out, exist_ok=True)
    for n in os.listdir(out):                      # a decade file this build did not write is stale
        if n.endswith(".json") and n != "index.json" and n not in files:
            os.remove(os.path.join(out, n))
    sizes = {}
    for n, t in sorted(files.items()):
        with open(os.path.join(out, n), "w", encoding="utf-8") as f:
            f.write(t)
        sizes[n] = len(t.encode())
    for c in docs:
        index["crops"][c]["bytes"] = sizes[f"{c}.json"]
        index["crops"][c]["parts"] = [{"name": n, "bytes": sizes[n]} for n in sorted(sizes) if n.startswith(c + "-")]
    with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps(index, indent=1, ensure_ascii=False) + "\n")
    print(f"wasde history: {index['reports']} reports, {index['first']} to {index['through']}; "
          f"bytes {sizes}; withheld {index['withheld_count']}; left out {index['left_out']}; "
          f"months with no report on file {len(index['months_with_no_report_on_file'])}")
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
        global MAX_FILE_BYTES
        keep, MAX_FILE_BYTES = MAX_FILE_BYTES, 500
        try:
            ck("a file over the size cap writes nothing", write(*build(rows), d, 1) == 3 and not os.listdir(d))
        finally:
            MAX_FILE_BYTES = keep
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
    # NASS corrected the Sep 11, 2026 corn yield the September WASDE carried: a note, not a number
    rn = corn.get("report_notes") or {}
    ck("a NASS correction to a figure this WASDE carried is a note beside the report",
       [(x["id"], x["market_year"], x["line"], x["printed"], x["corrected"]) for x in rn.get("2026-09-11", [])]
       == [("nass-crop-production-2026-09-11-corn-yield", "2026/27", "Yield per Harvested Acre", 178.5, 178.8)]
       and "left as printed" in rn["2026-09-11"][0]["note"] and "soybeans" not in json.dumps(docs["soybeans"].get("report_notes", {})), rn)
    with tempfile.TemporaryDirectory() as d:
        write(*build(rows), d, 1)
        before = {f: open(os.path.join(d, f), "rb").read() for f in os.listdir(d)}
        ck("refreshing the notes on a full build's files changes nothing", refresh_notes(d) == 0
           and before == {f: open(os.path.join(d, f), "rb").read() for f in os.listdir(d)})
    selftest_esmis(ck, rows)
    _ = (csv, io)
    print(f"build_wasde_history selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def selftest_esmis(ck, csv_rows):
    """Rows read from report text (scripts/read_wasde_text.py) through the same build."""
    import tempfile
    import read_wasde_text as T
    from backfill_wasde import is_usda
    rows = []
    for fn, d, label in [("wasde-2026-10-09.txt", "2026-10-09", "esmis-2026-10-09"), ("old-layout.txt", "1996-05-10", "esmis-1996-05-10")]:
        with open(os.path.join(T.FIX, fn), encoding="utf-8") as f:
            ex, rep = T.read_report(f.read(), d, label)
        rows += [dict(zip(EXTRACT_HEAD, r)) for r in ex]
    docs, index = build(rows)
    corn = docs["corn"]
    si = {(x["line"], x["unit"]): i for i, x in enumerate(corn["series"])}
    dates = [d for d, _ in corn["reports"]]
    es = corn["years"]["2026/27"]["s"][str(si[("Ending Stocks", "Million Bushels")])]
    ck("esmis: October's corn ending stocks 1,849, September's column left out as last month's",
       [(dates[i], v) for i, v in es] == [("2026-10-09", 1849)] and index["left_out"].get("last_months_column", 0) >= 20, (es, index["left_out"]))
    ck("esmis: a price range is left out and counted, never averaged",
       "2.90-3.30" not in json.dumps(corn) and index["left_out"].get("not_a_number", 0) >= 2, index["left_out"])
    ck("esmis: the credit names the archive actually read", index["source"]["url"] == ESMIS and is_usda(index["source"]["url"])
       and corn["source"]["url"] == ESMIS and index["sources"] == [SOURCE_ESMIS] and "balance sheet" in corn["note"], index["source"])
    ck("esmis: reports from both eras, WASDE numbers kept", corn["reports"][-1] == ["2026-10-09", "676"]
       and corn["reports"][0] == ["1996-05-10", "312"], corn["reports"])
    # the same report from the CSV and from the report file: one copy kept, never both
    both = rows + [r for r in csv_rows if r["wasde"] == "676"]
    d2, i2 = build(both)
    ck("esmis: one report from two files keeps one copy and counts the other",
       i2["left_out"].get("other_copy_of_the_same_report", 0) == 176
       and not any(16034 in w["values"] for w in i2["withheld"]) and len(i2["sources"]) == 2, (i2["left_out"], i2["withheld"][:2]))
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, "corn-1970s.json"), "w") as f:
            f.write("{}")
        ck("esmis: written with the old market years in decade files", write(docs, index, d, 1) == 0
           and sorted(os.listdir(d)) == ["corn-1990s.json", "corn.json", "index.json", "soybeans.json", "wheat-1990s.json", "wheat.json"],
           sorted(os.listdir(d)))
        with open(os.path.join(d, "corn.json"), encoding="utf-8") as f:
            main = json.load(f)
        with open(os.path.join(d, "corn-1990s.json"), encoding="utf-8") as f:
            part = json.load(f)
        with open(os.path.join(d, "index.json"), encoding="utf-8") as f:
            ix = json.load(f)
        ck("esmis: the crop file lists its decade files, the part holds those years only",
           main["parts"] == [{"name": "corn-1990s.json", "years": ["1994/95", "1995/96", "1996/97"]}]
           and sorted(part["years"]) == ["1994/95", "1995/96", "1996/97"] and "1994/95" not in main["years"]
           and part["years"]["1996/97"]["s"][str(si[("Ending Stocks", "Million Bushels")])] == [[0, 650]], (main.get("parts"), part.get("years", {}).keys()))
        ck("esmis: index carries the decade files' bytes", ix["crops"]["corn"]["parts"][0]["name"] == "corn-1990s.json"
           and ix["crops"]["corn"]["parts"][0]["bytes"] > 0 and ix["crops"]["soybeans"]["parts"] == [], ix["crops"])
        src = os.path.join(d, "raw", "us-grains")
        os.makedirs(os.path.join(d, "raw", "esmis"))
        os.makedirs(src)
        with open(os.path.join(d, "raw", "esmis", "manifest.json"), "w") as f:
            json.dump({"chunks": {"esmis-2026-10-09": {"complete": True, "status": "read", "ext": "txt", "columns_withheld": 0,
                                                       "tables": {"corn": 60}},
                                  "esmis-1973-09-17": {"complete": True, "status": "no_text_layer", "ext": "pdf", "scan": True},
                                  "esmis-1980-01-10": {"complete": True, "status": "read", "ext": "pdf", "scan": True,
                                                       "columns_withheld": 2, "tables": {"soybeans": "not_found"}},
                                  "esmis-2026-09-11": {"complete": False, "error": "HTTP 404"}}}, f)
        sm = esmis_summary(src)
        ck("esmis: the reader's counts go to the index", sm["read"] == 2 and sm["status"] == {"error": 1, "no_text_layer": 1, "read": 2}
           and sm["file_type"] == {"pdf": 2, "txt": 1} and sm["scans"] == 2 and sm["columns_withheld"] == 2
           and sm["tables_refused"] == {"not_found": 1} and sm["not_complete"] == ["2026-09-11"], sm)


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--src", default=SRC)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--min-reports", type=int, default=100)
    ap.add_argument("--notes-only", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.notes_only:
        refresh_notes(a.out)
        return 0
    rows = load(a.src)
    if not rows:
        print(f"wasde history: no extract files in {a.src}; nothing written")
        return 2
    docs, index = build(rows)
    es = esmis_summary(a.src)
    if es:
        index["esmis"] = es
    return write(docs, index, a.out, a.min_reports)


if __name__ == "__main__":
    sys.exit(main())
