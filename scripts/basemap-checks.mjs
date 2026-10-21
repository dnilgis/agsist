/* THIS SITE DOES NOT RENT ITS BASEMAP.
 *
 *     node scripts/basemap-checks.mjs
 *     node scripts/basemap-checks.mjs --selftest
 *
 * WHAT THIS FILE USED TO CHECK, AND WHY THAT WAS NOT ENOUGH.
 *
 * 2026-09-05: /elevators shipped with `dark_matter` and `voyager` as its CARTO
 * raster styles. Both are 404s. The map drew 4,581 markers on a black void for
 * a day with the CARTO attribution underneath implying tiles were there. This
 * file was written to catch that, and it did: it read the style names out of
 * the page and checked them against a list of paths that return an image.
 *
 * 2026-09-09: CARTO began requiring an API key and started serving a
 * watermarked "API KEY REQUIRED" tile in place of the map. Every check in here
 * went green. The style name was still valid. The tile still returned 200. The
 * page's own tileerror handler never fired, because nothing errored. The live
 * site was defaced across two pages and the only thing that noticed was a
 * human looking at a screenshot.
 *
 * The lesson is not "add a watermark detector". It is that a basemap rented
 * from somebody else can change underneath you in ways no assertion here can
 * anticipate, and that the vendor's terms are not a thing this repository
 * controls. So the basemap is now data/us-states.geo.json, served from this
 * repository, and what this file checks is that it stays that way.
 *
 * Natural Earth 1:50m admin-1, public domain. Rebuilt by build/make_outline.sh.
 *
 * 2026-10-20: /rain-radar puts a real map under the rain again (Sig: "get a
 * real map underneath the rain at my field"). The one tile host allowed is the
 * USGS National Map: a federal service, public domain, no key, no account, no
 * terms that can be changed to a paid plan. The rain still draws over the
 * outline above, so if those tiles stop loading the page is no worse than it
 * was. Any other tile URL template, or any template carrying a key or token,
 * fails here.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUTLINE = "data/us-states.geo.json";

/* Hosts that serve map tiles to somebody else's terms. Not exhaustive and not
   meant to be — it is the list of everything this site has ever used plus the
   obvious neighbours, so a future edit that reaches for one gets stopped and
   has to argue for it here first. */
const TILE_VENDORS = [
  "basemaps.cartocdn.com", "cartodb-basemaps", "tile.openstreetmap",
  "server.arcgisonline.com", "basemaps-api.arcgis.com", "api.mapbox.com",
  "tiles.stadiamaps.com", "api.maptiler.com", "tile.thunderforest.com",
  "tiles.openfreemap.org", "tile.opentopomap.org",
];

/* Tile hosts that are public domain and need no key. Adding one needs the
   same argument USGS got: who runs it, why its terms cannot turn into a bill,
   and what the page shows when it stops answering. */
const PUBLIC_TILE_HOSTS = [
  "basemap.nationalmap.gov",
  /* 2026-10-20, the storm replay (components/storm-replay-core.js): NOAA's
     national radar mosaic as map tiles, one set every 5 minutes, archived.
     Run by the Iowa Environmental Mesonet at Iowa State University, which
     already supplies this site's hail reports and radar hail archive. No key,
     no account, no paid tier. It is a weather layer over the USGS map, never
     the map itself; when it stops answering the replay says "NOAA radar not
     answering since ..." and the other layers still draw. */
  "mesonet.agron.iastate.edu",
];

/* A tile URL template ({z} with {x}/{y}) found in served code, and whether it
   is allowed: public host and nothing in it that looks like a key. */
export function tileTemplates(text) {
  const out = [];
  const re = /https?:\/\/[^'"`\s)]*\{z\}[^'"`\s)]*/g;
  let m;
  while ((m = re.exec(text))) out.push(m[0]);
  return out;
}
export function tileAllowed(url) {
  let host;
  try { host = new URL(url.replace(/\{[a-z]+\}/g, "0")).hostname; } catch { return false; }
  if (!PUBLIC_TILE_HOSTS.includes(host)) return false;
  if (/[?&](key|apikey|api_key|access_token|token|subscription-key)=|\{(key|token|accessToken)\}/i.test(url)) return false;
  return true;
}

let pass = 0, fail = 0;
const ok = (msg) => { pass++; console.log("  ok   " + msg); };
const bad = (msg, why) => { fail++; console.log("  FAIL " + msg + "\n         " + why); };

function pages() {
  return readdirSync(ROOT).filter((f) => f.endsWith(".html"))
    .map((f) => [f, readFileSync(join(ROOT, f), "utf8")]);
}

/* what the browser runs: root pages plus the component scripts they load */
function served() {
  const dir = join(ROOT, "components");
  const js = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".js"))
    .map((f) => ["components/" + f, readFileSync(join(dir, f), "utf8")]) : [];
  return pages().concat(js);
}

function checkTileTemplates() {
  console.log("\nEVERY TILE URL IS PUBLIC DOMAIN AND KEYLESS");
  const seen = [], badOnes = [];
  for (const [name, text] of served())
    for (const u of tileTemplates(text)) (tileAllowed(u) ? seen : badOnes).push(`${name} -> ${u}`);
  if (badOnes.length)
    bad("every tile template is on " + PUBLIC_TILE_HOSTS.join(", ") + " with no key",
        badOnes.join("\n         ") +
        "\n         Only public domain, keyless hosts may serve a basemap here. A keyed or" +
        "\n         paid host is the 2026-09-09 failure waiting to happen again.");
  else ok(`${seen.length} tile template(s), all public domain and keyless` + (seen.length ? ": " + seen.join("; ") : ""));
}

