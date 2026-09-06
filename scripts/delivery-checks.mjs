/* DELIVERY FILTER — 50 CHECKS
 *
 * Run it:   node scripts/delivery-checks.mjs      (from the repo root)
 *
 * It reads the real functions straight out of cash-bids.html rather than
 * copying them, so it cannot quietly pass against a version of the code that
 * is no longer on the page.
 *
 * Why it exists: the delivery filter shipped on 2026-08-26 keyed on
 * deliveryStart -- the first day of the delivery window -- and 55 of 345 live
 * rows have a window that opens in a different month from the contract on the
 * card. Asking for November HID a real November bid from Heartland Coop of
 * Council Bluffs. That row is checked below.
 *
 * It broke a second way on 2026-09-05: a bid whose label names a SEASON rather
 * than a month ("Fall 26") has no month key at all, and the filter read that
 * as "does not match" -- so every board this project reads itself vanished the
 * moment a delivery period was chosen. The last block in this file is that bug.
 *
 * THIS FILE IS RUN BY .github/workflows/feeds-guard.yml. It was not, on the day
 * it would have caught the above.
 */
/* Drive the delivery filter's real logic, lifted out of the page. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
/* Resolved from THIS FILE's own location, not from wherever you happened to be
   standing when you ran it. The first version hardcoded a sandbox path and
   would have thrown ENOENT on any other machine, which is a check that cannot
   check anything. Works from the repo root or from inside scripts/. */
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = [join(HERE, "cash-bids.html"), join(HERE, "..", "cash-bids.html")]
  .find((p) => { try { readFileSync(p); return true; } catch { return false; } });
if (!PAGE) {
  console.error("Could not find cash-bids.html next to this script or one level up.");
  process.exit(1);
}
const h = readFileSync(PAGE, "utf8");
const grab = (name) => {
  const i = h.indexOf("function "+name);
  if (i<0) throw new Error("no "+name);
  let d=0,j=h.indexOf("{",i);
  for(let k=j;k<h.length;k++){ if(h[k]==="{")d++; else if(h[k]==="}"){d--; if(!d){j=k;break;}} }
  return h.slice(i,j+1);
};
const src = ["delKey","delLabel","harvestYear","harvestKeys","isHarvestSeason","inDelivery"].map(grab).join("\n")
  + "\nvar MONTHNAME=" + JSON.stringify(["January","February","March","April","May","June","July","August","September","October","November","December"]) + ";";
const mk = new Function("currentDelivery", src + "; return {delKey,delLabel,harvestYear,harvestKeys,isHarvestSeason,inDelivery};");
let F = mk("all");

const ok = (c,m)=>{ if(!c){ console.log("FAIL:",m); process.exitCode=1; } else console.log("ok  ",m); };

ok(F.delKey({deliveryStart:"2026-10-01 00:00:00"})==="2026-10", "deliveryStart parses");
ok(F.delKey({deliveryMonth:"Oct26"})==="2026-10",               "Oct26 parses");
ok(F.delKey({deliveryMonth:"Oct 26"})==="2026-10",              "Oct 26 parses");
ok(F.delKey({deliveryMonth:"October 2026"})==="2026-10",        "October 2026 parses");
ok(F.delKey({deliveryMonth:"Fall 26"})==="",                    "a period that is not a month is NOT guessed at");
ok(F.delKey({})==="",                                           "nothing is not a month");
ok(F.delKey({deliveryStart:"2026-10-01",deliveryMonth:"Aug26"})==="2026-08",
   "the CONTRACT MONTH wins over the delivery window — reversed 2026-08-26 after " +
   "keying on the window hid a real Nov bid from the grower who asked for the filter");
ok(F.delLabel("2026-11")==="Nov 2026", "label reads as a person would say it");

F = mk("all");
ok(F.inDelivery({deliveryMonth:"Aug26"})===true, "Any delivery keeps everything");
F = mk("2026-10");
ok(F.inDelivery({deliveryMonth:"Oct26"})===true,  "a chosen month keeps that month");
ok(F.inDelivery({deliveryMonth:"Aug26"})===false, "and drops the others — Kolton's actual ask");
ok(F.inDelivery({deliveryMonth:"Fall 26"})===false,
   "an unparseable period is DROPPED, not smuggled in: showing a bid under a month it may not be for is the one wrong answer here");
