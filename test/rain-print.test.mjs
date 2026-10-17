/* Rain Print (/rain-print): the design code and query string that the QR mark,
 * Stripe's client_reference_id and the order form carry, and the prices the
 * page states against data/rain-print.json.
 *
 * The shipped components/rain-print.js runs in a bare context (no document),
 * which loads only its pure parts, so a green run checks the copy the browser runs.
 *
 *   node --test test/rain-print.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctx.window = ctx;
vm.runInNewContext(readFileSync(ROOT + "components/qr.js", "utf8"), ctx);
vm.runInNewContext(readFileSync(ROOT + "components/rain-print.js", "utf8"), ctx);
const RP = ctx.RainPrint;
const plain = (x) => JSON.parse(JSON.stringify(x));

const FULL = {
  place: "Chetek, WI", station: "471667 2", year: 2025, layout: "staircase", palette: "night", size: "12x18",
  cmp: "normal", name: "The Olson Farm",
  markers: [{ date: "2025-05-12", label: "Planted" }, { date: "2025-07-04", label: "Wedding" }, { date: "2025-10-20", label: "Harvest done" }],
};

test("design code round-trips every choice", () => {
  const code = RP.encodeCode(FULL);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(plain(RP.decodeCode(code)), plain(RP.normalize(FULL)));
  for (const layout of ["staircase", "waveform"]) for (const palette of ["paper", "night", "blueprint"])
    for (const cmp of ["none", "normal", "station"]) for (const size of ["12x18"]) {
      const s = { ...FULL, layout, palette, cmp, size };
      assert.deepEqual(plain(RP.decodeCode(RP.encodeCode(s))), plain(RP.normalize(s)), `${layout} ${palette} ${cmp} ${size}`);
    }
});

test("one print size: 12 x 18; a code from when 18 x 24 was offered opens as 12 x 18", () => {
  assert.equal(RP.normalize({ ...FULL, size: "18x24" }).size, "12x18");
  const old = Buffer.from("1|Chetek, WI|471667 2|2025|snnb|The Olson Farm").toString("base64url");
  const back = RP.decodeCode(old);
  assert.ok(back && back.size === "12x18" && back.place === "Chetek, WI", "old 18 x 24 code still opens");
});

test("query string round-trips, and ?d= resolves to the same design", () => {
  const q = RP.toParams(FULL);
  assert.deepEqual(plain(RP.fromParams("?" + q)), plain(RP.normalize(FULL)));
  assert.deepEqual(plain(RP.fromParams("?d=" + RP.encodeCode(FULL))), plain(RP.normalize(FULL)));
  assert.ok(RP.designUrl(FULL).startsWith("https://agsist.com/rain-print?place=Chetek%2C+WI&year=2025"));
  assert.equal(RP.shortUrl(FULL), "https://agsist.com/rain-print?d=" + RP.encodeCode(FULL));
});

test("a hand-written link (no style=) opens as a new visitor: the 30-year normal, its normals and the remarkable days on (2026-10-15)", () => {
  const html = readFileSync(ROOT + "rain-print.html", "utf8");
  const stories = [...html.matchAll(/<a class="rp-story"[^>]*href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  assert.equal(stories.length, 2);
  // the story links, a county rain page's link (scripts/build_county_rain.py rain_print_href), an email's plain link
  const hand = stories.map((h) => h.split("?")[1]).concat([
    "place=Ames%2C+IA&year=2026&station=130203+2&ll=42.0200,-93.7700",
    "?place=Chetek%2C+WI&year=2024",
  ]);
  for (const q of hand) {
    const d = RP.fromParams(q);
    assert.ok(d.place && d.year, q);
    assert.equal(d.cmp, "normal", "compared with the 30-year normal: " + q);
    assert.equal(d.normals, true, "the normals shown: " + q);
    assert.equal(d.records, true, "the remarkable days on: " + q);
  }
  // what the hand link says still wins
  const off = RP.fromParams("place=Ames%2C+IA&year=2012&normals=0&records=0");
  assert.equal(off.cmp, "normal");
  assert.equal(off.normals, false, "normals=0 keeps them off");
  assert.equal(off.records, false, "records=0 keeps them off");
  // the normals go with the 30-year comparison, as the boxes do: another comparison leaves them off unless asked
  const st = RP.fromParams("place=Ames%2C+IA&year=2012&cmp=station");
  assert.deepEqual([st.cmp, st.normals, st.records], ["station", false, true]);
  const none = RP.fromParams("place=Ames%2C+IA&year=2012&cmp=none");
  assert.deepEqual([none.cmp, none.normals, none.records], ["none", false, true]);
  assert.equal(RP.fromParams("place=Ames%2C+IA&year=2012&cmp=none&normals=1").normals, true, "cmp=none&normals=1 shows them");
  // no place at all is still the page's own new-visitor path (rain-print.js: if (!ST.place) ...)
  assert.equal(RP.fromParams("").place, "");
});

test("a link the tool made (style= always) and a d= design code come in exactly as made, switches off included", () => {
  for (const sw of [{ normals: false, records: false }, { normals: true, records: false }, { normals: false, records: true }, { normals: true, records: true }])
    for (const cmp of ["none", "normal", "station"]) for (const style of ["r1", "r2"]) {
      const s = { ...FULL, cmp, style, ...sw };
      const q = RP.toParams(s);
      assert.match(q, /(^|&)style=r[12](&|$)/, "every tool-made link carries style=");
      assert.deepEqual(plain(RP.fromParams("?" + q)), plain(RP.normalize(s)), "long link: " + JSON.stringify({ cmp, style, ...sw }));
      assert.deepEqual(plain(RP.fromParams("?d=" + RP.encodeCode(s))), plain(RP.normalize(s)), "d= code: " + JSON.stringify({ cmp, style, ...sw }));
    }
  // a d= code with the normals off stays off even with nothing else in the link
  const offCode = RP.encodeCode({ ...FULL, cmp: "none", normals: false, records: false });
  const d = RP.fromParams("d=" + offCode);
  assert.deepEqual([d.cmp, d.normals, d.records], ["none", false, false]);
});

test("leap day and Dec 31 dates survive; dates outside the year are dropped", () => {
  const s = { ...FULL, year: 2024, markers: [{ date: "2024-02-29", label: "Leap" }, { date: "2024-12-31", label: "End" }, { date: "2023-06-01", label: "Wrong year" }] };
  const back = RP.decodeCode(RP.encodeCode(s));
  assert.deepEqual(plain(back.markers), [{ date: "2024-02-29", label: "Leap" }, { date: "2024-12-31", label: "End" }]);
  assert.equal(RP.normalize({ ...FULL, markers: [{ date: "2025-02-29", label: "x" }] }).markers.length, 0);
});

test("text is cleaned and capped; the field separator cannot be smuggled in", () => {
  const s = RP.normalize({ ...FULL, name: "A|B\u0000C   D" + "x".repeat(40), place: "Rice|Lake, WI" });
  assert.equal(s.name.length <= RP.LIMITS.name, true);
  assert.ok(!s.name.includes("|") && !s.place.includes("|"));
  assert.deepEqual(plain(RP.decodeCode(RP.encodeCode(s))), plain(s));
  const u = RP.normalize({ ...FULL, name: "Ferme Côté Ñandú" });
  assert.equal(RP.decodeCode(RP.encodeCode(u)).name, "Ferme Côté Ñandú");
});

test("bad codes are refused, not half-read", () => {
  for (const c of ["", "abc", "!!!!!!!!!!", "MnxDaGV0ZWt8fDIwMjV8c3Awa3w", RP.encodeCode(FULL).slice(0, -6) + "AAAA"]) {
    const r = RP.decodeCode(c);
    assert.ok(r === null || (r.place && r.year), "decodes to nothing or to a whole design: " + c);
  }
  assert.equal(RP.decodeCode(Buffer.from("1|Chetek|x|2025|zzzz|").toString("base64url")), null, "unknown letters");
  assert.equal(RP.decodeCode(Buffer.from("1|Chetek|x|20x5|spna|").toString("base64url")), null, "bad year");
  assert.equal(RP.decodeCode(Buffer.from("2|Chetek|x|2025|spna|").toString("base64url")), null, "unknown version");
  assert.equal(RP.encodeCode({ place: "", year: 2025 }), "", "no place, no code");
});

test("an all-ASCII design at every cap fits Stripe's 200-character client_reference_id and the QR stamp", () => {
  const max = { ...FULL, place: "P".repeat(40), station: "USC00471667 6", name: "N".repeat(40),
    markers: [1, 2, 3].map((i) => ({ date: `2025-12-${20 + i}`, label: "L".repeat(30) })) };
  const code = RP.encodeCode(max);
  assert.ok(code.length <= 200, `code is ${code.length}`);
  assert.ok(ctx.AgQR.matrix(RP.shortUrl(max)).length <= 57, "and its link still fits the QR stamp");
});

test("the QR maker's mark encodes the short design link for a typical design", () => {
  const url = RP.shortUrl(FULL);
  const m = ctx.AgQR.matrix(url);
  assert.ok(m.length >= 21 && m.length <= 57, "a version 1-10 symbol");
});

test("the page's stated prices and Product offers match data/rain-print.json", () => {
  const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  const html = readFileSync(ROOT + "rain-print.html", "utf8");
  for (const id of ["digital", "print12x18", "framed12x18"]) {
    assert.equal(typeof J[id], "number");
    assert.ok(id in J.payment_links, "a payment_links slot for " + id);
    assert.match(html, new RegExp(`data-price="${id}">\\$${J[id]}<`), "static price for " + id);
  }
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  const prod = ld["@graph"].find((x) => x["@type"] === "Product");
  assert.deepEqual(prod.offers.map((o) => Number(o.price)), [J.digital, J.print12x18, J.framed12x18]);
  assert.ok(!("print18x24" in J) && !/18 x 24|18x24|poster/i.test(html), "18 x 24 and poster wording are gone from the page and the data");
  assert.ok(prod.offers.every((o) => o.priceCurrency === J.currency));
  assert.match(html, new RegExp(`\\$${J.digital} file, prints from \\$${J.print12x18}`), "meta description prices");
  // 2026-10-14 (the approved flow): one price line under the lede, framed first
  assert.match(html, new RegExp(`<p class="rp-prices" id="rp-prices"><span><b data-price="framed12x18">\\$${J.framed12x18}</b> framed</span><span><b data-price="print12x18">\\$${J.print12x18}</b> print</span><span><b data-price="digital">\\$${J.digital}</b> digital file</span><span>Shipping included</span></p>`), "the price line");
  assert.ok(!/yoursite\.example|Yearglass/i.test(html + readFileSync(ROOT + "components/rain-print.js", "utf8")), "no placeholder link, no uncleared brand");
});

test("a gift code is GIFT- plus the design code, round-trips, and fits Stripe's client_reference_id", () => {
  const g = { ...FULL, year: 2026, markers: [{ date: "2026-05-12", label: "Planted" }], gift: true };
  const code = RP.encodeCode(g);
  assert.ok(code.startsWith(RP.GIFT_PREFIX) && code.slice(5) === RP.encodeCode({ ...g, gift: false }), code);
  assert.match(code, /^[A-Za-z0-9_-]{1,200}$/, "Stripe: A-Z a-z 0-9 - _ and 200 at most");
  assert.deepEqual(plain(RP.decodeCode(code)), plain(RP.normalize(g)));
  assert.equal(RP.decodeCode(code).gift, true);
  assert.equal(RP.decodeCode(RP.encodeCode(FULL)).gift, false, "an ordinary code is not a gift");
  assert.ok(RP.encodeCode({ ...FULL, gift: false }).startsWith("M"), "a v1 code starts with M, so GIFT- cannot be part of one");
  assert.deepEqual(plain(RP.fromParams("?d=" + code)), plain(RP.normalize(g)), "?d= takes the gift code");
  assert.deepEqual(plain(RP.fromParams("?" + RP.toParams(g))), plain(RP.normalize(g)), "gift=1 round-trips in the query string");
  assert.ok(RP.toParams(g).includes("gift=1") && !RP.toParams(FULL).includes("gift"));
  assert.equal(RP.decodeCode("GIFT-"), null);
  assert.equal(RP.decodeCode("GIFT-GIFT-" + RP.encodeCode(FULL)), null, "one prefix only");
  const max = { place: "P".repeat(40), station: "USC00471667 6", year: 2026, layout: "staircase", palette: "night", size: "12x18", cmp: "normal",
    name: "N".repeat(40), markers: [1, 2, 3].map((i) => ({ date: `2026-12-${20 + i}`, label: "L".repeat(30) })), gift: true };
  assert.ok(RP.encodeCode(max).length <= 200, "a gift code at every cap is " + RP.encodeCode(max).length);
});

test("the current year comes from the date in America/Chicago, and decides gift or finished", () => {
  assert.equal(RP.chicagoToday(new Date("2026-11-20T18:00:00Z")), "2026-11-20");
  assert.equal(RP.chicagoToday(new Date("2027-01-01T03:00:00Z")), "2026-12-31", "9 pm Dec 31 in Chetek is still 2026");
  assert.equal(RP.chicagoToday(new Date("2027-01-01T07:00:00Z")), "2027-01-01");
  assert.equal(RP.yearMode(2025, "2026-11-20"), "done");
  assert.equal(RP.yearMode(2026, "2026-11-20"), "gift");
  assert.equal(RP.yearMode(2027, "2026-11-20"), "future");
  assert.equal(RP.yearMode(2026, "2027-01-02"), "done", "after New Year the gift year is a finished year");
  assert.equal(RP.yearMode(null, "2026-11-20"), "");
});

test("a preview ends at the last recorded day; late days are not counted as gaps", () => {
  const d = (v) => ({ v });
  assert.equal(RP.lastRecorded([d(0), d(0.2), d(null), d(0), d(null), d(null)]), 3);
  assert.equal(RP.lastRecorded([d(null), d(null)]), -1);
  assert.equal(RP.lastRecorded([]), -1);
  // trailing S days wait on an A total that is not in yet: not reported days
  const p = (raw) => RP.parsePcpn(raw);
  assert.equal(RP.lastRecorded([p("0.10"), p("0.00"), p("S"), p("S"), p("S")]), 1);
  assert.equal(RP.lastRecorded([p("0.10"), p("S"), p("0.30A")]), 2);
});

test("Christmas lines come from the cutoff date: a plain date before, after-Christmas after, nothing out of season", () => {
  const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  for (const k of ["print_christmas_cutoff", "framed_christmas_cutoff"]) assert.match(J[k], /^\d{4}-\d{2}-\d{2}$/, k);
  assert.equal(RP.cutoffNote("2026-10-11", "2026-12-12"), "Order by Dec 12 for Christmas delivery. OK your proof the day it comes.");
  assert.equal(RP.cutoffNote("2026-12-12", "2026-12-12"), "Order by Dec 12 for Christmas delivery. OK your proof the day it comes.", "the cutoff day itself still makes it");
  assert.equal(RP.cutoffNote("2026-12-13", "2026-12-12"), "Orders placed now ship after Christmas.");
  assert.equal(RP.cutoffNote("2026-12-26", "2026-12-12"), "");
  assert.equal(RP.cutoffNote("2026-09-30", "2026-12-12"), "");
  assert.equal(RP.cutoffNote("2026-11-01", null), "");
  assert.equal(RP.cutoffNote("2026-11-01", "Dec 12"), "");
});

test("gift text lives in data/rain-print.json; the FAQ and its structured data say the same thing", () => {
  const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  for (const k of ["gift_year_label", "gift_delivery", "gift_card_title", "gift_card_note"]) {
    assert.equal(typeof J[k], "string", k);
    assert.ok(!/[—–]/.test(J[k]), k + ": no dashes");
    assert.ok(!/\{(?!year\}|next\})/.test(J[k]), k + ": only {year} and {next}");
    assert.ok(!/(first half of January|(by|in|on) January \d)/i.test(J[k]), k + ": delivery in January, not a date");
  }
  assert.match(J.gift_card_title, /coming in January/);
  const html = readFileSync(ROOT + "rain-print.html", "utf8");
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  const faq = ld["@graph"].find((x) => x["@type"] === "FAQPage").mainEntity;
  // the visible text, links unwrapped (the FAQ links its email address since 2026-10-14)
  const dec = (t) => t.replace(/<a href="mailto:[^"]+">([^<]*)<\/a>/g, "$1").replace(/&rsquo;/g, "’").replace(/&amp;/g, "&");
  const shown = [...html.matchAll(/<details><summary>(.*?)<\/summary><p>(.*?)<\/p><\/details>/g)].map((m) => [dec(m[1]), dec(m[2])]);
  assert.deepEqual(faq.map((q) => [q.name, q.acceptedAnswer.text]), shown, "FAQPage matches the visible FAQ");
  // e6bb20b46 took the year out of this question so it stays right every Christmas; the test still asked for one.
  assert.ok(faq.some((q) => /give this year\u2019s print for Christmas/.test(q.name)), "the Christmas gift question is there");
  assert.ok(!faq.some((q) => /Christmas/.test(q.name) && /\d{4}/.test(q.name)), "and names no year");
  assert.ok(faq.some((q) => q.name === "Can you ship it straight to them with a note?" && /No prices go in the box\./.test(q.acceptedAnswer.text)), "the gift note question");
  assert.ok(!/first half of January/i.test(html), "January, not a narrower promise");
});

test("the seasonal promo is on since launch (2026-10-13), and the gift line shows only with promote on, inside its Chicago-date window", () => {
  const pctx = {}; pctx.window = pctx;
  vm.runInNewContext(readFileSync(ROOT + "components/rain-print-promo.js", "utf8"), pctx);
  const P = pctx.AgsistRainPromo;
  const shipped = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  assert.equal(shipped.promote, true, "launched 2026-10-13 (Sig): data/rain-print.json ships with the promo on");
  // 2026-10-14 (Sig: give it a fair chance, move fast): Christmas wording from today, and one line in the daily email
  assert.match(shipped.briefing_line, /^A year of your farm's rain, printed and framed for the wall/);
  assert.ok(!/\u2014|\u2013/.test(shipped.briefing_line), "no em dash in the email line");
  assert.equal(shipped.promote_from, "2026-10-14");
  // 2026-10-13: the framed cutoff is the last day that still arrives by Dec 24, and the promo ends with it
  // 2026-10-14: shipping within 3 business days (was 7) moved it from Dec 3 to Dec 9
  assert.equal(shipped.framed_christmas_cutoff, "2026-12-09");
  assert.equal(shipped.promote_until, shipped.framed_christmas_cutoff, "the promo never runs past the date it names");
  assert.equal(P.lineFor({ ...shipped, promote: false }, "", "2026-11-15"), "", "promote false turns it off");
  const on = { ...shipped, promote: true };
  assert.equal(P.lineFor(on, "", "2026-11-15"), "A year of your farm's rain, as a gift. Order framed by Dec 9.");
  assert.equal(P.lineFor(on, "", "2026-10-14") !== "", true, "the first day counts");
  assert.equal(P.lineFor(on, "", "2026-12-09") !== "", true, "the last day counts");
  assert.equal(P.lineFor(on, "", "2026-10-13"), "");
  assert.equal(P.lineFor(on, "", "2026-12-10"), "");
  assert.equal(P.lineFor({ ...on, promote: "true" }, "", "2026-11-15"), "", "only a real true turns it on");
  assert.equal(P.lineFor({ ...on, briefing_line: null }, "briefing", "2026-11-15"), "", "no briefing line unless one is written");
  assert.equal(P.lineFor({ ...on, briefing_line: "One line." }, "briefing", "2026-11-15"), "One line.");
  // 04:30 UTC on Nov 1 is still Oct 31 in Chicago (CDT, UTC-5)
  assert.equal(P.chicagoToday(new Date("2026-11-01T04:30:00Z")), "2026-10-31");
});

/* The homepage card and the related-page lines (2026-10-13, Sig): Christmas
   wording from promote_from through the framed order-by date, then the gift
   card through Dec 24 while the gift flow is in the data, otherwise year-round.
   Never a countdown, never an em dash. */
