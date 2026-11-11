/* The PRF climate and forecast files are model inputs: not in the public tree at all,
 * saved to the private repo by the jobs that write them, and, wherever they are
 * written, without the name of the job that writes them.
 *
 *   node --test test/prf-data-no-builder-name.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
for (const [name, wf, script] of [['climate-indices.json', 'climate-indices.yml', 'fetch_climate_indices.py'],
                                  ['seasonal-fc.json', 'seasonal-models.yml', 'fetch_seasonal_models.py']]) {
  test(`data/prf/${name} is not published; ${wf} saves it to the private repo`, () => {
    assert.ok(!fs.existsSync(path.join(root, 'data', 'prf', name)), `data/prf/${name} is gone from the public tree`);
    const y = read(`.github/workflows/${wf}`);
    assert.match(y, new RegExp(`push_raw\\.sh "[a-z ]+" private/prf/${name.replace('.', '\\.')}`), 'saved to private-data');
    assert.doesNotMatch(y, new RegExp(`git add[^\\n]*${name.replace('.', '\\.')}`), 'never committed to main');
  });
  test(`${script} writes ${name} with no written_by key`, () => {
    const py = read(`scripts/${script}`);
    assert.doesNotMatch(py, /"written_by":/, 'the writer sets no written_by key');
  });
}
