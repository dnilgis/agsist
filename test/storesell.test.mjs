/* The homepage "Store or sell?" posted carry (components/storesell.js).
 *
 * The shipped file is run in a bare context (no document), which loads only
 * its pure parts, so a green run checks the copy the browser runs.
 *
 *   node --test test/storesell.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { window: {} };
/* util.js first, as the page loads it: storesell prints through AG.px. */
vm.runInNewContext(readFileSync(ROOT + "components/util.js", "utf8"), ctx);
vm.runInNewContext(readFileSync(ROOT + "components/storesell.js", "utf8"), ctx);
const S = ctx.window.AgsistStoreSell;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

/* Badger Grain Supply, Wheeler WI, corn, as posted 2026-10-09. */
const BADGER = [
  ["2026-10", 4.38], ["2026-11", 4.38], ["2026-12", 4.5], ["2027-01", 4.55], ["2027-02", 4.57],
  ["2027-03", 4.65], ["2027-04", 4.68], ["2027-05", 4.7], ["2027-06", 4.74], ["2027-07", 4.74],
].map(([k, c]) => ({ start: k, end: k, cash: c }));

test("carry is each later posted bid minus the nearest one, months from the nearest month", () => {
  const m = S.buildPeriods(BADGER, "corn");
  assert.equal(m.spot.start, "2026-10");
  assert.equal(m.later.length, 9);
  const mar = m.later.find((p) => p.key === "2027-03");
  near(mar.carry, 0.27, "Mar carry");
  assert.equal(mar.months, 5);
  const nov = m.later.find((p) => p.key === "2026-11");
  near(nov.carry, 0, "Nov carry");
  assert.equal(nov.months, 1);
});

test("net = carry - storage x months - interest on spot - shrink on later bid", () => {
  const m = S.buildPeriods(BADGER, "corn");
  const mar = m.later.find((p) => p.key === "2027-03");
  const n = S.netFor(mar, m.spot.cash, { cost: 0.03, rate: 7.5, shrink: 1 });
  near(n.storage, 0.15, "storage");
  near(n.interest, 4.38 * 0.075 * 5 / 12, "interest");
  near(n.shrink, 0.0465, "shrink");
  near(n.net, 0.27 - 0.15 - 0.136875 - 0.0465, "net");
  assert.equal(S.netText(n.net), "−6¢");
});

test("a blank optional box is left out, a blank storage cost gives no net", () => {
  const m = S.buildPeriods(BADGER, "corn");
  const mar = m.later.find((p) => p.key === "2027-03");
  const a = S.netFor(mar, m.spot.cash, { cost: 0.02, rate: null, shrink: null });
  near(a.net, 0.27 - 0.1, "net without interest or shrink");
  assert.equal(a.interest, 0);
  const b = S.netFor(mar, m.spot.cash, { cost: null, rate: 7, shrink: 1 });
  assert.equal(b.net, null);
  assert.match(S.headline(m, mar, { cost: null, rate: null, shrink: null }, "Badger"), /Enter your storage cost/);
});

test("headline says nets or loses, in cents, and names what was not counted", () => {
  const m = S.buildPeriods(BADGER, "corn");
  const mar = m.later.find((p) => p.key === "2027-03");
  assert.equal(S.headline(m, mar, { cost: 0.02, rate: null, shrink: null }, "Badger Grain"),
    "Holding to March at Badger Grain nets +17 cents a bushel after your costs. Interest and shrink not counted.");
  assert.equal(S.headline(m, mar, { cost: 0.03, rate: 7.5, shrink: 1 }, "Badger Grain"),
    "Holding to March at Badger Grain loses 6 cents a bushel after your costs.");
  assert.doesNotMatch(S.headline(m, mar, { cost: 0.03, rate: 7.5, shrink: 1 }, "X"), /—/);
});

test("default pick is the best net; the reader's pick sticks while it is posted", () => {
  const m = S.buildPeriods(BADGER, "corn");
  const inputs = { cost: 0.03, rate: null, shrink: null };
  // nets: Dec .12-.06=.06, Jan .17-.09=.08, Feb .19-.12=.07, Mar .27-.15=.12, Apr .30-.18=.12, ...
  assert.equal(S.pickPeriod(m, inputs, null).key, "2027-03", "ties go to the earlier month");
  assert.equal(S.pickPeriod(m, inputs, "2027-01").key, "2027-01");
  assert.equal(S.pickPeriod(m, inputs, "2030-01").key, "2027-03");
  // no storage cost: biggest carry
  assert.equal(S.pickPeriod(m, { cost: null, rate: null, shrink: null }, null).key, "2027-06");
});

