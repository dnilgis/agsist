#!/usr/bin/env python3
"""
only_here.py -- "Only here" in the Daily (Sig, Oct 22 2026): one or two
findings only AGSIST can make, from our own data, each with its number and its
sample, never the workings. Not a raw count of elevators (Sig, Oct 22: "1,749
of 1,810 elevators cut bids" is not an insight); a comparison against history.

  wow_rows     the state basis line (Nov 9 2026, replacing the North Dakota
  wow_text     basis-history line): each state's week-over-week basis change
               from data/basis-states.json with the share of bids that moved,
               the reader's state first. The generator decides whether it
               prints (daily_fresh.wow_should_print) and keeps it on the issue
               (basis_wow); this file only computes and words it.
  rain_line    the reader's own rain against normal: the nearest county
               station we read (MAX_RAIN_MI of the ZIP), this year so far vs
               the 1991 to 2020 normal (data/rain/<st>.json), with the same
               record gates as the county pages' prints.

The connections-study basis findings Sig is holding (Oct 21) are not computed
here and never shown.

    python3 scripts/only_here.py --date 2026-10-21 [--zip 54728]
    python3 scripts/only_here.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import glob
import json
import math
import os
import re
import sys
from datetime import date, timedelta
from functools import lru_cache

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)

MAX_RAIN_MI = 30.0
MAX_MISSING = 10


def _states():
    import county_rain as R
    return R.STATES


def _md(iso):
    d = date.fromisoformat(iso)
    return d.strftime("%b ") + str(d.day)


# ── the state basis line (Daily panel, Nov 9 2026; Sig "all") ──────────────
# Replaces the North Dakota basis-history line (basis_line, cut Nov 9: in the
# email 15 of 15 issues, it moved only at a month roll, so it could not carry
# news). From data/basis-states.json: each state's week-over-week basis change
# (the median of every bid matched with the same elevator's same delivery and
# futures month a week earlier) with the share of those bids that moved, since
# a median reads 0 when most boards did not reprice. A state prints only with
# |change| >= WOW_MIN_C, WOW_MIN_N matched bids and WOW_MIN_COS companies; the
# reader's state first; at most WOW_MAX states. Whether it prints at all is the
# memory's call (daily_fresh.wow_should_print): nothing on a quiet week.
WOW_MIN_C = 5.0
WOW_MIN_N = 30
WOW_MIN_COS = 8
WOW_MAX = 3
WOW_STALE_H = 36
WOW_PREV_DAYS = (5, 9)           # the week-ago snapshot must be about a week back
WOW_CROPS = (("corn", "corn"), ("soybeans", "soybeans"))


def _iso_dt(s):
    from datetime import datetime
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


def wow_rows(bs, at):
    """([row], why): the states that pass the gates, from basis-states.json as it stood at `at` (an aware
    datetime, the issue's time). A file written after `at` (look-ahead), older than WOW_STALE_H hours, or
    whose week-ago snapshot is not about a week back gives no rows. A row without its up and down counts
    is left out: its share cannot be printed."""
    if not isinstance(bs, dict):
        return [], "no basis-states file"
    gen, prev = _iso_dt(bs.get("generated")), _iso_dt(bs.get("prev"))
    if gen is None or prev is None:
        return [], "no snapshot times"
    if gen > at or (at - gen).total_seconds() > WOW_STALE_H * 3600:
        return [], "snapshot %s is not before and within %d hours of the issue" % (bs.get("generated"), WOW_STALE_H)
    if not WOW_PREV_DAYS[0] <= (gen - prev).days <= WOW_PREV_DAYS[1]:
        return [], "week-ago snapshot %s is not about a week back" % bs.get("prev")
    out = []
    for st, v in sorted((bs.get("states") or {}).items()):
        for crop, word in WOW_CROPS:
            x = ((v or {}).get("crops") or {}).get(crop)
            if not isinstance(x, dict):
                continue
            w, n, cos = x.get("wow"), x.get("wow_n") or 0, x.get("companies") or 0
            up, dn = x.get("wow_up"), x.get("wow_dn")
            if not isinstance(w, (int, float)) or abs(w) < WOW_MIN_C or n < WOW_MIN_N or cos < WOW_MIN_COS:
                continue
            if not isinstance(up, int) or not isinstance(dn, int) or up + dn > n:
                continue
            out.append({"st": st, "name": (v or {}).get("name") or _states().get(st, st), "crop": crop,
                        "wow": float(w), "n": int(n), "moved": up + dn, "companies": int(cos)})
    return out, ("%d state rows pass" % len(out)) if out else "no state passed the gates (a quiet week)"


def _signed(c):
    import pricefmt
    return ("+" if c > 0 else "\u2212") + pricefmt.move(abs(c), cent=True)


def wow_text(rows, state=None):
    """One line, the reader's state first, then the biggest moves; no buyer names."""
    if not rows:
        return ""
    pick = sorted(rows, key=lambda r: (r["st"] != state, -abs(r["wow"]), -r["n"], r["st"], r["crop"]))[:WOW_MAX]
    parts = []
    for i, r in enumerate(pick):
        tail = "%d of %d bids moved" % (r["moved"], r["n"]) if i == 0 else "%d of %d" % (r["moved"], r["n"])
        parts.append("%s %s %s (%s)" % (r["name"], r["crop"], _signed(r["wow"]), tail))
    ups, downs = all(r["wow"] > 0 for r in pick), all(r["wow"] < 0 for r in pick)
    head = "Basis firmed this week" if ups else ("Basis weakened this week" if downs else "Basis this week")
    body = ", ".join(parts[:-1]) + (" and " if len(parts) > 1 else "") + parts[-1]
    return "%s: %s." % (head, body)


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


def _record_rank(st, c, repo=REPO, within=3):
    """(sentence, fact) when the county's station sits within `within` places of its record, from
    data/rain/context/<st>.json (scripts/fetch_rain_context.py; only a context from the same fetch as the
    totals, so the rank and the total are the same day's), else ("", None). The fact is the county's, never
    the reader's: {"kind": "rain_rank", "key": "<ST>:<fips>", "value": "<side>:<place>"} (Nov 10 2026: the
    same "3rd wettest" sentence rode the ZIP reader's rain line Nov 5 to 10 unchanged; daily_v2 keeps it only
    when daily_fresh.still_news says the rank entered or moved since the issue that last printed it)."""
    try:
        with open(os.path.join(repo, "data", "rain", "context", st.lower() + ".json"), encoding="utf-8") as f:
            x = json.load(f)
    except (OSError, ValueError):
        return "", None
    if x.get("fetched") != c.get("_fetched"):
        return "", None
    r = ((x.get("counties") or {}).get(c.get("_fips")) or {}).get("rank")
    if not r:
        return "", None
    for side, k in (("wettest", "wetter"), ("driest", "drier")):
        place = r[k] + 1
        if place <= within:
            nth = "the" if place == 1 else "the %d%s" % (place, {2: "nd", 3: "rd"}.get(place, "th"))
            return (" That is %s %s by this date in %d years on record there (%d on)." % (nth, side, r["n"], r["first"]),
                    {"kind": "rain_rank", "key": "%s:%s" % (st.upper(), c.get("_fips")), "value": "%s:%d" % (side, place)})
    return "", None


def _record_words(st, c, repo=REPO, within=3):
    """' That is the 2nd driest by this date in 54 years on record there.' or "" (see _record_rank)."""
    return _record_rank(st, c, repo, within)[0]


def record_facts(before, repo=REPO):
    """[fact] of every county whose record sentence a ZIP reader's rain line could carry in the issue for
    `before`: the issue's own record of it (per county, never per reader), so the next issues know it was told."""
    out = []
    for _lat, _lon, st, c in _stations(repo):
        if str(c.get("as_of") or "") > before:
            continue
        f = _record_rank(st, c, repo)[1]
        if f:
            out.append(f)
    return out


def rain_fact(st, c):
    """The ZIP reader's rain line as a fact, by the station's county, never the reader: {"kind": "rain_line",
    "key": "<ST>:<fips>", "value": "<as_of>"}, the day the station's total runs through. A station that has not
    reported since the last issue gives the same value, and daily_v2 leaves the line out (Nov 10 2026: lines are
    computed at send time, so a repeat was never seen)."""
    return {"kind": "rain_line", "key": "%s:%s" % (st.upper(), c.get("_fips")), "value": str(c.get("as_of"))}


def rain_facts(before, repo=REPO):
    """[fact] of every county whose station a ZIP reader's rain line could read in the issue for `before`
    (rain_fact): the issue's own record of what its rain lines said, so the next issue can leave out a repeat."""
    out = []
    for _lat, _lon, st, c in _stations(repo):
        if str(c.get("as_of") or "") > before or c.get("total") is None:
            continue
        out.append(rain_fact(st, c))
    return out


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
            % (c["total"], _md(c["as_of"]), town, c["name"], round(mi), c["pct"]))
    words, fact = _record_rank(st, c, repo)
    slug = "/rain/%s/%s" % (R.slug(_states().get(st, st)), R.slug(c["name"]))
    out = {"text": text + words, "kind": "rain_vs_normal", "url": slug, "link": "Your county's rain", "n": 1,
           "fact": rain_fact(st, c)}
    if words:
        out["record"] = {"text": words, "fact": fact}     # daily_v2 drops the words when the rank is no news
    return out


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
    # the value is the two counts and the oldest record (daily_fresh.still_news: the line prints again only when
    # one of them changed since the issue that last printed it; Nov 9 and 10 2026 went out word for word)
    first = "%s, %s, %d, %s" % (oldest["county"], oldest["state"], oldest["first"], oldest["side"])
    return {"text": text, "kind": "rain_records", "url": "/rain#records", "link": "Every record county", "n": len(rs),
            "fact": {"kind": "rain_records", "key": "us", "value": [len(wet), len(dry), first], "text": text}}


