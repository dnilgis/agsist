#!/usr/bin/env node
/* bake_lrp.mjs: write the LRP record into lrp.html.
 *
 * components/lrp.js owns the tables and the formatting; this runs that same
 * file (no second copy) against data/lrp/bt.json, meta.json and today.json
 * and writes, between <!--lrp:NAME--> markers in lrp.html:
 *
 *   answer   the first screen: does any coverage choice beat 95 to 100%,
 *            the 95-100% record table, and what it means
 *   when     which sales day today's offers are for
 *   first    the first reinsurance year of each type offered today
 *   pick     "What the numbers would pick" (kept tests, else the closest call)
 *   record   the 95-100% record since RY2021, at today's subsidy
 *   tested   all tests with their odds and verdicts
 *   method   the data, the method, gaps and the subsidy table by year
 *   faq      the visible FAQ; jsonld the WebApplication, FAQPage and
 *            BreadcrumbList JSON-LD, written from the same list word for word
 *
 * so a reader with no JavaScript, and a search engine, see what the page
 * shows. The lrp workflow runs this after every publish of data/lrp.
 *
 *   node scripts/bake_lrp.mjs           write
 *   node scripts/bake_lrp.mjs --check   exit 1 if lrp.html is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { subsidy as btSubsidy, BANDS } from "./lrp_backtest.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAGE = "lrp.html";

export function loadModule() {
  const ctx = { window: {}, Intl, Date };
  vm.runInNewContext(readFileSync(ROOT + "components/lrp.js", "utf8"), ctx);
  return ctx.window.AgLrp;
}

const L = loadModule();
const { esc, money, pct, ymdLong } = L;
const RMA = {
  pm2064: "https://www.rma.usda.gov/policy-procedure/bulletins-memos/product-management-bulletin/2020/pm-20-064",
  pm2229: "https://www.rma.usda.gov/policy-procedure/bulletins-memos/product-management-bulletin/2022/pm-22-029",
  fact: "https://www.rma.usda.gov/sites/default/files/2024-02/LRP-Feeder-Cattle-Fact-Sheet.pdf",
  handbook: "https://www.rma.usda.gov/sites/default/files/2025-04/Livestock%20Risk%20Protection%20Handbook%202026.pdf",
  calendar: "https://www.rma.usda.gov/sites/default/files/2025-12/Livestock-Insurance-Offer-Calendar.pdf",
  fed: "https://www.rma.usda.gov/sites/default/files/2025-04/Livestock%20Risk%20Protection%20Fed%20Cattle%20Endorsement%2026-LRP-FED%20CATTLE.pdf",
  adm: "https://pubfs-rma.fpac.usda.gov/pub/References/adm_livestock/",
  sob: "https://pubfs-rma.fpac.usda.gov/pub/Web_Data_Files/Summary_of_Business/livestock_and_dairy_participation/index.html",
};
const a = (href, text) => `<a href="${href}" rel="noopener">${text}</a>`;

function read(rel) { return JSON.parse(readFileSync(ROOT + rel, "utf8")); }

/* -------------------------------------------------------------- values */

export function bakeValues(bt, meta, today) {
  const v = {};
  v.asof = ymdLong(bt.as_of);
  v.first = ymdLong(meta.first_sales_date);
  v.last = ymdLong(meta.last_sales_date);
  v.files = meta.files_read.toLocaleString("en-US");
  v.family = String(bt.family_size);
  v.kept = bt.kept.length;
  v.sed = ymdLong(today.sed);
  v.ry = today.ry;
  const lv = [];
  today.offers.forEach((o) => o.r.forEach((r) => lv.push(r[0] / 1e6)));
  v.lo = L.levelPct(Math.min(...lv));
  v.hi = L.levelPct(Math.max(...lv));
  const lens = [...new Set(today.offers.map((o) => o.len))].sort((x, y) => x - y);
  v.len_lo = String(lens[0]);
  v.len_hi = String(lens[lens.length - 1]);
  // subsidy check, RY2021 on
  let rows = 0, agree = 0, y0 = null, y1 = null;
  for (const [ry, c] of Object.entries(bt.subsidy_check)) {
    if (+ry < 2021) continue;
    rows += c.rows; agree += c.agree;
    y0 = y0 == null || +ry < y0 ? +ry : y0;
    y1 = y1 == null || +ry > y1 ? +ry : y1;
  }
  v.sub_agree = pct(agree / rows);
  v.sub_rows = rows.toLocaleString("en-US");
  v.sub_y0 = String(y0);
  v.sub_y1 = String(y1);
  return v;
}

