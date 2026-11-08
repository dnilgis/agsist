/**
 * Schrader auction results reader (Nov 7, 2026; step 2 after the capture job, #411).
 *
 * scripts/read_schrader.py reads one capture folder (the sold feed and the result pages) into
 * data/land/auctions/schrader.json. This file holds:
 *   - the reader's own selftest passes on the scrubbed fixtures, including --merge never rewriting a saved
 *     record's values and bool never counting as a sold price or per-acre figure
 *   - auction 9630 gives Schrader's three printed rows and the $2,905,000 total
 *   - the fixtures are scrubbed: no phone number, no email, no "sold to" or "buyer" followed by a name
 *   - the data file carries facts only: no buyer, owner or name field, the credit and a link on every record,
 *     a per-acre figure only where Schrader printed one, farmland only
 *   - the capture workflow builds the file right after the capture, on a weekly gated Monday tick at 19:43 UTC
 *     (Sig approved that schedule in chat, Nov 7, 2026; STANDING-DECISIONS)
 *
 *   node --test test/schrader-reader.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const FX = 'test/fixtures/schrader';
const CREDIT = 'Sold/auction results reported by Schrader Real Estate and Auction Co.';
// a buyer-ish word, in any case, followed by a name-like word (a placeholder in brackets is not one)
const BUYERISH = /\b(?:sold\s+to|buyers?|purchasers?|owners?)\b\s*(?:is\s+|was\s+|[:,-]\s*)?[a-z][a-z'.]+/i;
// street addresses: house number and street word, county roads, and the Indiana grid style (1490 S 200 E)
const STREET = [
  /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z]+(?:\s+[A-Za-z]+)*\s+(?:Rd|Road|St|Street|Ave|Avenue|Dr|Drive|Ln|Lane|Hwy|Highway|Pike|Blvd|Ct|Court|Way|Trl|Trail|Pl)\b/i,
  /\b(?:County\s+Road|Co\.?\s*Rd\.?|C\.?R\.?)\s*\d+/i,
  /\b\d{1,6}\s+[NSEW]\.?\s+\d{1,5}\s+[NSEW]\b/i,
];

test('the reader selftest passes on the scrubbed fixtures', () => {
  const out = execFileSync('python3', ['scripts/read_schrader.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /read_schrader selftest: 0 failure\(s\)/);
  assert.doesNotMatch(out, /^FAIL /m);
  // checker items from PR #412: --merge never rewrites a saved record's values, and a bool is not a number
  for (const name of ['--merge refuses a sold price that is a bool', '--merge refuses a per acre that is a bool',
    '--merge refuses a total that is a bool', '--merge keeps the saved record over a changed sold price',
    '--merge keeps the saved record over a changed per acre', '--merge keeps the saved record over rows that differ plus a new row',
    '--merge keeps the saved record over fewer rows', '--merge keeps the saved record over a changed total',
    'a refused overwrite is counted',
    'identical rows plus a new row replace the saved record; a new auction_id is added']) {
    assert.ok(out.includes('ok   ' + name), 'selftest ran: ' + name);
  }
});

test('9630: the three rows as Schrader printed them, total $2,905,000', () => {
  const py = `
import json, sys
sys.path.insert(0, "scripts")
import read_schrader as R
feed = R.parse_feed(open("${FX}/index-sold.rss", "rb").read())
rec = R.parse_page(open("${FX}/9630.html", "rb").read(), "9630", feed.get("9630"), R.county_index())
print(json.dumps(dict(rec, feed_date=feed["9630"]["date"])))
`;
  const rec = JSON.parse(execFileSync('python3', ['-c', py], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop());
  assert.deepEqual(rec.tracts, [
    { tracts: '1+2+4+5+7', sold: 1660000, per_acre: 9459 },
    { tracts: '3', sold: 245000, per_acre: null },
    { tracts: '6+8', sold: 1000000, per_acre: 9709 },
  ]);
  assert.equal(rec.total_sold, 2905000);
  assert.match(rec.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(rec.date, rec.feed_date, 'the page date agrees with the feed date');
  assert.equal(rec.county_fips, '18177');
  assert.equal(rec.headline_acres, 296.5);
});

test('the fixtures are scrubbed copies: no phone, no email, no buyer named', () => {
  const files = fs.readdirSync(path.join(root, FX));
  assert.ok(files.length >= 6, 'five pages and the feed');
  for (const f of files) {
    const t = read(`${FX}/${f}`);
    assert.doesNotMatch(t, /\(?\b\d{3}\)?[-. ]\d{3}[-.]\d{4}\b/, `${f}: a phone number`);
    assert.doesNotMatch(t, /tel:/i, `${f}: a phone link`);
    assert.doesNotMatch(t, /[\w.+-]+@[\w-]+\.[\w.]+/, `${f}: an email address`);
    assert.doesNotMatch(t, /mailto:/i, `${f}: a mail link`);
    assert.doesNotMatch(t, BUYERISH, `${f}: a buyer, purchaser or owner named`);
    assert.doesNotMatch(t, /\/buyers\//i, `${f}: a buyer profile link`);
    for (const re of STREET) assert.doesNotMatch(t, re, `${f}: a street address`);
  }
  // the guard itself catches what it is for
  const hit = (s) => BUYERISH.test(s);
  assert.ok(hit('Sold to Jane Example') && hit('SOLD TO JANE EXAMPLE') && hit('Buyer: Example Farms') && hit('purchaser was Jane')
    && hit('Owner: Jane Example') && hit('OWNER JANE'));
  assert.ok(!hit('2027 CROP RIGHT TO BUYER') && !hit('Owner: [owner]'));
  const street = (s) => STREET.some((re) => re.test(s));
  assert.ok(street('1234 Elm Rd') && street('4600 New Garden Rd') && street('County Road 400 N') && street('CR 250')
    && street('1490 S 200 E') && street('co. rd. 12'));
  assert.ok(!street('331+/-ACRES OFFERED IN 3 TRACTS') && !street('[street address], [town], ST [zip]'));
});

test('the data file: facts only, credited, linked, farmland only, never a figured per acre', () => {
  const doc = JSON.parse(read('data/land/auctions/schrader.json'));
  assert.equal(doc.credit, CREDIT);
  assert.ok(doc.records.length >= 2);
  const ids = doc.records.map((r) => r.auction_id);
  assert.equal(new Set(ids).size, ids.length, 'deduped by auction_id');
  const keys = new Set(['source', 'auction_id', 'url', 'date', 'state', 'county', 'county_fips', 'headline_acres',
    'total_sold', 'tracts', 'kind', 'credit']);
  for (const r of doc.records) {
    for (const k of Object.keys(r)) assert.ok(keys.has(k), `${r.auction_id}: unexpected field ${k}`);
    assert.equal(r.credit, CREDIT);
    assert.equal(r.url, `https://www.schraderauction.com/auctions/${r.auction_id}`);
    assert.equal(r.kind, 'auction');
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.date <= doc.checked, `${r.auction_id}: dated after the capture`);
    for (const t of r.tracts) {
      assert.deepEqual(Object.keys(t).sort(), ['per_acre', 'sold', 'tracts']);
      assert.ok(t.per_acre === null || Number.isInteger(t.per_acre));
    }
    assert.ok(r.tracts.some((t) => t.per_acre !== null) || r.headline_acres >= 20, `${r.auction_id}: not farmland`);
  }
  const sorted = [...doc.records].sort((a, b) => (a.date + a.auction_id.padStart(8, '0')).localeCompare(b.date + b.auction_id.padStart(8, '0')));
  assert.deepEqual(doc.records.map((r) => r.auction_id), sorted.map((r) => r.auction_id), 'sorted by date');
  const r = doc.records.find((x) => x.auction_id === '9630');
  assert.equal(r.tracts[1].per_acre, null, 'the house tract keeps no per acre');
  assert.doesNotMatch(read('data/land/auctions/schrader.json'), /buyer|purchaser|owner|\u2014/i);
});

test('the capture workflow: weekly on Monday at 19:43 UTC behind the house gate, a read-only capture job, a commit job that only merges the facts file', () => {
  const wf = read('.github/workflows/schrader-capture.yml');
  // exactly the one schedule Sig approved (Nov 7, 2026): Mondays 19:43 UTC, 1:43 PM Central
  const crons = [...wf.matchAll(/^\s*-?\s*cron:\s*(?:(['"])(.+?)\1|(\S[^#\n]*?))\s*$/gm)].map((m) => m[2] || m[3]);
  assert.deepEqual(crons, ['43 19 * * 1'], 'the one approved cron line, exactly');
  assert.match(wf, /\npermissions:\n  contents: read\n/, 'read-only by default');

  const job = (name) => {
    const i = wf.indexOf(`\n  ${name}:\n`);
    assert.ok(i > 0, `job ${name}`);
    const rest = wf.slice(i + 1);
    const next = rest.slice(1).search(/\n  [a-z][\w-]*:\n/);
    return next < 0 ? rest : rest.slice(0, next + 1);
  };
  const steps = (j) => j.split(/\n      - /).slice(1);

  const gate = job('gate');
  assert.match(gate, /\n    permissions:\n      actions: read\n      contents: read\n/, 'the gate job only reads');
  assert.match(gate, /\n    outputs:\n      go: \$\{\{ steps\.g\.outputs\.go \}\}\n/);
  assert.match(gate, /python3 scripts\/cron_gate\.py tick --workflow schrader-capture\.yml --max-lag 360\n\s+--cron "43 19 \* \* 1"\n/,
    'the house gate ticks on the approved cron');
  assert.doesNotMatch(gate, /contents: write|git (add|commit|push)/);

  const cap = job('capture');
  assert.match(cap, /\n    needs: gate\n    if: needs\.gate\.outputs\.go == '1'\n/, 'the capture job runs only on a gate tick');
  assert.match(cap, /\n    permissions:\n      contents: read\n/, 'the capture job cannot write to the repo');
  assert.doesNotMatch(cap, /contents: write/);
  assert.match(cap, /uses: actions\/checkout@v4\n        with:\n          persist-credentials: false\n/, 'no stored credentials while it fetches pages');
  assert.doesNotMatch(cap, /git (add|commit|push)/, 'the capture job commits nothing');
  const c = cap.indexOf('python3 scripts/capture_schrader.py\n');
  const save = cap.indexOf('scripts/push_raw.sh "schrader capture" land/schrader/capture');
  const rd = cap.indexOf('python3 scripts/read_schrader.py --latest --out results/schrader-new.json');
  assert.ok(c > 0 && save > c && rd > save, 'capture, save to raw, then read into the facts-only file');
  assert.ok(cap.indexOf('python3 scripts/read_schrader.py --selftest') > 0);
  for (const s of steps(cap)) {
    if (!/PRIVATE_REPO_TOKEN/.test(s)) continue;
    assert.ok(/scripts\/push_raw\.sh/.test(s) || /name: Engine checkout/.test(s), 'the private token only on the raw save (and the engine checkout): ' + s.split('\n')[0]);
  }
  const up = /uses: actions\/upload-artifact@v4\n        with:\n([\s\S]*?)(?:\n\n|\n      - |\n  [a-z]|$)/.exec(cap);  // the upload step's own lines (a later step may follow, Nov 8)
  assert.ok(up, 'the capture job uploads an artifact');
  assert.match(up[1], /path: results\/schrader-new\.json\n/, 'only the facts-only file, never the raw pages');
  assert.doesNotMatch(up[1], /land\/schrader/);

  const com = job('commit');
  assert.match(com, /\n    needs: \[gate, capture\]\n    if: needs\.gate\.outputs\.go == '1'\n/, 'the commit job runs after the capture, on a gate tick');
  assert.match(com, /\n    permissions:\n      contents: write\n/);
  assert.match(com, /uses: actions\/download-artifact@v4\n        with:\n          name: schrader-results\n/);
  const runs = [...com.matchAll(/run: (?:\|\n([\s\S]*?)(?=\n      - |\n?$)|(.*))/g)].map((m) => (m[1] || m[2] || '').trim());
  assert.ok(runs.includes('python3 scripts/read_schrader.py --merge results/schrader-new.json'), 'the commit job checks and merges the file');
  assert.ok(!/capture_schrader|push_raw|--capture|--latest/.test(com), 'the commit job reads no capture');
  const adds = [...com.matchAll(/git add ([^\n]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(adds, ['data/land/auctions/schrader.json'], 'the commit job adds only the data file');
  assert.match(com, /\[skip ci\]/);
  assert.doesNotMatch(wf, /git add[^\n]*land\/schrader/, 'the raw capture never goes to main');
});
