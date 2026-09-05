/* THE ELEVATORS WE ARE ALREADY LOOKING AT AND DO NOT READ.
 * ===========================================================================
 *
 *     node scripts/board-siblings.mjs            write the worklist
 *     node scripts/board-siblings.mjs --print    and print it
 *
 * WHAT THIS IS FOR
 *
 * Every cash board this repository reads names its siblings. A CoMark page
 * fetched for ANTHONY - NORTH lists ninety-odd other CoMark locations, each
 * with the location id that would address it. The adapters already capture
 * that, in `otherLocationsOnPage`, on 608 of our data files.
 *
 * Measured 2026-09-05: those boards expose **964** locations. **627** are
 * already sources. **337 are not** — and they are not missing because the
 * board is hard to read or the host is slow. They are on pages we fetch every
 * poll, and reading them costs no new request, no new host, and no discovery.
 *
 * WHY THEY WERE REFUSED, WHICH IS THE HONEST PART
 *
 * agricharts-sweep.mjs will not write a source it cannot place. It joins the
 * board's location label to a town in data/known-elevators.json, and if it
 * cannot, the location goes to an `unmatched` list. That refusal is correct:
 * rule 45 says a geocode must carry how it was made, and a source with an
 * invented town is worse than no source.
 *
 * But the unmatched list was PRINTED TO THE RUN LOG AND THROWN AWAY. So the
 * number nobody knew was 337 has been sitting in expired logs, and no worklist
 * of it existed anywhere. That is what this script fixes first: the same
 * information, in a file, where it can be worked and where it can shrink.
 *
 * AND IT PLACES WHAT IT HONESTLY CAN
 *
 * The sweep's join is narrower than the data this repository holds:
 *
 *   - it reads only data/known-elevators.json (1,802 rows) when
 *     data/directory.json carries 4,581, including the state registries
 *   - it scopes to the SOURCE's state, and a co-op is not one state:
 *     CoMark's own board says "BAKER OK", "CONLEY TX", "DARROUZETT TX" while
 *     its source record says KS. Scoping to KS guarantees a miss on its own
 *     siblings.
 *   - it never reads a label that names its own state, though 25 of them do
 *
 * With those three fixed, 98 of the 337 resolve to exactly one state. 17 are
 * a town name that exists in several states with nothing to choose between
 * them, and those stay refused — a coin toss is an invented coordinate.
 * The remaining 222 are real towns in states our directory barely covers
 * (Oklahoma: 33 rows; Colorado: 29; fifteen states: none at all), and they
 * wait on a registry harvest, not on cleverer matching.
 *
 * NOTHING HERE WRITES A SOURCE. It writes a worklist. Turning a row into a
 * source is agricharts-sweep.mjs's job and it still has to satisfy every check
 * it has today.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PRINT = process.argv.includes("--print");

const US = new Set(("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN " +
  "MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split(" "));

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const asList = (d) => Array.isArray(d) ? d
  : (d && (d.elevators || d.places)) ? (d.elevators || d.places)
  : (d && typeof d === "object") ? Object.values(d) : [];

/* ── the towns we actually hold, and which states each name occurs in ────── */
/* AND WHERE THEY ARE.
 *
 * geocodes/places.json already holds a coordinate for 3,957 places — 1,798
 * from Barchart's directory and 2,159 from the state registries — each with
 * its `precision` and the `via` that made it. A sibling whose town is one of
 * those does not need geocoding; it needs looking up.
 *
 * This matters because the sweep's own path to a coordinate runs through a
 * ZIP, and geocodes/zip-candidates.json is a small curated file of the ZIPs
 * this project has already needed — 743 towns. Measured: it covers **3** of
 * the 100 placeable siblings. The ZIP is only a key on the way to a
 * coordinate, and for 67 of them the coordinate is already here.
 *
 * Nothing is computed. Each row carries the coordinate that was already
 * recorded for that town, with the provenance it was recorded under, so a
 * person can see what they are getting: `town/zip-centroid` is the middle of
 * the town, not the driveway, and the worklist says so. */
