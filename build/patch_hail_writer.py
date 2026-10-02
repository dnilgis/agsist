#!/usr/bin/env python3
"""2026-10-01: name data/hail/recent.json as a path in scripts/fetch_hail.py.

The homepage's Land, Storage & Risk band now reads data/hail/recent.json.
scripts/fetch_hail.py writes it every day ("--recent", hail-data.yml), but
builds the path as "%s/recent.json" % OUT_DIR, so scripts/build_feeds.py
cannot see a writer and scripts/test_feeds.py fails with "NO WRITER AND NOT
DECLARED". The file has a real writer; this makes it visible. Behaviour of
fetch_hail.py is unchanged (same path, same contents).

Usage: python3 patch_hail_writer.py --repo DIR
"""
import argparse, os, sys

MARK = '2026-10-01 recent path'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True)
    a = ap.parse_args()
    p = os.path.join(a.repo, 'scripts/fetch_hail.py')
    t = open(p, encoding='utf-8', newline='').read()
    if MARK in t:
        sys.exit('already applied')
    old_const = 'OUT_DIR = "data/hail"\n'
    if t.count(old_const) != 1:
        sys.exit('ANCHOR OUT_DIR')
    t = t.replace(old_const, old_const + 'RECENT_PATH = "data/hail/recent.json"   # %s: spelled out so build_feeds.py sees the writer\n' % MARK)
    old_open = 'open("%s/recent.json" % OUT_DIR, "w")'
    if t.count(old_open) != 2:
        sys.exit('ANCHOR recent opens: %d' % t.count(old_open))
    t = t.replace(old_open, 'open(RECENT_PATH, "w")')
    open(p, 'w', encoding='utf-8', newline='').write(t)
    print('ok')


if __name__ == '__main__':
    main()
