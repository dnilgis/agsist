#!/usr/bin/env node
/* scripts/fetch_rain_print_examples.mjs: the real NOAA answers behind the two
 * example links on /rain-print (2012 Ames, the drought; 1993 Des Moines, the
 * flood), saved so the page's own code can draw them offline, exactly as it
 * would live.
 *
 * Run by .github/workflows/rain-print-examples.yml (workflow_dispatch only).
 * NOAA's ACIS service (data.rcc-acis.org) can't be reached from the sandbox
 * this was built in; GitHub Actions can.
 *
 * Nothing here asks NOAA on its own. It loads components/rain-print.js, the
 * shipped engine, and runs its previewArt() chain on each example: the
 * Open-Meteo town lookup, the two StnMeta station lists (rain, snowfall),
 * pickStation() with the snow-aware rule reading StnData for each station it
 * tries, and the 30-year normal ("91", then the older code only when "91" has
 * nothing). That is the same chain, in the same order with the same URLs, the
 * page runs for a story link (place, year, cmp=normal, no station, no
 * remarkable days). fetch() is wrapped so every request and its answer are
 * kept as they came back.
 *
 * Left out on purpose: the station's full period of record (StnData por). The
 * page asks for it too, but only the station-average comparison and the
 * remarkable-days layer use it; neither is on for these links, and it is a
 * few megabytes per station.
 *
 * Writes data/rain-print-examples/<slug>.json:
 *   { slug, link, place, year, cmp, fetched (YYYY-MM-DD, UTC), fetched_at,
 *     source, station (the sid the engine picked), days (recorded days),
 *     requests: [{ url, status, body }] }   body: the parsed JSON answer
 * A replay serves requests[i].body for requests[i].url.
 *
 *   node scripts/fetch_rain_print_examples.mjs           fetch both, write files
 *   node scripts/fetch_rain_print_examples.mjs --check   check the saved files (offline)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT_DIR = ROOT + "data/rain-print-examples/";

// The example links, read from the page itself so they can't drift apart.
function examples() {
  const html = readFileSync(ROOT + "rain-print.html", "utf8");
  const out = [];
  for (const m of html.matchAll(/<a class="rp-story" href="([^"]+)"/g)) {
    const link = m[1].replace(/&amp;/g, "&");
    const q = new URLSearchParams(link.split("?")[1] || "");
    const place = q.get("place"), year = parseInt(q.get("year"), 10), cmp = q.get("cmp") || "";
    if (!place || !year) throw new Error("example link without a place or year: " + link);
    const slug = (year + "-" + place).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    out.push({ slug, link, place, year, cmp, query: link.split("?")[1] || "" });
  }
  if (out.length < 2) throw new Error("expected the two example links in rain-print.html, found " + out.length);
  return out;
}

// The shipped engine in a sandbox whose fetch keeps every answer.
function engine(log) {
  const recFetch = async (url, opts) => {
    const r = await fetch(url, opts);
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch (e) { body = null; }
    log.push({ url: String(url), status: r.status, body });
    return new Response(text, { status: r.status, headers: { "content-type": "application/json" } });
  };
  const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob, fetch: recFetch, Response,
    AbortController, setTimeout, clearTimeout, console };
  ctx.window = ctx;
  vm.runInNewContext(readFileSync(ROOT + "components/rain-print.js", "utf8"), ctx);
  if (!ctx.RainPrint || typeof ctx.RainPrint.previewArt !== "function") throw new Error("components/rain-print.js has no previewArt");
  // previewArt only checks the drawing script is there; no art is made here.
  ctx.AgRainArt = { render: () => "", INK: "#000" };
  return ctx.RainPrint;
}

async function fetchOne(ex) {
  const log = [];
  const RP = engine(log);
  const s = RP.fromParams(ex.query);
  s.station = "";
  const code = RP.encodeCode(s);
  const got = await RP.previewArt(code, { noQr: true });
  if (got.preview) throw new Error(ex.slug + ": drew as a preview, not a finished year");
  for (const q of log) if (q.status !== 200 || q.body === null) throw new Error(ex.slug + ": " + q.url + " answered " + q.status + (q.body === null ? " (not JSON)" : ""));
  const now = new Date();
  return {
    slug: ex.slug, link: ex.link, place: ex.place, year: ex.year, cmp: ex.cmp,
    fetched: now.toISOString().slice(0, 10), fetched_at: now.toISOString(),
    source: "NOAA RCC-ACIS (data.rcc-acis.org) and Open-Meteo geocoding, asked by components/rain-print.js previewArt()",
    station: got.station, days: got.days, requests: log,
  };
}

function check(file, ex) {
  const j = JSON.parse(readFileSync(file, "utf8"));
  const bad = (w) => { throw new Error(file + ": " + w); };
  if (j.slug !== ex.slug || j.year !== ex.year || j.place !== ex.place) bad("doesn't match the page's link " + ex.link);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(j.fetched || "")) bad("no fetch date");
  if (!Array.isArray(j.requests) || !j.requests.length) bad("no requests");
  const urls = j.requests.map((q) => q.url);
  if (!urls.some((u) => u.startsWith("https://geocoding-api.open-meteo.com/"))) bad("no town lookup");
  if (urls.filter((u) => u.startsWith("https://data.rcc-acis.org/StnMeta?")).length !== 2) bad("expected the two station lists");
  const sidOf = (u) => new URL(u).searchParams.get("sid");
  if (!urls.some((u) => u.includes("StnData?sid=") && sidOf(u) === j.station)) bad("no daily record for the picked station " + j.station);
  if (!urls.some((u) => u.includes("StnData?params=") && decodeURIComponent(u).includes('"sid":"' + j.station + '"'))) bad("no normal for the picked station");
  for (const q of j.requests) if (q.status !== 200 || q.body === null) bad(q.url + " has no answer");
  // what the print is drawn from must be real data (a "91" normal with nothing is followed by the older code)
  const usable = (q) => q && !q.body.error && (Array.isArray(q.body.data) || Array.isArray(q.body.meta) || Array.isArray(q.body.results));
  const last = (f) => j.requests.filter(f).pop();
  if (!usable(last((q) => q.url.startsWith("https://geocoding-api.open-meteo.com/")))) bad("the town lookup found nothing");
  if (!usable(last((q) => q.url.includes("StnData?sid=") && sidOf(q.url) === j.station))) bad("no days for " + j.station);
  if (!usable(last((q) => q.url.includes("StnData?params=")))) bad("no 30-year normal for " + j.station);
  return j;
}

const exs = examples();
if (process.argv.includes("--check")) {
  for (const ex of exs) {
    const f = OUT_DIR + ex.slug + ".json";
    if (!existsSync(f)) { console.log("missing " + f); process.exitCode = 1; continue; }
    const j = check(f, ex);
    console.log(ex.slug + ": ok, station " + j.station + ", " + j.days + " days, " + j.requests.length + " requests, fetched " + j.fetched);
  }
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  let failed = 0;
  for (const ex of exs) {
    try {
      const j = await fetchOne(ex);
      const f = OUT_DIR + ex.slug + ".json";
      writeFileSync(f, JSON.stringify(j) + "\n");
      check(f, ex);
      console.log(ex.slug + ": station " + j.station + ", " + j.days + " days, " + j.requests.length + " requests");
    } catch (e) {
      failed++;
      console.log(ex.slug + ": FAILED " + (e && e.message || e));
    }
  }
  // the engine's own timeout timers would hold the process open for 15 s
  process.exit(failed ? 1 : 0);
}
