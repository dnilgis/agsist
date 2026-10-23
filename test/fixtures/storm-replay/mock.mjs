/* The storm replay's network, answered from the made-up storm (storm.mjs).
 * serve() serves the repo; mock(page, opts) answers every outside source,
 * and opts can take one down: { radar: 'down', lightning: 'down'|'stale',
 * clouds: 'down', reports: 'down', hours: 'down'|'empty', lightningInfo: 'picture' }. */
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import * as F from "./storm.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HERE = fileURLToPath(new URL("./", import.meta.url));

export function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".bin": "application/octet-stream" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p) && existsSync(join(ROOT, p + ".html"))) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

export async function mock(page, port, opts = {}) {
  const hits = { radar: 0, lightningMap: 0, lightningInfo: 0, caps: 0, lsr: 0, base: 0 };
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers: { "access-control-allow-origin": "*" } });
  await page.route("**/*", async (r) => {
    await new Promise((ok) => setImmediate(ok));   // let the test talk to the browser between tile drawings
    const url = r.request().url();
    const u = new URL(url);
    if (u.host === `127.0.0.1:${port}`) {
      if (u.pathname === "/data/hail/mesh/hours.json") {
        if (opts.hours === "down") return r.fulfill({ status: 404, body: "" });
        // the shape the live job wrote Oct 21-23, 2026: a file, but not one hour in it
        if (opts.hours === "empty") return json(r, { meta: { hours_kept: 48, as_of: null, missing: ["2026-07-15T03:00:00Z"] }, hours: [] });
        return json(r, F.hours());
      }
      if (u.pathname === "/data/radar-rain/index.json") return r.fulfill({ status: 200, contentType: "application/json", body: readFileSync(HERE + "rain-index.json") });
      if (u.pathname === "/data/radar-rain/wi.bin") return r.fulfill({ status: 200, contentType: "application/octet-stream", body: readFileSync(HERE + "rain.bin") });
      return r.continue();
    }
    if (u.host === "mesonet.agron.iastate.edu") {
      const m = /ridge::USCOMP-N0Q-(\d{12})\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(u.pathname);
      if (m) {
        hits.radar++;
        if (opts.radar === "down") return r.fulfill({ status: 503, body: "" });
        return r.fulfill({ status: 200, contentType: "image/png", body: F.radarTile(m[1], +m[2], +m[3], +m[4]), headers: { "cache-control": "max-age=3600" } });
      }
      if (/lsr\.geojson/.test(u.pathname)) {
        hits.lsr++;
        if (opts.reports === "down") return r.fulfill({ status: 503, body: "" });
        return json(r, F.lsr());
      }
      return r.abort();
    }
    if (u.host === "nowcoast.noaa.gov") {
      const q = new URLSearchParams([...u.searchParams].map(([k, v]) => [k.toLowerCase(), v]));
      const req = (q.get("request") || "").toLowerCase();
      const isLightning = /lightning_detection/.test(u.pathname);
      if (!isLightning) return r.fulfill({ status: 503, body: "" });   // the satellite service is down in every test
      if (opts.lightning === "down") return r.fulfill({ status: 503, body: "" });
      if (req === "getcapabilities") {
        hits.caps++;
        let times = F.lightningTimes();
        if (opts.lightning === "stale") times = times.filter((t) => t <= F.END - 3 * 3600e3);
        return r.fulfill({ status: 200, contentType: "text/xml", body: F.capsXml("ldn_lightning_strike_density", times), headers: { "access-control-allow-origin": "*" } });
      }
      const t = Date.parse(q.get("time"));
      if (req === "getmap") {
        hits.lightningMap++;
        const bbox = q.get("bbox").split(",").map(Number), w = +q.get("width"), h = +q.get("height");
        return r.fulfill({ status: 200, contentType: "image/png", body: F.lightningMap(bbox, w, h, t) });
      }
      if (req === "getfeatureinfo") {
        hits.lightningInfo++;
        if (opts.lightningInfo === "picture") return json(r, { features: [{ properties: { RED_BAND: 255, GREEN_BAND: 200, BLUE_BAND: 0 } }] });
        return json(r, { type: "FeatureCollection", features: [{ type: "Feature", properties: { GRAY_INDEX: F.fieldDensity(t) } }] });
      }
      return r.fulfill({ status: 400, body: "" });
    }
    if (u.host === "basemap.nationalmap.gov") {
      const m = /\/tile\/(\d+)\/(\d+)\/(\d+)$/.exec(u.pathname);
      hits.base++;
      if (m) return r.fulfill({ status: 200, contentType: "image/png", body: F.baseTile(+m[1], +m[3], +m[2]), headers: { "cache-control": "max-age=3600" } });
    }
    return r.abort();
  });
  await page.clock.setFixedTime(new Date(F.NOW));
  return hits;
}

export function shareQuery(over = {}) {
  const v = Object.assign({ lat: F.FIELD.lat, lon: F.FIELD.lon, label: F.FIELD.label, h: 24, e: "202607151200", f: "202607150315", ly: "rlsp" }, over);
  return `?sr=1&la=${v.lat.toFixed(4)}&lo=${v.lon.toFixed(4)}&n=${encodeURIComponent(v.label)}&h=${v.h}&e=${v.e}&f=${v.f}&ly=${v.ly}`;
}
