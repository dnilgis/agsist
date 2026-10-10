#!/usr/bin/env python3
"""
build_condyield.py  —  AGSIST /conditions-yield page baker.

Reads data/cond-yield/fit.json and bakes every static region of
conditions-yield.html: the ranked state table, the four hero tiles, the
one-line seed summary, the "data refreshed" stamp, the meta description and
the FAQ answer inside the JSON-LD.

WHY THIS EXISTS
The table, tiles, seed and meta were hand-written and never regenerated, while
the verdict module at the top of the same page reads fit.json live. By August
2026 they had drifted three weeks apart and openly contradicted each other:
Pennsylvania read 25% in the table and 65% in the verdict box 200px above it,
and the row ranked #1 under the heading "ranked by what THIS WEEK's number is
worth" was not the top state any more. Everything on the page now comes from
one source.

Update flow:
    1. the cond-yield workflow refreshes data/cond-yield/fit.json
    2. run:  python3 scripts/build_condyield.py
       (the workflow does this and commits the HTML — see cond-yield.yml)

Idempotent: two runs on the same JSON produce a byte-identical file.
Self-validating: refuses to write if the result fails the gauntlet.

Usage:
    python3 scripts/build_condyield.py           # bake in place
    python3 scripts/build_condyield.py --check   # verify only (CI-safe)
    python3 scripts/build_condyield.py --html PATH --json PATH
"""

import argparse
import html as H
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

# Only the states the page's own selector knows how to name.
ST_NAME = {
    "AL": "Alabama", "AR": "Arkansas", "CO": "Colorado", "DE": "Delaware",
    "GA": "Georgia", "IA": "Iowa", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "MD": "Maryland", "MI": "Michigan", "MN": "Minnesota", "MO": "Missouri",
    "MS": "Mississippi", "MT": "Montana", "NC": "North Carolina",
    "ND": "North Dakota", "NE": "Nebraska", "NJ": "New Jersey",
    "NY": "New York", "OH": "Ohio", "OK": "Oklahoma", "PA": "Pennsylvania",
    "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
    "TX": "Texas", "VA": "Virginia", "WA": "Washington", "WI": "Wisconsin",
    "WV": "West Virginia", "WY": "Wyoming",
}


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def rows_for(data, crop):
    """One row per state: this week's R2, the season peak, slope there, n.

    A state is included only if it has a fit for its OWN latest week. Missing
    is left out rather than shown as zero — a state with no fit this week is
    not a state whose ratings explain nothing.
    """
    out = []
    states = (data.get("crops", {}).get(crop, {}) or {}).get("states", {}) or {}
    for st, d in states.items():
        latest = d.get("latest") or {}
        wk = latest.get("week")
        weeks = d.get("weeks") or {}
        cur = weeks.get(str(wk))
        if wk is None or not cur or cur.get("r2") is None:
            continue
        peak_wk, peak = None, None
        for w, v in weeks.items():
            if v.get("r2") is None:
                continue
            if peak is None or v["r2"] > peak["r2"]:
                peak, peak_wk = v, int(w)
        out.append({
            "st": st, "name": ST_NAME.get(st, st),
            "week": int(wk), "year": latest.get("year"),
            "r2": cur["r2"], "n": cur.get("n"),
            "peak_r2": peak["r2"], "peak_wk": peak_wk,
            "peak_slope": peak.get("slope"), "peak_n": peak.get("n"),
        })
    out.sort(key=lambda r: (-r["r2"], r["name"]))
    return out


def colour(r2):
    # Same thresholds the live verdict module uses, so the table and the
    # verdict box can never disagree about what counts as meaningful.
    return "#5fc28a" if r2 >= 0.5 else ("#d4a23f" if r2 >= 0.25 else "#3a4144")


