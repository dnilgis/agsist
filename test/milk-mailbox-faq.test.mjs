// 2026-10-17 audit N6: the milk FAQ (visible and FAQPage JSON-LD) said "In March
// 2026 ... $18.84" under a June 2026 $20.18 card. The FAQ sentence is now a seed
// (scripts/seed_static.py milk_mailbox_seeds, milkmbfaq) from data/dairy-mailbox.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const page = readFileSync(new URL("milk-prices.html", ROOT), "utf8");
const mb = JSON.parse(readFileSync(new URL("data/dairy-mailbox.json", ROOT), "utf8"));
const MONL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

test("the FAQ mailbox sentence is a seed, not typed", () => {
  assert.match(page, /<!--SEED:milkmbfaq-->In [A-Z][a-z]+ \d{4} the federal-order mailbox average was \$\d+\.\d\d per hundredweight[^<]*<!--\/SEED-->/);
  assert.match(readFileSync(new URL("scripts/seed_static.py", ROOT), "utf8"), /"milkmbfaq": faq/);
});

test("every mailbox figure on the page, JSON-LD included, is the newest month in the file", () => {
  const [y, m] = mb.month_key.split("-").map(Number);
  const want = `In ${MONL[m - 1]} ${y} the federal-order mailbox average was $${mb.value.toFixed(2)}`;
  const all = page.match(/In [A-Z][a-z]+ \d{4} the federal-order mailbox average was \$\d+\.\d\d/g) || [];
  assert.ok(all.length >= 3, "card row, FAQ and FAQPage copy: " + all.length);
  for (const s of all) assert.equal(s, want);
});
