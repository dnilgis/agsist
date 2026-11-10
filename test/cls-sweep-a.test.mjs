/* CLS sweep, Nov 10, 2026 (part a): /tariffs, /cattle-auction-prices, /harvest-price-tracker, /conditions, /hay-prices.
 * Sum of layout shifts before -> after, max of 390 and 1280, plain and saved (Chetek WI 54728):
 *   /tariffs                 0.430 -> 0.000  the status banner grew 54 to 144 px when the data landed
 *   /cattle-auction-prices   0.261 -> 0.000  the price glance started hidden and was shown at 2.5 s
 *   /harvest-price-tracker   0.249 -> 0.010  saved: the clear button, the state verdict and the state cards came in at 4 s
 *   /conditions              0.244 -> 0.003  1280: the map drew into an empty box and the verdict columns grew
 *   /hay-prices              0.215 -> 0.000  the AMS tables (1,200 to 1,800 px) replaced a short placeholder
 * Harness and throttling: test/cls-sweep-lib.mjs.
 *
 *   node --test test/cls-sweep-a.test.mjs
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { read, skip, MODES, open } from "./cls-sweep-lib.mjs";

const LIMIT = 0.04;
const PAGES = ["/tariffs", "/cattle-auction-prices", "/harvest-price-tracker", "/conditions", "/hay-prices"];

test("the holds are in the pages", () => {
  const T = read("tariffs.html"), C = read("cattle-auction-prices.html"), H = read("harvest-price-tracker.html"), D = read("conditions.html"), Y = read("hay-prices.html");
  assert.match(T, /\.tsb-note \{ min-height: [\d.]+em; \}/, "tariffs: the banner note holds its lines");
  assert.match(C, /\.sb-ghold \.sb-glance\{min-height:\d+px\}/, "cattle auction: the glance holds its room");
  assert.match(H, /classList\.add\('hp-st','hp-st-wait'\)/, "harvest tracker: a saved state is known before paint");
  assert.match(H, /\.hp-st-wait #pd-your\{min-height:\d+px\}/, "harvest tracker: the state cards' room is held");
  assert.equal((H.match(/classList\.remove\('hp-st-wait'\)|classList\.remove\('hp-st','hp-st-wait'\)/g) || []).length >= 4, true, "harvest tracker: every way out of the wait lets go of the hold");
  assert.match(D, /#cd-grid\{min-height:calc\(min\(100vw - 32px, 900px\) \* \.6381/, "conditions: the map box is held at usmap.js's ratio");
  assert.match(D, /\.cd-ver>div:last-child\{min-height:\d+px\}/, "conditions: the verdict column is held at desktop width");
  assert.match(Y, /<div id="hp-ams-live" class="hp-ams-wait"/, "hay: the AMS box starts held");
  assert.match(read("components/hay-ams.js"), /box\.classList\.remove\('hp-ams-wait'\)/, "hay: hay-ams.js lets go once it has drawn");
  // the page itself lets go after 8 s when the component script never runs (blocked or failed): proved in a browser below
  assert.match(Y, /<script>[^<]*setTimeout\(function\(\)\{var b=document\.getElementById\('hp-ams-live'\);if\(b\)b\.classList\.remove\('hp-ams-wait'\);\},8000\);<\/script>/, "hay: an inline 8 s release");
  assert.match(C, /setTimeout\(function\(\)\{if\(!a\.classList\.contains\('sb-wait'\)\)return;[^}]*a\.classList\.remove\('sb-wait','sb-gwait'\);\},8000\)/, "cattle auction: an inline 8 s release");
  // the age note keeps its own box and copy, held unseen until the data's date is known; no extra always-on line
  assert.match(T, /<div id="tariff-stale" class="tariff-stale" style="visibility:hidden;[^"]*"><\/div>/, "tariffs: the age note starts empty and unseen");
  assert.match(T, /#tariff-stale \{ min-height: \d+px; \}/, "tariffs: the age note's room is held");
  assert.doesNotMatch(T, /Trade policy can change in days/, "tariffs: no always-visible policy line");
  assert.match(T, /<tbody id="tariff-tbody" class="tt-wait">/, "tariffs: the rate rows start held");
  assert.equal((T.match(/classList\.remove\('tt-wait'\)/g) || []).length, 2, "tariffs: drawn, empty and failed all let go of the rows' hold");
});

let h = null;
before(async () => { if (!skip) h = await open(); });
after(async () => { if (h) await h.close(); });
/* a script that never loads: the holds still let go (the page's own 8 s release), so no screen-tall gap and no dead
   controls stay behind */
for (const w of [390, 1280]) {
  test(`/hay-prices at ${w}px with hay-ams.js blocked: the AMS box lets go of its hold`, { skip, timeout: 60000 }, async () => {
    const r = await h.probe("/hay-prices", w, false, /^\/components\/hay-ams\.js$/, 9500, () => {
      const b = document.getElementById("hp-ams-live");
      return { wait: b.classList.contains("hp-ams-wait"), mh: getComputedStyle(b).minHeight, text: b.textContent.trim().slice(0, 40) };
    });
    assert.equal(r.out.wait, false, JSON.stringify(r.out));
    assert.equal(r.out.mh, "0px", JSON.stringify(r.out));
    assert.match(r.out.text, /^Trades load after the first USDA read/, "the placeholder stays");
  });
  test(`/cattle-auction-prices at ${w}px with cattle-auction.js blocked: the empty box shows and the held controls go`, { skip, timeout: 60000 }, async () => {
    const r = await h.probe("/cattle-auction-prices", w, false, /^\/components\/cattle-auction\.js$/, 9500, () => {
      const vis = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== "none"; };
      return { wait: !!document.querySelector(".sb-wait, .sb-gwait"), empty: vis("sb-empty"), controls: vis("sb-controls"), glance: vis("sb-glance"), head: document.getElementById("sb-head").textContent };
    });
    assert.deepEqual(r.out, { wait: false, empty: true, controls: false, glance: false, head: "" });
  });
  /* a reader who chose a state (agsist-pd-state) and has no saved place: the hold is set before paint and let go */
  test(`/harvest-price-tracker at ${w}px with state IA chosen: layout shift under ${LIMIT}, no hold left`, { skip, timeout: 90000 }, async () => {
    const r = await h.probe("/harvest-price-tracker", w, { "agsist-pd-state": "IA" }, null, 9000, () => ({
      wait: document.documentElement.classList.contains("hp-st-wait"), st: document.documentElement.classList.contains("hp-st"),
      sel: document.getElementById("pd-state").value, verdict: getComputedStyle(document.getElementById("pd-verdict")).visibility }));
    assert.ok(r.cls < LIMIT, `layout shift ${r.cls.toFixed(4)}: ${r.who.join(" | ")}`);
    assert.deepEqual(r.out, { wait: false, st: true, sel: "IA", verdict: "visible" });
  });
}

for (const p of PAGES) for (const [w, saved] of MODES) {
  test(`${p} at ${w}px, ${saved ? "saved ZIP 54728" : "nothing saved"}: layout shift under ${LIMIT}`, { skip, timeout: 90000 }, async () => {
    const r = await h.cls(p, w, saved);
    assert.ok(r.cls < LIMIT, `layout shift ${r.cls.toFixed(4)}: ${r.who.join(" | ")}`);
  });
}
