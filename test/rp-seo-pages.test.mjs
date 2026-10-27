/* The two Rain Print search pages (2026-10-23): /birth-year-weather-gift and
 * /wedding-year-weather-gift. Indexable, in the sitemap and llms.txt, FAQ
 * schema matches the visible text, prices come from data/rain-print.json,
 * the print is said to be the whole year, links to /rain-print carry ?from=,
 * no em dashes, no store names, no outside links, no sponsor.
 *
 *   node --test test/rp-seo-pages.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
const SITEMAP = readFileSync(ROOT + "sitemap.xml", "utf8");
const LLMS = readFileSync(ROOT + "llms.txt", "utf8");
const plain = (s) => s.replace(/<[^>]+>/g, "").replace(/&rsquo;/g, "\u2019").replace(/&amp;/g, "&");

for (const [slug, from, other] of [["birth-year-weather-gift", "birthyear", "wedding-year-weather-gift"], ["wedding-year-weather-gift", "weddingyear", "birth-year-weather-gift"]]) {
  const HTML = readFileSync(ROOT + slug + ".html", "utf8");
  const BODY = HTML.slice(HTML.indexOf("<main"), HTML.indexOf("</main>"));
  test(slug + ": head, schema and registration", () => {
    const title = HTML.match(/<title>(.*?)<\/title>/)[1];
    assert.ok(title.length < 60, "title " + title.length);
    assert.ok(HTML.match(/name="description" content="([^"]*)"/)[1].length < 155);
    assert.match(HTML, /<meta name="robots" content="index, follow/);
    assert.match(HTML, new RegExp('<link rel="canonical"\\s+href="https://agsist\\.com/' + slug + '">'));
    // the share-image job may give the page its own card (scripts/build_share_images.py); either way it is a card that exists
    const og = (HTML.match(/og:image"\s+content="https:\/\/agsist\.com\/(img\/og\/[a-z0-9-]+\.jpg)/) || [])[1];
    assert.ok(og && existsSync(ROOT + og), "og:image is an AGSIST share card that exists: " + og);
    assert.equal((BODY.match(/<h1>/g) || []).length, 1);
    const ld = JSON.parse(HTML.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    assert.ok(ld["@graph"].find((g) => g["@type"] === "BreadcrumbList"));
    const faq = ld["@graph"].find((g) => g["@type"] === "FAQPage").mainEntity;
    assert.ok(faq.length >= 4 && faq.length <= 6);
    for (const q of faq) {
      assert.ok(BODY.includes("<summary>" + q.name + "</summary>"), q.name);
      assert.ok(plain(BODY).includes(q.acceptedAnswer.text), q.name);
    }
    assert.equal((SITEMAP.match(new RegExp("<loc>https://agsist\\.com/" + slug + "</loc>", "g")) || []).length, 1);
    assert.ok(LLMS.includes("https://agsist.com/" + slug));
  });
  test(slug + ": prices from the data, whole year said, links", () => {
    for (const k of ["digital", "print12x18", "framed12x18"]) {
      assert.equal(+HTML.match(new RegExp('data-gf-price="' + k + '">(\\d+)<'))[1], J[k], k);
    }
    assert.ok(!/\$\d/.test(BODY.replace(/\$<span data-gf-price[^>]*>\d+<\/span>/g, "")), "no other dollar figures");
    assert.match(BODY, /whole year, not one day/);
    assert.ok((BODY.match(/href="\/rain-print(\?from=[a-z]+)?"/g) || []).length >= 3);
    assert.ok(BODY.includes('href="/rain-print?from=' + from + '"'));
    assert.ok(BODY.includes('href="/' + other + '"'));
    for (const l of ["gifts-for-farmers", "farm-anniversary-gifts", "farmer-retirement-gifts"]) assert.ok(BODY.includes('href="/' + l + '"'), l);
    const imgs = [...BODY.matchAll(/<img [^>]*src="(\/img\/[^"]+)"[^>]* alt="([^"]+)"/g)];
    assert.ok(imgs.length >= 2);
    for (const [, src, alt] of imgs) { assert.ok(existsSync(ROOT + src.slice(1)), src); assert.ok(alt.length > 20); }
    assert.match(HTML, /fetch\('\/data\/rain-print\.json'/);
  });
  test(slug + ": plain copy", () => {
    const low = plain(BODY).toLowerCase();
    for (const s of ["amazon", "walmart", "etsy", "tractor supply", "ultimate"]) assert.ok(!low.includes(s), s);
    assert.ok(!/\u2014|&mdash;/.test(HTML), "no em dashes");
    assert.ok(!/archival|founding|affiliate|utm_|sponsor/i.test(BODY));
    assert.deepEqual([...BODY.matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1]), []);
    const words = plain(BODY).split(/\s+/).length;
    assert.ok(words > 900 && words < 1500, "words " + words);
  });
}
test("rain-print and gifts-for-farmers link to the new pages", () => {
  const rp = readFileSync(ROOT + "rain-print.html", "utf8"), g = readFileSync(ROOT + "gifts-for-farmers.html", "utf8");
  for (const s of ["birth-year-weather-gift", "wedding-year-weather-gift"]) {
    assert.ok(rp.includes('href="/' + s + '"'), s);
    assert.ok(g.includes('href="/' + s + '"'), s);
  }
});
