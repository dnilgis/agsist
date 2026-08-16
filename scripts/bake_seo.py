#!/usr/bin/env python3
"""
AGSIST — bake the answer into the title and the description.

WHY THIS EXISTS
The 2026-08-16 export said the traffic problem is not ranking any more. Google
impressions grew 230% in a month and click-through did not move at all: 1.30%
to 1.28%, with average position improving 13.5 to 10.3. The pages sitting in
the top ten are the ones being ignored.

    /usda-calendar      9,017 impressions  position 7.8   CTR 0.33%
    /usda-quick-stats   7,310              position 6.5   CTR 0.18%
    /cot                1,952              position 7.4   CTR 0.41%
    /breakeven          1,295              position 7.2   CTR 0.69%
    /crop-tour            471              position 7.0   CTR 0.42%

At position 7 a normal click-through is 2-4%. And the same shape shows in the
Bing-style report: 31 keywords holding a top-ten position with 24,682
impressions and 177 clicks between them.

The diagnosis is that these titles describe a TOOL and the searcher wants an
ANSWER. Somebody searching "wasde report schedule" against usda.gov in the same
result set does not pick "USDA Report Calendar 2026". They pick the one showing
the date.

So: lead with the answer, keep the keyword. Every title and description here is
computed from a live data file, which is the only way it can say a real number
and still be true next week. A page whose data is missing keeps whatever it has
-- this script never writes a placeholder, because a stale confident title is
worse than a dull accurate one.

RAILS
  - title <= TITLE_MAX chars, description <= DESC_MAX (the new-page checklist's
    160), both asserted before anything is written
  - no double quotes anywhere near a content= attribute
  - a computed date that has already passed is a bug, not a title: refuse
  - missing or unreadable data for a page skips that page loudly
  - --selftest runs offline against synthetic data and plants known failures

Stamps <title>, meta description, og:title, og:description, twitter:title and
twitter:description, so the SERP, the share card and the assistant summary all
say the same thing.
"""
import argparse
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"
sys.path.insert(0, str(REPO / "scripts"))

TITLE_MAX = 68          # Google truncates around 600px; 68 chars is a safe ceiling
DESC_MAX = 160          # the site's own new-page checklist
SUFFIX = " | AGSIST"

MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def mdY(d):
    return f"{MONTHS[d.month - 1][:3]} {d.day}, {d.year}"


def span(a, b):
    """Aug 17-20, 2026 — not Aug 17, 2026-Aug 20, 2026. Descriptions have a
    160-character cap and a repeated year is the cheapest thing to give up."""
    if a.year == b.year and a.month == b.month:
        return f"{MONTHS[a.month - 1][:3]} {a.day}\u2013{b.day}, {a.year}"
    if a.year == b.year:
        return f"{MONTHS[a.month - 1][:3]} {a.day}\u2013{MONTHS[b.month - 1][:3]} {b.day}, {a.year}"
    return f"{mdY(a)}\u2013{mdY(b)}"


# ---------------------------------------------------------------- context

def _load(name):
    p = DATA / name
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:                                     # noqa: BLE001
        return None


def build_ctx(today):
    import usda_dates
    return {
        "today": today,
        "next_wasde": usda_dates.next_wasde(today),
        "cot": _load("cot.json"),
        "state_stats": _load("state-stats.json"),
        "crop_tour": _load("crop-tour.json"),
        "prices": _load("prices.json"),
    }


# ---------------------------------------------------------------- builders
# Each returns (title, description) or None to skip the page. Raising is fine:
# main() catches, reports and leaves the page alone.

def seo_usda_calendar(c):
    w = c["next_wasde"]
    if not w:
        return None
    if w < c["today"]:
        raise ValueError(f"next_wasde returned {w}, already in the past")
    days = (w - c["today"]).days
    when = "today" if days == 0 else ("tomorrow" if days == 1 else f"in {days} days")
    return (f"Next WASDE: {mdY(w)} — USDA Report Calendar{SUFFIX}",
            f"The next WASDE lands {mdY(w)}, {when}. Every 2026 USDA report date "
            f"— WASDE, Crop Production, Grain Stocks, Cattle on Feed — with what "
            f"each one moves.")


def _cot_side(net):
    return "long" if net >= 0 else "short"


