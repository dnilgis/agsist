#!/usr/bin/env node
/* THE MARKET CLOCK, CHECKED AGAINST THE PAGE ITSELF.
 *
 *     node scripts/market-clock-checks.mjs
 *
 * WHAT IT REPLACED, AND WHY THAT MATTERS
 *
 * cash-bids.html carried this:
 *
 *     var ct=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Chicago'}));
 *     if(day===0||day===6)return false;
 *     return t>=510&&t<=800;
 *
 * 510 to 800 minutes is 08:30 to 13:20 CT — the DAY SESSION ONLY. CME's grain
 * hours are "7:00 p.m. - 7:45 a.m. CT, Sun - Fri and 8:30 a.m. - 1:20 p.m. CT,
 * Mon - Fri", so that badge said "Market closed" through thirteen hours of
 * every weekday, and through the Sunday evening reopen that starts the trading
 * week. It also re-parsed a localised string as local time, which is right by
 * luck rather than by construction.
 *
 * The functions are LIFTED out of the page, so this cannot pass against a
 * clock the page no longer runs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = readFileSync(join(ROOT, "cash-bids.html"), "utf8");

let pass = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function lift(name) {
  const start = PAGE.indexOf(`function ${name}(`);
  if (start < 0) return null;
  let depth = 0, seen = false;
  for (let i = start; i < PAGE.length; i++) {
    const c = PAGE[i];
    if (c === "{") { depth++; seen = true; }
    else if (c === "}") { depth--; if (seen && depth === 0) return PAGE.slice(start, i + 1); }
  }
  return null;
}
const NAMES = ["mktParts", "mktInstant", "mktAddDays", "mktNextEveningOpen",
               "marketSession", "mktCountdown", "mktSessionsClosedSince"];
const src = {};
for (const n of NAMES) {
  src[n] = lift(n);
  ok(src[n] !== null, `cash-bids.html no longer defines ${n}() — the page and this checker have parted company`);
}
if (fails.length) { report(); process.exit(1); }

const constOf = (n) => { const m = new RegExp(`var ${n} ?= ?([^;]+);`).exec(PAGE); return m ? m[1] : null; };
const consts = ["MKT_TZ", "MKT_OPEN_EVE", "MKT_PAUSE", "MKT_DAY_OPEN", "MKT_DAY_CLOSE"]
  .map((n) => `var ${n}=${constOf(n)};`).join("\n");
const hol = /var MKT_HOLIDAYS_2026 ?= ?\{[\s\S]*?\};/.exec(PAGE);
ok(!!hol, "the holiday table is gone");

const M = new Function("Intl", "Date", "isFinite", "Math", "parseInt",
  `var _mktFmt=null;\n${consts}\n${hol ? hol[0] : "var MKT_HOLIDAYS_2026={};"}\n` +
  NAMES.map((n) => src[n]).join("\n") +
  `\nreturn {${NAMES.join(",")}};`)(Intl, Date, isFinite, Math, parseInt);

/* ── THE HOURS ARE CME'S, NOT SOMEBODY'S MEMORY ────────────────────────── */
ok(constOf("MKT_OPEN_EVE") === "19 * 60", `the overnight open is ${constOf("MKT_OPEN_EVE")}, not 19:00 CT`);
ok(constOf("MKT_PAUSE") === "7 * 60 + 45", `the overnight close is ${constOf("MKT_PAUSE")}, not 07:45 CT`);
ok(constOf("MKT_DAY_OPEN") === "8 * 60 + 30", `the day open is ${constOf("MKT_DAY_OPEN")}, not 08:30 CT`);
ok(constOf("MKT_DAY_CLOSE") === "13 * 60 + 20", `the day close is ${constOf("MKT_DAY_CLOSE")}, not 13:20 CT`);
/* THE DEFECT THAT WAS THERE. A window of exactly the day session, with no
   overnight, is the bug this replaced. */
ok(!/t>=510&&t<=800/.test(PAGE),
   "the old day-session-only window (510-800) is back — the badge would say " +
   "'Market closed' through every overnight session");
