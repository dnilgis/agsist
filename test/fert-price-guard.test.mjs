/* One fertilizer price source for the whole site (Sig, 2026-10-15).
 *
 * Every fertilizer price on agsist.com comes from data/fertilizer-prices.json,
 * built by scripts/build_fert_prices.py from the co-op posted prices and the
 * USDA AMS Illinois report. No page or script keeps its own number.
 *
 * This fails if any page (root *.html) or browser script (components/*.js)
 * types a fertilizer price: a dollar figure per ton next to a fertilizer
 * name, or a dollar figure per pound of N, P2O5 or K2O. Allowed:
 *   * the parts a baker writes from the shared file and rewrites every
 *     weekday (manure-value.html [data-mv] numbers, its FAQ and meta,
 *     breakeven.html's FERT:SRC line and CROP_DEFAULTS fertilizer, and the
 *     title / description / share tags bake_seo.py and build_share_images.py
 *     stamp on fertilizer.html, manure-value.html and breakeven.html, and
 *     the co-op line bake_seo.py body_fertilizer writes into fertilizer.html
 *     between <!--BAKE:fert-bar--> and <!--/BAKE-->, Sig Oct 19), each
 *     checked current by its own test or --check;
 *   * documented sensitivities, which are arithmetic, not prices:
 *     "a $100/ton price increase adds roughly $17/acre";
 *   * changelog.html, which is history.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");

const FERT = String.raw`(?:urea|potash|DAP|MAP|anhydrous|NH3|UAN|ammonium sulfate|AMS|fertili[sz]er|10-34-0|thio-?sul|K-Mag|46-0-0|82-0-0|18-46-0|11-52-0|0-0-60)`;
const PER_TON = new RegExp(String.raw`\$\s?\d{2,4}(?:,\d{3})?(?:\.\d+)?\s?(?:/|a |per )\s?ton`, "gi");
const PER_LB = new RegExp(String.raw`\$\s?0?\.\d{2,3}\s?(?:/|a |per )\s?(?:lb|pound)\.?\s?(?:of\s)?(?:N\b|P\b|K\b|P2O5|K2O|P&#x?8322;|K&#x?8322;|P₂|K₂|nitrogen|phosph|potash)`, "gi");
const SENSITIVITY = /\$\d+\s?\/\s?ton (?:price )?(?:increase|rise|change|drop|move)|\$\d+\s?\/\s?ton (?:adds|raises|cuts)/i;

/* Regions a baker owns: rewritten from the shared file, checked elsewhere. */
function stripBaked(file, s) {
  s = s.replace(/<!--MV:(\w+)-->[\s\S]*?<!--\/MV:\1-->/g, " ")
    .replace(/<!--FERT:SRC-->[\s\S]*?<!--\/FERT:SRC-->/g, " ")
    .replace(/<(\w+)\b[^>]*\bdata-mv="[^"]*"[^>]*>[^<]*<\/\1>/g, " ");
  if (["fertilizer.html", "manure-value.html", "breakeven.html"].includes(file)) {
    s = s.replace(/<title>[\s\S]*?<\/title>/, " ").replace(/<meta [^>]*>/g, " ")
      .replace(/<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g, " ")
      .replace(/<!--BAKE:[\w-]+-->[\s\S]*?<!--\/BAKE:[\w-]+-->/g, " ");
  }
  // Sig Oct 19: the description's sentence, baked into the body (checked below and by fert-head)
  if (file === "fertilizer.html") s = s.replace(/<!--BAKE:fert-bar-->[\s\S]*?<!--\/BAKE-->/, " ");
  if (file === "manure-value.html") s = s.replace(/<details><summary>[\s\S]*?<\/details>/g, " ");
  if (file === "breakeven.html") s = s.replace(/\bfertilizer:\d+/g, "fertilizer:BAKED");
  return s;
}

function offenders(file, src) {
  const s = stripBaked(file, src).replace(/\s+/g, " ");
  const out = [];
  for (const m of s.matchAll(PER_TON)) {
    const around = s.slice(Math.max(0, m.index - 90), m.index + m[0].length + 60);
    if (!new RegExp(FERT, "i").test(around)) continue;
    if (SENSITIVITY.test(s.slice(m.index, m.index + 60))) continue;
    out.push(`${file}: ${around.trim()}`);
  }
  for (const m of s.matchAll(PER_LB)) out.push(`${file}: ${s.slice(Math.max(0, m.index - 60), m.index + 60).trim()}`);
  return out;
}

const PAGES = readdirSync(ROOT).filter((f) => f.endsWith(".html") && f !== "changelog.html");
const SCRIPTS = readdirSync(ROOT + "components").filter((f) => f.endsWith(".js")).map((f) => "components/" + f);

test("no page or browser script types its own fertilizer price", () => {
  const bad = [];
  for (const f of PAGES.concat(SCRIPTS)) bad.push(...offenders(f, read(f)));
  assert.deepEqual(bad, [], "type no fertilizer price; read data/fertilizer-prices.json:\n" + bad.join("\n"));
});

/* Price inputs open empty and fill from the shared file; a script never
   falls back to a typed price (fast-facts once opened at $560/ton urea and
   $0.61, $0.60, $0.33 a lb, and fell back to $0.60 and $0.33). */