def seo_cot(c):
    d = c["cot"]
    if not d or "corn" in d and not isinstance(d.get("corn"), dict):
        return None
    corn = (d or {}).get("corn")
    if not corn or corn.get("net") is None:
        return None
    net = int(corn["net"])
    side = _cot_side(net)
    k = abs(net) / 1000.0
    kk = f"{k:,.0f}k" if k >= 10 else f"{k:,.1f}k"
    rpt = d.get("report_date") or ""
    prev = corn.get("prev")
    move = ""
    if isinstance(prev, (int, float)):
        delta = net - int(prev)
        if delta:
            move = (f" Funds {'added' if (delta > 0) == (net >= 0) else 'cut'} "
                    f"{abs(delta):,} contracts week over week.")
    head = (f"Managed money is net {side} {abs(net):,} corn contracts as of "
            f"{rpt}.")
    tail = " Weekly CFTC ag positioning, 11 commodities."
    desc = head + move + tail
    if len(desc) > DESC_MAX:          # the move clause is the optional one
        desc = head + tail
    return (f"Managed Money Is Net {side.title()} Corn {kk} — CFTC COT{SUFFIX}", desc)


def seo_crop_tour(c):
    d = c["crop_tour"]
    if not d or not d.get("tour"):
        return None
    t = d["tour"]
    yr = t.get("year")
    start = date.fromisoformat(t["start"])
    end = date.fromisoformat(t["end"])
    today = c["today"]
    nights = d.get("nights") or []
    posted = [n for n in nights if n.get("posted")]
    if today < start:
        days = (start - today).days
        lead = ("starts tomorrow" if days == 1 else
                "starts today" if days == 0 else f"starts in {days} days")
        return (f"Pro Farmer Crop Tour {yr} {lead.title()} — Nightly Results{SUFFIX}",
                f"The {yr} Pro Farmer Crop Tour runs {span(start, end)}. "
                f"State numbers here every night, next to USDA's and ours, plus "
                f"how close the tour has actually been.")
    if today <= end or not posted:
        n = len(posted)
        return (f"Pro Farmer Crop Tour {yr} — Night {max(n,1)} Results{SUFFIX}",
                f"Pro Farmer Crop Tour {yr} results by state, posted each night "
                f"of {span(start, end)}, next to USDA's number and ours — "
                f"plus the tour's own accuracy record.")
    tour = (d.get("benchmarks") or {}).get("tour") or {}
    if tour.get("corn"):
        return (f"Pro Farmer Crop Tour {yr}: Corn {tour['corn']} bu/ac{SUFFIX}",
                f"Pro Farmer's {yr} national corn estimate is {tour['corn']} "
                f"bu/ac. Set against USDA's number and ours, with how close the "
                f"tour has actually been since 2015.")
    return (f"Pro Farmer Crop Tour {yr} — Results & Accuracy Record{SUFFIX}",
            f"Every night of the {yr} Pro Farmer Crop Tour by state, next to "
            f"USDA's number and ours, plus the record nobody publishes: how "
            f"close the tour has actually been.")


def seo_quick_stats(c):
    d = c["state_stats"]
    if not d or not d.get("stateStats"):
        return None
    ss = d["stateStats"]
    ia = ss.get("IA") or {}
    y = ia.get("corn_yield")
    if y is None:
        return None
    # label it exactly as the file does; never call a forecast a final
    kind = "forecast" if ia.get("forecast") else "final"
    yr = ia.get("year")
    return (f"Corn & Soybean Yields by State — USDA NASS Data{SUFFIX}",
            f"Iowa corn {y:g} bu/ac ({yr} {kind}). Yields, acres, production "
            f"and prices by state for corn, soybeans and wheat — USDA Quick "
            f"Stats, made readable and free.")


def _px(prices, key):
    q = ((prices or {}).get("quotes") or {}).get(key) or (prices or {}).get(key)
    if isinstance(q, dict):
        for f in ("last", "close", "price", "px"):
            if isinstance(q.get(f), (int, float)):
                return float(q[f])
    return None


def seo_breakeven(c):
    px = _px(c["prices"], "corn")
    if px is None:
        return None
    dollars = px / 100.0 if px > 50 else px      # cents vs dollars
    return (f"Break-Even Price Calculator — Corn, Soybeans, Wheat{SUFFIX}",
            f"Corn is near ${dollars:.2f}. Enter your cost per acre and your yield "
            f"to get your break-even price per bushel, and the acres where the "
            f"board stops covering them.")


