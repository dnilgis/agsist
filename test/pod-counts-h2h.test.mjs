/* /pod-counts, the 2026-10-15 head-to-head fix: a visible byline beside the
 * working-paper date, and the same person as the Article's author in the
 * JSON-LD (it named only the site).
 *
 *   node --test test/pod-counts-h2h.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HTML = readFileSync(new URL("../pod-counts.html", import.meta.url), "utf8");

test("the byline is visible next to the working-paper date", () => {
  const stamp = /<div class="pc-stamp">([\s\S]*?)<\/div>/.exec(HTML);
  assert.ok(stamp, "pc-stamp");
  assert.match(stamp[1], /Sigurd Lindquist/);
  assert.match(stamp[1], /Sigurd Lindquist<\/a>, CCA/);
  assert.match(stamp[1], /19 August 2026/);
});

test("the Article's author in the JSON-LD is the same person", () => {
  const blocks = [...HTML.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const nodes = blocks.flatMap((b) => b["@graph"] || [b]);
  const art = nodes.find((n) => n["@type"] === "Article");
  assert.ok(art, "Article node");
  assert.equal(art.author["@type"], "Person");
  assert.equal(art.author.name, "Sigurd Lindquist");
});

/* Oct 16 benchmark change 1: a dated 2026 line by state, as a difference from
 * each state's 2022-25 mean, with the +/-6 bu band. Every cell is recomputed
 * here from data/crop-tour.json. Hand check, Minnesota: 2026 pods 1,257.80;
 * 2022-25 mean (1,100.75 + 984.39 + 1,036.59 + 1,247.86) / 4 = 1,092.40;
 * +165.40 pods x 0.0227 = +3.75 bu, band -2.2 to +9.8. */
test("2026 by state: pods vs each state's own average, in bushels with the band", () => {
  const d = JSON.parse(readFileSync(new URL("../data/crop-tour.json", import.meta.url), "utf8"));
  const sec = HTML.slice(HTML.indexOf('id="pc-2026"'), HTML.indexOf("</table>", HTML.indexOf('id="pc-2026"')));
  assert.ok(sec.length > 100, "the 2026 table is on the page");
  const rows = [...sec.matchAll(/<tr><td>([^<]+)<\/td>([\s\S]*?)<\/tr>/g)].map((m) => [m[1], [...m[2].matchAll(/<\/span>([^<]+)<\/td>/g)].map((x) => x[1])]);
  assert.equal(rows.length, 7, "seven tour states");
  const states = d.nights.flatMap((n) => n.states).filter((s) => s.pods != null && s.publishes !== false);
  const sg = (x) => { const v = Math.round(x * 10) / 10; return (v > 0 ? "+" : "") + v.toFixed(1); };
  for (const [name, cells] of rows) {
    const s = states.find((x) => x.name === name);
    assert.ok(s, name);
    const h = d.state_history[s.code];
    assert.equal(h.length, 4);
    const mean = h.reduce((a, x) => a + x.pods, 0) / 4;
    const bu = (s.pods - mean) * 0.0227;
    assert.equal(cells[0].replace(/,/g, ""), s.pods.toFixed(2), `${name} 2026 pods`);
    assert.ok(Math.abs(Number(cells[1].replace(/,/g, "")) - mean) <= 0.0051, `${name} mean ${cells[1]} vs ${mean}`);
    assert.equal(cells[3], sg(bu), `${name} bushels`);
    assert.equal(cells[4], `${sg(bu - 6)} to ${sg(bu + 6)}`, `${name} band`);
    assert.ok(bu - 6 < 0 && bu + 6 > 0, `${name}: the page says every band crosses zero`);
  }
  const mn = rows.find((r) => r[0] === "Minnesota")[1];
  assert.equal(mn[3], "+3.8"); assert.equal(mn[4], "-2.2 to +9.8");
});

test("the 2026 line is dated, labeled as ours, never a yield", () => {
  const i = HTML.indexOf('id="y2026"');
  const sec = HTML.slice(i, HTML.indexOf("The divisor everyone repeats", i));
  assert.match(sec, /Added 16 October 2026/);
  assert.match(sec, /AGSIST calibration, not a Pro Farmer number/);
  assert.match(sec, /January 2027/);
  assert.match(sec, /not a yield/);
  assert.ok(!sec.includes("—") && !sec.includes("&mdash;"));
  assert.match(HTML, /"dateModified":"2026-10-16"/);
});
