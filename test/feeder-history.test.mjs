// Feeder index history (Nov 2): past weeks of the AGSIST USDA feeder steer index
// from archived copies of the same USDA AMS barn reports. The numbers come from
// scripts/build_feeder_index.py (build_history, its --selftest holds the merge
// rules); this file checks that an archived report reads through the barn
// reader unchanged, and that the probe keeps its manners.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = 'test/fixtures/cattle-auction';

function readArchived(file, barn) {
  const py = [
    'import json, sys',
    'sys.path.insert(0, "scripts")',
    'import fetch_cattle_auction as F',
    'src = next(b for b in F.load_sources(F.ROOT)["barns"] if b["id"] == sys.argv[2])',
    'p, why = F.parse_report(open(sys.argv[1], encoding="utf-8").read())',
    'out = {"why": why}',
    'if p:',
    '    s = F.summarize(p)',
    '    out.update(date=p["date"], receipts=p["receipts"], title_ok=F.title_ok(src, p["title"]),',
    '               tables={k: len(v) for k, v in p["tables"].items()}, classes=s["classes"])',
    'print(json.dumps(out))',
  ].join('\n');
  return JSON.parse(execFileSync('python3', ['-c', py, file, barn], { cwd: root, encoding: 'utf8' }));
}

test('an archived USDA report (Valentine NE, Jan 9 2025) reads through the barn reader', () => {
  const r = readArchived(`${FIX}/ams_1856-archive-2025-01-pypdf.txt`, 'valentine-ne');
  assert.equal(r.why, null);
  assert.equal(r.date, '2025-01-09');
  assert.equal(r.receipts, 4445);
  assert.equal(r.title_ok, true);
  assert.ok(r.tables['steers|1'] >= 10, JSON.stringify(r.tables));
  const s7 = r.classes['steers|1'] && r.classes['steers|1']['700'];
  assert.ok(s7 && s7.head > 0 && s7.cwt > 200 && s7.cwt < 400, JSON.stringify(s7));
});

test('an archived USDA report (Joplin MO, Jan 6 2025) reads through the barn reader', () => {
  const r = readArchived(`${FIX}/ams_1245-archive-2025-01-pypdf.txt`, 'joplin-mo');
  assert.equal(r.why, null);
  assert.equal(r.date, '2025-01-06');
  assert.equal(r.receipts, 1847);
  assert.equal(r.title_ok, true);
});

test('an archived report is never read as another barn', () => {
  const r = readArchived(`${FIX}/ams_1856-archive-2025-01-pypdf.txt`, 'joplin-mo');
  assert.equal(r.title_ok, false);
});

