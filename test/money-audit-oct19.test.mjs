/* Money audit fixes, Oct 19, 2026 (audit + adversary, night run). Each case is
 * the real page the audit read.
 *
 *   2. /arc-plc said sequestration "comes off before the limit"; no source in
 *      hand states the order (FR 2026-00313 and 7 CFR 1412 do not).
 *   3. 2026 wheat's price spread is borrowed from corn (its own changes
 *      stretched to corn's October SD) and most of its expected payment rides
 *      on it: Sumner Co., KS non-irrigated wheat printed $6.76 PLC vs $6.64
 *      ARC-CO ($1.56 PLC with no spread). The dollars are withheld with the
 *      reason; the call stays. "Mostly harvested, so a normal crop" is gone.
 *   4. The 2026 payment limit: $164,000 by the rule's own method, not "not out",
 *      and never called official.
 *   5. Nebraska's comparison "Combine corn" is the dryland line ($49.29, 42
 *      answers), not irrigated ($50.70); Missouri's G302 reads as its rate year
 *      (2022 rates for the April 2023 guide; 2025 rates since the March 2026
 *      guide replaced it, Oct 19: corn combining without grain cart, $47.56,
 *      9 answers, G302 Table 5).
 *   6. Iowa rent: -1.5% is the change in the state median ($270 to $266).
 *
 *   node --test test/money-audit-oct19.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
// the reading path: the page without its closed Sources and terms fold (which may say, in one plain line, that some
// crops use another crop's price swings); the cards, the FAQ and the JSON-LD stay in
const reading = (h) => { const a = h.indexOf('<details class="ap-det" id="terms">'); return a < 0 ? h : h.slice(0, a) + h.slice(h.indexOf("</details>", a) + 10); };
const CURTAIN = /borrow|corn(’|&rsquo;|')s (price swings|October)/i;
const WHY = "Expected payments are not printed for this crop: it does not have enough of its own price history.";
const CAP = "Too little price history for a clear pick: shown as Leans.";
const text = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ")
  .replace(/&rsquo;/g, "’").replace(/&middot;/g, "\u00b7").replace(/&times;/g, "\u00d7").replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("2: no claim about the order of sequestration and the payment limit", () => {
  const h = read("arc-plc.html");
  assert.doesNotMatch(h, /comes off before the limit/);
  assert.match(h, /Sequestration \(5\.7% on recent payments\) also comes off; ask your FSA office how it meets the limit for your farm\./);
});

test("3: Sumner Co., KS 2026 wheat keeps its call and prints no expected dollars, with the reason", () => {
  const h = read("arc-plc/kansas/sumner-county.html"), t = text(h);
  // Nov 10, 2026: it says what is withheld (the expected payments: the example-price line below prints dollars) and a
  // plain reason with no method, and a Close card says nothing about Leans
  assert.match(t, new RegExp("Wheat · non-irrigated Either one Close Too close to call\\. " + WHY.replace(/\./g, "\\.") + " PLC only pays"));
  assert.doesNotMatch(t, /no dollar figure|stops at Leans/, "the old words are gone");
  assert.doesNotMatch(h, /\$6\.76|\$6\.64/, "the borrowed-spread dollars are gone from the page, FAQ and JSON-LD");
  assert.doesNotMatch(reading(h), CURTAIN, "the curtain: no word of where the swings come from, in the cards, FAQ or JSON-LD");
  assert.match(t, /At \$5\.80, one example price, not a forecast \(50 cents under USDA’s \$6\.30 for 2026\): PLC \$[\d.]+, ARC-CO \$[\d.]+ per base acre/, "the fixed-price line stays, labelled");
  assert.match(t, /Close, either one: too small or too uncertain to call \(PLC paid more in 3 of 11 past-year scenarios, ARC-CO in 3; expected payments not printed, not enough price history of its own\)/);
  // what does not rest on the spread stays: the PLC price line and the trigger yield
  assert.match(t, /PLC only pays if wheat averages under \$6\.35 a bushel for 2026\./);
  assert.match(t, /ARC-CO pays here for 2026 if the county yield comes in under 43 bu at USDA’s price outlook, \$6\.30\./);
  // a crop on its own spread still prints dollars (Sumner corn, October futures of its own)
  // Nov 10, 2026: even tiers (Leans from $2): the $2 corn gap that read Close now reads Leans ARC-CO
  assert.match(t, /Corn · non-irrigated ARC-CO Leans ARC-CO comes out about \$2 more per base acre, but that swings from year to year\./);
  // and the page source carries no cents for the withheld card (data-t and the Lower / Higher packs)
  const tag = /<article class="ap-crop" id="crop-wheat"([^>]*)>[\s\S]*?data-t="([^"]+)"/.exec(h);
  assert.ok(tag, "wheat card");
  assert.match(tag[2], /^2026:close:-:-\|/);
  for (const lv of ["lower", "higher"]) assert.match(tag[1], new RegExp(`data-${lv}="[\\d.]+;2026:[a-z_]+:-:-\\|`), lv);
});

test("3: every borrowed 2026 spread is withheld: Cass Co., ND barley (too few years of its own prices)", () => {
  /* Before (Oct 19 build): "ARC-CO comes out about $11 more per base acre, but that swings from year to year. ...
     Barley borrows corn's price swings, so it stops at Leans." Barley has too few years in FSA's tables, so it ran on corn's
     October swings outright (scen kind corn_oct). */
  const h = read("arc-plc/north-dakota/cass-county.html"), t = text(h);
  // the reason for a crop with too few years of its own prices; "held at Leans" only when the pack says the cap lowered a pick (32)
  const capped = (JSON.parse(read("data/arc-plc/math/ND.json")).c["38017"].v.barley[0]["2026"][8] & 32) === 32;
  const esc = (x) => x.replace(/\./g, "\\.");
  assert.match(t, new RegExp("Barley ARC-CO Leans ARC-CO leads across the 11 price years we ran, but that swings from year to year\\. PLC did not come out ahead in any of them\\. " +
    esc(WHY) + (capped ? " " + esc(CAP) : "") + " PLC only pays"));
  assert.doesNotMatch(reading(h), CURTAIN, "the curtain on the Cass page");
  assert.doesNotMatch(t, /about \$11 more per base acre/);
  const card = /<article class="ap-crop" id="crop-barley"([^>]*)>[\s\S]*?data-t="([^"]+)" data-lv="same" data-p="([^"]+)"/.exec(h);
  assert.ok(card, "barley card");
  assert.equal(card[2], "2026:lean_arc:-:-|2027:noprice:0:0");
  assert.match(card[3], /^lean_arc,0,/, "no whole-dollar gap in the pack");
  assert.doesNotMatch(card[1], /2026:[a-z_]+:\d/, "Lower and Higher carry no cents");
  // the math file: null where the cents were (verdict, PLC, ARC-CO, wins, wins, n, |gap|, years ARC paid, flags, whole)
  const ND = JSON.parse(read("data/arc-plc/math/ND.json"));
  const rec = ND.c["38017"];   // Cass County, ND
  const pk = rec ? rec.v.barley[0]["2026"] : null;
  assert.ok(pk, "Cass barley pack");
  assert.deepEqual([pk[0], pk[1], pk[2], pk[6], pk[9], pk[8] & 8, pk[8] & 16], ["lean_arc", null, null, null, null, 8, 16]);
  const D = JSON.parse(read("data/arc-plc.json"));
  const marked = Object.entries(D.years["2026"].crops).filter(([, c]) => c.scen && c.scen.nousd).map(([k]) => k);
  assert.ok(marked.includes("barley") && marked.includes("seed_cotton") && marked.includes("oats") && marked.includes("mustard") && marked.includes("wheat"), marked.join(" "));
  for (const [k, c] of Object.entries(D.years["2026"].crops)) if (c.scen && c.scen.borrowed) assert.ok(c.scen.nousd, `${k}: borrowed but not withheld`);
  for (const k of ["corn", "soybeans"]) assert.ok(!D.years["2026"].crops[k].scen.nousd, k);
});

