#!/usr/bin/env python3
"""check_state_grain_ams.py -- where our elevator median basis and USDA's state
average basis differ by more than 15 cents.

Reads data/basis-states.json (our median per state and crop, written by
scripts/build_cash_bid_pages.py) and data/state-grain-ams.json (USDA AMS state
daily grain reports, scripts/fetch_state_grain_mars.py). A pair is compared only
when both are on the same futures month (our headline contract's month letter,
USDA's avg_basis for that letter) and the two dates are at most MAX_DAYS apart.
Everything else is listed as not compared, with the reason.

It REPORTS. It hides nothing and changes nothing: every compared pair is printed
with both numbers, the flagged ones marked, and it always exits 0 (a gap is a
question for a person, not a failed build). Southern Minnesota is USDA's area;
our Minnesota number is statewide, so that line says so.

  python3 scripts/check_state_grain_ams.py [--ours PATH] [--usda PATH]
  python3 scripts/check_state_grain_ams.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import datetime
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OURS = os.path.join("data", "basis-states.json")
USDA = os.path.join("data", "state-grain-ams.json")
LIMIT_C = 15
MAX_DAYS = 3
CROPS = ("corn", "soybeans", "wheat_hrw", "wheat_srw", "wheat_hrs")


def load(p):
    p = p if os.path.isabs(p) else os.path.join(ROOT, p)
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def usda_crop(u, crop):
    """USDA's current record for a crop. Spring wheat is reported by protein
    (wheat_hrs_14); when USDA has exactly one protein for the class, that one."""
    crops = u.get("crops") or {}
    c = (crops.get(crop) or {}).get("current")
    if c:
        return c
    alt = [k for k in crops if k.startswith(crop + "_") and (crops[k] or {}).get("current")]
    return crops[alt[0]]["current"] if len(alt) == 1 else None


def compare(ours, usda, limit=LIMIT_C, max_days=MAX_DAYS):
    """-> (rows, skipped). rows: dicts with st, crop, ours, usda, diff, flag."""
    rows, skipped = [], []
    if not ours or not usda:
        return rows, [("all", "-", "a file is missing")]
    gen = str(ours.get("generated") or "")[:10]
    try:
        our_day = datetime.date.fromisoformat(gen)
    except ValueError:
        return rows, [("all", "-", "our file has no date")]
    for st, u in sorted((usda.get("states") or {}).items()):
        o = (ours.get("states") or {}).get(st)
        if not o:
            skipped.append((st, "-", "no AGSIST state record"))
            continue
        uday = datetime.date.fromisoformat(u["report_date"])
        if abs((our_day - uday).days) > max_days:
            skipped.append((st, "-", "dates %s and %s too far apart" % (our_day, uday)))
            continue
        for crop in CROPS:
            oc, uc = (o.get("crops") or {}).get(crop), usda_crop(u, crop)
            if not oc and not uc:
                continue
            if not oc or oc.get("median") is None:
                skipped.append((st, crop, "no AGSIST median"))
                continue
            if not uc:
                skipped.append((st, crop, "no USDA current row"))
                continue
            m = str(oc.get("contract") or "")[-3:-2]
            ub = (uc.get("avg_basis") or {}).get(m)
            if ub is None:
                skipped.append((st, crop, "USDA has no average on our month (%s)" % (oc.get("label") or m)))
                continue
            oc_c = int(round(oc["median"] * 100))
            d = oc_c - ub
            rows.append({"st": st, "crop": crop, "month": oc.get("label") or m, "ours": oc_c, "ours_n": oc.get("n"),
                         "usda": ub, "usda_regions": uc.get("avg_n"), "diff": d, "flag": abs(d) > limit,
                         "area": u.get("name"), "usda_date": u["report_date"], "our_date": str(our_day)})
    return rows, skipped


def report(rows, skipped, out=print):
    out("our median basis vs USDA's state average basis (cents; flag over %dc)" % LIMIT_C)
    for r in rows:
        out("  %s %-2s %-10s %-8s ours %5d (n %s)  USDA %5d (regions %s, %s)  gap %+4d%s" % (
            "FLAG" if r["flag"] else "    ", r["st"], r["crop"], r["month"], r["ours"], r["ours_n"], r["usda"],
            r["usda_regions"], r["usda_date"], r["diff"],
            "  (USDA area: %s; ours statewide)" % r["area"] if r["area"] and r["area"].startswith("Southern") else ""))
    for st, crop, why in skipped:
        out("  not compared: %s %s: %s" % (st, crop, why))
    nf = sum(1 for r in rows if r["flag"])
    out("state grain check: %d compared, %d flagged over %dc, %d not compared" % (len(rows), nf, LIMIT_C, len(skipped)))
    return nf


def selftest():
    fails = []

    def ck(name, cond, detail=""):
        print("  %s %s%s" % ("ok  " if cond else "FAIL", name, "" if cond else "  " + str(detail)[:300]))
        if not cond:
            fails.append(name)

    ours = {"generated": "2026-11-03T01:05:24Z", "states": {
        "IA": {"crops": {"corn": {"contract": "ZCZ26", "label": "Dec '26", "n": 350, "median": -0.4},
                         "soybeans": {"contract": "ZSF27", "label": "Jan '27", "n": 288, "median": -0.78}}},
        "NE": {"crops": {"corn": {"contract": "ZCZ26", "label": "Dec '26", "n": 90, "median": -0.45}}},
        "MN": {"crops": {"corn": {"contract": "ZCH27", "label": "Mar '27", "n": 40, "median": -0.5}}}}}
    usda = {"states": {
        "IA": {"name": "Iowa", "report_date": "2026-11-02", "crops": {
            "corn": {"current": {"avg_basis": {"Z": -41}, "avg_n": 6}},
            "soybeans": {"current": {"avg_basis": {"F": -82, "X": -70}, "avg_n": 6}}}},
        "NE": {"name": "Nebraska", "report_date": "2026-11-02", "crops": {"corn": {"current": {"avg_basis": {"Z": -21}, "avg_n": 7}}}},
        "MN": {"name": "Southern Minnesota", "report_date": "2026-11-02", "crops": {"corn": {"current": {"avg_basis": {"Z": -52}}}}},
        "KS": {"name": "Kansas", "report_date": "2026-11-02", "crops": {}},
        "ND": {"name": "North Dakota", "report_date": "2026-11-02", "crops": {
            "wheat_hrs_14": {"crop": "wheat_hrs", "protein": "14.0%", "current": {"avg_basis": {"Z": -60}, "avg_n": 5}}}}}}
    ours["states"]["ND"] = {"crops": {"wheat_hrs": {"contract": "MWEZ26", "label": "Dec '26", "n": 20, "median": -0.55}}}
    rows, sk = compare(ours, usda)
    by = {(r["st"], r["crop"]): r for r in rows}
    ck("Iowa corn compared on Dec: 1c gap, not flagged", by[("IA", "corn")]["diff"] == 1 and not by[("IA", "corn")]["flag"])
    ck("Iowa soybeans compared on Jan, not Nov", by[("IA", "soybeans")]["usda"] == -82)
    ck("Nebraska corn 24c gap flagged", by[("NE", "corn")]["diff"] == -24 and by[("NE", "corn")]["flag"])
    ck("different month is not compared, and says so", ("MN", "corn") not in by
       and any(s[0] == "MN" and "our month" in s[2] for s in sk), sk)
    ck("a state we do not have is listed, not dropped", any(s[0] == "KS" for s in sk), sk)
    lines = []
    nf = report(rows, sk, out=lines.append)
    ck("spring wheat read from its one protein row", by[("ND", "wheat_hrs")]["usda"] == -60, by.get(("ND", "wheat_hrs")))
    ck("counts line", nf == 1 and lines[-1] == "state grain check: 4 compared, 1 flagged over 15c, 2 not compared", lines[-1])
    old = dict(usda, states={"IA": dict(usda["states"]["IA"], report_date="2026-10-20")})
    ck("dates too far apart are not compared", compare(ours, old)[0] == [])
    ck("missing file: reported, not a crash", compare(None, usda) == ([], [("all", "-", "a file is missing")]))
    print("check_state_grain_ams selftest: %s" % ("all ok" if not fails else "%d FAILED" % len(fails)))
    return 0 if not fails else 1


def main(argv):
    if "--selftest" in argv:
        return selftest()
    ours = load(argv[argv.index("--ours") + 1] if "--ours" in argv else OURS)
    usda = load(argv[argv.index("--usda") + 1] if "--usda" in argv else USDA)
    rows, skipped = compare(ours, usda)
    report(rows, skipped)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
