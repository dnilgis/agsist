#!/usr/bin/env python3
"""build_track_record.py: the one track-record table at /scorecard (usda-calendar.html#scorecard), Nov 6, 2026.

Reads the public forecast record (forecasts/forecast-record.jsonl and forecasts/baselines.json in a checkout of the
public agsist-data repo) and writes the table between the TRACK markers of usda-calendar.html. Counts and rates
only. Nothing is written when the record is missing, its chain is broken, or a row carries a field outside the
public list: the page keeps what it had.

    python3 scripts/build_track_record.py --data DIR [--today YYYY-MM-DD]
    python3 scripts/build_track_record.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import hashlib
import html as H
import json
import math
import os
import re
import sys
import tempfile
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "usda-calendar.html")
GENESIS = "0" * 64
LOCK_FIELDS = {"id", "fc", "v", "locked_at", "target", "est", "lo", "hi", "dir", "baseline_est", "prev", "h"}
GRADE_FIELDS = {"id", "fc", "graded_at", "actual", "miss", "base_miss", "dir_right", "maj_right", "flat_right",
                "in_range", "prev", "h"}
START, END = "<!--TRACK:start-->", "<!--/TRACK-->"
MARK = re.compile(re.escape(START) + r".*?" + re.escape(END), re.S)
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def digest(row):
    c = json.dumps({k: v for k, v in row.items() if k != "h"}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(c.encode()).hexdigest()


def load(data):
    """(rows, baselines) from an agsist-data checkout, or ValueError with the reason."""
    p = os.path.join(data, "forecasts", "forecast-record.jsonl")
    b = os.path.join(data, "forecasts", "baselines.json")
    if not (os.path.exists(p) and os.path.exists(b)):
        raise ValueError("no public forecast record in " + data)
    with open(p, encoding="utf-8") as f:
        rows = [json.loads(line) for line in f if line.strip()]
    with open(b, encoding="utf-8") as f:
        base = json.load(f)
    prev = GENESIS
    for i, r in enumerate(rows):
        if r.get("prev") != prev:
            raise ValueError("row %d: chain broken" % i)
        if r.get("h") != digest(r):
            raise ValueError("row %d: content changed" % i)
        prev = r["h"]
        want = LOCK_FIELDS if "locked_at" in r else GRADE_FIELDS
        if set(r) != want:
            raise ValueError("row %d: fields outside the public list" % i)
        if r["fc"] not in base["forecasts"]:
            raise ValueError("row %d: forecast %s has no baselines" % (i, r["fc"]))
    return rows, base


def wilson(k, n, z=1.96):
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return max(0.0, c - h), min(1.0, c + h)


def day(s):
    d = date.fromisoformat(s[:10])
    return "%s %d, %d" % (MON[d.month - 1], d.day, d.year)


def pct(x):
    return "%.0f%%" % (100 * x)


def measures(pairs):
    """Numbers over a list of (lock, grade) pairs."""
    # a tie (the outcome equals the price at the lock) is neither right nor wrong and stays out of the direction count
    d = [(g["dir_right"], g["maj_right"], g["base_miss"]) for _, g in pairs
         if g["dir_right"] is not None and g["base_miss"] != 0]
    lv = [(abs(g["miss"]) / abs(g["actual"]), abs(g["base_miss"]) / abs(g["actual"]))
          for _, g in pairs if g["miss"] is not None and g["base_miss"] is not None and g["actual"]]
    rg = [g["in_range"] for _, g in pairs if g["in_range"] is not None]
    out = {"d_n": len(d), "d_k": sum(1 for x in d if x[0]), "m_n": len(lv), "r_n": len(rg),
           "r_k": sum(1 for x in rg if x)}
    # the more-common-direction baseline over the cases where it is defined
    xs = [x[1] for x in d if x[1] is not None]
    out["maj"] = (sum(1 for x in xs if x), len(xs)) if xs else None
    # after the fact only: how many of the counted moves were up (for a forecast with no baseline fixed in advance)
    ms = [x[2] for x in d if x[2] is not None]
    out["rose"] = (sum(1 for x in ms if x > 0), len(ms)) if ms else None
    if lv:
        out["miss"] = sum(a for a, _ in lv) / len(lv)
        out["base"] = sum(b for _, b in lv) / len(lv)
    return out


def best_dir(m, cfg):
    """(label, k, n) of the direction baseline fixed in advance (always the more common direction), or None.
    "No change" stays in the record but is never shown or used for a direction call: it is almost never right."""
    if m.get("maj") and cfg.get("majority"):
        return ("Always %s" % cfg["majority"]["dir"], ) + m["maj"]
    return None


def after_fact(m):
    """The plain comparison line for a direction call with no baseline fixed in advance, labelled after the fact."""
    if not m.get("rose"):
        return ""
    k, n = m["rose"]
    up = k * 2 >= n
    return ("Prices %s in %d of %d; always saying %s would have been right %s."
            % ("rose" if up else "fell", k if up else n - k, n, "up" if up else "down", pct((k if up else n - k) / n)))


def status(cfg, pairs, locks, today):
    """Live, Quiet, Building or Retired, and why. The quiet rule runs over the last `window` graded cases."""
    if cfg.get("retired"):
        return "Retired", "retired %s" % day(cfg["retired"])
    measured = [p for p in pairs if p[1]["dir_right"] is not None or p[1]["miss"] is not None]
    if len(measured) < cfg["min_n"]:
        return "Building", "%d of %d graded" % (len(measured), cfg["min_n"])
    m = measures(measured[-cfg["window"]:])
    why = []
    b = best_dir(m, cfg)
    if m["d_n"] and b and m["d_k"] / m["d_n"] <= b[1] / b[2]:
        why.append("does not beat its baseline")
    if m["m_n"] and m["miss"] >= m["base"]:
        why.append("does not beat its baseline")
    if m["r_n"] and not (0.70 <= m["r_k"] / m["r_n"] <= 0.90):
        why.append("range coverage outside 70% to 90%")
    if m["d_n"] and m["d_k"] / m["d_n"] < 0.60:
        why.append("direction right under 60%")
    last = max((l["locked_at"][:10] for l in locks), default=None)
    if last is None or (date.fromisoformat(today) - date.fromisoformat(last)).days > cfg["stale_days"]:
        why.append("no new forecast lately")
    return ("Quiet", "; ".join(dict.fromkeys(why))) if why else ("Live", "")


def rows_for(rows, base, today):
    locks = {r["id"]: r for r in rows if "locked_at" in r}
    out = []
    for fc, cfg in base["forecasts"].items():
        ls = [l for l in locks.values() if l["fc"] == fc]
        pairs = [(locks[g["id"]], g) for g in rows if "graded_at" in g and g["fc"] == fc and g["id"] in locks]
        st, why = status(cfg, pairs, ls, today)
        measured = [p for p in pairs if p[1]["dir_right"] is not None or p[1]["miss"] is not None]
        m = measures(measured)
        show = len(measured) >= cfg["min_n"]
        hold = "Building: %d of %d graded" % (len(measured), cfg["min_n"])
        period = ("%s to %s" % (day(min(l["locked_at"] for l, _ in pairs)), day(max(g["graded_at"] for _, g in pairs)))
                  if pairs else "none graded yet")
        after = ""
        if cfg["kind"] != "direction":
            dcell, bcell = "No direction call", ""
        elif not show:
            dcell, bcell = hold, ""
        else:
            lo, hi = wilson(m["d_k"], m["d_n"])
            dcell = "%d of %d right, %s (95%%: %s to %s)" % (m["d_k"], m["d_n"], pct(m["d_k"] / m["d_n"]), pct(lo), pct(hi))
            b = best_dir(m, cfg)
            bcell = "%s: %d of %d, %s" % (b[0], b[1], b[2], pct(b[1] / b[2])) if b else "No baseline fixed in advance"
            after = "" if b else after_fact(m)
        if not m["m_n"]:
            mcell = "No level forecast" if cfg["kind"] == "direction" and not cfg.get("level") else "None graded yet"
        elif not show:
            mcell = hold
        else:
            mcell = "%.1f%% vs %.1f%% for no change (%d graded)" % (100 * m["miss"], 100 * m["base"], m["m_n"])
        if not m["r_n"]:
            rcell = "No range" if not any(l["lo"] is not None for l in ls) else "None graded yet"
        elif not show:
            rcell = hold
        else:
            rcell = "%d of %d inside, %s" % (m["r_k"], m["r_n"], pct(m["r_k"] / m["r_n"]))
        out.append({"fc": fc, "label": cfg["label"], "every": cfg["every"], "period": period, "locked": len(ls),
                    "graded": sum(1 for _, g in pairs if g["actual"] is not None), "dir": dcell, "base": bcell,
                    "after": after, "miss": mcell, "range": rcell,
                    "status": st, "why": why})
    order = {"Live": 0, "Quiet": 1, "Building": 2, "Retired": 3}
    return sorted(out, key=lambda x: order[x["status"]])     # stable: the baselines file's order within a status


CSS = (".tr{margin:0 0 2rem}.tr>h2.cal-big-h{border:0;padding:0;font-family:var(--font-display);font-size:clamp(1.35rem,4vw,1.75rem);"
       "font-weight:800;line-height:1.15;color:var(--text);margin:0 0 .45rem;letter-spacing:-.01em}"
       ".tr-lede{max-width:46rem}.tr-list{list-style:none;margin:.8rem 0;padding:0;display:grid;gap:.7rem}"
       ".tr-c{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:.85rem 1rem;min-width:0}"
       ".tr-c h3{font-size:1rem;margin:0 0 .15rem;line-height:1.3}.tr-c .tr-sub{color:var(--text-muted);font-size:.82rem;margin:0 0 .5rem}"
       ".tr-c dl{display:grid;grid-template-columns:1fr;gap:.35rem;margin:0}.tr-c dl>div{min-width:0}"
       ".tr-c dt{font-size:.74rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.03em}"
       ".tr-c dd{margin:0;font-size:.9rem;overflow-wrap:anywhere}.tr-st{display:inline-block;font-size:.76rem;font-weight:700;"
       "padding:.1rem .5rem;border-radius:999px;border:1px solid var(--border);margin-left:.35rem;vertical-align:middle}"
       ".tr-st.live{color:var(--green);border-color:var(--green)}.tr-st.quiet{color:var(--gold)}.tr-st.building{color:var(--text-muted)}"
       ".tr-st.retired{color:var(--text-muted)}.tr-note{font-size:.84rem;color:var(--text-muted);max-width:46rem}"
       "@media(min-width:760px){.tr-c dl{grid-template-columns:repeat(3,minmax(0,1fr));gap:.5rem 1rem}}")


def block(rows, base, today):
    e = H.escape
    cards = []
    for r in rows_for(rows, base, today):
        cls = r["status"].lower()
        why = ' <span class="tr-why">(%s)</span>' % e(r["why"]) if r["why"] and r["status"] in ("Quiet",) else ""
        items = [("Period", r["period"]), ("Locked / graded with an outcome", "%d / %d" % (r["locked"], r["graded"])),
                 ("Direction right", r["dir"])]
        if r["base"]:
            items.append(("Simple baseline", r["base"]))
        if r["after"]:
            items.append(("For comparison, after the fact", r["after"]))
        items += [("Average miss vs baseline", r["miss"]), ("80% range held the outcome", r["range"])]
        dl = "".join("<div><dt>%s</dt><dd>%s</dd></div>" % (e(k), e(v)) for k, v in items)
        cards.append('<li class="tr-c" data-fc="%s"><h3>%s<span class="tr-st %s">%s</span>%s</h3>'
                     '<p class="tr-sub">%s. %s.</p><dl>%s</dl></li>'
                     % (e(r["fc"]), e(r["label"]), cls, e(r["status"]), why, e(r["every"][0].upper() + r["every"][1:]),
                        e(r["why"][0].upper() + r["why"][1:]) if r["why"] and r["status"] != "Quiet" else "Graded by arithmetic", dl))
    asof = max(max(r.get("locked_at", ""), r.get("graded_at", "")) for r in rows)[:10] if rows else today
    fixed = day(base["declared_on"])
    return (START + "\n"
            '<div class="tr" id="forecast-record">\n<style>' + CSS + '</style>\n'
            '<h2 class="cal-big-h" id="tr-h">Every AGSIST forecast, graded</h2>\n'
            '<p class="tr-lede">Every forecast AGSIST publishes is locked before the outcome is known and graded by arithmetic '
            'after it. Each one is scored beside simple baselines that need no model at all (for a direction call, always calling '
            'the direction fixed in advance as the more common one; for a level, calling no change), never against a coin flip. A rate stays hidden until enough calls are graded '
            'to mean something.</p>\n'
            '<ul class="tr-list">' + "".join(cards) + '</ul>\n'
            '<p class="tr-note"><b>Status.</b> Live: over its most recent graded calls it beats its baseline, its 80% range '
            'holds the outcome 70% to 90% of the time, it is right on direction at least 60% of the time, and it is still being '
            'made. Quiet: it misses one of those; it keeps locking and grading in the open. Building: too few graded calls to '
            'say. Retired: no longer made; its record stays. Locked counts every forecast written down, including ones still waiting '
            'for their outcome and ones replaced by a newer lock before the report, which are kept and never graded. A call whose outcome landed exactly on the price at the lock counts as neither right '
            'nor wrong and is left out of the direction count. The average miss is the gap to the outcome as a share of the '
            'outcome. The baselines were fixed ' + e(fixed) + ' and are never changed. Record as of ' + e(day(asof)) + '.</p>\n'
            '<details class="tr-src"><summary>Sources</summary><p class="tr-note">AGSIST&rsquo;s public forecast record: one '
            'line per locked forecast and one per grade, each line carrying a fingerprint of the line before it, so no past '
            'call can be changed or dropped without it showing. Outcomes: USDA WASDE and NASS Crop Production yields; futures '
            'closes from Yahoo Finance; USDA AMS announced Class III prices. Backtest baselines: the USDA WASDE archive and the '
            'prediction bot&rsquo;s published backtest.</p></details>\n'
            '</div>\n' + END)


def write(page, text):
    with open(page, encoding="utf-8") as f:
        src = f.read()
    if not MARK.search(src):
        raise ValueError("no TRACK markers in " + page)
    out = MARK.sub(lambda _: text, src, count=1)
    if out != src:
        d = os.path.dirname(page) or "."
        fd, tmp = tempfile.mkstemp(dir=d)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(out)
        os.chmod(tmp, 0o644)
        os.replace(tmp, page)
    return out != src


def selftest():
    ok = 0

    def eq(a, b):
        nonlocal ok
        assert a == b, (a, b)
        ok += 1
    lo, hi = wilson(8, 10)
    assert abs(lo - 0.4902) < 0.001 and abs(hi - 0.9433) < 0.001
    ok += 1
    base = {"declared_on": "2026-11-06", "forecasts": {
        "a": {"label": "A", "kind": "direction", "every": "weekly", "window": 3, "min_n": 3, "stale_days": 30,
              "majority": {"dir": "up", "text": "x"}, "flat": "x", "level": None},
        "b": {"label": "B", "kind": "level", "every": "monthly", "window": 3, "min_n": 3, "stale_days": 30,
              "majority": None, "flat": None, "level": "x"}}}
    rows = []

    def add(r):
        r = dict(r)
        r["prev"] = rows[-1]["h"] if rows else GENESIS
        r["h"] = digest(r)
        rows.append(r)
    for i, (right, up) in enumerate(((True, True), (True, False), (False, True), (True, True))):
        add({"id": "a%d" % i, "fc": "a", "v": 1, "locked_at": "2026-10-0%d" % (i + 1), "target": "t", "est": None,
             "lo": None, "hi": None, "dir": "up", "baseline_est": 10.0})
        add({"id": "a%d" % i, "fc": "a", "graded_at": "2026-10-1%d" % i, "actual": 11.0 if up else 9.0, "miss": None,
             "base_miss": 1.0 if up else -1.0, "dir_right": right, "maj_right": up, "flat_right": False, "in_range": None})
    add({"id": "b0", "fc": "b", "v": 1, "locked_at": "2026-10-01", "target": "t", "est": 100.0, "lo": 90.0, "hi": 110.0,
         "dir": None, "baseline_est": 104.0})
    add({"id": "b0", "fc": "b", "graded_at": "2026-10-20", "actual": 102.0, "miss": 2.0, "base_miss": -2.0,
         "dir_right": None, "maj_right": None, "flat_right": None, "in_range": True})
    r = {x["fc"]: x for x in rows_for(rows, base, "2026-10-25")}
    eq(r["a"]["dir"], "3 of 4 right, 75% (95%: 30% to 95%)")
    eq(r["a"]["base"], "Always up: 3 of 4, 75%")
    eq(r["a"]["status"], "Quiet")                    # 2 of 3 recent right vs always up 2 of 3: does not beat it
    eq(r["b"]["miss"], "Building: 1 of 3 graded")    # withheld under the minimum
    eq(r["b"]["status"], "Building")
    eq(r["b"]["dir"], "No direction call")
    eq(status(base["forecasts"]["a"], [], [], "2026-10-25")[0], "Building")
    html = block(rows, base, "2026-10-25")
    assert "—" not in html and "–" not in html
    assert '<details class="tr-src"><summary>Sources</summary>' in html and "<details open" not in html
    eq(html.count('class="tr-c"'), 2)
    # a broken chain, an edited row or an extra field: refused, the page is left alone
    with tempfile.TemporaryDirectory() as t:
        os.makedirs(os.path.join(t, "forecasts"))
        json.dump(base, open(os.path.join(t, "forecasts/baselines.json"), "w"))
        p = os.path.join(t, "forecasts/forecast-record.jsonl")
        good = "".join(json.dumps(x) + "\n" for x in rows)
        open(p, "w").write(good)
        eq(len(load(t)[0]), len(rows))
        bad_rows = [dict(rows[0], est=5.0)] + rows[1:]
        extra = [dict(rows[0], signal="x")]
        extra[0]["h"] = digest(extra[0])
        for bad in (bad_rows, rows[1:], extra + rows[1:]):
            open(p, "w").write("".join(json.dumps(x) + "\n" for x in bad))
            try:
                load(t)
                raise AssertionError("accepted a bad record")
            except ValueError:
                ok += 1
        pg = os.path.join(t, "page.html")
        open(pg, "w").write("<p>x</p>\n" + START + "\nold\n" + END + "\n")
        eq(write(pg, html), True)
        eq(write(pg, html), False)
    print("build_track_record selftest: %d passed" % ok)


def main(argv):
    if "--selftest" in argv:
        return selftest()
    data = argv[argv.index("--data") + 1] if "--data" in argv else None
    today = argv[argv.index("--today") + 1] if "--today" in argv else datetime.now(timezone.utc).date().isoformat()
    page = argv[argv.index("--page") + 1] if "--page" in argv else PAGE
    if not data:
        print("usage: build_track_record.py --data DIR [--today YYYY-MM-DD] [--page FILE] | --selftest", file=sys.stderr)
        return 2
    try:
        rows, base = load(data)
        changed = write(page, block(rows, base, today))
    except ValueError as e:
        print("track record: not written (%s)" % e)
        return 1
    print("track record: %d rows, %s" % (len(rows), "page updated" if changed else "no change"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]) or 0)
