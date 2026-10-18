// Farmland Atlas sales: no buyer or seller name, legal description, parcel id or document
// number may reach an indexed Atlas page (Sig, Oct 17, 2026). The county transfer files
// (data/land/<st>/<fips>.json) carry names for the Field Scout card; the Atlas reads only
// data/land/<st>/summary.json. These tests fail if any of those fields reach the summary,
// the pages, or the words components/atlas-sales.js draws.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);
const S = require(join(ROOT, "components/atlas-sales.js"));
const STATES = [["il", "illinois"], ["wi", "wisconsin"]].filter(([s]) => existsSync(join(ROOT, `data/land/${s}/summary.json`)));
const PRIVATE = ["grantor", "grantee", "legal", "pid", "doc"];
const COUNTY_KEYS = new Set(["a24", "chg", "from", "k12", "k12p", "k24", "large", "med", "medp", "n12", "n12p", "name", "nout", "out", "r24", "to", "u12", "u12p", "why_chg", "why_p"]);
const TOP_KEYS = new Set(["counties", "fetched", "kinds", "min_acres", "min_n", "record", "since_note", "state", "state_med", "through", "url", "who", "windows"]);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const norm = (s) => String(s).toUpperCase().replace(/\s+/g, " ").trim();
const words = (s) => new Set(norm(s).split(/[^A-Z0-9&']+/).filter((w) => w.length >= 3));

function countyFiles(s) {
  return readdirSync(join(ROOT, "data/land", s)).filter((n) => /^\d{5}\.json$/.test(n))
    .map((n) => JSON.parse(read(`data/land/${s}/${n}`)));
}
// every private value in a county file, at least 6 characters (shorter ones are words like "TRUST").
// A party that is itself a public place the page names anyway ("CONDIT TOWNSHIP", "BUREAU COUNTY,
// ILLINOIS") is not a private name: skipped when its words are only place words of this county or a county name.
const PLACE_WORDS = new Set(["TOWNSHIP", "TOWN", "COUNTY", "VILLAGE", "CITY", "OF", "THE", "STATE", "ILLINOIS", "WISCONSIN"]);
// every county name in IL and WI is a place word too (a neighbor county can be a party)
const COUNTY_NAMES = [];
for (const s of ["il", "wi"]) try { COUNTY_NAMES.push(...Object.values(JSON.parse(read(`data/land/${s}/summary.json`)).counties).map((c) => c.name)); } catch (e) { /* no summary */ }
function privateValues(f) {
  const ix = PRIVATE.map((c) => f.cols.indexOf(c)).filter((i) => i >= 0);
  const place = words([f.county, ...COUNTY_NAMES, ...Object.values(f.munis || {}).map((m) => m[0])].join(" "));
  const out = new Set();
  for (const r of f.rows) for (const i of ix) {
    const v = r[i];
    if (v == null || String(v).trim().length < 6) continue;
    const ws = [...words(v)];
    if (ws.length && ws.every((w) => PLACE_WORDS.has(w) || place.has(w)) && ws.some((w) => PLACE_WORDS.has(w))) continue;
    // one plain word ("FARMLAND") is a word the page uses, not a name; one word with a digit (a document number) counts
    if (ws.length < 2 && !/\d/.test(v)) continue;
    out.add(norm(v));
  }
  return out;
}
// A name is on a page when every word of it is on the page and the whole string is too.
function leaks(text, vals) {
  const W = words(text), T = norm(text), hit = [];
  for (const v of vals) {
    const ws = [...words(v)];
    if (ws.length && ws.every((w) => W.has(w)) && T.includes(v)) hit.push(v);
  }
  return hit;
}

test("summary files hold only counts, acres, prices, dates and place names: no field a name could ride in", () => {
  for (const [s] of STATES) {
    const sum = JSON.parse(read(`data/land/${s}/summary.json`));
    for (const k of Object.keys(sum)) assert.ok(TOP_KEYS.has(k), `${s} summary has an unexpected top-level field ${k}`);
    const files = new Map(countyFiles(s).map((f) => [f.fips, f]));
    for (const [fips, c] of Object.entries(sum.counties)) {
      for (const k of Object.keys(c)) assert.ok(COUNTY_KEYS.has(k), `${s} ${fips} has an unexpected field ${k}`);
      const f = files.get(fips);
      assert.ok(f, `${s} ${fips}: summary county without a county file`);
      assert.equal(c.name, f.county, `${s} ${fips}: the county name is the county's`);
      const places = new Set(Object.values(f.munis || {}).map((m) => m[0]));
      for (const r of [...(c.large || []), ...(c.out || [])]) {
        assert.match(r[0], ISO, `${s} ${fips}: a sale row starts with its date`);
        for (const x of r.slice(1, 4)) assert.ok(x == null || typeof x === "number", `${s} ${fips}: acres, price and $/acre are numbers`);
        assert.ok(r[4] == null || places.has(r[4]), `${s} ${fips}: "${r[4]}" is not a township or town from the county file`);
        if (r.length > 5) assert.ok(r[5] === 1 || r[5] === -1, `${s} ${fips}: direction flag`);
        assert.ok(r.length <= 6, `${s} ${fips}: a sale row has extra fields`);
      }
      for (const k of ["why_chg", "why_p"]) if (c[k] != null) assert.match(c[k], /^(acres unknown on \d+ of \d+ market sales in the last 12 months and \d+ of \d+ in the 12 before|records start [\w ,-]+)$/, `${s} ${fips} ${k}`);
    }
  }
});

test("no buyer or seller name, legal, parcel id or document number from any county file is in its summary", () => {
  for (const [s] of STATES) {
    const sum = JSON.parse(read(`data/land/${s}/summary.json`));
    for (const f of countyFiles(s)) {
      const c = sum.counties[f.fips];
      if (!c) continue;
      const hit = leaks(JSON.stringify(c), privateValues(f));
      assert.deepEqual(hit, [], `${s} ${f.fips}: private values in the summary`);
    }
  }
});

test("indexed Atlas pages for IL and WI carry no private value, before and after the sales block draws", () => {
  for (const [s, dir] of STATES) {
    const sum = JSON.parse(read(`data/land/${s}/summary.json`));
    const pages = new Map();
    for (const n of readdirSync(join(ROOT, "farmland-atlas", dir))) {
      const h = read(`farmland-atlas/${dir}/${n}`);
      const m = /data-atlas-sales="county" data-st="[A-Z]{2}" data-fips="(\d{5})"/.exec(h);
      if (m) pages.set(m[1], h);
    }
    assert.ok(pages.size > 50, `${s}: county pages with the sales block`);
    for (const f of countyFiles(s)) {
      const h = pages.get(f.fips);
      if (!h) continue;
      const drawn = S.countyHTML(sum, f.fips, { v: 9000, year: 2022, flag: false });
      const sheet = S.sheetHTML(sum, f.fips, (l, r, x) => `${l} ${r} ${x}`, (l, r) => `${l} ${r}`);
      assert.deepEqual(leaks(h + drawn + sheet, privateValues(f)), [], `${s} ${f.fips}: private values on the page`);
      assert.doesNotMatch(drawn + sheet, /grantor|grantee|buyer:|seller:/i);
    }
  }
});

test("the Atlas builder never opens a county transfer file, and /data/land/ stays out of search", () => {
  const py = read("scripts/build_atlas_pages.py");
  assert.doesNotMatch(py, /data\/land\/[^"']*\d{5}|"\d{5}\.json"|grantor|grantee/);
  assert.match(read("robots.txt"), /^Disallow: \/data\/land\/$/m);
  for (const [s] of STATES) assert.doesNotMatch(read(`data/land/${s}/summary.json`), /"(grantor|grantee|legal|pid|doc)"/);
});
