#!/usr/bin/env node
/* build_usda_ics.mjs: writes usda-calendar.ics from the report list on
 * /usda-calendar itself (the REPORTS array in usda-calendar.html).
 *
 * Until 2026-10-16 the .ics was a second, hand-kept copy of the dates. It had
 * 16 events and none of the livestock and dairy reports the page lists, and
 * the homepage "Upcoming USDA reports" strip reads this file, so the strip
 * skipped Milk Production and Cattle on Feed too. One list now.
 *
 * In the file: every dated row on the page from Jan 1 of the year before the
 * last row's year, except the weekly Export Sales and Crop Progress rows (a
 * subscriber's calendar does not want 80 weekly events; the homepage strip
 * builds those from its own weekly rule). A row with a clock time becomes a
 * one-hour event at that Eastern time, daylight saving applied; "All Day" is
 * an all-day event.
 *
 * Two narrower files come from the same list (2026-10-17, the "Your area" box on
 * /usda-calendar links them): usda-calendar-grain.ics (WASDE, Crop Production,
 * Grain Stocks, Plantings and Acreage, the Outlook Forum, FSA ARC/PLC dates) and
 * usda-calendar-livestock.ics (the livestock and dairy reports plus WASDE).
 *
 *   node scripts/build_usda_ics.mjs          # write all three files
 *   node scripts/build_usda_ics.mjs --check  # exit 1 if any file is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAGE = ROOT + "usda-calendar.html";
const OUT = ROOT + "usda-calendar.ics";

export function readPage(src) {
  const a = src.indexOf("const REPORTS = [");
  const b = src.indexOf("\n  ];", a);
  if (a < 0 || b < 0) throw new Error("REPORTS array not found in usda-calendar.html");
  const reports = vm.runInNewContext("(" + src.slice(a + "const REPORTS = ".length, b + 4) + ")");
  const fsa = (/const FSA_SRC='([^']+)'/.exec(src) || [])[1] || "";
  const mod = (/"dateModified":"(\d{4}-\d{2}-\d{2})"/.exec(src) || [])[1];
  if (!mod) throw new Error("no dateModified on usda-calendar.html");
  return { reports: JSON.parse(JSON.stringify(reports)), fsa, mod };
}

/* US Eastern offset in hours for a date: DST from the 2nd Sunday of March to
   the 1st Sunday of November (the page's etOffset()). */
