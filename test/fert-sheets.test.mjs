/* Price sheets by email on /fertilizer (Sig, 2026-10-16).
 *
 * data/fert-sheets/*.json holds a co-op price sheet Sig received by email,
 * entered from the sheet. scripts/build_fert_prices.py copies it into the
 * "sheets" list of data/fertilizer-prices.json; components/fert-sheets.js
 * draws it. A sheet is a booking/prepay price for a coming season, so it must
 * never move today's middle price, and an n/a row must never become a number.
 * Values below are hand-checked against the Synergy Cooperative sheet dated
 * 10/1/2026: urea 46-0-0 cash 610, charge 628; N-EDGE EZ (~ESN 44-0-0) cash
 * 800, charge 824; seven rows n/a.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const require = createRequire(import.meta.url);
const FSH = require(ROOT + "components/fert-sheets.js");
const SHEET = JSON.parse(read("data/fert-sheets/synergy-2026-10-01.json"));
const PRICES = JSON.parse(read("data/fertilizer-prices.json"));
const HTML = read("fertilizer.html");
const TODAY = "2026-10-16";

/* The builder's own build() on the saved co-op fixtures (Kansas urea middle
   622.98, the same numbers its selftest uses) and a fixed date, so these
   checks do not move when the live co-op prices or the calendar do. */
function buildWith(sheets, today = "2026-10-16") {
  const py = `
import json, sys, datetime
sys.path.insert(0, "scripts")
import build_fert_prices as b
import fetch_coop_fert
coops = fetch_coop_fert.fixture_doc()
sheets = json.loads(sys.stdin.read())
print(json.dumps(b.build(coops, datetime.date.fromisoformat("${today}"), sheets)))
`;
  return JSON.parse(execFileSync("python3", ["-c", py], { cwd: ROOT, encoding: "utf8", input: JSON.stringify(sheets) }));
}

const DOC = buildWith([SHEET]);

