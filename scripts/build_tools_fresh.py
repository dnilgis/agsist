#!/usr/bin/env python3
"""Write data/tools-fresh.json: when each data tool on /tools was last fed, and
how much of it covers each state.

Every date comes out of the data file the tool itself reads (its own fetched,
posted or report date), never the time this script ran, so a late run only
makes the hub look older than the tool, never newer. A field that is missing
or does not parse as a date is left out, and the card shows no date.

    python3 scripts/build_tools_fresh.py            # write the file
    python3 scripts/build_tools_fresh.py --selftest # check the parsers, write nothing

No network.
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "tools-fresh.json")
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?Z?)?$")


def load(rel):
    try:
        with open(os.path.join(ROOT, rel)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def good(s, now):
    """A date we will print: ISO shaped, after 2020, not more than a day ahead."""
    if not isinstance(s, str) or not ISO.match(s):
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    if d.year < 2020 or d > now + timedelta(days=1):
        return None
    return s


def newest(dates, now):
    ok = [d for d in (good(x, now) for x in dates) if d]
    return max(ok, key=lambda s: s[:10] + s[10:]) if ok else None


def build(now):
    tools, states = {}, {}

    def put(href, asof, verb, src):
        if asof:
            tools[href] = {"asof": asof, "verb": verb, "src": src}

    def bump(st, key, n):
        if isinstance(st, str) and re.match(r"^[A-Z]{2}$", st) and n:
            states.setdefault(st, {})[key] = states.get(st, {}).get(key, 0) + n

    b = load("data/bids.json") or {}
    put("/cash-bids", good(b.get("fetched"), now), "Bids read", "elevator websites")
    put("/store-or-sell", good(b.get("fetched"), now), "Bids read", "elevator websites")
    for st, n in ((b.get("stats") or {}).get("by_state") or {}).items():
        bump(st, "bids", n if isinstance(n, int) else 0)

    f = load("data/fertilizer-prices.json") or {}
    fd = newest([p.get("as_of") for p in f.get("prices") or [] if p.get("src") == "coop"], now)
    regions = sorted({p.get("region") for p in f.get("prices") or [] if p.get("src") == "coop" and p.get("region")})
    src = (regions[0] + " co-ops") if len(regions) == 1 else "co-ops"
    for h in ("/fertilizer", "/manure-value", "/nutrient-removal"):
        put(h, fd, "Prices posted", src)

    h = load("data/hay/ams-hay.json") or {}
    reps = [r for r in h.get("reports") or [] if good(r.get("date"), now)]
    put("/hay-prices", newest([r["date"] for r in reps], now), "Latest trade report", "USDA AMS")
    for r in reps:
        bump(r.get("state"), "hay", 1)

    c = load("data/cattle-auction.json") or {}
    sales = []
    for x in (c.get("barns") or []) + (c.get("states") or []):
        ds = [s.get("date") for s in x.get("sales") or []]
        if any(good(d, now) for d in ds):
            sales += ds
            if x in (c.get("barns") or []):
                bump(x.get("state"), "barns", 1)
    put("/cattle-auction-prices", newest(sales, now), "Latest sale", "USDA AMS")

    l = load("data/lrp/today.json") or {}
    put("/lrp", good(l.get("sales_day"), now), "Rates for", "USDA RMA")

    hm = load("data/hail/manifest.json") or {}
    put("/hail-map", good(hm.get("recent_generated"), now), "Reports checked", "NOAA radar")

    p = load("data/prices.json") or {}
    put("/", good(p.get("fetched"), now), "Futures read", "delayed quotes")

    fn = load("data/fall-nitrogen.json") or {}
    put("/fall-nitrogen", good(fn.get("updated_utc"), now), "Soil temps read", "state networks")
    for v in (fn.get("counties") or {}).values():
        if isinstance(v, list) and len(v) >= 6:
            bump(v[1], "soil", 1)

    t = load("data/tariffs.json") or {}
    put("/tariffs", good(t.get("updated"), now), "Checked by hand", "")

    cp = load("data/crop-progress.json") or {}
    put("/conditions", good(cp.get("report_date"), now), "Week ending", "USDA NASS")

    hp = load("data/harvest-prices.json") or {}
    put("/harvest-price-tracker", good(hp.get("updated"), now), "Updated", "CBOT settles")

    return {
        "generated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": "Built by scripts/build_tools_fresh.py for /tools. asof is the tool's own data date (read, posted or report date), "
                "copied from the file the tool reads; a tool with no valid date is left out. states counts, per state: "
                "bids (cash bids in data/bids.json), hay (USDA AMS hay reports), barns (sale barns with a sale), "
                "soil (counties with a soil temperature station in reach).",
        "tools": tools,
        "states": dict(sorted(states.items())),
    }


def selftest():
    now = datetime(2026, 10, 16, 18, 0, tzinfo=timezone.utc)
    assert good("2026-10-16", now) == "2026-10-16"
    assert good("2026-10-16T21:37:42Z", now)
    assert good("2026-10-18", now) is None, "two days ahead is refused"
    assert good("2019-01-01", now) is None
    assert good("Oct 16", now) is None and good(None, now) is None and good(5, now) is None
    assert newest(["2026-10-01", "2026-10-13", "bad", None, "2026-10-08"], now) == "2026-10-13"
    assert newest([], now) is None
    d = build(now)
    assert set(d) == {"generated", "note", "tools", "states"}
    for k, v in d["tools"].items():
        assert k.startswith("/") and good(v["asof"], now), (k, v)
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
        sys.exit(0)
    out = build(datetime.now(timezone.utc))
    try:
        with open(OUT) as fh:
            old = json.load(fh)
        if old.get("tools") == out["tools"] and old.get("states") == out["states"]:
            print("no change in any tool date or state count; file left as it is")
            sys.exit(0)
    except (OSError, ValueError):
        pass
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"), sort_keys=False)
        fh.write("\n")
    print("wrote %s: %d tools, %d states, %d bytes" % (os.path.relpath(OUT, ROOT), len(out["tools"]), len(out["states"]), os.path.getsize(OUT)))
