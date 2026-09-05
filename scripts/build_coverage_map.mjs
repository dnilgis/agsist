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

/* A local path may be given instead, so this can be run against a checkout
   without the network. */
async function load() {
  if (SRC.startsWith("http")) {
    const r = await fetch(SRC, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`${SRC} returned HTTP ${r.status}`);
    return r.json();
  }
  return JSON.parse(readFileSync(SRC, "utf8"));
}

const dir = await load();
const els = dir.elevators || [];
if (!els.length) throw new Error("the directory carried no elevators — refusing to write an empty map");

/* THE THREE COLOURS. `stale` and `down` are OURS and not answering, which is a
   different fact from an elevator nobody has tried yet, and the page says so.
   Collapsing them into grey would hide our own broken readers, which is
   exactly the number worth publishing. */
const bucket = (s) => s === "read" ? "read"
  : (s === "stale" || s === "down") ? "quiet" : "known";

/* SIX DECIMAL PLACES IS ABOUT 10cm AND WE DO NOT HAVE THAT.
   Rounding to four (~11m) groups the several elevators that share a town
   centroid onto one pin without pretending the pin is a driveway. */
const keyOf = (lat, lon) => lat.toFixed(4) + "," + lon.toFixed(4);

const places = new Map();
const counts = { read: 0, quiet: 0, known: 0, unplaced: 0 };
const byState = {};
const unplacedNames = [];

for (const e of els) {
  const b = bucket(e.status);
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

if (!existsSync(join(ROOT, "data"))) mkdirSync(join(ROOT, "data"), { recursive: true });
const payload = {
  schema: "agsist-elevator-coverage/1",
  generated: new Date().toISOString(),
  source: SRC,
  directoryGenerated: dir.generated || null,
  note: "Every grain elevator dnilgis/bids knows about. `read` is a board we fetch " +
        "and parse today; `quiet` is a source we have that is not answering; `known` " +
        "is a real elevator nobody has built a reader for yet. Precision is carried " +
        "per place and shown in the panel — a town centroid is not a street address.",
  counts: { ...counts, elevators: els.length, places: out.length },
  byState,
  unplacedSample: unplacedNames,
  places: out,
};
writeFileSync(OUT, JSON.stringify(payload) + "\n");

const kb = (n) => (n / 1024).toFixed(0) + " KB";
console.log(`wrote ${OUT}`);
console.log(`  ${counts.read} read · ${counts.quiet} quiet · ${counts.known} known` +
            `  (${els.length} elevators on ${out.length} places)`);
console.log(`  ${counts.unplaced} could not be placed and are counted, not drawn`);
console.log(`  ${kb(JSON.stringify(payload).length)} raw`);
