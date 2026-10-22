/* Rain Print layout, Oct 22, 2026 (Sig, yes to all six, after the audit of the options: the page was 13,686 px tall
 * on a phone with no option in the first screen; 10 layers and 19 options spread over a fold of long help).
 *
 * Checks, on the shipped page, from the fixture of the Chetek case (test/fixtures/rp-chetek-oct21.mjs):
 *   - a link with a place opens on the tool: the Layers card is in the first screen at 390 and 1280, the headline below;
 *   - the print stays pinned in view while the options are worked, and a switch reached by a jump or Tab is never under it;
 *   - one tap per layer redraws the print, the count follows, the line under the print says what changed and where;
 *   - a layer that can't change the print is greyed with its one-line reason (Month normals without a usual year;
 *     Plants without a crop); hottest and coldest is "included" while the daily stripes are on;
 *   - All off leaves just the year;
 *   - Watch it draw swaps the print's buttons for Replay, Wind (video only), Make a video, Done, under the print;
 *   - a new visit keeps the headline first, with frost and hottest and coldest on (Sig's defaults);
 *   - no em dashes in the new words.
 *
 *   node --test test/rain-print-layers.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PW, CHROME, serve, mocks } from "./fixtures/rp-chetek-oct21.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "rain-print.html", "utf8");
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const LINK = "/rain-print.html?" + new URLSearchParams({ place: "Chetek, WI", year: "2025", style: "r1" });

async function withPage(fn, { width = 390 } = {}) {
  const srv = await serve(ROOT), base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const context = await browser.newContext({ viewport: { width, height: width > 500 ? 900 : 844 }, serviceWorkers: "block" });
    await context.clock.setFixedTime(new Date("2026-10-21T15:00:00Z"));
    await mocks(context);
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, base, errors);
  } finally { await browser.close(); srv.close(); }
}
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && /CHETEK 10\.6 E|US1WIRS0008/.test(document.getElementById("rp-source").textContent), null, { timeout: 40000 });
const text = (page, id) => page.$eval("#" + id, (el) => (el.hidden ? "" : el.textContent.trim()));
const art = (page) => page.$eval("#rp-art", (el) => el.innerHTML);
const rect = (page, sel) => page.$eval(sel, (el) => { const r = (el.closest("label") || el).getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; });

test("the page: one Layers card, ten layers, the usual year one switch of three, long help in Questions", () => {
  const card = HTML.slice(HTML.indexOf('id="rp-layers"'), HTML.indexOf('id="rp-design"'));
  for (const id of ["rp-normals", "rp-records", "rp-frost", "rp-heat", "rp-ribbon", "rp-plants", "rp-ghost", "rp-hist"]) assert.ok(card.includes('id="' + id + '"'), id + " is a chip in the card");
  assert.equal((card.match(/name="rp-cmp"/g) || []).length, 3, "Off, 30-yr normal, This station");
  assert.equal((card.match(/data-crop="/g) || []).length, 2, "Corn and Soybeans");
  assert.ok(!/<select id="rp-cmp"/.test(HTML), "no second control for the comparison");
  const body = HTML.slice(HTML.indexOf("<body"));
  assert.ok(!/class="rp-opts-note|Frost is a low of 32&deg;F or colder: the last one in spring/.test(body), "the long help left the option list");
  assert.match(HTML, /<summary>What do the layers show\?<\/summary>/);
  const words = card.replace(/<[^>]+>/g, " ");
  assert.ok(!/—|&mdash;/.test(words), "no em dashes");
});

test("phone, a link with a place: the tool first, the layers in the first screen, the print pinned while they are worked", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + LINK);
    await drawn(page);
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains("rp-tool-first")));
    const h1 = await rect(page, "h1"), lay = await rect(page, "#rp-layers"), cmp = await rect(page, 'input[name="rp-cmp"][value="normal"]'), place = await rect(page, "#rp-place");
    assert.ok(cmp.bottom < 844 - 80, "the usual year switch is in the first screen, over the pay bar: " + JSON.stringify(cmp));
    assert.ok(lay.top < place.top && place.top < h1.top, "layers, then the town box, then the headline");
    // scroll down the card: the print stays where it is, under the menu
    const top0 = (await rect(page, "#rp-art")).top;
    await page.evaluate(() => window.scrollTo({ top: document.getElementById("rp-hist-set").getBoundingClientRect().top + scrollY - 500, behavior: "instant" }));
    await page.waitForTimeout(300);
    assert.ok((await rect(page, "#rp-art")).top < 120, "the print is pinned under the menu");
    // a jump to a chip under the print lands below it (scroll padding), and so does Tab
    const pin = await page.$eval("#rp-pv", (el) => Math.round(el.getBoundingClientRect().bottom));
    await page.evaluate(() => window.scrollTo({ top: document.getElementById("rp-hist-set").getBoundingClientRect().top + scrollY - 200, behavior: "instant" }));
    await page.evaluate(() => document.getElementById("rp-hist").scrollIntoView({ behavior: "instant", block: "nearest" }));
    await page.waitForTimeout(200);
    assert.ok((await rect(page, "#rp-hist")).top >= pin, "a jump lands below the pinned print");
    await page.evaluate(() => window.scrollTo({ top: document.getElementById("rp-hist-set").getBoundingClientRect().top + scrollY - 200, behavior: "instant" }));
    const before = (await rect(page, "#rp-hist")).top;
    await page.focus("#rp-hist");
    await page.waitForTimeout(500);
    const after = (await rect(page, "#rp-hist")).top, pin2 = await page.$eval("#rp-pv", (el) => Math.round(el.getBoundingClientRect().bottom));
    assert.ok(after >= pin2, `a switch reached by Tab is below the pinned print: ${before} -> ${after}, the print ends at ${pin2}`);
    assert.deepEqual(errors, []);
  });
});

test("one tap per layer: the print, the count and the line under it follow; greyed layers say why; All off", { skip }, async () => {
  for (const width of [390, 1280]) await withPage(async (page, base, errors) => {
    await page.goto(base + LINK);
    await drawn(page);
    assert.equal(await text(page, "rp-lcount"), "10 in all, 0 on");
    // Month normals goes with a usual year: greyed, with its reason, and a tap says why under the print
    assert.equal(await page.$eval("#rp-normals", (e) => e.disabled), true);
    assert.match(await text(page, "rp-marks-why"), /^Month normals: needs a usual year\./);
    await page.click("label:has(#rp-normals)", { force: true });   // a finger on a greyed chip
    assert.equal(await text(page, "rp-say"), "Month normals: needs a usual year.");
    assert.equal(await page.$eval("#rp-normals", (e) => e.checked), false, "a greyed chip changes nothing");
    // the usual year on: the print compares, Month normals comes alive
    await page.click('label:has(input[name="rp-cmp"][value="normal"])');
    await page.waitForTimeout(300);
    assert.match(await text(page, "rp-say"), /^Usual year: 30-yr normal: a usual year beside yours/);
    assert.equal(await page.$eval("#rp-normals", (e) => e.disabled), false);
    await page.click("label:has(#rp-normals)");
    await page.click("label:has(#rp-frost)");
    await page.waitForFunction(() => /data-rp="frost:0"/.test(document.getElementById("rp-art").innerHTML), null, { timeout: 20000 });
    assert.equal(await text(page, "rp-say"), "Frost dates on: two ticks on the date line, spring and fall.");
    assert.equal(await text(page, "rp-lcount"), "10 in all, 3 on");
    // hottest and coldest: on its own, then included with the daily stripes
    await page.click("label:has(#rp-heat)");
    await page.waitForTimeout(300);
    assert.match(await art(page), /Hottest day: \d+°F/);
    await page.click("label:has(#rp-ribbon)");
    await page.waitForFunction(() => /data-rp="ribbon"/.test(document.getElementById("rp-art").innerHTML), null, { timeout: 20000 });
    assert.equal(await page.$eval("#rp-heat-chip", (e) => e.classList.contains("rp-inc")), true, "included");
    assert.equal(await page.$eval("#rp-heat", (e) => e.disabled), true);
    await page.click("label:has(#rp-heat)", { force: true });
    assert.equal(await text(page, "rp-say"), "Hottest, coldest: included, named on the daily temperature stripes.");
    assert.equal(await text(page, "rp-lcount"), "10 in all, 5 on");
    // Plants without a crop: greyed with its reason; a crop brings them back
    assert.equal(await page.$eval("#rp-plants", (e) => e.disabled), true);
    assert.equal(await text(page, "rp-crop-say"), "Plants: pick corn or soybeans first.");
    // All off: just the year
    await page.click("#rp-alloff");
    await page.waitForTimeout(500);
    assert.equal(await text(page, "rp-lcount"), "10 in all, 0 on");
    assert.equal(await text(page, "rp-say"), "All layers off: just your year.");
    const a = await art(page);
    assert.ok(!/data-rp="(frost:0|ribbon|crop)"/.test(a) && !/Hottest day/.test(a), "nothing but the year");
    assert.deepEqual(errors, []);
  }, { width });
});

test("Watch it draw: Replay, Wind (video only), Make a video and Done take the print's buttons' place, under the print", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + LINK);
    await drawn(page);
    await page.waitForFunction(() => !document.getElementById("rp-watch").disabled, null, { timeout: 10000 });
    await page.click("#rp-watch");
    await page.waitForSelector(".rpd-bar");
    const labels = await page.$$eval(".rpd-bar > button:not(.rpd-hide), .rpd-bar > label", (a) => a.filter((x) => x.offsetParent).map((x) => x.textContent.trim()));
    assert.deepEqual(labels.slice(0, 4), ["Replay", "Wind, video only", "Make a video", "Done"]);
    assert.match(await page.getAttribute(".rpd-wind", "title"), /In the video only, never on the print\./);
    assert.equal(await page.isVisible("#rp-zoom"), false, "the print's own buttons step aside");
    assert.ok(await page.evaluate(() => document.getElementById("rp-pv").contains(document.querySelector(".rpd-bar"))), "under the print, in the pinned stage");
    await page.click(".rpd-bar >> text=Done");
    assert.equal(await page.isVisible("#rp-zoom"), true, "Done brings them back");
    assert.deepEqual(errors, []);
  });
});

test("a new visit keeps the headline first, with frost and hottest and coldest on (Sig's defaults)", { skip }, async () => {
  for (const width of [390, 1280]) await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html");
    await page.waitForTimeout(2500);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("rp-tool-first")), false);
    assert.ok((await rect(page, "h1")).top < (await rect(page, "#rp-art")).top, "the headline first");
    assert.equal(await page.$eval("#rp-frost", (e) => e.checked), true);
    assert.equal(await page.$eval("#rp-heat", (e) => e.checked), true);
    assert.deepEqual(errors, []);
  }, { width });
});
