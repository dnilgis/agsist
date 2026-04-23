#!/usr/bin/env python3
"""
AGSIST — Rebuild archive HTML pages from archive JSONs
═══════════════════════════════════════════════════════════════════
One-shot utility. Re-renders every /daily/YYYY-MM-DD.html from the
matching /data/daily-archive/YYYY-MM-DD.json using the current
generate_archive_html() template in generate_daily.py.

Run once after deploying generator v3.6 to upgrade the existing
backlog of archive pages. Safe to re-run — idempotent, overwrites.

Usage:
    python scripts/rebuild_archive_html.py           # rebuild all
    python scripts/rebuild_archive_html.py --dry-run # list only
    python scripts/rebuild_archive_html.py 2026-04-20  # one date

Pre-v3.6 archive JSONs don't have chart_series or locked_prices,
so their rebuilt pages show no sparkline row. That's expected.
New briefings written by v3.6 will have sparklines from day one.
"""

import sys
import json
from pathlib import Path

# Import the current template from generate_daily.py
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from generate_daily import generate_archive_html

REPO_ROOT = HERE.parent
ARCHIVE_JSON_DIR = REPO_ROOT / "data" / "daily-archive"
ARCHIVE_HTML_DIR = REPO_ROOT / "daily"


def rebuild_one(date_iso: str, dry_run: bool = False) -> bool:
    json_path = ARCHIVE_JSON_DIR / f"{date_iso}.json"
    html_path = ARCHIVE_HTML_DIR / f"{date_iso}.html"

    if not json_path.exists():
        print(f"  [skip] {date_iso} — no archive JSON at {json_path}")
        return False

    try:
        with open(json_path) as f:
            briefing = json.load(f)
    except json.JSONDecodeError as e:
        print(f"  [err]  {date_iso} — invalid JSON: {e}")
        return False

    if dry_run:
        has_cs = bool(briefing.get("chart_series"))
        has_lp = bool(briefing.get("locked_prices"))
        print(f"  [dry]  {date_iso}  chart_series={has_cs}  locked_prices={has_lp}")
        return True

    html = generate_archive_html(briefing, date_iso)
    ARCHIVE_HTML_DIR.mkdir(parents=True, exist_ok=True)
    with open(html_path, "w") as f:
        f.write(html)
    size_kb = html_path.stat().st_size / 1024
    print(f"  [ok]   {date_iso}  {size_kb:.1f} KB -> {html_path}")
    return True


def main():
    dry_run = "--dry-run" in sys.argv
    explicit_dates = [a for a in sys.argv[1:] if not a.startswith("-")]

    if explicit_dates:
        targets = explicit_dates
        print(f"=== Rebuilding {len(targets)} specified date(s) ===")
    else:
        if not ARCHIVE_JSON_DIR.exists():
            print(f"[error] archive directory missing: {ARCHIVE_JSON_DIR}")
            return 1
        targets = sorted([p.stem for p in ARCHIVE_JSON_DIR.glob("*.json") if p.stem != "index"])
        print(f"=== Rebuilding all {len(targets)} archive page(s) ===")

    if not targets:
        print("  No archive JSONs found.")
        return 0

    ok = 0
    for date_iso in targets:
        if rebuild_one(date_iso, dry_run=dry_run):
            ok += 1

    print(f"=== Done: {ok}/{len(targets)} {'would be rebuilt' if dry_run else 'rebuilt'} ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
