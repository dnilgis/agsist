/* Alt text and chart labels on the hand-made pages.
 *
 * Every <img> on a hand-made page (the .html files at the repo root) and every
 * <img> the shared components write has an alt attribute. A photo or picture
 * from /img/ has real alt text; alt="" is only for decoration (a sponsor logo
 * beside the sponsor's name, a user's own upload preview). Every inline <svg>
 * either has a name (aria-label, aria-labelledby, a <title>, role="img") or is
 * hidden from screen readers (aria-hidden="true" on it or its parent tag).
 * The futures forward-curve charts are drawn by script, so the label is built
 * from the chart's own points; those checks run the drawing code.
 *
 *   node --test test/img-alt.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const PAGES = readdirSync(ROOT).filter((f) => f.endsWith(".html"));
const SCRIPTS = [
  ...readdirSync(ROOT + "components").filter((f) => f.endsWith(".js")).map((f) => "components/" + f),
  ...readdirSync(ROOT).filter((f) => f.endsWith(".js")),
];
const line = (s, i) => s.slice(0, i).split("\n").length;

test("there are hand-made pages to check", () => {
  assert.ok(PAGES.length > 60, `only ${PAGES.length} pages found`);
  assert.ok(PAGES.includes("rain-print.html") && PAGES.includes("rain-gauge.html"));
});

test("every <img> on a hand-made page or written by a component has an alt attribute", () => {
  const bad = [];
  for (const f of [...PAGES, ...SCRIPTS]) {
    const s = read(f);
    // "<img" followed by attributes; a bare "<img>" is prose in a comment
    for (const m of s.matchAll(/<img\s[^>]*>/gi)) {
      if (!/\balt=/.test(m[0])) bad.push(`${f}:${line(s, m.index)} ${m[0].slice(0, 90)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("every picture from /img/ on a hand-made page has real alt text under 125 characters", () => {
  // Two long alts are deliberate: the Rain Print example and the sample letter on
  // /rain-print read out the year's numbers from the saved data, and
  // test/rain-print-examples.test.mjs and test/rain-print-insert.test.mjs pin them.
  const LONG_ON_PURPOSE = new Set(["rain-print.html /img/rain-print-example-2012-ames-ia.jpg", "rain-print.html /img/rain-print-insert-letter-sample.webp"]);
  const bad = [];
  let n = 0;
  for (const f of [...PAGES, "components/rain-print-promo.js"]) {
    const s = read(f);
    for (const m of s.matchAll(/<img\b[^>]*\bsrc="\/img\/[^"]+"[^>]*>/gi)) {
      n++;
      const raw = (m[0].match(/\balt="([^"]*)"/) || [])[1];
      // count what a screen reader reads: entities as one character
      const alt = raw === undefined ? undefined : raw.replace(/&[a-z]+;|&#\d+;/g, "x");
      const decorative = /aria-hidden="true"|role="(presentation|none)"/.test(m[0]);
      if (alt === undefined || (!alt.trim() && !decorative)) bad.push(`${f}:${line(s, m.index)} empty alt on a content image`);
      else if (alt.length >= 125 && !LONG_ON_PURPOSE.has(f + " " + m[0].match(/src="([^"]+)"/)[1])) bad.push(`${f}:${line(s, m.index)} alt is ${alt.length} characters`);
      else if (/^(image|picture|photo) of\b/i.test(alt) || /\u2014/.test(alt)) bad.push(`${f}:${line(s, m.index)} alt wording: ${alt.slice(0, 60)}`);
    }
  }
  assert.ok(n >= 10, `expected the Rain Print and rain gauge pictures, found ${n}`);
  assert.deepEqual(bad, []);
});

test("every inline <svg> on a hand-made page has a name or is hidden from screen readers", () => {
  // The homepage basis sparkline is empty until a bid loads; components/homepage-extras.js
  // gives it role="img" and a label built from its data when it draws (checked below).
  const DRAWN_LATER = new Set(["index.html#idx1-basis-svg"]);
  const bad = [];
  for (const f of PAGES) {
    const s = read(f);
    for (const m of s.matchAll(/<svg\b[^>]*>/gi)) {
      const t = m[0];
      if (/aria-hidden=\\?"true|aria-label=|aria-labelledby=|role=\\?"(img|presentation|none)/.test(t)) continue;
      if (/^\s*<title\b/.test(s.slice(m.index + t.length, m.index + t.length + 200))) continue;
      const tags = s.slice(Math.max(0, m.index - 400), m.index).match(/<[a-z][^<>]*>/gi) || [];
      if (tags.length && /aria-hidden=\\?"true/.test(tags[tags.length - 1])) continue;
      const id = (t.match(/\bid="([^"]+)"/) || [])[1];
      if (id && DRAWN_LATER.has(`${f}#${id}`)) continue;
      bad.push(`${f}:${line(s, m.index)} ${t.slice(0, 90)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("the homepage basis sparkline gets role=img and a label from its own data", () => {
  const s = read("components/homepage-extras.js");
  assert.match(s, /svg\.setAttribute\('role', 'img'\)/);
  assert.match(s, /svg\.setAttribute\('aria-label', 'Basis at this elevator ranged from ' \+ sc\(rawLo\)/);
});

function drawForwardCurve(isGrain) {
  const src = read("components/futures.js");
  const start = src.indexOf("function renderForwardCurve(");
  assert.ok(start > 0, "renderForwardCurve not found");
  // Run the function on its own: everything up to the next top-level function.
  const end = src.indexOf("\nfunction ", start + 10);
  const fn = src.slice(start, end);
  const el = { outerHTML: "", style: {}, getBoundingClientRect: () => ({ width: 700 }), textContent: "", innerHTML: "" };
  const els = { "fwd-svg": el };
  const ctx = {
    document: { getElementById: (id) => els[id] || null },
    AG: { px: { priceDollars: (p, o) => (o && o.dollar === false ? "" : "$") + p.toFixed(2) } },
    Math, Date, isFinite, String,
  };
  vm.createContext(ctx);
  try { vm.runInContext(fn + "\nrenderForwardCurve('corn',LIST,QUOTES," + isGrain + ");", Object.assign(ctx, {
    LIST: [{ key: "ZCZ26", month: "Dec '26", idx: 1 }, { key: "ZCH27", month: "Mar '27", idx: 4 }, { key: "ZCZ27", month: "Dec '27", idx: 13, newCrop: true }],
    QUOTES: { ZCZ26: { close: 474.25 }, ZCH27: { close: 488 }, ZCZ27: { close: 506 } },
  })); } catch (e) { /* the carry note after the chart needs more of the page; the chart is drawn first */ }
  return el.outerHTML;
}

