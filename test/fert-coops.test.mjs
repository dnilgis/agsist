/* /fertilizer, "What co-ops are posting" (components/fert-coops.js), drawn
 * from data/fertilizer-coops.json as scripts/fetch_coop_fert.py writes it.
 * The feed here is the script's own output on the saved fixtures
 * (test/fixtures/coop-fert/: three Kansas co-op pages and one price sheet),
 * so the page and the pipeline are tested against the same numbers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const require = createRequire(import.meta.url);
const FC = require(ROOT + "components/fert-coops.js");
const FEED = JSON.parse(execFileSync("python3", ["scripts/fetch_coop_fert.py", "--fixture-feed"], { cwd: ROOT, encoding: "utf8" }));
const HTML = read("fertilizer.html");
const clone = (o) => JSON.parse(JSON.stringify(o));
const AMS = { report_date: "2026-10-02", products: [{ key: "urea", avg: 770 }, { key: "dap", avg: 929.29 }, { key: "uan32", avg: 530 }] };

test("the reader's selftest passes", () => {
  const out = execFileSync("python3", ["scripts/fetch_coop_fert.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /selftest ok/);
});

test("no file or nothing current: nothing is drawn", () => {
  for (const bad of [null, {}, { summary: [], coops: [] },
    { summary: [{ key: "urea", n: 2, low: 600, high: 500, oldest: "2026-10-01", newest: "2026-10-01" }], coops: [] },
    { summary: [{ key: "urea", n: 3, median: 900, low: 600, high: 700, oldest: "2026-10-01", newest: "2026-10-01" }], coops: [] },
    { summary: [{ key: "urea", n: 1, low: 600, high: 600, oldest: "Oct 1", newest: "Oct 1" }], coops: [] }]) {
    assert.equal(FC.section(bad, AMS), "", JSON.stringify(bad));
  }
});

test("section: middle price only where the file gives one, every co-op named and linked", () => {
  const h = FC.section(FEED, AMS);
  assert.match(h, /What Kansas co-ops are posting/, "the heading names the region");
  assert.match(h, /\$623<\/div>/, "urea middle of four co-ops, 622.98 rounded");
  assert.match(h, /middle of 4 co-ops/);
  assert.match(h, /\$608 to \$840/);
  assert.match(h, /one co-op: Test sheet co-op/, "UAN 32 from one co-op: no middle price, the co-op named");
  assert.match(h, /\$980<\/div><div class="fpc-unit">\$\/ton cash<\/div><div class="fpc-loc">average of 2 co-ops/, "MAP from two co-ops: their average, said so");
  assert.match(h, /\$420<\/div><div class="fpc-unit">\$\/ton cash<\/div><div class="fpc-loc">average of 2 co-ops/, "Thio-Sul: 390 and 450 average to 420");
  for (const c of FEED.coops) assert.ok(h.includes('href="' + c.url + '"'), c.name + " linked");
  assert.match(h, /Call to confirm/);
  assert.ok(!/—/.test(h), "no em dashes");
});

test("dates: the co-ops' own, and an undated price is counted apart", () => {
  const h = FC.section(FEED, AMS);
  assert.match(h, /newest posted Oct 6, oldest Sep 24, 1 with no date shown/, "DAP: Two Rivers 'close out' has no date");
  assert.match(h, /not shown; first seen Oct 15, 2026 \(close out\)/);
  assert.match(h, /21-0-0-24S<\/b>[^<]*<span class="fcp-when">Aug 4, 2026\. 72 days old, not counted/);
});

test("far from the others is said, not hidden", () => {
  assert.match(FC.section(FEED, AMS), /Far from the other co-ops: Mulvane Cooperative Union&rsquo;s Urea \(\$840\)/);
});

test("no USDA figure is drawn in the co-op section or its top line", () => {
  const all = FC.section(FEED) + FC.bar(FEED);
  assert.ok(!/\$770|USDA Illinois avg|Against the USDA/.test(all), "a USDA number in the co-op section");
  assert.equal(FC.amsLine, undefined, "the USDA comparison line is gone");
});

test("a link that is not https is not drawn as a link", () => {
  const f = clone(FEED);
  f.coops[0].url = "javascript:alert(1)";
  f.coops[0].source_url = "javascript:alert(1)";
  assert.ok(!FC.section(f, AMS).includes("javascript:"));
});

test("fertilizer.html loads the component and the file, sections hidden until drawn, co-op cards first", () => {
  assert.match(HTML, /<section id="fert-coops" aria-labelledby="fert-coops-h" hidden><\/section>/);
  assert.match(HTML, /<section id="fert-coops-more" aria-labelledby="fert-coops-more-h" hidden><\/section>/);
  assert.match(HTML, /<script src="\/components\/fert-coops\.js\?v=\d+"><\/script>/);
  assert.ok(HTML.includes("getJ('/data/fertilizer-coops.json')"));
  assert.match(HTML, /FC\.top\(co\)/);
  assert.match(HTML, /FC\.bar\(co\)/);
});

test("the top: hero line names the newest posted date and the co-op count; cards say how many co-ops", () => {
  assert.equal(FC.bar(FEED), "Every price on this page is from <strong>Kansas</strong> co-ops: the middle cash price of four co-ops, posted through <strong>Oct 12, 2026</strong>. Read Oct 15, 2026.");
  assert.equal(FC.bar(null), "");
  const t = FC.top(FEED);
  assert.match(t, /middle of 4 co-ops/);
  assert.ok(!t.includes("<table"), "the co-op table and every posted price sit lower down, not in the top");
  assert.match(FC.more(FEED), /Where the co-op prices come from/);
});
