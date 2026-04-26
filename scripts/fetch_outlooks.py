#!/usr/bin/env python3
"""
fetch_outlooks.py v1 — pull NOAA outlook GIFs + USDM map locally so the homepage
isn't at the mercy of upstream browser-cache headers.

Why:
- NOAA serves /products/predictions/30day/off15_*.gif at static URLs that update
  ~twice a month. Browsers cache the GIF aggressively. Adding ?v= to bust the
  cache breaks NOAA's server (returns errors). So we mirror the file locally
  and let GitHub Pages cache rules govern freshness instead.
- USDM publishes /data/png/{YYYYMMDD}/{YYYYMMDD}_usdm.png each Thursday at
  ~8:30am ET for the prior Tuesday's data. If a browser hits the URL Tue/Wed
  or before 8:30am Thu, it 404s and the page falls back to the prior week's
  map — which then sticks in the browser's image cache.

What this writes (always relative to repo root):
  data/outlooks/noaa_temp_30day.gif
  data/outlooks/noaa_prcp_30day.gif
  data/outlooks/noaa_temp_90day.gif
  data/outlooks/noaa_prcp_90day.gif
  data/outlooks/usdm_latest.png
  data/outlooks/manifest.json    (fetched_at, sources, sha256 per file)

Idempotent: if upstream bytes haven't changed, the file isn't rewritten — so a
git diff after running this only shows the files NOAA/USDM actually updated.
"""

import hashlib
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR   = REPO_ROOT / 'data' / 'outlooks'
USER_AGENT = 'AGSIST-OutlookFetcher/1 (+https://agsist.com; sig@farmers1st.com)'
TIMEOUT_S = 30

NOAA_BASE = 'https://www.cpc.ncep.noaa.gov/products/predictions/'
NOAA_TARGETS = [
    ('noaa_temp_30day.gif', NOAA_BASE + '30day/off15_temp.gif'),
    ('noaa_prcp_30day.gif', NOAA_BASE + '30day/off15_prcp.gif'),
    ('noaa_temp_90day.gif', NOAA_BASE + 'long_range/lead01/off01_temp.gif'),
    ('noaa_prcp_90day.gif', NOAA_BASE + 'long_range/lead01/off01_prcp.gif'),
]

# Magic-number checks: refuse to write a "GIF" or "PNG" if upstream actually
# served us an HTML error page (NOAA 404s as text/html, not as a real .gif).
GIF_MAGIC = (b'GIF87a', b'GIF89a')
PNG_MAGIC = b'\x89PNG\r\n\x1a\n'


def fetch(url):
    """GET url, return bytes. Raise on any non-200."""
    req = Request(url, headers={'User-Agent': USER_AGENT, 'Accept': '*/*'})
    with urlopen(req, timeout=TIMEOUT_S) as resp:
        if resp.status != 200:
            raise RuntimeError(f'HTTP {resp.status} for {url}')
        return resp.read()


def looks_like(content, expected):
    """expected: 'gif' or 'png'."""
    if expected == 'gif':
        return any(content.startswith(m) for m in GIF_MAGIC)
    if expected == 'png':
        return content.startswith(PNG_MAGIC)
    return False


