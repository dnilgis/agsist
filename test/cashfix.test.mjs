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
