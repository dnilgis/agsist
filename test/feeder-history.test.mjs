// Feeder index history (Nov 2): past weeks of the AGSIST USDA feeder steer index
// from archived copies of the same USDA AMS barn reports. The numbers come from
// scripts/build_feeder_index.py (build_history, its --selftest holds the merge
// rules); this file checks that an archived report reads through the barn
// reader unchanged, and that the probe keeps its manners.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = 'test/fixtures/cattle-auction';

function readArchived(file, barn) {
  const py = [
    'import json, sys',
    'sys.path.insert(0, "scripts")',
    'import fetch_cattle_auction as F',
    'src = next(b for b in F.load_sources(F.ROOT)["barns"] if b["id"] == sys.argv[2])',
    'p, why = F.parse_report(open(sys.argv[1], encoding="utf-8").read())',
    'out = {"why": why}',
    'if p:',
    '    s = F.summarize(p)',
    '    out.update(date=p["date"], receipts=p["receipts"], title_ok=F.title_ok(src, p["title"]),',
    '               tables={k: len(v) for k, v in p["tables"].items()}, classes=s["classes"])',
    'print(json.dumps(out))',
  ].join('\n');
  return JSON.parse(execFileSync('python3', ['-c', py, file, barn], { cwd: root, encoding: 'utf8' }));
}

test('an archived USDA report (Valentine NE, Jan 9 2025) reads through the barn reader', () => {
  const r = readArchived(`${FIX}/ams_1856-archive-2025-01-pypdf.txt`, 'valentine-ne');
  assert.equal(r.why, null);
  assert.equal(r.date, '2025-01-09');
  assert.equal(r.receipts, 4445);
  assert.equal(r.title_ok, true);
  assert.ok(r.tables['steers|1'] >= 10, JSON.stringify(r.tables));
  const s7 = r.classes['steers|1'] && r.classes['steers|1']['700'];
  assert.ok(s7 && s7.head > 0 && s7.cwt > 200 && s7.cwt < 400, JSON.stringify(s7));
});

test('an archived USDA report (Joplin MO, Jan 6 2025) reads through the barn reader', () => {
  const r = readArchived(`${FIX}/ams_1245-archive-2025-01-pypdf.txt`, 'joplin-mo');
  assert.equal(r.why, null);
  assert.equal(r.date, '2025-01-06');
  assert.equal(r.receipts, 1847);
  assert.equal(r.title_ok, true);
});

test('an archived report is never read as another barn', () => {
  const r = readArchived(`${FIX}/ams_1856-archive-2025-01-pypdf.txt`, 'joplin-mo');
  assert.equal(r.title_ok, false);
});

test('the probe and the history builder pass their selftests', () => {
  const a = execFileSync('python3', ['scripts/probe_feeder_archive.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.match(a, /probe_feeder_archive selftest: 0 failure\(s\)/);
  const b = execFileSync('python3', ['scripts/build_feeder_index.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.match(b, /ok {3}history: a re-run changes nothing/);
  assert.match(b, /FAILS=0/);
});

test('the probe reads robots.txt, keeps a gap between requests and never prints the MARS key', () => {
  const s = fs.readFileSync(path.join(root, 'scripts/probe_feeder_archive.py'), 'utf8');
  assert.match(s, /robots\.allowed\(url\)/);
  assert.match(s, /Fetcher\(min_gap=1\.5/);
  assert.doesNotMatch(s, /log\([^)]*MARS_API_KEY/);
  assert.match(s, /"mars_key_present": bool\(mars_auth\(\)\)/);
});
