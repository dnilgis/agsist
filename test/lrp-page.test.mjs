/* /lrp: the shared math and tables (components/lrp.js), the bake that writes
 * the record into lrp.html (scripts/bake_lrp.mjs), and the page's rules:
 * neutral, no selling, FAQ and JSON-LD word for word, small enough.
 *
 * The shipped file runs in a bare context, so a green run checks the copy
 * the browser runs.
 *
 *   node --test test/lrp-page.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { bake, faqList, pickHtml, methodHtml, answerHtml, readAll } from "../scripts/bake_lrp.mjs";
import { subsidy as btSubsidy } from "../scripts/lrp_backtest.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const ctx = { window: {}, Intl, Date };
vm.runInNewContext(read("components/lrp.js"), ctx);
const L = ctx.window.AgLrp;
const near = (a, b, msg, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);
const BT = JSON.parse(read("data/lrp/bt.json"));
const META = JSON.parse(read("data/lrp/meta.json"));
const TODAY = JSON.parse(read("data/lrp/today.json"));
const SOB = readAll().sob;
const PAGE = read("lrp.html");

/* a small results file with a known answer */
function fakeBt(over = {}) {
  const t = (regime, product, test, o) => ({ regime, product, test, what: "", trials: 500, years_tested: 13, p: 0.5,
    not_run: null, years_positive: 6, mean: -0.1, p_holm: 1, positive_every_length: false, kept: false, years: {}, ...o });
  const tests = {
    "all/fed/paid": t("all", "fed", "paid", { p: 0.001, p_holm: 0.02, mean: -1.7, years_positive: 3 }),
    "all/fed/band:85-90": t("all", "fed", "band:85-90", { p: 0.0095, p_holm: 0.33, mean: 1.06, years_positive: 10 }),
    "all/fed/band:90-95": t("all", "fed", "band:90-95", { p: 0.018, p_holm: 0.62, mean: 0.6, years_positive: 10 }),
    "all/swine/band:70-80": t("all", "swine", "band:70-80", { p: 0.001, p_holm: 0.03, mean: -0.8 }),
    "current/fed/band:85-90": t("current", "fed", "band:85-90", { years_tested: 6, years_positive: 6, p: 1 / 32, mean: 1.5 }),
    "current/feeder/band:70-80": t("current", "feeder", "band:70-80", { years_tested: 2, years_positive: 2, p: null, not_run: "few", mean: 2 }),
  };
  return { ...BT, family_size: 36, kept: [], tests, ...over };
}

test("coverage price, your premium and the herd total come from RMA's row and the subsidy band", () => {
  // [level_e6, coverage_price_milli, rate_e6, cost_per_cwt_milli] from today.json, feeder steers weight 1, 13 weeks
  const r = L.offerRow([950000, 348840, 17069, 5954]);
  near(r.coverage, 348.84, "coverage");
  near(r.subsidy, 0.35, "95% is in the 95-100 band");
  near(r.yourPerCwt, 5.954 * 0.65, "premium after subsidy");
  near(L.offerRow([949999, 1, 1, 1000]).subsidy, 0.40, "94.9999% is 90-95");
  near(L.offerRow([750000, 1, 1, 1000]).subsidy, 0.55, "75% is 70-80");
  const f = L.forHerd(r, 7.5, 100);
  near(f.coverHead, 348.84 * 7.5, "coverage a head");
  near(f.premHead, 5.954 * 0.65 * 7.5, "premium a head");
  near(f.premAll, 5.954 * 0.65 * 7.5 * 100, "premium for the lot");
  assert.equal(L.forHerd(r, 0, 100).premAll, null, "no weight, no total");
});

test("the page's subsidy table is the backtest's from RY2021 on", () => {
  for (const lv of [1, 0.95, 0.94, 0.9, 0.875, 0.85, 0.82, 0.8, 0.79, 0.75, 0.7]) {
    assert.equal(L.subsidyNow(lv), btSubsidy(2027, lv), `level ${lv}`);
  }
});

