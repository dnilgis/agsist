// Bad rows in the daily bid snapshots (Oct 29 data check, feedbag notes/audits/bids-dq-2026-10-29.md).
// The old Barchart feed stored a 1 to 4 cent basis as 1 to 4 dollars, filed meal as soybeans and posted
// cash 0. The raw snapshots are never rewritten: scripts/bid_flags.py lists the bad rows beside each day,
// the basis ledger (rule set v2) skips them, the snapshot build counts them (never drops), the public
// basis shards leave out the old feed's unit errors, and /cash-bids checks a move against that day's
// futures before it narrates it. Every case below is a real row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const yml = read('.github/workflows/fetch_bids.yml');

function step(name) {
  const i = yml.indexOf(`- name: ${name}`);
  assert.ok(i >= 0, `fetch_bids.yml has the step "${name}"`);
  const rest = yml.slice(i + 1);
  const j = rest.search(/\n      - name: /);
  return j < 0 ? rest : rest.slice(0, j);
}

function selftest(script, must, floor) {
  const r = spawnSync('python3', [script, '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const oks = (r.stdout.match(/^ok {3}/gm) || []).length;
  assert.ok(oks >= floor, `${script}: only ${oks} checks ran`);
  for (const m of must) assert.match(r.stdout, m, `${script} lost a check`);
  return r.stdout;
}

test('bid_flags.py: every reason from a real row, and the clean rows stay clean', () => {
  selftest('scripts/bid_flags.py', [
    /^ok {3}CGB Sherrill corn: 1 cent read as \$1\.00 -> basis_in_cents$/m,
    /^ok {3}ADM Frankfort soybean meal -> meal_as_soybeans$/m,
    /^ok {3}Five Star cash 0 -> cash_out_of_range$/m,
    /^ok {3}Ritzville price in the basis column -> price_in_basis$/m,
    /^ok {3}Frontier Elmwood \$10\.28 wheat on a \$6\.18 contract -> implied_off$/m,
    /^ok {3}a network row 1\.5 cents off its own futures -> identity$/m,
    /^ok {3}a network row equal to its own futures is clean$/m,
    /^ok {3}a real -\$1\.00 wheat basis is not flagged$/m,
    /^ok {3}Ontario wide but consistent basis is not flagged$/m,
    /^ok {3}a wide basis that matches its own quoted futures is not flagged$/m,
    /^ok {3}no reference: a 1\.0 basis is left alone \(unsure, not flagged\)$/m,
    /^ok {3}same rows, same bytes$/m,
    /^ok {3}two places under one id stay two flagged rows in the file$/m,
  ], 20);
});

test('the snapshot build flags, never drops', () => {
  selftest('scripts/bid_snapshots.py', [
    /^ok {3}a flagged row is kept as posted, never dropped or rescaled$/m,
    /^ok {3}the snapshot says how many rows are flagged and why$/m,
  ], 25);
  const py = read('scripts/bid_snapshots.py');
  assert.match(py, /snap\["flags"\] = flag_summary\(snap\)/);
  assert.doesNotMatch(py, /def write_flags/, 'the flags file has one writer, bid_flags.py build');
});

test('basis ledger rule set v2 skips flagged rows, in its own record', () => {
  selftest('scripts/basis_ledger.py', [
    /^ok {3}v2: a flagged row \(cents read as dollars\) is skipped and counted, the clean rows kept$/m,
    /^ok {3}v2 is its own record: new version, own folder, v1 left alone$/m,
  ], 60);
  const py = read('scripts/basis_ledger.py');
  assert.match(py, /"version": "basis-ledger-v2"/);
  assert.match(py, /RECORD = f"\{OUT\}\/v2"/);
  assert.match(py, /flagged = BF\.flagged_keys\(rows\)/, 'parse_snapshot reads the one copy of the rules');
  assert.doesNotMatch(py, /f"\{OUT\}\/\{kind\}/, 'nothing writes into the frozen v1 folders');
  const s = step('Basis forecast ledger to the raw branch');
  assert.match(s, /f="basis-ledger\/v2\/live\/calls\/\$\{day:0:4\}\/\$\{day\}\.json\.gz"/, 'the once-a-day check reads the v2 record');
});

test('the flags step: after the snapshot, before the ledger, once a day, never fails the run', () => {
  const s = step('Bid flags to the raw branch');
  const at = (n) => yml.indexOf(`- name: ${n}`);
  assert.ok(at('Daily bid snapshot to the raw branch') < at('Bid flags to the raw branch'), 'after the snapshot');
  assert.ok(at('Bid flags to the raw branch') < at('Basis forecast ledger to the raw branch'), 'before the ledger');
  assert.match(s, /continue-on-error: true/);
  assert.match(s, /if: github\.event\.inputs\.dry_run != 'true'/);
  assert.match(s, /RAW_SOFT: '1'/);
  assert.match(s, /python3 scripts\/bid_snapshots\.py due/);
  assert.match(s, /have "\$f" && \{ echo "bid flags: \$f is already on raw"; exit 0; \}/, 'one run a day');
  assert.match(s, /have "\$snap" \|\|/, 'waits for the day\'s snapshot on raw');
  assert.match(s, /python3 scripts\/bid_flags\.py build --ref origin\/raw --out-dir \./);
  assert.match(s, /bash scripts\/push_raw\.sh "bid flags \$day" bids-daily-flags \\\n\s+\|\| echo "::warning::/);
  assert.doesNotMatch(s, /cron/);
  assert.match(read('.gitignore'), /^\/bids-daily-flags\/$/m, 'never committed to main');
});

test('basis shards leave out the old feed\'s unit errors, never a live row', () => {
  const out = spawnSync('python3', ['scripts/build_basis_history.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  for (const m of [
    /^ok {3}old-feed unit errors: the -300\/-7 step, the 0\/100 step and the round dollars are dropped$/m,
    /^ok {3}a lone old -100, a live row and a meal row are kept$/m,
    /^ok {3}the step rule: 90 cents or more between a round value of 100\+ and one under 100$/m,
  ]) assert.match(out.stdout, m);
  const py = read('scripts/build_basis_history.py');
  const main = py.slice(py.indexOf('def main():'));
  assert.match(main, /bad = unit_error_rows\(state, a\.out\)[\s\S]*index = write_shards\(state, a\.out, today\)/,
    'the drop runs before the shards are written');
});

// ---- the page: slice the functions out of components/cash-bids.js and run them
function fnSrc(src, name) {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `cash-bids.js has ${name}()`);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}' && --d === 0) break;
  }
  return src.slice(i, j + 1);
}
function page() {
  const src = read('components/cash-bids.js');
  const names = ['ppu', 'plausible', 'basisUnit', 'basisCents', 'futuresOf', 'normSym', 'bhSane', 'bhSetFutures',
    'bhLiveOk', 'bhUnitStep', 'bhOk'];
  const band = /var PPU_BAND=\{[^}]*\};/.exec(src)[0];
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(band + 'var _bhFut={};' + names.map((n) => fnSrc(src, n)).join('\n') +
    ';this.api={bhSetFutures:bhSetFutures,bhOk:bhOk,bhLiveOk:bhLiveOk,bhUnitStep:bhUnitStep};', ctx);
  return { api: ctx.api, src };
}
const row = (o) => Object.assign({ facility: 'X', branch: '', city: 'T', category: 'soybeans', symbol: 'ZSX26' }, o);

