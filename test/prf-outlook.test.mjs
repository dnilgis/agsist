/* The /prf long-range outlook panel (components/prf-outlook.js): how CPC's
 * 3-month seasons are matched to PRF's 2-month intervals, the wording of a
 * tilt, the age limits, and the grid lookup, against hand-worked answers.
 *
 * The sample file is synthetic (test/fixtures/prf-outlook/), built by
 * scripts/fetch_prf_outlook.py --fixture-doc.
 *
 *   node --test test/prf-outlook.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const src = readFileSync(ROOT + "components/prf-outlook.js", "utf8");
const ctx = { window: {} };
vm.runInNewContext(src, ctx);
const O = ctx.window.AgPrfOutlook;
const doc = JSON.parse(readFileSync(ROOT + "test/fixtures/prf-outlook/outlook-sample.json", "utf8"));
const TX = 13321, TX3 = 13324, KS = 21721;

/* leads as CPC issues them on Sep 17, 2026: lead 1 = Oct-Dec 2026 ... lead 13 = Oct-Dec 2027 */
const leadsSep = Array.from({ length: 13 }, (_, k) => {
  const s = 2026 * 12 + 9 + k, e = s + 2;
  const f = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
  return { lead: k + 1, start: f(s), end: f(e) };
});

test("every PRF interval sits inside the CPC seasons that contain both its months", () => {
  // Jan-Feb 2027 is in Dec-Feb (lead 3) and Jan-Mar (lead 4)
  assert.deepEqual([...O.seasonsFor(0, 2027, leadsSep)], [2, 3]);
  // Jun-Jul 2027: May-Jul (lead 8) and Jun-Aug (lead 9)
  assert.deepEqual([...O.seasonsFor(5, 2027, leadsSep)], [7, 8]);
  // Oct-Nov 2027: Sep-Nov (lead 12) and Oct-Dec (lead 13)
  assert.deepEqual([...O.seasonsFor(9, 2027, leadsSep)], [11, 12]);
  // Nov-Dec 2027: only Oct-Dec 2027; Nov-Jan is lead 14, which CPC does not issue
  assert.deepEqual([...O.seasonsFor(10, 2027, leadsSep)], [12]);
  // a season that holds only one of the two months never counts: Feb-Apr does not hold Jan-Feb
  for (let i = 0; i < 11; i++) for (const k of O.seasonsFor(i, 2027, leadsSep)) {
    const s = leadsSep[k];
    const a = 2027 * 12 + i;
    const si = +s.start.slice(0, 4) * 12 + +s.start.slice(5) - 1, ei = +s.end.slice(0, 4) * 12 + +s.end.slice(5) - 1;
    assert.ok(si <= a && a + 1 <= ei, `interval ${i} lead ${k + 1}`);
  }
  // an issue a month later (Oct 15: lead 1 = Nov-Jan) gives every 2027 interval two seasons
  const leadsOct = leadsSep.map((l) => ({ ...l, start: bump(l.start), end: bump(l.end) }));
  for (let i = 0; i < 11; i++) assert.equal(O.seasonsFor(i, 2027, leadsOct).length, 2, `interval ${i}`);
});
function bump(ym) { let y = +ym.slice(0, 4), m = +ym.slice(5) + 1; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, "0")}`; }

test("season labels name the months and the years", () => {
  assert.equal(O.seasonLabel(leadsSep[2]), "Dec 2026 to Feb 2027");
  assert.equal(O.seasonLabel(leadsSep[3]), "Jan to Mar 2027");
});

test("tilt wording: band, direction, CPC's own leaning/likely split", () => {
  assert.equal(O.tiltText("B4", "2026-10-15"), "Leaning dry: 40 to 50% chance of below-normal precipitation (CPC, issued Oct 15, 2026)");
  assert.equal(O.tiltText("A3", "2026-10-15"), "Leaning wet: 33 to 40% chance of above-normal precipitation (CPC, issued Oct 15, 2026)");
  assert.equal(O.tilt("B5").head, "Likely dry");
  assert.equal(O.tilt("B5").body, "50 to 60% chance of below-normal precipitation");
  assert.equal(O.tilt("N4").head, "Leaning near normal");
  assert.equal(O.tilt("A9").body, "90 to 100% chance of above-normal precipitation");
  assert.equal(O.tilt("E").head, "Equal chances");
  assert.match(O.tilt("E").body, /1-in-3/);
  assert.equal(O.tilt("-").key, "na");
  assert.equal(O.tilt("X7").key, "na");
});

test("interval rows: agree once, differ shown both ways with no invented number, one season said so", () => {
  const s = doc.seasonal;
  const tx = O.decode(s, TX).split("."), tx3 = O.decode(s, TX3).split("."), ks = O.decode(s, KS).split(".");
  // Texas grid 13324, Jan-Feb: Dec-Feb B4 and Jan-Mar B4 agree
  let r = O.intervalRow(0, 2027, s, tx3);
  assert.equal(r.kind, "agree");
  assert.equal(r.text, "Leaning dry: 40 to 50% chance of below-normal precipitation (CPC, issued Sep 17, 2026). Both CPC seasons that contain these months, Dec 2026 to Feb 2027 and Jan to Mar 2027, say the same.");
  // Texas grid 13321, Jan-Feb: Dec-Feb B5 (nested polygon) and Jan-Mar B4 differ
  r = O.intervalRow(0, 2027, s, tx);
  assert.equal(r.kind, "differ");
  assert.match(r.text, /^The two CPC seasons that contain these months differ\. Dec 2026 to Feb 2027: likely dry, 50 to 60% chance/);
  assert.match(r.text, /Jan to Mar 2027: leaning dry, 40 to 50% chance/);
  assert.match(r.text, /CPC gives no figure for these two months alone/);
  assert.doesNotMatch(r.text, /45%|55%/, "no averaged number");
  // Kansas, Mar-Apr: Feb-Apr E and Mar-May E agree as equal chances
  r = O.intervalRow(2, 2027, s, ks);
  assert.equal(r.kind, "agree");
  assert.match(r.text, /^Equal chances: /);
  // Kansas, Jun-Jul: May-Jul E, Jun-Aug A3 -> differ, the EC side has no band
  r = O.intervalRow(5, 2027, s, ks);
  assert.equal(r.kind, "differ");
  assert.match(r.text, /May to Jul 2027: equal chances\. Jun to Aug 2027: leaning wet, 33 to 40% chance/);
  // Nov-Dec 2027: one season only, and it says so
  r = O.intervalRow(10, 2027, s, ks);
  assert.equal(r.kind, "one");
  assert.match(r.text, /From Oct to Dec 2027, the only CPC season issued so far that contains these months\.$/);
  // a crop year the outlook does not reach
  r = O.intervalRow(0, 2029, s, ks);
  assert.equal(r.kind, "none");
  assert.match(r.text, /reach 13 seasons ahead/);
  // a grid value CPC's file did not have
  const na = ks.slice(); na[2] = "-";
  r = O.intervalRow(0, 2027, s, na);
  assert.equal(r.kind, "na");
  // no em dash in any sentence
  for (let i = 0; i < 11; i++) for (const c of [tx, tx3, ks]) assert.doesNotMatch(O.intervalRow(i, 2027, s, c).text, /\u2014/);
});

test("grid lookup reads the run-length rows", () => {
  assert.equal(O.decode(doc.drought, TX), "2");
  assert.equal(O.decode(doc.drought, TX + 7), "1");
  assert.equal(O.decode(doc.drought, KS), "N");
  assert.equal(O.decode(doc.monthly, TX + 1), "A4");
  assert.equal(O.decode(doc.monthly, KS), "E");
  assert.equal(O.decode(doc.drought, 1), null, "a grid in no row");
  assert.equal(O.decode(doc.drought, KS + 50), null, "a column past the row");
});

test("age limits withhold, with the reason", () => {
  const today = "2026-10-12";
  assert.equal(O.stale("seasonal", doc.seasonal, today), null);
  assert.equal(O.stale("enso", doc.enso, today), null);
  assert.equal(O.stale("drought", doc.drought, today), null);
  assert.match(O.stale("seasonal", doc.seasonal, "2026-11-01"), /issued Sep 17, 2026, 45 days ago/);
  assert.match(O.stale("drought", doc.drought, "2026-10-20"), /map here is for Oct 6, 2026, 14 days ago/);
  // the one-month outlook for October is fine in October and withheld in November
  assert.equal(O.stale("monthly", doc.monthly, "2026-10-12"), null);
  assert.match(O.stale("monthly", doc.monthly, "2026-11-02"), /October 2026, which has ended/);
  assert.match(O.stale("enso", null, today), /not been fetched/);
  assert.match(O.stale("seasonal", { issued: null }, today), /no date/);
});

test("drought and ENSO lines carry their source and date", () => {
  assert.equal(O.droughtText("2", doc.drought), "D2 Severe drought at the grid’s center (US Drought Monitor, map for Oct 6, 2026, released Oct 8, 2026)");
  assert.match(O.droughtText("N", doc.drought), /^None: not in drought/);
  assert.equal(O.droughtText("7", doc.drought), null);
  assert.equal(O.ensoText(doc.enso), "El Nino Advisory. El Nino is expected to continue through the Northern Hemisphere winter 2026-27 (98% chance in October-December 2026) (CPC, issued Oct 8, 2026)");
});

test("the component's copy has no em dash and no advice words", () => {
  const strings = [...src.matchAll(/'([^'\\]|\\.)*'/g)].map((m) => m[0]).join(" ");
  assert.doesNotMatch(src, /\u2014|&mdash;/);
  assert.doesNotMatch(strings, /\b(best|recommend|should buy|you should)\b/i);
});
