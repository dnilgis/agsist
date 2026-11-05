/**
 * The Commit step of sponsor-report.yml: a run that finds main moved on takes the fresh main and puts its
 * own data files on top, never a rebase that conflicts on data/audience*.json; if main already holds the
 * same files it stops quietly. Runs the step's own script against two local clones.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wf = fs.readFileSync(path.join(root, '.github/workflows/sponsor-report.yml'), 'utf8');
const at = wf.indexOf('      - name: Commit\n');
const script = wf.slice(at).split('        run: |\n')[1].split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');

test('the Commit step does not rebase', () => {
  assert.ok(at > 0 && script.includes('git push'));
  assert.doesNotMatch(script, /pull --rebase/);
  assert.match(script, /git reset --quiet --hard origin\/main/);
});

const env = (tmp) => ({ ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', RUNNER_TEMP: tmp, GIT_CONFIG_GLOBAL: '/dev/null' });
const sh = (cmd, cwd, e) => spawnSync('bash', ['-ec', cmd], { cwd, env: e, encoding: 'utf8' });

test('a push that lost the race is redone on the fresh main, and a same-file case stops quietly', () => {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'sr-commit-'));
  const e = env(tmp);
  const files = ['data/audience.json', 'data/audience-pages.json', 'sponsor.html', 'sponsor-kit.html'];
  sh(`git init -q --bare -b main o.git && git clone -q o.git a 2>/dev/null && cd a && git checkout -q -B main && mkdir -p data scripts
    for f in ${files.join(' ')}; do echo 1 > $f; done; echo 'pass' > scripts/bake_audience.py
    git add -A && git commit -qm base && git push -q origin main && cd .. && git clone -q o.git b 2>/dev/null && cd b && git checkout -q main`, tmp, e);
  sh('echo 2 > data/audience.json && git commit -qam other && git push -q origin main', path.join(tmp, 'b'), e);
  fs.writeFileSync(path.join(tmp, 'commit.sh'), script);
  fs.writeFileSync(path.join(tmp, 'a/data/audience.json'), '3\n');
  let r = sh('bash ../commit.sh', path.join(tmp, 'a'), e);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(sh('git show main:data/audience.json', path.join(tmp, 'o.git'), e).stdout.trim(), '3', 'this run\'s file landed on top of main');
  assert.match(sh('git log --format=%s main', path.join(tmp, 'o.git'), e).stdout, /other/, 'the other run\'s commit is kept');
  // main now holds the same file this run wrote
  sh('git pull -q origin main && echo 9 > data/audience.json && git commit -qam o9 && git push -q origin main', path.join(tmp, 'b'), e);
  fs.writeFileSync(path.join(tmp, 'a/data/audience.json'), '9\n');
  r = sh('bash ../commit.sh', path.join(tmp, 'a'), e);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /already holds/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