const fill = (tpl, v) => tpl.replace(/\{([a-z0-9_]+)\}/g, (m, k) => {
  if (!(k in v)) throw new Error("no baked value " + k);
  return v[k];
});

/* -------------------------------------------------------------- FAQ */

/* One list: the visible FAQ and the FAQPage JSON-LD are both written from
   it, word for word. Links show in the visible copy; the JSON-LD gets the
   same words with the tags taken out. Every rule cites RMA. */
export function faqList() {
  return [
    ["What is LRP insurance?",
      `Livestock Risk Protection (LRP) is federal insurance from USDA&rsquo;s Risk Management Agency (RMA) that pays when a price index for feeder cattle, fed cattle or hogs ends under the coverage price you bought. You buy it one endorsement at a time: a type of animal, a number of head, a target weight, a length and a coverage level. On {sed} RMA offered lengths of {len_lo} to {len_hi} weeks and coverage levels of {lo} to {hi} of its expected ending value. It covers the price, not basis (${a(RMA.fact, "RMA LRP fact sheet")}).`],
    ["How does an LRP payment work?",
      `At the end date RMA compares the actual ending value with your coverage price. If the ending value is lower, it pays the difference per cwt, times the target weight per head, the number of head and your share. Feeder cattle settle on the CME Feeder Cattle Index, times the price adjustment factor for the type and weight; fed cattle on USDA&rsquo;s 5-area weekly weighted average price for slaughter steers; hogs on the CME Lean Hog Index (${a(RMA.fed, "RMA fed cattle endorsement")}; ${a(RMA.fact, "RMA LRP fact sheet")}).`],
    ["How much of the LRP premium does USDA pay?",
      `Since July 1, 2020, USDA pays 35% of the premium at 95 to 100% coverage, 40% at 90 to 94.99%, 45% at 85 to 89.99%, 50% at 80 to 84.99% and 55% at 70 to 79.99% (${a(RMA.pm2064, "RMA PM-20-064")}). RMA&rsquo;s own Summary of Business rows from {sub_y0} to {sub_y1} show exactly that subsidy on {sub_agree} of {sub_rows} rows. Beginning and veteran farmers and ranchers get more.`],
    ["When can I buy LRP, and when do sales close?",
      `RMA posts new coverage prices and rates each sales day, and sales close at 8:25 a.m. Central the next day. A Friday&rsquo;s sales close Saturday at 8:25 a.m. There are no sales on federal or CME holidays, none for cattle on USDA Cattle on Feed report days and none for hogs on Hogs and Pigs report days (${a(RMA.calendar, "RMA Livestock Insurance Offer Calendar")}). A price you see is good only for that day&rsquo;s window.`],
    ["When is the LRP premium due?",
      `Not when you buy. Since the 2021 changes the premium is billed after the endorsement ends (${a(RMA.pm2064, "RMA PM-20-064")}), and RMA&rsquo;s 2026 LRP handbook puts the billing date at the first day of the second month after the end date (${a(RMA.handbook, "RMA LRP Handbook 2026")}).`],
    ["How many head can I cover with LRP?",
      `Feeder cattle and fed cattle: up to 12,000 head on one endorsement and 25,000 head a year, July 1 to June 30. Hogs: up to 70,000 head on one endorsement and 750,000 a year (${a(RMA.pm2229, "RMA PM-22-029")}; ${a(RMA.fact, "RMA LRP fact sheet")}).`],
    ["Does LRP cover basis?",
      `No. It pays on the index, not on what you sell for. If your local cash price falls further than the index, LRP does not cover the gap, and if the index falls while your cash price holds, it still pays. Nothing on this page includes basis (${a(RMA.fact, "RMA LRP fact sheet")}).`],
    ["How does LRP compare with a put option?",
      `Both set a price floor for a premium. LRP is sold by the head instead of by the futures contract, needs no brokerage account and no margin, carries a 35% to 55% subsidy, and the premium is billed after the end date (${a(RMA.pm2064, "RMA PM-20-064")}). It settles on the cash index on the end date, not on a futures price.`],
  ];
}