test("the homepage card's seasonal wording, the see line and the gauge line", () => {
  const pctx = {}; pctx.window = pctx;
  vm.runInNewContext(readFileSync(ROOT + "components/rain-print-promo.js", "utf8"), pctx);
  const P = pctx.AgsistRainPromo;
  const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  assert.equal(P.cardFor({ ...J, promote: false }, "2026-11-15"), null, "promote false: no card");
  assert.equal(P.cardFor({ ...J, promote: "true" }, "2026-11-15"), null, "only a real true");
  const ang = (d, c = J) => P.cardFor(c, d).angle;
  assert.equal(ang("2026-10-13"), "evergreen");
  assert.equal(ang("2026-10-14"), "christmas", "from Oct 14 (promote_from)");
  assert.equal(ang("2026-12-09"), "christmas", "through the framed order-by date");
  assert.equal(ang("2026-12-10"), "gift", "then the gift card");
  assert.equal(ang("2026-12-24"), "gift");
  assert.equal(ang("2026-12-25"), "evergreen");
  assert.equal(ang("2027-01-10"), "evergreen");
  assert.equal(ang("2026-12-10", { ...J, gift_card_title: null }), "evergreen", "no gift flow, no gift wording");
  const xmas = P.cardFor(J, "2026-11-20");
  assert.equal(xmas.title, "A Christmas gift for the farm");
  assert.match(xmas.text, /Order framed by Dec 9 for Christmas delivery\.$/);
  assert.equal(xmas.price, "Prints from $" + J.print12x18 + ", shipping included.");
  for (const d of ["2026-10-31", "2026-11-20", "2026-12-10"]) {
    const c = P.cardFor(J, d);
    for (const v of [c.title, c.text, c.price]) {
      assert.ok(!/\u2014|\u2013|!|hurry|only \d|left|days? to go/i.test(v), "plain, no pressure: " + v);
    }
  }
  assert.equal(P.lineFor(J, "see", "2026-10-13"), "See a year of rain at your place, drawn as a print for the wall.");
  assert.equal(P.lineFor({ ...J, promote: false }, "see", "2026-10-13"), "");
  assert.equal(P.lineFor(null, "gauge", "2026-10-13"), "Want a better rain gauge? Sig is designing one. Get updates.", "the gauge line needs no switch");
  assert.equal(P.seeHref("54728", "2026-10-13"), "/rain-print?place=54728&year=2025", "a saved ZIP opens last year, drawn");
  assert.equal(P.seeHref("", "2026-10-13"), "/rain-print");
  assert.equal(P.seeHref("5472", "2026-10-13"), "/rain-print");
  assert.ok(readFileSync(ROOT + "img/rain-print-thumb.jpg").length < 20000, "the card's thumbnail stays small");
});

