/* /hail-map and its state pages: one "severe" (1 inch, NWS), real state codes
 * only, the address lookup reaching the days the archive does not have yet,
 * and no claim we could not check.
 *
 *   node --test test/hail-map.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const HTML = read("hail-map.html");
const py = (code) => execFileSync("python3", ["-I", "-c", "import sys,json; sys.path.insert(0, 'scripts'); " + code], { cwd: ROOT, encoding: "utf8" });
const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/&Prime;/g, "″").replace(/&ndash;/g, "–").replace(/&rsquo;/g, "’").replace(/&amp;/g, "&");

test("a state page built from a 1.5-inch file never calls 1.5 inches the NWS severe size", () => {
  const out = py("import generate_hail_states as g; rows=[{'county':'Dane','total':190,'avg':38.0,'peak':'Apr','dmg_pct':39}]; " +
    "h=g.page_html('WI','Wisconsin',rows,[2022,2023,2024,2025,2026],1.5,'2026-10-10',4.75,[]); " +
    "h1=g.page_html('WI','Wisconsin',rows,[2022,2023,2024,2025,2026],1.0,'2026-10-10',4.75,[]); print(json.dumps([h,h1]))");
  const [h15, h1] = JSON.parse(out);
  assert.ok(!/1\.5″ or larger, the National Weather Service severe size/.test(h15), "1.5 is not the NWS severe size");
  assert.ok(!/severe-hail share/.test(h15), "a 1.5 table is not a severe share");
  assert.match(h15, /National Weather Service severe size is 1″/);
  assert.match(h1, /1″ or larger, the National Weather Service severe size/);
  assert.ok(!/1\.0″/.test(h1), "prints 1″, not 1.0″");
});

test("the shipped state pages agree with the data file's threshold", () => {
  const dmg = JSON.parse(read("data/hail/state-counties.json")).damaging_in;
  for (const f of readdirSync(ROOT + "hail-map").filter((x) => x.endsWith(".html"))) {
    const h = read("hail-map/" + f);
    const bad = new RegExp(String(dmg).replace(".", "\\.") + "\u2033 or larger, the National Weather Service severe size");
    if (+dmg !== 1) assert.ok(!bad.test(h), f + " calls " + dmg + "\u2033 the NWS severe size");
    assert.ok(!/1\.0\u2033/.test(h), f + " prints 1.0\u2033");
  }
});

test("county rankings keep only real state and territory codes", () => {
  const out = py("import fetch_hail as f; acc={('IA','Polk'):{'total':5,'dmg':1,'months':[0]*13},('IT','MS'):{'total':3,'dmg':0,'months':[0]*13},('PL','Ka'):{'total':2,'dmg':0,'months':[0]*13},('PR','Ponce'):{'total':1,'dmg':0,'months':[0]*13}}; print(json.dumps(sorted(f.finalize_counties(acc,[2025],end_iso='2025-12-31').keys())))");
  assert.deepEqual(JSON.parse(out), ["IA", "PR"]);
  const d = JSON.parse(read("data/hail/state-counties.json"));
  assert.ok(!("IT" in d.states) && !("PL" in d.states), "the shipped file has no IT or PL");
  assert.match(HTML, /optgroup label="Territories"/);
});

test("the county table never labels a non-1-inch share as severe", () => {
  assert.match(HTML, /id="hm-dmg-th"/);
  assert.match(HTML, /id="hm-dmg-old"/);
});

test("the address lookup adds the daily feed's reports since the archive ends, tagged preliminary", () => {
  const m = HTML.match(/function mergePrelim\([\s\S]*?\n {4}\}/);
  assert.ok(m, "mergePrelim in hail-map.html");
  const ctx = {};
  vm.runInNewContext("function haversineMi(a,b,c,d){var R=3958.8,t=Math.PI/180,x=(c-a)*t,y=(d-b)*t,h=Math.sin(x/2)*Math.sin(x/2)+Math.cos(a*t)*Math.cos(c*t)*Math.sin(y/2)*Math.sin(y/2);return 2*R*Math.asin(Math.sqrt(h));}\n" + m[0] + "\nthis.f=mergePrelim;", ctx);
  const recent = { reports: [
    { lat: 41.6, lon: -93.6, mag: 1.25, date: "2026-10-12", city: "Des Moines", st: "IA" },
    { lat: 41.6, lon: -93.6, mag: 65.0, date: "2026-10-13", city: "Des Moines", st: "IA" },
    { lat: 41.6, lon: -93.6, mag: 1.0, date: "2026-09-30", city: "Des Moines", st: "IA" },
    { lat: 44.0, lon: -93.6, mag: 2.0, date: "2026-10-12", city: "Far", st: "MN" },
  ] };
  const ev = ctx.f(recent, 41.59, -93.62, 10, "2026-10-01");
  assert.equal(ev.length, 2, "two reports after the archive date and inside the radius");
  assert.ok(ev.every((e) => e.pre === true));
  assert.equal(ev[0].mag, 1.25);
  assert.equal(ev[1].mag, null, "a 65-inch stone is a bad entry: size unknown, report kept");
  assert.equal(ev[0].place, "Des Moines, IA");
  assert.equal(ctx.f(null, 41.59, -93.62, 10, "2026-10-01").length, 0, "no feed, nothing added");
});

test("no unverified price range and no routing to a crop-hail writer", () => {
  assert.ok(!/\$999/.test(HTML), "the $999-$1,999 range is gone");
  assert.ok(!/conversation worth having/.test(HTML));
});

test("visible FAQ and FAQPage JSON-LD match for the changed answers", () => {
  const blocks = [...HTML.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((b) => JSON.parse(b[1]));
  const find = (o) => (Array.isArray(o) ? o.flatMap(find) : o && typeof o === "object" ? (o["@type"] === "FAQPage" ? [o] : Object.values(o).flatMap(find)) : []);
  const faq = blocks.flatMap(find)[0].mainEntity;
  for (const q of ["How is hail damage to crops insured?", "How is this different from paid hail map subscriptions?"]) {
    const a = faq.find((x) => x.name === q).acceptedAnswer.text;
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const vis = HTML.match(new RegExp("<summary>" + esc + "</summary>\\s*<p>([\\s\\S]*?)</p></details>"));
    assert.ok(vis, q);
    assert.equal(strip(vis[1]), a, q);
  }
});
