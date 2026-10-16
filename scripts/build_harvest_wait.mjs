#!/usr/bin/env node
/* build_harvest_wait.mjs: bakes the static parts of /harvest-or-wait from the
 * same math the page runs (components/harvest-wait.js), so a crawler, a
 * printer and a reader with no script see the calculator's own numbers:
 *   <!--HW:CAL-->  field drydown by month (NDSU 2009, ISU 2022)
 *   <!--HW:GQ3-->  Purdue GQ-3 BTU a bushel to 15%, and LP gallons
 *   <!--HW:FAQ-->  the questions, and the same text as the FAQPage JSON-LD
 *                  mainEntity, from one list so they cannot drift
 *
 *   node scripts/build_harvest_wait.mjs          # write harvest-or-wait.html
 *   node scripts/build_harvest_wait.mjs --check  # exit 1 if the page is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAGE = ROOT + "harvest-or-wait.html";
const ctx = {};
vm.runInNewContext(readFileSync(ROOT + "components/harvest-wait.js", "utf8"), ctx);
const H = ctx.AgHarvestWait;

const f = (x, d) => x.toFixed(d);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const MONTHS = { 9: "September", 10: "October", 11: "November", 12: "December" };

/* NDSU's own example, run through the weekly table: 35% on Oct 11. */
const nd = H.calendarDrydown(35, "2026-10-11", 51);
const nov1 = nd[21].m, dec1 = nd[51].m;
/* Iowa State: 0.018 gal x 1,000 bu x 5 points. */
const isuGal = 0.018 * 1000 * 5;

export const FAQ = [
  ["How fast does corn dry down in the field?",
   "About 4.5 points a week in September, 2.5 in October, 1 in November and 0.5 in December. That is NDSU's table (Hellevang, 2009), and Iowa State used the same rates in 2022. NDSU also puts October at 0.3 to 0.4 points a day and November at 0.15 to 0.2. Their example: 35% corn on October 11 dries to about 27% by November 1 and about 22% by December 1. The weekly rates give " + f(nov1, 1) + "% and " + f(dec1, 1) + "%."],
  ["How much LP does it take to dry a point of corn?",
   "Iowa State's average is 0.018 gallons a bushel a point in a high-temperature dryer, anywhere from 0.010 to 0.025 depending on the dryer and the weather. Taking 5 points out of 1,000 bushels is about " + f(isuGal, 0) + " gallons. Purdue's GQ-3 table works out to 0.017 to 0.020 gallons a bushel a point drying to 15%."],
  ["When does waiting on field drydown stop paying?",
   "When the corn stops drying or the field starts losing more than the drying saves. Corn dries toward the air's equilibrium moisture, which NDSU puts near 16% in October, 19% in November and 20% in December, and it dries slower each week. NDSU says field drying is normally cheaper than the dryer until mid to late October and the dryer is cheaper after that."],
  ["What field loss should I put in?",
   "Yours. Stalk strength, lodging, ear drop, deer and the weather decide it, and they differ field to field. Leave it blank and the page shows the loss that would eat the drying savings. Purdue's GQ-3 example: drying 28% corn to 15% instead of 22% corn cost $7.02 an acre more in fuel and electricity at 130 bushels, so a field loss of 3.5 bushels an acre at $2 corn would pay for drying the wetter corn."],
  ["Does the weather forecast change the estimate?",
   "Not yet. The page shows the forecast heat for each of the next 14 days, but the moisture estimate uses the published monthly rates or your own rate. Some guides predict drydown from growing degree days; the page will use that once we have read the rule in the original publication."],
  ["Where does the bid come from?",
   "Type your own, or enter your ZIP and the page uses the nearest elevator's posted corn bid from the same boards as the cash bids page. With no ZIP, pick a state and the page uses the latest corn futures settle less that state's median basis, labeled as such."]
];

function cal() {
  return "\n" + [9, 10, 11, 12].map((m) =>
    `<tr><th scope="row">${MONTHS[m]}</th><td>${f(H.CAL.weekly[m], 1)}</td><td>${f(H.CAL.weekly[m] / 7, 2)}</td><td>${H.CAL.emc[m]}</td></tr>`).join("\n") + "\n";
}
function gq3() {
  const fi = H.GQ3.final.indexOf(15);
  return "\n" + H.GQ3.initial.map((mi, c) => {
    const btu = H.GQ3.btu[fi][c], gal = btu / H.LP_BTU_PER_GAL;
    return `<tr><th scope="row">${mi}%</th><td>${btu.toLocaleString("en-US")}</td><td>${f(gal, 3)}</td><td>${f(gal / (mi - 15), 4)}</td></tr>`;
  }).join("\n") + "\n";
}
function faqHtml() {
  return "\n" + FAQ.map(([q, a]) => `        <details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n") + "\n";
}
function faqLd() {
  return FAQ.map(([q, a]) => JSON.stringify({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })).join(",");
}
function fill(html, tag, inner) {
  const re = new RegExp(`(<!--HW:${tag}-->)[\\s\\S]*?(<!--/HW:${tag}-->)`);
  if (!re.test(html)) throw new Error("marker missing: " + tag);
  return html.replace(re, (_, a, b) => a + inner + b);
}

export function bake(html) {
  html = fill(html, "CAL", cal());
  html = fill(html, "GQ3", gq3());
  html = fill(html, "FAQ", faqHtml());
  const ld = /("@type":"FAQPage","mainEntity":\[)[\s\S]*?(\]\}\]\}<\/script>)/;
  if (!ld.test(html)) throw new Error("FAQPage JSON-LD missing");
  return html.replace(ld, (_, a, b) => a + faqLd() + b);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cur = readFileSync(PAGE, "utf8"), next = bake(cur);
  if (process.argv.includes("--check")) {
    if (cur !== next) { console.error("harvest-or-wait.html is stale: run node scripts/build_harvest_wait.mjs"); process.exit(1); }
    console.log("harvest-or-wait.html: tables and questions match components/harvest-wait.js");
  } else {
    if (cur !== next) writeFileSync(PAGE, next);
    console.log("harvest-or-wait.html " + (cur !== next ? "written" : "unchanged"));
  }
}
