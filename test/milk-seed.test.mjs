// milk-prices.html: the figures a crawler or a no-JS reader sees are baked from
// data/dairy-data.json by scripts/seed_static.py (seed_milk) and the title by
// scripts/bake_seo.py (seo_milk). Until 2026-10-13 they were typed by hand and
// the body sat on August ($16.64) while the file held September ($16.04).
// These checks hold the page to the file, whatever month it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../milk-prices.html', import.meta.url), 'utf8');
const d = JSON.parse(fs.readFileSync(new URL('../data/dairy-data.json', import.meta.url), 'utf8'));
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const idx = (k) => { const m = /^(\d{4})-(\d{2})$/.exec(k || ''); return m ? (+m[1]) * 12 + (+m[2]) - 1 : NaN; };
const short = (i) => `${MONS[i % 12]} ${Math.floor(i / 12)}`;
const long = (i) => `${MONL[i % 12]} ${Math.floor(i / 12)}`;
const cwt = (v) => '$' + v.toFixed(2);
const seedOf = (tag) => {
  const m = new RegExp(`<!--SEED:${tag}-->([\\s\\S]*?)<!--/SEED-->`).exec(page);
  assert.ok(m, `SEED:${tag} marker is on the page`);
  return m[1];
};
const ci = idx(d.class_month_key);

test('the seeded class month is the file\'s class month', () => {
  assert.ok(Number.isFinite(ci), 'the file names its class month');
  assert.equal(/data-seed-month="([^"]*)"/.exec(page)[1], d.class_month_key);
});

test('seeded Class III and Class IV match the file, month and price', () => {
  const strip = seedOf('milkstrip');
  for (const [id, key] of [['c3', 'class3'], ['c4', 'class4']]) {
    const val = new RegExp(`id="${id}-val"( data-v="([^"]*)")?>([^<]*)`).exec(strip);
    const meta = new RegExp(`id="${id}-meta">([^<]*)<`).exec(strip)[1];
    assert.ok(val, `${id} cell is seeded`);
    if (val[3] === '-') {
      // withheld once the next month is due: the reason names the month held
      assert.equal(meta, `Latest on file: ${long(ci)}. Older than last month’s announcement.`);
    } else {
      assert.equal(val[2], d[key].toFixed(2), `${id} data-v`);
      assert.equal(val[3], cwt(d[key]), `${id} shown price`);
      assert.equal(meta, `${short(ci)} · USDA announced`, `${id} month`);
    }
  }
});

test('the verdict and the Class III list line say the file\'s month and prices', () => {
  const v = seedOf('milkverdict');
  if (v.startsWith('The newest announced milk prices held here are from')) {
    assert.ok(v.includes(long(ci)));
    return;
  }
  assert.ok(v.startsWith(MONS[ci % 12] + ':') || v.startsWith(d.class_month), v);
  assert.ok(v.includes(cwt(d.class3)) && v.includes(cwt(d.class4)), v);
  const li = seedOf('milkvcls');
  assert.ok(li.includes(`<span class="n">${MONS[ci % 12]}</span>`), li);
  assert.ok(li.includes(`<strong>${cwt(d.class3)}/cwt</strong>`) && li.includes(`<strong>${cwt(d.class4)}/cwt</strong>`), li);
});

test('the all-milk cell carries the file\'s NASS month', () => {
  const a = d.all_milk;
  if (!a || !(a.value > 0)) return;
  const strip = seedOf('milkstrip');
  const m = /id="am-val" data-key="([^"]*)">([^<]*)/.exec(strip);
  assert.ok(m, 'all-milk cell is seeded');
  assert.equal(m[1], a.month_key);
  if (m[2] !== '-') assert.equal(m[2], cwt(a.value));
});

test('the waterfall seed, when baked, is the file\'s month', () => {
  const s = /var SEED=(\{[^\n]*\});/.exec(page);
  assert.ok(s, 'the script carries a SEED object');
  const seed = JSON.parse(s[1]);
  // the seeder writes it only when the teaching model reproduces the announced
  // price; when it does, month and price are the file's
  if (seed.month === d.class_month) assert.equal(seed.classIII, d.class3);
  assert.ok(seedOf('milkfallmonth').includes(`<b>${seed.month}</b>`));
});

