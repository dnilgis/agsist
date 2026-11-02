#!/usr/bin/env python3
"""farm_credit_view.py -- the farm credit sections of the Farmland Atlas pages.

Reads data/farm-credit/districts.json (scripts/build_farm_credit.py) and returns
HTML for build_atlas_pages.py: one section on each state page (the state's Fed
district, or both districts of a split state) and one compact national section
on the Atlas "By state" hub. No file, no section. Every number on the page is a
value from the file; the page computes nothing but which side of 100 it sits.

    python3 scripts/farm_credit_view.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
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
    """Plain words for one reading, by its side of 100. Short: the explanation of the
    index is said once per page, in the collapsed note."""
    if v == 100:
        return "100: as many bankers said higher as said lower."
    up = v > 100
    o = "Over" if up else "Under"
    if key == "repay":
        return "%s 100: more bankers said repayment rates %s than %s." % (o, "rose" if up else "fell", "fell" if up else "rose")
    if key == "renew":
        return "%s 100: more bankers said renewals or extensions %s than %s." % (o, "rose" if up else "fell", "fell" if up else "rose")
    return "%s 100: more bankers asked for %s collateral than %s." % (o, "more" if up else "less", "less" if up else "more")


def verdict(repay, renew):
    """The one-line reading of a district: which way the two numbers point."""
    if repay is None or renew is None:
        return None
    if repay < 100 and renew > 100:
        return "Tighter for borrowers than a year earlier"
    if repay > 100 and renew < 100:
        return "Easier for borrowers than a year earlier"
    if repay == 100 and renew == 100:
        return "About the same as a year earlier"
    return "Mixed: the two readings point different ways"


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
    """One short linked line per card: the reserve bank's own survey page and the quarter."""
    x = doc["districts"][d]
    return 'Source: <a href="%s" rel="noopener">%s Fed ag survey</a>, %s.' % (esc(x["url"]), esc(x["name"]), esc(ql(doc["latest"])))


def withheld_since(doc, d):
    return sorted({w["q"] for w in doc.get("withheld") or [] if w["district"] == d and qn(w["q"]) >= qn(doc["chart_from"])}, key=qn)


def district_card(doc, d, compact=False, states_line=""):
    """One district: the reading, the numbers, the chart and one source line. The
    explanation (the index, what is left out and why) is in the page's one note."""
    x = doc["districts"][d]
    lat = x["latest"]
    q = ql(doc["latest"])
    v = verdict(lat["repay"], lat["renew"])
    svg = chart_svg(doc, d, *((320, 180, 480) if compact else (360, 210, 560)))
    mark = ('<p class="note">%s The dotted line marks it.</p>' % esc(x["note"])) if (svg and x.get("note")) else ""
    src = '<p class="note">%s</p></div>' % source_line(doc, d)
    if compact:
        h = '<div class="card"><h2>%s <small>%s · %s</small></h2>' % (esc(x["name"]), ORD.get(x["num"], str(x["num"])), esc(q))
        h += '<p class="note">%s</p>' % esc(states_line)
        h += ('<p class="note"><b>%s.</b> Repayment index %s, renewals or extensions index %s.</p>'
              % (esc(v), esc(val(lat["repay"])), esc(val(lat["renew"]))))
        return h + svg + mark + src
    h = '<div class="card"><h2>%s Fed district <small>%s · %s</small></h2>' % (esc(x["name"]), ORD.get(x["num"], str(x["num"])), esc(q))
    h += '<p class="read">%s.</p>' % esc(v)
    h += fact("Loan repayment rate", val(lat["repay"]), esc(side("repay", lat["repay"])))
    h += fact("Renewals or extensions", val(lat["renew"]), esc(side("renew", lat["renew"])))
    if lat.get("collat") is not None:
        h += fact("Collateral required", val(lat["collat"]), esc(side("collat", lat["collat"])))
    return h + svg + mark + src


def how_block(doc, shown):
    """The page's one note on how to read the section, collapsed."""
    D = doc["districts"]
    left = []
    for d in shown:
        g = withheld_since(doc, d)
        if g:
            left.append("%s: %s" % (D[d]["name"], ", ".join(ql(q_) for q_ in g)))
    p2 = ('The numbers come from the <a href="%s" rel="noopener">Kansas City Fed&#x27;s table</a> of every district survey. '
          'Chicago and Dallas quarters are checked against those banks&#x27; own files; a quarter where the two disagree is '
          'left out rather than guessed, and shows as a gap in the chart, as does a quarter not reported.' % esc(doc["source_url"]))
    if left:
        p2 += " Left out where the two files disagree: %s." % esc("; ".join(left))
    p3 = ('Fed districts do not follow state lines: a split state shows each district that reports. Richmond and San Francisco '
          'have no reading in the table after %s and %s, so they are not shown. Read %s.'
          % (esc(ql(D["RICH"]["last"])), esc(ql(D["SF"]["last"])), esc(doc["built"])))
    return '<details><summary>How this works</summary><p>%s</p><p>%s</p><p>%s</p></details>' % (esc(doc["how"]), p2, p3)


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
    return h + how_block(doc, live)


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
    h += '<p class="sub">%s Each state page shows its own district.</p>' % esc(lead)
    h += '<div class="keys">%s</div>' % "".join(district_card(doc, d, compact=True, states_line=states_of(doc, d)) for d in live)
    return h + how_block(doc, live)


