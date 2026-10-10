#!/usr/bin/env python3
"""
bake_crop_size.py -- the top of /conditions-yield ("2026 crop size: every
forecast"), baked into the HTML from the three files it shows.

  data/yield-panel.json        every published forecast (build_yield_benchmarks.py)
  data/yield-nowcast.json      our ratings model (build_yield_nowcast.py)
  data/nowcast-direction.json  its locked calls and their grades (nowcast_direction.py)

WHY BAKED. These blocks were drawn by the page's JavaScript after three fetches,
each section hidden until its file arrived. When the page was retitled on
2026-10-10 to lead with them, the layout shift measured 0.52 at 390px (0.33
before): every block below jumped as each one appeared. Baked, the page arrives
whole, a crawler reads the forecasts, and there is one renderer instead of a
page copy and a pipeline copy to keep in step. The page's JavaScript for these
three blocks was removed in the same change.

Regions in conditions-yield.html: CS:panel, CS:week, CS:corn, CS:beans,
CS:record. Idempotent; --check exits 1 when the page is out of date.

    python3 scripts/bake_crop_size.py [--check | --selftest]
"""
import html as H
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "conditions-yield.html"
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def esc(s):
    return H.escape("" if s is None else str(s), quote=True)


def md(iso):
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", str(iso or ""))
    return f"{MON[int(m.group(2)) - 1]} {int(m.group(3))}" if m else str(iso or "")


def f1(v):
    return f"{float(v):.1f}"


# ── every forecast ─────────────────────────────────────────────────────────
LABEL = {"corn": "Corn", "soybeans": "Soybeans"}


def panel(d):
    if not d or not d.get("crops"):
        return ('<section id="cy-panel" style="background:#0d1112;border:1px solid #1a1f20;'
                'border-radius:var(--card-r);padding:18px 20px;margin:18px 0">'
                '<div style="font-size:0.9rem;color:#e6ebe9">The forecast table did not build. '
                'No figures are shown rather than old ones.</div></section>')
    blocks, verdicts = [], []
    for crop, lab in LABEL.items():
        c = d["crops"].get(crop) or {}
        rows = c.get("rows") or []
        if not rows:
            continue
        sp = c.get("spread") or {}
        out = []
        for r in rows:
            band = (f' <span style="color:#8a948f">{f1(r["low"])}&ndash;{f1(r["high"])}</span>'
                    if r.get("low") is not None and r.get("high") is not None else "")
            when = (f'<span style="color:#8a948f">{esc(r["as_of"])}</span>' if r.get("as_of")
                    else '<span style="color:#8a948f">no date published</span>')
            col = "#d4a23f" if r.get("ours") else ("#b9c2bd" if r.get("official") else "#e6ebe9")
            name = (f'<a href="{esc(r["source"])}" style="color:{col};text-decoration:underline;'
                    f'text-underline-offset:2px">{esc(r["name"])}</a>' if r.get("source")
                    else f'<span style="color:{col}">{esc(r["name"])}</span>')
            out.append('<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;'
                       "font-family:'JetBrains Mono',monospace;font-size:0.775rem;padding:5px 0;"
                       'border-top:1px solid #171c1d' + (';background:rgba(212,162,63,.06)' if r.get("ours") else "")
                       + '">' + f'<span>{"&#9656; " if r.get("ours") else ""}{name}</span>'
                       + f'<span><b style="color:{col}">{f1(r["value"])}</b>{band} &middot; {when}</span></div>')
        n = sp.get("n") or len(rows)
        tail = f', {f1(sp["spread"])} apart end to end' if sp.get("spread") is not None else ""
        blocks.append(f'<div><div style="font-size:0.82rem;color:#e6ebe9;font-weight:600;margin-bottom:2px">{lab}'
                      f' <span style="color:#8a948f;font-weight:400">{esc(c.get("unit") or "")}</span></div>'
                      + "".join(out)
                      + f'<div style="font-size:0.755rem;color:#8a948f;margin-top:6px">{n} forecasts on the table{tail}.</div></div>')
        if sp.get("ours") is not None:
            where = (f'the highest of the {sp["n"]}' if sp.get("highest") else
                     f'the lowest of the {sp["n"]}' if sp.get("lowest") else f'number {sp["rank"]} of {sp["n"]}, low to high')
            over = (f', {abs(sp["ours_vs_low"]):.1f} over the lowest'
                    if sp.get("spread") is not None and sp["spread"] > 0 and sp.get("ours_vs_low") else "")
            verdicts.append(f"{lab.lower()}: ours is {where}{over}")
    verdict = ("Read against the other published forecasts: " + "; ".join(verdicts) + "."
               if verdicts else "Other published forecasts, beside ours.")
    graded = any((d["crops"].get(k) or {}).get("graded") for k in LABEL)
    foot = ["Everything here was published by somebody else and is linked to where they published it. "
            "Our own figure is read from the nowcast file below, not typed in beside it, so the two cannot drift apart.",
            "Scored against USDA’s January final, misses included." if graded else
            "Nobody is scored until USDA prints the January final. Being early is not the same as being right, "
            "and this panel will not pretend otherwise."]
    if d.get("cross_checked"):
        foot.append("Cross-checked against the crop tour page so the two cannot print different numbers for the "
                    "same figure (" + ", ".join(d["cross_checked"]) + ").")
    return ('<section id="cy-panel" style="background:#0d1112;border:1px solid #1a1f20;border-radius:var(--card-r);'
            'padding:18px 20px;margin:18px 0">'
            '<div style="font-size:0.755rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;'
            'color:var(--gold);margin-bottom:7px">Every 2026 forecast, low to high</div>'
            f'<div id="cyp-verdict" style="font-size:0.9rem;color:#e6ebe9;line-height:1.6;margin-bottom:12px">{esc(verdict)}</div>'
            f'<div id="cyp-crops" style="display:grid;gap:14px">{"".join(blocks)}</div>'
            f'<div id="cyp-foot" style="font-size:0.795rem;color:#8a948f;line-height:1.65;margin-top:12px">{esc(" ".join(foot))}</div>'
            '</section>')