test("the builder's selftest passes", () => {
  const out = execFileSync("python3", ["scripts/build_fert_prices.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /selftest ok/);
});

test("the sheet file matches the emailed sheet; n/a rows are null, never 0", () => {
  assert.equal(SHEET.coop, "Synergy Cooperative");
  assert.equal(SHEET.sheet_date, "2026-10-01");
  assert.equal(SHEET.how_received, "received by email");
  assert.match(SHEET.season, /Spring 2027 booking/);
  const by = Object.fromEntries(SHEET.rows.map((r) => [r.raw, r]));
  assert.deepEqual([by["46-0-0"].cash, by["46-0-0"].charge, by["46-0-0"].changed], [610, 628, true]);
  assert.deepEqual([by["N-EDGE EZ (~ESN 44-0-0)"].cash, by["N-EDGE EZ (~ESN 44-0-0)"].charge], [800, 824]);
  const na = SHEET.rows.filter((r) => r.raw !== "46-0-0" && !/N-EDGE/.test(r.raw));
  assert.equal(na.length, 7);
  for (const r of na) assert.ok(r.cash === null && r.charge === null && r.changed === false, r.raw);
  assert.equal(SHEET.notes.length, 3);
  assert.match(SHEET.notes.join(" "), /Add \$10\/Ton for 25% down, 75% due March 31, 2027/);
  assert.match(SHEET.provenance.image, /kept out of the public site/);
});

test("no screenshot of the emailed sheet is published", () => {
  const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n");
  assert.deepEqual(files.filter((f) => /synergy/i.test(f) && /\.(png|jpe?g|gif|webp|pdf)$/i.test(f)), []);
});

test("a sheet never changes today's middle price, per_lb or programs", () => {
  const without = buildWith([]);
  const withSheet = buildWith([SHEET]);
  for (const k of ["prices", "per_lb", "programs", "updated"]) assert.deepEqual(withSheet[k], without[k], k);
  assert.ok(withSheet.prices.every((p) => p.src === "coop"));
  assert.equal(withSheet.sheets.length, 1);
  // the shipped file: sheets present, today's urea still the co-op middle
  const urea = PRICES.prices.find((p) => p.key === "urea");
  assert.equal(urea.src, "coop");
  assert.notEqual(urea.price, 610);
  assert.ok(Array.isArray(PRICES.sheets));
});

test("the shared file carries the sheet apart, with the math worked out", () => {
  const s = DOC.sheets[0];
  assert.equal(s.src, "price-sheet");
  assert.equal(s.label, "Synergy Cooperative, Northwest Wisconsin, Spring 2027 booking price sheet dated Oct 1, 2026 (received by email)");
  assert.equal(s.show_until, "2027-01-29", "120 days after Oct 1, before the Apr 30 season end");
  const u = s.rows.find((r) => r.raw === "46-0-0");
  assert.equal(u.per_lb_n.lb_n_per_ton, 920);
  assert.equal(u.per_lb_n.cash, 0.663, "610 / 920 = 0.66304");
  assert.equal(u.per_lb_n.charge, 0.6826, "628 / 920 = 0.68261");
  const e = s.rows.find((r) => /N-EDGE/.test(r.raw));
  assert.equal(e.per_lb_n.cash, 0.9091, "800 / 880");
  assert.equal(e.today, undefined, "the co-ops post no ESN: no comparison");
  assert.equal(u.today.price, buildWith([]).prices.find((p) => p.key === "urea").price);
  for (const r of s.rows.filter((r) => !r.priced)) assert.ok(r.cash === null && r.charge === null && !r.per_lb_n && !r.today, r.raw);
});

test("the box: date, booking, cash and charge, $/lb N, today beside it, notes, call the co-op", () => {
  const h = FSH.section(DOC, TODAY);
  assert.match(h, /Spring 2027 booking prices \(price sheets by email\)/);
  assert.match(h, /Synergy Cooperative, Northwest Wisconsin/);
  assert.match(h, /Sheet dated <strong>Oct 1, 2026<\/strong>, received by email/);
  assert.match(h, /not today&rsquo;s price/);
  assert.match(h, /<td>\$610<\/td><td>\$628<\/td><td>\$0\.66 \/ \$0\.68<\/td>/);
  assert.match(h, /<td>\$800<\/td><td>\$824<\/td><td>\$0\.91 \/ \$0\.94<\/td>/);
  assert.match(h, /\$610 a ton \/ \(2,000 lb x 46% N\) = \$0\.66 a lb of N/);
  assert.match(h, /\$800 a ton \/ \(2,000 lb x 44% N\) = \$0\.91 a lb of N/);
  assert.match(h, /never averaged/);
  assert.match(h, /Kansas co-ops today: urea \$623 a ton cash \(Kansas co-ops, middle of 4, posted Oct 6, 2026\)/);
  assert.match(h, /Prices subject to change at any time\./);
  assert.match(h, /Volume Discounts may be applied thru April 30th, 2027 on Spring Prepay Only/);
  assert.match(h, /Call Synergy Cooperative to confirm and to book/);
  assert.match(h, /Excluding Ashland/);
  assert.doesNotMatch(h, /—/, "no em dashes");
});

test("n/a rows show as not priced, never as a number", () => {
  const h = FSH.section(DOC, TODAY);
  assert.match(h, /not priced yet \(printed n\/a\): 0-0-60, S10 \(12-40-0-10S\), 21-0-0-24S, K-MAG PREMIUM/);
  for (const raw of ["0-0-60", "21-0-0-24S", "Aspire (0-0-58-0.5B)"]) {
    assert.doesNotMatch(h, new RegExp(`<td class="prod">[^<]*${raw.replace(/[()]/g, "\\$&")}`), `${raw} has no price row`);
  }
  assert.doesNotMatch(h, /\$0<|\$0 /);
});

test("no current sheet: nothing drawn; past show_until: hidden even if the file is old", () => {
  assert.equal(FSH.section(null, TODAY), "");
  assert.equal(FSH.section({ prices: [] }, TODAY), "");
  assert.equal(FSH.section({ sheets: [] }, TODAY), "");
  assert.equal(FSH.section(DOC, "2027-01-30"), "");
  assert.notEqual(FSH.section(DOC, "2027-01-29"), "");
  const allNa = JSON.parse(JSON.stringify(DOC));
  allNa.sheets[0].rows.forEach((r) => { r.cash = null; r.charge = null; });
  assert.equal(FSH.section(allNa, TODAY), "");
});

test("the page loads the box apart from today's prices", () => {
  assert.match(HTML, /<section id="fert-sheets" aria-labelledby="fert-sheets-h" hidden><\/section>/);
  assert.match(HTML, /<script src="\/components\/fert-sheets\.js\?v=\d+"><\/script>/);
  assert.ok(HTML.indexOf('id="fert-verdict"') < HTML.indexOf('id="fert-sheets"'), "after the current prices");
  // the sheet never reaches the calculator rows
  assert.doesNotMatch(read("components/fert-sources.js"), /sheets/);
  assert.doesNotMatch(read("components/fert-sheets.js"), /—/);
});