/* For businesses (Sig, 2026-10-13): one price per print, delivered, like the
   cards: 5-9 at the card prices on one invoice, 10-24 $40/$79, 25-49 $37/$75,
   50-100 $35/$72; all to one address $3 off each print, $6 off each framed;
   over 100 Sig quotes it. Every expected figure below is worked by hand. */
test("business tiers: Sig's delivered prices, one row per tier, 5 to 100", () => {
  const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  for (const k of ["business_shipping", "business_shipping_one_address_tiers", "business_shipping_tiers"]) assert.ok(!(k in J), "the old per-print shipping is gone: " + k);
  const rows = plain(RP.bizRows(J));
  assert.deepEqual(rows.map((r) => [RP.bizRange(r), r.prices.print12x18, r.prices.framed12x18, r.one.print12x18, r.one.framed12x18, r.retail]), [
    ["5–9", 45, 89, 45, 89, true],
    ["10–24", 40, 79, 37, 73, false],
    ["25–49", 37, 75, 34, 69, false],
    ["50–100", 35, 72, 32, 66, false],
  ]);
  assert.equal(RP.BIZ_MIN, 5, "business orders start at 5");
  assert.equal(RP.BIZ_MAX, 500, "the form still takes up to 500");
  assert.equal(RP.bizQuoteMax(J), 100);
  // no business price is ever above the card price for the same print
  rows.forEach((r) => { assert.ok(r.prices.print12x18 <= J.print12x18 && r.prices.framed12x18 <= J.framed12x18, RP.bizRange(r)); });
  // a different json moves every figure with it, sorted by min
  const alt = { ...J, business_quote_max: null, business_tiers: [{ min: 50, print12x18: 30, framed12x18: 60 }, { min: 5, print12x18: 44, framed12x18: 88 }] };
  assert.deepEqual(plain(RP.bizRows(alt)).map((r) => [r.from, r.to, r.prices.framed12x18]), [[5, 49, 88], [50, 500, 60]]);
});

