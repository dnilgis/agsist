/* scripts/check_prf_rma.mjs must be able to tell agreement from a difference.
 *
 * It normally asks RMA's live service. Here it is run with --replay, which
 * serves RMA's saved answers for grid 30152, against a one-grid build made from
 * the same saved rows (scripts/fetch_prf.py --fixture). First as built: every
 * policy must agree. Then with one premium rate, one base value and one index
 * value changed in the files: each must be reported and the exit code must be 1.
 *
 *   node --test test/prf-check.test.mjs      (needs python3 for the fixture build)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FIX = "test/fixtures/prf/rma-30152.json";

function build() {
  const dir = mkdtempSync(join(ROOT, ".prf-check-"));
  const r = spawnSync("python3", ["scripts/fetch_prf.py", "--fixture", dir], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return dir;
}
function check(dir) {
  const r = spawnSync("node", ["scripts/check_prf_rma.mjs", "--dir", relative(ROOT, dir), "--replay", FIX], { cwd: ROOT, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr, json: JSON.parse(readFileSync(join(dir, "check.json"), "utf8")) };
}
const u16 = (b64) => { const b = Buffer.from(b64, "base64"); return Array.from({ length: b.length / 2 }, (_, i) => b.readUInt16LE(2 * i)); };
const pack = (a) => Buffer.from(new Uint16Array(a).buffer).toString("base64");

const clean = build();
const made = [clean];
process.on("exit", () => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
const copy = () => { const d = mkdtempSync(join(ROOT, ".prf-check-")); cpSync(clean, d, { recursive: true }); made.push(d); return d; };

test("as built from RMA's rows, all eight saved policies agree to the dollar", () => {
  const r = check(clean);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.asked, 8);
  assert.equal(r.json.reached, 8);
  assert.equal(r.json.agreed, 8);
});

test("one premium rate off by a ten-thousandth is caught", () => {
  const d = copy(), p = join(d, "g", "100_7.json"), doc = JSON.parse(readFileSync(p, "utf8"));
  const r = u16(doc.g["30152"].r);
  r[4 * 11 + 3] += 1;                       /* 90%, Apr-May: 0.1119 -> 0.1120 */
  doc.g["30152"].r = pack(r);
  writeFileSync(p, JSON.stringify(doc));
  const res = check(d);
  assert.equal(res.code, 1, res.out);
  assert.ok(res.out.includes("rate Apr-May"), res.out);
  assert.ok(res.json.agreed < res.json.reached);
});

test("a county base value off by a dime is caught", () => {
  const d = copy(), p = join(d, "s", "WI.json"), doc = JSON.parse(readFileSync(p, "utf8"));
  doc.counties["005"].b[0] += 0.1;          /* grazing */
  writeFileSync(p, JSON.stringify(doc));
  const res = check(d);
  assert.equal(res.code, 1, res.out);
  assert.ok(res.out.includes("county base value"), res.out);
});

test("one index value off by a thousandth is caught", () => {
  const d = copy(), p = join(d, "g", "100_7.json"), doc = JSON.parse(readFileSync(p, "utf8"));
  const h = u16(doc.g["30152"].h);
  h[(2023 - doc.y0) * 11 + 3] += 1;         /* Apr-May 2023: 0.708 -> 0.709 */
  doc.g["30152"].h = pack(h);
  writeFileSync(p, JSON.stringify(doc));
  const res = check(d);
  assert.equal(res.code, 1, res.out);
  assert.ok(res.out.includes("index Apr-May 2023"), res.out);
});
