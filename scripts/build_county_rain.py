#!/usr/bin/env python3
"""build_county_rain.py: "How much rain has <County>, <State> had this year?"

WHY
  From harvest through January farmers search how much rain their county had
  this year. Each county with a weather station that reported enough days gets one
  page that answers it in the first line, in plain HTML, with the month by
  month table, the wettest month, the biggest rain, the longest dry stretch and
  last year by the same date, and a way to put the whole year on a Rain Print.

WHERE THE NUMBERS COME FROM
  data/rain/<st>.json, written by scripts/fetch_county_rain.py from NOAA's
  daily records (RCC-ACIS). Nothing is computed here but differences and
  rounding; this formats. A number the data file does not have (no normals,
  too early for a percent, last year too gappy) is left off the page, and the
  page says why where a reader would look for it.

WHAT IT WRITES
  rain/<state-slug>/<county-slug>.html   one per county with a qualifying station
  rain/<state-slug>.html                 every county in the state, and the ones without a station
  rain.html                              the hub, one line per state
  sitemap-rain.xml                       every page above (robots.txt names it)
  With no data files yet it writes an empty sitemap and nothing else.

SIZE (CLAUDE.md)
  About 12 KB a county page, at most MAX_KB; the build refuses anything over.
  No per-page styles (components/rain-county.css is shared and cached), no
  static header or footer copy in county and state pages (loader.js fills
  both; the hub, a root page, carries the static nav like every root page).
  About 3,000 county pages x 12 KB is about 36 MB; FOLDER_MB["rain"] in
  scripts/check_site_budget.py is 50.

  python3 scripts/build_county_rain.py              write
  python3 scripts/build_county_rain.py --check      exit 1 if anything differs from what this would write
  python3 scripts/build_county_rain.py --selftest   build from test/fixtures/rain into a temp folder and test it
  python3 scripts/build_county_rain.py --data DIR --root DIR   read data from DIR, write the site under DIR
"""
import datetime as dt
import glob
import json
import os
import re
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import county_rain as R  # noqa: E402
import build_prf_states as S  # noqa: E402  boot() and text_of()
import cross_links as XL  # noqa: E402  same-county links between the county sets
import seo_caps as CAPS  # noqa: E402  the site's one title and description cap (was 165 for descriptions here)
import pointer_pages as PP  # noqa: E402
import inject_static_nav as nav  # noqa: E402
import county_stories as CS  # noqa: E402

ROOT = R.ROOT
MAX_KB = 25
CSS = '<link rel="stylesheet" href="/components/rain-county.css?v=5">'
ORIGIN = "https://agsist.com"
M3, ML = R.MONTHS, R.MONTHS_LONG


def e(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))


def short_date(iso):
    y, m, d = iso.split("-")
    return f"{M3[int(m) - 1]} {int(d)}"


def long_date(iso):
    y, m, d = iso.split("-")
    return f"{M3[int(m) - 1]} {int(d)}, {y}"


def inch(x):
    return f"{x:.2f}"


def inches_word(x, places=2):
    v = f"{x:.{places}f}"
    return f"{v} {'inch' if v in ('1.00', '1.0') else 'inches'}"


def done_year(d):
    """The year is over when the fetch ran through Dec 31, whatever day a
    lagging station last reported (that day stays on the page)."""
    return str(d.get("edate", "")).endswith("-12-31")


def kind_word(c):
    return "volunteer rain gauge" if c["station"]["net"] == "cocorahs" else "weather station"


def where_words(c):
    return f"the {kind_word(c)} {R.station_where(c['station']['raw'])}"


def compare(c, year_word="a usual year to date"):
    """'That is 2.10 inches less than a usual year to date (91% of usual).' or the reason there is none.
    Two decimals, like the month table, so the page never shows two numbers for one difference."""
    if c["usual"] is None:
        return f"This {'gauge' if c['station']['net'] == 'cocorahs' else 'station'} has no NOAA normal, so there is no usual year to compare it with."
    if c["pct"] is None:
        # the usual so far is under an inch: before April that is the calendar,
        # later it is a dry place (the desert), not "early"
        if int(c["as_of"][5:7]) < 4:
            return "It is too early in the year for a fair comparison with a usual year."
        return "A usual year here has had less than an inch of rain by now, too little for a fair percent."
    d = c["total"] - c["usual"]
    if abs(d) < 0.05:
        return f"That is about the same as {year_word} ({c['pct']}% of usual)."
    return f"That is {inches_word(abs(d), 2)} {'more' if d > 0 else 'less'} than {year_word} ({c['pct']}% of usual)."


def answer(c, county, year, done):
    w = where_words(c)
    if done and c["as_of"][5:] == "12-31":
        return (f"{inches_word(c['total'])} of rain fell in {year} at {w}, {county}. "
                + compare(c, "a usual year"))
    if done:
        return (f"{inches_word(c['total'])} of rain fell in {year} at {w}, {county}, through {short_date(c['as_of'])}, the last day reported. "
                + compare(c, f"a usual year through {short_date(c['as_of'])}"))
    amt = inches_word(c["total"])
    return (f"{amt} of rain {'has' if amt.startswith('1.00 ') else 'have'} fallen so far in {year} at {w}, {county}, through {short_date(c['as_of'])}. "
            + compare(c))


def miles_from(mi):
    n = round(mi)
    return "less than a mile from" if n == 0 else "1 mile from" if n == 1 else f"{n} miles from"


def days_word(n):
    return f"{n} {'day' if n == 1 else 'days'}"


def last_year_words(c, L, year):
    """This year against last, on the days BOTH years reported, so a day one
    year missed cannot read as rain the other year had. '' when the data file
    does not say which days those were."""
    if "both" not in L:
        return ""
    d2 = L["this_both"] - L["last_both"]
    every = L["both"] == L["days"] == c["days"]
    pre = "" if every else f"On the {L['both']} days both years reported, "
    tail = f"about the same as {year - 1}" if abs(d2) < 0.05 else f"{inches_word(abs(d2), 2)} {'more' if d2 > 0 else 'less'} than {year - 1}"
    out = f"{pre}{year} had {tail}."
    return out[0].upper() + out[1:]


RP_MISS_BLOCK = 31   # mirrors MISS_BLOCK in components/rain-print.js
RP_MIN_DAYS = 60     # mirrors GIFT_MIN_DAYS in components/rain-print.js: fewer days, no print drawn
RP_SNOW_MISS_OK = R.SNOW_MISS_OK  # mirrors MISS_OK in components/rain-print.js derive(): snow drawn only with at most this many days lacking a snowfall value
PRINT_JS = '<script src="/components/rain-county-print.js?v=38" defer></script>'


def rp_prices():
    """(framed, print) dollars from data/rain-print.json, the file /rain-print reads."""
    try:
        j = json.load(open(os.path.join(ROOT, "data", "rain-print.json"), encoding="utf-8"))
        return int(j["framed12x18"]), int(j["print12x18"])
    except (OSError, ValueError, KeyError, TypeError):
        return None


