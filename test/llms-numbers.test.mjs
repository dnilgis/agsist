/* llms.txt "Latest numbers" (Nov 2, 2026; useful numbers where answer
 * engines look, each with its date). Every figure comes from the file the
 * site's own pages read, stated with that file's date; nothing is carried over
 * or guessed. scripts/build_llms_txt.py writes them; the daily sitemap job
 * rebuilds llms.txt, so between rebuilds the committed figures can trail the
 * files, but never claim a date newer than their file.
 *
 *   node --test test/llms-numbers.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const J = (p) => JSON.parse(readFileSync(ROOT + p, "utf8"));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso) => `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}`;
const stamp = (iso) => `${day(iso)}, ${iso.slice(11, 16)} UTC`;
const n = (x) => x.toLocaleString("en-US");

/* the builder's lines for this checkout, keyed by source */
const fresh = JSON.parse(execFileSync("python3", ["-c",
  "import json,sys; sys.path.insert(0,'scripts'); import build_llms_txt as b; print(json.dumps(b.numbers_lines()))"],
  { cwd: ROOT, encoding: "utf8" }));
const F = Object.fromEntries(fresh);

test("each figure equals its source file, with the source's own date", () => {
  const bs = J("data/bids-stats.json");
  assert.ok(F.bids.includes(`${n(bs.stats.total_bids)} bid prices`) && F.bids.includes(stamp(bs.fetched)), F.bids);
  const ec = J("data/elevator-counts.json");
  assert.ok(F.elevators.includes(`current bid: ${n(ec.bids.elevators)}, in ${n(ec.bids.towns)} towns, counted ${stamp(ec.generated)}`), F.elevators);
  const issue = readdirSync(ROOT + "daily").filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort().at(-1).slice(0, 10);
  assert.ok(F.daily.includes(`latest issue ${day(issue)}, at https://agsist.com/daily/${issue} `), F.daily);
  const ends = readdirSync(ROOT + "data/rain").filter((f) => /^[a-z]{2}\.json$/.test(f))
    .map((f) => J("data/rain/" + f).edate).filter(Boolean).sort();
  assert.ok(F.rain.includes(`through ${day(ends.at(-1))}`), F.rain);
  if (ends[0] !== ends.at(-1)) assert.ok(F.rain.includes(`the oldest through ${day(ends[0])}`), F.rain);
  const fi = J("data/feeder-index.json"), w = fi.index.weeks.at(-1);
  if (F.feeder) {
    assert.ok(F.feeder.includes(`$${w.p.toFixed(2)} per cwt for the week`) && F.feeder.includes(day(w.end)), F.feeder);
    assert.equal(/first count/.test(F.feeder), !w.final, "a week not yet final says so");
    assert.ok((Date.parse(fi.updated.slice(0, 10)) - Date.parse(w.end)) / 864e5 <= 16, "not shown past the page's 16-day hold");
  }
  const dd = J("data/dairy-data.json");
  if (F.milk) {
    assert.equal(dd.status.class, "ok");
    assert.ok(F.milk.includes(`Class III $${dd.class3.toFixed(2)} and Class IV $${dd.class4.toFixed(2)} per cwt for ${dd.class_month}`), F.milk);
    if (dd.status.all_milk === "ok") assert.ok(F.milk.includes(`all-milk price $${dd.all_milk.value.toFixed(2)} for ${dd.all_milk.month}`), F.milk);
  }
  const ed = J("data/cash-index/editions.json").editions.reduce((a, b) => (b.month > a.month ? b : a));
  for (const crop of ["corn", "soybeans"]) {
    const o = ed.crops[crop].overall;
    assert.ok(F["index-" + crop].includes(`${ed.label}, ${crop}: ${n(o.n)} elevators, average cash bid $${o.avg_cash.toFixed(2)}`), F["index-" + crop]);
  }
  for (const k of ["bids", "elevators", "daily", "rain"]) assert.ok(F[k], k + " stated");
});

/* "Nov 2, 2026, 22:37 UTC" | "Nov 2, 2026" -> sortable "2026-11-02T22:37" | "2026-11-02" */
function dates(s) {
  const out = [];
  for (const m of s.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})(?:, (\d{2}:\d{2}) UTC)?/g))
    out.push(`${m[3]}-${String(MON.indexOf(m[1]) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}${m[4] ? "T" + m[4] : ""}`);
  return out;
}
/* "September 2026", "October 1 to 15, 2026" (a month label as its source file writes it) */
const MONTH_YEAR = /\b(January|February|March|April|May|June|July|August|September|October|November|December)( \d{1,2}( to \d{1,2})?,)? \d{4}\b/;

test("committed llms.txt: every figure dated, none newer than its source, How to cite present", () => {
  const txt = readFileSync(ROOT + "llms.txt", "utf8");
  assert.match(txt, /^How to cite: name AGSIST \(agsist\.com\), link the page the number is on, and give\nthe as-of date shown with it\./m);
  const sec = txt.split("\n## Latest numbers\n")[1].split("\n## ")[0];
  const lines = sec.split("\n").filter((l) => l.startsWith("- "));
  assert.ok(lines.length >= 4, "figures stated");
  for (const ln of lines) {
    assert.ok(dates(ln).length || MONTH_YEAR.test(ln), "dated: " + ln);
    const src = fresh.find(([, f]) => f.split(":")[0] === ln.split(":")[0]);
    assert.ok(src, "from a known source: " + ln);
    if (ln === src[1]) continue;
    // the file moved on since the last rebuild: the committed date may trail it, never lead it
    const have = dates(ln), now = dates(src[1]);
    for (let i = 0; i < Math.min(have.length, now.length); i++) assert.ok(have[i] <= now[i], `${ln}\n  newer than its source: ${src[1]}`);
  }
  assert.ok(!/—/.test(sec), "no em dash");
});
