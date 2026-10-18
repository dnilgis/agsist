#!/usr/bin/env python3
"""Check data/layers.json, the one description of every data layer.

Fails (exit 1) when:
  - an id repeats, or an entry lacks source, source_url, license, group, scope,
    fetch.kind is not one of the 4 kinds, or privacy is not one of the 3 classes
  - an atlas-county block is missing from the sample county files
    (data/atlas/counties/55005.json and 17019.json)
  - a state-file path matches no file on disk ({ST}, {st}, {fips}, {cell},
    {date} stand for any value)
  - a names-noindex layer's files are not under a robots.txt Disallow path,
    or a public layer under data/land/ has a file with a "names" or "rows" list
    (who bought, who sold)
  - a live url is not the same url field-scout-layers.js has under that key,
    or a field-scout-layers.js URLS/FEEDLOTS url has no registry entry
  - a worker route is not a route workers/fieldscout-worker.js answers
  - the file is over 60 KB

Prints one line per problem and FAILS=N. Run from anywhere in the checkout.
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
REG = 'data/layers.json'
KINDS = {'atlas-county', 'state-file', 'live', 'worker'}
PRIVACY = {'public', 'names-noindex', 'owner-live-only'}
GROUPS = {'soil', 'crops', 'vigor', 'water', 'risk', 'infrastructure', 'livestock', 'money', 'land', 'weather'}
SCOPES = {'field', 'county', 'state'}
BETTER = {'higher', 'lower', 'none'}
SAMPLE_COUNTIES = ['data/atlas/counties/55005.json', 'data/atlas/counties/17019.json']
MAX_BYTES = 60 * 1024
# where files with buyer and seller names live; a public layer here must be name-free
NAMES_AREA = '/data/land/'
PLACE = re.compile(r'\{(ST|st|fips|cell|date|YYYY)\}')


def rd(p):
    with open(os.path.join(ROOT, p), encoding='utf-8') as f:
        return f.read()


def js_block(src, name):
    """Text of `var NAME = { ... };` (brace matched)."""
    m = re.search(r'var\s+' + name + r'\s*=\s*\{', src)
    if not m:
        return ''
    i, depth = m.end() - 1, 0
    for j in range(i, len(src)):
        if src[j] == '{':
            depth += 1
        elif src[j] == '}':
            depth -= 1
            if depth == 0:
                return src[i:j + 1]
    return ''


def strip_comments(s):
    return re.sub(r'(^|\s)//[^\n]*', r'\1', s, flags=re.M)


def field_scout_urls(src):
    """{key: url or [urls] or None} from URLS, and {state: url} from FEEDLOTS."""
    urls = {}
    body = strip_comments(js_block(src, 'URLS'))[1:-1]
    for m in re.finditer(r"(\w+)\s*:\s*(null|'[^']*'|\[[^\]]*\])", body):
        k, v = m.group(1), m.group(2)
        if v == 'null':
            urls[k] = None
        elif v.startswith('['):
            urls[k] = re.findall(r"'([^']*)'", v)
        else:
            urls[k] = v[1:-1]
    feed = {}
    fbody = strip_comments(js_block(src, 'FEEDLOTS'))
    for m in re.finditer(r"(\w+)\s*:\s*\{\s*url\s*:\s*'([^']*)'", fbody):
        feed[m.group(1)] = m.group(2)
    return urls, feed


def worker_routes(src):
    return set(re.findall(r"seg\[0\]\s*===\s*'([a-z0-9_-]+)'", src))


def disallows(txt):
    out = []
    for line in txt.splitlines():
        line = line.split('#', 1)[0].strip()
        if line.lower().startswith('disallow:'):
            p = line.split(':', 1)[1].strip()
            if p:
                out.append(p)
    return out


def files_for(path):
    return sorted(glob.glob(os.path.join(ROOT, PLACE.sub('*', path))))


def check(reg, ctx):
    """Return a list of problem strings. ctx carries the parsed side files so the
    selftest can feed its own."""
    bad = []
    layers = reg.get('layers')
    if reg.get('version') != 1 or not isinstance(layers, list) or not layers:
        return ['registry: version must be 1 and layers a non-empty list']
    seen = set()
    reg_live = {}
    for l in layers:
        lid = l.get('id') or '?'
        if lid in seen:
            bad.append(lid + ': id repeats')
        seen.add(lid)
        for k in ('label', 'source', 'source_url', 'license', 'group', 'scope', 'fetch', 'fresh', 'privacy', 'better'):
            if l.get(k) in (None, '', []):
                bad.append(lid + ': no ' + k)
        if 'explain' not in l:
            bad.append(lid + ': no explain key (null is fine)')
        if 'unit' not in l:
            bad.append(lid + ': no unit key')
        if l.get('group') not in GROUPS:
            bad.append(lid + ': group %r is not one of the groups' % l.get('group'))
        if not set(l.get('scope') or []) <= SCOPES:
            bad.append(lid + ': scope %r' % l.get('scope'))
        if l.get('privacy') not in PRIVACY:
            bad.append(lid + ': privacy %r is not one of %s' % (l.get('privacy'), sorted(PRIVACY)))
        if l.get('better') not in BETTER:
            bad.append(lid + ': better %r' % l.get('better'))
        su = l.get('source_url') or ''
        if su and not su.startswith('https://'):
            bad.append(lid + ': source_url is not https')
        fr = l.get('fresh') or {}
        if 'cadence' not in fr or 'stale_days' not in fr:
            bad.append(lid + ': fresh needs cadence and stale_days')
        f = l.get('fetch') or {}
        kind = f.get('kind')
        if kind not in KINDS:
            bad.append(lid + ': fetch.kind %r is not one of %s' % (kind, sorted(KINDS)))
            continue
        if kind == 'atlas-county':
            blk = f.get('block')
            for name, county in ctx['counties'].items():
                if blk not in county:
                    bad.append('%s: block %r not in %s' % (lid, blk, name))
        elif kind == 'state-file':
            paths = [f.get('path')] + ([f['index']] if f.get('index') else [])
            for p in paths:
                if not p or not ctx['files'](p):
                    bad.append('%s: no file on disk for %s' % (lid, p))
        elif kind == 'live':
            key = f.get('key')
            have = ctx['feedlots'] if f.get('table') == 'FEEDLOTS' else ctx['urls']
            if key not in have:
                bad.append('%s: live key %r is not in field-scout-layers.js %s' % (lid, key, f.get('table') or 'URLS'))
            elif have[key] != f.get('url'):
                bad.append('%s: url differs from field-scout-layers.js %s' % (lid, key))
            reg_live[(f.get('table') or 'URLS', key)] = lid
        elif kind == 'worker':
            r = (f.get('route') or '').strip('/')
            if r not in ctx['routes']:
                bad.append('%s: worker route /%s is not answered by workers/fieldscout-worker.js' % (lid, r))
        # privacy against robots.txt, for files on this site
        if kind in ('state-file', 'atlas-county'):
            p = '/' + (f.get('path') or '')
            under = any(p.startswith(d) for d in ctx['disallow'])
            if l.get('privacy') == 'names-noindex' and not under:
                bad.append('%s: names-noindex but %s is not under a robots.txt Disallow' % (lid, p))
            if l.get('privacy') == 'public' and kind == 'state-file' and p.startswith(NAMES_AREA):
                for fp in ctx['files'](f['path'])[:3]:
                    top = ctx['top_keys'](fp)
                    if top & {'names', 'rows'}:
                        bad.append('%s: public, but %s has %s' % (lid, os.path.relpath(fp, ROOT), sorted(top & {'names', 'rows'})))
        if l.get('privacy') == 'names-noindex' and kind in ('live', 'worker'):
            bad.append(lid + ': names-noindex must be a file on this site (live name reads are owner-live-only)')
    for k in ctx['urls']:
        if ('URLS', k) not in reg_live:
            bad.append('field-scout-layers.js URLS.%s has no registry entry' % k)
    for k in ctx['feedlots']:
        if ('FEEDLOTS', k) not in reg_live:
            bad.append('field-scout-layers.js FEEDLOTS.%s has no registry entry' % k)
    return bad


def real_ctx():
    counties = {}
    for p in SAMPLE_COUNTIES:
        counties[p] = json.loads(rd(p))
    urls, feed = field_scout_urls(rd('field-scout-layers.js'))
    keys_cache = {}

    def top_keys(fp):
        if fp not in keys_cache:
            try:
                with open(fp, encoding='utf-8') as fh:
                    d = json.load(fh)
                keys_cache[fp] = set(d) if isinstance(d, dict) else set()
            except Exception:
                keys_cache[fp] = set()
        return keys_cache[fp]
    return {
        'counties': counties, 'urls': urls, 'feedlots': feed,
        'routes': worker_routes(rd('workers/fieldscout-worker.js')),
        'disallow': disallows(rd('robots.txt')),
        'files': files_for, 'top_keys': top_keys,
    }


def selftest():
    good = {'version': 1, 'layers': [
        {'id': 'a', 'group': 'money', 'label': 'A', 'unit': '$', 'scope': ['county'], 'fetch': {'kind': 'atlas-county', 'path': 'x', 'block': 'rent'},
         'source': 's', 'source_url': 'https://x', 'license': 'unknown', 'fresh': {'cadence': 'monthly', 'stale_days': 40}, 'privacy': 'public', 'better': 'none', 'explain': None},
        {'id': 'b', 'group': 'water', 'label': 'B', 'unit': '', 'scope': ['field'], 'fetch': {'kind': 'live', 'key': 'nfhl', 'url': 'https://f'},
         'source': 's', 'source_url': 'https://x', 'license': 'unknown', 'fresh': {'cadence': 'live', 'stale_days': None}, 'privacy': 'public', 'better': 'lower', 'explain': None},
        {'id': 'c', 'group': 'land', 'label': 'C', 'unit': '', 'scope': ['county'], 'fetch': {'kind': 'state-file', 'path': 'data/land/{st}/{fips}.json'},
         'source': 's', 'source_url': 'https://x', 'license': 'unknown', 'fresh': {'cadence': 'monthly', 'stale_days': 40}, 'privacy': 'names-noindex', 'better': 'none', 'explain': None},
        {'id': 'd', 'group': 'soil', 'label': 'D', 'unit': '', 'scope': ['field'], 'fetch': {'kind': 'worker', 'route': '/soil'},
         'source': 's', 'source_url': 'https://x', 'license': 'unknown', 'fresh': {'cadence': 'live', 'stale_days': None}, 'privacy': 'public', 'better': 'higher', 'explain': None},
    ]}
    ctx = {'counties': {'s.json': {'rent': {}}}, 'urls': {'nfhl': 'https://f'}, 'feedlots': {}, 'routes': {'soil'},
           'disallow': ['/data/land/'], 'files': lambda p: ['f'], 'top_keys': lambda fp: set()}
    assert check(good, ctx) == [], check(good, ctx)

    def broken(mut):
        r = json.loads(json.dumps(good))
        mut(r)
        return check(r, ctx)
    assert any('repeats' in x for x in broken(lambda r: r['layers'].append(dict(r['layers'][0]))))
    assert any('fetch.kind' in x for x in broken(lambda r: r['layers'][0]['fetch'].update(kind='ftp')))
    assert any('privacy' in x for x in broken(lambda r: r['layers'][0].update(privacy='secret')))
    assert any('no license' in x for x in broken(lambda r: r['layers'][0].update(license='')))
    assert any('block' in x for x in broken(lambda r: r['layers'][0]['fetch'].update(block='nope')))
    assert any('url differs' in x for x in broken(lambda r: r['layers'][1]['fetch'].update(url='https://other')))
    assert any('no registry entry' in x for x in broken(lambda r: r['layers'].pop(1)))
    assert any('worker route' in x for x in broken(lambda r: r['layers'][3]['fetch'].update(route='/nope')))
    assert any('Disallow' in x for x in broken(lambda r: r['layers'][2]['fetch'].update(path='data/cash-rent/{ST}.json')))
    ctx2 = dict(ctx, top_keys=lambda fp: {'names', 'rows'})
    r = json.loads(json.dumps(good)); r['layers'][2]['privacy'] = 'public'
    assert not any('has' in x for x in check(good, ctx2))
    assert any('has' in x for x in check(r, ctx2))
    ctx3 = dict(ctx, files=lambda p: [])
    assert any('no file on disk' in x for x in check(good, ctx3))
    assert disallows('User-agent: *\nAllow: /\nDisallow: /data/land/ # x\nDisallow:\n') == ['/data/land/']
    u, fl = field_scout_urls("var URLS = {\n a: 'https://a', // c\n b: ['https://b1', 'https://b2'],\n n: null\n};\n"
                             "var FEEDLOTS = { IA: { url: 'https://ia', active: \"x\" } };")
    assert u == {'a': 'https://a', 'b': ['https://b1', 'https://b2'], 'n': None} and fl == {'IA': 'https://ia'}, (u, fl)
    assert worker_routes("if (seg[0] === 'ndvi') x; if (seg[0] === 'soil') y;") == {'ndvi', 'soil'}
    print('selftest ok')


def main():
    if '--selftest' in sys.argv:
        selftest()
        return 0
    selftest()
    size = os.path.getsize(os.path.join(ROOT, REG))
    reg = json.loads(rd(REG))
    bad = check(reg, real_ctx())
    if size > MAX_BYTES:
        bad.append('%s is %d bytes, over %d' % (REG, size, MAX_BYTES))
    for b in bad:
        print('FAIL ' + b)
    print('layers=%d bytes=%d FAILS=%d' % (len(reg.get('layers') or []), size, len(bad)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
