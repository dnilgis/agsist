/* The sibling worklist never invents a state.
 *
 * This file exists because the whole value of the worklist is that a row
 * carrying a state can be trusted to become a source. A wrong state is a wrong
 * town is a wrong coordinate on the coverage map — rule 1, one step removed.
 *
 * So the rules the resolver must obey are checked directly, and each is proved
 * by the case that would break it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SRC = readFileSync(ROOT + "scripts/board-siblings.mjs", "utf8");
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("it reads the wide directory, not just the narrow one", () => {
  /* The sweep's join uses data/known-elevators.json (1,802 rows). The reason
     337 locations sit unread is partly that data/directory.json holds 4,581,
     including the state registries, and nothing consulted it. */
  assert.match(code, /data\/directory\.json/,
    "the resolver does not read data/directory.json, which is the whole point");
});

test("a label that names its own state is believed over the source's state", () => {
  /* CoMark's source record says KS. Its own board says BAKER OK, CONLEY TX,
     DARROUZETT TX. Scoping to the source's state guarantees a miss on a
     co-op's out-of-state siblings, and co-ops cross state lines constantly. */
  assert.match(code, /splitState/, "no label-carries-its-own-state parsing");
  const m = code.match(/function splitState[\s\S]*?\n\}/);
  assert.ok(m, "splitState is not a readable function any more");
  assert.match(m[0], /US\.has/,
    "splitState accepts any two letters as a state — 'CORN IN' is a town, not Indiana");
});

test("AMBIGUOUS IS REFUSED, NOT GUESSED", () => {
  /* A town name in several states with nothing to choose between them is a
     coin toss, and a coin toss here becomes a pin on a map in the wrong
     state. 18 of the 337 are this. They must stay refused. */
  assert.match(code, /AMBIGUOUS/, "nothing marks the ambiguous case");
  const amb = code.match(/states\.size > 1[\s\S]{0,400}?ambiguous\+\+/);
  assert.ok(amb, "the ambiguous branch does not increment its own counter");
  assert.match(amb[0], /r\.state = ""/,
    "an ambiguous row is given a state — that is a guess, and it must be blank");
});

test("a location with no id is skipped, because nothing could address it", () => {
  assert.match(code, /if \(!m\) continue;/,
    "an entry with no (locationId) is being kept, and it cannot be turned into a source");
});

test("it writes a worklist and does NOT write sources", () => {
  assert.match(code, /data\/gaps\/board-siblings\.csv/, "no worklist is written");
  assert.ok(!/sources\/[^"]*",\s*JSON\.stringify/.test(code) && !/writeFileSync\([^)]*sources\//.test(code),
    "this script writes into sources/ — placing a source is agricharts-sweep's " +
    "job and it has checks this does not");
});

test("a coordinate is looked up, never computed", () => {
  /* The worklist copies a coordinate this repository already recorded for
     that town. It must never derive one — no averaging of nearby towns, no
     nudging a centroid, no arithmetic on lat/lon at all. */
  const block = code.match(/const placeCoord[\s\S]*?\n\}/);
  assert.ok(block, "placeCoord is not a readable block any more");
  assert.ok(!/lat\s*[*+/-]|\blat\s*\/|\+\s*rec\.lat/.test(block[0]),
    "the coordinate is being computed rather than copied");
  assert.match(block[0], /rec\.lat/, "the coordinate is not taken from places.json");
  assert.match(block[0], /precision|via/, "provenance is dropped on the way through");
});

test("the count of exposed locations is DISTINCT, not one per mention", () => {
  /* 670 data files each list their own siblings, so counting mentions
     reported 17,304 locations for a country with 4,581 known elevators.
     A number wrong in the flattering direction is the worst kind. */
  assert.match(code, /exposedSet/,
    "locations are counted per mention, which multiplies them by the number of " +
    "sibling files on the same board");
});

test("the worklist it last wrote is internally consistent", () => {
  const f = ROOT + "data/gaps/board-siblings.csv";
  if (!existsSync(f)) return;                 /* not run yet — not a failure */
  const lines = readFileSync(f, "utf8").trim().split("\n");
  assert.match(lines[0], /^operator,label,state,how_the_state_was_decided,lat,lon,precision,via,location_id,platform,board_url$/);
  const US = new Set(("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT " +
    "NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split(" "));
  let placed = 0;
  for (const line of lines.slice(1)) {
    const cells = [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));
    assert.equal(cells.length, 11, "malformed row: " + line.slice(0, 80));
    const [, , state, how, lat, lon, precision, via, id] = cells;
    /* A COORDINATE MUST SAY HOW IT WAS MADE. Rule 45. A row carrying a
       lat/lon with no precision and no `via` is a pin with no provenance,
       which is the thing the coverage map exists not to draw. */
    if (lat || lon) {
      assert.ok(lat && lon, "half a coordinate: " + line.slice(0, 80));
      assert.ok(precision && via,
        "a coordinate with no precision or no via — rule 45: " + line.slice(0, 80));
      assert.ok(state, "a coordinate on a row with no state: " + line.slice(0, 80));
      assert.ok(Math.abs(+lat) <= 90 && Math.abs(+lon) <= 180,
        "coordinate out of range: " + line.slice(0, 80));
      /* Continental US, loosely. A US elevator at lon +90 is a transposition. */
      assert.ok(+lat > 18 && +lat < 72 && +lon < -60 && +lon > -180,
        "coordinate is not in the United States: " + line.slice(0, 80));
    }
    assert.ok(id.length, "a row carries no location id: " + line.slice(0, 80));
    if (state) {
      placed++;
      assert.ok(US.has(state), `"${state}" is not a US state code`);
      assert.ok(how && !/AMBIGUOUS/.test(how),
        "a row is both placed and ambiguous, which cannot both be true: " + line.slice(0, 80));
    } else {
      assert.ok(/AMBIGUOUS|no town/.test(how),
        "a row has no state and no reason why: " + line.slice(0, 80));
    }
  }
  assert.ok(placed > 0, "the worklist placed nothing at all — the resolver is broken");
});
