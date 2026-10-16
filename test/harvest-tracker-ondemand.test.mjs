// harvest-price-tracker.html, Oct 16 head to head: the window chart, one
// running number, RMA rows on demand, and a Sources line that says when the
// newest day is not a settle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = readFileSync(join(ROOT, "harvest-price-tracker.html"), "utf8");
const HP = JSON.parse(readFileSync(join(ROOT, "data/harvest-prices.json"), "utf8"));

test("the page loads the small index first, never the whole 430 KB mirror", () => {
  assert.ok(!/fetch\([^)]*rma-prices\.json/.test(PAGE) && !/'\/data\/rma-prices\.json'/.test(PAGE), "no whole-mirror fetch");
  assert.match(PAGE, /var SRC='\/data\/rma-prices\/index\.json'/);
  assert.match(PAGE, /fetch\('\/data\/rma-prices\/'\+code\+'\.json'/);
  const idx = readFileSync(join(ROOT, "data/rma-prices/index.json"));
  assert.ok(idx.length < 40000, "index " + idx.length + " bytes");
});

test("the split files are the mirror, row for row", () => {
  const out = execFileSync("python3", ["scripts/split_rma_prices.py", "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /matches/);
});

test("hand check: corn running average, 11 Dec settles Oct 1-15 sum to 54.12, /11 = $4.92", () => {
  const corn = HP.commodities.find((c) => c.label === "Corn");
  const ser = corn.harvest.series;
  if (HP.updated !== "2026-10-15") return;
  const sum = ser.reduce((t, x) => t + x.s, 0);
  assert.equal(ser.length, 11);
  assert.equal(Math.round(sum * 100) / 100, 54.12);
  assert.equal(Math.round(sum / ser.length * 100) / 100, 4.92);
  assert.match(PAGE, /2026 harvest price so far: corn \$4\.92/);
});

test("each running card carries a chart of every settle, the provisional one hollow", () => {
  const figs = PAGE.match(/<figure class="hpg">[\s\S]*?<\/figure>/g) || [];
  const running = HP.commodities.filter((c) => c.harvest && c.harvest.status === "running" && (c.harvest.series || []).length > 1);
  assert.equal(figs.length, running.length);
  running.forEach((c, i) => {
    const ser = c.harvest.series;
    assert.equal((figs[i].match(/<circle /g) || []).length, ser.length, c.label);
    const prov = ser.filter((x) => x.p).length;
    assert.equal((figs[i].match(/hpg-d hpg-p/g) || []).length, prov);
    assert.match(figs[i], new RegExp("projected \\$" + c.projected.price.toFixed(2)));
    assert.ok(!figs[i].includes("—"));
  });
});

test("Sources line names Yahoo and says when the newest day is not yet the settle", () => {
  const m = PAGE.match(/<div class="method-note">[\s\S]*?<\/div>/);
  assert.ok(m, "method note baked");
  assert.match(m[0], /CBOT daily settles as Yahoo Finance reports them/);
  const ser = HP.commodities.find((c) => c.harvest && c.harvest.status === "running")?.harvest.series || [];
  if (ser.length && ser[ser.length - 1].p) assert.match(m[0], /is Yahoo&rsquo;s afternoon close, not yet the settle/);
});

test("the calculator uses the H1's running average with its day count, RMA's figure named once", () => {
  assert.match(PAGE, /function runH\(g\)/);
  assert.match(PAGE, /money\(H,unitOf\(g\)\)\+'<\/b>'\+\(rh\?' \('\+runWords\(rh\)\+'\)':''\)/);
  assert.match(PAGE, /RMA&rsquo;s own running figure/);
});
