/* Rain by county (/rain, /rain/<state>, /rain/<state>/<county>).
 *
 * The fetch and the pages are tested in Python on saved ACIS answers
 * (test/fixtures/rain): gaps, traces, S and A days, a county with no station,
 * a station that missed too many days, no normals, a leap year. This runs
 * those, then holds the shipped files to the builder: whatever is in
 * data/rain is exactly what the pages and sitemap-rain.xml say, and every
 * shipped county page stays small and keeps the answer in the HTML.
 *
 *   node --test test/county-rain.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const py = (args) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("fetch arithmetic and station pick, on saved ACIS answers", () => {
  assert.match(py(["scripts/fetch_county_rain.py", "--selftest"]), /county rain fetch selftest: ok/);
});

test("pages built from the saved answers: answer first, honest gaps, small, structured data", () => {
  assert.match(py(["scripts/build_county_rain.py", "--selftest"]), /county rain pages selftest: ok/);
});

test("shipped data and pages match the builder, and the data passes its check", () => {
  assert.match(py(["scripts/fetch_county_rain.py", "--check"]), /0 problem\(s\)/);
  assert.match(py(["scripts/build_county_rain.py", "--check"]), /match data\/rain/);
});

test("sitemap-rain.xml is in robots.txt; the rain folder has a budget; the workflow exists", () => {
  assert.ok(readFileSync(ROOT + "robots.txt", "utf8").includes("Sitemap: https://agsist.com/sitemap-rain.xml"));
  assert.match(readFileSync(ROOT + "scripts/check_site_budget.py", "utf8"), /"rain":\s*\d+/);
  const wf = readFileSync(ROOT + ".github/workflows/county-rain.yml", "utf8");
  assert.match(wf, /fetch_county_rain\.py/);
  assert.match(wf, /build_county_rain\.py/);
  assert.match(wf, /workflow_dispatch/);
});

// Sig, Oct 23 2026: the county rain pages rebuild every day (they were Mondays only).
test("the rain pages rebuild every day, and the job watcher expects a run every day", () => {
  const wf = readFileSync(ROOT + ".github/workflows/county-rain.yml", "utf8");
  const crons = [...wf.matchAll(/- cron: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(crons.includes("23 13 * * *"), "a run every day at 13:23 UTC: " + crons);
  assert.ok(crons.includes("41 14 2 1 *"), "the Jan 2 finished-year run stays");
  assert.ok(!crons.some((c) => /\*\s+[0-6](-[0-6])?$/.test(c)), "no weekday-only clock left: " + crons);
  assert.doesNotMatch(wf, /Mondays 13:23|# Mondays|Mondays in\n/, "the workflow's schedule notes no longer say the pages run on Mondays");
  const ch = readFileSync(ROOT + "scripts/cron_health.py", "utf8");
  assert.match(ch, /\("county-rain\.yml", \["23 13 \* \* \*", "41 14 2 1 \*"\], 240,/, "cron_health watches the same two clocks");
  const fetch = readFileSync(ROOT + "scripts/fetch_county_rain.py", "utf8");
  assert.match(fetch, /if today\.month == 1:\s+return today\.year - 1, f"\{today\.year - 1\}-12-31"/,
    "every January run, daily now, still fetches the finished year so late reports land");
});

test("every shipped county page is small and has its answer in the HTML", () => {
  const dir = ROOT + "rain";
  if (!existsSync(dir)) return;
  const locs = new Set([...readFileSync(ROOT + "sitemap-rain.xml", "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  for (const st of readdirSync(dir)) {
    if (!statSync(dir + "/" + st).isDirectory()) continue;
    for (const f of readdirSync(dir + "/" + st)) {
      const rel = `rain/${st}/${f}`;
      const html = readFileSync(ROOT + rel, "utf8");
      if (html.includes('name="agsist-pointer"')) continue;   // a county that left the data (test/pointer-pages.test.mjs)
      assert.ok(html.length < 25 * 1024, rel + " is over 25 KB");
      assert.match(html, /<p class="rc-answer"><b>\d+\.\d\d inch(es)?<\/b> of rain/, rel + " has no answer up top");
      assert.ok(!html.includes("—") && !html.includes("&mdash;"), rel + " has an em dash");
      assert.match(html, /<p class="rc-asof">(As of [A-Z][a-z]{2} \d{1,2}, \d{4}, the latest day this [a-z]+ has reported|All of \d{4}, Jan 1 to Dec 31|\d{4}, Jan 1 to [A-Z][a-z]{2} \d{1,2}, the last day reported)<\/p>/, rel + " shows its data date");
      assert.match(html, /read [A-Z][a-z]+ \d{1,2}, \d{4}; updated daily\./, rel + " says it is updated daily, with the day it was read");
      assert.doesNotMatch(html, /rebuilt weekly|once a week/, rel + " still says weekly");
      assert.ok(locs.has("https://agsist.com/" + rel.replace(/\.html$/, "")), rel + " is not in sitemap-rain.xml");
    }
  }
});

// Sig, Oct 23 2026: the pages rebuild every day, the county rain share cards only on Mondays.
test("rain share cards: redrawn on Mondays only, and every page describes the card it points at", async () => {
  const { createHash } = await import("node:crypto");
  const wf = readFileSync(ROOT + ".github/workflows/county-rain.yml", "utf8");
  assert.match(wf, /python3 scripts\/build_share_images\.py --only rain\n/, "the rain run draws only the rain cards, no --rain-now");
  assert.match(wf, /git add -A [^\n]*img\/og\/rain-cards\.json/, "the saved alt is committed with the cards");
  const side = JSON.parse(readFileSync(ROOT + "img/og/rain-cards.json", "utf8"));
  const sha8 = (p) => createHash("sha1").update(readFileSync(ROOT + p)).digest("hex").slice(0, 8);
  for (const [name, e] of Object.entries(side)) {
    assert.match(name, /^rain(-[a-z]{2})?$/, name);
    assert.equal(e.v, sha8(`img/og/${name}.jpg`), name + ": the saved alt is for the file on disk");
    assert.ok(e.alt && !/[—–]/.test(e.alt), name + ": an alt, no dashes");
  }
  const pages = ["rain.html", ...readdirSync(ROOT + "rain").filter((f) => f.endsWith(".html")).map((f) => "rain/" + f)];
  for (const st of readdirSync(ROOT + "rain")) {
    if (statSync(ROOT + "rain/" + st).isDirectory()) for (const f of readdirSync(ROOT + "rain/" + st)) pages.push(`rain/${st}/${f}`);
  }
  let n = 0;
  for (const rel of pages) {
    const html = readFileSync(ROOT + rel, "utf8");
    if (html.includes('name="agsist-pointer"')) continue;
    const m = html.match(/<meta property="og:image" content="https:\/\/agsist\.com\/img\/og\/(rain(?:-[a-z]{2})?)\.jpg\?v=([0-9a-f]{8})">/);
    assert.ok(m, rel + ": og:image is a rain card");
    assert.equal(m[2], sha8(`img/og/${m[1]}.jpg`), rel + ": og:image hash is the file's");
    const alt = (html.match(/<meta property="og:image:alt" content="([^"]*)">/) || [])[1].replace(/&amp;/g, "&");
    assert.equal(alt, side[m[1]].alt, rel + ": the alt saved with the card, with the card's own through day");
    n++;
  }
  assert.ok(n > 2000, "pages checked: " + n);
});

test("rain share cards: a run on a Tuesday leaves every card and the saved alt byte for byte", () => {
  const files = ["img/og/rain-cards.json", "img/og/rain.jpg", ...readdirSync(ROOT + "img/og").filter((f) => /^rain-[a-z]{2}\.jpg$/.test(f)).map((f) => "img/og/" + f)];
  const before = files.map((f) => [f, statSync(ROOT + f).mtimeMs, readFileSync(ROOT + f).toString("base64")]);
  const out = py(["scripts/build_share_images.py", "--only", "rain", "--today", "2026-10-27"]);
  assert.match(out, /county rain cards: \d+ kept as drawn \(redrawn on Mondays; 2026-10-27 is a Tuesday\)/, out);
  assert.match(out, /0 files changed/, out);
  for (const [f, mt, b] of before) {
    assert.equal(statSync(ROOT + f).mtimeMs, mt, f + " was rewritten");
    assert.equal(readFileSync(ROOT + f).toString("base64"), b, f + " changed");
  }
});
