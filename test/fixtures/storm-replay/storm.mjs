/* A made-up storm for the storm replay tests. Nothing here is a real event.
 *
 * The field sits near Chetek, Wisconsin. A storm cell crosses it from the
 * southwest on the evening of Tue Jul 14, 2026 (Central daylight time), core
 * over the field about 10 PM. The page clock is frozen at 7:12 AM Wed, so the
 * 24-hour replay runs 7 AM Tue to 7 AM Wed.
 *
 * Every source the replay reads is answered from here: radar tiles and
 * lightning maps (small PNGs drawn on request), NOAA's capability documents,
 * the lightning reading at the field, NWS hail reports, our hourly hail file,
 * and the radar rain file (rain.bin, made by make_rain_fixture.py).
 */
import { deflateSync } from "node:zlib";

export const FIELD = { lat: 45.36, lon: -91.70, label: "ZIP 54728 (Chetek)" };
export const NOW = Date.UTC(2026, 6, 15, 12, 12);          // Wed Jul 15, 7:12 AM CDT
export const END = Date.UTC(2026, 6, 15, 12, 0);           // the replay's newest frame
export const START = END - 24 * 3600e3;
export const CORE = Date.UTC(2026, 6, 15, 3, 0);           // the core over the field, 10 PM CDT
const H = 3600e3, MIN = 60e3;

/* ---------- the storm ---------- */
// moves northeast about 35 mph
function center(t) {
  const h = (t - CORE) / H;
  return { lat: FIELD.lat + h * 0.28, lon: FIELD.lon + h * 0.52 };
}
function km(lat1, lon1, lat2, lon2) {
  const kx = 111.2 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * 111.2);
}
function life(t) { // grows from 7 PM, strongest 9:30 to 11, gone by 3 AM
  const h = (t - CORE) / H;
  if (h < -3 || h > 5) return 0;
  return h < -0.5 ? (h + 3) / 2.5 : h < 1 ? 1 : Math.max(0, 1 - (h - 1) / 4);
}
export function dbz(lat, lon, t) {
  let v = 0;
  const a = life(t);
  if (a > 0) {
    const c = center(t);
    // a core and a long rain shield trailing to the southwest
    const dCore = km(lat, lon, c.lat, c.lon);
    const s = { lat: c.lat - 0.22, lon: c.lon - 0.42 };
    const dx = (lon - s.lon) * 78, dy = (lat - s.lat) * 111.2;
    const along = (dx * 0.88 + dy * 0.47), across = (-dx * 0.47 + dy * 0.88);
    const shield = 34 * Math.exp(-((along / 85) ** 2) - ((across / 30) ** 2));
    const core = 62 * Math.exp(-((dCore / 14) ** 2));
    const ripple = 4 * Math.sin(lat * 37 + lon * 23) * Math.cos(lat * 11 - lon * 17);
    v = Math.max(shield, core) * a + ripple * a;
  }
  // a few light morning showers well south, so the early frames are not empty
  const m = (t - (START + 2 * H)) / H;
  if (m > 0 && m < 4) {
    const d = km(lat, lon, 44.7 + m * 0.05, -92.4 + m * 0.2);
    v = Math.max(v, 26 * Math.exp(-((d / 22) ** 2)) * Math.sin(Math.PI * m / 4));
  }
  return v;
}
/* NOAA lightning density in strikes per km2 per minute x 1000, on an 8 km grid */
export function density(lat, lon, t) {
  const a = life(t);
  if (a <= 0.2) return 0;
  const gl = Math.floor(lat / 0.072) * 0.072 + 0.036, go = Math.floor(lon / 0.1) * 0.1 + 0.05;
  const c = center(t);
  const d = km(gl, go, c.lat, c.lon);
  const v = 15 * a * Math.exp(-((d / 17) ** 2));
  return v < 0.4 ? 0 : Math.round(v * 10) / 10;
}
/* the reading the replay asks for at the field, every 15 minutes */
export function fieldDensity(t) { return density(FIELD.lat, FIELD.lon, t); }
export function lightningTimes() {
  const out = [];
  for (let t = START - 6 * H; t <= END; t += 15 * MIN) out.push(t);
  return out;
}
/* what the caption should say, worked out the long way */
export function expectedStrikes() {
  let s = 0;
  for (const t of lightningTimes()) if (t > START && t <= END) s += fieldDensity(t) * 1e-3 * 15 * 64;
  return Math.round(s);
}

/* ---------- PNG ---------- */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/* ---------- tiles ---------- */
function tileLL(z, x, y, px, py) {
  const n = 256 * 2 ** z, gx = x * 256 + px, gy = y * 256 + py;
  const lon = gx / n * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * gy / n))) * 180 / Math.PI;
  return { lat, lon };
}
const NWS = [[10, [4, 233, 231]], [15, [1, 159, 244]], [20, [3, 0, 244]], [25, [2, 253, 2]], [30, [1, 197, 1]], [35, [0, 142, 0]],
  [40, [253, 248, 2]], [45, [229, 188, 0]], [50, [253, 149, 0]], [55, [253, 0, 0]], [60, [212, 0, 0]], [65, [188, 0, 0]]];
