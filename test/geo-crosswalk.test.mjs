/* The shared county code table (god's-eye panel build 2, Oct 27 2026): data/ids/geo-crosswalk.json
 * from scripts/build_geo_crosswalk.py, and the join report scripts/join_report.py that fails the
 * ship checks when a data set's match rate falls below its floor.
 *
 *   node --test test/geo-crosswalk.test.mjs
 *
 * Real cases: FSA writes 29193 for Ste. Genevieve MO (FIPS 29186) and 46113 for Oglala Lakota SD
 * (FIPS 46102), so both lost ARC/PLC on a plain FIPS join; the Drought Monitor and RMA write
 * Connecticut's nine 2022 planning regions, which no spine county matches. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));
const XW = json("data/ids/geo-crosswalk.json");
const SPINE = new Set(json("data/atlas/counties.geo.json").features.map((f) => String(f.id)));
const OUTSIDE = new Set(["72", "78", "60", "66", "69", "11"]);

test("crosswalk: under 60 KB, one district or a listed gap for every spine county", () => {
  assert.ok(statSync(join(ROOT, "data/ids/geo-crosswalk.json")).size < 60 * 1024);
  assert.equal(XW.schema, "agsist-geo-crosswalk/1");
  assert.equal(XW.spine.counties, SPINE.size);
  const missing = new Set(XW.asd_missing);
  for (const f of SPINE) assert.ok((f in XW.asd) !== missing.has(f), `${f}: a district or listed missing, not both`);
  for (const [f, d] of Object.entries(XW.asd)) {
    assert.ok(SPINE.has(f), `${f} carries a district but is not a spine county`);
    assert.match(d, /^\d{2}$/, `${f}: two-digit district`);
  }
  assert.ok(missing.size <= 10, `${missing.size} counties without a district`);
  assert.equal(XW.asd["19169"], "50", "Story County IA is in Iowa Central (1950)");
  assert.ok(XW.sources.asd && XW.sources.asd_url.includes("nass.usda.gov"), "the district source is named");
});

test("crosswalk: every off-spine code folds onto spine counties or is never folded", () => {
  for (const [code, r] of Object.entries(XW.codes)) {
    assert.ok(!SPINE.has(code), `${code} is a spine county`);
    assert.ok(["rename", "part", "office", "merger", "split", "reshape"].includes(r.kind), `${code}: kind ${r.kind}`);
    if (r.kind === "reshape") assert.equal(r.to, null, `${code}: a reshape is not folded`);
    else for (const t of r.to) assert.ok(SPINE.has(t), `${code} -> ${t} is not a spine county`);
    assert.ok(r.name && r.agencies.length, `${code}: name and agencies`);
  }
  assert.deepEqual(XW.codes["29193"].to, ["29186"], "Ste. Genevieve: FSA 29193 -> 29186");
  assert.deepEqual(XW.codes["46113"].to, ["46102"], "Oglala Lakota: FSA 46113 -> 46102");
  for (const c of ["09110", "09120", "09130", "09140", "09150", "09160", "09170", "09180", "09190"])
    assert.equal(XW.codes[c].kind, "reshape", `${c} CT planning region`);
});

test("crosswalk: the Atlas build's FIPS_ALIAS is a subset with the same targets", () => {
  const src = read("scripts/build_farmland_atlas.py");
  const block = src.slice(src.indexOf("FIPS_ALIAS = {"), src.indexOf("}", src.indexOf("FIPS_ALIAS = {")));
  const pairs = [...block.matchAll(/"(\d{5})":\s*"(\d{5})"/g)];
  assert.ok(pairs.length >= 9, "read the alias table");
  for (const [, from, to] of pairs) assert.deepEqual(XW.codes[from]?.to, [to], `FIPS_ALIAS ${from} -> ${to}`);
});

test("crosswalk: every county code our federal files write is a spine county, in the table, or outside", () => {
  const seen = [];
  for (const f of readdirSync(join(ROOT, "data/arc-plc")).filter((n) => /^[A-Z]{2}\.json$/.test(n)))
    for (const c of json("data/arc-plc/" + f).c) seen.push(["arc-plc", c.f]);
  for (const k of Object.keys(json("data/payments/county.json").counties)) seen.push(["payments", k]);
  const dr = json("data/drought/county-week.json");
  for (const k of [...Object.keys(dr.c), ...dr.zero]) seen.push(["drought", k]);
  for (const k of Object.keys(json("data/rma-planting-dates.json").counties)) seen.push(["rma", k]);
  for (const k of Object.keys(json("data/tenure/tenure.json").counties)) seen.push(["tenure", k]);
  const stray = seen.filter(([, k]) => !SPINE.has(k) && !XW.codes[k] && !OUTSIDE.has(k.slice(0, 2)));
  assert.deepEqual(stray, [], "a new off-spine code: add it to scripts/build_geo_crosswalk.py EXTRA");
  const arc = seen.filter(([s]) => s === "arc-plc").map(([, k]) => k);
  assert.ok(arc.includes("29193") && arc.includes("46113"), "the real ARC case is still in the data (else rewrite this check)");
});

test("join report: builds clean, every rate at or above its floor, counts only", () => {
  execFileSync("python3", [join(ROOT, "scripts/build_geo_crosswalk.py"), "--selftest"], { stdio: "pipe" });
  execFileSync("python3", [join(ROOT, "scripts/build_geo_crosswalk.py"), "--check"], { stdio: "pipe" });
  execFileSync("python3", [join(ROOT, "scripts/join_report.py"), "--selftest"], { stdio: "pipe" });
  const out = JSON.parse(execFileSync("python3", [join(ROOT, "scripts/join_report.py"), "--json"], { encoding: "utf8" }));
  assert.deepEqual(out.fails, []);
  const by = Object.fromEntries(out.rows.map((r) => [r.name, r]));
  assert.equal(by["arc-plc counties"].rate, 1, "ARC/PLC: every county joins (FSA office codes folded)");
  assert.ok(by["arc-plc counties"].folded >= 11);
  assert.equal(by["drought counties"].cover[0], SPINE.size - 8, "only the eight old CT counties stay dark on drought");
  const text = JSON.stringify(out);
  assert.ok(!/@|grantee|grantor/i.test(text), "no address or sale party in the report");
});

test("join report: wired into the ship checks", () => {
  const sh = read("scripts/dev/checks.sh");
  assert.match(sh, /run geo-crosswalk .*build_geo_crosswalk\.py --check/);
  assert.match(sh, /run join-report .*join_report\.py"/);
});
