/* /rain-gauge: Sig's two rain products and the plan (Oct 16: "fix up the
 * prototype page to show both products and the gameplan"), and the waitlist.
 * Guards the things that matter if someone edits it by hand: the FAQ says the
 * same words on the page and in the JSON-LD, no Product or price for the gauge
 * goes into structured data or onto the page, the build details stay off the
 * page, the gauge's name is written in one place, the Rain Print prices come
 * from data/rain-print.json, every picture has its size and alt text, and the
 * form posts to the same worker topic as before.
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
    [/reading method|\bstrips?\b/i, "the reading method or strip"], [/\bQR\b|scan (the|its) code|photo of the scale/i, "the old phone reading"],
    [/LoRa|Wi-?Fi|Bluetooth|\bBLE\b|Zigbee|cellular|\bLTE\b|\bGSM\b|softAP|\b(2\.4|915|868|433)\s?(GHz|MHz)/i, "a radio or its protocol"],
    [/\b(reed|hall[- ]effect|magnet|ESP32|microcontroller|circuit|PCB|sensor|load cell|ultrasonic|capacitive|siphon)\b/i, "a part or sensor"],
    [/tipping bucket|\bbucket\b|\bpivot\b|\bsolar\b|18650|lithium|Li-?ion|\bAA\b|mAh/i, "the mechanism or its power parts"],
  ]) assert.ok(!re.test(words), "the page must not carry " + why + ": " + (words.match(re) || [])[0]);
  assert.ok(/before planting 2027/.test(words), "states the plan");
  assert.ok(/Early prototype, 3D render/.test(words), "the render says what it is");
});

test("every picture has a size, alt text and a file behind it, and every caption says what it is", () => {
  const imgs = [...main.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(imgs.length >= 2);
  for (const t of imgs) {
    assert.ok(/\swidth="\d+"/.test(t) && /\sheight="\d+"/.test(t), "size: " + t);
    assert.ok(/\salt="/.test(t), "alt: " + t);
    const src = t.match(/src="\/([^"]+)"/)[1];
    assert.ok(existsSync(ROOT + src), "file: " + src);
  }
  for (const m of main.matchAll(/srcset="\/([^"]+)"/g)) assert.ok(existsSync(ROOT + m[1]), "file: " + m[1]);
  const caps = [...main.matchAll(/<figcaption[^>]*>([^<]*)<\/figcaption>/g)].map((m) => m[1]).filter((c) => !/Sigurd/.test(c));
  assert.ok(caps.length >= 2);
  for (const c of caps) assert.ok(/^(Early prototype, 3D render\. The gauge that ships may look different\.|A real one: \d{4} at )/.test(c), "caption: " + c);
  assert.ok(main.includes('src="/img/rain-print-example-2012-ames-ia.jpg"'), "the real Rain Print example");
  // the renders Sig turned down stay off the page and out of the repo
  for (const old of ["gauge-field-edge", "gauge-phone-scan", "gauge-top-qr", "screen-1-scan", "screen-2-confirm",
    "gauge-reading", "gauge-top-code", "screen-3-log", "screen-4-share"]) {
    assert.ok(!page.includes(old), "old concept image on the page: " + old);
    for (const ext of [".webp", ".jpg"]) assert.ok(!existsSync(ROOT + "img/rain-gauge/" + old + ext), "old concept image in the repo: " + old + ext);
  }
  assert.ok(/og:image"\s+content="https:\/\/agsist\.com\/img\/og\/rain-gauge\.jpg\?v=[0-9a-f]{8}"/.test(page) && existsSync(ROOT + "img/og/rain-gauge.jpg"));
});

test("the waitlist form, same fields, worker and topic as before, extras folded into the note", () => {
  const nForms = (main.match(/<form class="rg-form"/g) || []).length;
  assert.equal(nForms, 1, "one waitlist form, in its own section (Oct 16 page order)");
  assert.ok(/<section class="rg-sec" id="waitlist"[^>]*>\s*<form class="rg-form" id="rg-form-1" data-n="1"/.test(main));
  assert.match(main, /<button type="submit" class="btn btn-primary rg-go" id="rg-go-1">Put me on the waitlist<\/button>/);
  assert.match(main, /id="rg-zip-1" name="zip" inputmode="numeric" autocomplete="postal-code" maxlength="5" pattern="\[0-9\]\{5\}"/);
  for (const n of [1]) {
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
test("title, description and share copy name both products and the gauge's plan, honestly", () => {
  assert.match(page, /<title>Rain Print now, a rain gauge before planting 2027 \| AGSIST<\/title>/);
  assert.ok(!/<title>[^<]*concept/i.test(page));
  const desc = page.match(/<meta name="description" content="([^"]+)"/)[1];
  assert.ok(/Rain Print/.test(desc) && /before planting 2027/.test(desc) && /waitlist/i.test(desc));
  for (const k of ["og:description", "twitter:description"]) assert.ok(page.includes(`content="${desc}"`), k);
  assert.ok(!/keeps its own log|by eye|phone photo/i.test(page), "no old concept copy left in the head or body");
});
test("the warranty says where to write, as a link, on the card, in the FAQ and in the JSON-LD", () => {
  assert.equal((main.match(/Send me a photo and tell me what happened\. Write to me at <a href="mailto:sig@farmers1st\.com">sig@farmers1st\.com<\/a>\./g) || []).length, 2);
  assert.ok(JSON.stringify(ld).includes("Write to me at sig@farmers1st.com."));
});
test("phone layout: picture first on a phone, full-width buttons, a full-width email box", () => {
  assert.match(page, /@media\(max-width:899px\)\{\.rg-split>figure\{order:-1\}\}/);
  assert.match(page, /@media\(max-width:520px\)\{\.rg-go-link\{width:100%\}\}/);
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

// Oct 16 rework (Sig: both products and the gameplan)
const sec = (id) => { const i = main.indexOf(`id="${id}"`); assert.ok(i > 0, "section " + id); return main.slice(i, main.indexOf("</section>", i)); };
test("the page runs in Sig's order: opening, Rain Print, the gauge, on the record, how they fit, waitlist, questions", () => {
  const at = ["<h1>", 'id="rain-print"', 'id="gauge"', 'id="record"', 'id="fit"', 'id="waitlist"', 'id="rg-faq-h"'].map((k) => main.indexOf(k));
  for (let i = 0; i < at.length; i++) assert.ok(at[i] > 0 && (i === 0 || at[i] > at[i - 1]), "order at " + i);
  assert.match(text(main.slice(0, main.indexOf('id="rain-print"'))), /One you can buy today, and one I’m building\./);
  assert.ok(/Sigurd Lindquist, CCA/.test(main), "byline");
  assert.ok(!/Sigurd Lindquist, Certified Crop Adviser/.test(main), "short byline on the page (Oct 16)");
});
test("no price for the gauge anywhere: not on the page, not in the FAQ, not in structured data", () => {
  const g = text(sec("gauge")) + " " + text(sec("record")) + " " + text(sec("fit")) + " " + text(main.slice(main.indexOf('id="waitlist"')));
  assert.ok(!/\$|\bUSD\b|\d+\s?dollars|per month|a year subscription/i.test(g), "gauge copy names a price: " + (g.match(/\$\S*|USD|dollars/) || [])[0]);
  assert.ok(/barely over what it costs me to make/.test(g) && /before orders open/.test(g));
  assert.ok(!/ship(s|ping)? (in|by|on) (January|February|March|April|May|June|\d)/i.test(g), "no ship date beyond before planting 2027");
  assert.ok(!/\$/.test(JSON.stringify(ld)));
});
test("the gauge's name is written in one place, so a new name is one edit", () => {
  const all = page.match(/AGSIST rain gauge/g) || [];
  assert.equal(all.length, 1, "the name appears exactly once");
  assert.match(main, /<!-- THE GAUGE'S NAME:[^>]*-->\s*<h2 class="sec-h" id="rg-gauge-h">The AGSIST rain gauge<\/h2>/);
});
test("Rain Print prices come from data/rain-print.json, never typed on this page", () => {
  const html = page.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  assert.ok(!/\$\s?\d|\b(19|45|89)\s?dollars/.test(html), "a typed price");
  assert.ok(!/"price"/.test(JSON.stringify(ld)));
  const fn = page.match(/function rpPriceLine\(cfg\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, "the price line is built from the data file");
  const rpPriceLine = new Function(fn[0] + "; return rpPriceLine;")();
  const cfg = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  assert.equal(rpPriceLine(cfg), `Digital file $${cfg.digital}, print $${cfg.print12x18}, framed $${cfg.framed12x18}. Shipping included in the 50 states.`);
  assert.equal(rpPriceLine({ ...cfg, framed12x18: null }), "", "a missing price shows the plain line, never a guess");
  assert.equal(rpPriceLine(null), "");
  assert.match(page, /fetch\('\/data\/rain-print\.json'/);
  assert.match(sec("rain-print"), /id="rg-rp-price">Digital file, print or framed print\. Shipping included in the 50 states\.</);
  assert.match(sec("rain-print"), /<a class="rg-go-link" href="\/rain-print"/);
});
test("the Christmas line is the shared one from the same cutoffs, hidden until filled", async () => {
  assert.match(page, /<script src="\/components\/rain-print-promo\.js\?v=\d+" defer><\/script>/);
  assert.match(sec("rain-print"), /<p class="rg-xmas" id="rg-rp-xmas" hidden><\/p>/);
  assert.match(page, /P\.xmasLine\(cfg, P\.chicagoToday\(\)\)/);
  const { createRequire } = await import("node:module");
  const P = createRequire(import.meta.url)("../components/rain-print-promo.js");
  const cfg = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  // hand-worked from the file: print by Dec 10, framed by Dec 9
  assert.equal(P.xmasLine({ ...cfg, print_christmas_cutoff: "2026-12-10", framed_christmas_cutoff: "2026-12-09" }, "2026-10-17"),
    "For Christmas delivery, order a print by Dec 10 or a framed print by Dec 9.");
  assert.equal(P.xmasLine(cfg, "2026-07-01"), "", "no Christmas line in summer");
});
test("on the record: testing under way, no invented results", () => {
  const r = text(sec("record"));
  assert.match(r, /testing is under way\. The first comparison posts here once a full month is in\./);
  assert.ok(/glass gauge/.test(r) && /how often it missed/.test(r) && /first winter/i.test(r) && /Photos from the yard/.test(r));
  assert.ok(!/\d+(\.\d+)?\s?(%|in\b|inch)/.test(r), "no measured numbers before there are any");
  const f = text(sec("fit"));
  assert.ok(/your own gauge can draw your Rain Print/.test(f) && /Nothing is built for that yet/.test(f));
});
test("the FAQ says what it will not do, when, the price and who makes it", () => {
  const faq = ld.flatMap((o) => o["@graph"] || [o]).find((o) => o["@type"] === "FAQPage");
  const q = Object.fromEntries(faq.mainEntity.map((x) => [x.name, x.acceptedAnswer.text]));
  assert.match(q["What won't the gauge do?"], /not an 8-inch National Weather Service gauge/);
  assert.match(q["What won't the gauge do?"], /Snow is not measured as snow/);
  assert.match(q["When can I get one?"], /^Before planting 2027\./);
  assert.match(q["What will it cost?"], /barely over what it costs me to make them/);
  assert.match(q["Who makes it?"], /Chetek, Wisconsin/);
  assert.ok(!/Does it need a battery/.test(JSON.stringify(faq)), "the old no-battery answer is gone");
});
