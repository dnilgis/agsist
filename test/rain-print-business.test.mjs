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
  assert.match(MAIN, /id="rb-towns" maxlength="8000"/);
  // GA4 on every CTA
  for (const e of ["rain_print_business", "rp_business_cta", "rp_business_template", "rp_business_csv"]) assert.ok(JS.includes("'" + e + "'"), e);
  assert.ok((MAIN.match(/data-rbz-cta=/g) || []).length >= 3);
});

test("the CSV reader keeps the rows, drops blank ones, refuses a list the form can't hold", () => {
  assert.equal(B.listText("﻿Name,Town\r\nThe Olson Farm,Chetek\r\n,,\r\n\r\nBerg,Cameron  \n"), "Name,Town\nThe Olson Farm,Chetek\nBerg,Cameron");
  assert.equal(B.listText(""), "");
  assert.equal(B.listText("x,".repeat(4001)), null);
  assert.match(B.TEMPLATE, /^Name for the print,Town,State,Year,Mailing address/);
});

test("standing rules: no sponsor, name off the print, honest copy", () => {
  assert.ok(!/sponsor/i.test(MAIN), "no sponsor on a Rain Print page");
  assert.match(COPY, /business name stays off the print/);
  assert.match(COPY, /logo can go on it, small, next to their name/);
  assert.match(COPY, /note card in the box/);
  assert.match(COPY, /No prices go in the box/);
  assert.match(COPY, /net 30/);
  assert.match(COPY, /W-9 on request/);
  assert.match(COPY, /one proof sheet/);
  assert.match(COPY, /Mockup of a framed print/);
  assert.ok(!/—|&mdash;/.test(HTML), "no em dashes");
  assert.ok(!/—/.test(JS), "no em dashes in the script's copy");
  assert.ok(!/compliments of|archival|founding|only \d+ left|hurry|limited time|best[- ]selling|\d+ (businesses|elevators) (have )?(ordered|trust)/i.test(COPY), "no claims Sig ruled out, no fake scarcity or counts");
  assert.ok(!/amazon|walmart|etsy|tractor supply|fleet farm|costco|staples|fedex office|printful/i.test(HTML), "no store or printer names");
});
