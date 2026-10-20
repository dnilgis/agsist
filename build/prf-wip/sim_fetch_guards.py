# What a refresh does when RMA's index service answers 200 with nothing in it.
import sys, os, json, tempfile, shutil
sys.dont_write_bytecode = True
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
WORK = os.environ.get('PRF_WORK') or tempfile.mkdtemp(prefix='prfwork_')
os.chdir(WORK)
import fetch_prf as F
fx, T, make_zip, api_doc, _, _ = F._fixture()
d = tempfile.mkdtemp(prefix='prfsim_', dir=WORK)
zp = os.path.join(d, 'adm.zip'); make_zip(zp, T); adm = F.read_adm(zp); adm['last_modified'] = 'fixture'
out = os.path.join(d, 'out')
def ls():
    r = {}
    for k in ('g', 'y', 's'):
        p = os.path.join(out, k)
        r[k] = sorted(os.listdir(p)) if os.path.isdir(p) else []
    m = json.load(open(os.path.join(out, 'meta.json')))
    return r, m['years'], m['counts']['grids'], m['counts']['grids_not_answering_this_run'], m['built']
# 1. first full build, 2026 published through interval index 5 (Jun-Jul)
F.build(adm, out, full=True, fetch=lambda g: api_doc(g, 1951, 2026, upto=(2026, 5)), now_year=2026, workers=2)
print('after full build:', ls())
y_before = {n: open(os.path.join(out, 'y', n)).read() for n in os.listdir(os.path.join(out, 'y'))}
print('  y content:', {k: v[:160] for k, v in y_before.items()})
# 2. weekly refresh; the service answers 200 with an empty row list for every grid
m, ch = F.build(adm, out, full=False, fetch=lambda g: {"HistoricalIndexRows": []}, now_year=2026, workers=2)
print('after refresh with EMPTY 200 answers:', ls(), dict(ch))
# 3. restore, then refresh where the open year comes back with every value null
shutil.rmtree(out)
F.build(adm, out, full=True, fetch=lambda g: api_doc(g, 1951, 2026, upto=(2026, 5)), now_year=2026, workers=2)
def nulls(g):
    doc = api_doc(g, 2026, 2026)
    for row in doc['HistoricalIndexRows']:
        for c in row['HistoricalIndexDataColumns']:
            c['PercentOfNormal'] = None
    return doc
m, ch = F.build(adm, out, full=False, fetch=nulls, now_year=2026, workers=2)
print('after refresh with ALL-NULL open year:', ls(), dict(ch))
# 4. restore, then a refresh where the service is down entirely (every call raises)
shutil.rmtree(out)
F.build(adm, out, full=True, fetch=lambda g: api_doc(g, 1951, 2026, upto=(2026, 5)), now_year=2026, workers=2)
def down(g): raise RuntimeError('timeout')
try:
    F.build(adm, out, full=False, fetch=down, now_year=2026, workers=2)
    print('service down: build returned', ls())
except Exception as e:
    print('service down ->', type(e).__name__, e, '| files:', ls()[0])
# 5. refresh where an interval goes BACKWARDS (RMA withdraws Jun-Jul): is the regression published?
m, ch = F.build(adm, out, full=False, fetch=lambda g: api_doc(g, 2026, 2026, upto=(2026, 3)), now_year=2026, workers=2)
print('after refresh where 2026 lost two intervals:', ls()[1], dict(ch))
shutil.rmtree(d)
