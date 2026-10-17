// Rain Print v2 mockup harness: real 2012 Ames NOAA data -> 19 x 13 sheet PNG at 300 dpi, a preview, and checks.
// node render.mjs <jobs.json> <outdir>
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";
const ROOT = "/tmp/claude-0/-home-user-agsist/e2b06309-5299-5558-aa96-466b373aa229/scratchpad/wt/rpv2/";
const jobs = JSON.parse(readFileSync(process.argv[2], "utf8")), OUT = process.argv[3];
mkdirSync(OUT, { recursive: true });
const { answerOf } = await import(ROOT + "scripts/rain_print_examples_pack.mjs");
const { chromium } = await import("/home/user/node_modules/playwright/index.mjs");
const read = (f) => readFileSync(ROOT + f, "utf8");
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob }; ctx.window = ctx;
for (const f of ["components/qr.js", "components/rain-print.js", "components/rain-print-records.js"]) vm.runInNewContext(read(f), ctx);
const RP = ctx.RainPrint, REC = ctx.AgRainRecords;
const SD = ROOT + "scratch-rpv2/out/";

function daysFrom(rows, snowCol) {
  return RP.closeOpenS(rows.map((row, i) => {
    const v = RP.parsePcpn(row[1]), dt = new Date(row[0] + "T00:00:00");
    return { date: row[0], v: v.v, flag: v.flag, t: null, s: row[snowCol] !== undefined ? RP.parsePcpn(row[snowCol]).v : null, m: dt.getMonth(), d: dt.getDate(), doy: i };
  }));
}
// the print's own station (as the page picks it), from the saved example
function amesGauge() {
  const ex = JSON.parse(read("data/rain-print-examples/2012-ames-ia.json"));
  const sidOf = (u) => new URL(u).searchParams.get("sid"), isPor = (u) => new URL(u).searchParams.get("sdate") === "por";
  const q = ex.requests.filter((r) => r.url.includes("StnData?sid=") && sidOf(r.url) === ex.station && !isPor(r.url)).pop();
  const p = ex.requests.filter((r) => r.url.includes("StnData?sid=") && sidOf(r.url) === ex.station && isPor(r.url)).pop();
  const days = daysFrom(q.body.data, 3), D = RP.derive(days);
  const nq = ex.requests.find((r) => r.url.includes("StnData?params=") && decodeURIComponent(r.url).includes('"normal"'));
  const byDate = new Map(); nq.body.data.forEach((row) => { const v = RP.parsePcpn(row[1]).v; if (v !== null) byDate.set(row[0].slice(5), v); });
  const records = REC.find({ year: 2012, sid: ex.station, daily: q.body, por: answerOf(p), dailyElems: ["pcpn", "avgt", "snow", "maxt", "mint"], porElems: ["pcpn", "avgt"] }, {});
  return { days, D, showDry: RP.showDry(D), axisLen: D.n, ov: RP.overlayDaily(days, byDate), ovNote: RP.cmpNoteFor("normal"), showNormals: true, records, year: 2012, gauge: "Weather station: Ames, IA, 2.0 mi from Ames" };
}
// the long-record NOAA co-op station (fetched on a GitHub runner, scratch-rpv2/out)
function longStation(sid, gauge) {
  const por = JSON.parse(readFileSync(SD + "por_" + sid + ".json", "utf8"));
  const avg = (r) => (r[3] === "M" || r[4] === "M") ? "M" : String((+r[3] + +r[4]) / 2);
  const rows = por.data.filter((r) => r[0].startsWith("2012"));
  const daily = { meta: por.meta, data: rows.map((r) => [r[0], r[1], avg(r), r[2], r[3], r[4]]) };
  const days = daysFrom(daily.data, 3), D = RP.derive(days);
  const nor = JSON.parse(readFileSync(SD + "normal_" + sid + ".json", "utf8"));
  const byDate = new Map(); nor.data.forEach((row) => { const v = RP.parsePcpn(row[1]).v; if (v !== null) byDate.set(row[0].slice(5), v); });
  const porA = { meta: por.meta, data: por.data.map((r) => [r[0], r[1], avg(r)]) };
  const records = REC.find({ year: 2012, sid, daily, por: porA, dailyElems: ["pcpn", "avgt", "snow", "maxt", "mint"], porElems: ["pcpn", "avgt"] }, {});
  // every full year (365/366 days, every day a reported amount: no M, no S) as a running total
  const yrs = {};
  for (const r of por.data) { const y = +r[0].slice(0, 4); (yrs[y] ||= []).push(r[1]); }
  const hist = [], full = [];
  for (const [y, vals] of Object.entries(yrs)) {
    const n = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
    if (vals.length !== n || vals.some((v) => v === "M" || /S/.test(v))) continue;
    let c = 0; const cum = vals.map((v) => (c += v === "T" ? 0 : parseFloat(v)));
    full.push({ year: +y, total: +c.toFixed(2) });
    if (+y !== 2012) hist.push({ year: +y, cum: cum.map((x) => +x.toFixed(3)) });
  }
  return { days, D, showDry: RP.showDry(D), axisLen: D.n, ov: RP.overlayDaily(days, byDate), ovNote: RP.cmpNoteFor("normal"), showNormals: true, records, year: 2012, gauge, hist, full };
}
vm.runInNewContext(read("components/gdu-stages.js"), ctx);
const GS = ctx.AgGduStages;
// the GDU calculator's own daily math (gdu-calculator.html gduDay): 86/50
function gduDay(hi, lo) { hi = Math.min(Math.max(hi, 50), 86); lo = Math.min(Math.max(lo, 50), 86); return (hi + lo) / 2 - 50; }
const PICK = { corn: [["VE", "Emerged"], ["V6", "V6"], ["R1", "Silk"], ["R5", "Dent"], ["R6", "Black layer"]], bean: [["VE", "Emerged"], ["V3", "V3"], ["R1", "Flower"], ["R5", "Seed fill"], ["R7", "Turning"]] };
const doyOf = (iso) => Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse("2012-01-01T00:00:00Z")) / 864e5);
function walk(temps, kind, plant, harvest) {
  const table = kind === "corn" ? GS.corn : GS.bean, want = PICK[kind].map(([k, l]) => ({ key: k, label: l, gdu: table.find((t) => t.s === k).gdu }));
  let c = 0, i = 0, t = Date.parse(plant + "T00:00:00Z"); const out = [], end = Date.parse(harvest + "T00:00:00Z");
  // GDUs count from the planting day itself, as the GDU calculator does (its weather starts on the planting date)
  for (; t <= end && i < want.length; t += 864e5) {
    const d = new Date(t).toISOString().slice(0, 10), v = temps.get(d);
    if (!v) { out.missingFrom = d; break; }
    c += gduDay(v[0], v[1]);
    while (i < want.length && c >= want[i].gdu) { out.push({ key: want[i].key, label: want[i].label, gdu: want[i].gdu, date: d, doy: doyOf(d) }); i++; }
  }
  out.gduAtEnd = c;
  return out;
}
function cropFor(spec) {
  const por = JSON.parse(readFileSync(SD + "por_" + spec.tempStation + ".json", "utf8")), act = new Map(), nor = new Map();
  por.data.forEach((r) => { if (r[0].startsWith("2012") && r[3] !== "M" && r[4] !== "M") act.set(r[0], [+r[3], +r[4]]); });
  JSON.parse(readFileSync(SD + "normal_" + spec.tempStation + ".json", "utf8")).data.forEach((r) => { if (r[2] !== "M" && r[3] !== "M") nor.set(r[0], [+r[2], +r[3]]); });
  const stages = walk(act, spec.kind, spec.plant, spec.harvest);
  const ghost = spec.ghost && nor.size > 300 ? walk(nor, spec.kind, spec.plant, spec.harvest) : null;
  const key = spec.kind === "corn" ? "R1" : "R1";
  if (ghost) { const a = stages.find((s) => s.key === key), b = ghost.find((s) => s.key === key); if (a && b && a.doy !== b.doy) { const d = b.doy - a.doy; a.note = Math.abs(d) + (Math.abs(d) === 1 ? " day " : " days ") + (d > 0 ? "ahead of" : "behind") + " a usual year"; } }
  console.log("crop", JSON.stringify({ stages, ghost }));
  return { kind: spec.kind, plant: doyOf(spec.plant), harvest: doyOf(spec.harvest), stages, ghost, foot: spec.foot.concat(ghost ? spec.ghostFoot : []) };
}
const bases = {};
function baseFor(j) {
  const k = j.station || "gauge";
  if (!bases[k]) bases[k] = k === "gauge" ? amesGauge() : longStation(k, j.gaugeText);
  return bases[k];
}