function priceDefaults(file, src) {
  const out = [];
  for (const m of src.matchAll(/<input\b[^>]*\bid="([^"]*(?:fertprice|pplb)[^"]*)"[^>]*>/gi)) {
    const v = /\bvalue="([^"]*)"/.exec(m[0]);
    if (v && v[1] !== "") out.push(`${file}: #${m[1]} opens at ${v[1]}`);
  }
  for (const m of src.matchAll(/(?:pplb|Pplb|fertprice|PPLB)[^;\n]{0,80}\|\|\s*\d*\.\d+/g)) out.push(`${file}: fallback ${m[0]}`);
  return out;
}

test("price inputs open empty and no script falls back to a typed price", () => {
  const bad = [];
  for (const f of PAGES.concat(SCRIPTS)) bad.push(...priceDefaults(f, read(f)));
  assert.deepEqual(bad, []);
  assert.equal(priceDefaults("x.html", '<input id="eco-p-pplb" type="number" value="0.60">').length, 1);
  assert.equal(priceDefaults("x.js", "var p=parseFloat(el.value)||0; var pPplb=parseFloat(x.value)||0.60;").length, 1);
});

test("the guard catches a typed price and lets a sensitivity through", () => {
  assert.equal(offenders("x.html", "<p>Urea is $590/ton at the dealer.</p>").length, 1);
  assert.equal(offenders("x.html", "<p>At about $0.55 to $0.70 per lb N.</p>").length, 1);
  assert.equal(offenders("x.html", "<p>MAP $930/ton</p>").length, 1);
  assert.equal(offenders("x.html", "<p>a $100/ton price increase adds roughly $17/acre to fertilizer costs</p>").length, 0);
  assert.equal(offenders("x.html", "<p>Cash rent $250/ac</p>").length, 0);
  assert.equal(offenders("manure-value.html", '<b data-mv="price-n">$0.64</b>').length, 0, "a baked number is the baker's");
});

test("nothing reads the old dealer sheet", () => {
  const bad = [];
  for (const f of PAGES.concat(SCRIPTS)) if (/data\/fertilizer\.json|fertilizer-history\.json/.test(read(f))) bad.push(f);
  for (const f of readdirSync(ROOT + "scripts").filter((x) => /\.(py|mjs|js|sh)$/.test(x))) {
    if (/data\/fertilizer\.json|fertilizer-history\.json|update_fertilizer/.test(read("scripts/" + f))) bad.push("scripts/" + f);
  }
  assert.deepEqual(bad, []);
});

/* Sig, 2026-10-15: prices come only from the co-op pages he sent; 2026-10-16:
   the USDA AMS Illinois report is off /fertilizer. No page or browser script
   reads the USDA file (fertilizer-ams.yml may still keep it as a background
   data file). */
test("no page or script reads the USDA file; nothing blends it in", () => {
  const bad = [];
  for (const f of PAGES.concat(SCRIPTS)) {
    if (/fertilizer-ams\.json/.test(read(f))) bad.push(f);
  }
  for (const f of ["scripts/build_fert_prices.py", "scripts/bake_fert_defaults.py", "scripts/bake_manure_value.mjs", "scripts/fert_after_prices.sh"]) {
    if (/fertilizer-ams/.test(read(f))) bad.push(f);
  }
  assert.deepEqual(bad, []);
  const prices = JSON.parse(read("data/fertilizer-prices.json"));
  assert.ok(prices.prices.length > 0 && prices.prices.every((p) => p.src === "coop"), "a non-co-op price in the shared file");
});

test("the baked fertilizer numbers are current with the shared file", () => {
  // breakeven.html's fertilizer defaults and their source line
  execFileSync("python3", ["scripts/bake_fert_defaults.py", "--check"], { cwd: ROOT, encoding: "utf8" });
  // manure-value.html and the fast-facts manure table
  execFileSync("node", ["scripts/bake_manure_value.mjs", "--check"], { cwd: ROOT, encoding: "utf8" });
  // fertilizer.html's baked co-op line (Sig Oct 19): every price it names is the shared file's, rounded
  const bar = /<!--BAKE:fert-bar-->([\s\S]*?)<!--\/BAKE-->/.exec(read("fertilizer.html"));
  assert.ok(bar, "fertilizer.html has its baked co-op line");
  const KEY = { urea: "urea", anhydrous: "anhydrous", DAP: "dap", MAP: "map", potash: "potash" };
  const rows = Object.fromEntries(JSON.parse(read("data/fertilizer-prices.json")).prices.map((p) => [p.key, p]));
  for (const m of bar[1].matchAll(/\b(urea|anhydrous|DAP|MAP|potash) \$([\d,]+)/g)) {
    const r = rows[KEY[m[1]]];
    assert.ok(r && Math.round(r.price) === Number(m[2].replace(/,/g, "")), `baked ${m[0]} vs the file's ${r && r.price}`);
  }
  assert.equal(offenders("fertilizer.html", "<div><!--BAKE:other-->Urea $590/ton<!--/BAKE--></div>").length, 1, "only the fert-bar line is the baker's");
});