def for_reader(before, z=None, repo=REPO, loc=None):
    """One or two lines: basis vs its own history (the reader's state, if any),
    and the reader's own rain vs normal (ZIP readers). loc = (lat, lon, state)
    for the ZIP, else looked up (where())."""
    out = []
    if z and loc is None:
        loc = where(z)
    st = loc[2] if loc else None
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
    ok("basis_line" not in globals() and "basis_stats" not in globals(), "the North Dakota basis line is gone (Nov 9)")
    bs = {"generated": "2026-11-09T10:17:40Z", "prev": "2026-11-02T10:16:18Z", "states": {
        "OH": {"name": "Ohio", "crops": {"corn": {"wow": 10.0, "wow_n": 50, "companies": 18, "wow_up": 41, "wow_dn": 2}}},
        "IN": {"name": "Indiana", "crops": {"corn": {"wow": 6.0, "wow_n": 49, "companies": 21, "wow_up": 30, "wow_dn": 4}}},
        "CO": {"name": "Colorado", "crops": {"corn": {"wow": 5.0, "wow_n": 6, "companies": 5, "wow_up": 3, "wow_dn": 0}}}}}
    from datetime import datetime, timezone
    at = datetime(2026, 11, 9, 10, 50, tzinfo=timezone.utc)
    rows, _w = wow_rows(bs, at)
    ok([r["st"] for r in rows] == ["IN", "OH"], "gates: 30 bids and 8 companies (Colorado has 6): %s" % rows)
    ok(wow_text(rows) == "Basis firmed this week: Ohio corn +10\u00a2 (43 of 50 bids moved) and Indiana corn +6\u00a2 (34 of 49).",
       "words: %r" % wow_text(rows))
    ok(wow_text(rows, "IN").startswith("Basis firmed this week: Indiana corn"), "the reader's state first")
    ok(wow_rows(bs, datetime(2026, 11, 9, 10, 0, tzinfo=timezone.utc))[0] == [], "a snapshot written after the issue is not read")
    locs = {"54728": (45.317, -91.6542, "WI"), "50010": (42.0379, -93.6003, "IA"), None: None}
    # the rain data moves every day: ask as of its newest day (a fixed date ages out once every station reports past it)
    on = max(max(str(c.get("as_of") or "") for _, _, _, c in _stations(REPO)), "2026-10-21")
    for z in ("54728", "50010", None):
        lines = for_reader(on, z, loc=locs[z])
        ok(lines or z is None, "a line for %s" % z)
        for x in lines:
            ok(re.search(r"\d", x["text"]) and not COUNT_LINE.search(x["text"]) and "—" not in x["text"], "insight, not a count: " + x["text"])
    # the rain data moves every day: ask as of its newest day, so the check never ages out (2026-10-24: a fixed
    # "2026-10-21" failed once every station had reported past it)
    newest = max(str(c.get("as_of") or "") for _, _, _, c in _stations(REPO))
    one = for_reader(max(newest, "2026-10-21"), "50010", loc=locs["50010"])
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
    # no ZIP: (2026-10-24) the national rain records line when there is one; never the reader's rain, and since
    # Nov 9 2026 no basis line here (the state basis line is the generator's, on the issue)
    nz = for_reader("2026-10-21", None)
    ok([x["kind"] for x in nz] in ([], ["rain_records"]), "no ZIP: records only: %s" % [x["kind"] for x in nz])
    wi = for_reader(on, "54728", loc=locs["54728"])
    ok(wi and all(x["kind"] != "basis_history" for x in wi), "no basis-history line for a ZIP reader either")
    print("only_here selftest " + ("FAILED" if bad else "ok"))
    return 1 if bad else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    a = sys.argv
    d = a[a.index("--date") + 1] if "--date" in a else date.today().isoformat()
    z = a[a.index("--zip") + 1] if "--zip" in a else None
    print(json.dumps(for_reader(d, z), indent=1))
