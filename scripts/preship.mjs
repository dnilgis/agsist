#!/usr/bin/env node
/**
 * preship.mjs — the gate that runs whether or not anyone remembers to be careful.
 *
 * WHY THIS EXISTS. Every regression shipped to this site in the last month was
 * found by DRIVING a page under a condition that is not the default, and none
 * of them by reading the diff:
 *
 *   bar(pre, st.pct)        exposed by 404ing price-stats.json
 *   daysUntil noon anchor   exposed by freezing the clock before local noon
 *   the county latch        exposed by a warm localStorage cache
 *   "feeders near a 52-wk low"  exposed by rendering it at all
 *
 * So this does not read anything. It renders the candidate and the baseline
 * side by side under a matrix of failure conditions and fails on anything the
 * candidate does that the baseline did not.
 *
 * EVERYTHING IS RELATIVE TO THE BASELINE. A page that already prints NaN keeps
 * printing NaN without failing the build; a page that starts printing it fails.
 * That is what makes the checks aggressive enough to be useful without
 * drowning in pre-existing noise.
 *
 * USAGE
 *   node scripts/preship.mjs --git-base HEAD~1        compare this checkout to the commit before it
 *   node scripts/preship.mjs --base <dir> --candidate <dir>
 *   node scripts/preship.mjs --base <dir> --candidate <dir> --pages index.html,breakeven.html
 *   node scripts/preship.mjs ... --json report.json     write a machine-readable report
 *   node scripts/preship.mjs ... --quick                skip the 404 matrix (smoke only)
 *
 * Exit 0 = ship it. Exit 1 = do not.
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

/* ───────────────────────────── arguments ───────────────────────────── */

function arg(name, dflt = null) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return (v && !v.startsWith('--')) ? v : true;
}
let BASE = arg('base');
let CAND = arg('candidate');

/* --git-base <ref>: check that ref out to a temp worktree and compare the
   current checkout against it. This is how it runs in CI after an upload --
   HEAD~1 is what main looked like before the files landed, so a bad upload
   goes red within a couple of minutes rather than whenever somebody notices. */
const GITBASE = arg('git-base');
if (GITBASE && GITBASE !== true) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preship-base-'));
  try {
    execFileSync('git', ['worktree', 'add', '--detach', tmp, String(GITBASE)], { stdio: 'pipe' });
  } catch (e) {
    console.error('could not check out ' + GITBASE + ': ' + String(e.stderr || e.message).slice(0, 200));
    process.exit(2);
  }
  BASE = tmp;
  CAND = CAND || process.cwd();
  process.on('exit', () => { try { execFileSync('git', ['worktree', 'remove', '--force', tmp], { stdio: 'pipe' }); } catch {} });
}
const ONLY = arg('pages');
const QUICK = !!arg('quick');
const JSON_OUT = arg('json');
const WAIT = +(arg('wait') || 6500);

if (!BASE || !CAND) {
  console.error('usage: preship.mjs --base <dir> --candidate <dir> [--pages a.html,b.html] [--quick]');
  process.exit(2);
}
for (const d of [BASE, CAND]) {
  if (!fs.existsSync(d)) { console.error('no such directory: ' + d); process.exit(2); }
}

/* Chromium: the sandbox ships one. Fall back to whatever playwright finds. */
const CHROMIUM = [
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
].find(p => { try { return fs.existsSync(p); } catch { return false; } });

/* ─────────────────────────── a static server ───────────────────────── */

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain',
  '.xml': 'application/xml', '.woff2': 'font/woff2' };

function serve(root) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(root, p);
      if (!f.startsWith(path.resolve(root))) { res.writeHead(403).end(); return; }
      fs.readFile(f, (err, buf) => {
        if (err) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/* ──────────────────────── what changed, and where ──────────────────── */

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === '__pycache__') continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, base, out);
    else out.push(path.relative(base, f));
  }
  return out;
}

function changedFiles() {
  if (ONLY && ONLY !== true) return String(ONLY).split(',').map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const rel of walk(CAND)) {
    const a = path.join(BASE, rel), b = path.join(CAND, rel);
    if (!fs.existsSync(a)) { out.push(rel); continue; }
    try {
      if (fs.statSync(a).size !== fs.statSync(b).size) { out.push(rel); continue; }
      if (!fs.readFileSync(a).equals(fs.readFileSync(b))) out.push(rel);
    } catch { out.push(rel); }
  }
  return out;
}

