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

/* ── carryWindow / forwardCurve: contract months from the quotes on file ──
   The fixture is the dated grain keys of data/prices.json on 2026-10-09,
   plus the months a run generates later (fetch_prices GRAIN_CURVES), so the
   window can be checked as the calendar moves. Every key carries a close. */
const QK = [
  "corn-dec26", "corn-mar27", "corn-may27", "corn-jul27", "corn-sep27", "corn-dec27", "corn-mar28", "corn-may28", "corn-jul28", "corn-dec28",
  "beans-nov26", "beans-jan27", "beans-mar27", "beans-may27", "beans-jul27", "beans-aug27", "beans-sep27", "beans-nov27", "beans-nov28",
  "wheat-dec26", "wheat-mar27", "wheat-may27", "wheat-jul27", "wheat-sep27", "wheat-dec27",
  "kcwheat-dec26", "corn-dec", "beans-nov", "corn-nearby", "corn",
];
const MCODE = { jan: "F", mar: "H", may: "K", jul: "N", aug: "Q", sep: "U", nov: "X", dec: "Z" };
const ROOTC = { corn: "ZC", beans: "ZS", wheat: "ZW", kcwheat: "KE" };
const QUOTES = Object.fromEntries(QK.map((k, i) => {
  const m = /^(\w+)-([a-z]{3})(\d{2})$/.exec(k);
  return [k, { close: 500 + i, ticker: m ? ROOTC[m[1]] + MCODE[m[2]] + m[3] + ".CBT" : "X" }];
}));
const win = (crop, day, q = QUOTES) => { const w = S.carryWindow(crop, q, day); return w ? w.join(">") : null; };

test("carryWindow on 2026-10-11 is the window the site had typed, on dated keys", () => {
  assert.equal(win("corn", "2026-10-11"), "corn-dec26>corn-jul27");
  assert.equal(win("soybeans", "2026-10-11"), "beans-nov26>beans-jul27");
  assert.equal(win("wheat", "2026-10-11"), "wheat-dec26>wheat-may27");
  assert.equal(win("soybean", "2026-10-11"), "beans-nov26>beans-jul27", "the futures page's crop name works too");
  assert.equal(win("oats", "2026-10-11"), null);
});

test("carryWindow rolls the day a contract dies (the 15th), never into next year's crop", () => {
  assert.equal(win("corn", "2026-12-14"), "corn-dec26>corn-jul27", "Dec '26 last trades Dec 14");
  assert.equal(win("corn", "2026-12-15"), "corn-mar27>corn-jul27");
  assert.equal(win("wheat", "2026-12-15"), "wheat-mar27>wheat-may27");
  // Nov '26 beans last trade Fri Nov 13; the calendar holds a contract live
  // through the 14th (dead from the 15th), the conservative side.
  assert.equal(win("soybeans", "2026-11-13"), "beans-nov26>beans-jul27");
  assert.equal(win("soybeans", "2026-11-15"), "beans-jan27>beans-jul27");
  // mid-May to mid-July: only July is left in corn's crop year -> no window
  assert.equal(win("corn", "2027-05-15"), null);
  assert.equal(win("corn", "2027-07-14"), null);
  assert.equal(win("soybeans", "2027-05-20"), null);
  // wheat after May dies: the new crop year starts at its harvest contract, July
  assert.equal(win("wheat", "2027-05-15"), "wheat-jul27>wheat-dec27", "Mar/May '28 not on file: last window month with a close");
  // Jul 15 2027: corn's next crop year, when its keys are on file
  assert.equal(win("corn", "2027-07-15"), "corn-dec27>corn-jul28");
  const noNext = Object.fromEntries(Object.entries(QUOTES).filter(([k]) => !/^corn-(mar|may|jul)28$/.test(k)));
  assert.equal(win("corn", "2027-07-15", noNext), null, "only Dec '27 on file -> null, not a guess");
});

test("carryWindow skips a month with no close and ignores the undated aliases", () => {
  const q = { ...QUOTES, "corn-dec26": { close: null, ticker: "ZCZ26.CBT" } };
  assert.equal(win("corn", "2026-10-11", q), "corn-mar27>corn-jul27");
  const q2 = { ...QUOTES };
  delete q2["corn-jul27"];
  assert.equal(win("corn", "2026-10-11", q2), "corn-dec26>corn-may27", "missing July: the last month with a close");
  const onlyAlias = { "corn-dec": { close: 480 }, "corn-jul27": { close: 507 } };
  assert.equal(win("corn", "2026-10-11", onlyAlias), null, "corn-dec alias is not a window month");
});

test("carryWindow without a date string reads the Chicago calendar day", () => {
  /* 2026-12-15 03:00 UTC is still Dec 14 in Chicago: Dec '26 still trades. */
  assert.equal(win("corn", new Date("2026-12-15T03:00:00Z")), "corn-dec26>corn-jul27");
  assert.equal(win("corn", new Date("2026-12-15T15:00:00Z")), "corn-mar27>corn-jul27");
  /* no date at all: today's Chicago date */
  const chi = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  for (const crop of ["corn", "soybeans", "wheat"]) assert.equal(win(crop, undefined), win(crop, chi), crop + " defaults to " + chi);
});

