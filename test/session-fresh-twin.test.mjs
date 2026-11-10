/* One freshness rule on both sides: a price is current until two trading-day
 * sessions (1:20 pm Central) have closed after it, and a market holiday is not
 * a session. scripts/build_state_basis_pages.py is_fresh (town and state pages)
 * and components/cash-bids.js mktSessionsClosedSince (the /cash-bids card) read
 * the same holiday list (scripts/contract_calendar.py market_holidays and its
 * twin mktHolidayName) and must agree on every case below.
 *
 *   node --test test/session-fresh-twin.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CB = readFileSync(ROOT + "components/cash-bids.js", "utf8");

function lift(name) {
  const start = CB.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `components/cash-bids.js no longer defines ${name}()`);
  let depth = 0, seen = false;
  for (let i = start; i < CB.length; i++) {
    if (CB[i] === "{") { depth++; seen = true; }
    else if (CB[i] === "}") { depth--; if (seen && depth === 0) return CB.slice(start, i + 1); }
  }
  throw new Error("unbalanced " + name);
}
const NAMES = ["mktHolidayName", "mktParts", "mktInstant", "mktAddDays", "mktSessionsClosedSince"];
const ctx = {};
vm.createContext(ctx);
vm.runInContext("var MKT_TZ='America/Chicago';var _mktFmt=null;\n" + NAMES.map(lift).join("\n"), ctx);
const jsFresh = (posted, now) => ctx.mktSessionsClosedSince(posted, new Date(now)) < 2;

/* [posted, viewed, fresh?, why] (UTC instants; Central in the note) */
const CASES = [
  ["2026-11-25T16:00:00Z", "2026-11-26T20:00:00Z", true, "Wed 10:00 post, Thanksgiving 14:00"],
  ["2026-11-25T16:00:00Z", "2026-11-27T19:21:00Z", false, "Wed 10:00 post, Fri after Thanksgiving 13:21"],
  ["2027-01-15T16:00:00Z", "2027-01-18T20:00:00Z", true, "Fri 10:00 post, MLK Monday 14:00"],
  ["2027-01-15T16:00:00Z", "2027-01-19T19:19:00Z", true, "Fri 10:00 post, Tue after MLK 13:19"],
  ["2027-01-15T16:00:00Z", "2027-01-19T19:21:00Z", false, "Fri 10:00 post, Tue after MLK 13:21"],
  ["2026-11-06T20:00:00Z", "2026-11-09T22:00:00Z", true, "Fri 14:00 post, Mon 16:00 (weekend)"],
  ["2026-11-06T20:00:00Z", "2026-11-10T19:21:00Z", false, "Fri 14:00 post, Tue 13:21 (weekend)"],
  ["2026-11-06T16:00:00Z", "2026-11-09T19:19:00Z", true, "Fri 10:00 post, Mon 13:19"],
  ["2026-11-06T16:00:00Z", "2026-11-09T19:21:00Z", false, "Fri 10:00 post, Mon 13:21"],
  ["2026-11-09T15:00:00Z", "2026-11-10T19:19:00Z", true, "Mon 09:00 post, Tue 13:19"],
  ["2026-11-09T15:00:00Z", "2026-11-10T19:21:00Z", false, "Mon 09:00 post, Tue 13:21"],
  ["2026-09-04T14:00:00Z", "2026-09-08T18:00:00Z", true, "Fri 09:00 post, Tue after Labor Day 13:00 CDT"],
  ["2026-09-04T14:00:00Z", "2026-09-08T18:21:00Z", false, "Fri 09:00 post, Tue after Labor Day 13:21 CDT"],
  ["2026-12-24T16:00:00Z", "2026-12-28T20:00:00Z", false, "Thu Dec 24 post, Mon Dec 28 (Christmas Fri is closed)"],
  ["2026-12-24T16:00:00Z", "2026-12-25T20:00:00Z", true, "Thu Dec 24 10:00 post, Christmas Day 14:00"],
  ["2026-12-24T16:00:00Z", "2026-12-28T19:00:00Z", true, "Thu Dec 24 10:00 post, Mon Dec 28 13:00"],
];

test("the case table says what the rule says (JS)", () => {
  for (const [p, v, want, why] of CASES) assert.equal(jsFresh(p, v), want, why);
});

test("Python is_fresh and JS mktSessionsClosedSince agree on every case", () => {
  const py = JSON.parse(execFileSync("python3", ["-I", "-c",
    "import sys,json,datetime as dt;sys.path.insert(0,sys.argv[1]);import build_state_basis_pages as S\n" +
    "p=lambda s:dt.datetime.fromisoformat(s.replace('Z','+00:00'))\n" +
    "print(json.dumps([S.is_fresh(p(a),p(b)) for a,b in json.loads(sys.argv[2])]))",
    ROOT + "scripts", JSON.stringify(CASES.map((c) => [c[0], c[1]]))], { encoding: "utf8" }));
  CASES.forEach(([p, v, , why], i) => assert.equal(py[i], jsFresh(p, v), `Python and JS disagree: ${why}`));
});

test("Python and JS name the same market holidays, 2026 to 2030", () => {
  const py = JSON.parse(execFileSync("python3", ["-I", "-c",
    "import sys,json;sys.path.insert(0,sys.argv[1]);import contract_calendar as c\n" +
    "print(json.dumps(sorted(str(d) for y in range(2026,2031) for d in c.market_holidays(y))))",
    ROOT + "scripts"], { encoding: "utf8" }));
  const js = [];
  for (let t = Date.UTC(2025, 11, 1); t <= Date.UTC(2031, 0, 31); t += 864e5) {
    const iso = new Date(t).toISOString().slice(0, 10);
    if (ctx.mktHolidayName(iso)) js.push(iso);
  }
  const lo = py[0], hi = py[py.length - 1];
  assert.deepEqual(js.filter((d) => d >= lo && d <= hi), py);
  assert.equal(ctx.mktHolidayName("2027-01-18"), "MLK Day");
  assert.equal(ctx.mktHolidayName("2026-11-26"), "Thanksgiving");
});
