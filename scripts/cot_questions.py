#!/usr/bin/env python3
"""Last week's question, this week's answer (kit v2 part 2, Nov 6): data/cot-questions.json.

    python3 scripts/cot_questions.py             # writes data/cot-questions.json from data/cot-history.json
    python3 scripts/cot_questions.py --selftest  # no files

cot_analysis.py runs build() at the end of its own run (the same workflow step), so no workflow changes.

Each report gets one question, picked from the data by fixed rules, about fund positions only (never prices):
  1. a buying or selling run of 3 weeks or more (the longest; ties go to the market listed first):
     "Will corn's selling run reach 8 weeks?"
  2. else a net the week's own move could carry across zero: "Will Chicago wheat funds flip to net long?"
  3. else a net at its 52-week high (or low) that beat the old one: "Will lean hogs' net long set another 52-week high?"
  4. else the week's biggest move: "Will funds sell corn again?"
Markets: corn, soybeans, Chicago wheat, live cattle, feeder cattle, lean hogs (the six on the printed sheet).
The answer comes from the next report's net, computed here, never typed: yes or no and the numbers behind it.
The question for an older week is the same rules run on the history cut at that week, so last week's question
and every archived one can be checked against the data by anyone. A run ends at a gap of more than 8 days
(components/cot-kit.js run(), the same rule).
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import os
import sys
from datetime import date, datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
HIST_PATH = os.path.join(HERE, "..", "data", "cot-history.json")
OUT_PATH = os.path.join(HERE, "..", "data", "cot-questions.json")
KEYS = ["corn", "beans", "wheat", "livecattle", "feedercattle", "leanhogs"]
NAMES = {"corn": "corn", "beans": "soybeans", "wheat": "Chicago wheat", "livecattle": "live cattle",
         "feedercattle": "feeder cattle", "leanhogs": "lean hogs"}
WHO = {"corn": "Corn", "beans": "Soybean", "wheat": "Chicago wheat", "livecattle": "Live cattle",
       "feedercattle": "Feeder cattle", "leanhogs": "Lean hog"}
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
ARCHIVE = 8


def d(s):
    return date.fromisoformat(s)


def day(s):
    x = d(s)
    return f"{DOW[x.weekday()]}, {MON[x.month - 1]} {x.day}, {x.year}"


def n(v):
    return f"{abs(int(round(v))):,}"


def poss(name):
    return name + ("'" if name.endswith("s") else "'s")


def side(v):
    return "long" if v > 0 else "short"


def rows_of(hist, key):
    arr = (hist.get("history") or {}).get(key) or []
    out = [r for r in arr if isinstance(r, dict) and isinstance(r.get("net"), (int, float))
           and isinstance(r.get("date"), str) and len(r["date"]) == 10]
    return sorted(out, key=lambda r: r["date"])


def run(rows):
    """weeks in a row the net moved the same way, ending with the last row: (sign, weeks, total)"""
    sign, weeks, total = 0, 0, 0
    for i in range(len(rows) - 1, 0, -1):
        if (d(rows[i]["date"]) - d(rows[i - 1]["date"])).days > 8:
            break
        ch = rows[i]["net"] - rows[i - 1]["net"]
        s = 1 if ch > 0 else -1 if ch < 0 else 0
        if not s or (sign and s != sign):
            break
        sign, weeks, total = s, weeks + 1, total + ch
    return sign, weeks, total


def ask(series, week):
    """The question for the report of `week`. series: {key: rows}. -> dict or None"""
    cands = []
    for o, k in enumerate(KEYS):
        rs = [r for r in series.get(k, []) if r["date"] <= week]
        if len(rs) < 2 or rs[-1]["date"] != week or (d(rs[-1]["date"]) - d(rs[-2]["date"])).days > 8:
            continue
        net, chg = rs[-1]["net"], rs[-1]["net"] - rs[-2]["net"]
        sg, wk, tot = run(rs)
        base = {"market": k, "asked": week, "net": net, "chg": chg}
        if wk >= 3:
            verb = "sold" if sg < 0 else "bought"
            cands.append((0, -wk, o, dict(base, kind="run", sign=sg, weeks=wk,
                         question=f"Will {poss(NAMES[k])} {'selling' if sg < 0 else 'buying'} run reach {wk + 1} weeks?",
                         fact=f"Funds {verb} {NAMES[k]} in each of the {wk} weeks to {day(week)}, {n(tot)} contracts in all.")))
        if net and chg and abs(net) <= abs(chg) and (net > 0) != (chg > 0):   # the week's move, again, would cross zero
            to = "short" if net > 0 else "long"
            cands.append((1, abs(net) / abs(chg), o, dict(base, kind="zero", side=side(net),
                         question=f"Will {NAMES[k]} funds flip to net {to}?",
                         fact=f"{WHO[k]} funds were net {side(net)} {n(net)} contracts in the week to {day(week)}, "
                              f"after {'selling' if chg < 0 else 'buying'} {n(chg)}.")))
        last52 = rs[-53:-1]
        if net and len(last52) >= 26:
            if net > 0 and net > max(r["net"] for r in last52):
                cands.append((2, 0, o, dict(base, kind="high", side="long", mark=net,
                             question=f"Will {poss(NAMES[k])} net long set another 52-week high?",
                             fact=f"{WHO[k]} funds were net long {n(net)} contracts in the week to {day(week)}, the most in 52 weeks.")))
            elif net < 0 and net < min(r["net"] for r in last52):
                cands.append((2, 0, o, dict(base, kind="high", side="short", mark=net,
                             question=f"Will {poss(NAMES[k])} net short set another 52-week high?",
                             fact=f"{WHO[k]} funds were net short {n(net)} contracts in the week to {day(week)}, the most in 52 weeks.")))
        if chg:
            sg1 = 1 if chg > 0 else -1
            cands.append((3, -abs(chg), o, dict(base, kind="run", sign=sg1, weeks=max(wk, 1),
                         question=f"Will funds {'sell' if chg < 0 else 'buy'} {NAMES[k]} again?",
                         fact=f"Funds {'sold' if chg < 0 else 'bought'} {n(chg)} {NAMES[k]} contracts in the week to {day(week)}.")))
    if not cands:
        return None
    cands.sort(key=lambda c: c[:3])
    return cands[0][3]


def answer(q, series):
    """The answer to q from the next report of its market, or None when there is none yet (or a gap)."""
    rs = series.get(q["market"], [])
    nxt = [r for r in rs if r["date"] > q["asked"]]
    if not nxt or (d(nxt[0]["date"]) - d(q["asked"])).days > 8:
        return None
    r = nxt[0]
    net, chg, k, wk = r["net"], r["net"] - q["net"], q["market"], day(r["date"])
    out = {"answered": r["date"]}
    if q["kind"] == "run":
        same = chg != 0 and (chg > 0) == (q["sign"] > 0)
        verb = "sold" if chg < 0 else "bought"
        if same:
            w = q["weeks"] + 1
            txt = f"Yes. Funds {verb} {n(chg)} {NAMES[k]} contracts in the week to {wk}" + (
                f": {w} weeks in a row." if w >= 2 else ".")
        elif chg == 0:
            txt = f"No. Funds held their {NAMES[k]} position in the week to {wk}."
        else:
            txt = f"No. Funds {verb} {n(chg)} {NAMES[k]} contracts in the week to {wk}" + (
                f", ending the run at {q['weeks']} weeks." if q["weeks"] >= 2 else ".")
        return dict(out, result="yes" if same else "no", answer=txt)
    if q["kind"] == "zero":
        was = q["side"]
        flipped = net != 0 and side(net) != was
        if flipped:
            txt = f"Yes. {WHO[k]} funds flipped to net {side(net)}: {n(net)} contracts in the week to {wk}."
        elif net == 0:
            txt = f"No. {WHO[k]} funds came to no net position in the week to {wk}, short of flipping."
        else:
            txt = f"No. {WHO[k]} funds stayed net {was}: {n(net)} contracts in the week to {wk}."
        return dict(out, result="yes" if flipped else "no", answer=txt)
    # 52-week high (or the biggest net short in 52 weeks)
    prior = [x for x in rs if x["date"] <= q["asked"]][-52:]
    if q["side"] == "long":
        mark = max(x["net"] for x in prior)
        hit = net > mark
    else:
        mark = min(x["net"] for x in prior)
        hit = net < mark
    at = next(x["date"] for x in reversed(prior) if x["net"] == mark)
    if hit:
        txt = f"Yes. {WHO[k]} funds were net {q['side']} {n(net)} contracts in the week to {wk}, a new 52-week high."
    elif net == 0 or side(net) != q["side"]:
        txt = f"No. {WHO[k]} funds were " + (f"net {side(net)} {n(net)}" if net else "at no net position") + \
              f" in the week to {wk}, against the 52-week high of {n(mark)} net {q['side']} on {day(at)}."
    else:
        txt = f"No. {WHO[k]} funds were net {q['side']} {n(net)} contracts in the week to {wk}, under the 52-week high of {n(mark)} on {day(at)}."
    return dict(out, result="yes" if hit else "no", answer=txt)


def public(q, a=None):
    o = {"asked": q["asked"], "market": q["market"], "kind": q["kind"], "question": q["question"], "fact": q["fact"]}
    if a:
        o.update(a)
    return o


def build(hist, now=None):
    series = {k: rows_of(hist, k) for k in KEYS}
    weeks = sorted({r["date"] for k in KEYS for r in series[k]})
    if len(weeks) < 3:
        return None
    latest = weeks[-1]
    this = ask(series, latest)
    past = []
    for w in reversed(weeks[:-1]):
        if len(past) >= ARCHIVE:
            break
        q = ask(series, w)
        a = q and answer(q, series)
        if q and a:
            past.append(public(q, a))
    last = past[0] if past and past[0]["answered"] == latest else None
    return {"updated": (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "report_date": latest,
            "note": "Questions about fund positions only (runs, flips across zero, 52-week highs), picked and "
                    "answered from the CFTC data by fixed rules. Not about prices.",
            "this_week": public(this) if this else None,
            "last_week": last,
            "archive": past}


def write(hist_path=HIST_PATH, out_path=OUT_PATH):
    with open(hist_path) as f:
        hist = json.load(f)
    out = build(hist)
    if not out:
        print("cot_questions: not enough history, nothing written")
        return None
    with open(out_path, "w") as f:
        json.dump(out, f, indent=1)
    print(f"Written {out_path}: {out['this_week'] and out['this_week']['question']}")
    return out


def selftest():
    bad = []

    def ck(name, cond, why=""):
        if not cond:
            bad.append(f"{name} {why}")

    def H(series):
        out = {}
        for k, nets in series.items():
            out[k] = [{"date": (date(2026, 1, 6).fromordinal(date(2026, 1, 6).toordinal() + 7 * i)).isoformat(), "net": v}
                      for i, v in enumerate(nets)]
        return {"history": out}

    flat = [100000 + (i % 2) * 10 for i in range(40)]
    # a selling run in corn: 7 weeks, then an 8th
    corn = flat[:30] + [90000, 80000, 70000, 60000, 50000, 40000, 30000, 25000]
    h = H({"corn": corn, "beans": flat[:38]})
    o = build(h, datetime(2026, 11, 6, tzinfo=timezone.utc))
    tw, lw = o["this_week"], o["last_week"]
    ck("run question", tw["kind"] == "run" and tw["question"] == "Will corn's selling run reach 9 weeks?", tw)
    ck("last week asked 8", lw and lw["question"] == "Will corn's selling run reach 8 weeks?", lw)
    ck("answered yes", lw and lw["result"] == "yes" and lw["answer"].startswith("Yes. Funds sold 5,000 corn contracts")
       and lw["answer"].endswith(": 8 weeks in a row."), lw)
    # the run ends
    h2 = H({"corn": corn[:-1] + [32000], "beans": flat[:38]})
    lw2 = build(h2)["last_week"]
    ck("answered no", lw2["result"] == "no" and "ending the run at 7 weeks." in lw2["answer"], lw2)
    # a flip across zero
    wh = flat[:35] + [100000, 60000, 5000]
    h3 = H({"wheat": wh + [-4000], "beans": flat[:39]})
    o3 = build(h3)
    ck("zero asked last week", o3["last_week"]["kind"] in ("zero", "run"), o3["last_week"])
    h4 = H({"wheat": flat[:36] + [60000, 5000], "beans": flat[:38]})
    q4 = ask({k: rows_of(h4, k) for k in KEYS}, rows_of(h4, "wheat")[-1]["date"])
    ck("zero question", q4["kind"] == "zero" and q4["question"] == "Will Chicago wheat funds flip to net short?", q4)
    a4 = answer(q4, {"wheat": rows_of(H({"wheat": flat[:36] + [60000, 5000, -4000]}), "wheat")})
    ck("zero yes", a4["result"] == "yes" and a4["answer"].startswith("Yes. Chicago wheat funds flipped to net short: 4,000"), a4)
    # a 52-week high
    hogs = [50000 + (i % 3) * 1000 for i in range(56)] + [60000]
    h5 = H({"leanhogs": hogs, "corn": [100000 + (i % 2) * 10 for i in range(57)]})
    q5 = ask({k: rows_of(h5, k) for k in KEYS}, rows_of(h5, "leanhogs")[-1]["date"])
    ck("high question", q5 and q5["kind"] == "high" and q5["question"] == "Will lean hogs' net long set another 52-week high?", q5)
    a5 = answer(q5, {"leanhogs": rows_of(H({"leanhogs": hogs + [58000]}), "leanhogs")})
    ck("high no", a5["result"] == "no" and "under the 52-week high of 60,000" in a5["answer"], a5)
    # every string: no dashes, no price words, a year in every date
    for x in [o, o3, build(h5)]:
        s = json.dumps(dict(x, note=""))
        ck("no dashes", "\\u2014" not in s and "\\u2013" not in s and "\u2014" not in s)
        ck("no price words", not any(w in s.lower() for w in ("price", "$", "cents", "rally")))
    ck("archive newest first", o["archive"][0]["asked"] > o["archive"][-1]["asked"])
    ck("no answer past a gap", answer({"market": "corn", "asked": "2026-01-06", "kind": "run", "sign": -1, "weeks": 3, "net": 1},
                                      {"corn": [{"date": "2026-01-20", "net": 0}]}) is None)
    if bad:
        print("cot_questions selftest FAILED:\n  " + "\n  ".join(map(str, bad)))
        return 1
    print("cot_questions selftest: ok")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    sys.exit(0 if write() else 1)
