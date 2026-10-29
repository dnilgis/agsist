#!/usr/bin/env python3
"""farm_credit_view.py -- the farm credit sections of the Farmland Atlas pages.

Reads data/farm-credit/districts.json (scripts/build_farm_credit.py) and returns
HTML for build_atlas_pages.py: one section on each state page (the state's Fed
district, or both districts of a split state) and one compact national section
on the Atlas "By state" hub. No file, no section. Every number on the page is a
value from the file; the page computes nothing but which side of 100 it sits.

    python3 scripts/farm_credit_view.py --selftest
"""
import html
import json
import os
import sys

FILE = os.path.join("data", "farm-credit", "districts.json")
SCHEMA = "agsist-farm-credit/1"
STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
    "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
    "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
ORD = {5: "5th", 7: "7th", 8: "8th", 9: "9th", 10: "10th", 11: "11th", 12: "12th"}


def esc(s):
    return html.escape(str(s), quote=True)


def load(root="."):
    try:
        d = json.load(open(os.path.join(root, FILE), encoding="utf-8"))
        if d.get("schema") == SCHEMA and d.get("districts") and d.get("states"):
            return d
    except Exception:
        pass
    return {}


def ql(q):
    return q[:4] + " Q" + q[5]


def val(v):
    """The file's value as printed: 73, 96.15, 85.7."""
    s = "%.2f" % v
    return s.rstrip("0").rstrip(".")


