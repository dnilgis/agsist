#!/usr/bin/env python3
"""build_state_yield_pages.py -- per-state crop yield history, /yield/<state>.

OFFLINE. Reads committed files only, writes yield/<state>.html and
yield/_indexable.txt. MACHINE-OWNED: edit this script, never yield/*.html.

SOURCES (all USDA NASS Quick Stats, as pulled by scripts/build_nass_series.py
and scripts/build_state_stats.py; the Atlas county yields by
scripts/build_farmland_atlas.py)
  data/nass/corn-yield.json   CORN, GRAIN - YIELD, state, final estimates only
  data/nass/soy-yield.json    SOYBEANS - YIELD, state, final estimates only
  data/nass/wheat-yield.json  WHEAT, WINTER - YIELD, state, final estimates only
                              (a crop year is kept from Oct 1, after the
                              end-of-September Small Grains Summary)
  data/nass/corn-acres.json   CORN - ACRES PLANTED, state, M acres
  data/nass/soy-acres.json    SOYBEANS - ACRES PLANTED, state, M acres
  data/state-stats.json       the current season: an in-season forecast or a
                              final, labelled by its own `meta` / `wheat_meta`
  data/atlas/counties/*.json  county corn yield history (yield.hist), for the
                              county leaders table

RULES
  - Every series file must say "final estimates only" in its scope string, or
    the build refuses. A forecast never enters the finals table.
  - The current-season figure from state-stats is printed in its own box with
    its meta label verbatim, and only when its crop year is newer than the
    newest final in the table. When it is the same year as a final already in
    the table and the two disagree, neither is mixed: the box is hidden and the
    build prints a warning (two files must never disagree in front of a reader).
  - A year with no figure inside the pulled window prints an em dash: "NASS
    published no figure". A corn/soy year that NASS has not yet finalised
    prints "pending".
  - Highest/lowest are over the published years in the window (not all-time).
  - 5- and 10-year averages are over the calendar window ending at the state's
    newest published year, printed with n; withheld below MIN_AVG_N.
  - Trend = OLS slope (bu/ac per year) over every published year, printed with
    n and the window; withheld below MIN_TREND_N; never projected.
  - County leaders: counties with a published corn yield for the state's newest
    final corn year, ranked; links use the Atlas builder's own slugs
    (build_atlas_pages.World), so they resolve.
  - THIN GUARD: indexable only with >= MIN_INDEX_YEARS final yields for corn
    or soybeans; otherwise noindex,follow and left out of _indexable.txt.

Usage:
  python3 scripts/build_state_yield_pages.py
  python3 scripts/build_state_yield_pages.py --selftest
"""
import argparse
import datetime as dt
import glob
import html
import json
import os
import re
import sys
import tempfile
from decimal import Decimal, ROUND_HALF_UP

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import county_yield as CY  # noqa: E402  (the one least-squares fit)

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_atlas_pages as BA  # noqa: E402  (slugify, STATE_NAMES, World -> county slugs)

SITE = "https://agsist.com"
OUT_DIR = "yield"
MIN_INDEX_YEARS = 10
MIN_AVG_N = {5: 3, 10: 6}
MIN_TREND_N = 8
MIN_COUNTIES = 3
TOP_COUNTIES = 10
FINAL_SCOPE = "final estimates only"
STATE_NAMES = BA.STATE_NAMES
ABBR = {v: k for k, v in STATE_NAMES.items()}
CROPS = ("corn", "soy", "wheat")
CROP_LABEL = {"corn": "Corn", "soy": "Soybeans", "wheat": "Winter wheat"}
CROP_LC = {"corn": "corn", "soy": "soybeans", "wheat": "winter wheat"}
SERIES = {"corn": "corn-yield", "soy": "soy-yield", "wheat": "wheat-yield"}
ACRES = {"corn": "corn-acres", "soy": "soy-acres"}
MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# ---------------------------------------------------------------- helpers
def esc(s):
    return html.escape("" if s is None else str(s), quote=True)


def slug(name):
    return BA.slugify(name)


def r(v, k=1):
    """Half away from zero to k places."""
    d = Decimal(repr(float(v))).quantize(Decimal(1).scaleb(-k), rounding=ROUND_HALF_UP)
    if d == 0:
        d = abs(d)
    return f"{d:.{k}f}"


def num(v):
    """A published figure as NASS printed it: 202.0 -> 202, 43.5 -> 43.5."""
    return f"{float(v):g}"


def yrs(a, b):
    return f"{a}" if a == b else f"{a}&ndash;{b}"


def yrs_plain(a, b):
    return f"{a}" if a == b else f"{a}–{b}"


def fmt_date(iso):
    try:
        t = dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return f"{MONTH_ABBR[t.month - 1]} {t.day}, {t.year}"
    except ValueError:
        return str(iso)[:10]


def ols_slope(points):
    """[(x, y)] -> slope by ordinary least squares, or None. The fit is the
    site's one least-squares implementation (scripts/county_yield.py ols)."""
    f = CY.ols(points)
    return f["slope"] if f else None


