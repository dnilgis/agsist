"""A synthetic five-state land sale site for the detail panel test (test/land-detail.test.mjs) and its screenshots.

    python3 test/fixtures/land-detail/make_site.py OUT_DIR

One county per state (IL, IN, WI, VT, NJ), each with its own state's columns (scripts/fetch_land_sales.py build), built by
scripts/build_land_sales.py into OUT_DIR, plus a minimal Atlas-like page with the county sales block. Every name is made
up and ends in SYNTH, so a test can look for any of them anywhere; one Illinois legal description names its own seller
(it must be blanked in the panel). Prints {"ids": {st: [ids newest first]}, "names": [...]} as JSON."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
import build_land_sales as BS  # noqa: E402
import land_names  # noqa: E402

BASE = ["doc", "date", "price", "acres", "tac", "np", "cls", "conv", "pid", "muni", "legal", "str", "exempt"]
COLS = {
    "IL": BASE + ["grantor", "grantee", "ac1", "rec"],
    "IN": BASE + ["grantor", "grantee", "ac1"],
    "WI": BASE + ["grantor", "grantee", "ac1", "rec", "rr", "mfl"],
    "VT": BASE + ["grantor", "grantee", "rec"],
    "NJ": [c for c in BASE if c != "str"] + ["rec", "acx", "avl", "avb", "avy", "lsf", "yb"],
}
CO = {"IL": ("17999", "Testa", "Tess township"), "IN": ("18999", "Testb", "TESSVILLE"), "WI": ("55999", "Testc", "Town of Tess"),
      "VT": ("50999", "Testd", "TESSBURY"), "NJ": ("34999", "Teste", "Tess township")}
CONV = {"IL": "Warranty Deed; adjacent owner; advertised", "IN": "Sale; land only; not valid for trending", "WI": "Warranty Deed; land only",
        "VT": "Transfer; land only; enrolled in current use",
        "NJ": "Deed; state ratio study code 33: farmland-assessed, exempt or abated property; land only"}
PID = {"IL": "12-34-567-%03d", "IN": "0108044010%04d", "WI": "022-1234-%02d-000", "VT": "4321351%04d", "NJ": "0104 B 1%02d L 4"}


def rows_for(st):
    cols, out = COLS[st], []
    n = 9 if st != "NJ" else 3          # New Jersey: too few sales for a county middle
    for i in range(n):
        d = "2026-%02d-%02d" % (9 - i // 3, 20 - 6 * (i % 3))
        o = {"doc": "%sDOC%03d" % (st, i), "date": d, "price": 600000 + 25000 * i, "acres": 80.0 + 5 * i, "tac": None, "np": 1,
             "cls": "4 7" if i == 2 else "4", "conv": CONV[st], "pid": PID[st] % i, "muni": "0",
             "legal": "" if st in ("VT", "NJ") else "PART OF SE 1/4 SEC 12 T15N R6E 4TH PM, %d ACRES" % (80 + 5 * i),
             "str": "12-15N-6E-4", "exempt": 0, "grantor": "SELLER %s%d SYNTH" % (st, i), "grantee": "BUYER %s%d SYNTH" % (st, i),
             "ac1": None, "rec": "2026-%02d-%02d" % (9 - i // 3, 22 - 6 * (i % 3)), "acx": None,
             "rr": "life" if i == 0 else "none", "mfl": 12.0 if i == 0 else 0, "avl": 41200 + i, "avb": None if i != 2 else 185000,
             "avy": "2026", "lsf": None if i != 2 else 1840, "yb": None if i != 2 else "1988"}
        if st == "IL" and i == 0:
            # names its own seller in another word order ("SELLER IL0 SYNTH" on the record): the whole legal waits for the tap
            o["legal"] = "PART OF SE 1/4 SEC 12 T15N R6E 4TH PM, EXCEPT TRACT TO SYNTH IL0 SELLER, 80 ACRES"
        if i == 1:
            o["acres"], o["np"], o["ac1"] = None, 2, 41.5      # several parcels, acres not added up for sure
        out.append([o[c] for c in cols])
    return out


def main(out):
    t = Path(out)
    (t / "data" / "land-sales").mkdir(parents=True, exist_ok=True)
    (t / "grain-emc.html").write_text("<script>/* agsist-theme-early */</script><script>/* agsist-ga-guard */</script>")
    (t / "data" / "land-sales" / "coverage.json").write_text(json.dumps({"labels": {"live": "Sales on this site"}, "note": "",
        "states": [{"st": st, "name": BS.NAME[st], "status": "live"} for st in BS.STATES]}))
    names = []
    for st, (fips, county, muni) in CO.items():
        d = t / "data" / "land" / st.lower()
        d.mkdir(parents=True, exist_ok=True)
        rows = rows_for(st)
        for r in rows:
            c = COLS[st]
            if "grantor" in c:
                names += [r[c.index("grantor")], r[c.index("grantee")]]
        doc = {"state": st, "county": county, "fips": fips, "source": BS.SOURCES[st],
               "fetched_utc": "2026-10-18T00:00:00Z", "names": "grantor" in COLS[st], "cols": COLS[st], "rows": rows, "acres_rule": 2,
               "munis": {"0": [muni, 45.0, -91.0]}, "coverage": {"from": "2020-01-01", "to": "2026-09-30"}}
        # as the fetcher writes them since Nov 4, 2026: the county file names no one, the names have their own file
        doc, ndoc = land_names.split(doc)
        land_names.write(str(t / "data" / "land"), st, doc, ndoc)
        (d / (fips + ".json")).write_text(json.dumps(doc))
        (d / "index.json").write_text(json.dumps({"state": st, "fetched_utc": "2026-10-18T00:00:00Z",
            "counties": [{"fips": fips, "name": county, "lat": 45.0, "lng": -91.0}]}))
    texts = BS.build(t)
    for p, x in texts.items():
        (t / p).parent.mkdir(parents=True, exist_ok=True)
        (t / p).write_text(x, encoding="utf-8")
    # an Atlas-like county page: the sales block land-sales.js draws (Wisconsin)
    (t / "atlas-test.html").write_text('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<link rel="stylesheet" href="/components/styles.css?v=28"><title>Atlas test</title></head><body><main id="main" class="main">'
        '<h1>Testc County</h1><section class="keys"><p>Key figures</p></section>'
        '<section data-atlas-sales="county" data-st="WI" data-fips="55999"></section></main>'
        '<script src="/components/land-sales.js?v=5" defer></script></body></html>')
    ids = {}
    for st, (fips, _, _) in CO.items():
        lf = json.loads(texts["data/land-sales/%s/%s.json" % (st.lower(), fips)])
        ids[st] = [a[lf["cols"].index("id")] for a in lf["s"]]
    leaks = BS.leaks(texts)
    print(json.dumps({"ids": ids, "names": sorted(set(names)), "leaks": len(leaks), "month": next((p for p in texts if p.startswith("land-sales/20")), None)}))


if __name__ == "__main__":
    main(sys.argv[1])
