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
    axisLen: days.length, ov: RP.overlayDaily(days, normalMap(y)), ovNote: "Usual = 30-year normal", showNormals: false, markers: [], records: [],
    qr: { matrix: ctx.AgQR.matrix("HTTPS://AGSIST.COM/R?K7Q2M"), serial: "" } }, extra);
}
const texts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'"));

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
  assert.equal(RP.LIMITS.dedication, 40);
  const code = RP.encodeCode({ ...FULL, dedication: "D".repeat(40), markers: [{ date: "2025-05-12", label: "Planted" }, { date: "2025-10-20", label: "Harvest done" }] });
  assert.ok(code.length <= 200, "code is " + code.length);
});

test("the serial is maker-only: never in the share link, only behind ?maker=1, never on the digital file", () => {
  assert.ok(!/serial/.test(RP.toParams({ ...FULL, serial: "12" })));
  assert.ok(!("serial" in RP.normalize({ ...FULL, serial: "12" })));
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  assert.match(S, /return MAKER && m && \+m\[1\] > 0 \? 'No\. ' \+ String\(\+m\[1\]\)\.padStart\(4, '0'\) \+ ' · SRL'/);
  const draw = S.slice(S.indexOf("function drawCanvas("), S.indexOf("function toBlob("));
  assert.equal((draw.match(/o\.serial = SERIAL/g) || []).length, 1, "one place sets it");
  assert.ok(draw.indexOf("o.serial = SERIAL") > draw.indexOf("kind === 'digital'"), "and it is the print branch, after the digital one");
  const svgExport = S.slice(S.indexOf("if (fmt === 'svg')"), S.indexOf("job = drawCanvas(kind)"));
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
    assert.ok(!/SRL/.test(plainSvg), "no serial unless asked");
    const withSerial = ART.render(input(year(2025), { style, qr: { matrix: ctx.AgQR.matrix("HTTPS://AGSIST.COM/R?K7Q2M"), serial: "No. 0001 · SRL" } }));
    assert.ok(texts(withSerial).includes("No. 0001 · SRL"));
    assert.ok(!/A4A89F/.test(ART.render(input(year(2025), { style, qr: null }))), "no QR when the link would not fit");
  }
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

test("the normals: month normals and the note only with the switch on, unrecorded days left out of both totals", () => {
  const days = year(2025, (i) => (i >= 10 && i < 20 ? { p: "M" } : {}));
  for (const style of ["r1", "r2"]) {
    const off = texts(ART.render(input(days, { style }))), on = texts(ART.render(input(days, { style, showNormals: true })));
    assert.ok(!off.some((t) => /^usual /.test(t)) && !off.some((t) => t.includes("Usual = 30-year normal")), style + ": off shows no normals");
    assert.ok(on.some((t) => /^usual \d/.test(t)), style + ": on shows the month normals");
    assert.ok(on.some((t) => t.includes("Usual = 30-year normal")), style + ": and names them");
  }
  const t = texts(ART.render(input(days, { style: "r1" })));
  assert.ok(t.includes(((days.length - 10) * 0.09).toFixed(2) + " in"), "a usual year counts only the days the station recorded");
  assert.ok(!t.includes((days.length * 0.09).toFixed(2) + " in"));
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
    { date: "2025-12-28", label: "Coldest: -15°F", kind: "coldest" },
    { date: "2025-07-10", label: "Hottest: 97°F", kind: "hottest" },
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
    const svg = ART.render(input(days, { style, records: found })), t = texts(svg).join(" | ");
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
  assert.match(html, /\/components\/rain-print\.js\?v=12"/);
  for (const f of ["rp-fraunces-opsz.woff2", "rp-fraunces-opsz-400i.woff2", "rp-plex-sans-var.woff2", "rp-plex-sans-400i.woff2"]) {
    assert.ok(html.includes("/fonts/" + f), "the page declares " + f);
    assert.ok(readFileSync(ROOT + "components/rain-print.js", "utf8").includes("/fonts/" + f), "and the export inlines " + f);
    assert.ok(readFileSync(ROOT + "fonts/" + f).length > 10000);
  }
  assert.equal(JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8")).promote, false, "the promo stays off");
});
