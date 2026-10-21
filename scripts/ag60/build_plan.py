#!/usr/bin/env python3
"""Ag in 60: turn the morning's data into a 60-second script and scene plan.

    python3 scripts/ag60/build_plan.py [--root .] [--out DIR] [--mode auto|daily|report] [--date YYYY-MM-DD]

Reads (all optional except the Daily):
  data/daily.json (or data/daily-archive/<date>.json)   headline, the number, locked prices
  data/basis-states.json                                 corn basis state medians
  data/hail/storm-days.json, data/hail/recent.json       hail reports (NOAA SPC)
  data/crop-progress.json                                harvest pace vs 5-year average (USDA NASS)
  data/analyst-estimates.json                            report-day numbers vs the trade
  data/prices.json                                       market reaction on a report day
  data/rain/wi.json                                      the Rain Print closing beat (Barron County)

Writes <out>/plan.json: beats (each one spoken line with its scenes), the
numbers it shows with source path and date, captions text, and the YouTube
title and description. No number is made up: every one is read from a file
here, and a missing number drops its line rather than guessing.

Rundown (Sig's ask, Oct 21): hook with the day's number, the board (corn,
beans, wheat, cattle, feeders, Class III milk), why it moved, basis and cash
bids, a weather or crop moment, the calendar, one thing to watch, agsist.com.
On a report day after the release the whole video is the report.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import speak  # noqa: E402

WORDS_MIN, WORDS_MAX = 150, 170
WPS = 3.0             # words a second the voice reads at (the voice step sets its speed to fit)
GAP = 0.10            # breath between lines, seconds
END_CARD = 2.0        # silent end card
MAX_TOTAL = 60.0
FARM_STATES = {"IA", "IL", "IN", "OH", "NE", "KS", "MN", "SD", "ND", "WI", "MO", "MI", "KY", "TN", "AR", "OK", "TX", "CO"}
STATE_NAMES = {"IA": "Iowa", "IL": "Illinois", "IN": "Indiana", "OH": "Ohio", "NE": "Nebraska", "KS": "Kansas",
               "MN": "Minnesota", "SD": "South Dakota", "ND": "North Dakota", "WI": "Wisconsin", "MO": "Missouri",
               "MI": "Michigan", "KY": "Kentucky", "TN": "Tennessee", "AR": "Arkansas", "OK": "Oklahoma",
               "TX": "Texas", "CO": "Colorado", "PA": "Pennsylvania", "GA": "Georgia", "WA": "Washington"}
BOARD = [  # key in locked_prices, name on screen, spoken name, contract label, priority
    ("corn-dec", "Corn", "Corn", "Dec '26", 9),
    ("beans-nov", "Soybeans", "Beans", "Nov '26", 9),
    ("wheat", "Wheat", "Wheat", "Chicago, nearby", 7),
    ("cattle", "Live cattle", "Live cattle", "nearby", 8),
    ("feeders", "Feeder cattle", "Feeders", "nearby", 6),
    ("milk", "Class III milk", "Class III milk", "nearby", 7),
]


# ---------- small helpers ----------

def load(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def day(s):
    return dt.date.fromisoformat(s[:10])


def short_date(s):
    d = day(s)
    return f"{d.strftime('%b')} {d.day}"


def weekday(s):
    return day(s).strftime("%A")


def ct_time(iso):
    """'2026-10-20T10:45:52Z' -> '5:45 a.m. CT' (Central, daylight time aware)."""
    t = dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    try:
        from zoneinfo import ZoneInfo
        t = t.astimezone(ZoneInfo("America/Chicago"))
    except Exception:  # no tz database: fixed CDT/CST by month
        t = t - dt.timedelta(hours=5 if 3 < t.month < 11 else 6)
    h = t.hour % 12 or 12
    return f"{h}:{t.minute:02d} {'a.m.' if t.hour < 12 else 'p.m.'} CT"


def clean(md):
    """Markdown bullet to a plain sentence."""
    s = re.sub(r"\*\*|__|`", "", md).strip()
    s = re.sub(r"^[-*]\s+", "", s)
    return s.replace("\u2014", ", ").replace("\u2013", " to ").strip()


def first_clause(s, limit=24):
    """Keep a sentence under `limit` spoken words, cutting at a comma or 'and'."""
    s = clean(s)
    s = re.split(r"(?<=[.!?])\s", s)[0]
    if speak.word_count(s) <= limit:
        return s
    parts = re.split(r"(,\s|;\s)", s)       # keep each comma with what follows
    out = parts[0]
    for i in range(1, len(parts) - 1, 2):
        nxt = out + parts[i] + parts[i + 1]
        if speak.word_count(nxt) > limit:
            break
        out = nxt
    return out.rstrip(".,;") + "."


# ---------- the beats ----------

class Plan:
    def __init__(self, date, mode):
        self.date, self.mode = date, mode
        self.beats, self.facts = [], []

    def fact(self, label, value, show, src, asof):
        self.facts.append({"label": label, "value": value, "show": show, "src": src, "asof": asof})
        return show

    def beat(self, bid, text, scenes, prio=9, extra=False):
        self.beats.append({"id": bid, "text": text, "scenes": scenes, "prio": prio, "extra": extra})


def board_line(p, d, key, name, say_name, contract, first):
    price = d.get("locked_prices", {}).get(key)
    ch = d.get("locked_changes", {}).get(key) or {}
    if price is None or ch.get("prev") is None or not ch.get("date"):
        return None
    diff = price - ch["prev"]
    settle = ch.get("kind") == "settle"
    when = (f"Settle, {weekday(ch['date'])[:3]} {short_date(ch['date'])}" if settle
            else f"Overnight, {short_date(ch['date'])}, {ct_time(ch['at'])}" if ch.get("at") else short_date(ch["date"]))
    show = p.fact(f"{name} price", price, speak.show_price(price), f"daily.json:locked_prices.{key}", when)
    chg = p.fact(f"{name} change", round(diff, 4), speak.show_cents(diff), f"daily.json:locked_changes.{key}.prev", when)
    word = "up" if diff > 0 else "down" if diff < 0 else "unchanged"
    move = f"{word} {chg}" if diff else "unchanged"
    if settle:
        text = f"{say_name} settled {weekday(ch['date'])} at {show}, {move}."
    else:
        text = f"{'Overnight, ' if first else ''}{say_name.lower() if first else say_name}, {show}, {move}."
    scene = {"kind": "tile", "name": name, "contract": contract, "price": show, "change": ("+" if diff > 0 else "-" if diff < 0 else "") + chg,
             "dir": word, "pct": round(ch.get("pct", 0.0), 2), "prev": speak.show_price(ch["prev"]), "asof": when,
             "src": "CME Group, as in the AGSIST Daily"}
    return text, scene


def daily_beats(p, src):
    d = src["daily"]
    ddate = p.date
    # 1. hook: the day's one number and why
    on = d.get("one_number") or {}
    if on.get("value"):
        # the why: the first short sentence of the context (12 words or fewer); none fits, no why
        sents = [clean(x) for x in re.split(r"(?<=[.!?])\s+", on.get("context", "")) if x.strip()]
        why = next((x for x in sents if speak.word_count(x) <= 12), "")
        unit = on.get("unit", "").strip()
        text = f"{on['value']}. {unit[:1].upper() + unit[1:]}." + (f" {why}" if why else "")
        p.fact("The number", on["value"], on["value"], "daily.json:one_number.value", short_date(ddate))
        p.beat("hook", text, [{"kind": "hook", "value": on["value"], "unit": unit, "why": why, "asof": f"AGSIST Daily, {short_date(ddate)}"}], 9)
    # 2. the board
    first = True
    tiles = []
    for key, name, say_name, contract, prio in BOARD:
        r = board_line(p, d, key, name, say_name, contract, first and not (d.get("locked_changes", {}).get(key) or {}).get("kind") == "settle")
        if not r:
            continue
        text, scene = r
        tiles.append(scene)
        if first and scene["asof"].startswith("Overnight"):
            first = False
        p.beat(f"board-{key}", text, [scene], prio)
    # the day's biggest mover on the board gets its own bars (on the milk or last line)
    if tiles:
        big = max(tiles, key=lambda t: abs(t["pct"]))
        bars = {"kind": "bars", "title": "Biggest move on the board", "rows": [{"name": t["name"], "pct": t["pct"], "asof": t["asof"]} for t in tiles],
                "lead": big["name"], "asof": "Percent change, " + tiles[0]["asof"].split(",")[1].strip() + " vs prior close"}
        src["_bars"] = bars
    # 3. why it moved
    secs = d.get("sections") or []
    if secs:
        bullet = (secs[0].get("body") or "").split("\n")[0]
        line = first_clause(bullet, 14)
        sw = clean(secs[0].get("so_what") or "")
        if sw and speak.word_count(line + " " + sw) <= 22:
            line = line + " " + sw
        series = d.get("chart_series") or {}
        dates = d.get("chart_dates") or []
        chart = None
        if series.get("corn") and len(dates) == len(series["corn"]):
            chart = {"kind": "chart", "title": "Corn and soybeans, last 10 sessions", "dates": dates,
                     "series": {k: v for k, v in series.items() if k in ("corn", "soybeans")},
                     "asof": f"{short_date(dates[0])} to {short_date(dates[-1])}, nearby futures", "src": "CME Group"}
        scenes = ([src["_bars"]] if src.get("_bars") else []) + [{"kind": "headline", "kicker": secs[0].get("title", ""), "text": line, "asof": f"AGSIST Daily, {short_date(ddate)}"}]
        if chart:
            scenes.append(chart)
        p.beat("why", line, scenes, 8)
        if len(secs) > 1 and secs[1].get("so_what"):
            sw = clean(secs[1]["so_what"])
            p.beat("why-2", f"{clean(secs[1].get('title', ''))}. {sw}", [{"kind": "headline", "kicker": "Also", "text": clean(secs[1].get("title", "")), "sub": sw,
                                                                          "asof": f"AGSIST Daily, {short_date(ddate)}"}], 3, extra=True)
    # 4. cash bids and basis
    edge = {f.get("id"): f for f in ((d.get("edge") or {}).get("facts") or [])}
    cc = edge.get("cash_change_corn")
    if cc and cc.get("as_of"):
        m = re.match(r"([\d,]+) of the ([\d,]+) elevators", cc.get("key", ""))
        if m and cc.get("value") is not None:
            lower, total = m.group(1), m.group(2)
            cents = speak.show_cents(cc["value"] / 100)
            p.fact("Elevators with a lower corn bid", lower, lower, "daily.json:edge.facts[cash_change_corn].key", short_date(cc["as_of"]))
            p.fact("Median cash corn change", cc["value"], cents, "daily.json:edge.facts[cash_change_corn].value", short_date(cc["as_of"]))
            dirw = "lower" if cc["value"] < 0 else "higher"
            text = f"{weekday(cc['as_of'])}, {lower} of the {total} elevators we read posted a {dirw} cash corn bid. The median, {cents} {dirw}."
            p.beat("cash", text, [{"kind": "counter", "big": lower, "of": total, "line": f"elevators posted a {dirw} cash corn bid",
                                   "sub": f"Median change {cents} {dirw}", "asof": f"{weekday(cc['as_of'])[:3]} {short_date(cc['as_of'])}, vs prior day",
                                   "src": "AGSIST elevator network"}], 7)
    bs = src.get("basis")
    if bs and bs.get("states"):
        rows = []
        for st, v in bs["states"].items():
            c = (v.get("crops") or {}).get("corn") or {}
            if c.get("median") is not None and (c.get("n") or 0) >= 3:
                rows.append({"st": st, "median": c["median"], "n": c["n"], "label": c.get("label", "")})
        big = [r for r in rows if r["n"] >= 15]
        if len(big) >= 3:
            hi = max(big, key=lambda r: r["median"])
            lo = min(big, key=lambda r: r["median"])
            asof = f"State medians, read {short_date(bs['generated'])}, {ct_time(bs['generated'])}"

            def bshow(v):
                c = round(abs(v) * 100)
                return f"{c}¢ {'over' if v > 0 else 'under'}" if c else "even"
            hs = p.fact(f"Corn basis {hi['st']}", hi["median"], bshow(hi["median"]), f"basis-states.json:states.{hi['st']}.crops.corn.median", asof)
            ls = p.fact(f"Corn basis {lo['st']}", lo["median"], bshow(lo["median"]), f"basis-states.json:states.{lo['st']}.crops.corn.median", asof)
            text = f"Corn basis runs from {hs} in {STATE_NAMES.get(hi['st'], hi['st'])} to {ls} in {STATE_NAMES.get(lo['st'], lo['st'])}."
            p.beat("basis", text, [{"kind": "map", "title": "Corn basis, state median", "rows": rows, "hi": hi["st"], "lo": lo["st"],
                                    "asof": asof, "src": "AGSIST elevator network", "min_n": 15}], 6)
    # 5. weather or crop moment
    storm = storm_beat(p, src)
    if not storm:
        crop_beat(p, src)
    # 6. calendar
    cal = []
    for w in d.get("watch_list") or []:
        if w.get("time") and w["time"].lower() != "ongoing":
            cal.append(w)
    rep = report_today(src)
    if rep and not report_out(rep):
        rel = rep.get("release_ct", "11:00 a.m. CT")
        p.beat("calendar-report", f"{rep['report']} is out today at {rel}. Numbers not out yet.",
               [{"kind": "calendar", "items": [{"when": f"Today, {rel}", "what": rep["report"], "note": "Not out yet"}], "asof": short_date(ddate)}], 8)
    elif cal:
        hc0 = d.get("harvest_clock") or {}
        corn0 = [c for c in hc0.get("crops") or [] if c.get("crop") == "Corn" and c.get("harvest") and c.get("projected")]
        extra_items = []
        if corn0 and (corn0[0].get("days_left") or 0) > 0 and hc0.get("end"):
            c0 = corn0[0]
            extra_items.append({"when": f"{weekday(hc0['end'])[:3]}, {short_date(hc0['end'])}", "what": "Crop insurance harvest price window closes",
                                "note2": f"Corn so far {speak.show_price(c0['harvest'])} vs {speak.show_price(c0['projected'])} projected, through {short_date(c0.get('through') or hc0['asof'])}"})
        w = cal[0]
        what = clean(w["desc"]).split(".")[0]
        when = re.sub(r",\s*\d{4}", "", w["time"])
        p.beat("calendar", f"{when}: {what}.", [{"kind": "calendar", "items": [{"when": clean(x["time"]), "what": clean(x["desc"]).split(".")[0]} for x in cal[:2]] + extra_items,
                                                "asof": f"AGSIST Daily, {short_date(ddate)}"}], 7)
    hc = d.get("harvest_clock") or {}
    crops = [c for c in hc.get("crops") or [] if c.get("crop") == "Corn" and c.get("harvest") and c.get("projected")]
    if crops and hc.get("asof"):
        c = crops[0]
        hs = p.fact("Corn harvest price so far", c["harvest"], speak.show_price(c["harvest"]), "daily.json:harvest_clock.crops[Corn].harvest", short_date(hc["asof"]))
        ps = p.fact("Corn projected price", c["projected"], speak.show_price(c["projected"]), "daily.json:harvest_clock.crops[Corn].projected", short_date(hc["asof"]))
        left = c.get("days_left")
        tail = f", {speak.words(left)} trading days left" if left else ""
        p.beat("harvest-clock", f"The crop insurance harvest price for corn is running {hs}, against {ps} projected{tail}.",
               [{"kind": "clock", "crop": "Corn", "contract": c.get("contract", ""), "harvest": hs, "projected": ps, "pct": c.get("pct"),
                 "days_done": c.get("days_done"), "days_total": c.get("days_total"), "asof": f"Average through {short_date(hc['asof'])}",
                 "src": "CME settles, USDA RMA price discovery"}], 5)
    # 7. one thing to watch
    ongoing = [w for w in d.get("watch_list") or [] if (w.get("time") or "").lower() == "ongoing"]
    if ongoing:
        line = first_clause(ongoing[0]["desc"], 20)
        p.beat("watch", f"Watch: {line}", [{"kind": "watch", "text": line, "asof": f"AGSIST Daily, {short_date(ddate)}"}], 8)
    close_beat(p, src)


def storm_beat(p, src):
    sd = (src.get("storm") or {}).get("days") or []
    rec = (src.get("hail") or {}).get("reports") or []
    dd = day(p.date)
    for row in sd:       # yesterday or the day before, newest first
        if not 1 <= (dd - day(row["d"])).days <= 2:
            continue
        farm = {s: n for s, n in (row.get("st") or {}).items() if s in FARM_STATES}
        if row.get("dmg", 0) >= 10 and sum(farm.values()) >= 6:
            pts = [r for r in rec if r.get("date") == row["d"]]
            top = sorted(farm.items(), key=lambda kv: -kv[1])[:2]
            mx = p.fact("Largest hail", row["max"], f"{row['max']:g} inch", f"storm-days.json:days[{row['d']}].max", short_date(row["d"]))
            n = p.fact("Hail reports", row["n"], str(row["n"]), f"storm-days.json:days[{row['d']}].n", short_date(row["d"]))
            where = " and ".join(STATE_NAMES.get(s, s) for s, _ in top)
            text = f"{weekday(row['d'])} brought {n} hail reports, most in {where}, up to {mx} stones."
            p.beat("storm", text, [{"kind": "hail", "points": [{"lat": r["lat"], "lon": r["lon"], "mag": r["mag"]} for r in pts],
                                    "title": f"Hail reports, {weekday(row['d'])}", "asof": f"{short_date(row['d'])}, 7 a.m. to 7 a.m. CT",
                                    "src": "NOAA Storm Prediction Center, preliminary reports"}], 7)
            return True
    return False


def crop_beat(p, src):
    cp = src.get("crop") or {}
    pr = cp.get("progress") or {}
    rows = []
    for key, name in (("corn_harvested", "Corn"), ("soybeans_harvested", "Soybeans")):
        r = pr.get(key)
        if r and r.get("pct") is not None and r.get("avg5") is not None and r.get("date"):
            rows.append((key, name, r))
    if not rows or not cp.get("in_season"):
        return
    asof = f"USDA NASS, week ending {short_date(rows[0][2]['date'])}"
    parts = []
    for key, name, r in rows:
        a = p.fact(f"{name} harvested", r["pct"], f"{r['pct']}%", f"crop-progress.json:progress.{key}.pct", asof)
        b = p.fact(f"{name} 5-year average", r["avg5"], f"{r['avg5']}%", f"crop-progress.json:progress.{key}.avg5", asof)
        gap = r["pct"] - r["avg5"]
        rel = "about even with" if abs(gap) <= 2 else "behind" if gap < 0 else "ahead of"
        parts.append((name, a, b, rel))
    n0 = parts[0]
    text = f"Harvest: corn is {n0[1]} done, {n0[3]} the {n0[2]} average."
    p.beat("crop", text, [{"kind": "progress", "title": "Harvested, vs 5-year average",
                           "rows": [{"name": nm, "pct": r["pct"], "avg5": r["avg5"], "prev": r.get("prev_week")} for _, nm, r in rows],
                           "asof": asof, "src": "USDA NASS Crop Progress"}], 7)


def close_beat(p, src):
    scenes = []
    rp = rain_print(src)
    if rp:
        scenes.append(rp)
    scenes.append({"kind": "end", "asof": short_date(p.date)})
    p.beat("close", f"That's Ag in 60 for {weekday(p.date)}. More at agsist.com.", scenes, 10)


def rain_print(src):
    r = src.get("rain") or {}
    c = (r.get("counties") or {}).get(src.get("rain_fips", "55005"))
    if not c or not c.get("cum"):
        return None
    return {"kind": "rainprint", "place": f"{c['name']}, {r.get('state', '')}", "year": r.get("year"),
            "cum": c["cum"], "total": c.get("total"), "usual": c.get("usual"), "through": c.get("as_of"),
            "station": (c.get("station") or {}).get("name"), "asof": f"Through {short_date(c['as_of'])}",
            "src": f"NOAA via RCC-ACIS, {(c.get('station') or {}).get('name', '')} station; normal {r.get('normals', '1991-2020')}"}


# ---------- report days ----------

def report_today(src):
    for r in (src.get("estimates") or {}).get("reports") or []:
        if r.get("date") == src["date"]:
            return r
    return None


def report_out(r):
    return any(m.get("actual") is not None for m in r.get("metrics") or [])


def report_beats(p, src):
    r = report_today(src)
    ms = [m for m in r["metrics"] if m.get("actual") is not None and m.get("consensus") is not None]

    def surprise(m):
        lo, hi = (m.get("consensus_range") or [None, None])[:2]
        width = (hi - lo) if lo is not None and hi is not None and hi > lo else abs(m["consensus"]) * 0.02 or 1
        return abs(m["actual"] - m["consensus"]) / width
    ms.sort(key=surprise, reverse=True)
    rel = short_date(r["date"])

    def unit_say(m):
        u = m.get("unit", "")
        return {"bil bu": "billion bushels", "B bu": "billion bushels", "mil bu": "million bushels", "bu/acre": "bushels an acre"}.get(u, u)

    def num(v):
        return f"{v:,g}" if abs(v) >= 1000 else f"{v:g}"

    def name(m):                      # "2026/27 corn yield" -> "Corn yield" (the year stays on screen)
        n = re.sub(r"^\d{4}/\d{2}\s+", "", m["label"])
        return n[:1].upper() + n[1:]
    src_of = lambda m, k: f"analyst-estimates.json:reports[{r['date']}].{m['key']}.{k}"
    top = ms[0]
    a = p.fact(top["label"], top["actual"], num(top["actual"]), src_of(top, "actual"), rel)
    c = p.fact(top["label"] + " trade", top["consensus"], num(top["consensus"]), src_of(top, "consensus"), rel)
    p.beat("hook", f"{r['report']}: {name(top).lower()}, {a} {unit_say(top)}. The trade expected {c}.",
           [{"kind": "hook", "kicker": r["report"], "value": a, "unit": f"{top['label']}, {unit_say(top)}", "why": f"Trade expected {c}", "asof": f"USDA, {rel}"},
            report_scene(top, rel)], 10)
    for i, m in enumerate(ms[1:6]):
        a = p.fact(m["label"], m["actual"], num(m["actual"]), src_of(m, "actual"), rel)
        c = p.fact(m["label"] + " trade", m["consensus"], num(m["consensus"]), src_of(m, "consensus"), rel)
        side = "above" if m["actual"] > m["consensus"] else "below" if m["actual"] < m["consensus"] else "right on"
        text = f"{name(m)}, {a} {unit_say(m)}, {side} the {c} trade guess."
        if m.get("usda_current") is not None:
            pr = p.fact(m["label"] + " last month", m["usda_current"], num(m["usda_current"]), src_of(m, "usda_current"), rel)
            text += f" USDA had {pr} last month."
        scenes = [report_scene(m, rel)]
        if i < 3:                     # a fast cut to the number itself, then the bar
            scenes.insert(0, {"kind": "slam", "label": m["label"], "value": a, "unit": unit_say(m), "vs": f"Trade {c}", "side": side,
                              "asof": f"USDA, {rel}", "src": "USDA"})
        p.beat(f"rep-{m['key']}", text, scenes, 8 - i)
    reaction_beat(p, src, r)
    close_beat(p, src)


def report_scene(m, rel):
    return {"kind": "report", "label": m["label"], "unit": m.get("unit"), "actual": m["actual"], "consensus": m["consensus"],
            "range": m.get("consensus_range"), "prior": m.get("usda_current"), "asof": f"USDA, {rel}; trade survey before the report",
            "src": "USDA; " + (m.get("consensus_note") or "trade survey").split(",")[0]}


def reaction_beat(p, src, r):
    q = ((src.get("prices") or {}).get("quotes") or {})
    release = dt.datetime.fromisoformat(r["date"] + "T16:00:00+00:00")   # 11 a.m. CT
    lines, tiles = [], []
    for key, name, say_name, contract, _ in BOARD[:2]:
        x = q.get(key) or {}
        t = x.get("close_time")
        if not t or x.get("close_date") != r["date"] or dt.datetime.fromisoformat(t.replace("Z", "+00:00")) <= release:
            continue
        price, chg = x["close"] / 100, x["netChange"] / 100
        when = f"{short_date(t)}, {ct_time(t)}"
        ps = p.fact(f"{name} after the report", price, speak.show_price(price), f"prices.json:quotes.{key}.close", when)
        cs = p.fact(f"{name} change after the report", chg, speak.show_cents(chg), f"prices.json:quotes.{key}.netChange", when)
        lines.append(f"{say_name} {ps}, {'up' if chg > 0 else 'down'} {cs}")
        tiles.append({"kind": "tile", "name": name, "contract": contract, "price": ps, "change": ("+" if chg > 0 else "-") + cs,
                      "dir": "up" if chg > 0 else "down", "pct": round(x.get("pctChange", 0), 2), "asof": when, "src": "CME Group"})
    if lines:
        p.beat("reaction", "The market so far: " + "; ".join(lines) + ".", tiles, 9)
    else:
        p.beat("reaction", "Market reaction is not in yet.", [{"kind": "watch", "text": "Market reaction: not in yet", "asof": short_date(r["date"])}], 9)


# ---------- fit, time, captions ----------

def fit(p):
    """Drop the lowest-priority lines until the script is 150 to 170 words."""
    def total():
        return sum(speak.word_count(b["text"]) for b in p.beats)
    while total() > WORDS_MAX:
        cand = [b for b in p.beats if b["prio"] < 9]
        if not cand:
            break
        drop = min(cand, key=lambda b: (b["prio"], -p.beats.index(b)))
        # a map or chart riding on a cut line moves to the line before it
        keep = [s for s in drop["scenes"] if s["kind"] in ("bars", "map", "chart")]
        i = p.beats.index(drop)
        p.beats.remove(drop)
        if keep and i > 0:
            p.beats[i - 1]["scenes"].extend(keep)
    # an extra line only stays if the script is short without it
    for b in [b for b in p.beats if b["extra"]]:
        if total() - speak.word_count(b["text"]) >= WORDS_MIN:
            p.beats.remove(b)
    return total()


def chunks(toks, max_chars=16, max_words=3):
    out, cur = [], []
    for show, say in toks:
        cur.append((show, say))
        text = " ".join(s for s, _ in cur)
        if len(text) >= max_chars or len(cur) >= max_words or re.search(r"[.,:;!?]$", show):
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return [{"text": " ".join(s for s, _ in c), "w": max(1, sum(speak.word_count(y) if y else 0 for _, y in c))} for c in out]


def time_plan(p, durations=None):
    """Lay the beats on the clock. durations: spoken seconds per beat id (from the voice), else an estimate."""
    t = 0.0
    scenes, caps = [], []
    for b in p.beats:
        w = speak.word_count(b["text"])
        dur = (durations or {}).get(b["id"], w / WPS)
        b["voice_start"], b["voice_dur"] = round(t, 3), round(dur, 3)
        span = dur + GAP
        if b["id"] == "close":
            span += END_CARD
        b["start"], b["dur"] = round(t, 3), round(span, 3)
        # scenes inside the beat: equal shares, the end card takes its fixed tail
        sc = b["scenes"]
        fixed = END_CARD if sc and sc[-1]["kind"] == "end" else 0.0
        n = len(sc) - (1 if fixed else 0)
        each = (span - fixed) / max(1, n)
        st = t
        for s in sc:
            d = fixed if (fixed and s is sc[-1]) else each
            scenes.append({**s, "beat": b["id"], "start": round(st, 3), "dur": round(d, 3)})
            st += d
        cs = chunks(speak.tokens(b["text"]))
        tw = sum(c["w"] for c in cs)
        ct = t
        for c in cs:
            cd = dur * c["w"] / tw
            caps.append({"start": round(ct, 3), "end": round(ct + cd, 3), "text": c["text"]})
            ct += cd
        t += span
    return scenes, caps, round(t, 3)


def srt(caps):
    def ts(x):
        ms = int(round(x * 1000))
        return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"
    return "\n".join(f"{i}\n{ts(c['start'])} --> {ts(c['end'])}\n{c['text']}\n" for i, c in enumerate(caps, 1))


def metadata(p, src):
    d = src.get("daily") or {}
    nice = day(p.date).strftime("%A, %B ") + str(day(p.date).day)
    hook = next((b for b in p.beats if b["id"] == "hook"), None)
    head = d.get("headline") if p.mode == "daily" else (hook["text"].split(":")[0] if hook else "USDA report")
    title = f"Ag in 60, {short_date(p.date)}: {head}"
    if len(title) > 100:
        title = title[:97].rsplit(" ", 1)[0] + "..."
    lines = [f"Ag in 60 for {nice}, {day(p.date).year}. Grain, cattle and milk prices, cash bids, weather and what to watch, in a minute.", "",
             "Every number, with its date and source:"]
    for f in p.facts:
        lines.append(f"- {f['label']}: {f['show']} ({f['asof']}; {f['src'].split(':')[0]})")
    lines += ["", "Read the full Daily: https://agsist.com/daily/" + p.date,
              "Cash bids near you: https://agsist.com/cash-bids", "Rain Print: https://agsist.com/rain-print", "",
              "How this is made: the script is built by code from the AGSIST Daily, which AI software drafts each morning from Sig's rules "
              "and that morning's data, and which code checks against the market feed. The voice is a computer voice, not a real person. "
              "Not financial advice.", "",
              "Sigurd Lindquist, Certified Crop Adviser (CCA), Chetek, Wisconsin. agsist.com", "", "#Shorts #farming #agriculture #corn #soybeans #cattle"]
    desc = "\n".join(lines)
    return {"title": title, "description": desc[:4900],
            "tags": ["farming", "agriculture", "corn prices", "soybean prices", "cattle", "grain markets", "cash bids", "AGSIST"],
            "categoryId": "25", "defaultLanguage": "en", "madeForKids": False}


def build(root, date=None, mode="auto", daily_path=None):
    dpath = daily_path or os.path.join(root, "data", "daily.json")
    daily = load(dpath)
    if date and (not daily or not str(daily.get("generated_at", "")).startswith(date)):
        arch = load(os.path.join(root, "data", "daily-archive", f"{date}.json"))
        daily = arch or daily
    if not daily:
        raise SystemExit("no Daily to work from")
    if not date:
        g = daily.get("generated_at") or ""
        date = g[:10] if g else dt.date.today().isoformat()
        # generated_at is UTC; the Daily's own date line wins (Central)
        try:
            date = dt.datetime.strptime(daily.get("date", ""), "%A, %B %d, %Y").date().isoformat()
        except ValueError:
            pass
    src = {"date": date, "daily": daily,
           "basis": load(os.path.join(root, "data", "basis-states.json")),
           "storm": load(os.path.join(root, "data", "hail", "storm-days.json")),
           "hail": load(os.path.join(root, "data", "hail", "recent.json")),
           "crop": load(os.path.join(root, "data", "crop-progress.json")),
           "estimates": load(os.path.join(root, "data", "analyst-estimates.json")),
           "prices": load(os.path.join(root, "data", "prices.json")),
           "rain": load(os.path.join(root, "data", "rain", "wi.json")), "rain_fips": "55005"}
    rep = report_today(src)
    if mode == "auto":
        mode = "report" if rep and report_out(rep) else "daily"
    if mode == "report" and not (rep and report_out(rep)):
        raise SystemExit(f"no released report on {date}")
    p = Plan(date, mode)
    (report_beats if mode == "report" else daily_beats)(p, src)
    words = fit(p)
    # drop facts whose line was cut
    said = " ".join(b["text"] + json.dumps(b["scenes"], ensure_ascii=False) for b in p.beats)
    p.facts = [f for f in p.facts if f["show"] in said]
    scenes, caps, total = time_plan(p)
    return {"schema": "agsist-ag60/1", "date": date, "mode": mode, "words": words, "est_seconds": total, "total": total, "timed_by": "estimate",
            "beats": [{k: v for k, v in b.items() if k != "extra"} | {"say": speak.spoken(b["text"]), "words": speak.word_count(b["text"])} for b in p.beats],
            "scenes": scenes, "captions": caps, "facts": p.facts, "meta": metadata(p, src),
            "script": " ".join(b["text"] for b in p.beats)}


def write_side_files(plan, out):
    with open(os.path.join(out, "script.txt"), "w", encoding="utf-8") as f:
        f.write(plan["script"] + "\n")
    with open(os.path.join(out, "captions.srt"), "w", encoding="utf-8") as f:
        f.write(srt(plan["captions"]))
    with open(os.path.join(out, "metadata.json"), "w", encoding="utf-8") as f:
        json.dump(plan["meta"], f, ensure_ascii=False, indent=1)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Ag in 60 plan")
    ap.add_argument("--root", default=".")
    ap.add_argument("--out", default=None)
    ap.add_argument("--date", default=None)
    ap.add_argument("--mode", default="auto", choices=["auto", "daily", "report"])
    ap.add_argument("--daily", default=None)
    a = ap.parse_args(argv)
    plan = build(a.root, a.date, a.mode, a.daily)
    out = a.out or os.path.join(os.environ.get("TMPDIR", "/tmp"), "ag60")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "plan.json"), "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=1)
    write_side_files(plan, out)
    print(f"ag60 plan {plan['date']} {plan['mode']}: {plan['words']} words, {len(plan['scenes'])} scenes, about {plan['est_seconds']:.1f} s -> {out}")


if __name__ == "__main__":
    main()
