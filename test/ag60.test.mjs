// Ag in 60 (scripts/ag60, .github/workflows/ag60.yml; Sig, Oct 21 2026):
// the script builder, the scene clock and the workflow's shape.
// - every number on screen or in the voice is read from a data file, matches it,
//   and carries its date; a number without a date is left out
// - the script is 150 to 170 spoken words, plain, no em dashes, no AI vendor names
// - 12 to 20 scenes laid end to end, captions inside their line, about 60 seconds
// - the voice says prices the way farm radio does and the captions keep them exact
// - the workflow is dispatch only, has the Engine checkout after its checkout, and
//   uploads only when asked and the secrets are there
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root, 'test/fixtures/ag60');
const BUILD = path.join(root, 'scripts/ag60/build_plan.py');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ag60-'));

function build(dataRoot, extra = []) {
  const out = tmp();
  execFileSync('python3', [BUILD, '--root', dataRoot, '--out', out, ...extra], { encoding: 'utf8' });
  return { out, plan: JSON.parse(fs.readFileSync(path.join(out, 'plan.json'), 'utf8')) };
}

// a copy of the fixture data, changed by fn(data dir)
function variant(fn) {
  const d = tmp();
  fs.cpSync(FIX, d, { recursive: true });
  fn(path.join(d, 'data'));
  return d;
}
const readJ = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJ = (f, o) => fs.writeFileSync(f, JSON.stringify(o));

// follow a fact's src ("daily.json:locked_prices.corn-dec") into the data
function resolve(dataDir, src) {
  const [file, p] = src.split(':');
  const files = { 'daily.json': 'daily.json', 'basis-states.json': 'basis-states.json', 'storm-days.json': 'hail/storm-days.json',
    'crop-progress.json': 'crop-progress.json', 'analyst-estimates.json': 'analyst-estimates.json', 'prices.json': 'prices.json' };
  let o = readJ(path.join(dataDir, files[file]));
  for (const part of p.match(/[^.[\]]+|\[[^\]]+\]/g)) {
    if (part.startsWith('[')) {
      const key = part.slice(1, -1);
      o = o.find((x) => x.id === key || x.crop === key || x.d === key || x.date === key);
      if (file === 'analyst-estimates.json' && o && o.metrics) o = Object.fromEntries(o.metrics.map((m) => [m.key, m]));
    } else o = o?.[part];
  }
  return o;
}

function checkFacts(plan, dataDir) {
  const bad = [];
  const daily = readJ(path.join(dataDir, 'daily.json'));
  for (const f of plan.facts) {
    if (!f.asof || !/\d/.test(f.asof)) bad.push(`${f.label}: no date`);
    let want = resolve(dataDir, f.src);
    if (/locked_changes\.[^.]+\.prev$/.test(f.src)) {            // a change: today's price minus the prior one
      const key = f.src.split('.')[1];
      want = Math.round((daily.locked_prices[key] - want) * 1e4) / 1e4;
    }
    if (want === undefined || want === null) { bad.push(`${f.label}: ${f.src} not in the data`); continue; }
    if (typeof want === 'number') {
      if (Math.abs(want - f.value) > 1e-6) bad.push(`${f.label}: shows ${f.value}, data has ${want}`);
    } else if (String(want).indexOf(String(f.value)) < 0) bad.push(`${f.label}: shows ${f.value}, data has ${want}`);
  }
  return bad;
}

function checkPlan(plan, { words = true } = {}) {
  const bad = [];
  if (words && (plan.words < 150 || plan.words > 170)) bad.push(`script is ${plan.words} words`);
  const all = plan.script + JSON.stringify(plan.captions) + JSON.stringify(plan.meta) + JSON.stringify(plan.scenes);
  if (/—/.test(all)) bad.push('em dash');
  if (/anthropic|claude|openai|chatgpt|gpt-|gemini|kokoro|elevenlabs/i.test(plan.script + JSON.stringify(plan.meta))) bad.push('names an AI vendor or model');
  if (plan.scenes.length < 12 || plan.scenes.length > 20) bad.push(`${plan.scenes.length} scenes`);
  for (const s of plan.scenes) if (s.kind !== 'end' && !(s.asof && /\d/.test(s.asof))) bad.push(`scene ${s.kind} has no date`);
  return bad;
}

