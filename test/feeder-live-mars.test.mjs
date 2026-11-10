// The live AGSIST USDA feeder steer index reads USDA My Market News (MARS) first and the barn
// PDFs only for a barn and week MARS lacks (Nov 2 2026), and never
// counts one sale twice. Real cases: Oklahoma National Stockyards (report 1280), whose Monday
// sale was stored a second time under the Tuesday its Final came out, in the weeks of Oct 19
// and Oct 26 2026 (data/feeder-index.json on main, Nov 2 2026), and Joplin (1245) as MARS sent it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = 'test/fixtures/cattle-auction';

function py(lines, ...args) {
  return JSON.parse(execFileSync('python3', ['-c', ['import json, sys, datetime', 'sys.path.insert(0, "scripts")', ...lines].join('\n'), ...args],
    { cwd: root, encoding: 'utf8', env: { ...process.env, MARS_API_KEY: '' } }));
}

const OKC = [
  'import build_feeder_index as B, fetch_cattle_auction as F',
  'fx = json.load(open(sys.argv[1]))',
  'store = B.load_store({"okc-ok": fx["okc-ok"]})',
  'D = datetime.date',
  'heads = lambda st, m: B.index_barns(st, m).get("okc-ok", [0])[0]',
];

test('Oklahoma City, week of Oct 19 2026: the same sale under Monday and Tuesday counts once', () => {
  const r = py([...OKC,
    'before = heads(store, D(2026, 10, 19))',
    'dropped = B.resolve_store(store)',
    'print(json.dumps({"before": before, "after": heads(store, D(2026, 10, 19)), "dates": sorted(store["okc-ok"]["sales"]), "dropped": dropped}))',
  ], `${FIX}/feeder-okc-barn-sales-2026-11-02.json`);
  // 459 + 231 head of 700-899 lb steers on Mon Oct 19; the copy under Tue Oct 20 doubled it
  assert.equal(r.before, 1380);
  assert.equal(r.after, 690);
  assert.ok(!r.dates.includes('2026-10-20') && r.dates.includes('2026-10-19'), 'the earlier date stays');
  assert.deepEqual(r.dropped, [['okc-ok', '2026-10-20', 'same cells as the sale of 2026-10-19']]);
  // the week of Oct 26 holds the Preliminary and the Final of one sale; their cells differ, so
  // the PDF side alone cannot tell, and both stay until My Market News holds the week (next test)
  assert.ok(r.dates.includes('2026-10-26') && r.dates.includes('2026-10-27'));
});

test('Oklahoma City, week of Oct 26 2026: a sale read through My Market News replaces the PDF reads of that barn and week', () => {
  // The MARS sale here is the Final's own rows as the barn reader reads them (the Oct 27 PDF text,
  // dated by its "Report for 10/26/2026 - Final" line); #248 found the two readers row for row equal.
  const r = py([...OKC,
    'p, _ = F.parse_report(open(sys.argv[2]).read())',
    'mars = {"ok": True, "sales": [dict(F.summarize(p), barn="okc-ok", state="OK", via="mars")]}',
    'B.merge_mars_sales(store, mars, D(2026, 11, 3))',
    'dropped = B.resolve_store(store)',
    'e = store["okc-ok"]',
    'print(json.dumps({"date": p["date"], "dates": sorted(e["sales"]), "via": e["via"], "heads": heads(store, D(2026, 10, 26)),',
    '  "final": B.sale_cells(F.summarize(p)) == e["sales"]["2026-10-26"], "dropped": dropped, "kept": B.save_store(store)["okc-ok"]["pdf"]}))',
  ], `${FIX}/feeder-okc-barn-sales-2026-11-02.json`, `${FIX}/ams_1280-2026-10-26-final.txt`);
  assert.equal(r.date, '2026-10-26', 'the Final is the Monday sale');
  assert.ok(!r.dates.includes('2026-10-27'));
  assert.equal(r.via['2026-10-26'], 'mars');
  assert.equal(r.final, true, 'the week holds the Final, as My Market News does');
  assert.equal(r.heads, 429 + 219, 'one sale of 700-899 lb steers, not two');
  assert.deepEqual(r.dropped.map((x) => x[1]), ['2026-10-20', '2026-10-27']);
  // the other weeks MARS did not hold keep their PDF reads, and the file says which those are
  assert.deepEqual(r.kept, ['2026-10-13', '2026-10-19', '2026-11-02']);
});