# ── our model ──────────────────────────────────────────────────────────────
def cell(label, c):
    if not c or c.get("nowcast") is None:
        return '<div style="font-size:0.9rem;color:#8a948f">Nowcast data did not build</div>'
    diff = c["nowcast"] - c["trend"]
    vs = (f'<span style="color:#5fc28a;font-weight:700">&#9650; {abs(diff):.1f} above trend</span>' if diff > 0.4 else
          f'<span style="color:#e0685f;font-weight:700">&#9660; {abs(diff):.1f} below trend</span>' if diff < -0.4 else
          '<span style="color:#b9c2bd;font-weight:700">&asymp; on trend</span>')
    tw = f' ({c["trend_window"].replace("-", "&ndash;")} finals)' if c.get("trend_window") else ""
    bw = ""
    if c.get("band_method") == "expanding-window":
        bw = " (earlier years only" + (f', {c["backtest_window"].replace("-", "&ndash;")}' if c.get("backtest_window") else "") + ")"
    skill = f' ({c["skill_pct"]}% better)' if c.get("skill_pct") is not None else ""
    return (f'<div style="font-size:0.755rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8a948f;margin-bottom:4px">{label}</div>'
            f"<div style=\"font-family:'JetBrains Mono',monospace;font-size:1.9rem;font-weight:800;color:#e6ebe9;line-height:1\">{c['nowcast']:.1f} "
            '<span style="font-size:.8rem;font-weight:400;color:#8a948f">bu/ac</span></div>'
            f"<div style=\"font-family:'JetBrains Mono',monospace;font-size:0.78rem;color:#8a948f;margin-top:5px\">80% band &plusmn;{c['band80']:.1f} &middot; trend {c['trend']:.1f}{tw}</div>"
            f'<div style="font-size:0.787rem;margin-top:5px">{vs}</div>'
            f'<div style="font-size:0.765rem;color:#8a948f;margin-top:5px">backtest average, not this week&rsquo;s number{bw}: '
            f'MAE {c["mae"]:.1f} vs {c["trend_mae"]:.1f} trend-only{skill}, n={c["backtest_years"]} yrs, {c["states"]} states</div>')


def week(d):
    c = ((d or {}).get("crops") or {}).get("corn") or {}
    return (f'ratings week ending {esc(c["week_ending"])} &middot; updates Tuesdays' if c.get("week_ending") else "")


