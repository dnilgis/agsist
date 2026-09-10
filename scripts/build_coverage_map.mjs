#!/usr/bin/env node
/* THE COVERAGE MAP — the roadmap, drawn, and honest about the grey.
 *
 *     node scripts/build_coverage_map.mjs
 *
 * WHAT IT DRAWS, AND WHY THE GREY IS THE POINT
 *
 * dnilgis/bids keeps a directory of every grain elevator it knows about, each
 * with a status:
 *
 *     read     a board we fetch and parse today
 *     stale    a source we have that has not answered recently
 *     down     a source we have that is refusing
 *     known    a real elevator nobody has built a reader for yet
 *
 * THAT LAST LINE IS ONLY TRUE OF A COMPLETE PASS, AND THIS BUILDER USED TO
 * BELIEVE IT UNCONDITIONALLY. directory.json is a snapshot of one fetch pass.
 * bids builds it by joining the elevator list to that pass's index.json, and a
 * source the pass did not reach has no index row, so it comes out as "known" —
 * the same word as an elevator with no reader at all. Over 240 directory
 * builds (2026-09-03 to 09-09) the count of sourced elevators wrongly carrying
 * "known" ran min 0, median 5, max 853. The daily cron read the 2026-09-08
 * 16:41 pass, where it was 336, and published "599 read" for a fleet with 935
 * readers built. Between 13:07 and 13:46 on 09-09, 475 elevators moved from
 * grey to green with nothing changing but which pass was sampled.
 *
 * THE DISCRIMINATOR IS `platform`. It is copied from the source manifest, and
 * the two genuine no-reader populations in build_directory.mjs hard-code it
 * null. Across all 240 builds, zero rows carried status read, stale or down
 * without one. So a platform means a reader exists, whatever this pass says.
 * This builder buckets on that, not on status alone, and an elevator we read
 * is never drawn as one nobody has tried.
 *
 * IT ALSO WAITS FOR A GOOD PASS. Passes land about every ten minutes and 116
 * of those 240 were complete. Rather than publish whichever one the cron
 * happened to hit, this samples a few vintages, keeps the best, and refuses to
 * write at all if the best is still worse than the gate. Yesterday's map beats
 * a fresh undercount.
 *
 * A map that showed only the green would claim national coverage we do not
 * have. Drawing the grey next to it is the whole credibility of the page: it
 * says how much is left, in the same picture, at the same scale. Pro Farmer's
 * crop tour is trusted because it publishes its own error rate; this is the
 * same trade.
 *
 * A PIN IS A PLACE, NOT A RECORD. Most coordinates are ZIP or town centroids,
 * so several elevators legitimately share one point. Grouping first means the
 * map draws ~2.5k points rather than 4.5k, which is the difference between a
 * map that pans on a phone and one that does not.
 *
 * AND A GEOCODE CARRIES HOW IT WAS MADE. Standing rule 45: a ZIP centroid
 * drawn as a street address is the same lie as a made-up number, only quieter.
 * Every place keeps its precision and the page prints it.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.env.DIRECTORY_URL ||
  "https://dnilgis.github.io/bids/data/directory.json";
const OUT = join(ROOT, "data", "elevator-coverage.json");

/* How long to hunt for a good pass. bids rebuilds the directory about every
   ten minutes during the day, so two-minute polling over half an hour sees
   roughly three distinct vintages. It stops the moment one is complete. */
const TRIES     = Number(process.env.COVERAGE_TRIES     || 4);        // distinct vintages
const POLL_MS   = Number(process.env.COVERAGE_POLL_MS   || 120000);   // between fetches
const BUDGET_MS = Number(process.env.COVERAGE_BUDGET_MS || 1800000);  // hard wall clock
/* The gate. A pass missing more than this share of our readers does not get
   published; the reason is printed instead of the number. */
const MAX_MISSING = Number(process.env.COVERAGE_MAX_MISSING || 0.15);

/* A local path may be given instead, so this can be run against a checkout
   without the network. */
