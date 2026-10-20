/* Panel Oct 20 small batch: Atlas wording, the compare page's reason line,
 * the cattle ratio read and the milk page's tool link.
 *
 *   node --test test/oct20-small-batch.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");

test("Atlas: a census value is the operators' own estimate, never 'guessed' (seat D5)", () => {
  for (const f of ["scripts/build_atlas_pages.py", "farmland-atlas/sheet.html", "farmland-atlas/iowa/story-county.html",
                   "farmland-atlas/minnesota/faribault-county.html"]) {
    assert.doesNotMatch(read(f), /operators guessed/, f);
  }
  assert.match(read("farmland-atlas/iowa/story-county.html"), /operators&#x27; own estimate of what land and buildings were worth/);
});

/* Faribault MN has a 2026 dry rent and an unflagged 2022 census value, but NASS
   published no 2022 county rent, so there is no same-year ratio. The compare
   page said "needs a rent and an unflagged land value", which it had. */
test("compare: the rent-to-value blank gives the county page's own reason (seat D3)", () => {
  const html = read("farmland-atlas/compare.html");
  const spec = html.match(/var SPEC=(\[[\s\S]*?\n\]);/)[1];
  const ctx = { n: (x) => String(x), nf: (x, k) => Number(x).toFixed(k), usd: (v) => "$" + v, shareWords: String };
  const SPEC = vm.runInNewContext("(" + spec + ")", ctx);
  const row = SPEC.find((s) => s[0] === "Dry rent as % of land value");
  const why = (r) => (typeof row[2] === "function" ? row[2](r) : row[2]);
  const d = JSON.parse(read("farmland-atlas/data/counties.json"));
  const rec = (fips) => Object.fromEntries(d.columns.map((c, i) => [c, d.rows.find((x) => x[0] === fips)[i]]));
  const far = rec("27043");
  assert.ok(far.rent_dry_usd_ac != null && far.value_usd_ac != null && !far.value_flag && far.rent_to_value_pct == null,
    "Faribault still has a rent, a value and no ratio");
  assert.equal(row[1](far), null);
  assert.equal(why(far), "NASS published no dry cash rent for this county in 2022");
  assert.equal(why({ value_usd_ac: null, value_year: 2022 }), "census value withheld");
  assert.equal(row[1]({ value_flag: "x", rent_to_value_pct: 3 }), "flag", "a flagged value reads with care, not a reason");
  assert.equal(row[1]({ value_flag: null, rent_to_value_pct: 3.04 }), "3.04%");
  assert.doesNotMatch(html, /needs a rent and an unflagged land value/);
});

test("cattle: no unsourced verdict on the feeder/live ratio (seat C1)", () => {
  const html = read("cattle-futures-prices.html");
  for (const w of ["normal-to-firm", "margins workable", "Feeders are expensive", "Feeders are cheap", "reasonably priced"]) {
    assert.ok(!html.includes(w), w);
  }
});

test("cattle: the ratio's percentile comes from the repo's own weekly closes", () => {
  const html = read("cattle-futures-prices.html");
  const src = html.match(/function ordn\(k\)\{[^\n]*\}/)[0] + "\n" + html.match(/function ratioRead\(d,gfc,lec\)\{[\s\S]*?\n  \}/)[0];
  const ctx = {};
  vm.runInNewContext(src + "\nthis.ratioRead=ratioRead;", ctx);
  const st = JSON.parse(read("data/price-stats.json"));
  const f = st.feeders.hist, c = st.cattle.hist;
  const cur = 343.625 / 227.55;
  let k = 1;
  for (let i = 0; i < f.length; i++) if (f[i] / c[i] <= cur) k++;
  const want = Math.round(100 * k / (f.length + 1));
  const r = ctx.ratioRead(st, 343.625, 227.55);
  assert.equal(r.pct, want);
  assert.equal(r.n, f.length + 1);
  assert.match(r.text, new RegExp(`at the ${want}(st|nd|rd|th) percentile of ${f.length + 1} weekly readings`));
  // histories that do not cover the same weeks: no read
  assert.equal(ctx.ratioRead({ feeders: st.feeders, cattle: { ...st.cattle, hist_from: "2021-10-25" } }, 343.625, 227.55), null);
  assert.equal(ctx.ratioRead({ feeders: st.feeders, cattle: { ...st.cattle, hist: c.slice(1) } }, 343.625, 227.55), null);
  assert.equal(ctx.ratioRead(null, 343.625, 227.55), null);
});

test("milk: no link to the grain-per-acre break-even outside the menu (seat C3)", () => {
  const body = read("milk-prices.html").replace(/<b>Money &amp; Land:<\/b>[^\n]*/g, "");
  assert.doesNotMatch(body, /href="\/breakeven"/);
  assert.doesNotMatch(read("scripts/seed_static.py"), /href=\\"\/breakeven\\"/);
  assert.match(read("milk-prices.html"), /href="#dp-margin"/);
});
