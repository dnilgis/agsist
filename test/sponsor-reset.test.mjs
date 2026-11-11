/* Sponsor reset, Nov 11, 2026: two spots only.
 *   1. data/rate-card.json sells the sitewide line and the state card, nothing else.
 *   2. No public page offers a free month, a founding rate or a featured listing.
 *   3. The open spots print their numbers from the data files (data/sponsor-spots.json, built by
 *      scripts/bake_audience.py from the audience files) and the price from the rate card.
 *   4. No sponsor line or card on Rain Print, gift or gauge pages.
 *   5. The state spot sits directly below each state page's main answer (builder fixtures and
 *      builder source), and holds its height so nothing moves when it fills.
 *   6. In a browser: the sitewide line lands under the menu without moving the page, and the
 *      open state spot prints the state's numbers.
 *   node --test test/sponsor-reset.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, readdirSync, mkdtempSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const json = (p) => JSON.parse(read(p));
const text = (h) => h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const G = createRequire(import.meta.url)(ROOT + "components/geo-sponsor.js");

test("the rate card sells two spots only, at the launch prices", () => {
  const c = json("data/rate-card.json");
  assert.deepEqual(c.tiers.map((t) => t.id), ["sitewide", "state"]);
  const sw = c.tiers[0], st = c.tiers[1];
  assert.equal(sw.price_month, 750);
  assert.equal(sw.slots, 1);
  assert.equal(st.price_month, 79);
  assert.deepEqual(st.price_by_state, { IL: 149, MN: 149, WI: 149, TX: 149 });
  assert.ok(st.one_per_state === true);
  assert.equal(c.year_months, 10);
  for (const k of ["trial", "day30", "founding"]) assert.ok(!(k in c), "the card still carries " + k);
  assert.deepEqual(Object.keys(c.pay_links).sort(), ["sitewide", "state"]);
  // the held states are the live state test's states
  const held = new Set(json("data/geo-sponsors.json").sponsors.filter((e) => e.active === true).flatMap((e) => e.states));
  for (const s of held) assert.ok(st.opens_soon.includes(s), s + " is live in a state test but not held");
});

test("no public page offers a free month, a founding rate or a featured listing", () => {
  const files = execFileSync("git", ["ls-files", "*.html", "components/*.js", "components/*.html"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter((f) => f && !/^(daily|test|tools)\//.test(f))
    // changelog.html is history; sponsor-report.html is a sponsor's own portal for a deal on file
    .filter((f) => !["changelog.html", "sponsor-report.html"].includes(f));
  const bad = [];
  for (const f of files) {
    const t = readFileSync(ROOT + f, "utf8");
    if (/first month free|free month|founding sponsor|founding rate|featured listing/i.test(t)) bad.push(f);
  }
  assert.deepEqual(bad, []);
  const sp = text(read("sponsor.html"));
  for (const w of ["Daily Sponsor", "Cash Bids Sponsor", "Sigurd", "farmers who use"]) assert.ok(!sp.includes(w), "sponsor.html says " + w);
  assert.ok(sp.includes("Sitewide Sponsor") && sp.includes("State Sponsor"));
  assert.ok(!/—/.test(read("sponsor.html")), "no em dash on sponsor.html");
});

test("the old sponsor pages send readers to /sponsor and keep their query", () => {
  for (const f of ["sponsor-rates.html", "sponsor-kit.html", "sponsor-apply.html"]) {
    const h = read(f);
    assert.match(h, /window\.location\.replace\("\/sponsor" \+ location\.search/, f);
    assert.match(h, /<meta name="robots" content="noindex, follow">/, f);
  }
});

test("the booking page: two buttons per spot, card links from the rate card, the form posts to the worker", () => {
  const h = read("sponsor.html"), js = read("components/sponsor-apply.js");
  for (const spot of ["sitewide", "state"]) {
    assert.match(h, new RegExp(`data-pay="${spot}"[^>]*>Card payment opens soon<`), spot + " card button");
    assert.match(h, new RegExp(`data-invoice="${spot}">Mail me a yearly invoice<`), spot + " invoice button");
  }
  assert.match(h, /src="\/components\/sponsor-apply\.js\?v=10"/);
  assert.ok(js.includes("S.card.pay_links") && js.includes("'Pay by card'") && js.includes("'Card payment opens soon'"));
  assert.ok(js.includes("WORKER + '/sponsor-apply'") && js.includes("'state-' + s.code.toLowerCase()") && js.includes("tier: t === 'sitewide' ? 'daily' : 'page'"));
  for (const id of ["spa-company", "spa-contact", "spa-email", "spa-state", "spa-headline", "spa-url"]) assert.ok(h.includes(`id="${id}"`), id);
});

test("the open spots print the numbers in the data files, and the data file matches the audience files", () => {
  const r = spawnSync("python3", ["scripts/bake_audience.py", "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const spots = json("data/sponsor-spots.json"), card = json("data/rate-card.json"), aud = json("data/audience.json");
  // whatever the files hold today: a number when there is one, none when there is not
  const eng = aud.totals && aud.totals["28d"] && aud.totals["28d"].engaged;
  if (eng > 0) assert.equal(spots.sitewide.engaged, eng); else assert.ok(!("engaged" in spots.sitewide));
  for (const st of ["IA", "IL", "OH", "WI"]) {
    const html = G.openHtml(st, card, spots), e = spots.states[st];
    const name = G.NAMES[st];
    assert.ok(html.includes(name + " sponsor spot "), st);
    if (e.engaged) assert.ok(html.includes(e.engaged.toLocaleString("en-US") + " engaged visits from " + name), st + " visits");
    if (e.views) assert.ok(html.includes(e.views.toLocaleString("en-US") + " views of " + name + " pages"), st + " views");
    if (!e.engaged && !e.views) assert.ok(!/engaged visits|views of/.test(html), st + " prints no number it does not have");
    const held = card.tiers[1].opens_soon.includes(st);
    if (!held) assert.ok(html.includes("$" + G.statePrice(card, st) + " a month, one business."), st + " price");
  }
  assert.ok(spots.states[aud.homeState || "WI"].withheld, "the home state's numbers are withheld");
  const L = read("components/loader.js");
  assert.ok(L.includes("/data/sponsor-spots.json") && L.includes("/data/rate-card.json") && L.includes("/data/sponsor.json"));
  assert.ok(!/9,?418|\$750/.test(L), "loader.js types a number instead of reading it");
  assert.ok(!/9,?418|\b750\b/.test(read("components/geo-sponsor.js")));
});

test("no sponsor line or card on Rain Print, gift and gauge pages", () => {
  const L = read("components/loader.js");
  const SKIP = new RegExp(/var GEO_SKIP = \/(.+)\/;\n/.exec(L)[1]);
  const files = execFileSync("git", ["ls-files", "*.html"], { cwd: ROOT, encoding: "utf8" }).split("\n")
    .filter((f) => f && !f.includes("/") && SKIP.test("/" + f));
  assert.ok(files.length >= 10, files.join(" "));
  for (const f of files) {
    const h = read(f);
    if (h.includes('id="site-header"')) assert.match(h, /<body class="no-sw"/, f + " holds room for a sitewide line");
    assert.ok(!/data-state-spot|ag-sw|sw-line/.test(h), f + " carries a sponsor spot");
  }
  const fn = L.slice(L.indexOf("function sitewide("), L.indexOf("window.AgsistSitewide"));
  assert.ok(fn.includes("GEO_SKIP.test(location.pathname)") && fn.includes("contains('no-sw')") && fn.includes("noSponsor"));
  assert.ok(read("components/styles.css").includes("body.no-sw{--sw-h:0px}"));
});

test("the state spot sits directly below the main answer, in every state page builder", () => {
  const SPOT = /<div class=\\?"state-spot\\?" data-state-spot=/;
  const order = {
    "scripts/build_state_rent_pages.py": ["{hero}", "data-state-spot", 'id="counties"'],
    "scripts/build_prf_states.py": ["</dl>", "data-state-spot", 'id="months"'],
    "scripts/build_arc_plc.py": ["XC.state_crops_line(D, S)}</div>", "data-state-spot", 'id="counties"'],
    "scripts/build_atlas_pages.py": ["{FCV.state_section(W.fcredit, st, stn)}", "data-state-spot", "<h2>Map: every county is a link</h2>"],
    "scripts/build_state_yield_pages.py": ['<div class="yl-hero">{cards}</div>', "data-state-spot", 'id="by-year"'],
    "scripts/generate_hail_states.py": ["hs-note", "data-state-spot", "+ key_figs"],
    "scripts/build_county_rain.py": ['<p class="rc-answer">{lede}</p>', "data-state-spot", 'class="rc-scroll"'],
  };
  for (const [f, [a, b, c]] of Object.entries(order)) {
    const s = read(f);
    assert.match(s, SPOT, f);
    const ib = s.search(SPOT);
    const ia = s.lastIndexOf(a, ib), ic = s.indexOf(c, ib);
    assert.ok(ia >= 0 && ic > ib && ib - ia < 400, `${f}: ${a} < state spot < ${c}`);
  }
  // the cash bid pages, from the builder's fixture: state page and town pages
  const dir = mkdtempSync(tmpdir() + "/spr-");
  const r = spawnSync("python3", ["scripts/build_cash_bid_pages.py", "--selftest"], { cwd: ROOT, env: { ...process.env, CBT_FIXTURE_DIR: dir }, encoding: "utf8" });
  assert.equal(r.status, 0, (r.stderr || "").slice(-600));
  let states = 0, towns = 0;
  for (const st of readdirSync(dir)) {
    if (st === "company" || !existsSync(`${dir}/${st}/index.html`)) continue;
    const h = readFileSync(`${dir}/${st}/index.html`, "utf8");
    assert.equal((h.match(/data-state-spot="[A-Z]{2}"/g) || []).length, 1, st);
    const best = h.indexOf('<h2 id="best">'), spot = h.indexOf("data-state-spot"), basis = h.indexOf('<h2 id="basis">');
    assert.ok(spot > (best >= 0 ? best : 0) && (basis < 0 || spot < basis), st + ": best bids < state spot < basis");
    states++;
    for (const f of readdirSync(`${dir}/${st}`)) {
      if (f === "index.html" || !f.endsWith(".html")) continue;
      const t = readFileSync(`${dir}/${st}/${f}`, "utf8");
      if (!t.includes('class="cbt-answer"')) continue;
      assert.equal((t.match(/data-state-spot="[A-Z]{2}"/g) || []).length, 1, f);
      assert.ok(t.indexOf('class="cbt-answer"') < t.indexOf("data-state-spot") && t.indexOf("data-state-spot") < t.indexOf("Sources and terms"), f);
      towns++;
    }
  }
  assert.ok(states >= 1 && towns >= 1, `${states} state pages, ${towns} town pages`);
  const css = read("components/styles.css");
  assert.match(css, /\.state-spot\{[^}]*min-height:var\(--ss-h\)/);
  assert.match(css, /#site-header\{min-height:calc\(74px \+ var\(--sw-h\)\)\}/);
});

/* ---------- in a browser ---------- */
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