def selftest():
    fails = []

    def check(name, cond):
        if not cond:
            fails.append(name)
            print("FAIL", name)
    check("value as printed", val(73) == "73" and val(96.15) == "96.15" and val(85.7) == "85.7" and val(124.0) == "124")
    check("repayment words", side("repay", 73) == "Under 100: more bankers said repayment rates fell than rose.")
    check("renewals words", side("renew", 124) == "Over 100: more bankers said renewals or extensions rose than fell.")
    check("collateral words", side("collat", 116) == "Over 100: more bankers asked for more collateral than less.")
    check("verdicts", verdict(73, 124) == "Tighter for borrowers than a year earlier" and verdict(110, 90).startswith("Easier")
          and verdict(100, 100).startswith("About the same") and verdict(90, 90).startswith("Mixed") and verdict(None, 90) is None)
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
    check("verdict on the page", '<p class="read">Tighter for borrowers than a year earlier.</p>' in ia)
    check("numbers with their reading", '<span class="r">73<small>Under 100: more bankers said repayment rates fell than rose.</small>' in ia
          and '<span class="r">124<small>Over 100: more bankers said renewals or extensions rose than fell.</small>' in ia
          and '<span class="r">116<small>Over 100: more bankers asked for more collateral than less.</small>' in ia)
    il = state_section(doc, "IL", "Illinois")
    check("split state: both shown", "Parts of Illinois are in the Chicago and St. Louis Fed districts. Both are shown." in il and il.count('class="card"') == 2)
    ky = state_section(doc, "KY", "Kentucky")
    check("split state: one without a survey", "Parts of Kentucky are in the St. Louis and Cleveland Fed districts. The Cleveland district has no farm credit survey in the Kansas City Fed&#x27;s table, so only St. Louis is shown." in ky)
    check("no current district: no section", state_section(doc, "CA", "California") == "" and state_section(doc, "WV", "West Virginia") == "" and state_section({}, "IA", "Iowa") == "")
    check("withheld quarter named once, in the note", "disagree: Chicago: 2010 Q2." in ia and ia.count("2010 Q2") == 1
          and ia.index("2010 Q2") > ia.index("<details>"))
    check("one short source line per card", ia.count('Source: <a href="https://www.chicagofed.org/" rel="noopener">Chicago Fed ag survey</a>, 2010 Q4.') == 1
          and il.count("Source: <a ") == 2 and il.count("Fed ag survey</a>, 2010 Q4.") == 2)
    check("explanation once per page, collapsed", ia.count("<details>") == 1 and ia.count("How.") == 1 and il.count("<details>") == 1
          and "Kansas City Fed&#x27;s table</a>" in ia and ia.count("kansascityfed") == 1
          and ia.index("Kansas City Fed&#x27;s table") > ia.index("<details>"))
    check("no methodology on the card", "Since " not in ia and "Gold" not in ia and "index, 2010" not in ia)
    check("split state note names only its shown districts", "Chicago: 2010 Q2" in il and "St. Louis:" not in il)
    check("quarter arithmetic", qadd("2010Q1", 9) == "2012Q2")
    check("chart gap is a gap", "M" in chart_svg(doc, "CHI") and chart_svg(doc, "CHI").count('class="ln s0"') == 1)
    hub = hub_section(doc)
    check("hub: all districts tighter", "In all 2 districts that report" in hub and hub.count('class="card"') == 2)
    check("hub states line", "Iowa; parts of Illinois" in hub)
    check("hub card is short", "Tighter for borrowers than a year earlier.</b> Repayment index 73, renewals or extensions index 124." in hub
          and hub.count("Source: <a ") == 2 and hub.count("<details>") == 1 and "disagree: Chicago: 2010 Q2." in hub
          and "Repayment under 100 means" not in hub)
    check("no em dash", "—" not in ia + il + ky + hub)
    print("selftest: %d failed" % len(fails) if fails else "selftest: all passed")
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print(__doc__)
