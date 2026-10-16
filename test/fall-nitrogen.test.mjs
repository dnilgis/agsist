// fall-nitrogen.html: measured soil temperature near 4 in at the station
// nearest a county or ZIP, from data/fall-nitrogen.json
// (scripts/fetch_fall_nitrogen.py, fall-nitrogen workflow). Nothing shows
// until the file exists, a county with no station within 50 miles stays
// blank, the page never says "go", and the reads match hand-worked examples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(root, 'fall-nitrogen.html'), 'utf8');
const dataPath = path.join(root, 'data/fall-nitrogen.json');

function lib() {
  const m = /\/\*falln:start\*\/([\s\S]*?)\/\*falln:end\*\//.exec(page);
  assert.ok(m, 'the page carries the soil view');
  // eslint-disable-next-line no-new-func
  return new Function(m[1] + '\nreturn {fnMiles, fnRead, fnView, fnNearest, fnStates, fnSpark, fnTrend, fnAgeDays};')();
}

const NOW = Date.parse('2026-10-16T18:00:00Z');
const pad = (a) => [...Array(10 - a.length).fill(null), ...a];
// Two stations 30 miles apart in central Iowa and one in Lincoln, Nebraska.
const D = {
  max_miles: 50, max_age_days: 3, updated_utc: '2026-10-16T13:30:00Z',
  state_names: { IA: 'Iowa', NE: 'Nebraska' }, net_labels: { USCRN: 'NOAA Climate Reference Network', ISUSM: 'Iowa State Soil Moisture Network' },
  stations: [
    { id: 'ISUSM:AEEI4', net: 'ISUSM', name: 'Ames, IA', st: 'IA', lat: 42.02, lon: -93.77, depth: '4 in', stat: 'daily mean', last: '2026-10-16', t: pad([52, 51, 50, 49, 48, 47, 46]) },
    { id: 'USCRN:54902', net: 'USCRN', name: 'Des Moines 17 E, IA', st: 'IA', lat: 41.556, lon: -93.285, depth: '10 cm (3.9 in)', stat: 'daily mean', last: '2026-10-16', t: pad([49, 48, 47, 47, 46, 45, 44]) },
    { id: 'USCRN:94996', net: 'USCRN', name: 'Lincoln 11 SW, NE', st: 'NE', lat: 40.69, lon: -96.85, depth: '10 cm (3.9 in)', stat: 'daily mean', last: '2026-10-11', t: pad([60, 58, 57, 56, 55, 54, 53]) },
  ],
  counties: {
    19169: ['Story', 'IA', 42.04, -93.47, 0, 16],
    19153: ['Polk', 'IA', 41.69, -93.57, 1, 16],
    19193: ['Woodbury', 'IA', 42.39, -96.05],
    31109: ['Lancaster', 'NE', 40.78, -96.69, 2, 11],
  },
};

test('head, byline and structured data', () => {
  assert.match(page, /<title>Is it cold enough for fall anhydrous\? Soil temperature by county \| AGSIST<\/title>/);
  assert.match(page, /<link rel="canonical"\s+href="https:\/\/agsist\.com\/fall-nitrogen">/);
  assert.match(page, /<h1>Is it cold enough for fall anhydrous\?<\/h1>/);
  assert.match(page, /Sigurd Lindquist, CCA/);
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page)[1]);
  const types = ld['@graph'].map((g) => g['@type']);
  for (const t of ['WebPage', 'Dataset', 'BreadcrumbList', 'FAQPage']) assert.ok(types.includes(t), t);
  const faq = ld['@graph'].find((g) => g['@type'] === 'FAQPage');
  assert.ok(faq.mainEntity.length >= 5);
  // Every FAQ answer in JSON-LD is also on the page.
  for (const q of faq.mainEntity) assert.ok(page.includes('<summary>' + q.name + '</summary>'), q.name);
});

test('no em dashes on the page or in what the fetcher stamps', () => {
  assert.doesNotMatch(page, /—|&mdash;/);
  const py = fs.readFileSync(path.join(root, 'scripts/fetch_fall_nitrogen.py'), 'utf8').split('\n').filter((l) => !/no em dash/.test(l)).join('\n');
  assert.doesNotMatch(py, /\u2014|&mdash;/);
});

test('honest empty state before the first station read', () => {
  const m = /<!--FALLN:STATIC-->([\s\S]*?)<!--\/FALLN:STATIC-->/.exec(page);
  assert.ok(m, 'static block markers');
  if (!fs.existsSync(dataPath)) {
    assert.match(m[1], /Soil readings load after the first station read/);
    assert.doesNotMatch(m[1], /\d\s*(&deg;|°)/, 'no temperature baked in without data');
  } else {
    assert.match(m[1], /Station readings through/);
  }
  assert.match(page, /<div class="fn-pick" id="fn-pick" hidden>/, 'picker hidden until data loads');
  const { fnView } = lib();
  assert.equal(fnView(null, { fips: '19169' }, NOW), null);
  assert.equal(fnView({ stations: [] }, { fips: '19169' }, NOW), null);
});

