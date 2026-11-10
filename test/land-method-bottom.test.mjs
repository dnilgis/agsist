/* Method text at the bottom, collapsed (Nov 7, 2026, on /land-sales/2026-09: "way too much info on the farmland
 * sales page ... that all needs to be on the bottom of page and collapsed unless someone wants to read it").
 * a site rule Nov 7: the answer and the data at the top, at most one short caveat line; the market rule and every
 * state's method note, word for word, in one closed details block at the bottom, each state under its own heading.
 * Built from the synthetic fixture site (test/fixtures/land-fl/make_site.py: Wisconsin and Florida, made-up rows) into a
 * temp folder, never the committed pages; the per-state block is read straight from scripts/build_land_sales.py.
 *
 *   node --test test/land-method-bottom.test.mjs
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DASH = /[–—]|&mdash;|&ndash;/;
const SUMMARY = "Sources and terms";
const ent = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

const pyOut = (code) => {
  const r = spawnSync("python3", ["-c", code, path.join(ROOT, "scripts")], { encoding: "utf8", cwd: ROOT });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split("\n").pop());
};
// the texts as the builder holds them: the rule and the four state notes
const T = pyOut(["import json,sys", "sys.path.insert(0,sys.argv[1])", "import build_land_sales as B",
  "print(json.dumps({'rule':B.RULE,'notes':{k:v for k,v in B.STATE_NOTES},'all':B.method_html(['IL','WI','IN','VT','NJ','FL'])}))"].join("\n"));

let DIR = null;
function site() {
  if (DIR) return DIR;
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lsmeth-"));
  const r = spawnSync("python3", [path.join(ROOT, "test/fixtures/land-fl/make_site.py"), DIR], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return DIR;
}
after(() => { if (DIR) fs.rmSync(DIR, { recursive: true, force: true }); });
const rd = (p) => fs.readFileSync(path.join(site(), p), "utf8");
const body = (h) => h.slice(h.indexOf("<main"));
const monthFile = () => "land-sales/" + fs.readdirSync(path.join(site(), "land-sales")).find((f) => /^\d{4}-\d{2}\.html$/.test(f));

function oneClosedBlock(h, p) {
  const opens = [...h.matchAll(/<details\b[^>]*id="how-counted"[^>]*>/g)];
  assert.equal(opens.length, 1, `${p}: one method block`);
  assert.doesNotMatch(opens[0][0], /\bopen\b/, `${p}: closed by default`);
  assert.match(opens[0][0], /class="ls-src"/, `${p}: the page's own collapsed source class`);
  const a = opens[0].index, z = h.indexOf("</details>", a);
  assert.ok(z > a, `${p}: the block closes`);
  const blk = h.slice(a, z);
  assert.ok(blk.includes(`<summary>${ent(SUMMARY)}</summary>`), `${p}: the summary says what is inside`);
  assert.equal((blk.match(/<details\b/g) || []).length, 1, `${p}: nothing nested`);
  return { a, z, blk };
}

test("the per-state block carries the rule and every state's note word for word, each under its own heading", () => {
  const blk = T.all;
  assert.match(blk, /^<details class="ls-src" id="how-counted"><summary>/);
  assert.ok(blk.includes(`<p class="ls-fine">${ent(T.rule)}</p>`), "the market rule");
  const names = { IN: "Indiana", VT: "Vermont", NJ: "New Jersey", FL: "Florida" };
  let last = blk.indexOf(ent(T.rule));
  for (const st of ["IN", "VT", "NJ", "FL"]) {
    const i = blk.indexOf(`<h3 class="ls-dh">${names[st]}</h3><p class="ls-fine">${ent(T.notes[st])}</p>`);
    assert.ok(i > last, `${st}: its own heading and its note, unchanged, in order`);
    last = i;
  }
  for (const st of ["IN", "VT", "NJ", "FL"]) assert.ok(T.notes[st].length > 100, `${st}: a real note`);
  assert.ok(!DASH.test(blk), "no em or en dash");
});

test("the monthly update: the answer first, then the sales; the method in one closed block after the tables", () => {
  const p = monthFile(), h = body(rd(p));
  const h1 = h.indexOf("<h1>"), ans = h.indexOf('<p class="ls-ans">'), buyers = h.indexOf('<h2 id="buyers">');
  assert.ok(h1 >= 0 && ans > h1 && buyers > ans, `${p}: H1, the answer, then the buyers`);
  const top = h.slice(h1, buyers);
  assert.ok((top.match(/<p\b/g) || []).length <= 2, `${p}: the answer and at most one more line: ${top}`);
  assert.equal((top.match(/<p class="ls-fine/g) || []).length <= 1, true, `${p}: at most one caveat line`);
  assert.ok(!top.includes(ent(T.rule)) && !top.includes(ent(T.notes.FL)), `${p}: no method text at the top`);
  const { a, blk } = oneClosedBlock(h, p);
  const lastTable = h.lastIndexOf("</table>", a);
  assert.ok(a > h.indexOf('<h2 id="value">') && a > h.indexOf('<h2 id="coverage">') && lastTable > buyers, `${p}: after the sales tables and the coverage`);
  assert.ok(blk.includes(ent(T.notes.FL)) && blk.includes(ent(T.rule)), `${p}: Florida's note and the rule inside`);
  assert.equal(h.split(ent(T.notes.FL)).length, 2, `${p}: Florida's note once, inside the block`);
  assert.equal(h.split(ent(T.rule)).length, 2, `${p}: the rule once, inside the block`);
  assert.match(h.slice(0, a), /<p class="ls-fine">Source: [^<]*Department of Revenue/, `${p}: the short source line stays visible`);
  assert.ok(!DASH.test(h), `${p}: no em or en dash`);
});

test("county pages and the hub: the same block at the bottom, nothing of it at the top", () => {
  for (const p of ["land-sales/florida/hardee-county.html", "land-sales/wisconsin/testc-county.html", "land-sales/index.html"]) {
    const h = body(rd(p));
    const { a, blk } = oneClosedBlock(h, p);
    const first = p.endsWith("index.html") ? h.indexOf('<details class="ls-all" id="all-states">') : h.indexOf('<h2 id="every-sale">');
    assert.ok(first > 0 && a > first, `${p}: below the sales`);
    if (!p.endsWith("index.html")) assert.ok(a > h.lastIndexOf("</table>", a) && h.lastIndexOf("</table>", a) > first, `${p}: after the sale table`);
    assert.ok(!h.slice(0, first).includes(ent(T.rule)), `${p}: the rule is not at the top`);
    assert.equal(h.split(ent(T.rule)).length, 2, `${p}: the rule once, inside the block`);
    assert.ok(blk.includes(ent(T.rule)), `${p}: the rule inside`);
    const fl = p.includes("florida") || p.endsWith("index.html");
    assert.equal(blk.includes(ent(T.notes.FL)), fl, `${p}: Florida's note where Florida sales show`);
    if (fl) assert.ok(!h.slice(0, first).includes(ent(T.notes.FL)), `${p}: Florida's note is not at the top`);
    assert.match(h.slice(0, a), /<p class="ls-fine">Source: /, `${p}: the short source line stays visible`);
    assert.ok(!DASH.test(h), `${p}: no em or en dash`);
  }
});

test("the builder: one caveat line at most under the answer, no state note printed outside the block", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts/build_land_sales.py"), "utf8");
  assert.doesNotMatch(src, /e\((IN|VT|NJ|FL)_NOTE\)/, "the notes print only through method_html");
  assert.equal((src.match(/e\(RULE\)/g) || []).length, 1, "the rule prints only inside method_html");
  const mp = src.slice(src.indexOf("def month_page("), src.indexOf("def coverage_html("));
  assert.equal((mp.match(/ls-cav/g) || []).length, 1, "one caveat paragraph");
  assert.ok(mp.indexOf("ls-cav") < mp.indexOf('<h2 id="buyers">'), "the caveat sits under the answer");
  assert.ok(mp.indexOf("method_html(") > mp.indexOf("coverage_html("), "the block after the coverage");
});
