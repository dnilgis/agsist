/* The public yield estimate file says what the numbers are, not how they are made: a short note,
 * the estimate, its band, the trend and the record. Study-only keys stay in the job log.
 *
 *   node --test test/yield-nowcast-public.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(root, 'data', 'yield-nowcast.json');
const PRIVATE = ['history_source', 'loyo_mae', 'loyo_band80', 'loyo_years', 'band_method', 'trend_n', 'trend_mae', 'skill_pct', 'states'];
/* the fields a page reads: the estimate, its band, the trend, the record's miss, years and period */
const SHOWN = ['week_ending', 'nowcast', 'band80', 'mae', 'trend', 'trend_window', 'backtest_years', 'backtest_window', 'unit'];
const METHOD_WORDS = /percentile|expanding|backtest|leave-one|loyo|trend_mae|skill_pct|append-only|nearest rank/i;

test('the published file carries no method note and no study-only keys', () => {
  if (!fs.existsSync(FILE)) return;  // the job may not have written it yet; nothing published, nothing to check
  const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (d.note !== undefined) {
    assert.ok(d.note.length <= 200, 'one short line');
    assert.doesNotMatch(d.note, METHOD_WORDS);
  }
  for (const [crop, r] of Object.entries(d.crops || {})) {
    for (const k of PRIVATE) assert.ok(!(k in (r || {})), `${crop}.${k} is not published`);
    for (const k of Object.keys(r || {})) assert.ok(SHOWN.includes(k), `${crop}.${k} is not a field a page reads`);
  }
  for (const rows of Object.values(d.history || {})) for (const h of rows) for (const k of PRIVATE) assert.ok(!(k in h), `history row has no ${k}`);
});

test('conditions.html still shows the miss, the sample and the period, and no method wording', () => {
  const html = fs.readFileSync(path.join(root, 'conditions.html'), 'utf8');
  const m = html.match(/backtest average, not this week&rsquo;s number[^<]*</g) || [];
  assert.ok(m.length >= 1, 'a backtest line is on the page');
  for (const line of m) {
    assert.match(line, /off by \d+\.\d bushels an acre a year, \d+ years/);
    assert.match(line, /\d{4}&ndash;\d{4}/);
    assert.doesNotMatch(line, /trend-only|better|states|earlier years only/);
  }
});

test('the builder writes the public view on both paths (fresh week and held-back week)', () => {
  const r = spawnSync('python3', ['-I', '-c', `
import sys, json
sys.path.insert(0, ${JSON.stringify(path.join(root, 'scripts'))})
import build_yield_nowcast as b
src = open(b.__file__).read()
assert src.count('json.dump(public_view(out)') == 1, 'fresh week dumps the public view'
assert 'out = public_view(prev)' in src, 'held-back week starts from the public view'
v = b.public_view({"note": "band80 is the 80th percentile of EXPANDING-WINDOW errors", "crops": {"corn": {"nowcast": 1, "loyo_mae": 2, "history_source": "x"}}, "history": {"corn": []}})
assert v["note"] == b.NOTE and v["crops"]["corn"] == {"nowcast": 1} and v["history"] == {"corn": []}, v
print("ok")
`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ok/);
});