/* ───────────────────── invariants: what must never appear ──────────── */
/* Each is checked against the baseline too. Only NEW occurrences fail, so a
   page that already says "null" somewhere does not block the build, and one
   that starts saying it does. "These are null crop-year dates" shipped
   because nothing looked for this. */
const FORBIDDEN = [
  [/\bNaN\b/, 'NaN'],
  [/\bundefined\b/, 'undefined'],
  [/\[object Object\]/, '[object Object]'],
  [/\bInfinity\b/, 'Infinity'],
  [/\bnull\b/, 'null'],
  [/%40/, '%40 (a percent-encoded @)'],
  [/\bIn­valid Date\b|\bInvalid Date\b/, 'Invalid Date'],
];

/* ──────────────────────────── the scenarios ────────────────────────── */

function scenarios(dataFiles) {
  const s = [{ id: 'normal', width: 1280, height: 900 },
             { id: 'phone', width: 390, height: 844 }];
  if (QUICK) return s;
  /* THE CLOCK. A countdown that is right after lunch and wrong before it is
     the single most repeated defect in this repo's history. */
  for (const t of ['2026-05-31T07:00:00', '2026-06-01T07:00:00', '2027-01-15T23:30:00']) {
    s.push({ id: 'clock ' + t.slice(0, 16), width: 1280, height: 900, clock: t });
  }
  /* EACH DATA FILE, KNOCKED OUT IN TURN. Discovered from what the baseline
     actually fetched, so it stays correct as the page's dependencies change. */
  for (const f of dataFiles) s.push({ id: '404 ' + f, width: 1280, height: 900, kill: f });
  return s;
}

/* ─────────────────────────────── the run ───────────────────────────── */