def series_stats(vals, pull_start=None):
    """vals {year:int -> float} of FINAL figures -> the statistics the page prints."""
    if not vals:
        return None
    ys = sorted(vals)
    last = ys[-1]
    hi = max(vals.values())
    lo = min(vals.values())
    out = {"n": len(ys), "first": ys[0], "last": last, "latest": vals[last],
           "hi": hi, "hi_years": [y for y in ys if vals[y] == hi],
           "lo": lo, "lo_years": [y for y in ys if vals[y] == lo]}
    for w in (5, 10):
        win = [y for y in ys if last - w < y <= last]
        before_pull = pull_start is not None and last - w + 1 < pull_start
        out[f"avg{w}"] = {"from": last - w + 1, "to": last, "n": len(win), "of": w, "before_pull": before_pull,
                          "pull_start": pull_start,
                          "value": (sum(vals[y] for y in win) / len(win))
                          if len(win) >= MIN_AVG_N[w] and not before_pull else None}
    s = ols_slope([(y, vals[y]) for y in ys]) if len(ys) >= MIN_TREND_N else None
    out["trend"] = {"slope": s, "n": len(ys), "from": ys[0], "to": last}
    return out


# ---------------------------------------------------------------- loading
def _read(root, rel):
    with open(os.path.join(root, rel), encoding="utf-8") as f:
        return json.load(f)


def load_series(root, key):
    d = _read(root, f"data/nass/{key}.json")
    if FINAL_SCOPE not in str(d.get("scope", "")):
        raise SystemExit(f"[state-yield] data/nass/{key}.json scope is not '{FINAL_SCOPE}': {d.get('scope')!r}; refusing")
    if d.get("type") != "state":
        raise SystemExit(f"[state-yield] data/nass/{key}.json is not state-level; refusing")
    rows = {}
    for row in d.get("rows") or []:
        st = row.get("state")
        if st not in ABBR:
            continue          # "Other States" and the like
        v = {int(y): float(x) for y, x in (row.get("values") or {}).items() if x is not None}
        if v:
            rows[st] = v
    return {"rows": rows, "years": [int(y) for y in d.get("years") or []],
            "newest": int(d.get("newest_year") or max(d.get("years") or [0])),
            "updated": d.get("updated"), "unit": d.get("unit"), "source": d.get("source")}


def load_counties(root):
    """{ST: [(fips, hist{year:int->float})]} from the Atlas county files whose
    build stamp matches atlas.json (a county file from another build is skipped)."""
    try:
        gen = _read(root, "data/atlas/atlas.json").get("generated")
    except OSError:
        return {}
    out = {}
    for p in sorted(glob.glob(os.path.join(root, "data/atlas/counties/*.json"))):
        try:
            c = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        if c.get("generated") != gen:
            continue
        h = ((c.get("yield") or {}).get("hist")) or {}
        if h:
            out.setdefault(c.get("state"), []).append(
                (c.get("fips"), {int(y): float(v) for y, v in h.items() if v is not None}))
    return out


def load_atlas_names(root):
    """(slugs {fips: 'iowa/story-county'}, labels {fips: 'Story County'}, counts {ST: n})."""
    try:
        W = BA.World(root)
    except Exception as e:  # pragma: no cover
        print(f"WARN: atlas slugs unavailable ({type(e).__name__}: {e}); county leaders omitted", file=sys.stderr)
        return {}, {}, {}
    counts = {}
    for f, c in W.C.items():
        counts[c["state"]] = counts.get(c["state"], 0) + 1
    return dict(W.slug), dict(W.label), counts


def load_inputs(root="."):
    inp = {k: load_series(root, SERIES[k]) for k in CROPS}
    inp["acres"] = {k: load_series(root, ACRES[k]) for k in ACRES}
    ss = _read(root, "data/state-stats.json")
    inp["state_stats"] = ss.get("stateStats") or {}
    inp["counties"] = load_counties(root)
    inp["atlas_slug"], inp["atlas_label"], inp["atlas_counts"] = load_atlas_names(root)
    return inp


# ---------------------------------------------------------------- page parts
def chrome(root):
    """The same static header/footer every root page carries (components/
    *-fallback.html via scripts/inject_static_nav.py), inside the
    #site-header / #site-footer placeholders loader.js swaps."""
    try:
        import inject_static_nav as NAV
        hdr, ftr, fonts = NAV.block("header"), NAV.block("footer"), NAV.FONT_BLOCK
    except Exception:  # pragma: no cover
        hdr = ftr = fonts = ""
    return (f'<div id="site-header">{hdr}</div>', f'<div id="site-footer">{ftr}</div>', fonts)


