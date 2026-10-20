/* The elevator portal: worker v5.20 routes (scripts/test_elev_worker.mjs, run
 * here so `node --test` covers it), the page logic in components/elev-post.js,
 * and the two pages' privacy rules (noindex, no analytics, no sitemap).
 *
 *   node --test test/elev-portal.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const E = createRequire(import.meta.url)(ROOT + "components/elev-post.js");

test("worker routes (scripts/test_elev_worker.mjs)", () => {
  const out = execFileSync(process.execPath, [ROOT + "scripts/test_elev_worker.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(out, /elevator portal worker: \d+ checks passed/);
});

test("next futures month for a delivery month", () => {
  assert.equal(E.nextFutures("corn", 2026, 10), "ZCZ26");
  assert.equal(E.nextFutures("corn", 2026, 12), "ZCH27");
  assert.equal(E.nextFutures("soybeans", 2026, 10), "ZSX26");
  assert.equal(E.nextFutures("soybeans", 2026, 11), "ZSF27");
  assert.equal(E.nextFutures("soybeans", 2027, 7), "ZSQ27");
  assert.equal(E.nextFutures("wheat", 2027, 5), "ZWN27");
  assert.equal(E.nextFutures("oats", 2027, 5), "");
});

test("futures choices start after this month and match the worker's months", () => {
  const t = new Date(2026, 9, 13);
  assert.deepEqual(E.futuresChoices("corn", t, 5), ["ZCZ26", "ZCH27", "ZCK27", "ZCN27", "ZCU27"]);
  for (const crop of ["corn", "soybeans", "wheat"]) for (const c of E.futuresChoices(crop, t, 8)) assert.ok(E.futuresOk(crop, c), c);
  assert.ok(!E.futuresOk("corn", "ZSX26"));
  assert.ok(!E.futuresOk("corn", "ZCX26"));
  assert.equal(E.futuresLabel("ZCH27"), "Mar '27");
  /* the page's table is the worker's table */
  const w = read("workers/subs-worker.js");
  assert.match(w, /const ELEV_FUT = \{ corn: \["ZC", "HKNUZ"\], soybeans: \["ZS", "FHKNQUX"\], wheat: \["ZW", "HKNUZ"\] \};/);
  assert.deepEqual(E.FUT, { corn: ["ZC", "HKNUZ"], soybeans: ["ZS", "FHKNQUX"], wheat: ["ZW", "HKNUZ"] });
});

test("a new row: crop, period and futures follow the rows above it", () => {
  const t = new Date(2026, 9, 13);
  assert.deepEqual(E.newRow([], t), { crop: "corn", period: "Oct", start: "2026-10-13", end: "2026-10-31", futures: "ZCZ26", basis: "" });
  const r = E.newRow([{ crop: "soybeans", end: "2026-12-31", basis: "-0.60" }], t);
  assert.deepEqual(r, { crop: "soybeans", period: "Jan '27", start: "2027-01-01", end: "2027-01-31", futures: "ZSH27", basis: "-0.60" });
  /* an old row in the past does not pull the new one back */
  assert.equal(E.newRow([{ crop: "corn", end: "2026-06-30", basis: "-0.2" }], t).period, "Oct");
});

test("basis typed the ways people say it", () => {
  assert.equal(E.parseBasis("-0.35"), -0.35);
  assert.equal(E.parseBasis("-.35"), -0.35);
  assert.equal(E.parseBasis("−0.35"), -0.35);
  assert.equal(E.parseBasis("-35"), -0.35);
  assert.equal(E.parseBasis("12"), 0.12);
  assert.equal(E.parseBasis("2"), 2);
  assert.equal(E.parseBasis("-0.354"), -0.35);
  assert.ok(Number.isNaN(E.parseBasis("")));
  assert.ok(Number.isNaN(E.parseBasis("35 under")));
  assert.equal(E.basisText(-0.35), "-0.35");
  assert.equal(E.basisText(0.1), "0.10");
});

