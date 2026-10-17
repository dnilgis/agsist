/* Old or missing data must never read as today's (chaos audit, 2026-10-17).
 *
 * Each case is the fault the audit found, worked by hand:
 *  chaos-1  A settle carries its year when it is not this year, says how old it
 *           is once a session's settle is missing, and greys once 4 sessions
 *           are missing. Expired contracts roll off by scripts/contract_calendar.py's
 *           rules (the JS twin is checked against the Python, holidays included).
 *  chaos-2  A direct board's basis is re-priced onto today's futures only up to
 *           3 trading days; older boards are not ranked at all.
 *  chaos-4  AG.text rejects when a request never answers.
 *  chaos-5  Rain Print arrival dates skip every USPS holiday (computed).
 *  chaos-6  The business page's Christmas sentence follows the gift cutoffs.
 *  chaos-10 New crop follows the contract roll, not the calendar.
 *   node --test test/chaosfix.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const P = require(ROOT + "components/price-local.js");
const read = (f) => readFileSync(ROOT + f, "utf8");
const PRICES = JSON.parse(read("test/fixtures/chaosfix/prices-2026-10-17.json"));
const T = (s) => Date.parse(s);

test("chaos-1: a settle names its year and its age; old ones grey", () => {
  const now = T("2026-10-17T12:00:00Z");   // Sat
  const s = (d) => ({ close: 474.25, close_kind: "settle", settle_date: d, close_date: d });
  // the audit's 400-day file: Sep 11, 2025 read on Oct 17, 2026
  assert.equal(P.stamp(s("2025-09-11"), "2025-09-12T06:46:21Z", now), "Sep 11, 2025 settle");
  assert.equal(P.stamp(s("2026-10-16"), "2026-10-17T06:46:21Z", now), "Oct 16 settle", "this year: no year");
  // Fri settle: Sat, Sun and Mon morning are fine (no session missing yet)
  assert.deepEqual(P.settleAge("2026-10-16", T("2026-10-19T14:00:00Z")), { lag: 0, days: 3, stale: false, old: false, note: "" });
  // Tue: Monday's settle is missing -> 4 days old, not yet grey
  const tue = P.settleAge("2026-10-16", T("2026-10-20T14:00:00Z"));
  assert.equal(tue.lag, 1); assert.equal(tue.note, "4 days old"); assert.equal(tue.old, false);
  // the audit's 10-day file: Oct 6 on Oct 16-17. Sessions Oct 7, 8, 9, 12, 13, 14, 15, 16 = 8 missing
  const ten = P.settleAge("2026-10-06", now);
  assert.equal(ten.lag, 8); assert.equal(ten.old, true); assert.equal(ten.note, "11 days old");
  // Thanksgiving is not a session: Wed Nov 25 settle on Fri Nov 27 is current
  assert.equal(P.settleAge("2026-11-25", T("2026-11-27T15:00:00Z")).lag, 0);
  // exactly OLD_SESSIONS missing greys
  assert.equal(P.OLD_SESSIONS, 4);
  assert.equal(P.settleAge("2026-10-12", T("2026-10-19T14:00:00Z")).lag, 4);   // Oct 13, 14, 15, 16
  assert.equal(P.settleAge("2026-10-12", T("2026-10-19T14:00:00Z")).old, true);
  assert.equal(P.settleAge("2026-10-13", T("2026-10-19T14:00:00Z")).old, false);
  const h = P.html(s("2025-09-11"), "2025-09-12T06:46:21Z", now);
  assert.match(h, /^<time class="px-stamp is-stale" datetime="2025-09-11" data-stale=""/);
  assert.match(h, />Sep 11, 2025 settle<span class="asof-note"> &middot; 401 days old<\/span><\/time>$/);
  assert.doesNotMatch(P.html(s("2026-10-16"), "2026-10-17T06:46:21Z", now), /is-stale|asof-note/, "a current settle is plain");
  // the board line names the year too, and its age
  assert.match(P.board({ a: s("2025-09-11") }, null, "2025-09-12T06:46:21Z", now), /^Sep 11, 2025 settle\. Read Sep 12, 2025, 1:46\sam CT$/);
  assert.equal(P.boardAge({ a: s("2025-09-11"), b: { close: 1, close_kind: "last" } }, null, now).old, true);
});

test("chaos-1: holidays and expiry match scripts/contract_calendar.py", () => {
  const py = JSON.parse(execFileSync("python3", ["-c", [
    "import json,sys", `sys.path.insert(0, ${JSON.stringify(ROOT + "scripts")})`, "import contract_calendar as c",
    "h=sorted(str(d) for y in (2026,2027,2028) for d in c.market_holidays(y))",
    "rules={'ZC':'GRAIN','ZS':'GRAIN','ZW':'GRAIN','KE':'GRAIN','ZO':'GRAIN','ZM':'GRAIN','ZL':'GRAIN','LE':'MONTH_END','DC':'MONTH_END','GF':'LAST_THURSDAY','HE':'TENTH_BUSINESS_DAY'}",
    "d={r+'FGHJKMNQUVXZ'[m-1]+str(y)[2:]:str(c.dead_from(y,m,rules[r])) for r in rules for y in (2026,2027,2028) for m in range(1,13)}",
    "print(json.dumps({'h':h,'d':d}))"].join("\n")], { encoding: "utf8" }));
  const js = [];
  for (let t = T("2026-01-01T00:00:00Z"); t < T("2029-01-01T00:00:00Z"); t += 864e5) {
    const iso = new Date(t).toISOString().slice(0, 10);
    if (P.holidayName(iso)) js.push(iso);
  }
  assert.deepEqual(js, py.h.filter((d) => d >= "2026-01-01" && d < "2029-01-01"));
  for (const [tk, want] of Object.entries(py.d)) assert.equal(P.deadFrom(tk + ".CBT"), want, tk);
  assert.equal(P.deadFrom("CL=F"), null, "no rule, never judged");
});

test("chaos-1: expired contracts roll off (Jan 2 2027 on the Oct 17 file)", () => {
  const q = P.roll(PRICES.quotes, T("2027-01-02T17:00:00Z"));
  assert.equal(q["corn-dec26"], undefined, "a dead dated key is gone");
  assert.equal(q["corn-nearby"].ticker, "ZCH27.CBT"); assert.equal(q["corn-nearby"].contract, "Mar '27"); assert.equal(q["corn-nearby"].rolled_from, "Dec '26");
  assert.equal(q["corn-dec"].ticker, "ZCZ27.CBT", "a month alias rolls to the same month");
  assert.equal(q["beans-nov"].ticker, "ZSX27.CBT");
  assert.equal(q["beans-nearby"].ticker, "ZSF27.CBT");
  assert.equal(q.cattle.ticker, "LEG27.CME", "Oct and Dec '26 cattle are both dead by Jan 2");
  assert.equal(q.hogs.ticker, "HEG27.CME");
  assert.equal(q.corn.ticker, "ZC=F", "a continuous series is never judged");
  assert.equal(q["corn-nearby"].close, PRICES.quotes["corn-mar27"].close, "the price is that contract's own");
  // the day before expiry nothing moves
  const live = P.roll(PRICES.quotes, T("2026-12-14T17:00:00Z"));
  assert.equal(live["corn-nearby"].ticker, "ZCZ26.CBT");
  assert.equal(PRICES.quotes["corn-nearby"].ticker, "ZCZ26.CBT", "the input is not changed");
  // every page that leads with a futures price rolls before it paints
  for (const f of ["components/futures.js", "markets.html", "cattle-futures-prices.html", "components/geo.js", "components/home-yield.js"]) assert.match(read(f), /AgPxStamp\.roll\(/, f);
});

test("chaos-10: new crop follows the roll, not the calendar", () => {
  const src = read("components/futures.js");
  const i = src.indexOf("function newCropKey(");
  let d = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}" && --d === 0) break; }
  const ctx = { Date: class extends Date { constructor(...a) { super(...(a.length ? a : [T("2027-09-01T16:00:00Z")])); } } };
  vm.createContext(ctx);
  vm.runInContext("var MON3=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];" + src.slice(i, j + 1), ctx);
  const nk = (tk) => ctx.newCropKey("corn", "dec", tk ? { "corn-nearby": { ticker: tk } } : null);
  assert.equal(nk("ZCU27.CBT"), "corn-dec27", "Sep 1 2027, nearby Sep '27: Dec '27 is new crop");
  assert.equal(nk("ZCZ27.CBT"), "corn-dec28", "once Dec '27 is the nearby, Dec '28");
  assert.equal(nk("ZCZ26.CBT"), "corn-dec27", "Oct 2026 as before");
  assert.equal(ctx.newCropKey("beans", "nov", { "beans-nearby": { ticker: "ZSU27.CBT" } }), "beans-nov27");
  assert.equal(nk(null), "corn-dec28", "no nearby on file: the Sep 1 calendar rule");
});

test("chaos-2: an old board's basis is not re-priced or ranked", () => {
  const ctx = {};
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("components/cb-rank.js").replace(/\nif\(typeof module[^\n]*/, ""), ctx);
  const R = ctx.cbRank;
  R.setFutures({ fetched: "2026-10-17T06:46:21Z", quotes: { "corn-dec26": { ticker: "ZCZ26.CBT", close: 474.25, close_date: "2026-10-16" } } });
  const now = T("2026-10-17T17:00:00Z");
  const row = (asOf) => ({ via: "direct", asOf, category: "corn", basisMonth: "ZCZ26", basis: -0.15 });
  // Mon Oct 12 to Sat Oct 17: Tue, Wed, Thu, Fri = 4 sessions -> too old
  const old = R.assess(row("2026-10-12T18:00:00Z"), { now, basisC: -15, cash: 4.40 });
  assert.equal(old.exclude, true); assert.equal(old.tooOld, true); assert.equal(old.remark, null);
  // the audit's 31-day board
  assert.equal(R.assess(row("2026-09-16T18:00:00Z"), { now, basisC: -15, cash: 4.59 }).exclude, true);
  // Tue Oct 13: Wed, Thu, Fri = 3 -> still re-priced onto the Oct 16 settle
  const ok = R.assess(row("2026-10-13T18:00:00Z"), { now, basisC: -15, cash: 4.40 });
  assert.equal(ok.exclude, false); assert.ok(ok.remark); assert.equal(ok.price, 4.59);
  assert.equal(R.sessionsSince("2026-10-12", "2026-10-15"), 3, "Mon to Thu");
  assert.equal(R.sessionsSince("2026-10-09", "2026-10-14"), 3, "Fri to Wed");
  assert.equal(R.REMARK_SESSIONS, 3);
  // the page keeps the card and says why it is not ranked
  const page = read("components/cash-bids.js");
  assert.match(page, /else if\(boardTooOld\(elev\)\)html\+='<div class="elev-stale"/);
  assert.match(page, /board not updated in over '\+cbRank\.REMARK_SESSIONS\+' trading days, call before you load/);
});