function dbzColor(v) {
  let c = null;
  for (const [lo, rgb] of NWS) if (v >= lo) c = rgb;
  return c;
}
const cache = new Map();
/* NOAA radar mosaic tile, as the Iowa Environmental Mesonet serves it (step 4 px for speed, no smoothing) */
export function radarTile(stampStr, z, x, y) {
  const key = `r${stampStr}/${z}/${x}/${y}`;
  if (cache.has(key)) return cache.get(key);
  const t = Date.UTC(+stampStr.slice(0, 4), +stampStr.slice(4, 6) - 1, +stampStr.slice(6, 8), +stampStr.slice(8, 10), +stampStr.slice(10, 12));
  const S = 256, buf = Buffer.alloc(S * S * 4), step = 2;
  for (let py = 0; py < S; py += step) for (let px = 0; px < S; px += step) {
    const { lat, lon } = tileLL(z, x, y, px + step / 2, py + step / 2);
    const c = dbzColor(dbz(lat, lon, t));
    if (!c) continue;
    for (let yy = py; yy < py + step; yy++) for (let xx = px; xx < px + step; xx++) {
      const i = (yy * S + xx) * 4; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
    }
  }
  const out = png(S, S, buf);
  cache.set(key, out);
  return out;
}
function merc(lat, lon) {
  const R = 6378137;
  return { x: R * lon * Math.PI / 180, y: R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) };
}
function unmerc(x, y) {
  const R = 6378137;
  return { lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI, lon: x / R * 180 / Math.PI };
}
/* nowCOAST lightning density map for a WMS GetMap in EPSG:3857 */
export function lightningMap(bbox, w, h, t) {
  const [x0, y0, x1, y1] = bbox;
  const buf = Buffer.alloc(w * h * 4);
  for (let py = 0; py < h; py += 2) for (let px = 0; px < w; px += 2) {
    const { lat, lon } = unmerc(x0 + (px + 1) / w * (x1 - x0), y1 - (py + 1) / h * (y1 - y0));
    const v = density(lat, lon, t);
    if (!v) continue;
    const k = Math.min(1, v / 10);
    const c = [255, Math.round(250 - 140 * k), Math.round(120 - 110 * k)], a = Math.round(120 + 120 * k);
    for (let yy = py; yy < py + 2 && yy < h; yy++) for (let xx = px; xx < px + 2 && xx < w; xx++) {
      const i = (yy * w + xx) * 4; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = a;
    }
  }
  return png(w, h, buf);
}
/* the USGS map underneath: a quiet stand-in with lakes, roads and a river */
function hash(a, b) { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); }
export function baseTile(z, x, y) {
  const key = `b${z}/${x}/${y}`;
  if (cache.has(key)) return cache.get(key);
  const S = 256, buf = Buffer.alloc(S * S * 4);
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const { lat, lon } = tileLL(z, x, y, px + 0.5, py + 0.5);
    let c = [238, 236, 226];
    // woods and fields
    const n = hash(Math.floor(lat * 40), Math.floor(lon * 30));
    if (n > 0.72) c = [214, 228, 204];
    // lakes
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const ci = Math.floor(lat * 6) + i, cj = Math.floor(lon * 5) + j, hh = hash(ci, cj);
      if (hh > 0.55) {
        const cl = (ci + hash(cj, ci)) / 6, co = (cj + hash(ci + 3, cj)) / 5;
        if (km(lat, lon, cl, co) < 1.2 + hh * 3.5) c = [176, 204, 226];
      }
    }
    // a river
    if (Math.abs(lat - (45.2 + 0.08 * Math.sin(lon * 9))) < 0.006) c = [160, 192, 222];
    // section-line roads every 0.1 deg, a highway
    const fl = Math.abs(lat * 10 - Math.round(lat * 10)), fo = Math.abs(lon * 10 - Math.round(lon * 10));
    if (fl < 0.012 || fo < 0.009) c = [210, 206, 196];
    if (Math.abs(lon + 91.68 + 0.05 * Math.sin(lat * 8)) < 0.004) c = [226, 150, 120];
    const i = (py * S + px) * 4; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
  }
  const out = png(S, S, buf);
  cache.set(key, out);
  return out;
}