test("business quote line: price x quantity, one-address discount, minimum 5, over 100 ask Sig", () => {
  const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  const q = (n, id, d) => { const x = RP.bizQuote(J, n, id, d); return x && [x.unit, x.total]; };
  // each tier's edges, worked by hand
  assert.deepEqual(q(5, "print12x18", "each"), [45, 225], "5 x $45");
  assert.deepEqual(q(9, "framed12x18", "each"), [89, 801], "9 x $89");
  assert.deepEqual(q(10, "print12x18", "each"), [40, 400], "10 x $40");
  assert.deepEqual(q(24, "framed12x18", "each"), [79, 1896], "24 x $79");
  assert.deepEqual(q(25, "print12x18", "each"), [37, 925], "25 x $37");
  assert.deepEqual(q(30, "framed12x18", "each"), [75, 2250], "30 x $75 (the synthesis example)");
  assert.deepEqual(q(49, "framed12x18", "each"), [75, 3675], "49 x $75");
  assert.deepEqual(q(50, "print12x18", "each"), [35, 1750], "50 x $35");
  assert.deepEqual(q(100, "framed12x18", "each"), [72, 7200], "100 x $72");
  // all to one address, from 10: $3 off each print, $6 off each framed
  assert.deepEqual(q(5, "print12x18", "one"), [45, 225], "5 to 9 is no discount, to one address too");
  assert.deepEqual(q(9, "framed12x18", "one"), [89, 801], "9 x $89, one address");
  assert.deepEqual(q(12, "framed12x18", "one"), [73, 876], "12 x ($79 - $6)");
  assert.deepEqual(q(30, "print12x18", "one"), [34, 1020], "30 x ($37 - $3)");
  assert.deepEqual(q(100, "framed12x18", "one"), [66, 6600], "100 x ($72 - $6)");
  assert.deepEqual(q(12, "framed12x18", "not-sure"), [79, 948], "not sure yet: priced one to each customer");
  // a digital file is the card price at any quantity, no one-address discount
  assert.deepEqual(q(12, "digital", "one"), [19, 228], "12 x $19");
  // minimum 5, over 100 Sig quotes it (null), never past 500
  assert.equal(RP.bizQuote(J, 4, "framed12x18", "one"), null, "4 is under the minimum");
  assert.equal(RP.bizQuote(J, 101, "framed12x18", "one"), null, "over 100: ask Sig");
  assert.equal(RP.bizQuote(J, 101, "digital", "one"), null, "over 100: ask Sig, for files too");
  assert.equal(RP.bizQuote(J, 501, "framed12x18", "one"), null);
  assert.equal(RP.bizQuote(J, 10, "not-sure", "one"), null);
  // no usable tier: no table, no price (Sig quotes it)
  for (const t of [undefined, null, [], [{ min: 4, print12x18: 45, framed12x18: 89 }], [{ min: 10, print12x18: 0, framed12x18: 79 }], [{ min: 10, print12x18: "40", framed12x18: 79 }]]) {
    const x = { ...J, business_tiers: t };
    assert.deepEqual(plain(RP.bizRows(x)), [], JSON.stringify(t));
    assert.equal(RP.bizQuote(x, 10, "framed12x18", "each"), null, JSON.stringify(t));
  }
  // no one-address discount set: the same price either way
  assert.deepEqual(RP.bizQuote({ ...J, business_one_address_off: null }, 12, "framed12x18", "one").unit, 79);
});

