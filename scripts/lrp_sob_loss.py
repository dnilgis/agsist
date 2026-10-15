#!/usr/bin/env python3
"""lrp_sob_loss.py: what LRP actually paid on what producers actually bought,
by product and reinsurance year, from RMA's Summary of Business.

The /lrp record weighs every sales day the same. RMA's Summary of Business
(sob/lrp_<YYYY>.zip on the lrp-history branch, from
https://pubfs-rma.fpac.usda.gov/pub/Web_Data_Files/Summary_of_Business/livestock_and_dairy_participation/)
is what was bought: one row per county, type, sales day, length and coverage
price, with its premium, subsidy, liability and indemnity. This sums them:

  loss ratio           indemnity / total premium
  producer loss ratio  indemnity / (total premium - subsidy), what producers paid

Rows are pipe-delimited, 31 fields; the money fields are the last five:
subsidy, total premium, producer premium, liability, indemnity (checked on
real rows: total premium = cost per cwt x weight, subsidy = the table's share
of it, liability = coverage price x weight). A year still settling is marked
open: its indemnities are not all in.

  python3 scripts/lrp_sob_loss.py --history DIR [--out data/lrp/sob-loss.json]
"""
import io
import json
import os
import sys
import zipfile
from datetime import datetime, timezone

PRODUCTS = {"0801": "feeder", "0802": "fed", "0815": "swine"}


def tally(lines):
    out = {}
    for ln in lines:
        f = ln.rstrip("\r\n").split("|")
        if len(f) != 31 or f[6] not in PRODUCTS:
            continue
        try:
            sub, prem, prod, liab, ind = (float(x or 0) for x in f[26:31])
        except ValueError:
            continue
        ry = f[0]
        t = out.setdefault(PRODUCTS[f[6]], {}).setdefault(ry, {"rows": 0, "premium": 0.0, "subsidy": 0.0,
                                                              "producer_premium": 0.0, "liability": 0.0, "indemnity": 0.0})
        t["rows"] += 1
        t["premium"] += prem
        t["subsidy"] += sub
        t["producer_premium"] += prod
        t["liability"] += liab
        t["indemnity"] += ind
    return out


def build(hist, today=None):
    today = today or datetime.now(timezone.utc).date()
    # endorsements of reinsurance year RY end by about June 30 of RY + 1 (52 weeks)
    open_from = today.year if today.month > 8 else today.year - 1
    res = {}
    d = os.path.join(hist, "sob")
    for name in sorted(os.listdir(d)):
        if not (name.startswith("lrp_") and name.endswith(".zip")):
            continue
        with zipfile.ZipFile(os.path.join(d, name)) as z:
            for member in z.namelist():
                with z.open(member) as fh:
                    part = tally(io.TextIOWrapper(fh, encoding="latin-1"))
                for pid, years in part.items():
                    for ry, t in years.items():
                        res.setdefault(pid, {})[ry] = t
    for pid, years in res.items():
        for ry, t in years.items():
            t["loss_ratio"] = round(t["indemnity"] / t["premium"], 3) if t["premium"] else None
            t["producer_loss_ratio"] = round(t["indemnity"] / t["producer_premium"], 3) if t["producer_premium"] else None
            t["open"] = int(ry) >= open_from
            for k in ("premium", "subsidy", "producer_premium", "liability", "indemnity"):
                t[k] = round(t[k])
    return {"v": 1, "source": "https://pubfs-rma.fpac.usda.gov/pub/Web_Data_Files/Summary_of_Business/livestock_and_dairy_participation/",
            "built": today.isoformat(), "by_product": res}


def selftest():
    row = ("2023|2023|01|AL|003|Baldwin|0802|Fed Cattle|81|LRP|820|Steers & Heifers|212|x|2022-07-13|21|185.850|186.572|"
           ".996100|.046963|8.728|2022-12-07|1|1|100|800.00|2444|6982|4538|148680|5296")
    t = tally([row, row.replace("|0802|", "|0804|")])
    assert list(t) == ["fed"] and t["fed"]["2023"]["indemnity"] == 5296 and t["fed"]["2023"]["premium"] == 6982
    print("lrp_sob_loss selftest: ok")


def main(argv):
    if "--selftest" in argv:
        return selftest()
    hist = argv[argv.index("--history") + 1]
    out = argv[argv.index("--out") + 1] if "--out" in argv else "data/lrp/sob-loss.json"
    res = build(hist)
    with open(out, "w") as f:
        json.dump(res, f, sort_keys=True, separators=(",", ":"))
        f.write("\n")
    for pid, years in sorted(res["by_product"].items()):
        print(pid, " ".join(f"{ry}:{t['loss_ratio']}/{t['producer_loss_ratio']}{'*' if t['open'] else ''}" for ry, t in sorted(years.items())))


if __name__ == "__main__":
    main(sys.argv[1:])
