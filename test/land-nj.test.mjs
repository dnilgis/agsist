/* New Jersey land sales (Oct 29, 2026: next land states). The SR-1A deed abstracts the county tax boards
 * send the Division of Taxation, each deed's lots joined to the MOD-IV 2026 assessment list for acres and
 * property class, read by scripts/fetch_land_sales.py (nj_table) into data/land/nj/<fips>.json, then the
 * same pages, Field Scout comps, Atlas door and monthly email as the other states.
 *
 *   node --test test/land-nj.test.mjs
 *
 * Every New Jersey county file: the one land rule in JavaScript and Python agrees row for row, the land
 * type too; no parcel point anywhere (the municipality's Census point only); no buyer or seller name in an
 * indexed page; every sale in the county file is listed on its county page's list; the method note says the
 * acres are today's lot and lists how the state's codes map onto the rule. */
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
const NJ = "data/land/nj";
const FILES = fs.readdirSync(path.join(ROOT, NJ)).filter((n) => /^34\d{3}\.json$/.test(n)).sort();
const row = (f, r) => Object.fromEntries(f.cols.map((c, j) => [c, r[j]]));

test("New Jersey's farm counties have a transfer file, and the index counts every row", () => {
  assert.ok(FILES.length >= 15, FILES.join(" "));
  for (const fips of ["34033", "34019"]) assert.ok(FILES.includes(fips + ".json"), fips + ": Salem and Hunterdon, two farm counties");
  const ix = json(`${NJ}/index.json`);
  assert.equal(ix.state, "NJ");
  assert.deepEqual(ix.counties.map((c) => c.fips + ".json").sort(), FILES);
  for (const c of ix.counties) assert.equal(c.n, json(`${NJ}/${c.fips}.json`).rows.length, c.fips + ": the index counts every row");
});

test("the one land rule: JavaScript and Python agree row for row on every New Jersey county, land type included", () => {
  const jsRule = (f, today) => F.saleRows(F.rowObjs(f), today).map((r) => [r.doc, String(r.date || "").slice(0, 10), Math.round(F.num(r.price) || 0), F.num(r.acres), r.ppa, F.marketSale(r, today), F.statOK(r), r.grp || 1]);
  let n = 0, market = 0;
  for (const nm of FILES) {
    const p = path.join(ROOT, NJ, nm), f = JSON.parse(fs.readFileSync(p, "utf8")), today = String(f.fetched_utc).slice(0, 10);
    const r = spawnSync("python3", [path.join(ROOT, "scripts/build_land_summary.py"), "--rule", p, today], { encoding: "utf8", maxBuffer: 64 << 20 });
    assert.equal(r.status, 0, r.stderr);
    const js = jsRule(f, today);
    assert.deepEqual(js, JSON.parse(r.stdout)[0], nm);
    n += js.length; market += js.filter((x) => x[5]).length;
  }
  assert.ok(n > 1000 && market > 200, `rows ${n}, market ${market}`);
  const code = "import json,sys\nsys.path.insert(0,sys.argv[1])\nimport build_land_summary as B\nout=[]\nfor p in sys.argv[2:]:\n  f=json.load(open(p))\n  out.append([B.land_type(dict(zip(f['cols'],r)),'NJ') for r in f['rows']])\nprint(json.dumps(out))";
  const py = spawnSync("python3", ["-c", code, path.join(ROOT, "scripts"), ...FILES.map((x) => path.join(ROOT, NJ, x))], { encoding: "utf8", maxBuffer: 64 << 20 });
  assert.equal(py.status, 0, py.stderr);
  const want = JSON.parse(py.stdout);
  const seen = new Set();
  FILES.forEach((nm, i) => {
    const f = json(`${NJ}/${nm}`);
    const got = f.rows.map((r) => F.landType(row(f, r), "NJ"));
    assert.deepEqual(got, want[i], nm + ": land type");
    got.forEach((k) => seen.add(k));
  });
  for (const k of ["bldg", "farm", "small"]) assert.ok(seen.has(k), "New Jersey shows " + k);
  assert.ok(!seen.has("forest"), "New Jersey records carry no forest class");
  // 3B alone is bare farm land; 3A (the farmhouse lot) is with buildings
  assert.equal(F.landType({ cls: "4", acres: 40 }, "NJ"), "farm");
  assert.equal(F.landType({ cls: "4 1", acres: 40 }, "NJ"), "bldg");
});

