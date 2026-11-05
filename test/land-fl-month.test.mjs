/* Florida's month-only sale dates (Nov 5, 2026): the state gives the sale month, not the day, so a county file with
 * dates "month" reads as a month everywhere Field Scout and the comp report show it, never a first-of-month day.
 * Synthetic rows only (test/fixtures/land-fl), built by scripts/fetch_land_sales.py into a temporary folder.
 *
 *   node --test test/land-fl-month.test.mjs
 */
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
const CR = require(path.join(ROOT, "components/comp-report.js"));
const FIX = path.join(ROOT, "test/fixtures/land-fl");

function built() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "flm-"));
  const code = [
    "import json,sys", "sys.path.insert(0,sys.argv[1])", "import fetch_land_sales as L",
    "L.OUT=sys.argv[3]", "r=L.fl_recs(sys.argv[2],{})", "print(json.dumps(L.build('FL',r,{},'2026-11-05T00:00:00Z')))",
  ].join("\n");
  const r = spawnSync("python3", ["-c", code, path.join(ROOT, "scripts"), FIX, out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return { out };
}

test("a month-only date reads as a month in Field Scout and the comp report, never a day", () => {
  assert.equal(F.fmtDate("2025-08-01", 1), "Aug 2025");
  assert.equal(F.fmtDate("2025-08-01"), "Aug 1, 2025", "other states keep their day");
  const { out } = built();
  try {
    const f = JSON.parse(fs.readFileSync(path.join(out, "fl", "12049.json"), "utf8")), today = "2026-11-05";
    const rows = F.rowObjs(f);
    assert.ok(rows.every((r) => r.dm === 1));
    const cov = F.covOf(f);
    assert.equal(cov.dates, "month");
    assert.match(F.coverageText(cov, "FL"), /^Sales from Feb 2025 to Aug 2025, by month/);
    const hist = F.historyHTML(rows.map((r) => ({ r, how: "parcel" })), cov, { detail: true });
    assert.match(hist, /Aug 2025/);
    assert.doesNotMatch(hist, /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, 20\d\d/, "no day in Field Scout's list");
    const detail = F.saleDetailHTML(rows[0], f, rows.slice(1).map((r) => ({ r })));
    assert.doesNotMatch(detail, /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) 1, 20\d\d/, "no first-of-month day in the detail panel (the read date keeps its day)");
    assert.match(detail, /Aug 2025/);
    const once = F.saleRows(rows, today);
    assert.equal(once.length, rows.length - 1, "one row per deed (two parcels of one deed once), and month dates never group deeds by day");
    assert.ok(once.every((r) => !r.grp));
    const list = once.map((r, i) => Object.assign(r, { no: i + 1, mi: 1 }));
    const comps = CR.compsHTML(list, false, today);
    assert.match(comps, /Aug 2025/);
    assert.doesNotMatch(comps, /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, 20\d\d/, "no day in the comp report rows");
    const s = CR.summary(list.map((r) => Object.assign({}, r, { acres: 40, ppa: 10000, cls: "4" })));
    const sum = CR.summaryHTML(s, { matched: list.length, listed: list.length, sort: "mi", newest: "2025-08-01", newestDm: true });
    assert.match(sum, /dated Feb 2025 to Aug 2025, newest sale in our copy Aug 2025/);
    const csv = CR.csv(list.slice(0, 1), false, today).split("\r\n")[1];
    assert.match(csv, /^1,2025-08,/, "the spreadsheet keeps the month, not a first-of-month day");
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

