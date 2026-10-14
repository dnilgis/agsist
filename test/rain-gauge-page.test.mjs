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
    [/\b(PLA|PETG|ABS|ASA|PVC|polycarbonate|acrylic|resin|nylon)\b/, "a material"], [/\b\d+\s?:\s?1\b|\bratio\b|\bbore\b/i, "a ratio or bore"], [/fiducial|aruco|apriltag|threshold|homograph|algorithm|neural|model/i, "how the photo is read"],
    [/accurate to|within [\d.]+|\d+(\.\d+)?\s?%\s+accura/i, "an accuracy figure"], [/gauge-lab/, "a link to the unlisted lab page"],
    [/capacity|holds up to|part count|\d+ parts/i, "capacity or part count"], [/guarantee|forever/i, "guarantee or forever"],
  ]) assert.ok(!re.test(words), "the page must not carry " + why + ": " + (words.match(re) || [])[0]);
  assert.ok(/before planting 2027/.test(words), "states the plan");
  assert.ok(/Prototype design/.test(words));
});

test("every picture has a size, alt text and a file behind it, and every caption says what it is", () => {
  const imgs = [...main.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(imgs.length >= 8);
  for (const t of imgs) {
    assert.ok(/\swidth="\d+"/.test(t) && /\sheight="\d+"/.test(t), "size: " + t);
    assert.ok(/\salt="/.test(t), "alt: " + t);
    const src = t.match(/src="\/([^"]+)"/)[1];
    assert.ok(existsSync(ROOT + src), "file: " + src);
  }
  for (const m of main.matchAll(/srcset="\/([^"]+)"/g)) assert.ok(existsSync(ROOT + m[1]), "file: " + m[1]);
  const caps = [...main.matchAll(/<figcaption[^>]*>([^<]*)<\/figcaption>/g)].map((m) => m[1]).filter((c) => !/Sigurd/.test(c));
  assert.ok(caps.length >= 7);
  for (const c of caps) assert.ok(/^(Prototype design, 3D render\. |Concept screen: )/.test(c), "caption: " + c);
  // the renders Sig turned down stay off the page and out of the repo
  for (const old of ["gauge-field-edge", "gauge-phone-scan", "gauge-top-qr", "screen-1-scan", "screen-2-confirm"]) {
    assert.ok(!page.includes(old), "old concept image on the page: " + old);
    for (const ext of [".webp", ".jpg"]) assert.ok(!existsSync(ROOT + "img/rain-gauge/" + old + ext), "old concept image in the repo: " + old + ext);
  }
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

// panel 3 (2026-10-14): the fixes that ship without Sig
test("title says prototype, like the page; share copy matches the share screen", () => {
  assert.match(page, /<title>Rain gauge prototype: a gauge that keeps its own log \| AGSIST<\/title>/);
  assert.ok(!/<title>[^<]*concept/i.test(page));
  assert.ok(main.includes("They see only the fields you share with them."));
  assert.ok(!main.includes("for that field and nothing else"));
});
test("the warranty says where to write, as a link, on the card, in the FAQ and in the JSON-LD", () => {
  assert.equal((main.match(/Send me a photo and tell me what happened\. Write to me at <a href="mailto:sig@farmers1st\.com">sig@farmers1st\.com<\/a>\./g) || []).length, 2);
  assert.ok(JSON.stringify(ld).includes("Write to me at sig@farmers1st.com."));
});
test("phone layout: no badge over the funnel, readable phone screens, a full-width email box", () => {
  assert.match(page, /@media\(max-width:899px\)\{\.rg-cbadge\{display:none\}\}/);
  assert.match(page, /@media\(max-width:519px\)\{\.rg-step-phone\{grid-column:1\/-1\}\}/);
  assert.match(page, /@media\(max-width:420px\)\{\.rg-grid\{grid-template-columns:1fr\}\}/);
});
test("a 400 from the worker is not 'try again in a minute'", () => {
  assert.match(page, /res\.status === 400 \? 'That address couldn\\u2019t be added\. Write to me through \/contact/);
});
test("the gauge design stays private: the photo reader lab is not published", () => {
  for (const f of ["gauge-lab.html", "components/gauge-lab.js", "components/gauge-read.js", "data/gauge-strip.json"])
    assert.ok(!existsSync(ROOT + f), f + " must not be on the site");
});
test("F4, F3: the waitlist button says Sending, gives up after 12 s, and a busy day is not 'from here'", () => {
  assert.match(page, /go\.textContent = 'Sending\\u2026';/);
  assert.match(page, /setTimeout\(function \(\) \{ if \(ctl\) ctl\.abort\(\); \}, 12000\)/);
  assert.match(page, /if \(ctl\) opts\.signal = ctl\.signal;/);
  assert.match(page, /res\.error === 'busy today' \? 'Lots of people are signing up today\./);
});
test("Sig, 2026-10-14: the first-batch price holds for everyone on the waitlist, said on the card, the form and the FAQ", () => {
  assert.match(main, /Everyone on the waitlist hears first and gets the first-batch price\./);
  assert.equal((main.match(/Everyone on the waitlist gets (that|that first-batch) price, even if the first batch runs out before your turn\./g) || []).length, 2);
  assert.ok(JSON.stringify(ld).includes("Everyone on the waitlist gets that first-batch price, even if the first batch runs out before your turn."));
  assert.ok(!/while the first batch lasts/i.test(main));
});
