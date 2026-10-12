/* Gauge Lab (/gauge-lab): the reader in components/gauge-read.js, the file the
 * page loads, run on strips drawn here with a known water level, plus the log
 * helpers and the guards that keep the page unlisted and on-device.
 *
 * The photos here are drawn in JS so the test needs no fixtures. The bigger,
 * rougher set (JPEG, blur, glare) is scripts/gauge_synth.py + gauge_eval.mjs.
 *
 *   node --test test/gauge-read.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = {}; ctx.window = ctx;
vm.runInNewContext(readFileSync(ROOT + "components/gauge-read.js", "utf8"), ctx);
const G = ctx.GaugeRead;
const spec = JSON.parse(readFileSync(ROOT + "data/gauge-strip.json", "utf8"));

// ---- a tiny renderer: strip inches -> photo pixels through a homography ----
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function stripColor(x, y, o) {
  const s = spec, M = s.markers;
  if (x < 0 || x > s.width || y < s.y_min || y > s.y_max) return [92, 80, 66];
  for (const k of ["tl", "tr", "bl", "br"]) {
    if (o.hide === k) continue;
    const [cx, cy] = M[k];
    if (Math.abs(x - cx) <= M.size / 2 && Math.abs(y - cy) <= M.size / 2)
      return Math.abs(x - cx) <= M.hole / 2 && Math.abs(y - cy) <= M.hole / 2 ? [247, 246, 242] : [12, 12, 12];
  }
  const ti = Math.round(y / s.scale.minor), ty = ti * s.scale.minor;
  if (ti >= 0 && ti <= 100 && Math.abs(y - ty) < 0.008) {
    const len = ti % 10 === 0 ? 0.6 : ti % 5 === 0 ? 0.3 : 0.15;
    if ((x <= s.ticks.left[1] && x >= s.ticks.left[1] - len) || (x >= s.ticks.right[0] && x <= s.ticks.right[0] + len)) return [15, 15, 15];
  }
  const inTube = x > s.tube.x0 + 0.06 && x < s.tube.x1 - 0.06 && y > -0.2;
  let half = s.stripe.width / 2;
  const L = o.level, wide = s.stripe.width * (o.mag || 2.4) / 2, hu = 0.08, hl = 0.12;
  if (L > 0) {
    if (y >= L && y < L + hu) half = s.stripe.width / 2 * (y - L) / hu;
    else if (y < L && y >= L - hl) half = wide * (L - y) / hl;
    else if (y < L - hl) half = wide;
  }
  if (!o.noStripe && Math.abs(x - s.stripe.x) <= half && y > -0.25) return L > 0 && y < L ? [29, 108, 206] : [31, 112, 209];
  let c = [247, 246, 242];
  if (inTube && L > 0 && y < L) c = [227, 236, 240];
  if (inTube && L > 0 && y >= L && y < L + 0.035) c = [175, 176, 172];
  return c;
}

function render({ level = 0.42 * 10, W = 600, H = 800, rot = 0, keystone = 1, mag, seed = 1, hide, noStripe, sideways } = {}) {
  const r = rng(seed), hh = H * 0.86, hw = hh * spec.width / (spec.y_max - spec.y_min);
  const th = rot * Math.PI / 180, cx = W / 2, cy = H / 2;
  let quad = [[-hw / 2 * keystone, -hh / 2], [hw / 2 * keystone, -hh / 2], [-hw / 2, hh / 2], [hw / 2, hh / 2]]
    .map(([x, y]) => [cx + x * Math.cos(th) - y * Math.sin(th), cy + x * Math.sin(th) + y * Math.cos(th)]);
  let w = W, h = H;
  if (sideways) { quad = quad.map(([x, y]) => [H - y, x]); w = H; h = W; }   // a quarter turn
  const src = [[0, spec.y_max], [spec.width, spec.y_max], [0, spec.y_min], [spec.width, spec.y_min]];
  const Hinv = G.homography(quad, src);
  const data = new Uint8ClampedArray(w * h * 4);
  const o = { level, mag, hide, noStripe };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let acc = [0, 0, 0];
    for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const [sx, sy] = G.applyH(Hinv, i + dx, j + dy);
      const c = stripColor(sx, sy, o);
      acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
    }
    const k = (j * w + i) * 4, n = (r() - 0.5) * 16;
    data[k] = acc[0] / 4 + n; data[k + 1] = acc[1] / 4 + n; data[k + 2] = acc[2] / 4 + n; data[k + 3] = 255;
  }
  return { width: w, height: h, data };
}

// ---- reader ----
test("homography maps the four points it was built from", () => {
  const src = [[0, 0], [3, 0], [0, 11], [3, 11]], dst = [[100, 50], [400, 70], [90, 900], [420, 880]];
  const H = G.homography(src, dst);
  src.forEach((p, i) => {
    const q = G.applyH(H, p[0], p[1]);
    assert.ok(Math.abs(q[0] - dst[i][0]) < 1e-6 && Math.abs(q[1] - dst[i][1]) < 1e-6);
  });
});

test("reads known water levels to the hundredth, tilted and keystoned", () => {
  const cases = [[0.07, 0, 1, 1], [0.25, 4, 0.9, 2], [0.42, -3, 1.05, 3], [0.66, 6, 0.85, 4], [0.93, -5, 1, 5], [0.5, 2, 1, 6, 1.4]];
  for (const [rain, rot, ks, seed, mag] of cases) {
    const r = G.read(render({ level: rain * 10, rot, keystone: ks, seed, mag }), spec);
    assert.equal(r.ok, true, `read failed at ${rain}: ${r.message}`);
    assert.ok(Math.abs(r.rain - rain) <= 0.01 + 1e-9, `truth ${rain}, read ${r.rain} (${r.method})`);
  }
});

test("an empty tube reads 0.00 and says so", () => {
  const r = G.read(render({ level: 0, seed: 9 }), spec);
  assert.equal(r.ok, true);
  assert.equal(r.rain, 0);
  assert.equal(r.method, "empty");
});

test("a covered corner mark fails with the plain message, not a number", () => {
  const r = G.read(render({ hide: "bl", seed: 11 }), spec);
  assert.equal(r.ok, false);
  assert.equal(r.code, "markers");
  assert.match(r.message, /^Couldn't find the four corner marks\. Get the whole strip in the photo, straight on, in good light\./);
});

test("a sideways photo is called sideways", () => {
  const r = G.read(render({ sideways: true, seed: 12 }), spec);
  assert.equal(r.ok, false);
  assert.equal(r.code, "sideways");
});

test("no stripe and no water line: says the stripe is missing and keeps the picture for tapping", () => {
  const r = G.read(render({ level: 0, noStripe: true, seed: 13 }), spec);
  assert.equal(r.ok, false);
  assert.equal(r.code, "stripe");
  assert.ok(r.rect && r.rect.width > 0, "rectified image kept so the user can tap the line");
});

test("rounding: tube inches / 10 to the hundredth, never negative", () => {
  assert.equal(G.roundRain(4.2049, spec), 0.42);
  assert.equal(G.roundRain(4.25, spec), 0.43);
  assert.equal(G.roundRain(-0.3, spec), 0);
});

// ---- log helpers ----
const LOG = [
  { id: "a", when: "2026-10-12T07:05", rain: 0.42, src: "photo" },
  { id: "b", when: "2026-10-03T06:50", rain: 1.1, src: "typed" },
  { id: "c", when: "2026-09-28T07:00", rain: 0.05, src: "tap" },
  { id: "d", when: "2026-03-20T07:00", rain: 0.3, src: "typed" },
];

test("month and season totals add in hundredths", () => {
  const t = G.totals(LOG, "2026-10", "2026-04-01");
  assert.equal(t.month, 1.52);
  assert.equal(t.season, 1.57);
  assert.equal(t.count, 4);
});

test("CSV is oldest first with a header", () => {
  const csv = G.toCSV(LOG, "WI-0042");
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0], "date,time,rain_in,source,gauge_id");
  assert.equal(lines[1], "2026-03-20,07:00,0.30,typed,WI-0042");
  assert.equal(lines[4], "2026-10-12,07:05,0.42,photo,WI-0042");
});

test("ICS: one all-day event per reading titled like 0.42 in rain", () => {
  const ics = G.toICS(LOG, "WI-0042", "20261012T120000Z");
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 4);
  assert.match(ics, /DTSTART;VALUE=DATE:20261012\r\nDTEND;VALUE=DATE:20261013\r\nSUMMARY:0\.42 in rain\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260928\r\nDTEND;VALUE=DATE:20260929\r\n/);
  assert.match(ics, /DESCRIPTION:Read at 7:05 AM\. Gauge WI-0042\./);
  assert.ok(!ics.replace(/\r\n/g, "").includes("\n"), "CRLF line ends only");
});

test("CoCoRaHS text has date, time and amount", () => {
  assert.equal(G.cocorahsText(LOG[0]), "Observation date: 10/12/2026\nObservation time: 7:05 AM\nRain and melted snow: 0.42 in");
  assert.equal(G.clock12("00:15"), "12:15 AM");
  assert.equal(G.clock12("12:00"), "12:00 PM");
});

test("gauge id from ?g= is kept only when it is a plain id", () => {
  assert.equal(G.cleanGaugeId("WI-0042"), "WI-0042");
  assert.equal(G.cleanGaugeId(" ab_12 "), "ab_12");
  assert.equal(G.cleanGaugeId("<x>"), "");
  assert.equal(G.cleanGaugeId(null), "");
});

// ---- strip spec and page guards ----
test("strip spec: markers form the rectangle, tiles cover the strip and fit letter paper", () => {
  const M = spec.markers;
  assert.equal(M.tl[1], M.tr[1]); assert.equal(M.bl[1], M.br[1]);
  assert.equal(M.tl[0], M.bl[0]); assert.equal(M.tr[0], M.br[0]);
  assert.equal(spec.ratio, 10);
  assert.equal(spec.scale.full_y / spec.ratio, 1);
  const t = spec.tiles;
  assert.equal(t[0].y0, spec.y_min); assert.equal(t[t.length - 1].y1, spec.y_max);
  for (let i = 1; i < t.length; i++) assert.ok(t[i].y0 < t[i - 1].y1, "tiles overlap");
  for (const x of t) assert.ok(x.y1 - x.y0 <= 7, "tile fits a letter page with room for the instructions");
  assert.ok(t.length * spec.width + 0.5 * (t.length - 1) <= 7.7, "tiles fit side by side inside 0.4 in margins");
  // the tube window stays clear of the markers and the tick columns
  assert.ok(spec.tube.x0 > spec.ticks.left[1] && spec.tube.x1 < spec.ticks.right[0]);
  assert.ok(M.tl[0] + M.size / 2 < spec.tube.x0 && M.tr[0] - M.size / 2 > spec.tube.x1);
});

test("nothing on the page sends a photo or a reading anywhere", () => {
  for (const f of ["components/gauge-read.js", "components/gauge-lab.js"]) {
    const src = readFileSync(ROOT + f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/XMLHttpRequest|sendBeacon|FormData|WebSocket|EventSource|navigator\.share/.test(src), f);
    const fetches = src.match(/fetch\(([^)]*)\)/g) || [];
    for (const call of fetches) assert.match(call, /^fetch\('\/data\/gauge-strip\.json'/, `${f}: ${call}`);
  }
  assert.match(readFileSync(ROOT + "components/gauge-lab.js", "utf8"), /CLOUD VISION FALLBACK: STUB, NOT BUILT/);
});

test("/gauge-lab stays unlisted", () => {
  const html = readFileSync(ROOT + "gauge-lab.html", "utf8");
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  for (const f of ["sitemap.xml", "llms.txt", "data/search-index.json", "components/header.html", "components/footer.html",
    "components/header-fallback.html", "components/footer-fallback.html"]) {
    assert.ok(!readFileSync(ROOT + f, "utf8").includes("gauge-lab"), `${f} mentions gauge-lab`);
  }
});
