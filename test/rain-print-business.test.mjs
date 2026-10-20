/* /rain-print-business: the business Christmas landing page.
 * Structure and SEO, prices and dates written on the page match
 * data/rain-print.json (hand-worked from Sig's Oct 13 tiers too), the quote
 * form posts the worker's own kind and fields, standing rules (no sponsor,
 * no business name on the print, no em dashes, no store names, no fake
 * counts), and the CSV list reader.
 *
 *   node --test test/rain-print-business.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "rain-print-business.html", "utf8");
const JS = readFileSync(ROOT + "components/rp-business.js", "utf8");
const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
const ctx = {}; ctx.window = ctx; ctx.globalThis = ctx;
vm.runInNewContext(readFileSync(ROOT + "components/rain-print.js", "utf8"), ctx);
vm.runInNewContext(JS, ctx);
const R = ctx.RainPrint, B = ctx.RpBusiness;
const MAIN = HTML.slice(HTML.indexOf("<main"), HTML.indexOf("</main>"));
const COPY = MAIN.replace(/<script[\s\S]*?<\/script>/g, "");

test("indexable page with its own canonical, byline, share image and structured data", () => {
  assert.match(HTML, /<meta name="robots" content="index, follow/);
  assert.match(HTML, /<link rel="canonical"\s+href="https:\/\/agsist\.com\/rain-print-business">/);
  assert.match(HTML, /<title>[^<]+ \| AGSIST<\/title>/);
  assert.match(HTML, /og:image"\s+content="https:\/\/agsist\.com\/img\/og\/rain-print-business\.jpg/);
  assert.match(MAIN, /Sigurd Lindquist, CCA/);
  const ld = JSON.parse(HTML.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  const types = ld["@graph"].map((g) => g["@type"]);
  for (const t of ["WebPage", "FAQPage", "BreadcrumbList"]) assert.ok(types.includes(t), t);
  const faq = ld["@graph"].find((g) => g["@type"] === "FAQPage").mainEntity;
  const plain = (s) => s.replace(/<[^>]+>/g, "").replace(/&rsquo;/g, "’");
  for (const q of faq) {
    assert.ok(MAIN.includes("<summary>" + q.name + "</summary>"), q.name);
    assert.ok(plain(MAIN).includes(q.acceptedAnswer.text), "answer on the page: " + q.name);
  }
  assert.match(HTML, /<!-- static-nav:header/);
  assert.match(HTML, /<!-- static-nav:footer/);
  for (const s of ["loader.js", "form-post.js", "rp-logo.js", "rain-print.js", "rp-business.js"])
    assert.match(HTML, new RegExp('src="/components/' + s.replace(".", "\\.") + '\\?v=\\d+" defer'), s);
});

test("the written table is the data's tiers, and matches Sig's Oct 13 prices by hand", () => {
  const rows = [...MAIN.matchAll(/<tr><th scope="row">([\d]+)&ndash;([\d]+)(?:<span[^>]*>[^<]*<\/span>)?<\/th><td[^>]*>\$(\d+)<\/td><td[^>]*>\$(\d+)<\/td><td[^>]*>\$(\d+) \/ \$(\d+)<\/td><\/tr>/g)]
    .map((m) => m.slice(1).map(Number));
  const want = R.bizRows(J).map((r) => [r.from, r.to, r.prices.print12x18, r.prices.framed12x18, r.one.print12x18, r.one.framed12x18]);
  assert.deepEqual(rows, want);
  // by hand: 5-9 retail; 10-24 $40/$79; 25-49 $37/$75; 50-100 $35/$72; $3/$6 off all to one address (not on the retail row)
  assert.deepEqual(rows, [[5, 9, 45, 89, 45, 89], [10, 24, 40, 79, 37, 73], [25, 49, 37, 75, 34, 69], [50, 100, 35, 72, 32, 66]]);
  assert.match(MAIN, new RegExp("digital file is \\$" + J.digital + " each"));
  assert.match(MAIN, new RegExp("Over " + J.business_quote_max + " prints, ask me"));
  // a quote, worked by hand: 30 framed to one address = 30 x ($75 - $6) = $2,070
  assert.deepEqual({ ...R.bizQuote(J, 30, "framed12x18", "one") }, { unit: 69, total: 2070 });
  assert.deepEqual({ ...R.bizQuote(J, 12, "print12x18", "each") }, { unit: 40, total: 480 });
  assert.equal(B.money(2070), "$2,070");
  assert.equal(B.money(37.5), "$37.50");
});

test("the Christmas date on the page is the data's business cutoff; the script hides it after", () => {
  const short = R.bizCutoffNote(J.business_cutoff.slice(0, 4) + "-10-01", J.business_cutoff);
  assert.ok(short, "cutoff set in the data");
  assert.ok(MAIN.includes('<p class="rbz-date" id="rbz-cutoff">' + short + "</p>"));
  const md = short.match(/by (\w+ \d+)\./)[1];
  assert.ok(MAIN.includes('<span id="rbz-cutoff2">send it by ' + md + "</span>"));
  const after = new Date(Date.parse(J.business_cutoff + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
  assert.equal(R.bizCutoffNote(after, J.business_cutoff), "");
  assert.match(JS, /c1\.hidden = !cut/);
  // this year's print waits for the full year; never promised for Christmas
  assert.match(COPY, /This year&rsquo;s print ships in January/);
  assert.match(COPY, /within 3 business days/);
  assert.equal(J.ship_business_days, 3);
});

test("the form posts the worker's business kind with only fields the worker takes", () => {
  const worker = readFileSync(ROOT + "workers/subs-worker.js", "utf8");
  const spec = worker.match(/"rain-print-business": \{([\s\S]*?)\n  \},/)[1];
  const allowed = [...spec.matchAll(/(\w+): \[/g)].map((m) => m[1]);
  assert.match(JS, /send\('rain-print-business', data, fs\)/);
  const keys = [...JS.match(/var x = \{([\s\S]*?)\};/)[1].matchAll(/(\w+):/g)].map((m) => m[1]);
  for (const k of [...keys, "logo", "note_all"]) assert.ok(allowed.includes(k), "worker takes " + k);
  assert.match(JS, /var PAGE = '\/rain-print-business'/);
  assert.ok("/rain-print-business".length <= 60);
  for (const id of ["rb-business", "rb-name", "rb-email", "rb-qty", "rb-towns", "rb-submit", "rb-out", "rb-tier", "rb-csv"])
    assert.ok(MAIN.includes('id="' + id + '"'), id);
  // the box, the script and the worker take the same number of characters (20,000 since 2026-10-20)
  const cap = Number(spec.match(/towns: \[(\d+), true, "text"\]/)[1]);
  assert.equal(cap, 20000);
  assert.ok(MAIN.includes('id="rb-towns" maxlength="' + cap + '"'), "textarea maxlength is the worker's cap");
  assert.ok(JS.includes("var TOWNS_MAX = " + cap + ";"), "the script's cap is the worker's");
  // GA4 on every CTA
  for (const e of ["rain_print_business", "rp_business_cta", "rp_business_template", "rp_business_csv"]) assert.ok(JS.includes("'" + e + "'"), e);
  assert.ok((MAIN.match(/data-rbz-cta=/g) || []).length >= 3);
});

test("the CSV reader keeps the rows, drops blank ones, refuses a list the form can't hold", () => {
  assert.equal(B.listText("﻿Name,Town\r\nThe Olson Farm,Chetek\r\n,,\r\n\r\nBerg,Cameron  \n"), "Name,Town\nThe Olson Farm,Chetek\nBerg,Cameron");
  assert.equal(B.listText(""), "");
  assert.equal(B.listText("x,".repeat(10001)), null);
  assert.equal(B.listText("x".repeat(20000)).length, 20000, "exactly the cap fits");
  assert.match(B.TEMPLATE, /^Name for the print,Town,State,Year,Mailing address/);
});

test("standing rules: no sponsor, name off the print, honest copy", () => {
  assert.ok(!/sponsor/i.test(MAIN), "no sponsor on a Rain Print page");
  assert.match(COPY, /business name stays off the print/);
  assert.match(COPY, /logo can go on it, small, next to their name/);
  // Sig, 2026-10-17: no separate card; the business's message is printed at the top of the letter in each box
  assert.match(COPY, /Your message is printed at the top of the letter in the box, at no charge\./);
  assert.doesNotMatch(COPY, /note card|on a card/);
  assert.match(COPY, /13 x 19 black frame with a white mat and a real glass front, ready to hang/);
  assert.doesNotMatch(COPY, /12 x 18/);
  assert.match(COPY, /No prices go in the box/);
  assert.match(COPY, /net 30/);
  assert.match(COPY, /W-9 on request/);
  assert.match(COPY, /one proof sheet/);
  assert.match(COPY, /A Rain Print of Chetek, Wisconsin, 2025, framed in Chetek\. This test print is shown without its white mat\./, "a real photo, captioned truthfully: no mat in it yet");
  assert.ok(!/—|&mdash;/.test(HTML), "no em dashes");
  assert.ok(!/—/.test(JS), "no em dashes in the script's copy");
  assert.ok(!/compliments of|archival|founding|only \d+ left|hurry|limited time|best[- ]selling|\d+ (businesses|elevators) (have )?(ordered|trust)/i.test(COPY), "no claims Sig ruled out, no fake scarcity or counts");
  assert.ok(!/amazon|walmart|etsy|tractor supply|fleet farm|costco|staples|fedex office|printful/i.test(HTML), "no store or printer names");
});

// 2026-10-19 (board seat C: "AP will not pay without a PO"): optional PO number and invoice contact. The worker
// drops fields it doesn't know, so they go at the top of the notes, inside the worker's 2000 characters.
test("PO number and invoice contact: optional fields, carried in the notes the worker keeps", () => {
  for (const id of ["rb-po", "rb-inv-name", "rb-inv-email"]) {
    const tag = MAIN.match(new RegExp('<input id="' + id + '"[^>]*>'));
    assert.ok(tag, id);
    assert.doesNotMatch(tag[0], /required/, id + " is optional");
  }
  assert.match(MAIN, /<legend>For the invoice \(optional\)<\/legend>/);
  assert.deepEqual({ ...B.invoiceLines("", "", "") }, { text: "", bad: false });
  assert.deepEqual({ ...B.invoiceLines(" 4512-A ", "Jane Berg", "ap@coop.example") }, { text: "PO number: 4512-A\nSend the invoice to: Jane Berg, ap@coop.example", bad: false });
  assert.deepEqual({ ...B.invoiceLines("", "", "ap@coop.example") }, { text: "Send the invoice to: ap@coop.example", bad: false });
  assert.equal(B.invoiceLines("", "Jane", "not an email").bad, true);
  const worker = readFileSync(ROOT + "workers/subs-worker.js", "utf8");
  const notes = worker.match(/"rain-print-business": \{[\s\S]*?notes: \[(\d+), false, "text"\]/);
  assert.equal(Number(notes[1]), B.NOTES_MAX, "the cap is the worker's own");
  assert.ok(!/\bpo:|invoice_/.test(JS.match(/var x = \{([\s\S]*?)\};/)[1]), "no new field the worker would drop");
  assert.match(JS, /x\.notes = both/);
});

// 2026-10-19 (board seat C: "40 customers near one station get 40 identical rain lines. Say it plainly").
// The maker picks a station per town (RainPrint.pickStation: the nearest with a good record for the year), so
// the page says each print uses the station nearest each customer's town, and neighbors on one station share a line.
test("same-station line: neighbors near one station share a rain line, said plainly, in the copy and the FAQ", () => {
  assert.match(COPY, /<b>Neighbors share a rain line\.<\/b> Each print uses the weather station nearest that customer&rsquo;s town with a good record for the year\. Customers near the same station get the same rain line for the same year/);
  assert.match(COPY, /give each customer their own year/);
  const ld = JSON.parse(HTML.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  const q = ld["@graph"].find((g) => g["@type"] === "FAQPage").mainEntity.find((x) => x.name === "Will customers near each other get the same print?");
  assert.ok(q, "in FAQPage");
  assert.match(q.acceptedAnswer.text, /customers near the same station get the same rain line/);
  assert.equal(typeof R.pickStation, "function", "the per-town pick the copy describes");
});

// 2026-10-19: the call line sat about 10 px up under the H1 (margin -1rem) at 390 and 1280 px. Measured in a
// browser after the fix: 10 px clear at both widths. Here: no negative top margin on it again.
test("the 'Questions? Call or text' line is not pulled up under the title", () => {
  const rule = HTML.match(/\.rbz \.rbz-call\{([^}]*)\}/);
  assert.ok(rule, "the rule");
  const top = rule[1].match(/margin:\s*(-?[\d.]+)rem/);
  assert.ok(top && Number(top[1]) >= 0, "top margin is not negative: " + rule[1]);
  assert.match(MAIN, /<h1>[^<]+<\/h1>\s*<p class="rbz-call" id="rbz-call">/);
});

// 2026-10-19 (board seat C: "no picture of the box letter with a business note"). The code renders the real
// letter (components/rp-insert.js), so the sample is rendered by scripts/render_rp_business_letter.mjs from the
// saved 2012 Ames NOAA answers; the proof sheet and a logo print have no renderer and wait for Sig's photos.
test("the sample box letter with a business note: the real letter, small, captioned as a sample", () => {
  const fig = MAIN.match(/<figure class="rbz-fig rbz-fig-letter" id="rbz-letter">([\s\S]*?)<\/figure>/);
  assert.ok(fig, "the figure");
  const img = fig[1].match(/<img [^>]*>/)[0];
  assert.match(img, /src="\/img\/rain-print-business-letter-sample\.webp" width="600" height="776" loading="lazy"/);
  assert.match(img, /25\.52 inches, 32% less than usual/, "the alt's numbers are the Ames example's (test/rain-print-insert.test.mjs)");
  assert.match(fig[1], /This sample uses the 2012 Ames example and a sample note/);
  const buf = readFileSync(ROOT + "img/rain-print-business-letter-sample.webp");
  assert.equal(buf.toString("ascii", 0, 4), "RIFF"); assert.equal(buf.toString("ascii", 8, 12), "WEBP");
  assert.ok(buf.length <= 60 * 1024, "small: " + buf.length);
  const script = readFileSync(ROOT + "scripts/render_rp_business_letter.mjs", "utf8");
  assert.match(script, /components\/rp-insert\.js/);
  assert.match(script, /2012-ames-ia\.json/);
  assert.ok(!/—|archival|\$\d/.test(script.match(/export const NOTE = "([^"]*)"/)[1]), "the sample note follows the box rules");
  assert.doesNotMatch(MAIN, /proof-sheet-sample|logo-sample/, "no made-up proof sheet or logo picture");
});

// 2026-10-19: "Sample by" date. Sig has not confirmed one, so the data field is null and the page says nothing.
test("sample-by line: driven by business_sample_by, which stays null (nothing shown) until Sig sets it", () => {
  assert.ok(Object.prototype.hasOwnProperty.call(J, "business_sample_by"), "the field exists");
  assert.equal(J.business_sample_by, null, "Sig sets the date; until then null");
  assert.match(J._business_sample_by, /Sig sets this/);
  assert.equal(B.sampleByLine("2026-10-19", null), "");
  assert.equal(B.sampleByLine("2026-10-19", "2026-11-06"), "To see one before Christmas, order the sample by Nov 6.");
  assert.equal(B.sampleByLine("2026-11-06", "2026-11-06"), "To see one before Christmas, order the sample by Nov 6.", "through the day itself");
  assert.equal(B.sampleByLine("2026-11-07", "2026-11-06"), "", "gone the day after");
  assert.equal(B.sampleByLine("2026-10-19", "Nov 6"), "");
  assert.equal(B.sampleByLine("2026-10-19", "2026-13-01"), "");
  // no date written into the page: its line ships empty and hidden
  assert.match(MAIN, /so I can match it to your order\.<\/p>\s*<p class="rbz-sample" id="rbz-sample-by" hidden><\/p>/);
  assert.doesNotMatch(COPY, /sample by/i);
});

// 2026-10-20 (business walk-through: a 100-customer ship-to-each list with addresses did not fit 8,000 characters).
// A list shaped like the real thing, every name and address made up: 100 rows from the page's own template.
const FAKE_LIST = B.TEMPLATE + Array.from({ length: 100 }, (_, i) => {
  const n = String(i + 1).padStart(3, "0");
  return "The Example Farm " + n + " (Pat and Lee Testperson)," + ["Chetek", "Rice Lake", "Cameron", "Bloomer"][i % 4] + ",WI," +
    (2012 + (i % 14)) + ",\"N" + (1000 + i) + " Sample County Road M, Apt " + (i % 9 + 1) + ", Faketown, WI 5472" + (i % 10) +
    "\",Thanks for another good year from all of us at the co-op";
}).join("\r\n") + "\r\n";

test("a 100-customer list with mailing addresses fits the form and the worker; a longer one says to email it", async () => {
  const t = B.listText(FAKE_LIST);
  assert.ok(t, "the reader takes it");
  assert.equal(t.split("\n").length, 101, "header plus 100 customers");
  assert.ok(t.length > 14000 && t.length <= 20000, "real-shaped: about 150 characters a line, " + t.length);
  // over the cap: the reader refuses it and the page says to email the file (the fallback text stays)
  assert.equal(B.listText(FAKE_LIST + FAKE_LIST), null);
  assert.match(JS, /That list is longer than the form takes\. Send the rest of the form, and email the file to ' \+ ORDER_TO/);

  // the worker itself, against an in-memory KV: stored whole; one character over the cap is refused
  const { copyFileSync, unlinkSync } = await import("node:fs");
  const os = await import("node:os"), path = await import("node:path"), { pathToFileURL } = await import("node:url");
  const tmp = path.join(os.tmpdir(), "rpb-list-test-" + process.pid + ".mjs");
  copyFileSync(ROOT + "workers/subs-worker.js", tmp);
  const W = (await import(pathToFileURL(tmp).href)).default;
  unlinkSync(tmp);
  const store = new Map();
  const env = { UNSUB_SECRET: "sec", LIST_TOKEN: "tok", SUBS: {
    async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
    async list({ prefix, limit }) { const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort(); return { keys: all.slice(0, limit || 1000).map((name) => ({ name })), list_complete: true }; } } };
  let ip = 0;
  const post = (towns) => W.fetch(new Request("https://x.dev/form", { method: "POST",
    body: JSON.stringify({ kind: "rain-print-business", _gotcha: "", business: "Example Co-op", name: "Pat Testperson", email: "pat@example.com",
      phone: "", quantity: "100", product: "framed", towns, ship: "each", notes: "x".repeat(2000), page: "/rain-print-business" }),
    headers: { "Content-Type": "application/json", Origin: "https://agsist.com", "CF-Connecting-IP": "10.9.9." + (++ip) } }), env);
  const ok = await post(t);
  assert.equal(ok.status, 200, await ok.clone().text());
  const rec = [...store.entries()].filter(([k]) => k.startsWith("form:rain-print-business:")).map(([, v]) => JSON.parse(v));
  assert.equal(rec.length, 1);
  assert.equal(rec[0].towns, t, "stored whole, line breaks kept");
  const wide = await post("\u00f1".repeat(20000));   // 40,000 bytes of list in UTF-8 still under the body cap
  assert.equal(wide.status, 200, await wide.clone().text());
  const over = await post("x".repeat(20001));
  assert.equal(over.status, 400);
  assert.match((await over.json()).error, /towns is too long/);
});

// 2026-10-20 (business walk-through: the sample offer said "order one" with nowhere to click and no way for Sig to match it).
test("the sample offer links to the order box and says how Sig matches it; the sample date stays Sig's", () => {
  const p = MAIN.match(/<p class="rbz-sample" id="rbz-sample">([\s\S]*?)<\/p>/)[1];
  assert.match(p, /<a href="\/rain-print#rp-buy" data-rbz-cta="sample">Order one at the regular price<\/a> and I take it off your invoice when you order 10 or more\./);
  assert.match(p, /tick <b>This is a gift<\/b> and put your business name in the note, so I can match it to your order\./);
  // the words match the real checkout: the order box is #rp-buy, and its gift tick says "This is a gift"
  const RPH = readFileSync(ROOT + "rain-print.html", "utf8");
  assert.match(RPH, /id="rp-buy"/);
  assert.match(RPH, /tick <b>This is a gift<\/b> and add their name and your note/);
  assert.equal(J.business_sample_by, null);
});
