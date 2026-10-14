#!/usr/bin/env node
/* bake_manure_value.mjs -- write today's manure values into the HTML.
 *
 * components/manure-value.js owns the nutrient table and the price math. This
 * runs that same file (no second copy of the math) against
 * data/fertilizer.json and writes, between markers:
 *
 *   manure-value.html  every [data-mv] number, the book value table, the
 *                      pounds table, the meta description and the FAQ (the
 *                      FAQPage JSON-LD and the visible FAQ, word for word)
 *   fast-facts.html    the Manure tab's pounds table
 *
 * so a reader with no JavaScript, and a search engine, see the same numbers
 * the page computes live. The page rewrites the [data-mv] numbers from the
 * live file on load; the fertilizer-update workflow runs this after every
 * price change, so the baked copy and the live copy agree.
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
   it, so they match word for word. {key} is a value from bakeValues(). */
export const FAQ = [
  ["How much is dairy manure worth per 1,000 gallons?",
   "At Midwest dealer prices from {asof-n}, liquid dairy manure at 4 to 11% dry matter, worked into the soil within 3 days, carries about {unit-dairy_liq_4_11-1to3day} of fertilizer per 1,000 gallons: 10 lb of first-year N, 6 lb of P2O5 and 17 lb of K2O. Injected or worked in within an hour it is about {unit-dairy_liq_4_11-lt1hr}. Left on top for more than 3 days it is about {unit-dairy_liq_4_11-gt3day}. These are book values from UW Extension A2809. A lab test of your own manure is better."],
  ["How much is manure worth per ton?",
   "At {asof-n} dealer prices, solid dairy manure over 20% dry matter is worth about {unit-dairy_solid_gt20-1to3day} a ton in fertilizer, beef manure about {unit-beef_solid-1to3day}, hog manure about {unit-swine_solid-1to3day}, and chicken litter about {unit-chicken_solid-1to3day}, worked in within 3 days. Liquid dairy manure works out to about {ton-dairy_liq_4_11-1to3day} a ton, since 1,000 gallons weighs a little over 4 tons."],
  ["What should I charge a neighbor for manure?",
   "Less than the book value. The book value is what the N, P and K would cost to buy, so it is the most a buyer could pay, and only if he needs all three. He saves nothing on P or K his soil test says he does not need, and someone has to pay to haul and spread it. A fair price sits between what the manure would have saved on your own fields and what it saves him after hauling. Liquid manure is usually priced per 1,000 gallons applied, solid manure per ton at the pile or spread."],
  ["Who pays for hauling and spreading manure?",
   "Either side can, and it changes the price more than anything else. Custom injection of liquid manure has run roughly $13 to $17 per 1,000 gallons in Iowa State University custom rate surveys, close to the whole book value of dairy manure. When the seller has to empty the pit anyway, he often hauls and spreads and the buyer pays for the nutrients. When the buyer pays to haul, there is often little left to pay for the manure itself."],
  ["Why is phosphorus priced from MAP with the nitrogen taken out?",
   "MAP 12-40-0-10S carries 240 lb of N in every ton along with 800 lb of P2O5. Charging the whole price to phosphorus makes P look about {price-p-raw} a pound. Crediting the N at the urea price, about {map-ncredit} a ton, puts P2O5 at about {price-p} a pound. The sulfur is not credited, so this still runs a little high."],
  ["How do I get manure tested and what does it cost?",
   "Use a lab certified for manure analysis in your state and ask for total N, ammonium N, P2O5, K2O and dry matter. Sample during hauling, after the pit is well agitated: take a cup from several loads, mix them in a clean pail, fill a plastic jar about three quarters full, keep it cold and ship it early in the week. For solid manure, take 10 to 20 handfuls from different spots or loads and mix. Tests commonly run $25 to $60 a sample. Test every year for a few years to learn your own manure."],
];

const DESC = "At {asof-n} dealer prices, liquid dairy manure carries about {unit-dairy_liq_4_11-1to3day} of fertilizer per 1,000 gal and solid dairy about {unit-dairy_solid_gt20-1to3day} a ton. What a neighbor should pay, and a calculator.";

const TIMINGS = ["gt3day", "1to3day", "lt1hr"];

function valueTable(M, v) {
  let g = "", rows = "";
  for (const t of M.TYPES) {
    if (t.group !== g) { rows += `  <tr class="mv-g"><th colspan="5" scope="colgroup">${t.group}</th></tr>\n`; g = t.group; }
    const unit = t.liquid ? "1,000 gal" : "ton";
    const cells = TIMINGS.map((x) => `<td data-mv="unit-${t.id}-${x}">${v[`unit-${t.id}-${x}`]}</td>`).join("");
    const ton = t.liquid ? `<td data-mv="ton-${t.id}-1to3day">${v[`ton-${t.id}-1to3day`]}</td>` : `<td class="mv-same">same</td>`;
    rows += `  <tr><th scope="row">${esc(t.label)} <span>per ${unit}</span></th>${cells}${ton}</tr>\n`;
  }
  return `<div class="mv-tw" tabindex="0" role="region" aria-label="Manure book value table, scrolls sideways"><table class="mv-t">
<thead><tr><th scope="col">Manure</th><th scope="col">Not worked in for 3+ days</th><th scope="col">Worked in, 1 hour to 3 days</th><th scope="col">Within 1 hour</th><th scope="col">A ton, worked in 1 hour to 3 days</th></tr></thead>
<tbody>
${rows}</tbody></table></div>`;
}

function poundsTable(M, cls) {
  let g = "", rows = "";
  for (const t of M.TYPES) {
    if (t.group !== g) { rows += `  <tr class="${cls.g}"><td class="tl" colspan="6">${t.group}</td></tr>\n`; g = t.group; }
    const u = t.liquid ? "lb/1,000 gal" : "lb/ton";
    rows += `  <tr><td class="tl">${esc(t.label)} (${u})</td>` +
      t.n.map((n, i) => `<td${i === 2 ? ' class="hi"' : ""}>${n} [${t.n2}]</td>`).join("") +
      `<td>${t.p}</td><td>${t.k}</td></tr>\n`;
  }
  return `<div class="${cls.wrap}" tabindex="0" role="region" aria-label="Available nutrients by manure type, scrolls sideways"><table class="${cls.table}">
<thead>
  <tr><th class="tl" rowspan="2">Manure type</th><th colspan="3">N: 1st yr [2nd yr]</th><th rowspan="2">P&#x2082;O&#x2085;</th><th rowspan="2">K&#x2082;O</th></tr>
  <tr><th>Not in 3 days</th><th>1 hr&ndash;3 days</th><th>Within 1 hr</th></tr>
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
  let out = src.replace(/(<(\w+)\b[^>]*\bdata-mv="([a-z0-9_-]+)"[^>]*>)([^<]*)(<\/\2>)/g, (m, open, tag, key, old, close) => {
    if (!(key in v)) throw new Error("manure-value.html: unknown data-mv key " + key);
    return open + esc(v[key]) + close;
  });
  out = between(out, "VALUES", valueTable(M, v), "manure-value.html");
  out = between(out, "POUNDS", poundsTable(M, { g: "mv-g", wrap: "mv-tw", table: "mv-t mv-lb" }), "manure-value.html");
  const pairs = FAQ.map(([q, a]) => [q, fill(a, v)]);
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
  const data = JSON.parse(readFileSync(ROOT + "data/fertilizer.json", "utf8"));
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
