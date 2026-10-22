/* Rain Print, Sig's decisions of 2026-10-18: shipping damage or loss replaced
 * free, his phone near "Made by", no promise of photos, no sponsor link on
 * Rain Print pages, the business sample line, the paper named plainly.
 *
 *   node --test test/rain-print-sig-oct18.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const RP = read("rain-print.html"), BIZ = read("rain-print-business.html"), GIFT = read("rp-gift.html");
const JS = read("components/rain-print.js"), J = JSON.parse(read("data/rain-print.json"));
const PAGES = [["rain-print.html", RP], ["rain-print-business.html", BIZ], ["rp-gift.html", GIFT]];

test("1. lost or damaged in shipping: replaced free, same serial number, no $15 anywhere", () => {
  for (const [n, h] of PAGES) assert.ok(!/\$15\b/.test(h), n + " says no $15");
  assert.ok(!/\$15\b/.test(JSON.stringify(J).replace(/was \$15/g, "")), "the data file names no fee");
  assert.equal(J.reprint_fee, undefined);
  assert.ok(!/reprint_fee/.test(JS));
  const ld = JSON.parse(RP.match(/<script type="application\/ld\+json">(\{"@context"[\s\S]*?)<\/script>/)[1]);
  const offers = ld["@graph"].flatMap((g) => [].concat(g.offers || [])).filter((o) => o.hasMerchantReturnPolicy && o.shippingDetails);
  assert.ok(offers.length >= 2);
  for (const o of offers) assert.match(o.hasMerchantReturnPolicy.description, /Lost or damaged in shipping: reprinted or reframed free, with the same serial number\./);
  const faq = ld["@graph"].find((g) => g["@type"] === "FAQPage").mainEntity.find((q) => /What if something/.test(q.name)).acceptedAnswer.text;
  assert.match(faq, /Either way I’ll reprint or reframe it free, with the same serial number\./);
});

test("2. the phone line sits by Made by on both pages, with a tel link and the email as is", () => {
  const line = /Questions\? Call or text Sig at <a href="tel:\+17157972428"[^>]*>715-797-2428<\/a>, or write to <a href="mailto:sig@agsist\.com"[^>]*>sig@agsist\.com<\/a>\./;
  assert.match(RP, line); assert.match(BIZ, line);
  const i = RP.indexOf('id="rp-madeby"'), k = RP.indexOf('id="rp-call"');
  assert.ok(i > 0 && k > i && k - i < 1200, "right under Made by Sig Lindquist in Chetek");
  // Sig, Oct 18: no name at the top; the business page keeps the call line right under its H1
  const b = BIZ.indexOf("<h1"), c = BIZ.indexOf('id="rbz-call"');
  assert.ok(b > 0 && c > b && c - b < 300, "right under the H1");
});

test("3. no promise of photos; the Mockup tag stays on the mockup", () => {
  for (const [n, h] of PAGES) assert.ok(!/Photos of real prints coming soon/.test(h), n);
  // the matted view stays a mockup until mat photos come (Sig, 2026-10-18: mats arrive Monday)
  assert.match(RP, /<span class="rp-ex-tag" aria-hidden="true">Mockup<\/span><\/div><figcaption>Mockup of a framed print\. Photos with the white mat coming soon\.<\/figcaption>/);
  // the business page now shows a real photo, captioned truthfully (test/rain-print-photos.test.mjs)
  assert.match(BIZ, /<figcaption>A Rain Print of Chetek, Wisconsin, 2025, framed in Chetek\. This test print is shown without its white mat\.<\/figcaption>/);
  assert.ok(!/wall-shop/.test(BIZ), "no mockup left on the business page");
});

test("4. no Sponsor or Advertise link on Rain Print pages, done in the page", () => {
  const css = '#site-footer a[href^="/sponsor"],#site-footer a[href^="/sponsor"]+.footer-sep,#site-footer #footer-adspace{display:none!important}';
  for (const [n, h] of [["rain-print.html", RP], ["rain-print-business.html", BIZ]]) {
    assert.ok(h.includes(css), n + " hides the footer's sponsor link and strip");
    assert.ok(h.indexOf(css) < h.indexOf("</style>"), n + ": in the head styles");
  }
  // the live footer's link and strip are what that rule matches
  const foot = read("components/footer.html");
  // 2026-10-18 footer: Advertise sits under Work with us; the PRF sponsor link there is marked so
  // loader.js hides it wherever the page hides /sponsor (test/nav-full-oct18.test.mjs checks it in a browser)
  assert.match(foot, /<a href="\/sponsor" data-sponsor-link[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Advertise<\/a>/);
  assert.match(foot, /<a href="\/prf-sponsor" data-sponsor-link>/);
  assert.match(foot, /id="footer-adspace"/);
  assert.ok(!/href="\/sponsor/.test(GIFT), "the gift card page has no footer or sponsor link");
});

test("5. the business sample offer is under the prices", () => {
  const s = BIZ.indexOf('id="prices"'), x = BIZ.indexOf('id="christmas"'), t = BIZ.indexOf('id="rbz-sample"');
  assert.ok(s > 0 && t > s && t < x);
  // 2026-10-20: the offer links to the order box and says how Sig matches the sample (test/rain-print-business.test.mjs)
  assert.match(BIZ, /id="rbz-sample">Want to see one first\? <a href="\/rain-print#rp-buy" data-rbz-cta="sample">Order one at the regular price<\/a> and I take it off your invoice when you order 10 or more\. When you pay, tick <b>This is a gift<\/b> and put your business name in the note, so I can match it to your order\.<\/p>/);
  const tiers = J.business_tiers || [];
  if (tiers.length) assert.ok(tiers.some((r) => r.min === 10), "10 is where the discount starts");
});

test("paper: heavy, textured cotton fine-art paper, no brand, no archival or pigment claim, the sun line kept", () => {
  for (const [n, h] of PAGES) {
    assert.ok(!/matte paper/i.test(h), n + " no longer says matte paper");
    assert.ok(!/archival|pigment|fade-proof|fade proof|museum[- ]grade|giclee|giclée|Hahnem|Canson|Epson|Moab|Red River/i.test(h), n + " makes no ink or brand claim");
  }
  assert.match(RP, /It&rsquo;s printed on 13 x 19 inch heavy, textured cotton fine-art paper, hung sideways/);
  assert.match(RP, /"text": "It’s printed on 13 x 19 inch heavy, textured cotton fine-art paper, hung sideways/);
  assert.match(RP, /"name": "Print on 13 x 19 in heavy, textured cotton fine-art paper, unframed, shipping included"/);
  assert.match(RP, /drawn and printed on 13 x 19 in heavy, textured cotton fine-art paper with a name and dates\./);
  assert.match(RP, /<li>Printed on 13 x 19 in heavy, textured cotton fine-art paper; fits/);
  assert.match(BIZ, /printed on 13 x 19 heavy, textured cotton fine-art paper for the wall\./);
  assert.match(BIZ, /A print on 13 x 19 heavy, textured cotton fine-art paper, or framed/);
  assert.match(GIFT, /'A print of the whole year on 13 x 19 heavy, textured cotton fine-art paper\.'/);
  assert.match(RP, /Keep a print out of direct sun; the inks fade in strong light\./);
});

test("copy: no em dashes in the new lines, and every page loads the bumped engine", () => {
  for (const id of ["rp-call", "rbz-call", "rbz-sample"]) {
    const h = id === "rp-call" ? RP : BIZ, m = h.match(new RegExp('id="' + id + '">[^\\n]*'));
    assert.ok(m && !/—/.test(m[0]), id);
  }
  for (const [n, h] of PAGES) assert.match(h, /\/components\/rain-print\.js\?v=79"/, n);
  assert.match(read("components/rain-county-print.js"), /ENGINE = '\/components\/rain-print\.js\?v=79'/);
});
