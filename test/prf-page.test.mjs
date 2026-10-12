/* The /prf page (prf.html, components/prf.js) held to its own wiring, and the
 * two helpers the page added to components/prf-math.js held to hand-worked
 * answers.
 *
 * WHY THE WIRING IS A TEST
 *   components/prf.js reaches for about sixty elements by id. One renamed in
 *   prf.html and not in the script is a null dereference on the first click
 *   that needs it, which no parse check sees and a render only sees if it
 *   happens to click there. This reads the ids the script asks for and the
 *   ids the page has, and stops on any the page lacks.
 *
 *   node --test test/prf-page.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const html = readFileSync(ROOT + "prf.html", "utf8");
const js = readFileSync(ROOT + "components/prf.js", "utf8");
const ctx = { window: {}, Buffer };
vm.runInNewContext(readFileSync(ROOT + "components/prf-math.js", "utf8"), ctx);
const M = ctx.window.AgPrfMath;

test("every id the script asks for is on the page, once", () => {
  const asked = [...new Set([...js.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map((m) => m[1]))];
  assert.ok(asked.length >= 45, `only ${asked.length} ids found in prf.js: the pattern this test reads has changed`);
  /* ids the script builds itself at run time, inside markup it writes */
  const madeByScript = new Set(["prf-cross", "prf-asgrid"]);
  const missing = [], twice = [];
  for (const id of asked) {
    if (madeByScript.has(id)) { assert.ok(js.includes(`id="${id}"`), `${id} is said to be script-made and the script does not make it`); continue; }
    const n = html.split(`id="${id}"`).length - 1;
    if (n === 0) missing.push(id);
    if (n > 1) twice.push(id);
  }
  assert.deepEqual(missing, [], "ids prf.js uses that prf.html lacks");
  assert.deepEqual(twice, [], "ids that appear more than once in prf.html");
});

test("the page loads the arithmetic before the script that uses it", () => {
  const a = html.indexOf("/components/prf-math.js"), b = html.indexOf("/components/prf.js");
  assert.ok(a > 0 && b > a, "prf-math.js must come before prf.js");
  assert.equal(html.split("data-prf ").length - 1, 1, "one calculator root");
});

