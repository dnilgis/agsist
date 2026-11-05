/* USDA production cost reports (Sig, Nov 2, 2026): fertilizer, farm diesel and propane from USDA
 * My Market News into data/production-costs.json (scripts/fetch_prodcost_mars.py), shown on Fast
 * Facts My place.
 *   node --test test/prodcost-mars.test.mjs
 * - the reader's selftest passes on the real Oct 26-30, 2026 reports (test/fixtures/mars-prodcost/);
 * - the fertilizer row shows the newer of the co-op price and the USDA dealer survey for the state,
 *   never a blend, each with its own date and source named in plain text (no link to USDA);
 * - the farm diesel and propane rows come from the report that covers the state, or say why not;
 * - the reference tables heading says the date of its prices, never "Current";
 * - the step rides the existing fertilizer workflow: no new schedule. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const req = createRequire(import.meta.url);
const F = req(ROOT + "components/fert-pick.js");
const P = req(ROOT + "components/place.js");

test("scripts/fetch_prodcost_mars.py --selftest passes", () => {
  const r = spawnSync("python3", ["scripts/fetch_prodcost_mars.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /selftest: ok/);
});

/* The file the reader writes from the five saved reports (never the live data/ copy, which a workflow owns). */
const built = spawnSync("python3", ["-I", "-c", `
import sys, json, datetime
sys.path.insert(0, "scripts")
import fetch_prodcost_mars as M
from pathlib import Path
reps = {}
for rid in ["2863", "3195", "3621", "3159", "3883"]:
    r, _ = M.parse_report(rid, (Path(M.FIX_DIR) / (rid + ".json")).read_text(), datetime.date(2026, 11, 2))
    reps[rid] = r
print(json.dumps({"reports": reps, "daily_line": M.daily_line(reps, datetime.date(2026, 11, 2))}))
`], { cwd: ROOT, encoding: "utf8" });
const PC = JSON.parse(built.stdout || "{}");
const TODAY = "2026-11-02";

/* co-op docs as components/fert-pick.js hands them over */
const row = (product, cash, date) => ({ product, cash, date, flags: [], stale: false });
const coops = (date, state) => ({ stale_days: 60, coops: [
  { id: "a", name: "Alpha Co-op", state, rows: [row("anhydrous", 800, date), row("urea", 600, date)] },
  { id: "b", name: "Bravo Co-op", state, rows: [row("anhydrous", 820, date), row("urea", 620, date)] }] });

test("the five real reports load", () => {
  assert.equal(built.status, 0, built.stderr);
  assert.deepEqual(Object.keys(PC.reports).sort(), ["2863", "3159", "3195", "3621", "3883"]);
  assert.ok(!/https?:/.test(JSON.stringify(PC)), "no link to a data source in the file");
});

test("Iowa: the USDA survey (Oct 30) is newer than the Kansas co-op sheets (Oct 14), so it shows", () => {
  const doc = F.choose(coops("2026-10-14", "KS"), "IA", TODAY);
  const u = P.usdaFert(PC, "IA", TODAY);
  assert.equal(u.key, "anhydrous");
  const f = P.factFert(doc, u);
  assert.equal(f.label, "Anhydrous ammonia");
  assert.equal(f.value + ". " + f.ctx, "$902 a ton. Iowa dealers’ asking price, $892 to $915 at the dealer. Call to confirm.");
  assert.equal(f.date, "2026-10-30");
  assert.deepEqual(f.src, ["USDA AMS, Iowa Production Cost Report", null], "named in plain text, not linked");
  // without the USDA file the co-op row stands, as before
  assert.match(P.factFert(doc, null).ctx, /co-op/);
});

test("the newer of the two wins; on the same day the reader's own state's co-op sheet comes first", () => {
  const u = P.usdaFert(PC, "IA", TODAY);
  assert.match(P.factFert(F.choose(coops("2026-10-31", "KS"), "IA", TODAY), u).ctx, /co-op/, "co-op newer");
  assert.match(P.factFert(F.choose(coops("2026-10-30", "IA"), "IA", TODAY), u).ctx, /co-op/, "same day, Iowa's own co-ops");
  assert.match(P.factFert(F.choose(coops("2026-10-30", "KS"), "IA", TODAY), u).ctx, /^Iowa dealers/, "same day, out-of-state co-ops");
  assert.match(P.factFert({ prices: [] }, u).ctx, /^Iowa dealers/, "no co-op price at all");
  // a state no USDA report covers keeps the co-op row
  assert.equal(P.usdaFert(PC, "WI", TODAY), null);
  // North Carolina prints no anhydrous: urea; a single-price line is never the pick
  assert.equal(P.usdaFert(PC, "NC", TODAY).key, "urea");
  const thin = JSON.parse(JSON.stringify(PC));
  for (const i of thin.reports["2863"].items) if (i.key === "anhydrous") i.thin = true;
  assert.equal(P.usdaFert(thin, "IA", TODAY), null, "Iowa prints no urea, and a thin anhydrous line is not shown");
  // a report over 45 days old is not shown
  assert.equal(P.usdaFert(PC, "IA", "2026-12-20"), null);
});

