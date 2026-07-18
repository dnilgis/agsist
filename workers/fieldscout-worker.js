/**
 * ═══════════════════════════════════════════════════════════════════════
 * AGSIST Field Scout Worker — the data vault & pipe
 * ═══════════════════════════════════════════════════════════════════════
 * One Cloudflare Worker that does three jobs the browser can't do itself:
 *
 *   1. /ndvi/{z}/{x}/{y}      → Sentinel-2 NDVI crop-vigor tiles (Sentinel Hub).
 *                               Holds the OAuth secret, mints + caches the
 *                               short-lived token, renders the false-color
 *                               vigor tile via the Processing API.
 *   2. /moisture/{z}/{x}/{y}  → Sentinel-1 radar soil-moisture proxy tiles.
 *   3. /soil                  → USDA SSURGO spatial query (fixes browser CORS).
 *   4. /cdl                   → USDA Cropland Data Layer crop history. One ArcGIS
 *                               ImageServer Identify returns this point's crop code
 *                               for every published year; we map codes → names and
 *                               return the rotation most-recent-first.
 *   5. /hail                  → NOAA/IEM hail-swath history GeoJSON proxy.
 *
 * SECRETS (set in Cloudflare dashboard → Worker → Settings → Variables,
 * as ENCRYPTED env vars — never in code, never in the repo):
 *   SH_CLIENT_ID      — Copernicus OAuth client id
 *   SH_CLIENT_SECRET  — Copernicus OAuth client secret
 *
 * The token is cached in module scope between invocations on a warm worker
 * and re-minted ~60s before expiry. Tiles are edge-cached so we don't burn
 * Sentinel Hub processing units re-rendering the same tile for every user.
 *
 * Deploy: wrangler deploy (or paste into a new Worker in the dashboard).
 * Bind a custom route or use the workers.dev URL; point the page's
 * FS_WORKER constant at it.
 * ═══════════════════════════════════════════════════════════════════════
 */

// Build stamp — bump on every paste so /health proves which code is live.
const BUILD = 'fs-2026-07-02a';

const CDSE_TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const SH_PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';
const SH_STATS_URL   = 'https://sh.dataspace.copernicus.eu/api/v1/statistics';

// Multi-index evalscript for the /indices Statistical API call. Each index is its
// own output band, so the API returns mean/min/max/stDev per index, per acquisition,
// with no image download. SCL masks clouds/shadows/snow so a cloudy pass can't fake
// a crop problem. NDVI vigor · NDRE red-edge N · NDMI+NMDI+MSI moisture/stress ·
// NDWI ponding · NDSI snow · BSI bare-soil/residue.
const INDICES_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B03","B04","B05","B08","B11","B12","SCL","dataMask"] }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "ndre", bands: 1, sampleType: "FLOAT32" },
      { id: "ndmi", bands: 1, sampleType: "FLOAT32" },
      { id: "nmdi", bands: 1, sampleType: "FLOAT32" },
      { id: "msi",  bands: 1, sampleType: "FLOAT32" },
      { id: "ndwi", bands: 1, sampleType: "FLOAT32" },
      { id: "ndsi", bands: 1, sampleType: "FLOAT32" },
      { id: "bsi",  bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  var bad = (s.SCL==0||s.SCL==1||s.SCL==3||s.SCL==8||s.SCL==9||s.SCL==10||s.SCL==11);
  var m   = (s.dataMask==1 && !bad) ? 1 : 0;
  var d   = function(a,b){ return (a+b)===0 ? 0 : (a-b)/(a+b); };
  var ndvi = d(s.B08, s.B04);
  var ndre = d(s.B08, s.B05);
  var ndmi = d(s.B08, s.B11);
  var nmdi = (s.B08+(s.B11-s.B12))===0 ? 0 : (s.B08-(s.B11-s.B12))/(s.B08+(s.B11-s.B12));
  var msi  = s.B08===0 ? 0 : s.B11/s.B08;
  var ndwi = d(s.B03, s.B08);
  var ndsi = d(s.B03, s.B11);
  var bsi  = (((s.B11+s.B04)+(s.B08+s.B03))===0) ? 0
             : ((s.B11+s.B04)-(s.B08+s.B03))/((s.B11+s.B04)+(s.B08+s.B03));
  return { ndvi:[ndvi], ndre:[ndre], ndmi:[ndmi], nmdi:[nmdi],
           msi:[msi], ndwi:[ndwi], ndsi:[ndsi], bsi:[bsi], dataMask:[m] };
}`;

// Allow only the AGSIST origins to use this worker (prevents others piggybacking
// on your processing units). Add localhost for local testing.
const ALLOWED_ORIGINS = [
  'https://agsist.com',
  'https://www.agsist.com',
  'http://localhost:8766',
  'http://127.0.0.1:8766',
];

// ── Warm-worker token cache ──────────────────────────────────────────────
let _token = null;        // { access_token, expires_at (ms epoch) }

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : 'https://agsist.com';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      const path = url.pathname.replace(/^\/+/, '');
      const seg = path.split('/');

      if (seg[0] === 'ndvi')     return await tileNDVI(seg, url, env, ctx, cors);
      if (seg[0] === 'moisture') return await tileMoisture(seg, url, env, ctx, cors);
      if (seg[0] === 'soil')     return await proxySoil(request, cors);
      if (seg[0] === 'indices')  return await indicesStats(request, env, ctx, cors);
      if (seg[0] === 'cdl')      return await proxyCDL(url, cors);
      if (seg[0] === 'hail')     return await proxyHail(url, cors);
      if (seg[0] === 'drought')  return await proxyDrought(url, cors);
      if (seg[0] === 'health')   return json({ ok: true, build: BUILD, ts: Date.now() }, cors);

      return json({ error: 'unknown route', routes: ['ndvi','moisture','soil','indices','cdl','hail','drought','health'] }, cors, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, cors, 500);
    }
  },
};

// ── OAuth: client-credentials grant against CDSE, cached & auto-refreshed ──
async function getToken(env) {
  const now = Date.now();
  if (_token && _token.expires_at > now + 60000) return _token.access_token;

  if (!env.SH_CLIENT_ID || !env.SH_CLIENT_SECRET) {
    throw new Error('Worker missing SH_CLIENT_ID / SH_CLIENT_SECRET env vars');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.SH_CLIENT_ID,
    client_secret: env.SH_CLIENT_SECRET,
  });

  const res = await fetchRetry(CDSE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }, 8000);
  if (!res.ok) {
    const t = await res.text();
    throw new Error('CDSE token error ' + res.status + ': ' + t.slice(0, 200));
  }
  const d = await res.json();
  _token = {
    access_token: d.access_token,
    expires_at: now + (d.expires_in || 600) * 1000,
  };
  return _token.access_token;
}

// ── Tile math: XYZ tile → WGS84 bbox ──────────────────────────────────────
function tileBBox(z, x, y) {
  const n = Math.pow(2, z);
  const lon1 = x / n * 360 - 180;
  const lon2 = (x + 1) / n * 360 - 180;
  const lat1 = tile2lat(y, n);
  const lat2 = tile2lat(y + 1, n);
  return [lon1, lat2, lon2, lat1]; // minlon, minlat, maxlon, maxlat
}
function tile2lat(y, n) {
  const r = Math.PI - 2 * Math.PI * y / n;
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(r) - Math.exp(-r)));
}

// ── 1. NDVI crop-vigor tile via Sentinel Hub Processing API ───────────────
// Evalscript renders Sentinel-2 NDVI to a vigor color ramp (bare/red → lush/green),
// transparent where no recent cloud-free data. Most-recent-pixel mosaicking.
async function tileNDVI(seg, url, env, ctx, cors) {
  const z = +seg[1], x = +seg[2], y = +(seg[3] || '').split('.')[0];
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return json({ error: 'bad tile coords' }, cors, 400);
  }
  // Optional ?date=YYYY-MM-DD for the time-scrubber; default = last 30 days to today.
  const qDate = (url.searchParams.get('date') || '').match(/^\d{4}-\d{2}-\d{2}$/) ? url.searchParams.get('date') : null;
  const cacheKey = new Request('https://fs-cache/ndvi/' + z + '/' + x + '/' + y + (qDate ? ('?date=' + qDate) : ''));
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return withCors(hit, cors);

  const token = await getToken(env);
  const bbox = tileBBox(z, x, y);

  const evalscript = `//VERSION=3
