// Futures pages and the markets board: what stays on the page after a bake.
// 2026-10-15 head to head: the titles and descriptions still carried the
// 8:31 a.m. CT Oct 14 trade 18 hours later (soybeans "+0.35%" on a day that
// finished lower), and the wheat page's baked table showed Mar '27 and KC at
// morning prices under live cards that said otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('live prices hide the whole baked table, not just the nearby row', () => {
  const js = read('components/futures.js');
  const i = js.indexOf("setEl('hero-price',grain$(front.close));");
  assert.ok(i > 0, 'hero fill found');
  const block = js.slice(i, i + 1200);
  assert.match(block, /querySelector\('\.seed-tbl-wrap'\);if\(__st\)__st\.style\.display='none'/);
  assert.doesNotMatch(block, /\/\^Nearby\//, 'no row-by-row filter that leaves deferred and KC rows behind');
  for (const p of ['corn', 'soybean', 'wheat']) {
    assert.match(read(`${p}-futures-prices.html`), /futures\.js\?v=16/, `${p} page loads the new futures.js`);
  }
});

test('a morning bake writes the previous close into the description, with no percent or clock time', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fut-'));
  fs.copyFileSync(path.join(root, 'soybean-futures-prices.html'), path.join(dir, 'soybean-futures-prices.html'));
  const prices = {
    fetched: '2026-10-14T13:31:00Z',
    quotes: {
      'beans-nearby': { ticker: 'ZSX26.CBT', close: 1288.25, netChange: 4.5, pctChange: 0.35,
                        close_date: '2026-10-14', prev_date: '2026-10-13', contract: "Nov '26" },
    },
    nearby: { beans: { key: 'beans-nov26', label: "Nov '26" } },
  };
  const py = `
import sys, json, os
sys.path.insert(0, ${JSON.stringify(path.join(root, 'scripts'))})
os.chdir(${JSON.stringify(dir)})
import seed_static as s
s.PAGES = {k: v for k, v in s.PAGES.items() if k.startswith('soybean')}
s.seed_futures_pages(json.loads(sys.argv[1]), '2026-10-14')
`;
  execFileSync('python3', ['-c', py, JSON.stringify(prices)], { stdio: 'pipe' });
  const out = fs.readFileSync(path.join(dir, 'soybean-futures-prices.html'), 'utf8');
  const desc = /<meta name="description" content="([^"]*)"/.exec(out)[1];
  assert.match(desc, /^Soybeans Nov '26 settled \$12\.83¾ on Oct 13\./, desc);
  assert.doesNotMatch(desc, /closed/, 'only a settle is named, and it is called settled');
  assert.doesNotMatch(desc, /%|a\.m\.|p\.m\.|12\.88/, desc);
});

test('bake_seo selftest passes (finished sessions only in titles)', () => {
  const out = execFileSync('python3', ['scripts/bake_seo.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /all bake_seo checks pass/);
  assert.match(out, /a morning run titles beans with the Oct 13 close/);
});

test('the freshness workflow retries a rejected push and has an evening run', () => {
  const y = read('.github/workflows/freshness.yml');
  assert.match(y, /for i in 1 2 3 4; do/);
  assert.match(y, /cron: '35 23 \* \* 1-5'/);
  assert.match(y, /--cron "35 23 \* \* 1-5"/);
});

test('the RP card names the harvest price so far and writes a dollar-plus gap in dollars', () => {
  const js = read('components/futures.js');
  assert.match(js, /Harvest price so far: <strong>'\+AG\.px\.priceDollars\(sc\.rp\.running\)/);
  assert.match(js, /running:\(hs==='running'&&row\.harvest\.running_avg!=null/);
  assert.match(js, /Math\.abs\(g\)>=1\?AG\.px\.priceDollars\(Math\.abs\(g\)\):AG\.px\.move\(Math\.abs\(g\)\*100\)/);
});

test('the cattle COT sentence follows its own number', () => {
  const html = read('cattle-futures-prices.html');
  assert.doesNotMatch(html, /High net-long positioning can amplify the downside if funds liquidate; a low reading leaves room/);
  assert.match(html, /lp>=80\?' Positioning that high can amplify a drop if funds sell out\.':\(lp<=20\?' A reading that low leaves room for funds to buy back in\.'/);
});

// 2026-10-17 audit N9: the futures pages and /cot printed two different
// measures under the same words ("A shorter yardstick"). Each names its own.
test('the COT range line and the /cot percentile say which measure they are', () => {
  const fj = read('components/futures.js'), cj = read('components/cot-page.js');
  assert.match(fj, /Where the net sits in its 52-week range, in contracts: '\+p52\+'% of the way from the low/);
  assert.match(cj, /Where the net ranks among the last '\+k\.weeks\+' weeks, in contracts: the '\s*\+ordinal\(k\.pct\)\+' percentile/);
  assert.doesNotMatch(fj + cj, /A shorter yardstick/);
});
