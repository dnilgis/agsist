#!/usr/bin/env python3
"""
indexnow_submit.py - Submit URLs to the IndexNow API.

Reads the IndexNow key from a *.txt file at the repo root whose
filename (minus extension) matches its content (32+ hex chars).
By default fetches sitemap.xml from the deployed site, extracts URLs,
and POSTs them in a single batch to https://api.indexnow.org/IndexNow.

Usage:
    python scripts/indexnow_submit.py
    python scripts/indexnow_submit.py --urls https://agsist.com/foo https://agsist.com/bar
    python scripts/indexnow_submit.py --root /path/to/repo
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

HOST = "agsist.com"
SITEMAP_URL = f"https://{HOST}/sitemap.xml"
INDEXNOW_ENDPOINT = "https://api.indexnow.org/IndexNow"
KEY_FILE_PATTERN = re.compile(r"^[a-f0-9]{8,128}\.txt$", re.IGNORECASE)
USER_AGENT = "AGSIST-IndexNow-Submitter/1.0"


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


def fetch_sitemap_urls():
    """Fetch sitemap.xml and return all <loc> URLs that match HOST."""
    print(f"[info] fetching {SITEMAP_URL}")
    req = urllib.request.Request(SITEMAP_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read()

    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        raise SystemExit(f"ERROR: sitemap.xml is not valid XML: {e}")

    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls = [el.text.strip() for el in root.findall(".//sm:loc", ns) if el.text]
    if not urls:
        # Fallback: parse without namespace
        urls = [el.text.strip() for el in root.iter("loc") if el.text]

    # Filter to this host only (defensive against accidental external URLs)
    urls = [u for u in urls if HOST in u]
    return urls


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
    args = parser.parse_args()

    key, key_location = find_key_file(Path(args.root).resolve())
    print(f"[info] key file: {key_location}")

    if args.urls:
        urls = args.urls
    else:
        urls = fetch_sitemap_urls()

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

    status = submit(key, key_location, deduped)

    # Per IndexNow spec: 200 OK and 202 Accepted are both success
    if status in (200, 202):
        print("[ok] submission accepted")
        return 0

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
