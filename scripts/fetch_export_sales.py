#!/usr/bin/env python3
"""
fetch_export_sales.py — USDA FAS Weekly Export Sales (Open Data ESR API)
=========================================================================
Source:   FAS Open Data ESR API — https://apps.fas.usda.gov/OpenData/api/esr/
          The legacy apps.fas.usda.gov/export-sales/ HTML pages (esrd1.html,
          esrquery) were DECOMMISSIONED by USDA on June 2, 2026, which is why
          the old HTML-scraping version of this script silently stopped
          updating and the dashboard froze on the early-April report.

Auth:     The ESR API requires a free api.data.gov key.
          1. Get a key (30 seconds): https://api.data.gov/signup
          2. Add it as a GitHub Actions secret named FAS_API_KEY.
          3. In export_sales.yml, expose it to this step:
                 env:
                   FAS_API_KEY: ${{ secrets.FAS_API_KEY }}

Schedule: Thursdays 9:30am CT (export_sales.yml)
Output:   data/export-sales.json

Marketing years:
  Corn & Soybeans:  September 1 – August 31   (ESR marketYear = start year)
  Wheat:            June 1 – May 31            (ESR marketYear = start year)

UPDATING USDA TARGETS
---------------------
After each monthly WASDE, update USDA_TARGETS below (the "Exports" row of the
US Supply & Use tables). Convert million bushels to metric tons:
  corn:     Mbu * 25_401   soybeans/wheat: Mbu * 27_216

VERIFICATION NOTE
-----------------
This rewrite targets the documented FAS Open Data ESR API but could not be
tested against the live endpoint in the build sandbox (USDA egress is blocked
there). It is written to be self-correcting where it can be — it resolves
commodity codes dynamically from /commodities, tries both marketYear
conventions, and auto-detects the 1,000-MT vs MT unit scale — and it logs
every decision verbosely. On first deploy: add the secret, run the workflow
manually, and read the log to confirm the resolved codes, units, and totals.
"""

import json
import os
import sys
import logging
from datetime import date
from pathlib import Path

import requests

# ── Config ──────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_FILE  = REPO_ROOT / 'data' / 'export-sales.json'

API_KEY  = os.environ.get('FAS_API_KEY', '').strip()
# The legacy apps.fas.usda.gov/OpenData host began returning 500s after USDA's
# June 12-14, 2026 server upgrade; the OpenData V2 portal documents the API base
# as api.fas.usda.gov. Try the current host first, fall back to the legacy one.
API_BASES = [
    'https://api.fas.usda.gov/api/esr',
    'https://apps.fas.usda.gov/OpenData/api/esr',
]
_working_base = None

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)s  %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger(__name__)

# ── USDA WASDE Targets (metric tons) — UPDATE AFTER EACH WASDE ──────────────
# Last updated: April 2026 WASDE
USDA_TARGETS = {
    'corn':     57_900_000,   # 2,362 Mbu — April 2026 WASDE
    'soybeans': 52_200_000,   # 1,870 Mbu — April 2026 WASDE
    'wheat':    21_800_000,   #   825 Mbu — April 2026 WASDE
}
MARKETING_YEAR = '2025/26'
# ESR marketYear convention is being confirmed from live diagnostics (the
# parameter may key off the year the MY begins OR ends). Until confirmed, query
# both candidate years, log the structure, and publish only the one whose
# cumulative lands in a plausible range vs. the USDA target.
MKT_YEAR_INT = 2025
CANDIDATE_YEARS = [2025, 2026]
# A commodity's commitments can run a little over the export forecast late in
# the MY, but a figure far above it means the wrong marketYear or a
# double-counted rollup row — never publish those.
PLAUSIBLE_MAX = 130.0

REQUEST_TIMEOUT = 30


def match_commodity(name: str):
    """Map an official ESR commodityName to one of our three keys."""
    n = (name or '').strip().lower()
    if n == 'corn':
        return 'corn'
    if n == 'soybeans':
        return 'soybeans'
    if n in ('all wheat', 'wheat'):
        return 'wheat'
    return None


def api_get(path: str):
    """GET the FAS ESR API. The api.data.gov key goes in the API_KEY header
    (confirmed FAS convention) — no ?api_key= query param, since an unexpected
    query param can itself trigger a 500 on the FAS gateway. The live base host
    is discovered once, then reused for the rest of the run."""
    global _working_base
    headers = {
        'API_KEY': API_KEY,
        'X-Api-Key': API_KEY,
        'Accept': 'application/json',
        'User-Agent': 'AGSIST/1.0 (+https://agsist.com)',
    }
    bases = [_working_base] if _working_base else API_BASES
    last_err = None
    for base in bases:
        try:
            r = requests.get(base + path, headers=headers, timeout=REQUEST_TIMEOUT)
            r.raise_for_status()
            if _working_base != base:
                _working_base = base
                log.info(f'ESR API base: {base}')
            return r.json()
        except Exception as e:
            last_err = e
            log.warning(f'  {base + path} -> {e}')
    raise last_err if last_err else RuntimeError('no ESR base reachable')


def resolve_codes() -> dict:
    """Fetch the ESR commodity list and map our keys → ESR commodityCode.
    Resolving dynamically avoids hardcoding the wrong integer code."""
    data = api_get('/commodities')
    codes = {}
    for rec in data:
        key = match_commodity(rec.get('commodityName', ''))
        code = rec.get('commodityCode')
        if key and key not in codes and code is not None:
            codes[key] = code
            log.info(f'resolved commodity {key:9s} -> code {code} ({rec.get("commodityName")!r})')
    return codes


def _commit(r):
    return float(r.get('currentMYTotalCommitment') or 0)


def _net(r):
    return float(r.get('currentMYNetSales') or 0)


