/* Night audit, Oct 19, 2026 (AI answer engines, F5). On Sunday night the corn, soybean and
 * wheat heroes read "CBOT · CME Group · Nearby Dec '26 · Refreshed in session $4.74¼": an
 * engine can quote Friday's settle as a live price. The line now names the moment in the
 * homepage seed's words (seed_static.py quote_when, state_words): "Settle Oct 16", or
 * "Last trade ..." in session. Fixture: data/prices.json as committed 2026-10-19 03:16 UTC
 * (Sunday 10:16 pm CT), every grain close_kind settle, close_date 2026-10-16.
 *   node --test test/futures-when.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const FIX = join(ROOT, "test/fixtures/futures-when/prices-2026-10-19T0316Z.json");

function seeds(prices) {
  const py = `
import sys, json
sys.path.insert(0, ${JSON.stringify(join(ROOT, "scripts"))})
import seed_static as s
p = json.loads(sys.argv[1])
print(json.dumps({pg: s.futures_hero_seeds(pg, p) for pg in ("corn-futures-prices.html", "soybean-futures-prices.html", "wheat-futures-prices.html")}))
`;
  return JSON.parse(execFileSync("python3", ["-c", py, JSON.stringify(prices)], { encoding: "utf8" }));
}

test("Sunday night: the baked hero line says Settle Oct 16, never Refreshed in session", () => {
  const s = seeds(JSON.parse(readFileSync(FIX, "utf8")));
  assert.equal(s["corn-futures-prices.html"].exch, "CBOT &middot; CME Group &middot; Nearby Dec '26 &middot; Settle Oct 16");
  assert.equal(s["soybean-futures-prices.html"].when, "Settle Oct 16");
  assert.equal(s["wheat-futures-prices.html"].when, "Settle Oct 16");
});

test("in session the line says Last trade with its time, as the homepage seed does", () => {
  const p = JSON.parse(readFileSync(FIX, "utf8"));
  p.fetched = "2026-10-19T15:42:00Z";
  for (const k of Object.keys(p.quotes)) Object.assign(p.quotes[k], { close_kind: "last", close_time: "2026-10-19T15:42:00Z", close_date: "2026-10-19" });
  const s = seeds(p);
  assert.equal(s["soybean-futures-prices.html"].when, "Last trade Oct 19, 10:42 a.m. CT");
  assert.match(s["corn-futures-prices.html"].exch, / &middot; Last trade Oct 19, 10:42 a\.m\. CT$/);
});

test("futures.js names the same moment the seed does, from the price-local stamp", () => {
  const js = read("components/futures.js");
  const m = /function exchWhen\(q,fetched\)\{[\s\S]*?\n\}/.exec(js);
  assert.ok(m, "exchWhen found");
  const require = createRequire(import.meta.url);
  const window = { AgPxStamp: require(join(ROOT, "components/price-local.js")) };
  const exchWhen = new Function("window", "AgPxStamp", m[0] + "; return exchWhen;")(window, window.AgPxStamp);
  const p = JSON.parse(readFileSync(FIX, "utf8"));
  assert.equal(exchWhen(p.quotes["corn-nearby"], p.fetched), "Settle Oct 16");
  assert.equal(exchWhen(null, p.fetched), "Last quote");
  assert.match(js, /setTxt\('ph-exch','CBOT · CME Group · '\+lbl\+' · '\+when\)/);
  assert.match(js, /setTxt\('ph-when',__when\)/);
});

test("no copy of the old words left", () => {
  for (const f of ["corn-futures-prices.html", "soybean-futures-prices.html", "wheat-futures-prices.html", "components/futures.js", "scripts/seed_static.py"]) {
    assert.ok(!/Refreshed in session/.test(read(f)), f);
  }
  for (const f of ["soybean-futures-prices.html", "wheat-futures-prices.html"]) {
    assert.match(read(f), /<span id="ph-when"><!--SEED:when-->[^<]+<!--\/SEED--><\/span>/, f);
  }
});
