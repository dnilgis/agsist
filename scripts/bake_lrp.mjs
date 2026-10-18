#!/usr/bin/env node
/* bake_lrp.mjs: write the LRP numbers into lrp.html and lrp/record.html.
 *
 * components/lrp.js owns the tables and the formatting; this runs that same
 * file (no second copy) against data/lrp/bt.json, meta.json, today.json and
 * sob-loss.json and writes, between <!--lrp:NAME--> markers:
 *
 * lrp.html (the calculator, /lrp):
 *   when     which sales day the offers are for, posted when, buy by when
 *            (neutral: the page's script says open or closed)
 *   offers0  a small dated summary of that day's offers, for readers with no
 *            JavaScript and for search engines
 *   first    the first reinsurance year of each type offered that day
 *   back     since July 2020, what each $1 of premium at the top coverage
 *            paid back, by animal and length (the page shows the reader's
 *            animal only); hist0 the same in words for readers with no
 *            JavaScript
 *   faq      the visible FAQ; jsonld the WebApplication, FAQPage and
 *            BreadcrumbList JSON-LD, written from the same list word for word
 *   by       the byline with the date the data was read
 *
 * lrp/record.html (how the numbers were checked, /lrp/record):
 *   answer   does a lower coverage level beat 95 to 100%, the top-level
 *            record at today's subsidy, a worked lot, and what it means
 *   pick     "What the numbers would pick" (kept tests, else the closest call)
 *   record   the record at the subsidy in force each year, and since July 2020
 *   tested   all tests with their odds and verdicts
 *   method   the data, the method, gaps and the subsidy table by year
 *   by       the byline; the static header, footer and font blocks are
 *            copied from lrp.html, so the two pages never drift
 *
 * The lrp workflow runs this after every publish of data/lrp.
 *
 *   node scripts/bake_lrp.mjs           write
 *   node scripts/bake_lrp.mjs --check   exit 1 if lrp.html is stale
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { subsidy as btSubsidy, BANDS } from "./lrp_backtest.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAGE = "lrp.html";
const RECORD = "lrp/record.html";

export function loadModule() {
  const ctx = { window: {}, Intl, Date };
  vm.runInNewContext(readFileSync(ROOT + "components/lrp.js", "utf8"), ctx);
  return ctx.window.AgLrp;
}

const L = loadModule();
const { esc, money, pct, ymdLong } = L;
export const RMA = {
  pm2064: "https://www.rma.usda.gov/policy-procedure/bulletins-memos/product-management-bulletin/2020/pm-20-064",
  pm2229: "https://www.rma.usda.gov/policy-procedure/bulletins-memos/product-management-bulletin/2022/pm-22-029",
  fact: "https://www.rma.usda.gov/sites/default/files/2024-02/LRP-Feeder-Cattle-Fact-Sheet.pdf",
  calendar: "https://www.rma.usda.gov/sites/default/files/2025-12/Livestock-Insurance-Offer-Calendar.pdf",
  fed: "https://www.rma.usda.gov/sites/default/files/2025-04/Livestock%20Risk%20Protection%20Fed%20Cattle%20Endorsement%2026-LRP-FED%20CATTLE.pdf",
  adm: "https://pubfs-rma.fpac.usda.gov/pub/References/adm_livestock/",
  sob: "https://pubfs-rma.fpac.usda.gov/pub/Web_Data_Files/Summary_of_Business/livestock_and_dairy_participation/index.html",
  usu: "https://farmanalysis.usu.edu/lrp/",
  unl: "https://agecon.unl.edu/lrp-feeder-cattle-insurance-recent-enhancement-and-performance-history/",
  /* read in full Oct 15, 2026 (references branch): from 2026 on, billing the first day of the second
     month after the end date, Sep 30 termination, unborn calves and cull cows types */
  pm25028: "https://rma.usda.gov/policy-procedure/bulletins-memos/product-management-bulletin/pm-25-028-livestock-risk-protection",
};
/* the 2027 LRP handbook, read in full on the references branch (manual/rma-lrp-handbook-2027.txt) */
const HB = "RMA LRP Handbook 2027 (FCIC-20010)";
const a = (href, text) => `<a href="${href}" rel="noopener">${text}</a>`;
const list = (xs) => (xs.length > 1 ? xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1] : xs[0] || "");

function read(rel) { return JSON.parse(readFileSync(ROOT + rel, "utf8")); }

/* -------------------------------------------------------------- values */

/* The worked lot: 600 weight-2 steers at 8.5 cwt, at that sales day's top
   13-week coverage price for that type. */
export const LOT = { head: 600, cwt: 8.5, comm: "0801", type: "810", len: 13 };

function lotOffer(today) {
  const o = today.offers.find((x) => x.c === LOT.comm && x.t === LOT.type && x.len === LOT.len);
  if (!o) return null;
  const top = o.r.reduce((m, r) => (r[0] > m[0] ? r : m));
  return { o, cp: top[1] / 1000, level: top[0] / 1e6 };
}

