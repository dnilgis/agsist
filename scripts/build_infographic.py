#!/usr/bin/env python3
"""build_infographic.py: one Infographic of the Week spec, data/infographics/<date>.json, from our own data files.

Every number in the spec is read or computed here from a committed source file; nothing is typed by hand. Each
fact carries its source and the date it is from. The spec is what the page (scripts/build_infographic_pages.py),
the phone picture, the link preview and the print sheet (components/infographic.js) are all drawn from.

KINDS
  harvest-gap   corn and soybean harvest by state against the 5-year average NASS prints in its weekly Crop
                Progress report (data/crop-progress.json; only rows whose average carries avg5_by NASS). The hook
                is the state furthest from its average, the national rows and the count of states behind are facts.
  funds-corn    managed money's net position in corn futures (CFTC Disaggregated Futures-Only) and its path over
                the run of weekly moves the same way (data/cot-history.json, consecutive weeks only), with the
                week's long and short split from data/cot-analysis.json (commodities.corn.card.how), checked
                against the history rows; the two files must be on the same report week or the build refuses.

RULES (honest numbers)
  - No look-ahead: the source must be published on or before the spec's date (Crop Progress the day after its
    week ends, the COT report on its release day); a source newer than the date is refused.
  - Too old: a source more than MAX_AGE_DAYS before the date is refused (withhold, do not print old news as new).
  - No forecast, no advice, no names: facts are what the source says and plain arithmetic on it.

SPEC (data/infographics/<yyyy-mm-dd>.json)
  {date, slug, kind, title (the hook, at most 60 characters), big {value, unit, label}, chart {type: bars|line,
   title, unit, axis {x, y}, series, panels [{title, rows [{key, label, values}]}] | points [{x, label, y}],
   highlight}, facts [{text, source, date}], sources [{name, url, period}], topic, related_page, data_date,
   poster {kicker, headline {lead, em, tail}, lede [{s, b}], panels [{id, title, source, date, ...}], data_line}}

POSTER (the Friday Chart poster, Sig Nov 7: dark for phones, paper for an 11 x 17 print; components/infographic.js
draws it): 5 or 6 panels, every number computed here from the same files, each panel with its source and date.
  harvest-gap   hook (the furthest state, its week's gain), map (every state's points vs its own average),
                count (behind, even, ahead), crops (U.S. corn vs soybeans), lists (most behind and most ahead; a tie
                at the fifth place is shown, not broken), means (what it means and does not)
  funds-corn    hook (the net now and where the run started), line (the weekly net), split (longs and shorts at
                the run's start and now), changes (each week's move), rank (where the net sits in the record, as a
                share of open interest, when data/cot-analysis.json carries it for the same week), means

  python3 scripts/build_infographic.py harvest-gap 2026-11-06            write data/infographics/2026-11-06.json
  python3 scripts/build_infographic.py funds-corn 2026-11-06 --print     print the spec, write nothing
  python3 scripts/build_infographic.py harvest-gap 2026-11-06 --root DIR --out DIR   (tests: fixture files)
  python3 scripts/build_infographic.py --selftest
"""
import json
import os
import sys
from datetime import date, timedelta

try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join("data", "infographics")
MAX_AGE_DAYS = 14
TITLE_MAX = 60
KINDS = ("harvest-gap", "funds-corn")

MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
    "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia",
    "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
NASS = "USDA NASS Crop Progress"
NASS_URL = "https://www.nass.usda.gov/Publications/National_Crop_Progress/"
CFTC = "CFTC Commitments of Traders, Disaggregated Futures-Only"
CFTC_URL = "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"
CROPS = (("corn", "corn_harvested", "Corn"), ("soybeans", "soybeans_harvested", "Soybean"))


class Refuse(Exception):
    """the source cannot honestly make this spec (too new, too old, missing, two files disagree)"""


def mdy(iso):
    y, m, d = iso[:10].split("-")
    return "%s %d, %s" % (MON[int(m) - 1], int(d), y)


def md(iso):
    return "%s %d" % (MON[int(iso[5:7]) - 1], int(iso[8:10]))


def num(n):
    return "{:,}".format(int(n))


def signed(n):
    return ("+" if n > 0 else "−" if n < 0 else "") + num(abs(n))


def day(iso):
    return date.fromisoformat(str(iso)[:10])


