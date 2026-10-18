/* "This interval so far" (components/prf-now.js, scripts/fetch_prf_season.py,
 * data/prf/now/): the index-so-far arithmetic against hand-worked answers, the
 * honest empty and withheld states, the wiring on /prf and the county pages,
 * and the backtest numbers the card prints, recomputed from the pinned rows.
 *
 *   node --test test/prf-now.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, mkdtempSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FX = ROOT + "test/fixtures/prf-season/";
const src = readFileSync(ROOT + "components/prf-now.js", "utf8");
const ctx = { window: {} };
vm.runInNewContext(src, ctx);
const N = ctx.window.AgPrfNow;
const pinned = JSON.parse(readFileSync(FX + "backtest.json", "utf8"));
const card = pinned.card;

/* One grid, four intervals as the builder writes them on Oct 17, 2026. */
function doc(cells, extra = {}) {
  return {
    v: 1, st: "TX", through: "2026-10-13", acc: card,
    iv: [
      { y: 2026, i: 6, name: "Jul-Aug", from: "2026-07-01", to: "2026-08-31", days: 62, have: 62, how: [["July", "final"], ["August", "final"]] },
      { y: 2026, i: 7, name: "Aug-Sep", from: "2026-08-01", to: "2026-09-30", days: 61, have: 61, how: [["August", "final"], ["September", "initial"]] },
      { y: 2026, i: 8, name: "Sep-Oct", from: "2026-09-01", to: "2026-10-31", days: 61, have: 43, how: [["September", "initial"], ["October", "daily"]] },
      { y: 2026, i: 9, name: "Oct-Nov", from: "2026-10-01", to: "2026-11-30", days: 61, have: 13, how: [["October", "daily"]] },
    ],
    g: { "14538": cells },
    ...extra,
  };
}

test("index so far and rain to reach each level, worked by hand", () => {
  // 3.00 in so far (76.2 mm) against a 5.00 in (127.0 mm) average: 76.2 / 127 = 0.600
  assert.equal(N.indexSoFar(76.2, 127.0), 60.0);
  // 90%: 0.90 x 127.0 = 114.3 mm, less 76.2 = 38.1 mm = 1.50 in
  assert.equal(N.rainToReach(76.2, 127.0, 90), 38.1);
  // 70%: 0.70 x 127.0 = 88.9, less 76.2 = 12.7 mm = 0.50 in
  assert.equal(N.rainToReach(76.2, 127.0, 70), 12.7);
  assert.equal(N.rainToReach(120.0, 127.0, 90), 0);
  assert.equal(N.indexSoFar(null, 127), null);
  assert.equal(N.rainToReach(10, 0, 90), null);
});

test("the card for one grid: days left, inches, levels, and which file", () => {
  const m = N.model(doc([[1000, 1200], [1500, 1000], [762, 1270], [100, 900]]), 14538, "2026-10-17");
  assert.equal(m.state, "ok");
  const [ja, as, so, on] = m.ivs;
  assert.equal(ja.ended, true); assert.equal(ja.allFinal, true);
  assert.equal(as.ended, true); assert.equal(as.allFinal, false);
  assert.equal(so.left, 18); assert.equal(so.index, 60.0);
  assert.equal(so.need.find((n) => n.cov === 90).mm, 38.1);
  const html = N.render(m);
  assert.match(html, /Day 43 of 61, 18 days left \(to Oct 31\)/);
  assert.match(html, /3\.00 in/); assert.match(html, /5\.00 in/);
  assert.match(html, /1\.50 in more/); assert.match(html, /0\.50 in more/);
  assert.match(html, /Both months are NCEI&rsquo;s final data/);
  assert.match(html, /Not all final yet, so this is still an estimate/);
  assert.match(html, /September: preliminary month &middot; October: daily so far/);
  assert.match(html, /An estimate, not RMA&rsquo;s index/);
  assert.match(html, /preliminary/);
  assert.doesNotMatch(html, /—/, "no em dashes");
  // Oct-Nov: 10.0 mm on a 90.0 mm average = 11.1
  assert.equal(on.index, 11.1);
});

test("honest empty, stale and withheld states", () => {
  assert.match(N.render(N.model(null, 1, "2026-10-17")), /shows here after the first read/);
  assert.match(N.render(N.model(doc([null, null, null, null]), 999, "2026-10-17")), /No interval-so-far numbers for grid 999/);
  const stale = N.model(doc([[1, 1000], [1, 1000], [1, 1000], [1, 1000]]), 14538, "2026-10-30");
  assert.equal(stale.state, "stale");
  assert.match(N.render(stale), /held back/);
  assert.doesNotMatch(N.render(stale), /\d+\.\d in/);
  // a grid gap, and a desert-summer average under 5 mm, give no number
  const m = N.model(doc([[null, 1000], [10, 40], [762, 1270], [100, 900]]), 14538, "2026-10-17");
  assert.match(m.ivs[0].withheld, /no value at this grid/);
  assert.match(m.ivs[1].withheld, /under 0\.2 in/);
  const withheld = doc([[762, 1270], null, [762, 1270], [762, 1270]]);
  withheld.iv[1].withheld = "NCEI is missing part of September (no NCEI daily grid for 2026-09-05); no number until it is posted.";
  assert.match(N.render(N.model(withheld, 14538, "2026-10-17")), /no number until it is posted/);
});

