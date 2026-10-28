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
    # 2026-10-28 (dairy board): the 100-cow box (August all-milk against an uncited ~$19 ERS cost,
    # "$1,736 left") is gone; the cost answer is dated and carries no national cost figure
    ck("cost FAQ: the NASS month and price, down $1.10 from a year earlier, no national cost or leftover",
       "USDA NASS put the US all-milk price at $19.80 per hundredweight in August 2026, down $1.10 from a year earlier"
       in s["milkcostfaq"] and "milkexample" not in s and not any(x in s["milkcostfaq"] for x in ("$19/", "ERS", "1,736", "$9.34")),
       s.get("milkcostfaq"))
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

    print("DMC signup (farm-bill.json byOperation.dairy.signup)")
    # 2026-10-28 dairy board item 1: the page said "2026 enrollment already closed
    # (Feb 26)" while the 2027 signup was open Oct 5 to Dec 18, 2026 (FSA, Sep 30, 2026).
    FB = {"byOperation": {"_sources": {"fsa_dmc": "<a href=\"https://www.fsa.usda.gov/x\">FSA, Sep 30, 2026</a>",
                                       "crs75": "CRS R48775"},
                          "dairy": {"label": "Dairy",
                                    "signup": {"year": 2027, "open": "2026-10-05", "close": "2026-12-18", "src": "fsa_dmc"},
                                    "lines": [{"t": "<b>2027 DMC signup is open Oct 5 to Dec 18, 2026</b>.", "src": "fsa_dmc"},
                                              {"t": "<b>Jan 1, 2027 is your date.</b>", "src": "crs75", "until": "2027-01-01"},
                                              {"t": "Forward pricing is paused."}]}}}
    d1 = S.milk_dmc_seeds(FB, "2026-10-28")
    ck("Oct 28: open, to Friday Dec 18, 51 days left",
       "2027 DMC signup is open now, to Friday, Dec 18, 2026, at your FSA office. 51 days left." in d1["milkdmccard"],
       d1.get("milkdmccard"))
    ck("...the lever and the FAQ say the same", "51 days left." in d1["milkdmc"] and "51 days left." in d1["milkdmcfaq"])
    ck("...nothing says closed", "closed" not in d1["milkdmc"] + d1["milkdmccard"] + d1["milkdmcfaq"])
    ck("...the source rides with the card", "FSA, Sep 30, 2026" in d1["milkdmccard"])
    ck("...the signup line is not printed twice", d1["milkdmccard"].count("DMC signup") == 1)
    ck("...Jan 1 and forward pricing lines carried", "Jan 1, 2027 is your date" in d1["milkdmccard"]
       and "Forward pricing is paused" in d1["milkdmccard"])
    ck("...dates ride as data- attributes for the page clock",
       'data-open="2026-10-05" data-close="2026-12-18" data-year="2027"' in d1["milkdmccard"])
    ck("Oct 1: opens Monday, Oct 5", "2027 DMC signup opens Monday, Oct 5, 2026, and runs to Dec 18, 2026."
       in S.milk_dmc_seeds(FB, "2026-10-01")["milkdmccard"])
    ck("Dec 17: 1 day left", "1 day left." in S.milk_dmc_seeds(FB, "2026-12-17")["milkdmccard"])
    ck("Dec 18: today is the last day", "Today is the last day." in S.milk_dmc_seeds(FB, "2026-12-18")["milkdmccard"])
    d9 = S.milk_dmc_seeds(FB, "2026-12-19")
    ck("Dec 19: closed, and no lock-in pitch", "The 2027 DMC signup closed Dec 18, 2026." in d9["milkdmccard"]
       and "lock-in" not in d9["milkdmc"], d9["milkdmc"])
    ck("Jan 1, 2027: the Jan 1 line drops on its date",
       "Jan 1, 2027 is your date" not in S.milk_dmc_seeds(FB, "2027-01-01")["milkdmccard"])
    ck("no signup in the file: nothing seeded (the page keeps its words)",
       S.milk_dmc_seeds({"byOperation": {"dairy": {"lines": []}}}, "2026-10-28") == {})
    bad = copy.deepcopy(FB)
    bad["byOperation"]["dairy"]["signup"]["close"] = "2026-10-01"
    ck("close before open: nothing seeded", S.milk_dmc_seeds(bad, "2026-10-28") == {})
    ck("no em dash in the DMC copy", "\u2014" not in "".join(d1.values()))

    print("DMC would have paid (data/dairy-dmc.json)")
    ck("no FSA margins: withheld, saying why, no number",
       "not shown yet" in S.milk_dmc_paid({}, SEP) and "$" not in S.milk_dmc_paid({}, SEP).split("not shown yet")[0])
    ck("...and the margin line prints the NASS milk side only",
       "DMC margin: not shown." in S.milk_dmc_margin({}, SEP, "2026-10-28")
       and "August 2026, <strong>$19.80/cwt</strong>" in S.milk_dmc_margin({}, SEP, "2026-10-28"))
    DM = {"source_url": "https://www.fsa.usda.gov/resources/programs/dairy-margin-coverage-program-dmc/prices-updates",
          "via": "archive", "snapshot": "2026-10-20",
          "archive_url": "https://web.archive.org/web/20261020000000/https://www.fsa.usda.gov/resources/programs/dairy-margin-coverage-program-dmc/prices-updates",
          "read": "2026-11-02",
          "margins": {"2018-12": {"all_milk": 17.0, "feed": 9.0, "margin": 8.0},
                      "2019-01": {"all_milk": 16.6, "feed": 8.89, "margin": 7.71},
                      "2025-07": {"all_milk": 21.0, "feed": 10.0, "margin": 11.0},
                      "2025-08": {"all_milk": 20.9, "feed": 12.4, "margin": 8.5},
                      "2026-08": {"all_milk": 19.8, "feed": 10.46, "margin": 9.34}},
          "hay": {"2019": "Blended Alfalfa Hay", "2025": "Premium Alfalfa Hay", "2026": "Premium Alfalfa Hay"},
          "withheld": {"count": 2, "months": ["2026-06", "2026-07"], "why": "not on FSA's page as read"},
          "premiums": {"year": 2027, "tier1_lb": 6000000, "source_url": "https://www.fsa.usda.gov/x.pdf",
                       "tier1": {"9.50": 0.15, "8.00": 0.1}, "tier2": {"9.50": None, "8.00": 1.813}}}
    tb = S.milk_dmc_paid(DM, SEP)
    ck("FSA rows that check out: a table by level, partial years labeled, MPP 2018 left out",
       '<th scope="col" class="num">2025*</th>' in tb and '<th scope="col" class="num">2026*</th>' in tb
       and "(2019 is Jan only; 2025 is Jul to Aug only; 2026 is Aug only)" in tb and "2018" not in tb, tb[:300])
    ck("...$9.50 in 2025 pays (0 + 1.00) / 2 = $0.50, Tier 1 and Tier 2 premium beside it",
       '<tr><th scope="row">$9.50</th><td class="num">$0.1500</td><td class="num">n/a</td>'
       '<td class="num">$0.16</td><td class="num">$0.50</td><td class="num">$1.79</td></tr>' in tb, tb)
    ck("...newest year first", tb.index(">2026*<") < tb.index(">2025*<") < tb.index(">2019*<"))
    ck("...$8.00: Tier 2 rate printed", '<tr><th scope="row">$8.00</th><td class="num">$0.1000</td><td class="num">$1.8130</td>' in tb)
    ck("...a level with no premium read is a dash, said so", '<th scope="row">$6.00</th><td class="num">-</td>' in tb
       and "A dash: not in the fact sheet as read." in tb)
    ck("...Tier 2's top level said from the rates, not typed", "FSA offers Tier 2 only up to $8.00 (n/a above)" in tb)
    np_ = S.milk_dmc_paid(dict(DM, premiums={}), SEP)
    ck("...no premium rates read: no premium columns, and it says so",
       "Tier 1 premium" not in np_ and "Premium rates: not loaded here yet" in np_)
    ck("...no level picked out", not any(w in tb.lower() for w in ("best", "recommend", "should")))
    ck("...says before premium and the months left out, with why", "before premium" in tb
       and "2 months from 2019 on (Jun 2026, Jul 2026) are left out: not on FSA" in tb, tb[-900:])
    ck("...cites FSA and the archive copy with its snapshot date",
       'href="https://www.fsa.usda.gov/resources/programs/dairy-margin-coverage-program-dmc/prices-updates"' in tb
       and "Internet Archive copy</a> of 2026-10-20" in tb)
    ck("...names the hay as FSA's own tables head it: blended alfalfa in 2019, premium from 2020",
       "price the hay in the feed cost as blended alfalfa in 2019 and as premium alfalfa from 2020 on." in tb, tb[-1200:])
    nb = copy.deepcopy(DM)
    nb["hay_notes"] = {"blend": {"text": "half premium and supreme alfalfa, half other alfalfa", "source_url": "https://www.fsa.usda.gov/n"},
                       "revision": {"text": "FSA revised 2020 on to premium alfalfa", "source_url": "https://www.fsa.usda.gov/r"}}
    tn = S.milk_dmc_paid(nb, SEP)
    ck("...the blend and the revision only when FSA's notices were read into the file",
       "(half premium and supreme alfalfa, half other alfalfa," in tn and "; FSA revised 2020 on to premium alfalfa (" in tn
       and "half other alfalfa" not in tb)
    ck("...no hay heads in the file: no hay sentence", "alfalfa" not in S.milk_dmc_paid(dict(DM, hay={}), SEP))
    ck("...Tier 1 named at 6 million lb", "Tier 1 is the first 6 million lb of your production history a year" in tb)
    ck("...the margin line shows FSA's newest month", "DMC margin, August 2026: $9.34/cwt" in S.milk_dmc_margin(DM, SEP, "2026-10-28"))
    bad = copy.deepcopy(DM)
    bad["margins"]["2026-08"]["margin"] = 9.0
    ck("milk minus feed not the margin: the whole table withheld", "not shown yet" in S.milk_dmc_paid(bad, SEP))
    bad2 = copy.deepcopy(DM)
    bad2["margins"]["2026-08"].update(all_milk=20.0, margin=9.54)
    ck("FSA all-milk not the NASS month held: withheld", "not shown yet" in S.milk_dmc_paid(bad2, SEP)
       and "DMC margin: not shown." in S.milk_dmc_margin(bad2, SEP, "2026-10-28"))

    print("your area first (dairy-mailbox.json areas)")
    import json as _json
    MBX = _json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "fixtures", "milk",
                                       "mailbox-2026-06.json"), encoding="utf-8"))
    ar = S.milk_area_seed(MBX, "2026-10-28")
    ck("June 2026: Wisconsin and Minnesota lead the falls, Florida the rises",
       "fell most in Wisconsin −$3.02, Minnesota −$2.93, Iowa −$1.81; rose most in Florida +$4.88, Southeast States +$4.49" in ar, ar)
    ck("...the federal-order average comes after, not before", ar.index("Wisconsin") < ar.index("All federal order areas: $20.18"))
    ck("five or more months behind: no area summary", S.milk_area_seed(MBX, "2026-11-15") is None)
    ck("no areas: no summary", S.milk_area_seed(dict(MBX, areas=None), "2026-10-28") is None)

    print("Order 30 panel (data/dairy-order30.json, the Oct 28 run's real file)")
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import fetch_order30 as F30
    fx = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "fixtures", "milk")
    rd = lambda n: open(os.path.join(fx, n), encoding="utf-8").read()
    L30, _w = F30.month_record("2026-09", rd("o30-class-2026-09.txt"), rd("o30-ppd-2026-09.txt"))
    Y30 = dict(L30, month_key="2025-09", class1=21.9, mover=9.34, adv_class3_skim=7.54, adv_class4_skim=9.34,
               uniform=17.94, ppd=0.35, scc=0.0009)
    o = {"latest": L30, "year_ago": Y30, "read": "2026-10-28",
         "next_class1": [{"month_key": "2026-11", "class1": 23.47}]}
    h = S.milk_o30_seed(o, SEP, "2026-10-28")
    ck("PPD +$0.58 Sep 2026 beside +$0.35 Sep 2025", ">+$0.58<" in h and ">+$0.35<" in h and "Sep 2025" in h, h)
    ck("...uniform $16.62 and Class I $20.24, base zone named", ">$16.62<" in h and ">$20.24<" in h and "Cook County, IL" in h)
    ck("...the mover called the higher of only because it is", "is the higher of the two advanced skim prices" in h)
    ck("...Class I ahead from the advance release", "Nov 2026 $23.47/cwt" in h)
    ck("...the market administrator credited", "fmma30.com" in h)
    h2 = S.milk_o30_seed(dict(o, year_ago=None), SEP, "2026-10-28")
    ck("no year-ago month: one column and it says why", "Sep 2025 is not shown" in h2 and ">+$0.35<" not in h2)
    h3 = S.milk_o30_seed({"why": "PPD index unreadable"}, SEP, "2026-10-28")
    ck("no file month: withheld, no number", "Order 30 numbers: not shown yet" in h3 and "$0.58" not in h3)
    ck("depooling line: Sep 2026 Class IV $2.90 over III", "Depooling watch, Sep 2026:" in h and "$2.90/cwt over Class III" in h)
    ck("...not said when IV is within $1.00", S.milk_depool(dict(SEP, class4=SEP["class3"] + 0.99), "2026-10-28") == "")
    ck("...not said for a stale class month", S.milk_depool(SEP, "2027-02-01") == "")
    hist = []
    for i in range(24):
        y, m = divmod(2024 * 12 + 9 + i, 12)
        k = "%d-%02d" % (y, m + 1)
        hist.append({"month_key": k, "ppd": round(0.1 + i / 100, 2), "uniform": round(17.0 + 0.1 + i / 100, 2), "class3": 17.0,
                     "central": "agree" if (k[:4] != "2024" and m % 3 == 0) or k in ("2024-10", "2024-11") else None})
    oh = dict(o, ppd_history=hist, ppd_history_why={})
    hh = S.milk_o30_hist(oh)
    ck("PPD history: years with 3+ months matched to the central summary print, by month",
       'id="dp-o30-hist"' in hh and '<th scope="col" class="num">2025</th><th scope="col" class="num">2026</th>' in hh
       and "Jan 2025 to Sep 2026" in hh, hh[:400])
    ck("...2024 (2 months matched) is held out and counted", ">2024<" not in hh and "3 months in the window are left out" in hh, hh[-700:])
    ck("...Jan 2025 PPD +$0.13 in its cell", '<tr><th scope="row">Jan</th><td class="num">+$0.13</td><td class="num">+$0.25</td></tr>' in hh, hh)
    bad = [dict(r) for r in hist]
    bad[5]["central"] = "differ"
    ck("...a month that differs from the central summary holds out its whole year",
       ">2025<" not in S.milk_o30_hist(dict(o, ppd_history=bad)))
    bad2 = [dict(r) for r in hist]
    bad2[-1]["uniform"] = 99.0
    ck("...a row whose uniform is not Class III plus PPD is not printed", "Sep 2026" not in S.milk_o30_hist(dict(o, ppd_history=bad2)))
    ck("...no depooled pounds inferred", "pooled pounds" not in hh.lower() and "not published by order and month" in hh)
    ck("no history: nothing", S.milk_o30_hist(o) == "")
    ck("the panel carries the history", 'id="dp-o30-hist"' in S.milk_o30_seed(oh, SEP, "2026-10-28"))
    ck("no em dash in the Order 30 copy", "\u2014" not in h + h2 + h3)

    print("the published miss (data/dairy-miss.json)")
    m0 = S.milk_miss_seed({"started": "2026-10-28", "months": {"2026-11": {"contract": "2026-11"}}}, "2026-10-28")
    ck("nothing graded yet: says when the first month is", "No month graded yet. The first month it can grade is November 2026" in m0, m0)
    m1 = S.milk_miss_seed({"started": "2026-10-28", "months": {"2026-11": {"said": 17.86, "said_session": "2026-10-30",
                                                                          "actual": 17.5, "miss": -0.36}}}, "2026-12-03")
    ck("a graded month: futures as it began, announced, miss", ">$17.86 <" in m1 and ">$17.50<" in m1 and "−$0.36" in m1 and "Oct 30" in m1, m1)
    ck("...with the sample size", "1 month graded" in m1)

    print()
    if fails:
        print(f"{len(fails)} FAILED")
        return 1
    print("all milk seed checks pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
