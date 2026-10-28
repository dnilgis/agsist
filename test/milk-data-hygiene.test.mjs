// Dairy data hygiene (dairy board, Oct 27-28, 2026, build 5 first half).
// 1. The mailbox file kept 2 national months while each report prints 3 (this
//    month, last month and a year ago in its All Federal Order Areas row).
// 2. Saturday reads of the old continuous DC=F quote made 9 of 12 one-day
//    Class III spikes; scripts/milk_settles.py reads one value per session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const mb = JSON.parse(fs.readFileSync(new URL('data/dairy-mailbox.json', root), 'utf8'));
const py = (args) => execFileSync('python3', args, { cwd: root, encoding: 'utf8' });

test('mailbox history holds June 2025, March, May and June 2026', () => {
  assert.equal(mb.history['2026-06'], 20.18);
  assert.equal(mb.history['2026-05'], 20.43, 'May = June 20.18 + 0.25 (report: down $0.25 from May)');
  assert.equal(mb.history['2025-06'], 20.55, 'June 2025 = 20.18 + 0.37 (report: down $0.37 from a year earlier)');
  assert.equal(mb.history['2026-03'], 18.84);
  // the changes the file states and the history agree to the cent
  assert.ok(Math.abs(mb.value - mb.history['2026-05'] - mb.prev_month_change) < 0.006);
  assert.ok(Math.abs(mb.value - mb.history['2025-06'] - mb.year_ago_change) < 0.006);
});

test('the mailbox reader keeps the report\'s own last-month and year-ago figures', () => {
  assert.match(py(['scripts/fetch_mailbox.py', '--selftest']), /all mailbox checks pass/);
});

test('futures sessions: Saturday glitch reads never become a session value', () => {
  assert.match(py(['scripts/milk_settles.py', '--selftest']), /all milk settle checks pass/);
});
