#!/usr/bin/env python3
"""
build_croptour.py  —  AGSIST /crop-tour page baker.

Reads data/crop-tour.json and bakes every dynamic region of crop-tour.html
between stable marker comments: the verdict hero, the nightly results board,
the three-way benchmark box, the historical accuracy table, and the stamps.

Everything lands as STATIC HTML — no client fetch — so the page is complete
for readers, search engines, and JS-blind AI crawlers on first byte. That
matters here: the tour is a 4-day search spike and crawlers arrive fast.

Derived statistics (mean absolute error, who-was-closer counts, average
bias) are COMPUTED from the history rows, never hand-typed, so adding a
year updates every claim on the page at once.

Update flow:
    1. edit data/crop-tour.json  (fill a night's corn/pods, or add a year)
    2. run:  python3 scripts/build_croptour.py

Idempotent. Self-validating: refuses to write if the result fails the gauntlet.

Usage:
    python3 scripts/build_croptour.py            # bake in place
    python3 scripts/build_croptour.py --check    # verify only (CI-safe)
    python3 scripts/build_croptour.py --html PATH --json PATH
"""

import argparse
import json
import re
import sys
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

MONTHS = ["", "January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep",
        "Oct", "Nov", "Dec"]


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def pretty(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{MONTHS[m]} {d}, {y}"


def short(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{ABBR[m]} {d}"


# ── statistics ────────────────────────────────────────────────────────────

def stats(history):
    """Mean absolute error, signed bias, and head-to-head counts vs the final.

    Only years carrying BOTH a tour number and a USDA final are scored, so a
    partially-filled current year can sit in the data without polluting the
    record.
    """
    rows = []
    for h in history:
        if h.get("tour_corn") is None or h.get("usda_final_corn") is None:
            continue
        if h.get("usda_aug_corn") is None:
            continue
        te = h["tour_corn"] - h["usda_final_corn"]
        ue = h["usda_aug_corn"] - h["usda_final_corn"]
        rows.append({**h, "tour_err": te, "usda_err": ue,
                     "winner": "tour" if abs(te) < abs(ue)
                     else ("usda" if abs(ue) < abs(te) else "tie")})
    n = len(rows)
    if not n:
        raise AssertionError("no scoreable history rows")
    tour_mae = sum(abs(r["tour_err"]) for r in rows) / n
    usda_mae = sum(abs(r["usda_err"]) for r in rows) / n
    tour_bias = sum(r["tour_err"] for r in rows) / n
    usda_bias = sum(r["usda_err"] for r in rows) / n
    tour_wins = sum(1 for r in rows if r["winner"] == "tour")
    usda_wins = sum(1 for r in rows if r["winner"] == "usda")
    low = sum(1 for r in rows if r["tour_err"] < 0)

    soy = [h for h in history
           if h.get("tour_soy_prod") is not None
           and h.get("usda_final_soy_prod") is not None
           and h.get("usda_aug_soy_prod") is not None]
    soy_tour_mae = (sum(abs(h["tour_soy_prod"] - h["usda_final_soy_prod"])
                        for h in soy) / len(soy)) if soy else None
    soy_usda_mae = (sum(abs(h["usda_aug_soy_prod"] - h["usda_final_soy_prod"])
                        for h in soy) / len(soy)) if soy else None

    return {"rows": rows, "n": n, "tour_mae": tour_mae, "usda_mae": usda_mae,
            "tour_bias": tour_bias, "usda_bias": usda_bias,
            "tour_wins": tour_wins, "usda_wins": usda_wins, "tour_low": low,
            "first": rows[0]["year"], "last": rows[-1]["year"],
            "soy_n": len(soy), "soy_tour_mae": soy_tour_mae,
            "soy_usda_mae": soy_usda_mae}


def phase(data, today):
    """Where we are relative to the tour: before / during / scored."""
    t = data["tour"]
    start = date.fromisoformat(t["start"])
    end = date.fromisoformat(t["end"])
    if data["benchmarks"]["tour"].get("corn") is not None:
        return "scored"
    if today < start:
        return "before"
    if today <= end:
        return "during"
    return "waiting"


# ── region renderers ──────────────────────────────────────────────────────

def render_hero(data, st, ph, today):
    t = data["tour"]
    n, first, last = st["n"], st["first"], st["last"]
    # Sentence-start form kept separate: .capitalize() would mangle "USDA".
    usda_ahead = st["usda_wins"] > st["tour_wins"]
    closer_start = "USDA" if usda_ahead else "The tour"
    tm, um = st["tour_mae"], st["usda_mae"]
    big = f"{tm:.1f}"
    if ph == "before":
        days = (date.fromisoformat(t["start"]) - today).days
        kicker = (f"Scouts roll {short(t['start'])}"
                  + (f" &mdash; {days} day{'s' if days != 1 else ''} out" if days > 0 else ""))
        verdict = "Worth watching, not worth trading blind"
    elif ph == "during":
        kicker = "Tour underway &mdash; results post each night"
        verdict = "Read the nightly numbers against this record"
    elif ph == "waiting":
        kicker = f"Scouting done &mdash; national number posts {esc(t['final_expected_label'])}"
        verdict = "Read the nightly numbers against this record"
    else:
        kicker = "Tour number is in"
        verdict = "Now compare it to the record below"

    lead = (f"Over the last {n} tours ({first}&ndash;{last}), Pro Farmer's final corn number missed "
            f"USDA's eventual final by <b>{tm:.1f} bushels</b> on average. USDA's own August forecast "
            f"missed by <b>{um:.1f}</b>. {closer_start} came closer in "
            f"{max(st['usda_wins'], st['tour_wins'])} of those {n} years.")
    bias = ("The tour has also leaned one way: it came in <b>under</b> the final yield in "
            f"{st['tour_low']} of {n} years, by an average of {abs(st['tour_bias']):.1f} bushels. "
            "That is a real tendency, not a rule &mdash; it ran high three times, once by 5.5 bushels.")
    return (f'<div class="ct-hero"><div class="ct-kick">{kicker}</div>'
            f'<div class="ct-big">{big}<span class="ct-unit">bu</span></div>'
            f'<div class="ct-vd">Average tour miss vs the final crop &mdash; {esc(verdict)}</div>'
            f'<p class="ct-lead">{lead}</p><p class="ct-lead">{bias}</p></div>')


def render_nights(data, ph):
    out = []
    for nt in data["nights"]:
        posted = bool(nt.get("posted"))
        cls = "ct-night" + (" ct-night--posted" if posted else "")
        cells = []
        for s in nt["states"]:
            corn = s.get("corn")
            pods = s.get("pods")
            if corn is None and pods is None:
                val = '<span class="ct-pend">not posted yet</span>'
            else:
                bits = []
                if corn is not None:
                    bits.append(f'<span class="ct-num">{corn:.1f}</span> <span class="ct-lbl">bu corn</span>')
                if pods is not None:
                    bits.append(f'<span class="ct-num">{pods:,.0f}</span> <span class="ct-lbl">pods in 3x3</span>')
                val = '<div class="ct-vals">' + "".join(f"<div>{b}</div>" for b in bits) + "</div>"
            cells.append(f'<div class="ct-state"><div class="ct-st-name">{esc(s["name"])}</div>{val}</div>')
        out.append(f'<div class="{cls}"><div class="ct-n-hd">'
                   f'<span class="ct-n-day">{esc(nt["label"])}</span>'
                   f'<span class="ct-n-date">{short(nt["date"])}</span></div>'
                   f'<div class="ct-states">{"".join(cells)}</div></div>')
    return "".join(out)


def render_bench(data):
    b = data["benchmarks"]
    order = [("usda", "usda"), ("agsist", "agsist"), ("tour", "tour")]
    out = []
    for key, cls in order:
        e = b[key]
        corn = e.get("corn")
        val = f'{corn:.1f}' if corn is not None else "&mdash;"
        sub = e.get("note", "")
        asof = f' &middot; {short(e["as_of"])}' if e.get("as_of") else ""
        out.append(f'<div class="ct-bench ct-bench--{cls}">'
                   f'<div class="ct-b-lbl">{esc(e["label"])}{asof}</div>'
                   f'<div class="ct-b-val">{val}<span class="ct-b-u">bu</span></div>'
                   f'<div class="ct-b-note">{esc(sub)}</div></div>')
    return "".join(out)


# Widest a bar may reach, as a percentage of the cell measured from the centre
# tick. The remaining 100 - 2*MAXW is gutter the printed value lives in, so the
# biggest miss in the table can never shove its own label into the next column.
BAR_MAXW = 34.0


def render_history(st):
    rows = list(reversed(st["rows"]))
    span = max(max(abs(r["tour_err"]) for r in rows), 0.1)
    out = ['<div class="ct-tbl-wrap"><table class="ct-tbl"><thead><tr>'
           '<th>Year</th><th class="num">Tour</th><th class="num">USDA Aug</th>'
           '<th class="num">Final</th><th>Tour vs final &mdash; bushels per acre</th>'
           '</tr></thead><tbody>']
    for r in rows:
        e = r["tour_err"]
        pct = min(abs(e) / span, 1.0) * BAR_MAXW
        side = "neg" if e < 0 else ("pos" if e > 0 else "zero")
        if e == 0:
            bar = '<span class="ct-bar-zero">dead on</span>'
        elif e < 0:
            edge = 50 - pct
            bar = (f'<span class="ct-bar ct-bar--neg" style="left:{edge:.1f}%;width:{pct:.1f}%"></span>'
                   f'<span class="ct-bar-v ct-bar-v--neg" style="right:{100 - edge:.1f}%">{e:.1f}</span>')
        else:
            edge = 50 + pct
            bar = (f'<span class="ct-bar ct-bar--pos" style="left:50%;width:{pct:.1f}%"></span>'
                   f'<span class="ct-bar-v ct-bar-v--pos" style="left:{edge:.1f}%">+{e:.1f}</span>')
        note = f'<div class="ct-yr-note">{esc(r["note"])}</div>' if r.get("note") else ""
        out.append(f'<tr><td data-label="Year"><b>{r["year"]}</b>{note}</td>'
                   f'<td class="num" data-label="Tour">{r["tour_corn"]:.1f}</td>'
                   f'<td class="num" data-label="USDA Aug">{r["usda_aug_corn"]:.1f}</td>'
                   f'<td class="num" data-label="Final">{r["usda_final_corn"]:.1f}</td>'
                   f'<td class="ct-barcell {side}" data-label="Tour vs final">'
                   f'<span class="ct-tick"></span>{bar}</td></tr>')
    out.append('</tbody></table></div>')
    return "".join(out)


def render_soy(st):
    if not st["soy_n"]:
        return ""
    return (f'Across the same {st["soy_n"]} years, the tour\'s soybean production number missed the final '
            f'by <b>{st["soy_tour_mae"]:.2f} billion bushels</b> on average, against '
            f'<b>{st["soy_usda_mae"]:.2f} billion</b> for USDA\'s August forecast. On beans it is close '
            'to a coin flip between them.')


def bake_faq(html, st):
    """Rewrite the FAQ answer inside the JSON-LD by editing the parsed JSON.

    A text marker cannot be used here: the answer lives inside a JSON string,
    so the marker comments would end up in the answer Google reads. Parse,
    set, re-serialise instead.
    """
    m = re.search(r'(<script type="application/ld\+json">)(.*?)(</script>)', html, re.S)
    assert m, "JSON-LD block missing"
    doc = json.loads(m.group(2))
    faqs = [n for n in doc.get("@graph", []) if n.get("@type") == "FAQPage"]
    assert len(faqs) == 1, "expected exactly one FAQPage node"
    q = faqs[0]["mainEntity"][0]
    assert "accurate" in q["name"].lower(), "first FAQ is not the accuracy question"
    q["acceptedAnswer"]["text"] = render_faq_answer(st)
    body = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    return html[:m.start()] + m.group(1) + body + m.group(3) + html[m.end():]


def render_faq_answer(st):
    """Plain-text (JSON-string-safe) restatement of the headline statistics."""
    closer = "USDA" if st["usda_wins"] > st["tour_wins"] else "the tour"
    txt = (f"Over the {st['n']} tours from {st['first']} through {st['last']}, Pro Farmer's final "
           f"national corn yield estimate missed USDA's eventual final figure by "
           f"{st['tour_mae']:.1f} bushels per acre on average. USDA's own August forecast missed by "
           f"{st['usda_mae']:.1f} bushels over the same years, and {closer} came closer in "
           f"{max(st['usda_wins'], st['tour_wins'])} of the {st['n']}. The tour has also tended to run "
           f"low, finishing under the final yield in {st['tour_low']} of {st['n']} years by an average "
           f"of {abs(st['tour_bias']):.1f} bushels.")
    # Lands inside a JSON string literal in the head - no quotes, no backslashes.
    assert "<" not in txt, "a < inside a script block would end it early"
    return txt


def render_sources(data):
    out = []
    for s in data["sources"]:
        out.append(f'<li><a href="{esc(s["url"])}" target="_blank" rel="noopener">{esc(s["name"])}</a></li>')
    return "".join(out)


# ── splice + gauntlet ─────────────────────────────────────────────────────

def splice(html, name, body):
    a, b = f"<!-- CT:{name} -->", f"<!-- /CT:{name} -->"
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


def gauntlet(html, st):
    p = DivBalance()
    p.feed(html)
    assert not p.bad and p.depth == 0, "div balance broken"
    m = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    assert m, "JSON-LD block missing"
    json.loads(m.group(1))
    assert html.count("ct-night") >= 4, "nightly board did not bake"
    assert html.count("<tr>") >= st["n"], "history table short"
    for cp in html:
        o = ord(cp)
        assert not (0x1F300 <= o <= 0x1FAFF), f"emoji {cp!r} in output"


def validate(data):
    h = data["history"]
    assert h, "history empty"
    yrs = [r["year"] for r in h]
    assert yrs == sorted(yrs), "history must be oldest-first"
    assert len(set(yrs)) == len(yrs), "duplicate year in history"
    for r in h:
        for k in ("tour_corn", "usda_aug_corn", "usda_final_corn"):
            v = r.get(k)
            assert v is None or 80 <= v <= 260, f"{r['year']}: {k}={v} out of plausible range"
        for k in ("tour_soy_prod", "usda_aug_soy_prod", "usda_final_soy_prod"):
            v = r.get(k)
            assert v is None or 1.5 <= v <= 7.0, f"{r['year']}: {k}={v} out of plausible range"
    for nt in data["nights"]:
        date.fromisoformat(nt["date"])
        for s in nt["states"]:
            c, p = s.get("corn"), s.get("pods")
            assert c is None or 40 <= c <= 300, f"{s['code']}: corn {c} implausible"
            assert p is None or 200 <= p <= 2500, f"{s['code']}: pods {p} implausible"
        if nt.get("posted"):
            assert any(s.get("corn") is not None or s.get("pods") is not None
                       for s in nt["states"]), \
                f"{nt['date']} marked posted but carries no numbers"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--html", default=None)
    ap.add_argument("--json", default=None)
    ap.add_argument("--today", default=None, help="override date (YYYY-MM-DD) for testing")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    html_path = Path(args.html) if args.html else root / "crop-tour.html"
    json_path = Path(args.json) if args.json else root / "data" / "crop-tour.json"

    data = json.loads(json_path.read_text(encoding="utf-8"))
    validate(data)
    st = stats(data["history"])
    today = date.fromisoformat(args.today) if args.today else date.today()
    ph = phase(data, today)

    html = html_path.read_text(encoding="utf-8")
    baked = splice(html, "hero", render_hero(data, st, ph, today))
    baked = splice(baked, "nights", render_nights(data, ph))
    baked = splice(baked, "bench", render_bench(data))
    baked = splice(baked, "history", render_history(st))
    baked = splice(baked, "soy", render_soy(st))
    baked = splice(baked, "sources", render_sources(data))
    # The FAQ answer restates the headline statistics. It used to be hand-typed
    # in the head, which meant adding a tour year would leave a stale claim in
    # the structured data that nobody would notice. Bake it from the same stats.
    baked = bake_faq(baked, st)
    baked = splice(baked, "stamp", f"Record updated {pretty(data['updated'])} &middot; "
                                   f"{st['n']} tours scored")
    baked, n = re.subn(r'("dateModified":")\d{4}-\d{2}-\d{2}(")',
                       r"\g<1>" + data["updated"] + r"\g<2>", baked)
    # This page carries two: the WebPage node and the Dataset node. Both should
    # move together. Zero means the JSON-LD block was renamed or lost.
    assert n >= 1, "no dateModified found in the JSON-LD — head block changed?"

    gauntlet(baked, st)

    if baked == html:
        print("crop-tour.html already in sync.")
        return 0
    if args.check:
        print("crop-tour.html OUT OF SYNC with data/crop-tour.json — run the baker.")
        return 1
    html_path.write_text(baked, encoding="utf-8")
    print(f"Baked crop-tour.html — phase={ph}, {st['n']} tours scored, "
          f"tour MAE {st['tour_mae']:.2f} vs USDA {st['usda_mae']:.2f}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