function setup() {
  return { input: ["B04","B08","dataMask"], output: { bands: 4 } };
}
function evaluatePixel(s) {
  let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04);
  // vigor ramp: <=0.1 bare(brown) → 0.3 stressed(yellow) → 0.6 good(green) → >=0.8 lush(deep green)
  let r, g, b;
  if (ndvi < 0.1)      { r=0.55; g=0.40; b=0.22; }      // bare / bad
  else if (ndvi < 0.3) { r=0.85; g=0.75; b=0.20; }      // stressed yellow
  else if (ndvi < 0.5) { r=0.55; g=0.78; b=0.25; }      // moderate
  else if (ndvi < 0.7) { r=0.20; g=0.65; b=0.20; }      // good
  else                 { r=0.05; g=0.40; b=0.10; }      // lush
  return [r, g, b, s.dataMask];
}`;

  const to = qDate ? qDate : new Date().toISOString().slice(0,10);
  const fromDate = new Date(new Date(to).getTime() - 30*864e5).toISOString().slice(0,10);

  const payload = {
    input: {
      bounds: { bbox, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
      data: [{
        type: 'sentinel-2-l2a',
        dataFilter: {
          timeRange: { from: fromDate + 'T00:00:00Z', to: to + 'T23:59:59Z' },
          maxCloudCoverage: 40,
          mosaickingOrder: 'mostRecent',
        },
      }],
    },
    output: { width: 256, height: 256, responses: [{ identifier: 'default', format: { type: 'image/png' } }] },
    evalscript,
  };

  const res = await fetchRetry(SH_PROCESS_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Accept': 'image/png',
    },
    body: JSON.stringify(payload),
  }, 15000);
  if (!res.ok) {
    const t = await res.text();
    return json({ error: 'sentinel-hub ' + res.status, detail: t.slice(0, 300) }, cors, 502);
  }
  const buf = await res.arrayBuffer();
  const out = new Response(buf, {
    status: 200,
    headers: Object.assign({}, cors, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400', // 1 day edge cache
    }),
  });
  ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

// ── 2. Soil moisture (Sentinel-1 radar VV backscatter as a wetness proxy) ──
async function tileMoisture(seg, url, env, ctx, cors) {
  const z = +seg[1], x = +seg[2], y = +(seg[3] || '').split('.')[0];
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return json({ error: 'bad tile coords' }, cors, 400);
  }
  const qDate = (url.searchParams.get('date') || '').match(/^\d{4}-\d{2}-\d{2}$/) ? url.searchParams.get('date') : null;
  const cacheKey = new Request('https://fs-cache/moisture/' + z + '/' + x + '/' + y + (qDate ? ('?date=' + qDate) : ''));
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return withCors(hit, cors);

  const token = await getToken(env);
  const bbox = tileBBox(z, x, y);

  // Sentinel-1 VV: higher backscatter ↔ wetter/rougher surface. Render to a
  // dry(tan) → wet(blue) ramp. This is a *relative* wetness read, not absolute %.
  const evalscript = `//VERSION=3