test("forwardCurve: live contracts on file, labels, idx, new crop and old crop", () => {
  const fc = (crop, day) => S.forwardCurve(crop, QUOTES, day).map((r) => r.key + (r.newCrop ? "*" : r.tag ? "~" : "")).join(" ");
  assert.equal(fc("corn", "2026-10-11"), "corn-dec26 corn-mar27 corn-may27 corn-jul27 corn-sep27~ corn-dec27*");
  assert.equal(fc("soybeans", "2026-10-11"), "beans-nov26 beans-jan27 beans-mar27 beans-may27 beans-jul27 beans-aug27~ beans-sep27~ beans-nov27*");
  assert.equal(fc("wheat", "2026-10-11"), "wheat-dec26 wheat-mar27 wheat-may27 wheat-jul27* wheat-sep27* wheat-dec27*");
  assert.equal(fc("corn", "2026-12-16"), "corn-mar27 corn-may27 corn-jul27 corn-sep27~ corn-dec27*", "Dec '26 drops off on expiry");
  assert.equal(fc("corn", "2027-07-15"), "corn-sep27~ corn-dec27 corn-mar28 corn-may28 corn-jul28 corn-dec28*", "next crop year: Sep '27 is old crop, Dec '28 new crop");
  const rows = S.forwardCurve("corn", QUOTES, "2026-10-11");
  assert.equal(rows[0].month, "Dec '26");
  assert.equal(rows[0].idx, 26 * 12 + 12);
  assert.equal(rows.find((r) => r.key === "corn-jul27").idx - rows[0].idx, 7, "months between = idx difference");
  assert.ok(!rows.some((r) => r.key === "corn-dec28"), "Flash Grain's far Dec '28 stays off the chart");
  assert.ok(!rows.some((r) => r.key === "corn-dec" || r.key === "corn-nearby"), "aliases are not curve points");
});

/* Head-to-head fix 2026-10-15: the board case counts storage and interest
   from today once the crop is in the bin, not from the first contract. */
const BOARD = {
  "corn-dec26": { ticker: "ZCZ26.CBT", close: 478.75, close_date: "2026-10-14" },
  "corn-mar27": { ticker: "ZCH27.CBT", close: 492.75 },
  "corn-may27": { ticker: "ZCK27.CBT", close: 499.75 },
  "corn-jul27": { ticker: "ZCN27.CBT", close: 505.75 },
};
test("boardHold on 2026-10-15: Dec to Jul carry, 9 months of storage and interest from October", () => {
  const b = S.boardHold("corn", BOARD, "2026-10-15");
  assert.equal(b.from.label, "Dec '26");
  assert.equal(b.to.label, "Jul '27");
  near(b.carry, 0.27, "carry");
  assert.equal(b.carryMonths, 7);
  assert.equal(b.months, 9);
  assert.equal(b.start, "2026-10");
  assert.equal(b.startLabel, "Oct '26");
  assert.equal(b.fromToday, true);
  assert.equal(b.date, "2026-10-14");
  /* hand-worked: 27 - 3.5 x 9 - 478.75 x 7% x 9/12 = 27 - 31.5 - 25.134 = -29.63c */
  const n = S.carryNet(b.spot, b.carry, b.months, S.withDefaults({}));
  near(n.net, 0.27 - 0.315 - 4.7875 * 0.07 * 9 / 12, "net");
  assert.equal(S.netText(n.net), "−30¢");
});
test("boardHold before the crop is in counts contract to contract, and rolls with the window", () => {
  const sep = S.boardHold("corn", BOARD, "2026-09-20");
  assert.equal(sep.months, 7, "September: no corn in the bin yet");
  assert.equal(sep.fromToday, false);
  assert.equal(sep.startLabel, "Dec '26");
  const dec = S.boardHold("corn", BOARD, "2026-12-15");
  assert.equal(dec.from.label, "Mar '27", "Dec '26 is dead from the 15th");
  assert.equal(dec.carryMonths, 4);
  assert.equal(dec.months, 7, "Dec '26 to Jul '27");
  const jan = S.boardHold("corn", BOARD, "2027-01-04");
  assert.equal(jan.months, 6);
  assert.equal(S.boardHold("corn", {}, "2026-10-15"), null);
  const wq = { "wheat-dec26": { ticker: "ZWZ26.CBT", close: 540 }, "wheat-mar27": { ticker: "ZWH27.CBT", close: 555 },
               "wheat-may27": { ticker: "ZWK27.CBT", close: 562 }, "wheat-jul27": { ticker: "ZWN27.CBT", close: 570 },
               "wheat-dec27": { ticker: "ZWZ27.CBT", close: 590 } };
  assert.equal(S.boardHold("wheat", wq, "2026-10-15").months, 7, "winter wheat is in the bin by October: Oct '26 to May '27");
  const may = S.boardHold("wheat", wq, "2027-05-20");
  assert.equal(may.fromToday, false, "May '27: next year's wheat is not cut yet");
  assert.equal(may.months, 5, "Jul '27 to Dec '27");
});
test("lockNote: only for a net above zero, futures leaves the basis open, posted fixes both", () => {
  assert.equal(S.lockNote("futures", -0.17, "Jul '27"), "");
  assert.equal(S.lockNote("posted", 0.004, "Jul '27"), "", "rounds to 0c: nothing to lock");
  assert.equal(S.lockNote("futures", 0.05, "Jul '27"),
    "You can lock this carry today by selling Jul '27 futures or taking a hedge-to-arrive contract for Jul '27. That takes out the futures risk, not the basis risk.");
  assert.equal(S.lockNote("posted", 0.05, "Jul '27"),
    "You can lock this today with a forward contract for Jul '27 delivery at this elevator. That fixes both the futures and the basis; ask the elevator for its terms.");
});