test("new crop is left out and counted; a window's own months are not later", () => {
  /* Heartland Co-op Cambridge IA corn: an Oct-Nov window, then Dec, Jan, Mar, and new-crop Oct-Nov 2027. */
  const rows = [
    { start: "2026-10", end: "2026-11", cash: 4.55 }, { start: "2026-12", end: "2026-12", cash: 4.63 },
    { start: "2027-01", end: "2027-01", cash: 4.7 }, { start: "2027-03", end: "2027-03", cash: 4.75 },
    { start: "2027-10", end: "2027-11", cash: 4.67 },
  ];
  const m = S.buildPeriods(rows, "corn");
  assert.deepEqual(Array.from(m.later, (p) => p.key), ["2026-12", "2027-01", "2027-03"]);
  assert.deepEqual(Array.from(m.newCrop), ["2027-10"]);
  near(m.later[0].carry, 0.08, "Dec carry");
  assert.equal(m.later[0].months, 2);
  assert.equal(S.newCropFrom("2026-10", "wheat"), "2027-06");
  assert.equal(S.newCropFrom("2027-03", "corn"), "2027-09");
});

test("no later month posted: the headline says so and no period is picked", () => {
  const m = S.buildPeriods([{ start: "2026-10", end: "2026-12", cash: 4.38 }], "corn");
  m.cropWord = "corn";
  assert.equal(m.later.length, 0);
  const p = S.pickPeriod(m, { cost: 0.03 }, null);
  assert.equal(p, null);
  assert.equal(S.headline(m, p, {}, "Meyer Brothers Grain"),
    "Meyer Brothers Grain posts no corn bid later than Oct '26. Enter the carry you expect below.");
  const w = S.buildPeriods([{ start: "2026-10", end: "2026-10", cash: 5.87 }, { start: "2027-07", end: "2027-07", cash: 6.09 }], "wheat");
  w.cropWord = "wheat";
  assert.deepEqual(Array.from(w.newCrop), ["2027-07"]);
  assert.equal(S.headline(w, null, {}, "Country Visions Coop"),
    "Country Visions Coop posts no wheat bid later than Oct '26 for this year\u2019s crop. Enter the carry you expect below.");
});

test("bad rows are dropped; two bids for one month keep the higher", () => {
  const m = S.buildPeriods([
    { start: "2026-10", end: "2026-10", cash: 4.3 }, { start: "2026-10", end: "2026-10", cash: 4.35 },
    { start: "2027-03", end: "2027-03", cash: null }, { start: "bad", end: "", cash: 9 },
    { start: "2027-01", end: "2027-01", cash: 4.6 },
  ], "corn");
  near(m.spot.cash, 4.35, "spot");
  assert.equal(m.later.length, 1);
  near(m.later[0].carry, 0.25, "Jan carry");
  assert.equal(S.buildPeriods([], "corn"), null);
});

test("price and carry text in quarter cents", () => {
  assert.equal(S.cashQ(4.3775), "$4.37 3/4");
  assert.equal(S.cashQ(4.5), "$4.50");
  assert.equal(S.carryText(0.0025), "+1/4¢");
  assert.equal(S.carryText(-0.15), "−15¢");
  assert.equal(S.carryText(0), "even");
});

/* ── the one store-or-sell calculation (2026-10-10) ───────────────────── */
test("defaults are stated and fill only what is blank", () => {
  const d = S.withDefaults({});
  assert.deepEqual([d.cost, d.rate, d.shrink], [0.035, 7, 0]);
  assert.deepEqual(Array.from(d.assumed), ["cost", "rate", "shrink"]);
  const e = S.withDefaults({ cost: 0.02, rate: null, shrink: 1 });
  assert.deepEqual([e.cost, e.rate, e.shrink], [0.02, 7, 1]);
  assert.deepEqual(Array.from(e.assumed), ["rate"]);
});

