/**
 * Schrader archive backfill (Nov 8, 2026; the owner approved one manual run, no schedule).
 *
 * scripts/capture_schrader.py --backfill walks Schrader's recent_auctions archive for twelve states and saves
 * the auction pages not captured before to land/schrader/backfill/ on the private raw branch. This file holds:
 *   - the capture selftest passes, backfill and resume checks included (robots first, 2 s apart, /buyers/
 *     never asked for, the request cap, a second run going on where the first stopped)
 *   - the twelve states, the 2,500 request cap and the 2 s wait as the brief set them
 *   - the workflow runs the backfill only on the workflow_dispatch input: no new cron, the step restores the
 *     resume point from the raw branch first, saves to the raw branch after, and the capture job stays read-only
 *
 *   node --test test/schrader-backfill.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('the capture selftest passes, the backfill and resume checks included', () => {
  const out = execFileSync('python3', ['scripts/capture_schrader.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /capture_schrader selftest: 0 failure\(s\)/);
  assert.doesNotMatch(out, /^FAIL /m);
  for (const name of ['backfill: robots.txt first, once', 'backfill: stops at the request cap (30 requests)',
    'backfill: 2 s before every request after the first', 'backfill: no request to a /buyers/ path',
    'backfill: ids already captured (weekly pages, the data file) are skipped',
    'backfill: robots.txt Disallow obeyed for an auction page', 'backfill: a page with no new id ends the walk',
    'resume: no auction page fetched twice across runs', 'resume: a state walked to its end is not walked again',
    'resume: a page that failed twice is given up, nothing left', 'backfill: stops at the time budget',
    'backfill: robots.txt unreadable, nothing else fetched, exit 1',
    'backfill: robots.txt disallowing the archive stops the walk before any request']) {
    assert.ok(out.includes('ok   ' + name), 'selftest ran: ' + name);
  }
});

test('the twelve states, the 2,500 request cap and 2 s apart', () => {
  const py = `
import json, sys
sys.path.insert(0, "scripts")
import capture_schrader as C
print(json.dumps([C.BACKFILL_STATES, C.MAX_REQUESTS, C.DELAY_S, C.BACKFILL_BASE, C.archive_url("OH", 20, 140)]))
`;
  const [states, cap, delay, base, url] = JSON.parse(execFileSync('python3', ['-c', py], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop());
  assert.deepEqual(states, ['IA', 'NE', 'OH', 'MI', 'KY', 'AR', 'MS', 'TX', 'OK', 'CO', 'WA', 'GA']);
  assert.equal(cap, 2500);
  assert.equal(delay, 2);
  assert.equal(base, 'land/schrader/backfill');
  assert.equal(url, 'https://www.schraderauction.com/auctions/recent_auctions/20/140?state=OH', 'the archive paging the research cited');
  assert.match(read('.gitignore'), /^\/land\/schrader\/$/m, 'the backfill folder never reaches main');
});

test('the workflow: the backfill runs only on the dispatch input, resumes from the raw branch, adds no schedule', () => {
  const wf = read('.github/workflows/schrader-capture.yml');
  const crons = [...wf.matchAll(/^\s*-?\s*cron:\s*(?:(['"])(.+?)\1|(\S[^#\n]*?))\s*$/gm)].map((m) => m[2] || m[3]);
  assert.deepEqual(crons, ['43 19 * * 1'], 'no new schedule');
  assert.match(wf, /\n  workflow_dispatch:\n    inputs:\n      backfill:\n[\s\S]*?type: boolean\n\s+default: false\n/, 'a boolean dispatch input, off by default');
  const i = wf.indexOf('\n  capture:\n');
  const cap = wf.slice(i, wf.indexOf('\n  commit:\n'));
  assert.match(cap, /\n    timeout-minutes: \$\{\{ inputs\.backfill && 150 \|\| 10 \}\}\n/, 'the long timeout only for a backfill run');
  assert.match(cap, /\n    permissions:\n      contents: read\n/, 'the fetch job stays read-only');
  const steps = cap.split(/\n      - /).slice(1);
  const bf = steps.filter((s) => /capture_schrader\.py --backfill/.test(s));
  assert.equal(bf.length, 1, 'one backfill step');
  const s = bf[0];
  assert.match(s, /\n        if: \$\{\{ inputs\.backfill == true \}\}\n/, 'only when the input is on');
  const pull = s.indexOf('bash scripts/pull_raw.sh land/schrader/backfill/state.json');
  const run = s.indexOf('python3 scripts/capture_schrader.py --backfill');
  const push = s.indexOf('bash scripts/push_raw.sh "schrader backfill" land/schrader/backfill');
  assert.ok(pull > 0 && run > pull && push > run, 'restore the resume point, run, then save to the raw branch');
  assert.match(s, /is not on the raw branch/, 'a first run starts fresh; any other read failure stops');
  assert.ok(steps.indexOf(s) > steps.findIndex((x) => /upload-artifact/.test(x)), 'after the weekly facts file is uploaded');
  assert.doesNotMatch(cap, /git (add|commit|push)/);
});

test('slug keys (Nov 8): the real archive page gives three slugs, an empty archive page fails loudly, numbers and slugs both read', () => {
  const cap = execFileSync('python3', ['scripts/capture_schrader.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  const rd = execFileSync('python3', ['scripts/read_schrader.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.doesNotMatch(cap + rd, /^FAIL /m);
  for (const name of ['real OH archive page: three slugs in order', 'known ids: a captured numeric page also counts under its canonical slug',
    'backfill by slug: each slug fetched and saved as <slug>.html', 'backfill by slug: a second run fetches nothing twice',
    'an archive page with 0 items fails the run loudly']) {
    assert.ok(cap.includes(name), `selftest line missing: ${name}`);
  }
  for (const name of ['slug page: auction_id and url from the canonical slug', 'numeric record: id, url and keys unchanged',
    'the same sale under its number and its slug is one record']) {
    assert.ok(rd.includes(name), `reader selftest line missing: ${name}`);
  }
});

test('the archive fixture is a stripped copy: result blocks only, no buyer', () => {
  const page = read('test/fixtures/schrader-archive/OH-0.html');
  assert.ok(page.length < 20000);
  assert.equal((page.match(/<article class="result">/g) || []).length, 3);
  assert.doesNotMatch(page, /buyer/i);
});
