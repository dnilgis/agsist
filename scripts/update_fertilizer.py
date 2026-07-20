#!/usr/bin/env python3
"""update_fertilizer.py — refresh data/fertilizer.json from dealer quotes.

Sig's fertilizer sheet is a manual, roughly-monthly pipeline (dealer quotes,
not an API). This makes the update one command — or one GitHub Actions form
(fertilizer-update.yml) — instead of a hand-edited JSON.

Rules (honest-numbers doctrine):
  - Only products passed on the CLI change; everything else carries flat.
  - EVERY product's `prev` becomes the last sheet's price, so the site's
    up/down arrows always compare against the previous published sheet.
  - `updated` = today (UTC), `source` month follows.
  - Sanity guard: a new price that moves more than 60% from the last sheet is
    almost certainly a typo ($69 for urea, $6950...). Refused unless --force.

Usage:
  python3 scripts/update_fertilizer.py --urea 695 --potash 460
  python3 scripts/update_fertilizer.py --selftest
Flags: --urea --potash --map-s --ams --kmag --lime   (all $/ton, optional)
"""
import argparse
import json
import sys
from datetime import datetime, timezone

FLAG_TO_NAME = {
    "urea": "Urea", "potash": "Potash", "map_s": "MAP + Sulfur",
    "ams": "Amm. Sulfate", "kmag": "K-Mag Premium", "lime": "Pell Lime",
}
MAX_MOVE = 0.60   # >60% move vs last sheet = probable typo


def apply(data, changes, force=False, now=None):
    """Pure: returns (new_data, notes) or raises ValueError. `changes` is
    {product-name: new_price}."""
    now = now or datetime.now(timezone.utc)
    names = {p["name"] for p in data["prices"]}
    unknown = set(changes) - names
    if unknown:
        raise ValueError(f"unknown product(s): {sorted(unknown)} — knowns: {sorted(names)}")
    notes = []
    for p in data["prices"]:
        old = p["price"]
        p["prev"] = old
        if p["name"] in changes:
            new = float(changes[p["name"]])
            if new <= 0:
                raise ValueError(f"{p['name']}: price {new} — not a price")
            if old and abs(new - old) / old > MAX_MOVE and not force:
                raise ValueError(
                    f"{p['name']}: {old} -> {new} is a {abs(new-old)/old:.0%} move — "
                    f"probable typo. Re-run with --force if it's real.")
            p["price"] = int(new) if float(new).is_integer() else new
            notes.append(f"{p['name']}: {old} -> {p['price']}")
        else:
            notes.append(f"{p['name']}: {old} (no change)")
    data["updated"] = now.strftime("%Y-%m-%d")
    data["source"] = f"Midwest dealer benchmark — {now.strftime('%B %Y')}"
    return data, notes


def _selftest():
    base = {"updated": "2026-06-08", "source": "x", "prices": [
        {"name": "Urea", "price": 760, "prev": 830},
        {"name": "Potash", "price": 450, "prev": 450}]}
    T = datetime(2026, 7, 20, tzinfo=timezone.utc)
    ok = True
    def chk(c, m):
        nonlocal ok
        print(("  OK   " if c else "  FAIL ") + m)
        ok = ok and c
    d, _ = apply(json.loads(json.dumps(base)), {"Urea": 695}, now=T)
    u = next(p for p in d["prices"] if p["name"] == "Urea")
    k = next(p for p in d["prices"] if p["name"] == "Potash")
    chk(u["price"] == 695 and u["prev"] == 760, "changed product: price set, prev = last sheet")
    chk(k["price"] == 450 and k["prev"] == 450, "unchanged product: flat, prev = last sheet")
    chk(d["updated"] == "2026-07-20" and "July 2026" in d["source"], "date + source month stamped")
    for bad, why in (({"Urea": 69}, "10x-low typo"), ({"Urea": 6950}, "10x-high typo"),
                     ({"Urea": -5}, "negative"), ({"Nitrogen": 500}, "unknown product")):
        try:
            apply(json.loads(json.dumps(base)), bad, now=T)
            chk(False, f"refused {why}")
        except ValueError:
            chk(True, f"refused {why}")
    d2, _ = apply(json.loads(json.dumps(base)), {"Urea": 200}, force=True, now=T)
    chk(next(p for p in d2["prices"] if p["name"] == "Urea")["price"] == 200, "--force overrides the typo guard")
    print("SELFTEST " + ("OK" if ok else "FAILED"))
    sys.exit(0 if ok else 1)


def main():
    ap = argparse.ArgumentParser()
    for flag in FLAG_TO_NAME:
        ap.add_argument("--" + flag.replace("_", "-"), type=float, default=None)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        _selftest()
    changes = {FLAG_TO_NAME[f]: getattr(a, f) for f in FLAG_TO_NAME if getattr(a, f) is not None}
    if not changes:
        raise SystemExit("nothing to change — pass at least one price flag (see --help)")
    data = json.load(open("data/fertilizer.json"))
    data, notes = apply(data, changes, force=a.force)
    json.dump(data, open("data/fertilizer.json", "w"), indent=1, ensure_ascii=False)
    print("\n".join("  " + n for n in notes))
    print(f"wrote data/fertilizer.json — updated {data['updated']}")
    # ── history: append this sheet so 'cheapest since February' is provable later.
    # One row per sheet date (re-running the same day overwrites that row).
    try:
        hist = json.load(open("data/fertilizer-history.json"))
    except FileNotFoundError:
        hist = {"note": "one row per published dealer sheet — appended by update_fertilizer.py, never edited by hand", "sheets": []}
    row = {"date": data["updated"], "prices": {p["name"]: p["price"] for p in data["prices"]}}
    hist["sheets"] = [s for s in hist["sheets"] if s["date"] != row["date"]] + [row]
    hist["sheets"].sort(key=lambda s: s["date"])
    json.dump(hist, open("data/fertilizer-history.json", "w"), indent=1, ensure_ascii=False)
    print(f"appended sheet to data/fertilizer-history.json ({len(hist['sheets'])} sheets on record)")


if __name__ == "__main__":
    main()
