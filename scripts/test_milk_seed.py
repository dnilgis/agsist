#!/usr/bin/env python3
"""test_milk_seed.py: offline checks for seed_static.seed_milk (2026-10-13).

Synthetic dairy files, frozen dates. The page script (milk-prices.html) shows a
class month until the next one is due (announced on or before the 5th) and an
all-milk month for two months; the baked copy has to follow the same clock, so
a crawler never reads a number the page itself would withhold. Run:
    python3 scripts/test_milk_seed.py
"""
import copy
import os
import sys

sys.path.insert(0, "scripts")
import seed_static as S  # noqa: E402

SEP = {
    "class_month": "September 2026", "class_month_key": "2026-09",
    "class2": 17.6, "class3": 16.04, "class4": 18.94,
    "class2_prev": 18.71, "class3_prev": 16.64, "class4_prev": 17.36,
    "components": {"butterfat": 1.4762, "protein": 2.6619, "nonfat_solids": 1.5343, "other_solids": 0.4147},
    "cheese": 1.5577, "cheese_chg": -0.0626, "butter": 1.4462, "butter_chg": -0.0285,
    "ndm": 1.7891, "ndm_chg": 0.1906, "whey": 0.6694, "whey_chg": 0.0092,
    "survey_cheese": 1.5577, "survey_whey": 0.6694, "survey_fat": 1.4762,
    "spot_date": "USDA survey avg · Sep 2026",
    "all_milk": {"value": 19.8, "month": "August 2026", "month_key": "2026-08",
                 "prev_month": 20.3, "year_ago": 20.9},
    "all_milk_states": {"month": "August 2026", "month_key": "2026-08", "rows": [
        {"state": "Iowa", "value": 18.9, "prev_month": 18.1, "year_ago": 19.8},
        {"state": "Georgia", "value": 25.4, "prev_month": 27.7, "year_ago": 26.0},
        {"state": "Ohio", "value": None, "prev_month": 22.3, "year_ago": 22.2}]},
}


