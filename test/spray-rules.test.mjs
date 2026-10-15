/* /spray: the rules that turn a forecast into Good / Marginal / Poor, and the
 * label numbers printed on the page.
 *
 * The rules run from the block between the spray-rules markers in spray.html,
 * the same copy the browser runs.
 *
 *   node --test test/spray-rules.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "spray.html", "utf8");
const m = HTML.match(/\/\* spray-rules:start \*\/([\s\S]*?)\/\* spray-rules:end \*\//);

function rules() {
  assert.ok(m, "spray.html has a spray-rules block");
  const ctx = { Date, document: { getElementById: () => null } }; // the test realm's Date, so instanceof holds
  vm.runInNewContext(m[1] + "\nthis.R={windRatingG,boomWind,dicambaStatus,dicambaDay,DICAMBA_STATES,PRODUCTS,deltaTC,fmtDeltaT,verdictWhy,DICAMBA_CAP};", ctx);
  return ctx.R;
}
const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/&deg;/g, "°").replace(/&ndash;/g, "–").replace(/&rsquo;/g, "’").replace(/&amp;/g, "&");

test("boom wind uses the FAO-56 profile: 4.87 / ln(67.8 x 10 - 5.42) = 0.748 of the 10 m wind", () => {
  const R = rules();
  assert.ok(Math.abs(R.boomWind(10) - 7.48) < 0.01, String(R.boomWind(10)));
  assert.equal(R.boomWind(null), null);
});

test("sustained wind at boom height sets the rating; a gust over the max is a caution, not a stop", () => {
  const R = rules(), G = R.PRODUCTS.general, D = R.PRODUCTS.dicamba;
  // 10 mph at 10 m (about 7.5 at the boom) gusting 16: was POOR, the label allows it.
  assert.equal(R.windRatingG(10, 16, G), "marginal");
  assert.equal(R.windRatingG(10, 12, G), "good");
  // 16 mph at 10 m is about 12 at the boom: the 10-15 marginal band now shows.
  assert.equal(R.windRatingG(16, 20, G), "marginal");
  // 21 mph at 10 m is about 15.7 at the boom: over the 15 mph max.
  assert.equal(R.windRatingG(21, 28, G), "poor");
  // Dicamba max 10 at the boom: 13 mph at 10 m (9.7) passes, 14 (10.5) does not.
  assert.equal(R.windRatingG(13, null, D), "good");
  assert.equal(R.windRatingG(14, null, D), "poor");
  // Under 3 mph at the boom is calm-air inversion risk: 3.5 mph at 10 m is 2.6 at the boom.
  assert.equal(R.windRatingG(3.5, 5, G), "poor");
});

const day = (ds, hi, extra = {}) => ({ time: [ds, ds.slice(0, 8) + String(+ds.slice(8) + 1).padStart(2, "0")], temperature_2m_max: hi, sunrise: [ds + "T05:30", null], sunset: [ds + "T21:00", null], ...extra });

test("Minnesota and Illinois: over 85F forecast high or field air temperature blocks OTT dicamba", () => {
  const R = rules(), D = R.PRODUCTS.dicamba, MN = R.DICAMBA_STATES.MN, IL = R.DICAMBA_STATES.IL;
  const d = day("2026-06-10", [88, 80]);
  const t = new Date("2026-06-10T10:00");
  // Federal label only: 85-94 is the acreage cap, a caution.
  assert.equal(R.dicambaStatus(D, d, t, 0, null, 80).level, "caution");
  // Minnesota: forecast high 88 is over 85, so no.
  const mn = R.dicambaStatus(D, d, t, 0, MN, 80);
  assert.equal(mn.level, "block");
  assert.match(mn.reason, /Minnesota/);
  assert.match(mn.reason, /85/);
  // Field air temperature over 85 blocks even with a cool forecast high.
  assert.equal(R.dicambaStatus(D, day("2026-06-10", [84, 80]), t, 0, IL, 86).level, "block");
  // Exactly 85 is not over 85.
  assert.equal(R.dicambaStatus(D, day("2026-06-10", [85, 80]), t, 0, MN, 85).level, "caution");
  // Cutoff dates: Illinois June 20, Minnesota June 30 (June 12 south of I-94).
  assert.equal(R.dicambaStatus(D, day("2026-06-22", [80, 80]), new Date("2026-06-22T10:00"), 0, IL, 75).level, "block");
  const mnJune15 = R.dicambaStatus(D, day("2026-06-15", [80, 80]), new Date("2026-06-15T10:00"), 0, MN, 75);
  assert.equal(mnJune15.level, "caution");
  assert.match(mnJune15.reason, /I-94/);
  assert.equal(R.dicambaStatus(D, day("2026-07-01", [80, 80]), new Date("2026-07-01T10:00"), 0, MN, 75).level, "block");
  // The day strip uses the same state rule.
  assert.equal(R.dicambaDay(d, 0, MN).level, "block");
  assert.equal(R.dicambaDay(d, 0, null).level, "caution");
});

test("the acreage cap says half of the untreated dicamba-tolerant acres, with a two-day wait", () => {
  const R = rules();
  assert.match(R.DICAMBA_CAP, /half of your untreated dicamba-tolerant acres in the county/);
  assert.match(R.DICAMBA_CAP, /two days/);
  const page = strip(HTML);
  assert.ok(!/no more than 50% of your dicamba-tolerant acres/.test(page), "old 50% wording is gone");
});

test("delta T reads in F first, C in brackets; bands stay 2-8 C = 3.6-14.4 F", () => {
  const R = rules();
  assert.equal(R.fmtDeltaT(5), "9.0°F (5.0°C)");
  assert.match(strip(HTML), /Ideal 3\.6–14\.4°F \(2–8°C\)/);
});

test("the phone verdict says why", () => {
  const R = rules();
  const why = R.verdictWhy("poor", [{ r: "poor", t: "wind about 16 mph at the boom, over the 15 mph max" }, { r: "good", t: "x" }]);
  assert.equal(why, "Why: wind about 16 mph at the boom, over the 15 mph max.");
  assert.equal(R.verdictWhy("marginal", [{ r: "marginal", t: "gusts to 18 mph" }, { r: "na", na: "humidity not in forecast" }]), "Watch: gusts to 18 mph; humidity not in forecast.");
  assert.equal(R.verdictWhy("good", [{ r: "poor", t: "x" }]), "");
});

test("rain-free table: OTT dicamba is 4 hrs (XtendiMax label; MSU and UADA list Engenia at 4)", () => {
  const rows = [...HTML.matchAll(/<tr><td>([^<]*)<\/td><td class="rfp-min">([^<]*)<\/td>/g)].map((r) => [strip(r[1]), strip(r[2])]);
  const get = (re) => (rows.find((r) => re.test(r[0])) || [])[1];
  assert.equal(get(/^Dicamba/), "4 hrs");
  assert.equal(get(/Glufosinate/), "4 hrs");
  assert.equal(get(/Paraquat/), "2 hrs");
  assert.equal(get(/PPO/), "0.5–4 hrs");
  assert.equal(get(/Glyphosate/), "1–6 hrs");
  const page = strip(HTML);
  assert.ok(!/Dicamba labels typically require 1–4 hours/.test(page));
  assert.match(page, /Dicamba \(Stryax, Engenia, Tavium\) needs 4 hours/);
});

test("visible FAQ and FAQPage JSON-LD match word for word for the changed answers", () => {
  const ld = JSON.parse(HTML.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const faq = ld["@graph"].find((g) => g["@type"] === "FAQPage").mainEntity;
  for (const q of ["What temperature is too hot to spray dicamba?", "How long after spraying does it need to stay dry?", "What wind speed is safe for spraying herbicides?"]) {
    const a = faq.find((x) => x.name === q).acceptedAnswer.text;
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const vis = HTML.match(new RegExp(esc + '<span class="faq-chevron"[^>]*>[^<]*</span></button><div class="faq-a">([\\s\\S]*?)</div></div>'));
    assert.ok(vis, q);
    assert.equal(strip(vis[1]), a, q);
  }
});
