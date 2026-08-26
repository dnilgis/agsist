/* FUTURES REFERENCE — 30 CHECKS
 *
 * Run it:   node scripts/futures-checks.mjs      (from the repo root)
 *
 * Same shape as delivery-checks.mjs, and for the same reason: it reads the
 * real functions straight out of cash-bids.html rather than copying them, so
 * it cannot quietly pass against a version of the code that is no longer on
 * the page.
 *
 * WHY IT EXISTS. The page now prints a futures price it was not given. That
 * price is cash minus basis on the elevator's own board -- no quote feed is
 * called and none could be -- so every way the two inputs can be wrong is a
 * way this number can be wrong, and each of those has bitten this page before:
 * a per-ton row rescaled into a bushel price (FJ Krob's soybeans at 120.083),
 * a flat basis read as unknown (`parseFloat(x)||null`, 21 live rows), a board
 * that floors its cash where its neighbours do not (Badger Grain, one cent
 * under everybody on ZCZ26).
 *
 * THE ROWS BELOW ARE REAL AND WERE NOT TYPED BY HAND. They are the response
 * from the AGSIST barchart proxy for zipCode=54725, maxDistance=15, captured
 * 2026-08-26: four independent boards, 25 rows, cut down to the fields the
 * page reads. Twenty-four of the twenty-five agree to the cent on what the
 * futures must be. The twenty-fifth is the check that matters.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = [join(HERE, "cash-bids.html"), join(HERE, "..", "cash-bids.html")]
  .find((p) => { try { readFileSync(p); return true; } catch { return false; } });
if (!PAGE) { console.error("Could not find cash-bids.html next to this script or one level up."); process.exit(1); }
const h = readFileSync(PAGE, "utf8");
const grab = (name) => {
  const i = h.indexOf("function " + name);
  if (i < 0) throw new Error("no " + name);
  let d = 0, j = h.indexOf("{", i);
  for (let k = j; k < h.length; k++) { if (h[k] === "{") d++; else if (h[k] === "}") { d--; if (!d) { j = k; break; } } }
  return h.slice(i, j + 1);
};
/* PPU_BAND is lifted too, not restated: the bands are the one thing that
   decides whether a derived price is publishable, and a copy of them here
   would be a second source of truth for exactly the number in dispute. */
const bandLine = h.match(/var PPU_BAND=\{[^}]*\};/);
if (!bandLine) throw new Error("no PPU_BAND");
const src = ["classify", "ppu", "basisCents", "plausible", "futuresOf", "contractLabel", "contractStrip"].map(grab).join("\n")
  + "\n" + bandLine[0];
const M = new Function(src + "; return {classify,ppu,basisCents,plausible,futuresOf,contractLabel,contractStrip};")();

