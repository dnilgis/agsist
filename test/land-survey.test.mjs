/* County land values where sale prices are not public record (Sig, Oct 29, 2026 priority queue:
 * ND Trust Lands, the K-State Kansas book). scripts/build_land_survey.py reads the PDFs into
 * data/land/nd/survey.json and data/land/ks/survey.json; scripts/build_atlas_pages.py puts one
 * labeled line on each county's land card; scripts/build_land_sales.py names both on the hub.
 *
 *   - every county value traces to its PDF row (North Dakota: the row text itself re-reads to the
 *     same numbers; Kansas: a PDF page, and the average inside the book's own range);
 *   - every North Dakota and Kansas county page has one line, labeled by evidence type and year,
 *     and every dollar figure on it is one of that county's values in the file;
 *   - a county with no value shows no dollar figure, and a withheld value says so;
 *   - neither source reaches the recorded-sale files or middles.
 *
 *   node --test test/land-survey.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const rd = (p) => readFileSync(ROOT + p, "utf8");
const ND = JSON.parse(rd("data/land/nd/survey.json"));
const KS = JSON.parse(rd("data/land/ks/survey.json"));
const STATES = [["ND", "north-dakota", ND, 53], ["KS", "kansas", KS, 105]];
const num = (t) => (t === "(D)" ? null : Number(t.replace(/,/g, "")));
const ND_COLS = ["rent_5y", "value_5y", "n", "rent_min", "rent_max", "rent_mode", "rent", "value"];

test("the parser's selftest passes", () => {
  const out = execFileSync("python3", ["scripts/build_land_survey.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /selftest: 0 failed/);
});

test("North Dakota: every value re-reads from its PDF row", () => {
  assert.equal(ND.evidence, "state survey of farmers");
  assert.equal(ND.year, 2026);
  assert.match(ND.source.sha256 || "", /^[0-9a-f]{64}$/);
  let rows = 0;
  for (const [f, c] of Object.entries(ND.counties)) {
    assert.match(f, /^38\d{3}$/);
    for (const k of ["cropland", "pasture", "hay"]) {
      const r = c[k];
      assert.ok(r, `${c.name}: ${k}`);
      const t = r.row.split(" ");
      const name = t.slice(0, t.length - 8).join(" ");
      assert.equal(name, c.name, `${c.name} ${k}: the row names the county`);
      t.slice(-8).forEach((v, i) => assert.equal(r[ND_COLS[i]], num(v), `${c.name} ${k} ${ND_COLS[i]}: ${r.row}`));
      if (r.value === null || r.rent === null) assert.ok(r.withheld, `${c.name} ${k}: withheld says why`);
      rows++;
    }
  }
  assert.ok(Object.keys(ND.counties).length >= 53 && rows >= 159, `only ${rows} rows`);
});

test("Kansas: every average has its PDF page and sits inside the book's own range", () => {
  assert.equal(KS.evidence, "average of reported sales, K-State");
  assert.equal(KS.year, 2025);
  assert.match(KS.source.sha256 || "", /^[0-9a-f]{64}$/);
  let vals = 0;
  for (const [f, c] of Object.entries(KS.counties)) {
    assert.match(f, /^20\d{3}$/);
    for (const k of ["nonirr", "pasture", "irrigated"]) {
      const r = c[k];
      if (!r) continue;
      assert.ok(Number.isInteger(r.page) && r.page >= 1 && r.page <= 64, `${c.name} ${k}: page`);
      if (r.avg === null) { assert.ok(r.withheld && r.book_avg, `${c.name} ${k}: withheld says why`); continue; }
      assert.ok(r.min <= r.avg && r.avg <= r.max, `${c.name} ${k}: ${r.min} <= ${r.avg} <= ${r.max}`);
      vals++;
    }
    if (c.sales_n === null) assert.ok(c.withheld_n, `${c.name}: withheld count says why`);
  }
  assert.ok(vals >= 200, `only ${vals} Kansas values`);
});

function line(st, slug, f) {
  const html = rd(`farmland-atlas/${slug}/${f}`);
  const m = [...html.matchAll(new RegExp(`<p class="note" data-land-survey="${st}">(.*?)</p>`, "g"))];
  return { html, m };
}

test("every ND and KS county page has one labeled line; every dollar on it is the county's own", () => {
  for (const [st, slug, S, floor] of STATES) {
    const byName = {};
    for (const [f, c] of Object.entries(S.counties)) byName[c.name.toLowerCase().replace(/[^a-z]/g, "")] = c;
    let seen = 0, withDollars = 0;
    for (const f of readdirSync(ROOT + "farmland-atlas/" + slug)) {
      if (!f.endsWith("-county.html")) continue;
      const { html, m } = line(st, slug, f);
      if (!/<h2 id="c-land">/.test(html)) continue;
      seen++;
      assert.equal(m.length, 1, `${slug}/${f}: one survey line`);
      const body = m[0][1];
      assert.ok(body.includes(S.evidence) && body.includes(String(S.year)), `${slug}/${f}: evidence and year`);
      assert.ok(body.includes("not recorded sales"), `${slug}/${f}: says not recorded sales`);
      assert.ok(body.includes('href="' + (st === "ND" ? S.source.url : S.source.page) + '"'), `${slug}/${f}: links the source`);
      assert.doesNotMatch(html, /does not copy them/, `${slug}/${f}: no "does not copy" line beside the numbers`);
      const c = byName[f.replace(/-county\.html$/, "").replace(/[^a-z]/g, "")];
      const own = new Set();
      if (c) for (const v of Object.values(c)) if (v && typeof v === "object") {
        for (const x of [v.value, v.avg]) if (x != null) own.add("$" + Math.round(x).toLocaleString("en-US"));
        if (v.rent != null && v.value != null) own.add("$" + v.rent.toFixed(2));
      }
      const dollars = [...body.matchAll(/\$[\d,]+(?:\.\d\d)?/g)].map((x) => x[0]);
      for (const d of dollars) assert.ok(own.has(d), `${slug}/${f}: ${d} is not one of this county's values`);
      if (!own.size) assert.equal(dollars.length, 0, `${slug}/${f}: no value, no dollar figure`);
      else withDollars++;
      if (c) for (const v of Object.values(c)) if (v && typeof v === "object" && v.withheld) assert.match(body, /withheld|not shown/, `${slug}/${f}`);
    }
    assert.ok(seen >= floor, `${slug}: only ${seen} county pages`);
    assert.ok(withDollars >= floor - 3, `${slug}: only ${withDollars} pages with values`);
  }
});

test("neither source reaches the recorded-sale files", () => {
  for (const st of ["nd", "ks"]) {
    assert.ok(!existsSync(ROOT + `data/land-sales/${st}.json`), `${st}: no recorded-sale state file`);
    assert.ok(!existsSync(ROOT + `data/land/${st}/summary.json`), `${st}: no recorded-sale summary`);
  }
  const src = rd("scripts/build_land_summary.py") + rd("scripts/build_land_sales.py").replace(/# Where sale prices are not public record[\s\S]*?def span_words/, "");
  assert.doesNotMatch(src, /survey\.json/, "the sale builders do not read the survey files outside the labeled hub block");
});

test("the land sales hub names both, with the county counts from the files", () => {
  const html = rd("land-sales/index.html");
  const block = (html.match(/<div class="ls-surv" id="other-evidence">([\s\S]*?)<\/div>/) || [])[1] || "";
  assert.ok(block, "the block is on the hub");
  for (const [st, slug, S] of STATES) {
    const n = Object.values(S.counties).filter((c) => Object.values(c).some((v) => v && typeof v === "object" && (v.value != null || v.avg != null))).length;
    assert.match(block, new RegExp(`${S.evidence.replace(/[.,]/g, "\\$&")}, ${S.year}[^<]*?, ${n} counties`), `${st}: ${n} counties`);
    assert.ok(block.includes(`href="/farmland-atlas/${slug}/"`), `${st}: links the Atlas state`);
  }
  assert.match(block, /Not recorded sales/);
});
