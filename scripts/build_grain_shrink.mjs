#!/usr/bin/env node
/* build_grain_shrink.mjs: bakes the static parts of /grain-shrink from the
 * same math the page runs (components/grain-shrink.js), so a crawler, a
 * printer and a reader with no script see the calculator's own numbers:
 *   <!--GS:WATER-->  water shrink per point by base moisture
 *   <!--GS:SOY-->    soybeans under 13%: share not paid for, bu per 1,000
 *   <!--GS:CORN-->   corn under 15.5%, the same
 *   <!--GS:FAQ-->    the questions, and the same text as the FAQPage
 *                    JSON-LD mainEntity, from one list so they cannot drift
 *
 *   node scripts/build_grain_shrink.mjs          # write grain-shrink.html
 *   node scripts/build_grain_shrink.mjs --check  # exit 1 if the page is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAGE = ROOT + "grain-shrink.html";
const ctx = {};
vm.runInNewContext(readFileSync(ROOT + "components/grain-shrink.js", "utf8"), ctx);
const S = ctx.AgShrink;

const f = (x, d) => x.toFixed(d);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

/* Every figure below is either from the cited source as read, or the
   calculator's own arithmetic on the source's example (the tests redo each). */
const corn28 = (f1) => S.handlingIn(28, 15.5, { method: "factor", factor: f1 });
export const FAQ = [
  ["How is grain shrink calculated?",
   "Water shrink is 100 times the points removed, divided by 100 minus the base moisture. Drying corn from 25% to 15.5% takes out 9.5 points: 9.5 x 100 / 84.5 = 11.24% of the wet weight. Buyers then add handling loss, either a flat 0.5% on a drying table (11.74% total) or by using a flat factor per point, such as 1.3% a point (12.35% total). That is from NCH-61, the National Corn Handbook shrink publication."],
  ["What is a normal shrink factor for corn?",
   "NCH-61 says flat factors typically run 1.2 to 1.5% a point. Water alone is 1.183% a point when the base is 15.5%, so anything over that is handling loss. On 28% corn, a 1.25 factor assumes " + f(corn28(1.25), 2) + "% handling loss and a 1.4 factor assumes " + f(corn28(1.4), 2) + "%. Iowa State measured 0.22 to 1.71% on farms and 0.64 to 1.33% at commercial dryers; NCH-61 calls more than 1% a bigger loss than those surveys found."],
  ["Should I sell wet corn or dry it myself?",
   "Run both. Iowa State's 2019 example: 1,000 wet bushels of 20.5% corn at $3.50, with a 4.8 cent drying charge a point and a 1.4% factor from a 15% base, nets $2,967 sold wet. Dried on the farm at their figured 3 cents a point, with 1% handling loss and $40 of extra hauling, the same corn netted $3,033. Your elevator's numbers and your own drying cost decide it: the \"Sell wet, or dry it myself?\" box on this page runs both sides with your LP, power and haul."],
  ["How much do overdry soybeans cost?",
   "Beans delivered under 13% are paid on the weight you haul, so the water you dried off is beans you did not sell. At 9%, 1,000 delivered bushels would have been " + f(S.overdry({ m: 9, base: 13, bu: 1000 }).atBase, 0) + " bushels at 13%, " + f(S.overdry({ m: 9, base: 13, bu: 1000 }).extraBu, 0) + " more. Nebraska CropWatch's example: 75 bushels an acre at 13% harvested at 9% sells 3.3 fewer bushels an acre, $33 an acre at $10 beans."],
  ["What is the base moisture for corn, soybeans, wheat and sorghum?",
   "Arkansas Extension's FSA1078 lists corn 15.5%, soybeans 13%, wheat 13.5% and grain sorghum 14%. Those are the defaults here. Your elevator's discount sheet is the one that counts, so change the base box to match it."],
  ["Is a moisture discount the same as shrink?",
   "Not quite. Some buyers knock a share off the price instead of the bushels: Iowa State's example takes 2% of the price per point over 15%, 11% for 20.5% corn. Paid on wet bushels, that comes to the same dollars as a flat 2% a point shrink with no drying charge, so enter it that way."],
  ["Where does the bid come from?",
   "Type your own, or enter your ZIP and the page uses the nearest elevator's posted bid for that grain from the same boards as the cash bids page. If that board was posted before today and states its futures month, the page re-marks it to today's futures the way the cash bids page does and shows the posted price beside it. With no ZIP, pick a state and the page uses the latest futures price less that state's median basis: the settle once it is recorded, otherwise the delayed quote with the time it was read. Sorghum has no state basis yet, so it needs your ZIP or your own bid."]
];

function water() {
  const rows = [[15.5, "Corn"], [15, ""], [14, "Grain sorghum"], [13.5, "Wheat"], [13, "Soybeans"]];
  return "\n" + rows.map(([b, u]) =>
    `<tr><th scope="row">${b}%</th><td>${f(S.waterFactor(b), 3)}%</td><td style="font-family:inherit;color:var(--text-dim)">${u}</td></tr>`).join("\n") + "\n";
}
function under(base, list) {
  return "\n" + list.map((m) => {
    const o = S.overdry({ m, base, bu: 1000 });
    return `<tr><th scope="row">${m}%</th><td>${f(o.lossPct, 1)}%</td><td>${f(o.extraPer1000, 1)}</td></tr>`;
  }).join("\n") + "\n";
}
function faqHtml() {
  return "\n" + FAQ.map(([q, a]) => `        <details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n") + "\n";
}
function faqLd() {
  return FAQ.map(([q, a]) => JSON.stringify({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })).join(",");
}

function fill(html, tag, inner) {
  const re = new RegExp(`(<!--GS:${tag}-->)[\\s\\S]*?(<!--/GS:${tag}-->)`);
  if (!re.test(html)) throw new Error("marker missing: " + tag);
  return html.replace(re, (_, a, b) => a + inner + b);
}

export function bake(html) {
  html = fill(html, "WATER", water());
  html = fill(html, "SOY", under(13, [12, 11, 10, 9, 8]));
  html = fill(html, "CORN", under(15.5, [15, 14.5, 14, 13.5, 13]));
  html = fill(html, "FAQ", faqHtml());
  const ld = /("@type":"FAQPage","mainEntity":\[)[\s\S]*?(\]\}\]\}<\/script>)/;
  if (!ld.test(html)) throw new Error("FAQPage JSON-LD missing");
  html = html.replace(ld, (_, a, b) => a + faqLd() + b);
  return html;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cur = readFileSync(PAGE, "utf8"), next = bake(cur);
  if (process.argv.includes("--check")) {
    if (cur !== next) { console.error("grain-shrink.html is stale: run node scripts/build_grain_shrink.mjs"); process.exit(1); }
    console.log("grain-shrink.html: tables and questions match components/grain-shrink.js");
  } else {
    if (cur !== next) writeFileSync(PAGE, next);
    console.log("grain-shrink.html " + (cur !== next ? "written" : "unchanged"));
  }
}
