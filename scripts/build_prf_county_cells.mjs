/* scripts/build_prf_county_cells.mjs
 *
 * Which county is a point in? Written once per grid set, as data/prf/c/.
 *
 * WHY. A PRF grid is a quarter-degree square and most of them (see the
 * printed count) lie across two or more counties. The county decides the
 * county base value and the interval limits, so the same policy in the same
 * grid can cost several times more in one county than the next. A ZIP comes
 * with a county name from the place lookup; a latitude and longitude, or the
 * phone's location, does not. /prf used to take the first county listed and
 * price it. This file is what lets it say which county the point is in, or
 * say that it cannot tell.
 *
 * WHAT IT WRITES. One file per shard of grids (same keys as data/prf/g/):
 *   data/prf/c/<row>_<blk>.json = { n: 24, src: "...", g: { "<grid id>": { c: ["55005", ...], m: "a213?24b339" } } }
 * Each grid is cut into n x n cells, row 0 at the SOUTH edge, column 0 at the
 * WEST edge, cell index = row * n + col. m is the cells run-length encoded:
 * a letter is an index into c (a = c[0]), "?" is "not sure, ask the reader",
 * "-" is "no county here" (water, Canada, Mexico), each followed by a count.
 *
 * HOW A CELL IS DECIDED. The county at its four corners and its centre, from
 * the Census Bureau's cartographic county boundaries (2017 edition, as packed
 * in us-atlas 3.0.1, counties-10m). A cell is a county only when all five
 * agree AND every one of the eight cells around it, including cells over the
 * grid's edge, says the same county. Everything else is "?". So a county line
 * drawn a little wrong in a simplified boundary file costs a question, never
 * a wrong county. That buffer is one cell: about 0.7 mile north to south.
 *
 * It is geography only. It does not know which counties USDA offers PRF in;
 * the page checks the county it gets against the grid's own list.
 *
 * RUN (boundaries do not change; re-run only when data/prf/g gains grids):
 *   mkdir -p /tmp/cc && cd /tmp/cc && npm init -y && npm i us-atlas@3.0.1 topojson-client@3.1.0
 *   node <repo>/scripts/build_prf_county_cells.mjs <repo> /tmp/cc/node_modules
 *   node <repo>/scripts/build_prf_county_cells.mjs --selftest <repo> /tmp/cc/node_modules
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const SELFTEST = args[0] === '--selftest';
if (SELFTEST) args.shift();
const REPO = path.resolve(args[0] || '.');
const MODS = path.resolve(args[1] || 'node_modules');
const require = createRequire(path.join(MODS, 'x.js'));
const topo = require('us-atlas/counties-10m.json');
const { feature } = require('topojson-client');
const M = require(path.join(REPO, 'components/prf-math.js'));

const NCELL = 24;
const SRC = 'US Census Bureau cartographic county boundaries, 2017 edition (us-atlas 3.0.1, counties-10m)';

/* ---- counties as rings with boxes ---- */
const counties = feature(topo, topo.objects.counties).features.map((f) => {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let w = 180, e = -180, s = 90, n = -90;
  polys.forEach((p) => p[0].forEach(([x, y]) => { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }));
  return { fips: String(f.id).padStart(5, '0'), polys, w, e, s, n };
}).filter((c) => c.e > -130 && c.w < -60 && c.n > 23 && c.s < 51);

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inCounty(x, y, c) {
  if (x < c.w || x > c.e || y < c.s || y > c.n) return false;
  for (const p of c.polys) {
    let inside = false;
    for (const ring of p) if (inRing(x, y, ring)) inside = !inside;   /* even-odd: a hole flips it back */
    if (inside) return true;
  }
  return false;
}
/* one-degree buckets so a grid looks at a handful of counties, not 3,100 */
const bucket = new Map();
counties.forEach((c, k) => {
  for (let la = Math.floor(c.s); la <= Math.floor(c.n); la++) for (let lo = Math.floor(c.w); lo <= Math.floor(c.e); lo++) {
    const key = la + ',' + lo; if (!bucket.has(key)) bucket.set(key, []); bucket.get(key).push(k);
  }
});
function near(b, pad) {
  const out = new Set();
  for (let la = Math.floor(b.south - pad); la <= Math.floor(b.north + pad); la++) for (let lo = Math.floor(b.west - pad); lo <= Math.floor(b.east + pad); lo++) {
    (bucket.get(la + ',' + lo) || []).forEach((k) => { const c = counties[k]; if (c.e >= b.west - pad && c.w <= b.east + pad && c.n >= b.south - pad && c.s <= b.north + pad) out.add(k); });
  }
  return [...out];
}
let last = -1;
function countyAt(x, y, cand) {
  if (last >= 0 && inCounty(x, y, counties[last])) return last;
  for (const k of cand) if (inCounty(x, y, counties[k])) { last = k; return k; }
  return -1;
}

