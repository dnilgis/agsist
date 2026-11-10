/* One misread-board check (god's-eye build 5, Nov 9 2026): basis_method.futures_disagree, used by
 * fetch_bids.verify_bids (bids.json `verified`), build_state_basis_pages.flag_futures_disagreement (fut_off)
 * and build_cash_bid_pages.drop_misreads. Before, each carried its own copy, and bids.json trusted every
 * network row the other two could drop.
 *
 *   node --test test/misread-board.test.mjs
 *
 * Real case: Nutrition Service Co., Riceville IA, soybeans +$1.40 on ZSF27 (cash 13.28; the same board
 * topped Iowa's strongest list on 2026-10-09 at +$1.40 against a -$0.63 middle). Its cash minus basis is
 * 11.88, what every other board on ZSF27 implies (data/bids.json, Nov 9 2026). It is NOT a misread board,
 * so all three keep it; its basis is far from the others, which is basisOdd (robust_split), a separate
 * question. The same row with the basis misread as +$0.40 implies 12.88, 8% off: all three drop it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// the Nov 9 ZSF27 rows: Riceville, then six other boards, as data/bids.json carried them
const BOARDS = [
  ["Nutrition Service Co. LLC", "Riceville", "IA", 13.28, 1.40],
  ["Dunkerton Co-op", "Cedar Rapids", "IA", 11.68, -0.20],
  ["Mid-Iowa Cooperative", "Iowa Falls", "IA", 11.68, -0.20],
  ["Nexus Cooperative", "Iowa Falls", "IA", 11.63, -0.25],
  ["Innovative Ag Services", "Dubuque", "IA", 11.55, -0.33],
  ["Heartland Co-op", "Council Bluffs", "IA", 11.08, -0.80],
  ["Farmers Elevator & Exchange, Inc.", "Cedar Rapids", "IA", 11.68, -0.20],
];

function verdicts(rice) {
  const boards = BOARDS.map((b, i) => (i === 0 ? [b[0], b[1], b[2], rice.cash, rice.basis] : b));
  const py = `import sys, json, collections
sys.path.insert(0, ${JSON.stringify(join(ROOT, "scripts"))})
import basis_method as BM, fetch_bids as FB, build_state_basis_pages as SB, build_cash_bid_pages as CB
B = json.loads(${JSON.stringify(JSON.stringify(boards))})
con = ("ZS", 0, 2027)
# fetch_bids: network rows as bids.json carries them
fb = [{"facility": f, "city": c, "state": s, "commodity": "Soybeans", "symbol": "ZSF27", "cashPrice": cash,
       "basis": basis, "category": "soybeans", "source": "network", "deliveryMonth": "11/01/2026"} for f, c, s, cash, basis in B]
FB.verify_bids(fb)
# state basis pages: one row per board
sb = [{"source": f"s{i}", "group": "soybeans", "crop": "soybeans", "contract": con, "cash": b[3], "basis": b[4]} for i, b in enumerate(B)]
SB.flag_futures_disagreement(sb)
# cash bid pages: towns of boards of rows
towns = {f"t{i}": {"boards": {"b": {"rows": [{"contract": con, "cash": b[3], "basis": b[4], "i": i}],
                                     "why": collections.Counter()}}} for i, b in enumerate(B)}
drops = collections.Counter()
CB.drop_misreads(towns, drops)
kept = {r["i"] for t in towns.values() for r in t["boards"]["b"]["rows"]}
one = BM.futures_disagree(sb, lambda r: r["contract"], lambda r: r["cash"] - r["basis"])
print(json.dumps({"fb": [not r["verified"] for r in fb], "odd": [bool(r.get("basisOdd")) for r in fb],
                  "sb": [r["fut_off"] for r in sb], "cb": [i not in kept for i in range(len(B))],
                  "bm": [id(r) in one for r in sb], "why": fb[0].get("unverifiedWhy"), "drops": drops["implied_futures_disagrees"]}))`;
  return JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" }));
}

test("misread board: Riceville +$1.40 implies the right futures, kept everywhere, flagged basisOdd only", () => {
  const v = verdicts({ cash: 13.28, basis: 1.40 });
  const none = BOARDS.map(() => false);
  assert.deepEqual(v.bm, none, "futures_disagree: nobody misread");
  assert.deepEqual(v.fb, none, "fetch_bids: every row verified");
  assert.deepEqual(v.sb, none, "state basis pages: no fut_off");
  assert.deepEqual(v.cb, none, "cash bid pages: no row dropped");
  assert.equal(v.odd[0], true, "Riceville is still basisOdd (far from the Iowa middle), a separate question");
});

test("misread board: the same board with its basis misread as +$0.40 is dropped by all three, the same verdict", () => {
  const v = verdicts({ cash: 13.28, basis: 0.40 });
  const only = BOARDS.map((_, i) => i === 0);
  assert.deepEqual(v.bm, only);
  assert.deepEqual(v.fb, only, "fetch_bids: Riceville not verified");
  assert.deepEqual(v.sb, only, "state basis pages: fut_off");
  assert.deepEqual(v.cb, only, "cash bid pages: dropped");
  assert.equal(v.drops, 1);
  assert.match(v.why, /implies 12\.88 for ZSF27, more than 3% off the 11\.88 the 7 network bids/);
});

test("misread board: one copy of the rule, every caller goes through it", () => {
  assert.match(read("scripts/basis_method.py"), /^def futures_disagree\(/m);
  assert.match(read("scripts/fetch_bids.py"), /_bm\.futures_disagree\(/);
  assert.match(read("scripts/build_state_basis_pages.py"), /= futures_disagree\(rows,/);
  assert.match(read("scripts/build_cash_bid_pages.py"), /BM\.futures_disagree\(allrows,/);
  // the old inline copy: a median per contract and a 3% relative test, written out by hand
  for (const p of ["scripts/fetch_bids.py", "scripts/build_state_basis_pages.py", "scripts/build_cash_bid_pages.py"])
    assert.doesNotMatch(read(p), /\/\s*m\s*-\s*1\)\s*>\s*tol/, `${p} carries its own cash minus basis vs median test`);
});
