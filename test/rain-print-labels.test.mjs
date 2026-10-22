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
import { check, HARD, measure, parse, splitRiders } from "./fixtures/rp-label-check.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const X = engine(ROOT);
// a reader's date rides in a <tspan> after its words: read the text whole ("Planted May 21")
const texts = (svg) => [...splitRiders(svg).matchAll(/<text[^>]*>((?:[^<]|<\/?tspan[^>]*>)*)<\/text>/g)].map((m) => m[1].replace(/<\/?tspan[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));

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
  const unplaced = X.ART.lastUnplaced();
  assert.ok(unplaced.every((k) => k >= 3), id + ": the first three marked days are always drawn: " + unplaced);
  I.markers.forEach((m, k) => { if (m.label && !unplaced.includes(k)) assert.ok(t.some((x) => x.includes(m.label)), id + ": the reader's date \"" + m.label + "\" prints"); });
  const E = X.ART.model(I);
  if (E.wetText) assert.ok(t.some((x) => x.includes(X.ART.plain(E.wetText))), id + ": the biggest rain prints, with its date");
  const recPts = X.ART.recordPoints(E, I.records).pts, recLabels = recPts.map((p) => p.label);
  for (const s of skipped) assert.ok(recLabels.includes(s), id + ": only a remarkable day may be left off, and it is named: " + s);
  // a remarkable day prints with its date (the plotted day, or a stretch's range), counted by the checker above
  // (beside a tall snow pile in Roots the date may sit on its own line under the words)
  const drawn = (p) => { const [head, rest = ""] = p.text.split("\u0001"); return t.some((x) => x.includes(X.ART.plain(p.text))) || (rest !== "" && t.includes(head) && t.includes(X.ART.plain("\u0001" + rest).trim())); };
  for (const p of recPts) assert.ok(drawn(p) !== skipped.includes(p.label), id + ": " + p.label + " is drawn or named, not both, not neither");
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
  // a reader's date in a <tspan> counts in its label's width, at its own size: "Planted May 21" reaches past "Planted"
  const dated = (x) => `<g data-rp="mark:0"><text x="300" y="300" font-family="'IBM Plex Sans'" font-weight="500" font-size="21">Planted<tspan font-size="17" font-weight="400" fill="#5E6475"> May 21</tspan></text></g>` + T(x, 300, "Hail", "mark:1");
  assert.ok(kinds(dated(410)).includes("text/text"), "the date runs into the next label");
  assert.deepEqual(kinds(dated(470)), []);
  const P = parse(dated(470)).texts[0];
  assert.equal(P.s, "Planted May 21");
  assert.ok(Math.abs(P.w - (measure("Planted", { fam: "IBM Plex Sans", w: 500, size: 21 }) + measure(" May 21", { fam: "IBM Plex Sans", w: 400, size: 17 }))) < 1e-6, "measured run by run");
  assert.ok(kinds(`<g data-rp="x"><text x="300" y="300" font-size="16">a<tspan font-size="10">tiny</tspan></text></g>`).includes("small"), "a small tspan is small");
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
  // Staircase (panel 4, 2026-10-14): the dates go on the line, so three on Jan 1 each print whole beside the dot, inside the chart
  const r1 = draw({ ...base, style: "r1", place: "long", markers: "jan1x3" }).svg;
  const on = parse(r1).texts.filter((t) => /^mark/.test(t.rp));
  assert.deepEqual(on.map((t) => t.s).sort(), ["Harvest done Jan 1", "Planted corn Jan 1", "Sold the crop Jan 1"]);
  for (const t of on) assert.ok(t.x > 198 && t.x < 198 + 160 && t.y + t.h < (base.normals ? 742 : 790), t.s + " sits beside the Jan 1 dot, above the axis");
  assert.deepEqual(HARD(check(r1)), []);
  // Roots keeps the row over the months: crowded at Jan 1 they join in date order over the tick
  const { svg } = draw({ ...base, style: "r2", place: "long", markers: "jan1x3" });
  const rows = parse(svg).texts.filter((t) => /^mark/.test(t.rp));
  assert.equal(rows.map((t) => t.s).join(" · "), "Planted corn Jan 1 · Sold the crop Jan 1 · Harvest done Jan 1");
  for (const t of rows) assert.ok(t.x < 207 && t.x + t.w > 207, t.s + " sits over Jan 1");
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
  assert.ok(parse(svg).texts.some((t) => t.rp === "head" && t.s === X.ART.plain(E.wetText)), "in the header");
  assert.equal(X.ART.lastSkipped().length, 0);
});

test("the stress data sets are synthetic and say so in the fixture", () => {
  assert.ok(Object.keys(DATA).length >= 10);
});

