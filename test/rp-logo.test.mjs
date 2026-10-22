/* Rain Print logos (2026-10-14): the shipped components/rp-logo.js (file
 * types, trim, the one-color ink version, the print-quality check), the logo
 * in the design code and query string (components/rain-print.js), where the
 * art puts it in both styles (components/rain-print-art.js), and the page
 * wiring. The worker routes are checked in scripts/test_form_worker.mjs.
 *
 *   node --test test/rp-logo.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob, Map, Promise, Uint8Array, Uint8ClampedArray };
ctx.window = ctx;
for (const f of ["components/qr.js", "components/rp-logo.js", "components/rain-print-art.js", "components/rain-print.js"]) vm.runInNewContext(read(f), ctx);
const L = ctx.AgRpLogo, RP = ctx.RainPrint, ART = ctx.AgRainArt;
const plain = (x) => JSON.parse(JSON.stringify(x));
const bytes = (s) => Uint8Array.from(Buffer.from(s, "binary"));

// ---------- file types ----------
test("file types come from the first bytes: PNG, JPG, WebP and SVG; nothing else", () => {
  assert.equal(L.kindOf(bytes("\x89PNG\r\n\x1a\n....")), "png");
  assert.equal(L.kindOf(bytes("\xff\xd8\xff\xe0..JFIF")), "jpeg");
  assert.equal(L.kindOf(bytes("RIFF\x10\x00\x00\x00WEBPVP8 ")), "webp");
  assert.equal(L.kindOf(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), "svg");
  assert.equal(L.kindOf(bytes('\xEF\xBB\xBF<?xml version="1.0"?>\n<!-- made by hand -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg viewBox="0 0 1 1"/>')), "svg");
  for (const [b, why] of [["GIF89a\x01\x00", "GIF"], ["%PDF-1.4", "PDF"], ["<html><svg></svg></html>", "HTML around an SVG"], ["", "empty"],
    ["\x00\x00\x00\x18ftypheic", "HEIC"], ["RIFF\x10\x00\x00\x00WAVE", "a WAV"], ["<svgx>", "not an svg tag"]]) assert.equal(L.kindOf(bytes(b)), "", why);
  assert.equal(L.MAX_FILE, 10 * 1024 * 1024);
  assert.equal(L.MAX_SIDE, 1600);
  const page = read("rain-print.html");
  assert.match(page, /id="rp-logo-file" type="file" accept="image\/png,image\/jpeg,image\/webp,image\/svg\+xml,\.png,\.jpg,\.jpeg,\.webp,\.svg"/);
});

test("an SVG is never stored or put in the page: it opens only as an image and goes up as PNG pixels", () => {
  const S = read("components/rp-logo.js");
  // the only way an SVG is opened: an <img> from a blob URL
  assert.match(S, /new Blob\(\[file\], \{ type: 'image\/svg\+xml' \}\)/);
  assert.doesNotMatch(S, /innerHTML|DOMParser|insertAdjacentHTML|createElementNS|\.text\(\)/);
  // the upload sends a PNG made by a canvas, nothing else
  assert.match(S, /c\.toBlob\(function \(b\) \{[^}]*\}, 'image\/png'\)/);
  assert.match(S, /headers: \{ 'Content-Type': 'image\/png' \}/);
  // the art draws a PNG data URL only, never an address or markup
  const base = { href: "data:image/png;base64,iVBORw0KGgo=", w: 400, h: 200 };
  assert.ok(ART.render(input({ logo: base })).includes('<image href="data:image/png;base64,iVBORw0KGgo="'));
  for (const href of ["data:image/svg+xml;base64,PHN2Zz4=", "https://example.com/x.png", 'data:image/png;base64,AA" onload="x', "javascript:alert(1)"])
    assert.ok(!/data-rp="logo"/.test(ART.render(input({ logo: { ...base, href } }))), href);
});

// ---------- processing ----------
function px(w, h, f) { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4); return { data: d, width: w, height: h }; }
test("trim: transparent and white margins go; a colored background stays", () => {
  const inBox = (x, y) => x >= 10 && x < 30 && y >= 5 && y < 15;
  assert.deepEqual(plain(L.trimBox(px(40, 20, (x, y) => inBox(x, y) ? [200, 30, 30, 255] : [0, 0, 0, 0]))), { x: 10, y: 5, w: 20, h: 10 });
  assert.deepEqual(plain(L.trimBox(px(40, 20, (x, y) => inBox(x, y) ? [20, 20, 20, 255] : [254, 253, 255, 255]))), { x: 10, y: 5, w: 20, h: 10 }, "a JPG's near-white");
  assert.deepEqual(plain(L.trimBox(px(40, 20, (x, y) => inBox(x, y) ? [255, 255, 255, 255] : [30, 80, 160, 255]))), { x: 0, y: 0, w: 40, h: 20 }, "a logo on a full-bleed color keeps it");
  assert.equal(L.trimBox(px(10, 10, () => [255, 255, 255, 255])), null, "blank white");
  assert.equal(L.trimBox(px(10, 10, () => [0, 0, 0, 0])), null, "blank clear");
});

test("ink: one color, white background of a JPG becomes transparent, dark and colored parts print solid", () => {
  const INK = ART.INK;
  assert.equal(INK, "#1E2125");
  // a JPG: white paper, a black letter, a red barn, a white window in the barn
  const jpg = px(4, 1, (x) => [[255, 255, 255, 255], [0, 0, 0, 255], [178, 58, 43, 255], [255, 255, 255, 255]][x]);
  const o = L.inkPixels(jpg, INK);
  for (let i = 0; i < 4; i++) assert.deepEqual([o[i * 4], o[i * 4 + 1], o[i * 4 + 2]], [0x1e, 0x21, 0x25], "every pixel is the ink");
  assert.equal(o[3], 0, "white background: transparent");
  assert.equal(o[7], 255, "black: solid");
  assert.equal(o[11], 255, "red barn: solid ink, not gray");
  assert.equal(o[15], 0, "white window: paper");
  // a transparent PNG keeps its shape from its alpha; near-white inside it drops out
  const png = px(4, 1, (x) => [[0, 0, 0, 0], [240, 200, 40, 255], [250, 250, 250, 255], [40, 120, 60, 128]][x]);
  const p = L.inkPixels(png, INK);
  assert.deepEqual([p[3], p[7], p[11], p[15]], [0, 255, 0, 128]);
});

test("quality: under about 200 pixels an inch at the printed size, the page says it may print soft", () => {
  const sz = ART.logoSize("r1", 2);
  assert.ok(sz.h >= 90 && sz.h <= 120, "about an inch tall: " + sz.h);
  assert.ok(L.ppi(208, 104, sz.w, sz.h) < 200, "a 104 px tall logo at 1.04 in is under 200 ppi");
  assert.ok(L.ppi(1600, 800, sz.w, sz.h) > 700);
  const E = read("components/rain-print.js");
  assert.match(E, /This logo is small and may print soft\. If you have a bigger file, use that; I\\u2019ll also check it in your proof\./);
  assert.match(E, /var LOGO = null, LOGO_ASK = 0, LOGO_PPI = 200;/);
});

// ---------- the design ----------
const FULL = { place: "Chetek, WI", station: "471667 2", year: 2025, cmp: "normal", name: "The Olson Farm", style: "r2", normals: true, records: true,
  markers: [{ date: "2025-05-12", label: "Planted" }], dedication: "For Dad" };
test("the logo and its color round-trip through the design code, the query string and the short-link rules", () => {
  for (const logo of ["", "k3j9m2p7q8rs"]) for (const logoInk of [true, false]) for (const dedication of ["", "For Dad"]) {
    const s = { ...FULL, logo, logoInk, dedication };
    assert.deepEqual(plain(RP.decodeCode(RP.encodeCode(s))), plain(RP.normalize(s)));
    assert.deepEqual(plain(RP.fromParams("?" + RP.toParams(s))), plain(RP.normalize(s)));
  }
  const q = RP.toParams({ ...FULL, logo: "k3j9m2p7q8rs", logoInk: false });
  assert.match(q, /logo=k3j9m2p7q8rs&logoInk=0/);
  assert.equal(RP.encodeCode(FULL), RP.encodeCode({ ...FULL, logo: "nope" }), "a bad id is dropped; the code is the old code");
  assert.equal(RP.normalize({ logo: "K3J9M2P7Q8RS" }).logo, "k3j9m2p7q8rs", "any case");
  assert.equal(RP.normalize({ logo: "k3j9m2p7q8ru" }).logo, "", "no u");
  const raw = Buffer.from(RP.encodeCode({ ...FULL, logo: "k3j9m2p7q8rs" }), "base64url").toString();
  assert.equal(raw.split("|")[4], "spnah" + "i" + "k3j9m2p7q8rs");
  // damaged logo keys are not a design
  for (const k of ["spnaexk3j9m2p7q8rs", "spnaeik3j9m2p7q8ru", "spnaeik3j9m2p7q8r"])
    assert.equal(RP.decodeCode(Buffer.from("2|Chetek, WI|1|2025|" + k + "|").toString("base64url")), null, k);
  // the worker takes the same key field (rp-short, the gift card lock)
  const W = read("workers/subs-worker.js");
  // (v5.27, 2026-10-17: then the units letter and the options after a ~)
  assert.match(W, /\/\^\[a-z0-9\]\{5\}\(\?:\[ic\]\[0-9a-hjkmnp-tv-z\]\{12\}\)\?\[A-H\]\?\(\?:~/);
  // a typical design with a logo still goes to Stripe as the code itself
  assert.ok(RP.encodeCode({ ...FULL, logo: "k3j9m2p7q8rs" }).length <= 200);
});

// ---------- the art ----------
const DAY = 86400000;
function year(y) {
  const n = 365, days = [];
  for (let i = 0; i < n; i++) {
    const dt = new Date(Date.UTC(y, 0, 1) + i * DAY), pp = RP.parsePcpn(i % 9 === 0 ? (0.1 + (i % 7) * 0.12).toFixed(2) : "0.00");
    days.push({ date: dt.toISOString().slice(0, 10), v: pp.v, flag: pp.flag, t: null, s: i < 40 && i % 11 === 0 ? 3 : 0, m: dt.getUTCMonth(), d: dt.getUTCDate(), doy: i });
  }
  return days;
}
const DAYS = year(2025);
function input(extra = {}) {
  const D = RP.derive(DAYS);
  return Object.assign({ style: "r1", year: 2025, place: "Chetek, Wisconsin", name: "The Olson Farm", dedication: "", days: DAYS, D, showDry: RP.showDry(D),
    axisLen: DAYS.length, ov: null, ovNote: "", showNormals: false, markers: [{ doy: 140, label: "Planted" }, { doy: 290, label: "Harvest done" }], records: [],
    qr: { matrix: ctx.AgQR.matrix("HTTPS://AGSIST.COM/R?K7Q2M"), serial: "" } }, extra);
}
// every word's ink box, from the art's own width table
function textBoxes(svg) {
  return [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" font-family="([^"]+)" font-weight="(\d+)" font-style="(\w+)" font-size="([\d.]+)"[^>]*text-anchor="(\w+)"(?: letter-spacing="([\d.]+)")?[^>]*>([^<]*)<\/text>/g)].map((m) => {
    const t = m[9].replace(/&amp;/g, "&").replace(/&quot;/g, '"'), size = +m[6];
    const w = ART.roughW(t, { fam: m[3], w: +m[4], it: m[5] === "italic", size }) + (m[8] ? +m[8] * Math.max(0, t.length - 1) : 0);
    const x = m[7] === "start" ? +m[1] : m[7] === "end" ? +m[1] - w : +m[1] - w / 2;
    return { t, x, y: +m[2] - 0.8 * size, w, h: 1.05 * size };
  });
}
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const LOGO = (w, h) => ({ href: "data:image/png;base64,iVBORw0KGgo=", w, h });

test("the logo sits beside the name block in both styles, about an inch, clear of every word, the QR and the chart", () => {
  const names = ["Olson Farm", "Kowalczyk Brothers Farms", ""];
  const deds = ["", "For Dad, his 40th crop on the home place. Love, Kate and the boys"];
  for (const style of ["r1", "r2"]) for (const name of names) for (const dedication of deds) for (const [w, h] of [[600, 400], [1000, 200], [300, 900], [1600, 160]]) {
    const svg = ART.render(input({ style, name, dedication, logo: LOGO(w, h) })), lg = ART.lastLogo(), tag = `${style} ${JSON.stringify(name)} ded:${!!dedication} ${w}x${h}`;
    assert.ok(lg, tag);
    assert.equal(svg.match(/data-rp="logo"/g).length, 1, tag);
    // size: the block's height when the shape allows, never over 2.6 in wide; inside the 0.6 in margin
    assert.ok(lg.h <= 104 && lg.w <= 260 && (lg.h >= 90 || lg.w >= 239), tag + " size " + JSON.stringify(lg));
    assert.ok(Math.abs(lg.w / lg.h - w / h) < 0.02, tag + " keeps its shape");
    assert.ok(lg.x >= 60 && lg.y >= 60 && lg.x + lg.w <= 1740 && lg.y + lg.h <= 1140, tag + " inside the safe margin");
    // place: R1 at the foot on the chart's one left edge (A2 clean, 2026-10-17), R2 at the top at the left margin
    assert.equal(lg.x, style === "r1" ? 196 : 120, tag);
    assert.ok(style === "r1" ? lg.y > 790 : lg.y < 200, tag + " y " + lg.y);
    for (const b of textBoxes(svg)) assert.ok(!hit(lg, b), tag + " overlaps words: " + b.t);
    const q = /<g data-rp="qr"><g aria-hidden="true"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(svg);
    assert.ok(!hit(lg, { x: +q[1], y: +q[2], w: +q[3], h: +q[4] }), tag + " QR");
    // the chart: R1 from its top line to the month row, R2 from the snow scale to the deepest rain
    const chart = style === "r1" ? { x: 196, y: 104, w: 1394, h: 675 } : { x: 205, y: 380, w: 1485, h: 620 };
    assert.ok(!hit(lg, chart), tag + " chart");
    // text sizes and the name's own fit still hold
    for (const m of svg.matchAll(/font-size="([\d.]+)"/g)) assert.ok(+m[1] >= 11, tag + " text " + m[1]);
  }
});

test("no logo, no change: the art is the same as before the feature", () => {
  for (const style of ["r1", "r2"]) {
    const a = ART.render(input({ style })), b = ART.render(input({ style, logo: null }));
    assert.equal(a, b);
    assert.ok(!/data-rp="logo"/.test(a) && ART.lastLogo() === null);
  }
});

test("exports carry the logo at full resolution: the same data URL, inside the print file's SVG with bleed and size", () => {
  const big = "data:image/png;base64," + "A".repeat(200000) + "==";
  const svg = ART.render(input({ logo: { href: big, w: 1600, h: 1000 }, bleed: 12.5, px: [5475, 3675] }));
  assert.ok(svg.includes('<image href="' + big + '"'), "the whole picture, not a copy");
  const E = read("components/rain-print.js");
  const exp = E.slice(E.indexOf("function exportFile"), E.indexOf("// ---------- wire up"));
  assert.match(exp, /return logoGate\(\);/, "a file waits for the logo");
  assert.match(exp, /NO_LOGO \? 'The logo didn\\u2019t load, so no file was saved/);
  assert.match(E, /gauge: META \? gaugeLine\(META\) : '', logo: logoArt\(\),/, "buildSvg (every export and the page) draws it");
});

// ---------- the page ----------
test("the page: the upload under the name, its help line, the color switch, the proof row, orders, quote form", () => {
  const H = read("rain-print.html"), E = read("components/rain-print.js");
  // 2026-10-22 (the layout rebuild): the logo is in Your words, open, after the name, the line and the days; the preview,
  // the link and the numbers fold under it
  assert.ok(H.indexOf('id="rp-ded"') < H.indexOf('class="rp-dates"') && H.indexOf('class="rp-dates"') < H.indexOf('id="rp-logo"') && H.indexOf('id="rp-logo"') < H.indexOf('id="rp-more"'), "in Your words, after the name, the line and the days");
  assert.ok(H.indexOf('id="rp-design"') < H.indexOf('id="rp-logo"') && H.indexOf('id="rp-logo"') < H.indexOf('id="rp-buy"'));
  assert.match(H, /<summary>Preview, link and the year in numbers<\/summary>/);
  assert.match(H, />Add a logo \(optional\)</);
  assert.match(H, /Your farm or business logo\. It prints small, next to the name\. A big, clear file prints best\./);
  assert.match(H, /value="1" checked><span>Ink color<\/span>/);
  assert.match(H, /<span>Keep its colors<\/span>/);
  assert.match(H, /id="rp-logo-remove" hidden>Remove</);
  assert.match(H, />Logo for the prints \(optional\)</);   // no separate note card (Sig, 2026-10-17)
  const i = (s) => H.indexOf(s);
  // 2026-10-17 (speed panel): the engine loads rp-logo.js when a logo is first wanted (a ?logo= link or the file picker)
  assert.ok(i("/components/rp-logo.js?v=") < 0, "not loaded up front on /rain-print");
  assert.match(E, /sc\.src = '\/components\/rp-logo\.js\?v=3';/, "the engine loads it on demand");
  assert.match(E, /if \(!root\.AgRpLogo\) \{\n\s+LOGO = \{ id: id, state: 'loading'[\s\S]{0,200}logoReady\(\)\.then/, "a design with a logo waits for it");
  assert.match(E, /logoReady\(\)\.then\(function \(ok\) \{ if \(ok\) pickLogo\(f\[0\]\)/, "a picked file waits for it");
  assert.match(read("rp-gift.html"), /\/components\/rp-logo\.js\?v=3/);
  assert.match(E, /list\.push\(\['Logo', esc\(rows\['Logo'\]\) \+ \(la \? '<img class="rp-plogo"/);
  assert.match(E, /return 'added, ' \+ \(ST\.logoInk/);
  assert.match(E, /if \(ST\.logo\) x\.logo = ST\.logo;/);
  assert.match(E, /if \(BIZ_LOGO && BIZ_LOGO\.id\) x\.logo = BIZ_LOGO\.id;/);
  assert.match(E, /logo: \['rp-logo-file', 'rp-logo-remove', 'rp-logo-ink'\]/, "a locked gift card holds its logo still");
  assert.match(E, /logo: res\[2\] \|\| null,/, "the gift card's preview draws it");
  // the worker being down is said plainly, and the page goes on without the logo
  assert.match(read("components/rp-logo.js"), /The logo couldn(\u2019|\\u2019)t be saved just now, so it(\u2019|\\u2019)s not on the print\./);
  // no em dashes in the new words
  for (const f of ["components/rp-logo.js"]) assert.doesNotMatch(read(f), /—/);
});

test("F1: an upload that never answers gives up (60 s), so the logo can't stay 'saving' and keep ordering shut", async () => {
  assert.equal(L.UPLOAD_MS, 60000);
  const c = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob, Map, Promise, Uint8Array, Uint8ClampedArray, setTimeout, clearTimeout, AbortController };
  c.window = c;
  let sawSignal = false;
  c.fetch = (u, o) => new Promise((res, rej) => { if (o && o.signal) { sawSignal = true; o.signal.addEventListener("abort", () => rej(new Error("aborted"))); } });
  vm.runInNewContext(read("components/rp-logo.js"), c);
  c.AgRpLogo.UPLOAD_MS = 40;
  const t0 = Date.now();
  await assert.rejects(c.AgRpLogo.upload(new Uint8Array(4)), (e) => e.plain && /couldn’t be saved just now/.test(e.message));
  assert.ok(sawSignal && Date.now() - t0 < 2000);
  // the worker's cap for everyone is not "from here"
  c.fetch = () => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({ ok: false, error: "busy today" }) });
  await assert.rejects(c.AgRpLogo.upload(new Uint8Array(4)), (e) => /Lots of people are using this today/.test(e.message));
});
