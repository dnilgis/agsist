/* Curtain round 2 (Nov 9): every ARC/PLC county page and state page ends in one closed "Sources and terms" fold
 * holding the estimate disclaimer and the NASS notice, and does not print the trigger working or a data file link.
 * node --test test/arc-plc-terms-fold.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const NASS = "This product uses the NASS API but is not endorsed or certified by NASS.";
const pages = [];
for (const f of readdirSync(ROOT + "arc-plc")) {
  if (f.endsWith(".html") && f !== "index.html") pages.push("arc-plc/" + f);
  else if (!f.includes(".") && existsSync(ROOT + "arc-plc/" + f) && readdirSync(ROOT + "arc-plc/" + f).length)
    for (const g of readdirSync(ROOT + "arc-plc/" + f)) if (g.endsWith(".html")) pages.push(`arc-plc/${f}/${g}`);
}
const live = pages.filter((p) => { const h = readFileSync(ROOT + p, "utf8"); return !h.includes('http-equiv="refresh"') && h.includes("ap-find-h") && !h.includes("ap-hubd"); });   // moved counties are pointer pages; crop hubs (ap-hubd) are another builder

test("every county and state page: one closed Sources and terms fold, last in the page, notices inside", () => {
  assert.ok(live.length > 2000, "pages: " + live.length);
  for (const p of live) {
    const h = readFileSync(ROOT + p, "utf8");
    const main = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
    const folds = main.match(/<details[^>]*><summary>Sources and terms<\/summary>/g) || [];
    assert.equal(folds.length, 1, p);
    assert.ok(!/\sopen[ >]/.test(folds[0]), p + " closed");
    const i = main.indexOf(folds[0]), e = main.indexOf("</details>", i);
    const fold = main.slice(i, e);
    assert.ok(fold.includes(NASS) && /not a USDA determination/.test(fold), p);
    assert.ok(!/<details/.test(main.slice(e + 10)), p + " nothing after it but plain lines");
    assert.ok(!main.slice(0, i).includes("not a USDA determination</"), p);
  }
});

test("the trigger working and the data file link are not printed", () => {
  for (const p of live) {
    const h = readFileSync(ROOT + p, "utf8");
    const main = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
    assert.ok(!/90% of the [\d.,]+ (bu|lb) benchmark|this state&rsquo;s data file|ap-trig-m/.test(main), p);
  }
});
