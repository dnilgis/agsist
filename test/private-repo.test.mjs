/**
 * Off the public repo (Sig, Oct 20 2026). The raw and references branches, the
 * session skills and four job files no page reads moved to the private repo
 * dnilgis/agsistretired. The site keeps running exactly as before: pages read
 * only public files on main, which stay.
 *
 * - scripts/private_remote.sh picks the remote: RAW_REMOTE, else the private
 *   repo with PRIVATE_REPO_TOKEN (Actions), else origin. The token never
 *   reaches a log line.
 * - Every workflow step that saves or reads a private branch passes the secret.
 *   Jobs that publish site data save softly (RAW_SOFT=1: a warning, the data
 *   still ships); build inputs are pulled hard (no dark maps); paid batch
 *   records and the FSA files are saved hard (a lost record costs money, and the
 *   FSA manifest on main must match what was saved).
 * - data/cron-health.json, data/audit.json, data/bids-withheld.json and
 *   data/editorial-notes.md are read by no page: they live on the private
 *   repo's private-data branch at private/data/, and the jobs pull and save
 *   them there.
 * - .claude/skills is ignored here; the skills are in the private repo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const WF = path.join(root, '.github/workflows');
const workflows = fs.readdirSync(WF).filter((f) => f.endsWith('.yml'));
const TOKEN_ENV = 'PRIVATE_REPO_TOKEN: ${{ secrets.PRIVATE_REPO_TOKEN }}';
const CALLS = /scripts\/(push_raw|pull_raw|fetch_private|private_remote)\.sh|agsistretired/;

// Steps of one workflow (every workflow here puts steps at six spaces).
function steps(file) {
  const y = read(`.github/workflows/${file}`);
  return y.split(/\n(?=      - )/).slice(1).map((s) => {
    const code = s.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    return { text: s, code, name: (s.match(/name: (.*)/) || [])[1] || s.slice(0, 60) };
  }).filter((s) => /^\s*(- )?run:|\n\s+run:/m.test(s.code));
}

// A bare environment: never the real secret, whatever this shell has set.
const bareEnv = (extra = {}) => {
  const e = { ...process.env };
  for (const k of ['PRIVATE_REPO_TOKEN', 'RAW_REMOTE', 'RAW_SOFT', 'RAW_BRANCH', 'GITHUB_STEP_SUMMARY', 'GIT_CONFIG_COUNT']) delete e[k];
  return { ...e, ...extra };
};

test('private_remote.sh: RAW_REMOTE wins, then the private repo with the token, then origin; the token is never printed', () => {
  const tok = 'github_pat_' + 'A1b2C3'.repeat(6);
  const show = (extra) => spawnSync('bash', ['-c', `. scripts/private_remote.sh; printf '%s|%s|%s|%s\\n' "$REMOTE" "$WHERE" "\${GIT_CONFIG_KEY_0:-}" "\${GIT_CONFIG_VALUE_0-unset}"; printf 'fatal: https://x-access-token:%s@github.com/x and %s\\n' "\${PRIVATE_REPO_TOKEN:-}" "\${PRIVATE_REPO_TOKEN:-}" | hide`],
    { cwd: root, encoding: 'utf8', env: bareEnv(extra) });
  const withTok = show({ PRIVATE_REPO_TOKEN: tok });
  const [line, hidden] = withTok.stdout.trim().split('\n');
  const [remote, where, key, val] = line.split('|');
  assert.equal(remote, `https://x-access-token:${tok}@github.com/dnilgis/agsistretired.git`);
  assert.equal(where, 'the private repo (dnilgis/agsistretired)');
  assert.ok(!where.includes(tok));
  assert.equal(key, 'http.https://github.com/.extraheader', "checkout's own token header is cleared for these calls");
  assert.equal(val, '');
  assert.ok(!hidden.includes(tok) && hidden.includes('x-access-token:***@'), hidden);
  assert.equal(show({ PRIVATE_REPO_TOKEN: tok, RAW_REMOTE: '/tmp/clone' }).stdout.split('|')[0], '/tmp/clone', 'RAW_REMOTE wins');
  const none = show({}).stdout.split('|');
  assert.deepEqual(none.slice(0, 2), ['origin', 'origin'], 'no token: the old branches on origin');
});

// ---------------------------------------------------------------- the scripts, against a throwaway remote

function sandbox() {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'privrepo-'));
  const g = (args, cwd) => git(['-c', 'user.name=t', '-c', 'user.email=t@x', '-c', 'init.defaultBranch=main', ...args], cwd);
  g(['init', '-q', '--bare', 'priv.git'], t);
  const w = path.join(t, 'work');
  g(['init', '-q', 'work'], t);
  fs.mkdirSync(path.join(w, 'scripts'));
  for (const s of ['push_raw.sh', 'pull_raw.sh', 'fetch_private.sh', 'private_remote.sh', 'redact_secrets.py']) {
    fs.copyFileSync(path.join(root, 'scripts', s), path.join(w, 'scripts', s));
  }
  fs.writeFileSync(path.join(w, '.gitignore'), '/private/\n');
  g(['add', '-A'], w); g(['commit', '-qm', 'main'], w);
  const s = path.join(t, 'seed');
  g(['init', '-q', 'seed'], t);
  fs.writeFileSync(path.join(s, 'README.md'), 'private-data\n');
  fs.mkdirSync(path.join(s, 'private/data'), { recursive: true });
  fs.writeFileSync(path.join(s, 'private/data/cron-health.json'), '{"generated_at":"2026-10-20T05:00:00Z"}\n');
  g(['add', '-A'], s); g(['commit', '-qm', 'seed'], s);
  g(['push', '-q', path.join(t, 'priv.git'), 'HEAD:private-data', 'HEAD:raw'], s);
  return { t, w, priv: path.join(t, 'priv.git') };
}
const run = (sb, script, args, extra = {}) => spawnSync('bash', [`scripts/${script}`, ...args], {
  cwd: sb.w, encoding: 'utf8', env: bareEnv({ RAW_REMOTE: sb.priv, RAW_WT: path.join(sb.t, 'wt'), RAW_SLEEP: '0', ...extra }),
});

test('a job file goes to private-data and comes back, never onto main', () => {
  const sb = sandbox();
  try {
    const back = run(sb, 'pull_raw.sh', ['private/data/cron-health.json'], { RAW_BRANCH: 'private-data' });
    assert.equal(back.status, 0, back.stdout + back.stderr);
    assert.match(fs.readFileSync(path.join(sb.w, 'private/data/cron-health.json'), 'utf8'), /2026-10-20T05/);
    fs.writeFileSync(path.join(sb.w, 'private/data/cron-health.json'), '{"generated_at":"2026-10-20T12:00:00Z"}\n');
    const r = run(sb, 'push_raw.sh', ['cron health', 'private/data/cron-health.json'], { RAW_BRANCH: 'private-data', RAW_SOFT: '1' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /raw: pushed \w+ \(1 file\(s\)\) to private-data on /);
    assert.match(git(['show', 'private-data:private/data/cron-health.json'], sb.priv), /12:00:00Z/);
    assert.equal(git(['status', '--porcelain'], sb.w), '', 'nothing staged or left on main');
    assert.ok(fs.existsSync(path.join(sb.t, 'wt', 'README.md')), 'the branch worktree is outside the checkout');
  } finally { fs.rmSync(sb.t, { recursive: true, force: true }); }
});

test('RAW_SOFT=1: a save that cannot land is a warning and a job summary line, and the step goes on (exit 0)', () => {
  const sb = sandbox();
  try {
    fs.mkdirSync(path.join(sb.w, 'private/data'), { recursive: true });
    fs.writeFileSync(path.join(sb.w, 'private/data/audit.json'), '{"high":0}\n');
    const sum = path.join(sb.t, 'summary.md');
    const soft = run(sb, 'push_raw.sh', ['audit', 'private/data/audit.json'], { RAW_BRANCH: 'no-such-branch', RAW_SOFT: '1', GITHUB_STEP_SUMMARY: sum });
    assert.equal(soft.status, 0, soft.stdout + soft.stderr);
    assert.match(soft.stdout, /::warning::not saved to no-such-branch on .*the site data is unaffected/);
    assert.match(fs.readFileSync(sum, 'utf8'), /private save failed: audit to no-such-branch/);
    const hard = run(sb, 'push_raw.sh', ['audit', 'private/data/audit.json'], { RAW_BRANCH: 'no-such-branch' });
    assert.notEqual(hard.status, 0, 'without RAW_SOFT it still fails');
    assert.match(hard.stdout, /::error::the no-such-branch branch is missing/);
    const pullSoft = run(sb, 'pull_raw.sh', ['private/data/editorial-notes.md'], { RAW_BRANCH: 'private-data', RAW_SOFT: '1' });
    assert.equal(pullSoft.status, 0);
    assert.match(pullSoft.stdout, /::warning::private\/data\/editorial-notes\.md is not on the private-data branch.*going on without it/);
    const pullHard = run(sb, 'pull_raw.sh', ['data/atlas/raw'], {});
    assert.notEqual(pullHard.status, 0, 'a build input missing still stops the build');
  } finally { fs.rmSync(sb.t, { recursive: true, force: true }); }
});

test('fetch_private.sh puts the tip where the readers look (origin/<branch> and FETCH_HEAD)', () => {
  const sb = sandbox();
  try {
    const r = run(sb, 'fetch_private.sh', ['raw']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(git(['rev-parse', 'refs/remotes/origin/raw'], sb.w).trim(), git(['rev-parse', 'raw'], sb.priv).trim());
    assert.equal(git(['rev-parse', 'FETCH_HEAD'], sb.w).trim(), git(['rev-parse', 'raw'], sb.priv).trim());
    assert.notEqual(run(sb, 'fetch_private.sh', ['main']).status, 0, 'only the private branches');
    assert.notEqual(run(sb, 'fetch_private.sh', ['references']).status, 0, 'a missing branch fails, saying so');
  } finally { fs.rmSync(sb.t, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- the workflows

test('every step that touches a private branch is given the key', () => {
  const missing = [];
  let n = 0;
  for (const f of workflows) {
    for (const s of steps(f)) {
      if (!CALLS.test(s.code)) continue;
      n++;
      if (!s.text.includes(TOKEN_ENV)) missing.push(`${f}: ${s.name}`);
    }
  }
  assert.ok(n >= 40, `found ${n} steps`);
  assert.deepEqual(missing, []);
});

test('no workflow reads or writes raw, references or private-data on the public repo any more', () => {
  for (const f of workflows) {
    const code = read(`.github/workflows/${f}`).split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    assert.doesNotMatch(code, /git (fetch|push)[^\n]*\borigin\b[^\n]*\b(raw|references|private-data)\b/, `${f} still uses origin`);
    assert.doesNotMatch(code, /GITHUB_REPOSITORY\/contents[^\n]*ref=(raw|references)/, `${f} reads a private branch through the public API`);
  }
  assert.match(read('.github/workflows/fetch_bids.yml'), /GH_TOKEN="\$PRIVATE_REPO_TOKEN" gh api -X GET "repos\/dnilgis\/agsistretired\/contents\/\$f\?ref=raw"/);
  const refs = read('.github/workflows/refs.yml');
  assert.match(refs, /scripts\/private_remote\.sh\n/, 'refs.yml checks the helper out (sparse)');
  assert.match(refs, /git push -q "\$REMOTE" HEAD:references/);
  assert.match(refs, /out=\$\(printf '%s\\n' "\$out" \| hide\)/, 'the full push answer is printed only with the token blanked');
});

test('publishing jobs save softly; build inputs, paid batch records and the FSA files stay hard', () => {
  const HARD = new Set(['accuracy-pass.yml', 'api-jobs.yml', 'fetch-fsa-arcplc.yml', 'fetch-fsa-files.yml']);
  for (const f of workflows) {
    for (const s of steps(f)) {
      const pushes = /scripts\/push_raw\.sh/.test(s.code);
      const soft = /RAW_SOFT: '1'/.test(s.text);
      if (pushes) assert.equal(soft, !HARD.has(f), `${f}: ${s.name} should be ${HARD.has(f) ? 'hard' : 'soft'}`);
      if (/pull_raw\.sh data\/(atlas\/raw|fsa)/.test(s.code)) assert.ok(!soft, `${f}: ${s.name} pulls a build input; never soft`);
    }
  }
});

test('the four job files no page reads are off main, pulled and saved on private-data', () => {
  for (const p of ['data/cron-health.json', 'data/audit.json', 'data/bids-withheld.json', 'data/editorial-notes.md']) {
    assert.equal(git(['ls-files', '--', p]).trim(), '', `${p} is back on main`);
    const name = path.basename(p);
    // no page or component reads it (that would have kept it public)
    for (const d of ['.', 'components']) {
      for (const f of fs.readdirSync(path.join(root, d)).filter((x) => /\.(html|js)$/.test(x))) {
        assert.ok(!read(path.join(d, f)).includes(name), `${d}/${f} reads ${name}; it must stay public`);
      }
    }
  }
  const ignored = (p) => spawnSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: root }).status === 0;
  assert.ok(ignored('private/data/cron-health.json'), 'an unpacked copy is never committed to main');
  assert.ok(ignored('.claude/skills/audit-loop/SKILL.md'), 'skills are kept off main');
  assert.equal(git(['ls-files', '--', '.claude/skills']).trim(), '', 'no skill file is tracked here');

  const ch = read('.github/workflows/cron-health.yml');
  const pull = ch.indexOf('bash scripts/pull_raw.sh private/data/cron-health.json');
  assert.ok(pull > 0 && pull < ch.indexOf('cron_health.py --out private/data/cron-health.json'), 'cron-health pulls the last file first');
  assert.match(ch, /run: bash scripts\/push_raw\.sh "cron health" private\/data\/cron-health\.json/);
  assert.doesNotMatch(ch, /git push|git add data\/cron-health/, 'nothing is committed to main');
  assert.match(ch, /permissions:\n  contents: read\n/, 'the job no longer writes to the public repo');
  const mr = read('.github/workflows/morning-report.yml');
  assert.ok(mr.indexOf('pull_raw.sh private/data/cron-health.json') < mr.indexOf('run: python3 scripts/morning_report.py\n'));
  assert.ok(read('.github/workflows/daily-site-check.yml').includes('pull_raw.sh private/data/cron-health.json'));

  const au = read('.github/workflows/audit.yml');
  assert.match(au, /bash scripts\/push_raw\.sh "audit: \$HIGH high finding\(s\)" private\/data\/audit\.json/);
  assert.doesNotMatch(au, /git push|git add data\/audit/);
  assert.match(read('scripts/audit-site.mjs'), /ROOT \+ "private\/data\/audit\.json"/);

  const fb = read('.github/workflows/fetch_bids.yml');
  assert.match(fb, /run: bash scripts\/push_raw\.sh "bids withheld" private\/data\/bids-withheld\.json/);
  assert.doesNotMatch(fb, /git add data\/bids-withheld/);
  assert.ok(fb.indexOf('"bids withheld"') > fb.indexOf('git commit -m "Update grain bids'), 'saved after the bids commit, never before it');
  assert.match(read('scripts/fetch_bids.py'), /WITHHELD_PATH = os\.environ\.get\("WITHHELD_PATH", "private\/data\/bids-withheld\.json"\)/);

  const dy = read('.github/workflows/daily.yml');
  assert.ok(dy.indexOf('pull_raw.sh private/data/editorial-notes.md') < dy.indexOf('run: python scripts/generate_daily.py\n'), 'notes before the briefing');
  assert.match(read('scripts/generate_daily.py'), /REPO_ROOT \/ "private" \/ "data" \/ "editorial-notes\.md"/);
});

test('cron_health and morning_report selftests pass (key expiry, failing key, stale saves)', () => {
  for (const s of ['cron_health.py', 'morning_report.py', 'daily_site_check.py']) {
    const r = spawnSync('python3', [path.join(root, 'scripts', s), '--selftest'], { cwd: root, encoding: 'utf8', env: bareEnv() });
    assert.equal(r.status, 0, s + '\n' + r.stdout.split('\n').filter((l) => l.startsWith('FAIL') || /FAIL/.test(l)).join('\n'));
  }
});
