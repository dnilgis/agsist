/**
 * Land auction firms capture, phase 1 (Sig approved Nov 8, 2026: Wieman, Younger, Horning, Martin's and
 * Iowa Land Company join the weekly Monday land capture).
 *
 * scripts/capture_land_firms.py saves each firm's results pages raw (robots.txt first and obeyed, 2 s or the
 * firm's Crawl-delay apart, per-firm caps). This file holds:
 *   - the script's own selftest passes (made-up pages only)
 *   - the jobs ride the existing gate on the one approved cron; no schedule is added
 *   - the fetch job cannot write: read-only permissions, no stored credentials, the private key only on the
 *     Engine checkout; only the save job pushes to raw
 *   - the workflow's archive list is exactly the script's firms that have an archive, and the save step
 *     pushes exactly the script's firm folders, all kept off main by .gitignore
 *
 *   node --test test/land-firms-capture.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const wf = read('.github/workflows/schrader-capture.yml');
const job = (name) => {
  const i = wf.indexOf(`\n  ${name}:\n`);
  assert.ok(i > 0, `job ${name}`);
  const rest = wf.slice(i + 1);
  const next = rest.slice(1).search(/\n  [a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
};
const steps = (j) => j.split(/\n      - /).slice(1);
const firms = JSON.parse(execFileSync('python3', ['-c',
  'import json,sys; sys.path.insert(0,"scripts"); import capture_land_firms as c; '
  + 'print(json.dumps({"all":[f["slug"] for f in c.FIRMS],"archive":c.ARCHIVE_FIRMS}))'], { cwd: root, encoding: 'utf8' }));

test('capture_land_firms.py selftest passes', () => {
  const out = execFileSync('python3', ['scripts/capture_land_firms.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /capture_land_firms selftest: 0 failure\(s\)/);
  assert.doesNotMatch(out, /::warning::/, 'made-up misses raise no annotation');
});

test('the five firms Sig approved, and no other', () => {
  assert.deepEqual(firms.all, ['wieman', 'younger', 'horning', 'martins', 'iowalandco']);
  assert.deepEqual(firms.archive, ['wieman', 'horning', 'martins']);
});

test('the firms jobs ride the existing gate; no schedule added', () => {
  const crons = [...wf.matchAll(/^\s*-?\s*cron:\s*(?:(['"])(.+?)\1|(\S[^#\n]*?))\s*$/gm)].map((m) => m[2] || m[3]);
  assert.deepEqual(crons, ['43 19 * * 1']);
  for (const j of ['firms-seen', 'firms', 'firms-save']) {
    assert.match(job(j), /needs\.gate\.outputs\.go == '1'/, `${j} runs only on a gate tick`);
    assert.match(job(j), /\n    permissions:\n      contents: read\n/, `${j} cannot write to this repo`);
    assert.doesNotMatch(job(j), /contents: write|git (add|commit|push) /, `${j} commits nothing to main`);
  }
});

test('the fetch job is read-only; only the save job pushes to raw', () => {
  const f = job('firms');
  assert.match(f, /uses: actions\/checkout@v4\n        with:\n          persist-credentials: false\n/);
  for (const s of steps(f)) {
    if (/PRIVATE_REPO_TOKEN/.test(s)) assert.match(s, /^name: Engine checkout/, 'the key only on the Engine checkout: ' + s.split('\n')[0]);
  }
  assert.doesNotMatch(f, /push_raw|pull_raw|feedbag/);
  assert.match(f, /run: python3 scripts\/capture_land_firms\.py --archive-for "\$ARCHIVE_FOR"\n/);
  assert.match(f, /ARCHIVE_FOR: \$\{\{ needs\.firms-seen\.outputs\.archive_for \}\}/);
  const s = job('firms-save');
  assert.match(s, /needs: \[gate, firms\]/);
  assert.doesNotMatch(s, /capture_land_firms/, 'the save job runs no fetch code');
  const push = /run: bash scripts\/push_raw\.sh "land firms capture" ([^\n]+)\n/.exec(s);
  assert.ok(push, 'the save job pushes to raw');
  assert.deepEqual(push[1].trim().split(/\s+/), firms.all.map((x) => `land/${x}`), 'every firm folder, nothing else');
  assert.doesNotMatch(job('firms-seen'), /actions\/checkout|scripts\//, 'the archive check runs no repo code');
});

test('the archive list in the workflow is the script\'s firms with an archive', () => {
  const m = /for f in ([a-z ]+); do/.exec(job('firms-seen'));
  assert.ok(m);
  assert.deepEqual(m[1].trim().split(/\s+/), firms.archive);
  assert.match(job('firms-seen'), /contents\/land\/\$f\/archive-complete\.json\?ref=raw/);
  assert.match(job('firms-seen'), /\*"HTTP 404"\*\) need=/, 'only a confirmed miss asks for the archive; any other answer means current page only');
});

test('captured pages never reach main', () => {
  for (const f of firms.all) {
    const ig = spawnSync('git', ['check-ignore', '-q', '--no-index', `land/${f}/capture/2026-11-09/current.html`], { cwd: root });
    assert.equal(ig.status, 0, `land/${f}/ is ignored`);
  }
  assert.doesNotMatch(wf, /git add[^\n]*\sland\//, "no raw land folder is ever added on main");
});
