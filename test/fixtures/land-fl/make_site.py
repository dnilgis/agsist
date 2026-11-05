"""A synthetic land sale site with Florida switched on, for test/land-fl-on.test.mjs and its screenshots.

    python3 test/fixtures/land-fl/make_site.py OUT_DIR

Florida's county files come from the synthetic prepared rows in this folder (no real parcel, no name), built by
scripts/fetch_land_sales.py into OUT_DIR/data/land-hosted/land/fl, the way land-data.yml links agsist-data's land folder.
Hardee County is built as a split county (a tiny split size): one timber sale is moved to June 2021, so it sits in the
older year's file and its row number counts across the whole county. One Wisconsin county (made-up names ending in SYNTH)
dated in 2025 gives the site a monthly update that Florida's files reach. The Florida summary and every land sale page
are built into OUT_DIR. Prints JSON: the Florida sale ids, the month, the names, the leak count."""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
import build_land_sales as BS  # noqa: E402
import build_land_summary as BLS  # noqa: E402
import fetch_land_sales as FL  # noqa: E402
import land_names  # noqa: E402

FIX = ROOT / "test" / "fixtures" / "land-fl"
NOW = "2026-11-05T00:00:00Z"
GAZ = {"12049": {FL.muni_key("WAUCHULA"): ("Wauchula", 27.547, -81.811)}, "12055": {FL.muni_key("AVON PARK"): ("Avon Park", 27.596, -81.506)}}
WI_COLS = ["doc", "date", "price", "acres", "tac", "np", "cls", "conv", "pid", "muni", "legal", "str", "exempt", "grantor", "grantee", "ac1", "rec"]


def florida(t):
    keep_out, keep_split = FL.OUT, FL.SPLIT_BYTES
    FL.OUT = str(t / "data" / "land-hosted" / "land")
    os.makedirs(FL.OUT, exist_ok=True)
    try:
        FL.SPLIT_BYTES = 10      # split Hardee, as a big county on agsist-data
        recs = FL.fl_recs(str(FIX), {})
        for r in recs:
            if r["pid"] == "FX-003":
                r["date"] = "2021-06-01"      # an older year, in its own file
        FL.STATES["FL"]["since_note"] = FL.fl_since("2021 to 2026")
        FL.build("FL", recs, GAZ, NOW)
    finally:
        FL.OUT, FL.SPLIT_BYTES = keep_out, keep_split
    # land-data.yml: ln -s <agsist-data checkout>/land data/land-hosted; here the folder itself
    os.replace(t / "data" / "land-hosted" / "land" / "fl", t / "data" / "land-hosted" / "fl")
    os.rmdir(t / "data" / "land-hosted" / "land")


def wisconsin(t):
    d = t / "data" / "land" / "wi"
    d.mkdir(parents=True, exist_ok=True)
    rows, names = [], []
    for i in range(9):
        day = "2025-%02d-%02d" % (8 - i // 3, 20 - 6 * (i % 3))
        g, b = "SELLER WI%d SYNTH" % i, "BUYER WI%d SYNTH" % i
        names += [g, b]
        rows.append(["WIDOC%03d" % i, day, 600000 + 25000 * i, 80.0 + 5 * i, None, 1, "4", "Warranty Deed; land only", "022-1234-%02d-000" % i,
                     "0", "PART OF SE 1/4 SEC 12 T15N R6E 4TH PM", "12-15N-6E-4", 0, g, b, None, day])
    doc = {"state": "WI", "county": "Testc", "fips": "55999", "source": BS.SOURCES["WI"], "fetched_utc": "2025-09-18T00:00:00Z", "names": True,
           "cols": WI_COLS, "rows": rows, "acres_rule": 2, "munis": {"0": ["Town of Tess", 45.0, -91.0]}, "coverage": {"from": "2020-01-01", "to": "2025-08-31"}}
    doc, ndoc = land_names.split(doc)
    land_names.write(str(t / "data" / "land"), "WI", doc, ndoc)
    (d / "55999.json").write_text(json.dumps(doc))
    (d / "index.json").write_text(json.dumps({"state": "WI", "fetched_utc": "2025-09-18T00:00:00Z",
                                              "counties": [{"fips": "55999", "name": "Testc", "lat": 45.0, "lng": -91.0}]}))
    return names


def main(out):
    t = Path(out)
    (t / "data" / "land-sales").mkdir(parents=True, exist_ok=True)
    (t / "grain-emc.html").write_text("<script>/* agsist-theme-early */</script><script>/* agsist-ga-guard */</script>")
    (t / "data" / "land-sales" / "coverage.json").write_text(json.dumps({"labels": {"live": "Sales on this site"}, "note": "",
        "states": [{"st": st, "name": BS.NAME[st], "status": "live"} for st in ("WI", "FL")]}))
    florida(t)
    names = wisconsin(t)
    # the Atlas summary for Florida (build_land_summary.main writes data/land/fl/summary.json the same way)
    files = [land_names.load(BLS.read_county(str(p)), str(t / "data" / "land")) for p in sorted((t / "data" / "land-hosted" / "fl").glob("[0-9][0-9][0-9][0-9][0-9].json"))]
    (t / "data" / "land" / "fl").mkdir(parents=True, exist_ok=True)
    (t / "data" / "land" / "fl" / "summary.json").write_text(BLS.dump(BLS.build_state("FL", files)))
    texts = BS.build(t)
    for p, x in texts.items():
        (t / p).parent.mkdir(parents=True, exist_ok=True)
        (t / p).write_text(x, encoding="utf-8")
    lf = json.loads(texts["data/land-sales/fl/12049.json"])
    print(json.dumps({"fl_ids": [a[lf["cols"].index("id")] for a in lf["s"]], "names": sorted(set(names)), "leaks": len(BS.leaks(texts)),
                      "month": next((p for p in texts if p.startswith("land-sales/20")), None), "files": sorted(texts)}))


if __name__ == "__main__":
    main(sys.argv[1])
