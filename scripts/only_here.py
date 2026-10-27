#!/usr/bin/env python3
"""
only_here.py -- "Only here" in the Daily (Sig, Oct 22 2026): one or two
findings only AGSIST can make, from our own data, each with its number and its
sample, never the workings. Not a raw count of elevators (Sig, Oct 22: "1,749
of 1,810 elevators cut bids" is not an insight); a comparison against history.

  basis_line   basis against its own history, for the reader's state (from the
               ZIP) or, with no ZIP, the farm state whose basis sits furthest
               from its own record. From data/basis-sparklines/<ST>.json: the
               basis change-points of every bid we read since June, misreads
               already screened out (scripts/build_basis_sparklines.py). Each
               bid (one elevator, crop, contract and delivery month, for a
               delivery month not yet past) is compared with ITS OWN earlier
               basis: how many sit at their weakest (or strongest) since the
               record began, and how far the typical one is from its own
               average. Only points dated before the issue are read (no
               look-ahead). Withheld under MIN_BIDS bids or when the record
               is shorter than MIN_SPAN_DAYS.
  rain_line    the reader's own rain against normal: the nearest county
               station we read (MAX_RAIN_MI of the ZIP), this year so far vs
               the 1991 to 2020 normal (data/rain/<st>.json), with the same
               record gates as the county pages' prints.

The connections-study basis findings Sig is holding (Oct 21) are not computed
here and never shown.

    python3 scripts/only_here.py --date 2026-10-21 [--zip 54728]
    python3 scripts/only_here.py --selftest
"""
import glob
import json
import math
import os
import re
import statistics
import sys
from datetime import date, timedelta
from functools import lru_cache

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)

MIN_BIDS = 40
MIN_HIST_POINTS = 2
MIN_SPAN_DAYS = 45
MAX_RAIN_MI = 30.0
MAX_MISSING = 10
FARM_STATES = ("IA", "IL", "IN", "OH", "MN", "NE", "SD", "ND", "WI", "MO", "KS", "MI", "KY")
CROP_WORD = {"corn": "corn", "soybeans": "soybean"}
_MON = {m: i for i, m in enumerate(("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"), 1)}


def _states():
    import county_rain as R
    return R.STATES


def _md(iso):
    d = date.fromisoformat(iso)
    return d.strftime("%b ") + str(d.day)


def _month_name(iso):
    return date.fromisoformat(iso).strftime("%B")


def cents(c):
    import pricefmt
    return pricefmt.move(abs(c), cent=True)


