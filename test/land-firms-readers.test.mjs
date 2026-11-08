/**
 * Land auction firms readers (Sig, Nov 8, 2026; step 2 after the capture, PR for fx/land-firms-readers).
 * scripts/read_land_firms.py reads the saved pages of Wieman, Younger, Horning and Martin's into
 * data/land/auctions/<firm>.json in the record shape of read_schrader.py: facts only, no buyer, farmland only,
 * a county only when exactly one county and one state are named, the firm's credit and a link per record.
 *
 *   node --test test/land-firms-readers.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const FX = 'test/fixtures/land-firms';
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test('the readers selftest passes on the trimmed real pages', () => {
  const out = execFileSync('python3', ['scripts/read_land_firms.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /read_land_firms selftest: 0 failure\(s\)/);
  assert.doesNotMatch(out, /^FAIL /m);
  for (const name of ['wieman: the $0 placeholder tracts are skipped, Aurora County SD',
    'younger: per acre kept, no price worked out from acres, no total',
    'martins: the date is the one in the title (the feed pubDate is April), county from the feed text',
    '--merge keeps the saved record over a changed price', 'two counties joined by & are withheld',
    'no state named, and a town never becomes a county']) {
    assert.ok(out.includes('ok   ' + name), 'selftest ran: ' + name);
  }
});

test('the fixtures are scrubbed: no phone, email, street address, owner or buyer name', () => {
  for (const f of walk(FX)) {
    const t = read(f);
    assert.doesNotMatch(t, /\b\d{3}[-.]\d{3}[-.]\d{4}\b/, f + ' has a phone number');
    assert.doesNotMatch(t, /@[a-z0-9-]+\.[a-z]{2,}/i, f + ' has an email');
    assert.doesNotMatch(t, /\b\d{1,5}\s+[A-Z][a-z]+\s+(?:Rd|Road|St|Street|Ave|Dr|Lane|Ln|Hwy)\b/, f + ' has a street address');
    assert.doesNotMatch(t, /(?:Owners?|Seller|Buyer)\s*:?\s*(?:<\/strong>)?\s*(?!\[)[A-Z][a-z]+/, f + ' has an owner or buyer name');
  }
});

test('the records carry facts only and the firm\'s credit', () => {
  const py = `
import json, sys
sys.path.insert(0, "scripts")
import read_land_firms as R
idx = R.county_index()
out = {}
for firm in R.FIRMS:
    recs, st, cap = R.read_folder(firm, "${FX}/" + firm, idx)
    out[firm] = recs
print(json.dumps(out))`;
  const all = JSON.parse(execFileSync('python3', ['-c', py], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop());
  const names = { wieman: 'Wieman Land & Auction', younger: 'Younger Auction Company', horning: 'Horning Farm Agency', martins: "Martin's Auction Service" };
  for (const [firm, recs] of Object.entries(all)) {
    assert.ok(recs.length > 0, firm + ' has records');
    for (const r of recs) {
      assert.deepEqual(Object.keys(r).sort(), ['auction_id', 'county', 'county_fips', 'credit', 'date', 'headline_acres', 'kind', 'source', 'state', 'total_sold', 'tracts', 'url']);
      assert.equal(r.credit, 'Results reported by ' + names[firm]);
      assert.match(r.url, /^https:\/\//);
      assert.ok(r.headline_acres >= 20);
    }
  }
  // Younger prints acres and a per-acre figure: the per-acre figure is kept, nothing is multiplied into a price
  assert.ok(all.younger.every((r) => r.total_sold === null && r.tracts.every((t) => t.sold === null && t.per_acre > 0)));
  // Martin's date is the auction date in the title, not the feed's publication date
  assert.ok(all.martins.some((r) => r.date === '2026-06-30'));
});

test('the workflow reads the saved pages after the save and commits with its own write job', () => {
  const wf = read('.github/workflows/schrader-capture.yml');
  const job = (n) => { const i = wf.indexOf('\n  ' + n + ':\n'); assert.ok(i > 0, n); const j = wf.indexOf('\n  ', i + 5 + n.length); const rest = wf.slice(i + 1); const m = /\n  [a-z-]+:\n/.exec(rest.slice(5)); return m ? rest.slice(0, m.index + 5) : rest; };
  const r = job('firms-read');
  assert.match(r, /needs: \[gate, firms-save\]/);
  assert.match(r, /contents: read/);
  assert.doesNotMatch(r, /contents: write/);
  assert.match(r, /pull_raw\.sh land\/wieman land\/younger land\/horning land\/martins/);
  assert.match(r, /read_land_firms\.py --all --out-dir results\/firms/);
  const c = job('firms-commit');
  assert.match(c, /needs: \[gate, firms-read\]/);
  assert.match(c, /contents: write/);
  assert.match(c, /read_land_firms\.py --merge-dir results\/firms/);
  assert.doesNotMatch(c, /pull_raw|capture_land_firms/, 'the write job fetches and pulls nothing');
  assert.equal((wf.match(/cron:/g) || []).length, 1, 'no schedule added');
});
