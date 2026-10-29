/* NO OPEN-METEO ANYWHERE THE SITE SERVES.
 *
 *     node scripts/no-open-meteo.mjs
 *     node scripts/no-open-meteo.mjs --selftest
 *
 * 2026-10-29, Sig: no paid Open-Meteo key. Open-Meteo's terms count "websites or apps that have
 * subscriptions or display advertisements" as commercial use, so AGSIST is outside its free tier.
 * Every call moved the same week: weather forecasts to the National Weather Service grid
 * (components/nws.js), weather history and GDUs to the PRISM daily grids through RCC-ACIS
 * (components/prism.js), place lookups to our own data/places/ files (components/places.js),
 * soil temperature to measured stations (components/soil-near.js), rain to our own radar files.
 *
 * This keeps it that way: any Open-Meteo host (open-meteo.com and every subdomain: api.,
 * archive-api., geocoding-api., customer-api., ...) named in any text file the site serves
 * fails. Pages serves the whole repository, so the walk is the whole repository (data/ JSON
 * included: a recorded answer or a link in a data file is served too) minus what a browser
 * never runs: git, the tests and scripts (they name it on purpose, this file among them), the
 * reference library and the notes.
 *
 * ALLOWED, each with its reason; adding one needs the same kind of reason:
 *   data/rain-print-examples/*.json  recorded answers from before Oct 29 (the town lookup a
 *       replay serves back); never fetched by a browser. scripts/fetch_rain_print_examples.mjs
 *       now records our own place files; its next run (it needs the network) rewrites them.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const HOST_RE = /(?:[a-z0-9-]+\.)*open-meteo\.com/gi;
const SKIP_DIRS = new Set([".git", "node_modules", "test", "scripts", "references", "notes", ".github", ".verify", "build"]);
const TEXT = /\.(html?|m?js|css|json|geojson|xml|txt|webmanifest|svg|md|csv|tsv|ics|toml|ya?ml)$/i;
export const ALLOWED = [
  { re: /^data\/rain-print-examples\/[^/]+\.json$/, why: "recorded answers from before 2026-10-29; the next fetch_rain_print_examples run rewrites them" },
];

export function servedText(root = ROOT) {
  const out = [];
  (function walk(rel) {
    let ents;
    try { ents = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) { if (!(rel === "" && SKIP_DIRS.has(e.name))) walk(r); }
      else if (TEXT.test(e.name)) out.push(r);
    }
  })("");
  return out.sort();
}

/* {files, found: ["path -> host"], allowed: ["path -> host (why)"]} */
export function scan(root = ROOT) {
  const found = [], allowed = [];
  const files = servedText(root);
  for (const f of files) {
    let t;
    try { if (statSync(join(root, f)).size > 64e6) continue; t = readFileSync(join(root, f), "utf8"); } catch { continue; }
    if (!/open-meteo\.com/i.test(t)) continue;
    const hosts = [...new Set((t.match(HOST_RE) || []).map((h) => h.toLowerCase()))];
    const a = ALLOWED.find((x) => x.re.test(f));
    for (const h of hosts) (a ? allowed : found).push(`${f} -> ${h}` + (a ? ` (${a.why})` : ""));
  }
  return { files: files.length, found, allowed };
}

function selftest() {
  let n = 0;
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.log("FAIL " + m + ": " + JSON.stringify(a)); process.exit(1); } n++; };
  const hosts = (t) => [...new Set((t.match(HOST_RE) || []).map((h) => h.toLowerCase()))];
  eq(hosts("fetch('https://api.open-meteo.com/v1/forecast?x=1')"), ["api.open-meteo.com"], "api host");
  eq(hosts("https://archive-api.open-meteo.com/v1/archive and https://geocoding-api.open-meteo.com/v1/search"), ["archive-api.open-meteo.com", "geocoding-api.open-meteo.com"], "two hosts");
  eq(hosts('<a href="https://open-meteo.com/">'), ["open-meteo.com"], "bare host");
  eq(hosts('<link rel="preconnect" href="https://API.Open-Meteo.com">'), ["api.open-meteo.com"], "any case");
  eq(hosts("Open-Meteo removed (its terms)"), [], "the name alone is not a host");
  eq(ALLOWED.some((a) => a.re.test("data/rain-print-examples/2012-ames-ia.json")), true, "recorded answers allowed");
  eq(ALLOWED.some((a) => a.re.test("components/geo.js")), false, "code never allowed");
  console.log(`selftest: ${n} ok`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--selftest")) selftest();
  else {
    const r = scan();
    console.log(`NO OPEN-METEO: ${r.files} served text files read`);
    for (const a of r.allowed) console.log("  allowed " + a);
    if (r.found.length) {
      for (const f of r.found) console.log("  FAIL " + f);
      console.log("Open-Meteo's terms count an ad-supported site as commercial use (2026-10-29). Use the NWS grid (components/nws.js), PRISM (components/prism.js) or our own data/places/.");
      process.exit(1);
    }
    console.log("  ok   no file the site serves names an Open-Meteo host");
  }
}
