/* Rain Print panel, Nov 9 2026 (skeptic fixes 3 to 10; Sig's decisions the same day in STANDING-DECISIONS).
 * Fixtures and stubs only: no outside host is asked.
 *   4  a thin year names the exact-spot estimate (1981 on) and shows the help line; a marked day drops "another year"
 *   5  an automatic draw is not one of the reader's tries; a typo offers the nearest spelling (data/places)
 *   6  S, M..., A is one accumulation (Chetek 2.0 SE, Jul 21-25 2025, the real ACIS rows), page and county set alike
 *   7  one "full years" rule: the rank counts the years up to the print's and needs 30; a year record said twice goes
 *   8  priceValidUntil never in the past (a fake clock), and every return description has the redo-or-refund
 *   9  one closed Sources and terms fold at the bottom, holding the thresholds the questions no longer carry
 *   10 one size line per product, S.D. accepted, a noscript line
 * The station pick (3) is in test/rain-print-chetek-oct21.test.mjs (Ames 2012 and Chetek in a browser).
 *   node --test test/rain-print-panel-nov9.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
// a local stand-in for fetch: only our own data/places/ files, from this checkout
const localFetch = async (u) => {
  const m = /\/data\/places\/[a-z]+\/[a-z_]{2}\.json/.exec(String(u));
  if (!m || !existsSync(ROOT + m[0].slice(1))) return { ok: false, status: 404, json: async () => null };
  const body = readFileSync(ROOT + m[0].slice(1), "utf8");
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
};
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob, setTimeout, clearTimeout, AbortController, fetch: localFetch, require: createRequire(ROOT + "components/x.js") };
ctx.window = ctx;
vm.runInNewContext(read("components/rain-print.js"), ctx);
vm.runInNewContext(read("components/rain-print-extras.js"), ctx);
vm.runInNewContext(read("components/rain-print-records.js"), ctx);
const RP = ctx.RainPrint, X = ctx.AgRainExtras, REC = ctx.AgRainRecords;
const plain = (x) => JSON.parse(JSON.stringify(x));

// ---------- 6. S, M..., A ----------
// US1WIBR0002 (Chetek 2.0 SE), 2025, as ACIS sent it to the data seat on Nov 9 (pcpn, snow columns)
const CHETEK_JUL = [["2025-07-19", "1.30"], ["2025-07-20", "0.04"], ["2025-07-21", "S"], ["2025-07-22", "M"], ["2025-07-23", "M"], ["2025-07-24", "M"], ["2025-07-25", "0.98A"], ["2025-07-26", "0.00"]];
const daysOf = (rows) => rows.map(([d, p], i) => { const x = RP.parsePcpn(p), dt = new Date(d + "T00:00:00Z"); return { date: d, v: x.v, flag: x.flag, t: null, s: null, m: dt.getUTCMonth(), d: dt.getUTCDate(), doy: i }; });

test("6: Chetek 2.0 SE, Jul 21 S, Jul 22-24 M, Jul 25 0.98A: one accumulation, no gaps, the rain counted once", () => {
  const out = RP.closeOpenS(daysOf(CHETEK_JUL));
  assert.deepEqual(out.map((x) => x.flag), ["", "", "S", "S", "S", "S", "A", ""]);
  const D = RP.derive(out);
  assert.equal(D.missing, 0, "no day drawn as a gap");
  assert.equal(D.unsplit, 4, "four days reported together in the Jul 25 total");
  assert.equal(Math.round(D.total * 100) / 100, 2.32, "1.30 + 0.04 + 0.98");
  assert.equal(D.max.v, 1.3, "an A total is never the wettest day");
  // the usual year keeps those days' normal (their rain is in the total): both sides count the same days
  const norm = new Map(CHETEK_JUL.map(([d]) => [d.slice(5), 0.1]));
  const o = RP.overlayDaily(out, norm);
  assert.equal(Math.round(o.total * 100) / 100, 0.8, "all 8 days keep their normal");
});

test("6: an S run with no A after its M days is still lost rain; M days and an A with no S are left as they are", () => {
  const lost = RP.closeOpenS(daysOf([["2025-03-01", "S"], ["2025-03-02", "M"], ["2025-03-03", "0.20"]]));
  assert.deepEqual(lost.map((x) => x.flag), ["M", "M", ""]);
  assert.equal(lost[0].v, null);
  const noS = RP.closeOpenS(daysOf([["2025-03-01", "M"], ["2025-03-02", "M"], ["2025-03-03", "0.50A"]]));
  assert.deepEqual(noS.map((x) => x.flag), ["M", "M", "A"], "without an S nobody knows when the catch began");
  const plainSA = RP.closeOpenS(daysOf([["2025-03-01", "S"], ["2025-03-02", "S"], ["2025-03-03", "0.50A"]]));
  assert.deepEqual(plainSA.map((x) => x.flag), ["S", "S", "A"]);
});

test("6: the county set reads the same rule (rain-county-print.js uses RP.closeOpenS; county_rain.close_runs in Python)", () => {
  assert.match(read("components/rain-county-print.js"), /return RP\.closeOpenS\(out\);/);
  const py = execFileSync("python3", ["-c", `
import sys, json; sys.path.insert(0, "scripts")
import county_rain as R
rows = ${JSON.stringify(CHETEK_JUL.map((r) => r[1]))}
pp = [R.parse_pcpn(v) for v in rows]
print(json.dumps({"runs": [f for v, f in R.close_runs(pp)], "s": [f for v, f in R.close_s(pp)],
  "lost": [f for v, f in R.close_runs([R.parse_pcpn(v) for v in ["S", "M", "0.20"]])],
  "tail": [f for v, f in R.close_s([R.parse_pcpn(v) for v in ["0.10", "S", "M"]])],
  "snow": R.snow_state(rows, ["0.0"] * len(rows), 2025)}))`], { cwd: ROOT, encoding: "utf8" });
  const got = JSON.parse(py);
  assert.deepEqual(got.runs, ["", "", "S", "S", "S", "S", "A", ""]);
  assert.deepEqual(got.s, got.runs, "close_s: the same, the summary counts the days as reported together");
  assert.deepEqual(got.lost, ["M", "M", ""]);
  assert.deepEqual(got.tail, ["", "S", "M"], "a run still open at the end waits for its A");
  assert.ok(read("scripts/build_county_rain.py").includes("close_runs"), "the builder names the rule it mirrors");
});

// ---------- 4. a thin year ----------
test("4: Lennox, SD 1994, 38 days missing: the exact-spot estimate named (1981 on), no 'another year' with a wedding marked", () => {
  const marked = RP.thinWords("Lennox", 38, 1994, "Lennox", { picked: false, n: 3, spot: true, marked: true });
  assert.match(marked, /^Lennox has 38 unrecorded days in 1994\. They would print as dry spells that may not have been dry\. /);
  assert.match(marked, /This exact spot \(PRISM estimate\), is an estimate for Lennox itself from nearby gauges, rain only, 1981 on\./);
  assert.ok(!/another year/.test(marked), marked);
  const plainW = RP.thinWords("Lennox", 38, 1994, "Lennox", { picked: false, n: 3, spot: true, marked: false });
  assert.match(plainW, /Try another year, or a bigger town nearby\. Under Weather station, the last choice/);
  const old = RP.thinWords("Lincoln", 40, 1894, "Lincoln", { picked: false, n: 3, spot: false, marked: true });
  assert.ok(!/PRISM|exact spot/.test(old) && !/another year/.test(old), "1894: no spot estimate offered, still no other year");
  const S = read("components/rain-print.js");
  assert.match(S, /blockPrint\(thinWords\([\s\S]{0,400}?\)\);\n\s+helpLine\(true\);\n\s+throw 'blocked';/, "the call-or-text line shows with it");
});

// ---------- 5. tries and spelling ----------
test("5: an automatic draw is not a try: the reader's first press reads plain, the second says 2 tries", () => {
  const m = "Couldn’t find “Lenox” in South Dakota.";
  assert.equal(RP.againWords(m, true), m, "the draw the year change started");
  assert.equal(RP.againWords(m, false), m, "the reader's first Draw");
  assert.equal(RP.againWords(m, false), "Asked again just now (2 tries). " + m);
  assert.match(read("components/rain-print.js"), /RUN_AUTO = !!\(e && e\.auto\);/);
});

test("5: S.D., S. Dak. and South Dakota are South Dakota; a town's own last word is not read as a state", () => {
  for (const q of ["Lennox, S.D.", "Lennox, S. Dak.", "Lennox, South Dakota", "Lennox, SD", "Lennox S.D.", "Lennox S. Dak."]) assert.equal(RP.geocodeQuery(q).st, "sd", q);
  assert.deepEqual(plain(RP.geocodeQuery("Lennox S.D.")), { zip: "", town: "Lennox", st: "sd" });
  assert.equal(RP.geocodeQuery("Ames IA").st, "ia");
  assert.equal(RP.geocodeQuery("Mount Vernon").st, "", "no state");
  assert.equal(RP.geocodeQuery("Neb City").town, "Neb City", "no period: never a state");
});

test("5: \"Lenox, SD\" offers Lennox, SD from our own town file, and the choice shows as a button", async () => {
  const PL = createRequire(import.meta.url)(ROOT + "components/places.js");
  const get = (u) => localFetch(u);
  const n = await PL.near("Lenox", { country: "US", st: "SD", get });
  assert.deepEqual(n.results.map((r) => r.name + ", " + r.st), ["Lennox, SD"]);
  const any = await PL.near("Lenox", { country: "US", get });
  assert.ok(any.results.some((r) => r.name === "Lennox"), "without a state too");
  assert.ok(!(await PL.near("Chetek", { get })).results.some((r) => r.name === "Chetek"), "a real town is never its own suggestion");
  assert.deepEqual((await PL.near("Qqqqqq", { get })).results, [], "nothing near: nothing offered");
  let err = null;
  try { await RP.geoFind("Lenox, SD"); } catch (e) { err = e; }
  assert.ok(err, "not found");
  assert.equal(err.message, "Couldn’t find “Lenox” in South Dakota. Did you mean Lennox, SD?");
  assert.equal(err.suggest.length, 1);
  const S = read("components/rain-print.js");
  assert.equal((S.match(/if \(err && err\.suggest\) showPick\(err\.suggest\);/g) || []).length, 2, "both failure views show the choice");
  assert.match(S, /PLACES_JS = '\/components\/places\.js\?v=2'/);
});

// ---------- 7. one full years rule ----------
test("7: Houston 2017: the rank counts only the full years up to 2017, and says so", () => {
  const full = Array.from({ length: 76 }, (_, k) => ({ year: 1950 + k, total: 40 + (k % 9), cum: [] }));
  full.find((f) => f.year === 2017).total = 78.88;
  full.find((f) => f.year === 2024).total = 90;   // a later, wetter year: not counted
  const rk = X.rank(full, 2017, { upTo: true, min: 30 });
  assert.equal(rk.n, 68, "1950 to 2017");
  assert.equal(rk.text, "The wettest of the 68 full years this station kept up to 2017");
  assert.equal(X.rank(full, 1975, { upTo: true, min: 30 }), null, "26 full years up to 1975: no rank, as the remarkable days need 30");
  assert.equal(X.rank(full, 2017).n, 76, "without upTo the old whole-record count (the /here card filters itself)");
  const S = read("components/rain-print.js");
  assert.match(S, /X\.rank\(full, year, \{ upTo: true, min: HIST_MIN \}\)/, "the gray lines' rank uses it");
});

test("7: Fresno 1983: the year record goes when the rank already says wettest; a month record says its own count", () => {
  const full = Array.from({ length: 40 }, (_, k) => ({ year: 1944 + k, total: 8 + (k % 5), cum: [] }));
  full.find((f) => f.year === 1983).total = 21.61;
  const recs = [{ kind: "wetYear", label: "Wettest year in this station’s record, back to 1948" }, { kind: "wetWeek", label: "Wettest week: 3.00 in" }];
  assert.deepEqual(plain(RP.notTwice(recs, full, 1983)).map((r) => r.kind), ["wetWeek"]);
  assert.deepEqual(plain(RP.notTwice(recs, full.filter((f) => f.year !== 1983), 1983)).map((r) => r.kind), ["wetYear", "wetWeek"], "no rank: the record stays");
  assert.deepEqual(plain(RP.notTwice([{ kind: "dryYear" }], full, 1983)).map((r) => r.kind), ["dryYear"], "the other end stays");
  assert.match(read("components/rain-print-records.js"), /' of ' \+ best\.n \+ ' full ' \+ MONTHS\[best\.m\] \+ ': '/);
  assert.match(read("components/rp-canada.js"), /' full ' \+ \(\['Januaries', 'Februaries', 'Marches'\]\[m\] \|\| MONTH_EN\[m\] \+ 's'\)/);
});

// ---------- 8. structured data ----------
const HTML = read("rain-print.html");
const LDTEXT = HTML.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1];
const offers = (t) => JSON.parse(t)["@graph"].find((g) => g["@type"] === "Product").offers;

test("8: priceValidUntil is never in the past, on any clock the page runs on (a fake clock)", () => {
  for (const today of ["2026-11-09", "2026-12-31", "2027-01-01", "2028-02-29", "2031-07-04"]) {   // pin-ok: fake clocks handed to a pure function
    for (const o of offers(RP.ldPriceDates(LDTEXT, today))) {
      assert.ok(o.priceValidUntil >= today, today + " " + o.sku + " " + o.priceValidUntil);
      assert.equal(o.priceValidUntil.slice(0, 4), today.slice(0, 4) > o.priceValidUntil.slice(0, 4) ? today.slice(0, 4) : o.priceValidUntil.slice(0, 4));
    }
  }
  assert.equal(RP.priceDateFor("2027-03-01", "2026-12-31"), "2027-12-31");   // pin-ok: fake clock
  assert.equal(RP.priceDateFor("2026-11-09", "2026-12-31"), "2026-12-31", "a date still ahead stands");   // pin-ok: fake clock
  assert.equal(RP.ldPriceDates("not json", "2027-01-01"), "not json");   // pin-ok: fake clock
  assert.match(read("components/rain-print.js"), /ldPriceDates\(ldEl\.textContent, TODAY\)/, "the page applies it with its own today");
});

test("8: every offer's return description carries the redo-or-refund and agrees with the page", () => {
  for (const o of offers(LDTEXT)) {
    const p = o.hasMerchantReturnPolicy;
    assert.match(p.description, /^If it’s not right, I’ll redo it or refund it\./, o.sku);
    assert.equal(p.returnPolicyCategory, "https://schema.org/MerchantReturnNotPermitted");
  }
  assert.match(HTML, /<summary>What if something&rsquo;s wrong with it\?<\/summary><p>If it&rsquo;s not right, I&rsquo;ll redo it or refund it\./);
});

// ---------- 9. the sources and terms fold ----------
test("9: one closed Sources and terms fold, last in the page, with the thresholds; the questions keep the facts in words", () => {
  const main = HTML.slice(HTML.indexOf("<main"), HTML.indexOf("</main>"));
  const folds = main.match(/<details[^>]*><summary>Sources and terms<\/summary>/g) || [];
  assert.equal(folds.length, 1);
  assert.ok(!/\sopen[ >]/.test(folds[0]), "closed");
  const i = main.indexOf(folds[0]), e = main.indexOf("</details>", i), fold = main.slice(i, e);
  assert.ok(!/<details/.test(main.slice(e + 10)), "nothing folded after it");
  for (const w of ["10 or fewer", "11 to 31", "more than 31", "4 km grid", "1981 on", "32°F", "1991 to 2020", "30 or more full years", "GeoNames (CC BY 4.0)", "redo it or refund it"]) assert.ok(fold.includes(w), w);
  const faq = main.slice(main.indexOf('id="rp-faq-h"'), main.indexOf("rp-byline"));
  for (const w of ["10 or fewer", "11 to 31", "31 days", "4 km", "32°F", "1991 to 2020", "at least 30 full years"]) assert.ok(!faq.includes(w), "the reading path has no " + w);
  assert.match(faq, /Missing days show as gaps, never as dry days/);
  assert.match(faq, /where your year ranks among the years up to it\. It needs a long record at the print&rsquo;s own station\./);
  assert.ok(!/<a [^>]*href="https?:\/\/(?!agsist)/.test(fold), "sources named in plain text, no link to a data source");
  assert.ok(!/—|&mdash;/.test(fold));
});

// ---------- 10. sizes, noscript ----------
test("10: one size line first under each product; a noscript line by the drawing tool and the business form", () => {
  const sizes = [...HTML.matchAll(/<h3>(Framed|Print|Digital file)<\/h3><ul><li class="rp-size">([^<]*)<\/li>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(sizes, [["Framed", "The picture 16.5 x 10.5 in through the mat, on a 13 x 19 in print"],
    ["Print", "A 13 x 19 in sheet with the picture 16.5 x 11 in in the middle"], ["Digital file", "The picture alone, 12 x 18 in"]]);
  const ns = HTML.match(/<noscript>[\s\S]*?<\/noscript>/g) || [];
  assert.equal(ns.length, 2);
  for (const n of ns) assert.ok(/tel:\+17157972428/.test(n) && /mailto:sig@agsist\.com/.test(n), n);
  assert.ok(HTML.indexOf(ns[1]) < HTML.indexOf('<form id="rb-form"') && HTML.indexOf('<form id="rb-form"') - HTML.indexOf(ns[1]) < 400, "right before the business form");
});