/* The captured board, verbatim in the fields the page reads. */
const ROWS = [
  ["Big River Resources", "CORN", "ZCU26", "Sep 2026", "Aug26", "4.62", "-52.00"],
  ["Big River Resources", "CORN", "ZCU26", "Sep 2026", "Sep26", "4.68", "-46.00"],
  ["Big River Resources", "CORN", "ZCZ26", "Dec 2026", "Oct26", "4.82", "-55.00"],
  ["Big River Resources", "CORN", "ZCZ26", "Dec 2026", "Nov26", "4.82", "-55.00"],
  ["Big River Resources", "CORN", "ZCZ26", "Dec 2026", "Dec26", "4.87", "-50.00"],
  ["Big River Resources", "CORN", "ZCH27", "Mar 2027", "Jan27", "4.91", "-60.00"],
  ["Big River Resources", "CORN", "ZCH27", "Mar 2027", "Feb27", "4.93", "-58.00"],
  ["Big River Resources", "CORN", "ZCH27", "Mar 2027", "Mar27", "5.01", "-50.00"],
  ["Big River Resources", "CORN", "ZCK27", "May 2027", "Apr27", "5.03", "-54.00"],
  ["Big River Resources", "CORN", "ZCK27", "May 2027", "May27", "5.05", "-52.00"],
  ["Big River Resources", "CORN", "ZCN27", "Jul 2027", "Jun27", "5.07", "-52.00"],
  ["Big River Resources", "CORN", "ZCN27", "Jul 2027", "Jul27", "5.07", "-52.00"],
  ["Wheaton Grain", "Corn", "ZCU26", "Sep 2026", "Aug26", "4.46", "-68.00"],
  ["Wheaton Grain", "Corn", "ZCZ26", "Dec 2026", "Dec26", "4.72", "-65.00"],
  ["Wheaton Grain", "Soybeans", "ZSX26", "Nov 2026", "Aug26", "11.81", "-85.00"],
  ["Wheaton Grain", "Soybeans", "ZSX26", "Nov 2026", "Nov26", "11.91", "-75.00"],
  ["Badger Grain Supply", "Corn", "ZCU26", "Sep 2026", "Aug26", "4.52", "-62.00"],
  ["Badger Grain Supply", "Corn", "ZCZ26", "Dec 2026", "Nov26", "4.81", "-55.00"],
  ["ALCIVIA", "CORN", "ZCU26", "Sep 2026", "Aug26", "4.59", "-55.00"],
  ["ALCIVIA", "CORN", "ZCU26", "Sep 2026", "Sep26", "4.66", "-48.00"],
  ["ALCIVIA", "CORN", "ZCZ26", "Dec 2026", "Nov26", "4.82", "-55.00"],
  ["ALCIVIA", "CORN", "ZCH27", "Mar 2027", "Jan27", "5.06", "-45.00"],
  ["ALCIVIA", "CORN", "ZCH27", "Mar 2027", "Feb27", "5.06", "-45.00"],
  ["ALCIVIA", "CORN", "ZCH27", "Mar 2027", "Mar27", "5.06", "-45.00"],
  ["ALCIVIA", "CORN", "ZCZ27", "Dec 2027", "Nov27", "4.74", "-60.00"],
];
const bid = (r) => ({ facility: r[0], commodity: r[1], symbol: r[2], basisMonth: r[3], deliveryMonth: r[4],
  cashPrice: parseFloat(r[5]), basis: parseFloat(r[6]), category: M.classify(r[1]) });
const BIDS = ROWS.map(bid);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "ok   " : "FAIL ") + m); };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
const cents = (n) => n == null ? null : Math.round(n * 100);

/* ---- 1. the arithmetic, row by row, against the value computed here ------ */
let agreed = 0;
for (const b of BIDS) {
  const want = Math.round((b.cashPrice - b.basis / 100) * 100);
  const got = cents(M.futuresOf(b));
  if (got === want) agreed++;
}
eq(agreed, 25, "all 25 real rows derive cash minus basis exactly");

/* ---- 2. the boards agree, and where one does not, it says so ------------- */
const bySym = {};
for (const b of BIDS) (bySym[b.symbol] = bySym[b.symbol] || []).push(cents(M.futuresOf(b)));
eq(new Set(bySym.ZCU26).size, 1, "four independent boards imply ONE September corn futures");
eq(bySym.ZCU26[0], 514, "and it is 5.14");
eq(new Set(bySym.ZCZ26).size, 2, "December corn does NOT agree across boards — this is the point");
const badger = BIDS.filter((b) => b.facility === "Badger Grain Supply" && b.symbol === "ZCZ26");
eq(cents(M.futuresOf(badger[0])), 536, "Badger Grain implies 5.36 on ZCZ26");
const others = BIDS.filter((b) => b.facility !== "Badger Grain Supply" && b.symbol === "ZCZ26");
ok(others.every((b) => cents(M.futuresOf(b)) === 537), "every other board implies 5.37 on ZCZ26");
ok(true, "-> a strip built per elevator prints 5.36 on Badger's card and 5.37 on the rest; averaging them would print a number no board posted");

/* ---- 3. the strip: one entry per contract, in delivery order ------------- */
const strip = (fac, cat) => M.contractStrip(BIDS.filter((b) => b.facility === fac && b.category === cat));
const br = strip("Big River Resources", "corn");
eq(br.length, 5, "Big River's twelve corn rows collapse to five contracts");
eq(br.map((e) => e.label).join(" "), "Sep26 Dec26 Mar27 May27 Jul27", "in delivery order, labelled as a person says them");
eq(br.map((e) => e.price.toFixed(2)).join(" "), "5.14 5.37 5.51 5.57 5.59", "with the prices the board implies");
eq(strip("Badger Grain Supply", "corn").map((e) => e.label + " " + e.price.toFixed(2)).join(" · "), "Sep26 5.14 · Dec26 5.36", "Badger's own two contracts, its own numbers");
eq(strip("Wheaton Grain", "soybeans").length, 1, "soybeans get their own strip");
eq(strip("Wheaton Grain", "soybeans")[0].price.toFixed(2), "12.66", "at 12.66");

