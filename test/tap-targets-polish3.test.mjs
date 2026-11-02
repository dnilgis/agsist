// Tap targets on the grain bin and hail map pages stay at 40 px (polish3, Oct 30, 2026).
// node --test test/tap-targets-polish3.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("grain bin depth slider is at least 40 px tall", () => {
  const h = readFileSync("grain-bin-calculator.html", "utf8");
  assert.match(h, /\.depth-row input\[type="range"\]\s*\{[^}]*min-height:\s*40px/);
});

test("hail map zoom buttons are 40 px on phones", () => {
  const h = readFileSync("hail-map.html", "utf8");
  assert.match(h, /\.leaflet-touch \.leaflet-bar a\{width:40px;height:40px;line-height:40px\}/);
});