def record(d, today):
    calls = (d or {}).get("calls") or []
    if not calls:
        return ""
    rec = d.get("record") or {"graded": 0, "correct": 0}
    line = "First graded call lands with the next report."
    if rec.get("graded"):
        bits = []
        if rec.get("reports") is not None:
            bits.append(f'{rec["reports"]} report{"" if rec["reports"] == 1 else "s"}')
        if rec.get("on_defective_input"):
            n = rec["on_defective_input"]
            bits.append(f'{n} call{"" if n == 1 else "s"} on a defective input, graded as called')
        line = (f'Record so far: <b style="color:#e6ebe9">{rec["correct"]} of {rec["graded"]}</b> correct'
                + (f' ({"; ".join(bits)})' if bits else "") + "."
                + (" Corn and soybeans on one report come from one model run, so the independent sample is the number of reports."
                   if rec.get("reports") is not None else ""))
    rows = []
    for c in reversed(calls):
        arrow = "&#9650; UP" if c.get("call") == "up" else "&#9660; DOWN" if c.get("call") == "down" else "&asymp; NO REVISION"
        col = "#5fc28a" if c.get("call") == "up" else "#e0685f" if c.get("call") == "down" else "#b9c2bd"
        dim = bool(c.get("superseded_by"))
        if dim:
            right = (f'<span style="color:#8a948f">superseded: locked against {esc(c.get("usda_before"))}, not the print in force; '
                     f're-locked {esc(str(c["superseded_by"]).replace("relock ", "", 1))} before the report, same call</span>')
        elif c.get("outcome") is None:
            right = (f'<span style="color:#8a948f">{"printed " + esc(c["wasde"]) + ", awaiting entry" if c["wasde"] < today else "prints " + esc(c["wasde"])}</span>')
        else:
            oc = "#5fc28a" if c["outcome"] == "correct" else "#e0685f"
            right = (f'<span style="color:#8a948f">USDA {esc(c["usda_before"])} &rarr; {esc(c["usda_after"])}</span> '
                     f'<b style="color:{oc}">{esc(c["outcome"].upper())}</b>'
                     + (f' <span style="color:var(--gold)" title="{esc(c["input_defect"])}">defective input</span>'
                        if c.get("input_defect") else ""))
        # THE LOCK, SAID IN FULL: the number, the ratings week it was read
        # from, and the day it was locked, so a reader can see it came first.
        lock = (f'model {esc(c.get("model"))}'
                + (f' &middot; ratings week of {md(c["model_week_ending"])}' if c.get("model_week_ending") else "")
                + (f' &middot; locked {md(c["locked_on"])}' if c.get("locked_on") else "")
                + f' &middot; vs USDA {esc(c.get("usda_before"))}')
        crop = "beans" if c.get("crop") == "soybeans" else esc(c.get("crop"))
        rows.append('<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;'
                    "font-family:'JetBrains Mono',monospace;font-size:0.775rem;padding:4px 0;border-top:1px solid #171c1d"
                    + (";opacity:.85" if dim else "") + '">'
                    + f'<span style="color:#e6ebe9">{esc(c["wasde"])} {crop} <b style="color:{col}">{arrow}</b>'
                    + f' <span style="color:#8a948f">{lock}</span></span><span>{right}</span></div>')
    return ('<div id="cyn-record" style="background:#0d1112;border:1px solid #1a1f20;border-radius:10px;padding:12px 14px;margin-top:12px">'
            '<div style="font-size:0.755rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--gold);margin-bottom:7px">'
            'On the record: direction vs USDA&rsquo;s next print</div>'
            '<div style="font-size:0.78rem;color:#8a948f;margin-bottom:8px">Locked from the live model before each WASDE, '
            f'graded by subtraction after it. {line}</div>' + "".join(rows) + '</div>')


def splice(src, name, body):
    a, b = f"<!-- CS:{name} -->", f"<!-- /CS:{name} -->"
    pat = re.compile(re.escape(a) + r".*?" + re.escape(b), re.S)
    if not pat.search(src):
        raise SystemExit(f"bake_crop_size: marker CS:{name} missing from {PAGE.name}")
    return pat.sub(lambda m: a + body + b, src, count=1)


def bake(src, panel_d, now_d, dir_d, today):
    crops = (now_d or {}).get("crops") or {}
    src = splice(src, "panel", panel(panel_d))
    src = splice(src, "week", week(now_d))
    src = splice(src, "corn", cell("Corn: 2026 national yield", crops.get("corn")))
    src = splice(src, "beans", cell("Soybeans: 2026 national yield", crops.get("soybeans")))
    src = splice(src, "record", record(dir_d, today))
    return src