def write_if_changed(path, content):
    """Write content only if it differs from what's on disk. Returns True if written."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() == content:
        return False
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_bytes(content)
    tmp.replace(path)
    return True


def fetch_noaa(out_name, url):
    """Try to grab a NOAA GIF. Returns (status_str, bytes_or_none)."""
    try:
        content = fetch(url)
    except (HTTPError, URLError, RuntimeError) as e:
        return (f'fetch-failed: {e}', None)
    if not looks_like(content, 'gif'):
        return (f'wrong-content-type: first 8 bytes = {content[:8]!r}', None)
    return ('ok', content)


def candidate_usdm_dates(now_utc):
    """
    Return USDM data-valid Tuesdays to try, most-recent first.

    USDM cuts data Tuesday 7am ET, releases map Thursday 8:30am ET. That's
    13:30 UTC during EDT (UTC-4) and 14:30 UTC during EST (UTC-5). To stay
    on the safe side without a tz library, we treat "Thursday 14:30 UTC" as
    the publish boundary (i.e. don't try this-week's Tuesday until then).
    """
    weekday = now_utc.weekday()  # Mon=0, Tue=1, ..., Sun=6
    days_since_tue = (weekday - 1) % 7
    this_tue = (now_utc - timedelta(days=days_since_tue)).date()

    # Has this-week's Thursday 14:30 UTC passed?
    this_thu_publish = datetime.combine(
        this_tue + timedelta(days=2),
        datetime.min.time(),
        tzinfo=timezone.utc,
    ) + timedelta(hours=14, minutes=30)

    candidates = []
    if now_utc >= this_thu_publish:
        candidates.append(this_tue)
    # Always include the prior 4 Tuesdays as fallbacks
    for i in range(1, 5):
        candidates.append(this_tue - timedelta(days=7 * i))
    return candidates


def fetch_usdm():
    """Try the most recent released Tuesday, falling back week-by-week."""
    now_utc = datetime.now(timezone.utc)
    last_err = None
    for d in candidate_usdm_dates(now_utc):
        ymd = d.strftime('%Y%m%d')
        url = f'https://droughtmonitor.unl.edu/data/png/{ymd}/{ymd}_usdm.png'
        try:
            content = fetch(url)
        except (HTTPError, URLError, RuntimeError) as e:
            last_err = f'{ymd}: {e}'
            continue
        if not looks_like(content, 'png'):
            last_err = f'{ymd}: wrong-content-type'
            continue
        return (d.isoformat(), url, content)
    return (None, None, None) if last_err is None else ('error', last_err, None)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        'fetched_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'files': {},
    }
    any_change = False
    any_failure = False

    # NOAA
    for out_name, url in NOAA_TARGETS:
        status, content = fetch_noaa(out_name, url)
        entry = {'source': url, 'status': status}
        if content is not None:
            path = OUT_DIR / out_name
            changed = write_if_changed(path, content)
            entry['bytes']  = len(content)
            entry['sha256'] = hashlib.sha256(content).hexdigest()
            entry['changed'] = changed
            any_change = any_change or changed
            print(f'{"updated" if changed else "unchanged"}: {out_name} ({len(content):,} B)')
        else:
            any_failure = True
            print(f'FAILED:    {out_name} — {status}', file=sys.stderr)
        manifest['files'][out_name] = entry

    # USDM
    valid_date, src_url, content = fetch_usdm()
    entry = {'source': src_url, 'data_valid': valid_date}
    if content is not None and isinstance(content, bytes):
        path = OUT_DIR / 'usdm_latest.png'
        changed = write_if_changed(path, content)
        entry['bytes']  = len(content)
        entry['sha256'] = hashlib.sha256(content).hexdigest()
        entry['changed'] = changed
        entry['status']  = 'ok'
        any_change = any_change or changed
        print(f'{"updated" if changed else "unchanged"}: usdm_latest.png (data valid {valid_date}, {len(content):,} B)')
    else:
        any_failure = True
        entry['status'] = f'failed: {src_url}'  # carries last error string
        print(f'FAILED:    usdm_latest.png — {src_url}', file=sys.stderr)
    manifest['files']['usdm_latest.png'] = entry

    # Manifest is always rewritten so fetched_at advances; that's fine — it's tiny.
    (OUT_DIR / 'manifest.json').write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + '\n',
        encoding='utf-8',
    )

    print()
    print(f'change-detected={"yes" if any_change else "no"}')
    print(f'any-failure={"yes" if any_failure else "no"}')
    # Exit 0 even on partial failures — we want the workflow to commit whatever
    # did succeed, not abort the whole run because one upstream was down.
    return 0


if __name__ == '__main__':
    sys.exit(main())
