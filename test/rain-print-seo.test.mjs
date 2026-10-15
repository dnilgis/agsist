// 2026-10-15: Rain Print, made findable. The search words are in the head, the Product
// schema says only what Sig has decided (made to order, free US shipping to the 50 states,
// no returns once printed, $15 reprint if lost or damaged), and every FAQ is in the
// structured data word for word.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ROOT = new URL("../", import.meta.url).pathname;
const HTML = readFileSync(ROOT + "rain-print.html", "utf8");
const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
const LD = JSON.parse(HTML.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
const PROD = LD["@graph"].find((g) => g["@type"] === "Product");
const meta = (k) => HTML.match(new RegExp(k + '\\s+content="([^"]*)"'))[1];

test("the head carries the words buyers type: rainfall, rain and snow, a name and dates, prices, a gift", () => {
  const title = HTML.match(/<title>([^<]*)<\/title>/)[1];
  assert.ok(title.length <= 65, "title fits a results line: " + title.length);
  assert.match(title, /rainfall/i);
  assert.match(title, /town and year/);
  const d = meta('name="description"');
  assert.ok(d.length >= 70 && d.length <= 170, "description length " + d.length);
  for (const w of [/rain and snow/, /a name and dates/, /gift/i, new RegExp("\\$" + J.digital), new RegExp("\\$" + J.print12x18)]) assert.match(d, w);
  assert.equal(meta('property="og:title"'), meta('name="twitter:title"'));
  assert.equal(meta('property="og:description"'), meta('name="twitter:description"'));
  assert.match(meta('property="og:description"'), /rain and snow/);
  assert.match(meta('property="og:description"'), /gift/i);
  assert.ok(meta('property="og:description"').length <= 170);
});

test("Product: brand, seller, a sku per offer, made to order, free shipping to all 50 states, the page's return policy, no ratings", () => {
  assert.deepEqual(PROD.brand, { "@type": "Brand", name: "AGSIST" });
  assert.ok(PROD.image, "an image");
  assert.ok(!PROD.aggregateRating && !PROD.review, "no reviews or ratings: none exist");
  const skus = PROD.offers.map((o) => o.sku);
  assert.equal(new Set(skus).size, 3, "one sku per offer: " + skus);
  for (const o of PROD.offers) {
    assert.equal(o.availability, "https://schema.org/MadeToOrder");
    assert.equal(o.priceCurrency, J.currency);
    assert.equal(o.seller.name, "Sigurd Lindquist");
    assert.equal(o.seller.affiliation.name, "AGSIST");
    assert.ok(!/crop insurance agent/i.test(JSON.stringify(o.seller)));
  }
  const [file, print, framed] = PROD.offers;
  assert.equal(file.price, String(J.digital));
  assert.ok(!file.shippingDetails, "the digital file ships nothing");
  for (const o of [print, framed]) {
    const s = o.shippingDetails;
    assert.equal(s.shippingRate.value, "0", "shipping included");
    assert.equal(s.shippingRate.currency, "USD");
    assert.equal(s.shippingDestination.addressCountry, "US");
    assert.equal(new Set(s.shippingDestination.addressRegion).size, 50, "all 50 states");
    for (const st of ["AK", "HI", "WI"]) assert.ok(s.shippingDestination.addressRegion.includes(st), st);
    assert.ok(!s.shippingDestination.addressRegion.includes("PR"), "Puerto Rico is undecided");
    const p = o.hasMerchantReturnPolicy;
    assert.equal(p.returnPolicyCategory, "https://schema.org/MerchantReturnNotPermitted", "made with their name: no returns once printed");
    assert.equal(p.applicableCountry, "US");
    assert.match(p.description, /Full refund if you change your mind before I print/);
    assert.match(p.description, new RegExp("Lost or damaged in shipping: reprinted or reframed for \\$" + J.reprint_fee + "\\."));
    // the policy says what the visible FAQ says
    const faq = HTML.match(/<details><summary>What if something[\s\S]*?<\/details>/)[0];
    assert.match(faq, /If you change your mind before I print, I&rsquo;ll refund you in full/);
    assert.match(faq, new RegExp("reprint or reframe it for \\$" + J.reprint_fee));
  }
});

test("the four buyer questions are on the page and in FAQPage word for word, and no older question was dropped", () => {
  const dec = (t) => t.replace(/<a href="mailto:[^"]+">([^<]*)<\/a>/g, "$1").replace(/&rsquo;/g, "’").replace(/&amp;/g, "&");
  const shown = [...HTML.matchAll(/<details><summary>(.*?)<\/summary><p>(.*?)<\/p><\/details>/g)].map((m) => [dec(m[1]), dec(m[2])]);
  const faq = LD["@graph"].find((g) => g["@type"] === "FAQPage").mainEntity.map((q) => [q.name, q.acceptedAnswer.text]);
  assert.deepEqual(faq, shown);
  const names = faq.map((q) => q[0]);
  for (const q of [
    "Can I make one for our wedding year or the year a child was born?",
    "Does it show snow?",
    "Can I see the year’s total for free?",
    "Is it a good gift for a farmer who has everything?",
    "Where does the rain data come from?", "What does “a usual year” mean?", "What if the station missed days?",
    "Can I give this year’s print for Christmas?", "Can you ship it straight to them with a note?", "How big is it?",
    "When will it arrive?", "Can a business order a set?", "What if something’s wrong with it?", "What is the small square in the corner?",
  ]) assert.ok(names.includes(q), q);
  const snow = faq.find((q) => q[0] === "Does it show snow?")[1];
  assert.match(snow, /above the line, never below it/, "snow draws above the line only (Sig, 2026-10-13)");
  assert.ok(!/[—]/.test(faq.flat().join(" ")), "no em dashes");
  assert.ok(!/\d{1,2}(st|nd|rd|th)?,? 20\d\d|Dec \d/.test(faq.find((q) => /farmer who has everything/.test(q[0]))[1]), "no hard-coded Christmas date: the order cards carry it");
});

test("the first screen says what people search for: rain and snow in the title line, a gift, a wedding or birth year, free to draw", () => {
  const h1 = HTML.match(/<h1>([^<]*)<\/h1>/)[1];
  assert.match(h1, /rain and snow/, "the H1 names snow too: " + h1);
  assert.match(h1, /printed for the wall/, "Sig's line stays");
  const lede = HTML.match(/<p class="rp-lede">([^<]*)<\/p>/)[1];
  for (const w of [/rain and snow/, /weather station/, /gift for a farmer/, /married/, /child was born/, /free/]) assert.match(lede, w);
  assert.ok(!/[—]|CoCoRaHS|archival|poster/i.test(h1 + lede), "no em dash, no program name, no archival, no poster");
});