def _load(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def selftest():
    fails = []

    def ck(c, m):
        print(("  ok    " if c else "  FAIL  ") + m)
        if not c:
            fails.append(m)
    pd = {"crops": {"corn": {"unit": "bu/acre", "rows": [
        {"id": "profarmer", "name": "Pro Farmer Crop Tour", "value": 173.2, "as_of": "2026-08-21",
         "source": "https://x.test/a?b=1&c=2", "low": 171.5, "high": 175.0},
        {"id": "agsist", "name": "AGSIST nowcast", "value": 180.6, "as_of": "2026-10-04", "ours": True},
        {"id": "usda", "name": "USDA, October WASDE", "value": 181.2, "as_of": "2026-10-09", "official": True}],
        "spread": {"n": 3, "spread": 8.0, "ours": 180.6, "rank": 2, "ours_vs_low": 7.4, "highest": False, "lowest": False}}},
        "cross_checked": ["USDA corn"]}
    h = panel(pd)
    ck("corn: ours is number 2 of 3, low to high, 7.4 over the lowest" in h, "the verdict is in words, from the spread")
    ck("181.2" in h and "2026-10-09" in h and "USDA, October WASDE" in h, "USDA's October print is on the table")
    ck("x.test/a?b=1&amp;c=2" in h, "links are escaped")
    ck("display:none" not in h, "nothing is hidden waiting for a fetch")
    dd = {"record": {"graded": 6, "correct": 3, "reports": 3, "on_defective_input": 2},
          "calls": [{"wasde": "2026-10-09", "crop": "corn", "model": 182.6, "model_week_ending": "2026-09-13",
                     "locked_on": "2026-10-06", "usda_before": 178.5, "usda_after": 181.2, "call": "up",
                     "outcome": "correct"}]}
    r = record(dd, "2026-10-10")
    ck("model 182.6 &middot; ratings week of Sep 13 &middot; locked Oct 6 &middot; vs USDA 178.5" in r,
       "the locked call shows model, ratings week and lock date")
    ck("3 of 6</b> correct" in r and "CORRECT" in r, "the record and the grade")
    ck(record({"calls": []}, "2026-10-10") == "", "no calls, no box")
    c = cell("Corn", {"nowcast": 180.6, "band80": 6.9, "trend": 188.7, "trend_window": "2010-2025", "mae": 4.2,
                      "trend_mae": 5.5, "skill_pct": 24, "backtest_years": 12, "states": 18,
                      "band_method": "expanding-window", "backtest_window": "2011-2024"})
    ck("180.6 " in c and "8.1 below trend" in c and "(24% better)" in c, "the model cell")
    src = ("<!-- CS:panel -->x<!-- /CS:panel --><!-- CS:week --><!-- /CS:week --><!-- CS:corn --><!-- /CS:corn -->"
           "<!-- CS:beans --><!-- /CS:beans --><!-- CS:record --><!-- /CS:record -->")
    once = bake(src, pd, {"crops": {"corn": {"nowcast": 1, "band80": 1, "trend": 1, "mae": 1, "trend_mae": 1,
                                             "backtest_years": 1, "states": 1, "week_ending": "2026-10-04"}}}, dd, "2026-10-10")
    ck(bake(once, pd, {"crops": {"corn": {"nowcast": 1, "band80": 1, "trend": 1, "mae": 1, "trend_mae": 1,
                                          "backtest_years": 1, "states": 1, "week_ending": "2026-10-04"}}}, dd, "2026-10-10") == once,
       "baking twice changes nothing")
    ck("Nowcast data did not build" in once, "a crop with no model figure says so")
    # THE PAGE CARRIES NO SECOND RENDERER FOR THESE BLOCKS
    if PAGE.exists():
        live = PAGE.read_text(encoding="utf-8")
        ck("fetch('/data/yield-panel.json')" not in live and "fetch('/data/nowcast-direction.json')" not in live
           and "fetch('/data/yield-nowcast.json')" not in live, "the page no longer redraws them in JavaScript")
        ck(all(f"<!-- CS:{n} -->" in live for n in ("panel", "week", "corn", "beans", "record")), "every region is on the page")
    print()
    print("bake_crop_size: " + ("all passed" if not fails else "%d FAILED" % len(fails)))
    return 1 if fails else 0


def main():
    if "--selftest" in sys.argv:
        return selftest()
    from datetime import date
    src = PAGE.read_text(encoding="utf-8")
    out = bake(src, _load(ROOT / "data/yield-panel.json"), _load(ROOT / "data/yield-nowcast.json"),
               _load(ROOT / "data/nowcast-direction.json"), date.today().isoformat())
    if out == src:
        print("conditions-yield.html crop-size blocks already in sync.")
        return 0
    if "--check" in sys.argv:
        print("conditions-yield.html crop-size blocks OUT OF DATE: run scripts/bake_crop_size.py")
        return 1
    PAGE.write_text(out, encoding="utf-8")
    print("Baked the crop-size blocks into conditions-yield.html.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
