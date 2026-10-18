// Sig's first photos of real Rain Prints (2026-10-18). Test prints, framed, no mat yet:
// every caption must say so, and the matted framed view stays a labeled mockup until mat photos come.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";

const RP = readFileSync(new URL("../rain-print.html", import.meta.url), "utf8");
const BIZ = readFileSync(new URL("../rain-print-business.html", import.meta.url), "utf8");
const root = new URL("../", import.meta.url);

function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

function photoTags(html) {
  return [...html.matchAll(/<figure class="(rp-photo|rp-real-fig|rbz-fig rbz-fig-sm)"[^>]*>([\s\S]*?)<\/figure>/g)].map((m) => m[2]);
}

test("each photo exists, is small, has no metadata, and its width/height match the file", () => {
  for (const fig of [...photoTags(RP), ...photoTags(BIZ)]) {
    const img = fig.match(/<img src="\/(img\/photos\/[a-z0-9-]+)-800\.jpg"[^>]*width="(\d+)" height="(\d+)"/);
    assert.ok(img, "a photo with width and height");
    const [, base, w, h] = img;
    for (const ext of ["800.jpg", "800.webp", "1600.jpg", "1600.webp"]) {
      const f = new URL(`${base}-${ext}`, root);
      assert.ok(existsSync(f), `${base}-${ext} exists`);
      assert.ok(statSync(f).size < 260_000, `${base}-${ext} under 260 KB`);
    }
    const buf = readFileSync(new URL(`${base}-1600.jpg`, root));
    const d = jpegSize(buf);
    assert.deepEqual([d.w, d.h], [Number(w), Number(h)], `${base} width/height match the 1600 file`);
    assert.ok(!buf.includes(Buffer.from("Exif")), `${base}: no EXIF (no GPS)`);
    assert.match(fig, /srcset="[^"]+800w, [^"]+\d+w"/, "srcset with both sizes");
    assert.match(fig, /alt="Photo of a framed Rain Print of Chetek, Wisconsin, (2025|1984)/, "alt says it is a photo, and of what");
  }
});

test("captions are true: test prints, shown without the white mat", () => {
  const caps = [...photoTags(RP), ...photoTags(BIZ)].map((f) => f.match(/<figcaption>([\s\S]*?)<\/figcaption>/)[1]);
  assert.ok(caps.length >= 4);
  for (const c of caps) assert.doesNotMatch(c, /with (a|its|the) white mat|matted/i, "no mat claimed under a photo with none");
  assert.match(RP, /<figure class="rp-photo" id="rp-photo">[\s\S]*?<figcaption>A Rain Print of Chetek, Wisconsin, 2025, framed in Chetek\. This test print is shown without its white mat\.<\/figcaption>/);
  assert.match(BIZ, /<figcaption>A Rain Print of Chetek, Wisconsin, 2025, framed in Chetek\. This test print is shown without its white mat\.<\/figcaption>/);
  const sec = RP.match(/<section class="rp-sec rp-real"[\s\S]*?<\/section>/)[0];
  assert.match(sec, /shown without the white mat that comes with a framed print/);
  assert.match(sec, /<b>Roots<\/b>, Chetek, Wisconsin, 2025\./);
  assert.match(sec, /<b>Staircase<\/b>, Chetek, Wisconsin, 1984\./);
  assert.match(sec, /No\. 0000, my number for test prints/, "the serial shown is the test-print number, said so");
  assert.ok(!/—|&mdash;/.test(sec), "no em dashes");
});

test("the framed-with-mat view stays a labeled mockup; the framed offer still names the mat", () => {
  const fig = RP.match(/<figure class="rp-onwall"[\s\S]*?<\/figure>/)[0];
  assert.match(fig, /<span class="rp-ex-tag" aria-hidden="true">Mockup<\/span>/);
  assert.match(RP, /<li>A 13 x 19 black frame with a white mat, ready to hang<\/li>/);
  assert.match(BIZ, /framed in a 13 x 19 black frame with a white mat/);
});

test("hero photo loads eagerly; the rest are lazy; Product image lists the real photo first", () => {
  assert.match(RP.match(/<figure class="rp-photo"[\s\S]*?<\/figure>/)[0], /loading="eager"/);
  for (const f of RP.match(/<section class="rp-sec rp-real"[\s\S]*?<\/section>/)[0].match(/<img [^>]+>/g)) assert.match(f, /loading="lazy"/);
  assert.match(BIZ.match(/<figure class="rbz-fig rbz-fig-sm">[\s\S]*?<\/figure>/)[0], /loading="lazy"/);
  const ld = JSON.parse(RP.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const prod = ld["@graph"].find((n) => n["@type"] === "Product");
  assert.equal(prod.image[0], "https://agsist.com/img/photos/rain-print-photo-chetek-2025-1600.jpg");
});
