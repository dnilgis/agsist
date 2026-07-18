#!/usr/bin/env python3
"""
update_sitemap.py — bump <lastmod> in sitemap.xml, format-preserving.

Two modes:
  --daily            For the scheduled run. Refreshes only DATA-DRIVEN pages whose
                     declared cadence has elapsed since their last lastmod (so a daily
                     page bumps once a day, a weekly page once a week). Static pages are
                     never touched here — no "lastmod inflation" that trains Google to
                     distrust the sitemap.
  --changed F [F...] For the push run. Bumps any page whose HTML file was just edited,
                     but only if that page already exists in the sitemap (so editing
                     header.html / a partial / a component does nothing).

Never invents URLs. Only rewrites the date text inside existing <lastmod> tags (or
inserts one right after <loc> if a URL somehow lacks it), leaving all other bytes —
indentation, attribute order, the XML declaration — untouched.

Optional: --out PATH writes the list of bumped URLs (one per line) for an IndexNow ping.
Stdlib only.
"""
import argparse
import datetime
import re
from pathlib import Path

HOST = "https://agsist.com"
SITEMAP = "sitemap.xml"

# Pages whose CONTENT genuinely refreshes on a schedule -> path: cadence in days.
# Edit this dict to add/remove auto-refresh pages. Anything not listed is bumped
# only when its own HTML file is edited (the --changed path).
CADENCE = {
    "/": 1,
    "/markets": 1,
    "/cash-bids": 1,
    "/daily": 1,
    "/corn-futures-prices": 1,
    "/soybean-futures-prices": 1,
    "/wheat-futures-prices": 1,
    "/ag-odds": 1,
    "/whats-priced-in": 1,
    "/cattle-futures-prices": 1,
    "/scorecard": 1,
    "/drought-monitor": 7,
    "/cot": 7,
}


def loc_to_path(loc):
    p = loc[len(HOST):] if loc.startswith(HOST) else loc
    return p or "/"


def file_to_url(fpath):
    """Map a repo HTML path to its clean site URL. Root-level pages only."""
    p = Path(fpath)
    if p.suffix.lower() != ".html":
        return None
    # nested files (components/, partials, skills) are not standalone pages
    if p.parent != Path("") and str(p.parent) not in (".", ""):
        return None
    slug = p.stem
    if slug == "index":
        return f"{HOST}/"
    return f"{HOST}/{slug}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--daily", action="store_true")
    ap.add_argument("--changed", nargs="*", default=[])
    ap.add_argument("--out", default=None, help="write bumped URLs here (for IndexNow)")
    ap.add_argument("--priority", default=None,
                    help="priority for URLs inserted by --add (default 0.4, tuned for archive pages)")
    ap.add_argument("--changefreq", default=None,
                    help="changefreq for URLs inserted by --add (default 'never', tuned for archive pages)")
    ap.add_argument("--add", nargs="*", default=[],
                    help="ensure these full URLs exist in the sitemap; insert (lastmod=today) "
                         "if missing, bump lastmod if already present. Used by daily.yml to "
                         "append each new /daily/YYYY-MM-DD archive page.")
    args = ap.parse_args()

    today = datetime.date.today().isoformat()
    td = datetime.date.fromisoformat(today)
    content = Path(SITEMAP).read_text(encoding="utf-8")

    changed_urls = set(u for u in (file_to_url(f) for f in args.changed) if u)
    bumped = []

    def should_bump(loc, cur_lastmod):
        path = loc_to_path(loc)
        if args.daily:
            cad = CADENCE.get(path)
            if not cad:
                return False
            if not cur_lastmod:
                return True
            try:
                age = (td - datetime.date.fromisoformat(cur_lastmod)).days
            except ValueError:
                return True
            return age >= cad
        # push mode
        return loc in changed_urls

    def process(m):
        block = m.group(0)
        loc_m = re.search(r"<loc>\s*(.*?)\s*</loc>", block, re.S)
        if not loc_m:
            return block
        loc = loc_m.group(1).strip()
        lm_m = re.search(r"<lastmod>\s*(.*?)\s*</lastmod>", block, re.S)
        cur = lm_m.group(1).strip() if lm_m else ""
        if cur == today or not should_bump(loc, cur):
            return block
        bumped.append(loc)
        if lm_m:
            return re.sub(r"<lastmod>\s*.*?\s*</lastmod>",
                          f"<lastmod>{today}</lastmod>", block, count=1, flags=re.S)
        # no lastmod present: insert one right after </loc>, matching indated style
        return re.sub(r"</loc>", f"</loc>\n    <lastmod>{today}</lastmod>",
                      block, count=1)

    new = re.sub(r"<url>.*?</url>", process, content, flags=re.S)

    # --add mode: ensure URLs exist. Existing URL -> bump lastmod to today.
    # Missing URL -> insert a new single-line <url> block just before </urlset>,
    # matching the file's existing one-line entry style. Never duplicates.
    for url in args.add:
        url = url.strip().rstrip("/") if url.strip() != HOST + "/" else url.strip()
        if not url:
            continue
        if f"<loc>{url}</loc>" in new:
            def bump_existing(m, _url=url):
                block = m.group(0)
                if f"<loc>{_url}</loc>" not in block:
                    return block
                if f"<lastmod>{today}</lastmod>" in block:
                    return block
                bumped.append(_url)
                return re.sub(r"<lastmod>\s*.*?\s*</lastmod>",
                              f"<lastmod>{today}</lastmod>", block, count=1, flags=re.S)
            new = re.sub(r"<url>.*?</url>", bump_existing, new, flags=re.S)
        else:
            # Defaults are tuned for daily ARCHIVE pages: published once, never
            # revised, low priority. A tool page is neither, so allow an override
            # rather than silently filing /cash-rent as "never changes, 0.4".
            _freq = args.changefreq or "never"
            _pri = args.priority or "0.4"
            entry = (f"  <url><loc>{url}</loc><lastmod>{today}</lastmod>"
                     f"<changefreq>{_freq}</changefreq><priority>{_pri}</priority></url>\n")
            new = new.replace("</urlset>", entry + "</urlset>", 1)
            bumped.append(url)
            print(f"[sitemap] added {url}")

    if bumped:
        Path(SITEMAP).write_text(new, encoding="utf-8")
        print(f"[sitemap] bumped {len(bumped)} lastmod -> {today}:")
        for u in bumped:
            print(f"  {u}")
        if args.out:
            Path(args.out).write_text("\n".join(bumped) + "\n", encoding="utf-8")
    else:
        print("[sitemap] nothing to bump")
        if args.out:
            Path(args.out).write_text("", encoding="utf-8")


if __name__ == "__main__":
    main()
