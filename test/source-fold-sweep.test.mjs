/* Long sources and method text sit in one closed "Sources and terms" fold at the bottom (Nov 8, 2026; the pattern of the home page, PR #430). Static, on the files:
 * each listed page has at most one such fold, closed on load; the NASS notice (scripts/credits.py) is inside it wherever
 * the page carries it; the "not financial advice" line of the four futures pages is inside it. arc-plc.html is built
 * from scripts/build_arc_plc.py on main, so the builder is read for it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
// /rain-radar became the radar tab of /rain on Nov 11, 2026: its fold is checked on /rain
const PAGES = ["usda-calendar", "corn-futures-prices", "soybean-futures-prices", "wheat-futures-prices", "cattle-futures-prices",
  "milk-prices", "breakeven", "usda-quick-stats", "hay-prices", "fast-facts", "farmland-atlas", "conditions", "cash-lease", "spray", "rain"];   // arc-plc: built on main, read through its builder below
const NASS = "This product uses the NASS API but is not endorsed or certified by NASS.";
const OPEN = /<details\b[^>]*>\s*<summary\b[^>]*>(?:<h2\b[^>]*>)?\s*Sources and terms\s*</g;
const folds = (h) => [...h.matchAll(OPEN)].map((m) => {
  const end = h.indexOf("</details>", m.index);
  return { open: /\bopen\b/.test(m[0].slice(0, m[0].indexOf(">") + 1)), body: h.slice(m.index, end) };
});

for (const p of PAGES) {
  test(`${p}: at most one Sources and terms fold, closed, with the NASS notice inside`, () => {
    const h = read(p + ".html");
    const f = folds(h);
    assert.ok(f.length <= 1, `${p}: ${f.length} folds`);
    assert.ok(!f.some((x) => x.open), `${p}: fold ships open`);
    const n = h.split(NASS).length - 1, inside = f.reduce((a, x) => a + x.body.split(NASS).length - 1, 0);
    assert.equal(inside, n, `${p}: NASS notice shown ${n} times, ${inside} inside the fold`);
    if (n) assert.equal(f.length, 1, `${p}: carries the NASS notice but has no fold`);
  });
}

test("pages that gained the fold hold it once, with their credit line short and in place", () => {
  for (const p of ["corn-futures-prices", "soybean-futures-prices", "wheat-futures-prices", "cattle-futures-prices", "milk-prices", "breakeven",
    "usda-quick-stats", "hay-prices", "conditions", "cash-lease", "fast-facts", "rain"]) assert.equal(folds(read(p + ".html")).length, 1, p);
  for (const c of ["corn", "soybean", "wheat", "cattle"]) {
    const h = read(`${c}-futures-prices.html`), f = folds(h)[0].body;
    assert.match(f, /Not financial advice|not financial advice/, `${c}: the not-financial-advice line is in the fold`);
    assert.match(f, /Prices from Yahoo Finance|futures via Yahoo Finance/, `${c}: the price source is in the fold`);
    assert.ok(!/<div class="disc">/.test(h), `${c}: no loose disclaimer block`);
  }
  assert.match(read("usda-quick-stats.html"), /<p class="qs-by">Numbers from USDA NASS\.<\/p>/);
  assert.match(read("conditions.html"), /Data: USDA NASS Crop Progress, out Mondays at 4 p\.m\. Eastern\.<\/p>/);
});

test("the track record keeps its status text, the lock sentence and the sources inside the fold", () => {
  const h = read("usda-calendar.html"), f = folds(h);
  assert.equal(f.length, 1);
  assert.match(f[0].body, /baseline that is fixed in advance and never changed/);
  assert.match(f[0].body, /Status: Live beats its baseline and is still being made/);
  assert.match(f[0].body, /is left out of the direction count/);
  assert.match(f[0].body, /USDA AMS announced Class III prices/);
  assert.match(h, /<p class="tr-note">Record as of [A-Z][a-z]+ \d+, 2026\.<\/p>/);
});

test("the ARC and PLC builder puts the method, the sources and the NASS notice in one closed fold", () => {
  const b = read("scripts/build_arc_plc.py");
  const i = b.indexOf('<details class="ap-det" id="terms"><summary>Sources and terms</summary>');
  assert.ok(i > 0, "fold in the builder");
  const line = b.slice(i, b.indexOf("</details>", i));
  assert.ok(line.includes("{method_html(D)}") && line.includes("{CR.NASS_NOTICE}"), "method and NASS notice inside it");
  assert.equal((b.match(/\{method_html\(D\)\}/g) || []).length, 1, "method printed once");
  assert.ok(!/<div class="method-note"><b>(Sources|Method)<\/b>/.test(b), "no loose method or sources block");
});