test('distance, worked by hand', () => {
  const { fnMiles } = lib();
  // Ames to Des Moines 17 E: 0.464 deg of latitude (32.1 mi) and 0.485 deg of
  // longitude at 41.8 N (0.485 x 69.17 x cos 41.8 = 25.0 mi): about 40.7 mi.
  const d = fnMiles(42.02, -93.77, 41.556, -93.285);
  assert.ok(d > 40 && d < 41.5, String(d));
  assert.ok(Math.abs(fnMiles(40, -96, 41, -96) - 69.1) < 0.2, 'one degree of latitude is about 69 miles');
});

test('reading a week, worked by hand', () => {
  const { fnRead, fnTrend } = lib();
  // 52 51 50 49 48 47 46: latest 46, first of the week 52, change -6; 50 is not below 50, so 4 of 7.
  let r = fnRead(D.stations[0], NOW, 3);
  assert.deepEqual([r.latest, r.change, r.below, r.n, r.state], [46, -6, 4, 7, 'dipping']);
  assert.equal(fnTrend(r.change), 'down 6°F over the last 7 days');
  r = fnRead(D.stations[1], NOW, 3);
  assert.deepEqual([r.latest, r.change, r.below, r.state], [44, -5, 7, 'holding']);
  // Lincoln last reported Oct 11, five days before Oct 16: stale, no status.
  r = fnRead(D.stations[2], NOW, 3);
  assert.equal(r.state, 'stale');
  assert.equal(r.age, 5);
  assert.equal(fnRead({ last: '2026-10-16', t: pad([44, 45, 46, 47, 48, 49, 50]) }, NOW, 3).state, 'warm');
  assert.equal(fnRead({ last: '2026-10-16', t: pad([null, null, null, 45, 44, 43, 42]) }, NOW, 3).state, 'dipping', 'holding needs 5 days');
  assert.equal(fnTrend(0.4), 'about flat over the last 7 days');
});

test('county answer, blank county, stale station and ZIP', () => {
  const { fnView } = lib();
  let v = fnView(D, { fips: '19153' }, NOW);
  assert.equal(v.label, 'Polk County, IA');
  assert.equal(v.head, 'Below 50°F every day this week');
  assert.equal(v.mi, 16);
  assert.match(v.why, /not a forecast/);
  v = fnView(D, { fips: '19193' }, NOW);
  assert.equal(v.blank, true, 'Woodbury has no station within 50 miles');
  v = fnView(D, { fips: '31109' }, NOW);
  assert.equal(v.read.state, 'stale');
  assert.match(v.why, /last reported Oct 11\. This page does not guess/);
  // A ZIP just north of Ames: nearest station is Ames, nearest county Story.
  v = fnView(D, { lat: 42.1, lon: -93.6, label: 'ZIP 50010' }, NOW);
  assert.equal(v.station.name, 'Ames, IA');
  assert.equal(v.label, 'ZIP 50010 (Story County, IA)');
  // A ZIP in western Nebraska: nothing within 50 miles.
  assert.equal(fnView(D, { lat: 41.1, lon: -101.0, label: 'ZIP 69101' }, NOW).blank, true);
});