/* pooled loss ratio over closed years from RMA's Summary of Business */
export function sobPooled(sob, pid, y0, y1) {
  const ys = sob && sob.by_product && sob.by_product[pid];
  if (!ys) return null;
  let ind = 0, prod = 0, prem = 0, n = 0;
  for (const [ry, t] of Object.entries(ys)) {
    if (+ry < y0 || +ry > y1 || t.open) continue;
    ind += t.indemnity; prod += t.producer_premium; prem += t.premium; n++;
  }
  return n ? { producer: ind / prod, total: ind / prem, years: n } : null;
}

export function bakeValues(bt, meta, today, sob) {
  const v = {};
  v.asof = ymdLong(bt.as_of);
  v.first = ymdLong(meta.first_sales_date);
  v.last = ymdLong(meta.last_sales_date);
  v.files = meta.files_read.toLocaleString("en-US");
  v.family = String(bt.family_size);
  v.kept = bt.kept.length;
  v.sed = ymdLong(L.salesDay(today).day);
  const lv = [];
  today.offers.forEach((o) => o.r.forEach((r) => lv.push(r[0] / 1e6)));
  v.lo = lv.length ? L.levelPct(Math.min(...lv)) : "";
  v.hi = lv.length ? L.levelPct(Math.max(...lv)) : "";
  const lens = [...new Set(today.offers.map((o) => o.len))].sort((x, y) => x - y);
  v.len_lo = String(lens[0] || 13);
  v.len_hi = String(lens[lens.length - 1] || 52);
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
  const now = L.backPerDollar(bt, "all", 13, true), cur = L.backPerDollar(bt, "current", 13, true);
  const by = (xs, id) => { const x = xs.find((q) => q.product.id === id); return x ? money(x.back) : "n/a"; };
  for (const id of ["feeder", "fed", "swine"]) { v[`back_${id}`] = by(now, id); v[`backc_${id}`] = by(cur, id); }
  const shares = now.map((x) => L.per100(x.rec.paid_share));
  v.paid_lo = String(Math.min(...shares));
  v.paid_hi = String(Math.max(...shares));
  v.top = L.levelPct(Math.round(L.topLevel(bt, "all") * 1000) / 1000);
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
    ["Is LRP worth it?",
      `It depends on what a price drop would cost you, because that is what it covers. On RMA&rsquo;s own record, buying the top coverage offered every sales day since July 2013 for 13 weeks, at today&rsquo;s subsidy, each $1 of premium paid back {back_feeder} on feeder cattle, {back_fed} on fed cattle and {back_swine} on hogs. Since July 2020 it was {backc_feeder}, {backc_fed} and {backc_swine}. It paid something on {paid_lo} to {paid_hi} of every 100 sales days bought. These are index figures, before basis. They compare coverage levels; they do not say whether you should insure.`],
    ["What is LRP insurance?",
      `Livestock Risk Protection (LRP) is federal insurance from USDA&rsquo;s Risk Management Agency (RMA) that protects against a decline in prices below the coverage price you buy (${HB}, section 22B). You buy it one policy at a time (RMA calls each one an endorsement): a type of animal, a number of head, a target weight, a length and a coverage level. Lengths run 13 to 52 weeks, depending on the animal, and coverage levels 75% to 100% of RMA&rsquo;s expected ending value (sections 22B, 23A, 24A, 25A). On {sed} RMA offered {len_lo} to {len_hi} weeks and {lo} to {hi}. It covers the price, not basis.`],
    ["How does an LRP payment work?",
      `If the actual ending value on the end date is under your coverage price, it pays the difference per cwt, times the head, the target weight and your share (${HB}, section 22D). Feeder cattle settle on the CME Feeder Cattle Index, times the price adjustment factor for the type and weight (section 23C); fed cattle on USDA&rsquo;s 5-area weekly weighted average price for slaughter steers (${a(RMA.fed, "RMA fed cattle endorsement")}); hogs on the CME Lean Hog Index (${a(RMA.fact, "RMA LRP fact sheet")}). To be paid you must own the animals: selling or giving them up more than 60 days before the end date ends coverage on them, and the premium is still owed (section 21C(3)). Fed cattle and hogs, and feeder cattle you sold, need sale records from the insurance period or no later than 60 days after the end date (30 days for unborn calves); feeder cattle you still own need ownership records and your signed statement that they were marketable on the end date (section 21C(2)). Fed cattle are covered to be slaughtered on or near the end date (section 24A). When the ending value is under the coverage price, the claim form goes back within 60 days of getting it, and payment comes within 30 days of the form (section 21G).`],
    ["How much of the LRP premium does USDA pay?",
      `Since July 1, 2020, USDA pays 35% of the premium at 95 to 100% coverage, 40% at 90 to 94.99%, 45% at 85 to 89.99%, 50% at 80 to 84.99% and 55% below 80% (${a(RMA.pm2064, "RMA PM-20-064")}; RMA now offers 75% and up). RMA&rsquo;s own Summary of Business rows from {sub_y0} to {sub_y1} show exactly that subsidy on {sub_agree} of {sub_rows} rows. Beginning and veteran farmers and ranchers get more.`],
    ["When can I buy LRP, and when do sales close?",
      `Sales open when RMA posts the day&rsquo;s coverage prices and rates and close at 8:25 a.m. Central the following calendar day, so a Friday&rsquo;s close Saturday (${HB}, Exhibit 2 and section 22B). There are no sales for cattle on the days USDA releases the Cattle and Cattle on Feed reports, none for hogs on Hogs and Pigs report days, none on days the CME livestock markets are closed, none after a limit move in the futures, and none if RMA has not posted the offers by 4:30 p.m. Central (section 22B). RMA&rsquo;s files have landed between about 2:15 and 4:30 p.m. Central; this page picks them up within about an hour.`],
    ["When is the LRP premium due?",
      `Not when you buy. The premium billing date is the first day of the second month after the end date (${HB}, section 21E). RMA set that date from 2026 on (${a(RMA.pm25028, "RMA PM-25-028")}, Apr 30, 2025). Premium can also be taken out of an indemnity (section 22E).`],
    ["How many head can I cover with LRP?",
      `Feeder cattle and fed cattle: up to 12,000 head on one endorsement and 25,000 head a crop year, July 1 to June 30. Hogs: up to 70,000 head on one endorsement and 750,000 a crop year (${HB}, sections 23B, 24B and 25B). The crop year limit is combined across every endorsement you buy, and it counts your share of any farm or company that also buys LRP. Feeder cattle and fed cattle each have their own 25,000.`],
    ["Does LRP cover basis?",
      `No. It pays on the index, not on what you sell for (${HB}, sections 22B and 22D). If your local cash price falls further than the index, LRP does not cover the gap, and if the index falls while your cash price holds, it still pays. Nothing on this page includes basis.`],
    ["How does LRP compare with a put option?",
      `Both set a price floor for a premium. With LRP there is no futures account, the premium carries a 35% to 55% subsidy (${a(RMA.pm2064, "RMA PM-20-064")}) and is billed after the end date (${HB}, section 21E), and it is sold by the head in any number up to the limit instead of by the futures contract. RMA sets the coverage prices and rates each day (section 22A), you must own the livestock and show records to be paid (section 21C), and the endorsement settles on the index on its end date, not on a futures price.`],
    ["Can I buy LRP on calves that are not born yet?",
      `Yes, from the 2026 crop year on. RMA added an Unborn Calves type under feeder cattle, for beef or beef and dairy cross calves sold within two weeks after birth (${a(RMA.pm25028, "RMA PM-25-028")}).`],
    ["Does LRP cover dairy cull cows?",
      `It does now. From the 2026 crop year on, RMA added a Cull Cows type under fed cattle for dairy cull cows, with coverage limited to 13 weeks (${a(RMA.pm25028, "RMA PM-25-028")}).`],
    ["Can I use LRP if I am selling on a forward contract?",
      `Yes. RMA now allows LRP coverage based on a forward contract or purchase agreement. Keep a copy of the agreement and proof of delivery, because RMA added those to the records you need (${a(RMA.pm25028, "RMA PM-25-028")}).`],
  ];
}

