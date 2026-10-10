#!/usr/bin/env python3
"""
usda_current.py -- USDA's standing corn and soybean yield, read from the one
file the WASDE watcher writes (data/wasde.json).

WHY. On 2026-10-10, a day after USDA printed 181.2 for corn, Crop Tour still
called September's 178.5 "the number in force" and the ratings page said
AGSIST's forecast was the highest of four. Both read a USDA figure somebody
had typed into crop-tour.json and yield-benchmarks.json in September. Nobody
retyped it, because retyping is a thing a person has to remember.

Now every page that prints "USDA now" asks this module. It returns USDA's
figure from wasde.json when that release is newer than the hand-typed one, and
says so; otherwise the hand-typed figure stands. Nothing is estimated: the
numbers are NASS's yields as fetch_wasde.py read them, and the month-on-month
change is the WASDE PDF's own "prev" column.

    python3 scripts/usda_current.py --selftest
"""
import json
import os
import re
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WASDE_PATH = os.path.join(ROOT, "data", "wasde.json")

# wasde.json metric key -> crop name used by the pages
KEYS = {"corn": "corn_yield", "soybeans": "soy_yield"}
PDF_CROP = {"corn": "corn", "soybeans": "soybeans"}


def load(path=None):
    """The file, or {} when it is missing or unreadable. Never None: None would
    make usda_yields() fall back to the repo's own file, which is how a test
    pointed at a temp directory would read live data."""
    try:
        with open(path or WASDE_PATH) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _pdf_url(wasde, release):
    m = re.search(r"https?://\S+wasde\d{4}\.pdf", str((wasde or {}).get("source") or ""))
    if m:
        return m.group(0)
    return "https://www.usda.gov/oce/commodity/wasde/wasde%s%s.pdf" % (release[5:7], release[2:4])


def usda_yields(wasde=None):
    """{"as_of", "month", "label", "source", "corn", "soybeans", "prev": {...},
    "prev_month"} from wasde.json, or None when it carries no yield."""
    w = wasde if wasde is not None else load()
    if not w or not w.get("release"):
        return None
    rel = str(w["release"])[:10]
    try:
        d = date.fromisoformat(rel)
    except ValueError:
        return None
    out = {"as_of": rel, "month": d.strftime("%B"),
           "label": "USDA, %s WASDE" % d.strftime("%B"),
           "source": _pdf_url(w, rel), "prev": {}, "prev_month": None}
    got = False
    for crop, pre in KEYS.items():
        m = next((x for x in (w.get("metrics") or [])
                  if str(x.get("key", "")).startswith(pre) and x.get("value") is not None), None)
        if m is None:
            continue
        out[crop] = float(m["value"])
        got = True
        pdf = (((w.get("wasde_pdf") or {}).get("crops") or {}).get(PDF_CROP[crop]) or {})
        if str((w.get("wasde_pdf") or {}).get("date") or "")[:10] == rel:
            y = pdf.get("yield") or {}
            if y.get("value") is not None and abs(float(y["value"]) - out[crop]) < 1e-9:
                out["prev"][crop] = y.get("prev")
                out["prev_month"] = pdf.get("prev_month")
    return out if got else None


def newer(cur, as_of):
    """True when the wasde.json figure is from a later release than as_of."""
    return bool(cur) and (not as_of or cur["as_of"] > str(as_of)[:10])


def change_words(cur, crop):
    """'up 2.7 from September's 178.5' from the PDF's own prev column, or ''."""
    p = (cur or {}).get("prev", {}).get(crop)
    if p is None or cur.get(crop) is None:
        return ""
    d = round(cur[crop] - float(p), 1)
    mon = {"Jan": "January", "Feb": "February", "Mar": "March", "Apr": "April", "May": "May",
           "Jun": "June", "Jul": "July", "Aug": "August", "Sep": "September", "Oct": "October",
           "Nov": "November", "Dec": "December"}.get(cur.get("prev_month") or "", "last month")
    if d == 0:
        return "unchanged from %s" % mon
    return "%s %.1f from %s's %s" % ("up" if d > 0 else "down", abs(d), mon, p)


_READ = object()   # "read the repo's file"; None means "there is no USDA figure"


def apply_to_tour(tour, cur=_READ):
    """Point crop-tour.json's benchmarks.usda at wasde.json when it is newer.
    Returns True when it changed anything. Works on the loaded dict only; the
    hand-maintained file is not rewritten."""
    cur = usda_yields() if cur is _READ else cur
    b = ((tour or {}).get("benchmarks") or {}).get("usda")
    if b is None or not newer(cur, b.get("as_of")) or cur.get("corn") is None:
        return False
    d = date.fromisoformat(cur["as_of"])
    b["corn"] = cur["corn"]
    if cur.get("soybeans") is not None:
        b["soy_yield"] = cur["soybeans"]
    b["label"] = cur["label"]
    b["as_of"] = cur["as_of"]
    bits = ["corn %s bu/acre" % cur["corn"]]
    cw = change_words(cur, "corn")
    if cw:
        bits[0] += " (%s)" % cw
    if cur.get("soybeans") is not None:
        sb = "soybeans %s" % cur["soybeans"]
        sw = change_words(cur, "soybeans")
        bits.append(sb + (" (%s)" % sw if sw else ""))
    b["note"] = ("USDA's %s %d WASDE: %s. Read from data/wasde.json, the file the "
                 "WASDE watcher fills the moment NASS publishes." % (d.strftime("%B"), d.day, ", ".join(bits)))
    b["short"] = "USDA's %s %d estimate." % (d.strftime("%B"), d.year)
    b["source"] = cur["source"]
    return True


