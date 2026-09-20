/* SPONSOR MEASUREMENT — the guards, run against the real files.
 *
 * Every check here exists because of a specific way this could report a number
 * that is not the sponsor's. The rule in this project is rule 1: do not invent
 * a number. An advertising report is where that rule is easiest to break and
 * hardest for anyone to catch, because the person reading the report has no
 * way to check it.
 *
 *     node scripts/sponsor-checks.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const R = (p) => readFileSync(fileURLToPath(new URL("../" + p, import.meta.url)), "utf8");
let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n         " + e.message); }
}

/* COMMENTS ARE NOT COVERAGE. Every one of these files EXPLAINS at length what
 * it does and does not count, and a guard matching prose passes on a file that
 * does none of it. This has bitten this project repeatedly, so every check
 * below runs against the source with comments removed. */
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "")
                          .replace(/^\s*\/\/.*$/gm, "")
                          .replace(/<!--[\s\S]*?-->/g, "");
const py = (s) => s.replace(/^\s*#.*$/gm, "").replace(/"""[\s\S]*?"""/g, "");

const METRICS = decomment(R("components/sponsor-metrics.js"));
const LOADER  = decomment(R("components/loader.js"));
const INDEX   = decomment(R("index.html"));
const HAIL    = decomment(R("hail-map.html"));
const BUILDER = py(R("scripts/build_sponsor_report.py"));
const REPORT  = decomment(R("sponsor-report.html"));
const CONF    = JSON.parse(R("data/sponsors.json"));

console.log("\nTHE RULE IT MEASURES");
check("the MRC threshold is half the pixels", () =>
  assert.match(METRICS, /MIN_RATIO\s*=\s*0?\.5\b/));
check("the dwell is one full continuous second", () =>
  assert.match(METRICS, /MIN_MS\s*=\s*1000\b/));
check("scrolling out before the second resets the clock", () => {
  const el = METRICS.match(/\}\s*else\s*\{[\s\S]{0,200}?clearTimeout\(timer\)/);
  assert.ok(el, "no clearTimeout on the below-threshold branch — a flick past would count");
});
check("a backgrounded tab stops the clock", () =>
  assert.match(METRICS, /visibilitychange[\s\S]{0,160}clearTimeout/));
check("it fires once per element, then stops observing", () =>
  assert.match(METRICS, /fired\s*=\s*true[\s\S]{0,200}io\.disconnect\(\)/));
check("no cookie, no identifier, no storage", () => {
  for (const bad of ["localStorage", "sessionStorage", "document.cookie", "indexedDB"])
    assert.ok(!METRICS.includes(bad), "sponsor-metrics touches " + bad);
});

console.log("\nTHE WIRING — a tracker nobody loads is a draft");
check("loader.js actually loads sponsor-metrics.js", () =>
  assert.match(LOADER, /sponsor-metrics\.js/));
check("and loads it on DOMContentLoaded, not only on a page that opts in", () =>
  assert.match(LOADER, /DOMContentLoaded[\s\S]{0,400}loadSponsorMetrics\(\)/));
check("sponsor-metrics.js exists at the path the loader asks for", () =>
  assert.ok(existsSync(fileURLToPath(new URL("../components/sponsor-metrics.js", import.meta.url)))));
check("the cache version was bumped, or browsers keep the old loader", () =>
  assert.ok(Number((R("components/loader.js").match(/var CV = '(\d+)'/) || [])[1]) >= 20,
    "CV is still 19 — every returning visitor runs the loader without the tracker"));

console.log("\nWHAT MAY BE COUNTED — the house slot is not a sponsor");
check("the homepage slot attribute is on the FILLED element only", () => {
  assert.match(INDEX, /id="dsp-filled"[^>]*data-sponsor-slot=/,
    "the filled block does not carry the slot attribute");
  assert.ok(!/id="daily-sponsor"[^>]*data-sponsor-slot=/.test(INDEX),
    "the slot attribute is on #daily-sponsor, which shows the house pitch when unsold");
  assert.ok(!/id="dsp-empty"[^>]*data-sponsor-slot=/.test(INDEX),
    "the EMPTY state is being counted as a sponsor impression");
});
check("the old homepage sponsor_impression observer is gone", () =>
  assert.ok(!INDEX.includes("sponsor_impression"),
    "index.html still fires sponsor_impression — the house billboard counts as an ad"));
check("the hail map's house ribbon no longer fires a 'sponsor view'", () =>
  assert.ok(!HAIL.includes("hm_sponsor_view"),
    "hail-map.html still fires hm_sponsor_view on copy that reads 'Sponsor this map'"));
check("the footer's FILLED card is measured, and only the filled one", () => {
  assert.match(LOADER, /data-sponsor-slot['"]?,\s*['"]footer-strip/);
  assert.ok(!/ad-slot--open[\s\S]{0,300}data-sponsor-slot/.test(LOADER),
    "the OPEN slot is being measured — that is us advertising our own empty slot");
});

console.log("\nNOTHING IS COUNTED TWICE");
check("the footer's old supporter_click listener was deleted, not left beside it", () =>
  assert.ok(!LOADER.includes("'supporter_click'") && !LOADER.includes('"supporter_click"'),
    "loader.js still fires supporter_click AND sets data-sponsor-click — every click doubles"));
check("only one file fires sponsor_viewable", () => {
  let n = 0;
  for (const [f, src] of [["metrics", METRICS], ["loader", LOADER], ["index", INDEX], ["hail", HAIL]])
    if (src.includes("sponsor_viewable")) n++;
  assert.equal(n, 1, "sponsor_viewable is fired from " + n + " files");
});

console.log("\nTHE REPORT — what it adds up, and what it refuses to");
check("sponsorship ENQUIRIES are not in any sponsor's click total", () =>
  assert.ok(!BUILDER.includes("sponsor_cta_click"),
    "sponsor_cta_click is counted as a click — that event fires on 'become a sponsor' links"));
check("house-slot impressions are not in any sponsor's totals", () => {
  for (const bad of ["sponsor_impression", "hm_sponsor_view"])
    assert.ok(!BUILDER.includes(bad), bad + " is counted — it only ever fired on a house slot");
});
check("an empty event list asks GA4 nothing", () =>
  assert.match(BUILDER, /if not events:\s*\n\s*return \[\]/,
    "LEGACY_VIEW_EVENTS is empty and an empty inListFilter can match EVERY event"));
check("it refuses two sponsors while the slot dimension is unregistered", () =>
  assert.match(BUILDER, /len\(sponsors\) > 1 and not SLOT_DIMENSION[\s\S]{0,200}fail\(/,
    "two sponsors would each be shown the site-wide total as their own"));
check("no start date means no numbers, not a default 90-day window", () => {
  assert.ok(!/start = s\.get\("start"\) or \(end - timedelta/.test(BUILDER),
    "a sponsor with no start date is handed 90 days of traffic that was never theirs");
  assert.match(BUILDER, /"pending": True/, "there is no pending report for a sponsor who has not started");
});
check("the report ends at yesterday, never at today", () =>
  assert.match(BUILDER, /end = today - timedelta\(days=1\)/));
check("the page renders the pending state instead of zeroes", () => {
  /* Measured by position, not by a distance-bounded regex: the branch is long
     and a {0,N} span silently stops matching the day somebody adds a line.
     2026-09-20: the portal was rebuilt; the pending branch lives in results(). */
  const fn = REPORT.indexOf("function results(");
  assert.ok(fn > 0, "sponsor-report.html has no results() section");
  const at = REPORT.indexOf("if (d.pending)", fn);
  assert.ok(at > fn, "results() has no pending branch");
  const real = REPORT.indexOf("num(t.viewable)", at);
  assert.ok(real > at, "the real number tiles are not rendered after the pending branch");
  const ret = REPORT.indexOf("return h", at);
  assert.ok(ret > at && ret < real,
    "the pending branch does not return before the number tiles — a sponsor " +
    "who has not started would be shown a row of zeroes");
});
check("the report page is noindex", () =>
  assert.match(R("sponsor-report.html"), /name="robots"[^>]*noindex/i));

console.log("\nTHE CONFIG");
check("exactly one sponsor is active", () => {
  const on = (CONF.sponsors || []).filter((s) => s.active !== false);
  assert.equal(on.length, 1, on.length + " active sponsors; the builder will refuse");
});
check("no active sponsor carries a start date nobody has confirmed", () => {
  for (const s of (CONF.sponsors || []).filter((x) => x.active !== false))
    assert.ok(s.start === null || /^\d{4}-\d{2}-\d{2}$/.test(s.start),
      s.slug + " has a malformed start date");
});
/* THE FOOTER STRIP IS A SECOND SLOT, AND GA4 CANNOT TELL THEM APART.
   supporter_click is in CLICK_EVENTS and the filled footer card is stamped
   data-sponsor-slot="footer-strip" on every page of the site. With
   SLOT_DIMENSION unset there is no dimension to separate them, so a paid
   Supporter's views and clicks would be added to the daily sponsor's totals --
   and the daily sponsor would never know. The "one sponsor at a time" refusal
   in the builder reads data/sponsors.json only; supporters live in another
   file. Until `slot` is registered in GA4, the two cannot both be sold. */
check("no footer supporter is live while a daily sponsor is being reported", () => {
  const sup = JSON.parse(R("data/supporters.json"));
  const liveSup = (sup.supporters || []).filter((x) => x.active === true);
  const liveSponsor = (CONF.sponsors || []).some((s) => s.active !== false);
  const slotDim = /^\s*SLOT_DIMENSION\s*=\s*None\b/m.test(BUILDER);
  assert.ok(!(liveSup.length && liveSponsor && slotDim),
    liveSup.length + " active footer supporter(s) and a sponsor being reported, with SLOT_DIMENSION unset: " +
    "footer-strip views and supporter_click would be counted as the sponsor's. Register `slot` as a GA4 " +
    "custom dimension and set SLOT_DIMENSION, or keep one of the two off.");
});
check("every sponsor has a token long enough to be unguessable", () => {
  for (const s of CONF.sponsors || [])
    assert.ok((s.token || "").length >= 16, s.slug + "'s token is too short to be the key to the page");
});

/* ── ONE AD, EVERY SURFACE ──────────────────────────────────────────────
   2026-09-20. The homepage's filled state read sp.name / sp.tagline, fields
   data/sponsor.json has never had, so a paying sponsor would have been drawn
   as the house billboard. The /daily page ad carried no measurement slot, so it
   was never counted. Four hand-kept copies of the ad's CSS had drifted to two
   colours. These guard the replacement: one renderer, one stylesheet. */
console.log("\nONE AD, EVERY SURFACE");
const AD_JS  = R("components/sponsor-ad.js");
const AD_CSS = R("components/sponsor-ad.css");
const DAILY  = decomment(R("daily.html"));
const GEN    = R("scripts/generate_daily.py");
const { createRequire } = await import("node:module");
const require_ = createRequire(import.meta.url);
const AgsistAd = require_("../components/sponsor-ad.js");

check("every page that draws the ad links the one stylesheet and the one renderer", () => {
  for (const [name, src] of [["index.html", INDEX], ["daily.html", DAILY], ["sponsor-report.html", REPORT]]) {
    assert.match(src, /\/components\/sponsor-ad\.css/, name + " does not link components/sponsor-ad.css");
    assert.match(src, /\/components\/sponsor-ad\.js/, name + " does not load components/sponsor-ad.js");
    assert.match(src, /AgsistAd\.render\(/, name + " does not call the renderer");
  }
  assert.match(GEN, /\/components\/sponsor-ad\.css/, "the archive page template does not link the stylesheet");
});
check("the homepage draws a paid sponsor from the fields the sponsor file has", () => {
  assert.match(INDEX, /sp\.advertiser/, "the homepage never reads sp.advertiser");
  assert.ok(!/else if\(sp&&\(sp\.tagline\|\|sp\.name\)\)/.test(INDEX),
    "the filled state still keys on tagline/name, which data/sponsor.json does not carry");
});
check("the homepage ad inside the measured wrapper carries clicks, not a second slot", () => {
  assert.match(INDEX, /AgsistAd\.render\(sp,'homepage',\{click:'daily-briefing'\}\)/);
  const html = AgsistAd.render({ advertiser: "A", headline: "H", body: "B", cta_url: "https://a.example/" }, "homepage", { click: "daily-briefing" });
  assert.ok(!/data-sponsor-slot/.test(html), "a click-only ad carries a slot: every view would count twice");
  assert.match(html, /data-sponsor-click="daily-briefing"/);
});
check("the /daily page ad is measured as its own slot", () =>
  assert.match(DAILY, /AgsistAd\.render\(sp,'daily_page',\{slot:'daily-page'\}\)/));
check("the archive ad is measured as its own slot", () =>
  assert.match(py(GEN), /render_sponsor_block_html\(sponsor, surface="archive", slot="daily-archive"\)/));
check("the house pitch is never measured, whatever the caller asks", () => {
  const html = AgsistAd.render({ is_house_ad: true, headline: "Sponsor this", cta_url: "/sponsor" }, "daily_page", { slot: "daily-page", click: "x" });
  assert.ok(!/data-sponsor-(slot|click)/.test(html), "the house ad carries a measurement attribute");
});
console.log("  the JS and Python renderers write the same bytes:");
{
  const { execFileSync } = await import("node:child_process");
  const SP = JSON.parse(R("data/sponsor.json"));
  const cases = [
    [Object.assign({}, SP, { cta_urls: { archive: "https://a.example/q?x=1&y=\"2\"", homepage: "h" } }), "archive", "daily-archive"],
    [Object.assign({}, SP, { cta_urls: { archive: "https://a.example/" }, logo: "", phone: "12", facts: ["no number", "3 things", "1,200+ acres & more"] }), "archive", null],
    [{ is_house_ad: true, label: "H", advertiser: "AGSIST", headline: "<b>x</b>", body: "a & b", cta_text: "Go", cta_url: "mailto:a@b.c", disclosure: "d" }, "archive", "s"],
  ];
  let i = 0;
  for (const [sp, surf, slot] of cases) {
    i++;
    check("  parity case " + i, () => {
      const js = AgsistAd.render(sp, surf, slot ? { slot } : {});
      const pyOut = execFileSync("python3", ["-c",
        "import sys,json;sys.path.insert(0,'scripts');import generate_daily as g;" +
        "print(g.render_sponsor_block_html(json.loads(sys.stdin.read())," + JSON.stringify(surf) + "," +
        (slot ? JSON.stringify(slot) : "None") + "),end='')"],
        { input: JSON.stringify(sp), cwd: fileURLToPath(new URL("../", import.meta.url)) }).toString();
      if (js !== pyOut) {
        let k = 0; while (js[k] === pyOut[k]) k++;
        assert.fail("differ at byte " + k + "\n         JS: " + js.slice(Math.max(0, k - 30), k + 60) +
                    "\n         PY: " + pyOut.slice(Math.max(0, k - 30), k + 60));
      }
    });
  }
}
check("the ad's button ink is readable on its orange", () => {
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const ink = /--sa-ink:(#[0-9a-f]{6})/i.exec(AD_CSS)[1];
  for (const bg of ["#e8743a", "#f2935f"]) {
    const r = ratio(ink, bg);
    assert.ok(r >= 4.5, "ink " + ink + " on " + bg + " is " + r.toFixed(2) + ":1");
  }
});
check("the ad's CSS lives in one file", () => {
  for (const [name, src] of [["index.html", R("index.html")], ["daily.html", R("daily.html")], ["sponsor-report.html", R("sponsor-report.html")], ["scripts/generate_daily.py", GEN]])
    assert.ok(!/(^|\})\s*\.sa-(ad|headline|cta|body|facts)\s*\{/m.test(src), name + " carries its own copy of the ad's rules");
});

console.log("\n  " + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
