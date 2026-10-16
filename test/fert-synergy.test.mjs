/* Synergy Cooperative (Northwest Wisconsin) on /fertilizer: one more co-op.
 *
 * Sig, Oct 16, 2026: "just publish prices as a new coop". The co-op's own
 * list (dated Oct 1, 2026) is typed into scripts/coop_fert_sources.json as a
 * "sheet" layout line and goes through scripts/fetch_coop_fert.py like every
 * other co-op: same checks, same 60-day rule, counted in the middle price.
 * No separate box, no link (no co-op page was verified).
 *
 * Hand-worked middle (fixture co-op urea cash prices, the same as the Oct 16
 * live read): McCune 608 (5% cash discount), Synergy 610, Farmers Coop 615.95
 * (3% cash pickup), Two Rivers 630, Mulvane 840. Five sorted, the third is
 * 615.95. Before Synergy: 608, 615.95, 630, 840 -> (615.95 + 630) / 2 = 622.98
 * (622.975, rounded).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const require = createRequire(import.meta.url);
const FC = require(ROOT + "components/fert-coops.js");
const feed = (...a) => JSON.parse(execFileSync("python3", ["scripts/fetch_coop_fert.py", "--fixture-feed", ...a], { cwd: ROOT, encoding: "utf8" }));
const WITH = feed("--with-sheets");
const WITHOUT = feed();
const LIVE = JSON.parse(read("data/fertilizer-coops.json"));
const CFG = JSON.parse(read("scripts/coop_fert_sources.json"));
const HTML = read("fertilizer.html");
const BANNED = /booking|spring|prepay|pre-pay|price sheet|not today/i;

test("config: Synergy Cooperative, WI, no town and no url invented, sheet layout dated Oct 1", () => {
  const c = CFG.coops.find((x) => x.id === "synergy-wi");
  assert.ok(c);
  assert.equal(c.name, "Synergy Cooperative");
  assert.equal(c.state, "WI");
  assert.equal(c.town, null);
  assert.equal(c.url, null);
  assert.equal(c.layout, "sheet");
  assert.deepEqual(c.rows.map((r) => [r.raw, r.cash, r.charge, r.date]), [
    ["46-0-0", 610, 628, "2026-10-01"],
    ["N-EDGE EZ (~ESN 44-0-0)", 800, 824, "2026-10-01"],
  ]);
});

test("hand-worked urea middle: 608, 610, 615.95, 630, 840 -> 615.95 (was 622.98 from four)", () => {
  const u = WITH.summary.find((s) => s.key === "urea");
  const u0 = WITHOUT.summary.find((s) => s.key === "urea");
  assert.equal(u0.median, 622.98);
  assert.equal(u0.n, 4);
  assert.equal(u.n, 5);
  assert.equal(u.median, 615.95);
  assert.ok(u.coops.includes("synergy-wi"));
  const s = WITH.coops.find((c) => c.id === "synergy-wi");
  assert.equal(s.rows.find((r) => r.product === "urea").cash, 610);
});

test("the ESN-type product shows but is not summarized; nothing else of Synergy's counts", () => {
  const s = WITH.coops.find((c) => c.id === "synergy-wi");
  assert.equal(s.rows.find((r) => r.raw.startsWith("N-EDGE")).product, "other");
  const counted = WITH.summary.filter((p) => p.coops.includes("synergy-wi")).map((p) => p.key);
  assert.deepEqual(counted, ["urea"]);
});

test("the cheapest pick and the price list use it like any co-op", () => {
  const out = execFileSync("python3", ["scripts/build_fert_prices.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /ok\s+Synergy urea 610 enters the middle/);
  assert.match(out, /selftest ok/);
});

test("live file: Synergy is in the co-op data; while current, its urea is in the urea middle", () => {
  const s = LIVE.coops.find((c) => c.id === "synergy-wi");
  assert.ok(s, "Synergy in data/fertilizer-coops.json");
  assert.equal(s.url, null);
  assert.equal(s.town, null);
  const r = s.rows.find((x) => x.product === "urea");
  assert.equal(r.cash, 610);
  assert.equal(r.date, "2026-10-01");
  const u = LIVE.summary.find((p) => p.key === "urea");
  if (!r.stale) assert.ok(u && u.coops.includes("synergy-wi"), "a current Synergy urea is counted");
  else assert.ok(!u || !u.coops.includes("synergy-wi"), "a stale one is not");
});

test("page: Synergy in the co-op table with no link; region names Wisconsin", () => {
  const more = FC.more(WITH);
  const row = more.match(/<tr><td class="prod">[^]*?<\/tr>/g).find((x) => x.includes("Synergy Cooperative"));
  assert.ok(row, "a table row");
  assert.ok(!/<a /.test(row), "no link for a co-op with no url");
  assert.match(row, /<td>WI<\/td><td>Oct 1, 2026<\/td><td>1<\/td>/);
  assert.match(more, /Synergy Cooperative, WI<\/h3><p class="fert-coop-src">The co-op&rsquo;s own prices, dated Oct 1, 2026\. Cash price used: cash\./);
  const top = FC.top(WITH);
  assert.match(top, /What Kansas and Wisconsin co-ops are posting/);
  assert.match(top, /\$616<\/div>/, "urea middle 615.95 rounded");
  assert.match(top, /middle of 5 co-ops/);
  assert.match(top, /Synergy Cooperative(?!<\/a>)/, "credited by name");
  assert.ok(!/href="null"|href=""/.test(top + more));
  assert.match(FC.bar(WITH), /from <strong>Kansas and Wisconsin<\/strong> co-ops: the middle cash price of five co-ops/);
});

test("no booking, spring, prepay or price-sheet wording, and no separate box", () => {
  for (const d of [WITH, LIVE]) {
    const h = FC.section(d) + FC.bar(d);
    assert.doesNotMatch(h.replace(/Test sheet co-op/g, ""), BANNED);
    assert.ok(!/—/.test(h), "no em dashes");
  }
  assert.doesNotMatch(HTML, /fert-sheets|FertSheets|booking|price sheets? by email|not today/i);
  assert.ok(!existsSync(ROOT + "components/fert-sheets.js"));
  assert.ok(!existsSync(ROOT + "data/fert-sheets"));
  assert.ok(!("sheets" in JSON.parse(read("data/fertilizer-prices.json"))));
});
