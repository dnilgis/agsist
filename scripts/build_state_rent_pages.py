#!/usr/bin/env python3
"""build_state_rent_pages.py — 47 per-state cash-rent pages + /rent hub, from
data/cash-rent/*.json. OFFLINE — reads committed data, writes rent/*.html.

WHY GENERATED, NOT HAND-WRITTEN: the numbers refresh every August. CI reruns
this after fetch_cash_rent.py lands new data and the pages stay true. Nobody
hand-uploads 47 files, ever. The pages are MACHINE-OWNED (like sitemap.xml):
edit this script, never the emitted HTML.

URL scheme (GitHub Pages extensionless): rent/iowa.html -> /rent/iowa,
rent/index.html -> /rent/. No collision with /cash-rent (cash-rent.html).

Honesty rules carried in:
  - YoY and 10-yr deltas use MATCHED counties only (both years published) —
    composition drift would otherwise invent a trend.
  - 2015 and 2018 labeled "no survey" (NO_SURVEY_YEARS, imported from
    fetch_cash_rent.py so there is one list); other missing years "not
    published". No line
    is drawn across a gap.
  - "Rent" means non-irrigated (dryland) cropland rent, the same definition
    the Farmland Atlas and data/cash-rent/national.json use. Irrigated and
    pasture are shown beside it, labeled, never in its place. Only a state
    with fewer than MIN_DRY counties of dryland rent (AZ, NV) is headlined on
    another type, and every table/stat SAYS which it is.
  - County medians of published counties only, labeled as such.

No naked squiggles: history is a labeled bar table (year + $ printed on
every bar), not a sparkline.

--selftest builds everything to a temp dir and asserts invariants.
"""
import glob
import html
import json
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_cash_rent import NO_SURVEY_YEARS, pair_county  # noqa: E402  (stdlib-only module, main() guarded)

DATA_DIR = "data/cash-rent"
MIN_DRY = 3          # counties with a latest-year dryland rent before a state is headlined on it
OUT_DIR = "rent"
SITE = "https://agsist.com"


def _page_rate():
    """The open ribbon's price, from the one rate card (scripts/stamp_rates.py
    writes the same text into every other page)."""
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "rate-card.json")) as f:
        t = next(x for x in json.load(f)["tiers"] if x["id"] == "page")
    return "$%d/mo &middot; first month free" % t["price_month"]


PAGE_RATE = _page_rate()

STATE_NAMES = {
    "AL": "Alabama", "AR": "Arkansas", "AZ": "Arizona", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida",
    "GA": "Georgia", "IA": "Iowa", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "MA": "Massachusetts", "MD": "Maryland", "ME": "Maine", "MI": "Michigan",
    "MN": "Minnesota", "MO": "Missouri", "MS": "Mississippi", "MT": "Montana",
    "NC": "North Carolina", "ND": "North Dakota", "NE": "Nebraska",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
    "NV": "Nevada", "NY": "New York", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VA": "Virginia", "VT": "Vermont", "WA": "Washington", "WI": "Wisconsin",
    "WV": "West Virginia", "WY": "Wyoming",
}
TYPE_LABEL = {"nonirr": "non-irrigated cropland", "irr": "irrigated cropland",
              "pasture": "permanent pasture"}
TYPE_SHORT = {"nonirr": "Non-irrigated", "irr": "Irrigated", "pasture": "Pasture"}
# Statutory termination-notice facts, same tier-1 set cash-lease.html cites.
NOTICE = {
    "IA": "September 1 before the lease year ends (Iowa Code &sect;562.7)",
    "IL": "4 months before the end of the lease year (735 ILCS 5/9-206)",
    "IN": "3 months before the end of the lease year (Ind. Code &sect;32-31-1-3)",
    "KS": "30 days before March 1 (K.S.A. &sect;58-2506)",
    "NE": "September 1 for oral/holdover leases (Neb. Rev. Stat. &sect;76-1445)",
    "SD": "September 1 before the new lease year (SDCL &sect;43-32-13)",
}



TILE = {"AK":(1,1),"ME":(12,1),"VT":(11,2),"NH":(12,2),"WA":(2,3),"MT":(3,3),"ND":(4,3),"SD":(5,3),"MN":(6,3),"WI":(7,3),"MI":(8,3),"NY":(10,3),"MA":(11,3),"RI":(12,3),"OR":(2,4),"ID":(3,4),"WY":(4,4),"NE":(5,4),"IA":(6,4),"IL":(7,4),"IN":(8,4),"OH":(9,4),"PA":(10,4),"NJ":(11,4),"CT":(12,4),"CA":(2,5),"NV":(3,5),"UT":(4,5),"CO":(5,5),"KS":(6,5),"MO":(7,5),"KY":(8,5),"WV":(9,5),"VA":(10,5),"MD":(11,5),"DE":(12,5),"AZ":(3,6),"NM":(4,6),"OK":(5,6),"AR":(6,6),"TN":(7,6),"NC":(8,6),"SC":(9,6),"TX":(5,7),"LA":(6,7),"MS":(7,7),"AL":(8,7),"GA":(9,7),"HI":(1,8),"FL":(10,8)}

def rent_verdict(yoy):
    if yoy is None:  return ("NOT ENOUGH MATCHED COUNTIES", "#8a948f")
    if yoy >= 3:     return ("RENT ROSE", "#e0685f")
    if yoy >= 0.5:   return ("RENT EDGED UP", "#d4a23f")
    if yoy > -0.5:   return ("RENT HELD FLAT", "#8a948f")
    if yoy > -3:     return ("RENT EASED", "#5fc28a")
    return ("RENT FELL", "#5fc28a")

def slug(name):
    return name.lower().replace(" ", "-")


def article(word):
    """'a' or 'an' by the sound of the word: an Iowa lease, a Utah lease."""
    w = word.strip()
    if not w:
        return "a"
    if w.lower().startswith(("uta", "uni", "use", "usu")):  # Utah: 'yoo' sound
        return "a"
    return "an" if w[0].lower() in "aeio" else "a"


ATLAS_OUT = "farmland-atlas"


def atlas_slugs(root="."):
    """{fips: 'iowa/story-county'} from the Farmland Atlas builder's own World,
    so a rent-page link lands on the exact page that builder writes. Empty
    (and a warning) if the atlas data can't be read -- the table then prints
    plain names rather than links that might 404."""
    try:
        import build_atlas_pages as BA  # noqa: E402  (same scripts/ dir)
        W = BA.World(root)
        # only pages that are on disk: a county the builder knows but has not
        # written yet keeps a plain name instead of a link that 404s
        return {f: sl for f, sl in W.slug.items()
                if os.path.exists(os.path.join(root, ATLAS_OUT, sl + ".html"))}
    except Exception as e:  # pragma: no cover
        print(f"WARN: atlas slugs unavailable ({type(e).__name__}: {e}); county names left unlinked", file=sys.stderr)
        return {}


def atlas_state_href(st, root="."):
    """The Farmland Atlas state page when it is on disk, else the Atlas map."""
    try:
        import build_atlas_pages as BA  # noqa: E402
        sl = BA.slugify(STATE_NAMES[st])
    except Exception:  # pragma: no cover
        sl = slug(STATE_NAMES[st])
    if os.path.exists(os.path.join(root, ATLAS_OUT, sl, "index.html")):
        return f"/{ATLAS_OUT}/{sl}/"
    return "/farmland-atlas"


def atlas_line(href):
    """The one-line door into the Atlas, near the top of every rent page."""
    return (f'<p class="rs-atlas">Part of the <a href="{href}">Farmland Atlas</a>: '
            f'land values, rent and risk for every county.</p>')