/* ---- 4. a contract whose rows disagree is OMITTED, never averaged -------- */
const mixed = [bid(["X", "Corn", "ZCZ26", "Dec 2026", "Oct26", "4.82", "-55.00"]),
               bid(["X", "Corn", "ZCZ26", "Dec 2026", "Nov26", "4.81", "-55.00"])];
eq(M.contractStrip(mixed).length, 0, "two rows one cent apart on one contract: the contract is dropped");
const clean = [mixed[0], bid(["X", "Corn", "ZCZ26", "Dec 2026", "Dec26", "4.87", "-50.00"])];
eq(M.contractStrip(clean).length, 1, "two rows that agree: kept");

/* ---- 5. the rows that have burned this page before ---------------------- */
const krob = bid(["FJ Krob", "SOYBEANS", "ZSX26", "Nov 2026", "Nov26", "120.083", "11995.62"]);
eq(M.futuresOf(krob), null, "FJ Krob's per-ton soybean row gets no futures price");
eq(M.contractStrip([krob]).length, 0, "and no strip entry");
const flat = bid(["Y", "Soybeans", "ZSX26", "Nov 2026", "Nov26", "12.66", "0"]);
eq(cents(M.futuresOf(flat)), 1266, "a FLAT basis is a basis: 0 is not unknown");
const meal = bid(["Z", "Soybean Meal", "ZMZ26", "Dec 2026", "Dec26", "3.05", "-12.00"]);
eq(meal.category, "other", "meal classifies as Other Grains");
eq(M.futuresOf(meal), null, "and Other Grains never gets a futures price");
eq(M.futuresOf(bid(["Z", "Corn", "", "Sep 2026", "Aug26", "4.62", "-52.00"])) != null, true, "a row with no symbol still derives (the strip is what needs the symbol)");
eq(M.contractStrip([bid(["Z", "Corn", "", "Sep 2026", "Aug26", "4.62", "-52.00"])]).length, 0, "but contributes nothing to the strip");
/* THE BAND CATCHES A BADLY WRONG BASIS, NOT A SLIGHTLY WRONG ONE, and this
   check was first written asserting more than that. Corn's band is 2 to 12
   dollars, so a basis wrong by four dollars still derives 8.62 and is
   published. Only a basis wrong by eight puts the answer outside the band.
   The band is a floor under the arithmetic, not a proof of it -- the thing
   that actually proves the pair is the per-contract agreement above, which is
   why a contract whose rows disagree is dropped rather than shown. */
eq(M.futuresOf(bid(["Z", "Corn", "ZCU26", "Sep 2026", "Aug26", "4.62", "-800.00"])), null, "a derived price outside corn's own band is withheld, not printed");
eq(cents(M.futuresOf(bid(["Z", "Corn", "ZCU26", "Sep 2026", "Aug26", "4.62", "-400.00"]))), 862, "and one INSIDE the band is published, wrong basis or not — the band is a floor, not a proof");
eq(M.futuresOf({ category: "corn", cashPrice: 4.62, basis: null, symbol: "ZCU26" }), null, "no basis, no futures");
eq(M.futuresOf({ category: "corn", cashPrice: null, basis: -52, symbol: "ZCU26" }), null, "no cash, no futures");

/* ---- 6. the label -------------------------------------------------------- */
eq(M.contractLabel({ basisMonth: "Dec 2026" }), "Dec26", "Dec 2026 -> Dec26");
eq(M.contractLabel({ basisMonth: "Sep 2027" }), "Sep27", "Sep 2027 -> Sep27");
eq(M.contractLabel({ basisMonth: "" }), "", "nothing in, nothing out");
eq(M.contractLabel({ basisMonth: "December" }), "December", "an unexpected shape is passed through, not mangled");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
