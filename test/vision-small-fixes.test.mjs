/* Vision panel small fixes (ChatGPT vision panel, Oct 25, 2026; HANDOFF Monday item 7).
 *
 * 1  /cash-bids: the Best price tag said "soonest delivery, months differ" even
 *    with Delivery set to one month. It now names the delivery shown.
 * 3  /spray: "at your field now" read like a sensor in the field; the numbers
 *    are a forecast for the reader's location.
 * 4  /rain: the state finder comes before the records list.
 * 5  Atlas: the fallback said the data "has not been published yet" (it has);
 *    it now says the map did not load and links the county directory. /daily:
 *    the line under the loading skeleton links the newest dated issue
 *    (generate_daily.py refreshes it with the recent cards).
 *
 *   node --test test/vision-small-fixes.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

function liftFn(src, name) {
  const i = src.indexOf("function " + name + "(");
  assert.ok(i >= 0, `no function ${name}()`);
  let d = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === "{") d++;
    else if (c === "}" && --d === 0) break;
  }
  return src.slice(i, j + 1);
}

test("cash bids: the Best price tag names the delivery shown", () => {
  const JS = read("components/cash-bids.js");
  const mn = JS.slice(JS.indexOf("var MONTHNAME="), JS.indexOf("];", JS.indexOf("var MONTHNAME=")) + 2);
  const ctx = {};
  vm.runInNewContext(mn + "\n" + liftFn(JS, "delLabel") + "\n" + liftFn(JS, "bestTag") + "\nthis.bestTag=bestTag;", ctx);
  assert.equal(ctx.bestTag("all")[0], "soonest delivery, months differ");
  assert.equal(ctx.bestTag("2026-11")[0], "Nov 2026 delivery");
  assert.equal(ctx.bestTag("harvest")[0], "harvest delivery");
  assert.match(liftFn(JS, "renderBestBids"), /bestTag\(currentDelivery\)/);
  const html = read("cash-bids.html");
  assert.match(html, /<span>Best price<\/span> <span class="bbc-tag" id="bbc-tag"/);
  assert.match(html, /components\/cash-bids\.js\?v=17/);   // 16: fx/quickwins (posted date beside an old price); 15: fx/bidflags (basis line checks the day's futures)
});

test("spray: conditions are estimated for your location, not measured at your field", () => {
  const s = read("spray.html");
  assert.ok(!s.includes("at your field now"), "no 'at your field now'");
  assert.ok(!s.includes("for accurate wind"), "no 'accurate' promise for a forecast");
  assert.match(s, /estimated for your location from the forecast/);
});

test("rain hub: pick your state comes before the records list", () => {
  const h = read("rain.html");
  const st = h.indexOf('<ul class="rc-states">'), rec = h.indexOf('id="records"');
  assert.ok(st > 0, "state list present");
  assert.ok(rec < 0 || st < rec, "state list above the records");
  assert.match(h, /<p class="rc-answer">Pick your state, then your county\./);
});

test("Atlas fallback says the map did not load and links the county directory", () => {
  const a = read("farmland-atlas.html");
  assert.ok(!a.includes("has not been published yet"), "no false 'not published' line");
  assert.match(a, /<div id="fa-nodata" class="fa-notice" hidden>The Atlas map did not load\. For county figures without the map, open the <a href="\/farmland-atlas\/states\/">county directory<\/a>\.<\/div>/);
  assert.ok(read("farmland-atlas/states/index.html").length > 1000, "the directory exists");
});

test("daily: the slow-load line links a dated issue that exists, one of the newest", () => {
  const d = read("daily.html");
  const m = d.match(/<p class="dv3-sk-slow">Still loading\.[^]*?<!--SEED:dailylatest-->\s*<a href="\/daily\/(\d{4}-\d{2}-\d{2})">Read the latest dated briefing, [A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}<\/a>\.\s*<!--\/SEED:dailylatest-->/);
  assert.ok(m, "dated link inside SEED:dailylatest under the skeleton");
  const issues = readdirSync(ROOT + "daily").filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort().reverse();
  assert.ok(issues.includes(m[1] + ".html"), "the linked issue exists");
  assert.ok(issues.slice(0, 7).includes(m[1] + ".html"), "the linked issue is one of the newest");
  const py = read("scripts/generate_daily.py");
  assert.ok(py.includes('(DAILY_PAGE, "dailylatest", render_daily_latest_link(items))'), "generate_daily.py refreshes the link with each publish");
});
