// data/hog-cash.json: national cash hogs (USDA AMS LM_HG201) and the pork cutout
// (LM_PK602), read by scripts/fetch_hog_cash.py in the cattle cash run. No page
// reads it yet; it carries a daily_line for the Daily (wired later).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wf = fs.readFileSync(path.join(root, '.github/workflows/cattle-cash.yml'), 'utf8');

test('the hog cash selftest passes on the real Nov 2, 2026 reports', () => {
  const out = execFileSync('python3', ['scripts/fetch_hog_cash.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /all hog cash checks pass/);
  assert.doesNotMatch(out, /FAIL/);
});

test('the cattle cash run checks the hog reader before any fetch and never lets it block the cattle file', () => {
  const self = wf.indexOf('python scripts/fetch_hog_cash.py --selftest');
  const fetch = wf.indexOf('run: python scripts/fetch_hog_cash.py\n');
  assert.ok(self > 0 && self < fetch && self < wf.indexOf('run: python scripts/fetch_cattle_cash.py\n'), 'selftest first');
  const step = wf.slice(wf.lastIndexOf('- name:', fetch), fetch);
  assert.match(step, /continue-on-error: true/, 'a hog failure never stops the commit of the cattle file');
  assert.match(step, /inputs\.hog_probe/, 'a hog probe run fetches nothing');
  assert.ok(fetch < wf.indexOf('- name: Commit if changed'), 'fetched before the commit step');
  assert.match(wf, /FILES="[^"]*data\/hog-cash\.json[^"]*"/, 'main gets the hog file');
  assert.doesNotMatch(wf.split('\n').find((l) => l.includes('FILES="')), /hog-cash-raw/, 'never the raw probe folder');
});

test('the MARS key reaches only the probe step, never a URL or the fetch', () => {
  const i = wf.indexOf('MARS_API_KEY');
  assert.ok(i > 0 && i < wf.indexOf('run: python scripts/fetch_hog_cash.py --probe'));
  assert.equal(wf.split('MARS_API_KEY: ${{ secrets.MARS_API_KEY }}').length, 2, 'one step only');
  assert.ok(i > wf.indexOf('inputs.hog_probe }}'), 'inside the hog probe step');
});
