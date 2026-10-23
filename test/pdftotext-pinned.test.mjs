/**
 * pdftotext comes from .github/actions/pdftotext, never from apt (Oct 22 2026: the apt
 * install sat silent on the runners' slow Ubuntu mirror until the 30 minute job limit,
 * twice, and the PR checks were cancelled before any test ran).
 *
 * - no workflow installs poppler-utils with apt
 * - every workflow that runs pdftotext uses the action, with a step timeout
 * - the action pins one version, checks a sha256 for each .deb, and uses no apt or sudo
 * - the PR checks' node test job gets it before the tests run
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const noComments = (s) => s.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
const WFD = '.github/workflows';
const workflows = fs.readdirSync(path.join(root, WFD)).filter((f) => /\.ya?ml$/.test(f))
  .map((f) => [f, noComments(read(`${WFD}/${f}`))]);
const USE = /uses: \.\/\.github\/actions\/pdftotext\s*$/m;

test('no workflow installs poppler-utils with apt', () => {
  for (const [f, y] of workflows) assert.doesNotMatch(y, /apt(-get)?\s+[^\n]*install[^\n]*poppler/, f);
});

test('every workflow that runs pdftotext gets it from the pinned action, with a step timeout', () => {
  let n = 0;
  for (const [f, y] of workflows) {
    if (!/\bpdftotext\b/.test(y.replace(/^\s+- name:.*$/gm, ''))) continue;
    n++;
    assert.match(y, USE, `${f} runs pdftotext: use ./.github/actions/pdftotext`);
    const steps = y.split(/\n(?=\s+- )/).filter((s) => USE.test(s));
    for (const s of steps) assert.match(s, /^\s+timeout-minutes: [1-9]\s*$/m, `${f}: the pdftotext step has a timeout under 10 minutes`);
  }
  assert.ok(n >= 6, `found ${n} workflows that run pdftotext`);
});

test('the action pins a version, checks a sha256 per .deb, and never calls apt or sudo', () => {
  const a = noComments(read('.github/actions/pdftotext/action.yml'));
  assert.match(a, /POPPLER_VERSION: '24\.02\.0-[0-9a-z.]+'/);
  assert.match(a, /LIBPOPPLER_SHA256: '[0-9a-f]{64}'/);
  assert.match(a, /POPPLER_UTILS_SHA256: '[0-9a-f]{64}'/);
  assert.match(a, /sha256sum -c/);
  assert.match(a, /--max-time \d+/, 'each download is capped');
  assert.match(a, /uses: actions\/cache@[0-9a-f]{40}/);
  assert.match(a, /key: poppler-pinned-24\.02\.0-[0-9a-z.]+-/, 'cache key carries the version');
  assert.doesNotMatch(a.slice(a.indexOf('\nruns:')), /\bapt(-get)?\b|\bsudo\b|dpkg -i/, 'the steps never call apt, sudo or dpkg -i');
  assert.match(a, /set -euo pipefail/);
  assert.match(a, /not found/, 'a missing system library fails the step');
});

test('the PR checks node test job gets pdftotext before the tests', () => {
  const y = noComments(read(`${WFD}/pr-checks.yml`));
  const job = y.slice(y.indexOf('  node-tests:'), y.indexOf('  other-checks:'));
  const at = job.search(USE);
  assert.ok(at > 0, 'node-tests uses the action');
  assert.ok(at < job.indexOf('checks.sh --only=node-test'), 'before the tests');
});

test('a job that uses a pinned Ubuntu 24.04 build runs on ubuntu-24.04, not ubuntu-latest (moving to Ubuntu 26)', () => {
  const y = noComments(read(`${WFD}/pr-checks.yml`));
  const jobs = y.slice(y.search(/^jobs:\s*$/m)).split(/\n(?=  [A-Za-z0-9_-]+:\s*\n)/).slice(1);
  let n = 0;
  for (const j of jobs) {
    if (!/uses: \.\/\.github\/actions\/(pdftotext|browser-fonts)\s*$/m.test(j)) continue;
    n++;
    assert.match(j, /^    runs-on: ubuntu-24\.04\s*(#.*)?$/m, j.split('\n')[0]);
  }
  assert.ok(n >= 1, 'the node test job uses them');
});