const placeCoord = new Map();           // "TOWN|ST" -> {lat,lon,precision,via}
{
  const places = readJson(ROOT + "geocodes/places.json") || {};
  for (const bucket of ["known", "registry"]) {
    const v = places[bucket];
    if (!v) continue;
    for (const rec of (Array.isArray(v) ? v : Object.values(v))) {
      if (!rec || rec.lat == null || rec.lon == null) continue;
      const t = normTown(rec.location), st = String(rec.state || "").toUpperCase();
      if (!t || !US.has(st)) continue;
      const k = t + "|" + st;
      /* First writer wins, and `known` is read first: Barchart's directory is
         the one a street-precision fix would have landed in. */
      if (!placeCoord.has(k))
        placeCoord.set(k, { lat: rec.lat, lon: rec.lon,
                            precision: rec.precision || "", via: rec.via || "" });
    }
  }
}

const townStates = new Map();
for (const rec of asList(readJson(ROOT + "data/directory.json"))) {
  const st = String(rec.state || "").toUpperCase();
  const town = normTown(rec.location || "");
  if (!town || !US.has(st)) continue;
  if (!townStates.has(town)) townStates.set(town, new Set());
  townStates.get(town).add(st);
}

/* A label is a display string, not a place name. These words are what a board
   adds around a town — they are removed to compare, never to rename. */
