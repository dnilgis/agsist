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
  place: "Chetek, WI", station: "471667 2", year: 2025, layout: "staircase", palette: "night", size: "18x24",
  cmp: "normal", name: "The Olson Farm",
  markers: [{ date: "2025-05-12", label: "Planted" }, { date: "2025-07-04", label: "Wedding" }, { date: "2025-10-20", label: "Harvest done" }],
};

test("design code round-trips every choice", () => {
  const code = RP.encodeCode(FULL);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(plain(RP.decodeCode(code)), plain(RP.normalize(FULL)));
  for (const layout of ["staircase", "waveform"]) for (const palette of ["paper", "night", "blueprint"])
    for (const cmp of ["none", "normal", "station"]) for (const size of ["12x18", "18x24"]) {
      const s = { ...FULL, layout, palette, cmp, size };
      assert.deepEqual(plain(RP.decodeCode(RP.encodeCode(s))), plain(RP.normalize(s)), `${layout} ${palette} ${cmp} ${size}`);
    }
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
  for (const id of ["digital", "print12x18", "print18x24"]) {
    assert.equal(typeof J[id], "number");
    assert.ok(id in J.payment_links, "a payment_links slot for " + id);
    assert.match(html, new RegExp(`data-price="${id}">\\$${J[id]}<`), "static price for " + id);
  }
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  const prod = ld["@graph"].find((x) => x["@type"] === "Product");
  assert.deepEqual(prod.offers.map((o) => Number(o.price)), [J.digital, J.print12x18, J.print18x24]);
  assert.ok(prod.offers.every((o) => o.priceCurrency === J.currency));
  assert.match(html, new RegExp(`\\$${J.digital} file, posters from \\$${J.print12x18}`), "meta description prices");
  assert.match(html, new RegExp(`A print file is \\$${J.digital}; a printed poster is \\$${J.print12x18} or \\$${J.print18x24}`), "lede prices");
  assert.ok(!/yoursite\.example|Yearglass/i.test(html + readFileSync(ROOT + "components/rain-print.js", "utf8")), "no placeholder link, no uncleared brand");
});