const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/&rsquo;/g, "’").replace(/&amp;/g, "&").replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”");

export function faqHtml(v) {
  return faqList().map(([q, ans]) => `<details><summary>${esc(q)}</summary><p>${fill(ans, v)}</p></details>`).join("\n        ");
}

export function jsonld(v) {
  const faq = faqList().map(([q, ans]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: strip(fill(ans, v)) } }));
  const graph = [
    { "@type": "WebApplication", "@id": "https://agsist.com/lrp#app", name: "LRP calculator: today's rates and RMA's record",
      url: "https://agsist.com/lrp", applicationCategory: "FinanceApplication", operatingSystem: "Any",
      description: "Today's LRP rates for feeder cattle, fed cattle and hogs, your premium after the subsidy per head, and how every coverage level did on RMA's record since 2013.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, isAccessibleForFree: true, inLanguage: "en-US",
      dateModified: `${v.iso}`,
      author: { "@type": "Person", name: "Sigurd Lindquist", jobTitle: "Certified Crop Adviser (CCA)", url: "https://agsist.com/about" },
      publisher: { "@type": "Organization", name: "AGSIST", url: "https://agsist.com/" },
      isBasedOn: [RMA.adm, RMA.sob] },
    { "@type": "FAQPage", mainEntity: faq },
    { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://agsist.com/" },
      { "@type": "ListItem", position: 2, name: "Tools", item: "https://agsist.com/tools" },
      { "@type": "ListItem", position: 3, name: "LRP calculator", item: "https://agsist.com/lrp" }] },
  ];
  return `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script>`;
}

/* -------------------------------------------------------------- blocks */

function backLine(bt) {
  const b = L.backPerDollar(bt, "all", 13);
  if (!b.length) return "";
  const parts = b.map((x) => `${money(x.back)} on ${x.product.name.toLowerCase()}`);
  const list = parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0];
  return `<p class="means"><b>What this means:</b> LRP is protection against a price drop. Over RMA&rsquo;s record, each $1 of premium a producer paid after the subsidy, at 95 to 100% and 13 weeks, paid back ${list}. At 13 weeks it paid anything on ${pct(Math.min(...b.map((x) => x.rec.paid_share)))} to ${pct(Math.max(...b.map((x) => x.rec.paid_share)))} of sales days.</p>`;
}

export function answerHtml(bt, v) {
  const allRg = bt.method.regimes.find((r) => r.id === "all");
  let a1;
  if (!bt.kept.length) {
    a1 = `<p class="q">Does any LRP coverage choice beat 95 to 100% coverage?</p>
        <p class="a">Not on RMA&rsquo;s own record since 2013.</p>
        <p>We ran ${v.family} tests on every sales day from ${v.first} on: lower coverage levels, and the level with the best record so far, against 95 to 100%, for feeder cattle, fed cattle and hogs. None held up. Here is what 95 to 100% coverage did, per $100 of coverage, after the subsidy:</p>`;
  } else {
    const names = bt.kept.map((k) => { const t = bt.tests[k]; return `${L.productName(t.product).toLowerCase()}, ${L.testLabel(t).toLowerCase()}`; });
    a1 = `<p class="q">Does any LRP coverage choice beat 95 to 100% coverage?</p>
        <p class="a">On RMA&rsquo;s record, ${bt.kept.length} of ${v.family} tests held up: ${esc(names.join("; "))}.</p>
        <p>See What the numbers would pick below. Here is what 95 to 100% coverage did, per $100 of coverage, after the subsidy:</p>`;
  }
  return `${a1}
        <div class="lrp-tw">${L.recordTable(bt, "all")}</div>
        <p class="src">Sales days ${v.first} (RY${allRg.fromRY}) to the last endorsement that had ended by ${v.asof}. Top line: what it paid minus your premium, per $100 of coverage. Under it: the share of sales days it paid anything. &ldquo;Too few&rdquo; means fewer than ${bt.method.min_years} reinsurance years to judge.</p>
        ${backLine(bt)}`;
}