test("business cutoff line: from the json, a date only while it is ahead", () => {
  const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  assert.equal(J.business_cutoff, "2026-11-20");
  assert.equal(J.business_note, null, "business_note ships empty");
  assert.equal(RP.bizCutoffNote("2026-10-12", J.business_cutoff), "For Christmas, send your list by Nov 20.");
  assert.equal(RP.bizCutoffNote("2026-11-20", J.business_cutoff), "For Christmas, send your list by Nov 20.", "the day itself counts");
  assert.equal(RP.bizCutoffNote("2026-11-21", J.business_cutoff), "");
  assert.equal(RP.bizCutoffNote("2026-10-12", null), "");
  assert.equal(RP.bizCutoffNote("2026-10-12", "Nov 20"), "");
});

/* The year's numbers (2026-10-12). Days are built the way daily() builds
   them from an ACIS row: pcpn through parsePcpn, snow as a number or null. */
const mkDays = (rows, year = 2025) => rows.map(([pcpn, snow = 0], i) => {
  const dt = new Date(Date.UTC(year, 0, 1 + i)), p = RP.parsePcpn(pcpn);
  return { date: dt.toISOString().slice(0, 10), v: p.v, flag: p.flag, t: null, s: snow, m: dt.getUTCMonth(), d: dt.getUTCDate(), doy: i };
});
const rep = (x, n) => Array(n).fill(x);

