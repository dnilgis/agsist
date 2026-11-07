/**
 * Schrader auction results reader (Nov 7, 2026; step 2 after the capture job, #411).
 *
 * scripts/read_schrader.py reads one capture folder (the sold feed and the result pages) into
 * data/land/auctions/schrader.json. This file holds:
 *   - the reader's own selftest passes on the scrubbed fixtures
 *   - auction 9630 gives Schrader's three printed rows and the $2,905,000 total
 *   - the fixtures are scrubbed: no phone number, no email, no "sold to" or "buyer" followed by a name
 *   - the data file carries facts only: no buyer, owner or name field, the credit and a link on every record,
 *     a per-acre figure only where Schrader printed one, farmland only
 *   - the capture workflow builds the file right after the capture, on a weekly gated Monday tick
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

test('the reader selftest passes on the scrubbed fixtures', () => {
  const out = execFileSync('python3', ['scripts/read_schrader.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /read_schrader selftest: 0 failure\(s\)/);
  assert.doesNotMatch(out, /^FAIL /m);
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
    assert.doesNotMatch(t, /(?:[Ss]old [Tt]o|SOLD TO|[Bb]uyers?|BUYERS?|[Pp]urchasers?|PURCHASERS?)\W{0,3}(?:is\s+|was\s+|:\s*)?[A-Z][a-z]+/, `${f}: a buyer named`);
    assert.doesNotMatch(t, /\/buyers\//i, `${f}: a buyer profile link`);
    assert.doesNotMatch(t, /Owner:(?!\s*\[owner\])/, `${f}: an owner named`);
    // a street address: a house number and a street word
    assert.doesNotMatch(t, /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Rd|Road|St|Street|Ave|Avenue|Dr|Drive|Ln|Lane|Hwy|Pike|Blvd|Ct|Way)\b/,
      `${f}: a street address`);
  }
  // the guard itself catches what it is for
  const hit = (s) => /(?:[Ss]old [Tt]o|SOLD TO|[Bb]uyers?|BUYERS?|[Pp]urchasers?|PURCHASERS?)\W{0,3}(?:is\s+|was\s+|:\s*)?[A-Z][a-z]+/.test(s);
  assert.ok(hit('Sold to Jane Example') && hit('Buyer: Example Farms') && !hit('2027 CROP RIGHT TO BUYER'));
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
  assert.doesNotMatch(read('data/land/auctions/schrader.json'), /buyer|purchaser|owner|—/i);
});

test('the capture workflow builds the file after the capture and runs weekly on Monday', () => {
  const wf = read('.github/workflows/schrader-capture.yml');
  const cron = /- cron: "(\d+) (\d+) \* \* 1"/.exec(wf);
  assert.ok(cron, 'a Monday schedule');
  assert.notEqual(Number(cron[1]), 0, 'not on the hour');
  // outside 6 to 9 AM Pacific in both PST (UTC-8) and PDT (UTC-7): 13:00 to 17:00 UTC is out
  const h = Number(cron[2]);
  assert.ok(h < 13 || h >= 17, `hour ${h} UTC falls in 6 to 9 AM Pacific`);
  const cap = wf.indexOf('python3 scripts/capture_schrader.py\n');
  const save = wf.indexOf('scripts/push_raw.sh "schrader capture" land/schrader/capture');
  const rd = wf.indexOf('python3 scripts/read_schrader.py --latest');
  assert.ok(cap > 0 && save > cap && rd > save, 'read after the capture and its save to raw');
  assert.ok(wf.indexOf('python3 scripts/read_schrader.py --selftest') > 0);
  const commit = wf.slice(rd);
  assert.match(commit, /git add data\/land\/auctions\/schrader\.json/);
  assert.match(commit, /\[skip ci\]/);
  assert.doesNotMatch(wf, /git add[^\n]*land\/schrader/, 'the raw capture never goes to main');
});
