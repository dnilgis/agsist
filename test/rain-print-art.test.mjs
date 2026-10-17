/* Rain Print styles (2026-10-13): R1 Staircase and R2 Roots, drawn by
 * components/rain-print-art.js from the engine's days, and the design code and
 * page wiring that carry the style, dedication and the two switches.
 * The shipped files run in bare vm contexts, so a green run checks the copies the browser loads.
 *
 *   node --test test/rain-print-art.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob, Map, Promise };
ctx.window = ctx;
for (const f of ["components/qr.js", "components/rain-print.js", "components/rain-print-art.js", "components/rain-print-records.js"])
  vm.runInNewContext(readFileSync(ROOT + f, "utf8"), ctx);
const RP = ctx.RainPrint, ART = ctx.AgRainArt, REC = ctx.AgRainRecords;
const plain = (x) => JSON.parse(JSON.stringify(x));

// ---------- a year of days in the engine's shape ----------
const DAY = 86400000;
function year(y, f) {
  const n = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365, days = [];
  for (let i = 0; i < n; i++) {
    const dt = new Date(Date.UTC(y, 0, 1) + i * DAY), o = Object.assign({ p: (i % 9 === 0 ? (0.1 + (i % 7) * 0.12).toFixed(2) : "0.00"), s: 0 }, f ? f(i, dt) : {});
    const pp = RP.parsePcpn(o.p);
    days.push({ date: dt.toISOString().slice(0, 10), v: pp.v, flag: pp.flag, t: null, s: o.s, m: dt.getUTCMonth(), d: dt.getUTCDate(), doy: i });
  }
  return days;
}
const normalMap = (y) => { const m = new Map(); year(y).forEach((x) => m.set(x.date.slice(5), 0.09)); return m; };
function input(days, extra = {}) {
  const D = RP.derive(days), y = +days[0].date.slice(0, 4);
  return Object.assign({ style: "r1", year: y, place: "Chetek, Wisconsin", name: "The Olson Farm", dedication: "", days, D, showDry: RP.showDry(D),
    axisLen: days.length, ov: RP.overlayDaily(days, normalMap(y)), ovNote: "A usual year: NOAA’s 30-year normal", showNormals: false, markers: [], records: [],
    qr: { matrix: ctx.AgQR.matrix("HTTPS://AGSIST.COM/R?K7Q2M"), serial: "" } }, extra);
}
const texts = (svg) => [...svg.matchAll(/<text[^>]*>((?:[^<]|<\/?tspan[^>]*>)*)<\/text>/g)].map((m) => m[1].replace(/<\/?tspan[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'"));

// ---------- design code and query string ----------
const FULL = { place: "Chetek, WI", station: "471667 2", year: 2025, cmp: "normal", name: "The Olson Farm",
  markers: [{ date: "2025-05-12", label: "Planted" }], style: "r2", dedication: "For Dad, his 40th crop. Love, Kate", normals: true, records: true };

test("style, dedication and both switches round-trip through the code and the query string", () => {
  for (const style of ["r1", "r2"]) for (const normals of [false, true]) for (const records of [false, true]) for (const dedication of ["", "For Dad"]) for (const markers of [[], FULL.markers]) {
    const s = { ...FULL, style, normals, records, dedication, markers };
    assert.deepEqual(plain(RP.decodeCode(RP.encodeCode(s))), plain(RP.normalize(s)), JSON.stringify({ style, normals, records, dedication, n: markers.length }));
    assert.deepEqual(plain(RP.fromParams("?" + RP.toParams(s))), plain(RP.normalize(s)));
  }
  const q = RP.toParams(FULL);
  assert.match(q, /style=r2/); assert.match(q, /normals=1/); assert.match(q, /records=1/); assert.match(q, /dedication=For\+Dad/);
});

test("R1 is the default; an old v1 code still opens, as R1, or R2 if it was a Waveform", () => {
  assert.equal(RP.normalize({}).style, "r1");
  assert.equal(RP.normalize({ style: "nope" }).style, "r1");
  const v1 = (k) => Buffer.from("1|Chetek, WI|471667 2|2025|" + k + "|The Olson Farm|83|Planted").toString("base64url");
  const a = RP.decodeCode(v1("spna")), b = RP.decodeCode(v1("wpna"));
  assert.ok(a && b, "v1 codes decode");
  assert.equal(a.style, "r1"); assert.equal(b.style, "r2");
  assert.equal(a.dedication, ""); assert.equal(a.normals, false); assert.equal(a.records, false);
  assert.equal(a.markers[0].label, "Planted");
  assert.equal(RP.decodeCode(Buffer.from("2|Chetek|x|2025|spnaz|").toString("base64url")), null, "unknown style letter");
  assert.equal(RP.decodeCode(Buffer.from("2|Chetek|x|2025|spnaa||").toString("base64url")), null, "an empty dedication field is not a code");
});

test("the dedication is cleaned and capped; a typical design with a full dedication still fits Stripe", () => {
  const s = RP.normalize({ ...FULL, dedication: "A|B " + "x".repeat(80) });
  assert.ok(s.dedication.length <= RP.LIMITS.dedication && !s.dedication.includes("|"));
  assert.equal(RP.LIMITS.dedication, 70, "70 since 2026-10-13: the longest line was drawn at both styles (test/rain-print-launch.test.mjs)");
  const code = RP.encodeCode({ ...FULL, dedication: "D".repeat(40), markers: [{ date: "2025-05-12", label: "Planted" }, { date: "2025-10-20", label: "Harvest done" }] });
  assert.ok(code.length <= 200, "code is " + code.length);
});

test("the serial is maker-only: never in the share link, only behind ?maker=1, never on the digital file", () => {
  assert.ok(!/serial/.test(RP.toParams({ ...FULL, serial: "12" })));
  assert.ok(!("serial" in RP.normalize({ ...FULL, serial: "12" })));
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  assert.match(S, /return MAKER && m && \+m\[1\] > 0 \? 'No\. ' \+ String\(\+m\[1\]\)\.padStart\(4, '0'\) : '';/);
  const draw = S.slice(S.indexOf("function drawCanvas("), S.indexOf("function toBlob("));
  assert.equal((draw.match(/o\.serial = SERIAL/g) || []).length, 1, "one place sets it");
  assert.ok(draw.indexOf("o.serial = SERIAL") > draw.indexOf("kind === 'digital'"), "and it is the print branch, after the digital one");
  const svgExport = S.slice(S.indexOf("if (fmt === 'svg')"), S.indexOf("job = go(function () { return drawCanvas(kind, own); })"));
  assert.ok(svgExport.length > 50 && svgExport.length < 600, "the slice is the SVG branch only");
  assert.ok(!/serial/i.test(svgExport), "the SVG export carries no serial");
});

// ---------- the art ----------
test("both styles draw a whole 1800 x 1200 sheet with the place, year, name and totals", () => {
  for (const style of ["r1", "r2"]) {
    const svg = ART.render(input(year(2025), { style, dedication: "For Dad" }));
    assert.match(svg, /^<svg[^>]*viewBox="0 0 1800 1200"/);
    assert.ok(svg.endsWith("</svg>"));
    assert.ok(!/NaN|undefined|Infinity/.test(svg), style + " has no broken numbers");
    const t = texts(svg).join(" | ");
    for (const want of ["Chetek, Wisconsin", "2025", "For Dad"]) assert.ok(t.includes(want), style + " shows " + want);
    assert.ok(t.toUpperCase().includes("THE OLSON FARM"), style + " shows the name");
    assert.ok(t.includes(RP.derive(year(2025)).total.toFixed(2) + " in"), style + " shows the year's total");
  }
});

test("the QR is warm gray on the paper, square to the page; the serial is drawn only when handed one", () => {
  for (const style of ["r1", "r2"]) {
    const plainSvg = ART.render(input(year(2025), { style }));
    assert.match(plainSvg, /fill="#A4A89F" shape-rendering="crispEdges"/);
    assert.ok(!/rotate\(/.test(plainSvg.replace(/<g opacity="0\.13" transform="rotate[^"]*"/, "")), "nothing is tilted");
    assert.ok(!/No\. \d{4}/.test(plainSvg), "no serial unless asked");
    assert.ok(!/SRL/.test(plainSvg), "no printed initials (Sig initials each print by hand)");
    const withSerial = ART.render(input(year(2025), { style, qr: { matrix: ctx.AgQR.matrix("HTTPS://AGSIST.COM/R?K7Q2M"), serial: "No. 0001" } }));
    assert.ok(texts(withSerial).includes("No. 0001"));
    assert.ok(!/A4A89F/.test(ART.render(input(year(2025), { style, qr: null }))), "no QR when the link would not fit");
  }
});

test("the short-link QR prints about 0.85 in with a 4-module quiet zone; the serial fits under it", () => {
  const m = ctx.AgQR.matrix("HTTPS://AGSIST.COM/R?K7Q2M");
  assert.equal(m.length, 25);
  for (const style of ["r1", "r2"]) {
    const svg = ART.render(input(year(2025), { style, qr: { matrix: m, serial: "No. 0001" } }));
    const g = /<g data-rp="qr"><g aria-hidden="true"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#FFFFFF"\/><path d="([^"]+)"/.exec(svg);
    // runs are drawn from absolute edges since 2026-10-14 (D7): M x0,y H x1 V y1 H x0 z
    const xs = [...g[5].matchAll(/M([\d.]+),([\d.]+)H([\d.]+)/g)], ys = xs.map((t) => +t[2]);
    const x0 = Math.min(...xs.map((t) => +t[1])), x1 = Math.max(...xs.map((t) => +t[3]));
    const size = x1 - x0;
    assert.ok(Math.abs(size - 83.33) < 0.1, style + ": the mark is " + size + " u");
    assert.ok(Math.abs(+g[3] - size - 2 * 4 * size / 25) < 0.1, style + ": the white square leaves 4 modules each side");
    const serial = new RegExp('<text x="[\\d.]+" y="([\\d.]+)"[^>]*>No\\. 0001</text>').exec(svg);
    assert.ok(+serial[1] - 11.5 * 0.77 > Math.max(...ys) + size / 25, style + ": the serial sits under the mark");
    assert.ok(+serial[1] <= 1140, style + ": inside the 0.6 in margin");
  }
  // Roots: a deep December rain (the year's biggest, its bar down to 994) would run under the mark, so the mark moves down to the small line
  const dec = year(2025, (i) => (i === 350 ? { p: "2.50" } : i % 9 === 0 ? { p: "0.30" } : { p: "0.00" }));
  const svg = ART.render(input(dec, { style: "r2", qr: { matrix: m, serial: "" } }));
  const q = /<g data-rp="qr"><g aria-hidden="true"><rect x="([\d.]+)" y="([\d.]+)"/.exec(svg);
  assert.ok(+q[2] > 994 + 3, "the QR's white square stays below the deepest bar: " + q[2]);
});

test("an unrecorded day is a gap: R1's pen lifts, R2's ground line breaks", () => {
  const gap = (i) => (i >= 100 && i < 104 ? { p: "M" } : i === 200 ? { p: "S" } : {});
  const days = year(2025, gap);
  const r1 = ART.render(input(days, { style: "r1" })), r2 = ART.render(input(days, { style: "r2" }));
  const stair = /<path d="(M[^"]+)" fill="none" stroke="#2B5C8A"/.exec(r1)[1];
  assert.equal((stair.match(/M/g) || []).length, 3, "the line starts, then comes down again after each of the two gaps");
  const ground = [...r2.matchAll(/<line [^>]*y1="478" [^>]*y2="478" stroke="#1E2125" stroke-width="1.53"\/>/g)];
  assert.equal(ground.length, 3, "three stretches of ground line around two gaps");
});

test("the normals: month normals only with the switch on; what usual means wherever a usual year is printed; unrecorded days left out of both totals", () => {
  const days = year(2025, (i) => (i >= 10 && i < 20 ? { p: "M" } : {}));
  for (const style of ["r1", "r2"]) {
    const off = texts(ART.render(input(days, { style }))), on = texts(ART.render(input(days, { style, showNormals: true })));
    assert.ok(!off.some((t) => /^usual /.test(t)), style + ": off shows no month normals");
    // 2026-10-13 launch fix: the verdict says "a usual year", so the print says what that is even with the normals off
    assert.ok(off.some((t) => /usual year/.test(t)) && off.some((t) => t.includes("A usual year: NOAA’s 30-year normal")), style + ": a usual year is defined where it is printed");
    const none = texts(ART.render(input(days, { style, ov: null })));
    assert.ok(!none.some((t) => /usual/i.test(t)), style + ": no comparison, no usual wording at all");
    if (style === "r2") assert.ok(on.some((t) => /^usual \d/.test(t)), style + ": on shows the month normals");
    // Staircase A2 clean (Sig, 2026-10-17): the usual total is the light gray number under each month, and the foot line says so
    else {
      const months = /<g data-rp="months">(.*?)<\/g>/.exec(ART.render(input(days, { style, showNormals: true })))[1];
      assert.equal([...months.matchAll(/font-size="11" fill="#A3A8B0"/g)].length, 12, style + ": on shows the twelve month normals, 11 u light gray");
      assert.ok(!/fill="#A3A8B0"/.test(/<g data-rp="months">(.*?)<\/g>/.exec(ART.render(input(days, { style })))[1]), style + ": off shows none");
      assert.ok(on.some((t) => t.includes("the usual month total is the gray number under each month")), style + ": and the foot line says what they are");
    }
    assert.ok(on.some((t) => t.includes("A usual year: NOAA’s 30-year normal")), style + ": and names them");
  }
  const t = texts(ART.render(input(days, { style: "r1" })));
  assert.ok(t.some((x) => x.startsWith(((days.length - 10) * 0.09).toFixed(2) + " in ")), "a usual year counts only the days the station recorded");
  assert.ok(!t.some((x) => x.startsWith((days.length * 0.09).toFixed(2) + " in")));
});

test("R2: a snow day shows above the line only; its water still counts in the total", () => {
  const days = year(2025, (i) => (i === 5 ? { p: "0.30", s: 3 } : i === 40 ? { p: "0.60" } : i === 50 ? { p: "0.20" } : { p: "0.00" }));
  const svg = ART.render(input(days, { style: "r2" }));
  const bars = /<g fill="#26313D">(.*?)<\/g>/.exec(svg)[1];
  assert.equal((bars.match(/<rect/g) || []).length, 1, "one dark bar: the 0.20 day (0.60 is the red biggest rain, the snow day has none)");
  assert.equal((/<g fill="#AFCBE2"[^>]*>(.*?)<\/g>/.exec(svg)[1].match(/<rect/g) || []).length, 1, "one snow pile");
  assert.ok(texts(svg).includes("1.10 in"), "0.30 + 0.60 + 0.20");
  assert.ok(texts(svg).includes("rain, in"), "the lower scale reads rain, in");
});

// the x of every red (accent) bar or riser on the sheet
// (Staircase A2 clean, 2026-10-17: its red is #B23A2E)
const redXs = (svg) => [...svg.matchAll(/<(rect|line)\b[^>]*(?:fill|stroke)="#(?:A8321E|B23A2E)"[^>]*>/g)].map((m) => {
  const a = (k) => +(new RegExp(k + '="([-\\d.]+)"').exec(m[0]) || [])[1];
  return m[1] === "line" ? a("x1") : a("x") + a("width") / 2;
});

test("the biggest rain is a rain day: a bigger snow day is never the red mark, in either style (Sig, 2026-10-13)", () => {
  // day 40: 1.50 in of water that fell as 15 in of snow; day 100: 0.80 in of rain, the biggest rain
  const days = year(2025, (i) => (i === 40 ? { p: "1.50", s: 15 } : i === 100 ? { p: "0.80" } : i % 9 === 0 ? { p: "0.10" } : { p: "0.00" }));
  const I = input(days);
  const E = ART.model(I);
  assert.equal(E.wi, 100);
  assert.equal(E.wetText, "Biggest rain: 0.80 in\u0001Apr 11\u0002", "the day rides after the amount, in gray (2026-10-15)");
  assert.equal(I.D.max.doy, 40, "the page's Wettest day stat still names the snow day (it is the most water)");
  for (const [style, x0, x1, half] of [["r1", 196, 1590, 0], ["r2", 205, 1690, 0.5]]) {
    const svg = ART.render(input(days, { style })), w = (x1 - x0) / 365, xs = redXs(svg);
    assert.ok(xs.length >= 1, style + ": the red mark is drawn");
    assert.ok(!xs.some((x) => Math.abs(x - (x0 + (40 + half) * w)) < w * 1.5), style + ": nothing red on the snow day: " + xs.join(","));
    assert.ok(xs.some((x) => Math.abs(x - (x0 + (100 + half) * w)) < w), style + ": red on the biggest rain");
    assert.ok(texts(svg).some((t) => t.includes("Biggest rain: 0.80 in Apr 11")), style + ": and it is named");
  }
  // without a whole snow record the old rule stands: the wettest day, named for what it is
  const noRecord = year(2025, (i) => (i === 40 ? { p: "1.50", s: 15 } : i === 100 ? { p: "0.80" } : i < 30 ? { p: "0.00", s: null } : { p: "0.00" }));
  const E2 = ART.model(input(noRecord));
  assert.equal(E2.snowState, "unknown");
  assert.equal(E2.wetText, "Wettest day: 1.50 in\u0001Feb 10\u0002");
});

test("Staircase: snow is drawn above the line only, nothing under the zero axis (Sig, 2026-10-13)", () => {
  const days = year(2025, (i) => (i < 60 && i % 5 === 0 ? { p: "0.40", s: 5 } : i % 9 === 0 ? { p: "0.20" } : { p: "0.00" }));
  for (const showNormals of [false, true]) {
    const svg = ART.render(input(days, { style: "r1", showNormals })), PB = 716;
    assert.ok(/stroke="#8DB6D8"/.test(svg), "the snow steps are on the staircase, in ice blue");
    const under = [...svg.matchAll(/<rect x="[-\d.]+" y="([-\d.]+)"[^>]*>/g)].filter((m) => +m[1] > PB && +m[1] < PB + 60);
    assert.equal(under.length, 0, "no snow lane under the axis");
    assert.ok(!texts(svg).includes("snow"), "and no lane name");
    assert.ok(texts(svg).some((t) => /Snow: [\d.]+ in, the light blue steps/.test(t)), "the foot line gives the snow total and says which color is snow");
  }
  // one plain sentence on the small line says which mark is which, in both styles
  // (Staircase A2 clean, 2026-10-17: the foot line gives the snow total as "the light blue steps")
  const say = { r1: "the light blue steps", r2: "Light blue above the ground is snow, dark bars below it are rain" };
  for (const style of ["r1", "r2"]) {
    assert.ok(texts(ART.render(input(days, { style }))).some((t) => t.includes(say[style])), style + ": " + say[style]);
    assert.ok(!texts(ART.render(input(year(2025, () => ({ s: null })), { style }))).some((t) => t.includes(say[style])), style + ": not without a snow record");
  }
});

test("Staircase with nothing to compare says the total once; no scale number sits beside the headline", () => {
  const days = year(2025);
  const bare = texts(ART.render(input(days, { style: "r1", ov: null, ovNote: "" })));
  const T = RP.derive(days).total.toFixed(2);
  assert.equal(bare.filter((t) => t.includes(T)).length, 1, "the headline says it, no key row repeats it: " + bare.filter((t) => t.includes(T)).join(" | "));
  assert.ok(!bare.some((t) => / this year$/.test(t)), "no key row");
  assert.ok(bare.some((t) => /Days with rain/.test(t)), "the facts stay, in the foot line");
  const cmp = texts(ART.render(input(days, { style: "r1" })));
  assert.ok(cmp.some((t) => / this year$/.test(t)) && cmp.some((t) => / a usual year$/.test(t)), "with a comparison the key row keys both lines");
  for (const ov of [null, undefined]) {
    const svg = ART.render(input(days, ov === null ? { style: "r1", ov: null, ovNote: "" } : { style: "r1" }));
    const head = /<g data-rp="head"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(svg).slice(1).map(Number);
    // A2 clean: the scale's numbers 13 u at x 184, every gridline with its number, none beside the header; the unit is in the header's figures
    const ticks = [...svg.matchAll(/<text x="184" y="([\d.]+)"[^>]*font-size="13"[^>]*text-anchor="end"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ y: +m[1] - 4.5, s: m[2] }));
    assert.ok(ticks.length >= 2, "the scale has numbers");
    for (const t of ticks) if (t.s !== "0") assert.ok(!(t.y >= head[1] - 8 && t.y <= head[1] + head[3] + 8), "no number beside the headline box: " + t.s);
    const grid = [...svg.matchAll(/<line x1="196" y1="([\d.]+)" x2="1590" y2="[\d.]+" stroke="#EEF0F2" stroke-width="0.7"\/>/g)].map((m) => +m[1]);
    assert.ok(grid.length >= 1 && grid.every((gy) => ticks.some((t) => Math.abs(t.y - gy) < 0.01)), "no gridline without its number");
  }
});

test("the verdict: about usual within 3%, nothing on a usual year under an inch, past double in times", () => {
  const days = year(2025, (i) => (i === 10 ? { p: "1.03" } : { p: "0.00" }));
  const ov = (total) => ({ daily: days.map((x, i) => (i === 0 ? total : 0)), total });
  const v = (d, o) => ART.model(input(d, { ov: o })).verdict;
  assert.equal(v(days, ov(1)), "About a usual year", "103%");
  const d97 = year(2025, (i) => (i === 10 ? { p: "0.97" } : { p: "0.00" }));
  assert.equal(v(d97, ov(1)), "About a usual year", "97%");
  const d104 = year(2025, (i) => (i === 10 ? { p: "1.04" } : { p: "0.00" }));
  assert.equal(v(d104, ov(1)), "4% more than a usual year");
  assert.equal(v(days, ov(0.8)), null, "a usual year of 0.8 in gives no verdict");
  const d231 = year(2025, (i) => (i === 10 ? { p: "2.31" } : { p: "0.00" }));
  assert.equal(v(d231, ov(1)), "2.3 times a usual year", "231% of usual, not \"131% more\"");
  const d300 = year(2025, (i) => (i === 10 ? { p: "3.00" } : { p: "0.00" }));
  assert.equal(v(d300, ov(1)), "3.0 times a usual year");
  const dbl = year(2025, (i) => (i === 10 ? { p: "2.00" } : { p: "0.00" }));
  assert.equal(v(dbl, ov(1)), "100% more than a usual year");
  // the usual year's number counts only the days the station sent: the key says so
  const gappy = year(2025, (i) => (i >= 10 && i < 20 ? { p: "M" } : {}));
  // A2 clean: the usual figure and its words are one line of the key row ("37.73 in a usual year")
  const keyU = (d) => texts(ART.render(input(d, { style: "r1" }))).filter((t) => /^[\d.]+ in a usual year/.test(t));
  assert.deepEqual(keyU(gappy).map((t) => t.replace(/^[\d.]+ in /, "")), ["a usual year, same days"]);
  assert.deepEqual(keyU(year(2025)).map((t) => t.replace(/^[\d.]+ in /, "")), ["a usual year"]);
  const onlyS = year(2025, (i) => (i === 30 ? { p: "S" } : i === 31 ? { p: "0.50A" } : {}));
  assert.deepEqual(keyU(onlyS).map((t) => t.replace(/^[\d.]+ in /, "")), ["a usual year"], "an S day's normal is kept, so it is the whole year");
});

test("Roots: a snow record's label sits up in the snow; marker lines keep clear of the month words", () => {
  const days = year(2025, (i) => (i === 320 ? { p: "1.70", s: 17 } : i % 9 === 0 ? { p: (0.1 + (i % 7) * 0.12).toFixed(2) } : { p: "0.00" }));
  const recs = [{ date: "2025-11-17", label: "Biggest snow: 17.0 in", kind: "bigSnow" }];
  const markers = [{ doy: 131, label: "Planted" }, { doy: 139, label: "Sidedress" }, { doy: 292, label: "Harvest done" }];
  const svg = ART.render(input(days, { style: "r2", records: recs, markers, showNormals: true }));
  const rec = /<g data-rp="rec:0">.*?<text x="[\d.]+" y="([\d.]+)"[^>]*>Biggest snow: 17\.0 in(?:<tspan[^>]*fill="#5E6475"> Nov 17<\/tspan><\/text>|<\/text><text [^>]*fill="#5E6475"[^>]*>Nov 17<\/text>)/.exec(svg);
  assert.ok(rec, "the snow record is drawn, with its date in gray after it or (beside a tall pile) under it");
  assert.ok(+rec[1] < 478, "above the ground line (478): " + rec[1]);
  // every marker line, against every month word and number (16 u boxes around their baselines)
  const months = [...svg.matchAll(/<g data-rp="months">(.*?)<\/g>/g)][0][1];
  const boxes = [...months.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)</g)].map((m) => {
    const size = +m[3], w = ART.roughW(m[4], { size, w: 500 });
    return { x: +m[1] - w / 2, y: +m[2] - 0.77 * size, w, h: 0.81 * size };
  });
  const lines = [...svg.matchAll(/<g data-rp="mark:\d">(.*?)<\/g>/g)].flatMap((g) => [...g[1].matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="[\d.]+" y2="([\d.]+)"/g)].map((m) => [+m[1], +m[2], +m[3]]));
  assert.ok(lines.length >= 3);
  for (const [x, y1, y2] of lines) for (const b of boxes)
    assert.ok(!(x > b.x - 3 && x < b.x + b.w + 3 && Math.max(y1, y2) > b.y - 3 && Math.min(y1, y2) < b.y + b.h + 3), `a marker line at x ${x} runs within 3 u of month text`);
});

test("the art names its title and its description each once", () => {
  const svg = ART.render(input(year(2025), { idPrefix: "q" }));
  assert.match(svg, /aria-labelledby="qT" aria-describedby="qD"/);
});

test("no snowfall record: no snow drawn, and the totals say precipitation", () => {
  const days = year(2025, () => ({ s: null }));
  for (const style of ["r1", "r2"]) {
    const svg = ART.render(input(days, { style })), t = texts(svg).join(" | ");
    assert.ok(!/SNOWFALL|snow, in|Snow:/.test(t), style + " draws no snow");
    assert.ok(/precipitation|PRECIPITATION|your year/.test(t), style);
  }
});

test("remarkable days: a whole-year record is a line of text, the rest are labeled points, none dropped silently", () => {
  const recs = [
    { date: "2025-01-01", span: { from: "2025-01-01", to: "2025-12-31" }, label: "Wettest year since 1993", kind: "wetYear" },
    { date: "2025-06-01", span: { from: "2025-06-01", to: "2025-06-30" }, label: "Wettest June of 76 full years: 4.75 in", kind: "wetMonth" },
    { date: "2025-12-28", label: "Coldest day: -15°F", kind: "coldest" },
    { date: "2025-07-10", label: "Hottest day: 97°F", kind: "hottest" },
    { date: "2025-04-24", label: "Last frost: 25°F", kind: "lastFrost" },
    { date: "2025-10-07", label: "First frost: 31°F", kind: "firstFrost" },
  ];
  const E = ART.model(input(year(2025)));
  const rp = ART.recordPoints(E, recs);
  assert.deepEqual(plain(rp.lines), ["Wettest year since 1993"]);
  assert.equal(rp.pts.length, 5);
  assert.equal(rp.pts.find((p) => p.span).i, 166, "a month marks its middle day (Jun 1 to 30: days 151 to 180)");
  for (const style of ["r1", "r2"]) {
    const svg = ART.render(input(year(2025), { style, records: recs })), t = texts(svg), skipped = ART.lastSkipped();
    for (const r of recs) assert.ok(t.some((x) => x.includes(r.label)) || skipped.includes(r.label), style + ": " + r.label + " drawn or reported");
    assert.ok(t.some((x) => x.includes("Wettest year since 1993")), style + ": the year record is printed");
    assert.ok(skipped.length <= 1, style + " places nearly all of them: skipped " + skipped.join("; "));
  }
});

test("remarkable days from the records layer itself (fixture station history) draw in both styles", () => {
  const rows = [];
  for (let y = 1950; y <= 2025; y++) {
    const n = (y % 4 === 0 && y % 100 !== 0) ? 366 : 365;
    for (let i = 0; i < n; i++) {
      const d = new Date(Date.UTC(y, 0, 1) + i * DAY).toISOString().slice(0, 10);
      const p = i % 9 === 0 ? (0.1 + (i % 7) * 0.12) * (y === 2025 ? 1.6 : 1) : 0;
      rows.push([d, p.toFixed(2), (40 + 30 * Math.sin((i - 100) / 58)).toFixed(1)]);
    }
  }
  const daily = { data: rows.filter((r) => r[0].startsWith("2025")).map((r) => [r[0], r[1], r[2], "0.0", (+r[2] + 9).toFixed(0), (+r[2] - 9).toFixed(0)]) };
  const found = REC.find({ year: 2025, sid: "X", daily, por: { data: rows } }, {});
  assert.ok(found.length >= 3, "the fixture gives several: " + found.map((f) => f.label).join("; "));
  const days = daily.data.map((r, i) => { const p = RP.parsePcpn(r[1]), dt = new Date(r[0] + "T00:00:00Z"); return { date: r[0], v: p.v, flag: p.flag, t: null, s: 0, m: dt.getUTCMonth(), d: dt.getUTCDate(), doy: i }; });
  for (const style of ["r1", "r2"]) {
    // the words, read without the gray dates (a tie note sits after the date)
    const svg = ART.render(input(days, { style, records: found })), t = texts(svg.replace(/<tspan[^>]*>[^<]*<\/tspan>/g, "")).join(" | ");
    for (const f of found) assert.ok(t.includes(f.label) || ART.lastSkipped().includes(f.label), style + ": " + f.label);
  }
});

test("hard years still draw cleanly: dry, wet, many gaps, no name, a long place and a long dedication", () => {
  const cases = {
    dry: year(2025, (i) => ({ p: i % 23 === 0 ? "0.05" : "0.00" })),
    wet: year(2025, (i) => ({ p: i % 3 === 0 ? (0.4 + (i % 5) * 0.5).toFixed(2) : "0.00", s: i < 40 && i % 6 === 0 ? 9 : 0 })),
    gaps: year(2025, (i) => (i % 13 === 0 ? { p: "M" } : {})),
    empty: year(2025, () => ({ p: "0.00" })),
    leap: year(2024),
  };
  for (const [name, days] of Object.entries(cases)) for (const style of ["r1", "r2"]) for (const showNormals of [false, true]) {
    const svg = ART.render(input(days, { style, showNormals, name: name === "gaps" ? "" : "Prairie View Seed and Gr", place: "Saint Francisville Township, West Virginia",
      dedication: "For Grandpa Erling, sixty harvests and c", markers: [{ doy: 120, label: "Planted" }, { doy: 125, label: "Wedding" }, { doy: 300, label: "Harvest done" }] }));
    assert.ok(!/NaN|undefined|Infinity/.test(svg), `${name} ${style} ${showNormals}`);
    assert.ok(texts(svg).includes("Saint Francisville Township, West Virginia") || svg.includes("Saint Francisville Township, West Virginia"), `${name} ${style}: the long place is printed whole`);
  }
});

test("a preview of this year lays out the whole calendar and says so across the art", () => {
  const days = year(2026).slice(0, 283);
  for (const style of ["r1", "r2"]) {
    const t = texts(ART.render(input(days, { style, axisLen: 365, preview: { last: "2026-10-10" } })));
    assert.ok(t.includes("PREVIEW THROUGH OCT 10"), style);
    assert.ok(t.includes("NOV") && t.includes("DEC"), style + ": the months to come keep their place");
    assert.ok(t.some((x) => / so far$/.test(x) || /SO FAR/.test(x)), style + ": the totals say so far");
  }
});

// ---------- the page ----------
test("the page offers the two styles, the dedication and both switches, and loads the art before the engine", () => {
  const html = readFileSync(ROOT + "rain-print.html", "utf8");
  assert.match(html, /name="rp-style" value="r1" checked><span>Staircase</);
  assert.match(html, /name="rp-style" value="r2"><span>Roots</);
  assert.ok(html.indexOf('name="rp-style"') < html.indexOf('id="rp-status"'), "the style picker sits with the first controls");
  assert.match(html, new RegExp(`id="rp-ded" type="text" maxlength="${RP.LIMITS.dedication}"`));
  assert.match(html, /id="rp-normals"[^>]*><span>Show the 30-year normals</);
  assert.match(html, /id="rp-records"[^>]*><span>Show remarkable days</);
  assert.ok(!/name="rp-layout"|name="rp-pal"/.test(html), "the old layout and color pickers are gone");
  const i = (s) => html.indexOf(s);
  assert.ok(i("/components/rp-short.js") > 0 && i("/components/rain-print-art.js") > 0);
  assert.ok(i("/components/rp-short.js") < i("/components/rain-print.js?v=") && i("/components/rain-print-art.js") < i("/components/rain-print.js?v="));
  assert.match(html, /\/components\/rain-print\.js\?v=47"/);
  for (const f of ["rp-fraunces-opsz.woff2", "rp-fraunces-opsz-400i.woff2", "rp-plex-sans-var.woff2", "rp-plex-sans-400i.woff2"]) {
    assert.ok(html.includes("/fonts/" + f), "the page declares " + f);
    assert.ok(readFileSync(ROOT + "components/rain-print.js", "utf8").includes("/fonts/" + f), "and the export inlines " + f);
    assert.ok(readFileSync(ROOT + "fonts/" + f).length > 10000);
  }
  assert.equal(JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8")).promote, true, "launched 2026-10-13: the promo is on");
});

// ---------- panel 3 (2026-10-14) ----------
test("D2: a month of unrecorded precipitation doesn't wipe out a whole snow record: snow stays above the line", () => {
  // 30 days of June with no report at all (pcpn and snow M), a whole winter of snow on record
  const days = year(2025, (i) => (i >= 152 && i < 182 ? { p: "M", s: null } : i < 60 && i % 6 === 0 ? { p: "0.30", s: 3 } : i === 120 ? { p: "1.20" } : {}));
  const E = ART.model(input(days));
  assert.equal(E.snowState, "full", "the gap days are gaps, not missing snow");
  assert.ok(RP.derive(days).snow > 0, "the page's Snowfall stat keeps the record too");
  const svg = ART.render(input(days, { style: "r2" }));
  assert.equal((/<g fill="#AFCBE2"[^>]*>(.*?)<\/g>/.exec(svg)[1].match(/<rect/g) || []).length, 10, "every snow day is a pile above the ground");
  assert.ok(texts(svg).includes("rain, in"), "the lower scale reads rain, not precipitation");
});

test("D7: QR rows share exact edges, so no pale seam runs through the mark", () => {
  for (const style of ["r1", "r2"]) {
    const svg = ART.render(input(year(2025), { style }));
    const d = /<g data-rp="qr"><g aria-hidden="true"><rect[^>]*\/><path d="([^"]+)"/.exec(svg)[1];
    const rows = [...d.matchAll(/M[\d.]+,([\d.]+)H[\d.]+V([\d.]+)H/g)].map((m) => [+m[1], +m[2]]);
    assert.ok(rows.length > 20, style + ": absolute runs");
    const tops = new Set(rows.map((r) => r[0])), bottoms = new Set(rows.map((r) => r[1]));
    for (const b of bottoms) assert.ok(tops.has(b) || b === Math.max(...bottoms), style + ": a row's bottom is the next row's top exactly: " + b);
  }
});

// ---------- panel 4 (2026-10-14): the print as wall art ----------
// every <text>, with its size, family and the group it is drawn in
const sized = (svg) => [...svg.matchAll(/<g data-rp="([^"]+)">((?:(?!<g data-rp=).)*)/g)].flatMap((g) =>
  [...g[2].matchAll(/<text[^>]*font-family="([^"]*)"[^>]*font-size="([\d.]+)"[^>]*>((?:[^<]|<\/?tspan[^>]*>)*)<\/text>/g)].map((m) => ({ rp: g[1], fam: m[1], size: +m[2], s: m[3].replace(/<\/?tspan[^>]*>/g, "") })));

test("the buyer's name is the biggest words on the sheet, in the serif, in both styles, long or short", () => {
  const days = year(2025, (i) => (i < 60 && i % 5 === 0 ? { p: "0.40", s: 5 } : {}));
  for (const style of ["r1", "r2"]) for (const name of ["Lund", "The Olson Farm", "Prairie View Seed and Gr", "WWWWWWWWWWWWWWWWWWWWWWWW"]) for (const logo of [false, true]) {
    const I = input(days, { style, name, dedication: "For Dad", logo: logo ? { href: "data:image/png;base64,iVBORw0KGgo=", w: 600, h: 300 } : null });
    const t = sized(ART.render(I)), nm = t.find((x) => x.s === name);
    assert.ok(nm, style + ": the name is printed as typed: " + name);
    assert.match(nm.fam, /Fraunces/, style + ": in the serif");
    // Staircase A2 clean (Sig, 2026-10-17): the year as large as the name, everything else smaller
    const yr = style === "r1" ? t.find((x) => x.s === "2025" && x.rp === "title") : null;
    if (yr) assert.equal(yr.size, nm.size, style + ": the year as large as the name");
    for (const x of t) if (x !== nm && x !== yr) assert.ok(x.size < nm.size, `${style} ${name}${logo ? " +logo" : ""}: "${x.s}" (${x.size}) is smaller than the name (${nm.size})`);
    if (name === "Lund") assert.equal(nm.size, style === "r1" ? 64 : 78, style + ": a short name at " + (style === "r1" ? 64 : 78) + " u");
  }
  // with no name, Staircase's year is the headline, still the biggest words, the place under it
  const bare = sized(ART.render(input(year(2025), { style: "r1", name: "" })));
  const by = bare.find((x) => x.s === "2025" && x.rp === "title");
  assert.equal(by.size, 64);
  for (const x of bare) if (x !== by) assert.ok(x.size < by.size, "with no name the year is the biggest: " + x.s);
  assert.equal(bare.find((x) => x.s === "Chetek, Wisconsin").size, 22);
});

test("Staircase: what a usual year is goes to the foot line, the header keeps the facts; months in ink at 17 u under the axis", () => {
  const svg = ART.render(input(year(2025), { style: "r1" })), t = sized(svg);
  const note = t.find((x) => x.s.includes("A usual year: NOAA’s 30-year normal"));
  assert.equal(note.rp, "foot");
  assert.ok(!t.some((x) => x.rp === "head" && /NOAA/.test(x.s)), "not in the header");
  // A2 clean (Sig, 2026-10-17): month names 11 u tracked gray, totals 14 u tabular in ink
  const jan = /<text x="[\d.]+" y="([\d.]+)"[^>]*font-size="11" fill="#8A8F98"[^>]*letter-spacing[^>]*>JAN<\/text>/.exec(svg);
  assert.ok(jan, "JAN at 11 u, tracked, gray");
  assert.ok(+jan[1] - 716 <= 30, "tucked under the axis: " + jan[1]);
  assert.match(svg, /font-size="14" fill="#1F2328"[^>]*style="font-variant-numeric:tabular-nums lining-nums"/, "month totals 14 u tabular in ink");
  assert.match(svg, /stroke="#2B5C8A" stroke-width="4.6" stroke-linejoin="round"/, "the staircase at 4.6 u");
  assert.match(svg, /stroke="#5E6475" stroke-width="1.5" stroke-dasharray="6 5"/, "the usual line at 1.5 u");
});

test("Staircase: no gridline stub to the left of the header box", () => {
  const svg = ART.render(input(year(2025), { style: "r1" }));
  const head = /<g data-rp="head"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(svg).slice(1).map(Number);
  const grid = [...svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="[\d.]+" y2="[\d.]+" stroke="#EEF0F2"/g)].map((m) => [+m[1], +m[2]]);
  assert.ok(grid.length >= 2);
  for (const [x1, y1] of grid) if (y1 >= head[1] && y1 <= head[1] + head[3]) assert.ok(x1 >= head[0] + head[2] - 0.01, "a gridline at the header's height starts at its right edge: " + x1);
});

test("the reader's dates read clearly: Staircase on the line beside the dot, Roots upright in ink; both at 20 u or more", () => {
  const markers = [{ doy: 131, label: "Planted" }, { doy: 200, label: "Wedding" }];
  for (const style of ["r1", "r2"]) {
    const svg = ART.render(input(year(2025), { style, markers }));
    for (const l of ["Planted", "Wedding"]) {
      const m = new RegExp('<g data-rp="mark:\\d">.*?<text x="[\\d.]+" y="([\\d.]+)"[^>]*font-weight="(\\d+)" font-style="(\\w+)" font-size="([\\d.]+)" fill="([^"]+)"[^>]*>' + l + "<tspan[^>]*>[^<]*</tspan></text>").exec(svg);
      assert.ok(m, style + ": " + l);
      // Staircase A2 clean (Sig, 2026-10-17): a marked day is 15 u Medium in ink, the one dark voice on the chart
      assert.equal(m[3], "normal", style + ": upright"); assert.equal(m[5], style === "r1" ? "#1F2328" : "#1E2125", style + ": in ink");
      if (style === "r1") { assert.equal(+m[4], 15, "r1: 15 u"); assert.equal(m[2], "500", "r1: Medium"); } else assert.ok(+m[4] >= 20, style + ": " + m[4] + " u");
      if (style === "r1") assert.ok(+m[1] < 716, "r1: on the chart, above the axis: " + m[1]);
    }
  }
});

test("a station that doesn't report snowfall says so at the foot, in both styles; one with a snow record doesn't", () => {
  const none = year(2025, () => ({ s: null }));
  for (const style of ["r1", "r2"]) {
    const t = sized(ART.render(input(none, { style })));
    const note = t.find((x) => x.s.includes("This station doesn’t report snowfall; melted snow is counted in the total"));
    assert.ok(note && note.rp === "foot", style + ": in the foot line");
    assert.ok(note.size >= 11, style + ": at 11 u or more");
    for (const days of [year(2025), year(2025, (i) => (i < 60 && i % 5 === 0 ? { p: "0.40", s: 5 } : {}))])
      assert.ok(!texts(ART.render(input(days, { style }))).some((x) => /report snowfall|snowfall record/.test(x)), style + ": not with a snow record");
  }
  // a record with holes (more than 10 days) is named for what it is
  const holes = year(2025, (i) => (i < 20 ? { s: null } : {}));
  assert.equal(ART.model(input(holes)).snowState, "unknown");
  assert.ok(texts(ART.render(input(holes, { style: "r2" }))).some((x) => x.includes("This station’s snowfall record has holes, so no snow is drawn")));
});

test("Roots: the rain and snow scales fit the year, bars 0.85 of a day, one foot line", () => {
  // a dry year: biggest rain 0.80 in, biggest snow 1.5 in
  const days = year(2025, (i) => (i === 100 ? { p: "0.80" } : i === 20 ? { p: "0.15", s: 1.5 } : i % 9 === 0 ? { p: "0.10" } : { p: "0.00" }));
  const svg = ART.render(input(days, { style: "r2" }));
  const ticks = [...svg.matchAll(/<text x="191" y="([\d.]+)"[^>]*fill="([^"]+)"[^>]*>([\d.]+)<\/text>/g)].map((m) => ({ y: +m[1], fill: m[2], s: m[3] }));
  const rain = ticks.filter((t) => t.y > 478).map((t) => t.s), snow = ticks.filter((t) => t.y < 478).map((t) => t.s);
  assert.deepEqual(rain, ["0.5"], "no 1 in or 2 in tick under a 0.80 in year: " + rain);
  assert.deepEqual(snow, ["1", "2"], "the snow scale from the year's own snow: " + snow);
  const red = /<rect x="[\d.]+" y="479.5" width="3.8" height="([\d.]+)" fill="#A8321E"/.exec(svg);
  assert.ok(Math.abs(479.5 + +red[1] - 994) < 0.5, "the deepest bar reaches the foot of the chart");
  const bar = /<g fill="#26313D"><rect x="[\d.]+" y="[\d.]+" width="([\d.]+)"/.exec(svg);
  assert.ok(Math.abs(+bar[1] - 0.85 * 1485 / 365) < 0.02, "bars 0.85 of a day: " + bar[1]);
  const t = sized(svg);
  assert.ok(!t.some((x) => /separate scales/.test(x.s)), "no 'separate scales' line");
  const foot = t.filter((x) => x.rp === "foot");
  assert.equal(foot.length, 1, "one foot line: " + foot.map((x) => x.s).join(" | "));
  assert.ok(foot[0].s.includes("Days with rain or snow") && foot[0].s.includes("A usual year"), "it carries the days and what usual means");
});

// ---------- panel 5 (2026-10-15): the day itself after the words, small and gray ("Planted May 21") ----------
const markText = (svg, k) => { const m = new RegExp('<g data-rp="mark:' + k + '">.*?(<text[^>]*>(?:[^<]|</?tspan[^>]*>)*</text>)').exec(svg); return m && m[1]; };
test("a marked day prints its date after its words: same line, 3-letter month, gray, normal weight, 17 u Staircase / 16 u Roots", () => {
  const markers = [{ doy: 140, label: "Planted corn" }, { doy: 4, label: "Wedding" }, { doy: 280, label: "First frost" }];
  // Staircase A2 clean: the date 15 u gray (#8A8F98) after 15 u words; Roots 16 u in #5E6475
  for (const [style, size] of [["r1", 15], ["r2", 16]]) {
    const svg = ART.render(input(year(2025), { style, markers })), gray = style === "r1" ? "#8A8F98" : "#5E6475";
    const want = { "Planted corn": "May 21", Wedding: "Jan 5", "First frost": "Oct 8" }, sizes = new Set();
    for (let k = 0; k < 3; k++) {
      const t = markText(svg, k);
      assert.ok(t, style + ": mark " + k);
      const words = /^<text[^>]*>([^<]*)<tspan/.exec(t), tsp = /<tspan font-size="([\d.]+)" font-weight="(\d+)" fill="([^"]+)">([^<]*)<\/tspan><\/text>$/.exec(t);
      assert.ok(words && tsp, style + ": the date is a tspan in the label's own text (one baseline): " + t);
      assert.equal(tsp[4], " " + want[words[1]], style + ": " + words[1]);
      // Staircase's row under the months (19 u words, when the line has no clean spot) takes 16 u too
      const own = +/font-size="([\d.]+)"/.exec(t)[1];
      assert.equal(+tsp[1], own === 19 ? 16 : size, style + ": date size after " + own + " u words"); assert.equal(tsp[2], "400"); assert.equal(tsp[3], gray);
      if (own !== 19) sizes.add(+tsp[1]);
    }
    assert.ok(sizes.has(size), style + ": at least one on the chart at " + size + " u");
  }
});
test("a marked day with no words prints only its date, once", () => {
  for (const style of ["r1", "r2"]) {
    const svg = ART.render(input(year(2025), { style, markers: [{ doy: 140, label: "" }, { doy: 200, label: "Jul 20" }] }));
    const marks = [...svg.matchAll(/<g data-rp="mark:\d">(.*?)<\/g>/g)].map((m) => m[1]).join("");
    assert.ok(marks.includes("Jul 20") && !/<tspan/.test(marks), style + ": no second date");
  }
});
test("the date is counted in the label's width, so the placer keeps it clear", () => {
  const I = input(year(2025), { style: "r2", markers: [{ doy: 140, label: "Planted" }] });
  const E = ART.model(I);
  assert.equal(E.markers[0].label, "Planted\u0001May 21\u0002");
  assert.equal(E.markers[0].words, "Planted"); assert.equal(E.markers[0].date, "May 21");
  // a typed control character can't fake a date
  assert.equal(ART.model(input(year(2025), { markers: [{ doy: 140, label: "A\u0001B\u0002" }] })).markers[0].words, "AB");
});

// ---------- remarkable days carry their dates (Sig, 2026-10-15) ----------
test("a remarkable day prints its date after its words: a day, a stretch's range, none for a whole month or year", () => {
  const E = ART.model(input(year(2025)));
  const one = (r) => ART.recordPoints(E, [r]);
  const txt = (r) => one(r).pts[0].text;
  // one day: one space, the 3-letter month, no leading zero
  assert.equal(txt({ kind: "snowDay", date: "2025-02-03", label: "Biggest snow: 8.0 in" }), "Biggest snow: 8.0 in\u0001Feb 3\u0002");
  assert.equal(ART.plain(txt({ kind: "snowDay", date: "2025-02-03", label: "Biggest snow: 8.0 in" })), "Biggest snow: 8.0 in Feb 3");
  assert.equal(txt({ kind: "firstFrost", date: "2025-10-04", label: "First frost: 28°F" }), "First frost: 28°F\u0001Oct 4\u0002");
  assert.equal(txt({ kind: "lastFrost", date: "2025-04-24", label: "Last frost: 25°F" }), "Last frost: 25°F\u0001Apr 24\u0002");
  assert.equal(txt({ kind: "lastSnow", date: "2025-04-11", label: "Last snow: 1.2 in" }), "Last snow: 1.2 in\u0001Apr 11\u0002");
  assert.equal(txt({ kind: "firstSnow", date: "2025-11-02", label: "First snow: 0.5 in" }), "First snow: 0.5 in\u0001Nov 2\u0002");
  assert.equal(txt({ kind: "hottest", date: "2025-07-10", label: "Hottest day: 98°F" }), "Hottest day: 98°F\u0001Jul 10\u0002");
  assert.equal(txt({ kind: "coldest", date: "2025-12-28", label: "Coldest day: -15°F" }), "Coldest day: -15°F\u0001Dec 28\u0002");
  // a tie keeps its note, after the date of the day drawn
  assert.equal(txt({ kind: "coldest", date: "2025-01-05", label: "Coldest day: -20°F (also Jan 21)", ties: ["2025-01-21"] }), "Coldest day: -20°F\u0001Jan 5\u0002 (also Jan 21)");
  assert.equal(txt({ kind: "hottest", date: "2025-07-03", label: "Hottest day: 97°F (on 3 days)" }), "Hottest day: 97°F\u0001Jul 3\u0002 (on 3 days)");
  // a stretch: its range, in one month or across two
  assert.equal(txt({ kind: "wetWeek", date: "2025-05-03", span: { from: "2025-05-03", to: "2025-05-09" }, label: "Wettest week: 3.10 in" }), "Wettest week: 3.10 in\u0001May 3 to 9\u0002");
  assert.equal(txt({ kind: "wetWeek", date: "2025-04-28", span: { from: "2025-04-28", to: "2025-05-04" }, label: "Wettest week: 3.10 in" }), "Wettest week: 3.10 in\u0001Apr 28 to May 4\u0002");
  assert.equal(txt({ kind: "wetWeek", date: "2025-06-10", span: { from: "2025-06-10", to: "2025-06-10" }, label: "Wettest week: 2.00 in" }), "Wettest week: 2.00 in\u0001Jun 10\u0002", "a week whose rain fell on one day");
  // a whole month (February too) or a whole year is its own date
  for (const [from, to] of [["2025-06-01", "2025-06-30"], ["2025-02-01", "2025-02-28"], ["2025-12-01", "2025-12-31"]]) {
    const r = { kind: "wetMonth", date: from, span: { from, to }, label: "Wettest month of 76 full years: 9.00 in" };
    assert.equal(txt(r), r.label, from + ": no date");
  }
  assert.deepEqual(plain(one({ kind: "wetYear", date: "2025-01-01", span: { from: "2025-01-01", to: "2025-12-31" }, label: "Wettest year since 1993" }).lines), ["Wettest year since 1993"]);
  // words alone stay in .label (what the page names when a day is left off)
  assert.equal(one({ kind: "snowDay", date: "2025-02-03", label: "Biggest snow: 8.0 in" }).pts[0].label, "Biggest snow: 8.0 in");
  // two on one day: one date for a shared amount; different amounts keep each date with its own words when a tie note would split them
  const same = ART.recordPoints(E, [{ date: "2025-11-20", label: "Biggest snow: 8.0 in" }, { date: "2025-11-20", label: "First snow: 8.0 in" }]).pts;
  assert.deepEqual(plain(same.map((p) => p.text)), ["First snow and biggest snow: 8.0 in\u0001Nov 20\u0002"]);
  const both = ART.recordPoints(E, [{ date: "2025-01-05", label: "Coldest day: -20°F (also Jan 21)" }, { date: "2025-01-05", label: "Biggest snow: 9.0 in" }]).pts;
  assert.deepEqual(plain(both.map((p) => p.text)), ["Coldest day: -20°F\u0001Jan 5\u0002 (also Jan 21); biggest snow: 9.0 in\u0001Jan 5\u0002"]);
  const bare = ART.recordPoints(E, [{ date: "2025-01-05", label: "Coldest day: -20°F" }, { date: "2025-01-05", label: "Biggest snow: 9.0 in" }, { date: "2025-01-05", label: "Hottest day: 40°F (on 3 days)" }]).pts;
  assert.deepEqual(plain(bare.map((p) => p.text)), ["Coldest day: -20°F; biggest snow: 9.0 in; hottest day: 40°F\u0001Jan 5\u0002 (on 3 days)"], "the day's date once, at the end, when no tie note comes before it");
  // a typed control character can't fake a date
  assert.equal(txt({ date: "2025-02-03", label: "A\u0001B\u0002" }), "AB\u0001Feb 3\u0002");
});

test("a remarkable day's date and the biggest rain's date print gray, after the words, in both styles", () => {
  const days = year(2025, (i) => (i === 33 ? { p: "0.80", s: 8 } : i === 176 ? { p: "2.24" } : i % 9 === 0 ? { p: "0.10" } : { p: "0.00" }));
  const recs = [{ kind: "snowDay", date: "2025-02-03", label: "Biggest snow: 8.0 in" },
    { kind: "wetWeek", date: "2025-04-28", span: { from: "2025-04-28", to: "2025-05-04" }, label: "Wettest week: 3.10 in" },
    { kind: "firstFrost", date: "2025-10-04", label: "First frost: 28°F" }];
  for (const style of ["r1", "r2"]) {
    const svg = ART.render(input(days, { style, records: recs })), t = texts(svg), skipped = ART.lastSkipped();
    for (const [words, date] of [["Biggest snow: 8.0 in", "Feb 3"], ["Wettest week: 3.10 in", "Apr 28 to May 4"], ["First frost: 28°F", "Oct 4"]]) {
      if (skipped.includes(words)) continue;
      const esc = words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // (Staircase A2 clean: a station fact is a 12 u footnote, its date in #8A8F98)
      const m = new RegExp(">" + esc + '<tspan font-size="([\\d.]+)" font-weight="400" fill="#(?:5E6475|8A8F98)"> ' + date + "</tspan></text>").exec(svg);
      assert.ok(m, style + ": " + words + " then the gray " + date);
      assert.ok(+m[1] >= 11, style + ": the date at production size");
    }
    assert.ok(skipped.length <= 1, style + ": skipped " + skipped.join("; "));
    assert.ok(/>Biggest rain: 2\.24 in<tspan[^>]*font-weight="400" fill="#(?:5E6475|8A8F98)"> Jun 26<\/tspan><\/text>/.test(svg), style + ": the biggest rain's day in the same gray");
    assert.ok(t.some((x) => x.includes("Biggest rain: 2.24 in Jun 26")) && !t.some((x) => x.includes("in, Jun 26")), style + ": no comma");
  }
});
