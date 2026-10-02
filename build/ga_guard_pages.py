#!/usr/bin/env python3
"""2026-10-01: put the analytics guard on the generated pages.

The site's generated pages (farmland-atlas/, daily/, rent/: about 3,450 files)
each carry the Google Analytics loader inline. The upload kit fixes the
generators, the root pages and components/analytics.html, but a web upload
takes at most 100 files, so the generated pages are fixed here instead, by
the workflow .github/workflows/ga-guard-pages.yml, inside the repository.

Same replacement build/consent_b.py makes: the bare gtag.js loader becomes
the guard that loads it only when the browser sends no Global Privacy Control
or Do Not Track and the /privacy off switch is not set. Pages that already
carry the guard are left alone, so running this twice changes nothing.

Usage: python3 build/ga_guard_pages.py [--repo .] [--check]
  --check   change nothing; exit 1 if any page still loads GA unguarded
"""
import argparse, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from consent_b import TAG, GUARD, html_files   # one copy of the guard text

DIRS = ('farmland-atlas', 'daily', 'rent')
CONFIG_RX = re.compile(r'\s*<script>\s*window\.dataLayer\s*=\s*window\.dataLayer\s*\|\|\s*\[\];\s*function gtag\(\)')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default='.')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    changed = guarded = skipped = 0
    unguarded = []
    for d in DIRS:
        root = os.path.join(a.repo, d)
        if not os.path.isdir(root):
            continue
        for p in html_files(root):
            t = open(p, encoding='utf-8', newline='').read()
            n = t.count(TAG)
            if n == 0:
                if GUARD in t:
                    guarded += 1
                else:
                    skipped += 1
                continue
            rel = os.path.relpath(p, a.repo)
            i = t.index(TAG) + len(TAG)
            if n != 1 or not CONFIG_RX.match(t[i:]):
                unguarded.append(rel)
                continue
            if a.check:
                unguarded.append(rel)
                continue
            open(p, 'w', encoding='utf-8', newline='').write(t.replace(TAG, GUARD, 1))
            changed += 1
    print('ga guard: %d pages changed, %d already guarded, %d without GA' % (changed, guarded, skipped))
    if unguarded:
        print('still unguarded (%d): %s' % (len(unguarded), ', '.join(unguarded[:10])))
        sys.exit(1)


if __name__ == '__main__':
    main()