async function fetchOnce() {
  if (SRC.startsWith("http")) {
    const r = await fetch(SRC, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`${SRC} returned HTTP ${r.status}`);
    return r.json();
  }
  return JSON.parse(readFileSync(SRC, "utf8"));
}

/* A READER EXISTS IF THE ROW CARRIES A PLATFORM. Every other field on the row
   describes one pass. This one describes the fleet. */
export const hasReader = (e) => !!e.platform;
/* Ours, but this pass returned no verdict for it. That is not "no reader", and
   it is not "not answering" either — we did not ask. */
export const unreported = (e) => hasReader(e) && e.status === "known";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Take the pass with the fewest of our readers missing from it. Vintages are
   deduplicated on `generated`, so a cached response does not burn a try. */
async function bestPass() {
  if (!SRC.startsWith("http")) return { dir: await fetchOnce(), seen: 1 };
  const started = Date.now();
  const vintages = new Set();
  let best = null, lastErr = null;
  while (vintages.size < TRIES && Date.now() - started < BUDGET_MS) {
    let d = null;
    try { d = await fetchOnce(); }
    catch (err) { lastErr = err; console.log("  fetch failed: " + err.message); }
    if (d && !vintages.has(d.generated || "")) {
      vintages.add(d.generated || "");
      const rows = d.elevators || [];
      const readers = rows.filter(hasReader).length;
      const missing = rows.filter(unreported).length;
      console.log(`  pass ${d.generated}: ${readers} readers, ${missing} of them not in it`);
      if (!best || missing < best.missing) best = { dir: d, missing };
      if (missing === 0) break;
    }
    if (vintages.size < TRIES && Date.now() - started < BUDGET_MS) await sleep(POLL_MS);
  }
  if (!best) throw lastErr || new Error("no directory pass could be fetched");
  return { dir: best.dir, seen: vintages.size };
}

/* THE WHOLE COMPUTATION IN ONE FUNCTION SO THE SELFTEST CAN CALL IT. The
   generator owns every statistic; the page owns pixels. A statistic only
   main() can reach is a statistic nobody has checked. */
