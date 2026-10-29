/**
 * Publish only the site (.github/workflows/pages.yml, scripts/pages_publish.py).
 * The plan: feedbag notes/panels/godseye-2026-10-26/size-trim-plan.md.
 *
 * - the workflow is off until the repository variable PAGES_FROM_ACTIONS is 1,
 *   so it can sit on main while Pages still deploys from the branch
 * - it stages with pages_publish.py (which stops on a link into a left-out path)
 * - upload-pages-artifact stays on v3 (v4 drops dot files) and the uploaded
 *   tarball is checked for .well-known/security.txt before the deploy
 * - each fast job (prices, markets, fetch_bids, daily) starts the deploy after
 *   it runs, behind the same variable, from a job that holds only actions: write
 * - pages.yml is the only workflow that deploys Pages
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

test('the fast jobs start the deploy after they run, behind the same variable', () => {
  const fast = { 'prices.yml': 'fetch', 'markets.yml': 'fetch', 'fetch_bids.yml': 'fetch-bids', 'daily.yml': 'generate' };
  let seen = 0;
  for (const [f, after] of Object.entries(fast)) {
    const y = code(read(f));
    const job = (y.split(/\n(?=  pages:\n)/)[1] || '').split(/\n(?=  [A-Za-z0-9_-]+:\s*\n)/)[0];
    assert.ok(job, `${f}: no pages job`);
    assert.match(job, new RegExp(`\\n    needs: ${after}\\n`), `${f}: the pages job does not wait for ${after}`);
    assert.match(job, /vars\.PAGES_FROM_ACTIONS == '1'/, `${f}: not behind PAGES_FROM_ACTIONS`);
    assert.match(job, new RegExp(`needs\\.${after}\\.result == '(success|failure)'`), `${f}: runs whatever ${after} did`);
    assert.match(job, /\n    permissions:\n      actions: write\n    steps:/, `${f}: the pages job should hold actions: write only`);
    assert.match(job, /gh workflow run pages\.yml -R "\$GITHUB_REPOSITORY" --ref main/, `${f}: no dispatch`);
    seen++;
  }
  assert.equal(seen, 4);
});

test('pages.yml is the only workflow that deploys Pages', () => {
  const files = fs.readdirSync(WF).filter((f) => f.endsWith('.yml'));
  assert.ok(files.length > 100, `only ${files.length} workflows; the folder moved`);
  const deployers = files.filter((f) => /uses: actions\/(deploy-pages|upload-pages-artifact)@/.test(code(read(f))));
  assert.deepEqual(deployers, ['pages.yml']);
});
