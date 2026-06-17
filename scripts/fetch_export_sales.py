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
# ESR marketYear = the calendar year the marketing year BEGINS.
# Bump this when the new MY opens (corn/beans early September; wheat June).
MKT_YEAR_INT = 2025

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


def latest_week_totals(records):
    """Sum currentMYTotalCommitment (cumulative) and currentMYNetSales (weekly
    net) across all destination countries for the most recent weekEndingDate."""
    if not records:
        return None
    weeks = [r.get('weekEndingDate') for r in records if r.get('weekEndingDate')]
    if not weeks:
        return None
    latest = max(weeks)
    cumul = 0.0
    weekly = 0.0
    for r in records:
        if r.get('weekEndingDate') != latest:
            continue
        cumul  += float(r.get('currentMYTotalCommitment') or 0)
        weekly += float(r.get('currentMYNetSales') or 0)
    return {'week_ending': latest, 'cumulative': cumul, 'weekly': weekly}


def fetch_commodity(code):
    """Query the ESR API for a commodity, trying both marketYear conventions
    (start-year and end-year) and keeping whichever has the most recent week."""
    best = None
    for yr in (MKT_YEAR_INT, MKT_YEAR_INT + 1):
        path = f'/exports/commodityCode/{code}/allCountries/marketYear/{yr}'
        try:
            recs = api_get(path)
        except Exception as e:
            log.warning(f'  marketYear {yr}: {e}')
            continue
        tot = latest_week_totals(recs)
        if tot and (best is None or tot['week_ending'] > best['week_ending']):
            tot['market_year'] = yr
            best = tot
    return best


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
        'note':           'USDA FAS Open Data ESR API — apps.fas.usda.gov/OpenData/api/esr',
    }
    report_dates = []
    any_live = False

    for comm in ('corn', 'soybeans', 'wheat'):
        tot = fetch_commodity(codes[comm])
        if not tot or not tot['cumulative']:
            if comm in existing:
                log.warning(f'{comm}: no live data — preserving existing values')
                out[comm] = existing[comm]
                out[comm]['updated'] = today.isoformat()
            else:
                log.warning(f'{comm}: no live data and no existing fallback')
            continue

        target = USDA_TARGETS[comm]
        # ESR API may return values in 1,000 MT. Cumulative commitments should be
        # a large fraction of the full-year target; if it's ~1000x too small,
        # the API is reporting thousand-MT and we scale up.
        scale = 1000 if (tot['cumulative'] and tot['cumulative'] < target / 10) else 1
        cumul  = round(tot['cumulative'] * scale)
        weekly = round(tot['weekly'] * scale)
        rd = str(tot['week_ending'])[:10]
        report_dates.append(rd)
        pct = round(cumul / target * 100, 1) if cumul else None

        out[comm] = {
            'weekly_net_mt':  weekly,
            'cumulative_mt':  cumul,
            'usda_target_mt': target,
            'pct_of_target':  pct,
            'report_date':    rd,
        }
        any_live = True
        log.info(
            f'{comm:9s} wk={weekly:>12,} MT  cumul={cumul:>12,} MT  '
            f'pct={pct}%  week_ending={rd}  MY={tot.get("market_year")}  scale={scale}x'
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
