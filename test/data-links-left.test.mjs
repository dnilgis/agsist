/* The last string URLs to data sources inside page scripts on /spray and /cash-lease (found by the extended
 * source_links guard in PR #502, Nov 9 2026: spray 4, cash-lease 1). Oct 29 rule: name the source in plain
 * text, credit it in the closed Sources and terms fold, no link to a data tool or file. Read with the same
 * isDataSource() the anchor guard uses; PR #502's scanScripts() covers every page once it lands.
 *
 *   node --test test/data-links-left.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDataSource, scan } from "../scripts/source_links.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
let seen = 0;   // every URL literal read, loaded or not: the floor that proves the scan saw the scripts
const scriptUrls = (h) => {
  const out = [];
  for (const m of h.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/ld\+json/i.test(m[1])) continue;
    // a URL the script only fetches or loads (fetch, src) sends no reader anywhere: same rule as PR #502
    for (const l of m[2].matchAll(/(['"`])(https?:\/\/[^'"`\s<>]+)/g)) {
      seen++;
      if (!/(fetch\(|\bsrc\s*[:=]\s*)\s*$/i.test(m[2].slice(Math.max(0, l.index - 24), l.index))) out.push(l[2]);
    }
  }
  return out;
};

test("the guard's own check still sees the old copies (real lines from Nov 9 2026)", () => {
  const old = "<script>var INV_NETS={Kansas:{n:'Kansas Mesonet',u:'https://mesonet.k-state.edu/agriculture/inversion/'}};" +
    "var RULES={IA:{s:'Iowa Code 562.6',u:'https://www.legis.iowa.gov/docs/code/562.6.pdf'}};</script>";
  assert.deepEqual(scriptUrls(old).filter(isDataSource),
    ["https://mesonet.k-state.edu/agriculture/inversion/", "https://www.legis.iowa.gov/docs/code/562.6.pdf"]);
});

for (const p of ["spray", "cash-lease"]) {
  test(`${p}: no data-source URL in a script or a link`, () => {
    const h = read(p + ".html");
    seen = 0;
    const urls = scriptUrls(h);
    assert.ok(seen >= 1, `${p}: no script URLs read at all; the scan has moved`);
    assert.deepEqual(urls.filter(isDataSource), [], p);
    assert.deepEqual(scan(h), [], p);
  });
}

test("the sources are still credited by name in the closed fold", () => {
  const fold = (h) => {
    const i = h.search(/<details\b[^>]*>\s*<summary\b[^>]*>\s*Sources and terms\s*</);
    assert.ok(i >= 0, "no Sources and terms fold");
    return h.slice(i, h.indexOf("</details>", i));
  };
  const s = fold(read("spray.html"));
  for (const n of ["Iowa Environmental Mesonet", "Purdue Mesonet", "Kansas Mesonet", "Oklahoma Mesonet Drift Risk Advisor"]) assert.ok(s.includes(n), n);
  assert.doesNotMatch(s, /href=/, "the spray fold names, it does not link");
  assert.match(fold(read("cash-lease.html")), /Iowa Code 562\.6/);
  // the card still prints the law, as text
  assert.match(read("cash-lease.html"), /IA:\{n:'Iowa',t:'firm',s:'Iowa Code 562\.6',d:/);
});