/* ---- one grid -> its cells ---- */
export function cellsFor(id) {
  const b = M.gridBounds(id), step = 0.25 / NCELL, cand = near(b, step * 1.5);
  const P = NCELL + 3, lat0 = b.south - step, lon0 = b.west - step;       /* lattice over the grid and one cell beyond each edge */
  const corner = new Int32Array(P * P), centre = new Int32Array((P - 1) * (P - 1));
  for (let r = 0; r < P; r++) for (let c = 0; c < P; c++) corner[r * P + c] = countyAt(lon0 + c * step, lat0 + r * step, cand);
  for (let r = 0; r < P - 1; r++) for (let c = 0; c < P - 1; c++) centre[r * (P - 1) + c] = countyAt(lon0 + (c + 0.5) * step, lat0 + (r + 0.5) * step, cand);
  const Q = P - 1, raw = new Int32Array(Q * Q);                           /* -2 mixed, -1 none, k county */
  for (let r = 0; r < Q; r++) for (let c = 0; c < Q; c++) {
    const v = centre[r * Q + c];
    const same = corner[r * P + c] === v && corner[r * P + c + 1] === v && corner[(r + 1) * P + c] === v && corner[(r + 1) * P + c + 1] === v;
    raw[r * Q + c] = same ? v : -2;
  }
  const list = [], idx = new Map(), cells = [];
  for (let r = 1; r <= NCELL; r++) for (let c = 1; c <= NCELL; c++) {
    const v = raw[r * Q + c];
    let ok = v !== -2;
    for (let dr = -1; ok && dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (raw[(r + dr) * Q + c + dc] !== v) { ok = false; break; }
    if (!ok) { cells.push('?'); continue; }
    if (v === -1) { cells.push('-'); continue; }
    const f = counties[v].fips;
    if (!idx.has(f)) { idx.set(f, list.length); list.push(f); }
    cells.push(String.fromCharCode(97 + idx.get(f)));
  }
  let m = '', i = 0;
  while (i < cells.length) { let j = i; while (j < cells.length && cells[j] === cells[i]) j++; m += cells[i] + (j - i); i = j; }
  return { c: list, m, cells };
}

function gridsInRepo() {
  const dir = path.join(REPO, 'data/prf/g'), out = {};
  fs.readdirSync(dir).filter((f) => f.endsWith('.json')).forEach((f) => {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    out[f.replace('.json', '')] = Object.keys(d.g).map((id) => ({ id: +id, listed: d.g[id].c || [] }));
  });
  return out;
}

if (SELFTEST) {
  /* Hand-checked points. Chetek, WI (45.314, -91.651) is in Barron County 55005, well inside it.
     Valentine, NE (42.873, -100.551) is in Cherry County 31031. Brookings, SD (44.311, -96.798) is 46011.
     A point in Lake Superior has no county. */
  const at = (lat, lon) => { const id = M.gridFromLatLon(lat, lon), b = M.gridBounds(id), o = cellsFor(id);
    const r = Math.min(NCELL - 1, Math.floor((lat - b.south) / (0.25 / NCELL))), c = Math.min(NCELL - 1, Math.floor((lon - b.west) / (0.25 / NCELL)));
    const ch = o.cells[r * NCELL + c]; return ch === '?' || ch === '-' ? ch : o.c[ch.charCodeAt(0) - 97]; };
  const want = [[45.314, -91.651, '55005'], [42.873, -100.551, '31031'], [44.311, -96.798, '46011'], [47.7, -87.5, '-']];
  let bad = 0;
  want.forEach(([la, lo, w]) => { const got = at(la, lo); if (got !== w) { bad++; console.error('SELFTEST FAIL', la, lo, 'want', w, 'got', got); } });
  /* the encoding must decode to exactly n*n cells */
  const o = cellsFor(M.gridFromLatLon(46.72, -92.30));
  let n = 0; o.m.replace(/([a-z?\-])(\d+)/g, (_, ch, k) => { n += +k; return ''; });
  if (n !== NCELL * NCELL) { bad++; console.error('SELFTEST FAIL: decoded', n, 'cells'); }
  if (o.c.length < 2) { bad++; console.error('SELFTEST FAIL: 46.72,-92.30 lies across Carlton and St. Louis counties, MN; found', o.c); }
  console.log(bad ? 'selftest: ' + bad + ' failed' : 'selftest: all passed');
  process.exit(bad ? 1 : 0);
}

const shards = gridsInRepo(), outDir = path.join(REPO, 'data/prf/c');
fs.mkdirSync(outDir, { recursive: true });
let grids = 0, oneCounty = 0, bytes = 0, cellsAsk = 0, cellsAll = 0, listedNotSeen = 0, seenNotListed = 0;
const notSeen = [];
for (const [key, list] of Object.entries(shards)) {
  const g = {};
  for (const { id, listed } of list) {
    const o = cellsFor(id);
    g[id] = { c: o.c, m: o.m };
    grids++; cellsAll += o.cells.length; cellsAsk += o.cells.filter((x) => x === '?').length;
    if (o.c.length === 1 && !o.cells.some((x) => x !== 'a')) oneCounty++;
    listed.forEach((f) => { if (!o.c.includes(f)) { listedNotSeen++; if (notSeen.length < 12) notSeen.push(id + ':' + f); } });
    o.c.forEach((f) => { if (!listed.includes(f)) seenNotListed++; });
  }
  const body = JSON.stringify({ n: NCELL, src: SRC, g });
  fs.writeFileSync(path.join(outDir, key + '.json'), body); bytes += body.length;
}
if (!grids) { console.error('no grids found under data/prf/g: nothing written'); process.exit(1); }
console.log(JSON.stringify({ grids, shards: Object.keys(shards).length, bytes, grids_wholly_one_county: oneCounty,
  share_of_cells_that_ask: +(cellsAsk / cellsAll).toFixed(4),
  usda_listed_county_with_no_sure_cell: listedNotSeen, county_cells_usda_does_not_list: seenNotListed, examples_not_seen: notSeen }, null, 1));