def render_table(rows):
    out = []
    for r in rows:
        slope = "&mdash;" if r["peak_slope"] is None else f'{r["peak_slope"]:+.2f}'
        sv = 0 if r["peak_slope"] is None else r["peak_slope"]
        # The peak week can rest on a different set of years from this week's
        # (IA corn: 26 at week 39, 22 at week 40), so its n is printed with it.
        peak_n = "" if r["peak_n"] is None else f' &middot; n={r["peak_n"]}'
        out.append(
            f'<tr><td><button class="cy-sel" data-st="{esc(r["st"])}">{esc(r["name"])}</button></td>'
            f'<td data-v="{r["r2"]:.3f}" style="color:{colour(r["r2"])}">{round(r["r2"]*100)}%</td>'
            f'<td data-v="{r["peak_r2"]:.3f}">{round(r["peak_r2"]*100)}% '
            f'<span class="mut" style="font-size:0.775rem">wk {r["peak_wk"]}{peak_n}</span></td>'
            f'<td data-v="{sv:.3f}">{slope}</td>'
            f'<td data-v="{r["n"]}">{r["n"]}</td></tr>')
    return "".join(out)


def pick(rows, st):
    for r in rows:
        if r["st"] == st:
            return r
    return None


def attach_years(rows, pairs, first_year=2000):
    """Name the years a week's fit is missing, from pairs.json -- the same
    same-week (year, G+E, yield) pairs the fit was computed on, emitted by the
    same fetch. Only used when pairs.json is for the SAME ISO week and its
    year count equals the fit's n; otherwise the row says n and names nothing
    rather than guessing which years are absent.
    """
    pc = ((pairs or {}).get("crops") or {}).get("corn") or {}
    for r in rows:
        r["missing"] = None
        if pc.get("week") != r["week"]:
            continue
        yrs = sorted({int(x[0]) for x in (pc.get("states") or {}).get(r["st"], [])})
        if not yrs or len(yrs) != r["n"] or not r.get("year"):
            continue
        span = range(first_year, int(r["year"]))
        r["missing"] = [y for y in span if y not in yrs]
        r["span_n"] = len(span)
    return rows


def n_note(r):
    """'n=22 yrs; no 2000, 2012, 2013, 2025' -- the sample beside the claim."""
    out = f'n={r["n"]} yrs'
    if r.get("missing"):
        out += "; no " + ", ".join(str(y) for y in r["missing"])
    return out


def mixed_n(r):
    """True when this week's fit and the peak week's fit rest on different
    numbers of years, so comparing the two R2 values is not like for like."""
    return r.get("n") is not None and r.get("peak_n") is not None and r["n"] != r["peak_n"]


def render_tiles(data, rows):
    ia = pick(rows, "IA")
    top = rows[0] if rows else None
    wk = rows[0]["week"] if rows else None
    t = []
    if ia:
        cmp = (f' &middot; not the same years as week {ia["peak_wk"]} ({ia["n"]} vs {ia["peak_n"]}), '
               f'so the two are not like for like') if mixed_n(ia) else ""
        t.append(f'<div class="cy-stat"><div class="v">{round(ia["r2"]*100)}%</div>'
                 f'<div class="l">Iowa corn, this week (wk {ia["week"]})</div>'
                 f'<div class="s">of yield deviation from trend explained by G+E &middot; '
                 f'{n_note(ia)}{cmp}</div></div>')
        t.append(f'<div class="cy-stat"><div class="v">{round(ia["peak_r2"]*100)}%</div>'
                 f'<div class="l">Iowa corn by week {ia["peak_wk"]}</div>'
                 f'<div class="s">the season seals it late &middot; n={ia["peak_n"]} yrs</div></div>')
    if top:
        t.append(f'<div class="cy-stat"><div class="v">{round(top["r2"]*100)}%</div>'
                 f'<div class="l">{esc(top["name"])}, this week</div>'
                 f'<div class="s">the clearest read in the country right now &middot; {n_note(top)}</div></div>')
    t.append(f'<div class="cy-stat"><div class="v">n&ge;{data.get("min_n", 15)}</div>'
             f'<div class="l">years per fit, minimum</div>'
             f'<div class="s">thin fits refused</div></div>')
    return "".join(t)