test('/cash-bids: a move is narrated only when the bid agrees with that day\'s futures', () => {
  const { api } = page();
  // Four boards on ZSX26 the same day, cash - basis = $10.25 each (one real search, rounded).
  const day = [10.75, 10.70, 10.65, 10.60].map((c, i) => row({ facility: 'B' + i, cashPrice: c, basis: c - 10.25 }));
  api.bhSetFutures(day);
  assert.equal(api.bhOk(day[0], 40, 50), true, 'a 10 cent move on a board that agrees with the others');
  // A bid whose cash minus basis lands inside the soybean band but far from what every other board implies
  // that day: the band alone lets it through, the day's futures do not.
  const off = row({ facility: 'Z', cashPrice: 11.33, basis: 0.50 });           // implies 10.83: 58 cents off
  assert.equal(api.bhLiveOk(off), false, 'cash - basis 58 cents from the day\'s futures: no line');
  const near = row({ facility: 'Y', cashPrice: 10.70, basis: 0.30 });          // implies 10.40: 15 cents off
  assert.equal(api.bhLiveOk(near), true, 'within 25 cents (boards post at different times of the session)');
  api.bhSetFutures(day.slice(0, 2));
  assert.equal(api.bhLiveOk(off), true, 'fewer than 3 elevators: no middle to check, the band decides');
});

test('/cash-bids: the old feed\'s unit error is never narrated as a move', () => {
  const { api, src } = page();
  const day = [10.75, 10.70, 10.65].map((c, i) => row({ facility: 'B' + i, cashPrice: c, basis: c - 10.25 }));
  api.bhSetFutures(day);
  // Consolidated Grain & Barge, Sherrill AR, soybeans Dec26: the record held -300 (3 cents read as dollars).
  assert.equal(api.bhOk(day[0], -300, -7), false, 'from -300 to -7 is the unit error, not a 293 cent move');
  assert.equal(api.bhOk(day[0], 100, -25), false, 'from +100 to -25 (Central Valley Ag, Council Bluffs, Oct 2)');
  assert.equal(api.bhOk(day[0], -100, -95), true, 'a real -$1.00 basis moving 5 cents is narrated');
  // the same rule in both copies (scripts/build_basis_history.py unit_error_step)
  const cases = [[-300, -7], [100, -25], [-100, -95], [-130, -40], [125, 30], [0, 100], [-45, -50], [400, 200], [-250, -150], [100, 30], [-125, -50]];
  const py = spawnSync('python3', ['-c', `import sys,json; sys.path.insert(0,'scripts'); import build_basis_history as H; print(json.dumps([H.unit_error_step(a,b) for a,b in ${JSON.stringify(cases)}]))`],
    { cwd: root, encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  assert.deepEqual(cases.map(([a, b]) => api.bhUnitStep(a, b)), JSON.parse(py.stdout), 'page and shard builder agree');
  // bhLine and the glance strip both go through bhOk, and the futures map is set from the drawn rows
  assert.match(fnSrc(src, 'bhLine'), /!bhLiveOk\(b\)/);
  assert.match(fnSrc(src, 'bhLine'), /!bhOk\(b,from,live\)/);
  assert.match(fnSrc(src, 'applyBasisHistory'), /bhSetFutures\(cbLastBids\|\|currentBids\)/);
  const g = read('components/cb-glance.js');
  const mv = g.slice(g.indexOf('function moveOf('), g.indexOf('function renderMoved('));
  assert.match(mv, /A\.bhOk && !A\.bhOk\(b, before, live\)/);
  assert.match(g, /A\.bhSetFutures\(ctx\.bids \|\| \[\]\)/);
  assert.match(src, /bhOk:bhOk,bhSetFutures:bhSetFutures/, 'handed to cb-glance');
});
