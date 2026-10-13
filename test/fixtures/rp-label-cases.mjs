/* Rain Print stress cases (2026-10-13): years, options and date picks built to
 * crowd the print, for the label checker (rp-label-check.mjs). Synthetic years
 * only, labeled as such; nothing here is station data.
 *
 *   engine(ROOT)          the shipped files in a bare vm context
 *   DATA                  name -> (seed) => raw days [{date, p, s, t}]
 *   input(E, spec)        the engine's AgRainArt input for one case
 *   fixedCases(), fuzzCases(seed, n)   lists of specs
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

export function engine(ROOT) {
  const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob, Map, Promise };
  ctx.window = ctx;
  for (const f of ["components/qr.js", "components/rain-print.js", "components/rain-print-art.js", "components/rain-print-records.js"])
    vm.runInNewContext(readFileSync(ROOT + f, "utf8"), ctx);
  return { RP: ctx.RainPrint, ART: ctx.AgRainArt, REC: ctx.AgRainRecords, QR: ctx.AgQR };
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const DAY = 86400000;
const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const iso = (y, i) => new Date(Date.UTC(y, 0, 1) + i * DAY).toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const short = (d) => MON[+d.slice(5, 7) - 1] + " " + +d.slice(8, 10);

// a year shaped like west-central Wisconsin (synthetic)
function base(y, seed, f = 1) {
  const r = rng(seed), n = leap(y) ? 366 : 365, out = [];
  for (let i = 0; i < n; i++) {
    const season = Math.sin((2 * Math.PI * (i - 105)) / 365);
    const t = Math.round(44 + 31 * season + (r() - 0.5) * 18);
    const wet = r() < 0.24 + 0.1 * season;
    let p = wet ? -Math.log(1 - r()) * (0.22 + 0.16 * (season + 1)) : 0;
    if (wet && r() < 0.04) p += 1.2 + r() * 1.8;
    p *= f;
    const s = wet && t < 30 ? Math.round(p * 11 * 10) / 10 : 0;
    out.push({ date: iso(y, i), p: p.toFixed(2), s, t });
  }
  return out;
}
export const DATA = {
  usual: (seed) => base(2025, seed),
  dry: (seed) => base(2025, seed, 0.25),
  wet: (seed) => base(2025, seed, 2.2),
  leap: (seed) => base(2024, seed),
  // every drop as snow in a long winter, a near-dry summer
  snowWinter: (seed) => base(2025, seed).map((d, i) => (i < 100 || i > 300 ? { ...d, p: (+d.p * 1.8).toFixed(2), s: Math.round(+d.p * 1.8 * 12 * 10) / 10, t: Math.min(d.t, 20) } : { ...d, p: (+d.p * 0.15).toFixed(2), s: 0 })),
  // a station that misses a lot: runs of M, and S days closed by an A total
  gaps: (seed) => { const r = rng(seed + 7); let run = 0; return base(2025, seed).map((d, i) => {
    if (run > 0) { run--; return { ...d, p: "M", s: null }; }
    if (r() < 0.025) { run = Math.floor(r() * 4); return { ...d, p: "M", s: null }; }
    if (i % 41 === 5) return { ...d, p: "S" };
    if (i % 41 === 6) return { ...d, p: (+d.p + 0.4).toFixed(2) + "A" };
    return d; }); },
  // the whole year's rain in one month
  oneJune: (seed) => base(2025, seed).map((d, i) => (d.date.slice(5, 7) === "06" ? { ...d, p: (+d.p * 9).toFixed(2) } : { ...d, p: "0.00", s: 0 })),
  oneJan: (seed) => base(2025, seed).map((d) => (d.date.slice(5, 7) === "01" ? { ...d, p: (+d.p * 9 + 0.1).toFixed(2), s: 0 } : { ...d, p: "0.00", s: 0 })),
  oneDec: (seed) => base(2025, seed).map((d) => (d.date.slice(5, 7) === "12" ? { ...d, p: (+d.p * 9 + 0.1).toFixed(2), s: 0 } : { ...d, p: "0.00", s: 0 })),
  // most of the year's rain before June: the line climbs into the upper left
  wetSpring: (seed) => base(2025, seed).map((d, i) => ({ ...d, p: (+d.p * (i < 150 ? 3.2 : 0.35)).toFixed(2) })),
  empty: (seed) => base(2025, seed).map((d) => ({ ...d, p: "0.00", s: 0 })),
};

// remarkable days, in the records layer's own words, placed on this year's days
export function records(days, mode, r) {
  const y = days[0].date.slice(0, 4), pick = (k) => days[Math.max(0, Math.min(days.length - 1, k))].date;
  const byT = days.map((d, i) => [d.t, i]).filter((x) => x[0] !== null && x[0] !== undefined);
  const cold = byT.reduce((a, b) => (b[0] < a[0] ? b : a), byT[0] || [0, 10])[1], hot = byT.reduce((a, b) => (b[0] > a[0] ? b : a), byT[0] || [0, 190])[1];
  let out = [
    { kind: "wetYear", date: y + "-01-01", span: { from: y + "-01-01", to: y + "-12-31" }, label: "Wettest year on record here, back to 1893" },
    { kind: "coldest", date: pick(cold), label: "Coldest: -24°F (also Jan 21)" },
    { kind: "hottest", date: pick(hot), label: "Hottest: 97°F (on 3 days)" },
    { kind: "lastFrost", date: pick(128), label: "Last frost: 28°F" },
    { kind: "firstFrost", date: pick(268), label: "First frost: 31°F" },
    { kind: "snowDay", date: pick(40), label: "Biggest snow: 14.5 in" },
    { kind: "lastSnow", date: pick(104), label: "Last snow: 2.0 in" },
    { kind: "firstSnow", date: pick(312), label: "First snow: 1.5 in" },
    { kind: "wetWeek", date: pick(170), span: { from: pick(170), to: pick(175) }, label: "Wettest week: 4.86 in" },
    { kind: "wetMonth", date: y + "-06-01", span: { from: y + "-06-01", to: y + "-06-30" }, label: "Tied for 2nd wettest June of 120 full years: 10.25 in" },
    { kind: "coldMonth", date: y + "-02-01", span: { from: y + "-02-01", to: y + "-02-28" }, label: "Coldest February of 76 full years: 4.5°F" },
  ];
  if (mode === "sameMonth") {   // everything in July
    out = out.map((x, k) => (x.span && x.kind !== "wetYear" ? { ...x, date: y + "-07-01", span: { from: pick(181 + k), to: pick(186 + k) } } : x.kind === "wetYear" ? x : { ...x, date: pick(182 + 2 * k) }));
  }
  if (mode === "sameDay") out = out.map((x) => (x.span ? x : { ...x, date: pick(200) }));
  if (mode === "random" && r) out = out.map((x) => (x.span ? x : { ...x, date: pick(Math.floor(r() * days.length)) }));
  if (mode === "few") out = out.filter((x) => ["coldest", "hottest", "lastFrost", "firstFrost"].includes(x.kind));
  return out;
}

const LABELS = ["Planted", "Hail", "Harvest done", "Sold the crop", "First calf", "Cut hay", "Wedding", "Sprayed beans", "Planted corn", ""];
// the reader's three dates: worst cases by name, as day indexes (wi = the biggest rain)
export function markerSet(name, n, wi, r) {
  const L = (k) => LABELS[k % LABELS.length];
  const W = Math.max(0, wi);
  const sets = {
    none: [],
    spread: [[127, "Planted"], [192, "Hail"], [296, "Harvest done"]],
    jan1x3: [[0, "Planted corn"], [0, "Sold the crop"], [0, "Harvest done"]],
    dec31x3: [[n - 1, "Harvest done"], [n - 1, "Sold the crop"], [n - 1, "Sprayed beans"]],
    adjJan: [[0, "Sold the crop"], [1, "Harvest done"], [2, "Sprayed beans"]],
    adjDec: [[n - 3, "Sold the crop"], [n - 2, "Harvest done"], [n - 1, "Sprayed beans"]],
    wetDay: [[W, "Hail"], [W, "Sold the crop"], [W + 1, "Harvest done"]],
    near: [[150, "Planted corn"], [153, "Sprayed beans"], [158, "Harvest done"]],
    sameMid: [[200, "Harvest done"], [200, "Sold the crop"], [200, "Sprayed beans"]],
    unlabeled: [[0, ""], [n - 1, ""], [W, ""]],
    two: [[40, "Sold the crop"], [41, "Harvest done"]],
  };
  if (name === "random") {
    const k = 1 + Math.floor(r() * 3), out = [];
    for (let i = 0; i < k; i++) {
      const near = out.length && r() < 0.5 ? out[out.length - 1][0] + Math.floor(r() * 6) : Math.floor(r() * n);
      out.push([Math.min(n - 1, near), L(Math.floor(r() * 50))]);
    }
    return out;
  }
  return sets[name];
}

const LONG_PLACE = "Saint Francisville Township, West Virginia";
const LONG_GAUGE = "Rain gauge: Saint Francisville 2.3 NNE, WV weather station, 12.4 mi from Saint Francisville Township";
/* spec: {data, seed, style, normals, records (false | mode), cmp, name, dedication, place, gauge, markers (name), preview (doy or 0), qr} */
export function input(X, spec) {
  const { RP, QR } = X;
  let raw = DATA[spec.data](spec.seed || 1);
  const y = +raw[0].date.slice(0, 4), axisLen = raw.length;
  if (spec.preview) raw = raw.slice(0, spec.preview);
  const days = raw.map((d, i) => { const pp = RP.parsePcpn(d.p), dt = new Date(d.date + "T00:00:00Z"); return { date: d.date, v: pp.v, flag: pp.flag, t: d.t, s: d.s, m: dt.getUTCMonth(), d: dt.getUTCDate(), doy: i }; });
  const D = RP.derive(days);
  const nm = new Map(); for (let i = 0; i < 366; i++) nm.set(iso(2024, i).slice(5), 0.091 + 0.06 * Math.sin((2 * Math.PI * (i - 100)) / 366));
  const r = rng((spec.seed || 1) * 31 + 5);
  const mk = markerSet(spec.markers || "none", days.length, D.max ? D.max.doy : 0, r).filter((m) => m[0] >= 0 && m[0] < days.length)
    .map(([doy, label]) => ({ doy, label: label || short(days[doy].date) }));
  const recs = spec.records ? records(days, spec.records, r) : [];
  return {
    style: spec.style, year: y, place: spec.place === "long" ? LONG_PLACE : "Chetek, Wisconsin",
    name: spec.name === "long" ? "Prairie View Seed and Gra" .slice(0, 24) : spec.name === "none" ? "" : "The Olson Farm",
    dedication: spec.dedication === "long" ? "For Grandpa Erling, sixty harvests on this ground and still counting rain" .slice(0, 70) : spec.dedication === "none" ? "" : "For Dad, his 40th crop. Love, Kate",
    days, D, showDry: RP.showDry(D), axisLen, ov: spec.cmp === "none" ? null : RP.overlayDaily(days, nm), ovNote: spec.cmp === "none" ? "" : "Usual = 30-year normal",
    showNormals: !!spec.normals, markers: mk, records: recs,
    qr: spec.qr === false ? null : { matrix: QR.matrix("HTTPS://AGSIST.COM/R?K7Q2M"), serial: spec.serial ? "No. 0001 · SRL" : "" },
    preview: spec.preview ? { last: days[days.length - 1].date } : null,
    gauge: spec.gauge === "long" ? LONG_GAUGE : "Rain gauge: Chetek, WI weather station, 0.4 mi from Chetek",
  };
}

