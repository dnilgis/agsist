/* Private ag raises on /ag-stocks (Sig, Oct 29, 2026): SEC Regulation Crowdfunding filings.
 * - the reader, the ag screen and the outcome scoring run as a python selftest on two fixed
 *   quarterly zips in the SEC layout (scripts/agraises.py --selftest);
 * - the workflow is by hand only, saves the originals to the private raw branch with SHA256SUMS,
 *   and publishes only when asked;
 * - when data/agstocks/raises.json exists, the page section is what the builder makes from it,
 *   carries the risk line, links only to SEC, and shows a share only above the gate. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PAGE = rd('ag-stocks.html');
const LINE = 'Private raises are high risk and hard to sell; many stop reporting.';

test('scripts/agraises.py --selftest passes', () => {
  const r = spawnSync('python3', ['scripts/agraises.py', '--selftest'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /agraises selftest: ok/);
});

test('the workflow runs by hand only, keeps the originals on the private raw branch, publishes only when asked', () => {
  const wf = rd('.github/workflows/sec-reg-cf.yml');
  assert.match(wf, /^on:\n {2}workflow_dispatch:/m);
  assert.doesNotMatch(wf, /schedule:|cron:|^\s+push:|pull_request/m, 'no schedule without Sig\'s OK');
  assert.match(wf, /history\/sec-reg-cf\/\$\(date -u \+%Y-%m-%d\)/);
  assert.match(wf, /RAW_KEEP: "1"\n\s+run: bash scripts\/push_raw\.sh "SEC Reg CF quarterly files" "\$DIR"/, 'originals saved, never replaced');
  assert.match(wf, /scripts\/agraises\.py screen --raw "\$DIR" --publish/);
  assert.match(wf, /default: false/, 'publish is off unless asked');
  assert.match(wf, /if: inputs\.publish\n/, 'the page commit runs only on publish');
  const py = rd('scripts/agraises.py');
  assert.match(py, /hashlib\.sha256/);
  assert.match(py, /SHA256SUMS/);
  assert.doesNotMatch(py, /SIGNATURE"/, 'the signature tables (people\'s names) are never read');
  assert.match(rd('.gitignore'), /^\/history\/$/m, 'the downloads never land on main');
});

test('the section on the page matches raises.json, or is absent before the first published read', () => {
  const r = spawnSync('python3', ['scripts/build_agstocks_page.py', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const has = fs.existsSync(path.join(ROOT, 'data/agstocks/raises.json'));
  const sec = PAGE.match(/<details class="ags-method" id="raises">[\s\S]*?<\/details>/);
  if (!has) {
    assert.equal(sec, null, 'no section before the first read');
    return;
  }
  assert.ok(sec, 'section present');
  const s = sec[0];
  assert.match(s, /<summary>Private ag raises<\/summary>/);
  assert.ok(s.includes(LINE), 'the risk line');
  const hrefs = [...s.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 1);
  for (const h of hrefs) assert.match(h, /^https:\/\/www\.sec\.gov\//, `only SEC links: ${h}`);
  assert.doesNotMatch(s, /\b(invest now|buy|portal)\b/i);
  assert.ok(!s.includes('—'), 'no em dash');
  const rz = JSON.parse(rd('data/agstocks/raises.json'));
  for (const o of rz.open) assert.ok(s.includes(o.link.replace(/&/g, '&amp;')), `open raise ${o.name} links its filing`);
  const ag = rz.track.ag;
  if (ag.n < rz.share_min) assert.match(s, /counts only, no share/);
});
