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
  assert.ok(faq.some((q) => /give a \d{4} print for Christmas/.test(q.name)));
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