test('the voice says prices like farm radio and the captions keep them exact', () => {
  const py = `
import sys, json; sys.path.insert(0, ${JSON.stringify(path.join(root, 'scripts/ag60'))})
import speak
cases = ["Corn, $4.67¾, up ¾¢.", "$227.50", "$12.57½", "$100.71", "$8 billion", "2.8%", "1,464", "Thursday, Oct 22, 7:30 a.m. CT", "Class III milk", "Dec '26", "10¾¢"]
print(json.dumps({c: [speak.tokens(c), speak.spoken(c), speak.word_count(c)] for c in cases}))`;
  const r = JSON.parse(execFileSync('python3', ['-c', py], { encoding: 'utf8' }));
  assert.equal(r['Corn, $4.67¾, up ¾¢.'][1], 'Corn, four sixty-seven and three quarters, up three quarters of a cent.');
  assert.deepEqual(r['Corn, $4.67¾, up ¾¢.'][0].map((t) => t[0]), ['Corn,', '$4.67¾,', 'up', '¾¢.']);
  assert.equal(r['$227.50'][1], 'two twenty-seven fifty');
  assert.equal(r['$12.57½'][1], 'twelve fifty-seven and a half');
  assert.equal(r['$100.71'][1], 'one hundred dollars and seventy-one cents');
  assert.equal(r['$8 billion'][1], 'eight billion dollars');
  assert.equal(r['2.8%'][1], 'two point eight percent');
  assert.equal(r['1,464'][1], 'fourteen hundred sixty-four');
  assert.equal(r['Thursday, Oct 22, 7:30 a.m. CT'][1], 'Thursday, October twenty-second, seven thirty a m Central');
  assert.equal(r['Class III milk'][1], 'Class three milk');
  assert.equal(r["Dec '26"][1], 'December');
  assert.equal(r['10¾¢'][1], 'ten and three quarters cents');
});

test('a normal morning: 150 to 170 words, every number from the data with its date', () => {
  const { plan, out } = build(FIX);
  assert.equal(plan.mode, 'daily');
  assert.deepEqual(checkPlan(plan), []);
  assert.deepEqual(checkFacts(plan, path.join(FIX, 'data')), []);
  // the rundown: hook first, the board, why, cash bids, the crop, the calendar, watch, the close
  const ids = plan.beats.map((b) => b.id);
  assert.equal(ids[0], 'hook');
  assert.equal(ids.at(-1), 'close');
  for (const want of ['board-corn-dec', 'board-beans-nov', 'board-cattle', 'why', 'cash', 'watch']) assert.ok(ids.includes(want), `no ${want}`);
  assert.ok(ids.includes('crop') || ids.includes('storm'), 'no weather or crop moment');
  assert.ok(plan.scenes.some((s) => s.kind === 'map'), 'the basis map is in');
  assert.ok(plan.scenes.some((s) => s.kind === 'rainprint'), 'the Rain Print beat closes');
  assert.equal(plan.scenes.at(-1).kind, 'end');
  // numbers in the script match the Daily's locked prices
  assert.match(plan.script, /Overnight, corn, \$4\.67¾, up ¾¢\./);
  assert.match(plan.script, /Live cattle settled Monday at \$227\.50, down 5¢\./);
  // side files for the upload
  for (const f of ['script.txt', 'captions.srt', 'metadata.json']) assert.ok(fs.existsSync(path.join(out, f)), f);
  const meta = readJ(path.join(out, 'metadata.json'));
  assert.ok(meta.title.length <= 100);
  assert.match(meta.description, /computer voice/);
  assert.match(meta.description, /AI software drafts/);           // the Daily's disclosure travels with it
  assert.match(meta.description, /https:\/\/agsist\.com\/daily\/2026-10-20/);
});

test('a price without a date is left out, never shown undated', () => {
  const d = variant((dd) => { const j = readJ(path.join(dd, 'daily.json')); delete j.locked_changes['beans-nov'].date; writeJ(path.join(dd, 'daily.json'), j); });
  const { plan } = build(d);
  assert.ok(!plan.beats.some((b) => b.id === 'board-beans-nov'));
  assert.ok(!plan.script.includes('$12.57½'));
  assert.deepEqual(checkPlan(plan, { words: false }), []);
});

