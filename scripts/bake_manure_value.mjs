#!/usr/bin/env node
/* bake_manure_value.mjs -- write today's manure values into the HTML.
 *
 * components/manure-value.js owns the nutrient table and the price math. This
 * runs that same file (no second copy of the math) against
 * data/fertilizer-prices.json and writes, between markers:
 *
 *   manure-value.html  every [data-mv] number, the value table (all the
 *                      nutrients, and the first-year part), the pounds
 *                      table (A2809 Table 9.2 totals and Table 9.3 first year), the meta description and the FAQ (the
 *                      FAQPage JSON-LD and the visible FAQ, word for word)
 *   fast-facts.html    the Manure tab's pounds table
 *
 * so a reader with no JavaScript, and a search engine, see the same numbers
 * the page computes live. The page rewrites the [data-mv] numbers from the
 * live file on load; the co-op price workflow (fertilizer-coops) runs this
 * after every price change, so the baked copy and the live copy agree.
 *
 *   node scripts/bake_manure_value.mjs           write
 *   node scripts/bake_manure_value.mjs --check   exit 1 if a file is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

export function loadModule() {
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync(ROOT + "components/manure-value.js", "utf8"), ctx);
  return ctx.window.AgManure;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");
const fill = (tpl, v) => tpl.replace(/\{([a-z0-9_-]+)\}/g, (m, k) => {
  if (!(k in v)) throw new Error("no baked value " + k);
  return v[k];
});

/* The FAQ. One list; the JSON-LD and the visible block are both written from
   it, so they match word for word. {key} is a value from bakeValues(), or
   tot-n|p|k-<type>, a type's A2809 Table 9.2 total pounds. */
export const FAQ = [
  ["How much is dairy manure worth per 1,000 gallons?",
   "At {region-co-op} fertilizer prices posted through {asof-n}, all the N, P2O5 and K2O in 1,000 gallons of liquid dairy manure at 4 to 11% dry matter is worth about {all-dairy_liq_4_11}. That is {tot-n-dairy_liq_4_11} lb of N, {tot-p-dairy_liq_4_11} lb of P2O5 and {tot-k-dairy_liq_4_11} lb of K2O, the typical totals in UW Extension A2809 (Table 9.2). The part a crop can use the first year is worth about {fy-dairy_liq_4_11-1to3day} if it is worked into the soil within 3 days, {fy-dairy_liq_4_11-lt1hr} injected or worked in within an hour, and {fy-dairy_liq_4_11-gt3day} left on top longer. A lab test of your own manure beats the book."],
  ["How much is manure worth per ton?",
   "At {region-co-op} fertilizer prices posted through {asof-n}, all the N, P2O5 and K2O in a ton of solid dairy manure over 20% dry matter is worth about {all-dairy_solid_gt20}, beef manure about {all-beef_solid}, hog manure about {all-swine_solid}, and chicken litter about {all-chicken_solid}, by UW Extension A2809's typical totals. Liquid dairy manure at 4 to 11% dry matter works out to about {all-ton-dairy_liq_4_11} a ton, since 1,000 gallons weighs a little over 4 tons."],
  ["Is this the value of all the nutrients in the manure?",
   "Yes. The headline numbers price every pound of N, P2O5 and K2O in the manure, using UW Extension A2809's typical totals for Wisconsin manure tested from 1998 to 2012 (Table 9.2). The crop does not get it all the first year. UW counts 80% of the P2O5 and K2O and 25 to 65% of the N, depending on the manure and how fast it is worked in (Table 9.1), so the first-year value is shown beside each total. Your own manure test beats the book: type it into the calculator under Use my manure test."],
  ["What is the manure on a whole field worth?",
   "Liquid dairy manure at 4 to 11% dry matter, 6,000 gallons an acre, puts on {ex-n-lb} lb of N, {ex-p-lb} lb of P2O5 and {ex-k-lb} lb of K2O an acre by UW's typical totals. At {region-co-op} prices posted through {asof-n} that is {ex-n-ac} of N, {ex-p-ac} of P2O5 and {ex-k-ac} of K2O, {ex-all-ac} an acre, or {ex-all-field} for 80 acres. Worked in within 3 days, the part a crop can use the first year is worth {ex-fy-ac} an acre, {ex-fy-field} for the 80 acres."],
  ["Why is phosphorus priced with the nitrogen taken out?",
   "Phosphate here is priced from {p-prod}, which carries {p-nlb} lb of N in every ton along with its P2O5. Charging the whole price to phosphorus makes P2O5 look about {price-p-raw} a pound. Crediting the N at the urea price, about {p-ncredit} a ton, puts P2O5 at about {price-p} a pound. MAP is used when co-ops or USDA price it, DAP when they do not."],
  ["How do I get manure tested and what does it cost?",
   "Use a lab certified for manure analysis in your state and ask for total N, ammonium N, P2O5, K2O and dry matter. Sample during hauling, after the pit is well agitated: take a cup from several loads, mix them in a clean pail, fill a plastic jar about three quarters full, keep it cold and ship it early in the week. For solid manure, take 10 to 20 handfuls from different spots or loads and mix. Tests commonly run $25 to $60 a sample. Test every year for a few years to learn your own manure."],
];

