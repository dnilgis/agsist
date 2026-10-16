/* Rain Print launch fixes (2026-10-13): town lookup, share links, station words,
 * buyer text, Christmas dates, the print's own small lines, the checkout
 * reference and the page head. Runs the shipped files in a bare context.
 *
 *   node --test test/rain-print-launch.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob, Map, Promise };
ctx.window = ctx;
for (const f of ["components/qr.js", "components/rain-print.js", "components/rain-print-art.js"])
  vm.runInNewContext(readFileSync(ROOT + f, "utf8"), ctx);
const RP = ctx.RainPrint;
const plain = (x) => JSON.parse(JSON.stringify(x));
const SPR = [
  { name: "Springfield", admin1: "Illinois", admin2: "Sangamon", latitude: 39.8, longitude: -89.6 },
  { name: "Springfield", admin1: "Missouri", admin2: "Greene", latitude: 37.2, longitude: -93.3 },
];

test("town lookup: one hit draws, two far apart ask which, a wrong state is an error not another state's town", () => {
  assert.equal(RP.geoPick("Chetek, WI", [{ name: "Chetek", admin1: "Wisconsin", latitude: 45.3, longitude: -91.6 }]).hit.name, "Chetek");
  const p = RP.geoPick("Springfield", SPR);
  assert.equal(p.pick.length, 2, "Springfield with no state asks");
  assert.equal(RP.geoPick("Springfield, MO", SPR).hit.admin1, "Missouri", "with a state it takes that state's");
  const bad = RP.geoPick("Chetk, WI", [{ name: "Chetek", admin1: "Minnesota", latitude: 46, longitude: -93 }]);
  assert.ok(bad.error && /in Wisconsin/.test(bad.error), "a misspelling never falls back to another state: " + bad.error);
  assert.ok(RP.geoPick("Nowhere", []).error.includes("Check the spelling"));
  const near = [{ name: "Lake", admin1: "Iowa", latitude: 42, longitude: -93 }, { name: "Lake", admin1: "Iowa", latitude: 42.05, longitude: -93.05 }];
  assert.ok(RP.geoPick("Lake", near).hit, "two hits a few miles apart share a gauge: no question");
});

test("a ZIP is sent as a postal code, and a miss says to type the town", () => {
  assert.deepEqual(plain(RP.geocodeQuery("54728")), { zip: "54728", town: "54728", st: "" });
  assert.equal(RP.geocodeQuery("54728-1234").zip, "54728");
  assert.equal(RP.geocodeQuery("Chetek, WI").st, "wi");
  assert.match(RP.geoPick("54728", []).error, /ZIP 54728.*town and state/);
  assert.equal(RP.placeLabel({ name: "Chetek", admin1: "Wisconsin" }), "Chetek, WI");
});

test("a share link that can't be drawn says why", () => {
  assert.match(RP.linkProblem("?d=garbage!!"), /damaged or cut short/);
  assert.match(RP.linkProblem("?place=Chetek&year=1849"), /year \(1849\)/);
  // 2026-10-14: a bad year draws the last full year, and the note says which
  assert.equal(RP.linkProblem("?place=Chetek&year=1700", "2026-10-14"), "That link\u2019s year (1700) isn\u2019t one I can draw, so this shows 2025. Pick another year and press Draw it.");
  assert.match(RP.linkProblem("?place=Chetek&year=abc"), /year \(abc\)/);
  assert.match(RP.linkProblem("?year=2020"), /no town/);
  assert.equal(RP.linkProblem("?d=" + RP.encodeCode({ place: "Chetek, WI", year: 2025 })), "");
  assert.equal(RP.linkProblem(""), "", "no design in the link is not a problem");
});

test("one name for the $19 product, curly apostrophes in FAQ titles, no 'made-up numbers' share or thumb text", () => {
  const G = readFileSync(ROOT + "gifts-for-farmers.html", "utf8"), P = readFileSync(ROOT + "components/rain-print-promo.js", "utf8"), C = readFileSync(ROOT + "rp-gift.html", "utf8");
  assert.match(G, /<li>Digital file <b>\$<span data-gf-price="digital">/);
  for (const [n, t] of [["rain-print", HTML], ["gifts", G], ["gift card", C]]) assert.ok(!/print files?\b[^.]{0,40}\$19|Print file <b>|print file of the whole year|A print file is/.test(t), n + ": the $19 product is the Digital file");
  assert.match(HTML, /<li>A PNG and a PDF, 12 x 18 in at 300 dpi, no watermark<\/li>/, "the file says its types (2026-10-15)");
  const ld = JSON.parse(HTML.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  const faq = ld["@graph"].find((g) => g["@type"] === "FAQPage").mainEntity.map((q) => q.name);
  const shown = [...HTML.matchAll(/<details><summary>([^<]*)<\/summary>/g)].map((m) => m[1].replace(/&rsquo;/g, "\u2019").replace(/&ldquo;/g, "\u201c").replace(/&rdquo;/g, "\u201d"));
  for (const q of faq) { assert.ok(!q.includes("'"), "JSON-LD FAQ title has a straight apostrophe: " + q); assert.ok(shown.includes(q), "visible FAQ title matches word for word: " + q); }
  assert.ok(!shown.some((q) => q.includes("'")), "no straight apostrophe in a visible FAQ title");
  for (const [n, t] of [["rain-print", HTML], ["promo", P], ["gifts", G]]) assert.ok(!/made-up numbers/i.test(t), n + ": no 'made-up numbers' alt text");
  assert.ok(!/rp-card-s/.test(P), "the thumb carries its own Example tag; no second Sample label over it");
});

test("a Stripe reference RPS-<id> or GIFT-RPS-<id> opens as rain-print?d=, through the short link", () => {
  // checkoutRef sends these for a design past 200 characters; the data file tells Sig to open rain-print?d=<reference>
  const long = RP.encodeCode({ place: "Chetek, WI", year: 2025, name: "The Johnson Family Farm", dedication: "For Dad, his 40th crop on the home place. Love, Kate, Ben and Ole",
    markers: [{ date: "2025-05-08", label: "Planted beans" }, { date: "2025-07-12", label: "Hail storm" }, { date: "2025-10-24", label: "Harvest done" }] });
  assert.ok(long.length > 200, "this design goes to Stripe as RPS-");
  for (const gift of [false, true]) {
    const ref = RP.checkoutRef(long, gift, "HTTPS://AGSIST.COM/R?K7Q2M");
    assert.equal(RP.linkProblem("?d=" + ref), "", ref + " is not called damaged");
    assert.deepEqual(plain(RP.shortRefOf(ref)), { id: "K7Q2M", gift });
  }
  assert.deepEqual(plain(RP.shortRefOf("gift-rps-k7q2m")), { id: "K7Q2M", gift: true }, "typed in lower case");
  assert.deepEqual(plain(RP.shortRefOf("RPS-AB1OC")), { id: "AB10C", gift: false }, "O read as 0, as /r reads it");
  for (const bad of ["RPS-", "RPS-AB1", "RPS-ABCDEFGHJ", "XRPS-AB12C", "RPS-AB12C-", "GIFT-GIFT-RPS-AB12C", "RPS-UUUUU", ""]) assert.equal(RP.shortRefOf(bad), null, bad);
  assert.match(RP.linkProblem("?d=RPS-AB1"), /damaged or cut short/, "a cut-short reference still says so");
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  assert.match(S, /var LINK_REF = ST\.place \? null : shortRefOf\(/, "the page looks the reference up when the link has no design of its own");
  assert.match(S, /root\.AgRpShort\.resolve\(ref\.id\)/);
  assert.match(S, /if \(ref\.gift\) s\.gift = true;/, "GIFT- keeps the gift flag");
  const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  assert.match(J._about, /rain-print\?d=RPS-<id> opens it too/, "the data file says how to open one");
});

test("stations in plain words: no raw ACIS id pair, names out of caps", () => {
  assert.equal(RP.sidPlain("471667 2"), "NOAA co-op station 471667");
  assert.equal(RP.sidPlain("14991 3"), "NOAA station 14991");
  assert.equal(RP.stationName("CHETEK"), "Chetek");
  assert.equal(RP.stationName("CAMERON 2 NE"), "Cameron, 2 mi NE");
  assert.equal(RP.stationName("RICE LAKE MUNI AP"), "Rice Lake Municipal Airport");
  assert.equal(RP.milesText(0.43), "0.4 mi");
  // 2026-10-14: one label everywhere, the offset said once, and CoCoRaHS gauges named as such
  assert.deepEqual(plain(RP.stationParts("CAMERON 2 NE")), { name: "Cameron", off: "2 mi NE" });
  assert.equal(RP.stationLabel({ name: "CAMERON 2 NE", state: "WI" }), "Cameron, WI (2 mi NE of Cameron)");
  assert.equal(RP.stationLabel({ name: "CHETEK", stateAbbr: "WI" }), "Chetek, WI");
  // the station named for the buyer's own town: one distance, from the town (2026-10-15)
  assert.equal(RP.stationLabel({ name: "AMES 2.6 NNW", state: "IA", city: "Ames" }), "Ames, IA");
  assert.equal(RP.stationLabel({ name: "AMES 2.6 NNW", state: "IA", city: "Nevada" }), "Ames, IA (2.6 mi NNW of Ames)");
  // a town and state typed with no comma (2026-10-15)
  for (const [q, town, st] of [["Ames Iowa", "Ames", "ia"], ["Ames IA", "Ames", "ia"], ["Springfield IL", "Springfield", "il"], ["Sioux Falls South Dakota", "Sioux Falls", "sd"], ["Missouri Valley IA", "Missouri Valley", "ia"], ["Des Moines", "Des Moines", ""], ["Indiana", "Indiana", ""], ["Chetek, WI", "Chetek", "wi"]]) {
    const g = RP.geocodeQuery(q);
    assert.deepEqual([g.town, g.st], [town, st], q);
  }
  const two = [{ name: "Springfield", admin1: "Illinois", latitude: 39.8, longitude: -89.6 }, { name: "Springfield", admin1: "Missouri", latitude: 37.2, longitude: -93.3 }];
  assert.equal(RP.geoPick("Springfield IL", two).hit.admin1, "Illinois", "no 'which one?' when the state was typed without a comma");
  assert.equal(RP.sidPlain("US1WIBN0004 6"), "volunteer gauge US1WIBN0004");
  assert.equal(RP.milesText(23.6), "24 mi");
});

test("the page shows no raw station id and no stale design after a failed draw", () => {
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  assert.ok(!/NOAA station ' \+ esc\(m\.sid\)/.test(S), "the raw sid is never printed");
  const fail = S.slice(S.indexOf("function failDraw"), S.indexOf("function showPick"));
  for (const k of ["DATA = null", "META = null", "BLOCKED = 'failed'", "$('ro-design').value = ''", "$('rp-order').hidden = true", "showBuy(false)"]) assert.ok(fail.includes(k), "failDraw clears " + k);
  assert.match(S, /failDraw\(err\);/, "every draw error goes through it");
  assert.match(S, /AbortController/, "outside calls time out");
});

// ---------- buyer text ----------
const ART = ctx.AgRainArt;
const DAY = 86400000;
function year(y, f) {
  const n = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365, days = [];
  for (let i = 0; i < n; i++) {
    const dt = new Date(Date.UTC(y, 0, 1) + i * DAY), o = Object.assign({ p: (i % 9 === 0 ? (0.1 + (i % 7) * 0.12).toFixed(2) : "0.00"), s: 0 }, f ? f(i, dt) : {});
    const pp = RP.parsePcpn(o.p);
    days.push({ date: dt.toISOString().slice(0, 10), v: pp.v, flag: pp.flag, t: null, s: o.s, m: dt.getUTCMonth(), d: dt.getUTCDate(), doy: i });
  }
  return days;
}
const normalMap = (y) => { const m = new Map(); year(y).forEach((x) => m.set(x.date.slice(5), 0.09)); return m; };
function input(days, extra = {}) {
  const D = RP.derive(days), y = +days[0].date.slice(0, 4);
  return Object.assign({ style: "r1", year: y, place: "Chetek, Wisconsin", name: "The Olson Farm", dedication: "", days, D, showDry: RP.showDry(D),
    axisLen: days.length, ov: RP.overlayDaily(days, normalMap(y)), ovNote: "Usual = 30-year normal", showNormals: false, markers: [], records: [],
    qr: { matrix: ctx.AgQR.matrix("HTTPS://AGSIST.COM/R?K7Q2M"), serial: "" } }, extra);
}
const texts = (svg) => [...svg.matchAll(/<text[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ size: +m[1], t: m[2].replace(/&amp;/g, "&") }));

test("emoji and symbols outside the print's fonts are left out; letters with accents and curly quotes stay", () => {
  assert.equal(RP.printable("The Johnson Farm 🌽 & Sons"), "The Johnson Farm  & Sons");
  assert.equal(RP.normalize({ place: "Chetek, WI", year: 2025, name: "The Johnson Farm 🌽" }).name, "The Johnson Farm");
  assert.equal(RP.printable("Ferme Côté, “Mom’s” – 1952…"), "Ferme Côté, “Mom’s” – 1952…");
  assert.ok(RP.hasUnprintable("❤️ Dad") && !RP.hasUnprintable("Dad"));
  assert.equal(RP.normalize({ place: "Chetek, WI", year: 2025, markers: [{ date: "2025-05-01", label: "🐄 Turnout" }] }).markers[0].label, "Turnout");
});

test("dates outside the year are named, and the label ideas include livestock and hay", () => {
  const p = RP.dateProblems(2025, ["2024-06-01", "2025-05-01", ""]);
  assert.equal(p.length, 1);
  assert.match(p[0].msg, /isn’t in 2025/);
  assert.equal(RP.dateProblems(2025, ["2025-05-01", "2025-05-01"])[0].msg, "Days 1 and 2 are both May 1. Pick another day for one of them.");
  // plain words, never a machine date like 2025-02-31 (panel 5, 2026-10-15)
  assert.deepEqual([...RP.dateProblems(2025, ["2025-02-31"]).map((x) => x.msg)], ["February has 28 days in 2025. Pick a day from 1 to 28."]);
  assert.deepEqual([...RP.dateProblems(2023, ["2023-02-29"]).map((x) => x.msg)], ["2023 has no February 29. Pick Feb 28 or Mar 1."]);
  assert.equal(RP.dayProblem(2024, "02", "30"), "February has 29 days in 2024. Pick a day from 1 to 29.");
  assert.equal(RP.dayProblem(2025, "04", "31"), "April has 30 days. Pick a day from 1 to 30.");
  assert.equal(RP.dayProblem(2024, "02", "29"), "");
  for (const x of RP.dateProblems(2025, ["2024-06-01", "2025-02-31", "2025-11-31", "2025-05-01", "2025-05-01"])) assert.ok(!/\d{4}-\d{2}-\d{2}/.test(x.msg), x.msg);
  for (const w of ["First frost", "Anniversary", "Retired"]) assert.ok(RP.LABEL_PRESETS.includes(w), w);
  for (const w of ["Planted", "Harvest done", "Turnout", "Calving", "Weaning", "First cutting"]) assert.ok(RP.LABEL_PRESETS.includes(w), w);
  for (const w of RP.LABEL_PRESETS) assert.ok(w.length <= RP.LIMITS.label, w + " fits the label box");
  const html = readFileSync(ROOT + "rain-print.html", "utf8");
  for (const id of ["rp-name-n", "rp-ded-n", "rp-m1err", "rp-m2err", "rp-m3err", "rp-date-say", "rp-sym-note"]) assert.ok(html.includes(`id="${id}"`), id + " is on the page");
  assert.match(html, new RegExp(`id="rp-name" type="text" maxlength="${RP.LIMITS.name}"`));
  assert.match(html, new RegExp(`${RP.LIMITS.dedication} letters`), "the counter states the real limit");
});

test("the longest dedication (70) prints whole at both styles, at 14 u or more, inside the trim", () => {
  const ded = "For Grandpa Erling, sixty harvests and counting. Love, all the grandkids".slice(0, 70);
  assert.equal(ded.length, 70);
  for (const style of ["r1", "r2"]) {
    const t = texts(ART.render(input(year(2025), { style, name: "Prairie View Seed and Gr", dedication: ded })));
    const d = t.find((x) => x.t === ded);
    assert.ok(d, style + ": printed whole");
    assert.ok(d.size >= 14, style + ": at " + d.size + " u");
  }
});

// ---------- the print's small lines ----------
test("the print names the gauge and distance, and counts gaps only past 3 missing days, both styles", () => {
  const gauge = "Weather station: Chetek, WI, 0.4 mi from Chetek";
  for (const style of ["r1", "r2"]) {
    const full = texts(ART.render(input(year(2025), { style, gauge })));
    const line = full.find((x) => x.t.startsWith("Weather station:"));
    assert.ok(line && line.size >= 12, style + ": gauge line at production size");
    assert.ok(!/no report/.test(line.t), style + ": no gap note on a full year");
    // Sig, 2026-10-15: the long gap sentence is gone; 3 or fewer missing days say nothing, more say the count, short
    for (const n of [1, 3]) {
      const quiet = texts(ART.render(input(year(2025, (i) => (i >= 40 && i < 40 + n ? { p: "M" } : {})), { style, gauge })));
      assert.ok(!quiet.some((x) => /no report|Gaps:/.test(x.t)), style + ": " + n + " missing days: nothing on the print");
    }
    const gappy = texts(ART.render(input(year(2025, (i) => (i >= 40 && i < 66 ? { p: "M" } : {})), { style, gauge })));
    assert.ok(gappy.some((x) => /(^|  ·  )Gaps: 26 days with no report($|  ·  )/.test(x.t) && x.size >= 12), style + ": 26 missing days: the short note, with the count");
    assert.ok(!gappy.some((x) => /sent no report|break in the ground line|gap in the line/.test(x.t)), style + ": the long sentence is gone");
    const four = texts(ART.render(input(year(2025, (i) => (i >= 40 && i < 44 ? { p: "M" } : {})), { style, gauge })));
    assert.ok(four.some((x) => /Gaps: 4 days with no report/.test(x.t)), style + ": 4 missing days: the note");
    const sOnly = texts(ART.render(input(year(2025, (i) => (i >= 40 && i < 50 ? { p: "S" } : i === 50 ? { p: "1.00A" } : {})), { style, gauge })));
    assert.ok(!sOnly.some((x) => /Gaps:/.test(x.t)), style + ": days rolled into a later total were reported: no gap note");
  }
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  assert.match(S, /gauge: META \? gaugeLine\(META\) : ''/, "the engine hands the art the gauge line");
});

test("R2: no unexplained dots at the ground line; R1 says what light blue is", () => {
  const days = year(2025, (i) => (i % 5 === 1 ? { p: "T" } : i < 60 && i % 9 === 0 ? { s: 4 } : {}));
  assert.ok(!/r="1\.3"/.test(ART.render(input(days, { style: "r2" }))), "trace dots are gone");
  assert.ok(texts(ART.render(input(days, { style: "r1" }))).some((x) => /light blue: snow/.test(x.t)));
});

test("two records on one day print as one label", () => {
  const rp = ART.recordPoints({ year: 2025, n: 365 }, [{ date: "2025-11-20", label: "Biggest snow: 8.0 in" }, { date: "2025-11-20", label: "First snow: 8.0 in" }, { date: "2025-03-02", label: "Coldest: -20°F" }]);
  assert.deepEqual(plain(rp.pts.map((p) => p.label)), ["Coldest: -20°F", "First snow and biggest snow: 8.0 in"]);
  const two = ART.recordPoints({ year: 2025, n: 365 }, [{ date: "2025-01-05", label: "Coldest: -20°F" }, { date: "2025-01-05", label: "Biggest snow: 9.0 in" }]);
  assert.equal(two.pts.length, 1);
  assert.match(two.pts[0].label, /Coldest: -20°F; biggest snow: 9\.0 in/);
});

// ---------- Christmas dates and copy ----------
const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
const HTML = readFileSync(ROOT + "rain-print.html", "utf8");

test("the Christmas cutoffs are the last order day that still arrives by Dec 24 under the page's own promise", () => {
  for (const [id, key] of [["print12x18", "print_christmas_cutoff"], ["framed12x18", "framed_christmas_cutoff"]]) {
    const cut = RP.christmasCutoff(J, id, 2026);
    assert.equal(J[key], cut, key + " agrees with the ship-time numbers in the same file");
    const n = J.proof_business_days + J.approve_business_days + J.ship_business_days + J.transit_business_days[id];
    assert.ok(RP.addBizDays(cut, n, J.holidays) <= "2026-12-24", key + ": an order on the cutoff arrives by Dec 24");
    const next = new Date(Date.parse(cut + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
    assert.ok(RP.addBizDays(next, n, J.holidays) > "2026-12-24", key + ": the day after does not");
  }
  // 2026-10-14 (Sig): ships within 3 business days of the OK (was 7)
  assert.equal(J.ship_business_days, 3, "the cutoffs use the same 3 business days the page promises");
  assert.match(J.ships_within, /within 3 business days/);
  assert.equal(J.print_christmas_cutoff, "2026-12-10");
  assert.equal(J.framed_christmas_cutoff, "2026-12-09");
  assert.match(HTML, /<p class="rp-note" id="rp-ships">Prints and framed prints ship within 3 business days after you approve the proof, anywhere in the 50 states\./);
  assert.ok(!/7 business days/.test(HTML), "no old shipping promise left on the page or in its structured data");
  assert.equal(RP.addBizDays("2026-12-04", 1, []), "2026-12-07", "a Friday plus one business day is Monday");
  assert.equal(RP.christmasCutoff({ ...J, ship_business_days: null }, "print12x18", 2026), null, "a missing number gives no date, not a guess");
});

test("shipping included is said plainly; no archival claim; care line; the reprint policy is final (Sig, 2026-10-14)", () => {
  assert.match(HTML, /<b data-price="digital">\$19<\/b> digital file<\/span><span>Shipping included<\/span>/, "the price line under the lede");
  // Sig, 2026-10-14: Alaska and Hawaii are covered, Christmas dates included; Puerto Rico not promised
  assert.equal((HTML.match(/<li>Shipping included, anywhere in the 50 states<\/li>/g) || []).length, 2, "both shipped products, under What you get");
  assert.ok(!/US addresses/.test(HTML + JSON.stringify(J)), "no looser 'US addresses' that would take in Puerto Rico");
  assert.match(HTML, /anywhere in the 50 states, Alaska and Hawaii included/);
  assert.match(HTML, /To have a past year by Christmas, anywhere in the 50 states, order by the date shown with your choice/);
  assert.ok(!/archival/i.test(HTML + readFileSync(ROOT + "components/rain-print.js", "utf8")), "never called archival");
  assert.equal((HTML.match(/Keep a print out of direct sun; the inks fade in strong light\./g) || []).length, 1, "the care line once, for both (2026-10-15)");
  assert.ok(!/DRAFT-POLICY/.test(HTML), "the reprint and refund promise is final: no draft marker");
  assert.ok(!/[\u2014]/.test(HTML.replace(/<script[\s\S]*?<\/script>/g, "")), "no em dashes in the page copy");
  assert.ok(!/OWNER-SHIPPING|placeholder sentence/i.test(HTML), "no shipping placeholder left");
});

test("the page head: unique title, real prices, FAQ and breadcrumb, a Rain Print share image, canonical", () => {
  assert.match(HTML, /<title>Rain Print: [^<]+ \| AGSIST<\/title>/);
  assert.match(HTML, /<link rel="canonical"\s+href="https:\/\/agsist\.com\/rain-print">/);
  const ld = JSON.parse(HTML.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  const types = ld["@graph"].map((g) => g["@type"]);
  for (const t of ["Product", "FAQPage", "BreadcrumbList"]) assert.ok(types.includes(t), t);
  const prod = ld["@graph"].find((g) => g["@type"] === "Product");
  // the share card first (with the ?v=<hash> scripts/build_share_images.py gives it, the same URL as og:image),
  // then the two example prints drawn from real NOAA years (test/rain-print-examples.test.mjs)
  const og = HTML.match(/property="og:image"\s+content="([^"]+)"/)[1];
  assert.match(og, /^https:\/\/agsist\.com\/img\/og\/rain-print\.jpg\?v=[0-9a-f]{8}$/);
  assert.deepEqual(prod.image, [og, "https://agsist.com/img/rain-print-example-2012-ames-ia.jpg", "https://agsist.com/img/rain-print-example-1993-des-moines-ia.jpg"]);
  assert.deepEqual(prod.offers.map((o) => o.price), [String(J.digital), String(J.print12x18), String(J.framed12x18)]);
  assert.ok(!prod.aggregateRating && !prod.review, "no made-up ratings");
  for (const k of ['property="og:image"', 'name="twitter:image"']) assert.match(HTML, new RegExp(k + "\\s+content=\"https://agsist.com/img/og/rain-print.jpg\\?v=[0-9a-f]{8}\""));
  const img = readFileSync(ROOT + "img/og/rain-print.jpg");
  assert.ok(img.length < 150000, "share image is small: " + img.length);
  assert.equal(img[0], 0xff); assert.equal(img[1], 0xd8);
  // a JPEG's size: find the SOF0/SOF2 marker
  let i = 2, w = 0, h = 0;
  while (i < img.length) { const m = img[i + 1], len = img.readUInt16BE(i + 2); if (m === 0xc0 || m === 0xc2) { h = img.readUInt16BE(i + 5); w = img.readUInt16BE(i + 7); break; } i += 2 + len; }
  assert.deepEqual([w, h], [1200, 630]);
});

/* 2026-10-13, Sig: Rain Print launches, with the rain gauge waiting list. Both are
   in the menu and the footer (live and static copies alike) and the promo is on. */