test("the script computes no dollars of its own", () => {
  /* honest-numbers rule 9: the generator and the math file own every figure.
     The page may format and compare; a rate, a subsidy or a payment factor
     multiplied here would be a second, untested copy of the arithmetic. */
  for (const bad of [/\*\s*rates?\[/, /\*\s*\(?1\s*-\s*sub/, /trig\w*\s*-\s*index/i]) {
    const m = js.match(bad);
    assert.ok(!m || /ratePer100 \* \(1 - sub\)/.test(js.slice(Math.max(0, m.index - 30), m.index + 30)),
      `prf.js seems to price something itself near: ${m && js.slice(m.index - 60, m.index + 60)}`);
  }
});

test("the FAQ on the page and the FAQ in the structured data are the same questions", () => {
  const block = html.match(/<!--prf:faq-->([\s\S]*?)<!--\/prf:faq-->/);
  assert.ok(block, "no FAQ block");
  const visible = [...block[1].matchAll(/<details><summary>(.*?)<\/summary>/g)].map((m) => m[1].replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "").replace(/&rsquo;/g, "’").replace(/&amp;/g, "&").trim());
  assert.ok(visible.length >= 8, `only ${visible.length} questions`);
  const lds = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.ok(lds.length >= 3, "structured data has not been stamped: run scripts/stamp_prf.py");
  const faq = lds.find((d) => d["@type"] === "FAQPage");
  assert.deepEqual(faq.mainEntity.map((q) => q.name), visible);
  for (const q of faq.mainEntity) assert.ok(q.acceptedAnswer.text.length > 40, `thin answer: ${q.name}`);
});

test("no reminder is offered that nothing can send", () => {
  /* workers/subs-worker.js takes arcplc: and rent: topics only. Until it takes
     a PRF topic and scripts/send_notice.py has a template, an ask here would
     collect addresses and mail nobody. */
  const worker = readFileSync(ROOT + "workers/subs-worker.js", "utf8");
  if (!/prf:/.test(worker)) assert.ok(!/data-deadlines=/.test(html), "prf.html asks for a reminder the worker refuses");
});

test("a section written for one crop year says which", () => {
  const m = html.match(/data-prf-written-for="(\d{4})"/);
  assert.ok(m, "the New for <year> section has lost its data-prf-written-for");
  const cy = html.match(/<!--prf:crop_year-->(\d{4})<!--\/prf:crop_year-->/);
  assert.ok(cy, "crop year not stamped");
  assert.equal(m[1], cy[1], "the year-specific section and the stamped crop year disagree");
});

/* ---- evenSplit: worked by hand ---- */
const on = (...ix) => Array.from({ length: 11 }, (_, i) => ix.includes(i));
const lim = (first) => ({ min: Array(11).fill(10), max: [first, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70] });

test("an even split is whole percents that add to 100 inside the county's limits", () => {
  const L = lim(25);
  assert.deepEqual(Array.from(M.evenSplit(on(3, 5), L.min, L.max)), [0, 0, 0, 50, 0, 50, 0, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(M.evenSplit(on(3, 5, 7), L.min, L.max)), [0, 0, 0, 34, 0, 33, 0, 33, 0, 0, 0]);
  /* six intervals: 100 / 6 = 16 remainder 4, so the first four get 17 */
  assert.deepEqual(Array.from(M.evenSplit(on(0, 2, 4, 6, 8, 10), L.min, L.max)), [17, 0, 17, 0, 17, 0, 17, 0, 16, 0, 16]);
  /* Jan-Feb capped at 25: the other two share the remaining 75 as 38 and 37 */
  assert.deepEqual(Array.from(M.evenSplit(on(0, 2, 5), L.min, L.max)), [25, 0, 38, 0, 0, 37, 0, 0, 0, 0, 0]);
  /* 25 + 70 is 95: two intervals cannot reach 100, and the answer is null, not a split that breaks a cap */
  assert.equal(M.evenSplit(on(0, 2), L.min, L.max), null);
  assert.deepEqual(Array.from(M.evenSplit(on(), L.min, L.max)), Array(11).fill(0));
  /* eleven minimums of 10 is 110: cannot be done */
  assert.equal(M.evenSplit(Array(11).fill(true), L.min, L.max), null);
});

test("every even split the page can make passes the page's own rule check", () => {
  const L = lim(25);
  let made = 0;
  for (let mask = 1; mask < 2048; mask++) {
    const pick = Array.from({ length: 11 }, (_, i) => !!(mask & (1 << i)));
    if (pick.some((p, i) => p && i > 0 && pick[i - 1])) continue;       /* shares a month */
    const ev = M.evenSplit(pick, L.min, L.max);
    if (!ev) continue;
    made++;
    const chk = M.checkSplit(Array.from(ev), L.min, L.max, Array(11).fill(true));
    assert.ok(chk.ok, `mask ${mask}: ${JSON.stringify(chk.errors)}`);
  }
  assert.ok(made >= 100, `only ${made} splits were made: the loop is not looking at what it claims`);
});

test("the longest run with no payment counts years in a row and stops at a gap", () => {
  const h = (year, indemnity, complete = true) => ({ year, indemnity, complete });
  assert.equal(M.longestDry([]), null);
  assert.equal(M.longestDry([h(2001, 5), h(2002, 9)]), null);
  assert.deepEqual({ ...M.longestDry([h(2001, 0), h(2002, 0), h(2003, 4), h(2004, 0)]) }, { from: 2001, to: 2002, n: 2 });
  /* a year that is not complete is not a dry year, and it ends the run */
  assert.deepEqual({ ...M.longestDry([h(2001, 0), h(2002, 0, false), h(2003, 0), h(2004, 0), h(2005, 0)]) }, { from: 2003, to: 2005, n: 3 });
  /* a missing year ends the run too: 2001 and 2003 are not two years in a row */
  assert.deepEqual({ ...M.longestDry([h(2001, 0), h(2003, 0)]) }, { from: 2001, to: 2001, n: 1 });
});
