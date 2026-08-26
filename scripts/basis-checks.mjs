/* BASIS HISTORY — 26 CHECKS
 *
 * Run it:   node scripts/basis-checks.mjs      (from the repo root)
 *
 * Third in the same family as delivery-checks.mjs and futures-checks.mjs, and
 * it works the same way: the functions are lifted out of cash-bids.html rather
 * than copied, so it cannot pass against code that is no longer on the page.
 *
 * WHAT IS AT STAKE. This feature puts a sentence next to a price -- "the basis
 * was -50c until the third of August" -- and a sentence is a claim in a way a
 * number beside a label is not. There are three ways to get it wrong and all
 * three are here: naming a day we do not know, pointing the arrow the wrong
 * way, and narrating a row whose basis is not a basis.
 *
 * THE ARROW. A basis of -50 going to -52 is a basis getting WEAKER for the
 * person selling the grain, even though 52 is the bigger number. Up is towards
 * zero. Half the checks below exist because that is easy to get backwards.
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
const monLine = h.match(/var BH_MON=\[[^\]]*\];/);
if (!monLine) throw new Error("no BH_MON");

/* bhLook is the one thing stubbed: it reads a fetched shard, and what is
   under test is what the page SAYS about a row, not how it found it. */
let STUB = null;
const mk = new Function("getStub", ["basisCents", "bhNorm", "bhKeyOf", "bhDate", "bhSane", "bhLine"].map(grab).join("\n")
  + "\n" + monLine[0] + "\nfunction bhLook(){return getStub();}"
  + "; return {basisCents,bhNorm,bhKeyOf,bhDate,bhSane,bhLine};")(() => STUB);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "ok   " : "FAIL ") + m); };
const eq = (a, b, m) => ok(a === b, m + (a === b ? "" : "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"));

