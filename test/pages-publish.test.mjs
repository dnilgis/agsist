/**
 * Publish only the site (.github/workflows/pages.yml, scripts/pages_publish.py).
 * The plan: the private repo the private notes.
 *
 * - the workflow is off until the repository variable PAGES_FROM_ACTIONS is 1,
 *   so it can sit on main while Pages still deploys from the branch
 * - no schedule of its own (a new cron is a product decision): fetch_bids runs every 15
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
import vm from 'node:vm';
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
  // a new cron is a product decision (a site rule, Oct 21): the fast jobs' dispatches are its clock
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

// Nov 5, 2026 (hide how the site works): the published copies of components/*.js|css and css/*.css are
// minified in _site; the repository files, names and ?v= URLs stay; no source map; one pinned minifier.
test('pages.yml minifies the published copy with the pinned minifier, and no source map ships', () => {
  const pub = fs.readFileSync(path.join(root, 'scripts/pages_publish.py'), 'utf8');
  const ver = (pub.match(/^TERSER_VERSION = "(\d+\.\d+\.\d+)"/m) || [])[1];
  assert.ok(ver, 'pages_publish.py pins TERSER_VERSION to an exact version');
  assert.match(pages, new RegExp(`--prefix "\\$RUNNER_TEMP/minify" "terser@${ver.replace(/\./g, '\\.')}"`));
  assert.match(pages, /--ignore-scripts --prefix "\$RUNNER_TEMP\/minify"/);
  assert.match(pages, /python3 scripts\/pages_publish\.py --stage _site --minify --terser "\$RUNNER_TEMP\/minify\/node_modules\/terser"/);
  assert.match(pages, /_site\/components\/\*\.map/);
  const prc = read('pr-checks.yml');
  assert.match(prc, new RegExp(`TERSER_VERSION: '${ver.replace(/\./g, '\\.')}'`), 'pr-checks installs the same terser');
  assert.doesNotMatch(pub, /sourceMap: true/);
  const r = spawnSync('python3', ['scripts/pages_publish.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('every page script minifies, parses, and leaves the repository copy as it was', { skip: !process.env.TERSER_PATH && !process.env.CI && 'no TERSER_PATH (pr-checks installs it)' }, () => {
  assert.ok(process.env.TERSER_PATH, 'TERSER_PATH is set in CI (pr-checks.yml installs terser)');
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'minify-'));
  const rels = fs.readdirSync(path.join(root, 'components')).filter((f) => /\.(js|css)$/.test(f)).map((f) => `components/${f}`)
    .concat(fs.readdirSync(path.join(root, 'css')).filter((f) => f.endsWith('.css')).map((f) => `css/${f}`));
  const code = [
    'import sys, json; sys.path.insert(0, "scripts")',
    'import pages_publish as P',
    'keep = json.loads(sys.argv[1]); P.stage(P.ROOT, sys.argv[2], keep)',
    'print(json.dumps(P.minify_published(sys.argv[2], keep, sys.argv[3])))',
  ].join('\n');
  const r = spawnSync('python3', ['-c', code, JSON.stringify(rels), tmp, process.env.TERSER_PATH], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  assert.deepEqual(m.kept, [], 'every file minified');
  assert.ok(m.after < m.before * 0.8, `minified ${m.before} -> ${m.after}`);
  for (const rel of rels) {
    const out = fs.readFileSync(path.join(tmp, rel), 'utf8');
    if (rel.endsWith('.js')) assert.doesNotThrow(() => new vm.Script(out), rel);
    assert.ok(out.length <= fs.statSync(path.join(root, rel)).size, `${rel} grew`);
  }
  // the repository files are untouched (stage hard-links them; the minify step writes new files)
  const st = spawnSync('git', ['status', '--porcelain', '--', 'components', 'css'], { cwd: root, encoding: 'utf8' });
  assert.equal(st.stdout.trim(), '', 'the repository copies changed');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the staged service worker has no comment history, keeps its version and parses', { skip: !process.env.TERSER_PATH && !process.env.CI && 'no TERSER_PATH (pr-checks installs it)' }, () => {
  assert.ok(process.env.TERSER_PATH, 'TERSER_PATH is set in CI (pr-checks.yml installs terser)');
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'minify-sw-'));
  const code = [
    'import sys, json; sys.path.insert(0, "scripts")',
    'import pages_publish as P',
    'P.stage(P.ROOT, sys.argv[1], ["sw.js"])',
    'print(json.dumps(P.minify_published(sys.argv[1], ["sw.js"], sys.argv[2])))',
  ].join('\n');
  const r = spawnSync('python3', ['-c', code, tmp, process.env.TERSER_PATH], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).kept, [], 'sw.js minified');
  const out = fs.readFileSync(path.join(tmp, 'sw.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(out));
  assert.doesNotMatch(out, /fx\//);
  assert.doesNotMatch(out, /assigned by the lead/);
  const ver = (fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/^var CACHE_VERSION = (\d+);/m) || [])[1];
  assert.match(out, new RegExp(`var CACHE_VERSION ?= ?${ver};`));
  assert.ok(fs.readFileSync(path.join(root, 'sw.js'), 'utf8').includes('assigned by the lead'), 'the repository copy keeps its history');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a published page leaves out its comments and keeps everything else (strip_html, Nov 6)', () => {
  const page = [
    '<!doctype html><!-- how the page is built --><html><!--[if IE]>old<![endif]--><head>',
    '<style>/* why */ .a { b: 1 }</style>',
    '<script type="application/ld+json">{"u":"https://x.y/a//b","c":"/* not a comment */"}</script>',
    '<script>// the rule\nvar u = "https://x.y/z"; f(u);</script><script src="/c.js"></script></head>',
    '<body><pre><!-- shown --></pre><textarea><!-- typed --></textarea><p>a <!-- note --> b</p></body></html>',
  ].join('\n');
  const code = 'import sys, json; sys.path.insert(0, "scripts"); import pages_publish as P; print(json.dumps(P.strip_html(sys.argv[1])))';
  const r = spawnSync('python3', ['-c', code, page], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  for (const gone of ['how the page is built', '<!-- note -->', '/* why */']) assert.ok(!out.includes(gone), gone);
  for (const kept of ['<!--[if IE]>old<![endif]-->', '<pre><!-- shown --></pre>', '<textarea><!-- typed --></textarea>',
    '{"u":"https://x.y/a//b","c":"/* not a comment */"}', '<script src="/c.js"></script>', '// the rule']) assert.ok(out.includes(kept), kept);
  assert.match(out, /\.a\{b: ?1\}/, 'inline styles go through strip_css');
});