function normTown(s) {
  return String(s || "").toUpperCase()
    .replace(/\b(DELIVERED|DEL|TERMINAL|TERM|SHUTTLE|ELEVATOR|PLANT|INC|LLC|CO)\b/g, " ")
    .replace(/\s+-\s+(NORTH|SOUTH|EAST|WEST)\s*$/, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ").trim();
}

/* "CONLEY TX" and "CALHOUN, GA" name their own state. Twenty-five do. */
function splitState(label) {
  const m = String(label).trim().match(/^(.*?)[,\s]+([A-Za-z]{2})$/);
  if (m && US.has(m[2].toUpperCase())) return [m[1].trim(), m[2].toUpperCase()];
  return [String(label).trim(), null];
}

/* ── what we already read ────────────────────────────────────────────────── */
const sources = new Map();
const haveOnBoard = new Map();          // board url -> Set(locationId)
for (const f of readdirSync(ROOT + "sources")) {
  if (!f.endsWith(".json")) continue;
  const s = readJson(ROOT + "sources/" + f);
  if (!s || !s.id) continue;
  sources.set(s.id, s);
  if (!s.url) continue;
  if (!haveOnBoard.has(s.url)) haveOnBoard.set(s.url, new Set());
  haveOnBoard.get(s.url).add(String(s.locationId ?? "").trim());
}

/* ── what the boards told us about ───────────────────────────────────────── */
const rows = new Map();                 // url|id -> row
let boardsThatReported = 0;
/* DISTINCT, not one per file that mentioned it. Each of 670 data files lists
   its own siblings, so counting every mention reported 17,304 locations for a
   country with 4,581 known elevators — a number that is wrong in the direction
   that flatters the work. */
const exposedSet = new Set();
for (const f of readdirSync(ROOT + "data")) {
  if (!f.endsWith(".json")) continue;
  const d = readJson(ROOT + "data/" + f);
  if (!d || typeof d !== "object" || !Array.isArray(d.otherLocationsOnPage)) continue;
  const s = sources.get(f.slice(0, -5));
  if (!s || !s.url) continue;
  boardsThatReported++;
  for (const entry of d.otherLocationsOnPage) {
    const m = String(entry).match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    if (!m) continue;                   /* no id means nothing to address it by */
    const label = m[1].trim(), locationId = m[2].trim();
    exposedSet.add(s.url + "|" + locationId);
    if (haveOnBoard.get(s.url)?.has(locationId)) continue;
    rows.set(s.url + "|" + locationId, {
      operator: s.operator || "", sourceState: String(s.state || "").toUpperCase(),
      platform: s.platform || "", url: s.url, label, locationId,
    });
  }
}

/* ── place what can be placed, refuse what cannot ────────────────────────── */
let resolved = 0, ambiguous = 0, unknown = 0, ready = 0;
for (const r of rows.values()) {
  const [base, ownState] = splitState(r.label);
  const town = normTown(base);
  const states = townStates.get(town) || new Set();

  if (ownState && (states.has(ownState) || states.size === 0)) {
    r.state = ownState; r.how = "the label names its own state"; resolved++;
  } else if (states.size === 1) {
    r.state = [...states][0]; r.how = "one town of that name in the directory"; resolved++;
  } else if (states.size > 1 && states.has(r.sourceState)) {
    r.state = r.sourceState; r.how = "several states have the town; the operator's own is one"; resolved++;
  } else if (states.size > 1) {
    r.state = ""; r.how = `AMBIGUOUS — ${[...states].sort().join("/")}, and nothing chooses between them`; ambiguous++;
  } else {
    r.state = ""; r.how = "no town of that name in data/directory.json"; unknown++;
  }

  /* The coordinate, if we already hold one for that town in that state. */
  const c = r.state ? placeCoord.get(town + "|" + r.state) : null;
  if (c) { r.lat = c.lat; r.lon = c.lon; r.precision = c.precision; r.via = c.via; ready++; }
  else   { r.lat = ""; r.lon = ""; r.precision = ""; r.via = ""; }
}

/* ── the worklist ────────────────────────────────────────────────────────── */
const all = [...rows.values()].sort((a, b) =>
  (a.operator || "").localeCompare(b.operator || "") || a.label.localeCompare(b.label));

mkdirSync(ROOT + "data/gaps", { recursive: true });
const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
writeFileSync(ROOT + "data/gaps/board-siblings.csv",
  "operator,label,state,how_the_state_was_decided,lat,lon,precision,via," +
  "location_id,platform,board_url\n" +
  all.map((r) => [r.operator, r.label, r.state, r.how, r.lat, r.lon, r.precision, r.via,
                  r.locationId, r.platform, r.url].map(q).join(",")).join("\n") + "\n");

console.log("\nLOCATIONS ON BOARDS WE ALREADY FETCH");
console.log("  boards that reported their siblings : " + boardsThatReported);
console.log("  distinct locations they expose      : " + exposedSet.size);
console.log("  already a source                    : " + (exposedSet.size - rows.size));
console.log("  NOT a source                        : " + rows.size);
console.log("\n  of those " + rows.size + ":");
console.log("    a state can be decided honestly   : " + resolved);
console.log("    ambiguous, refused                : " + ambiguous);
console.log("    town not in our directory         : " + unknown);
console.log("\n  AND ALREADY GEOCODED, so a source needs no new lookup:");
console.log("    ready to place                    : " + ready);
console.log("\n  written: data/gaps/board-siblings.csv");

if (PRINT) {
  console.log("\n  " + "operator".padEnd(30) + "label".padEnd(24) + "st   how");
  for (const r of all.slice(0, 60))
    console.log("  " + (r.operator || "").slice(0, 29).padEnd(30) +
      r.label.slice(0, 23).padEnd(24) + (r.state || "--").padEnd(5) + r.how.slice(0, 52));
  if (all.length > 60) console.log("  … and " + (all.length - 60) + " more in the CSV");
}

/* By operator, because that is how the work is actually done: one board, one
   sitting, many locations. */
const byOp = new Map();
for (const r of all) {
  const k = r.operator || "(unnamed)";
  if (!byOp.has(k)) byOp.set(k, { n: 0, placeable: 0, url: r.url });
  const e = byOp.get(k); e.n++; if (r.state) e.placeable++;
}
console.log("\n  THE BIGGEST WINS, BY OPERATOR");
console.log("  " + "operator".padEnd(34) + "unread  placeable now");
for (const [k, v] of [...byOp.entries()].sort((a, b) => b[1].placeable - a[1].placeable).slice(0, 14))
  console.log("  " + k.slice(0, 33).padEnd(34) + String(v.n).padStart(5) + String(v.placeable).padStart(13));