CSS = """
    .yl-wrap{max-width:1060px;margin:0 auto;padding:0 16px}
    .yl-sub{color:var(--text-muted);font-size:.9rem;line-height:1.6}
    .yl-sub a,.yl-note a,.yl-links a{color:var(--gold)}
    .yl-wrap h1{font-size:1.55rem;margin:14px 0 4px;color:var(--text)} .yl-wrap h2{font-size:1.12rem;margin:26px 0 6px;color:var(--text)}
    .yl-hero{display:flex;flex-wrap:wrap;gap:12px;margin:14px 0}
    .yl-stat{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;min-width:0;flex:1 1 240px}
    .yl-stat .l{font-size:.72rem;color:var(--text-muted);letter-spacing:.05em;text-transform:uppercase}
    .yl-stat .v{font-family:'JetBrains Mono',monospace;font-size:1.4rem;color:var(--text);margin-top:2px}
    .yl-stat ul{margin:8px 0 0;padding:0;list-style:none;font-size:.8rem;line-height:1.7;color:var(--text-muted)}
    .yl-stat ul b{color:var(--text);font-family:'JetBrains Mono',monospace;font-weight:600}
    .yl-note{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--gold);border-radius:8px;padding:12px 15px;font-size:.85rem;line-height:1.65;color:var(--text-muted);margin:14px 0}
    .yl-note b{color:var(--text)}
    .yl-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}
    table.yl-t{width:100%;border-collapse:collapse;font-size:.82rem;margin:10px 0}
    .yl-t th{text-align:left;color:var(--text-muted);font-size:.66rem;letter-spacing:.06em;text-transform:uppercase;padding:7px 8px;border-bottom:1px solid var(--border);vertical-align:bottom}
    .yl-t td{padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text);white-space:nowrap}
    .yl-t td.n,.yl-t th.n{text-align:right}
    .yl-t td.n{font-family:'JetBrains Mono',monospace}
    .yl-t .mut{color:var(--text-muted)}
    .yl-t a{color:var(--text);text-decoration:none;border-bottom:1px dotted var(--border-2,var(--border))}
    .yl-t a:hover{color:var(--gold)}
    .yl-cloud{font-size:.78rem;line-height:2;color:var(--text-muted)}
    .yl-cloud a{color:var(--text-muted);text-decoration:none;border-bottom:1px dotted var(--border)}
    .yl-cloud a:hover{color:var(--gold)}
"""