PAGES = {
    "usda-calendar.html":    seo_usda_calendar,
    "cot.html":              seo_cot,
    "crop-tour.html":        seo_crop_tour,
    "usda-quick-stats.html": seo_quick_stats,
    "breakeven.html":        seo_breakeven,
}


# ---------------------------------------------------------------- stamping

_ENT = {"&": "&amp;", "<": "&lt;", ">": "&gt;"}


def esc(s):
    for a, b in _ENT.items():
        s = s.replace(a, b)
    return s


def check(title, desc, page):
    for label, val, cap in (("title", title, TITLE_MAX), ("description", desc, DESC_MAX)):
        if not val or not val.strip():
            raise ValueError(f"{page}: empty {label}")
        if '"' in val:
            raise ValueError(f'{page}: {label} contains a double quote, which '
                             f'would break the meta attribute: {val!r}')
        if len(val) > cap:
            raise ValueError(f"{page}: {label} is {len(val)} chars, cap is {cap}: {val!r}")


def _meta(attr, val):
    # these pages column-align their attributes, so the gap before content= is a
    # RUN of spaces. A single-space pattern matched 3 of 6 tags and said nothing.
    return re.compile(r'(<meta\s+' + attr + r'="' + val + r'"\s+content=")([^"]*)(")')


TAGS = [
    (re.compile(r"(<title>)(.*?)(</title>)", re.S), "title"),
    (_meta("name", "description"), "desc"),
    (_meta("property", "og:title"), "title"),
    (_meta("property", "og:description"), "desc"),
    (_meta("name", "twitter:title"), "title"),
    (_meta("name", "twitter:description"), "desc"),
]

EXPECT_TAGS = 6


def stamp(text, title, desc):
    vals = {"title": esc(title), "desc": esc(desc)}
    n = 0
    for pat, which in TAGS:
        new, cnt = pat.subn(lambda m: m.group(1) + vals[which] + m.group(3), text, count=1)
        if cnt:
            text, n = new, n + 1
    return text, n


# ---------------------------------------------------------------- main