def check_dates(issue, data_date, published):
    """no look-ahead (published after the issue date) and not too old"""
    if published > issue:
        raise Refuse("the source for %s was published %s, after the infographic date %s" % (data_date, published, issue))
    if (issue - day(data_date)).days > MAX_AGE_DAYS:
        raise Refuse("the source is from %s, more than %d days before %s" % (data_date, MAX_AGE_DAYS, issue))


def read(root, rel):
    p = os.path.join(root, rel)
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError) as e:
        raise Refuse("cannot read %s: %s" % (rel, e))


# ── harvest-gap ────────────────────────────────────────────────────────────
def harvest_rows(cp, key, week):
    """the states with a NASS-printed 5-year average for this week: [{key, label, values [pct, avg5], gap}],
    furthest behind first (ties by name)"""
    rows = []
    for st, v in (cp.get("states") or {}).items():
        x = (v or {}).get(key) or {}
        if x.get("date") != week or x.get("avg5_by") != "NASS" or not isinstance(x.get("pct"), (int, float)) \
                or not isinstance(x.get("avg5"), (int, float)) or st not in STATES:
            continue
        rows.append({"key": st, "label": STATES[st], "values": [x["pct"], x["avg5"]], "gap": x["pct"] - x["avg5"]})
    rows.sort(key=lambda r: (r["gap"], r["label"]))
    return rows


def gap_words(gap):
    return ("%d point%s behind" % (-gap, "" if gap == -1 else "s")) if gap < 0 else \
        ("%d point%s ahead of" % (gap, "" if gap == 1 else "s")) if gap > 0 else "even with"


def harvest_gap(root, issue):
    cp = read(root, "data/crop-progress.json")
    prog = cp.get("progress") or {}
    nat = prog.get("corn_harvested") or {}
    week = nat.get("date")
    if not week or nat.get("avg5_by") != "NASS" or nat.get("pct") is None or nat.get("avg5") is None:
        raise Refuse("no national corn harvest row with a NASS 5-year average in data/crop-progress.json")
    check_dates(issue, week, day(week) + timedelta(days=1))   # the report comes out the Monday after its week
    panels, rows_by = [], {}
    for crop, key, name in CROPS:
        rows = harvest_rows(cp, key, week)
        if len(rows) < 5:
            raise Refuse("only %d states with a NASS 5-year average for %s harvested, week ending %s" % (len(rows), crop, week))
        rows_by[crop] = rows
        panels.append({"title": "%s harvested by state, week ending %s" % (name, md(week)),
                       "crop": crop, "rows": [{k: r[k] for k in ("key", "label", "values")} for r in rows]})
    corn = rows_by["corn"]
    far = min(corn, key=lambda r: (-abs(r["gap"]), r["label"]))
    who = far["label"]
    title = "%s corn harvest %s its 5-year average" % (who, gap_words(far["gap"]))
    if len(title) > TITLE_MAX:
        title = "%s corn harvest %s average" % (who, gap_words(far["gap"]))
    src_line = "%s, week ending %s" % (NASS, mdy(week))
    facts = []
    for crop, key, name in CROPS:
        x = prog.get(key) or {}
        if x.get("date") == week and x.get("avg5_by") == "NASS" and x.get("pct") is not None and x.get("avg5") is not None:
            facts.append({"text": "U.S. %s harvest: %d%% done, %s the 5-year average of %d%%." % (
                name.lower(), x["pct"], gap_words(x["pct"] - x["avg5"]), x["avg5"]), "source": src_line, "date": week})
    behind = [r for r in corn if r["gap"] < 0]
    facts.append({"text": "%d of the %d corn states NASS prints an average for are behind it." % (len(behind), len(corn)),
                  "source": src_line, "date": week})
    return {
        "kind": "harvest-gap", "topic": "grain", "related_page": "/conditions",
        "title": title,
        "big": {"value": far["values"][0], "unit": "%", "label": "%s corn harvested by %s (5-year average %d%%)" % (
            who, md(week), far["values"][1])},
        "chart": {"type": "bars", "title": "Harvested by state against the 5-year average, week ending %s" % mdy(week),
                  "unit": "%", "axis": {"x": "State", "y": "Percent of the crop harvested"},
                  "series": ["%s" % week[:4], "5-year average"], "panels": panels, "highlight": [far["key"]]},
        "facts": facts,
        "sources": [{"name": NASS, "url": NASS_URL, "period": "Week ending %s" % mdy(week)}],
        "data_date": week,
        "poster": harvest_poster(cp, week, corn, far),
    }


