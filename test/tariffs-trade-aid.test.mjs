// Trade-aid row on /tariffs: every number as FSA published it (program page and
// the Dec 31, 2025 payment rates release, saved on the references branch as
// fsa-fba-program and fsa-fba-rates, Oct 17, 2026), with the source named.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HTML = readFileSync(new URL("../tariffs.html", import.meta.url), "utf8");
const row = (HTML.match(/<section class="tariff-section" id="trade-aid"[\s\S]*?<\/section>/) || [""])[0];

test("the trade-aid row is on the page with FSA's rates", () => {
  assert.ok(row, "trade-aid section present");
  for (const s of ["corn $44.36", "soybeans $30.88", "wheat $39.35", "sorghum $48.11", "oats $81.75", "cotton $117.35", "rice $132.89"]) {
    assert.ok(row.includes(s), s);
  }
});

test("limits and dates match the FSA program page", () => {
  assert.match(row, /\$155,000 per producer/);
  assert.match(row, /over \$900,000/);
  assert.match(row, /closed April 17, 2026/);
  assert.match(row, /Dec 31, 2025/);
});

test("names its source, and no em dash", () => {
  assert.match(row, /href="https:\/\/www\.fsa\.usda\.gov\/fba"/);
  assert.match(row, /read Oct 17, 2026/);
  assert.ok(!row.includes("—"));
});