def fetch_year(code, year):
    """Query one (commodityCode, marketYear) and summarize the most recent week.

    Returns a dict with the record count, the latest weekEndingDate, the number
    of records in that week, the summed cumulative commitment and weekly net,
    and the raw latest-week records (kept so the caller can log the top
    destinations and spot any rollup/total rows). Returns None on failure."""
    path = f'/exports/commodityCode/{code}/allCountries/marketYear/{year}'
    try:
        recs = api_get(path)
    except Exception as e:
        log.warning(f'  marketYear {year}: {e}')
        return None
    if not recs:
        return None
    weeks = sorted({r.get('weekEndingDate') for r in recs if r.get('weekEndingDate')})
    if not weeks:
        return None
    latest = weeks[-1]
    lw = [r for r in recs if r.get('weekEndingDate') == latest]
    return {
        'year': year,
        'records': len(recs),
        'latest': latest,
        'latest_n': len(lw),
        'cumulative': sum(_commit(r) for r in lw),
        'weekly': sum(_net(r) for r in lw),
        'lw': lw,
    }


def load_existing() -> dict:
    if OUT_FILE.exists():
        try:
            return json.loads(OUT_FILE.read_text())
        except Exception:
            pass
    return {}


def preserve(existing: dict, today: date):
    """On any live-data failure, keep the last good numbers and only bump the
    fetch timestamp — never overwrite with empty/partial data."""
    if not existing:
        log.error('No existing data and no live data — aborting to avoid empty JSON.')
        sys.exit(1)
    existing['updated'] = today.isoformat()
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(existing, indent=2))
    log.info('Preserved existing commodity data; updated timestamp only.')


def main():
    log.info('=== fetch_export_sales.py (FAS Open Data ESR API) ===')
    today = date.today()
    existing = load_existing()

    if not API_KEY:
        log.error('FAS_API_KEY is not set. Get a free key at https://api.data.gov/signup '
                  'and add it as the FAS_API_KEY GitHub secret.')
        return preserve(existing, today)

    try:
        codes = resolve_codes()
    except Exception as e:
        log.error(f'/commodities request failed: {e}')
        return preserve(existing, today)

    missing = [k for k in ('corn', 'soybeans', 'wheat') if k not in codes]
    if missing:
        log.error(f'Could not resolve ESR commodity codes for {missing} (got {codes}). '
                  'Check /commodities output and adjust match_commodity().')
        return preserve(existing, today)

    out = {
        'updated':        today.isoformat(),
        'marketing_year': MARKETING_YEAR,
        'note':           'USDA FAS ESR API — api.fas.usda.gov/api/esr',
    }
    report_dates = []
    any_live = False

    for comm in ('corn', 'soybeans', 'wheat'):
        target = USDA_TARGETS[comm]
        candidates = []
        for yr in CANDIDATE_YEARS:
            info = fetch_year(codes[comm], yr)
            if not info:
                continue
            # ESR API may report in 1,000 MT; scale up if ~1000x too small.
            scale = 1000 if (info['cumulative'] and info['cumulative'] < target / 10) else 1
            info['cumul']  = round(info['cumulative'] * scale)
            info['weekly_mt'] = round(info['weekly'] * scale)
            info['scale']  = scale
            info['pct']    = round(info['cumul'] / target * 100, 1) if info['cumul'] else None
            # DIAGNOSTIC: dump structure so the marketYear convention can be
            # confirmed and any rollup/total row (e.g. "TOTAL KNOWN"/"UNKNOWN")
            # inflating the sum can be spotted from the top destinations.
            top = sorted(info['lw'], key=_commit, reverse=True)[:4]
            topstr = ' | '.join(
                f"{(r.get('countryName') or r.get('country') or r.get('countryDescription') or '?').strip()}"
                f"={_commit(r):,.0f}" for r in top
            )
            log.info(
                f'  [{comm} MY{yr}] recs={info["records"]} latestWk={str(info["latest"])[:10]} '
                f'latestRecs={info["latest_n"]} cumul={info["cumul"]:,} pct={info["pct"]}% '
                f'scale={scale}x  top: {topstr}'
            )
            candidates.append(info)

        # Publish the plausible candidate (1%..PLAUSIBLE_MAX of target) with the
        # most recent week. If none is plausible, keep the last good numbers
        # rather than push an impossible figure to the public dashboard.
        plausible = [c for c in candidates
                     if c['pct'] is not None and 1.0 <= c['pct'] <= PLAUSIBLE_MAX]
        pick = max(plausible, key=lambda c: c['latest']) if plausible else None

        if not pick:
            saw = [(c['year'], c['pct']) for c in candidates]
            log.warning(f'{comm}: no plausible marketYear (saw {saw}) — preserving existing')
            if comm in existing:
                out[comm] = existing[comm]
                out[comm]['updated'] = today.isoformat()
            continue

        rd = str(pick['latest'])[:10]
        report_dates.append(rd)
        out[comm] = {
            'weekly_net_mt':  pick['weekly_mt'],
            'cumulative_mt':  pick['cumul'],
            'usda_target_mt': target,
            'pct_of_target':  pick['pct'],
            'report_date':    rd,
        }
        any_live = True
        log.info(
            f'{comm:9s} -> MY{pick["year"]}  wk={pick["weekly_mt"]:>12,} MT  '
            f'cumul={pick["cumul"]:>12,} MT  pct={pick["pct"]}%  week={rd}'
        )

    if not any_live:
        log.warning('No live commodity data at all — preserving existing.')
        return preserve(existing, today)

    out['report_date'] = max(report_dates) if report_dates else today.isoformat()

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(out, indent=2))
    log.info(f'\u2713 Wrote {OUT_FILE}  (report week {out["report_date"]})')


if __name__ == '__main__':
    main()
