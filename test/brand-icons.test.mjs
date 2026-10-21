/* The browser and home-screen icons (Oct 21, 2026 redraw, scripts/dev/make-brand-icons.mjs):
 * every file is there at the size its name and the manifest say, the SVG is
 * the drawing, the ICO holds 16/32/48, /favicon.ico is there for pages with no
 * icon link, the copies inlined in rain-print.html are the same pictures, and
 * the whole set stays small.
 *   node --test test/brand-icons.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drawIcon, PNGS, ICO_SIZES } from "../scripts/dev/make-brand-icons.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const png = (b) => {
  assert.equal(b.toString("ascii", 1, 4), "PNG", "a PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
function icoEntries(b) {
  assert.equal(b.readUInt16LE(2), 1, "an icon file");
  const out = [];
  for (let i = 0; i < b.readUInt16LE(4); i++) {
    const e = 6 + 16 * i, len = b.readUInt32LE(e + 8), off = b.readUInt32LE(e + 12);
    const [w, h] = png(b.subarray(off, off + len));
    assert.equal(b.readUInt8(e) || 256, w, "directory width matches the image");
    out.push([w, h]);
  }
  return out;
}

test("every PNG icon is there at its size", () => {
  for (const [f, px] of PNGS) {
    assert.ok(existsSync(ROOT + f), f);
    assert.deepEqual(png(readFileSync(ROOT + f)), [px, px], f);
  }
});

test("favicon.ico holds 16, 32 and 48, and /favicon.ico is the same file", () => {
  const ico = readFileSync(ROOT + "img/favicon.ico");
  assert.deepEqual(icoEntries(ico), ICO_SIZES.map((s) => [s, s]));
  assert.ok(readFileSync(ROOT + "favicon.ico").equals(ico), "root /favicon.ico for pages with no icon link");
});

test("img/icon.svg is the drawing, with a dark-strip tile", () => {
  const svg = readFileSync(ROOT + "img/icon.svg", "utf8");
  assert.equal(svg, drawIcon(), "rerun node scripts/dev/make-brand-icons.mjs");
  assert.match(svg, /prefers-color-scheme:dark/);
  assert.match(svg, /viewBox="0 0 32 32"/);
});

test("the manifest lists files that exist at the sizes it says, with SVG and maskable icons", () => {
  const m = JSON.parse(readFileSync(ROOT + "manifest.json", "utf8"));
  for (const ic of m.icons) {
    const f = ROOT + ic.src.slice(1);
    assert.ok(existsSync(f), ic.src);
    if (ic.type === "image/png") {
      const [w, h] = png(readFileSync(f));
      assert.equal(ic.sizes, `${w}x${h}`, ic.src);
    }
  }
  assert.ok(m.icons.some((i) => i.type === "image/svg+xml" && i.sizes === "any"), "svg icon");
  for (const s of ["192x192", "512x512"]) {
    assert.ok(m.icons.some((i) => i.purpose === "maskable" && i.sizes === s), "maskable " + s);
    assert.ok(m.icons.some((i) => i.purpose === "any" && i.sizes === s), "any " + s);
  }
});

test("rain-print.html carries the same 16 and 32 px pictures inline", () => {
  const h = readFileSync(ROOT + "rain-print.html", "utf8");
  for (const s of [16, 32]) {
    const m = h.match(new RegExp(`<link rel="icon" type="image/png" sizes="${s}x${s}" href="data:image/png;base64,([A-Za-z0-9+/=]+)"`));
    assert.ok(m, "inline " + s);
    assert.ok(Buffer.from(m[1], "base64").equals(readFileSync(ROOT + `img/favicon-${s}.png`)), `inline ${s} px is img/favicon-${s}.png`);
  }
});

test("the icon set stays small (the old 512 alone was 400 KB)", () => {
  const files = [...PNGS.map((p) => p[0]), "img/favicon.ico", "img/icon.svg"];
  const kb = files.reduce((t, f) => t + statSync(ROOT + f).size, 0) / 1024;
  assert.ok(kb < 60, `icons total ${kb.toFixed(1)} KB`);
});
