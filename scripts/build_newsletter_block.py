#!/usr/bin/env python3
"""
build_newsletter_block.py: the monthly newsletter block (Nov 2, 2026).

A short, paste-ready block for co-op, Farm Credit and local paper newsletters:
one county's rain for the month just ended, the year to date, and the state's
middle basis for corn and soybeans, with a credit line back to the county rain
page. /newsletter-block (newsletter-block.html, components/newsletter-block.js)
reads the files this writes and turns the lines into plain text, simple HTML
and a 1200 x 630 image. The wording lives here only; the page does not rephrase.

Every number is read from files the site already publishes:

  data/rain/<st>.json      the county rain page's month table (rain_month.month_facts,
                           the same rows and the same floor the monthly rain email uses:
                           under county_rain.MIN_SHARE of the month's days reported,
                           no percent of usual). The year to date gets the same floor.
  data/basis-states.json   the state's middle basis per crop, its futures month, how many
                           elevator bids and companies are behind it, and its date. A crop
                           without a middle (too few bids) is said to be withheld.

Writes data/newsletter/<st>.json (one per state with county rain) and
data/newsletter/index.json (the month and the states). Run after the county
rain build (.github/workflows/rain-monthly.yml).

    python3 scripts/build_newsletter_block.py               build into data/newsletter
    python3 scripts/build_newsletter_block.py --out DIR     build into DIR (tests)
    python3 scripts/build_newsletter_block.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import calendar
import datetime as dt
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import county_rain as R            # noqa: E402  STATES, MONTHS, MIN_SHARE, PCT_MIN_NORMAL, slug
import build_county_rain as BCR    # noqa: E402  inch, where_words, long_date
import rain_month as RM            # noqa: E402  month_facts (the month's floor)
import pricefmt                    # noqa: E402  basis cents, the site's one format

SCHEMA = "agsist-newsletter-block/1"
CROPS = (("corn", "corn"), ("soybeans", "soybean"))
DAILY = "agsist.com/daily"
# Lead decision, Nov 2: the rich HTML and the HTML code link with this tag so a
# paste's visits can be told apart; the plain text and the image show the clean address.
UTM = "utm_source=newsletter&utm_medium=paste"


def tagged(url):
    """https://agsist.com/daily -> https://agsist.com/daily?utm_source=newsletter&utm_medium=paste"""
    return url + ("&" if "?" in url else "?") + UTM


def last_whole_month(edate):
    """(year, month index 0-11) of the last month that has ended by edate (the fetch's end date)."""
    d = dt.date.fromisoformat(edate) + dt.timedelta(days=1)
    return (d.year, d.month - 2) if d.month > 1 else (d.year - 1, 11)


def page_path(st, slug):
    return "agsist.com/rain/%s/%s" % (R.slug(R.STATES[st]), slug)


def short(iso):
    """'Oct 31'"""
    return BCR.short_date(iso)


def month_line(f, name, st):
    """'October rain, Story County, IA: 7.27 in, 264% of usual'"""
    head = "%s rain, %s, %s: %s in" % (RM.span(f), name, st, BCR.inch(f["total"]))
    if f["pct"] is not None:
        head += ", %d%% of usual" % f["pct"]
        if f["reported"] < f["days"]:
            head += " (%d of %d days reported)" % (f["reported"], f["days"])
    elif f["thin"]:
        head += " (%d of %d days reported, too few for a percent of usual)" % (f["reported"], f["days"])
    elif f["usual"] is None:
        head += " (no NOAA normal here to compare with)"
    else:
        head += " (usual %s in, too little for a fair percent)" % BCR.inch(f["usual"])
    return head


def ytd_pct(f):
    """The year to date's percent, under the same floor as the month: withheld under
    MIN_SHARE of the days reported, without a usual, or with under PCT_MIN_NORMAL inches of it."""
    if f["ytd_reported"] < R.MIN_SHARE * f["ytd_days"]:
        return None
    return f["ytd_pct"]


def ytd_line(f):
    """'Year to date, Jan 1 to Oct 31: 53.42 in, 155% of usual'"""
    end = "%s %d" % (R.MONTHS[f["m"]], f["last_day"])
    s = "Year to date, Jan 1 to %s: %s in" % (end, BCR.inch(f["ytd"]))
    p = ytd_pct(f)
    if p is not None:
        return s + ", %d%% of usual" % p
    if f["ytd_reported"] < R.MIN_SHARE * f["ytd_days"]:
        return s + " (%d of %d days reported, too few for a percent of usual)" % (f["ytd_reported"], f["ytd_days"])
    if f["ytd_usual"] is None:
        return s + " (no NOAA normal here to compare with)"
    return s + " (too little usual rain so far for a fair percent)"


def station_line(c, normals):
    """'Measured at the weather station in Clayton (NOAA). Usual: NOAA 1991-2020 normals.'"""
    s = "Measured at %s (%s)." % (BCR.where_words(c), "CoCoRaHS" if c["station"]["net"] == "cocorahs" else "NOAA")
    return s + (" Usual: NOAA %s normals." % normals if normals else "")


