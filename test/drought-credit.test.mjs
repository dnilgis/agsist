// The Drought Monitor's credit line, as its permission page asks (droughtmonitor.unl.edu/About/Permission.aspx,
// read Nov 6, 2026), on /drought-monitor: the page the other drought lines on the site point to. Plain text, no link
// (Oct 29: no direct links to data sources).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const page = readFileSync(fileURLToPath(new URL("../drought-monitor.html", import.meta.url)), "utf8");

test("the drought page carries NDMC's credit line, as text", () => {
  assert.ok(page.includes("The U.S. Drought Monitor is jointly produced by the National Drought Mitigation Center at the University of Nebraska-Lincoln, the U.S. Department of Agriculture, the National Oceanic and Atmospheric Administration and NASA. Map and data courtesy of NDMC, via https://droughtmonitor.unl.edu."));
  assert.doesNotMatch(page, /<a [^>]*href="https?:\/\/droughtmonitor\.unl\.edu/, "the credit names the site; it does not link to it");
});
