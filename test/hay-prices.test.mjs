// hay-prices.html: USDA NASS prices received for alfalfa, other and all hay,
// $ per ton, by state, from data/hay/hay-prices.json (scripts/fetch_hay_prices.py,
// hay-prices workflow). Nothing shows until the file exists, withheld cells
// say so and are never a number, and the math matches hand-worked examples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(root, 'hay-prices.html'), 'utf8');
const dataPath = path.join(root, 'data/hay/hay-prices.json');

function lib() {
  const m = /\/\*hay:start\*\/([\s\S]*?)\/\*hay:end\*\//.exec(page);
  assert.ok(m, 'the page carries the hay view');
  // eslint-disable-next-line no-new-func
  return new Function(m[1] + '\nreturn {hayView, hayCell, hayChange, hayPerBale, haySpark};')();
}

// 13 months, Sep 2025 to Sep 2026. Index 12 is the newest month, 0 a year before.
const months = Array.from({ length: 13 }, (_, i) => {
  const t = 2025 * 12 + 8 + i;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
});
const fill = (ago, now) => months.map((_, i) => (i === 0 ? ago : i === 12 ? now : 200));
const D = {
  latest: '2026-09', released: '2026-09-29', months,
  names: { CA: 'California', MT: 'Montana', OR: 'Oregon', WI: 'Wisconsin' },
  series: {
    alfalfa: {
      label: 'Alfalfa hay', us: fill(209, 197),
      states: { CA: fill(244, 205), MT: fill(206, 'D'), OR: fill('S', 235), WI: fill(201, 208) },
    },
  },
};
const NOW = Date.parse('2026-10-16T18:00:00Z');

test('head, byline and structured data', () => {
  assert.match(page, /<title>Hay prices by state[^<]*\| AGSIST<\/title>/);
  assert.match(page, /<link rel="canonical"\s+href="https:\/\/agsist\.com\/hay-prices">/);
  assert.match(page, /<h1>Hay prices by state<\/h1>/);
  assert.match(page, /Sigurd Lindquist, CCA/);
  assert.match(page, /og:image" content="https:\/\/agsist\.com\/img\/og\/hay-prices\.jpg/);
  const blocks = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.ok(blocks.length >= 1);
  const ld = JSON.parse(blocks[0][1]);
  const types = ld['@graph'].map((g) => g['@type']);
  for (const t of ['WebPage', 'Dataset', 'BreadcrumbList', 'FAQPage']) assert.ok(types.includes(t), t);
  const faq = ld['@graph'].find((g) => g['@type'] === 'FAQPage');
  assert.ok(faq.mainEntity.length >= 5);
  const faqText = JSON.stringify(faq).replace('$180 a ton is 180 x 1,200 / 2,000 = $108 a bale', '');
  assert.doesNotMatch(faqText, /\$\d/, 'no live prices baked into the FAQ (only the worked bale example)');
});

test('no em dashes anywhere on the page', () => {
  assert.doesNotMatch(page, /—|&mdash;/);
});

test('honest empty state before the first USDA read', () => {
  const m = /<!--HAY:STATIC-->([\s\S]*?)<!--\/HAY:STATIC-->/.exec(page);
  assert.ok(m, 'static block markers');
  if (!fs.existsSync(dataPath)) {
    assert.match(m[1], /Prices load after the first USDA read/);
    assert.doesNotMatch(m[1], /\$\d/, 'no baked dollar figure without data');
  } else {
    const d = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    assert.ok(m[1].includes(d.latest_label), 'stamped block names the newest month');
  }
  assert.match(page, /<div class="hp-seg" id="hp-seg"[^>]*hidden>/, 'hay picker hidden until data loads');
  const { hayView } = lib();
  assert.equal(hayView(null, 'alfalfa', 'now', NOW), null);
  assert.equal(hayView({}, 'alfalfa', 'now', NOW), null);
});

test('US answer, year ago and change, worked by hand', () => {
  const v = lib().hayView(D, 'alfalfa', 'now', NOW);
  assert.equal(v.monthLong, 'September 2026');
  assert.equal(v.nowHead, 'Sep 2026');
  assert.equal(v.agoHead, 'Sep 2025');
  assert.equal(v.us.nowCell.txt, '$197');
  assert.equal(v.us.agoCell.txt, '$209');
  // 197 - 209 = -12; -12 / 209 = -5.7% -> -6%
  assert.equal(v.us.chg.txt, '-$12 (-6%)');
  assert.equal(v.released, 'USDA released Sep 29, 2026');
  assert.equal(v.stale, false);
});

