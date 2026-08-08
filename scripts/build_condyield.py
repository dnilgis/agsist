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
            "peak_slope": peak.get("slope"),
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
        out.append(
            f'<tr><td><button class="cy-sel" data-st="{esc(r["st"])}">{esc(r["name"])}</button></td>'
            f'<td data-v="{r["r2"]:.3f}" style="color:{colour(r["r2"])}">{round(r["r2"]*100)}%</td>'
            f'<td data-v="{r["peak_r2"]:.3f}">{round(r["peak_r2"]*100)}% '
            f'<span class="mut" style="font-size:0.775rem">wk {r["peak_wk"]}</span></td>'
            f'<td data-v="{sv:.3f}">{slope}</td>'
            f'<td data-v="{r["n"]}">{r["n"]}</td></tr>')
    return "".join(out)


def pick(rows, st):
    for r in rows:
        if r["st"] == st:
            return r
    return None


def render_tiles(data, rows):
    ia = pick(rows, "IA")
    top = rows[0] if rows else None
    wk = rows[0]["week"] if rows else None
    t = []
    if ia:
        t.append(f'<div class="cy-stat"><div class="v">{round(ia["r2"]*100)}%</div>'
                 f'<div class="l">Iowa corn, this week (wk {ia["week"]})</div>'
                 f'<div class="s">of final yield explained by G+E</div></div>')
        t.append(f'<div class="cy-stat"><div class="v">{round(ia["peak_r2"]*100)}%</div>'
                 f'<div class="l">Iowa corn by week {ia["peak_wk"]}</div>'
                 f'<div class="s">the season seals it late</div></div>')
    if top:
        t.append(f'<div class="cy-stat"><div class="v">{round(top["r2"]*100)}%</div>'
                 f'<div class="l">{esc(top["name"])}, this week</div>'
                 f'<div class="s">the clearest read in the country right now</div></div>')
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
        parts.append(f'{round(ia["r2"]*100)}% of Iowa&rsquo;s final yield')
    if il:
        parts.append(f'{round(il["r2"]*100)}% of Illinois&rsquo;s')
    if top and top["st"] not in ("IA", "IL"):
        parts.append(f'{round(top["r2"]*100)}% of {esc(top["name"])}&rsquo;s')
    bits.append(", ".join(parts))
    if il:
        bits.append(f' &middot; by week {il["peak_wk"]} Illinois peaks at {round(il["peak_r2"]*100)}%')
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
    return (f"Partially, late, and it depends where you farm. In week {ia['week']}, the "
            f"Good+Excellent share explains about {round(ia['r2'] * 100)}% of Iowa's final corn "
            f"yield variation - but by week {ia['peak_wk']} it explains roughly "
            f"{round(ia['peak_r2'] * 100)}%. In {top['name']}, this week's ratings already explain "
            f"{round(top['r2'] * 100)}%. This page computes the number for every state and week "
            f"instead of asserting it.")


def meta_desc(rows):
    ia = pick(rows, "IA")
    top = rows[0] if rows else None
    if not ia or not top:
        return None
    return (f"Corn ratings in week {ia['week']} explain {round(ia['r2']*100)}% of Iowa's final "
            f"yield. By week {ia['peak_wk']}: {round(ia['peak_r2']*100)}%. The real R&sup2; of G+E "
            f"vs yield, every state, every week, from USDA data.")


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
    return html[:m.start()] + m.group(1) + body + m.group(3) + html[m.end():]


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--html", default=None)
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    html_path = Path(args.html) if args.html else root / "conditions-yield.html"
    json_path = Path(args.json) if args.json else root / "data" / "cond-yield" / "fit.json"

    data = json.loads(json_path.read_text(encoding="utf-8"))
    rows = rows_for(data, "corn")
    validate(rows)

    html = html_path.read_text(encoding="utf-8")
    baked = splice(html, "table", render_table(rows))
    baked = splice(baked, "tiles", render_tiles(data, rows))
    baked = splice(baked, "seed", render_seed(data, rows),
                   opener="<!--SEED:cystats-->", closer="<!--/SEED-->")
    baked = splice(baked, "stamp", f"Data refreshed {stamp_date(data)}.")
    md = meta_desc(rows)
    if md:
        pat = re.compile(r'(<meta name="description" content=")[^"]*(">)')
        assert len(pat.findall(baked)) == 1, "expected exactly 1 meta description"
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