test("Rain Print and the rain gauge list are in the menus and footer at launch (2026-10-13)", () => {
  assert.equal(J.promote, true);
  for (const f of ["components/header.html", "components/footer.html", "components/header-fallback.html", "components/footer-fallback.html"]) {
    const t = readFileSync(ROOT + f, "utf8");
    assert.ok(/href="\/rain-print"/.test(t), f + " links Rain Print");
    assert.ok(/href="\/rain-gauge"/.test(t), f + " links the rain gauge page");
  }
  const h = readFileSync(ROOT + "components/header.html", "utf8");
  assert.equal((h.match(/href="\/rain-print"/g) || []).length, 2, "the desktop menu and the phone drawer, once each");
  assert.ok(/<symbol id="i-cloud-rain"/.test(h) && /<symbol id="i-test-tube"/.test(h), "their icons are in the sprite");
});

// ---------- checkout and proof ----------
test("checkout never dead-ends: a design code over 200 goes to Stripe as its short-link id", () => {
  const long = { place: "Saint Francisville Twp, WV", station: "USC00471667 6", year: 2025, cmp: "normal", style: "r2", normals: true, records: true,
    name: "Prairie View Seed and Gr", dedication: "For Grandpa Erling, sixty harvests and counting. Love, all the grandkids".slice(0, 70),
    markers: [1, 2, 3].map((i) => ({ date: `2025-0${i + 3}-1${i}`, label: "First cutting" })) };
  const code = RP.encodeCode(long);
  assert.ok(code.length > 200, "this design's code really is too long for Stripe: " + code.length);
  assert.equal(RP.checkoutRef(code, false, "HTTPS://AGSIST.COM/R?K7Q2M"), "RPS-K7Q2M");
  assert.equal(RP.checkoutRef(code, true, "HTTPS://AGSIST.COM/R?K7Q2M"), "GIFT-RPS-K7Q2M");
  assert.ok(/^[A-Za-z0-9_-]{1,200}$/.test(RP.checkoutRef(code, true, "HTTPS://AGSIST.COM/R?K7Q2M")));
  assert.equal(RP.checkoutRef(code, false, null), "", "no short id: no Stripe, the order form opens");
  const short = RP.encodeCode({ place: "Chetek, WI", year: 2025 });
  assert.equal(RP.checkoutRef(short, false, null), short, "a code that fits goes as it is");
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  // 2026-10-14 (Sig, standard code on previews): no short id is made on a redraw, so pay() makes one at the press when the code is too long
  const P = S.slice(S.indexOf("function pay(opts)"), S.indexOf("function staleInputs"));
  assert.match(P, /if \(link && long && !\(opts && opts\.minted\) && root\.AgRpShort && root\.AgRpShort\.mint\) \{/, "pay() makes the short id at the press, once");
  // 2026-10-15: asked of the worker at every press (never a kept id alone); a failed ask goes to the order form, not to Stripe with a kept id
  assert.match(P, /root\.AgRpShort\.mint\(encodeCode\(artDesign\(\)\), \{ fresh: true \}\)/);
  assert.match(P, /var code = link && long && !\(opts && opts\.ok\) \? '' : refFor\(\);/);
  assert.match(P, /: refFor\(\);/, "pay() uses the reference");
  assert.match(P, /closeProof\(true\);[\s\S]{0,140}openOrder\(id, link \? 'Checkout couldn\\u2019t open just now, so send this and I\\u2019ll email you a payment link\.' : ''\);\n  \}/, "and falls back to the order form, saying why");
  // 2026-10-14 (Sig): checkout in the same tab, never a second window
  assert.match(P, /goTo\(u\);/);
  assert.ok(!/root\.open\(/.test(S), "no window.open anywhere on the page");
  assert.match(S, /design_code: orderCode\(\)/, "the order form sends a code the worker takes (300 at most)");
});

test("the proof view and the order summary are on the page", () => {
  for (const id of ["rp-proof", "rp-zoom", "rp-proof-art", "rp-proof-ok", "rp-pay", "ro-summary"]) assert.ok(HTML.includes(`id="${id}"`), id);
  // 2026-10-14 (the approved flow): the review sheet mirrors step 3's picker; its Style and Look switches are gone (one product state)
  for (const v of ["framed12x18", "print12x18", "digital"]) { assert.ok(HTML.includes(`name="rp-pproduct" value="${v}"`), v); assert.ok(HTML.includes(`name="rp-product" value="${v}"`), v); }
  assert.ok(!/data-pstyle|data-pview/.test(HTML), "no second Style or Look state in the sheet");
  assert.match(HTML, /\.rp-proof\[data-zoom="full"\] \.rp-proof-art svg\{width:18in/, "actual size is 18 in wide");
  // 2026-10-14 (Sig): one magnifier on the print toggles Fit and actual size; the in-between "Closer" step is gone
  assert.ok(HTML.includes('id="rp-zoom"') && HTML.includes('id="rp-proof-zoom" aria-pressed="false"'), "a zoom button by the preview and the magnifier on the print");
  assert.ok(!/data-pzoom=/.test(HTML), "no row of zoom pills");
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  assert.match(S, /\$\('rp-zoom'\)\.addEventListener\('click', openProof\)/, "Up close opens the full-size view");
  assert.match(S, /\$\('rp-pay'\)\.addEventListener\('click', checkIt\)/, "Check it and pay opens it as the review sheet");
  assert.match(S, /art\.addEventListener\('click'/, "tapping the preview opens it too");
  assert.match(S, /else startNear\(\);/, "a new visitor's first print is their own area");
  assert.match(S, /workers\.dev\/where', \{ credentials: 'omit' \}/, "from the worker's /where, no cookies");
  assert.match(S, /if \(!mine\(\)\) runSample\(\)/, "no answer: the sample, never over a town the reader typed");
  // 2026-10-14 (Sig): example words are gray hints only, shown on a new visit's print at the top and never in the design
  assert.match(S, /if \(!ST\.place\) \{ ST\.cmp = 'normal'; ST\.normals = true; ST\.records = true; SHOW_EX = !PAID; \}/, "a new visit: empty boxes, remarkable days on (Sig, 2026-10-15)");
  assert.ok(!/withExample|exampleLeft|clearExample|EX_OK/.test(S), "no example guard, no bounce, no Clear the example");
  assert.match(S, /name: ex \? EXAMPLE\.name : ST\.name/, "the example is drawn only where asked (the preview at the top)");
  assert.match(S, /PROOF_VIEW = PICK === 'framed12x18' \? 'framed' : 'print';/, "the sheet shows what step 3 picked");
  assert.match(S, /buildSvg\(\{ idPrefix: 'pf', serial: SERIAL \}\)/, "the proof is the same renderer as the print file");
  assert.match(S, /What happens next/);
});

// ---------- gift cards on the page (components/rp-gift.js, worker v5.16) ----------
test("a ?gift= card is redeemed on the page; the free pre-payment card is gone", () => {
  const H = readFileSync(ROOT + "rain-print.html", "utf8"), S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  assert.match(H, /<script src="\/components\/rp-gift\.js\?v=4" defer><\/script>/);
  assert.ok(H.indexOf("/components/rain-print.js?v=") < H.indexOf("/components/rp-gift.js"), "the page script is in place before the gift script runs");
  for (const id of ["rp-gift-banner", "rp-gift-use"]) assert.ok(H.includes(`id="${id}"`), id);
  assert.ok(!/Print a gift card|id="rp-card"|id="rp-giftcard"|rp-carding/.test(H + S), "no free printable card before payment");
  assert.match(S, /A\.open\(gc, \{ banner: \$\('rp-gift-banner'\)/, "the banner is filled by rp-gift.js");
  const sub = S.slice(S.indexOf("function submitOrder"), S.indexOf("// ---------- for businesses"));
  assert.ok(sub.indexOf("root.AgRpGift.redeem(GIFT, x)") > 0 && sub.indexOf("root.AgRpGift.redeem(GIFT, x)") < sub.indexOf("send('rain-print-order'"), "a gift order posts redeem, not a plain order");
  assert.match(S, /\(g\.locked \|\| \[\]\)\.forEach\(lockInput\)/, "a locked card holds its inputs still");
  for (const f of ["place", "year", "style", "name", "dedication", "markers", "normals", "records", "cmp", "station"]) assert.ok(new RegExp("\\b" + f + ": \\[").test(S.slice(S.indexOf("var LOCK_IDS"), S.indexOf("function lockInput"))), "lockable: " + f);
});

test("rp-gift.js reads a locked card's design with this page's decoder", () => {
  const g = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob, Map, Promise };
  g.window = g;
  vm.runInNewContext(readFileSync(ROOT + "components/rain-print.js", "utf8"), g);
  vm.runInNewContext(readFileSync(ROOT + "components/rp-gift.js", "utf8"), g);
  const design = g.RainPrint.encodeCode({ place: "Chetek, WI", year: 2025, style: "r2", name: "The Olson Farm", dedication: "For Grandpa Erling, sixty harvests and counting. Love, all the grandkids".slice(0, 70) });
  const G = g.AgRpGift._state({ ok: true, kind: "locked", product: "framed12x18", status: "issued", lock: { design_code: design, edit: "name" } }, "RP-7K3M-Q9TW-H2F3");
  assert.equal(G.usable, true);
  assert.equal(G.lock.design.dedication.length, 70, "a 70-letter line survives the card");
  assert.ok(!G.locked.includes("name") && G.locked.includes("place"));
});

// ---------- Sig's decisions of 2026-10-13 ----------
test("business copy matches Sig's decisions and the json: min 5, delivered tiers, note card, January, paperwork", () => {
  const faq = HTML.match(/<details><summary>Can a business order a set\?[\s\S]*?<\/details>/)[0];
  const T = J.business_tiers, off = J.business_one_address_off;
  assert.deepEqual(T.map((t) => [t.min, t.print12x18, t.framed12x18]), [[5, 45, 89], [10, 40, 79], [25, 37, 75], [50, 35, 72]]);
  assert.deepEqual([off.print12x18, off.framed12x18, J.business_quote_max], [3, 6, 100]);
  // the FAQ's figures are written out, so they must agree with the json
  assert.match(faq, new RegExp("5 to 9 prints cost the regular price, on one invoice"));
  assert.match(faq, new RegExp("10 to 24 are \\$" + T[1].print12x18 + " a print or \\$" + T[1].framed12x18 + " framed; 25 to 49, \\$" + T[2].print12x18 + " or \\$" + T[2].framed12x18 + "; 50 to 100, \\$" + T[3].print12x18 + " or \\$" + T[3].framed12x18));
  assert.match(faq, new RegExp("From 10 prints, all to one address takes \\$" + off.print12x18 + " off each print and \\$" + off.framed12x18 + " off each framed"));
  assert.match(faq, /Over 100, ask me/);
  assert.equal(T[0].print12x18, J.print12x18, "5-9 is the card price");
  assert.equal(T[0].framed12x18, J.framed12x18);
  assert.match(HTML, /How many prints \(5 or more\)<\/span><input id="rb-qty" type="number" min="5" max="500"/);
  assert.match(HTML, /Business orders start at 5 prints/);
  assert.match(HTML, /A 2026 print ships in January/);
  assert.match(HTML, /note card in the box/);
  assert.match(HTML, /does not go on the print/);
  // Sig, 2026-10-14: a business logo may go on the print, small, if they upload one
  assert.match(HTML, /If you want your logo on it, upload one with your request: it prints small, next to the name/);
  assert.match(HTML, /Your business name stays off the print too; a logo can go on it, small next to the name, if you upload one\./);
  assert.match(HTML, /an invoice, net 30, and a W-9 on request/);
  assert.match(HTML, /one proof sheet/);
  assert.ok(!/compliments of/i.test(HTML), "no 'Compliments of' line");
  assert.ok(!/limit to how many|order cap/i.test(HTML), "no order cap");
});

test("prints ship flat between chipboard, never rolled; no mat is sold", () => {
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  for (const [n, t] of [["page", HTML], ["json", JSON.stringify(J)], ["script", S]]) {
    assert.ok(!/\btube\b|rolled in|ships rolled/i.test(t.replace(/rolled into a later/g, "")), n + " says nothing about a tube");
  }
  assert.match(HTML, /<li>Ships flat between chipboard<\/li>/);
  assert.match(HTML, /black frame, no mat/);
  assert.ok(!/stock frame/.test(HTML), "a black frame, not a 'stock' one (2026-10-15)");
  // the box picture is a render of an older layout: it says so, and it keeps its shape
  assert.match(HTML, /<figcaption>Mockup of a framed print\. Photos of real prints coming soon\.<\/figcaption>/);
  assert.match(HTML, /\.rp-onwall img\{display:block;width:100%;height:auto\}/);
});

test("refund and reprint wording: Sig's terms, $15 to reprint a lost or damaged print", () => {
  const faq = HTML.match(/<details><summary>What if something[\s\S]*?<\/details>/)[0];
  assert.match(faq, /refund you in full/);
  assert.match(faq, /reprint it free/, "a print that differs from the OK'd proof is Sig's error: free");
  // 2026-10-14 (panel 3, T3): a photo for damage only; a lost parcel is a tracking matter
  assert.match(faq, /If it arrives damaged, glass included, send a photo\. If tracking shows it lost, write to me\. Either way I&rsquo;ll reprint or reframe it for \$15, with the same serial number/);
  assert.ok(!/damaged[^.]*reprint it free/.test(faq), "damage is no longer reprinted free");
  assert.equal(J.reprint_fee, 15, "Sig set $15 (2026-10-14)");
  assert.ok(!/small fee/.test(HTML), "the amount, not 'a small fee'");
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  assert.match(S, /typeof j\.reprint_fee === 'number' && j\.reprint_fee > 0\) \{[\s\S]{0,600}function \(\) \{ return 'reframe it for ' \+ money\(j\.reprint_fee\) \+ ', with'; \}/);
  assert.match(J.gift_delivery, /^A \{year\} print ships in January \{next\}/);
});

// ---------- polish pass, group B (2026-10-14) ----------
const S2 = readFileSync(ROOT + "components/rain-print.js", "utf8");
const slice = (a, b) => S2.slice(S2.indexOf(a), S2.indexOf(b, S2.indexOf(a) + 1));
const visible = HTML.replace(/<script[\s\S]*?<\/script>/g, "");

test("Sig's notes: no printer named anywhere, framed prints have real glass, packed well", () => {
  assert.ok(!/epson|artisan|acrylic/i.test(HTML + S2), "no printer model, no acrylic");
  assert.match(HTML, /<li>Real glass front, packed with corner guards and foam, double-boxed<\/li>/);
  assert.match(HTML, /<li>I print it myself, and you see a proof first<\/li>/);
  assert.match(HTML, /I print it myself, frame it if you ordered the frame, and ship it from Chetek, Wisconsin\./);
});

test("a link's station draws even when the station list misses it, or the page says why not", () => {
  const step = slice("STATIONS = list;", "ST.station = chosen.sid;");
  assert.match(step, /if \(linked\) return daily\(linked, ST\.year\)/, "the linked station is asked for directly");
  assert.match(step, /STATIONS = \[chosen\]\.concat\(list\)/, "and listed first under Weather station");
  assert.match(step, /didn\\u2019t answer from NOAA just now, so this print uses the nearest station with a good record/, "a station that fails is named");
  assert.match(step, /n\.classList\.remove\('rp-bad'\)/, "as a note, not an error");
  assert.match(step, /return nearest\(linked\)/, "and the nearest pick skips the station that just failed");
  assert.ok(!/within about 40 miles/.test(S2 + HTML), "no distance the station box doesn't keep");
  // county links carry the station's own place (?ll=lat,lon): the search centers there, distances stay from the town
  assert.match(S2, /return stations\(ll \? ll\.lat : g\.latitude, ll \? ll\.lon : g\.longitude, ST\.year\)/);
  assert.match(S2, /var ll = LINK_LL && LINK_LL\.place === ST\.place && ST\.station \? LINK_LL : null;/, "only on that link's own first town");
  assert.match(S2, /if \(ll && err !== 'stale'\) return llTown\(ll\);/, "a town the lookup doesn't know still draws its station");
  assert.match(S2, /if \(m\.approx\) return 'near ' \+ m\.city;/, "and claims no distance it doesn't know");
});

test("a town with no year, or a bad year, draws the last full year", () => {
  assert.match(S2, /else if \(ST\.place\) \{ ST\.year = lastFullYear\(\); writeInputs\(ST\); run\(\); \}/);
});

test("checkout note: a link to tap, no wall of code, no 'gift' for someone buying for himself", () => {
  const b = slice("function pay(opts)", "function staleInputs");
  assert.match(b, /Opening checkout\\u2026 If nothing happens, <a href="' \+ esc\(u\) \+ '">go to checkout<\/a>\./);
  assert.ok(!/<code>/.test(b), "no design code in the note");
  assert.ok(!/GIFT at the front|new tab/.test(b));
  assert.match(b, /Your design reference: /);
  assert.match(HTML, /<h3>A <span class="rp-cy">2026<\/span> print for Christmas<\/h3>/, "the gift heading says what it is (2026-10-15)");
  assert.match(S2, /'\{year\} \(ships January \{next\}\)'/, "the Year box fallback matches data/rain-print.json");
  assert.equal(J.gift_year_label, "{year} (ships January {next})");
});
test("example words are gray hints only: placeholders in the boxes, never values (2026-10-14, Sig)", () => {
  assert.match(HTML, /id="rp-name" type="text" maxlength="24" placeholder="The Johnson Farm"/);
  assert.match(HTML, /id="rp-ded" type="text" maxlength="70" placeholder="For Dad, his 40th crop\. Love, Kate"/);
  assert.ok(!/id="rp-ex-|Clear the example|These are mine/.test(HTML + S2), "no guard, no bounce, no clear button, and none of their words");
  assert.ok(!/rp-ex-note|data-example/.test(HTML), "no example note or example link on the page");
});

test("one promise for the digital file and the gift card: within 1 business day", () => {
  // 2026-10-14 (Sig): the file has no proof step; it comes finished after paying, and he redoes it free on request
  assert.match(HTML, /<li id="rp-dig-when">The finished file by email within 1 business day of paying<\/li>/);
  assert.ok(!/within a day|Within a business day|after you pay\./.test(visible), "no looser or older promise on the page");
  assert.ok(!/emailed once you OK it|within a day with/.test(S2));
  assert.match(S2, /'The finished file by email in January, once the full year is in'/);
  assert.ok(!/files by email within 1 business day of your OK|file comes by email within 1 business day after you OK|The file is emailed within 1 business day after you OK/.test(HTML + S2), "no proof step for the file anywhere");
  assert.match(visible, /The digital file needs no proof: the finished file comes by email within 1 business day of paying\./);
  assert.match(visible, /if you want anything changed, write to me and I&rsquo;ll fix it or redo it by hand and send it again, no charge\./);
  assert.match(S2, /'The finished file comes by email within 1 business day of paying\. There\\u2019s no proof step for the file\.'/);
  assert.match(J.gift_delivery, /A print or framed print gets a proof first, as with every order\./);
  assert.ok(!/December numbers/.test(HTML + S2), "January, once the full year is in");
  assert.match(HTML, /Within 1 business day of paying, I email you a gift card to print for under the tree/);
});

test("station words are honest and the same everywhere", () => {
  assert.match(HTML, /<option value="">Nearest with a good record<\/option>/);
  assert.match(HTML, /<p class="rp-lede">Type a town and a year, and I draw every rain and snow the nearest weather station caught\. A gift for a farmer, or for the year you married or a child was born\. Drawing it is free\.<\/p>/);
  assert.match(HTML, /A morning reading is filed under the day it was read/);
  assert.ok(!/Rain gauge/.test(S2), "the page says Weather station, not Rain gauge");
  assert.match(S2, /'Weather station: ' \+ gaugeHtml\(m\)/);
  assert.match(S2, /none\.retry = true/, "no answer from any station offers Try again");
  assert.match(S2, /The only station near ' \+ g\.name/, "one station is not 'none of the 1'");
  assert.match(S2, /milesText\(miles\(s\.km\)\) \+ ', ' \+ s\.valid_daterange/, "the station option text is short enough to show whole");
});

test("the source line and stats read plainly", () => {
  assert.match(S2, /' Left off the print for space: '/);
  assert.match(S2, /\['Days with rain or snow', D\.wet\], \['Longest dry stretch'/);
  assert.match(S2, /not known: a report that covers several days could hold a bigger one/);
  assert.match(S2, /if \(!e && !preset && NEAR && ST\.place === NEAR\) \{ NEAR = ''; \$\('rp-place'\)\.value = ''; runSample\(\); return; \}/, "a failed draw of the reader's own area goes back to the sample, quietly");
});

test("type, keyboard and screen reader fixes", () => {
  assert.match(HTML, /#main \.rp \.rp-top>h1\{font-size:clamp\(2rem,2\.4vw,2\.4rem\)\}/, "the h1 stands above the h2s on a laptop");
  assert.match(HTML, /<h2 class="sec-h rp-step-h" id="rp-draw-h">/);
  assert.match(HTML, /\.rp p,\.rp li,\.rp dd,\.rp dt,\.rp summary,\.rp blockquote,\.rp td,\.rp a,\.rp label,\.rp legend\{font-variant-numeric:normal\}/, "no spaced hyphens in prose");
  // "Your print" (2026-10-14): a labeled Close, the details as a plain list beside the print, no long paragraph
  assert.match(HTML, /<button type="button" class="rp-proof-x" id="rp-proof-close" aria-label="Close">/);
  assert.match(HTML, /<h3>Check the details<\/h3><dl class="rp-proof-sum" id="rp-proof-sum"><\/dl>/);
  assert.match(HTML, /<p class="rp-proof-help">Use the magnifier to check every word\. Actual size is 12 x 18 in\.<\/p>/);
  assert.ok(!/rp-proof-more|What&rsquo;s on it, in words/.test(HTML), "the old words box is gone");
  assert.match(HTML, /When I print it, the paper is a little bigger than the print and I trim it to size\./, "the trim sentence lives in the FAQ now");
  for (const i of [1, 2, 3, 4, 5]) assert.ok(HTML.includes(`aria-label="Month for day ${i}" aria-describedby="rp-m${i}err"`) && HTML.includes(`aria-label="Day for day ${i}" aria-describedby="rp-m${i}err"`) && HTML.includes(`aria-label="Label for day ${i}"`), "day " + i + " is named, its message under its own row");
  // each day its own row: "Day 2" at its start and a small x named for it at its end (one line on a laptop, 2026-10-15); no datalist (read as a combobox, a second arrow on Android)
  for (const i of [1, 2, 3, 4, 5]) {
    assert.ok(HTML.includes(`<span class="rp-date-n" id="rp-m${i}h">Day ${i}</span>`), "day " + i + " is numbered");
    assert.ok(HTML.includes(`<button type="button" class="rp-rm" id="rp-m${i}rm" aria-label="Remove day ${i}">&times;</button>`), "day " + i + " has a Remove named for it");
  }
  assert.ok(!HTML.includes('id="rp-m6row"'), "five days at most");
  assert.ok(!/<datalist|list="rp-labels"/.test(HTML), "no datalist");
  // the label boxes start empty; the only hint says what goes there and how much fits, never example words (2026-10-15)
  assert.equal((HTML.match(/id="rp-m\dl"[^>]*maxlength="13" placeholder="What happened \(13 letters\)"/g) || []).length, 5);
  assert.ok(!/id="rp-m\dl"[^>]*placeholder="(?!What happened \(13 letters\))/.test(HTML), "no other hint that looks filled in");
  assert.match(HTML, /Mark a day <span class="rp-step-opt">\(up to 5\)<\/span>/);
  assert.match(HTML, /id="rp-dates-max" hidden>5 days is the most that fits\. Remove one to mark another\.</);
  assert.match(HTML, /\.rp-date \[aria-invalid="true"\]\{border-color:var\(--red\)/, "a bad day's lists get a red border");
  assert.match(HTML, /id="rp-presets" role="group" aria-label="Label ideas"/);
  assert.match(HTML, /id="rp-date-say" aria-live="polite"/);
  assert.match(HTML, /id="rp-proof-stage" role="group"/);
  assert.match(HTML, /html\{scroll-padding-top:84px\}/);
  assert.ok(!/behavior: 'smooth'/.test(S2), "every scroll respects reduced motion");
  assert.match(S2, /\$\('rp-dl-note'\)\.textContent = 'Link copied\.'/);
  assert.match(S2, /if \(doc\.activeElement === go\) \{ try \{ \$\('rp-place'\)\.focus/, "focus never drops to the page when Draw turns off");
  assert.match(S2, /art\.setAttribute\('aria-busy', 'true'\)/);
});

test("copy batch: size, proof, business words", () => {
  // the size and "hung sideways" moved from the up-close paragraph to the FAQ (2026-10-14); the up-close view keeps the size
  assert.match(HTML, /It&rsquo;s 12 x 18 inches, hung sideways, on matte paper\./);
  assert.match(HTML, /Actual size is 12 x 18 in\./);
  // the maker's note is one plain line (2026-10-15, Sig: the quote was "a bit much"); the byline stays on the page
  assert.match(HTML, /<p class="rp-p rp-sig">I print each one myself in Chetek, Wisconsin, and send you a proof first\. Sig<\/p>/);
  assert.ok(!/<blockquote>|crop adviser in Chetek/.test(HTML), "no big quote");
  assert.match(HTML, /<p class="rp-byline">By <a href="\/about">Sigurd Lindquist<\/a>, Certified Crop Adviser \(CCA\)<\/p>/);
  assert.match(HTML, /<p>Yes\. At checkout, give their name, your note for the card and their address\./, "the gift FAQ says what the page does now");
  assert.ok(!/above the prices|price card/.test(HTML), "no FAQ points at the old price cards");
  assert.match(HTML, /Once you OK the proof sheet, I print them/);
  assert.match(S2, /'Rain Print order'/);
  assert.match(S2, /framed: \['framed print', 'framed prints'\]/);
  assert.ok(!/Chetek Co-op/.test(HTML), "no made-up business name in the placeholder");
  assert.ok(!/It's a gift|Who it's for/.test(visible), "curly apostrophes in the visible copy");
});

test("outside review, as Sig took it: example years, the framed choice first, the proof by the button, what Compare with means", () => {
  const stories = [...HTML.matchAll(/<a class="rp-story"[^>]*href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  // 2026-10-14 (the approved flow): the made-up family year went with the pre-filled example words
  assert.equal(stories.length, 2, "a drought and a flood");
  for (const h of stories) {
    const d = RP.fromParams(h.split("?")[1]);
    assert.ok(d.place && d.year >= 1890 && d.year <= 2025, "each draws a real finished year: " + h);
    assert.equal(d.station, "", "and the nearest good station picks itself: " + h);
    assert.equal(d.name, "", "no made-up words in a link: " + h);
  }
  assert.deepEqual(stories.map((h) => RP.fromParams(h.split("?")[1]).year), [2012, 1993]);
  assert.match(S2, /doc\.querySelectorAll\('\.rp-story'\)\.forEach/, "a tap draws it in place");
  // the shop-wall picture, under What you get, says it is a mockup, not a photo of a real print (2026-10-15)
  assert.match(HTML, /<figure class="rp-onwall"[^>]*>.*?<figcaption>Mockup of a framed print\.[^<]*<\/figcaption><\/figure>/);
  assert.ok(!/most popular/i.test(HTML), "no popularity claim without a count");
  // one picker, framed first and picked; the promise sits right under the one button
  const picks = [...HTML.matchAll(/name="rp-product" value="([a-z0-9]+)"( checked)?/g)].map((m) => m[1] + (m[2] ? "*" : ""));
  assert.deepEqual(picks, ["framed12x18*", "print12x18", "digital"]);
  assert.match(HTML, /id="rp-pay" type="button">Check it and pay \$89<\/button>\s*<p class="rp-promise" id="rp-promise">You see a proof first, and get a full refund any time before I print\.<\/p>\s*<p class="rp-note rp-madeby" id="rp-madeby">Made by Sig Lindquist in Chetek, Wisconsin\. Your proof comes from sig@farmers1st\.com, your receipt from Stripe\.<\/p>/);
  assert.match(S2, /'No proof for the file: it comes finished\. Want a change after\? Write to me and I\\u2019ll redo it\.'/, "the file has no proof step (2026-10-14)");
  assert.match(HTML, /<select id="rp-cmp" aria-describedby="rp-cmp-hint">/);
  assert.match(HTML, /id="rp-cmp-hint">Nothing: just your year\. NOAA normal: [^<]+Full record: /);
  assert.ok(HTML.indexOf('id="rp-biz"') > HTML.indexOf('id="rp-buy"'), "the business section stays below the personal flow");
  assert.equal((HTML.match(/name="rp-style"/g) || []).length, 2, "two styles only");
});

test("one name per thing, one sun note, the file's types, and the file's return policy in the structured data (2026-10-15)", () => {
  const titles = [...HTML.matchAll(/<span class="rp-prod-t">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(titles, ["Framed", "Print", "Digital file"]);
  const seg = [...HTML.matchAll(/name="rp-pproduct" value="[a-z0-9]+"><span>([A-Za-z ]+) <b/g)].map((m) => m[1]);
  assert.deepEqual(seg, ["Framed", "Print", "Digital file"], "the review sheet uses the same names");
  const box = [...HTML.matchAll(/<div><h3>([^<]+)<\/h3><ul>/g)].map((m) => m[1]);
  assert.deepEqual(box, ["Framed", "Print", "Digital file"]);
  assert.match(HTML, /<summary>What you get<\/summary>/);
  assert.equal((HTML.match(/direct sun/g) || []).length, 1, "the sun note once");
  assert.match(HTML, /id="rp-sub-digital">A PNG and a PDF by email within 1 business day of paying\.</);
  assert.match(HTML, /<li><b>For a print, I email you a proof\.<\/b>/);
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  assert.match(S, /var PICK_WORD = \{ framed12x18: 'Framed', print12x18: 'Print', digital: 'Digital file' \};/);
  assert.match(S, /\['Marked days', ST\.markers\.length/, "the sheet's row has step 2's name");
  assert.ok(!/internet connection/.test(S), "near you, not 'going by your internet connection'");
  assert.match(S, /\$\('rp-ships'\)\.hidden = PICK === 'digital';/);
  assert.match(S, /why\.hidden = late \|\| \(giftMode\(\) && canOrder\(\)\) \|\| PICK === 'digital';/);
  const ld = JSON.parse(HTML.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const offers = ld["@graph"].find((g) => g.offers).offers;
  const dig = offers.find((o) => o.sku === "rp-digital");
  assert.equal(dig.hasMerchantReturnPolicy.returnPolicyCategory, "https://schema.org/MerchantReturnNotPermitted");
  assert.equal(dig.hasMerchantReturnPolicy.applicableCountry, "US");
  // word for word what the visible FAQ says about the file
  const faq = HTML.match(/<details><summary>What if something[\s\S]*?<\/details>/)[0].replace(/&rsquo;/g, "\u2019");
  assert.ok(faq.includes("The digital file comes finished; if you want anything changed, write to me and I\u2019ll fix it or redo it by hand and send it again, no charge."), "the FAQ says it");
  assert.equal(dig.hasMerchantReturnPolicy.description, "The digital file comes finished; if you want anything changed, write to me and I\u2019ll fix it or redo it by hand and send it again, no charge.");
});
