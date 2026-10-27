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
  for (const f of ["data/sponsor-slots.json", "data/page-sponsors.json"])
    assert.ok(!/rain-print|rain-gauge|rp-gift/.test(readFileSync(ROOT + f, "utf8")), f + " names a rain page");
});
