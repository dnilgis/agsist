/* Rain Print: the letter that goes on top in every print box (2026-10-17,
 * components/rp-insert.js, made on the maker page by "Insert letter PDF").
 *
 * Checks, on the real 2012 Ames NOAA answers saved for the example print
 * (data/rain-print-examples/2012-ames-ia.json): every number on the letter is
 * the one the print itself shows (the art and the letter both drawn here from
 * the same input, in both styles); the giver's note is there only when the
 * order has one; the serial and the maker line; nothing runs past the foot even
 * with the longest note and five marked days; no em dashes, no "archival", no
 * prices; the maker page has the button and the note box, and the engine makes
 * the letter the way it makes the order files.
 *
 *   node --test test/rain-print-insert.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctx.window = ctx;
for (const f of ["components/qr.js", "components/rain-print.js", "components/rain-print-art.js", "components/rp-insert.js"]) vm.runInNewContext(read(f), ctx);
const RP = ctx.RainPrint, A = ctx.AgRainArt, INS = ctx.AgRpInsert;

// the year as the engine reads it (the same steps as test/rain-print-examples.test.mjs), with NOAA's normal
const ex = JSON.parse(read("data/rain-print-examples/2012-ames-ia.json"));
const sidOf = (u) => new URL(u).searchParams.get("sid");
const q = ex.requests.filter((r) => r.url.includes("StnData?sid=") && sidOf(r.url) === ex.station && new URL(r.url).searchParams.get("sdate") !== "por").pop();
const days = RP.closeOpenS(q.body.data.map((row, i) => {
  const p = RP.parsePcpn(row[1]), dt = new Date(row[0] + "T00:00:00");
  return { date: row[0], v: p.v, flag: p.flag, t: null, s: row[3] !== undefined ? RP.parsePcpn(row[3]).v : null, m: dt.getMonth(), d: dt.getDate(), doy: i };
}));
const D = RP.derive(days);
const nq = ex.requests.find((r) => r.url.includes("StnData?params=") && decodeURIComponent(r.url).includes('"normal"'));
const byDate = new Map();
nq.body.data.forEach((row) => { const v = RP.parsePcpn(row[1]).v; if (v !== null) byDate.set(row[0].slice(5), v); });
const ov = RP.overlayDaily(days, byDate);

function input(style, markers) {
  return {
    style, year: 2012, place: "Ames, Iowa", name: "", dedication: "", days, D, showDry: RP.showDry(D), axisLen: D.n,
    ov, ovNote: RP.cmpNoteFor("normal"), showNormals: true, markers: RP.markersOn(markers || [], 2012, D.n), records: [],
    qr: { matrix: RP.standardMatrix(), serial: "No. 0001" }, preview: null, gauge: "Weather station: Ames, IA, 2.0 mi from Ames"
  };
}
function make(style, opts) {
  opts = opts || {};
  const I = input(style, opts.markers);
  const art = A.render(I);
  const F = A.facts(I, { unplaced: A.lastUnplaced() });
  const o = { facts: F, mini: art, serial: opts.serial === undefined ? "No. 0001" : opts.serial, gift: opts.gift || "", qr: RP.standardMatrix(),
    station: { words: "Ames, IA", dist: "2.0 mi from Ames", kind: "volunteer" }, source: "NOAA’s daily records" };
  const svg = INS.render(o);
  return { art, F, svg, copy: INS.copy(o), overflow: INS.lastOverflow() };
}
// the words on a sheet, one string per <text>, tspans joined in
const texts = (svg) => [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'));
// the letter's own words, without the small print drawn inside it
const letterTexts = (svg) => texts(svg.replace(/<svg x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*"[\s\S]*?<\/svg>/, ""));

test("the letter's numbers are the print's numbers (2012 Ames, Staircase)", () => {
  const { art, F, svg } = make("r1", { markers: [{ date: "2012-05-01", label: "Planted" }] });
  const P = texts(art).join(" | "), L = letterTexts(svg).join(" | ");
  // the engine's own year (the page's numbers box reads the same D)
  assert.equal(F.totalText, D.total.toFixed(2) + " in");
  assert.equal(F.totalText, "25.52 in");
  assert.equal(F.wet.amount, "1.89 in"); assert.equal(F.wet.date, "2012-04-15");
  assert.equal(F.snowText, "28.3 in");
  assert.equal(F.verdict, "32% less than a usual year");
  assert.equal(F.usual, "37.73 in");
  assert.equal(F.usual, ov.total.toFixed(2) + " in");
  assert.equal(F.wetDays, D.wet); assert.equal(F.wetDays, 95);
  assert.equal(F.dry.len, D.dryMax.len); assert.equal(F.dry.len, 24);
  // each one on the print
  for (const s of ["25.52 in", "Biggest rain: 1.89 in", "Apr 15", "32% less than a usual year", "37.73 in", "Days with rain or snow: 95", "Snow: 28.3 in", "24 dry days", "Planted"]) assert.ok(P.includes(s), "the print says " + s + ": " + P.slice(0, 400));
  // and the same on the letter
  for (const s of ["25.52 in", "rain and melted snow", "Biggest rain", "1.89 in", "April 15", "28.3 in", "32% less than a usual year", "usual: 37.73 in, NOAA’s 30-year normal", "95", "24 days", "September 19 to October 12", "Planted, May 1"]) assert.ok(L.includes(s), "the letter says " + s + ": " + L);
  // the dry stretch the letter names is the print's (September 19 to October 12 = 24 days)
  assert.equal(F.dry.from, "2012-09-19"); assert.equal(F.dry.to, "2012-10-12");
  assert.equal((Date.parse(F.dry.to) - Date.parse(F.dry.from)) / 864e5 + 1, 24);
});

test("Roots: the same numbers, the Roots key, and the print drawn inside the letter", () => {
  const { art, F, svg, copy } = make("r2");
  const P = texts(art).join(" | ");
  assert.equal(F.style, "r2");
  for (const s of ["25.52 in", "28.3 in", "32% less than a usual year", "Biggest rain: 1.89 in", "24 dry days"]) assert.ok(P.includes(s), "the Roots print says " + s);
  assert.ok(copy.key.some((k) => k[0] === "bar") && !copy.key.some((k) => k[0] === "climb"), "the Roots key, not the Staircase one");
  assert.ok(svg.includes('<svg x="'), "the print itself is drawn small inside the letter");
  assert.ok(letterTexts(svg).join(" ").includes("24 days"));
});

test("a Staircase dry stretch under 14 days is not on the print, so not on the letter", () => {
  const I = input("r1");
  I.D = Object.assign({}, D, { dryMax: Object.assign({}, D.dryMax, { len: 10 }) });
  assert.equal(A.facts(I).dry, null, "Staircase marks a dry stretch from 14 days");
  I.style = "r2";
  assert.equal(A.facts(I).dry.len, 10, "Roots marks any the engine shows (7 days up)");
});

test("the giver's note shows only when the order has one", () => {
  const none = make("r1");
  assert.ok(!none.svg.includes('data-rp="gift"') && !none.svg.includes("A NOTE FOR YOU"), "no note, no block");
  const g = make("r1", { gift: "For Dad, for 40 harvests <b>" });
  assert.ok(g.svg.includes('data-rp="gift"') && g.svg.includes("A NOTE FOR YOU"));
  assert.ok(letterTexts(g.svg).join(" ").includes("For Dad, for 40 harvests <b>"));
  assert.ok(!g.svg.includes("<b>"), "the note is escaped");
});

test("the serial and Sig's maker line; a blank to fill in without a serial", () => {
  const a = letterTexts(make("r1").svg).join(" ");
  assert.match(a, /Print No\. 0001, made, numbered and initialed/);
  assert.match(a, /Sig Lindquist, CCA, Chetek, Wisconsin\./);
  assert.match(a, /Draw another year at agsist\.com\/rain-print/);
  const b = letterTexts(make("r1", { serial: "" }).svg).join(" ");
  assert.match(b, /Print No\. ______, made/);
  assert.ok(make("r1").svg.includes('data-rp="qr"'), "the standard code at the foot");
});

test("nothing runs past the foot, even with the longest note and five marked days", () => {
  const long = "For Dad, for 40 harvests. ".repeat(10).slice(0, 240);
  const marks = [["2012-04-20", "Planted"], ["2012-06-10", "Hail"], ["2012-08-01", "Wedding"], ["2012-10-01", "Harvest"], ["2012-12-01", "Done"]].map(([date, label]) => ({ date, label }));
  for (const st of ["r1", "r2"]) {
    const m = make(st, { gift: long, markers: marks });
    assert.equal(m.overflow, 0, st + " fits");
    const ys = [...m.svg.replace(/<svg x="[\s\S]*?<\/svg>/, "").matchAll(/<text x="[^"]*" y="([\d.]+)"/g)].map((x) => +x[1]);
    assert.ok(Math.max(...ys) <= INS.H - 50, st + ": every line inside the 0.5 in margin: " + Math.max(...ys));
    assert.ok(Math.min(...[...m.svg.replace(/<svg x="[\s\S]*?<\/svg>/, "").matchAll(/<text x="([\d.]+)"/g)].map((x) => +x[1])) >= 48, st + ": inside the left margin");
  }
});

test("plain words: no em dashes, never archival, no prices or store names", () => {
  const src = read("components/rp-insert.js");
  assert.ok(!src.includes("—") && !src.includes("&mdash;"), "no em dash in the source");
  for (const st of ["r1", "r2"]) {
    const words = letterTexts(make(st, { gift: "For Dad", markers: [{ date: "2012-05-01", label: "Planted" }] }).svg).join(" ");
    assert.ok(!words.includes("—"), "no em dash on the letter");
    assert.doesNotMatch(words, /archival|\$|Etsy|Amazon|Shopify|Stripe|printer|limited|only \d+/i);
  }
});

test("the maker page has the button and the note box; the engine makes the letter like the order files", () => {
  const html = read("rain-print.html"), js = read("components/rain-print.js");
  const maker = html.match(/<div class="rp-maker" id="rp-maker" hidden>([\s\S]*?)\n          <\/div>\n        <\/section>/);
  assert.ok(maker, "the maker box");
  assert.match(maker[1], /<button class="btn btn-secondary" type="button" data-size="insert" data-fmt="pdf">Insert letter PDF<\/button>/);
  assert.match(maker[1], /<textarea id="rp-ins-gift" maxlength="240"/, "the gift note, as long as the order form's");
  assert.match(html, /id="ro-gift-msg" maxlength="240"/, "the order form's note is 240 letters too");
  assert.match(js, /sc\.src = '\/components\/rp-insert\.js\?v=\d+'/, "loaded on first use");
  assert.match(js, /root\.AgRainArt\.facts\(I, \{ unplaced: root\.AgRainArt\.lastUnplaced\(\) \}\)/, "the print's own facts, after the print's own render");
  assert.match(js, /pdfFromJpeg\(new Uint8Array\(buf\), c\.width, c\.height, LETTER, 0\)/, "a letter-size PDF with no bleed");
  assert.match(js, /var LETTER = \{ w: 8\.5, h: 11/);
  assert.match(js, /if \(PREVIEW\) \{ out\.textContent = 'The letter is made from the full year/, "no letter from a part year");
  assert.match(js, /data-size'\) === 'insert'\) insertFile\(b\)/);
  assert.ok(!/rp-insert\.js/.test(html), "not loaded with the page");
});
