/* "Today and this week" in the hero, beside the futures (Sig, Nov 6, 2026: "a happening today block, for example a
 * link to the COT and some kind of teaser to get people interested, important releases people should be made aware
 * of"). components/happening.js, baked by scripts/seed_static.py happening_seed, styled in css/home.css.
 *   - the COT schedule: happening.js cotRelease() is scripts/cot_calendar.py release_date, every week 2010-2027;
 *   - which releases show, on fixtures and a fixed clock (no test reads today's date): across a weekend, a COT
 *     release moved to Monday by Veterans Day, a Crop Progress moved to Tuesday by Columbus Day; the bake picks the
 *     same rows as the script;
 *   - the teaser is computed from the data (the streak from cot-history, checked against the live file by an
 *     independent count, never a typed number);
 *   - the flip after release: "Out at 3:30 PM ET, updating" until cot.json carries the new week, then "Out today"
 *     with managed money's weekly change in corn, for the rest of that day;
 *   - JS off: the baked rows in index.html say the next release's day and time; the builder rewrites them;
 *   - in Chromium: right of the beans at 1280, right after the futures at 390, no layout shift, the countdown moves
 *     each minute with no aria-live on it, and only a change of state is spoken.
 *   node --test test/home-happening.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import os from "node:os";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const ctx = { module: { exports: {} }, Intl };
vm.runInNewContext(read("components/happening.js"), ctx);
const H = ctx.module.exports;
const plain = (x) => JSON.parse(JSON.stringify(x));

/* an Eastern wall time as an instant (both dates below are standard time, UTC-5; Oct 10 is daylight time, UTC-4) */
const EST = (s) => Date.parse(s + "-05:00");
const EDT = (s) => Date.parse(s + "-04:00");

const ICS = ["BEGIN:VCALENDAR",
  "BEGIN:VEVENT", "DTSTART:20261009T160000Z", "SUMMARY:WASDE", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART:20261110T170000Z", "SUMMARY:Crop Production", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART:20261110T170000Z", "SUMMARY:WASDE", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261111", "SUMMARY:2026 ARC/PLC signup deadline (FSA)", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART:20261120T200000Z", "SUMMARY:Cattle on Feed", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART:20261120T200000Z", "SUMMARY:Milk Production", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART:20261124T200000Z", "SUMMARY:Cold Storage", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART:20261204T133000Z", "SUMMARY:StatCan Crop Production (Canada)", "END:VEVENT",
  "END:VCALENDAR"].join("\r\n");
const COT = (o) => Object.assign({ report_date: "November 03, 2026", next_release: "2026-11-16", next_release_time_et: "15:30",  // pin-ok: inline fixture
  corn: { net: 68768, prev: 81113 } }, o || {});
function hist(nets, last) {      /* weekly rows ending on `last` */
  const end = Date.parse(last + "T00:00:00Z");
  return { history: { corn: nets.map((net, i) => ({ date: new Date(end - (nets.length - 1 - i) * 7 * 864e5).toISOString().slice(0, 10), net })) } };
}
const HIST = hist([414460, 404097, 381220, 329839, 246425, 164423, 81113, 68768], "2026-11-03");  // pin-ok: inline fixture
const DATA = (cot) => ({ cot, hist: HIST, wasde: { release: "2026-10-09", metrics: [{ key: "corn_yield_2627", value: 181.2 }] },  // pin-ok: inline fixture
  cp: { corn: { harvest_pct: 74, harvest_date: "2026-11-01" } } });  // pin-ok: inline fixture
const events = (cot, now) => H.cotEvents(cot, now).concat(H.icsEvents(ICS), H.cpEvents(now));
const rows = (cot, now) => plain(H.words(events(cot, now), DATA(cot), now));