function setup(){ return { input:["VV","dataMask"], output:{ bands:4 } }; }
function evaluatePixel(s){
  let v = Math.max(0, Math.min(1, (s.VV - 0.02) / 0.4)); // normalize typical VV range
  // dry → wet ramp
  let r = 0.78 - 0.62*v, g = 0.68 - 0.18*v, b = 0.45 + 0.45*v;
  return [r, g, b, s.dataMask * 0.85];
}`;

  const to = qDate ? qDate : new Date().toISOString().slice(0,10);
  const fromDate = new Date(new Date(to).getTime() - 21*864e5).toISOString().slice(0,10);

  const payload = {
    input: {
      bounds: { bbox, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
      data: [{
        type: 'sentinel-1-grd',
        dataFilter: { timeRange: { from: fromDate+'T00:00:00Z', to: to+'T23:59:59Z' } },
        processing: { backCoeff: 'GAMMA0_TERRAIN', orthorectify: true },
      }],
    },
    output: { width:256, height:256, responses:[{ identifier:'default', format:{ type:'image/png' } }] },
    evalscript,
  };

  const res = await fetchRetry(SH_PROCESS_URL, {
    method:'POST',
    headers:{ 'Authorization':'Bearer '+token, 'Content-Type':'application/json', 'Accept':'image/png' },
    body: JSON.stringify(payload),
  }, 15000);
  if (!res.ok) {
    const t = await res.text();
    return json({ error:'sentinel-hub s1 '+res.status, detail:t.slice(0,300) }, cors, 502);
  }
  const buf = await res.arrayBuffer();
  const out = new Response(buf, { status:200, headers:Object.assign({}, cors, {
    'Content-Type':'image/png', 'Cache-Control':'public, max-age=86400' }) });
  ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

// ── 3. SSURGO soil spatial query (server-side → no browser CORS wall) ──────
async function proxySoil(request, cors) {
  // The page POSTs { wkt } ; we run the SDA tabular spatial query here.
  let wkt = '';
  try { const b = await request.json(); wkt = b.wkt || ''; } catch (e) {}
  if (!wkt) return json({ error: 'missing wkt' }, cors, 400);
  // Defense-in-depth: the query doubles single-quotes, but also hard-reject anything
  // that isn't a numeric POLYGON so no crafted string can reach the SQL at all.
  if (!/^POLYGON\s*\(\(\s*[-0-9.,\s]+\)\)$/i.test(wkt)) {
    return json({ error: 'bad wkt' }, cors, 400);
  }

  const wktSql = wkt.replace(/'/g, "''");
  // Soil under a polygon doesn't change — cache the SDA answer per polygon for a
  // week so reopening a saved field (or SDA having a bad hour) is a cache hit.
  // v2 namespace: the query gained the drainage column — v1 entries lack it.
  const sk = new Request('https://fs-cache/soil/v2/' + (await sha1(wkt)));
  const sCache = caches.default;
  const sHit = await sCache.match(sk);
  if (sHit) return withCors(sHit, cors);
  // Real per-mapunit acreage requires a spatial intersection of the field polygon
  // with the SSURGO mupolygon geometry. SDA's documented AOI macros do exactly that:
  //   DeclareGeometry → load the field as @aoi
  //   GetClippedMapunits → clip every intersecting mapunit to @aoi (id=mukey, geom=clipped)
  // We then sum each clip's area (geography STArea, m² → acres) per mukey and join
  // the tabular attributes (name, capability class, slope, NCCPI productivity).
  // Column order is contractual with field-scout.js: [areasymbol, musym, muname, ac,
  // nicc, slope_pct, nccpi, nccpi_corn, nccpi_soy, drainage].
  const query =
    "~DeclareGeometry(@aoi)~\n" +
    "SELECT @aoi = geometry::STGeomFromText('" + wktSql + "', 4326)\n" +
    "~DeclareIdGeomTable(@clip)~\n" +
    "~GetClippedMapunits(@aoi,polygon,geo,@clip)~\n" +
    "SELECT l.areasymbol, mu.musym, mu.muname, ROUND(area.ac, 2) AS ac, ma.niccdcd AS nicc," +
    " ( SELECT ROUND(AVG(CAST(c.slope_r AS float)),1) FROM component c" +
    "   WHERE c.mukey=mu.mukey AND c.majcompflag='Yes' ) AS slope_pct," +
    " ( SELECT ROUND(SUM(ci.interphr*c2.comppct_r)/NULLIF(SUM(c2.comppct_r),0),3) FROM component c2 JOIN cointerp ci ON ci.cokey=c2.cokey WHERE c2.mukey=mu.mukey AND ci.ruledepth=0 AND ci.mrulename='NCCPI - National Commodity Crop Productivity Index (Ver 3.0)' AND ci.interphr IS NOT NULL ) AS nccpi," +
    " ( SELECT ROUND(SUM(ci.interphr*c2.comppct_r)/NULLIF(SUM(c2.comppct_r),0),3) FROM component c2 JOIN cointerp ci ON ci.cokey=c2.cokey WHERE c2.mukey=mu.mukey AND ci.ruledepth=0 AND ci.mrulename='NCCPI - NCCPI Corn Submodel (II)' AND ci.interphr IS NOT NULL ) AS nccpi_corn," +
    " ( SELECT ROUND(SUM(ci.interphr*c2.comppct_r)/NULLIF(SUM(c2.comppct_r),0),3) FROM component c2 JOIN cointerp ci ON ci.cokey=c2.cokey WHERE c2.mukey=mu.mukey AND ci.ruledepth=0 AND ci.mrulename='NCCPI - NCCPI Soybeans Submodel (II)' AND ci.interphr IS NOT NULL ) AS nccpi_soy," +
    " ma.drclassdcd AS drainage" +
    " FROM ( SELECT id AS mukey," +
    "        SUM( GEOGRAPHY::STGeomFromWKB(geom.STAsBinary(),4326).STArea() * 0.000247105 ) AS ac" +
    "        FROM @clip GROUP BY id ) area" +
    " INNER JOIN mapunit mu ON mu.mukey=area.mukey" +
    " INNER JOIN legend l ON l.lkey=mu.lkey" +
    " LEFT JOIN muaggatt ma ON ma.mukey=mu.mukey" +
    " ORDER BY ac DESC";

  let res;
  try {
    res = await fetchRetry('https://sdmdataaccess.nrcs.usda.gov/Tabular/post.rest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'JSON', query }),
    }, 12000);
  } catch (e) {
    const aborted = e && e.name === 'AbortError';
    return json({ error: aborted ? 'ssurgo upstream timeout' : 'ssurgo fetch failed', timeout: aborted }, cors, 504);
  }
  if (!res.ok) {
    // Capture SDA's actual complaint (it returns a descriptive message, e.g. an
    // invalid-column error) so a bad query is diagnosable instead of an opaque 502.
    var detail = '';
    try { detail = (await res.text()).slice(0, 800); } catch (e) {}
    return json({ error: 'ssurgo ' + res.status, detail: detail }, cors, 502);
  }
  const d = await res.json();
  const out = new Response(JSON.stringify(d), { status: 200, headers: Object.assign({}, cors,
    { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=604800' }) });
  await sCache.put(sk, out.clone());
  return out;
}

// ── 4. CDL crop history ─────────────────────────────────────────────────────
// USDA's own CroplandCROS ArcGIS ImageServer. A single Identify with
// returnCatalogItems=true hands back this pixel's CDL value for EVERY published
// year (1999–latest) in properties.Values, index-aligned with catalogItems.features
// (each carrying its Year). We zip those, drop NoData, map codes → crop names, and
// return the rotation most-recent-first. JSON-native, server-side reprojection from
// 4326, one fast request — no Albers math, no XML, no five-calls-to-a-flaky-host.
//
// Accepts either an explicit point (?lat=&lon=) or the legacy ?bbox= (centroid used).
// ?years=N (1–15, default 5) sets how many years the `rotation` slice carries;
// `history` always carries everything.
const CDL_IMAGESERVER =
  'https://pdi.scinet.usda.gov/image/rest/services/CDL_WM/ImageServer/identify';

async function proxyCDL(url, cors) {
  let lat = parseFloat(url.searchParams.get('lat'));
  let lon = parseFloat(url.searchParams.get('lon'));

  // Legacy/fallback: a 4326 bbox (minlon,minlat,maxlon,maxlat) → use its centroid.
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    const bb = (url.searchParams.get('bbox') || '').split(',').map(Number);
    if (bb.length === 4 && !bb.some(Number.isNaN)) {
      lon = (bb[0] + bb[2]) / 2;
      lat = (bb[1] + bb[3]) / 2;
    }
  }
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return json({ error: 'need lat & lon (or bbox=minlon,minlat,maxlon,maxlat)' }, cors, 400);
  }

  // How many years the rotation headline carries (history is always everything).
  const nYears = Math.min(15, Math.max(1, parseInt(url.searchParams.get('years'), 10) || 5));

  // CDL for season N publishes ~Feb of N+1 — so the latest year that SHOULD exist
  // is computed, not assumed. This is what keeps the rotation from going stale when
  // any single upstream mosaic lags (the bug that froze the page at 2023).
  const latestExpected = expectedCdlLatest();

  // Edge cache: rotation for a point changes once a year, not per visit.
  // (cdl2 namespace: v1 entries could contain a mis-parsed backfill year — orphaned.)
  const ck = new Request('https://fs-cache/cdl2/' + lat.toFixed(4) + ',' + lon.toFixed(4) + '/' + latestExpected + '/' + nYears);
  const cache = caches.default;
  if (!url.searchParams.get('nocache')) {
    const chit = await cache.match(ck);
    if (chit) return withCors(chit, cors);
  }

  // ── Source 1: pdi ImageServer identify (one call, every year it carries) ──
  let rows = [];
  let pdiErr = null;
  try {
    const geom = encodeURIComponent(JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }));
    const u = CDL_IMAGESERVER
      + '?geometry=' + geom
      + '&geometryType=esriGeometryPoint'
      + '&returnGeometry=false'
      + '&returnCatalogItems=true'
      + '&f=json';
    const res = await fetchRetry(u, {}, 8000);
    if (!res.ok) {
      pdiErr = 'cdl imageserver ' + res.status;
    } else {
      let data = null;
      try { data = JSON.parse(await res.text()); } catch (e) { pdiErr = 'cdl imageserver non-json'; }
      if (data && data.error) {
        pdiErr = 'cdl service error: ' + (data.error.message || String(data.error));
      } else if (data) {
        const vals = (data.properties && data.properties.Values) || [];
        const feats = (data.catalogItems && data.catalogItems.features) || [];
        const n = Math.min(vals.length, feats.length);
        for (let i = 0; i < n; i++) {
          const yr = feats[i] && feats[i].attributes && feats[i].attributes.Year;
          const raw = vals[i];
          if (raw === 'NoData' || raw == null) continue;
          const code = parseInt(raw, 10);
          // 0 = raster background/NoData, 81 = clouds/no data — a placeholder year
          // in the mosaic (e.g. an empty freshly-loaded season) must NOT count as
          // "present", or it blocks the CropScape backfill for that year.
          if (Number.isNaN(code) || !yr || code === 0 || code === 81) continue;
          rows.push({ year: +yr, code, crop: CDL_LEGEND[code] || ('Code ' + code) });
        }
      }
    }
  } catch (e) {
    pdiErr = (e && e.name === 'AbortError') ? 'cdl imageserver timeout' : 'cdl imageserver fetch failed';
  }

  // ── Source 2: NASS CropScape GetCDLValue backfill for any of the 5 headline
  // years the mosaic didn't return (this is where 2024/2025 come from when the
  // pdi mosaic lags). Parallel, per-year fail-soft, Albers via the local helper. ──
  const have = new Set(rows.map((r) => r.year));
  const missing = [];
  for (let y = latestExpected; y > latestExpected - 5; y--) if (!have.has(y)) missing.push(y);
  const fill = {};
  if (missing.length) {
    const filled = await Promise.all(missing.map((y) => cropscapeYear(lat, lon, y)));
    filled.forEach((f, i) => {
      const y = missing[i];
      if (f && f.code) { rows.push(f); fill[y] = 'ok: ' + f.crop + ' (' + f.code + ')'; }
      else fill[y] = (f && f.why) || 'no result';
    });
  }

  rows.sort((a, b) => b.year - a.year); // most-recent first

  if (!rows.length) {
    return json({ error: 'cdl no data at point', detail: pdiErr || undefined, point: { lat, lon } }, cors, 404);
  }

  // byYear gives the page a flat lookup; rotation is the N-yr headline.
  const byYear = {};
  rows.forEach((r) => { byYear[r.year] = { code: r.code, crop: r.crop }; });

  const outObj = {
    source: 'usda-cdl-imageserver' + (missing.length ? '+cropscape' : ''),
    build: BUILD,
    latest_expected: latestExpected,
    pdi: pdiErr || 'ok',
    fill: missing.length ? fill : undefined,
    point: { lat, lon },
    years: rows.map((r) => r.year),
    rotation: rows.slice(0, nYears),
    history: rows,
    byYear,
  };
  const cacheable = new Response(JSON.stringify(outObj), {
    status: 200,
    headers: Object.assign({}, cors, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=604800' }),
  });
  await cache.put(ck, cacheable.clone());
  // Debug requests (?nocache=1) must never stick in the BROWSER either — the
  // edge copy above is stored, but the response handed back is no-store.
  if (url.searchParams.get('nocache')) {
    return new Response(JSON.stringify(outObj), {
      status: 200,
      headers: Object.assign({}, cors, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }),
    });
  }
  return cacheable;
}

// Latest CDL season that should be published: season N releases ~Feb of N+1,
// so from March onward it's last year; in Jan–Feb, the year before that.
function expectedCdlLatest() {
  const d = new Date();
  return d.getUTCMonth() >= 2 ? d.getUTCFullYear() - 1 : d.getUTCFullYear() - 2;
}

// One year's CDL code from NASS CropScape GetCDLValue (needs EPSG:5070 coords —
// exactly what the retained albers5070 helper provides). Robust parse order:
//   1. must contain a <Result> element and no SOAP fault / exception text
//   2. category NAME inside Result, reverse-matched against the legend (names
//      are unambiguous — digits in echoed params like "2025" are not)
//   3. numeric value inside Result, anchored so it can't match "GetCDLValue"
//      or grab digits out of a year, and bounded to real CDL codes (1–254)
// On failure returns { why } so /cdl's fill diagnostics say what happened.
let _cdlNameToCode = null;
function cdlNameToCode(name) {
  if (!_cdlNameToCode) {
    _cdlNameToCode = {};
    for (const k of Object.keys(CDL_LEGEND)) _cdlNameToCode[CDL_LEGEND[k].toLowerCase()] = +k;
  }
  return _cdlNameToCode[String(name).trim().toLowerCase()] || null;
}
async function cropscapeYear(lat, lon, year) {
  try {
    const p = albers5070(lat, lon);
    const u = 'https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLValue'
      + '?year=' + year + '&x=' + p.x.toFixed(1) + '&y=' + p.y.toFixed(1);
    const r = await fetchRetry(u, {}, 6000);
    if (!r.ok) return { why: 'http ' + r.status };
    const t = await r.text();
    if (/faultstring|<soap|exception/i.test(t)) return { why: 'fault: ' + t.replace(/\s+/g, ' ').slice(0, 120) };
    const resM = t.match(/<\s*(?:\w+:)?Result[^>]*>([\s\S]*?)<\s*\/\s*(?:\w+:)?Result\s*>/i);
    if (!resM) return { why: 'no <Result>: ' + t.replace(/\s+/g, ' ').slice(0, 120) };
    const body = resM[1];

    // Prefer the category name — unambiguous.
    const catM = body.match(/category["']?\s*[:=]\s*["']?([A-Za-z][^,"'}<]*)/i);
    if (catM) {
      const code = cdlNameToCode(catM[1]);
      if (code && code !== 81) return { year, code, crop: CDL_LEGEND[code], source: 'cropscape' };
    }
    // Fall back to the numeric value, anchored (non-letter before 'value'),
    // and required to be a known legend class — an unrecognized number on the
    // fallback path is overwhelmingly a parse artifact, not a rare crop.
    const valM = body.match(/(?:^|[^A-Za-z])value["']?\s*[:=]\s*["']?(\d{1,3})\b/i);
    if (valM) {
      const code = parseInt(valM[1], 10);
      if (CDL_LEGEND[code] && code !== 81) {
        return { year, code, crop: CDL_LEGEND[code], source: 'cropscape' };
      }
      return { why: 'unknown/implausible code ' + code + ' in: ' + body.replace(/\s+/g, ' ').slice(0, 120) };
    }
    return { why: 'unparsed Result: ' + body.replace(/\s+/g, ' ').slice(0, 120) };
  } catch (e) {
    return { why: (e && e.name === 'AbortError') ? 'timeout' : 'fetch failed' };
  }
}

// CDL category codes → human-readable names. Covers the common ag classes plus the
// non-ag/developed/water/wetland codes you'll see on field edges. Unknown codes fall
// back to "Code N" in proxyCDL.
const CDL_LEGEND = {
  1: 'Corn', 2: 'Cotton', 3: 'Rice', 4: 'Sorghum', 5: 'Soybeans', 6: 'Sunflower',
  10: 'Peanuts', 11: 'Tobacco', 12: 'Sweet Corn', 13: 'Pop or Orn Corn', 14: 'Mint',
  21: 'Barley', 22: 'Durum Wheat', 23: 'Spring Wheat', 24: 'Winter Wheat',
  25: 'Other Small Grains', 26: 'Dbl Crop WinWht/Soybeans', 27: 'Rye', 28: 'Oats',
  29: 'Millet', 30: 'Speltz', 31: 'Canola', 32: 'Flaxseed', 33: 'Safflower',
  34: 'Rape Seed', 35: 'Mustard', 36: 'Alfalfa', 37: 'Other Hay/Non Alfalfa',
  38: 'Camelina', 39: 'Buckwheat', 41: 'Sugarbeets', 42: 'Dry Beans', 43: 'Potatoes',
  44: 'Other Crops', 45: 'Sugarcane', 46: 'Sweet Potatoes', 47: 'Misc Vegs & Fruits',
  48: 'Watermelons', 49: 'Onions', 50: 'Cucumbers', 51: 'Chick Peas', 52: 'Lentils',
  53: 'Peas', 54: 'Tomatoes', 55: 'Caneberries', 56: 'Hops', 57: 'Herbs',
  58: 'Clover/Wildflowers', 59: 'Sod/Grass Seed', 60: 'Switchgrass',
  61: 'Fallow/Idle Cropland', 63: 'Forest', 64: 'Shrubland', 65: 'Barren',
  66: 'Cherries', 67: 'Peaches', 68: 'Apples', 69: 'Grapes', 70: 'Christmas Trees',
  71: 'Other Tree Crops', 72: 'Citrus', 74: 'Pecans', 75: 'Almonds', 76: 'Walnuts',
  77: 'Pears', 81: 'Clouds/No Data', 82: 'Developed', 83: 'Water', 87: 'Wetlands',
  88: 'Nonag/Undefined', 92: 'Aquaculture', 111: 'Open Water',
  112: 'Perennial Ice/Snow', 121: 'Developed/Open Space', 122: 'Developed/Low Intensity',
  123: 'Developed/Med Intensity', 124: 'Developed/High Intensity', 131: 'Barren',
  141: 'Deciduous Forest', 142: 'Evergreen Forest', 143: 'Mixed Forest',
  152: 'Shrubland', 176: 'Grassland/Pasture', 190: 'Woody Wetlands',
  195: 'Herbaceous Wetlands', 204: 'Pistachios', 205: 'Triticale', 206: 'Carrots',
  207: 'Asparagus', 208: 'Garlic', 209: 'Cantaloupes', 210: 'Prunes', 211: 'Olives',
  212: 'Oranges', 213: 'Honeydew Melons', 214: 'Broccoli', 215: 'Avocados',
  216: 'Peppers', 217: 'Pomegranates', 218: 'Nectarines', 219: 'Greens', 220: 'Plums',
  221: 'Strawberries', 222: 'Squash', 223: 'Apricots', 224: 'Vetch',
  225: 'Dbl Crop WinWht/Corn', 226: 'Dbl Crop Oats/Corn', 227: 'Lettuce',
  228: 'Dbl Crop Triticale/Corn', 229: 'Pumpkins', 230: 'Dbl Crop Lettuce/Durum Wht',
  231: 'Dbl Crop Lettuce/Cantaloupe', 232: 'Dbl Crop Lettuce/Cotton',
  233: 'Dbl Crop Lettuce/Barley', 234: 'Dbl Crop Durum Wht/Sorghum',
  235: 'Dbl Crop Barley/Sorghum', 236: 'Dbl Crop WinWht/Sorghum',
  237: 'Dbl Crop Barley/Corn', 238: 'Dbl Crop WinWht/Cotton',
  239: 'Dbl Crop Soybeans/Cotton', 240: 'Dbl Crop Soybeans/Oats',
  241: 'Dbl Crop Corn/Soybeans', 242: 'Blueberries', 243: 'Cabbage',
  244: 'Cauliflower', 245: 'Celery', 246: 'Radishes', 247: 'Turnips', 248: 'Eggplants',
  249: 'Gourds', 250: 'Cranberries', 254: 'Dbl Crop Barley/Soybeans',
};

// USGS/Proj-standard CONUS Albers Equal Area (EPSG:5070) forward projection.
// NOTE: no longer used by /cdl (the ImageServer reprojects 4326 server-side).
// Retained as a reference helper in case a future route needs Albers locally.
function albers5070(lat, lon) {
  const d2r = Math.PI / 180;
  const a = 6378137.0, f = 1 / 298.257222101, e2 = f * (2 - f), e = Math.sqrt(e2);
  const lat0 = 23 * d2r, lon0 = -96 * d2r, p1 = 29.5 * d2r, p2 = 45.5 * d2r;
  const phi = lat * d2r, lam = lon * d2r;
  const m = (p) => Math.cos(p) / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  const q = (p) => (1 - e2) * (Math.sin(p) / (1 - e2 * Math.sin(p) ** 2)
    - (1 / (2 * e)) * Math.log((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))));
  const m1 = m(p1), m2 = m(p2), q1 = q(p1), q2 = q(p2), q0 = q(lat0), qp = q(phi);
  const n = (m1 ** 2 - m2 ** 2) / (q2 - q1);
  const C = m1 ** 2 + n * q1;
  const rho0 = a * Math.sqrt(C - n * q0) / n;
  const rho = a * Math.sqrt(C - n * qp) / n;
  const theta = n * (lam - lon0);
  return { x: rho * Math.sin(theta), y: rho0 - rho * Math.cos(theta) };
}

// ── 5. Hail-swath history (Iowa Environmental Mesonet, public, CORS-open-ish) ─
async function proxyHail(url, cors) {
  const lat = url.searchParams.get('lat'), lon = url.searchParams.get('lon');
  const yrs = url.searchParams.get('years') || '5';
  if (!lat || !lon) return json({ error: 'need lat & lon' }, cors, 400);
  // IEM SPC storm-report service: hail reports within a radius, recent N years.
  const u = 'https://mesonet.agron.iastate.edu/geojson/lsr.geojson'
    + '?lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon)
    + '&radius=40&type=H&days=' + (parseInt(yrs, 10) * 365);
  const hk = new Request('https://fs-cache/hail/' + (+lat).toFixed(2) + ',' + (+lon).toFixed(2) + '/' + yrs);
  const hCache = caches.default;
  const hHit = await hCache.match(hk);
  if (hHit) return withCors(hHit, cors);
  let res;
  try {
    res = await fetchRetry(u, {}, 8000);
  } catch (e) {
    const aborted = e && e.name === 'AbortError';
    return json({ error: aborted ? 'hail upstream timeout' : 'hail fetch failed', timeout: aborted }, cors, 504);
  }
  if (!res.ok) return json({ error: 'hail ' + res.status }, cors, 502);
  const d = await res.json();
  const out = new Response(JSON.stringify(d), { status: 200, headers: Object.assign({}, cors,
    { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=43200' }) });
  await hCache.put(hk, out.clone());
  return out;
}

// ── 6. US Drought Monitor point lookup (the USDM endpoint sends NO CORS
// headers, so the browser can't call it directly — proxy it server-side). ──
async function proxyDrought(url, cors) {
  const lat = url.searchParams.get('lat'), lon = url.searchParams.get('lon');
  if (!lat || !lon) return json({ error: 'need lat & lon' }, cors, 400);

  // Drought category changes weekly; cache the answer per point for 6 hours so a
  // flaky upstream can't hammer the page (and corner-drag re-runs are free).
  const dk = new Request('https://fs-cache/drought/' + (+lat).toFixed(3) + ',' + (+lon).toFixed(3));
  const dCache = caches.default;
  const dHit = await dCache.match(dk);
  if (dHit) return withCors(dHit, cors);

  async function ok(obj) {
    const out = new Response(JSON.stringify(obj), { status: 200, headers: Object.assign({}, cors,
      { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=21600' }) });
    await dCache.put(dk, out.clone());
    return out;
  }

  // ── Primary: USDM point service (with UA + retry — anonymous datacenter
  // fetches are exactly what these hosts throttle). ──
  let primaryDetail = '';
  try {
    const u = 'https://droughtmonitor.unl.edu/DmData/GetDroughtSeverityStatisticsByPoint.ashx'
      + '?lon=' + encodeURIComponent(lon) + '&lat=' + encodeURIComponent(lat);
    const res = await fetchRetry(u, { headers: { 'Accept': 'application/json' } }, 6000);
    if (res.ok) {
      const txt = await res.text();
      try { return await ok(JSON.parse(txt)); }
      catch (e) { primaryDetail = 'primary non-json'; }
    } else {
      primaryDetail = 'primary ' + res.status;
    }
  } catch (e) {
    primaryDetail = (e && e.name === 'AbortError') ? 'primary timeout' : 'primary fetch failed';
  }

  // ── Fallback: county-level USDM statistics (lat/lon → county FIPS via the
  // FCC census API, then the documented usdmdataservices county endpoint).
  // County-dominant category is an approximation of the point read — labeled
  // as such — and far more honest than a 502. ──
  try {
    const fb = await droughtCountyFallback(lat, lon);
    if (fb) return await ok(fb);
  } catch (e) {}

  return json({ error: 'drought unavailable', detail: primaryDetail }, cors, 502);
}

async function droughtCountyFallback(lat, lon) {
  const fr = await fetchWithTimeout('https://geo.fcc.gov/api/census/block/find?latitude='
    + encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lon) + '&format=json&showall=false',
    withUA({}), 5000);
  if (!fr.ok) return null;
  const fj = await fr.json();
  const fips = fj && fj.County && fj.County.FIPS;
  if (!fips) return null;

  const end = new Date(), start = new Date(end.getTime() - 14 * 864e5);
  const fmt = (d) => (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '/' + d.getUTCFullYear();
  const du = 'https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent'
    + '?aoi=' + fips + '&startdate=' + encodeURIComponent(fmt(start))
    + '&enddate=' + encodeURIComponent(fmt(end)) + '&statisticsType=1';
  const dr = await fetchWithTimeout(du, withUA({ headers: { 'Accept': 'application/json' } }), 7000);
  if (!dr.ok) return null;
  let arr; try { arr = await dr.json(); } catch (e) { return null; }
  if (!Array.isArray(arr) || !arr.length) return null;

  // Take the most recent map week (ValidStart / MapDate both sort lexicographically).
  let row = arr[0];
  for (const r of arr) {
    const a = String(r.ValidStart || r.MapDate || '');
    const b = String(row.ValidStart || row.MapDate || '');
    if (a > b) row = r;
  }
  // Dominant county category → point-class approximation.
  const cats = ['None', 'D0', 'D1', 'D2', 'D3', 'D4'];
  let cls = -1, bestPct = -1;
  cats.forEach((k, i) => {
    const v = parseFloat(row[k]);
    if (isFinite(v) && v > bestPct) { bestPct = v; cls = i - 1; }
  });
  if (bestPct < 0) return null;
  return { DroughtClass: cls, approx: 'county-dominant', fips,
           mapWeek: row.ValidStart || row.MapDate || null, source: 'usdm-county-statistics' };
}

// ── 7. Copernicus index time-series (Sentinel-2 via Statistical API) ────────
// POST { ring:[[lng,lat],...] } or { geometry:<GeoJSON> } [, from, to]. Returns a
// per-acquisition series of NDVI/NDRE/NDMI/NMDI/MSI/NDWI/NDSI/BSI means (cloud-free
// passes only). No image download → trivial PU cost. Edge-cached by geometry+window.
async function indicesStats(request, env, ctx, cors) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, cors, 400); }

  const geometry = body.geometry || ringToPolygon(body.ring);
  if (!geometry) return json({ error: 'missing geometry/ring' }, cors, 400);

  const today = new Date();
  const isoDay = /^\d{4}-\d{2}-\d{2}$/;
  const to   = isoDay.test(body.to || '')   ? body.to   : today.toISOString().slice(0, 10);
  const from = isoDay.test(body.from || '') ? body.from : (today.getUTCFullYear() + '-04-01');

  // Edge-cache by geometry + window (warm repeat views are free, and bank history).
  const ck = new Request('https://fs-cache/indices/' + (await sha1(JSON.stringify(geometry) + from + to)));
  const cache = caches.default;
  const hit = await cache.match(ck);
  if (hit) return withCors(hit, cors);

  const token = await getToken(env);
  const payload = {
    input: {
      bounds: { geometry, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
      data: [{ type: 'sentinel-2-l2a', dataFilter: { mosaickingOrder: 'leastCC' } }],
    },
    aggregation: {
      timeRange: { from: from + 'T00:00:00Z', to: to + 'T23:59:59Z' },
      aggregationInterval: { of: 'P1D' },   // S2 images a spot ≤1×/day → per-pass
      evalscript: INDICES_EVALSCRIPT,
      resx: 10, resy: 10,
    },
    calculations: { default: {} },
  };

  let res;
  try {
    res = await fetchRetry(SH_STATS_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, 20000);
  } catch (e) {
    const aborted = e && e.name === 'AbortError';
    return json({ error: aborted ? 'indices upstream timeout' : 'indices fetch failed', timeout: aborted }, cors, 504);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 400); } catch (e) {}
    return json({ error: 'statistics ' + res.status, detail }, cors, 502);
  }

  const raw = await res.json();
  const series = shapeIndices(raw);
  let normal = null;
  try { normal = await ndviNormal(geometry, token, to); } catch (e) { normal = null; }
  const outObj = { from, to, series, latest: series.length ? series[series.length - 1] : null, normal };
  const out = new Response(JSON.stringify(outObj), {
    status: 200,
    headers: Object.assign({}, cors, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' }),
  });
  ctx.waitUntil(cache.put(ck, out.clone()));
  return out;
}

// Year-over-year baseline: this field's own NDVI for the same ~3-week window across
// the prior 3 seasons. Gives the current read a reference ("ahead of / behind normal
// for this point in the season"). Fired in parallel; any failure just yields null.
async function ndviNormal(geometry, token, toDateStr) {
  const NDVI_EVAL = '//VERSION=3\n' +
    'function setup(){return{input:[{bands:["B04","B08","SCL","dataMask"]}],output:[{id:"ndvi",bands:1,sampleType:"FLOAT32"},{id:"dataMask",bands:1}]};}\n' +
    'function evaluatePixel(s){var bad=(s.SCL==0||s.SCL==1||s.SCL==3||s.SCL==8||s.SCL==9||s.SCL==10||s.SCL==11);var m=(s.dataMask==1&&!bad)?1:0;var n=(s.B08+s.B04)===0?0:(s.B08-s.B04)/(s.B08+s.B04);return{ndvi:[n],dataMask:[m]};}';
  const to = new Date(toDateStr + 'T00:00:00Z');
  const mm = to.getUTCMonth(), dd = to.getUTCDate(), Y = to.getUTCFullYear();
  async function yearMeans(y) {
    const end = new Date(Date.UTC(y, mm, dd, 23, 59, 59));
    const start = new Date(end.getTime() - 24 * 86400000);
    const body = {
      input: { bounds: { geometry, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
               data: [{ type: 'sentinel-2-l2a', dataFilter: { mosaickingOrder: 'leastCC' } }] },
      aggregation: { timeRange: { from: start.toISOString().slice(0, 19) + 'Z', to: end.toISOString().slice(0, 19) + 'Z' },
                     aggregationInterval: { of: 'P1D' }, evalscript: NDVI_EVAL, resx: 10, resy: 10 },
      calculations: { default: {} },
    };
    let r;
    try {
      r = await fetchRetry(SH_STATS_URL, {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, 12000);
    } catch (e) { return []; }
    if (!r.ok) return [];
    let jr; try { jr = await r.json(); } catch (e) { return []; }
    const bs = (out) => { if (!out || !out.bands) return null; const bk = out.bands.B0 ? 'B0' : Object.keys(out.bands)[0]; return bk ? out.bands[bk].stats : null; };
    const out = [];
    for (const iv of ((jr && jr.data) || [])) {
      const o = iv.outputs || {};
      const ns = bs(o.ndvi);
      if (!ns || !isFinite(ns.mean)) continue;
      const ms = bs(o.dataMask);
      const valid = (ms && isFinite(ms.mean)) ? ms.mean : 1;
      if (valid < 0.2) continue;
      out.push(ns.mean);
    }
    return out;
  }
  const results = await Promise.all([yearMeans(Y - 1), yearMeans(Y - 2), yearMeans(Y - 3)]);
  const vals = [].concat.apply([], results);
  const years = [Y - 1, Y - 2, Y - 3].filter((y, i) => results[i].length > 0);
  if (!vals.length) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { ndvi: Math.round(mean * 1000) / 1000, n: vals.length, years };
}

// [[lng,lat],...] ring → closed GeoJSON Polygon
function ringToPolygon(ring) {
  if (!ring || !ring.length) return null;
  const first = ring[0], last = ring[ring.length - 1];
  const closed = (first[0] === last[0] && first[1] === last[1]) ? ring : ring.concat([first]);
  return { type: 'Polygon', coordinates: [closed] };
}

// Statistical API response → tidy [{date, valid, ndvi, ndre, ...}] (cloud-free passes)
function shapeIndices(raw) {
  const data = (raw && raw.data) || [];
  const keys = ['ndvi','ndre','ndmi','nmdi','msi','ndwi','ndsi','bsi'];
  const r3 = (n) => Math.round(n * 1000) / 1000;
  // Single-band outputs are usually keyed "B0", but don't assume it — fall back
  // to whatever the first band key is. This was the bug: a wrong key + a strict
  // mask gate silently dropped every clear pass.
  const stats = (out) => {
    if (!out || !out.bands) return null;
    const bk = out.bands.B0 ? 'B0' : Object.keys(out.bands)[0];
    return bk ? out.bands[bk].stats : null;
  };
  const out = [];
  for (const iv of data) {
    const o = iv.outputs || {};
    const ns = stats(o.ndvi);
    if (!ns || !isFinite(ns.mean)) continue;          // an interval is real only if NDVI read
    const ms = stats(o.dataMask);
    const valid = (ms && isFinite(ms.mean)) ? ms.mean : 1;
    if (valid < 0.2) continue;                          // skip mostly-cloud passes only
    const row = { date: ((iv.interval && iv.interval.from) || '').slice(0, 10), valid: Math.round(valid * 100) / 100 };
    for (const k of keys) { const st = stats(o[k]); row[k] = (st && isFinite(st.mean)) ? r3(st.mean) : null; }
    row.ndvi_sd = isFinite(ns.stDev) ? r3(ns.stDev) : null;
    if (row.date) out.push(row);
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

async function sha1(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── helpers ────────────────────────────────────────────────────────────────
function json(obj, cors, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({}, cors, { 'Content-Type': 'application/json' }),
  });
}
function withCors(resp, cors) {
  const h = new Headers(resp.headers);
  Object.entries(cors).forEach(([k, v]) => h.set(k, v));
  return new Response(resp.body, { status: resp.status, headers: h });
}

// fetch with an abort timeout so a slow or dead upstream (looking at you, GMU CDL)
// can't leave the worker — and the page — hanging forever. Throws an AbortError
// the caller can distinguish from a normal network failure.
async function fetchWithTimeout(resource, options = {}, ms = 8000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(resource, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

// Polite identification for government/edu upstreams — several of them 403/502
// anonymous datacenter fetches. Costs nothing, unblocks a lot.
const UA = 'AGSIST-FieldScout/1.0 (+https://agsist.com; sig@farmers1st.com)';
function withUA(options = {}) {
  const h = Object.assign({}, options.headers || {});
  if (!h['User-Agent']) h['User-Agent'] = UA;
  return Object.assign({}, options, { headers: h });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetchWithTimeout + one retry on transient failure (429, 5xx, network error,
// or timeout). Non-transient responses (2xx–4xx except 429) return immediately.
// Always identifies itself via UA. Returns the last response on repeated 5xx so
// callers keep their existing status/detail handling.
async function fetchRetry(resource, options = {}, ms = 8000, tries = 2, backoff = 600) {
  let last = null, lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetchWithTimeout(resource, withUA(options), ms);
      if (r.ok || (r.status < 500 && r.status !== 429)) return r;
      last = r;
    } catch (e) {
      lastErr = e;
    }
    if (i < tries - 1) await sleep(backoff * (i + 1));
  }
  if (last) return last;
  throw lastErr || new Error('fetch failed');
}
