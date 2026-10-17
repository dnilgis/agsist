// Anything the site calls "closed" or "settled" must be the exchange settle,
// and no expired contract is shown as the current price (2026-10-17).
//
// Oct 16, 2026, against Barchart, Successful Farming and Farm Progress:
//   * Nov soybeans "closed $12.60 1/2 (-3 3/4c)"; CBOT settled $12.61 1/4, -1 3/4.
//     Both ends were Yahoo last trades (the 1:46 p.m. bar and the Oct 15 one).
//   * Dec corn "-4c"; the settle change was -3 3/4.
//   * Home ticker and the daily: Oct '26 lean hogs "$75.55 unch", two days after
//     Oct hogs stopped trading (Oct 14). Dec hogs rose 0.30 to $66.875.
//   * Cattle page: feeders "settled $343.98 on Oct 16", the 1:46 p.m. trade.
//
// This file runs the Python selftests that pin those cases (fetch_prices'
// settle split, the contract calendar, the nearby roll, the briefing wording)
// and scans the page code for text that calls a bare `.close` settled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// fetch_prices imports yfinance; the selftests stub every call, so a bare
// module stands in when the package is not installed here.
function runPy(script) {
  const pre = [
    'import sys, types, runpy',
    'try:\n    import yfinance\nexcept ImportError:\n    sys.modules["yfinance"] = types.ModuleType("yfinance")',
    `sys.path.insert(0, ${JSON.stringify(path.join(root, 'scripts'))})`,
    `sys.argv = [${JSON.stringify(script)}]`,
    `runpy.run_path(${JSON.stringify(path.join(root, 'scripts', script))}, run_name="__main__")`,
  ].join('\n');
  return execFileSync('python3', ['-c', pre], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

for (const [script, ok] of [
  ['test_overnight_settle.py', /^PASS$/m],
  ['contract_calendar.py', /^SELFTEST OK$/m],
  ['test_nearby.py', /^SELFTEST OK$/m],
  ['test_settle_words.py', /^PASS$/m],
]) {
  test(`${script} passes`, () => {
    const out = runPy(script);
    assert.match(out, ok, out.split('\n').filter((l) => /FAIL/.test(l)).join('\n'));
    assert.doesNotMatch(out, /^\s*FAIL /m);
  });
}

test('the Oct 16 numbers: a last trade is not the settle, and the change is from the settle', () => {
  const out = runPy('test_overnight_settle.py');
  for (const line of [
    '13:46 CT Oct 16: 1260.50 is a last trade, not a close',
    '13:46 CT: change -2.50 from the settle, not -3.75',
    'Sat 00:00 CT: settled 1261.25 (the CBOT settle)',
    'Sat 00:00 CT: -1.75, the CBOT change',
    'corn 13:46 CT Oct 16: -3.75 from the 478.00 settle, worded as a last trade',
    'a v3.6 settles map (no settles_v) is not carried',
  ]) assert.ok(out.includes('OK   ' + line), line);
});

test('expired contracts roll by the exchange calendar: lean hogs and feeders', () => {
  const cal = runPy('contract_calendar.py');
  for (const line of ['hogs-oct26 dead on Oct 15', 'hogs front is Dec on Oct 16',
                      'feeders-oct26 live on Oct 29', 'feeders roll oct -> nov on Oct 30'])
    assert.ok(cal.includes('OK   ' + line), line);
  const nb = runPy('test_nearby.py');
  for (const line of ["Oct 16: hogs-nearby is Dec '26 $66.875, never the expired Oct '26 $75.55",
                      "Oct 30: feeders roll to Nov '26", "continuous hogs = Dec '26, no longer stale"])
    assert.ok(nb.includes('OK   ' + line), line);
});

// Page code: a string that says closed or settled, built from a quote's bare
// `.close` (or `["close"]`), is the Oct 16 bug. The settle has its own fields
// (settle, settle_date, settle_net) and a quote says which it is (close_kind).
const SCAN_DIRS = ['components', 'scripts'];
const SKIP = /^(test_|.*\.min\.js$)|^(rain-print|prf|lrp|cot-)/;
const CLAIM = /(['"`]|f")[^'"`\n]*\b(closed|settled|Closed|Settled)\b[^\n]{0,120}(\.close\b(?!_)|\[['"]close['"]\])/;
// Lines checked by hand: not a sentence about a price.
const ALLOW = [
  /components\/bids-homepage\.js: +if\(r\.settleDay\)\{ settled\[/,   // a map named settled, filled from harvest settles
];

test('no page code calls a bare .close "closed" or "settled"', () => {
  const hits = [];
  for (const dir of SCAN_DIRS) {
    for (const f of fs.readdirSync(path.join(root, dir))) {
      if (!/\.(js|mjs|py)$/.test(f) || SKIP.test(f)) continue;
      const lines = fs.readFileSync(path.join(root, dir, f), 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (!CLAIM.test(l)) return;
        const tag = `${dir}/${f}: ${l.trim()}`;
        if (ALLOW.some((a) => a.test(`${dir}/${f}: ${l}`))) return;
        hits.push(`${tag.slice(0, 160)} (line ${i + 1})`);
      });
    }
  }
  assert.deepEqual(hits, []);
});

test('the scan catches the Oct 16 lines it is meant to catch', () => {
  for (const bad of [
    "out.push('Feeder futures, ' + k + ', settled ' + h.money(board.close) + ' on ' + h.day(board.close_date) + '.');",
    "s += ' ' + esc(b.label) + ' closed ' + fut(q.close) + ' ' + day(q.close_date);",
    'line = f"Corn closed {q["close"]} on {d}"',
  ]) assert.ok(CLAIM.test(bad), bad);
  assert.ok(!CLAIM.test("out.push('Feeder futures, ' + k + ', settled ' + h.money(board.settle) + ' on ' + h.day(board.settle_date));"));
});

test('the pages that say settled read the settle fields', () => {
  const ys = fs.readFileSync(path.join(root, 'components/ys-cattle.js'), 'utf8');
  assert.match(ys, /settled ' \+ h\.money\(board\.settle\)/);
  assert.match(ys, /board\.settles_v === 2/, 'a pre-v3.7 map of last trades is not used for the barn gap');
  const ya = fs.readFileSync(path.join(root, 'components/your-area.js'), 'utf8');
  assert.match(ya, /q\.settle === 'number'/);
  const gs = fs.readFileSync(path.join(root, 'components/grain-shrink.js'), 'utf8');
  assert.match(gs, /close_kind === 'settle'/);
  const bh = fs.readFileSync(path.join(root, 'components/bids-homepage.js'), 'utf8');
  assert.match(bh, /x\.d === day && !x\.p/, 'a provisional evening day is not a settle');
  // the baked description templates say settled, and nothing bakes "closed"
  const ss = fs.readFileSync(path.join(root, 'scripts/seed_static.py'), 'utf8');
  assert.match(ss, /"Soybeans \{mon\} settled \$\{px\}\{chg\} on \{date\}\./);
  assert.doesNotMatch(ss, /"(Corn|Soybeans|Wheat) \{mon\} closed/);
});

test('the futures pages carry no baked "closed" price claim', () => {
  for (const p of ['corn', 'soybean', 'wheat', 'cattle']) {
    const h = fs.readFileSync(path.join(root, `${p}-futures-prices.html`), 'utf8');
    const desc = /<meta name="description" content="([^"]*)"/.exec(h)[1];
    assert.doesNotMatch(desc, /\bclosed\b/, `${p}: ${desc}`);
    assert.doesNotMatch(h, /<!--SEED:note-->[^<]*closed near/, `${p}: seed note`);
  }
  const soy = fs.readFileSync(path.join(root, 'soybean-futures-prices.html'), 'utf8');
  assert.doesNotMatch(soy, /\$12\.60½ \(−3¾¢\)/, 'the Oct 16 last trade is not in the soybean description');
});

test('the prices workflow runs Friday night, when the settle replaces the last trade', () => {
  const y = fs.readFileSync(path.join(root, '.github/workflows/prices.yml'), 'utf8');
  assert.match(y, /5\)\s+\{ \[ "\$HM" -lt 1400 \] \|\| \[ "\$HM" -ge 2330 \]; \} && OPEN=1/);
  assert.match(y, /6\)\s+\[ "\$HM" -lt 200 \] && OPEN=1/);
  assert.match(y, /python scripts\/test_nearby\.py/);
});