test("a missing day is a gap in the Staircase line, not a dry step", () => {
  const days = mkDays([["0.50"], ["0.00"], ["M"], ["M"], ["0.20"], ["0.00"]]);
  const D = RP.derive(days);
  const d = RP.stairPath(days, D.cum, 0, 100, 10, 10);
  // one drawn point per known day, none for the two missing days
  assert.equal((d.match(/L/g) || []).length, 4, d);
  // the pen lifts and comes down at the start of day 5 (x = 40), at the total before it
  assert.match(d, /L20\.00,95\.00M40\.00,95\.00L50\.00,93\.00/, d);
  assert.ok(!/L30\.00|L40\.00/.test(d), "nothing drawn to the end of a missing day: " + d);
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  assert.ok(!/DAYS? NOT REPORTED|NO REPORT ON|UNRECORDED/i.test(S.slice(S.indexOf("function footerText"), S.indexOf("function footLayout"))), "no missing-day count on the art");
});

test("the comparison leaves missing days out of both totals", () => {
  const days = mkDays([["0.10"], ["M"], ["0.10"], ["S"], ["0.30A"]]);
  const normal = new Map(days.map((x) => [x.date.slice(5), 0.1]));
  const o = RP.overlayDaily(days, normal);
  assert.equal(o.daily[1], 0, "no normal rain on the unrecorded day");
  assert.equal(o.daily[3], 0.1, "an S day keeps its normal: its rain is in the A total");
  assert.equal(Math.round(o.total * 100) / 100, 0.4);
  assert.equal(o.cum.at(-1), o.total);
  assert.equal(o.normal[1], 0.1, "the comparison's own shape is unchanged");
  assert.equal(Math.round(RP.derive(days).total * 100) / 100, 0.5, "the year counts the A total once");
  assert.equal(RP.overlayDaily(days, new Map()), null);
});

test("an S day is not dry and not a measured 0; an A total is never the wettest day", () => {
  assert.deepEqual(plain(RP.parsePcpn("S")), { v: 0, flag: "S" });
  assert.deepEqual(plain(RP.parsePcpn("1.20A")), { v: 1.2, flag: "A" });
  // 4 dry, 3 S, 4 dry: without the S days this would be one 11-day spell
  // (1.20 over 4 days proves no day above 0.30, so the 0.40 can stand)
  const days = mkDays([["0.40"], ...rep(["0.00"], 4), ...rep(["S"], 3), ["1.20A"], ...rep(["0.00"], 4)]);
  const D = RP.derive(days);
  assert.equal(D.dryMax.len, 4, "S days end a dry run");
  assert.equal(D.unsplit, 3);
  assert.equal(D.missing, 0, "S days are not unrecorded days");
  assert.equal(Math.round(D.total * 100) / 100, 1.6, "the accumulated amount stays in the total");
  assert.equal(Math.round((D.cum[8] - D.cum[7]) * 100) / 100, 1.2, "on the day the A total is reported");
  assert.equal(D.max.v, 0.4, "the 1.20 A total is not the wettest day");
  assert.equal(D.max.date, "2025-01-01");
  const onlyA = RP.derive(mkDays([["S"], ["1.50A"], ["0.00"]]));
  assert.equal(onlyA.max.v, 0);
  assert.equal(onlyA.max.doy, -1);
  // 3.10 over three days means one of them had at least 1.03: the 0.40 is not the biggest, so none is named
  const proven = RP.derive(mkDays([["0.40"], ["S"], ["S"], ["3.10A"]]));
  assert.equal(proven.max.v, 0, "withheld when an A total proves a bigger day");
  assert.equal(proven.max.doy, -1);
  assert.equal(proven.maxRain.v, 0);
  assert.equal(RP.riserSpan(proven), null, "and no red riser");
  const fair = RP.derive(mkDays([["1.40"], ["S"], ["S"], ["3.10A"]]));
  assert.equal(fair.max.v, 1.4, "kept when no split of the A total can beat it");
  // and the Staircase lifts its pen across S days too
  const d = RP.stairPath(days, D.cum, 0, 100, 10, 1);
  assert.equal((d.match(/L/g) || []).length, days.length - 3, d);
});

test("an S run that no A total closes is missing, not counted later", () => {
  const open = RP.closeOpenS(mkDays([["0.10"], ["S"], ["S"], ["M"]]));
  const D = RP.derive(open);
  assert.equal(D.unsplit, 0);
  assert.equal(D.missing, 3);
  assert.deepEqual(open.slice(1, 3).map((x) => [x.v, x.flag]), [[null, "M"], [null, "M"]]);
  const atEnd = RP.closeOpenS(mkDays([["0.10"], ["S"], ["S"]]));
  assert.equal(RP.derive(atEnd).missing, 2, "a run that reaches the end of the record");
  const plainNext = RP.closeOpenS(mkDays([["S"], ["0.20"]]));
  assert.equal(plainNext[0].flag, "M", "a plain reading after it does not hold its catch");
  const closed = mkDays([["0.10"], ["S"], ["S"], ["0.40A"]]);
  assert.deepEqual(plain(RP.closeOpenS(closed)), plain(closed), "an S run closed by an A total is unchanged");
  const D2 = RP.derive(RP.closeOpenS(closed));
  assert.equal(D2.unsplit, 2);
  assert.equal(D2.missing, 0);
  assert.equal(closed[1].flag, "S", "the input is not changed");
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  const dl = S.slice(S.indexOf("function daily("), S.indexOf("function stationExtremes("));
  assert.match(dl, /days = closeOpenS\(days\)/, "the page's daily() runs it on every year it loads");
});

