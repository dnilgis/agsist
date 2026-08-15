#!/usr/bin/env python3
"""Selftest for fetch_rma_prices.py — parsing, window math, and the anti-truncation guard.

Every check here fails on the obvious wrong implementation:
  - a parser that reads only the fields we hardcoded fails the "unknown field
    survives" check;
  - window math that uses calendar containment loosely fails the boundary cases;
  - a pager that trusts the server fails the repeated-page control.
"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_rma_prices as M  # noqa: E402

FAILED = []


def check(name, ok, detail=""):
    print(("  ok   " if ok else "  FAIL ") + name + (("  — " + detail) if detail and not ok else ""))
    if not ok:
        FAILED.append(name)


def _raises(fn):
    try:
        fn()
    except Exception:
        return True
    return False


def entry(**kw):
    body = "".join(f"<d:{k}>{v}</d:{k}>" for k, v in kw.items())
    return ("<entry><content type='application/xml'>"
            f"<m:properties>{body}</m:properties></content></entry>")


def feed(*entries):
    return ("<?xml version='1.0' encoding='utf-8'?>"
            "<feed xmlns='http://www.w3.org/2005/Atom' "
            "xmlns:m='http://schemas.microsoft.com/ado/2007/08/dataservices/metadata' "
            "xmlns:d='http://schemas.microsoft.com/ado/2007/08/dataservices'>"
            + "".join(entries) + "</feed>").encode()


GA_CORN = dict(
    CompositeKey="2026-0041-13-997-997", CommodityYear="2026",
    CommodityCode="0041", CommodityName="Corn",
    TypeCode="016", TypeName="All (Non-High Amylose)",
    PracticeCode="997", PracticeName="Conventional",
    StateCode="13", StateName="Georgia", SalesClosingDateDisplay="2/28/2026",
    ProjectedPriceExchangeCode="CBOT", ProjectedSymbolName="Corn",
    ProjectedMonthName="September", ProjectedYear="2026",
    ProjectedPriceBeginDate="2026-01-15T00:00:00",
    ProjectedPriceEndDate="2026-02-14T00:00:00",
    ProjectedPrice="4.4200", ProjectedPriceStatus="Released",
    HarvestPriceExchangeCode="CBOT", HarvestSymbolCode="C",
    HarvestMonthName="September", HarvestYear="2026",
    HarvestPriceBeginDate="2026-08-01T00:00:00",
    HarvestPriceEndDate="2026-08-31T00:00:00",
    HarvestPrice="4.4500", HarvestPriceStatus="In Discovery",
    ApprovedPriceVolatilityPercent="0.21",
)
IA_CORN = dict(GA_CORN, CompositeKey="2026-0041-19-997-997", StateCode="19",
               StateName="Iowa", SalesClosingDateDisplay="3/15/2026",
               ProjectedMonthName="December", HarvestMonthName="December",
               HarvestPriceBeginDate="2026-10-01T00:00:00",
               HarvestPriceEndDate="2026-10-31T00:00:00",
               HarvestPrice="", HarvestPriceStatus="Yet To Start")
GA_ORG = dict(GA_CORN, CompositeKey="2026-0041-13-997-002",
              PracticeName="Organic", HarvestPrice="9.1000")

TODAY = date(2026, 8, 15)


print("parsing")
rows = M.shape(M.parse_entries(feed(entry(**GA_CORN), entry(**IA_CORN))))
check("both entries parsed", len(rows) == 2, str(len(rows)))
ga = rows[0]
check("state read", ga["state"] == "Georgia", ga["state"])
check("datetimes reduced to dates", ga["h_start"] == "2026-08-01" and ga["h_end"] == "2026-08-31",
      f"{ga['h_start']}..{ga['h_end']}")
check("prices are numbers", ga["h_price"] == 4.45 and isinstance(ga["h_price"], float),
      repr(ga["h_price"]))
check("in-discovery status carried verbatim", ga["h_status"] == "In Discovery", ga["h_status"])
check("empty price becomes null, not zero", rows[1]["h_price"] is None, repr(rows[1]["h_price"]))
check("crop year is an int", ga["year"] == 2026, repr(ga["year"]))

# A parser that only looks for the fields in FIELDS would drop this silently.
extra = M.parse_entries(feed(entry(**dict(GA_CORN, SomeNewFieldRmaAdded="42"))))
check("a field we never coded for still comes back from the parser",
      extra[0].get("SomeNewFieldRmaAdded") == "42")

print("\nwindow math")
op, nx = M.windows(rows, TODAY)
check("Georgia corn harvest is open on Aug 15",
      any(w["state"] == "Georgia" and w["leg"] == "harvest" for w in op))
check("Iowa corn harvest is not open on Aug 15",
      not any(w["state"] == "Iowa" and w["leg"] == "harvest" for w in op))
check("Iowa corn harvest is listed as opening next",
      any(w["state"] == "Iowa" and w["leg"] == "harvest" and w["in_days"] == 47 for w in nx),
      str([(w["state"], w.get("in_days")) for w in nx]))
check("closed projected windows are in neither list",
      not any(w["leg"] == "projected" for w in op + nx))
gaw = [w for w in op if w["state"] == "Georgia"][0]
check("day counter is 1-based", gaw["day"] == 15, str(gaw["day"]))
check("span is the whole window", gaw["span"] == 31, str(gaw["span"]))

first = M.windows(rows, date(2026, 8, 1))[0]
last = M.windows(rows, date(2026, 8, 31))[0]
after = M.windows(rows, date(2026, 9, 1))[0]
check("window is open on its first day",
      any(w["state"] == "Georgia" for w in first) and
      [w for w in first if w["state"] == "Georgia"][0]["day"] == 1)
check("window is open on its last day",
      [w for w in last if w["state"] == "Georgia"][0]["day"] == 31)
check("window is closed the day after it ends",
      not any(w["state"] == "Georgia" and w["leg"] == "harvest" for w in after))

print("\nbanner summary")
rows3 = M.shape(M.parse_entries(feed(entry(**GA_CORN), entry(**GA_ORG), entry(**IA_CORN))))
op3, _ = M.windows(rows3, TODAY)
summ = M.summarize(op3)
check("one banner line per crop/leg/window", len(summ) == 1, str(len(summ)))
check("organic price is excluded from the headline range",
      summ[0]["lo"] == 4.45 and summ[0]["hi"] == 4.45,
      f"{summ[0]['lo']}–{summ[0]['hi']}")
check("both practices still counted as one state, not two",
      summ[0]["n_states"] == 1, str(summ[0]["n_states"]))

# Winter and spring wheat can share an Aug 1-31 harvest window and never share
# a price. Merging them would print an average that belongs to no grower.
W_WIN = dict(GA_CORN, CompositeKey="w1", CommodityName="Wheat", TypeName="Winter",
             StateName="Montana", StateCode="30", HarvestPrice="7.1600")
W_SPR = dict(GA_CORN, CompositeKey="w2", CommodityName="Wheat", TypeName="Spring",
             StateName="Montana", StateCode="30", HarvestPrice="6.0500")
wrows = M.shape(M.parse_entries(feed(entry(**W_WIN), entry(**W_SPR))))
wsum = M.summarize(M.windows(wrows, TODAY)[0])
check("winter and spring wheat stay separate lines", len(wsum) == 2, str(len(wsum)))
check("neither wheat line invents an averaged price",
      sorted(x["lo"] for x in wsum) == [6.05, 7.16],
      str(sorted(x["lo"] for x in wsum)))
check("each wheat line names its type",
      sorted(x["type"] for x in wsum) == ["Spring", "Winter"],
      str(sorted(x["type"] for x in wsum)))

print("\ntruncation guard")


def fake_pages(pages):
    calls = {"n": 0}

    def _get(url, timeout=60, tries=4):
        i = calls["n"]
        calls["n"] += 1
        return pages[min(i, len(pages) - 1)]
    return _get


real_get = M._get
try:
    full = feed(*[entry(**dict(GA_CORN, CompositeKey=f"k{i}")) for i in range(M.PAGE)])
    M._get = fake_pages([full, full])
    try:
        M.pull("8/15/2026", verbose=False)
        check("a server that ignores $skip raises instead of writing a slice", False,
              "pull() returned normally")
    except RuntimeError as exc:
        check("a server that ignores $skip raises instead of writing a slice",
              "ignoring $skip" in str(exc))

    M._get = fake_pages([full, feed(), feed()])
    got = M.pull("8/15/2026", verbose=False)
    check("a short final page ends the walk cleanly", len(got) == M.PAGE, str(len(got)))

    M._get = fake_pages([feed()])
    check("an empty first page yields nothing rather than hanging",
          M.pull("8/15/2026", verbose=False) == [])
finally:
    M._get = real_get

print("\nurl building")
u = M.page_url("8/15/2026", 32, "CommodityYear eq 2026")
check("skip is sent", "%24skip=32" in u or "$skip=32" in u, u)
check("filter is sent", "CommodityYear" in u, u)
check("date is sent unescaped-slash-safe", "8%2F15%2F2026" in u or "8/15/2026" in u, u)

print("\ncalendar walk (the 2026-08-15 single-date bug)")
# A stand-in for the real service: it returns a row only when the requested
# discoveryPeriodDate falls inside one of that row's windows. That is exactly
# what public-rma does, verified live — 10/15/2026 returns soybeans, 8/15/2026
# returns none — and it is what the old single-date pull could not see.
import urllib.parse as _up  # noqa: E402

WORLD = [
    # crop,        state,      projected window,        harvest window
    ("Corn",      "Georgia",   ("2026-01-15", "2026-02-14"), ("2026-08-01", "2026-08-31")),
    ("Corn",      "Texas",     ("2025-12-15", "2026-01-14"), ("2026-08-01", "2026-08-31")),
    ("Soybeans",  "Illinois",  ("2026-02-01", "2026-02-28"), ("2026-10-01", "2026-10-31")),
    ("Soybeans",  "Wisconsin", ("2026-02-01", "2026-02-28"), ("2026-10-01", "2026-10-31")),
    ("Wheat",     "Kansas",    ("2025-08-15", "2025-09-14"), ("2026-06-01", "2026-06-30")),
]


def _world_entries(disc):
    mo, dy, yr = (int(x) for x in disc.split("/"))
    d = date(yr, mo, dy)
    out = []
    for crop, st, (ps, pe), (hs, he) in WORLD:
        hit = any(date.fromisoformat(a) <= d <= date.fromisoformat(b)
                  for a, b in ((ps, pe), (hs, he)))
        if hit:
            out.append(entry(CompositeKey=f"{crop}-{st}", CommodityYear="2026",
                             CommodityName=crop, TypeName="All",
                             InsurancePracticeName="Conventional", StateName=st,
                             ProjectedPriceBeginDate=ps + "T00:00:00",
                             ProjectedPriceEndDate=pe + "T00:00:00",
                             HarvestPriceBeginDate=hs + "T00:00:00",
                             HarvestPriceEndDate=he + "T00:00:00"))
    return out


def world_get(url):
    q = _up.parse_qs(_up.urlparse(url).query)
    disc = q["discoveryPeriodDate"][0]
    skip = int(q.get("$skip", ["0"])[0])
    return feed(*_world_entries(disc)[skip:skip + M.PAGE])


try:
    M._get = world_get

    one_day = M.shape(M.pull("8/15/2026", verbose=False))
    crops_1d = {r["crop"] for r in one_day}
    check("a single-date pull really does miss whole crops (the live bug)",
          "Soybeans" not in crops_1d, f"got {sorted(crops_1d)}")

    walked = M.shape(M.pull_year(2026, verbose=False))
    crops_w = {r["crop"] for r in walked}
    check("the walk finds every crop the single date missed",
          {"Corn", "Soybeans", "Wheat"} <= crops_w, f"got {sorted(crops_w)}")
    check("the walk reaches a projected window that closed in the prior year",
          any(r["state"] == "Texas" for r in walked),
          "Texas 2025-12-15 window not recovered")
    check("the walk reaches a prior-year August window (winter wheat)",
          any(r["state"] == "Kansas" for r in walked))
    check("the walk deduplicates rather than repeating a row per probe date",
          len(walked) == len(WORLD), f"{len(walked)} rows for {len(WORLD)} in the world")
finally:
    M._get = real_get

check("a stride that could step over a 28-day window is refused",
      _raises(lambda: M.walk_dates(2026, 30)), "walk_dates(2026, 30) returned")
check("the walk starts in the prior year", M.walk_dates(2026)[0].endswith("/2025"),
      M.walk_dates(2026)[0])
check("the walk ends at the close of the crop year",
      M.walk_dates(2026)[-1].endswith("/2026"), M.walk_dates(2026)[-1])

print("\ncoverage floor")
slice_rows = ([{"crop": "Corn", "state": s} for s in
               ("Alabama", "Arkansas", "Florida", "Georgia", "Louisiana",
                "Mississippi", "South Carolina", "Texas")])
check("the shape of the live bug trips the floor",
      any("Corn" in c for c in M.check_coverage(slice_rows)),
      str(M.check_coverage(slice_rows)))
full_rows = ([{"crop": "Corn", "state": f"S{i}"} for i in range(40)] +
             [{"crop": "Soybeans", "state": f"S{i}"} for i in range(34)])
check("a whole-year pull clears the floor", M.check_coverage(full_rows) == [],
      str(M.check_coverage(full_rows)))

print()
if FAILED:
    print(f"{len(FAILED)} FAILED: " + "; ".join(FAILED))
    sys.exit(1)
print("all rma-prices checks pass")