// A state page as the builder now writes it: the committed Iowa rent page with the spot below its answer,
// so the browser check does not wait for main to rebuild the set.
function serve(extra = {}) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    if (!extname(p)) p = p.endsWith("/") ? p + "index.html" : p + ".html";
    if (extra[p]) { res.writeHead(200, { "content-type": p.endsWith(".json") ? "application/json" : "text/html" }); res.end(typeof extra[p] === "string" ? extra[p] : JSON.stringify(extra[p])); return; }
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
function rentWithSpot() {
  let h = read("rent/iowa.html");
  if (!h.includes("data-state-spot")) h = h.replace('<aside class="ag-sponsor-ribbon" data-slot="rent-ia"></aside>', '<div class="state-spot" data-state-spot="IA"></div><aside class="ag-sponsor-ribbon" data-slot="rent-ia"></aside>');
  return h;
}

test("in a browser: the sitewide line lands under the menu without moving the page, and the state spot fills in place", { skip, timeout: 180000 }, async () => {
  const srv = await serve({ "/rent/iowa.html": rentWithSpot() });
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const spots = json("data/sponsor-spots.json"), card = json("data/rate-card.json");
  try {
    for (const [w, h] of [[390, 844], [1280, 800]]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: h }, isMobile: w < 600, hasTouch: w < 600, timezoneId: "America/Chicago" });
      await ctx.route("**/*", (r) => (new URL(r.request().url()).hostname !== "127.0.0.1" ? r.abort() : r.continue()));
      for (const path of ["/", "/rent/iowa"]) {
        const pg = await ctx.newPage();
        await pg.addInitScript(() => {
          window.__mainTops = [];
          const tick = () => { const m = document.querySelector("main"); if (m) window.__mainTops.push(Math.round(m.getBoundingClientRect().top + scrollY)); requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
          window.__shift = 0;
          new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__shift += e.value; }).observe({ type: "layout-shift", buffered: true });
        });
        await pg.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
        await pg.waitForFunction(() => { const l = document.getElementById("ag-sw"); return l && l.textContent.length > 10; }, null, { timeout: 15000 });
        const r = await pg.evaluate(() => {
          const l = document.getElementById("ag-sw"), nav = document.getElementById("topnav");
          return { line: l.textContent, after: nav && nav.nextElementSibling === l, home: l.parentNode.id === "sw-home",
            jobs: (() => { const j = document.getElementById("hb-jobs"); return j ? j.getBoundingClientRect().bottom <= l.getBoundingClientRect().top : null; })(),
            tops: [...new Set(window.__mainTops)] };
        });
        // on a phone the homepage keeps its three jobs on the first screen: the line sits right under them
        if (path === "/" && w < 600) assert.ok(r.home && r.jobs, "/ phone: the line sits under the three jobs");
        else assert.ok(r.after, path + ": the line sits right under the menu");
        assert.ok(r.line.includes("Sponsor spot open.") && r.line.includes("$" + card.tiers[0].price_month + " a month, one business."), r.line);
        if (spots.sitewide.engaged) assert.ok(r.line.includes(spots.sitewide.engaged.toLocaleString("en-US") + " engaged visits in the last 28 days."), r.line);
        assert.ok(r.tops.length <= 1, `${path} ${w}: main moved ${r.tops.join(" > ")}`);
        if (path === "/rent/iowa") {
          await pg.waitForFunction(() => { const s = document.querySelector("[data-state-spot]"); return s && s.textContent.length > 10; }, null, { timeout: 15000 });
          const s = await pg.evaluate(() => { const e = document.querySelector("[data-state-spot]"); return { t: e.textContent, h: e.getBoundingClientRect().height, box: e.firstElementChild.getBoundingClientRect().height }; });
          assert.ok(s.t.includes("Iowa sponsor spot open."), s.t);
          if (spots.states.IA.engaged) assert.ok(s.t.includes(spots.states.IA.engaged.toLocaleString("en-US") + " engaged visits from Iowa"), s.t);
          assert.ok(Math.abs(s.h - s.box) < 1, `the open box fills the held room exactly (${s.h} vs ${s.box})`);
        }
        await pg.close();
      }
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

