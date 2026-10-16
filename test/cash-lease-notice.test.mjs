/* /cash-lease, Oct 16, 2026 head-to-head fixes:
 *   - a notice-to-end-the-lease view on the same page (one shared view for every state):
 *     the serve-by date counted from the day the lease ends, how to serve it, a one-page notice to print
 *   - the law named on every "set by law" note, linked to the statute (each link is also in
 *     references/sources.json so refs.yml keeps a copy)
 *   - full state names for all 50 states
 *
 * Serve-by dates are worked by hand:
 *   IL  4 months before Feb 28, 2023 = Oct 28, 2022 (the worked example in the saved Peoples Company copy)
 *   IA  Sept 1 before a Mar 1, 2027 end = Sep 1, 2026 (Iowa Code 562.6)
 *   KS  30 days before Mar 1, 2027 = Jan 30, 2027; before Mar 1, 2028 (leap year) = Jan 31, 2028
 *   TN  6 months before Dec 31, 2026 = Jun 30, 2026 (the TN note's own example)
 *   IN  3 months before Feb 28, 2027 = Nov 28, 2026
 *   MO  60 days before Dec 31, 2026 = Nov 1, 2026 (Dec has 30 days back to Dec 1, Nov 1 is 60)
 *   OH  Sept 1 before Dec 31, 2026 = Sep 1, 2026
 *   IL  4 months before Jun 30, 2027 = Feb 28, 2027 (no Feb 30, so the earlier day)
 *
 *   node --test test/cash-lease-notice.test.mjs
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
const HTML = readFileSync(ROOT + "cash-lease.html", "utf8");

const ctx = (() => {
  const a = HTML.indexOf("var RULES={");
  const b = HTML.indexOf("/* serveBy:end */");
  assert.ok(a > 0 && b > a, "RULES through serveBy found");
  const c = {};
  vm.runInNewContext(HTML.slice(a, b) + "\nthis.RULES=RULES;this.NAMES=NAMES;this.STATES=STATES;this.serveBy=serveBy;this.NOTICE=NOTICE;", c);
  return c;
})();
const by = (st, end, days) => (ctx.serveBy(st, end, days) || {}).iso;

test("serve-by dates match the hand-worked examples", () => {
  assert.equal(by("IL", "2023-02-28"), "2022-10-28");
  assert.equal(by("IA", "2027-03-01"), "2026-09-01");
  assert.equal(by("KS", "2027-03-01"), "2027-01-30");
  assert.equal(by("KS", "2028-03-01"), "2028-01-31");
  assert.equal(by("TN", "2026-12-31"), "2026-06-30");
  assert.equal(by("IN", "2027-02-28"), "2026-11-28");
  assert.equal(by("MO", "2026-12-31"), "2026-11-01");
  assert.equal(by("OH", "2026-12-31"), "2026-09-01");
  assert.equal(by("IL", "2027-06-30"), "2027-02-28");
  assert.equal(ctx.serveBy("IL", "2023-02-28").early, "2022-10-21", "a week early to allow for the mail");
});

test("oral-only rules, Kansas March 1, and states with no rule are said plainly", () => {
  assert.equal(ctx.serveBy("AR", "2026-12-31").iso, "2026-06-30");
  assert.equal(ctx.serveBy("AR", "2026-12-31").oral, true);
  assert.equal(ctx.serveBy("SD", "2027-03-01").oral, true);
  assert.equal(ctx.serveBy("KS", "2027-02-28").mar1, true, "Kansas notice names March 1");
  assert.equal(ctx.serveBy("KS", "2027-03-01").mar1, false);
  // no state rule: nothing counted, unless the lease's own notice days are filled in
  assert.equal(ctx.serveBy("CO", "2026-12-31").iso, null);
  const lease = ctx.serveBy("CO", "2026-12-31", 90);
  assert.equal(lease.iso, "2026-10-02");
  assert.equal(lease.lease, true);
  // Kentucky and Pennsylvania have no farm statute: never a computed state date
  assert.equal(ctx.serveBy("KY", "2026-12-31").iso, null);
  assert.equal(ctx.serveBy("PA", "2026-12-31").iso, null);
  assert.equal(ctx.serveBy("IA", "2026-02-30"), null, "not a date");
  assert.equal(ctx.serveBy("IA", ""), null);
});

