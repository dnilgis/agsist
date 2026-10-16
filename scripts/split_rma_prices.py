#!/usr/bin/env python3
"""
AGSIST -- split data/rma-prices.json for the harvest price tracker.

The tracker loaded the whole RMA mirror (about 430 KB, every state) before a
reader picked a state. CLAUDE.md: bulky data loads on demand. This writes

  data/rma-prices/index.json   what the page needs before a state is picked:
                               state names, each state's corn harvest window
                               (the map), the windows in discovery today
                               (the "in discovery right now" table) and Iowa's
                               rows (the corn and soybean cards' status)
  data/rma-prices/<ST>.json    one state's rows, loaded when it is picked

Every row is copied verbatim from data/rma-prices.json. Nothing is computed
except which rows go where, so every price is still RMA's own.

  python3 scripts/split_rma_prices.py            write
  python3 scripts/split_rma_prices.py --check    exit 1 if the files on disk
                                                 do not match the mirror
  python3 scripts/split_rma_prices.py --selftest
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "rma-prices.json"
OUT = ROOT / "data" / "rma-prices"

FIPS = {'01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT',
        '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
        '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI',
        '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ',
        '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA',
        '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA',
        '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY', '72': 'PR'}
REF_STATE = "IA"   # the page's corn and soybean cards read their status from Iowa's windows


def _price(v, status):
    """The page's price(): a zero or a 'Yet To Start' is not a price."""
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if not n > 0 or "yet to start" in str(status or "").lower():
        return None
    return n


def corn_window(rows):
    """The page's cornWindow(): the first corn window set, in file order, that
    has a Conventional projected price. [h_start, h_end] or None."""
    order, groups = [], {}
    for r in rows:
        if r.get("crop") != "Corn" or not (r.get("h_start") and r.get("h_end") and r.get("p_start")):
            continue
        k = "|".join(str(r.get(x)) for x in ("crop", "type", "p_start", "p_end", "h_start", "h_end"))
        if k not in groups:
            groups[k] = {"hs": r["h_start"], "he": r["h_end"], "p": None}
            order.append(k)
        g = groups[k]
        if r.get("practice") != "Organic" and g["p"] is None:
            g["p"] = _price(r.get("p_price"), r.get("p_status"))
    for k in order:
        if groups[k]["p"] is not None:
            return [groups[k]["hs"], groups[k]["he"]]
    return None


def split(doc):
    """(index, {ST: state_doc}) from the mirror."""
    rows = [r for r in (doc.get("rows") or []) if isinstance(r, dict) and r.get("st") and r.get("state")]
    by = {}
    for r in rows:
        by.setdefault(FIPS.get(str(r["st"]), str(r["st"])), []).append(r)
    head = {"updated": doc.get("updated"), "crop_year": doc.get("crop_year"),
            "source": doc.get("source"), "app": doc.get("app"),
            "_note": ("Split from data/rma-prices.json by scripts/split_rma_prices.py. Rows are "
                      "RMA's own, copied verbatim. " + str(doc.get("_note") or ""))}
    disc = []
    seen = set()
    for r in rows:
        if r.get("h_status") != "In Discovery":
            continue
        k = (r.get("crop"), r.get("type"), r.get("st"), r.get("h_end"))
        if k in seen:
            continue
        seen.add(k)
        disc.append({"crop": r.get("crop"), "type": r.get("type"), "st": r.get("st"),
                     "h_end": r.get("h_end"), "h_status": r.get("h_status")})
    index = dict(head)
    index.update({
        "count": len(rows),
        "states": {st: rs[0]["state"] for st, rs in sorted(by.items())},
        "map": {st: w for st, w in ((st, corn_window(rs)) for st, rs in sorted(by.items())) if w},
        "disc": disc,
        "ref_state": REF_STATE,
        "ref_rows": by.get(REF_STATE, []),
    })
    per = {st: dict(head, state=st, count=len(rs), rows=rs) for st, rs in by.items()}
    return index, per


