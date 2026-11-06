/* /cot fixes from the Nov 6 2026 panel (fx/cot-fixnow).
 *   1. The summary baked into cot.html shows with scripts off and until the live report renders: the hide
 *      rule keys on html.cot-live, which cot-page.js adds after the cards render, not on data-theme
 *      (cot.html ships data-theme="dark" on <html>, so a theme-keyed rule always matched).
 *   2. The verdict line ships empty: no static "Crowded" for a reader with no scripts.
 *   3. The COT share card reads live cattle under its real key, names Chicago wheat, and says added or cut
 *      toward the side the position is on (build_share_images.py selftest).
 *   4, C. No crowding advice anywhere: page, FAQ JSON-LD, the Friday email, the panel words.
 *   5. A sign change inside the flat band is not a flip (cot_analysis.py selftest, and the data file).
 *   6. A gap that may be chance says "could be chance", never "too few separate spells" or "Coin flip".
 *   10. The public COT data files and the page carry no test method: the analysis file has no method block.
 *   A. The card's 52-week contract rank fold is gone.  B. The method fold and note are source and sample only.
 * No dates or live values are pinned: the data checks are rules every report must keep.
 *
 *   node --test test/cot-fixnow.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const HTML = read("cot.html");
const PAGE = read("components/cot-page.js");
const MKT = read("components/cot-market.js");
const ANA_JS = read("components/cot-analysis.js");
const EMAIL = read("scripts/send_cot_weekly.py");
const BUILDER = read("scripts/cot_analysis.py");
const CX = JSON.parse(read("data/cot-analysis.json"));
const DATA_FILES = ["data/cot.json", "data/cot-history.json", "data/cot-analysis.json", "data/cot-options.json"];
// code comments may name what was removed; only what a reader can be shown is checked
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"\\])\/\/.*$/gm, "$1");
const py = (args) => spawnSync("python3", args, { cwd: ROOT, encoding: "utf8", timeout: 120000 });

test("1. the baked summary is hidden by a class the page script adds after rendering, not by the theme", () => {
  assert.doesNotMatch(HTML, /html\[data-theme\][^{]*\.cg-baked/, "no theme-keyed hide rule");
  assert.match(HTML, /html\.cot-live \.cg-baked\{display:none\}/);
  assert.match(HTML, /<html[^>]*data-theme=/, "the static theme attribute is why the rule cannot key on it");
  const at = PAGE.indexOf("classList.add('cot-live')");
  assert.ok(at > 0, "cot-page.js adds cot-live");
  const fn = PAGE.slice(PAGE.indexOf("function cotApply("), PAGE.indexOf("function cotLoad("));
  assert.ok(fn.includes("classList.add('cot-live')") && fn.indexOf("classList.add('cot-live')") > fn.indexOf("renderVerdict(data)"),
    "added once the live cards have rendered");
});

test("2. the verdict line ships empty", () => {
  assert.match(HTML, /<p class="cg-verdict" id="cg-verdict"><\/p>/);
  assert.doesNotMatch(HTML, /cg-hold/);
});

test("3. the COT share card: live cattle, Chicago wheat, added or cut by side", () => {
  const r = py(["scripts/build_share_images.py", "--selftest"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const src = read("scripts/build_share_images.py");
  const fn = src.slice(src.indexOf("def cot_card_parts("), src.indexOf("def card_cot("));
  assert.match(fn, /"livecattle", "Live cattle"/);
  assert.match(fn, /"wheat", "Chicago wheat"/);
  assert.doesNotMatch(fn, /\("cattle",/);
  assert.match(fn, /\(chg > 0\) == \(net >= 0\)/, "bake_seo.py's rule");
});

const ADVICE = [/corner to watch/i, /unpriced/i, /worth a look/i, /reason to look/i, /look this week at/i,
  /protect\b/i, /marketing plan/i, /exposure_noun/];
test("4, C. no crowding advice on the page, in its FAQ data, in the panel words or in the Friday email", () => {
  for (const [name, text] of [["cot.html", HTML], ["cot-page.js", code(PAGE)], ["cot-market.js", code(MKT)],
    ["cot-analysis.js", code(ANA_JS)], ["data/cot-analysis.json", JSON.stringify(CX)]]) {
    for (const re of ADVICE) assert.doesNotMatch(text, re, `${name}: ${re}`);
  }
  const note = EMAIL.slice(EMAIL.indexOf("def note(r):"), EMAIL.indexOf("def range_line("));
  const body = note.replace(/"""[\s\S]*?"""/, "");
  for (const re of ADVICE) assert.doesNotMatch(body, re, "email note(): " + re);
  assert.doesNotMatch(EMAIL, /EXPOSURE_GRAIN|EXPOSURE_STOCK|"noun":/);
  assert.doesNotMatch(BUILDER, /^EXPOSURE = \{/m);
  const r = py(["scripts/send_cot_weekly.py", "--selftest"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("5. a sign change inside the flat band is not a flip", () => {
  const r = py(["scripts/cot_analysis.py", "--selftest"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS\s+a sign change into the flat band is not a flip/);
  // the rules every report keeps: a flat market did not flip this week, and flips alternate sides
  for (const [k, c] of Object.entries(CX.commodities)) {
    const f = (c.card && c.card.flips) || [];
    if (c.side === "flat") assert.ok(!f.length || f[0].weeks_ago > 0, `${k}: flat this week, yet a flip this week`);
    for (let i = 1; i < f.length; i++) assert.notEqual(f[i].to, f[i - 1].to, `${k}: two flips to the same side in a row`);
  }
});

test("6. a gap that may be chance says so, never 'too few separate spells' or 'Coin flip'", () => {
  const c = code(MKT);
  assert.doesNotMatch(c, /too few separate spells/i);
  assert.doesNotMatch(c, /coin flip/i);
  assert.match(c, /could be chance/);
});

const CURTAIN = [/bootstrap/i, /block length/i, /\bdraws\b/i, /benjamini/i, /yekutieli/i, /false[- ]discovery/i, /\bFDR\b/];
test("10. the public COT data files and cot.html carry no test method", () => {
  for (const f of [...DATA_FILES, "cot.html"]) {
    const t = read(f);
    for (const re of CURTAIN) assert.doesNotMatch(t, re, `${f}: ${re}`);
  }
  assert.equal("method" in CX, false, "cot-analysis.json has no method block");
  assert.doesNotMatch(BUILDER, /^\s*"method": \{/m, "the builder writes none");
  assert.doesNotMatch(code(ANA_JS), /bootstrap/i);
  assert.doesNotMatch(HTML, /&minus;1 to \+1|-1 to \+1/, "no correlation scale line");
});

test("A. the card's 52-week contract rank fold is gone", () => {
  assert.doesNotMatch(PAGE, /Show the math|cot-math/);
  assert.doesNotMatch(HTML, /Show the math|\.cot-math/);
});

test("B. the method fold and note are source and sample lines only", () => {
  const note = HTML.match(/<div class="method-note" id="cot-method">[\s\S]*?<\/div>/)[0];
  assert.match(note, /CFTC Disaggregated Commitments of Traders/);
  assert.doesNotMatch(note, /percentile|Crowded means|52 reports|at or below/i);
  const sec = HTML.slice(HTML.indexOf('id="cx-method-sec"'), HTML.indexOf("<!-- Explainer -->"));
  assert.doesNotMatch(sec, /Four mistakes|<ol>|corrected|overlapping/i);
  assert.match(sec, /CFTC Disaggregated Commitments of Traders/);
});

test("8, 9. price figures name their series; save says why when there is no chart; the countdown is not live", () => {
  assert.match(PAGE, /price change, contract rolls removed/);
  assert.match(code(MKT), /price change, contract rolls removed/);
  assert.match(read("components/cot-chart.js"), /Futures close/);
  assert.match(read("components/cot-chart.js"), /if \(!M\) \{ note\('The chart has not loaded/);
  // one countdown since Nov 6: the release bar at the top, plain text, its state changes announced apart
  assert.doesNotMatch(HTML, /id="cot-countdown"/);
  assert.match(HTML, /<span class="cot-rel-t" id="cot-rel-t">/);
  assert.doesNotMatch(HTML.match(/<div class="cot-rel"[\s\S]*?<\/div>/)[0], /<span class="cot-rel-t"[^>]*aria-live/);
});

// ------------------------------------------------------------------ in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const FIX = (n) => fs.readFileSync(path.join(ROOT, "test/fixtures/funds", n));

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("browser at 390: the baked summary shows with scripts off, and gives way to the live report with them on", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const own = { "/data/cot.json": FIX("cot-2026-10-27.json"), "/data/cot-analysis.json": FIX("cot-analysis-2026-10-27.json"),
    "/data/cot-history.json": FIX("cot-history-2026-10-27.json") };
  try {
    for (const js of [false, true]) {
      const ctx = await browser.newContext({ javaScriptEnabled: js, serviceWorkers: "block", viewport: { width: 390, height: 844 } });
      const pg = await ctx.newPage();
      await pg.route("**/*", (r) => {
        const u = new URL(r.request().url());
        if (u.origin !== `http://127.0.0.1:${port}`) return r.abort();
        if (own[u.pathname]) return r.fulfill({ status: 200, contentType: "application/json", body: own[u.pathname] });
        return r.continue();
      });
      await pg.goto(`http://127.0.0.1:${port}/cot.html`, { waitUntil: "load" });
      if (!js) {
        assert.equal(await pg.isVisible("#cot-baked"), true, "scripts off: the baked summary is on screen");
        assert.match(await pg.textContent("#cot-baked"), /Managed-money positioning on/);
        assert.equal((await pg.textContent("#cg-verdict")).trim(), "", "no static verdict word");
      } else {
        await pg.waitForFunction(() => document.documentElement.classList.contains("cot-live"));
        assert.equal(await pg.isVisible("#cot-baked"), false, "the live report replaces it");
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
});
