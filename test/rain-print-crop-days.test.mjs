/* Rain Print crop days, Oct 22, 2026 (audit of the options, the real case): Chetek, WI, 2025, two days
 * marked with words the page does not read as planting or harvest. Corn picked, then the planting day
 * picked by hand from the marked days: the box went blank again, because the design drops a crop until
 * both days are set and in order and the boxes were filled back from the design. The second pick then
 * blanked the first, so the crop, the plant drawings and the usual-year plants only ever came on through
 * day words like "Planted". And Corn with no marked day changed nothing and said nothing.
 *
 * Since the layout of 2026-10-22 (Sig: crop days picked right in the crop row) the days are set in the
 * crop row itself, any day of the print's year; a crop is a chip.
 *
 * In a real browser (skipped without Playwright), from the fixture of the Chetek case:
 *   - planted, then harvested, set by hand: both stay, the crop draws, the design code carries it;
 *   - the reverse order does the same;
 *   - days out of order say so in one line, and nothing is drawn;
 *   - Corn with no days says in one line what it needs, and so does the line under the print;
 *   - a crop picked with marked days whose words say planting and harvest fills them in.
 *
 *   node --test test/rain-print-crop-days.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { PW, CHROME, serve, mocks } from "./fixtures/rp-chetek-oct21.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctx.window = ctx;
vm.runInNewContext(readFileSync(ROOT + "components/rain-print.js", "utf8"), ctx);
const RP = ctx.RainPrint;

let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

async function withPage(fn, { width = 1280 } = {}) {
  const srv = await serve(ROOT), base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const context = await browser.newContext({ viewport: { width, height: width > 500 ? 900 : 844 }, serviceWorkers: "block" });
    await context.clock.setFixedTime(new Date("2026-10-21T15:00:00Z"));
    await mocks(context);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, base, errors);
  } finally { await browser.close(); srv.close(); }
}
const text = (page, id) => page.$eval("#" + id, (el) => (el.hidden ? "" : el.textContent.trim()));
const val = (page, id) => page.$eval("#" + id, (el) => el.value);
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && /CHETEK 10\.6 E|US1WIRS0008/.test(document.getElementById("rp-source").textContent), null, { timeout: 40000 });
const cropDrawn = (page) => page.waitForFunction(() => /data-rp="crop"/.test(document.getElementById("rp-art").innerHTML), null, { timeout: 30000 });
const hasCrop = (page) => page.$eval("#rp-art", (el) => /data-rp="crop"/.test(el.innerHTML));
// two marked days whose words say nothing about planting or harvest, so nothing is guessed
const LINK = "/rain-print.html?" + new URLSearchParams({ place: "Chetek, WI", year: "2025", style: "r1", m1: "2025-05-10 First pass", m2: "2025-10-05 Last load" });
async function openCrop(page, crop = "corn") {
  await page.click('[data-crop="' + crop + '"]');
  await page.waitForTimeout(300);
}
const setDay = async (page, id, v) => { await page.fill("#" + id, v); await page.waitForTimeout(400); };

test("browser: planted, then harvested, set by hand: both stay, and the corn draws", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + LINK);
    await drawn(page);
    await openCrop(page);
    assert.equal(await val(page, "rp-crop-plant"), "", "nothing guessed from words that don't say planting");
    assert.equal(await text(page, "rp-crop-say"), "Corn needs the planting day and the harvest day: set them here.");
    await setDay(page, "rp-crop-plant", "2025-05-10");
    assert.equal(await val(page, "rp-crop-plant"), "2025-05-10", "the planting day stays picked (it went blank)");
    assert.equal(await text(page, "rp-crop-say"), "Set the harvest day too.");
    assert.equal(await hasCrop(page), false, "no crop until both days are in");
    await page.fill("#rp-crop-harvest", "2025-10-05");
    await cropDrawn(page);
    assert.equal(await val(page, "rp-crop-plant"), "2025-05-10", "the planting day is still there");
    assert.equal(await val(page, "rp-crop-harvest"), "2025-10-05");
    assert.equal(await text(page, "rp-crop-say"), "", "nothing to explain once it draws");
    // the plant drawings switch works now
    await page.click("label:has(#rp-plants)");
    await page.waitForTimeout(400);
    const d = RP.decodeCode(await page.textContent("#rp-code"));
    assert.ok(d && d.crop === "corn" && d.cropPlant === "2025-05-10" && d.cropHarvest === "2025-10-05" && d.plants, "the design code carries the crop, its days and the plants");
    assert.deepEqual(errors, [], "no page errors");
  }, { width: 390 });
});

test("browser: the reverse, harvested first then planted, draws the same; out of order says so", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + LINK);
    await drawn(page);
    await openCrop(page);
    await setDay(page, "rp-crop-harvest", "2025-10-05");
    assert.equal(await val(page, "rp-crop-harvest"), "2025-10-05", "the harvest day stays set");
    assert.equal(await text(page, "rp-crop-say"), "Set the planting day too.");
    await page.fill("#rp-crop-plant", "2025-05-10");
    await cropDrawn(page);
    assert.equal(await val(page, "rp-crop-harvest"), "2025-10-05");
    assert.equal(RP.decodeCode(await page.textContent("#rp-code")).crop, "corn");
    // the two days swapped: no crop, and one line says why; the boxes keep what was picked
    await setDay(page, "rp-crop-plant", "2025-10-05");
    await setDay(page, "rp-crop-harvest", "2025-05-10");
    assert.equal(await hasCrop(page), false);
    assert.equal(await val(page, "rp-crop-plant"), "2025-10-05");
    assert.equal(await val(page, "rp-crop-harvest"), "2025-05-10");
    assert.equal(await text(page, "rp-crop-say"), "The harvest day has to come after the planting day.");
    assert.deepEqual(errors, [], "no page errors");
  });
});

test("browser: Corn with no days says what it needs, in one line, in the row and under the print", { skip }, async () => {
  for (const width of [390, 1280]) await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?" + new URLSearchParams({ place: "Chetek, WI", year: "2025", style: "r1" }));
    await drawn(page);
    await openCrop(page);
    assert.equal(await text(page, "rp-crop-say"), "Corn needs the planting day and the harvest day: set them here.");
    assert.equal(await text(page, "rp-say"), "Corn: set the planting and harvest days in the crop row.");
    assert.equal(await page.getAttribute('[data-crop="corn"]', "aria-pressed"), "true");
    await openCrop(page, "soy");
    assert.match(await text(page, "rp-crop-say"), /^Soybeans need the planting day/);
    assert.equal(await page.getAttribute('[data-crop="corn"]', "aria-pressed"), "false", "one crop at a time");
    await openCrop(page, "soy");
    assert.equal(await text(page, "rp-crop-say"), "Plants: pick corn or soybeans first.", "no crop: the plant chips say why they are greyed");
    assert.equal(await page.$eval("#rp-plants", (e) => e.disabled), true);
    assert.equal(await page.isHidden("#rp-cropdays"), true, "no crop, no day boxes");
    assert.deepEqual(errors, [], "no page errors");
  }, { width });
});

test("browser: a crop picked with marked days whose words say so fills its days in", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?" + new URLSearchParams({ place: "Chetek, WI", year: "2025", style: "r1", m1: "2025-05-08 Planted", m2: "2025-10-24 Harvest done" }));
    await drawn(page);
    await openCrop(page);
    await cropDrawn(page);
    assert.equal(await val(page, "rp-crop-plant"), "2025-05-08");
    assert.equal(await val(page, "rp-crop-harvest"), "2025-10-24");
    assert.equal(await page.getAttribute("#rp-crop-plant", "min"), "2025-01-01", "only days of the print's year");
    assert.deepEqual(errors, [], "no page errors");
  }, { width: 390 });
});