def main():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + (f"  ({detail})" if not ok and detail else ""))
        if not ok:
            fails.append(name)

    print("model")
    r = S.milk_class3(1.5577, 0.6694, 1.4762)
    ck("September 2026 inputs give USDA's announced $16.04, protein 2.6619, other solids 0.4147",
       (r["val"], r["pp"], r["os"]) == (16.04, 2.6619, 0.4147), str(r))
    ck("August 2026 inputs give $16.64", S.milk_class3(1.6203, 0.6602, 1.5107)["val"] == 16.64)

    print("current month")
    s, key = S.milk_seeds(SEP, "2026-10-13")
    ck("seed month is the file's class month", key == "2026-09", key)
    ck("Class III cell carries the price and the month",
       'id="c3-val" data-v="16.04">$16.04' in s["milkstrip"] and "Sep 2026 · USDA announced" in s["milkstrip"])
    ck("verdict in the page script's words",
       s["milkverdict"] == "Sep: Class III fell $0.60 to $16.04. Class IV rose $1.58 to $18.94.", s["milkverdict"])
    ck("spread line", "−$2.90/cwt" in s["milkspread"] and " hidden" not in s["milkspread"])
    ck("Class IV on top: the spread line does not call this month the trap",
       "the reverse case" in s["milkspread"] and "when your best milk pays you less" not in s["milkspread"], s["milkspread"])
    ck("...and the trap heading says which way it runs now",
       s["milktrapnow"].endswith("in Sep 2026, Class IV was $2.90 above Class III. That is the reverse of the case below.</p>")
       and " hidden" not in s["milktrapnow"], s["milktrapnow"])
    up = copy.deepcopy(SEP)
    up["class3"], up["class4"] = 19.5, 17.25
    su, _ = S.milk_seeds(up, "2026-10-13")
    ck("Class III on top: the line points at the trap as this month's case",
       "Why: the trap, when your best milk pays you less" in su["milkspread"]
       and "Class III was $2.25 above Class IV. That is the case below." in su["milktrapnow"], su["milktrapnow"])
    ck("product change in cents", "▼ 6.3¢ vs Aug" in s["milkprod"], s["milkprod"][:200])
    ck("waterfall and script SEED written when the model matches",
       '"classIII":16.04' in s["__js"] and "September 2026" in s["milkfallmonth"])
    ck("all-milk cell dated by NASS month", 'data-key="2026-08">$19.80' in s["milkstrip"])
    ck("illustrative farm follows the all-milk price", "$42,966" in s["milkexample"] and "$1,736" in s["milkexample"])
    ck("states sorted high to low, a missing value is a dash with the reason",
       s["milkstates"].index("Georgia") < s["milkstates"].index("Iowa") and "A dash means NASS gave no value" in s["milkstates"])
    ck("states seed JSON is the file's", '"month_key":"2026-08"' in s["milkstates"])
    ck("no em dash anywhere", not any("—" in v for v in s.values()))

    print("the clock")
    s3, _ = S.milk_seeds(SEP, "2026-11-04")
    ck("Nov 4: October is not due yet, September still shows", 'data-v="16.04"' in s3["milkstrip"])
    s6, key6 = S.milk_seeds(SEP, "2026-11-06")
    ck("Nov 6: October is due and missing, the class cells are withheld with the month held",
       'data-v' not in s6["milkstrip"] and "Latest on file: September 2026." in s6["milkstrip"], s6["milkstrip"][:300])
    ck("...the verdict says a new month is due", "A new month is due" in s6["milkverdict"])
    ck("...components and products are withheld too",
       "$1.4762" not in s6["milkcomp"] and "$1.56" not in s6["milkprod"])
    ck("...the spread ships hidden, as the script hides it", " hidden" in s6["milkspread"])
    ck("...and so does the which-way line under the trap", " hidden" in s6["milktrapnow"])
    ck("...the seed month stays September so the script agrees", key6 == "2026-09")
    s12, _ = S.milk_seeds(SEP, "2026-10-31")
    ck("Oct 31: all-milk for August is still inside the two-month window", "$19.80" in s12["milkstrip"])
    sd, _ = S.milk_seeds(SEP, "2026-11-01")
    ck("Nov 1: August all-milk is too old, withheld with the month",
       "Latest held: August 2026. Too old to show." in sd["milkstrip"] and "$19.80" not in sd["milkstrip"])
    ck("Nov 1: the state table ships hidden behind the dash line",
       'id="dp-states" hidden' in sd["milkstates"] and "are too old" in sd["milkstates"])

    print("mailbox price")
    MB = {"month": "June 2026", "month_key": "2026-06", "value": 20.18, "year_ago_change": -1.05}
    m1 = S.milk_mailbox_seeds(MB, "2026-10-15")
    ck("four months back is the newest there is: the cell shows it, dated",
       'id="mb-val">$20.18' in m1["milkmbcell"] and "USDA AMS · June 2026" in m1["milkmbcell"]
       and "▼ −$1.05 vs Jun 2025" in m1["milkmbcell"], m1["milkmbcell"])
    ck("...the list line names the month and when AMS posts",
       "Mailbox price, June 2026" in m1["milkmbli"] and "about three months after it ends" in m1["milkmbli"]
       and "Older figure" not in m1["milkmbli"], m1["milkmbli"])
    m2 = S.milk_mailbox_seeds(dict(MB, month="March 2026", month_key="2026-03", value=18.84, year_ago_change=-2.62),
                              "2026-10-15")
    ck("seven months back: the cell is a dash with the month held",
       'data-mb="none">-</span>' in m2["milkmbcell"] and 'id="mb-val"' not in m2["milkmbcell"] and "Newest loaded: March 2026." in m2["milkmbcell"], m2["milkmbcell"])
    ck("...the list keeps the figure, labeled older, dated, with the AMS link",
       m2["milkmbli"].count("March 2026") == 1 and "Older figure" in m2["milkmbli"] and "$18.84" in m2["milkmbli"]
       and "viewReport/3357" in m2["milkmbli"], m2["milkmbli"])
    ck("...the check section says it is an older month",
       "In March 2026 the federal-order mailbox average was $18.84/cwt, down $2.62 from a year earlier (an older month"
       in m2["milkmbrow"], m2["milkmbrow"])
    ck("no year-ago change in the file: none printed",
       "year earlier" not in S.milk_mailbox_seeds(dict(MB, year_ago_change=None), "2026-10-15")["milkmbli"])
    ck("a month not over, a zero or no file seeds nothing",
       S.milk_mailbox_seeds(dict(MB, month_key="2026-10"), "2026-10-15") == {}
       and S.milk_mailbox_seeds(dict(MB, value=0), "2026-10-15") == {}
       and S.milk_mailbox_seeds(None, "2026-10-15") == {})
    ck("no em dash in the mailbox seeds", not any("—" in v for v in list(m1.values()) + list(m2.values())))

    print("mailbox by area")
    import json as _json
    real = _json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "dairy-mailbox.json")))
    ma = S.milk_mailbox_seeds(real, "2026-10-16")["milkmbareas"]
    ck("areas table: Wisconsin $18.13, down $1.00 from May, down $3.02 from Jun 2025 (21.15 - 18.13)",
       '<th scope="row">Wisconsin</th><td class="num">$18.13</td><td class="num dp-neg">▼ −$1.00</td><td class="num dp-neg">▼ −$3.02</td>' in ma, ma[:300])
    ck("areas table: Minnesota $18.04 is the low, Florida $27.59 the high, 20 areas",
       "(20 areas): highest Florida $27.59, lowest Minnesota $18.04." in ma)
    ck("areas table: national row matches the average", "All federal order areas</th><td class=\"num\">$20.18</td>" in ma)
    ck("areas table: grouped areas say what they cover", "Corn Belt States <span class=\"dp-mb-grp\">(KS, NE, northern Missouri)</span>" in ma)
    ck("areas for another month: an empty hidden box, never an old table",
       S.milk_mailbox_seeds(dict(real, areas=dict(real["areas"], month_key="2026-05")), "2026-10-16")["milkmbareas"]
       == '<div id="dp-mb-areas" hidden></div>')
    ck("a mailbox month too old to show also hides the areas",
       'hidden' in S.milk_mailbox_seeds(dict(real, month_key="2026-03", areas=dict(real["areas"], month_key="2026-03")), "2026-10-16")["milkmbareas"])
    ck("no em dash in the areas table", "—" not in ma)

    print("bad files")
    fut = copy.deepcopy(SEP)
    fut["class_month_key"] = "2026-12"
    sf, kf = S.milk_seeds(fut, "2026-10-13")
    ck("a class month in the future seeds nothing for the class block", kf is None and "milkverdict" not in sf)
    off = copy.deepcopy(SEP)
    off["survey_cheese"] = off["cheese"] = 1.70
    so, _ = S.milk_seeds(off, "2026-10-13")
    ck("model off by more than 2 cents: the waterfall is left alone", "__js" not in so and "milkfallbody" not in so)
    ck("...the announced prices are still seeded", 'data-v="16.04"' in so["milkstrip"])
    s0, k0 = S.milk_seeds({}, "2026-10-13")
    ck("an empty file seeds nothing", s0 == {} and k0 is None)

    print()
    if fails:
        print(f"{len(fails)} FAILED")
        return 1
    print("all milk seed checks pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