test("3: the browser's words drop the dollars on the mark", () => {
  const ctx = { window: {} };
  for (const f of ["components/arc-plc.js", "components/arc-plc-math.js"]) vm.runInNewContext(read(f), ctx);
  const M = ctx.window.AgArcMath;
  // [verdict, PLC cents, ARC cents, PLC wins, ARC wins, n, |gap| cents, years ARC paid, flags (1 borrowed, 4 under $1, 8 nousd), whole]
  const v = M.unpack(["close", 676, 664, 3, 3, 11, 12, 6, 1 | 4 | 8, 0]);
  const line = M.verdictLine(v, { min_scen: 8 });
  assert.equal(line, "Close, either one: too small or too uncertain to call (PLC paid more in 3 of 11 past-year scenarios, ARC-CO in 3; expected payments not printed, not enough price history of its own).");
  assert.doesNotMatch(line, /Leans/, "no Leans on a Close line");
  assert.match(M.verdictLine(M.unpack(["lean_arc", null, null, 0, 8, 11, null, 8, 1 | 8 | 16 | 32, null]), { min_scen: 8 }), /Too little price history for a clear pick: shown as Leans\.$/, "capped (32): shown as Leans");
  assert.doesNotMatch(M.verdictLine(M.unpack(["lean_arc", null, null, 0, 8, 11, null, 8, 1 | 8 | 16, null]), { min_scen: 8 }), /shown as Leans/, "not capped: nothing about the cap");
  assert.match(M.verdictLine(M.unpack(["close", 676, 664, 3, 3, 11, 12, 6, 1 | 4, 0]), { min_scen: 8 }), /expected \$6\.76 PLC vs \$6\.64 ARC-CO/, "without the mark the dollars print");
  // the packs as the build now writes them: null cents
  assert.doesNotMatch(M.verdictLine(M.unpack(["lean_arc", null, null, 0, 8, 11, null, 8, 1 | 8 | 16, null]), { min_scen: 8 }), /\$|null|NaN/);
});

