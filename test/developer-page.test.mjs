/* /developer, Nov 2, 2026: no public offer of the futures price
 * file or the prediction-market file (both pass on third-party quotes), no
 * upstream provider names, and no recipe. It offers what is AGSIST's to give:
 * the widgets, the USDA report calendar files, the Daily RSS feed, the Farmland
 * Atlas CSV files and llms.txt. data/prices.json itself stays (the site reads it).
 *
 *   node --test test/developer-page.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const html = readFileSync(ROOT + "developer.html", "utf8");

test("no price or prediction-market file offered, no provider names", () => {
  for (const bad of [/prices\.json/, /markets\.json/, /yahoo/i, /polymarket/i, /barchart/i, /JSON market-data feeds/])
    assert.doesNotMatch(html, bad);
  assert.ok(existsSync(ROOT + "data/prices.json"), "the site's own price file is kept");
});

test("Calendar section: every .ics with webcal, Google Calendar and download links", () => {
  assert.match(html, /<h2 id="calendar"[^>]*>Calendar<\/h2>/);
  for (const f of ["usda-calendar.ics", "usda-calendar-grain.ics", "usda-calendar-livestock.ics"]) {
    assert.ok(existsSync(ROOT + f), f);
    assert.ok(html.includes(`href="webcal://agsist.com/${f}"`), f + " webcal");
    assert.ok(html.includes(`href="https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Fagsist.com%2F${f}"`), f + " google");
    assert.ok(html.includes(`href="/${f}" download`), f + " download");
  }
  assert.ok((html.match(/gtag\('event','ics_subscribe'/g) || []).length >= 6, "the calendar page's GA4 event");
});

test("feeds kept and llms.txt linked", () => {
  assert.ok(html.includes("https://agsist.com/feed.xml") && existsSync(ROOT + "feed.xml"), "Daily RSS");
  assert.ok(html.includes('href="/farmland-atlas/data"') && existsSync(ROOT + "farmland-atlas/data/counties.csv"), "Atlas CSVs");
  assert.ok(html.includes('href="/llms.txt"') && existsSync(ROOT + "llms.txt"), "llms.txt");
  assert.doesNotMatch(html, /—/, "no em dash");
});
