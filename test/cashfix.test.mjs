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
  assert.match(JS, /asOfRead:readTimeOnly\(shard\.pricedAt,shard\.checkedAt\)/);
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