async function render(browser, port, page, sc) {
  const ctx = await browser.newContext({ viewport: { width: sc.width, height: sc.height } });
  const p = await ctx.newPage();
  const pageErrors = [], consoleErrors = [], dataFiles = new Set();

  p.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 160)));
  p.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
  p.on('request', r => {
    const u = r.url();
    if (u.includes('127.0.0.1') && /\.json(\?|$)/.test(u)) {
      dataFiles.add(new URL(u).pathname);
    }
  });

  /* Third parties are not what we are testing, and they are blocked in CI. */
  for (const glob of ['**/googletagmanager.com/**', '**/fonts.googleapis.com/**',
                      '**/fonts.gstatic.com/**', '**/open-meteo.com/**',
                      '**/nominatim.openstreetmap.org/**', '**/*.tile.openstreetmap.org/**',
                      '**/polymarket.com/**', '**/api.weather.gov/**',
                      '**/mesonet.agron.iastate.edu/**']) {
    await p.route(glob, r => r.abort());
  }
  if (sc.kill) await p.route('**' + sc.kill, r => r.fulfill({ status: 404, body: '' }));
  if (sc.clock) {
    const fixed = new Date(sc.clock).getTime();
    await p.addInitScript(f => {
      const R = Date;
      class D extends R { constructor(...a) { if (a.length === 0) super(f); else super(...a); }
                          static now() { return f; } }
      window.Date = D;
    }, fixed);
  }
  /* geo + a warm cache: the county latch only showed itself with one. */
  await p.addInitScript(() => {
    try { localStorage.setItem('agsist-wx-loc', JSON.stringify({ state: 'TX', county: 'Bee County', city: 'Beeville' })); } catch {}
    window.AGSIST_STATE = { weather: { state: 'TX', county: 'Bee County', city: 'Beeville' } };
    navigator.geolocation = {
      getCurrentPosition: ok => setTimeout(() => ok({ coords: { latitude: 41.6, longitude: -93.6, accuracy: 50 } }), 50),
      watchPosition: () => 0, clearWatch: () => {} };
  });
  await ctx.grantPermissions(['geolocation']).catch(() => {});

  let text = '', hscroll = false;
  try {
    await p.goto(`http://127.0.0.1:${port}/${page}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(WAIT);
    /* Scroll the whole page before capturing. Anything gated on an
       IntersectionObserver does not exist until it is scrolled to, and a
       gate that only ever sees the first screen is not a gate. */
    await p.evaluate(async () => {
      const step = Math.max(200, window.innerHeight - 100);
      for (let y = 0; y < document.body.scrollHeight + step; y += step) {
        window.scrollTo(0, y);
        await new Promise(r => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    await p.waitForTimeout(WAIT);
    const r = await p.evaluate(() => ({
      text: document.body ? document.body.innerText : '',
      sw: document.documentElement.scrollWidth, iw: window.innerWidth,
    }));
    text = r.text; hscroll = r.sw > r.iw + 1;
  } catch (e) {
    pageErrors.push('NAVIGATION: ' + String(e.message).slice(0, 120));
  }
  await ctx.close();
  return { pageErrors, consoleErrors, text, hscroll, dataFiles: [...dataFiles] };
}

/* ─────────────────────── static checks on the files ────────────────── */

function parseChecks(files, findings) {
  for (const rel of files) {
    const f = path.join(CAND, rel);
    if (rel.endsWith('.html')) {
      const html = fs.readFileSync(f, 'utf8');
      const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g;
      let m, i = 0;
      while ((m = re.exec(html))) {
        if (/json/i.test(m[1])) continue;
        const tmp = path.join(os.tmpdir(), `preship_${Date.now()}_${i++}.js`);
        fs.writeFileSync(tmp, m[2]);
        try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
        catch (e) {
          findings.push({ level: 'FAIL', rel, what: 'inline script does not parse',
            detail: String(e.stderr || e.message).split('\n\n')[0].slice(0, 200) });
        } finally { try { fs.unlinkSync(tmp); } catch {} }
      }
    }
    if (rel.endsWith('.py')) {
      try { execFileSync('python3', ['-c', `import ast,io;ast.parse(io.open(${JSON.stringify(f)}).read())`], { stdio: 'pipe' }); }
      catch (e) {
        findings.push({ level: 'FAIL', rel, what: 'python does not parse',
          detail: String(e.stderr || e.message).slice(-200) });
      }
    }
  }
}

/* COUNT THE COPIES. Three defects this month were "fixed in one of the places
   it lives": a mailto address in 3 files, daysUntil in 2. For every function
   or const whose line changed, say how many other files mention it. */
function copyCheck(files, findings) {
  const all = walk(CAND).filter(r => /\.(html|js|mjs|py)$/.test(r));
  for (const rel of files) {
    if (!/\.(html|js|mjs|py)$/.test(rel)) continue;
    const a = fs.existsSync(path.join(BASE, rel)) ? fs.readFileSync(path.join(BASE, rel), 'utf8') : '';
    const b = fs.readFileSync(path.join(CAND, rel), 'utf8');
    const aSet = new Set(a.split('\n'));
    const names = new Set();
    for (const line of b.split('\n')) {
      if (aSet.has(line)) continue;
      for (const m of line.matchAll(/function\s+([A-Za-z_$][\w$]*)|(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=|def\s+([A-Za-z_]\w*)/g)) {
        const n = m[1] || m[2] || m[3];
        if (n && n.length > 3) names.add(n);
      }
    }
    for (const n of names) {
      const elsewhere = all.filter(r => r !== rel && new RegExp('\\b' + n + '\\b').test(fs.readFileSync(path.join(CAND, r), 'utf8')));
      if (elsewhere.length) {
        findings.push({ level: 'NOTE', rel, what: `"${n}" also appears in ${elsewhere.length} other file(s)`,
          detail: elsewhere.slice(0, 4).join(', ') + (elsewhere.length > 4 ? ' …' : '') });
      }
    }
  }
}

/* ──────────────────────────────── main ─────────────────────────────── */

const findings = [];
const changed = changedFiles();
const pages = changed.filter(r => r.endsWith('.html') && !r.includes('/'));

console.log('preship');
console.log('  baseline  ' + BASE);
console.log('  candidate ' + CAND);
console.log('  changed   ' + (changed.length ? changed.join(', ') : '(nothing)'));
if (!changed.length) { console.log('\nNothing to check.'); process.exit(0); }

parseChecks(changed, findings);
copyCheck(changed, findings);

if (!pages.length) {
  console.log('  no top-level pages changed — static checks only');
} else {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const A = await serve(BASE), B = await serve(CAND);

  for (const page of pages) {
    if (!fs.existsSync(path.join(BASE, page))) {
      findings.push({ level: 'NOTE', rel: page, what: 'new page — no baseline to compare against', detail: '' });
      continue;
    }
    /* One baseline render discovers the page's own data dependencies. */
    const probeA = await render(browser, A.port, page, { id: 'probe', width: 1280, height: 900 });
    const probeB = await render(browser, B.port, page, { id: 'probe', width: 1280, height: 900 });
    const deps = [...new Set([...probeA.dataFiles, ...probeB.dataFiles])].sort().slice(0, 14);
    console.log(`\n  ${page} — ${deps.length} data file(s), ${scenarios(deps).length} scenarios`);

    for (const sc of scenarios(deps)) {
      const base = await render(browser, A.port, page, sc);
      const cand = await render(browser, B.port, page, sc);

      const newErrs = cand.pageErrors.filter(e => !base.pageErrors.includes(e));
      if (newErrs.length) {
        findings.push({ level: 'FAIL', rel: page, what: `page error under [${sc.id}] that the baseline does not have`,
          detail: newErrs.join(' | ').slice(0, 220) });
      }
      if (cand.hscroll && !base.hscroll) {
        findings.push({ level: 'FAIL', rel: page, what: `horizontal scroll under [${sc.id}]`, detail: '' });
      }
      for (const [re, label] of FORBIDDEN) {
        if (re.test(cand.text) && !re.test(base.text)) {
          const m = cand.text.match(new RegExp('.{0,48}' + re.source + '.{0,48}'));
          findings.push({ level: 'FAIL', rel: page, what: `renders "${label}" under [${sc.id}] and the baseline does not`,
            detail: (m ? m[0] : '').replace(/\s+/g, ' ').trim().slice(0, 160) });
        }
      }
      /* A page that renders nothing at all is a failure even without an error. */
      if (base.text.length > 400 && cand.text.length < base.text.length * 0.5) {
        findings.push({ level: 'FAIL', rel: page, what: `renders ${cand.text.length} chars under [${sc.id}] against the baseline's ${base.text.length}`,
          detail: 'more than half the page is gone' });
      }
      const newConsole = cand.consoleErrors.filter(e => !base.consoleErrors.includes(e) && !/Failed to load resource/.test(e));
      if (newConsole.length) {
        findings.push({ level: 'WARN', rel: page, what: `new console error under [${sc.id}]`,
          detail: newConsole.join(' | ').slice(0, 200) });
      }
      process.stdout.write('.');
    }
  }
  await browser.close(); A.srv.close(); B.srv.close();
  console.log('');
}