test("the state's codes map onto the rule: out codes leave the middle, study-only codes and farmland (33) stay in", () => {
  const today = "2026-10-29";
  const out = ["Deed, Related Parties (immediate family)", "Deed, Non-usable: not between a willing buyer and willing seller", "Deed, Quit claim or doubtful title",
    "Deed, Sheriff's sale", "Deed, Undivided interest; less than full interest"];
  for (const conv of out) assert.equal(F.marketSale({ price: 400000, acres: 40, conv }, today), false, conv);
  assert.equal(F.marketSale({ price: 400000, acres: 40, conv: "Deed; state ratio study code 33: farmland-assessed or exempt property; land only" }, today), true, "33 stays in");
  assert.equal(F.marketSale({ price: 400000, acres: 40, conv: "Deed", exempt: 1 }, today), false, "a realty transfer fee exemption is out");
  // every row: a deed with an out code never reaches a middle; the flag words of a kept code never trip the rule
  let outRows = 0, kept33 = 0;
  for (const nm of FILES) {
    const f = json(`${NJ}/${nm}`);
    for (const r of f.rows) {
      const o = row(f, r), c = String(o.conv || "");
      if (/Non-usable|Related Parties|Quit claim|Sheriff|Judicial|Undivided|Exchange|Gift|Correction|foreclosure|lease back|Bankruptcy/i.test(c)) {
        outRows++;
        assert.equal(F.marketSale(Object.assign({}, o, { acres: 40, np: 1 }), today), false, nm + " " + o.doc + ": " + c);
      }
      if (/code 33/.test(c) && !/Non-usable|Related|Quit|Sheriff/.test(c)) kept33++;
    }
  }
  assert.ok(outRows > 50 && kept33 > 100, `out ${outRows}, farmland 33 kept ${kept33}`);
});

test("no parcel point anywhere: each sale sits at its municipality, and the fetch reads no address", () => {
  const fetchPy = read("scripts/fetch_land_sales.py");
  const sr = fetchPy.match(/NJ_SR = \{([\s\S]*?)\}/)[1];
  assert.doesNotMatch(sr, /street|city|zip|addr|location/i, "NJ_SR reads no street, city, ZIP or property location");
  const md = fetchPy.match(/NJ_MD = \{([\s\S]*?)\}/)[1];
  assert.doesNotMatch(md, /street|city|zip|addr|location|owner|census/i, "NJ_MD reads no owner, address or census block");
  const towns = new Map();
  for (const nm of FILES) {
    const f = json(`${NJ}/${nm}`);
    assert.ok(!f.cols.some((c) => /lat|lng|lon|geom|point/i.test(c)), nm + ": no point column");
    for (const [k, m] of Object.entries(f.munis)) {
      assert.equal(m.length, 3, nm + " muni " + k);
      const key = m[0] + "|" + f.fips;
      if (towns.has(key)) assert.deepEqual(towns.get(key), [m[1], m[2]]);
      towns.set(key, [m[1], m[2]]);
    }
    assert.ok(Object.keys(f.munis).length <= 70, nm + ": municipalities, not parcels");
  }
  assert.ok(towns.size <= 566, "New Jersey has 564 municipalities: " + towns.size);
  const placed = [...towns.values()].filter(([a]) => a != null).length;
  assert.ok(placed >= 0.95 * towns.size, `municipalities placed at a Census point: ${placed} of ${towns.size}`);
  const pts = new Set([...towns.values()].map(([a, b]) => a + "," + b));
  const S = json("data/land-sales/nj.json");
  for (const [fips, c] of Object.entries(S.counties)) for (const r of c.s) {
    if (r[7] == null) continue;
    assert.ok(pts.has(r[7] + "," + r[8]), `${fips} ${r[0]}: ${r[7]},${r[8]} is not a municipality point`);
  }
  for (const nm of fs.readdirSync(path.join(ROOT, "data/land-sales/nj"))) {
    const L = json(`data/land-sales/nj/${nm}`);
    assert.ok(!L.cols.some((c) => /lat|lng/.test(c)), nm + ": the list file carries no point");
  }
});

