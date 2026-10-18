// October 2026 FAQ additions on 21 tool pages. Each answer was checked against
// its source on the references branch before it went on. This holds the count
// per page, the FAQPage JSON-LD equal to the visible questions, the new
// questions present in both, and no em dashes in what was added.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  ndash: "–", mdash: "—", nbsp: " ", times: "×", deg: "°", divide: "÷", sup3: "³", minus: "−", middot: "·", rarr: "→" };
const decode = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&([a-z0-9]+);/gi, (m, n) => ENT[n] ?? m);
const norm = (s) => s.replace(/\s+/g, " ").trim();

function visibleText(src) {
  let s = src.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style)\b[\s\S]*?<\/\1>/g, " ").replace(/<br\s*\/?>/g, " ");
  s = s.replace(/<\/?(p|div|li|ul|ol|h[1-6]|tr|td|th|summary|details|dt|dd|section|article|table|button)\b[^>]*>/g, " ");
  return norm(decode(s.replace(/<[^>]+>/g, "")));
}

function faqPage(src) {
  for (const m of src.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let d;
    try { d = JSON.parse(m[1]); } catch { continue; }
    const nodes = [d, ...(Array.isArray(d["@graph"]) ? d["@graph"] : [])];
    const f = nodes.find((n) => n && n["@type"] === "FAQPage");
    if (f) return f.mainEntity.map((q) => [norm(q.name), norm(q.acceptedAnswer.text)]);
  }
  return null;
}

// page -> [expected FAQ count, the questions added in October 2026]
const PAGES = {
  "farm-bill": [11, ["Does the Senate farm bill change the late planting penalty on crop insurance?", "Is there grant money for small farms in the Senate farm bill?"]],
  "grain-bin-calculator": [8, ["How does USDA measure the grain in my bin, and how close is it?", "How much does a cubic foot of corn weigh in a bin?"]],
  "arc-plc": [14, ["If I pick ARC-CO, do I have to turn in my yields to FSA?", "Do I have to carry crop insurance to get ARC or PLC?", "Is there a deadline for the payment eligibility paperwork after I sign up?"]],
  "cash-lease": [8, ["Can I mail the notice to end an Iowa farm lease, and when does it have to go out?", "In Kansas, what happens to the wheat if I give notice after my tenant already planted it?", "How much notice does Wisconsin want to end a year-to-year farm lease?"]],
  "cattle-auction-prices": [9, ["What's the difference between a large frame and a medium frame calf?", "What makes a calf grade a 3 instead of a 1?", "Will my beef on dairy calves grade a 1?"]],
  "combine-loss": [9, ["Can I just go by the loss monitor in the cab?", "How do I cut shatter loss in soybeans?", "What gap should I run on the deck plates of the corn head?"]],
  "drought-monitor": [9, ["How many weeks does my county have to be in D2 before LFP kicks in?", "What's the most LFP will pay me in a year?", "Does grazing corn stalks count for LFP if we're in drought?"]],
  "fast-facts": [6, ["When is it worth spraying Japanese beetles on corn silks?", "When do I start and stop scouting beans for aphids?"]],
  "grain-emc": [13, ["How long will 15% corn keep in the bin?", "Should I keep running the drying fan on corn all winter?", "Will running fans below freezing freeze my corn?"]],
  "harvest-or-wait": [9, ["Can I just leave my corn standing over winter?", "My corn froze before it was mature. Does it still dry down like the table says?", "How far can I trust my moisture tester on wet corn this time of year?"]],
  "lrp": [12, ["Can I buy LRP on calves that are not born yet?", "Does LRP cover dairy cull cows?", "Can I use LRP if I am selling on a forward contract?"]],
  "planting-date": [8, ["Does planting corn too early mess up my crop insurance?", "Should I switch to an earlier corn hybrid if I'm planting late?", "If my soybeans go in mid-May, do I change maturity group or seeding rate?"]],
  "spray": [16, ["Where can I see live inversion readings for my state?", "Why is EPA so strict about dicamba drift?", "Which crops can I spray dicamba over the top of?"]],
  "usda-calendar": [7, ["What happens if I miss the Dec. 11 ARC/PLC deadline for 2026?"]],
  "breakeven": [8, ["How much profit per acre is corn expected to make in 2027?", "How much does a small move in corn price change my return per acre?"]],
  "commodity-loan": [8, ["Will the loan rate stay the same next year or change?", "Can I get a loan on wheat or oats too, or just corn and beans?"]],
  "custom-rates": [8, ["What does custom grain hauling cost per bushel?", "Do custom combiners charge extra for a big corn crop?"]],
  "gdu-calculator": [8, ["Does a 115-day hybrid actually take 115 days?", "Does day length affect corn the way it does soybeans?"]],
  "grain-shrink": [9, ["Can I trust my moisture meter on corn coming hot out of the dryer?", "When should I start combining beans so I don't deliver them too dry?"]],
  "store-or-sell": [6, ["Should I sell more corn and beans at harvest this year instead of storing it all?", "Is the interest on my operating loan likely to go up?"]],
  "tariffs": [7, ["Did my yields count toward the Farmer Bridge Assistance payment?", "What are those daily flash sales USDA puts out?"]],
};

for (const [page, [count, added]] of Object.entries(PAGES)) {
  test(`${page}: ${count} FAQs, JSON-LD word for word on the page, new questions in both, no em dashes`, () => {
    const src = read(`${page}.html`);
    const ld = faqPage(src);
    assert.ok(ld, "has a FAQPage");
    assert.equal(ld.length, count, "FAQ count");
    const vt = visibleText(src);
    for (const [q, a] of ld) {
      assert.ok(vt.includes(q), `visible question: ${q}`);
      assert.ok(vt.includes(a), `visible answer for: ${q}`);
    }
    const names = ld.map(([q]) => q);
    assert.equal(new Set(names).size, names.length, "no repeated question");
    for (const q of added) {
      const hit = ld.find(([n]) => n === q);
      assert.ok(hit, `added question in JSON-LD: ${q}`);
      assert.doesNotMatch(hit[0] + hit[1], /—|&mdash;/, `em dash in ${q}`);
      assert.ok(hit[1].length >= 80, `answer is a real answer: ${q}`);
    }
  });
}

test("hand-checked numbers read the way the sources print them", () => {
  const ans = (page, q) => faqPage(read(`${page}.html`)).find(([n]) => n === q)[1];
  // 56 lb a bushel over the page's 1.244 cubic feet a bushel
  assert.equal(Math.round(56 / 1.244), 45);
  assert.match(ans("grain-bin-calculator", "How much does a cubic foot of corn weigh in a bin?"), /About 45 lb/);
  // 237 bu default yield times a 50 cent move
  assert.equal((237 * 0.5).toFixed(2), "118.50");
  assert.match(ans("breakeven", "How much does a small move in corn price change my return per acre?"), /\$118\.50 an acre/);
  // 7 U.S.C. 9032(c): corn $2.42, soybeans $6.82, wheat $3.72, oats $2.20
  assert.match(ans("commodity-loan", "Will the loan rate stay the same next year or change?"), /\$2\.42 a bushel for corn and \$6\.82 for soybeans/);
  assert.match(ans("commodity-loan", "Can I get a loan on wheat or oats too, or just corn and beans?"), /\$3\.72 a bushel for wheat and \$2\.20 for oats/);
  // Kansas 2026 flat rate matches the page's own Kansas combining row
  assert.match(visibleText(read("custom-rates.html")), /Kansas 2026 \$41\.87\/ac/);
  assert.match(ans("custom-rates", "Do custom combiners charge extra for a big corn crop?"), /\$41\.87 an acre/);
});
