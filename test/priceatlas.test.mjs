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

test("P4: /markets board age is its oldest settle", async () => {
  const P = (await import(ROOT + "components/price-local.js")).default;
  const now = new Date("2026-10-22T15:00:00Z"); // Thursday
  const s = (d) => ({ close: 1, close_kind: "settle", close_date: d });
  const a = P.boardAge({ corn: s("2026-10-21"), milk: s("2026-10-14") }, null, now);
  assert.equal(a.oldest, "2026-10-14");
  assert.equal(a.newest, "2026-10-21");
  assert.equal(a.stale, true);
  assert.equal(a.old, true); // Oct 15, 16, 19, 20, 21 missing
  assert.equal(P.boardAge({ corn: s("2026-10-21"), beans: s("2026-10-21") }, null, now).stale, false);
  assert.match(read("markets.html"), /'oldest settle '\+ba\.oldestLabel/);
});

test("P5: cattle page reads feeders-nearby and labels the range by its contract", () => {
  const h = read("cattle-futures-prices.html");
  const code = h.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /feeders-oct26/);
  assert.match(code, /nGF=q\['feeders-nearby'\]/);
  assert.match(code, /'52-Week Range \\u00b7 '\+nGF\.contract\+' contract'/);
});

/* ---- Farmland Atlas details: the real cases, on the built pages ---- */
/* One share rule on every copy (v38 item 1, Oct 20): acres over cropland, printed once, "under 1%" when it
   rounds to 0. Barron WI 55005: 55,953 no-till acres of 183,541 cropland is 30.49%; the stored share is 0.305. */