test('a PDF read never replaces a sale read through My Market News; with no MARS answer the PDF reads stand', () => {
  const r = py([
    'import build_feeder_index as B',
    'D = datetime.date',
    'sale = lambda h: {"date": "2026-10-26", "classes": {"steers|1": {"700": {"head": h, "avg_wt": 750, "cwt": 350.0, "per_head": 2625.0}}}}',
    'store = B.load_store({})',
    'B.merge_mars_sales(store, {"ok": True, "sales": [dict(sale(100), barn="x", state="OK")]}, D(2026, 11, 3))',
    'B.merge_barn_sales(store, {"barns": [{"id": "x", "state": "OK", "sales": [sale(55), dict(sale(70), date="2026-10-27")]}]}, D(2026, 11, 3))',
    'B.resolve_store(store)',
    'a = B.index_barns(store, D(2026, 10, 26))["x"][0]',
    'kept = B.save_store(store)',
    'again = B.load_store(kept)',
    'B.merge_barn_sales(again, {"barns": [{"id": "x", "state": "OK", "sales": [sale(55)]}]}, D(2026, 11, 3))',
    'b = B.index_barns(again, D(2026, 10, 26))["x"][0]',
    's2 = B.load_store({})',
    'B.merge_mars_sales(s2, None, D(2026, 11, 3))',
    'B.merge_barn_sales(s2, {"barns": [{"id": "x", "state": "OK", "sales": [sale(55)]}]}, D(2026, 11, 3))',
    'c = B.index_barns(s2, D(2026, 10, 26))["x"][0]',
    'old = B.load_store({"x": {"state": "OK", "sales": {"2026-10-26": [[1, 1.0, 1.0]]}}})',
    'print(json.dumps({"a": a, "b": b, "c": c, "pdf": kept["x"]["pdf"], "old": old["x"]["via"]}))',
  ]);
  assert.equal(r.a, 100, 'MARS holds the week: the PDF sales of that barn and week are left out');
  assert.deepEqual(r.pdf, []);
  assert.equal(r.b, 100, 'after a save and a load, a later PDF read still does not replace it');
  assert.equal(r.c, 55, 'no MARS answer: the PDF read stands');
  assert.deepEqual(r.old, { '2026-10-26': 'pdf' }, 'a file from before MARS is all PDF reads');
});

test('the live MARS read: the past weeks\' reader, a key from the environment only, and fail soft', () => {
  const r = py([
    'import build_feeder_index as B, tempfile',
    'body = open(sys.argv[1], "rb").read()',
    'asked = []',
    'class Fake:',
    '    def get(self, url):',
    '        asked.append(url)',
    '        return (200, body) if "/reports/1245?" in url else (404, b"")',
    'class Down:',
    '    def get(self, url):',
    '        raise RuntimeError("down")',
    'm = B.read_mars(datetime.date(2025, 1, 10), out_dir=tempfile.mkdtemp(), fetch_=Fake(), log=lambda *a: None)',
    'd = B.read_mars(datetime.date(2025, 1, 10), out_dir=tempfile.mkdtemp(), fetch_=Down(), log=lambda *a: None)',
    'n = B.read_mars(datetime.date(2025, 1, 10))',
    's = m["sales"][0]',
    'print(json.dumps({"ok": m["ok"], "n": len(m["sales"]), "barn": s["barn"], "via": s["via"], "date": s["date"], "asked": len(asked),',
    '  "one_per_report": len(set(asked)) == len(asked), "down": d, "nokey": n, "from": m["from"], "to": m["to"]}))',
  ], `${FIX}/mars_1245-2025-01-06.json`);
  assert.equal(r.ok, true);
  assert.equal(r.n, 1);
  assert.equal(r.barn, 'joplin-mo');
  assert.equal(r.via, 'mars');
  assert.equal(r.date, '2025-01-06');
  assert.ok(r.asked > 100 && r.one_per_report, 'every single-barn report, asked once');
  assert.equal(r.from, '2024-11-29', 'the barn store\'s own window (KEEP_DAYS)');
  assert.equal(r.down.ok, false, 'MARS down: nothing read, the PDF reads stand');
  assert.equal(r.nokey, null, 'no key: MARS is not asked');
});

test('the barn job passes the MARS key to the index build only, and the live weeks say how their barns were read', () => {
  const wf = fs.readFileSync(path.join(root, '.github/workflows/cattle-auction.yml'), 'utf8');
  const i = wf.indexOf('- name: Build data/feeder-index.json');
  const step = wf.slice(i, wf.indexOf('- name:', i + 10));
  assert.match(step, /MARS_API_KEY: \$\{\{ secrets\.MARS_API_KEY \}\}/);
  assert.match(step, /continue-on-error: true/, 'a MARS or index failure never holds back the barn prices');
  assert.equal((wf.match(/secrets\.MARS_API_KEY/g) || []).length, 1, 'the key goes to that one step');
  assert.doesNotMatch(wf, /echo[^\n]*MARS_API_KEY/);
  const src = fs.readFileSync(path.join(root, 'scripts/build_feeder_index.py'), 'utf8');
  assert.doesNotMatch(src, /print\([^\n]*MARS_API_KEY/);
  const d = JSON.parse(fs.readFileSync(path.join(root, 'data/feeder-index.json'), 'utf8'));
  for (const w of d.index.weeks.slice(-3)) {
    if (!w.barns) continue;
    assert.ok(w.via && Object.values(w.via).reduce((a, b) => a + b, 0) === w.barns, w.start + ': via counts every barn');
  }
  // no barn counts a sale twice: no two dates of one barn in one week with the same cells
  // the barn store is its own file, which no page loads (the page file stays small)
  assert.equal(d.barn_sales, undefined, 'the pages\' file does not carry the barn store');
  const st = JSON.parse(fs.readFileSync(path.join(root, 'data/feeder-index-store.json'), 'utf8'));
  assert.ok(Object.keys(st.barn_sales).length > 30);
  assert.ok(Object.values(st.barn_sales).every((e) => Array.isArray(e.pdf)), 'each barn lists its PDF-read dates');
  for (const [bid, e] of Object.entries(st.barn_sales)) {
    const seen = {};
    for (const [day, cells] of Object.entries(e.sales)) {
      const dt = new Date(day + 'T00:00:00Z');
      const wk = new Date(dt - ((dt.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
      const k = wk + JSON.stringify(cells);
      assert.ok(!seen[k], `${bid} ${day} repeats ${seen[k]}`);
      seen[k] = day;
    }
  }
});
