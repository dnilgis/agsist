// /farmland-index (scripts/build_land_index.py): the Illinois farmland sale index.
// No buyer or seller name, legal description, parcel or document number may reach the page or
// data/land/index.json (STANDING-DECISIONS, Oct 17: no names on indexed land pages). Withheld
// cells say why, a state that does not hold up on its own prints no index number, the latest
// quarter is provisional, no em dashes, no sponsor slot, and the byline is at the end.
//
//   node --test test/farmland-index.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const PAGE = read("farmland-index.html");
const RAW = read("data/land/index.json");
const D = JSON.parse(RAW);
const norm = (s) => String(s).toUpperCase().replace(/\s+/g, " ").trim();
const words = (s) => new Set(norm(s).split(/[^A-Z0-9&']+/).filter((w) => w.length >= 3));
const PLACE = new Set(["TOWNSHIP", "TOWN", "COUNTY", "VILLAGE", "CITY", "OF", "THE", "STATE", "ILLINOIS", "WISCONSIN", "INDIANA"]);

function privateValues(st) {
  const out = new Set();
  const files = readdirSync(join(ROOT, "data/land", st)).filter((n) => /^\d{5}\.json$/.test(n)).map((n) => JSON.parse(read(`data/land/${st}/${n}`)));
  const place = words(files.map((f) => [f.county, ...Object.values(f.munis || {}).map((m) => m[0])].join(" ")).join(" "));
  for (const f of files) {
    const ix = ["grantor", "grantee", "legal", "pid", "doc"].map((c) => f.cols.indexOf(c)).filter((i) => i >= 0);
    for (const r of f.rows) for (const i of ix) {
      const v = r[i];
      if (v == null || String(v).trim().length < 6) continue;
      const ws = [...words(v)];
      if (ws.length && ws.every((w) => PLACE.has(w) || place.has(w))) continue;
      if (ws.length < 2 && !/\d/.test(v)) continue;
      out.add(norm(v));
    }
  }
  return out;
}
function leaks(text, vals) {
  const W = words(text), T = norm(text), hit = [];
  for (const v of vals) if ([...words(v)].every((w) => W.has(w)) && T.includes(v)) hit.push(v);
  return hit;
}

test("no buyer or seller name, legal, parcel or document number on the page or in the data file", () => {
  for (const st of ["il", "in", "wi"]) {
    const vals = privateValues(st);
    assert.ok(vals.size > 1000, `${st}: the check has names to look for (${vals.size})`);
    assert.deepEqual(leaks(PAGE, vals).slice(0, 3), [], `${st}: names on the page`);
    assert.deepEqual(leaks(RAW, vals).slice(0, 3), [], `${st}: names in data/land/index.json`);
  }
});

test("the data file holds counts, prices, dates and county names: no field a name could ride in", () => {
  const COUNTY = new Set(["fips", "name", "y", "ptr", "ptr_why"]);
  const il = D.states.IL;
  const names = new Set(readdirSync(join(ROOT, "data/land/il")).filter((n) => /^\d{5}\.json$/.test(n)).map((n) => JSON.parse(read(`data/land/il/${n}`)).county));
  for (const c of il.counties) {
    for (const k of Object.keys(c)) assert.ok(COUNTY.has(k), `county field ${k}`);
    assert.ok(names.has(c.name), `${c.name} is a county name`);
    for (const [y, v] of Object.entries(c.y)) {
      assert.match(y, /^\d{4}$/);
      assert.ok(Array.isArray(v) && v.length === 2 && (v[0] === null || typeof v[0] === "number") && Number.isInteger(v[1]));
      assert.equal(v[0] === null, v[1] < 5, `${c.name} ${y}: median shown only with 5+ sales`);
    }
  }
  for (const b of il.buyers) for (const k of Object.keys(b)) assert.ok(["y", "n", "blank", "individual", "trust", "company", "other"].includes(k), `buyer field ${k}`);
  assert.ok(RAW.length < 150 * 1024, `data file ${RAW.length} bytes`);
});

test("a state that does not hold up on its own prints no index number, and says why", () => {
  for (const [st, s] of Object.entries(D.states)) {
    if (!s.held) continue;
    for (const k of ["quarters", "annual", "y4", "yoy", "counties", "buyers"]) assert.ok(!(k in s), `${st} held back but carries ${k}`);
    assert.ok(PAGE.includes(s.held.replace(/&/g, "&amp;")), `${st}: the reason is on the page`);
  }
  assert.ok(!D.states.IL.held, "Illinois is published");
});

test("quarters: thin ones withheld with the reason, the latest provisional, the headline from settled quarters", () => {
  const q = D.states.IL.quarters;
  assert.equal(q[q.length - 1].prov, 1, "the latest quarter is provisional");
  for (const r of q) {
    if (r.ix == null) assert.match(r.why, /fewer than \d+ sales/);
    else assert.ok(r.n >= D.rule.min_q && r.lo <= r.ix && r.ix <= r.hi, `${r.q}`);
  }
  const y4 = D.states.IL.y4;
  const prov = new Set(q.filter((r) => r.prov).map((r) => r.q));
  assert.ok(!prov.has(y4.to), "the headline ends on a settled quarter");
  assert.ok(y4.lo <= y4.pct && y4.pct <= y4.hi);
  assert.ok(PAGE.includes("provisional"));
  assert.ok(PAGE.includes(y4.ix.toFixed(1)), "the headline number is in the page HTML, not only in script");
});

test("NASS is its own line, never blended", () => {
  const nv = JSON.parse(read("data/atlas/state-value.json")).states.IL.cropland;
  const base = nv[String(D.states.IL.start)];
  for (const a of D.states.IL.annual) if (a.nass != null) {
    assert.equal(a.nass_usd, nv[String(a.y)], `${a.y}: NASS dollars straight from the NASS file`);
    assert.equal(a.nass, Math.round(nv[String(a.y)] / base * 1000) / 10, `${a.y}: NASS on the base year, nothing else in it`);
  }
  assert.match(PAGE, /class="li-nass"/);
});

test("page rules: no em dash, byline at the end only, no sponsor slot, Dataset and FAQ, in the sitemap and llms.txt", () => {
  assert.ok(!/—|&mdash;/.test(PAGE), "em dash");
  const at = PAGE.indexOf("Sigurd Lindquist, CCA");
  assert.ok(at > PAGE.indexOf('id="sources"'), "byline only at the end");
  assert.ok(!/data-sponsor|ag-sponsor|sponsor-slot/.test(PAGE), "no sponsor slot");
  assert.match(PAGE, /"@type":"Dataset"/);
  assert.match(PAGE, /"@type":"FAQPage"/);
  assert.match(read("sitemap.xml"), /<loc>https:\/\/agsist\.com\/farmland-index<\/loc>/);
  assert.match(read("llms.txt"), /\/farmland-index/);
  assert.ok(PAGE.length < 150 * 1024);
});

test("the builder's selftest passes (real names-stripped fixture, least squares vs alternating means)", () => {
  const out = execFileSync("python3", ["scripts/build_land_index.py", "--selftest"], { cwd: ROOT, env: { ...process.env, OMP_NUM_THREADS: "1" } }).toString();
  assert.match(out, /selftest: ok/);
  assert.ok(!/SYNTHETIC/.test(PAGE + RAW));
});