test("the futures forward curve is drawn with role=img and a label listing each contract it plots", () => {
  const out = drawForwardCurve(true);
  assert.match(out, /^<svg [^>]*role="img"/, "chart drawn without role=img");
  const label = (out.match(/aria-label="([^"]*)"/) || [])[1];
  assert.ok(label, "chart drawn without aria-label");
  assert.equal(label, "Futures price by contract month, dollars per bushel: Dec '26 4.74, Mar '27 4.88, Dec '27 5.06 (new crop)");
  assert.ok(label.length < 300);
});

test("the forward-curve placeholders and the cattle chart are labelled", () => {
  for (const f of ["corn-futures-prices.html", "soybean-futures-prices.html", "wheat-futures-prices.html", "cattle-futures-prices.html"]) {
    const s = read(f);
    assert.match(s, /<svg class="fwd-svg" id="fwd-svg" viewBox="0 0 700 140" xmlns="http:\/\/www.w3.org\/2000\/svg" role="img" aria-label="Futures price by contract month, loading"><\/svg>/, f);
  }
  const c = read("cattle-futures-prices.html");
  assert.match(c, /var aria='Cattle futures price by contract month, dollars per hundredweight: '\+pts\.map/);
  assert.match(c, /role="img" aria-label="'\+aria\+'">'\];/);
});