test("the biggest rain is picked from rain days only: never a snow day or an A total", () => {
  const D = RP.derive(mkDays([["0.30"], ["1.72", 17], ["0.90"], ["S"], ["S"], ["S"], ["2.40A"], ["T"]]));
  assert.equal(D.max.v, 1.72, "the wettest day (water) can be a snow day, for the stats row");
  assert.equal(D.maxRain.v, 0.9);
  assert.equal(D.maxRain.date, "2025-01-03");
  assert.equal(D.maxRain.doy, 2);
  const allSnow = RP.derive(mkDays([["0.50", 4], ["0.00"]]));
  assert.equal(allSnow.maxRain.v, 0);
  assert.equal(allSnow.maxRain.doy, -1);
});

test("a day with snow ends a dry run, whatever the gauge read", () => {
  const days = mkDays([...rep(["0.00"], 4), ["0.00", 1.5], ...rep(["0.00"], 4)]);
  assert.equal(RP.derive(days).dryMax.len, 4);
  assert.equal(RP.derive(mkDays([...rep(["0.00"], 4), ["0.00", null], ...rep(["0.00"], 4)])).dryMax.len, 9, "no snow record is no snow");
});

test("a wettest day on Jan 1 gets its riser from 0", () => {
  const D = RP.derive(mkDays([["1.25"], ["0.10"], ["0.00"]]));
  assert.equal(D.max.doy, 0);
  assert.deepEqual(plain(RP.riserSpan(D)), [0, 1.25]);
  const D2 = RP.derive(mkDays([["0.10"], ["1.25"]]));
  assert.deepEqual(plain(RP.riserSpan(D2)), [0.1, 1.35]);
  assert.equal(RP.riserSpan(RP.derive(mkDays([["0.00"], ["T"]]))), null);
});

test("the header comment does not claim a missing-day count on the art", () => {
  const head = readFileSync(ROOT + "components/rain-print.js", "utf8").split("*/")[0];
  assert.ok(!/printed as a count on the art/i.test(head), "old claim gone");
  assert.match(head, /no count of them is printed on the art/);
});

test("one dry-spell rule (7 days or more) from the engine; Staircase marks it on the print from 14", () => {
  assert.equal(RP.DRY_MIN, 7);
  assert.equal(RP.showDry(RP.derive(mkDays([["0.10"], ...rep(["0.00"], 6), ["0.10"]]))), false, "6 days: not marked");
  assert.equal(RP.showDry(RP.derive(mkDays([["0.10"], ...rep(["0.00"], 7), ["0.10"]]))), true, "7 days: marked");
  // Since 2026-10-13 both styles (R1, R2) are drawn by components/rain-print-art.js from the engine's call.
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8"), A = readFileSync(ROOT + "components/rain-print-art.js", "utf8");
  const build = S.slice(S.indexOf("function buildSvg("), S.indexOf("function recordsReady("));
  assert.match(build, /showDry: showDry\(DATA\.d\)/, "the page hands the art the shared rule");
  assert.ok(!/dryMax\.len\s*(>|>=)\s*\d/.test(A + build), "the art has no hard-coded threshold: the engine's rule, and the print's named option below");
  const ctx2 = {}; ctx2.window = ctx2;
  vm.runInNewContext(A, ctx2);
  const draw = (style, n, extra = {}) => {
    const days = mkDays([["0.10"], ...rep(["0.00"], n), ["0.10"], ...rep(["0.20"], 20)]), D = RP.derive(days);
    return ctx2.AgRainArt.render(Object.assign({ style, year: 2025, place: "Chetek, Wisconsin", days, D, showDry: RP.showDry(D), axisLen: 365, markers: [] }, extra));
  };
  const marked = (svg, n) => new RegExp(n + " dry days|dry stretch", "i").test(svg);
  // Roots follows the engine's rule as it is
  for (const [n, want] of [[6, false], [7, true]]) assert.equal(marked(draw("r2", n), n), want, `r2: ${n} days ${want ? "marked" : "not marked"}`);
  // Staircase marks a dry stretch on the print from 14 days (panel 4, 2026-10-14), never under the engine's 7
  for (const [n, want] of [[6, false], [7, false], [13, false], [14, true], [19, true]]) assert.equal(marked(draw("r1", n), n), want, `r1: ${n} days ${want ? "marked" : "not marked"}`);
  // the page may ask for another print threshold (printDryMin); the engine's showDry still decides there is one at all
  assert.equal(marked(draw("r1", 7, { printDryMin: 7 }), 7), true, "r1 with printDryMin 7: 7 days marked");
  assert.equal(marked(draw("r1", 6, { printDryMin: 3 }), 6), false, "r1: under the engine's 7 never marked");
  assert.equal(marked(draw("r1", 14, { printDryMin: "x" }), 14), true, "a bad option falls back to 14");
});

test("a saved PNG says 300 dpi and sRGB (a canvas PNG says neither and opens at 72 dpi)", async () => {
  const { deflateSync, crc32 } = await import("node:zlib");
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, "latin1"); d.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 0, 0, 255]))), chunk("IEND", Buffer.alloc(0))]);
  const out = Buffer.from(RP.pngWithDpi(new Uint8Array(png), 300));
  const chunks = []; for (let i = 8; i < out.length;) { const n = out.readUInt32BE(i), t = out.toString("latin1", i + 4, i + 8); chunks.push({ t, d: out.subarray(i + 8, i + 8 + n), crc: out.readUInt32BE(i + 8 + n), all: out.subarray(i + 4, i + 8 + n) }); i += 12 + n; }
  assert.deepEqual(chunks.map((c) => c.t), ["IHDR", "pHYs", "sRGB", "IDAT", "IEND"]);
  for (const c of chunks) assert.equal(c.crc, crc32(c.all), c.t + " CRC");
  const ph = chunks[1].d;
  assert.equal(ph.readUInt32BE(0), 11811); assert.equal(ph.readUInt32BE(4), 11811); assert.equal(ph[8], 1);
  assert.equal(chunks[2].d[0], 0);
  assert.deepEqual([...RP.pngWithDpi(out, 300)], [...out], "already marked: unchanged");
  assert.deepEqual([...RP.pngWithDpi(new Uint8Array([1, 2, 3]), 300)], [1, 2, 3], "not a PNG: unchanged");
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  const tb = S.slice(S.indexOf("function toBlob("), S.indexOf("function pdfFromJpeg("));
  assert.match(tb, /pngWithDpi\(new Uint8Array\(buf\), DPI\)/, "toBlob marks every PNG it saves");
});

