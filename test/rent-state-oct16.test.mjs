/* /rent/<state>, Oct 16, 2026 head-to-head fixes (scripts/build_state_rent_pages.py):
 *   - NASS's state average beside our median, with its change from last year
 *   - the headline word says both when they disagree: Illinois 2026, matched-county median +0.0%,
 *     NASS state average $264 -> $261 (farmdoc daily, Sep 15, 2026, saved on the references branch)
 *   - the release line says what NASS says (county estimates late August every year; 2026 came
 *     out Aug 21, 2026 per the NASS release calendar), not "usually August 2027"
 *   - one label for the trend: "14-yr trend" (TREND_WINDOW 15 holds at most 14 published years)
 *   - one rounding, so both fair-rent methods agree on the same ground. Clayton County, IA by hand:
 *       per bushel   266 / 224.2 = 1.1864 $/bu; x 224 bu = 265.76 -> $266
 *       share        266 / (224.2 x 4.10) = 28.937% -> 28.94%; 224 x 4.10 = 918.40; x 0.2894 = 265.79 -> $266
 *     (the old one-decimal share, 28.9%, gave 265.42 -> $265)
 *
 *   node --test test/rent-state-oct16.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const py = (code) => execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'scripts'); import build_state_rent_pages as b\n" + code],
  { cwd: ROOT, encoding: "utf8" });

test("Illinois with NASS's state average: both numbers, the change, and no bare 'held flat'", () => {
  const out = JSON.parse(py(`
d = json.loads(json.dumps(b.load_states()['IL']))
d['state_avg'] = {'nonirr': {'2026': 261.0, '2025': 264.0}}
s = b.state_stats(d)
pg = b.build_state_page('IL', d, s, ['IL', 'IA'], {})
print(json.dumps({'yoy': s['yoy'], 'chg': s['state_avg_chg'], 'pg': pg}))`));
  assert.equal(out.yoy, 0);
  assert.equal(out.chg, -3);
  assert.match(out.pg, /MIDDLE COUNTY HELD FLAT &middot; STATE AVERAGE DOWN \$3/);
  assert.doesNotMatch(out.pg, />RENT HELD FLAT</);
  assert.match(out.pg, /USDA NASS&rsquo;s Illinois state average for non-irrigated cropland: <b>\$261 an acre<\/b> in 2026, down \$3 from \$264 in 2025/);
  assert.match(out.pg, /NASS state average &middot; 2026<\/div><div class="s">non-irrigated cropland, whole state, -\$3 vs 2025/);
});

test("the verdict is left alone when the state average agrees or barely moved", () => {
  const r = JSON.parse(py(`print(json.dumps([b.reconcile_verdict('RENT FELL', -5), b.reconcile_verdict('RENT HELD FLAT', 0.5),
  b.reconcile_verdict('RENT HELD FLAT', None), b.reconcile_verdict('RENT ROSE', -2), b.reconcile_verdict('RENT EASED', 4)]))`));
  assert.deepEqual(r, ["RENT FELL", "RENT HELD FLAT", "RENT HELD FLAT",
    "MIDDLE COUNTY ROSE &middot; STATE AVERAGE DOWN $2", "MIDDLE COUNTY EASED &middot; STATE AVERAGE UP $4"]);
});

test("last year's state average never stands in, and no change is printed without both years", () => {
  const r = JSON.parse(py(`
d = json.loads(json.dumps(b.load_states()['IL']))
d['state_avg'] = {'nonirr': {'2026': 261.0}}
s = b.state_stats(d)
d2 = json.loads(json.dumps(d)); d2['state_avg'] = {'nonirr': {'2025': 264.0}}
print(json.dumps([s['state_avg'], s['state_avg_chg'], b.state_stats(d2)['state_avg'], b.state_avg_line('Illinois', 'x', 2026, s)]))`));
  assert.equal(r[0], 261);
  assert.equal(r[1], null);
  assert.equal(r[2], null);
  assert.doesNotMatch(r[3], /from|down|up \$/);
});

test("every built state page: the release line says what NASS says, and one trend label", () => {
  const pages = readdirSync(ROOT + "rent").filter((f) => f.endsWith(".html") && f !== "index.html");
  assert.equal(pages.length, 47);
  for (const f of pages) {
    const h = read("rent/" + f);
    assert.doesNotMatch(h, /usually come out in August/, f);
    assert.doesNotMatch(h, /15-year fit/, f);
    assert.match(h, /NASS says county rents come out in late August every year/, f);
    if (h.includes('id="your-ground"')) assert.match(h, /our 14-yr trend, same practice as the rent/, f);
    assert.ok(Buffer.byteLength(h) < 150 * 1024, `${f} over the 150 KB cap`);
  }
  // the claim "every year since 2019" holds in the data: no survey gap after 2018
  const ia = JSON.parse(read("data/cash-rent/IA.json"));
  for (let y = 2019; y <= 2026; y++) assert.ok(ia.years.includes(y), `IA ${y}`);
  // and the saved NASS page says it: county estimates late August every year
  // (git show origin/references:refs/nass-cash-rents-county.txt, fetched 2026-10-15)
});

test("Clayton County, IA: per-bushel and share-of-gross give the same $266", () => {
  const h = read("rent/iowa.html");
  const js = h.match(/function ownShare\(c,p\)\{[^}]*\}/)[0];
  const ctx = {}; vm.runInNewContext(js + ";this.f=ownShare;", ctx);
  const c = ["Clayton", 266, 224.2, 1.19];
  const share = ctx.f(c, 4.10);
  assert.equal(share, 28.94);
  const Y = Math.round(224.2);
  const perBu = Math.round(c[1] * Y / c[2]);
  const bySh = Math.round(Y * 4.10 * share / 100);
  assert.equal(perBu, 266);
  assert.equal(bySh, 266);
  const ground = JSON.parse(h.match(/<script type="application\/json" id="gr-data">(.*?)<\/script>/)[1]);
  const cl = ground.c.find((x) => x[0] === "Clayton");
  assert.deepEqual(cl.slice(1, 3), [266, 224.2]);
});