export function pickHtml(bt) {
  if (bt.kept.length) {
    const items = bt.kept.map((k) => {
      const t = bt.tests[k];
      return `<li><b>${esc(L.productName(t.product))}: ${esc(L.testLabel(t))}</b>, ${esc(L.regimeName(bt, t.regime).toLowerCase())}. Ahead in ${t.years_positive} of ${t.years_tested} reinsurance years, about ${money(t.mean)} per $100 of coverage; odds after Holm ${L.odds(t.p_holm)}.</li>`;
    }).join("");
    return `<p class="none">${bt.kept.length} of ${bt.family_size} tests held up.</p><ul class="plain">${items}</ul>
        <p class="src">Kept means the adjusted odds of luck were under 0.05, the effect was positive, and it was positive at every length with enough data. History, not a forecast.</p>`;
  }
  const c = L.closestCall(bt);
  let close = "";
  if (c) {
    const other = c.regime === "all" ? L.twin(bt, c, "current") : L.twin(bt, c, "all");
    const nowT = c.regime === "all" ? other : c;
    const sibs = Object.values(bt.tests).filter((t) => t !== c && t.regime === c.regime && t.product === c.product &&
      t.test.startsWith("band:") && !t.not_run && t.mean > 0 && t.years_positive === c.years_positive);
    const sib = sibs.length ? ` ${sibs.map((t) => L.bandLabel(t.test.slice(5))).join(" and ")} did about the same (ahead in ${sibs[0].years_positive} of ${sibs[0].years_tested} years).` : "";
    let nowLine = "";
    if (nowT && !nowT.not_run) {
      nowLine = ` Since July 2020 it was ahead in ${nowT.years_positive} of ${nowT.years_tested} years. With ${nowT.years_tested} years, the smallest odds the test can give are 1 in ${(2 ** (nowT.years_tested - 1)).toLocaleString("en-US")}, which cannot clear the bar across ${bt.family_size} tests.`;
    }
    close = `<p><b>Closest call, not proven:</b> ${esc(L.productName(c.product).toLowerCase())} at ${esc(L.testLabel(c).replace(" instead of", ", instead of"))}. Since July 2013 it came out ahead in ${c.years_positive} of ${c.years_tested} reinsurance years, about ${money(c.mean)} per $100 of coverage.${sib}${nowLine} After allowing for all ${bt.family_size} tests, the odds it was luck are ${L.odds(c.p_holm)}, far from the 0.05 bar.</p>
        <p>I am not recommending it. Lower coverage pays less often and costs less; on this record that trade did not clearly win.</p>`;
  }
  return `<p class="none">Nothing. No coverage choice beat 95 to 100% on the record.</p>
        <p>A choice is kept only if, after allowing for all ${bt.family_size} tests (Holm), the odds of luck are under 0.05, it came out ahead, and it came out ahead at every length. None did, so the numbers pick nothing over 95 to 100%.</p>
        ${close}`;
}

export function recordHtml(bt, v) {
  const cur = bt.method.regimes.find((r) => r.id === "current");
  const b = L.backPerDollar(bt, "current", 13);
  const parts = b.map((x) => `${money(x.back)} on ${x.product.name.toLowerCase()}`);
  const line = parts.length ? `At 13 weeks, each $1 of premium after the subsidy paid back ${parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0]}.` : "";
  return `<p>The same table for sales days from July 1, 2020 (RY${cur.fromRY}) on, when today&rsquo;s subsidy and the premium billed at the end began. It is the regime you buy in today, and it is short. ${line}</p>
      <div class="lrp-tw">${L.recordTable(bt, "current")}</div>
      <p class="src">Per $100 of coverage, after the subsidy; share of sales days it paid anything. Every sales day is one entry, and most are not independent of the next: a cattle rally lasts years, so the record is closer to one outcome per reinsurance year than to the ${bt.counts.trials.toLocaleString("en-US")} sales-day entries behind it.</p>`;
}

