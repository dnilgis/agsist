/* Which fertilizer price a reader sees (Sig, Oct 21, 2026): components/fert-pick.js.
 *
 *   node --test test/fert-pick.test.mjs
 *
 * The reader's own state's current co-op sheets when there are any; else the middle of every
 * current sheet, labeled with the states; never a stale, undated or flagged row; never a co-op's
 * name. One chooser for Fast Facts (row and calculators), /manure-value, /nutrient-removal, /urea. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const req = createRequire(import.meta.url);
const F = req(ROOT + "components/fert-pick.js");
const P = req(ROOT + "components/place.js");
const LIVE = JSON.parse(read("data/fertilizer-coops.json"));
const NAMES = LIVE.coops.map((c) => c.name).filter((n) => n && n.length > 3);

/* A hand-built file: three Kansas sheets, one Wisconsin sheet, one Kansas sheet gone stale. */
const row = (product, cash, date, extra = {}) => ({ product, cash, date, flags: [], stale: false, ...extra });
const DOC = {
  stale_days: 60,
  coops: [
    { id: "a-ks", name: "Alpha Co-op", state: "KS", rows: [row("anhydrous", 800, "2026-10-01"), row("urea", 600, "2026-10-01")] },
    { id: "b-ks", name: "Bravo Co-op", state: "KS", rows: [row("anhydrous", 820, "2026-10-05"), row("urea", 620, "2026-10-05"), row("map", 900, "2026-10-05")] },
    { id: "c-ks", name: "Charlie Co-op", state: "KS", rows: [row("anhydrous", 900, "2026-09-20"), row("urea", 700, "2026-09-20", { flags: ["per-unit figure does not match"] })] },
    { id: "d-wi", name: "Delta Co-op", state: "WI", rows: [row("urea", 610, "2026-10-01"), row("potash", 480, null)] },
    { id: "e-ks", name: "Echo Co-op", state: "KS", rows: [row("anhydrous", 999, "2026-07-01"), row("urea", 999, "2026-10-02", { stale: true })] },
  ],
};
const by = (doc) => Object.fromEntries(doc.prices.map((p) => [p.key, p]));

test("ZIP to state: Chetek WI, Dodge City KS, Ames IA", () => {
  assert.equal(F.zipState("54728"), "WI");
  assert.equal(F.zipState("67801"), "KS");
  assert.equal(F.zipState("50010"), "IA");
  assert.equal(F.zipState("abc"), "");
});

test("a Wisconsin ZIP gets the Wisconsin sheet; what Wisconsin does not post comes from every sheet", () => {
  const d = by(F.choose(DOC, F.zipState("54728"), "2026-10-21"));
  assert.equal(d.urea.price, 610);
  assert.equal(d.urea.scope, "state");
  assert.equal(d.urea.src_label, "one Wisconsin co-op, posted Oct 1, 2026");
  // anhydrous: no Wisconsin sheet, so the three current Kansas sheets (the July one is stale)
  assert.equal(d.anhydrous.scope, "all");
  assert.equal(d.anhydrous.n, 3);
  assert.equal(d.anhydrous.price, 820);
  assert.equal(d.anhydrous.src_label, "middle of 3 co-op price sheets (KS), posted Sep 20 to Oct 5, 2026");
  assert.ok(!d.potash, "an undated row is never used");
});

test("a Kansas ZIP gets the Kansas sheets only", () => {
  const d = by(F.choose(DOC, F.zipState("67801"), "2026-10-21"));
  assert.equal(d.urea.scope, "state");
  // Alpha 600 and Bravo 620; Charlie's urea is flagged, Echo's is stale: their average
  assert.equal(d.urea.n, 2);
  assert.equal(d.urea.price, 610);
  assert.equal(d.urea.src_label, "average of 2 Kansas co-op price sheets, posted Oct 1 to Oct 5, 2026");
  assert.equal(d.anhydrous.src_label, "middle of 3 Kansas co-op price sheets, posted Sep 20 to Oct 5, 2026");
});

test("an Iowa ZIP (no Iowa sheet) gets the middle of every current sheet, labeled with the states", () => {
  const d = by(F.choose(DOC, F.zipState("50010"), "2026-10-21"));
  assert.equal(d.urea.scope, "all");
  assert.equal(d.urea.n, 3);
  assert.equal(d.urea.price, 610);
  assert.deepEqual(d.urea.states, ["KS", "WI"]);
  assert.equal(d.urea.src_label, "middle of 3 co-op price sheets (KS, WI), posted Oct 1 to Oct 5, 2026");
  assert.equal(d.urea.short_label, "3 co-op price sheets (KS, WI), Oct 1 to Oct 5");
  // no state at all reads the same as a state with no sheet
  assert.deepEqual(F.choose(DOC, null, "2026-10-21").prices.map((p) => p.price), F.choose(DOC, "IA", "2026-10-21").prices.map((p) => p.price));
});

