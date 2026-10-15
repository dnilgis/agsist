// cattle-futures-prices.html: what the title, description and first-screen
// note may call "closed". 2026-10-15 head to head: they said "Live cattle
// closed near $223.95, feeders near $340.83 ... Oct 14" while the Oct 14
// settles were $223.90 and $340.95. Yahoo kept the last trade in the day's
// bar from 1:16 p.m. CT until the 11:01 p.m. CT fetch, and every bake in that
// window read the last trade as the close.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function py(code) {
  const pre = `import sys, json\nsys.path.insert(0, ${JSON.stringify(path.join(root, 'scripts'))})\nimport seed_static as s\n`;
  return JSON.parse(execFileSync('python3', ['-c', pre + code], { encoding: 'utf8' }));
}

// The two Oct 14 states of the live cattle bar, as data/prices.json held them.
const lastTrade = { close: 223.95, close_date: '2026-10-14', netChange: -0.675, prev_date: '2026-10-13' };
const settled = { close: 223.89999, close_date: '2026-10-14', netChange: -0.72501, prev_date: '2026-10-13' };

test('a fetch after the bell but before 11 p.m. CT is a last trade, not a close', () => {
  for (const fetched of ['2026-10-14T18:16:34Z', '2026-10-14T23:46:09Z', '2026-10-15T03:46:07Z']) {
    const [live] = py(`print(json.dumps(s.quote_state(${JSON.stringify(lastTrade)}, ${JSON.stringify(fetched)}, "cattle")))`);
    assert.equal(live, true, fetched);
    const sc = py(`print(json.dumps(s.settled_close(${JSON.stringify(lastTrade)}, ${JSON.stringify(fetched)}, "cattle")))`);
    assert.equal(sc.date, '2026-10-13', `${fetched}: the finished session is the day before`);
    assert.equal(sc.px, 224.625);
    assert.equal(sc.net, null);
  }
});

test('from 11 p.m. CT on the bar is the settle and is called closed', () => {
  for (const fetched of ['2026-10-15T04:01:18Z', '2026-10-15T05:31:30Z']) {
    const [live, label] = py(`print(json.dumps(s.quote_state(${JSON.stringify(settled)}, ${JSON.stringify(fetched)}, "cattle")))`);
    assert.equal(live, false, fetched);
    assert.equal(label, 'Oct 14');
    const sc = py(`print(json.dumps(s.settled_close(${JSON.stringify(settled)}, ${JSON.stringify(fetched)}, "cattle")))`);
    assert.equal(sc.date, '2026-10-14');
    assert.ok(Math.abs(sc.px - 223.9) < 1e-3);
  }
});

test('Friday last trade fetched Friday afternoon is not Friday\'s close on Saturday', () => {
  const fri = { close: 224.60001, close_date: '2026-10-09', netChange: 2.72501, prev_date: '2026-10-08' };
  const sc = py(`print(json.dumps(s.settled_close(${JSON.stringify(fri)}, "2026-10-09T18:16:11Z", "cattle")))`);
  assert.equal(sc.date, '2026-10-08');
  assert.ok(Math.abs(sc.px - 221.875) < 1e-6, 'the Oct 8 settle, which Yahoo also posted at 04:01 UTC Oct 9');
});
