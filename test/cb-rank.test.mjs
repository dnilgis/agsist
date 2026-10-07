/* What /cash-bids may rank, and on what number.
 *
 * The page's own functions are lifted out of cash-bids.html (brace-counted,
 * not copied) and run beside components/cb-rank.js, so a green run means the
 * shipped copy behaves, not a copy of it kept here. Each rule is proved by the
 * case that broke it on the live page.
 *
 *   node --test test/cb-rank.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAGE = readFileSync(ROOT + "cash-bids.html", "utf8");
const RANK = readFileSync(ROOT + "components/cb-rank.js", "utf8");

function liftFn(name) {
  const i = PAGE.indexOf("function " + name + "(");
  assert.ok(i >= 0, `cash-bids.html no longer defines ${name}()`);
  let d = 0, j = PAGE.indexOf("{", i);
  for (; j < PAGE.length; j++) {
    const c = PAGE[j];
    if (c === "{") d++;
    else if (c === "}" && --d === 0) break;
  }
  return PAGE.slice(i, j + 1);
}
function liftVar(name) {
  const m = new RegExp("var " + name + "=[\\s\\S]*?;\\n").exec(PAGE);
  assert.ok(m, `cash-bids.html no longer defines var ${name}`);
  return m[0];
}

const FNS = ["ppu", "plausible", "basisUnit", "basisCents", "basisUnusual", "notPerBushel",
  "isSpecialGrade", "monthFloorKey", "bidPeriodPast", "periodFallbackKey", "deliveryRank",
  "deliverySort", "delKey", "getNearestBid", "preferPlain", "harvestYear", "harvestKeys",
  "isHarvestSeason", "inDelivery", "windowMonths", "netNormOperator", "netPlain", "netKey",
  "netIsTwin", "netMerge", "netOlder", "rankOf", "rankable", "wheatCls", "rankCmp",
  "rankCands", "classGroups", "pickClass", "clsName", "townOf", "placeOf", "bannerName"];
const VARS = ["PPU_BAND", "BASIS_SANE", "NOT_PER_BUSHEL", "SPECIAL_GRADE", "NET_LEGAL", "NET_INHERIT"];

function load() {
  const ctx = { console, Intl, Date, Math, JSON };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(RANK, ctx);
  vm.runInContext("var currentDelivery='all';\n" + VARS.map(liftVar).join("\n") + "\n" +
    FNS.map(liftFn).join("\n"), ctx);
  return ctx;
}

const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const H = 3600e3;
const arr = (a) => JSON.parse(JSON.stringify(a)); /* vm-realm arrays into this realm */
const FAR = "2099";  /* months that cannot have passed, whatever day this runs */

function elev(facility, distance, rows, extra = {}) {
  const e = { key: facility + "|" + distance, facility, city: extra.city || "Town", town: "",
    state: "IA", distance, commodities: {}, ...extra };
  rows.forEach((r) => { (e.commodities[r.category] = e.commodities[r.category] || []).push(r); });
  return e;
}
function row(o) {
  return { category: "soybeans", commodity: "Soybeans", cashPrice: 12.3, basis: -0.65,
    deliveryMonth: "", deliveryPeriod: FAR + "-11", asOf: iso(H), via: "direct", ...o };
}

test("a closed month is never the nearest bid (ZIP 64770, Montrose Sep $12.32)", () => {
  const c = load();
  const gone = row({ cashPrice: 12.32, deliveryPeriod: "2026-09", periodPast: true });
  assert.equal(c.getNearestBid(elev("Montrose", 1, [gone]), "soybeans"), null,
    "an elevator whose only row is a closed month still offers it as its nearest");
  const open = row({ cashPrice: 12.5, deliveryPeriod: FAR + "-11" });
  assert.equal(c.getNearestBid(elev("Montrose", 1, [gone, open]), "soybeans"), open);
});

test("a two-month window is open until its LAST month has gone", () => {
  const c = load();
  const k = c.monthFloorKey(); const [y, m] = k.split("-").map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  assert.equal(c.bidPeriodPast(row({ deliveryPeriod: `${prev}/${k}` })), false,
    "Sep-Oct read as closed in October");
  assert.equal(c.bidPeriodPast(row({ deliveryPeriod: `${prev}/${prev}` })), true);
});

