// A lone space between two inline tags moves when the browser paints mid-parse (Oct 29, 2026).
// Real case: /milk-prices, "</strong> <span class="dp-dmc-src">": a paint after the space and before the span left the
// space with no place in the line, and its jump into the line when the rest arrived was a layout shift (CLS 0.011;
// PR #201 moved the space inside the span; test/milk-area-cls.test.mjs holds that page to a paused-parse run).
// The same shape sat on 175 more pages: the cash-bids line under every Daily briefing's byline
// ("<strong>Your local elevator bids</strong> <span class="dv3-cashbids-arrow">", written by
// scripts/generate_daily.py), plus the corn and soybean futures lines, the milk spread line and the sponsor page.
// This holds every page to it: no </strong> + whitespace + <span> anywhere in the markup (scripts and styles are not
// markup). The space goes inside the following span (or the builder), never between the tags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const LONE = /<\/strong>\s+<span\b/g;

// Pages another open change is rebuilding on the same day (BUILD-RULES 26: they ship in that change, not here).
// An entry whose page no longer has the pattern fails the test, so each one is removed when its change lands.
const LEFT = {
  'corn-futures-prices.html': 'PR #210 (quickwins) edits this page and components/futures.js; nc-chg is rewritten by futures.js',
  'soybean-futures-prices.html': 'fx/curtain edits this page and scripts/seed_static.py (the nc-line and corn-line seeds)',
  'milk-prices.html': 'fx/curtain edits this page and scripts/seed_static.py (the dp-spread seed; milk-prices.html sets dp-spread-words itself)',
  'sponsor.html': 'fx/curtain edits this page; the span is filled by script (textContent)',
};

function pages() {
  return execFileSync('git', ['ls-files', '-z', '*.html'], { cwd: ROOT, maxBuffer: 1 << 28 }).toString().split('\0')
    .filter((f) => f && !f.startsWith('test/') && !f.includes('node_modules/'));
}
/* the markup only: no <script>, <style>, comments or template strings in them */
function markup(s) {
  return s.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
}

test('no lone space between </strong> and <span> on any page', () => {
  const found = {};
  for (const f of pages()) {
    let s;
    try { s = fs.readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
    if (!s.includes('</strong>')) continue;
    const m = [...markup(s).matchAll(LONE)];
    if (m.length) found[f] = m.length;
  }
  const bad = Object.keys(found).filter((f) => !(f in LEFT));
  assert.deepEqual(bad, [], 'move the space inside the following span (or the builder that writes the page): ' + bad.slice(0, 5).join(', '));
  const stale = Object.keys(LEFT).filter((f) => !(f in found));
  assert.deepEqual(stale, [], 'pattern gone from these: take them off LEFT');
});

test('the Daily archive builder writes the space inside the arrow span, and the check sees the old shape', () => {
  const gen = fs.readFileSync(join(ROOT, 'scripts/generate_daily.py'), 'utf8');
  assert.match(gen, /<strong>Your local elevator bids<\/strong>'\n\s+'<span class="dv3-cashbids-arrow"> &rarr;<\/span>/);
  assert.ok('<strong>Your local elevator bids</strong> <span class="dv3-cashbids-arrow">&rarr;</span>'.match(LONE), 'the old shape is caught');
  assert.equal('<strong>Your local elevator bids</strong><span class="dv3-cashbids-arrow"> &rarr;</span>'.match(LONE), null);
  const arch = pages().filter((f) => /^daily\/\d{4}-\d{2}-\d{2}\.html$/.test(f));
  assert.ok(arch.length > 100, 'the archive pages are there');
  const ctas = arch.filter((f) => fs.readFileSync(join(ROOT, f), 'utf8').includes('dv3-cashbids-cta'));
  assert.ok(ctas.length > 100, 'most carry the cash-bids line');
});
