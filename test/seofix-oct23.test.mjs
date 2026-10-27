/* Google and AI-answer fixes, Oct 23, 2026 (panel seat on search). Real cases, worked by hand:
 *
 *   1. Barron County WI (55005): data/land/wi/summary.json has med 5,578 on n 42, middle half 4,781
 *      to 7,307, windows cur Oct 1, 2025 to Sep 30, 2026. The Atlas page's meta description opens
 *      "Barron County, WI: 42 recorded farm sales, Oct 2025 to Sep 2026, median $5,578 an acre."
 *      and a visible question + FAQPage markup say the same. Florence WI (55037) has 0 sales in
 *      the window, under the 5-sale minimum: no sales number in its description, FAQ or markup.
 *   2. Barron County's middle is about 6 to 8 miles from Cameron, Almena and Rice Lake, all with
 *      town bid pages: Atlas and rain pages link them (three at most, distance printed).
 *   3. Barron rain page (Oct 18 totals, story written through Oct 13): the lead no longer shows
 *      "through Oct 18" followed by "Through Oct 13"; the story moves below the figures with a
 *      plain line naming each date. Sitemap lastmod for a rain county page is the last day its
 *      station reported (Barron 2026-10-18), not one fixed date.
 *   4. llms.txt: "Numbers as of Oct 15, 2026" with the October Cash Bid Index edition's corn and
 *      soybean counts and averages, equal to data/cash-index/editions.json.
 *
 *   node --test test/seofix-oct23.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));
const meta = (t, n) => (t.match(new RegExp(`<meta name="${n}" content="([^"]*)"`)) || [])[1];
const ld = (t) => JSON.parse(t.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1])["@graph"];

const out = mkdtempSync(join(os.tmpdir(), "seofix-"));
execFileSync("python3", ["scripts/build_atlas_pages.py", "--only", "55005", "55037", "20169", "--out", out],
  { cwd: ROOT, env: { ...process.env, PYTHONHASHSEED: "0" }, stdio: "pipe" });
const atlas = (p) => readFileSync(join(out, "farmland-atlas", p + ".html"), "utf8");
const money = (n) => "$" + n.toLocaleString("en-US");

test("1. Atlas: sales count, median and dates lead the description, from the page's own summary file", () => {
  const sm = json("data/land/wi/summary.json").counties["55005"];
  assert.deepEqual([sm.med.n, sm.med.med, sm.med.q1, sm.med.q3], [42, 5578, 4781, 7307]);
  const t = atlas("wisconsin/barron-county");
  const d = meta(t, "description");
  assert.ok(d.startsWith("Barron County, WI: 42 recorded farm sales, Oct 2025 to Sep 2026, median $5,578 an acre."), d);
  assert.ok(d.length <= 160, "description cap");
  assert.equal(meta(t, "twitter:description"), d);
  assert.match(t, /<title>Barron County, WI Farm Facts · Cash Rent 2026: \$103\/Acre<\/title>/);
  assert.ok(t.match(/<title>(.*?)<\/title>/)[1].length <= 60, "title rule (county_title max 60)");
  // the visible question and the markup say the same
  const q = "What has farmland sold for in Barron County, Wisconsin?";
  const m = t.match(/<h3 id="sales-faq">([^<]*)<\/h3><p>([^<]*)<\/p>/);
  assert.equal(m[1], q);
  assert.match(m[2], /^42 recorded market sales of 20 or more acres, Oct 2025 to Sep 2026, with a median of \$5,578 an acre; the middle half of sales fell between \$4,781 and \$7,307 an acre\./);
  assert.match(m[2], /not a model or an appraisal, and no buyer or seller is named/);
  const faq = ld(t).find((x) => x["@type"] === "FAQPage");
  assert.equal(faq.mainEntity.length, 1);
  assert.equal(faq.mainEntity[0].name, q);
  assert.equal(faq.mainEntity[0].acceptedAnswer.text, m[2]);
  // no names: none of the summary's place names for the large and outlier sales appears in the answer
  for (const row of [...sm.large, ...sm.out]) assert.ok(!m[2].includes(row[4]));
});

test("1. Atlas: under the page's own minimum sample, nothing is printed; states without a summary are unchanged", () => {
  const sm = json("data/land/wi/summary.json");
  assert.ok(!sm.counties["55037"].med, "Florence has no median in the file");
  const t = atlas("wisconsin/florence-county");
  assert.ok(!/recorded farm sale/.test(meta(t, "description")));
  assert.ok(!/sales-faq/.test(t));
  assert.ok(!ld(t).some((x) => x["@type"] === "FAQPage"));
  const ks = atlas("kansas/saline-county");
  assert.ok(!/sales-faq|recorded farm sale/.test(ks));
});

test("1. Atlas: every committed county page that carries sales agrees with its summary file", () => {
  let n = 0;
  for (const [st, dir] of [["wi", "wisconsin"], ["il", "illinois"]]) {
    const sm = json(`data/land/${st}/summary.json`);
    const idx = json("farmland-atlas/data/counties-index.json");
    for (const [fips, , url] of idx) {
      const c = sm.counties[fips];
      if (!url.startsWith(`/farmland-atlas/${dir}/`)) continue;
      const t = read(url.slice(1) + ".html");
      const has = /id="sales-faq"/.test(t);
      assert.equal(has, !!(c && c.med), `${fips} FAQ present only with a median`);
      if (!has) continue;
      n++;
      assert.ok(meta(t, "description").includes(`${c.med.n} recorded farm sale`), fips);
      assert.ok(meta(t, "description").includes(`median ${money(c.med.med)} an acre`), fips);
      assert.ok(meta(t, "description").length <= 160, fips);
      assert.ok(c.med.n >= sm.min_n, fips);
    }
  }
  assert.ok(n >= 100, "county pages with sales: " + n);
});

const townOk = (href) => {
  assert.match(href, /^\/cash-bids\/[a-z-]+\/[a-z0-9-]+$/);
  const f = join(ROOT, href.slice(1) + ".html");
  assert.ok(existsSync(f), href + " is an existing town page");
  assert.ok(!/<meta name="robots"[^>]*noindex/.test(readFileSync(f, "utf8").slice(0, 8000)), href + " is indexable");
};

test("2. Atlas and rain county pages link up to three existing town bid pages, nearest first", () => {
  const re = /Cash bids by town near[^<]*:\s*((?:<a href="[^"]+">[^<]+<\/a> \(\d+ mi\)(?:, )?){1,3})\./;
  for (const t of [atlas("wisconsin/barron-county"), read("rain/wisconsin/barron-county.html")]) {
    const m = t.match(re);
    assert.ok(m, "town line present");
    const hrefs = [...m[1].matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
    assert.deepEqual(hrefs, ["/cash-bids/wisconsin/cameron", "/cash-bids/wisconsin/almena", "/cash-bids/wisconsin/rice-lake"]);
    hrefs.forEach(townOk);
    const mi = [...m[1].matchAll(/\((\d+) mi\)/g)].map((x) => +x[1]);
    assert.deepEqual([...mi].sort((a, b) => a - b), mi, "nearest first");
  }
});

test("2. every town link on every committed rain and Atlas county page resolves, at most three each", () => {
  let pages = 0;
  for (const set of ["rain", "farmland-atlas"]) {
    for (const dir of readdirSync(join(ROOT, set), { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.name === "og" || dir.name === "data") continue;
      for (const f of readdirSync(join(ROOT, set, dir.name))) {
        if (!f.endsWith(".html")) continue;
        const t = read(`${set}/${dir.name}/${f}`);
        const m = t.match(/Cash bids by town near[^<]*:\s*(.*?)\.<\/p>/);
        if (!m) continue;
        const hrefs = [...m[1].matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
        assert.ok(hrefs.length >= 1 && hrefs.length <= 3, `${set}/${dir.name}/${f}: ${hrefs.length}`);
        hrefs.forEach(townOk);
        pages++;
      }
    }
  }
  assert.ok(pages > 2000, "pages with town links: " + pages);
});

test("3. rain: the lead never shows two different dates; the story says what its date is", () => {
  let below = 0, top = 0;
  for (const dir of readdirSync(join(ROOT, "rain"), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const f of readdirSync(join(ROOT, "rain", dir.name))) {
      if (!f.endsWith(".html")) continue;
      const t = read(`rain/${dir.name}/${f}`);
      const ans = t.match(/<p class="rc-answer">(.*?)<\/p>\s*(<p class="rc-story">(.*?)<\/p>)?/);
      if (!ans) { assert.match(t, /name="agsist-pointer"/, f + " has no answer and is not a forwarding page"); continue; }
      const thru = (ans[1].match(/through ([A-Z][a-z]{2} \d{1,2})/) || [])[1];
      if (ans[2]) {
        top++;
        const sd = (ans[3].match(/^Through ([A-Z][a-z]{2} \d{1,2})/) || [])[1];
        assert.ok(!sd || !thru || sd === thru, `${dir.name}/${f}: lead through ${thru}, story through ${sd}`);
      }
      const s = t.match(/<p class="rc-story">Through ([A-Z][a-z]{2} \d{1,2}),[^]*?<\/p><p class="rc-fine">This paragraph was written from the record through ([A-Z][a-z]{2} \d{1,2})\. The totals above run through ([A-Z][a-z]{2} \d{1,2})\.<\/p>/);
      if (s) {
        below++;
        assert.equal(s[1], s[2]);
        assert.notEqual(s[2], s[3]);
        assert.ok(t.indexOf('class="rc-figs"') < t.indexOf('class="rc-story"'), "story sits below the figures");
      }
    }
  }
  assert.ok(below > 500, "pages whose story moved below the figures: " + below);
  // Barron, in its own data's date (the pages rebuild daily, so no fixed day here)
  const b = read("rain/wisconsin/barron-county.html");
  const asOf = new Date(json("data/rain/wi.json").counties["55005"].as_of + "T12:00:00Z");
  const day = asOf.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  assert.match(b, new RegExp(`through ${day}\\. That is \\d+\\.\\d{2} inches (less|more)`), "Barron lead through " + day);
  const bs = b.match(/This paragraph was written from the record through ([A-Z][a-z]{2} \d{1,2})\. The totals above run through ([A-Z][a-z]{2} \d{1,2})\./);
  assert.ok(bs, "Barron says what its story's date is");
  assert.equal(bs[2], day);
});

test("3. rain sitemap: a county page's lastmod is the last day its station reported", () => {
  const sm = read("sitemap-rain.xml");
  const lm = (path) => (sm.match(new RegExp(`<loc>https://agsist.com${path}</loc><lastmod>([^<]*)</lastmod>`)) || [])[1];
  const wi = json("data/rain/wi.json");
  assert.equal(lm("/rain/wisconsin/barron-county"), wi.counties["55005"].as_of);
  assert.match(wi.counties["55005"].as_of, /^\d{4}-\d{2}-\d{2}$/);
  const all = [...sm.matchAll(/<lastmod>([^<]*)</g)].map((x) => x[1]);
  assert.ok(new Set(all).size > 3, "more than one lastmod");
  assert.ok(all.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
  // a state and the hub take their newest county, never a later day than any station reported
  const newest = [...sm.matchAll(/<loc>https:\/\/agsist.com\/rain\/[a-z-]+\/[a-z-]+<\/loc><lastmod>([^<]*)/g)].map((x) => x[1]).sort().pop();
  assert.equal(lm("/rain"), newest);
});

test("4. llms.txt: Numbers as of, equal to the newest Cash Bid Index edition", () => {
  const t = read("llms.txt");
  const ed = json("data/cash-index/editions.json").editions.sort((a, b) => a.month.localeCompare(b.month)).pop();
  const o = ed.crops.corn.overall, s = ed.crops.soybeans.overall;
  assert.match(t, /\n## Numbers as of Oct 15, 2026\n/);
  assert.ok(t.includes(`- Corn: ${o.n.toLocaleString("en-US")} elevators, average cash bid $${o.avg_cash.toFixed(2)}, average basis ${Math.round(o.avg_basis_cents)} cents`));
  assert.ok(t.includes(`- Soybeans: ${s.n.toLocaleString("en-US")} elevators, average cash bid $${s.avg_cash.toFixed(2)}, average basis ${Math.round(s.avg_basis_cents)} cents`));
  assert.ok(t.indexOf("## Numbers as of") < t.indexOf("## What's my grain worth today?"));
  assert.ok(!t.includes("—"));
  // regenerated by the existing llms build, and the build agrees with the file
  assert.match(execFileSync("python3", ["scripts/build_llms_txt.py", "--selftest"], { cwd: ROOT, encoding: "utf8" }), /selftest ok/);
  execFileSync("python3", ["scripts/build_llms_txt.py", "--check"], { cwd: ROOT, stdio: "pipe" });
});
