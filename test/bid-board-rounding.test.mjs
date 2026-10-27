/* SOYBEAN BIDS A CENT HIGH, OCT 24 2026: WHERE IT WAS AND WHERE IT WAS NOT.
 *
 * 50 locations were compared with their own boards on 2026-10-24. Corn matched
 * 50 of 50. Every one of the 33 misses was soybeans, ours +1 cent (Innovative
 * Ag, Agtegra, Central Valley Ag) or +0.5 cent (New Vision, which posts four
 * decimals). The cause was in the bid reader (dnilgis/bids,
 * lib/adapters/agricharts-cashgrid.mjs): it rounded every price half up and
 * ignored the board's own rounding setting. That is fixed there.
 *
 * This side has to print what the reader hands it, digit for digit: a page
 * that rounded 12.065 to 12.07 would put the half cent back. These are the
 * real rows, as the fixed reader computes them.
 *
 *   node --test test/bid-board-rounding.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { window: {} };
vm.runInNewContext(readFileSync(ROOT + "components/util.js", "utf8"), ctx);
const P = ctx.window.AG.px;

/* [board, row, the board's own print, what the fixed reader publishes] */
const ROWS = [
  ["Innovative Ag, ADM Clint (Clinton, IA)", "Oct beans, SX26 1256.5, basis -35, rounding 1", "$12.21", 12.21],
  ["Agtegra, Alpena (SD)", "Oct beans, SX26 1256.5, basis -70, rounding 0.75", "$11.86", 11.86],
  ["New Vision, Brewster (MN)", "Oct beans, SX26 1256.5, basis -50, four decimals", "$12.065", 12.065],
  ["Innovative Ag, ADM Clint (Clinton, IA)", "Oct corn, ZCZ26 456, basis -16", "$4.40", 4.4],
];

test("the bid formatter prints the reader's price as posted, never re-rounded", () => {
  for (const [board, row, shown, cash] of ROWS)
    assert.equal(P.cash(cash), shown, `${board}: ${row}`);
});

test("the page builders' Python twin agrees, digit for digit", () => {
  const py = `import sys, json; sys.path.insert(0, ${JSON.stringify(ROOT + "scripts")}); import pricefmt
print(json.dumps([pricefmt.cash(v) for v in ${JSON.stringify(ROWS.map((r) => r[3]))}]))`;
  const out = JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" }));
  assert.deepEqual(out, ROWS.map((r) => r[2]));
});

test("the town and state page builders keep four decimals of a bid", () => {
  /* round(cash, 2) anywhere on the way to a page would undo the reader fix. */
  for (const f of ["scripts/build_cash_bid_pages.py", "scripts/build_state_basis_pages.py"]) {
    const src = readFileSync(ROOT + f, "utf8");
    assert.doesNotMatch(src, /round\(\s*(float\()?\s*(r\["cash"\]|cash)\)?\s*,\s*2\s*\)/, `${f} rounds a bid to the cent`);
    assert.match(src, /round\(\s*(float\()?\s*(r\["cash"\]|cash)\)?\s*,\s*4\s*\)/, `${f} no longer keeps four decimals`);
  }
});