function fnSrc(src, re) { const m = src.match(re); assert.ok(m, "missing " + re); return m[0]; }
function shareWordsOf(path) {
  const s = read(path);
  const helpers = path === "farmland-atlas/compare.html"
    ? fnSrc(s, /function n\(x,k\)\{[^\n]*\}/) + "\n" + fnSrc(s, /var shareWords=function\(s\)\{[^\n]*\};/)
    : fnSrc(s, /function fmt\(x,k\)\{[^\n]*\}/) + "\n" + fnSrc(s, /function pct\(x,k\)\{[^\n]*\}/) + "\n" + fnSrc(s, /function shareWords\(s\)\{[^\n]*\}/);
  return vm.runInNewContext(helpers + "\nshareWords;", {});
}
test("A1: sheet, panel and compare print the share of cropland from acres, once", () => {
  const barron = JSON.parse(read("data/atlas/counties/55005.json"));
  const nt = barron.practices.notill;
  assert.equal(nt.share, 0.305);   // the stored share that read 31%
  const raw = nt.acres / barron.practices.cropland;
  for (const p of ["farmland-atlas/sheet.html", "farmland-atlas.html", "farmland-atlas/compare.html"]) {
    const sw = shareWordsOf(p);
    assert.equal(sw(raw), "30%", p);
    assert.equal(sw(0.002), "under 1%", p);
    assert.equal(sw(0), "0%", p);
  }
  // each copy feeds it acres over cropland, never the rounded share
  const sheet = read("farmland-atlas/sheet.html"), panel = read("farmland-atlas.html"), cmp = read("farmland-atlas/compare.html");
  assert.match(sheet, /var s0=x\.acres!=null&&Pr\.cropland\?x\.acres\/Pr\.cropland:x\.share; Rt\+=fct\(label, shareWords\(s0\)\+' of cropland'/);
  assert.match(panel, /function pracShare\(Pr,x\)\{ return x\.acres!=null&&Pr\.cropland\?x\.acres\/Pr\.cropland:x\.share; \}/);
  assert.match(panel, /f\+=fact\(label, shareWords\(pracShare\(Pr,x\)\)\+' of cropland'/);
  for (const t of [sheet, panel]) assert.doesNotMatch(t, /pct\(x\.share,0\)/);
  assert.match(cmp, /r\.notill_share_2022==null\?null:shareWords\(r\.notill_share_2022\)/);
  assert.match(cmp, /r\.tile_share_2022==null\?null:shareWords\(r\.tile_share_2022\)/);
  // compare and the map read the build's columns: those carry acres over cropland, not the 3-place share
  const cj = JSON.parse(read("farmland-atlas/data/counties.json"));
  const row = cj.rows.find((r) => r[0] === "55005");
  const v = row[cj.columns.indexOf("notill_share_2022")];
  assert.equal(shareWordsOf("farmland-atlas/compare.html")(v), "30%");
  const atlas = JSON.parse(read("data/atlas/atlas.json"));
  assert.equal(shareWordsOf("farmland-atlas.html")(atlas.counties["55005"].practices.notill), "30%");
  assert.match(read("farmland-atlas/wisconsin/barron-county.html"), /Farmed no-till, 2022<\/span><span class="r">30% of cropland/);
});

test("A8: worst loss year is picked on raw claims over premium, and a year that prints the same ratio is named", () => {
  // Butler NE 31023: 2002 (2.3077) and 2023 (2.3121) both print 2.31; 2023 is the worst
  const c = JSON.parse(read("data/atlas/counties/31023.json"));
  assert.deepEqual(c.sob.worst_year, { year: 2023, ratio: 2.31, tied: [2002] });
  const py = c.sob.per_year;
  assert.ok(py["2023"].indem / py["2023"].prem > py["2002"].indem / py["2002"].prem);
  assert.match(read("farmland-atlas/nebraska/butler-county.html"), /Worst year<\/span><span class="r">2023<small>ratio 2\.31 \(2002 also 2\.31\),/);
  for (const [f, y] of [["21213", 2012], ["22009", 2008], ["39057", 2012], ["01005", 2024]])
    assert.equal(JSON.parse(read("data/atlas/counties/" + f + ".json")).sob.worst_year.year, y, f);
  assert.match(read("farmland-atlas.html"), /S\.worst_year\.tied&&S\.worst_year\.tied\.length\?' \('\+S\.worst_year\.tied\.join\(', '\)\+' also '/);
  assert.match(read("farmland-atlas/sheet.html"), /S\.worst_year\.tied&&S\.worst_year\.tied\.length\?' \('\+S\.worst_year\.tied\.join\(', '\)\+' also '/);
});

test("A9: a nonzero irrigated or CRP-expiring share says under 1%; a cause with no dollars is not listed", () => {
  // Benewah ID 16009 (stored 0.001) and Lewis ID 16061 (0.002) printed 0%
  for (const p of ["farmland-atlas/idaho/benewah-county.html", "farmland-atlas/idaho/lewis-county.html"])
    assert.match(read(p), /Harvested cropland irrigated, 2022<\/span><span class="r">under 1%/, p);
  // Oneida ID 38 ac, Weld CO 1,155 ac expiring printed 0% of enrolled acres
  assert.match(read("farmland-atlas/idaho/oneida-county.html"), />38 ac<small>under 1% of enrolled acres/);
  assert.match(read("farmland-atlas/colorado/weld-county.html"), />1,155 ac<small>under 1% of enrolled acres/);
  // San Mateo CA 06081: share_all has wet 0.0; it listed "excess moisture 0%"
  assert.equal(JSON.parse(read("data/atlas/counties/06081.json")).loss.share_all.wet, 0);
  assert.match(read("farmland-atlas/california/san-mateo-county.html"), /Largest causes of loss, 2020–2024<\/span><span class="r">other 64% · heat and drought 36%</);
  const panel = read("farmland-atlas.html");
  assert.match(panel, /f\+=fact\('Harvested cropland irrigated, 2022', shareWords\(irrShareOf\(sh\)\)/);
  assert.match(panel, /filter\(function\(k\)\{return Lo\.share_all\[k\]>0;\}\)/);
  assert.match(panel, /return ce==null\?'':shareWords\(ce\)\+' of what is enrolled'/);
  assert.match(read("farmland-atlas/sheet.html"), /Rt\+=fct\('Harvested cropland irrigated, 2022', shareWords\(sh\.irrigated_acres!=null&&sh\.harvested_acres\?sh\.irrigated_acres\/sh\.harvested_acres:sh\.share\)\)/);
});

test("A2: Fresno counts 2021 ($71.9M paid on $71.6M premium) as a year over 1.00", () => {
  const c = JSON.parse(read("data/atlas/counties/06019.json"));
  assert.equal(c.sob.years_over_one, 11);
  assert.match(read("farmland-atlas/california/fresno-county.html"), />11 of 37</);
});

test("A3: tied worst drought years are named", () => {
  const c = JSON.parse(read("data/atlas/counties/06019.json"));
  assert.deepEqual(c.drought.worst_year.tied, [2014, 2015, 2022]);
  assert.match(read("farmland-atlas/california/fresno-county.html"), /2016 \(tied with 2014, 2015, 2022\)<small>52 weeks/);
  assert.match(read("components/drought-county.js"), /'Worst year: '\+wy\.year\+', '\+wy\.d2\+' weeks'\+\(wy\.tied/);
  assert.match(read("farmland-atlas/sheet.html"), /' \(tied with '\+Dr\.worst_year\.tied\.join/);
});

test("A4: a withheld yield gives the yield's own reason on the key card", () => {
  assert.match(read("farmland-atlas/arizona/cochise-county.html"), /<div class="t">Corn yield<\/div><div class="v"><small>n\/a<\/small><\/div><div class="s">fewer than 8 published county corn yields<\/div>/);
});

test("A5: a nonzero drought count that rounds to 0% says under 1%", () => {
  const h = read("farmland-atlas/alaska/anchorage-municipality.html");
  assert.match(h, /under 1% of weeks/);
  assert.doesNotMatch(h, />0% of weeks/);
  assert.match(read("farmland-atlas/sheet.html"), /wk\.d2>0&&t==='0'\?'under 1%'/);
});

test("A6: the sheet's rank sentence is the county page's", () => {
  const sent = "Rent ranks count every county with a published rent in the same survey year, within the state (the same counties as the state rent page); other ranks count counties with 10,000 acres or more in farms.";
  assert.ok(read("farmland-atlas/wisconsin/barron-county.html").includes(sent));
  assert.ok(read("farmland-atlas/sheet.html").includes(sent));
});

test("A7: rent-to-value always has two decimals", () => {
  assert.match(read("farmland-atlas/alabama/escambia-county.html"), /census value, 2022<\/span><span class="r">2\.90%/);
  const s = read("farmland-atlas/sheet.html");
  assert.equal((s.match(/rh\(V\.rent_to_value\.pct,2\)\+'%'/g) || []).length, 2);
  assert.doesNotMatch(s, /fmt\(V\.rent_to_value\.pct,2\)/);
});