def arc_line(st, root="."):
    """The state's ARC/PLC page (scripts/build_arc_plc.py), only when it is on disk."""
    sl = slug(STATE_NAMES[st])
    if not os.path.exists(os.path.join(root, "arc-plc", sl + ".html")):
        return ""
    return (f'\n  <p class="sub">Choosing ARC or PLC for 2026 or 2027? See <a href="/arc-plc/{sl}" style="color:var(--gold)">'
            f'{STATE_NAMES[st]} ARC or PLC by county</a>.</p>')


def esc(s):
    return html.escape(str(s), quote=True)


def money(v):
    # AUDIT 2026-08-11: rstrip("0") turned $9.50 into "$9.5" (rendered live
    # on the Texas hero). Whole dollars stay clean; anything else keeps two.
    return f"${v:,.0f}" if v == int(v) else f"${v:,.2f}"


def latest(d):
    """{'2025': v, ...} -> (year:int, v) of newest, or (None, None)."""
    if not d:
        return None, None
    y = max(d, key=int)
    return int(y), d[y]


def med(vals):
    return round(statistics.median(vals), 2) if vals else None


def load_states():
    out = {}
    for f in sorted(glob.glob(f"{DATA_DIR}/[A-Z][A-Z].json")):
        d = json.load(open(f))
        if d.get("state") in STATE_NAMES:
            out[d["state"]] = d
    return out


def state_stats(d):
    """Everything the page needs, computed once, honesty rules applied."""
    counties = d.get("counties", [])
    yr_latest = max(int(y) for y in d.get("years", [2025]))
    # primary type = most counties published in the latest year
    coverage = {t: sum(1 for c in counties if str(yr_latest) in c["rent"].get(t, {}))
                for t in ("nonirr", "irr", "pasture")}
    primary = "nonirr" if coverage["nonirr"] >= MIN_DRY else max(("irr", "pasture"), key=lambda t: coverage[t])
    have_types = [t for t in ("nonirr", "irr", "pasture") if coverage[t]]

    cur = {c["name"]: c["rent"][primary][str(yr_latest)]
           for c in counties if str(yr_latest) in c["rent"].get(primary, {})}

    def matched_delta(back_to):
        pairs = [(c["rent"][primary][str(yr_latest)], c["rent"][primary][str(back_to)])
                 for c in counties
                 if str(yr_latest) in c["rent"].get(primary, {})
                 and str(back_to) in c["rent"].get(primary, {})]
        if len(pairs) < 5:
            return None, 0
        now = med([p[0] for p in pairs]); then = med([p[1] for p in pairs])
        return round(100 * (now - then) / then, 1), len(pairs)

    yoy, yoy_n = matched_delta(yr_latest - 1)
    dec, dec_n = matched_delta(yr_latest - 9)

    # median of published counties, per year, primary type — for the bar table
    hist = []
    all_years = sorted({int(y) for c in counties for y in c["rent"].get(primary, {})})
    for y in range(min(all_years), yr_latest + 1) if all_years else []:
        vals = [c["rent"][primary][str(y)] for c in counties
                if str(y) in c["rent"].get(primary, {})]
        if vals:
            hist.append({"y": y, "v": med(vals), "n": len(vals)})
        else:
            hist.append({"y": y, "v": None,
                         "why": "no survey" if (y in NO_SURVEY_YEARS or y in d.get("no_survey_years", []))
                                else "not published"})
    ranked = sorted(cur.items(), key=lambda kv: -kv[1])
    # the other land types, labeled, beside the headline (same latest year)
    other = {}
    for t_ in ("nonirr", "irr", "pasture"):
        if t_ == primary:
            continue
        v_ = [c["rent"][t_][str(yr_latest)] for c in counties if str(yr_latest) in c["rent"].get(t_, {})]
        if len(v_) >= MIN_DRY:
            other[t_] = {"median": med(v_), "n": len(v_)}
    return {
        "other": other,
        "yr": yr_latest, "primary": primary, "have_types": have_types,
        "coverage": coverage, "n": len(cur), "median": med(list(cur.values())),
        "yoy": yoy, "yoy_n": yoy_n, "dec": dec, "dec_n": dec_n,
        "hi": ranked[:5], "lo": ranked[-5:][::-1] if len(ranked) >= 5 else [],
        "hist": hist, "counties": counties,
        "y0": min(all_years) if all_years else yr_latest,
        "ty": int(str(d.get("generated") or yr_latest)[:4]),
    }