test("cash estimate uses only a clean futures quote", () => {
  const prices = { quotes: {
    "corn-dec26": { ticker: "ZCZ26.CBT", close: 483.5, close_date: "2026-10-13" },
    "corn-sep26": { ticker: "ZCU26.CBT", close: 470 },
    "beans-nov26": { ticker: "ZSX26.CBT", close: 1284.25 },
    "wheat-dec26": { ticker: "ZWZ26.CBT", close: null } },
    retired_keys: ["corn-sep26"], stale_keys: [], withheld_keys: {} };
  assert.deepEqual(E.cashEstimate("ZCZ26", -0.35, prices), { cash: 4.485, futures: 483.5, date: "2026-10-13" });
  assert.equal(E.cashEstimate("ZSX26", -0.6, prices).cash, 12.2425);
  assert.equal(E.cashEstimate("ZCU26", -0.35, prices), null, "retired");
  assert.equal(E.cashEstimate("ZWZ26", -0.35, prices), null, "no close");
  assert.equal(E.cashEstimate("ZCH27", -0.35, prices), null, "missing");
  assert.equal(E.cashEstimate("ZSX26", -0.6, Object.assign({}, prices, { stale_keys: ["beans-nov26"] })), null, "stale");
  assert.equal(E.cashEstimate("ZSX26", -0.6, Object.assign({}, prices, { withheld_keys: { "beans-nov26": "bad print" } })), null, "withheld");
  assert.equal(E.cashEstimate("ZCZ26", NaN, prices), null, "no basis");
});

test("the page checks rows the way the worker does", () => {
  const ok = { crop: "corn", period: "Oct/Nov", start: "2026-10-01", end: "2026-11-30", futures: "ZCZ26", basis: "-35" };
  let c = E.checkRows([ok]);
  assert.equal(c.errors.length, 0);
  assert.equal(c.bids[0].basis, -0.35);
  const bad = (patch) => E.checkRows([Object.assign({}, ok, patch)]).errors.map((e) => e.field);
  assert.deepEqual(bad({ basis: "-3.01" }), ["basis"]);
  assert.deepEqual(bad({ basis: "2.5" }), ["basis"]);
  assert.deepEqual(bad({ basis: "" }), ["basis"]);
  assert.deepEqual(bad({ futures: "ZSX26" }), ["futures"]);
  assert.deepEqual(bad({ period: "" }), ["period"]);
  assert.deepEqual(bad({ period: "x".repeat(17) }), ["period"]);
  assert.deepEqual(bad({ end: "2026-09-01" }), ["dates"]);
  assert.equal(E.checkRows(Array(13).fill(ok)).errors[0].field, "rows");
});

test("post.html, elev-admin.html and elev-today.html: noindex, no analytics, not in a sitemap", () => {
  for (const p of ["post.html", "elev-admin.html", "elev-today.html"]) {
    const h = read(p);
    assert.match(h, /<meta name="robots" content="noindex, nofollow">/, p);
    assert.match(h, /<meta name="referrer" content="no-referrer">/, p);
    assert.ok(!/googletagmanager|G-6KXCTD5Z9H/.test(h), p + " loads no analytics");
    assert.ok(!/—/.test(h), p + " has no em dash");
  }
  /* loader.js adds analytics only when gtag is not a function: post.html sets a no-op first */
  const post = read("post.html");
  assert.ok(post.indexOf("window.gtag = function () {}") < post.indexOf("<script src=\"/components/loader.js"));
  assert.match(post, /components\/elev-post\.js\?v=\d+/);
  assert.match(read("components/elev-post.js"), /sig@farmers1st\.com/);
  assert.ok(!/—/.test(read("components/elev-post.js")), "elev-post.js has no em dash");
  for (const f of readdirSync(ROOT).filter((f) => /^sitemap.*\.xml$/.test(f))) {
    assert.ok(!/agsist\.com\/(post|elev-admin|elev-today)\b/.test(read(f)), f);
  }
});