const srv = createServer((req, res) => {
  const u = new URL(req.url, "http://x"), f = normalize(join(ROOT, decodeURIComponent(u.pathname)));
  if (u.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><title>t</title>"); return; }
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": { ".js": "text/javascript; charset=utf-8", ".woff2": "font/woff2" }[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f));
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage(); const errors = [];
page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error" || m.type() === "log") console.log("page:", m.text()); });
await page.goto("http://127.0.0.1:" + srv.address().port + "/");
const FONTCSS = [["Fraunces", "300 600", "normal", "rp-fraunces-opsz"], ["Fraunces", "400", "italic", "rp-fraunces-opsz-400i"], ["IBM Plex Sans", "300 600", "normal", "rp-plex-sans-var"], ["IBM Plex Sans", "400", "italic", "rp-plex-sans-400i"]]
  .map(([f, w, s, file]) => `@font-face{font-family:'${f}';font-weight:${w};font-style:${s};src:url(/fonts/${file}.woff2) format('woff2')}`).join("");
await page.addStyleTag({ content: FONTCSS });
await page.addScriptTag({ url: "/components/qr.js" }); await page.addScriptTag({ url: "/components/rain-print.js" });
await page.evaluate(() => Promise.all(["300 40px 'Fraunces'", "600 52px 'Fraunces'", "italic 400 21px 'Fraunces'", "400 16px 'IBM Plex Sans'", "500 16px 'IBM Plex Sans'", "italic 400 17px 'IBM Plex Sans'"].map((f) => document.fonts.load(f))));
const FONT_INLINE = [["Fraunces", "300 600", "normal", "rp-fraunces-opsz"], ["Fraunces", "400", "italic", "rp-fraunces-opsz-400i"], ["IBM Plex Sans", "300 600", "normal", "rp-plex-sans-var"], ["IBM Plex Sans", "400", "italic", "rp-plex-sans-400i"]]
  .map(([f, w, s, file]) => `@font-face{font-family:'${f}';font-weight:${w};font-style:${s};src:url(data:font/woff2;base64,${readFileSync(ROOT + "fonts/" + file + ".woff2").toString("base64")}) format('woff2')}`).join("");
const report = [];
for (const j of jobs) {
  const base = baseFor(j);
  // fresh script per art file
  await page.evaluate(() => { delete window.AgRainArt; });
  await page.addScriptTag({ content: read(j.art || "components/rain-print-art.js") });
  const marks = RP.markersOn((j.marks || []).map(([date, label]) => ({ date, label })), 2012, base.D.n);
  const I = Object.assign({}, base, { style: j.style || "r1", place: "Ames, Iowa", name: j.name || "", dedication: j.dedication || "", markers: marks, v2: j.v2 || null, crop: j.crop ? cropFor(j.crop) : null, fontCss: FONT_INLINE });
  if (!j.v2 || !j.v2.history) delete I.hist;
  if (j.gaugeText) I.gauge = j.gaugeText;
  if (j.letter) {
    await page.evaluate(() => { delete window.AgRpInsert; });
    await page.addScriptTag({ content: read(j.letter.script) });
    const r = await page.evaluate(async ({ I, L }) => {
      const RP = window.RainPrint, A = window.AgRainArt;
      I.qr = { matrix: RP.standardMatrix(), serial: "No. 0001" };
      const css = I.fontCss; delete I.fontCss;
      const mini = A.render(I), F = A.facts(I, { unplaced: A.lastUnplaced() });
      const svg = window.AgRpInsert.render({ facts: F, mini, serial: "No. 0001", gift: L.gift, giftFrom: "", qr: RP.standardMatrix(), fontCss: css, px: [2550, 3300],
        station: { words: "Ames, IA", away: "2.0 miles", kind: "volunteer" }, source: "NOAA\u2019s daily records", v2: L.v2, familyCode: L.familyCode });
      const img = new Image(); img.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })); await img.decode();
      const c = document.createElement("canvas"); c.width = 2550; c.height = 3300; c.getContext("2d").drawImage(img, 0, 0, 2550, 3300);
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      const sizes = [...doc.querySelectorAll("text")].map((t) => +t.getAttribute("font-size"));
      window.__lsvg = svg.replace(/<style>[\s\S]*?<\/style>/, "");
      return { svgText: window.__lsvg.slice(0, 3000), png: c.toDataURL("image/png"), overflow: window.AgRpInsert.lastOverflow(), minText: Math.min(...sizes) };
    }, { I, L: j.letter });
    writeFileSync(OUT + "/" + j.out + ".png", Buffer.from(r.png.split(",")[1], "base64"));
    console.log(JSON.stringify({ out: j.out, overflow: r.overflow, minText: r.minText })); writeFileSync(OUT + "/../rpv2tools/" + j.out + ".txt", r.svgText);
    continue;
  }
  const r = await page.evaluate(async ({ I, PPI, scale }) => {
    const RP = window.RainPrint, A = window.AgRainArt, B = RP.sheetBoxes();
    I.qr = { matrix: RP.standardMatrix(), serial: "No. 0001" };
    I.px = [Math.round(B.art.w * PPI), Math.round(B.art.h * PPI)];
    const svg = A.render(I);
    const img = new Image(); img.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })); await img.decode();
    const c = document.createElement("canvas"); c.width = Math.round(B.sheet.w * PPI); c.height = Math.round(B.sheet.h * PPI);
    const x = c.getContext("2d"); x.fillStyle = "#FFFFFF"; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(img, Math.round(B.art.x * PPI), Math.round(B.art.y * PPI), Math.round(B.art.w * PPI), Math.round(B.art.h * PPI));
    // ink box at 40 ppi, like the sheet test
    const q = document.createElement("canvas"), P2 = 40; q.width = B.sheet.w * P2; q.height = B.sheet.h * P2;
    const qx = q.getContext("2d"); qx.drawImage(c, 0, 0, q.width, q.height);
    const d = qx.getImageData(0, 0, q.width, q.height).data; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let yy = 0; yy < q.height; yy++) for (let xx = 0; xx < q.width; xx++) { const i = (yy * q.width + xx) * 4; if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; } }
    // sizes in the drawn SVG
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const sizes = [...doc.querySelectorAll("text,tspan")].map((t) => +t.getAttribute("font-size")).filter((v) => v > 0);
    const strokes = [...doc.querySelectorAll("[stroke-width]")].filter((e) => e.getAttribute("stroke") !== "none" && e.getAttribute("stroke") !== "#FFFFFF").map((e) => +e.getAttribute("stroke-width"));
    const small = [...doc.querySelectorAll("text")].filter((t) => +t.getAttribute("font-size") < 11).map((t) => t.textContent);
    return { png: c.toDataURL("image/png"), svg, ink: { x0: x0 / P2, y0: y0 / P2, x1: (x1 + 1) / P2, y1: (y1 + 1) / P2 }, safe: B.safe, minText: Math.min(...sizes), minStroke: Math.min(...strokes), small, unplaced: A.lastUnplaced(), skipped: A.lastSkipped(), info: window.__rpv2info || null };
  }, { I, PPI: 300 });
  writeFileSync(OUT + "/" + j.out + ".png", Buffer.from(r.png.split(",")[1], "base64"));
  
  const s = r.safe, i = r.ink, inside = i.x0 >= s.x - 1e-6 && i.y0 >= s.y - 1e-6 && i.x1 <= s.x + s.w + 1e-6 && i.y1 <= s.y + s.h + 1e-6;
  const line = { out: j.out, inside, ink: i, safe: s, minText: r.minText, minStroke: r.minStroke, small: r.small, unplaced: r.unplaced, skipped: r.skipped, info: r.info };
  report.push(line); console.log(JSON.stringify(line));
}
writeFileSync(OUT + "/checks-" + (process.argv[4] || "last") + ".json", JSON.stringify(report, null, 1));
if (errors.length) console.log("ERRORS", errors);
await browser.close(); srv.close();
