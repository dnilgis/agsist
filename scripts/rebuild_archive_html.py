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
    python scripts/rebuild_archive_html.py --stamp-only  # only the line under the quote strip
    python scripts/rebuild_archive_html.py --byline-only # only the byline (reply address)
    python scripts/rebuild_archive_html.py --guard-only  # only the inline Google Analytics guard script
    python scripts/rebuild_archive_html.py --cta-only    # only the cash-bids line under the byline
    python scripts/rebuild_archive_html.py --text-only 2026-10-16  # only what an archive JSON edit changed
    python scripts/rebuild_archive_html.py --links-only  # only links to pages merged into another (moved_pages.py)
    python scripts/rebuild_archive_html.py --text-only --base=HEAD~1 2026-10-16  # JSON already committed

--links-only (2026-10-28, page merges) sends every link to a page that was
merged into another (scripts/moved_pages.py: /archive, /scorecard, ...) to its
new home, and the breadcrumb's archive step to the Daily page, the same as
generate_daily.py writes for a new issue. Every other byte stays as published.

--cta-only (2026-10-29, layout shift) does the same for the one cash-bids link
under the byline: its space before the arrow moved inside the arrow's span, so
no lone space sits between two inline tags (test/stray-space.test.mjs).

--byline-only does the same for the one <div class="dv3-byline"> line (the
reply address under each issue, changed 2026-10-22 to sig@agsist.com).

--guard-only does the same for the one inline <script>/* agsist-ga-guard
... */</script> in the head (2026-10-27: its long comment became a pointer to
components/ga-gate.js; the code is the same, the page keeps every other byte).