F = mk("harvest");
const y = new Date().getFullYear();
ok(F.inDelivery({deliveryStart:y+"-10-01"})===true,  "harvest keeps October");
ok(F.inDelivery({deliveryStart:y+"-11-01"})===true,  "harvest keeps November");
ok(F.inDelivery({deliveryStart:y+"-12-01"})===true,  "harvest keeps December");
ok(F.inDelivery({deliveryStart:y+"-09-01"})===false, "harvest drops September");
ok(F.inDelivery({deliveryStart:y+"-08-01"})===false, "harvest drops August");
ok(F.harvestKeys([y+"-08",y+"-09"]).length===0,
   "harvest is offered ONLY when the data has those months");

/* THE BUG KOLTON FOUND, as a test. Heartland Coop, Council Bluffs: a Nov26
   contract whose delivery window opens 2026-10-01. Real row from the live file. */
F = mk("2026-11");
ok(F.inDelivery({deliveryMonth:"Nov26",deliveryStart:"2026-10-01 00:00:00"})===true,
   "a Nov contract with an Oct delivery window is kept when November is asked for");
F = mk("2026-10");
ok(F.inDelivery({deliveryMonth:"Nov26",deliveryStart:"2026-10-01 00:00:00"})===false,
   "and is NOT shown when October is asked for");
F = mk("all");
ok(F.delKey({deliveryMonth:"Nov26",deliveryStart:"2026-10-01 00:00:00"})==="2026-11",
   "the contract month wins over the window's first day");
ok(F.delKey({deliveryMonth:"Fall 26",deliveryStart:"2026-10-01 00:00:00"})==="2026-10",
   "an unusable label falls back to the window rather than dropping the row");

/* ── THE BUG SIG FOUND, 2026-09-05, as tests ─────────────────────────────────
 *
 * "i do see it when i default to all delivery months, but not when i select
 *  the harvest months which is weird."
 *
 * Flash Grain of Thorp, Wisconsin is four miles from ZIP 54771 and posts three
 * rows: Fall 26, Fall 27, Fall 28. Nothing else. delKey() refuses to guess a
 * month out of "Fall 26" and is right to; inDelivery() read that refusal as
 * "does not match" and dropped him — so the elevator nearest the reader, read
 * straight from his own board, was on the page under Any delivery and gone
 * under Harvest, while Barchart's copy of a board thirty miles further out
 * stayed. The feed we build ourselves was the one the filter emptied.
 *
 * The season is NOT inferred from the printed label here. dnilgis/bids
 * classifies it when it builds the shard — period "newcrop-2026", periodVia
 * "season" — and cash-bids.html now carries that across as deliveryPeriod.
 * These checks pin both halves: harvest honours it, a month never does.
 */
const HY = (function(){ const n=new Date(); return n.getMonth()>11?n.getFullYear()+1:n.getFullYear(); })();
const FALL = { deliveryMonth:"Fall "+String(HY).slice(2), deliveryStart:"",
               deliveryPeriod:"newcrop-"+HY, facility:"Flash Grain", city:"Thorp" };

F = mk("all");
ok(F.delKey(FALL)==="", "Flash Grain's label still yields no month — nothing was guessed to fix this");
ok(F.isHarvestSeason(FALL)===true, "the FEED's own classification says this is the current harvest");
ok(F.isHarvestSeason({deliveryPeriod:"newcrop-"+(HY+1)})===false, "next year's new crop is not this harvest");
ok(F.isHarvestSeason({deliveryPeriod:"oldcrop-"+HY})===false, "old crop is not harvest");
ok(F.isHarvestSeason({deliveryMonth:"Fall "+String(HY).slice(2)})===false,
   "a printed label alone proves nothing — only the feed's classification counts");
ok(F.inDelivery(FALL)===true, "Any delivery still keeps him");

F = mk("harvest");
ok(F.inDelivery(FALL)===true,
   "HARVEST KEEPS HIM. This is the check that was missing on 2026-09-05.");
ok(F.inDelivery({deliveryMonth:"Aug"+String(HY).slice(2),deliveryPeriod:""})===false,
   "and harvest still drops an August contract");
ok(F.inDelivery({deliveryMonth:"Oct"+String(HY).slice(2),deliveryPeriod:"newcrop-"+HY})===true,
   "a row with BOTH a month and a season is judged on its month");
