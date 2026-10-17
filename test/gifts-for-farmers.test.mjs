/* /gifts-for-farmers: indexable, in the sitemap, linked from /rain-print and
 * the homepage's Christmas card, Christmas dates read from data/rain-print.json
 * (never written into the page), prices that match that file, no store names,
 * no em dashes.
 *
 *   node --test test/gifts-for-farmers.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "gifts-for-farmers.html", "utf8");
const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
const pctx = {}; pctx.window = pctx;
vm.runInNewContext(readFileSync(ROOT + "components/rain-print-promo.js", "utf8"), pctx);
const P = pctx.AgsistRainPromo;
const BODY = HTML.slice(HTML.indexOf("<main"), HTML.indexOf("</main>"));
const ARTICLE = HTML.slice(HTML.indexOf('<article class="gf">'), HTML.indexOf("</article>"));
const COPY = HTML.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");

test("indexable, canonical, in the sitemap, with Article, FAQPage and BreadcrumbList", () => {
  assert.match(HTML, /<meta name="robots" content="index, follow/);
  assert.ok(!/noindex/i.test(HTML));
  assert.match(HTML, /<link rel="canonical"\s+href="https:\/\/agsist\.com\/gifts-for-farmers">/);
  assert.match(HTML, /<title>Gifts for Farmers[^<]* \| AGSIST<\/title>/);
  assert.equal((readFileSync(ROOT + "sitemap.xml", "utf8").match(/<loc>https:\/\/agsist\.com\/gifts-for-farmers<\/loc>/g) || []).length, 1);
  const ld = JSON.parse(HTML.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  const types = ld["@graph"].map((g) => g["@type"]);
  for (const t of ["Article", "FAQPage", "BreadcrumbList"]) assert.ok(types.includes(t), t);
  const art = ld["@graph"].find((g) => g["@type"] === "Article");
  assert.equal(art.author.name, "Sigurd Lindquist");
  assert.equal(art.author.jobTitle, "Certified Crop Adviser (CCA)");
  // every FAQ in the structured data is on the page, word for word
  const faq = ld["@graph"].find((g) => g["@type"] === "FAQPage").mainEntity;
  const text = (s) => s.replace(/<[^>]+>/g, "").replace(/&rsquo;|&#39;/g, "'");
  for (const q of faq) {
    assert.ok(BODY.includes("<summary>" + q.name + "</summary>"), "question on the page: " + q.name);
    assert.ok(text(BODY).includes(q.acceptedAnswer.text.replace(/^The order-by dates[^.]*\. /, "")), "answer on the page: " + q.name);
  }
  for (const q of ["What do you get a farmer who has everything?", "What is the last day to order a Rain Print for Christmas?", "Can it ship straight to them?", "Can I give this year's rain?"])
    assert.ok(faq.some((x) => x.name === q), q);
  // the site chrome every page carries
  assert.match(HTML, /<!-- static-nav:header/);
  assert.match(HTML, /<!-- static-nav:footer/);
  assert.match(HTML, /components\/loader\.js\?v=\d+" defer/);
});

test("Christmas dates come from data/rain-print.json, never from the page", () => {
  const months = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
  assert.ok(!new RegExp("\\b(" + months + ")[a-z]* \\d{1,2}\\b").test(ARTICLE), "no month-day date written into the page");
  assert.ok(!/\b20\d\d\b/.test(ARTICLE), "no year written into the article");
  assert.match(HTML, /fetch\('\/data\/rain-print\.json'/);
  assert.match(HTML, /P\.xmasLine\(cfg, today\)/);
  assert.match(HTML, /rain-print-promo\.js\?v=4" defer/);
  // the shared line, against the shipped file
  const short = (iso) => P.xmasLine({ print_christmas_cutoff: iso, framed_christmas_cutoff: iso }, iso.slice(0, 4) + "-10-02").match(/by (\w+ \d+)/)[1];
  const pc = short(J.print_christmas_cutoff), fc = short(J.framed_christmas_cutoff);
  const y = J.print_christmas_cutoff.slice(0, 4);
  assert.equal(P.xmasLine(J, y + "-11-15"), "For Christmas delivery, order a framed print by " + fc + ", a print by " + pc + ".");
  assert.equal(P.xmasLine(J, y + "-10-01").startsWith("For Christmas delivery"), true, "Oct 1 counts");
  assert.equal(P.xmasLine(J, y + "-09-30"), "", "nothing before October");
  assert.equal(P.xmasLine(J, y + "-12-26"), "", "nothing after Christmas");
  assert.equal(P.xmasLine(J, J.framed_christmas_cutoff).includes(fc), true, "the framed cutoff day still counts");
  // the shipped file has the framed date first; the day after it, only the print date is offered
  assert.ok(J.framed_christmas_cutoff < J.print_christmas_cutoff);
  const after = new Date(Date.parse(J.framed_christmas_cutoff + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
  assert.equal(P.xmasLine(J, after), "For Christmas delivery, order a print by " + pc + ". A framed print ordered now ships after Christmas.");
  const late = new Date(Date.parse(J.print_christmas_cutoff + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
  assert.match(P.xmasLine(J, late), /ships after Christmas\. .*January\.$/);
  assert.equal(P.xmasLine({ ...J, print_christmas_cutoff: null }, y + "-11-15"), "", "a missing date gives no line, not a guess");
  for (const d of [y + "-11-15", after, late]) assert.ok(!/—|–|!|hurry|only \d|left|days? to go/i.test(P.xmasLine(J, d)), "plain, no pressure");
});

test("prices on the page match data/rain-print.json", () => {
  for (const k of ["digital", "print12x18", "framed12x18"]) {
    const m = HTML.match(new RegExp('data-gf-price="' + k + '">(\\d+)<'));
    assert.ok(m, k);
    assert.equal(+m[1], J[k], k);
  }
});

test("the homepage's Christmas card links here; the other cards still link /rain-print; /rain-print links here once", () => {
  const y = J.framed_christmas_cutoff.slice(0, 4);
  assert.equal(P.cardFor(J, y + "-11-20").href, "/gifts-for-farmers");
  assert.equal(P.cardFor(J, y + "-12-10").href, "/rain-print");
  assert.equal(P.cardFor(J, y + "-10-13").href, "/rain-print");
  assert.match(readFileSync(ROOT + "index.html", "utf8"), /rain-print-promo\.js\?v=4/, "the homepage loads the new copy");
  const rp = readFileSync(ROOT + "rain-print.html", "utf8");
  assert.equal((rp.match(/href="\/gifts-for-farmers"/g) || []).length, 1);
});

test("plain copy: no store names, no affiliate or outside shop links, no em dashes, nothing called archival", () => {
  const STORES = ["amazon", "walmart", "wal-mart", "tractor supply", "fleet farm", "farm & fleet", "farm and fleet", "rural king", "menards",
    "home depot", "lowe's", "lowes", "costco", "sam's club", "cabela", "bass pro", "scheels", "orscheln", "theisen", "bomgaars", "atwoods",
    "runnings", "big r", "etsy", "ebay", "target.com", "carhartt", "yeti", "stanley", "duluth trading", "l.l.bean", "harbor freight", "napa", "o'reilly", "autozone"];
  const low = COPY.toLowerCase();
  for (const s of STORES) assert.ok(!new RegExp("\\b" + s.replace(/[.*+?^${}()|[\]\\&']/g, "\\$&") + "\\b").test(low), "store or brand name: " + s);
  assert.ok(!/[—–]/.test(COPY), "no em or en dashes in the copy");
  assert.ok(!/archival|founding|affiliate|amzn|tag=|utm_/i.test(COPY));
  const outside = [...BODY.matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(outside, [], "no outside links in the article");
  assert.ok(!/\$\d/.test(BODY.replace(/\$<span data-gf-price[^>]*>\d+<\/span>/g, "")), "no dollar figure on the page but the three Rain Print prices");
});

test("Sig, 2026-10-14: a business logo may go on the print; shipping covers the 50 states", () => {
  const ld = JSON.parse(HTML.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  const biz = ld["@graph"].find((g) => g["@type"] === "FAQPage").mainEntity.find((q) => /business/.test(q.name)).acceptedAnswer.text;
  assert.match(biz, /Your business name stays off the print, though a logo can go on it, small next to the name, if you upload one\./);
  assert.match(BODY, /A logo can go on it, small next to the name, if you upload one\./);
  assert.ok(!/US addresses/.test(HTML), "no 'US addresses' that would take in Puerto Rico");
  assert.match(BODY, /Shipping is in the price, anywhere in the 50 states\./);
});

test("the Rain Print section links the page in words people search for and says only what is true of the example (2026-10-15)", () => {
  const sec = HTML.slice(HTML.indexOf('<section class="gf-rp"'), HTML.indexOf("</section>", HTML.indexOf('<section class="gf-rp"')));
  assert.match(sec, /<a href="\/rain-print">a custom rainfall print of that year<\/a>/, "a plain-text link with the search words");
  // the thumbnail is the real 2012 Ames example (img/rain-print-thumb.jpg), so the caption cannot call it made up; no year in the article (the Christmas test)
  assert.ok(!/made up/i.test(sec), "the example is real NOAA data");
  assert.match(sec, /<figcaption>An example: Ames, Iowa, in the drought year, from NOAA records\.<\/figcaption>/);
  // the page marks up to five days (rain-print.html, Mark a day)
  assert.match(readFileSync(ROOT + "rain-print.html", "utf8"), /You can mark up to 5 days/);
  assert.match(sec, /mark up to five days/);
  assert.ok(!/three days/.test(sec));
  assert.ok(!/NOAA weather station|CoCoRaHS|archival|poster|—/i.test(sec), "plain words: the weather station");
});
