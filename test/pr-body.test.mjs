/* pr-body.yml: removes footer lines from a pull request body, then re-runs a failed guard job.
 * - pull requests to main only, no schedule, same-repository branches only
 * - the token can edit pull requests and re-run jobs, nothing else beyond reading code
 * - it reuses ai_footer_check's strip(); the check itself stays in pr-checks
 * - the script's own selftest passes
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wf = fs.readFileSync(path.join(root, '.github/workflows/pr-body.yml'), 'utf8');
const py = fs.readFileSync(path.join(root, 'scripts/dev/pr_body_strip.py'), 'utf8');

test('the workflow: pull requests to main, no schedule, same repository, narrow token', () => {
  assert.match(wf, /\non:\n  pull_request:\n    branches: \[main\]/);
  assert.doesNotMatch(wf, /schedule:|workflow_run:|pull_request_target/);
  assert.match(wf, /head\.repo\.full_name == github\.repository/);
  assert.match(wf, /^permissions:\n  contents: read\n  pull-requests: write\n  actions: write\n\n/m);
  assert.equal((wf.match(/permissions:/g) || []).length, 1, 'no job widens it');
});

test('the script reuses the footer check and verifies the edit held', () => {
  assert.match(py, /from ai_footer_check import found, strip/);
  assert.match(py, /the footer came back after the edit/);
  assert.match(fs.readFileSync(path.join(root, '.github/workflows/pr-checks.yml'), 'utf8'), /ai_footer_check\.py/, 'the check stays in pr-checks');
});

test('selftest', () => {
  const out = execFileSync('python3', [path.join(root, 'scripts/dev/pr_body_strip.py'), '--selftest'], { encoding: 'utf8' });
  assert.match(out, /FAILS=0/);
});