test('the probe and the history builder pass their selftests', () => {
  const a = execFileSync('python3', ['scripts/probe_feeder_archive.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.match(a, /probe_feeder_archive selftest: 0 failure\(s\)/);
  const b = execFileSync('python3', ['scripts/build_feeder_index.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.match(b, /ok {3}history: a re-run changes nothing/);
  assert.match(b, /FAILS=0/);
});

test('the probe reads robots.txt, keeps a gap between requests and never prints the MARS key', () => {
  const s = fs.readFileSync(path.join(root, 'scripts/probe_feeder_archive.py'), 'utf8');
  assert.match(s, /robots\.allowed\(url\)/);
  assert.match(s, /Fetcher\(min_gap=1\.5/);
  assert.doesNotMatch(s, /log\([^)]*MARS_API_KEY/);
  assert.match(s, /"mars_key_present": bool\(mars_auth\(\)\)/);
});

// ---------- the page: past weeks join the record only when the fold opens ----------
const comp = fs.readFileSync(path.join(root, 'components/feeder-index.js'), 'utf8');
const V = new Function(/\/\*feeder:start\*\/([\s\S]*?)\/\*feeder:end\*\//.exec(comp)[1] + '\nreturn {indexView};')();

function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
function monday(ms) { const d = new Date(ms); const k = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - k); }
const DAY = 864e5;
function liveDoc(nowMs) {
  const m2 = monday(nowMs) - 7 * DAY, m1 = m2 - 7 * DAY;
  const wk = (m, p, extra) => Object.assign({ start: iso(m), end: iso(m + 6 * DAY), p, barns: 60, head: 10000, states: 15, avg_wt: 800,
    top: [['OK', 30]], final: false, lo: p - 3, hi: p + 3, both: 0, chg: null, chg_why: 'first week of the record' }, extra || {});
  return {
    index: { name: 'AGSIST USDA feeder steer index', label: 'AGSIST USDA feeder steer index, not the CME index',
      gates: { barns: 30, head: 4000, states: 8, max_state_pct: 50 }, draws: 1000, final_days: 10, start: iso(m1),
      latest: iso(m2), last_ok: iso(m2), weeks: [wk(m1, 340), wk(m2, 345, { both: 50, chg: 5, chg_lo: 1, chg_hi: 9, move: 'up' })] },
  };
}
function histDoc(nowMs) {
  const m1 = monday(nowMs) - 14 * DAY;
  const a = (k, p, extra) => Object.assign({ start: iso(m1 - k * 7 * DAY), end: iso(m1 - k * 7 * DAY + 6 * DAY), p, barns: p ? 35 : 6,
    head: p ? 5000 : 700, states: p ? 9 : 3, avg_wt: 790, top: [], final: true, from: 'archive', read: '2026-11-02',
    lo: p ? p - 4 : undefined, hi: p ? p + 4 : undefined, why: p ? undefined : ['6 barns, 30 needed'], both: 0, chg: null, chg_why: 'x' }, extra || {});
  // the week at the live start is in the archive file too: the live week must win
  return { v: 1, read: '2026-11-02', start: iso(m1 - 3 * 7 * DAY), weeks: [a(3, 300), a(2, null), a(1, 310), a(0, 999, { start: iso(m1), end: iso(m1 + 6 * DAY) })] };
}

test('index view: archived weeks come first, a live week is never replaced, the method says where the record starts', () => {
  const now = Date.now();
  const live = liveDoc(now), hist = histDoc(now);
  const plain = V.indexView(live, now);
  assert.equal(plain.archive, null);
  assert.equal(plain.series.length, 2);
  const v = V.indexView(live, now, hist);
  assert.equal(v.series.length, 5, 'three archived weeks plus two live weeks');
  assert.deepEqual(v.series.map((x) => x.p), [300, null, 310, 340, 345], 'withheld archived week is a gap; live week kept');
  assert.equal(new Set(v.series.map((x) => x.start)).size, 5, 'no week twice');
  assert.equal(v.archive.ok, 2);
  assert.equal(v.archive.weeks, 3);
  assert.equal(v.rows.filter((r) => r.arch).length, 3);
  assert.notEqual(v.since, v.liveSince);
  assert.equal(V.indexView(live, now, { weeks: [{ start: '2020-01-06', p: 1 }] }).archive, null, 'a week not marked as archive is not used');
});

const PW = process.env.PLAYWRIGHT_PATH || '/home/user/node_modules/playwright/index.mjs';
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? 'Playwright or Chromium not found here' : false;

async function openPage(histStatus) {
  const { createServer } = await import('node:http');
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!path.extname(p)) p += '.html';
    const f = path.normalize(path.join(root, p));
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    const t = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html' }[path.extname(f)];
    res.writeHead(200, { 'content-type': t || 'application/octet-stream' }); res.end(fs.readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const browser = await chromium.launch({ executablePath: CHROME });
  // the site's service worker would answer the later fetches itself, past page.route
  const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage();
  const asked = [];
  const now = Date.now();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.route('**/data/feeder-index.json*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(liveDoc(now)) }));
  await page.route('**/data/feeder-index-history.json*', (r) => { asked.push(r.request().url());
    return histStatus === 200 ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(histDoc(now)) }) : r.fulfill({ status: histStatus, body: '' }); });
  await page.goto(`http://127.0.0.1:${srv.address().port}/cattle-auction-prices`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#feeder-index:not([hidden]) details', { timeout: 15000 });
  return { srv, browser, page, asked };
}

test('page: the history file loads only when the fold opens, and the record then reaches back', { skip }, async () => {
  const { srv, browser, page, asked } = await openPage(200);
  try {
    await page.waitForTimeout(400);
    assert.equal(asked.length, 0, 'not loaded with the page');
    await page.click('#feeder-index details summary');
    await page.waitForSelector('#feeder-index details[data-hist="loaded"]');
    await page.waitForFunction(() => /Internet Archive/.test(document.querySelector('#feeder-index details').textContent));
    assert.equal(asked.length, 1);
    const t = await page.textContent('#feeder-index details');
    assert.match(t, /From archived USDA reports/);
    assert.match(t, /2 of 3 have a figure/);
    assert.equal(await page.$eval('#feeder-index details', (d) => d.open), true, 'the fold stays open');
    assert.equal(await page.$$eval('#feeder-index details tbody tr', (r) => r.length), 5);
    await page.click('#feeder-index details summary');
    await page.click('#feeder-index details summary');
    assert.equal(asked.length, 1, 'asked once');
  } finally { await browser.close(); srv.close(); }
});

test('page: a missing history file leaves the live record as it was', { skip }, async () => {
  const { srv, browser, page } = await openPage(404);
  try {
    await page.click('#feeder-index details summary');
    await page.waitForSelector('#feeder-index details[data-hist="failed"]');
    const t = await page.textContent('#feeder-index details');
    assert.match(t, /Our record starts the week of/);
    assert.equal(await page.$$eval('#feeder-index details tbody tr', (r) => r.length), 2);
  } finally { await browser.close(); srv.close(); }
});

test('feeder-history.yml is dispatch only, dry run by default, and commits only the history file', () => {
  const y = fs.readFileSync(path.join(root, '.github/workflows/feeder-history.yml'), 'utf8');
  const on = y.slice(y.indexOf('\non:'), y.indexOf('\npermissions:'));
  assert.match(on, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(y, /schedule:|cron:|workflow_run:|\bpush:|pull_request:|repository_dispatch:/);
  assert.match(on, /dry_run:[\s\S]*?default: true/);
  assert.match(y, /if: \$\{\{ !inputs\.dry_run \}\}/);
  assert.match(y, /F=data\/feeder-index-history\.json/);
  assert.doesNotMatch(y.slice(y.indexOf('Commit if changed')), /git add (?!"\$F")/);
  assert.match(y, /pip install pypdf==6\.20\.1/, 'the barn job\'s PDF reader');
});