def apply_to_bench(bench, cur=_READ):
    """Point yield-benchmarks.json's usda_current at wasde.json when newer."""
    cur = usda_yields() if cur is _READ else cur
    changed = False
    for crop in ("corn", "soybeans"):
        meta = ((bench or {}).get("crops") or {}).get(crop)
        if meta is None or cur is None or cur.get(crop) is None:
            continue
        if not newer(cur, meta.get("usda_current_as_of")):
            continue
        meta["usda_current"] = cur[crop]
        meta["usda_current_label"] = cur["label"]
        meta["usda_current_as_of"] = cur["as_of"]
        changed = True
    if changed:
        bench["usda_source"] = cur["source"]
    return changed


def _selftest():
    fails = []

    def ck(c, m):
        print(("  ok    " if c else "  FAIL  ") + m)
        if not c:
            fails.append(m)
    w = {"release": "2026-10-09",
         "source": "USDA NASS ...; USDA WASDE PDF -- https://www.usda.gov/oce/commodity/wasde/wasde1026.pdf",
         "metrics": [{"key": "corn_yield_2627", "value": 181.2}, {"key": "soy_yield_2627", "value": 53.1},
                     {"key": "corn_2627", "value": 1.849}],
         "wasde_pdf": {"date": "2026-10-09", "crops": {
             "corn": {"prev_month": "Sep", "yield": {"value": 181.2, "prev": 178.5}},
             "soybeans": {"prev_month": "Sep", "yield": {"value": 53.1, "prev": 52.8}}}}}
    cur = usda_yields(w)
    ck(cur["corn"] == 181.2 and cur["soybeans"] == 53.1, "reads 181.2 and 53.1")
    ck(cur["label"] == "USDA, October WASDE" and cur["as_of"] == "2026-10-09", "labels it October, dated Oct 9")
    ck(cur["source"].endswith("wasde1026.pdf"), "links the October PDF")
    ck(change_words(cur, "corn") == "up 2.7 from September's 178.5", change_words(cur, "corn"))
    ck(usda_yields({"release": "2026-10-09", "metrics": []}) is None, "no yield in the file: None, not a guess")
    ck(usda_yields({}) is None, "an empty file: None")
    ck(load("/nonexistent/wasde.json") == {} and usda_yields(load("/nonexistent/wasde.json")) is None,
       "a missing file reads as nothing, never as the repo's own file")
    t0 = {"benchmarks": {"usda": {"corn": 178.5, "as_of": "2026-09-11"}}}
    ck(apply_to_tour(t0, None) is False and t0["benchmarks"]["usda"]["corn"] == 178.5,
       "no USDA figure passed in: the tour is left alone, not filled from the repo's file")
    # a PDF from another month never supplies the change
    w2 = dict(w, wasde_pdf=dict(w["wasde_pdf"], date="2026-09-11"))
    ck(change_words(usda_yields(w2), "corn") == "", "a September PDF does not explain an October yield")
    tour = {"benchmarks": {"usda": {"corn": 178.5, "soy_yield": 52.8, "as_of": "2026-09-11",
                                    "note": "September is the number in force now."}}}
    ck(apply_to_tour(tour, cur) is True and tour["benchmarks"]["usda"]["corn"] == 181.2, "the tour's USDA moves to 181.2")
    ck("in force" not in tour["benchmarks"]["usda"]["note"]
       and "October 9" in tour["benchmarks"]["usda"]["note"], tour["benchmarks"]["usda"]["note"])
    ck(apply_to_tour(tour, cur) is False, "and does not move twice")
    old = {"benchmarks": {"usda": {"corn": 180.0, "as_of": "2026-11-10"}}}
    ck(apply_to_tour(old, cur) is False and old["benchmarks"]["usda"]["corn"] == 180.0,
       "a hand-typed figure from a LATER release is not overwritten by an older file")
    bench = {"crops": {"corn": {"usda_current": 178.5, "usda_current_as_of": "2026-09-11"},
                       "soybeans": {"usda_current": 52.8, "usda_current_as_of": "2026-09-11"}}}
    ck(apply_to_bench(bench, cur) and bench["crops"]["corn"]["usda_current"] == 181.2
       and bench["crops"]["soybeans"]["usda_current_label"] == "USDA, October WASDE"
       and bench["usda_source"].endswith("wasde1026.pdf"), "the panel's USDA row moves too")
    print()
    print("usda_current: " + ("all passed" if not fails else "%d FAILED" % len(fails)))
    return 1 if fails else 0


def gate(what, root=ROOT):
    """For the workflows chained off WASDE watch (it completes every 15
    minutes): is there a USDA yield in data/wasde.json that `what` has not
    picked up yet? what = "panel" (data/yield-panel.json) or "croptour"
    (the baked crop-tour.html banner). Returns True to run."""
    cur = usda_yields(load(os.path.join(root, "data", "wasde.json")))
    if not cur:
        return False
    if what == "panel":
        try:
            with open(os.path.join(root, "data", "yield-panel.json")) as f:
                rows = json.load(f)["crops"]["corn"]["rows"]
            seen = next((r.get("as_of") for r in rows if r.get("id") == "usda"), None)
        except (OSError, ValueError, KeyError, TypeError):
            return True
        return newer(cur, seen)
    if what == "croptour":
        try:
            with open(os.path.join(root, "crop-tour.html"), encoding="utf-8") as f:
                html = f.read()
        except OSError:
            return True
        d = date.fromisoformat(cur["as_of"])
        return ("USDA now %.1f (%s %d)" % (cur["corn"], d.strftime("%b"), d.day)) not in html
    raise ValueError(what)


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    if "--gate" in sys.argv:
        go = gate(sys.argv[sys.argv.index("--gate") + 1])
        print("go=%d" % (1 if go else 0))
        sys.exit(0)
    print(json.dumps(usda_yields(), indent=1))
