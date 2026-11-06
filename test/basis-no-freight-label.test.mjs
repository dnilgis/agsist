// /basis shows the interior-to-Gulf spread as a gap between two bids, never as "freight" (Nov 4 site panel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../basis.html', import.meta.url), 'utf8');
test('the spread box is not labelled freight', () => {
  assert.ok(!/Freight and handling/i.test(html));
  assert.ok(!/wedge your basis/i.test(html));
  assert.ok(html.includes("' minus '"), 'the box names the two bids it subtracts');
});
test('the transport link does not claim basis moves with freight', () => {
  assert.ok(!/how basis has moved with it/i.test(html));
});