test("3: the curtain on the whole reading path: pages, FAQ, JSON-LD, the calculator and Show the math, the math files", () => {
  // pages: the main page, a crop hub and county pages, without the closed fold
  for (const f of ["arc-plc.html", "arc-plc/oats.html", "arc-plc/iowa/story-county.html", "arc-plc/kansas/sumner-county.html", "arc-plc/north-dakota/cass-county.html", "embed/arc-plc.html"]) {
    if (!existsSync(ROOT + f)) continue;
    const r = reading(read(f));
    assert.doesNotMatch(r, CURTAIN, `${f}: ` + (CURTAIN.exec(r) || [])[0]);
  }
  // the calculator, the card script and Show the math: every string the browser can print (comments and names aside)
  for (const f of ["components/arc-plc.js", "components/arc-plc-math.js", "components/arc-plc-simple.js", "components/arc-plc-form.js"]) {
    if (!existsSync(ROOT + f)) continue;
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"\\])\/\/.*$/gm, "$1");
    const strs = src.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) || [];
    for (const q of strs) assert.doesNotMatch(q, CURTAIN, `${f}: ${q}`);
  }
  // the math files the cards and Show the math read
  let n = 0;
  for (const f of readdirSync(ROOT + "data/arc-plc/math").filter((x) => /^[A-Z]{2}\.json$/.test(x))) {
    assert.doesNotMatch(read("data/arc-plc/math/" + f), CURTAIN, f);
    n++;
  }
  assert.ok(n >= 40, `${n} math files`);
  // what the browser writes for a withheld crop
  const ctx = { window: {} };
  for (const f of ["components/arc-plc.js", "components/arc-plc-math.js"]) vm.runInNewContext(read(f), ctx);
  const M = ctx.window.AgArcMath;
  const l = M.verdictLine(M.unpack(["lean_arc", null, null, 0, 8, 11, null, 8, 1 | 8 | 16 | 32, null]), { min_scen: 8 });
  assert.ok(l.endsWith(CAP) && !CURTAIN.test(l), l);
});

test("3: the 2026 yield line says county yields come later, not that a harvested crop is normal", () => {
  for (const f of ["arc-plc.html", "components/arc-plc.js", "components/arc-plc-math.js", "scripts/build_arc_plc.py"]) assert.doesNotMatch(read(f), /mostly harvested/, f);
  assert.match(read("arc-plc.html"), /USDA puts out county yields months after harvest, so until then every scenario year assumes a normal crop/);
});

test("4: the 2026 payment limit is the rule's own figure, not official and not 'not out'", () => {
  const h = read("arc-plc.html");
  assert.doesNotMatch(h, /2026 and 2027 figures are not out/);
  assert.match(h, /For 2026 it is \$164,000 by the rule(&#x27;|'|&rsquo;)s own method; FSA posts the official figure\./);
  assert.doesNotMatch(h, /official 2026 (payment )?limit of \$164,000/);
});

test("5: Nebraska compares on dryland corn; Missouri reads as its rate year (2025 rates)", () => {
  const ne = JSON.parse(read("data/custom-rates/ne.json"));
  const c = ne.rows.filter((r) => r.k === "combine-corn");
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].o, c[0].a, c[0].n], ["Combining dryland corn, flat rate", 49.29, 42]);
  assert.ok(ne.rows.some((r) => r.o === "Combining irrigated corn, flat rate" && r.a === 50.7 && !r.k), "the irrigated line stays in the table");
  const h = read("custom-rates.html");
  assert.match(h, /<a href="\/custom-rates\/missouri">Missouri<\/a> <small>2025 rates<\/small>/);
  assert.match(h, /Missouri \$47\.56 \(2025 rates, 2026 survey, 9 answers\)/);
  assert.doesNotMatch(h, /2022 rates|\$43\.29/, "the April 2023 guide's numbers are gone");
  assert.match(h, /Nebraska \$49\.29 \(2026 survey, 42 answers\)/);
  assert.doesNotMatch(h, /Nebraska \$50\.70/);
});

test("6: Iowa's -1.5% is said to be the state median's change", () => {
  const h = read("rent/iowa.html");
  assert.doesNotMatch(h, /vs 2025 \(matched counties\)/);
  assert.match(h, /state median -1\.5% vs 2025 \(same counties\), not a typical county&rsquo;s change/);
  assert.match(h, /Across the same 99 counties the state median went from \$270 to \$266, <b[^>]*>-1\.5&#37; vs 2025<\/b>: the change in the median, not in a typical county\./);
});