test("every state has its full name; every rule with a date has a note", () => {
  assert.equal(ctx.STATES.length, 50);
  for (const ab of ctx.STATES) assert.ok(ctx.NAMES[ab] && ctx.NAMES[ab].length > 3, ab);
  for (const ab of Object.keys(ctx.RULES)) assert.equal(ctx.RULES[ab].n, ctx.NAMES[ab], ab);
  for (const ab of Object.keys(ctx.NOTICE)) assert.ok(ctx.RULES[ab], `${ab} counts a date but has no note`);
  assert.doesNotMatch(HTML, /\(ab\+', no widely-cited/, "the card no longer prints a bare abbreviation");
});

test("every set-by-law note names its law, and each linked statute is in references/sources.json", () => {
  const src = JSON.parse(readFileSync(ROOT + "references/sources.json", "utf8")).sources.map((r) => r.url);
  for (const [ab, r] of Object.entries(ctx.RULES)) {
    if (r.t === "firm") assert.ok(r.s, `${ab} is set by law but names no law`);
    if (r.u) assert.ok(src.includes(r.u), `${ab}: ${r.u} not in references/sources.json`);
  }
  for (const ab of ["IL", "KS", "IN", "MN", "MO", "WI"]) assert.ok(ctx.RULES[ab].s && ctx.RULES[ab].u, ab);
  assert.equal(ctx.RULES.IL.s, "735 ILCS 5/9-206");
  assert.equal(ctx.RULES.KS.s, "K.S.A. 58-2506");
  assert.equal(ctx.RULES.IN.s, "Ind. Code 32-31-1-2");
  assert.match(HTML, /\(r\.s\?' Law: '\+r\.s/, "the printed lease names the law too");
  // a general tenancy rule is not passed off as a farm statute
  assert.match(ctx.RULES.MN.d, /not a farm statute/);
  for (const ab of ["MN", "MO", "WI"]) assert.equal(ctx.RULES[ab].t, "cited", ab);
});

test("the notice view is on the page, honest and plain", () => {
  assert.match(HTML, /id="notice"/);
  assert.match(HTML, /NOTICE TO END FARM LEASE/);
  assert.match(HTML, /Educational, not legal advice/);
  assert.match(HTML, /certified mail with a return receipt/);
  assert.match(HTML, /href="#notice"/);
  assert.doesNotMatch(HTML, /—/, "no em dashes");
});

test("in Chromium: full names in the picker, a serve-by date, and the notice prints on one Letter page", { skip }, async () => {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const bctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await bctx.newPage();
    const errors = [];
    pg.on("pageerror", (e) => errors.push(String(e)));
    await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
    await pg.goto(`http://127.0.0.1:${port}/cash-lease`);
    const opt = await pg.$eval('#cl-state-sel option[value="CO"]', (o) => o.textContent);
    assert.equal(opt, "Colorado");
    await pg.selectOption("#cl-state-sel", "CO");
    assert.match(await pg.textContent("#cl-state-card"), /^Colorado, no widely-cited/);
    await pg.selectOption("#cl-state-sel", "IL");
    assert.match(await pg.innerHTML("#cl-state-card"), /href="https:\/\/www\.ilga\.gov[^"]+"[^>]*>735 ILCS 5\/9-206/);
    assert.equal(await pg.inputValue("#cl-n-st"), "IL", "the notice follows the state picked above");
    await pg.fill("#cl-n-end", "2027-02-28");
    await pg.fill("#cl-n-to", "Pat Tenant");
    const when = await pg.textContent("#cl-n-when");
    assert.match(when, /Serve by October 28, 2026/);
    assert.match(when, /735 ILCS 5\/9-206/);
    assert.match(await pg.textContent("#cl-notice-paper"), /Pat Tenant/);
    assert.match(await pg.textContent("#cl-notice-paper"), /ends on February 28, 2027/);
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, `no sideways scroll (${sw})`);
    await pg.screenshot({ path: (process.env.LP_SHOTS || "/tmp") + "/cash-lease-notice-390.png", fullPage: false, clip: undefined }).catch(() => {});
    await pg.evaluate(() => document.body.classList.add("cl-printing-notice"));
    await pg.emulateMedia({ media: "print" });
    const leaseShown = await pg.$eval("#lease-form", (e) => getComputedStyle(e.closest(".cl-panel")).display);
    assert.equal(leaseShown, "none", "the lease is not printed with the notice");
    const pdf = await pg.pdf({ format: "Letter" });
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    assert.equal(pages, 1, `notice prints on ${pages} pages`);
    assert.deepEqual(errors, []);
    await bctx.close();
  } finally { await browser.close(); srv.close(); }
});
