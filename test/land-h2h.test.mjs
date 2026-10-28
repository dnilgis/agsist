/* Land and policy pages, the 2026-10-15 head-to-head fixes.
 *
 * /cash-lease
 *   - Tennessee: six months before the lease ends, so June 30 for a Dec 31
 *     lease (Smith v. Holt, 1945, as UT Extension PB1816 and Tennessee Farm
 *     Bureau summarize it). It used to say "around July 1", a day late.
 *   - Kentucky and Pennsylvania: no farm statute found, so no guessed date;
 *     the note says check with an attorney.
 *   - Iowa: the two 562.6 exceptions (under 40 acres used mainly as an
 *     animal feeding operation; a tenant in default).
 *   - The lease prints on two Letter pages, and the page says two, not one.
 *   - A visible byline.
 *
 * The browser checks need Playwright and Chromium and are skipped without them.
 *
 *   node --test test/land-h2h.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const read = (f) => readFileSync(ROOT + f, "utf8");
// Sig, Oct 18: no name at the top of a page; it sits in one line at the end
const BYLINE = /<p class="by-end"[^>]*>Made by <a href="\/about">Sigurd Lindquist, CCA<\/a>, Chetek, Wisconsin\.<\/p>/;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, path, width = 1280) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.goto(`http://127.0.0.1:${port}${path}`);
  return { pg, errors, ctx };
}

/* ---------------- /cash-lease ---------------- */
const LEASE = read("cash-lease.html");
const RULES = (() => {
  const a = LEASE.indexOf("var RULES={");
  const b = LEASE.indexOf("\n  };", a);
  assert.ok(a > 0 && b > a, "RULES found");
  return vm.runInNewContext("(" + LEASE.slice(a + "var RULES=".length, b + 4) + ")");
})();

test("Tennessee: June 30 for a Dec 31 lease, six months, from Smith v. Holt", () => {
  const d = RULES.TN.d;
  assert.doesNotMatch(d, /JULY 1/, "July 1 is a day late");
  assert.match(d, /6 MONTHS/);
  assert.match(d, /JUNE 30 for a lease that ends December 31/);
  assert.match(d, /Smith v\. Holt, 1945/);
  assert.match(d, /not a statute/);
  assert.match(d, /attorney/);
  assert.equal(RULES.TN.t, "cited", "a court rule, not a statute, stays in the verify tier");
});

test("Kentucky and Pennsylvania: no guessed farm deadline, check with an attorney", () => {
  for (const k of ["KY", "PA"]) {
    assert.match(RULES[k].d, /No farm statute found/, k);
    assert.match(RULES[k].d, /attorney/, k);
    assert.equal(RULES[k].t, "cited", k);
  }
  assert.doesNotMatch(RULES.KY.d, /~late August/);
  assert.match(RULES.PA.d, /not a farm renewal rule/);
});

test("Iowa names the 562.6 exceptions as the statute has them since 2013", () => {
  assert.match(RULES.IA.d, /SEPTEMBER 1/);
  assert.match(RULES.IA.d, /under 40 acres whose main use is an animal feeding operation/);
  assert.match(RULES.IA.d, /tenant in default/);
  assert.match(RULES.IA.d, /Since 2013, other tracts under 40 acres are covered/);
});

test("the lease is called two pages, the FAQ stays word for word, and there is a byline", () => {
  assert.doesNotMatch(LEASE, /one-page cash lease/);
  assert.match(LEASE, /fillable, printable two-page cash lease/);
  assert.equal((LEASE.match(/A short written lease protects both sides/g) || []).length, 2, "visible FAQ and JSON-LD");
  assert.doesNotMatch(LEASE, /A one-page written lease/);
  assert.match(LEASE, BYLINE);
  assert.match(LEASE, /rechecked 2026-10-15/);
});

