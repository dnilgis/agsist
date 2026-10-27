/* A WISCONSIN ELEVATOR WITH AN IOWA PHONE NUMBER.
 *
 * Oct 24 2026: the Cadott town page said "call to confirm (712-289-4056)". 712
 * is western Iowa. The row came in with the Barchart directory. Cadott Grain's
 * own site lists the grain line 715-289-4366 and the scale 715-289-4056, and
 * Sig's Aug 20 elevator list has 715-289-4366. A bid page asks the reader to
 * call about a bid, so it gets the grain line.
 *
 * Every other Wisconsin row whose area code is not a Wisconsin one is named
 * below with what we know. They are NOT changed: none is verified against the
 * company's own site yet. A new one fails this test until someone looks.
 *
 *   node --test test/wi-contact-area-codes.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const json = (p) => JSON.parse(readFileSync(ROOT + p, "utf8"));
const digits = (p) => { const d = String(p ?? "").replace(/\D/g, ""); return d.length === 11 && d[0] === "1" ? d.slice(1) : d; };

const WI_CODES = new Set(["262", "274", "353", "414", "534", "608", "715", "920"]);
const TOLL_FREE = new Set(["800", "833", "844", "855", "866", "877", "888"]);

/* Out-of-state area codes still on Wisconsin rows, unverified (Oct 27 2026). */
const SUSPECTS = {
  "Cushing Cooperative|Cushing": "918 is Oklahoma, where there is also a Cushing; may be the wrong co-op on a WI row",
  "Innovative Ag Services|Prairie Du Chien": "319 is eastern Iowa, where the company is based; may be a head office line",
  "Pilgrims Gold N Plump|Arcadia": "320 is central Minnesota, where the company is based; may be a head office line",
};

test("Cadott Grain carries its own grain line everywhere a reader sees it", () => {
  const wi = json("data/elevator-contacts/WI.json");
  const row = wi.rows.find((r) => r[1] === "Cadott" && /Cadott Grain/.test(r[0]));
  assert.ok(row, "Cadott Grain is in the Wisconsin contacts");
  assert.equal(row[2], "715-289-4366");
  const dir = json("data/elevator-directory.json").elevators
    .filter((e) => e.state === "WI" && e.city === "Cadott" && /Cadott Grain/.test(e.company ?? ""));
  assert.equal(dir.length, 1);
  assert.equal(dir[0].phone, "715-289-4366");
  const page = readFileSync(ROOT + "cash-bids/wisconsin/cadott.html", "utf8");
  assert.doesNotMatch(page, /712-?289-?4056|17122894056/, "the Iowa number is gone from the town page");
  assert.match(page, /tel:\+17152894366/);
});

test("every other out-of-state area code on a Wisconsin row is named, with why", () => {
  const found = {};
  for (const [op, town, phone] of json("data/elevator-contacts/WI.json").rows) {
    const d = digits(phone);
    if (d.length !== 10) continue;
    const ac = d.slice(0, 3);
    if (WI_CODES.has(ac) || TOLL_FREE.has(ac)) continue;
    found[`${op}|${town}`] = ac;
  }
  assert.deepEqual(Object.keys(found).sort(), Object.keys(SUSPECTS).sort(),
    `out-of-state area codes on WI rows: ${JSON.stringify(found)}. Check the company's own site, ` +
    `fix the verified ones in data/elevator-directory.json, and name the rest here.`);
});
