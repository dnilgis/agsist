/* In the frame (Sig, Nov 4): five crops of the frame maker's photos under What you get on /rain-print,
 * with the maker's logo and model photos removed. Each picture exists, is a small webp, carries its size,
 * loads lazily and has alt text; no brand name is on the page, in an alt or a caption.
 *
 *   node --test test/rp-frame-photos.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "rain-print.html", "utf8");
const NAMES = ["oak-back", "black-back", "layers-top", "tab", "hanger"];

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

test("the five frame pictures exist, are small, and the page gives each its size, lazy loading and alt text", () => {
  const block = HTML.match(/<div class="rp-inframe" id="rp-inframe"><h3>In the frame<\/h3><ul>([\s\S]*?)<\/ul><\/div>/);
  assert.ok(block, "the In the frame row is in What you get");
  const imgs = [...block[1].matchAll(/<img ([^>]*)>/g)].map((m) => m[1]);
  assert.equal(imgs.length, NAMES.length);
  NAMES.forEach((n, i) => {
    const a = imgs[i], f = "img/rain-print/frame/" + n + ".webp";
    assert.ok(existsSync(ROOT + f), f);
    assert.ok(a.includes('src="/' + f + '"'), n + " src");
    assert.ok(statSync(ROOT + f).size <= 25 * 1024, f + " is 25 KB or less");
    const [w, h] = webpSize(readFileSync(ROOT + f));
    assert.ok(Math.max(w, h) <= 640, f + " is 640 px or less on the long side");
    assert.ok(a.includes('width="' + w + '" height="' + h + '"'), n + " carries its real size");
    assert.match(a, /loading="lazy"/, n + " loads lazily");
    const alt = /alt="([^"]*)"/.exec(a);
    assert.ok(alt && alt[1].trim().length >= 10, n + " has alt text");
  });
  const caps = [...block[1].matchAll(/<figcaption>([^<]*)<\/figcaption>/g)].map((m) => m[1]);
  assert.deepEqual(caps, ["Oak, back: sturdy backboard and turn tabs", "Black, back", "Oak wood frame over 2 mm tempered glass",
    "Metal turn tabs, no tools", "Hangs wide or tall"]);
  assert.doesNotMatch(block[1], /—|https?:|<a /, "no em dash, no store link");
});

test("no brand name on the page, in an alt or a caption", () => {
  assert.doesNotMatch(HTML, /wisesun/i);
  assert.doesNotMatch(HTML, /\bWS\b/);
});

test("the tiles hold their height before the pictures load: 2 across on a phone, 5 on a wide screen", () => {
  assert.match(HTML, /\.rp-if-p\{height:120px;/);
  assert.match(HTML, /\.rp-box \.rp-inframe ul\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(HTML, /@media\(min-width:900px\)\{\.rp-box \.rp-inframe ul\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)\}\}/);
});