test("the accuracy line prints the pinned backtest and says the current month runs low", () => {
  const line = N.accLine(card);
  assert.match(line, new RegExp(`exactly in ${card.final_exact.toLocaleString("en-US")} of ${card.final_n.toLocaleString("en-US")}`));
  assert.match(line, new RegExp(`median ${card.prelim_pct_under}% under`));
  assert.match(line, /likely a low reading/);
  assert.match(N.accLine(null), /Not yet checked/);
});

test("a 2026 card says a 2026 policy is paid on RMA's CPC index, with the backtest's own gap", () => {
  const html = N.render(N.model(doc([[1000, 1200], [1500, 1000], [762, 1270], [100, 900]]), 14538, "2026-10-17"));
  const want = "This is RMA&rsquo;s 2027 rainfall record (NOAA NCEI). A 2026 policy is paid on RMA&rsquo;s 2026 index, built from NOAA CPC data, which ran a median " +
    card.cpc_median_abs.toFixed(1) + " points from it on the grids checked.";
  assert.ok(html.includes(want), html.slice(-900));
  assert.ok(html.indexOf(want) > html.indexOf("An estimate, not RMA&rsquo;s index"), "appended after the estimate line");
  assert.equal(N.cpcLine(null, [{ y: 2026 }]), "", "no backtest, no number");
  assert.equal(N.cpcLine(card, [{ y: 2027 }]), "", "a 2027 interval is paid on the NCEI record itself");
});

test("backtest numbers recompute from the pinned rows", () => {
  const rows = JSON.parse(gunzipSync(readFileSync(FX + "backtest-rows.json.gz")).toString());
  const R = rows.rows.map((r) => Object.fromEntries(rows.cols.map((c, k) => [c, r[k]])));
  const pairs = R.filter((r) => r.ncei != null && r.rma_mm != null);
  assert.equal(pairs.length, card.final_n);
  // NCEI's final months equal RMA's published rain, and give its index to 3 places
  assert.equal(pairs.filter((r) => Math.abs(r.ncei - r.rma_mm) < 0.015).length, card.final_exact);
  assert.equal(card.final_exact, card.final_n);
  // CPC: median absolute index points
  const d = R.filter((r) => r.cpc != null && r.rma_avg).map((r) => Math.abs(r.cpc / r.rma_avg * 100 - r.rma_idx * 100)).sort((a, b) => a - b);
  const med = d.length % 2 ? d[(d.length - 1) / 2] : (d[d.length / 2 - 1] + d[d.length / 2]) / 2;
  assert.equal(Math.round(med * 10) / 10, card.cpc_median_abs);
  assert.ok(card.cpc_median_abs > 5, "CPC is far enough off that the tracker does not use it");
  // the whole file again, with the record, through the script itself
  const out = join(mkdtempSync(join(tmpdir(), "prfnow-")), "bt.json");
  execFileSync("python3", [ROOT + "scripts/fetch_prf_season.py", "--backtest-analyze", FX + "backtest-rows.json.gz", FX + "prelim-202609.json.gz"],
    { env: { ...process.env, PRF_BACKTEST_OUT: out }, stdio: "pipe" });
  const again = JSON.parse(readFileSync(out, "utf8"));
  assert.deepEqual(again.card, card);
  assert.deepEqual(again.cpc.summary, pinned.cpc.summary);
  assert.deepEqual(again.prelim, pinned.prelim);
});

test("wired on /prf and on every county page, with nothing baked in", () => {
  const prf = readFileSync(ROOT + "prf.html", "utf8");
  assert.match(prf, /<section class="prf-now" id="prf-now"[^>]*hidden>/);
  assert.match(prf, /<script src="\/components\/prf-now\.js\?v=\d+" defer><\/script>/);
  const page = readFileSync(ROOT + "prf/texas/anderson-county.html", "utf8");
  const sec = /<section class="prf-now" id="prf-now" data-st="TX" data-grids="([\d,]+)" data-grid="(\d+)"[\s\S]*?<\/section>/.exec(page);
  assert.ok(sec, "county card");
  assert.ok(sec[1].split(",").includes(sec[2]), "opens on one of the county's grids");
  assert.doesNotMatch(sec[0], /\d+\.\d\d in/, "no numbers in the page itself");
  assert.doesNotMatch(sec[0], /agent|sponsor|email|sign up/i, "no lead capture or routing");
  assert.doesNotMatch(src, /—/, "no em dashes in the component");
  const shown = N.render(N.model(doc([[1000, 1200], [1500, 1000], [762, 1270], [100, 900]]), 14538, "2026-10-17"));
  assert.doesNotMatch(shown, /agent|sponsor|email|sign up|best/i, "the card routes nobody anywhere");
  // every county page carries it
  for (const st of ["texas", "montana", "kansas"]) {
    for (const f of readdirSync(ROOT + "prf/" + st)) {
      assert.match(readFileSync(ROOT + "prf/" + st + "/" + f, "utf8"), /id="prf-now" data-st="[A-Z]{2}"/, f);
    }
  }
});

test("state files, when built, are small, well formed and carry the pinned accuracy", () => {
  const dir = ROOT + "data/prf/now/";
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).filter((f) => /^[A-Z]{2}\.json$/.test(f));
  for (const f of files) {
    const buf = readFileSync(dir + f);
    assert.ok(buf.length <= 150000, `${f} is ${buf.length} bytes`);
    const d = JSON.parse(buf.toString());
    assert.equal(d.st + ".json", f);
    assert.deepEqual(d.acc, card, `${f} accuracy`);
    for (const row of Object.values(d.g)) assert.equal(row.length, d.iv.length);
  }
});
