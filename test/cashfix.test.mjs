/* Fixes from the Oct 16, 2026 harvest audit on /cash-bids and its town pages.
 * Each test is the case the audit found, run against the shipped files.
 *
 *   node --test test/cashfix.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const JS = read("components/cash-bids.js");
const HTML = read("cash-bids.html");

function liftFn(src, name) {
  const i = src.indexOf("function " + name + "(");
  assert.ok(i >= 0, `no function ${name}()`);
  let d = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === "{") d++;
    else if (c === "}" && --d === 0) break;
  }
  return src.slice(i, j + 1);
}
function liftPy(src, name) {
  const i = src.indexOf("\ndef " + name + "(");
  assert.ok(i >= 0, `no def ${name}()`);
  const j = src.indexOf("\n\n\n", i + 1);
  return src.slice(i, j < 0 ? undefined : j);
}
function liftVar(src, name) {
  const m = new RegExp("var " + name + "=[\\s\\S]*?;\\n").exec(src);
  assert.ok(m, `no var ${name}`);
  return m[0];
}

test("Worth the Drive charges fuel on estimated road miles (audit example: +$5 straight, -$21 by road)", () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(liftVar(JS, "ROAD_FACTOR") + liftFn(JS, "roadMi") + ";var ROAD_NOTE_SRC=" +
    JSON.stringify(liftVar(JS, "ROAD_NOTE")), ctx);
  assert.equal(ctx.ROAD_FACTOR, 1.25);
  /* 30 extra straight-line miles for 11c more on 1,000 bu at $1.75 a mile */
  const straight = 0.11 * 1000 - 2 * 30 * 1.75;
  const road = 0.11 * 1000 - 2 * ctx.roadMi(30) * 1.75;
  assert.equal(Math.round(straight), 5);
  assert.equal(Math.round(road), -21);
  assert.match(ctx.ROAD_NOTE_SRC, /estimated road miles \(straight line x 1\.25\)/);
  /* the table, the banner and the earnings line all charge fuel on roadMi */
  const wtd = liftFn(JS, "renderWTD"), earn = liftFn(JS, "renderEarnings");
  assert.match(wtd, /var rd=roadMi\(d\)/);
  assert.match(wtd, /fuel:2\*rd\*fpm/);
  assert.doesNotMatch(wtd, /2\*d\*fpm/, "a straight-line fuel charge is back in the table");
  assert.match(earn, /roadMi\(r\.elev\.distance-closest\.elev\.distance\)/);
  assert.match(wtd, /ROAD_NOTE/);
  assert.match(earn, /ROAD_NOTE/);
  /* page: column header and the FAQ (visible and JSON-LD) say so */
  assert.match(HTML, /<th class="r"[^>]*>Road mi \(est\.\)<\/th>/);
  assert.equal((HTML.match(/estimated road miles \(straight line x 1\.25\)/g) || []).length, 3);
  /* the radius search itself stays straight line */
  assert.doesNotMatch(liftFn(JS, "netDistanceMi"), /ROAD/);
});

test('a board with no posted time of its own says "Read", never "Posted"', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(liftFn(JS, "readTimeOnly"), ctx);
  const t = "2026-10-16T01:40:19.715Z";
  assert.equal(ctx.readTimeOnly(t, t), true, "pricedAt equal to checkedAt is the read itself");
  assert.equal(ctx.readTimeOnly("", t), true, "no pricedAt");
  assert.equal(ctx.readTimeOnly(null, null), true);
  assert.equal(ctx.readTimeOnly("2026-10-15T19:02:00Z", t), false, "an earlier pricedAt is kept as posted");
  /* the network row carries it and the Best card uses it */
  assert.match(JS, /asOfRead:held\?readTimeOnly\(b\.pricedAt,b\.checkedAt\):readTimeOnly\(shard\.pricedAt,shard\.checkedAt\)/);
  assert.match(liftFn(JS, "renderBestBids"), /prefix:best\.asOfRead\?'Read':'Posted'/);
  /* store-or-sell: the same rule, and the words */
  const SS = read("components/storesell.js"), SOS = read("components/store-or-sell.js");
  assert.match(SS, /var kind = \(isFinite\(pa\) && !\(isFinite\(ca\) && pa === ca\)\) \? 'posted' : 'read';/);
  assert.match(SS, /'Read ' \+ t \+ '\. The board gives no time of its own/);
  assert.doesNotMatch(SS, /done\(rows, s\.pricedAt \|\| s\.checkedAt, 'posted'\)/);
  assert.match(SOS, /m\.postedKind === 'posted' \? ' Posted ' : ' Read '/);
});