# ── funds-corn ─────────────────────────────────────────────────────────────
def funds_corn(root, issue):
    hist = (read(root, "data/cot-history.json").get("history") or {}).get("corn") or []
    an = read(root, "data/cot-analysis.json")
    card = (((an.get("commodities") or {}).get("corn") or {}).get("card") or {})
    how = card.get("how") or {}
    rows = [r for r in hist if isinstance(r, dict) and r.get("date") and isinstance(r.get("net"), (int, float))]
    if len(rows) < 3:
        raise Refuse("data/cot-history.json has under 3 corn weeks")
    last, prev = rows[-1], rows[-2]
    week = last["date"]
    if an.get("report_date") != week:
        raise Refuse("data/cot-analysis.json is on %s, data/cot-history.json on %s" % (an.get("report_date"), week))
    rel = an.get("release_date")
    if not rel:
        raise Refuse("data/cot-analysis.json carries no release date")
    check_dates(issue, week, day(rel))
    if (day(week) - day(prev["date"])).days != 7:
        raise Refuse("the last two corn weeks are not consecutive (%s, %s)" % (prev["date"], week))
    chg_long, chg_short = last["long"] - prev["long"], last["short"] - prev["short"]
    if how.get("long_change") != chg_long or how.get("short_change") != chg_short:
        raise Refuse("cot-analysis long/short split (%s, %s) disagrees with cot-history (%d, %d)" % (
            how.get("long_change"), how.get("short_change"), chg_long, chg_short))
    # the run of consecutive weekly moves the same way, ending this week
    sign = (last["net"] > prev["net"]) - (last["net"] < prev["net"])
    n = 0
    i = len(rows) - 1
    while i > 0 and (day(rows[i]["date"]) - day(rows[i - 1]["date"])).days == 7 and \
            ((rows[i]["net"] > rows[i - 1]["net"]) - (rows[i]["net"] < rows[i - 1]["net"])) == sign and sign != 0:
        n += 1
        i -= 1
    run = n >= 3
    span = n if run else min(7, len(rows) - 1)
    path = rows[-1 - span:]
    for a, b in zip(path, path[1:]):
        if (day(b["date"]) - day(a["date"])).days != 7:
            raise Refuse("the corn weeks %s to %s are not consecutive" % (path[0]["date"], week))
    first = path[0]
    total = last["net"] - first["net"]
    side = "long" if last["net"] >= 0 else "short"
    chg = last["net"] - prev["net"]
    if run:
        title = "Funds' corn net %s %s contracts in %d weeks" % ("down" if total < 0 else "up", num(abs(total)), span)
    else:
        title = "Funds' corn net %s %s contracts this week" % ("down" if chg < 0 else "up", num(abs(chg)))
    src_line = "%s, positions %s, released %s" % (CFTC, mdy(week), mdy(rel))
    label = how.get("label") or ""
    facts = [
        {"text": "This week: net %s %s contracts to %s %s." % ("down" if chg < 0 else "up", num(abs(chg)), num(abs(last["net"])), side),
         "source": src_line, "date": week},
        {"text": "Longs %s, shorts %s%s." % (signed(chg_long), signed(chg_short), (": " + label) if label else ""),
         "source": src_line, "date": week},
        {"text": "%s: %s net %s on %s, %s on %s." % (
            ("%d straight weekly %s" % (span, "cuts" if sign < 0 else "gains")) if run else "The last %d weeks" % span,
            num(abs(first["net"])), "long" if first["net"] >= 0 else "short", md(first["date"]),
            num(abs(last["net"])) + " " + side, md(week)),
         "source": src_line, "date": week},
    ]
    return {
        "kind": "funds-corn", "topic": "grain", "related_page": "/cot",
        "title": title,
        "big": {"value": last["net"], "unit": "contracts net %s" % side,
                "label": "Managed money in corn futures, positions %s" % mdy(week)},
        "chart": {"type": "line", "title": "Managed money net position in corn, %s to %s" % (md(first["date"]), mdy(week)),
                  "unit": "contracts", "axis": {"x": "Report week (positions on Tuesday)", "y": "Net contracts (long minus short)"},
                  "series": ["Managed money net"],
                  "points": [{"x": r["date"], "label": md(r["date"]), "y": r["net"]} for r in path],
                  "highlight": [0, len(path) - 1],
                  "split": {"long_change": chg_long, "short_change": chg_short, "label": label}},
        "facts": facts,
        "sources": [{"name": CFTC, "url": CFTC_URL, "period": "Positions %s, released %s" % (mdy(week), mdy(rel))}],
        "data_date": week,
        "poster": funds_poster(rows, path, an, how, rel),
    }


