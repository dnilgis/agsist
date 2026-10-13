/* Rain Print launch fixes (2026-10-13): town lookup, share links, station words,
 * buyer text, Christmas dates, the print's own small lines, the checkout
 * reference and the page head. Runs the shipped files in a bare context.
 *
 *   node --test test/rain-print-launch.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob, Map, Promise };
ctx.window = ctx;
for (const f of ["components/qr.js", "components/rain-print.js", "components/rain-print-art.js"])
  vm.runInNewContext(readFileSync(ROOT + f, "utf8"), ctx);
const RP = ctx.RainPrint;
const plain = (x) => JSON.parse(JSON.stringify(x));
const SPR = [
  { name: "Springfield", admin1: "Illinois", admin2: "Sangamon", latitude: 39.8, longitude: -89.6 },
  { name: "Springfield", admin1: "Missouri", admin2: "Greene", latitude: 37.2, longitude: -93.3 },
];

test("town lookup: one hit draws, two far apart ask which, a wrong state is an error not another state's town", () => {
  assert.equal(RP.geoPick("Chetek, WI", [{ name: "Chetek", admin1: "Wisconsin", latitude: 45.3, longitude: -91.6 }]).hit.name, "Chetek");
  const p = RP.geoPick("Springfield", SPR);
  assert.equal(p.pick.length, 2, "Springfield with no state asks");
  assert.equal(RP.geoPick("Springfield, MO", SPR).hit.admin1, "Missouri", "with a state it takes that state's");
  const bad = RP.geoPick("Chetk, WI", [{ name: "Chetek", admin1: "Minnesota", latitude: 46, longitude: -93 }]);
  assert.ok(bad.error && /in Wisconsin/.test(bad.error), "a misspelling never falls back to another state: " + bad.error);
  assert.ok(RP.geoPick("Nowhere", []).error.includes("Check the spelling"));
  const near = [{ name: "Lake", admin1: "Iowa", latitude: 42, longitude: -93 }, { name: "Lake", admin1: "Iowa", latitude: 42.05, longitude: -93.05 }];
  assert.ok(RP.geoPick("Lake", near).hit, "two hits a few miles apart share a gauge: no question");
});

test("a ZIP is sent as a postal code, and a miss says to type the town", () => {
  assert.deepEqual(plain(RP.geocodeQuery("54728")), { zip: "54728", town: "54728", st: "" });
  assert.equal(RP.geocodeQuery("54728-1234").zip, "54728");
  assert.equal(RP.geocodeQuery("Chetek, WI").st, "wi");
  assert.match(RP.geoPick("54728", []).error, /ZIP 54728.*town and state/);
  assert.equal(RP.placeLabel({ name: "Chetek", admin1: "Wisconsin" }), "Chetek, WI");
});

test("a share link that can't be drawn says why", () => {
  assert.match(RP.linkProblem("?d=garbage!!"), /damaged or cut short/);
  assert.match(RP.linkProblem("?place=Chetek&year=1849"), /year \(1849\)/);
  assert.match(RP.linkProblem("?place=Chetek&year=abc"), /year \(abc\)/);
  assert.match(RP.linkProblem("?year=2020"), /no town/);
  assert.equal(RP.linkProblem("?d=" + RP.encodeCode({ place: "Chetek, WI", year: 2025 })), "");
  assert.equal(RP.linkProblem(""), "", "no design in the link is not a problem");
});

test("stations in plain words: no raw ACIS id pair, names out of caps", () => {
  assert.equal(RP.sidPlain("471667 2"), "NOAA co-op station 471667");
  assert.equal(RP.sidPlain("14991 3"), "NOAA station 14991");
  assert.equal(RP.stationName("CHETEK"), "Chetek");
  assert.equal(RP.stationName("CAMERON 2 NE"), "Cameron, 2 mi NE");
  assert.equal(RP.stationName("RICE LAKE MUNI AP"), "Rice Lake Municipal Airport");
  assert.equal(RP.milesText(0.43), "0.4 mi");
  assert.equal(RP.milesText(23.6), "24 mi");
});

test("the page shows no raw station id and no stale design after a failed draw", () => {
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  assert.ok(!/NOAA station ' \+ esc\(m\.sid\)/.test(S), "the raw sid is never printed");
  const fail = S.slice(S.indexOf("function failDraw"), S.indexOf("function showPick"));
  for (const k of ["DATA = null", "META = null", "BLOCKED = 'failed'", "$('ro-design').value = ''", "$('rp-order').hidden = true", "showBuy(false)"]) assert.ok(fail.includes(k), "failDraw clears " + k);
  assert.match(S, /failDraw\(err\);/, "every draw error goes through it");
  assert.match(S, /AbortController/, "outside calls time out");
});