test('withheld and too-few-reports cells say so and are never a number', () => {
  const v = lib().hayView(D, 'alfalfa', 'now', NOW);
  const mt = v.rows.find((r) => r.st === 'MT');
  assert.deepEqual(mt.nowCell, { txt: 'withheld by USDA', flag: true });
  assert.equal(mt.chg, null);
  const or = v.rows.find((r) => r.st === 'OR');
  assert.deepEqual(or.agoCell, { txt: 'too few reports', flag: true });
  assert.equal(or.chg, null);
  assert.deepEqual(lib().hayCell(null), { txt: 'not published', flag: true });
  assert.deepEqual(lib().hayCell(0), { txt: 'not published', flag: true }, 'a zero is not a price');
});

test('sorting: highest first, flagged cells last; by change; by name', () => {
  const { hayView } = lib();
  assert.deepEqual(hayView(D, 'alfalfa', 'now', NOW).rows.map((r) => r.st), ['OR', 'WI', 'CA', 'MT']);
  // changes: WI +7, CA -39, MT and OR none
  assert.deepEqual(hayView(D, 'alfalfa', 'chg', NOW).rows.map((r) => r.st), ['WI', 'CA', 'MT', 'OR']);
  assert.deepEqual(hayView(D, 'alfalfa', 'name', NOW).rows.map((r) => r.name), ['California', 'Montana', 'Oregon', 'Wisconsin']);
});

test('price per bale: $/ton x lb / 2000', () => {
  const { hayPerBale, hayView } = lib();
  assert.equal(hayPerBale(180, 1200), 108); // the FAQ example
  assert.equal(hayPerBale(200, 50), null, 'implausible bale weight');
  assert.equal(hayPerBale('D', 1200), null);
  assert.equal(hayView(D, 'alfalfa', 'now', NOW, 1000).us.bale, 99); // 197 x 1000 / 2000 = 98.5
  assert.match(page, /180 x 1,200 \/ 2,000 = \$108 a bale/);
});

test('a missing series and an old file are told plainly', () => {
  const { hayView } = lib();
  const m = hayView(D, 'other', 'now', NOW);
  assert.equal(m.missing, true);
  assert.equal(m.label, 'Other hay');
  assert.equal(hayView(D, 'alfalfa', 'now', Date.parse('2026-11-20T18:00:00Z')).stale, true);
});

test('chart leaves gaps for withheld months', () => {
  const svg = lib().haySpark(months, fill(206, 'D'), 400, 190, true);
  assert.match(svg, /<path d="M[^"]*"/);
  assert.doesNotMatch(svg, /class="hp-dot"/, 'no dot on a withheld newest month');
});

test('the fetcher selftest passes; the workflow runs it first and has a probe', () => {
  const out = execFileSync('python3', ['scripts/fetch_hay_prices.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /all hay price checks pass/);
  const wf = fs.readFileSync(path.join(root, '.github/workflows/hay-prices.yml'), 'utf8');
  assert.ok(wf.indexOf('--selftest') < wf.indexOf('run: python scripts/fetch_hay_prices.py\n'), 'selftest first');
  assert.match(wf, /probe:/);
  assert.match(wf, /fetch_hay_prices\.py --probe/);
  assert.match(wf, /NASS_API_KEY: \$\{\{ secrets\.NASS_API_KEY \}\}/);
});

test('a data file, when present, is shaped right', () => {
  if (!fs.existsSync(dataPath)) return;
  const d = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  assert.equal(d.unit, '$/ton');
  assert.equal(d.months[d.months.length - 1], d.latest);
  for (const k of ['alfalfa', 'all']) assert.ok(d.series[k], k);
  for (const s of Object.values(d.series)) {
    for (const v of [...s.us, ...Object.values(s.states).flat()]) {
      assert.ok(v === null || typeof v === 'string' || (v >= 20 && v <= 800), String(v));
    }
  }
});