test("cotRelease is cot_calendar.release_date for every Monday and Tuesday as-of date, 2010 to 2027", () => {
  const py = execFileSync("python3", ["-c", `
import sys, json; sys.path.insert(0, 'scripts')
from datetime import date, timedelta
import cot_calendar as C
d, out = date(2010, 1, 4), {}
while d < date(2028, 1, 1):
    for k in (0, 1): out[(d + timedelta(days=k)).isoformat()] = C.release_date(d + timedelta(days=k)).isoformat()
    d += timedelta(days=7)
print(json.dumps(out))`], { cwd: ROOT, encoding: "utf8" });
  const want = JSON.parse(py), bad = Object.keys(want).filter((a) => H.cotRelease(a) !== want[a]);
  assert.ok(Object.keys(want).length > 1800);
  assert.deepEqual(bad.map((a) => `${a}: ${H.cotRelease(a)} vs ${want[a]}`), []);
});

test("across a weekend: Saturday shows Monday's Crop Progress first, then Tuesday's WASDE as one row", () => {
  const now = EST("2026-11-07T12:00:00");
  const r = rows(COT(), now);
  assert.deepEqual(r.map((o) => [o.t, o.w]), [["Crop Progress", "Mon Nov 9, 4:00 PM ET"], ["WASDE and Crop Production", "Tue Nov 10, 12:00 PM ET"]]);  // pin-ok: inline fixture on a fixed clock
  assert.equal(r[0].cd, "in 2 days");
  assert.equal(r[0].x, "Corn harvest was 74% done as of Nov 1.");  // pin-ok: inline fixture
  assert.equal(r[0].href, "/conditions"); assert.equal(r[1].href, "/usda-calendar");
  // no all-day rows, no Cold Storage, no StatCan; the COT nine days out is past the seven-day window
  assert.ok(!r.some((o) => /FSA|Cold|StatCan|COT/.test(o.t)));
  assert.match(H.listHtml(H.words(events(COT(), now), DATA(COT()), now)), /<li class="hap-i hap-all"><a class="hap-a" href="\/usda-calendar"/, "the third slot links the calendar");
});

test("a holiday-moved COT release shows the moved day (Veterans Day week: Monday, not Friday)", () => {
  const now = EST("2026-11-12T10:00:00");
  for (const cot of [COT(), COT({ next_release: undefined })]) {     // from cot.json, and from the port when it is missing
    const r = rows(cot, now);
    assert.equal(r[0].t, "Funds report (COT)");
    assert.equal(r[0].w, "Mon Nov 16, 3:30 PM ET, holiday week");  // pin-ok: inline fixture on a fixed clock
    assert.equal(r[0].cd, "in 4 days");
    assert.equal(r[0].href, "/cot");
    assert.equal(r[1].t, "Crop Progress");
    assert.equal(r.length, 2, "Cattle on Feed is past the seven days");
  }
  // Columbus Day: the Crop Progress due Mon Oct 12 comes out Tuesday
  const oct = rows(COT({ report_date: "October 06, 2026", next_release: "2026-10-09" }), EDT("2026-10-10T09:00:00"));  // pin-ok: inline fixture
  assert.equal(oct[0].t, "Crop Progress");
  assert.equal(oct[0].w, "Tue Oct 13, 4:00 PM ET, holiday week");  // pin-ok: inline fixture on a fixed clock
});