/* The state spot is never left empty and never collapses after the first paint: when the page cannot carry its
   state's card (the page has its own paid sponsor: a sold ribbon, a sold PRF state page; or the sitewide sponsor is on
   the same screen), the spot keeps its room and says so with no sponsor name; with no state sponsor it shows the open
   box. Iowa is given a live state sponsor here (a copy of the committed entry), the other sponsors are stubbed. */
function prfWithSpot() {
  let h = read("prf/iowa.html");
  if (!h.includes("data-state-spot")) h = h.replace('<div class="prf-prose">', '<div class="state-spot" data-state-spot="IA"></div>\n    <div class="prf-prose">');
  return h;
}
function rentWithSpotTop() {   // the spot on the first screen, so the sitewide sponsor shares the screen with it
  const h = read("rent/iowa.html"), i = h.indexOf("</h1>") + 5;
  return h.slice(0, i) + '<div class="state-spot" data-state-spot="IA"></div>' + h.slice(i);
}
test("in a browser: a state spot that cannot carry its card keeps its room and says so; it never sits empty or collapses", { skip, timeout: 240000 }, async () => {
  const geo = json("data/geo-sponsors.json");
  const base = geo.sponsors.find((e) => e.headline && e.body);
  const iaLive = Object.assign({}, geo, { sponsors: [Object.assign({}, base, { id: "iatest", states: ["IA"], active: true, start: null, end: null })] });
  const noState = Object.assign({}, geo, { sponsors: [] });
  const ribbon = { slots: { "rent-ia": { company: "Ribbon Co", url: "https://ribbon.example", start: "2026-01-01", active: true } } };
  const prfSold = { IA: { name: "PRF Agency", url: "https://prf.example", line: "PRF help.", through: "2099-12-31" } };
  const swSold = Object.assign({}, json("data/sponsor.json"), { active: true, is_house_ad: false, advertiser: "Sitewide Co", cta_url: "https://sitewide.example" });
  const cases = [
    ["/rent/iowa", { "/data/page-sponsors.json": ribbon, "/data/geo-sponsors.json": noState }, "open", "a sold ribbon, no Iowa sponsor"],
    ["/rent/iowa", { "/data/page-sponsors.json": ribbon, "/data/geo-sponsors.json": iaLive }, "other", "a sold ribbon and an Iowa sponsor"],
    ["/prf/iowa", { "/data/prf-sponsors.json": prfSold, "/data/geo-sponsors.json": iaLive }, "other", "a sold PRF page and an Iowa sponsor"],
    ["/rent/iowa", { "/data/sponsor.json": swSold, "/data/geo-sponsors.json": iaLive }, "sitewide", "the sitewide sponsor and an Iowa sponsor"],
    ["/rent/iowa", { "/data/sponsor.json": swSold, "/data/geo-sponsors.json": iaLive, "/rent/iowa.html": rentWithSpotTop() }, "sitewide-top", "the sitewide sponsor and an Iowa sponsor, spot on the first screen"],
  ];
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [path, stubs, want, what] of cases) {
      const srv = await serve(Object.assign({ "/rent/iowa.html": rentWithSpot(), "/prf/iowa.html": prfWithSpot() }, stubs));
      const port = srv.address().port;
      try {
        for (const [w, h] of [[390, 844], [1280, 800]]) {
          const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: h }, isMobile: w < 600, hasTouch: w < 600, timezoneId: "America/Chicago" });
          await ctx.route("**/*", (r) => (new URL(r.request().url()).hostname !== "127.0.0.1" ? r.abort() : r.continue()));
          const pg = await ctx.newPage();
          await pg.addInitScript(() => {
            window.__spot = [];
            const tick = () => { const s = document.querySelector("[data-state-spot]"); if (s) window.__spot.push([Math.round(s.getBoundingClientRect().height), s.hidden || !s.getClientRects().length]); requestAnimationFrame(tick); };
            requestAnimationFrame(tick);
          });
          await pg.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
          const tag = `${what} ${w}`;
          await pg.waitForFunction(() => { const s = document.querySelector("[data-state-spot]"); return s && s.textContent.trim().length > 10; }, null, { timeout: 15000 })
            .catch(() => { throw new Error(tag + ": the spot was left empty"); });
          await pg.waitForTimeout(1500);
          const r = await pg.evaluate(() => {
            const s = document.querySelector("[data-state-spot]");
            return { first: s.getBoundingClientRect().top + scrollY < innerHeight, t: ([...s.querySelectorAll("p")].map((x) => x.textContent.trim()).join(" ") || s.textContent).replace(/\s+/g, " ").trim(), hidden: s.hidden || !s.getClientRects().length, h: s.getBoundingClientRect().height,
              boxes: [...document.querySelectorAll(".geo-spon")].map((b) => !!b.closest("[data-state-spot]")), seen: window.__spot };
          });
          assert.equal(r.hidden, false, tag + ": the spot is never hidden");
          assert.ok(r.seen.every(([sh, hid]) => !hid && sh >= r.seen[0][0] - 1), tag + ": the spot never collapsed after the first paint: " + JSON.stringify([...new Set(r.seen.map((x) => x.join("/")))]));
          if (want === "sitewide-top") assert.ok(r.first, tag + ": the spot is on the first screen");
          if (want === "sitewide" && !r.first) {   // below the first screen the card is not on the sitewide sponsor's screen: it fills the spot
            assert.deepEqual(r.boxes, [true], tag + ": the card fills the spot");
            await ctx.close();
            continue;
          }
          assert.ok(!/Ribbon Co|PRF Agency|Sitewide Co/.test(r.t) && !r.t.includes(base.headline), tag + ": no sponsor name in the spot: " + r.t);
          if (want === "open") { assert.ok(r.t.includes("Iowa sponsor spot open."), tag + ": " + r.t); assert.deepEqual(r.boxes, [], tag + ": no state card"); }
          if (want === "other") { assert.equal(r.t, "Iowa sponsor card It shows on other Iowa pages.", tag); assert.deepEqual(r.boxes, [], tag + ": the page's own sponsor wins"); }
          if (want === "sitewide" || want === "sitewide-top") {
            const lower = r.boxes.length === 1;
            assert.ok(r.boxes.every((x) => !x), tag + ": the card is not in the spot on the sitewide sponsor's screen");
            assert.equal(r.t, "Iowa sponsor card " + (lower ? "It is further down this page." : "It shows on other Iowa pages."), tag);
          }
          await ctx.close();
        }
      } finally { srv.close(); }
    }
  } finally { await browser.close(); }
});

test("sponsor pages: no prices in titles or meta descriptions; Root Lot ends Nov 30", () => {
  for (const f of readdirSync(".").filter((n) => /^sponsor.*\.html$/.test(n))) {
    const h = readFileSync(f, "utf8");
    for (const m of h.matchAll(/<title>([^<]*)<\/title>|<meta name="description" content="([^"]*)"/g)) {
      assert.ok(!/\$\s?\d/.test(m[1] || m[2]), `${f}: price in title or description: ${m[1] || m[2]}`);
    }
  }
  const rl = JSON.parse(readFileSync("data/geo-sponsors.json", "utf8")).sponsors.find((s) => s.id === "rootlot");
  assert.match(rl.end || "", /^\d{4}-\d{2}-\d{2}$/, "Root Lot has an end day (Sig, Nov 11: it ends Nov 30)");
});
