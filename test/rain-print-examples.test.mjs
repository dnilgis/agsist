/* Rain Print: the example print in the empty frame at the top of /rain-print
 * (2026-10-15). Search engines and image search see a real print in the HTML
 * before NOAA answers. It is drawn by the page itself
 * (scripts/render_rain_print_examples.mjs) from the real NOAA answers saved in
 * data/rain-print-examples/ (scripts/fetch_rain_print_examples.mjs), never
 * from made-up numbers on a real town.
 *
 * Checks: the images exist and are small; the frame holds the 2012 Ames one
 * at the print's own 3:2 size, labeled as an example; the alt text names the
 * town and year, and every number in it is the one the engine gets from the
 * saved data (the year's total and the biggest rain, with its date); the
 * Product schema lists both; the page script leaves the example up until a
 * live draw replaces it.
 *
 *   node --test test/rain-print-examples.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "rain-print.html", "utf8");
const JS = readFileSync(ROOT + "components/rain-print.js", "utf8");
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctx.window = ctx;
vm.runInNewContext(JS, ctx);
const RP = ctx.RainPrint;
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EXAMPLES = [
  { slug: "2012-ames-ia", town: "Ames, Iowa", year: 2012 },
  { slug: "1993-des-moines-ia", town: "Des Moines, Iowa", year: 1993 },
];

// the year as the engine reads it: daily()'s rows, closeOpenS, derive
function yearOf(slug) {
  const j = JSON.parse(readFileSync(ROOT + "data/rain-print-examples/" + slug + ".json", "utf8"));
  const q = j.requests.filter((r) => r.url.includes("StnData?sid=") && new URL(r.url).searchParams.get("sid") === j.station).pop();
  assert.ok(q && Array.isArray(q.body.data), slug + ": the picked station's days are saved");
  const days = q.body.data.map((row, i) => {
    const p = RP.parsePcpn(row[1]), dt = new Date(row[0] + "T00:00:00");
    return { date: row[0], v: p.v, flag: p.flag, t: null, s: row[3] !== undefined ? RP.parsePcpn(row[3]).v : null, m: dt.getMonth(), d: dt.getDate(), doy: i };
  });
  return { j, D: RP.derive(RP.closeOpenS(days)) };
}
const shortDate = (iso) => MON3[+iso.slice(5, 7) - 1] + " " + +iso.slice(8, 10);
const unent = (s) => s.replace(/&rsquo;/g, "’").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

test("the example images exist, are small, and come from saved real NOAA answers", () => {
  for (const ex of EXAMPLES) {
    const data = ROOT + "data/rain-print-examples/" + ex.slug + ".json";
    assert.ok(existsSync(data), data);
    const j = JSON.parse(readFileSync(data, "utf8"));
    assert.equal(j.year, ex.year);
    assert.match(j.fetched, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(j.requests.some((r) => r.url.startsWith("https://data.rcc-acis.org/")), "NOAA's answers are in it");
    for (const k of ["webp", "jpg"]) {
      const f = ROOT + "img/rain-print-example-" + ex.slug + "." + k;
      assert.ok(existsSync(f), f);
      assert.ok(statSync(f).size <= 120 * 1024, f + " is at most 120 KB: " + statSync(f).size);
    }
    const jpg = readFileSync(ROOT + "img/rain-print-example-" + ex.slug + ".jpg");
    assert.equal(jpg[0], 0xff); assert.equal(jpg[1], 0xd8);
    const webp = readFileSync(ROOT + "img/rain-print-example-" + ex.slug + ".webp");
    assert.equal(webp.toString("ascii", 0, 4), "RIFF"); assert.equal(webp.toString("ascii", 8, 12), "WEBP");
  }
});

test("the frame holds the 2012 Ames example at the print's size, labeled as an example", () => {
  const art = HTML.match(/<div class="rp-art rp-empty" id="rp-art">([\s\S]*?)<\/div>/);
  assert.ok(art, "the empty frame");
  const inner = art[1];
  assert.match(inner, /<picture class="rp-ex"><source type="image\/webp" srcset="\/img\/rain-print-example-2012-ames-ia\.webp"><img src="\/img\/rain-print-example-2012-ames-ia\.jpg" width="1200" height="800" /, "WebP with a JPG fallback, sized 3:2 like the drawn print");
  assert.match(inner, /<span class="rp-ex-tag"[^>]*>Example<\/span>/, "labeled as an example");
  assert.match(inner, /<p class="rp-placeholder">/, "the words for an empty frame are still there");
  assert.ok(!/loading="lazy"/.test(inner), "the first thing on the page is not lazy");
  // the 3:2 box the live print fills, so nothing moves when it is drawn
  assert.match(HTML, /\.rp-art\.rp-empty\{aspect-ratio:3\/2;/);
  assert.match(HTML, /\.rp-ex,\.rp-ex img\{position:absolute;inset:0;[^}]*width:100%;height:100%/);
});

test("the alt text names the town and the year, and its numbers are the saved data's", () => {
  const alt = unent(HTML.match(/<picture class="rp-ex">[\s\S]*?<img [^>]*alt="([^"]+)"/)[1]);
  const ex = EXAMPLES[0];
  assert.ok(alt.startsWith("Example Rain Print"), "says it is an example: " + alt);
  assert.ok(alt.includes(ex.town), "names the town");
  assert.ok(alt.includes(String(ex.year)), "names the year");
  const { D } = yearOf(ex.slug);
  assert.ok(D.missing <= 10, "a near-complete year");
  const total = D.total.toFixed(2) + " in of rain and melted snow";
  assert.ok(alt.includes(total), "the year's total, " + total + ": " + alt);
  assert.ok(D.maxRain.v > 0, "a biggest rain on record");
  const big = "Biggest rain: " + D.maxRain.v.toFixed(2) + " in on " + shortDate(D.maxRain.date) + ".";
  assert.ok(alt.includes(big), big + ": " + alt);
  // no other number sneaks in: every number in the alt is one of these
  const allowed = new Set([String(ex.year), D.total.toFixed(2), D.maxRain.v.toFixed(2), String(+D.maxRain.date.slice(8, 10))]);
  for (const n of alt.match(/\d+(?:\.\d+)?/g)) assert.ok(allowed.has(n), "a number in the alt that isn't from the data: " + n);
});

test("both examples are in the Product schema's images", () => {
  const ld = JSON.parse(HTML.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  const prod = ld["@graph"].find((g) => g["@type"] === "Product");
  assert.ok(Array.isArray(prod.image), "a list of images");
  for (const ex of EXAMPLES) {
    const u = "https://agsist.com/img/rain-print-example-" + ex.slug + ".jpg";
    assert.ok(prod.image.includes(u), u);
    assert.ok(existsSync(ROOT + u.replace("https://agsist.com/", "")), "the file is published: " + u);
  }
});

test("the page script leaves the example up until a live draw replaces it", () => {
  // every 'drawing...' placeholder is guarded; the drawn print (and a failure, via EMPTY_ART) still replace it
  const placeholders = [...JS.matchAll(/^.*Drawing (?:a year of rain near you|a sample from NOAA records)[^\n]*$/gm)].map((m) => m[0]);
  assert.equal(placeholders.length, 2);
  for (const l of placeholders) assert.match(l, /if \(!art\.querySelector\('\.rp-ex'\)\) art\.innerHTML = /, l.trim());
  assert.match(JS, /if \(!DATA && !SAMPLE && ST\.place && ST\.year && !art\.querySelector\('\.rp-ex'\)\) \{/);
  assert.match(JS, /var EMPTY_ART = art\.innerHTML/, "the empty frame, example and all, is what a failed draw goes back to");
});