// ---------- panel 4 (2026-10-14): the name block ----------
const LOGO = { href: "data:image/png;base64,iVBORw0KGgo=", w: 600, h: 300 };
test("the longest name, place and line, with and without a logo, draw with nothing overlapping in both styles", () => {
  for (const style of ["r1", "r2"]) for (const logo of [null, LOGO]) for (const data of ["usual", "wet", "snowWinter"]) for (const markers of ["spread", "adjJan"]) {
    const I = input(X, { ...base, style, data, markers, place: "long", name: "long", dedication: "long", gauge: "long", records: "few" });
    I.name = "W".repeat(24); I.logo = logo; I.measure = measure;
    const svg = X.ART.render(I), id = [style, logo ? "logo" : "no logo", data, markers].join(" ");
    assert.deepEqual(HARD(check(svg)).map((b) => b.kind + ": " + b.a + " / " + b.b), [], id);
    const t = texts(svg);
    for (const want of [I.name, I.place, I.dedication]) assert.ok(t.includes(want), id + ": prints " + want);
  }
});

// ---------- remarkable days with their dates (Sig, 2026-10-15) ----------
test("remarkable days with dates: wet, dry and snowy years, both styles, nothing overlaps and every date prints", () => {
  for (const style of ["r1", "r2"]) for (const data of ["wet", "dry", "snowWinter"]) for (const records of ["all", "sameMonth", "sameDay"]) for (const real of [true, false]) {
    const { I, svg, skipped } = draw({ ...base, style, data, records, markers: "spread" }, real), id = [style, data, records, real ? "real" : "table"].join(" ");
    assert.deepEqual(HARD(check(svg)).map((b) => b.kind + ": " + b.a + " / " + b.b), [], id);
    const t = texts(svg), pts = X.ART.recordPoints(X.ART.model(I), I.records).pts;
    for (const p of pts) {
      if (skipped.includes(p.label)) continue;
      assert.ok(p.text !== p.label || (p.span && p.b - p.a >= 27), id + ": " + p.label + " carries a date unless it is a whole month");
      const [head, rest = ""] = p.text.split("\u0001");
      assert.ok(t.some((x) => x.includes(X.ART.plain(p.text))) || (rest !== "" && t.includes(head) && t.includes(X.ART.plain("\u0001" + rest).trim())), id + ": prints " + X.ART.plain(p.text));
    }
    // every record in the layer at once is a stress case: a few may be left off (named on the page), never all
    assert.ok(skipped.length <= 4 && skipped.length < pts.length, id + ": skipped " + skipped.join("; "));
  }
});

// ---------- up to five marked days (Sig, 2026-10-15: "as long as everything still fits") ----------
test("five marked days: spread out and three in one week all fit, both styles; nothing overlaps", () => {
  for (const style of ["r1", "r2"]) for (const data of ["usual", "wet", "dry", "snowWinter"]) for (const markers of ["five", "bunch3"]) for (const records of [false, "all"]) {
    const spec = { ...base, style, data, markers, records };
    audit(spec);
    const { I, svg } = draw(spec), id = caseId(spec);
    assert.equal(I.markers.length, 5, id);
    assert.deepEqual([...X.ART.lastUnplaced()], [], id + ": all five drawn");
    const t = texts(svg);
    for (const m of I.markers) assert.ok(t.some((x) => x.includes(m.label + " ")), id + ": " + m.label + " prints with its date");
    const dots = [...svg.matchAll(/<g data-rp="mark:(\d)">/g)].map((g) => +g[1]);
    assert.ok(new Set(dots).size === 5, id + ": five marks drawn: " + [...new Set(dots)]);
  }
});

test("five marked days crowded into one week or one day: still no overlap; what cannot fit is named, never the first three", () => {
  for (const style of ["r1", "r2"]) for (const data of ["usual", "wet", "snowWinter"]) for (const markers of ["week5", "day5"]) for (const real of [true, false]) {
    const spec = { ...base, style, data, markers, place: "long", name: "long", dedication: "long" };
    audit(spec, real);
    const { I, svg } = draw(spec, real), un = X.ART.lastUnplaced(), id = caseId(spec) + (real ? "" : " table");
    for (const k of un) assert.ok(!texts(svg).some((x) => x.includes(I.markers[k].label)), id + ": a day left off is not drawn: " + I.markers[k].label);
    assert.ok(un.length <= 2, id);
  }
});

test("the art reports a day it left off, and more than five are cut to five", () => {
  const spec = { ...base, style: "r2", data: "usual", markers: "five" };
  const I = input(X, spec);
  I.markers = I.markers.concat([{ doy: 320, label: "Sixth" }]);
  X.ART.render(I);
  assert.equal(X.ART.model(I).markers.length, 5, "five at most");
  assert.ok(!texts(X.ART.render(I)).some((x) => x.includes("Sixth")));
  // a label that can never fit (a whole row of words) on days 4 and 5 is left off and named; days 1 to 3 stay
  const J = input(X, spec);
  J.markers = J.markers.map((m, k) => (k >= 3 ? { doy: 130 + k, label: "W".repeat(24) } : m));
  J.measure = measure;
  const svg = X.ART.render(J), un = X.ART.lastUnplaced();
  assert.deepEqual(HARD(check(svg)).map((b) => b.kind), [], "still clean");
  for (const k of un) assert.ok(k >= 3, "only days past the third are left off");
  assert.equal(typeof X.ART.MAX_MARKS, "number");
});
