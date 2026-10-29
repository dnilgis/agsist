/**
 * Farm credit by Federal Reserve district, Oct 28 2026.
 * data/farm-credit/districts.json is built by scripts/build_farm_credit.py from the
 * Kansas City Fed's table of district ag credit surveys (raw branch,
 * history/fed-ag-credit/2026-10-28/). These rows were read by hand from that table
 * (Data sheet, 2026Q2 row), and the Chicago and Dallas ones again from those banks'
 * own files, so a reader change that moves any of them fails here:
 *   003/004 CHI 73 / 124 (Chicago Fed xls, 20262: 73, 124)
 *   003/004 DAL 96.15 / 103.85 (Dallas aglending.xlsx, 2026: Q2: -3.85 and 3.85, plus 100)
 *   003/004 KC 85.21 / 118.31 (also the Kansas City Fed's Q226 credit conditions file)
 *   003/004 MIN 75.93 / 142.59    003/004 STL 66.67 / 126.19    005 CHI 116
 *   Chicago 2025Q3 repayment: 82 in the Kansas City table, 64 in the Chicago Fed's own file -> withheld.
 *   Richmond's last reading 2021Q4, San Francisco's 2020Q2: not shown.
 * The Atlas state pages and the by-state hub carry the section, with the reserve bank credited.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const doc = JSON.parse(read('data/farm-credit/districts.json'));
const D = doc.districts;
const qi = (q) => (+q.slice(0, 4) * 4 + +q[5] - 1) - (+doc.chart_from.slice(0, 4) * 4 + +doc.chart_from[5] - 1);

test('latest quarter matches the table, read by hand', () => {
  assert.equal(doc.latest, '2026Q2');
  assert.deepEqual(D.CHI.latest, { repay: 73, renew: 124, collat: 116 });
  assert.equal(D.DAL.latest.repay, 96.15);
  assert.equal(D.DAL.latest.renew, 103.85);
  assert.equal(D.KC.latest.repay, 85.21);
  assert.equal(D.KC.latest.renew, 118.31);
  assert.equal(D.MIN.latest.repay, 75.93);
  assert.equal(D.MIN.latest.renew, 142.59);
  assert.equal(D.STL.latest.repay, 66.67);
  assert.equal(D.STL.latest.renew, 126.19);
  for (const d of ['CHI', 'DAL', 'KC', 'MIN', 'STL']) {
    assert.equal(D[d].current, true, d);
    assert.equal(D[d].chart.repay.at(-1), D[d].latest.repay, d);
    assert.equal(D[d].chart.renew.at(-1), D[d].latest.renew, d);
  }
});

test('a quarter where the two files disagree is withheld, never guessed', () => {
  const w = doc.withheld.find((x) => x.district === 'CHI' && x.q === '2025Q3' && x.series === 'repay');
  assert.deepEqual(w, { district: 'CHI', q: '2025Q3', series: 'repay', kc: 82, own: 64 });
  assert.equal(D.CHI.chart.repay[qi('2025Q3')], null);
  assert.equal(D.CHI.chart.repay[qi('2025Q4')], 69);
  assert.ok(doc.withheld.some((x) => x.district === 'DAL' && x.q === '2012Q3' && x.kc === 105.7 && x.own === 115.68));
  assert.equal(D.DAL.chart.repay[qi('2012Q3')], null);
  // a quarter that agrees is kept: Dallas 2025Q4 85.71 (table 85.71000000000001, Dallas -14.29)
  assert.equal(D.DAL.chart.repay[qi('2025Q4')], 85.71);
});

test('each card links the reserve bank survey page its saved copy proves (references branch, Oct 29)', () => {
  assert.equal(D.CHI.url, 'https://www.chicagofed.org/research/data/ag-conditions/index');
  assert.equal(D.KC.url, 'https://www.kansascityfed.org/center-for-agriculture-and-the-economy/ag-credit-survey/');
  assert.equal(D.DAL.url, 'https://www.dallasfed.org/research/surveys/agsurvey');
  assert.equal(D.MIN.url, 'https://www.minneapolisfed.org/topic/agriculture-and-farming');
  // St. Louis: the survey page fetch timed out, so the home page stays until a copy is saved
  assert.equal(D.STL.url, 'https://www.stlouisfed.org/');
  const ids = JSON.parse(read('references/sources.json')).sources.map((r) => r.url);
  for (const d of ['CHI', 'KC', 'DAL', 'MIN']) assert.ok(ids.includes(D[d].url), d);
  assert.match(section(page('iowa')), /<a href="https:\/\/www\.chicagofed\.org\/research\/data\/ag-conditions\/index" rel="noopener">Chicago Fed ag survey<\/a>, 2026 Q2\./);
});

test('districts that stopped reporting are not shown as current', () => {
  assert.equal(D.RICH.current, false);
  assert.equal(D.RICH.last, '2021Q4');
  assert.equal(D.SF.current, false);
  assert.equal(D.SF.last, '2020Q2');
  assert.equal(D.STL.first.repay, '2012Q2');
});

test('the index explained as the survey asks it; no em dash', () => {
  assert.equal(doc.how, 'Each quarter, ag bankers in the district say whether each item was higher, lower or the same as a year earlier. The index is the percent saying higher, minus the percent saying lower, plus 100. Over 100 means more said higher; under 100, more said lower; 100 is an even split.');
  assert.match(D.KC.note, /Farm Credit System lenders/);
  assert.ok(!JSON.stringify(doc).includes('—'));
  assert.equal(Object.keys(doc.states).length, 51);
  assert.deepEqual(doc.states.IL, ['CHI', 'STL']);
  assert.deepEqual(doc.states.IA, ['CHI']);
});

const page = (s) => read(`farmland-atlas/${s}/index.html`);
const section = (h) => {
  const i = h.indexOf('id="farm-credit"');
  return i < 0 ? '' : h.slice(i, h.indexOf('</details>', i));
};

test('state pages: whole state, split state, and a state with no reporting district', () => {
  const ia = section(page('iowa'));
  assert.match(ia, /Iowa is in the Chicago Fed district \(7th\)\./);
  assert.match(ia, /<p class="read">Tighter for borrowers than a year earlier\.<\/p>/);
  assert.match(ia, /<span class="r">73<small>Under 100: more bankers said repayment rates fell than rose\.<\/small>/);
  assert.match(ia, /<span class="r">124<small>Over 100: more bankers said renewals or extensions rose than fell\.<\/small>/);
  assert.match(ia, /<span class="r">116<small>Over 100: more bankers asked for more collateral than less\.<\/small>/);
  // the quarters left out are named once, in the page's collapsed note, not on the card
  assert.match(ia, /disagree: Chicago: 2010 Q2, 2022 Q2, 2025 Q3\./);
  assert.ok(ia.indexOf('2025 Q3') > ia.indexOf('<details><summary>How this works</summary>'));
  const il = section(page('illinois'));
  assert.match(il, /Parts of Illinois are in the Chicago and St\. Louis Fed districts\. Both are shown\./);
  assert.equal((il.match(/class="card"/g) || []).length, 2);
  const ky = section(page('kentucky'));
  assert.match(ky, /Parts of Kentucky are in the St\. Louis and Cleveland Fed districts\. The Cleveland district has no farm credit survey in the Kansas City Fed&#x27;s table, so only St\. Louis is shown\./);
  const nm = section(page('new-mexico'));
  assert.match(nm, /Parts of New Mexico are in the Kansas City and Dallas Fed districts\. Both are shown\./);
  assert.match(nm, /Farm Credit System lenders/);
  assert.match(nm, /disagree: Dallas: 2010 Q1, [^.]*2012 Q3,/);
  assert.equal(section(page('california')), '');
  assert.equal(section(page('ohio')), '');
});

test('one short source line per card, linked to the reserve bank; the explanation once, collapsed', () => {
  for (const s of ['iowa', 'illinois', 'kansas', 'texas', 'minnesota', 'arkansas']) {
    const h = page(s);
    const sec = section(h) + '</details>';
    const cards = sec.split('class="card"').length - 1;
    assert.ok(cards >= 1, s);
    assert.equal((sec.match(/<p class="note">Source: <a href="https:\/\/www\.(chicagofed|stlouisfed|minneapolisfed|kansascityfed|dallasfed)\.org\/[^"]*" rel="noopener">(Chicago|St\. Louis|Minneapolis|Kansas City|Dallas) Fed ag survey<\/a>, 2026 Q2\.<\/p>/g) || []).length, cards, s);
    assert.equal((h.match(/<details><summary>How this works<\/summary>/g) || []).length, 1, s);
    assert.equal((sec.match(/The index is the percent saying higher/g) || []).length, 1, s);
    assert.ok(!/survey of ag bankers|as compiled by|Gold solid line|Since 20\d\d Q\d\./.test(sec), s);
    assert.ok(!sec.includes('—'), s);
  }
  const hub = section(read('farmland-atlas/states/index.html'));
  assert.match(hub, /Farm loans by Fed district, 2026 Q2/);
  assert.equal((hub.match(/class="card"/g) || []).length, 5);
  assert.match(hub, /In all 5 districts that report/);
  assert.equal((hub.match(/Fed ag survey<\/a>, 2026 Q2\./g) || []).length, 5);
  assert.equal((read('farmland-atlas/states/index.html').match(/<details><summary>How this works<\/summary>/g) || []).length, 1);
  assert.match(hub, /Tighter for borrowers than a year earlier\.<\/b> Repayment index 73, renewals or extensions index 124\./);
  // the main Atlas page points at the national view with one line, no card
  assert.match(read('farmland-atlas.html'), /<p class="fa-note">Farm loans: [^<]*<a href="\/farmland-atlas\/states\/#farm-credit">by-state page<\/a>\.<\/p>/);
  assert.ok(!hub.includes('—'));
});

test('the builder and the view pass their selftests', () => {
  for (const s of ['scripts/build_farm_credit.py', 'scripts/farm_credit_view.py']) {
    const out = execFileSync('python3', [path.join(root, s), '--selftest'], { encoding: 'utf8' });
    assert.match(out, /selftest: all passed/, s);
  }
  assert.match(execFileSync('python3', [path.join(root, 'scripts/build_farm_credit.py'), '--check'], { encoding: 'utf8' }), /farm credit file: ok \(2026Q2\)/);
});

test('the run that refreshes it is by hand only', () => {
  const y = read('.github/workflows/farm-credit.yml');
  assert.ok(!/^\s*schedule:/m.test(y));
  assert.match(y, /workflow_dispatch:/);
  assert.match(read('.github/workflows/farmland-atlas-pages.yml'), /"Farm credit by Fed district"/);
});