test("page-title elevator names are fixed the same way on the live page and the town pages", () => {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("components/cb-rank.js"), ctx);
  const R = ctx.cbRank;
  R.setNames(JSON.parse(read("data/elevator-names.json")));
  const [ops, places] = JSON.parse(execFileSync("python3", ["-I", "-c",
    "import sys,json;sys.path.insert(0,sys.argv[1]);import elevator_names as e;print(json.dumps([e.CASES_OP,e.CASES_PLACE]))",
    ROOT + "scripts"], { encoding: "utf8" }));
  assert.ok(ops.length >= 8 && places.length >= 8);
  for (const [a, b] of ops) assert.equal(R.displayName(a), b, `operator ${a}`);
  for (const [a, b] of places) assert.equal(R.cleanPlace(a), b, `place ${a}`);
  /* the 83 Iowa pages: the name is the co-op's */
  assert.equal(R.displayName("Cash Bid JSI Site - Ag State"), "Ag State");
  /* the live page prints through them */
  assert.match(liftFn(JS, "townOf"), /cbRank\.cleanPlace/);
  assert.match(liftFn(JS, "groupElevators"), /cbRank\.displayName\(b\.facility\)/);
  /* and the town builder imports the same module */
  assert.match(read("scripts/build_cash_bid_pages.py"), /from elevator_names import clean_place, display_name/);
});

test("basis.html prints the day in Central time; a USDA week date as written", () => {
  const BH = read("basis.html");
  const ctx = { Intl, Date };
  vm.createContext(ctx);
  vm.runInContext(liftFn(BH, "day"), ctx);
  /* 01:47 UTC Oct 16 is 8:47 pm Oct 15 in Chicago, when the bids say Oct 15 */
  assert.equal(ctx.day("2026-10-16T01:47:13Z"), "Oct 15, 2026");
  assert.equal(ctx.day("2026-10-16T15:00:00Z"), "Oct 16, 2026");
  assert.equal(ctx.day("2026-09-25"), "Sep 25, 2026", "a calendar day moved back a day");
  assert.equal(ctx.day("nonsense"), "");
});

test('HRW wheat basis names its exchange ("KC Dec \'26"), live page and town pages', () => {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("components/cb-rank.js") + "\n" + liftFn(JS, "wheatExch"), ctx);
  const w = (symbol, commodity) => ctx.wheatExch({ category: "wheat", symbol, commodity });
  /* Pine Bluffs WY: "Hard Red Winter Wheat" against "December 2026" */
  assert.equal(w("December 2026", "Hard Red Winter Wheat"), "KC");
  assert.equal(w("KEZ26", "Wheat"), "KC");
  assert.equal(w("@KW6Z", "Wheat"), "KC");
  assert.equal(w("ZWZ6", "Wheat (Soft Red Winter)"), "Chicago");
  assert.equal(w("MWOZ26", "Wheat, HRS"), "MIAX");
  assert.equal(w("December 2026", "Wheat"), "", "a bare month on an unnamed wheat is not guessed");
  const PY = read("scripts/build_cash_bid_pages.py");
  assert.match(PY, /WHEAT_EXCH = \{"KE": "KC", "ZW": "Chicago", "MW": "MIAX", "MWO": "MIAX"\}/);
  assert.match(PY, /vs \{con_label\(r\["contract"\]\)\}/);
  assert.match(PY, /gen\.year, b\.get\("commodity"\)\)/, "the town builder does not pass the commodity name");
});

