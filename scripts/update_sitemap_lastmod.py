#!/usr/bin/env python3
"""
update_sitemap_lastmod.py — bump <lastmod> in sitemap.xml for specified paths.

Usage:
  python scripts/update_sitemap_lastmod.py --paths /daily /cash-bids /
  python scripts/update_sitemap_lastmod.py --html-files index.html daily.html
  python scripts/update_sitemap_lastmod.py --dynamic   # bump high-frequency pages

Exit codes:
  0  — sitemap updated and changed
  2  — sitemap valid but nothing changed (no-op)
  1  — error

Design notes:
- Operates on the sitemap.xml at repo root.
- Date format: YYYY-MM-DD (e.g., 2026-05-29) in America/Chicago timezone.
- Updates are line-level <lastmod>YYYY-MM-DD</lastmod> rewrites — preserves the
  exact whitespace and entry ordering of the existing file. We do NOT round-trip
  through ElementTree because that re-sorts attributes and normalizes whitespace,
  which would create a meaningless full-file diff and reset all the other
  lastmods to their .write() default.

Mapping rules:
- An HTML filename maps to a clean URL by stripping .html, dropping index.html
  (which represents the root /), and treating slashes verbatim:
    index.html         -> /
    daily.html         -> /daily
    legal/terms.html   -> /legal/terms
"""
import argparse
import re
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

# Pages that change daily because of underlying data refreshes, even when the
# HTML file itself is unchanged. Cron schedule bumps these.
DYNAMIC_PATHS = [
    "/",
    "/daily",
    "/archive",
    "/markets",
    "/spray",
    "/cash-bids",
    "/ag-odds",
    "/corn-futures-prices",
    "/soybean-futures-prices",
    "/wheat-futures-prices",
]

# Repo root assumed to be CWD when GH Actions checks out the repo.
SITEMAP_PATH = Path("sitemap.xml")


def html_to_path(filename: str) -> str:
    """Map an HTML file path to its sitemap loc path."""
    # Strip leading ./ if present
    if filename.startswith("./"):
        filename = filename[2:]
    # index.html in root → /
    if filename == "index.html":
        return "/"
    # Nested index.html (e.g., foo/bar/index.html → /foo/bar)
    if filename.endswith("/index.html"):
        return "/" + filename[: -len("/index.html")]
    # Otherwise strip .html
    if filename.endswith(".html"):
        return "/" + filename[:-5]
    # Already a path, normalize
    if not filename.startswith("/"):
        return "/" + filename
    return filename


def today_chicago() -> str:
    """Today's date in America/Chicago tz, ISO format."""
    return datetime.now(ZoneInfo("America/Chicago")).strftime("%Y-%m-%d")


def bump_lastmods(sitemap_text: str, paths: list[str], today: str) -> tuple[str, int]:
    """
    For each path in `paths`, find its <url> entry in sitemap_text and rewrite
    the <lastmod> to `today`. Returns (new_text, num_changed).
    """
    changed = 0
    new_text = sitemap_text

    for path in paths:
        # Build the URL that should match the <loc>
        full_loc = f"https://agsist.com{path}"

        # Pattern: find the <url> block that contains this loc, capture
        # everything up to its <lastmod>, then the lastmod value, then the rest.
        # Sitemap format from Sigurd is single-line <url>...</url>, so each
        # entry is on one line. We rewrite the <lastmod>VALUE</lastmod> token
        # within that line.
        pattern = re.compile(
            r"(<loc>" + re.escape(full_loc) + r"</loc>"
            r"\s*<lastmod>)([0-9-]+)(</lastmod>)"
        )

        def replace(m: re.Match) -> str:
            nonlocal changed
            old_date = m.group(2)
            if old_date == today:
                # Already current — no change
                return m.group(0)
            changed += 1
            return f"{m.group(1)}{today}{m.group(3)}"

        new_text, n = pattern.subn(replace, new_text)
        if n == 0:
            # Path wasn't found in sitemap. Warn but don't fail — missing
            # entries are valid (e.g., dynamic page list includes URLs that
            # may not yet be in sitemap).
            print(f"  [skip] {full_loc} not in sitemap", file=sys.stderr)

    return new_text, changed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--paths",
        nargs="*",
        default=[],
        help="Sitemap paths to bump (e.g., /daily /cash-bids)",
    )
    parser.add_argument(
        "--html-files",
        nargs="*",
        default=[],
        help="HTML filenames to map to paths and bump (e.g., daily.html)",
    )
    parser.add_argument(
        "--dynamic",
        action="store_true",
        help="Bump the hardcoded list of high-frequency dynamic pages",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute changes but don't write the file",
    )
    args = parser.parse_args()

    # Build the union of paths to bump
    paths_to_bump = set(args.paths)
    for f in args.html_files:
        paths_to_bump.add(html_to_path(f))
    if args.dynamic:
        paths_to_bump.update(DYNAMIC_PATHS)

    if not paths_to_bump:
        print("No paths specified — nothing to do.", file=sys.stderr)
        return 2

    # Sanity check the sitemap exists
    if not SITEMAP_PATH.exists():
        print(f"ERROR: {SITEMAP_PATH} not found in CWD ({Path.cwd()})", file=sys.stderr)
        return 1

    text = SITEMAP_PATH.read_text(encoding="utf-8")
    today = today_chicago()

    print(f"Today (America/Chicago): {today}")
    print(f"Paths to bump ({len(paths_to_bump)}): {sorted(paths_to_bump)}")

    new_text, changed = bump_lastmods(text, sorted(paths_to_bump), today)

    if changed == 0:
        print("No lastmod values changed (already current or not in sitemap).")
        return 2

    if args.dry_run:
        print(f"[DRY RUN] Would change {changed} lastmod entries.")
        return 0

    SITEMAP_PATH.write_text(new_text, encoding="utf-8")
    print(f"Updated {changed} lastmod entries in {SITEMAP_PATH}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
