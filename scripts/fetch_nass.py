#!/usr/bin/env python3
"""
scripts/fetch_nass.py — AGSIST NASS Data Pre-fetcher
Fetches key USDA NASS Quick Stats datasets and writes JSON to data/nass/.
Runs weekly via GitHub Actions. Requires NASS_API_KEY environment variable.

Add to .github/workflows/fetch-nass.yml — see bottom of this file.

Output format (state-level):
  { "updated": "...", "label": "...", "unit": "BU / ACRE",
    "type": "state", "years": ["2015",...],
    "rows": [{"state": "ILLINOIS", "values": {"2015":"168.0",...}}] }

Output format (national):
  { "updated": "...", "label": "...", "unit": "$ / BU",
    "type": "national", "years": ["2015",...], "values": {"2015":"3.83",...} }
"""

import os, json, time, urllib.request, urllib.parse
from datetime import datetime, timezone

API_KEY  = os.environ.get('NASS_API_KEY', '')
BASE_URL = 'https://quickstats.nass.usda.gov/api/api_GET/'
YEAR_FROM = 2015   # Fetch from this year forward
OUT_DIR   = 'data/nass'

DATASETS = [
    {
        'file':  'corn-yield',
        'label': 'Corn Yield',
        'geo':   'STATE',
        'params': {
            'commodity_desc':      'CORN',
            'statisticcat_desc':   'YIELD',
            'prodn_practice_desc': 'ALL PRODUCTION PRACTICES',
            'util_practice_desc':  'GRAIN',
            'agg_level_desc':      'STATE',
            'year__GE':            str(YEAR_FROM),
        }
    },
    {
        'file':  'soy-yield',
        'label': 'Soybean Yield',
        'geo':   'STATE',
        'params': {
            'commodity_desc':    'SOYBEANS',
            'statisticcat_desc': 'YIELD',
            'agg_level_desc':    'STATE',
            'year__GE':          str(YEAR_FROM),
        }
    },
    {
        'file':  'wheat-yield',
        'label': 'Wheat Yield',
        'geo':   'STATE',
        'params': {
            'commodity_desc':    'WHEAT',
            'statisticcat_desc': 'YIELD',
            'agg_level_desc':    'STATE',
            'year__GE':          str(YEAR_FROM),
        }
    },
    {
        'file':  'corn-acres',
        'label': 'Corn Area Planted',
        'geo':   'STATE',
        'params': {
            'commodity_desc':    'CORN',
            'statisticcat_desc': 'AREA PLANTED',
            'agg_level_desc':    'STATE',
            'year__GE':          str(YEAR_FROM),
        }
    },
    {
        'file':  'soy-acres',
        'label': 'Soybean Area Planted',
        'geo':   'STATE',
        'params': {
            'commodity_desc':    'SOYBEANS',
            'statisticcat_desc': 'AREA PLANTED',
            'agg_level_desc':    'STATE',
            'year__GE':          str(YEAR_FROM),
        }
    },
    {
        'file':  'corn-price',
        'label': 'Corn Price Received',
        'geo':   'NATIONAL',
        'params': {
            'commodity_desc':    'CORN',
            'statisticcat_desc': 'PRICE RECEIVED',
            'agg_level_desc':    'NATIONAL',
            'year__GE':          str(YEAR_FROM),
            'freq_desc':         'ANNUAL',
        }
    },
    {
        'file':  'soy-price',
        'label': 'Soybean Price Received',
        'geo':   'NATIONAL',
        'params': {
            'commodity_desc':    'SOYBEANS',
            'statisticcat_desc': 'PRICE RECEIVED',
            'agg_level_desc':    'NATIONAL',
            'year__GE':          str(YEAR_FROM),
            'freq_desc':         'ANNUAL',
        }
    },
]

SKIP_VALUES = {'(D)', '(Z)', '(NA)', '(H)', ''}


def fetch_records(params: dict) -> list:
    p = dict(params)
    p['key']    = API_KEY
    p['format'] = 'JSON'
    url = BASE_URL + '?' + urllib.parse.urlencode(p)
    req = urllib.request.Request(url, headers={'User-Agent': 'AGSIST/1.0 (+https://agsist.com)'})
    with urllib.request.urlopen(req, timeout=45) as resp:
        return json.loads(resp.read()).get('data', [])


def pivot_state(records: list, label: str) -> dict:
    """Transform raw records into state × year pivot."""
    unit   = records[0].get('unit_desc', '') if records else ''
    states: dict = {}
    for r in records:
        val = r.get('Value', '').strip()
        if val in SKIP_VALUES:
            continue
        state = r.get('state_name', 'UNKNOWN').title()
        yr    = str(r['year'])
        states.setdefault(state, {})[yr] = val
    years = sorted({yr for s in states.values() for yr in s})
    rows  = [{'state': s, 'values': states[s]} for s in sorted(states)]
    return {
        'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'label':   label,
        'unit':    unit,
        'type':    'state',
        'years':   years,
        'rows':    rows,
    }


def pivot_national(records: list, label: str) -> dict:
    """Transform raw records into year → value dict."""
    unit   = records[0].get('unit_desc', '') if records else ''
    values = {}
    for r in records:
        val = r.get('Value', '').strip()
        if val not in SKIP_VALUES:
            values[str(r['year'])] = val
    years = sorted(values)
    return {
        'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'label':   label,
        'unit':    unit,
        'type':    'national',
        'years':   years,
        'values':  values,
    }


def main():
    if not API_KEY:
        print('ERROR: NASS_API_KEY environment variable not set.')
        print('  Register at https://quickstats.nass.usda.gov/api/')
        raise SystemExit(1)

    os.makedirs(OUT_DIR, exist_ok=True)

    for ds in DATASETS:
        print(f"Fetching {ds['label']}…")
        try:
            records = fetch_records(ds['params'])
            print(f"  → {len(records)} records")
            if not records:
                print('  → No records returned, skipping.')
                continue

            if ds['geo'] == 'NATIONAL':
                output = pivot_national(records, ds['label'])
            else:
                output = pivot_state(records, ds['label'])

            out_path = f"{OUT_DIR}/{ds['file']}.json"
            with open(out_path, 'w') as f:
                json.dump(output, f, separators=(',', ':'))
            n = len(output.get('rows', output.get('values', [])))
            print(f"  → Written to {out_path} ({n} state/year entries)")
            time.sleep(1.5)   # rate-limit courtesy

        except Exception as exc:
            print(f"  ERROR: {exc}")
            continue

    print('Done.')


if __name__ == '__main__':
    main()


# ─── GitHub Actions workflow ───────────────────────────────────────────────
# Save as .github/workflows/fetch-nass.yml
#
# name: Fetch NASS Data
# on:
#   schedule:
#     - cron: '0 7 * * 0'   # Sundays 7 AM UTC (~2 AM CT) — NASS data rarely changes daily
#   workflow_dispatch:        # Allow manual run from GitHub Actions tab
# jobs:
#   fetch:
#     runs-on: ubuntu-latest
#     steps:
#       - uses: actions/checkout@v4
#       - uses: actions/setup-python@v5
#         with:
#           python-version: '3.11'
#       - name: Fetch NASS datasets
#         run: python3 scripts/fetch_nass.py
#         env:
#           NASS_API_KEY: ${{ secrets.NASS_API_KEY }}
#       - name: Commit updated data
#         run: |
#           git config user.name 'github-actions[bot]'
#           git config user.email 'github-actions[bot]@users.noreply.github.com'
#           git add data/nass/
#           git diff --staged --quiet || git commit -m 'data: update NASS datasets'
#           git push
# ──────────────────────────────────────────────────────────────────────────