def run(today, dry=False, only=None):
    ctx = build_ctx(today)
    changed, skipped = [], []
    for page, fn in PAGES.items():
        if only and page != only:
            continue
        p = REPO / page
        if not p.exists():
            skipped.append((page, "file missing")); continue
        try:
            got = fn(ctx)
        except Exception as exc:                          # noqa: BLE001
            skipped.append((page, f"builder raised: {exc}")); continue
        if not got:
            skipped.append((page, "no data — left alone")); continue
        title, desc = got
        try:
            check(title, desc, page)
        except ValueError as exc:
            skipped.append((page, str(exc))); continue
        src = p.read_text(encoding="utf-8")
        out, n = stamp(src, title, desc)
        if n != EXPECT_TAGS:
            skipped.append((page, f"stamped {n} of {EXPECT_TAGS} tags — markup "
                                  f"changed; refusing to half-update"))
            continue
        print(f"\n{page}  ({n} tags)")
        print(f"  title [{len(title):>3}] {title}")
        print(f"  desc  [{len(desc):>3}] {desc}")
        if not dry and out != src:
            p.write_text(out, encoding="utf-8")
            changed.append(page)
        elif out == src:
            print("  (unchanged)")
    print("\n" + "-" * 60)
    print(f"changed {len(changed)}: {', '.join(changed) or 'none'}")
    for pg, why in skipped:
        print(f"skipped {pg}: {why}")
    return 0


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + (f"  — {detail}" if not ok and detail else ""))
        if not ok:
            fails.append(name)

    T = date(2026, 8, 16)
    ctx = {"today": T, "next_wasde": date(2026, 9, 11),
           "cot": {"report_date": "August 11, 2026",
                   "corn": {"net": 125875, "prev": 144821}},
           "crop_tour": {"tour": {"year": 2026, "start": "2026-08-17", "end": "2026-08-20"},
                         "nights": [{"posted": False}] * 4, "benchmarks": {}},
           "state_stats": {"stateStats": {"IA": {"corn_yield": 216.0, "year": 2026,
                                                 "forecast": True}}},
           "prices": {"quotes": {"corn": {"last": 459.0}}}}

    print("titles lead with the answer")
    t, d = seo_usda_calendar(ctx)
    ck("WASDE title leads with the date", t.startswith("Next WASDE: Sep 11, 2026"), t)
    ck("WASDE title keeps the keyword", "USDA Report Calendar" in t, t)
    ck("WASDE description counts the days", "in 26 days" in d, d)

    t, d = seo_cot(ctx)
    ck("COT title states the position", "Net Long Corn 126k" in t, t)
    ck("COT description carries the report date", "August 11, 2026" in d, d)

    t, d = seo_crop_tour(ctx)
    ck("tour title says it starts tomorrow", "Starts Tomorrow" in t, t)
    ctx2 = dict(ctx, today=date(2026, 8, 19),
                crop_tour=dict(ctx["crop_tour"],
                               nights=[{"posted": True}, {"posted": True}, {"posted": False}, {"posted": False}]))
    t2, _ = seo_crop_tour(ctx2)
    ck("mid-tour title counts posted nights", "Night 2 Results" in t2, t2)
    ctx3 = dict(ctx, today=date(2026, 8, 22),
                crop_tour=dict(ctx["crop_tour"], nights=[{"posted": True}] * 4,
                               benchmarks={"tour": {"corn": 179.4}}))
    t3, _ = seo_crop_tour(ctx3)
    ck("after the tour the title carries the number", "Corn 179.4 bu/ac" in t3, t3)

    print("\nhonesty")
    t, d = seo_quick_stats(ctx)
    ck("a forecast is called a forecast, never a final", "2026 forecast" in d, d)
    ctx4 = dict(ctx, state_stats={"stateStats": {"IA": {"corn_yield": 211.0, "year": 2025,
                                                        "forecast": False}}})
    _, d4 = seo_quick_stats(ctx4)
    ck("a final is called a final", "2025 final" in d4, d4)

    print("\nrails")
    try:
        seo_usda_calendar(dict(ctx, next_wasde=date(2026, 1, 1)))
        ck("a WASDE date in the past raises", False, "it returned a title")
    except ValueError:
        ck("a WASDE date in the past raises", True)
    ck("no data means skip, not a placeholder",
       seo_cot(dict(ctx, cot=None)) is None and
       seo_quick_stats(dict(ctx, state_stats=None)) is None and
       seo_breakeven(dict(ctx, prices=None)) is None)
    try:
        check('He said "hello"', "fine", "x.html"); ck("a double quote is refused", False)
    except ValueError:
        ck("a double quote is refused", True)
    try:
        check("t" * (TITLE_MAX + 1), "fine", "x.html"); ck("an over-long title is refused", False)
    except ValueError:
        ck("an over-long title is refused", True)
    try:
        check("fine", "d" * (DESC_MAX + 1), "x.html"); ck("an over-long description is refused", False)
    except ValueError:
        ck("an over-long description is refused", True)

    print("\nevery live builder fits the caps")
    for page, fn in PAGES.items():
        got = fn(ctx)
        if not got:
            ck(f"{page} produced output", False, "returned None"); continue
        try:
            check(got[0], got[1], page); ck(f"{page} within caps", True)
        except ValueError as exc:
            ck(f"{page} within caps", False, str(exc))

    print("\nstamping")
    html = ('<title>Old</title>\n<meta name="description" content="old">\n'
            '<meta property="og:title" content="old">\n'
            '<meta property="og:description" content="old">\n'
            '<meta name="twitter:title" content="old">\n'
            '<meta name="twitter:description" content="old">')
    out, n = stamp(html, "New & Fresh", "Desc & more")
    ck("all six tags stamped", n == EXPECT_TAGS, str(n))
    aligned = ('<title>Old</title>\n<meta name="description"      content="old">\n'
               '<meta property="og:title"        content="old">\n'
               '<meta property="og:description"  content="old">\n'
               '<meta name="twitter:title"       content="old">\n'
               '<meta name="twitter:description" content="old">')
    ck("column-aligned attributes stamp too (the live markup)",
       stamp(aligned, "T", "D")[1] == EXPECT_TAGS, str(stamp(aligned, "T", "D")[1]))
    ck("ampersands escaped", out.count("&amp;") == 6, out)
    ck("idempotent", stamp(out, "New & Fresh", "Desc & more")[0] == out)

    print()
    if fails:
        print(f"{len(fails)} FAILED: " + "; ".join(fails))
        return 1
    print("all bake_seo checks pass")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--page", default=None)
    ap.add_argument("--today", default=None, help="YYYY-MM-DD, for tests")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    today = date.fromisoformat(a.today) if a.today else date.today()
    return run(today, dry=a.dry_run, only=a.page)


if __name__ == "__main__":
    sys.exit(main())
