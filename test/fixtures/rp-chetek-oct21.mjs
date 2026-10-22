/* Chetek, WI (54728), 2025, as Sig hit it on Oct 21, 2026: the site served from this checkout, NOAA
 * (RCC-ACIS) and the town lookup answered from made-up data in the shape of the live case, and the subs
 * worker blocked the way Cloudflare blocked agsist-subs.dnilgis.workers.dev that day (403, an HTML page,
 * no CORS header). The gauge east of town (US1WIRS0008, the one Sig's page named, 0 full years), Bloomer
 * and Cumberland are where data/rain/wi.json has them from ACIS; the 1.9 SSW gauge and Rice Lake as
 * test/rain-print-snowpick.test.mjs has them. Each year's completeness is made up. For test/rain-print-chetek-oct21.test.mjs. */
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
export const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
export const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
function yearDays(y) { const a = []; for (let t = Date.UTC(y, 0, 1); new Date(t).getUTCFullYear() === y; t += 864e5) a.push(new Date(t).toISOString().slice(0, 10)); return a; }
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function acisRows(y, { snow = "full", missing = 0, seed = 1, upto = "2026-10-18", gapsPerYear = 0 } = {}) {
  const r = rng(seed + y);
  return yearDays(y).map((d, i) => {
    if (d > upto) return [d, "M", "M", "M", "M", "M"];
    const winter = d.slice(5, 7) <= "03" || d.slice(5, 7) >= "11";
    const u = r(), gap = i < missing || (gapsPerYear && i % Math.floor(365 / gapsPerYear) === 5);
    const p = gap ? "M" : u < 0.14 ? (r() * 1.4).toFixed(2) : "0.00";
    const t = Math.round(44 + 32 * Math.sin((i - 105) / 365 * 2 * Math.PI));
    const sn = snow === "none" ? "M" : snow === "holes" && i % 3 ? "M" : winter && p !== "M" && +p > 0 ? (+p * 10).toFixed(1) : "0.0";
    return [d, p, String(t), sn, String(t + 9), String(t - 9)];
  });
}
export const TOWN = { lat: 45.3141, lon: -91.651 };
export const META = [
  { name: "CHETEK 1.9 SSW", sids: ["US1WIBR0002 6"], ll: [-91.66, 45.2867], state: "WI", elev: 1060, valid_daterange: [["2009-05-01", "2026-10-18"]], snow: [], data: { snow: "none" }, por: [2010, 2025, { snow: "none", gapsPerYear: 4 }] },
  { name: "RICE LAKE", sids: ["477113 2"], ll: [-91.7208, 45.4386], state: "WI", elev: 1110, valid_daterange: [["1893-01-01", "2026-10-18"]], snow: ["1893-01-01", "2026-10-18"], data: { snow: "full", missing: 40 }, por: [1960, 2025, {}] },
  { name: "CHETEK 10.6 E", sids: ["US1WIRS0008 6"], ll: [-91.4347, 45.3206], state: "WI", elev: 1150, valid_daterange: [["2011-04-01", "2026-10-18"]], snow: ["2011-04-01", "2026-10-18"], data: { snow: "full" }, por: [2011, 2025, { gapsPerYear: 3 }] },
  { name: "BLOOMER", sids: ["470904 2"], ll: [-91.4866, 45.0908], state: "WI", elev: 1010, valid_daterange: [["1949-01-01", "2026-10-18"]], snow: ["1949-01-01", "2026-10-18"], data: { snow: "full" }, por: [1949, 2025, {}] },
  { name: "CUMBERLAND", sids: ["471923 2"], ll: [-92.0227, 45.5331], state: "WI", elev: 1240, valid_daterange: [["1893-01-01", "2026-10-18"]], snow: ["1893-01-01", "2026-10-18"], data: { snow: "full" }, por: [1950, 2025, {}] },
];
export function serve(ROOT) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4" };
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
export async function mocks(context, { meta = META, worker = "blocked", delay = 0, log = { acis: [], worker: [] } } = {}) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    if (delay && /rcc-acis/.test(r.request().url())) await new Promise((ok) => setTimeout(ok, delay));
    const req = r.request(), u = new URL(req.url());
    if (u.host === "agsist-api.dnilgis.workers.dev") {
      log.worker.push(req.method() + " " + u.pathname);
      if (worker === "blocked") return r.fulfill({ status: 403, contentType: "text/html", body: "<html><body>Suspected phishing</body></html>" });
      const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
      if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      if (u.pathname === "/where") return r.fulfill({ headers: h, json: { ok: true, city: "Chetek", region_code: "WI" } });
      if (u.pathname === "/rp-short") return r.fulfill({ headers: h, json: { ok: true, id: "K7Q2M" } });
      return r.fulfill({ headers: h, json: { ok: true } });
    }
    if (u.host === "geocoding-api.open-meteo.com") return r.fulfill({ json: { results: [{ name: "Chetek", latitude: TOWN.lat, longitude: TOWN.lon, admin1: "Wisconsin", admin2: "Barron", country_code: "US", postcodes: ["54728"] }] } });
    if (u.host === "data.rcc-acis.org") {
      if (u.pathname === "/StnMeta") {
        const snow = u.searchParams.get("elems") === "snow";
        return r.fulfill({ json: { meta: meta.filter((m) => !snow || m.snow.length).map((m) => ({ name: m.name, sids: m.sids, ll: m.ll, state: m.state, elev: m.elev, valid_daterange: [snow ? m.snow : m.valid_daterange[0]] })) } });
      }
      let sid = u.searchParams.get("sid"), sdate = u.searchParams.get("sdate"), normal = false, body = null;
      if (req.method() === "POST") { try { body = JSON.parse(req.postData() || "{}"); } catch (e) { body = null; } }
      if (u.searchParams.get("params")) body = JSON.parse(u.searchParams.get("params"));
      if (body) { sid = body.sid || sid; sdate = body.sdate || sdate; normal = /normal|ly_/.test(JSON.stringify(body.elems || "")); }
      if (normal) { const y = +String(sdate).slice(0, 4); return r.fulfill({ json: { data: yearDays(y).map((d, i) => { const t = Math.round(44 + 32 * Math.sin((i - 105) / 365 * 2 * Math.PI)); return [d, "0.08", String(t + 9), String(t - 9)]; }) } }); }
      const m = meta.find((x) => x.sids[0].split(" ")[0] === String(sid).split(" ")[0]);
      if (!m) return r.fulfill({ json: { error: "no such station" } });
      log.acis.push((sdate === "por" ? "por " : "year ") + m.sids[0]);
      if (sdate === "por") { let data = []; for (let y = m.por[0]; y <= m.por[1]; y++) data = data.concat(acisRows(y, m.por[2]).map((x) => x.slice(0, 3))); return r.fulfill({ json: { data } }); }
      return r.fulfill({ json: { meta: { name: m.name, state: m.state, ll: m.ll }, data: acisRows(+String(sdate).slice(0, 4), m.data) } });
    }
    if (/fonts\.(googleapis|gstatic)\.com/.test(u.host)) return r.abort();
    return r.abort();
  });
  return log;
}