test('the title, when it carries a number, carries the file\'s month and price', () => {
  const t = /<title>([^<]*)<\/title>/.exec(page)[1];
  if (/\$\d/.test(t)) {
    assert.ok(t.includes(d.class_month) && t.includes(cwt(d.class3)), t);
    assert.ok(t.length >= 50 && t.length <= 60, `title is ${t.length} chars: ${t}`);
  }
  assert.ok(!/—/.test(t), 'no em dash in the title');
});

test('the component and product blocks name only the file\'s class month', () => {
  const any = new RegExp(`\\b(${MONL.join('|')}|${MONS.join('|')}) \\d{4}\\b`, 'g');
  for (const tag of ['milkcompsrc', 'milkcomp', 'milkprodsrc', 'milkprod', 'milkspread']) {
    for (const m of seedOf(tag).matchAll(any)) {
      assert.ok(m[0] === short(ci) || m[0] === long(ci), `${tag} names ${m[0]}, the file holds ${long(ci)}`);
    }
  }
});

// 2026-10-15 head to head: the trap section is written for Class III above
// Class IV, and the spread line linked it as this month's story while Sep 2026
// had Class IV $2.90 on top. The copy now follows the sign, baked and live.
test('the spread line and the trap heading follow which class leads, baked and live alike', () => {
  if (!(d.class3 > 0 && d.class4 > 0)) return;
  const s = Math.round((d.class3 - d.class4) * 100) / 100;
  const fn = (name) => {
    const i = page.indexOf(`function ${name}(`);
    assert.ok(i > 0, `${name} is in the page script`);
    const j = page.indexOf('\n    }\n', i);
    // eslint-disable-next-line no-new-func
    return new Function(page.slice(i, j + 6) + `\nreturn ${name};`)();
  };
  const why = fn('spreadWhy')(s), now = fn('trapNow')(s, short(ci));
  assert.ok(seedOf('milkspread').includes(`<span id="dp-spread-why">${why}</span>`), 'baked tail is the script\'s');
  assert.ok(seedOf('milktrapnow').includes(`>${now}</p>`), 'baked which-way line is the script\'s');
  if (s < 0) {
    assert.match(now, /Class IV was \$[\d.]+ above Class III\. That is the reverse of the case below\./);
    assert.doesNotMatch(why, /when your best milk pays you less/);
  } else if (s > 0) {
    assert.match(now, /That is the case below\./);
  }
});

// 2026-10-15 head to head: the mailbox price was March 2026, typed by hand.
// It now comes from data/dairy-mailbox.json (scripts/fetch_mailbox.py, the
// dairy workflow) and the page names the month it is from wherever it shows.
test('the mailbox price on the page is the file\'s, with its month', () => {
  const mb = JSON.parse(fs.readFileSync(new URL('../data/dairy-mailbox.json', import.meta.url), 'utf8'));
  const i = idx(mb.month_key);
  assert.ok(Number.isFinite(i) && mb.value > 0, 'the file names a month and a price');
  const li = seedOf('milkmbli'), cell = seedOf('milkmbcell'), row = seedOf('milkmbrow');
  assert.ok(li.includes(long(i)) && li.includes(`<strong>${cwt(mb.value)}/cwt</strong>`), li);
  assert.ok(li.includes('https://mymarketnews.ams.usda.gov/viewReport/3357'), 'links the AMS report');
  assert.ok(row.includes(`In ${long(i)} the federal-order mailbox average was ${cwt(mb.value)}/cwt`), row);
  const val = /(?:id="mb-val"|data-mb="none")>([^<]*)/.exec(cell)[1];
  if (val === '-') {
    assert.ok(cell.includes(`Newest loaded: ${long(i)}.`), cell);
    assert.ok(li.startsWith(`<li><span class="n">${MONS[i % 12]}</span>`) && li.includes('Older figure'), li);
  } else {
    assert.equal(val, cwt(mb.value));
    assert.ok(cell.includes(`USDA AMS · ${long(i)}`), cell);
  }
  assert.doesNotMatch(page, /Not in a public machine-readable feed/);
});
