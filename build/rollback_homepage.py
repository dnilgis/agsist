#!/usr/bin/env python3
"""Roll the homepage back: old index.html returns, new page goes back to /index1.html as a preview.

index.html  <- origin 79768a3e2:index.html (the homepage as of Oct 1 evening, before the cutover),
               with the GA loader swapped for the consent guard (same text as build/consent_b.py).
index1.html <- the current new homepage, with the preview noindex + banner put back.
"""
import subprocess, sys, os
sys.path.insert(0, 'build')
from consent_b import TAG, GUARD

def once(t, old, new, label):
    n = t.count(old)
    if n != 1:
        sys.exit('ANCHOR %s matched %d' % (label, n))
    return t.replace(old, new, 1)

old_index = subprocess.check_output(['git', 'show', '79768a3e2:index.html']).decode('utf-8')
old_index1 = subprocess.check_output(['git', 'show', '79768a3e2:index1.html']).decode('utf-8')
new_page = open('index.html', encoding='utf-8').read()
if 'idx1-shell' not in new_page:
    sys.exit('index.html is not the new page; already rolled back?')

# 1. old homepage, guarded
idx = once(old_index, TAG, GUARD, 'old index GA')
open('index.html', 'w', encoding='utf-8', newline='').write(idx)

# 2. new page back to preview
flag_css = [l for l in old_index1.split('\n') if l.startswith('.idx1-preview-flag{')]
assert len(flag_css) == 1
p = new_page
p = once(p, '<meta name="robots"  content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">',
         '<meta name="robots" content="noindex,nofollow"><!-- index1.html preview build: never index this URL -->', 'robots')
p = once(p, '</style>\n</head>', '\n' + flag_css[0] + '\n</style>\n</head>', 'flag css') if p.count('</style>\n</head>') == 1 else once(p, '</head>', '<style>' + flag_css[0] + '</style>\n</head>', 'flag css')
p = once(p, '\n<body>', '\n<body><div class="idx1-preview-flag">PREVIEW BUILD. The new homepage, not live yet. agsist.com still shows the current homepage.</div>', 'banner')
open('index1.html', 'w', encoding='utf-8', newline='').write(p)
print('rollback ok')