def render_seed(data, rows):
    ia, top = pick(rows, "IA"), (rows[0] if rows else None)
    il = pick(rows, "IL")
    wk = rows[0]["week"] if rows else "?"
    yr = rows[0]["year"] if rows else "?"
    bits = [f"week {wk} of {yr}: corn ratings currently explain "]
    parts = []
    if ia:
        # r2 is the fit on DETRENDED yield; r2_raw (0.29 for IA wk38) is the
        # share of the yield itself. Saying "of final yield" claims the second
        # while printing the first.
        parts.append(f'{round(ia["r2"]*100)}% of how Iowa&rsquo;s final yield differs from trend ({n_note(ia)})')
    if il:
        parts.append(f'{round(il["r2"]*100)}% of Illinois&rsquo;s ({n_note(il)})')
    if top and top["st"] not in ("IA", "IL"):
        parts.append(f'{round(top["r2"]*100)}% of {esc(top["name"])}&rsquo;s ({n_note(top)})')
    bits.append(", ".join(parts))
    if il:
        bits.append(f' &middot; by week {il["peak_wk"]} Illinois peaks at {round(il["peak_r2"]*100)}% '
                    f'(n={il["peak_n"]} yrs)')
    bits.append(f' &middot; fits vs detrended yield, 2000&ndash;{(yr or 2026) - 1}, '
                f'n&ge;{data.get("min_n", 15)} &middot; data refreshed {stamp_date(data)}')
    return "".join(bits)


def stamp_date(data):
    return (data.get("generated") or "")[:10] or "unknown"


def faq_answer(rows):
    ia = pick(rows, "IA")
    top = rows[0] if rows else None
    if not ia or not top:
        return None
    miss = (f", missing {', '.join(str(y) for y in ia['missing'])}" if ia.get("missing") else "")
    cmp = (f" The two weeks rest on different years ({ia['n']} vs {ia['peak_n']}), so the gap "
           f"between them is partly a change of sample, not only of signal." if mixed_n(ia) else "")
    return (f"Partially, late, and it depends where you farm. In week {ia['week']}, the "
            f"Good+Excellent share explains about {round(ia['r2'] * 100)}% of how Iowa's final corn "
            f"yield differs from its trend ({ia['n']} years{miss}). Iowa's fit peaks at week "
            f"{ia['peak_wk']}, at about {round(ia['peak_r2'] * 100)}% ({ia['peak_n']} years).{cmp} "
            f"In {top['name']}, this week's ratings already explain {round(top['r2'] * 100)}% "
            f"({top['n']} years). This page computes the number for every state and week "
            f"instead of asserting it.")


def meta_desc(rows):
    ia = pick(rows, "IA")
    top = rows[0] if rows else None
    if not ia or not top:
        return None
    # Same sentence scripts/bake_seo.py writes (its seo_cond_yield); the two
    # used to differ and the daily bake flipped the page. Keep them identical.
    if not ia.get("peak_n"):
        return None
    return (f"Iowa corn: Good+Excellent in its best week (week {ia['peak_wk']}) explains "
            f"{ia['peak_r2'] * 100:.0f}% of yield deviation ({ia['peak_n']} years, "
            f"in-sample R\u00b2). Every state and week shown.")


# ── splice + gauntlet ─────────────────────────────────────────────────────

def splice(html, name, body, opener=None, closer=None):
    a = opener or f"<!-- CY:{name} -->"
    b = closer or f"<!-- /CY:{name} -->"
    pat = re.compile(re.escape(a) + r".*?" + re.escape(b), re.S)
    assert len(pat.findall(html)) == 1, f"marker {name}: expected exactly 1 region"
    return pat.sub(lambda _: a + body + b, html)