export function build(dir, opts = {}) {
  const els = dir.elevators || [];
  if (!els.length) throw new Error("the directory carried no elevators — refusing to write an empty map");

  /* THE DISCRIMINATOR HAS TO HOLD OR THE BUCKETING MEANS NOTHING. If a row
     ever reports read, stale or down with no platform, then platform has
     stopped meaning "a reader exists" and this builder is wrong in a way no
     count on the page would show. */
  const orphans = els.filter((e) => !hasReader(e) && e.status !== "known");
  if (orphans.length)
    throw new Error(
      orphans.length + ' row(s) report status "' + orphans[0].status +
      '" with no platform, e.g. ' + orphans[0].id + ". This builder reads platform as " +
      '"a reader exists"; that no longer holds, so the read/known split cannot be ' +
      "trusted. Refusing to write.");

  /* EVERY DRAWN PIN MUST LAND ON DRAWN GROUND.
     The basemap is data/us-states.geo.json in this repository, not a tile
     vendor, so its coverage is finite and knowable — and a pin outside it is a
     dot floating on a void with nothing on the page to say so.

     This is not hypothetical. The network carries three Ontario elevators
     (Addis Grain, Sharedon Farms, Wanstead Farmers Cooperative). All three are
     unplaced today, which is the only reason a US-only outline would not have
     stranded one. Canada is in the file now; this is what notices the next
     time the map and the data disagree about which countries exist.

     Compared against each feature's own bounding BOX with half a degree of
     slack, not against the polygons: the outline is simplified to 20%, so a
     coastal elevator can sit a few kilometres outside its own state's drawn
     edge. That is a rendering artefact, not a stranded pin.

     WHAT A BOX CHECK CANNOT SEE, measured against the three real Ontario
     elevators with Canada removed from the outline:

         Owen Sound   (44.57, -80.94)   caught
         Wanstead     (42.95, -82.05)   MISSED — inside Michigan's box
         Addis Grain  (42.40, -82.18)   MISSED — inside Michigan's and Ohio's

     Michigan's rectangle reaches across Lake Huron into Ontario, so a pin in
     the wrong country can hide inside a right one. This catches a whole region
     going missing, which is the realistic failure; it does not catch a pin a
     few dozen miles across a lake. Point-in-polygon would, at the cost of
     stranding coastal pins on a 20%-simplified outline. Named rather than
     gold-plated. */
  const outline = opts.outline;
  if (outline && outline.features) {
    const PAD = 0.5;
    const boxes = outline.features.map((f) => {
      const g = f.geometry || {};
      const parts = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates || []];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const part of parts) for (const ring of part) for (const [x, y] of ring) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      return { name: (f.properties || {}).name || "?", x0, y0, x1, y1 };
    });
    const inside = (lat, lon) => boxes.some((b) =>
      lon >= b.x0 - PAD && lon <= b.x1 + PAD && lat >= b.y0 - PAD && lat <= b.y1 + PAD);
    const stranded = [];
    for (const e of els) {
      const lat = Number(e.lat), lon = Number(e.lon);
      if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) continue;
      if (!inside(lat, lon))
        stranded.push(`${e.operator || "?"} ${e.location || ""} (${lat.toFixed(2)}, ${lon.toFixed(2)})`);
      if (stranded.length > 5) break;
    }
    if (stranded.length)
      throw new Error(
        `${stranded.length > 5 ? "more than 5" : stranded.length} elevator(s) sit outside ` +
        `every region the basemap draws, e.g. ${stranded[0]}. They would render as pins on ` +
        `empty space. Add the missing country or region to data/us-states.geo.json ` +
        `(build/make_outline.sh) rather than dropping the pin. Refusing to write.`);
  }

  const readers = els.filter(hasReader).length;
  const missing = els.filter(unreported).length;
  const gate = opts.maxMissing == null ? MAX_MISSING : opts.maxMissing;
  if (readers && missing / readers > gate)
    throw new Error(
      `this pass is missing ${missing} of our ${readers} readers ` +
      `(${(100 * missing / readers).toFixed(1)}%, over the ${(100 * gate).toFixed(0)}% gate). ` +
      "directory.json records one fetch pass, and a source absent from it carries no " +
      "verdict either way. Refusing to publish a read count built on a partial pass — " +
      "yesterday's map stands.");

  /* THE THREE COLOURS. `stale` and `down` are OURS and not answering, which is a
     different fact from an elevator nobody has tried yet, and the page says so.
     Collapsing them into grey would hide our own broken readers, which is
     exactly the number worth publishing.

     A sourced elevator this pass did not reach joins them rather than the grey:
     we have a reader for it and no fresh reading, which is what the amber says.
     Putting it in the grey would claim we had never tried, which is false. */
  const bucket = (e) => !hasReader(e) ? "known" : e.status === "read" ? "read" : "quiet";

  /* SIX DECIMAL PLACES IS ABOUT 10cm AND WE DO NOT HAVE THAT.
     Rounding to four (~11m) groups the several elevators that share a town
     centroid onto one pin without pretending the pin is a driveway. */
  const keyOf = (lat, lon) => lat.toFixed(4) + "," + lon.toFixed(4);

  const places = new Map();
  const counts = { read: 0, quiet: 0, known: 0, unplaced: 0 };
  const byState = {};
  const unplacedNames = [];

  for (const e of els) {
    const b = bucket(e);
    counts[b]++;
    const st = e.state || null;
    if (st) {
      byState[st] = byState[st] || { read: 0, quiet: 0, known: 0 };
      byState[st][b]++;
    }
    /* `placed` is a BOOLEAN here; the coordinate sits on the record itself.
       Reading it as an object gave 4,581 unplaced and an empty map — caught
       because the builder prints its own counts and 0 places is obviously
       wrong. */
    const p = { lat: e.lat, lon: e.lon, precision: e.precision };
    const lat = Number(p.lat), lon = Number(p.lon);
    /* 0,0 IS THE ATLANTIC. A record we could not place must not be drawn
       somewhere real — it is counted and named instead. */
    if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) {
      counts.unplaced++;
      if (unplacedNames.length < 60)
        unplacedNames.push([e.operator || "?", e.location || "", st || ""].filter(Boolean).join(" — "));
      continue;
    }
    const k = keyOf(lat, lon);
    let place = places.get(k);
    if (!place) {
      place = { lat: +lat.toFixed(4), lon: +lon.toFixed(4), st: st,
                prec: p.precision || "unknown", at: [] };
      places.set(k, place);
    }
    /* The most precise claim any record at this point can make. A place with one
       street-located elevator and four town-centroid ones is a street point for
       that one and the panel says which. */
    const rank = { street: 3, zip: 2, town: 2, county: 1, unknown: 0 };
    if ((rank[p.precision] || 0) > (rank[place.prec] || 0)) place.prec = p.precision;
    place.at.push([e.operator || "?", e.location || "", b]);
  }

  /* The colour of a pin is the best thing at that point: one green elevator in a
     town of grey ones means we DO read there, and the panel lists the rest. */
  const out = [...places.values()].map((p) => {
    const has = (b) => p.at.some((a) => a[2] === b);
    return {
      y: p.lat, x: p.lon, s: p.st,
      c: has("read") ? "read" : has("quiet") ? "quiet" : "known",
      p: p.prec,
      n: p.at.length,
      /* Cap the list a single pin carries. Forty operators on one point is a
         geocode problem, not a panel; the count stays honest either way. */
      a: p.at.slice(0, 40).map((a) => [a[0], a[1], a[2]]),
    };
  });

  return {
    schema: "agsist-elevator-coverage/1",
    generated: new Date().toISOString(),
    source: SRC,
    directoryGenerated: dir.generated || null,
    note: "Every grain elevator dnilgis/bids knows about. `read` is a board we fetched " +
          "and parsed in the pass this file was built from; `quiet` is a source we have " +
          "that did not answer that pass or is refusing; `known` is a real elevator " +
          "nobody has built a reader for yet. A row carrying a platform has a reader " +
          "whatever a single pass says about it, so `known` never contains one. " +
          "Precision is carried per place and shown in the panel — a town centroid is " +
          "not a street address.",
    counts: {
      ...counts,
      elevators: els.length,
      places: out.length,
      /* THE SAMPLE, BESIDE THE CLAIM. `readers` is the fleet and barely moves;
         `read` is what answered one ten-minute pass and moves a lot. Publishing
         only the second is how the map came to say 599 on a day it had 935. */
      readers,
      unreported: missing,
      passesSeen: opts.passesSeen || 1,
    },
    byState,
    unplacedSample: unplacedNames,
    places: out,
  };
}

