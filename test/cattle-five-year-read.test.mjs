/* /cattle-futures-prices: each card's 5-year line reads its own series
 * (accuracy pass, Oct 17 2026). The pass flagged the feeder card's "82nd
 * percentile" as the live cattle number; it was the feeder settle ranked
 * against the feeder history (stored 83 at 343.975, today's 343.625 ranks 82).
 * This locks the per-card wiring with series far apart.
 *
 *   node --test test/cattle-five-year-read.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "cattle-futures-prices.html", "utf8");
const a = HTML.indexOf("function ordn(k)");
const b = HTML.indexOf("/* ===== cost-of-gain calculator");
assert.ok(a > 0 && b > a, "5-year read block found");
const BLOCK = HTML.slice(a, b);

async function run(stats, prices) {
  const els = { "le-read": { textContent: "" }, "gf-read": { textContent: "" } };
  const $ = (id) => els[id] || null;
  const fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(stats) });
  const pricesP = Promise.resolve(prices);
  const cwt = (v) => "$" + Number(v).toFixed(3);
  Function("$", "fetch", "pricesP", "cwt", "window", BLOCK)($, fetch, pricesP, cwt, {});
  await new Promise((r) => setTimeout(r, 10));
  return els;
}

const hist = (lo, step) => Array.from({ length: 40 }, (_, i) => lo + i * step);

test("live ranking: the feeder card ranks the feeder quote against the feeder history", async () => {
  const stats = { updated: "2026-10-16T21:53:45Z",
    cattle: { pct: 10, cur: 150, n: 40, hist: hist(140, 1) },     // live 150 ranks low
    feeders: { pct: 95, cur: 380, n: 40, hist: hist(300, 2) } };  // live 370 ranks high
  const prices = { q: { cattle: { close: 150 }, feeders: { close: 370 } }, fetched: "2026-10-16T21:00:00Z" };
  const els = await run(stats, prices);
  // by hand: cattle 1 + #(h<=150)=11 -> 12/41 = 29; feeders 1 + #(h<=370)=36 -> 37/41 = 90
  assert.match(els["le-read"].textContent, /^5-year: at the 29th percentile/);
  assert.match(els["gf-read"].textContent, /^5-year: at the 90th percentile/);
  assert.match(els["gf-read"].textContent, /\(\$370\.000\)/);
});

test("stored fallback: each card prints its own stored percentile and price", async () => {
  const stats = { updated: "2026-10-16T21:53:45Z",
    cattle: { pct: 82, cur: 227.525, n: 261 }, feeders: { pct: 17, cur: 343.975, n: 261 } };
  const els = await run(stats, null);
  assert.match(els["le-read"].textContent, /at the 82nd percentile/);
  assert.match(els["gf-read"].textContent, /at the 17th percentile/);
  assert.match(els["gf-read"].textContent, /Position of \$343\.975/);
  assert.doesNotMatch(els["gf-read"].textContent, /227\.525/);
});
