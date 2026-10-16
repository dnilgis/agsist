/* /crop-tour after tour week (Oct 15 review): the stamp under the H1 is the
 * newest date on the page, not the tour's Aug 21 while the hero quotes USDA's
 * October number; the sources line names the years the record runs; and once
 * USDA has a newer number the hero says where the tour's miss would rank if
 * that number holds. The baker's --selftest checks the arithmetic. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const html = readFileSync(join(ROOT, "crop-tour.html"), "utf8");
const data = JSON.parse(readFileSync(join(ROOT, "data/crop-tour.json"), "utf8"));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pretty = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };

test("crop tour stamp is never older than the USDA date the hero quotes", () => {
  const stamp = html.match(/<!-- CT:stamp -->(.*?)<!-- \/CT:stamp -->/)[1];
  assert.ok(!/Record updated/.test(stamp), stamp);
  const kick = html.match(/USDA now [\d.]+ \((\w{3}) (\d+)\)/);
  if (kick) {
    const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(kick[1]);
    const stampDate = new Date(stamp.match(/Updated (\w+ \d+, \d{4})/)[1]);
    assert.ok(stampDate.getMonth() > m || (stampDate.getMonth() === m && stampDate.getDate() >= +kick[2]), stamp + " vs " + kick[0]);
    assert.match(html, /If USDA's [\d.]+ holds to January, the tour's [\d.]+ (low|high) would be its [\w-]*biggest (low|high) miss since \d{4}/);
  }
  assert.ok(!/Record updated August 21/.test(html));
  assert.ok(stamp.startsWith("Updated " + pretty(data.updated)) || /Updated \w+ \d+, \d{4}/.test(stamp));
});

test("the Pro Farmer source names the years the record table runs", () => {
  const yrs = data.history.filter((h) => h.tour_corn != null && h.usda_final_corn != null && h.usda_aug_corn != null).map((h) => h.year);
  assert.ok(html.includes(`Pro Farmer national estimates (${yrs[0]}-${yrs[yrs.length - 1]})`));
});

/* Oct 16 benchmark CT2: in October the four night cards (Aug 17-20) made the
 * phone page 8,955 px tall. A week after the tour they fold into one table
 * inside a closed <details>, one row per state slot, same figures. */
test("after tour week the night cards fold into one table", () => {
  const end = new Date(data.tour.end + "T12:00:00Z");
  const baked = html.match(/<div class="ct-flow" data-phase="(\w+)"/)[1];
  if (!(baked === "scored" || baked === "stale")) return; // tour week: cards are right
  const nights = html.slice(html.indexOf("<!-- CT:nights -->"), html.indexOf("<!-- /CT:nights -->"));
  if (Date.now() - end.getTime() < 7 * 86400e3) return;
  assert.ok(!/class="ct-night/.test(nights), "no night cards left");
  assert.match(nights, /<details class="ct-soytbl ct-nfold"><summary>Each state, /);
  const tbl = nights.match(/<table class="ct-ntbl">([\s\S]*?)<\/table>/)[1];
  const slots = data.nights.flatMap((n) => n.states);
  assert.equal((tbl.match(/<tr><td>/g) || []).length, slots.length, "one row per state slot");
  for (const s of slots) {
    if (s.corn == null) continue;
    const prior = (data.state_history[s.code] || []).slice(-1)[0];
    assert.ok(tbl.includes(`<td class="num">${s.corn.toFixed(1)}</td>`), `${s.code} corn`);
    if (prior) assert.ok(tbl.includes(`<td class="num">${(s.corn - prior.corn >= 0 ? "+" : "") + (s.corn - prior.corn).toFixed(1)}</td>`), `${s.code} change`);
  }
  assert.ok(!/posts at the end of the week/.test(nights), "no tour-week promise in October");
  assert.ok(nights.includes("districts only, not a state figure"), "western Iowa is not passed off as a state");
});
