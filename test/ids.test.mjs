/* Permanent ids (step 3, Oct 18): data/ids/ from scripts/build_ids.py.
 *
 *   node --test test/ids.test.mjs
 *
 * The two-build stability, merge and split rules are run on a made-up world by
 * `python3 scripts/build_ids.py --selftest` (scripts/dev/checks.sh). This file checks
 * the committed outputs: one id per facility, every key held once and by the id the
 * ledger says, the parcel key twin agrees with the Python rule, and no person's name
 * from the land files is in any of it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));
const require = createRequire(import.meta.url);
const PK = require(join(ROOT, "data/ids/parcel-key.js"));
const EL = json("data/ids/elevators.json");
const LED = json("data/ids/elevator-ids.json");
const AMB = json("data/ids/ambiguous.json");
const FIX = json("data/ids/parcel-key-fixtures.json");
const KIND = { bids: "bids", basis: "basis", directory: "dir" };

const keysOf = (r) => Object.entries(r.sources).filter(([k]) => KIND[k]).flatMap(([k, v]) => v.map((x) => KIND[k] + ":" + x));
const byKey = new Map();
for (const r of EL.elevators) for (const k of keysOf(r)) byKey.set(k, (byKey.get(k) || []).concat(r.id));

// A reader-side lookup by any spelling: the key first, else operator + town + state on the aliases.
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function lookup(name, city, st) {
  const k = byKey.get(`basis:${st}|${String(name).toUpperCase()}|${String(city).toUpperCase()}`);
  if (k) return k[0];
  const hits = EL.elevators.filter((r) => r.st === st && norm(r.city) === norm(city) &&
    [r.name, r.company, ...(r.aliases || [])].some((a) => norm(a) === norm(name)));
  return hits.length === 1 ? hits[0].id : null;
}

test("one record per id, ids in one of the two forms", () => {
  const ids = EL.elevators.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^(e[0-9a-z]{9}|a\d{5})$/, id);
  assert.equal(EL.counts.facilities, ids.length);
});

test("every key is held by exactly one facility, the one the ledger names", () => {
  for (const [k, ids] of byKey) {
    assert.equal(ids.length, 1, `${k} on ${ids}`);
    const led = LED.keys[k];
    assert.ok(led, `${k} missing from the ledger`);
    const want = LED.minted[led] && LED.minted[led].into ? LED.minted[led].into : led;
    assert.equal(ids[0], want, k);
  }
});

test("AGSIST ids: each minted once, below next, a merged id never comes back", () => {
  const recIds = new Set(EL.elevators.map((r) => r.id));
  for (const [aid, m] of Object.entries(LED.minted)) {
    assert.match(aid, /^a\d{5}$/);
    assert.ok(+aid.slice(1) < LED.next, aid);
    assert.ok(m.first && m.since, aid);
    if (m.into) assert.ok(!recIds.has(aid), `${aid} was merged into ${m.into} but still has a record`);
  }
  for (const r of EL.elevators) if (r.id.startsWith("a")) assert.ok(LED.minted[r.id], `${r.id} not in the ledger`);
});

test("alias lookups: the basis history's spellings find one facility", () => {
  const a = lookup("ALLIED COOPERATIVE, WI", "ADAMS", "WI");
  const b = lookup("ALLIED COOPERATIVE", "ADAMS", "WI");
  assert.ok(a && a === b, `${a} ${b}`);
  assert.ok(EL.elevators.find((r) => r.id === a).aliases.includes("ALLIED COOPERATIVE, WI"));
  const c = lookup("NEW VISION CO-OP", "MANKATO", "MN");
  assert.ok(c && c === lookup("NEW VISION COOP", "MANKATO", "MN"));
  assert.equal(lookup("Allied Cooperative", "Adams", "WI"), a);   // by name on the record, any case
});

test("county by point for known towns", () => {
  const at = (id) => EL.elevators.find((r) => r.id === id);
  assert.equal(at(lookup("ALLIED COOPERATIVE", "ADAMS", "WI")).fips, "55001");        // Adams County WI
  assert.equal(at(lookup("SYNERGY COOPERATIVE", "RICE LAKE", "WI")).fips, "55005");   // Barron County, as Chetek
  assert.equal(at(lookup("NEW VISION CO-OP", "MANKATO", "MN")).fips, "27013");        // Blue Earth County MN
  for (const r of EL.elevators) {
    if (r.fips) assert.ok("lat" in r && /^\d{5}$/.test(r.fips), r.id);    // never a county without a point
    if (r.fips && r.st) assert.ok(r.fips.slice(0, 2) !== "", r.id);
  }
});

test("ambiguous keys are listed with 2+ candidates and held by an AGSIST id that names them", () => {
  for (const a of AMB.keys) {
    assert.ok(a.candidates.length >= 2, a.key);
    const holder = byKey.get(a.key);
    assert.ok(holder, a.key);
    const rec = EL.elevators.find((r) => r.id === holder[0]);
    assert.match(rec.id, /^a\d{5}$/, a.key);
    for (const c of a.candidates) assert.ok((rec.maybe || []).includes(c), `${a.key} ${c}`);
  }
  assert.equal(EL.counts.ambiguous_keys, AMB.keys.length);
});

test("parcel-key.js gives the Python rule's key for every fixture", () => {
  assert.ok(FIX.cases.length > 40);
  for (const [f, p, k] of FIX.cases) assert.equal(PK.parcelKey(f, p), k, `${f} ${p}`);
});

test("parcel keys per state", () => {
  // Illinois: with or without dashes; Cook's 0000 unit
  assert.equal(PK.parcelKey("17011", "25-14-400-004"), PK.parcelKey("17011", "2514400004"));
  assert.equal(PK.parcelKey("17031", "13-19-104-002-0000"), "17031:1319104002");
  assert.notEqual(PK.parcelKey("17011", "25-14-400-004"), PK.parcelKey("17013", "25-14-400-004"));   // county is in the key
  // Indiana: formatted, plain, and a dropped leading zero
  assert.equal(PK.parcelKey("18011", "06-03-02-000-036.002-020"), "18011:060302000036002020");
  assert.equal(PK.parcelKey("18011", "60302000036002020"), "18011:060302000036002020");
  assert.equal(PK.parcelKey("18139", "70073440000500001"), "18139:70073440000500001");      // county 70 already shows
  // Wisconsin: zero padding
  assert.equal(PK.parcelKey("55123", "012-00977-0008"), PK.parcelKey("55123", "12-00977-0008"));
  assert.equal(PK.parcelKey("55135", "08 29 13 02"), PK.parcelKey("55135", "08 29 13 2"));
  assert.notEqual(PK.parcelKey("55047", "251-00403-0500"), PK.parcelKey("55047", "251-00403-0050"));
  assert.equal(PK.parcelKey("55015", "000123456789012345678901"), "55015:123456789012345678901");  // no float rounding
  for (const bad of [["17011", ""], ["17011", "000"], ["1701", "25-14"], [null, "1"]]) assert.equal(PK.parcelKey(...bad), null);
});

test("repeat-sale counts are there for IL, IN and WI and add up", () => {
  const R = json("data/ids/parcel-rules.json").repeat_sales.by_state;
  for (const st of ["IL", "IN", "WI"]) {
    const c = R[st];
    assert.ok(c.market_sales > 1000 && c.parcels > 1000, st);
    assert.ok(c.with_parcel_key <= c.market_sales && c.parcels <= c.with_parcel_key, st);
    assert.ok(c.parcels_sold_2plus > 0 && c.sales_on_those >= 2 * c.parcels_sold_2plus, st);
  }
});

test("size stays small", () => {
  assert.ok(statSync(join(ROOT, "data/ids/elevators.json")).size < 1.5e6);
});

test("no person's name from the land files is anywhere in data/ids", () => {
  // The parcel files carry parcel numbers only. The elevator files carry names from the elevator
  // sources only, so a land-file name may show there only as a facility's own name or a piece of
  // it (a co-op that also bought land is still a business on its own board).
  const grams = (files) => {
    const out = new Set();
    const walk = (v) => {
      if (typeof v === "string") {
        for (const part of v.toUpperCase().split(/[|:]/)) {
          const w = part.split(/\s+/).filter(Boolean);
          for (let i = 0; i < w.length; i++) for (let j = i + 1; j <= w.length; j++) out.add(w.slice(i, j).join(" "));
        }
      } else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => { walk(k); walk(x); });
    };
    files.forEach((f) => walk(json("data/ids/" + f)));
    return out;
  };
  const files = readdirSync(join(ROOT, "data/ids")).filter((f) => f.endsWith(".json"));
  const parcelG = grams(files.filter((f) => /^parcel/.test(f)));
  const elevG = grams(files.filter((f) => !/^parcel/.test(f)));
  const facG = new Set();
  for (const r of EL.elevators) for (const x of [r.name, r.company, ...(r.aliases || [])]) {
    const w = String(x).toUpperCase().split(/\s+/).filter(Boolean);
    for (let i = 0; i < w.length; i++) for (let j = i + 1; j <= w.length; j++) facG.add(w.slice(i, j).join(" "));
  }
  let n = 0;
  for (const st of ["il", "in", "wi"]) {
    for (const f of readdirSync(join(ROOT, "data/land", st)).filter((x) => /^\d{5}\.json$/.test(x))) {
      const d = json(`data/land/${st}/${f}`);
      const gi = d.cols.indexOf("grantor"), ge = d.cols.indexOf("grantee");
      if (gi < 0) continue;
      for (const r of d.rows) {
        for (const v of [r[gi], r[ge]]) {
          const s = String(v || "").toUpperCase().split(/\s+/).filter(Boolean).join(" ");
          if (s.length < 8) continue;
          n++;
          assert.ok(!parcelG.has(s), `a name from ${st}/${f} is in a parcel file`);
          if (elevG.has(s)) assert.ok(facG.has(s), `a name from ${st}/${f} is in an elevator file`);
        }
      }
    }
  }
  assert.ok(n > 1000, "the land files were read");
});
