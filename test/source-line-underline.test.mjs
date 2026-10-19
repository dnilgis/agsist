// Sig, 2026-10-19: links inside small source/credit lines are underlined;
// menus, nav and buttons are unchanged. The real case (a11y audit, axe
// link-in-text-block): on /cash-bids/iowa/adair the ".cbt-note" links to
// /cash-bids and /store-or-sell were gold on muted grey with no underline,
// 1.01:1 against the text around them in dark and 1.05:1 in light.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ROOT = new URL("../", import.meta.url).pathname;
const R = (f) => readFileSync(ROOT + f, "utf8");

// [file, selector whose links must be underlined]
const RULES = [
  ...["corn", "soybean", "wheat"].flatMap((c) => [".crop-src a", ".cot-src a", ".rat-note a", ".cp-src a", ".basis-src a", ".moved-line .ml-src a"]
    .map((s) => [`${c}-futures-prices.html`, s])),
  ["soybean-futures-prices.html", ".nc-line a"],
  ["wheat-futures-prices.html", ".export-src a"],
  ["cattle-futures-prices.html", ".ctcot-src a"],
  ["cot.html", ".cot-source a"],
  ["gdu-calculator.html", ".gdu-source a"],
  ["fast-facts.html", ".ff-source a"], ["fast-facts.html", ".ff-src-list a"], ["fast-facts.html", ".ff-ans-note a"], ["fast-facts.html", ".ff-meta a"],
  ["usda-calendar.html", ".cal-foot a"],
  ["status.html", ".st-note a"],
  ["crop-tour.html", ".ct-note a"], ["pod-counts.html", ".ct-note a"],
  ["changelog.html", ".cl-note a"],
  ["breakeven.html", ".yr-note a"], ["breakeven.html", ".ln-src a"], ["breakeven.html", ".be-budget-note a"],
  ["comp-report.html", ".cr-held a"], ["field-report.html", ".frp-err a"],
  ["drought-monitor.html", ".dm-map-src a"],
  ["hail-map.html", ".hm-src a"],
  ["cash-lease.html", ".cl-src a"],
  ["fertilizer.html", ".fert-source a"],
  ["planting-date.html", ".pd-source a"],
  ["tariffs.html", ".tariff-source a"], ["tariffs.html", ".tt-meta a"], ["tariffs.html", ".cn-src a"], ["tariffs.html", ".tariff-wi-mn a"],
  ["whats-priced-in.html", ".wp-nums .src a"], ["whats-priced-in.html", ".wp-res-foot a"], ["whats-priced-in.html", ".wp-last a"],
  ["whats-priced-in.html", ".wp-farmbox a"], ["whats-priced-in.html", ".as-legend a"],
  ["yield-estimator.html", ".ye-source a"],
  ["milk-prices.html", ".dp-sources a"],
  ["cash-bids/iowa/adair.html", ".cbt-note a"], ["cash-bids/iowa/adair.html", ".cbt-sub a"],
  ["rent/iowa.html", ".rs-links a"], ["rent/index.html", ".rs-links a"],
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function decls(css, sel) {
  // every rule whose selector list names `sel` (with base, not :hover)
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(",").map((x) => x.trim());
    if (sels.includes(sel)) out.push(m[2]);
  }
  return out;
}

test("links in source and note lines are underlined, and no later rule takes it off", () => {
  for (const [f, sel] of RULES) {
    const css = [...R(f).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
    const d = decls(css, sel);
    assert.ok(d.length, `${f}: no rule for ${sel}`);
    assert.ok(d.some((x) => /text-decoration:\s*underline/.test(x)), `${f}: ${sel} is not underlined`);
    assert.ok(!d.some((x) => /text-decoration:\s*none/.test(x)), `${f}: a ${sel} rule takes the underline off`);
  }
});

test("the builders write the underline, so the next bids and rent runs keep it", () => {
  const cb = R("scripts/build_cash_bid_pages.py");
  assert.match(cb, new RegExp(esc(".cbt-sub a,.cbt-note a{text-decoration:underline")));
  assert.match(R("scripts/build_state_rent_pages.py"), new RegExp(esc(".rs-links a{{color:var(--gold);text-decoration:underline")));
});

test("inline-styled links in running text are underlined too", () => {
  for (const [f, re] of [["milk-prices.html", /<a href="\/(?:breakeven|manure-value)" style="([^"]*)"/g],
                         ["milk-prices.html", /<a href="https:\/\/www\.rma\.usda\.gov\/" style="([^"]*)"/g],
                         ["breakeven.html", /<a href="https:\/\/farmdocdaily[^"]*" style="([^"]*)"/g],
                         ["cash-lease.html", /class="cl-note cl-crosslink">[^\n]*?<a href="\/rent\/" style="([^"]*)"/g]]) {
    const hits = [...R(f).matchAll(re)];
    assert.ok(hits.length, f + " lost the link");
    for (const h of hits) assert.match(h[1], /text-decoration:underline/, f + ": " + h[0]);
  }
  assert.match(R("components/futures.js"), /<a style="color:var\(--gold\);text-decoration:underline[^"]*" href="\/store-or-sell\?crop=/);
});

test("nav and buttons keep no underline: breadcrumbs and the ribbon button are untouched", () => {
  const css = R("components/styles.css");
  assert.match(css, /\.ag-sponsor-ribbon a\[href\]\{[^}]*text-decoration:none/);
  assert.ok(!/\.ap-bc a\{[^}]*underline/.test(R("arc-plc.html")), "the ARC/PLC breadcrumb picked up an underline");
});
