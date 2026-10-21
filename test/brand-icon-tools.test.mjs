/* The icon tools (Oct 21, 2026): the drawing is the same every run, and the
 * prepared link-tag swap (scripts/dev/swap_icon_links.py, not run until Sig
 * picks) passes its selftest: HTML and generator-literal forms, idempotent,
 * inline icons left alone.
 *   node --test test/brand-icon-tools.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { drawIcon, packIco } from "../scripts/dev/make-brand-icons.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("the drawing is stable and uses the wordmark colours", () => {
  assert.equal(drawIcon(), drawIcon());
  for (const c of ["#16301F", "#F4EFE1", "#D4A23F", "#B5442E"]) assert.ok(drawIcon().includes(c), c);   // tile, roof, door and loft, barn
  assert.ok(!drawIcon({ dark: false }).includes("prefers-color-scheme"), "the PNG sources have no media query");
});

test("packIco writes a directory the sizes can be read back from", () => {
  const fake = (n) => Buffer.alloc(n, 1);
  const ico = packIco([[16, fake(10)], [32, fake(20)], [48, fake(30)]]);
  assert.equal(ico.readUInt16LE(4), 3);
  assert.deepEqual([0, 1, 2].map((i) => ico.readUInt8(6 + 16 * i)), [16, 32, 48]);
  assert.equal(ico.readUInt32LE(6 + 12), 6 + 48);
  assert.equal(ico.length, 6 + 48 + 60);
});

test("the link-tag swap script passes its selftest", () => {
  const out = execFileSync("python3", [ROOT + "scripts/dev/swap_icon_links.py", "--selftest"], { encoding: "utf8" });
  assert.match(out, /selftest ok/);
});