function checkNoVendors() {
  console.log("\nNO RENTED TILES");
  const found = [];
  for (const [name, html] of served())
    for (const v of TILE_VENDORS)
      if (html.includes(v)) found.push(`${name} -> ${v}`);
  if (found.length)
    bad("no page fetches tiles from a third party",
        found.join("\n         ") +
        "\n         A rented basemap can be keyed, watermarked or retired without notice." +
        "\n         That happened on 2026-09-09 and nothing in this repository saw it." +
        "\n         Use data/us-states.geo.json, or change this list and say why.");
  else ok(`no page fetches tiles from any of ${TILE_VENDORS.length} known vendors`);
}

function checkOutlineUsers() {
  console.log("\nEVERY MAP DRAWS THE OUTLINE, AND SAYS SO WHEN IT CANNOT");
  const users = pages().filter(([, h]) => h.includes(OUTLINE));
  if (!users.length) { bad("some page draws the basemap", "no page fetches " + OUTLINE); return; }
  ok(`${users.length} page(s) draw ${OUTLINE}: ${users.map(([n]) => n).join(", ")}`);
  for (const [name, html] of users) {
    /* THE PROMISE THE OLD TILE VERSION MADE AND COULD NOT KEEP. An outline
       either loads or it does not — there is no third state where a vendor
       substitutes something else — so this guard can actually work now. */
    const handled = /\.catch\(/.test(html) && /(banner|tileWarn|covmap-tilewarn)/.test(html);
    if (handled) ok(`${name} tells the reader when the outline does not load`);
    else bad(`${name} tells the reader when the outline does not load`,
             `${name} fetches the outline with no failure path. Markers on a void ` +
             `read as a design choice, which is how 2026-09-05 went unnoticed for a day.`);
  }
}

function readOutline() {
  const p = join(ROOT, OUTLINE);
  if (!existsSync(p)) return null;
  return { json: JSON.parse(readFileSync(p, "utf8")), bytes: statSync(p).size };
}

function checkOutlineFile(o) {
  console.log("\nTHE OUTLINE ITSELF");
  if (!o) { bad(OUTLINE + " exists", "missing — run build/make_outline.sh"); return; }
  ok(`${OUTLINE} parses, ${o.json.features.length} features, ${Math.round(o.bytes / 1024)}KB`);
  /* A basemap that has quietly become a megabyte is a basemap somebody will
     replace with tiles again. One screen of the raster tiles this replaced was
     200-700KB, and that was per pan. */
  if (o.bytes > 400 * 1024)
    bad("the outline stays cheaper than the tiles it replaced",
        `${Math.round(o.bytes / 1024)}KB is past the 400KB line. Simplify harder in build/make_outline.sh.`);
  else ok("the outline stays cheaper than the tiles it replaced");
}

/* THE CANADA CHECK. The network carries three Ontario elevators. All three are
   unplaced today, which is the only reason a US-only outline did not strand
   one. This is what notices when the data starts covering ground the map does
   not draw — the reverse of the usual direction, and the one nobody watches. */
export function countriesNeeded(coverage) {
  const US = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
    "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC",
    "ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"]);
  const out = new Set();
  for (const code of Object.keys(coverage.byState || {})) out.add(US.has(code) ? "US" : "CA");
  return [...out].sort();
}

function checkCountries(o) {
  console.log("\nTHE MAP DRAWS EVERY COUNTRY THE DATA USES");
  const cov = join(ROOT, "data/elevator-coverage.json");
  if (!o || !existsSync(cov)) { ok("skipped — no coverage file or no outline yet"); return; }
  const need = countriesNeeded(JSON.parse(readFileSync(cov, "utf8")));
  const have = [...new Set(o.json.features.map((f) => f.properties.iso_a2))].sort();
  const missing = need.filter((c) => !have.includes(c));
  if (missing.length)
    bad("every country in the coverage data is drawn",
        `the data covers ${need.join(", ")} but the outline draws ${have.join(", ")}. ` +
        `Add ${missing.join(", ")} in build/make_outline.sh — do not drop the pins.`);
  else ok(`data covers ${need.join(", ")}; outline draws ${have.join(", ")}`);
}

function selftest() {
  const eq = (got, want, what) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g !== w) throw new Error(`${what}: got ${g}, want ${w}`);
    console.log(`  ok  ${what} = ${w}`);
  };
  eq(countriesNeeded({ byState: { IA: {}, OH: {} } }), ["US"], "US-only data needs US");
  eq(countriesNeeded({ byState: { IA: {}, ON: {} } }), ["CA", "US"], "an Ontario elevator needs CA");
  eq(countriesNeeded({ byState: {} }), [], "no data needs nothing");
  eq(countriesNeeded({}), [], "a coverage file with no byState needs nothing");
  const usgs = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}";
  eq(tileTemplates("var a='" + usgs + "';"), [usgs], "a template is found in code");
  eq(tileAllowed(usgs), true, "the USGS topo template is allowed");
  eq(tileAllowed(usgs + "?token=abc"), false, "a USGS template with a token is not");
  eq(tileAllowed("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"), false, "CARTO is not");
  eq(tileAllowed("https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=X"), false, "a keyed vendor is not");
  eq(tileAllowed("https://tile.openstreetmap.org/{z}/{x}/{y}.png"), false, "OSM's tile server is not");
  console.log("selftest passed");
}

if (process.argv.includes("--selftest")) { selftest(); process.exit(0); }

const outline = readOutline();
checkNoVendors();
checkTileTemplates();
checkOutlineUsers();
checkOutlineFile(outline);
checkCountries(outline);
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
