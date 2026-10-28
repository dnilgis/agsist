// USDA AMS reports from GitHub Actions: www.ams.usda.gov stopped resolving on the
// runners from about Oct 27 2026 22:30 UTC. Every AMS reader fetches through one
// helper (scripts/ams_http.py) that asks www first, then the mirror measured from a
// runner (ams-prod.azureedge.us), and uses a mirror's answer only when it is the same
// report. A probe that reached no AMS host at all exits non-zero with a warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('ams_http selftest: host order, wrong-content refusal, all-failed exit', () => {
  const r = spawnSync('python3', ['scripts/ams_http.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ams_http selftest: all ok/);
  assert.doesNotMatch(r.stdout, /FAIL/);
  assert.ok((r.stdout.match(/^ {2}ok {3}/gm) || []).length >= 25, r.stdout);
});

// one copy: every reader of www.ams.usda.gov goes through the helper
const READERS = ['scripts/fetch_hay_ams.py', 'scripts/fetch_cattle_auction.py', 'scripts/fetch_cattle_cash.py',
  'scripts/fetch_mailbox.py', 'scripts/fetch_fert_ams.py', 'scripts/fetch_dairy.py'];

test('every AMS report reader fetches through ams_http and ends with its count line', () => {
  for (const f of READERS) {
    const s = read(f);
    assert.match(s, /import ams_http as AMS/, f);
    assert.match(s, /AMS\.get\(/, f);
    assert.match(s, /AMS\.finish\(/, f);
    // no direct fetch of an AMS URL constant left behind
    assert.doesNotMatch(s, /http_get\((?:URL|AMS_URL)\b/, f);
    assert.doesNotMatch(s, /http_get\(cfg\["listing_url"\]/, f);
  }
});

test('no other script fetches a www.ams.usda.gov report URL on its own', () => {
  const dir = path.join(root, 'scripts');
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.py'))) {
    const rel = 'scripts/' + f;
    if (READERS.includes(rel) || f === 'ams_http.py') continue;
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/=\s*["']https:\/\/www\.ams\.usda\.gov\/mnreports\//.test(s)) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

test('the dairy probe step keeps going past a failed probe and still fails the step', () => {
  const y = read('.github/workflows/dairy.yml');
  assert.match(y, /fetch_dairy\.py --probe \|\| rc=1/);
  assert.match(y, /fetch_mailbox\.py --probe \|\| rc=1/);
  assert.match(y, /exit \$rc/);
});