# ── the poster (Friday Chart) ──────────────────────────────────────────────
LIST_N = 5          # rows in each poster list before ties at the last place
LIST_MAX = 8        # more than this with the ties: the tied rows are named in a line, not drawn


def pts(n):
    return "%d pt%s" % (abs(n), "" if abs(n) == 1 else "s")


def pace_words(gap):
    return "even with average" if gap == 0 else "%s %s" % (pts(gap), "behind" if gap < 0 else "ahead")


def names(xs):
    xs = list(xs)
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1]


def top_list(rows, sign):
    """the LIST_N rows furthest behind (sign -1) or ahead (+1), with every row tied at the last place kept.
    -> (rows drawn, tie line or '')"""
    side = sorted([r for r in rows if r["gap"] * sign > 0], key=lambda r: (-abs(r["gap"]), r["label"]))
    if len(side) <= LIST_N:
        return side, ""
    cut = side[LIST_N - 1]["gap"]
    keep = [r for r in side if abs(r["gap"]) >= abs(cut)]
    tied = [r["label"] for r in keep if r["gap"] == cut]
    if len(keep) > LIST_MAX:
        above = [r for r in keep if r["gap"] != cut]
        return above, "%d states tie at %s: %s." % (len(tied), signed(cut), names(tied))
    if len(keep) > LIST_N and len(tied) > 1:
        return keep, "%s tie at %s." % (names(tied), signed(cut))
    return keep, ""


