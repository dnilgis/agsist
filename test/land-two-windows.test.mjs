/* Two windows, one county (benchmark review, Oct 29, 2026). The Barron County sale page leads with a
 * 24-month market middle ($5,467 on 34 sales) and the Atlas county page also shows a 12-month median
 * ($5,668 on 22 sales); side by side they read like an error. Each page now says which window and
 * how many sales each number uses, and links to the other. Both numbers come from the files the
 * builders read (data/land-sales/wi.json, data/land/wi/summary.json), checked here against them.
 *   node --test test/land-two-windows.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");

test("Barron County: the sale page names both windows and links the Atlas page", () => {
  const sm = JSON.parse(read("data/land/wi/summary.json")).counties["55005"].med;
  const h = read("land-sales/wisconsin/barron-county.html");
  const m = /<p class="ls-fine ls-two">Two windows: this middle covers 24 months \((\d+) sales\)\. The <a href="\/farmland-atlas\/wisconsin\/barron-county">Farmland Atlas page<\/a> also shows the last 12 months, Oct 1, 2025 to Sep 30, 2026: (\d+) sales, median (\$[\d,]+) an acre\. Different windows, different numbers\.<\/p>/.exec(h);
  assert.ok(m, "the two-window line");
  assert.equal(+m[2], sm.n);
  assert.equal(m[3], money(sm.med));
  assert.match(h, new RegExp("the middle of " + m[1] + " bare farmland sales"), "the 24-month count is the headline's");
});

test("Barron County: the Atlas page names both windows and links the sale page", () => {
  const sm = JSON.parse(read("data/land/wi/summary.json")).counties["55005"].med;
  const h = read("farmland-atlas/wisconsin/barron-county.html");
  const m = /Middle of (\d+) bare farmland sales of 20\+ acres, Oct 2024 to Sep 2026\.[^<]* Two windows: this covers 24 months; the recorded-sales median further down covers the last 12 months, Oct 2025 to Sep 2026: (\d+) sales, (\$[\d,]+) an acre\. <a href="\/land-sales\/wisconsin\/barron-county">Every sale behind both<\/a>\./.exec(h);
  assert.ok(m, "the two-window line");
  assert.equal(+m[2], sm.n);
  assert.equal(m[3], money(sm.med));
  assert.match(h, new RegExp(m[2] + " recorded bare farmland sales, Oct 2025 to Sep 2026"), "the 12-month count is the tile's");
});

test("every sale page with the line has its Atlas page saying the same counts back", () => {
  let n = 0;
  for (const st of ["wisconsin", "illinois"]) {
    for (const f of readdirSync(ROOT + "land-sales/" + st)) {
      const h = read(`land-sales/${st}/${f}`);
      const m = /class="ls-fine ls-two">Two windows: this middle covers 24 months \((\d+) sales\)\. The <a href="([^"]+)">[\s\S]*?: (\d+) sales, median (\$[\d,]+) an acre/.exec(h);
      if (!m) continue;
      const a = read(m[2].slice(1) + ".html");
      assert.match(a, new RegExp("Middle of " + m[1] + " bare farmland sales[^<]*covers the last 12 months, [A-Z][a-z]{2} \\d{4} to [A-Z][a-z]{2} \\d{4}: " + m[3] + " sales, \\" + m[4] + " an acre"), f);
      n++;
    }
  }
  assert.ok(n > 50, "lines found: " + n);
});

/* Recorded sale vs auction result vs asking price (same review): every price on the sale pages and the
 * Atlas land panel is a recorded transfer; the pages say so where the prices are. */
test("where a land price shows, it says it is a recorded sale, never an asking price", () => {
  const ls = read("land-sales/wisconsin/barron-county.html");
  assert.match(ls, /<th scope="col" class="n">Recorded price<\/th>/);
  assert.match(ls, /<p class="ls-fine ls-kind">Every price here is a recorded sale: what the state(&#x27;|')s transfer record says was paid once the sale closed\. Auction sales count once recorded\. Asking prices and auction bids that did not close are never shown\.<\/p>/);
  assert.match(read("land-sales/2026-09.html"), /<th scope="col" class="n">Recorded price<\/th>/);
  const at = read("farmland-atlas/wisconsin/barron-county.html");
  assert.match(at, /Recorded prices\. Not an appraisal\. No adjustments\. A recorded price is what the state(&#x27;|')s transfer record says was paid once the sale closed, auction or private; never an asking price\./);
  for (const h of [ls, at]) assert.doesNotMatch(h, /—/);
});
