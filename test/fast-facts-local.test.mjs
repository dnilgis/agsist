/* Fast Facts N box: the reader's state in the notes (components/fast-facts.js
 * localNotes). Wisconsin readers are told A2809 is their own guide; Illinois
 * readers get Illinois Extension's way of running the Corn N Rate Calculator;
 * the fall line links to the saved ZIP on /fall-nitrogen and to the state's
 * rule there when that page has one.
 *
 *   node --test test/fast-facts-local.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const JS = read("components/fast-facts.js");
const HTML = read("fast-facts.html");
const fn = JS.slice(JS.indexOf("function localNotes("), JS.indexOf("function loadBasis("));

/* Run localNotes against a stand-in page: just the two notes it touches. */
function run(st, store) {
  const note = { _h: HTML.match(/<p class="ff-ans-note" id="ans-note">([\s\S]*?)<\/p>/)[1], attrs: {},
    get innerHTML() { return this._h; }, set innerHTML(v) { this._h = v; },
    getAttribute(k) { return this.attrs[k] || null; }, setAttribute(k, v) { this.attrs[k] = v; } };
  const link = { href: "/fall-nitrogen", textContent: "Soil temps near you" };
  const kids = [];
  const fall = { querySelector: () => link, appendChild: (x) => kids.push(x) };
  const els = { "ans-note": note, "ans-fall": fall };
  const document = { getElementById: (id) => els[id] || kids.find((k) => k.id === id) || null, createElement: () => ({ id: "", innerHTML: "" }) };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null) };
  const BASIS = { IL: { name: "Illinois" }, MN: { name: "Minnesota" }, WI: { name: "Wisconsin" } };
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const FALL_RULE = eval(JS.match(/var FALL_RULE=(\{[^}]*\});/)[1].replace(/^/, "(") + ")");
  const savedZip = new Function("localStorage", JS.match(/function savedZip\(\)\{([\s\S]*?)\n\}/)[1]).bind(null, localStorage);
  new Function("document", "localStorage", "BASIS", "esc", "FALL_RULE", "savedZip", fn + "\nlocalNotes(" + JSON.stringify(st) + ");")(document, localStorage, BASIS, esc, FALL_RULE, savedZip);
  return { note: note.innerHTML, link, rule: kids[0] ? kids[0].innerHTML : "" };
}

test("the generic Outside Wisconsin sentence is still in the page, so the state swap has something to replace", () => {
  const r = run("", {});
  assert.match(r.note, /Outside Wisconsin, run the same prices in <a href="https:\/\/www\.cornnratecalc\.org\/">/);
  assert.equal(r.link.href, "/fall-nitrogen");
  assert.equal(r.rule, "");
});

test("Wisconsin: A2809 is the reader's own guide, the generic line goes", () => {
  const r = run("WI", { agsist_zip: "54728" });
  assert.match(r.note, /That is your state&rsquo;s own guide\./);
  assert.doesNotMatch(r.note, /Outside Wisconsin/);
  assert.equal(r.link.href, "/fall-nitrogen?zip=54728");
  assert.equal(r.link.textContent, "Soil temps near 54728");
});

test("Illinois: Illinois Extension's way, with its explainer; fall rule link", () => {
  const r = run("IL", { "agsist-wx-loc": JSON.stringify({ zip: "61820", state: "IL" }) });
  assert.match(r.note, /In Illinois, Illinois Extension runs the same prices through the <a href="https:\/\/www\.cornnratecalc\.org\/">Corn N Rate Calculator<\/a> by your region of Illinois and last crop/);
  assert.match(r.note, /extension\.illinois\.edu\/blogs\/nutrient-loss-reduction\/2026-02-27-how-mrtn-works/);
  assert.equal(r.link.href, "/fall-nitrogen?zip=61820");
  assert.match(r.rule, /href="\/fall-nitrogen#rule-IL">Illinois rule</);
});

test("other states keep the generic line; a state with no rule on /fall-nitrogen gets no rule link", () => {
  const r = run("OH", {});
  assert.match(r.note, /Outside Wisconsin/);
  assert.equal(r.rule, "");
});

test("every state rule linked exists on /fall-nitrogen", () => {
  const rules = Object.keys(eval("(" + JS.match(/var FALL_RULE=(\{[^}]*\})/)[1] + ")"));
  const page = read("fall-nitrogen.html");
  for (const st of rules) assert.match(page, new RegExp(`id="rule-${st}"`), st);
  assert.doesNotMatch(fn, /—/);
});