def harvest_poster(cp, week, rows, far):
    prog = cp.get("progress") or {}
    st = cp.get("states") or {}
    wk, y = mdy(week), int(week[:4])
    src = "%s, week ending %s." % (NASS, wk)
    n = len(rows)
    behind = [r for r in rows if r["gap"] < 0]
    even = [r for r in rows if r["gap"] == 0]
    ahead = [r for r in rows if r["gap"] > 0]
    widest = [r for r in rows if abs(r["gap"]) == abs(far["gap"])]
    who = far["label"]
    g = far["gap"]
    head = {"lead": "%s corn is " % who, "em": ("%d point%s" % (abs(g), "" if abs(g) == 1 else "s")) if g else "even",
            "tail": (" behind pace" if g < 0 else " ahead of pace") if g else " with its pace"}

    def nat(key):
        x = prog.get(key) or {}
        if x.get("date") != week or x.get("avg5_by") != "NASS" or x.get("pct") is None or x.get("avg5") is None:
            return None
        pw = x.get("prev_week")
        return {"pct": x["pct"], "avg5": x["avg5"], "gap": x["pct"] - x["avg5"],
                "week_gain": (x["pct"] - pw) if isinstance(pw, (int, float)) else None, "prev_week": pw}

    corn, soy = nat("corn_harvested"), nat("soybeans_harvested")
    lede = [{"s": "Of the %d states with a NASS average, %s %s the widest corn gap." % (
        n, names(r["label"] for r in widest), "has" if len(widest) == 1 else "share")}]
    if corn and soy:
        lede += [{"s": " Nationally, corn is "}, {"s": pace_words(corn["gap"]), "b": 1},
                 {"s": (" average" if corn["gap"] else "") + " and soybeans are "}, {"s": pace_words(soy["gap"]), "b": 1}, {"s": "."}]
    fx = (st.get(far["key"]) or {}).get("corn_harvested") or {}
    pw = fx.get("prev_week")
    hook = {"id": "hook", "title": "", "source": src + " 5-yr avg = %d-%d average printed by NASS." % (y - 5, y - 1), "date": week,
            "big": {"value": far["values"][0], "unit": "%", "vs": far["values"][1],
                    "label": ["%s corn harvested" % who, "vs 5-year average"]},
            "note": ({"value": "%s pts" % signed(far["values"][0] - pw), "label": ["harvested in one week", "(%d%% to %d%%)" % (pw, far["values"][0])]}
                     if isinstance(pw, (int, float)) else None)}
    panels = [hook,
              {"id": "map", "title": "Corn harvest vs the 5-year average", "date": week,
               "hint": "Each tile is a state. Number = points ahead (+) or behind (−) its own 5-year pace.",
               "source": "%s, week ending %s. Only the %d states with a NASS-printed 5-yr avg are colored." % (NASS, wk, n),
               "tiles": [{"key": r["key"], "gap": r["gap"]} for r in rows],
               "bins": [{"lo": None, "hi": -6, "label": "6 or more behind", "c": "b2"},
                        {"lo": -5, "hi": -1, "label": "1 to 5 behind", "c": "b1"},
                        {"lo": 0, "hi": 0, "label": "Even", "c": "even"},
                        {"lo": 1, "hi": 5, "label": "1 to 5 ahead", "c": "a1"},
                        {"lo": 6, "hi": None, "label": "6 or more ahead", "c": "a2"}],
               "legend_title": "Points vs avg"},
              {"id": "count", "title": "Behind, even, ahead", "date": week, "source": "%s, wk ending %s." % (NASS, wk),
               "n": n, "behind": len(behind), "even": len(even), "ahead": len(ahead),
               "big": "%d of %d" % (len(behind), n), "line": "states are behind on corn",
               "sub": "%d ahead, %d even%s" % (len(ahead), len(even), (" (%s)" % names(r["label"] for r in even)) if 0 < len(even) <= 3 else ""),
               "icons": [{"key": r["key"], "side": (r["gap"] > 0) - (r["gap"] < 0)} for r in rows]}]
    if corn and soy:
        panels.append({"id": "crops", "title": "Corn vs soybeans, U.S.", "date": week,
                       "source": "%s, U.S. rows, wk ending %s." % (NASS, wk),
                       "crops": [dict(corn, name="Corn", icon="corn", words=pace_words(corn["gap"])),
                                 dict(soy, name="Soybeans", icon="bean", words=pace_words(soy["gap"]))],
                       "key": "Tick = 5-year average for this week"})
    lb, tb = top_list(rows, -1)
    la, ta = top_list(rows, 1)
    row = lambda r: {"key": r["key"], "label": r["label"], "gap": r["gap"], "pct": r["values"][0], "avg": r["values"][1]}
    panels.append({"id": "lists", "title": "Furthest behind, furthest ahead", "date": week,
                   "source": "%s, week ending %s. Points = %% harvested minus 5-yr avg." % (NASS, wk),
                   "scale": max(abs(r["gap"]) for r in rows) or 1,
                   "cols": [{"head": "Most behind (corn, pts)", "side": -1, "rows": [row(r) for r in lb], "tie": tb},
                            {"head": "Most ahead (corn, pts)", "side": 1, "rows": [row(r) for r in la], "tie": ta}]})
    panels.append({"id": "means", "title": "What it means, what it doesn't", "date": week,
                   "source": "Definitions: %s; 5-yr avg as NASS prints it." % NASS,
                   "yes": ["Behind average means slower than the %d-%d pace for this week." % (y - 5, y - 1),
                           "Each state is compared with its own average, not with other states."],
                   "no": ["It does not say yields are lower.", "It is not a forecast of when harvest will finish."]})
    return {"kicker": "Harvest", "headline": head, "lede": lede, "panels": panels,
            "data_line": "Data: %s (week ending %s), percent of crop harvested and NASS 5-year average (%d-%d)." % (NASS, wk, y - 5, y - 1)}


