/* The gift-intent pages (2026-10-16): /farmer-retirement-gifts and
 * /farm-anniversary-gifts. Each answers its question with several ideas,
 * Rain Print as one option with Sig's interest said plainly, prices that
 * match data/rain-print.json, no store names or outside links, no em dashes,
 * no Christmas date written in (it comes from the data).
 *
 *   node --test test/gift-pages.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
const STORES = ["amazon", "walmart", "tractor supply", "fleet farm", "farm & fleet", "rural king", "menards", "home depot", "costco",
  "cabela", "scheels", "theisen", "bomgaars", "runnings", "etsy", "ebay", "carhartt", "yeti", "harbor freight"];

for (const slug of ["farmer-retirement-gifts", "farm-anniversary-gifts"]) {
  const HTML = readFileSync(ROOT + slug + ".html", "utf8");
  const BODY = HTML.slice(HTML.indexOf("<main"), HTML.indexOf("</main>"));
  const plain = (s) => s.replace(/<[^>]+>/g, "").replace(/&rsquo;/g, "\u2019").replace(/&amp;/g, "&");
  test(slug + ": indexable, canonical, byline, share card, FAQ matches the page", () => {
    assert.match(HTML, /<meta name="robots" content="index, follow/);
    assert.match(HTML, new RegExp('<link rel="canonical"\\s+href="https://agsist\\.com/' + slug + '">'));
    assert.match(HTML, new RegExp('og:image"\\s+content="https://agsist\\.com/img/og/' + slug + "\\.jpg"));
    assert.match(BODY, /Sigurd Lindquist, Certified Crop Adviser \(CCA\)/);
    const ld = JSON.parse(HTML.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    const art = ld["@graph"].find((g) => g["@type"] === "Article");
    assert.equal(art.author.jobTitle, "Certified Crop Adviser (CCA)");
    const faq = ld["@graph"].find((g) => g["@type"] === "FAQPage").mainEntity;
    assert.ok(faq.length >= 3);
    for (const q of faq) {
      assert.ok(BODY.includes("<summary>" + q.name + "</summary>"), q.name);
      assert.ok(plain(BODY).includes(q.acceptedAnswer.text), "answer on page: " + q.name);
    }
    assert.match(HTML, /<!-- static-nav:header/);
    assert.match(HTML, /href="\/gifts-for-farmers"/);
  });
  test(slug + ": Rain Print is one idea of several, disclosed, priced from the data", () => {
    const items = (BODY.match(/<li><b>/g) || []).length;
    assert.ok(items >= 5, "several ideas besides the print: " + items);
    assert.match(BODY, /This is the one idea on this page I sell; nothing else here earns me anything\./);
    for (const k of ["digital", "print12x18", "framed12x18"]) {
      const m = HTML.match(new RegExp('data-gf-price="' + k + '">(\\d+)<'));
      assert.equal(+m[1], J[k], k);
    }
    assert.ok(!/\$\d/.test(BODY.replace(/\$<span data-gf-price[^>]*>\d+<\/span>/g, "")), "no other dollar figures");
    const months = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
    assert.ok(!new RegExp("\\b(" + months + ")[a-z]* \\d{1,2}\\b").test(BODY), "no date written in");
    assert.match(HTML, /fetch\('\/data\/rain-print\.json'/);
    assert.match(HTML, /'rain_print_promo_click'/);
  });
  test(slug + ": plain copy, no stores, no outside links, no sponsor", () => {
    const low = plain(BODY).toLowerCase();
    for (const s of STORES) assert.ok(!low.includes(s), s);
    assert.ok(!/\u2014|&mdash;/.test(HTML), "no em dashes");
    assert.ok(!/archival|founding|affiliate|utm_|sponsor/i.test(BODY));
    assert.deepEqual([...BODY.matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1]), []);
  });
}
