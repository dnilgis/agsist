/* /rent/<state>: which rent leads the page (scripts/build_state_rent_pages.py lead_kind).
 *
 * Search Console, last 3 months to Oct 2026: /rent/california sat at position 2.8 with
 * 2,776 impressions and 1 click; /rent/oregon at 5.8, 2,036 impressions, 7 clicks. Both
 * descriptions led with the non-irrigated median ($34.75 in California), while NASS
 * published irrigated rent for more of those states' counties (CA 41 vs 20, OR 23 vs 15).
 *
 * Rule: of the two cropland rents, the one NASS published for more counties in the
 * latest year leads; a tie goes to non-irrigated; a kind needs MIN_DRY (3) counties.
 * The other kinds are printed beside the lead in the description, hero and FAQ.
 *
 *   node --test test/rent-lead-kind.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const py = (code) => execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'scripts'); import build_state_rent_pages as b\n" + code],
  { cwd: ROOT, encoding: "utf8" });
const meta = (h) => (h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
const unq = (s) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

test("lead_kind: more published counties wins, ties go to dryland, pasture only as a last resort", () => {
  const r = JSON.parse(py(`print(json.dumps([
    b.lead_kind({'nonirr': 20, 'irr': 41, 'pasture': 38}),
    b.lead_kind({'nonirr': 25, 'irr': 14, 'pasture': 14}),
    b.lead_kind({'nonirr': 10, 'irr': 10, 'pasture': 0}),
    b.lead_kind({'nonirr': 0, 'irr': 5, 'pasture': 0}),
    b.lead_kind({'nonirr': 0, 'irr': 4, 'pasture': 5}),
    b.lead_kind({'nonirr': 2, 'irr': 2, 'pasture': 9}),
    b.lead_kind({'nonirr': 3, 'irr': 2, 'pasture': 9})]))`));
  assert.deepEqual(r, ["irr", "nonirr", "nonirr", "irr", "irr", "pasture", "nonirr"]);
});

test("every built state page leads with the rent the data says, and the counts back it", () => {
  const S = JSON.parse(py(`
S = b.load_states()
print(json.dumps({k: (lambda s: {'p': s['primary'], 'cv': s['coverage'], 'm': s['median'], 'n': s['n'],
  'o': {t: o['median'] for t, o in s['other'].items()}, 'yr': s['yr']})(b.state_stats(d)) for k, d in S.items()}))`));
  const names = JSON.parse(py(`print(json.dumps(b.STATE_NAMES))`));
  const label = { nonirr: "non-irrigated cropland", irr: "irrigated cropland", pasture: "permanent pasture" };
  const money = (v) => (v === Math.trunc(v) ? `$${v.toLocaleString("en-US")}` : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  assert.equal(Object.keys(S).length, 47);
  for (const [st, s] of Object.entries(S)) {
    const f = "rent/" + names[st].toLowerCase().replace(/ /g, "-") + ".html";
    const h = read(f);
    const d = unq(meta(h));
    if (s.p === "irr" && s.cv.nonirr >= 3) assert.ok(s.cv.irr > s.cv.nonirr, st);
    if (s.p === "nonirr") assert.ok(s.cv.nonirr >= s.cv.irr, st);
    // description: the lead figure with its label, first
    assert.ok(d.startsWith(`${names[st]} farmland cash rent ${s.yr}: median ${money(s.m)}/acre (${label[s.p]}) across ${s.n} counties`)
      || d.startsWith(`${names[st]} cash rent ${s.yr}: ${label[s.p]} ${money(s.m)}/acre`), `${st}: ${d}`);
    assert.ok(d.length <= 160, `${st} description ${d.length} chars`);
    // both cropland rents in the description whenever NASS has both
    const alt = s.p === "irr" ? "nonirr" : "irr";
    if (s.o[alt] !== undefined) {
      const w = alt === "irr" ? "irrigated" : "non-irrigated";
      assert.ok(d.includes(`; ${w} ${money(s.o[alt])}`), `${st}: other cropland rent missing from: ${d}`);
      // and on the first screen, right after the lead
      assert.ok(h.includes(`For ${label[alt]} the middle county paid ${money(s.o[alt])}`), `${st}: hero lacks ${alt}`);
    }
    // the first answer on the page is the lead
    const hero = h.slice(h.indexOf("<h1"), h.indexOf("<h2"));
    assert.ok(hero.includes(`paid <b style="color:`) && hero.includes(`${money(s.m)} an acre</b> for ${label[s.p]} in ${s.yr}`), `${st}: hero lead`);
    const faqA = h.match(/"text": "The middle [^"]*"|"text": "USDA NASS puts[^"]*"/);
    assert.ok(faqA && faqA[0].includes(label[s.p]), `${st}: FAQ average answer not on the lead rent`);
  }
});

test("the western states named in the GSC report: CA and OR lead with irrigated; WA stays dryland", () => {
  const ca = unq(meta(read("rent/california.html")));
  assert.equal(ca, "California farmland cash rent 2026: median $437/acre (irrigated cropland) across 41 counties; non-irrigated $34.75, pasture $17.50. Every county's USDA rate.");
  const or = unq(meta(read("rent/oregon.html")));
  assert.match(or, /^Oregon farmland cash rent 2026: median \$210\/acre \(irrigated cropland\) across 23 counties; non-irrigated \$99\.50/);
  // Washington: dryland published for 25 counties against 14 irrigated, so dryland leads
  assert.match(unq(meta(read("rent/washington.html"))), /^Washington farmland cash rent 2026: median \$70\.50\/acre \(non-irrigated cropland\)/);
  assert.match(read("rent/california.html"), /state stats above use irrigated cropland, published for more California counties \(41\) than non-irrigated \(20\)\./);
});

test("the hub still compares dryland with dryland, whatever a state page leads with", () => {
  const hub = read("rent/index.html");
  // California's hub row is its dryland median, not the irrigated figure its page leads with
  assert.match(hub, /<a href="\/rent\/california" >California<\/a><\/td><td data-v="34\.75">\$34\.75<\/td>/);
  assert.match(hub, /No dryland rent published for Arizona, Nevada, so the tile shows Arizona irrigated cropland; Nevada irrigated cropland/);
});

test("no em dashes in the rent pages", () => {
  for (const f of readdirSync(ROOT + "rent").filter((x) => x.endsWith(".html"))) {
    const h = read("rent/" + f);
    const body = h.slice(h.indexOf("<body"));
    assert.ok(!body.includes("—"), f);
    assert.ok(!meta(h).includes("—"), f);
  }
});
