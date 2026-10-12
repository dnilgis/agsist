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
  assert.match(html, new RegExp(`A print file is \\$${J.digital}; a 12 x 18 print is \\$${J.print12x18}, or \\$${J.framed12x18} framed`), "lede prices");
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
});

test("Christmas lines come from the cutoff date: a plain date before, after-Christmas after, nothing out of season", () => {
  const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  for (const k of ["print_christmas_cutoff", "framed_christmas_cutoff"]) assert.match(J[k], /^\d{4}-\d{2}-\d{2}$/, k);
  assert.equal(RP.cutoffNote("2026-10-11", "2026-12-12"), "Order by Dec 12 for Christmas delivery.");
  assert.equal(RP.cutoffNote("2026-12-12", "2026-12-12"), "Order by Dec 12 for Christmas delivery.", "the cutoff day itself still makes it");
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
  const dec = (t) => t.replace(/&rsquo;/g, "’").replace(/&amp;/g, "&");
  const shown = [...html.matchAll(/<details><summary>(.*?)<\/summary><p>(.*?)<\/p><\/details>/g)].map((m) => [dec(m[1]), dec(m[2])]);
  assert.deepEqual(faq.map((q) => [q.name, q.acceptedAnswer.text]), shown, "FAQPage matches the visible FAQ");
  // e6bb20b46 took the year out of this question so it stays right every Christmas; the test still asked for one.
  assert.ok(faq.some((q) => /give this year's print for Christmas/.test(q.name)), "the Christmas gift question is there");
  assert.ok(!faq.some((q) => /Christmas/.test(q.name) && /\d{4}/.test(q.name)), "and names no year");
  assert.ok(faq.some((q) => q.name === "Can you ship it straight to them with a note?" && /No prices go in the box\./.test(q.acceptedAnswer.text)), "the gift note question");
  assert.ok(!/first half of January/i.test(html), "January, not a narrower promise");
});

test("the seasonal promo ships off, and shows only with promote on, inside its Chicago-date window", () => {
  const pctx = {}; pctx.window = pctx;
  vm.runInNewContext(readFileSync(ROOT + "components/rain-print-promo.js", "utf8"), pctx);
  const P = pctx.AgsistRainPromo;
  const shipped = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  assert.equal(shipped.promote, false, "data/rain-print.json must ship with the promo off");
  assert.equal(shipped.briefing_line, null);
  assert.equal(shipped.promote_from, "2026-11-01");
  assert.equal(shipped.promote_until, "2026-12-12");
  assert.equal(P.lineFor(shipped, "", "2026-11-15"), "");
  const on = { ...shipped, promote: true };
  assert.equal(P.lineFor(on, "", "2026-11-15"), "A year of your farm's rain, as a gift. Order framed by Dec 12.");
  assert.equal(P.lineFor(on, "", "2026-11-01") !== "", true, "the first day counts");
  assert.equal(P.lineFor(on, "", "2026-12-12") !== "", true, "the last day counts");
  assert.equal(P.lineFor(on, "", "2026-10-31"), "");
  assert.equal(P.lineFor(on, "", "2026-12-13"), "");
  assert.equal(P.lineFor({ ...on, promote: "true" }, "", "2026-11-15"), "", "only a real true turns it on");
  assert.equal(P.lineFor(on, "briefing", "2026-11-15"), "", "no briefing line unless one is written");
  assert.equal(P.lineFor({ ...on, briefing_line: "One line." }, "briefing", "2026-11-15"), "One line.");
  // 04:30 UTC on Nov 1 is still Oct 31 in Chicago (CDT, UTC-5)
  assert.equal(P.chicagoToday(new Date("2026-11-01T04:30:00Z")), "2026-10-31");
});

/* For businesses (2026-10-12): every figure the section prints comes from
   data/rain-print.json. The expected numbers are worked here from the json's
   own fields, and the shipped values are pinned too, so a change to either
   the math or the data shows. */
test("business tiers: per-print prices come from the json and round to the cent", () => {
  const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  const cents = (p, pct) => Math.round(Math.round(p * 100) * (100 - pct) / 100) / 100;
  const rows = plain(RP.bizRows(J));
  assert.equal(rows.length, J.business_tiers.length, "one row per tier");
  J.business_tiers.forEach((t, i) => {
    assert.equal(rows[i].from, t.min);
    assert.equal(rows[i].pct, t.pct);
    for (const id of ["print12x18", "framed12x18", "digital"]) assert.equal(rows[i].prices[id], cents(J[id], t.pct), id + " at " + t.min);
  });
  assert.equal(rows[0].to, J.business_tiers[1].min - 1);
  assert.equal(rows.at(-1).to, null, "the last tier runs to 'or more'");
  assert.equal(RP.bizRange(rows[0]), "10–24");
  assert.equal(RP.bizRange(rows[1]), "25 or more");
  // Sig's figures, against the shipped json
  assert.deepEqual(rows.map((r) => [r.prices.print12x18, r.prices.framed12x18, r.prices.digital]), [[40.5, 80.1, 17.1], [38.25, 75.65, 16.15]]);
  // rounding: 15% off $89 is 75.65 exactly, never 75.64999...
  assert.equal(RP.bizPrice(89, 15), 75.65);
  assert.equal(RP.bizPrice(19.99, 15), 16.99, "16.9915 rounds to 16.99");
  assert.equal(RP.bizPrice(10.05, 50), 5.03, "half a cent rounds up");
  // a different json moves every figure with it
  const alt = { ...J, framed12x18: 100, business_tiers: [{ min: 50, pct: 20 }, { min: 10, pct: 5 }] };
  assert.deepEqual(plain(RP.bizRows(alt)).map((r) => [r.from, r.to, r.prices.framed12x18]), [[10, 49, 95], [50, null, 80]], "sorted by min, from the json");
});

test("business tiers: none set means no table and no discount", () => {
  const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  for (const t of [undefined, null, [], [{ min: 5, pct: 10 }], [{ min: 10, pct: 0 }], [{ min: 10, pct: "10" }]]) {
    const x = { ...J, business_tiers: t };
    assert.deepEqual(plain(RP.bizRows(x)), [], JSON.stringify(t));
    assert.equal(RP.bizQuote(x, 10, "framed12x18", "each").pct, 0, "full price at 10 with no usable tier " + JSON.stringify(t));
  }
});

test("business shipping: per print, one-address discount from the json, full price to each customer", () => {
  const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  const S = J.business_shipping, OT = J.business_shipping_one_address_tiers;
  const cents = (p, pct) => Math.round(Math.round(p * 100) * (100 - pct) / 100) / 100;
  assert.ok(!("business_shipping_tiers" in J), "the old shipping tiers are gone");
  const rows = plain(RP.bizRows(J));
  rows.forEach((r) => {
    const opct = OT.filter((t) => r.from >= t.min).at(-1).pct;
    for (const id of ["print12x18", "framed12x18"]) {
      assert.equal(r.one[id], cents(S[id], opct), id + " to one address at " + r.from);
      assert.equal(r.each[id], S[id], id + " to each customer is full price");
    }
    assert.equal(r.one.digital, 0);
  });
  assert.deepEqual(rows.map((r) => [r.one.print12x18, r.one.framed12x18, r.each.print12x18, r.each.framed12x18]), [[6.3, 13.3, 9, 19], [5.4, 11.4, 9, 19]]);
  // the quote line's totals: (price + shipping) x quantity
  const q1 = RP.bizQuote(J, 10, "framed12x18", "one"), q2 = RP.bizQuote(J, 10, "framed12x18", "each");
  assert.deepEqual([q1.unit, q1.ship, q1.total], [80.1, 13.3, 934]);
  assert.deepEqual([q2.unit, q2.ship, q2.total], [80.1, 19, 991]);
  const q3 = RP.bizQuote(J, 30, "print12x18", "one");
  assert.equal(q3.total, Math.round((cents(J.print12x18, 15) + cents(S.print12x18, 40)) * 30 * 100) / 100);
  assert.equal(q3.total, 1309.5);
  assert.equal(RP.bizQuote(J, 12, "digital", "each").total, 205.2, "a digital file has no shipping");
  // business orders are 10 to 500 prints
  assert.equal(RP.BIZ_MIN, 10);
  assert.equal(RP.bizQuote(J, 9, "framed12x18", "one"), null);
  assert.equal(RP.bizQuote(J, 501, "framed12x18", "one"), null);
  assert.equal(RP.bizQuote(J, 10, "not-sure", "one"), null);
  // no shipping in the json: no shipping figure, and the table has no shipping columns
  const noShip = { ...J, business_shipping: null };
  assert.equal(RP.bizQuote(noShip, 10, "framed12x18", "one").ship, null);
  assert.equal(RP.bizQuote(noShip, 10, "framed12x18", "one").total, 801);
  assert.equal(plain(RP.bizRows(noShip))[0].one, null);
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
  const days = mkDays([["0.40"], ...rep(["0.00"], 4), ...rep(["S"], 3), ["2.00A"], ...rep(["0.00"], 4)]);
  const D = RP.derive(days);
  assert.equal(D.dryMax.len, 4, "S days end a dry run");
  assert.equal(D.unsplit, 3);
  assert.equal(D.missing, 0, "S days are not unrecorded days");
  assert.equal(D.total, 2.4, "the accumulated amount stays in the total");
  assert.equal(D.cum[8] - D.cum[7], 2, "on the day the A total is reported");
  assert.equal(D.max.v, 0.4, "the 2.00 A total is not the wettest day");
  assert.equal(D.max.date, "2025-01-01");
  const onlyA = RP.derive(mkDays([["S"], ["1.50A"], ["0.00"]]));
  assert.equal(onlyA.max.v, 0);
  assert.equal(onlyA.max.doy, -1);
  // and the Staircase lifts its pen across S days too
  const d = RP.stairPath(days, D.cum, 0, 100, 10, 1);
  assert.equal((d.match(/L/g) || []).length, days.length - 3, d);
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

test("one dry-spell rule for both layouts: 7 days or more", () => {
  assert.equal(RP.DRY_MIN, 7);
  assert.equal(RP.showDry(RP.derive(mkDays([["0.10"], ...rep(["0.00"], 6), ["0.10"]]))), false, "6 days: not marked");
  assert.equal(RP.showDry(RP.derive(mkDays([["0.10"], ...rep(["0.00"], 7), ["0.10"]]))), true, "7 days: marked");
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  const wave = S.slice(S.indexOf("function waveform("), S.indexOf("function staircase(")), stair = S.slice(S.indexOf("function staircase("), S.indexOf("function buildSvg("));
  for (const [name, src] of [["waveform", wave], ["staircase", stair]]) {
    assert.match(src, /if \(showDry\(D\)\) ann \+= bracket\(/, name + " uses the shared rule");
    assert.ok(!/dryMax\.len\s*(>|>=)\s*\d/.test(src), name + " has no threshold of its own");
  }
});