def cents(v):
    """Basis ($/bu) without its sign, in cents: 0.375 -> '37½ cents', 0.01 -> '1 cent'."""
    b = pricefmt.basis(round(float(v) * 100, 6))
    if b == "even":
        return b
    n = b[1:-1]
    return "%s %s" % (n, "cent" if n == "1" else "cents")


def basis_lines(st, bs):
    """One line per crop with a state middle, and one line naming the crops without one."""
    s = (bs.get("states") or {}).get(st) or {}
    name = R.STATES[st]
    gen = str(bs.get("generated", ""))[:10]
    day = short(gen) if gen else ""
    lines, missing = [], []
    for key, word in CROPS:
        x = (s.get("crops") or {}).get(key) or {}
        if x.get("median") is None or not x.get("label"):
            missing.append(word)
            continue
        m = x["median"]
        where = "even with" if cents(m) == "even" else "%s %s" % (cents(m), "over" if m > 0 else "under")
        lines.append("%s %s bids, %s: middle basis %s %s futures, %d elevator bids, %d %s." % (
            name, word, day, where, x["label"], x["n"], x["companies"], "company" if x["companies"] == 1 else "companies"))
    if missing:
        lines.append("Too few %s elevator bids for a %s basis middle (%s)." % (name, " or ".join(missing), day))
    return lines, gen


def county_block(st, c, slug, year, m, normals, blines, asof):
    """The block's lines for one county, or None without a row for the month."""
    f = RM.month_facts(c, year, m)
    if f is None:
        return None
    return {
        "name": c["name"],
        "head": month_line(f, c["name"], st),
        "ytd": ytd_line(f),
        "stn": station_line(c, normals),
        "src": "Source: AGSIST, %s, data as of %s." % (page_path(st, slug), BCR.long_date(asof)),
        "url": "https://" + page_path(st, slug),
        # the numbers the lines say, for the tests and the image
        "n": {"total": f["total"], "pct": f["pct"], "reported": f["reported"], "days": f["days"],
              "ytd": f["ytd"], "ytd_pct": ytd_pct(f), "through": "%d-%02d-%02d" % (year, m + 1, f["last_day"])},
    }


def build_state(d, bs, C):
    """{st file} for one state's rain file, or None when the month just ended is not in it."""
    st = d["state"]
    year, m = last_whole_month(d["edate"])
    if year != d["year"]:
        return None
    blines, gen = basis_lines(st, bs)
    asof = max(d["fetched"][:10], gen) if gen else d["fetched"][:10]
    out = {}
    for fips, c in sorted(d["counties"].items()):
        if fips not in C:
            continue
        b = county_block(st, c, C[fips]["slug"], year, m, d.get("normals"), blines, asof)
        if b:
            out[fips] = b
    if not out:
        return None
    return {"schema": SCHEMA, "state": st, "name": R.STATES[st], "year": year, "month": m + 1,
            "month_name": R.MONTHS_LONG[m], "rain_fetched": d["fetched"], "basis_generated": bs.get("generated"),
            "asof": asof, "basis": blines, "daily": DAILY, "utm": UTM, "counties": out}


def build(repo=REPO, C=None):
    """{relative path: dict} for every file this writes."""
    C = C or R.counties()
    bs = json.load(open(os.path.join(repo, "data", "basis-states.json"), encoding="utf-8"))
    files, idx = {}, {}
    rd = os.path.join(repo, "data", "rain")
    for fn in sorted(os.listdir(rd)):
        if not fn.endswith(".json") or len(fn) != 7:
            continue
        d = json.load(open(os.path.join(rd, fn), encoding="utf-8"))
        if d.get("state") not in R.STATES or not d.get("counties"):
            continue
        s = build_state(d, bs, C)
        if s:
            files["data/newsletter/%s.json" % s["state"].lower()] = s
            idx[s["state"]] = {"name": s["name"], "fp": next(iter(s["counties"]))[:2], "year": s["year"], "month": s["month"], "counties": len(s["counties"])}
    files["data/newsletter/index.json"] = {"schema": SCHEMA, "states": dict(sorted(idx.items(), key=lambda kv: kv[1]["name"]))}
    return files


