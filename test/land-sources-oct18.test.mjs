/* Land sources batch (Oct 18, 2026): more states searched for free public parcel
   services, owner names split into parts, services whose terms forbid reuse refused,
   and transfer sources saved by the probe but never built before a parser exists. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);
const F = require(join(ROOT, "field-scout-land.js"));
const REG = JSON.parse(read("data/land/parcel-services.json"));

test("an owner split into name parts reads as one name on one line", () => {
  const svc = { fields: { pid: ["PIN"], owner: ["OwnerLastName"], owner_parts: ["OwnerFirstName", "OwnerMiddleInit", "OwnerLastName"] } };
  const p = F.parseParcel({ PIN: "1", OwnerFirstName: "SAMPLE", OwnerMiddleInit: "Q", OwnerLastName: "FARMER" }, svc);
  assert.deepEqual(p.owner, ["SAMPLE Q FARMER"]);
  const q = F.parseParcel({ PIN: "1", OwnerFirstName: "", OwnerMiddleInit: null, OwnerLastName: "SAMPLE FARMS LLC" }, svc);
  assert.deepEqual(q.owner, ["SAMPLE FARMS LLC"]);           // a business in the last-name field, no stray spaces
  assert.equal(F.parseParcel({ PIN: "1" }, svc).owner, null); // nothing filled, no owner shown
});

test("probe selftests pass (field names from saved layers, state catalogs, refused services)", () => {
  const out = execFileSync("python3", [join(ROOT, "scripts/probe_land_services.py"), "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /^FAILS=0$/m, out.split("\n").filter((l) => l.startsWith("FAIL")).join("\n"));
});

test("registry: new states carry county totals, refused services name why, candidates are https and not verified by hand", () => {
  const py = read("scripts/probe_land_services.py");
  for (const [st, n] of Object.entries({ ND: 53, SD: 66, NE: 93, IN: 92, OH: 88, KS: 105, MO: 115, MI: 83 })) assert.match(py, new RegExp(`"${st}": ${n}\\b`));
  const D = REG.discover;
  assert.ok(D.refused.length >= 1);
  for (const r of D.refused) { assert.match(r.url, /^https:\/\//); assert.ok(r.why && r.why.length > 20, r.url); }
  assert.ok(D.refused.some((r) => /giscat\.ne\.gov/.test(r.url)), "Nebraska's internal-use statewide file is refused");
  for (const c of D.candidates) { assert.match(c.url, /^https:\/\//); assert.ok(!("verified" in c), c.url); }
  for (const c of D.candidates.filter((c) => c.terms)) assert.ok(c.terms.length > 10);
  // nothing refused sits in the registry as a working service
  const all = [].concat(...Object.values(REG.statewide), ...Object.values(REG.counties || {}));
  for (const s of all) for (const r of D.refused) assert.ok(!s.url.toLowerCase().startsWith(r.url.toLowerCase()), s.url);
  assert.equal(D.service_roots.MN[0].folder_prefix, "us_mn_co_");
});

test("sales notes for the new states say what is and is not free, no guesses", () => {
  for (const st of ["IN", "NE", "KS", "SD", "ND", "OH", "MI", "MO"]) {
    const t = REG.salesNote[st];
    assert.ok(t && t.length > 40, st);
    assert.doesNotMatch(t, /—|estimat|likely|probabl/i, st);
  }
  assert.match(REG.salesNote.NE, /request/);
});

test("transfer probe-only states are saved by the probe and never built", () => {
  const out = execFileSync("python3", [join(ROOT, "scripts/fetch_land_sales.py"), "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /ok\s+probe-only states \(IA, SD, OH\) are never built/);
  // Indiana got its parser (Oct 18, read against the saved SDF_2026.zip): its checks run in the same selftest
  for (const t of ["IN: money read with two implied decimals", "IN: a file whose fee in dollars is refused", "IN: a file whose acres in whole acres is refused", "IN: farm forms only"]) assert.match(out, new RegExp("^ok\\s+" + t, "m"), t);
  assert.match(out, /^FAILS=0$/m);
  const y = read(".github/workflows/land-data.yml");
  assert.match(y, /discover:\*\) python scripts\/probe_land_services\.py "--discover=/);
  assert.match(y, /fetch_land_sales\.py MN IL IN\b/, "the build step builds only states with a checked parser");
  assert.equal((y.match(/cron:/g) || []).length, 1, "no new schedule");
});

test("no em dashes in the new copy", () => {
  for (const f of ["data/land/parcel-services.json", "scripts/probe_land_services.py", "scripts/fetch_land_sales.py", "field-scout-land.js"]) assert.doesNotMatch(read(f), /—/, f);
});