const DESC = "At {region-co-op} prices posted {asof-n}, all the N, P and K in liquid dairy manure is worth about {all-dairy_liq_4_11} per 1,000 gal; {fy-dairy_liq_4_11-1to3day} usable the first year.";

const TIMINGS = ["gt3day", "1to3day", "lt1hr"];

/* bakeValues() plus each type's Table 9.2 total pounds, for the FAQ. */
function faqValues(M, v) {
  const out = { ...v };
  for (const t of M.TYPES) ["n", "p", "k"].forEach((x, i) => { out[`tot-${x}-${t.id}`] = String(t.tot[i]); });
  return out;
}

function valueTable(M, v) {
  let g = "", rows = "";
  for (const t of M.TYPES) {
    if (t.group !== g) { rows += `  <tr class="mv-g"><th colspan="5" scope="colgroup">${t.group}</th></tr>\n`; g = t.group; }
    const unit = t.liquid ? "1,000 gal" : "ton";
    const ton = t.liquid ? `<small><span data-mv="all-ton-${t.id}">${v[`all-ton-${t.id}`]}</span> a ton</small>` : "";
    const all = `<td class="hi"><span data-mv="all-${t.id}">${v[`all-${t.id}`]}</span>${ton}</td>`;
    const cells = TIMINGS.map((x) => `<td data-mv="fy-${t.id}-${x}">${v[`fy-${t.id}-${x}`]}</td>`).join("");
    rows += `  <tr><th scope="row">${esc(t.label)} <span>per ${unit}</span></th>${all}${cells}</tr>\n`;
  }
  return `<div class="mv-tw" tabindex="0" role="region" aria-label="Manure value table, scrolls sideways"><table class="mv-t mv-val">
<thead>
  <tr><th class="tl" rowspan="2" scope="col">Manure</th><th rowspan="2" scope="col">All the nutrients</th><th colspan="3" scope="colgroup" class="mv-cg">What the crop can use the first year</th></tr>
  <tr><th scope="col">Left on top 3+ days</th><th scope="col">Worked in, 1 hr to 3 days</th><th scope="col">Within 1 hr</th></tr>
</thead>
<tbody>
${rows}</tbody></table></div>`;
}

