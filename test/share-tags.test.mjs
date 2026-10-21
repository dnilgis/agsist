/* Share tags found missing in the Oct 21, 2026 share audit, now in place:
 *   - the noindex pages people still send as a link (Rain Print QR short link,
 *     gift card, Field Scout reports, sponsor sheets) show a card, and the
 *     ones whose link carries a code or a field keep it (no og:url: Facebook
 *     and LinkedIn follow og:url and would drop the query);
 *   - every storm-day page in the hail log, and the log itself, has an
 *     og:description (and the log an og:title and og:url), and the generator
 *     writes them.
 * Every image named exists in the repo and is 1200 x 630.
 *   node --test test/share-tags.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SITE = "https://agsist.com/";

const meta = (h, attr, name) => {
  const m = h.match(new RegExp(`<meta\\s+${attr}="${name.replace(/[:.]/g, "\\$&")}"\\s+content="([^"]*)"`));
  return m ? m[1] : null;
};

/** width and height of a JPEG or PNG on disk */
function imageSize(file) {
  const b = readFileSync(file);
  if (b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG") return [b.readUInt32BE(16), b.readUInt32BE(20)];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const mk = b[i + 1], len = b.readUInt16BE(i + 2);
    if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}

function imageOk(h, where) {
  const og = meta(h, "property", "og:image");
  assert.ok(og && og.startsWith(SITE), `${where}: og:image on agsist.com (${og})`);
  assert.equal(meta(h, "name", "twitter:image"), og, `${where}: twitter:image is og:image`);
  assert.equal(meta(h, "name", "twitter:card"), "summary_large_image", `${where}: large card`);
  assert.ok(meta(h, "property", "og:image:alt"), `${where}: alt`);
  const file = ROOT + og.slice(SITE.length).split("?")[0];
  assert.ok(existsSync(file), `${where}: ${file} exists`);
  assert.deepEqual(imageSize(file), [1200, 630], `${where}: ${file} is 1200x630`);
}

const SHARED = { R: false, r: false, "rp-gift": false, "comp-report": false, "field-report": false,
  "sponsor-kit": true, "prf-sponsor-kit": true }; // true: the link has no query, so og:url is fine

test("noindex pages people send as links show a card, and keep their query", () => {
  for (const [name, urlOk] of Object.entries(SHARED)) {
    const h = readFileSync(ROOT + name + ".html", "utf8");
    assert.ok(meta(h, "property", "og:title"), `${name}: og:title`);
    assert.ok(meta(h, "property", "og:description"), `${name}: og:description`);
    imageOk(h, name);
    if (!urlOk) assert.equal(meta(h, "property", "og:url"), null, `${name}: no og:url, the code in the link must survive`);
  }
  assert.ok(readFileSync(ROOT + "R.html").equals(readFileSync(ROOT + "r.html")), "R.html and r.html stay the same bytes");
});

test("the share builder keeps those pages pointed at their card", () => {
  const py = readFileSync(ROOT + "scripts/build_share_images.py", "utf8");
  for (const name of Object.keys(SHARED)) assert.match(py, new RegExp(`"${name}": "`), `BORROW lists ${name}`);
});

test("every hail log page has og title, description, url and an image that exists", () => {
  const dir = ROOT + "hail/";
  let n = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".html"))) {
    const h = readFileSync(dir + f, "utf8");
    if (/http-equiv="refresh"/i.test(h)) continue;
    n++;
    for (const t of ["og:title", "og:description", "og:url"]) assert.ok(meta(h, "property", t), `hail/${f}: ${t}`);
    imageOk(h, "hail/" + f);
  }
  assert.ok(n > 100, "storm days checked: " + n);
  const gen = readFileSync(ROOT + "scripts/generate_hail_events.py", "utf8");
  assert.equal((gen.match(/og:description/g) || []).length, 2, "the generator writes og:description on both page kinds");
  assert.match(gen, /og:title\\" content=\\"US Hail Storm Log/, "the log's og:title");
});
