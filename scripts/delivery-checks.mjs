/* DELIVERY FILTER — 22 CHECKS
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
 * Council Bluffs. That exact row is the last check in this file.
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
const src = ["delKey","delLabel","harvestKeys","inDelivery"].map(grab).join("\n")
  + "\nvar MONTHNAME=" + JSON.stringify(["January","February","March","April","May","June","July","August","September","October","November","December"]) + ";";
const mk = new Function("currentDelivery", src + "; return {delKey,delLabel,harvestKeys,inDelivery};");
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
