/* The Google Analytics guard (agsist-ga-guard), one text on every page.
 *
 * Every page that carries GA has the same inline guard in its head, and the
 * guard alone decides whether gtag.js loads. It stays off when the browser
 * sends Global Privacy Control, when the /privacy switch is set, and (since
 * 2026-10-17) when the browser is plainly automated: navigator.webdriver, or a
 * HeadlessChrome, PhantomJS, Lighthouse, bot, crawler or spider user agent.
 * Why: Sig's GA export (Jul 19 to Oct 16) had /prf at 28,884 views from 20,007
 * users with 0.7 s engagement against 2 Search Console clicks, and "Direct" at
 * 54,974 of about 74,500 sessions at 5.8 s. Those are scripted browsers, and
 * they were counted as readers.
 *
 * Cubot is a real Android phone brand whose model names (CUBOT_X30 and so on)
 * put "bot" in the user agent, so it is excepted. A prerendered page waits
 * until it is shown.
 *
 * Copies: about 13,800 pages plus the builders. Builders that type the guard:
 * GA_SOURCES below. Builders that lift it from store-or-sell.html
 * (make_prf_html.py, build_prf_states.py and its users) or from a built page
 * (cash_bid_index.py) carry no copy of their own; the page check covers them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const GUARD = String.raw`/* agsist-ga-guard 2026-10-17: Google Analytics loads only when the browser sends no Global Privacy Control signal, the off switch on /privacy is not set and the browser is not automated (navigator.webdriver, or a headless, Lighthouse or bot user agent), and only once the page is shown (a page loaded ahead in the background is not a visit). dataLayer and gtag always exist, so page code that calls them never throws. */(function(w,d,n){var off=false,v,i,s,u;w.dataLayer=w.dataLayer||[];if(typeof w.gtag!=='function'){w.gtag=function(){w.dataLayer.push(arguments);};}try{off=w.localStorage.getItem('agsist-ga-off')==='1';}catch(e){}if(n.globalPrivacyControl===true){off=true;}u=n.userAgent||'';if(n.webdriver===true||(/HeadlessChrome|PhantomJS|Lighthouse|bot|crawler|spider/i.test(u)&&!/cubot/i.test(u))){off=true;}w.agsistGaOff=off;w.gtag('set','allow_google_signals',false);w.gtag('set','allow_ad_personalization_signals',false);if(off){return;}i=function(){s=d.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H';(d.head||d.documentElement).appendChild(s);};if(d.prerendering){d.addEventListener('prerenderingchange',i,{once:true});}else{i();}})(window,document,navigator);`;
const FSTR = GUARD.replace(/\{/g, "{{").replace(/\}/g, "}}"); // the same text inside a Python f-string

const WEBDRIVER = "if(n.webdriver===true||";
const UA_RULE = "/HeadlessChrome|PhantomJS|Lighthouse|bot|crawler|spider/i.test(u)&&!/cubot/i.test(u)";

// Builders and templates that type the guard themselves. f: inside a Python f-string.
const GA_SOURCES = [
  ["components/analytics.html", false],
  ["scripts/build_atlas_pages.py", false],
  ["scripts/build_arc_plc.py", true],
  ["scripts/build_state_basis_pages.py", true],
  ["scripts/build_state_rent_pages.py", true],
  ["scripts/build_state_yield_pages.py", true],
  ["scripts/generate_daily.py", true],
];
// Builders that copy the guard from a model page: the model must carry it.
const LIFTERS = [
  ["scripts/make_prf_html.py", "store-or-sell.html"],
  ["scripts/build_prf_states.py", "store-or-sell.html"],
];

const SKIP = new Set([".git", "node_modules", "fixtures"]);
function* htmlFiles(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* htmlFiles(p);
    else if (ent.name.endsWith(".html")) yield p;
  }
}

const GUARD_RE = /\/\* agsist-ga-guard[^<]*/g;

test("every page with Google Analytics carries the one guard, byte for byte", () => {
  let pages = 0, guarded = 0;
  const bad = [];
  for (const p of htmlFiles(ROOT)) {
    pages++;
    const h = fs.readFileSync(p, "utf8");
    const rel = path.relative(ROOT, p);
    const copies = h.match(GUARD_RE) || [];
    const hasGa = /googletagmanager|G-6KXCTD5Z9H/.test(h);
    if (!copies.length) {
      if (hasGa) bad.push(`${rel}: loads or names GA with no guard`);
      continue;
    }
    guarded++;
    if (copies.length !== 1) bad.push(`${rel}: ${copies.length} guards`);
    for (const c of copies) {
      if (c !== GUARD) bad.push(`${rel}: guard text differs from the pinned one`);
      if (!c.includes(WEBDRIVER)) bad.push(`${rel}: no navigator.webdriver rule`);
      if (!c.includes(UA_RULE)) bad.push(`${rel}: no headless / bot user agent rule`);
    }
    // the only gtag.js request is the one the guard makes
    if (/<script[^>]*src=["'][^"']*googletagmanager/i.test(h)) bad.push(`${rel}: loads gtag.js outside the guard`);
  }
  assert.ok(pages >= 13000, `only ${pages} pages walked; the tree has moved`);
  assert.ok(guarded >= 13000, `only ${guarded} guarded pages; expected about 13,800`);
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} problems`);
});

test("no page carries the 2026-10-09 guard (no webdriver or bot rule)", () => {
  const old = [];
  for (const p of htmlFiles(ROOT)) {
    if (fs.readFileSync(p, "utf8").includes("agsist-ga-guard 2026-10-09")) old.push(path.relative(ROOT, p));
  }
  assert.deepEqual(old.slice(0, 20), [], `${old.length} pages still on the old guard`);
});

test("every builder and template that types the guard types this one", () => {
  for (const [rel, f] of GA_SOURCES) {
    const t = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const want = f ? FSTR : GUARD;
    const n = t.split(want).length - 1;
    assert.equal(n, 1, `${rel}: ${n} copies of the current guard`);
    assert.ok(!t.includes("agsist-ga-guard 2026-10-09"), `${rel}: old guard left`);
    assert.equal((t.match(/agsist-ga-guard \d{4}-\d\d-\d\d/g) || []).length, 1, `${rel}: a second guard text`);
  }
  for (const [rel, model] of LIFTERS) {
    const t = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.ok(t.includes(`(ROOT, "${model}")`) || t.includes(`(REPO / "${model}")`), `${rel} no longer lifts from ${model}`);
    assert.equal(fs.readFileSync(path.join(ROOT, model), "utf8").split(GUARD).length - 1, 1, `${model} has no current guard`);
  }
});

// Run the guard in a sandbox: did it ask for gtag.js?
function run({ ua = "", webdriver, gpc, off, prerendering = false, storageThrows = false } = {}) {
  const appended = [], listeners = {};
  const doc = {
    prerendering,
    head: { appendChild: (s) => appended.push(s) },
    createElement: () => ({}),
    addEventListener: (ev, fn) => { listeners[ev] = fn; },
  };
  const win = {
    localStorage: { getItem: (k) => { if (storageThrows) throw new Error("blocked"); return k === "agsist-ga-off" && off ? "1" : null; } },
  };
  const nav = { userAgent: ua };
  if (webdriver !== undefined) nav.webdriver = webdriver;
  if (gpc !== undefined) nav.globalPrivacyControl = gpc;
  vm.runInNewContext(GUARD, { window: win, document: doc, navigator: nav });
  return { win, appended, listeners };
}
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const GA_SRC = "https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H";

test("real browsers load GA; automated ones do not", () => {
  const real = [
    CHROME,
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0",
    "Mozilla/5.0 (Linux; Android 14; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; CUBOT_X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; KINGKONG 9 Build/TP1A; CUBOT) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  ];
  for (const ua of real) {
    for (const webdriver of [undefined, false]) {
      const r = run({ ua, webdriver });
      assert.equal(r.appended.length, 1, `real browser got no GA: ${ua}`);
      assert.equal(r.appended[0].src, GA_SRC);
      assert.equal(r.appended[0].async, true);
      assert.equal(r.win.agsistGaOff, false);
    }
  }
  const automated = [
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML, like Gecko) PhantomJS/2.1.1 Safari/538.1",
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "Mozilla/5.0 (compatible; SomeCrawler/1.0)",
    "Mozilla/5.0 (compatible; Baiduspider/2.0)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
  ];
  for (const ua of automated) {
    const r = run({ ua });
    assert.equal(r.appended.length, 0, `automated UA loaded GA: ${ua}`);
    assert.equal(r.win.agsistGaOff, true);
  }
  const wd = run({ ua: CHROME, webdriver: true });
  assert.equal(wd.appended.length, 0, "navigator.webdriver=true loaded GA");
  assert.equal(wd.win.agsistGaOff, true);
  // a missing user agent is not a reason to drop a reader
  assert.equal(run({ ua: undefined }).appended.length, 1);
});

test("GPC, the /privacy switch and prerender behave as before", () => {
  assert.equal(run({ ua: CHROME, gpc: true }).appended.length, 0, "GPC");
  assert.equal(run({ ua: CHROME, gpc: false }).appended.length, 1);
  assert.equal(run({ ua: CHROME, off: true }).appended.length, 0, "/privacy switch");
  assert.equal(run({ ua: CHROME, storageThrows: true }).appended.length, 1, "blocked storage still loads");
  const pre = run({ ua: CHROME, prerendering: true });
  assert.equal(pre.appended.length, 0, "prerendered page loaded GA before it was shown");
  assert.equal(typeof pre.listeners.prerenderingchange, "function");
  pre.listeners.prerenderingchange();
  assert.equal(pre.appended.length, 1);
  // gtag and dataLayer always exist, and signals stay off, on or off
  for (const r of [run({ ua: CHROME }), run({ ua: CHROME, webdriver: true }), run({ ua: CHROME, gpc: true })]) {
    assert.equal(typeof r.win.gtag, "function");
    const sets = r.win.dataLayer.map((a) => Array.from(a).join(","));
    assert.ok(sets.includes("set,allow_google_signals,false"));
    assert.ok(sets.includes("set,allow_ad_personalization_signals,false"));
  }
});
