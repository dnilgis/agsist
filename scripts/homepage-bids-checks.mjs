#!/usr/bin/env node
/* THE HOMEPAGE BIDS CARD: OLD CROP AND THE TOWN IT PRINTS.
 *
 * Same family as network-checks.mjs and built the same way: the functions are
 * LIFTED out of components/bids-homepage.js and components/bids-network.js by
 * their own source text and run, never copied here.
 *
 *     node scripts/homepage-bids-checks.mjs
 *
 * 2026-10-06. Two things this guards:
 *   1. oldcrop-YYYY is the HARVEST year, current through its crop year: Jun
 *      YYYY..May YYYY+1 for wheat/oats/barley, Sep YYYY..Aug YYYY+1 otherwise.
 *      The old rule ("only before Sep of YYYY") hid ADM Plains KS's old-crop
 *      HRW wheat. Same rule as deliveryMonth() in dnilgis/bids.
 *   2. `town` (the bids merge's display town) is printed in place of a `city`
 *      that is an elevator's name, and only when present.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = readFileSync(join(ROOT, "components", "bids-homepage.js"), "utf8");
const NET = readFileSync(join(ROOT, "components", "bids-network.js"), "utf8");

let pass = 0;
const fails = [];
const eq = (a, b, msg) => { if (Object.is(a, b)) pass++; else fails.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };

function lift(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found -- renamed or deleted?`);
  let depth = 0, seen = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "{") { depth++; seen = true; }
    else if (c === "}") { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`function ${name} never closes`);
}
function liftVar(src, name) {
  const m = new RegExp(`var ${name} = [^;]*;`).exec(src);
  if (!m) throw new Error(`var ${name} not found`);
  return m[0];
}

const body = [liftVar(HOME, "NC_WIN"), liftVar(HOME, "CY_START"), lift(HOME, "tokenMonth"),
              lift(HOME, "rowExpired"), lift(HOME, "townOf"),
              "return { tokenMonth, rowExpired, townOf, setNow(m){ NOW = m; } };"].join("\n");
const F = new Function(`var NOW = ''; function thisMonth(){ return NOW; }\n${body}`)();
const placeLabel = new Function(`${lift(NET, "placeLabel")}\nreturn placeLabel;`)();

const at = (month, row) => { F.setNow(month); return F.tokenMonth(row); };
const W = (p, extra = {}) => ({ deliveryStart: p, category: "wheat", netCrop: "wheat", ...extra });
const C = (p, extra = {}) => ({ deliveryStart: p, category: "corn", netCrop: "corn", ...extra });

/* 1. old-crop wheat: Oct and May inside, July out */
eq(at("2026-10", W("oldcrop-2026")).key, "2026-10", "wheat oldcrop-2026 in Oct 2026 is current (ADM Plains KS)");
eq(at("2027-05", W("oldcrop-2026")).key, "2027-05", "wheat oldcrop-2026 in May 2027 is still current");
eq(at("2027-07", W("oldcrop-2026")).expired, true, "wheat oldcrop-2026 in Jul 2027 has expired");
eq(at("2027-06", W("oldcrop-2026")).expired, true, "June 1 starts the next wheat crop year");
eq(at("2026-10", W("oldcrop-2027")).key, "2027-06", "an unharvested wheat old crop is placed at June");
F.setNow("2026-10"); eq(F.rowExpired(W("oldcrop-2026")), false, "rowExpired: Oct 2026 wheat old crop is a bid");

/* 1b. old-crop corn: Oct, May and July inside; September out */
eq(at("2026-10", C("oldcrop-2026")).key, "2026-10", "corn oldcrop-2026 in Oct 2026 is current");
eq(at("2027-05", C("oldcrop-2026")).key, "2027-05", "corn oldcrop-2026 in May 2027 is current");
eq(at("2027-07", C("oldcrop-2026")).key, "2027-07", "corn oldcrop-2026 in Jul 2027 is current");
eq(at("2027-09", C("oldcrop-2026")).expired, true, "corn oldcrop-2026 in Sep 2027 has expired");
eq(at("2026-10", C("oldcrop-2025")).expired, true, "corn oldcrop-2025 in Oct 2026 has expired");
F.setNow("2026-10"); eq(F.rowExpired(C("oldcrop-2025")), true, "rowExpired: last year's corn in Oct");

/* 1c. a real delivery end date beats the token */
eq(at("2027-07", W("oldcrop-2026", { deliveryEnd: "2027-07-31" })).key, "2027-07", "deliveryEnd overrides the season");
eq(at("2026-10", C("newcrop-2026", { deliveryEnd: "2026-09-30" })).expired, true, "a closed deliveryEnd is expired");
eq(at("2026-10", { deliveryStart: "spot", category: "corn" }).key, "2026-10", "spot unchanged");
eq(at("2026-10", W("newcrop-2026")).expired, true, "newcrop wheat window (Jun-Sep) unchanged");

/* 2. the town to print */
eq(F.townOf({ city: "Walsh Grain", town: "Mauston" }), "Mauston", "town wins when present");
eq(F.townOf({ city: "Tomah", town: "" }), "Tomah", "city when no town");
eq(F.townOf({ city: "Cameron Coop" }), "Cameron Coop", "no town field: city, nothing made up");
eq(placeLabel({ operator: "Cadott Grain", city: "Cadott Grain", town: "Cadott", state: "WI" }), "Cadott, WI", "placeLabel uses town");
eq(placeLabel({ operator: "Allied", city: "Tomah", state: "WI" }), "Tomah, WI", "placeLabel unchanged without town");

if (fails.length) {
  console.log(`FAIL ${fails.length} of ${pass + fails.length}`);
  for (const f of fails) console.log("  x " + f);
  process.exit(1);
}
console.log(`all ${pass} homepage-bids checks pass`);