test("Oct-Nov 26 answers October, November and harvest (ZIP 50010 Heartland)", () => {
  const c = load();
  const b = row({ deliveryMonth: "Oct-Nov 26", deliveryPeriod: FAR + "-10/" + FAR + "-11" });
  assert.equal(c.delKey(b), "", "the pair is not one month and delKey must keep saying so");
  c.currentDelivery = FAR + "-10"; assert.equal(c.inDelivery(b), true);
  c.currentDelivery = FAR + "-11"; assert.equal(c.inDelivery(b), true);
  c.currentDelivery = FAR + "-12"; assert.equal(c.inDelivery(b), false);
  const hy = c.harvestYear();
  c.currentDelivery = "harvest";
  assert.equal(c.inDelivery(row({ deliveryPeriod: `${hy}-10/${hy}-11` })), true);
  assert.equal(c.inDelivery(row({ deliveryPeriod: `${hy + 1}-01/${hy + 1}-03` })), false);
  assert.deepEqual(arr(c.cbRank.pairMonths("2026-12/2027-01")), ["2026-12", "2027-01"]);
  assert.deepEqual(arr(c.cbRank.pairMonths("2027-01/2026-12")), [], "a backwards window is not expanded");
});

test("on an equal price the fresh board wins (54728: Meyer Brothers over unread Wheaton)", () => {
  const c = load();
  const wheaton = elev("Wheaton Grain", 29, [row({ stale: true, asOf: iso(3.3 * H) })], { unread: true });
  const meyer = elev("Meyer Brothers Grain", 30, [row({ asOf: iso(H) })]);
  const cands = c.rankCands([wheaton, meyer], "soybeans").sort(c.rankCmp);
  assert.equal(cands[0].elev.facility, "Meyer Brothers Grain");
  assert.equal(cands.length, 2, "an unread board under a day old is still ranked, below a fresh tie");
});

test("an unread board over 24 hours old is not ranked at all", () => {
  const c = load();
  const old = elev("Old", 5, [row({ stale: true, cashPrice: 13.5, asOf: iso(30 * H) })]);
  const fresh = elev("Fresh", 9, [row({ cashPrice: 12.1 })]);
  const cands = c.rankCands([old, fresh], "soybeans");
  assert.deepEqual(arr(cands.map((x) => x.elev.facility)), ["Fresh"]);
});

test("a day-old board is re-marked to a LATER settle, never shown as posted", () => {
  const c = load();
  const today = c.cbRank.centralDay(NOW);
  c.cbRank.setFutures({ quotes: { "beans-nov26": { ticker: "ZSX26.CBT", close: 1295.75, close_date: today },
    "beans-cont": { ticker: "ZS=F", close: 1, close_date: today } } });
  const yday = iso(30 * H);
  const b = row({ asOf: yday, symbol: "", basisMonth: "ZSX26", cashPrice: 12.38, basis: -0.65 });
  const rk = c.cbRank.assess(b, { now: NOW, cash: 12.38, basisC: -65, band: [6, 32] });
  assert.equal(rk.tier, 0);
  assert.equal(rk.price, 12.31, "basis + today's ZSX26");
  assert.equal(rk.posted, 12.38, "the posted price is kept, and printed");
  assert.match(c.cbRank.priceText(rk), /^≈\$12\.31$/, "a re-marked price is printed with ≈");
  assert.match(c.cbRank.note(rk), /today.s futures .* posted .*\$12\.38/);
  /* no settle for that contract: ranked below every same-day row, and flagged */
  const nf = c.cbRank.assess({ ...b, basisMonth: "ZSF27" }, { now: NOW, cash: 12.38, basisC: -65 });
  assert.equal(nf.tier, 1); assert.equal(nf.old, true); assert.equal(nf.price, 12.38);
  assert.match(c.cbRank.note(nf), /not updated for today/);
  /* a same-day board is untouched */
  const sd = c.cbRank.assess({ ...b, asOf: new Date(NOW).toISOString() }, { now: NOW, cash: 12.38, basisC: -65 });
  if (c.cbRank.centralDay(NOW) === today) { assert.equal(sd.remark, null); assert.equal(sd.tier, 0); }
  /* the licensed feed is never re-marked */
  const bc = c.cbRank.assess({ ...b, via: undefined }, { now: NOW, cash: 12.38, basisC: -65 });
  assert.equal(bc.remark, null); assert.equal(bc.tier, 0);
});

test("contract keys: board shorthand, and wheat only when the class is named", () => {
  const { cbRank } = load();
  assert.equal(cbRank.contractKey({ category: "wheat", commodity: "Wheat (Soft Red Winter)", basisMonth: "ZWZ6" }), "ZWZ26");
  assert.equal(cbRank.contractKey({ category: "corn", basisMonth: "Dec 26" }), "ZCZ26");
  assert.equal(cbRank.contractKey({ category: "soybeans", basisMonth: "Nov 26 Soybeans" }), "ZSX26");
  assert.equal(cbRank.contractKey({ category: "wheat", commodity: "WHEAT HRW", basisMonth: "Dec 26" }), "KEZ26");
  assert.equal(cbRank.contractKey({ category: "wheat", commodity: "Wheat", basisMonth: "Dec 26" }), "",
    "Dec wheat with no class is two different contracts");
  assert.equal(cbRank.contractKey({ category: "corn", basisMonth: "ZSX26" }), "", "corn against a bean contract");
});

