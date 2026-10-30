// Reserved space, read from the files (Oct 29, 2026; Sig approved). Every element a page's scripts fill or reveal
// after the first paint must have its box held in the HTML or CSS up front: a min-height or height, a set width,
// an aspect-ratio, tabular figures for a counter, or a hold (visibility:hidden under a class set before paint).
// Otherwise it moves the page when it fills, and the browser layout-shift tests only catch that when the timing
// happens to line up (the /milk-prices flakes of Oct 28 and 29).
//
// Pages: the homepage, /milk-prices and every page the cls-* browser tests load. Targets: elements found by id
// (getElementById / querySelector('#id')) that a script then writes: innerHTML, outerHTML, textContent,
// innerText, hidden, value (a select only: its box follows the chosen text, so it needs a set width), classList
// changes, inserting or appending children. Writes to inputs' value are left out (their box does not follow it).
//
// test/cls-reserved.json holds the exceptions:
//   below_fold: elements that start 900px or more down the page at both 390 and 1280 (for one not shown at load,
//               its nearest shown ancestor). The browser test at the end proves each position.
//   to_fix:     known unreserved targets on pages not cleaned up yet. It may only shrink: a new target on any
//               page fails, and an entry that is now reserved (or gone) must be taken out.
//
// It must also flag the three causes fixed on /milk-prices (test/fixtures/cls-reserved/milk-pre164.html, verbatim
// from the page before #164): the area picker's width, the ask put in above the summary, the DMC countdown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const LIST = JSON.parse(fs.readFileSync(join(ROOT, 'test/cls-reserved.json'), 'utf8'));
const FIXTURE = 'test/fixtures/cls-reserved/milk-pre164.html';