test('every top-level page compacts: no inline script left as written, each still parses, the repository copy unchanged', { skip: !process.env.TERSER_PATH && !process.env.CI && 'no TERSER_PATH (pr-checks installs it)' }, () => {
  assert.ok(process.env.TERSER_PATH, 'TERSER_PATH is set in CI (pr-checks.yml installs terser)');
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'compact-'));
  const rels = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
  // the pages' state before this test: CI may already have built a branch's What's new note into index.html and
  // changelog.html (Nov 7, #401), so "unchanged" means unchanged by this test, not clean against the commit
  const status = () => spawnSync('git', ['status', '--porcelain', '--', ...rels], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const hash = () => spawnSync('git', ['hash-object', '--', ...rels], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const before = { st: status(), h: hash() };
  const code = [
    'import sys, json; sys.path.insert(0, "scripts")',
    'import pages_publish as P',
    'keep = json.loads(sys.argv[1]); P.stage(P.ROOT, sys.argv[2], keep)',
    'print(json.dumps(P.compact_pages(sys.argv[2], keep, sys.argv[3])))',
  ].join('\n');
  const r = spawnSync('python3', ['-c', code, JSON.stringify(rels), tmp, process.env.TERSER_PATH], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  assert.equal(m.kept, 0, 'every inline script with a comment was rebuilt');
  assert.ok(m.scripts > 50 && m.after < m.before, JSON.stringify(m));
  for (const rel of rels) {
    const out = fs.readFileSync(path.join(tmp, rel), 'utf8');
    const outside = out.replace(/<(script|style|pre|textarea)\b[\s\S]*?<\/\1\s*>/gi, '');
    assert.doesNotMatch(outside.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/g, ''), /<!--[\s\S]*?-->/, `${rel}: an HTML comment is published`);
    for (const [, attrs, body] of out.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (/\bsrc\s*=/i.test(attrs) || /type\s*=\s*["']?(?!text\/javascript|application\/javascript)[^"'\s>]+/i.test(attrs)) continue;
      assert.doesNotThrow(() => new vm.Script(body), `${rel}: an inline script no longer parses`);
    }
  }
  assert.equal(status(), before.st, 'the repository pages changed');
  assert.equal(hash(), before.h, 'the repository pages changed');
  fs.rmSync(tmp, { recursive: true, force: true });
});