test("wheat classes match the basis map's rules, label for label", () => {
  const { cbRank } = load();
  const labels = ["WHEAT HRW", "Wheat (Soft Red Winter)", "Wheat", "HRWW", "Hard Red Spring",
    "Soft White Wheat", "Soft 10.5% White", "Durum", "Hard White Wheat", "KC Wheat", "SRW Wheat",
    "WHEAT (SOFT)", "Dark Northern Spring", "Club wheat", "hard red winter wheat"];
  const py = execFileSync("python3", ["-I", "-c",
    "import sys,json;sys.path.insert(0,sys.argv[1]);import importlib.util as u;" +
    "s=u.spec_from_file_location('m',sys.argv[1]+'/build_basis_map.py');m=u.module_from_spec(s);s.loader.exec_module(m);" +
    "print(json.dumps([m.wheat_class(x) for x in json.loads(sys.argv[2])]))",
    ROOT + "scripts", JSON.stringify(labels)], { encoding: "utf8" });
  const want = JSON.parse(py.trim().split("\n").pop()).map((x) =>
    x == null ? "" : x.replace(/^wheat-/, ""));
  assert.deepEqual(arr(labels.map(cbRank.wheatClass)), want);
});

test("HRW and SRW are never ranked against each other (CoMark McCune KS vs ADM Carthage MO)", () => {
  const c = load();
  const w = (o) => row({ category: "wheat", ...o });
  const comark = elev("CoMark Equity Alliance LLC", 0, [w({ commodity: "WHEAT HRW", cashPrice: 6.54, basis: -0.85 })]);
  const adm = elev("ADM", 41, [w({ commodity: "Wheat (Soft Red Winter)", cashPrice: 6.865, basis: 0 })]);
  const farm = elev("Farmers Coop Columbus", 15, [w({ commodity: "WHEAT HRW", cashPrice: 6.54, basis: -0.85 })]);
  const g = c.classGroups(c.rankCands([comark, adm, farm], "wheat"));
  assert.deepEqual(arr(Object.keys(g).sort()), ["hrw", "srw"]);
  assert.equal(c.pickClass(g), "hrw", "the class most elevators here post");
  assert.ok(g.hrw.every((x) => x.elev.facility !== "ADM"));
});

test("a delivery-point label gets its town only where the network knows it", () => {
  const c = load();
  c.cbRank.learnTowns({ places: [
    { zip: "50313", city: "ADM DSM" }, { zip: "50313", city: "Des Moines" },
    { zip: "52404", city: "Cedar Rapids" }, { zip: "52404", city: "Marion" }] });
  const e = elev("Mid-Iowa Cooperative", 28, [row({ zip: "50313" })], { city: "ADM DSM" });
  assert.equal(c.bannerName(e), "Mid-Iowa Cooperative — Des Moines (28 mi)");
  const amb = elev("X", 3, [row({ zip: "52404" })], { city: "ADM CR" });
  assert.equal(c.placeOf(amb), "ADM CR", "two towns in one ZIP is a guess, so the label stays");
  const plain = elev("Y", 3, [row({})], { city: "Ames" });
  assert.equal(c.placeOf(plain), "Ames");
});

test("the second feed's row is kept when ours is unread or a day older", () => {
  const c = load();
  const bc = { facility: "Wheaton Grain", city: "Chippewa Falls", state: "WI", category: "soybeans",
    cashPrice: 12.4, deliveryMonth: "Oct26", asOf: new Date(NOW).toISOString() };
  const oursStale = { ...bc, cashPrice: 12.3, stale: true, via: "direct", asOf: iso(3 * H) };
  let m = c.netMerge([bc], [oursStale]);
  assert.deepEqual(arr(m.rows.map((r) => r.cashPrice)), [12.4], "the unread row beat a fresh copy");
  assert.equal(m.duplicatesResolved, 0);
  const oursFresh = { ...oursStale, stale: false, asOf: new Date(NOW).toISOString() };
  m = c.netMerge([bc], [oursFresh]);
  assert.deepEqual(arr(m.rows.map((r) => r.cashPrice)), [12.3], "ours, read today, must still win");
  assert.equal(m.duplicatesResolved, 1);
  /* the twin path: "ADM" (ours) vs "ADM Grain" (feed), same town, month and cent */
  const feedTwin = { facility: "ADM Grain", city: "Mankato", state: "MN", category: "corn", cashPrice: 4.5,
    deliveryMonth: "Oct26", asOf: new Date(NOW).toISOString() };
  const ourTwin = { ...feedTwin, facility: "ADM", stale: true, via: "direct" };
  m = c.netMerge([feedTwin], [ourTwin]);
  assert.deepEqual(arr(m.rows.map((r) => r.facility)), ["ADM Grain"]);
});
