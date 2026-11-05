/* Florida farm sales (Nov 5, 2026). The Department of Revenue's sale files, prepared privately and read by
 * scripts/fetch_land_sales.py (fl_recs) into data/land/fl/<fips>.json. Synthetic rows only here
 * (test/fixtures/land-fl): no real parcel and no name.
 *
 *   node --test test/land-fl.test.mjs
 *
 * The county file has the shared columns and says its dates are months; qualified sales and the rest are kept
 * apart the same way in JavaScript and Python; no owner or name field anywhere in the Florida files; a month-only date
 * reads as a month (never a day) in Field Scout and the comp report; Florida is served from agsist-data and stays out of
 * every reader until each one shows month dates (an explicit allow-list). */
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
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

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

test("Florida is served from agsist-data and on in every reader now that each shows month dates (Nov 5)", () => {
  assert.equal(F.salesLive("FL"), true);
  assert.equal(F.landBase("FL"), "https://dnilgis.github.io/agsist-data/land/fl/");
  assert.equal(F.landBase("IL"), "/data/land/il/");
  for (const st of ["IL", "IN", "WI", "VT", "NJ", "FL"]) assert.ok(F.salesLive(st), st);
  assert.match(read("components/comp-report.js"), /\.filter\(function \(st\) \{ return !F\.salesLive \|\| F\.salesLive\(st\); \}\)/);
  for (const [file, rx] of [["components/land-sales.js", /var STATES = \{[^}]*\}/], ["components/search.js", /var LAND_ST = \{[^}]*\}/],
    ["components/change-lines.js", /var SALES_STATES = \{[^}]*\}/], ["components/atlas-sales.js", /S\.STATES = \{[^}]*\}/],
    ["scripts/build_land_sales.py", /^STATES = \([^)]*\)/m]]) {
    const m = read(file).match(rx);
    assert.ok(m, file);
    assert.match(m[0], /\bFL\b/, file + " reads Florida");
  }
  // the farmland index is a quarterly index of named-buyer states with their own start years; Florida is not in it
  assert.doesNotMatch(read("scripts/build_land_index.py").match(/^STATES = \{[^\n]*/m)[0], /\bFL\b/);
  const code = "import sys\nsys.path.insert(0,sys.argv[1])\nimport land_alert as A, build_land_summary as B\nprint('FL' in A.STATES, 'FL' in B.SOURCES, B.HOSTED)";
  const r = spawnSync("python3", ["-c", code, path.join(ROOT, "scripts")], { encoding: "utf8" });
  assert.equal(r.stdout.trim(), "True True ('FL',)", r.stderr);
  const fl = path.join(ROOT, "data/land/fl");
  assert.ok(!fs.existsSync(fl) || !fs.readdirSync(fl).some((n) => /^12\d{3}(-\d{4})?\.json$/.test(n)), "Florida's county files are never in this repository (only its summary)");
  assert.ok(!fs.existsSync(path.join(ROOT, "data/land-hosted")) || !spawnSync("git", ["ls-files", "data/land-hosted"], { cwd: ROOT, encoding: "utf8" }).stdout.trim(), "the linked agsist-data copy is never committed");
  assert.match(read(".gitignore"), /^\/data\/land-hosted$/m);
  const wf = read(".github/workflows/land-data.yml");
  assert.match(wf, /fetch_land_sales\.py FL --from data\/land-src\/fl --to "\$RUNNER_TEMP\/agsist-data\/land"/);
  assert.match(wf, /agsist_data\.sh sync --soft --from "\$RUNNER_TEMP\/agsist-data" land\/fl/);
  assert.match(wf, /ln -sfn "\$RUNNER_TEMP\/agsist-data\/land" data\/land-hosted/);
  assert.match(wf, /rm -f data\/land-hosted/, "the link is gone before the site budget and the commit");
  assert.ok(wf.indexOf("ln -sfn") < wf.indexOf("land-summaries") && wf.indexOf("ln -sfn") < wf.indexOf("land-pages"), "linked before the summaries and the pages");
  assert.doesNotMatch(wf, /fetch_land_sales\.py MN IL IN VT NJ FL/);
  assert.match(read(".github/workflows/land-alert.yml"), /ln -sfn "\$RUNNER_TEMP\/agsist-data\/land" data\/land-hosted/);
});