/* ─────────────────────────────── report ────────────────────────────── */

const fails = findings.filter(f => f.level === 'FAIL');
const warns = findings.filter(f => f.level === 'WARN');
const notes = findings.filter(f => f.level === 'NOTE');

/* One message repeated across fifteen scenarios is one finding, not fifteen.
   The first run of this script produced 15 identical WARN lines and buried
   the single FAIL that mattered. */
function collapse(list) {
  const seen = new Map();
  for (const f of list) {
    const key = f.level + '|' + f.rel + '|' + (f.detail || f.what);
    const prev = seen.get(key);
    if (prev) { prev.n = (prev.n || 1) + 1; continue; }
    seen.set(key, { ...f, n: 1 });
  }
  return [...seen.values()].map(f => f.n > 1
    ? { ...f, what: f.what.replace(/ under \[[^\]]+\]/, ` under ${f.n} scenarios`) } : f);
}

console.log('\n' + '='.repeat(72));
for (const group of [collapse(fails), collapse(warns), collapse(notes)]) {
  for (const f of group) {
    console.log(`${f.level.padEnd(5)} ${f.rel}`);
    console.log(`      ${f.what}`);
    if (f.detail) console.log(`      ${f.detail}`);
  }
}
console.log('='.repeat(72));
console.log(`${fails.length} FAIL   ${warns.length} WARN   ${notes.length} NOTE`);

if (JSON_OUT && JSON_OUT !== true) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, candidate: CAND, changed, findings }, null, 2));
  console.log('report: ' + JSON_OUT);
}

if (fails.length) {
  console.log('\nDO NOT SHIP. Each FAIL is something the candidate does that main does not.');
  process.exit(1);
}
console.log('\nNothing the baseline did not already do. Ship it.');
process.exit(0);
