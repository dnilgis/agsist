/* Answer blocks for the questions farmers ask search assistants (Bing AI export, Oct 28, 2026).
 * data/ai-answers.json holds one block per topic; scripts/build_ai_answers.py bakes each into
 * the page that owns the topic (arc-plc.html through scripts/build_arc_plc.py).
 * Holds: every live block is on its page as baked, with a primary-source link and a
 * "Last checked" date equal to its oldest source read; no em dash; 2 to 5 sentences;
 * a withheld block shows nothing and says why in the data file.
 *
 *   node --test test/ai-answers.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const doc = JSON.parse(read("data/ai-answers.json"));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nice = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${MON[m - 1]} ${d}, ${y}`; };
const between = (html, id) => {
  const m = html.match(new RegExp(`<!-- ai-answer:${id} -->([\\s\\S]*?)<!-- /ai-answer:${id} -->`, "g"));
  return m;
};

test("selftest and --check pass (pages baked from the data file)", () => {
  execFileSync("python3", ["scripts/build_ai_answers.py", "--selftest"], { cwd: ROOT, stdio: "pipe" });
  execFileSync("python3", ["scripts/build_ai_answers.py", "--check"], { cwd: ROOT, stdio: "pipe" });
});

test("every query from the brief has a home", () => {
  const ids = new Set(doc.answers.map((a) => a.id));
  for (const id of ["farm-bill-status", "crop-report", "tariff-impact", "usda-payments", "cattle-markets",
    "beef-supply", "argentina-beef", "screwworm", "heifer-retention", "fertilizer-supply"]) assert.ok(ids.has(id), id);
});

for (const a of doc.answers) {
  test(`${a.id} on ${a.page}`, () => {
    const html = read(a.page);
    const found = between(html, a.id);
    assert.equal(found && found.length, 1, "exactly one marker pair");
    const inner = found[0].replace(/^<!-- ai-answer:[^>]+-->/, "").replace(/<!-- \/ai-answer:[^>]+-->$/, "");
    assert.ok(!/—|&mdash;|&#8212;/.test(found[0]), "no em dash");
    if (a.status !== "live") {
      assert.equal(inner, "", "withheld block renders nothing");
      assert.ok((a.withheld_why || "").length > 20, "says why it is withheld");
      return;
    }
    assert.ok(a.text.length >= 2 && a.text.length <= 5, "2 to 5 sentences");
    assert.ok(a.sources.length >= 1, "at least one source");
    for (const s of a.sources) {
      assert.match(s.url, /^https:\/\//);
      assert.match(s.read, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(inner.includes(`href="${s.url.replace(/&/g, "&amp;")}"`), `links ${s.name}`);
    }
    const oldest = a.sources.map((s) => s.read).sort()[0];
    assert.ok(inner.includes(`Last checked ${nice(oldest)}.`), "last checked = oldest source read");
    assert.ok(inner.includes(`<h2 id="answer-${a.id}-h"`), "heading");
    // every number in the text is in the block as written (nothing reformatted on the way)
    for (const n of a.text.join(" ").match(/\$?\d[\d,.]*%?/g) || []) assert.ok(inner.includes(n), n);
  });
}

test("arc-plc builder carries the block (not a hand edit)", () => {
  const src = read("scripts/build_arc_plc.py");
  assert.ok(src.includes("AA.block('usda-payments')"));
});

test("stale answers are listed by the daily site check", () => {
  const src = read("scripts/daily_site_check.py");
  assert.ok(src.includes("build_ai_answers"));
});