/* the pages: the homepage, milk, and every page a cls-* browser test names */
function clsPages() {
  const pages = new Set(['index.html', 'milk-prices.html']);
  for (const f of fs.readdirSync(join(ROOT, 'test')).filter((n) => /cls.*\.test\.mjs$/.test(n) && n !== 'cls-reserved.test.mjs')) {
    const src = fs.readFileSync(join(ROOT, 'test', f), 'utf8');
    for (const m of src.matchAll(/["'`/]([a-z0-9][a-z0-9/_-]*\.html)["'`]/g)) if (!m[1].startsWith('components/') && fs.existsSync(join(ROOT, m[1]))) pages.add(m[1]);
    for (const m of src.matchAll(/["'`]\/([a-z0-9][a-z0-9/_-]*)["'`?]/g)) {
      const p = m[1].replace(/\/$/, '/index') + '.html';
      if (!/^(data|components|fonts|img|css)\//.test(m[1]) && fs.existsSync(join(ROOT, p))) pages.add(p);
    }
  }
  return [...pages].sort();
}

/* ---------- the scan ---------- */
const SOFT = /^(auto|0|0px|100%|fit-content|max-content|min-content|none|initial|inherit|unset)$/;
// the first declaration in `body` that holds a box; need 'width' for a select's chosen text, else any hold
function holds(body, need) {
  for (const d of body.split(';')) {
    const k = d.indexOf(':'); if (k < 0) continue;
    const prop = d.slice(0, k).trim().toLowerCase(), val = d.slice(k + 1).replace(/!important/i, '').trim().toLowerCase();
    if (prop === 'visibility' && val === 'hidden') return prop + ':' + val;
    if (need === 'width') { if (prop === 'width' && !SOFT.test(val)) return prop + ':' + val; continue; }
    if (/^(min-height|height|width|aspect-ratio|contain-intrinsic-size)$/.test(prop) && !SOFT.test(val)) return prop + ':' + val;
    if (prop === 'font-variant-numeric' && /tabular-nums/.test(val)) return prop + ':' + val;
    if (prop === 'contain' && /size/.test(val)) return prop + ':' + val;
  }
  return null;
}
const WRITE = String.raw`\s*\.\s*(?:(?:innerHTML|outerHTML|textContent|innerText|hidden|value)\s*=(?!=)|classList\s*\.\s*(?:add|remove|toggle|replace)\s*\(|(?:insertAdjacentHTML|insertBefore|appendChild|append|prepend|replaceChildren|replaceWith)\s*\(|(?:remove|set)Attribute\(\s*['"]hidden)`;
const GET = String.raw`(?:[\w$]+\.)?(?:getElementById\(\s*['"]([\w:-]+)['"]\s*\)|querySelector\(\s*['"]#([\w-]+)['"]\s*\))`;

export function scan(html, root = ROOT) {
  const clean = (u) => u.replace(/[?#].*$/, '');
  const local = (u) => { if (!u.startsWith('/') || u.startsWith('//')) return null; const p = join(root, clean(u).slice(1)); return fs.existsSync(p) ? p : null; };
  const scripts = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/type=["'](application\/(ld\+)?json|text\/template)/i.test(m[1])) continue;
    const src = /\bsrc=["']([^"']+)["']/.exec(m[1]);
    if (src) { const p = local(src[1]); if (p) scripts.push({ name: clean(src[1]), text: fs.readFileSync(p, 'utf8') }); } else scripts.push({ name: 'inline script', text: m[2] });
  }
  let css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  for (const m of html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)) { const h = /href=["']([^"']+)["']/.exec(m[0]); const p = h && local(h[1]); if (p) css += '\n' + fs.readFileSync(p, 'utf8'); }
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const elem = (id) => {
    const m = new RegExp(`<([a-z0-9-]+)\\b[^>]*\\sid=["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i').exec(html);
    if (!m) return null;
    return { at: m.index, tag: m[1].toLowerCase(), cls: ((/\sclass=["']([^"']*)["']/.exec(m[0]) || [])[1] || '').split(/\s+/).filter(Boolean), style: (/\sstyle=["']([^"']*)["']/.exec(m[0]) || [])[1] || '' };
  };
  const targets = new Map();
  const add = (id, s, how) => {
    const e = elem(id); if (!e) return;
    if (/\.\s*value\s*=$/.test(how) && e.tag !== 'select') return;
    if (!targets.has(id)) targets.set(id, []);
    targets.get(id).push(s.name + ': ' + how.replace(/\s+/g, ' ').slice(0, 60));
  };
  for (const s of scripts) {
    const t = s.text;
    for (const m of t.matchAll(new RegExp(GET + WRITE, 'g'))) add(m[1] || m[2], s, m[0]);
    const assigns = [...t.matchAll(new RegExp(String.raw`([A-Za-z_$][\w$]*)\s*=\s*` + GET, 'g'))].map((m) => ({ v: m[1], id: m[2] || m[3], at: m.index }));
    for (const v of new Set(assigns.map((a) => a.v))) {
      for (const m of t.matchAll(new RegExp(String.raw`(?<![\w$.])` + v.replace(/\$/g, '\\$') + WRITE, 'g'))) {
        const a = assigns.filter((x) => x.v === v && x.at < m.index).pop(); // the nearest assignment before the write
        if (a) add(a.id, s, m[0]);
      }
    }
    // ['a','b'].forEach(function (id) { var el = document.getElementById(id); ... el.textContent = ... })
    for (const m of t.matchAll(/\[((?:\s*['"][\w-]+['"]\s*,?)+)\]\.forEach\(\s*function\s*\(\s*(\w+)\s*\)\s*\{([\s\S]{0,600})/g)) {
      const g = new RegExp(String.raw`([\w$]+)\s*=\s*(?:[\w$]+\.)?getElementById\(\s*` + m[2] + String.raw`\s*\)`).exec(m[3]);
      const w = g && new RegExp(String.raw`(?<![\w$.])` + g[1].replace(/\$/g, '\\$') + WRITE).exec(m[3]);
      if (w) for (const q of m[1].matchAll(/['"]([\w-]+)['"]/g)) add(q[1], s, w[0]);
    }
  }
  const reserved = (id) => {
    const e = elem(id), how = targets.get(id);
    const need = e.tag === 'select' && how.some((h) => /\.\s*value\s*=/.test(h)) ? 'width' : 'box';
    if (holds(e.style, need)) return 'style="' + holds(e.style, need) + '"';
    for (const r of rules) {
      const h = holds(r.body, need); if (!h) continue;
      for (const sel of r.sel.split(',')) {
        // a functional pseudo-class (:has(), :not(), :is()) is part of its compound, not a step to the element:
        // ".grid:has(.a>span)" holds the grid, never a span near .a (Oct 29, 2026: it held #export-mkt-yr by mistake)
        const s = sel.trim().replace(/:[\w-]+\((?:[^()]|\([^()]*\))*\)/g, ''), last = s.split(/\s*[>+~]\s*|\s+/).pop().replace(/::?[\w-]+(\([^)]*\))?/g, '');
        if (!last || (/#[\w-]+/.test(last) && !new RegExp(`#${id}(?![\\w-])`).test(last))) continue;
        const byId = new RegExp(`#${id}(?![\\w-])`).test(last);
        const byCls = e.cls.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(last));
        // a bare tag under a class, e.g. ".dp-area-pick select": only when that class opens just before the element
        const up = s.split(/\s*[>+~]\s*|\s+/).slice(-2, -1)[0] || '', upCls = (/\.([\w-]+)/.exec(up) || [])[1];
        const byTag = s !== last && new RegExp(`^${e.tag}(?![\\w-])`).test(last) && !!upCls &&
          new RegExp(`class=["'][^"']*\\b${upCls}\\b`).test(html.slice(Math.max(0, e.at - 600), e.at));
        if (byId || byCls || byTag) return s + '{' + h + '}';
      }
    }
    return null;
  };
  const out = [];
  for (const [id, how] of targets) out.push({ id, how, reserved: reserved(id) });
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/* ---------- the checks ---------- */
test('it flags the three /milk-prices causes in the page as it was before #164', () => {
  const r = scan(fs.readFileSync(join(ROOT, FIXTURE), 'utf8'));
  const bad = r.filter((x) => !x.reserved).map((x) => x.id);
  for (const id of ['dp-area-sel', 'dp-area-out', 'dp-dmc-words']) assert.ok(bad.includes(id), `#${id} is flagged (${JSON.stringify(r)})`);
  // ...and each is held on the page now
  const now = scan(fs.readFileSync(join(ROOT, 'milk-prices.html'), 'utf8'));
  for (const id of ['dp-area-sel', 'dp-area-out', 'dp-dmc-words']) {
    const x = now.find((t) => t.id === id);
    assert.ok(x && x.reserved, `#${id} is held on /milk-prices now`);
  }
  assert.match(now.find((t) => t.id === 'dp-area-sel').reserved, /width/, 'the picker by its width, not its height');
});

test('the scan reads the ways pages fill things', () => {
  const page = `<style>#a{min-height:3rem}.b-box{aspect-ratio:16/9}.wrap select{width:12em}#n{font-variant-numeric:tabular-nums}
    .hold #h{visibility:hidden}#soft{min-height:auto}.wrap2 select{min-height:44px}</style>
    <div id="a"></div><div id="b" class="b-box"></div><div class="wrap"><select id="s"></select></div><span id="n"></span>
    <div id="h"></div><div id="soft"></div><div id="bare"></div><input id="in"><p>${'filler '.repeat(100)}</p><div class="wrap2"><select id="s2"></select></div>
    <script>var a=document.getElementById('a');a.innerHTML='x';document.getElementById('b').hidden=false;
    var s=document.getElementById('s');s.value='x';['n'].forEach(function(id){var el=document.getElementById(id);if(el)el.textContent='1';});
    var q=document.querySelector('#h');q.classList.add('on');var z=document.getElementById('soft');z.textContent='';
    var bare=document.getElementById('bare');bare.insertAdjacentHTML('beforeend','x');document.getElementById('in').value='3';
    var s2=document.getElementById('s2');s2.value='y';</script>`;
  const r = Object.fromEntries(scan(page).map((x) => [x.id, x.reserved]));
  for (const id of ['a', 'b', 's', 'n', 'h']) assert.ok(r[id], `#${id} held`);
  for (const id of ['soft', 'bare', 's2']) assert.equal(r[id], null, `#${id} not held`);
  assert.ok(!('in' in r), 'an input\'s value is not a layout write');
});

const PAGES = clsPages();

test('every element a script fills or reveals on a CLS-tested page has its space held', () => {
  assert.ok(PAGES.length >= 8, `pages found: ${PAGES.join(', ')}`);
  const problems = [];
  for (const p of PAGES) {
    const below = LIST.below_fold[p] || {}, fix = new Set(LIST.to_fix[p] || []);
    const r = scan(fs.readFileSync(join(ROOT, p), 'utf8')), open = new Set();
    for (const x of r) {
      if (x.reserved) continue;
      open.add(x.id);
      if (!(x.id in below) && !fix.has(x.id)) problems.push(`${p} #${x.id} has no reserved space (${x.how[0]}). Hold its box up front: min-height, a set width, aspect-ratio, tabular-nums for a counter, or a class set before paint.`);
    }
    for (const id of Object.keys(below).concat([...fix])) if (!open.has(id)) problems.push(`${p} #${id} is listed in test/cls-reserved.json but is held now or gone: take it out`);
  }
  for (const p of Object.keys(LIST.below_fold).concat(Object.keys(LIST.to_fix))) if (!PAGES.includes(p)) problems.push(`test/cls-reserved.json lists ${p}, which no CLS test covers`);
  if (process.env.CLS_RESERVED_DUMP) fs.writeFileSync(process.env.CLS_RESERVED_DUMP, JSON.stringify(Object.fromEntries(PAGES.map((p) => [p, scan(fs.readFileSync(join(ROOT, p), 'utf8')).filter((x) => !x.reserved).map((x) => x.id)]))));
  assert.deepEqual(problems, []);
});

test('pages already cleaned up stay clean: nothing to fix on /milk-prices', () => {
  assert.deepEqual(LIST.to_fix['milk-prices.html'] || [], []);
});

/* ---------- the below-the-fold list, proved in a browser ---------- */
const PW = process.env.PLAYWRIGHT_PATH || '/home/user/node_modules/playwright/index.mjs';
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? 'Playwright or Chromium not found here' : false;

test('everything on the below-the-fold list starts 900px or more down, at 390 and 1280', { skip, timeout: 240000 }, async () => {
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html'; else if (!extname(p)) p += '.html';
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const browser = await chromium.launch({ executablePath: CHROME });
  const high = [];
  try {
    for (const [page, ids] of Object.entries(LIST.below_fold)) for (const w of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: 900 } });
      await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname !== '127.0.0.1' ? r.abort() : r.continue()));
      const pg = await ctx.newPage();
      await pg.goto(`http://127.0.0.1:${srv.address().port}/${page.replace(/index\.html$/, '').replace(/\.html$/, '')}`, { waitUntil: 'load' });
      await pg.waitForTimeout(1500);
      const ys = await pg.evaluate((list) => Object.fromEntries(list.map((id) => {
        let e = document.getElementById(id);
        while (e && !e.getClientRects().length) e = e.parentElement; // not shown yet: where it would open
        return [id, e ? Math.round(e.getBoundingClientRect().top + scrollY) : null];
      })), Object.keys(ids));
      for (const [id, y] of Object.entries(ys)) if (y === null || y < 900) high.push(`${page} #${id} at ${y}px (${w} wide)`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
  assert.deepEqual(high, [], 'these are not below the fold: hold their space and take them off the list');
});
