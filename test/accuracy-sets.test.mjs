// The sets accuracy pass (scripts/accuracy_pass.py sets, scripts/accuracy_sets.py):
// its offline selftest passes, and every generated set named in the brief is covered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("accuracy pass selftest (sets mode included) passes offline", () => {
  const out = execFileSync("python3", ["scripts/accuracy_pass.py", "selftest"], { encoding: "utf8" });
  assert.match(out, /selftest ok/);
});

test("every generated page set is in the sets list, and the prompt has no em dash", () => {
  const src = readFileSync("scripts/accuracy_sets.py", "utf8");
  for (const g of ["rain/*/*.html", "prf/*/*.html", "prf/*.html", "farmland-atlas/*/*.html", "arc-plc/*/*.html",
                   "hail-map/*.html", "hail/*.html", "yield/*.html", "cash-bids/*/*.html", "cash-bids/company/*.html",
                   "rent/*.html", "cattle-auction-prices.html", "cash-bids/*/index.html", "drought-monitor.html", "daily/*.html"]) {
    assert.ok(src.includes(`"${g}"`), `missing set ${g}`);
  }
  assert.ok(!src.includes("—"), "no em dash in the checker prompt");
  assert.match(src, /"template": the program/);
});
