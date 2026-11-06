// Nov 6: the page parts a browser draws from USDA NASS figures carry the NASS notice too (#362 put it on the pages and
// builders): Your area and the Your state blocks (crop progress, state forecasts) and the comp report (NASS cash rents,
// Cropland Data Layer). One wording, from scripts/credits.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const NOTICE = /NASS_NOTICE = "([^"]+)"/.exec(read("scripts/credits.py"))[1];

test("each NASS-drawing component prints the NASS notice beside its source line", () => {
  assert.equal(NOTICE, "This product uses the NASS API but is not endorsed or certified by NASS.");
  for (const f of ["components/your-area.js", "components/your-state.js"]) {
    const s = read(f);
    assert.ok(s.includes("(/NASS/.test(src.join(' ')) ? ' " + NOTICE + "' : '')"), f + ": the notice follows a NASS source line");
  }
  assert.ok(read("components/comp-report.js").includes("Crop history: USDA NASS Cropland Data Layer. " + NOTICE), "comp report");
});
