/* One sale, every pertinent detail (Sig, Nov 4, 2026: "when you click I want it to open every detail about the sale
 * that is pertinent"). components/land-sales.js opens a panel from a sale row (the county table, a month table) or a
 * sale card (Atlas, Fast Facts); scripts/build_land_sales.py puts each sale's facts on its row (data-ls) and the
 * county's middle on its table (data-ls-c); the deed's own record comes from the robots-blocked county file, row ri.
 *   - in Chromium, on a synthetic five-state site (test/fixtures/land-detail/make_site.py): each state's panel shows
 *     every field inventoried for that state, grouped; a field the state does not record says "not in the state
 *     record", one our copy does not keep yet says so, none is blank; it opens and closes from the keyboard; no
 *     buyer or seller name shows until "Show buyer and seller" is tapped (a legal that names the seller is blanked);
 *     the layout shift score stays 0; the Atlas card and a month table row open the same panel;
 *   - the panel's SHA-1 is node's, so a row is only trusted when it hashes to its sale id.
 * Every outside host is aborted and service workers are blocked (BUILD-RULES 58).
 *
 *   node --test test/land-detail.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PLACES_ROUTE } from "./fixtures/places-mock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SRC = fs.readFileSync(path.join(ROOT, "components/land-sales.js"), "utf8");

// every field the inventory names, per state, as the panel labels it (PR body: the state x field table)
const COMMON = ["Price", "Price per acre", "Price per tillable acre", "Deed or conveyance type", "Market sale", "Total acres", "Tillable acres",
  "Percent tillable", "Type", "Property class", "Buildings", "Parcels in the sale", "County", "Section, township, range", "Legal description",
  "Street address", "County middle, 24 months", "Counts toward the middle", "Unusual price"];
const WANT = {
  IL: ["Recorded (filed)", "Deed date (instrument date)", "What the declaration says", "Personal property in the price", "Document number",
    "State transfer tax", "Township", "Parcel number (PIN)"],
  IN: ["Recorded", "Sale date on the form", "What the sales disclosure form says", "Sales disclosure form", "Transfer tax",
    "Mailing town (placed at its ZIP)", "Parcel number"],
  WI: ["Recorded", "Conveyance date", "What the return says", "Rights the seller keeps", "Document number", "Transfer fee",
    "Managed forest acres", "Town, village or city", "Parcel number"],
  VT: ["Recorded by the town", "Closing date", "What the return says", "Financing", "Transfer tax return", "Property transfer tax",
    "Town listed value", "Use before and after", "Current use", "Town", "SPAN (the state’s parcel number)"],
  NJ: ["Recorded", "Deed date", "What the deed abstract says", "District and deed serial (SR-1A)", "Realty transfer fee", "Living space",
    "Year built", "Assessed value, main lot", "Municipality", "Block and lot"],
};
const PAGES = { IL: "illinois/testa-county", IN: "indiana/testb-county", WI: "wisconsin/testc-county", VT: "vermont/testd-county", NJ: "new-jersey/teste-county" };

test("the panel's SHA-1 is node's (a row is trusted only when it hashes to its sale id)", () => {
  const ctx = { window: {}, document: { readyState: "complete", addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    head: { appendChild() {} }, createElement() { return {}; } }, location: { pathname: "/", hash: "" }, fetch: () => Promise.reject(new Error("no")) };
  ctx.window.AgHere = null;
  vm.createContext(ctx);
  vm.runInContext(SRC.replace(/window\./g, "window."), ctx);
  const L = ctx.window.AgLandSales;
  for (const s of ["", "abc", "IL|17001|2026R-06532|2026-10-15|489000", "x".repeat(55), "x".repeat(64), "y".repeat(200), "Café ’"]) {
    assert.equal(L.sha1(s), createHash("sha1").update(s, "utf8").digest("hex"), s.slice(0, 20));
  }
  const day = "2026-01-02";   // an inline fixture; the expectation below is computed from it
  assert.equal(L.saleKey("IL", "17001", { doc: null, date: day + "T00" }, 1000.5), ["IL", "17001", "None", day, "1001"].join("|"), "None for no document, as Python's str");
});

function buildSite() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ls-detail-"));
  const out = JSON.parse(execFileSync("python3", ["test/fixtures/land-detail/make_site.py", tmp], { cwd: ROOT, encoding: "utf8", timeout: 300000 }).trim().split("\n").pop());
  return { tmp, ...out };
}

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("in Chromium: every state's panel, every inventoried field, names only on tap, keyboard, no layout shift", { skip }, async () => {
  const { tmp, names, leaks, month } = buildSite();
  assert.equal(leaks, 0, "the builder writes no name outside the robots-blocked folder");
  for (const [st, p] of Object.entries(PAGES)) {
    const html = fs.readFileSync(path.join(tmp, "land-sales", p + ".html"), "utf8");
    assert.doesNotMatch(html, /SYNTH/, st + ": no name in the page");
    assert.doesNotMatch(html, /DOC0\d\d|PART OF SE/, st + ": no document or legal in the indexed page");
  }
  // the builder marks the sale whose legal names its own seller ("h") and puts that legal in the names file, beside the names
  const ilp = fs.readFileSync(path.join(tmp, "land-sales/illinois/testa-county.html"), "utf8");
  const first = /<tr id="s-([0-9a-f]{10})"[^>]*data-ls='([^']*)'/.exec(ilp);
  assert.equal(JSON.parse(first[2].replace(/&amp;/g, "&")).pop(), "h", "IL: the row is marked h");
  const nfile = JSON.parse(fs.readFileSync(path.join(tmp, "data/land/names/il/17999.json"), "utf8"));
  assert.ok(nfile.legals && /EXCEPT TRACT TO/.test(nfile.legals[first[1]]), "IL: the held legal is in the robots-blocked names file");
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    if (!path.extname(p)) p += ".html";
    for (const dir of [tmp, ROOT]) {
      const f = path.normalize(path.join(dir, p));
      if (f.startsWith(dir) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
        res.end(fs.readFileSync(f));
        return;
      }
    }
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  const nameRx = new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
  try {
    for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
      await ctx.route(PLACES_ROUTE, (r) => r.abort());
      await ctx.route("**/*", (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
      await ctx.addInitScript(() => {
        // __cls: every shift without input since the reset below; __clsSale: any shift of a sale row, button or panel, from the start
        window.__cls = 0; window.__clsSale = 0;
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) {
            if (e.hadRecentInput) continue;
            window.__cls += e.value;
            (window.__shifts = window.__shifts || []).push(Math.round(e.startTime) + "ms " + e.value.toFixed(5) + " " + (e.sources || []).map((x) => { const n = x.node && (x.node.nodeType === 3 ? x.node.parentElement : x.node); return n ? n.tagName + "." + n.className : "?"; }).join(","));
            // a shift of the sale rows or panel alone (a page-wide shift of the shell above, which moves the table with
            // everything else, is the page's own and is held to 0 by the settle check below)
            const ours = (e.sources || []).length > 0 && (e.sources || []).every((x) => { const n = x.node && (x.node.nodeType === 3 ? x.node.parentElement : x.node); return n && n.closest && n.closest("#ls-all tbody, .ls-dp, .ls-ul"); });
            if (ours) window.__clsSale += e.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      for (const [st, p] of Object.entries(PAGES)) {
        const pg = await ctx.newPage();
        const errors = [], reqs = [], county = [];
        pg.on("pageerror", (e) => errors.push(String(e)));
        // the network log: no file that carries a name may load before the tap (lead, Nov 4, 2026)
        pg.on("request", (q) => reqs.push(new URL(q.url()).pathname));
        pg.on("response", async (r) => { const u = new URL(r.url()).pathname; if (/^\/data\/land\/[a-z]{2}\/\d{5}\.json$/.test(u)) county.push(await r.text()); });
        await pg.goto(`${base}/land-sales/${p}`);
        await pg.waitForSelector("#ls-all tbody tr:first-child button.ls-dt");
        // the page's own load (its header and email ask, unchanged here) settles first; from here on nothing may shift
        await pg.waitForTimeout(800);
        await pg.evaluate(() => { window.__cls = 0; });
        // keyboard: focus the first sale's date button, Enter opens it
        await pg.focus("#ls-all tbody tr:first-child button.ls-dt");
        await pg.keyboard.press("Enter");
        await pg.waitForSelector(".ls-dp:not([aria-busy])", { timeout: 15000 });
        const got = await pg.evaluate(() => {
          const b = document.querySelector("#ls-all tbody tr:first-child button.ls-dt"), p = document.getElementById(b.getAttribute("aria-controls"));
          const dts = [...p.querySelectorAll("dt")].map((x) => x.textContent), dds = [...p.querySelectorAll("dd")].map((x) => { const c = x.cloneNode(true); c.querySelectorAll(".ls-dn").forEach((n) => n.remove()); return c.textContent.trim(); });
          return { exp: b.getAttribute("aria-expanded"), role: p.getAttribute("role"), groups: [...p.querySelectorAll("h3")].map((x) => x.textContent),
            dts, dds, kv: Object.fromEntries(dts.map((k, i) => [k, dds[i]])), body: document.body.innerText, nm: p.querySelectorAll("button.ls-nm").length,
            bs: ([...p.querySelectorAll("h3")].find((x) => x.textContent === "Buyer and seller") || {}).nextElementSibling?.textContent };
        });
        assert.equal(got.exp, "true", st + ": aria-expanded");
        assert.equal(got.role, "region", st + ": the panel is a labelled region");
        assert.deepEqual(got.groups, ["Sale", "Land", "Where", "How it compares", "Source", "Buyer and seller"], st + ": grouped");
        for (const k of COMMON.concat(WANT[st])) assert.ok(got.dts.includes(k), `${st}: the panel shows "${k}" (has ${got.dts.join(" | ")})`);
        got.dds.forEach((v, i) => assert.ok(v.length > 0, `${st}: "${got.dts[i]}" is never blank`));
        assert.equal(got.kv["Tillable acres"], "not in the state record", st + ": no state records tillable acres, and it says so");
        assert.equal(got.kv["Street address"], "left out", st + ": an address is left out");
        assert.doesNotMatch(got.body, nameRx, st + ": no name before the tap");
        // New Jersey's file names no one (Nov 6): no names button that would load nothing, and the panel says the record lacks them
        assert.equal(got.nm, st === "NJ" ? 0 : 1, st + (st === "NJ" ? ": no names button" : ": the names button is in the panel"));
        if (st === "NJ") assert.equal(got.bs, "not in the state record", "NJ: the panel says the state's record has no names");
        if (st === "IL") {
          assert.equal(got.kv["Personal property in the price"], "not in our copy yet", "IL: a field the state has and our copy does not yet keep says so");
          assert.equal(got.kv["Buildings"], "not in the state record", "IL: the declaration does not say");
          assert.match(got.kv["What the declaration says"], /owns land next to it/);
          assert.match(got.kv["Section, township, range"], /Section 12, T15N, R6E, Fourth Principal Meridian/);
          // the legal names its own seller in another word order: not in the county file, not shown before the tap
          assert.equal(got.kv["Legal description"], "names a buyer or seller: shown with Show buyer and seller");
          assert.doesNotMatch(county[0], /EXCEPT TRACT TO/, "IL: the named legal is not in the county file");
        }
        if (st === "WI") assert.match(got.kv["Rights the seller keeps"], /life estate/);
        if (st === "NJ") {
          assert.equal(got.kv["Legal description"], "not in the state record");
          assert.match(got.kv["County middle, 24 months"], /no county middle/);
          assert.match(got.kv["Assessed value, main lot"], /\$41,200 land/);
        }
        if (st === "VT") assert.equal(got.kv["Financing"], "not in our copy yet");
        if (st === "IN") assert.equal(got.kv["Recorded"], "not in the state record");
        if (st !== "NJ") assert.match(got.kv["County middle, 24 months"], /an acre is .* the county middle of \$[\d,]+ \(\d+ sales/);
        // the panel opened and filled: nothing moved without input (checked before the names tap, whose names file
        // can land after the 500 ms input window and grow the row, as it always has)
        await pg.waitForTimeout(300);
        assert.equal(await pg.evaluate(() => window.__cls), 0, st + " " + width + ": no layout shift without input once the page settled: " + await pg.evaluate(() => (window.__shifts || []).join(" | ")));
        assert.equal(await pg.evaluate(() => window.__clsSale), 0, st + " " + width + ": the rows, their buttons and the panel never shift, load included: " + await pg.evaluate(() => (window.__shifts || []).join(" | ")));
        assert.deepEqual(reqs.filter((u) => /\/names\//.test(u)), [], st + ": no names file requested before the tap");
        assert.equal(county.length, 1, st + ": the panel read its county file once: " + reqs.join(" "));
        assert.doesNotMatch(county[0], /grantor|grantee|SYNTH/, st + ": the county file it read carries no name and no name column");
        // names: on the tap, from the robots-blocked file, in the panel and on the row
        if (st !== "NJ") {
          await pg.click(".ls-dp button.ls-nm");
          await pg.waitForFunction(() => !document.querySelector("#ls-all tbody tr:first-child button.ls-nm") && !document.querySelector(".ls-dp button.ls-nm"));
          assert.match(await pg.evaluate(() => document.querySelector(".ls-dp").innerText), /Seller: SELLER .*SYNTH/, st + ": names after the tap");
          if (st === "IL") assert.match(await pg.evaluate(() => document.querySelector(".ls-dp .ls-lgh").textContent), /EXCEPT TRACT TO SYNTH IL0 SELLER/, "IL: the legal comes with the names");
          assert.ok(reqs.some((u) => /^\/data\/land\/names\/[a-z]{2}\/\d{5}\.json$/.test(u)), st + ": the tap loads the names file");
        } else assert.ok(!fs.existsSync(path.join(tmp, "data/land/names/nj")), "NJ: no names file is written for a state that names no one");
        // Enter again closes it; Escape from inside the panel closes it too and puts the focus back on its button
        await pg.focus("#ls-all tbody tr:first-child button.ls-dt");
        await pg.keyboard.press("Enter");
        assert.equal(await pg.evaluate(() => document.querySelector("tr.ls-dr").hidden), true, st + ": closes from the keyboard");
        await pg.keyboard.press("Enter");
        await pg.focus(".ls-dp");
        await pg.keyboard.press("Escape");
        assert.deepEqual(await pg.evaluate(() => [document.querySelector("tr.ls-dr").hidden, document.activeElement.matches("#ls-all tbody tr:first-child button.ls-dt"),
          document.querySelector("#ls-all tbody tr:first-child button.ls-dt").getAttribute("aria-expanded")]), [true, true, "false"], st + ": Escape closes it and returns the focus");
        assert.deepEqual(errors, [], st + ": no page error");
        await pg.close();
      }
      // honest none (checker, Nov 4): the state's own "none" or 0 reads as such, never "not in the state record"
      const pn = await ctx.newPage();
      await pn.goto(`${base}/land-sales/wisconsin/testc-county`);
      await pn.waitForSelector("#ls-all button.ls-dt");
      const none = await pn.evaluate(() => {
        const L = window.AgLandSales, s = { id: "x", when: "2026-09-22", recorded: 1, acres: 80, price: 600000, ppa: 7500, kind: "f", flag: 0, cu: 0, g: 1, m: "y", county: "T", fips: "1", u: null, w24: null };
        const f = { cols: ["doc", "date", "rr", "mfl", "fin", "pp"], source: "x" };
        const t = (st, r) => { const d = document.createElement("div"); d.innerHTML = L.panelHtml(Object.assign({}, s, { st: st }), f, r, null, "ok"); return d.textContent; };
        return { wi: t("WI", { doc: "1", date: "2026-09-20", rr: "none", mfl: 0 }), vt: t("VT", { doc: "1", date: "2026-09-20", fin: "None" }), il: t("IL", { doc: "1", date: "2026-09-20", pp: 0 }),
          wiGone: t("WI", { doc: "1", date: "2026-09-20" }) };
      });
      assert.match(none.wi, /Rights the seller keepsNone/);
      assert.match(none.wi, /Managed forest acres0 acres/);
      assert.match(none.vt, /FinancingNone/);
      assert.match(none.il, /Personal property in the priceNone/);
      assert.match(none.wiGone, /Rights the seller keepsnot in the state record/, "a field truly absent from the row still says so");
      await pn.close();
      // the Atlas card and a month table row open the same panel
      const pa = await ctx.newPage();
      await pa.goto(`${base}/atlas-test`);
      await pa.waitForSelector(".ls-feat li button.ls-dt");
      await pa.click(".ls-feat li button.ls-dt");
      await pa.waitForSelector(".ls-feat .ls-dp:not([aria-busy])");
      const a = await pa.evaluate(() => ({ t: document.querySelector(".ls-feat .ls-dp").innerText, dts: document.querySelectorAll(".ls-feat .ls-dp dt").length }));
      assert.match(a.t, /Rights the seller keeps/);
      assert.ok(a.dts >= 25, "the card's panel has the same fields: " + a.dts);
      assert.doesNotMatch(a.t, nameRx);
      await pa.close();
      assert.ok(month, "the fixture writes a month page");
      const pm = await ctx.newPage();
      await pm.goto(`${base}/${month.replace(/\.html$/, "")}`);
      await pm.waitForSelector("table tbody tr button.ls-dt");
      await pm.click("table tbody tr button.ls-dt");
      await pm.waitForSelector(".ls-dp:not([aria-busy])");
      const m = await pm.evaluate(() => document.querySelector(".ls-dp").innerText);
      assert.match(m, /County middle, 24 months/);
      assert.doesNotMatch(m, /moved in the newest county file/, "the month row finds its deed");
      assert.doesNotMatch(m, nameRx);
      await pm.close();
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
