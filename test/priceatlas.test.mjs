/* Price labels and Atlas details (Oct 19, 2026 audit, helper P).
 *
 *   node --test test/priceatlas.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const fx = (p) => JSON.parse(read("test/fixtures/priceatlas/" + p));

/* The badge function from components/home-yield.js, run with a fixed clock. */
function badge(data, nowIso) {
  const src = read("components/home-yield.js");
  const body = src.match(/var _st=(\(function\(iso\)\{[\s\S]*?\}\)\(data\.fetched\));/)[1];
  const RD = Date;
  const D = class extends RD { constructor(...a) { super(...(a.length ? a : [nowIso])); } static now() { return new RD(nowIso).getTime(); } };
  D.UTC = RD.UTC; D.parse = RD.parse;
  return vm.runInNewContext(body, { data, Date: D, Intl });
}

test("P1: Sunday 7:31 PM CT file of Oct 16 settles says Settle, not Delayed", () => {
  const d = fx("prices-sun-oct18.json");
  const b = badge(d, "2026-10-19T00:40:00Z");
  assert.equal(b.t, "Settle Oct 16");
  assert.equal(b.live, false);
});

test("P1: a last trade read in the day session still says Delayed", () => {
  const d = fx("prices-sun-oct18.json");
  d.fetched = "2026-10-19T15:00:00Z"; // Monday 10:00 AM CT
  d.quotes["corn-nearby"] = { close: 470, close_kind: "last", close_date: "2026-10-19" };
  assert.equal(badge(d, "2026-10-19T15:10:00Z").t, "Delayed 15 min");
  // an evening file holding the day's last trade is not a live quote
  d.fetched = "2026-10-20T00:31:00Z";
  d.quotes["corn-nearby"] = { close: 470, close_kind: "last", close_date: "2026-10-19", settled: true };
  assert.notEqual(badge(d, "2026-10-20T00:40:00Z").t, "Delayed 15 min");
});