function poundsTable(M, cls) {
  let g = "", rows = "";
  for (const t of M.TYPES) {
    if (t.group !== g) { rows += `  <tr class="${cls.g}"><td class="tl" colspan="9">${t.group}</td></tr>\n`; g = t.group; }
    const u = t.liquid ? "lb/1,000 gal" : "lb/ton";
    rows += `  <tr><td class="tl">${esc(t.label)} (${u})</td>` +
      t.tot.map((x) => `<td class="hi">${x}</td>`).join("") +
      t.n.map((n) => `<td>${n} [${t.n2}]</td>`).join("") +
      `<td>${t.p}</td><td>${t.k}</td></tr>\n`;
  }
  return `<div class="${cls.wrap}" tabindex="0" role="region" aria-label="Total and first-year nutrients by manure type, scrolls sideways"><table class="${cls.table}">
<thead>
  <tr><th class="tl" rowspan="2">Manure type</th><th colspan="3">Total in the manure</th><th colspan="3">N the crop can use, 1st yr [2nd yr]</th><th colspan="2">P and K, 1st yr</th></tr>
  <tr><th>N</th><th>P&#x2082;O&#x2085;</th><th>K&#x2082;O</th><th>Not in 3 days</th><th>1 hr&ndash;3 days</th><th>Within 1 hr</th><th>P&#x2082;O&#x2085;</th><th>K&#x2082;O</th></tr>
</thead>
<tbody>
${rows}</tbody></table></div>`;
}

function between(src, name, body, file) {
  const a = `<!--MV:${name}-->`, b = `<!--/MV:${name}-->`;
  const i = src.indexOf(a), j = src.indexOf(b);
  if (i < 0 || j < i) throw new Error(`${file}: markers ${a} ${b} not found`);
  return src.slice(0, i + a.length) + "\n" + body + "\n" + src.slice(j);
}

export function bakeManurePage(src, M, data) {
  const v = M.bakeValues(data);
  // Tables first (they carry their own fresh data-mv cells), then every other number.
  let out = between(src, "VALUES", valueTable(M, v), "manure-value.html");
  out = between(out, "POUNDS", poundsTable(M, { g: "mv-g", wrap: "mv-tw", table: "mv-t mv-lb" }), "manure-value.html");
  out = out.replace(/(<(\w+)\b[^>]*\bdata-mv="([a-z0-9_-]+)"[^>]*>)([^<]*)(<\/\2>)/g, (m, open, tag, key, old, close) => {
    if (!(key in v)) throw new Error("manure-value.html: unknown data-mv key " + key);
    return open + esc(v[key]) + close;
  });
  const fv = faqValues(M, v);
  const pairs = FAQ.map(([q, a]) => [q, fill(a, fv)]);
  const vis = pairs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n");
  out = between(out, "FAQ", vis, "manure-value.html");
  const desc = fill(DESC, v);
  out = out.replace(/(<meta (?:name="description"|property="og:description"|name="twitter:description")\s+content=")[^"]*(")/g, (m, a, b) => a + escAttr(desc) + b);
  // JSON-LD: the FAQPage mainEntity and the WebPage description
  out = out.replace(/(<script type="application\/ld\+json" id="mv-ld">)([\s\S]*?)(<\/script>)/, (m, a, body, c) => {
    const ld = JSON.parse(body);
    for (const n of ld["@graph"]) {
      if (n["@type"] === "FAQPage") n.mainEntity = pairs.map(([q, a2]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a2 } }));
      if (n["@type"] === "WebPage") n.description = desc;
    }
    return a + JSON.stringify(ld) + c;
  });
  return out;
}

export function bakeFastFacts(src, M) {
  return between(src, "POUNDS", poundsTable(M, { g: "tg", wrap: "ff-tw", table: "ff-t" }), "fast-facts.html");
}

function main() {
  const check = process.argv.includes("--check");
  const M = loadModule();
  const data = JSON.parse(readFileSync(ROOT + "data/fertilizer-prices.json", "utf8"));
  let stale = 0;
  for (const [file, fn] of [["manure-value.html", (s) => bakeManurePage(s, M, data)], ["fast-facts.html", (s) => bakeFastFacts(s, M)]]) {
    const src = readFileSync(ROOT + file, "utf8");
    const out = fn(src);
    if (out === src) { console.log(`ok    ${file}`); continue; }
    if (check) { console.log(`STALE ${file}: run node scripts/bake_manure_value.mjs`); stale++; }
    else { writeFileSync(ROOT + file, out); console.log(`wrote ${file}`); }
  }
  process.exit(stale ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
