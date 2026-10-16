#!/usr/bin/env python3
"""
AGSIST -- data/hay/hay-prices.json: hay prices by state for /hay-prices.

Source: USDA NASS Quick Stats (the monthly Agricultural Prices report), prices
received by farmers for baled hay, $ per ton, monthly, by state and for the US:
  * HAY - PRICE RECEIVED, MEASURED IN $ / TON                (all hay)
  * HAY, ALFALFA - PRICE RECEIVED, MEASURED IN $ / TON       (alfalfa)
  * HAY, (EXCL ALFALFA) - PRICE RECEIVED, MEASURED IN $ / TON (other hay)
Needs env NASS_API_KEY. Stdlib only.

Modes:
  (default)   fetch, validate, write data/hay/hay-prices.json and stamp the
              latest numbers into hay-prices.html. On any failed check it
              writes NOTHING and exits 1, so the last good file stays up.
  --probe     fetch, save a trimmed copy of every row NASS returned plus a
              summary (series names, units, row counts, latest month) to
              data/hay-raw/, print what would parse. Writes no feed.
  --selftest  offline tests, non-zero exit on any failure.
  --stamp     re-stamp hay-prices.html from the data file on disk (no fetch).

WHAT THIS FILE WILL NOT DO
  * Write a number whose unit is not $ / TON, or one outside 20 to 800 $/ton.
  * Write when all hay or alfalfa has no US figure for the newest month, or
    fewer than MIN_STATES states with a figure.
  * Write when two rows disagree for the same series, state and month.
  * Replace a newer month with an older one.
  * Turn a withheld cell into a number or a zero. NASS flags stay as flags:
    "D" (withheld to avoid disclosing a single operation), "S" (too few
    reports), "NA" (not available), "X", "Z". A state NASS does not publish
    for a month is null.

The probe is the first run. Its summary must show the three series names
above, unit "$ / TON" and freq MONTHLY before a default run is trusted.
"""
import datetime
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = "data/hay/hay-prices.json"
RAW_DIR = "data/hay-raw"
PAGE = "hay-prices.html"
API = "https://quickstats.nass.usda.gov/api/api_GET/"
PARAMS_API = "https://quickstats.nass.usda.gov/api/get_param_values/"
UA = "AGSIST/1.0 (+https://agsist.com)"

SERIES = {
    "alfalfa": {"label": "Alfalfa hay", "short": "HAY, ALFALFA - PRICE RECEIVED, MEASURED IN $ / TON", "required": True},
    "other":   {"label": "Other hay",   "short": "HAY, (EXCL ALFALFA) - PRICE RECEIVED, MEASURED IN $ / TON", "required": False},
    "all":     {"label": "All hay",     "short": "HAY - PRICE RECEIVED, MEASURED IN $ / TON", "required": True},
}
UNIT = "$ / TON"
RANGE = (20.0, 800.0)          # $/ton; anything outside is a unit or parse problem
MIN_STATES = 8                  # states with a figure in the newest month
MONTHS_BACK = 36                # newest month plus 36 before it (3 years, same month each year)
US_JUMP = 0.40                  # US price moving more than 40% in a month: refuse
FLAGS = {"(D)": "D", "(S)": "S", "(NA)": "NA", "(X)": "X", "(Z)": "Z", "(H)": "H", "(L)": "L"}
MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]
ABBR = {"AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
        "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
        "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
        "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
        "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
        "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
        "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
        "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
        "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
        "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming"}


class Refuse(Exception):
    """A check failed: write nothing."""


# ---------------------------------------------------------------- parsing
def parse_value(v):
    """NASS Value -> float, a flag string ("D", "S", ...), or None for junk."""
    s = str(v if v is not None else "").strip().replace(",", "")
    if not s:
        return None
    if s.startswith("("):
        return FLAGS.get(s.upper(), s.strip("()").upper() or None)
    try:
        return float(s)
    except ValueError:
        return None


