/* Curtain round 2 (Nov 9): every yield state page (built by scripts/build_state_yield_pages.py) ends in one closed
 * "Sources and terms" fold. The NASS notice, the "how to read the table" lines, the gap years and the winter-wheat note are
 * inside it; no fit method, threshold, file name or pull text is on the page.   node --test test/yield-terms-fold.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const code = `
import sys, os, json, tempfile
sys.path.insert(0, 'scripts')
import build_state_yield_pages as b
inp, _ = b._fixture()
with tempfile.TemporaryDirectory() as td:
    os.makedirs(os.path.join(td, 'farmland-atlas', 'iowa'))
    open(os.path.join(td, 'farmland-atlas', 'iowa', 'adams-county.html'), 'w').close()
    out = os.path.join(td, 'yield')
    b.build_all(inp, out_dir=out, root=td, chrome_parts=('<div id="site-header"></div>', '<div id="site-footer"></div>', ''))
    print(json.dumps({n: open(os.path.join(out, n + '.html'), encoding='utf-8').read() for n in ('iowa', 'kansas', 'utah')}))
`;
const pages = JSON.parse(execFileSync("python3", ["-I", "-c", code], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").pop());
const NASS = "This product uses the NASS API but is not endorsed or certified by NASS.";
const BANNED = /least.squares|ordinary|state crop file|state-stats|\.json|\.py\b|NASS pull|needed to fit a line|withheld below|\d of \d or \d+ of \d+/i;
const mainOf = (h) => h.slice(h.indexOf("<main"), h.indexOf("</main>"));

for (const [name, h] of Object.entries(pages)) {
  test(`${name}: one closed fold last in the page body, notices inside, no method text`, () => {
    const main = mainOf(h);
    const f = main.match(/<details[^>]*><summary>Sources and terms<\/summary>/g) || [];
    assert.equal(f.length, 1);
    assert.ok(!/\sopen[\s>]/.test(f[0]));
    const i = main.indexOf(f[0]), end = main.indexOf("</details>", i), fold = main.slice(i, end);
    assert.equal(main.slice(end + 10).trim(), "", "the fold is the last thing in the page body");
    assert.ok(fold.includes(NASS), "NASS notice inside");
    assert.equal(main.split(NASS).length, 2, "NASS notice once");
    assert.match(fold, /Highest and lowest are over the published years shown, not all-time records/);
    assert.match(fold, /The trend describes the\s+past window and is not a forecast/);
    assert.ok(!main.includes("How these numbers are made") && !main.includes('class="yl-sub yl-credit"'));
    const m = h.slice(h.indexOf("<body")).replace(/<script[\s\S]*?<\/script>/g, "").match(BANNED);
    assert.equal(m, null, m && m[0]);
  });
}

test("the gap years, the county note and the winter-wheat note moved into the fold", () => {
  const fold = (h) => { const m = mainOf(h), i = m.indexOf("<summary>Sources and terms"); return m.slice(i); };
  assert.match(fold(pages.iowa), /Years inside the window with no NASS state figure: corn: 2014/);
  assert.match(fold(pages.iowa), /County figures are NASS county corn yields, all practices/);
  assert.match(fold(pages.kansas), /Wheat here is <b>winter wheat<\/b> only/);
  assert.ok(!mainOf(pages.kansas).slice(0, mainOf(pages.kansas).indexOf("<summary>Sources and terms")).includes("winter wheat</b> only"));
});

test("the lede keeps the source in plain words and the table note stays short", () => {
  const h = pages.iowa;
  assert.match(h, /USDA NASS annual state yield estimates for Iowa: corn \(2010&ndash;2025\)/);
  assert.match(h, /Every figure below is a USDA NASS number for the year shown; none is estimated or filled in by AGSIST\./);
  assert.match(h, /n\/a: NASS published no figure for that year\. Pending: not yet released/);
  assert.match(h, /Source: USDA NASS Quick Stats, state level\./);
  assert.match(h, /Trend \(2010&ndash;2025\): <b>[^<]+<\/b> bu\/ac per year, n&nbsp;=&nbsp;15 years \(not projected\)/);
});
