#!/usr/bin/env python3
"""
probe_sources.py — look before building.

WHY THIS EXISTS
  USDA blocks my sandbox (403 host_not_allowed) and the Socrata Foundry docs
  render client-side, so the column names for these datasets cannot be read from
  outside. GitHub Actions CAN reach USDA. So rather than guess field names and
  ship pipelines that die on their first real run, this walks every source we
  intend to build on and prints exactly what is there: columns, types, sample
  rows, row counts, date ranges, and the distinct keys we would filter on.

  It writes nothing and commits nothing. It is a telescope, not a pipeline.

  It also RE-VALIDATES the short_desc strings that fetch_cash_rent.py already
  depends on. That pipeline has never run against live NASS either; if a
  short_desc is wrong, the same mistake is about to be copied into two more
  pipelines. Better to find out once, here.

USAGE
  python scripts/probe_sources.py                 # everything
  python scripts/probe_sources.py --only nass     # nass | agtransport
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter

UA = {"User-Agent": "AGSIST-probe/1.0 (+https://agsist.com; sig@farmers1st.com)"}

# ---------------------------------------------------------------- AgTransport
# Socrata (SODA2). Public read: no key required, app token only raises limits.
# IDs harvested from the AgTransport catalogue pages.
AGT_HOST = "https://agtransport.usda.gov"
AGT = {
    "grain_basis":        "v85y-3hep",   # local cash - futures, by origin/destination
    "grain_prices":       "g92w-8cn7",   # cash + futures prices, origins & export positions
    "grain_price_spreads": "an4w-mnp7",  # interior -> export position spreads ($/bu)
    "barge_rates":        "deqi-uken",   # downbound barge rates, 7 river segments
    "transport_cost_idx": "8uye-ieij",   # truck/rail/barge/ocean indices, 2017=100
}

# ---------------------------------------------------------------------- NASS
NASS = "https://quickstats.nass.usda.gov/api/api_GET/"

# Candidate short_desc strings. Several spellings are tried per concept because
# NASS naming is not guessable and a near-miss returns zero rows rather than an
# error -- the exact failure mode that hides for months.
NASS_PROBES = [
    # --- already relied on by fetch_cash_rent.py (validate, do not assume) ---
    ("cash_rent_nonirr", "RENT, CASH, CROPLAND, NON-IRRIGATED - EXPENSE, MEASURED IN $ / ACRE", "COUNTY", None),
    ("cash_rent_irr",    "RENT, CASH, CROPLAND, IRRIGATED - EXPENSE, MEASURED IN $ / ACRE", "COUNTY", None),
    ("cash_rent_pasture", "RENT, CASH, PASTURE - EXPENSE, MEASURED IN $ / ACRE", "COUNTY", None),
    ("yield_corn_county", "CORN, GRAIN - YIELD, MEASURED IN BU / ACRE", "COUNTY", None),
    ("yield_beans_county", "SOYBEANS - YIELD, MEASURED IN BU / ACRE", "COUNTY", None),
    ("price_recd_corn",  "CORN, GRAIN - PRICE RECEIVED, MEASURED IN $ / BU", "STATE", "MARKETING YEAR"),
    ("price_recd_beans", "SOYBEANS - PRICE RECEIVED, MEASURED IN $ / BU", "STATE", "MARKETING YEAR"),

    # --- TOOL 2: crop conditions -> yield ---------------------------------
    ("cond_corn_excellent", "CORN - CONDITION, MEASURED IN PCT EXCELLENT", "STATE", None),
    ("cond_corn_good",      "CORN - CONDITION, MEASURED IN PCT GOOD", "STATE", None),
    ("cond_corn_fair",      "CORN - CONDITION, MEASURED IN PCT FAIR", "STATE", None),
    ("cond_corn_poor",      "CORN - CONDITION, MEASURED IN PCT POOR", "STATE", None),
    ("cond_corn_verypoor",  "CORN - CONDITION, MEASURED IN PCT VERY POOR", "STATE", None),
    ("cond_beans_excellent", "SOYBEANS - CONDITION, MEASURED IN PCT EXCELLENT", "STATE", None),
    ("yield_corn_state",    "CORN, GRAIN - YIELD, MEASURED IN BU / ACRE", "STATE", None),
    ("yield_beans_state",   "SOYBEANS - YIELD, MEASURED IN BU / ACRE", "STATE", None),

    # --- TOOL 3: storage capacity vs production ---------------------------
    ("cap_off_farm", "GRAIN STORAGE CAPACITY, OFF FARM - CAPACITY, MEASURED IN BU", "STATE", None),
    ("cap_on_farm",  "GRAIN STORAGE CAPACITY, ON FARM - CAPACITY, MEASURED IN BU", "STATE", None),
    ("prod_corn_state",  "CORN, GRAIN - PRODUCTION, MEASURED IN BU", "STATE", None),
    ("prod_beans_state", "SOYBEANS - PRODUCTION, MEASURED IN BU", "STATE", None),
    ("stocks_corn_onfarm", "CORN, GRAIN - STOCKS, MEASURED IN BU", "STATE", None),
]


def out(*a):
    print(*a, flush=True)


def hr(t):
    out("\n" + "=" * 78)
    out("  " + t)
    out("=" * 78)


def get(url, timeout=90):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def probe_agtransport():
    hr("AGTRANSPORT (Socrata / SODA2) — no API key required for public reads")
    for name, ds in AGT.items():
        out(f"\n--- {name}  [{ds}]  {AGT_HOST}/resource/{ds}.json")
        try:
            rows = json.loads(get(f"{AGT_HOST}/resource/{ds}.json?$limit=3"))
        except urllib.error.HTTPError as e:
            out(f"    HTTP {e.code} — {e.read()[:180].decode('utf-8','replace')}")
            continue
        except Exception as e:
            out(f"    FAILED: {type(e).__name__}: {e}")
            continue
        if not rows:
            out("    returned 0 rows")
            continue

        cols = list(rows[0].keys())
        out(f"    COLUMNS ({len(cols)}): {cols}")
        out("    SAMPLE ROW:")
        for k, v in rows[0].items():
            out(f"      {k:<28} = {str(v)[:60]}")

        # row count
        try:
            n = json.loads(get(f"{AGT_HOST}/resource/{ds}.json?$select=count(*)"))
            out(f"    ROW COUNT: {list(n[0].values())[0]}")
        except Exception as e:
            out(f"    row count failed: {e}")

        # date range + distinct keys on likely columns
        for dc in [c for c in cols if any(w in c.lower() for w in ("date", "week", "period", "year"))][:2]:
            try:
                r = json.loads(get(f"{AGT_HOST}/resource/{ds}.json?$select=min({dc}),max({dc})"))
                out(f"    RANGE {dc}: {r[0]}")
            except Exception:
                pass
        for kc in [c for c in cols if any(w in c.lower() for w in
                   ("commodity", "origin", "destination", "location", "region", "mode", "measure", "type", "unit"))][:4]:
            try:
                r = json.loads(get(f"{AGT_HOST}/resource/{ds}.json?$select={kc}&$group={kc}&$limit=40"))
                vals = [x.get(kc) for x in r]
                out(f"    DISTINCT {kc} ({len(vals)}): {vals[:22]}")
            except Exception:
                pass


def nass_call(key, short_desc, agg, refperiod, extra=None):
    q = {"key": key, "short_desc": short_desc, "agg_level_desc": agg,
         "year__GE": "2000", "format": "JSON"}
    if refperiod:
        q["reference_period_desc"] = refperiod
    q.update(extra or {})
    return get(NASS + "?" + urllib.parse.urlencode(q), timeout=180)


def probe_nass():
    hr("NASS QUICK STATS — validating every short_desc before anything is built on it")
    key = os.environ.get("NASS_API_KEY", "").strip()
    if not key:
        out("  NASS_API_KEY not set — skipping. (Repo secret exists; add it to the workflow env.)")
        return

    for name, sd, agg, rp in NASS_PROBES:
        label = f"{name:<22} [{agg}]"
        try:
            body = nass_call(key, sd, agg, rp)
        except urllib.error.HTTPError as e:
            msg = e.read()[:200].decode("utf-8", "replace").replace("\n", " ")
            # NASS answers "no rows match" with 400 — that means the short_desc is WRONG
            out(f"  {label} HTTP {e.code}  <-- {'SHORT_DESC NOT FOUND / no rows' if e.code == 400 else msg}")
            out(f"      tried: {sd!r}")
            continue
        except Exception as e:
            out(f"  {label} FAILED: {type(e).__name__}: {e}")
            continue

        try:
            data = json.loads(body).get("data", [])
        except json.JSONDecodeError:
            out(f"  {label} unparseable: {body[:120]}")
            continue
        if not data:
            out(f"  {label} 0 rows  <-- short_desc likely wrong: {sd!r}")
            continue

        yrs = sorted({int(r["year"]) for r in data if str(r.get("year", "")).isdigit()})
        st = {r.get("state_alpha") for r in data}
        freq = Counter(r.get("freq_desc") for r in data)
        ref = Counter(r.get("reference_period_desc") for r in data)
        sup = sum(1 for r in data if str(r.get("Value", "")).strip().startswith("("))
        out(f"  {label} OK  rows={len(data):>6}  years={yrs[0]}-{yrs[-1]}  states={len(st)}  "
            f"suppressed={sup} ({sup / len(data) * 100:.1f}%)")
        out(f"      freq={dict(freq)}  ref_period={dict(list(ref.items())[:4])}")
        if name.startswith("cond_") or name.startswith("cap_"):
            r0 = data[0]
            out(f"      sample: year={r0.get('year')} state={r0.get('state_alpha')} "
                f"period={r0.get('reference_period_desc')}/{r0.get('begin_code')} Value={r0.get('Value')}")
            out(f"      keys: {sorted(r0.keys())}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", choices=["", "nass", "agtransport"])
    a = ap.parse_args()
    out("PROBE — reading sources, writing nothing.")
    if a.only in ("", "agtransport"):
        probe_agtransport()
    if a.only in ("", "nass"):
        probe_nass()
    hr("DONE — paste this whole log back and the pipelines get built against reality")


if __name__ == "__main__":
    main()
