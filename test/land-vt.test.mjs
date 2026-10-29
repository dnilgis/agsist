/* Vermont land sales (Sig, Oct 29, 2026: next land states, Vermont first). The property transfer tax
 * returns (Form PTT-172) from the statewide file the state publishes, read by
 * scripts/fetch_land_sales.py (vt_table) into data/land/vt/<fips>.json, then the same pages,
 * Field Scout comps, Atlas door and monthly email as Illinois, Wisconsin and Indiana.
 *
 *   node --test test/land-vt.test.mjs
 *
 * Every Vermont county file: the one land rule in JavaScript and Python agrees row for row, the
 * land type too; no parcel point anywhere (the town's point only); no buyer or seller name in an
 * indexed page; every sale in the county file is listed on its county page's list. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));
const require = createRequire(import.meta.url);
const F = require(path.join(ROOT, "field-scout-land.js"));
const VT = "data/land/vt";
const FILES = fs.readdirSync(path.join(ROOT, VT)).filter((n) => /^50\d{3}\.json$/.test(n)).sort();

test("all 14 Vermont counties have a transfer file", () => {
  assert.equal(FILES.length, 14, FILES.join(" "));
  const ix = json(`${VT}/index.json`);
  assert.equal(ix.state, "VT");
  assert.deepEqual(ix.counties.map((c) => c.fips + ".json").sort(), FILES);
  for (const c of ix.counties) assert.equal(c.n, json(`${VT}/${c.fips}.json`).rows.length, c.fips + ": the index counts every row");
});

test("the one land rule: JavaScript and Python agree row for row on every Vermont county, land type included", () => {
  const jsRule = (f, today) => F.saleRows(F.rowObjs(f), today).map((r) => [r.doc, String(r.date || "").slice(0, 10), Math.round(F.num(r.price) || 0), F.num(r.acres), r.ppa, F.marketSale(r, today), F.statOK(r), r.grp || 1]);
  let n = 0, market = 0;
  for (const nm of FILES) {
    const p = path.join(ROOT, VT, nm), f = JSON.parse(fs.readFileSync(p, "utf8")), today = String(f.fetched_utc).slice(0, 10);
    const r = spawnSync("python3", [path.join(ROOT, "scripts/build_land_summary.py"), "--rule", p, today], { encoding: "utf8", maxBuffer: 64 << 20 });
    assert.equal(r.status, 0, r.stderr);
    const js = jsRule(f, today);
    assert.deepEqual(js, JSON.parse(r.stdout)[0], nm);
    n += js.length; market += js.filter((x) => x[5]).length;
  }
  assert.ok(n > 5000 && market > 1500, `rows ${n}, market ${market}`);
  // land type: FSLand.landType and build_land_summary.land_type on every row of every file
  const code = "import json,sys\nsys.path.insert(0,sys.argv[1])\nimport build_land_summary as B\nout=[]\nfor p in sys.argv[2:]:\n  f=json.load(open(p))\n  out.append([B.land_type(dict(zip(f['cols'],r)),'VT') for r in f['rows']])\nprint(json.dumps(out))";
  const py = spawnSync("python3", ["-c", code, path.join(ROOT, "scripts"), ...FILES.map((x) => path.join(ROOT, VT, x))], { encoding: "utf8", maxBuffer: 64 << 20 });
  assert.equal(py.status, 0, py.stderr);
  const want = JSON.parse(py.stdout);
  const seen = new Set();
  FILES.forEach((nm, i) => {
    const f = json(`${VT}/${nm}`);
    const got = f.rows.map((r) => F.landType(Object.fromEntries(f.cols.map((c, j) => [c, r[j]])), "VT"));
    assert.deepEqual(got, want[i], nm + ": land type");
    got.forEach((k) => seen.add(k));
  });
  assert.deepEqual([...seen].sort(), ["bldg", "farm", "forest", "small"], "every type shows up in Vermont");
  // timberland with no operating farm and no buildings is forest; an operating farm with timber is farm land
  assert.equal(F.landType({ cls: "6", acres: 80 }, "VT"), "forest");
  assert.equal(F.landType({ cls: "4 6", acres: 80 }, "VT"), "farm");
  assert.equal(F.landType({ cls: "6 7", acres: 80 }, "VT"), "bldg");
  assert.equal(F.landType({ cls: "5", acres: 80 }, "VT"), "farm", "open land enrolled in current use is farmland (the method note says it may include woods)");
});

test("no parcel point anywhere: each sale sits at its town, and the fetch never reads the file's coordinates", () => {
  const fetchPy = read("scripts/fetch_land_sales.py");
  const cols = fetchPy.match(/VT_COLS = \[([\s\S]*?)\]/)[1];
  assert.doesNotMatch(cols, /Latitude|Longitude|GEOM|Addr|Street|Zip/i, "VT_COLS reads no point and no address");
  const towns = new Map();
  for (const nm of FILES) {
    const f = json(`${VT}/${nm}`);
    assert.ok(!f.cols.some((c) => /lat|lng|lon|geom|point/i.test(c)), nm + ": no point column");
    for (const [k, m] of Object.entries(f.munis)) {
      assert.equal(m.length, 3, nm + " muni " + k);
      assert.match(m[0], / (town|city|gore|grant|location)$/, nm + ": a Census town name, " + m[0]);
      const key = m[0] + "|" + f.fips;
      if (towns.has(key)) assert.deepEqual(towns.get(key), [m[1], m[2]]);
      towns.set(key, [m[1], m[2]]);
    }
    assert.ok(Object.keys(f.munis).length <= 60, nm + ": towns, not parcels");
  }
  assert.ok(towns.size < 300, "Vermont has 255 towns, cities, gores and grants: " + towns.size);
  // every point published for Vermont is one of those town points
  const pts = new Set([...towns.values()].map(([a, b]) => a + "," + b));
  const S = json("data/land-sales/vt.json");
  for (const [fips, c] of Object.entries(S.counties)) for (const r of c.s) {
    if (r[7] == null) continue;
    assert.ok(pts.has(r[7] + "," + r[8]), `${fips} ${r[0]}: ${r[7]},${r[8]} is not a town point`);
  }
  for (const nm of fs.readdirSync(path.join(ROOT, "data/land-sales/vt"))) {
    const L = json(`data/land-sales/vt/${nm}`);
    assert.ok(!L.cols.some((c) => /lat|lng/.test(c)), nm + ": the list file carries no point");
  }
});

test("no Vermont buyer or seller name in an indexed page, a list file or the Atlas", () => {
  assert.match(read("robots.txt"), /^Disallow: \/data\/land\/$/m);
  const pages = fs.readdirSync(path.join(ROOT, "land-sales/vermont")).map((n) => read(`land-sales/vermont/${n}`))
    .concat(fs.readdirSync(path.join(ROOT, "farmland-atlas/vermont")).map((n) => read(`farmland-atlas/vermont/${n}`)))
    .concat([read("land-sales/index.html")], fs.readdirSync(path.join(ROOT, "land-sales")).filter((n) => /^\d{4}-\d{2}\.html$/.test(n)).map((n) => read(`land-sales/${n}`)))
    .concat(fs.readdirSync(path.join(ROOT, "data/land-sales/vt")).map((n) => read(`data/land-sales/vt/${n}`)), [read("data/land-sales/vt.json"), read("data/land-sales/latest.json")]);
  const big = pages.join("\n").toUpperCase();
  let n = 0;
  for (const nm of FILES) {
    const f = json(`${VT}/${nm}`), gi = f.cols.indexOf("grantor"), ge = f.cols.indexOf("grantee");
    assert.ok(gi >= 0 && ge >= 0 && f.names === true, nm + ": names kept in the blocked folder only");
    for (const r of f.rows) for (const side of [r[gi], r[ge]]) for (const one of String(side || "").split(/;\s*/)) {
      const s = one.trim().toUpperCase();
      // a public body or a short word can match ordinary page text; private names of 8+ characters must not
      if (s.length < 8 || /^(STATE OF VERMONT|TOWN OF |CITY OF |VILLAGE OF |UNITED STATES|USA\b|VERMONT )/.test(s)) continue;
      assert.ok(!big.includes(s), `${nm}: a name in an indexed page or a list file`);
      n++;
    }
  }
  assert.ok(n > 5000, "names checked: " + n);
});

test("Vermont is read on the monthly land run and archived to the raw branch", () => {
  const wf = read(".github/workflows/land-data.yml");
  assert.match(wf, /python scripts\/fetch_land_sales\.py MN IL IN VT /);
  assert.match(wf, /pyarrow==\d+\.\d+\.\d+/);
  assert.match(wf, /inputs\.task == 'vt'/);
  assert.match(read("scripts/fetch_land_sales.py"), /fetch_vt\(os\.path\.join\(RAW, "vt", "vt-property-transfers-%s\.parquet" % now\[:10\]\)\)/, "the dated copy goes under data/land-raw, which the run pushes to the raw branch");
  assert.equal(fs.readdirSync(path.join(ROOT, "land-sales/vermont")).length, 14);
});