test("print and digital files: short-link QR or no file; the 13 x 19 sheet, untrimmed; full-quality PDF; SVG at its size", () => {
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  const ex = S.slice(S.indexOf("function exportFile("), S.indexOf("// ---------- wire up ----------"));
  // 2026-10-14 (Sig): the short link is made at export, once, not waited on from a redraw; the preview carries the standard code
  assert.match(ex, /var gate = kind === 'preview' \? Promise\.resolve\(\)/, "only the watermarked preview skips the short link");
  assert.match(ex, /root\.AgRpShort\.mint\(code\)\.then\(function \(link\) \{\n\s+if \(!link\) throw NO_QR;/, "makes the short link at export");
  assert.match(ex, /if \(kind !== 'preview' && !own\) throw NO_QR/, "and saves nothing without it");
  assert.ok(ex.includes("The link service didn\\u2019t give this print its own short link (it may be busy), so no file was saved. An order file never uses the standard code."));
  assert.match(ex, /msg \+ ' QR: ' \+ qrLink \+ '\.'/, "the note names the QR link it used");
  assert.ok(ex.includes("12 x 18 in at 300 dpi") && !ex.includes("18 x 12 in"), "one way to write the digital file's size");
  assert.ok((ex.match(/SHEET_WORDS/g) || []).length >= 3, "every print file note names the sheet");
  assert.match(ex, /toBlob\(c, 'image\/jpeg', 1\)/, "PDF JPEG at quality 1");
  assert.match(ex, /px: \['18in', '12in'\]/, "the SVG says its physical size");
  const dc = S.slice(S.indexOf("function drawCanvas("), S.indexOf("function toBlob("));
  // Sig, 2026-10-17: 13 x 19 paper, shipped untrimmed: no bleed, no crop marks (test/rain-print-sheet.test.mjs measures the art inside the mat)
  assert.match(dc, /pxW = Math\.round\(SHEET\.w \* DPI\); pxH = Math\.round\(SHEET\.h \* DPI\);/, "the print file is the whole sheet at 300 dpi");
  assert.ok(!/crop|o\.bleed/.test(dc.replace(/\/\*[\s\S]*?\*\//g, "")), "no crop marks, no bleed");
  assert.match(S, /var SHEET_WORDS = SHEET\.h \+ ' x ' \+ SHEET\.w \+ ' in sheet, the art ' \+ SHEET\.art\.w \+ ' x ' \+ SHEET\.art\.h/);
});

test("county-page links: a station town with a field name falls back to shorter towns", () => {
  assert.deepEqual([...RP.shorterPlaces("Wilmington New Castle County, DE")],
    ["Wilmington New Castle, DE", "Wilmington New, DE", "Wilmington, DE"]);
  assert.deepEqual([...RP.shorterPlaces("Topeka Billard, KS")], ["Topeka, KS"]);
  assert.deepEqual([...RP.shorterPlaces("Ames, IA")], []);
  assert.deepEqual([...RP.shorterPlaces("50010")], []);
  assert.deepEqual([...RP.shorterPlaces("Garden City")], []);
});

// ---------- up to five marked days (2026-10-15, Sig) ----------
test("five marked days round-trip through the design code and the query string; a sixth is dropped; an old three-day code still opens", () => {
  assert.equal(RP.LIMITS.markers, 5);
  const five = { ...FULL, dedication: "For Dad", markers: [
    { date: "2025-03-02", label: "Calving" }, { date: "2025-05-12", label: "Planted" }, { date: "2025-07-04", label: "Wedding" },
    { date: "2025-09-20", label: "First frost" }, { date: "2025-10-20", label: "Harvest done" }] };
  const back = RP.decodeCode(RP.encodeCode(five));
  assert.deepEqual(plain(back.markers), five.markers);
  assert.deepEqual(plain(RP.fromParams(RP.toParams(five)).markers), five.markers);
  const six = { ...five, markers: five.markers.concat([{ date: "2025-12-01", label: "Sold" }]) };
  assert.equal(RP.normalize(six).markers.length, 5, "the most is five");
  assert.equal(RP.decodeCode(RP.encodeCode(six)).markers.length, 5);
  // made by the page before five days (three marked days, a dedication): opens the same
  const old = RP.decodeCode("MnxDaGV0ZWssIFdJfDQ3MTY2NyAyfDIwMjV8c3BuYWV8VGhlIE9sc29uIEZhcm18M258UGxhbnRlZHw1NHxXZWRkaW5nfDg0fEhhcnZlc3QgZG9uZXxGb3IgRGFk");
  assert.deepEqual(plain(old.markers.map((m) => m.date + " " + m.label)), ["2025-05-12 Planted", "2025-07-04 Wedding", "2025-10-20 Harvest done"]);
  assert.deepEqual([old.name, old.dedication, old.style], ["The Olson Farm", "For Dad", "r2"]);
  // the longest plain design, five full labels and every box full, still fits the 400 characters a code may have (decodeCode, /R, the worker)
  const L = RP.LIMITS, longest = { place: "X".repeat(L.place), station: "9999999999999999", year: 2024, cmp: "station", style: "r2", normals: true, records: true,
    name: "N".repeat(L.name), dedication: "D".repeat(L.dedication), markers: ["01-01", "03-31", "06-30", "09-30", "12-31"].map((d) => ({ date: "2024-" + d, label: "L".repeat(L.label) })) };
  const code = RP.encodeCode(longest);
  assert.ok(code.length <= 400, "five days fit a code: " + code.length);
  assert.equal(RP.decodeCode(code).markers.length, 5);
});
