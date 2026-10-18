/* The ARC or PLC county cards: one answer per card in the HTML, Lower and Higher
 * written in the browser (components/arc-plc-simple.js, AgArcCard.level), the
 * ARC-CO trigger line, and what the main and county pages put first.
 *
 * Until 2026-10-15 each card carried all three PLC-yield answers in the page.
 * test/fixtures/arc-plc-levels.json.gz holds every distinct answer block those
 * pages carried (Lower, About the same and Higher, cut from the committed pages
 * before the change), each beside the card data the new build writes for it:
 * [card, pack, About-the-same verdict, old HTML, county]. The first test renders
 * the shipped JS on that data and requires the old HTML exactly. The rest read
 * the live tree.
 *
 *   node --test test/arc-plc-cards.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { window: {} };
vm.runInNewContext(readFileSync(ROOT + "components/arc-plc-simple.js", "utf8"), ctx);
const C = ctx.window.AgArcCard;
const FX = JSON.parse(zlib.gunzipSync(readFileSync(ROOT + "test/fixtures/arc-plc-levels.json.gz")));
const D = JSON.parse(readFileSync(ROOT + "data/arc-plc.json", "utf8"));
const unesc = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const STATES = {};
const stateFile = (st) => STATES[st] || (STATES[st] = JSON.parse(readFileSync(ROOT + `data/arc-plc/${st}.json`, "utf8")));

function countyPages() {
  const out = [];
  for (const sd of readdirSync(ROOT + "arc-plc", { withFileTypes: true }).filter((x) => x.isDirectory())) {
    for (const f of readdirSync(ROOT + "arc-plc/" + sd.name)) if (f.endsWith(".html") && !f.endsWith("-sheet.html")) out.push(`${sd.name}/${f}`);
  }
  return out;
}
const CARD = /<article class="ap-crop" id="crop-([a-z_]+)"([^>]*)><h3>[^<]*<\/h3><div class="ap-lv" data-k="[a-z_]+" data-e="([^"]+)" data-py="[\d.]+" data-t="([^"]+)" data-lv="same" data-p="([^"]*)">(.*?)<\/div>(<p class="ap-trig">.*?<\/p><p class="ap-small ap-trig-m">.*?<\/p>)?<\/article>/g;
const attrs = (a) => Object.fromEntries([...a.matchAll(/data-([a-z]+)="([^"]*)"/g)].map((m) => [m[1], unesc(m[2])]));

test("Lower, About the same and Higher: the browser writes the words the old pages carried, every distinct case", () => {
  assert.ok(FX.length >= 1500, `${FX.length} cases`);
  const kinds = new Set(FX.map((x) => x[1].split(",")[0]));
  for (const k of ["lean_arc", "lean_plc", "close", "none", "mismatch"]) assert.ok(kinds.has(k), `fixture has ${k}`);
  const kinds7 = new Set(FX.map((x) => x[1].split(",")[4]));
  for (const k of ["noprice", "pending", "lean_arc", "close"]) assert.ok(kinds7.has(k), `fixture has ${k} for the other year`);
  const bits = FX.reduce((a, x) => a | +x[1].split(",")[2], 0);
  assert.equal(bits & 61, 61, "every flag bit appears but 2 (a futures start that disagrees, none today: the hand case below)");
  assert.ok(FX.some((x) => x[1].startsWith("mismatch") && x[2] !== "mismatch"), "a Higher that crosses the benchmark");
  assert.ok(FX.some((x) => x[0].irr), "an irrigated card");
  assert.ok(FX.some((x) => x[0].oth === "Irrigated") && FX.some((x) => x[0].oth === "Non-irrigated"), "other-practice lines");
  assert.ok(FX.some((x) => /cents a pound/.test(x[0].pu)), "a pound crop");
  for (const [card, pack, sameW, html, where] of FX) assert.equal(C.level(card, pack, sameW), html, `${where} ${pack}`);
});

test("a clear pick, a futures-start Leans and a withheld answer (none on the live pages today): the build's words, from build_arc_plc.py gap_line, big_word, year_line", () => {
  const card = { lc: "corn", cen: "$4.70", pu: "$4.42 a bushel", oth: "", irr: false, ly: "2026", oy: "2027" };
  assert.equal(C.level(card, "arc,12,0,11,plc,", "arc"),
    '<div class="ap-ans"><span class="ap-big">ARC-CO</span><span class="ap-tier ap-tier-pick"><svg class="ap-ic" viewBox="0 0 16 16" aria-hidden="true"><use href="#api-pick"/></svg>Clear pick</span></div><p>ARC-CO comes out about $12 more per base acre.</p><p>PLC only pays if corn averages under $4.42 a bushel for 2026.</p><p class="ap-y2"><b>2027:</b> PLC</p>');
  assert.ok(C.level(card, "lean_plc,6,18,11,close,", "lean_plc").includes("<p>PLC comes out about $6 more per base acre, but that swings from year to year. A futures-based price start gives a different answer, so it stops at Leans.</p>"));
  assert.equal(C.level(card, "withheld,0,0,0,lean_plc,", "withheld"),
    '<div class="ap-ans"><span class="ap-big">No answer yet</span><span class="ap-tier ap-tier-ask"><svg class="ap-ic" viewBox="0 0 16 16" aria-hidden="true"><use href="#api-ask"/></svg>No answer yet</span></div><p>Not enough years of price and county yield history to call it.</p><p>PLC only pays if corn averages under $4.42 a bushel for 2026.</p><p class="ap-y2"><b>2027:</b> leans PLC</p>');
});

test("every county page carries one answer per card, and the browser's words for it equal the build's", () => {
  let pages = 0, cards = 0;
  for (const p of countyPages()) {
    const html = readFileSync(ROOT + "arc-plc/" + p, "utf8");
    const seg = /class="ap-seg"[^>]*data-ly="(\d{4})" data-oy="(\d{4})"/.exec(html);
    const n = (html.match(/<div class="ap-lv"/g) || []).length;
    let here = 0;
    for (const m of html.matchAll(CARD)) {
      const [, k, a, e, t, pack, body] = m;
      const A = attrs(a);
      const card = { lc: A.lc, cen: A.cen || "", pu: A.pu, oth: A.oth || "", irr: e.split(":")[0] === "irr", ly: seg[1], oy: seg[2] };
      assert.equal(C.level(card, pack, pack.split(",")[0]), body, `${p} ${k}: browser and build words`);
      const [ly, oy] = t.split("|").map((x) => x.split(":")[1]);
      const P = C.unpack(pack);
      assert.equal(P.w, ly, `${p} ${k}: pack and data-t agree (${seg[1]})`);
      assert.equal(P.w7, oy, `${p} ${k}: pack and data-t agree (${seg[2]})`);
      for (const lv of ["lower", "higher"]) {
        const [, t2, pk] = A[lv].split(";");
        assert.equal(C.unpack(pk).w, t2.split("|")[0].split(":")[1], `${p} ${k} ${lv}: pack and data-t agree`);
        assert.ok(C.level(card, pk, P.w).includes('class="ap-big"'), `${p} ${k} ${lv}: renders`);
      }
      here++;
    }
    assert.equal(here, n, `${p}: every answer is one card's About the same (${here} cards, ${n} answers)`);
    if (n) assert.ok(seg, `${p}: the buttons carry the years`);
    assert.ok(!/data-lv="(lower|higher)" hidden/.test(html), `${p}: no hidden copies`);
    pages++; cards += here;
  }
  assert.ok(pages >= 2700, `${pages} pages`);
  assert.ok(cards >= 15000, `${cards} cards`);
});

test("trigger line, by hand: Story County, IA corn pays under 215 bu at $4.70", () => {
  const html = readFileSync(ROOT + "arc-plc/iowa/story-county.html", "utf8");
  const corn = [...html.matchAll(CARD)].find((m) => m[1] === "corn");
  // 223.82 bu x 90% = 201.438; x $5.03 = 1,013.23 guarantee per acre; / $4.70 = 215.58 bu. At 215 bu: 215 x 4.70 = 1,010.50, under
  // the guarantee, pays $2.73 an acre; at 216 bu: 1,015.20, over it, pays nothing. Floored, so "under 215" is always true.
  assert.equal(D.years["2026"].crops.corn.bp.value, 5.03);
  assert.equal(D.years["2026"].crops.corn.scen.center, 4.7);
  assert.ok(corn[7].includes("comes in under <b>215 bu</b> at USDA&rsquo;s price outlook, $4.70."), corn[7]);
  assert.ok(corn[7].includes("90% of the 223.82 bu benchmark &times; the $5.03 benchmark price, divided by $4.70."), corn[7]);
});

test("trigger line on every card with a price outlook: floor(90% x benchmark x benchmark price / price), from the state file", () => {
  let n = 0;
  const NAV = JSON.parse(readFileSync(ROOT + "data/arc-plc/nav.json", "utf8"));
  const bySlug = Object.fromEntries(Object.entries(NAV.s).map(([k, v]) => [v.slug, k]));
  for (const p of countyPages()) {
    const html = readFileSync(ROOT + "arc-plc/" + p, "utf8");
    const [sd, f] = p.split("/");
    const st = bySlug[sd];
    const fips = /data-arcplc [^>]*data-fips="(\d{5})"/.exec(html)[1];
    const cty = stateFile(st).c.find((c) => c.f === fips);
    const LY = (/data-ly="(\d{4})"/.exec(html) || [])[1];
    for (const m of html.matchAll(CARD)) {
      const [, k, , e, , , , trig] = m;
      const cd = D.years[LY].crops[k] || D.years["2026"].crops[k];
      const cen = (cd.scen || {}).center;
      const ent = cty.k[k].find((x) => x.d === e.split(":")[0] && (x.sub || "") === unesc(e.split(":")[1] || ""));
      if (!cen) { assert.ok(!trig, `${p} ${k}: no price outlook, no trigger`); continue; }
      assert.ok(trig, `${p} ${k}: trigger line`);
      const raw = 0.9 * ent.by * cd.bp.value / Math.max(cen, cd.loan);
      const whole = Math.floor(Math.round(raw * 1e6) / 1e6);
      // at or over the benchmark the line is floored to a tenth, so "under 41 bu ... above the 41.00 bu
      // benchmark" cannot print (Childress Co., TX, 2026-10-18); still floored, so "under N" stays true
      const want = whole >= ent.by ? Math.floor(Math.round(raw * 10 * 1e6) / 1e6) / 10 : whole;
      const got = +/under <b>([\d,.]+) (?:bu|lb)<\/b>/.exec(trig)[1].replace(/,/g, "");
      assert.equal(got, want, `${p} ${k}: ${got} vs ${want}`);
      assert.ok(got <= raw + 1e-9, `${p} ${k}: floored`);
      assert.equal(/pays even on a normal crop/.test(trig), raw > ent.by, `${p} ${k}: normal-crop note`);
      n++;
    }
  }
  assert.ok(n >= 12000, `${n} trigger lines checked`);
});

test("verdict first: the main page's quick answer comes before the deadlines and the reminder box, and leads with the 2026 counts", () => {
  const html = readFileSync(ROOT + "arc-plc.html", "utf8");
  const main = html.slice(html.indexOf("<main"));
  const q = main.indexOf('id="quick-answer"'), dl = main.indexOf('class="ap-dead"'), ask = main.indexOf("data-signup-ask"), pick = main.indexOf("data-arcfind");
  assert.ok(q > 0 && q < dl && q < ask && q < pick, "quick answer above the picker, deadlines and reminder");
  const lead = /<div class="ap-quick" id="quick-answer">\s*<p class="ap-lead"><b>For 2026, on a typical farm\.<\/b> Corn: (.*?)<\/p>/.exec(main);
  assert.ok(lead, "quick answer opens with the 2026 counts");
  // the counts are the build's own verdicts, so they add up to the tally sentence below them
  const m = /(?:([\d,]+) of|all) ([\d,]+) county and practice combinations/.exec(lead[1]);
  assert.ok(!/in ([\d,]+) of \1\b/.test(lead[1]), "no 'N of N'");
  const tally = /across ([\d,]+) county and practice combinations/.exec(main);
  assert.equal(m[2], tally[1], "same denominator as the corn tally");
  assert.ok(main.indexOf("Login.gov") > 0, "online election line");
  // the crop pages (scripts/arc_plc_crops.py) lead the same way
  let crops = 0;
  for (const f of readdirSync(ROOT + "arc-plc").filter((x) => x.endsWith(".html"))) {
    const h = readFileSync(ROOT + "arc-plc/" + f, "utf8");
    if (!h.includes('id="quick-answer"') || !h.includes('class="ap-dead"')) continue;
    assert.ok(h.indexOf('id="quick-answer"') < h.indexOf("data-arcfind") && h.indexOf('id="quick-answer"') < h.indexOf('class="ap-dead"'), `${f}: quick answer first`);
    crops++;
  }
  assert.ok(crops >= 5, `${crops} crop pages`);
});

test("county pages: the county is in the H1 and the crop answers sit right under it, above the picker", () => {
  let n = 0;
  for (const p of countyPages()) {
    const html = readFileSync(ROOT + "arc-plc/" + p, "utf8");
    if (!html.includes('id="crops"')) continue;
    const h1 = /<h1>([^<]+): ARC or PLC<\/h1>/.exec(html);
    const crumb = /<span aria-current="page">([^<]+)<\/span>/.exec(html)[1];
    assert.ok(h1 && h1[1].startsWith(crumb + ", "), `${p}: county in the H1`);
    const a = html.indexOf("<h1>"), c = html.indexOf('<h2 id="crops"'), f = html.indexOf("data-arcfind"), s = html.indexOf('class="ap-seg"');
    assert.ok(a < c && c < f && c < s, `${p}: cards first`);
    assert.ok(!/<h2|<div|<section/.test(html.slice(html.indexOf("</h1>"), c)), `${p}: nothing between the H1 and the cards but the byline`);
    assert.ok(html.includes("Login.gov"), `${p}: online election line`);
    n++;
  }
  assert.ok(n >= 2700, `${n} pages`);
});

/* Source sweep, Oct 15, 2026: FSA's ARC/PLC page and its Sept 15, 2026 release,
 * read in full, send elections and enrollment to the county office ("Please
 * contact your local FSA office to make ... elections and complete the
 * enrollment process") and name Login.gov only for landowners viewing their
 * base allocation notice. No page says you can elect online. */
test("how to sign follows FSA's own pages", () => {
  const line = "Sign up at your county FSA office; FSA says to make an appointment there to elect and enroll. Landowners can see their base allocation notice online at";
  const main = readFileSync(ROOT + "arc-plc.html", "utf8");
  assert.ok(main.includes(line));
  let n = 0;
  for (const p of countyPages()) {
    const html = readFileSync(ROOT + "arc-plc/" + p, "utf8");
    if (!html.includes('id="crops"')) continue;
    assert.ok(html.includes(line), `${p}: signing line`);
    assert.ok(!/elect and enroll online/.test(html), `${p}: no online election claim`);
    n++;
  }
  assert.ok(n >= 2700);
  assert.ok(!/elect and enroll online/.test(main));
});