@lru_cache(maxsize=64)
def _spark(st, repo=REPO):
    try:
        with open(os.path.join(repo, "data", "basis-sparklines", st + ".json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


@lru_cache(maxsize=256)
def basis_stats(st, crop, before, repo=REPO):
    """Each live bid's basis now against its own earlier basis, or None."""
    d = _spark(st, repo)
    if not d:
        return None
    y, m = int(before[:4]), int(before[5:7])
    rows, first = [], None
    for k, pts in (d.get("series") or {}).items():
        p = k.split("|")
        if len(p) < 6 or p[3] != crop:
            continue
        mm = re.match(r"([A-Z]{3})(\d\d)$", p[5])
        if not mm or (2000 + int(mm.group(2)), _MON.get(mm.group(1), 0)) < (y, m):
            continue          # a delivery month already past: not a live bid
        pts = [x for x in pts if str(x.get("date")) < before and isinstance(x.get("cents"), (int, float))]
        if len(pts) < MIN_HIST_POINTS + 1:
            continue
        hist = [x["cents"] for x in pts[:-1]]
        cur = pts[-1]["cents"]
        rows.append((cur, min(hist), max(hist), statistics.mean(hist)))
        first = min(first or pts[0]["date"], pts[0]["date"])
    if len(rows) < MIN_BIDS or not first:
        return None
    if (date.fromisoformat(before) - date.fromisoformat(first)).days < MIN_SPAN_DAYS:
        return None
    return {"st": st, "crop": crop, "n": len(rows), "since": first,
            "weakest": sum(1 for r in rows if r[0] <= r[1]), "strongest": sum(1 for r in rows if r[0] >= r[2]),
            "vs_avg": statistics.median([r[0] - r[3] for r in rows])}


def basis_text(s):
    name = _states().get(s["st"], s["st"])
    diff = s["vs_avg"]
    if abs(diff) < 0.5:
        typ = "the typical bid is right at its own average since then"
    else:
        typ = "the typical bid is %s %s its own average since then" % (cents(diff), "under" if diff < 0 else "over")
    if s["weakest"] >= s["strongest"]:
        lead = "%d of the %d %s basis bids we track there are at their weakest since %s" % (
            s["weakest"], s["n"], CROP_WORD[s["crop"]], _month_name(s["since"]))
    else:
        lead = "%d of the %d %s basis bids we track there are at their strongest since %s" % (
            s["strongest"], s["n"], CROP_WORD[s["crop"]], _month_name(s["since"]))
    return "%s: %s; %s." % (name, lead, typ)


@lru_cache(maxsize=64)
def basis_line(before, state=None, repo=REPO):
    """For the reader's state when it has enough bids, else the farm state whose
    basis is furthest from its own record. {"text", "url", "link", "kind", "n"} or None."""
    cands = []
    for st in ([state] if state else []) + [s for s in FARM_STATES if s != state]:
        for crop in ("corn", "soybeans"):
            s = basis_stats(st, crop, before, repo)
            if s:
                cands.append(s)
        if state and st == state and cands:
            break
    if not cands:
        return None
    if not (state and cands[0]["st"] == state):
        cands.sort(key=lambda s: -abs(s["vs_avg"]))
    else:
        cands = [c for c in cands if c["st"] == state]
        cands.sort(key=lambda s: -max(s["weakest"], s["strongest"]) / s["n"])
    s = cands[0]
    slug = re.sub(r"[^a-z0-9]+", "-", _states().get(s["st"], s["st"]).lower()).strip("-")
    return {"text": basis_text(s), "kind": "basis_history", "n": s["n"], "st": s["st"],
            "url": "/cash-bids/%s/#basis" % slug, "link": "Basis in " + _states().get(s["st"], s["st"])}


_BIDS = []


def where(z, bids=None):
    """(lat, lon, state) for a ZIP from the same ZIP tables the local bid line
    reads (scripts/local_bid.py BidsData: centroid and town), or None."""
    try:
        if bids is None:
            if not _BIDS:
                import local_bid
                _BIDS.append(local_bid.BidsData())
            bids = _BIDS[0]
        c = bids.zip_coord(z)
        t = bids.zip_town(z) or ""
    except Exception:
        return None
    if not c:
        return None
    m = re.search(r",\s*([A-Z]{2})$", t)
    return c[0], c[1], (m.group(1) if m else None)


@lru_cache(maxsize=1)
def _stations(repo=REPO):
    out = []
    for p in sorted(glob.glob(os.path.join(repo, "data", "rain", "??.json"))):
        try:
            with open(p, encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, ValueError):
            continue
        st = str(d.get("state") or "").upper()
        for fips, c in (d.get("counties") or {}).items():
            stn = c.get("station") or {}
            ll = stn.get("ll")
            if not ll or c.get("pct") is None or (c.get("missing") or 0) > MAX_MISSING or (c.get("acc") or 0):
                continue
            out.append((float(ll[1]), float(ll[0]), st, dict(c, _fips=fips, _fetched=d.get("fetched"))))
    return out


def _miles(a, b, c, d):
    r = 3958.8
    p1, p2 = math.radians(a), math.radians(c)
    dp, dl = p2 - p1, math.radians(d - b)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _record_words(st, c, repo=REPO, within=3):
    """' That is the 2nd driest by this date in 54 years on record there.' when the county's station sits
    within `within` places of its record, from data/rain/context/<st>.json (scripts/fetch_rain_context.py;
    only a context from the same fetch as the totals, so the rank and the total are the same day's)."""
    try:
        with open(os.path.join(repo, "data", "rain", "context", st.lower() + ".json"), encoding="utf-8") as f:
            x = json.load(f)
    except (OSError, ValueError):
        return ""
    if x.get("fetched") != c.get("_fetched"):
        return ""
    r = ((x.get("counties") or {}).get(c.get("_fips")) or {}).get("rank")
    if not r:
        return ""
    for side, k in (("wettest", "wetter"), ("driest", "drier")):
        place = r[k] + 1
        if place <= within:
            nth = "the" if place == 1 else "the %d%s" % (place, {2: "nd", 3: "rd"}.get(place, "th"))
            return " That is %s %s by this date in %d years on record there (%d on)." % (nth, side, r["n"], r["first"])
    return ""


def rain_line(at, before, repo=REPO):
    """at = (lat, lon) of the reader's ZIP."""
    if not at:
        return None
    best = None
    for lat, lon, st, c in _stations(repo):
        if str(c.get("as_of") or "") > before:
            continue
        mi = _miles(at[0], at[1], lat, lon)
        if mi <= MAX_RAIN_MI and (best is None or mi < best[0]):
            best = (mi, st, c)
    if not best:
        return None
    mi, st, c = best
    import county_rain as R
    town = R.station_town((c.get("station") or {}).get("raw") or "") or (c.get("station") or {}).get("name")
    text = ("Your rain: %.2f in. this year through %s at the %s station (%s, %d mi from you), %d%% of normal for the date."
            % (c["total"], _md(c["as_of"]), town, c["name"], round(mi), c["pct"])) + _record_words(st, c, repo)
    slug = "/rain/%s/%s" % (R.slug(_states().get(st, st)), R.slug(c["name"]))
    return {"text": text, "kind": "rain_vs_normal", "url": slug, "link": "Your county's rain", "n": 1}


def records_line(before, repo=REPO):
    """No ZIP: how many counties are at their wettest or driest year to date on record (scripts/rain_records.py),
    one-gauge records left off, only days before the issue. Links the list on /rain."""
    import rain_records as RR
    rs = [o for o in RR.rows(os.path.join(repo, "data", "rain"), within=1) if not o["one_gauge"] and o["as_of"] < before]
    wet = sorted((o for o in rs if o["side"] == "wettest"), key=lambda o: o["first"])
    dry = sorted((o for o in rs if o["side"] == "driest"), key=lambda o: o["first"])
    if len(rs) < 2:
        return None
    text = ("Rain records: %d %s at the wettest year to date in their station's record and %d at the driest."
            % (len(wet), "county is" if len(wet) == 1 else "counties are", len(dry)))
    oldest = min(rs, key=lambda o: o["first"])
    text += " The longest of those records, %s, %s, goes back to %d (%s)." % (oldest["county"], oldest["state"], oldest["first"], oldest["side"])
    return {"text": text, "kind": "rain_records", "url": "/rain#records", "link": "Every record county", "n": len(rs)}


def for_reader(before, z=None, repo=REPO, loc=None):
    """One or two lines: basis vs its own history (the reader's state, if any),
    and the reader's own rain vs normal (ZIP readers). loc = (lat, lon, state)
    for the ZIP, else looked up (where())."""
    out = []
    if z and loc is None:
        loc = where(z)
    st = loc[2] if loc else None
    try:
        b = basis_line(before, st, repo)
        if b:
            out.append(b)
    except Exception as ex:
        print("only here: basis skipped (%s)" % type(ex).__name__)
    if loc:
        try:
            rl = rain_line(loc[:2], before, repo)
            if rl:
                out.append(rl)
        except Exception as ex:
            print("only here: rain skipped (%s)" % type(ex).__name__)
    else:
        try:
            rr = records_line(before, repo)
            if rr:
                out.append(rr)
        except Exception as ex:
            print("only here: rain records skipped (%s)" % type(ex).__name__)
    out = out[:2]
    # farm sales near a ZIP reader, in the days after the monthly update (scripts/daily_land_line.py)
    if loc:
        try:
            import daily_land_line
            ll = daily_land_line.line(loc[:2], before, repo)
            if ll:
                out.append(ll)
        except Exception as ex:
            print("only here: land sales skipped (%s)" % type(ex).__name__)
    return out


COUNT_LINE = re.compile(r"\b[\d,]+ of (?:the )?[\d,]+ elevators\b|\b[\d,]+ elevators\b", re.I)


def _selftest():
    bad = []

    def ok(c, m):
        if not c:
            bad.append(m)
            print("FAIL", m)
    s = basis_stats("IA", "corn", "2026-10-21")
    ok(s and s["n"] >= MIN_BIDS and s["since"] >= "2026-06-01", "Iowa corn has a record")
    ok(basis_stats("IA", "corn", "2026-06-20") is None, "withheld when the record is short (no look-ahead)")
    locs = {"54728": (45.317, -91.6542, "WI"), "50010": (42.0379, -93.6003, "IA"), None: None}
    for z in ("54728", "50010", None):
        lines = for_reader("2026-10-21", z, loc=locs[z])
        ok(lines, "a line for %s" % z)
        for x in lines:
            ok(re.search(r"\d", x["text"]) and not COUNT_LINE.search(x["text"]) and "—" not in x["text"], "insight, not a count: " + x["text"])
    # the rain data moves every day: ask as of its newest day, so the check never ages out (2026-10-24: a fixed
    # "2026-10-21" failed once every station had reported past it)
    newest = max(str(c.get("as_of") or "") for _, _, _, c in _stations(REPO))
    one = for_reader(max(newest, "2026-10-21"), "50010", loc=locs["50010"])
    ok(one and one[0]["st"] == "IA", "the reader's own state")
    ok(any(x["kind"] == "rain_vs_normal" and "% of normal" in x["text"] for x in one), "the reader's own rain")
    # near a record: the rank rides on the rain line (2026-10-24); a stale context adds nothing
    import tempfile
    with tempfile.TemporaryDirectory() as t:
        os.makedirs(os.path.join(t, "data", "rain", "context"))
        json.dump({"state": "IA", "fetched": "f", "counties": {"19055": {"name": "Delaware County", "total": 50.37, "pct": 149,
                   "as_of": "2026-10-23", "station": {"ll": [-91.45, 42.48], "raw": "MANCHESTER #2", "name": "Manchester #2"}}}},
                  open(os.path.join(t, "data", "rain", "ia.json"), "w"))
        ctx = {"state": "IA", "fetched": "f", "counties": {"19055": {"rank": {"n": 49, "first": 1977, "wetter": 0, "drier": 48}}}}
        json.dump(ctx, open(os.path.join(t, "data", "rain", "context", "ia.json"), "w"))
        rl = rain_line((42.48, -91.45), "2026-10-24", t)
        ok(rl and rl["text"].endswith("That is the wettest by this date in 49 years on record there (1977 on)."), "record words: %s" % (rl and rl["text"]))
        ctx["fetched"] = "old"
        json.dump(ctx, open(os.path.join(t, "data", "rain", "context", "ia.json"), "w"))
        rl = rain_line((42.48, -91.45), "2026-10-24", t)
        ok(rl and "record" not in rl["text"], "a stale context adds nothing")
    rr = records_line("2026-10-25")
    ok(rr is None or (rr["kind"] == "rain_records" and re.search(r"\d", rr["text"]) and "—" not in rr["text"]), "records line: %s" % (rr and rr["text"]))
    # no ZIP: the basis line, then (2026-10-24) the national rain records line when there is one; never the reader's rain
    nz = for_reader("2026-10-21", None)
    ok(nz and nz[0]["kind"] != "rain_vs_normal" and [x["kind"] for x in nz[1:]] in ([], ["rain_records"]), "no ZIP: basis, then records: %s" % [x["kind"] for x in nz])
    wi = for_reader("2026-10-21", "54728", loc=locs["54728"])
    ok(wi and wi[0]["st"] != "WI", "a state with too few bids (Wisconsin) falls back to a farm state with a record")
    print("only_here selftest " + ("FAILED" if bad else "ok"))
    return 1 if bad else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    a = sys.argv
    d = a[a.index("--date") + 1] if "--date" in a else date.today().isoformat()
    z = a[a.index("--zip") + 1] if "--zip" in a else None
    print(json.dumps(for_reader(d, z), indent=1))
