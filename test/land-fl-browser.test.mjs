/* Florida farm sales in Chromium (Nov 5, 2026): the county land-sales page lists sale months, a sale past the recent
 * years opens its detail panel from the older year's file on agsist-data, and the Field Scout sale panel reads a Florida
 * sale with Florida's labels. Synthetic rows only (test/fixtures/land-fl/make_site.py). A local run reaches no outside
 * host (BUILD-RULES 58): agsist-data answers from the fixture's files, every other host is refused, service workers
 * blocked. FL_SHOTS=<dir> saves 390 px screenshots of both.
 *
 *   PLAYWRIGHT_PATH=... CHROMIUM_PATH=... node --test test/land-fl-browser.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PLACES_ROUTE } from "./fixtures/places-mock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const HOST = "https://dnilgis.github.io/agsist-data/land/fl/";
const DAY = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, 20\d\d\b/;

test("in Chromium: a Florida county page and both sale panels show months and Florida's labels", { skip }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flb-"));
  const r = spawnSync("python3", [path.join(ROOT, "test/fixtures/land-fl/make_site.py"), tmp], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  // the Field Scout sale panel, as the sale dialog draws it (FSLand.saleDetailHTML in .fl-sd), on Field Scout's stylesheets
  fs.writeFileSync(path.join(tmp, "fs-panel.html"), '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<link rel="stylesheet" href="/components/styles.css?v=28"><link rel="stylesheet" href="/components/field-scout.css?v=4"><title>Sale panel</title></head>'
    + '<body><main id="main"><div class="fl-sd" role="dialog" style="position:static;max-height:none"><div id="out" class="fl-p">loading</div></div></main>'
    + '<script src="/field-scout-land.js?v=18"></script><script>FSLand.addCSS();fetch("' + HOST + '12049.json").then(function(r){return r.json();}).then(function(f){'
    + 'var rows=FSLand.rowObjs(f),r=rows.filter(function(x){return x.pid==="FX-001";})[0];'
    + 'document.getElementById("out").innerHTML="<h2>Sale of "+FSLand.fmtDate(r.date,r.dm)+"</h2>"+FSLand.saleDetailHTML(r,f,[]);document.body.setAttribute("data-done","1");});</script></body></html>');
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
  const shots = process.env.FL_SHOTS || "";
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const hosted = [], refused = [];
    await ctx.route(PLACES_ROUTE, (q) => q.abort());
    await ctx.route("**/*", (q) => {
      const u = q.request().url();
      if (u.startsWith(base)) return q.continue();
      if (u.startsWith(HOST)) {
        const f = path.join(tmp, "data/land-hosted/fl", path.basename(new URL(u).pathname));
        hosted.push(path.basename(f));
        if (!fs.existsSync(f)) return q.fulfill({ status: 404, body: "" });
        return q.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(f) });
      }
      refused.push(u);
      return q.abort();
    });
    const pg = await ctx.newPage();
    const errors = [];
    pg.on("pageerror", (e) => errors.push(String(e)));
    await pg.goto(`${base}/land-sales/florida/hardee-county`);
    await pg.waitForSelector("#ls-all tbody tr button.ls-dt");
    const dates = await pg.$$eval("#ls-all tbody tr button.ls-dt", (bs) => bs.map((b) => b.firstChild.textContent));
    assert.deepEqual(dates, ["Aug 2025", "May 2025", "Feb 2025", "Jun 2021"]);   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
    // the 2021 sale: its deed row is in the older year's file, which loads from agsist-data on the tap
    const last = "#ls-all tbody tr:nth-child(4) button.ls-dt";
    await pg.click(last);
    await pg.waitForSelector(".ls-dp:not([aria-busy])", { timeout: 15000 });
    const got = await pg.evaluate(() => {
      const p = document.querySelector(".ls-dp");
      const dts = [...p.querySelectorAll("dt")].map((x) => x.textContent), dds = [...p.querySelectorAll("dd")].map((x) => { const c = x.cloneNode(true); c.querySelectorAll(".ls-dn").forEach((n) => n.remove()); return c.textContent.trim(); });
      return { kv: Object.fromEntries(dts.map((k, i) => [k, dds[i]])), text: p.innerText, w: document.documentElement.scrollWidth };
    });
    assert.equal(got.kv["Sale month"], "Jun 2021");   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
    assert.equal(got.kv["Qualification code"], "02, arm's length, other evidence: qualified sale");
    assert.equal(got.kv["Vacant or improved"], "Vacant land");
    assert.equal(got.kv["Property class"], "Timberland");
    for (const k of ["Recorded", "Deed date", "Transfer tax", "Deed or conveyance type", "Buildings"]) assert.ok(!(k in got.kv), "no " + k + " line for Florida");
    assert.doesNotMatch(got.text.replace(/read [A-Za-z]{3} \d{1,2}, \d{4}/g, ""), DAY);
    assert.doesNotMatch(got.text, /did not load|moved in the newest county file/);
    assert.ok(hosted.includes("12049.json") && hosted.includes("12049-2021.json"), "the county file and its 2021 year load from agsist-data: " + hosted.join(" "));
    assert.ok(got.w <= 390, "no sideways scroll on a phone: " + got.w);
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await pg.screenshot({ path: path.join(shots, "fl-county-page-390.png"), fullPage: true }); }
    const fs2 = await ctx.newPage();
    fs2.on("pageerror", (e) => errors.push(String(e)));
    await fs2.goto(`${base}/fs-panel.html`);
    await fs2.waitForSelector("body[data-done]");
    const panel = await fs2.evaluate(() => ({ text: document.getElementById("out").innerText, w: document.documentElement.scrollWidth }));
    assert.match(panel.text, /Sale of Aug 2025/);   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
    assert.match(panel.text, /Sale month\s+Aug 2025/);   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
    assert.match(panel.text, /Qualification code\s+01, arm's length, deed examined: qualified sale/);
    assert.match(panel.text, /Sale price on the Florida sale data file/);
    assert.match(panel.text, /Vacant or improved\s+Vacant land/);
    assert.doesNotMatch(panel.text, /Register of Deeds|Recorded \(filed\)|Transfer fee|Deed date/);
    assert.doesNotMatch(panel.text.replace(/Our copy was read [A-Za-z]{3} \d{1,2}, \d{4}/, ""), DAY);
    if (shots) await fs2.screenshot({ path: path.join(shots, "fl-field-scout-sale-panel-390.png"), fullPage: true });
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
