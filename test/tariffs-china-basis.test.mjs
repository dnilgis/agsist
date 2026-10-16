// tariffs.json, Oct 16 head to head (bug 1, medium): "China had bought about
// 13.7 MMT toward its 25 MMT commitment" said neither calendar nor marketing
// year, nor sales nor shipments, beside a cited S&P copy giving USDA's 9.969
// MMT for the 2026/27 marketing year. Every purchase total now carries its
// basis or says it was not given, and every cargo count carries its date.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const d = JSON.parse(readFileSync(new URL("../data/tariffs.json", import.meta.url), "utf8"));
const texts = [d.headline, d.status_note, ...d.rows.map((r) => r.note), ...d.timeline.map((t) => t.event)];
// timeline entries carry their own date; the standing copy has to name one
const standing = [d.headline, d.status_note, ...d.rows.map((r) => r.note)];

test("every MMT purchase total states its basis or says none was given", () => {
  for (const t of texts) {
    for (const m of t.matchAll(/(\d+(?:\.\d+)?) MMT/g)) {
      if (m[1] === "25" || m[1] === "12") continue; // the commitment itself
      const around = t.slice(Math.max(0, m.index - 220), m.index + 220);
      assert.match(around, /marketing[- ]year|basis not given|without saying whether/, "no basis near " + m[0] + ": " + around);
    }
  }
});

test("USDA's 9.97 MMT 2026/27 marketing-year figure sits beside Reuters' 13.7, both dated", () => {
  assert.match(d.status_note, /9\.97 MMT as of S&P Global's Sep 24 report/);
  assert.match(d.status_note, /2026\/27 marketing-year \(Sep-Aug\)/);
  assert.match(d.status_note, /13\.7 MMT on Oct 14, basis not given/);
});

test("cargo counts carry a date", () => {
  for (const t of standing) {
    for (const m of t.matchAll(/(\d+(?: to \d+)?) (?:more |US soybean )?cargoes/g)) {
      const around = t.slice(Math.max(0, m.index - 200), m.index + 200);
      assert.match(around, /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}/, "undated cargo count: " + around);
    }
  }
  assert.ok(texts.every((t) => !t.includes("—")), "no em dash");
});