test("town pages: prices to the cent, one Hold line in a one-elevator town", () => {
  const PY = read("scripts/build_cash_bid_pages.py");
  const cashC = liftPy(PY, "cash_c");
  assert.equal((PY.match(/pricefmt\.cash\(/g) || []).length, (cashC.match(/pricefmt\.cash\(/g) || []).length,
    "a town-page price printed with the board's own decimals, not through cash_c()");
  assert.match(PY, /only_first = bool\(live_b\) and held_first and len\(held_all\) == 1/);
  assert.match(PY, /top_html = "" if only_first else top_holds\(held_all, ss\)/);
  /* the arithmetic is the builder's own selftest (cash_c, con_label, flag_odd) */
  execFileSync("python3", [ROOT + "scripts/build_cash_bid_pages.py", "--selftest"], { cwd: ROOT, stdio: "pipe" });
});

test("fertilizer: the lede says Kansas co-ops and the posting date range; the title says Kansas co-op", () => {
  const F = read("fertilizer.html");
  // 2026-10-19 (CLS): the span opens baked with the same line, from the shared file (scripts/bake_fert_page.mjs)
  const baked = /<span id="fert-lede-when"><!--BAKE:fert-lede-->([^<]*)<!--\/BAKE--><\/span><\/p>/.exec(F);
  assert.ok(baked, "the lede's when-line sits baked at the end of the lede");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(liftFn(F, "validPrice") + liftFn(F, "ledeWhen"), ctx);
  assert.equal(baked[1], " " + ctx.ledeWhen(JSON.parse(read("data/fertilizer-prices.json"))), "baked line == the page's own ledeWhen() on the shared file");
  const doc = { prices: [
    { key: "urea", price: 622.98, as_of: "2026-10-06", src: "coop", region: "Kansas" },
    { key: "uan32", price: 451.05, as_of: "2026-09-24", src: "coop", region: "Kansas" },
    { key: "map", price: 980, as_of: "2026-10-12", src: "coop", region: "Kansas" },
    { key: "bad", price: null, as_of: "2026-01-01" }] };
  assert.equal(ctx.ledeWhen(doc), "Right now: Kansas co-ops only, posted Sep 24 to Oct 12, 2026.");
  assert.equal(ctx.ledeWhen({ prices: [] }), "", "no price, no lede line");
  // 2026-10-17 audit N7: a middle that took in an older sheet dates the lede from that sheet
  assert.equal(ctx.ledeWhen({ prices: doc.prices.concat([{ key: "thiosul", price: 420, as_of: "2026-10-06", oldest: "2026-09-10", src: "coop", region: "Kansas" }]) }),
    "Right now: Kansas co-ops only, posted Sep 10 to Oct 12, 2026.");
  // a row whose region already names two states (Synergy, WI, 2026-10-16): each state once
  assert.equal(ctx.ledeWhen({ prices: [doc.prices[1], { key: "urea", price: 615.95, as_of: "2026-10-06", src: "coop", region: "Kansas and Wisconsin" }] }),
    "Right now: Kansas and Wisconsin co-ops only, posted Sep 24 to Oct 6, 2026.");
  const title = /<title>([^<]*)<\/title>/.exec(F)[1];
  assert.ok(/^Kansas( and Wisconsin)? Co-op Fertilizer/.test(title) || !/\$\d/.test(title), title);
  execFileSync("python3", [ROOT + "scripts/bake_seo.py", "--selftest"], { cwd: ROOT, stdio: "pipe" });
});

test("breakeven: the FAQ and the results panel quote the calculator's own corn defaults", () => {
  const B = read("breakeven.html");
  const m = /CROP_DEFAULTS=\{corn:\{([^}]*)\}/.exec(B);
  assert.ok(m, "no CROP_DEFAULTS corn");
  const kv = Object.fromEntries([...m[1].matchAll(/(\w+):'?([\d.]*)'?/g)].map((x) => [x[1], x[2]]));
  const keys = ["seed", "fertilizer", "chemicals", "insurance", "machinery", "labor", "land", "overhead"];
  if (keys.some((k) => kv[k] === "")) {
    /* no live fertilizer price: the sentence carries no number */
    assert.match(B, /<!--BAKE:be-faq-->With no live fertilizer price/);
    return;
  }
  const cost = keys.reduce((a, k) => a + Number(kv[k]), 0), yld = Number(kv.yield);
  const be = (cost / yld).toFixed(2);
  const money = "$" + Math.round(cost).toLocaleString("en-US");
  assert.ok(B.includes(`<!--BAKE:be-faq-->With the default example costs (${money}/acre, ${yld} bu corn), the break-even works out to about $${be} per bushel cash.<!--/BAKE-->`),
    `the FAQ sentence does not match the defaults (${money}, $${be})`);
  assert.ok(B.includes(`id="totalCost"><!--BAKE:be-total-->${money}/ac<!--/BAKE-->`));
  assert.equal((B.match(new RegExp(`<!--BAKE:be-cpb-->\\$${be.replace(".", "\\.")}/bu<!--/BAKE-->`, "g")) || []).length, 4);
  /* the old typed example was $905 an acre, $5.03 a bushel. A live futures
     quote baked into the description ("Dec '27 futures are near $5.03¾",
     Oct 19) is not that example, so quotes are set aside first. */
  const noQuotes = B.replace(/futures are near \$\d+\.\d+[¼½¾]?/g, "futures are near (quote)");
  assert.doesNotMatch(noQuotes, /\$905|\$5\.03/, "the old typed example is back");
});

test("a board skipped this pass counts while read within 6 h; refused or broken never (held rows keep their own time)", () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext("var HELD_SKIP_H=6;" + liftFn(JS, "heldSkip"), ctx);
  const now = Date.parse("2026-10-17T21:37:31Z");
  const row = (st, ck) => ({ sourceStatus: st, stale: true, checkedAt: ck });
  assert.equal(ctx.heldSkip(row("skipped", "2026-10-17T21:00:27Z"), now), true, "read 37 min ago");
  assert.equal(ctx.heldSkip(row("skipped", "2026-10-17T15:37:31Z"), now), true, "exactly 6 h");
  assert.equal(ctx.heldSkip(row("skipped", "2026-10-17T15:00:00Z"), now), false, "6.6 h");
  assert.equal(ctx.heldSkip(row("skipped", "2026-10-17T22:00:00Z"), now), false, "a clock ahead of ours");
  assert.equal(ctx.heldSkip(row("skipped", ""), now), false, "no read time");
  assert.equal(ctx.heldSkip(row("refused", "2026-10-17T21:30:00Z"), now), false);
  assert.equal(ctx.heldSkip(row("broken", "2026-10-17T21:30:00Z"), now), false);
  assert.match(JS, /var HELD_SKIP_H=6;/);
  /* the row: not stale when held, flagged held, and its time is its own board's */
  const rows = liftFn(JS, "netRowsFrom");
  assert.match(rows, /var held=heldSkip\(b\);/);
  assert.match(rows, /stale:b\.stale===true&&!held,/);
  assert.match(rows, /asOf:\(held\?\(b\.pricedAt\|\|b\.checkedAt\):\(shard\.pricedAt\|\|shard\.checkedAt\)\)\|\|'',/);
  /* the same 6 h in the Python feed and pages */
  assert.match(read("scripts/fetch_bids.py"), /^HELD_SKIP_HOURS = 6$/m);
});
