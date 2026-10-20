/* scripts/fetch_prf_outlook.py text_of(): every HTML entity CPC writes comes out as the character.
 * The real case: CPC's ENSO discussion of Oct 8, 2026 wrote "83&#37; chance", and /prf printed
 * "83&#37;" in the Long-range outlook until text_of() unescaped every entity, not a hand list.
 *   node --test test/prf-outlook-text.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const py = (code) => execFileSync("python3", ["-c", "import sys; sys.path.insert(0, 'scripts'); import fetch_prf_outlook as F\n" + code], { cwd: ROOT, encoding: "utf8" }).trim();

const REAL = "<p><strong>Synopsis:</strong> El Ni&ntilde;o continues to strengthen, with a strong-to-very strong El Ni&ntilde;o likely through January-March 2027 (remaining greater than an 83&#37; chance).</p>";

test("text_of turns CPC's 83&#37; into 83%", () => {
  const t = py("print(F.text_of(" + JSON.stringify(REAL) + "))");
  assert.ok(t.includes("greater than an 83% chance"), t);
  assert.ok(!/&#\d+;|&[a-z]+;/i.test(t), "an entity is left: " + t);
  assert.ok(t.includes("El Nino continues"), "n with tilde still reads n: " + t);
});

test("the ENSO synopsis parsed from that discussion reads 83%", () => {
  const page = "<html><body><p>ENSO Alert System Status: El Ni&ntilde;o Advisory</p><p>issued by CLIMATE PREDICTION CENTER 8 October 2026</p>" + REAL + "<p></p>\n\n<p>Discussion</p></body></html>";
  const out = JSON.parse(py("import json; print(json.dumps(F.parse_enso_disc(" + JSON.stringify(page) + ")))"));
  assert.equal(out.status, "El Nino Advisory");
  assert.equal(out.issued, "2026-10-08");
  assert.match(out.synopsis, /greater than an 83% chance\)\.$/);
});

test("the outlook file on the site carries no raw entity, and PRF copy says center", () => {
  const o = readFileSync(ROOT + "data/prf/outlook.json", "utf8");
  assert.ok(!/&#\d+;/.test(o), "a numeric entity is in data/prf/outlook.json");
  for (const f of ["components/prf-outlook.js", "components/prf-now.js", "components/prf.js", "components/prf-optimize-ui.js"]) {
    assert.ok(!/centre/i.test(readFileSync(ROOT + f, "utf8")), f + " says centre");
  }
  assert.ok(!/centred/.test(readFileSync(ROOT + "components/prf-optimize.js", "utf8")), "prf-optimize.js says centred");
});