test("chaos-4: AG.text gives up on a request that never answers", async () => {
  let aborted = false, timers = [];
  const ctx = {
    AbortController, Promise, String, Error,
    setTimeout: (f, ms) => { timers.push(ms); return setTimeout(f, 1); }, clearTimeout,
    fetch: (u, o) => new Promise((res, rej) => { o.signal.addEventListener("abort", () => { aborted = true; rej(new Error("abort")); }); }),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("components/util.js"), ctx);
  await assert.rejects(ctx.AG.json("/data/daily.json"), /timeout/);
  assert.ok(aborted, "the request is aborted");
  assert.ok(timers.includes(15000), "15 s deadline");
  await assert.rejects(ctx.AG.fetch("/data/daily.json"), /timeout/);
  // a later call tries again rather than keeping the failure
  ctx.fetch = () => Promise.resolve({ ok: true, text: () => Promise.resolve('{"a":1}') });
  assert.deepEqual({ ...(await ctx.AG.json("/data/daily.json")) }, { a: 1 });
  // /daily reads its briefing through the deadline and carries a plain line under the skeleton
  const d = read("daily.html");
  assert.match(d, /AG\.fetch\('\/data\/daily\.json'/);
  assert.match(d, /<p class="dv3-sk-slow">Still loading\./);
});

const RPS = read("components/rain-print.js");
function rp() { const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob }; ctx.window = ctx; vm.runInNewContext(RPS, ctx); return ctx.RainPrint; }
const J = JSON.parse(read("data/rain-print.json"));