export function testedHtml(bt, v) {
  return `<p>${bt.family_size} tests, one family, adjusted together (Holm). ${bt.kept.length === 0 ? "None was kept." : `${bt.kept.length} kept.`} &ldquo;Years ahead&rdquo; counts reinsurance years (July to June) where the choice came out ahead of 95 to 100%, or for the first line in each animal, where 95 to 100% paid more than it cost. &ldquo;Per $100&rdquo; is the average difference per $100 of coverage. &ldquo;Not enough history&rdquo; means fewer than ${bt.method.min_years} reinsurance years with ${bt.method.min_trials_per_year} or more sales days: RMA offered fixed levels in every band only from RY2025, so the 80 to 85% and 70 to 80% bands are mostly too new.</p>
      ${L.testsTable(bt)}`;
}

function subsidyTable(bt) {
  const rows = [["RY2014 to RY2019", 2014], ["RY2020", 2020], ["RY2021 on", 2021]];
  let h = `<div class="lrp-tw"><table class="lrp-t"><thead><tr><th scope="col">Policies in</th>${BANDS.map((b) => `<th scope="col">${b.id.replace("-", " to ")}%</th>`).join("")}</tr></thead><tbody>`;
  for (const [lab, ry] of rows) {
    h += `<tr><th scope="row">${lab}</th>${BANDS.map((b) => `<td>${pct(btSubsidy(ry, (b.lo + Math.min(b.hi, 1)) / 2))}</td>`).join("")}</tr>`;
  }
  h += "</tbody></table></div>";
  const chk = Object.entries(bt.subsidy_check).map(([ry, c]) => `RY${ry} ${pct(c.agree_share)}`).join(", ");
  const bad = Object.entries(bt.subsidy_check).filter(([, c]) => c.agree_share < 0.9).map(([ry]) => `RY${ry}`);
  const note = bad.length ? ` In ${bad.join(" and ")} RMA&rsquo;s rows mostly show a smaller subsidy than this table, so ${bad.length > 1 ? "those years read" : "that year reads"} a little better here than producers saw.` : "";
  return `${h}<p class="src">Share of RMA&rsquo;s Summary of Business rows that got the subsidy in this table: ${chk}.${note} RMA applied the RY2021 table back to July 1, 2020, so that is what those producers paid (${a(RMA.pm2064, "RMA PM-20-064")}).</p>`;
}

export function methodHtml(bt, meta, v) {
  const miss = bt.counts.aev_missing;
  const missN = Object.values(miss).reduce((s, x) => s + x, 0);
  const unread = (meta.unreadable_files || []).map((f) =>
    `RMA&rsquo;s file for ${ymdLong(f.date)} (${esc(f.file)}) would not open (${esc(String(f.error).split(":")[0])}); ${f.offers_for_that_date_in_history ? "the offers for that day came from another copy" : "that day&rsquo;s offers are not in the record"}, and the reader tries it again on later runs.`).join(" ");
  return `<ul class="plain">
        <li><b>The data.</b> ${v.files} of RMA&rsquo;s daily LRP files (${a(RMA.adm, "ADM livestock")}), every sales day from ${v.first} to ${v.last}: the coverage prices, rates and cost per cwt RMA posted that day, and the actual ending values it posted later. Nothing is estimated or modeled. ${bt.counts.offers.toLocaleString("en-US")} offers, ${bt.counts.trials.toLocaleString("en-US")} entries once each coverage band is counted.</li>
        <li><b>What is tested.</b> Feeder cattle steers, weight 2 (RMA type ${bt.method.products[0].type}), fed cattle steers and heifers (type ${bt.method.products[1].type}) and hogs (type ${bt.method.products[2].type}). Other feeder types settle on the same index times their factor, so per $100 of coverage they come out the same. Not tested: unborn hogs, and the types RMA added from RY2026 on (unborn calves, cull cows, weight-2 unborn feeders), which are too new.</li>
        <li><b>One entry.</b> One animal, one sales day, one length, one coverage band. Per $100 of coverage: paid = coverage price minus actual ending value, when that is above zero; your premium = RMA&rsquo;s cost per cwt less the subsidy of that policy&rsquo;s year; net = paid minus your premium. In each band the entry takes the highest level offered that day, the most protection at that band&rsquo;s subsidy.</li>
        <li><b>Walk-forward &ldquo;best so far.&rdquo;</b> On each sales day it picks the band with the best record among endorsements of the same length that had already ended at least ${bt.method.settle_lag_days} days before, so the ending value was out, and only once a band had ${bt.method.min_settled} such entries. Nothing a buyer could not have known that day.</li>
        <li><b>The odds.</b> Daily entries overlap, so each reinsurance year counts once: the test flips the sign of each year&rsquo;s average every possible way (exact sign flip) and asks how often that does as well as the real record. It runs only with ${bt.method.min_years} or more years of ${bt.method.min_trials_per_year}+ sales days. All ${bt.family_size} tests are adjusted together (Holm); kept means adjusted odds under 0.05, ahead on average, and ahead at every length with enough data.</li>
        <li><b>Gaps.</b> ${missN} sales-day offers whose end date had passed with no ending value posted by RMA are left out (${Object.entries(miss).map(([k, n]) => `${k === "swine" ? "hogs" : k} ${n}`).join(", ")}). Endorsements still running are left out until they end. ${unread}</li>
        <li><b>Basis is not covered.</b> LRP pays on the index, so every number here is at the index, not at your sale barn or packer.</li>
      </ul>
      <h3>Subsidy used, by coverage band</h3>
      ${subsidyTable(bt)}`;
}

