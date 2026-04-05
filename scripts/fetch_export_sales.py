#!/usr/bin/env python3
"""
fetch_export_sales.py — USDA FAS Weekly Export Sales
=====================================================
Source:   https://apps.fas.usda.gov/export-sales/
Schedule: Thursdays 9:30am CT (export_sales.yml)
Output:   data/export-sales.json

HOW THE FAS DATA WORKS
-----------------------
The USDA FAS Export Sales Reporting (ESR) system publishes cumulative
marketing-year export commitments every Thursday at 8:30am ET.
"Commitments" = outstanding sales (unshipped) + accumulated inspections.

Marketing years:
  Corn & Soybeans:  September 1 – August 31
  Wheat:            June 1 – May 31

UPDATING USDA TARGETS
----------------------
After each monthly WASDE report, update the USDA_TARGETS dict below.
Source: https://www.usda.gov/oce/commodity/wasde/
Look for "Exports" row in the US Supply and Use tables.
Convert million bushels to metric tons:
  corn:     bu * 25.401 kg/bu = MT
  soybeans: bu * 27.216 kg/bu = MT
  wheat:    bu * 27.216 kg/bu = MT
"""

import json
import os
import sys
import time
import logging
from datetime import datetime, date, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ── Config ──────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_FILE  = REPO_ROOT / 'data' / 'export-sales.json'

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)s  %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger(__name__)

# ── USDA WASDE Targets (metric tons) — UPDATE AFTER EACH WASDE ──────────────
# Last updated: April 2026 WASDE
USDA_TARGETS = {
    'corn':     57_900_000,   # 2,362 Mbushels — April 2026 WASDE
    'soybeans': 52_200_000,   # 1,870 Mbushels — April 2026 WASDE
    'wheat':    21_800_000,   #   825 Mbushels — April 2026 WASDE
}
MARKETING_YEAR = '2025/26'

# Marketing year start dates (to calculate weeks elapsed)
MKT_YEAR_START = {
    'corn':     date(2025, 9, 1),
    'soybeans': date(2025, 9, 1),
    'wheat':    date(2025, 6, 1),
}

# FAS ESR commodity codes
FAS_COMMODITY_CODES = {
    'corn':     '0401000',
    'soybeans': '2222000',
    'wheat':    '0410000',
}

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; AGSIST/1.0; +https://agsist.com)',
    'Accept': 'application/json, text/html, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://apps.fas.usda.gov/export-sales/',
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


# ── Strategy 1: FAS PSO Online API for cumulative data ──────────────────────

def fetch_via_pso_api(commodity_key: str) -> dict | None:
    """
    Try the FAS PSO Online API. This gives Supply & Distribution data
    including total exports for the current marketing year.
    Returns the latest available weekly cumulative data if present.
    """
    code = FAS_COMMODITY_CODES[commodity_key]
    mkt_year = int(MARKETING_YEAR.split('/')[0])
    url = (
        f'https://apps.fas.usda.gov/psdonline/api/psd/yearlyData'
        f'?commodityCode={code}'
        f'&marketYear={mkt_year}'
        f'&countryCode=000'
        f'&freqCode=A'
    )
    try:
        r = SESSION.get(url, timeout=20)
        r.raise_for_status()
        records = r.json()
        # Find export total for this marketing year
        for rec in records:
            if rec.get('attributeId') in (125, 176):  # exports or export sales
                val = rec.get('value')
                if val:
                    # PSO API value is in 1000 MT
                    cumulative_mt = float(val) * 1000
                    log.info(f'PSO API  {commodity_key}: cumulative {cumulative_mt:,.0f} MT')
                    return {'cumulative_mt': cumulative_mt}
    except Exception as e:
        log.warning(f'PSO API failed for {commodity_key}: {e}')
    return None


# ── Strategy 2: FAS ESR weekly report HTML ──────────────────────────────────

def fetch_via_esr_html() -> dict | None:
    """
    Try to parse the FAS ESR-D1 (weekly export sales by destination) HTML page.
    The FAS web app may render a data table server-side in some configurations.
    Returns dict keyed by commodity with {weekly_net_mt, cumulative_mt} or None.
    """
    url = 'https://apps.fas.usda.gov/export-sales/esrd1.html'
    try:
        r = SESSION.get(url, timeout=30)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, 'html.parser')

        # Look for a data table (structure varies by FAS version)
        tables = soup.find_all('table')
        if not tables:
            log.warning('ESR HTML: no tables found — page may be JS-rendered')
            return None

        results = {}
        commodity_map = {
            'corn':     ['corn', '0401000'],
            'soybeans': ['soybean', 'soybeans', '2222000'],
            'wheat':    ['wheat', '0410000'],
        }

        for table in tables:
            rows = table.find_all('tr')
            for row in rows:
                cells = [td.get_text(strip=True) for td in row.find_all(['td', 'th'])]
                if len(cells) < 3:
                    continue
                row_text = ' '.join(cells).lower()
                for comm_key, aliases in commodity_map.items():
                    if comm_key in results:
                        continue
                    if any(alias in row_text for alias in aliases):
                        # Try to extract the last two numeric cells
                        nums = []
                        for cell in cells:
                            clean = cell.replace(',', '').replace('(', '-').replace(')', '')
                            try:
                                nums.append(float(clean))
                            except ValueError:
                                pass
                        if len(nums) >= 2:
                            # Assume: weekly net, cumulative (in 1000 MT or MT)
                            # FAS typically reports in metric tons
                            weekly = nums[-2] if len(nums) >= 2 else None
                            cumul  = nums[-1]
                            # Convert from 1000 MT if values seem too small
                            if cumul < 100_000:
                                weekly = weekly * 1000 if weekly else None
                                cumul  = cumul * 1000
                            results[comm_key] = {
                                'weekly_net_mt': weekly,
                                'cumulative_mt': cumul,
                            }
                            log.info(f'ESR HTML {comm_key}: wk={weekly:,.0f} cumul={cumul:,.0f}')

        return results if results else None

    except Exception as e:
        log.warning(f'ESR HTML fetch failed: {e}')
        return None


