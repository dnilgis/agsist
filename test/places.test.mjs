/* Our own place lookup (components/places.js over data/places/, scripts/build_places.py), 2026-10-29.
 * Every ZIP and town box on the site used to ask Open-Meteo's geocoder; these are the answers the
 * pages now get from files we serve, and the failure modes they must tell apart. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const P = require(path.join(ROOT, "components/places.js"));

// the files, as the site serves them; a missing file is a 404, like GitHub Pages
const disk = async (url) => {
  const f = path.join(ROOT, url.replace(/^\//, ""));
  if (!existsSync(f)) return { ok: false, status: 404, json: async () => ({}) };
  const body = readFileSync(f, "utf8");
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
};
const lib = () => P.make({ get: disk });

test("the build's own checks pass (fold, shards, ZIP rows)", () => {
  const out = execFileSync("python3", [path.join(ROOT, "scripts/build_places.py"), "--selftest"], { encoding: "utf8" });
  assert.doesNotMatch(out, /FAIL/, out);
});

test("the page folds a name the same way the build does", () => {
  const names = ["St. Paul", "Saint-Hyacinthe", "Qu'Appelle", "Ste. Genevieve", "Mt. Pleasant", "Ft. Dodge", "Coeur d'Alene", "Montréal", "La Crosse"];
  const py = execFileSync("python3", ["-I", "-c",
    "import sys,json; sys.path.insert(0, sys.argv[1]); from build_places import fold; print(json.dumps([fold(n) for n in json.loads(sys.argv[2])]))",
    path.join(ROOT, "scripts"), JSON.stringify(names)], { encoding: "utf8" });
  assert.deepEqual(names.map(P.fold), JSON.parse(py));
});

test("a ZIP gives its town, state and county from our own table", async () => {
  const d = await lib().search("54728", { country: "US" });
  assert.equal(d.results.length, 1);
  const r = d.results[0];
  assert.equal(r.name, "Chetek");
  assert.equal(r.admin1, "Wisconsin");
  assert.equal(r.admin2, "Barron");
  assert.deepEqual(r.postcodes, ["54728"]);
  assert.ok(Math.abs(r.latitude - 45.3) < 0.1 && Math.abs(r.longitude + 91.65) < 0.1, JSON.stringify(r));
  // the same point the bids repo's ZIP shard holds: [lat, lon] first
  const row = JSON.parse(readFileSync(path.join(ROOT, "data/places/zip/54.json"), "utf8"))["54728"];
  assert.deepEqual(row.slice(0, 2), [r.latitude, r.longitude]);
});

test("a ZIP that is not a ZIP is an empty answer, not an error", async () => {
  assert.deepEqual(await lib().search("00000", { country: "US" }), { results: [] });
  assert.equal(await lib().zip("abcde"), null);
});

test("a town: exact name first, biggest first; a state narrows it in the page", async () => {
  const d = await lib().search("Springfield", { country: "US", count: 10 });
  assert.ok(d.results.length >= 5, "many Springfields");
  assert.ok(d.results[0].population >= d.results[1].population);
  assert.ok(d.results.every((r) => r.name === "Springfield"));
  const mo = d.results.find((r) => r.admin1 === "Missouri");
  assert.equal(mo.admin2, "Greene");
});

test("St. Paul finds Saint Paul; a small farm town comes from its ZIP codes and says so", async () => {
  const d = await lib().search("St. Paul", { country: "US" });
  assert.equal(d.results[0].name, "Saint Paul");
  assert.equal(d.results[0].admin1, "Minnesota");
  const m = await lib().search("Maida", { country: "US" });
  const nd = m.results.find((r) => r.admin1 === "North Dakota");
  assert.ok(nd, "Maida, ND is in the list");
  assert.equal(nd.approx, true, "its point is the middle of its ZIP points, flagged");
  assert.ok(nd.postcodes.includes("58255"));
});

test("a partial name falls back to the names that start with it", async () => {
  const d = await lib().search("Chete", { country: "US" });
  assert.ok(d.results.some((r) => r.name === "Chetek" && r.admin1 === "Wisconsin"));
});

test("Canada: a province's towns, by their province's full name", async () => {
  const d = await lib().search("Regina", { country: "CA" });
  assert.equal(d.results[0].admin1, "Saskatchewan");
  assert.equal(d.results[0].country_code, "CA");
  const q = await lib().search("Saint-Hyacinthe", { country: "CA" });
  assert.equal(q.results[0].admin1, "Quebec");
});

test("no file for those letters is no town; a lookup that does not answer rejects", async () => {
  assert.deepEqual(await lib().search("Qzxv", { country: "US" }), { results: [] });
  const down = P.make({ get: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  await assert.rejects(down.search("Chetek", { country: "US" }));
  const net = P.make({ get: async () => { throw new TypeError("Failed to fetch"); } });
  await assert.rejects(net.zip("54728"));
});

test("no file on the site still names Open-Meteo's geocoder", () => {
  let files = "";
  try {
    files = execFileSync("git", ["grep", "-l", "geocoding-api.open-meteo.com", "--", ".", ":!test", ":!data/rain-print-examples", ":!references", ":!data/changelog.json", ":!data/whats-new*", ":!changelog.html"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch (e) {
    if (e.status !== 1) throw e;   // git grep: 1 is "nothing found"
  }
  assert.equal(files, "", "still asking Open-Meteo for places:\n" + files);
});