function etOffsetHours(ds) {
  const y = +ds.slice(0, 4);
  const nthSun = (mo, n) => { const d = new Date(Date.UTC(y, mo, 1)); return 1 + ((7 - d.getUTCDay()) % 7) + (n - 1) * 7; };
  const st = Date.UTC(y, 2, nthSun(2, 2)), en = Date.UTC(y, 10, nthSun(10, 1));
  const t = Date.UTC(y, +ds.slice(5, 7) - 1, +ds.slice(8, 10));
  return t >= st && t < en ? 4 : 5;
}
function clock(ts) {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(String(ts || ""));
  if (!m) return null;
  let h = +m[1];
  if (/PM/i.test(m[3]) && h !== 12) h += 12;
  if (/AM/i.test(m[3]) && h === 12) h = 0;
  return { h, mi: +m[2] };
}
const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const slug = (s) => String(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/* RFC 5545 TEXT: backslash, semicolon and comma escaped, newline as \n */
const text = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/* fold at 75 octets, continuation lines start with one space */
function fold(line) {
  const out = [];
  let cur = "", n = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; n = 0; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}
/* UIDs the hand-kept file used, kept so a subscriber's calendar updates the
   same event instead of adding a twin. */
const UID_NAME = {
  "WASDE": "wasde-report",
  "2027 ARC/PLC signup opens": "arc-plc-2027-signup-opens",
  "2026 ARC/PLC signup deadline": "arc-plc-2026-signup-deadline",
  "2027 ARC/PLC signup deadline": "arc-plc-2027-signup-deadline",
};

export const SETS = {
  grain: { types: ["wasde", "supply", "stocks", "plantings", "outlook", "fsa"], name: "USDA Grain Reports - AGSIST",
    desc: "WASDE, Crop Production, Grain Stocks, Prospective Plantings and Acreage, the Outlook Forum and FSA ARC/PLC signup dates. No livestock, dairy, international or weekly reports. Built from the list on agsist.com/usda-calendar" },
  livestock: { types: ["livestock", "wasde"], name: "USDA Livestock and Dairy Reports - AGSIST",
    desc: "Cattle on Feed, Milk Production, Cold Storage and Hogs and Pigs, plus WASDE (it carries the meat and dairy outlook). Built from the list on agsist.com/usda-calendar" },
};
export function buildIcs({ reports, fsa, mod }, set) {
  const S = set ? SETS[set] : null;
  const rows = reports.filter((r) => r && r.date && r.type !== "export" && r.type !== "croprog" && (!S || S.types.includes(r.type)));
  const lastYear = Math.max(...reports.filter((r) => r && r.date && r.type !== "export" && r.type !== "croprog").map((r) => +r.date.slice(0, 4)));
  const cutoff = `${lastYear - 1}-01-01`;
  const keep = rows.filter((r) => r.date >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const dtstamp = mod.replace(/-/g, "") + "T120000Z";
  const L = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AGSIST//USDA Report Calendar//EN", "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH", "X-WR-CALNAME:" + (S ? S.name : "USDA Reports - AGSIST"),
    "X-WR-CALDESC:" + text(S ? S.desc : "WASDE, Crop Production, Grain Stocks, livestock and dairy (Cattle on Feed, Milk Production, Cold Storage, Hogs and Pigs) and international report dates, plus FSA ARC/PLC signup dates. Weekly Crop Progress and Export Sales are not included. Built from the list on agsist.com/usda-calendar"),
    "X-PUBLISHED-TTL:PT48H", "REFRESH-INTERVAL;VALUE=DURATION:PT48H",
  ];
  const seen = new Set();
  for (const r of keep) {
    let uid = `${r.date}-${UID_NAME[r.name] || slug(r.name)}@agsist.com`;
    if (seen.has(uid)) uid = uid.replace("@", `-${slug(r.type)}@`);
    seen.add(uid);
    const isFsa = r.type === "fsa";
    const url = r.link ? "https://agsist.com" + r.link : "https://agsist.com/usda-calendar";
    let desc = (r.desc || "").trim();
    if (isFsa) desc += "\nCompare ARC and PLC for your county: https://agsist.com/arc-plc" + (fsa ? "\nSource: " + fsa : "");
    else desc += "\nDetails: https://agsist.com/usda-calendar" + (r.link ? "\n" + (r.linkText || "More") + ": " + url : "");
    L.push("BEGIN:VEVENT", "UID:" + uid, "DTSTAMP:" + dtstamp);
    const c = clock(r.time);
    if (c) {
      const off = etOffsetHours(r.date);
      const st = new Date(Date.UTC(+r.date.slice(0, 4), +r.date.slice(5, 7) - 1, +r.date.slice(8, 10), c.h + off, c.mi));
      L.push("DTSTART:" + stamp(st), "DTEND:" + stamp(new Date(st.getTime() + 3600000)));
    } else {
      L.push("DTSTART;VALUE=DATE:" + r.date.replace(/-/g, ""));
    }
    L.push("SUMMARY:" + text(r.name + (isFsa ? " (FSA)" : "")), "DESCRIPTION:" + text(desc), "URL:" + (isFsa ? "https://agsist.com/arc-plc" : "https://agsist.com/usda-calendar"), "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const page = readPage(readFileSync(PAGE, "utf8"));
  let stale = 0;
  for (const set of [null, "grain", "livestock"]) {
    const out = set ? ROOT + "usda-calendar-" + set + ".ics" : OUT, f = out.slice(ROOT.length), ics = buildIcs(page, set);
    if (process.argv.includes("--check")) {
      let cur = "";
      try { cur = readFileSync(out, "utf8"); } catch (e) { /* missing counts as stale */ }
      if (cur !== ics) { console.error(f + " is stale: run node scripts/build_usda_ics.mjs"); stale++; }
      else console.log(f + " matches the list on /usda-calendar");
    } else {
      writeFileSync(out, ics);
      console.log(`${f}: ${(ics.match(/BEGIN:VEVENT/g) || []).length} events`);
    }
  }
  if (stale) process.exit(1);
}
