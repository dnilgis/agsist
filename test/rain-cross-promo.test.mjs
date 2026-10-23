/* Cross-promotion rule (Sig, Oct 13): at most one promo a page, after the
 * main content. Oct 16: state rain pages carry the rain gauge line; county
 * rain pages keep their Rain Print block only; town cash-bid pages carry the
 * Rain Print gift line from Nov 1 to Dec 24 (scripts/build_cash_bid_pages.py
 * rain_print_line, checked by its --selftest).
 *
 *   node --test test/rain-cross-promo.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const slots = (h) => (h.match(/data-rain-print-promo/g) || []).length;

test("each state rain page: one gauge line, after the table, with its script", () => {
  const states = readdirSync(ROOT + "rain").filter((f) => f.endsWith(".html"));
  assert.equal(states.length, 50);
  for (const f of states) {
    const h = readFileSync(ROOT + "rain/" + f, "utf8");
    assert.equal(slots(h), 1, f);
    assert.ok(h.includes('data-rain-print-promo="gauge"'), f);
    assert.ok(h.indexOf('data-rain-print-promo="gauge"') > h.indexOf("</table>"), f + ": after the main table");
    assert.match(h, /rain-print-promo\.js\?v=\d+" defer/);
  }
});

test("county rain pages carry no promo slot (their Rain Print block is the one)", () => {
  const dir = ROOT + "rain/iowa/";
  for (const f of readdirSync(dir).slice(0, 40)) assert.equal(slots(readFileSync(dir + f, "utf8")), 0, f);
});

test("town cash-bid pages carry at most one promo slot", () => {
  const dir = ROOT + "cash-bids/";
  let n = 0;
  for (const st of readdirSync(dir)) {
    if (!statSync(dir + st).isDirectory()) continue;
    for (const f of readdirSync(dir + st)) {
      if (!f.endsWith(".html")) continue;
      const h = readFileSync(dir + st + "/" + f, "utf8");
      assert.ok(slots(h) <= 1, st + "/" + f);
      // the gift line in its season, else (Oct 23) the "see" line: never both, never anything else
      if (slots(h)) { assert.match(h, /<p class="rp-promo" data-rain-print-promo(="see")? hidden><\/p>/); assert.match(h, /rain-print-promo\.js\?v=\d+" defer/); }
      n++;
    }
  }
  assert.ok(n > 500);
  const py = readFileSync(ROOT + "scripts/build_cash_bid_pages.py", "utf8");
  assert.match(py, /RP_PROMO_SEASON = \(\(11, 1\), \(12, 24\)\)/);
  assert.match(py, /RP_SEE_SLOT = '<p class="rp-promo" data-rain-print-promo="see" hidden><\/p>'/);
});

test("markets and futures pages: one Rain Print gift line, after the FAQ, with its script (Oct 17)", () => {
  // the highest-traffic pages after /cash-bids and / (data/audience.json, 28 days)
  const pages = { "markets.html": 'class="mkt-faq"', "corn-futures-prices.html": 'class="faq-wrap"',
    "soybean-futures-prices.html": 'class="faq-wrap"', "wheat-futures-prices.html": 'class="faq-wrap"',
    "cattle-futures-prices.html": 'class="faq-wrap"' };
  for (const [f, faq] of Object.entries(pages)) {
    const h = readFileSync(ROOT + f, "utf8");
    assert.equal(slots(h), 1, f + ": exactly one promo slot");
    assert.match(h, /<p class="rp-promo" data-rain-print-promo hidden><\/p>/, f + ": the gift line, hidden until the script fills it");
    const at = h.indexOf("data-rain-print-promo");
    assert.ok(h.indexOf(faq) > 0 && at > h.indexOf(faq), f + ": after the FAQ");
    assert.ok(at < h.indexOf("</main>"), f + ": inside main");
    assert.match(h, /rain-print-promo\.js\?v=\d+" defer/, f);
    assert.ok(!/data-sponsor-slot/.test(h), f + ": no sponsor slot alongside");
  }
});

// Oct 19 (Sig, monetization fixes): hail pages keep one cross-promo each. The 51 state hail pages carry the
// gauge line (scripts/generate_hail_states.py); /hail-map already carries its one Rain Print line, so the
// gauge line is not added there on top of it.
const inMain = (h) => h.slice(h.indexOf("<main"), h.indexOf("</main>"));
test("each state hail page: one gauge line after the content, and no Rain Print promo beside it", () => {
  const states = readdirSync(ROOT + "hail-map").filter((f) => f.endsWith(".html"));
  assert.equal(states.length, 51);
  for (const f of states) {
    const m = inMain(readFileSync(ROOT + "hail-map/" + f, "utf8"));
    assert.equal(slots(m), 1, f);
    assert.ok(m.includes('<p class="rp-promo" data-rain-print-promo="gauge" hidden></p>'), f);
    assert.ok(m.indexOf('data-rain-print-promo="gauge"') > m.indexOf('class="hs-src"'), f + ": after the content");
    assert.ok(!/href="\/rain-print/.test(m), f + ": no second promo");
  }
  assert.match(readFileSync(ROOT + "scripts/generate_hail_states.py", "utf8"), /data-rain-print-promo=\\"gauge\\"/);
});
test("/hail-map: one cross-promo, the Rain Print line after the FAQ, no gauge line stacked on it", () => {
  const m = inMain(readFileSync(ROOT + "hail-map.html", "utf8"));
  assert.equal((m.match(/class="rp-promo"/g) || []).length, 1);
  assert.equal(slots(m), 0, "no gauge slot on top of the Rain Print line");
  assert.ok(!/href="\/rain-gauge"/.test(m));
});
