/* "Watch your year draw" (components/rain-print-draw.js, 2026-10-20): the
 * print drawing itself day by day, in place and as a video file.
 *
 *   - the schedule: day N at time t, every pause on its own day, 12 to 20 s;
 *   - the ticker: real dates, the print's own running total, nothing invented;
 *   - marked days, remarkable days and the biggest rain show on their dates, never before;
 *   - the last frame IS the print (pixels, against the art drawn the usual way);
 *   - a video file comes out in Chromium (MediaRecorder WebM here; ffprobe reads every frame),
 *     under 8 MB; the H.264 MP4 writer makes a file ffmpeg decodes;
 *   - reduced motion plays four still steps; a browser that cannot record offers the picture;
 *   - share on a phone, save on a computer; Analytics gets the action only;
 *   - hail and wind: our own hail records within the stated radius, wind labeled modeled.
 *
 * The year is made up (test/fixtures/rp-draw-year.mjs): the sandbox cannot reach NOAA.
 * Browser tests need Playwright and Chromium; they are skipped where missing.
 *   node --test test/rain-print-draw.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync, mkdtempSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import * as FX from "./fixtures/rp-draw-year.mjs";

const ROOT = process.env.RP_ROOT || fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
let ffprobe = true;
try { execFileSync("ffprobe", ["-version"], { stdio: "ignore" }); } catch (e) { ffprobe = false; }
const read = (p) => readFileSync(ROOT + p, "utf8");

const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob, Map, Promise, Uint8Array, DataView, Array };
ctx.window = ctx;
for (const f of ["components/qr.js", "components/rain-print.js", "components/rain-print-art.js", "components/rain-print-records.js", "components/rain-print-draw.js"])
  vm.runInNewContext(read(f), ctx);
const RP = ctx.RainPrint, ART = ctx.AgRainArt, DR = ctx.AgRainDraw;

function engineDays(rows) {
  return RP.closeOpenS(rows.map((r, i) => {
    const p = RP.parsePcpn(r[1]), dt = new Date(r[0] + "T00:00:00Z");
    return { date: r[0], v: p.v, flag: p.flag, t: +r[2], s: RP.parsePcpn(r[3]).v, m: dt.getUTCMonth(), d: dt.getUTCDate(), doy: i };
  }));
}
function input(days, extra = {}) {
  const D = RP.derive(days), y = +days[0].date.slice(0, 4);
  return Object.assign({ style: "r1", year: y, place: "Chetek, Wisconsin", name: "Gustum Farm", dedication: "", days, D, showDry: RP.showDry(D),
    axisLen: days.length, ov: null, ovNote: "", showNormals: false, markers: [{ doy: RP.dayIndex(y, y + "-04-01"), label: "Moved in" }], records: [], qr: null }, extra);
}

// ------------------------------------------------------------ the schedule
test("the schedule: day N at time t, every pause on its own day, 12 to 20 seconds", () => {
  for (const evs of [[], [{ i: 90, kind: "mark" }, { i: 198, kind: "wet" }], Array.from({ length: 40 }, (_, k) => ({ i: k * 9, kind: k % 2 ? "rec" : "mark" }))]) {
    const P = DR.plan({ n: 365, events: evs });
    assert.ok(P.total >= 12 && P.total <= 20, "length " + P.total);
    assert.equal(P.dayAt(0), 0); assert.equal(P.dayAt(P.t0), 0);
    assert.equal(P.dayAt(P.t1), 365); assert.equal(P.dayAt(P.total), 365);
    let last = 0;
    for (let t = 0; t <= P.total; t += 0.01) { const d = P.dayAt(t); assert.ok(d >= last - 1e-9, "never runs backward at " + t); last = d; }
    for (const e of evs) {
      const t = P.timeOf(e.i);
      assert.ok(Math.abs(P.dayAt(t + 0.05) - (e.i + 1)) < 1e-9, `holds on day ${e.i} (${e.kind}): d=${P.dayAt(t + 0.05)}`);
      assert.ok(P.dayAt(t - 0.05) < e.i + 1, "not drawn before its time");
    }
  }
  // without pauses the day rate is the gentle ease: half the year at half the drawing time
  const P = DR.plan({ n: 365, events: [] });
  assert.ok(Math.abs(P.dayAt(P.t0 + P.base / 2) - 182.5) < 0.01);
  for (const i of [0, 30, 90, 200, 364]) assert.ok(Math.abs(P.dayAt(P.timeOf(i)) - (i + 1)) < 1e-6, "timeOf is dayAt's inverse at " + i);
  // reduced motion: four still steps
  const R = DR.stepsPlan(365);
  assert.deepEqual([0.1, 1.6, 3.1, 4.6].map(R.dayAt), [91, 183, 274, 365]);
});

test("the ticker: the days' own dates and the print's own running total; a missing day adds nothing", () => {
  const days = engineDays(FX.standInYear(1982));
  days[40].v = null; days[40].flag = "";   // a day with no report
  const I = input(days), svg = ART.render(I), E = ART.model(I), F = ART.facts(I);
  assert.ok(svg.length > 1000);
  const end = DR.ticker(E, E.n, null);
  assert.equal(end.date, "1982-12-31");
  assert.equal(end.totalText, F.totalText, "the last total is the print's");
  assert.equal(DR.ticker(E, 0, null).totalText, "0.00 in");
  let prev = -1;
  for (let d = 0.5; d <= E.n; d += 0.5) {
    const tk = DR.ticker(E, d, null);
    assert.equal(tk.date, days[tk.k].date, "a real date");
    assert.ok(tk.k >= prev); prev = tk.k;
    // the running total is the sum of the recorded days through that date, as the print adds them
    const want = days.slice(0, tk.k + 1).reduce((s, x) => s + (x.v === null || x.flag === "S" ? 0 : x.v), 0);
    assert.ok(Math.abs(tk.total - want) < 1e-6, `total through ${tk.date}`);
  }
  assert.equal(DR.ticker(E, 41, null).words, "no report");
  assert.equal(DR.ticker(E, 41, null).total, DR.ticker(E, 40, null).total, "the gap adds nothing");
  // snow is said as snow, where the station kept snowfall
  const snowDay = days.findIndex((x) => x.s > 0 && x.v > 0);
  assert.match(DR.ticker(E, snowDay + 1, null).words, /^snow \d+\.\d in/);
  assert.equal(DR.ticker(E, snowDay + 1, null).kind, "snow");
  // metric prints tick in mm
  assert.match(DR.ticker(E, E.n, { units: "mm", lang: "en" }).totalText, /^\d+ mm$/);
});

test("pauses come from the print's own model: the marked day, the biggest rain, remarkable days", () => {
  const days = engineDays(FX.standInYear(1982)), I = input(days);
  ART.render(I);
  const E = ART.model(I), ev = DR.events(I, E, {});
  const mark = ev.find((e) => e.kind === "mark");
  assert.equal(mark.i, 90); assert.equal(days[mark.i].date, "1982-04-01");
  assert.equal(mark.text, "Moved in, Apr 1");
  const wet = ev.find((e) => e.kind === "wet");
  assert.equal(days[wet.i].date, "1982-07-18");
  assert.match(wet.text, /^Biggest rain: 2\.86 in, Jul 18$/);
  // a group the art left off pauses nothing
  assert.equal(DR.events(I, E, { groups: ["axis", "data"] }).length, 0);
});

test("each of the art's groups has a layer; anything new waits for the end", () => {
  const L = DR.layerOf;
  assert.equal(L("axis"), "base"); assert.equal(L("data"), "wipe"); assert.equal(L("hist"), "wipe"); assert.equal(L("crop"), "wipe"); assert.equal(L("ribbon"), "wipe");
  assert.equal(L("usual"), "usual"); assert.equal(L("months"), "months");
  for (const k of ["wet", "dry", "mark:0", "mark:4", "rec:2", "frost:1", "temp:0", "temp:1"]) assert.equal(L(k), "pop", k);
  assert.equal(L("tkey"), "base", "the stripes' key is there from the start");
  for (const k of ["head", "totals", "title", "foot", "qr", "ends", "logo", "band", "wm", "later", "something-new"]) assert.equal(L(k), "end", k);
  // and every group the art can draw today is one of those
  const art = read("components/rain-print-art.js");
  const keys = new Set([...art.matchAll(/G0\('([a-z]+)/g)].map((m) => m[1]).concat([...art.matchAll(/data-rp="([a-z]+)"/g)].map((m) => m[1])));
  for (const k of keys) assert.ok(["base", "wipe", "usual", "months", "pop", "end"].includes(L(k)), k);
});

// ------------------------------------------------------------ hail and wind
test("hail: our own records within the stated radius, the reported kind only, never a year we don't cover", () => {
  const days = engineDays(FX.standInYear(2024));
  const lat = 45.3141, lon = -91.651;
  const tile = { e: [[20240921, 125, 453500, -916800, "p"], [20240610, 300, 455000, -916500, "c"], [20240611, 200, 460000, -916500, "p"], [20230719, 175, 453000, -916500, "p"], [20240921, 175, 453000, -916400, "p"]] };
  const h = DR.hailFromNcei([tile], lat, lon, 2024, days);
  assert.equal(h.length, 1, "one day: the county-level row and the one 48 mi off are out");
  assert.equal(h[0].date, "2024-09-21"); assert.equal(h[0].size, 1.75, "the bigger of two that day");
  assert.equal(days[h[0].i].date, "2024-09-21");
  assert.equal(DR.hailWords(h[0]), "Hail reported within 2 mi, 1.75 in");
  const nws = DR.hailFromNws({ ev: [[45.35, -91.68, 1.25, "09-21", "WI"], [45.51, -91.74, 2.0, "07-19", "WI"]] }, lat, lon, 2024, days);
  assert.deepEqual([...nws.map((x) => x.date)], ["2024-09-21"]);
  assert.ok(DR.milesBetween(lat, lon, 45.51, -91.74) > DR.HAIL_MI);
  const gj = { features: [{ properties: { thresh_in: 0.75 }, geometry: { type: "Polygon", coordinates: [[[-92, 45], [-91, 45], [-91, 46], [-92, 46], [-92, 45]]] } },
    { properties: { thresh_in: 1.5 }, geometry: { type: "MultiPolygon", coordinates: [[[[-91.7, 45.2], [-91.6, 45.2], [-91.6, 45.4], [-91.7, 45.4], [-91.7, 45.2]], [[-91.66, 45.3], [-91.64, 45.3], [-91.64, 45.33], [-91.66, 45.33], [-91.66, 45.3]]]] } }] };
  assert.equal(DR.meshAt(gj, lat, lon), 0.75, "inside the 1.5 in swath's hole: only the 0.75 in swath counts");
  assert.equal(DR.meshAt(gj, 45.25, -91.68), 1.5);
  assert.equal(DR.meshAt(gj, 47, -91.68), 0);
  assert.match(DR.hailWords({ kind: "radar", size: 1 }), /^Radar-estimated hail up to 1\.00 in$/);
  const idx = { ncei: JSON.parse(read("data/hail/ncei/index.json")), manifest: JSON.parse(read("data/hail/manifest.json")) };
  assert.deepEqual([...DR.hailCover(1982, idx)], ["ncei"]);
  assert.equal(DR.hailCover(2021, idx), null, "2021 sits between our two records: no hail claimed");
  assert.equal(DR.hailCover(1950, idx), null);
  assert.deepEqual([...DR.hailCover(2024, idx)], ["nws"]);
});

test("wind is the modeled gust, aligned to the print's days, labeled modeled", () => {
  const days = engineDays(FX.standInYear(1982));
  const j = FX.windAnswer(new URL(DR.windUrl(45.3141, -91.651, 1982, "1982-12-31")));
  const w = DR.windFrom(j, days);
  assert.equal(w.gust.length, days.length);
  assert.equal(w.top.date, "1982-06-29");
  assert.match(w.src, /modeled/);
  assert.match(DR.windWords(w.top), /^Windiest day: gusts \d+ mph, Jun 29 \(modeled\)$/);
  assert.equal(DR.windFrom({}, days), null);
  const u = new URL(DR.windUrl(45.3141, -91.651, 1982, "1982-12-31"));
  assert.equal(u.host, "archive-api.open-meteo.com");
  assert.equal(u.searchParams.get("wind_speed_unit"), "mph");
});

// ------------------------------------------------------------ files
test("the MP4 writer: H.264 chunks in, a file ffmpeg reads every frame of", { skip: ffprobe ? false : "ffmpeg not here" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "rpd-")), h264 = join(dir, "t.h264"), out = join(dir, "t.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=1080x1080:rate=30", "-frames:v", "75", "-c:v", "libx264", "-bf", "0", "-g", "60", "-pix_fmt", "yuv420p", "-x264-params", "aud=1", "-f", "h264", h264]);
  const b = readFileSync(h264), nals = [];
  let i = 0, start = -1;
  while (i < b.length - 3) {
    if (b[i] === 0 && b[i + 1] === 0 && (b[i + 2] === 1 || (b[i + 2] === 0 && b[i + 3] === 1))) { const L = b[i + 2] === 1 ? 3 : 4; if (start >= 0) nals.push(b.subarray(start, i)); start = i + L; i += L; }
    else i++;
  }
  nals.push(b.subarray(start));
  let sps, pps, cur = null; const aus = [];
  for (let n of nals) {
    let e = n.length; while (e > 0 && n[e - 1] === 0) e--; n = n.subarray(0, e);
    const t = n[0] & 31;
    if (t === 9) { if (cur) aus.push(cur); cur = { parts: [], key: false }; } else if (t === 7) sps = n; else if (t === 8) pps = n; else if (t !== 6) { cur.parts.push(n); if (t === 5) cur.key = true; }
  }
  aus.push(cur);
  const avcC = Buffer.concat([Buffer.from([1, sps[1], sps[2], sps[3], 0xFF, 0xE1, sps.length >> 8, sps.length & 255]), sps, Buffer.from([1, pps.length >> 8, pps.length & 255]), pps]);
  const samples = aus.map((a) => ({ key: a.key, data: new Uint8Array(Buffer.concat(a.parts.flatMap((p) => [Buffer.from([p.length >>> 24, (p.length >> 16) & 255, (p.length >> 8) & 255, p.length & 255]), p]))) }));
  writeFileSync(out, DR.mp4Mux({ width: 1080, height: 1080, fps: 30, description: new Uint8Array(avcC), samples }));
  const info = execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_name,width,height,nb_read_frames:format=duration", "-of", "json", out]).toString();
  const j = JSON.parse(info);
  assert.equal(j.streams[0].codec_name, "h264"); assert.equal(+j.streams[0].nb_read_frames, 75); assert.equal(+j.streams[0].width, 1080);
  assert.ok(Math.abs(+j.format.duration - 2.5) < 0.05, "2.5 s at 30 a second");
  assert.equal(execFileSync("ffmpeg", ["-v", "error", "-i", out, "-f", "null", "-"]).toString(), "", "decodes clean");
  // moov before mdat, so a phone can start it before it has the whole file
  const m = readFileSync(out);
  assert.ok(m.indexOf("moov") < m.indexOf("mdat"));
});

test("the recorder's type: H.264 MP4 first, never Chromium's VP9-in-MP4 ahead of WebM", () => {
  assert.equal(DR.pickMime((m) => m === "video/mp4" || /webm/.test(m)), "video/webm;codecs=vp9");
  assert.equal(DR.pickMime((m) => /avc1/.test(m) || /webm/.test(m)), "video/mp4;codecs=avc1.42E01F");
  assert.equal(DR.pickMime((m) => m === "video/mp4"), "video/mp4", "an older Safari: its MP4 is H.264");
  assert.equal(DR.pickMime(() => false), "");
  assert.equal(DR.fileName({ place: "Chetek, Wisconsin", year: 1982, style: "r1" }, "mp4"), "rain-print-chetek-wisconsin-1982-r1.mp4");
  for (const k of ["square", "tall"]) assert.ok(DR.FORMATS[k].bps * DR.T.max / 8 < 8 * 1048576, k + ": the longest video at its bitrate stays under 8 MB");
});

test("weight, copy and the rules: small, lazy on county pages, no sponsor, no em dashes", () => {
  const js = read("components/rain-print-draw.js");
  assert.ok(js.length < 75000, "rain-print-draw.js is " + js.length + " bytes");
  const strings = [...js.matchAll(/'([^'\n]{12,})'/g)].map((m) => m[1]).join("\n");
  assert.ok(!/—/.test(strings), "no em dashes in the words");
  assert.ok(!/sponsor/i.test(js), "no sponsor on Rain Print");
  assert.match(js, /agsist\.com\/rain-print/);
  const county = read("rain/wisconsin/barron-county.html");
  assert.ok(!/rain-print-draw/.test(county), "county pages carry no copy of the player; it loads on a tap");
  assert.match(read("components/rain-county-print.js"), /DRAW = '\/components\/rain-print-draw\.js\?v=2'/);
  assert.match(read("rain-print.html"), /<script src="\/components\/rain-print-draw\.js\?v=2" defer><\/script>/);
  assert.match(read("components/rain-print.js"), /api\.drawInput = function/);
  assert.match(read("components/rain-print-art.js"), /lastGeom: function/);
});

// ------------------------------------------------------------ in a browser
const DESIGN = "place=Chetek%2C+WI&year=1982&cmp=normal&style=r1&name=Gustum+Farm&normals=1&records=1&m1=1982-04-01+Moved+in";
async function withPage(fn, { width = 1280, height = 900, mobile = false, reduced = false, init = null, wind = null, kind = "wet", q = DESIGN } = {}) {
  const srv = await FX.serve(ROOT), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const c = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", hasTouch: mobile, isMobile: mobile, reducedMotion: reduced ? "reduce" : "no-preference", acceptDownloads: true });
    await c.clock.setFixedTime(new Date("2026-10-20T17:00:00Z"));
    await c.addInitScript(() => { window.__ga = []; window.gaEvent = (n, p) => window.__ga.push([n, p]); });
    if (init) await c.addInitScript(init);
    await FX.mocks(c, { kind, wind });
    const page = await c.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/rain-print.html?` + q);
    await page.waitForFunction(() => document.querySelector("#rp-art svg") && document.getElementById("rp-watch") && !document.getElementById("rp-watch").disabled, null, { timeout: 30000 });
    await fn(page, errors, `http://127.0.0.1:${port}`);
  } finally { await browser.close(); srv.close(); }
}
const played = (page) => page.waitForFunction(() => document.querySelector("#rp-art[data-rpd-done]"), null, { timeout: 60000 });

// the last frame against the print drawn the usual way, at the same size: share of pixels that differ by more than a hair
async function lastFrameVsPrint(page) {
  return page.evaluate(async () => {
    // the same show at the art's own size (1 px a unit), so only the compositing is compared, not a resample
    const cur = AgRainDraw.current().S;
    const S = await AgRainDraw.prepare(cur.src, { scale: 1, wind: !!(cur.wind && !cur.wind.failed), reduced: cur.still }), W = 1800, H = 1200;
    S.cw = W; S.ch = H;
    const a = document.createElement("canvas"); a.width = W; a.height = H;
    // played through, a strip at a time, as the reader sees it (the composite is built up, not drawn once)
    for (let t = 0; t < S.plan.total; t += 1 / 15) AgRainDraw.frameAt(a.getContext("2d"), S, "inplace", t);
    AgRainDraw.frameAt(a.getContext("2d"), S, "inplace", S.plan.total);
    // the print the usual way: the art's one SVG, with its fonts, drawn whole
    const svg = AgRainArt.render(Object.assign({}, S.src.input, { fontCss: S.fontCss, watermark: false, bleed: 0, px: null }));
    const img = new Image(); img.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    await img.decode();
    const b = document.createElement("canvas"); b.width = W; b.height = H; b.getContext("2d").drawImage(img, 0, 0, W, H);
    const A = a.getContext("2d").getImageData(0, 0, W, H).data, B = b.getContext("2d").getImageData(0, 0, W, H).data;
    let off = 0, sum = 0;
    for (let i = 0; i < A.length; i += 4) { const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])); sum += d; if (d > 40) off++; }
    return { off: off / (W * H), mean: sum / (W * H) };
  });
}

test("/rain-print: Watch it draw plays the reader's own print; the last frame is the print", { skip, timeout: 180000 }, async () => {
  await withPage(async (page, errors) => {
    assert.equal(await page.textContent("#rp-watch"), "Watch it draw");
    await page.click("#rp-watch");
    await played(page);
    const r = await lastFrameVsPrint(page);
    assert.ok(r.off < 0.0005 && r.mean < 0.5, `last frame vs print: ${(r.off * 100).toFixed(3)}% of pixels off, mean ${r.mean.toFixed(2)}`);
    // the marked day appears on its date, not before; the ticker shows that date then
    const m = await page.evaluate(() => {
      const S = AgRainDraw.current().S, ev = S.events.find((e) => e.kind === "mark"), p = S.pops.find((x) => x.key === ev.key);
      const W = 1800, H = 1200; S.cw = W; S.ch = H;
      const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
      // the same moment drawn with and without the mark: what differs is the mark itself
      const grab = (SS, t) => { SS.comp = null; const r = AgRainDraw.frameAt(x, SS, "inplace", t); return { px: x.getImageData(p.box.x, p.box.y, p.box.w, p.box.h).data, date: r.date }; };
      const without = Object.assign({}, S, { pops: S.pops.filter((q) => q !== p), comp: null });
      const diff = (a, b) => { let n = 0; for (let i = 0; i < a.px.length; i += 4) if (Math.abs(a.px[i] - b.px[i]) + Math.abs(a.px[i + 1] - b.px[i + 1]) + Math.abs(a.px[i + 2] - b.px[i + 2]) > 60) n++; return n; };
      const at = (t) => { const a = grab(S, t), b = grab(without, t); return { mark: diff(a, b), date: a.date }; };
      return { before: at(ev.t - 0.06), after: at(ev.t + 0.5), end: at(S.plan.total), date: S.E.days[ev.i].date, text: ev.text };
    });
    assert.equal(m.date, "1982-04-01");
    assert.equal(m.after.date, "1982-04-01", "the ticker holds on the day");
    assert.ok(m.end.mark > 50, "the mark is on the print: " + m.end.mark);
    assert.equal(m.before.mark, 0, "before Apr 1 the mark is not there");
    assert.ok(m.after.mark > m.end.mark * 0.85, `after Apr 1 it is there, as on the print (${m.after.mark} vs ${m.end.mark} pixels)`);
    const ga = await page.evaluate(() => window.__ga);
    assert.deepEqual(ga.filter((g) => g[0] === "rain_print_video").map((g) => g[1].action), ["play"]);
    assert.ok(ga.every((g) => !JSON.stringify(g).includes("Gustum") && !JSON.stringify(g).includes("Chetek")), "no name or place to Analytics");
    // drawing frames stays cheap: the median frame of a straight run
    const ms = await page.evaluate(() => {
      const S = AgRainDraw.current().S, c = document.createElement("canvas"); c.width = 1080; c.height = 1920; const x = c.getContext("2d"), out = [];
      S.comp = null;
      for (let f = 0; f < 120; f++) { const a = performance.now(); AgRainDraw.frameAt(x, S, "tall", f / 30 + 2); out.push(performance.now() - a); }
      out.sort((p, q) => p - q); return out[60];
    });
    assert.ok(ms < 30, "median frame " + ms.toFixed(1) + " ms (software rendering here; a phone's GPU is faster)");
    assert.deepEqual(errors, []);
  });
});

test("temperature stripes draw day by day and the last frame is still the print; the hottest day is named on its day, never before", { skip, timeout: 180000 }, async () => {
  for (const style of ["r1", "r2"]) await withPage(async (page, errors) => {
    await page.waitForFunction(() => /data-rp="ribbon"/.test(document.getElementById("rp-art").innerHTML), null, { timeout: 30000 });
    await page.click("#rp-watch");
    await played(page);
    const r = await lastFrameVsPrint(page);
    assert.ok(r.off < 0.0005 && r.mean < 0.5, `${style} with stripes: ${(r.off * 100).toFixed(3)}% off, mean ${r.mean.toFixed(2)}`);
    const m = await page.evaluate(() => {
      const S = AgRainDraw.current().S, ev = S.events.find((e) => e.key === "temp:0"), p = S.pops.find((x) => x.key === "temp:0");
      const rib = S.I.temp.ribbon, g = S.geom, W = 1800, H = 1200; S.cw = W; S.ch = H;
      const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
      const without = Object.assign({}, S, { pops: S.pops.filter((q) => q !== p), comp: null });
      const grab = (SS, t, b) => { SS.comp = null; AgRainDraw.frameAt(x, SS, "inplace", t); return x.getImageData(b.x, b.y, b.w, b.h).data; };
      const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) n++; return n; };
      const at = (t) => diff(grab(S, t, p.box), grab(without, t, p.box));
      // a stripe late in the year (a day with a value), looked at on Jul 1: still paper
      const late = rib.dev.findIndex((v, i) => i > 300 && v !== null && Math.abs(v) >= 3);
      const strip = document.querySelector("#rp-art svg [data-rp=ribbon] rect");
      const y = +strip.getAttribute("y") + 10, xl = g.x0 + (late + 0.5) * (g.x1 - g.x0) / g.n;
      const px = (t) => { S.comp = null; AgRainDraw.frameAt(x, S, "inplace", t); return Array.from(x.getImageData(Math.round(xl), Math.round(y), 1, 1).data.slice(0, 3)); };
      return { late, i: ev && ev.i, hot: rib.hot.doy, text: ev && ev.text, before: at(ev.t - 0.06), end: at(S.plan.total), midLate: px(S.plan.timeOf(181)), endLate: px(S.plan.total) };
    });
    assert.equal(m.i, m.hot, "the hottest day pauses on its own day");
    assert.match(m.text, /^Hottest day: \d+°F, [A-Z][a-z]{2} \d+$/);
    assert.equal(m.before, 0, "not named before its day");
    assert.ok(m.end > 30, "named on the print: " + m.end);
    assert.ok(m.late > 300, "a late-year stripe with a color: " + m.late);
    assert.ok(m.midLate.every((v) => v > 245), "a late-year stripe is still paper on Jul 1: " + m.midLate);
    assert.ok(!m.endLate.every((v) => v > 245), "and drawn by the end: " + m.endLate);
    assert.deepEqual(errors, []);
  }, { q: DESIGN.replace("style=r1", "style=" + style) + "&ribbon=1&frost=1" });
});

test("Staircase and Roots both end on the print; Replay plays again", { skip, timeout: 180000 }, async () => {
  await withPage(async (page, errors) => {
    await page.click("#rp-watch");
    await played(page);
    const r = await lastFrameVsPrint(page);
    assert.ok(r.off < 0.0005 && r.mean < 0.5, `Roots: ${(r.off * 100).toFixed(3)}% off, mean ${r.mean.toFixed(2)}`);
    assert.equal(await page.evaluate(() => AgRainDraw.current().S.geom.style), "r2");
    await page.click(".rpd-bar >> text=Replay");
    await page.waitForFunction(() => !document.querySelector("#rp-art[data-rpd-done]"));
    await played(page);
    const ga = await page.evaluate(() => window.__ga.filter((g) => g[0] === "rain_print_video").map((g) => g[1].action));
    assert.deepEqual(ga, ["play", "replay"]);
    await page.click(".rpd-bar >> text=Done");
    assert.equal(await page.$(".rpd-canvas"), null, "Done puts the print back");
    assert.deepEqual(errors, []);
  }, { q: DESIGN.replace("style=r1", "style=r2") });
});

test("a video file comes out (MediaRecorder WebM here), plays, under 8 MB; a computer saves it", { skip, timeout: 240000 }, async () => {
  await withPage(async (page, errors) => {
    await page.click("#rp-watch");
    await played(page);
    await page.click(".rpd-make");
    await page.waitForFunction(() => /Your video is ready/.test(document.querySelector(".rpd-say").textContent), null, { timeout: 120000 });
    assert.equal(await page.isVisible(".rpd-share"), false, "no Share on a computer");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click(".rpd-save")]);
    const dir = mkdtempSync(join(tmpdir(), "rpd-")), f = join(dir, dl.suggestedFilename());
    await dl.saveAs(f);
    assert.match(dl.suggestedFilename(), /^rain-print-chetek-wisconsin-1982-r1\.(webm|mp4)$/);
    const size = statSync(f).size;
    assert.ok(size > 50000 && size < 8 * 1048576, "size " + size);
    if (process.env.RPD_KEEP) writeFileSync(process.env.RPD_KEEP, readFileSync(f));
    if (ffprobe) {
      const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_name,width,height,nb_read_frames:format=duration", "-of", "json", f]).toString());
      const total = await page.evaluate(() => AgRainDraw.current().S.plan.total);
      assert.equal(+j.streams[0].width, 1080); assert.equal(+j.streams[0].height, 1080);
      assert.ok(+j.streams[0].nb_read_frames > 60, "frames " + j.streams[0].nb_read_frames);
      assert.ok(Math.abs(+j.format.duration - total) < 2.5, `duration ${j.format.duration} vs ${total}: the WebM carries its length`);
    }
    const ga = await page.evaluate(() => window.__ga.filter((g) => g[0] === "rain_print_video").map((g) => g[1].action));
    assert.deepEqual(ga, ["play", "export", "save"]);
    assert.deepEqual(errors, []);
  });
});

test("WebCodecs: every frame goes to the encoder, or a stalled encoder gives up in seconds (never a hung page)", { skip, timeout: 300000 }, async () => {
  await withPage(async (page) => {
    await page.click("#rp-watch");
    await played(page);
    const r = await page.evaluate(async () => {
      if (!window.VideoEncoder) return null;
      const S = AgRainDraw.current().S;
      // a small frame: this sandbox encodes in software at under 2 frames a second at full size
      AgRainDraw.FORMATS.tiny = { w: 270, h: 480, label: "test", bps: 300000 };
      const ok = (await VideoEncoder.isConfigSupported({ codec: "vp8", width: 270, height: 480, bitrate: 3e5, framerate: 30 })).supported;
      if (!ok) return null;
      // this Chromium has no H.264 encoder; the loop is the same for any codec. The short (four-step) schedule keeps it quick.
      const S2 = Object.assign({}, S, { plan: AgRainDraw.stepsPlan(S.E.n), comp: null }), t0 = performance.now();
      try {
        const x = await AgRainDraw.encodeFrames(S2, "tiny", "vp8");
        return { n: x.samples.length, want: Math.ceil(S2.plan.total * 30) + 1, first: x.samples[0].key, keys: x.samples.filter((s) => s.key).length };
      } catch (e) { return { err: e.message, secs: (performance.now() - t0) / 1000 }; }
    });
    if (!r) return;
    if (r.err) {
      // headless Chromium's software encoder stops handing frames back after a few; the page must not wait forever
      assert.equal(r.err, "stall"); assert.ok(r.secs < 60, "gave up after " + r.secs.toFixed(1) + " s");
      return;
    }
    assert.equal(r.n, r.want);
    assert.equal(r.first, true);
    assert.ok(r.keys >= Math.floor(r.want / 60), "a key frame every 2 s");
  });
});

test("a phone shares the file with the Web Share API", { skip, timeout: 240000 }, async () => {
  const init = () => {
    window.__shared = null;
    navigator.canShare = (d) => !!(d && d.files && d.files.length);
    navigator.share = (d) => { window.__shared = { n: d.files.length, type: d.files[0].type, name: d.files[0].name, size: d.files[0].size, text: d.text, title: d.title }; return Promise.resolve(); };
  };
  await withPage(async (page, errors) => {
    await page.click("#rp-watch");
    await played(page);
    await page.check(".rpd-fmt input[value=tall]");
    await page.click(".rpd-make");
    await page.waitForFunction(() => /Your video is ready/.test(document.querySelector(".rpd-say").textContent), null, { timeout: 120000 });
    assert.equal(await page.isVisible(".rpd-share"), true);
    await page.click(".rpd-share");
    await page.waitForFunction(() => window.__shared);
    const s = await page.evaluate(() => window.__shared);
    assert.equal(s.n, 1); assert.match(s.type, /^video\/(webm|mp4)$/); assert.ok(s.size < 8 * 1048576, "tall size " + s.size);
    assert.match(s.text, /Every rain and snow at Chetek, Wisconsin in 1982, day by day\. https:\/\/agsist\.com\/rain-print\?d=/);
    const ga = await page.evaluate(() => window.__ga.filter((g) => g[0] === "rain_print_video").map((g) => [g[1].action, g[1].format]));
    assert.deepEqual(ga, [["play", "square"], ["export", "tall"], ["share", "tall"]]);
    assert.deepEqual(errors, []);
  }, { width: 390, height: 844, mobile: true, init });
});

test("reduced motion: four still steps on screen; a browser that can't record offers the picture", { skip, timeout: 120000 }, async () => {
  const init = () => { delete window.MediaRecorder; delete window.VideoEncoder; HTMLCanvasElement.prototype.captureStream = undefined; };
  await withPage(async (page, errors) => {
    await page.click("#rp-watch");
    await played(page);
    const st = await page.evaluate(() => { const S = AgRainDraw.current().S; return { steps: S.plan.steps, total: S.plan.total, still: S.still }; });
    assert.deepEqual(st.steps, [91, 183, 274, 365]);
    assert.ok(st.still && st.total < 8);
    assert.match(await page.textContent(".rpd-say"), /four steps, without motion/);
    const r = await lastFrameVsPrint(page);
    assert.ok(r.off < 0.0005, "the last step is the print");
    await page.click(".rpd-make");
    await page.waitForFunction(() => /can’t make a video file/.test(document.querySelector(".rpd-say").textContent));
    assert.equal(await page.isVisible(".rpd-still"), true);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click(".rpd-still")]);
    assert.match(dl.suggestedFilename(), /\.png$/);
    const ga = await page.evaluate(() => window.__ga.filter((g) => g[0] === "rain_print_video").map((g) => g[1].action));
    assert.deepEqual(ga, ["play", "fail", "still"]);
    assert.deepEqual(errors, []);
  }, { reduced: true, init });
});

test("wind is off until asked; on, it is modeled and says so; hail says what it checked", { skip, timeout: 120000 }, async () => {
  await withPage(async (page, errors) => {
    await page.click("#rp-watch");
    await played(page);
    let say = await page.textContent(".rpd-say");
    assert.match(say, /No hail reported within 10 mi in 1982 \(NOAA NCEI Storm Events\)/);
    assert.ok(!/Wind/.test(say));
    assert.equal(await page.evaluate(() => AgRainDraw.current().S.wind), null);
    await page.check(".rpd-wind input");
    await page.waitForFunction(() => AgRainDraw.current().S && AgRainDraw.current().S.wind);
    await played(page);
    say = await page.textContent(".rpd-say");
    assert.match(say, /Wind is modeled \(ERA5 reanalysis via Open-Meteo\), not measured at the station/);
    const w = await page.evaluate(() => { const S = AgRainDraw.current().S; return { top: S.wind.top.date, ev: S.events.filter((e) => e.kind === "wind").map((e) => e.text), credit: S.creditLine }; });
    assert.equal(w.top, "1982-06-29");
    assert.match(w.ev[0], /\(modeled\)$/);
    assert.match(w.credit, /Wind: ERA5 reanalysis via Open-Meteo, modeled/);
    // the last frame is still the print: video-only marks are gone by then
    const r = await lastFrameVsPrint(page);
    assert.ok(r.off < 0.0005, "wind marks fade before the end");
    assert.deepEqual(errors, []);
  }, { wind: FX.windAnswer });
});

test("hail near town shows on its own day, from our records, and is gone from the last frame", { skip, timeout: 120000 }, async () => {
  await withPage(async (page, errors) => {
    await page.click("#rp-watch");
    await played(page);
    const h = await page.evaluate(() => { const S = AgRainDraw.current().S; return { list: S.hail.list.map((x) => [x.date, x.size, Math.round(x.mi), x.kind]), ev: S.events.filter((e) => e.kind === "hail").map((e) => [S.E.days[e.i].date, e.text]) }; });
    // NWS storm reports in data/hail/events-2024.json: 1.25 in hail 2.7 mi from Chetek on Sep 21, 2024
    assert.deepEqual(h.list, [["2024-09-21", 1.25, 3, "report"]]);
    assert.deepEqual(h.ev, [["2024-09-21", "Hail reported within 3 mi, 1.25 in"]]);
    assert.match(await page.textContent(".rpd-say"), /Hail near town: NWS storm reports/);
    const r = await lastFrameVsPrint(page);
    assert.ok(r.off < 0.0005, "the hail mark fades before the end");
    assert.deepEqual(errors, []);
  }, { q: DESIGN.replace(/1982/g, "2024") });
});

test("county rain page: Watch it draw loads on a tap and ends on the county's print", { skip, timeout: 120000 }, async () => {
  const srv = await FX.serve(ROOT), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    await c.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const page = await c.newPage(), errors = [], loaded = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("request", (r) => loaded.push(new URL(r.url()).pathname));
    await page.goto(`http://127.0.0.1:${port}/rain/wisconsin/barron-county.html`);
    await page.evaluate(() => document.getElementById("rc-print").nextElementSibling.scrollIntoView());
    await page.waitForSelector("#rc-print .rc-watch", { timeout: 30000 });
    assert.ok(!loaded.some((p) => /rain-print-draw/.test(p)), "nothing extra loads until the tap");
    await page.click("#rc-print .rc-watch");
    await page.waitForFunction(() => document.querySelector(".rc-print-art[data-rpd-done]"), null, { timeout: 60000 });
    const r = await lastFrameVsPrint(page);
    assert.ok(r.off < 0.0005 && r.mean < 0.5, `county last frame vs print: ${(r.off * 100).toFixed(3)}% off`);
    const tk = await page.evaluate(() => { const S = AgRainDraw.current().S; return { last: AgRainDraw.ticker(S.E, S.E.n, null), total: document.getElementById("rc-print").dataset.total }; });
    assert.equal(tk.last.totalText, tk.total + " in", "the county page's own total");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