export function whenHtml(today) {
  const close = L.salesClose(today.sed);
  return `Offers for sales on ${ymdLong(today.sed)}, from RMA&rsquo;s daily file. RMA&rsquo;s rule: those sales close at 8:25 a.m. CT on ${ymdLong(close.slice(0, 8))}.`;
}

export function firstYears(meta, today) {
  const out = {};
  const years = Object.keys(meta.types_by_reinsurance_year).sort();
  for (const o of today.offers) {
    const k = o.c + "/" + o.t;
    if (k in out) continue;
    const y = years.find((ry) => meta.types_by_reinsurance_year[ry][k]);
    if (y) out[k] = y;
  }
  return JSON.stringify(out);
}

/* -------------------------------------------------------------- write */

function put(h, name, body) {
  const re = new RegExp(`<!--lrp:${name}-->[\\s\\S]*?<!--/lrp:${name}-->`);
  if (!re.test(h)) throw new Error(`${PAGE}: no <!--lrp:${name}--> marker`);
  return h.replace(re, () => `<!--lrp:${name}-->${body}<!--/lrp:${name}-->`);
}

export function bake(h, bt, meta, today) {
  const v = bakeValues(bt, meta, today);
  v.iso = `${bt.as_of.slice(0, 4)}-${bt.as_of.slice(4, 6)}-${bt.as_of.slice(6, 8)}`;
  h = put(h, "jsonld", jsonld(v));
  h = put(h, "answer", answerHtml(bt, v));
  h = put(h, "when", whenHtml(today));
  h = put(h, "first", firstYears(meta, today));
  h = put(h, "pick", pickHtml(bt));
  h = put(h, "record", recordHtml(bt, v));
  h = put(h, "tested", testedHtml(bt, v));
  h = put(h, "method", methodHtml(bt, meta, v));
  h = put(h, "faq", faqHtml(v));
  return h;
}

function main() {
  const check = process.argv.includes("--check");
  const bt = read("data/lrp/bt.json"), meta = read("data/lrp/meta.json"), today = read("data/lrp/today.json");
  const before = readFileSync(ROOT + PAGE, "utf8");
  const after = bake(before, bt, meta, today);
  if (check) {
    if (after !== before) { console.error(`${PAGE} is stale: run node scripts/bake_lrp.mjs`); process.exit(1); }
    console.log(`${PAGE} matches data/lrp`);
    return;
  }
  if (after !== before) writeFileSync(ROOT + PAGE, after);
  console.log(after !== before ? `${PAGE} baked` : `${PAGE} unchanged`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
