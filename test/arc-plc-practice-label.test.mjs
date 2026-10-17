/* ARC/PLC county titles and descriptions name the practice when FSA splits it.
 *
 * Oct 17, 2026 (audit N10): /arc-plc/nebraska/platte-county said "Corn Benchmark
 * 187.4 bu" in its title and description. That is the non-irrigated benchmark;
 * FSA's irrigated one there is 239.0 bu. 731 of 2,583 corn counties have the split.
 *
 * Rule (scripts/build_arc_plc.py practice_split): when a crop has both an
 * irrigated and a non-irrigated benchmark, a title or description that prints
 * one of them names its practice, and a description that prints a number also
 * prints the other practice's number.
 *
 *   node --test test/arc-plc-practice-label.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const DIRS = readdirSync(ROOT + "arc-plc", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const slugOf = {};
for (const d of DIRS) for (const f of readdirSync(ROOT + "arc-plc/" + d)) if (f.endsWith(".html")) slugOf[d + "/" + f] = true;

const meta = (h) => ({
  title: (h.match(/<title>([^<]*)<\/title>/) || [])[1] || "",
  desc: (h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "",
});
// the build rounds half up (37.55 -> 37.6); toFixed sees 37.5499... Accept either.
const f1s = (v) => [...new Set([v.toFixed(1), (Math.round(v * 10 + 1e-6) / 10).toFixed(1)])];
const f1 = (v) => f1s(v)[f1s(v).length - 1];

test("hand-checked: Platte County, NE names non-irrigated and shows the irrigated 239.0 bu too", () => {
  const { title, desc } = meta(read("arc-plc/nebraska/platte-county.html"));
  assert.match(title + " " + desc, /non-irrigated corn/i);
  assert.ok(desc.includes("187.4 bu") && desc.includes("239.0 bu irrigated"), desc);
});

test("every county page that prints a split crop's benchmark names the practice", () => {
  const files = readdirSync(ROOT + "data/arc-plc").filter((f) => /^[A-Z]{2}\.json$/.test(f));
  let checked = 0;
  const bad = [];
  for (const f of files) {
    const S = JSON.parse(read("data/arc-plc/" + f));
    const dir = String(S.n || "").toLowerCase().replace(/[^a-z]+/g, "-");
    if (!DIRS.includes(dir)) continue;
    for (const c of S.c) {
      const p = `arc-plc/${dir}/${c.s}.html`;
      if (!slugOf[`${dir}/${c.s}.html`]) continue;
      const { title, desc } = meta(read(p));
      for (const es of Object.values(c.k || {})) {
        // a crop can carry several entries per practice (wheat classes): any of them counts
        const irr = es.filter((e) => e.d === "irr" && e.by), non = es.filter((e) => e.d === "non" && e.by);
        if (!irr.length || !non.length) continue;
        for (const [mine, other] of [[non, irr], [irr, non]]) {
          for (const e of mine) {
            const n = f1(e.by) + " bu";
            if (!title.includes(n) && !desc.includes(n)) continue;
            checked++;
            const word = e.d === "irr" ? /\birrigated\b/i : /non-irrigated/i;
            if (!word.test(title + " " + desc) || (desc.includes(n) && !other.some((o) => f1s(o.by).some((t) => desc.includes(t + " bu"))))) bad.push(`${p}: ${title} | ${desc}`);
          }
        }
      }
    }
  }
  assert.ok(checked > 100, `only ${checked} split-crop titles or descriptions found`);
  assert.deepEqual(bad.slice(0, 5), []);
});
