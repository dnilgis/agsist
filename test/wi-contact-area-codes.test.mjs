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

/* Out-of-state area codes still on Wisconsin rows, unverified. Oct 27 2026:
 * none left. Cushing Cooperative's own cash-bid page gives 715-648-5215 (the
 * 918 number was Oklahoma); the Innovative Ag Services Prairie du Chien (319)
 * and Pilgrim's Arcadia (320) numbers could not be confirmed as the local line
 * and are withheld. All three are in data/phone-corrections.json with the page
 * each was read from. */
const SUSPECTS = {};

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

test("Cushing Cooperative carries the number on its own bid page; the two unconfirmed numbers are withheld", () => {
  const fix = json("data/phone-corrections.json").rows;
  const by = Object.fromEntries(fix.map((r) => [r.town, r]));
  assert.equal(by["Cushing"].phone, "715-648-5215");
  assert.equal(by["Cushing"].source, "https://cushingcoop.com/");
  assert.equal(by["Prairie Du Chien"].phone, null);
  assert.equal(by["Arcadia"].phone, null);
  for (const r of fix) {
    assert.match(r.source, /^https:\/\//, "every correction names the page it was read from");
    assert.match(r.read, /^\d{4}-\d\d-\d\d$/, "and the date");
    assert.ok(r.why && !/\u2014/.test(r.why), "and why, with no em dash");
  }
  const wi = json("data/elevator-contacts/WI.json").rows;
  const row = (op, town) => wi.filter((r) => r[0] === op && r[1] === town);
  assert.deepEqual(row("Cushing Cooperative", "Cushing").map((r) => r[2]), ["715-648-5215"]);
  assert.ok(row("Innovative Ag Services", "Prairie Du Chien").every((r) => r[2] === ""), "no Prairie du Chien phone");
  assert.ok(row("Pilgrims Gold N Plump", "Arcadia").every((r) => r[2] === ""), "no Arcadia phone");
  const flat = JSON.stringify(wi);
  assert.doesNotMatch(flat, /225-6559|465-6896|202-7451/);
});