/* SELFTEST. Hand-worked answers, not a re-run of the code under test. */
function selftest() {
  const row = (id, platform, status, extra = {}) =>
    ({ id, operator: id, location: "T", state: "IA", status, platform,
       lat: 42, lon: -93, precision: "town", ...extra });
  const dir = {
    generated: "2026-09-09T13:40:34.702Z",
    elevators: [
      row("a", "dtn-cs", "read"),
      row("b", "dtn-cs", "read", { lat: 43 }),
      row("c", "barchart", "stale"),
      row("d", "barchart", "down"),
      row("e", "dtn-cs", "known"),          // ours, absent from this pass
      row("f", null, "known"),              // genuinely no reader
      row("g", null, "known", { lat: 0, lon: 0 }),  // unplaceable, no reader
    ],
  };
  const p = build(dir, { maxMissing: 0.5 });
  const eq = (got, want, what) => {
    if (JSON.stringify(got) !== JSON.stringify(want))
      throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    console.log(`  ok  ${what} = ${JSON.stringify(want)}`);
  };
  // a, b read. c, d, e quiet (e is ours and unreported, so amber, not grey).
  // f and g known. g is ALSO unplaced: read+quiet+known covers every elevator
  // and `unplaced` overlays it, saying how many of them are not drawn. That is
  // the pristine meaning and the page's foot line depends on it.
  eq(p.counts.read, 2, "read");
  eq(p.counts.quiet, 3, "quiet");
  eq(p.counts.known, 2, "known");
  eq(p.counts.unplaced, 1, "unplaced");
  eq(p.counts.read + p.counts.quiet + p.counts.known, 7,
     "the three colours cover every elevator");
  eq(p.counts.readers, 5, "readers");
  eq(p.counts.unreported, 1, "unreported");
  eq(p.counts.elevators, 7, "elevators");
  // a,c,d,e,f share 42,-93; b is its own place. g is not a place at all.
  eq(p.counts.places, 2, "places");
  eq(p.places.find((q) => q.y === 42).c, "read", "a shared pin takes its best state");
  eq(p.byState.IA, { read: 2, quiet: 3, known: 2 }, "byState.IA");

  // A pin outside every drawn region stops the build. Two boxes: a US-ish one
  // and nothing else, with an elevator up in Ontario.
  const outline = { features: [{ properties: { name: "Iowa" }, geometry: {
    type: "Polygon", coordinates: [[[-96, 40], [-90, 40], [-90, 44], [-96, 44], [-96, 40]]] } }] };
  const okOutline = build(dir, { maxMissing: 0.5, outline });
  eq(okOutline.counts.read, 2, "pins inside the drawn region build normally");
  let strandedMsg = "";
  try {
    build({ elevators: [row("on", "dtn-cs", "read", { lat: 43.5, lon: -81.0 })] },
          { maxMissing: 1, outline });
  } catch (err) { strandedMsg = err.message; }
  if (!/outside every region the basemap draws/.test(strandedMsg))
    throw new Error("an Ontario pin with no Canada drawn did not raise: " + strandedMsg);
  console.log("  ok  a pin outside the drawn regions refuses the whole build");
  // Half a degree of slack, so simplification does not strand a coastal pin.
  const edge = build({ elevators: [row("edge", "dtn-cs", "read", { lat: 44.3, lon: -89.7 })] },
                     { maxMissing: 1, outline });
  eq(edge.counts.read, 1, "a pin just outside a simplified edge is not stranded");

  // The gate refuses rather than undercounting.
  let threw = "";
  try { build(dir, { maxMissing: 0.1 }); } catch (err) { threw = err.message; }
  if (!/missing 1 of our 5 readers/.test(threw))
    throw new Error("the gate did not refuse a partial pass: " + threw);
  console.log("  ok  the gate refuses a pass missing 1 of 5 readers");

  // The discriminator being broken is louder than a wrong count.
  threw = "";
  try { build({ elevators: [row("h", null, "read")] }); } catch (err) { threw = err.message; }
  if (!/with no platform/.test(threw))
    throw new Error("a read row with no platform did not raise: " + threw);
  console.log("  ok  a read row with no platform refuses the whole build");
  console.log("selftest passed");
}

