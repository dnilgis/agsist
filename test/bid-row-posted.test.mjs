/* A posted date beside an old price (benchmark review, Oct 29, 2026: "add a per-bid
 * last-posted or stale flag beside every price; avoid trusting frozen bid boards").
 * The card head already said when the board last moved; a row with its own older time,
 * or any row of a board past its normal update, now carries its date under its own price.
 *   node --test test/bid-row-posted.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const CB = read("components/cash-bids.js");

function mark() {
  const a = CB.indexOf("var MKT_TZ = 'America/Chicago';"), b = CB.indexOf("var marketBadge=$('market-badge');");
  const esc = /function escH\(s\)\{[^\n]*\}/.exec(CB)[0];
  const c = { Intl, Date };
  vm.runInNewContext(CB.slice(a, b) + "\n" + esc + "; this.f = rowPostedMark;", c);
  return c.f;
}
const T = (s) => Date.parse(s);
const NOW = T("2026-10-29T15:00:00Z");            // Thursday 10:00 am CDT

test("a fresh row on a fresh board stays clean", () => {
  const f = mark();
  const t = "2026-10-29T13:10:00Z";
  assert.equal(f({ asOf: t }, { via: "direct", asOfT: T(t) }, NOW), "");
  assert.equal(f({ asOf: t }, { via: "feed", asOfT: T(t) }, NOW), "");
});

test("a row the board did not move with says when it was posted", () => {
  const f = mark();
  const h = f({ asOf: "2026-10-28T13:00:00Z" }, { via: "direct", asOfT: T("2026-10-29T13:10:00Z") }, NOW);
  assert.match(h, /^<span class="bid-grade bid-posted" title="Posted earlier than the rest of this board">posted Wed<\/span>$/);
});

test("a board two closes behind marks every price old, with its date", () => {
  const f = mark();
  const t = "2026-10-26T13:00:00Z";                // Monday, before the close
  const h = f({ asOf: t }, { via: "direct", asOfT: T(t) }, NOW);
  assert.match(h, /bid-posted bid-posted-old/);
  assert.match(h, />old price, posted Mon<\/span>$/);
  const wk = f({ asOf: "2026-10-14T13:00:00Z" }, { via: "direct", asOfT: T("2026-10-14T13:00:00Z") }, NOW);
  assert.match(wk, />old price, posted Oct 14<\/span>$/, "past six days the date, not a weekday");
});

test("a Friday board on Sunday is not old; a feed row past 18 hours is", () => {
  const f = mark();
  const fri = "2026-10-23T14:00:00Z";
  assert.equal(f({ asOf: fri }, { via: "direct", asOfT: T(fri) }, T("2026-10-25T18:00:00Z")), "");
  assert.match(f({ asOf: "2026-10-28T12:00:00Z" }, { via: "feed", asOfT: T("2026-10-28T12:00:00Z") }, NOW), /old price, posted Wed/);
});

test("a board not reached on the latest run marks its prices old", () => {
  const f = mark();
  const t = "2026-10-29T12:00:00Z";
  assert.match(f({ asOf: t, stale: true }, { via: "direct", asOfT: T(t) }, NOW), /bid-posted-old/);
  assert.match(f({ asOf: t }, { via: "direct", asOfT: T(t), unread: true }, NOW), /bid-posted-old/);
});

test("every bid row calls it, and the page styles it and loads the new script", () => {
  assert.match(CB, /gradeHtml\+=rowPostedMark\(bid,elev\);\n        if\(bf\.odd\)/);
  const h = read("cash-bids.html");
  assert.match(h, /\.bid-posted-old\{color:var\(--gold\);font-weight:600\}/);
  assert.match(h, /cash-bids\.js\?v=17/);
});
