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
 * 2026-10-20 (morning) to 2026-10-20b it also stayed off unless the browser's
 * time zone was a US or Canada one. Sig, the same day: keep global human
 * readers but keep data centers out. Since 2026-10-20b the guard loads nothing
 * until the reader scrolls, taps, presses a key or touches the shown page.
 * Then it loads /components/ga-gate.js, which asks the subs worker (GET
 * /ga-ok, v5.33) whether the visit comes from a cloud or hosting network and
 * loads gtag.js only on {"ok":true}. A false answer, an error or no answer in
 * 3 s keeps GA off. Scripted visits mostly never interact, and the ones that
 * do mostly run on cloud networks. The gate and the worker route are tested
 * in test/ga-gate.test.mjs.
 *
 * Cubot is a real Android phone brand whose model names (CUBOT_X30 and so on)
 * put "bot" in the user agent, so it is excepted. A prerendered page waits
 * until it is shown.
 *
 * Copies: about 14,000 pages plus the builders. Builders that type the guard:
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

const GUARD = String.raw`/* agsist-ga-guard 2026-10-20b: Google Analytics loads only when the browser sends no Global Privacy Control signal, the off switch on /privacy is not set, the browser is not automated (navigator.webdriver, or a headless, Lighthouse or bot UA string), and the reader scrolls, taps or types on the shown page. Then /components/ga-gate.js asks our worker if the visit comes from a cloud server network (Sig, Oct 20) and loads GA only on a clear no. dataLayer and gtag always exist, so page code that calls them never throws. */(function(w,d,n){var off=false,i,s,u;w.dataLayer=w.dataLayer||[];if(typeof w.gtag!=='function'){w.gtag=function(){w.dataLayer.push(arguments);};}try{off=w.localStorage.getItem('agsist-ga-off')==='1';}catch(e){}if(n.globalPrivacyControl===true){off=true;}u=n.userAgent||'';if(n.webdriver===true||(/HeadlessChrome|PhantomJS|Lighthouse|bot|crawler|spider/i.test(u)&&!/cubot/i.test(u))){off=true;}w.agsistGaOff=off;w.gtag('set','allow_google_signals',false);w.gtag('set','allow_ad_personalization_signals',false);if(off){return;}i=function(){if(s||d.prerendering){return;}s=d.createElement('script');s.src='/components/ga-gate.js?v=1';(d.head||d.documentElement).appendChild(s);};['scroll','pointerdown','keydown','touchstart'].forEach(function(t){w.addEventListener(t,i,{capture:true,passive:true});});})(window,document,navigator);`;
const FSTR = GUARD.replace(/\{/g, "{{").replace(/\}/g, "}}"); // the same text inside a Python f-string

