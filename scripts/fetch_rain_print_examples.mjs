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
 * nothing), then the station's full period of record (StnData por) through
 * the engine's own stationExtremes(). That is the same chain, with the same
 * URLs, the page runs for a story link, which opens with the 30-year normal
 * and the remarkable days on (2026-10-15): the remarkable days read the year's
 * temperatures (already in the year's StnData call) and rank the year against
 * the full record. fetch() is wrapped so every request and its answer are
 * kept as they came back.
 *
 * The full record is often 50,000 days, so it is saved packed
 * (scripts/rain_print_examples_pack.mjs: each column gzipped, about 3 bytes a
 * day) and given back exactly as NOAA sent it.
 *
 * Writes data/rain-print-examples/<slug>.json:
 *   { slug, link, place, year, cmp, fetched (YYYY-MM-DD, UTC), fetched_at,
 *     source, station (the sid the engine picked), days (recorded days),
 *     por_days (days in the station's full record),
 *     requests: [{ url, status, body } or { url, status, pack }] }
 *   body: the parsed JSON answer; pack: the full record, packed
 * A replay serves answerOf(requests[i]) for requests[i].url.
 *
 * WHAT A RUN SAYS. The job log can't always be read, so every result is also
 * a GitHub annotation: one ::notice per example listing each request it made
 * (status and URL; one notice, not one per request, because GitHub keeps only
 * 10 notices a step), and an ::error with the exact reason, URL and status for
 * anything that fails. A failed example is tried 3 times with a fresh engine.
 * The only things changed from a browser's requests are a User-Agent header
 * naming agsist.com and a longer wait: the engine's 15 s give-up timer is
 * stretched to 60 s here, since a runner far from NOAA can be slower than a
 * reader. Neither changes a URL or an answer.
 *
 *   node scripts/fetch_rain_print_examples.mjs           fetch both, write files
 *   node scripts/fetch_rain_print_examples.mjs --check   check the saved files (offline)
 */
import { readFileSync, writeFileSync, writeSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { pack, answerOf } from "./rain_print_examples_pack.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT_DIR = ROOT + "data/rain-print-examples/";
const UA = "agsist.com rain print examples (https://agsist.com/rain-print; by hand)";
const TRIES = 3;
const WAIT_MS = Number(process.env.RPEX_WAIT_MS) || 20000;   // pause before a retry, times the try number

// Output goes out synchronously, so nothing is lost when the process exits.
const out = (line) => writeSync(1, line + "\n");
const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const annotate = (kind, msg) => out("::" + kind + " title=rain print examples::" + esc(msg));
const errMsg = (e) => (e && (e.message || String(e))) + (e && e.cause ? " (cause: " + (e.cause.code || e.cause.message || e.cause) + ")" : "");

// The example links, read from the page itself so they can't drift apart.
function examples() {
  const html = readFileSync(ROOT + "rain-print.html", "utf8");
  const list = [];
  for (const m of html.matchAll(/<a class="rp-story" href="([^"]+)"/g)) {
    const link = m[1].replace(/&amp;/g, "&");
    const q = new URLSearchParams(link.split("?")[1] || "");
    const place = q.get("place"), year = parseInt(q.get("year"), 10), cmp = q.get("cmp") || "";
    if (!place || !year) throw new Error("example link without a place or year: " + link);
    const slug = (year + "-" + place).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    list.push({ slug, link, place, year, cmp, query: link.split("?")[1] || "" });
  }
  if (list.length < 2) throw new Error("expected the two example links in rain-print.html, found " + list.length);
  return list;
}

// The shipped engine in a sandbox whose fetch keeps every answer.
function engine(log) {
  const recFetch = async (url, opts) => {
    url = String(url);
    const o = Object.assign({}, opts || {}, { headers: { "User-Agent": UA, Accept: "application/json" } });
    let r, text;
    try {
      r = await fetch(url, o);
      text = await r.text();
    } catch (e) {
      log.push({ url, status: 0, body: null, error: errMsg(e) });
      throw e;
    }
    let body = null;
    try { body = JSON.parse(text); } catch (e) { body = null; }
    const row = { url, status: r.status, body };
    if (body === null) row.snippet = text.slice(0, 200);
    log.push(row);
    return new Response(text, { status: r.status, headers: { "content-type": "application/json" } });
  };
  // the engine gives up on a request after 15 s; a runner gets 60 s
  const slowTimeout = (fn, ms, ...a) => setTimeout(fn, ms >= 15000 ? ms * 4 : ms, ...a);
  const ctx = { TextEncoder, TextDecoder, URLSearchParams, URL, btoa, atob, fetch: recFetch, Response,
    AbortController, setTimeout: slowTimeout, clearTimeout, console, Intl };
  ctx.window = ctx;
  vm.runInNewContext(readFileSync(ROOT + "components/rain-print.js", "utf8"), ctx);
  if (!ctx.RainPrint || typeof ctx.RainPrint.previewArt !== "function") throw new Error("components/rain-print.js loaded without RainPrint.previewArt");
  // previewArt only checks the drawing script is there; no art is made here.
  ctx.AgRainArt = { render: () => "", INK: "#000" };
  return ctx.RainPrint;
}

const isGeo = (u) => u.startsWith("https://geocoding-api.open-meteo.com/");
const isPor = (u) => u.startsWith("https://data.rcc-acis.org/StnData?") && new URL(u).searchParams.get("sdate") === "por";
function reqLine(q) {
  let s = q.status + " " + q.url;
  if (q.error) s += " (network: " + q.error + ")";
  else if (q.body === null) s += " (not JSON: " + JSON.stringify(q.snippet || "") + ")";
  else if (q.body.error) s += " (answer error: " + JSON.stringify(q.body.error) + ")";
  else if (q.body.reason) s += " (reason: " + JSON.stringify(q.body.reason) + ")";
  else if (Array.isArray(q.body.data)) s += " (" + q.body.data.length + " rows)";
  else if (Array.isArray(q.body.meta)) s += " (" + q.body.meta.length + " stations)";
  else if (isGeo(q.url)) s += " (" + (Array.isArray(q.body.results) ? q.body.results.length : 0) + " places)";
  return s;
}

// Why a run failed, in words: the engine's own message, plus what the answers show.
function diagnose(RP, ex, log, e) {
  const why = [errMsg(e)];
  const geo = log.filter((q) => isGeo(q.url)).pop();
  if (!geo) why.push("no town lookup was made");
  else if (geo.status === 200 && geo.body) {
    const res = Array.isArray(geo.body.results) ? geo.body.results : [];
    const g = RP.geoPick(ex.place, res);
    const where = (x) => x.name + ", " + (x.admin1 || "?") + " (" + x.latitude + ", " + x.longitude + ")";
    if (g.error) why.push("town lookup: " + g.error + " Places sent: " + (res.map(where).join("; ") || "none"));
    else if (g.pick) why.push("town lookup: more than one " + ex.place + " far apart, so the page would ask which: " + g.pick.map(where).join("; "));
  }
  for (const q of log) if (q.status !== 200 || q.body === null || q.body.error) why.push("bad answer: " + reqLine(q));
  return why.join(" | ");
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryOne(ex) {
  const log = [];
  let RP = null;
  try {
    RP = engine(log);
    const s = RP.fromParams(ex.query);
    s.station = "";
    const code = RP.encodeCode(s);
    const got = await RP.previewArt(code, { noQr: true });
    if (got.preview) throw new Error("drew as a preview (the year isn't complete at the station), not a finished year: " + got.days + " days");
    // the remarkable days rank the year against the station's full record, which the page asks for next
    const ext = await RP.stationExtremes(got.station);
    if (!ext || !Array.isArray(ext.rows) || !ext.rows.length) throw new Error("NOAA sent no full record for " + got.station);
    // every answer must be a real answer, or a replay could pick another station than a live visit
    for (const q of log) if (q.status !== 200 || q.body === null) throw new Error("a request had no usable answer");
    const now = new Date();
    return { ok: true, log, j: {
      slug: ex.slug, link: ex.link, place: ex.place, year: ex.year, cmp: ex.cmp,
      fetched: now.toISOString().slice(0, 10), fetched_at: now.toISOString(),
      source: "NOAA RCC-ACIS (data.rcc-acis.org) and Open-Meteo geocoding, asked by components/rain-print.js previewArt()",
      station: got.station, days: got.days, por_days: ext.rows.length,
      requests: log.map((q) => {
        const p = isPor(q.url) ? pack(q.body) : null;
        return p ? { url: q.url, status: q.status, pack: p } : { url: q.url, status: q.status, body: q.body };
      }),
    } };
  } catch (e) {
    return { ok: false, log, why: RP ? diagnose(RP, ex, log, e) : errMsg(e) };
  }
}

// Offline check of a saved file. Returns a list of warnings; throws on a fault.
function check(file, ex) {
  const j = JSON.parse(readFileSync(file, "utf8"));
  const bad = (w) => { throw new Error(file.replace(ROOT, "") + ": " + w); };
  const warn = [];
  if (j.slug !== ex.slug || j.year !== ex.year || j.place !== ex.place) bad("doesn't match the page's link " + ex.link);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(j.fetched || "")) bad("no fetch date");
  if (!Array.isArray(j.requests) || !j.requests.length) bad("no requests");
  for (const q of j.requests) if (q.status !== 200 || (q.body === null && !q.pack)) bad(q.url + " has no answer (" + q.status + ")");
  const sidOf = (u) => new URL(u).searchParams.get("sid");
  const usable = (q) => { const b = q && answerOf(q); return !!b && !b.error && (Array.isArray(b.data) || Array.isArray(b.meta) || Array.isArray(b.results)); };
  const last = (f) => j.requests.filter(f).pop();
  if (!usable(last((q) => isGeo(q.url)))) bad("the town lookup found nothing");
  if (j.requests.filter((q) => q.url.startsWith("https://data.rcc-acis.org/StnMeta?")).length !== 2) bad("expected the two station lists");
  if (!usable(last((q) => q.url.includes("StnData?sid=") && !isPor(q.url) && sidOf(q.url) === j.station))) bad("no days for the picked station " + j.station);
  // the remarkable days need the station's full record, reaching the example's year
  const por = last((q) => isPor(q.url) && sidOf(q.url) === j.station);
  if (!usable(por)) bad("no full record for the picked station " + j.station);
  const rows = answerOf(por).data;
  if (rows.length !== j.por_days) bad("the full record has " + rows.length + " days, the file says " + j.por_days);
  if (String(rows[rows.length - 1][0]).slice(0, 4) < String(j.year)) bad("the full record ends before " + j.year);
  // no normal is not a fault: the page draws without one too, and says so
  const norm = last((q) => q.url.includes("StnData?params=") && decodeURIComponent(q.url).includes('"sid":"' + j.station + '"'));
  if (!norm) warn.push(ex.slug + ": no 30-year normal was asked for " + j.station);
  else if (!usable(norm)) warn.push(ex.slug + ": NOAA has no 30-year normal for " + j.station + ", so the example draws without one, as the page would");
  return { j, warn };
}

async function main() {
  const exs = examples();
  if (process.argv.includes("--check")) {
    let failed = 0;
    for (const ex of exs) {
      const f = OUT_DIR + ex.slug + ".json";
      try {
        if (!existsSync(f)) throw new Error("missing data/rain-print-examples/" + ex.slug + ".json");
        const { j, warn } = check(f, ex);
        warn.forEach((w) => annotate("warning", w));
        out(ex.slug + ": ok, station " + j.station + ", " + j.days + " days, full record " + j.por_days + " days, " + j.requests.length + " requests, fetched " + j.fetched);
      } catch (e) { failed++; annotate("error", "check: " + errMsg(e)); }
    }
    return failed;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  let failed = 0;
  for (const ex of exs) {
    let done = false;
    for (let t = 1; t <= TRIES && !done; t++) {
      const r = await tryOne(ex);
      const lines = r.log.map(reqLine);
      out(ex.slug + " try " + t + ":\n  " + (lines.join("\n  ") || "(no requests)"));
      if (r.ok) {
        try {
          const f = OUT_DIR + ex.slug + ".json";
          writeFileSync(f, JSON.stringify(r.j) + "\n");
          const { warn } = check(f, ex);
          warn.forEach((w) => annotate("warning", w));
          annotate("notice", ex.slug + " (try " + t + "): station " + r.j.station + ", " + r.j.days + " days, " + lines.length + " requests\n" + lines.join("\n"));
          done = true;
        } catch (e) { r.ok = false; r.why = "saved file failed its check: " + errMsg(e); }
      }
      if (!r.ok) {
        const final = t === TRIES;
        annotate(final ? "error" : "warning", ex.slug + " try " + t + " of " + TRIES + " failed: " + r.why + "\nRequests:\n" + (lines.join("\n") || "(none)"));
        if (!final) await wait(WAIT_MS * t);
      }
    }
    if (!done) failed++;
  }
  return failed;
}

let code = 1;
try { code = (await main()) ? 1 : 0; }
catch (e) { annotate("error", "stopped: " + errMsg(e) + (e && e.stack ? "\n" + e.stack.split("\n").slice(1, 4).join("\n") : "")); }
// the engine's own timeout timers would hold the process open
process.exit(code);