def rp_cutoffs():
    """(framed, print) Christmas order-by days (YYYY-MM-DD) from data/rain-print.json, or None."""
    try:
        j = json.load(open(os.path.join(ROOT, "data", "rain-print.json"), encoding="utf-8"))
        f, p = j["framed_christmas_cutoff"], j["print_christmas_cutoff"]
        return (f, p) if all(isinstance(x, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", x) for x in (f, p)) else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def xmas_last_by(today, year, cut):
    """"Last year, by Christmas" (2026-10-19, board B, Sig: "yeah fix please"): from Oct 1 of the page's
    year through the later of the two Christmas cutoffs in data/rain-print.json, last year's print still
    arrives by Christmas. Returns the order-by words ("framed by Dec 9, or as a print by Dec 10"), or "" when
    the offer is off (a finished year, no dates, the dates for another year, or both dates passed)."""
    if not cut or cut[0][:4] != str(year) or cut[1][:4] != str(year) or today < f"{year}-10-01":
        return ""
    f_ok, p_ok = today <= cut[0], today <= cut[1]
    return (f"framed by {short_date(cut[0])}, or as a print by {short_date(cut[1])}" if f_ok and p_ok
            else f"as a print by {short_date(cut[1])}" if p_ok else f"framed by {short_date(cut[0])}" if f_ok else "")


def print_ready(c, day):
    """The county page draws its year as a Rain Print (components/rain-county-print.js)
    when the state's daily file has this county's days and the engine would draw them."""
    if not day or not day.get("p"):
        return False
    return (c.get("missing") or 0) <= RP_MISS_BLOCK and c["days"] >= RP_MIN_DAYS and len(R.unpack_days(day["p"])) == c["days"]


def recent(c, day, n):
    """Rain at the gauge over the last n days of the page (its as-of day and the n - 1
    before it): (inches, first day iso), or None unless every one of those days has its
    own reading (2026-10-23: "how much rain has fallen here" is often about this week).
    A missing day, or a day whose rain went into a later multi-day reading, leaves it
    off; a trace counts as nothing, as on the rest of the page."""
    if not day or not day.get("p"):
        return None
    v = R.unpack_days(day["p"])
    if len(v) != c["days"] or len(v) < n:
        return None
    tot = 0.0
    for x in v[-n:]:
        if x in ("M", "S") or x.endswith("A"):
            return None
        if x != "T":
            tot += float(x)
    first = dt.date.fromisoformat(c["as_of"]) - dt.timedelta(days=n - 1)
    return round(tot, 2), first.isoformat()


def span_words(a, b):
    """'Oct 12 to 18', or 'Sep 19 to Oct 18' across a month."""
    return f"{short_date(a)} to {b[8:].lstrip('0') if a[:7] == b[:7] else short_date(b)}"


def print_snow(day, year):
    """Does the print on the county page draw snow? The engine's rule, step for step
    (components/rain-county-print.js daysOf, then rain-print.js lastRecorded, closeOpenS
    and snowCount; county_rain.snow_state): counted over reported days, at most RP_SNOW_MISS_OK of them may lack a
    snowfall value, and at least 0.1 in of snow must have fallen. In a year still going
    (the days end before Dec 31), the days after the last snowfall value are not counted
    (2026-10-19: Eagle River WI, Vilas County, 70.0 in, missed only Oct 1 to 13 and one
    March day). Returns "drawn", "none" (no snowfall record), "gaps" (record too patchy)
    or "little" (under 0.1 in)."""
    if not day or not day.get("s"):
        return "none"
    return R.snow_state(R.unpack_days(day.get("p")), R.unpack_days(day["s"]), year)


def snow_caption(day, snow, year):
    """The caption's key for the snow line. Wording only (2026-10-20): "little" (under 0.1 in)
    stays the snow state, but where the station's snowfall record for the year has no value
    above zero the caption says so instead of "under 0.1 in", which reads as if snow fell
    (162 pages, mostly the South). "nosnow": every value 0; "trace": only zeros and traces.
    A summer trace (June to August) is not snow here (county_rain.snow_trace_on, Sig 2026-10-20)."""
    if snow != "little" or not day or not day.get("s"):
        return snow
    raw = R.unpack_days(day["s"])
    sv = [R.parse_pcpn(x) for x in raw]
    if any(v for v, _f in sv if v is not None):
        return snow
    return "trace" if any(R.snow_trace_on(x, year, k) for k, x in enumerate(raw)) else "nosnow"


def print_snow_traces(day, year):
    """Days the county page's print marks with a trace of snow (county_rain.snow_trace_days, the art's rule)."""
    if not day or not day.get("s"):
        return 0
    return R.snow_trace_days(R.unpack_days(day.get("p")), R.unpack_days(day["s"]), year)


def snow_trace_words(snow, n):
    """The caption's words for the snow on the print (2026-10-20: a trace of snow is marked, so the
    old "so none is drawn" is no longer true where a trace fell). n: the days the print marks."""
    dw = f"{n} day{'' if n == 1 else 's'}"
    if snow == "trace" and n:
        return f"Only traces of snow fell ({dw}), too little to measure; each is marked on the print. "
    if snow == "trace":
        return "Only traces of snow, too little to measure, so none is drawn. "
    base = {"drawn": "Light blue is snow. ",
            "gaps": "Its snowfall record has gaps, so no snow is drawn. ",
            "little": "Under 0.1 in of snow, so none is drawn. ",
            "nosnow": "No snow fell, so none is drawn. "}.get(snow)
    if base is None:
        return None
    if n and snow in ("drawn", "little"):
        if snow == "drawn":
            base += f"A trace of snow, too little to measure, fell on {dw}, marked above the line. "
        else:
            base += ("The day with a trace of snow is" if n == 1 else f"The {dw} with a trace of snow are") + " marked above the line. "
    return base


def rain_print_href(c, st, year):
    """The county page's Rain Print link: the town, the year, this station
    (unless it missed more days than a print allows, so Rain Print picks the
    nearest fuller record instead of refusing), and the station's lat,lon
    (ll=) so a town name Rain Print cannot find never blocks the map."""
    town = R.station_town(c["station"]["raw"])
    place = f"{town[:32 - len(st) - 2].rstrip()}, {st}"   # shorten the town, never the state
    q = {"place": place, "year": year}
    if (c.get("missing") or 0) <= RP_MISS_BLOCK:
        q["station"] = re.sub(r"[^A-Za-z0-9 ]", "", c["station"]["sid"]).strip()[:16]
    ll = c["station"].get("ll")
    if ll:
        q["ll"] = f"{ll[1]:.4f},{ll[0]:.4f}"
    return "/rain-print?" + urllib.parse.urlencode(q)


def rain_print_href_last(c, st, year):
    """Last year's print from the county page: the same town and spot (ll=), no station, so Rain Print
    picks the nearest station with a good record for that year (this year's gauge may have missed more
    of it). No style=, so it opens as every hand-written link does: compared with the 30-year normal,
    the normals and the remarkable days on (components/rain-print.js fromParams)."""
    town = R.station_town(c["station"]["raw"])
    q = {"place": f"{town[:32 - len(st) - 2].rstrip()}, {st}", "year": year}
    ll = c["station"].get("ll")
    if ll:
        q["ll"] = f"{ll[1]:.4f},{ll[0]:.4f}"
    return "/rain-print?" + urllib.parse.urlencode(q)


# ---------------------------------------------------------------- the chart

LABEL_GAP = 18   # chart end labels at least this far apart (font 15 on phones, 10 on a laptop)


def chart(c, year, county, noun="station", ready=None):
    """The plain running total. With ready (st, fips, place, gauge words), the
    same chart is the placeholder and no-JS fallback for the county's Rain
    Print, which components/rain-county-print.js draws over it when the figure
    scrolls near (the days come from data/rain/daily/<st>.json, not the page)."""
    W, H, L, Rm, T, B = 420, 210, 30, 50, 10, 26
    n_year = 366 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 365
    pts = c["cum"]
    has_us = c["usual"] is not None and all(p[2] is not None for p in pts)
    top = max([c["total"]] + ([c["usual"]] if has_us else []) + [1.0])
    step = 1 if top <= 6 else 2 if top <= 12 else 5 if top <= 40 else 10
    ymax = step * (int(top / step) + 1)
    pw, ph = W - L - Rm, H - T - B
    X = lambda doy: L + pw * doy / n_year
    Y = lambda v: T + ph * (1 - v / ymax)
    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-labelledby="rc-ct"><title id="rc-ct">Running total of rain in {e(county)}, {year}'
           + (", against a usual year" if has_us else "") + "</title>"]
    for v in range(0, int(ymax) + 1, step):
        y = Y(v)
        out.append(f'<path class="{"rc-ax" if v == 0 else "rc-grid"}" d="M{L} {y:.0f}H{W - Rm}"/>'
                   f'<text class="rc-lab" x="{L - 6}" y="{y + 4:.0f}" text-anchor="end">{v}</text>')
    for m in range(12):
        doy = (dt.date(year, m + 1, 1) - dt.date(year, 1, 1)).days
        x = X(doy)
        out.append(f'<text class="rc-lab" x="{X(doy + 15):.0f}" y="{H - 8}" text-anchor="middle">{M3[m][0]}</text>')

    def path(k):
        d = [f"M{X(0):.1f},{Y(0):.1f}"]
        for p in pts:
            d.append(f"L{X(p[0] + 1):.1f},{Y(p[k]):.1f}")
        return "".join(d)
    ly, lu = Y(pts[-1][1]), (Y(pts[-1][2]) if has_us else None)
    if has_us:
        out.append(f'<path class="rc-us" d="{path(2)}"/>')
        if abs(ly - lu) < LABEL_GAP:
            if ly <= lu:
                ly, lu = ly - (LABEL_GAP - (lu - ly)) / 2, lu + (LABEL_GAP - (lu - ly)) / 2
            else:
                lu, ly = lu - (LABEL_GAP - (ly - lu)) / 2, ly + (LABEL_GAP - (ly - lu)) / 2
    # keep both labels inside the drawing: the top one's baseline (y+4) at 14
    # or lower, so its 11-unit cap clears the top edge with room to spare;
    # the lower one above the month row
    ys = [ly] + ([lu] if has_us else [])
    shift = max(0, 10 - min(ys))
    shift -= max(0, max(ys) + shift - (H - B - 4))
    ly += shift
    if has_us:
        lu += shift
    out.append(f'<path class="rc-yr" d="{path(1)}"/>')
    xe = X(pts[-1][0] + 1) + 5
    out.append(f'<text class="rc-yl" x="{xe:.1f}" y="{ly + 4:.1f}">{year}</text>')
    if has_us:
        out.append(f'<text class="rc-lab" x="{xe:.1f}" y="{lu + 4:.1f}">Usual</text>')
    out.append("</svg>")
    cap = (f"Inches of rain added up day by day from Jan 1{', solid line' if has_us else ''}"
           + (f", against the usual year at this {noun} (dashed), counted on the same days" if has_us else "")
           + f". Days with no report add nothing to {'either line' if has_us else 'the line'}.")
    plain = f'<figure class="rc-chart">{"".join(out)}<figcaption>{cap}</figcaption></figure>'
    return plain, print_figure(c, year, noun, ready, has_us)


def print_figure(c, year, noun, ready, has_us):
    """The county's year as a Rain Print, with its style picker: a hidden shell that
    components/rain-county-print.js fills and shows. It sits after the farm content,
    beside the one line that sells it (panel Oct 20, Sig's after-main-content rule);
    until then the picker sat at the top of the page, over the plain chart."""
    if not ready:
        return ""
    st, fips, place, gauge, done, snow = ready[:6]
    period = ready[6] if len(ready) > 6 else None
    traces = ready[7] if len(ready) > 7 else 0
    # The usual-year line on the print (2026-10-16; it was off, showNormals false). The page has
    # NOAA's normal for each month summed over the days the station reported (c["months"][m][1],
    # the same numbers as the month table); they add up to the page's usual. The print spreads each
    # month's figure over that month's reported days, so every month's usual and the year's usual
    # are NOAA's own sums; only the line inside a month is drawn straight.
    mn = None
    if has_us and c.get("months") and all(m[1] is not None for m in c["months"]) \
            and abs(sum(m[1] for m in c["months"]) - c["usual"]) <= 0.015:
        mn = ",".join(f"{m[1]:.2f}" for m in c["months"])
    pcap = (f"Every day of {year}{'' if done else ' so far'} at this {noun}, drawn by Rain Print. "
            + (snow_trace_words(snow, traces) or f"This {noun} keeps no snowfall record, so snow is counted as water, not drawn. ")
            + "A gap is a day with no report." + ("" if done else " The empty months are still to come.")
            + ((" The dashed line is the usual year: NOAA&rsquo;s " + ("1991 to 2020" if period == "1991-2020" else "30-year")
                + f" normals for this {noun}, added up over the days it reported, with each month&rsquo;s usual under its total; "
                "inside a month the line is drawn straight.") if mn else ""))
    styles = ('<div class="rc-print-styles" role="group" aria-label="Print style" hidden>'
              '<button type="button" data-style="r1" aria-pressed="true">Staircase</button>'
              '<button type="button" data-style="r2" aria-pressed="false">Roots</button>'
              '<button type="button" class="rc-zoom" aria-pressed="false">Up close</button></div>')
    return (f'<figure class="rc-chart rc-print" id="rc-print" data-st="{st.lower()}" data-fips="{fips}" data-year="{year}" hidden '
            f'data-days="{c["days"]}" data-total="{c["total"]:.2f}" data-place="{e(place)}" data-gauge="{e(gauge)}"'
            + (f' data-mn="{mn}" data-usual="{c["usual"]:.2f}" data-norm="{"1991-2020" if period == "1991-2020" else "30"}"' if mn else "")
            + '>'
            f'{styles}<div class="rc-print-art"></div>'
            f'<figcaption><span class="rc-cap-print" hidden>{pcap}</span></figcaption></figure>')


# ---------------------------------------------------------------- county page

ID_TYPES = {"1", "2", "6"}   # ACIS sid types a reader can look up: WBAN, co-op, GHCN (CoCoRaHS, SNOTEL)
PICK_RULE_1 = ("The pick goes to one with NOAA normals first, then the most days reported, "
               "then the one nearest the middle of the county.")
# data/rain/<st>.json says "pick": 2 once fetch_county_rain.py ranked this way
PICK_RULE_2 = ("Mountain snow sites, and stations far above the rest in the county, come last, "
               "since their rain is not what the farms below get. Then the pick goes to one with NOAA normals, "
               "then the most days reported, then the one nearest the middle of the county.")
# "pick": 3 (2026-10-19): Sig's rule, a full record of rain and snowfall (county_rain.pick_order)
PICK_RULE_3 = ("Mountain snow sites, and stations far above the rest in the county, come last, "
               "since their rain is not what the farms below get. Then the pick goes to one with NOAA normals. "
               "Where snow is normal, a station that keeps a full record of both rain and snowfall comes next, "
               "over a nearer one whose snowfall record has gaps, if it is no more than 10 miles farther or twice as far. "
               "Then the most days reported, then the one nearest the middle of the county.")
# "pick": 4 (2026-10-20): Sig changed the rule, the full snowfall record now comes before NOAA normals
PICK_RULE_4 = ("Mountain snow sites, and stations far above the rest in the county, come last, "
               "since their rain is not what the farms below get. "
               "Where snow is normal, a station that keeps a full record of both rain and snowfall comes first, "
               "over a nearer one whose snowfall record has gaps, if it is no more than 10 miles farther or twice as far, "
               "even when only the nearer one has NOAA normals. "
               "Then the pick goes to one with NOAA normals, then the most days reported, then the one nearest the middle of the county.")


def morning_read(stw):
    """A co-op station (ACIS sid type 2) or a CoCoRaHS gauge is read once a day,
    most often in the morning; an airport (type 1) closes its day at midnight."""
    return stw["net"] == "cocorahs" or stw["sid"].split(" ")[-1] == "2"


IMG_ROOT = ROOT   # where the share images are read from (to put their hash in the URL)


def share_img(st, alt):
    """(image URL, alt) for a state's pages (st) or the hub (None): the card
    scripts/build_share_images.py draws, img/og/rain-<st>.jpg or img/og/rain.jpg,
    with ?v=<hash> so Messages and Facebook fetch a new one when the data
    changes. A state card not drawn yet falls back to the hub's card."""
    import hashlib
    for rel in ([R.share_image(st)] if st else []) + [R.share_image(None)]:
        p = os.path.join(IMG_ROOT, rel)
        if p not in _HASH:
            _HASH[p] = None
            if os.path.exists(p):
                with open(p, "rb") as f:
                    _HASH[p] = hashlib.sha1(f.read()).hexdigest()[:8]
        if _HASH[p]:
            return f"{ORIGIN}/{rel}?v={_HASH[p]}", (alt if rel == R.share_image(st) or not st else None)
    return f"{ORIGIN}/{R.share_image(None)}", None


_HASH = {}


def head(title, desc, url, ld, og_title=None, extra="", img=None):
    img_url, img_alt = img or (f"{ORIGIN}/{R.share_image(None)}", None)
    ldh = "".join('<script type="application/ld+json">' + json.dumps(x, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/") + "</script>" for x in ld)
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0a0c0d">
  <link rel="stylesheet" href="/components/styles.css?v=26">
  {CSS}
  <link rel="icon" href="/img/favicon.ico" sizes="32x32">
  <link rel="icon" type="image/svg+xml" href="/img/icon.svg">
  <link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
  <title>{e(title)}</title>
  <meta name="description" content="{e(desc)}">
  <meta name="author" content="Sigurd Lindquist">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
  <link rel="canonical" href="{url}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="AGSIST">
  <meta property="og:title" content="{e(og_title or title.replace(' | AGSIST', ''))}">
  <meta property="og:description" content="{e(desc)}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{e(img_url)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="{e(img_alt or og_title or title.replace(' | AGSIST', ''))}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="{e(img_url)}">
  {BOOT}
  {ldh}{extra}
</head>"""


AUTHOR = {"@type": "Person", "name": "Sigurd Lindquist", "jobTitle": "Certified Crop Adviser (CCA)", "url": "https://agsist.com/about"}
PUBLISHER = {"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com/"}
FOOT = """  </main>
  <div id="site-footer"></div>
  <script src="/components/loader.js?v=19" defer></script>
</body>
</html>
"""
# State pages (Sig, 2026-10-16): the one cross-promotion is the rain gauge
# waitlist line, after the table (components/rain-print-promo.js "gauge":
# "Want a better rain gauge? Sig is designing one. Get updates."). County
# pages keep their Rain Print block and nothing else.
GAUGE_SLOT = '<p class="rp-promo" data-rain-print-promo="gauge" hidden></p>'
# rain.html only: glossary marks and the Next block (data/next-links.json)
FOOT_NAT = FOOT.replace("</body>", '  <script src="/components/next-links.js?v=3" defer></script>\n</body>')
FOOT_GAUGE = FOOT.replace('  <script src="/components/loader.js?v=19" defer></script>\n',
                          '  <script src="/components/loader.js?v=19" defer></script>\n  <script src="/components/rain-print-promo.js?v=4" defer></script>\n')


def crumbs_ld(items):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": u} for i, (n, u) in enumerate(items)]}


# One plain link to /rain-print itself, inside the same promo block (still one promo a page), so the 2,700 county
# pages also point at the bare page with the words people search for (head to head, 2026-10-15).
RP_ANY_YEAR = 'Want another year, like the drought or the year you married? <a href="/rain-print">Rainfall art of any town and year</a>.'


# the one plain mention of the AGSIST rain gauge on a county rain page: a link inside the
# sentence that already says why a reader's own gauge differs (promo audit 2026-10-23)
GAUGE_LINE = 'Your own <a href="/rain-gauge">rain gauge</a> can read differently a few miles away.'


def radar_line(st, name, stw):
    """One line to /rain-radar (NOAA MRMS radar and gauge estimate) at the
    county's station. MRMS covers the lower 48 only, so none in AK or HI."""
    ll = stw.get("ll")
    if st in ("AK", "HI") or not ll:
        return ""
    q = urllib.parse.urlencode({"lat": f"{ll[1]:.3f}", "lon": f"{ll[0]:.3f}", "label": f"{name}, near the {stw.get('name') or 'county'} gauge"})
    return f'<p class="rc-radar"><a href="/rain-radar?{e(q)}">Rain on your field in the last 7 days, from radar</a></p>'


def year_ask(name, year, fips):
    """One email in January with this county's full-year rain (subs worker v5.28,
    topic rainyear:<year>:<fips>, mailed by scripts/send_rain_year.py from
    county-rain.yml once the finished year is fetched). components/signup-ask.js
    draws it; the morning briefing box starts empty (Sig, 2026-10-19: no ask
    pre-ticks the Daily)."""
    return (f'<div data-signup-ask="Email me {e(name)}&rsquo;s full {year} rain total in January." '
            f'data-topic="rainyear:{year}:{fips}" '
            f'data-ok="Done. One email in January, once NOAA has all of {year} for {e(name)}." '
            f'data-note="One email: the year&rsquo;s total against a usual year, and a link to the month by month page."></div>')


def county_page(ctx):
    c, st, fips, year, d = ctx["c"], ctx["st"], ctx["fips"], ctx["year"], ctx["d"]
    stn = R.STATES[st]
    name = c["name"]
    full = f"{name}, {stn}"
    full_c = f"{name}, {stn},"                  # before a verb or "in": "Barron County, Wisconsin, had"
    st_slug = R.slug(stn)
    url = f"{ORIGIN}/rain/{st_slug}/{ctx['slug']}"
    done = done_year(d)                         # the year is over (fetched through Dec 31)
    asof = c["as_of"]
    whole = done and asof[5:] == "12-31"        # and this station reported through Dec 31
    ans = answer(c, name, year, done)
    # the site's one cap (scripts/seo_caps.py): " | AGSIST" gives way first
    q_ = (f"How Much Rain Did {full_c} Get in {year}?" if done else f"How Much Rain Has {full_c} Had in {year}?")
    title = CAPS.fit([q_ + CAPS.SUFFIX, q_])
    span = f"Jan 1 to {short_date(asof)}"
    pct_bit = f", {c['pct']}% of a usual year{'' if whole else ' to date'}" if c["pct"] is not None else ""
    has = [x for x, k in (("the wettest month", "wet_month"), ("the biggest rain", "max_day"), ("the longest dry stretch", "dry")) if c.get(k)]
    desc = (f"{inch(c['total'])} inches of rain in {full_c} in {year} ({span}){pct_bit}. "
            + "Month by month" + ("".join(", " + x for x in has[:-1]) + " and " + has[-1] if has else "") + ".")
    if len(desc) > CAPS.DESC_MAX:
        desc = f"{inch(c['total'])} inches of rain in {full_c} in {year} ({span}){pct_bit}. Month by month" + (" and the year's biggest rain." if c.get("max_day") else ".")
    if len(desc) > CAPS.DESC_MAX:
        desc = f"{inch(c['total'])} inches of rain in {full}, {span}, {year}{pct_bit}."
    stw = c["station"]
    noun = "gauge" if stw["net"] == "cocorahs" else "station"     # one word for it on the whole page
    norm_words = (f"NOAA&rsquo;s 1991 to 2020 daily normals for this {noun}" if d["normals"] == "1991-2020"
                  else f"NOAA&rsquo;s current 30-year daily normals for this {noun}")
    # CoCoRaHS began in 1998: the normal is NOAA's estimate, not the gauge's own 30 years
    norm_note = (" The volunteer gauges started in 1998, so none has 30 years of its own; "
                 "NOAA estimates the rest from long-record stations nearby." if stw["net"] == "cocorahs" else "")
    # ---- figures
    figs = [(f"Rain {'in ' + str(year) if done else 'so far'}", f"{inch(c['total'])} <small>in</small>")]
    if c["usual"] is not None:
        figs.append((f"Usual {'year' if whole else 'by ' + short_date(asof)}", f"{inch(c['usual'])} <small>in</small>"))
    if c["pct"] is not None:
        figs.append(("Percent of usual", f"{c['pct']}%"))
    if c.get("last"):
        figs.append((f"{year - 1}" if whole else f"{year - 1} by {short_date(c['last']['through'])}", f"{inch(c['last']['total'])} <small>in</small>"))
    r7, r30 = (None, None) if done else (recent(c, ctx.get("day"), 7), recent(c, ctx.get("day"), 30))
    for r, n in ((r7, 7), (r30, 30)):
        if r:
            figs.append((f"Last {n} days, {span_words(r[1], asof)}", f"{inch(r[0])} <small>in</small>"))
    figs_html = "".join(f"<div><dt>{a}</dt><dd>{b}</dd></div>" for a, b in figs)
    # ---- month table
    has_us = c["usual"] is not None
    rows = []
    for i, (t, u, rep, days) in enumerate(c["months"]):
        lab = f'<abbr title="{ML[i]}">{M3[i]}</abbr>'
        if i == len(c["months"]) - 1 and not whole and days < (dt.date(year + (i == 11), (i + 1) % 12 + 1, 1) - dt.date(year, i + 1, 1)).days:
            lab += f' <span class="rc-n">to the {days}{"st" if days in (1, 21, 31) else "nd" if days in (2, 22) else "rd" if days in (3, 23) else "th"}</span>'
        if rep < days:
            miss = days - rep
            lab += f' <span class="rc-n">{miss} {"day" if miss == 1 else "days"} not reported</span>'
        cells = f"<td>{inch(t)}</td>"
        if has_us:
            df = t - u
            cls = "rc-up" if df > 0.004 else "rc-dn" if df < -0.004 else ""
            sign = "+" if df > 0.004 else "&minus;" if df < -0.004 else ""
            cells += f"<td>{inch(u)}</td><td{' class=' + chr(34) + cls + chr(34) if cls else ''}>{sign}{inch(abs(df))}</td>"
        rows.append(f'<tr><th scope="row">{lab}</th>{cells}</tr>')
    tot = f"<td><b>{inch(c['total'])}</b></td>"
    if has_us:
        df = c["total"] - c["usual"]
        tot += f"<td><b>{inch(c['usual'])}</b></td><td><b>{'+' if df > 0.004 else '&minus;' if df < -0.004 else ''}{inch(abs(df))}</b></td>"
    head_cells = "<th scope=\"col\">Month</th><th scope=\"col\">Rain, in</th>" + ("<th scope=\"col\">Usual, in</th><th scope=\"col\">Vs usual</th>" if has_us else "")
    table = (f'<div class="rc-scroll" tabindex="0" role="region" aria-label="Rain by month"><table class="rc-t"><caption class="rc-sr">Rain by month in {e(full)}, {year}</caption>'
             f"<thead><tr>{head_cells}</tr></thead><tbody>{''.join(rows)}<tr><th scope=\"row\"><b>{'Year' if done else 'So far'}</b></th>{tot}</tr></tbody></table></div>")
    # ---- the year in a few lines
    facts = []
    faq = [(f"How much rain {'did' if done else 'has'} {full_c} {'get' if done else 'had'} in {year}?", ans)]
    if c["pct"] is not None:
        p = c["pct"]
        # within 3 points of usual, as Rain Print says it (|pct| < 3)
        word = "About usual" if abs(p - 100) < 3 else ("Wetter" if p > 100 else "Drier")
        faq.append((f"Was {name} wetter or drier than usual in {year}?" if done else f"Is {name} wetter or drier than usual in {year}?",
                    f"{word}{'' if done else ' so far'}. {where_words(c)[0].upper() + where_words(c)[1:]} had {inches_word(c['total'])} "
                    f"{'in ' + str(year) if whole else 'from Jan 1 to ' + short_date(asof)}, {p}% of the usual {inches_word(c['usual'])} for the same days."))
    if r7:
        faq.append((f"How much rain fell in {name} in the last week?",
                    f"{inches_word(r7[0])} from {short_date(r7[1])} to {short_date(asof)} at {where_words(c)}"
                    + (f", and {inches_word(r30[0])} over the last 30 days, {span_words(r30[1], asof)}." if r30 else ".")
                    + f" Those are the latest days the {noun} has reported; NOAA&rsquo;s daily numbers come in a few days late."))
    if c.get("wet_month"):
        m, v = c["wet_month"]
        facts.append(f"<li><b>Wettest month:</b> {ML[m]}, {inches_word(v)}.</li>")
        faq.append((f"What was the wettest month in {name} in {year}?",
                    f"{ML[m]}, with {inches_word(v)} at {where_words(c)}{'' if whole else ', counting Jan 1 through ' + short_date(asof)}."))
    if c.get("max_day"):
        # with multi-day reports in the year, a day inside one could have been
        # bigger, so it is the biggest one-day reading, not the most in one day
        dd, v = c["max_day"]
        facts.append(f"<li><b>{'Biggest one-day reading' if c['acc'] else 'Biggest single day'}:</b> {inches_word(v)} on {short_date(dd)}.</li>")
        faq.append((f"What was the biggest rain in {name} in {year}?",
                    f"{inches_word(v)} on {long_date(dd)}, "
                    + ("the biggest one-day reading" if c["acc"] else "the most the gauge caught in one day")
                    + f"{'' if whole else (' this year' if not done else '') + ' through ' + short_date(asof)}."
                    + (" A reading that covers more than one day is not counted as a one-day rain." if c["acc"] else "")))
    elif c["acc"]:
        # a multi-day report could hide a bigger day: say so instead of a number
        facts.append(f"<li><b>Biggest single day:</b> not known. {c['acc']} {'report covers' if c['acc'] == 1 else 'reports cover'} more than one day, "
                     "and the biggest day could be inside one of them.</li>")
    if c.get("dry") and c["dry"][0] >= 2:
        n, a, b = c["dry"]
        still = (b == asof and not done)
        facts.append(f"<li><b>Longest dry stretch:</b> {n} days in a row with nothing in the gauge, not even a trace, {short_date(a)} to {short_date(b)}"
                     + (f", still going as of {short_date(asof)}" if still else "") + ".</li>")
    if c.get("last"):
        L = c["last"]
        lmiss = L["days"] - L["reported"]
        vs = last_year_words(c, L, year)
        facts.append(f"<li><b>{year - 1}{', the whole year' if whole else ' by the same date'}:</b> {inches_word(L['total'])} at the same {noun}"
                     + (f" (it missed {days_word(lmiss)})" if lmiss else "") + "." + (" " + vs if vs else "") + "</li>")
        faq.append((f"How does {year} compare with {year - 1} in {name}?",
                    f"From Jan 1 to {short_date(L['through'])}, {where_words(c)} had {inches_word(L['total'])} in {year - 1}"
                    + (f" ({year - 1} missed {days_word(lmiss)})" if lmiss else "") + f" and {inches_word(c['total'])} in {year}"
                    + (f" ({year} missed {days_word(c['missing'])})" if c["missing"] else "") + "." + (" " + vs if vs else "")))
    if c["acc"]:
        facts.append(f"<li>On {c['acc']} {'report' if c['acc'] == 1 else 'reports'} the observer read the gauge after more than one day. "
                     "That rain counts on the day it was read, so it is in the totals but not split by day.</li>")
    facts_html = f'<ul class="rc-list">{"".join(facts)}</ul>' if facts else ""
    # ---- station
    miss = c["missing"]
    sid, sid_type = stw["sid"].split(" ")[0], stw["sid"].split(" ")[-1]
    # the ID only where a reader can look it up (WBAN, co-op, GHCN); a station
    # named for a place that is not a town gets no repeat of its name
    id_bit = f" ({noun} ID {e(sid)})" if sid_type in ID_TYPES else ""
    station_p = (f"The numbers come from NOAA&rsquo;s daily record for {'the volunteer rain gauge' if stw['net'] == 'cocorahs' else 'the station'} "
                 f"{e(R.station_where(stw['raw']))}{id_bit}, {miles_from(stw['mi'])} the middle of {e(name)}. "
                 + (f"It reported {c['reported']} of the {c['days']} days from Jan 1 to {short_date(asof)}; "
                    f"{'the one day' if miss == 1 else 'the ' + str(miss) + ' days'} with no report count as unknown, not as dry."
                    if miss else f"It reported every one of the {c['days']} days from Jan 1 to {short_date(asof)}.")
                 + " Rain here means everything the gauge caught: rain, and snow melted down to water. A trace, too little to measure, adds nothing to the totals, but it ends a dry stretch: something fell that day."
                 + (" It is read once a day, usually in the morning, and each reading is filed under the day it was read, "
                    "so an evening storm can show up on the next day." if morning_read(stw) else ""))
    usual_p = (f"Usual means {norm_words}, added up over the same {c['reported']} days the {noun} reported, so a missing day counts on neither side.{norm_note}"
               if c["usual"] is not None else f"This {noun} has no NOAA normal, so this page gives no usual year or percent for it.")
    n_ok = c.get("n_ok", 1)
    if n_ok <= 1:
        pick_p = (f"Why this {noun}: it is the only one inside {e(name)} that reported at least 90% of the days in {year}. "
                  + GAUGE_LINE)
    else:
        pick_p = (f"Why this {noun}: {n_ok} stations inside {e(name)} reported at least 90% of the days in {year}. "
                  + {4: PICK_RULE_4, 3: PICK_RULE_3, 2: PICK_RULE_2}.get(d.get("pick"), PICK_RULE_1)
                  + " " + GAUGE_LINE)
    # ---- next door and links
    nb_html = "".join(f'<li><a class="rc-nb" href="{h}">{e(n)} <small>{v}</small></a></li>' for n, h, v in ctx["nbrs"])
    more = [(f"Rain in {e(stn)}, county by county", f"/rain/{st_slug}")]
    for label, top in (("PRF insurance in", "prf"), ("Farmland Atlas:", "farmland-atlas")):
        if os.path.exists(os.path.join(ROOT, top, st_slug, ctx["slug"] + ".html")):
            more.append((f"{label} {e(name)}", f"/{top}/{st_slug}/{ctx['slug']}"))
    # the county's ARC or PLC page when it is live (scripts/cross_links.py, night SEO audit Oct 19, 2026)
    arc_h = XL.arc_href(ROOT, st_slug, ctx["slug"])
    if arc_h:
        more.append((f"ARC or PLC in {e(name)}", arc_h))
    more_html = " &middot; ".join(f'<a href="{h}">{t}</a>' for t, h in more)
    rp = rain_print_href(c, st, year)
    # Oct 1 to Dec 24 (by the page's own as-of day): the gift card is the Christmas answer for this year's print
    xmas = not done and f"{year}-10-01" <= c["as_of"] <= f"{year}-12-24"
    ship = "" if done else (f"Give it for Christmas: a gift card to put under the tree now, the {year} print in January." if xmas
                            else f"Prints of {year} ship in January, once the full year is in.")
    miss_note = ""
    if miss > RP_MISS_BLOCK:
        # rain_print_href leaves the station off: say why the print draws another
        miss_note = (f"This {noun} missed {miss} days this year, more than a print can show honestly, "
                     "so Rain Print draws the nearest station with a fuller record.")
    # ---- the county's year as a Rain Print, and the one line that sells it (one promo a page)
    ready = None
    snow = print_snow(ctx.get("day"), year)
    if print_ready(c, ctx.get("day")):
        gauge = f"Weather station: {stw['name']}, {miles_from(stw['mi'])} the middle of {name}"
        ready = (st, fips, f"{name}, {stn}", gauge, done, snow_caption(ctx.get("day"), snow, year), d.get("normals"), print_snow_traces(ctx.get("day"), year))
    pr = rp_prices()
    price = f": framed ${pr[0]}, print ${pr[1]}" if pr else ""
    so_far = "" if done else " so far"
    lead_print = (f'<span id="rc-sell-lead" hidden>This is {e(name)}&rsquo;s {year}{so_far}, drawn as a Rain Print. '
                  f'Put your name and dates on it{price}.</span>') if ready else ""
    # Oct 1 to the Christmas cutoffs: two buttons in the one promo block, last year by Christmas and this year in January
    last_by = "" if done else xmas_last_by(c["as_of"], year, rp_cutoffs())
    lead_plain = (f'<span class="rc-sell-plain">Get {e(name)}&rsquo;s {"" if last_by else str(year) + " "}{"rain and snow" if snow == "drawn" else "rain"} drawn as a Rain Print, '
                  f'with your name and dates{price}.</span>')
    if last_by:
        sell_btns = (f'</p><p class="rc-two"><a class="btn btn-primary" href="{e(rain_print_href_last(c, st, year - 1))}">Last year, by Christmas</a> '
                     f'<a class="btn btn-secondary" href="{e(rp)}">This year, in January</a></p>')
        ship = (f"Last year&rsquo;s print ({year - 1}) comes by Christmas if you order it {last_by}. "
                f"This year&rsquo;s ({year}) is a gift card to put under the tree now, the print in January.")
    else:
        sell_btns = f' <a class="btn btn-primary" href="{e(rp)}">Make yours</a></p>'
    sell = (f'<div class="rc-sell"><p>{lead_print}{lead_plain}{sell_btns}'
            + (f'<p class="rc-fine">{(ship + " " + miss_note).strip()}</p>' if (ship or miss_note) else "")
            + f'<p class="rc-fine">{RP_ANY_YEAR}</p>' + "</div>"
            + (PRINT_JS if ready else ""))
    ld = [
        {"@context": "https://schema.org", "@type": "WebPage", "@id": url, "url": url, "name": title.replace(" | AGSIST", ""),
         "description": desc, "dateModified": d["fetched"][:10], "inLanguage": "en-US",
         "about": {"@type": "AdministrativeArea", "name": full}, "author": AUTHOR, "publisher": PUBLISHER},
        {"@context": "https://schema.org", "@type": "Dataset", "name": f"Rain in {full}, {year}, Jan 1 to {short_date(asof)}",
         "description": f"Daily precipitation from the {kind_word(c)} {stw['raw']} ({stw['sid'].split(' ')[0]}) in {full}, added up by month for {year} through {long_date(asof)}"
                        + (", with NOAA daily normals summed over the same days." if c["usual"] is not None else "."),
         "url": url, "temporalCoverage": f"{year}-01-01/{asof}", "isBasedOn": "https://www.rcc-acis.org/",
         # the coordinates are the gauge's, not the county's (Bowie Co., TX: Texarkana, 20 miles from the middle), so they
         # go on a Place named for the gauge (sets pass, 2026-10-18)
         "spatialCoverage": [{"@type": "Place", "name": full},
                             {"@type": "Place", "name": f"{kind_word(c)} {stw['raw']} ({stw['sid'].split(' ')[0]})",
                              "geo": {"@type": "GeoCoordinates", "latitude": stw["ll"][1], "longitude": stw["ll"][0]}}],
         "creator": PUBLISHER, "dateModified": d["fetched"][:10],
         "distribution": {"@type": "DataDownload", "encodingFormat": "application/json", "contentUrl": f"{ORIGIN}/data/rain/{st.lower()}.json"}},
        {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": S.text_of(q), "acceptedAnswer": {"@type": "Answer", "text": S.text_of(a)}} for q, a in faq]},
        crumbs_ld([("Home", ORIGIN + "/"), ("Rain by county", ORIGIN + "/rain"), (stn, f"{ORIGIN}/rain/{st_slug}"), (name, url)]),
    ]
    faq_html = "".join(f"<details><summary>{q}</summary><p>{a}</p></details>" for q, a in faq)
    plain_chart, print_fig = chart(c, year, name, noun, ready)
    h1 = (f"How much rain did {e(full_c)} get in {year}?" if done else f"How much rain has {e(full_c)} had in {year}?")
    return head(title, desc, url, ld, img=share_img(st, ctx.get("alt") or R.share_alt(d))) + f"""
<body>
  <a href="#main" class="skip">Skip to content</a>
  <div id="site-header"></div>
  <main id="main" class="main" tabindex="-1">
  <div class="rc">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/rain">Rain by county</a> &rsaquo; <a href="/rain/{st_slug}">{e(stn)}</a> &rsaquo; <span aria-current="page">{e(name)}</span></nav>
    <p class="rc-asof">{'All of ' + str(year) + ', Jan 1 to Dec 31' if whole else (str(year) + ', Jan 1 to ' + short_date(asof) + ', the last day reported' if done else 'As of ' + long_date(asof) + ', the latest day this ' + noun + ' has reported')}</p>
    <h1>{h1}</h1>
    <p class="rc-answer">{ans.replace(inches_word(c['total']), '<b>' + inches_word(c['total']) + '</b>', 1)}</p>
    {('<p class="rc-story">' + e(ctx['story']) + '</p>' + chr(10) + '    ') if ctx.get('story') else ''}<dl class="rc-figs">{figs_html}</dl>
    {radar_line(st, name, stw)}
    {plain_chart}
    <h2>Month by month</h2>
    {table}
    {year_ask(name, year, fips) if not done else ''}
    {('<h2>' + str(year) + (' in' if done else ' so far in') + ' ' + e(name) + '</h2>' + facts_html) if facts_html else ''}
    {print_fig}
    {sell}
    <h2>The station, and what usual means</h2>
    <p>{station_p}</p>
    <p>{usual_p}</p>
    <p class="rc-fine">{pick_p}</p>
    <h2>Questions</h2>
    <div class="rc-faq">{faq_html}</div>
    {('<h2>Next door</h2><ul class="rc-next">' + nb_html + '</ul>') if nb_html else ''}
    <p class="rc-fine">{more_html}</p>
    <p class="rc-byline">By <a href="/about">Sigurd Lindquist</a>, CCA. Daily NOAA records through <a href="https://www.rcc-acis.org/" rel="noopener">RCC-ACIS</a>, read {long_date(d['fetched'][:10])}; rebuilt weekly. NOAA&rsquo;s daily numbers come in a few days late and are sometimes corrected.</p>
  </div>
{FOOT}"""


# ---------------------------------------------------------------- state page

UNIT = R.UNIT
UNIT_HEAD = {"LA": "Parish", "AK": "Borough"}


def unit(st):
    """(one, many): what a state calls its counties."""
    return UNIT.get(st, ("county", "counties"))


def middle(cs):
    """The median county's percent of usual, or None."""
    p = sorted(c["pct"] for c in cs.values() if c["pct"] is not None)
    if not p:
        return None
    k = len(p) // 2
    # an even count's median is the midpoint, kept to the half: round() made 92.5 into 92, and then
    # "half above 92%" was off by one county (Florida, 2026-10-18)
    return p[k] if len(p) % 2 else (p[k - 1] + p[k]) / 2


def state_page(st, d, pages, none_rows):
    stn = R.STATES[st]
    st_slug = R.slug(stn)
    url = f"{ORIGIN}/rain/{st_slug}"
    year = d["year"]
    cs = d["counties"]
    asofs = sorted({c["as_of"] for c in cs.values()})
    done = done_year(d)
    mid = middle(cs)
    u1, un = unit(st)
    by = {"LA": "Parish by Parish", "AK": "Borough by Borough"}.get(st, "County by County")
    q_ = f"How Much Rain Has {stn} Had in {year}? {by}" if not done else f"How Much Rain Did {stn} Get in {year}? {by}"
    title = CAPS.fit([q_ + CAPS.SUFFIX, q_])
    early = sum(1 for c in cs.values() if c["as_of"] < asofs[-1])
    lede = (f"{len(cs)} {stn} {un} have a weather station inside the {u1} that reported at least 90% of the days in {year}"
            + ("." if done else f", through {short_date(asofs[-1])}"
               + (f" ({early} {'station stops' if early == 1 else 'stations stop'} earlier; each {u1} page gives its own last day)." if early else ".")))
    if mid is not None:
        n_pct = sum(1 for c in cs.values() if c["pct"] is not None)
        who = f"the {un}" if n_pct == len(cs) else f"the {n_pct} {un} with a NOAA usual year"
        lede += f" Half {who} are above {mid:g}% of a usual year{'' if done else ' to date'} and half below."
    wettest = max(cs.items(), key=lambda kv: kv[1]["total"])
    driest = min(cs.items(), key=lambda kv: kv[1]["total"])
    desc = (f"Rain {'in' if done else 'so far in'} {year} in {len(cs)} {stn} {un}, from weather stations: inches, percent of usual and the station. "
            f"Most: {wettest[1]['name']}, {inch(wettest[1]['total'])} in.")
    if len(desc) > CAPS.DESC_MAX:
        desc = f"Rain {'in' if done else 'so far in'} {year} in {len(cs)} {stn} {un} from weather stations: inches, percent of usual, the station."
    rows = []
    for fips, c in sorted(cs.items(), key=lambda kv: kv[1]["name"]):
        href = pages[fips][1]
        early_bit = "" if c["as_of"] == asofs[-1] else f' <span class="rc-n">to {short_date(c["as_of"])}</span>'
        rows.append(f'<tr><th scope="row"><a href="{href}">{e(re.sub(r" (County|Parish)$", "", c["name"]))}</a>{early_bit}</th><td>{inch(c["total"])}</td>'
                    f'<td>{inch(c["usual"]) if c["usual"] is not None else "none"}</td><td>{str(c["pct"]) + "%" if c["pct"] is not None else "none"}</td>'
                    f'<td>{e(R.station_name(c["station"]["raw"]))}</td><td>{short_date(c["as_of"])}</td></tr>')
    none_html = ""
    if none_rows:
        held = [r for r in none_rows if r[3]]
        items = "".join(f"<li>{e(n)}{'*' if hd else ''} <small>{('nearest: <a href=' + chr(34) + h + chr(34) + '>' + e(nn) + '</a>') if h else 'none nearby either'}</small></li>"
                        for n, nn, h, hd in none_rows)
        none_html = (f'<h2>{un[0].upper() + un[1:]} without a page</h2><p>These {len(none_rows)} {un if len(none_rows) != 1 else u1} have no station inside them that reported at least 90% of the days '
                     f'in {year}{"" if done else " so far"}, so they get no page. A missing day is not a dry day, and a total with too many of them would read low. Next to each is the nearest {u1} that has one.</p><ul class="rc-states">{items}</ul>'
                     # fits both holds in fetch_county_rain.hold_outliers: the
                     # percent against the neighbors' median, and the total
                     # (no normal) against every neighbor's
                     + (f'<p class="rc-fine">* This {u1}&rsquo;s station reported, but it caught under 40% of what the {un} around it typically caught, in a place that usually gets real rain. '
                        f'That is far more often a stuck or clogged gauge than a dry year, so it is left out.</p>' if held else ''))
    ld = [
        {"@context": "https://schema.org", "@type": "WebPage", "@id": url, "url": url, "name": title.replace(" | AGSIST", ""), "description": desc,
         "dateModified": d["fetched"][:10], "inLanguage": "en-US", "about": {"@type": "AdministrativeArea", "name": stn}, "author": AUTHOR, "publisher": PUBLISHER},
        crumbs_ld([("Home", ORIGIN + "/"), ("Rain by county", ORIGIN + "/rain"), (stn, url)]),
    ]
    by = by[0] + by[1:].lower()
    h1 = f"How much rain has {e(stn)} had in {year}? {by}" if not done else f"How much rain did {e(stn)} get in {year}? {by}"
    return head(title, desc, url, ld, img=share_img(st, R.share_alt(d))) + f"""
<body>
  <a href="#main" class="skip">Skip to content</a>
  <div id="site-header"></div>
  <main id="main" class="main" tabindex="-1">
  <div class="rc">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/rain">Rain by county</a> &rsaquo; <span aria-current="page">{e(stn)}</span></nav>
    <p class="rc-asof">{'All of ' + str(year) if done else 'As of ' + long_date(asofs[-1])}</p>
    <h1>{h1}</h1>
    <p class="rc-answer">{lede}</p>
    <div class="rc-scroll" tabindex="0" role="region" aria-label="Every {u1}, scrolls sideways"><table class="rc-t rc-t-wide"><caption class="rc-sr">Rain {'in' if done else 'so far in'} {year} by {u1}, {e(stn)}</caption>
    <thead><tr><th scope="col">{UNIT_HEAD.get(st, "County")}</th><th scope="col">Rain</th><th scope="col">Usual</th><th scope="col">% usual</th><th scope="col">Station</th><th scope="col">Through</th></tr></thead>
    <tbody>{''.join(rows)}</tbody></table></div>
    <p class="rc-fine">Rain and usual are in inches. Usual is NOAA&rsquo;s daily normal at each station, added up over the days that station reported. A station with no NOAA normal shows none. Each {u1} page has the month by month table and how the station was picked.</p>
    {none_html}
    {GAUGE_SLOT}
    <p class="rc-byline">By <a href="/about">Sigurd Lindquist</a>, CCA. Daily NOAA records through <a href="https://www.rcc-acis.org/" rel="noopener">RCC-ACIS</a>, read {long_date(d['fetched'][:10])}; rebuilt weekly. <a href="/rain">Every state</a> &middot; <a href="/rain-print">Rain Print</a></p>
  </div>
{FOOT_GAUGE}"""


# ---------------------------------------------------------------- hub

def hub_page(files, built):
    url = f"{ORIGIN}/rain"
    years = sorted({d["year"] for d in files.values()})
    yw = str(years[-1]) if len(years) == 1 else "this year"
    done = len(years) == 1 and all(done_year(d) for d in files.values())   # every state fetched through Dec 31
    total = sum(len(d["counties"]) for d in files.values())
    rows = []
    for st, d in sorted(files.items(), key=lambda kv: R.STATES[kv[0]]):
        if not d["counties"]:
            continue
        mid = middle(d["counties"])
        last = max(c["as_of"] for c in d["counties"].values())
        u1, un = unit(st)
        rows.append(f'<li><a href="/rain/{R.slug(R.STATES[st])}">{e(R.STATES[st])}</a> <small>{len(d["counties"])} {un if len(d["counties"]) != 1 else u1}'
                    + (f", typical {u1} {mid:g}% of usual" if mid is not None else "") + f", {d['year']} through {short_date(last)}</small></li>")
    title = f"How Much Rain Did Your County Get in {yw}? | AGSIST" if done else "How Much Rain Has Your County Had This Year? | AGSIST"
    sofar = "" if done else "so far "
    yin = "in " + yw if yw[0].isdigit() else yw
    desc = (f"Rain {sofar}{yin} for {total:,} US counties, from a weather station in each county: inches, percent of a usual year, month by month.")
    ld = [
        {"@context": "https://schema.org", "@type": "WebPage", "@id": url, "url": url, "name": title.replace(" | AGSIST", ""), "description": desc,
         "dateModified": built, "inLanguage": "en-US", "author": AUTHOR, "publisher": PUBLISHER},
        crumbs_ld([("Home", ORIGIN + "/"), ("Rain by county", url)]),
    ]
    page = head(title, desc, url, ld, img=share_img(None, R.share_alt_us(files))) + f"""
<body>
  <a href="#main" class="skip">Skip to content</a>
  <div id="site-header"></div>
  <main id="main" class="main" tabindex="-1">
  <div class="rc">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <span aria-current="page">Rain by county</span></nav>
    <h1>{f"How much rain did your county get in {yw}?" if done else "How much rain has your county had this year?"}</h1>
    <p class="rc-answer">Pick your state, then your county. Each county page gives the rain {"" if done else "so far "}{"in " + yw if yw[0].isdigit() else yw} at a weather station in that county, against a usual year, month by month.</p>
    <ul class="rc-states">{''.join(rows)}</ul>
    <h2>How the numbers are counted</h2>
    <ul class="rc-list">
      <li>Each county page uses one weather station inside that county, and only a station that reported at least 90% of the days {"in " + yw if done else "this year"}. Counties without one are listed on the state page with the nearest county that has one.</li>
      <li>A day the station did not report is unknown, not dry. It adds nothing to the total and nothing to the usual year either.</li>
      <li>Usual is NOAA&rsquo;s daily normal for that station, added up over the same days it reported.</li>
      <li>Every page says the latest day its station has reported. NOAA&rsquo;s daily numbers come in a few days late, and the pages are rebuilt about once a week.</li>
    </ul>
    <p class="rc-fine">Want one year of rain at your place on the wall? <a href="/rain-print">Rain Print, rainfall art of any town and year</a>, draws it from the same NOAA records.</p>
    <p class="rc-byline">By <a href="/about">Sigurd Lindquist</a>, CCA. Daily NOAA records through <a href="https://www.rcc-acis.org/" rel="noopener">RCC-ACIS</a>.</p>
  </div>
{FOOT_NAT}"""
    return nav.render(page, "rain.html", nav.block("header"), nav.block("footer"))


def sitemap(urls):
    body = "".join(f"  <url><loc>{u}</loc><lastmod>{m}</lastmod></url>\n" for u, m in urls)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!-- Rain by county. Written by scripts/build_county_rain.py; lastmod is the day the NOAA records were read. -->\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + "</urlset>\n")


# ---------------------------------------------------------------- build

BOOT = None


def load(data_dir):
    files = {}
    for p in sorted(glob.glob(os.path.join(data_dir, "*.json"))):
        d = json.load(open(p, encoding="utf-8"))
        if d.get("state") in R.STATES:
            files[d["state"]] = d
    return files


def load_daily(data_dir, files):
    """{st: {fips: packed days}} from data/rain/daily/<st>.json, for states whose
    daily file is from the same fetch as the state file (same year and fetch time)."""
    out = {}
    for st, d in files.items():
        p = os.path.join(data_dir, "daily", st.lower() + ".json")
        if not os.path.exists(p):
            continue
        dd = json.load(open(p, encoding="utf-8"))
        if dd.get("state") == st and dd.get("year") == d["year"] and dd.get("fetched") == d["fetched"]:
            out[st] = dd.get("counties") or {}
    return out


def build(data_dir, C=None, NB=None, img_root=None):
    """{relative path: text} for everything this build owns. img_root: where
    the share images are (default the site), for the hash in their URLs."""
    global BOOT, IMG_ROOT
    IMG_ROOT = img_root or ROOT
    _HASH.clear()
    if BOOT is None:
        BOOT = S.boot()
    C = C or R.counties()
    NB = NB if NB is not None else R.neighbors()
    files = load(data_dir)
    daily = load_daily(data_dir, files)
    stories = CS.load_stories(data_dir)   # data/rain/stories/<st>.json: dated stories, same station, at most 35 days old
    pages = {}   # fips -> (name, href, total text)
    for st, d in files.items():
        for fips, c in d["counties"].items():
            if fips in C:
                pages[fips] = (c["name"], f"/rain/{R.slug(R.STATES[st])}/{C[fips]['slug']}",
                               f"{inch(c['total'])} in" + (f", {c['pct']}%" if c["pct"] is not None else ""), c["as_of"])
    want, urls = {}, []
    for st, d in sorted(files.items(), key=lambda kv: R.STATES[kv[0]]):
        st_slug = R.slug(R.STATES[st])
        day = d["fetched"][:10]
        alt = R.share_alt(d)
        for fips, c in sorted(d["counties"].items()):
            if fips not in C:
                continue
            nb = [f for f in NB.get(fips, []) if f in pages]
            nb.sort(key=lambda f: (C[f]["st"] != st, pages[f][0]))
            # a neighbor whose station stops on another day says which day
            nbrs = [(pages[f][0] + ("" if C[f]["st"] == st else ", " + C[f]["st"]), pages[f][1],
                     pages[f][2] + ("" if pages[f][3] == c["as_of"] else f" to {short_date(pages[f][3])}")) for f in nb[:4]]
            body = county_page({"c": c, "st": st, "fips": fips, "year": d["year"], "d": d, "slug": C[fips]["slug"],
                                "nbrs": nbrs, "n_ok": c.get("n_ok", 1), "alt": alt,
                                "day": daily.get(st, {}).get(fips),
                                "story": CS.story_for(stories.get(st, {}).get(fips), dict(CS.page_now(c, d), facts=CS.facts(c, d, st)))})
            body = nav.fill_fonts(body)
            rel = f"rain/{st_slug}/{C[fips]['slug']}.html"
            if len(body.encode()) > MAX_KB * 1024:
                raise SystemExit(f"{rel} would be {len(body.encode()) // 1024} KB, over {MAX_KB} KB")
            want[rel] = body
            urls.append((f"{ORIGIN}/rain/{st_slug}/{C[fips]['slug']}", day))
        if d["counties"]:
            none_rows = []
            for fips, x in sorted(d["none"].items(), key=lambda kv: kv[1]["name"]):
                nf = x.get("near")
                if nf and nf in pages:
                    nn = pages[nf][0] + ("" if C[nf]["st"] == st else ", " + C[nf]["st"])
                    none_rows.append((x["name"], nn, pages[nf][1], bool(x.get("held"))))
                else:
                    none_rows.append((x["name"], None, None, bool(x.get("held"))))
            want[f"rain/{st_slug}.html"] = nav.fill_fonts(state_page(st, d, pages, none_rows))
            urls.insert(0, (f"{ORIGIN}/rain/{st_slug}", day))
    if pages:
        built = max(d["fetched"][:10] for d in files.values())
        want["rain.html"] = hub_page(files, built)
        urls.insert(0, (f"{ORIGIN}/rain", built))
    urls = [urls[0]] + sorted(urls[1:]) if pages else []
    want["sitemap-rain.xml"] = sitemap(urls)
    return want


def owned(root):
    """Files under root this build owns now (to find stale ones)."""
    out = set()
    for p in glob.glob(os.path.join(root, "rain", "**", "*.html"), recursive=True):
        out.add(os.path.relpath(p, root).replace(os.sep, "/"))
    for f in ("rain.html", "sitemap-rain.xml"):
        if os.path.exists(os.path.join(root, f)):
            out.add(f)
    return out


def rain_parent(rel):
    """Where a dropped rain page points: its state page, else the hub."""
    parts = rel.split("/")
    if len(parts) == 3:
        return [(f"/rain/{parts[1]}", PP.label(parts[1])), ("/rain", "Rain")]
    return [("/rain", "Rain")]


def write_or_check(want, root, check):
    bad, wrote = [], 0
    for rel, body in want.items():
        p = os.path.join(root, rel)
        have = open(p, encoding="utf-8").read() if os.path.exists(p) else None
        if have != body:
            if check:
                bad.append(rel)
            else:
                os.makedirs(os.path.dirname(p) or root, exist_ok=True)
                open(p, "w", encoding="utf-8").write(body)
                wrote += 1
    # a county or state page this build no longer writes stays as a pointer to its parent
    # (scripts/pointer_pages.py), never a 404; only the hub and sitemap are owned outright
    gone = sorted(owned(root) - set(want))
    pages = [r for r in gone if r.startswith("rain/")]
    changed, orphans = PP.settle(root, "rain", pages, rain_parent, real=lambda r: r in want, check=check)
    stale = [r for r in gone if r not in pages] + orphans
    if check:
        return bad + changed + stale
    for rel in stale:
        os.remove(os.path.join(root, rel))
    for dd in glob.glob(os.path.join(root, "rain", "*")):
        if os.path.isdir(dd) and not os.listdir(dd):
            os.rmdir(dd)
    return wrote, stale


def selftest():
    import subprocess
    import tempfile
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
    fx = os.path.join(ROOT, "test", "fixtures", "rain")
    # "Last year, by Christmas" reads the Christmas cutoffs from data/rain-print.json; the fixtures are 2026, so the
    # checks below hold 2026's dates (Dec 9 framed, Dec 10 print) whatever next year's file says
    rj = json.load(open(os.path.join(ROOT, "data", "rain-print.json"), encoding="utf-8"))
    ok(rp_cutoffs() == (rj["framed_christmas_cutoff"], rj["print_christmas_cutoff"]), "the cutoffs are read from data/rain-print.json")
    real_cutoffs = globals()["rp_cutoffs"]
    globals()["rp_cutoffs"] = lambda: ("2026-12-09", "2026-12-10")
    ok(xmas_last_by("2026-09-30", 2026, rp_cutoffs()) == "" and xmas_last_by("2026-10-01", 2026, rp_cutoffs()) == "framed by Dec 9, or as a print by Dec 10"
       and xmas_last_by("2026-12-09", 2026, rp_cutoffs()) == "framed by Dec 9, or as a print by Dec 10"
       and xmas_last_by("2026-12-10", 2026, rp_cutoffs()) == "as a print by Dec 10" and xmas_last_by("2026-12-11", 2026, rp_cutoffs()) == ""
       and xmas_last_by("2027-10-12", 2027, rp_cutoffs()) == "" and xmas_last_by("2026-10-12", 2026, None) == "",
       "last year by Christmas: Oct 1 through the later cutoff, each date while it is ahead, nothing for another year's dates")
    with tempfile.TemporaryDirectory() as t:
        data = os.path.join(t, "data")
        for st, ed in (("IA", "2026-10-12"), ("KS", "2026-10-12"), ("DE", "2024-12-31")):
            r = subprocess.run([sys.executable, os.path.join(HERE, "fetch_county_rain.py"), "--fixtures", fx, "--out", data, "--states", st, "--edate", ed],
                               capture_output=True, text=True)
            ok(r.returncode == 0, f"fixture fetch {st}: {r.stdout[-300:]} {r.stderr[-300:]}")
        want = build(data)
        site = os.path.join(t, "site")
        write_or_check(want, site, False)
        ok(write_or_check(build(data), site, True) == [], "a second build matches the first (--check)")
        story = want.get("rain/iowa/story-county.html", "")
        ok(story, "Story County page written")
        ok("rain/iowa/hamilton-county.html" not in want, "no page for a county without a station")
        ok("rain/iowa/boone-county.html" not in want, "no page for a county whose station missed too many days")
        ok("rain/wyoming.html" not in want, "no state page without data")
        for rel, body in want.items():
            if not rel.endswith(".html"):
                continue
            ok("—" not in body and "&mdash;" not in body, f"{rel}: em dash")
            ok(len(body.encode()) <= MAX_KB * 1024, f"{rel}: over {MAX_KB} KB")
            for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', body, re.S):
                try:
                    json.loads(m.group(1))
                except ValueError as x:
                    fails.append(f"{rel}: JSON-LD does not parse ({x})")
            ok(body.count("<title>") == 1 and '<link rel="canonical"' in body, f"{rel}: title and canonical")
            # the site menu's "Today's briefing" link is not the page speaking; check the page's own text
            own = re.sub(r"<!-- static-nav:(header|footer).*?<!-- /static-nav:\1 -->", "", body, flags=re.S)
            ok("today" not in S.text_of(re.sub(r"<script.*?</script>", "", own, flags=re.S)).lower(), f"{rel}: never says today")
        d = json.load(open(os.path.join(data, "ia.json")))
        c = d["counties"]["19169"]
        ok(f"{c['total']:.2f} inches of rain have fallen so far in 2026 at the weather station 8 miles west-southwest of Ames, Story County, through Oct 12." in story,
           "the answer comes first, in plain words")
        ok(f"({c['pct']}% of usual)" in story and ("less than a usual year to date" in story or "more than a usual year to date" in story), "the comparison sentence")
        ok("<title>How Much Rain Has Story County, Iowa, Had in 2026? | AGSIST</title>" in story, "title")
        ok(re.search(r'<meta name="description" content="27\.61 inches of rain in Story County, Iowa, in 2026', story) is not None, "description carries the number")
        ok("/rain-print?place=Ames%2C+IA&amp;year=2026&amp;station=130203+2" in story, "Rain Print link draws that place and year")
        gc = rain_print_href({"station": {"raw": "GARDEN CITY EXP STN", "sid": "142980 2"}}, "KS", 2026)
        ok(gc == "/rain-print?place=Garden+City%2C+KS&year=2026&station=142980+2", f"Rain Print link from an experiment station: {gc}")
        lg = urllib.parse.parse_qs(rain_print_href({"station": {"raw": "SOUTH SAINT FRANCISVILLE HEIGHTS CROSSROADS", "sid": "1 2"}}, "KS", 2026)[12:])["place"][0]
        ok(lg.endswith(", KS") and len(lg) <= 32, f"a long town is shortened, the state kept: {lg!r}")
        # the county's year as a Rain Print, drawn in the browser over the plain chart, and one line under it
        ok('id="rc-print"' in story and 'data-st="ia" data-fips="19169" data-year="2026"' in story and PRINT_JS in story,
           "Story County's days are in the daily file: the page carries the Rain Print placeholder and its script")
        ok(f'data-days="{c["days"]}" data-total="{c["total"]:.2f}"' in story, "the print is checked against the page's own days and total")
        # 2026-10-20 (panel A, Sig's after-main-content rule): the plain chart stays at the top for
        # every reader; the print and its style picker are a hidden shell after the farm content
        pf = story.split('id="rc-print"')[1].split("</figure>")[0]
        ok('class="rc-us"' in story.split('id="rc-print"')[0] and 'class="rc-us"' not in pf and pf.startswith(' data-st="ia"')
           and ' hidden ' in pf.split(">")[0] and 'class="rc-print-styles"' in pf,
           "the plain chart is up top; the print figure, hidden until drawn, carries the style picker")
        # 2026-10-23 promo audit: the print and its offer come up above the method text (it sat
        # five phone screens down, under "Why this station"), still after the answer and the farm numbers
        ok(story.index("<h2>Month by month</h2>") < story.index("so far in Story County</h2>") < story.index('id="rc-print"')
           < story.index('class="rc-sell"') < story.index("<h2>The station") < story.index("<h2>Questions</h2>")
           and story.index('data-signup-ask=') < story.index('id="rc-print"')
           and story.index("<h2>Month by month</h2>") < story.index('class="rc-print-styles"'),
           "the print and its picker come after the farm content (month table, the year so far) and before the station method")
        pr = rp_prices()
        ok(pr and f"This is Story County&rsquo;s 2026 so far, drawn as a Rain Print. Put your name and dates on it: framed ${pr[0]}, print ${pr[1]}." in story,
           "the cross-sell line under the print names the county and the prices from data/rain-print.json")
        # 2026-10-19 rule change: "rain and snow" only where the print draws snow; Story's
        # fixture station keeps no snowfall record, so the line says rain
        # Oct 12, before the Christmas cutoffs: the plain line names no year, and two buttons choose it (2026-10-19, board B)
        ok("Get Story County&rsquo;s rain drawn as a Rain Print" in story and ">Last year, by Christmas</a>" in story
           and ">This year, in January</a>" in story and ">Make yours</a>" not in story, "the plain line and the two buttons, for no JS")
        snowy = [b for r, b in want.items() if r.startswith("rain/") and "Light blue is snow" in b]
        ok(all("rain and snow drawn as a Rain Print" in b for b in snowy)
           and not any("rain and snow drawn as a Rain Print" in b for r, b in want.items() if r.startswith("rain/") and "Light blue is snow" not in b and 'id="rc-print"' in b),
           f"the plain line says rain and snow exactly where the print draws snow ({len(snowy)} pages draw it)")
        ok(story.index('id="rc-print"') < story.index('class="rc-sell"') < story.index("<h2>Questions</h2>")
           and story.split('id="rc-print"')[1].split("</figure>", 1)[1].lstrip().startswith('<div class="rc-sell">'),
           "the line sits right under the print")
        sell_blk = story.split('class="rc-sell"')[1].split("</div>")[0]
        ok("rc-cta" not in story and story.count('href="/rain-print?') == 2 and sell_blk.count('href="/rain-print?') == 2,
           "one Rain Print promo on the page: both year buttons are inside its one block")
        ok('<a class="btn btn-primary" href="/rain-print?place=Ames%2C+IA&amp;year=2025&amp;ll=' in sell_blk
           and '<a class="btn btn-secondary" href="/rain-print?place=Ames%2C+IA&amp;year=2026&amp;station=130203+2' in sell_blk
           and sell_blk.index("year=2025") < sell_blk.index("year=2026"),
           "last year first, with no station (Rain Print picks the nearest good 2025 record) and no style=, so it opens as a hand link")
        ok("Last year&rsquo;s print (2025) comes by Christmas if you order it framed by Dec 9, or as a print by Dec 10. "
           "This year&rsquo;s (2026) is a gift card to put under the tree now, the print in January." in sell_blk,
           "the dates come from data/rain-print.json, and this year's gift card stays")
        ok(f'<p class="rc-fine">{RP_ANY_YEAR}</p>' in sell_blk and story.count('href="/rain-print"') == 1,
           "one plain link to the bare /rain-print, inside the same promo block")
        # the January full-year email (subs worker v5.28): one ask, under the month table, Daily box not pre-ticked
        ok(story.count("data-signup-ask=") == 1 and 'data-topic="rainyear:2026:19169" data-ok=' in story
           and "data-daily" not in story,
           "one rainyear ask for this county and year, morning briefing box not pre-ticked")
        ok(story.index("<h2>Month by month</h2>") < story.index('data-topic="rainyear:') < story.index("<h2>The station"),
           "the ask sits under the month by month table")
        ok("Email me Story County&rsquo;s full 2026 rain total in January." in story and "once NOAA has all of 2026" in story,
           "the ask says what comes and when")
        fin = county_page({"c": dict(c, as_of="2026-12-31"), "st": "IA", "fips": "19169", "year": 2026, "d": dict(d, edate="2026-12-31"),
                           "slug": "story-county", "nbrs": [], "n_ok": 1})
        ok("data-signup-ask" not in fin, "a finished year has no ask (the email is about the year so far)")
        # no daily file for the state: the plain chart, the plain line, no script
        nod = county_page({"c": c, "st": "IA", "fips": "19169", "year": 2026, "d": d, "slug": "story-county", "nbrs": [], "n_ok": 1})
        ok('id="rc-print"' not in nod and "rain-county-print.js" not in nod and "rc-sell-lead" not in nod and ">Last year, by Christmas</a>" in nod,
           "without the county's days: the plain chart and the plain line only")
        ok(f'<p class="rc-fine">{RP_ANY_YEAR}</p>' in nod, "the plain link is there without the county's days too")
        short = county_page({"c": dict(c, days=45), "st": "IA", "fips": "19169", "year": 2026, "d": d, "slug": "story-county", "nbrs": [], "n_ok": 1,
                             "day": {"p": R.pack_days(["0.10"] * 45)}})
        ok('id="rc-print"' not in short, "under 60 days in: no print, as /rain-print draws none")
        # last year with 28 June days missing: the difference is counted on the days both years reported
        c0 = dict(c, total=28.5, days=285, reported=285, missing=0,
                  last={"total": 25.7, "reported": 257, "days": 285, "through": "2025-10-12", "both": 257, "this_both": 25.7, "last_both": 25.7})
        lyh = county_page({"c": c0, "st": "IA", "fips": "19169", "year": 2026, "d": d, "slug": "story-county", "nbrs": [], "n_ok": 1})
        lyw = S.text_of(re.sub(r"<script(?! type=.application/ld).*?</script>", "", lyh, flags=re.S))
        ok(not re.search(r"2\.8 inches|\bahead\b|\bbehind\b", lyw), "last year's gaps are not counted as rain this year had")
        ok("(it missed 28 days)" in lyw and "On the 257 days both years reported, 2026 had about the same as 2025." in lyw, "last year's gaps said, and the comparison on common days")
        ok("the print in January." in story and "Give it for Christmas" not in story, "this year's print before Christmas: the gift card now, the print in January")
        # Dec 10: framed has passed, a print still makes it; Dec 11 on: back to one button and today's words
        d10 = county_page({"c": dict(c, as_of="2026-12-10"), "st": "IA", "fips": "19169", "year": 2026, "d": d, "slug": "story-county", "nbrs": [], "n_ok": 1})
        ok("comes by Christmas if you order it as a print by Dec 10." in d10 and "framed by Dec 9" not in d10, "Dec 10: only the print's date")
        d11 = county_page({"c": dict(c, as_of="2026-12-11"), "st": "IA", "fips": "19169", "year": 2026, "d": d, "slug": "story-county", "nbrs": [], "n_ok": 1})
        ok(">Last year, by Christmas</a>" not in d11 and ">Make yours</a>" in d11 and d11.count('href="/rain-print?') == 1
           and "Give it for Christmas: a gift card to put under the tree now, the 2026 print in January." in d11,
           "past both cutoffs: one button and the gift card line, as before")
        s30 = county_page({"c": dict(c, as_of="2026-09-30"), "st": "IA", "fips": "19169", "year": 2026, "d": d, "slug": "story-county", "nbrs": [], "n_ok": 1})
        ok(">Make yours</a>" in s30 and "by Christmas" not in s30 and "Get Story County&rsquo;s 2026 rain drawn" in s30, "before October: no Christmas offer")
        ok('"@type":"FAQPage"' in story and '"@type":"Dataset"' in story and '"@type":"BreadcrumbList"' in story, "structured data")
        ok("As of Oct 12, 2026" in story, "as-of date shown")
        ok('<svg viewBox' in story and 'class="rc-us"' in story, "chart with the usual line")
        ok("1991 to 2020" in story, "normals period named when ACIS confirmed it")
        ok('href="/rain/iowa/polk-county"' in story or 'href="/rain/iowa/marshall-county"' in story, "next-door links")
        # a neighbor whose station stops earlier says to which day
        dn = os.path.join(t, "nbr")
        os.makedirs(dn)
        ij = json.load(open(os.path.join(data, "ia.json")))
        nf = next(f for f, x in ij["counties"].items() if f != "19169" and f"/rain/iowa/{R.slug(x['name'])}" in story)
        ij["counties"][nf]["as_of"] = "2026-10-02"
        json.dump(ij, open(os.path.join(dn, "ia.json"), "w"))
        sn = build(dn)["rain/iowa/story-county.html"]
        ok(re.search(r'<a class="rc-nb" href="/rain/iowa/' + R.slug(ij["counties"][nf]["name"]) + r'">[^<]* <small>[^<]* to Oct 2</small>', sn) is not None, "next-door chip names an older last day")
        ok(re.search(r"<small>[^<]* to Oct 12</small>", sn) is None, "next-door chip on the same day carries no date")
        sp = build(dn)["rain/iowa.html"]
        ok(re.search(r'<th scope="row"><a href="/rain/iowa/' + R.slug(ij["counties"][nf]["name"]) + r'">[^<]*</a> <span class="rc-n">to Oct 2</span></th>', sp) is not None,
           "state table: a county whose station stops earlier says to which day under its name")
        ok("1 station stops earlier; each county page gives its own last day" in sp, "state lede counts the stations that stop earlier")
        # a state that calls its counties parishes, with a held county
        dl = os.path.join(t, "parish")
        os.makedirs(dl)
        lj = json.load(open(os.path.join(data, "ia.json")))
        lj["state"] = "LA"
        hf = next(iter(lj["none"]))
        lj["none"][hf]["held"] = "SOME GAUGE"
        json.dump(lj, open(os.path.join(dl, "la.json"), "w"))
        wl = build(dl)
        la, lh = wl["rain/louisiana.html"], wl["rain.html"]
        ok(f"{len(lj['counties'])} Louisiana parishes have a weather station inside the parish" in la, "Louisiana: parishes in the lede")
        ok('<th scope="col">Parish</th>' in la and "<h2>Parishes without a page</h2>" in la and re.search(r"Half the (\d+ )?parishes( with a NOAA usual year)? are above", S.text_of(la)), "Louisiana: parish in the table and lists")
        ok(not re.search(r"Louisiana counties|\d+ counties", S.text_of(la) + S.text_of(lh)), "Louisiana is never counted in counties")
        ok("parishes, typical parish" in lh, "hub row counts parishes")
        ok("caught under 40% of what the parishes around it typically caught" in la and "every county around it" not in la, "held footnote fits both holds")
        ok("Parish by Parish | AGSIST</title>" in la and "Parish by parish</h1>" in la and "Every County" not in la and "Each parish page" in la, "state title does not promise every county, and calls them parishes")
        ok("County by County | AGSIST</title>" in want["rain/iowa.html"] and "Every County" not in want["rain/iowa.html"], "state title: county by county")
        ok("3 days not reported" not in story and "1 day not reported" in story, "a month with a gap says so")
        jef = want.get("rain/iowa/greene-county.html", "")
        ok(jef and "this station" not in jef and "at this gauge" in jef and "Why this gauge:" in jef, "a CoCoRaHS page calls it a gauge throughout")
        ok(jef and "read once a day, usually in the morning" in jef, "a CoCoRaHS gauge says when it is read")
        ok("(station ID 130203)" in story and "(station AMES" not in story, "station paragraph gives the ID, not the raw name again")
        ok(re.search(r"It reported (every one of the \d+ days|\d+ of the \d+ days)", story) and ", every one." not in story, "days reported in plain words")
        sw = county_page({"c": dict(c, station=dict(c["station"], raw="Eastern Band of Cherokee Indians", sid="3056 19")), "st": "NC", "fips": "37173",
                          "year": 2026, "d": d, "slug": "swain-county", "nbrs": [], "n_ok": 1})
        sww = S.text_of(re.sub(r"<script.*?</script>", "", sw, flags=re.S))
        swp = sww[sww.find("The numbers come from"):sww.find("Rain here means")]
        ok(swp.count("Eastern Band of Cherokee Indians") == 1 and "station ID 3056" not in sww and "read once a day" not in sww,
           f"a station named for a place that is not a town is named once: {sww[sww.find('The numbers'):sww.find('The numbers') + 160]}")
        cg = county_page({"c": dict(c, station=dict(c["station"], net="cocorahs", sid="US1IAST0001 6")), "st": "IA", "fips": "19169", "year": 2026, "d": d, "slug": "story-county", "nbrs": [], "n_ok": 1})
        ok("daily normals for this gauge, added up over the same" in cg and "started in 1998, so none has 30 years of its own; NOAA estimates the rest from long-record stations nearby." in cg,
           "a CoCoRaHS gauge's normal is said to be NOAA's estimate")
        ok("no gauge has 30 years" not in story, "a co-op station's normal is its own")
        # the pick rule the page states is the one the data file says the fetch used
        for pk, words in ((None, "The pick goes to one with NOAA normals first"), (2, "Mountain snow sites, and stations far above the rest in the county, come last"),
                          (3, "a station that keeps a full record of both rain and snowfall comes next"),
                          (4, "even when only the nearer one has NOAA normals")):
            dp = {k: v for k, v in d.items() if k != "pick"}
            if pk:
                dp["pick"] = pk
            pg = county_page({"c": dict(c, n_ok=3), "st": "IA", "fips": "19169", "year": 2026, "d": dp, "slug": "story-county", "nbrs": [], "n_ok": 3})
            ok(words in pg, f"pick rule {pk}: {words}")
        # more days missing than Rain Print allows: the link drops the station and says why
        m32 = county_page({"c": dict(c, missing=32, reported=c["days"] - 32), "st": "IA", "fips": "19169", "year": 2026, "d": d, "slug": "story-county", "nbrs": [], "n_ok": 1})
        rp32 = re.search(r'href="(/rain-print\?[^"]*)"', m32).group(1)
        ok("station=" not in rp32 and "ll=" in rp32, f"over MISS_BLOCK missing: no station in the Rain Print link ({rp32})")
        ok("This station missed 32 days this year, more than a print can show honestly, so Rain Print draws the nearest station with a fuller record." in m32, "over MISS_BLOCK: the CTA says why")
        ok("station=130203+2&amp;ll=" in story, "the link carries the station and its lat,lon")
        # chart end labels: inside the drawing and apart, on every fixture page and at the edges
        edge = []
        for top in (0.0, 0.3, c["total"] * 0.999, c["total"] * 1.6):
            cum = [list(p) for p in c["cum"]]
            cum[-1][2] = top if top else cum[-1][1]
            edge.append(chart(dict(c, cum=cum, usual=max(c["usual"] or 1, cum[-1][2])), 2026, "x")[0])
        for body in [b for k, b in want.items() if k.count("/") == 2] + edge:
            yl = re.search(r'class="rc-yl" x="[\d.]+" y="([\d.-]+)"', body)
            us = re.search(r'class="rc-lab" x="[\d.]+" y="([\d.-]+)">Usual', body)
            ys = [float(yl.group(1))] + ([float(us.group(1))] if us else [])
            ok(all(14 - 0.05 <= y <= 184 + 0.05 for y in ys), f"chart label inside the drawing: {ys}")
            ok(len(ys) == 1 or abs(ys[0] - ys[1]) >= LABEL_GAP - 0.05, f"chart labels at least {LABEL_GAP} apart: {ys}")
        ok(jef and "no NOAA normal" in jef and "Percent of usual" not in jef and 'class="rc-us"' not in jef, "no normals: no percent, no usual line")
        ok(jef and "the volunteer rain gauge" in jef, "a CoCoRaHS gauge is named as one")
        ok(jef and "Daily precipitation from the volunteer rain gauge " in jef and "from the weather station" not in jef, "the Dataset says a CoCoRaHS gauge is one")
        ok('"description":"Daily precipitation from the weather station AMES 8 WSW' in story, "the Dataset names a weather station as one")
        ok("have a weather station inside" in want.get("rain/iowa.html", "") and ">NOAA station</th>" not in want.get("rain/iowa.html", ""), "state page does not call every gauge NOAA's")
        ok("the NOAA station in" not in want["rain.html"] and "One NOAA station per county" not in want["rain.html"], "hub does not call every gauge NOAA's")
        bad = [k for k, b in want.items() if "CoCoRaHS" in b]
        ok(not bad, f"no page names CoCoRaHS (Sig: weather station, volunteer rain gauge): {bad[:3]}")
        ks = want.get("rain/kansas/riley-county.html", "")
        ok(ks and "1991 to 2020" not in ks and "current 30-year" in ks, "normals period not claimed when ACIS did not confirm it")
        ok(ks and "read the gauge after more than one day" in ks, "accumulated reports explained")
        for mi, words in ((0.4, "less than a mile from the middle"), (1.2, "1 mile from the middle"), (7.6, "8 miles from the middle")):
            pg = county_page({"c": dict(c, station=dict(c["station"], mi=mi)), "st": "IA", "fips": "19169", "year": 2026, "d": d, "slug": "story-county", "nbrs": [], "n_ok": 1})
            ok(words in pg and " 1 miles" not in pg and " 0 miles" not in pg, f"station distance {mi}: {words}")
        dz = dict(c, usual=0.8, pct=None, as_of="2026-10-12")
        ok(compare(dz) == "A usual year here has had less than an inch of rain by now, too little for a fair percent.", f"a desert in October is not early in the year: {compare(dz)}")
        ok("too early" in compare(dict(dz, as_of="2026-02-10")), "February with under an inch usual: too early")
        c1 = dict(c, acc=0, unsplit=3)
        nb = county_page({"c": c1, "st": "IA", "fips": "19169", "year": 2026, "d": d, "slug": "story-county", "nbrs": [], "n_ok": 1})
        ok("On 0 reports" not in nb, "no multi-day reports: no line about them")
        c1 = dict(c, max_day=None, acc=2)
        nb = S.text_of(county_page({"c": c1, "st": "IA", "fips": "19169", "year": 2026, "d": d, "slug": "story-county", "nbrs": [], "n_ok": 1}))
        ok("biggest rain" not in nb and not re.search(r"Biggest single day: *\d", nb) and "Biggest one-day" not in nb, "no biggest day: not claimed anywhere")
        ok("Biggest single day: not known. 2 reports cover more than one day" in nb, "no biggest day: the page says why")
        c1 = dict(c, acc=2)
        nb = S.text_of(county_page({"c": c1, "st": "IA", "fips": "19169", "year": 2026, "d": d, "slug": "story-county", "nbrs": [], "n_ok": 1}))
        ok("the most the gauge caught in one day" not in nb and "Biggest one-day reading" in nb, "with multi-day reports: a one-day reading, not the most in one day")
        de = want.get("rain/delaware/kent-county.html", "")
        ok(de and "How Much Rain Did Kent County, Delaware, Get in 2024?" in de and "fell in 2024" in de, "finished year wording")
        ok(de and "ship in January" not in de and "All of 2024" in de, "finished year: no January note")
        # a station that last reported Dec 29 in a year fetched through Dec 31: the year is over, the page says Dec 29
        dd3 = os.path.join(t, "late")
        os.makedirs(dd3)
        dj = json.load(open(os.path.join(data, "de.json")))
        kf = next(f for f, x in dj["counties"].items() if x["name"] == "Kent County")
        dj["counties"][kf]["as_of"] = "2024-12-29"
        if dj["counties"][kf].get("last"):
            dj["counties"][kf]["last"]["through"] = "2023-12-29"
        json.dump(dj, open(os.path.join(dd3, "de.json"), "w"))
        w3 = build(dd3)
        k3 = S.text_of(re.sub(r"<script(?! type=.application/ld).*?</script>", "", w3["rain/delaware/kent-county.html"]))
        ok("How Much Rain Did Kent County, Delaware, Get in 2024?" in k3 and "ship in January" not in k3, "a lagging station does not reopen a finished year")
        ok("through Dec 29, the last day reported" in k3 and "Jan 1 to Dec 31" not in k3 and "2023, the whole year" not in k3, f"a finished year still says the last day reported")
        hub3 = w3["rain.html"]
        ok("How much rain did your county get in 2024?" in hub3 and "so far" not in S.text_of(hub3), "hub: finished-year wording when every state is done")
        ok("How much rain has your county had this year?" in want["rain.html"], "hub: this-year wording while a year is running")
        stp = want.get("rain/iowa.html", "")
        ok("Hamilton County <small>nearest: <a href=" in stp, "no-station county listed with the nearest that has one")
        ok('href="/rain/iowa/story-county"' in stp, "state page links each county")
        sm = want["sitemap-rain.xml"]
        n_pages = sum(1 for k in want if k.endswith(".html"))
        ok(sm.count("<loc>") == n_pages, f"sitemap lists every page ({sm.count('<loc>')} of {n_pages})")
        ok("https://agsist.com/rain</loc>" in sm and "https://agsist.com/rain/iowa/story-county</loc>" in sm, "sitemap URLs are clean")
        hub = want["rain.html"]
        ok("static-nav:header" in hub, "hub carries the static nav")
        # a county that leaves the data leaves a pointer to its state page, and comes back cleanly
        gp = os.path.join(site, "rain", "iowa", "gone-county.html")
        os.makedirs(os.path.dirname(gp), exist_ok=True)
        open(gp, "w").write("<title>old real page</title>")
        write_or_check(want, site, False)
        g = open(gp).read()
        ok(PP.pointer_target(g) == "/rain/iowa" and "Gone County is now covered on the" in g, "dropped county: pointer to its state page")
        ok("sitemap" not in g and "gone-county" not in want["sitemap-rain.xml"], "pointer stays out of the sitemap")
        ok(write_or_check(want, site, True) == [], "a settled pointer passes --check")
        ok("rain/iowa/gone-county.html" in PP.load(site, "rain"), "pointer in the manifest")
        want2 = dict(want, **{"rain/iowa/gone-county.html": "<title>back</title>"})
        write_or_check(want2, site, False)
        ok(open(gp).read() == "<title>back</title>" and "rain/iowa/gone-county.html" not in PP.load(site, "rain"), "returned county replaces its pointer")
        os.remove(gp)
        # no data at all: an empty sitemap and nothing else
        empty = build(os.path.join(t, "nothing"))
        ok(list(empty) == ["sitemap-rain.xml"] and "<loc>" not in empty["sitemap-rain.xml"], "no data: empty sitemap only")
        write_or_check(empty, site, False)
        ok(not os.path.exists(os.path.join(site, "rain", "iowa", "story-county.html")) and not os.path.exists(os.path.join(site, "rain.html")), "stale pages removed")
        sizes = [len(b.encode()) for k, b in want.items() if k.count("/") == 2]
        print(f"  fixture county pages: {len(sizes)}, largest {max(sizes) / 1024:.1f} KB, mean {sum(sizes) / len(sizes) / 1024:.1f} KB")
    # print_snow, on real days (test/fixtures/rain-snow/days.json, fetched through Oct 13, 2026)
    sf = json.load(open(os.path.join(ROOT, "test", "fixtures", "rain-snow", "days.json")))
    ok(print_snow(sf["vilas_wi"], 2026) == "drawn", "Eagle River WI: Oct 1 to 13 snowfall not in yet is not 13 gaps; 70 in of snow is drawn")
    ok(print_snow(sf["wayne_ia"], 2026) == "drawn", "Allerton IA keeps drawing snow")
    ok(print_snow(sf["story_ia"], 2026) == "gaps", "Ames 1.5 NNE (CoCoRaHS) still has too many snowfall gaps")
    _vp, _vs = R.unpack_days(sf["vilas_wi"]["p"]), R.unpack_days(sf["vilas_wi"]["s"])
    _pad = 365 - len(_vp)
    ok(print_snow({"p": R.pack_days(_vp + ["0.00"] * _pad), "s": R.pack_days(_vs + ["M"] * _pad)}, 2026) == "gaps",
       "a finished year counts every reported day without a snowfall value")
    _mid = _vs[:]
    _mid[100:111] = ["M"] * 11
    ok(print_snow({"p": sf["vilas_wi"]["p"], "s": R.pack_days(_mid)}, 2026) == "gaps", "gaps before the last snowfall value still count")
    # the caption under 0.1 in (2026-10-20, Clinch County GA: every snowfall value 0)
    _z = {"p": R.pack_days(["0.00"] * 280), "s": R.pack_days(["0.0"] * 280)}
    ok(print_snow(_z, 2026) == "little" and snow_caption(_z, "little", 2026) == "nosnow", "all-zero snowfall says no snow fell")
    _t = {"p": _z["p"], "s": R.pack_days(["0.0"] * 40 + ["T"] + ["0.0"] * 239)}
    ok(snow_caption(_t, "little", 2026) == "trace", "a trace is snow that fell: not 'no snow'")
    # a summer trace (June 1 to August 31) is not snow (Sig, 2026-10-20: "skip summer traces")
    _su = {"p": _z["p"], "s": R.pack_days(["0.0"] * 153 + ["T"] + ["0.0"] * 126)}   # day 153 = Jun 3
    ok(snow_caption(_su, "little", 2026) == "nosnow" and print_snow_traces(_su, 2026) == 0, "a June trace: no snow fell, nothing marked")
    ok([R.snow_trace_on("T", 2026, k) for k in (150, 151, 242, 243)] == [True, False, False, True]
       and not R.snow_trace_on("0.0", 2026, 10) and R.snow_trace_on(" T ", 2024, 151) is True and R.snow_trace_on("T", 2024, 152) is False,
       "summer is June 1 to August 31 by the date, leap years too")
    _l = {"p": _z["p"], "s": R.pack_days(["0.0"] * 40 + ["0.05"] + ["0.0"] * 239)}
    ok(snow_caption(_l, "little", 2026) == "little" and snow_caption(sf["vilas_wi"], "drawn", 2026) == "drawn", "a little snow keeps 'under 0.1 in'")
    # a trace of snow is marked on the print (2026-10-20, Sig): the caption says so, from real days
    # (test/fixtures/snow-trace/days.json, copied from data/rain/daily through Oct 18, 2026)
    tf = json.load(open(os.path.join(ROOT, "test", "fixtures", "snow-trace", "days.json")))
    ok(print_snow_traces(tf["limestone_al"], 2026) == 5 and print_snow_traces(tf["grandforks_nd"], 2026) == 35,
       "Belle Mina AL marks 5 trace days, Grand Forks ND 35, not its Jun 3 summer T (the art's count, test/rain-print-snow-trace.test.mjs)")
    ok(print_snow_traces(sf["story_ia"], 2026) == 0, "a snowfall record with gaps marks no trace")
    _al = snow_caption(tf["limestone_al"], print_snow(tf["limestone_al"], 2026), 2026)
    ok(_al == "trace" and snow_trace_words(_al, 5) == "Only traces of snow fell (5 days), too little to measure; each is marked on the print. ",
       "only traces: no longer 'so none is drawn'")
    ok("marked above the line" in snow_trace_words("drawn", 36) and snow_trace_words("drawn", 36).startswith("Light blue is snow. ")
       and "36 days" in snow_trace_words("drawn", 36), "measured snow keeps its words and adds the trace days")
    ok(snow_trace_words("drawn", 0) == "Light blue is snow. " and snow_trace_words("nosnow", 0) == "No snow fell, so none is drawn. "
       and snow_trace_words("gaps", 3) == "Its snowfall record has gaps, so no snow is drawn. " and snow_trace_words("none", 0) is None,
       "no trace, the words as before")
    ok(snow_trace_words("little", 1).endswith("The day with a trace of snow is marked above the line. ")
       and "fell on 1 day," in snow_trace_words("drawn", 1) and "(1 day)" in snow_trace_words("trace", 1), "one day, said as one")
    globals()["rp_cutoffs"] = real_cutoffs
    for f in fails:
        print("FAIL", f)
    print("county rain pages selftest:", "ok" if not fails else f"{len(fails)} failure(s)")
    return 0 if not fails else 1


def main(argv):
    def arg(k):
        return argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else None
    if "--selftest" in argv:
        return selftest()
    data = arg("--data") or os.path.join(ROOT, "data", "rain")
    root = arg("--root") or ROOT
    want = build(data, img_root=root)
    if "--check" in argv:
        bad = write_or_check(want, root, True)
        if bad:
            print("rain pages out of date:", ", ".join(bad[:5]), f"({len(bad)}) ... run python3 scripts/build_county_rain.py")
            return 1
        print(f"{sum(1 for k in want if k.endswith('.html'))} rain pages and sitemap-rain.xml match data/rain")
        return 0
    wrote, stale = write_or_check(want, root, False)
    html = [b for k, b in want.items() if k.startswith("rain/") and k.count("/") == 2]
    tot = sum(len(b.encode()) for k, b in want.items() if k.endswith(".html"))
    print(f"{len(html)} county pages, {sum(1 for k in want if k.startswith('rain/') and k.count('/') == 1)} state pages; "
          f"{tot / 1048576:.1f} MB in all, largest county page {max((len(b.encode()) for b in html), default=0) / 1024:.1f} KB; "
          f"{wrote} written, {len(stale)} stale removed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
