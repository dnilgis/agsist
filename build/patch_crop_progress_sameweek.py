#!/usr/bin/env python3
"""2026-10-01: "vs last year" in data/crop-progress.json means the same week.

scripts/fetch_crop_progress.py compared this year's latest crop condition,
planting and wheat harvest against LAST YEAR'S FINAL week (it took the latest
row of the prior year). In July that set this year's rating against last
October's. Now each prior-year figure is last year's week nearest 364 days
before this year's week (within 4 days), via same_week_prev(), which
patch_crop_progress_harvest.py adds. Also drops silage rows from the corn
harvested query so only grain corn counts.

Run after patch_crop_progress_harvest.py.
Usage: python3 patch_crop_progress_sameweek.py --repo DIR
"""
import argparse, os, sys

MARK = '2026-10-01 same-week'


def once(t, old, new, label):
    n = t.count(old)
    if n != 1:
        sys.exit('ANCHOR %s matched %d times, expected 1' % (label, n))
    return t.replace(old, new)


GE_HELPER = '''def ge_same_week_prev(rows: list[dict], cur_date: str | None) -> int | None:
    """MARK: good + excellent for last year's week nearest 364 days before
    cur_date (within 4 days), not last year's final week."""
    if not cur_date:
        return None
    by_week: dict[str, int] = {}
    for r in rows:
        week = r.get("week_ending", "")
        unit = r.get("unit_desc", "").upper()
        try:
            val = int(str(r.get("Value", "")).replace(",", "").strip())
        except ValueError:
            continue
        if week and ("EXCELLENT" in unit or "GOOD" in unit):
            by_week[week] = by_week.get(week, 0) + val
    return same_week_prev([{"week_ending": w, "Value": str(v)} for w, v in by_week.items()], cur_date)


def is_in_season() -> bool:'''.replace('MARK', MARK)

FIXES = [
    ('def is_in_season() -> bool:', GE_HELPER, 'helper'),
    ('            "good_excellent_prev_year": prev["good_excellent"] if prev else None,\n'
     '            "planting_pct":             lp_cur["pct"] if lp_cur else None,\n'
     '            "planting_prev_year":       lp_prev["pct"] if lp_prev else None,',
     '            "good_excellent_prev_year": ge_same_week_prev(cond_prev, cur["date"]) if cur else None,\n'
     '            "planting_pct":             lp_cur["pct"] if lp_cur else None,\n'
     '            "planting_prev_year":       same_week_prev(plant_prev, lp_cur["date"]) if lp_cur else None,',
     'corn/soy prev year'),
    ('            h_prev = latest_planting(fetch_progress("WHEAT", year1, prog_unit, class_desc=cls))',
     '            h_prev_rows = fetch_progress("WHEAT", year1, prog_unit, class_desc=cls)',
     'wheat prev rows'),
    ('                "good_excellent_prev_year": prev["good_excellent"] if prev else None,\n'
     '                "harvest_pct":              h_cur["pct"] if h_cur else None,\n'
     '                "harvest_prev_year":        h_prev["pct"] if h_prev else None,',
     '                "good_excellent_prev_year": ge_same_week_prev(cond_prev, cur["date"]) if cur else None,\n'
     '                "harvest_pct":              h_cur["pct"] if h_cur else None,\n'
     '                "harvest_prev_year":        same_week_prev(h_prev_rows, h_cur["date"]) if h_cur else None,',
     'wheat prev year'),
    ('            h_rows = fetch_progress(commodity, year, "PCT HARVESTED")',
     '            h_rows = [r for r in fetch_progress(commodity, year, "PCT HARVESTED")\n'
     '                      if "SILAGE" not in str(r.get("short_desc", "")).upper()]',
     'grain only (cur)'),
    ('            h_prev_rows = fetch_progress(commodity, year1, "PCT HARVESTED") if h_cur else []',
     '            h_prev_rows = [r for r in fetch_progress(commodity, year1, "PCT HARVESTED")\n'
     '                           if "SILAGE" not in str(r.get("short_desc", "")).upper()] if h_cur else []',
     'grain only (prev)'),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True)
    a = ap.parse_args()
    p = os.path.join(a.repo, 'scripts/fetch_crop_progress.py')
    t = open(p, encoding='utf-8', newline='').read()
    if MARK in t:
        sys.exit('already applied')
    if 'def same_week_prev(' not in t:
        sys.exit('run patch_crop_progress_harvest.py first')
    for old, new, label in FIXES:
        t = once(t, old, new, label)
    open(p, 'w', encoding='utf-8', newline='').write(t)
    print('ok')


if __name__ == '__main__':
    main()
