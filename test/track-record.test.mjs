/* The track record table at /scorecard (usda-calendar.html#scorecard), Nov 6, 2026: scripts/build_track_record.py
 * reads the public forecast record and writes the block between the TRACK markers. Synthetic record only
 * (test/fixtures/track-record/make.py), never live data. In Chromium at 390 and 1280 px every outside host is
 * refused and service workers are blocked (BUILD-RULES 58). TR_SHOTS=<dir> saves screenshots.
 *
 *   PLAYWRIGHT_PATH=... CHROMIUM_PATH=... node --test test/track-record.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PLACES_ROUTE } from "./fixtures/places-mock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function built() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trk-"));
  let r = spawnSync("python3", [path.join(ROOT, "test/fixtures/track-record/make.py"), path.join(tmp, "ad")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  fs.copyFileSync(path.join(ROOT, "usda-calendar.html"), path.join(tmp, "usda-calendar.html"));
  r = spawnSync("python3", [path.join(ROOT, "scripts/build_track_record.py"), "--data", path.join(tmp, "ad"),
    "--page", path.join(tmp, "usda-calendar.html"), "--today", "2026-11-06"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return tmp;
}
const blockOf = (s) => s.slice(s.indexOf("<!--TRACK:start-->"), s.indexOf("<!--/TRACK-->"));

test("selftest: Wilson interval, withholding, status, a broken or widened record refused", () => {
  assert.match(execFileSync("python3", ["scripts/build_track_record.py", "--selftest"], { cwd: ROOT, encoding: "utf8" }), /passed/);
});

test("the page carries one TRACK block inside the scorecard section, where /scorecard lands", () => {
  const s = fs.readFileSync(path.join(ROOT, "usda-calendar.html"), "utf8");
  assert.equal(s.split("<!--TRACK:start-->").length, 2);
  assert.equal(s.split("<!--/TRACK-->").length, 2);
  const sec = s.indexOf('id="scorecard"'), at = s.indexOf("<!--TRACK:start-->");
  assert.ok(sec > 0 && at > sec && at - sec < 200, "the block opens the #scorecard section");
  const b = blockOf(s);
  assert.match(b, /id="tr-h">Every AGSIST forecast, graded</);
  assert.ok(!/<details[^>]*\bopen\b/.test(b), "Sources stay closed by default (Sig, Nov 5)");
  assert.ok(!/—/.test(b), "no em dash");
  assert.ok(!/<a\s/i.test(b), "no link to a data source");
});

test("from a synthetic record: shown rates, withheld rates, baselines beside each, no method words", () => {
  const tmp = built();
  const b = blockOf(fs.readFileSync(path.join(tmp, "usda-calendar.html"), "utf8"));
  const card = (fc) => { const m = b.match(new RegExp(`<li class="tr-c" data-fc="${fc}">[\\s\\S]*?</li>`)); assert.ok(m, fc); return m[0]; };
  assert.match(card("dirx"), /14 of 14 right, 100% \(95%: 78% to 100%\)/);
  assert.match(card("dirx"), /Always down: 9 of 14, 64%/);
  assert.match(card("dirx"), /tr-st live">Live</);
  // under its minimum: no rate at all, only the count
  assert.match(card("diry"), /Building: 5 of 40 graded/);
  assert.ok(!/%/.test(card("diry").replace(/<dt>[^<]*<\/dt>/g, "")), "no percentage for a building forecast");
  assert.match(card("lvl"), /5\.7% vs 4\.4% for no change \(13 graded\)/);
  assert.match(card("lvl"), /9 of 13 inside, 69%/);
  assert.match(card("lvl"), /Quiet<\/span> <span class="tr-why">\(does not beat its baseline\)/);
  // ordered Live, Quiet, Building
  assert.ok(b.indexOf('data-fc="dirx"') < b.indexOf('data-fc="lvl"') && b.indexOf('data-fc="lvl"') < b.indexOf('data-fc="diry"'));
  for (const w of ["signal", "percentile", "trend", "weight", "feature", "crowded", "threshold", "model v"])
    assert.ok(!b.replace(/<style>[\s\S]*?<\/style>/, "").toLowerCase().includes(w), "no method word: " + w);
  assert.match(b, /Record as of Sep 5, 2026\./);
  assert.ok(!/baselines were fixed/.test(b), "the baseline sentence lives in the page's one fold (test/calendar-terms-fold.test.mjs)");
  assert.ok(!/before any grade/i.test(b));
  // a direction call with no baseline fixed in advance: said so, plus one comparison labelled after the fact; a tie is left out
  assert.match(card("dirz"), /<dt>Simple baseline<\/dt><dd>No baseline fixed in advance<\/dd>/);
  assert.match(card("dirz"), /<dt>For comparison, after the fact<\/dt><dd>Prices rose in 7 of 13; always saying up would have been right 54%\.<\/dd>/);
  assert.match(card("dirz"), /7 of 13 right, 54%/);
  assert.match(card("dirz"), /Locked \/ graded with an outcome<\/dt><dd>14 \/ 14</);
  assert.ok(!b.includes("<details"), "no fold inside the record: the one Sources and terms fold is at the bottom of the page");
  // "no change" is never shown as a direction call's baseline, and nothing claims a "best" baseline
  for (const fc of ["dirx", "diry", "dirz"]) assert.ok(!/No change/.test(card(fc)), fc + " shows no no-change direction baseline");
  assert.ok(!/best baseline|Best simple/i.test(b));
});

test("a record with a field outside the public list is refused and the page is left as it was", () => {
  const tmp = built();
  const page = path.join(tmp, "usda-calendar.html"), before = fs.readFileSync(page, "utf8");
  const f = path.join(tmp, "ad/forecasts/forecast-record.jsonl");
  const lines = fs.readFileSync(f, "utf8").trim().split("\n");
  const r0 = JSON.parse(lines[0]); r0.signal = "x";
  fs.writeFileSync(f, [JSON.stringify(r0), ...lines.slice(1)].join("\n") + "\n");
  const r = spawnSync("python3", [path.join(ROOT, "scripts/build_track_record.py"), "--data", path.join(tmp, "ad"),
    "--page", page, "--today", "2026-11-06"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /not written/);
  assert.equal(fs.readFileSync(page, "utf8"), before);
});

test("in Chromium at 390 and 1280 px: the cards fit, no sideways scroll, Sources closed", { skip }, async () => {
  const tmp = built();
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
  const shots = process.env.TR_SHOTS || "";
  try {
    for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
      await ctx.route(PLACES_ROUTE, (q) => q.abort());
      await ctx.route("**/*", (q) => (q.request().url().startsWith(base) ? q.continue() : q.abort()));
      const pg = await ctx.newPage();
      await pg.goto(`${base}/usda-calendar#scorecard`, { waitUntil: "load" });
      await pg.waitForSelector("#forecast-record .tr-c");
      const m = await pg.evaluate(() => {
        const box = document.getElementById("forecast-record").getBoundingClientRect();
        const cards = [...document.querySelectorAll("#forecast-record .tr-c")].map((c) => c.getBoundingClientRect());
        return { h: box.height, vis: document.querySelector("#forecast-record .tr-c").offsetHeight, vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, left: box.left, right: box.right,
          cards: cards.map((r) => [r.left, r.right]), open: document.querySelector("#forecast-record details").open,
          font: parseFloat(getComputedStyle(document.querySelector("#forecast-record .tr-c dd")).fontSize) };
      });
      assert.ok(m.h > 300 && m.vis > 80, `${width}px: the block is on screen (${m.h}, ${m.vis})`);
      assert.ok(m.sw <= m.vw, `${width}px: page scrolls sideways (${m.sw} > ${m.vw})`);
      for (const [l, r] of m.cards) assert.ok(l >= 0 && r <= m.vw, `${width}px: a card leaves the screen (${l}, ${r})`);
      if (width === 390) assert.ok(m.left >= 12 && m.vw - m.right >= 12, "a side gutter on the phone");
      assert.equal(m.open, false);
      assert.ok(m.font >= 13, "readable on the phone");
      if (shots) {
        fs.mkdirSync(shots, { recursive: true });
        await (await pg.$("#forecast-record")).screenshot({ path: path.join(shots, `track-record-${width}.png`) });
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
});