test("interest is always counted: the futures pages' 'storing makes sense' case loses money", () => {
  /* Dec '26 to Jul '27 corn on 2026-10-09: +17 3/4c over 7 months at $4.80 1/2.
     The old card: 2.5c a month carry, "above typical storage cost of ~3.5c/mo"
     would be false here too, but with interest the net is clearly negative. */
  const n = S.carryNet(4.805, 0.1775, 7, S.withDefaults({}));
  near(n.storage, 0.245, "storage");
  near(n.interest, 4.805 * 0.07 * 7 / 12, "interest");
  assert.ok(n.net < 0, "net " + n.net);
});

test("holdLine and costNote read the same on every surface", () => {
  const d = S.withDefaults({});
  assert.equal(S.holdLine({ to: "Jan", carry: 0.05, months: 3, spot: 4.18, inputs: d }),
    "Hold to Jan? +5¢ posted carry, net of storage and interest: −13¢ a bushel.");
  assert.equal(S.costNote(d, 3, 4.18),
    "3 months of storage at 3.5¢ a month (default), interest at 7% a year on $4.18 (default), no shrink (default).");
  assert.match(S.holdLine({ to: "Jul", carry: 0.1775, months: 7, spot: 4.805, kind: "futures", inputs: d }), /^Hold to Jul\? \+17 3\/4¢ futures carry/);
});

import { execFileSync } from "node:child_process";
test("scripts/storesell.py (the town pages' twin) prints exactly what storesell.js prints", () => {
  const cases = [
    { to: "Jan", carry: 0.05, months: 3, spot: 4.18 },
    { to: "Mar", carry: 0.27, months: 5, spot: 4.38, inputs: { cost: 0.03, rate: 7.5, shrink: 1 } },
    { to: "Jul", carry: 0.1775, months: 7, spot: 4.805, kind: "futures" },
    { to: "Dec", carry: -0.03, months: 2, spot: 12.13, inputs: { cost: 0.04 } },
    { to: "May", carry: 0.2325, months: 7, spot: 6.7075, inputs: { cost: 0, rate: 0, shrink: 0 } },
    { to: "Nov", carry: 0, months: 1, spot: 10.5 },
  ];
  const py = JSON.parse(execFileSync("python3", [ROOT + "scripts/storesell.py", "--json"], { input: JSON.stringify(cases) }).toString());
  cases.forEach((c, i) => {
    const inp = S.withDefaults(c.inputs || {});
    assert.equal(py[i].line, S.holdLine({ to: c.to, carry: c.carry, months: c.months, spot: c.spot, kind: c.kind, inputs: inp }), "line " + i);
    assert.equal(py[i].note, S.costNote(inp, c.months, c.spot), "note " + i);
    near(py[i].net, S.carryNet(c.spot, c.carry, c.months, inp).net, "net " + i);
  });
});

test("build_periods / pick_period / costNote(no months) in the Python twin match storesell.js", () => {
  const rows = [{ start: "2026-10", end: "2026-10", cash: 4.18 }, { start: "2026-10", end: "2026-10", cash: 4.16 },
    { start: "2026-11", end: "2026-11", cash: 4.2 }, { start: "2027-01", end: "2027-01", cash: 4.23 },
    { start: "2027-03", end: "2027-03", cash: 4.4 }, { start: "2027-10", end: "2027-11", cash: 4.5 }];
  const cases = [{ rows, crop: "corn" }, { rows, crop: "wheat", inputs: { cost: 0.02, rate: 5 } },
    { rows: rows.slice(0, 1), crop: "soybeans" }];
  const py = JSON.parse(execFileSync("python3", [ROOT + "scripts/storesell.py", "--json"], { input: JSON.stringify(cases) }).toString());
  cases.forEach((c, i) => {
    const inp = S.withDefaults(c.inputs || {}), m = S.buildPeriods(c.rows, c.crop), pk = S.pickPeriod(m, inp, null);
    assert.equal(JSON.stringify(py[i].later), JSON.stringify(m.later.map((p) => p.key)), "later " + i);
    assert.equal(JSON.stringify(py[i].newCrop), JSON.stringify(m.newCrop), "newCrop " + i);
    assert.equal(py[i].pick, pk ? pk.key : null, "pick " + i);
    assert.equal(py[i].note, S.costNote(inp, null, null), "note " + i);
  });
});