test('a storm day brings the hail map; a quiet one shows the harvest pace', () => {
  const storm = build(FIX, ['--date', '2026-10-14']).plan;    // Oct 13: 28 reports, most in Texas and Kansas
  assert.ok(storm.beats.some((b) => b.id === 'storm'));
  assert.ok(storm.scenes.some((s) => s.kind === 'hail' && s.points.length >= 10));
  assert.match(storm.script, /28 hail reports, most in Texas and Kansas, up to 2\.75 inch/);
  assert.deepEqual(checkPlan(storm), []);
  assert.deepEqual(checkFacts(storm, path.join(FIX, 'data')), []);
  const quiet = build(FIX).plan;                               // Oct 19: 2 reports in AZ and NM, not farm country
  assert.ok(!quiet.beats.some((b) => b.id === 'storm'));
  assert.match(quiet.script, /Harvest: corn is 44% done, behind the 52% average\./);
});

test('report day after the release: the whole video is the report, numbers against the trade', () => {
  const { plan } = build(FIX, ['--date', '2026-10-09']);
  assert.equal(plan.mode, 'report');
  assert.deepEqual(checkPlan(plan), []);
  assert.deepEqual(checkFacts(plan, path.join(FIX, 'data')), []);
  assert.match(plan.beats[0].text, /^October WASDE: corn ending stocks, 1\.849 billion bushels\. The trade expected 1\.677\./);
  // prices.json in the fixture is from Oct 20, so there is no reaction to show: it says so
  assert.match(plan.script, /Market reaction is not in yet\./);
});

test('report day before the release says "not out yet"', () => {
  const d = variant((dd) => {
    const a = readJ(path.join(dd, 'analyst-estimates.json'));
    for (const m of a.reports[0].metrics) m.actual = null;
    writeJ(path.join(dd, 'analyst-estimates.json'), a);
  });
  const { plan } = build(d, ['--date', '2026-10-09']);
  assert.equal(plan.mode, 'daily');
  assert.match(plan.script, /October WASDE is out today at 11:00 a\.m\. CT\. Numbers not out yet\./);
});

test('scene clock: end to end from 0, captions inside their line, about 60 seconds', () => {
  for (const extra of [[], ['--date', '2026-10-14'], ['--date', '2026-10-09']]) {
    const { plan } = build(FIX, extra);
    let t = 0;
    for (const s of plan.scenes) {
      assert.ok(Math.abs(s.start - t) < 0.01, `${s.kind} starts at ${s.start}, expected ${t}`);
      assert.ok(s.dur >= 1.0, `${s.kind} lasts ${s.dur} s`);
      t = s.start + s.dur;
    }
    assert.ok(Math.abs(t - plan.total) < 0.01);
    assert.ok(plan.total <= 60.0 && plan.total >= 40, `total ${plan.total}`);
    for (const b of plan.beats) {
      const caps = plan.captions.filter((c) => c.start >= b.voice_start - 1e-3 && c.end <= b.voice_start + b.voice_dur + 1e-3);
      assert.ok(caps.length, `${b.id} has no captions`);
    }
    for (let i = 1; i < plan.captions.length; i++) assert.ok(plan.captions[i].start >= plan.captions[i - 1].end - 1e-3);
    const said = plan.captions.map((c) => c.text).join(' ');
    assert.equal(said, plan.script, 'captions are the script, word for word');
  }
  // real voice durations re-time the same plan (voice.py): scenes follow the voice
  const py = `
import sys, json, types; sys.path.insert(0, ${JSON.stringify(path.join(root, 'scripts/ag60'))})
import build_plan
plan = build_plan.build(${JSON.stringify(FIX)})
durs = {b["id"]: b["words"] / 3.1 for b in plan["beats"]}
scenes, caps, total = build_plan.time_plan(types.SimpleNamespace(beats=plan["beats"]), durs)
print(json.dumps({"total": total, "n": len(scenes), "end": scenes[-1]["start"] + scenes[-1]["dur"], "last_cap": caps[-1]["end"]}))`;
  const r = JSON.parse(execFileSync('python3', ['-c', py], { encoding: 'utf8' }));
  assert.ok(Math.abs(r.end - r.total) < 0.01);
  assert.ok(r.last_cap <= r.total - 1.9, 'the end card has no captions over it');
});

