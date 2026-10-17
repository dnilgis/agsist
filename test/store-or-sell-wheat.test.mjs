/* /store-or-sell wheat carry: which futures (2026-10-16 audit).
 *
 * The board carry for wheat was always Chicago SRW. Now the nearest wheat
 * bids that name a class or contract decide: KC (KE) -> the KC HRW spread,
 * Minneapolis (MW) -> no board number (AGSIST has no Minneapolis quotes),
 * otherwise "Chicago SRW spread", said in those words.
 *
 *   node --test test/store-or-sell-wheat.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const ctx = { window: {}, console };
ctx.window.window = ctx.window;
vm.createContext(ctx);
// storesell.js loads its pure core only when there is no document
vm.runInContext("var window=this.window;" + read("components/storesell.js"), ctx);
ctx.document = { readyState: "loading", addEventListener() {} };
vm.runInContext(read("components/store-or-sell.js"), ctx);
const SOS = ctx.window.AgsistStoreOrSell;
const NOW = "2026-10-16";

// KC and Chicago closes on Oct 16, 2026 (cents). Window: Dec '26 to May '27.
const Q = {
  "wheat-dec26": { ticker: "ZWZ26.CBT", close: 658.25, close_date: NOW },
  "wheat-mar27": { ticker: "ZWH27.CBT", close: 676.0, close_date: NOW },
  "wheat-may27": { ticker: "ZWK27.CBT", close: 686.5, close_date: NOW },
  "kcwheat-dec26": { ticker: "KEZ26.CBT", close: 701.5, close_date: NOW },
  "kcwheat-mar27": { ticker: "KEH27.CBT", close: 715.25, close_date: NOW },
  "kcwheat-may27": { ticker: "KEK27.CBT", close: 722.0, close_date: NOW },
};

test("the nearest wheat bid that names its futures decides", () => {
  assert.equal(SOS.wheatExch([{ commodity: "Wheat" }, { commodity: "HRW Wheat" }]), "KE", "first row says nothing, second is HRW");
  assert.equal(SOS.wheatExch([{ commodity: "Wheat", symbol: "KEZ26" }]), "KE");
  assert.equal(SOS.wheatExch([{ commodity: "Wheat", basisMonth: "Dec 26 KCBT Red Wheat" }]), "KE");
  assert.equal(SOS.wheatExch([{ commodity: "Spring Wheat" }, { commodity: "HRW" }]), "MW");
  assert.equal(SOS.wheatExch([{ commodity: "DNS 14%", symbol: "MWZ26" }]), "MW");
  assert.equal(SOS.wheatExch([{ commodity: "SRW Wheat" }, { commodity: "HRW" }]), "ZW", "nearest says Chicago");
  assert.equal(SOS.wheatExch([{ commodity: "Wheat" }]), "", "no class named");
  assert.equal(SOS.wheatExch([]), "");
});

test("KC bids: the KC HRW spread, by hand", () => {
  const fm = SOS.futuresModel({ quotes: Q }, "wheat", "KE");
  assert.equal(fm.wheat, "KE");
  assert.equal(fm.from.label, "Dec '26");
  assert.equal(fm.to.label, "May '27");
  // 722.00 - 701.50 = 20.5 cents
  assert.ok(Math.abs(fm.carry - 0.205) < 1e-9, String(fm.carry));
  assert.ok(Math.abs(fm.spot - 7.015) < 1e-9, String(fm.spot));
});

test("no named class: the Chicago SRW spread, labeled", () => {
  const fm = SOS.futuresModel({ quotes: Q }, "wheat", "");
  assert.equal(fm.wheat, "ZW");
  // 686.50 - 658.25 = 28.25 cents
  assert.ok(Math.abs(fm.carry - 0.2825) < 1e-9, String(fm.carry));
  assert.equal(SOS.futuresModel({ quotes: Q }, "wheat", "ZW").wheat, "ZW");
});

test("Minneapolis bids: no board number rather than a Chicago one", () => {
  assert.equal(SOS.futuresModel({ quotes: Q }, "wheat", "MW"), null);
  const js = read("components/store-or-sell.js");
  assert.match(js, /AGSIST has no Minneapolis quotes, so there is no board carry to show/);
  assert.match(js, /Chicago SRW spread/);
  assert.ok(!/—/.test(js.match(/var MW_TEXT = '[^']*'/)[0]), "no em dash in the copy");
});

test("corn and soybeans are untouched", () => {
  const corn = { "corn-dec26": { ticker: "ZCZ26.CBT", close: 478.75, close_date: NOW }, "corn-jul27": { ticker: "ZCN27.CBT", close: 505.75, close_date: NOW } };
  const fm = SOS.futuresModel({ quotes: corn }, "corn", "KE");
  assert.ok(fm && !fm.wheat && Math.abs(fm.carry - 0.27) < 1e-9);
});

test("the page loads the new store-or-sell.js", () => {
  assert.match(read("store-or-sell.html"), /components\/store-or-sell\.js\?v=7/);
});
