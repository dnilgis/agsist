/* Rain Print labels (2026-10-13, Sig: "all points when selected to display on
 * the print must be visible and never cross each other"). Every case in
 * test/fixtures/rp-label-cases.mjs (both styles, every option, crowded date
 * picks, hard years) plus a fixed fuzz set is drawn by the shipped engine and
 * read back by test/fixtures/rp-label-check.mjs with the real font metrics.
 *
 *   node --test test/rain-print-labels.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { engine, input, fixedCases, fuzzCases, caseId, DATA } from "./fixtures/rp-label-cases.mjs";
import { check, HARD, measure, parse } from "./fixtures/rp-label-check.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const X = engine(ROOT);
const texts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));

function draw(spec, real = true) {
  const I = input(X, spec);
  if (real) I.measure = measure;
  const svg = X.ART.render(I);
  return { I, svg, skipped: X.ART.lastSkipped() };
}
function audit(spec, real = true) {
  const { I, svg, skipped } = draw(spec, real), t = texts(svg), id = caseId(spec) + (real ? "" : " (fallback widths)");
  const bad = HARD(check(svg));
  assert.deepEqual(bad.map((b) => b.kind + ": " + b.a + " / " + b.b), [], id);
  for (const m of I.markers) if (m.label) assert.ok(t.some((x) => x.includes(m.label)), id + ": the reader's date \"" + m.label + "\" prints");
  const E = X.ART.model(I);
  if (E.wetText) assert.ok(t.some((x) => x.includes(E.wetText)), id + ": the biggest rain prints");
  const recLabels = X.ART.recordPoints(E, I.records).pts.map((p) => p.label);
  for (const s of skipped) assert.ok(recLabels.includes(s), id + ": only a remarkable day may be left off, and it is named: " + s);
  for (const l of recLabels) assert.ok(t.some((x) => x.includes(l)) !== skipped.includes(l), id + ": " + l + " is drawn or named, not both, not neither");
}

test("the checker catches what it is for (a green run means something)", () => {
  const T = (x, y, s, rp) => `<g data-rp="${rp}"><text x="${x}" y="${y}" font-family="'IBM Plex Sans'" font-weight="400" font-size="16">${s}</text></g>`;
  const svg = (body) => `<svg viewBox="0 0 1800 1200">${body}</svg>`;
  const kinds = (body) => check(svg(body)).map((i) => i.kind);
  assert.deepEqual(kinds(T(300, 300, "Planted", "mark:0") + T(400, 300, "Hail", "mark:1")), []);
  assert.ok(kinds(T(300, 300, "Planted", "mark:0") + T(330, 305, "Hail", "mark:1")).includes("text/text"));
  assert.ok(kinds(T(300, 300, "Planted", "mark:0") + `<g data-rp="rec:0"><line x1="320" y1="250" x2="320" y2="350" stroke="#3F4651" stroke-width="0.8"/></g>`).includes("text/line"));
  assert.ok(kinds(`<g data-rp="rec:0"><line x1="300" y1="250" x2="400" y2="350" stroke="#000" stroke-width="0.8"/></g><g data-rp="rec:1"><line x1="300" y1="350" x2="400" y2="250" stroke="#000" stroke-width="0.8"/></g>`).includes("leader/leader"));
  assert.ok(kinds(T(30, 300, "Planted", "mark:0")).includes("clip"));
  assert.ok(kinds(T(1700, 300, "Harvest done", "mark:0")).includes("clip"));
  assert.ok(kinds(`<g data-rp="x"><text x="300" y="300" font-size="10">tiny</text></g>`).includes("small"));
  // a comma far from the name above it is not a collision; a letter under the name is
  const two = (place) => T(120, 1004, place, "title").replace('font-size="16"', 'font-size="40"') + `<g data-rp="title2"><text x="346" y="1050" font-family="'Fraunces'" font-weight="400" font-size="48">The Olson Farm</text></g>`;
  assert.deepEqual(kinds(two("Chetek, Wisconsin")).filter((k) => k === "text/text"), []);
});

test("the fallback width table never makes a label narrower than it prints", () => {
  const SERIF = "'Fraunces',Georgia,serif", SANS = "'IBM Plex Sans',system-ui,sans-serif";
  const s = "Tied for 2nd wettest June of 120 full years: 10.25 in · Coldest: -24°F (also Jan 21) MWQ@%&#é Saint Francisville Township, West Virginia 2025";
  for (const fam of [SERIF, SANS]) for (const w of [300, 400, 500, 600]) for (const it of [false, true]) for (const size of [11, 16, 24, 52, 84]) {
    if (it && w !== 400) continue;
    for (const ch of new Set(s)) {
      const o = { fam, w, it, size };
      assert.ok(X.ART.roughW(ch, o) >= measure(ch, o) - 1e-9, `${fam} ${w}${it ? "i" : ""} ${size} "${ch}"`);
    }
  }
});

test("every fixed case: nothing overlaps, nothing is cut off, every date and the biggest rain print", () => {
  for (const spec of fixedCases()) audit(spec);
});

test("a fixed fuzz set of date picks, records and options (seed 20261013)", () => {
  for (const spec of fuzzCases(20261013, 60)) audit(spec);
});

test("without a canvas (the width table), the same holds", () => {
  for (const spec of fixedCases().filter((s, k) => k % 4 === 0)) audit(spec, false);
});

// ---------- the cases that collided before (2026-10-13), one by one ----------
const base = { seed: 3, cmp: "normal", name: "olson", dedication: "short", place: "short", gauge: "short", normals: true, records: false, markers: "spread", data: "usual" };

test("three dates on one day all print: stacked over their tick, or one label in date order when the rows are full", () => {
  for (const style of ["r1", "r2"]) for (const place of ["short", "long"]) {
    const { svg } = draw({ ...base, style, place, markers: "sameMid" }), t = texts(svg);
    for (const l of ["Harvest done", "Sold the crop", "Sprayed beans"]) assert.ok(t.some((x) => x.includes(l)), style + " " + l);
    assert.deepEqual(HARD(check(svg)), [], style);
  }
  // the dates crowd Jan 1 under a long place name (it takes the third row): two rows, the first joined in date order, each over the tick
  const { svg } = draw({ ...base, style: "r1", place: "long", markers: "jan1x3" });
  const rows = parse(svg).texts.filter((t) => /^mark/.test(t.rp));
  assert.deepEqual(rows.map((t) => t.s), ["Planted corn · Sold the crop", "Harvest done"]);
  for (const t of rows) assert.ok(t.x < 198 && t.x + t.w > 198, t.s + " sits over Jan 1");
  assert.deepEqual(HARD(check(svg)), []);
});

test("Jan 1 and Dec 31 picks stay inside the 0.6 in margin and over their own ticks", () => {
  for (const style of ["r1", "r2"]) for (const markers of ["jan1x3", "dec31x3", "adjJan", "adjDec"]) {
    const { svg } = draw({ ...base, style, markers, place: "long" });
    const P = parse(svg);
    for (const t of P.texts.filter((x) => /^mark/.test(x.rp))) assert.ok(t.x >= 60 && t.x + t.w <= 1740, style + " " + markers + ": " + t.s);
    assert.deepEqual(HARD(check(svg)), [], style + " " + markers);
  }
});

test("R1: the farm name sits clear of the place above it and the dedication below", () => {
  for (const place of ["short", "long"]) for (const name of ["olson", "long"]) for (const dedication of ["short", "long", "none"]) {
    const { svg } = draw({ ...base, style: "r1", place, name, dedication });
    const title = check(svg).filter((i) => i.kind === "text/text" && /\[title\]/.test(i.a));
    assert.deepEqual(title, [], [place, name, dedication].join(" "));
  }
});

test("R1: a year that climbs early moves the header or makes room above the line; the line never runs through the verdict", () => {
  for (const data of ["wetSpring", "oneJan", "snowWinter"]) {
    const { svg } = draw({ ...base, style: "r1", data });
    assert.deepEqual(HARD(check(svg)).filter((i) => /\[head\]/.test(i.a)), [], data);
  }
});

test("R2: a big snow day keeps the snow scale to four labels", () => {
  const { svg } = draw({ ...base, style: "r2", data: "wet" });
  const snowTicks = parse(svg).texts.filter((t) => t.rp === "axis" && /^\d+$/.test(t.s) && t.y < 478);
  assert.ok(snowTicks.length <= 4, snowTicks.map((t) => t.s).join(","));
});

test("the preview band hides no words", () => {
  for (const style of ["r1", "r2"]) for (const data of ["usual", "wetSpring"]) for (const preview of [40, 150, 212, 283]) {
    const { svg } = draw({ ...base, style, data, preview, records: "all" });
    assert.deepEqual(check(svg).filter((i) => /band/.test(i.b)), [], `${style} ${data} ${preview}`);
  }
});

test("the biggest rain is never dropped: R1 says it in the header, R2 in the footer, when the chart has no clean spot", () => {
  // a wet day with the reader's dates on it and the next day: their drop lines fence the riser in
  const { svg } = draw({ ...base, style: "r1", data: "oneJan", seed: 924, normals: true, cmp: "none", name: "long", dedication: "none", place: "long", markers: "wetDay" });
  const E = X.ART.model(input(X, { ...base, style: "r1", data: "oneJan", seed: 924, cmp: "none", markers: "wetDay" }));
  assert.ok(parse(svg).texts.some((t) => t.rp === "head" && t.s === E.wetText), "in the header");
  assert.equal(X.ART.lastSkipped().length, 0);
});

test("the stress data sets are synthetic and say so in the fixture", () => {
  assert.ok(Object.keys(DATA).length >= 10);
});
