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
import { readFileSync, existsSync } from "node:fs";
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
    assert.match(BODY, /Sigurd Lindquist, CCA/);
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

for (const slug of ["gifts-for-farmers", "farmer-retirement-gifts", "farm-anniversary-gifts"]) {
  const HTML = readFileSync(ROOT + slug + ".html", "utf8");
  test(slug + ": Rain Print leads with a real photo of a test print, captioned honestly (2026-10-18)", () => {
    const sec = HTML.slice(HTML.indexOf('<section class="gf-rp"'), HTML.indexOf("</section>", HTML.indexOf('<section class="gf-rp"')));
    assert.ok(HTML.indexOf('<section class="gf-rp"') < HTML.indexOf("<h2", HTML.indexOf("<main")) + 400, "the print section comes first");
    assert.ok(!/rain-print-thumb|[Mm]ockup/.test(sec), "no mockup in the gift guide");
    const fig = sec.match(/<figure class="gf-fig">(.*?)<\/figure>/s)[1];
    const srcs = [...fig.matchAll(/\/img\/photos\/(rain-print-photo-[a-z0-9-]+\.(?:jpg|webp))/g)].map((m) => m[1]);
    assert.ok(srcs.length >= 4, "webp and jpg at two widths");
    for (const s of srcs) assert.ok(existsSync(ROOT + "img/photos/" + s), s);
    const alt = fig.match(/ alt="([^"]*)"/)[1];
    assert.ok(alt.length < 125, "alt under 125: " + alt.length);
    assert.ok(!/^(photo|image|picture) of/i.test(alt));
    assert.match(fig, /<img [^>]*width="\d+" height="\d+"/);
    assert.match(fig, /<figcaption>My test print of [^<]* It is shown without the white mat that comes with a framed print\.<\/figcaption>/);
  });
}