test("sales close 8:25 a.m. CT the calendar day after; a Friday's close Saturday", () => {
  assert.equal(L.salesClose("20261014"), "202610150825");
  assert.equal(L.salesClose("20261016"), "202610170825");   // Friday -> Saturday
  assert.equal(L.salesClose("20261231"), "202701010825");
  // 13:30 UTC on Oct 15 is 8:30 a.m. CDT: the Oct 14 window has closed
  assert.ok(L.centralNow(new Date("2026-10-15T13:30:00Z")) >= L.salesClose("20261014"));
  assert.ok(L.centralNow(new Date("2026-10-15T13:20:00Z")) < L.salesClose("20261014"));
});

test("formats: coverage levels, money, odds, dates", () => {
  assert.equal(L.levelPct(0.925), "92.5%");
  assert.equal(L.levelPct(0.875), "87.5%");
  assert.equal(L.levelPct(1), "100%");
  assert.equal(L.money(-0.15), "−$0.15");
  assert.equal(L.money(-0.001), "$0.00");
  assert.equal(L.money(12443.684), "$12,443.68");
  assert.equal(L.odds(1), "1");
  assert.equal(L.odds(0.0313), "0.031");
  assert.equal(L.ymdLong("20261014"), "Oct 14, 2026");
});

test("type names are per reinsurance year; an unknown year falls back to the code and weights", () => {
  assert.equal(L.typeName("0801", "823", "2027"), "Unborn calves");
  assert.equal(L.typeName("0801", "823", "2031", ["0.60", "0.99"]), "Type 823 (0.60 to 0.99 cwt)");
  for (const o of TODAY.offers) {
    if (TODAY.ry === "2027") assert.ok(!/^Type /.test(L.typeName(o.c, o.t, TODAY.ry)), `no name for ${o.c}/${o.t}`);
  }
});

test("the record table says too few years instead of a number", () => {
  const h = L.recordTable(BT, "all");
  assert.match(h, /too few/);
  const r = BT.record["all/feeder/95-100/13"];
  assert.ok(h.includes(L.money(r.net)), "the 13-week feeder figure is in the table");
  assert.ok(!/NaN|undefined/.test(h));
});

test("nothing kept: the pick panel picks nothing and names the closest call without recommending it", () => {
  const h = pickHtml(fakeBt());
  assert.match(h, /No coverage level beat 95 to 100%\./);
  assert.match(h, /This compares coverage levels\. It does not say whether to insure\./);
  assert.match(h, /Ahead means it lost less on average because it covered less; in a crash it pays less\./);
  assert.match(h, /Closest call, not proven:<\/b> fed cattle at 85 to 90%/, "smallest Holm odds among positive tests, not the paid test");
  assert.match(h, /90 to 95% did about the same/);
  // six years: the exact sign flip's smallest odds are 2/2^6 = 1 in 32 (bt.json shows p = 0.0313)
  assert.match(h, /smallest odds the test can give are 1 in 32,/);
  assert.match(h, /I am not recommending it/);
});

test("something kept: the panel lists it and the answer says so", () => {
  const bt = fakeBt();
  bt.tests["all/fed/band:85-90"] = { ...bt.tests["all/fed/band:85-90"], kept: true, p_holm: 0.01 };
  bt.kept = ["all/fed/band:85-90"];
  assert.match(pickHtml(bt), /1 of 36 tests held up/);
  assert.match(answerHtml(bt, { family: "36", first: "Jul 1, 2013", asof: "Oct 14, 2026", top: "99%" }, TODAY), /1 of 36 tests held up: fed cattle/);
});

test("the method names the gaps: missing ending values and any file RMA served broken", () => {
  const h = methodHtml(BT, META, { files: "6,922", first: "Jul 1, 2013", last: "Oct 14, 2026" });
  const miss = Object.values(BT.counts.aev_missing).reduce((s, x) => s + x, 0);
  assert.ok(h.includes(`${miss} sales-day offers`));
  for (const f of META.unreadable_files || []) assert.ok(h.includes(f.file), f.file);
  assert.match(h, /Basis is not covered/);
});

test("lrp.html matches data/lrp (scripts/bake_lrp.mjs --check)", () => {
  assert.equal(bake(PAGE, BT, META, TODAY, SOB), PAGE, "run node scripts/bake_lrp.mjs");
});