/* ---------- NOAA capability documents ---------- */
export function capsXml(layer, times) {
  const list = times.map((t) => new Date(t).toISOString().replace(".000Z", ".000Z")).join(",");
  return `<?xml version="1.0"?><WMS_Capabilities version="1.3.0"><Service><Name>WMS</Name></Service><Capability><Layer><Title>nowCOAST</Title>` +
    `<Layer queryable="1"><Name>${layer}</Name><Title>${layer}</Title><Dimension name="time" default="${new Date(times[times.length - 1]).toISOString()}" units="ISO8601" nearestValue="1">${list}</Dimension></Layer>` +
    `<Layer queryable="1"><Name>other_layer</Name><Dimension name="time" units="ISO8601">2020-01-01T00:00:00Z</Dimension></Layer>` +
    `</Layer></Capability></WMS_Capabilities>`;
}

/* ---------- NWS hail reports (IEM lsr.geojson) ---------- */
function rep(t, lat, lon, mag, city, type = "HAIL") {
  return { type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] },
    properties: { valid: new Date(t).toISOString().slice(0, 19), typetext: type, magnitude: mag, city, st: "WI", remark: "" } };
}
export function lsr() {
  return { type: "FeatureCollection", features: [
    rep(Date.UTC(2026, 6, 15, 2, 42), FIELD.lat + 0.04, FIELD.lon - 0.05, 1.25, "3 NW Chetek"),   // 3.6 mi NW, 9:42 PM
    rep(Date.UTC(2026, 6, 15, 3, 5), FIELD.lat + 0.01, FIELD.lon + 0.12, 1.0, "Cameron"),         // 6 mi E, 10:05 PM
    rep(Date.UTC(2026, 6, 15, 3, 20), FIELD.lat + 0.05, FIELD.lon + 0.02, 60, "2 N Chetek", "TSTM WND GST"),  // wind, not hail
    rep(Date.UTC(2026, 6, 15, 4, 10), FIELD.lat + 0.32, FIELD.lon + 0.55, 1.75, "Bloomer"),       // 33 mi NE: on the map, not in the 10 miles
    rep(Date.UTC(2026, 6, 13, 22, 0), FIELD.lat, FIELD.lon, 2.0, "too early"),                     // before the window
  ] };
}

/* ---------- our hourly radar hail file (data/hail/mesh/hours.json) ---------- */
function ellipse(lat, lon, rLat, rLon, rot) {
  const ring = [];
  for (let k = 0; k <= 32; k++) {
    const a = (k / 32) * 2 * Math.PI, x = Math.cos(a) * rLon, y = Math.sin(a) * rLat;
    ring.push([+(lon + x * Math.cos(rot) - y * Math.sin(rot)).toFixed(3), +(lat + x * Math.sin(rot) + y * Math.cos(rot)).toFixed(3)]);
  }
  ring[ring.length - 1] = ring[0];
  return ring;
}
function band(th, rings, end) {
  return { type: "Feature", properties: { thresh_in: th, mesh_mm_min: +(th * 25.4).toFixed(1), hour_end: end },
    geometry: { type: "MultiPolygon", coordinates: rings.map((r) => [r]) } };
}
export function hours() {
  const hrs = [];
  for (let e = START + H; e <= END; e += H) {
    const end = new Date(e).toISOString().slice(0, 19) + "Z";
    let features = [];
    if (e === Date.UTC(2026, 6, 15, 3)) {           // 9 to 10 PM: the swath reaches the field
      const c = center(e - 0.5 * H);
      features = [band(0.75, [ellipse(c.lat + 0.03, c.lon + 0.02, 0.07, 0.3, 0.48)], end)];
    }
    if (e === Date.UTC(2026, 6, 15, 4)) {           // 10 to 11 PM: 1 in over the field, 1.5 in to the east
      const c = center(e - 0.5 * H);
      features = [band(0.75, [ellipse(c.lat - 0.02, c.lon - 0.12, 0.08, 0.3, 0.48)], end),
                  band(1.0, [ellipse(FIELD.lat + 0.005, FIELD.lon + 0.03, 0.04, 0.12, 0.48)], end),
                  band(1.5, [ellipse(FIELD.lat + 0.06, FIELD.lon + 0.2, 0.02, 0.06, 0.48)], end)];
    }
    if (e === Date.UTC(2026, 6, 15, 5)) {           // 11 PM to midnight: moved off to the northeast
      const c = center(e - 0.5 * H);
      features = [band(0.75, [ellipse(c.lat + 0.02, c.lon + 0.06, 0.06, 0.2, 0.48)], end)];
    }
    hrs.push({ end, features });
  }
  return { meta: { source: "NOAA MRMS MESH 60-minute maximum via Iowa State mtarchive", units_note: "fixture", thresholds_in: [0.75, 1, 1.5, 2],
    hours_kept: 48, generated: new Date(END + 9 * MIN).toISOString().slice(0, 19) + "Z", as_of: hrs[hrs.length - 1].end, missing: [] }, hours: hrs };
}
export const RAIN_IN = 1.2;   // what make_rain_fixture.py puts at the field