class DivBalance(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.depth = 0
        self.bad = False

    def handle_starttag(self, t, a):
        if t == "div":
            self.depth += 1

    def handle_endtag(self, t):
        if t == "div":
            self.depth -= 1
            if self.depth < 0:
                self.bad = True


def bake_faq(html, rows):
    """Rewrite the FAQ answer by editing the parsed JSON-LD.

    A text marker cannot be used: the answer lives inside a JSON string, so
    marker comments would end up in the answer search engines read.
    """
    ans = faq_answer(rows)
    if ans is None:
        return html
    m = re.search(r'(<script type="application/ld\+json">)(.*?)(</script>)', html, re.S)
    assert m, "JSON-LD block missing"
    doc = json.loads(m.group(2))
    nodes = doc.get("@graph", [doc]) if isinstance(doc, dict) else doc
    hit = 0
    for n in nodes:
        if n.get("@type") != "FAQPage":
            continue
        for q in n.get("mainEntity", []):
            if "predict" in q.get("name", "").lower() or "ratings" in q.get("name", "").lower():
                q["acceptedAnswer"]["text"] = ans
                hit += 1
                break
    assert hit == 1, f"expected exactly 1 FAQ answer to update, matched {hit}"
    assert "<" not in ans, "a < inside a script block would end it early"
    body = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    out = html[:m.start()] + m.group(1) + body + m.group(3) + html[m.end():]
    # The visible answer must be the same string as the markup. It was
    # hand-written once and drifted (week 28 / North Carolina vs the baked schema).
    vis = re.compile(r'(<summary>Do USDA crop condition ratings actually predict final yield\?</summary>'
                     r'<div class="lt-faq-a">)[^<]*(</div>)')
    assert len(vis.findall(out)) == 1, "expected exactly 1 visible FAQ answer to update"
    return vis.sub(lambda v: v.group(1) + H.escape(ans, quote=False) + v.group(2), out)


def gauntlet(html, rows):
    p = DivBalance()
    p.feed(html)
    assert not p.bad and p.depth == 0, "div balance broken"
    m = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    assert m, "JSON-LD block missing"
    json.loads(m.group(1))
    baked_rows = html.count('class="cy-sel"')
    assert baked_rows == len(rows), \
        f"table baked {baked_rows} rows, expected {len(rows)}"
    assert html.count('class="cy-stat"') == 4, "expected exactly 4 hero tiles"
    for cp in html:
        assert not (0x1F300 <= ord(cp) <= 0x1FAFF), f"emoji {cp!r} in output"


def validate(rows):
    assert rows, "no scoreable states in fit.json"
    weeks = {r["week"] for r in rows}
    assert len(weeks) <= 3, f"states disagree wildly on the latest week: {sorted(weeks)}"
    for r in rows:
        assert 0.0 <= r["r2"] <= 1.0, f"{r['st']}: r2 {r['r2']} out of range"
        assert 0.0 <= r["peak_r2"] <= 1.0, f"{r['st']}: peak r2 {r['peak_r2']} out of range"
        assert r["peak_r2"] + 1e-9 >= r["r2"], f"{r['st']}: peak below current"
        assert r["n"] is None or r["n"] >= 1, f"{r['st']}: n {r['n']}"
        assert 1 <= r["week"] <= 53, f"{r['st']}: week {r['week']}"


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else f"  -- {detail}"))
        if not ok:
            fails.append(name)

    data = {"min_n": 15, "generated": "2026-10-06T00:00:00Z", "crops": {"corn": {"states": {
        "IA": {"latest": {"year": 2026, "week": 40}, "weeks": {
            "39": {"r2": 0.641, "n": 26, "slope": 0.66}, "40": {"r2": 0.357, "n": 22, "slope": 0.48}}},
        "TN": {"latest": {"year": 2026, "week": 40}, "weeks": {
            "40": {"r2": 0.904, "n": 22, "slope": 0.71}}}}}}}
    yrs = [y for y in range(2000, 2026) if y not in (2000, 2012, 2013, 2025)]
    pairs = {"crops": {"corn": {"week": 40, "states": {"IA": [[y, 60, 180] for y in yrs]}}}}
    rows = attach_years(rows_for(data, "corn"), pairs)
    ia = pick(rows, "IA")
    ck("missing years named from the same-week pairs", ia["missing"] == [2000, 2012, 2013, 2025], ia["missing"])
    ck("a state without pairs gets n and no invented years", pick(rows, "TN")["missing"] is None)
    tiles = render_tiles(data, rows)
    ck("tile prints n beside this week's R2", "n=22 yrs; no 2000, 2012, 2013, 2025" in tiles, tiles)
    ck("tile says the two weeks rest on different years", "22 vs 26" in tiles, tiles)
    ck("peak tile prints its own n", "n=26 yrs" in tiles, tiles)
    ck("seed prints n", "n=22 yrs" in render_seed(data, rows))
    faq = faq_answer(rows)
    ck("FAQ prints both n and names the gap", "22 years, missing 2000" in faq and "26 years" in faq, faq)
    stale = attach_years(rows_for(data, "corn"), {"crops": {"corn": {"week": 39, "states": pairs["crops"]["corn"]["states"]}}})
    ck("pairs from another week name nothing", pick(stale, "IA")["missing"] is None)
    print("build_condyield selftest: " + ("all passed" if not fails else f"{len(fails)} FAILED"))
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--html", default=None)
    ap.add_argument("--json", default=None)
    ap.add_argument("--pairs", default=None)
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        return selftest()

    root = Path(__file__).resolve().parent.parent
    html_path = Path(args.html) if args.html else root / "conditions-yield.html"
    json_path = Path(args.json) if args.json else root / "data" / "cond-yield" / "fit.json"

    data = json.loads(json_path.read_text(encoding="utf-8"))
    rows = rows_for(data, "corn")
    validate(rows)
    pairs_path = Path(args.pairs) if args.pairs else json_path.parent / "pairs.json"
    try:
        pairs = json.loads(pairs_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        pairs = None
    attach_years(rows, pairs)

    html = html_path.read_text(encoding="utf-8")
    baked = splice(html, "table", render_table(rows))
    baked = splice(baked, "tiles", render_tiles(data, rows))
    baked = splice(baked, "seed", render_seed(data, rows),
                   opener="<!--SEED:cystats-->", closer="<!--/SEED-->")
    baked = splice(baked, "stamp", f"Data refreshed {stamp_date(data)}.")
    # THE DESCRIPTION IS NOT THIS BAKER'S ANY MORE (2026-10-10). The page leads
    # with every 2026 yield forecast now and scripts/bake_seo.py (seo_cond_yield)
    # writes its title and description from data/yield-panel.json. Two writers
    # flipped this page every day once already.
    md = None
    if md:
        pat = re.compile(
            r'((?:<meta name="description"|<meta property="og:description"'
            r'|<meta name="twitter:description") content=")[^"]*(">)')
        # og: and twitter: carried the old sentence while name="description"
        # was corrected, so every social share rendered the wording this
        # baker exists to fix. The old assert checked for exactly 1 and read
        # as proof of coverage.
        assert len(pat.findall(baked)) == 3, "expected description, og:description, twitter:description"
        baked = pat.sub(lambda m: m.group(1) + md + m.group(2), baked)
    baked = bake_faq(baked, rows)

    gauntlet(baked, rows)

    if baked == html:
        print("conditions-yield.html already in sync.")
        return 0
    if args.check:
        print("conditions-yield.html OUT OF SYNC with fit.json — run the baker.")
        return 1
    html_path.write_text(baked, encoding="utf-8")
    top = rows[0]
    print(f"Baked conditions-yield.html — week {top['week']}, {len(rows)} states, "
          f"top {top['name']} {round(top['r2']*100)}%.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
