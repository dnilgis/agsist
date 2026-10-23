// What's priced in, Oct 16 head to head: the number to beat between reports,
// the per-group "records still building" count, the not-graded May rows and
// the dated no-move notes. The to-beat box is drawn by toBeatEl() in the page
// and to_beat_el() in the prerender; both run on the same data, byte for byte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// What's priced in: baked HTML on /usda-calendar, renderers in components/priced-in.js (Oct 22, 2026)
const PAGE = readFileSync(join(ROOT, "usda-calendar.html"), "utf8") + readFileSync(join(ROOT, "components/priced-in.js"), "utf8");
const UTIL = readFileSync(join(ROOT, "components/util.js"), "utf8");
const D = JSON.parse(readFileSync(join(ROOT, "data/whats-priced-in.json"), "utf8"));
const W = JSON.parse(readFileSync(join(ROOT, "data/wasde.json"), "utf8"));

function lift(src, name) {
  const start = src.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + " missing");
  let depth = 0;
  for (let p = src.indexOf("{", start); p < src.length; p++) {
    if (src[p] === "{") depth++;
    else if (src[p] === "}" && --depth === 0) return src.slice(start, p + 1);
  }
  throw new Error("unbalanced " + name);
}
const jsBeat = new Function("tb", "nr", `const window = {}; ${UTIL}; const esc = window.esc; ${lift(PAGE, "toBeatEl")}; return toBeatEl(tb, nr);`);
const pyBeat = (tb, nr) => execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, "scripts")
import prerender_wpi_scorecard as m
a = json.load(sys.stdin)
sys.stdout.write(m.to_beat_el(a[0], a[1]))
`], { cwd: ROOT, input: JSON.stringify([tb, nr]), encoding: "utf8" });

test("the number to beat: USDA's October WASDE figures, read by hand off WASDE-676", () => {
  const tb = D.upcoming && D.upcoming.to_beat;
  if (!tb) return; // only between a WASDE and the next one
  assert.equal(tb.date, W.release);
  const v = Object.fromEntries(tb.rows.map((r) => [r.key, r.value]));
  if (tb.date === "2026-10-09") {
    // WASDE-676 pages 12 (wheat), 13 (corn), 15 (soybeans), Oct column
    assert.equal(v.corn_yield_2627, 181.2);
    assert.equal(v.corn_prod_2627, 16.034);   // 16,034 mil bu
    assert.equal(v.corn_2627, 1.849);         // 1,849 mil bu
    assert.equal(v.soy_yield_2627, 53.1);
    assert.equal(v.soy_prod_2627, 4562);
    assert.equal(v.soy_2627, 315);
    assert.equal(v.wheat_prod_2627, 1534);
    assert.equal(v.wheat_2627, 740);
  }
  assert.ok(tb.date < D.upcoming.date, "only a WASDE released before the next report");
});

test("the number to beat renders the same live and baked, and the baked page carries it", () => {
  const tb = D.upcoming && D.upcoming.to_beat;
  const sample = tb || { report: "October WASDE", date: "2026-10-09", wasde_no: "WASDE-676",
    source: "https://www.usda.gov/oce/commodity/wasde", rows: [{ key: "k", label: "a \"q\" & <b>", value: 1534.0, unit: "mil bu" }] };
  const js = jsBeat(sample, "November WASDE");
  assert.equal(pyBeat(sample, "November WASDE"), js);
  assert.match(js, /The number to beat/);
  assert.match(js, /USDA’s October WASDE \(Oct 9\), standing until the November WASDE/);
  assert.ok(!js.includes("—"));
  assert.equal(jsBeat(null, "x"), "");
  if (tb) assert.ok(PAGE.includes(js), "baked into the next-report card");
});

test("below the line is counted per group, never pooled (was '2 of 7')", () => {
  const fn = lift(PAGE, "beatNote");
  const beat = new Function("q", "b", `const window = {}; ${UTIL}; const esc = window.esc; ${fn}; return beatNote(q, b);`);
  const A = JSON.parse(readFileSync(join(ROOT, "data/analyst-scorecard.json"), "utf8"));
  let q = [], b = [];
  A.classes.forEach((c) => { q = q.concat(c.leaderboard || []); b = b.concat(c.building || []); });
  const out = beat(q, b);
  assert.ok(!/2 of 7/.test(out), out);
  // yield building rows on file Oct 16: Suderman 0/2, McClure 1/2, Gulke 1/1, Pro Farmer 0/1 = 2 of 6
  if (A.updated === "2026-10-16") assert.match(out, /2 of 6 yield calls; 0 of 1 ending stocks &amp; production calls\./);
});

test("May rows with no survey date are not graded, and every row without a move says why, dated", () => {
  for (const r of D.history) {
    if (r.source_date_unknown) {
      assert.equal(r.surprise, "", r.metric);
      assert.match(r.ungraded_why, /^Not graded/);
    }
    if (!r.reaction) assert.match(r.reaction_why || "", /No price move on file for [A-Z][a-z]{2} \d{1,2}, \d{4}\./, r.metric);
  }
  assert.ok(!PAGE.includes("No note written on how the market took it.</div></div><div"), "baked rows carry the dated note");
  const may = D.history.filter((r) => r.date === "2026-05-12");
  if (may.length) assert.ok(may.every((r) => r.surprise === ""));
});

test("Oct 9 soybean move names DTN's different level, picks no winner", () => {
  const s = D.history.find((r) => r.date === "2026-10-09" && r.metric === "2026/27 soybean yield");
  assert.match(s.reaction, /\$12\.87½ to \$12\.92 \(CBOT daily settles as Yahoo Finance reports them\)\. DTN's report review printed \$12\.94, up 4½¢/);
});
