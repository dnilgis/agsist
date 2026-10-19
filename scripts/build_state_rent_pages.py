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
  - On the /rent hub, "rent" means non-irrigated (dryland) cropland rent, the
    same definition the Farmland Atlas and data/cash-rent/national.json use, so
    states compare like with like. A state page leads with the cropland rent
    NASS published for more of that state's counties (lead_kind: irrigated in
    CA, OR, ID, UT, CO, NM, WY, AZ, NV in 2026; dryland everywhere else), and
    prints the other kinds beside it, labeled. Every table/stat SAYS which it is.
  - County medians of published counties only, labeled as such.

No naked squiggles: history is a labeled bar table (year + $ printed on
every bar), not a sparkline.

--selftest builds everything to a temp dir and asserts invariants.
"""
import glob
import html
import json
import os
import re
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_cash_rent import NO_SURVEY_YEARS, REASON_MIXED, pair_county  # noqa: E402  (stdlib-only module, main() guarded)

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
    "IA": "September 1 before the lease year ends (Iowa Code &sect;562.6)",
    "IL": "4 months before the end of the lease year (735 ILCS 5/9-206)",
    "IN": "3 months before the end of the lease year (Ind. Code &sect;32-31-1-3)",
    "KS": "30 days before March 1 (K.S.A. &sect;58-2506)",
    "NE": "September 1 for oral year-to-year leases (Nebraska case law, Moudry v. Parkos, 1984)",
    "SD": "September 1 before the new lease year (SDCL &sect;43-32-22.1, oral leases)",
}



TILE = {"AK":(1,1),"ME":(12,1),"VT":(11,2),"NH":(12,2),"WA":(2,3),"MT":(3,3),"ND":(4,3),"SD":(5,3),"MN":(6,3),"WI":(7,3),"MI":(8,3),"NY":(10,3),"MA":(11,3),"RI":(12,3),"OR":(2,4),"ID":(3,4),"WY":(4,4),"NE":(5,4),"IA":(6,4),"IL":(7,4),"IN":(8,4),"OH":(9,4),"PA":(10,4),"NJ":(11,4),"CT":(12,4),"CA":(2,5),"NV":(3,5),"UT":(4,5),"CO":(5,5),"KS":(6,5),"MO":(7,5),"KY":(8,5),"WV":(9,5),"VA":(10,5),"MD":(11,5),"DE":(12,5),"AZ":(3,6),"NM":(4,6),"OK":(5,6),"AR":(6,6),"TN":(7,6),"NC":(8,6),"SC":(9,6),"TX":(5,7),"LA":(6,7),"MS":(7,7),"AL":(8,7),"GA":(9,7),"HI":(1,8),"FL":(10,8)}

def rent_verdict(yoy):
    if yoy is None:  return ("NOT ENOUGH MATCHED COUNTIES", "#8a948f")
    if yoy >= 3:     return ("RENT ROSE", "#e0685f")
    if yoy >= 0.5:   return ("RENT EDGED UP", "#d4a23f")
    if yoy > -0.5:   return ("RENT HELD FLAT", "#8a948f")
    if yoy > -3:     return ("RENT EASED", "#5fc28a")
    return ("RENT FELL", "#5fc28a")

def reconcile_verdict(vw, sa_chg, have_sa=True):
    """The headline word comes from the median of matched counties. When USDA's own
    state average moved the other way (Illinois 2026: counties flat, state average
    $264 to $261), say both, so the page does not read 'held flat' against a decline.
    When the data file has no state average yet (have_sa False), the word is named
    as the middle county's, never as the state's (2026-10-16: Illinois still read
    'RENT HELD FLAT' with no state figure on file)."""
    if not have_sa:
        return vw.replace("RENT ", "MIDDLE COUNTY ", 1) if vw.startswith("RENT ") else vw
    if sa_chg is None or abs(sa_chg) < 1:
        return vw
    up_word = vw in ("RENT ROSE", "RENT EDGED UP")
    down_word = vw in ("RENT EASED", "RENT FELL")
    if (sa_chg > 0 and up_word) or (sa_chg < 0 and down_word):
        return vw
    return (vw.replace("RENT ", "MIDDLE COUNTY ", 1) + " &middot; STATE AVERAGE "
            + ("UP" if sa_chg > 0 else "DOWN") + f" ${abs(sa_chg):,.0f}")


def state_avg_line(name, plabel, yr, s):
    """NASS's statewide average beside our median, with its change, and why the two differ."""
    sa, prev, chg = s.get("state_avg"), s.get("state_avg_prev"), s.get("state_avg_chg")
    if sa is None:
        return ""
    move = ""
    if chg is not None:
        move = (f", {'up' if chg > 0 else 'down'} {money(abs(chg))} from {money(prev)} in {yr-1}" if abs(chg) >= 1
                else f", about the same as {money(prev)} in {yr-1}")
    return (f'<div class="rs-rel">USDA NASS&rsquo;s {name} state average for {plabel}: <b>{money(sa)} an acre</b> in {yr}{move}. '
            f'The two differ because the state figure is NASS&rsquo;s own estimate for the whole state; the middle county '
            f'counts each county once, big or small.</div>')


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


def prf_href(st, root="."):
    """The state's PRF page (another builder writes prf/<state>.html), only when it is on disk."""
    sl = slug(STATE_NAMES[st])
    return f"/prf/{sl}" if os.path.exists(os.path.join(root, "prf", sl + ".html")) else ""


def prf_line(st, root="."):
    """One plain line from pasture rent to the state's PRF page. Empty when
    the state has no PRF page."""
    href = prf_href(st, root)
    if not href:
        return ""
    return (f'<p class="sub">Insuring pasture or hay ground? See <a href="{href}" style="color:var(--gold)">'
            f'PRF rainfall insurance in {STATE_NAMES[st]}</a>: county values, what each pair of months costs, '
            f'and every year since 1951.</p>')


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


def lead_kind(coverage):
    """Which rent a state page leads with (title, description, hero, stats, history).

    The rule, from the data alone: of the two cropland rents, the one NASS
    published for more counties in the latest year leads; a tie goes to
    non-irrigated. A county rate is published only where enough leases of that
    kind came back in the survey, so more published counties means more of the
    state's rented cropland is that kind. California 2026: irrigated 41 counties,
    non-irrigated 20, so the page leads with irrigated ($437), not the $34.75
    dryland figure a California searcher would read as wrong. A cropland kind
    needs MIN_DRY counties to lead at all; with neither, the kind with the most
    counties leads (Nevada: irrigated 5, nothing else). Pasture leads only when
    no cropland kind has MIN_DRY counties. The other kinds are always printed
    beside the lead, labeled."""
    crop = [t for t in ("nonirr", "irr") if coverage.get(t, 0) >= MIN_DRY]
    if crop:
        return "irr" if "irr" in crop and coverage["irr"] > coverage.get("nonirr", 0) else crop[0]
    return max(("irr", "pasture"), key=lambda t: coverage.get(t, 0))


