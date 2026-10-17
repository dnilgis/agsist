/* /farmland-atlas for a reader after one county (field audit, 2026-10-17).
 *   - the panel's big number says "an acre" on the $/acre layers;
 *   - the saved county is a one-tap link to its page, and a typed county opens
 *     its page, both from the small county index, before the national map loads;
 *   - the in-map search sends a typed county to its page; the county pages link
 *     back to the map ("Open on the map").
 *
 *   node --test test/atlas-one-county.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "farmland-atlas.html", "utf8");
const IDX = JSON.parse(readFileSync(ROOT + "farmland-atlas/data/counties-index.json", "utf8"));
function lift(name) {
  const start = HTML.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  let depth = 0, seen = false;
  for (let i = start; i < HTML.length; i++) {
    if (HTML[i] === "{") { depth++; seen = true; }
    else if (HTML[i] === "}") { depth--; if (seen && depth === 0) return HTML.slice(start, i + 1); }
  }
}
const st2 = /var ST2=\{[^;]*\};/.exec(HTML)[0];
const units = /var UNITS=[^;]*;/.exec(HTML)[0];
const findCounty = Function([st2, units, lift("nkey"), lift("bkey"), lift("findCounty"), "return findCounty;"].join("\n"))();
const names = (a) => a.map((r) => r[1]);

test("a typed county finds its page the way a farmer types it", () => {
  for (const q of ["Story, IA", "story ia", "Story County, IA", "Story County Iowa", "STORY, iowa"])
    assert.deepEqual(names(findCounty(IDX, q)), ["Story County, IA"], q);
  assert.equal(findCounty(IDX, "Story, IA")[0][2], "/farmland-atlas/iowa/story-county");
  assert.ok(findCounty(IDX, "Polk").length > 1, "a name in several states lists them, never guesses");
  assert.deepEqual(findCounty(IDX, "Nowhere, IA"), []);
});

test("the early finder and the saved county link sit above the map, and the in-map search opens the page", () => {
  const at = (s) => HTML.indexOf(s);
  assert.ok(at('id="fa-mycty"') > 0 && at('id="fa-mycty"') < at('id="fa-loading"'));
  assert.ok(at('id="fa-quick"') > 0 && at('id="fa-quick"') < at('id="fa-loading"'));
  assert.match(HTML, /function open\(f\)\{ if\(PAGES&&PAGES\[f\]\)\{ gaEvent\('atlas_search_page',\{fips:f\}\); location\.assign\(PAGES\[f\]\); return; \}/);
  assert.match(HTML, /localStorage\.getItem\('agsist-wx-loc'\)/, "the saved location is the one geo.js keeps");
  const story = readFileSync(ROOT + "farmland-atlas/iowa/story-county.html", "utf8");
  assert.match(story, /<a href="\/farmland-atlas#19169">Open on the map/, "the map is one tap back");
});

test("the panel's big number carries its unit", () => {
  assert.match(HTML, /esc\(fmtv\(L,v\)\)\+\(L\.money&&L\.unit==='\$\/acre'\?'<span class="fa-cc-u"> an acre<\/span>':''\)/);
  assert.match(HTML, /key:'val',grp:'Land value',label:'Land \+ buildings, 2022',ramp:'gold',unit:'\$\/acre',money:true/);
});