def funds_poster(hist_rows, path, an, how, rel):
    last, prev, first = path[-1], hist_rows[-2], path[0]
    week = last["date"]
    src = "%s, positions %s, released %s." % ("CFTC Commitments of Traders", mdy(week), mdy(rel))
    side = lambda v: "long" if v >= 0 else "short"
    total, chg = last["net"] - first["net"], last["net"] - prev["net"]
    span = len(path) - 1
    head = {"lead": "Funds' corn net is %s " % ("down" if total < 0 else "up"), "em": "%s contracts" % num(abs(total)),
            "tail": " in %d week%s" % (span, "" if span == 1 else "s")}
    label = how.get("label") or ""
    lede = [{"s": "Managed money held "}, {"s": "%s net %s" % (num(abs(first["net"])), side(first["net"])), "b": 1},
            {"s": " on %s and " % md(first["date"])}, {"s": "%s net %s" % (num(abs(last["net"])), side(last["net"])), "b": 1},
            {"s": " on %s." % md(week)}]
    if label:
        lede.append({"s": " This week: %s." % label})
    panels = [
        {"id": "hook", "title": "", "source": src, "date": week,
         "big": {"value": last["net"], "unit": "", "vs": first["net"],
                 "label": ["contracts net %s, %s" % (side(last["net"]), md(week)),
                           "vs %s, %d week%s earlier" % (md(first["date"]), span, "" if span == 1 else "s")]},
         "note": {"value": signed(chg), "label": ["contracts this week", "(%s to %s)" % (num(prev["net"]) if prev["net"] >= 0 else signed(prev["net"]),
                                                                                         num(last["net"]) if last["net"] >= 0 else signed(last["net"]))]}},
        {"id": "line", "title": "Net position, week by week", "date": week, "source": src,
         "points": [{"x": r["date"], "label": md(r["date"]), "y": r["net"]} for r in path],
         "hint": "Contracts long minus contracts short, managed money, corn futures."},
        {"id": "split", "title": "Longs and shorts", "date": week, "source": src,
         "weeks": [{"x": r["date"], "label": md(r["date"]), "long": r["long"], "short": r["short"]} for r in (first, last)],
         "change": {"long": last["long"] - prev["long"], "short": last["short"] - prev["short"], "label": label}},
        {"id": "changes", "title": "Each week's move", "date": week, "source": src,
         "rows": [{"x": b["date"], "label": md(b["date"]), "chg": b["net"] - a["net"]} for a, b in zip(path, path[1:])][-LIST_MAX:],
         "of": span},
    ]
    c = ((an.get("commodities") or {}).get("corn") or {})
    p = (c.get("pctl") or {}).get("net_oi_all")
    if isinstance(p, (int, float)) and c.get("weeks_of_history") and c.get("first_week") and isinstance(c.get("net_oi"), (int, float)):
        if c.get("date") != week or c.get("net") != last["net"]:
            raise Refuse("data/cot-analysis.json corn (%s, %s) disagrees with cot-history (%s, %s)" % (c.get("date"), c.get("net"), week, last["net"]))
        pp = c.get("pctl_prev")
        panels.append({"id": "rank", "title": "Where it sits in the record", "date": week, "source": src,
                       "pctl": p, "pctl_prev": pp if isinstance(pp, (int, float)) else None,
                       "net_oi": c["net_oi"], "weeks": c["weeks_of_history"], "since": c["first_week"],
                       "line": "%d%% of the %s weeks since %s were at or below this week, as a share of open interest." % (
                           round(p), num(c["weeks_of_history"]), c["first_week"][:4]),
                       "sub": "Net %s = %.1f%% of all open contracts.%s" % (side(last["net"]), abs(c["net_oi"]),
                                                                          (" Last week: %d%%." % round(pp)) if isinstance(pp, (int, float)) else "")})
    panels.append({"id": "means", "title": "What it means, what it doesn't", "date": week,
                   "source": "Definitions: %s." % CFTC,
                   "yes": ["Net = contracts betting on higher prices minus contracts betting on lower prices.",
                           "Positions are as of Tuesday; the CFTC releases them on Friday."],
                   "no": ["It is not a price forecast.", "It does not say what any one trader holds or why."]})
    return {"kicker": "Funds", "headline": head, "lede": lede, "panels": panels,
            "data_line": "Data: %s, managed money in corn futures, positions %s, released %s." % (CFTC, mdy(week), mdy(rel))}


BUILDERS = {"harvest-gap": harvest_gap, "funds-corn": funds_corn}


def build(kind, iso, root=ROOT):
    if kind not in BUILDERS:
        raise Refuse("unknown kind %r (kinds: %s)" % (kind, ", ".join(KINDS)))
    issue = day(iso)
    spec = BUILDERS[kind](root, issue)
    out = {"date": issue.isoformat(), "slug": issue.isoformat(), "kind": kind}
    out.update(spec)
    out["kind"] = kind
    if len(out["title"]) > TITLE_MAX:
        raise Refuse("the hook is %d characters, over %d: %s" % (len(out["title"]), TITLE_MAX, out["title"]))
    text = json.dumps(out, ensure_ascii=False)
    if "\u2014" in text:
        raise Refuse("an em dash in the spec")
    return out


def dump(spec):
    return json.dumps(spec, indent=1, ensure_ascii=False) + "\n"


