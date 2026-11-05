/* Florida farm sales (Nov 5, 2026). The Department of Revenue's sale files, prepared privately and read by
 * scripts/fetch_land_sales.py (fl_recs) into data/land/fl/<fips>.json. Synthetic rows only here
 * (test/fixtures/land-fl): no real parcel and no name.
 *
 *   node --test test/land-fl.test.mjs
 *
 * The county file has the shared columns and says its dates are months; qualified sales and the rest are kept
 * apart the same way in JavaScript and Python; no owner or name field anywhere in the Florida files. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const F = require(path.join(ROOT, "field-scout-land.js"));
const FIX = path.join(ROOT, "test/fixtures/land-fl");
const OWNER = /^(grantor|grantee|own|owner|own_name|own_addr\d?|fidu_name|phy_addr\d?|s_legal|mail)/i;

function built() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "flb-"));
  const code = [
    "import json,sys", "sys.path.insert(0,sys.argv[1])", "import fetch_land_sales as L",
    "L.OUT=sys.argv[3]", "r=L.fl_recs(sys.argv[2],{})", "print(json.dumps(L.build('FL',r,{},'2026-11-05T00:00:00Z')))",
  ].join("\n");
  const r = spawnSync("python3", ["-c", code, path.join(ROOT, "scripts"), FIX, out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return { out, res: JSON.parse(r.stdout.trim().split("\n").pop()) };
}

test("a Florida county file has the shared columns, month dates and no names", () => {
  const { out, res } = built();
  try {
    assert.equal(res.counties, 2);
    const f = JSON.parse(fs.readFileSync(path.join(out, "fl", "12049.json"), "utf8"));
    assert.deepEqual(f.cols.slice(0, 12), ["doc", "date", "price", "acres", "tac", "np", "cls", "conv", "pid", "muni", "legal", "str"]);
    assert.equal(f.state, "FL");
    assert.equal(f.dates, "month", "the files give the month of a sale, not the day");
    assert.equal(f.names, false);
    for (const r of f.rows) assert.match(r[1], /^\d{4}-\d{2}-01$/);
    assert.ok(!f.cols.some((c) => OWNER.test(c)), f.cols.join(" "));
    assert.ok(!fs.existsSync(path.join(out, "names", "fl", "12049.json")) || !/FX-/.test(fs.readFileSync(path.join(out, "names", "fl", "12049.json"), "utf8")));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test("qualified and other sales are kept apart the same way in JavaScript and Python", () => {
  const { out } = built();
  try {
    const p = path.join(out, "fl", "12049.json"), f = JSON.parse(fs.readFileSync(p, "utf8")), today = "2026-11-05";
    const js = F.saleRows(F.rowObjs(f), today).map((r) => [r.doc, String(r.date || "").slice(0, 10), Math.round(F.num(r.price) || 0), F.num(r.acres), r.ppa, F.marketSale(r, today), F.statOK(r), r.grp || 1]);
    const r = spawnSync("python3", [path.join(ROOT, "scripts/build_land_summary.py"), "--rule", p, today], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(js, JSON.parse(r.stdout)[0]);
    const pid = f.cols.indexOf("pid"), conv = f.cols.indexOf("conv");
    const market = new Map(f.rows.map((row, i) => [row[pid], F.marketSale(F.rowObjs(f)[i], today)]));
    assert.deepEqual(Object.fromEntries(market), { "FX-001": true, "FX-002": false, "FX-003": true, "FX-004": true, "FX-005": false, "FX-006": false, "FX-007": true, "FX-008": true });
    for (const row of f.rows) {
      const q = /^Qualified sale, Florida code 0[12]:/.test(row[conv]);
      assert.equal(q, !F.NON_MARKET.test(String(row[conv]).toUpperCase()), row[conv]);
    }
    const timber = F.rowObjs(f).find((o) => o.pid === "FX-003"), bldg = F.rowObjs(f).find((o) => o.pid === "FX-004");
    assert.equal(F.landType(timber, "FL"), "forest", "timberland stays out of the farm middle");
    assert.equal(F.landType(bldg, "FL"), "bldg", "a price with buildings stays out of the farm middle");
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test("no owner, address or name field in any Florida file the site carries", () => {
  const dirs = [FIX, path.join(ROOT, "data/land/fl")].filter((d) => fs.existsSync(d));
  for (const d of dirs) for (const n of fs.readdirSync(d).filter((x) => /^12\d{3}\.json$/.test(x))) {
    const f = JSON.parse(fs.readFileSync(path.join(d, n), "utf8"));
    assert.ok(!f.names, n);
    assert.ok(!(f.cols || []).some((c) => OWNER.test(c)), d + "/" + n + ": " + (f.cols || []).join(" "));
  }
  assert.ok(!fs.existsSync(path.join(ROOT, "data/land/names/fl")), "Florida's files carry no buyer or seller, so no names file");
  const src = fs.readFileSync(path.join(ROOT, "scripts/fetch_land_sales.py"), "utf8");
  const fl = src.slice(src.indexOf("FL_SRC = "), src.indexOf("def refiled_dedupe"));
  assert.ok(!/OWN_NAME|OWN_ADDR|FIDU_|PHY_ADDR|S_LEGAL/.test(fl), "the Florida reader never names an owner, address or legal column of the roll");
});