test("the Funds this week ask: on the first row while it is the COT report (countdown, updating, Out today), to the one signup box", () => {
  const ask = (cot, now) => rows(cot, now).map((o) => !!o.ask);
  assert.deepEqual(ask(COT(), EST("2026-11-12T10:00:00")), [true, false], "countdown to the COT report");
  assert.deepEqual(ask(COT(), EST("2026-11-07T12:00:00")), [false, false], "Crop Progress first: no ask");
  const old = COT({ report_date: "October 27, 2026", next_release: "2026-11-06" });  // pin-ok: inline fixture
  assert.equal(rows(old, EST("2026-11-06T15:40:00"))[0].state, "wait");
  assert.equal(ask(old, EST("2026-11-06T15:40:00"))[0], true, "updating");
  assert.equal(rows(COT(), EST("2026-11-06T16:10:00"))[0].state, "out");
  assert.equal(ask(COT(), EST("2026-11-06T16:10:00"))[0], true, "Out today");
  const h = H.listHtml(rows(COT(), EST("2026-11-12T10:00:00")));
  assert.match(h, /^<li class="hap-i hap-top hap-asks" data-state="next"><a class="hap-a" href="\/cot"[^]*?<\/a><a class="hap-ask" href="\/cot#cot-signup" data-track="funds-ask">Email me Fridays<\/a><\/li>/);
  assert.equal((h.match(/hap-ask"/g) || []).length, 1, "one ask");
  const src = read("components/happening.js");
  assert.match(src, /gaEvent\('funds_ask', \{ where: 'home_happening' \}\)/);
  assert.doesNotMatch(src, /fetch\([^)]*(subscribe|notice)/, "no signup path of its own");
});

test("the bake picks the same rows as the script, for each clock", () => {
  for (const [now, cot] of [[EST("2026-11-07T12:00:00"), COT()], [EST("2026-11-12T10:00:00"), COT()], [EST("2026-11-06T14:18:00"), COT({ report_date: "October 27, 2026", next_release: "2026-11-06" })],  // pin-ok: inline fixture
    [EDT("2026-10-10T09:00:00"), COT({ report_date: "October 06, 2026", next_release: "2026-10-09" })]]) {  // pin-ok: inline fixture
    const html = execFileSync("python3", ["-c", `
import sys, json; sys.path.insert(0, 'scripts')
from datetime import datetime, timezone
import seed_static as S
a = json.loads(sys.argv[1])
print(S.happening_seed(datetime.fromtimestamp(a['now'] / 1000, timezone.utc), a['cot'], a['ics']))`, JSON.stringify({ now, cot, ics: ICS })], { cwd: ROOT, encoding: "utf8" });
    const ASK = '<a class="hap-ask" href="/cot#cot-signup" data-track="funds-ask">Email me Fridays</a>';
    const lis = [...html.matchAll(/<li class="hap-i[^"]*" data-state="next">.*?<\/li>/g)].map((m) => m[0]);
    const baked = lis.map((li) => {
      const s = li.replace(ASK, "").replace(/<[^>]+>/g, "|"); return s.split("|").filter(Boolean);
    });
    const live = rows(cot, now).filter((o) => o.state === "next");
    // the Funds this week ask: on the first row when it is the COT report, the same markup as the script draws
    assert.deepEqual(lis.map((li) => li.includes(ASK)), live.map((o) => !!o.ask), "the ask where the script puts it");
    assert.deepEqual(lis.map((li) => li.includes(ASK)), lis.map((li, i) => i === 0 && li.includes('href="/cot"')));
    assert.equal(H.listHtml(rows(cot, now)).includes(ASK), live.length > 0 && live[0].t.startsWith("Funds report (COT)"));
    const fmt = (o, i) => (i === 0 ? [o.t, o.w] : [o.w, o.t]);
    // the script says "today"/"tomorrow" where the bake prints the date
    assert.deepEqual(baked.map((b) => b.map((x) => x.replace(/^\w{3} \w{3} \d+, /, ""))), live.map((o, i) => fmt(o, i).map((x) => x.replace(/^(today|tomorrow|\w{3} \w{3} \d+,) /, ""))), new Date(now).toISOString());
    assert.equal((html.match(/<li /g) || []).length, 3, "always three slots");
  }
});

test("the teaser is computed from the data: the streak, its direction and where it breaks", () => {
  const down = H.streak(H.cotRows(HIST, COT()));
  assert.equal(down.n, 7); assert.equal(down.sign, -1);
  const r = (h, cot) => plain(H.words(events(cot, EST("2026-11-12T10:00:00")), Object.assign(DATA(cot), { hist: h }), EST("2026-11-12T10:00:00")))[0].x;
  assert.equal(r(HIST, COT()), "Funds sold corn 7 weeks straight. Did they keep selling?");
  assert.equal(r(hist([100, 200, 300, 400], "2026-11-03"), COT({ corn: { net: 400, prev: 300 } })), "Funds bought corn 3 weeks straight. Did they keep buying?");  // pin-ok: inline fixture
  // one week only: the size of the move instead
  assert.equal(r(hist([500, 400, 412345], "2026-11-03"), COT({ corn: { net: 412345, prev: 400 } })), "Funds bought 411,945 corn contracts net in the week to Nov 3.");  // pin-ok: inline fixture
  // a missing week ends the streak (the 2025 shutdown left holes)
  const gap = { history: { corn: [{ date: "2026-09-01", net: 900 }, { date: "2026-09-08", net: 800 }, { date: "2026-10-27", net: 700 }, { date: "2026-11-03", net: 600 }] } };  // pin-ok: inline fixture
  assert.equal(H.streak(H.cotRows(gap, COT({ corn: { net: 600, prev: 700 } }))).n, 1);
  // history behind cot.json: its week is added from cot.json's own net and prev, never invented
  assert.equal(H.streak(H.cotRows(hist([5, 4, 3], "2026-10-27"), COT({ corn: { net: 1, prev: 3 } }))).n, 3);  // pin-ok: inline fixture

  // the live files: the script's number is the one an independent count of data/cot-history.json gives
  const live = JSON.parse(read("data/cot-history.json")), cot = JSON.parse(read("data/cot.json"));
  const c = live.history.corn.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  let n = 0, sign = 0;
  for (let i = c.length - 1; i > 0; i--) {
    const s = Math.sign(c[i].net - c[i - 1].net);
    if ((Date.parse(c[i].date) - Date.parse(c[i - 1].date)) / 864e5 > 8 || !s || (sign && s !== sign)) break;
    sign = s; n++;
  }
  const lastIso = c[c.length - 1].date, cotIso = H.cotRows({ history: { corn: [] } }, cot).slice(-1)[0]?.date;
  if (cotIso === lastIso) assert.deepEqual([H.streak(H.cotRows(live, cot)).n, H.streak(H.cotRows(live, cot)).sign], [n, sign]);
  assert.doesNotMatch(read("components/happening.js"), /\b\d+ weeks straight/, "no streak typed into the script");
});

test("after the release: updating until cot.json has the new week, then Out today with the weekly change, for the rest of the day", () => {
  const old = COT({ report_date: "October 27, 2026", next_release: "2026-11-06", corn: { net: 81113, prev: 164423 } });  // pin-ok: inline fixture
  const fresh = COT({ report_date: "November 03, 2026", next_release: "2026-11-16", corn: { net: 68768, prev: 81113 } });  // pin-ok: inline fixture
  const before = rows(old, EST("2026-11-06T14:18:00"));
  assert.deepEqual([before[0].t, before[0].w, before[0].cd, before[0].state], ["Funds report (COT)", "today 3:30 PM ET", "in 1 h 12 m", "next"]);
  assert.equal(before[0].x, "Funds sold corn 6 weeks straight. Did they keep selling?");
  const wait = rows(old, EST("2026-11-06T16:05:00"));
  assert.deepEqual([wait[0].t, wait[0].w, wait[0].state], ["Funds report (COT)", "Out at 3:30 PM ET, updating", "wait"]);
  assert.equal(wait[1].t, "Crop Progress");
  const out = rows(fresh, EST("2026-11-06T16:05:00"));
  assert.deepEqual([out[0].w, out[0].state], ["Out today at 3:30 PM ET", "out"]);
  assert.equal(out[0].x, "Funds sold 12,345 corn contracts net in the week to Nov 3.");  // pin-ok: inline fixture
  assert.equal(rows(fresh, EST("2026-11-06T23:59:00"))[0].state, "out", "still there at 11:59 PM ET");
  assert.equal(rows(fresh, EST("2026-11-07T00:01:00"))[0].t, "Crop Progress", "gone the next day");
  // a release this site reads no number from just says it is out
  const coF = plain(H.words(events(fresh, EST("2026-11-20T15:30:00")), DATA(fresh), EST("2026-11-20T15:30:00")));
  assert.ok(coF.some((o) => o.t === "Cattle on Feed and Milk Production" && o.w === "Out today at 3:00 PM ET" && o.state === "out"));
});

test("the home page: the block sits in the futures row, baked, with its script and one quiet live region", () => {
  const home = read("index.html");
  const row = home.slice(home.indexOf('<div class="hb-grid hb-grid--fut">'), home.indexOf('<p class="pl-line"'));
  assert.ok(row.indexOf('id="hb-fs"') < row.indexOf('<div class="hap" id="hap" role="group" aria-labelledby="hap-h">'), "after the beans, inside the futures row");
  assert.match(row, /<ol class="hap-list" id="hap-list"><!--\n--><!--SEED:hp:hap-->/);
  // JS off: the baked first row says a release's day and time as text
  const top = /<li class="hap-i hap-top(?: hap-asks)?" data-state="next"><a class="hap-a" href="([^"]+)"[^>]*><span class="hap-t">([^<]+)<\/span><span class="hap-w"><span class="hap-wt">([^<]+)<\/span>/.exec(row);
  assert.ok(top, "a baked first row");
  assert.match(top[3], /^(Mon|Tue|Wed|Thu|Fri) [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM) ET(, holiday week)?$/);
  // the only aria-live in the block is #hap-say; nothing on the list or the countdown
  assert.deepEqual([...row.matchAll(/<[^>]*aria-live[^>]*>/g)].map((m) => m[0]), ['<span class="visually-hidden" id="hap-say" role="status" aria-live="polite">']);
  assert.doesNotMatch(read("components/happening.js"), /aria-live|setAttribute\(['"]role/);
  assert.match(home, /<script src="\/components\/happening\.js\?v=2" defer><\/script>/);
  assert.ok(!/—/.test(read("components/happening.js")), "no em dash in the script");
  const css = read("css/home.css");
  assert.ok(!/—/.test(css.slice(css.indexOf(".hap{"))), "no em dash in its CSS");
  assert.ok(!/—/.test(row), "no em dash in the block");
});

test("the builder writes the rows into a copy of today's page, and again after a rebuild with nothing changed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hap-"));
  fs.copyFileSync(path.join(ROOT, "index.html"), path.join(dir, "index.html"));
  const run = () => execFileSync("python3", ["-c", `
import sys, os; sys.path.insert(0, os.path.join(sys.argv[2], 'scripts'))
from datetime import datetime, timezone
import seed_static as S
html = S.happening_seed(datetime(2026, 11, 12, 15, 0, tzinfo=timezone.utc), {"report_date": "November 03, 2026", "next_release": "2026-11-16"}, "")
S._write_seeds(os.path.join(sys.argv[1], 'index.html'), {"hp:hap": html})`, dir, ROOT], { cwd: ROOT, encoding: "utf8" });
  run();
  const once = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  assert.match(once, /<span class="hap-wt">Mon Nov 16, 3:30 PM ET, holiday week<\/span>/);  // pin-ok: inline fixture on a fixed clock
  run();
  assert.equal(fs.readFileSync(path.join(dir, "index.html"), "utf8"), once, "idempotent");
  // only the block changed
  const strip = (t) => t.replace(/<!--SEED:hp:hap-->[^]*?<!--\/SEED-->/, "");
  assert.equal(strip(once), strip(read("index.html")));
  fs.rmSync(dir, { recursive: true, force: true });
  // the homepage seed runs it on every bake
  const src = read("scripts/seed_static.py");
  assert.equal((src.match(/seeds\["hp:hap"\] = happening_seed\(\)/g) || []).length, 2, "both branches of seed_homepage");
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon", ".ics": "text/calendar" };
const OLD = COT({ report_date: "October 27, 2026", next_release: "2026-11-06", corn: { net: 81113, prev: 164423 } });  // pin-ok: inline fixture
function serve(files) {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      let u = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (files[u] !== undefined) { res.writeHead(200, { "content-type": TYPES[path.extname(u)] || "text/plain" }); res.end(typeof files[u] === "string" ? files[u] : JSON.stringify(files[u])); return; }
      if (u.endsWith("/")) u += "index.html";
      let f = path.normalize(path.join(ROOT, u));
      if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      if (!fs.existsSync(f) && fs.existsSync(f + ".html")) f += ".html";
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}
const FILES = (cot) => ({ "/data/cot.json": cot, "/data/cot-history.json": hist([414460, 404097, 381220, 329839, 246425, 164423, 81113], "2026-10-27"),  // pin-ok: inline fixture
  "/data/wasde.json": DATA(cot).wasde, "/data/crop-progress.json": DATA(cot).cp, "/usda-calendar.ics": ICS });

async function open(browser, port, width, opts) {
  const c = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", javaScriptEnabled: !opts.nojs });
  await c.route((u) => !u.href.startsWith(`http://127.0.0.1:${port}`), (r) => r.abort());
  await c.addInitScript(() => {
    window.__shift = 0;
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput && e.sources.some((s) => s.node && s.node.closest && s.node.closest("#hap"))) window.__shift += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch (e) {}
  });
  const p = await c.newPage();
  if (!opts.nojs) await p.clock.install({ time: new Date(opts.at) });
  await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  return { c, p };
}
const state = (p) => p.evaluate(() => {
  const b = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, h: r.height }; };
  const cd = document.querySelector("#hap .hap-cd");
  let live = []; for (let e = cd; e; e = e.parentElement) if (e.hasAttribute("aria-live")) live.push(e.id || e.tagName);
  return { hap: b("#hap"), list: b("#hap-list"), fs: b("#hb-fs"), fc: b("#hb-fc"), pl: b(".pl-line"), cd: cd ? cd.textContent : null, wt: (document.querySelector("#hap .hap-wt") || {}).textContent,
    x: (document.querySelector("#hap .hap-x") || {}).textContent, say: document.getElementById("hap-say").textContent, live, shift: window.__shift,
    hs: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});

test("in Chromium: beside the beans at 1280, right after the futures at 390; countdown quiet, state changes spoken; no shift; JS off keeps the baked day and time", { skip, timeout: 180000 }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const srvOld = await serve(FILES(OLD));
  try {
    for (const width of [390, 1280]) {
      const { c, p } = await open(browser, srvOld.address().port, width, { at: EST("2026-11-06T14:18:00") });
      await p.clock.runFor(2000);
      await p.waitForFunction(() => /in 1 h/.test((document.querySelector("#hap .hap-cd") || {}).textContent || ""), null, { timeout: 15000 });
      const a = await state(p);
      if (width >= 1000) {
        assert.ok(a.hap.l >= a.fs.r - 1 && Math.abs(a.hap.t - a.fs.t) < 2, `${width}: right of the beans, same top`);
        assert.ok(a.hap.b - a.fs.t < 200, `${width}: about the height of the futures row (${a.hap.b - a.fs.t})`);
      } else {
        assert.ok(a.hap.t >= Math.max(a.fs.b, a.fc.b) - 1 && a.hap.t - a.fs.b < 12, `${width}: right after the futures`);
        if (a.pl) assert.ok(a.pl.t >= a.hap.b - 1 || a.pl.h === 0, `${width}: before the basis lines`);
      }
      assert.equal(a.hs, 0, `${width}: no sideways scroll`);
      assert.equal(a.wt, "today 3:30 PM ET");
      assert.equal(a.cd, " · in 1 h 12 m");
      assert.equal(a.x, "Funds sold corn 6 weeks straight. Did they keep selling?");
      // the ask: a 44 px target at the right of the title line, inside the block, clear of the title's text
      const k = await p.evaluate(() => {
        const a = document.querySelector("#hap .hap-ask"), t = document.querySelector("#hap .hap-top .hap-t"), hap = document.getElementById("hap");
        if (!a) return null;
        const r = a.getBoundingClientRect(), h = hap.getBoundingClientRect(), rg = document.createRange(); rg.selectNodeContents(t);
        const tr = rg.getBoundingClientRect();
        return { h: r.height, w: r.width, l: r.left, r: r.right, hr: h.right, ht: h.top, t: r.top, textR: tr.right, href: a.getAttribute("href"), text: a.textContent };
      });
      assert.ok(k, `${width}: the ask on the COT row`);
      assert.deepEqual([k.href, k.text], ["/cot#cot-signup", "Email me Fridays"]);
      assert.ok(k.h >= 44 && k.w >= 44, `${width}: 44 px target (${k.w}x${k.h})`);
      assert.ok(k.r <= k.hr + 0.5 && k.t >= k.ht - 0.5, `${width}: inside the block`);
      assert.ok(k.textR <= k.l, `${width}: the title stops short of it`);
      if (process.env.HAP_SHOTS) await p.locator("#hap").screenshot({ path: path.join(process.env.HAP_SHOTS, `home-hap-${width}.png`) });
      assert.deepEqual(a.live, [], "no aria-live on the countdown or anything holding it");
      assert.equal(a.say, "", "nothing spoken on first draw");
      // three minutes: the countdown moves, nothing is spoken, nothing moves
      await p.clock.runFor(3 * 60000);
      const b = await state(p);
      assert.equal(b.cd, " · in 1 h 9 m");
      assert.equal(b.say, "", "the minute is never announced");
      assert.ok(Math.abs(b.hap.h - a.hap.h) < 0.5);
      // past 3:30 with last week's file: the row flips to updating, once, and that is spoken
      await p.clock.runFor(75 * 60000);
      await p.waitForFunction(() => /updating/.test((document.querySelector("#hap .hap-wt") || {}).textContent || ""), null, { timeout: 15000 });
      const w = await state(p);
      assert.equal(w.wt, "Out at 3:30 PM ET, updating");
      assert.match(w.say, /^Funds report \(COT\): Out at 3:30 PM ET, updating/);
      assert.ok(Math.abs(w.hap.h - a.hap.h) < 0.5, `${width}: the same height in every state`);
      assert.equal(w.shift, 0, `${width}: the block moves nothing`);
      await c.close();
    }
    // JS off: the baked first row says the next release's day and time
    const off = await open(browser, srvOld.address().port, 1280, { nojs: true });
    const o = await state(off.p);
    assert.match(o.wt || "", /^(Mon|Tue|Wed|Thu|Fri) [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM) ET/);
    await off.c.close();
  } finally { await browser.close(); srvOld.close(); }
});

test("in Chromium: once cot.json has the new week, the row says Out today with the weekly change", { skip, timeout: 120000 }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const srv = await serve(FILES(COT()));
  try {
    const { c, p } = await open(browser, srv.address().port, 1280, { at: EST("2026-11-06T16:10:00") });
    await p.clock.runFor(2000);
    await p.waitForFunction(() => /Out today/.test((document.querySelector("#hap .hap-wt") || {}).textContent || ""), null, { timeout: 15000 });
    const s = await state(p);
    assert.equal(s.wt, "Out today at 3:30 PM ET");
    assert.equal(s.x, "Funds sold 12,345 corn contracts net in the week to Nov 3.");  // pin-ok: inline fixture
    await c.close();
  } finally { await browser.close(); srv.close(); }
});
