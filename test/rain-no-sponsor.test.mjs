// Sig, 2026-10-15: no sponsor on the Rain Print or rain gauge pages, sold or open.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ROOT = new URL("../", import.meta.url).pathname;
test("Rain Print, gift card and rain gauge pages carry no sponsor slot, and no slot list names them", () => {
  for (const f of ["rain-print.html", "rp-gift.html", "rain-gauge.html", "rain-print-business.html", "gifts-for-farmers.html"]) {
    const html = readFileSync(ROOT + f, "utf8").replace(/<a href="\/sponsor">Sponsor<\/a>/g, "");
    assert.ok(!/ag-sponsor-ribbon|data-slot=|Sponsor this page|sponsor-slot/i.test(html), f + " has a sponsor slot");
  }
  for (const f of ["data/sponsor-slots.json", "data/page-sponsors.json", "data/geo-sponsors.json"])
    assert.ok(!/rain-print|rain-gauge|rp-gift/.test(readFileSync(ROOT + f, "utf8")), f + " names a rain page");
});

// Oct 28 (Sig): the state-targeted sponsor (components/geo-sponsor.js) is never loaded on these pages either.
test("the state-targeted sponsor skips Rain Print, gift card, gift and rain gauge pages, in the loader and in the component", async () => {
  const L = readFileSync(ROOT + "components/loader.js", "utf8");
  const m = /var GEO_SKIP = (\/.+\/);\n/.exec(L);
  assert.ok(m, "loader.js lists the pages the geo sponsor skips");
  const SKIP = new RegExp(m[1].slice(1, -1));
  const { createRequire } = await import("node:module");
  const G = createRequire(import.meta.url)(ROOT + "components/geo-sponsor.js");
  for (const f of ["rain-print.html", "rp-gift.html", "rain-gauge.html", "rain-print-business.html", "gifts-for-farmers.html",
    "rain-print-approve.html", "birth-year-weather-gift.html", "wedding-year-weather-gift.html", "farm-anniversary-gifts.html", "farmer-retirement-gifts.html"]) {
    for (const p of ["/" + f, "/" + f.replace(/\.html$/, "")]) {
      assert.ok(SKIP.test(p), "loader loads the geo sponsor on " + p);
      assert.ok(G.excluded(p), "geo-sponsor.js would draw on " + p);
    }
    assert.ok(!/geo-sponsor/.test(readFileSync(ROOT + f, "utf8")), f + " names the geo sponsor");
  }
});
