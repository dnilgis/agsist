/* A made-up year at Chetek, WI, shaped like RCC-ACIS StnData answers, for the
 * "Watch your year draw" tests (test/rain-print-draw.test.mjs) and the design
 * shots. NOT REAL WEATHER: the sandbox cannot reach NOAA, so the days come
 * from a seeded random walk on Chetek-like monthly normals, with snow in the
 * cold months and a summer of temperatures. "dry" makes a hot, dry year.
 * Nothing here is ever published as data.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const MON_IN = [0.95, 0.85, 1.7, 3.0, 3.8, 4.6, 4.2, 4.3, 3.6, 2.4, 1.6, 1.0];   // a Chetek-like usual year, made up
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function yearDays(y) { const a = []; for (let t = Date.UTC(y, 0, 1); new Date(t).getUTCFullYear() === y; t += 864e5) a.push(new Date(t).toISOString().slice(0, 10)); return a; }
const mdays = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/* rows [date, pcpn, avgt, snow, maxt, mint], as the engine asks (elems pcpn,avgt,snow,maxt,mint) */
export function standInYear(y, kind = "wet") {
  const r = rng(1000 + y + (kind === "dry" ? 77 : 0)), dry = kind === "dry";
  return yearDays(y).map((d, i) => {
    const m = +d.slice(5, 7) - 1, dd = +d.slice(8, 10);
    const warm = 44 + 30 * Math.sin((i - 105) / 365 * 2 * Math.PI) + (dry && m >= 5 && m <= 7 ? 7 : 0) + (r() - 0.5) * 14;
    const hi = Math.round(warm + 9 + r() * 4), lo = Math.round(warm - 9 - r() * 4), avg = Math.round((hi + lo) / 2);
    const pWet = (dry ? 0.16 : 0.27) * (m >= 4 && m <= 8 ? 1.1 : 0.9);
    let p = "0.00", s = "0.0";
    if (r() < pWet) {
      const mean = MON_IN[m] / (mdays(y, m) * pWet) * (dry ? 0.55 : 1.05);
      let v = -Math.log(1 - r()) * mean;
      if (y === 1982 && m === 6 && dd === 18 && !dry) v = 2.86;   // one big storm, so the beat shows
      v = Math.max(0.01, Math.min(4.5, v));
      p = v.toFixed(2);
      if (avg < 31) s = (v * (9 + r() * 6)).toFixed(1);
    } else if (r() < 0.05) p = "T";
    if (y === 1982 && !dry && m === 3 && dd === 1) { p = "0.42"; s = "0.0"; }   // rain on moving-in day
    return [d, p, String(avg), s, String(hi), String(lo)];
  });
}
export function normalRows(y) { return yearDays(y).map((d) => [d, (MON_IN[+d.slice(5, 7) - 1] / mdays(y, +d.slice(5, 7) - 1)).toFixed(3)]); }
/* made-up daily normal highs and lows (the same smooth curve standInYear wanders around), as ACIS answers maxt/mint normal "91" */
export function tempNormalRows(y) { return yearDays(y).map((d, i) => { const b = 44 + 30 * Math.sin((i - 105) / 365 * 2 * Math.PI); return [d, (b + 11).toFixed(1), (b - 11).toFixed(1)]; }); }
export function porRows(y0, y1) { let a = []; for (let y = y0; y <= y1; y++) a = a.concat(standInYear(y, y % 7 === 3 ? "dry" : "wet").map((x) => x.slice(0, 4))); return a; }

export const CHETEK = { name: "CHETEK", sids: ["471667 2"], ll: [-91.65, 45.32], valid_daterange: [["1893-01-01", "2026-10-09"], ["1893-01-01", "2026-10-09"]], state: "WI" };
export const GEO = [{ name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin", admin2: "Barron", country_code: "US" }];

/* opts: {kind: 'wet'|'dry', wind: an Open-Meteo answer or null (refused), log: []} */
export async function mocks(ctx, opts = {}) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = new URL(r.request().url());
    if (opts.log) opts.log.push(u.host + u.pathname);
    if (u.host === "geocoding-api.open-meteo.com") return r.fulfill({ headers: h, json: { results: GEO } });
    if (u.host === "archive-api.open-meteo.com") return opts.wind ? r.fulfill({ headers: h, json: opts.wind(u) }) : r.fulfill({ status: 503, headers: h, body: "x" });
    if (u.host === "data.rcc-acis.org") {
      if (u.pathname === "/StnMeta") return r.fulfill({ headers: h, json: { meta: [CHETEK] } });
      let sdate = u.searchParams.get("sdate"), normal = false;
      if (u.searchParams.get("params")) { const P = JSON.parse(u.searchParams.get("params")); sdate = P.sdate; normal = true; if (P.elems.some((e) => e.name === "maxt")) return r.fulfill({ headers: h, json: { data: tempNormalRows(+String(sdate).slice(0, 4)) } }); }
      if (normal) return r.fulfill({ headers: h, json: { data: normalRows(+String(sdate).slice(0, 4)) } });
      if (sdate === "por") return r.fulfill({ headers: h, json: { data: porRows(1960, 2025) } });
      const y = +String(sdate).slice(0, 4);
      return r.fulfill({ headers: h, json: { meta: { name: CHETEK.name, state: "WI", ll: CHETEK.ll }, data: standInYear(y, opts.kind || "wet") } });
    }
    if (u.host === "agsist-api.dnilgis.workers.dev") return r.fulfill({ status: 503, headers: h, body: "x" });
    return r.abort();
  });
}
export function windAnswer(u) {
  const s = u.searchParams.get("start_date"), e = u.searchParams.get("end_date"), time = [];
  for (let t = Date.parse(s + "T00:00:00Z"); t <= Date.parse(e + "T00:00:00Z"); t += 864e5) time.push(new Date(t).toISOString().slice(0, 10));
  const r = rng(5);
  const g = time.map((d) => +(18 + r() * 22 + (d.endsWith("-06-29") ? 30 : 0)).toFixed(1));
  return { daily_units: { wind_gusts_10m_max: "mp/h" }, daily: { time, wind_gusts_10m_max: g, wind_speed_10m_max: g.map((x) => +(x * 0.55).toFixed(1)) } };
}

export function serve(ROOT) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    let p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
    if (!extname(p) && existsSync(p + ".html")) p += ".html";
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
