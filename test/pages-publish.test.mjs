/**
 * Publish only the site (.github/workflows/pages.yml, scripts/pages_publish.py).
 * The plan: feedbag notes/panels/godseye-2026-10-26/size-trim-plan.md.
 *
 * - the workflow is off until the repository variable PAGES_FROM_ACTIONS is 1,
 *   so it can sit on main while Pages still deploys from the branch
 * - no schedule of its own (a new cron is Sig's call): fetch_bids runs every 15
 *   minutes all week and kicks on every run, carrying every other bot commit
 * - it stages with pages_publish.py (which stops on a link into a left-out path)
 * - upload-pages-artifact stays on v3 (v4 drops dot files) and the uploaded
 *   tarball is checked for .well-known/security.txt before the deploy
 * - each fast job (prices, markets, fetch_bids, daily) runs .github/pages-kick.sh
 *   right after its push (a repository_dispatch: a GITHUB_TOKEN push starts no
 *   workflow), behind the same variable, and before any wait for the live site
 * - pages.yml is the only workflow that deploys Pages
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WF = path.join(root, '.github/workflows');
const read = (f) => fs.readFileSync(path.join(WF, f), 'utf8');
const code = (s) => s.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
const pages = code(read('pages.yml'));

test('pages.yml is off until PAGES_FROM_ACTIONS is 1', () => {
  const jobs = [...pages.slice(pages.search(/^jobs:\s*$/m)).matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)].map((m) => m[1]);
  assert.deepEqual(jobs, ['deploy'], `jobs: ${jobs}`);
  assert.match(pages, /^  deploy:\n    if: \$\{\{ vars\.PAGES_FROM_ACTIONS == '1' \}\}$/m);
  // a new cron is Sig's call (STANDING-DECISIONS, Oct 21): the fast jobs' dispatches are its clock
  assert.doesNotMatch(pages, /^\s*schedule:/m, 'pages.yml has no schedule of its own');
});

test('pages.yml stages the filtered site and checks the uploaded tarball before deploying', () => {
  const at = (re) => { const i = pages.search(re); assert.ok(i >= 0, `missing ${re}`); return i; };
  const stage = at(/python3 scripts\/pages_publish\.py --stage _site/);
  const upload = at(/uses: actions\/upload-pages-artifact@v3\b/);
  const tar = at(/tar -tf "\$RUNNER_TEMP\/artifact\.tar"/);
  const dot = at(/grep -qx '\.\/\.well-known\/security\.txt'/);
  const deploy = at(/uses: actions\/deploy-pages@/);
  assert.ok(stage < upload && upload < tar && tar < dot && dot < deploy, 'stage, upload, tarball check, deploy: out of order');
  assert.doesNotMatch(pages, /upload-pages-artifact@v[4-9]/, 'v4 and later leave .well-known out');
  assert.match(pages, /path: _site/);
  assert.match(pages, /test -f _site\/\.well-known\/security\.txt/);
  // the budget walks the checkout: measured after staging it would count _site twice
  assert.ok(pages.indexOf('check_site_budget.py') < stage, 'the budget check runs before staging');
});

// the steps of a workflow (six-space `- ` items, as every workflow here writes them)
const steps = (y) => y.split(/\n(?=      - )/).slice(1);
const KICK = 'bash .github/pages-kick.sh';

test('the fast jobs start the deploy right after they push, behind the same variable', () => {
  // workflow: how many of its steps start the deploy
  const fast = { 'prices.yml': 1, 'markets.yml': 1, 'fetch_bids.yml': 1, 'daily.yml': 3 };
  let seen = 0;
  for (const [f, want] of Object.entries(fast)) {
    const y = code(read(f));
    const kicks = steps(y).filter((s) => s.includes(KICK));
    assert.equal(kicks.length, want, `${f}: ${kicks.length} steps start the deploy, want ${want}`);
    for (const s of kicks) {
      const name = (s.match(/- name: (.*)/) || [, '?'])[1];
      assert.match(s, /\n {10}GH_TOKEN: \$\{\{ (github\.token|secrets\.GITHUB_TOKEN) \}\}/, `${f} "${name}": no GH_TOKEN`);
      assert.match(s, /\n {10}PAGES_FROM_ACTIONS: \$\{\{ vars\.PAGES_FROM_ACTIONS \}\}/, `${f} "${name}": not behind PAGES_FROM_ACTIONS`);
      // in a step that pushes, the kick comes after the push
      const push = s.lastIndexOf('git push');
      if (push >= 0) assert.ok(s.indexOf(KICK) > push, `${f} "${name}": the deploy starts before the push`);
      // a step that waits for agsist.com to serve the new file kicks before it waits
      const wait = s.indexOf('url="https://agsist.com/');
      if (wait >= 0) assert.ok(s.indexOf(KICK) < wait, `${f} "${name}": waits for the live site before starting the deploy`);
      seen++;
    }
  }
  assert.equal(seen, 6);
  // fetch_bids is the clock for every other bot commit: it kicks whether or not it committed
  const fb = steps(code(read('fetch_bids.yml'))).find((s) => s.includes(KICK));
  assert.match(fb, /if: \$\{\{ !cancelled\(\) && github\.event\.inputs\.dry_run != 'true' \}\}/);
  assert.ok(!fb.includes('git push'), 'fetch_bids starts the deploy in its own step, after the commit step');
  // the event the kick sends is the one pages.yml listens for
  assert.match(pages, /repository_dispatch:\n\s+types: \[pages-deploy\]/);
  assert.match(fs.readFileSync(path.join(root, '.github/pages-kick.sh'), 'utf8'), /-f event_type=pages-deploy/);
});

test('pages-kick.sh: off without the variable, never fails, sends the dispatch', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-kick-'));
  const log = path.join(tmp, 'gh.log');
  const gh = (rc) => { fs.writeFileSync(path.join(tmp, 'gh'), `#!/bin/sh\necho "$@" >> "${log}"\nexit ${rc}\n`, { mode: 0o755 }); };
  const run = (env) => spawnSync('bash', [path.join(root, '.github/pages-kick.sh')], {
    encoding: 'utf8', env: { PATH: `${tmp}:${process.env.PATH}`, GITHUB_REPOSITORY: 'o/r', ...env } });
  try {
    gh(0);
    let r = run({ GH_TOKEN: 't' });
    assert.equal(r.status, 0); assert.equal(r.stdout, ''); assert.ok(!fs.existsSync(log), 'no call while the variable is unset');
    r = run({ GH_TOKEN: 't', PAGES_FROM_ACTIONS: '0' });
    assert.equal(r.status, 0); assert.ok(!fs.existsSync(log), 'no call while the variable is 0');
    r = run({ PAGES_FROM_ACTIONS: '1' });
    assert.equal(r.status, 0); assert.match(r.stdout, /::warning::site deploy not started/);
    r = run({ GH_TOKEN: 't', PAGES_FROM_ACTIONS: '1' });
    assert.equal(r.status, 0); assert.match(r.stdout, /site deploy started/);
    assert.equal(fs.readFileSync(log, 'utf8').trim(), 'api -X POST repos/o/r/dispatches -f event_type=pages-deploy');
    gh(1);
    r = run({ GH_TOKEN: 't', PAGES_FROM_ACTIONS: '1' });
    assert.equal(r.status, 0, 'a failed start never fails the job that pushed');
    assert.match(r.stdout, /::warning::could not start the site deploy/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('pages.yml is the only workflow that deploys Pages', () => {
  const files = fs.readdirSync(WF).filter((f) => f.endsWith('.yml'));
  assert.ok(files.length > 100, `only ${files.length} workflows; the folder moved`);
  const deployers = files.filter((f) => /uses: actions\/(deploy-pages|upload-pages-artifact)@/.test(code(read(f))));
  assert.deepEqual(deployers, ['pages.yml']);
});