if (process.argv.includes("--selftest")) { selftest(); process.exit(0); }

const { dir, seen } = await bestPass();
/* The basemap this repository draws, so the builder can check its own pins
   land on it. Absent = the check is skipped and the build says so, rather
   than silently passing. */
const OUTLINE_PATH = join(ROOT, "data", "us-states.geo.json");
const outline = existsSync(OUTLINE_PATH)
  ? JSON.parse(readFileSync(OUTLINE_PATH, "utf8")) : null;
if (!outline) console.log("  no data/us-states.geo.json — the stranded-pin check did not run");
const payload = build(dir, { passesSeen: seen, outline });
const counts = payload.counts;

if (!existsSync(join(ROOT, "data"))) mkdirSync(join(ROOT, "data"), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload) + "\n");

const kb = (n) => (n / 1024).toFixed(0) + " KB";
console.log(`wrote ${OUT}`);
console.log(`  ${counts.read} read · ${counts.quiet} quiet · ${counts.known} known` +
            `  (${counts.elevators} elevators on ${counts.places} places)`);
console.log(`  ${counts.readers} readers built; ${counts.unreported} of them were not in` +
            ` the pass used, chosen from ${counts.passesSeen} vintage(s)`);
console.log(`  ${counts.unplaced} could not be placed and are counted, not drawn`);
console.log(`  ${kb(JSON.stringify(payload).length)} raw`);
