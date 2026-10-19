/* Price labels and Atlas details (Oct 19, 2026 audit, helper P).
 *
 *   node --test test/priceatlas.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const fx = (p) => JSON.parse(read("test/fixtures/priceatlas/" + p));

/* The badge function from components/home-yield.js, run with a fixed clock. */
function badge(data, nowIso) {
  const src = read("components/home-yield.js");
  const body = src.match(/var _st=(\(function\(iso\)\{[\s\S]*?\}\)\(data\.fetched\));/)[1];
  const RD = Date;
  const D = class extends RD { constructor(...a) { super(...(a.length ? a : [nowIso])); } static now() { return new RD(nowIso).getTime(); } };
  D.UTC = RD.UTC; D.parse = RD.parse;
  return vm.runInNewContext(body, { data, Date: D, Intl });
}

test("P1: Sunday 7:31 PM CT file of Oct 16 settles says Settle, not Delayed", () => {
  const d = fx("prices-sun-oct18.json");
  const b = badge(d, "2026-10-19T00:40:00Z");
  assert.equal(b.t, "Settle Oct 16");
  assert.equal(b.live, false);
});

test("P1: a last trade read in the day session still says Delayed", () => {
  const d = fx("prices-sun-oct18.json");
  d.fetched = "2026-10-19T15:00:00Z"; // Monday 10:00 AM CT
  d.quotes["corn-nearby"] = { close: 470, close_kind: "last", close_date: "2026-10-19" };
  assert.equal(badge(d, "2026-10-19T15:10:00Z").t, "Delayed 15 min");
  // an evening file holding the day's last trade is not a live quote
  d.fetched = "2026-10-20T00:31:00Z";
  d.quotes["corn-nearby"] = { close: 470, close_kind: "last", close_date: "2026-10-19", settled: true };
  assert.notEqual(badge(d, "2026-10-20T00:40:00Z").t, "Delayed 15 min");
});

const py = (code) => execFileSync("python3", ["-c", code], { cwd: ROOT + "scripts", encoding: "utf8" }).trim();

test("P2: cattle change below one tick reads unch (page and seed agree)", () => {
  const h = read("cattle-futures-prices.html");
  const src = h.match(/function chgCwt\(q\)\{[\s\S]*?\n  \}/)[0];
  const ctx = { AG: { px: { cash: (v, o) => py("import pricefmt; print(pricefmt.cash(" + v + ", dollar=False))") } } };
  vm.runInNewContext("function cwtN(v){return AG.px.cash(Math.abs(v),{dollar:false});}\n" + src + "\nthis.f=chgCwt;", ctx);
  const cases = [
    { netChange: 0, pctChange: 0 },
    { netChange: 0.004, pctChange: 0.0017 },
    { netChange: -0.0001, pctChange: -0.00004 },
    { netChange: 0.125, pctChange: 0.04 },
    { netChange: -1.6, pctChange: -0.7 },
  ];
  for (const q of cases) {
    const js = [...ctx.f(q)];
    const fromPy = JSON.parse(py("import json, seed_static as s; print(json.dumps(s._cwt_chg(" + JSON.stringify(q).replace(/"/g, "'") + ")))"));
    assert.deepEqual(js, fromPy, JSON.stringify(q));
  }
  assert.deepEqual([...ctx.f(cases[0])], ["unch", "nc"]);
  assert.deepEqual([...ctx.f(cases[1])], ["unch", "nc"]);
  assert.equal(ctx.f(cases[4])[1], "dn");
});

test("P3: homepage rows name a date or kind that differs from the badge", () => {
  const src = read("components/home.js");
  const fn = src.match(/var MN3=[\s\S]*?\nfunction dtNote\(k,q\)\{[\s\S]*?\n\}/)[0];
  const d = fx("prices-sun-oct18.json");
  const ctx = { D: d };
  vm.runInNewContext(fn + "\nthis.f=dtNote;", ctx);
  const q = d.quotes;
  assert.equal(ctx.f("cattle", q["cattle-nearby"]), "");
  assert.equal(ctx.f("crude", q.crude), "Last trade Oct 16");
  assert.equal(ctx.f("gold", q.gold), "Last trade Oct 16");
  assert.equal(ctx.f("dollar", q.dollar), "As of Oct 18");
  assert.equal(ctx.f("bitcoin", q.bitcoin), "As of Oct 19");
  assert.equal(ctx.f("feeders", { ...q["feeders-nearby"], stale: true }), "Oct 16 settle, not updated this run");
  d.stale_keys = ["cattle"];
  assert.equal(ctx.f("cattle", q["cattle-nearby"]), "Oct 16 settle, not updated this run");
  // in session: crude is a last trade like corn, same day, no note
  d.stale_keys = [];
  q["corn-nearby"] = { close: 470, close_kind: "last", close_date: "2026-10-19" };
  assert.equal(ctx.f("crude", { ...q.crude, close_date: "2026-10-19" }), "");
  assert.equal(ctx.f("cattle", q["cattle-nearby"]), "Oct 16 settle");
});