def head(title, desc, path, jsonld, indexable, fonts):
    robots = "index,follow" if indexable else "noindex,follow"
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0a0c0d">
  <script>/* agsist-theme-early: saved theme, else the device's, set before first paint so pages do not flash the wrong color. loader.js applies the same rule. */try{{var _t=localStorage.getItem('agsist-theme');if(_t!=='light'&&_t!=='dark')_t=window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.setAttribute('data-theme',_t);}}catch(e){{}}</script><script>/* agsist-ga-guard 2026-10-09: Google Analytics loads only when the browser sends no Global Privacy Control signal and the off switch on /privacy is not set, and only once the page is shown (a page loaded ahead in the background is not a visit). dataLayer and gtag always exist, so page code that calls them never throws. */(function(w,d,n){{var off=false,v,i,s;w.dataLayer=w.dataLayer||[];if(typeof w.gtag!=='function'){{w.gtag=function(){{w.dataLayer.push(arguments);}};}}try{{off=w.localStorage.getItem('agsist-ga-off')==='1';}}catch(e){{}}if(n.globalPrivacyControl===true){{off=true;}}w.agsistGaOff=off;w.gtag('set','allow_google_signals',false);w.gtag('set','allow_ad_personalization_signals',false);if(off){{return;}}i=function(){{s=d.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H';(d.head||d.documentElement).appendChild(s);}};if(d.prerendering){{d.addEventListener('prerenderingchange',i,{{once:true}});}}else{{i();}}}})(window,document,navigator);</script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-6KXCTD5Z9H');function gaEvent(n,p){{try{{gtag('event',n,p||{{}});}}catch(e){{}}}}</script>
  {fonts}
  <link rel="preload" href="/components/styles.css?v=23" as="style">
  <link rel="stylesheet" href="/components/styles.css?v=23">
  <link rel="icon" type="image/x-icon" href="/img/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/img/favicon-16.png">
  <link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.json">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}">
  <meta name="robots" content="{robots}">
  <link rel="canonical" href="{SITE}{path}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="AGSIST">
  <meta property="og:locale" content="en_US">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(desc)}">
  <meta property="og:url" content="{SITE}{path}">
  <meta property="og:image" content="{SITE}/img/og/agsist.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@agsist">
  <meta name="twitter:title" content="{esc(title)}">
  <meta name="twitter:description" content="{esc(desc)}">
  <meta name="twitter:image" content="{SITE}/img/og/agsist.jpg">
  <script type="application/ld+json">
{json.dumps(jsonld, indent=1, ensure_ascii=False).replace("</", "<\\/")}
  </script>
  <style>{CSS}  </style>
</head>"""


def crops_phrase(crops, short=False):
    names = {"corn": "Corn", "soy": "Soy" if short else "Soybean", "wheat": "Wheat"}
    w = [names[c] for c in crops]
    if len(w) == 1:
        return w[0]
    if len(w) == 2:
        return f"{w[0]} & {w[1]}"
    return f"{', '.join(w[:-1])} & {w[-1]}"


def make_title(name, title_crops, y0, y1):
    rng = yrs_plain(y0, y1)
    for t in (f"{name} {crops_phrase(title_crops)} Yield by Year ({rng}) | AGSIST",
              f"{name} {crops_phrase(title_crops, True)} Yield by Year ({rng}) | AGSIST",
              f"{name} {crops_phrase(title_crops, True)} Yields by Year, {rng} | AGSIST",
              f"{name} {crops_phrase(title_crops, True)} Yields, {rng} | AGSIST",
              f"{name} {crops_phrase(title_crops, True)} Yield by Year | AGSIST",
              f"{name} Crop Yield by Year ({rng}) | AGSIST",
              f"{name} Crop Yield by Year | AGSIST"):
        if len(t) <= 60:
            return t
    return f"{name} Crop Yields | AGSIST"


def make_desc(name, stats, crops, y0, y1):
    rng = yrs_plain(y0, y1)
    latest = [(c, stats[c]) for c in crops]
    same_year = len({s["last"] for _, s in latest}) == 1
    if same_year:
        bits = f"{latest[0][1]['last']}: " + ", ".join(f"{CROP_LC[c]} {num(s['latest'])}" for c, s in latest) + " bu/ac"
    else:
        bits = ", ".join(f"{CROP_LC[c]} {num(s['latest'])} ({s['last']})" for c, s in latest) + " bu/ac"
    lc = crops_phrase(crops).lower()
    cands = [
        f"{name} {lc} yield by year, USDA NASS {rng}. Latest {bits}. Highs, lows, 5- and 10-year averages, trend and top counties.",
        f"{name} {lc} yield by year, USDA NASS {rng}. Latest {bits}. Highs, lows, averages, trend, top counties.",
        f"{name} yield by year, USDA NASS {rng}. Latest {bits}. Highs, lows, averages and trend.",
        f"{name} yield by year, USDA NASS {rng}. Latest {bits}.",
    ]
    for d in cands:
        if 120 <= len(d) <= 160:
            return d
    for d in cands:
        if len(d) <= 160:
            # too short: pad with a true, plain clause
            pad = " Every published year, with sources."
            return (d + pad) if len(d + pad) <= 160 else d
    return cands[-1][:157].rstrip() + "..."


def dash(reason="NASS published no figure"):
    return f'<span class="mut" title="{esc(reason)}">n/a</span>'


def stat_card(c, s, unit="bu/ac"):
    def yl(ys):
        return ", ".join(str(y) for y in ys)
    a5, a10, tr = s["avg5"], s["avg10"], s["trend"]

    def avg_li(a, w):
        rng = yrs(a["from"], a["to"])
        if a["value"] is None and a.get("before_pull"):
            return (f"<li>{w}-year average ({rng}): {dash('window starts before the data')}. The NASS pull on this "
                    f"page starts in {a['pull_start']}, so no full {w}-year window ends in {a['to']}</li>")
        if a["value"] is None:
            return (f"<li>{w}-year average ({rng}): {dash('fewer published years than the minimum')}. "
                    f"Only {a['n']} of {a['of']} years published, too few to average</li>")
        return f"<li>{w}-year average ({rng}): <b>{r(a['value'])}</b> {unit}, n&nbsp;=&nbsp;{a['n']} of {a['of']} years</li>"
    if tr["slope"] is None:
        tli = (f"<li>Trend: {dash('too few published years')}. {tr['n']} published years, "
               f"fewer than the {MIN_TREND_N} needed to fit a line</li>")
    else:
        sgn = "+" if tr["slope"] > 0 else ("&minus;" if tr["slope"] < 0 else "")
        tli = (f"<li>Trend ({yrs(tr['from'], tr['to'])}): <b>{sgn}{r(abs(tr['slope']), 2)}</b> {unit} per year, "
               f"n&nbsp;=&nbsp;{tr['n']} years (least-squares line, not projected)</li>")
    return (f'<div class="yl-stat"><div class="l">{CROP_LABEL[c]} &middot; {s["last"]} USDA NASS</div>'
            f'<div class="v">{num(s["latest"])} <span style="font-size:.8rem;color:var(--text-muted)">{unit}</span></div><ul>'
            f'<li>Highest ({yrs(s["first"], s["last"])}): <b>{num(s["hi"])}</b> in {yl(s["hi_years"])}</li>'
            f'<li>Lowest ({yrs(s["first"], s["last"])}): <b>{num(s["lo"])}</b> in {yl(s["lo_years"])}</li>'
            f'{avg_li(a5, 5)}{avg_li(a10, 10)}{tli}</ul></div>')


def current_season(st, rec, stats, warn):
    """Boxes for state-stats figures NEWER than the newest final. Same-year
    figures are checked against the finals and never printed twice."""
    out = []
    if not rec:
        return out
    yr = rec.get("year")
    items = [(c, rec.get(k)) for c, k in (("corn", "corn_yield"), ("soy", "bean_yield"))
             if rec.get(k) is not None and c in stats]
    if items and yr:
        newer = [(c, v) for c, v in items if yr > stats[c]["last"]]
        for c, v in items:
            if yr == stats[c]["last"] and float(v) != stats[c]["latest"]:
                warn.append(f"{st} {c} {yr}: state-stats {v} != final {stats[c]['latest']}")
        if newer:
            out.append((rec.get("meta"), newer, bool(rec.get("forecast"))))
    wy, wv = rec.get("wheat_year"), rec.get("wheat_yield")
    if wy and wv is not None and "wheat" in stats:
        if wy > stats["wheat"]["last"]:
            out.append((rec.get("wheat_meta"), [("wheat", wv)], bool(rec.get("wheat_forecast"))))
        elif wy == stats["wheat"]["last"] and float(wv) != stats["wheat"]["latest"]:
            warn.append(f"{st} wheat {wy}: state-stats {wv} != final {stats['wheat']['latest']}")
    return out


def county_section(st, name, inp, corn_stats, root):
    rows = inp["counties"].get(st) or []
    total = inp["atlas_counts"].get(st)
    if not corn_stats:
        return ""
    y = corn_stats["last"]
    have = [(f, h[y]) for f, h in rows if y in h and f in inp["atlas_slug"]]
    hd = f'<h2 id="counties">Top {name} counties by {y} corn yield</h2>'
    if len(have) < MIN_COUNTIES:
        return (hd + f'<p class="yl-sub">Not enough county figures to rank: NASS published a {y} county corn yield '
                f'for {len(have)} {name} count{"y" if len(have) == 1 else "ies"} in the Farmland Atlas data '
                f'(at least {MIN_COUNTIES} needed).</p>')
    have.sort(key=lambda t: (-t[1], inp["atlas_label"].get(t[0], t[0])))
    top = have[:TOP_COUNTIES]
    trs = []
    for i, (f, v) in enumerate(top, 1):
        lab = inp["atlas_label"].get(f, f)
        sl = inp["atlas_slug"][f]
        if os.path.exists(os.path.join(root, "farmland-atlas", sl + ".html")):
            cell = f'<a href="/farmland-atlas/{esc(sl)}">{esc(lab)}</a>'
        else:
            cell = esc(lab)
        diff = v - corn_stats["latest"]
        sgn = "+" if diff > 0 else ("&minus;" if diff < 0 else "")
        trs.append(f'<tr><td class="n mut">{i}</td><td>{cell}</td><td class="n">{num(v)}</td>'
                   f'<td class="n">{sgn}{num(r(abs(diff)))}</td></tr>')
    of = f" of the {total} counties in the Atlas" if total else ""
    return (hd + f'<p class="yl-sub">USDA NASS county corn-for-grain yield, {y}, all practices. NASS published a {y} '
            f'figure for <b>{len(have)}</b>{of}; counties without a published figure are not ranked. '
            f'The last column compares with the {name} state yield of {num(corn_stats["latest"])} bu/ac.</p>'
            f'<div class="yl-scroll"><table class="yl-t"><thead><tr><th class="n">#</th><th>County</th>'
            f'<th class="n">{y} bu/ac</th><th class="n">vs state</th></tr></thead><tbody>'
            + "".join(trs) + "</tbody></table></div>")


def year_table(st, name, inp, crops, y0, y1):
    cols = []
    for c in crops:
        cols.append(("yield", c))
        if c in ACRES and name in inp["acres"][c]["rows"]:
            cols.append(("acres", c))
    th = "".join(f'<th class="n">{CROP_LABEL[c]}<br>bu/ac</th>' if k == "yield"
                 else f'<th class="n">{CROP_LABEL[c]}<br>planted, M ac</th>' for k, c in cols)
    trs = []
    for y in range(y1, y0 - 1, -1):
        tds = []
        for k, c in cols:
            src = inp[c] if k == "yield" else inp["acres"][c]
            v = src["rows"].get(name, {}).get(y)
            if v is not None:
                tds.append(f'<td class="n">{num(v)}</td>')
            elif y > src["newest"]:
                tds.append(f'<td class="n mut" title="NASS publishes the {y} annual estimate after harvest">pending</td>')
            else:
                tds.append(f'<td class="n">{dash()}</td>')
        trs.append(f'<tr><td>{y}</td>{"".join(tds)}</tr>')
    return (f'<div class="yl-scroll"><table class="yl-t"><thead><tr><th>Year</th>{th}</tr></thead>'
            f'<tbody>{"".join(trs)}</tbody></table></div>')


def build_state_page(name, inp, ctx):
    st = ABBR[name]
    sl = slug(name)
    root = ctx["root"]
    stats = {}
    for c in CROPS:
        v = inp[c]["rows"].get(name)
        if v:
            stats[c] = series_stats(v, min(inp[c]["years"]) if inp[c]["years"] else None)
    crops = [c for c in CROPS if c in stats]
    if not crops:
        return None, None
    y0 = min(stats[c]["first"] for c in crops)
    y1 = max(stats[c]["last"] for c in crops)
    # table runs to the newest year any shown crop's file covers, so a pending
    # corn/soy year beside a published wheat year reads as pending, not missing
    y1t = y1
    indexable = any(stats.get(c, {}).get("n", 0) >= MIN_INDEX_YEARS for c in ("corn", "soy"))
    title_crops = [c for c in crops if stats[c]["n"] >= MIN_INDEX_YEARS] or crops
    title = make_title(name, title_crops, y0, y1)
    desc = make_desc(name, stats, title_crops, y0, y1)
    path = f"/yield/{sl}"
    updated = max((inp[c]["updated"] or "") for c in crops)

    warn = ctx["warn"]
    seasons = current_season(st, inp["state_stats"].get(st), stats, warn)

    # ---- JSON-LD
    jsonld = {"@context": "https://schema.org", "@graph": [
        {"@type": "Dataset", "@id": f"{SITE}{path}#dataset",
         "name": f"{name} {crops_phrase(crops).lower()} yield by year, {yrs_plain(y0, y1)}",
         "description": (f"USDA NASS state yield estimates for {name} ("
                         + ", ".join(f"{CROP_LC[c]} {yrs_plain(stats[c]['first'], stats[c]['last'])}, n={stats[c]['n']}" for c in crops)
                         + "), final estimates only, with planted acres where NASS publishes them, "
                           "highest and lowest years, 5- and 10-year averages and a least-squares trend."),
         "url": f"{SITE}{path}", "isAccessibleForFree": True,
         "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE},
         "isBasedOn": "https://quickstats.nass.usda.gov/",
         "dateModified": updated,
         "temporalCoverage": f"{y0}/{y1}",
         "spatialCoverage": {"@type": "Place", "name": f"{name}, United States"},
         "variableMeasured": [f"{CROP_LC[c]} yield (bu/acre)" for c in crops]
                             + [f"{CROP_LC[c]} acres planted (million acres)" for c in crops
                                if c in ACRES and name in inp["acres"][c]["rows"]]},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "AGSIST", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "USDA Quick Stats", "item": f"{SITE}/usda-quick-stats"},
            {"@type": "ListItem", "position": 3, "name": f"{name} yield by year", "item": f"{SITE}{path}"}]},
    ]}

    cards = "".join(stat_card(c, stats[c]) for c in crops)
    # ---- current season
    if seasons:
        sbits = []
        for meta, items, fc in seasons:
            vals = "; ".join(f"{CROP_LC[c]} <b>{num(v)}</b> bu/ac" for c, v in items)
            sbits.append(f"<li>{vals} (<i>{esc(meta)}</i>)</li>")
        season_html = (f'<div class="yl-note"><b>Current season, kept out of the table above.</b> '
                       f'USDA NASS figures from AGSIST&rsquo;s state crop file (data/state-stats.json), with that file&rsquo;s own label:'
                       f'<ul style="margin:6px 0 0 18px;padding:0">{"".join(sbits)}</ul>'
                       f'A forecast changes month to month and is not comparable with the annual estimates in the table.</div>')
    else:
        season_html = ""

    lrng = {c: yrs(stats[c]["first"], stats[c]["last"]) for c in crops}
    gaps = []
    for c in crops:
        v = inp[c]["rows"][name]
        miss = [y for y in range(stats[c]["first"], stats[c]["last"] + 1) if y not in v]
        if miss:
            gaps.append(f"{CROP_LC[c]}: {', '.join(str(y) for y in miss)}")
    gap_txt = (" Years inside the window with no NASS state figure: " + "; ".join(gaps) + ".") if gaps else ""
    wheat_note = ""
    if "wheat" in crops:
        wheat_note = (" Wheat here is <b>winter wheat</b> only (NASS &ldquo;WHEAT, WINTER&rdquo;); spring wheat and durum "
                      "are not included. AGSIST&rsquo;s NASS pull carries no state winter wheat planted-acres series, so no wheat acres column is shown.")

    links = ['<a href="/usda-quick-stats">corn &amp; soybean yields for every state (USDA Quick Stats)</a>']
    if os.path.exists(os.path.join(root, "farmland-atlas", sl, "index.html")):
        links.append(f'<a href="/farmland-atlas/{sl}/">{name} Farmland Atlas: every county</a>')
    if os.path.exists(os.path.join(root, "rent", f"{sl}.html")):
        links.append(f'<a href="/rent/{sl}">{name} cash rent by county</a>')
    if os.path.exists(os.path.join(root, "basis", f"{sl}.html")):
        links.append(f'<a href="/basis/{sl}">{name} cash basis today</a>')
    if os.path.exists(os.path.join(root, "arc-plc", f"{sl}.html")):
        links.append(f'<a href="/arc-plc/{sl}">{name} ARC or PLC by county</a>')
    cloud = " &middot; ".join(f'<a href="/yield/{slug(o)}">{esc(o)}</a>' for o in ctx["all_states"] if o != name)
    hdr, ftr, _fonts = ctx["chrome"]
    intro_crops = ", ".join(f"{CROP_LC[c]} ({lrng[c]}, n&nbsp;=&nbsp;{stats[c]['n']})" for c in crops)

    body = f"""
<body>
{hdr}
<main class="yl-wrap" id="main">
  <p class="yl-sub" style="margin-top:14px"><a href="/usda-quick-stats" style="color:var(--text-muted)">USDA Quick Stats</a> &rsaquo; <b style="color:var(--text)">{esc(name)} yield by year</b></p>
  <h1>{esc(name)} {crops_phrase(crops).lower()} yield by year</h1>
  <p class="yl-sub">USDA NASS state yield estimates for {esc(name)}, annual (end-of-season) figures only: {intro_crops}.
  Every figure below is a USDA NASS number for the year shown; nothing is estimated or filled in by AGSIST.
  Source files updated {fmt_date(updated)}.</p>
  <div class="yl-hero">{cards}</div>
  {season_html}
  <h2 id="by-year">{esc(name)} yield by year</h2>
  <p class="yl-sub">Newest first. Bushels per acre; planted acres in millions. Source: USDA NASS Quick Stats, state level.
  n/a means NASS published no figure for that year; &ldquo;pending&rdquo; means NASS has not yet released that
  crop year&rsquo;s annual estimate (corn and soybeans come out in January).</p>
  {year_table(st, name, inp, crops, y0, y1t)}
  {county_section(st, name, inp, stats.get("corn"), root)}
  <div class="yl-note"><b>How these numbers are made.</b> Yields and planted acres are USDA NASS Quick Stats state
  estimates, pulled with the reference period pinned to the full year, so in-season monthly forecasts never enter
  the table. Highest and lowest are over the published years shown, not all-time records. Averages are plain means
  of the published years in the stated window, printed with how many years they rest on (withheld below
  {MIN_AVG_N[5]} of 5 or {MIN_AVG_N[10]} of 10). The trend is an ordinary least-squares line through every published
  year (at least {MIN_TREND_N}); it describes the past window and is not a forecast. County figures are NASS county
  corn yields, all practices, as carried by the AGSIST Farmland Atlas.{gap_txt}{wheat_note}</div>
  <p class="yl-links yl-sub">Related: {' &middot; '.join(links)}.</p>
  <h2>Yield by year in other states</h2>
  <p class="yl-cloud">{cloud}</p>
</main>
{ftr}
<script src="/components/loader.js?v=18" defer></script>
</body>
</html>
"""
    page = head(title, desc, path, jsonld, indexable, ctx["chrome"][2]) + body
    return page, {"name": name, "slug": sl, "title": title, "desc": desc, "indexable": indexable,
                  "stats": stats, "seasons": seasons}


# ---------------------------------------------------------------- build
def build_all(inp, out_dir=OUT_DIR, root=".", chrome_parts=None):
    states = sorted({s for c in CROPS for s in inp[c]["rows"]})
    os.makedirs(out_dir, exist_ok=True)
    ctx = {"root": root, "chrome": chrome_parts or chrome(root), "all_states": states, "warn": []}
    metas = []
    for name in states:
        page, meta = build_state_page(name, inp, ctx)
        if page is None:
            continue
        with open(os.path.join(out_dir, f"{meta['slug']}.html"), "w", encoding="utf-8") as f:
            f.write(page)
        metas.append(meta)
    idx = [f"{SITE}/yield/{m['slug']}" for m in metas if m["indexable"]]
    with open(os.path.join(out_dir, "_indexable.txt"), "w") as f:
        f.write("".join(u + "\n" for u in idx))
    for w in ctx["warn"]:
        print(f"[state-yield] WARN current season hidden, files disagree: {w}", file=sys.stderr)
    print(f"[state-yield] {len(metas)} pages, {len(idx)} indexable -> {out_dir}/")
    return metas, ctx["warn"]


# ---------------------------------------------------------------- selftest
def _fixture():
    scope = "final estimates only; test"

    def ser(rows, years, newest):
        return {"rows": rows, "years": years, "newest": newest, "updated": "2026-10-06T00:00:00Z",
                "unit": "bu/acre", "source": "USDA NASS Quick Stats"}
    corn_ia = {y: 150.0 + (y - 2010) * 2 for y in range(2010, 2026)}
    corn_ia[2012] = 137.0            # low
    corn_ia[2024] = 211.0            # high
    del corn_ia[2014]                # a gap
    inp = {
        "corn": ser({"Iowa": corn_ia, "Utah": {2023: 100.0, 2024: 110.0}}, list(range(2010, 2026)), 2025),
        "soy": ser({"Iowa": {y: 50.0 for y in range(2016, 2026)}}, list(range(2010, 2026)), 2025),
        "wheat": ser({"Kansas": {2024: 43.0, 2025: 51.0, 2026: 34.0}}, list(range(2010, 2027)), 2026),
        "acres": {"corn": ser({"Iowa": {2025: 13.6}}, [2025], 2025), "soy": ser({}, [2025], 2025)},
        "state_stats": {"IA": {"name": "Iowa", "meta": "2026 crop · USDA NASS in-season forecast", "year": 2026,
                               "forecast": True, "corn_yield": 219.0, "bean_yield": 64.0},
                        "KS": {"wheat_year": 2026, "wheat_yield": 35.0, "wheat_forecast": False,
                               "wheat_meta": "2026 crop year · USDA NASS final"}},
        "counties": {"IA": [("19001", {2025: 220.0}), ("19003", {2025: 230.0}), ("19005", {2024: 999.0}),
                            ("19007", {2025: 210.0})]},
        "atlas_slug": {"19001": "iowa/adair-county", "19003": "iowa/adams-county",
                       "19005": "iowa/allamakee-county", "19007": "iowa/appanoose-county"},
        "atlas_label": {"19001": "Adair County", "19003": "Adams County", "19005": "Allamakee County",
                        "19007": "Appanoose County"},
        "atlas_counts": {"IA": 99},
    }
    return inp, scope


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail and not ok else ""))
        if not ok:
            fails.append(name)

    # hand-worked arithmetic
    ck("ols slope 1,2,4 -> 1.5", abs(ols_slope([(2020, 1), (2021, 2), (2022, 4)]) - 1.5) < 1e-12)
    ck("ols flat -> 0", ols_slope([(1, 5), (2, 5), (3, 5)]) == 0)
    ck("rounding half away", r(2.25) == "2.3" and r(-0.05) == "-0.1" and r(0.04) == "0.0")
    s = series_stats({2016: 10.0, 2017: 12.0, 2018: 12.0, 2019: 8.0, 2020: 8.0, 2021: 10.0,
                      2022: 10.0, 2023: 10.0, 2025: 20.0})
    ck("hi ties listed", s["hi"] == 20.0 and s["hi_years"] == [2025])
    ck("lo ties listed", s["lo"] == 8.0 and s["lo_years"] == [2019, 2020])
    ck("5-yr window by calendar with n", s["avg5"]["n"] == 4 and s["avg5"]["from"] == 2021
       and abs(s["avg5"]["value"] - 12.5) < 1e-12, s["avg5"])
    ck("10-yr n=9 of 10", s["avg10"]["n"] == 9 and abs(s["avg10"]["value"] - 100 / 9) < 1e-12)
    ck("trend on 9 years", s["trend"]["n"] == 9 and s["trend"]["slope"] is not None)
    s3 = series_stats({y: 50.0 for y in range(2010, 2019)}, pull_start=2010)
    ck("10-yr window reaching before the pull is withheld", s3["avg10"]["value"] is None
       and s3["avg10"]["before_pull"] and s3["avg5"]["value"] == 50.0)
    s2 = series_stats({2020: 1.0, 2021: 2.0})
    ck("averages/trend withheld when thin", s2["avg5"]["value"] is None and s2["trend"]["slope"] is None)

    # scope gate
    with tempfile.TemporaryDirectory() as td:
        os.makedirs(os.path.join(td, "data/nass"))
        json.dump({"type": "state", "scope": "includes forecasts", "rows": [], "years": [2025], "newest_year": 2025},
                  open(os.path.join(td, "data/nass/corn-yield.json"), "w"))
        try:
            load_series(td, "corn-yield")
            ck("non-final scope refused", False)
        except SystemExit:
            ck("non-final scope refused", True)

    # full fixture build
    inp, _ = _fixture()
    with tempfile.TemporaryDirectory() as td:
        os.makedirs(os.path.join(td, "farmland-atlas", "iowa"))
        open(os.path.join(td, "farmland-atlas", "iowa", "adams-county.html"), "w").close()
        open(os.path.join(td, "farmland-atlas", "iowa", "index.html"), "w").close()
        out = os.path.join(td, "yield")
        metas, warn = build_all(inp, out_dir=out, root=td,
                                chrome_parts=('<div id="site-header"></div>', '<div id="site-footer"></div>', ""))
        by = {m["name"]: m for m in metas}
        ck("pages for every state with data", set(by) == {"Iowa", "Utah", "Kansas"}, set(by))
        ck("thin guard", by["Iowa"]["indexable"] and not by["Utah"]["indexable"] and not by["Kansas"]["indexable"])
        idx = open(os.path.join(out, "_indexable.txt")).read().split()
        ck("_indexable lists only indexable", idx == [f"{SITE}/yield/iowa"], idx)
        ia = open(os.path.join(out, "iowa.html"), encoding="utf-8").read()
        ut = open(os.path.join(out, "utah.html"), encoding="utf-8").read()
        ks = open(os.path.join(out, "kansas.html"), encoding="utf-8").read()
        ck("robots", 'content="index,follow"' in ia and 'content="noindex,follow"' in ut)
        ck("canonical", f'href="{SITE}/yield/iowa"' in ia)
        ck("title <= 60 and real range", len(by["Iowa"]["title"]) <= 60 and "2010–2025" in by["Iowa"]["title"],
           by["Iowa"]["title"])
        for n_, m in by.items():
            ck(f"desc 120-160 ({n_})", 120 <= len(m["desc"]) <= 160, f"{len(m['desc'])}: {m['desc']}")
        lds = [json.loads(b) for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', ia, re.S)]
        types = {g["@type"] for d in lds for g in d["@graph"]}
        ck("JSON-LD parses: Dataset + BreadcrumbList, no FAQ", types == {"Dataset", "BreadcrumbList"}, types)
        ck("gap year is n/a + reason", re.search(r"<tr><td>2014</td><td class=\"n\"><span class=\"mut\" "
                                                     r"title=\"NASS published no figure\">n/a", ia) is not None)
        ck("acres missing -> n/a, present -> value", "<td class=\"n\">13.6</td>" in ia)
        ck("high/low years", "<b>211</b> in 2024" in ia and "<b>137</b> in 2012" in ia)
        ck("forecast kept out of table", "<tr><td>2026</td>" not in ia and "219" in ia
           and "in-season forecast" in ia)
        ck("same-year disagreement hidden + warned", "35</b>" not in ks and any("KS wheat 2026" in w for w in warn), warn)
        ck("county ranking uses newest corn year only", ia.find("Adams County") < ia.find("Adair County")
           < ia.find("Appanoose County") and "999" not in ia)
        ck("county link only when atlas page exists", 'href="/farmland-atlas/iowa/adams-county"' in ia
           and 'href="/farmland-atlas/iowa/adair-county"' not in ia)
        ck("thin county count withheld", "Not enough county figures" in ut)
        ck("placeholders for loader.js", ia.count('id="site-header"') == 1 and ia.count('id="site-footer"') == 1)
        # the site's own audit rules over the rendered fixture
        try:
            import audit_pages as AP
            for nm, h in (("iowa", ia), ("kansas", ks), ("utah", ut)):
                f = [x for x in AP.static_checks(f"yield/{nm}.html", h, dt.date(2026, 10, 6)) if x.sev in ("HIGH", "MEDIUM")]
                ck(f"audit static checks clean ({nm})", not f, f)
        except ImportError:
            print("SKIP audit_pages not importable")
    print(f"\n{'ALL PASS' if not fails else f'{len(fails)} FAILED'}")
    return 0 if not fails else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--root", default=".")
    ap.add_argument("--out", default=OUT_DIR)
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    inp = load_inputs(a.root)
    build_all(inp, out_dir=os.path.join(a.root, a.out) if not os.path.isabs(a.out) else a.out, root=a.root)
    return 0


if __name__ == "__main__":
    sys.exit(main())
