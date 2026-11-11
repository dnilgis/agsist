/* The published PRF climate and forecast files carry data, not the name of the job that writes them.
 *
 *   node --test test/prf-data-no-builder-name.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['climate-indices.json', 'seasonal-fc.json']) {
  test(`data/prf/${name} has no written_by key and no script path`, () => {
    const file = path.join(root, 'data', 'prf', name);
    if (!fs.existsSync(file)) return;   // a job may not have written it yet
    const text = fs.readFileSync(file, 'utf8');
    const d = JSON.parse(text);
    assert.ok(!('written_by' in d), 'no written_by key');
    assert.doesNotMatch(text.slice(0, 4000), /scripts\/[a-z_]+\.(py|mjs|js)/);
  });
}