test("chaos-5: USPS holidays, observed dates, and the arrival math", () => {
  const RP = rp();
  assert.deepEqual([...RP.uspsHolidays(2026)], ["2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25"]);
  // 2027: Juneteenth is a Saturday (Fri Jun 18), July 4 a Sunday (Mon Jul 5), Christmas a Saturday (Fri Dec 24)
  assert.deepEqual([...RP.uspsHolidays(2027)], ["2027-01-01", "2027-01-18", "2027-02-15", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-10-11", "2027-11-11", "2027-11-25", "2027-12-24"]);
  assert.equal(RP.uspsHolidays(2028)[0], "2027-12-31", "Jan 1 2028 is a Saturday");
  // every year from now through the next: 11 closed weekdays each, so the next 365 days are always covered
  const y = new Date().getUTCFullYear();
  for (const k of [y, y + 1, y + 2]) {
    const h = RP.uspsHolidays(k);
    assert.equal(h.length, 11);
    for (const d of h) assert.ok(![0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay()), d + " is a weekday");
  }
  // the audit's three dates, by hand: framed is 1+1+3+6 = 11 business days
  // Sun Dec 20: Dec 21 22 23 24, (25 off), 28 29 30 31, (Jan 1 off), Jan 4 5 6 -> Wed Jan 6
  assert.equal(RP.arriveBy(J, "framed12x18", "2026-12-20"), "2027-01-06");
  assert.equal(RP.arriveText(J, "framed12x18", "2026-12-20"), "Ordered today, it should arrive by about Wednesday, Jan 6.");
  // Sun Jun 20 2027: Jun 21-25 (5), Jun 28-Jul 2 (10), (Jul 5 off), Jul 6 -> 11
  assert.equal(RP.arriveBy(J, "framed12x18", "2027-06-20"), "2027-07-06");
  // Wed Sep 1 2027: Sep 2 3, (Sep 6 off), 7-10, 13-17 -> Fri Sep 17
  assert.equal(RP.arriveBy(J, "framed12x18", "2027-09-01"), "2027-09-17");
  // the file's Christmas cutoffs still equal what the math gives
  assert.equal(RP.christmasCutoff(J, "framed12x18", 2026), J.framed_christmas_cutoff);
  assert.equal(RP.christmasCutoff(J, "print12x18", 2026), J.print_christmas_cutoff);
  // the file's list is an override on top
  assert.ok(RP.holidaysFor({ holidays: ["2026-12-28"] }, "2026-12-20").includes("2026-12-28"));
});

test("chaos-6: the business Christmas sentence follows the gift cutoffs", () => {
  const RP = rp();
  const j = { business_cutoff: "2026-11-20", print_christmas_cutoff: "2026-12-10", ship_business_days: 3 };
  assert.match(RP.bizChristmasLine("2026-11-20", j), /^Any past year ships before Christmas if the list comes in time: send it by Nov 20\./);
  assert.match(RP.bizChristmasLine("2026-11-21", j), /^The Nov 20 list date has passed\. A small list may still make Christmas if it is in by Dec 10: ask me for dates\./);
  assert.match(RP.bizChristmasLine("2026-12-10", j), /ask me for dates/);
  assert.match(RP.bizChristmasLine("2026-12-11", j), /^Orders placed now arrive after Christmas\./);
  assert.match(RP.bizChristmasLine("2026-12-20", j), /^Orders placed now arrive after Christmas\./, "the audit's Dec 20");
  assert.doesNotMatch(RP.bizChristmasLine("2026-12-26", j), /Christmas/, "from Dec 26 no Christmas clause");
  assert.doesNotMatch(RP.bizChristmasLine("2027-10-15", j), /Christmas/, "a year-old cutoff says nothing about this Christmas");
  for (const t of ["2026-11-21", "2026-12-20", "2026-12-26"]) assert.doesNotMatch(RP.bizChristmasLine(t, j), /—/);
  assert.match(read("components/rp-business.js"), /R\.bizChristmasLine\(chicagoToday\(\), j\)/);
  assert.match(read("rain-print-business.html"), /<p id="rbz-xmas">/);
});