def month_key(row):
    """'YYYY-MM' for a monthly row, else None (marketing year, annual, etc.)."""
    per = str(row.get("reference_period_desc", "")).strip().upper()
    yr = str(row.get("year", "")).strip()
    if per not in MON or not yr.isdigit():
        return None
    return "%s-%02d" % (yr, MON.index(per) + 1)


def shift(mk, n):
    y, m = int(mk[:4]), int(mk[5:])
    t = y * 12 + (m - 1) + n
    return "%d-%02d" % (t // 12, t % 12 + 1)


def month_label(mk):
    return "%s %s" % (MONTH_NAMES[int(mk[5:]) - 1], mk[:4])


def series_of(row):
    sd = str(row.get("short_desc", "")).strip().upper()
    for k, spec in SERIES.items():
        if sd == spec["short"]:
            return k
    return None


def collect(rows):
    """Rows -> ({series: {who: {month: value}}}, {month: max load date}).
    who is "US" or a two-letter state. Raises Refuse on a unit problem, an
    out-of-range number or two rows that disagree."""
    pts, loads = {}, {}
    for r in rows or []:
        k = series_of(r)
        if not k:
            continue
        if str(r.get("freq_desc", "MONTHLY")).upper() != "MONTHLY":
            continue
        mk = month_key(r)
        if not mk:
            continue
        unit = str(r.get("unit_desc", "")).strip().upper()
        if unit != UNIT:
            raise Refuse("unit %r on %s, expected %r" % (unit, SERIES[k]["short"], UNIT))
        agg = str(r.get("agg_level_desc", "")).upper()
        if agg == "NATIONAL":
            who = "US"
        elif agg == "STATE":
            who = str(r.get("state_alpha", "")).strip().upper()
            if who not in ABBR:
                continue            # "OTHER STATES" and the like are not a state
        else:
            continue
        val = parse_value(r.get("Value"))
        if val is None:
            continue
        if isinstance(val, float):
            if not (RANGE[0] <= val <= RANGE[1]):
                raise Refuse("%s %s %s = %s $/ton is outside %s" % (k, who, mk, val, RANGE))
            val = round(val, 2)
            if val == int(val):
                val = int(val)
        cell = pts.setdefault(k, {}).setdefault(who, {})
        if mk in cell and cell[mk] != val:
            raise Refuse("two rows disagree: %s %s %s = %r and %r" % (k, who, mk, cell[mk], val))
        cell[mk] = val
        lt = str(r.get("load_time", "")).strip()[:10]
        if re.match(r"^\d{4}-\d{2}-\d{2}$", lt):
            loads[mk] = max(loads.get(mk, ""), lt)
    return pts, loads


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def build(rows, today=None, prev=None):
    """Rows -> the payload, or raise Refuse. `prev` is the file on disk."""
    today = today or datetime.date.today()
    pts, loads = collect(rows)
    for k, spec in SERIES.items():
        if spec["required"] and k not in pts:
            raise Refuse("no rows for %s (%s)" % (k, spec["short"]))
    us_months = [mk for k in ("alfalfa", "all") for mk, v in pts[k].get("US", {}).items() if is_num(v)]
    if not us_months:
        raise Refuse("no US figure for alfalfa or all hay")
    latest = max(us_months)
    if latest > "%d-%02d" % (today.year, today.month):
        raise Refuse("newest month %s is in the future" % latest)
    if prev and str(prev.get("latest", "")) > latest:
        raise Refuse("newest month %s is older than the file on disk (%s)" % (latest, prev["latest"]))
    months = [shift(latest, -i) for i in range(MONTHS_BACK, -1, -1)]
    status, series = {}, {}
    for k, spec in SERIES.items():
        data = pts.get(k, {})
        us = data.get("US", {})
        problem = None
        if not is_num(us.get(latest)):
            problem = "no US figure for %s" % month_label(latest)
        n_states = sum(1 for who, c in data.items() if who != "US" and is_num(c.get(latest)))
        if not problem and n_states < MIN_STATES:
            problem = "only %d states with a figure for %s (need %d)" % (n_states, month_label(latest), MIN_STATES)
        if not problem:
            p = us.get(shift(latest, -1))
            if is_num(p) and abs(us[latest] - p) / p > US_JUMP:
                problem = "US price moved from %s to %s in one month" % (p, us[latest])
        if problem:
            if spec["required"]:
                raise Refuse("%s: %s" % (k, problem))
            status[k] = "left out: " + problem
            continue
        states = {}
        for who in sorted(data, key=lambda w: ABBR.get(w, w)):
            if who == "US":
                continue
            v = [data[who].get(mk) for mk in months]
            if any(x is not None for x in v):
                states[who] = v
        series[k] = {"label": spec["label"], "short_desc": spec["short"],
                     "us": [us.get(mk) for mk in months], "states": states,
                     "n_states": n_states}
        status[k] = "ok"
    released = loads.get(latest)
    if not released:
        raise Refuse("no load_time on the %s rows, cannot say when NASS released it" % latest)
    if released < latest + "-01":
        raise Refuse("load date %s is before the month it is for (%s)" % (released, latest))
    return {
        "about": ("Prices received by farmers for baled hay, $ per ton, from USDA NASS Agricultural "
                  "Prices via Quick Stats. Newest month first published at 'released'; NASS revises "
                  "it in the next report. Cells: number, null (not published for that state and "
                  "month), or a NASS flag: D withheld to avoid disclosing a single operation, "
                  "S too few reports, NA not available."),
        "source": "USDA NASS Quick Stats, Agricultural Prices",
        "source_url": "https://quickstats.nass.usda.gov/",
        "report_url": "https://usda.library.cornell.edu/concern/publications/c821gj76b",
        "unit": "$/ton",
        "latest": latest,
        "latest_label": month_label(latest),
        "released": released,
        "released_prev": loads.get(shift(latest, -1)),
        "months": months,
        "names": {w: ABBR[w] for k in series for w in series[k]["states"]},
        "series": series,
        "status": status,
        "updated_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


# ---------------------------------------------------------------- stamping
STAMP_RE = re.compile(r"(<!--HAY:STATIC-->)(.*?)(<!--/HAY:STATIC-->)", re.S)


def money(v):
    return "$%s" % format(int(round(v)), ",")


def fmt_date(iso):
    d = datetime.date.fromisoformat(iso)
    return "%s %d, %d" % (MONTH_NAMES[d.month - 1][:3], d.day, d.year)


FLAG_TEXT = {"D": "withheld by USDA", "S": "too few reports", "NA": "not available"}


def cell_html(v):
    if is_num(v):
        return money(v)
    if isinstance(v, str):
        return '<span class="hp-flag">%s</span>' % FLAG_TEXT.get(v, "not published")
    return '<span class="hp-flag">not published</span>'


def static_html(d):
    """The no-script, crawlable block: the answer and the alfalfa table for
    the newest month. The page script replaces it with the live view."""
    if not d:
        return ('\n<p class="hp-empty"><b>Prices load after the first USDA read.</b> '
                'This page fills in from USDA NASS once the monthly hay prices are pulled. '
                'Nothing is shown until then.</p>\n')
    lm, ya = d["latest"], shift(d["latest"], -12)
    i, j = d["months"].index(lm), d["months"].index(ya)
    lines = []
    al, ot = d["series"].get("alfalfa"), d["series"].get("other")
    s = "In %s, farmers got %s a ton for alfalfa hay on average across the US" % (d["latest_label"], money(al["us"][i]))
    if is_num(al["us"][j]):
        s += " (%s a year earlier)" % money(al["us"][j])
    if ot and is_num(ot["us"][i]):
        s += " and %s for other hay" % money(ot["us"][i])
    s += ". USDA NASS released these %s." % fmt_date(d["released"])
    lines.append('<p class="hp-static-lede">%s</p>' % html.escape(s, quote=False))
    rows = []
    for who, v in al["states"].items():
        rows.append('<tr><th scope="row">%s</th><td>%s</td><td>%s</td></tr>'
                    % (html.escape(d["names"][who]), cell_html(v[i]), cell_html(v[j])))
    lines.append('<table class="hp-t"><caption>Alfalfa hay, $ per ton, by state</caption>'
                 '<thead><tr><th scope="col">State</th><th scope="col">%s</th><th scope="col">%s</th></tr></thead>'
                 '<tbody><tr class="hp-us"><th scope="row">United States</th><td>%s</td><td>%s</td></tr>%s</tbody></table>'
                 % (html.escape(month_label(lm)), html.escape(month_label(ya)),
                    cell_html(al["us"][i]), cell_html(al["us"][j]), "".join(rows)))
    return "\n" + "\n".join(lines) + "\n"


def stamp(page_text, d):
    if not STAMP_RE.search(page_text):
        raise Refuse("no <!--HAY:STATIC--> markers in %s" % PAGE)
    body = static_html(d)
    return STAMP_RE.sub(lambda m: m.group(1) + body + m.group(3), page_text, count=1)


# ---------------------------------------------------------------- fetching
def get_json(url, tries=4, opener=None, sleep=time.sleep):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    opener = opener or urllib.request.urlopen
    last = None
    for i in range(tries):
        try:
            with opener(req, timeout=120) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:300]
            if e.code == 400 and "no data" in body.lower():
                return {"data": []}
            last = "HTTP %s: %s" % (e.code, body)
        except Exception as e:  # noqa: BLE001 network/json -> retry
            last = "%s: %s" % (type(e).__name__, e)
        if i < tries - 1:
            sleep(3 * (i + 1))
    raise Refuse("NASS request failed: %s" % last)


def query_url(key, agg, year_ge):
    return API + "?" + urllib.parse.urlencode({
        "key": key, "source_desc": "SURVEY", "commodity_desc": "HAY",
        "statisticcat_desc": "PRICE RECEIVED", "freq_desc": "MONTHLY",
        "agg_level_desc": agg, "year__GE": str(year_ge), "format": "JSON"})


def fetch_rows(key, today=None):
    today = today or datetime.date.today()
    year_ge = today.year - 4      # 36 months back from a newest month that may be last year's
    rows = []
    for agg in ("NATIONAL", "STATE"):
        doc = get_json(query_url(key, agg, year_ge))
        if doc.get("error"):
            raise Refuse("NASS error for %s: %s" % (agg, doc["error"]))
        rows += doc.get("data", [])
    return rows


KEEP = ("short_desc", "agg_level_desc", "state_alpha", "year", "reference_period_desc",
        "freq_desc", "unit_desc", "Value", "load_time", "class_desc")


def probe(key):
    out = ROOT / RAW_DIR
    out.mkdir(parents=True, exist_ok=True)
    rows = fetch_rows(key)
    trimmed = [{k: r.get(k) for k in KEEP} for r in rows]
    (out / "rows.json").write_text(json.dumps(trimmed, separators=(",", ":")) + "\n")
    summ = {"fetched_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "rows": len(rows), "short_desc": {}, "unit_desc": {}, "freq_desc": {}, "flags": {}}
    for r in rows:
        for f in ("short_desc", "unit_desc", "freq_desc"):
            v = str(r.get(f))
            summ[f][v] = summ[f].get(v, 0) + 1
        pv = parse_value(r.get("Value"))
        if isinstance(pv, str):
            summ["flags"][pv] = summ["flags"].get(pv, 0) + 1
    try:
        pv = get_json(PARAMS_API + "?" + urllib.parse.urlencode(
            {"key": key, "param": "short_desc", "commodity_desc": "HAY", "statisticcat_desc": "PRICE RECEIVED"}))
        summ["all_hay_price_short_descs"] = pv.get("short_desc", pv)
    except Refuse as e:
        summ["all_hay_price_short_descs"] = "failed: %s" % e
    try:
        d = build(rows)
        summ["would_write"] = {"latest": d["latest"], "released": d["released"], "status": d["status"],
                               "n_states": {k: v["n_states"] for k, v in d["series"].items()},
                               "us_latest": {k: v["us"][-1] for k, v in d["series"].items()}}
    except Refuse as e:
        summ["would_write"] = "REFUSED: %s" % e
    (out / "summary.json").write_text(json.dumps(summ, indent=1) + "\n")
    print(json.dumps(summ, indent=1))


def run(key):
    prev = None
    p = ROOT / OUT
    if p.exists():
        try:
            prev = json.loads(p.read_text())
        except ValueError:
            prev = None
    d = build(fetch_rows(key), prev=prev)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(d, separators=(",", ":")) + "\n")
    page = ROOT / PAGE
    page.write_text(stamp(page.read_text(), d))
    print("wrote %s: %s, released %s, %s" % (OUT, d["latest"], d["released"], d["status"]))


# ---------------------------------------------------------------- selftest
def _row(series, who, mk, val, load="2026-09-30 15:00:00.000", unit=UNIT, agg=None):
    y, m = mk.split("-")
    return {"short_desc": SERIES[series]["short"], "agg_level_desc": agg or ("NATIONAL" if who == "US" else "STATE"),
            "state_alpha": "" if who == "US" else who, "year": int(y), "reference_period_desc": MON[int(m) - 1],
            "freq_desc": "MONTHLY", "unit_desc": unit, "Value": val, "load_time": load}


def _fixture(latest="2026-09", n_states=10, other=True):
    rows, sts = [], list(ABBR)[:n_states]
    for i in range(MONTHS_BACK + 1):
        mk = shift(latest, -i)
        load = shift(mk, 0) + "-28 15:00:00.000"
        for k, base in (("alfalfa", 200), ("other", 140), ("all", 170)):
            if k == "other" and not other:
                continue
            rows.append(_row(k, "US", mk, str(base + i), load))
            for j, st in enumerate(sts):
                rows.append(_row(k, st, mk, "%d" % (base + j * 5 + i), load))
    return rows


def selftest():
    fails = []

    def ok(cond, msg):
        if not cond:
            fails.append(msg)

    def refused(fn, needle):
        try:
            fn()
        except Refuse as e:
            return needle in str(e)
        return False

    T = datetime.date(2026, 10, 16)
    ok(parse_value(" (D)") == "D", "(D) is the withheld flag")
    ok(parse_value("1,234.5") == 1234.5, "commas")
    ok(parse_value("(NA)") == "NA" and parse_value("") is None, "NA and blank")
    ok(month_key({"reference_period_desc": "MARKETING YEAR", "year": 2025}) is None, "marketing year is not a month")
    ok(month_key({"reference_period_desc": "SEP", "year": 2026}) == "2026-09", "month key")
    ok(shift("2026-01", -1) == "2025-12" and shift("2026-09", -36) == "2023-09", "shift")

    d = build(_fixture(), today=T)
    ok(d["latest"] == "2026-09" and d["latest_label"] == "September 2026", "latest month")
    ok(len(d["months"]) == 37 and d["months"][0] == "2023-09", "37 months")
    ok(d["series"]["alfalfa"]["us"][-1] == 200 and d["series"]["alfalfa"]["us"][-13] == 212, "US alfalfa now and a year ago")
    ok(d["released"] == "2026-09-28", "released = load date of the newest month")
    ok(d["series"]["alfalfa"]["n_states"] == 10, "state count")
    ok(set(d["status"].values()) == {"ok"}, "all ok")

    rows = _fixture()
    rows.append(_row("alfalfa", "OT", "2026-09", "999"))      # Other States row: skipped, not a state
    rows.append(dict(_row("alfalfa", "US", "2026-09", "201"), reference_period_desc="MARKETING YEAR"))
    ok(build(rows, today=T)["series"]["alfalfa"]["us"][-1] == 200, "non-state and non-month rows ignored")

    rows = _fixture()
    rows = [r for r in rows if not (r["state_alpha"] == "AZ" and r["year"] == 2026 and r["reference_period_desc"] == "SEP"
                                    and r["short_desc"] == SERIES["alfalfa"]["short"])]
    rows.append(_row("alfalfa", "AZ", "2026-09", "(D)"))
    d = build(rows, today=T)
    ok(d["series"]["alfalfa"]["states"]["AZ"][-1] == "D", "withheld stays a flag")
    ok("withheld by USDA" in static_html(d), "withheld cell says so")

    ok(refused(lambda: build([dict(r, unit_desc="$ / CWT") for r in _fixture()], today=T), "unit"), "wrong unit refused")
    ok(refused(lambda: build(_fixture() + [_row("all", "IA", "2026-09", "4500")], today=T), "outside"), "out of range refused")
    ok(refused(lambda: build(_fixture() + [_row("alfalfa", "AL", "2026-09", "201")], today=T), "disagree"), "conflicting rows refused")
    ok(refused(lambda: build(_fixture(n_states=5), today=T), "only 5 states"), "too few states refused")
    ok(refused(lambda: build(_fixture(latest="2026-11"), today=T), "future"), "future month refused")
    ok(refused(lambda: build(_fixture(), today=T, prev={"latest": "2026-10"}), "older"), "going backwards refused")
    ok(refused(lambda: build([r for r in _fixture() if r["short_desc"] != SERIES["all"]["short"]], today=T), "no rows for all"),
       "missing all hay refused")
    jump = [r for r in _fixture() if not (r["state_alpha"] == "" and r["year"] == 2026 and r["reference_period_desc"] == "SEP"
                                          and r["short_desc"] == SERIES["alfalfa"]["short"])]
    jump.append(_row("alfalfa", "US", "2026-09", "420"))
    ok(refused(lambda: build(jump, today=T), "moved"), "US jump refused")
    early = [dict(r, load_time="2026-08-30 15:00:00.000") for r in _fixture()]
    ok(refused(lambda: build(early, today=T), "before the month"), "load date before month refused")

    d = build(_fixture(other=False), today=T)
    ok("other" not in d["series"] and d["status"]["other"].startswith("left out"), "optional series dropped with reason")

    d = build(_fixture(), today=T)
    page = "<p>x</p><!--HAY:STATIC-->old<!--/HAY:STATIC--><p>y</p>"
    out = stamp(page, d)
    ok("$200 a ton for alfalfa hay" in out and "($212 a year earlier)" in out, "stamped lede")
    ok("released these Sep 28, 2026" in out, "stamped release date")
    ok(stamp(out, d) == out, "stamp is idempotent")
    ok("Prices load after the first USDA read" in stamp(page, None), "empty state")
    ok("—" not in out and "—" not in static_html(None), "no em dashes")
    ok(refused(lambda: stamp("<p>no markers</p>", d), "markers"), "missing markers refused")

    class FakeHTTP:
        def __init__(self, body):
            self.body = body

        def __call__(self, req, timeout=0):
            raise urllib.error.HTTPError(req.full_url, 400, "Bad", {}, __import__("io").BytesIO(self.body))
    ok(get_json("http://x", opener=FakeHTTP(b'{"error":["no data"]}'), sleep=lambda s: 0) == {"data": []}, "400 no data is empty")
    ok(refused(lambda: get_json("http://x", tries=2, opener=FakeHTTP(b"boom"), sleep=lambda s: 0), "HTTP 400"), "other 400 refused")

    if fails:
        print("FAIL:\n  " + "\n  ".join(fails))
        sys.exit(1)
    print("all hay price checks pass")


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--stamp" in argv:
        p = ROOT / OUT
        d = json.loads(p.read_text()) if p.exists() else None
        page = ROOT / PAGE
        page.write_text(stamp(page.read_text(), d))
        return None
    key = os.environ.get("NASS_API_KEY", "").strip()
    if not key:
        print("NASS_API_KEY is not set", file=sys.stderr)
        sys.exit(1)
    try:
        if "--probe" in argv:
            probe(key)
        else:
            run(key)
    except Refuse as e:
        print("REFUSED, nothing written: %s" % e, file=sys.stderr)
        print("::error::hay prices refused: %s" % e)
        sys.exit(1)
    return None


if __name__ == "__main__":
    main(sys.argv[1:])