test('the live data builds a plan that keeps every rule it can (dates, sources, length cap)', () => {
  if (!fs.existsSync(path.join(root, 'data/daily.json'))) return;
  const { plan } = build(root);
  assert.ok(plan.words <= 170, `${plan.words} words`);
  assert.deepEqual(checkPlan(plan, { words: false }).filter((x) => !/scenes$/.test(x)), []);
  assert.deepEqual(checkFacts(plan, path.join(root, 'data')), []);
});

test('the workflow: dispatch only, engine after checkout, upload behind its secrets', () => {
  const y = fs.readFileSync(path.join(root, '.github/workflows/ag60.yml'), 'utf8');
  const code = y.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.match(code, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(code, /^\s+schedule:|cron:|^\s+push:|workflow_run:/m, 'no schedule until Sig OKs one');
  const steps = code.split(/\n(?=      - )/);
  const co = steps.findIndex((s) => /uses: actions\/checkout@/.test(s));
  const eng = steps.findIndex((s) => /uses: \.\/\.github\/actions\/engine/.test(s));
  assert.equal(eng, co + 1, 'Engine checkout right after the checkout');
  const cond = (s) => (s.match(/^\s+(?:- )?if:\s*(.+)$/m) || [])[1] || '';
  assert.equal(cond(steps[co]), cond(steps[eng]), 'same if: as the checkout');
  const firstCode = steps.findIndex((s) => /scripts\/|test\/|node --test/.test((s.match(/run: [\s\S]*/) || [''])[0]));
  assert.ok(firstCode > eng, 'no code runs before the engine is in place');
  const up = steps.find((s) => /scripts\/ag60\/upload\.py/.test(s));
  assert.match(cond(up), /inputs\.upload/);
  assert.match(cond(up), /HAVE_YT == 'true'/);
  for (const k of ['YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_REFRESH_TOKEN']) {
    assert.ok(up.includes(`${k}: \${{ secrets.${k} }}`), `${k} only in the upload step's env`);
    // elsewhere only as the yes/no HAVE_YT check, never as a value
    const others = steps.filter((s) => s !== up).flatMap((s) => s.split('\n')).filter((l) => l.includes(`secrets.${k}`) && !/^\s+HAVE_YT: \$\{\{[^}]*!= ''/.test(l));
    assert.deepEqual(others, [], `${k} appears outside the upload step`);
  }
  assert.match(code, /actions\/upload-artifact@v4[\s\S]*ag60\.mp4[\s\S]*captions\.srt/);
  assert.match(code, /sha256sum -c/, 'the voice model is checked against its hash');
  assert.doesNotMatch(y, /—/);
  // inputs reach the shell through env only
  for (const s of steps) {
    const run = (s.match(/run: [\s\S]*/) || [''])[0];
    assert.doesNotMatch(run, /\$\{\{\s*inputs\./, 'an input inline in a run script');
  }
});

test('upload: the request carries the title, description and label; no secrets means a clean skip', () => {
  const { out } = build(FIX);
  const UP = path.join(root, 'scripts/ag60/upload.py');
  const body = JSON.parse(execFileSync('python3', [UP, '--out', out, '--dry-run'], { encoding: 'utf8' }));
  assert.equal(body.status.privacyStatus, 'private');
  assert.equal(body.status.selfDeclaredMadeForKids, false);
  assert.equal(body.status.containsSyntheticMedia, true);
  assert.match(body.snippet.title, /^Ag in 60, Oct 20: /);
  const env = { ...process.env }; delete env.YT_CLIENT_ID; delete env.YT_CLIENT_SECRET; delete env.YT_REFRESH_TOKEN;
  const said = execFileSync('python3', [UP, '--out', out], { encoding: 'utf8', env });
  assert.match(said, /upload: skipped, no YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN/);
});
