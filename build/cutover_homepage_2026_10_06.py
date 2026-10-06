#!/usr/bin/env python3
"""Cutover, 2026-10-06 (Sig: "lets just make this index1 the new homepage").

index1.html (the preview) becomes index.html. Same contract as
build/cutover_homepage.py (2026-10-01), updated for today's page:
  - no [PREVIEW] title prefix any more; the banner CSS now lives in
    css/home.css (the rule stays there, harmless with no element).
  - carries the live og:image / twitter:image (build_social_card.py owns them)
    and the live dateModified (seed_static.py owns it).

Writes index.html, and stubs index1.html + test-index.html that send the old
preview URLs to /. Every anchor must match exactly once. A second run is
refused (index1.html is already a stub).

Rollback: git revert the cutover commit (GitHub web UI: open the commit,
"Revert"), or build/rollback_homepage.py adapted to this commit.
"""
import argparse, os, re, sys

STUB = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AGSIST</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="https://agsist.com/">
<meta http-equiv="refresh" content="0;url=/">
<style>body{margin:0;background:#0a0c0d;color:#e6ebe9;font-family:system-ui,sans-serif;padding:24px}a{color:#d4a23f}</style>
</head>
<body>
<p>The homepage moved to <a href="/">agsist.com</a>.</p>
</body>
</html>
'''

def once(t, old, new, label):
    n = t.count(old)
    if n != 1:
        sys.exit('ANCHOR %s matched %d times, expected 1' % (label, n))
    return t.replace(old, new)

def meta_line(t, prop, label):
    m = re.findall(r'^<meta (?:property|name)="%s"\s+content="[^"]*">$' % re.escape(prop), t, re.M)
    if len(m) != 1:
        sys.exit('ANCHOR %s matched %d times, expected 1' % (label, len(m)))
    return m[0]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True)
    a = ap.parse_args()
    p = lambda f: os.path.join(a.repo, f)
    src = open(p('index1.html'), encoding='utf-8', newline='').read()
    live = open(p('index.html'), encoding='utf-8', newline='').read()
    if 'http-equiv="refresh"' in src:
        sys.exit('index1.html is already a stub: cutover has run. Stopping.')

    t = src
    t = once(t, '<meta name="robots" content="noindex,nofollow"><!-- index1.html preview build: never index this URL -->\n',
             meta_line(live, 'robots', 'live robots') + '\n', 'noindex')
    if t.count('<div class="idx1-preview-flag">') != 1:
        sys.exit('ANCHOR banner div')
    t = re.sub(r'<div class="idx1-preview-flag">[^<]*</div>', '', t, count=1)
    for prop in ('og:image', 'twitter:image'):
        t = once(t, meta_line(t, prop, 'new ' + prop), meta_line(live, prop, 'live ' + prop), 'swap ' + prop)
    dm_new = re.findall(r'"dateModified": "[^"]*"', t); dm_live = re.findall(r'"dateModified": "[^"]*"', live)
    if len(dm_new) != 1 or len(dm_live) != 1:
        sys.exit('ANCHOR dateModified')
    t = t.replace(dm_new[0], dm_live[0])
    for bad in ('noindex', '[PREVIEW]', 'PREVIEW BUILD', 'class="idx1-preview-flag"'):
        if bad in t:
            sys.exit('preview marker still present: %s' % bad)

    open(p('index.html'), 'w', encoding='utf-8', newline='').write(t)
    for stub in ('index1.html', 'test-index.html'):
        open(p(stub), 'w', encoding='utf-8', newline='').write(STUB)
    print('ok')

if __name__ == '__main__':
    main()