ok(!/new Date\(new Date\(\)\.toLocaleString/.test(PAGE),
   "the re-parse-a-localised-string timezone hack is back");

const at = (iso) => new Date(iso);
const state = (iso) => M.marketSession(at(iso)).state;

/* ── EVERY EDGE OF A NORMAL WEEK ───────────────────────────────────────── */
const week = [
  ["2026-09-02T01:00:00Z", "overnight", "Tue 20:00 CT — the evening half of the overnight session"],
  ["2026-09-02T12:00:00Z", "overnight", "Wed 07:00 CT — the morning half"],
  ["2026-09-02T12:44:00Z", "overnight", "Wed 07:44 CT — one minute before the pause"],
  ["2026-09-02T12:45:00Z", "pause", "Wed 07:45 CT — the pause begins"],
  ["2026-09-02T13:29:00Z", "pause", "Wed 08:29 CT — one minute before the open"],
  ["2026-09-02T13:30:00Z", "day", "Wed 08:30 CT — the day session opens"],
  ["2026-09-02T18:19:00Z", "day", "Wed 13:19 CT — one minute before the close"],
  ["2026-09-02T18:20:00Z", "closed", "Wed 13:20 CT — the day session closes"],
  ["2026-09-02T23:59:00Z", "closed", "Wed 18:59 CT — one minute before the reopen"],
  ["2026-09-03T00:00:00Z", "overnight", "Wed 19:00 CT — the reopen"],
];
for (const [iso, want, why] of week)
  ok(state(iso) === want, `${why}: got "${state(iso)}", wanted "${want}"`);

/* ── THE WEEKEND GAP, WHICH IS THE ONE PEOPLE GET WRONG ────────────────── */
ok(state("2026-09-04T19:00:00Z") === "closed", "Friday afternoon is not closed");
ok(state("2026-09-05T00:30:00Z") === "closed",
   "FRIDAY EVENING OPENED — there is no Friday 19:00 session; the market is shut until Sunday");
ok(state("2026-09-05T12:00:00Z") === "closed", "Saturday morning is not closed");
ok(state("2026-09-06T20:00:00Z") === "closed", "Sunday afternoon is not closed");
ok(state("2026-09-07T00:30:00Z") === "overnight",
   "SUNDAY 19:00 DID NOT REOPEN — that is the first price action of the week and the old badge missed it entirely");
ok(/Closed for the weekend/.test(M.marketSession(at("2026-09-05T12:00:00Z")).label),
   "a Saturday does not say the weekend");

/* ── THROUGH BOTH CLOCK CHANGES ────────────────────────────────────────── */
/* 08:30 CT is 13:30Z in CDT and 14:30Z in CST. A fixed offset gets one wrong. */
ok(state("2026-10-30T14:00:00Z") === "day", "09:00 CDT in October is not the day session");
ok(state("2026-11-06T15:00:00Z") === "day", "09:00 CST in November is not the day session");
ok(state("2026-11-06T14:00:00Z") === "pause", "08:00 CST in November is not the pause");
ok(state("2026-03-06T14:00:00Z") === "pause", "08:00 CST before the spring change is not the pause");
ok(state("2026-03-13T14:00:00Z") === "day", "09:00 CDT after the spring change is not the day session");

/* ── AND THE BOUNDARY INSTANT ITSELF, NOT ONLY THE STATE ───────────────── */
/* A fixed UTC offset gets the STATE right in CDT and the COUNTDOWN wrong in
   CST — mktParts() reads the clock correctly either way, so only the boundary
   moves, by exactly an hour, and every state assertion above still passes.
   That mutation survived until this block existed. */
const until = (iso) => M.marketSession(at(iso)).until.toISOString();
ok(until("2026-09-02T15:00:00Z") === "2026-09-02T18:20:00.000Z",
   `CDT day close resolved to ${until("2026-09-02T15:00:00Z")}, not 13:20 CT (18:20Z)`);
ok(until("2026-11-04T16:00:00Z") === "2026-11-04T19:20:00.000Z",
   `CST day close resolved to ${until("2026-11-04T16:00:00Z")}, not 13:20 CT (19:20Z) ` +
   `— a fixed offset is an hour out on this side of the clock change`);
ok(until("2026-11-04T21:00:00Z") === "2026-11-05T01:00:00.000Z",
   `CST overnight open resolved to ${until("2026-11-04T21:00:00Z")}, not 19:00 CT (01:00Z)`);
ok(until("2026-09-02T20:00:00Z") === "2026-09-03T00:00:00.000Z",
   `CDT overnight open resolved to ${until("2026-09-02T20:00:00Z")}, not 19:00 CT (00:00Z)`);

/* ── A HOLIDAY IS NAMED AND NEVER ACTED ON ─────────────────────────────── */
const labor = M.marketSession(at("2026-09-07T15:00:00Z"));
ok(labor.holiday === "Labor Day", `Labor Day is not named: ${labor.holiday}`);
ok(labor.state === "day",
   "the holiday changed the session state — CME finalises holiday hours about two " +
   "weeks ahead and grains do not all follow one pattern, so this must say the " +
   "schedule differs and never invent an open or a close");

/* ── HOW OLD A DIRECT BOARD IS, IN SESSIONS ────────────────────────────── */
const since = (p, n) => M.mktSessionsClosedSince(p, at(n));
ok(since("2026-09-04T18:31:00Z", "2026-09-05T12:25:00Z") === 0,
   "a board posted after Friday's close reads as stale on Saturday — nothing has closed since");
ok(since("2026-09-04T14:00:00Z", "2026-09-07T12:00:00Z") === 1,
   "a Friday-morning board viewed on Monday should be one session old");
ok(since("2026-09-04T14:00:00Z", "2026-09-08T12:00:00Z") === 2,
   "a Friday-morning board viewed on Tuesday should be two sessions old");
ok(since(null, "2026-09-08T12:00:00Z") === null, "a missing timestamp did not return null");
ok(since("not a date", "2026-09-08T12:00:00Z") === null, "an unparseable timestamp did not return null");

/* ── AND THE PAGE ACTUALLY USES IT ─────────────────────────────────────── */
ok(/elev\.via==='direct'[\s\S]{0,200}mktSessionsClosedSince/.test(PAGE),
   "the card no longer judges a direct board by sessions — every direct row " +
   "would wear a stale badge all weekend");
ok(/marketSession\(now\)/.test(PAGE), "the badge no longer reads the session clock");
ok(/mktCountdown\(/.test(PAGE), "the badge shows no countdown");
ok(/_mktTick=setTimeout\(updateMarketBadge/.test(PAGE),
   "the countdown never re-arms, so it freezes at whatever it said on load");

function report() {
  if (fails.length) {
    for (const f of fails) console.log("FAIL: " + f);
    console.log(`\n${pass} passed, ${fails.length} failed`);
  } else {
    console.log(`market clock: ${pass} passed — CBOT hours from CME, both clock ` +
                `changes, the weekend gap, and a board judged by sessions rather than hours`);
  }
}
report();
process.exit(fails.length ? 1 : 0);