--stamp-only renders each page as above but writes back only the
<div class="dv3-quote-asof"> line, so a published page keeps every other
byte (2026-10-17 audit N2: a full rebuild of the 33 pages that said "not CME
settlements" would also have changed their quote links, styles and scripts).

--text-only (2026-10-27, dated corrections) is for a hand edit to an archive
JSON: a corrected line plus its note in 'corrections'. It renders the JSON as
committed (git HEAD) and as it is now with the same current template, takes
only the spans that differ, and writes each into the published page where its
surrounding text matches exactly once. Every other byte of the page stays as
published. A span it cannot place exactly once stops that page unchanged.

Pre-v3.6 archive JSONs don't have chart_series or locked_prices,
so their rebuilt pages show no sparkline row. That's expected.
New briefings written by v3.6 will have sparklines from day one.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass

import re
import sys
import json
from pathlib import Path

# Import the current template from generate_daily.py
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from generate_daily import generate_archive_html, archive_neighbor_dates
from moved_pages import repoint

REPO_ROOT = HERE.parent
ARCHIVE_JSON_DIR = REPO_ROOT / "data" / "daily-archive"
ARCHIVE_HTML_DIR = REPO_ROOT / "daily"


def _no_em_dashes(obj):
    """Older archive JSONs predate sanitize_em_dashes; the published pages had
    their em dashes taken out by hand, so a rebuild must not put them back.
    Em dashes only: en dashes in ranges stay."""
    if isinstance(obj, dict):
        return {k: _no_em_dashes(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_no_em_dashes(v) for v in obj]
    if isinstance(obj, str):
        return re.sub(r",\s*,", ",", re.sub(r"(?<=\S)[ \t]*\u2014[ \t]*(?=\S)", ", ", obj)).replace("\u2014 ", "").replace("\u2014", "")
    return obj


STAMP_RE = re.compile(r'<div class="dv3-quote-asof">[^<]*</div>')
BYLINE_RE = re.compile(r'<div class="dv3-byline">(?:(?!</?div)[\s\S])*</div>')
GUARD_RE = re.compile(r'<script>/\* agsist-ga-guard [^<]*</script>')
CTA_RE = re.compile(r'<a class="dv3-cashbids-cta"[^>]*>(?:(?!</a>)[\s\S])*</a>')


def swap_stamp(old_html: str, new_html: str, rx=STAMP_RE):
    """old_html with its one quote-strip stamp line (or the line rx finds)
    taken from new_html. None when either page has no such line or more than one."""
    a, b = rx.findall(old_html), rx.findall(new_html)
    if len(a) != 1 or len(b) != 1:
        return None
    return old_html.replace(a[0], b[0], 1)


_TOKEN_RE = re.compile(r"<[^>]*>|[^<\s]+|\s+")


def patch_text(published: str, old_render: str, new_render: str, ctx: int = 12):
    """published with every span where new_render differs from old_render
    applied. Renders are compared as tags, words and spaces. Each change is
    placed by its old text plus rendered text on each side (up to ctx tokens a
    side, fewer when the template around it has moved on), and that anchor must
    occur exactly once in published. None when any change cannot be placed."""
    import difflib
    ot, nt = _TOKEN_RE.findall(old_render), _TOKEN_RE.findall(new_render)
    sm = difflib.SequenceMatcher(None, ot, nt, autojunk=False)
    groups = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        if groups and i1 - groups[-1][1] <= 4:  # a few shared words apart: one change
            groups[-1] = [groups[-1][0], i2, groups[-1][2], j2]
        else:
            groups.append([i1, i2, j1, j2])
    out = published
    for i1, i2, j1, j2 in groups:
        old_mid, new_mid = "".join(ot[i1:i2]), "".join(nt[j1:j2])
        placed = False
        for kl, kr in sorted(((l, r) for l in range(ctx + 1) for r in range(ctx + 1) if l + r >= 2),
                             key=lambda lr: -(lr[0] + lr[1])):
            left, right = "".join(ot[max(0, i1 - kl):i1]), "".join(ot[i2:i2 + kr])
            anchor = left + old_mid + right
            # a pure insert needs real text on both sides to know where it goes
            if not old_mid and (not left.strip() or not right.strip()):
                continue
            if out.count(anchor) == 1:
                out = out.replace(anchor, left + new_mid + right, 1)
                placed = True
                break
        if not placed:
            return None
    return out


def _committed_json(json_path: Path, base: str = "HEAD"):
    import subprocess
    rel = json_path.resolve().relative_to(REPO_ROOT)
    try:
        raw = subprocess.run(["git", "-C", str(REPO_ROOT), "show", f"{base}:{rel.as_posix()}"],
                             capture_output=True, text=True, check=True).stdout
        return json.loads(raw)
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        return None


def rebuild_one(date_iso: str, dry_run: bool = False, stamp_only: bool = False,
                byline_only: bool = False, text_only: bool = False,
                base: str = "HEAD", guard_only: bool = False, cta_only: bool = False) -> bool:
    json_path = ARCHIVE_JSON_DIR / f"{date_iso}.json"
    html_path = ARCHIVE_HTML_DIR / f"{date_iso}.html"

    if not json_path.exists():
        print(f"  [skip] {date_iso} — no archive JSON at {json_path}")
        return False

    try:
        with open(json_path) as f:
            briefing = _no_em_dashes(json.load(f))
    except json.JSONDecodeError as e:
        print(f"  [err]  {date_iso} — invalid JSON: {e}")
        return False

    if dry_run:
        has_cs = bool(briefing.get("chart_series"))
        has_lp = bool(briefing.get("locked_prices"))
        print(f"  [dry]  {date_iso}  chart_series={has_cs}  locked_prices={has_lp}")
        return True

    prev_d, next_d = archive_neighbor_dates(date_iso)
    # og_require_file: a dated social card exists only from 2026-07-18. Without
    # this a full rebuild pointed 126 published pages at a PNG that does not
    # exist, breaking a preview image that was working.
    html = generate_archive_html(briefing, date_iso, prev_d, next_d,
                                 og_require_file=True)
    if text_only:
        old_json = _committed_json(json_path, base)
        if old_json is None or not html_path.exists():
            print(f"  [skip] {date_iso}: no committed JSON or no published page")
            return False
        old_html = generate_archive_html(_no_em_dashes(old_json), date_iso, prev_d, next_d,
                                         og_require_file=True)
        if old_html == html:
            print(f"  [ok]   {date_iso}  JSON unchanged, page left as is")
            return True
        pub = html_path.read_text()
        out = patch_text(pub, old_html, html)
        if out is None:
            print(f"  [err]  {date_iso}: a changed span does not match the published page once; page left as is")
            return False
        html_path.write_text(out)
        print(f"  [ok]   {date_iso}  changed text written into the published page")
        return True
    if stamp_only or byline_only or guard_only or cta_only:
        rx, what = ((STAMP_RE, "stamp") if stamp_only else (BYLINE_RE, "byline") if byline_only
                    else (CTA_RE, "cash-bids") if cta_only else (GUARD_RE, "ga guard"))
        if not html_path.exists():
            print(f"  [skip] {date_iso} — no published page")
            return False
        old = html_path.read_text()
        out = swap_stamp(old, html, rx)
        if out is None:
            print(f"  [skip] {date_iso} — no single {what} line to swap")
            return False
        if out != old:
            html_path.write_text(out)
            print(f"  [ok]   {date_iso}  {what} line swapped")
        return True
    ARCHIVE_HTML_DIR.mkdir(parents=True, exist_ok=True)
    with open(html_path, "w") as f:
        f.write(html)
    size_kb = html_path.stat().st_size / 1024
    print(f"  [ok]   {date_iso}  {size_kb:.1f} KB -> {html_path}")
    return True


LINK_RE = re.compile(r'(href=")((?:https://agsist\.com)?/[^"]*)(")')
CRUMB_OLD = '"name": "Daily briefing archive", "item": "https://agsist.com/archive"'
CRUMB_NEW = '"name": "Daily briefing", "item": "https://agsist.com/daily"'
CRUMB_RE = re.compile(r'("name":\s*)"Daily briefing archive"(,\s*"item":\s*)"https://agsist\.com/archive"')


def repoint_links(page: str) -> str:
    """--links-only: links to merged pages go to their new home; nothing else changes."""
    page = CRUMB_RE.sub(r'\1"Daily briefing"\2"https://agsist.com/daily"', page)
    return LINK_RE.sub(lambda m: m.group(1) + repoint(m.group(2)) + m.group(3), page)


def links_only_all(targets) -> int:
    n = 0
    for date_iso in targets:
        p = ARCHIVE_HTML_DIR / f"{date_iso}.html"
        if not p.exists():
            continue
        old = p.read_text()
        new = repoint_links(old)
        if new != old:
            p.write_text(new)
            n += 1
    print(f"=== links-only: {n} published page(s) repointed ===")
    return 0


def selftest() -> int:
    lp = ('<a class="dv3-archnav-a dv3-archnav-all" href="/archive">All briefings</a> <a href="/scorecard">x</a> '
          '<a href="/daily/2026-10-01">y</a> {"@type": "ListItem", "position": 2, ' + CRUMB_OLD + '}')
    lo = repoint_links(lp)
    assert 'href="/daily#past">All briefings' in lo and 'href="/usda-calendar#scorecard"' in lo, lo
    assert 'href="/daily/2026-10-01"' in lo and CRUMB_NEW in lo and "/archive" not in lo, lo
    assert repoint_links(lo) == lo
    ml = '"position": 2,\n      "name": "Daily briefing archive",\n      "item": "https://agsist.com/archive"\n'
    assert repoint_links(ml) == '"position": 2,\n      "name": "Daily briefing",\n      "item": "https://agsist.com/daily"\n'

    old = '<div class="a">Hogs sat flat at $75.55.</div><p>same</p><aside></aside><nav>x</nav>'
    new = '<div class="a">December hogs settled at $66.925.</div><p>same</p><aside>Correction</aside><nav>x</nav>'
    pub = '<style>new css</style>' + old + '<script>v=2</script>'
    out = patch_text(pub, old, new)
    assert out == '<style>new css</style>' + new + '<script>v=2</script>', out
    # an anchor found twice, or not at all, leaves the page alone
    assert patch_text(old + old, old, new) is None
    assert patch_text('<div class="a">other text</div>', old, new) is None
    assert patch_text(pub, old, old) == pub
    # --guard-only: only the guard script moves, every other byte stays
    g_old = '<head><script>/* agsist-ga-guard 2026-10-20b: long words */(function(){})();</script><p>kept</p>'
    g_new = '<head><script>/* agsist-ga-guard 2026-10-20b: short */(function(){})();</script><p>new</p>'
    assert swap_stamp(g_old, g_new, GUARD_RE) == g_new.replace("<p>new</p>", "<p>kept</p>")
    assert swap_stamp(g_old + g_old, g_new, GUARD_RE) is None
    print("rebuild_archive_html selftest: ok")
    return 0


def main():
    if "--selftest" in sys.argv:
        return selftest()
    dry_run = "--dry-run" in sys.argv
    stamp_only = "--stamp-only" in sys.argv
    byline_only = "--byline-only" in sys.argv
    guard_only = "--guard-only" in sys.argv
    cta_only = "--cta-only" in sys.argv
    text_only = "--text-only" in sys.argv
    # --base=<ref>: the commit whose JSON the published page was made from (default HEAD)
    base = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--base=")), "HEAD")
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
    if "--links-only" in sys.argv:
        return links_only_all(targets)

    ok = 0
    for date_iso in targets:
        if rebuild_one(date_iso, dry_run=dry_run, stamp_only=stamp_only, byline_only=byline_only,
                       text_only=text_only, base=base, guard_only=guard_only, cta_only=cta_only):
            ok += 1

    print(f"=== Done: {ok}/{len(targets)} {'would be rebuilt' if dry_run else 'rebuilt'} ===")
    if text_only and ok < len(targets):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