ok(F.inDelivery({deliveryMonth:"Aug"+String(HY).slice(2),deliveryPeriod:"newcrop-"+HY})===false,
   "AND THE MONTH WINS WHEN THEY DISAGREE: an August contract is not harvest, "+
   "whatever the shard called its period. The month is the number the elevator "+
   "says on the phone.");

F = mk(HY+"-11");
ok(F.inDelivery(FALL)===false,
   "A MONTH NEVER CLAIMS HIM. \"Fall 26\" is not November; the elevator did not "+
   "say which month, and putting him under one would be inventing it. "+
   "renderSeasonNote() says so on the page instead of letting him vanish.");

/* ── "Sep 01, 2026": MONTH, DAY, YEAR ───────────────────────────────────────
 * CDR Farms LLC of Bloomer, Wisconsin posts every row this way. It is not a
 * season and it is not ambiguous — the month and the year are both printed —
 * but the month-then-year pattern wants nothing between them, so it matched
 * nothing, and a board read straight from the elevator carries no
 * deliveryStart to fall back on. CDR dropped out of every delivery filter
 * while still showing under "Any delivery": sixteen miles from ZIP 54771,
 * found beside the Flash Grain bug on 2026-09-05.
 */
F = mk("all");
ok(F.delKey({deliveryMonth:"Sep 01, 2026"})==="2026-09", "Sep 01, 2026 is September 2026");
ok(F.delKey({deliveryMonth:"Nov 01, 2026"})==="2026-11", "Nov 01, 2026 is November 2026");
ok(F.delKey({deliveryMonth:"Mar 01, 2027"})==="2027-03", "Mar 01, 2027 is March 2027");
ok(F.delKey({deliveryMonth:"October 15, 2026"})==="2026-10", "a full month name works too");
ok(F.delKey({deliveryMonth:"Fall 01, 2026"})==="", "and a season with a date in it is still not a month");
F = mk("harvest");
ok(F.inDelivery({deliveryMonth:"Oct 01, 2026"})===true,  "harvest keeps CDR's October row");
ok(F.inDelivery({deliveryMonth:"Sep 01, 2026"})===false, "and still drops his September one");
F = mk("2026-11");
ok(F.inDelivery({deliveryMonth:"Nov 01, 2026"})===true,  "November keeps his November row");
ok(F.inDelivery({deliveryMonth:"Oct 01, 2026"})===false, "and not his October one");

/* ── THE FEED ALREADY KNOWS THE MONTH ───────────────────────────────────────
 * "09/01/2026" is how every AgriCharts mobile board writes a delivery, and
 * none of the patterns in delKey is a date parser. dnilgis/bids reads it and
 * writes period "2026-09" into the shard; the page carries that across as
 * deliveryPeriod. Without this the boards were in the feed and still could not
 * be filtered by month: near Marion, Iowa, 28 elevators under "Any delivery"
 * and 2 under "Sep 2026".
 */
F = mk("all");
ok(F.delKey({deliveryMonth:"09/01/2026",deliveryPeriod:"2026-09"})==="2026-09",
   "a month the feed worked out is the key");
ok(F.delKey({deliveryMonth:"Fall 26",deliveryPeriod:"newcrop-2026"})==="",
   "a SEASON is not a month key, however the feed wrote it");
ok(F.delKey({deliveryMonth:"Oct/Nov 26",deliveryPeriod:"2026-10/2026-11"})==="",
   "and a month PAIR is not one month either");
ok(F.delKey({deliveryMonth:"Nov26",deliveryPeriod:"2026-10"})==="2026-11",
   "the LABEL still wins over the feed's period: the label is the number the "+
   "elevator says on the phone, which is the rule the 2026-08-26 fix established");
ok(F.delKey({deliveryPeriod:"spot"})==="", "spot is not a month");
F = mk("2026-09");
ok(F.inDelivery({deliveryMonth:"09/01/2026",deliveryPeriod:"2026-09"})===true,
   "September keeps an AgriCharts September row");
ok(F.inDelivery({deliveryMonth:"10/01/2026",deliveryPeriod:"2026-10"})===false,
   "and not its October one");
F = mk("harvest");
ok(F.inDelivery({deliveryMonth:"10/01/2026",deliveryPeriod:"2026-10"})===true,
   "harvest keeps it too");
