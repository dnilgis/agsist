// Every Daily run's fact check is kept (2026-10-18). fact_check_briefing.py
// writes $RUNNER_TEMP/fact-check.json and the runner used to throw it away,
// so the Oct 24 review of report vs block mode had nothing to read. daily.yml
// now saves it to the raw branch (never deployed) with scripts/push_raw.sh,
// and the save can never fail the job or change the fact check's own mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const yml = fs.readFileSync(path.join(root, '.github/workflows/daily.yml'), 'utf8');

function step(name) {
  const i = yml.indexOf(`- name: ${name}`);
  assert.ok(i >= 0, `daily.yml has the step "${name}"`);
  const rest = yml.slice(i + 1);
  const j = rest.search(/\n      - name: /);
  return j < 0 ? rest : rest.slice(0, j);
}

test('the fact check is saved to raw on every run, after the check, never failing the job', () => {
  const fc = step('GATE 2f, fact check against the source data');
  const save = step('Save the fact check to the raw branch');
  assert.ok(yml.indexOf('- name: GATE 2f') < yml.indexOf('- name: Save the fact check to the raw branch'), 'saved after the check');
  assert.match(save, /if: \$\{\{ !cancelled\(\) \}\}/, 'runs when the fact check failed too');
  assert.match(save, /continue-on-error: true/, 'a failed save never fails the job');
  assert.match(save, /bash scripts\/push_raw\.sh "daily fact check" "\$d" \|\| echo "::warning::/, 'push failure is a warning');
  assert.match(save, /daily-fact-check\/\$\(TZ=America\/Chicago date \+%F\)-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\.json/, 'one file per run, dated');
  assert.match(save, /\$RUNNER_TEMP\/fact-check\.json/, 'reads the file the fact check writes');
  // the selftest's fixture findings are not what gets saved
  assert.match(fc, /rm -f "\$RUNNER_TEMP\/fact-check\.json"\n\s+python scripts\/fact_check_briefing\.py/);
  // unchanged: report mode, and a failing selftest still fails the step
  assert.match(fc, /FACT_CHECK_MODE: report\n/);
  assert.match(fc, /python scripts\/test_fact_check\.py > \/tmp\/fc-selftest\.txt 2>&1; then[\s\S]*?exit 1\n\s+fi/);
});

test('the saved copy never reaches main', () => {
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^\/daily-fact-check\/$/m);
  const add = yml.split('\n').filter((l) => /git add /.test(l));
  assert.ok(add.length && add.every((l) => !/daily-fact-check|\s-A\b|\s\.\s*$/.test(l)), add.join('\n'));
});
