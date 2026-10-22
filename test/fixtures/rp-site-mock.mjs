/* The site served from this checkout, and NOAA, the town lookup, the subs
 * worker and Stripe answered with made-up data, for the Rain Print order
 * browser tests (test/rp-order.test.mjs, test/rp-buyer-email.test.mjs). */
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { stripePage } from "./rp-checkout.mjs";

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function yearDays(y) { const a = []; for (let t = Date.UTC(y, 0, 1); new Date(t).getUTCFullYear() === y; t += 864e5) a.push(new Date(t).toISOString().slice(0, 10)); return a; }
function series(y, upto) {
  const r = rng(7 + y);
  return yearDays(y).map((d, i) => {
    if (d > upto) return [d, "M", "M", "M", "M", "M"];
    const u = r(), p = u < 0.12 ? (r() * r() * 2).toFixed(2) : u < 0.16 ? "T" : "0.00";
    const t = Math.round(44 + 32 * Math.sin((i - 105) / 365 * 2 * Math.PI));
    return [d, p, String(t), "0.0", String(t + 9), String(t - 9)];
  });
}
/* opts.order: 'ok' (the default), 'fail' (503), 'hang' (never answers)
 * opts.worker: the whole subs worker out, as on Oct 21 2026: 'blocked' (every
 *   route answers Cloudflare's 403 phishing page as HTML, with no CORS headers,
 *   so the browser's fetch rejects), 'down' (the connection fails), 'hang'
 *   (never answers). Every call is logged in log.worker.
 * opts.formspree: 'ok' (the default) or 'fail'; posts are logged in log.formspree. */
export const BLOCK_PAGE = "<!DOCTYPE html><html><head><title>Suspected phishing site | Cloudflare</title></head><body><h1>Warning: Suspected Phishing</h1></body></html>";
export async function mocks(ctx, opts, log) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  const upto = "2026-10-09";
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const req = r.request(), u = new URL(req.url());
    if (u.host === "agsist-api.dnilgis.workers.dev" && opts.worker) {
      (log.worker = log.worker || []).push(req.method() + " " + u.pathname);
      if (opts.worker === "hang") return;
      if (opts.worker === "down") return r.abort("connectionrefused");
      return r.fulfill({ status: 403, contentType: "text/html; charset=UTF-8", body: BLOCK_PAGE });
    }
    if (u.host === "formspree.io") {
      const body = req.postData() || "";
      (log.formspree = log.formspree || []).push({ at: Date.now(), body });
      return opts.formspree === "fail" ? r.fulfill({ status: 503, headers: h, body: "x" }) : r.fulfill({ headers: h, json: { ok: true } });
    }
    if (u.host === "agsist-api.dnilgis.workers.dev") {
      if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      if (u.pathname === "/rp-order" && req.method() === "POST") {
        log.order.push({ at: Date.now(), body: JSON.parse(req.postData()), stripeBefore: log.stripe.length });
        if (opts.order === "hang") return;   // never answered
        return opts.order === "fail" ? r.fulfill({ status: 503, headers: h, body: "x" }) : r.fulfill({ headers: h, json: { ok: true } });
      }
      if (u.pathname === "/rp-short" && req.method() === "POST") return r.fulfill({ headers: h, json: { ok: true, id: "K7Q2M" } });
      return r.fulfill({ status: 503, headers: h, body: "x" });
    }
    if (u.host === "buy.stripe.com") { log.stripeAt = Date.now(); return stripePage(r, log.stripe); }
    if (u.host === "geocoding-api.open-meteo.com") return r.fulfill({ json: { results: [{ name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin", country_code: "US" }] } });
    if (u.host === "data.rcc-acis.org") {
      if (u.pathname === "/StnMeta") return r.fulfill({ json: { meta: [{ name: "CHETEK", sids: ["471667 2"], ll: [-91.65, 45.32], valid_daterange: [["1950-01-01", upto]], state: "WI" }] } });
      let sdate = u.searchParams.get("sdate"), normal = false;
      if (u.searchParams.get("params")) { sdate = JSON.parse(u.searchParams.get("params")).sdate; normal = true; }
      if (normal) return r.fulfill({ json: { data: yearDays(+String(sdate).slice(0, 4)).map((d) => [d, "0.08"]) } });
      if (sdate === "por") { let data = []; for (let y = 1995; y <= 2025; y++) data = data.concat(series(y, upto).map((x) => x.slice(0, 3))); return r.fulfill({ json: { data } }); }
      return r.fulfill({ json: { meta: { name: "CHETEK", state: "WI", ll: [-91.65, 45.32] }, data: series(+String(sdate).slice(0, 4), upto) } });
    }
    return r.abort();
  });
}
export function serve(ROOT) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png" };
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
