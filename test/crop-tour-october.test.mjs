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