const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/&rsquo;/g, "’").replace(/&amp;/g, "&").replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”");

export function faqHtml(v) {
  return faqList().map(([q, ans]) => `<details><summary>${esc(q)}</summary><p>${fill(ans, v)}</p></details>`).join("\n        ");
}

export function jsonld(v) {
  const faq = faqList().map(([q, ans]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: strip(fill(ans, v)) } }));
  const graph = [
    { "@type": "WebApplication", "@id": "https://agsist.com/lrp#app", name: "LRP calculator: today's rates and premium per head",
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

function lotLine(bt, today) {
  const lo = lotOffer(today);
  const r = bt.record[`all/feeder/${bt.method.base}/${LOT.len}`];
  if (!lo || !r || r.years < bt.method.min_years) return "";
  const coverHead = lo.cp * LOT.cwt, netHead = (r.net_now / 100) * coverHead;
  /* the same lot at the subsidy each year really had, and in the regime bought today (since July 2020) */
  const word = (x) => `${x >= 0 ? "ahead" : "behind"} ${money(Math.abs(x))}`;
  const cur = bt.record[`current/feeder/${bt.method.base}/${LOT.len}`];
  const inForce = r.net != null
    ? ` At the subsidy in force each year it came out ${word((r.net / 100) * coverHead)} a head` +
      (cur && cur.years >= bt.method.min_years && cur.net != null ? `; since July 2020, ${word((cur.net / 100) * coverHead)}.` : ".")
    : "";
  return `<p class="lot"><b>For a lot:</b> ${LOT.head} head of steers at ${(LOT.cwt * 100).toLocaleString("en-US")} lb (${LOT.cwt} cwt), covered at ${money(lo.cp)} a cwt (that day&rsquo;s top ${LOT.len}-week price for weight 2 steers), is ${money(coverHead, 0)} of coverage a head. On the record&rsquo;s average day at today&rsquo;s subsidy, ${LOT.len} weeks came out ${netHead >= 0 ? "ahead" : "behind"} ${money(Math.abs(netHead))} a head, ${money(Math.abs(netHead * LOT.head), 0)} for the lot, before basis.${inForce}</p>`;
}

function backLine(bt) {
  const now = L.backPerDollar(bt, "all", 13, true), cur = L.backPerDollar(bt, "current", 13, true);
  if (!now.length) return "";
  const p1 = now.map((x) => `${money(x.back)} on ${x.product.name.toLowerCase()}`);
  const p2 = cur.map((x) => `${money(x.back)} on ${x.product.name.toLowerCase()}`);
  return `<p class="means"><b>What this means:</b> LRP is protection against a price drop. Since July 2013, at today&rsquo;s subsidy, each $1 of premium at the top level and 13 weeks paid back ${list(p1)}. Since July 2020 it paid back ${list(p2)}. It paid something on ${Math.min(...now.map((x) => L.per100(x.rec.paid_share)))} to ${Math.max(...now.map((x) => L.per100(x.rec.paid_share)))} of every 100 sales days bought.</p>`;
}

export function answerHtml(bt, v, today) {
  const allRg = bt.method.regimes.find((r) => r.id === "all");
  let a1;
  if (!bt.kept.length) {
    a1 = `<p class="q">Does a lower LRP coverage level beat 95 to 100% coverage?</p>
        <p class="a">No lower coverage level beat 95 to 100% by more than luck could explain.</p>
        <p class="jump"><a class="lrp-go" href="/lrp">Your premium today</a></p>
        <p>That is on RMA&rsquo;s own record of every sales day since ${v.first}: ${v.family} tests of lower levels, and of the level with the best record so far, for feeder cattle, fed cattle and hogs. This compares coverage levels. It does not say whether to insure. Here is what the top coverage offered each day (about ${v.top} on average) did, per $100 of coverage, at today&rsquo;s subsidy:</p>`;
  } else {
    const names = bt.kept.map((k) => { const t = bt.tests[k]; return `${L.productName(t.product).toLowerCase()}, ${L.testLabel(t).toLowerCase()}`; });
    a1 = `<p class="q">Does a lower LRP coverage level beat 95 to 100% coverage?</p>
        <p class="a">On RMA&rsquo;s record, ${bt.kept.length} of ${v.family} tests held up: ${esc(names.join("; "))}.</p>
        <p class="jump"><a class="lrp-go" href="/lrp">Your premium today</a></p>
        <p>See What the numbers would pick below. Here is what the top coverage offered each day (about ${v.top} on average) did, per $100 of coverage, at today&rsquo;s subsidy:</p>`;
  }
  return `${a1}
        <div class="lrp-tw">${L.recordTable(bt, "all", "net_now", "Top coverage, since July 2013, at today&rsquo;s subsidy")}</div>
        <p class="src">Sales days ${v.first} (insurance year ${allRg.fromRY}, July to June) to the last policy that had ended by ${v.asof}. Top line: what it paid minus your premium, per $100 of coverage, averaged over every sales day. Under it: on how many of every 100 sales days it paid anything. &ldquo;Too few&rdquo; means fewer than ${bt.method.min_years} insurance years with ${bt.method.min_trials_per_year} or more sales days.</p>
        ${lotLine(bt, today)}
        ${backLine(bt)}`;
}

function fedFacts(bt, sob) {
  const ev = bt.ending_vs_expected && bt.ending_vs_expected.fed;
  let h = "";
  if (ev) {
    const ys = Object.values(ev).filter((y) => y.n >= bt.method.min_trials_per_year);
    const above = ys.filter((y) => y.mean_pct > 0).length;
    h += ` Fed cattle ending values (USDA&rsquo;s 5-area weekly steer price) came in above RMA&rsquo;s expected ending value in ${above} of ${ys.length} insurance years; the ending value is a weekly cash average, the expected value comes from futures.`;
  }
  const s = sobPooled(sob, "fed", 2014, 2025);
  if (s) h += ` On what producers actually bought, RMA&rsquo;s Summary of Business shows fed cattle LRP paid back ${money(s.producer)} per $1 producers paid, insurance years 2014 to 2025 (${a(RMA.sob, "RMA Summary of Business")}).`;
  return h;
}

export function pickHtml(bt, sob) {
  const why = `<p class="src">Why high coverage is the usual default: the subsidy is a share of the premium, and the premium per head is largest at the top level, so if RMA&rsquo;s premiums are fair the subsidy dollars per head are largest there too. Published work from Utah State University (Haviland and Feuz, ${a(RMA.usu, "the USU LRP tool")}) also found 95 to 100% coverage did best on past contracts. That is their finding, not a test on this page.</p>`;
  if (bt.kept.length) {
    const items = bt.kept.map((k) => {
      const t = bt.tests[k];
      return `<li><b>${esc(L.productName(t.product))}: ${esc(L.testLabel(t))}</b>, ${esc(L.regimeName(bt, t.regime).toLowerCase())}. Ahead in ${t.years_positive} of ${t.years_tested} insurance years, about ${money(t.mean)} per $100 of expected value; adjusted odds ${L.odds(t.p_holm)}.</li>`;
    }).join("");
    return `<p class="none">${bt.kept.length} of ${bt.family_size} tests held up.</p><ul class="plain">${items}</ul>
        <p>This compares coverage levels. It does not say whether to insure.</p>
        <p class="src">Kept means the odds of luck, adjusted for running ${bt.family_size} tests, were under 0.05, the effect was positive, and it was positive at every length with enough data. History, not a forecast.</p>${why}`;
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
    const sens = bt.holm_sensitivity;
    const sensLine = sens && sens.min_p_holm != null ? ` Even counting only the ${sens.tests} tests that ask whether a lower level beat 95 to 100% since 2013, the smallest adjusted odds are ${L.odds(sens.min_p_holm)}, still not under 0.05.` : "";
    close = `<p><b>Closest call, not proven:</b> ${esc(L.productName(c.product).toLowerCase())} at ${esc(L.testLabel(c).replace(" instead of", ", instead of"))}. Since July 2013 it came out ahead in ${c.years_positive} of ${c.years_tested} insurance years, about ${money(c.mean)} per $100 of expected value, averaged over the years. Ahead means it lost less on average because it covered less; in a crash it pays less.${sib}${nowLine} Adjusted for running all ${bt.family_size} tests, the odds it was luck are ${L.odds(c.p_holm)}, far from the 0.05 bar.${sensLine}</p>
        ${c.product === "fed" ? `<p class="src">${fedFacts(bt, sob).trim()}</p>` : ""}
        <p>I am not recommending it.</p>`;
  }
  return `<p class="none">No coverage level beat 95 to 100%.</p>
        <p>This compares coverage levels. It does not say whether to insure. A level is kept only if, adjusted for running all ${bt.family_size} tests (Holm), the odds of luck are under 0.05, it came out ahead, and it came out ahead at every length. None did.</p>
        ${close}
        ${why}`;
}

export function recordHtml(bt, v, sob) {
  const cur = bt.method.regimes.find((r) => r.id === "current");
  const unl = sobPooled(sob, "feeder", 2015, 2024);
  return `<p>The tests run at the subsidy in force each year, so here is the same record that way, since July 2013. Before July 2019 the subsidy was 13% at every level; the year from July 2019 had its own table (below).</p>
      <div class="lrp-tw">${L.recordTable(bt, "all", "net", "Top coverage, since July 2013, at the subsidy in force that year")}</div>
      <p>Since July 1, 2020 (insurance year ${cur.fromRY}), when today&rsquo;s subsidy and the premium billed at the end began. It is the regime you buy in today, and it is short.</p>
      <div class="lrp-tw">${L.recordTable(bt, "current", "net", "Top coverage, since July 2020")}</div>
      <p class="src">Per $100 of coverage, averaged over every sales day; how many of every 100 sales days it paid anything. Most sales days are not independent of the next: a cattle rally lasts years, so the record is closer to one outcome per insurance year than to the ${bt.counts.trials.toLocaleString("en-US")} sales-day entries behind it.${unl ? ` A University of Nebraska study found Nebraska feeder cattle LRP paid producers about $1.15 per $1 of premium from 2015 to 2024 (${a(RMA.unl, "UNL")}); RMA&rsquo;s national Summary of Business gives ${money(unl.producer)} for feeder cattle in those years. Both weigh each policy by what was bought; this record weighs every sales day the same.` : ""}</p>`;
}

export function testedHtml(bt) {
  return `<p>${bt.family_size} tests, adjusted together for running that many (Holm). ${bt.kept.length === 0 ? "None was kept." : `${bt.kept.length} kept.`} &ldquo;Years ahead&rdquo; counts insurance years (July to June) where the choice came out ahead of 95 to 100%, or for the first line in each animal, where 95 to 100% paid more than it cost. &ldquo;Per $100&rdquo; is the average of the yearly averages: for a lower level, the difference per $100 of RMA&rsquo;s expected ending value, so a smaller policy is not flattered; for the first line, per $100 of coverage. &ldquo;Adjusted&rdquo; is the odds of luck after allowing for all ${bt.family_size} tests. &ldquo;Not enough history&rdquo; means fewer than ${bt.method.min_years} insurance years with ${bt.method.min_trials_per_year} or more sales days: RMA offered fixed levels in every band only from insurance year 2025, so the 80 to 85% and 70 to 80% bands are mostly too new.</p>
      ${L.testsTable(bt)}`;
}

function subsidyTable(bt) {
  const rows = [["RY2014 to RY2019", 2014], ["RY2020", 2020], ["RY2021 on", 2021]];
  let h = `<div class="lrp-tw"><table class="lrp-t"><caption class="sr-only">Premium subsidy by coverage band</caption><thead><tr><th scope="col">Policies in</th>${BANDS.map((b) => `<th scope="col">${b.id.replace("-", " to ")}%</th>`).join("")}</tr></thead><tbody>`;
  for (const [lab, ry] of rows) {
    h += `<tr><th scope="row">${lab}</th>${BANDS.map((b) => `<td>${pct(btSubsidy(ry, (b.lo + Math.min(b.hi, 1)) / 2))}</td>`).join("")}</tr>`;
  }
  h += "</tbody></table></div>";
  const chk = Object.entries(bt.subsidy_check).map(([ry, c]) => `RY${ry} ${pct(c.agree_share)}`).join(", ");
  const bad = Object.entries(bt.subsidy_check).filter(([, c]) => c.agree_share < 0.9).map(([ry]) => `RY${ry}`);
  const note = bad.length ? ` In ${bad.join(" and ")} RMA&rsquo;s rows mostly show another subsidy than this table, so ${bad.length > 1 ? "those years read" : "that year reads"} differently here than producers saw.` : "";
  return `${h}<p class="src">Share of RMA&rsquo;s Summary of Business rows that got the subsidy in this table: ${chk}.${note} The RY2020 row is what those rows show. RMA applied the RY2021 table back to July 1, 2020 (${a(RMA.pm2064, "RMA PM-20-064")}).</p>`;
}

export function methodHtml(bt, meta, v) {
  const miss = bt.counts.aev_missing;
  const missN = Object.values(miss).reduce((s, x) => s + x, 0);
  const det = bt.counts.aev_missing_detail || { by_file: {}, other: miss };
  const nm = (k) => (k === "swine" ? "hogs" : k);
  const parts = (o) => Object.entries(o).map(([k, n]) => `${nm(k)} ${n}`).join(", ");
  const unread = meta.unreadable_files || [];
  const fileLines = unread.map((f) => {
    const n = det.by_file[f.file] ? Object.values(det.by_file[f.file]).reduce((s, x) => s + x, 0) : 0;
    const status = f.status === "known gap" ? "RMA has served it broken on three days, so it is listed as a known gap" : "the reader tries it again on every run until it opens or has failed on three days";
    return `RMA&rsquo;s file for ${ymdLong(f.date)} (${esc(f.file)}) would not open; ${n ? `${n} of the missing values (${parts(det.by_file[f.file])}) would have come from it, and ` : ""}${status}.`;
  }).join(" ");
  const restated = bt.counts.aev_restated;
  return `<ul class="plain">
        <li><b>The data.</b> ${v.files} of RMA&rsquo;s daily LRP files (${a(RMA.adm, "ADM livestock")}), every sales day from ${v.first} to ${v.last}: the coverage prices, rates and cost per cwt RMA posted that day, and the actual ending values it posted later. Nothing is estimated or modeled. ${bt.counts.offers.toLocaleString("en-US")} offers, ${bt.counts.trials.toLocaleString("en-US")} entries once each coverage band is counted.</li>
        <li><b>What is tested.</b> Feeder cattle steers, weight 2 (RMA type ${bt.method.products[0].type}), fed cattle steers and heifers (type ${bt.method.products[1].type}) and hogs (type ${bt.method.products[2].type}). Other feeder types settle on the same index times their factor, so per $100 of coverage they come out the same. Not tested: unborn hogs, and the types RMA added from insurance year 2026 on (unborn calves and cull cows, ${a(RMA.pm25028, "RMA PM-25-028")}; weight-2 unborn feeders), which are too new.</li>
        <li><b>One entry.</b> One animal, one sales day, one length, one coverage band. Per $100 of coverage: paid = coverage price minus actual ending value, when that is above zero; your premium = RMA&rsquo;s cost per cwt less the subsidy; net = paid minus your premium. In each band the entry takes the highest level offered that day, so the 95 to 100% record is about ${v.top} coverage on average. The record above is the plain average over every sales day.</li>
        <li><b>Walk-forward &ldquo;best so far.&rdquo;</b> On each sales day it ranks the bands by their record among policies of the same length that had already ended at least ${bt.method.settle_lag_days} days before, so the ending value was out, once a band had ${bt.method.min_settled} such entries, and takes the best-ranked band RMA offered that day. It uses RMA&rsquo;s latest posted ending values; RMA restated ${restated == null ? "some" : restated.toLocaleString("en-US")} of them after first posting them.</li>
        <li><b>The odds.</b> Daily entries overlap, so each insurance year counts once: the test flips the sign of each year&rsquo;s average every possible way (exact sign flip) and asks how often that does as well as the real record. It runs only with ${bt.method.min_years} or more years of ${bt.method.min_trials_per_year}+ sales days. All ${bt.family_size} tests are adjusted together (Holm); kept means adjusted odds under 0.05, ahead on average, and ahead at every length with enough years.</li>
        <li><b>Gaps.</b> ${missN} sales-day offers whose end date had passed with no ending value posted by RMA are left out (${parts(miss)}). Policies still running are left out until they end. ${fileLines}</li>
        <li><b>Basis is not covered.</b> LRP pays on the index, so every number here is at the index, not at your sale barn or packer.</li>
      </ul>
      <h3>Subsidy used, by coverage band</h3>
      ${subsidyTable(bt)}`;
}

export function whenHtml(today) {
  return esc(L.whenText(today)).replace(/'/g, "&rsquo;");
}

/* a short dated table of that day's top offers, for no-JavaScript readers and crawlers */
export function offersStatic(today) {
  const d = L.salesDay(today);
  const main = [["0801", "810", "Feeder steers, weight 2"], ["0802", "820", "Fed steers and heifers"], ["0815", "997", "Hogs"]];
  let rows = "";
  for (const [c, t, name] of main) {
    const o = today.offers.filter((x) => x.c === c && x.t === t).sort((x, y) => x.len - y.len)[0];
    if (!o) { rows += `<tr><th scope="row">${name}</th><td colspan="3" class="na">No offers that sales day</td></tr>`; continue; }
    const top = L.offerRow(o.r.reduce((m, r) => (r[0] > m[0] ? r : m)));
    rows += `<tr><th scope="row">${name}, ${o.len} weeks</th><td>${L.levelPct(top.level)}</td><td>${money(top.coverage)}</td><td>${money(top.yourPerCwt, 3)}</td></tr>`;
  }
  return `<div class="lrp-tw"><table class="lrp-t"><caption>Top coverage RMA offered for sales on ${d.dayShort}, ${d.day.slice(0, 4)}</caption><thead><tr><th scope="col">Animal</th><th scope="col">Level</th><th scope="col">Coverage a cwt</th><th scope="col">Your premium a cwt</th></tr></thead><tbody>${rows}</tbody></table></div>`;
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

/* Since July 2020 (today's subsidy, the premium billed at the end): what
   each $1 of the producer's premium at the top coverage paid back, by
   animal and length, with the years behind it. Too few years: no number. */
export function backJson(bt) {
  const out = {};
  for (const p of L.PRODUCTS) {
    const id = L.ANIMAL_OF[p.comm];
    out[id] = {};
    for (const len of L.LENGTHS) {
      const r = bt.record[`current/${p.id}/${bt.method.base}/${len}`];
      if (!r) continue;
      out[id][len] = r.years >= bt.method.min_years && r.cost_now > 0
        ? { back: Math.round((r.paid / r.cost_now) * 100) / 100, years: r.years, paid: L.per100(r.paid_share) }
        : { years: r.years };
    }
  }
  out.min_years = bt.method.min_years;
  return JSON.stringify(out);
}

/* the same, in words, for readers with no JavaScript: 13 weeks, each animal */
export function hist0(bt) {
  const cur = L.backPerDollar(bt, "current", 13, true);
  if (!cur.length) return "";
  return `Since July 2020, at the top coverage offered (95 to 100%) for 13 weeks, each $1 of premium the farmer paid got back ${list(cur.map((x) => `${money(x.back)} on ${x.product.name.toLowerCase()}`))}.`;
}

export function byHtml(v) {
  return `By <a href="/about">Sigurd Lindquist</a>, CCA, who owns a licensed crop insurance agency. This page sells nothing, asks for no contact details and sends no one to any agent. <time datetime="${v.iso}">Record read ${v.asof}</time>.`;
}

/* -------------------------------------------------------------- write */

/* The first-screen example: a dated cost before any input. 100 feeder
   steers at 550 lb (RMA type 809, steers weight 1), 13 weeks, the top
   coverage that sales day offered, premium after today's subsidy. Labeled
   an example, with the sales day it came from; a missing offer says so. */
export const EXAMPLE = { head: 100, lb: 550, comm: "0801", type: "809", len: 13, cls: "steers" };
export function exampleStatic(today) {
  const d = L.salesDay(today), E = EXAMPLE, cwt = E.lb / 100;
  const day = `${d.dayShort}, ${d.day.slice(0, 4)}`;
  const o = today.offers.find((x) => x.c === E.comm && x.t === E.type && x.len === E.len);
  const inRange = o && cwt >= +o.w[0] && cwt <= +o.w[1];
  if (!o || !inRange) {
    return `<p class="lrp-ex-k">Example</p><p>RMA posted no ${E.len}-week offer for ${E.lb} lb feeder steers for sales on ${day}. Pick your own animal below.</p>`;
  }
  const top = L.offerRow(o.r.reduce((m, r) => (r[0] > m[0] ? r : m)));
  const h = L.forHerd(top, cwt, E.head);
  const sub = top.subsidy == null ? "" : ` after the ${Math.round(top.subsidy * 100)}% subsidy`;
  const prem = top.yourPerCwt == null ? "not figured (no subsidy rate for that level)"
    : `<b>${money(top.yourPerCwt, 3)} a cwt, ${money(h.premHead)} a head</b>, ${money(h.premAll, 0)} for the ${E.head} head`;
  const q = L.toQuery({ a: "feeder", h: String(E.head), w: String(E.lb), l: E.len, k: E.cls });
  return `<p class="lrp-ex-k">Example, change it below</p>` +
    `<p><b>${E.head} feeder steers at ${E.lb} lb, ${E.len} weeks</b> (end date ${ymdLong(o.end)}), top coverage ${L.levelPct(top.level)}: a floor of ${money(top.coverage)} a cwt. ` +
    `Your premium${sub}: ${prem}.</p>` +
    `<p class="src">From RMA&rsquo;s offers for sales on ${day}, ${esc(L.typeName(E.comm, E.type, today.ry, o.w).toLowerCase())}. Not a quote for your cattle. <a href="/lrp${q.replace(/&/g, "&amp;")}">Load this example</a></p>`;
}

function put(h, name, body) {
  const re = new RegExp(`<!--lrp:${name}-->[\\s\\S]*?<!--/lrp:${name}-->`);
  if (!re.test(h)) throw new Error(`${PAGE}: no <!--lrp:${name}--> marker`);
  return h.replace(re, () => `<!--lrp:${name}-->${body}<!--/lrp:${name}-->`);
}

function values(bt, meta, today, sob) {
  const v = bakeValues(bt, meta, today, sob);
  v.iso = `${bt.as_of.slice(0, 4)}-${bt.as_of.slice(4, 6)}-${bt.as_of.slice(6, 8)}`;
  return v;
}

/* lrp.html: the calculator */
export function bake(h, bt, meta, today, sob = null) {
  const v = values(bt, meta, today, sob);
  h = put(h, "jsonld", jsonld(v));
  h = put(h, "when", whenHtml(today));
  h = put(h, "example", exampleStatic(today));
  h = put(h, "offers0", offersStatic(today));
  h = put(h, "first", firstYears(meta, today));
  h = put(h, "back", backJson(bt));
  h = put(h, "hist0", hist0(bt));
  h = put(h, "faq", faqHtml(v));
  h = put(h, "by", byHtml(v));
  return h;
}

/* copy one static block (<!-- static-nav:NAME ... --> to <!-- /static-nav:NAME -->) from the calculator */
function copyBlock(h, from, name) {
  const re = new RegExp(`<!-- static-nav:${name}[\\s\\S]*?<!-- /static-nav:${name} -->`);
  const m = from.match(re);
  if (!m || !re.test(h)) throw new Error(`no static-nav:${name} block`);
  return h.replace(re, () => m[0]);
}

/* lrp/record.html: how the numbers were checked */
export function bakeRecord(h, calc, bt, meta, today, sob = null) {
  const v = values(bt, meta, today, sob);
  for (const name of ["fonts", "header", "footer"]) h = copyBlock(h, calc, name);
  h = put(h, "answer", answerHtml(bt, v, today));
  h = put(h, "pick", pickHtml(bt, sob));
  h = put(h, "record", recordHtml(bt, v, sob));
  h = put(h, "tested", testedHtml(bt));
  h = put(h, "method", methodHtml(bt, meta, v));
  h = put(h, "by", byHtml(v));
  return h;
}

export function readAll() {
  return { bt: read("data/lrp/bt.json"), meta: read("data/lrp/meta.json"), today: read("data/lrp/today.json"),
    sob: existsSync(ROOT + "data/lrp/sob-loss.json") ? read("data/lrp/sob-loss.json") : null };
}

function main() {
  const check = process.argv.includes("--check");
  const { bt, meta, today, sob } = readAll();
  const before = readFileSync(ROOT + PAGE, "utf8");
  const after = bake(before, bt, meta, today, sob);
  const rBefore = readFileSync(ROOT + RECORD, "utf8");
  const rAfter = bakeRecord(rBefore, after, bt, meta, today, sob);
  if (check) {
    let bad = false;
    if (after !== before) { console.error(`${PAGE} is stale: run node scripts/bake_lrp.mjs`); bad = true; }
    if (rAfter !== rBefore) { console.error(`${RECORD} is stale: run node scripts/bake_lrp.mjs`); bad = true; }
    if (bad) process.exit(1);
    console.log(`${PAGE} and ${RECORD} match data/lrp`);
    return;
  }
  if (after !== before) writeFileSync(ROOT + PAGE, after);
  if (rAfter !== rBefore) writeFileSync(ROOT + RECORD, rAfter);
  console.log(`${PAGE} ${after !== before ? "baked" : "unchanged"}; ${RECORD} ${rAfter !== rBefore ? "baked" : "unchanged"}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