def _dump(obj):
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False) + "\n"


def write(doc, out=OUT):
    index, per = split(doc)
    out.mkdir(parents=True, exist_ok=True)
    want = {"index.json": _dump(index)}
    want.update({st + ".json": _dump(v) for st, v in per.items()})
    changed = 0
    for name, text in want.items():
        p = out / name
        if not p.exists() or p.read_text(encoding="utf-8") != text:
            p.write_text(text, encoding="utf-8")
            changed += 1
    for p in out.glob("*.json"):           # a state RMA dropped goes too
        if p.name not in want:
            p.unlink()
            changed += 1
    return changed, len(want)


def check(doc, out=OUT):
    index, per = split(doc)
    want = {"index.json": _dump(index)}
    want.update({st + ".json": _dump(v) for st, v in per.items()})
    bad = [n for n, t in want.items() if not (out / n).exists() or (out / n).read_text(encoding="utf-8") != t]
    extra = [p.name for p in out.glob("*.json")] if out.exists() else []
    bad += [n for n in extra if n not in want]
    return bad


def selftest():
    fails = []

    def ck(name, ok):
        print(("  ok   " if ok else "  FAIL ") + name)
        if not ok:
            fails.append(name)
    base = {"crop": "Corn", "type": "All", "practice": "Conventional", "p_start": "2026-02-01",
            "p_end": "2026-02-28", "p_price": 4.62, "p_status": "Released", "h_price": 4.93,
            "h_status": "In Discovery", "scd": "3/15/2026"}
    rows = [
        dict(base, st="19", state="Iowa", h_start="2026-10-01", h_end="2026-10-31"),
        dict(base, st="19", state="Iowa", practice="Organic", h_start="2026-10-01", h_end="2026-10-31"),
        dict(base, st="48", state="Texas", h_start="2026-08-01", h_end="2026-08-31", p_price=0, p_status="Yet To Start", h_status="Yet To Start"),
        dict(base, st="48", state="Texas", h_start="2026-09-01", h_end="2026-09-30", h_status="Released"),
        dict(base, crop="Soybeans", st="48", state="Texas", h_start="2026-09-01", h_end="2026-09-30"),
    ]
    idx, per = split({"rows": rows, "updated": "x", "crop_year": 2026})
    ck("one file per state, every row kept, verbatim", set(per) == {"IA", "TX"}
       and sum(len(p["rows"]) for p in per.values()) == 5 and per["TX"]["rows"][0] == rows[2])
    ck("map: Iowa's October corn window", idx["map"]["IA"] == ["2026-10-01", "2026-10-31"])
    ck("map: Texas skips a window whose projected price is 'Yet To Start'", idx["map"]["TX"] == ["2026-09-01", "2026-09-30"])
    ck("disc: in-discovery rows only, one per crop/type/state/end",
       sorted((x["crop"], x["st"]) for x in idx["disc"]) == [("Corn", "19"), ("Soybeans", "48")])
    ck("ref rows are Iowa's", len(idx["ref_rows"]) == 2 and idx["states"] == {"IA": "Iowa", "TX": "Texas"})
    if SRC.exists():
        real = json.loads(SRC.read_text())
        i2, p2 = split(real)
        ck("real mirror: every row lands in exactly one state file",
           sum(len(p["rows"]) for p in p2.values()) == len(real["rows"]))
        ck("real mirror: the index is small (under 40 KB)", len(_dump(i2)) < 40_000)
    print("\n%s" % ("%d FAILED" % len(fails) if fails else "all split checks pass"))
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    doc = json.loads(SRC.read_text())
    if "--check" in argv:
        bad = check(doc)
        if bad:
            print("data/rma-prices/ is out of step with data/rma-prices.json: %s" % ", ".join(sorted(bad)[:10]))
            return 1
        print("data/rma-prices/ matches data/rma-prices.json")
        return 0
    changed, n = write(doc)
    print("[split_rma_prices] %d of %d files written" % (changed, n))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