test('never says go', () => {
  const { fnView } = lib();
  const heads = [];
  for (const f of Object.keys(D.counties)) { const v = fnView(D, { fips: f }, NOW); heads.push(v.head || '', v.why || ''); }
  const all = heads.join(' ') + page.replace(/<script[\s\S]*?<\/script>/g, '');
  assert.doesNotMatch(all, /\b(go ahead|good to go|ok to apply|safe to apply|apply now|start applying)\b/i);
  const m = /\/\*falln:start\*\/([\s\S]*?)\/\*falln:end\*\//.exec(page)[1];
  assert.doesNotMatch(m, /['"]Go\b|\bgo['"]/, 'no "go" verdict string in the view');
});

test('state summary matches the stations', () => {
  const rows = lib().fnStates(D, NOW);
  const ia = rows.find((r) => r.st === 'IA');
  assert.deepEqual([ia.n, ia.holding, ia.warm, ia.lo, ia.hi], [2, 1, 0, 44, 46]);
  const ne = rows.find((r) => r.st === 'NE');
  assert.equal(ne.lo, null, 'a stale station gives no range');
});

test('the fetcher selftest passes and its read() agrees with the page', () => {
  const out = execFileSync('python3', [path.join(root, 'scripts/fetch_fall_nitrogen.py'), '--selftest'], { encoding: 'utf8' });
  assert.match(out, /selftest ok/);
  const vecs = [[52, 51, 50, 49, 48, 47, 46], [49, 48, 47, 47, 46, 45, 44], [44, 45, 46, 47, 48, 49, 50], [null, null, null, 45, 44, 43, 42], [50.4, 49.9, 49.6, 49.8, 49.1, 48.2, 49.9]];
  const py = JSON.parse(execFileSync('python3', ['-c',
    'import sys,json;sys.path.insert(0,sys.argv[1]);import fetch_fall_nitrogen as F;' +
    'print(json.dumps([F.read({"t":[None]*(10-len(v))+v}) for v in json.loads(sys.argv[2])]))',
    path.join(root, 'scripts'), JSON.stringify(vecs)], { encoding: 'utf8' }));
  const { fnRead } = lib();
  vecs.forEach((v, i) => {
    const js = fnRead({ last: '2026-10-16', t: pad(v) }, NOW, 3);
    assert.equal(js.state, py[i].state, 'state ' + i);
    assert.equal(js.below, py[i].below, 'below ' + i);
    assert.equal(js.change, py[i].change, 'change ' + i);
  });
});

test('every guidance link on the page is a saved primary source', () => {
  const src = fs.readFileSync(path.join(root, 'references/sources.json'), 'utf8');
  const links = [...page.matchAll(/href="(https:\/\/(?:www\.extension\.iastate|www\.ifca|www\.mda\.state\.mn|eupdate\.agronomy\.ksu|cropwatch\.unl|water\.unl)[^"]+)"/g)].map((m) => m[1]);
  assert.ok(links.length >= 6);
  for (const u of new Set(links)) assert.ok(src.includes('"' + u + '"'), u);
});

test('the chart draws the 50 F line and every reading', () => {
  const svg = lib().fnSpark(D.stations[0].t, '2026-10-16', 400, 150);
  assert.match(svg, /class="fn-fifty"/);
  assert.equal((svg.match(/<circle/g) || []).length, 7);
  assert.equal((svg.match(/fn-under/g) || []).length, 4);
  assert.match(svg, /Oct 7<\/text>.*Oct 16<\/text>/s);
});

/* ---------------- in the browser ---------------- */
const PW = process.env.PLAYWRIGHT_PATH || '/home/user/node_modules/playwright/index.mjs';
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? 'Playwright or Chromium not found here' : false;

function serve() {
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html' };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!path.extname(p)) p += '.html';
    const f = path.normalize(path.join(root, p));
    if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

test('browser: empty state, county pick, blank county and ZIP', { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const data = JSON.parse(JSON.stringify(D));
    const today = new Date().toISOString().slice(0, 10);
    data.stations.forEach((s, i) => { if (i < 2) s.last = today; });
    async function open(q, withData) {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
      const pg = await ctx.newPage(), errors = [];
      pg.on('pageerror', (e) => errors.push(String(e)));
      await pg.route('**/*', (r) => {
        const u = r.request().url(), h = { 'access-control-allow-origin': '*' };
        if (u.includes('/data/fall-nitrogen.json')) return withData ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }) : r.fulfill({ status: 404, body: '' });
        if (u.includes('/bids/data/zips/')) return r.fulfill({ headers: h, contentType: 'application/json', body: JSON.stringify({ 50010: [42.1, -93.6] }) });
        // the empty case: the page as it ships before any station read (stamp emptied), so a stamped page on disk does not hide the empty state
        if (!withData && /\/fall-nitrogen(\?|$)/.test(u)) return r.fulfill({ contentType: 'text/html', body: page.replace(/(<!--FALLN:STATIC-->)[\s\S]*?(<!--\/FALLN:STATIC-->)/, '$1\n<p class="fn-empty"><b>Soil readings load after the first station read.</b></p>\n$2') });
        if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
        return r.abort();
      });
      await pg.goto(`http://127.0.0.1:${port}/fall-nitrogen${q}`);
      return { pg, ctx, errors };
    }
    let { pg, ctx, errors } = await open('', false);
    await pg.waitForTimeout(400);
    assert.match(await pg.textContent('#fn-live'), /Soil readings load after the first station read/);
    assert.equal(await pg.isVisible('#fn-pick'), false);
    assert.deepEqual(errors, []);
    await ctx.close();

    ({ pg, ctx, errors } = await open('?county=19153', true));
    await pg.waitForSelector('#fn-answer');
    const a = await pg.textContent('#fn-answer');
    assert.match(a, /Polk County, IA/);
    assert.match(a, /Below 50°F every day this week/);
    assert.match(a, /44°F/);
    assert.match(a, /Des Moines 17 E, IA \(NOAA Climate Reference Network\), 16 mi away/);
    assert.match(a, /Iowa State: wait until soil at 4 in is below 50°F/);
    await pg.selectOption('#fn-co', '19193');
    await pg.waitForFunction(() => /No station within 50 miles/.test(document.getElementById('fn-live').textContent));
    await pg.fill('#fn-zip', '50010');
    await pg.click('#fn-zipgo');
    await pg.waitForFunction(() => /ZIP 50010 \(Story County, IA\)/.test(document.getElementById('fn-live').textContent));
    assert.match(await pg.textContent('#fn-answer'), /Ames, IA/);
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
