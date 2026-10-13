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
  assert.match(RP.linkProblem("?place=Chetek&year=abc"), /year \(abc\)/);
  assert.match(RP.linkProblem("?year=2020"), /no town/);
  assert.equal(RP.linkProblem("?d=" + RP.encodeCode({ place: "Chetek, WI", year: 2025 })), "");
  assert.equal(RP.linkProblem(""), "", "no design in the link is not a problem");
});

test("stations in plain words: no raw ACIS id pair, names out of caps", () => {
  assert.equal(RP.sidPlain("471667 2"), "NOAA co-op station 471667");
  assert.equal(RP.sidPlain("14991 3"), "NOAA station 14991");
  assert.equal(RP.stationName("CHETEK"), "Chetek");
  assert.equal(RP.stationName("CAMERON 2 NE"), "Cameron, 2 mi NE");
  assert.equal(RP.stationName("RICE LAKE MUNI AP"), "Rice Lake Municipal Airport");
  assert.equal(RP.milesText(0.43), "0.4 mi");
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
  assert.match(RP.dateProblems(2025, ["2025-05-01", "2025-05-01"])[0].msg, /same day/);
  for (const w of ["Planted", "Harvest done", "Turnout", "Calving", "Weaning", "First cutting"]) assert.ok(RP.LABEL_PRESETS.includes(w), w);
  for (const w of RP.LABEL_PRESETS) assert.ok(w.length <= RP.LIMITS.label, w + " fits the label box");
  const html = readFileSync(ROOT + "rain-print.html", "utf8");
  for (const id of ["rp-name-n", "rp-ded-n", "rp-date-msg", "rp-sym-note"]) assert.ok(html.includes(`id="${id}"`), id + " is on the page");
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
test("the print names the gauge and distance, and explains gaps only when there are some, both styles", () => {
  const gauge = "Rain gauge: Chetek, WI weather station, 0.4 mi from Chetek";
  for (const style of ["r1", "r2"]) {
    const full = texts(ART.render(input(year(2025), { style, gauge })));
    const line = full.find((x) => x.t.startsWith("Rain gauge:"));
    assert.ok(line && line.size >= 12, style + ": gauge line at production size");
    assert.ok(!/no report/.test(line.t), style + ": no gap note on a full year");
    const gappy = texts(ART.render(input(year(2025, (i) => (i === 40 ? { p: "M" } : {})), { style, gauge })));
    assert.ok(gappy.some((x) => /day the station sent no report/.test(x.t)), style + ": a gap is explained");
    assert.ok(!gappy.some((x) => /\d+ days? (not reported|with no report)/i.test(x.t)), style + ": with no count (Sig)");
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
  assert.equal(J.ship_business_days, 7, "the cutoffs use the same 7 business days the page promises");
  assert.match(J.ships_within, /7 business days/);
  assert.equal(RP.addBizDays("2026-12-04", 1, []), "2026-12-07", "a Friday plus one business day is Monday");
  assert.equal(RP.christmasCutoff({ ...J, ship_business_days: null }, "print12x18", 2026), null, "a missing number gives no date, not a guess");
});

test("shipping included is said plainly; no archival claim; care line; draft policy marked for the owner", () => {
  assert.match(HTML, /\$45, or \$89 framed, shipping included/, "lede");
  assert.equal((HTML.match(/<li>Shipping included, US addresses<\/li>/g) || []).length, 2, "both print cards");
  assert.ok(!/archival/i.test(HTML + readFileSync(ROOT + "components/rain-print.js", "utf8")), "never called archival");
  assert.equal((HTML.match(/Keep it out of direct sun/g) || []).length, 2);
  assert.match(HTML, /<!-- DRAFT-POLICY:[^>]*-->\s*<details><summary>What if something/, "the reprint and refund promise is marked as a draft");
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
  assert.equal(prod.image, "https://agsist.com/img/og/rain-print.jpg");
  assert.deepEqual(prod.offers.map((o) => o.price), [String(J.digital), String(J.print12x18), String(J.framed12x18)]);
  assert.ok(!prod.aggregateRating && !prod.review, "no made-up ratings");
  for (const k of ['property="og:image"', 'name="twitter:image"']) assert.match(HTML, new RegExp(k + "\\s+content=\"https://agsist.com/img/og/rain-print.jpg\""));
  const img = readFileSync(ROOT + "img/og/rain-print.jpg");
  assert.ok(img.length < 150000, "share image is small: " + img.length);
  assert.equal(img[0], 0xff); assert.equal(img[1], 0xd8);
  // a JPEG's size: find the SOF0/SOF2 marker
  let i = 2, w = 0, h = 0;
  while (i < img.length) { const m = img[i + 1], len = img.readUInt16BE(i + 2); if (m === 0xc0 || m === 0xc2) { h = img.readUInt16BE(i + 5); w = img.readUInt16BE(i + 7); break; } i += 2 + len; }
  assert.deepEqual([w, h], [1200, 630]);
});

test("Rain Print stays out of the menus and footer until launch (it is already in sitemap.xml from 2026-10-12)", () => {
  assert.equal(J.promote, false);
  for (const f of ["components/header.html", "components/footer.html", "components/header-fallback.html", "components/footer-fallback.html"]) {
    let t = ""; try { t = readFileSync(ROOT + f, "utf8"); } catch (e) { continue; }
    assert.ok(!/rain-print/.test(t), f + " has no Rain Print link yet");
  }
});
