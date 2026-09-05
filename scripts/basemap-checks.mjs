/* EVERY TILE URL ON THIS SITE RESOLVES TO AN IMAGE.
 *
 * 2026-09-05: /elevators shipped with `dark_matter` and `voyager` as its CARTO
 * styles. Both are 404s. The map drew 4,581 markers on a black void for a day,
 * with the CARTO attribution sitting underneath implying tiles were there.
 *
 * Nothing caught it. The render test counted markers and asserted the map
 * object existed — it never asked whether a single tile had loaded. Testing
 * the rule, not the wiring, one more time.
 *
 * `dark_matter` and `voyager` are CARTO's VECTOR style names. The raster tile
 * service uses different paths. A wrong path is a silent per-tile 404: Leaflet
 * draws nothing and reports nothing.
 *
 *     node scripts/basemap-checks.mjs          static check only
 *     node scripts/basemap-checks.mjs --live   also fetch one tile of each
 *
 * The static check is the one that runs everywhere. --live needs network and
 * is the one that would have caught a style CARTO retires later.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const LIVE = process.argv.includes("--live");

/* Verified against the tile service on 2026-09-05, not copied from memory:
   each of these returned an image and each name NOT on this list that was
   tried returned 404. */
const CARTO_RASTER_STYLES = new Set([
  "light_all", "dark_all",
  "light_nolabels", "light_only_labels",
  "dark_nolabels", "dark_only_labels",
  "rastertiles/voyager", "rastertiles/voyager_nolabels",
  "rastertiles/voyager_only_labels", "rastertiles/voyager_labels_under",
]);

/* The names that are real basemaps but are NOT raster paths. Called out by
   name because they are the plausible-looking wrong answer. */
const VECTOR_ONLY = new Set(["dark_matter", "voyager", "positron", "positron_nolabels"]);

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n         " + e.message); }
};

/* ONLY LOOK WHERE A TILE LAYER ACTUALLY IS.
 *
 * The first version of this scanned every `? 'a' : 'b'` in every file and
 * reported "block", "none", "yes", "corn" and "rising" as broken basemap
 * styles — 47 failures, 45 of them noise. A guard that cries wolf is a guard
 * that gets ignored, which is worse than no guard: it would have buried the
 * two real ones.
 *
 * So: a page is only examined if it calls L.tileLayer, and a style is only
 * read from a literal tile URL or from a STYLES map beside one. */
const pages = readdirSync(ROOT).filter((f) => f.endsWith(".html"))
  .filter((f) => readFileSync(ROOT + f, "utf8").includes("L.tileLayer"));

const found = [];
for (const f of pages) {
  const src = readFileSync(ROOT + f, "utf8");
  /* A literal URL: .../<style>/{z}/{x}/{y}.png */
  for (const m of src.matchAll(/basemaps\.cartocdn\.com\/([A-Za-z0-9_\/]+)\/\{z\}/g))
    found.push({ file: f, style: m[1].replace(/^\/+|\/+$/g, "") });
  /* A style built from a variable: capture the STYLES map that feeds it. */
  if (/cartocdn[^;]*\+\s*style\s*\+/.test(src) || /\{s\}\.basemaps/.test(src))
    for (const m of src.matchAll(/STYLES\s*=\s*\{([^}]*)\}/g))
      for (const v of m[1].matchAll(/['"]([A-Za-z0-9_\/]+)['"]/g))
        found.push({ file: f, style: v[1] });
}

console.log("\nSTYLE NAMES");
check("there is a tile layer somewhere to check", () =>
  assert.ok(pages.length, "no page calls L.tileLayer — did the map library change?"));
check("every tile layer yielded a readable style name", () =>
  assert.ok(found.length >= pages.length,
    `${pages.length} page(s) call L.tileLayer but only ${found.length} style name(s) ` +
    `could be read. A style this cannot see is a style it cannot check.`));

const seen = new Set();
for (const { file, style } of found) {
  const key = file + ":" + style;
  if (seen.has(key) || !style) continue;
  seen.add(key);
  check(`${file}: ${style}`, () => {
    assert.ok(!VECTOR_ONLY.has(style),
      `"${style}" is a CARTO VECTOR style name, not a raster tile path. It 404s ` +
      `per tile and the map draws no basemap at all. Use ` +
      `${style === "dark_matter" ? "dark_all"
        : style === "voyager" ? "rastertiles/voyager"
        : style === "positron" ? "light_all" : "a raster path"}.`);
    assert.ok(CARTO_RASTER_STYLES.has(style),
      `"${style}" is not a known CARTO raster style. Known: ${[...CARTO_RASTER_STYLES].join(", ")}`);
  });
}

/* Only /elevators is held to this today. The other map pages predate the rule
   and each shows a single named place rather than a national dot field — a
   missing basemap there is obvious to the reader rather than mistakable for a
   design. Worth doing eventually; not worth a red tick now. */
console.log("\nFAILING QUIETLY IS NOT ALLOWED (the national dot map)");
for (const f of ["elevators.html"]) {
  if (!existsSync(ROOT + f)) continue;
  const src = readFileSync(ROOT + f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  check(`${f} tells the reader when its tiles do not load`, () =>
    assert.match(src, /tileerror/,
      `${f} has no 'tileerror' handler. A basemap that 404s renders as markers ` +
      `on a void and looks like a design choice — which is exactly how this ` +
      `went unnoticed for a day.`));
}

if (LIVE) {
  /* 404 IS THE FAULT. 403 IS THE NETWORK BETWEEN HERE AND CARTO.
     Run from a sandbox with an egress proxy, every style returns 403 with a
     110-byte body — including light_all, which has served this site for
     months. Reporting that as three broken basemaps would be the same mistake
     as the ternary scan: a guard that fails for reasons that are not the
     thing it is guarding. Only a 404 condemns a style. */
  console.log("\nLIVE — one tile of each style");
  let blocked = 0;
  for (const style of [...new Set(found.map((x) => x.style))].filter(Boolean)) {
    const url = `https://a.basemaps.cartocdn.com/${style}/4/4/6.png`;
    let status = 0, len = 0;
    try {
      const r = await fetch(url);
      status = r.status;
      len = (await r.arrayBuffer()).byteLength;
    } catch { status = -1; }
    if (status === 200 && len > 500) {
      pass++; console.log(`  ok      ${style.padEnd(30)} HTTP 200  ${len} bytes`);
    } else if (status === 404) {
      fail++; console.log(`  FAIL    ${style.padEnd(30)} HTTP 404 — this style does not exist`);
    } else {
      blocked++; console.log(`  skip    ${style.padEnd(30)} HTTP ${status} — not reachable from here, not a verdict`);
    }
  }
  if (blocked)
    console.log(`\n  ${blocked} style(s) could not be reached (proxy or offline). ` +
                `Re-run --live somewhere with open egress before trusting a green.`);
}

console.log("\n  " + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