def selftest():
    import tempfile
    ok = True

    def ck(name, cond):
        nonlocal ok
        print(("ok   " if cond else "FAIL ") + name)
        ok = ok and bool(cond)

    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "data"))
    st = lambda pct, avg: {"corn_harvested": {"date": "2026-11-01", "pct": pct, "avg5": avg, "avg5_by": "NASS"},
                           "soybeans_harvested": {"date": "2026-11-01", "pct": pct + 10, "avg5": avg, "avg5_by": "NASS"}}
    cp = {"progress": {"corn_harvested": {"date": "2026-11-01", "pct": 74, "avg5": 77, "avg5_by": "NASS"},
                       "soybeans_harvested": {"date": "2026-11-01", "pct": 88, "avg5": 84, "avg5_by": "NASS"}},
          "states": {"IA": st(66, 79), "IL": st(86, 83), "MN": st(82, 85), "NE": st(66, 75), "OH": st(53, 60),
                     "MT": {"corn_harvested": {"date": "2026-11-01", "pct": 48, "avg5": None}}}}
    json.dump(cp, open(os.path.join(d, "data", "crop-progress.json"), "w"))
    s = build("harvest-gap", "2026-11-06", d)
    ck("hook is the state furthest from its average", s["title"] == "Iowa corn harvest 13 points behind its 5-year average")
    ck("big number", s["big"]["value"] == 66 and "79%" in s["big"]["label"])
    ck("only NASS-printed averages", [r["key"] for r in s["chart"]["panels"][0]["rows"]] == ["IA", "NE", "OH", "MN", "IL"])
    ck("national facts", s["facts"][0]["text"] == "U.S. corn harvest: 74% done, 3 points behind the 5-year average of 77%.")
    ck("count behind", s["facts"][2]["text"].startswith("4 of the 5 corn states"))
    for bad, why in (("2026-11-01", "look-ahead"), ("2026-12-01", "too old")):
        try:
            build("harvest-gap", bad, d)
            ck("refuses " + why, False)
        except Refuse:
            ck("refuses " + why, True)
    hist = [{"date": "2026-10-%02d" % dd, "net": n, "long": n + 100, "short": 100} for dd, n in ((6, 500), (13, 400), (20, 300), (27, 200))]
    hist.append({"date": "2026-11-03", "net": 50, "long": 120, "short": 70})
    json.dump({"history": {"corn": hist}}, open(os.path.join(d, "data", "cot-history.json"), "w"))
    an = {"report_date": "2026-11-03", "release_date": "2026-11-06",
          "commodities": {"corn": {"card": {"how": {"long_change": -180, "short_change": -30, "label": "mostly selling longs they held"}}}}}
    json.dump(an, open(os.path.join(d, "data", "cot-analysis.json"), "w"))
    f = build("funds-corn", "2026-11-06", d)
    ck("funds hook", f["title"] == "Funds' corn net down 450 contracts in 4 weeks")
    ck("funds path", [p["y"] for p in f["chart"]["points"]] == [500, 400, 300, 200, 50])
    try:
        build("funds-corn", "2026-11-05", d)
        ck("refuses before the release day", False)
    except Refuse:
        ck("refuses before the release day", True)
    an["commodities"]["corn"]["card"]["how"]["long_change"] = 1
    json.dump(an, open(os.path.join(d, "data", "cot-analysis.json"), "w"))
    try:
        build("funds-corn", "2026-11-06", d)
        ck("refuses a split that disagrees with the history", False)
    except Refuse:
        ck("refuses a split that disagrees with the history", True)
    import shutil
    shutil.rmtree(d)
    return 0 if ok else 1


def main(argv):
    if "--selftest" in argv:
        return selftest()
    args, root, out, show = [], ROOT, None, False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--root":
            root = argv[i + 1]; i += 2; continue
        if a == "--out":
            out = argv[i + 1]; i += 2; continue
        if a == "--print":
            show = True; i += 1; continue
        args.append(a); i += 1
    if len(args) != 2:
        print("usage: build_infographic.py <kind> <yyyy-mm-dd> [--root DIR] [--out DIR] [--print]  (kinds: %s)" % ", ".join(KINDS))
        return 2
    try:
        spec = build(args[0], args[1], root)
    except (Refuse, ValueError) as e:
        print("refused: %s" % e)
        return 1
    if show:
        sys.stdout.write(dump(spec))
        return 0
    od = out or os.path.join(root, OUT_DIR)
    os.makedirs(od, exist_ok=True)
    p = os.path.join(od, spec["date"] + ".json")
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(dump(spec))
    print("wrote %s: %s" % (os.path.relpath(p, root) if p.startswith(root) else p, spec["title"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