test("no New Jersey buyer or seller name in an indexed page, a list file or the Atlas", () => {
  assert.match(read("robots.txt"), /^Disallow: \/data\/land\/$/m);
  const pages = fs.readdirSync(path.join(ROOT, "land-sales/new-jersey")).map((n) => read(`land-sales/new-jersey/${n}`))
    .concat(fs.readdirSync(path.join(ROOT, "farmland-atlas/new-jersey")).map((n) => read(`farmland-atlas/new-jersey/${n}`)))
    .concat([read("land-sales/index.html"), read("rent/new-jersey.html")], fs.readdirSync(path.join(ROOT, "land-sales")).filter((n) => /^\d{4}-\d{2}\.html$/.test(n)).map((n) => read(`land-sales/${n}`)))
    .concat(fs.readdirSync(path.join(ROOT, "data/land-sales/nj")).map((n) => read(`data/land-sales/nj/${n}`)), [read("data/land-sales/nj.json"), read("data/land-sales/latest.json")]);
  const big = pages.join("\n").toUpperCase();
  let n = 0;
  for (const nm of FILES) {
    const f = json(`${NJ}/${nm}`), gi = f.cols.indexOf("grantor"), ge = f.cols.indexOf("grantee");
    assert.ok(gi >= 0 && ge >= 0 && f.names === true, nm + ": names kept in the blocked folder only");
    for (const r of f.rows) for (const side of [r[gi], r[ge]]) {
      const s = String(side || "").trim().toUpperCase();
      if (s.length < 8 || /^(STATE OF NEW JERSEY|STATE OF N\.?J|TOWNSHIP OF |TWP OF |BOROUGH OF |BORO OF |CITY OF |COUNTY OF |UNITED STATES|USA\b|NEW JERSEY |NJ )/.test(s)) continue;
      assert.ok(!big.includes(s), `${nm}: a name in an indexed page or a list file`);
      n++;
    }
  }
  assert.ok(n > 1000, "names checked: " + n);
});

test("every New Jersey sale in a county file is on its county page's list, any acreage", () => {
  const slug = Object.fromEntries(Object.entries(json("data/land-sales/nj.json").counties).map(([f, c]) => [f, c.slug]));
  let n = 0;
  for (const nm of FILES) {
    const f = json(`${NJ}/${nm}`), fips = nm.slice(0, 5);
    assert.ok(slug[fips], fips + ": a county page");
    const L = json(`data/land-sales/nj/${fips}.json`);
    const today = String(f.fetched_utc).slice(0, 10);
    const sales = F.saleRows(F.rowObjs(f), today).filter((r) => F.marketSale(r, today) || true);
    // the list file holds the market sales of any acreage; count them against the rule's market sales
    const want = sales.filter((r) => F.marketSale(r, today)).length;
    assert.ok(L.s.length >= want * 0.99 && L.s.length > 0, `${fips}: listed ${L.s.length}, market sales ${want}`);
    n += L.s.length;
  }
  assert.ok(n > 200, "listed: " + n);
});

test("the method note: acres are today's lot, the join is said, the code mapping is listed", () => {
  const p = read("land-sales/new-jersey/salem-county.html");
  assert.match(p, /SR-1A deed abstracts/);
  assert.match(p, /today&#x27;s lot, which may not be the lot as it sold/);
  assert.match(p, /A deed whose lot is not on the list has no acres; it is listed and kept out of the middle/);
  assert.match(p, /Kept, since they only keep a deed out of the state&#x27;s assessment study: 5, 7, 10 \(estate sales\), 19, 24, 27, 29, 30, 32, 33 \(farmland assessment\), 34 and 36\./);
  assert.match(p, /out are family \(1\)[^<]*leasebacks \(28\), and any deed exempt from the realty transfer fee/);
  assert.match(p, /Source: .*New Jersey Division of Taxation/);
  assert.match(p, /data-land-alert/, "the monthly email covers New Jersey");
  for (const s of ["salem-county", "hunterdon-county"]) assert.ok(fs.existsSync(path.join(ROOT, "land-sales/new-jersey", s + ".html")), s);
});

test("New Jersey is read on the monthly land run, has its own task, and its dated files go to the raw branch", () => {
  const wf = read(".github/workflows/land-data.yml");
  assert.match(wf, /python scripts\/fetch_land_sales\.py MN IL IN VT NJ /);
  assert.match(wf, /inputs\.task == 'nj'/);
  assert.doesNotMatch(wf.replace(/cron: '23 9 3 \* \*'/, ""), /cron:/, "no new schedule: the monthly run on the 3rd only");
  const py = read("scripts/fetch_land_sales.py");
  assert.match(py, /fetch_nj\(os\.path\.join\(RAW, "nj"\)\)/, "the dated SR-1A copies go under data/land-raw, which the run pushes to the raw branch");
  assert.match(py, /keep_dir=None if from_dir else os\.path\.join\(RAW, "nj"\)/, "and the farm lots of MOD-IV");
});
