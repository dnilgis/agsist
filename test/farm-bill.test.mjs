/* /farm-bill: the page, its data file and components/farm-bill.js.
 *
 * The shipped component runs in a bare context (no document), which loads
 * only its pure render functions, so a green run checks the copy the browser runs.
 *
 *   node --test test/farm-bill.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const html = read("farm-bill.html");
const data = JSON.parse(read("data/farm-bill.json"));
const ctx = { window: {} };
vm.runInNewContext(read("components/farm-bill.js"), ctx);
const FB = ctx.window.AgFarmBill;

const decode = (s) => s
  .replace(/&nbsp;/g, " ").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—")
  .replace(/&rsquo;/g, "’").replace(/&lsquo;/g, "‘").replace(/&ldquo;/g, "“")
  .replace(/&rdquo;/g, "”").replace(/&middot;/g, "·").replace(/&rarr;/g, "→")
  .replace(/&sect;/g, "§").replace(/&hellip;/g, "…").replace(/&amp;/g, "&");
const text = (s) => decode(s.replace(/<[^>]+>/g, "")).replace(/ /g, " ").replace(/\s+/g, " ").trim();
const body = html.slice(html.indexOf("<main"), html.indexOf("</main>"));

test("the baked page matches the data (builder --check)", () => {
  const out = execFileSync("python3", ["scripts/build_farmbill.py", "--check",
    "--html", "farm-bill.html", "--json", "data/farm-bill.json"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /^OK/);
});

test("the Senate bill number is on the page, in the compare header, the FAQ and the JSON-LD", () => {
  assert.match(body, /S\.(&nbsp;| )5526/, "page body");
  assert.match(html.slice(html.indexOf('class="cmp-head"'), html.indexOf("<!--FB:compare-->")), /S\.(&nbsp;| )5526/, "compare header");
  const faq = body.slice(body.indexOf('id="faq"'));
  assert.match(faq, /S\. 5526|S\.&nbsp;5526/, "visible FAQ");
  const ld = html.match(/"@type": "FAQPage".*?<\/script>/s)[0];
  assert.match(ld, /S\. 5526/, "FAQ JSON-LD");
  assert.match(html.match(/"@type":"Article".*?<\/script>/s)[0], /S\. 5526/, "Article JSON-LD about");
});

test("CRS is cited by its newest three-way comparison and its date", () => {
  assert.match(html, /R48918: The 2026 Farm Bill: Comparison of the House and Senate Bills with Current Law<\/a> \(updated Jul 29, 2026[;)]/);
  assert.doesNotMatch(html, /R48918: The 2026 Farm Bill \(H\.R\. 7567\): Comparison with Current Law/, "the old April title is gone");
});

test("no stale 'Senate's June 23 draft' wording", () => {
  assert.doesNotMatch(html, /Senate's June 23|Senate&rsquo;s June 23|Senate’s June 23/);
  assert.doesNotMatch(html, /Senate draft is also described/);
});

test("the Senate conservation cell shows the gains and the EQIP/CSP cut", () => {
  const row = data.compare.find((r) => r.k === "Conservation");
  assert.match(row.s, /50&rarr;60%/);
  assert.match(row.s, /EQIP and CSP/);
  assert.match(row.s, /CRS/);
  assert.ok(html.includes(row.s), "baked into the page");
});

test("Prop 12 and the pesticide-labeling outcome are stated, with the vote", () => {
  const row = data.compare.find((r) => r.k === "Contentious riders");
  assert.match(row.h, /pesticide-labeling preemption/);
  assert.match(row.h, /280&ndash;142/);
  assert.match(row.h, /Prop 12/);
  assert.match(row.s, /Prop 12/);
  assert.doesNotMatch(row.h, /nearly derailed/, "says how the fight ended, not that it happened");
});

test("a dated next-90-days strip sits above the 60-second read, in date order", () => {
  const strip = body.indexOf('class="n90"');
  assert.ok(strip > 0 && strip < body.indexOf('class="tldr"'), "strip before the TL;DR");
  const dates = [...body.matchAll(/<time datetime="(\d{4}-\d{2}-\d{2})">/g)].map((m) => m[1]);
  assert.deepEqual(dates, ["2026-11-03", "2026-11-09", "2026-12-11", "2027-01-01"]);
  for (const n of data.next90) assert.ok(n.means.length > 30, `${n.date} says what it means`);
  assert.equal(data.next90_outcomes.length, 3);
  assert.match(body, /A short extension:<\/b>/);
});

test("the operation picker: six buttons, content only in data, every source resolves", () => {
  const ops = [...body.matchAll(/data-op="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ops, ["corn-soy", "wheat", "dairy", "livestock", "crp", "specialty"]);
  const src = data.byOperation._sources;
  for (const k of ops) {
    const op = data.byOperation[k];
    assert.ok(op && op.lines.length >= 3, `${k} has lines`);
    for (const ln of op.lines) if (ln.src) assert.ok(src[ln.src], `${k}: source ${ln.src} exists`);
    const out = FB.renderOperation(data, k);
    assert.equal((out.match(/<li>/g) || []).length, op.lines.length);
    assert.ok(out.includes(op.label));
    assert.ok(!html.includes(op.lines[0].t), `${k} is not in the HTML (loads on click)`);
  }
  assert.match(FB.renderOperation(data, "dairy"), /Oct 5 to Dec 18, 2026/);
  assert.equal(FB.renderOperation(data, "_sources"), "");
  assert.equal(FB.renderOperation(data, "nope"), "");
  assert.match(body, /<div id="fy-op"[^>]*hidden/);
  assert.match(html, /<script src="\/components\/farm-bill\.js\?v=\d+" defer><\/script>/);
});

test("the twelve titles and the CBO line items load from data behind one button", () => {
  assert.doesNotMatch(body, /class="title-row"/, "titles are not in the HTML");
  assert.doesNotMatch(body, /class="chg-row"/, "ledger rows are not in the HTML");
  assert.match(body, /id="fb-detail-btn"[^>]*aria-expanded="false"/);
  assert.equal(data.titles.length, 12);
  const out = FB.renderDetail(data);
  assert.equal((out.match(/class="title-row"/g) || []).length, 12);
  assert.equal((out.match(/class="chg-row"/g) || []).length, data.ledger.length);
  assert.match(out, /&minus;\$786M/);
  assert.match(out, /EQIP and CSP/, "Senate conservation in the title text too");
  const disc = data.titles.filter((t) => t.disc).map((t) => t.num);
  assert.deepEqual(disc, ["V", "VI", "VIII"]);
});

test("the page got lighter", () => {
  // 91,261 bytes on Oct 14 with the titles and ledger inline. The picker and the
  // 90-day strip were added on top, so the cap is just under where it started.
  // Oct 16: the Oct 1 cards and the sources moved into folds and repeated status copy went, so 86,000.
  // Oct 20: the baked menu grew 215 bytes on every page (Sig approved Everything near me, Yield by state and Farmland sale index), so the cap moves up 500 bytes.
  assert.ok(Buffer.byteLength(html) < 86500, `farm-bill.html is ${Buffer.byteLength(html)} bytes`);
});

test("visible FAQ and FAQ JSON-LD match word for word", () => {
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">\s*(\{"@context": "https:\/\/schema.org", "@type": "FAQPage".*?)\s*<\/script>/s)[1]);
  const vis = [...body.matchAll(/<details[^>]*><summary>(.*?)<\/summary><div class="ans">(.*?)<\/div><\/details>/gs)]
    .map((m) => ({ q: text(m[1]), a: text(m[2]) }));
  assert.equal(vis.length, ld.mainEntity.length);
  ld.mainEntity.forEach((e, i) => {
    assert.equal(text(e.name), vis[i].q, `question ${i + 1}`);
    assert.equal(text(e.acceptedAnswer.text), vis[i].a, `answer ${i + 1}`);
  });
});

test("the aid figure carries its date; no unsourced milk $/cwt cliff number", () => {
  const cell = data.tldr.find((c) => c.k === "Not in either bill");
  assert.match(cell.v, /June/);
  assert.match(cell.v, /as of Oct 15/);
  assert.doesNotMatch(body + JSON.stringify(data), /\$\d+(\.\d+)?\s*(\/|per )\s*cwt/i);
});

test("no em dashes in the page or its data", () => {
  assert.doesNotMatch(body, /—|&mdash;/);
  assert.doesNotMatch(JSON.stringify(data), /—|&mdash;/);
});

test("the phone compare cards label the Senate side with its bill number", () => {
  assert.match(html, /\.cmp-row \.cv\.s::before\{content:"Senate · S\. 5526"\}/);
});

test("Oct 16 accuracy fixes: forward pricing, the COOL vote, loan caps, wheat", () => {
  const all = body + JSON.stringify(data);
  assert.doesNotMatch(all, /forward pricing permanent|make Dairy Forward Pricing permanent/i, "forward pricing runs through 2031, not permanently");
  const dairy = FB.renderOperation(data, "dairy");
  assert.match(dairy, /through 2031<\/b>, not permanently/);
  const cattle = FB.renderOperation(data, "livestock");
  assert.match(cattle, /country-of-origin labeling/);
  assert.match(cattle, /17&ndash;6/);
  assert.match(cattle, /NSAC Aug 6 markup recap/, "the vote carries its source");
  const riders = data.compare.find((r) => r.k === "Contentious riders");
  assert.match(riders.s, /country-of-origin labeling amendment, 17&ndash;6/);
  assert.doesNotMatch(riders.s, /specialty crops, and fertilizer passed/, "the unsourced Aug 6 list is gone");
  const loans = data.compare.find((r) => r.k === "Farm loan limits");
  assert.match(loans.h, /\$3M/); assert.match(loans.h, /\$3\.5M/); assert.match(loans.h, /NALC/);
  const wheat = data.byOperation.wheat.lines.map((l) => l.t).join(" ");
  assert.doesNotMatch(wheat, /money export-promotion money/);
  assert.match(wheat, /more than doubles export-promotion money/);
  for (const k of ["afbf", "nsac", "nalc"]) assert.match(data.byOperation._sources[k], /href="https:\/\//);
});

test("long background sits in folds; the phone page stays short", () => {
  const oct1 = body.slice(body.indexOf('id="oct1"'), body.indexOf("</section>", body.indexOf('id="oct1"')));
  assert.match(oct1, /<details class="fold">[\s\S]*class="o1-grid"/, "Oct 1 cards are in a fold");
  assert.match(oct1, /January 1, 2027/, "the cliff date stays in the visible lede");
  assert.match(body, /<details class="fold">\s*<summary><span class="fold-title">Sources<\/span>/);
  assert.doesNotMatch(body, /class="lede-more"/);
});
