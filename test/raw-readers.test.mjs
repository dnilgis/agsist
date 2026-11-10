/**
 * Builder-only data lives on the private raw branch, and every job that reads it unpacks it first.
 *
 * Nov 4, 2026 (browser-fetched data stays public).
 * data/site-usage.json (90 days of Search Console queries, 4.0 MB) and data/cot-deep.json (the
 * twenty-year COT history behind data/cot-analysis.json, 1.2 MB) left main: no page, component,
 * worker or other repo loads either one. The inventory behind the choice is in the PR from fx/datasplit.
 *
 * A moved file that a job reads without unpacking it first is not a loud failure everywhere:
 * send_cot_weekly.py drops the twenty-year lines when the file is missing, and
 * seo_opportunities.py writes nothing. So this checks, from the code:
 *   - the files are off main, ignored, and no page names them
 *   - every script that reads them (by name, or by importing a reader) is known
 *   - in every workflow job, a step that runs a reader comes after a pull_raw.sh of the path
 *   - every job that writes one saves it with push_raw.sh after the write, never `git add`s it,
 *     and rebuilds its summary in the same run (build rule 61)
 *   - the PR checks and scripts/dev/checks.sh pull a moved file a node test reads
 *   - a soft pull (continue-on-error) of a moved file never lets a send step mail on without it:
 *     the send step's if must require that pull's success (Nov 4 checker on #325: cot-release-watch
 *     mailed Funds this week with the twenty-year lines silently dropped when the unpack failed)
 * A --selftest run is not a read: each reader's selftest passed with both files absent (Nov 4).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const WF = '.github/workflows';

// path -> what writes it (script and the invocation that writes) and the summary built from it
export const MOVED = {
  'data/site-usage.json': { writes: [['site_usage_report.py', /site_usage_report\.py(?!\s+--selftest)/]], summary: 'seo_opportunities.py' },
  'data/cot-deep.json': { writes: [['cot_deep.py', /cot_deep\.py\s+--(?:append|rebuild)\b/]], summary: 'cot_analysis.py' },
};

// Scripts that import a reader module but never read a moved file (read by hand, Nov 4).
const NOT_READING = {
  'daily_more.py': 'send_cot_weekly.load, as_of_date and rows_for, on data/cot.json, data/cot-history.json and data/cot-analysis.json only',
  'fetch_cot.py': 'side_of, flat_band and FLAT_OI_PCT from cot_analysis',
  'enrich_cot_prices.py': 'UNREPAIRED_ROLL from cot_analysis',
  'gsc_index_check.py': 'the Google auth helpers from site_usage_report',
  'stats_ingest.py': 'the Google auth helpers from site_usage_report',
};

const base = (p) => p.split('/').pop();
const scriptFiles = () => fs.readdirSync(path.join(root, 'scripts')).filter((f) => /\.(py|mjs|sh)$/.test(f));
const code = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

/** script file name -> the moved paths it reads (by name, or through an imported reader) */
export function readers() {
  // comment lines dropped: a note that names a moved file does not make a reader
  const text = Object.fromEntries(scriptFiles().map((f) => [f, read(`scripts/${f}`).split('\n')
    .filter((l) => !/^\s*(#|\/\/)/.test(l)).join('\n')]));
  const out = {};
  for (const [f, t] of Object.entries(text)) {
    for (const p of Object.keys(MOVED)) {
      if (t.includes(base(p))) (out[f] ||= new Set()).add(p);
    }
  }
  const importers = {};
  for (let changed = true; changed;) {
    changed = false;
    for (const [f, t] of Object.entries(text)) {
      if (!f.endsWith('.py')) continue;
      for (const r of Object.keys(out)) {
        if (r === f || !r.endsWith('.py')) continue;
        const mod = r.slice(0, -3);
        if (!new RegExp(`^\\s*(?:import\\s+${mod}\\b|from\\s+${mod}\\s+import\\b)`, 'm').test(t)) continue;
        (importers[f] ||= new Set()).add(r);
        if (f in NOT_READING) continue;
        for (const p of out[r]) {
          if (!(out[f] ||= new Set()).has(p)) { out[f].add(p); changed = true; }
        }
      }
    }
  }
  return { readers: out, importers };
}

/** [{job, steps: [text]}] of a workflow, comments dropped */
export function jobs(yml) {
  const y = code(yml);
  const at = y.search(/^jobs:\s*$/m);
  if (at < 0) return [];
  const body = y.slice(at);
  const parts = body.split(/\n(?=  [A-Za-z0-9_-]+:\s*$)/m).slice(1);
  return parts.map((j) => ({ job: j.match(/^  ([A-Za-z0-9_-]+):/)[1], steps: j.split(/\n(?=      - )/).slice(1) }));
}

const covers = (arg, p) => arg === p || p.startsWith(arg.replace(/\/$/, '') + '/');
const pulled = (step) => {
  const m = step.match(/scripts\/pull_raw\.sh([^\n]*)/);
  if (!m) return [];
  return m[1].trim().split(/\s+/).map((a) => a.replace(/^["']|["']$/g, '')).filter((a) => a && !a.startsWith('>') && !a.startsWith('2>'));
};
const hasToken = (step) => /PRIVATE_REPO_TOKEN: \$\{\{ secrets\.PRIVATE_REPO_TOKEN \}\}/.test(step);

/** what a step runs that reads a moved path: [[script, path]] (a --selftest run is not a read) */
function readsIn(step, rd) {
  const hits = [];
  for (const line of step.split('\n')) {
    for (const [f, ps] of Object.entries(rd)) {
      const mod = f.replace(/\.(py|mjs|sh)$/, '');
      const run = new RegExp(`scripts/${f.replace('.', '\\.')}\\b`).test(line) && !/--selftest\b/.test(line);
      const imp = f.endsWith('.py') && new RegExp(`^\\s*(?:import\\s+${mod}\\b|from\\s+${mod}\\s+import\\b|import\\s+${mod}\\s+as\\b)`).test(line);
      if (run || imp) for (const p of ps) hits.push([f, p]);
    }
  }
  return hits;
}

const SEND = /scripts\/send_[A-Za-z0-9_]+\.py\b(?![^\n]*--selftest)/;
const softOf = (step) => /^\s*continue-on-error:\s*true\s*$/m.test(step);
const stepId = (step) => (step.match(/^\s*(?:- )?id:\s*([A-Za-z0-9_-]+)\s*$/m) || [])[1];
const stepIf = (step) => (step.match(/^\s*(?:- )?if:\s*(.+)$/m) || [])[1] || '';

/** problems in one workflow's text: reads before a pull, writes never saved, `git add` of a moved path,
 * a send step that runs after a soft pull of a moved file without requiring it succeeded */
export function problems(name, yml, rd = readers().readers) {
  const bad = [];
  const plain = code(yml);
  for (const { job, steps } of jobs(yml)) {
    const soft = [];
    steps.forEach((s, i) => {
      const moved = pulled(s).filter((a) => Object.keys(MOVED).some((p) => covers(a, p)));
      if (moved.length && softOf(s)) soft.push({ i, id: stepId(s), moved });
      if (!SEND.test(s)) return;
      for (const p of soft) {
        const need = p.id && new RegExp(`steps\\.${p.id}\\.outcome == 'success'`).test(stepIf(s));
        if (!need) bad.push(`${name} ${job} step ${i + 1}: sends after a soft pull of ${p.moved.join(' ')} (step ${p.i + 1}) without requiring it succeeded`);
      }
    });
  }
  for (const p of Object.keys(MOVED)) {
    if (new RegExp(`git add[^\\n]*${p.replace(/[.-]/g, '\\$&')}`).test(plain)) bad.push(`${name}: git add of ${p} (it lives on raw)`);
  }
  for (const { job, steps } of jobs(yml)) {
    const have = new Set();
    steps.forEach((s, i) => {
      for (const [f, p] of readsIn(s, rd)) {
        if (![...have].some((a) => covers(a, p))) bad.push(`${name} ${job} step ${i + 1}: runs ${f}, which reads ${p}, before any pull_raw.sh of it`);
      }
      const args = pulled(s);
      if (args.length) {
        if (!hasToken(s)) bad.push(`${name} ${job} step ${i + 1}: pull_raw.sh without PRIVATE_REPO_TOKEN`);
        args.forEach((a) => have.add(a));
      }
      for (const [p, { writes, summary }] of Object.entries(MOVED)) {
        for (const [, re] of writes) {
          if (!re.test(s)) continue;
          const later = steps.slice(i + 1);
          const save = later.find((t) => new RegExp(`scripts/push_raw\\.sh "[^"]+"[^\\n]*\\s${p.replace(/[.-]/g, '\\$&')}\\b`).test(t));
          if (!save) bad.push(`${name} ${job} step ${i + 1}: writes ${p} and never saves it with push_raw.sh`);
          else if (!hasToken(save)) bad.push(`${name} ${job}: push_raw.sh of ${p} without PRIVATE_REPO_TOKEN`);
          if (!later.some((t) => new RegExp(`scripts/${summary.replace('.', '\\.')}(?!\\s+--selftest)`).test(t))) {
            bad.push(`${name} ${job} step ${i + 1}: writes ${p} but does not rebuild ${summary} in the same run (BUILD-RULES 61)`);
          }
        }
      }
    });
  }
  return bad;
}

test('the moved files are off main, ignored, and named by no page, component or worker', () => {
  const tracked = spawnSync('git', ['ls-files', '--', ...Object.keys(MOVED)], { cwd: root, encoding: 'utf8' }).stdout.trim();
  assert.equal(tracked, '', `back on main: ${tracked}`);
  for (const p of Object.keys(MOVED)) {
    assert.equal(spawnSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: root }).status, 0, `${p} is in .gitignore`);
  }
  const browser = ['sw.js', 'embed.js', ...fs.readdirSync(root).filter((f) => /\.(html|js|txt|json|xml)$/.test(f)),
    ...fs.readdirSync(path.join(root, 'components')).map((f) => `components/${f}`),
    ...fs.readdirSync(path.join(root, 'workers')).filter((f) => f.endsWith('.js')).map((f) => `workers/${f}`)];
  for (const f of browser) {
    const t = read(f);
    for (const p of Object.keys(MOVED)) {
      const stem = base(p).replace(/\.json$/, '');
      assert.ok(!new RegExp(`(?<![\\w-])${stem}(?![\\w-])`).test(t), `${f} names ${stem}: a page that loads it would break once it is off main`);
    }
  }
});

test('every reader of a moved file is known: by name, or by importing a reader', () => {
  const { readers: rd, importers } = readers();
  for (const [p, { writes, summary }] of Object.entries(MOVED)) {
    for (const [w] of writes) assert.ok(rd[w]?.has(p), `${w} writes ${p}`);
    assert.ok(rd[summary]?.has(p), `${summary} reads ${p}`);
  }
  for (const [f, why] of Object.entries(NOT_READING)) {
    assert.ok(importers[f], `NOT_READING lists ${f}, which no longer imports a reader: drop it (${why})`);
    for (const p of Object.keys(MOVED)) assert.ok(!read(`scripts/${f}`).includes(base(p)), `${f} names ${base(p)}: it is a reader, not NOT_READING`);
  }
  // the set found on Nov 4; a new reader must be looked at (does its workflow pull first?)
  assert.deepEqual(Object.keys(rd).sort(), ['cot_analysis.py', 'cot_deep.py', 'prediction_bot.py', 'send_cot_weekly.py',
    'seo_opportunities.py', 'site_usage_report.py'], 'readers changed: check their workflows, then update this list');
});

test('every workflow job unpacks a moved file before it reads it, and saves what it writes', () => {
  const bad = [];
  const rd = readers().readers;
  for (const f of fs.readdirSync(path.join(root, WF)).filter((x) => /\.ya?ml$/.test(x))) bad.push(...problems(f, read(`${WF}/${f}`), rd));
  assert.deepEqual(bad, []);
});

test('the guard catches a read before the pull, a write never saved, and a git add', () => {
  const rd = { 'cot_deep.py': new Set(['data/cot-deep.json']), 'cot_analysis.py': new Set(['data/cot-deep.json']) };
  const wf = (steps) => `name: x\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;
  const pull = `      - env:\n          PRIVATE_REPO_TOKEN: \${{ secrets.PRIVATE_REPO_TOKEN }}\n        run: bash scripts/pull_raw.sh data/cot-deep.json\n`;
  const push = `      - env:\n          PRIVATE_REPO_TOKEN: \${{ secrets.PRIVATE_REPO_TOKEN }}\n        run: bash scripts/push_raw.sh "deep" data/cot-deep.json\n`;
  const append = `      - run: python scripts/cot_deep.py --append\n`;
  const ana = `      - run: python scripts/cot_analysis.py\n`;
  assert.deepEqual(problems('ok.yml', wf(`      - run: python scripts/cot_deep.py --selftest\n` + pull + append + ana + push), rd), []);
  assert.match(problems('late.yml', wf(append + pull + ana + push), rd).join('\n'), /before any pull_raw\.sh/);
  assert.match(problems('nosave.yml', wf(pull + append + ana), rd).join('\n'), /never saves it/);
  assert.match(problems('nosum.yml', wf(pull + append + push), rd).join('\n'), /does not rebuild cot_analysis\.py/);
  assert.match(problems('add.yml', wf(pull + append + ana + push + `      - run: git add data/cot-deep.json\n`), rd).join('\n'), /git add of data\/cot-deep\.json/);
  assert.match(problems('notoken.yml', wf(`      - run: bash scripts/pull_raw.sh data/cot-deep.json\n` + ana), rd).join('\n'), /without PRIVATE_REPO_TOKEN/);
  // a send after a soft pull must require that pull's success
  const softPull = `      - id: rawpull\n        continue-on-error: true\n        env:\n          PRIVATE_REPO_TOKEN: \${{ secrets.PRIVATE_REPO_TOKEN }}\n        run: bash scripts/pull_raw.sh data/cot-deep.json\n`;
  const send = (cond) => `      - name: mail\n${cond ? `        if: \${{ ${cond} }}\n` : ''}        run: python scripts/send_cot_weekly.py\n`;
  const sel = `      - run: python scripts/send_cot_weekly.py --selftest\n`;
  assert.match(problems('soft.yml', wf(softPull + sel + send('')), rd).join('\n'), /sends after a soft pull of data\/cot-deep\.json \(step 1\)/);
  assert.match(problems('soft2.yml', wf(softPull + send("!cancelled()")), rd).join('\n'), /without requiring it succeeded/);
  assert.deepEqual(problems('soft3.yml', wf(softPull + sel + send("!cancelled() && steps.rawpull.outcome == 'success'")), rd), []);
  assert.deepEqual(problems('hard.yml', wf(pull + send('')), rd), [], 'a hard pull needs no condition: the job stops on a failed one');
  // a pull in another job does not count
  const two = `name: x\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n${pull}  b:\n    runs-on: ubuntu-latest\n    steps:\n${ana}`;
  assert.match(problems('twojobs.yml', two, rd).join('\n'), /twojobs\.yml b step 1/);
});

test('the PR checks and checks.sh unpack every moved file a node test reads, before the node tests', () => {
  const tests = fs.readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.mjs') && f !== 'raw-readers.test.mjs');
  const need = new Set();
  for (const f of tests) {
    const t = read(`test/${f}`).split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    for (const p of Object.keys(MOVED)) if (t.includes(p)) need.add(p);
  }
  assert.ok(need.has('data/cot-deep.json'), 'test/funds-weekly.test.mjs renders the email from data/cot-deep.json');
  const pr = jobs(read(`${WF}/pr-checks.yml`));
  const node = pr.find((j) => j.steps.some((s) => /checks\.sh --only=node-test/.test(s)));
  assert.ok(node, 'pr-checks has a node-test job');
  const run = node.steps.findIndex((s) => /checks\.sh --only=node-test/.test(s));
  const have = node.steps.slice(0, run).flatMap(pulled);
  const sh = read('scripts/dev/checks.sh');
  for (const p of need) {
    assert.ok(have.some((a) => covers(a, p)), `pr-checks pulls ${p} before the node tests`);
    const at = sh.indexOf(`bash scripts/pull_raw.sh ${p}`);
    assert.ok(at > 0 && at < sh.indexOf('run node-test'), `checks.sh pulls ${p} before the node tests`);
  }
});
