/* /rain-gauge: the concept page and its waitlist.
 * Guards the things that matter if someone edits it by hand: the FAQ says the
 * same words on the page and in the JSON-LD, no Product or price goes into
 * structured data, the build details stay off the page, every picture has its
 * size and alt text, and both forms post to the same worker topic as before.
 *
 *   node --test test/rain-gauge-page.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const page = readFileSync(ROOT + "rain-gauge.html", "utf8");
const main = page.slice(page.indexOf('<main id="main"'), page.indexOf("</main>"));
const text = (s) => s.replace(/<[^>]+>/g, "").replace(/&rsquo;/g, "’").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const ld = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

test("structured data is WebPage and FAQPage only: no Product, Offer or price", () => {
  const types = [];
  const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if (o["@type"]) types.push(o["@type"]); Object.values(o).forEach(walk); } };
  walk(ld);
  assert.ok(types.includes("WebPage") && types.includes("FAQPage"));
  for (const t of types) assert.ok(!/Product|Offer|AggregateRating|Review/.test(t), "not allowed yet: " + t);
  assert.ok(!/"price"|priceCurrency|availability/.test(JSON.stringify(ld)));
});

test("the FAQ on the page and in the JSON-LD say the same thing, word for word", () => {
  const faq = ld.flatMap((o) => o["@graph"] || [o]).find((o) => o["@type"] === "FAQPage");
  const shown = [...main.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)]
    .map((m) => [text(m[1]), text(m[2])]);
  assert.ok(shown.length >= 5);
  assert.deepEqual(shown, faq.mainEntity.map((q) => [q.name.replace(/'/g, "’"), q.acceptedAnswer.text.replace(/'/g, "’")]));
});

test("no build details, no promises the owner has not made, house style", () => {
  const words = text(main) + " " + (page.match(/<title>([^<]*)/) || [])[1] + " " + JSON.stringify(ld);
  for (const [re, why] of [
    [/—|&mdash;/, "em dash"], [/founding/i, "the word founding"], [/AI[- ]powered|artificial intelligence|\bAI\b/i, "AI claims"],
    [/pre-?order/i, "pre-order"], [/\$\s?\d/, "a price"], [/\d\s?(mm|cm)\b|\d+(\.\d+)?\s?(inch|inches|in\.?)\s+(tall|wide|long|across|diameter)/i, "a dimension"],
    [/\b(PLA|PETG|ABS|ASA|polycarbonate|acrylic|resin)\b/, "a material"], [/fiducial|aruco|apriltag|threshold|homograph|algorithm|neural|model/i, "how the photo is read"],
    [/accurate to|within [\d.]+|\d+(\.\d+)?\s?%\s+accura/i, "an accuracy figure"], [/gauge-lab/, "a link to the unlisted lab page"],
    [/capacity|holds up to|part count|\d+ parts/i, "capacity or part count"], [/guarantee|forever/i, "guarantee or forever"],
  ]) assert.ok(!re.test(words), "the page must not carry " + why + ": " + (words.match(re) || [])[0]);
  assert.ok(/before planting 2027/.test(words), "states the plan");
  assert.ok(/(Concept|Prototype)/.test(words));
});

test("every picture has a size, alt text and a file behind it, and renders say Concept", () => {
  const imgs = [...main.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(imgs.length >= 8);
  for (const t of imgs) {
    assert.ok(/\swidth="\d+"/.test(t) && /\sheight="\d+"/.test(t), "size: " + t);
    assert.ok(/\salt="/.test(t), "alt: " + t);
    const src = t.match(/src="\/([^"]+)"/)[1];
    assert.ok(existsSync(ROOT + src), "file: " + src);
  }
  for (const m of main.matchAll(/srcset="\/([^"]+)"/g)) assert.ok(existsSync(ROOT + m[1]), "file: " + m[1]);
  for (const m of main.matchAll(/<figcaption>([^<]*)<\/figcaption>/g)) if (!/Sigurd/.test(m[1])) assert.ok(/^Concept/.test(m[1]), "caption: " + m[1]);
  assert.ok(/og:image"\s+content="https:\/\/agsist\.com\/img\/og\/rain-gauge\.jpg"/.test(page) && existsSync(ROOT + "img/og/rain-gauge.jpg"));
});

test("two waitlist forms, same worker and topic as before, extras folded into the note", () => {
  assert.equal((main.match(/<form class="rg-form"/g) || []).length, 2);
  for (const n of [1, 2]) {
    assert.ok(new RegExp(`id="rg-email-${n}"[^>]*required`).test(main), "email required on form " + n);
    assert.ok(!new RegExp(`id="rg-(zip|use)-${n}"[^>]*required`).test(main), "ZIP and use stay optional");
    assert.ok(new RegExp(`name="count-${n}" value="6\\+"`).test(main));
    assert.ok(new RegExp(`id="rg-gotcha-${n}" name="_gotcha"`).test(main), "honeypot on form " + n);
  }
  assert.ok(page.includes("'https://agsist-subs.dnilgis.workers.dev/notice'"));
  assert.ok(/topic: 'rain-gauge', source: 'rain-gauge'/.test(page));
  assert.ok(/\.slice\(0, 280\)/.test(page), "the note stays inside the worker's 280");
  assert.ok(!/body\.(count|use)\b/.test(page), "no new worker fields");
});

test("the page carries its own dateline, in the text and the JSON-LD", () => {
  const wp = ld.flatMap((o) => o["@graph"] || [o]).find((o) => o["@type"] === "WebPage");
  assert.equal(wp.datePublished, "2026-10-14");
  assert.ok(/First shown here on <time datetime="2026-10-14">October 14, 2026<\/time>\./.test(main));
});

test("the warranty says normal use, on the card and in the FAQ", () => {
  assert.equal((main.match(/if your gauge breaks in normal use, I&rsquo;ll fix it or replace it/g) || []).length, 2);
});