test("farm diesel and propane: the report for the state, its range and freight, or the reason", () => {
  const d = P.factFuel(PC, "IA", "diesel", TODAY);
  assert.equal(d.label, "Farm diesel");
  assert.equal(d.value + ". " + d.ctx, "$5.65 a gallon. Iowa fuel dealers’ asking price, $5.50 to $5.75 at the dealer. Call to confirm.");
  assert.equal(d.date, "2026-10-30");
  assert.deepEqual(d.src, ["USDA AMS, Iowa Production Cost Report", null]);
  assert.equal(P.factFuel(PC, "OK", "propane", TODAY).value, "$2.41 a gallon");
  const id = P.factFuel(PC, "ID", "diesel", TODAY);
  assert.equal(id.value, "$6.03 a gallon");
  assert.match(id.ctx, /^Inter-Mountain West fuel dealers’ asking price, \$5\.83 to \$6\.35 delivered\. Call to confirm\.$/);
  // no report covers the state, or the covering report does not price the fuel: the row is hidden (lead, Nov 3)
  for (const [st, k] of [["WI", "diesel"], ["WI", "propane"], ["IL", "propane"], ["KS", "diesel"]]) {
    const h = P.factFuel(PC, st, k, TODAY);
    assert.equal(h.hide, true, st + " " + k + " hidden");
    assert.equal(h.value, null);
  }
  assert.ok(!P.factFuel(PC, "IA", "diesel", TODAY).hide, "a covered state shows its row");
  // covered, but the newest report is over 45 days old: a dated "last USDA report" line, no stale price
  const old = P.factFuel(PC, "IA", "diesel", "2026-12-20");
  assert.equal(old.value, null);
  assert.ok(!old.hide, "a covered state keeps its row");
  assert.equal(old.why, "no USDA Iowa report since Oct 30, 2026, so no current price");
  assert.equal(old.date, "2026-10-30");
  assert.deepEqual(old.src, ["USDA AMS, Iowa Production Cost Report", null]);
  assert.equal(P.factFuel(null, "IA", "diesel", TODAY).why, "the USDA fuel price file did not load");
  for (const f of [d, id]) assert.ok(!/—/.test(f.ctx + f.value), "no em dash");
});

test("Fast Facts: the rows are in the page and the Today card, the heading carries a date, versions bumped", () => {
  const page = read("fast-facts.html"), here = read("components/here.js"), ff = read("components/fast-facts.js");
  for (const id of ["f-fert", "f-diesel", "f-propane"]) assert.match(page, new RegExp('<div class="fx-row" id="' + id + '">'), id);
  assert.match(here, /\['Today', \['f-usda', 'f-fert', 'f-diesel', 'f-propane'\]\]/);
  assert.match(here, /P\.factFert\(f, c \? P\.usdaFert\(c, st, today\) : null\)/);
  assert.match(here, /P\.factFuel\(c, st, 'diesel', today\)/);
  assert.match(here, /P\.factFuel\(c, st, 'propane', today\)/);
  assert.doesNotMatch(page, /Current Fertilizer Prices/i, "the heading never says current");
  assert.match(page, /Fertilizer Prices<span id="fert-title-date"><\/span>/);
  assert.match(ff, /getElementById\('fert-title-date'\)[\s\S]{0,80}' as of '\+d\.toLocaleDateString/);
  for (const s of ["place.js?v=13", "here.js?v=44", "fast-facts.js?v=18"]) assert.ok(page.includes("/components/" + s), s);
  assert.ok(Number(/var CACHE_VERSION = (\d+);/.exec(read("sw.js"))[1]) >= 331, "CACHE_VERSION at or past 331");
});

test("the daily line: farm diesel by region, dated and sourced in plain text", () => {
  assert.equal(PC.daily_line.text, "Farm diesel in USDA's dealer survey: Iowa $5.65 a gallon, Illinois $5.71, Oklahoma $5.54, North Carolina $5.40, Inter-Mountain West $6.03 delivered (USDA AMS production cost reports, Oct 30).");
});

test("rides the existing fertilizer workflow: selftest first, the key from secrets, no new schedule", () => {
  const wf = read(".github/workflows/fertilizer-ams.yml");
  assert.ok(wf.indexOf("fetch_prodcost_mars.py --selftest") < wf.indexOf("run: python scripts/fetch_prodcost_mars.py\n"));
  assert.match(wf, /MARS_API_KEY: \$\{\{ secrets\.MARS_API_KEY \}\}\n\s+run: python scripts\/fetch_prodcost_mars\.py\n/);
  assert.match(wf, /FILES="[^"]*data\/production-costs\.json[^"]*"/);
  assert.equal((wf.match(/- cron:/g) || []).length, 3, "the same three runs as before");
  assert.doesNotMatch(read("scripts/fetch_prodcost_mars.py"), /print\([^)]*MARS_API_KEY|print\([^)]*auth\(/, "the key is never printed");
});