def state_stats(d):
    """Everything the page needs, computed once, honesty rules applied."""
    counties = d.get("counties", [])
    yr_latest = max(int(y) for y in d.get("years", [2025]))
    coverage = {t: sum(1 for c in counties if str(yr_latest) in c["rent"].get(t, {}))
                for t in ("nonirr", "irr", "pasture")}
    primary = lead_kind(coverage)
    have_types = [t for t in ("nonirr", "irr", "pasture") if coverage[t]]

    cur = {c["name"]: c["rent"][primary][str(yr_latest)]
           for c in counties if str(yr_latest) in c["rent"].get(primary, {})}

    def matched_delta(back_to, t=primary):
        pairs = [(c["rent"][t][str(yr_latest)], c["rent"][t][str(back_to)])
                 for c in counties
                 if str(yr_latest) in c["rent"].get(t, {})
                 and str(back_to) in c["rent"].get(t, {})]
        if len(pairs) < 5:
            return None, 0
        now = med([p[0] for p in pairs]); then = med([p[1] for p in pairs])
        return round(100 * (now - then) / then, 1), len(pairs)

    yoy, yoy_n = matched_delta(yr_latest - 1)
    # the two medians behind yoy, so the page can say the change is the state
    # median's, not a typical county's (money audit 7, 2026-10-19: Iowa's median
    # went $270 -> $266, -1.5%, while the middle county's own change was 0.0%)
    yp = [(c["rent"][primary][str(yr_latest)], c["rent"][primary][str(yr_latest - 1)]) for c in counties
          if str(yr_latest) in c["rent"].get(primary, {}) and str(yr_latest - 1) in c["rent"].get(primary, {})]
    yoy_med = (med([p[1] for p in yp]), med([p[0] for p in yp])) if yoy is not None else None
    # the dryland figures on their own, whatever leads: the /rent hub compares
    # states on dryland only, so a state led by irrigated rent still has one
    dry = None
    if coverage["nonirr"] >= MIN_DRY:
        dv = [c["rent"]["nonirr"][str(yr_latest)] for c in counties if str(yr_latest) in c["rent"].get("nonirr", {})]
        dy, dyn = matched_delta(yr_latest - 1, "nonirr")
        dry = {"median": med(dv), "n": len(dv), "yoy": dy, "yoy_n": dyn}
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
    # NASS's own statewide figure for the headline type, when the fetch has it
    sa_all = (d.get("state_avg") or {}).get(primary, {})
    sa = sa_all.get(str(yr_latest))
    sa_prev = sa_all.get(str(yr_latest - 1)) if sa is not None else None   # last year's figure never stands in for this year's
    # rent per bushel of trend yield, per county: dryland only, same year, same
    # practice (pair_county), computed here so the page only multiplies
    ground = []
    if primary == "nonirr":
        for c in sorted(counties, key=lambda c: c["name"]):
            r_ = c["rent"].get("nonirr", {}).get(str(yr_latest))
            t_ = (((pair_county(c) or {}).get("corn") or {}).get("t") or {}).get("v")
            if r_ and t_:
                ground.append({"n": c["name"], "f": c.get("fips"), "r": r_, "t": t_,
                               "b": round(r_ / t_, 2)})
    return {
        "state_avg": sa, "state_avg_prev": sa_prev,
        "state_avg_chg": round(sa - sa_prev, 2) if sa is not None and sa_prev is not None else None,
        "ground": ground,
        "other": other, "dry": dry,
        "yr": yr_latest, "primary": primary, "have_types": have_types,
        "coverage": coverage, "n": len(cur), "median": med(list(cur.values())),
        "yoy": yoy, "yoy_n": yoy_n, "yoy_med": yoy_med, "dec": dec, "dec_n": dec_n,
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
  <script>/* agsist-theme-early: saved theme, else the device's, set before first paint so pages do not flash the wrong color. loader.js applies the same rule. */try{{var _t=localStorage.getItem('agsist-theme');if(_t!=='light'&&_t!=='dark')_t=window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.setAttribute('data-theme',_t);}}catch(e){{}}</script><script>/* agsist-ga-guard 2026-10-17: Google Analytics loads only when the browser sends no Global Privacy Control signal, the off switch on /privacy is not set and the browser is not automated (navigator.webdriver, or a headless, Lighthouse or bot UA string), and only once the page is shown (a page loaded ahead in the background is not a visit). dataLayer and gtag always exist, so page code that calls them never throws. */(function(w,d,n){{var off=false,v,i,s,u;w.dataLayer=w.dataLayer||[];if(typeof w.gtag!=='function'){{w.gtag=function(){{w.dataLayer.push(arguments);}};}}try{{off=w.localStorage.getItem('agsist-ga-off')==='1';}}catch(e){{}}if(n.globalPrivacyControl===true){{off=true;}}u=n.userAgent||'';if(n.webdriver===true||(/HeadlessChrome|PhantomJS|Lighthouse|bot|crawler|spider/i.test(u)&&!/cubot/i.test(u))){{off=true;}}w.agsistGaOff=off;w.gtag('set','allow_google_signals',false);w.gtag('set','allow_ad_personalization_signals',false);if(off){{return;}}i=function(){{s=d.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H';(d.head||d.documentElement).appendChild(s);}};if(d.prerendering){{d.addEventListener('prerenderingchange',i,{{once:true}});}}else{{i();}}}})(window,document,navigator);</script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-6KXCTD5Z9H');function gaEvent(n,p){{try{{gtag('event',n,p||{{}});}}catch(e){{}}}}</script>
  <!-- the two fonts these pages use, fetched alongside the stylesheet: without them the
       text reflowed when the fonts arrived (CLS 0.119 on /rent/wisconsin, 2026-10-12).
       Same files as scripts/inject_static_nav.py FONTS. -->
  <link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/jetbrains-mono-var.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/components/styles.css?v=24" as="style">
  <link rel="stylesheet" href="/components/styles.css?v=24">
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
  <meta property="og:image" content="{SITE}/img/og/rent.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="{esc(title)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@agsist">
  <meta name="twitter:title" content="{esc(title)}">
  <meta name="twitter:description" content="{esc(desc)}">
  <meta name="twitter:image" content="{SITE}/img/og/rent.jpg">
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
    .rs-swipe{{display:none}}
    .rs-tnote{{font-size:.78rem;margin:4px 0 10px}}
    @media (max-width:640px){{
      .rs-swipe{{display:block;color:var(--text-muted);font-size:.75rem;margin:8px 0 -4px}}
      .rs-t th{{white-space:normal;vertical-align:bottom;letter-spacing:.03em;padding:6px 7px;line-height:1.25}}
      .rs-t td{{padding:6px 7px;font-size:.8rem}}
    }}
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
    .rs-rel{{font-size:.8rem;color:#8a948f;margin-top:6px}}
    .rs-gr{{border:1px solid var(--border-2);border-radius:10px;padding:12px 16px;margin:14px 0}}
    .rs-gr h2{{margin:2px 0 6px}}
    .rs-gr label{{display:inline-flex;flex-direction:column;gap:3px;font-size:.75rem;color:var(--text-muted);margin:4px 12px 4px 0}}
    .rs-gr select,.rs-gr input{{font:inherit;font-size:1rem;padding:7px 9px;border-radius:7px;border:1px solid var(--border-2);background:var(--bg);color:var(--text);min-height:40px}}
    .rs-gr input{{width:7.5em}}
    .rs-gr select{{max-width:16em}}
    .rs-gr-out{{font-size:1.02rem;line-height:1.6;color:var(--text);margin:8px 0 4px}}
    .rs-gr-out b{{color:var(--gold)}}
    .rs-gr .sub{{font-size:.84rem}}
    .rs-gr details{{margin-top:6px}}
    .rs-gr summary{{cursor:pointer;color:var(--text);font-size:.92rem;padding:6px 0}}
    .rs-gr .m{{margin:10px 0;padding-top:8px;border-top:1px solid var(--border)}}
    .rs-gr .m p{{margin:4px 0}}
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
                        f'<span class="gap">{h["why"]}</span></div>')
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
    thead += ('<th>YoY</th><th title="county corn yield, 14-year least-squares trend projected to %s, fitted on the same '
              'practice as the rent (dryland, or all practices where NASS shows no irrigation)">Corn trend %s</th>' % (s["ty"], s["ty"]))
    body, seen = [], set()
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
        tr = ((pair_county(c) or {}).get("corn") or {}).get("t", {})
        ct = tr.get("v")
        if ct is not None:
            lab = f"{ct:.0f} bu"
        else:
            # say WHY there is no trend instead of a bare n/a (the pairing rule withholds it on purpose)
            why, ends = tr.get("w") or "", re.search(r"ends in (\d{4})", tr.get("w") or "")
            if ends:
                lab, k = f"ends {ends.group(1)}", "ends"
            elif REASON_MIXED in why:
                lab, k = "mixed", "mixed"
            else:
                lab, k = "n/a", "na"
            seen.add(k)
            lab = f'<span class="mut">{lab}</span>'
        cells.append(f'<td data-v="{ct if ct is not None else -1}">{lab}</td>')
        body.append("<tr>" + "".join(cells) + "</tr>")
    keys = [("mixed", "<b>mixed</b>: NASS publishes only an all-practice corn yield for the county, and the county "
                      "also irrigates, so that yield is withheld rather than set beside dryland rent"),
            ("ends", "<b>ends</b>: the county&rsquo;s yield series stopped that year, too long ago to project"),
            ("na", "<b>n/a</b>: too few years of county yield on record")]
    note = "; ".join(t for k, t in keys if k in seen)
    return (f'<p class="rs-swipe">Swipe the table sideways for every column.</p>'
            f'<div class="rs-tw"><table class="rs-t" id="rs-table"><thead><tr>{thead}</tr></thead>'
            f'<tbody>{"".join(body)}</tbody></table></div>'
            + (f'<p class="sub rs-tnote">Corn trend: {note}.</p>' if note else ""))


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


def rent_ask(st, name, yr):
    """One line under the county table: one email when NASS puts out the next
    year's county rents for this state. components/signup-ask.js draws it and
    posts topic rent:<st> to the subs worker's /notice (v5.11); it puts nobody
    on AGSIST Daily unless they tick the box for it."""
    return (f'<div data-signup-ask="Email me when the {yr + 1} county rents for {name} come out." data-topic="rent:{st.lower()}" '
            f'data-ok="Done. One email when USDA puts out the {yr + 1} {name} county rents, usually in August."></div>')


GROUND_MIN = 3   # counties with both a current dryland rent and a trend before the panel shows

GROUND_JS = """<script>
(function(){var el=document.getElementById('gr-data');if(!el)return;var D=JSON.parse(el.textContent);
var $=function(i){return document.getElementById(i);},sel=$('gr-co'),y=$('gr-y'),pr=$('gr-p'),sh=$('gr-s'),lv=$('gr-v'),rr=$('gr-r');
var shDirty=false,sent=false;
D.c.forEach(function(c,i){var o=document.createElement('option');o.value=i;o.textContent=c[0];if(c[0]===D.mid)o.selected=true;sel.appendChild(o);});
function cur(){return D.c[+sel.value];}
function usd(v){return '$'+Math.round(v).toLocaleString('en-US');}
function rent(v){return Math.round(v)===v?usd(v):'$'+v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function num(e){var v=parseFloat(String(e.value).replace(/[$,%\\s]/g,''));return isFinite(v)?v:NaN;}
function cname(c){return c[0]+' '+D.unit;}
function ownShare(c,p){return p>0?Math.round(10000*c[1]/(c[2]*p))/100:NaN;}
function draw(){var c=cur(),Y=num(y),p=num(pr);
 if(!shDirty){var s0=ownShare(c,p);sh.value=isFinite(s0)?s0:'';}
 var S=num(sh);
 if(!(Y>=1&&Y<=400)){$('gr-out').textContent='Type a yield between 1 and 400 bushels.';$('gr-math').textContent='';}
 else{var est=c[1]*Y/c[2];
  $('gr-out').innerHTML='At <b>'+Y+' bu</b> ground in '+cname(c)+', the '+D.unit.toLowerCase()+'&rsquo;s rent per bushel says about <b>'+usd(est)+' an acre</b>.';
  $('gr-math').textContent=cname(c)+': '+rent(c[1])+' rent \u00f7 '+c[2]+' bu trend = $'+c[3].toFixed(2)+' a bushel. '+rent(c[1])+' \u00d7 '+Y+' \u00f7 '+c[2]+' = '+usd(est)+'.';}
 if(Y>=1&&Y<=400&&p>0&&S>0&&S<100){var g=Y*p;$('gr-sg').textContent=Y+' bu \u00d7 $'+p.toFixed(2)+' = '+usd(g)+' gross. '+S+'% of that is '+usd(g*S/100)+' an acre.';}
 else $('gr-sg').textContent='Type a yield, a price and a share to see it.';
 var V=num(lv),R=num(rr);
 if(V>0&&R>0&&R<100)$('gr-lv').textContent=usd(V)+' \u00d7 '+R+'% = '+usd(V*R/100)+' an acre.';
 else $('gr-lv').textContent='Type your land value and the return you want on it.';
 var a=$('gr-atlas');if(a){if(c[4]){a.href='/farmland-atlas/'+c[4];a.textContent=cname(c)+' on the Farmland Atlas';}else{a.removeAttribute('href');a.textContent=cname(c)+' (no Atlas page yet)';}}
 if(!sent&&document.activeElement&&document.activeElement.closest&&document.activeElement.closest('.rs-gr')){sent=true;gaEvent('rent_ground',{st:D.st});}
}
sel.addEventListener('change',function(){y.value=Math.round(cur()[2]);draw();});
sh.addEventListener('input',function(){shDirty=sh.value!=='';draw();});
[y,pr,lv,rr].forEach(function(e){e.addEventListener('input',draw);});
y.value=Math.round(cur()[2]);draw();
})();
</script>"""


def ground_panel(st, d, s, aslug=None):
    """'Rent for your ground': the county's rent per bushel of its own trend
    yield (computed in state_stats, same practice, same year), which the page
    multiplies by the reader's yield. Two more methods (share of gross, return
    on land value) run only on numbers the reader types, except the default
    price, which is the state's NASS price received, labeled with its year.
    Empty string when the state has too few counties to say anything."""
    g = s.get("ground") or []
    if len(g) < GROUND_MIN:
        return "", ""
    name, yr = STATE_NAMES[st], s["yr"]
    unit = "Parish" if st == "LA" else "County"
    plural = "parishes" if st == "LA" else "counties"
    # the default county: the middle county (rent nearest the state median)
    mid = min(g, key=lambda c: (abs(c["r"] - s["median"]), c["n"]))["n"]
    corn = (d.get("prices") or {}).get("corn") or {}
    py, pv = latest(corn)
    prelim = py in (d.get("price_prelim") or [])
    data = {"st": st, "unit": unit, "mid": mid,
            "c": [[c["n"], c["r"], c["t"], c["b"], (aslug or {}).get(c["f"]) or ""] for c in g]}
    blob = json.dumps(data, separators=(",", ":")).replace("</", "<\\/")
    plab = (f"Default: {name}&rsquo;s {py} average price received for corn (USDA NASS{', preliminary' if prelim else ''})."
            if pv else "Type the price you expect.")
    html_ = f"""
  <section class="rs-gr" id="your-ground">
  <h2>Rent for your ground, not the county average</h2>
  <p class="sub">The county number doesn&rsquo;t know your ground. This scales the county&rsquo;s {yr} rent by your own corn yield.</p>
  <label>{unit} <select id="gr-co"></select></label>
  <label>Your corn yield, bu/ac <input id="gr-y" type="number" inputmode="decimal" min="1" max="400" step="1"></label>
  <p class="rs-gr-out" id="gr-out" aria-live="polite">Pick a {unit.lower()} and type your yield.</p>
  <p class="sub" id="gr-math" style="color:var(--text)"></p>
  <p class="sub">Derived by AGSIST, not a NASS number: the {unit.lower()}&rsquo;s {yr} NASS dryland rent divided by its {s['ty']} corn
  trend yield (our 14-yr trend, same practice as the rent), times your yield. It assumes rent moves in step with yield,
  which real leases only roughly do. Use your APH or a typical year, not your best one. {len(g)} of {s['n']} {name}
  {plural} have both numbers; for the rest the Corn trend column below says why there is none.</p>
  <details><summary>Two more ways to figure a fair rent</summary>
  <div class="m"><p><b>Share of gross.</b> Your bushels times a price, and the share of that the rent takes. The share starts at the
  {unit.lower()}&rsquo;s own: its {yr} rent as a share of its trend-yield gross at this price.</p>
  <label>Corn price, $/bu <input id="gr-p" type="number" inputmode="decimal" min="0" step="0.05" value="{f'{pv:.2f}' if pv else ''}"></label>
  <label>Share of gross, % <input id="gr-s" type="number" inputmode="decimal" min="0" max="99" step="0.5"></label>
  <p class="sub">{plab}</p>
  <p class="rs-gr-out" id="gr-sg"></p></div>
  <div class="m"><p><b>Return on land value.</b> What the land is worth times the return an owner wants on it.</p>
  <label>Land value, $/ac <input id="gr-v" type="number" inputmode="decimal" min="0" step="100"></label>
  <label>Return, % <input id="gr-r" type="number" inputmode="decimal" min="0" max="99" step="0.1"></label>
  <p class="rs-gr-out" id="gr-lv"></p></div>
  <div class="m"><p><b>Cost-based.</b> What is left of your gross after your own costs and pay for your work. That needs
  your budget, so this page doesn&rsquo;t guess one.</p></div>
  <p class="sub">For rent as a share of gross year by year since 2008, open <a id="gr-atlas" style="color:var(--gold)">the Farmland Atlas</a> and its rent share calculator.</p>
  </details>
  <script type="application/json" id="gr-data">{blob}</script>
  </section>"""
    return html_, GROUND_JS


DESC_WORD = {"nonirr": "non-irrigated", "irr": "irrigated", "pasture": "pasture"}


def lead_why(name, s):
    """Why this rent leads the page, in the page's words, from the counts."""
    cv, p = s["coverage"], s["primary"]
    if p == "nonirr":
        return (f"published for {cv['nonirr']} {name} counties against {cv['irr']} irrigated"
                if cv["irr"] else f"the only cropland rent NASS publishes for {name}")
    if p == "irr" and cv["nonirr"] >= MIN_DRY:
        return f"published for more {name} counties ({cv['irr']}) than non-irrigated ({cv['nonirr']})"
    return f"NASS published non-irrigated rent for fewer than {MIN_DRY} {name} counties"


def other_crop_line(name, yr, s):
    """One sentence under the lead: the other cropland rent, when NASS has it."""
    alt = "irr" if s["primary"] == "nonirr" else "nonirr"
    o = s["other"].get(alt)
    if not o or s["primary"] == "pasture":
        return ""
    return f" For {TYPE_LABEL[alt]} the middle county paid {money(o['median'])} ({o['n']} counties)."


def rent_desc(name, yr, s):
    """The meta description: the lead rent first, then every other kind NASS
    published for MIN_DRY+ counties (the other cropland kind before pasture), so
    a searcher who wanted the other one sees it too. First form that fits 160."""
    m, n, plabel = money(s["median"]), s["n"], TYPE_LABEL[s["primary"]]
    others = [(t, s["other"][t]) for t in ("nonirr", "irr", "pasture") if t in s["other"]]
    crop_only = [(t, o) for t, o in others if t != "pasture"]
    # 2026-10-18 search-terms check: "cash rents by county per acre" (262 impressions, position 4.3),
    # "usda cash rent by county" (91), "indiana cash rent by county per acre": the searcher's words lead.
    leads = (f"{name} cash rent by county {yr}: median {m}/acre ({plabel}) across {n} counties",
             f"{name} cash rent {yr}: {plabel} {m}/acre, median of {n} counties")
    tails = (f" Every county's USDA rate, history to {s['y0']}.", " Every county's USDA rate.", "")
    for keep in ((others, crop_only) if crop_only and len(crop_only) < len(others) else (others,)):
        for lead in leads:
            for tail in tails:
                for unit in ("/acre", ""):
                    mid = ("; " + ", ".join(f"{DESC_WORD[t]} {money(o['median'])}{unit}" for t, o in keep)) if keep else ""
                    if len(lead + mid + "." + tail) <= 160:
                        return lead + mid + "." + tail
    return (leads[1] + ".")[:160]


TITLE_MAX = 68   # with " | AGSIST"; the same ceiling scripts/bake_seo.py uses


def rent_title(name, yr, s):
    """The state title: the searched words, then the lead median with its kind when
    it is not dryland (California's $437 is irrigated and says so). Drops words
    from the end until it fits; never a figure without its label."""
    m = money(s["median"])
    kind = {"irr": " Irrigated", "pasture": " Pasture"}.get(s["primary"], "")
    for t in (f"{name} Cash Rent by County {yr}: {m}/Acre{kind or ' Median'}",
              f"{name} Cash Rent by County {yr}: {m}/Acre{kind}" if kind else None,
              f"{name} Cash Rent by County {yr}"):
        if t and len(t + " | AGSIST") <= TITLE_MAX:
            return t
    return f"{name} Cash Rent by County {yr}"


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
    title = rent_title(name, yr, s)
    desc = rent_desc(name, yr, s)
    pas = s["other"].get("pasture")
    hi_s = ", ".join(f"{n} ({money(v)})" for n, v in s["hi"][:3])
    lo_s = ", ".join(f"{n} ({money(v)})" for n, v in s["lo"][:3])
    faq = [
        {"q": f"What is the average cash rent per acre in {name} for {yr}?",
         "a": ((f"USDA NASS puts the {name} statewide average for {plabel} at {money(s['state_avg'])} per acre in {yr}. "
                f"The middle county on this page pays {money(s['median'])}: half of the {s['n']} counties with a published "
                f"{yr} rate are above it and half below. They are different measures. The state figure is NASS's estimate "
                f"for the whole state; the middle county counts each county once, big or small. Rents vary widely by county: ")
               if s.get("state_avg") else
               (f"The middle {name} county pays {money(s['median'])} per acre for {plabel}: half of the {s['n']} counties "
                f"with a published {yr} USDA NASS rate are above it and half below. NASS also puts out its own statewide "
                f"average, a separate figure that is not shown here. Rents vary widely by county: ")
               + (f"highest {hi_s}; lowest {lo_s}." if lo_s
                  else f"highest {hi_s}. With under five published counties, a highest/lowest split would overstate the sample.")
               + other_crop_line(name, yr, s)
               + " The county mean is a survey reference point, not a rate card.")},
        {"q": f"How much did {name} cash rent change from {yr-1} to {yr}?",
         "a": (f"Comparing the same {s['yoy_n']} counties published in both years, the median {plabel} rent went from "
               f"{money(s['yoy_med'][0])} to {money(s['yoy_med'][1])}, {'+' if s['yoy'] and s['yoy'] >= 0 else ''}{s['yoy']}% year over year. "
               f"That is the change in the state median, not in a typical county: each county's own rent moved its own way."
               if s["yoy"] is not None else
               "Too few counties were published in both years for a clean year-over-year figure.")},
        {"q": f"Why is my {name} county not listed?",
         "a": "USDA NASS publishes a county rate only where enough Cash Rents Survey responses came back "
              "(and the county has at least 20,000 acres of cropland plus pasture). If your county is missing, "
              "NASS did not publish a rate for it."},
        {"q": "When is county cash rent data released?",
         "a": "USDA NASS releases county cash rent estimates each August for the current crop year. "
              "This page rebuilds automatically when new data lands."},
    ]
    if pas:
        pv = sorted(((c["rent"]["pasture"][str(yr)], c["name"]) for c in s["counties"]
                     if str(yr) in c["rent"].get("pasture", {})), reverse=True)
        p_hi = ", ".join(f"{n} ({money(v)})" for v, n in pv[:3])
        p_lo = ", ".join(f"{n} ({money(v)})" for v, n in pv[-3:][::-1])
        faq.insert(1, {"q": f"How much does pasture rent for per acre in {name}?",
                       "a": (f"The median USDA NASS county cash rent for permanent pasture in {name} is {money(pas['median'])} "
                             f"per acre across the {pas['n']} counties with a published {yr} pasture rate. "
                             + (f"Highest {p_hi}; lowest {p_lo}. " if len(pv) >= 5 else "")
                             + "Each county's pasture rate is in its own column in the county table below.")})
    if st in NOTICE:
        faq.append({"q": f"When must I give notice to terminate {article(name)} {name} farm lease?",
                    "a": f"{name} law sets the deadline at {NOTICE[st].replace('&sect;', 'section ')}. "
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
            + (f" &middot; state median {'+' if s['yoy'] >= 0 else ''}{s['yoy']}% vs {yr-1} (same counties), not a typical county&rsquo;s change" if s["yoy"] is not None else "")
            + f" &middot; data refreshed {esc(d.get('generated', ''))}")
    other_types = ""
    if len(s["have_types"]) > 1:
        other_types = (" Columns cover " + ", ".join(TYPE_LABEL[t] for t in s["have_types"])
                       + f"; state stats above use {plabel}, " + lead_why(name, s) + ".")
    other_tiles = "".join(
        f'<div class="rs-stat"><div class="v">{money(o["median"])}</div><div class="l">{TYPE_SHORT[t_].lower()} median &middot; {yr}</div>'
        f'<div class="s">{TYPE_LABEL[t_]}, {o["n"]} counties, shown apart</div></div>'
        for t_, o in s["other"].items())
    sa_tile = (f'<div class="rs-stat"><div class="v">{money(s["state_avg"])}</div><div class="l">NASS state average &middot; {yr}</div>'
               f'<div class="s">{plabel}, whole state'
               + (f', {"+" if s["state_avg_chg"] >= 0 else "-"}{money(abs(s["state_avg_chg"]))} vs {yr-1}' if s.get("state_avg_chg") is not None else "")
               + '</div></div>') if s.get("state_avg") else ""
    vw, vc = rent_verdict(s["yoy"])
    vw = reconcile_verdict(vw, s.get("state_avg_chg"), have_sa=s.get("state_avg") is not None)
    sa_line = state_avg_line(name, plabel, yr, s) or (
        '<div class="rs-rel">That is the middle county on this page, not USDA NASS&rsquo;s statewide average, '
        'which is not on this page yet.</div>')
    # PRF link beside the pasture figure; a state with no pasture rent gets it in the links note
    has_pasture = "pasture" in s["have_types"]
    pasture_prf = ("\n  " + prf_line(st)) if has_pasture and prf_line(st) else ""
    prf_rel = ""
    if not has_pasture and prf_href(st):
        prf_rel = (f' &middot; insuring hay ground? See <a href="{prf_href(st)}">PRF rainfall insurance in {name}</a>')
    hero = f"""
  <div style="background:#101415;border:1px solid #1a1f20;border-radius:14px;padding:20px 24px;margin:14px 0;display:flex;gap:22px;flex-wrap:wrap;align-items:center">
    <div style="font-family:'JetBrains Mono',monospace;font-size:3.6rem;font-weight:800;line-height:1;color:{vc}">{money(s['median'])}</div>
    <div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:1.25rem;font-weight:800;letter-spacing:.05em;color:{vc}">{vw}</div>
      <div style="font-size:1rem;line-height:1.7;color:#e6ebe9;max-width:540px">The median {name} county paid <b style="color:{vc}">{money(s['median'])} an acre</b> for {plabel} in {yr}.{f" Across the same {s['yoy_n']} counties the state median went from {money(s['yoy_med'][0])} to {money(s['yoy_med'][1])}, <b style='color:{vc}'>{'+' if s['yoy']>=0 else ''}{s['yoy']}&#37; vs {yr-1}</b>: the change in the median, not in a typical county." if s['yoy'] is not None else ""} Highest county: {esc(s['hi'][0][0])} at {money(s['hi'][0][1])}.{other_crop_line(name, yr, s)} Every county is in the table below.</div>{sa_line}
      <div class="rs-rel">These are the {yr} county rents, the newest NASS has put out{f" (released {COUNTY_RENT_RELEASED[yr]})" if yr in COUNTY_RENT_RELEASED else ""}. NASS says county rents come out in late August every year, and they have every year since 2019; the {yr + 1} date is not on its calendar yet.</div>
    </div>
  </div>
  {atlas_line(atlas_state_href(st))}{arc_line(st)}
  <div class="rs-hero">
    <div class="rs-stat"><div class="v">{money(s['median'])}</div><div class="l">median rent /ac &middot; {yr}</div><div class="s">{plabel}, {s['n']} counties</div></div>
    <div class="rs-stat">{delta_html(s['yoy'], s['yoy_n'], f'state median vs {yr-1}')}</div>
    <div class="rs-stat">{delta_html(s['dec'], s['dec_n'], f'vs {yr-9}')}</div>
    <div class="rs-stat"><div class="v">{money(s['hi'][0][1]) if s['hi'] else '-'}</div><div class="l">top county</div><div class="s">{esc(s['hi'][0][0]) if s['hi'] else ''}</div></div>{sa_tile}
  </div>
  {('<div class="rs-hero">' + other_tiles + '</div>') if other_tiles else ''}{pasture_prf}"""
    ground_html, ground_js = ground_panel(st, d, s, aslug)
    page = head(title, desc, f"/rent/{sl}", jsonld) + f"""
<body>
<div id="site-header"></div>
<main class="rs-wrap">
  <p class="sub" style="margin-top:14px"><a href="/rent/" style="color:var(--text-muted)">Cash Rent by State</a> &rsaquo; <b>{name}</b></p>
  <h1>{name} Cash Rent by County, {yr}</h1>
  <p class="sub">{name} cash rent by county, per acre per year: every USDA-published county rate, free, from
  the NASS Cash Rents Survey. <span id="rs-seed"><!--SEED:rentstate-->{seed}<!--/SEED--></span></p>
  {hero}
  <aside class="ag-sponsor-ribbon"><span class="ag-sponsor-tag">Sponsor this page</span> Your name beside {name} county cash rents. One category-exclusive slot. <span class="ag-sponsor-price" data-rate="page">{PAGE_RATE}</span> <a href="/sponsor-apply?slot=rent-{st.lower()}&amp;utm_source=rent-{sl}&amp;utm_medium=slot">Put your name here &rarr;</a></aside>{ground_html}
  <h2>Every published county, {yr}</h2>
  <p class="sub">Tap a column heading to sort. Greyed values are the county&rsquo;s most recent published year where {yr}
  wasn&rsquo;t published.{other_types} Each county name opens its Farmland Atlas record (land value, yield, insurance
  and drought). Corn trend is the county&rsquo;s 14-yr trend yield (projected {s['ty']}) from NASS county estimates,
  fitted on the same practice as the rent: the figure the Atlas county page divides rent by for rent per bushel, and the
  one its rent share calculator starts from.</p>
  {county_table(st, s, aslug)}
  {rent_ask(st, name, yr)}
  <h2>{name} median county rent by year</h2>
  <p class="sub">Median of counties published each year ({plabel}). Years with no survey
  are left blank.</p>
  {bars_html(s['hist'])}
  <div class="rs-note"><b>What this can&rsquo;t tell you.</b> These are county <b>means from a voluntary USDA survey</b>.
  Rents vary widely inside a county, driven by soil, drainage, field size and how badly a neighbor wants the
  ground. Year-over-year stats above compare only counties published in both years, so a county dropping out
  of the survey can&rsquo;t fake a trend.</div>
  <div class="rs-note rs-links" style="border-left-color:#5fc28a">Open a county in the table for its Farmland Atlas page and the <b>rent share calculator</b> (rent as a share of
  what the acre can actually gross, year by year) &middot; put a number in a <a href="/cash-lease?st={st}">printable {name} cash lease</a>{
      " (termination notice: " + NOTICE[st] + ")" if st in NOTICE else ""} &middot;
  check <a href="/basis">local basis vs normal</a> before you commit to a rent that needs a price{prf_rel}.</div>
  {faq_html(faq)}
  <h2>Other states</h2>
  {state_cloud(all_states, exclude=st)}
  <p class="sub" style="font-size:.75rem;margin:18px 0">Source: USDA NASS Quick Stats, Cash Rents Survey county
  estimates (released each August) and county yield estimates. Page rebuilt automatically from data refreshed
  {esc(d.get('generated', ''))}.</p>
</main>
{explore_nav()}
<div id="site-footer"></div>
<script src="/components/loader.js?v=19"></script>
{SORT_JS}{ground_js}
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
          "published county rate and its history. If your county is not listed, it is under the 20,000-acre line, or NASS held the rate back because too few farms answered or a figure could identify one farm."},
    {"q": "When is county cash rent data released?",
     "a": "USDA NASS releases county cash rent estimates each August, from a survey of roughly 280,000 farms and ranches conducted "
          "earlier the same year. The rate published in a given August describes that same crop year. Rates are not revised after publication."},
    {"q": "Why is there no 2015 or 2018 cash rent data?",
     "a": "NASS did not conduct the county Cash Rents Survey in 2015 or 2018, so no county estimates exist for those years. County data "
          "runs 2008 to 2014, 2016 to 2017, and 2019 forward. These pages leave those years blank."},
    {"q": "What percent of gross revenue should cash rent be?",
     "a": "There is no single correct figure. Rent as a share of gross revenue is useful "
          "because it moves when yields and prices move, while the rent itself is fixed for the season. Comparing the ratio to your own "
          "county's history is more informative than comparing it to a national rule of thumb. What the remaining share has to cover (seed, "
          "fertilizer, chemical, machinery, labor, interest) varies enormously between operations."},
    {"q": "How has cash rent changed as a share of revenue over time?",
     "a": "The rent share calculator on each Farmland Atlas county page charts it for every county with the data. For each year it divides "
          "that year's published county rent by that year's actual county yield for the same practice times that year's state average price "
          "received: dryland rent over the dryland yield, irrigated rent over the irrigated yield. Where the only county yield mixes irrigated "
          "and dryland acres, that year is withheld and marked. Every term is a USDA figure published after the fact, so the line "
          "shows what happened, not a projection. The pattern in most Corn Belt counties is that rent takes a far larger share "
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
  you get a blank and a note that NASS did not publish, never a neighbor&rsquo;s number.</p>
  <p><b>It has no 2015 or 2018.</b> NASS ran no county Cash Rents Survey in those years, so the series runs 2008 to 2014, 2016 to 2017
  and 2019 forward. Those years are left blank.</p>
  <p><b>It is a county mean, not a rate card.</b> Rents differ between farms on the same road: soil, drainage, field size, yield history,
  and how badly the neighbor wants it.</p></details>
  <details class="rs-faq"><summary>Using it in an actual rent conversation</summary>
  <p>The common landlord conversation is a number against a feeling. The calculator gives both sides the same arithmetic to argue
  about, which is usually a shorter argument. Put your real yield in: if your ground beats the county by fifteen bushels, type that in.
  Put your real basis in: over a 200-bushel acre, thirty cents is sixty dollars. Look at the history, not the level: a ratio means little
  alone and a lot next to the same county&rsquo;s last fifteen years.</p>
  <p>What it will not do is tell you what to sign. That is between you, your landlord, and your own numbers. Settled on a number? Put it
  on paper with the free <a href="/cash-lease" style="color:var(--gold)">AGSIST cash farm lease</a>.</p></details>"""


RH_STYLE = """<style>
    .rh-find{{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:10px 0 4px;padding:10px 12px;border:1px solid var(--border);border-left:3px solid #d4a23f;border-radius:8px;background:var(--surface)}}
    .rh-find label{{font-weight:700;color:var(--text);font-size:.92rem}}
    .rh-fr{{display:flex;gap:8px;flex:1 1 260px}}
    .rh-find select{{flex:1;min-height:42px;font-size:1rem;padding:0 8px;border:1px solid var(--border-2);border-radius:7px;background:var(--bg);color:var(--text)}}
    .rh-find button{{min-height:42px;padding:0 14px;border:0;border-radius:7px;background:#a8823c;color:#fff;font-weight:700;cursor:pointer}}
    .rh-sw{{display:inline-flex;margin:14px 0 0;border:1px solid var(--border-2);border-radius:8px;overflow:hidden}}
    .rh-sw button{{min-height:38px;padding:0 16px;border:0;background:transparent;color:var(--text-muted);font-weight:700;cursor:pointer}}
    .rh-sw button.on{{background:#a8823c;color:#fff}}
    .rh-pcap{{font-family:'JetBrains Mono',monospace;font-size:.66rem;letter-spacing:.1em;color:var(--text-muted);text-transform:uppercase;margin:16px 0 10px}}
  </style>""".replace("{{", "{").replace("}}", "}")
RH_SCRIPT = ("(function(){var sw=document.querySelector('.rh-sw');if(!sw)return;var cc=document.querySelector('.rh-ccap'),pc=document.querySelector('.rh-pcap');"
             "sw.addEventListener('click',function(e){var b=e.target.closest('button[data-rh]');if(!b)return;var p=b.getAttribute('data-rh')==='p';"
             "Array.prototype.forEach.call(sw.querySelectorAll('button'),function(x){var on=x===b;x.classList.toggle('on',on);x.setAttribute('aria-pressed',on?'true':'false');});"
             "if(cc)cc.hidden=p;if(pc)pc.hidden=!p;"
             "Array.prototype.forEach.call(document.querySelectorAll('.rh-tile[data-cv]'),function(t){t.style.background=t.getAttribute(p?'data-pbg':'data-cbg');"
             "var v=t.querySelector('.rh-tge');if(v)v.textContent=t.getAttribute(p?'data-pv':'data-cv');});});})();")


def hub_view(s):
    """What the hub shows for a state: its dryland figures whenever NASS has
    them (the hub compares like with like), whatever the state page leads with;
    the lead rent, labeled, only where there is no dryland rent (AZ, NV)."""
    if s.get("dry"):
        d = s["dry"]
        return "nonirr", d["median"], d["yoy"], d["yoy_n"]
    return s["primary"], s["median"], s["yoy"], s["yoy_n"]


def build_hub(states, stats, generated):
    yr = max(s["yr"] for s in stats.values())
    meds = sorted(hub_view(s2)[1] for s2 in stats.values())
    # AUDIT 2026-08-11: one quintile scale across mixed land types ranked
    # TX $10 PASTURE against IA $270 CROPLAND as if comparable. Color each
    # tile against ITS OWN land-type peer group.
    meds_by_type = {}
    for s2 in stats.values():
        meds_by_type.setdefault(hub_view(s2)[0], []).append(hub_view(s2)[1])
    for t in meds_by_type: meds_by_type[t].sort()
    def quint_color(v, ptype="nonirr"):
        peers = meds_by_type.get(ptype, meds)
        i = sum(1 for m in peers if m < v) / max(1, len(peers))
        return "#af3a32" if i >= .8 else ("#9c4b3d" if i >= .6 else ("#a8823c" if i >= .4 else ("#5a656a" if i >= .2 else "#396d4f")))
    # 2026-10-17 search-terms check: "pasture rental rates by county" 123, "usda pasture lease rates",
    # "pasture rental rates" and the desktop first screen showed cropland only. The tiles carry each
    # state's pasture median too (the table's Pasture column), colored against the other pasture
    # medians only, and a switch above the map shows them.
    def pmed(s):
        if s["primary"] == "pasture":
            return s["median"]
        o = s["other"].get("pasture")
        return o["median"] if o else None
    pvals = sorted(v for v in (pmed(s2) for s2 in stats.values()) if v is not None)

    def pcolor(v):
        i = sum(1 for m in pvals if m < v) / max(1, len(pvals))
        return "#af3a32" if i >= .8 else ("#9c4b3d" if i >= .6 else ("#a8823c" if i >= .4 else ("#5a656a" if i >= .2 else "#396d4f")))
    tiles = []

    def whole(x):
        """Half up, like the table and the state pages: $50.50 is $51 (round() gave $50, 2026-10-18)."""
        return int(x + 0.5) if x >= 0 else -int(-x + 0.5)
    for ab, (c, r) in TILE.items():
        if ab in stats:
            hk, hm = hub_view(stats[ab])[:2]
            pv = pmed(stats[ab])
            # a 64px tile fits "$9.80" or "$65", not "$65.25": whole dollars from $10 up (the table keeps cents)
            pt = (f"${whole(pv):,}" if pv >= 10 else f"${pv:.2f}") if pv is not None else "n/a"
            pa = (f' data-pv="{pt}" data-pbg="{pcolor(pv)}"' if pv is not None else ' data-pv="n/a" data-pbg="#2a3133"')
            tiles.append(f'<a class="rh-tile" href="/rent/{slug(STATE_NAMES[ab])}" style="--gc:{c};--gr:{r};background:{quint_color(hm, hk)}"'
                         f' data-cv="${whole(hm):,}" data-cbg="{quint_color(hm, hk)}"{pa}><span class="rh-tst">{ab}</span><span class="rh-tge">${whole(hm):,}</span></a>')
        else:
            tiles.append(f'<div class="rh-tile dim" style="--gc:{c};--gr:{r}"><span class="rh-tst">{ab}</span></div>')
    tile_html = ('<div class="rh-sw" role="group" aria-label="Land type on the map"><button type="button" class="on" aria-pressed="true" data-rh="c">Cropland</button>'
        '<button type="button" aria-pressed="false" data-rh="p">Pasture</button></div>'
        f'<div class="rh-pcap" hidden>Median county rent per acre, {yr}, permanent pasture, colored against the other states&rsquo; pasture. '
        f'Tap a state for every county&rsquo;s pasture rate.</div>'
        '<div class="rh-ccap" style="font-family:\'JetBrains Mono\',monospace;font-size:.66rem;letter-spacing:.1em;color:var(--text-muted);text-transform:uppercase;margin:16px 0 10px">'
        f'Median county rent per acre, {yr}, non-irrigated cropland. Tap a state for every county. ' + ('No dryland rent published for ' + ', '.join(STATE_NAMES[x] for x in sorted(stats, key=lambda x: STATE_NAMES[x]) if not stats[x]["dry"]) + ', so the tile shows ' + '; '.join(STATE_NAMES[x] + ' ' + TYPE_LABEL[stats[x]["primary"]] for x in sorted(stats, key=lambda x: STATE_NAMES[x]) if not stats[x]["dry"]) + ', not colored against the rest' if any(not s2["dry"] for s2 in stats.values()) else '') + '</div>'
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
        dy = s["dry"]
        yoy = (f'<td class="{"up" if dy["yoy"] >= 0 else "dn"}" data-v="{dy["yoy"]}">'
               f'{"+" if dy["yoy"] >= 0 else ""}{dy["yoy"]}%</td>') if dy and dy["yoy"] is not None \
            else NA_YOY
        dry = (f'<td data-v="{dy["median"]}">{money(dy["median"])}</td>' if dy
               else '<td class="mut" data-v="-1">n/a</td>')
        rows.append(
            f'<tr><td><a href="/rent/{slug(STATE_NAMES[st])}" >{STATE_NAMES[st]}</a></td>'
            f'{dry}{yoy}'
            f'<td data-v="{type_med(s, "nonirr")[1]}">{type_med(s, "nonirr")[1]}</td>'
            f'{cell(type_med(s, "irr")[0])}{cell(type_med(s, "pasture")[0])}</tr>')
    # the headline compares like with like: dryland cropland medians only
    medians = sorted(((s["dry"]["median"], st) for st, s in stats.items() if s["dry"]), reverse=True)
    no_dry = sorted((st for st, s in stats.items() if not s["dry"]), key=lambda x: STATE_NAMES[x])
    hi_, lo_ = medians[0], medians[-1]
    desc = (f"USDA cash rent by county per acre, {yr}, free: every published county in {len(states)} states. "
            f"Dryland state medians run {money(hi_[0])}/acre ({STATE_NAMES[hi_[1]]}) to {money(lo_[0])} ({STATE_NAMES[lo_[1]]}).")
    if len(desc) > 160:
        desc = (f"USDA cash rent by county per acre, {yr}, free: cropland and pasture for every published county "
                f"in {len(states)} states.")
    # pasture rental rates by county: state medians of the published county pasture rents
    pmeds = sorted((type_med(stats[x], "pasture")[0], x) for x in states if type_med(stats[x], "pasture")[0] is not None)
    hub_faq = list(HUB_FAQ)
    if len(pmeds) >= 2:
        hub_faq.insert(1, {"q": "What are pasture rental rates by county?",
                           "a": ("USDA NASS publishes a separate cash rent for permanent pasture in each county where enough pasture "
                                 f"leases come back in the survey. In {yr} the state medians of those county rates ran from "
                                 f"{money(pmeds[0][0])} an acre in {STATE_NAMES[pmeds[0][1]]} to {money(pmeds[-1][0])} in "
                                 f"{STATE_NAMES[pmeds[-1][1]]}, across {len(pmeds)} states. The Pasture column above has each "
                                 "state's median; open a state for every county's pasture rate and its history.")})
    if len(medians) >= 3:
        mid_ = med([v for v, _ in medians])
        mo = lambda v: money(round(v / 12, 2))
        # "how much does farmland rent for per acre per month" (61 impressions, position 14.5)
        hub_faq.insert(1, {"q": "How much does farmland rent for per acre per month?",
                           "a": (f"Farmland cash rent is quoted per acre per year, not per month. Divided by 12, the {yr} USDA "
                                 f"dryland cropland rents run from {money(hi_[0])} an acre a year in {STATE_NAMES[hi_[1]]} "
                                 f"(about {mo(hi_[0])} a month) to {money(lo_[0])} in {STATE_NAMES[lo_[1]]} (about {mo(lo_[0])} a month). "
                                 f"The middle of the {len(medians)} state medians is {money(mid_)} a year, about {mo(mid_)} a month. "
                                 "These are state medians of county averages; pick your state above for your county's rate.")})
    jsonld = {"@context": "https://schema.org", "@graph": [
        {"@type": "CollectionPage", "name": f"Cash Rent by State, {yr}",
         "url": f"{SITE}/rent/", "isAccessibleForFree": True,
         "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE}},
        HUB_DATASET,
        {"@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": f["q"], "acceptedAnswer": {"@type": "Answer", "text": f["a"]}} for f in hub_faq]},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "AGSIST", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "Cash Rent by State", "item": f"{SITE}/rent/"}]},
    ]}
    seed = (f"{len(states)} states &middot; non-irrigated cropland, highest state median: {STATE_NAMES[medians[0][1]]} "
            f"{money(medians[0][0])}/ac &middot; lowest: {STATE_NAMES[medians[-1][1]]} {money(medians[-1][0])}/ac"
            + (f" &middot; no dryland rent published for {len(no_dry)} ({', '.join(STATE_NAMES[x] for x in no_dry)})" if no_dry else "")
            + f" &middot; data refreshed {esc(generated)}")
    # County rates were one click deep and the first screen did not say how to reach them
    # ("cash rents by county per acre" 492, "cash rents by county" 277): a state picker that opens
    # the state's county table, first thing under the heading.
    opts = "".join(f'<option value="/rent/{slug(STATE_NAMES[st])}">{STATE_NAMES[st]}</option>'
                   for st in sorted(states, key=lambda s_: STATE_NAMES[s_]))
    finder = (RH_STYLE + '<form class="rh-find" action="/rent/" onsubmit="var v=this.st.value;if(v)location.href=v;return false">'
              '<label for="rh-st">Your county&rsquo;s rent per acre: pick your state</label>'
              f'<span class="rh-fr"><select id="rh-st" name="st"><option value="">Choose a state</option>{opts}</select>'
              '<button type="submit">Show counties</button></span></form>')
    page = head(f"USDA Cash Rent by County {yr}: Per Acre, {len(states)} States", desc, "/rent/", jsonld) + f"""
<body>
<div id="site-header"></div>
<main class="rs-wrap">
  <h1>Cash Rent by State, {yr}</h1>
  <p class="sub">USDA cash rent by county, per acre per year, free: pick a state for every published county&rsquo;s
  {yr} rate, history to 2008, and the statutory lease-termination deadline where the state has one.
  <span id="rs-seed"><!--SEED:renthub-->{seed}<!--/SEED--></span></p>
  {finder}
  {atlas_line("/farmland-atlas")}
  {tile_html}
  <aside class="ag-sponsor-ribbon"><span class="ag-sponsor-tag">Sponsor this page</span> Your name on the cash rent page for every state. One category-exclusive slot. <span class="ag-sponsor-price" data-rate="page">{PAGE_RATE}</span> <a href="/sponsor-apply?slot=rent-hub&amp;utm_source=rent-hub&amp;utm_medium=slot">Put your name here &rarr;</a></aside>
  <div class="rs-tw"><table class="rs-t" id="rs-table"><thead><tr><th>State</th><th title="non-irrigated cropland, median of published counties">Non-irrigated</th><th>YoY</th><th>Counties</th><th title="irrigated cropland, shown apart">Irrigated</th><th title="permanent pasture, shown apart">Pasture</th></tr></thead>
  <tbody>{"".join(rows)}</tbody></table></div>
  <p class="sub">&ldquo;Rent&rdquo; here means non-irrigated (dryland) cropland: the median of every county NASS published in
  {yr}, the same counties the Farmland Atlas state pages use. Irrigated cropland and pasture are separate columns and never
  stand in for it. YoY compares only counties published in both years. For rent as a share of what the acre can gross,
  open any county on the <a href="/farmland-atlas" style="color:var(--gold)">Farmland Atlas</a> and tap the rent share calculator.</p>
  <p class="sub">Insuring pasture or hay ground? <a href="/prf" style="color:var(--gold)">PRF rainfall insurance</a> has every
  grid&rsquo;s premium and what it would have paid each year since 1951, with a page for each state.</p>
  {HUB_EXPLAIN}
  {faq_html(hub_faq)}
  <p class="sub" style="font-size:.75rem;margin:18px 0">Source: USDA NASS Cash Rents Survey county estimates.
  Pages rebuild automatically when NASS publishes (each August). Data refreshed {esc(generated)}.</p>
</main>
{explore_nav()}
<div id="site-footer"></div>
<script>{RH_SCRIPT}</script>
<script src="/components/loader.js?v=19"></script>
{SORT_JS}
<script src="/components/next-links.js?v=3" defer></script>
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
            assert pg.count(f'data-topic="rent:{st_.lower()}"') == 1, f"{st_}: rent release ask missing"
            for h_ in _re.findall(r'href="/farmland-atlas/([^"#]+)"', pg):
                assert os.path.exists(os.path.join("farmland-atlas", h_ + "index.html" if h_.endswith("/") else h_ + ".html")), f"{st_}: {h_} has no page"
        hub = open(os.path.join(td, "index.html")).read()
        # /cash-rent is retired: nothing here may link to it
        for st_ in list(stats) + ["index"]:
            pg = open(os.path.join(td, ("index" if st_ == "index" else slug(STATE_NAMES[st_])) + ".html")).read()
            assert 'href="/cash-rent' not in pg, f"{st_}: links the retired /cash-rent"
        # the hub headline compares like land types: dryland medians only
        seed_ = hub.split("<!--SEED:renthub-->")[1].split("<!--/SEED-->")[0]
        dry_ = sorted((s_["dry"]["median"], k) for k, s_ in stats.items() if s_["dry"])
        assert money(dry_[0][0]) in seed_ and money(dry_[-1][0]) in seed_, seed_
        # the lead rent: the cropland kind NASS published for more counties (lead_kind)
        for k, s_ in stats.items():
            cv = s_["coverage"]
            assert s_["primary"] == lead_kind(cv), (k, s_["primary"], cv)
            if s_["primary"] == "irr" and cv["nonirr"] >= MIN_DRY:
                assert cv["irr"] > cv["nonirr"], (k, cv)
            if s_["primary"] == "nonirr":
                assert cv["nonirr"] >= cv["irr"], (k, cv)
            assert (s_["dry"] is not None) == (cv["nonirr"] >= MIN_DRY), k
        for k, want in (("IA", "nonirr"), ("WA", "nonirr"), ("CA", "irr"), ("OR", "irr"), ("NV", "irr")):
            if k in stats:
                assert stats[k]["primary"] == want, (k, stats[k]["primary"])
        # the moved /cash-rent FAQ and Dataset are on the hub, visibly
        assert "#dataset" in hub and hub.count('class="rs-faq"') >= 11, "hub explainer or FAQ missing"
        # PRF: the hub links the PRF hub; a state page links its own PRF page only when it is on disk
        assert 'href="/prf"' in hub, "hub PRF link missing"
        if prf_href("IA"):
            assert 'href="/prf/iowa"' in ia and "How much does pasture rent for per acre in Iowa?" in ia, "IA PRF link or pasture FAQ missing"
        for blk in _re.findall(r'<script type="application/ld\+json">(.*?)</script>', hub, _re.S):
            for g in json.loads(blk)["@graph"]:
                if g["@type"] == "FAQPage":
                    for q in g["mainEntity"]:
                        assert esc(q["name"]) in hub and esc(q["acceptedAnswer"]["text"]) in hub, "hub FAQ not visible: " + q["name"]
        # one county set: a state's dryland median here is the Farmland Atlas state median
        cards_p = os.path.join("farmland-atlas", "data", "cards.json")
        if os.path.exists(cards_p):
            cj = json.load(open(cards_p))
            off = {k: (s_["dry"]["median"] if s_["dry"] else None, (cj["states"].get(k) or {}).get("r")) for k, s_ in stats.items()
                   if s_["dry"] and k != "CT" and (cj["states"].get(k) or {}).get("r") is not None
                   and abs(s_["dry"]["median"] - cj["states"][k]["r"]) > 0.001}
            assert not off, f"rent page and Atlas state medians disagree: {off}"
        assert hub.count("/rent/") >= 47 and "SEED:renthub" in hub
        assert 'Part of the <a href="/farmland-atlas">Farmland Atlas</a>' in hub, "hub Atlas line missing"
        assert "&amp;rsquo;" not in hub, "hub title double-escaped"
        # "rent for your ground": rent per bushel = this year's dryland rent over the
        # same-practice trend the table prints; the page only multiplies
        st_ia = next(c for c in stats["IA"]["ground"] if c["n"] == "Story")
        assert (st_ia["r"], st_ia["t"], st_ia["b"]) == (290.0, 217.2, 1.34), st_ia
        assert 'id="your-ground"' in ia and "Derived by AGSIST, not a NASS number" in ia
        assert all(len(s_["ground"]) == 0 or s_["primary"] == "nonirr" for s_ in stats.values())
        for st_, s_ in stats.items():
            pg = open(os.path.join(td, f"{slug(STATE_NAMES[st_])}.html")).read()
            assert ('id="your-ground"' in pg) == (len(s_["ground"]) >= GROUND_MIN), f"{st_}: panel shown without data, or missing"
            rel_ = f" (released {COUNTY_RENT_RELEASED[s_['yr']]})" if s_['yr'] in COUNTY_RENT_RELEASED else ""
            assert f"These are the {s_['yr']} county rents, the newest NASS has put out{rel_}." in pg, f"{st_}: release line missing"
        # the "average" answer: middle county, and NASS's state figure first only when the data has it
        assert "The middle Iowa county pays " + money(s["median"]) in ia and "not shown here" in ia
        d_ia = json.loads(json.dumps(load_states()["IA"]))
        d_ia["state_avg"] = {"nonirr": {str(s["yr"]): 270.0}}
        s2_ = state_stats(d_ia)
        assert s2_["state_avg"] == 270.0
        pg2 = build_state_page("IA", d_ia, s2_, list(stats), {})
        assert ("USDA NASS puts the Iowa statewide average for non-irrigated cropland at $270 per acre in "
                f"{s['yr']}. The middle county on this page pays {money(s['median'])}") in pg2, "state average not first"
        assert "NASS state average &middot;" in pg2 and "NASS state average &middot;" not in ia
        d_ia["state_avg"] = {"nonirr": {str(s["yr"] - 1): 268.0}}   # last year's figure never stands in
        assert state_stats(d_ia)["state_avg"] is None
        # NV/AZ: irrigated-primary states must be labeled
        if "AZ" in stats:
            az = open(os.path.join(td, "arizona.html")).read()
            assert TYPE_LABEL[stats["AZ"]["primary"]].split()[0] in az
        print(f"SELFTEST OK — {len(urls)} URLs; IA baked stats, FAQ, notice, gap honesty, "
              f"county rows, link cloud, hub all verified")


# Release day of each county cash rent estimate, from the NASS "Reports by
# Release Day" calendar ("County Estimates Cash Rents", read Oct 15, 2026 from
# the references branch copy). That calendar lists 2026 only; add the next
# year when NASS posts it. The hero prints the date only for a year listed here.
COUNTY_RENT_RELEASED = {2026: "Aug 21, 2026"}


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
