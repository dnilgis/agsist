/* In the frame (Nov 4): the owner's own three crops of the frame maker's pictures under What you get on
 * /rain-print, used as he cropped them (resized only). Each picture exists, is a small webp, carries its
 * size, loads lazily and has its alt text; the page's own text names no brand.
 *
 *   node --test test/rp-frame-photos.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "rain-print.html", "utf8");
const PICS = [
  ["layers", "What&rsquo;s in the frame: oak wood frame, 2 mm tempered glass, acid-free mat, your print, backboard"],
  ["hardware", "Back of the frame: metal turn tabs, hangers for wide or tall, backboard"],
  ["glass", "2 mm tempered glass"],
];

// the webp header: RIFF....WEBP, and the canvas size from a VP8, VP8L or VP8X chunk
function webpSize(buf) {
  assert.equal(buf.toString("ascii", 0, 4), "RIFF");
  assert.equal(buf.toString("ascii", 8, 12), "WEBP");
  const kind = buf.toString("ascii", 12, 16);
  if (kind === "VP8 ") return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  if (kind === "VP8L") { const b = buf.readUInt32LE(21); return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1]; }
  if (kind === "VP8X") return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  throw new Error("unknown webp chunk " + kind);
}

test("the three frame pictures exist, are small, and the page gives each its size, lazy loading and alt text", () => {
  const block = HTML.match(/<div class="rp-inframe" id="rp-inframe"><h3>In the frame<\/h3><ul>([\s\S]*?)<\/ul><\/div>/);
  assert.ok(block, "the In the frame row is in What you get");
  const imgs = [...block[1].matchAll(/<img ([^>]*)>/g)].map((m) => m[1]);
  assert.equal(imgs.length, PICS.length);
  PICS.forEach(([n, alt], i) => {
    const a = imgs[i], f = "img/rain-print/frame/" + n + ".webp";
    assert.ok(existsSync(ROOT + f), f);
    assert.ok(a.includes('src="/' + f + '"'), n + " src");
    assert.ok(statSync(ROOT + f).size <= 60 * 1024, f + " is 60 KB or less");
    const [w, h] = webpSize(readFileSync(ROOT + f));
    assert.ok(Math.max(w, h) <= 900, f + " is 900 px or less on the long side");
    assert.ok(a.includes('width="' + w + '" height="' + h + '"'), n + " carries its real size");
    assert.match(a, /loading="lazy"/, n + " loads lazily");
    assert.ok(a.includes('alt="' + alt + '"'), n + " has its alt text");
  });
  assert.doesNotMatch(block[1], /—|https?:|<a /, "no em dash, no store link");
});

test("the page's own text names no brand", () => {
  assert.doesNotMatch(HTML, /wisesun/i);
});

test("the pictures hold their box before they load: stacked in a narrow box, a row of three when it is wide", () => {
  assert.match(HTML, /\.rp-inframe img\{display:block;width:100%;height:auto;/);
  assert.match(HTML, /\.rp-inframe\{[^}]*container:inframe\/inline-size\}/);
  assert.match(HTML, /\.rp-box \.rp-inframe ul\{[^}]*grid-template-columns:minmax\(0,1fr\);/);
  assert.match(HTML, /@container inframe \(min-width:520px\)\{\.rp-box \.rp-inframe ul\{grid-template-columns:minmax\(0,3\.2fr\) minmax\(0,1fr\) minmax\(0,3\.2fr\);/);
});
