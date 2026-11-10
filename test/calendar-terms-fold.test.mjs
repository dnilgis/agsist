/* Curtain round 2 (Nov 9): the USDA calendar page keeps its method, rule and terms text in one closed
 * "Sources and terms" fold at the bottom. The grading, the baseline and bot wording and the NASS notice are
 * inside it; no threshold, test name, schedule or pipeline text is in the reading path.
 * node --test test/calendar-terms-fold.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const h = read("usda-calendar.html");
const main = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
const NASS = "This product uses the NASS API but is not endorsed or certified by NASS.";
const FOLDS = /<details[^>]*>\s*<summary[^>]*>\s*Sources and terms\s*<\/summary>/g;

test("one closed Sources and terms fold, after the questions, with the notices inside", () => {
  const folds = main.match(FOLDS) || [];
  assert.equal(folds.length, 1);
  assert.ok(!/\sopen[\s>]/.test(folds[0]));
  const i = main.indexOf(folds[0]);
  const fold = main.slice(i, main.indexOf("</details>", i));
  assert.ok(i > main.indexOf("<!--FAQ:END-->"), "below the common questions");
  assert.ok(fold.includes(NASS) && main.split(NASS).length === 2, "NASS notice once, inside");
  assert.match(fold, /How a report is graded/);
  assert.match(fold, /baseline that is fixed in advance and never changed/);
  assert.match(fold, /Every forecast is locked before the outcome is known and graded after it/);
  assert.match(fold, /A call that lands exactly on its entry price counts as neither right nor wrong/);
  assert.match(fold, /Status: Live beats its baseline.*Retired is no longer made/);
  assert.match(fold, /written down before its first live call \(Oct 3, 2026\) and not changed since/);
  assert.match(fold, /not a trade recommendation or financial advice/);
  assert.match(fold, /Yahoo Finance daily bars/);
  assert.match(fold, /corn ending stocks landed 10\.3% over the average and read in line/);
});

test("the old method folds and loose notes are gone from the reading path", () => {
  for (const gone of ['id="methodology"', 'id="pb-rule"', 'class="pb-math">', "How forecasters are scored", "How the arithmetic works",
    'class="pb-disc"', 'class="method-note"', '<details class="tr-src">']) assert.ok(!main.includes(gone), gone);
  assert.ok(!main.includes('href="#methodology"'));
});

test("no threshold, test name, schedule or rule number text outside the questions and the page data", () => {
  const body = main.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--FAQ:START-->[\s\S]*<!--FAQ:END-->/, "");
  const BANNED = /0\.5% for a yield|within 0\.5%|Newey|Benjamini|every five minutes|roll-repaired|counted mod 4|non-overlapping|bot-v1|10 scored calls|3 or more so far|The thresholds arrive|surprise thresholds/i;
  const m = body.match(BANNED);
  assert.equal(m, null, m && m[0]);
  for (const f of ["components/bot-scorecard.js", "components/priced-in.js", "scripts/build_track_record.py", "scripts/seed_static.py"]) {
    const t = read(f);
    assert.ok(!/non-overlapping|min_windows_for_rate\)\+' non|A finishing order needs/.test(t), f);
  }
});

test("the page and its scripts still run with the method elements gone", () => {
  const js = read("components/bot-scorecard.js");
  for (const id of ["pb-reg", "pb-ver", "pb-family", "pb-cutoff"]) assert.ok(!js.includes("'" + id + "'") && !main.includes('id="' + id + '"'), id);
  assert.ok(main.includes('id="pb-updated"'));
  assert.ok(!read("components/priced-in.js").includes("'as-minn'"));
  assert.match(h, /bot-scorecard\.js\?v=2/);
});
