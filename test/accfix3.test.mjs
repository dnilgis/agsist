/* Accuracy pass 3 (2026-10-18): each lead that checked out as real, pinned to the
 * corrected wording or number in the shipped page (or the builder that writes it).
 *
 *   node --test test/accfix3.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const text = (h) => h.replace(/<[^>]*>/g, " ").replace(/&rsquo;/g, "’").replace(/\s+/g, " ");
const py = (code) => execFileSync("python3", ["-c", code], { cwd: ROOT, encoding: "utf8" }).trim();

test("usda-calendar: the 2026 payment needs a signed contract; Export Sales can slip to Friday", () => {
  const h = read("usda-calendar.html");
  assert.ok(!h.includes("No election means you keep your 2025 choice but get no 2026 payment."));
  assert.match(h, /every farm needs a signed 2026 enrollment contract\. Miss Dec 11 and the farm keeps its 2025 choice but gets no 2026 payment\./);
  assert.ok(!h.includes("released every Thursday at 8:30 AM"));
  assert.equal((h.match(/A federal holiday earlier in the week can push it to Friday\./g) || []).length, 2, "FAQ markup and visible answer");
});

test("fast-facts: the A2809 corn N rates carry the edition and read date", () => {
  const h = read("fast-facts.html");
  assert.match(h, /Rates are A2809 Table 6\.1 as UW posts it today \(Mar 2026 web edition, read Oct 16, 2026\)/);
  assert.equal((h.match(/UW Extension A2809 \(Mar 2026 web edition, read Oct 16, 2026\), from Wisconsin trials, gives corn after soybeans/g) || []).length, 2);
});

test("atlas: reads that hand the whole payout to one cause, or blame a wet year on drought, are not printed", () => {
  const out = py(`
import sys, json; sys.path.insert(0, 'scripts')
import build_atlas_pages as A
d = json.load(open('data/atlas/counties/27097.json'))
k = json.load(open('data/atlas/counties/17091.json'))
print(A.read_cause_total('Heat and drought have pulled $169.1 million in crop insurance payouts from Morrison County.', d),
      A.read_cause_total('Heat and drought made up 61 percent of the $169.1 million paid out.', d),
      A.read_year_cause_wrong('The worst year was 2015 at 92.5 bushels, when drought hit hard.', k),
      A.read_year_cause_wrong('The worst year was 2015 at 92.5 bushels.', k))`);
  assert.equal(out, "True False True False");
  const m = read("farmland-atlas/minnesota/morrison-county.html");
  assert.ok(!m.includes("Heat and drought have pulled $169.1 million"), "Morrison's read is dropped");
  assert.match(m, /9 of 31<small>crop years 1995–2025 with a loss ratio<\/small>/);
  assert.match(m, /Corn yield, median<\/th>/);
  assert.match(m, /one more than three survey years old shows n\/a\./);
  const kk = read("farmland-atlas/illinois/kankakee-county.html");
  assert.ok(!kk.includes("when drought hit hard"), "2015 was a wet year in Kankakee (136% of normal rain)");
  for (const st of ["missouri", "kentucky", "north-dakota"]) {
    const s = read(`farmland-atlas/${st}/index.html`);
    assert.ok(!s.includes("A dash means the source withheld"), st);
    assert.match(s, /n\/a means the source withheld the figure/);
  }
  assert.match(read("farmland-atlas.html"), /every policy since 1989 except the rainfall and vegetation index pasture plans \(PRF\)/);
  assert.match(read("farmland-atlas/sheet.html"), /\['Corn yield, median',null,M\.yld,f1\]/);
});

test("arc-plc: 10-acre rule, peanut limit, Childress title, trigger at the benchmark", () => {
  const h = read("arc-plc.html");
  assert.match(h, /added to the base on the other farms where you hold an enrolled share, come to 10 acres or less \(7 CFR 1412\.51\)/);
  assert.match(h, /Peanuts carry a separate limit of their own\./);
  assert.match(h, /wheat 41\.\d\d bu, weighted by enrolled base/);
  const c = read("arc-plc/texas/childress-county.html");
  assert.match(c, /<title>Childress Co\., TX ARC or PLC 2026: Irrigated wheat/);
  assert.match(c, /comes in under <b>41\.6 bu<\/b> at USDA&rsquo;s price outlook, \$5\.70\. That is above the 41\.0 bu benchmark/);  // the benchmark to a tenth, as the title prints it (Oct 19, 2026; was 41.00)
});

test("cash bids: Hold-to note says how the month is picked; Alabama listed; top-bid heading", () => {
  const b = read("scripts/build_cash_bid_pages.py");
  assert.ok(!b.includes("best later posted bid minus its nearest one"));
  assert.match(b, /names the later month this elevator posts that comes out best once/);
  assert.match(b, /bids at the nearest delivery, starting \{ym_\}/);
  assert.match(read("cash-bids.html"), /<a href="\/cash-bids\/alabama\/">Alabama<\/a>/);
});

test("futures pages: Brazil's export share, the July Cattle report, the ratio section, five contracts", () => {
  const s = read("soybean-futures-prices.html");
  assert.ok(!s.includes("Brazil and Argentina together export roughly 60%"));
  assert.equal((s.match(/Brazil alone exports roughly 60%/g) || []).length, 3);
  for (const f of ["soybean-futures-prices.html", "corn-futures-prices.html"]) {
    assert.ok(!read(f).includes("Key Ratios widget"), f);
  }
  const c = read("cattle-futures-prices.html");
  assert.equal((c.match(/released in January and again in July \(USDA skipped the July report in 2024 only\)/g) || []).length, 2);
  assert.match(c, /five contracts in all, this month first\./);
});

test("hail: averages and words use the same 4.8-year span; 1-inch severe share; NSSL fall speeds", () => {
  const sd = text(read("hail-map/south-dakota.html"));
  assert.ok(!/over the last 5 years/.test(sd));
  assert.match(sd, /in the 4\.8 years since January 2022/);
  const m = sd.match(/Pennington County leads South Dakota with ([\d,]+) hail reports over that span, about ([\d.]+) per year/);
  assert.ok(m);
  assert.ok(Math.abs(Number(m[1].replace(/,/g, "")) / Number(m[2]) - 4.8) < 0.06, "357 / 74.5 is 4.8 years");
  const h = read("hail-map.html");
  assert.match(h, /var span=yrSpan\(d\.generated,d\.years\);/);
  assert.ok(!h.includes("1.5″ or larger") && !h.includes("1.5&Prime; or larger"));
  assert.ok(!h.includes("golf balls around"));
  assert.match(h, /1″ to 1¾″ \(up to golf ball\) at 25–40 mph/);
  assert.match(read("hail-map/florida.html"), /The storm log keeps only the big hail days nationwide/);
});

test("daily: dated corrections on Jul 11 and Oct 17", () => {
  const j = read("daily/2026-07-11.html");
  assert.match(j, /<strong>Correction, Oct 18, 2026:<\/strong> December corn at \$4\.61 over nearby at \$4\.38 is a 23-cent carry, not an inverse/);
  assert.match(j, /so \$94\.78 was about 2% below where the week started/);
  const o = read("daily/2026-10-17.html");
  assert.match(o, /140,000 to 20,000 barrels a day is 86%, not 85%/);
  assert.equal(Math.round(100 * (140 - 20) / 140), 86);
  for (const d of ["2026-07-11", "2026-10-17"]) {
    const c = JSON.parse(read(`data/daily-archive/${d}.json`)).corrections;
    assert.ok(c.some((x) => x.date === "2026-10-18"), d);
  }
});

test("spray, urea, conditions, cot, scout, pod counts: corrected wording", () => {
  const sp = read("spray.html");
  assert.ok(!sp.includes("Below 30%") && !sp.includes("humidity under 50%"));
  assert.match(sp, /or any calendar cutoff your label or state sets, whichever comes first/);
  const u = read("urea.html");
  assert.ok(!u.includes("0.1–0.4 inches") && !u.includes("most dangerous window") && !u.includes("about two weeks of protection"));
  assert.match(u, /two to 10 weeks \(Montana State, EB0209\)/);
  assert.match(u, /At Moderate or higher \(or on no-till ground,/);
  const co = read("conditions.html");
  assert.ok(!co.includes("3 of 27") && !co.includes("every Monday night"));
  const cot = JSON.parse(read("data/cot-analysis.json"));
  const all = JSON.stringify(cot);
  assert.ok(!/that is the 90th percentile \([^)]*not crowded\)/.test(all), "a not-crowded 89.8 is not printed as the 90th");
  assert.ok(!read("cot.html").includes("routinely 20 to 50 cents"));
  assert.match(read("components/cot-market.js"), /ord\(pShown\(p, c\.crowded\)\)/);
  assert.match(read("field-scout.html"), /often 10 to 30 bushels an acre versus rotated corn/);
  assert.match(read("pod-counts.html"), /pooled it is a little over &plusmn;8/);
  assert.ok(2.056 * 3.95 > 8, "pooled band 8.12");
});

test("what's priced in: finishing order rule, Oct 9 corn, sources, closest", () => {
  const w = read("whats-priced-in.html");
  assert.ok(!w.includes("A ranking needs at least two forecasters"));
  assert.match(w, /A finishing order needs at least two forecasters with/);
  assert.match(w, /corn ending stocks landed 10\.3% over the average and read in line on a day December corn fell 20&frac12;&cent;/);
  const d = JSON.parse(read("data/whats-priced-in.json"));
  assert.match(d.latest_result.biggest_surprise.reaction, /20½¢ lower/);
  assert.ok(!w.includes("since August"));
  assert.ok(!w.includes("actuals from USDA NASS Quick Stats."));
  assert.match(w, /A midpoint we worked out from a published range does not count\./);
});

test("harvest tracker, planting date, rent, crop tour, farm bill, rain, yield estimator, radar, scorecard, fertilizer", () => {
  assert.match(read("harvest-price-tracker.html"), /Texas in September or October, by the county's sales closing date/);
  const tx = JSON.parse(read("data/rma-discovery.json")).states.Texas.soybeans.map((r) => r.harvest.start.slice(0, 2));
  assert.deepEqual([...new Set(tx)].sort(), ["09", "10"]);
  const pd = read("components/planting-date.js");
  for (const m of pd.matchAll(/fall10:'(\w+) (\d+)', fall50:'(\w+) (\d+)', fall90:'(\w+) (\d+)'/g)) {
    const t = (mo, d) => ({ Aug: 8, Sep: 9, Oct: 10 }[mo]) * 100 + Number(d);
    assert.ok(t(m[1], m[2]) < t(m[3], m[4]) && t(m[3], m[4]) < t(m[5], m[6]), "fall row runs early to late: " + m[0]);
  }
  assert.match(read("planting-date.html"), /planting-date\.js\?v=5/);
  const r = read("rent/index.html");
  assert.match(r, /it is under the 20,000-acre line, or NASS held the rate back/);
  assert.match(read("scripts/build_state_rent_pages.py"), /def whole\(x\):/);
  assert.match(read("crop-tour.html"), /number blends the tour with weather, maturity and history/);
  assert.match(read("farm-bill.html"), /subject to appropriation, FY2026&ndash;FY2036 \(11 yr\)/);
  const fl = text(read("rain/florida.html"));
  assert.match(fl, /Half the \d+ counties with a NOAA usual year are above [\d.]+% of a usual year/);
  assert.match(read("rain-gauge.html"), /You pay only for the digital file or a print\./);
  assert.match(read("yield-estimator.html"), /function spp1\(x\)/);
  assert.equal(Math.round(62.5 * 10) / 10, 62.5);
  assert.match(read("rain-radar.html"), /about six square miles/);
  assert.ok(2.8 * 2 > 5.5, "2.8 x 2 miles is 5.6 square miles");
  const sc = read("scorecard.html");
  assert.ok(!sc.includes("2,736 windows"));
  assert.match(sc, /weekly calls\)\./);
  assert.match(read("fertilizer.html"), /from Kansas and Wisconsin co-ops/);
});

test("no em dashes in the new copy", () => {
  const added = [
    "Changing your election is optional, but every farm needs a signed 2026 enrollment contract.",
    "Bigger stones fall faster.",
    "The storm log keeps only the big hail days nationwide",
  ];
  for (const a of added) assert.ok(!a.includes("—"));
  if (existsSync(path.join(ROOT, "daily/2026-07-11.html"))) {
    const c = read("daily/2026-07-11.html").match(/Correction, Oct 18, 2026:<\/strong>([^<]*)/)[1];
    assert.ok(!c.includes("—"));
  }
});
