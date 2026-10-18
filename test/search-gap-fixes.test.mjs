/* Search gap fixes, round 1 (2026-10-18): titles, descriptions and FAQs
 * written for the searches Search Console says these pages miss. Each claim
 * is checked against the page's own data.
 *
 *   node --test test/search-gap-fixes.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const unent = (s) => s.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
const title = (h) => unent(h.match(/<title>([^<]*)<\/title>/)[1]);
const desc = (h) => unent(h.match(/<meta name="description"\s+content="([^"]*)"/)[1]);
function faqLD(h) {
  const out = new Map();
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let d; try { d = JSON.parse(m[1]); } catch { continue; }
    const walk = (o) => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o && typeof o === "object") {
        if (o["@type"] === "FAQPage") for (const q of o.mainEntity) out.set(q.name, q.acceptedAnswer.text);
        Object.values(o).forEach(walk);
      }
    };
    walk(d);
  }
  return out;
}
const visible = (h) => unent(h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ")
  .replace(/<[^>]+>/g, " ").replace(/&rsquo;/g, "’").replace(/&deg;/g, "°")).replace(/\s+/g, " ");

test("usda-calendar: title, description and the two FAQs agree with the page's schedule", () => {
  const h = read("usda-calendar.html");
  const rows = [...h.matchAll(/\{date:'(\d{4}-\d\d-\d\d)',name:'([^']*)',type:'([^']*)'(?:,tag:'[^']*')?,time:'([^']*)'/g)]
    .map((m) => ({ date: m[1], name: m[2], type: m[3], time: m[4] }));
  assert.ok(rows.length > 40, "REPORTS parses");
  const t = title(h), d = desc(h);
  assert.ok(t.length <= 68 && d.length <= 160, `${t.length} / ${d.length}`);
  const ld = faqLD(h), vis = visible(h);
  const qNext = "When is the next USDA crop report?", qTime = "What time do USDA reports come out?";
  for (const q of [qNext, qTime]) {
    assert.ok(ld.has(q), `JSON-LD has ${q}`);
    assert.ok(vis.includes(q) && vis.includes(ld.get(q)), `visible answer for ${q} matches the JSON-LD`);
    assert.ok(!/—|&mdash;/.test(ld.get(q)), "no em dash");
  }
  const m = t.match(/Next WASDE & Crop Production (\w{3}) (\d+)/);
  if (m) {
    // the date in the title is a day the page lists BOTH reports, at noon ET
    const day = rows.filter((r) => r.date.slice(5) === `${String(MON.indexOf(m[1]) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`);
    assert.ok(day.some((r) => r.name === "WASDE" && r.time === "12:00 PM ET"), "WASDE that day");
    assert.ok(day.some((r) => r.name === "Crop Production" && r.time === "12:00 PM ET"), "Crop Production that day");
    assert.ok(d.includes(`${m[1]} ${m[2]}, `) && d.includes("noon ET"), d);
    assert.ok(ld.get(qNext).includes(`${m[1]} ${m[2]}, `) && ld.get(qNext).includes("12:00 p.m. ET"), ld.get(qNext));
  }
  // every time the times answer prints is the page's own
  const at = (nm) => new Set(rows.filter((r) => r.name === nm || r.name.startsWith(nm + " (")).map((r) => r.time));
  for (const nm of ["WASDE", "Crop Production", "Grain Stocks", "Prospective Plantings", "Acreage"])
    assert.deepEqual([...at(nm)], ["12:00 PM ET"], nm);
  for (const nm of ["Cattle on Feed", "Quarterly Hogs and Pigs", "Milk Production", "Cold Storage"])
    assert.deepEqual([...at(nm)], ["3:00 PM ET"], nm);
  const ans = ld.get(qTime);
  assert.match(ans, /12:00 p\.m\. ET \(11 a\.m\. CT\): WASDE, Crop Production, Grain Stocks/);
  assert.match(ans, /Cattle on Feed[^.]*3:00 p\.m\. ET/);
  assert.match(ans, /Crop Progress is out Mondays at 4:00 p\.m\. ET/);
  assert.match(h, /time:'4:00 PM ET'|4:00 PM ET/, "the page itself shows Crop Progress at 4 p.m. ET");
});

test("markets: CBOT in the title, delayed or settle in the description, never live", () => {
  const h = read("markets.html");
  const t = title(h), d = desc(h);
  assert.match(t, /^CBOT Grain Prices /);
  assert.ok(t.length <= 68, t);
  assert.ok(/delayed|Settles/.test(d), d);
  assert.ok(!/\blive\b/i.test(d.replace(/live cattle/gi, "")), d);
  assert.ok(!/\blive\b/i.test(t.replace(/live cattle/gi, "")), t);
});

test("usda-quick-stats: the years in the description are the data files' years", () => {
  const h = read("usda-quick-stats.html");
  const d = desc(h);
  const m = d.match(/(\d{4}) to (\d{4}) finals/);
  if (!m) return; // the bake leaves the years out when the files are missing
  for (const f of ["corn-yield", "soy-yield"]) {
    const ys = JSON.parse(read(`data/nass/${f}.json`)).years;
    assert.ok(Math.min(...ys) <= +m[1] && Math.max(...ys) >= +m[2], `${f} covers ${m[1]} to ${m[2]}`);
  }
  assert.match(d, /CSV/);
  assert.match(h, /downloadCSV|CSV\(\)/, "the page has a CSV download");
});

test("wheat futures: H1 names Chicago and KC, the page shows KC, and the KC FAQ is marked up", () => {
  const h = read("wheat-futures-prices.html");
  assert.match(h, /<h1><!--BAKE:futures-h1-->Chicago and KC wheat futures prices today<!--\/BAKE--><\/h1>/);
  assert.match(h, /id="p-kcwheat"/);
  const px = JSON.parse(read("data/prices.json"));
  assert.ok(Object.keys(px.quotes || {}).some((k) => k.startsWith("kcwheat")), "the price file carries KC wheat");
  const a = faqLD(h).get("What is Kansas City wheat?");
  assert.ok(a && /hard red winter/.test(a) && /KE/.test(a), a);
  assert.ok(!/—/.test(a));
});

test("gdu-calculator: the 86/50 FAQ, its worked day matches the page's own math, no seed brands", () => {
  const h = read("gdu-calculator.html");
  const a = faqLD(h).get("Is this the same 86/50 method seed companies use?");
  assert.ok(a, "FAQ in JSON-LD");
  assert.ok(visible(h).includes("Is this the same 86/50 method seed companies use?"));
  const fn = h.match(/function gduDay\(hi,lo\)\{[^}]*\}/)[0];
  const gduDay = new Function(`${fn}; return gduDay;`)();
  assert.equal(gduDay(95, 70), 28, "the page's own function");
  assert.match(a, /\(86 \+ 70\) ÷ 2 − 50 = 28 GDU/);
  assert.match(a, /MP437/);
  assert.match(h, /uaex\.uada\.edu\/publications\/pdf\/mp437\/MP437\.pdf/, "source linked");
  assert.ok(!/—/.test(a));
  const brands = /pioneer|corteva|dekalb|bayer|golden harvest|syngenta|beck'?s hybrids|stine|asgrow|wyffels|agrigold|brevant|\bNK\b/i;
  assert.ok(!brands.test(visible(h) + title(h) + desc(h)), "no seed brand on the page");
});
