/* Trust contradictions (credibility panel, read 2026-10-25). Each block is a
 * phrase a reader found on one page that another page, or the page itself,
 * contradicted. The rule each block holds to is named beside it; the phrases
 * must not come back anywhere a reader can see them (pages, the components
 * that write into them, the scripts that bake them). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const list = (dir, re) => readdirSync(join(ROOT, dir)).filter((f) => re.test(f)).map((f) => (dir === "." ? f : dir + "/" + f));
/* every top-level page, every component, every page-writing script (not the Daily archive:
   "live futures" there means live cattle futures) */
const SURFACE = [...list(".", /\.html$/), ...list("components", /\.js$/),
  ...list("scripts", /^(?!test_).*\.(py|mjs)$/)];

function hits(re, files = SURFACE) {
  const out = [];
  for (const f of files) {
    if (!existsSync(join(ROOT, f))) continue;
    const s = read(f);
    const m = s.match(re);
    if (m) out.push(f + ": " + m[0]);
  }
  return out;
}

/* 1. Market timing. /data-sources is the rule: Yahoo lists CBOT and CME at a 10-minute
   exchange delay, AGSIST fetches about every 15 minutes, so a grain or livestock price
   is about 10 to 25 minutes old while markets trade. Not "live", not "at least 15". */
test("no page calls the futures live or puts the delay at 15 minutes", () => {
  const ds = read("data-sources.html");
  assert.match(ds, /10-minute exchange delay/);
  assert.match(ds, /about 10 to 25 minutes old while markets trade/);
  const bad = /Live futures across|Prices are not live|delayed (?:a )?minimum of 15|at least 15 minutes old|15[- ]min(?:ute)? delayed|about 15 minutes delayed|delayed about 15 minutes|Delayed 15 min/i;
  assert.deepEqual(hits(bad), []);
  assert.match(read("about.html"), /about 10 to 25 minutes old while markets trade/);
  const terms = read("terms.html");
  assert.match(terms, /10-minute exchange delay/);
  assert.match(terms, /about 10 to 25 minutes old/);
  assert.match(terms, /time of its quote/);
});
