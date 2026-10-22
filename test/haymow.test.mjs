/* The Haymow (haymow.html): hay for sale and wanted, posted by readers.
 * Worker v5.30 routes (scripts/test_hay_worker.mjs, run here so `node --test`
 * covers it), the page logic in components/haymow.js, the digest hook in
 * scripts/form_digest.py, and the page rules: indexable with title,
 * description, FAQ and structured data, listings and contacts never in the
 * HTML, no name at the top, no em dashes, no paid placement.
 *
 *   node --test test/haymow.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const H = createRequire(import.meta.url)(ROOT + "components/haymow.js");
const page = read("haymow.html");

test("worker routes (scripts/test_hay_worker.mjs)", () => {
  const out = execFileSync(process.execPath, [ROOT + "scripts/test_hay_worker.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(out, /hay board worker: \d+ checks passed/);
});

test("form digest selftest covers the Haymow mail", () => {
  const out = execFileSync("python3", [ROOT + "scripts/form_digest.py", "--selftest"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(out, /ok {3}hay: no phone or email in the mail/);
  assert.match(out, /form_digest: all checks pass/);
});

test("indexable page: title, description, canonical, FAQ and structured data", () => {
  assert.match(page, /<title>The Haymow: Hay for Sale and Wanted Near You \| AGSIST<\/title>/);
  assert.match(page, /<link rel="canonical"\s+href="https:\/\/agsist\.com\/haymow">/);
  assert.doesNotMatch(page, /noindex/);
  const d = /<meta name="description" content="([^"]+)">/.exec(page);
  assert.ok(d && d[1].length >= 70 && d[1].length <= 170, d && d[1]);
  const ld = JSON.parse(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/.exec(page)[1]);
  const types = ld["@graph"].map((x) => x["@type"]);
  assert.deepEqual(types, ["WebPage", "FAQPage", "BreadcrumbList"]);
  // the JSON-LD name is the title without the suffix (night SEO audit, Oct 19, 2026; was the H1 wording)
  assert.equal(ld["@graph"][0].name, "The Haymow: Hay for Sale and Wanted Near You");
  /* every FAQ answer in the structured data is on the page */
  for (const q of ld["@graph"][1].mainEntity) {
    assert.ok(page.includes("<summary>" + q.name + "</summary>"), q.name);
    assert.ok(page.includes(q.acceptedAnswer.text.replace(/'/g, "'")), q.name);
  }
  assert.match(page, /<h1>The Haymow: hay for sale and wanted near you<\/h1>/);
  assert.match(read("sitemap.xml"), /<loc>https:\/\/agsist\.com\/haymow<\/loc>/);
  assert.match(read("hay-prices.html"), /<a href="\/haymow">The Haymow<\/a>/);
});

test("no contacts or listings in the HTML", () => {
  const body = page.replace(/<head[\s\S]*?<\/head>/, "");
  assert.doesNotMatch(body, /href="tel:|href="mailto:/, "no phone or mail links in the page itself");
  assert.doesNotMatch(body, /\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/, "no phone numbers");
  assert.doesNotMatch(body.replace(/<script[\s\S]*?<\/script>/g, ""), /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i, "no email addresses");
  assert.match(page, /<ul id="hb-list" class="hb-list"><\/ul>/, "the list is empty until the page loads it");
  assert.match(page, /name="_gotcha"/, "honeypot field");
  assert.match(page, /<script src="\/components\/haymow\.js\?v=3"><\/script>/);
});

test("page copy rules: no em dash, name only at the end, no paid spots", () => {
  assert.ok(!page.includes("—") && !read("components/haymow.js").includes("—"), "no em dashes");
  const h1 = page.indexOf("<h1");
  assert.ok(!/Sigurd Lindquist/.test(page.slice(page.indexOf("<body"), h1 + 3000).replace(/<p class="by-end"[\s\S]*?<\/p>/, "")));
  assert.match(page, /<p class="by-end"[^>]*>Made by <a href="\/about">Sigurd Lindquist, CCA<\/a>, Chetek, Wisconsin\.<\/p>/);
  assert.doesNotMatch(page, /sponsor-slot|data-sponsor|Sponsored/i);
  assert.match(page, /No cut, no fees\./);
  assert.match(page, /Posts come down in 30 days/);
  assert.match(page, /Buyer beware/);
});

test("price per ton: per-bale converts only with a weight, math spelled out", () => {
  assert.deepEqual(H.perTon(85, "bale", 1200), { ton: 141.67, perBale: 85, math: "$85 a bale x 2,000 / 1,200 lb" });
  assert.equal(H.perTon(85, "bale", null), null);
  assert.equal(H.perTon(null, "bale", 1200), null);
  assert.deepEqual(H.perTon(180, "ton", 45), { ton: 180, perBale: 4.05, math: "$180 a ton x 45 lb / 2,000" });
  assert.deepEqual(H.perTon(180, "ton", null), { ton: 180, perBale: null, math: "" });
  const html = H.priceHtml({ kind: "sale", price: 85, unit: "bale", weight: 1200 });
  assert.match(html, /\$85 a bale/);
  assert.match(html, /about \$141\.67 a ton/);
  assert.match(html, /\$85 a bale x 2,000 \/ 1,200 lb, the poster's weight/);
  assert.match(H.priceHtml({ kind: "sale", price: 85, unit: "bale", weight: null }), /No bale weight given, so no price per ton/);
  assert.match(H.priceHtml({ kind: "sale", price: null }), /Call for price/);
});

test("distance sort: nearest first, no pin last, newest breaks ties", () => {
  const here = { lat: 45.31, lng: -91.65 };
  const rows = [
    { id: "far", lat: 42.03, lng: -93.62, ts: 3 },
    { id: "nopin", lat: null, lng: null, ts: 9 },
    { id: "near", lat: 45.5, lng: -91.74, ts: 1 },
    { id: "here-old", lat: 45.31, lng: -91.65, ts: 1 },
    { id: "here-new", lat: 45.31, lng: -91.65, ts: 2 },
  ];
  assert.deepEqual(H.sortRows(rows, here).map((r) => r.id), ["here-new", "here-old", "near", "far", "nopin"]);
  assert.deepEqual(H.sortRows(rows, null).map((r) => r.id), ["nopin", "far", "here-new", "near", "here-old"]);
  const s = H.sortRows(rows, here);
  assert.equal(s.find((r) => r.id === "near").mi, 14);
  assert.deepEqual(H.filterRows(s, "both", 50).map((r) => r.id), ["here-new", "here-old", "near"]);
  assert.deepEqual(H.filterRows(s, "both", 0).length, 5);
  assert.deepEqual(H.filterRows([{ kind: "sale", mi: 1 }, { kind: "wanted", mi: 2 }], "wanted", 0).map((r) => r.kind), ["wanted"]);
  assert.ok(Math.abs(H.distMi(45.31, -91.65, 42.03, -93.62) - 245) < 3);
});

test("form validation matches the worker's rules", () => {
  const ok = { kind: "sale", zip: "54728", product: "alfalfa", bale: "round", count: "50", price: "60", unit: "bale", phone: "715-555-0101", delivery: "no" };
  let v = H.validatePost(ok);
  assert.deepEqual(v.errors, {});
  assert.equal(v.body.count, 50); assert.equal(v.body.price, 60); assert.equal(v.body.delivery, "no");
  const bad = (patch) => Object.keys(H.validatePost(Object.assign({}, ok, patch)).errors);
  assert.deepEqual(bad({ zip: "547" }), ["zip"]);
  assert.deepEqual(bad({ product: "" }), ["product"]);
  assert.deepEqual(bad({ bale: "" }), ["bale"]);
  assert.deepEqual(bad({ count: "" }), ["count"]);
  assert.deepEqual(bad({ count: "2.5" }), ["count"]);
  assert.deepEqual(bad({ price: "-1" }), ["price"]);
  assert.deepEqual(bad({ unit: "" }), ["unit"]);
  assert.deepEqual(bad({ weight: "5" }), ["weight"]);
  assert.deepEqual(bad({ rfv: "999" }), ["rfv"]);
  assert.deepEqual(bad({ cp: "55" }), ["cp"]);
  assert.deepEqual(bad({ delivery: "yes", miles: "5000" }), ["miles"]);
  assert.deepEqual(bad({ note: "x".repeat(301) }), ["note"]);
  assert.deepEqual(bad({ note: "see www.hay.biz" }), ["note"]);
  assert.deepEqual(bad({ note: "call 715 555 0100" }), ["note"]);
  assert.deepEqual(bad({ note: "a@b.com" }), ["note"]);
  assert.deepEqual(bad({ name: "cheaphay.com" }), ["name"]);
  assert.deepEqual(bad({ phone: "" }), ["phone"]);
  assert.deepEqual(bad({ phone: "555" }), ["phone"]);
  assert.deepEqual(bad({ phone: "", email: "nope" }), ["email"]);
  assert.deepEqual(bad({ phone: "", email: "a@example.com" }), []);
  /* wanted: no bale, count or price needed */
  assert.deepEqual(bad({ kind: "wanted", bale: "", count: "", price: "", unit: "" }), []);
  v = H.validatePost(Object.assign({}, ok, { delivery: "yes", miles: "40" }));
  assert.equal(v.body.delivery, 40);
  assert.equal(H.validatePost(Object.assign({}, ok, { delivery: "yes", miles: "" })).body.delivery, "yes");
  assert.equal(H.validatePost(Object.assign({}, ok, { price: "$1,200" })).body.price, 1200);
});

test("a card never carries a contact, and text is escaped", () => {
  const row = { id: "a1b2c3d4e5", kind: "sale", zip: "54728", product: "alfalfa", cutting: "2", bale: "round", count: 50, price: 60, unit: "bale",
    weight: null, note: "<img src=x onerror=alert(1)>", name: "Pat & Sons", ts: Date.now(), mi: 3,
    phone: "715-555-0101", email: "pat@example.com" };
  const html = H.cardHtml(row, Date.now());
  assert.ok(!html.includes("715-555-0101") && !html.includes("pat@example.com"), "contact only through Show contact");
  assert.ok(!html.includes("<img") && html.includes("&lt;img src=x"), "note escaped");
  assert.match(html, /Pat &amp; Sons, posted today/);
  assert.match(html, /3 mi, ZIP 54728/);
  assert.match(html, /data-contact="a1b2c3d4e5"/);
  assert.match(html, /data-report="a1b2c3d4e5"/);
  assert.match(H.contactHtml({ name: "Pat", phone: "(715) 555-0101", email: "" }), /href="tel:7155550101"/);
});

test("private edit link lives in the hash, never the query", () => {
  assert.equal(H.editLink("a1b2c3d4e5", "abcdefghjkmnpqrstvwxyz01"), "https://agsist.com/haymow#edit=a1b2c3d4e5.abcdefghjkmnpqrstvwxyz01");
  assert.deepEqual(H.parseEdit("#edit=A1B2C3D4E5.abcdefghjkmnpqrstvwxyz01"), { id: "a1b2c3d4e5", key: "abcdefghjkmnpqrstvwxyz01" });
  assert.equal(H.parseEdit("#edit=a1b2c3d4e5.short"), null);
  assert.equal(H.parseEdit(""), null);
  /* the saved link is wrapped in try/catch storage calls */
  const js = read("components/haymow.js");
  assert.match(js, /function store\(get, val\) \{\s*try \{/);
});