test("FAQ: the JSON-LD answers are the visible answers, word for word", () => {
  const ld = [...PAGE.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const faq = ld.flatMap((x) => x["@graph"] || [x]).find((x) => x["@type"] === "FAQPage");
  const vis = [...PAGE.matchAll(/<details><summary>(.*?)<\/summary><p>(.*?)<\/p><\/details>/gs)];
  assert.equal(faq.mainEntity.length, faqList().length);
  assert.equal(vis.length, faqList().length);
  const plain = (s) => s.replace(/<[^>]+>/g, "").replace(/&rsquo;/g, "’").replace(/&amp;/g, "&");
  faq.mainEntity.forEach((q, i) => {
    assert.equal(q.name, plain(vis[i][1]));
    assert.equal(q.acceptedAnswer.text, plain(vis[i][2]));
  });
  const app = ld.flatMap((x) => x["@graph"] || [x]).find((x) => x["@type"] === "WebApplication");
  assert.equal(app.url, "https://agsist.com/lrp");
});

test("every rule in the FAQ cites RMA", () => {
  for (const [q, a] of faqList()) {
    if (/worth it/.test(q)) continue;
    assert.match(a, /rma\.usda\.gov|RMA LRP Handbook 2027 \(FCIC-20010\)/, q);
  }
});

test("neutral page: no agent routing, no sales, no sponsor price, no em dashes", () => {
  const files = ["lrp.html", "components/lrp.js", "components/lrp-ui.js", "scripts/bake_lrp.mjs"];
  for (const f of files) {
    const s = read(f);
    assert.ok(!s.includes("—") && !s.includes("&mdash;"), `${f} has an em dash`);
  }
  assert.ok(!/agent-locator|find an agent|contact an agent|buy now|sign up for lrp/i.test(PAGE));
  assert.ok(!/ag-sponsor|\$\d+\/mo/.test(PAGE), "no sponsor ribbon or price");
  assert.match(PAGE, /What the numbers would pick/);
  assert.match(PAGE, /History only, not advice/);
});

test("the byline sits at the bottom, not in the hero", () => {
  // the same byline and disclosure as /prf: an insurance page
  const by = PAGE.indexOf('<p class="by"><!--lrp:by-->By <a href="/about">Sigurd Lindquist</a>, a Certified Crop Adviser (CCA) who owns a licensed crop insurance agency. This page sells nothing, asks for no contact details and sends no one to any agent.');
  assert.ok(by > PAGE.indexOf('id="questions"'), "byline after the FAQ heading");
  assert.ok(by > PAGE.indexOf('id="method"'));
});

test("one hand-written page, small; the bulky detail loads on demand", () => {
  assert.ok(statSync(ROOT + "lrp.html").size < 150 * 1024, "lrp.html under 150 KB");
  const ui = read("components/lrp-ui.js");
  assert.match(ui, /load\('today\.json'\)/);
  assert.match(ui, /load\('bt\.json'\)/);
  assert.ok(!/data\/lrp\/aev\.json/.test(PAGE + ui), "the page never loads the ending-value history");
});

test("LRP is in the menu, the phone drawer, the footer and the static fallbacks", () => {
  assert.equal((read("components/header.html").match(/href="\/lrp"/g) || []).length, 2);
  assert.equal((read("components/footer.html").match(/href="\/lrp"/g) || []).length, 1);
  assert.match(read("components/header-fallback.html"), /href="\/lrp"/);
  assert.match(read("components/footer-fallback.html"), /href="\/lrp"/);
  assert.match(read("sitemap.xml"), /<loc>https:\/\/agsist\.com\/lrp<\/loc>/);
  assert.match(read("scripts/make_prf_html.py"), /href="\/lrp"/);
  assert.match(read("prf.html"), /href="\/lrp"/);
  assert.match(read("cattle-futures-prices.html"), /href="\/lrp" class="ra"/);
});

test("offers are dated by the file's sales day and posting time, and closed at 8:25 a.m. CT the next day", () => {
  const T = { sed: "20261015", sales_day: "2026-10-15", posted_utc: "2026-10-15T19:22:12Z",
    sales_close_ct: "2026-10-16T08:25", sales_close_utc: "2026-10-16T13:25:00Z" };
  const d = L.salesDay(T);
  assert.equal(d.dayText, "Oct 15, 2026");
  assert.equal(d.postedClock, "2:22 p.m. CT", "posted on the sales day: the time only");
  assert.equal(d.closeText, "8:25 a.m. CT on Fri Oct 16, 2026");
  assert.equal(d.closed(new Date("2026-10-16T13:24:59Z")), false);
  assert.equal(d.closed(new Date("2026-10-16T13:25:00Z")), true, "never today's after the close");
  // posted_utc not known yet: no posting time, nothing broken
  const n = L.salesDay({ ...T, posted_utc: null });
  assert.equal(n.posted, "");
  // an older file with only sed: RMA's rule, 8:25 a.m. CT the next day
  const o = L.salesDay({ sed: "20261014" });
  assert.equal(o.closeText, "8:25 a.m. CT on Thu Oct 15, 2026");
  assert.equal(o.closed(new Date("2026-10-15T13:30:00Z")), true);
  assert.equal(o.closed(new Date("2026-10-15T13:20:00Z")), false);
});

test("the page script labels offers with the sales day and says when sales on them closed", () => {
  const ui = read("components/lrp-ui.js");
  assert.match(ui, /L\.salesDay\(T\)/);
  assert.match(ui, /L\.closedText\(T\)/);
  assert.match(read("components/lrp.js"), /posted by RMA/);
});

/* ------------------------------------------------ after the 5-lens audit */

test("ship-blocker: the record's net is paid minus cost, averaged over every sales day", () => {
  for (const [k, r] of Object.entries(BT.record)) {
    near(r.net, r.paid - r.cost, `${k}`, 0.0021);
    near(r.net_now, r.paid - r.cost_now, `${k} at today's subsidy`, 0.0021);
  }
  // the reviewers' worked case: feeder 47 weeks since 2013 is about -3.30, not -1.08
  assert.ok(BT.record["all/feeder/95-100/47"].net < -3, String(BT.record["all/feeder/95-100/47"].net));
});

test("ship-blocker: pounds typed in the weight box are read as pounds", () => {
  const w = L.readWeight("850", "0801");
  near(w.cwt, 8.5, "850 lb");
  assert.match(w.note, /Read as 850 lb = 8\.50 cwt/);
  near(L.readWeight("8.5", "0801").cwt, 8.5, "8.5 cwt");
  near(L.readWeight("1,250", "0802").cwt, 12.5, "with a comma");
  assert.equal(L.readWeight("", "0801").cwt, null, "the box can be empty");
  // hogs are typed live and insured lean, x 0.74
  const h = L.readWeight("270", "0815");
  near(h.cwt, 2.7 * 0.74, "270 lb live hog");
  assert.match(h.note, /x 0\.74 = 2\.00 cwt lean/);
  // and the page script uses it, never parseFloat on the raw box
  const ui = read("components/lrp-ui.js");
  assert.match(ui, /L\.readWeight\(cwtIn\.value, o\.c\)/);
});

test("outside RMA's weight range or over the head limit, totals are blanked and the page says why", () => {
  const o = { c: "0801", w: ["6.00", "10.00"] };
  assert.equal(L.weightProblem(o, 8, 100), "");
  assert.match(L.weightProblem(o, 85, 100), /6\.00 to 10\.00 cwt/);
  assert.match(L.weightProblem(o, 8, 12001), /12,000 head/);
  assert.equal(L.weightProblem({ c: "0815", w: ["1.40", "2.60"] }, 2, 70000), "");
  assert.match(L.weightProblem({ c: "0815", w: ["1.40", "2.60"] }, 2, 70001), /70,000 head/);
});

test("the hero says what the record can say, at today's subsidy, and points at the premium", () => {
  assert.match(PAGE, /No lower coverage level beat 95 to 100% by more than luck could explain\./);
  assert.match(PAGE, /It does not say whether to insure\./);
  assert.match(PAGE, /<a class="lrp-go" href="#today">Your premium today/);
  const hero = PAGE.slice(PAGE.indexOf("<!--lrp:answer-->"), PAGE.indexOf("<!--/lrp:answer-->"));
  assert.match(hero, /at today&rsquo;s subsidy/);
  assert.ok(hero.includes(L.money(BT.record["all/feeder/95-100/13"].net_now)), "hero shows today's-subsidy figures");
  assert.match(hero, /<span>\d+ of 100<\/span>/);
  assert.match(hero, /600 steers at 8\.5 cwt/);
  assert.match(hero, /Since July 2020 it paid back/, "hogs never read as paying for themselves without the current regime beside it");
  assert.match(PAGE, /at the subsidy in force that year/);
});

test("fed cattle 95 to 100% reads as a clear no, and the closest call says why it was ahead", () => {
  const t = BT.tests["all/fed/paid"];
  assert.equal(L.verdict(t), `No: lost money in ${t.years_tested - t.years_positive} of ${t.years_tested} years`);
  assert.match(PAGE, /lost less on average because it covered less/);
  assert.match(PAGE, /came in above RMA&rsquo;s expected ending value in \d+ of \d+ insurance years/);
  assert.match(PAGE, /Even counting only the 12 tests/);
});

test("the offers are dated with weekdays, a static summary is baked for crawlers, and closed is re-checked", () => {
  assert.match(PAGE, /Offers for sales on (Mon|Tue|Wed|Thu|Fri) [A-Z][a-z]{2} \d+, \d{4}.*Buy by 8:25 a\.m\. CT (Tue|Wed|Thu|Fri|Sat) /);
  assert.match(PAGE, /<caption>Top coverage RMA offered for sales on /);
  const ui = read("components/lrp-ui.js");
  assert.match(ui, /setInterval\(tick, 60000\)/);
  assert.match(read("components/lrp.js"), /\(closed, for reference\)/);
  assert.match(ui, /No ' \+ esc\(prod\.name\.toLowerCase\(\)\) \+ ' offers on this sales day/, "a missing animal is said, not switched");
  assert.match(ui, /RMA posted no offers for this sales day/);
  assert.ok(L.isStale({ sales_day: "2026-10-12" }, new Date("2026-10-15T23:00:00Z")), "Mon offers on Thu evening");
  assert.ok(!L.isStale({ sales_day: "2026-10-14" }, new Date("2026-10-15T19:00:00Z")), "Wed offers on Thu afternoon");
  assert.ok(!L.isStale({ sales_day: "2026-10-16" }, new Date("2026-10-19T15:00:00Z")), "Fri offers on Mon morning");
});

test("accessibility: one status line, row choice by button, captions, groups", () => {
  assert.ok(!/id="lrp-out" aria-live/.test(PAGE), "no live region on the whole block");
  assert.equal((PAGE.match(/role="status"/g) || []).length, 2, "the offers status and the results-file status");
  const ui = read("components/lrp-ui.js");
  assert.match(ui, /class="rowbtn" data-level="' \+ r\.level \+ '" aria-pressed="/);
  assert.match(ui, /<caption>' \+ esc\(L\.captionText\(T, closed\)\) \+ '<\/caption>/);
  assert.match(ui, /class="lrp-math" role="group"/);
  assert.match(L.testsTable(BT), /<tbody><tr class="grp"><th scope="colgroup"/);
  assert.match(PAGE, /@media print/);
});

test("FAQ: is it worth it comes first, and the put comparison makes no margin claim", () => {
  const q = faqList();
  assert.equal(q[0][0], "Is LRP worth it?");
  const put = q.find(([x]) => /put option/.test(x))[1];
  assert.ok(!/margin/i.test(put), "no margin claim");
  assert.match(put, /no futures account/);
  assert.match(put, /billed after the end date/);
});

test("title is short and the menu label is plain", () => {
  const t = PAGE.match(/<title>(.*?)<\/title>/)[1];
  assert.equal(t, "LRP Calculator: Today's Rates and Premium per Head | AGSIST");
  assert.ok(t.length <= 65);
});

test("the caption, the posted line, the buy-by line and the closed banner all name the same sales day", () => {
  const nextWd = (ymd) => L.wdShort(L.addDays(ymd, 1));
  const cases = [
    TODAY,
    { sales_day: "2026-10-15", posted_utc: "2026-10-15T19:29:15Z", sales_close_ct: "2026-10-16T08:25", sales_close_utc: "2026-10-16T13:25:00Z" },
    { sales_day: "2026-10-16", posted_utc: "2026-10-16T19:30:00Z" },                     // a Friday: closes Saturday
    { sed: "20261014" },                                                                // an older file
    { sales_day: "2026-10-14", posted_utc: "2026-10-15T02:10:00Z" },                     // RMA late, posted the next calendar day
    // a file whose own close disagrees with RMA's rule: the rule wins, and it is flagged
    { sales_day: "2026-10-15", sales_close_ct: "2026-10-15T08:25", sales_close_utc: "2026-10-15T13:25:00Z" },
  ];
  for (const T of cases) {
    const d = L.salesDay(T), day = d.day;
    const when = L.whenText(T), banner = L.closedText(T);
    assert.ok(when.startsWith(`Offers for sales on ${L.wdShort(day)}, ${day.slice(0, 4)}`), when);
    assert.ok(when.endsWith(`Buy by 8:25 a.m. CT ${nextWd(day)}.`), when);
    assert.ok(banner.includes(`closed at 8:25 a.m. CT on ${nextWd(day)}, `), banner);
    assert.equal(L.captionText(T, true), `For sales on ${L.wdShort(day)} (closed, for reference)`);
    assert.equal(L.captionText(T, false), `For sales on ${L.wdShort(day)}`);
    if (d.postedDay && d.postedDay !== day) assert.ok(when.includes(`posted by RMA ${L.wdShort(d.postedDay)}, `), "a posting on another day names its day");
    // closed exactly from 8:25 a.m. CT the next day (CDT in October: 13:25 UTC)
    const nd = L.addDays(day, 1);
    const iso = `${nd.slice(0, 4)}-${nd.slice(4, 6)}-${nd.slice(6, 8)}`;
    assert.equal(d.closed(new Date(`${iso}T13:24:00Z`)), false, `${day} still open at 8:24`);
    assert.equal(d.closed(new Date(`${iso}T13:25:00Z`)), true, `${day} closed at 8:25`);
  }
  assert.equal(L.salesDay(cases[5]).closeAgrees, false, "the mismatched file is flagged");
  assert.equal(L.salesDay(cases[1]).closeAgrees, true);
  // the page and its script take every date from these helpers only
  const ui = read("components/lrp-ui.js");
  assert.ok(!/sales_close|\.sed\b/.test(ui), "the script never reads the file's close or sed directly");
  assert.match(ui, /L\.whenText\(T\)/);
  assert.match(ui, /L\.captionText\(T, closed\)/);
  assert.ok(PAGE.includes(`<!--lrp:when-->${L.whenText(TODAY).replace(/'/g, "&rsquo;")}<!--/lrp:when-->`));
  assert.match(PAGE, new RegExp(`Top coverage RMA offered for sales on ${L.wdShort(L.salesDay(TODAY).day)}, `));
});

test("rule facts cite RMA's 2027 LRP handbook (FCIC-20010) by section, with the claim mechanics", () => {
  const faq = Object.fromEntries(faqList());
  const hb = "RMA LRP Handbook 2027 (FCIC-20010)";
  assert.match(faq["How many head can I cover with LRP?"], /12,000 head on one endorsement and 25,000.*70,000.*750,000/);
  assert.ok(faq["How many head can I cover with LRP?"].includes(`${hb}, sections 23B, 24B and 25B`));
  assert.ok(faq["When is the LRP premium due?"].includes(`first day of the second month after the end date (${hb}, section 21E)`));
  const pay = faq["How does an LRP payment work?"];
  assert.match(pay, /more than 60 days before the end date ends coverage on them, and the premium is still owed \(section 21C\(3\)\)/);
  assert.match(pay, /no later than 60 days after the end date \(30 days for unborn calves\)/);
  assert.match(pay, /slaughtered on or near the end date \(section 24A\)/);
  assert.match(pay, /within 60 days of getting it, and payment comes within 30 days of the form \(section 21G\)/);
  const when = faq["When can I buy LRP, and when do sales close?"];
  assert.match(when, /8:25 a\.m\. Central the following calendar day/);
  assert.match(when, /Cattle and Cattle on Feed reports/);
  assert.match(when, /4:30 p\.m\. Central \(section 22B\)/);
  assert.ok(!/federal or CME holidays/.test(when), "the handbook says days the CME livestock markets are closed");
  assert.match(read("components/lrp-ui.js"), /live weight x 0\.74.*section 25A/);
  assert.ok(!/Handbook%202026/.test(read("scripts/bake_lrp.mjs")), "no 2026 handbook link from a search snippet");
});
