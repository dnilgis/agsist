#!/usr/bin/env node
/* bake_fert_page.mjs -- the co-op cards and the lede's "Right now" line in fertilizer.html.
 *
 * Oct 19, 2026 phone audit: a fresh visit to /fertilizer scored a layout shift
 * of about 0.57 (390 x 844) and 0.40 (1280 x 800). The page opened with an
 * empty, hidden #fert-coops section and an empty #fert-lede-when span; when
 * the two price files arrived, the script drew the co-op cards and the
 * "Right now: ... posted ..." line, and everything under them jumped down.
 *
 * This writes both into the HTML from the same files and the same code the
 * page runs, so the first paint already has them and the live draw lands on
 * the same boxes:
 *
 *   <!--BAKE:fert-cards-->  the whole <section id="fert-coops">, drawn by
 *                           components/fert-coops.js top() from
 *                           data/fertilizer-coops.json (hidden and empty
 *                           when that file has nothing to show, as before)
 *   <!--BAKE:fert-lede-->   inside #fert-lede-when: the page's own ledeWhen()
 *                           from data/fertilizer-prices.json, the file the
 *                           baked body line (bake_seo.py fert-bar) reads
 *
 * No second copy of the drawing code: fert-coops.js is run as it ships, and
 * ledeWhen() / validPrice() are read out of fertilizer.html's own script.
 * scripts/fert_after_prices.sh runs this after every price change, in the
 * same commit as the files it reads.
 *
 *   node scripts/bake_fert_page.mjs           write
 *   node scripts/bake_fert_page.mjs --check   exit 1 if fertilizer.html is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAGE = "fertilizer.html";

function loadJSON(f) {
  try { return JSON.parse(readFileSync(ROOT + f, "utf8")); } catch (e) { return null; }
}

/* function name(...) {...} out of a script, by brace depth. */
function liftFn(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error(PAGE + " has no function " + name + "()");
  let d = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}" && --d === 0) break;
  }
  return src.slice(i, j + 1) + "\n";
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function loadFertCoops() {
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync(ROOT + "components/fert-coops.js", "utf8"), ctx);
  return ctx.window.FertCoops;
}

export function ledeWhenFrom(page) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(liftFn(page, "validPrice") + liftFn(page, "ledeWhen"), ctx);
  return ctx.ledeWhen;
}

function between(src, name, inner) {
  const re = new RegExp("(<!--BAKE:" + name + "-->)[\\s\\S]*?(<!--/BAKE-->)");
  if (!re.test(src)) throw new Error(PAGE + " has no <!--BAKE:" + name + "--> markers");
  return src.replace(re, (m, a, b) => a + inner + b);
}

/* The section the page script fills: shown with the cards, or hidden and empty. */
export function cardsSection(FC, coops) {
  const th = FC.top(coops);
  return '<section id="fert-coops" aria-labelledby="fert-coops-h"' + (th ? ">" + th : " hidden>") + "</section>";
}

export function bakeFertPage(src, coops, prices, FC = loadFertCoops()) {
  let out = between(src, "fert-cards", cardsSection(FC, coops));
  const lt = prices && prices.prices ? ledeWhenFrom(src)(prices) : "";
  out = between(out, "fert-lede", lt ? " " + esc(lt) : "");
  return out;
}

function main() {
  const check = process.argv.includes("--check");
  const src = readFileSync(ROOT + PAGE, "utf8");
  const out = bakeFertPage(src, loadJSON("data/fertilizer-coops.json"), loadJSON("data/fertilizer-prices.json"));
  if (out === src) { console.log("ok    " + PAGE); process.exit(0); }
  if (check) { console.log("STALE " + PAGE + ": run node scripts/bake_fert_page.mjs"); process.exit(1); }
  writeFileSync(ROOT + PAGE, out);
  console.log("wrote " + PAGE);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
