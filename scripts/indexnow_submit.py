#!/usr/bin/env python3
"""
indexnow_submit.py - Submit URLs to the IndexNow API.

Reads the IndexNow key from a *.txt file at the repo root whose
filename (minus extension) matches its content (32+ hex chars).
By default reads every "Sitemap:" line in robots.txt (sitemap.xml,
sitemap-atlas.xml, sitemap-cash-bids.xml, sitemap-arc-plc.xml, ...), takes
each sitemap from the repo checkout when the file is there and from the
deployed site otherwise, follows sitemap index files, and POSTs the URLs to
https://api.indexnow.org/IndexNow in batches of at most 10,000 (the
protocol's per-request limit). Before 2026-10-09 it read sitemap.xml only,
so the ~2,800 ARC/PLC pages and the town and atlas pages were never sent.

It does not track which URLs changed since the last run; the daily run sends
every URL in the sitemaps, as it always has.

Usage:
    python scripts/indexnow_submit.py
    python scripts/indexnow_submit.py --urls https://agsist.com/foo https://agsist.com/bar
    python scripts/indexnow_submit.py --root /path/to/repo
    python scripts/indexnow_submit.py --dry-run     # list counts, send nothing
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

HOST = "agsist.com"
SITEMAP_URL = f"https://{HOST}/sitemap.xml"
INDEXNOW_ENDPOINT = "https://api.indexnow.org/IndexNow"
KEY_FILE_PATTERN = re.compile(r"^[a-f0-9]{8,128}\.txt$", re.IGNORECASE)
USER_AGENT = "AGSIST-IndexNow-Submitter/1.0"
MAX_PER_REQUEST = 10_000  # IndexNow accepts up to 10,000 URLs per POST
SM_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


def find_key_file(repo_root: Path):
    """Return (key, key_location_url) by scanning repo root."""
    for entry in sorted(repo_root.iterdir()):
        if not entry.is_file():
            continue
        if not KEY_FILE_PATTERN.match(entry.name):
            continue
        key = entry.stem
        try:
            content = entry.read_text(encoding="utf-8").strip()
        except Exception as e:
            print(f"[warn] could not read {entry.name}: {e}", file=sys.stderr)
            continue
        if content == key:
            return key, f"https://{HOST}/{entry.name}"
        print(
            f"[warn] {entry.name} content does not match filename; skipping",
            file=sys.stderr,
        )
    raise SystemExit(
        "ERROR: no valid IndexNow key file (matching .txt at repo root) found"
    )


def robots_sitemaps(repo_root: Path):
    """Sitemap URLs named in robots.txt (repo copy); sitemap.xml if none."""
    found = []
    robots = repo_root / "robots.txt"
    if robots.is_file():
        for line in robots.read_text(encoding="utf-8").splitlines():
            m = re.match(r"\s*sitemap\s*:\s*(\S+)", line, re.I)
            if m and m.group(1) not in found:
                found.append(m.group(1))
    return found or [SITEMAP_URL]


def _sitemap_body(url, repo_root: Path):
    """Bytes of one sitemap: the checkout's file when present, else fetched."""
    path = urllib.parse.urlparse(url).path.lstrip("/")
    local = repo_root / path if path else None
    if local and local.is_file() and local.resolve().is_relative_to(repo_root):
        print(f"[info] reading {path} from the checkout")
        return local.read_bytes()
    print(f"[info] fetching {url}")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def sitemap_urls(url, repo_root: Path, _seen=None):
    """<loc> URLs on HOST in one sitemap, following sitemap index files."""
    _seen = set() if _seen is None else _seen
    if url in _seen:
        return []
    _seen.add(url)
    try:
        root = ET.fromstring(_sitemap_body(url, repo_root))
    except ET.ParseError as e:
        raise SystemExit(f"ERROR: {url} is not valid XML: {e}")
    locs = [el.text.strip() for el in root.iter() if el.tag in (SM_NS + "loc", "loc") and el.text]
    if root.tag in (SM_NS + "sitemapindex", "sitemapindex"):
        out = []
        for child in locs:
            out += sitemap_urls(child, repo_root, _seen)
        return out
    # Filter to this host only (defensive against accidental external URLs)
    return [u for u in locs if urllib.parse.urlparse(u).hostname == HOST]


def fetch_sitemap_urls(repo_root: Path):
    """Every page URL from every sitemap robots.txt lists."""
    urls = []
    for sm in robots_sitemaps(repo_root):
        got = sitemap_urls(sm, repo_root)
        print(f"[info] {sm}: {len(got)} URL(s)")
        urls += got
    return urls


def chunks(urls, size=MAX_PER_REQUEST):
    """Split into POST-sized batches (never more than the protocol limit)."""
    size = max(1, min(size, MAX_PER_REQUEST))
    return [urls[i:i + size] for i in range(0, len(urls), size)]


def submit(key, key_location, urls):
    """POST URL list to IndexNow. Returns HTTP status code."""
    payload = {
        "host": HOST,
        "key": key,
        "keyLocation": key_location,
        "urlList": urls,
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        INDEXNOW_ENDPOINT,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            status = resp.status
            text = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        status = e.code
        text = e.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as e:
        print(f"[error] network error: {e}", file=sys.stderr)
        return 0

    print(f"[result] HTTP {status}")
    if text.strip():
        print(f"[result] body: {text[:500]}")
    return status


def main():
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument(
        "--urls",
        nargs="*",
        help="Specific URLs to submit (default: full sitemap)",
    )
    parser.add_argument(
        "--root",
        default=".",
        help="Repo root containing the IndexNow key file (default: cwd)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Collect and batch the URLs, print the counts, send nothing",
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    key, key_location = find_key_file(root)
    print(f"[info] key file: {key_location}")

    if args.urls:
        urls = args.urls
    else:
        urls = fetch_sitemap_urls(root)

    if not urls:
        print("[error] no URLs to submit", file=sys.stderr)
        return 1

    # Deduplicate while preserving order
    seen = set()
    deduped = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            deduped.append(u)

    print(f"[info] submitting {len(deduped)} URL(s)")
    preview_count = min(10, len(deduped))
    for u in deduped[:preview_count]:
        print(f"  - {u}")
    if len(deduped) > preview_count:
        print(f"  ... and {len(deduped) - preview_count} more")

    batches = chunks(deduped)
    if args.dry_run:
        print(f"[dry-run] {len(batches)} request(s) of at most {MAX_PER_REQUEST}: "
              + ", ".join(str(len(b)) for b in batches) + "; nothing sent")
        return 0

    failed = []
    for i, batch in enumerate(batches, 1):
        print(f"[info] request {i} of {len(batches)}: {len(batch)} URL(s)")
        status = submit(key, key_location, batch)
        # Per IndexNow spec: 200 OK and 202 Accepted are both success
        if status not in (200, 202):
            failed.append(status)
    if not failed:
        print("[ok] submission accepted")
        return 0
    status = failed[0]

    # Map known error codes to clear messages
    msg = {
        400: "Bad request - check JSON payload format",
        403: "Forbidden - key not valid or key file not reachable",
        422: "Unprocessable - URLs do not match host or key location wrong",
        429: "Rate limited - too many requests, back off",
    }.get(status, f"unexpected status {status}")
    print(f"[fail] submission rejected: {msg}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