export function fixedCases() {
  const out = [];
  const add = (s) => out.push({ seed: 3, cmp: "normal", name: "olson", dedication: "short", place: "short", gauge: "short", ...s });
  for (const style of ["r1", "r2"]) {
    for (const data of Object.keys(DATA)) for (const normals of [false, true]) for (const rec of [false, "all"])
      add({ style, data, normals, records: rec, markers: "spread" });
    for (const markers of ["jan1x3", "dec31x3", "adjJan", "adjDec", "wetDay", "near", "sameMid", "unlabeled", "two", "none"])
      for (const data of ["usual", "wet", "dry"]) for (const rec of [false, "all"]) add({ style, data, normals: true, records: rec, markers });
    for (const rec of ["sameMonth", "sameDay", "few"]) for (const data of ["usual", "wet", "snowWinter"]) add({ style, data, normals: true, records: rec, markers: "sameMid" });
    for (const data of ["usual", "wetSpring", "gaps"]) for (const preview of [40, 150, 283]) add({ style, data, preview, normals: true, records: false, markers: "spread" });
    for (const data of ["usual", "wet"]) add({ style, data, normals: true, records: "all", markers: "adjJan", place: "long", name: "long", dedication: "long", gauge: "long", serial: true });
    for (const data of ["usual", "dry"]) add({ style, data, normals: false, records: "all", markers: "near", cmp: "none", name: "none", dedication: "none" });
    for (const data of ["usual", "gaps"]) add({ style, data, normals: true, records: "all", markers: "dec31x3", place: "long", name: "none", dedication: "long", gauge: "long" });
  }
  return out;
}
export function fuzzCases(seed, n) {
  const r = rng(seed), pick = (a) => a[Math.floor(r() * a.length)], out = [];
  const names = Object.keys(DATA);
  for (let k = 0; k < n; k++) out.push({
    style: pick(["r1", "r2"]), data: pick(names), seed: 1 + Math.floor(r() * 1000), normals: r() < 0.5, records: pick([false, "all", "random", "sameMonth", "few"]),
    cmp: r() < 0.8 ? "normal" : "none", name: pick(["olson", "long", "none"]), dedication: pick(["short", "long", "none"]), place: pick(["short", "long"]),
    gauge: pick(["short", "long"]), markers: pick(["random", "random", "random", "jan1x3", "dec31x3", "adjJan", "adjDec", "wetDay", "near", "unlabeled"]),
    preview: r() < 0.15 ? 20 + Math.floor(r() * 330) : 0, serial: r() < 0.3,
  });
  return out;
}
export const caseId = (s) => [s.style, s.data, s.seed, s.normals ? "N" : "n", s.records || "r0", s.cmp, s.name, s.dedication, s.place, s.gauge, s.markers, s.preview || 0].join("/");
