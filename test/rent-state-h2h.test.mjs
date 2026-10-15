/* /rent/<state>, the 2026-10-15 head-to-head fixes:
 *  - "Rent for your ground": the county's rent per bushel of its own trend
 *    yield (scripts/build_state_rent_pages.py computes it), times the reader's
 *    yield; plus share of gross and return on land value on typed numbers
 *  - the "average rent" FAQ says the figure is the middle county
 *  - the hero says these are the newest NASS rents and when the next come
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const IA = readFileSync(ROOT + "rent/iowa.html", "utf8");
const IAJ = JSON.parse(readFileSync(ROOT + "data/cash-rent/IA.json", "utf8"));

function panelData(html) {
  const m = html.match(/<script type="application\/json" id="gr-data">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]) : null;
}
function panelScript(html) {
  const i = html.indexOf("getElementById('gr-data')");
  assert.ok(i > 0, "panel script missing");
  const a = html.lastIndexOf("<script>", i), b = html.indexOf("</script>", i);
  return html.slice(a + 8, b);
}

// a DOM just big enough for the panel script
function runPanel(html) {
  const els = {}, handlers = {};
  const mk = (id) => (els[id] = els[id] || {
    id, value: "", textContent: "", innerHTML: "", options: [], href: null,
    appendChild(o) { this.options.push(o); if (o.selected || this.options.length === 1) this.value = String(o.value); },
    addEventListener(ev, fn) { (handlers[id] = handlers[id] || {})[ev] = fn; },
    removeAttribute(k) { if (k === "href") this.href = null; },
    closest() { return null; },
  });
  const data = html.match(/<script type="application\/json" id="gr-data">([\s\S]*?)<\/script>/)[1];
  mk("gr-data").textContent = data;
  for (const id of ["gr-co", "gr-y", "gr-out", "gr-math", "gr-p", "gr-s", "gr-sg", "gr-v", "gr-r", "gr-lv", "gr-atlas"]) mk(id);
  els["gr-p"].value = (html.match(/id="gr-p"[^>]*value="([^"]*)"/) || [])[1] || "";
  const document = {
    getElementById: (id) => els[id] || null,
    createElement: () => ({ value: "", textContent: "", selected: false }),
    activeElement: null,
  };
  vm.runInNewContext(panelScript(html), { document, gaEvent() {}, JSON, Math, String, parseFloat, isFinite, NaN });
  const set = (id, v, ev = "input") => { els[id].value = String(v); handlers[id][ev](); };
  return { els, set };
}

test("Iowa: rent per bushel per county is the NASS rent over the table's own trend yield", () => {
  const D = panelData(IA);
  assert.ok(D, "Iowa page has no 'rent for your ground' data");
  const story = D.c.find((c) => c[0] === "Story");
  const rent = IAJ.counties.find((c) => c.name === "Story").rent.nonirr["2026"];
  assert.equal(story[1], rent);
  assert.equal(story[1], 290);
  assert.equal(story[2], 217.2);                      // the Corn trend column says 217 bu
  assert.match(IA, /data-v="217.2">217 bu<\/td>/);
  assert.equal(story[3], Math.round((100 * 290) / 217.2) / 100);  // 1.34
  assert.equal(story[4], "iowa/story-county");
  // every county in the panel has a current dryland rent; none is invented
  for (const c of D.c) {
    const src = IAJ.counties.find((x) => x.name === c[0]);
    assert.equal(src.rent.nonirr["2026"], c[1], c[0]);
  }
});

test("Iowa: the panel's arithmetic, worked by hand", () => {
  const { els, set } = runPanel(IA);
  const i = JSON.parse(els["gr-data"].textContent).c.findIndex((c) => c[0] === "Story");
  set("gr-co", i, "change");
  assert.equal(String(els["gr-y"].value), "217");             // starts at the county's own trend
  set("gr-y", 220);
  // 290 x 220 / 217.2 = 293.74
  assert.match(els["gr-out"].innerHTML, /At <b>220 bu<\/b> ground in Story County, the county&rsquo;s rent per bushel says about <b>\$294 an acre<\/b>/);
  assert.equal(els["gr-math"].textContent, "Story County: $290 rent ÷ 217.2 bu trend = $1.34 a bushel. $290 × 220 ÷ 217.2 = $294.");
  // share of gross starts at the county's own: 290 / (217.2 x 4.10) = 32.6%
  assert.equal(els["gr-p"].value, "4.10");
  assert.equal(String(els["gr-s"].value), "32.6");
  assert.equal(els["gr-sg"].textContent, "220 bu × $4.10 = $902 gross. 32.6% of that is $294 an acre.");
  set("gr-s", 30);                                     // a typed share sticks when the yield changes
  set("gr-y", 200);
  assert.equal(els["gr-sg"].textContent, "200 bu × $4.10 = $820 gross. 30% of that is $246 an acre.");
  // return on land value only from typed numbers
  assert.equal(els["gr-lv"].textContent, "Type your land value and the return you want on it.");
  set("gr-v", 12000); set("gr-r", 2.5);
  assert.equal(els["gr-lv"].textContent, "$12,000 × 2.5% = $300 an acre.");
  // no yield, no number
  set("gr-y", "");
  assert.equal(els["gr-out"].textContent, "Type a yield between 1 and 400 bushels.");
  assert.equal(els["gr-math"].textContent, "");
  assert.equal(els["gr-atlas"].href, "/farmland-atlas/iowa/story-county");
});

test("the panel is labeled derived, and absent where no county has a same-practice trend", () => {
  assert.match(IA, /Derived by AGSIST, not a NASS number/);
  assert.match(IA, /83 of 99 Iowa\s+counties have both numbers/);
  // Nebraska's dryland yield series stopped in 2018: no trend, so no panel
  const ne = readFileSync(ROOT + "rent/nebraska.html", "utf8");
  assert.equal(panelData(ne), null);
  assert.ok(!ne.includes("Rent for your ground"));
});

test("the 'average rent' answer says it is the middle county, not NASS's state average", () => {
  const q = "What is the average cash rent per acre in Iowa for 2026?";
  const ld = JSON.parse(IA.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const faq = ld["@graph"].find((g) => g["@type"] === "FAQPage").mainEntity.find((x) => x.name === q);
  assert.ok(faq.acceptedAnswer.text.startsWith(
    "The middle Iowa county pays $266 per acre for non-irrigated cropland: half of the 99 counties with a published 2026 USDA NASS rate are above it and half below. NASS also puts out its own statewide average, a separate figure that is not shown here."));
  assert.ok(!faq.acceptedAnswer.text.startsWith("The median USDA NASS county cash rent"));
});

test("the hero says these are the newest NASS rents and when the next come", () => {
  // release day from the NASS release calendar: County Estimates Cash Rents, Friday, August 21, 2026
  assert.match(IA, /These are the 2026 county rents, the newest NASS has put out \(released Aug 21, 2026\)\. The 2027 rents usually come out in August 2027\./);
});

test("every rent page stays under the 150 KB cap for a generated set", () => {
  for (const f of readdirSync(ROOT + "rent")) {
    if (!f.endsWith(".html")) continue;
    assert.ok(statSync(ROOT + "rent/" + f).size <= 150 * 1024, f);
  }
});
