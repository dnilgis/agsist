#!/usr/bin/env python3
"""probe_epic2.py — data probes for the next five epic pages. READS ONLY.

Run via probe-epic2.yml in Actions (needs NASS_API_KEY), paste the log back.
Fetchers and pages get written against these results — never against guesses.

What it settles, per page:

  1. WHO OWNS THE GROUND (/land-tenure)
     Tenure data lives in the Census of Agriculture (5-yearly) and the 2014
     TOTAL survey. NEVER PROBED. Enumerates CENSUS short_descs matching
     tenure/ownership at STATE and COUNTY level: exact strings, row counts,
     years, suppression rates. The page cannot be designed until we know
     whether county-level tenant/ownership shares actually exist.

  2. STORAGE VS PRODUCTION (/storage-crunch)
     Strings verified 2026-07-16 (handoff §5.2) with KNOWN TRAPS re-checked
     here: OT pseudo-state present? on-farm's TWO ref periods (END OF DEC
     5,339 rows + FIRST OF DEC 780)? production forecast-contamination
     (must filter reference_period_desc='YEAR')?

  3. CONDITIONS→YIELD (/conditions-yield)
     County+state yields verified clean earlier; here we re-verify state
     yield's forecast contamination and pull IA sample pairs (week-25 G+E
     vs final yield, 2000-2025) to confirm a fit is even honest.

  4. LAND RENT BY STATE (/cash-rent/<state>) — no probe needed: data local.
  5. FARMER-FIRST PAYMENTS — no probe possible: fsa.usda.gov tarpits
     datacenter IPs (verified); Sig's browser download list re-issued.

Every check prints a verdict line; a dead path is a finding, not a crash.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

API = "https://quickstats.nass.usda.gov/api"
KEY = os.environ.get("NASS_API_KEY", "").strip()
UA = {"User-Agent": "AGSIST/1.0 (+https://agsist.com; data probe)"}


def get(path, params, timeout=120):
    q = dict(params)
    q["key"] = KEY
    url = f"{API}/{path}/?" + urllib.parse.urlencode(q)
    for attempt, pause in enumerate((0, 45, 120)):
        if pause:
            print(f"    throttled — backoff {pause}s", file=sys.stderr)
            time.sleep(pause)
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            if e.code == 400:
                return {}
            if e.code in (403, 429) or e.code >= 500:
                continue
            raise
    return None


def count(params):
    d = get("api_GET", dict(params, format="JSON")) or {}
    return d.get("data", [])


def sect(t):
    print("\n" + "=" * 78 + f"\n  {t}\n" + "=" * 78)


def probe_tenure():
    sect("1. TENURE — enumerate what actually exists (never probed before)")
    # Enumerate short_descs under promising commodity groups. get_param_values
    # is the honest enumeration route (guessed strings die as silent 400s).
    for commodity in ("FARM OPERATIONS", "AG LAND", "LAND AREA"):
        d = get("get_param_values", {"param": "short_desc",
                                     "commodity_desc": commodity})
        vals = (d or {}).get("short_desc", [])
        hits = [v for v in vals if any(w in v.upper() for w in
                ("TENURE", "TENANT", "OWNED", "OWNER", "RENTED", "LEASED"))]
        print(f"  {commodity}: {len(vals)} short_descs, {len(hits)} tenure-ish:")
        for h in hits[:12]:
            print(f"    · {h}")
    # For the top candidates, check county availability + years + suppression
    CANDIDATES = [
        "FARM OPERATIONS, TENURE, FULL OWNER - NUMBER OF OPERATIONS",
        "FARM OPERATIONS, TENURE, PART OWNER - NUMBER OF OPERATIONS",
        "FARM OPERATIONS, TENURE, TENANT - NUMBER OF OPERATIONS",
        "AG LAND, OWNED, IN FARMS - ACRES",
        "AG LAND, RENTED FROM OTHERS, IN FARMS - ACRES",
    ]
    for sd in CANDIDATES:
        for lvl in ("COUNTY", "STATE"):
            rows = count({"short_desc": sd, "agg_level_desc": lvl,
                          "source_desc": "CENSUS", "state_alpha": "IA"})
            if rows:
                yrs = sorted({r.get("year") for r in rows})
                supp = sum(1 for r in rows if "(D)" in str(r.get("Value", "")))
                print(f"  {lvl:<6} {sd[:52]:<52} rows={len(rows)} yrs={yrs} (D)={supp}")
            else:
                print(f"  {lvl:<6} {sd[:52]:<52} NO ROWS (IA census)")


def probe_storage():
    sect("2. STORAGE — re-verify the three known traps")
    for sd, tag in (("GRAIN STORAGE CAPACITY, OFF FARM - CAPACITY, MEASURED IN BU", "off-farm"),
                    ("GRAIN STORAGE CAPACITY, ON FARM - CAPACITY, MEASURED IN BU", "on-farm")):
        rows = count({"short_desc": sd, "agg_level_desc": "STATE", "year__GE": "2020"})
        refs = {}
        ot = 0
        for r in rows:
            refs[r.get("reference_period_desc")] = refs.get(r.get("reference_period_desc"), 0) + 1
            if r.get("state_alpha") == "OT":
                ot += 1
        print(f"  {tag}: {len(rows)} rows 2020+ · ref_periods={refs} · OT pseudo-state rows={ot}")
    rows = count({"short_desc": "CORN, GRAIN - PRODUCTION, MEASURED IN BU",
                  "agg_level_desc": "STATE", "state_alpha": "IA", "year__GE": "2022"})
    refs = sorted({r.get("reference_period_desc") for r in rows})
    print(f"  IA corn production 2022+: {len(rows)} rows, ref_periods={refs}")
    print("  → build rule: filter reference_period_desc='YEAR'; handle OT; pick ONE on-farm ref period and say which")


def probe_cond_yield():
    sect("3. CONDITIONS→YIELD — is an honest fit even there? (IA sample)")
    pairs = []
    for yr in range(2000, 2026):
        ge = count({"short_desc": "CORN - CONDITION, MEASURED IN PCT GOOD",
                    "agg_level_desc": "STATE", "state_alpha": "IA", "year": str(yr)})
        ex = count({"short_desc": "CORN - CONDITION, MEASURED IN PCT EXCELLENT",
                    "agg_level_desc": "STATE", "state_alpha": "IA", "year": str(yr)})
        yl = count({"short_desc": "CORN, GRAIN - YIELD, MEASURED IN BU / ACRE",
                    "agg_level_desc": "STATE", "state_alpha": "IA", "year": str(yr),
                    "reference_period_desc": "YEAR"})
        def wk(rows, w=28):
            # real ISO week, same matcher family as fetch_conditions.py —
            # the earlier month*4+day//7 shortcut wrongly matched late June
            from datetime import datetime as _dt
            for r in rows:
                we = (r.get("week_ending") or "").strip()
                if not we:
                    continue
                try:
                    if abs(_dt.strptime(we, "%Y-%m-%d").isocalendar()[1] - w) <= 1:
                        return float(str(r["Value"]).replace(",", ""))
                except ValueError:
                    continue
            return None
        g, e = wk(ge), wk(ex)
        y = None
        if yl:
            try:
                y = float(str(yl[0]["Value"]).replace(",", ""))
            except (ValueError, KeyError):
                pass
        if g is not None and e is not None and y is not None:
            pairs.append((yr, round(g + e, 1), y))
        time.sleep(0.6)
    print(f"  IA pairs (yr, ~wk28 G+E, final yield): {len(pairs)}")
    for p in pairs[-8:]:
        print(f"    {p}")
    if len(pairs) >= 15:
        xs = [p[1] for p in pairs]; ys = [p[2] for p in pairs]
        n = len(xs); mx = sum(xs) / n; my = sum(ys) / n
        sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        sxx = sum((x - mx) ** 2 for x in xs)
        syy = sum((y - my) ** 2 for y in ys)
        r2 = (sxy * sxy) / (sxx * syy) if sxx and syy else 0
        print(f"  mid-July G+E vs final yield R² = {r2:.3f} "
              f"({'honest to show' if r2 >= 0.3 else 'TOO WEAK — page must say so or wait for later-season weeks'})")


def main():
    print("PROBE EPIC-2 — reads only, writes nothing. Paste the full log back.")
    if not KEY:
        raise SystemExit("FATAL: NASS_API_KEY not set")
    probe_tenure()
    probe_storage()
    probe_cond_yield()
    print("\nDONE — tenure strings, storage traps, and the yield-fit honesty check "
          "decide the next three builds.")


if __name__ == "__main__":
    main()
