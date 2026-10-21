/* Rain Print: the letter that goes on top in every print box (2026-10-17,
 * components/rp-insert.js, made on the maker page by "Insert letter PDF").
 *
 * Checks, on the real 2012 Ames NOAA answers saved for the example print
 * (data/rain-print-examples/2012-ames-ia.json): every number on the letter is
 * the one the print itself shows (the art and the letter both drawn here from
 * the same input, in both styles); the giver's note is there only when the
 * order has one; the serial and the maker line; nothing runs past the foot even
 * with the longest note and five marked days; no em dashes, no "archival", no
 * prices; the maker page has the button and the note box, and the engine makes
 * the letter the way it makes the order files.
 *
 *   node --test test/rain-print-insert.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctx.window = ctx;
for (const f of ["components/qr.js", "components/rain-print.js", "components/rain-print-art.js", "components/rp-insert.js"]) vm.runInNewContext(read(f), ctx);
const RP = ctx.RainPrint, A = ctx.AgRainArt, INS = ctx.AgRpInsert;

// the year as the engine reads it (the same steps as test/rain-print-examples.test.mjs), with NOAA's normal
const ex = JSON.parse(read("data/rain-print-examples/2012-ames-ia.json"));
const sidOf = (u) => new URL(u).searchParams.get("sid");
const q = ex.requests.filter((r) => r.url.includes("StnData?sid=") && sidOf(r.url) === ex.station && new URL(r.url).searchParams.get("sdate") !== "por").pop();
const days = RP.closeOpenS(q.body.data.map((row, i) => {
  const p = RP.parsePcpn(row[1]), dt = new Date(row[0] + "T00:00:00");
  return { date: row[0], v: p.v, flag: p.flag, t: null, s: row[3] !== undefined ? RP.parsePcpn(row[3]).v : null, m: dt.getMonth(), d: dt.getDate(), doy: i };
}));
const D = RP.derive(days);
const nq = ex.requests.find((r) => r.url.includes("StnData?params=") && decodeURIComponent(r.url).includes('"normal"'));
const byDate = new Map();
nq.body.data.forEach((row) => { const v = RP.parsePcpn(row[1]).v; if (v !== null) byDate.set(row[0].slice(5), v); });
const ov = RP.overlayDaily(days, byDate);

function input(style, markers) {
  return {
    style, year: 2012, place: "Ames, Iowa", name: "", dedication: "", days, D, showDry: RP.showDry(D), axisLen: D.n,
    ov, ovNote: RP.cmpNoteFor("normal"), showNormals: true, markers: RP.markersOn(markers || [], 2012, D.n), records: [],
    qr: { matrix: RP.standardMatrix(), serial: "No. 0001" }, preview: null, gauge: "Weather station: Ames, IA, 2.0 mi from Ames"
  };
}
function make(style, opts) {
  opts = opts || {};
  const I = input(style, opts.markers);
  const art = A.render(I);
  const F = A.facts(I, { unplaced: A.lastUnplaced() });
  const o = { facts: F, mini: art, serial: opts.serial === undefined ? "No. 0001" : opts.serial, gift: opts.gift || "", qr: RP.standardMatrix(),
    station: { words: "Ames, IA", away: "2.0 miles", kind: "volunteer" }, source: "NOAA’s daily records", offer: opts.offer, today: opts.today };
  const svg = INS.render(o);
  return { art, F, svg, copy: INS.copy(o), overflow: INS.lastOverflow() };
}
// the words on a sheet, one string per <text>, tspans joined in
const texts = (svg) => [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'));
// the letter's own words, without the small print drawn inside it
const letterTexts = (svg) => texts(svg.replace(/<svg x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*"[\s\S]*?<\/svg>/, ""));

test("the letter's numbers are the print's numbers (2012 Ames, Staircase)", () => {
  const { art, F, svg } = make("r1", { markers: [{ date: "2012-05-01", label: "Planted" }] });
  const P = texts(art).join(" | "), L = letterTexts(svg).join(" | ");
  // the engine's own year (the page's numbers box reads the same D)
  assert.equal(F.totalText, D.total.toFixed(2) + " in");
  assert.equal(F.totalText, "25.52 in");
  assert.equal(F.wet.amount, "1.89 in"); assert.equal(F.wet.date, "2012-04-15");
  assert.equal(F.snowText, "28.3 in");
  assert.equal(F.verdict, "32% less than a usual year");
  assert.equal(F.usual, "37.73 in");
  assert.equal(F.usual, ov.total.toFixed(2) + " in");
  assert.equal(F.wetDays, D.wet); assert.equal(F.wetDays, 95);
  assert.equal(F.dry.len, D.dryMax.len); assert.equal(F.dry.len, 24);
  // each one on the print
  for (const s of ["25.52 in", "Biggest rain: 1.89 in", "Apr 15", "32% less than a usual year", "37.73 in", "Days with rain or snow: 95", "Snow: 28.3 in", "24 dry days", "Planted"]) assert.ok(P.includes(s), "the print says " + s + ": " + P.slice(0, 400));
  // and the same on the letter
  for (const s of ["25.52 in", "rain and melted snow", "Biggest rain", "1.89 in", "April 15", "28.3 in", "32% less than a usual year", "usual: 37.73 in, NOAA’s 30-year normal", "95", "24 days", "September 19 to October 12", "Planted, May 1"]) assert.ok(L.includes(s), "the letter says " + s + ": " + L);
  // the dry stretch the letter names is the print's (September 19 to October 12 = 24 days)
  assert.equal(F.dry.from, "2012-09-19"); assert.equal(F.dry.to, "2012-10-12");
  assert.equal((Date.parse(F.dry.to) - Date.parse(F.dry.from)) / 864e5 + 1, 24);
});

test("Roots: the same numbers, the Roots key, and the print drawn inside the letter", () => {
  const { art, F, svg, copy } = make("r2");
  const P = texts(art).join(" | ");
  assert.equal(F.style, "r2");
  for (const s of ["25.52 in", "28.3 in", "32% less than a usual year", "Biggest rain: 1.89 in", "24 dry days"]) assert.ok(P.includes(s), "the Roots print says " + s);
  assert.ok(copy.key.some((k) => k[0] === "bar") && !copy.key.some((k) => k[0] === "climb"), "the Roots key, not the Staircase one");
  assert.ok(svg.includes('<svg x="'), "the print itself is drawn small inside the letter");
  assert.ok(letterTexts(svg).join(" ").includes("24 days"));
});

test("a Staircase dry stretch under 14 days is not on the print, so not on the letter", () => {
  const I = input("r1");
  I.D = Object.assign({}, D, { dryMax: Object.assign({}, D.dryMax, { len: 10 }) });
  assert.equal(A.facts(I).dry, null, "Staircase marks a dry stretch from 14 days");
  I.style = "r2";
  assert.equal(A.facts(I).dry.len, 10, "Roots marks any the engine shows (7 days up)");
});

test("the giver's note shows only when the order has one", () => {
  const none = make("r1");
  assert.ok(!none.svg.includes('data-rp="gift"') && !none.svg.includes("A NOTE FOR YOU"), "no note, no block");
  const g = make("r1", { gift: "For Dad, for 40 harvests <b>" });
  assert.ok(g.svg.includes('data-rp="gift"') && g.svg.includes("A NOTE FOR YOU"));
  assert.ok(letterTexts(g.svg).join(" ").includes("For Dad, for 40 harvests <b>"));
  assert.ok(!g.svg.includes("<b>"), "the note is escaped");
  // a business's message says who it is from
  const o = { facts: g.F, mini: "", serial: "No. 0002", gift: "Thanks for another year.", giftFrom: "Chetek Co-op", qr: RP.standardMatrix(), station: { words: "Ames, IA", away: "2.0 miles", kind: "volunteer" } };
  assert.ok(letterTexts(INS.render(o)).includes("A NOTE FROM CHETEK CO-OP"));
  assert.equal(INS.copy(Object.assign({}, o, { giftFrom: "" })).giftHead, "A NOTE FOR YOU");
});

test("the serial and Sig's maker line; a blank to fill in without a serial", () => {
  const a = letterTexts(make("r1").svg).join(" ");
  assert.match(a, /Print No\. 0001, made, numbered and initialed/);
  assert.match(a, /initialed by hand by Sigurd Lindquist, CCA\./, "the standing byline, no town");
  assert.doesNotMatch(a, /Sig Lindquist|Chetek/);
  assert.match(a, /From the NOAA gauge at Ames, IA, 2\.0 miles away, kept by a volunteer observer\./);
  assert.equal((a.match(/Ames/g) || []).length, 2, "the town once in the opening line, once in the station's name: " + a);
  assert.match(a, /Draw another year at agsist\.com\/rain-print/);
  const b = letterTexts(make("r1", { serial: "" }).svg).join(" ");
  assert.match(b, /Print No\. ______, made/);
  assert.ok(make("r1").svg.includes('data-rp="qr"'), "the standard code at the foot");
});

test("nothing runs past the foot, even with the longest note and five marked days", () => {
  const long = "Thanks for another year. From all of us at the elevator. ".repeat(10).slice(0, 300);
  const marks = [["2012-04-20", "Planted"], ["2012-06-10", "Hail"], ["2012-08-01", "Wedding"], ["2012-10-01", "Harvest"], ["2012-12-01", "Done"]].map(([date, label]) => ({ date, label }));
  for (const st of ["r1", "r2"]) {
    const m = make(st, { gift: long, markers: marks });
    assert.equal(m.overflow, 0, st + " fits");
    const ys = [...m.svg.replace(/<svg x="[\s\S]*?<\/svg>/, "").matchAll(/<text x="[^"]*" y="([\d.]+)"/g)].map((x) => +x[1]);
    assert.ok(Math.max(...ys) <= INS.H - 50, st + ": every line inside the 0.5 in margin: " + Math.max(...ys));
    assert.ok(Math.min(...[...m.svg.replace(/<svg x="[\s\S]*?<\/svg>/, "").matchAll(/<text x="([\d.]+)"/g)].map((x) => +x[1])) >= 48, st + ": inside the left margin");
  }
});

test("plain words: no em dashes, never archival, no prices or store names", () => {
  const src = read("components/rp-insert.js");
  assert.ok(!src.includes("—") && !src.includes("&mdash;"), "no em dash in the source");
  for (const st of ["r1", "r2"]) {
    const words = letterTexts(make(st, { gift: "For Dad", markers: [{ date: "2012-05-01", label: "Planted" }] }).svg).join(" ");
    assert.ok(!words.includes("—"), "no em dash on the letter");
    assert.doesNotMatch(words, /archival|\$|Etsy|Amazon|Shopify|Stripe|printer|limited|only \d+/i);
  }
});

test("the maker page has the button and the note box; the engine makes the letter like the order files", () => {
  const html = read("rain-print.html"), js = read("components/rain-print.js");
  const maker = html.match(/<div class="rp-maker" id="rp-maker" hidden>([\s\S]*?)\n          <\/div>\n        <\/section>/);
  assert.ok(maker, "the maker box");
  assert.match(maker[1], /<button class="btn btn-secondary" type="button" data-size="insert" data-fmt="pdf">Insert letter PDF<\/button>/);
  assert.match(maker[1], /<textarea id="rp-ins-gift" maxlength="300"/, "room for the longest note: a gift note (240) or a business's note for every print (300)");
  assert.match(html, /id="ro-gift-msg" maxlength="240"/);
  assert.match(html, /id="rb-note-all" maxlength="300"/);
  assert.match(maker[1], /<input id="rp-ins-from" type="text" maxlength="40">/, "who a business note is from");
  assert.match(js, /sc\.src = '\/components\/rp-insert\.js\?v=\d+'/, "loaded on first use");
  assert.match(js, /root\.AgRainArt\.facts\(I, \{ unplaced: root\.AgRainArt\.lastUnplaced\(\) \}\)/, "the print's own facts, after the print's own render");
  assert.match(js, /pdfFromJpeg\(new Uint8Array\(buf\), c\.width, c\.height, LETTER, 0\)/, "a letter-size PDF with no bleed");
  assert.match(js, /var LETTER = \{ w: 8\.5, h: 11/);
  // the care line's frame is the paper's own size (13 x 19, Sig 2026-10-17) and its mat's
  assert.match(js, /var SHEET = \{ w: 19, h: 13, art: \{ w: 16\.5, h: 11 \}, mat: \{ w: 16\.5, h: 10\.5 \}/);
  assert.match(read("components/rp-insert.js"), /A loose print fits a standard 13 x 19 frame with an 11 x 17 mat\./);
  assert.match(js, /if \(PREVIEW\) \{ out\.textContent = 'The letter is made from the full year/, "no letter from a part year");
  assert.match(js, /data-size'\) === 'insert'\) insertFile\(b\)/);
  assert.ok(!/rp-insert\.js/.test(html), "not loaded with the page");
});

test("What's in the box: the public block, the sample letter and the FAQ, word for word", () => {
  const html = read("rain-print.html");
  const box = html.match(/<section class="rp-sec rp-inbox" id="rp-inbox" aria-labelledby="rp-inbox-h">([\s\S]*?)<\/section>/);
  assert.ok(box, "the block is on the page");
  const b = box[1];
  assert.match(b, /<h2 class="sec-h" id="rp-inbox-h">What&rsquo;s in the box<\/h2>/);
  assert.ok(!/\.rp-box\{/.test(html.slice(html.indexOf(".rp-inbox"), html.indexOf(".rp-inbox") + 50)) && !/class="[^"]*\brp-box\b[^"]*" id="rp-inbox"/.test(html), "its own class, not the price box's .rp-box");
  for (const s of ["The print</b>, flat between chipboard", "the framed print</b>, packed with corner guards and foam and double-boxed", "A letter on top</b>", "Your note, printed at the top of the letter</b>, when it&rsquo;s a gift", "There&rsquo;s no separate card", "No prices go in the box.</b>"]) assert.ok(b.includes(s), s);
  assert.doesNotMatch(b, /on a card/);
  const img = b.match(/<img [^>]*>/)[0];
  assert.match(img, /src="\/img\/rain-print-insert-letter-sample\.webp"/);
  assert.match(img, /width="600" height="776"/); assert.match(img, /loading="lazy"/); assert.match(img, /alt="A sample of the letter for the 2012 Ames/);
  const f = ROOT + "img/rain-print-insert-letter-sample.webp", buf = readFileSync(f);
  assert.equal(buf.toString("ascii", 0, 4), "RIFF"); assert.equal(buf.toString("ascii", 8, 12), "WEBP");
  assert.ok(buf.length <= 60 * 1024, "the sample letter is small: " + buf.length);
  assert.match(b, /<figcaption>The letter that comes with every print: what it is, how to read it, and your year in numbers\./);
  // the numbers the alt text names are the letter's (and the print's) for 2012 Ames
  const F = make("r1").F;
  assert.ok(img.includes(F.total.toFixed(2) + " inches") && img.includes(F.verdict), "the alt's numbers are the letter's");
  assert.ok(!/—|&mdash;|sponsor|printer/i.test(b), "no em dash, no sponsor, no printer");
  // the FAQ: shown and in FAQPage the same
  const shown = html.match(/<details><summary>What comes in the box\?<\/summary><p>([\s\S]*?)<\/p><\/details>/);
  assert.ok(shown, "the FAQ entry is on the page");
  const LD = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const q = LD["@graph"].find((g) => g["@type"] === "FAQPage").mainEntity.find((x) => x.name === "What comes in the box?");
  assert.ok(q, "in FAQPage");
  assert.equal(shown[1].replace(/&rsquo;/g, "’"), q.acceptedAnswer.text);
  assert.match(q.acceptedAnswer.text, /corner guards and foam and double-boxed.*If it’s a gift, your note is printed at the top of that letter\. No prices go in the box\./);
  // Sig, 2026-10-17: no separate note card anywhere on the page, in the FAQ or in FAQPage; the note is on the letter
  assert.doesNotMatch(html, /note card|on a card in the box|a note for a card|on a card and put it/);
  const ship = LD["@graph"].find((g) => g["@type"] === "FAQPage").mainEntity.find((x) => x.name === "Can you ship it straight to them with a note?");
  assert.match(ship.acceptedAnswer.text, /your note printed at the top of the letter in the box, at no charge\. No prices go in the box\./);
  const js = read("components/rain-print.js");
  assert.match(js, /I print your note at the top of the letter in the box, free, and no prices go in the box\./, "#rp-gift-line as the page sets it");
  assert.match(js, /'I print the note at the top of the letter in the box\. No prices go in\.'/, "#ro-gift-line as the page sets it");
  assert.doesNotMatch(js, /note card|on a card/);
  // the emailed under-the-tree gift card for this year's Christmas orders stays
  assert.match(html, /I email you a gift card to print for under the tree/);
});

// the "next print" code line (Sig, 2026-10-17): off until data/rain-print.json letter_offer has a code
// 2026-10-19 (Rain Print audit): the Stripe coupon is good on a print or a framed print only, not the
// digital file, so the line says so ("for $10 off a print or framed print"); it said "for $10 off" before
const OFFER = { code: "rain10", dollars_off: 10, expires: "2027-12-31" };
const OFFER_WORDS = "Want one for another year or another farm? Use code RAIN10 for $10 off a print or framed print at agsist.com/rain-print. Good through December 31, 2027.";

test("the code line: on with Sig's Stripe code NEXTPRINT, $10 off print and framed, through Dec 31, 2027 (Sig, 2026-10-19)", () => {
  const J = JSON.parse(read("data/rain-print.json"));
  assert.deepEqual(J.letter_offer, { code: "NEXTPRINT", dollars_off: 10, expires: "2027-12-31" }, "the Stripe promotion code Sig made Oct 18 (coupon Next Rain Print, $10 off once)");
  assert.ok(J._letter_offer.includes("Allow promotion codes"), "the note says what to turn on in Stripe");
  assert.equal(INS.offerLine(J.letter_offer, "2027-01-10"), "Want one for another year or another farm? Use code NEXTPRINT for $10 off a print or framed print at agsist.com/rain-print. Good through December 31, 2027.");
  assert.equal(INS.offerLine(J.letter_offer, "2028-01-01"), "", "no line after it ends");
  for (const st of ["r1", "r2"]) {
    const m = make(st, { offer: J.letter_offer, today: "2027-01-10" });
    assert.ok(m.svg.includes('data-rp="offer"'), st + ": the code line");
  }
  // an empty code still prints nothing (the switch Sig used until Oct 19)
  assert.equal(INS.offerLine({ code: "", dollars_off: 0, expires: "" }, "2027-01-10"), "");
  // anything it cannot read prints nothing
  for (const bad of [null, {}, { code: "", dollars_off: 10, expires: "2027-12-31" }, { code: "RAIN10", dollars_off: 0, expires: "2027-12-31" },
    { code: "RAIN10", dollars_off: "10", expires: "2027-12-31" }, { code: "RAIN10", dollars_off: 9.5, expires: "2027-12-31" },
    { code: "RAIN 10", dollars_off: 10, expires: "2027-12-31" }, { code: "RAIN10", dollars_off: 10, expires: "2027-02-30" }, { code: "RAIN10", dollars_off: 10, expires: "12/31/2027" }])
    assert.equal(INS.offerLine(bad, "2027-01-10"), "", JSON.stringify(bad));
  // past its last day: no line; on the last day: the line
  assert.equal(INS.offerLine(OFFER, "2028-01-01"), "");
  assert.equal(INS.offerLine(OFFER, "2027-12-31"), OFFER_WORDS);
  // no end date: no "Good through"
  assert.equal(INS.offerLine({ code: "RAIN10", dollars_off: 15, expires: "" }, "2027-01-10"), "Want one for another year or another farm? Use code RAIN10 for $15 off a print or framed print at agsist.com/rain-print.");
});

test("the code line: on the letter when set, and the page still fits with the longest note and five marked days", () => {
  const long = "Thanks for another year. From all of us at the elevator. ".repeat(10).slice(0, 300);
  const marks = [["2012-04-20", "Planted"], ["2012-06-10", "Hail"], ["2012-08-01", "Wedding"], ["2012-10-01", "Harvest"], ["2012-12-01", "Done"]].map(([date, label]) => ({ date, label }));
  for (const st of ["r1", "r2"]) for (const full of [false, true]) {
    const m = make(st, full ? { gift: long, markers: marks, offer: OFFER, today: "2027-01-10" } : { offer: OFFER, today: "2027-01-10" });
    const L = letterTexts(m.svg).join(" ");
    assert.ok(m.svg.includes('data-rp="offer"'), st + ": the code line");
    assert.ok(L.replace(/\s+/g, " ").includes(OFFER_WORDS), st + ": the words: " + L);
    assert.equal(m.overflow, 0, st + (full ? " full" : "") + " fits");
    const body = m.svg.replace(/<svg x="[\s\S]*?<\/svg>/, "");
    const ys = [...body.matchAll(/<text x="[^"]*" y="([\d.]+)"/g)].map((x) => +x[1]);
    assert.ok(Math.max(...ys) <= INS.H - 50, st + ": inside the bottom margin: " + Math.max(...ys));
    // the line sits under everything above the foot, never on top of it
    const oys = [...body.match(/<g data-rp="offer">([\s\S]*?)<\/g>/)[1].matchAll(/y="([\d.]+)"/g)].map((x) => +x[1]);
    const before = [...body.slice(0, body.indexOf('<g data-rp="offer">')).matchAll(/<text x="[^"]*" y="([\d.]+)"/g)].map((x) => +x[1]);
    assert.ok(Math.min(...oys) - Math.max(...before) >= 18, st + ": room above the code line");
    assert.ok(!L.includes("—"), "no em dash");
    assert.doesNotMatch(L, /archival|Stripe|hurry|act now|limited|!/i, "plain words");
  }
  assert.doesNotMatch(read("components/rp-insert.js"), /—|&mdash;/);
});

test("the code line with the real code (NEXTPRINT, print or framed print) fits every letter variant", () => {
  const J = JSON.parse(read("data/rain-print.json"));
  const words = INS.offerLine(J.letter_offer, "2027-01-10");
  assert.equal(words, "Want one for another year or another farm? Use code NEXTPRINT for $10 off a print or framed print at agsist.com/rain-print. Good through December 31, 2027.");
  const long = "Thanks for another year. From all of us at the elevator. ".repeat(10).slice(0, 300);
  const marks = [["2012-04-20", "Planted"], ["2012-06-10", "Hail"], ["2012-08-01", "Wedding"], ["2012-10-01", "Harvest"], ["2012-12-01", "Done"]].map(([date, label]) => ({ date, label }));
  for (const st of ["r1", "r2"]) for (const v of [{}, { gift: long }, { markers: marks }, { gift: long, markers: marks }, { gift: long, markers: marks, serial: "" }]) {
    const m = make(st, Object.assign({ offer: J.letter_offer, today: "2027-01-10" }, v));
    const tag = st + " " + Object.keys(v).join("+");
    assert.ok(letterTexts(m.svg).join(" ").replace(/\s+/g, " ").includes(words), tag + ": the whole line is on the letter");
    assert.equal(m.overflow, 0, tag + " fits");
  }
});

test("the engine hands the letter the offer from the prices it already loads", () => {
  const js = read("components/rain-print.js");
  assert.match(js, /offer: \(PRICES && PRICES\.letter_offer\) \|\| null, today: TODAY/);
  assert.match(js, /sc\.src = '\/components\/rp-insert\.js\?v=6'/);
  // checkout: the Stripe link only gains client_reference_id; nothing strips a promotion code
  assert.doesNotMatch(js, /promotion_code|promo_code/i);
});

// ---------- the reading guide (Sig, 2026-10-20): "How to read your Rain Print", sent with a digital file ----------
// what the engine reads from the print's own groups (components/rain-print.js insertSvg), the same tests on the same SVG
const DRAWN_RE = { hist: /data-rp="hist"/, rec: /data-rp="rec:/, frost: /data-rp="frost:/, crop: /data-rp="crop"/, ribbon: /data-rp="ribbon"/, qr: /data-rp="qr"/ };
const drawnOf = (art) => Object.fromEntries(Object.entries(DRAWN_RE).map(([k, re]) => [k, re.test(art)]));
function guide(style, opts) {
  opts = opts || {};
  const I = Object.assign(input(style, opts.markers), { qr: { matrix: RP.standardMatrix(), serial: "" } }, opts.extra || {});
  const art = A.render(I);
  const F = A.facts(I, { unplaced: A.lastUnplaced() });
  const o = { facts: F, mini: art, serial: "", guide: true, drawn: drawnOf(art), gift: opts.gift || "", qr: RP.standardMatrix(),
    station: { words: "Ames, IA", away: "2.0 miles", kind: "volunteer" }, source: "NOAA’s daily records", offer: { code: "NEXTPRINT", dollars_off: 10, expires: "2027-12-31" }, today: "2026-10-20" };
  const svg = INS.render(o);
  return { art, F, svg, copy: INS.copy(o), overflow: INS.lastOverflow(), drawn: o.drawn };
}
const REC = [{ label: "Wettest week: 3.10 in", span: { from: "2012-06-01", to: "2012-06-07" } }];

test("the guide: its title, no serial, no pencil line, no code line, Sig's plain maker line, printing tips", () => {
  const g = guide("r1");
  const w = letterTexts(g.svg).join(" | "), ws = letterTexts(g.svg).join(" ");
  assert.equal(g.copy.head, "How to read your Rain Print");
  assert.ok(w.includes("How to read your Rain Print"));
  assert.doesNotMatch(w, /No\. \d|No\. ___|initialed|pencil/, "a digital file has no serial");
  assert.doesNotMatch(w, /NEXTPRINT|off a print/, "the box letter's code line is not on the guide");
  assert.match(ws, /Made by Sigurd Lindquist, CCA, Chetek, Wisconsin\./);
  assert.match(ws, /PRINTING IT Print the PDF at 100% \(Actual size\), never Fit to page\./);
  assert.equal(g.overflow, 0);
  assert.doesNotMatch(w, /—|archival|\$/);
  const exp = (s) => s.replace(/<svg x="[\s\S]*?<\/svg>/, "");
  assert.ok(!exp(make("r1").svg).includes("How to read your Rain Print") && exp(make("r1").svg).includes("Print No. 0001"), "the box letter is unchanged");
});

test("the guide's key says only what the print draws, and each line matches the drawing", () => {
  const C = A.COLORS;
  // Staircase with the 30-year normal: the blue line, the red step, the dashed usual line with the tan and blue bands
  const g = guide("r1");
  const keys = g.copy.key.map((k) => k[0]);
  assert.deepEqual([...keys.filter((k) => ["climb", "wet", "usual", "months", "dry", "qr"].includes(k))], ["climb", "wet", "usual", "months", "dry", "qr"], keys.join());
  assert.ok(g.art.includes('stroke="' + C.rain + '"'), "the blue line is the rain color");
  assert.match(g.art, /<g data-rp="wet"><line [^>]*stroke="#B23A2E"/, "the red step");
  assert.match(g.art, /<g data-rp="usual"><path [^>]*stroke-dasharray/, "the usual year is a dashed line");
  assert.ok(g.art.includes('fill="' + C.dryBand + '"') && g.art.includes('fill="' + C.wetBand + '"'), "tan behind, pale blue ahead");
  assert.match(g.art, /<g data-rp="qr">/, "the code is drawn");
  const qx = [...g.art.matchAll(/<g data-rp="qr">[\s\S]*?<rect x="([\d.]+)" y="([\d.]+)"/g)].map((m) => [+m[1], +m[2]])[0];
  assert.ok(qx[0] > 1400 && qx[1] > 900, "in the corner (lower right): " + qx);
  assert.ok(!keys.includes("rec") && !keys.includes("hist") && !keys.includes("frost") && !keys.includes("crop") && !keys.includes("ribbon"), "no extras, no extra lines");
  // remarkable days on: an open circle, and the key says so
  const r = guide("r1", { extra: { records: REC } });
  assert.ok(r.drawn.rec && r.copy.key.some((k) => k[0] === "rec"));
  assert.match(r.art, /<g data-rp="rec:0"><circle [^>]*fill="#FFFFFF"/, "an open circle");
  const r2 = guide("r2", { extra: { records: REC } });
  assert.match(r2.art, /<g data-rp="rec:0">[\s\S]*?<circle [^>]*fill="#FFFFFF"/, "an open circle on Roots too");
  // Roots: the bars, the months across the top
  const ro = guide("r2");
  assert.ok(ro.copy.key.some((k) => k[0] === "bar") && ro.copy.key.some((k) => k[0] === "monthsTop") && ro.copy.key.some((k) => k[0] === "qr"));
  // the other years' lines: no tan and blue bands are drawn, and neither the guide nor the letter says there are
  const threads = [{ year: 2000, cum: Array.from({ length: 366 }, (_, i) => i * 0.08) }, { year: 2001, cum: Array.from({ length: 366 }, (_, i) => i * 0.1) }];
  const h = guide("r1", { extra: { hist: { threads, labels: { wet: [2001], dry: [2000] }, foot: "Gray lines: the other 2 full years" } } });
  assert.ok(h.drawn.hist, "the threads are drawn");
  assert.ok(!h.art.includes('fill="' + C.dryBand + '"') && !h.art.includes('fill="' + C.wetBand + '"'), "no bands with the threads");
  const u = h.copy.key.find((k) => /^usual/.test(k[0]));
  assert.equal(u[1], "Dashed line: a usual year.");
  assert.ok(h.copy.key.some((k) => k[0] === "hist"));
  const L = INS.copy({ facts: h.F, station: {}, drawn: h.drawn });
  assert.equal(L.key.find((k) => /^usual/.test(k[0]))[1], "Dashed line: a usual year.", "the box letter too");
});

test("the guide fits one page with the longest note, five marked days and every extra key", () => {
  // a digital file's note is a gift note from the order form (ro-gift-msg, 240 characters at most); business notes go on print boxes
  const long = "For every inch of rain you farmed through. ".repeat(8).slice(0, 240);
  const marks = [["2012-04-20", "Planted"], ["2012-06-10", "Hail"], ["2012-08-01", "Wedding"], ["2012-10-01", "Harvest"], ["2012-12-01", "Done"]].map(([date, label]) => ({ date, label }));
  for (const st of ["r1", "r2"]) {
    const g = guide(st, { gift: long, markers: marks, extra: { records: REC } });
    const o = { facts: g.F, mini: g.art, serial: "", guide: true, drawn: { hist: true, rec: true, frost: true, crop: true, ribbon: true, qr: true }, gift: long, qr: RP.standardMatrix(),
      station: { words: "Ames, IA", away: "2.0 miles", kind: "volunteer" } };
    INS.render(o);
    assert.equal(INS.lastOverflow(), 0, st + " fits");
  }
});

test("the maker page has the digital PDF, JPG and the guide; the engine makes them", () => {
  const html = read("rain-print.html"), js = read("components/rain-print.js");
  assert.match(html, /data-size="digital" data-fmt="pdf">Digital file PDF</);
  assert.match(html, /data-size="digital" data-fmt="jpg">Digital file JPG</);
  assert.match(html, /data-size="guide" data-fmt="pdf">Reading guide PDF</);
  for (const [k, re] of Object.entries(DRAWN_RE)) assert.ok(js.includes(k + ": " + re.toString() + ".test(mini)"), "the engine reads " + k + " the same way");
  assert.match(js, /var page = kind === 'digital' \? PRINT\[ST\.size\] : SHEET;/, "the digital PDF is the art alone");
  assert.match(js, /var PRINT = \{ '12x18': \{ w: 18, h: 12/);
});

test("jpegWithDpi marks a JPEG 300 dpi", () => {
  const jfif = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
  const out = RP.jpegWithDpi(jfif, 300);
  assert.deepEqual([...out.slice(13, 18)], [1, 1, 44, 1, 44]);
  const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 2, 0xff, 0xd9]);
  const o2 = RP.jpegWithDpi(bare, 300);
  assert.deepEqual([...o2.slice(2, 12)], [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  assert.deepEqual([...o2.slice(-6)], [0xff, 0xdb, 0, 2, 0xff, 0xd9]);
  assert.deepEqual([...RP.jpegWithDpi(new Uint8Array([1, 2, 3]), 300)], [1, 2, 3], "not a JPEG: unchanged");
});
