/* Rain Print, Oct 22, 2026 (Sig): "make sure that the printed year has a space between it and a custom farm
 * name entry."
 *
 * The year was its own <text>, placed at the name's measured width plus the gap (Staircase: name, 26 u, year;
 * Roots: town, 18 u, year, or two spaces with no name). Whenever the font that measured was not the font that
 * drew, the year moved toward the name by the difference: Fraunces is a variable font with an optical-size
 * axis, and at 64 u "Lindquist Family Farm" is 643 u wide as Chromium draws it, 594 u in Georgia (the font
 * measured before Fraunces is in), 694 u without optical sizing and 561 u at the display size. 26 u of space
 * does not survive any of those. Now the year is a <tspan dx> inside the name's own <text>, so the gap is
 * counted from where the name's letters really end, in whatever font draws them.
 *
 * Checks, on the shipped components/rain-print-art.js (in a bare vm):
 *   - the year rides in the name's <text> (Staircase) or the town's (Roots) as a tspan with the gap as dx,
 *     the same size, the same left edge, with the measure true, 15% short or 15% long;
 *   - the sizes are as before (a short name 64 u in Staircase, 78 u in Roots; the year as large as the name).
 * In a real browser (skipped without Playwright), with the fonts loaded, held back, and measured in another
 * font than the one that draws, the gap in the ink is at least the intended space in the preview, the SVG
 * file, the digital PNG and PDF and the 13 x 19 print PDF.
 *
 *   node --test test/rain-print-name-space.test.mjs
 *   RP_SHOTS=dir node --test test/rain-print-name-space.test.mjs   (crops of the title, each case)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { measure as realMeasure } from "./fixtures/rp-label-check.mjs";
import { PW, CHROME, open, drawn, fontsLoaded, printFontIn, previewGap, fileGap, SHEET_SCALE, BTN } from "./fixtures/rp-name-gap.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob, Map, Promise };
ctx.window = ctx;
for (const f of ["components/qr.js", "components/rain-print.js", "components/rain-print-art.js"]) vm.runInNewContext(readFileSync(ROOT + f, "utf8"), ctx);
const RP = ctx.RainPrint, ART = ctx.AgRainArt;

const DAY = 86400000;
function year(y) {
  const days = [];
  for (let i = 0; i < 365; i++) {
    const dt = new Date(Date.UTC(y, 0, 1) + i * DAY), p = RP.parsePcpn(i % 9 === 0 ? (0.1 + (i % 7) * 0.12).toFixed(2) : "0.00");
    days.push({ date: dt.toISOString().slice(0, 10), v: p.v, flag: p.flag, t: null, s: 0, m: dt.getUTCMonth(), d: dt.getUTCDate(), doy: i });
  }
  return days;
}
function input(extra) {
  const days = year(2025), D = RP.derive(days), nm = new Map(days.map((x) => [x.date.slice(5), 0.09]));
  return Object.assign({ style: "r1", year: 2025, place: "Chetek, Wisconsin", name: "", dedication: "", days, D, showDry: RP.showDry(D), axisLen: days.length,
    ov: RP.overlayDaily(days, nm), ovNote: "A usual year: NOAA’s 30-year normal", showNormals: false, markers: [], records: [],
    qr: { matrix: ctx.AgQR.matrix("HTTPS://AGSIST.COM/R?K7Q2M"), serial: "" } }, extra);
}
const NAMES = ["Lindquist Family Farm", "WWWW Farms", "Ole's", "Ole's ", "Lund"];
const MEASURES = { true: realMeasure, short: (s, o) => realMeasure(s, o) * 0.85, long: (s, o) => realMeasure(s, o) * 1.15 };
const titleOf = (svg) => /<g data-rp="title">((?:(?!<g data-rp=).)*)/.exec(svg)[1];
const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const escx = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// the <text> that carries the year, and what it says before it
function yearLine(svg) {
  const m = /<text x="([\d.]+)" y="([\d.]+)"[^>]*font-weight="(\d+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<tspan dx="([\d.]+)" font-weight="(\d+)" font-style="normal" font-size="([\d.]+)"[^>]*>2025<\/tspan><\/text>/.exec(titleOf(svg));
  return m && { x: +m[1], y: +m[2], w: +m[3], size: +m[4], before: unesc(m[5]), dx: +m[6], yw: +m[7], ysize: +m[8] };
}

test("Staircase: the year rides in the name's own line of text, 26 u after its letters, however the words were measured", () => {
  for (const name of NAMES) for (const [mk, measure] of Object.entries(MEASURES)) {
    const svg = ART.render(input({ style: "r1", name, measure })), L = yearLine(svg), why = `${JSON.stringify(name)}, measure ${mk}`;
    assert.ok(L, why + ": the year is a tspan in the name's text");
    assert.equal(L.before, name.trim(), why + ": the name as typed, trimmed");
    assert.equal(L.dx, 26, why);
    assert.equal(L.x, 194, why + ": the name's left edge as before");
    assert.equal(L.y, 905, why);
    assert.equal(L.w, 500, why + ": the name at 500"); assert.equal(L.yw, 400, why + ": the year at 400");
    assert.equal(L.ysize, L.size, why + ": the year as large as the name");
    assert.ok(!/>2025<\/text>/.test(titleOf(svg)), why + ": no year of its own anywhere in the title");
    if (name === "Lund" || name === "Ole's") assert.equal(L.size, 64, why + ": a short name at 64 u");
  }
  // no name: the year alone is the headline, at 64 u, as before
  assert.match(titleOf(ART.render(input({ style: "r1", name: "" }))), /<text x="194" y="905" font-family="[^"]*" font-weight="400" font-style="normal" font-size="64"[^>]*>2025<\/text>/);
});

test("Roots: the year rides in the town's line of text, 18 u after it with a name, two spaces' room without", () => {
  for (const name of NAMES) for (const [mk, measure] of Object.entries(MEASURES)) {
    const svg = ART.render(input({ style: "r2", name, measure })), L = yearLine(svg), why = `${JSON.stringify(name)}, measure ${mk}`;
    assert.ok(L, why + ": the year is a tspan in the town's text");
    assert.equal(L.before, "Chetek, Wisconsin", why);
    assert.equal(L.dx, 18, why);
    assert.equal(L.x, 120, why + ": the town's left edge as before");
    assert.equal(L.w, 400, why); assert.equal(L.yw, 600, why);
    assert.equal(L.ysize, L.size, why + ": the year the town's size");
    assert.ok(titleOf(svg).includes(">" + escx(name.trim()) + "</text>"), why + ": the name on its own line above");
    if (name === "Lund") assert.ok(/font-size="78"[^>]*>Lund<\/text>/.test(titleOf(svg)), "a short name at 78 u");
  }
  for (const [mk, measure] of Object.entries(MEASURES)) {
    const L = yearLine(ART.render(input({ style: "r2", name: "", measure })));
    assert.ok(L, "no name, measure " + mk);
    assert.equal(L.before, "Chetek, Wisconsin");
    assert.equal(L.dx, +(0.46 * L.size).toFixed(2), "two spaces' room, fixed in ems: " + mk);
    assert.equal(L.size, 60, "the town and year headline at 60 u, as before");
  }
});

// ---------------------------------------------------------------- in a browser
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const SHOTS = process.env.RP_SHOTS || null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const CASES = [
  { style: "r1", name: "Lindquist Family Farm" },
  { style: "r1", name: "Ole's " },
  { style: "r2", name: "WWWW Farms" },
  { style: "r2", name: "" },
];
const before = (c) => (c.style === "r1" ? c.name.trim() : "Chetek, Wisconsin");
const link = (base, c) => base + "/rain-print.html?maker=1&serial=0&place=Chetek%2C+WI&year=2025&style=" + c.style + (c.name ? "&name=" + encodeURIComponent(c.name) : "");
// the space the design means: Staircase 26 u, Roots 18 u after the town, two spaces (0.46 em) with no name
const intended = (c, g) => (c.style === "r1" ? 26 : c.name ? 18 : 0.46 * g.hit.size);
function seen(c, g, how) {
  const why = `${c.style} ${JSON.stringify(c.name)}, ${how}, ${g.path}`;
  assert.ok(!g.err, why + ": " + g.err);
  assert.equal(g.hit.a, 1, why + ": the words before the year found once"); assert.equal(g.hit.b, 1, why + ": the year found once");
  // 1 u short of the space for the ink's soft edge; the letters' own side room only adds to it
  assert.ok(g.u >= intended(c, g) - 1, `${why}: ${g.u} u of space between the words and the year, ${intended(c, g).toFixed(1)} u meant`);
}

test("browser: fonts loaded, the space is in the preview, the SVG file, the digital PNG and PDF and the print PDF", { skip, timeout: 600000 }, async () => {
  for (const c of CASES) {
    const o = await open(ROOT);
    try {
      await o.page.goto(link(o.base, c)); await drawn(o.page); await fontsLoaded(o.page); await o.page.waitForTimeout(800);
      const tag = `${c.style}-${c.name.trim().replace(/\W+/g, "-") || "noname"}`;
      seen(c, await previewGap(o.page, before(c), "2025", SHOTS && `${SHOTS}/${tag}-loaded-preview.png`), "fonts loaded");
      for (const k of ["svg", "digitalPng", "digitalPdf", "sheetPdf"]) seen(c, await fileGap(o.page, BTN[k], before(c), "2025", k === "sheetPdf" ? SHEET_SCALE : null), "fonts loaded");
      assert.deepEqual(o.errors, []);
    } finally { await o.close(); }
  }
});

test("browser: the print fonts not in yet, the SVG file made first and the preview drawn before they come, both keep the space", { skip, timeout: 600000 }, async () => {
  for (const c of CASES) {
    for (const first of ["svg", "preview"]) {
      const o = await open(ROOT, { fonts: "late", delayMs: 15000 });
      try {
        await o.page.goto(link(o.base, c)); await drawn(o.page);
        assert.equal(await printFontIn(o.page), false, "the print font is still on its way when the art is drawn");
        if (first === "svg") seen(c, await fileGap(o.page, BTN.svg, before(c), "2025"), "fonts held back");
        else seen(c, await previewGap(o.page, before(c), "2025"), "fonts held back");
      } finally { await o.close(); }
    }
  }
});

test("browser: measured in one font and drawn in another, the space holds in the preview and every file", { skip, timeout: 600000 }, async () => {
  for (const c of CASES) {
    const o = await open(ROOT, { measure: "georgia" });
    try {
      await o.page.goto(link(o.base, c)); await drawn(o.page); await fontsLoaded(o.page);
      // the page draws again once the fonts are in; wait for that draw
      await o.page.waitForTimeout(1500);
      const tag = `${c.style}-${c.name.trim().replace(/\W+/g, "-") || "noname"}`;
      seen(c, await previewGap(o.page, before(c), "2025", SHOTS && `${SHOTS}/${tag}-other-font-preview.png`), "measured in Georgia");
      for (const k of ["svg", "digitalPng", "sheetPdf"]) seen(c, await fileGap(o.page, BTN[k], before(c), "2025", k === "sheetPdf" ? SHEET_SCALE : null), "measured in Georgia");
    } finally { await o.close(); }
  }
});
