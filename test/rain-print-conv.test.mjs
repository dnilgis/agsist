/* /rain-print by the buy button (Sig, 2026-10-20: "do all"):
 *   1. the Christmas order-by date, per product, from data/rain-print.json,
 *      shown only from October 1 through that product's cutoff (fixed clock);
 *      after it, the arrival date; this year's print says January;
 *   2. "Send this to your family": the reader's own design link (?d=), a phone
 *      share sheet or Email it / Text it / Copy the link, a GA event with the
 *      method only;
 *   3. numbered and initialed by hand (never "signed": the renderer prints a
 *      serial, Sig initials in pencil);
 *   4. Sig's guarantee by the button, in the FAQ and in the FAQ and offer
 *      structured data, with the return text agreeing;
 *   5. "Email me this design": nothing ticked, posts the design code, the
 *      worker routes and the sender's selftest (sends once, never after a
 *      paid order);
 *   6. the story line, lower down, and at most two lines plus the share under Pay.
 *
 *   node --test test/rain-print-conv.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import { mocks, serve } from "./fixtures/rp-site-mock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const HTML = read("rain-print.html");
const J = JSON.parse(read("data/rain-print.json"));
const ctxVm = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctxVm.window = ctxVm;
vm.runInNewContext(read("components/rain-print.js"), ctxVm);
const RP = ctxVm.RainPrint;

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("1. the Christmas line by the button follows each product's own cutoff, by date", () => {
  assert.equal(J.framed_christmas_cutoff, "2026-12-09");
  assert.equal(J.print_christmas_cutoff, "2026-12-10");
  const at = (id, day, o) => RP.buyLine(J, id, day, o);
  assert.equal(at("framed12x18", "2026-10-20"), "Order by Dec 9 for Christmas delivery.");
  assert.equal(at("print12x18", "2026-10-20"), "Order by Dec 10 for Christmas delivery.");
  assert.equal(at("framed12x18", "2026-10-01"), "Order by Dec 9 for Christmas delivery.", "from October 1");
  assert.equal(at("framed12x18", "2026-12-09"), "Order by Dec 9 for Christmas delivery.", "the cutoff day itself");
  // a day past framed's cutoff: framed gives its (after Christmas) arrival date, the print still has a day
  assert.match(at("framed12x18", "2026-12-10"), /^Ordered today, it should arrive by about \w+, Dec (2[5-9]|3[01])\.$/);
  assert.equal(at("print12x18", "2026-12-10"), "Order by Dec 10 for Christmas delivery.");
  assert.match(at("print12x18", "2026-12-11"), /^Ordered today, it should arrive by about /);
  assert.equal(at("framed12x18", "2026-09-30"), RP.arriveText(J, "framed12x18", "2026-09-30"), "before October: the arrival date");
  assert.ok(!/Christmas/.test(at("framed12x18", "2026-09-30")));
  assert.equal(at("digital", "2026-10-20"), "", "the file says nothing about the mail");
  assert.equal(at("framed12x18", "2026-10-20", { gift: true, year: 2026 }), "A 2026 print ships in January 2027, once the full year is in.");
  assert.equal(at("framed12x18", "2026-10-20", { settle: true }), "");
  assert.equal(at("framed12x18", "2026-10-20", { used: true }), "", "a gift card being used: nothing to pay, no date line");
  // Canada with no Christmas dates of its own: the arrival date, never a US Christmas promise
  assert.ok(!/Christmas/.test(RP.buyLine(Object.assign({}, J, { framed_christmas_cutoff: null }), "framed12x18", "2026-10-20")));
  // no countdown, no timer anywhere in the engine's words
  const js = read("components/rain-print.js");
  assert.ok(!/days? left|hours? left|countdown\(|setInterval\([^)]*(xmas|cutoff)/i.test(js.replace(/\/\*[\s\S]*?\*\//g, "")));
});

test("3, 4. numbered and initialed (never signed), and the guarantee in the page, the FAQ and its structured data", () => {
  const G = "If it’s not right, I’ll redo it or refund it.";
  assert.equal(RP.GUARANTEE, G);
  assert.equal(RP.promiseLine("framed12x18"), "Numbered and initialed by hand. " + G);
  assert.equal(RP.promiseLine("print12x18"), "Numbered and initialed by hand. " + G);
  assert.equal(RP.promiseLine("digital"), "You see a proof first. " + G, "the file has no serial");
  assert.ok(!/\bsigned\b/i.test(HTML.replace(/<script[\s\S]*?<\/script>/g, "")), "never claims signed: Sig initials in pencil");
  // the renderer prints a serial and no signature
  const art = read("components/rain-print-art.js");
  assert.match(art, /Q\.serial/);
  assert.ok(!/signature|signed/i.test(art));
  // by the button, in the page as served
  assert.match(HTML, /id="rp-pay" type="button">Check it and pay \$89<\/button>\s*<!--[\s\S]*?-->\s*<p class="rp-arrive" id="rp-arrive" hidden><\/p>\s*<p class="rp-promise" id="rp-promise">Numbered and initialed by hand\. If it&rsquo;s not right, I&rsquo;ll redo it or refund it\.<\/p>\s*<p class="rp-fam" id="rp-fam-wrap" hidden>/);
  // the FAQ, visible and structured, opens with it, and the old "can't take it back" now names a change of mind
  const faq = HTML.match(/<details><summary>What if something&rsquo;s wrong with it\?<\/summary><p>([\s\S]*?)<\/p><\/details>/)[1].replace(/<[^>]+>/g, "").replace(/&rsquo;/g, "’");
  assert.ok(faq.startsWith(G), faq.slice(0, 80));
  assert.ok(faq.includes("I can’t take it back for a change of mind, but if something’s wrong with it, I’ll redo it or refund it."));
  assert.ok(!/make it right/.test(faq));
  const ld = JSON.parse(HTML.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const q = ld["@graph"].find((g) => g["@type"] === "FAQPage").mainEntity.find((x) => /What if something/.test(x.name)).acceptedAnswer.text;
  assert.equal(q, faq, "the structured answer is the visible one, word for word");
  for (const o of ld["@graph"].find((g) => g.offers).offers) {
    const d = o.hasMerchantReturnPolicy.description;
    assert.ok(d.startsWith(G), o.sku + ": " + d.slice(0, 60));
    assert.ok(!/can’t be returned once printed\./.test(d), o.sku + ": the return line names a change of mind");
  }
  assert.ok(!/—|&mdash;/.test(HTML));
});

test("6. the story line sits lower, with who the emails come from and the phone", () => {
  assert.match(HTML, /<p class="rp-note rp-madeby" id="rp-madeby">Made by a crop adviser in Chetek, Wisconsin, from NOAA&rsquo;s own records\.<\/p>\s*<p class="rp-note rp-call" id="rp-call"><span id="rp-from">Your proof comes by email from Sig, your receipt from Stripe\.<\/span> Questions\?/);
  const pay = HTML.indexOf('id="rp-pay"'), wrapEnd = HTML.indexOf('id="rp-yearask"');
  assert.ok(HTML.indexOf('id="rp-madeby"') > wrapEnd, "below the button's group");
  const under = HTML.slice(pay, wrapEnd);
  // under Pay: the date line, the promise, the share; nothing else that always shows
  const always = [...under.matchAll(/<p class="([^"]*)" id="([^"]+)"(?! hidden)[^>]*>/g)].map((m) => m[2]);
  assert.deepEqual(always.filter((id) => !["rp-buy-note"].includes(id)), ["rp-promise"], always.join(","));
});

test("2. the family message names who it's for and carries the link", () => {
  const m = RP.familyMessage({ who: "Dad", place: "Chetek, WI", year: 2012, url: "https://agsist.com/rain-print?d=ABC" });
  assert.equal(m.text, "Want to go in on this for Dad? It’s every rain and snow at Chetek, WI in 2012, drawn from NOAA’s records and printed for the wall. Have a look:");
  assert.equal(m.body, m.text + "\nhttps://agsist.com/rain-print?d=ABC");
  assert.equal(m.subject, "A Rain Print of Chetek, WI, 2012");
  assert.match(RP.familyMessage({ place: "Ames, IA", year: 1993 }).text, /^Want to go in on this together\? /);
  assert.ok(!/split|pay your share|\$/.test(m.body), "a share, not a payment");
});

test("5. the worker routes and the sender (once, never after a paid order)", () => {
  const out = execFileSync(process.execPath, [ROOT + "scripts/test_rp_remind_worker.mjs"], { encoding: "utf8" });
  assert.match(out, /rp-remind worker: \d+ checks pass/);
  const py = execFileSync("python3", [ROOT + "scripts/rp_design_email.py", "--selftest"], { encoding: "utf8" });
  assert.match(py, /rp_design_email: all checks pass/);
  const wf = read(".github/workflows/rp-design-email.yml");
  assert.ok(!/^\s*schedule:/m.test(wf), "no schedule until Sig OKs one");
  assert.match(wf, /workflow_dispatch:/);
  const W = read("workers/subs-worker.js");
  assert.match(W, /v5\.43 \(2026-10-20\): EMAIL ME THIS DESIGN/);
  // the ask on the page: nothing ticked, plain words
  const ask = HTML.match(/<div class="rp-mailme" id="rp-mailme" hidden>[\s\S]*?<\/div>/)[0];
  assert.match(ask, />Email me this design</);
  assert.match(ask, /<input type="checkbox" id="rp-mailme-daily">/);
  assert.ok(!/checked/.test(ask), "nothing ticked");
  assert.match(ask, /I&rsquo;ll email you the link to this design now, and one reminder tomorrow if you haven&rsquo;t ordered it\. Then nothing more about it\./);
  assert.ok(HTML.indexOf('id="rp-mailme"') < HTML.indexOf('id="rp-buy"') && HTML.indexOf('id="rp-mailme"') > HTML.indexOf('id="rp-design"'), "on the design step");
});

async function withPage(fn, { width = 1280, height = 900, clock = "2026-10-20T17:00:00Z", phone = false } = {}) {
  const srv = await serve(ROOT), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", hasTouch: phone, isMobile: phone });
    await ctx.clock.setFixedTime(new Date(clock));
    const log = { order: [], stripe: [], remind: [] };
    await mocks(ctx, {}, log);
    await ctx.route(/agsist-subs\.dnilgis\.workers\.dev\/rp-remind$/, (r) => {
      const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
      if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      log.remind.push(JSON.parse(r.request().postData()));
      return r.fulfill({ headers: h, json: { ok: true, job: "started" } });
    });
    await ctx.addInitScript(() => {
      window.__ga = []; window.gaEvent = (n, p) => window.__ga.push([n, p]);
      window.__shared = [];
      if (navigator.share || true) Object.defineProperty(navigator, "share", { configurable: true, value: (d) => { window.__shared.push(d); return Promise.resolve(); } });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, log, errors);
  } finally { await browser.close(); srv.close(); }
}
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && !document.getElementById("rp-art").getAttribute("aria-busy") && !document.getElementById("rp-art").classList.contains("rp-empty"), null, { timeout: 30000 });
const DESIGN = { place: "Chetek, WI", year: "2012", station: "471667 2", style: "r1", name: "Olson Home Place" };

test("1. in the page: Dec 9 framed, Dec 10 print, nothing for the file; after the cutoff, the arrival date", { skip }, async () => {
  await withPage(async (page, base, log, errors) => {
    await page.goto(base + "/rain-print.html?" + new URLSearchParams(DESIGN));
    await drawn(page);
    await page.waitForTimeout(400);
    assert.equal(await page.textContent("#rp-arrive"), "Order by Dec 9 for Christmas delivery.");
    assert.match(await page.textContent("#rp-arrive-est"), /^Ordered today, it should arrive by about /, "the arrival date, lower");
    assert.equal(await page.textContent("#rp-promise"), "Numbered and initialed by hand. If it’s not right, I’ll redo it or refund it.");
    await page.locator('.rp-prod[data-choice="print12x18"]').click();
    assert.equal(await page.textContent("#rp-arrive"), "Order by Dec 10 for Christmas delivery.");
    await page.locator('.rp-prod[data-choice="digital"]').click();
    assert.equal(await page.isVisible("#rp-arrive"), false);
    assert.equal(await page.isVisible("#rp-arrive-est"), false);
    assert.equal(await page.textContent("#rp-promise"), "You see a proof first. If it’s not right, I’ll redo it or refund it.");
    assert.equal(await page.textContent("#rp-from"), "Your proof and your file come by email from Sig, your receipt from Stripe.");
    assert.deepEqual(errors, []);
  });
  await withPage(async (page, base, log, errors) => {
    await page.goto(base + "/rain-print.html?" + new URLSearchParams(Object.assign({ pick: "print12x18" }, DESIGN)));
    await drawn(page);
    await page.waitForTimeout(400);
    const t = await page.textContent("#rp-arrive");
    assert.match(t, /^Ordered today, it should arrive by about /, "past both cutoffs: no Christmas promise");
    assert.ok(!/Christmas/.test(t));
    assert.equal(await page.isVisible("#rp-arrive-est"), false, "said once");
    assert.deepEqual(errors, []);
  }, { clock: "2026-12-14T17:00:00Z" });
});

test("2. Send this to your family: a computer gets Email it, Text it, Copy the link, all with the design's own link", { skip }, async () => {
  await withPage(async (page, base, log, errors) => {
    await page.goto(base + "/rain-print.html?" + new URLSearchParams(DESIGN));
    await drawn(page);
    await page.waitForTimeout(300);
    const want = await page.evaluate(() => window.RainPrint.shortUrl(Object.assign({}, window.RainPrint.fromParams(location.search.slice(1)))));
    assert.equal(await page.isVisible("#rp-fam"), true);
    await page.click("#rp-fam");
    assert.equal(await page.isVisible("#rp-fam-more"), true);
    const mail = await page.getAttribute("#rp-fam-mail", "href"), sms = await page.getAttribute("#rp-fam-sms", "href");
    const body = new URLSearchParams(mail.split("?")[1]).get("body");
    const url = body.split("\n").pop();
    assert.match(url, /^https:\/\/agsist\.com\/rain-print\?d=[A-Za-z0-9_-]+$/, "the ?d= link, which opens with the print first");
    const code = new URL(url).searchParams.get("d");
    const back = await page.evaluate((c) => window.RainPrint.decodeCode(c), code);
    assert.equal(back.place, "Chetek, WI"); assert.equal(back.year, 2012); assert.equal(back.name, "Olson Home Place");
    assert.equal(back.station, "471667 2");
    assert.match(body, /^Want to go in on this together\? It’s every rain and snow at Chetek, WI in 2012/);
    assert.ok(sms.startsWith("sms:?&body=") && decodeURIComponent(sms.split("body=")[1]).endsWith(url));
    assert.ok(want.length > 0);
    await page.click("#rp-fam-mail", { noWaitAfter: true }).catch(() => {});
    const ga = await page.evaluate(() => window.__ga.filter((e) => e[0] === "rain_print_family_share"));
    assert.deepEqual(ga, [["rain_print_family_share", { method: "email" }]], "the event says how, nothing about the design");
    assert.deepEqual(await page.evaluate(() => window.__shared), [], "no share sheet on a computer");
    assert.deepEqual(errors, []);
  });
});

test("2. on a phone it opens the phone's own share sheet", { skip }, async () => {
  await withPage(async (page, base, log, errors) => {
    await page.goto(base + "/rain-print.html?" + new URLSearchParams(DESIGN));
    await drawn(page);
    await page.waitForTimeout(300);
    await page.click("#rp-fam");
    await page.waitForTimeout(100);
    const s = await page.evaluate(() => window.__shared);
    assert.equal(s.length, 1);
    assert.match(s[0].url, /^https:\/\/agsist\.com\/rain-print\?d=[A-Za-z0-9_-]+$/);
    assert.ok(!s[0].text.includes("http"), "the link goes once, as the url");
    assert.equal(s[0].title, "A Rain Print of Chetek, WI, 2012");
    assert.equal(await page.isVisible("#rp-fam-more"), false);
    const ga = await page.evaluate(() => window.__ga.filter((e) => e[0] === "rain_print_family_share"));
    assert.deepEqual(ga, [["rain_print_family_share", { method: "share" }]]);
    assert.deepEqual(errors, []);
  }, { width: 390, height: 844, phone: true });
});

test("2. this year's gift: the message names who it's for", { skip }, async () => {
  await withPage(async (page, base, log, errors) => {
    await page.goto(base + "/rain-print.html?" + new URLSearchParams(Object.assign({}, DESIGN, { year: "2026" })));
    await drawn(page);
    await page.waitForTimeout(300);
    assert.equal(await page.isVisible("#rp-gift-to"), true);
    await page.fill("#rp-gift-to", "Dad");
    assert.equal(await page.textContent("#rp-arrive"), "A 2026 print ships in January 2027, once the full year is in.");
    await page.click("#rp-fam");
    const body = new URLSearchParams((await page.getAttribute("#rp-fam-mail", "href")).split("?")[1]).get("body");
    assert.match(body, /^Want to go in on this for Dad\? It’s every rain and snow at Chetek, WI in 2026/);
    assert.deepEqual(errors, []);
  });
});

test("5. Email me this design: nothing ticked, posts the design code, then says what comes", { skip }, async () => {
  await withPage(async (page, base, log, errors) => {
    await page.goto(base + "/rain-print.html?" + new URLSearchParams(DESIGN));
    await drawn(page);
    await page.waitForTimeout(300);
    assert.equal(await page.isVisible("#rp-mailme-open"), true, "shows once a print is drawn");
    assert.equal(await page.isVisible("#rp-mailme-form"), false, "folded until asked");
    await page.click("#rp-mailme-open");
    assert.equal(await page.isChecked("#rp-mailme-daily"), false, "the Daily is never ticked for them");
    await page.fill("#rp-mailme-email", "nope");
    await page.click("#rp-mailme-go");
    assert.match(await page.textContent("#rp-mailme-out"), /doesn’t look right/);
    assert.equal(log.remind.length, 0);
    await page.fill("#rp-mailme-email", "reader@farm.com");
    await page.click("#rp-mailme-go");
    await page.waitForFunction(() => /^Sent\./.test(document.getElementById("rp-mailme-out").textContent));
    assert.equal(log.remind.length, 1);
    const b = log.remind[0];
    assert.equal(b.email, "reader@farm.com"); assert.equal(b.daily, false); assert.equal(b.source, "page:rain-print");
    const d = await page.evaluate((c) => window.RainPrint.decodeCode(c), b.code);
    assert.equal(d.place, "Chetek, WI"); assert.equal(d.year, 2012); assert.equal(d.name, "Olson Home Place");
    assert.ok(!b.code.startsWith("GIFT-"));
    assert.equal(await page.isVisible("#rp-mailme-form"), false);
    const ga = await page.evaluate(() => window.__ga.filter((e) => e[0] === "rain_print_design_email"));
    assert.deepEqual(ga, [["rain_print_design_email", { daily: 0 }]]);
    // a changed design can be sent again
    await page.fill("#rp-name", "Olson Farm");
    await page.press("#rp-name", "Tab");
    await page.waitForTimeout(600);
    assert.equal(await page.isVisible("#rp-mailme-open"), true);
    assert.deepEqual(errors, []);
  });
});
