/* Stitched basis histories (Oct 27, 2026, fx/basisstitch). When the bids repo folded one board into another,
 * build_ids retired the folded id and its basis-history key moved to the survivor, so the survivor held two
 * keys (the folded board's spelling and its own) and the basis join left it out. The ids ledger now records
 * which keys each retired id held (data/ids/elevator-ids.json retired.<id>.keys); scripts/build_basis_join.py
 * joins the survivor's own key and lists the folded keys under "s"; components/place.js reads the folded
 * name's rows as the same elevator's earlier history. Real cases only: Tremont Co-operative (Delavan folded
 * into Toboggan), Mid-Iowa Cooperative (Earlville into Klostermann), NuGen Marion; Mercer Landmark Coldwater
 * stays out (its second key came with an AGSIST id merge, not a fold).
 *   node --test test/basis-stitch.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const P = require(ROOT + "components/place.js");
const J = (p) => JSON.parse(fs.readFileSync(ROOT + p, "utf8"));
const R = (cur, prev, since, first, last) => ({ cur, prev, since, first, last });

test("the ledger records the keys each retired id held, and the join stitches only those", () => {
  const led = J("data/ids/elevator-ids.json");
  const ret = led.retired;
  assert.ok(Object.keys(ret).length >= 141);
  // every Oct 27 retirement carries its keys, and each of those keys now holds the survivor
  for (const [rid, r] of Object.entries(ret)) {
    assert.ok(Array.isArray(r.keys) && r.keys.length, rid + " has no keys");
    for (const k of r.keys) assert.equal(led.keys[k], r.into, k);
  }
  assert.deepEqual(ret.eetwt0affq.keys, ["basis:SD|NUGEN ENERGY, LLC|MARION", "dir:52414"]);
  assert.equal(ret.eetwt0affq.into, "e011hgtdgf");
  assert.deepEqual(ret.ek7ttxkphd.keys, ["basis:IA|MID-IOWA COOPERATIVE|EARLVILLE"]);

  execFileSync("python3", [ROOT + "scripts/build_basis_join.py", "--check"], { stdio: "pipe" });
  const sd = J("data/ids/basis-join/SD.json"), oh = J("data/ids/basis-join/OH.json");
  assert.equal(sd.k.e011hgtdgf, "SD|NUGEN ENERGY, LLC|NUGEN MARION");
  assert.deepEqual(sd.s.e011hgtdgf, ["SD|NUGEN ENERGY, LLC|NUGEN MARION", "SD|NUGEN ENERGY, LLC|MARION"]);
  assert.equal(oh.multi.e0ykb4h2tx, 2, "Mercer Landmark Coldwater: an AGSIST id merge, not a fold, stays out");
  assert.equal(oh.k.e0ykb4h2tx, undefined);

  // every stitched id: its first key is its join key and is no retired board's; every other key is a retired
  // board's that folded into this id, one key per board, all in one state
  const byKey = {};
  for (const [rid, r] of Object.entries(ret)) for (const k of r.keys) if (k.startsWith("basis:")) byKey[k.slice(6)] = [rid, r.into];
  const idx = J("data/ids/basis-join/index.json");
  let n = 0;
  for (const st of idx.states) {
    const j = J("data/ids/basis-join/" + st + ".json");
    for (const [id, keys] of Object.entries(j.s || {})) {
      n++;
      assert.equal(j.k[id], keys[0], id);
      assert.equal(j.multi[id], undefined, id);
      assert.equal(byKey[keys[0]], undefined, id + " own key is a retired board's");
      const boards = keys.slice(1).map((k) => byKey[k]);
      for (const b of boards) assert.ok(b && b[1] === id, id + " stitched a key no fold gave it");
      assert.equal(new Set(boards.map((b) => b[0])).size, boards.length, id);
      assert.equal(new Set(keys.map((k) => k.split("|")[0])).size, 1, id);
    }
  }
  assert.equal(n, idx.counts.stitched);
  assert.equal(idx.counts.joined + idx.counts.multi, idx.counts.with_history);
  // measured Oct 27 on the ids of that day: 2,396 joined before, 93 survivors rejoin, 30 joined ones gain their folded history
  assert.ok(idx.counts.stitched >= 100, "stitched " + idx.counts.stitched);
});

test("one delivery month, three spellings; a two-month or mid-month delivery matches only itself", () => {
  for (const d of ["FEB27", "FEB-27", "02/01/2027", "01 FEB 2027 TO 28 FEB 2027"]) assert.equal(P.basisMonth(d), "2027-02", d);
  assert.equal(P.basisMonth("JULY-27"), "2027-07");
  assert.equal(P.basisMonth("JUL 2027"), "2027-07");
  for (const d of ["OCT/NOV-26", "10/16/2026", "01 OCT 2026 TO 15 NOV 2026", "", null]) assert.equal(P.basisMonth(d), null, String(d));
});

test("the outcomes on real row pairs (data/basis, Oct 27; survivor row first)", () => {
  // Tremont: Delavan (folded) OCT26 seen Oct 9 to 11, Toboggan "OCT 2026" from Oct 18: no common day, replayed
  assert.deepEqual(P.basisStitch(R(-35, -37, "2026-10-23", "2026-10-18", "2026-10-27"), R(-37, null, "2026-10-09", "2026-10-09", "2026-10-11")),
    { row: R(-35, -37, "2026-10-23", "2026-10-09", "2026-10-27"), how: "joined" });
  // the change across the gap is dated the newer name's first day
  assert.deepEqual(P.basisStitch(R(-30, null, "2026-10-18", "2026-10-18", "2026-10-27"), R(-37, null, "2026-10-09", "2026-10-09", "2026-10-11")).row,
    R(-30, -37, "2026-10-18", "2026-10-09", "2026-10-27"));
  // Mid-Iowa: Earlville JAN27 from Jun 9, last changed Sep 16; Klostermann 01/01/2027 from Sep 22 at the same -38
  assert.deepEqual(P.basisStitch(R(-38, null, "2026-09-22", "2026-09-22", "2026-10-27"), R(-38, 38, "2026-09-16", "2026-06-09", "2026-10-11")),
    { row: R(-38, 38, "2026-09-16", "2026-06-09", "2026-10-27"), how: "overlap_agree" });
  // Farmers Win: Waverly NOV26 at -53 to Oct 11, Bremer at -60 on the same days: the survivor's row as it is
  const fw = R(-65, -60, "2026-10-27", "2026-09-22", "2026-10-27");
  assert.deepEqual(P.basisStitch(fw, R(-53, -52, "2026-09-10", "2026-06-09", "2026-10-11")), { row: fw, how: "overlap_disagree" });
  // Dunkerton: the folded name changed inside the common days; then a survivor seen first
  const dk = R(-1, 0, "2026-09-28", "2026-09-22", "2026-10-01");
  assert.deepEqual(P.basisStitch(dk, R(-100, 0, "2026-09-28", "2026-09-09", "2026-09-30")), { row: dk, how: "overlap_unknown" });
  const dk2 = R(-25, -23, "2026-10-22", "2026-10-02", "2026-10-27");
  assert.deepEqual(P.basisStitch(dk2, R(-26, null, "2026-10-02", "2026-10-02", "2026-10-11")), { row: dk2, how: "survivor_first" });
});

test("what the page says for a stitched id: its own history reaches back through the folded name", () => {
  const sh = { state: "IA", c: ["corn", "soybeans", "wheat", "other"], f: ["MID-IOWA COOPERATIVE|KLOSTERMANN", "MID-IOWA COOPERATIVE|EARLVILLE"],
    d: ["2026-06-09", "2026-09-16", "2026-09-22", "2026-10-11", "2026-10-27"],
    r: [[0, 0, "ZCH27", "01/01/2027", -38, null, 2, 2, 4], [1, 0, "ZCH27", "JAN27", -38, -40, 1, 0, 3], [1, 0, "ZCH27", "FEB27", -36, null, 0, 0, 3]] };
  const m = P.basisHistMap(sh), keys = ["IA|MID-IOWA COOPERATIVE|KLOSTERMANN", "IA|MID-IOWA COOPERATIVE|EARLVILLE"];
  // own key alone: seen since Sep 22, unchanged
  assert.deepEqual(P.basisHistory(m, keys[0], "corn", "ZCH27", "01/01/2027", -38, "2026-10-27"), { status: "ok", kind: "same", first: "2026-09-22" });
  // stitched: since Jun 9, and the Sep 16 change the folded name saw
  assert.deepEqual(P.basisHistory(m, keys, "corn", "ZCH27", "01/01/2027", -38, "2026-10-27"), { status: "ok", kind: "moved", date: "2026-09-16", from: -40, first: "2026-06-09" });
  // a one-key array reads as the key
  assert.deepEqual(P.basisHistory(m, [keys[0]], "corn", "ZCH27", "01/01/2027", -38, "2026-10-27"), P.basisHistory(m, keys[0], "corn", "ZCH27", "01/01/2027", -38, "2026-10-27"));
  assert.equal(P.basisHistory(m, [], "corn", "ZCH27", "01/01/2027", -38, "2026-10-27").status, "none");
  // a delivery the folded name never posted: the own row only
  assert.deepEqual(P.basisSeries(m, keys, "corn", "ZCH27", "03/01/2027"), { row: null, hows: ["no_match"] });
  // the page reads s before k
  assert.match(fs.readFileSync(ROOT + "components/here.js", "utf8"), /\(join\.s && join\.s\[r\.elevId\]\) \|\| \(join\.k && join\.k\[r\.elevId\]\)/);
});

test("the page and the build stitch every real contract the same way", () => {
  const dump = JSON.parse(execFileSync("python3", [ROOT + "scripts/build_basis_join.py", "--stitch-dump"], { maxBuffer: 64 << 20 }).toString());
  const maps = {}, joins = {};
  let n = 0, older = 0;
  for (const [st, id, ck, row, hows] of dump) {
    if (!ck) continue;
    maps[st] = maps[st] || P.basisHistMap(J("data/basis/" + st + ".json"));
    joins[st] = joins[st] || J("data/ids/basis-join/" + st + ".json");
    const got = P.basisSeries(maps[st], joins[st].s[id], ck[0].toLowerCase(), ck[1], ck[2]);
    assert.deepEqual(got, { row, hows }, `${st} ${id} ${ck.join(" ")}`);
    n++;
    if (hows.some((h) => h === "joined" || h === "overlap_agree")) older++;
  }
  assert.ok(n >= 1000, "contracts compared: " + n);
  assert.ok(older >= 100, "contracts with older rows stitched on: " + older);
  console.log(`# basis stitch: ${n} contracts of ${Object.values(joins).reduce((a, j) => a + Object.keys(j.s).length, 0)} stitched ids agree; ${older} reach back through a folded name`);
});
