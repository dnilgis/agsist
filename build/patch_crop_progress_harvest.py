#!/usr/bin/env python3
"""2026-10-01: corn and soybean harvest pace in data/crop-progress.json.

The October homepage leads with harvest progress, and the feed only carried
planting and condition for corn and soybeans. This adds, from the same NASS
QuickStats call style the wheat rows already use:
  harvest_pct        latest PCT HARVESTED
  harvest_date       its week ending
  harvest_prev_year  last year's PCT HARVESTED for the same week (the row whose
                     week ending is nearest to 364 days earlier, within 4 days;
                     otherwise null). Not last year's final number.
  mature_pct         corn only, latest PCT MATURE (soybeans have no "mature"
                     category in NASS; nothing is relabelled)
Fail-soft like the wheat block: a harvest fetch error leaves these null and
never blocks the write.

Usage: python3 patch_crop_progress_harvest.py --repo DIR
"""
import argparse, os, sys

MARK = '2026-10-01 harvest pace'


def once(t, old, new, label):
    n = t.count(old)
    if n != 1:
        sys.exit('ANCHOR %s matched %d times, expected 1' % (label, n))
    return t.replace(old, new)


HELPER = '''def is_in_season() -> bool:'''
HELPER_NEW = '''def same_week_prev(rows: list[dict], cur_date: str | None) -> int | None:
    """%s: last year's value for the week nearest to 364 days before
    cur_date (within 4 days), not last year's final number."""
    if not cur_date:
        return None
    try:
        target = datetime.strptime(cur_date, "%%Y-%%m-%%d") - timedelta(days=364)
    except ValueError:
        return None
    best = None
    for r in rows:
        try:
            wk = datetime.strptime(r.get("week_ending", ""), "%%Y-%%m-%%d")
            val = int(str(r.get("Value", "")).replace(",", "").strip())
        except ValueError:
            continue
        gap = abs((wk - target).days)
        if gap <= 4 and (best is None or gap < best[0]):
            best = (gap, val)
    return best[1] if best else None


def is_in_season() -> bool:'''.replace('%%', '%').replace('%s', MARK)

BLOCK = '''        # Set overall report date from corn
        if key == "corn" and cur:'''
BLOCK_NEW = '''        # Harvest pace (%s). Fail-soft: null on any error.
        try:
            h_rows = fetch_progress(commodity, year, "PCT HARVESTED")
            h_cur = latest_planting(h_rows)
            h_prev_rows = fetch_progress(commodity, year1, "PCT HARVESTED") if h_cur else []
            result[key]["harvest_pct"] = h_cur["pct"] if h_cur else None
            result[key]["harvest_date"] = h_cur["date"] if h_cur else None
            result[key]["harvest_prev_year"] = same_week_prev(h_prev_rows, h_cur["date"]) if h_cur else None
            if commodity == "CORN":
                m_cur = latest_planting(fetch_progress(commodity, year, "PCT MATURE"))
                result[key]["mature_pct"] = m_cur["pct"] if m_cur else None
            print(f"  Harvested: {result[key]['harvest_pct']}% (same week last year {result[key]['harvest_prev_year']}%)", flush=True)
        except Exception as e:
            print(f"  {commodity} harvest fetch failed (non-fatal): {e}", flush=True)
            for k in ("harvest_pct", "harvest_date", "harvest_prev_year"):
                result[key].setdefault(k, None)

        # Set overall report date from corn
        if key == "corn" and cur:'''.replace('%s', MARK)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True)
    a = ap.parse_args()
    p = os.path.join(a.repo, 'scripts/fetch_crop_progress.py')
    t = open(p, encoding='utf-8', newline='').read()
    if MARK in t:
        sys.exit('already applied')
    t = once(t, HELPER, HELPER_NEW, 'helper')
    t = once(t, BLOCK, BLOCK_NEW, 'corn/soy block')
    open(p, 'w', encoding='utf-8', newline='').write(t)
    print('ok')


if __name__ == '__main__':
    main()