# ---------------------------------------------------------------- HTML pieces
def head(title, desc, path, jsonld):
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0a0c0d">
  <!-- 2026-09-30: fonts are self-hosted in styles.css now, no preconnect needed -->
  <script>/* agsist-theme-early: saved theme, else the device's, set before first paint so pages do not flash the wrong color. loader.js applies the same rule. */try{{var _t=localStorage.getItem('agsist-theme');if(_t!=='light'&&_t!=='dark')_t=window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.setAttribute('data-theme',_t);}}catch(e){{}}</script><script>/* agsist-ga-guard 2026-10-09: Google Analytics loads only when the browser sends no Global Privacy Control signal and the off switch on /privacy is not set, and only once the page is shown (a page loaded ahead in the background is not a visit). dataLayer and gtag always exist, so page code that calls them never throws. */(function(w,d,n){{var off=false,v,i,s;w.dataLayer=w.dataLayer||[];if(typeof w.gtag!=='function'){{w.gtag=function(){{w.dataLayer.push(arguments);}};}}try{{off=w.localStorage.getItem('agsist-ga-off')==='1';}}catch(e){{}}if(n.globalPrivacyControl===true){{off=true;}}w.agsistGaOff=off;w.gtag('set','allow_google_signals',false);w.gtag('set','allow_ad_personalization_signals',false);if(off){{return;}}i=function(){{s=d.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H';(d.head||d.documentElement).appendChild(s);}};if(d.prerendering){{d.addEventListener('prerenderingchange',i,{{once:true}});}}else{{i();}}}})(window,document,navigator);</script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-6KXCTD5Z9H');function gaEvent(n,p){{try{{gtag('event',n,p||{{}});}}catch(e){{}}}}</script>
  <link rel="preload" href="/components/styles.css?v=23" as="style">
  <link rel="stylesheet" href="/components/styles.css?v=23">
  <link rel="icon" type="image/x-icon" href="/img/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/img/favicon-16.png">
  <link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.json">
  <title>{esc(title)} | AGSIST</title>
  <meta name="description" content="{esc(desc)}">
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
{json.dumps(jsonld, indent=1)}
  </script>
  <style>
    .rs-wrap{{max-width:1060px;margin:0 auto;padding:0 16px}}
    .rs-hero{{display:flex;flex-wrap:wrap;gap:14px;margin:14px 0}}
    /* 2026-10-06: these panels stay dark in light mode; gold inside them stays bright */
    [data-theme="light"] .rs-stat,[data-theme="light"] .rs-note,[data-theme="light"] .rh-tile,[data-theme="light"] div[style*="background:#101415"]{{--gold:#d4a23f;--gold-fill:#d4a23f;--brand:#d4a23f;--brand-fill:#d4a23f}}
    .rs-stat{{background:#101415;border:1px solid #1a1f20;border-radius:10px;padding:12px 16px;min-width:150px;flex:1}}
    .rs-stat .v{{font-family:'JetBrains Mono',monospace;font-size:1.45rem;color:#e6ebe9}}
    .rs-stat .l{{font-size:.72rem;color:#8a948f;letter-spacing:.05em;text-transform:uppercase;margin-top:2px}}
    .rs-stat .s{{font-size:.72rem;color:#8a948f;margin-top:2px}}
    .up{{color:#5fc28a}}.dn{{color:#e0685f}}
    /* 2026-10-08: the table, bars, cloud and FAQ sit on the page background, so they use the
       site tokens (light and dark) instead of fixed dark-theme hex. The table scrolls inside
       .rs-tw on phones (the page itself clips sideways overflow) with the name column pinned. */
    .rs-tw{{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:10px 0;max-width:100%}}
    table.rs-t{{width:100%;border-collapse:separate;border-spacing:0;font-size:.85rem;margin:0}}
    .rs-t th{{text-align:right;color:var(--text-muted);font-size:.68rem;letter-spacing:.07em;text-transform:uppercase;padding:7px 9px;border-bottom:1px solid var(--border-2);cursor:pointer;white-space:nowrap;user-select:none}}
    .rs-t th:first-child,.rs-t td:first-child{{text-align:left}}
    .rs-t td{{padding:6px 9px;border-bottom:1px solid var(--border);text-align:right;font-family:'JetBrains Mono',monospace;white-space:nowrap;color:var(--text)}}
    .rs-t td:first-child{{font-family:Archivo,Inter,sans-serif;color:var(--text)}}
    .rs-t th:first-child,.rs-t td:first-child{{position:sticky;left:0;z-index:1;background:var(--bg);box-shadow:1px 0 0 var(--border-2)}}
    .rs-t tr:hover td{{background:var(--surface2)}}
    .rs-t .mut{{color:var(--text-muted)}}
    .rs-t .up{{color:var(--green)}}.rs-t .dn{{color:var(--red)}}
    [data-theme="light"] .rs-t .dn{{color:#b3261e}}
    .rs-bars{{margin:8px 0}}
    .rs-bar{{display:flex;align-items:center;gap:10px;margin:3px 0;font-family:'JetBrains Mono',monospace;font-size:.78rem}}
    .rs-bar .y{{flex:none;width:3.2em;white-space:nowrap;color:var(--text-muted)}}
    .rs-bar .b{{height:13px;background:linear-gradient(90deg,#2c4a3a,#5fc28a);border-radius:3px;min-width:2px}}
    .rs-bar .v{{color:var(--text)}}
    .rs-bar .mut{{color:var(--text-muted);font-size:.7rem;white-space:nowrap}}
    .rs-bar .gap{{color:var(--text-muted);font-style:italic;font-size:.74rem}}
    .rs-note{{background:#101415;border:1px solid #1a1f20;border-left:3px solid #d4a23f;border-radius:8px;padding:12px 15px;font-size:.85rem;line-height:1.65;color:#8a948f;margin:14px 0}}
    .rs-note b{{color:#e6ebe9}}
    .rs-links a{{color:var(--gold)}}
    .rs-cloud{{font-size:.78rem;line-height:2;color:var(--text-muted)}}
    .rs-cloud a{{color:var(--text-muted);text-decoration:none;border-bottom:1px dotted var(--border-2)}}
    .rs-cloud a:hover{{color:var(--gold)}}
    /* the sponsor ribbon is styled once, in components/styles.css */
    h1{{font-size:1.55rem;margin:14px 0 4px}} h2{{font-size:1.12rem;margin:26px 0 6px}}
    .rh-grid{{position:relative;width:840px;height:560px;margin:0 auto;max-width:100%}}
    .rh-tile{{position:absolute;width:64px;height:64px;border-radius:9px;padding:9px;box-sizing:border-box;text-decoration:none;display:block;left:calc(var(--gc)*70px - 70px);top:calc(var(--gr)*70px - 70px)}}
    .rh-tile:hover{{outline:2px solid #d4a23f;transform:scale(1.1);z-index:2}}
    .rh-tile.dim{{background:#101415;border:1px dashed #1a1f20;opacity:.45}}
    .rh-tst{{display:block;font-family:'JetBrains Mono',monospace;font-weight:800;font-size:.92rem;color:#e6ebe9}}
    .rh-tge{{display:block;font-family:'JetBrains Mono',monospace;font-size:.85rem;font-weight:700;margin-top:3px;color:#e6ebe9}}
    @media (max-width:900px){{
      .rh-grid{{width:100%;height:auto;display:grid;grid-template-columns:repeat(12,1fr);gap:3px}}
      .rh-tile{{position:static;width:auto;height:auto;aspect-ratio:1;padding:0;border-radius:5px;display:flex;align-items:center;justify-content:center}}
      .rh-tile{{grid-column:var(--gc);grid-row:var(--gr)}}
      .rh-tge{{display:none}}
      .rh-tst{{font-size:.56rem}}
    }}
    .sub{{color:var(--text-muted);font-size:.9rem;line-height:1.6}}
    .sub b{{color:var(--text)}}
    .rs-t td:first-child a{{color:var(--text);text-decoration:underline dotted var(--border-2);text-underline-offset:3px}}
    .rs-t td:first-child a:hover{{color:var(--gold)}}
    @media (max-width:760px){{
      .rs-t td:first-child{{padding-top:0;padding-bottom:0}}
      .rs-t td:first-child a{{display:inline-flex;align-items:center;min-height:40px}}
    }}
    .rs-faq{{border-bottom:1px solid var(--border);padding:8px 0}}
    .rs-faq summary{{cursor:pointer;color:var(--text);font-size:.95rem}}
    @media(max-width:640px){{.rs-faq summary{{padding:.45rem 0}}}}
    .rs-faq p{{color:var(--text-muted);font-size:.88rem;line-height:1.65;margin:8px 0 4px}}
    /* Farmland Atlas look (farmland-atlas/atlas-pages.css .read): this page is a door into the Atlas */
    .rs-atlas{{border-left:2px solid var(--gold);padding:.2rem 0 .2rem .9rem;margin:10px 0 4px;font-size:.95rem;line-height:1.6;color:var(--text-dim)}}
    .rs-atlas a{{color:var(--gold);font-weight:700}}
    :root[data-theme="light"] .rs-atlas a{{color:#6f5209}}
  </style>
</head>"""


def delta_html(v, n, label):
    if v is None:
        return f'<div class="v mut">-</div><div class="l">{label}</div><div class="s">too few matched counties</div>'
    cls = "up" if v >= 0 else "dn"
    sign = "+" if v >= 0 else ""
    return (f'<div class="v {cls}">{sign}{v}%</div><div class="l">{label}</div>'
            f'<div class="s">median of {n} matched counties</div>')


def bars_html(hist):
    vals = [h["v"] for h in hist if h.get("v") is not None]
    top = max(vals) if vals else 1
    rows = []
    for h in hist:
        if h.get("v") is None:
            rows.append(f'<div class="rs-bar"><span class="y">{h["y"]}</span>'
                        f'<span class="gap">{h["why"]}; gap shown, not interpolated</span></div>')
        else:
            w = max(2, round(100 * h["v"] / top, 1))
            rows.append(f'<div class="rs-bar"><span class="y">{h["y"]}</span>'
                        f'<div class="b" style="width:{w}%"></div>'
                        f'<span class="v">{money(h["v"])}</span>'
                        f'<span class="mut">{h["n"]} co.</span></div>')
    return '<div class="rs-bars">' + "".join(rows) + "</div>"


def county_table(st, s, aslug=None):
    yr = s["yr"]
    cols = [(t, TYPE_LABEL[t]) for t in ("nonirr", "irr", "pasture") if t in s["have_types"]]
    thead = "<th>County</th>" + "".join(
        f'<th title="{lab}, $/acre">{TYPE_SHORT[t]} {yr}</th>' for t, lab in cols)
    thead += ('<th>YoY</th><th title="county corn yield, 15-year least-squares trend projected to %s, fitted on the same '
              'practice as the rent (dryland, or all practices where NASS shows no irrigation)">Corn trend %s</th>' % (s["ty"], s["ty"]))
    body = []
    for c in sorted(s["counties"], key=lambda c: c["name"]):
        a = (aslug or {}).get(c.get("fips"))
        cells = [f'<td><a href="/{ATLAS_OUT}/{a}" title="{esc(c["name"])}: Farmland Atlas county record">{esc(c["name"])}</a></td>'
                 if a else f"<td>{esc(c['name'])}</td>"]
        for t, _ in cols:
            r = c["rent"].get(t, {})
            if str(yr) in r:
                cells.append(f'<td data-v="{r[str(yr)]}">{money(r[str(yr)])}</td>')
            else:
                ly, lv = latest(r)
                cells.append(f'<td class="mut" data-v="{lv if lv is not None else -1}">'
                             + (f"{money(lv)} <span style='font-size:.68rem'>({ly})</span>" if lv is not None else "n/a")
                             + "</td>")
        p = c["rent"].get(s["primary"], {})
        if str(yr) in p and str(yr - 1) in p and p[str(yr - 1)]:
            ch = 100 * (p[str(yr)] - p[str(yr - 1)]) / p[str(yr - 1)]
            cells.append(f'<td class="{"up" if ch >= 0 else "dn"}" data-v="{ch:.1f}">{"+" if ch >= 0 else ""}{ch:.1f}%</td>')
        else:
            cells.append('<td class="mut" data-v="-999">n/a</td>')
        ct = ((pair_county(c) or {}).get("corn") or {}).get("t", {}).get("v")
        cells.append(f'<td data-v="{ct if ct is not None else -1}">'
                     + (f"{ct:.0f} bu" if ct is not None else '<span class="mut">n/a</span>') + "</td>")
        body.append("<tr>" + "".join(cells) + "</tr>")
    return (f'<div class="rs-tw"><table class="rs-t" id="rs-table"><thead><tr>{thead}</tr></thead>'
            f'<tbody>{"".join(body)}</tbody></table></div>')


SORT_JS = """<script>
(function(){var t=document.getElementById('rs-table');if(!t)return;
var ths=t.tHead.rows[0].cells,dir=1,last=-1;
for(let i=0;i<ths.length;i++)ths[i].addEventListener('click',function(){
 dir=(last===i)?-dir:(i===0?1:-1);last=i;
 var rows=[].slice.call(t.tBodies[0].rows);
 rows.sort(function(a,b){
  if(i===0)return dir*a.cells[0].textContent.localeCompare(b.cells[0].textContent);
  return dir*((+a.cells[i].getAttribute('data-v')||0)-(+b.cells[i].getAttribute('data-v')||0));
 });
 rows.forEach(function(r){t.tBodies[0].appendChild(r);});
 gaEvent('rent_state_sort',{col:ths[i].textContent});
});})();
</script>"""


def explore_nav():
    L = lambda h, t: f'<a href="{h}" style="color:var(--text-muted);text-decoration:none">{t}</a>'
    return ('<nav aria-label="Explore AGSIST" style="max-width:1060px;margin:26px auto 8px;padding:0 16px;font-size:12.5px;line-height:2.1">'
            '<span style="color:var(--text-dim);font-weight:700">Land:</span> '
            + " &middot; ".join([L("/farmland-atlas", "Farmland Atlas"), L("/rent/", "Cash Rent by State"),
                                 L("/cash-lease", "Cash Farm Lease"), L("/foreign-land", "Foreign-Owned Land")])
            + '<br><span style="color:var(--text-dim);font-weight:700">Markets:</span> '
            + " &middot; ".join([L("/markets", "Futures"), L("/cash-bids", "Cash Bids"), L("/basis", "Basis vs Normal"),
                                 L("/whats-priced-in", "What&rsquo;s Priced In"), L("/cot", "COT")])
            + '<br><span style="color:var(--text-dim);font-weight:700">Field:</span> '
            + " &middot; ".join([L("/conditions", "Crop Conditions Rank"), L("/drought-monitor", "Drought Monitor"),
                                 L("/hail-map", "Hail Map"), L("/breakeven", "Break-Even"), L("/daily", "Daily Briefing")])
            + "</nav>")


def state_cloud(states, exclude=None):
    links = [f'<a href="/rent/{slug(STATE_NAMES[st])}">{STATE_NAMES[st]}</a>'
             for st in sorted(states, key=lambda s: STATE_NAMES[s]) if st != exclude]
    return '<p class="rs-cloud">' + " &middot; ".join(links) + "</p>"


def faq_html(faq):
    """The FAQ, visibly, with the exact text the FAQPage JSON-LD carries:
    structured data must match what a reader sees."""
    items = "".join(f'<details class="rs-faq"><summary>{esc(f["q"])}</summary><p>{esc(f["a"])}</p></details>'
                    for f in faq)
    return f'<h2 id="faq">Questions</h2>\n  {items}'


def build_state_page(st, d, s, all_states, aslug=None):
    name = STATE_NAMES[st]
    sl = slug(name)
    yr = s["yr"]
    plabel = TYPE_LABEL[s["primary"]]
    title = f"{name} Cash Rent by County {yr} — ${{}}/acre Rates &amp; History".format("")
    title = f"{name} Cash Rent by County {yr}"
    desc = (f"{name} farmland cash rent {yr}: median {money(s['median'])}/acre ({plabel}) across "
            f"{s['n']} published counties. Every county's USDA rate, history to {s['y0']}, free.")[:160]
    hi_s = ", ".join(f"{n} ({money(v)})" for n, v in s["hi"][:3])
    lo_s = ", ".join(f"{n} ({money(v)})" for n, v in s["lo"][:3])
    faq = [
        {"q": f"What is the average cash rent per acre in {name} for {yr}?",
         "a": (f"The median USDA NASS county cash rent for {plabel} in {name} is {money(s['median'])} per acre "
               f"across the {s['n']} counties with a published {yr} rate. Rents vary widely by county: "
               + (f"highest {hi_s}; lowest {lo_s}." if lo_s
                  else f"highest {hi_s}. With under five published counties, a highest/lowest split would overstate the sample.")
               + " The county mean is a survey reference point, not a rate card.")},
        {"q": f"How much did {name} cash rent change from {yr-1} to {yr}?",
         "a": (f"Comparing the same {s['yoy_n']} counties published in both years, the median {plabel} rent moved "
               f"{'+' if s['yoy'] and s['yoy'] >= 0 else ''}{s['yoy']}% year over year."
               if s["yoy"] is not None else
               "Too few counties were published in both years for a clean year-over-year figure.")},
        {"q": f"Why is my {name} county not listed?",
         "a": "USDA NASS publishes a county rate only where enough Cash Rents Survey responses came back "
              "(and the county has at least 20,000 acres of cropland plus pasture). If your county is missing, "
              "NASS did not publish a rate for it, and this page never estimates one."},
        {"q": "When is county cash rent data released?",
         "a": "USDA NASS releases county cash rent estimates each August for the current crop year. "
              "This page rebuilds automatically when new data lands."},
    ]
    if st in NOTICE:
        faq.append({"q": f"When must I give notice to terminate {article(name)} {name} farm lease?",
                    "a": f"{name} statute sets the deadline at {NOTICE[st].replace('&sect;', 'section ')}. "
                         f"Miss it and the lease typically continues another year on the same terms. "
                         f"See the AGSIST cash farm lease for the details and a printable lease."})
    jsonld = {"@context": "https://schema.org", "@graph": [
        {"@type": "Dataset",
         "@id": f"{SITE}/rent/{sl}#dataset",
         "name": f"{name} County Cash Rental Rates",
         "description": f"County-level cash rent for {', '.join(TYPE_LABEL[t] for t in s['have_types'])} in {name}, "
                        f"as published annually by USDA NASS, {s['y0']} to {yr}.",
         "url": f"{SITE}/rent/{sl}",
         "license": "https://www.usa.gov/government-works",
         "isAccessibleForFree": True,
         "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE},
         "temporalCoverage": f"{s['y0']}/{yr}",
         "spatialCoverage": {"@type": "Place", "name": f"{name}, United States"}},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "AGSIST", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "Cash Rent by State", "item": f"{SITE}/rent/"},
            {"@type": "ListItem", "position": 3, "name": name, "item": f"{SITE}/rent/{sl}"}]},
        {"@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": f["q"],
             "acceptedAnswer": {"@type": "Answer", "text": f["a"]}} for f in faq]},
    ]}
    seed = (f"{s['n']} {name} counties with a published {yr} {plabel} rent &middot; "
            f"median {money(s['median'])}/acre"
            + (f" &middot; {'+' if s['yoy'] >= 0 else ''}{s['yoy']}% vs {yr-1} (matched counties)" if s["yoy"] is not None else "")
            + f" &middot; data refreshed {esc(d.get('generated', ''))}")
    other_types = ""
    if len(s["have_types"]) > 1:
        other_types = (" Columns cover " + ", ".join(TYPE_LABEL[t] for t in s["have_types"])
                       + (f"; state stats above use {plabel}, the rent this site means by \u201crent\u201d." if s["primary"] == "nonirr"
                          else f"; state stats above use {plabel}: NASS published dryland rent for fewer than {MIN_DRY} {name} counties."))
    other_tiles = "".join(
        f'<div class="rs-stat"><div class="v">{money(o["median"])}</div><div class="l">{TYPE_SHORT[t_].lower()} median &middot; {yr}</div>'
        f'<div class="s">{TYPE_LABEL[t_]}, {o["n"]} counties, shown apart</div></div>'
        for t_, o in s["other"].items())
    vw, vc = rent_verdict(s["yoy"])
    hero = f"""
  <div style="background:#101415;border:1px solid #1a1f20;border-radius:14px;padding:20px 24px;margin:14px 0;display:flex;gap:22px;flex-wrap:wrap;align-items:center">
    <div style="font-family:'JetBrains Mono',monospace;font-size:3.6rem;font-weight:800;line-height:1;color:{vc}">{money(s['median'])}</div>
    <div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:1.25rem;font-weight:800;letter-spacing:.05em;color:{vc}">{vw}</div>
      <div style="font-size:1rem;line-height:1.7;color:#e6ebe9;max-width:540px">The median {name} county paid <b style="color:{vc}">{money(s['median'])} an acre</b> for {plabel} in {yr}{f", <b style='color:{vc}'>{'+' if s['yoy']>=0 else ''}{s['yoy']}&#37; vs {yr-1}</b> across the same {s['yoy_n']} counties" if s['yoy'] is not None else ""}. Highest county: {esc(s['hi'][0][0])} at {money(s['hi'][0][1])}. Every county is in the table below.</div>
    </div>
  </div>
  <div class="rs-hero">
    <div class="rs-stat"><div class="v">{money(s['median'])}</div><div class="l">median rent /ac &middot; {yr}</div><div class="s">{plabel}, {s['n']} counties</div></div>
    <div class="rs-stat">{delta_html(s['yoy'], s['yoy_n'], f'vs {yr-1}')}</div>
    <div class="rs-stat">{delta_html(s['dec'], s['dec_n'], f'vs {yr-9}')}</div>
    <div class="rs-stat"><div class="v">{money(s['hi'][0][1]) if s['hi'] else '-'}</div><div class="l">top county</div><div class="s">{esc(s['hi'][0][0]) if s['hi'] else ''}</div></div>
  </div>
  {('<div class="rs-hero">' + other_tiles + '</div>') if other_tiles else ''}"""
    page = head(title, desc, f"/rent/{sl}", jsonld) + f"""
<body>
<div id="site-header"></div>
<main class="rs-wrap">
  <p class="sub" style="margin-top:14px"><a href="/rent/" style="color:var(--text-muted)">Cash Rent by State</a> &rsaquo; <b>{name}</b></p>
  <h1>{name} Cash Rent by County, {yr}</h1>
  <p class="sub">Every USDA-published county cash rental rate in {name}, straight from the NASS Cash Rents
  Survey. Nothing is estimated or modeled, and there is no login. <span id="rs-seed"><!--SEED:rentstate-->{seed}<!--/SEED--></span></p>
  {atlas_line(atlas_state_href(st))}{arc_line(st)}
  {hero}
  <aside class="ag-sponsor-ribbon"><span class="ag-sponsor-tag">Sponsor this page</span> Your name beside {name} county cash rents. One category-exclusive slot. <span class="ag-sponsor-price" data-rate="page">{PAGE_RATE}</span> <a href="/sponsor-apply?slot=rent-{st.lower()}&amp;utm_source=rent-{sl}&amp;utm_medium=slot">Put your name here &rarr;</a></aside>
  <h2>Every published county, {yr}</h2>
  <p class="sub">Click a column to sort. Greyed values are the county&rsquo;s most recent published year where {yr}
  wasn&rsquo;t published.{other_types} Each county name opens its Farmland Atlas record (land value, yield, insurance
  and drought). Corn trend is the county&rsquo;s 15-yr trend yield (projected {s['ty']}) from NASS county estimates,
  fitted on the same practice as the rent: the figure the Atlas county page divides rent by for rent per bushel, and the
  one its rent share calculator starts from.</p>
  {county_table(st, s, aslug)}
  <h2>{name} median county rent by year</h2>
  <p class="sub">Median of counties published each year ({plabel}). Gap years are shown as gaps;
  drawing a line across them would be an invention.</p>
  {bars_html(s['hist'])}
  <div class="rs-note"><b>What this can&rsquo;t tell you.</b> These are county <b>means from a voluntary USDA survey</b>.
  Rents vary widely inside a county, driven by soil, drainage, field size and how badly a neighbor wants the
  ground. Year-over-year stats above compare only counties published in both years, so a county dropping out
  of the survey can&rsquo;t fake a trend. Treat any county number as the start of a conversation, not a rate card.</div>
  <div class="rs-note rs-links" style="border-left-color:#5fc28a"><b>Do something with it:</b>
  open a county in the table for its Farmland Atlas page and the <b>rent share calculator</b> (rent as a share of
  what the acre can actually gross, year by year) &middot; put a number in a <a href="/cash-lease?st={st}">printable {name} cash lease</a>{
      " (termination notice: " + NOTICE[st] + ")" if st in NOTICE else ""} &middot;
  check <a href="/basis">local basis vs normal</a> before you commit to a rent that needs a price.</div>
  {faq_html(faq)}
  <h2>Other states</h2>
  {state_cloud(all_states, exclude=st)}
  <p class="sub" style="font-size:.75rem;margin:18px 0">Source: USDA NASS Quick Stats, Cash Rents Survey county
  estimates (released each August) and county yield estimates. Page rebuilt automatically from data refreshed
  {esc(d.get('generated', ''))}. AGSIST is free and sells nothing on this page.</p>
</main>
{explore_nav()}
<div id="site-footer"></div>
<script src="/components/loader.js?v=18"></script>
{SORT_JS}
</body>
</html>
"""
    return page


# Moved from the retired /cash-rent page (2026-10): its explainer, its seven
# questions and its Dataset record. The calculator itself is
# components/rent-calc.js, opened from a Farmland Atlas county page.
HUB_DATASET = {
    "@type": "Dataset", "@id": f"{SITE}/rent/#dataset", "name": "US County Cash Rent and Trend Yield",
    "description": ("County-level cash rental rates for non-irrigated cropland, irrigated cropland, and permanent pasture, "
                    "as published annually by USDA NASS under the 2008 Farm Bill mandate, paired with county trend yields "
                    "for corn and soybeans fitted from NASS county yield estimates."),
    "url": f"{SITE}/rent/", "license": "https://www.usa.gov/government-works", "isAccessibleForFree": True,
    "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE},
    "temporalCoverage": "2008/..", "spatialCoverage": {"@type": "Place", "name": "United States"},
    "measurementTechnique": "USDA NASS Cash Rents Survey county estimates; ordinary least squares trend fit on NASS county yield estimates",
    "variableMeasured": [{"@type": "PropertyValue", "name": "Cash rent, non-irrigated cropland", "unitText": "USD per acre per year"},
                         {"@type": "PropertyValue", "name": "Cash rent, irrigated cropland", "unitText": "USD per acre per year"},
                         {"@type": "PropertyValue", "name": "Cash rent, permanent pasture", "unitText": "USD per acre per year"},
                         {"@type": "PropertyValue", "name": "Trend yield", "unitText": "bushels per acre"}],
    "distribution": [{"@type": "DataDownload", "encodingFormat": "application/json", "contentUrl": f"{SITE}/data/cash-rent/national.json"}],
}
HUB_FAQ = [
    {"q": "What is the average cash rent per acre in my county?",
     "a": "USDA NASS publishes a mean cash rental rate for every county with at least 20,000 acres of cropland plus pasture, "
          "separately for non-irrigated cropland, irrigated cropland, and permanent pasture. Pick your state above to see every "
          "published county rate and its history. If your county is not listed, NASS did not get enough survey responses to publish a rate for it."},
    {"q": "When is county cash rent data released?",
     "a": "USDA NASS releases county cash rent estimates each August, from a survey of roughly 280,000 farms and ranches conducted "
          "earlier the same year. The rate published in a given August describes that same crop year. Rates are not revised after publication."},
    {"q": "Why is there no 2015 or 2018 cash rent data?",
     "a": "NASS did not conduct the county Cash Rents Survey in 2015 or 2018, so no county estimates exist for those years. County data "
          "runs 2008 to 2014, 2016 to 2017, and 2019 forward. These pages show those years as gaps rather than drawing a line across them, "
          "because a line across them would be an invention."},
    {"q": "What percent of gross revenue should cash rent be?",
     "a": "There is no single correct figure, and anyone who gives you one is selling something. Rent as a share of gross revenue is useful "
          "because it moves when yields and prices move, while the rent itself is fixed for the season. Comparing the ratio to your own "
          "county's history is more informative than comparing it to a national rule of thumb. What the remaining share has to cover (seed, "
          "fertilizer, chemical, machinery, labor, interest) varies enormously between operations."},
    {"q": "How has cash rent changed as a share of revenue over time?",
     "a": "The rent share calculator on each Farmland Atlas county page charts it for every county with the data. For each year it divides "
          "that year's published county rent by that year's actual county yield for the same practice times that year's state average price "
          "received: dryland rent over the dryland yield, irrigated rent over the irrigated yield. Where the only county yield mixes irrigated "
          "and dryland acres, that year is withheld and the page says so. Every term is a USDA figure published after the fact, so the line "
          "shows what really happened rather than a projection. The pattern in most Corn Belt counties is that rent takes a far larger share "
          "of the gross in low-price years than in high-price years, even when the rent itself barely moves."},
    {"q": "Does this use futures prices or what farmers actually got?",
     "a": "The historical chart uses the USDA NASS marketing-year average price received by farmers in your state, which reflects actual "
          "sales and therefore already includes local basis. The calculator uses a board price plus a basis you enter yourself, because it "
          "is looking forward at a crop you have not sold. The two answer different questions: what happened, and what might."},
    {"q": "Is NASS cash rent the same as what I should pay?",
     "a": "No. It is a county mean from a voluntary survey. Rents vary widely within a county and even between farms on the same road, "
          "driven by soil type, drainage, field size, yield history, and how badly a neighbor wants the ground. Treat the county mean as a "
          "reference point for a conversation, not as a rate card."},
]
HUB_EXPLAIN = """<h2>How to read rent</h2>
  <details class="rs-faq"><summary>Why rent as a share of gross, and not the rent alone</summary>
  <p>Rent is fixed in the spring. Yield and price are not. That is the whole problem with judging a lease by the rent alone: the rent stops
  moving the day you sign, and everything that pays for it keeps moving for another nine months.</p>
  <p>Expressing rent as a share of gross revenue puts the fixed number on top of the moving one. When corn is $6.00 and the county trends
  200 bushels, $250 rent is about 21% of the gross. When corn is $4.00, the same $250 on the same ground is over 31%. Nothing about the
  lease changed. The arithmetic underneath it did.</p>
  <p><b>There is no magic percentage.</b> Anyone quoting you one number for the whole country is guessing, or selling. What the rest of
  the gross has to cover (seed, fertilizer, chemical, iron, labor, interest, living) is wildly different between two operations on the
  same road. The useful comparison is your county against its own history, which is why the calculator&rsquo;s chart goes back to 2008.</p></details>
  <details class="rs-faq"><summary>Where these numbers come from</summary>
  <p>The rent is USDA NASS&rsquo;s county estimate from the Cash Rents Survey, a survey of roughly 280,000 farms and ranches run every year
  in every state but Alaska. The 2008 Farm Bill requires NASS to publish a mean rate for every county with at least 20,000 acres of
  cropland plus pasture. Results land each August and are not revised afterward. The Farm Service Agency uses these same county estimates
  to set market-based rates for programs like CRP.</p>
  <p>The trend yield is ours, not USDA&rsquo;s: an ordinary least-squares fit through the county&rsquo;s NASS yield estimates over the
  last fifteen years, projected to the current year. It is fitted on the same practice as the rent it is divided by: dryland
  (non-irrigated) yields for dryland rent, irrigated yields for irrigated rent. The all-practice county yield is used only where NASS
  reports no irrigation in the county; anywhere else it is mostly pivot corn and would make dryland rent look cheap, so the trend is
  withheld and the page says why. Where a county has fewer than six real years of yield on record, or its series stopped more than three
  years ago, no trend is shown at all.</p></details>
  <details class="rs-faq"><summary>Three things this data will not do</summary>
  <p><b>It will not fill in your county if NASS didn&rsquo;t.</b> Counties with too few survey responses are withheld. Where that happens
  you get a blank and a plain statement that NASS did not publish, never a neighbor&rsquo;s number wearing your county&rsquo;s name.</p>
  <p><b>It has no 2015 or 2018.</b> NASS ran no county Cash Rents Survey in those years, so the series runs 2008 to 2014, 2016 to 2017
  and 2019 forward. Drawing a line across the gap would be inventing a year.</p>
  <p><b>It is a county mean, not a rate card.</b> Rents differ between farms on the same road: soil, drainage, field size, yield history,
  and how badly the neighbor wants it. Bring the mean to the conversation as a reference point, not a verdict.</p></details>
  <details class="rs-faq"><summary>Using it in an actual rent conversation</summary>
  <p>The common landlord conversation is a number against a feeling. The calculator gives both sides the same arithmetic to argue
  about, which is usually a shorter argument. Put your real yield in: if your ground beats the county by fifteen bushels, type that in.
  Put your real basis in: over a 200-bushel acre, thirty cents is sixty dollars. Look at the history, not the level: a ratio means little
  alone and a lot next to the same county&rsquo;s last fifteen years.</p>
  <p>What it will not do is tell you what to sign. That is between you, your landlord, and your own numbers. Settled on a number? Put it
  on paper with the free <a href="/cash-lease" style="color:var(--gold)">AGSIST cash farm lease</a>.</p></details>"""


def build_hub(states, stats, generated):
    yr = max(s["yr"] for s in stats.values())
    meds = sorted(s2["median"] for s2 in stats.values())
    # AUDIT 2026-08-11: one quintile scale across mixed land types ranked
    # TX $10 PASTURE against IA $270 CROPLAND as if comparable. Color each
    # tile against ITS OWN land-type peer group.
    meds_by_type = {}
    for s2 in stats.values():
        meds_by_type.setdefault(s2["primary"], []).append(s2["median"])
    for t in meds_by_type: meds_by_type[t].sort()
    def quint_color(v, ptype="nonirr"):
        peers = meds_by_type.get(ptype, meds)
        i = sum(1 for m in peers if m < v) / max(1, len(peers))
        return "#af3a32" if i >= .8 else ("#9c4b3d" if i >= .6 else ("#a8823c" if i >= .4 else ("#5a656a" if i >= .2 else "#396d4f")))
    tiles = []
    for ab, (c, r) in TILE.items():
        if ab in stats:
            st2 = stats[ab]
            tiles.append(f'<a class="rh-tile" href="/rent/{slug(STATE_NAMES[ab])}" style="--gc:{c};--gr:{r};background:{quint_color(st2["median"], st2["primary"])}"><span class="rh-tst">{ab}</span><span class="rh-tge">${round(st2["median"]):,}</span></a>')
        else:
            tiles.append(f'<div class="rh-tile dim" style="--gc:{c};--gr:{r}"><span class="rh-tst">{ab}</span></div>')
    tile_html = ('<div style="font-family:\'JetBrains Mono\',monospace;font-size:.66rem;letter-spacing:.1em;color:var(--text-muted);text-transform:uppercase;margin:16px 0 10px">'
        f'Median county rent per acre, {yr}, non-irrigated cropland. Tap a state for every county. ' + (', '.join(STATE_NAMES[x] for x in sorted(stats, key=lambda x: STATE_NAMES[x]) if stats[x]["primary"] != "nonirr") + ': no dryland rent published, so the tile shows irrigated cropland and is colored only against itself' if any(s2["primary"] != "nonirr" for s2 in stats.values()) else '') + '</div>'
        '<div class="rh-grid">' + "".join(tiles) + '</div>'
        '<div style="display:flex;gap:14px;justify-content:center;margin:12px 0 0;font-size:.74rem;color:var(--text-muted);flex-wrap:wrap">'
        '<span><b style="display:inline-block;width:13px;height:13px;border-radius:3px;vertical-align:-2px;margin-right:5px;background:#af3a32"></b>priciest fifth</span>'
        '<span><b style="display:inline-block;width:13px;height:13px;border-radius:3px;vertical-align:-2px;margin-right:5px;background:#a8823c"></b>middle</span>'
        '<span><b style="display:inline-block;width:13px;height:13px;border-radius:3px;vertical-align:-2px;margin-right:5px;background:#396d4f"></b>cheapest fifth</span>'
        '<span><b style="display:inline-block;width:13px;height:13px;border-radius:3px;vertical-align:-2px;margin-right:5px;background:#14181a;border:1px dashed #2a3133"></b>no data</span></div>')
    def type_med(s, t_):
        if s["primary"] == t_:
            return s["median"], s["n"]
        o = s["other"].get(t_)
        return (o["median"], o["n"]) if o else (None, 0)

    def cell(v):
        return f'<td data-v="{v}">{money(v)}</td>' if v is not None else '<td class="mut" data-v="-1">n/a</td>'

    NA_YOY = '<td class="mut" data-v="-999">n/a</td>'
    rows = []
    for st in sorted(states, key=lambda s: STATE_NAMES[s]):
        s = stats[st]
        yoy = (f'<td class="{"up" if s["yoy"] >= 0 else "dn"}" data-v="{s["yoy"]}">'
               f'{"+" if s["yoy"] >= 0 else ""}{s["yoy"]}%</td>') if s["yoy"] is not None \
            else '<td class="mut" data-v="-999">n/a</td>'
        dry = (f'<td data-v="{s["median"]}">{money(s["median"])}</td>' if s["primary"] == "nonirr"
               else '<td class="mut" data-v="-1">n/a</td>')
        rows.append(
            f'<tr><td><a href="/rent/{slug(STATE_NAMES[st])}" >{STATE_NAMES[st]}</a></td>'
            f'{dry}{yoy if s["primary"] == "nonirr" else NA_YOY}'
            f'<td data-v="{type_med(s, "nonirr")[1]}">{type_med(s, "nonirr")[1]}</td>'
            f'{cell(type_med(s, "irr")[0])}{cell(type_med(s, "pasture")[0])}</tr>')
    # the headline compares like with like: dryland cropland medians only
    medians = sorted(((s["median"], st) for st, s in stats.items() if s["primary"] == "nonirr"), reverse=True)
    no_dry = sorted((st for st, s in stats.items() if s["primary"] != "nonirr"), key=lambda x: STATE_NAMES[x])
    desc = (f"USDA county cash rent for all {len(states)} published states, {yr}: median $/acre, change vs "
            f"{yr-1}, and every county's rate one click deep. Free, sources shown.")[:160]
    jsonld = {"@context": "https://schema.org", "@graph": [
        {"@type": "CollectionPage", "name": f"Cash Rent by State, {yr}",
         "url": f"{SITE}/rent/", "isAccessibleForFree": True,
         "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE}},
        HUB_DATASET,
        {"@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": f["q"], "acceptedAnswer": {"@type": "Answer", "text": f["a"]}} for f in HUB_FAQ]},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "AGSIST", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "Cash Rent by State", "item": f"{SITE}/rent/"}]},
    ]}
    seed = (f"{len(states)} states &middot; non-irrigated cropland, highest state median: {STATE_NAMES[medians[0][1]]} "
            f"{money(medians[0][0])}/ac &middot; lowest: {STATE_NAMES[medians[-1][1]]} {money(medians[-1][0])}/ac"
            + (f" &middot; no dryland rent published for {len(no_dry)} ({', '.join(STATE_NAMES[x] for x in no_dry)})" if no_dry else "")
            + f" &middot; data refreshed {esc(generated)}")
    page = head(f"Cash Rent by State {yr}: Every County\u2019s USDA Rate", desc, "/rent/", jsonld) + f"""
<body>
<div id="site-header"></div>
<main class="rs-wrap">
  <h1>Cash Rent by State, {yr}</h1>
  <p class="sub">Pick a state for every published county&rsquo;s USDA cash rental rate, history to 2008, and the
  statutory lease-termination deadline where the state has one.
  <span id="rs-seed"><!--SEED:renthub-->{seed}<!--/SEED--></span></p>
  {atlas_line("/farmland-atlas")}
  {tile_html}
  <aside class="ag-sponsor-ribbon"><span class="ag-sponsor-tag">Sponsor this page</span> Your name on the cash rent page for every state. One category-exclusive slot. <span class="ag-sponsor-price" data-rate="page">{PAGE_RATE}</span> <a href="/sponsor-apply?slot=rent-hub&amp;utm_source=rent-hub&amp;utm_medium=slot">Put your name here &rarr;</a></aside>
  <div class="rs-tw"><table class="rs-t" id="rs-table"><thead><tr><th>State</th><th title="non-irrigated cropland, median of published counties">Non-irrigated</th><th>YoY</th><th>Counties</th><th title="irrigated cropland, shown apart">Irrigated</th><th title="permanent pasture, shown apart">Pasture</th></tr></thead>
  <tbody>{"".join(rows)}</tbody></table></div>
  <p class="sub">&ldquo;Rent&rdquo; here means non-irrigated (dryland) cropland: the median of every county NASS published in
  {yr}, the same counties the Farmland Atlas state pages use. Irrigated cropland and pasture are separate columns and never
  stand in for it. YoY compares only counties published in both years. For rent as a share of what the acre can gross,
  open any county on the <a href="/farmland-atlas" style="color:var(--gold)">Farmland Atlas</a> and tap the rent share calculator.</p>
  {HUB_EXPLAIN}
  {faq_html(HUB_FAQ)}
  <p class="sub" style="font-size:.75rem;margin:18px 0">Source: USDA NASS Cash Rents Survey county estimates.
  Pages rebuild automatically when NASS publishes (each August). Data refreshed {esc(generated)}.</p>
</main>
{explore_nav()}
<div id="site-footer"></div>
<script src="/components/loader.js?v=18"></script>
{SORT_JS}
</body>
</html>
"""
    return page


def build_all(out_dir=OUT_DIR):
    data = load_states()
    if not data:
        raise SystemExit("FATAL: no state files in data/cash-rent — refusing to build empty pages")
    stats = {st: state_stats(d) for st, d in data.items()}
    os.makedirs(out_dir, exist_ok=True)
    aslug = atlas_slugs()
    urls = [f"{SITE}/rent/"]
    open(os.path.join(out_dir, "index.html"), "w").write(
        build_hub(list(data), stats, next(iter(data.values())).get("generated", "")))
    for st, d in data.items():
        p = build_state_page(st, d, stats[st], list(data), aslug)
        open(os.path.join(out_dir, f"{slug(STATE_NAMES[st])}.html"), "w").write(p)
        urls.append(f"{SITE}/rent/{slug(STATE_NAMES[st])}")
    # stderr, NOT stdout: --print-urls pipes stdout into the sitemap step,
    # and this line as line 1 of that file broke the first live run (exit 2).
    print(f"built {len(data)} state pages + hub -> {out_dir}/", file=sys.stderr)
    return urls, stats


def selftest():
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        urls, stats = build_all(out_dir=td)
        assert len(urls) >= 40, f"expected ~48 URLs, got {len(urls)}"
        ia = open(os.path.join(td, "iowa.html")).read()
        s = stats["IA"]
        assert s["primary"] == "nonirr", "IA primary type wrong"
        assert money(s["median"]) in ia, "IA median not baked into page"
        assert "SEED:rentstate" in ia and "FAQPage" in ia and "canonical" in ia
        assert "September 1" in ia, "IA termination notice missing"
        assert 'no survey' in ia, "2015 gap not shown honestly"
        assert 2018 in NO_SURVEY_YEARS, "2018 (no NASS county survey) must be labeled no survey"
        assert ia.count("<tr>") >= 99, "IA county rows missing"
        assert "/rent/texas" in ia, "state cloud missing"
        assert "an Iowa farm lease" in ia and "a Iowa" not in ia, "article a/an wrong"
        # every FAQPage question and answer is printed on the page, verbatim
        import re as _re
        for blk in _re.findall(r'<script type="application/ld\+json">(.*?)</script>', ia, _re.S):
            for g in json.loads(blk)["@graph"]:
                if g["@type"] == "FAQPage":
                    for q in g["mainEntity"]:
                        assert esc(q["name"]) in ia and esc(q["acceptedAnswer"]["text"]) in ia, "FAQ not visible: " + q["name"]
        # county names link to Farmland Atlas pages that exist on disk
        hrefs = _re.findall(r'href="/farmland-atlas/([^"#]+)"', ia)
        assert len(hrefs) >= 99, f"IA atlas links missing ({len(hrefs)})"
        bad = [h for h in hrefs if not os.path.exists(os.path.join("farmland-atlas", h + "index.html" if h.endswith("/") else h + ".html"))]
        assert not bad, f"atlas links with no page: {bad[:5]}"
        # the door into the Atlas sits above the hero, on the state's own Atlas page
        assert 'Part of the <a href="/farmland-atlas/iowa/">Farmland Atlas</a>: land values, rent and risk for every county.' in ia
        assert ia.index('class="rs-atlas"') < ia.index('class="rs-hero"'), "Atlas line not near the top"
        for st_ in stats:
            pg = open(os.path.join(td, f"{slug(STATE_NAMES[st_])}.html")).read()
            assert pg.count('class="rs-atlas"') == 1, f"{st_}: Atlas line missing"
            for h_ in _re.findall(r'href="/farmland-atlas/([^"#]+)"', pg):
                assert os.path.exists(os.path.join("farmland-atlas", h_ + "index.html" if h_.endswith("/") else h_ + ".html")), f"{st_}: {h_} has no page"
        hub = open(os.path.join(td, "index.html")).read()
        # /cash-rent is retired: nothing here may link to it
        for st_ in list(stats) + ["index"]:
            pg = open(os.path.join(td, ("index" if st_ == "index" else slug(STATE_NAMES[st_])) + ".html")).read()
            assert 'href="/cash-rent' not in pg, f"{st_}: links the retired /cash-rent"
        # the hub headline compares like land types: dryland medians only
        seed_ = hub.split("<!--SEED:renthub-->")[1].split("<!--/SEED-->")[0]
        dry_ = sorted((s_["median"], k) for k, s_ in stats.items() if s_["primary"] == "nonirr")
        assert money(dry_[0][0]) in seed_ and money(dry_[-1][0]) in seed_, seed_
        assert all(s_["primary"] == "nonirr" for k, s_ in stats.items() if k not in ("AZ", "NV")), \
            {k: s_["primary"] for k, s_ in stats.items() if s_["primary"] != "nonirr"}
        # the moved /cash-rent FAQ and Dataset are on the hub, visibly
        assert "#dataset" in hub and hub.count('class="rs-faq"') >= 11, "hub explainer or FAQ missing"
        for blk in _re.findall(r'<script type="application/ld\+json">(.*?)</script>', hub, _re.S):
            for g in json.loads(blk)["@graph"]:
                if g["@type"] == "FAQPage":
                    for q in g["mainEntity"]:
                        assert esc(q["name"]) in hub and esc(q["acceptedAnswer"]["text"]) in hub, "hub FAQ not visible: " + q["name"]
        # one county set: a state's dryland median here is the Farmland Atlas state median
        cards_p = os.path.join("farmland-atlas", "data", "cards.json")
        if os.path.exists(cards_p):
            cj = json.load(open(cards_p))
            off = {k: (s_["median"], (cj["states"].get(k) or {}).get("r")) for k, s_ in stats.items()
                   if s_["primary"] == "nonirr" and k != "CT" and (cj["states"].get(k) or {}).get("r") is not None
                   and abs(s_["median"] - cj["states"][k]["r"]) > 0.001}
            assert not off, f"rent page and Atlas state medians disagree: {off}"
        assert hub.count("/rent/") >= 47 and "SEED:renthub" in hub
        assert 'Part of the <a href="/farmland-atlas">Farmland Atlas</a>' in hub, "hub Atlas line missing"
        assert "&amp;rsquo;" not in hub, "hub title double-escaped"
        # NV/AZ: irrigated-primary states must be labeled
        if "AZ" in stats:
            az = open(os.path.join(td, "arizona.html")).read()
            assert TYPE_LABEL[stats["AZ"]["primary"]].split()[0] in az
        print(f"SELFTEST OK — {len(urls)} URLs; IA baked stats, FAQ, notice, gap honesty, "
              f"county rows, link cloud, hub all verified")


def main():
    if "--selftest" in sys.argv:
        return selftest()
    if "--print-urls" in sys.argv:
        # stdout is the URL list and NOTHING else — the workflow pipes it
        # straight into update_sitemap.py --add. Any stray print anywhere in
        # build_all is forced to stderr so this can never break again.
        import contextlib
        with contextlib.redirect_stdout(sys.stderr):
            urls, _ = build_all()
        print("\n".join(urls))
    else:
        build_all()


if __name__ == "__main__":
    main()