const WEBDRIVER = "if(n.webdriver===true||";
const UA_RULE = "/HeadlessChrome|PhantomJS|Lighthouse|bot|crawler|spider/i.test(u)&&!/cubot/i.test(u)";
const GATE_SRC = "/components/ga-gate.js?v=1";
const WAIT_RULE = "['scroll','pointerdown','keydown','touchstart'].forEach(function(t){w.addEventListener(t,i,{capture:true,passive:true});});";

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
  ["scripts/build_land_index.py", "grain-emc.html"],
  ["scripts/cash_bid_index.py", "grain-emc.html"],
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
      if (!c.includes(WAIT_RULE)) bad.push(`${rel}: GA does not wait for the reader`);
      if (/timeZone|Intl/.test(c)) bad.push(`${rel}: a time zone rule is left`);
    }
    // the only gtag.js request is the one the guard makes
    if (/<script[^>]*src=["'][^"']*googletagmanager/i.test(h)) bad.push(`${rel}: loads gtag.js outside the guard`);
  }
  assert.ok(pages >= 13000, `only ${pages} pages walked; the tree has moved`);
  assert.ok(guarded >= 13000, `only ${guarded} guarded pages; expected about 14,000`);
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} problems`);
});

const OLD = ["agsist-ga-guard 2026-10-09", "agsist-ga-guard 2026-10-17", "agsist-ga-guard 2026-10-20:"];
test("no page carries an older guard (10-09: no bot rule; 10-17: no wait; 10-20: time zone rule)", () => {
  const old = [];
  for (const p of htmlFiles(ROOT)) {
    const h = fs.readFileSync(p, "utf8");
    if (OLD.some((o) => h.includes(o))) old.push(path.relative(ROOT, p));
  }
  assert.deepEqual(old.slice(0, 20), [], `${old.length} pages still on the old guard`);
});

test("every builder and template that types the guard types this one", () => {
  for (const [rel, f] of GA_SOURCES) {
    const t = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const want = f ? FSTR : GUARD;
    const n = t.split(want).length - 1;
    assert.equal(n, 1, `${rel}: ${n} copies of the current guard`);
    assert.ok(!OLD.some((o) => t.includes(o)), `${rel}: old guard left`);
    assert.equal((t.match(/agsist-ga-guard \d{4}-\d\d-\d\d/g) || []).length, 1, `${rel}: a second guard text`);
  }
  for (const [rel, model] of LIFTERS) {
    const t = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.ok([`(ROOT, "${model}")`, `(REPO / "${model}")`, `(REPO, "${model}")`].some((k) => t.includes(k)), `${rel} no longer lifts from ${model}`);
    assert.equal(fs.readFileSync(path.join(ROOT, model), "utf8").split(GUARD).length - 1, 1, `${model} has no current guard`);
  }
});

// Run the guard in a sandbox. It asks for nothing until the reader acts;
// then it asks for the gate file, never for gtag.js itself.
function run({ ua = "", webdriver, gpc, off, prerendering = false, storageThrows = false, code = GUARD } = {}) {
  const appended = [], listeners = {}, docListeners = {};
  const doc = {
    prerendering,
    head: { appendChild: (s) => appended.push(s) },
    createElement: () => ({}),
    addEventListener: (ev, fn) => { docListeners[ev] = fn; },
  };
  const win = {
    localStorage: { getItem: (k) => { if (storageThrows) throw new Error("blocked"); return k === "agsist-ga-off" && off ? "1" : null; } },
    addEventListener: (ev, fn, opt) => { (listeners[ev] = listeners[ev] || []).push([fn, opt]); },
  };
  const nav = { userAgent: ua };
  if (webdriver !== undefined) nav.webdriver = webdriver;
  if (gpc !== undefined) nav.globalPrivacyControl = gpc;
  vm.runInNewContext(code, { window: win, document: doc, navigator: nav });
  const fire = (ev) => { for (const [fn] of listeners[ev] || []) fn({ type: ev }); };
  return { win, doc, appended, listeners, docListeners, fire };
}
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const ACTS = ["scroll", "pointerdown", "keydown", "touchstart"];

// a guard that let analytics through: it waits on all four acts, and the first one asks for the gate once
function letsThrough(r) {
  if (r.appended.length) return "loaded something before the reader acted";
  for (const ev of ACTS) {
    const l = r.listeners[ev] || [];
    if (l.length !== 1) return `${l.length} ${ev} listeners`;
    if (!l[0][1] || l[0][1].capture !== true || l[0][1].passive !== true) return `${ev} listener is not capture and passive`;
  }
  return "";
}

test("before the reader acts, nothing loads; the first act loads the gate once", () => {
  for (const first of ACTS) {
    const r = run({ ua: CHROME });
    assert.equal(letsThrough(r), "", first);
    assert.equal(r.win.agsistGaOff, false);
    r.fire(first);
    assert.equal(r.appended.length, 1, `${first} did not load the gate`);
    assert.equal(r.appended[0].src, GATE_SRC, "the guard loads the gate, not gtag.js");
    for (const ev of ACTS) r.fire(ev);
    assert.equal(r.appended.length, 1, "a second act loaded it again");
  }
  assert.ok(!GUARD.includes("googletagmanager"), "gtag.js is named only in the gate");
  assert.ok(!/timeZone|Intl/.test(GUARD), "no time zone rule left");
  assert.ok(fs.readFileSync(path.join(ROOT, "components/ga-gate.js"), "utf8").includes("https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H"));
});

test("real browsers wait for the reader; automated ones never listen", () => {
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
      assert.equal(letsThrough(r), "", `real browser: ${ua}`);
      r.fire("pointerdown");
      assert.equal(r.appended.length, 1, `real browser got no gate: ${ua}`);
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
    assert.deepEqual(Object.keys(r.listeners), [], `automated UA listens: ${ua}`);
    for (const ev of ACTS) r.fire(ev);
    assert.equal(r.appended.length, 0, `automated UA loaded: ${ua}`);
    assert.equal(r.win.agsistGaOff, true);
  }
  const wd = run({ ua: CHROME, webdriver: true });
  assert.deepEqual(Object.keys(wd.listeners), [], "navigator.webdriver=true listens");
  assert.equal(wd.win.agsistGaOff, true);
  // a missing user agent is not a reason to drop a reader
  const nu = run({ ua: undefined });
  nu.fire("scroll");
  assert.equal(nu.appended.length, 1);
});

test("GPC, the /privacy switch and prerender behave as before", () => {
  const off = (o) => { const r = run({ ua: CHROME, ...o }); for (const ev of ACTS) r.fire(ev); return r.appended.length; };
  assert.equal(off({ gpc: true }), 0, "GPC");
  assert.equal(off({ gpc: false }), 1);
  assert.equal(off({ off: true }), 0, "/privacy switch");
  assert.equal(off({ storageThrows: true }), 1, "blocked storage still loads");
  // a page loaded ahead in the background is not a visit: an act while prerendered loads nothing
  const pre = run({ ua: CHROME, prerendering: true });
  pre.fire("scroll");
  assert.equal(pre.appended.length, 0, "prerendered page loaded the gate");
  pre.doc.prerendering = false;   // shown
  pre.fire("scroll");
  assert.equal(pre.appended.length, 1, "the first act once shown loads the gate");
  // gtag and dataLayer always exist, and signals stay off, on or off
  for (const r of [run({ ua: CHROME }), run({ ua: CHROME, webdriver: true }), run({ ua: CHROME, gpc: true })]) {
    assert.equal(typeof r.win.gtag, "function");
    assert.ok(Array.isArray(r.win.dataLayer));
    r.win.gtag("event", "x");   // page code calling gtag never throws
    const sets = r.win.dataLayer.map((a) => Array.from(a).join(","));
    assert.ok(sets.includes("set,allow_google_signals,false"));
    assert.ok(sets.includes("set,allow_ad_personalization_signals,false"));
  }
});

test("a built page from every generated set runs the same guard", () => {
  // first guarded page found under each top-level folder, plus the root pages
  const sample = new Map();
  for (const p of htmlFiles(ROOT)) {
    const rel = path.relative(ROOT, p);
    const set = rel.includes(path.sep) ? rel.split(path.sep)[0] : "(root)";
    if (sample.has(set)) continue;
    const m = fs.readFileSync(p, "utf8").match(GUARD_RE);
    if (m) sample.set(set, [rel, m[0]]);
  }
  for (const want of ["(root)", "arc-plc", "farmland-atlas", "prf", "cash-bids", "daily"]) {
    assert.ok(sample.has(want), `no guarded page found under ${want}; the sets have moved`);
  }
  assert.ok(sample.size >= 8, `only ${sample.size} sets sampled`);
  for (const [set, [rel, code]] of sample) {
    const r = run({ ua: CHROME, code });
    assert.equal(letsThrough(r), "", `${rel} (${set})`);
    r.fire("touchstart");
    assert.equal(r.appended.length, 1, `${rel} (${set}): no gate after a tap`);
    assert.equal(r.appended[0].src, GATE_SRC);
    assert.equal(run({ ua: "Googlebot/2.1", code }).appended.length, 0);
  }
});

test("/privacy says so, and its switch reads the gate's own answer", () => {
  const h = fs.readFileSync(path.join(ROOT, "privacy.html"), "utf8");
  assert.ok(h.includes("It loads only after you scroll, tap or type on a page, and not for visits from cloud servers"), "privacy.html no longer explains the rule");
  assert.ok(!/time zone|timeZone/.test(h.replace(/<script>\/\* agsist-ga-guard[^<]*/, "")), "privacy.html still names the time zone rule");
  const gate = fs.readFileSync(path.join(ROOT, "components/ga-gate.js"), "utf8");
  assert.ok(gate.includes("K = 'agsist-ga-ok'"));
  assert.ok(h.includes("window.sessionStorage.getItem('agsist-ga-ok') === '0'"), "privacy.html's status reads a different key than the gate");
  assert.ok(h.includes("Off. This visit comes from a cloud server network, so Google Analytics does not load here."));
});
