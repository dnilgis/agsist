#!/usr/bin/env python3
"""Compare the ENSO table in components/prf-optimize.js with NOAA CPC's ONI.

The optimizer's ONI_ASO table (Aug-Oct Nino 3.4 anomaly by year) was built
where CPC could not be reached: 1950-2021 come from a long Nino 3.4 series
shipped with the Pyleoclim package, 2022-2024 were transcribed from CPC.
This reads CPC's file and lists every year whose El Nino / neutral / La Nina
call differs, and every value more than 0.2 C apart.

  python3 scripts/check_prf_oni.py            # report; exit 1 if any phase differs
  python3 scripts/check_prf_oni.py --selftest # parser checks, no network
"""
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
JS = ROOT / "components" / "prf-optimize.js"
CPC = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"


def phase(v):
    return "el-nino" if v >= 0.5 - 1e-9 else "la-nina" if v <= -0.5 + 1e-9 else "neutral"


def table(js_text):
    first = int(re.search(r"var ONI_FIRST = (\d{4});", js_text).group(1))
    body = re.search(r"var ONI_ASO = \[(.*?)\];", js_text, re.S).group(1)
    body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    vals = [float(x) for x in body.replace("\n", " ").split(",") if x.strip()]
    return {first + i: v for i, v in enumerate(vals)}


def cpc_aso(text):
    out = {}
    for line in text.splitlines():
        p = line.split()
        if len(p) == 4 and p[0] == "ASO" and p[1].isdigit():
            out[int(p[1])] = float(p[3])
    return out


def selftest():
    t = table("var ONI_FIRST = 1950;\n var ONI_ASO = [\n /* 1950 */ -0.26, 0.99,\n /* x */ 1.5 ];")
    assert t == {1950: -0.26, 1951: 0.99, 1952: 1.5}, t
    c = cpc_aso("SEAS  YR   TOTAL   ANOM\n  JAS 1950  26.1  -0.4\n  ASO 1950  26.0  -0.4\n  ASO 2023  28.4   1.6\n")
    assert c == {1950: -0.4, 2023: 1.6}, c
    assert phase(0.5) == "el-nino" and phase(-0.5) == "la-nina" and phase(0.49) == "neutral"
    assert len(table(JS.read_text())) >= 75
    print("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return 0
    ours = table(JS.read_text())
    req = Request(CPC, headers={"User-Agent": "AGSIST-ONI-check (+https://agsist.com)"})
    theirs = cpc_aso(urlopen(req, timeout=30).read().decode("utf-8", "replace"))
    differ, far = [], []
    for y, v in sorted(ours.items()):
        if y not in theirs:
            continue
        if phase(v) != phase(theirs[y]):
            differ.append((y, v, theirs[y]))
        if abs(v - theirs[y]) > 0.2 + 1e-9:
            far.append((y, v, theirs[y]))
    print(f"compared {sum(1 for y in ours if y in theirs)} years with CPC ({CPC})")
    for y, a, b in differ:
        print(f"  phase differs {y}: table {a:+.2f} ({phase(a)}), CPC {b:+.1f} ({phase(b)})")
    for y, a, b in far:
        print(f"  more than 0.2 C apart {y}: table {a:+.2f}, CPC {b:+.1f}")
    if not differ:
        print("every phase agrees")
    return 1 if differ else 0


if __name__ == "__main__":
    sys.exit(main())