def qadd(q, i):
    k = qn(q) + i
    return "%dQ%d" % (k // 4, k % 4 + 1)


def qn(q):
    return int(q[:4]) * 4 + int(q[5]) - 1


def side(key, v):
    """Plain words for one reading: what the bankers said, by its side of 100."""
    if v == 100:
        return "100: as many bankers said higher as said lower."
    up = v > 100
    if key == "repay":
        return ("%s 100: more bankers said farm loans were being repaid at a %s rate than a year earlier than said a %s rate."
                % ("Over" if up else "Under", "higher" if up else "lower", "lower" if up else "higher"))
    if key == "renew":
        return ("%s 100: more bankers said they renewed or extended %s farm loans than a year earlier than said %s."
                % ("Over" if up else "Under", "more" if up else "fewer", "fewer" if up else "more"))
    return ("%s 100: more bankers said they asked for %s collateral than a year earlier than said %s."
            % ("Over" if up else "Under", "more" if up else "less", "less" if up else "more"))


def verdict(name, repay, renew):
    if repay is None or renew is None:
        return None
    if repay < 100 and renew > 100:
        lead = "Tighter for borrowers than a year earlier"
    elif repay > 100 and renew < 100:
        lead = "Easier for borrowers than a year earlier"
    elif repay == 100 and renew == 100:
        lead = "About the same as a year earlier"
    else:
        lead = "Mixed: the two readings point different ways"
    r = ("more %s bankers said loan repayment was lower than said higher" % name if repay < 100 else
         "more %s bankers said loan repayment was higher than said lower" % name if repay > 100 else
         "%s bankers were evenly split on loan repayment" % name)
    n = ("more said renewals or extensions were up than said down" if renew > 100 else
         "more said renewals or extensions were down than said up" if renew < 100 else
         "they were evenly split on renewals or extensions")
    return "%s: %s, and %s." % (lead, r, n)


def chart_svg(doc, d, w=360, h=210, max_w=560):
    """Repayment (gold, solid) and renewals or extensions (blue, dashed) since the file's
    chart_from quarter, the even-split 100 line, a gap wherever a quarter is withheld or
    not reported. The site's own chart classes (atlas-pages.css .ch), so both themes work."""
    x = doc["districts"][d]
    q0, q1 = qn(doc["chart_from"]), qn(doc["latest"])
    sets = [("repay", "s0", "repayment"), ("renew", "s1", "renewals")]
    vals = [v for k, _c, _n in sets for v in x["chart"][k] if v is not None]
    if len(vals) < 4:
        return ""
    lo = min(min(vals), 100)
    hi = max(max(vals), 100)
    lo, hi = 20 * int(lo // 20), 20 * (-int(-hi // 20))
    if hi - lo < 60:
        hi = lo + 60
    ends = []
    for k, c, nm in sets:
        last = x["chart"][k][-1]
        if last is not None:
            ends.append([k, c, "%s %s" % (val(last), nm), last])
    L, T, B = 30, 10, 20
    R = max(40, int(max([len(e[2]) for e in ends] + [6]) * 6.2) + 10)
    n = q1 - q0
    X = lambda i: L + (i / n if n else 0) * (w - L - R)
    Y = lambda v: T + (1 - (v - lo) / float(hi - lo)) * (h - T - B)
    s, grid = [], []
    step = 20 if hi - lo <= 120 else 40
    g = lo
    while g <= hi:
        if g != 100:
            grid.append("M%d %.1fH%d" % (L, Y(g), w - R))
        s.append('<text class="ta tay" x="%d" y="%.1f">%d</text>' % (L - 4, Y(g) + 3, g))
        g += step
    if (100 - lo) % step:
        s.append('<text class="ta tay" x="%d" y="%.1f">100</text>' % (L - 4, Y(100) + 3))
    s.insert(0, '<path class="gr" d="%s"/>' % "".join(grid))
    s.append('<path class="ax" style="stroke-width:1.6" d="M%d %.1fH%d"/>' % (L, Y(100), w - R))
    y0 = int(doc["chart_from"][:4])
    for yr in range(y0, int(doc["latest"][:4]) + 1, 4):
        s.append('<text class="ta" x="%.1f" y="%d">%d</text>' % (X(yr * 4 - q0), h - 5, yr))
    mk = x.get("mark")
    if mk and q0 <= qn(mk["q"]) <= q1:
        xm = X(qn(mk["q"]) - q0)
        s.append('<path class="gr" style="stroke-dasharray:2 2" d="M%.1f %dV%d"/>' % (xm, T, h - B))
    for k, c, _nm in sets:
        ser = x["chart"][k]
        path, dots, prev = "", "", None
        for i, v in enumerate(ser):
            if v is None:
                prev = None
                continue
            path += ("L" if prev is not None else "M") + "%.1f %.1f" % (X(i), Y(v))
            alone = (i == 0 or ser[i - 1] is None) and (i == len(ser) - 1 or ser[i + 1] is None)
            if alone or i == len(ser) - 1:
                dots += "M%.1f %.1fh.01" % (X(i), Y(v))
            prev = i
        s.append('<path class="ln %s" d="%s"/>' % (c, path))
        if dots:
            s.append('<path class="dt %s" d="%s"/>' % (c, dots))
    # end labels, pushed apart when the two last points sit close
    ys = [Y(e[3]) + 3 for e in ends]
    if len(ys) == 2 and abs(ys[0] - ys[1]) < 11:
        mid = (ys[0] + ys[1]) / 2
        a, b = (mid - 5.5, mid + 5.5) if ys[0] <= ys[1] else (mid + 5.5, mid - 5.5)
        ys = [a, b]
    for e, yy in zip(ends, ys):
        s.append('<text class="tl %s" x="%.1f" y="%.1f">%s</text>' % (e[1], X(n) + 5, yy, esc(e[2])))
    lab = "%s Fed district, %s to %s: loan repayment index (solid) and renewals or extensions index (dashed)" % (
        x["name"], ql(doc["chart_from"]), ql(doc["latest"]))
    # a narrow drawing, capped in width, keeps its 10px text readable on a phone and not huge on a desktop
    return '<svg viewBox="0 0 %d %d" role="img" aria-label="%s" class="ch" style="max-width:%dpx">%s</svg>' % (w, h, esc(lab), max_w, "".join(s))


def fact(label, value, small):
    return ('<div class="fact st"><span class="l">%s</span><span class="r">%s<small>%s</small></span></div>'
            % (esc(label), esc(value), small))


def source_line(doc, d):
    x = doc["districts"][d]
    bank = '<a href="%s" rel="noopener">Federal Reserve Bank of %s</a>' % (esc(x["url"]), esc(x["name"]))
    kc = '<a href="%s" rel="noopener">Kansas City Fed</a>' % esc(doc["source_url"])
    if d == "KC":
        t = "Source: %s survey of ag bankers, %s." % (bank, ql(doc["latest"]))
    else:
        t = "Source: %s survey of ag bankers, %s, as compiled by the %s." % (bank, ql(doc["latest"]), kc)
    if x.get("note"):
        t += " " + esc(x["note"]) + " The dotted line marks that quarter."
    return t


def withheld_since(doc, d):
    return sorted({w["q"] for w in doc.get("withheld") or [] if w["district"] == d and qn(w["q"]) >= qn(doc["chart_from"])}, key=qn)


def district_card(doc, d, compact=False, states_line=""):
    """One district. compact (the hub): the verdict, the two numbers in one line, the
    small chart and the source; the plain words for each index are said once above."""
    x = doc["districts"][d]
    lat = x["latest"]
    q = ql(doc["latest"])
    i0 = min(i for k in ("repay", "renew") for i, v_ in enumerate(x["chart"][k]) if v_ is not None)
    since = ql(qadd(doc["chart_from"], i0))
    gaps = withheld_since(doc, d)
    v = verdict(x["name"], lat["repay"], lat["renew"])
    svg = chart_svg(doc, d, *((320, 180, 480) if compact else (360, 210, 560)))
    if compact:
        h = '<div class="card"><h2>%s <small>%s · %s</small></h2>' % (esc(x["name"]), ORD.get(x["num"], str(x["num"])), esc(q))
        h += '<p class="note">%s</p>' % esc(states_line)
        h += ('<p class="note"><b>%s.</b> Repayment index %s, renewals or extensions index %s.</p>'
              % (esc(v.split(":")[0]), esc(val(lat["repay"])), esc(val(lat["renew"]))))
        h += svg
        g = (" %d quarter%s left out where the Kansas City Fed's table and the %s Fed's own file disagree."
             % (len(gaps), "" if len(gaps) == 1 else "s", x["name"])) if gaps else ""
        h += '<p class="note">Gold: repayment. Blue dashed: renewals or extensions. Since %s.%s %s</p></div>' % (
            esc(since), esc(g), source_line(doc, d))
        return h
    h = '<div class="card"><h2>%s Fed district <small>%s · %s</small></h2>' % (esc(x["name"]), ORD.get(x["num"], str(x["num"])), esc(q))
    h += '<p class="read">%s</p>' % esc(v)
    h += fact("Loan repayment rate", val(lat["repay"]), "index, %s · %s" % (esc(q), esc(side("repay", lat["repay"]))))
    h += fact("Renewals or extensions", val(lat["renew"]), "index, %s · %s" % (esc(q), esc(side("renew", lat["renew"]))))
    if lat.get("collat") is not None:
        h += fact("Collateral required", val(lat["collat"]), "index, %s · %s" % (esc(q), esc(side("collat", lat["collat"]))))
    if svg:
        h += svg
        g = ""
        if gaps:
            g = (" Left out where the Kansas City Fed's table and the %s Fed's own file disagree: %s."
                 % (x["name"], ", ".join(ql(q_) for q_ in gaps)))
        h += '<p class="note">Since %s. Gold solid line: loan repayment. Blue dashed line: renewals or extensions. The grey line at 100 is an even split. A gap is a quarter not reported or left out.%s</p>' % (
            esc(since), esc(g))
    h += '<p class="note">%s</p></div>' % source_line(doc, d)
    return h


def how_block(doc):
    return ('<details><summary>How these numbers work</summary><p>%s</p><p>The Fed districts do not follow state lines. '
            'A state wholly inside one district shows that district; a state split between districts shows each one that '
            'reports. The Richmond and San Francisco districts have no reading in the Kansas City Fed\'s table after %s and %s, '
            'so they are not shown. Chicago and Dallas quarters are checked against those banks\' own files; a quarter where '
            'the two disagree is left out rather than guessed. Read %s.</p></details>'
            % (esc(doc["how"]), esc(ql(doc["districts"]["RICH"]["last"])), esc(ql(doc["districts"]["SF"]["last"])), esc(doc["built"])))


def state_section(doc, st, stn):
    """The state page section. '' when no district covering the state reports a current quarter."""
    if not doc:
        return ""
    ds = (doc.get("states") or {}).get(st) or []
    live = [d for d in ds if (doc["districts"].get(d) or {}).get("current")]
    if not live:
        return ""

    def nm(d):
        return doc["districts"][d]["name"] if d in doc["districts"] else doc["no_survey"][d]
    if len(ds) == 1:
        lead = "%s is in the %s Fed district (%s)." % (stn, nm(ds[0]), ORD.get(doc["districts"][ds[0]]["num"], ""))
    else:
        lead = "Parts of %s are in the %s and %s Fed districts." % (stn, ", ".join(nm(d) for d in ds[:-1]), nm(ds[-1]))
        missing = [d for d in ds if d not in live]
        if not missing:
            lead += " Both are shown." if len(ds) == 2 else " All are shown."
        else:
            why = []
            for d in missing:
                if d in doc["no_survey"]:
                    why.append("the %s district has no farm credit survey in the Kansas City Fed's table" % nm(d))
                else:
                    why.append("the %s district has no reading after %s" % (nm(d), ql(doc["districts"][d]["last"])))
            why = "; ".join(why)
            lead += " %s, so only %s is shown." % (why[:1].upper() + why[1:], " and ".join(nm(d) for d in live))
    h = '<h2 id="farm-credit">Farm loans: what ag bankers report</h2>'
    h += '<p class="sub">Is farm credit getting tighter where you farm? Each quarter the Federal Reserve asks ag bankers how repayment and loan renewals compare with a year earlier. %s</p>' % esc(lead)
    h += "".join(district_card(doc, d) for d in live)
    return h + how_block(doc)


def states_of(doc, d):
    whole = [STATE_NAMES[s] for s, ds in sorted(doc["states"].items(), key=lambda kv: STATE_NAMES[kv[0]]) if ds == [d]]
    part = [STATE_NAMES[s] for s, ds in sorted(doc["states"].items(), key=lambda kv: STATE_NAMES[kv[0]]) if d in ds and len(ds) > 1]
    bits = []
    if whole:
        bits.append(", ".join(whole))
    if part:
        bits.append("parts of " + ", ".join(part))
    return "; ".join(bits)


def hub_section(doc):
    if not doc:
        return ""
    live = [d for d, x in doc["districts"].items() if x.get("current")]
    if not live:
        return ""
    live.sort(key=lambda d: doc["districts"][d]["num"])
    tight = [d for d in live if doc["districts"][d]["latest"]["repay"] < 100 and doc["districts"][d]["latest"]["renew"] > 100]
    if len(tight) == len(live):
        lead = ("In all %d districts that report, more ag bankers said loan repayment was lower than a year earlier than said "
                "higher, and more said renewals or extensions were up." % len(live))
    else:
        lead = ("In %d of the %d districts that report, more ag bankers said loan repayment was lower than a year earlier "
                "and renewals or extensions were up." % (len(tight), len(live)))
    h = '<h2 id="farm-credit">Farm loans by Fed district, %s</h2>' % esc(ql(doc["latest"]))
    h += ('<p class="sub">%s Repayment under 100 means more bankers said loans were repaid at a lower rate than a year earlier '
          'than said higher; renewals or extensions over 100 means more said they renewed or extended more loans than said fewer. '
          'Each state page shows its own district.</p>' % esc(lead))
    h += '<div class="keys">%s</div>' % "".join(district_card(doc, d, compact=True, states_line=states_of(doc, d)) for d in live)
    return h + how_block(doc)


def selftest():
    fails = []

    def check(name, cond):
        if not cond:
            fails.append(name)
            print("FAIL", name)
    check("value as printed", val(73) == "73" and val(96.15) == "96.15" and val(85.7) == "85.7" and val(124.0) == "124")
    check("repayment words", side("repay", 73) == "Under 100: more bankers said farm loans were being repaid at a lower rate than a year earlier than said a higher rate.")
    check("renewals words", side("renew", 124) == "Over 100: more bankers said they renewed or extended more farm loans than a year earlier than said fewer.")
    check("even split", side("renew", 100).startswith("100: as many"))
    q = ["2010Q1", "2010Q2", "2010Q3", "2010Q4"]
    doc = {"schema": SCHEMA, "latest": "2010Q4", "chart_from": "2010Q1", "built": "2026-10-28", "how": "How.", "source_url": "https://www.kansascityfed.org/agriculture/ag-credit-survey/",
           "no_survey": {"CLE": "Cleveland", "ATL": "Atlanta"},
           "districts": {
               "CHI": {"name": "Chicago", "num": 7, "url": "https://www.chicagofed.org/", "current": True, "last": "2010Q4", "note": "", "mark": None,
                       "latest": {"repay": 73, "renew": 124, "collat": 116}, "chart": {"repay": [90, None, 70, 73], "renew": [110, 120, 130, 124]}},
               "STL": {"name": "St. Louis", "num": 8, "url": "https://www.stlouisfed.org/", "current": True, "last": "2010Q4", "note": "", "mark": None,
                       "latest": {"repay": 66.67, "renew": 126.19, "collat": 138.1}, "chart": {"repay": [60, 61, 62, 66.67], "renew": [130, 131, 129, 126.19]}},
               "RICH": {"name": "Richmond", "num": 5, "url": "https://www.richmondfed.org/", "current": False, "last": "2010Q1", "latest": None, "chart": {"repay": [1, None, None, None], "renew": [1, None, None, None]}},
               "SF": {"name": "San Francisco", "num": 12, "url": "https://www.frbsf.org/", "current": False, "last": "2010Q1", "latest": None, "chart": {"repay": [1, None, None, None], "renew": [1, None, None, None]}}},
           "states": {"IA": ["CHI"], "IL": ["CHI", "STL"], "KY": ["STL", "CLE"], "CA": ["SF"], "WV": ["RICH", "CLE"]},
           "withheld": [{"district": "CHI", "q": "2010Q2", "series": "repay", "kc": 82, "own": 64}]}
    ia = state_section(doc, "IA", "Iowa")
    check("whole state names its district", "Iowa is in the Chicago Fed district (7th)." in ia and ia.count('class="card"') == 1)
    check("verdict on the page", "Tighter for borrowers than a year earlier: more Chicago bankers said loan repayment was lower than said higher" in ia)
    il = state_section(doc, "IL", "Illinois")
    check("split state: both shown", "Parts of Illinois are in the Chicago and St. Louis Fed districts. Both are shown." in il and il.count('class="card"') == 2)
    ky = state_section(doc, "KY", "Kentucky")
    check("split state: one without a survey", "Parts of Kentucky are in the St. Louis and Cleveland Fed districts. The Cleveland district has no farm credit survey in the Kansas City Fed&#x27;s table, so only St. Louis is shown." in ky)
    check("no current district: no section", state_section(doc, "CA", "California") == "" and state_section(doc, "WV", "West Virginia") == "" and state_section({}, "IA", "Iowa") == "")
    check("withheld quarter named", "disagree: 2010 Q2." in ia)
    check("chart start is the first quarter drawn", "Since 2010 Q1." in ia and qadd("2010Q1", 9) == "2012Q2")
    check("source and quarter on every card", ia.count("Federal Reserve Bank of Chicago</a> survey of ag bankers, 2010 Q4") == 1)
    check("chart gap is a gap", "M" in chart_svg(doc, "CHI") and chart_svg(doc, "CHI").count('class="ln s0"') == 1)
    hub = hub_section(doc)
    check("hub: all districts tighter", "In all 2 districts that report" in hub and hub.count('class="card"') == 2)
    check("hub states line", "Iowa; parts of Illinois" in hub)
    check("hub card is short", "Tighter for borrowers than a year earlier.</b> Repayment index 73, renewals or extensions index 124." in hub
          and "1 quarter left out" in hub and "Federal Reserve Bank of Chicago</a>" in hub)
    check("no em dash", "—" not in ia + il + ky + hub)
    print("selftest: %d failed" % len(fails) if fails else "selftest: all passed")
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print(__doc__)
