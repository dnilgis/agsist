/* Layer registry: data/layers.json and components/layers.js.
 *   node --test test/layers.test.mjs
 * The full disk checks (atlas blocks, files, robots.txt) are in scripts/check_layers.py;
 * this runs the reader module and the checks that tie the registry to the live code. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);
const AGL = require(join(ROOT, "components/layers.js"));
const F = require(join(ROOT, "field-scout-layers.js"));
const RAW = read("data/layers.json");
const REG = JSON.parse(RAW);
const R = AGL.load(REG);

test("reader: byId, byGroup, forScope, privacy", () => {
  assert.equal(R.version, 1);
  assert.equal(R.list.length, REG.layers.length);
  assert.equal(R.byId.rent.group, "money");
  assert.ok(R.byGroup.water.some((l) => l.id === "flood"));
  const field = R.forScope("field").map((l) => l.id);
  assert.ok(field.includes("soil_productivity") && field.includes("flood"));
  assert.ok(!field.includes("rent"));
  assert.ok(R.forScope("county").every((l) => l.scope.includes("county")));
  assert.equal(R.privacy("land_transfers"), "names-noindex");
  assert.equal(R.privacy("land_sales_summary"), "public");
  assert.equal(R.privacy("parcels"), "owner-live-only");
  assert.equal(R.privacy("no_such_layer"), "names-noindex", "unknown ids read as the strictest class");
  assert.deepEqual(AGL.load(RAW).byId.flood, R.byId.flood, "takes JSON text too");
});

test("reader: refuses a repeated id or a missing list", () => {
  assert.throws(() => AGL.load({ layers: [{ id: "a" }, { id: "a" }] }), /duplicate/);
  assert.throws(() => AGL.load({}), /no layers/);
});

test("registry: every entry complete, ids unique, sorted by group, under 60 KB", () => {
  assert.ok(Buffer.byteLength(RAW) < 60 * 1024);
  const ids = REG.layers.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  const order = REG.groups;
  for (const l of REG.layers) {
    for (const k of ["label", "source", "source_url", "license", "group", "scope", "fetch", "fresh", "privacy", "better"]) {
      assert.ok(l[k] !== undefined && l[k] !== null && l[k] !== "", l.id + " has " + k);
    }
    assert.ok("explain" in l && "unit" in l, l.id + " has explain and unit keys");
    assert.ok(AGL.KINDS.includes(l.fetch.kind), l.id + " fetch.kind");
    assert.ok(AGL.PRIVACY.includes(l.privacy), l.id + " privacy");
    assert.ok(order.includes(l.group), l.id + " group");
    assert.ok(["higher", "lower", "none"].includes(l.better), l.id + " better");
    assert.ok(l.source_url.startsWith("https://"), l.id + " source_url");
  }
  const gi = REG.layers.map((l) => order.indexOf(l.group));
  assert.deepEqual(gi, [...gi].sort((a, b) => a - b), "sorted by group");
});

test("registry matches field-scout-layers.js URLS and FEEDLOTS exactly", () => {
  const live = REG.layers.filter((l) => l.fetch.kind === "live");
  for (const [key, url] of Object.entries(F.URLS)) {
    const l = live.find((x) => !x.fetch.table && x.fetch.key === key);
    assert.ok(l, "URLS." + key + " has a registry entry");
    assert.deepEqual(l.fetch.url, url, "URLS." + key + " same url");
  }
  for (const [st, f] of Object.entries(F.FEEDLOTS)) {
    const l = live.find((x) => x.fetch.table === "FEEDLOTS" && x.fetch.key === st);
    assert.ok(l, "FEEDLOTS." + st + " has a registry entry");
    assert.equal(l.fetch.url, f.url);
  }
  for (const l of live) {
    const src = l.fetch.table === "FEEDLOTS" ? F.FEEDLOTS[l.fetch.key] && F.FEEDLOTS[l.fetch.key].url : F.URLS[l.fetch.key];
    assert.ok(l.fetch.key in (l.fetch.table === "FEEDLOTS" ? F.FEEDLOTS : F.URLS), l.id + " key is in the page code");
    assert.deepEqual(l.fetch.url, src, l.id + " url is the page's url");
  }
});

test("worker routes exist in workers/fieldscout-worker.js", () => {
  const routes = new Set([...read("workers/fieldscout-worker.js").matchAll(/seg\[0\]\s*===\s*'([a-z0-9_-]+)'/g)].map((m) => m[1]));
  for (const l of REG.layers.filter((x) => x.fetch.kind === "worker")) {
    assert.ok(routes.has(l.fetch.route.replace(/^\//, "")), l.id + " route " + l.fetch.route);
  }
});

test("atlas blocks and site files exist", () => {
  const c = JSON.parse(read("data/atlas/counties/55005.json"));
  for (const l of REG.layers.filter((x) => x.fetch.kind === "atlas-county")) assert.ok(l.fetch.block in c, l.id);
  const sample = { "{ST}": "WI", "{st}": "wi", "{fips}": "55027" };
  for (const l of REG.layers.filter((x) => x.fetch.kind === "state-file" && !/\{(cell|date)\}/.test(x.fetch.path))) {
    const p = l.fetch.path.replace(/\{ST\}|\{st\}|\{fips\}/g, (m) => sample[m]);
    assert.ok(existsSync(join(ROOT, p)), l.id + " " + p);
  }
});

test("names stay out of search: names-noindex files sit under robots.txt Disallow", () => {
  const dis = read("robots.txt").split("\n").map((s) => s.split("#")[0].trim())
    .filter((s) => /^disallow:/i.test(s)).map((s) => s.slice(9).trim()).filter(Boolean);
  const named = REG.layers.filter((l) => l.privacy === "names-noindex");
  assert.ok(named.length >= 1);
  for (const l of named) {
    assert.equal(l.fetch.kind, "state-file", l.id);
    assert.ok(dis.some((d) => ("/" + l.fetch.path).startsWith(d)), l.id + " under a Disallow");
  }
  const sum = JSON.parse(read("data/land/wi/summary.json"));
  assert.ok(!("names" in sum) && !("rows" in sum), "the public sales summary carries no names");
});

test("copy: no em dashes in the registry", () => {
  assert.ok(!RAW.includes("—"));
});
