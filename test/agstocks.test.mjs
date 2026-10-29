/* /ag-stocks (Sig, Oct 29, 2026): ag company closes from Yahoo, SEC filings, the AGSIST Ag 20.
 * - the index math, the SEC picks and the page states run as python selftests on fixed fixtures
 *   (scripts/agstocks_index.py: equal weight, gates, stale, held, rebalance continuity, split, removal);
 * - every close baked into ag-stocks.html is the stored source row of that date, every index level
 *   is the last level in data/agstocks/index.json, and every number block carries its source and date;
 * - no buy, broker or affiliate link, the plain-words caveats, page under the 150 KB cap;
 * - the tap lines in components/agstocks.js show a number only when the filing data has it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const js = (p) => { try { return JSON.parse(rd(p)); } catch { return null; } };
const PAGE = rd('ag-stocks.html');

for (const s of ['scripts/agstocks_index.py', 'scripts/agstocks.py', 'scripts/agstocks_plants.py', 'scripts/build_agstocks_page.py']) {
  test(`${s} --selftest passes`, () => {
    const r = spawnSync('python3', [s, '--selftest'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /selftest: ok/);
  });
}

test('ag-stocks.html is what the builder makes from data/agstocks', () => {
  const r = spawnSync('python3', ['scripts/build_agstocks_page.py', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('every baked close is the stored Yahoo row for its date, and prints as stored', () => {
  const rows = {};
  const cdir = path.join(ROOT, 'data/agstocks/closes');
  if (fs.existsSync(cdir)) for (const f of fs.readdirSync(cdir)) Object.assign(rows, JSON.parse(fs.readFileSync(path.join(cdir, f), 'utf8')).rows);
  const re = /<tr data-t="([A-Z.]+)" data-close="([\d.]+)" data-d="(\d{4}-\d\d-\d\d)">.*?<td class="n">\$([\d,]+\.\d\d)<\/td>/g;
  let n = 0;
  for (const m of PAGE.matchAll(re)) {
    const [, t, close, d, shown] = m;
    assert.ok(rows[d] && rows[d][t], `${t}: no stored row for ${d}`);
    assert.equal(Number(close), rows[d][t][0], `${t} ${d}: page ${close}, stored ${rows[d][t][0]}`);
    assert.equal(shown, Number(close).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), `${t} printed`);
    n++;
  }
  const rowsWithClose = (PAGE.match(/<tr data-t="[A-Z.]+" data-close=/g) || []).length;
  assert.equal(n, rowsWithClose, 'every row with a close was checked');
  if (n) assert.match(PAGE, /<caption>Closes [A-Z][a-z]{2} \d{1,2}, \d{4} &middot; <a href="https:\/\/finance\.yahoo\.com\/"[^>]*>Yahoo Finance<\/a>, delayed<\/caption>/, 'table caption: date and Yahoo credit');
});

test('the index level on the page is the last stored level, with its source and date; before the base it says only "Starts Nov 2"', () => {
  const ix = js('data/agstocks/index.json');
  const a = ix && ix.ix && ix.ix.ag20;
  const m = PAGE.match(/data-ix="([\d.]+)" data-d="(\d{4}-\d\d-\d\d)"/);
  if (!a || a.status !== 'live') {
    assert.equal(m, null, 'no level before the base day');
    assert.match(PAGE, /<h2 id="h-ix">AGSIST Ag 20<\/h2><p class="ags-big">Starts Nov 2<\/p><\/section>/);
    return;
  }
  const last = a.levels[a.levels.length - 1];
  assert.ok(m, 'level present');
  assert.equal(Number(m[1]), last.v);
  assert.equal(m[2], last.d);
  assert.match(PAGE, /<p class="ags-src">Closes: <a href="https:\/\/finance\.yahoo\.com\/"[^>]*>Yahoo Finance<\/a>, delayed, as of [A-Z][a-z]{2} \d{1,2}, \d{4} close\.<\/p>/);
  assert.match(PAGE, /share prices of suppliers \/ buyers, not fertilizer or grain prices/);
  if (last.held) assert.doesNotMatch(PAGE.match(/<section class="ags-ix"[\s\S]*?<\/section>/)[0], /0\.00%/, 'a held day is never shown as 0%');
});

test('revenue cells come from sec.json quarter pairs, labeled whole company', () => {
  const sec = js('data/agstocks/sec.json');
  let n = 0;
  for (const row of PAGE.matchAll(/<tr data-t="([A-Z.]+)"[^>]*>((?:(?!<\/tr>).)*)<\/tr>/g)) {
    const t = row[1];
    const m = row[2].match(/<td class="n" title="Quarter ended ([^"]+?): [^"]*whole company">([+−]?[\d.]+%)<\/td>$/);
    if (!m) { assert.match(row[2], /<td class="n ags-muted">n\/a<\/td>$/, `${t}: a change or n/a`); continue; }
    const r = sec.c[t].rev;
    const p = (r.cur.val / r.prior.val - 1) * 100;
    const want = (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(1) + '%';
    assert.equal(m[2], want, `${t} revenue change`);
    n++;
  }
  if (sec) assert.ok(n > 0, 'some revenue changes shown');
});

test('plain words, no buy or broker links, no em dash, under the page cap', () => {
  assert.match(PAGE, /Not investment advice; not a fund you can buy\./);
  assert.ok(!PAGE.includes('—'), 'no em dash');
  const hrefs = [...PAGE.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  for (const h of hrefs) {
    assert.doesNotMatch(h, /robinhood|etrade|schwab|fidelity|webull|tdameritrade|interactivebrokers|vanguard\.com|sofi|affiliate|[?&](ref|aff|utm_)/i, h);
  }
  assert.doesNotMatch(PAGE, />\s*(Buy|Invest|Trade) (now|shares|this)/i);
  assert.ok(Buffer.byteLength(PAGE) < 150 * 1024, `page ${Buffer.byteLength(PAGE)} bytes`);
  assert.ok(Buffer.byteLength(PAGE) < 60 * 1024, 'bulky data stays in data files, loaded on tap');
  assert.doesNotMatch(PAGE, /predicts? (local|cash|basis)/i);
});

test('plants are listed only for universe members, matched by operator name', () => {
  const pl = js('data/agstocks/plants.json');
  const u = js('data/agstocks/universe.json');
  assert.ok(pl && pl.plants);
  const pat = { ADM: /^(ADM\b|Archer[- ]Daniels)/i, BG: /^Bunge\b/i, GPRE: /^Green Plains\b/i, ALTO: /^Alto Ingredients\b/i, AMTX: /^Aemetis\b/i, ANDE: /^(The )?Andersons\b/i };
  for (const [t, list] of Object.entries(pl.plants)) {
    if (u) assert.ok(u.members.some((m) => m.t === t), `${t} is a member`);
    for (const p of list) {
      assert.ok(pat[t] && pat[t].test(p.op), `${t}: ${p.op}`);
      assert.ok(p.src, 'source named');
    }
  }
});

test('tap lines: a number only when the filing has it, whole company, no prediction words', () => {
  const ctx = { window: {}, document: { addEventListener() {}, getElementById() { return null; } }, localStorage: { getItem() { return null; } } };
  vm.createContext(ctx);
  vm.runInContext(rd('components/agstocks.js'), ctx);
  const L = ctx.window.AgStocks.lines;
  assert.equal(L('X', {}, null, null).length, 0, 'nothing on file: no lines');
  const rec = {
    cik: '0000315189',
    periodic: { form: '10-Q', filed: '2026-08-27', period: '2026-08-02', url: 'https://www.sec.gov/Archives/edgar/data/315189/x/y.htm' },
    rev: { cur: { end: '2026-08-02', val: 12.0e9, accn: '0001104659-26-102213', filed: '2026-08-27', form: '10-Q' }, prior: { end: '2025-08-03', val: 12.5e9 } },
    earnings: { filed: '2026-08-14', url: 'https://www.sec.gov/e' }, usual_months: [2, 5, 8, 11],
  };
  const out = L('DE', rec, { hi52: 500, lo52: 400, d: '2026-10-29' }, { plants: {} });
  assert.equal(out.length, 4);
  assert.match(out[1], /Revenue, whole company: \$12\.00 billion in the three months ended Aug 2, 2026, down 4\.0% from \$12\.50 billion a year before/);
  assert.match(out[2], /Usually reports in February, May, August and November \(its 8-K earnings releases, last three years\)/);
  assert.match(out[3], /52-week closing range: \$400\.00 to \$500\.00/);
  for (const l of out) assert.doesNotMatch(l, /will|expect|forecast|likely|should/i, l);
  const withPlants = L('ADM', {}, null, { plants: { ADM: [{ k: 'ethanol' }, { k: 'crush' }, { k: 'crush' }] } });
  assert.match(withPlants[0], /1 ethanol plant, 2 soybean crush plants/);
});

test('the page is findable: sitemap, search, llms.txt, the markets index; the workflow runs weekdays after the close', () => {
  assert.match(rd('sitemap.xml'), /<loc>https:\/\/agsist\.com\/ag-stocks<\/loc>/);
  assert.match(rd('scripts/build_search_index.py'), /\("\/ag-stocks",/);
  assert.match(rd('llms.txt'), /agsist\.com\/ag-stocks/);
  assert.match(rd('markets.html'), /<a href="\/ag-stocks">/);
  const wf = rd('.github/workflows/agstocks.yml');
  assert.match(wf, /cron: '17 22 \* \* 1-5'/);
  assert.match(wf, /pip install yfinance==1\.7\.0/);
  assert.match(rd('.github/workflows/prices.yml'), /pip install yfinance==1\.7\.0/, 'same Yahoo client version as prices.yml');
});
