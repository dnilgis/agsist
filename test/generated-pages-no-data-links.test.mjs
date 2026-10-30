// Sig, Oct 29 2026: no direct links to data sources; the source is named in plain text with its date.
// The generated sets (rain, ARC/PLC, cash bids, Farmland Atlas, land sales) carry none, and a page
// that names a source keeps the name and a year beside it. The rule is scripts/source_links.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { scan, unlink } from "../scripts/source_links.mjs";

const ROOT = new URL("../", import.meta.url).pathname;
const walk = (d) => readdirSync(ROOT + d).flatMap((n) => {
  const p = d + "/" + n;
  return statSync(ROOT + p).isDirectory() ? walk(p) : p.endsWith(".html") ? [p] : [];
});
const SETS = ["rain", "arc-plc", "cash-bids", "farmland-atlas", "land-sales", "prf", "yield", "basis", "daily", "embed"];

for (const set of SETS) {
  test(`${set}: no page links straight at a data source`, () => {
    const bad = [];
    for (const f of walk(set)) {
      const u = scan(readFileSync(ROOT + f, "utf8"));
      if (u.length) bad.push(f + " " + u[0]);
    }
    assert.deepEqual(bad.slice(0, 5), [], `${bad.length} page(s) still link a data source`);
  });
}

test("unlink keeps the source name and the date as text", () => {
  const s = 'Source: <a href="https://quickstats.nass.usda.gov/results/x" target="_blank">USDA NASS</a>, Oct 2026. <a href="/arc-plc">Our page</a>';
  assert.equal(unlink(s), 'Source: USDA NASS, Oct 2026. <a href="/arc-plc">Our page</a>');
});

test("a sample of generated pages still names a source and a year", () => {
  for (const set of SETS) {
    const files = walk(set).filter((_, i) => i % 97 === 0);
    for (const f of files) {
      const t = readFileSync(ROOT + f, "utf8").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ");
      if (!/\bsource/i.test(t)) continue;
      assert.match(t, /(USDA|NOAA|NASS|NWS|FSA|RMA|EIA|AMS|AGSIST|Drought Monitor|Census|Fed)/, f + ": no source name");
      assert.match(t, /20\d\d/, f + ": no year");
    }
  }
});