test("stale sheets are excluded by today's date, not only by the file's flag", () => {
  // Nov 25: the Sep 20 sheet is 66 days old and drops out; Oct 1 and Oct 5 stay
  const d = by(F.choose(DOC, "KS", "2026-11-25"));
  assert.equal(d.anhydrous.n, 2);
  assert.equal(d.anhydrous.price, 810);
  // Dec 20: every sheet is stale, nothing is priced
  assert.deepEqual(F.choose(DOC, "WI", "2026-12-20").prices, []);
  // the shared file's fallback drops a stale row too
  assert.deepEqual(F.anon({ prices: [{ key: "urea", price: 600, as_of: "2026-08-01", src: "coop", n: 2 }] }, "2026-10-21").prices, []);
});

test("on the live file: an Iowa reader gets the shared file's own middle; no label names a co-op", () => {
  const shared = JSON.parse(read("data/fertilizer-prices.json"));
  const today = LIVE.generated.slice(0, 10);
  const ia = F.choose(LIVE, "IA", today);
  for (const p of shared.prices) {
    const q = ia.prices.find((x) => x.key === p.key);
    assert.ok(q, p.key);
    assert.equal(q.price, p.price, p.key + " same middle as scripts/build_fert_prices.py");
  }
  for (const st of ["WI", "KS", "IA", null]) {
    const d = F.choose(LIVE, st, today);
    const text = JSON.stringify(d);
    for (const n of NAMES) assert.ok(!text.includes(n), st + " names " + n);
    assert.ok(!/"coops"/.test(text), "no co-op ids either");
    for (const p of d.prices) assert.match(p.src_label, /posted [A-Z][a-z]{2} \d+/, p.key + " carries its date");
  }
  const wi = by(F.choose(LIVE, "WI", today));
  assert.equal(wi.urea.scope, "state");
  assert.match(wi.urea.src_label, /^one Wisconsin co-op, posted /);
  // the anonymized fallback never names one co-op either
  const fb = JSON.stringify(F.anon(shared, today));
  for (const n of NAMES) assert.ok(!fb.includes(n), "fallback names " + n);
});

test("the My place row: the reader's own state first, labeled, dated", () => {
  const wi = P.factFert(F.choose(DOC, "WI", "2026-10-21"));
  assert.equal(wi.label, "Urea");
  assert.equal(wi.value + ". " + wi.ctx, "$610 a ton. One Wisconsin co-op, posted Oct 1, 2026. Cash price; call to confirm.");
  assert.equal(wi.date, "2026-10-01");
  const ia = P.factFert(F.choose(DOC, "IA", "2026-10-21"));
  assert.equal(ia.label, "Anhydrous ammonia");
  assert.equal(ia.ctx, "Middle of 3 co-op price sheets (KS), posted Sep 20 to Oct 5, 2026. Cash price; call to confirm.");
  assert.equal(P.factFert({ prices: [] }).value, null);
});

test("every calculator reads prices through the one chooser", () => {
  assert.match(read("components/fast-facts.js"), /AgFertPick\.load\(\)/);
  assert.match(read("components/manure-value.js"), /AgFertPick\.load\(\)/);
  assert.match(read("components/nutrient-removal.js"), /AgFertPick\.load\(\)/);
  assert.equal((read("urea.html").match(/AgFertPick\.load\(\)/g) || []).length, 2);
  assert.match(read("components/here.js"), /var F = window\.AgFertPick;\s*\(F \? F\.load\(st \|\| null\)/);
  assert.doesNotMatch(read("components/nutrient-removal.js"), /COOPS\[/, "no co-op names on /nutrient-removal");
  for (const [page, before] of [["fast-facts.html", "manure-value.js"], ["manure-value.html", "manure-value.js"], ["nutrient-removal.html", "nutrient-removal.js"]]) {
    const h = read(page);
    assert.ok(h.includes("/components/fert-pick.js?v=") && h.indexOf("/components/fert-pick.js") < h.indexOf("/components/" + before), page);
  }
  assert.ok(read("urea.html").indexOf("/components/fert-pick.js") < read("urea.html").indexOf("AgFertPick.load()"));
});