const ELEV = { facility: "Big River Resources", city: "Boyceville", state: "WI" };
const BID = { category: "corn", symbol: "ZCU26", deliveryMonth: "Aug26", basis: -52 };
const line = (hist, bid = BID, elev = ELEV) => { STUB = hist; return mk.bhLine(bid, elev); };
const txt = (s) => s.replace(/<[^>]*>/g, "").replace(/&#162;/g, "c").replace(/\s+/g, " ").trim();

/* ---- 1. the key -------------------------------------------------------- */
eq(mk.bhKeyOf("Big River Resources", "Boyceville", "wi", "corn", "ZCU26", "Aug26"),
   "BIG RIVER RESOURCES|BOYCEVILLE|WI|CORN|ZCU26|AUG26", "the key is upper-cased and joined");
eq(mk.bhKeyOf("  Big   River  ", "x", "WI", "corn", "z", "m"),
   "BIG RIVER|X|WI|CORN|Z|M", "runs of whitespace collapse — the baker does the same");
eq(mk.bhKeyOf(null, undefined, "", "", "", ""), "|||||", "nothing in, empty key, no crash");

/* ---- 2. the date ------------------------------------------------------- */
const yr = new Date().getFullYear();
eq(mk.bhDate(yr + "-08-03"), "Aug 3", "this year drops the year");
eq(mk.bhDate(yr + "-06-09"), "Jun 9", "and the leading zero on the day");
eq(mk.bhDate("2024-11-30"), "Nov 30 ’24", "another year keeps it");
eq(mk.bhDate("rubbish"), "", "an unparseable date is not rendered");
eq(mk.bhDate(null), "", "nor is nothing");

/* ---- 3. the arrow, which is the thing that is easy to get backwards ---- */
ok(/bh-dn/.test(line({ cur: -52, prev: -50, since: yr + "-08-03", first: yr + "-06-09", last: yr + "-08-19" })),
   "-50 -> -52 is WEAKER for the seller: down arrow, red");
ok(/▼/.test(line({ cur: -52, prev: -50, since: yr + "-08-03" })), "and the glyph is the down triangle");
ok(/bh-up/.test(line({ cur: -52, prev: -60, since: yr + "-08-03" })),
   "-60 -> -52 is STRONGER: up arrow, green");
/* The bid's own basis has to MATCH the history's current value or the bounded
   branch runs instead, which is a different sentence and a different arrow.
   Three checks here first read as failures for exactly that reason and the
   code was right each time; the tests were comparing a live -52 against a
   history of +5 and calling the answer wrong. */
ok(/bh-up/.test(line({ cur: 5, prev: -3, since: yr + "-08-03" }, { ...BID, basis: 5 })),
   "crossing zero upward is still up");
ok(/bh-dn/.test(line({ cur: -30, prev: 8, since: yr + "-08-03" }, { ...BID, basis: -30 })),
   "and downward is still down");

/* A KNOWN HAZARD, DELIBERATELY NOT FIXED, RECORDED HERE SO IT IS NOT
   REDISCOVERED AS A SURPRISE. basisCents() reads any |value| under 5 as
   dollars and multiplies by a hundred, because some feeds quote basis in
   dollars and some in cents and it has to choose. That makes a genuine basis
   of -3c come out as -300c. It is not fixed because it has never happened:
   every key in the baked history was counted on 2026-08-26 -- 14,920 of them,
   29 states, 68 days -- and ZERO have a basis strictly between 0 and 5 cents,
   current or previous. Exactly 0 is safe and stays 0, which is why the 21 flat
   rows behave. Changing a unit heuristic with no case to point at is how the
   other feeds it was written for get broken. If a row ever does turn up in
   that band, this is the check that will say so. */
eq(mk.basisCents(-3), -300, "DOCUMENTED: a -3c basis is misread as -300c — unreached in 14,920 keys");
eq(mk.basisCents(-5), -5, "the band is exclusive: -5 is left alone");

/* ---- 4. what it says --------------------------------------------------- */
eq(txt(line({ cur: -52, prev: -50, since: yr + "-08-03" })), "▼ from −50c · Aug 3",
   "the sentence names the OLD number and the day it stopped being true");
eq(txt(line({ cur: -52, prev: 0, since: yr + "-08-03" })), "▼ from +0c · Aug 3",
   "a flat basis is a real previous value, not a missing one");
eq(txt(line({ cur: -55, prev: null, first: yr + "-06-09" }, { ...BID, basis: -55 })),
   "no change since Jun 9", "never moved in the window we hold: say so, no arrow");

/* ---- 5. the bounded case, which must never invent a day ---------------- */
const b = line({ cur: -52, prev: -50, since: yr + "-08-03", last: yr + "-08-19" },
                { ...BID, basis: -61 });
eq(txt(b), "▼ from −52c · moved since Aug 19",
   "live basis differs from the one on file: bounded by the last day we looked");
ok(!/Aug 3/.test(b), "and it does NOT reuse the old change date, which is now wrong");
ok(/bh-dn/.test(b), "the arrow compares the LIVE basis against what we held");

/* ---- 6. rows it refuses to narrate ------------------------------------- */
eq(line(null), "", "no history for this row: nothing is said");
eq(line({ cur: -52, prev: -50, since: yr + "-08-03" }, { ...BID, basis: null }), "",
   "a row with no basis gets no sentence");
eq(line({ cur: 392, prev: 408, since: yr + "-08-03" }, { ...BID, basis: 392 }), "",
   "ADM Grain's +392c soybean row is a per-ton price wearing a bushel label — withheld");
eq(line({ cur: -52, prev: -900, since: yr + "-08-03" }), "",
   "an implausible PREVIOUS value is withheld too, not just a current one");
eq(line({ cur: -52, prev: -50, since: "" }), "", "a change we cannot date is not shown");
eq(line({ cur: -55, prev: null, first: null }, { ...BID, basis: -55 }), "",
   "nor an unchanged row with no start date");
ok(mk.bhSane(300) && mk.bhSane(-300) && !mk.bhSane(301) && !mk.bhSane(null),
   "the band is three dollars either way, inclusive");

/* ---- 7. the units boundary -------------------------------------------- */
eq(mk.basisCents(-52), -52, "the live feed is already cents");
eq(mk.basisCents(0), 0, "and zero stays zero rather than becoming unknown");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
