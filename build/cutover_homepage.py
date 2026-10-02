#!/usr/bin/env python3
"""Cutover, 2026-10-01: the preview homepage (index1.html) becomes index.html.

Run once, after build/patch_index1_cutover.py has written the patched
index1.html into --repo. Reads the live index.html in --repo only for the two
values a workflow owns there (og:image and twitter:image, written each
morning by scripts/build_social_card.py), so the new page carries today's card.

Writes:
  index.html       the patched index1 content minus the three preview-only
                   parts (title prefix, noindex meta, orange banner + its CSS)
  index1.html      a stub that sends the old preview URL to /
  test-index.html  the same stub (an older preview)

Every anchor must match exactly once. Running it twice is refused: the second
run would find index1.html already a stub and stops rather than overwrite the
real homepage with a stub's content.

After this, homepage work targets index.html with a new patch script.
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
    t = once(t, '<title>[PREVIEW] ', '<title>', 'title prefix')
    t = once(t, '<meta name="robots" content="noindex,nofollow"><!-- index1.html preview build: never index this URL -->\n', '', 'noindex')
    t = re.sub(r'<body><div class="idx1-preview-flag">[^<]*</div>', '<body>', t, count=1) if t.count('<div class="idx1-preview-flag">') == 1 else sys.exit('ANCHOR banner div')
    t = re.sub(r'^\.idx1-preview-flag\{[^}\n]*\}\n', '', t, count=1, flags=re.M) if len(re.findall(r'^\.idx1-preview-flag\{', t, re.M)) == 1 else sys.exit('ANCHOR banner css')
    for prop in ('og:image', 'twitter:image'):
        t = once(t, meta_line(t, prop, 'new ' + prop), meta_line(live, prop, 'live ' + prop), 'swap ' + prop)
    # dateModified is stamped by scripts/seed_static.py; carry the live value.
    dm_new = re.findall(r'"dateModified": "[^"]*"', t); dm_live = re.findall(r'"dateModified": "[^"]*"', live)
    if len(dm_new) != 1 or len(dm_live) != 1: sys.exit('ANCHOR dateModified')
    t = t.replace(dm_new[0], dm_live[0])
    for bad in ('noindex', 'idx1-preview-flag', '[PREVIEW]', 'PREVIEW BUILD'):
        if bad in t:
            sys.exit('preview marker still present: %s' % bad)

    open(p('index.html'), 'w', encoding='utf-8', newline='').write(t)
    for stub in ('index1.html', 'test-index.html'):
        open(p(stub), 'w', encoding='utf-8', newline='').write(STUB)
    print('ok')

if __name__ == '__main__':
    main()
