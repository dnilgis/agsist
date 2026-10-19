/* harvest-price-tracker.html, Oct 19 2026 audit (panel + adversary). One test per confirmed item,
 * from the real files on disk:
 *   1  the FAQ opens "In most Corn Belt states" and names the states off that calendar, baked from
 *      data/rma-prices.json by scripts/fetch_harvest_prices.py, visible and in the FAQPage JSON-LD
 *   2  the section note carries the same text as the verdict drawer
 *   3  a released final price: "Your revenue guarantee revised up", past tense (Georgia corn)
 *   4  a $/bu figure is the projected price, not "guarantee"
 *   5  contracts named with what they ride on and the year when not the crop year
 *   6  one day count: trading days from the settles on file
 *   7  the yield below which RP pays, and the farm total
 *   8  the loss box, 9 and 13 in the script's selftest, 10 the cached cards refresh and go stale
 *   11 the source line, 12 tags stacked when close, 14 JS off, data failure, print, table a11y
 *   15 reviewer at the end, 16 Texas options by sales closing date, 17 RMA's app link
 *
 *   node --test test/harvest-tracker-oct19.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAGE = readFileSync(join(ROOT, "harvest-price-tracker.html"), "utf8");
const HP = JSON.parse(readFileSync(join(ROOT, "data/harvest-prices.json"), "utf8"));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const TEXTS = JSON.parse(execFileSync("python3", ["-c",
  "import json,sys; sys.path.insert(0,'scripts'); import fetch_harvest_prices as f; " +
  "print(json.dumps(f.exception_texts(json.load(open('data/rma-prices.json')))))"], { cwd: ROOT, encoding: "utf8" }));
const unent = (s) => s.replace(/&rsquo;/g, "’");
const faqLd = () => {
  for (const m of PAGE.matchAll(/<script type="application\/ld\+json">\s*(\{[\s\S]*?\})\s*<\/script>/g)) {
    const d = JSON.parse(m[1]); if (d["@type"] === "FAQPage") return d;
  }
  return null;
};

test("1, 2: FAQ, drawer and note name the off-calendar states from RMA's file, visible and in JSON-LD", () => {
  assert.match(TEXTS.proj, /January 15 to February 14 in 11 states \(Alabama, Arizona, Arkansas, California, Florida, Georgia, Louisiana, Mississippi, Nevada, North Carolina and South Carolina\)/);
  assert.match(TEXTS.proj, /Alabama, Florida, Georgia, Louisiana, South Carolina and part of Texas price corn on the September contract/);
  assert.match(TEXTS.proj, /Alabama, Delaware, Florida, Georgia, Maryland, North Carolina, Oklahoma, South Carolina, Virginia and West Virginia price soybeans on the January 2027 contract/);
  for (const k of ["proj", "harv", "more"]) {
    const re = new RegExp(`<!--SEED:hpx-${k}-->([\\s\\S]*?)<!--/SEED:hpx-${k}-->`, "g");
    const got = [...PAGE.matchAll(re)].map((m) => m[1]);
    assert.ok(got.length >= 1 && got.every((x) => x === TEXTS[k]), k + " baked from rma-prices.json");
  }
  assert.equal((PAGE.match(/<!--SEED:hpx-more-->/g) || []).length, 2, "the verdict drawer and the section note say the same");
  const ld = faqLd();
  const ans = (q) => ld.mainEntity.find((x) => x.name === q).acceptedAnswer.text;
  for (const q of ["How is the projected price set?", "What price does the guarantee use?"]) {
    assert.match(ans(q), /^In most Corn Belt states, /, q);
    assert.ok(ans(q).includes(unent(TEXTS.proj)), q);
  }
  assert.match(ans("How is the harvest price set?"), /^In most Corn Belt states, the same contract/);
  assert.ok(ans("How is the harvest price set?").includes(TEXTS.harv));
  const bake = execFileSync("python3", ["scripts/bake_faq.py", "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.match(bake, /harvest-price-tracker\.html\s+already in sync/);
});

test("5, 14: the baked table names the underlying contract and scopes its headers", () => {
  const disc = /<!--SEED:discovery-->([\s\S]*?)<!--\/SEED:discovery-->/.exec(PAGE)[1];
  if (/Grain Sorghum/.test(disc)) assert.match(disc, /Grain Sorghum &middot; All<\/span><span class="dn-cx">December CBOT corn &middot; closes/);
  if (/Sunflowers/.test(disc)) assert.match(disc, /<span class="dn-cx">December CBOT soybean oil &middot; closes/);
  if (/<th/.test(disc)) assert.doesNotMatch(disc, /<th class=/, "every header has its scope");
  assert.doesNotMatch(disc, /\(\d+ days? left\)/, "days left are trading days");
});

test("8, 11, 14, 15, 17: loss box, source line, reviewer at the end, history table, RMA's app", () => {
  assert.match(PAGE, /<p class="madeby"[^>]*>Data: CBOT settles averaged daily on RMA&rsquo;s windows; USDA RMA&rsquo;s price is the official one\.<\/p>/);
  const m = PAGE.match(/<div class="method-note">[\s\S]*?<\/div>/)[0];
  assert.doesNotMatch(m, /Reviewed by/);
  assert.match(PAGE, /<p class="by-end"[^>]*>Reviewed by <a href="\/about">Sigurd Lindquist, CCA<\/a>/);
  assert.ok(PAGE.indexOf('class="by-end"') > PAGE.indexOf('class="hp-cred"'), "at the end of the page");
  const loss = /<section class="pd-loss"[\s\S]*?<\/section>/.exec(PAGE)[0];
  assert.match(loss, /within 72 hours of discovering it/);
  assert.match(loss, /leave representative strips unharvested/);
  assert.match(loss, /production records by unit/);
  assert.match(loss, /final harvest price is posted after the window closes/);
  assert.match(loss, /Common Crop Insurance Policy Basic Provisions/);
  assert.doesNotMatch(loss, /\bagent\b/i);
  assert.equal((PAGE.match(/prices\.rma\.usda\.gov/g) || []).length, 0);
  assert.match(PAGE, /href="https:\/\/public-rma\.fpac\.usda\.gov\/apps\/PriceDiscovery"/);
  const hist = /<table class="hp-hist">[\s\S]*?<\/table>/.exec(PAGE)[0];
  assert.equal((hist.match(/<th scope="row">\d{4}<\/th>/g) || []).length, (hist.match(/<tr>/g) || []).length - 1);
  assert.equal((hist.match(/&#9650;|&#9660;/g) || []).length, (hist.match(/<span class="sr-only">(above|below) projected,<\/span>/g) || []).length);
  assert.match(PAGE, /classList\.add\('hp-js'\)/);
  assert.match(PAGE, /html:not\(\.hp-js\) \.pd-pick,html:not\(\.hp-js\) \.pd-calc/);
  assert.match(PAGE, /@media print\{/);
  assert.doesNotMatch(PAGE.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, ""), /\u2014/, "no em dashes in what a reader sees");
});

test("10: the cached-card refresh looks where the cards are", () => {
  assert.match(PAGE, /querySelectorAll\('#pd-cards \.hp-card-s'\)/);
  assert.doesNotMatch(PAGE, /'#pd-fallback \.hp-card-s'/);
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    const f = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, when, opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  await pg.clock.setFixedTime(new Date(when));
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (!u.startsWith(`http://127.0.0.1:${port}`) || (opts.fail && u.includes(opts.fail))) return r.abort();
    return r.continue();
  });
  await pg.goto(`http://127.0.0.1:${port}/harvest-price-tracker.html`);
  return { ctx, pg, errors };
}
const pick = async (pg, st) => {
  await pg.waitForFunction(() => document.querySelector("#pd-state option[value=IA]"));
  await pg.selectOption("#pd-state", st);
  await pg.waitForFunction(() => !document.getElementById("pd-crop").disabled && !/Loading/.test(document.getElementById("pd-your").textContent));
};

test("in a browser at 390: Iowa, Georgia and Texas read right", { skip, timeout: 90000 }, async () => {
  const corn = HP.commodities.find((c) => c.label === "Corn");
  const ser = corn.harvest.series || [];
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const last = ser.length ? ser[ser.length - 1].d : "2026-10-16";
    const { ctx, pg, errors } = await open(browser, port, last + "T23:00:00Z");
    await pick(pg, "IA");
    const your = await pg.$eval("#pd-your", (x) => x.innerText.replace(/\s+/g, " "));
    if (corn.harvest.status === "running" && ser.length) {
      const left = corn.harvest.days_total - ser.length;
      assert.ok(your.includes(`${ser.length} /${corn.harvest.days_total} trading days counted, ${left} trading day${left === 1 ? "" : "s"} left · December CBOT corn contract`), your.slice(0, 300));
      assert.match(await pg.$eval("#pd-verdict-h", (x) => x.textContent), /^Your corn and soybean prices are being set right now\.$/);
    }
    if (corn.harvest.status === "running") assert.match(your, /would revise up \d+\.\d%: figured at the \$\d+\.\d\d \/bu running harvest price\./);
    assert.doesNotMatch(your, /, to \$\d+\.\d\d \/bu\./, "the $/bu figure is a price, never called the guarantee");
    assert.doesNotMatch(your, /Day \d+ \/\d+|\bguarantee(?= \$|<)| \$[\d.]+ guarantee/, "a $/bu price is the projected price");
    assert.match(your, /against the projected price/i);
    // 12: Iowa corn's two tags sit close: one above the track
    const close = await pg.$$eval("#pd-your .pd-pb", (bs) => bs.map((b) => !!b.querySelector(".pd-tags-top")));
    assert.ok(close.length >= 1);
    // 7: the trigger yield and the farm total, by hand from the page's own numbers
    await pg.selectOption("#pd-crop", await pg.$eval("#pd-crop", (s) => [...s.options].find((o) => o.textContent === "Corn").value));
    await pg.fill("#pd-aph", "180"); await pg.dispatchEvent("#pd-aph", "input");
    await pg.selectOption("#pd-cov", "0.85");
    await pg.fill("#pd-acres", "500"); await pg.dispatchEvent("#pd-acres", "input");
    const trig = await pg.$eval("#pd-trig", (x) => x.textContent);
    const g2 = await pg.$eval("#pd-gout2", (x) => x.textContent);
    const P = Number((await pg.$eval("#pd-gsub", (x) => x.textContent)).match(/\$(\d+\.\d\d)/)[1]);
    const Hm = g2.match(/harvest (?:price|average)[^$]*\$(\d+\.\d\d)/) || trig.match(/harvest price, \$(\d+\.\d\d)/);
    const H = Number(Hm[1]), Hc = Math.min(H, 2 * P), price = Math.max(P, Hc);
    const y = Math.round(180 * 0.85 * price / Hc * 10) / 10;
    assert.ok(trig.startsWith(`You collect only if your yield comes in under ${y.toLocaleString("en-US")} bu/ac`), trig);
    if (Hc >= P) assert.equal(y, 153);
    assert.match(trig, /An estimate at (today’s running harvest price|the final harvest price|RMA’s last posted harvest price), \$\d/);
    assert.ok(trig.includes(`On 500 acres the guarantee is $${Math.round(180 * 0.85 * price * 500).toLocaleString("en-US")}`), trig);
    assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth), 390);

    // 3, 5: Georgia corn closed in August on the September contract; soybeans ride January 2027
    await pick(pg, "GA");
    const ga = await pg.$eval("#pd-your", (x) => x.innerText.replace(/\s+/g, " "));
    assert.match(ga, /window closed Aug 31 · September CBOT corn contract/);
    assert.match(ga, /Your revenue guarantee revised up \d+\.\d%: it is now figured at the \$\d+\.\d\d \/bu harvest price\./);
    assert.doesNotMatch(ga, /If the window closed today/);
    assert.match(ga, /January 2027 CBOT soybeans/);
    // 16: Texas's options are told apart by the sales closing date
    await pick(pg, "TX");
    const opts = await pg.$$eval("#pd-crop option", (o) => o.map((x) => x.textContent));
    assert.ok(opts.includes("Corn (sales closing Jan 31)") && opts.includes("Corn (sales closing Mar 15)"), opts.join("|"));
    assert.deepEqual(errors, []);
    await ctx.close();

    // 10: a week on with no new settle, the cached card says so
    const stale = await open(browser, port, "2026-10-23T23:00:00Z");
    await stale.pg.waitForFunction(() => document.querySelector("#pd-state option[value=IA]"));
    if (corn.harvest.status === "running" && last <= "2026-10-19") {
      assert.match(await stale.pg.$eval("#pd-cards", (x) => x.innerText), new RegExp("Not updated since " +
        new Date(last + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }).replace(" ", "[ \\u00a0]") + "\\."));
    }
    await stale.ctx.close();

    // 14: the data does not load: the baked table stays, dated
    const bad = await open(browser, port, last + "T23:00:00Z", { fail: "/data/rma-prices/index.json" });
    await bad.pg.waitForFunction(() => /did not load/.test(document.getElementById("pd-verdict-h").textContent));
    assert.equal(await bad.pg.$eval("#pd-disc", (x) => x.hidden), false);
    assert.match(await bad.pg.$eval("#pd-disc-note", (x) => x.textContent), /^Live data did not load\. This table is as of [A-Z][a-z]+ \d+, \d{4}\.$/);
    await bad.ctx.close();

    // 14: JavaScript off: no dead picker or calculator
    const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const np = await nojs.newPage();
    await np.goto(`http://127.0.0.1:${port}/harvest-price-tracker.html`);
    assert.equal(await np.$eval(".pd-pick", (x) => getComputedStyle(x).display), "none");
    assert.equal(await np.$eval(".pd-calc", (x) => getComputedStyle(x).display), "none");
    await nojs.close();
  } finally { await browser.close(); srv.close(); }
});