def write(files, out):
    for rel, obj in files.items():
        p = os.path.join(out, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"), sort_keys=False)
            fh.write("\n")


def all_text(sfile):
    """Every line a state file can put in a block (for the copy checks)."""
    out = list(sfile["basis"]) + ["Get this every morning: " + sfile["daily"]]
    for b in sfile["counties"].values():
        out += [b["head"], b["ytd"], b["stn"], b["src"]]
    return out


# ---------------------------------------------------------------- selftest
def selftest():
    fails = []

    def ok(cond, name, detail=""):
        print(("ok   " if cond else "FAIL ") + name + (("  " + str(detail)) if detail and not cond else ""))
        if not cond:
            fails.append(name)

    ok(last_whole_month("2026-11-01") == (2026, 9) and last_whole_month("2026-10-31") == (2026, 9)
       and last_whole_month("2026-10-30") == (2026, 8) and last_whole_month("2027-01-01") == (2026, 11),
       "the month just ended, from the fetch's end date")
    ok(cents(-0.4) == "40 cents" and cents(0.375) == "37½ cents" and cents(-0.01) == "1 cent" and cents(0) == "even",
       "basis in cents, the site's quarter-cent format")
    # the real Barbour County AL October 2026 (21 of 31 days): no month percent
    bfx = json.load(open(REPO / "test" / "fixtures" / "rain-month" / "01005-2026.json", encoding="utf-8"))
    bc = bfx["county"]
    b = county_block("AL", bc, "barbour-county", 2026, 9, "1991-2020", [], "2026-11-02")
    ok(b["head"] == "October rain, Barbour County, AL: 12.18 in (21 of 31 days reported, too few for a percent of usual)",
       "Barbour Oct 2026: the inches, the days, no percent", b["head"])
    ok("%" not in b["head"] and b["n"]["pct"] is None, "no percent anywhere in the Barbour month line")
    ok(b["src"] == "Source: AGSIST, agsist.com/rain/alabama/barbour-county, data as of Nov 2, 2026.", "credit line", b["src"])
    ok(b["stn"] == "Measured at the weather station in Clayton (NOAA). Usual: NOAA 1991-2020 normals.",
       "station in plain words", b["stn"])
    # a full month, made up
    stn = {"name": "Ames", "net": "noaa", "raw": "AMES 8 WSW", "sid": "130200 2"}
    c = {"name": "Story County", "station": stn, "months": [[1.0, 1.0, 31, 31]] * 9 + [[7.27, 2.75, 31, 31]]}
    s = county_block("IA", c, "story-county", 2026, 9, "1991-2020", [], "2026-11-02")
    ok(s["head"] == "October rain, Story County, IA: 7.27 in, 264% of usual", "a full month", s["head"])
    ok(s["ytd"] == "Year to date, Jan 1 to Oct 31: 16.27 in, 138% of usual", "year to date", s["ytd"])
    ok(s["stn"].startswith("Measured at the weather station 8 miles west-southwest of Ames"), "station place words", s["stn"])
    cc = dict(c, station=dict(stn, net="cocorahs"))
    ok("volunteer rain gauge" in county_block("IA", cc, "story-county", 2026, 9, "1991-2020", [], "2026-11-02")["stn"],
       "a CoCoRaHS gauge is a volunteer rain gauge")
    # year to date under the floor: no percent there either
    thin = dict(c, months=[[1.0, 1.0, 20, 31]] * 9 + [[7.27, 2.75, 31, 31]])
    t = county_block("IA", thin, "story-county", 2026, 9, None, [], "2026-11-02")
    ok("%" not in t["ytd"] and "too few for a percent" in t["ytd"] and t["n"]["ytd_pct"] is None, "thin year: no year percent", t["ytd"])
    ok(county_block("IA", c, "story-county", 2026, 10, None, [], "2026-11-02") is None, "no row for the month: no block")
    # basis
    bs = {"generated": "2026-11-02T21:06:48Z", "states": {
        "IA": {"crops": {"corn": {"label": "Dec '26", "n": 351, "companies": 52, "median": -0.4},
                         "soybeans": {"label": "Jan '27", "n": 235, "companies": 30, "median": -0.77}}},
        "AL": {"crops": {"soybeans": {"label": "Jan '27", "n": 1, "companies": 1}}},
        "CO": {"crops": {"corn": {"label": "Dec '26", "n": 25, "companies": 5, "median": 0.2}}}}}
    ia, g = basis_lines("IA", bs)
    ok(ia == ["Iowa corn bids, Nov 2: middle basis 40 cents under Dec '26 futures, 351 elevator bids, 52 companies.",
              "Iowa soybean bids, Nov 2: middle basis 77 cents under Jan '27 futures, 235 elevator bids, 30 companies."] and g == "2026-11-02",
       "Iowa corn and soybeans", ia)
    al, _ = basis_lines("AL", bs)
    ok(al == ["Too few Alabama elevator bids for a corn or soybean basis middle (Nov 2)."], "Alabama: withheld, said so", al)
    co, _ = basis_lines("CO", bs)
    ok(co[0].startswith("Colorado corn bids, Nov 2: middle basis 20 cents over Dec '26") and co[1].startswith("Too few Colorado elevator bids for a soybean"),
       "one crop shown, the other withheld", co)
    ok(tagged("https://agsist.com/daily") == "https://agsist.com/daily?utm_source=newsletter&utm_medium=paste"
       and "utm_" not in b["src"] and "utm_" not in b["url"], "the tag is for links only; the words stay clean")
    words = [b["head"], b["ytd"], b["stn"], b["src"], s["head"], s["ytd"]] + ia + al + co
    ok(not any(ch in w for w in words for ch in "—–"), "no em or en dashes")
    print("OK: %d failure(s)" % len(fails))
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    out = str(REPO)
    if "--out" in argv:
        out = argv[argv.index("--out") + 1]
    files = build()
    write(files, out)
    idx = files["data/newsletter/index.json"]["states"]
    print("newsletter block: %d states, %d counties" % (len(idx), sum(v["counties"] for v in idx.values())))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
