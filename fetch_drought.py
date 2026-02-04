#!/usr/bin/env python3
"""
Fetch drought data from USDM API for all 50 states.
Saves to data/drought.json for client-side consumption (avoids CORS issues).
Run via GitHub Actions on a weekly schedule (Thursdays after USDM update).
"""

import json
import os
import urllib.request
import urllib.error
from datetime import datetime, timedelta

STATES = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
    'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
    'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
    'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
]

API_BASE = "https://usdmdataservices.unl.edu/api/StateStatistics/GetDroughtSeverityStatisticsByAreaPercent"


def fetch_state(abbr, start_date, end_date):
    """Fetch drought data for a single state."""
    url = f"{API_BASE}?aoi={abbr}&startdate={start_date}&enddate={end_date}&statisticsType=1"
    
    try:
        req = urllib.request.Request(url, headers={
            'Accept': 'application/json',
            'User-Agent': 'AGSIST-DroughtMonitor/1.0'
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        
        if not data:
            return None
        
        # Get most recent entry
        latest = data[-1]
        return {
            'date': latest.get('MapDate') or latest.get('mapDate', ''),
            'none': round(float(latest.get('None') or latest.get('none', 0)), 2),
            'd0': round(float(latest.get('D0') or latest.get('d0', 0)), 2),
            'd1': round(float(latest.get('D1') or latest.get('d1', 0)), 2),
            'd2': round(float(latest.get('D2') or latest.get('d2', 0)), 2),
            'd3': round(float(latest.get('D3') or latest.get('d3', 0)), 2),
            'd4': round(float(latest.get('D4') or latest.get('d4', 0)), 2),
        }
    except Exception as e:
        print(f"  ✗ {abbr}: {e}")
        return None


def main():
    end = datetime.now().strftime('%Y-%m-%d')
    start = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
    
    print(f"Fetching drought data: {start} to {end}")
    
    results = {}
    success = 0
    
    for abbr in STATES:
        data = fetch_state(abbr, start, end)
        if data:
            results[abbr] = data
            in_drought = round(100 - data['none'], 1)
            print(f"  ✓ {abbr}: {in_drought}% in drought (D0+)")
            success += 1
        else:
            print(f"  ✗ {abbr}: no data")
    
    output = {
        'updated': datetime.now().strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': 'USDM via usdmdataservices.unl.edu',
        'states': results
    }
    
    # Ensure data directory exists
    os.makedirs('data', exist_ok=True)
    
    out_path = os.path.join('data', 'drought.json')
    with open(out_path, 'w') as f:
        json.dump(output, f, indent=2)
    
    print(f"\nDone: {success}/{len(STATES)} states → {out_path}")
    
    if success == 0:
        print("WARNING: No states fetched. API may be down.")
        exit(1)


if __name__ == '__main__':
    main()