# ── Strategy 3: FAS internal JSON API ───────────────────────────────────────

def fetch_via_esr_api() -> dict | None:
    """
    Try the FAS internal API that their web application may call.
    The endpoint path is inferred from typical USDA FAS app patterns.
    """
    mkt_year = int(MARKETING_YEAR.split('/')[0])
    today = date.today()
    # Find most recent Thursday
    days_back = (today.weekday() - 3) % 7  # 3 = Thursday
    last_thu = today - timedelta(days=days_back)
    report_date_str = last_thu.strftime('%Y-%m-%d')

    endpoints_to_try = [
        f'https://apps.fas.usda.gov/export-sales/api/esrd1/weekly?marketYear={mkt_year}',
        f'https://apps.fas.usda.gov/export-sales/api/weekly?marketYear={mkt_year}&reportDate={report_date_str}',
        f'https://apps.fas.usda.gov/export-sales/esrd1/data?my={mkt_year}',
    ]

    for url in endpoints_to_try:
        try:
            r = SESSION.get(url, timeout=20)
            if r.status_code == 200:
                data = r.json()
                log.info(f'ESR API hit: {url}')
                # Try to extract commodity data from whatever structure returns
                results = {}
                comm_map = {'corn': 'corn', 'soybean': 'soybeans', 'wheat': 'wheat'}
                if isinstance(data, list):
                    for item in data:
                        name = str(item.get('commodity', item.get('name', ''))).lower()
                        for k, v in comm_map.items():
                            if k in name:
                                results[v] = {
                                    'weekly_net_mt': item.get('weeklyNet', item.get('weekly_net')),
                                    'cumulative_mt': item.get('cumulative', item.get('cumulativeTotal')),
                                }
                if results:
                    return results
        except Exception:
            pass

    log.warning('ESR API: all endpoint attempts failed')
    return None


# ── Pace calculation ─────────────────────────────────────────────────────────

def calc_pct(cumulative_mt: float, commodity: str) -> float:
    target = USDA_TARGETS.get(commodity, 1)
    return round(cumulative_mt / target * 100, 1)


# ── Load existing data (don't overwrite on failure) ──────────────────────────

def load_existing() -> dict:
    if OUT_FILE.exists():
        try:
            return json.loads(OUT_FILE.read_text())
        except Exception:
            pass
    return {}


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    log.info('=== fetch_export_sales.py starting ===')
    today = date.today()

    # Find last Thursday (FAS report day)
    days_back = (today.weekday() - 3) % 7
    last_thu = today - timedelta(days=days_back)
    report_date_str = last_thu.strftime('%Y-%m-%d')

    # Load existing so we can fall back
    existing = load_existing()

    # ── Try strategies in order ──────────────────────────────────────────────
    esr_data = None

    log.info('Strategy 1: FAS ESR API endpoints')
    esr_data = fetch_via_esr_api()

    if not esr_data:
        log.info('Strategy 2: FAS ESR HTML report')
        esr_data = fetch_via_esr_html()

    if not esr_data:
        log.warning('All live strategies failed. Keeping existing data and updating date only.')
        if not existing:
            log.error('No existing data and no live data. Aborting to avoid empty JSON.')
            sys.exit(1)
        # Update just the fetch timestamp; keep all commodity data as-is
        existing['updated'] = today.isoformat()
        OUT_FILE.write_text(json.dumps(existing, indent=2))
        log.info(f'Wrote preserved data → {OUT_FILE}')
        return

    # ── Build output JSON ────────────────────────────────────────────────────
    output = {
        'updated':        today.isoformat(),
        'report_date':    report_date_str,
        'marketing_year': MARKETING_YEAR,
        'note':           'USDA FAS Weekly Export Sales — automated',
    }

    for comm in ('corn', 'soybeans', 'wheat'):
        comm_data = esr_data.get(comm, {})

        cumul   = comm_data.get('cumulative_mt')
        weekly  = comm_data.get('weekly_net_mt')

        # Fall back to existing per-commodity data if this commodity missed
        if cumul is None and comm in existing:
            log.warning(f'{comm}: no live data, using existing')
            output[comm] = existing[comm]
            output[comm]['updated'] = today.isoformat()
            continue

        target = USDA_TARGETS[comm]
        pct    = round(cumul / target * 100, 1) if cumul else None

        output[comm] = {
            'weekly_net_mt':  round(weekly)   if weekly else None,
            'cumulative_mt':  round(cumul)    if cumul  else None,
            'usda_target_mt': target,
            'pct_of_target':  pct,
            'report_date':    report_date_str,
        }

        log.info(
            f'{comm:10s}  wk={weekly and f"{weekly/1e6:.2f}M MT" or "—"}  '
            f'cumul={cumul and f"{cumul/1e6:.1f}M" or "—"}  pace={pct}%'
        )

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(output, indent=2))
    log.info(f'✓ Wrote {OUT_FILE}')


if __name__ == '__main__':
    main()