test("printed on Letter in Chromium, the lease is two whole pages: the deal and initials, then sections 9-14 and the signatures", { skip }, async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const st of ["IA", "TN", ""]) {
      const { pg, errors, ctx } = await open(browser, srv.address().port, "/cash-lease");
      if (st) await pg.selectOption("#cl-state-sel", st);
      await pg.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
      await pg.emulateMedia({ media: "print" });
      const pdf = await pg.pdf({ format: "Letter" });
      const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
      assert.equal(pages, 2, `state ${st || "none"}: ${pages} pages`);
      const sig = await pg.$eval(".lease .sig-grid", (e) => getComputedStyle(e).breakInside);
      assert.equal(sig, "avoid");
      // Two whole halves (Sig, Oct 15): page 1 is sections 1-8 and ends with both initials,
      // page 2 always starts clean at section 9. With the forced break, 2 pages in all means neither half spills.
      const halves = await pg.evaluate(() => {
        const p2 = document.querySelector(".lease .lease-p2");
        const nums = (root, inP2) => [...document.querySelectorAll(".lease h3")]
          .filter((h) => p2.contains(h) === inP2).map((h) => parseInt(h.textContent, 10));
        return { brk: getComputedStyle(p2).breakBefore, one: nums(document, false), two: nums(document, true),
          foot: getComputedStyle(document.querySelector(".lease-pg-foot")).display,
          head: p2.firstElementChild.className };
      });
      assert.equal(halves.brk, "page");
      assert.deepEqual(halves.one, [1, 2, 3, 4, 5, 6, 7, 8]);
      assert.deepEqual(halves.two, [9, 10, 11, 12, 13, 14]);
      assert.equal(halves.foot, "block", "page 1 ends with the initials line");
      assert.equal(halves.head, "lease-pg-head", "page 2 opens with its continued line");
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

/* ---------------- /basis#storage ----------------
 *   - farmdoc's own Oct 7, 2026 conclusion (a crunch is unlikely in 2026),
 *     next to the ratios that cite its method
 *   - a state missing a NASS figure whose published grain already tops its
 *     bins shows as a floor, cut not rounded: Wisconsin "at least 1.03x"
 *     (808.5 / 780 = 1.0366), instead of being dropped
 *   - on a phone the input columns fold into a line under the state
 */
import { execFileSync } from "node:child_process";
const storageHtml = (crunch, today = "2026-10-15") => execFileSync("python3", ["-c",
  "import sys,json;sys.path.insert(0,'scripts');import seed_static as s;print(s.storage_html(json.loads(sys.stdin.read()),sys.argv[1]))", today],
  { cwd: ROOT, input: JSON.stringify(crunch), encoding: "utf8" });
// the frozen Oct 16, 2026 pull, so the hand-checked Wisconsin floor holds after later pulls
const STORE = JSON.parse(read("test/fixtures/storage/2026-10-16.json")).storage;

test("storage: farmdoc's conclusion is printed beside the ratios", () => {
  const h = storageHtml(STORE);
  assert.match(h, /a storage crunch is unlikely in 2026/);
  assert.match(h, /cleared the pressure from September to December in past years/);
  assert.match(h, /fdd100726\.pdf/);
  // the farmdoc line is about 2026 only; another year does not carry it
  const next = JSON.parse(JSON.stringify(STORE)); next.crunch.year = 2027;
  assert.doesNotMatch(storageHtml(next, "2027-10-15"), /unlikely in 2026/);
});

test("storage: Wisconsin is a floor, at least 1.03x, cut not rounded", () => {
  const h = storageHtml(STORE);
  // 2026-10-16: the note names the missing figure (Sept 1 stocks), not just the crop
  assert.match(h, /Wisconsin<\/button> <span class="st-note">no Sept 1 stocks figure for wheat<\/span><span class="st-in">124 stocks \+ 684 crop, 780 bins<\/span><\/td><td class="num">at least 1\.03&times;/);
  assert.doesNotMatch(h, /at least 1\.04/);
  const noRatio = h.match(/No ratio where NASS has no state figure[^<]*/)[0];
  assert.doesNotMatch(noRatio, /Wisconsin/);
  assert.match(noRatio, /Colorado/, "a state whose floor is under 1.00x stays in the no-ratio list");
  // a made-up state: missing stocks, 90 + 0 over 100 = 0.9, no floor shown
  const fx = { crunch: { year: 2026, states: {
    IA: { stocks: { CORN: 100e6 }, fall: { CORN: [1000e6, "YEAR"] }, cap: 1000e6, ratio: 1.1 },
    WI: { stocks: {}, fall: { CORN: [90e6, "YEAR"] }, cap: 100e6, why: "NASS has no state figure for corn" },
    MS: { stocks: {}, fall: { CORN: [101e6, "YEAR"] }, cap: 100e6, why: "NASS has no state figure for corn" },
    CA: { stocks: {}, fall: {}, why: "no on-farm plus off-farm capacity figure" } } } };
  const f = storageHtml(fx);
  assert.match(f, /Mississippi.*at least 1\.01&times;/);
  assert.doesNotMatch(f, /Wisconsin[^,]*at least/);
  assert.match(f, /grows: California, Wisconsin\./);
});

test("storage: the seeded basis page carries the new table and the phone fold", () => {
  const B = read("basis.html");
  assert.match(B, /<table class="bs-tbl bs-st">/);
  assert.match(B, /at least \d\.\d\d&times;/);
  assert.match(B, /@media \(max-width:600px\)\{\n  \.tblscroll table\.bs-st\{min-width:0\}\n  \.bs-st \.st-c\{display:none\}\n  \.bs-st \.st-in\{display:block/);
});

test("storage: at 390 px the table fits with no sideways scroll", { skip }, async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, ctx } = await open(browser, srv.address().port, "/basis#storage", 390);
    await pg.waitForFunction(() => document.getElementById("storage").open);
    const r = await pg.$eval("#storage .tblscroll", (e) => ({ sw: e.scrollWidth, cw: e.clientWidth,
      hidden: getComputedStyle(e.querySelector("td.st-c")).display, line: getComputedStyle(e.querySelector(".st-in")).display }));
    assert.ok(r.sw <= r.cw + 1, `table scrolls sideways: ${r.sw} > ${r.cw}`);
    assert.equal(r.hidden, "none");
    assert.equal(r.line, "block");
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

/* ---------------- /foreign-land ----------------
 *   - the state label reads the last five filing years, not since 2010:
 *     Iowa peaked at 554,032 ac in 2020 and is 509,583 in 2024, so it is not
 *     "GROWING FAST" even though it is +193% since 2010
 *   - the card says AFIDA counts 10+ year leases (wind among them) and that
 *     the filings do not split owned from leased; Iowa says most is leases
 */
const FL = read("components/atlas-foreign.js");   // the foreign-held fold on /farmland-atlas since Oct 23, 2026
const verdicts = (() => {
  const a = FL.indexOf("  var LEASE_NOTE");
  const b = FL.indexOf("  window.AgForeignStates");
  assert.ok(a > 0 && b > a, "LEASE_NOTE and buildVerdicts found");
  const A2F = { IA: "Iowa", TX: "Texas", ND: "North Dakota", ME: "Maine", WI: "Wisconsin" };
  return new Function("__A2F", FL.slice(a, b) + "; return buildVerdicts;")(A2F);
})();
const plain = (h) => h.replace(/<[^>]+>/g, "");

test("foreign-land: Iowa is labeled on recent years, with its 2020 peak and the since-2010 number", () => {
  const v = verdicts(JSON.parse(read("data/afida/county.json")));
  assert.equal(v.IA.word, "HOLDING STEADY SINCE 2020");
  const s = plain(v.IA.sent);
  assert.match(s, /510k acres/);
  assert.match(s, /down 8% from its 2020 peak/);
  assert.match(s, /up 193% since 2010/);
  assert.match(s, /long-term leases, mostly for wind turbines/);
  assert.match(plain(v.TX.sent), /AFIDA counts leases of 10 years or more \(wind turbine leases among them\) as holdings; these filings do not split owned from leased\./);
});

test("foreign-land: the label follows the last five years in a made-up state", () => {
  const c = (y) => ({ "1": { st: "Wisconsin", y } });
  // doubled since 2010, flat since 2020: steady, not growing fast
  assert.equal(verdicts(c({ 2010: 100, 2020: 200, 2022: 205, 2024: 210 })).WI.word, "HOLDING STEADY SINCE 2020");
  // up 60% in the window: growing fast
  assert.equal(verdicts(c({ 2010: 100, 2020: 100, 2024: 160 })).WI.word, "GROWING FAST SINCE 2020");
  // the window starts at the first year it has: 2021 missing, 2022 used
  assert.equal(verdicts(c({ 2010: 100, 2022: 100, 2024: 80 })).WI.word, "SHRINKING SINCE 2022");
  // a peak outside the window is named
  assert.match(plain(verdicts(c({ 2010: 100, 2018: 400, 2020: 200, 2024: 200 })).WI.sent), /down 50% from its 2018 peak/);
});

test("foreign-land: a visible byline on the page that carries it", () => {
  assert.match(read("farmland-atlas.html"), BYLINE);
});

/* ---------------- /harvest-price-tracker#presell ----------------
 *   - no "floor of $4.62": RP is a revenue guarantee figured at the higher of
 *     the projected and harvest price, and the line gives that guarantee
 *   - a cautious 75%-of-APH mark beside the full number, only when it is lower
 */
const HPT = read("harvest-price-tracker.html");
test("presell: the copy says revenue guarantee, not floor; FAQ word for word", () => {
  assert.doesNotMatch(HPT, /inside your floor/);
  assert.doesNotMatch(HPT, /revenue floor under/);
  assert.doesNotMatch(HPT, /What price does the floor use/);
  assert.equal((HPT.match(/What price does the guarantee use\?/g) || []).length, 2);
  assert.equal((HPT.match(/those are the bushels your revenue guarantee is figured on\./g) || []).length, 2);
});

test("presell: Iowa corn, 200 APH, 80%, 500 ac shows the guarantee at the higher price and a cautious mark", { skip }, async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors, ctx } = await open(browser, srv.address().port, "/harvest-price-tracker#presell", 390);
    await pg.waitForFunction(() => document.querySelector("#pd-state option[value=IA]"));
    await pg.selectOption("#pd-state", "IA");
    await pg.waitForFunction(() => !document.getElementById("pd-crop").disabled);
    const crop = await pg.$eval("#pd-crop", (s) => [...s.options].find((o) => /^Corn/.test(o.textContent)).value);
    await pg.selectOption("#pd-crop", crop);
    await pg.fill("#pd-aph", "200"); await pg.dispatchEvent("#pd-aph", "input");
    await pg.selectOption("#pd-cov", "0.80");
    await pg.fill("#pd-acres", "500"); await pg.dispatchEvent("#pd-acres", "input");
    const out = await pg.$eval("#pd-psout", (e) => e.textContent);
    const sub = await pg.$eval("#pd-pssub", (e) => e.textContent);
    assert.equal(out, "160 bu/ac (80,000 bu)");
    assert.doesNotMatch(sub, /floor/);
    const p = Number(sub.match(/projected price \(\$(\d+\.\d+)\)/)[1]);
    const h = sub.match(/harvest price, now (?:running at )?\$(\d+\.\d+)/);
    const price = h ? Math.max(p, Number(h[1])) : p;
    const want = Math.round(160 * price).toLocaleString("en-US");
    assert.match(sub, new RegExp(`inside your revenue guarantee of \\$${want} /ac\\.`));
    assert.match(sub, /It is a guarantee on revenue, not a price for each bushel\./);
    assert.match(sub, /A more cautious mark: 150 bu\/ac \(75,000 bu\), 75% of your APH\./);
    // at 75% coverage the cautious mark equals the full number, so it is left off
    await pg.selectOption("#pd-cov", "0.75");
    assert.doesNotMatch(await pg.$eval("#pd-pssub", (e) => e.textContent), /cautious/);
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

/* ---------------- /tariffs ----------------
 *   - the Jul 6 entry no longer has the US trading away a fentanyl tariff the
 *     Feb 20 entry says the Supreme Court voided, without saying so, and it
 *     says the Oct 1 deal had not happened by the Sep 24 and Sep 28 entries
 *   - Nov 10, 2026 is the truce's original end, not an extension
 */
const TAR = JSON.parse(read("data/tariffs.json"));
const ev = (date) => TAR.timeline.find((t) => t.date === date).event;
test("tariffs: the timeline no longer contradicts itself", () => {
  assert.match(ev("2026-02-20"), /fentanyl tariffs are voided/);
  const jul = ev("2026-07-06");
  assert.match(jul, /Supreme Court had already voided the IEEPA fentanyl tariffs on Feb 20/);
  assert.match(jul, /It had not come off by the Sep 24 and Sep 28 entries above/);
  assert.match(ev("2026-09-24"), /due to end Nov 10/);
  const busan = ev("2025-10-30");
  assert.doesNotMatch(busan, /extended through Nov 10, 2026/);
  assert.match(busan, /set to run one year, to Nov 10, 2026, and is later extended to Jan 10, 2027/);
});
test("tariffs: a visible byline and the CCA in the JSON-LD", () => {
  const T = read("tariffs.html");
  assert.match(T, BYLINE);
  assert.match(T, /"name": "Sigurd Lindquist", "jobTitle": "Certified Crop Adviser \(CCA\)"/);
});

/* ---------------- /usda-quick-stats ----------------
 *   - the query builder lists all 50 states (it queries NASS, which has every
 *     state; the page's own table already has 42), not 31
 *   - a visible byline and the author in the JSON-LD
 */
test("quick stats: the query builder lists all 50 states, and a byline", () => {
  const Q = read("usda-quick-stats.html");
  const sel = Q.slice(Q.indexOf('<select id="qb-state"'), Q.indexOf("</select>", Q.indexOf('<select id="qb-state"')));
  const codes = [...sel.matchAll(/<option value="([A-Z]{2})">/g)].map((m) => m[1]);
  assert.equal(codes.length, 50);
  assert.equal(new Set(codes).size, 50);
  for (const k of ["DE", "MD", "NY", "NJ", "AK", "HI"]) assert.ok(codes.includes(k), k);
  assert.match(Q, BYLINE);
  assert.match(Q, /"author":\{"@type":"Person","name":"Sigurd Lindquist","jobTitle":"Certified Crop Adviser \(CCA\)"/);
});
