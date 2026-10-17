/* /rain-gauge: Sig's three rain things (Oct 17): Rain Print (on sale), the
 * AGSIST rain gauge prototype and its waitlist, and the Lorain, a tipping-bucket
 * concept with its own interest list.
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
    [/reading method|\bstrips?\b/i, "the reading method or strip"], [/lorain\.io/i, "the dropped lorain.io name"],
    [/\bLoRa(WAN)?\b|Wi-?Fi|Bluetooth|\bBLE\b|Zigbee|cellular|\bLTE\b|\bGSM\b|softAP|\b(2\.4|915|868|433)\s?(GHz|MHz)/i, "a radio or its protocol"],
    [/\b(reed|hall[- ]effect|magnet|ESP32|microcontroller|circuit|PCB|sensor|load cell|ultrasonic|capacitive|siphon|solar|18650|lithium|Li-?ion|mAh)\b/i, "a part, sensor or cell"],
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
  for (const c of caps) assert.ok(/^(Prototype design, 3D render\. |Concept screen: |A real one: \d{4} at |Concept render, not a product photo\.$)/.test(c), "caption: " + c);
  // the renders Sig turned down stay off the page and out of the repo
  for (const old of ["gauge-field-edge", "gauge-phone-scan", "gauge-top-qr", "screen-1-scan", "screen-2-confirm"]) {
    assert.ok(!page.includes(old), "old concept image on the page: " + old);
    for (const ext of [".webp", ".jpg"]) assert.ok(!existsSync(ROOT + "img/rain-gauge/" + old + ext), "old concept image in the repo: " + old + ext);
  }
  assert.ok(/og:image"\s+content="https:\/\/agsist\.com\/img\/og\/rain-gauge\.jpg\?v=[0-9a-f]{8}"/.test(page) && existsSync(ROOT + "img/og/rain-gauge.jpg"));
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

test("the publish date stays in the JSON-LD, with no \"First shown here\" line on the page (Sig, Oct 15)", () => {
  const wp = ld.flatMap((o) => o["@graph"] || [o]).find((o) => o["@type"] === "WebPage");
  assert.equal(wp.datePublished, "2026-10-14");
  assert.ok(!/First shown here/i.test(page));
  assert.ok(!/rg-dateline|"date side"/.test(page), "no empty grid row left behind");
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

// Oct 17: three things on one page (Sig, via the lead)
const ORDER = ["rain-print", "gauge", "lorain", "record", "fit", "rg-faq-h"];
const sec = (id) => { const i = main.indexOf(`id="${id}"`); assert.ok(i > 0, "section " + id); const nx = ORDER[ORDER.indexOf(id) + 1]; return main.slice(i, nx ? main.indexOf(`id="${nx}"`) : undefined); };
test("the page runs in order: opening, Rain Print, the AGSIST rain gauge, the Lorain, on the record, how they fit, questions", () => {
  const at = ["<h1>", 'id="rain-print"', 'id="gauge"', 'id="lorain"', 'id="record"', 'id="fit"', 'id="rg-faq-h"'].map((k) => main.indexOf(k));
  for (let i = 0; i < at.length; i++) assert.ok(at[i] > 0 && (i === 0 || at[i] > at[i - 1]), "order at " + i);
  assert.equal((main.match(/<h1>/g) || []).length, 1);
  assert.ok(main.indexOf('id="rg-form-1"') > at[2] && main.indexOf('id="rg-form-1"') < at[3], "the waitlist sits with the gauge");
  assert.ok(main.indexOf('id="rg-form-3"') > at[3] && main.indexOf('id="rg-form-3"') < at[4], "the interest list sits with the Lorain");
  assert.match(main, /Sigurd Lindquist, CCA/);
  assert.ok(!/Sigurd Lindquist, Certified Crop Adviser/.test(main), "short byline on the page (Oct 16)");
});
test("the existing gauge keeps the live page's own words, and none of the Lorain's features", () => {
  const g = text(sec("gauge"));
  for (const s of ["A rain gauge that keeps its own log", "Read it like any good gauge. Or scan the code on it, take a photo, and the rain goes into your log for that field.",
    "a prototype on my bench in Chetek", "Wood post or T-post", "How it would work", "Why I’m building it", "Who it’s for", "A season next to a standard gauge"])
    assert.ok(g.includes(s), "kept: " + s);
  assert.ok(!/reports on its own|on batteries|every tip|tipping|dashboard|subscription/i.test(g), "a Lorain feature in the gauge section");
});
test("no price for either gauge, and no date for the Lorain", () => {
  const g = text(sec("gauge")) + " " + text(sec("lorain")) + " " + text(sec("record")) + " " + text(sec("fit"));
  assert.ok(!/\$|\bUSD\b|\d+\s?dollars|per month/i.test(g), "a gauge price: " + (g.match(/\$\S*|USD|dollars|per month/) || [])[0]);
  const l = text(sec("lorain"));
  assert.match(l, /Exploring: no price, no date/);
  assert.match(l, /It doesn’t exist yet\./);
  assert.ok(!/before planting|20\d\d|available|order now|ships?\b/i.test(l), "the Lorain carries no date or sale wording");
});
test("each gauge's name is written in one place", () => {
  assert.equal((page.match(/AGSIST rain gauge/g) || []).length, 1);
  assert.match(main, /<!-- THE GAUGE'S NAME:[^>]*-->\s*<p class="rg-tag"><span id="rg-gauge-name">The AGSIST rain gauge<\/span>/);
  const shown = page.replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/data-note-prefix="[^"]*"/g, "");
  assert.equal((shown.match(/Lorain/g) || []).length, 1, "the concept's name shows once");
  assert.match(main, /<h2 class="sec-h" id="rg-lorain-h">The Lorain<\/h2>/);
});
test("the Lorain form: its own interest list, same worker topic, note tagged [Lorain]; the waitlist forms unchanged", () => {
  const f = main.match(/<form class="rg-form rg-form-lorain" id="rg-form-3"[\s\S]*?<\/form>/);
  assert.ok(f, "the Lorain form");
  assert.match(f[0], /data-list="rain-gauge-lorain" data-note-prefix="\[Lorain\] "/);
  assert.match(f[0], /id="rg-email-3"[^>]*required/);
  assert.ok(!/id="rg-(zip|use)-3"[^>]*required/.test(f[0]));
  assert.match(f[0], /id="rg-gotcha-3" name="_gotcha"/);
  assert.match(f[0], /id="rg-use-3" name="use" maxlength="(\d+)"/);
  assert.ok(+f[0].match(/id="rg-use-3" name="use" maxlength="(\d+)"/)[1] + "[Lorain] ".length <= 280, "within the worker's NOTE_TEXT_MAX");
  assert.match(text(sec("lorain")), /interest list for this concept only, separate from the gauge waitlist above/);
  // run the page's own note line the way the submit handler does
  const line = page.match(/var note = (prefix \? [^;]+);/);
  assert.ok(line, "the note line");
  const noteFor = (c, u) => [c && "Gauges: " + c, u && "Use: " + u].filter(Boolean).join(". ");
  const mk = new Function("prefix", "use", "count", "noteFor", "return " + line[1] + ";");
  assert.equal(mk("[Lorain] ", "rain   rate on  the home field", "", noteFor), "[Lorain] rain rate on the home field");
  assert.ok(mk("[Lorain] ", "x".repeat(400), "", noteFor).length === 280 && mk("[Lorain] ", "x".repeat(400), "", noteFor).startsWith("[Lorain] "));
  assert.equal(mk("", "a few fields", "2-5", noteFor), "Gauges: 2-5. Use: a few fields", "the waitlist note is unchanged");
  assert.match(page, /topic: 'rain-gauge', source: 'rain-gauge'/);
  assert.ok(!/topic: '(?!rain-gauge')/.test(page), "no other topic: the worker takes rain-gauge only");
  // the two waitlist forms keep their markup
  for (const n of [1, 2]) assert.ok(new RegExp(`<form class="rg-form" id="rg-form-${n}" data-n="${n}" novalidate`).test(main));
  assert.ok(!/data-note-prefix/.test(main.match(/<form class="rg-form" id="rg-form-1"[^>]*>/)[0] + main.match(/<form class="rg-form" id="rg-form-2"[^>]*>/)[0]));
});
test("the Lorain render is drawn, labeled as a concept, and the file is there", () => {
  const l = sec("lorain");
  assert.match(l, /src="\/img\/rain-gauge\/lorain-concept\.jpg" width="1600" height="1000"/);
  assert.match(l, /srcset="\/img\/rain-gauge\/lorain-concept\.webp"/);
  assert.match(l, /<figcaption>Concept render, not a product photo\.<\/figcaption>/);
  for (const e of [".jpg", ".webp"]) assert.ok(existsSync(ROOT + "img/rain-gauge/lorain-concept" + e));
});
test("Rain Print prices come from data/rain-print.json, never typed on this page", () => {
  const html = page.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  assert.ok(!/\$\s?\d/.test(html), "a typed price");
  const fn = page.match(/function rpPriceLine\(cfg\) \{[\s\S]*?\n  \}/);
  assert.ok(fn);
  const rpPriceLine = new Function(fn[0] + "; return rpPriceLine;")();
  const cfg = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  assert.equal(rpPriceLine(cfg), `Digital file $${cfg.digital}, print $${cfg.print12x18}, framed $${cfg.framed12x18}. Shipping included in the 50 states.`);
  assert.equal(rpPriceLine({ ...cfg, framed12x18: null }), "");
  assert.equal(rpPriceLine(null), "");
  assert.match(page, /fetch\('\/data\/rain-print\.json'/);
  assert.match(sec("rain-print"), /id="rg-rp-price">Digital file, print or framed print\. Shipping included in the 50 states\.</);
  assert.match(sec("rain-print"), /src="\/img\/rain-print-example-2012-ames-ia\.jpg"/);
});
test("the Christmas line is the shared one from the same cutoffs, hidden until filled", async () => {
  assert.match(page, /<script src="\/components\/rain-print-promo\.js\?v=\d+" defer><\/script>/);
  assert.match(sec("rain-print"), /<p class="rg-xmas" id="rg-rp-xmas" hidden><\/p>/);
  const { createRequire } = await import("node:module");
  const P = createRequire(import.meta.url)("../components/rain-print-promo.js");
  const cfg = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  assert.equal(P.xmasLine({ ...cfg, print_christmas_cutoff: "2026-12-10", framed_christmas_cutoff: "2026-12-09" }, "2026-10-17"),
    "For Christmas delivery, order a print by Dec 10 or a framed print by Dec 9.");
  assert.equal(P.xmasLine(cfg, "2026-07-01"), "");
});
test("on the record and how they fit: no invented results, the Rain Print link belongs to the concept", () => {
  const r = text(sec("record"));
  assert.match(r, /no results yet\. The first comparison posts here once a full month is in\./);
  assert.ok(!/\d+(\.\d+)?\s?(%|in\b|inch)/.test(r));
  const f = text(sec("fit"));
  assert.ok(/tipping-bucket concept/.test(f) && /Nothing is built for that yet/.test(f));
});
